"""Bridge unit tests — topic routing, signing, byte-for-byte forwarding (no broker, no network)."""
from __future__ import annotations

import httpx
import pytest

from ingestion.app.hmac_util import settings, sign
from ingestion.mqtt_bridge import Bridge, _endpoint_for, _topics


class _FakeHTTP:
    """Stands in for httpx.Client — records the request instead of sending it."""

    def __init__(self, status=200, body=None, raises=None):
        self.status, self.body, self.raises = status, body or {"accepted": True}, raises
        self.calls: list[tuple[str, bytes, dict]] = []

    def post(self, url, content, headers):
        self.calls.append((url, content, headers))
        if self.raises:
            raise self.raises
        return httpx.Response(self.status, json=self.body)

    def close(self):
        pass


def _bridge(http):
    b = Bridge("https://api.test", "airsentinel-trat")
    b.http = http
    return b


def test_topics_match_station_firmware_tree():
    # firmware/station/mqtt.h publishes <org>/airsentinel/<node_id>/<kind>
    assert _topics("airsentinel-trat") == [
        "airsentinel-trat/airsentinel/+/telemetry",
        "airsentinel-trat/airsentinel/+/alert",
    ]


@pytest.mark.parametrize(
    ("topic", "endpoint"),
    [
        ("airsentinel-trat/airsentinel/BKK-TRT-003/telemetry", "/webhook/telemetry"),
        ("airsentinel-trat/airsentinel/BKK-TRT-003/alert", "/webhook/alert"),
        # health is device metadata, not a reading — must not be forwarded as telemetry
        ("airsentinel-trat/airsentinel/BKK-TRT-003/health", None),
    ],
)
def test_endpoint_routing(topic, endpoint):
    assert _endpoint_for(topic) == endpoint


def test_payload_is_forwarded_verbatim_and_signed(monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_SECRET", "s3cret")
    raw = b'{"node_id":"BKK-TRT-003","sensors":{"pm2_5":{"value":12.5}}}'
    http = _FakeHTTP(body={"accepted": True, "device_id": "BKK-TRT-003"})
    _bridge(http).forward("/webhook/telemetry", raw)

    url, content, headers = http.calls[0]
    assert url == "https://api.test/webhook/telemetry"
    # the signature covers the broker's bytes, so re-serializing here would break verification
    assert content == raw
    assert headers["X-Signature"] == sign(raw, "s3cret")


def test_unsigned_when_secret_is_empty(monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_SECRET", "")
    http = _FakeHTTP()
    _bridge(http).forward("/webhook/telemetry", b"{}")
    assert "X-Signature" not in http.calls[0][2]


def test_health_topic_is_not_forwarded():
    http = _FakeHTTP()
    b = _bridge(http)

    class _Msg:
        topic = "airsentinel-trat/airsentinel/BKK-TRT-003/health"
        payload = b'{"battery_pct":100}'

    b.on_message(None, None, _Msg())
    assert http.calls == []


def test_transport_error_drops_the_sample_instead_of_raising():
    # a stale replay would land under a fresh timestamp and look like current air
    http = _FakeHTTP(raises=httpx.ConnectTimeout("boom"))
    assert _bridge(http).forward("/webhook/telemetry", b"{}") is None


def test_rejected_payload_is_reported_not_raised():
    http = _FakeHTTP(body={"accepted": False, "error": "invalid signature"})
    body = _bridge(http).forward("/webhook/telemetry", b"{}")
    assert body["accepted"] is False
