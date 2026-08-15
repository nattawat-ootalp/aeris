"""§5.9 Personalized Risk Score — a *systemic* indicator, never a medical assessment.

The software design calls for one number that combines environmental exposure, temporal
features and the user's own symptom history, because a single shared threshold does not
describe every user (their triggers differ). This module produces that number under the
project's hard safety rules (TDD §1.2, §9, §14):

- the score is an **engineering** aggregate of observed signals; it is not a probability of
  an attack, a diagnosis, or a medical severity;
- it is only produced from data that already passed the §5.1 quality gate. Invalid or stale
  PM never contributes — the result is NO_DATA instead of a lower score, because a missing
  input is not evidence of low exposure;
- every score carries its components, sample size, confidence and reason codes, so the UI can
  always show *why*, and it degrades to NO_DATA rather than guessing;
- personal history only ever *adds* weight to what the environment already shows. It can not
  by itself raise the band, since symptom reports have many causes this system cannot observe.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .config import CONFIG, IntelligenceConfig
from .models import Baseline, Confidence, Decision, ExposureWindow, Reason


@dataclass
class RiskScore:
    """Systemic risk indicator (0–100) with the parts it was built from.

    ``score is None`` whenever ``decision`` is NO_DATA — there is deliberately no "0" for
    "we do not know", because a zero reads as a reassurance the system cannot give.
    """
    score: float | None
    decision: Decision
    confidence: Confidence
    reason_codes: list[str]
    sample_size: int
    components: dict[str, float] = field(default_factory=dict)
    note: str = (
        "systemic indicator combining environmental exposure and your own recorded history; "
        "not a medical assessment, diagnosis, or probability of illness"
    )


def _env_component(mean_pm25: float | None, cfg: IntelligenceConfig) -> float:
    """0–1 from measured exposure, saturating at the environmental HIGH threshold."""
    if mean_pm25 is None:
        return 0.0
    if mean_pm25 <= 0:
        return 0.0
    return min(1.0, mean_pm25 / cfg.pm25_env_high)


def _duration_component(window: ExposureWindow, cfg: IntelligenceConfig) -> float:
    """0–1 from how much of the covered time was spent above the concern level.

    Uses covered time, never wall-clock time, so a gap in coverage cannot look like clean air.
    """
    if window.covered_sec <= 0:
        return 0.0
    return min(1.0, window.duration_above_concern_sec / window.covered_sec)


def _baseline_component(mean_pm25: float | None, baseline: Baseline) -> float:
    """0–1 for how far current exposure sits above *this user's* usual exposure.

    Returns 0 while the baseline is still building — an unready baseline is unknown, not low.
    """
    if not baseline.ready or baseline.upper is None or baseline.median is None:
        return 0.0
    if mean_pm25 is None or mean_pm25 <= baseline.upper:
        return 0.0
    span = max(baseline.upper - baseline.median, 1e-6)
    return min(1.0, (mean_pm25 - baseline.upper) / span)


def _history_component(
    symptom_times: list[datetime],
    now: datetime,
    cfg: IntelligenceConfig,
) -> tuple[float, int]:
    """0–1 from how many symptom events the user recorded in the recent history window.

    Saturates at ``risk_history_saturation_events`` so a user who records diligently is not
    permanently scored higher than one who records rarely.
    """
    since = now - timedelta(seconds=cfg.risk_history_window_sec)
    recent = [t for t in symptom_times if since <= t <= now]
    n = len(recent)
    if n == 0:
        return 0.0, 0
    return min(1.0, n / cfg.risk_history_saturation_events), n


def _temporal_component(
    symptom_times: list[datetime],
    now: datetime,
    cfg: IntelligenceConfig,
) -> float:
    """0–1 for "this user has recorded symptoms around this hour before".

    A purely observational time-of-day feature over the user's own history. It needs
    ``risk_temporal_min_events`` events before it contributes at all, so one late-night entry
    never marks every night as elevated.
    """
    if len(symptom_times) < cfg.risk_temporal_min_events:
        return 0.0
    half = cfg.risk_temporal_window_hours
    matches = 0
    for t in symptom_times:
        diff = abs(t.hour - now.hour)
        circular = min(diff, 24 - diff)      # 23:00 and 01:00 are 2 h apart, not 22
        if circular <= half:
            matches += 1
    return min(1.0, matches / len(symptom_times))


def compute_risk(
    *,
    now: datetime,
    usable: bool,
    freshness_sec: float | None,
    window: ExposureWindow,
    baseline: Baseline,
    symptom_times: list[datetime] | None = None,
    quality_reasons: list[str] | None = None,
    cfg: IntelligenceConfig = CONFIG,
) -> RiskScore:
    """Combine the observed signals into one systemic score.

    ``usable`` is the §5.1 gate result. When it is False (invalid PM, stale, or nothing
    recorded) the score is NO_DATA — the components are not partially summed, because a score
    built from a missing measurement would be indistinguishable from a measured low one.
    """
    symptom_times = symptom_times or []
    reasons: list[str] = []

    if not usable or window.sample_count == 0:
        reasons = list(quality_reasons or []) or [Reason.NO_VALID_DATA]
        return RiskScore(
            score=None,
            decision=Decision.NO_DATA,
            confidence=Confidence.LOW,
            reason_codes=reasons,
            sample_size=window.sample_count,
        )

    env = _env_component(window.mean_pm25, cfg)
    duration = _duration_component(window, cfg)
    above_baseline = _baseline_component(window.mean_pm25, baseline)
    history, recent_events = _history_component(symptom_times, now, cfg)
    temporal = _temporal_component(symptom_times, now, cfg)

    components = {
        "environmental": env,
        "duration": duration,
        "personal_baseline": above_baseline,
        "symptom_history": history,
        "temporal": temporal,
    }
    weighted = (
        cfg.risk_w_environmental * env
        + cfg.risk_w_duration * duration
        + cfg.risk_w_baseline * above_baseline
        + cfg.risk_w_history * history
        + cfg.risk_w_temporal * temporal
    )
    total_weight = (
        cfg.risk_w_environmental
        + cfg.risk_w_duration
        + cfg.risk_w_baseline
        + cfg.risk_w_history
        + cfg.risk_w_temporal
    )
    score = round(100.0 * weighted / total_weight, 1)

    # ── Reason codes: what actually pushed the score up ──
    if window.mean_pm25 is not None:
        if window.mean_pm25 >= cfg.pm25_env_high:
            reasons.append(Reason.PM25_ABOVE_ENV_HIGH)
        elif window.mean_pm25 >= cfg.pm25_env_caution:
            reasons.append(Reason.PM25_ABOVE_ENV_CAUTION)
    if above_baseline > 0:
        reasons.append(Reason.PM25_ABOVE_PERSONAL_BASELINE)
    elif not baseline.ready:
        reasons.append(Reason.BASELINE_INSUFFICIENT_SAMPLE)
    if duration > 0:
        reasons.append(Reason.PERSONAL_EXPOSURE_ELEVATED)
    if history > 0:
        reasons.append(Reason.SYMPTOM_HISTORY_RECENT)
    if temporal > 0:
        reasons.append(Reason.TEMPORAL_PATTERN_MATCH)
    if not reasons:
        reasons.append(Reason.ENV_NORMAL)

    # ── Band ──
    # The band is capped by what the environment itself shows. Personal history refines the
    # score inside a band; it may not promote a clean environment into a warning, because the
    # cause of a recorded symptom is not observable here (§14, non-diagnostic).
    band = Decision.NORMAL
    if score >= cfg.risk_high_score:
        band = Decision.HIGH
    elif score >= cfg.risk_caution_score:
        band = Decision.CAUTION

    env_cap = Decision.NORMAL
    if window.mean_pm25 is not None:
        if window.mean_pm25 >= cfg.pm25_env_high:
            env_cap = Decision.HIGH
        elif window.mean_pm25 >= cfg.pm25_env_caution:
            env_cap = Decision.CAUTION
    order = {Decision.NORMAL: 0, Decision.CAUTION: 1, Decision.HIGH: 2}
    if order[band] > order[env_cap]:
        band = env_cap

    # ── Confidence: how much of the score rests on data we actually have ──
    fresh = freshness_sec is not None and freshness_sec <= cfg.freshness_max_age_sec
    if not fresh:
        confidence = Confidence.LOW
    elif baseline.ready and recent_events > 0 and window.sample_count >= cfg.risk_min_samples:
        confidence = Confidence.HIGH
    elif window.sample_count >= cfg.risk_min_samples:
        confidence = Confidence.MEDIUM
    else:
        confidence = Confidence.LOW

    return RiskScore(
        score=score,
        decision=band,
        confidence=confidence,
        reason_codes=reasons,
        sample_size=window.sample_count,
        components=components,
    )
