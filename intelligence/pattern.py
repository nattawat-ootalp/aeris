"""§5.5 Pattern Detection — an *observational* association, never a cause.

Reports the fraction of symptom events that were preceded by elevated exposure within a
window, with sample size and an uncertainty band. Hard rule (TDD §5.5, §14): every pattern
carries sample_size and uncertainty and is labelled observational — it is never converted
into a medical probability or a causal claim.
"""
from __future__ import annotations

from datetime import datetime
from math import sqrt

from .config import CONFIG, IntelligenceConfig
from .models import Pattern


def detect_pattern(
    symptom_times: list[datetime],
    exposure_event_times: list[datetime],
    cfg: IntelligenceConfig = CONFIG,
) -> Pattern:
    n = len(symptom_times)
    if n == 0:
        return Pattern(sample_size=0, association=None, uncertainty=None, sufficient=False)

    window = cfg.pattern_window_sec
    exposures = sorted(exposure_event_times)
    co = 0
    for s in symptom_times:
        preceded = any(0 <= (s - e).total_seconds() <= window for e in exposures)
        if preceded:
            co += 1

    p = co / n
    # normal-approximation half-width of the proportion (95%); honest about small n
    uncertainty = 1.96 * sqrt(p * (1 - p) / n) if n > 0 else None
    return Pattern(
        sample_size=n,
        association=p,
        uncertainty=uncertainty,
        sufficient=n >= cfg.pattern_min_samples,
    )
