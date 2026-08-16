"""§5.10 Predictive Alert — a short-horizon projection of *environmental* exposure.

The software design asks for an early warning roughly 15–30 minutes ahead, "when there is
enough data". This module is deliberately conservative about that condition, because a
forecast is the easiest place in the system to manufacture certainty that does not exist:

- it projects **PM2.5 only** — the same signal the decision engine uses. It does not predict
  symptoms, attacks, or any medical event (TDD §1.2, §14);
- it needs a minimum number of valid, recent, closely-spaced samples. Fewer than that, or a
  gap larger than ``exposure_max_gap_sec`` in the middle of the window, returns
  ``available=False`` with a reason code rather than a guess;
- the projection carries an uncertainty band from the fit residuals, and the band is what the
  UI must show. A trend line drawn without its residual spread reads as a promise;
- a projection is never rendered as a current value (§5.6): the caller labels it as a
  projection for a stated horizon.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import sqrt

from .config import CONFIG, IntelligenceConfig
from .models import Confidence, Decision, Reason


@dataclass
class Forecast:
    """Projected environmental exposure at ``horizon_sec`` from now."""
    available: bool
    horizon_sec: float
    projected_pm25: float | None
    uncertainty: float | None          # ± half-width around projected_pm25
    trend_per_hour: float | None       # µg/m³ per hour, signed
    decision: Decision                 # band the projection would fall in
    confidence: Confidence
    reason_codes: list[str]
    sample_size: int
    note: str = (
        "projection of environmental PM2.5 only, from the recent trend; not a prediction of "
        "symptoms or of any medical event"
    )


def _unavailable(horizon: float, reasons: list[str], n: int) -> Forecast:
    return Forecast(
        available=False,
        horizon_sec=horizon,
        projected_pm25=None,
        uncertainty=None,
        trend_per_hour=None,
        decision=Decision.NO_DATA,
        confidence=Confidence.LOW,
        reason_codes=reasons,
        sample_size=n,
    )


def forecast_pm25(
    samples: list[tuple[datetime, float]],
    *,
    now: datetime,
    horizon_sec: float | None = None,
    cfg: IntelligenceConfig = CONFIG,
) -> Forecast:
    """Least-squares projection of ``samples`` (valid readings only) ``horizon_sec`` ahead.

    ``samples`` must already be gated by §5.1 — this function trusts every value it is given
    and only judges their timing and spread.
    """
    horizon = horizon_sec if horizon_sec is not None else cfg.forecast_horizon_sec
    pts = sorted((t, v) for t, v in samples if v is not None)
    n = len(pts)

    if n < cfg.forecast_min_samples:
        return _unavailable(horizon, [Reason.FORECAST_INSUFFICIENT_DATA], n)

    # Only the recent window is predictive; older points describe a different situation.
    window_start = now.timestamp() - cfg.forecast_window_sec
    pts = [(t, v) for t, v in pts if t.timestamp() >= window_start]
    n = len(pts)
    if n < cfg.forecast_min_samples:
        return _unavailable(horizon, [Reason.FORECAST_INSUFFICIENT_DATA], n)

    # A stale tail means the trend describes the past, not the present.
    age = now.timestamp() - pts[-1][0].timestamp()
    if age > cfg.freshness_max_age_sec:
        return _unavailable(horizon, [Reason.DATA_STALE], n)

    # A hole in the data makes the slope an artefact of the gap, not of the air — but the
    # samples *after* the last hole are perfectly good, and they are the ones that describe the
    # present. Keep that run and drop everything before it, rather than discarding an hour of
    # continuous readings because the device rebooted at the start of the window. If the run is
    # too short to fit a line to, that is the honest refusal.
    last_break = 0
    for i, ((t0, _), (t1, _)) in enumerate(zip(pts, pts[1:], strict=False), start=1):
        if (t1 - t0).total_seconds() > cfg.exposure_max_gap_sec:
            last_break = i
    if last_break:
        pts = pts[last_break:]
        n = len(pts)
        if n < cfg.forecast_min_samples:
            return _unavailable(horizon, [Reason.FORECAST_COVERAGE_GAP], n)

    # Least-squares fit on seconds-from-now (so x=0 is the present moment).
    xs = [t.timestamp() - now.timestamp() for t, _ in pts]
    ys = [v for _, v in pts]
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return _unavailable(horizon, [Reason.FORECAST_INSUFFICIENT_DATA], n)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=False))
    slope = sxy / sxx
    intercept = my - slope * mx

    projected = intercept + slope * horizon
    # PM2.5 cannot go negative; a steep downward fit must not project an impossible value.
    projected = max(0.0, projected)

    # Residual spread → uncertainty. With n-2 degrees of freedom this is honest about short
    # windows: fewer points widen the band rather than hiding the doubt.
    residuals = [y - (intercept + slope * x) for x, y in zip(xs, ys, strict=False)]
    dof = max(1, n - 2)
    sigma = sqrt(sum(r * r for r in residuals) / dof)
    # Prediction interval widens with distance beyond the observed window.
    reach = 1.0 + (horizon**2) / max(sxx, 1e-6) / n
    uncertainty = round(1.96 * sigma * sqrt(max(1.0, reach)), 1)

    band = Decision.NORMAL
    if projected >= cfg.pm25_env_high:
        band = Decision.HIGH
    elif projected >= cfg.pm25_env_caution:
        band = Decision.CAUTION

    reasons: list[str] = []
    trend_per_hour = slope * 3600.0
    if trend_per_hour >= cfg.forecast_rising_per_hour:
        reasons.append(Reason.FORECAST_RISING)
    elif trend_per_hour <= -cfg.forecast_rising_per_hour:
        reasons.append(Reason.FORECAST_FALLING)
    else:
        reasons.append(Reason.FORECAST_STEADY)
    if band is Decision.HIGH:
        reasons.append(Reason.PM25_ABOVE_ENV_HIGH)
    elif band is Decision.CAUTION:
        reasons.append(Reason.PM25_ABOVE_ENV_CAUTION)

    # Confidence reflects how much of the movement the trend actually explains: a wide band
    # relative to the projection is a weak forecast no matter how many points produced it.
    spread_ratio = uncertainty / max(projected, 1.0)
    if n >= cfg.forecast_confident_samples and spread_ratio <= 0.35:
        confidence = Confidence.HIGH
    elif spread_ratio <= 0.75:
        confidence = Confidence.MEDIUM
    else:
        confidence = Confidence.LOW

    return Forecast(
        available=True,
        horizon_sec=horizon,
        projected_pm25=round(projected, 1),
        uncertainty=uncertainty,
        trend_per_hour=round(trend_per_hour, 2),
        decision=band,
        confidence=confidence,
        reason_codes=reasons,
        sample_size=n,
    )
