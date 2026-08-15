"""§5.9 personalized risk score — systemic aggregate, never a medical claim."""
from datetime import UTC, datetime, timedelta

from intelligence.models import Baseline, Confidence, Decision, ExposureWindow, Reason
from intelligence.risk import compute_risk

NOW = datetime(2026, 8, 15, 20, 0, tzinfo=UTC)


def _window(mean=10.0, above=0.0, covered=3600.0, n=30):
    return ExposureWindow(
        mean_pm25=mean,
        duration_above_concern_sec=above,
        covered_sec=covered,
        sample_count=n,
        event_count=0,
    )


def _ready_baseline(median=10.0, upper=20.0):
    return Baseline(ready=True, sample_count=120, median=median, dispersion=3.0, upper=upper)


def test_unusable_data_is_no_data_not_a_low_score():
    """A missing measurement must never read as a low-risk measurement."""
    r = compute_risk(
        now=NOW, usable=False, freshness_sec=None,
        window=_window(mean=None, n=0), baseline=Baseline(ready=False, sample_count=0),
        quality_reasons=[Reason.SENSOR_INVALID],
    )
    assert r.decision is Decision.NO_DATA
    assert r.score is None
    assert Reason.SENSOR_INVALID in r.reason_codes


def test_no_samples_is_no_data_even_when_gate_passed():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=None, n=0), baseline=Baseline(ready=False, sample_count=0),
    )
    assert r.decision is Decision.NO_DATA and r.score is None


def test_clean_air_scores_low_and_stays_normal():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=5.0), baseline=_ready_baseline(),
    )
    assert r.decision is Decision.NORMAL
    assert r.score is not None and r.score < 40


def test_high_sustained_exposure_reaches_high_band():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=140.0, above=3600.0, covered=3600.0),
        baseline=_ready_baseline(),
    )
    assert r.decision is Decision.HIGH
    assert Reason.PM25_ABOVE_ENV_HIGH in r.reason_codes


def test_symptom_history_cannot_promote_a_clean_environment():
    """Recorded symptoms have causes this system cannot observe — they never raise the band."""
    dense = [NOW - timedelta(hours=i) for i in range(1, 40)]
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=4.0), baseline=_ready_baseline(), symptom_times=dense,
    )
    assert r.decision is Decision.NORMAL


def test_history_raises_the_score_within_the_same_band():
    quiet = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=40.0, above=600.0), baseline=_ready_baseline(),
    )
    busy = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=40.0, above=600.0), baseline=_ready_baseline(),
        symptom_times=[NOW - timedelta(days=1), NOW - timedelta(days=2), NOW - timedelta(days=3)],
    )
    assert busy.score > quiet.score
    assert Reason.SYMPTOM_HISTORY_RECENT in busy.reason_codes


def test_exceeding_personal_baseline_is_reported():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=40.0), baseline=_ready_baseline(median=10.0, upper=20.0),
    )
    assert Reason.PM25_ABOVE_PERSONAL_BASELINE in r.reason_codes
    assert r.components["personal_baseline"] > 0


def test_unready_baseline_contributes_nothing_and_says_so():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=40.0), baseline=Baseline(ready=False, sample_count=3),
    )
    assert r.components["personal_baseline"] == 0
    assert Reason.BASELINE_INSUFFICIENT_SAMPLE in r.reason_codes


def test_stale_data_drops_confidence():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=9999,
        window=_window(mean=40.0), baseline=_ready_baseline(),
    )
    assert r.confidence is Confidence.LOW


def test_score_is_bounded_and_carries_sample_size():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=5000.0, above=3600.0, covered=3600.0, n=99),
        baseline=_ready_baseline(),
        symptom_times=[NOW - timedelta(hours=i) for i in range(1, 30)],
    )
    assert 0 <= r.score <= 100
    assert r.sample_size == 99


def test_note_is_non_diagnostic():
    r = compute_risk(
        now=NOW, usable=True, freshness_sec=10,
        window=_window(mean=40.0), baseline=_ready_baseline(),
    )
    assert "not a medical assessment" in r.note
    assert "safe" not in r.note.lower()
