"""The demo seeder's fence, and the properties that make its output usable.

The seeder is the one place in this repository that generates readings rather than receiving
them, so much of what is tested here is what it REFUSES to do. A regression that let generated
data reach a real device's series would be invisible in the app — synthetic points render
exactly like measured ones — and would undermine the rule the rest of the codebase is built
around (commit 3d93b03, "Never publish a sensor value that was never measured").

The rest guards the qualities the screens actually need. A seed that is technically written but
never crosses a decision threshold leaves the exposure timeline empty and the pattern screen
reporting a confident zero, and nothing about that failure is visible from the outside.
"""
from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from core_api.app import analytics  # noqa: E402
from intelligence.config import CONFIG  # noqa: E402
from intelligence.pattern import detect_pattern  # noqa: E402
from scripts import seed_demo  # noqa: E402


def _written(offline):
    """The (reading, quality) pairs handed to the batched writer."""
    assert len(offline["write_readings"]) == 1, "the seeder should write in one batch"
    args, _ = offline["write_readings"][0]
    return args[0], args[1]  # pairs, source


# ── the fence ──


def test_refuses_a_device_id_that_is_not_demo_scoped(offline):
    # a real station code from this project — the exact mistake that must be impossible
    with pytest.raises(SystemExit):
        seed_demo.main(["--device-id", "BKK-TRT-003", "--days", "1"])
    assert offline["write_readings"] == []


def test_refuses_a_bare_device_id(offline):
    with pytest.raises(SystemExit):
        seed_demo.main(["--device-id", "P001", "--days", "1"])
    assert offline["write_readings"] == []


def test_dry_run_writes_nothing(offline):
    assert seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1", "--dry-run"]) == 0
    assert offline["write_readings"] == []


def test_seeds_a_demo_device_and_tags_every_point_as_demo(offline):
    assert seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1"]) == 0
    pairs, source = _written(offline)
    assert len(pairs) == 24 * 3600 // seed_demo.INTERVAL_SEC
    assert source == seed_demo.DEMO_SOURCE
    assert source not in ("portable", "station")
    assert {r.device_id for r, _ in pairs} == {"DEMO-ROOM-001"}


# ── the properties the screens depend on ──


def test_seeded_points_are_spread_over_the_requested_span(offline):
    now = datetime.now(UTC)
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "2"])
    pairs, _ = _written(offline)
    times = [r.timestamp for r, _ in pairs]
    assert times == sorted(times)
    # a backlog collapsed onto one instant is useless as history
    assert len(set(times)) == len(times)
    assert now - times[0] >= timedelta(days=2) - timedelta(seconds=seed_demo.INTERVAL_SEC)
    assert now - times[-1] < timedelta(seconds=seed_demo.INTERVAL_SEC * 2)


def test_the_sample_spacing_stays_clear_of_the_timeline_gap_limit(offline):
    # segment_timeline ends a run at any gap > exposure_max_gap_sec. Spacing the samples exactly
    # at that limit would leave the timeline one jitter away from shattering into single-point
    # segments, so the interval must sit strictly below it with room to spare.
    assert seed_demo.INTERVAL_SEC < CONFIG.exposure_max_gap_sec


def test_seeded_readings_pass_the_same_quality_gate_as_real_ones(offline):
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1"])
    pairs, _ = _written(offline)
    qualities = [q for _, q in pairs]
    # PM is valid, so the value is stored and the baseline can be built from it...
    assert all(q.pm25_valid for q in qualities)
    # ...but the points are historical, so they are not fresh enough to drive a live decision.
    # That is why seeding cannot make the forecast or current-risk cards show a number.
    #
    # The single newest point is the exception, and only for a moment: it lands one interval
    # before now, and the interval (120 s) happens to equal freshness_max_age_sec, so it sits
    # exactly on the boundary and ages out of it within a second. Everything behind it — which
    # is the entire seeded history — is unusable from the instant it is written. A demo cannot
    # lean on that one point, which is what feed_demo.py exists for.
    assert not any(q.usable for q in qualities[:-1])
    assert sum(q.usable for q in qualities) <= 1


def test_the_series_has_enough_spread_to_build_a_baseline_from(offline):
    from intelligence.baseline import build_baseline

    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "14"])
    pairs, _ = _written(offline)
    baseline = build_baseline([r.pm25 for r, _ in pairs])
    assert baseline.ready
    # a degenerate series (every point identical) yields zero dispersion and a baseline that
    # flags everything as unusual — no use to a demo and not what a real room looks like
    assert baseline.dispersion > 0
    assert baseline.median > 0


