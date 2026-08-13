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
_SAFE = re.compile(r"[^A-Za-z0-9_\-]")


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


def latest_point(device_id: str) -> dict | None:
    dev = _safe(device_id)
    flux = f'''
from(bucket: "{settings.INFLUXDB_BUCKET}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "air_quality" and (r.device_id == "{dev}" or r.node_id == "{dev}"))
  |> last()
'''
    fields: dict = {}
    ts: datetime | None = None
    for table in _query_api().query(flux):
        for rec in table.records:
            fields[rec.get_field()] = rec.get_value()
            ts = rec.get_time()
    if not fields:
        return None
    return {"device_id": device_id, "time": ts.isoformat() if ts else None, **fields}


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
