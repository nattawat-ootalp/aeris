"""HMAC verification for the HiveMQ webhook.

# reused from AirSentinel — the bridge signs the raw body with HMAC-SHA256 and sends it as
`X-Signature: <hex>`. Empty WEBHOOK_SECRET = dev mode (accept, log a warning). Uses a
constant-time comparison so a wrong signature can't be timed.
"""
from __future__ import annotations

import hmac
import logging
from hashlib import sha256

from .config import settings

log = logging.getLogger("aeris.ingestion")


def sign(raw_body: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), raw_body, sha256).hexdigest()


def verify_signature(raw_body: bytes, signature: str | None) -> bool:
    """Return True if the request is allowed to proceed."""
    secret = settings.WEBHOOK_SECRET
    if not secret:
        log.warning("WEBHOOK_SECRET is empty — accepting webhook in DEV mode (do not use in prod)")
        return True
    if not signature:
        return False
    expected = sign(raw_body, secret)
    return hmac.compare_digest(expected, signature)
