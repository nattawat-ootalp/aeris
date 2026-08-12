"""§5.2 Environmental State — engineering classification only.

NORMAL / CAUTION / HIGH from PM2.5 against configurable *environmental* thresholds.
These are NOT medical thresholds (TDD §5.2, §14) and this function must only be called
with a PM value that passed §5.1 quality gating.
"""
from __future__ import annotations

from .config import CONFIG, IntelligenceConfig
from .models import EnvState, Reason


def classify_env(pm25: float | None, cfg: IntelligenceConfig = CONFIG) -> tuple[EnvState | None, list[str]]:
    """Return (state, reason_codes). state is None when PM is not available — callers
    must treat None as 'no environmental judgement', never as NORMAL/safe."""
    if pm25 is None:
        return None, []
    if pm25 >= cfg.pm25_env_high:
        return EnvState.HIGH, [Reason.PM25_ABOVE_ENV_HIGH, Reason.PM25_ABOVE_ENV_CAUTION]
    if pm25 >= cfg.pm25_env_caution:
        return EnvState.CAUTION, [Reason.PM25_ABOVE_ENV_CAUTION]
    return EnvState.NORMAL, [Reason.ENV_NORMAL]
