"""§5.6 Decision Engine — turn gated data + state into an explainable, non-diagnostic decision.

Rules (TDD §5.6):
- quality too low / stale / invalid → NO_DATA / UNKNOWN (never guess a current value)
- valid + elevated state sustained (persistence) → CAUTION / HIGH
- above the personal baseline with increasing exposure duration → extra reason codes
- every decision carries reason_codes, freshness and sample size (§5.8)

Medical-safety: this function only escalates on a PM value that passed §5.1 (``quality.usable``);
an invalid PM sensor can never produce a PM-based caution.
"""
from __future__ import annotations

from .config import CONFIG, IntelligenceConfig
from .models import (
    Baseline,
    Confidence,
    Decision,
    DecisionEvent,
    EnvState,
    ExposureWindow,
    QualityResult,
    Reason,
)

_ENV_TO_DECISION = {
    EnvState.NORMAL: Decision.NORMAL,
    EnvState.CAUTION: Decision.CAUTION,
    EnvState.HIGH: Decision.HIGH,
}
_ENV_REASONS = {
    EnvState.HIGH: [Reason.PM25_ABOVE_ENV_HIGH, Reason.PM25_ABOVE_ENV_CAUTION],
    EnvState.CAUTION: [Reason.PM25_ABOVE_ENV_CAUTION],
    EnvState.NORMAL: [Reason.ENV_NORMAL],
}
WATCH_LABEL = {
    Decision.NORMAL: "Normal",
    Decision.CAUTION: "Caution",
    Decision.HIGH: "High",
    Decision.NO_DATA: "No Data",
}


def _base_confidence(quality_score: float) -> Confidence:
    if quality_score >= 0.8:
        return Confidence.HIGH
    if quality_score >= 0.5:
        return Confidence.MEDIUM
    return Confidence.LOW


def _bump(c: Confidence) -> Confidence:
    return {Confidence.LOW: Confidence.MEDIUM, Confidence.MEDIUM: Confidence.HIGH}.get(c, c)


def _cap_medium(c: Confidence) -> Confidence:
    return Confidence.MEDIUM if c == Confidence.HIGH else c


def decide(
    quality: QualityResult,
    stable_env: EnvState | None,
    pm25: float | None,
    baseline: Baseline | None = None,
    exposure: ExposureWindow | None = None,
    prev_exposure: ExposureWindow | None = None,
    cfg: IntelligenceConfig = CONFIG,
) -> DecisionEvent:
    # ── 1. no usable data → NO_DATA (stale / invalid / warm-up / missing) ──
    if not quality.usable or stable_env is None:
        reasons = list(quality.reasons) or [Reason.NO_VALID_DATA]
        return DecisionEvent(
            decision=Decision.NO_DATA,
            confidence=Confidence.LOW,
            reason_codes=_dedup(reasons),
            freshness_sec=quality.freshness_sec,
            sample_size=_sample_size(baseline, exposure),
            watch_label=WATCH_LABEL[Decision.NO_DATA],
        )

    # ── 2. environmental decision from the *stable* (persisted) state ──
    decision = _ENV_TO_DECISION[stable_env]
    reasons = list(_ENV_REASONS[stable_env])
    confidence = _base_confidence(quality.quality_score)

    # ── 3. personalization (only if baseline is ready) ──
    personalized = False
    if baseline is not None:
        if baseline.ready:
            if baseline.is_above(pm25):
                reasons += [Reason.PM25_ABOVE_PERSONAL_BASELINE, Reason.PERSONAL_EXPOSURE_ELEVATED]
                personalized = True
        else:
            reasons.append(Reason.BASELINE_INSUFFICIENT_SAMPLE)

    # ── 4. exposure duration trend ──
    if exposure is not None and prev_exposure is not None:
        if exposure.duration_above_concern_sec > prev_exposure.duration_above_concern_sec:
            reasons.append(Reason.EXPOSURE_DURATION_INCREASING)

    # ── 5. spike transparency + confidence shaping ──
    if Reason.SPIKE_SUSPECTED in quality.reasons:
        reasons.append(Reason.SPIKE_SUSPECTED)
        confidence = _cap_medium(confidence)
    if personalized:
        confidence = _bump(confidence)

    return DecisionEvent(
        decision=decision,
        confidence=confidence,
        reason_codes=_dedup(reasons),
        freshness_sec=quality.freshness_sec,
        sample_size=_sample_size(baseline, exposure),
        watch_label=WATCH_LABEL[decision],
    )


def _sample_size(baseline: Baseline | None, exposure: ExposureWindow | None) -> int:
    if baseline is not None:
        return baseline.sample_count
    if exposure is not None:
        return exposure.sample_count
    return 0


def _dedup(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out
