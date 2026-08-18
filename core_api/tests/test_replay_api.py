"""§4 time-machine endpoints, with InfluxDB mocked offline."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from core_api.app import repo, replay_api
from core_api.app.destination import NodeContext
from core_api.app.main import app

client = TestClient(app)

T0 = datetime(2026, 8, 18, 1, 0, tzinfo=UTC)
T1 = T0 + timedelta(hours=2)


def _aggregate(device_ids, start, end, fields, interval="60s"):
    """Two stations, one minute apart, with one deliberate hole in the second station."""
    times = [start + timedelta(minutes=i) for i in range(5)]
    return {
        "AQ001": {"pm2_5": [(t, 20.0 + i) for i, t in enumerate(times)]},
        # AQ002 stops after three windows: an outage must survive into the frames as absence.
        "AQ002": {"pm2_5": [(t, 40.0 + i) for i, t in enumerate(times[:3])]},
    }


def _nodes(now):
    return [
        NodeContext(node_code="AQ001", name="One", lat=12.24, lon=102.51, last_seen=now, pm25=20.0),
        NodeContext(node_code="AQ002", name="Two", lat=12.25, lon=102.52, last_seen=now, pm25=40.0),
    ]


def _offline(monkeypatch):
    monkeypatch.setattr(replay_api, "aggregate_between", _aggregate)
    monkeypatch.setattr(repo, "get_node_contexts", _nodes)


PARAMS = {"station_ids": "AQ001,AQ002", "start": T0.isoformat(), "end": T1.isoformat(),
          "parameters": "pm25", "interval": "1m"}


def test_frames_carry_every_station_that_recorded_in_the_window(monkeypatch):
    _offline(monkeypatch)
    body = client.get("/replay/data", params=PARAMS).json()
    assert body["frame_count"] == 5
    first = body["frames"][0]["stations"]
    assert first["AQ001"]["pm25"] == 20.0 and first["AQ002"]["pm25"] == 40.0


def test_a_station_that_recorded_nothing_is_absent_not_carried_forward(monkeypatch):
    # The rule the whole codebase turns on: a marker still showing a value through an outage
    # is indistinguishable from a station that is genuinely steady.
    _offline(monkeypatch)
    body = client.get("/replay/data", params=PARAMS).json()
    last = body["frames"][-1]["stations"]
    assert "AQ001" in last and "AQ002" not in last


def test_stats_summarise_each_station_over_the_window(monkeypatch):
    _offline(monkeypatch)
    stats = client.get("/replay/data", params=PARAMS).json()["stats"]
    assert stats["AQ001"]["pm25"]["minimum"] == 20.0
    assert stats["AQ001"]["pm25"]["maximum"] == 24.0
    assert stats["AQ002"]["pm25"]["samples"] == 3


def test_a_long_span_is_coarsened_and_says_so(monkeypatch):
    _offline(monkeypatch)
    long_span = {**PARAMS, "start": T0.isoformat(),
                 "end": (T0 + timedelta(days=25)).isoformat(), "interval": "10s"}
    body = client.get("/replay/data", params=long_span).json()
    # Coarsening silently would draw a smooth line over a spike the client asked to see.
    assert body["interval"] != "10s"
    assert body["interval_coarsened"] is True
    assert body["requested_interval"] == "10s"


def test_a_short_span_keeps_the_requested_resolution(monkeypatch):
    _offline(monkeypatch)
    body = client.get("/replay/data", params=PARAMS).json()
    assert body["interval"] == "1m" and body["interval_coarsened"] is False


def test_unknown_interval_is_rejected(monkeypatch):
    _offline(monkeypatch)
    r = client.get("/replay/data", params={**PARAMS, "interval": "7q"})
    assert r.status_code == 400


def test_unknown_parameter_is_rejected(monkeypatch):
    _offline(monkeypatch)
    r = client.get("/replay/data", params={**PARAMS, "parameters": "radon"})
    assert r.status_code == 400


def test_end_must_be_after_start(monkeypatch):
    _offline(monkeypatch)
    r = client.get("/replay/data",
                   params={**PARAMS, "start": T1.isoformat(), "end": T0.isoformat()})
    assert r.status_code == 400


def test_span_beyond_the_limit_is_refused(monkeypatch):
    _offline(monkeypatch)
    r = client.get("/replay/data", params={**PARAMS,
                                           "end": (T0 + timedelta(days=90)).isoformat()})
    assert r.status_code == 400


def test_compare_reports_difference_and_percentage(monkeypatch):
    def series(device_ids, start, end, fields):
        # 20 at the first instant, 30 at the second — a +50% change.
        value = 20.0 if start < T0 + timedelta(hours=1) else 30.0
        return {"AQ001": {"pm2_5": [(start, value)]}}

    monkeypatch.setattr(replay_api, "series_between", series)
    r = client.get("/replay/compare", params={
        "station_ids": "AQ001", "time_a": T0.isoformat(),
        "time_b": (T0 + timedelta(hours=2)).isoformat(), "parameter": "pm25"})
    assert r.status_code == 200
    row = r.json()["rows"][0]
    assert row["value_a"] == 20.0 and row["value_b"] == 30.0
    assert row["difference"] == 10.0 and row["percent_change"] == 50.0


def test_compare_says_no_data_rather_than_inventing_a_difference(monkeypatch):
    monkeypatch.setattr(replay_api, "series_between", lambda *a, **k: {})
    r = client.get("/replay/compare", params={
        "station_ids": "AQ001", "time_a": T0.isoformat(),
        "time_b": T1.isoformat(), "parameter": "pm25"})
    row = r.json()["rows"][0]
    assert row["status"] == "no_data" and row["difference"] is None


def test_csv_export_leaves_a_gap_empty_rather_than_zero(monkeypatch):
    _offline(monkeypatch)
    r = client.get("/replay/export.csv", params=PARAMS)
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    lines = r.text.strip().split("\n")
    assert lines[0] == "timestamp,station_id,pm25"
    # A zero written into an outage would be averaged by any spreadsheet that opened this.
    assert not any(line.endswith(",0") for line in lines[1:])
    assert sum(1 for line in lines if "AQ002" in line) == 3


def test_json_export_is_a_download(monkeypatch):
    _offline(monkeypatch)
    r = client.get("/replay/export.json", params=PARAMS)
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]


def test_station_list_reports_what_can_be_replayed(monkeypatch):
    _offline(monkeypatch)
    body = client.get("/replay/stations").json()
    assert [s["node_code"] for s in body["stations"]] == ["AQ001", "AQ002"]
    assert "1m" in body["intervals"]


def test_bookmarks_require_a_token():
    assert client.get("/replay/bookmarks").status_code in (401, 403)
    r = client.post("/replay/bookmarks", json={"timestamp": T0.isoformat(), "title": "Spike"})
    assert r.status_code in (401, 403)
