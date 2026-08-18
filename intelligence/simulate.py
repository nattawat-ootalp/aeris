"""§3 Route Exposure Simulation — pure, testable core.

Given a route geometry, a departure time, a travel speed and the sensors that exist, work out
what each point along the way was measuring when a traveller would have been standing on it,
and summarise the walk as time-weighted statistics.

This is exposure in the environmental sense only: concentration integrated over the time spent
in it. It is **not** a dose. Nothing here models breathing rate, deposition, or anything that
enters a body, and no output may be presented as if it did (TDD §1.2/§14).

The module is deliberately free of I/O. The caller supplies the route, the sensor registry and
each sensor's already-fetched series; everything below is arithmetic over those, so the whole
chain — sampling, timing, matching, interpolation, integration — is unit-testable without a
network or a database.

The rule the rest of the repository lives by holds here too: a value that was not measured is
never invented. A route point with no sensor within range, or whose time falls in a gap the
series never covered, reports ``None`` and is counted against coverage rather than filled in.
"""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from math import asin, cos, radians, sin, sqrt

# Metres. Two points closer than this are treated as the same place when resampling, which
# keeps a route that doubles back on itself from producing zero-length segments.
_MIN_SEGMENT_M = 0.5

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in METRES (§3.6).

    ``core_api.app.destination.haversine_km`` is the same formula in kilometres. Both exist
    because the destination assessment reasons in kilometres and this one in metres, and a
    silent unit conversion between them is exactly the kind of mistake that would place a
    sensor 300 times too near or too far.
    """
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))


@dataclass(frozen=True)
class Sensor:
    """A station that may be matched to a route point."""
    node_code: str
    lat: float
    lon: float
    name: str = ""


@dataclass
class RoutePoint:
    """One sampling position on the route (§3.3/§3.4/§3.5)."""
    index: int
    lat: float
    lon: float
    distance_m: float                    # travelled from the start
    time: datetime                       # when the traveller is here
    sensor_code: str | None = None       # nearest sensor within range, else None
    sensor_distance_m: float | None = None
    values: dict[str, float] = field(default_factory=dict)   # parameter -> value at `time`

    @property
    def has_data(self) -> bool:
        return bool(self.values)


@dataclass
class ParameterSummary:
    """Per-parameter statistics over the whole route (§3.10)."""
    parameter: str
    unit: str
    average: float | None
    minimum: float | None
    maximum: float | None
    sample_count: int
    # Σ(C × Δt) in <unit>·min, present only for the parameters the spec integrates. Duration
    # measures are seconds so the API never mixes minutes and seconds in one object.
    exposure_integral: float | None = None
    exposure_unit: str | None = None
    time_above_threshold_s: float | None = None
    threshold: float | None = None
    covered_s: float = 0.0


@dataclass
class SimulationResult:
    distance_m: float
    duration_s: float
    coverage: float                       # 0..1, fraction of points that resolved to a value
    points: list[RoutePoint]
    summaries: dict[str, ParameterSummary]
    sensors_used: list[str]


# ── §3.3 route sampling ──────────────────────────────────────────────────────────────────

def resample_route(
    geometry: list[tuple[float, float]],
    spacing_m: float,
) -> list[tuple[float, float, float]]:
    """Walk the polyline and emit a point every ``spacing_m``.

    Returns ``(lat, lon, distance_from_start_m)``. The route provider's own vertices are not
    used directly: they cluster where the road bends and thin out on a straight, which would
    weight the statistics by how twisty the street is rather than by time spent.

    The destination is always emitted, even when it does not land on a spacing boundary, so
    the reported distance is the route's own and not a multiple of the sampling interval.
    """
    if spacing_m <= 0:
        raise ValueError("spacing_m must be positive")
    pts = [p for p in geometry if p is not None]
    if len(pts) < 2:
        return [(pts[0][0], pts[0][1], 0.0)] if pts else []

    out: list[tuple[float, float, float]] = [(pts[0][0], pts[0][1], 0.0)]
    travelled = 0.0        # distance along the route of the last emitted sample
    cursor = 0.0           # distance along the route of `pts[i]`
    for (lat1, lon1), (lat2, lon2) in zip(pts, pts[1:]):
        seg = haversine_m(lat1, lon1, lat2, lon2)
        if seg < _MIN_SEGMENT_M:
            continue
        # Emit every spacing boundary that falls inside this segment, interpolating linearly
        # between its endpoints. At street scale the error against a great-circle path is far
        # below the sampling interval itself.
        nxt = travelled + spacing_m
        while nxt <= cursor + seg:
            f = (nxt - cursor) / seg
            out.append((lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f, nxt))
            travelled = nxt
            nxt += spacing_m
        cursor += seg

    if cursor - travelled > _MIN_SEGMENT_M or len(out) == 1:
        out.append((pts[-1][0], pts[-1][1], cursor))
    return out


# ── §3.4 time along the route ────────────────────────────────────────────────────────────

def assign_times(
    samples: list[tuple[float, float, float]],
    start_time: datetime,
    speed_mps: float,
) -> list[RoutePoint]:
    """Turn ``(lat, lon, distance)`` into positioned points carrying their own timestamp."""
    if speed_mps <= 0:
        raise ValueError("speed_mps must be positive")
    return [
        RoutePoint(index=i, lat=lat, lon=lon, distance_m=dist,
                   time=start_time + timedelta(seconds=dist / speed_mps))
        for i, (lat, lon, dist) in enumerate(samples)
    ]


# ── §3.5 sensor matching ─────────────────────────────────────────────────────────────────

def nearest_sensor(
    lat: float,
    lon: float,
    sensors: list[Sensor],
    max_distance_m: float,
) -> tuple[Sensor, float] | None:
    """Closest sensor within ``max_distance_m``, or None.

    Out of range is a real answer, not a reason to widen the search: the next sensor along
    may be measuring a different street entirely, and reporting its reading here would be
    fabricating a measurement for a place nothing observed.
    """
    best: tuple[Sensor, float] | None = None
    for s in sensors:
        d = haversine_m(lat, lon, s.lat, s.lon)
        if d <= max_distance_m and (best is None or d < best[1]):
            best = (s, d)
    return best


# ── §3.8 interpolation ───────────────────────────────────────────────────────────────────

class InterpolationMode:
    LINEAR = "linear"
    NEAREST = "nearest"
    NONE = "none"


def value_at(
    series: list[tuple[datetime, float]],
    when: datetime,
    mode: str = InterpolationMode.LINEAR,
    max_gap_s: float = 900.0,
) -> float | None:
    """Value of one parameter at ``when``, or None when the series cannot answer.

    ``series`` must be sorted by time and contain no None values. ``max_gap_s`` is the limit
    on how far the answer may reach: a reading an hour either side says nothing about this
    minute, and stretching it across the gap would turn an absence of data into a plausible
    looking number.
    """
    if not series or mode == InterpolationMode.NONE:
        return None
    times = [t for t, _ in series]
    i = bisect_left(times, when)

    if i == 0:
        t, v = series[0]
        return v if (t - when).total_seconds() <= max_gap_s else None
    if i == len(series):
        t, v = series[-1]
        return v if (when - t).total_seconds() <= max_gap_s else None

    (t1, v1), (t2, v2) = series[i - 1], series[i]
    before, after = (when - t1).total_seconds(), (t2 - when).total_seconds()
    if mode == InterpolationMode.NEAREST:
        near_t, near_v = (t1, v1) if before <= after else (t2, v2)
        return near_v if abs((when - near_t).total_seconds()) <= max_gap_s else None

    # Linear. The gap that matters is the one being bridged, not the distance to either end:
    # two samples 40 minutes apart do not describe the twenty minutes between them, however
    # close the requested instant sits to one of them.
    span = (t2 - t1).total_seconds()
    if span > max_gap_s:
        return None
    if span == 0:
        return v1
    return v1 + (v2 - v1) * (before / span)


# ── §3.9/§3.10 statistics ────────────────────────────────────────────────────────────────

def summarize_parameter(
    points: list[RoutePoint],
    parameter: str,
    unit: str,
    threshold: float | None = None,
    integrate: bool = True,
) -> ParameterSummary:
    """Average / min / max, plus a time-weighted integral and time-above-threshold.

    Statistics are time-weighted rather than per-point: at a constant speed the points are
    evenly spaced in time, but a route sampled to its true endpoint has one short final leg,
    and a stretch with no sensor coverage leaves a hole that must not silently close up.

    A segment counts only when BOTH of its ends have a value. A single measured point next to
    an unmeasured one describes an instant, not a span, and the same rule already governs
    ``intelligence/exposure.py``.
    """
    vals = [(p.time, p.values[parameter]) for p in points if parameter in p.values]
    if not vals:
        return ParameterSummary(parameter, unit, None, None, None, 0,
                                threshold=threshold, covered_s=0.0)

    numbers = [v for _, v in vals]
    summary = ParameterSummary(
        parameter=parameter,
        unit=unit,
        average=None,
        minimum=min(numbers),
        maximum=max(numbers),
        sample_count=len(numbers),
        threshold=threshold,
    )

    area = 0.0            # ∫C dt over covered segments, in <unit>·seconds
    covered = 0.0
    above = 0.0
    for (t1, v1), (t2, v2) in zip(vals, vals[1:]):
        # Consecutive in the *measured* list may still straddle a coverage hole; the sample
        # times themselves say how long the leg was, and an unmeasured stretch shows up as a
        # longer gap than the sampling interval.
        dt = (t2 - t1).total_seconds()
        if dt <= 0:
            continue
        gap_points = _points_between(points, t1, t2, parameter)
        if gap_points:
            continue      # a hole in coverage — do not integrate across it
        covered += dt
        area += (v1 + v2) / 2.0 * dt      # trapezoid, as in intelligence/exposure.py
        if threshold is not None:
            above += _fraction_above(v1, v2, threshold) * dt

    # Time-weighted where there is a span to weight by; the plain mean is the honest answer
    # for a route whose points never joined into one, and says so through covered_s == 0.
    summary.average = (area / covered) if covered > 0 else (sum(numbers) / len(numbers))
    summary.covered_s = covered
    if threshold is not None:
        summary.time_above_threshold_s = above
    if integrate:
        summary.exposure_integral = area / 60.0        # <unit>·minutes (§3.9's worked example)
        summary.exposure_unit = f"{unit}·min"
    return summary


def _points_between(
    points: list[RoutePoint], t1: datetime, t2: datetime, parameter: str
) -> bool:
    """True when some route point strictly between t1 and t2 lacks this parameter."""
    return any(t1 < p.time < t2 and parameter not in p.values for p in points)


def _fraction_above(a: float, b: float, level: float) -> float:
    """Fraction of a segment spent at/above ``level``, assuming linear change between ends.

    Mirrors ``intelligence.exposure._crossing_fraction`` so a minute counted as above the
    line by the timeline is counted the same way here.
    """
    a_hi, b_hi = a >= level, b >= level
    if a_hi and b_hi:
        return 1.0
    if not a_hi and not b_hi:
        return 0.0
    x = (level - a) / (b - a)
    return (1.0 - x) if b_hi else x


def coverage(points: list[RoutePoint]) -> float:
    """§3.11 — fraction of route points that resolved to at least one value."""
    if not points:
        return 0.0
    return sum(1 for p in points if p.has_data) / len(points)


# ── the whole simulation ─────────────────────────────────────────────────────────────────

def simulate(
    geometry: list[tuple[float, float]],
    start_time: datetime,
    speed_mps: float,
    sensors: list[Sensor],
    series_by_sensor: dict[str, dict[str, list[tuple[datetime, float]]]],
    parameters: dict[str, str],
    thresholds: dict[str, float] | None = None,
    sampling_distance_m: float = 50.0,
    max_sensor_distance_m: float = 300.0,
    interpolation: str = InterpolationMode.LINEAR,
    max_gap_s: float = 900.0,
) -> SimulationResult:
    """Run §3.3–§3.11 end to end.

    ``series_by_sensor`` is ``{node_code: {parameter: [(time, value), ...]}}``, already sorted
    and already free of None values — the caller fetches once per sensor rather than once per
    route point, which is the difference between a handful of queries and one per 50 metres.
    ``parameters`` maps each requested parameter to the unit it is reported in.
    """
    samples = resample_route(geometry, sampling_distance_m)
    points = assign_times(samples, start_time, speed_mps)
    thresholds = thresholds or {}
    used: list[str] = []

    for p in points:
        match = nearest_sensor(p.lat, p.lon, sensors, max_sensor_distance_m)
        if match is None:
            continue                       # §3.5 NO DATA — left empty on purpose
        sensor, dist = match
        p.sensor_code, p.sensor_distance_m = sensor.node_code, dist
        series = series_by_sensor.get(sensor.node_code, {})
        for param in parameters:
            v = value_at(series.get(param, []), p.time, interpolation, max_gap_s)
            if v is not None:
                p.values[param] = v
        if p.has_data and sensor.node_code not in used:
            used.append(sensor.node_code)

    # Parameters the spec integrates (§3.10): a concentration over time is meaningful for the
    # pollutants, while an "integrated temperature" would be a number with no reading.
    integrated = {"pm25", "pm10", "co2", "tvoc", "eco2"}
    summaries = {
        param: summarize_parameter(points, param, unit, thresholds.get(param),
                                   integrate=param in integrated)
        for param, unit in parameters.items()
    }

    duration = (points[-1].time - points[0].time).total_seconds() if len(points) > 1 else 0.0
    return SimulationResult(
        distance_m=points[-1].distance_m if points else 0.0,
        duration_s=duration,
        coverage=coverage(points),
        points=points,
        summaries=summaries,
        sensors_used=used,
    )
