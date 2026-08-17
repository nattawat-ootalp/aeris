"""End-to-end ingestion via FastAPI TestClient (writers mocked offline)."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from ingestion.app import writers
from ingestion.app.hmac_util import settings, sign


def _now_iso():
    return datetime.now(UTC).isoformat()


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_portable_valid_is_accepted_and_stored(client, offline):
    r = client.post("/ingest/portable", json={
        "device_id": "P001", "timestamp": _now_iso(),
        "pm25": 12.0, "temperature": 30.0, "humidity": 60.0, "battery": 88, "sensor_status": "OK",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["accepted"] and body["pm25_valid"] and body["usable"]
    assert len(offline["write_reading"]) == 1  # persisted once


def test_portable_invalid_pm_stored_but_flagged_no_caution(client, offline):
    # invalid PM must be accepted (recorded) but flagged — never a usable/caution basis
    r = client.post("/ingest/portable", json={
        "device_id": "P001", "timestamp": _now_iso(), "pm25": 9999.0,
    })
    body = r.json()
    assert body["accepted"] is True
    assert body["pm25_valid"] is False and body["usable"] is False


def test_portable_accepts_sgp30_fields_end_to_end(client, offline):
    r = client.post("/ingest/portable", json={
        "device_id": "P001", "timestamp": _now_iso(),
        "pm25": 12.0, "tvoc": 150.5, "eco2": 612, "sensor_status": "OK",
    })
    body = r.json()
    assert body["accepted"] and body["pm25_valid"] and body["usable"]


def test_portable_bad_sgp30_does_not_break_pm(client, offline):
    # an implausible SGP30 value must never make an otherwise-good PM reading unusable
    r = client.post("/ingest/portable", json={
        "device_id": "P001", "timestamp": _now_iso(),
        "pm25": 12.0, "tvoc": 99999, "sensor_status": "OK",
    })
    body = r.json()
    assert body["accepted"] and body["pm25_valid"] and body["usable"]


def test_station_webhook_requires_valid_signature(client, monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_SECRET", "s3cret")
    payload = {
        "org": "airsen", "node_id": "BKK-TRT-003", "timestamp": _now_iso(),
        "sensors": {"pm2_5": 20.0, "temp": 31.0, "hum": 70.0},
        "device_health": {"battery_pct": 80, "rssi": -55, "uptime_sec": 10, "fw_version": "1.0.0"},
    }
    raw = json.dumps(payload)

    good = client.post("/webhook/telemetry", content=raw,
                       headers={"X-Signature": sign(raw.encode(), "s3cret")})
    assert good.json()["accepted"] is True

    bad = client.post("/webhook/telemetry", content=raw, headers={"X-Signature": "bad"})
    assert bad.json()["accepted"] is False


def test_station_epoch_timestamp_is_rejected_not_stored(client, offline, monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_SECRET", "s3cret")
    # firmware emits 1970-01-01 until NTP answers; InfluxDB refuses a point that old, which
    # used to surface as a bare 500 and lost the reading with no explanation
    payload = {
        "org": "airsen", "node_id": "BKK-TRT-003", "timestamp": "1970-01-01T00:00:00+07:00",
        "sensors": {"pm2_5": 2.0, "temp": 31.0, "hum": 40.9, "co2": 909.0},
        "device_health": {"battery_pct": 100, "rssi": -60, "uptime_sec": 300, "fw_version": "1.4.2"},
    }
    raw = json.dumps(payload)
    r = client.post("/webhook/telemetry", content=raw,
                    headers={"X-Signature": sign(raw.encode(), "s3cret")})
    assert r.status_code == 200
    body = r.json()
    assert body["accepted"] is False and body["error"] == "CLOCK_UNSYNCED"
    assert offline["write_reading"] == []  # nothing stored under a fabricated time


def test_portable_far_future_timestamp_is_rejected(client, offline):
    future = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    r = client.post("/ingest/portable", json={
        "device_id": "P001", "timestamp": future, "pm25": 10.0,
    })
    assert r.json()["error"] == "CLOCK_UNSYNCED"
    assert offline["write_reading"] == []


def test_store_failure_is_reported_instead_of_500(client, monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("influx rejected the write")

    monkeypatch.setattr(writers, "write_reading", _boom)
    r = client.post("/ingest/portable", json={
        "device_id": "P001", "timestamp": _now_iso(), "pm25": 10.0,
    })
    assert r.status_code == 200
    assert r.json() == {
        "accepted": False, "device_id": "P001", "source": "portable",
        "error": "STORE_FAILED", "reasons": ["STORE_FAILED"],
    }
