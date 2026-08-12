"""§5.8 explainability + privacy — no-SAFE guard and decision-payload boundary."""
from __future__ import annotations

import pytest

from intelligence.explain import assert_no_medical_safe, to_contract
from intelligence.models import Confidence, Decision, DecisionEvent, Reason


def _event(decision=Decision.NORMAL, watch="Normal"):
    return DecisionEvent(
        decision=decision, confidence=Confidence.MEDIUM,
        reason_codes=[Reason.ENV_NORMAL], freshness_sec=5.0,
        sample_size=60, watch_label=watch,
    )


def test_contract_has_required_explainability_fields():
    d = to_contract(_event())
    for key in ("decision", "confidence", "reason_codes", "freshness_sec", "sample_size", "watch_label"):
        assert key in d
    assert d["watch_label"] in {"Normal", "Caution", "High", "No Data"}


def test_normal_maps_to_normal_not_safe():
    d = to_contract(_event(Decision.NORMAL, "Normal"))
    assert d["watch_label"] == "Normal"
    assert "SAFE" not in d["watch_label"].upper()
    assert "SAFE" not in d["decision"].upper()


def test_banned_safe_label_is_rejected():
    with pytest.raises(ValueError):
        assert_no_medical_safe({"decision": "NORMAL", "watch_label": "Safe"})


def test_invalid_watch_label_rejected():
    with pytest.raises(ValueError):
        assert_no_medical_safe({"decision": "NORMAL", "watch_label": "Totally Fine"})


def test_decision_payload_carries_no_health_fields():
    # privacy boundary: a decision event must not leak symptom/health identifiers
    d = to_contract(_event())
    leaked = {"symptom", "symptoms", "diagnosis", "medication", "user_id", "line_user_id"}
    assert leaked.isdisjoint(d.keys())
