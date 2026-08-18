"""Station MQTT -> Aeris HTTP bridge (the `mqtt_bridge` named in docs/DECISIONS.md).

HiveMQ Cloud's free plan has no native webhook, so nothing was actually carrying station
telemetry from HiveMQ into the API: the station published to MQTT and the readings were never
ingested. This process closes that gap. It subscribes to the station topics, HMAC-signs each
raw payload exactly as ``ingestion/app/hmac_util.py`` expects, and POSTs it to
``/webhook/telemetry`` (or ``/webhook/alert``).

The payload is forwarded byte-for-byte: the signature is computed over the bytes that arrive
from the broker, so re-serializing here would break verification. Validation, quality gating
and storage all stay in the API — this file only moves bytes.

Hosting: setting ``PORT`` starts a tiny status HTTP server alongside the MQTT loop, which is
what lets this run as a Render *free web service* rather than needing a paid background worker
or a PC left switched on (the same arrangement AirSentinel uses, ``backend/mqtt_bridge.py``).
A free web service still sleeps on idle, so an external pinger must poll ``/`` to keep it up;
the status body reports the forward counters so the ping doubles as a liveness check.

Run:
    python -m ingestion.mqtt_bridge                      # -> AERIS_API_BASE (or Render URL)
    python -m ingestion.mqtt_bridge --api-base http://127.0.0.1:8000
    PORT=8080 python -m ingestion.mqtt_bridge            # + status endpoint on :8080
"""
from __future__ import annotations

import argparse
import http.server
import json
import logging
import os
import ssl
import sys
import threading

import httpx
import paho.mqtt.client as mqtt

from ingestion.app.config import settings
from ingestion.app.hmac_util import sign

log = logging.getLogger("aeris.bridge")

DEFAULT_API_BASE = os.getenv("AERIS_API_BASE", "https://aeris-core-api.onrender.com")
# Topic tree is fixed by the station firmware (firmware/station/mqtt.h):
#   <org>/airsentinel/<node_id>/{telemetry,alert,health}
STATION_ORG = os.getenv("STATION_ORG", "airsentinel-trat")


def _topics(org: str) -> list[str]:
    return [f"{org}/airsentinel/+/telemetry", f"{org}/airsentinel/+/alert"]


def _endpoint_for(topic: str) -> str | None:
    if topic.endswith("/telemetry"):
        return "/webhook/telemetry"
    if topic.endswith("/alert"):
        return "/webhook/alert"
    return None  # /health is device metadata, not a reading — nothing to ingest


def start_status_server(bridge: "Bridge", port: int) -> None:
    """Serve a small JSON status page so this can be a Render free *web* service.

    Render's free plan has no background worker, and it only keeps a service running if
    something is listening on ``$PORT``. The MQTT loop is the real work; this is the port
    binding that makes the platform host it, and the target for the keep-alive pinger.
    """

    class StatusHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler's name
            body = json.dumps({
                "status": "bridge alive",
                "api_base": bridge.api_base,
                "org": bridge.org,
                "forwarded": bridge.forwarded,
                "failed": bridge.failed,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            # A pinger hits this every few minutes; its access lines would bury the MQTT log.
            pass

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), StatusHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log.info("status endpoint on :%d", port)


class Bridge:
    def __init__(self, api_base: str, org: str, timeout: float = 30.0):
        self.api_base = api_base.rstrip("/")
        self.org = org
        # One client, reused: Render's free tier cold-starts, and a fresh TLS handshake per
        # message would make the first readings after a sleep time out one by one.
        self.http = httpx.Client(timeout=timeout)
        # Reported by the status endpoint so a keep-alive ping also answers "is it ingesting?"
        self.forwarded = 0
        self.failed = 0

    # ── MQTT callbacks ──
    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code != 0:
            log.error("MQTT connect refused: %s", reason_code)
            return
        for t in _topics(self.org):
            client.subscribe(t, qos=1)
            log.info("subscribed %s", t)

    def on_disconnect(self, client, userdata, flags, reason_code, properties=None):
        # paho's reconnect_delay_set below handles the retry; just make the gap visible.
        log.warning("MQTT disconnected (%s) — retrying", reason_code)

    def on_message(self, client, userdata, msg):
        endpoint = _endpoint_for(msg.topic)
        if endpoint is None:
            return
        self.forward(endpoint, msg.payload, msg.topic)

    # ── HTTP forward ──
    def forward(self, endpoint: str, raw: bytes, topic: str = "") -> dict | None:
        headers = {"Content-Type": "application/json"}
        if settings.WEBHOOK_SECRET:
            headers["X-Signature"] = sign(raw, settings.WEBHOOK_SECRET)
        try:
            r = self.http.post(self.api_base + endpoint, content=raw, headers=headers)
        except httpx.HTTPError as e:
            # Dropping one sample is correct: the station publishes every 30 s and a stale
            # replay would land under a fresh timestamp and look like current air.
            log.error("%s POST failed (%s): %s", endpoint, topic, e)
            self.failed += 1
            return None
        if r.status_code != 200:
            log.error("%s -> HTTP %s: %s", endpoint, r.status_code, r.text[:200])
            self.failed += 1
            return None
        body = r.json()
        if not body.get("accepted"):
            log.error("%s rejected: %s", endpoint, body)
            self.failed += 1
        else:
            self.forwarded += 1
            log.info(
                "ingested %s pm25_valid=%s usable=%s",
                body.get("device_id") or body.get("node_id"),
                body.get("pm25_valid"),
                body.get("usable"),
            )
        return body

    def run(self) -> int:
        missing = [
            k
            for k in ("HIVEMQ_HOST", "HIVEMQ_USERNAME", "HIVEMQ_PASSWORD")
            if not getattr(settings, k)
        ]
        if missing:
            log.error("missing env: %s (see .env.example)", ", ".join(missing))
            return 2
        if not settings.WEBHOOK_SECRET:
            log.warning("WEBHOOK_SECRET is empty — payloads go unsigned (dev mode only)")

        port = int(os.getenv("PORT", "0"))
        if port:
            start_status_server(self, port)

        # The id must be unique per instance. HiveMQ evicts an existing session on a duplicate
        # id, so a fixed one makes a local bridge and a hosted bridge kick each other off in a
        # loop — each reconnect disconnecting the other, and telemetry lost in every gap.
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"aeris-station-bridge-{os.urandom(4).hex()}",
        )
        client.username_pw_set(settings.HIVEMQ_USERNAME, settings.HIVEMQ_PASSWORD)
        client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
        client.on_connect = self.on_connect
        client.on_disconnect = self.on_disconnect
        client.on_message = self.on_message
        client.reconnect_delay_set(min_delay=1, max_delay=60)
        log.info(
            "connecting %s:%s -> %s", settings.HIVEMQ_HOST, settings.HIVEMQ_PORT, self.api_base
        )
        client.connect(settings.HIVEMQ_HOST, settings.HIVEMQ_PORT, keepalive=60)
        try:
            client.loop_forever(retry_first_connection=True)
        except KeyboardInterrupt:
            log.info("stopping")
        finally:
            client.disconnect()
            self.http.close()
        return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Bridge station MQTT telemetry into the Aeris API")
    ap.add_argument("--api-base", default=DEFAULT_API_BASE)
    ap.add_argument("--org", default=STATION_ORG)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return Bridge(args.api_base, args.org).run()


if __name__ == "__main__":
    sys.exit(main())
