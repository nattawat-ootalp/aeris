"""Compose the intelligence pipeline over a device's recent readings → an explainable decision.

Stateless per call: persistence (§5.7) is replayed over the ordered history so the result is
deterministic and testable. Freshness is judged on the LATEST reading only — a stale latest
reading yields NO_DATA regardless of past state (TDD §5.6, §14).
"""
from __future__ import annotations

from datetime import datetime

from intelligence.baseline import build_baseline
from intelligence.decision import decide
from intelligence.environmental import classify_env
from intelligence.explain import to_contract
from intelligence.exposure import aggregate_exposure
from intelligence.models import Decision, Reading
from intelligence.persistence import PersistenceEngine
from intelligence.quality import assess_quality

# Sensor fields the contract always carries. Present even with no data, as explicit nulls:
# a missing key reads as `undefined` in the client and is indistinguishable from a field the
# app forgot to request, whereas null says "no reading" (§5.6, §14).
SENSOR_FIELDS = ("pm25", "temperature", "humidity", "co2", "tvoc", "eco2")


def _no_data() -> dict:
    from intelligence.models import Confidence, DecisionEvent, Reason
    ev = DecisionEvent(
        decision=Decision.NO_DATA, confidence=Confidence.LOW,
        reason_codes=[Reason.NO_VALID_DATA], freshness_sec=None, sample_size=0,
        watch_label="No Data",
    )
    contract = to_contract(ev)
    contract.update(dict.fromkeys(SENSOR_FIELDS))
    contract["measured_at"] = None
    return contract


def evaluate_readings(
    readings: list[Reading],
    now: datetime,
    baseline_values: list[float] | None = None,
) -> dict:
    """Return an explainable decision-event dict (§4.1) for the device's latest state."""
    if not readings:
        return _no_data()

    ordered = sorted(readings, key=lambda r: r.timestamp)
    latest = ordered[-1]
    previous = ordered[-2] if len(ordered) > 1 else None

    # replay persistence using each reading's PM validity at its own time (freshness ignored here)
    persist = PersistenceEngine()
    prev = None
    valid_points: list[tuple[datetime, float]] = []
    for r in ordered:
        qr = assess_quality(r, now=r.timestamp, previous=prev)
        env_r = classify_env(r.pm25 if qr.pm25_valid else None)[0]
        persist.update(env_r, r.timestamp)
        if qr.pm25_valid and r.pm25 is not None:
            valid_points.append((r.timestamp, r.pm25))
        prev = r
    stable_env = persist.state

    # final gate on the latest reading (freshness matters here)
    latest_quality = assess_quality(latest, now=now, previous=previous)
    baseline = build_baseline(baseline_values) if baseline_values is not None else None
    exposure = aggregate_exposure(valid_points) if valid_points else None

    event = decide(
        latest_quality,
        stable_env if latest_quality.usable else stable_env,
        latest.pm25 if latest_quality.pm25_valid else None,
        baseline=baseline,
        exposure=exposure,
    )
    contract = to_contract(event)
    contract["pm25"] = latest.pm25 if latest_quality.pm25_valid else None
    contract["temperature"] = latest.temperature
    contract["humidity"] = latest.humidity
    contract["tvoc"] = latest.tvoc
    contract["co2"] = latest.co2
    contract["eco2"] = latest.eco2
    # When the reading was actually taken, so the app can show a clock time rather than only
    # an age. freshness_sec stays the authority on whether it counts as current — a timestamp
    # alone would let a stale value look like a present one (§5.6).
    contract["measured_at"] = latest.timestamp.isoformat()
    return contract
