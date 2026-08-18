"""§3 Route Exposure Simulator — HTTP surface.

Assembles the pieces: ``routing`` draws the path, ``repo``/``influx_query`` supply the sensors
and their series, and ``intelligence.simulate`` does the arithmetic. Nothing is computed here
that could live in the pure module instead, so the maths stays testable without a network.

What this reports is environmental exposure: measured concentration weighted by the time a
traveller would spend in it. It is not a dose and says nothing about what enters a body
(TDD §1.2/§14). Where a route runs past no sensor, the answer is a gap and a lower coverage
figure — never an estimate standing in for a measurement.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from intelligence.config import CONFIG
from intelligence.simulate import InterpolationMode, Sensor, simulate

from . import repo, routing
from .influx_query import now_utc, series_between
from .security import require_user

router = APIRouter(tags=["simulator"])

# Requested name -> (InfluxDB field, unit). The API speaks the app's vocabulary (`pm25`) while
# the bucket keeps AirSentinel's field names (`pm2_5`); mapping here keeps that seam in one
# place instead of leaking a storage detail into every client.
PARAMETERS: dict[str, tuple[str, str]] = {
    "pm25": ("pm2_5", "µg/m³"),
    "pm10": ("pm10", "µg/m³"),
    "co2": ("co2", "ppm"),
    "tvoc": ("tvoc", "ppb"),
    "eco2": ("eco2", "ppm"),
    "temperature": ("temperature", "°C"),
    "humidity": ("humidity", "%RH"),
}

# Default reference lines for "time above threshold" (§3.10).
#
# These are ENGINEERING references for reading a chart, in the same sense as
# intelligence/config.py's environmental thresholds — they are not medical limits and assert
# nothing about anyone's health (TDD §5.2/§14). pm25 reuses the environmental caution level
# the rest of the app already labels with, so one walk is not measured against two different
# lines. CO2 and TVOC have no equivalent in the decision engine because neither has ever been
# an input to it; the values below are the common indoor-air-quality reference points, and any
# caller may override them per request.
DEFAULT_THRESHOLDS: dict[str, float] = {
    "pm25": CONFIG.pm25_env_caution,     # 37.5 µg/m³
    "pm10": 120.0,
    "co2": 1000.0,                        # ventilation-adequacy reference, not a health limit
    "tvoc": 660.0,
}

MAX_ROUTE_POINTS = 2000        # a 100 km walk at 50 m spacing; past this the request is a typo
MAX_DURATION_S = 24 * 3600


class LatLng(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class SimulateRequest(BaseModel):
    start: LatLng
    destination: LatLng
    start_time: datetime
    travel_mode: str = "walking"
    speed_mps: float | None = None            # defaults to the travel mode's ordinary pace
    sampling_distance_m: float = Field(50.0, gt=0, le=5000)
    max_sensor_distance_m: float = Field(300.0, gt=0, le=50000)
    parameters: list[str] = Field(default_factory=lambda: ["pm25", "co2", "tvoc"])
    interpolation: str = InterpolationMode.LINEAR
    # How far a reading may be stretched to answer for a moment it did not cover (§3.8).
    max_gap_s: float = Field(900.0, gt=0, le=6 * 3600)
    thresholds: dict[str, float] | None = None
    route_provider: str | None = None          # None = OSRM, falling back to a straight line
    label: str | None = None


def _sensors() -> list[Sensor]:
    """Registered stations that are marked usable, as matching candidates.

    A node whose registry status is not active is excluded here rather than filtered out of
    the results later: it is not a candidate at all, so the nearest-sensor search must not be
    able to pick it and then report a distance to something that is not reporting.
    """
    return [
        Sensor(node_code=n.node_code, lat=n.lat, lon=n.lon, name=n.name)
        for n in repo.get_node_contexts(now_utc())
        if n.sensor_healthy
    ]


@router.post("/exposure/simulate")
def exposure_simulate(req: SimulateRequest) -> dict:
    """Run a simulation (§3.15). Public: it reads only station data, which is not personal."""
    unknown = [p for p in req.parameters if p not in PARAMETERS]
    if unknown:
        raise HTTPException(400, f"unknown parameters: {', '.join(unknown)}")
    if not req.parameters:
        raise HTTPException(400, "at least one parameter is required")
    if req.interpolation not in (InterpolationMode.LINEAR, InterpolationMode.NEAREST,
                                 InterpolationMode.NONE):
        raise HTTPException(400, f"unknown interpolation mode: {req.interpolation}")

    speed = req.speed_mps or routing.default_speed_mps(req.travel_mode)
    if speed <= 0:
        raise HTTPException(400, "speed_mps must be positive")

    try:
        route = routing.get_route(
            (req.start.lat, req.start.lng),
            (req.destination.lat, req.destination.lng),
            req.travel_mode,
            req.route_provider,
        )
    except routing.RouteError as e:
        raise HTTPException(502, f"could not build a route: {e}") from e

    expected_points = route.distance_m / req.sampling_distance_m
    if expected_points > MAX_ROUTE_POINTS:
        raise HTTPException(
            400,
            f"route would need {int(expected_points)} sample points "
            f"(limit {MAX_ROUTE_POINTS}); increase sampling_distance_m",
        )
    duration_s = route.distance_m / speed
    if duration_s > MAX_DURATION_S:
        raise HTTPException(400, "route would take over 24 hours at the requested speed")

    sensors = _sensors()
    if not sensors:
        raise HTTPException(503, "no stations are registered to simulate against")

    # One query per run rather than one per route point: fetch every candidate sensor's series
    # across the whole travel window, padded by the interpolation reach so a point near either
    # end still has something on both sides of it to interpolate between.
    start_time = req.start_time
    end_time = start_time + timedelta(seconds=duration_s)
    pad = timedelta(seconds=req.max_gap_s)
    fields = [PARAMETERS[p][0] for p in req.parameters]
    raw = series_between([s.node_code for s in sensors], start_time - pad, end_time + pad, fields)

    # Re-key from InfluxDB field names to the API's parameter names, so the pure module never
    # has to know that pm25 is stored as pm2_5.
    field_to_param = {PARAMETERS[p][0]: p for p in req.parameters}
    series_by_sensor = {
        dev: {field_to_param[f]: rows for f, rows in per_field.items() if f in field_to_param}
        for dev, per_field in raw.items()
    }

    thresholds = dict(DEFAULT_THRESHOLDS)
    thresholds.update(req.thresholds or {})

    result = simulate(
        geometry=route.points,
        start_time=start_time,
        speed_mps=speed,
        sensors=sensors,
        series_by_sensor=series_by_sensor,
        parameters={p: PARAMETERS[p][1] for p in req.parameters},
        thresholds={p: thresholds[p] for p in req.parameters if p in thresholds},
        sampling_distance_m=req.sampling_distance_m,
        max_sensor_distance_m=req.max_sensor_distance_m,
        interpolation=req.interpolation,
        max_gap_s=req.max_gap_s,
    )

    return {
        "distance_m": round(result.distance_m, 1),
        "duration_s": round(result.duration_s, 1),
        "coverage": round(result.coverage, 4),
        "route": {
            "provider": route.provider,
            "profile": route.profile,
            "distance_m": round(route.distance_m, 1),
            "provider_duration_s": route.provider_duration_s,
            "note": route.note,
        },
        "travel_mode": req.travel_mode,
        "speed_mps": speed,
        "start_time": start_time.isoformat(),
        "sensors_used": result.sensors_used,
        "sensors_considered": [s.node_code for s in sensors],
        "results": {name: asdict(s) for name, s in result.summaries.items()},
        # Enough to draw both the exposure graph (§3.13) and the heat route (§3.14) without a
        # second request. Points with no reading are kept, not filtered: the gap is the point.
        "points": [
            {
                "index": p.index,
                "lat": round(p.lat, 6),
                "lon": round(p.lon, 6),
                "distance_m": round(p.distance_m, 1),
                "time": p.time.isoformat(),
                "sensor": p.sensor_code,
                "sensor_distance_m": round(p.sensor_distance_m, 1) if p.sensor_distance_m else None,
                "values": {k: round(v, 3) for k, v in p.values.items()},
            }
            for p in result.points
        ],
        # Stated in the payload, not only in the docs: any client rendering this is rendering
        # a claim about air, and must not round it up into a claim about a person.
        "disclaimer": (
            "Environmental exposure only — measured concentration weighted by time spent in "
            "it. Not an inhaled dose and not a medical assessment."
        ),
    }


class SaveSimulationRequest(SimulateRequest):
    """A run to keep. Same inputs, plus the summary produced from them."""
    results: dict
    distance_m: float
    duration_s: float
    coverage: float
    route_provider_used: str | None = None


@router.post("/exposure/simulations")
def save_simulation(req: SaveSimulationRequest, user: dict = Depends(require_user)) -> dict:
    """Persist a run for the signed-in user (§3.16)."""
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")

    try:
        rows = repo.save_simulation(
            user_sub=sub,
            payload={
                "label": req.label,
                "start_lat": req.start.lat,
                "start_lng": req.start.lng,
                "destination_lat": req.destination.lat,
                "destination_lng": req.destination.lng,
                "start_time": req.start_time.isoformat(),
                "travel_mode": req.travel_mode,
                "speed_mps": req.speed_mps or routing.default_speed_mps(req.travel_mode),
                "sampling_distance_m": req.sampling_distance_m,
                "max_sensor_distance_m": req.max_sensor_distance_m,
                "route_provider": req.route_provider_used or req.route_provider,
                "distance_m": req.distance_m,
                "duration_s": req.duration_s,
                "data_coverage": req.coverage,
            },
            results=req.results,
        )
    except repo.UnknownOwnerError as e:
        raise HTTPException(409, "no such account — a saved run belongs to a signed-in user") from e
    return {"saved": True, "simulation": rows}


@router.get("/exposure/simulations")
def list_simulations(
    limit: int = Query(20, ge=1, le=100), user: dict = Depends(require_user)
) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return {"simulations": repo.list_simulations(sub, limit)}


@router.get("/exposure/simulations/{simulation_id}")
def get_simulation(simulation_id: str, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    row = repo.get_simulation(sub, simulation_id)
    if row is None:
        raise HTTPException(404, "simulation not found")
    return row


@router.get("/exposure/config")
def simulator_config() -> dict:
    """What the client should offer, so it never keeps its own drifting copy (§3.2)."""
    return {
        "parameters": {name: {"unit": unit} for name, (_, unit) in PARAMETERS.items()},
        "default_thresholds": DEFAULT_THRESHOLDS,
        "travel_modes": {
            mode: {"default_speed_mps": speed, "profile": profile}
            for mode, (profile, speed) in routing.TRAVEL_MODES.items()
        },
        "interpolation_modes": [InterpolationMode.LINEAR, InterpolationMode.NEAREST,
                                InterpolationMode.NONE],
        "defaults": {
            "sampling_distance_m": 50,
            "max_sensor_distance_m": 300,
            "max_gap_s": 900,
        },
        "stations": [
            {"node_code": s.node_code, "name": s.name, "lat": s.lat, "lon": s.lon}
            for s in _sensors()
        ],
    }
