"""§5.1 companion — an *uncalibrated* humidity correction for optical PM2.5, off by default.

The PMS7003 sizes particles by light scattering. Above roughly 60 % RH ambient particles take
on water and swell (hygroscopic growth), scatter more light, and the sensor over-reports PM2.5
mass. The standard remedy divides the raw reading by a kappa-Köhler growth factor. This module
implements that remedy under the project's hard rules (TDD §1.2, §9, §14):

- it is a **literature correction, not a calibrated one**. Aeris has never been co-located with
  a reference-grade monitor (TDD §232 lists that study as required future work; the experiment
  write-up claims directional response only). A correction fitted to nobody's device can make a
  reading worse as easily as better, so it ships **disabled** (``PM25_RH_CORRECTION_ENABLED``,
  default false) and the raw value passes through untouched until someone deliberately enables
  it. Enabling it is **not** a substitute for the co-location calibration study;
- it corrects **environmental PM2.5 mass only**. It says nothing about symptoms, airway
  response, or any medical quantity, and it never moves a decision band by itself — callers
  keep deciding on the raw value unless they opt in;
- it is an **annotation, never a rewrite**. Every result carries the raw value, the RH it used,
  the growth factor and the kappa, so any consumer can see exactly what was done and undo it
  (``raw == corrected * growth_factor``). A corrected number must never be presented as a
  direct measurement;
- missing, stale, or implausible RH returns the raw value with a reason code saying why. The
  module never guesses an RH — a missing input is not a licence to invent one;
- the formula diverges as RH → 100 %, so it is clamped at a high-RH threshold and the total
  movement is bounded. An unbounded correction is a fiction with a decimal point on it.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from math import isfinite


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


def _b(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# ── Reason codes ─────────────────────────────────────────────────────────────
# Local to this module on purpose: intelligence/models.py is owned elsewhere, and these codes
# describe an optional annotation rather than a decision input. Same stable-identifier style.
class RhReason:
    RH_CORRECTION_DISABLED = "RH_CORRECTION_DISABLED"
    RH_CORRECTION_APPLIED = "RH_CORRECTION_APPLIED"
    RH_CORRECTION_BOUNDED = "RH_CORRECTION_BOUNDED"
    RH_BELOW_CORRECTION_ONSET = "RH_BELOW_CORRECTION_ONSET"
    RH_CLAMPED_HIGH = "RH_CLAMPED_HIGH"
    RH_MISSING = "RH_MISSING"
    RH_OUT_OF_RANGE = "RH_OUT_OF_RANGE"
    RH_STALE = "RH_STALE"
    PM25_MISSING = "PM25_MISSING"


NOTE = (
    "uncalibrated literature correction for hygroscopic growth in an optical PM sensor; "
    "environmental PM2.5 mass only, no medical claim, and no substitute for co-location "
    "calibration against a reference monitor"
)


@dataclass(frozen=True)
class HumidityConfig:
    """Tunables for the RH correction. Every field re-reads its environment variable on
    instantiation (``default_factory``) so a deployment — or a test — can change one without
    re-importing the module."""

    # Master switch. FALSE by default and it must stay that way until the TDD's co-location
    # study exists: with it off, every consumer sees exactly the number the sensor reported.
    enabled: bool = field(
        default_factory=lambda: _b("PM25_RH_CORRECTION_ENABLED", False)
    )
    # Hygroscopic growth coefficient of the kappa-Köhler form
    # ``gf = 1 + kappa * (RH/100) / (1 - RH/100)``.
    #
    # 0.25 is a LITERATURE DEFAULT for mixed ambient urban aerosol (kappa for such aerosol is
    # commonly reported in the 0.1–0.4 range; ~0.2–0.3 is the usual working value, and the same
    # correction family underlies the published RH corrections for low-cost optical PM sensors).
    # It is NOT fitted to this device, this sensor unit, or Thai ambient aerosol. Fitting it
    # requires the co-location study against a validated reference monitor that TDD §232 lists
    # as outstanding; until then this number is an assumption, not a measurement.
    kappa: float = field(default_factory=lambda: _f("PM25_RH_KAPPA", 0.25))
    # Plausible-RH window. Outside it the humidity channel is not believed at all.
    rh_valid_min: float = field(default_factory=lambda: _f("PM25_RH_VALID_MIN", 0.0))
    rh_valid_max: float = field(default_factory=lambda: _f("PM25_RH_VALID_MAX", 100.0))
    # Below this RH the bias is small and within the noise of an uncalibrated device; correcting
    # there would be precision theatre, so the raw value is returned unchanged.
    rh_onset: float = field(default_factory=lambda: _f("PM25_RH_ONSET_PCT", 60.0))
    # The formula blows up as RH → 100 %. Above this the RH used is floored to the threshold
    # itself rather than refusing outright, and the result is flagged as clamped.
    rh_clamp: float = field(default_factory=lambda: _f("PM25_RH_CLAMP_PCT", 95.0))
    # Hard ceiling on how far the correction may move a value, as a fraction of the raw value.
    # Guards against an extreme kappa or a near-saturation RH quietly halving a reading twice.
    max_reduction_frac: float = field(
        default_factory=lambda: _f("PM25_RH_MAX_REDUCTION_FRAC", 0.5)
    )
    # An RH sample older than this describes different air than the PM sample beside it.
    rh_max_age_sec: float = field(default_factory=lambda: _i("PM25_RH_MAX_AGE_SEC", 120))


HUMIDITY_CONFIG = HumidityConfig()


@dataclass(frozen=True)
class RhCorrection:
    """The raw reading, the corrected reading, and everything needed to undo the correction.

    ``raw_pm25`` is always the untouched sensor value. When ``applied`` is False,
    ``corrected_pm25 == raw_pm25`` and ``growth_factor == 1.0`` — the pass-through is explicit
    rather than signalled by a null, so a consumer never has to guess which number to show.
    Invariant when ``raw_pm25`` is not None: ``raw_pm25 ≈ corrected_pm25 * growth_factor``.
    """

    enabled: bool
    applied: bool
    raw_pm25: float | None
    corrected_pm25: float | None
    humidity_pct: float | None          # RH as observed
    humidity_used_pct: float | None     # RH actually fed to the formula (clamped)
    growth_factor: float                # the factor actually divided out
    kappa: float
    reason_codes: list[str]
    note: str = NOTE

    def to_payload(self) -> dict:
        """Serializable form for the API contract."""
        return {
            "enabled": self.enabled,
            "applied": self.applied,
            "raw_pm25": self.raw_pm25,
            "corrected_pm25": self.corrected_pm25,
            "humidity_pct": self.humidity_pct,
            "humidity_used_pct": self.humidity_used_pct,
            "growth_factor": self.growth_factor,
            "kappa": self.kappa,
            "reason_codes": list(self.reason_codes),
            "note": self.note,
        }


def growth_factor(rh_pct: float, kappa: float) -> float:
    """kappa-Köhler hygroscopic growth factor for a relative humidity in percent.

    ``1 + kappa * (RH/100) / (1 - RH/100)``. Undefined at RH = 100 %; callers must clamp the
    RH before calling. Never returns less than 1.0 — water uptake can only make a particle
    scatter more, so the correction may only ever reduce a reading.
    """
    a = max(0.0, min(rh_pct, 99.0)) / 100.0
    gf = 1.0 + kappa * a / (1.0 - a)
    if not isfinite(gf) or gf < 1.0:
        return 1.0
    return gf


def _passthrough(
    pm25: float | None,
    humidity_pct: float | None,
    reasons: list[str],
    cfg: HumidityConfig,
) -> RhCorrection:
    """Raw value out, unchanged, with the reason no correction was applied."""
    return RhCorrection(
        enabled=cfg.enabled,
        applied=False,
        raw_pm25=pm25,
        corrected_pm25=pm25,
        humidity_pct=humidity_pct,
        humidity_used_pct=None,
        growth_factor=1.0,
        kappa=cfg.kappa,
        reason_codes=reasons,
    )


def correct_pm25_for_humidity(
    pm25: float | None,
    humidity_pct: float | None,
    *,
    humidity_age_sec: float | None = None,
    cfg: HumidityConfig = HUMIDITY_CONFIG,
) -> RhCorrection:
    """Annotate ``pm25`` with an RH-corrected companion value — or say why it was not corrected.

    ``humidity_age_sec`` is how old the RH sample is relative to the PM sample; pass None when
    they came from the same reading (the usual case, since the SCD40 and PMS7003 are read
    together). The raw value is returned untouched whenever the flag is off, the RH is missing,
    stale, or implausible, or the RH is below the onset threshold.
    """
    if not cfg.enabled:
        # The disabled path must be byte-identical to having no correction at all.
        return _passthrough(pm25, humidity_pct, [RhReason.RH_CORRECTION_DISABLED], cfg)

    if pm25 is None or not isfinite(pm25) or pm25 < 0:
        return _passthrough(
            pm25 if (pm25 is not None and isfinite(pm25) and pm25 >= 0) else None,
            humidity_pct,
            [RhReason.PM25_MISSING],
            cfg,
        )

    if humidity_pct is None or not isfinite(humidity_pct):
        return _passthrough(pm25, None, [RhReason.RH_MISSING], cfg)

    if humidity_pct < cfg.rh_valid_min or humidity_pct > cfg.rh_valid_max:
        return _passthrough(pm25, humidity_pct, [RhReason.RH_OUT_OF_RANGE], cfg)

    if humidity_age_sec is not None and humidity_age_sec > cfg.rh_max_age_sec:
        return _passthrough(pm25, humidity_pct, [RhReason.RH_STALE], cfg)

    if humidity_pct < cfg.rh_onset:
        return _passthrough(pm25, humidity_pct, [RhReason.RH_BELOW_CORRECTION_ONSET], cfg)

    reasons = [RhReason.RH_CORRECTION_APPLIED]
    rh_used = humidity_pct
    if rh_used > cfg.rh_clamp:
        rh_used = cfg.rh_clamp
        reasons.append(RhReason.RH_CLAMPED_HIGH)

    gf = growth_factor(rh_used, cfg.kappa)
    corrected = pm25 / gf if gf > 0 else pm25

    # Bound the total movement, then re-derive the factor from what was actually done, so the
    # reported factor always inverts the reported value rather than describing an intent.
    floor = pm25 * (1.0 - max(0.0, min(cfg.max_reduction_frac, 1.0)))
    if corrected < floor:
        corrected = floor
        reasons.append(RhReason.RH_CORRECTION_BOUNDED)

    if not isfinite(corrected) or corrected < 0:
        # Should be unreachable; treated as a refusal rather than shipping a bad number.
        return _passthrough(pm25, humidity_pct, [RhReason.RH_OUT_OF_RANGE], cfg)

    # Derive the factor from the ROUNDED value that is actually published, so
    # ``raw == corrected * growth_factor`` holds for the numbers the client receives.
    corrected = round(corrected, 1)
    applied_gf = pm25 / corrected if corrected > 0 else gf
    if not isfinite(applied_gf) or applied_gf < 1.0:
        applied_gf = 1.0

    return RhCorrection(
        enabled=True,
        applied=True,
        raw_pm25=pm25,
        corrected_pm25=corrected,
        humidity_pct=humidity_pct,
        humidity_used_pct=rh_used,
        growth_factor=round(applied_gf, 4),
        kappa=cfg.kappa,
        reason_codes=reasons,
    )
