"""§10.1 parser / unit conversion."""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from intelligence.parsing import (
    absolute_humidity,
    c_to_f,
    parse_reading,
    parse_timestamp,
)


def test_parse_timestamp_z_suffix():
    dt = parse_timestamp("2026-08-11T14:30:00Z")
    assert dt == datetime(2026, 8, 11, 14, 30, tzinfo=UTC)
    assert dt.tzinfo is not None


def test_parse_timestamp_offset_and_naive():
    assert parse_timestamp("2026-08-11T14:30:00+07:00").hour == 7  # normalized to UTC
    assert parse_timestamp("2026-08-11T14:30:00").tzinfo == UTC  # naive -> UTC


def test_parse_timestamp_datetime_passthrough():
    src = datetime(2026, 8, 11, 14, 30, tzinfo=UTC)
    assert parse_timestamp(src) == src


def test_parse_reading_full_contract():
    r = parse_reading({
        "schema_version": "1.0", "device_id": "P001",
        "timestamp": "2026-08-11T14:30:00Z", "pm25": 34.2,
        "temperature": 31.2, "humidity": 71.4, "battery": 82,
        "sensor_status": "OK", "quality_score": 0.96,
    })
    assert r.device_id == "P001"
    assert r.pm25 == 34.2 and r.battery == 82 and r.quality_score == 0.96


def test_parse_reading_missing_values_become_none_not_zero():
    # a dropped field must NOT silently become 0 (that would defeat §5.1 gating)
    r = parse_reading({"device_id": "P001", "timestamp": "2026-08-11T14:30:00Z"})
    assert r.pm25 is None and r.temperature is None and r.battery is None


def test_parse_reading_requires_device_id():
    with pytest.raises(ValueError):
        parse_reading({"timestamp": "2026-08-11T14:30:00Z"})


def test_unit_conversions():
    assert c_to_f(0) == 32.0
    assert c_to_f(100) == 212.0
    # absolute humidity is positive and rises with temperature at fixed RH
    assert absolute_humidity(31, 70) > 0
    assert absolute_humidity(31, 70) > absolute_humidity(20, 70)
