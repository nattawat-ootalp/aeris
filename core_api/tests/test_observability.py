"""Monitoring must never be able to break what it is monitoring."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
from fastapi.testclient import TestClient

import observability
from core_api.app import monitor_api, repo
from core_api.app.destination import NodeContext
from core_api.app.main import app

client = TestClient(app)


def _configure(monkeypatch) -> list:
    """Turn shipping on and capture what would have been sent, without a network."""
    sent: list = []
    monkeypatch.setattr(observability, "LOKI_URL", "https://loki.example/push")
    monkeypatch.setattr(observability, "LOKI_USER", "1234")
    monkeypatch.setattr(observability, "GRAPHITE_URL", "https://graphite.example/metrics")
    monkeypatch.setattr(observability, "GRAPHITE_USER", "5678")
    monkeypatch.setattr(observability, "API_TOKEN", "token")

    class FakeClient:
        def post(self, url, **kwargs):
            sent.append((url, kwargs))
            return httpx.Response(200, request=httpx.Request("POST", url))

        def close(self):
            pass

    monkeypatch.setattr(observability._shipper, "_http", FakeClient())
    return sent


def test_disabled_by_default_and_makes_no_calls(monkeypatch):
    monkeypatch.setattr(observability, "GRAPHITE_URL", "")
    monkeypatch.setattr(observability, "LOKI_URL", "")
    # A missing config must degrade to local logging, never to a crash on the first request:
    # a deploy that forgot its credentials should still serve traffic.
    assert observability.enabled() is False
    observability.metric("test.metric", 1)
    observability.flush()


def test_metric_is_shipped_as_a_graphite_line_with_tags(monkeypatch):
    sent = _configure(monkeypatch)
    observability.metric("station.reading_age_sec", 42.5, {"device": "BKK-TRT-003"})
    observability.flush()
    urls = [u for u, _ in sent]
    assert "https://graphite.example/metrics" in urls
    body = next(k["content"].decode() for u, k in sent if "graphite" in u)
    assert "station.reading_age_sec;device=BKK-TRT-003 42.5" in body


def test_metric_path_segments_cannot_split_the_metric(monkeypatch):
    sent = _configure(monkeypatch)
    # A dot inside a tag value would split the Graphite path and silently create a different
    # metric — device ids are BLE MAC addresses and UUIDs, which contain both dots and colons.
    observability.metric("reading.pm25", 3.0, {"device": "14:C1:9F:C1:25:F5"})
    observability.flush()
    body = next(k["content"].decode() for u, k in sent if "graphite" in u)
    assert "device=14_C1_9F_C1_25_F5" in body


def test_a_failing_endpoint_is_counted_not_raised(monkeypatch):
    _configure(monkeypatch)

    class Broken:
        def post(self, url, **kwargs):
            raise httpx.ConnectError("no route to host")

        def close(self):
            pass

    monkeypatch.setattr(observability._shipper, "_http", Broken())
    before = observability._shipper.failures
    observability.metric("test.metric", 1)
    observability.flush()          # must not raise
    assert observability._shipper.failures > before


def test_health_reports_whether_shipping_is_on():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    # Present whether or not it is configured: monitoring that has silently stopped shipping
    # looks exactly like a system with nothing to report.
    assert "logs" in body["observability"] and "push_failures" in body["observability"]


def _nodes(now):
    return [
        NodeContext(node_code="BKK-TRT-003", name="Real", lat=12.24, lon=102.51,
                    last_seen=now - timedelta(seconds=30), pm25=20.0),
        NodeContext(node_code="BKK-TRT-009", name="Quiet", lat=12.25, lon=102.52,
                    last_seen=now - timedelta(hours=3), pm25=20.0),
        NodeContext(node_code="DEMO-TRT-PARK", name="Demo", lat=12.23, lon=102.50,
                    last_seen=now - timedelta(days=2), pm25=11.0),
        NodeContext(node_code="BKK-TRT-001", name="Retired", lat=12.26, lon=102.53,
                    last_seen=None, pm25=None, sensor_healthy=False),
    ]


def test_monitor_counts_only_active_real_stations_as_silent(monkeypatch):
    monkeypatch.setattr(repo, "get_node_contexts", _nodes)
    body = client.get("/monitor/stations").json()
    assert body["registered"] == 4
    # Only BKK-TRT-009: the demo node is backfilled and always stale by design, and the
    # retired one is marked inactive. An alert that fires for those trains people to ignore it.
    assert body["silent"] == 1
    by_code = {s["node_code"]: s for s in body["stations"]}
    assert by_code["BKK-TRT-003"]["silent"] is False
    assert by_code["BKK-TRT-009"]["silent"] is True
    assert by_code["DEMO-TRT-PARK"]["demo"] is True


def test_a_station_that_never_reported_is_not_reported_as_fresh(monkeypatch):
    monkeypatch.setattr(repo, "get_node_contexts", _nodes)
    row = next(s for s in client.get("/monitor/stations").json()["stations"]
               if s["node_code"] == "BKK-TRT-001")
    # age 0 would read on a dashboard as a station that just checked in.
    assert row["reading_age_sec"] is None and row["silent"] is True


def test_silence_window_is_adjustable(monkeypatch):
    monkeypatch.setattr(repo, "get_node_contexts", _nodes)
    body = client.get("/monitor/stations", params={"silent_after_s": 4 * 3600}).json()
    assert body["silent"] == 0        # three hours is within a four-hour window


def test_monitor_emits_station_metrics(monkeypatch):
    sent = _configure(monkeypatch)
    monkeypatch.setattr(repo, "get_node_contexts", _nodes)
    monkeypatch.setattr(monitor_api.observability, "_shipper", observability._shipper)
    client.get("/monitor/stations")
    body = "".join(k["content"].decode() for u, k in sent if "graphite" in u)
    assert "station.reading_age_sec" in body
    assert "station.silent_total" in body
