"""Core-API endpoints with the data layer (repo) mocked offline."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from core_api.app import repo
from core_api.app.destination import NodeContext
from core_api.app.main import app
from core_api.app.security import create_token
from intelligence.models import Reading

client = TestClient(app)


def test_destination_assess_ok(monkeypatch):
    def fake_nodes(now):
        return [NodeContext(node_code="BKK-TRT-003", lat=13.7563, lon=100.5018,
                            last_seen=now - timedelta(seconds=30), pm25=80.0)]
    monkeypatch.setattr(repo, "get_node_contexts", fake_nodes)
    r = client.get("/destination/assess", params={"lat": 13.7563, "lon": 100.5018})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["decision"] == "HIGH"
    assert body["watch_label"] == "High"


def test_device_decision(monkeypatch):
    now = datetime.now(UTC)
    readings = [Reading(device_id="P001", timestamp=now - timedelta(seconds=s),
                        pm25=90, temperature=30, humidity=60, battery=90) for s in (90, 60, 30, 5)]
    monkeypatch.setattr(repo, "get_recent_readings", lambda d, hours=6: readings)
    monkeypatch.setattr(repo, "get_baseline_values", lambda d, days=14: [])
    r = client.get("/devices/P001/decision")
    assert r.status_code == 200
    assert r.json()["reason_codes"]  # always explains itself
    assert "SAFE" not in r.json()["watch_label"].upper()


def test_ranking_only_fresh_valid_nodes(monkeypatch):
    now = datetime.now(UTC)
    nodes = [
        NodeContext(node_code="A", lat=0, lon=0, last_seen=now - timedelta(seconds=30), pm25=80.0),
        NodeContext(node_code="B", lat=0, lon=0, last_seen=now - timedelta(seconds=30), pm25=40.0),
        NodeContext(node_code="STALE", lat=0, lon=0, last_seen=now - timedelta(days=9), pm25=999.0),
        NodeContext(node_code="NODATA", lat=0, lon=0, last_seen=now, pm25=None),
    ]
    monkeypatch.setattr(repo, "get_node_contexts", lambda n: nodes)
    r = client.get("/dashboard/ranking")
    ranking = r.json()["ranking"]
    codes = [x["node_code"] for x in ranking]
    assert codes == ["A", "B"]  # stale + no-data excluded, sorted worst-first


def test_threshold_requires_auth(monkeypatch):
    monkeypatch.setattr(repo, "set_threshold", lambda c, p: [{}])
    assert client.post("/nodes/N1/threshold", json={"sensor": "pm2_5", "level": "caution", "threshold_val": 37.5}).status_code == 401
    tok = create_token("admin")
    r = client.post("/nodes/N1/threshold", json={"sensor": "pm2_5", "level": "caution", "threshold_val": 37.5},
                    headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json()["updated"] is True


def test_symptom_requires_auth(monkeypatch):
    monkeypatch.setattr(repo, "store_symptom", lambda sub, p: [{"id": "x"}])
    # no token -> 401
    assert client.post("/symptoms", json={"severity": "mild"}).status_code == 401
    # with token -> stored
    tok = create_token("user-123")
    r = client.post("/symptoms", json={"severity": "mild"}, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200 and r.json()["stored"] is True


def test_symptom_mapping(monkeypatch):
    captured_payloads = []
    monkeypatch.setattr(repo, "store_symptom", lambda sub, p: captured_payloads.append((sub, p)) or [{"id": "x"}])
    tok = create_token("user-456")

    # Test with multiple symptoms, started_at, and moderate severity
    json_data = {
        "symptoms": ["cough", "wheeze"],
        "severity": "moderate",
        "started_at": "2026-08-14T09:22:31.000Z",
        "note": "Felt bad after run"
    }
    r = client.post("/symptoms", json=json_data, headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert len(captured_payloads) == 1
    sub, payload = captured_payloads[0]
    assert sub == "user-456"
    assert isinstance(payload, list)
    assert len(payload) == 2

    # Check cough symptom mapping
    assert payload[0]["symptom_type"] == "cough"
    assert payload[0]["severity"] == 5
    assert payload[0]["occurred_at"] == "2026-08-14T09:22:31.000Z"
    assert payload[0]["note"] == "Felt bad after run"

    # Check wheeze symptom mapping
    assert payload[1]["symptom_type"] == "wheeze"
    assert payload[1]["severity"] == 5
    assert payload[1]["occurred_at"] == "2026-08-14T09:22:31.000Z"
    assert payload[1]["note"] == "Felt bad after run"
