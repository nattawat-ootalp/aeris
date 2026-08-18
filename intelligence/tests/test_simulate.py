"""§3 route exposure simulation — the pure core, with no network or database."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from intelligence.simulate import (
    InterpolationMode,
    RoutePoint,
    Sensor,
    assign_times,
    coverage,
    haversine_m,
    nearest_sensor,
    resample_route,
    simulate,
    summarize_parameter,
    value_at,
)

T0 = datetime(2026, 8, 18, 7, 30, tzinfo=UTC)

# One degree of latitude is ~111 km, so this pair is almost exactly 1 km apart north-south.
SOUTH, NORTH = (12.2429, 102.5140), (12.2519, 102.5140)


def test_haversine_matches_known_distance():
    d = haversine_m(*SOUTH, *NORTH)
    assert 990 < d < 1010
    assert haversine_m(*SOUTH, *SOUTH) == 0.0


def test_resample_spaces_points_evenly_and_keeps_the_destination():
    pts = resample_route([SOUTH, NORTH], 100.0)
    gaps = [b[2] - a[2] for a, b in zip(pts, pts[1:])]
    assert all(99 < g < 101 for g in gaps[:-1])          # every full interval
    assert pts[0][2] == 0.0
    # The end of the route is emitted even though it does not land on a 100 m boundary, so the
    # reported distance is the route's own rather than a multiple of the sampling interval.
    assert pts[-1][:2] == pytest.approx(NORTH)


def test_resample_needs_a_positive_spacing():
    with pytest.raises(ValueError):
        resample_route([SOUTH, NORTH], 0)


def test_times_follow_distance_and_speed():
    # §3.4's worked example: 50 m at 1.25 m/s is 40 s per point.
    pts = assign_times(resample_route([SOUTH, NORTH], 50.0), T0, 1.25)
    assert pts[0].time == T0
    assert (pts[1].time - pts[0].time).total_seconds() == pytest.approx(40, abs=0.5)
    assert (pts[2].time - pts[0].time).total_seconds() == pytest.approx(80, abs=0.5)


def test_speed_must_be_positive():
    with pytest.raises(ValueError):
        assign_times([(0.0, 0.0, 0.0)], T0, 0)


def test_nearest_sensor_respects_the_range_limit():
    sensors = [Sensor("NEAR", 12.2430, 102.5140), Sensor("FAR", 12.2519, 102.5140)]
    hit = nearest_sensor(12.2429, 102.5140, sensors, 300)
    assert hit is not None and hit[0].node_code == "NEAR"
    # A route point with nothing in range is NO DATA, never the next sensor along: that one is
    # measuring somewhere else, and reporting it here would invent a reading for this place.
    assert nearest_sensor(12.2474, 102.5140, sensors, 300) is None


def test_linear_interpolation_matches_the_specification_example():
    series = [(T0, 20.0), (T0 + timedelta(minutes=1), 30.0)]
    assert value_at(series, T0 + timedelta(seconds=30)) == pytest.approx(25.0)


def test_nearest_mode_picks_a_measured_value_rather_than_a_blend():
    series = [(T0, 20.0), (T0 + timedelta(minutes=1), 30.0)]
    at = value_at(series, T0 + timedelta(seconds=50), InterpolationMode.NEAREST)
    assert at == 30.0


def test_interpolation_refuses_to_bridge_a_long_gap():
    # Two readings 40 minutes apart say nothing about the twenty minutes between them.
    series = [(T0, 20.0), (T0 + timedelta(minutes=40), 30.0)]
    assert value_at(series, T0 + timedelta(minutes=20), max_gap_s=900) is None


def test_interpolation_reaches_no_further_than_max_gap_past_the_ends():
    series = [(T0, 20.0)]
    assert value_at(series, T0 + timedelta(seconds=60), max_gap_s=900) == 20.0
    assert value_at(series, T0 + timedelta(hours=2), max_gap_s=900) is None


def test_none_mode_never_answers():
    series = [(T0, 20.0), (T0 + timedelta(minutes=1), 30.0)]
    assert value_at(series, T0, InterpolationMode.NONE) is None


def _points(values: list[float | None], step_min: int = 5) -> list[RoutePoint]:
    return [
        RoutePoint(i, 0.0, 0.0, i * 100.0, T0 + timedelta(minutes=step_min * i),
                   values={} if v is None else {"pm25": v})
        for i, v in enumerate(values)
    ]


def test_summary_integrates_by_time_and_counts_time_above_the_threshold():
    s = summarize_parameter(_points([20.0, 30.0, 50.0, 40.0]), "pm25", "ug/m3", threshold=37.5)
    assert (s.minimum, s.maximum, s.sample_count) == (20.0, 50.0, 4)
    # Trapezoidal, the same rule intelligence/exposure.py uses, so one walk is not measured
    # two different ways depending on which screen is asking:
    #   (20+30)/2*5 + (30+50)/2*5 + (50+40)/2*5 = 550 ug/m3-min over 15 minutes.
    assert s.exposure_integral == pytest.approx(550.0)
    assert s.exposure_unit == "ug/m3·min"
    assert s.covered_s == pytest.approx(900.0)
    assert s.average == pytest.approx(550.0 / 15.0)
    assert 0 < s.time_above_threshold_s < 900


def test_summary_does_not_integrate_across_a_coverage_hole():
    # The middle point has no reading, so the two that do are not adjacent in time and the
    # stretch between them was never measured. Closing that gap would report exposure for a
    # place nothing observed.
    s = summarize_parameter(_points([20.0, None, 50.0]), "pm25", "ug/m3")
    assert s.exposure_integral == 0.0
    assert s.covered_s == 0.0
    assert s.average == pytest.approx(35.0)     # falls back to the plain mean, and says so
    assert s.sample_count == 2


def test_summary_of_nothing_is_empty_not_zero():
    s = summarize_parameter(_points([None, None]), "pm25", "ug/m3", threshold=37.5)
    assert s.average is None and s.minimum is None and s.maximum is None
    assert s.sample_count == 0


def test_coverage_counts_points_that_resolved():
    assert coverage(_points([20.0, None, 50.0])) == pytest.approx(2 / 3)
    assert coverage([]) == 0.0


def test_simulate_end_to_end_switches_sensors_along_the_way():
    sensors = [Sensor("SOUTH", *SOUTH), Sensor("NORTH", *NORTH)]
    # Each sensor reads a constant, so which one answered is visible in the values themselves.
    series = {
        "SOUTH": {"pm25": [(T0 - timedelta(hours=1), 10.0), (T0 + timedelta(hours=1), 10.0)]},
        "NORTH": {"pm25": [(T0 - timedelta(hours=1), 80.0), (T0 + timedelta(hours=1), 80.0)]},
    }
    out = simulate(
        geometry=[SOUTH, NORTH],
        start_time=T0,
        speed_mps=1.25,
        sensors=sensors,
        series_by_sensor=series,
        parameters={"pm25": "ug/m3"},
        thresholds={"pm25": 37.5},
        sampling_distance_m=100.0,
        max_sensor_distance_m=300.0,
        max_gap_s=4 * 3600,
    )
    assert out.distance_m == pytest.approx(1000, abs=15)
    assert out.duration_s == pytest.approx(1000 / 1.25, abs=15)
    assert set(out.sensors_used) == {"SOUTH", "NORTH"}
    assert {p.values["pm25"] for p in out.points if p.has_data} == {10.0, 80.0}
    # The middle of a 1 km route is 500 m from either end — beyond the 300 m limit — so the
    # walk is only partly covered and the result says so rather than interpolating across.
    assert 0.0 < out.coverage < 1.0
    assert any(not p.has_data for p in out.points)


def test_simulate_reports_no_coverage_when_every_sensor_is_out_of_range():
    out = simulate(
        geometry=[SOUTH, NORTH],
        start_time=T0,
        speed_mps=1.25,
        sensors=[Sensor("ELSEWHERE", 13.7563, 100.5018)],      # Bangkok, ~250 km away
        series_by_sensor={"ELSEWHERE": {"pm25": [(T0, 99.0)]}},
        parameters={"pm25": "ug/m3"},
        sampling_distance_m=100.0,
    )
    assert out.coverage == 0.0
    assert out.sensors_used == []
    assert out.summaries["pm25"].average is None
