"""§5.3 Exposure Aggregation — integrate only VALID samples over time and context.

Uses trapezoidal integration between consecutive samples, but never interpolates across a
gap larger than ``exposure_max_gap_sec``. This is the guard the TDD calls out: a single valid
point must not be treated as exposure for a whole window — with one sample the covered time
and above-concern duration are both zero.
"""
from __future__ import annotations

from datetime import datetime

from .config import CONFIG, IntelligenceConfig
from .models import ExposureWindow


def _crossing_fraction(a: float, b: float, level: float) -> float:
    """Fraction of a segment (a→b) spent at/above ``level``, assuming linear change."""
    a_hi, b_hi = a >= level, b >= level
    if a_hi and b_hi:
        return 1.0
    if not a_hi and not b_hi:
        return 0.0
    # crosses once at normalized position x = (level-a)/(b-a) in (0,1)
    x = (level - a) / (b - a)
    # rising (b above): above for [x,1] -> 1-x ; falling (a above): above for [0,x] -> x
    return (1.0 - x) if b_hi else x


def aggregate_exposure(
    samples: list[tuple[datetime, float]],
    cfg: IntelligenceConfig = CONFIG,
) -> ExposureWindow:
    """``samples`` = (timestamp, pm25) pairs for **valid** readings only (already gated by §5.1)."""
    pts = sorted((t, v) for t, v in samples if v is not None)
    n = len(pts)
    if n == 0:
        return ExposureWindow(None, 0.0, 0.0, 0, 0)
    if n == 1:
        # single point: report its value but assert no exposure duration
        return ExposureWindow(pts[0][1], 0.0, 0.0, 1, 0)

    level = cfg.exposure_concern_pm25
    covered = 0.0
    area = 0.0
    duration_above = 0.0
    event_count = 0
    prev_above = pts[0][1] >= level
    if prev_above:
        event_count = 1  # window opens already in an exposure episode

    for (ta, va), (tb, vb) in zip(pts, pts[1:], strict=False):
        dt = (tb - ta).total_seconds()
        if dt <= 0 or dt > cfg.exposure_max_gap_sec:
            # gap too large: don't bridge it, but a new above-sample still starts an episode
            if (vb >= level) and not prev_above:
                event_count += 1
            prev_above = vb >= level
            continue
        covered += dt
        area += (va + vb) / 2.0 * dt
        duration_above += _crossing_fraction(va, vb, level) * dt
        cur_above = vb >= level
        if cur_above and not prev_above:
            event_count += 1
        prev_above = cur_above

    mean = area / covered if covered > 0 else None
    return ExposureWindow(
        mean_pm25=mean,
        duration_above_concern_sec=duration_above,
        covered_sec=covered,
        sample_count=n,
        event_count=event_count,
    )
