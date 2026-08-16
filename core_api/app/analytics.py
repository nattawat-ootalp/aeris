"""Derived history/exposure analytics over a device's readings (TDD §5.3–§5.5).

Pure functions only: every input is already-fetched data, so these stay unit-testable and the
endpoints in ``read_api`` keep doing nothing but I/O + serialization. All duration/exposure
maths reuses ``intelligence.exposure.aggregate_exposure`` rather than re-deriving integration
rules, so the "never bridge a gap larger than ``exposure_max_gap_sec``" guarantee holds
everywhere (a single sample is never inflated into a whole window of exposure).
"""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta

from intelligence.config import CONFIG
from intelligence.environmental import classify_env
from intelligence.exposure import aggregate_exposure
from intelligence.models import EnvState, ExposureWindow, Reading
from intelligence.quality import assess_quality

Point = tuple[datetime, float]

# EnvState is an engineering classification; the watch vocabulary is the closed union in
# TDD §7 (no "Safe" by construction).
_WATCH_BY_ENV: dict[EnvState, str] = {
    EnvState.NORMAL: "Normal",
    EnvState.CAUTION: "Caution",
    EnvState.HIGH: "High",
}


def watch_label_for(pm25: float | None) -> str:
    state, _ = classify_env(pm25)
    return _WATCH_BY_ENV.get(state, "No Data") if state is not None else "No Data"


def valid_points(readings: list[Reading]) -> list[Point]:
    """(timestamp, pm25) for readings that pass §5.1 PM gating.

    Quality is assessed at each reading's *own* timestamp: freshness is a property of "is this
    the current state", not of a historical sample, so a two-hour-old point is still a valid
    historical measurement.
    """
    ordered = sorted(readings, key=lambda r: r.timestamp)
    out: list[Point] = []
    prev: Reading | None = None
    for r in ordered:
        q = assess_quality(r, now=r.timestamp, previous=prev)
        if q.pm25_valid and r.pm25 is not None:
            out.append((r.timestamp, r.pm25))
        prev = r
    return out


def _window_at(points: list[Point], level: float) -> ExposureWindow:
    """Exposure aggregation with the concern threshold moved to ``level``."""
    return aggregate_exposure(points, replace(CONFIG, exposure_concern_pm25=level))


def format_duration(seconds: float) -> str:
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"{minutes} min"
    return f"{minutes // 60}h {minutes % 60}m"


# ── Timeline segmentation ────────────────────────────────────────────────────
def segment_timeline(points: list[Point]) -> list[dict]:
    """Split a point series into contiguous runs of the same environmental level.

    A run also ends at any gap wider than ``exposure_max_gap_sec`` — the device was not
    measuring across that gap, so the two sides are separate periods, not one long one.
    """
    segments: list[dict] = []
    run: list[Point] = []
    run_state: EnvState | None = None

    def flush() -> None:
        if not run:
            return
        segments.append(_segment_dict(run, run_state))

    for ts, pm in points:
        state, _ = classify_env(pm)
        gap = (ts - run[-1][0]).total_seconds() if run else 0.0
        if run and (state != run_state or gap > CONFIG.exposure_max_gap_sec):
            flush()
            run = []
        run.append((ts, pm))
        run_state = state
    flush()
    return segments


def _segment_dict(run: list[Point], state: EnvState | None) -> dict:
    window = aggregate_exposure(run)
    values = [v for _, v in run]
    start, end = run[0][0], run[-1][0]
    return {
        # Deterministic id: the segment's start instant. Re-derivable from the same history,
        # so the detail screen can re-fetch a segment without a stored event table.
        "id": str(int(start.timestamp())),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "level": _WATCH_BY_ENV.get(state, "No Data") if state is not None else "No Data",
        "duration_sec": window.covered_sec,
        "sample_count": len(run),
        # time-weighted where there is covered time, else the single observed value
        "pm25_avg": window.mean_pm25 if window.mean_pm25 is not None else values[0],
        "pm25_max": max(values),
        "pm25_min": min(values),
    }


def timeline(readings: list[Reading], min_samples: int = 2) -> list[dict]:
    """Timeline periods, newest first. Single-sample blips are dropped (no duration to show)."""
    segs = [s for s in segment_timeline(valid_points(readings)) if s["sample_count"] >= min_samples]
    return list(reversed(segs))


def segment_detail(readings: list[Reading], event_id: str) -> dict | None:
    """One timeline period plus the non-PM context measured during it."""
    ordered = sorted(readings, key=lambda r: r.timestamp)
    for seg in timeline(ordered, min_samples=1):
        if seg["id"] != event_id:
            continue
        start = datetime.fromisoformat(seg["start"])
        end = datetime.fromisoformat(seg["end"])
        inside = [r for r in ordered if start <= r.timestamp <= end]
        return {
            **seg,
            "temperature_avg": _avg([r.temperature for r in inside]),
            "humidity_avg": _avg([r.humidity for r in inside]),
            "tvoc_avg": _avg([r.tvoc for r in inside]),
            "co2_avg": _avg([r.co2 for r in inside]),
            "eco2_avg": _avg([r.eco2 for r in inside]),
            "trend": _trend([r.pm25 for r in inside if r.pm25 is not None]),
        }
    return None


