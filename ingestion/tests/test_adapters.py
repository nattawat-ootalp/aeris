"""Transport adapters normalize both payloads to one Reading (parser boundary)."""
from __future__ import annotations

from ingestion.app.adapters import portable_to_reading, station_to_reading
from ingestion.app.schemas import PortableTelemetry, StationTelemetry


def test_station_maps_sensor_keys():
    s = StationTelemetry(
        org="airsen", node_id="BKK-TRT-003", timestamp="2026-08-12T12:00:00Z",
        sensors={"pm2_5": 34.2, "temp": 31.2, "hum": 71.4},
        device_health={"battery_pct": 82, "rssi": -50, "uptime_sec": 1, "fw_version": "1.0.0"},
    )
    r = station_to_reading(s)
    assert r.device_id == "BKK-TRT-003"
    assert r.pm25 == 34.2 and r.temperature == 31.2 and r.humidity == 71.4
    assert r.battery == 82 and r.sensor_status == "OK"


def test_station_missing_pm_flags_error():
    s = StationTelemetry(org="airsen", node_id="N1", timestamp="2026-08-12T12:00:00Z", sensors={})
    r = station_to_reading(s)
    assert r.pm25 is None and r.sensor_status == "ERROR"  # never fabricate a value


def test_station_accepts_object_style_sensor_value():
    s = StationTelemetry(
        org="airsen", node_id="N1", timestamp="2026-08-12T12:00:00Z",
        sensors={"pm2_5": {"value": 20.0, "unit": "ug/m3", "status": "ok"}},
    )
    assert station_to_reading(s).pm25 == 20.0


def test_portable_maps_flat_contract():
    p = PortableTelemetry(
        device_id="P001", timestamp="2026-08-12T12:00:00Z",
        pm25=12.0, temperature=30.0, humidity=60.0, battery=88, sensor_status="OK",
    )
    r = portable_to_reading(p)
    assert r.device_id == "P001" and r.pm25 == 12.0 and r.battery == 88


def test_portable_maps_sgp30_fields():
    p = PortableTelemetry(
        device_id="P001", timestamp="2026-08-12T12:00:00Z",
        pm25=12.0, tvoc=150.5, eco2=612,
    )
    r = portable_to_reading(p)
    assert r.tvoc == 150.5 and r.eco2 == 612.0


def test_portable_absent_sgp30_is_none():
    p = PortableTelemetry(device_id="P001", timestamp="2026-08-12T12:00:00Z", pm25=12.0)
    r = portable_to_reading(p)
    assert r.tvoc is None and r.eco2 is None


def test_station_maps_tvoc():
    s = StationTelemetry(
        org="airsen", node_id="BKK-TRT-003", timestamp="2026-08-12T12:00:00Z",
        sensors={"pm2_5": 34.2, "tvoc": 120},
    )
    r = station_to_reading(s)
    assert r.tvoc == 120.0


def test_station_maps_tvoc_object_style():
    s = StationTelemetry(
        org="airsen", node_id="N1", timestamp="2026-08-12T12:00:00Z",
        sensors={"pm2_5": 20.0, "tvoc": {"value": 88.0, "unit": "ppb", "status": "ok"}},
    )
    r = station_to_reading(s)
    assert r.tvoc == 88.0


def test_station_has_no_eco2():
    # a station's own "co2" sensor (if any) is a REAL CO2 measurement (SCD40) and must never
    # be relabelled as the SGP30's VOC-derived eco2 estimate.
    s = StationTelemetry(
        org="airsen", node_id="N1", timestamp="2026-08-12T12:00:00Z",
        sensors={"pm2_5": 20.0, "co2": 450.0},
    )
    r = station_to_reading(s)
    assert r.eco2 is None
