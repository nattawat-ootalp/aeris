"""§5.1 Data Quality — gate every reading BEFORE it is stored or used for a decision.

Checks freshness, missing/impossible values, sensor_status, warm-up and spikes.
Hard rule (TDD §5.1, §14): if the PM sensor is invalid, ``pm25_valid`` is False and no
downstream stage may create a PM-based caution.
"""
from __future__ import annotations

from datetime import UTC, datetime

from .config import CONFIG, IntelligenceConfig
from .models import QualityResult, Reading, Reason


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


def _impossible(value: float | None, lo: float, hi: float) -> bool:
    return value is not None and (value < lo or value > hi)


def assess_quality(
    reading: Reading,
    now: datetime | None = None,
    previous: Reading | None = None,
    cfg: IntelligenceConfig = CONFIG,
) -> QualityResult:
    now = _now(now)
    reasons: list[str] = []

    # ── freshness ──
    freshness_sec = (now - reading.timestamp).total_seconds()
    # Negative freshness means the reading is stamped ahead of this clock. A few seconds of
    # that is clock skew between the capturing device and this server, not a stale reading —
    # rejecting it threw away every live sample from a client running slightly fast.
    fresh = -cfg.clock_skew_tolerance_sec <= freshness_sec <= cfg.freshness_max_age_sec
    if not fresh:
        reasons.append(Reason.DATA_STALE)

    # ── sensor status / warm-up ──
    status = (reading.sensor_status or "").upper()
    status_ok = status == "OK"
    if status == "WARMUP":
        reasons.append(Reason.SENSOR_WARMUP)
    elif not status_ok:
        reasons.append(Reason.SENSOR_INVALID)

    # ── PM validity: missing OR impossible OR sensor not OK ──
    pm_missing = reading.pm25 is None
    pm_impossible = _impossible(reading.pm25, cfg.pm25_min, cfg.pm25_max)
    pm25_valid = (not pm_missing) and (not pm_impossible) and status_ok
    if pm_missing or pm_impossible:
        reasons.append(Reason.SENSOR_INVALID)

    # ── spike suspicion (needs a recent previous sample) ──
    if pm25_valid and previous is not None and previous.pm25 is not None:
        dt = (reading.timestamp - previous.timestamp).total_seconds()
        if 0 < dt <= cfg.spike_min_interval_sec:
            if abs(reading.pm25 - previous.pm25) > cfg.spike_delta_pm25:
                reasons.append(Reason.SPIKE_SUSPECTED)

    # ── battery (device health — kept SEPARATE from environmental usability, §3.2) ──
    battery_low = reading.battery is not None and reading.battery <= cfg.battery_low_pct

    # ── quality score: trust the device's score if present, else derive ──
    if reading.quality_score is not None:
        quality_score = max(0.0, min(1.0, reading.quality_score))
    else:
        quality_score = 1.0 if (pm25_valid and fresh) else 0.0
    if Reason.SPIKE_SUSPECTED in reasons:
        quality_score = min(quality_score, 0.5)

    # A reading is "usable" for an environmental decision only if PM is valid AND fresh.
    # (Spike-suspect stays usable but low-confidence; persistence §5.7 filters it.)
    usable = pm25_valid and fresh

    return QualityResult(
        usable=usable,
        pm25_valid=pm25_valid,
        # Reported at zero rather than negative when the capturing clock ran ahead: an age
        # below zero is not information about the air, and every consumer of this field reads
        # it as "how old" — a negative would render as a reading from the future.
        freshness_sec=max(0.0, freshness_sec),
        fresh=fresh,
        quality_score=quality_score,
        battery_low=battery_low,
        reasons=reasons,
    )
