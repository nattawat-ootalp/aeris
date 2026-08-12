"""§5.6 decision engine — incl. the medical-safety invariant: invalid PM => no PM caution."""
from __future__ import annotations

from intelligence.decision import decide
from intelligence.models import (
    Baseline,
    Confidence,
    Decision,
    EnvState,
    ExposureWindow,
    QualityResult,
    Reason,
)


def _q(usable=True, pm_valid=True, fresh=True, qs=0.9, reasons=None, freshness=5.0):
    return QualityResult(
        usable=usable, pm25_valid=pm_valid, freshness_sec=freshness, fresh=fresh,
        quality_score=qs, battery_low=False, reasons=list(reasons or []),
    )


def test_invalid_pm_never_creates_pm_caution():
    # THE core medical-safety test (TDD §5.1, §14)
    q = _q(usable=False, pm_valid=False, reasons=[Reason.SENSOR_INVALID])
    ev = decide(q, stable_env=None, pm25=None)
    assert ev.decision == Decision.NO_DATA
    assert ev.decision not in (Decision.CAUTION, Decision.HIGH)
    assert Reason.SENSOR_INVALID in ev.reason_codes
    assert ev.watch_label == "No Data"


def test_stale_data_is_no_data():
    q = _q(usable=False, fresh=False, reasons=[Reason.DATA_STALE], freshness=9999)
    ev = decide(q, stable_env=None, pm25=None)
    assert ev.decision == Decision.NO_DATA
    assert Reason.DATA_STALE in ev.reason_codes


def test_high_state_decision():
    ev = decide(_q(qs=0.9), stable_env=EnvState.HIGH, pm25=90.0)
    assert ev.decision == Decision.HIGH
    assert Reason.PM25_ABOVE_ENV_HIGH in ev.reason_codes
    assert ev.confidence == Confidence.HIGH
    assert ev.watch_label == "High"


def test_personal_baseline_adds_reasons_and_bumps_confidence():
    b = Baseline(ready=True, sample_count=60, median=10, dispersion=3, upper=20)
    ev = decide(_q(qs=0.6), stable_env=EnvState.HIGH, pm25=90.0, baseline=b)
    assert Reason.PM25_ABOVE_PERSONAL_BASELINE in ev.reason_codes
    assert Reason.PERSONAL_EXPOSURE_ELEVATED in ev.reason_codes
    assert ev.confidence == Confidence.HIGH  # MEDIUM base bumped by personalization
    assert ev.sample_size == 60


def test_insufficient_baseline_is_flagged_not_personalized():
    b = Baseline(ready=False, sample_count=3)
    ev = decide(_q(), stable_env=EnvState.CAUTION, pm25=40.0, baseline=b)
    assert Reason.BASELINE_INSUFFICIENT_SAMPLE in ev.reason_codes
    assert Reason.PM25_ABOVE_PERSONAL_BASELINE not in ev.reason_codes


def test_exposure_duration_increasing_reason():
    cur = ExposureWindow(mean_pm25=80, duration_above_concern_sec=200, covered_sec=600, sample_count=10, event_count=1)
    prev = ExposureWindow(mean_pm25=60, duration_above_concern_sec=100, covered_sec=600, sample_count=10, event_count=1)
    ev = decide(_q(), stable_env=EnvState.CAUTION, pm25=40.0, exposure=cur, prev_exposure=prev)
    assert Reason.EXPOSURE_DURATION_INCREASING in ev.reason_codes


def test_spike_caps_confidence():
    q = _q(qs=0.9, reasons=[Reason.SPIKE_SUSPECTED])
    ev = decide(q, stable_env=EnvState.CAUTION, pm25=40.0)
    assert ev.confidence == Confidence.MEDIUM  # capped despite high quality_score
    assert Reason.SPIKE_SUSPECTED in ev.reason_codes


def test_reason_codes_never_empty():
    ev = decide(_q(), stable_env=EnvState.NORMAL, pm25=10.0)
    assert ev.reason_codes  # always explains itself (§5.8)
    assert ev.decision == Decision.NORMAL
