"""§5.5 pattern detection — observational association with sample size + uncertainty."""
from __future__ import annotations

from datetime import timedelta

from intelligence.pattern import detect_pattern

from .conftest import NOW


def _times(*offsets_hours):
    return [NOW + timedelta(hours=h) for h in offsets_hours]


def test_no_symptoms_is_insufficient():
    p = detect_pattern([], _times(0, 1))
    assert p.sample_size == 0 and p.association is None and p.sufficient is False


def test_small_sample_reports_uncertainty_and_not_sufficient():
    # 3 symptoms, 2 preceded by exposure within window
    symptoms = _times(1, 4, 10)
    exposures = _times(0.5, 3.5)  # precede the first two, not the third
    p = detect_pattern(symptoms, exposures)
    assert p.sample_size == 3
    assert abs(p.association - 2 / 3) < 1e-9
    assert p.uncertainty is not None and p.uncertainty > 0
    assert p.sufficient is False  # below pattern_min_samples (20)
    assert "not a proven cause" in p.note


def test_sufficient_when_enough_samples():
    # 25 symptoms, all preceded by an exposure 30 min earlier
    symptoms = [NOW + timedelta(hours=i) for i in range(25)]
    exposures = [NOW + timedelta(hours=i, minutes=-30) for i in range(25)]
    p = detect_pattern(symptoms, exposures)
    assert p.sample_size == 25 and p.sufficient is True
    assert abs(p.association - 1.0) < 1e-9
