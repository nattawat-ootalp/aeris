"""§4 Air Quality Time Machine — replay recorded series along a timeline.

The server's job is to hand the client a set of frames — one timestamp, every selected
station's values at it — at a resolution the browser can actually hold. Playback itself is a
client concern (§4.6): the cursor, the speed multiplier and the pause state never leave the
page, so scrubbing does not re-query.

Frames are built from what was recorded. A window in which a station wrote nothing is absent
from that station's frame rather than carried forward from the last one it did write, because
a marker that keeps showing 25 µg/m³ through an outage is indistinguishable from a station
that is genuinely steady (TDD §5.1, and the same rule the destination assessment follows).
"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import repo
from .influx_query import aggregate_between, now_utc, series_between
from .security import require_user

router = APIRouter(tags=["replay"])

# Same mapping as the simulator: API vocabulary out, bucket field names in.
PARAMETERS: dict[str, tuple[str, str]] = {
    "pm25": ("pm2_5", "µg/m³"),
    "pm10": ("pm10", "µg/m³"),
    "co2": ("co2", "ppm"),
    "tvoc": ("tvoc", "ppb"),
    "eco2": ("eco2", "ppm"),
    "temperature": ("temperature", "°C"),
    "humidity": ("humidity", "%RH"),
}

# §4.17 — the resolutions the client may ask for, coarsest first for the auto-pick below.
INTERVALS = ["10s", "1m", "5m", "15m", "1h"]
_INTERVAL_SECONDS = {"10s": 10, "1m": 60, "5m": 300, "15m": 900, "1h": 3600}

# A ceiling on frames per response. Playback reads from memory, so the whole span arrives at
# once; past roughly this many frames the payload, not the sensor, becomes what limits the
# replay. Exceeding it coarsens the interval rather than truncating the span — a shorter
# window would silently hide the end of what was asked for.
MAX_FRAMES = 3000
MAX_SPAN_DAYS = 31


def _resolve_interval(start: datetime, end: datetime, requested: str | None) -> tuple[str, bool]:
    """Return the interval to query and whether it was coarsened from what was asked."""
    span = (end - start).total_seconds()
    if requested:
        if requested not in _INTERVAL_SECONDS:
            raise HTTPException(400, f"interval must be one of {', '.join(INTERVALS)}")
        if span / _INTERVAL_SECONDS[requested] <= MAX_FRAMES:
            return requested, False
    for iv in INTERVALS:
        if span / _INTERVAL_SECONDS[iv] <= MAX_FRAMES:
            return iv, requested is not None
    return INTERVALS[-1], requested is not None


def _frames(
    data: dict[str, dict[str, list[tuple[datetime, float]]]],
    params: list[str],
) -> list[dict]:
    """Pivot per-device series into per-timestamp frames (§4.5).

    Aggregated windows share a boundary across devices, so the timestamps line up without
    resampling; a station that recorded nothing in a window is simply missing from that frame.
    """
    field_to_param = {PARAMETERS[p][0]: p for p in params}
    by_time: dict[datetime, dict[str, dict[str, float]]] = {}
    for device, per_field in data.items():
        for field, rows in per_field.items():
            param = field_to_param.get(field)
            if param is None:
                continue
            for t, v in rows:
                by_time.setdefault(t, {}).setdefault(device, {})[param] = round(v, 3)
    return [
        {"timestamp": t.isoformat(), "stations": stations}
        for t, stations in sorted(by_time.items())
    ]


def _stats(
    data: dict[str, dict[str, list[tuple[datetime, float]]]], params: list[str]
) -> dict[str, dict[str, dict]]:
    """Min / mean / max per station per parameter over the whole window (§4.18)."""
    field_to_param = {PARAMETERS[p][0]: p for p in params}
    out: dict[str, dict[str, dict]] = {}
    for device, per_field in data.items():
        for field, rows in per_field.items():
            param = field_to_param.get(field)
            if param is None or not rows:
                continue
            values = [v for _, v in rows]
            out.setdefault(device, {})[param] = {
                "minimum": round(min(values), 3),
                "maximum": round(max(values), 3),
                "average": round(sum(values) / len(values), 3),
                "samples": len(values),
                "unit": PARAMETERS[param][1],
            }
    return out


def _validate(station_ids: list[str], params: list[str], start: datetime, end: datetime) -> None:
    if not station_ids:
        raise HTTPException(400, "at least one station_id is required")
    unknown = [p for p in params if p not in PARAMETERS]
    if unknown:
        raise HTTPException(400, f"unknown parameters: {', '.join(unknown)}")
    if not params:
        raise HTTPException(400, "at least one parameter is required")
    if end <= start:
        raise HTTPException(400, "end must be after start")
    if (end - start) > timedelta(days=MAX_SPAN_DAYS):
        raise HTTPException(400, f"span is limited to {MAX_SPAN_DAYS} days")


def _split(csv_value: str) -> list[str]:
    return [s.strip() for s in csv_value.split(",") if s.strip()]


@router.get("/replay/data")
def replay_data(
    station_ids: str = Query(..., description="comma-separated node codes"),
    start: datetime = Query(...),
    end: datetime = Query(...),
    parameters: str = Query("pm25"),
    interval: str | None = Query(None, description=f"one of {', '.join(INTERVALS)}"),
) -> dict:
    """Frames for a span (§4.16). Public — station readings are not personal data."""
    stations, params = _split(station_ids), _split(parameters)
    _validate(stations, params, start, end)

    resolved, coarsened = _resolve_interval(start, end, interval)
    fields = [PARAMETERS[p][0] for p in params]
    data = aggregate_between(stations, start, end, fields, resolved)
    frames = _frames(data, params)

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "interval": resolved,
        # Said out loud rather than left to be noticed: a client that asked for 10 s frames
        # and silently received hourly ones would draw a smooth line over a spike.
        "interval_coarsened": coarsened,
        "requested_interval": interval,
        "station_ids": stations,
        "parameters": {p: {"unit": PARAMETERS[p][1]} for p in params},
        "frame_count": len(frames),
        "frames": frames,
        "stats": _stats(data, params),
        "stations_with_data": sorted(data.keys()),
    }


@router.get("/replay/compare")
def replay_compare(
    station_ids: str = Query(...),
    time_a: datetime = Query(...),
    time_b: datetime = Query(...),
    parameter: str = Query("pm25"),
    window_s: int = Query(900, ge=60, le=6 * 3600),
) -> dict:
    """Two instants side by side (§4.12/§4.13).

    Each side is the mean over ``window_s`` centred on its instant, not the single nearest
    point: at 30 s cadence one sample is noise, and a difference computed from two noisy
    samples reads as a change that never happened.
    """
    stations = _split(station_ids)
    if parameter not in PARAMETERS:
        raise HTTPException(400, f"unknown parameter: {parameter}")
    if not stations:
        raise HTTPException(400, "at least one station_id is required")

    field = PARAMETERS[parameter][0]
    half = timedelta(seconds=window_s / 2)

    def mean_at(t: datetime) -> dict[str, float | None]:
        data = series_between(stations, t - half, t + half, [field])
        out: dict[str, float | None] = {}
        for s in stations:
            rows = data.get(s, {}).get(field, [])
            out[s] = round(sum(v for _, v in rows) / len(rows), 3) if rows else None
        return out

    a, b = mean_at(time_a), mean_at(time_b)
    rows = []
    for s in stations:
        va, vb = a[s], b[s]
        diff = pct = None
        if va is not None and vb is not None:
            diff = round(vb - va, 3)
            # Percentage change is undefined against a zero baseline, and reporting one there
            # would turn "was nothing, now something" into an infinite rise.
            pct = round((vb - va) / va * 100, 2) if va != 0 else None
        rows.append({
            "station_id": s, "value_a": va, "value_b": vb,
            "difference": diff, "percent_change": pct,
            "status": "ok" if diff is not None else "no_data",
        })
    return {
        "parameter": parameter,
        "unit": PARAMETERS[parameter][1],
        "time_a": time_a.isoformat(),
        "time_b": time_b.isoformat(),
        "window_s": window_s,
        "rows": rows,
    }


@router.get("/replay/export.csv", response_class=PlainTextResponse)
def replay_export_csv(
    station_ids: str = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    parameters: str = Query("pm25,co2,tvoc,temperature,humidity"),
    interval: str | None = Query(None),
) -> StreamingResponse:
    """§4.19 — one row per (timestamp, station).

    An empty cell means the station recorded nothing in that window. It is deliberately left
    empty rather than written as 0, so a spreadsheet cannot average an outage into the data.
    """
    stations, params = _split(station_ids), _split(parameters)
    _validate(stations, params, start, end)
    resolved, _ = _resolve_interval(start, end, interval)
    fields = [PARAMETERS[p][0] for p in params]
    data = aggregate_between(stations, start, end, fields, resolved)

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["timestamp", "station_id", *params])
    for frame in _frames(data, params):
        for station, values in sorted(frame["stations"].items()):
            writer.writerow([frame["timestamp"], station,
                             *("" if values.get(p) is None else values[p] for p in params)])

    filename = f"aeris-replay-{start:%Y%m%d-%H%M}-{end:%Y%m%d-%H%M}-{resolved}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/replay/export.json")
def replay_export_json(
    station_ids: str = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    parameters: str = Query("pm25,co2,tvoc,temperature,humidity"),
    interval: str | None = Query(None),
) -> StreamingResponse:
    """§4.19 — the same frames as /replay/data, delivered as a download."""
    payload = replay_data(station_ids, start, end, parameters, interval)
    filename = f"aeris-replay-{start:%Y%m%d-%H%M}-{end:%Y%m%d-%H%M}.json"
    return StreamingResponse(
        iter([json.dumps(payload, ensure_ascii=False, indent=1)]),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class BookmarkPayload(BaseModel):
    timestamp: datetime
    station_id: str | None = None
    parameter: str | None = None
    title: str = Field(..., min_length=1, max_length=255)
    note: str | None = None


@router.post("/replay/bookmarks")
def create_bookmark(payload: BookmarkPayload, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    rows = repo.add_bookmark(sub, {
        "timestamp": payload.timestamp.isoformat(),
        "station_id": payload.station_id,
        "parameter": payload.parameter,
        "title": payload.title,
        "note": payload.note,
    })
    return {"created": True, "bookmark": rows[0] if rows else None}


@router.get("/replay/bookmarks")
def get_bookmarks(
    limit: int = Query(100, ge=1, le=500), user: dict = Depends(require_user)
) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    return {"bookmarks": repo.list_bookmarks(sub, limit)}


@router.delete("/replay/bookmarks/{bookmark_id}")
def remove_bookmark(bookmark_id: str, user: dict = Depends(require_user)) -> dict:
    sub = user.get("sub")
    if not sub:
        raise HTTPException(401, "token has no subject")
    repo.delete_bookmark(sub, bookmark_id)
    return {"deleted": True, "id": bookmark_id}


@router.get("/replay/stations")
def replay_stations() -> dict:
    """Stations offerable in the picker, with the span each one actually covers."""
    now = now_utc()
    return {
        "stations": [
            {
                "node_code": n.node_code,
                "name": n.name,
                "lat": n.lat,
                "lon": n.lon,
                "active": n.sensor_healthy,
                "last_seen": n.last_seen.isoformat() if n.last_seen else None,
            }
            for n in repo.get_node_contexts(now)
        ],
        "intervals": INTERVALS,
        "parameters": {p: {"unit": u} for p, (_, u) in PARAMETERS.items()},
        "max_frames": MAX_FRAMES,
        "max_span_days": MAX_SPAN_DAYS,
    }
