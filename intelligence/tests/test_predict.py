"""§5.10 predictive alert — short-horizon PM2.5 projection with an honest uncertainty band."""
from datetime import UTC, datetime, timedelta

from intelligence.models import Confidence, Decision, Reason
from intelligence.predict import forecast_pm25

NOW = datetime(2026, 8, 15, 20, 0, tzinfo=UTC)


def _series(values, step_sec=60, end=NOW):
    """Evenly spaced samples ending at `end` (oldest first)."""
    n = len(values)
    return [(end - timedelta(seconds=step_sec * (n - 1 - i)), v) for i, v in enumerate(values)]


def test_too_few_samples_is_unavailable_not_a_guess():
    f = forecast_pm25(_series([10, 12, 14]), now=NOW)
    assert f.available is False
    assert f.projected_pm25 is None
    assert Reason.FORECAST_INSUFFICIENT_DATA in f.reason_codes


def test_stale_tail_is_rejected():
    old = NOW - timedelta(hours=3)
    f = forecast_pm25(_series([10, 12, 14, 16, 18, 20], end=old), now=NOW)
    assert f.available is False
    # The window filter runs before the staleness check, so either reason is a correct refusal.
    assert {Reason.DATA_STALE, Reason.FORECAST_INSUFFICIENT_DATA} & set(f.reason_codes)


def test_gap_in_the_middle_is_rejected():
    pts = _series([10, 12, 14, 16, 18, 20], step_sec=60)
    # push the oldest point far back, leaving a hole larger than exposure_max_gap_sec
    pts[0] = (pts[0][0] - timedelta(seconds=1200), pts[0][1])
    f = forecast_pm25(pts, now=NOW)
    assert f.available is False
    assert Reason.FORECAST_COVERAGE_GAP in f.reason_codes


def test_rising_trend_projects_upward_and_is_flagged_rising():
    f = forecast_pm25(_series([10, 20, 30, 40, 50, 60, 70, 80]), now=NOW)
    assert f.available is True
    assert f.projected_pm25 > 80
    assert f.trend_per_hour > 0
    assert Reason.FORECAST_RISING in f.reason_codes


def test_steady_series_is_flagged_steady():
    f = forecast_pm25(_series([20, 20, 20, 20, 20, 20, 20]), now=NOW)
    assert Reason.FORECAST_STEADY in f.reason_codes
    assert abs(f.trend_per_hour) < 5


def test_projection_never_goes_negative():
    f = forecast_pm25(_series([90, 70, 50, 30, 15, 5, 1]), now=NOW)
    assert f.projected_pm25 >= 0


def test_band_follows_the_projected_value():
    f = forecast_pm25(_series([40, 50, 60, 70, 80, 90, 100, 110]), now=NOW)
    assert f.decision is Decision.HIGH
    assert Reason.PM25_ABOVE_ENV_HIGH in f.reason_codes


def test_noisy_series_widens_uncertainty_and_lowers_confidence():
    clean = forecast_pm25(_series([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]), now=NOW)
    noisy = forecast_pm25(_series([10, 90, 20, 85, 30, 95, 25, 80, 35, 100, 15, 88]), now=NOW)
    assert noisy.uncertainty > clean.uncertainty
    assert noisy.confidence is not Confidence.HIGH


def test_horizon_is_reported_and_respected():
    f = forecast_pm25(_series([10, 20, 30, 40, 50, 60]), now=NOW, horizon_sec=900)
    assert f.horizon_sec == 900
    far = forecast_pm25(_series([10, 20, 30, 40, 50, 60]), now=NOW, horizon_sec=1800)
    assert far.projected_pm25 > f.projected_pm25


def test_note_is_environmental_only():
    f = forecast_pm25(_series([10, 20, 30, 40, 50, 60]), now=NOW)
    assert "not a prediction of symptoms" in f.note
    assert "safe" not in f.note.lower()


def test_a_gap_early_in_the_window_does_not_discard_the_continuous_run_after_it():
    """A device that rebooted an hour ago still has a perfectly good recent series. Refusing
    the whole window because of that hole throws away exactly the data that describes now."""
    recent = _series([10, 12, 14, 16, 18, 20, 22, 24], step_sec=60)
    stale = [(NOW - timedelta(minutes=50), 90.0), (NOW - timedelta(minutes=48), 95.0)]
    f = forecast_pm25(stale + recent, now=NOW)
    assert f.available is True
    assert f.sample_size == len(recent)          # only the run after the gap is used
    assert Reason.FORECAST_RISING in f.reason_codes


def test_the_run_after_a_gap_must_still_be_long_enough():
    older = [(NOW - timedelta(minutes=50 - i), 20.0) for i in range(8)]
    tail = _series([30, 31, 32], step_sec=60)     # only 3 samples after the hole
    f = forecast_pm25(older + tail, now=NOW)
    assert f.available is False
    assert Reason.FORECAST_COVERAGE_GAP in f.reason_codes
