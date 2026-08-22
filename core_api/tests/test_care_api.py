"""Risk score, predictive alert, action plan, emergency contacts and SOS endpoints.

Data layer mocked offline. These tests pin the safety behaviour of the surface, not just its
shape: no risk number without usable data, no forecast without enough samples, no location
stored without consent, and no medical content authored by Aeris.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from core_api.app import repo
from core_api.app.main import app
from core_api.app.security import create_token
from intelligence.models import Reading

client = TestClient(app)
AUTH = {"Authorization": f"Bearer {create_token('user-1')}"}


def _series(now: datetime, values: list[float], step_min: int = 1) -> list[Reading]:
    n = len(values)
    return [
        Reading(
            device_id="P001",
            timestamp=now - timedelta(minutes=step_min * (n - 1 - i)),
            pm25=v,
            temperature=31.0,
            humidity=70.0,
            battery=80,
            sensor_status="OK",
        )
        for i, v in enumerate(values)
    ]


def _mock(monkeypatch, readings, *, baseline=None, symptoms=None):
    monkeypatch.setattr(repo, "get_recent_readings", lambda d, hours=6: readings)
    monkeypatch.setattr(repo, "get_baseline_values", lambda d, days=14, user_sub=None: baseline or [])
    monkeypatch.setattr(repo, "get_symptoms", lambda sub, since: symptoms or [])


# ── Personalized risk score ──────────────────────────────────────────────────
def test_risk_requires_auth(monkeypatch):
    _mock(monkeypatch, [])
    assert client.get("/devices/P001/risk").status_code == 401


def test_risk_without_data_is_no_data_not_zero(monkeypatch):
    _mock(monkeypatch, [])
    body = client.get("/devices/P001/risk", headers=AUTH).json()
    assert body["decision"] == "NO_DATA"
    assert body["watch_label"] == "No Data"
    assert body["score"] is None


def test_risk_returns_components_and_reasons(monkeypatch):
    now = datetime.now(UTC)
    _mock(monkeypatch, _series(now, [90.0] * 30), baseline=[10.0] * 120)
    body = client.get("/devices/P001/risk", headers=AUTH).json()
    assert 0 <= body["score"] <= 100
    assert body["watch_label"] in ("Normal", "Caution", "High")
    assert set(body["components"]) >= {"environmental", "duration", "personal_baseline"}
    assert body["reason_codes"]
    assert "not a medical assessment" in body["note"]


def test_risk_never_says_safe(monkeypatch):
    now = datetime.now(UTC)
    _mock(monkeypatch, _series(now, [5.0] * 30))
    body = client.get("/devices/P001/risk", headers=AUTH).json()
    assert "safe" not in str(body).lower()


# ── Predictive alert ─────────────────────────────────────────────────────────
def test_forecast_unavailable_without_enough_samples(monkeypatch):
    now = datetime.now(UTC)
    _mock(monkeypatch, _series(now, [10.0, 12.0]))
    body = client.get("/devices/P001/forecast").json()
    assert body["available"] is False
    assert body["projected_pm25"] is None
    assert "FORECAST_INSUFFICIENT_DATA" in body["reason_codes"]


def test_forecast_projects_rising_series_with_uncertainty(monkeypatch):
    now = datetime.now(UTC)
    _mock(monkeypatch, _series(now, [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0]))
    body = client.get("/devices/P001/forecast?horizon_min=20").json()
    assert body["available"] is True
    assert body["projected_pm25"] > 80
    assert body["uncertainty"] is not None
    assert body["horizon_sec"] == 1200
    assert "FORECAST_RISING" in body["reason_codes"]
    assert "not a prediction of symptoms" in body["note"]


def test_forecast_is_public_but_carries_no_health_data(monkeypatch):
    now = datetime.now(UTC)
    _mock(monkeypatch, _series(now, [10.0] * 8))
    body = client.get("/devices/P001/forecast").json()
    assert body["available"] is True
    assert "symptom" not in str(body.keys()).lower()


# ── Action plan ──────────────────────────────────────────────────────────────
def test_action_plan_is_empty_until_the_user_writes_one(monkeypatch):
    monkeypatch.setattr(repo.supa, "sb_get", lambda t, p=None: [])
    body = client.get("/me/action-plan", headers=AUTH).json()
    assert body["exists"] is False
    # Aeris must not supply default care steps.
    assert body["caution_steps"] == [] and body["high_steps"] == []


def test_action_plan_stores_steps_verbatim(monkeypatch):
    stored: dict = {}

    def fake_post(table, row, params=None, headers=None):
        stored.update(row)
        return [row]

    monkeypatch.setattr(repo.supa, "sb_get", lambda t, p=None: [])
    monkeypatch.setattr(repo.supa, "sb_post", fake_post)
    steps = ["Take reliever as prescribed", "Sit upright and rest"]
    body = client.put(
        "/me/action-plan",
        headers=AUTH,
        json={"author": "clinician", "clinician_name": "Dr. A", "high_steps": steps},
    ).json()
    assert body["high_steps"] == steps
    assert stored["high_steps"] == steps          # unchanged on the way to storage
    assert stored["author"] == "clinician"


def test_action_plan_rejects_an_unknown_author(monkeypatch):
    monkeypatch.setattr(repo.supa, "sb_get", lambda t, p=None: [])
    r = client.put("/me/action-plan", headers=AUTH, json={"author": "aeris"})
    assert r.status_code == 400


def test_action_plan_requires_auth():
    assert client.get("/me/action-plan").status_code == 401


# ── Emergency contacts ───────────────────────────────────────────────────────
def test_contacts_round_trip(monkeypatch):
    monkeypatch.setattr(repo, "list_contacts", lambda sub: [{"id": "c1", "name": "Mum"}])
    monkeypatch.setattr(repo, "add_contact", lambda sub, c: [{"id": "c2", **c}])
    assert client.get("/me/contacts", headers=AUTH).json()["contacts"][0]["name"] == "Mum"
    added = client.post("/me/contacts", headers=AUTH, json={"name": "Dad", "phone": "0800000000"})
    assert added.json()["contact"]["name"] == "Dad"


def test_contacts_require_auth():
    assert client.get("/me/contacts").status_code == 401


# ── SOS ──────────────────────────────────────────────────────────────────────
def _mock_sos(monkeypatch, *, sharing: str, contacts=None):
    monkeypatch.setattr(repo, "get_privacy", lambda sub: {"location_sharing": sharing})
    monkeypatch.setattr(repo, "list_contacts", lambda sub: contacts or [])
    monkeypatch.setattr(repo, "get_action_plan", lambda sub: {"exists": False})
    monkeypatch.setattr(repo, "store_sos", lambda sub, e: [e])


def test_sos_drops_location_when_sharing_is_off(monkeypatch):
    _mock_sos(monkeypatch, sharing="none")
    body = client.post("/sos", headers=AUTH, json={"lat": 13.7563, "lon": 100.5018}).json()
    assert body["location_stored"] is False
    assert body["event"]["lat"] is None and body["event"]["lon"] is None


def test_sos_coarsens_location_when_consent_is_coarse(monkeypatch):
    _mock_sos(monkeypatch, sharing="coarse")
    body = client.post("/sos", headers=AUTH, json={"lat": 13.756331, "lon": 100.501762}).json()
    assert body["event"]["lat"] == 13.76 and body["event"]["lon"] == 100.5
    assert body["event"]["location_accuracy_m"] is None


def test_sos_keeps_precise_location_only_with_precise_consent(monkeypatch):
    _mock_sos(monkeypatch, sharing="precise")
    body = client.post("/sos", headers=AUTH, json={"lat": 13.756331, "lon": 100.501762}).json()
    assert body["event"]["lat"] == 13.756331
    assert body["location_stored"] is True


def test_sos_notifies_nobody_automatically(monkeypatch):
    _mock_sos(monkeypatch, sharing="none", contacts=[{"name": "Mum", "notify_on_sos": True}])
    body = client.post("/sos", headers=AUTH, json={}).json()
    assert body["event"]["notified_contacts"] == 0
    assert body["contacts"][0]["name"] == "Mum"        # returned for the user to call
    assert "does not contact anyone for you" in body["note"]


def test_sos_accepts_a_portable_source(monkeypatch):
    _mock_sos(monkeypatch, sharing="none")
    monkeypatch.setattr(repo.influx_query, "latest_point", lambda d: {"pm2_5": 88.0})
    body = client.post("/sos", headers=AUTH, json={"source": "portable", "device_id": "P001"}).json()
    assert body["event"]["source"] == "portable"
    assert body["event"]["pm25"] == 88.0


def test_sos_rejects_an_unknown_source(monkeypatch):
    _mock_sos(monkeypatch, sharing="none")
    assert client.post("/sos", headers=AUTH, json={"source": "cloud"}).status_code == 400


def test_sos_requires_auth():
    assert client.post("/sos", json={}).status_code == 401
