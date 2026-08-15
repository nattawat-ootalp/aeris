"""InfluxDB field-building for a validated reading (pure — no network, no client created)."""
from __future__ import annotations

from datetime import UTC, datetime

from ingestion.app.writers import _fields
from intelligence.models import QualityResult, Reading


def _reading(**overrides) -> Reading:
    base = dict(
        device_id="P001",
        timestamp=datetime(2026, 8, 12, 12, 0, 0, tzinfo=UTC),
        pm25=12.0,
        temperature=30.0,
        humidity=60.0,
        battery=88,
        sensor_status="OK",
    )
    base.update(overrides)
    return Reading(**base)


def _quality(**overrides) -> QualityResult:
    base = dict(
        usable=True, pm25_valid=True, freshness_sec=5.0, fresh=True,
        quality_score=0.9, battery_low=False, reasons=[],
    )
    base.update(overrides)
    return QualityResult(**base)


def test_fields_includes_sgp30_when_present():
    f = _fields(_reading(tvoc=150.5, eco2=612.0), _quality())
    assert f["tvoc"] == 150.5
    assert f["eco2"] == 612.0


def test_fields_omits_sgp30_when_missing():
    # a missing/invalid SGP30 must never be fabricated as 0 in the time series
    f = _fields(_reading(tvoc=None, eco2=None), _quality())
    assert "tvoc" not in f
    assert "eco2" not in f
