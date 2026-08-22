"""§5.1 companion — uncalibrated RH correction for optical PM2.5, off by default."""
from math import isfinite

import pytest

from intelligence.humidity import (
    HumidityConfig,
    RhReason,
    correct_pm25_for_humidity,
    growth_factor,
)

OFF = HumidityConfig(enabled=False)
ON = HumidityConfig(enabled=True)


def test_default_config_is_disabled():
    # The correction has never been calibrated against a reference monitor: shipping it on
    # would be a false accuracy claim, so "off" is the default the repo must keep.
    assert HumidityConfig().enabled is False


def test_flag_off_is_exact_passthrough():
    r = correct_pm25_for_humidity(89.0, 60.0, cfg=OFF)
    assert r.applied is False
    assert r.corrected_pm25 == 89.0 == r.raw_pm25
    assert r.growth_factor == 1.0
    assert r.reason_codes == [RhReason.RH_CORRECTION_DISABLED]


def test_flag_off_never_touches_the_value_at_any_humidity():
    for rh in (0.0, 45.0, 70.0, 92.0, 99.9):
        assert correct_pm25_for_humidity(89.0, rh, cfg=OFF).corrected_pm25 == 89.0


def test_moderate_humidity_reduces_the_value_within_bounds():
    r = correct_pm25_for_humidity(89.0, 70.0, cfg=ON)
    assert r.applied is True
    assert RhReason.RH_CORRECTION_APPLIED in r.reason_codes
    assert 0 < r.corrected_pm25 < 89.0
    # bounded by max_reduction_frac (0.5 by default)
    assert r.corrected_pm25 >= 89.0 * 0.5
    assert r.growth_factor > 1.0


def test_higher_humidity_corrects_more():
    low = correct_pm25_for_humidity(89.0, 65.0, cfg=ON).corrected_pm25
    high = correct_pm25_for_humidity(89.0, 85.0, cfg=ON).corrected_pm25
    assert high < low < 89.0


def test_below_onset_returns_raw_with_reason():
    r = correct_pm25_for_humidity(89.0, 40.0, cfg=ON)
    assert r.applied is False
    assert r.corrected_pm25 == 89.0
    assert r.reason_codes == [RhReason.RH_BELOW_CORRECTION_ONSET]


def test_very_high_humidity_is_clamped_not_divergent():
    r = correct_pm25_for_humidity(89.0, 99.5, cfg=ON)
    assert RhReason.RH_CLAMPED_HIGH in r.reason_codes
    assert r.humidity_used_pct == ON.rh_clamp
    assert isfinite(r.corrected_pm25)
    # the ceiling on total movement still holds at saturation
    assert r.corrected_pm25 >= 89.0 * (1 - ON.max_reduction_frac)
    assert RhReason.RH_CORRECTION_BOUNDED in r.reason_codes


def test_missing_humidity_is_not_guessed():
    r = correct_pm25_for_humidity(89.0, None, cfg=ON)
    assert r.applied is False
    assert r.corrected_pm25 == 89.0
    assert r.reason_codes == [RhReason.RH_MISSING]


@pytest.mark.parametrize("rh", [-1.0, 101.0, 500.0])
def test_out_of_range_humidity_returns_raw_with_reason(rh):
    r = correct_pm25_for_humidity(89.0, rh, cfg=ON)
    assert r.applied is False
    assert r.corrected_pm25 == 89.0
    assert r.reason_codes == [RhReason.RH_OUT_OF_RANGE]


def test_stale_humidity_returns_raw_with_reason():
    r = correct_pm25_for_humidity(89.0, 80.0, humidity_age_sec=3600, cfg=ON)
    assert r.applied is False
    assert r.corrected_pm25 == 89.0
    assert r.reason_codes == [RhReason.RH_STALE]


def test_missing_pm_is_never_invented():
    r = correct_pm25_for_humidity(None, 80.0, cfg=ON)
    assert r.applied is False
    assert r.corrected_pm25 is None
    assert r.reason_codes == [RhReason.PM25_MISSING]


def test_raw_value_is_always_recoverable():
    for rh in (62.0, 70.0, 80.0, 90.0, 99.0):
        r = correct_pm25_for_humidity(89.0, rh, cfg=ON)
        assert r.raw_pm25 == 89.0
        assert r.corrected_pm25 * r.growth_factor == pytest.approx(89.0, rel=1e-3)
        assert r.kappa == ON.kappa
        assert r.humidity_pct == rh


def test_correction_is_never_negative_or_non_finite():
    for pm in (0.0, 0.4, 12.0, 999.0):
        for rh in (60.0, 75.0, 94.9, 95.0, 99.99, 100.0):
            r = correct_pm25_for_humidity(pm, rh, cfg=ON)
            assert r.corrected_pm25 >= 0
            assert isfinite(r.corrected_pm25)
            assert isfinite(r.growth_factor)
            assert r.corrected_pm25 <= pm


def test_growth_factor_is_monotonic_and_at_least_one():
    assert growth_factor(0.0, 0.25) == 1.0
    assert growth_factor(100.0, 0.25) > 1.0 and isfinite(growth_factor(100.0, 0.25))
    assert growth_factor(80.0, 0.25) > growth_factor(60.0, 0.25)


def test_payload_carries_everything_needed_to_undo_the_correction():
    payload = correct_pm25_for_humidity(89.0, 70.0, cfg=ON).to_payload()
    for key in (
        "enabled", "applied", "raw_pm25", "corrected_pm25", "humidity_pct",
        "humidity_used_pct", "growth_factor", "kappa", "reason_codes", "note",
    ):
        assert key in payload
    # the note must keep saying this is uncalibrated and makes no medical claim
    assert "uncalibrated" in payload["note"]
    assert "no medical claim" in payload["note"]


def test_env_var_toggles_the_flag(monkeypatch):
    monkeypatch.setenv("PM25_RH_CORRECTION_ENABLED", "true")
    assert HumidityConfig().enabled is True
    monkeypatch.setenv("PM25_RH_CORRECTION_ENABLED", "false")
    assert HumidityConfig().enabled is False


def test_kappa_is_env_configurable(monkeypatch):
    monkeypatch.setenv("PM25_RH_KAPPA", "0.4")
    cfg = HumidityConfig(enabled=True)
    assert cfg.kappa == 0.4
    stronger = correct_pm25_for_humidity(50.0, 70.0, cfg=cfg).corrected_pm25
    assert stronger < correct_pm25_for_humidity(50.0, 70.0, cfg=ON).corrected_pm25
