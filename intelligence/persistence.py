"""§5.7 Persistence / Hysteresis / Cooldown — stabilize state and suppress alert fatigue.

- **Persistence** — escalate only after the elevated state is *sustained* for
  ``persistence_samples`` consecutive updates → filters single-sample spikes.
- **Hysteresis** — de-escalate only when the lower state is likewise sustained, and never
  overshoot below the recently-sustained ceiling → prevents rapid flapping.
- **Cooldown + dedup** — notify only on escalation, at most once per ``cooldown_sec``, and
  never for an unchanged decision → reduces alert fatigue.

Stateful, but the state is small and explicit so it is fully unit-testable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .config import CONFIG, IntelligenceConfig
from .models import EnvState

_RANK = {EnvState.NORMAL: 0, EnvState.CAUTION: 1, EnvState.HIGH: 2}
_BY_RANK = {v: k for k, v in _RANK.items()}


@dataclass
class PersistenceResult:
    stable_state: EnvState
    changed: bool
    should_notify: bool
    escalated: bool


@dataclass
class PersistenceEngine:
    cfg: IntelligenceConfig = CONFIG
    state: EnvState = EnvState.NORMAL
    _buffer: list[tuple[int, datetime]] = field(default_factory=list)
    _last_notify: datetime | None = None

    def update(self, candidate: EnvState | None, now: datetime) -> PersistenceResult:
        # Missing data does not move environmental state; the decision engine emits NO_DATA.
        if candidate is None:
            return PersistenceResult(self.state, changed=False, should_notify=False, escalated=False)

        self._buffer.append((_RANK[candidate], now))
        cutoff = now.timestamp() - self.cfg.persistence_window_sec
        self._buffer = [(r, t) for (r, t) in self._buffer if t.timestamp() >= cutoff]

        old_rank = _RANK[self.state]
        new_rank = old_rank

        recent = self._buffer[-self.cfg.persistence_samples:]
        if len(recent) >= self.cfg.persistence_samples:
            ranks = [r for r, _ in recent]
            sustained_floor = min(ranks)     # every recent sample is >= this
            sustained_ceiling = max(ranks)   # every recent sample is <= this
            if sustained_floor > old_rank:
                new_rank = sustained_floor   # escalate to the sustained level
            elif sustained_ceiling < old_rank:
                new_rank = sustained_ceiling  # de-escalate, but not below sustained ceiling

        changed = new_rank != old_rank
        escalated = new_rank > old_rank
        self.state = _BY_RANK[new_rank]

        should_notify = False
        if escalated:
            if self._last_notify is None or (now - self._last_notify).total_seconds() >= self.cfg.cooldown_sec:
                should_notify = True
                self._last_notify = now

        return PersistenceResult(self.state, changed=changed, should_notify=should_notify, escalated=escalated)