def test_the_series_actually_crosses_the_exposure_threshold(offline):
    # Without this the seed looks fine and every exposure screen is silently empty: no segments
    # on the timeline, no Caution time in the daily or weekly summary, and a pattern screen
    # reporting 0 of N symptoms followed elevated exposure — a confident claim about data that
    # never had the chance to show one.
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "14"])
    pairs, _ = _written(offline)
    readings = [r for r, _ in pairs]
    assert max(r.pm25 for r in readings) > CONFIG.pm25_env_high
    episodes = analytics.exposure_episode_starts(readings)
    assert len(episodes) > 5, f"expected several elevated periods, got {len(episodes)}"


def test_elevated_periods_last_long_enough_to_be_periods(offline):
    # A one-sample excursion is a spike, not an episode, and would draw as a hairline on the
    # timeline. The generator ramps in and out so each is a contiguous run.
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "14"])
    pairs, _ = _written(offline)
    segments = analytics.segment_timeline(analytics.valid_points([r for r, _ in pairs]))
    elevated = [s for s in segments if s["level"] in ("Caution", "High")]
    assert elevated
    longest = max(
        (datetime.fromisoformat(s["end"]) - datetime.fromisoformat(s["start"])).total_seconds()
        for s in elevated
    )
    assert longest >= 1800, f"longest elevated period was only {longest:.0f}s"


# ── symptoms and the pattern screen ──


def test_symptoms_are_only_filed_with_an_owner(monkeypatch, offline):
    filed: list = []
    monkeypatch.setattr(seed_demo.repo, "store_symptom", lambda sub, rows: filed.append((sub, rows)))
    monkeypatch.setattr(seed_demo.repo, "upsert_device", lambda sub, d: None)
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "14"])
    assert filed == []


def test_symptoms_clear_the_pattern_minimum_and_read_as_an_association(monkeypatch, offline):
    filed: list = []
    monkeypatch.setattr(seed_demo.repo, "store_symptom", lambda sub, rows: filed.append((sub, rows)))
    monkeypatch.setattr(seed_demo.repo, "upsert_device", lambda sub, d: None)
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "14", "--owner", "user-42"])

    assert len(filed) == 1
    sub, rows = filed[0]
    assert sub == "user-42"
    assert len(rows) >= CONFIG.pattern_min_samples

    pairs, _ = _written(offline)
    episodes = analytics.exposure_episode_starts([r for r, _ in pairs])
    symptom_times = [datetime.fromisoformat(r["occurred_at"]) for r in rows]
    pattern = detect_pattern(symptom_times, episodes)

    assert pattern.sufficient
    # Neither 0.0 nor 1.0: a perfect association would be a claim the data cannot support, and
    # no association at all would make the screen report a confident negative.
    assert 0.3 < pattern.association < 1.0
    assert pattern.uncertainty is not None and pattern.uncertainty > 0


def test_symptom_rows_have_the_shape_the_table_expects(monkeypatch, offline):
    filed: list = []
    monkeypatch.setattr(seed_demo.repo, "store_symptom", lambda sub, rows: filed.append((sub, rows)))
    monkeypatch.setattr(seed_demo.repo, "upsert_device", lambda sub, d: None)
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "14", "--owner", "user-42"])
    rows = filed[0][1]
    for row in rows:
        assert set(row) == {"occurred_at", "symptom_type", "severity", "note"}
        assert 0 <= row["severity"] <= 10  # the table's own CHECK constraint


# ── device registration ──


def test_without_an_owner_the_device_is_not_registered_to_anyone(monkeypatch, offline):
    registered: list = []
    monkeypatch.setattr(seed_demo.repo, "upsert_device", lambda sub, d: registered.append((sub, d)))
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1"])
    assert registered == []


def test_owner_registration_puts_the_device_where_the_app_looks_for_it(monkeypatch, offline):
    # /me/devices is user-scoped: without a row keyed to the presenting account, the app keeps
    # resolving whatever device that account already has and the seeded history never shows.
    registered: list = []
    monkeypatch.setattr(seed_demo.repo, "upsert_device", lambda sub, d: registered.append((sub, d)))
    monkeypatch.setattr(seed_demo.repo, "store_symptom", lambda sub, rows: None)
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1", "--owner", "user-42"])
    assert len(registered) == 1
    sub, device = registered[0]
    assert sub == "user-42"
    # the shape POST /me/devices accepts, not ingestion's separate registry row
    assert device["external_id"] == "DEMO-ROOM-001"
    assert device["kind"] == "portable"


def test_a_dry_run_registers_nothing(monkeypatch, offline):
    registered: list = []
    monkeypatch.setattr(seed_demo.repo, "upsert_device", lambda sub, d: registered.append((sub, d)))
    monkeypatch.setattr(seed_demo.repo, "store_symptom", lambda sub, rows: registered.append(("sym", rows)))
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1", "--owner", "user-42", "--dry-run"])
    assert registered == []
    assert offline["write_readings"] == []
