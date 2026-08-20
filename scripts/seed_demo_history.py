"""Seed a demonstration health history: symptom entries and the PM2.5 series behind them.

WHY THIS IS LABELLED, LOUDLY
----------------------------
Aeris is non-diagnostic, and `symptom_events` is not display copy — it feeds
`intelligence/pattern.py` (the reported association between symptoms and elevated exposure) and
`intelligence/risk.py` (the personalised risk score). Anything written here therefore comes back
out as a figure that *looks* measured. So every row this script writes carries `DEMO` in its
note, the readings go in under `source="demo"` beside the demo nodes `scripts/seed_demo_nodes.py`
already creates, and the account it targets must be named explicitly. Nothing is written to an
account by default and nothing is written without --apply.

WHAT IT MODELS
--------------
A person with asthma and allergic rhinitis, over the last 30 days:

* a diurnal PM2.5 series with a morning and an evening traffic peak, a weekly rubbish-burning
  day, and ordinary day-to-day variation, so the baseline (§5.4 median + MAD) has something
  real-shaped to be built from;
* symptoms that cluster AFTER elevated periods rather than during them, because that is the
  reported pattern the app exists to surface — and with enough non-followed episodes that the
  association is partial, not perfect. A seeded 100% correlation would produce a "pattern" no
  real record ever shows;
* allergic-rhinitis mornings that are not exposure-linked at all, so the association has a
  floor of unexplained events, which is what makes the uncertainty band meaningful;
* severity mostly mild, occasionally moderate, rarely severe, with inhaler use recorded on the
  worse ones as diary context only.

Usage:
    python scripts/seed_demo_history.py --account <uuid|email> --device <external_id>
    python scripts/seed_demo_history.py --account <uuid|email> --device <external_id> --apply
"""
from __future__ import annotations

import argparse
import os
import random
import sys
from datetime import UTC, datetime, timedelta

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ingestion.app.config import settings  # noqa: E402

DEMO_NOTE = "DEMO — seeded demonstration data, not a real report"
DEMO_SOURCE = "demo"
DAYS = 30
SAMPLE_EVERY_MIN = 15

# Severity as the API stores it (read_api.log_symptom maps mild/moderate/severe -> 2/5/8).
MILD, MODERATE, SEVERE = 2, 5, 8

# The vocabulary the app already offers (SymptomEventScreen).
ASTHMA = ("cough", "chest_tightness", "wheeze", "breathless")
RHINITIS = ("cough", "other")


def headers(extra: dict | None = None) -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is not set — this script cannot run without it.")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        **(extra or {}),
    }


