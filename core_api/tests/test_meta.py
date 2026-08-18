"""Core-API smoke tests (expanded in the core-api task)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from core_api.app.main import app

client = TestClient(app)


def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "aeris-core-api"
    # Asserted by key rather than by whole-dict equality: /health also reports the state of
    # the Grafana shipper, and pinning the exact shape would make every future addition to
    # this endpoint a test failure rather than a decision.
    assert "observability" in body


def test_openapi_available():
    assert client.get("/openapi.json").status_code == 200


def test_ws_realtime_hello():
    with client.websocket_connect("/ws/realtime") as ws:
        assert ws.receive_json()["type"] == "hello"
