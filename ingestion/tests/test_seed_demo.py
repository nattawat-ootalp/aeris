"""The demo seeder's fence.

The seeder is the one place in this repository that generates readings rather than receiving
them, so what is tested here is mostly what it REFUSES to do. A regression that let generated
data reach a real device's series would be invisible in the app — synthetic points render
exactly like measured ones — and would undermine the rule the rest of the codebase is built
around (commit 3d93b03, "Never publish a sensor value that was never measured").
"""
from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts import seed_demo  # noqa: E402


def test_refuses_a_device_id_that_is_not_demo_scoped(offline):
    # a real station code from this project — the exact mistake that must be impossible
    with pytest.raises(SystemExit):
        seed_demo.main(["--device-id", "BKK-TRT-003", "--days", "1"])
    assert offline["write_reading"] == []


def test_refuses_a_bare_device_id(offline):
    with pytest.raises(SystemExit):
        seed_demo.main(["--device-id", "P001", "--days", "1"])
    assert offline["write_reading"] == []


def test_dry_run_writes_nothing(offline):
    assert seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1", "--dry-run"]) == 0
    assert offline["write_reading"] == []


def test_seeds_a_demo_device_and_tags_every_point_as_demo(offline):
    assert seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1"]) == 0
    calls = offline["write_reading"]
    assert len(calls) == 24 * 3600 // seed_demo.INTERVAL_SEC
    sources = {args[2] for args, _ in calls}
    assert sources == {seed_demo.DEMO_SOURCE}
    assert sources.isdisjoint({"portable", "station"})
    devices = {args[0].device_id for args, _ in calls}
    assert devices == {"DEMO-ROOM-001"}


def test_seeded_points_are_spread_over_the_requested_span(offline):
    now = datetime.now(UTC)
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "2"])
    times = [args[0].timestamp for args, _ in offline["write_reading"]]
    assert times == sorted(times)
    # a backlog collapsed onto one instant is useless as history, which is the failure this
    # whole line of work is about
    assert len(set(times)) == len(times)
    assert now - times[0] >= timedelta(days=2) - timedelta(seconds=seed_demo.INTERVAL_SEC)
    assert now - times[-1] < timedelta(seconds=seed_demo.INTERVAL_SEC * 2)


def test_seeded_readings_pass_the_same_quality_gate_as_real_ones(offline):
    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "1"])
    qualities = [args[1] for args, _ in offline["write_reading"]]
    # PM is valid, so the value is stored and the baseline can be built from it...
    assert all(q.pm25_valid for q in qualities)
    # ...but the points are historical, so none of them is fresh enough to drive a live
    # decision. That is why seeding cannot make the forecast or current-risk cards show a
    # number, and the seeder says so on the way out.
    assert not any(q.usable for q in qualities)


def test_the_series_has_enough_spread_to_build_a_baseline_from(offline):
    from intelligence.baseline import build_baseline

    seed_demo.main(["--device-id", "DEMO-ROOM-001", "--days", "14"])
    values = [args[0].pm25 for args, _ in offline["write_reading"]]
    baseline = build_baseline(values)
    assert baseline.ready
    # a degenerate series (every point identical) yields a zero dispersion and a baseline that
    # flags everything as unusual — no use to a demo and not what a real room looks like
    assert baseline.dispersion > 0
    assert baseline.median > 0
