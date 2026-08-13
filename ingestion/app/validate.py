"""The single shared validation gate for BOTH transports (TDD §5.1).

Station and portable readings are already normalized to an intelligence.Reading by
``adapters.py``; from here they pass through the exact same quality gate. Freshness /
missing / impossible / sensor-status / warm-up / spike are all checked BEFORE anything is
written or handed to a decision. Invalid PM ⇒ ``quality.pm25_valid`` is False and no
PM-based caution can follow.
"""
from __future__ import annotations

from datetime import datetime

from intelligence.models import QualityResult, Reading
from intelligence.quality import assess_quality


def validate(
    reading: Reading,
    now: datetime | None = None,
    previous: Reading | None = None,
) -> QualityResult:
    """Run the shared §5.1 gate. The raw reading may still be stored (flagged), but only a
    ``usable`` result is allowed to drive an environmental decision downstream."""
    return assess_quality(reading, now=now, previous=previous)
