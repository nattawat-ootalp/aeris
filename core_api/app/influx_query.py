"""InfluxDB read helpers (lazy client so importing never opens a connection).

Flux queries over the reused `air_quality` measurement. Node codes are validated/escaped
before interpolation (Flux-injection guard, carried over from AirSentinel).
"""
from __future__ import annotations

import re
from datetime import UTC, datetime

from influxdb_client import InfluxDBClient

from ingestion.app.config import settings

_client: InfluxDBClient | None = None
# Characters allowed inside an interpolated Flux string literal. Colons and dots are here
# because a paired portable's id is its BLE identifier — a MAC address on Android
# (14:C1:9F:C1:25:F5) and a UUID on iOS. Stripping the colons silently rewrote the id, so
# every device-scoped query looked for a device that had never written a point, and the app
# showed No Data while the readings sat in the bucket under the real id.
# Quotes and backslashes stay excluded: those are what could break out of the literal.
_SAFE = re.compile(r"[^A-Za-z0-9_\-:.]")


def _query_api():
    global _client
    if _client is None:
        _client = InfluxDBClient(
            url=settings.INFLUXDB_URL, token=settings.INFLUXDB_TOKEN, org=settings.INFLUXDB_ORG
        )
    return _client.query_api()


def _safe(code: str) -> str:
    """Strip anything that isn't identifier-safe before putting it in a Flux string."""
    return _SAFE.sub("", code or "")


# How far apart two fields may be and still be reported as one reading. A device writes its
# fields in the same frame, so anything beyond a wide margin is a different frame — or, as with
# BKK-TRT-003, a different series entirely that stopped writing weeks ago.
_SAME_FRAME_SEC = 900.0


def latest_point(device_id: str) -> dict | None:
    """The device's most recent reading, as one coherent frame.

    ``last()`` returns one record per series per field, and a device can have several series:
    BKK-TRT-003 is written under `node_id` by the AirSentinel path and under `device_id` by
    this one, and an abandoned `node_id` series from July still sits in the bucket. Taking
    whichever record happened to iterate last would let that July value be served as the
    current reading — the exact stale-as-current display the rest of this codebase refuses.

    So each field keeps its newest record, and any field older than the newest by more than
    ``_SAME_FRAME_SEC`` is dropped rather than mixed in. A frame missing a field reads as
    missing; a frame carrying a month-old number does not read as anything at all.
    """
    dev = _safe(device_id)
    flux = f'''
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "air_quality" and (r.device_id == "{dev}" or r.node_id == "{dev}"))
  |> last()
'''
    newest: dict[str, tuple[datetime, object]] = {}
    for table in _query_api().query(flux):
        for rec in table.records:
            field, t = rec.get_field(), rec.get_time()
            if field is None or t is None:
                continue
            if field not in newest or t > newest[field][0]:
                newest[field] = (t, rec.get_value())
    if not newest:
        return None

    ts = max(t for t, _ in newest.values())
    fields = {
        f: v for f, (t, v) in newest.items()
        if (ts - t).total_seconds() <= _SAME_FRAME_SEC
    }
    return {"device_id": device_id, "time": ts.isoformat(), **fields}


