"""HMAC webhook auth — signed accept, tampered reject, dev-mode passthrough."""
from __future__ import annotations

from ingestion.app import hmac_util
from ingestion.app.hmac_util import sign, verify_signature


def test_valid_signature_accepted(monkeypatch):
    monkeypatch.setattr(hmac_util.settings, "WEBHOOK_SECRET", "s3cret")
    body = b'{"a":1}'
    assert verify_signature(body, sign(body, "s3cret")) is True


def test_tampered_or_missing_signature_rejected(monkeypatch):
    monkeypatch.setattr(hmac_util.settings, "WEBHOOK_SECRET", "s3cret")
    body = b'{"a":1}'
    assert verify_signature(body, "deadbeef") is False
    assert verify_signature(body, None) is False
    assert verify_signature(b'{"a":2}', sign(body, "s3cret")) is False  # body changed


def test_empty_secret_is_dev_mode(monkeypatch):
    monkeypatch.setattr(hmac_util.settings, "WEBHOOK_SECRET", "")
    assert verify_signature(b"anything", None) is True  # dev mode accepts + warns
