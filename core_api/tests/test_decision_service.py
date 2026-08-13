"""Decision service — composes quality/persistence/decision over recent readings."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from core_api.app.decision_service import evaluate_readings
from intelligence.models import Reading

NOW = datetime(2026, 8, 12, 12, 0, 0, tzinfo=UTC)


def _r(age_sec, pm25, status="OK"):
    return Reading(device_id="P001", timestamp=NOW - timedelta(seconds=age_sec),
                   pm25=pm25, temperature=30, humidity=60, battery=90, sensor_status=status)


def test_empty_is_no_data():
    assert evaluate_readings([], NOW)["decision"] == "NO_DATA"


def test_sustained_high_escalates():
    readings = [_r(90, 90), _r(60, 92), _r(30, 95), _r(5, 91)]  # sustained, latest fresh
    out = evaluate_readings(readings, NOW)
    assert out["decision"] == "HIGH"
    assert "PM25_ABOVE_ENV_HIGH" in out["reason_codes"]
    assert out["watch_label"] == "High"


def test_single_spike_does_not_escalate():
    readings = [_r(90, 10), _r(60, 11), _r(30, 9), _r(5, 300)]  # lone spike at the end
    out = evaluate_readings(readings, NOW)
    assert out["decision"] in ("NORMAL", "CAUTION")  # persistence filters the spike
    assert out["decision"] != "HIGH"


def test_invalid_latest_is_no_data():
    readings = [_r(60, 90), _r(30, 92), _r(5, None, status="ERROR")]
    out = evaluate_readings(readings, NOW)
    assert out["decision"] == "NO_DATA"


def test_stale_latest_is_no_data():
    readings = [_r(10000, 90), _r(9000, 92), _r(8000, 95)]  # all old
    out = evaluate_readings(readings, NOW)
    assert out["decision"] == "NO_DATA"
    assert out["watch_label"] == "No Data"