def _avg(values: list[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    return sum(clean) / len(clean) if clean else None


def _trend(values: list[float]) -> str | None:
    """Coarse shape of the period. None when there is not enough data to say anything."""
    if len(values) < 3:
        return None
    third = max(1, len(values) // 3)
    first, last = _avg(values[:third]), _avg(values[-third:])
    peak_at = values.index(max(values)) / (len(values) - 1)
    if first is None or last is None:
        return None
    delta = last - first
    if 0.25 < peak_at < 0.75 and max(values) > max(first, last) * 1.2:
        return "rising then falling"
    if delta > 2:
        return "rising"
    if delta < -2:
        return "falling"
    return "steady"


# ── Daily summary ────────────────────────────────────────────────────────────
def daily_summary(readings: list[Reading], symptom_count: int) -> dict:
    points = valid_points(readings)
    tracked = aggregate_exposure(points)
    elevated = _window_at(points, CONFIG.pm25_env_caution)
    high = _window_at(points, CONFIG.pm25_env_high)

    # The "highest exposure period" is a real measured period — the elevated timeline segment
    # with the highest time-weighted mean — never a window invented around a peak sample.
    # A segment with no covered time is a single blip, not a period spent anywhere.
    elevated_segments = [
        s for s in segment_timeline(points)
        if s["level"] in ("Caution", "High") and s["duration_sec"] > 0
    ]
    peak = max(elevated_segments, key=lambda s: s["pm25_avg"], default=None)

    return {
        "tracked_time": format_duration(tracked.covered_sec),
        "tracked_sec": tracked.covered_sec,
        "elevated_exposure": format_duration(elevated.duration_above_concern_sec),
        "elevated_sec": elevated.duration_above_concern_sec,
        "high_exposure": format_duration(high.duration_above_concern_sec),
        "high_sec": high.duration_above_concern_sec,
        "mean_pm25": tracked.mean_pm25,
        "sample_count": tracked.sample_count,
        "symptom_events": symptom_count,
        "highest_exposure_start": peak["start"] if peak else None,
        "highest_exposure_end": peak["end"] if peak else None,
        "highest_exposure_pm25": peak["pm25_avg"] if peak else None,
    }


# ── Weekly history ───────────────────────────────────────────────────────────
def weekly(readings: list[Reading], now: datetime, days: int = 7) -> dict:
    """One bucket per calendar day (UTC), oldest first. Days with no data report zero
    coverage and a null mean — never an interpolated value."""
    points = valid_points(readings)
    buckets: list[dict] = []
    day_start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(days):
        lo = day_start + timedelta(days=i)
        hi = lo + timedelta(days=1)
        day_points = [p for p in points if lo <= p[0] < hi]
        tracked = aggregate_exposure(day_points)
        elevated = _window_at(day_points, CONFIG.pm25_env_caution)
        buckets.append({
            "date": lo.date().isoformat(),
            "weekday": lo.strftime("%a"),
            "mean_pm25": tracked.mean_pm25,
            "max_pm25": max((v for _, v in day_points), default=None),
            "tracked_sec": tracked.covered_sec,
            "elevated_sec": elevated.duration_above_concern_sec,
            "sample_count": len(day_points),
        })

    with_exposure = [b for b in buckets if b["elevated_sec"] > 0]
    highest = max(with_exposure, key=lambda b: b["elevated_sec"], default=None)
    return {
        "days": buckets,
        "highest_day": highest["date"] if highest else None,
        "highest_day_elevated": format_duration(highest["elevated_sec"]) if highest else None,
        "total_sample_count": sum(b["sample_count"] for b in buckets),
    }


# ── Data quality ─────────────────────────────────────────────────────────────
def data_quality(readings: list[Reading], now: datetime) -> dict:
    """Freshness / continuity / sensor state for the *current* view (§5.1, §21).

    Deliberately reports no 0–100 "quality score" to the user — only the concrete facts the
    gate actually checked.
    """
    if not readings:
        return {
            "has_data": False,
            "freshness_sec": None,
            "sensor_status": None,
            "gaps_last_hour": None,
            "coverage_ratio_last_hour": None,
            "sample_count": 0,
            "battery_low": False,
            "reasons": ["NO_VALID_DATA"],
        }

    ordered = sorted(readings, key=lambda r: r.timestamp)
    latest = ordered[-1]
    previous = ordered[-2] if len(ordered) > 1 else None
    q = assess_quality(latest, now=now, previous=previous)

    hour_ago = now - timedelta(hours=1)
    hour_points = [p for p in valid_points(ordered) if p[0] >= hour_ago]
    gaps = sum(
        1
        for a, b in zip(hour_points, hour_points[1:], strict=False)
        if (b[0] - a[0]).total_seconds() > CONFIG.exposure_max_gap_sec
    )
    covered = aggregate_exposure(hour_points).covered_sec

    return {
        "has_data": True,
        "freshness_sec": q.freshness_sec,
        "fresh": q.fresh,
        "pm25_valid": q.pm25_valid,
        "usable": q.usable,
        "sensor_status": latest.sensor_status,
        "gaps_last_hour": gaps,
        "coverage_ratio_last_hour": min(1.0, covered / 3600.0),
        "sample_count": len(ordered),
        "battery_low": q.battery_low,
        "reasons": q.reasons,
    }


# ── Pattern inputs ───────────────────────────────────────────────────────────
def exposure_episode_starts(readings: list[Reading]) -> list[datetime]:
    """Start instants of elevated-exposure periods — the exposure side of §5.5 pattern
    detection."""
    return [
        datetime.fromisoformat(s["start"])
        for s in segment_timeline(valid_points(readings))
        if s["level"] in ("Caution", "High")
    ]
