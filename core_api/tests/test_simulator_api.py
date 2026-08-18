"""§3 simulator endpoints, with routing and the data layer mocked offline."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from core_api.app import repo, routing, simulator_api
from core_api.app.destination import NodeContext
from core_api.app.main import app
from core_api.app.routing import RouteGeometry

client = TestClient(app)

T0 = datetime(2026, 8, 18, 7, 30, tzinfo=UTC)
SOUTH, NORTH = (12.2429, 102.5140), (12.2519, 102.5140)

BODY = {
    "start": {"lat": SOUTH[0], "lng": SOUTH[1]},
    "destination": {"lat": NORTH[0], "lng": NORTH[1]},
    "start_time": T0.isoformat(),
    "travel_mode": "walking",
    "sampling_distance_m": 100,
    "parameters": ["pm25"],
}


def _nodes(now):
    return [
        NodeContext(node_code="SOUTH", name="South", lat=SOUTH[0], lon=SOUTH[1],
                    last_seen=now, pm25=10.0),
        NodeContext(node_code="NORTH", name="North", lat=NORTH[0], lon=NORTH[1],
                    last_seen=now, pm25=80.0),
    ]


def _series(device_ids, start, end, fields):
    """A flat series sampled every minute across the whole window.

    Sampled densely on purpose: two points an hour apart would be refused by the gap rule, and
    these tests are about routing and matching rather than about interpolation reach — that is
    covered in intelligence/tests/test_simulate.py.
    """
    steps = int((end - start).total_seconds() // 60) + 2
    times = [start + timedelta(minutes=i) for i in range(steps)]
    return {
        "SOUTH": {"pm2_5": [(t, 10.0) for t in times]},
        "NORTH": {"pm2_5": [(t, 80.0) for t in times]},
    }


def _route(start, dest, travel_mode="walking", provider=None):
    return RouteGeometry(points=[start, dest], distance_m=1000.0,
                         provider="osrm", profile="foot", provider_duration_s=800.0)


def _offline(monkeypatch):
    monkeypatch.setattr(repo, "get_node_contexts", _nodes)
    monkeypatch.setattr(simulator_api, "series_between", _series)
    monkeypatch.setattr(routing, "get_route", _route)


def test_simulate_returns_summaries_and_points(monkeypatch):
    _offline(monkeypatch)
    r = client.post("/exposure/simulate", json=BODY)
    assert r.status_code == 200
    body = r.json()
    assert body["route"]["provider"] == "osrm"
    assert body["distance_m"] > 0 and body["duration_s"] > 0
    assert set(body["sensors_used"]) == {"SOUTH", "NORTH"}
    assert body["results"]["pm25"]["unit"] == "µg/m³"
    assert {p["values"].get("pm25") for p in body["points"] if p["values"]} == {10.0, 80.0}


def test_simulate_states_that_it_is_not_a_dose(monkeypatch):
    # The medical boundary (TDD §1.2/§14) travels with the payload, not only with the docs:
    # any client rendering this is rendering a claim about air, never about a person.
    _offline(monkeypatch)
    body = client.post("/exposure/simulate", json=BODY).json()
    assert "dose" in body["disclaimer"].lower()


def test_uncovered_route_points_are_kept_as_gaps(monkeypatch):
    _offline(monkeypatch)
    body = client.post("/exposure/simulate", json={**BODY, "max_sensor_distance_m": 150}).json()
    # A point out of range is reported with no sensor and no values rather than dropped: the
    # gap is what makes the coverage figure mean anything.
    assert any(p["sensor"] is None and p["values"] == {} for p in body["points"])
    assert 0.0 < body["coverage"] < 1.0


def test_speed_defaults_to_the_travel_mode(monkeypatch):
    _offline(monkeypatch)
    body = client.post("/exposure/simulate", json=BODY).json()
    assert body["speed_mps"] == routing.TRAVEL_MODES["walking"][1]


def test_unknown_parameter_is_rejected(monkeypatch):
    _offline(monkeypatch)
    r = client.post("/exposure/simulate", json={**BODY, "parameters": ["radon"]})
    assert r.status_code == 400 and "radon" in r.json()["detail"]


def test_unknown_interpolation_mode_is_rejected(monkeypatch):
    _offline(monkeypatch)
    r = client.post("/exposure/simulate", json={**BODY, "interpolation": "spline"})
    assert r.status_code == 400


def test_too_many_sample_points_is_refused_rather_than_truncated(monkeypatch):
    _offline(monkeypatch)
    monkeypatch.setattr(
        routing, "get_route",
        lambda *a, **k: RouteGeometry(points=[SOUTH, NORTH], distance_m=5_000_000.0,
                                      provider="osrm", profile="foot"),
    )
    r = client.post("/exposure/simulate", json={**BODY, "sampling_distance_m": 1})
    # Silently sampling a shorter route, or a coarser one, would answer a question nobody asked.
    assert r.status_code == 400 and "sampling_distance_m" in r.json()["detail"]


def test_a_failing_router_is_reported_not_hidden(monkeypatch):
    _offline(monkeypatch)

    def boom(*a, **k):
        raise routing.RouteError("upstream down")

    monkeypatch.setattr(routing, "get_route", boom)
    r = client.post("/exposure/simulate", json={**BODY, "route_provider": "osrm"})
    assert r.status_code == 502


def test_simulation_needs_at_least_one_registered_station(monkeypatch):
    _offline(monkeypatch)
    monkeypatch.setattr(repo, "get_node_contexts", lambda now: [])
    r = client.post("/exposure/simulate", json=BODY)
    assert r.status_code == 503


def test_inactive_stations_are_not_matching_candidates(monkeypatch):
    _offline(monkeypatch)

    def only_inactive(now):
        return [NodeContext(node_code="SOUTH", name="South", lat=SOUTH[0], lon=SOUTH[1],
                            last_seen=now, pm25=10.0, sensor_healthy=False)]

    monkeypatch.setattr(repo, "get_node_contexts", only_inactive)
    r = client.post("/exposure/simulate", json=BODY)
    assert r.status_code == 503


def test_config_publishes_what_the_client_should_offer(monkeypatch):
    _offline(monkeypatch)
    body = client.get("/exposure/config").json()
    assert "pm25" in body["parameters"] and "walking" in body["travel_modes"]
    assert body["default_thresholds"]["pm25"] == simulator_api.DEFAULT_THRESHOLDS["pm25"]
    assert [s["node_code"] for s in body["stations"]] == ["SOUTH", "NORTH"]


def test_saving_a_simulation_requires_a_token():
    r = client.post("/exposure/simulations", json={**BODY, "results": {},
                                                   "distance_m": 1.0, "duration_s": 1.0,
                                                   "coverage": 1.0})
    assert r.status_code in (401, 403)


def test_listing_simulations_requires_a_token():
    assert client.get("/exposure/simulations").status_code in (401, 403)
