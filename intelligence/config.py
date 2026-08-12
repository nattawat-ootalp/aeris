"""Engineering tunables for the intelligence layer.

IMPORTANT (TDD §5.2, §14): these are *engineering / environmental* thresholds — testable and
config-driven. They are **not** medical thresholds and must never be presented as medical advice.
Defaults reference public air-quality guidance (WHO 2021 / PCD Thailand) for the environmental
*label* only; they assert nothing about an individual's medical safety.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)


def _i(name: str, default: int) -> int:
    try:
        return int(float(os.getenv(name, default)))
    except (TypeError, ValueError):
        return int(default)


@dataclass(frozen=True)
class IntelligenceConfig:
    # ── Data quality (§5.1) ──
    freshness_max_age_sec: float = _f("FRESHNESS_MAX_AGE_SEC", 120)
    pm25_min: float = 0.0
    pm25_max: float = 1000.0            # PMS7003 saturates well below this; above = impossible
    temp_min: float = -40.0
    temp_max: float = 85.0
    humidity_min: float = 0.0
    humidity_max: float = 100.0
    battery_low_pct: int = 15
    # spike: a single-sample jump larger than this (µg/m³) is treated as suspect,
    # not immediately trusted — persistence (§5.7) decides whether it is real.
    spike_delta_pm25: float = 80.0
    spike_min_interval_sec: float = 60.0

    # ── Environmental state (§5.2) — NOT medical ──
    pm25_env_caution: float = _f("PM25_ENV_CAUTION", 37.5)
    pm25_env_high: float = _f("PM25_ENV_HIGH", 75.0)
    # hysteresis margin: must fall this far below a boundary before de-escalating (§5.7)
    env_hysteresis_margin: float = 5.0

    # ── Exposure aggregation (§5.3) ──
    # samples further apart than this are NOT interpolated across (avoids one point
    # being counted as exposure for a whole window)
    exposure_max_gap_sec: float = 300.0
    exposure_concern_pm25: float = _f("PM25_ENV_CAUTION", 37.5)

    # ── Personal baseline (§5.4) ──
    baseline_min_samples: int = _i("BASELINE_MIN_SAMPLES", 50)
    # value is "above personal baseline" when it exceeds median + k * dispersion(MAD)
    baseline_k: float = 3.0

    # ── Pattern detection (§5.5) ──
    pattern_min_samples: int = _i("PATTERN_MIN_SAMPLES", 20)
    pattern_window_sec: float = 6 * 3600.0

    # ── Persistence / hysteresis / cooldown (§5.7) ──
    persistence_samples: int = 3         # consecutive elevated samples before escalating
    persistence_window_sec: float = 600.0
    cooldown_sec: float = _f("DECISION_COOLDOWN_SEC", 1800)


CONFIG = IntelligenceConfig()
