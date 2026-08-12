"""§5.2 environmental state — threshold classification (NOT medical)."""
from __future__ import annotations

from intelligence.environmental import classify_env
from intelligence.models import EnvState, Reason


def test_normal_below_caution():
    state, reasons = classify_env(10.0)
    assert state == EnvState.NORMAL
    assert reasons == [Reason.ENV_NORMAL]


def test_caution_at_threshold():
    state, reasons = classify_env(37.5)
    assert state == EnvState.CAUTION
    assert Reason.PM25_ABOVE_ENV_CAUTION in reasons


def test_high_at_threshold():
    state, reasons = classify_env(75.0)
    assert state == EnvState.HIGH
    assert Reason.PM25_ABOVE_ENV_HIGH in reasons
    assert Reason.PM25_ABOVE_ENV_CAUTION in reasons


def test_none_pm_yields_no_state():
    # missing PM must not be classified as NORMAL/safe
    state, reasons = classify_env(None)
    assert state is None
    assert reasons == []
