"""The shared validation gate wires the two transports into §5.1 quality."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from ingestion.app.adapters import portable_to_reading
from ingestion.app.schemas import PortableTelemetry
from ingestion.app.validate import validate


def _portable(pm25, age_sec=5):
    ts = (datetime.now(UTC) - timedelta(seconds=age_sec)).isoformat()
    return portable_to_reading(PortableTelemetry(device_id="P001", timestamp=ts, pm25=pm25))


def test_fresh_valid_reading_is_usable():
    q = validate(_portable(12.0))
    assert q.usable and q.pm25_valid


def test_impossible_pm_is_not_usable():
    q = validate(_portable(9999.0))
    assert q.pm25_valid is False and q.usable is False
