"""Shared types for the intelligence layer + the Aeris data contract (TDD §4)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class Decision(StrEnum):
    """Engineering decision state. Watch surfaces map these to Normal/Caution/High/No Data.

    NO_DATA covers "quality too low", "stale", and "unavailable" — the watch must never
    show a stale value as current (TDD §5.6, §14).
    """
    NORMAL = "NORMAL"
    CAUTION = "CAUTION"
    HIGH = "HIGH"
    NO_DATA = "NO_DATA"


class Confidence(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class EnvState(StrEnum):
    """Environmental state only (§5.2). Explicitly NOT a medical classification."""
    NORMAL = "NORMAL"
    CAUTION = "CAUTION"
    HIGH = "HIGH"


# ── Reason codes (stable identifiers used in decision events, TDD §4.1) ──
class Reason:
    NO_VALID_DATA = "NO_VALID_DATA"
    SENSOR_INVALID = "SENSOR_INVALID"
    SENSOR_WARMUP = "SENSOR_WARMUP"
    DATA_STALE = "DATA_STALE"
    SPIKE_SUSPECTED = "SPIKE_SUSPECTED"
    PM25_ABOVE_ENV_CAUTION = "PM25_ABOVE_ENV_CAUTION"
    PM25_ABOVE_ENV_HIGH = "PM25_ABOVE_ENV_HIGH"
    PM25_ABOVE_PERSONAL_BASELINE = "PM25_ABOVE_PERSONAL_BASELINE"
    PERSONAL_EXPOSURE_ELEVATED = "PERSONAL_EXPOSURE_ELEVATED"
    EXPOSURE_DURATION_INCREASING = "EXPOSURE_DURATION_INCREASING"
    BASELINE_INSUFFICIENT_SAMPLE = "BASELINE_INSUFFICIENT_SAMPLE"
    ENV_NORMAL = "ENV_NORMAL"
    DESTINATION_UNAVAILABLE = "DESTINATION_UNAVAILABLE"
    # ── Personalized risk (§5.9) ──
    SYMPTOM_HISTORY_RECENT = "SYMPTOM_HISTORY_RECENT"
    TEMPORAL_PATTERN_MATCH = "TEMPORAL_PATTERN_MATCH"
    # ── Predictive alert (§5.10) ──
    FORECAST_RISING = "FORECAST_RISING"
    FORECAST_FALLING = "FORECAST_FALLING"
    FORECAST_STEADY = "FORECAST_STEADY"
    FORECAST_INSUFFICIENT_DATA = "FORECAST_INSUFFICIENT_DATA"
    FORECAST_COVERAGE_GAP = "FORECAST_COVERAGE_GAP"


@dataclass
class Reading:
    """One telemetry sample (Aeris portable contract, TDD §4)."""
    device_id: str
    timestamp: datetime
    pm25: float | None = None
    temperature: float | None = None
    humidity: float | None = None
    # TRUE CO2 from the SCD40 (NDIR), ppm. Environmental context only — like tvoc/eco2 it is
    # never an input to Decision/EnvState/WatchStatus (§14: the decision path stays PM2.5-driven).
    co2: float | None = None
    battery: int | None = None
    sensor_status: str = "OK"
    quality_score: float | None = None
    schema_version: str = "1.0"
    # SGP30 (optional hardware) — additional environmental context ONLY. Never an input to
    # Decision/EnvState/WatchStatus (§14 invariant: the decision engine stays PM2.5-driven).
    tvoc: float | None = None             # Total VOC, ppb
    eco2: float | None = None             # VOC-derived CO2-EQUIVALENT ESTIMATE, ppm — NOT a
    # true CO2 measurement (the SCD40 measures real CO2).


@dataclass
class QualityResult:
    """Outcome of §5.1 data-quality gating."""
    usable: bool
    pm25_valid: bool
    freshness_sec: float | None
    fresh: bool
    quality_score: float
    battery_low: bool
    reasons: list[str] = field(default_factory=list)


@dataclass
class ExposureWindow:
    """Aggregated exposure over a time window (§5.3)."""
    mean_pm25: float | None
    duration_above_concern_sec: float
    covered_sec: float
    sample_count: int
    event_count: int


@dataclass
class Baseline:
    """Personal baseline (§5.4)."""
    ready: bool
    sample_count: int
    median: float | None = None
    dispersion: float | None = None       # MAD (median absolute deviation)
    upper: float | None = None            # median + k*dispersion

    def is_above(self, value: float | None) -> bool:
        if not self.ready or value is None or self.upper is None:
            return False
        return value > self.upper


@dataclass
class Pattern:
    """Observational association (§5.5) — a pattern to notice, never a cause."""
    sample_size: int
    association: float | None            # e.g. relative rate; None if insufficient
    uncertainty: float | None            # width of a simple confidence interval
    sufficient: bool
    note: str = "observational association, not a proven cause"


@dataclass
class DecisionEvent:
    """Explainable decision output (§4.1, §5.8)."""
    decision: Decision
    confidence: Confidence
    reason_codes: list[str]
    freshness_sec: float | None
    sample_size: int
    watch_label: str
