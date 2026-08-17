"""Station MQTT -> Aeris HTTP bridge (the `mqtt_bridge` named in docs/DECISIONS.md).

A Render free web service sleeps and cannot hold a long-lived MQTT connection, and HiveMQ
Cloud's free plan has no native webhook, so nothing was actually carrying station telemetry
from HiveMQ into the API: the station published to MQTT and the readings were never ingested.
This process closes that gap. It runs on an always-on host (station gateway or a local PC),
subscribes to the station topics, HMAC-signs each raw payload exactly as
``ingestion/app/hmac_util.py`` expects, and POSTs it to ``/webhook/telemetry`` (or
``/webhook/alert``).

The payload is forwarded byte-for-byte: the signature is computed over the bytes that arrive
from the broker, so re-serializing here would break verification. Validation, quality gating
and storage all stay in the API — this file only moves bytes.

Run:
    python -m ingestion.mqtt_bridge                      # -> AERIS_API_BASE (or Render URL)
    python -m ingestion.mqtt_bridge --api-base http://127.0.0.1:8000
"""
from __future__ import annotations

import argparse
import logging
import os
import ssl
import sys

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


class Bridge:
    def __init__(self, api_base: str, org: str, timeout: float = 30.0):
        self.api_base = api_base.rstrip("/")
        self.org = org
        # One client, reused: Render's free tier cold-starts, and a fresh TLS handshake per
        # message would make the first readings after a sleep time out one by one.
        self.http = httpx.Client(timeout=timeout)

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
            return None
        if r.status_code != 200:
            log.error("%s -> HTTP %s: %s", endpoint, r.status_code, r.text[:200])
            return None
        body = r.json()
        if not body.get("accepted"):
            log.error("%s rejected: %s", endpoint, body)
        else:
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

        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id="aeris-station-bridge"
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
