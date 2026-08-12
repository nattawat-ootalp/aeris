"""§5.3 exposure aggregation — valid-only, time+context, no single-point-as-window."""
from __future__ import annotations

from datetime import timedelta

from intelligence.exposure import aggregate_exposure

from .conftest import NOW


def _pts(*pairs):
    return [(NOW + timedelta(seconds=s), v) for s, v in pairs]


def test_empty():
    w = aggregate_exposure([])
    assert w.mean_pm25 is None and w.sample_count == 0 and w.event_count == 0


def test_single_point_is_not_whole_window_exposure():
    w = aggregate_exposure(_pts((0, 100.0)))
    assert w.sample_count == 1
    assert w.duration_above_concern_sec == 0.0  # one point => no duration
    assert w.covered_sec == 0.0
    assert w.mean_pm25 == 100.0


def test_sustained_high_gives_duration_and_one_event():
    # 4 samples 60s apart, all above concern (37.5)
    w = aggregate_exposure(_pts((0, 100), (60, 100), (120, 100), (180, 100)))
    assert w.covered_sec == 180.0
    assert w.duration_above_concern_sec == 180.0
    assert w.event_count == 1
    assert abs(w.mean_pm25 - 100.0) < 1e-6


def test_large_gap_is_not_bridged():
    # 1h gap (> max_gap 300s) must not be integrated as continuous exposure
    w = aggregate_exposure(_pts((0, 100), (3600, 100)))
    assert w.covered_sec == 0.0
    assert w.duration_above_concern_sec == 0.0
    assert w.event_count == 1  # both above -> opened one episode, no bridged duration


def test_partial_crossing_duration():
    # 0->100 over 100s crossing concern=37.5 ; above-fraction = (100-37.5)/100 = 0.625
    w = aggregate_exposure(_pts((0, 0.0), (100, 100.0)))
    assert abs(w.duration_above_concern_sec - 62.5) < 1e-6
    assert abs(w.mean_pm25 - 50.0) < 1e-6  # time-weighted mean of a linear ramp
    assert w.event_count == 1
