"""End-to-end ingestion via FastAPI TestClient (writers mocked offline)."""
from __future__ import annotations

import json
from datetime import UTC, datetime

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
