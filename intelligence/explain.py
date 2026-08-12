"""§5.8 Explainability — serialize a decision and enforce the "no SAFE" guard.

Every decision event that leaves the backend carries decision, confidence, reason_codes,
freshness and sample size. ``assert_no_medical_safe`` is a defensive check used in tests and
at the serialization boundary so the banned medical-assurance word "SAFE" can never ship
(TDD §7, §14).
"""
from __future__ import annotations

from .models import DecisionEvent

# Allowed watch labels (TDD §7) — "SAFE" is deliberately absent.
ALLOWED_WATCH_LABELS = {"Normal", "Caution", "High", "No Data"}
_BANNED_WORD = "SAFE"


def to_contract(event: DecisionEvent) -> dict:
    """The §4.1 decision-event shape plus explainability fields."""
    payload = {
        "decision": event.decision.value,
        "confidence": event.confidence.value,
        "reason_codes": list(event.reason_codes),
        "freshness_sec": event.freshness_sec,
        "sample_size": event.sample_size,
        "watch_label": event.watch_label,
    }
    assert_no_medical_safe(payload)
    return payload


def assert_no_medical_safe(payload) -> None:
    """Raise if any human-facing string asserts medical safety via the word 'SAFE'.

    Reason codes are machine identifiers and are exempt; the check targets human-facing
    fields (decision, watch_label) where 'SAFE' would read as a medical guarantee.
    """
    human_facing = [str(payload.get("decision", "")), str(payload.get("watch_label", ""))]
    for text in human_facing:
        if _BANNED_WORD in text.upper():
            raise ValueError(f"medical-safety violation: banned assurance word in {text!r}")
    if payload.get("watch_label") not in ALLOWED_WATCH_LABELS:
        raise ValueError(f"invalid watch label {payload.get('watch_label')!r}")
