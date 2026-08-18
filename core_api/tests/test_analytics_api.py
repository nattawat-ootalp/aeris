"""Derived-analytics endpoints (timeline / summary / weekly / quality / baseline / pattern)
and the privacy + device-registry surface, with the data layer mocked offline."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from core_api.app import analytics, repo
from core_api.app.destination import NodeContext
from core_api.app.main import app
from core_api.app.security import create_token
from intelligence.config import CONFIG
from intelligence.models import Reading

client = TestClient(app)
AUTH = {"Authorization": f"Bearer {create_token('user-1')}"}


def _readings(now: datetime, *, minutes: int = 120) -> list[Reading]:
    """Two hours at one sample/minute: clean, then caution, then high, then clean again."""
    out = []
    for i in range(minutes):
        if i < 40:
            pm = 20.0
        elif i < 70:
            pm = 55.0
        elif i < 85:
            pm = 90.0
        else:
            pm = 15.0
        out.append(
            Reading(
                device_id="P001",
                timestamp=now - timedelta(minutes=minutes - i),
                pm25=pm,
                temperature=31.0,
                humidity=70.0,
                battery=80,
                sensor_status="OK",
            )
        )
    return out


def _mock_readings(monkeypatch, readings):
    monkeypatch.setattr(repo, "get_recent_readings", lambda d, hours=6: readings)


# ── analytics (pure) ─────────────────────────────────────────────────────────
def test_single_sample_is_not_inflated_into_exposure():
    now = datetime.now(UTC)
    one = [Reading(device_id="P001", timestamp=now, pm25=200.0, sensor_status="OK")]
    summary = analytics.daily_summary(one, 0)
    assert summary["tracked_sec"] == 0
    assert summary["elevated_sec"] == 0
    assert summary["highest_exposure_start"] is None


def test_timeline_splits_on_level_change_and_gaps():
    now = datetime.now(UTC)
    segments = analytics.timeline(_readings(now))
    assert [s["level"] for s in segments] == ["Normal", "High", "Caution", "Normal"]

    # a gap wider than the max interpolation gap must break a run of the same level
    gapped = [
        Reading(device_id="P001", timestamp=now - timedelta(minutes=m), pm25=10.0, sensor_status="OK")
        for m in (60, 59, 58, 5, 4, 3)
    ]
    assert len(analytics.timeline(gapped)) == 2


def test_invalid_pm_readings_are_excluded():
    now = datetime.now(UTC)
    readings = [
        Reading(device_id="P001", timestamp=now - timedelta(minutes=3), pm25=None, sensor_status="ERROR"),
        Reading(device_id="P001", timestamp=now - timedelta(minutes=2), pm25=40.0, sensor_status="WARMUP"),
        Reading(device_id="P001", timestamp=now - timedelta(minutes=1), pm25=40.0, sensor_status="OK"),
    ]
    assert len(analytics.valid_points(readings)) == 1


def test_weekly_leaves_empty_days_null():
    now = datetime.now(UTC)
    week = analytics.weekly(_readings(now), now)
    assert len(week["days"]) == 7
    assert week["days"][0]["mean_pm25"] is None  # six days ago: no readings, not zero
    assert week["days"][-1]["mean_pm25"] is not None


# ── endpoints ────────────────────────────────────────────────────────────────
def test_daily_summary_requires_auth(monkeypatch):
    now = datetime.now(UTC)
    _mock_readings(monkeypatch, _readings(now))
    monkeypatch.setattr(repo, "get_symptoms", lambda sub, since: [])
    assert client.get("/devices/P001/daily-summary").status_code == 401

    r = client.get("/devices/P001/daily-summary", headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["tracked_sec"] > 0
    assert body["high_sec"] > 0
    assert body["highest_exposure_start"] is not None


def test_daily_summary_counts_one_event_per_instant(monkeypatch):
    now = datetime.now(UTC)
    _mock_readings(monkeypatch, _readings(now))
    # one save of two symptoms writes two rows sharing an occurred_at
    rows = [
        {"occurred_at": "2026-08-15T09:00:00+00:00", "symptom_type": "cough"},
        {"occurred_at": "2026-08-15T09:00:00+00:00", "symptom_type": "wheeze"},
        {"occurred_at": "2026-08-15T14:00:00+00:00", "symptom_type": "cough"},
    ]
    monkeypatch.setattr(repo, "get_symptoms", lambda sub, since: rows)
    assert client.get("/devices/P001/daily-summary", headers=AUTH).json()["symptom_events"] == 2


def test_timeline_and_event_detail_roundtrip(monkeypatch):
    now = datetime.now(UTC)
    _mock_readings(monkeypatch, _readings(now))
    events = client.get("/devices/P001/exposure-timeline").json()["events"]
    assert events

    detail = client.get(f"/devices/P001/exposure-timeline/{events[0]['id']}")
    assert detail.status_code == 200
    assert detail.json()["temperature_avg"] == 31.0

    assert client.get("/devices/P001/exposure-timeline/does-not-exist").status_code == 404


def test_data_quality_reports_no_data_without_readings(monkeypatch):
    _mock_readings(monkeypatch, [])
    monkeypatch.setattr(repo, "get_baseline_values", lambda d, days=14: [])
    body = client.get("/devices/P001/data-quality").json()
    assert body["has_data"] is False
    assert body["confidence"] == "LOW"


def test_baseline_not_ready_below_minimum_samples(monkeypatch):
    monkeypatch.setattr(repo, "get_baseline_values", lambda d, days=14: [20.0, 21.0])
    monkeypatch.setattr(repo.influx_query, "latest_point", lambda d: {"pm2_5": 22.0, "time": "2026-08-15T10:00:00+00:00"})
    body = client.get("/devices/P001/baseline", headers=AUTH).json()
    assert body["ready"] is False and body["median"] is None
    # The app shows progress towards readiness, so the target has to travel with the count —
    # a copy hardcoded in the client would go stale the first time BASELINE_MIN_SAMPLES is tuned.
    assert body["sample_count"] == 2
    assert body["min_samples"] == CONFIG.baseline_min_samples > 2
    assert client.get("/devices/P001/baseline").status_code == 401


def test_pattern_reports_sample_size_and_uncertainty(monkeypatch):
    now = datetime.now(UTC)
    _mock_readings(monkeypatch, _readings(now))
    monkeypatch.setattr(
        repo, "get_symptoms",
        lambda sub, since: [{"occurred_at": (now - timedelta(minutes=30)).isoformat()}],
    )
    body = client.get("/devices/P001/pattern", headers=AUTH).json()
    assert body["sample_size"] == 1
    assert body["sufficient"] is False  # far below the minimum sample size
    assert body["exposure_episode_count"] >= 1


def test_thresholds_are_published():
    body = client.get("/config/thresholds").json()
    assert body["pm25_caution"] < body["pm25_high"]


def test_ranking_carries_map_and_label_fields(monkeypatch):
    now = datetime.now(UTC)
    monkeypatch.setattr(
        repo, "get_node_contexts",
        lambda n: [NodeContext(node_code="A", lat=13.75, lon=100.5,
                               last_seen=now - timedelta(seconds=30), pm25=80.0)],
    )
    node = client.get("/dashboard/ranking").json()["ranking"][0]
    assert node["pm25"] == 80.0 and node["lat"] == 13.75
    assert node["watch_label"] == "High"


def test_privacy_read_update_and_withdraw(monkeypatch):
    stored: dict = {}
    monkeypatch.setattr(repo, "get_privacy", lambda sub: {**repo.PRIVACY_DEFAULTS, **stored})
    monkeypatch.setattr(repo, "upsert_privacy", lambda sub, c: stored.update(c) or {**repo.PRIVACY_DEFAULTS, **stored})
    monkeypatch.setattr(repo, "delete_user_data", lambda sub: {"symptom_events": 3})

    assert client.get("/privacy").status_code == 401
    assert client.get("/privacy", headers=AUTH).json()["sync_enabled"] is True

    r = client.put("/privacy", json={"sync_enabled": False}, headers=AUTH)
    assert r.status_code == 200 and r.json()["sync_enabled"] is False
    assert client.put("/privacy", json={"location_sharing": "gps"}, headers=AUTH).status_code == 400

    assert client.post("/privacy/withdraw", headers=AUTH).json()["deleted"]["symptom_events"] == 3


def test_device_registry(monkeypatch):
    monkeypatch.setattr(repo, "list_devices", lambda sub: [{"external_id": "AA:BB"}])
    monkeypatch.setattr(repo, "upsert_device", lambda sub, d: [{"id": "1", **d}])
    assert client.get("/me/devices", headers=AUTH).json()["devices"][0]["external_id"] == "AA:BB"
    r = client.post("/me/devices", json={"external_id": "AA:BB", "fw_version": "1.0.0"}, headers=AUTH)
    assert r.status_code == 200 and r.json()["device"]["fw_version"] == "1.0.0"
    assert client.post("/me/devices", json={"external_id": "X", "kind": "drone"}, headers=AUTH).status_code == 400
