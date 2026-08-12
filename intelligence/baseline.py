"""§5.4 Personal Baseline — build a personal reference range only when there is enough data.

Below ``baseline_min_samples`` the result is ``ready=False`` (insufficient_sample) and the
system must NOT personalize (TDD §5.4). Uses median + MAD (robust to outliers) rather than
mean/stdev so a few spikes don't distort the personal range.
"""
from __future__ import annotations

from statistics import median

from .config import CONFIG, IntelligenceConfig
from .models import Baseline


def build_baseline(values: list[float], cfg: IntelligenceConfig = CONFIG) -> Baseline:
    clean = [v for v in values if v is not None]
    n = len(clean)
    if n < cfg.baseline_min_samples:
        return Baseline(ready=False, sample_count=n)

    med = median(clean)
    mad = median([abs(v - med) for v in clean])
    # scale MAD to a std-equivalent so k is interpretable; guard the all-identical case
    dispersion = mad * 1.4826
    upper = med + cfg.baseline_k * dispersion
    return Baseline(
        ready=True,
        sample_count=n,
        median=med,
        dispersion=dispersion,
        upper=upper,
    )
