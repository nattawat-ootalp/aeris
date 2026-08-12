"""§5.7 persistence, hysteresis, cooldown, dedup."""
from __future__ import annotations

import dataclasses
from datetime import timedelta

from intelligence.config import CONFIG
from intelligence.models import EnvState
from intelligence.persistence import PersistenceEngine

from .conftest import NOW


def _at(sec):
    return NOW + timedelta(seconds=sec)


def test_single_spike_does_not_escalate():
    eng = PersistenceEngine()  # default persistence_samples = 3
    eng.update(EnvState.NORMAL, _at(0))
    r = eng.update(EnvState.HIGH, _at(30))  # lone spike
    assert r.stable_state == EnvState.NORMAL
    assert r.changed is False and r.should_notify is False


def test_sustained_elevation_escalates_and_notifies_once():
    eng = PersistenceEngine()
    eng.update(EnvState.CAUTION, _at(0))
    eng.update(EnvState.CAUTION, _at(30))
    r3 = eng.update(EnvState.CAUTION, _at(60))  # 3rd consecutive -> escalate
    assert r3.stable_state == EnvState.CAUTION
    assert r3.changed and r3.escalated and r3.should_notify
    # dedup: staying in CAUTION does not re-notify
    r4 = eng.update(EnvState.CAUTION, _at(90))
    assert r4.changed is False and r4.should_notify is False


def test_hysteresis_and_cooldown():
    cfg = dataclasses.replace(CONFIG, persistence_samples=2, cooldown_sec=100)
    eng = PersistenceEngine(cfg=cfg)

    # escalate NORMAL -> CAUTION (sustained x2) at t=10, notifies
    eng.update(EnvState.CAUTION, _at(0))
    r = eng.update(EnvState.CAUTION, _at(10))
    assert r.stable_state == EnvState.CAUTION and r.should_notify

    # single NORMAL must NOT drop state (hysteresis)
    r = eng.update(EnvState.NORMAL, _at(20))
    assert r.stable_state == EnvState.CAUTION and r.changed is False
    # sustained NORMAL x2 -> de-escalate (quietly, no notify)
    r = eng.update(EnvState.NORMAL, _at(30))
    assert r.stable_state == EnvState.NORMAL and r.should_notify is False

    # re-escalate within cooldown -> state changes but NO notify
    eng.update(EnvState.CAUTION, _at(40))
    r = eng.update(EnvState.CAUTION, _at(50))
    assert r.stable_state == EnvState.CAUTION and r.escalated and r.should_notify is False

    # drop, then re-escalate AFTER cooldown elapsed -> notify again
    eng.update(EnvState.NORMAL, _at(60))
    eng.update(EnvState.NORMAL, _at(70))
    eng.update(EnvState.CAUTION, _at(160))
    r = eng.update(EnvState.CAUTION, _at(170))  # 170 - 10 = 160 >= cooldown 100
    assert r.escalated and r.should_notify is True


def test_none_candidate_holds_state():
    eng = PersistenceEngine()
    r = eng.update(None, _at(0))
    assert r.stable_state == EnvState.NORMAL
    assert r.changed is False and r.should_notify is False
