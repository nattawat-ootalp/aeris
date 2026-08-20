"""§5.1 data quality — freshness, missing/impossible, sensor status, warm-up, spike."""
from __future__ import annotations

from intelligence.models import Reason
from intelligence.quality import assess_quality

from .conftest import make_reading


def test_fresh_ok_reading_is_usable(now):
    q = assess_quality(make_reading(age_sec=5, pm25=12), now=now)
    assert q.usable and q.pm25_valid and q.fresh
    assert q.reasons == []


def test_stale_reading_not_usable(now):
    q = assess_quality(make_reading(age_sec=10_000, pm25=12), now=now)
    assert not q.fresh and not q.usable
    assert Reason.DATA_STALE in q.reasons


def test_missing_pm_is_invalid(now):
    q = assess_quality(make_reading(pm25=None), now=now)
    assert not q.pm25_valid and not q.usable
    assert Reason.SENSOR_INVALID in q.reasons


def test_impossible_pm_is_invalid(now):
    q = assess_quality(make_reading(pm25=5000), now=now)
    assert not q.pm25_valid
    assert Reason.SENSOR_INVALID in q.reasons


def test_sensor_status_not_ok_invalidates_pm(now):
    # value present but the device flagged the sensor -> must not be trusted
    q = assess_quality(make_reading(pm25=12, sensor_status="ERROR"), now=now)
    assert not q.pm25_valid and not q.usable
    assert Reason.SENSOR_INVALID in q.reasons


def test_warmup_flagged_and_not_usable(now):
    q = assess_quality(make_reading(pm25=12, sensor_status="WARMUP"), now=now)
    assert Reason.SENSOR_WARMUP in q.reasons
    assert not q.usable


def test_spike_suspected_caps_quality(now):
    prev = make_reading(age_sec=30, pm25=10)
    cur = make_reading(age_sec=0, pm25=200)  # +190 within 30s
    q = assess_quality(cur, now=now, previous=prev)
    assert Reason.SPIKE_SUSPECTED in q.reasons
    assert q.quality_score <= 0.5
    assert q.usable  # still usable but low-confidence; persistence decides


def test_battery_low_is_separate_from_environmental_usability(now):
    q = assess_quality(make_reading(pm25=12, battery=10), now=now)
    assert q.battery_low is True
    assert q.usable is True  # device health must not block environmental data


def test_missing_sgp30_does_not_affect_usability(now):
    # SGP30 is optional hardware, not even wired on the test device — absent tvoc/eco2 must
    # never make an otherwise-good PM reading unusable.
    q = assess_quality(make_reading(pm25=12, tvoc=None, eco2=None), now=now)
    assert q.usable and q.pm25_valid
    assert q.reasons == []


def test_out_of_range_sgp30_does_not_affect_usability(now):
    # A bad/implausible SGP30 value must invalidate only that field (handled upstream in
    # parsing), never the PM-driven usable/pm25_valid gate itself.
    q = assess_quality(make_reading(pm25=12, tvoc=99999, eco2=5), now=now)
    assert q.usable and q.pm25_valid
    assert q.reasons == []


def test_reading_stamped_slightly_ahead_of_this_clock_is_still_fresh(now):
    """A client's clock running a few seconds fast must not invalidate its live readings.

    Two unsynchronised clocks routinely disagree by seconds, so a phone or browser can stamp a
    capture time marginally ahead of the server's own. Before the tolerance that arrived as a
    negative age and was rejected as DATA_STALE, which silently discarded every live reading
    from such a client.
    """
    q = assess_quality(make_reading(age_sec=-3, pm25=12), now=now)

    assert q.fresh and q.usable
    assert Reason.DATA_STALE not in q.reasons
    # Never reported as a negative age — the field means "how old", and below zero is not one.
    assert q.freshness_sec == 0.0


def test_a_timestamp_far_in_the_future_is_still_refused(now):
    q = assess_quality(make_reading(age_sec=-7200, pm25=12), now=now)

    assert not q.fresh
    assert Reason.DATA_STALE in q.reasons
