"""§5.4 personal baseline — insufficient sample vs ready; robust comparison."""
from __future__ import annotations

from intelligence.baseline import build_baseline
from intelligence.config import CONFIG


def test_insufficient_sample_does_not_personalize():
    b = build_baseline([10.0] * (CONFIG.baseline_min_samples - 1))
    assert b.ready is False
    assert b.median is None and b.upper is None
    assert b.is_above(999.0) is False  # cannot judge without a baseline


def test_ready_baseline_median_and_comparison():
    # tight cluster around 10 with a few mild variations -> low dispersion
    values = [10.0, 11.0, 9.0, 10.0, 12.0, 8.0] * 20  # 120 samples
    b = build_baseline(values)
    assert b.ready is True
    assert b.sample_count == 120
    assert 9.0 <= b.median <= 11.0
    assert b.is_above(b.upper + 1.0) is True
    assert b.is_above(b.median) is False


def test_baseline_robust_to_outliers():
    # a handful of huge spikes must not blow up the personal range (median/MAD based)
    values = [10.0] * 100 + [500.0] * 5
    b = build_baseline(values)
    assert b.ready is True
    assert b.median == 10.0  # median unaffected by the 5 outliers
