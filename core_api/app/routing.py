"""§3.3 Route geometry — where the path between two points comes from.

Longdo is the map the app already draws on, but its Route Service is a separate entitlement
from the Map key and the project's key is not enrolled in it (the service answers
``throw 'Route Service API Key Error'``). So routing is a provider behind one interface:
OSRM by default, a great-circle line when no network route is wanted or available, and room
for Longdo once its key is enabled without anything above this module changing.

Every result carries the provider that produced it. A simulation run over a straight line is
a different claim from one run over streets, and the answer must say which it is rather than
leave the reader to assume the better of the two.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import httpx

# The public OSRM demo has no SLA and asks that heavy use be self-hosted; point this at your
# own instance by setting OSRM_BASE_URL.
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org")
ROUTE_TIMEOUT_S = float(os.getenv("ROUTE_TIMEOUT_S", "20"))

# Travel modes the API accepts, mapped to an OSRM profile and a default speed in m/s.
# The speeds are ordinary travelling paces, used only when the caller does not give one.
TRAVEL_MODES: dict[str, tuple[str, float]] = {
    "walking": ("foot", 1.25),      # 4.5 km/h — the spec's worked example
    "cycling": ("bike", 4.17),      # 15 km/h
    "driving": ("driving", 8.33),   # 30 km/h, town traffic
}

STRAIGHT_LINE = "straight-line"


@dataclass
class RouteGeometry:
    points: list[tuple[float, float]]     # (lat, lon) in travel order
    distance_m: float
    provider: str                          # "osrm" | "straight-line"
    profile: str
    # OSRM's own estimate for its profile. Reported for reference only: the simulation times
    # the route from the requested speed, so that the walk being modelled is the one asked
    # for rather than whatever pace the router assumed.
    provider_duration_s: float | None = None
    note: str | None = None


class RouteError(RuntimeError):
    """No usable geometry could be produced."""


def _straight_line(
    start: tuple[float, float], dest: tuple[float, float], note: str | None = None
) -> RouteGeometry:
    from intelligence.simulate import haversine_m

    return RouteGeometry(
        points=[start, dest],
        distance_m=haversine_m(start[0], start[1], dest[0], dest[1]),
        provider=STRAIGHT_LINE,
        profile="direct",
        note=note or "Direct line between the two points — not a road route.",
    )


def _osrm(
    start: tuple[float, float], dest: tuple[float, float], profile: str
) -> RouteGeometry:
    # OSRM takes lon,lat — the opposite order to everything else in this codebase, which is
    # the single easiest thing to get wrong here and lands the route in the wrong hemisphere.
    coords = f"{start[1]},{start[0]};{dest[1]},{dest[0]}"
    url = f"{OSRM_BASE_URL}/route/v1/{profile}/{coords}"
    try:
        r = httpx.get(url, params={"overview": "full", "geometries": "geojson"},
                      timeout=ROUTE_TIMEOUT_S)
    except httpx.HTTPError as e:
        raise RouteError(f"route service unreachable: {e}") from e
    if r.status_code != 200:
        raise RouteError(f"route service returned HTTP {r.status_code}")

    body = r.json()
    if body.get("code") != "Ok" or not body.get("routes"):
        raise RouteError(f"route service found no route ({body.get('code')})")
    route = body["routes"][0]
    coords_lonlat = route.get("geometry", {}).get("coordinates") or []
    if len(coords_lonlat) < 2:
        raise RouteError("route service returned a geometry with no path")

    note = None
    if profile != "driving":
        # The public demo server is built with the car profile only and answers every profile
        # from it. Said plainly here because a "walking route" that silently follows a road a
        # pedestrian cannot use would misplace every sample taken along it.
        note = (
            f"Path follows the road network; the routing server may not model a "
            f"{profile}-specific path. Timing uses the requested speed regardless."
        )
    return RouteGeometry(
        points=[(lat, lon) for lon, lat in coords_lonlat],
        distance_m=float(route.get("distance") or 0.0),
        provider="osrm",
        profile=profile,
        provider_duration_s=float(route["duration"]) if route.get("duration") else None,
        note=note,
    )


def get_route(
    start: tuple[float, float],
    dest: tuple[float, float],
    travel_mode: str = "walking",
    provider: str | None = None,
) -> RouteGeometry:
    """Geometry from ``start`` to ``dest``.

    ``provider=None`` uses OSRM and falls back to a straight line if it cannot answer, with
    the fallback recorded in ``provider``/``note`` so a caller never mistakes one for the
    other. ``provider="straight-line"`` skips the network entirely.
    """
    profile, _ = TRAVEL_MODES.get(travel_mode, TRAVEL_MODES["walking"])
    if provider == STRAIGHT_LINE:
        return _straight_line(start, dest)
    try:
        return _osrm(start, dest, profile)
    except RouteError as e:
        if provider == "osrm":
            raise            # explicitly asked for OSRM — do not quietly substitute
        fallback = _straight_line(start, dest)
        fallback.note = f"Road routing unavailable ({e}). {fallback.note}"
        return fallback


def default_speed_mps(travel_mode: str) -> float:
    return TRAVEL_MODES.get(travel_mode, TRAVEL_MODES["walking"])[1]