def resolve_account(wanted: str) -> str:
    r = httpx.get(
        f"{settings.SUPABASE_URL}/auth/v1/admin/users",
        headers=headers(), params={"per_page": 1000}, timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    users = body.get("users", body if isinstance(body, list) else [])
    for u in users:
        if u["id"] == wanted or (u.get("email") or "").lower() == wanted.lower():
            return u["id"]
    raise SystemExit(f"No account matches {wanted!r}.")


def pm25_series(rng: random.Random, now: datetime) -> list[tuple[datetime, float]]:
    """A believable 30-day PM2.5 record at 15-minute resolution.

    Shape rather than noise: a clean overnight floor, a commute peak either side of the working
    day, one heavier day a week, and a slow seasonal drift. The point is that the baseline built
    from it (median + MAD) lands somewhere a person would recognise, and that the elevated
    episodes the pattern detector finds are episodes rather than single spikes.
    """
    out: list[tuple[datetime, float]] = []
    # Two hours inside the window rather than exactly on it. The bucket keeps 30 days, and a
    # sample stamped at the boundary is already older than the minimum acceptable timestamp by
    # the time the write lands — InfluxDB rejects that line and reports a partial write.
    start = now - timedelta(days=DAYS) + timedelta(hours=2)
    steps = DAYS * 24 * (60 // SAMPLE_EVERY_MIN)
    for i in range(steps):
        t = start + timedelta(minutes=i * SAMPLE_EVERY_MIN)
        local_hour = (t.hour + 7) % 24  # Asia/Bangkok, the record this stands in for
        base = 14.0 + 6.0 * (i / steps)  # a month getting slowly hazier

        # Deliberately BELOW the caution threshold on an ordinary day. If the commute peak
        # crossed it every morning and evening, almost any symptom would fall within the
        # pattern detector's six-hour window and the reported association would be ~1.0 for
        # arithmetic reasons rather than for anything in the record.
        if 6 <= local_hour < 9:
            base += 11.0
        elif 17 <= local_hour < 20:
            base += 14.0
        elif 0 <= local_hour < 5:
            base -= 6.0

        # One burning day a week: the whole afternoon is bad, not one reading.
        # The days that DO cross it: a weekly burning afternoon, and an occasional bad evening.
        if t.weekday() == 6 and 13 <= local_hour < 19:
            base += 45.0
        elif t.weekday() in (2, 4) and 18 <= local_hour < 21 and (i // 96) % 2 == 0:
            base += 26.0

        value = max(1.0, rng.gauss(base, 4.0))
        out.append((t, round(value, 1)))
    return out


def elevated_episodes(series: list[tuple[datetime, float]], threshold: float) -> list[datetime]:
    """When each run above the threshold ENDED — the instant a symptom would follow."""
    ends: list[datetime] = []
    inside = False
    last = series[0][0]
    for t, v in series:
        if v >= threshold and not inside:
            inside = True
        elif v < threshold and inside:
            inside = False
            ends.append(last)
        last = t
    if inside:
        ends.append(last)
    return ends


def symptom_rows(rng: random.Random, user_id: str, ends: list[datetime], now: datetime) -> list[dict]:
    """Symptom entries: some following an elevated period, some not.

    The proportion matters. `detect_pattern` reports the fraction of symptom events preceded by
    elevated exposure together with a 95% half-width, and a seeded 1.0 would present a certainty
    no observational record supports. Roughly two thirds follow an episode; the rest are the
    morning rhinitis that has nothing to do with the air outside.
    """
    rows: list[dict] = []

    for end in ends:
        if rng.random() > 0.62:
            continue  # an elevated period that was simply got through
        delay_h = rng.uniform(0.5, 5.0)  # inside pattern.py's 6h window, not pinned to its edge
        at = end + timedelta(hours=delay_h)
        if at > now:
            continue
        roll = rng.random()
        severity = SEVERE if roll > 0.94 else MODERATE if roll > 0.68 else MILD
        picks = rng.sample(ASTHMA, k=1 if severity == MILD else 2)
        for s in picks:
            rows.append({
                "user_id": user_id,
                "occurred_at": at.isoformat(),
                "symptom_type": s,
                "severity": severity,
                "note": DEMO_NOTE,
                "inhaler_used": severity >= MODERATE,
            })

    # Allergic rhinitis: early morning, unrelated to the measured air.
    for day in range(DAYS):
        if rng.random() > 0.55:
            continue
        at = (now - timedelta(days=day)).replace(hour=23, minute=rng.randrange(0, 59), second=0, microsecond=0)
        at -= timedelta(hours=rng.uniform(0, 1.5))  # ~06:00-07:30 local
        if at > now:
            continue
        rows.append({
            "user_id": user_id,
            "occurred_at": at.isoformat(),
            "symptom_type": rng.choice(RHINITIS),
            "severity": MILD,
            "note": DEMO_NOTE,
            "inhaler_used": False,
        })

    rows.sort(key=lambda r: r["occurred_at"])
    return rows


def write_influx(device_id: str, series: list[tuple[datetime, float]]) -> int:
    """The readings the baseline and the timeline are computed from.

    Written through the same writer the ingestion path uses, so they are gated by §5.1 exactly
    like a real reading and land in the same measurement — but tagged `source="demo"`, which is
    what tells them apart afterwards.
    """
    from ingestion.app import writers
    from intelligence.models import Reading
    from intelligence.quality import assess_quality

    pairs = []
    for t, v in series:
        reading = Reading(
            device_id=device_id,
            timestamp=t,
            pm25=v,
            temperature=round(28.0 + (v % 5) * 0.3, 1),
            humidity=round(62.0 + (v % 7) * 0.8, 1),
            battery=100,
            sensor_status="OK",
            quality_score=1.0,
        )
        # Assessed at the reading's OWN time, so a month-old sample is not rejected as stale —
        # the same thing core_api.analytics.valid_points does when reading history back.
        pairs.append((reading, assess_quality(reading, now=t)))
    writers.write_readings(pairs, source=DEMO_SOURCE)
    return len(pairs)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", required=True, help="uuid or email of the account to seed")
    ap.add_argument("--device", required=True, help="external device id the readings belong to")
    ap.add_argument("--seed", type=int, default=20260821, help="fixed so a re-run is identical")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    now = datetime.now(UTC)
    user_id = resolve_account(args.account)

    series = pm25_series(rng, now)
    caution = float(os.getenv("PM25_ENV_CAUTION", "37.5"))
    ends = elevated_episodes(series, caution)
    rows = symptom_rows(rng, user_id, ends, now)

    values = [v for _, v in series]
    values.sort()
    median = values[len(values) // 2]
    followed = sum(1 for r in rows if r["note"] == DEMO_NOTE and r["symptom_type"] in ASTHMA)

    print(f"account       {user_id}")
    print(f"device        {args.device}")
    print(f"readings      {len(series)} over {DAYS} days at {SAMPLE_EVERY_MIN} min")
    print(f"  median PM2.5 {median} ug/m3, max {max(values)}")
    print(f"elevated periods above {caution}: {len(ends)}")
    print(f"symptom rows  {len(rows)}  ({followed} asthma-type, {len(rows) - followed} rhinitis-type)")
    print(f"every row noted: {DEMO_NOTE!r}")

    if not args.apply:
        print("\nPlan only. Re-run with --apply to write.")
        return

    written = write_influx(args.device, series)
    print(f"\nwrote {written} readings to InfluxDB (source={DEMO_SOURCE})")

    r = httpx.post(
        f"{settings.SUPABASE_URL}/rest/v1/symptom_events",
        headers=headers({"Prefer": "return=representation"}), json=rows, timeout=120,
    )
    r.raise_for_status()
    print(f"wrote {len(r.json())} symptom rows to Supabase")


if __name__ == "__main__":
    main()