def history(device_id: str, hours: int = 24) -> list[dict]:
    dev = _safe(device_id)
    hours = max(1, min(int(hours), 24 * 90))  # cap at 90 days
    flux = f'''
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) => r._measurement == "air_quality" and (r.device_id == "{dev}" or r.node_id == "{dev}"))
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''
    out: list[dict] = []
    for table in _query_api().query(flux):
        for rec in table.records:
            row = {k: v for k, v in rec.values.items() if not k.startswith("_") or k == "_time"}
            row["time"] = rec.get_time().isoformat()
            out.append(row)
    return out


def now_utc() -> datetime:
    return datetime.now(UTC)


# ── Windowed reads (§3.7 route simulation, §4 replay) ────────────────────────────────────
#
# Both features ask the same question — "what did these devices read between these two
# instants" — and differ only in resolution. They share one Flux shape so a value shown on
# the replay timeline and the value the simulator integrates come from the same query.
#
# A device is identified by EITHER tag: AirSentinel wrote stations under `node_id` and the
# Aeris ingestion path writes them under `device_id`, so BKK-TRT-003's history spans both and
# a query that picked one tag would silently see a fraction of the series.

_INTERVAL_RE = re.compile(r"^\d+(s|m|h)$")


def _rfc3339(t: datetime) -> str:
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _device_filter(device_ids: list[str]) -> str:
    terms = [f'r.device_id == "{_safe(d)}" or r.node_id == "{_safe(d)}"' for d in device_ids]
    return " or ".join(terms) if terms else "false"


def _field_filter(fields: list[str]) -> str:
    return " or ".join(f'r._field == "{_safe(f)}"' for f in fields) if fields else "false"


def series_between(
    device_ids: list[str],
    start: datetime,
    end: datetime,
    fields: list[str],
) -> dict[str, dict[str, list[tuple[datetime, float]]]]:
    """Raw samples per device per field, sorted by time.

    Returns ``{device_id: {field: [(time, value), ...]}}``. Non-numeric values are dropped
    rather than coerced: `aqi_class` is a label, and a label averaged with another label is
    not a measurement.
    """
    if not device_ids or not fields:
        return {}
    flux = f'''
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: {_rfc3339(start)}, stop: {_rfc3339(end)})
  |> filter(fn: (r) => r._measurement == "air_quality")
  |> filter(fn: (r) => {_device_filter(device_ids)})
  |> filter(fn: (r) => {_field_filter(fields)})
  |> sort(columns: ["_time"])
'''
    out: dict[str, dict[str, list[tuple[datetime, float]]]] = {}
    for table in _query_api().query(flux):
        for rec in table.records:
            dev = rec.values.get("device_id") or rec.values.get("node_id")
            value = rec.get_value()
            if dev is None or not isinstance(value, (int, float)):
                continue
            out.setdefault(dev, {}).setdefault(rec.get_field(), []).append(
                (rec.get_time(), float(value))
            )
    for per_field in out.values():
        for rows in per_field.values():
            rows.sort(key=lambda r: r[0])
    return out


def aggregate_between(
    device_ids: list[str],
    start: datetime,
    end: datetime,
    fields: list[str],
    interval: str = "60s",
) -> dict[str, dict[str, list[tuple[datetime, float]]]]:
    """Mean per ``interval`` window (§4.17/§4.18), same shape as ``series_between``.

    ``createEmpty: false`` so a window nothing was recorded in stays absent instead of
    arriving as a zero — a gap in the replay must read as a gap, not as clean air.
    """
    if not device_ids or not fields:
        return {}
    if not _INTERVAL_RE.match(interval or ""):
        raise ValueError(f"interval must look like 30s / 5m / 1h, got {interval!r}")
    flux = f'''
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: {_rfc3339(start)}, stop: {_rfc3339(end)})
  |> filter(fn: (r) => r._measurement == "air_quality")
  |> filter(fn: (r) => {_device_filter(device_ids)})
  |> filter(fn: (r) => {_field_filter(fields)})
  |> aggregateWindow(every: {interval}, fn: mean, createEmpty: false)
  |> sort(columns: ["_time"])
'''
    out: dict[str, dict[str, list[tuple[datetime, float]]]] = {}
    for table in _query_api().query(flux):
        for rec in table.records:
            dev = rec.values.get("device_id") or rec.values.get("node_id")
            value = rec.get_value()
            if dev is None or not isinstance(value, (int, float)):
                continue
            out.setdefault(dev, {}).setdefault(rec.get_field(), []).append(
                (rec.get_time(), float(value))
            )
    for per_field in out.values():
        for rows in per_field.values():
            rows.sort(key=lambda r: r[0])
    return out
