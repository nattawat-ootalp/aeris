"""Shared fixtures/helpers for intelligence tests."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from intelligence.models import Reading

NOW = datetime(2026, 8, 12, 12, 0, 0, tzinfo=UTC)


@pytest.fixture
def now():
    return NOW


def make_reading(
    *,
    age_sec: float = 0.0,
    pm25=12.0,
    temperature=31.0,
    humidity=70.0,
    battery=90,
    sensor_status="OK",
    quality_score=None,
    device_id="P001",
    base: datetime = NOW,
    tvoc=None,
    eco2=None,
) -> Reading:
    """Reading whose timestamp is ``age_sec`` before ``base`` (default NOW)."""
    return Reading(
        device_id=device_id,
        timestamp=base - timedelta(seconds=age_sec),
        pm25=pm25,
        temperature=temperature,
        humidity=humidity,
        battery=battery,
        sensor_status=sensor_status,
        quality_score=quality_score,
        tvoc=tvoc,
        eco2=eco2,
    )
