"""Grafana Cloud logging + metrics for every Aeris process.

Why this exists
---------------
Everything that went wrong in this system so far was silent. The station stopped publishing
and nothing said so; the bridge slept on Render's free plan and nothing said so; the API cold
-started and eleven readings were dropped without a trace anywhere anyone could see. Each was
found by someone happening to look. This module is what makes those visible without looking.

Why it is shaped this way
-------------------------
Grafana Cloud normally wants an agent (Alloy) alongside the process. There is nowhere to run
one: Render's free plan gives one container per service and no sidecar. So both signals are
plain HTTPS pushes the process makes itself —

* logs go to Loki's JSON push endpoint,
* metrics go to the Graphite plaintext endpoint, which takes ``path value timestamp`` lines
  and needs no protobuf or snappy, unlike Prometheus remote-write.

Both are batched on a background thread. Nothing here may ever block the request that produced
it, and nothing here may ever raise into it: a monitoring system that takes down the thing it
is monitoring is worse than no monitoring at all. Every failure is counted and reported to
stderr, never re-raised.

Inert without configuration
---------------------------
With no ``GRAFANA_*`` variables set, every function here is a no-op — the same rule
``WEBHOOK_SECRET`` follows. A developer running locally gets ordinary stdout logging and no
network calls, and a deploy that forgets its credentials degrades to that rather than failing.
"""
from __future__ import annotations

import atexit
import logging
import os
import queue
import threading
import time
from typing import Any

import httpx

log = logging.getLogger("aeris.observability")

# ── Configuration (all optional; unset = disabled) ──
# LOKI_URL      https://logs-prod-xxx.grafana.net/loki/api/v1/push
# GRAPHITE_URL  https://graphite-prod-xx.grafana.net/graphite/metrics
# *_USER        the datasource's numeric user id (Grafana Cloud -> the datasource -> Details)
LOKI_URL = os.getenv("GRAFANA_LOKI_URL", "")
LOKI_USER = os.getenv("GRAFANA_LOKI_USER", "")
GRAPHITE_URL = os.getenv("GRAFANA_GRAPHITE_URL", "")
GRAPHITE_USER = os.getenv("GRAFANA_GRAPHITE_USER", "")
API_TOKEN = os.getenv("GRAFANA_API_TOKEN", "")

# Which process these signals came from. Without it a dashboard cannot tell the API's view of
# a dropped reading from the bridge's, which is the difference between "the API rejected it"
# and "the API never received it".
SERVICE = os.getenv("GRAFANA_SERVICE_NAME", "aeris")
ENVIRONMENT = os.getenv("GRAFANA_ENVIRONMENT", os.getenv("RENDER_SERVICE_NAME", "local"))
METRIC_PREFIX = os.getenv("GRAFANA_METRIC_PREFIX", "aeris")

FLUSH_INTERVAL_S = float(os.getenv("GRAFANA_FLUSH_INTERVAL_S", "10"))
# Bounded so a long outage costs a fixed amount of memory instead of growing until the
# container is killed — which would take the service down to protect its telemetry.
MAX_QUEUE = int(os.getenv("GRAFANA_MAX_QUEUE", "5000"))
TIMEOUT_S = float(os.getenv("GRAFANA_TIMEOUT_S", "10"))


def logs_enabled() -> bool:
    return bool(LOKI_URL and LOKI_USER and API_TOKEN)


def metrics_enabled() -> bool:
    return bool(GRAPHITE_URL and GRAPHITE_USER and API_TOKEN)


def enabled() -> bool:
    return logs_enabled() or metrics_enabled()


class _Shipper:
    """One background thread draining two queues on a fixed interval."""

    def __init__(self) -> None:
        self._logs: queue.Queue[tuple[float, str, dict[str, str]]] = queue.Queue(MAX_QUEUE)
        self._metrics: queue.Queue[tuple[str, float, int]] = queue.Queue(MAX_QUEUE)
        self._http: httpx.Client | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.dropped = 0          # entries the queue had no room for
        self.failures = 0         # pushes the endpoint refused or never answered

    # ── producers (called from request threads; must never block) ──
    def log(self, ts: float, line: str, labels: dict[str, str]) -> None:
        try:
            self._logs.put_nowait((ts, line, labels))
        except queue.Full:
            # Dropping the newest keeps the oldest, which is where an incident starts.
            self.dropped += 1

    def metric(self, path: str, value: float, ts: int) -> None:
        try:
            self._metrics.put_nowait((path, value, ts))
        except queue.Full:
            self.dropped += 1

    # ── consumer ──
    def start(self) -> None:
        if self._thread is not None or not enabled():
            return
        self._http = httpx.Client(timeout=TIMEOUT_S)
        self._thread = threading.Thread(target=self._run, name="grafana-shipper", daemon=True)
        self._thread.start()
        atexit.register(self.shutdown)

    def _run(self) -> None:
        while not self._stop.wait(FLUSH_INTERVAL_S):
            self.flush()
        self.flush()          # one last drain on the way out

    def flush(self) -> None:
        self._flush_logs()
        self._flush_metrics()

    def _drain(self, q: queue.Queue) -> list:
        out = []
        while True:
            try:
                out.append(q.get_nowait())
            except queue.Empty:
                return out

    def _flush_logs(self) -> None:
        batch = self._drain(self._logs)
        if not batch or not logs_enabled() or self._http is None:
            return
        # Loki wants one stream per distinct label set, with entries sorted by time inside it.
        streams: dict[tuple, list[list[str]]] = {}
        for ts, line, labels in batch:
            key = tuple(sorted(labels.items()))
            streams.setdefault(key, []).append([str(int(ts * 1e9)), line])
        payload = {
            "streams": [
                {"stream": dict(key), "values": sorted(values, key=lambda v: v[0])}
                for key, values in streams.items()
            ]
        }
        try:
            r = self._http.post(LOKI_URL, json=payload, auth=(LOKI_USER, API_TOKEN))
            if r.status_code >= 300:
                self.failures += 1
                # print, not log: logging here would produce the entry that failed to ship.
                print(f"[observability] loki push {r.status_code}: {r.text[:200]}", flush=True)
        except httpx.HTTPError as e:
            self.failures += 1
            print(f"[observability] loki push failed: {e}", flush=True)

    def _flush_metrics(self) -> None:
        batch = self._drain(self._metrics)
        if not batch or not metrics_enabled() or self._http is None:
            return
        body = "\n".join(f"{path} {value} {ts}" for path, value, ts in batch)
        try:
            r = self._http.post(GRAPHITE_URL, content=body.encode(),
                                auth=(GRAPHITE_USER, API_TOKEN),
                                headers={"Content-Type": "text/plain"})
            if r.status_code >= 300:
                self.failures += 1
                print(f"[observability] graphite push {r.status_code}: {r.text[:200]}", flush=True)
        except httpx.HTTPError as e:
            self.failures += 1
            print(f"[observability] graphite push failed: {e}", flush=True)

    def shutdown(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=TIMEOUT_S)
        if self._http is not None:
            self._http.close()


_shipper = _Shipper()


class LokiHandler(logging.Handler):
    """Ships records to Loki alongside whatever else logging is doing.

    Added as an extra handler rather than replacing stdout: Render's own log viewer is the
    first place anyone looks when a deploy misbehaves, and it would be a poor trade to lose it
    in exchange for a dashboard that needs a browser and a login.
    """

    def emit(self, record: logging.LogRecord) -> None:
        try:
            _shipper.log(
                record.created,
                self.format(record),
                {
                    "service": SERVICE,
                    "environment": ENVIRONMENT,
                    "level": record.levelname.lower(),
                    "logger": record.name,
                },
            )
        except Exception:      # noqa: BLE001 — a logging handler must never raise
            pass


def _sanitize(part: str) -> str:
    """Graphite path segments are dot-delimited, so a dot inside one splits the metric."""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in str(part))


def metric(name: str, value: float, tags: dict[str, Any] | None = None) -> None:
    """Record one metric sample.

    ``tags`` become Graphite tags (``name;k=v``), which Grafana Cloud indexes and can group
    by — so one ``station.freshness_sec`` series per node rather than a metric name per node.
    """
    if not metrics_enabled():
        return
    path = f"{METRIC_PREFIX}.{_sanitize(SERVICE)}.{name}"
    if tags:
        path += "".join(f";{_sanitize(k)}={_sanitize(v)}" for k, v in tags.items())
    _shipper.metric(path, float(value), int(time.time()))


def init(service: str | None = None) -> bool:
    """Attach the Loki handler and start the shipper. Returns whether anything was enabled.

    Safe to call more than once; the second call is a no-op.
    """
    global SERVICE
    if service:
        SERVICE = service
    if not enabled():
        log.info("Grafana Cloud not configured — logging stays local, metrics are dropped")
        return False

    root = logging.getLogger()
    if not any(isinstance(h, LokiHandler) for h in root.handlers):
        handler = LokiHandler()
        handler.setFormatter(logging.Formatter("%(name)s: %(message)s"))
        root.addHandler(handler)
    _shipper.start()
    log.info(
        "Grafana Cloud enabled (logs=%s metrics=%s service=%s environment=%s)",
        logs_enabled(), metrics_enabled(), SERVICE, ENVIRONMENT,
    )
    return True


def health() -> dict:
    """What the shipper itself is doing — surfaced on /health so a blind spot is visible.

    Monitoring that has quietly stopped shipping looks exactly like a system with nothing to
    report, and the two must be distinguishable from outside the process.
    """
    return {
        "logs": logs_enabled(),
        "metrics": metrics_enabled(),
        "service": SERVICE,
        "environment": ENVIRONMENT,
        "dropped": _shipper.dropped,
        "push_failures": _shipper.failures,
    }


def flush() -> None:
    """Ship whatever is queued right now. For tests and for shutdown paths."""
    _shipper.flush()
