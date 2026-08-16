"""SCD40 true CO2 (ppm) — parsed, range-gated, and kept strictly apart from the SGP30 eco2
estimate. The two are different quantities; merging them would misreport an estimate as a
measurement (docs/ble-contract.md)."""
from datetime import UTC, datetime

from intelligence.config import CONFIG
from intelligence.models import Reading
from intelligence.parsing import co2_ppm, parse_reading
from intelligence.quality import assess_quality

NOW = datetime(2026, 8, 15, 20, 0, tzinfo=UTC)
BASE = {"device_id": "P001", "timestamp": NOW.isoformat(), "pm25": 20.0}


def test_co2_is_parsed_from_the_payload():
    r = parse_reading({**BASE, "co2": 812})
    assert r.co2 == 812.0


def test_absent_co2_is_none_not_zero():
    r = parse_reading(BASE)
    assert r.co2 is None


def test_out_of_range_co2_is_dropped():
    assert co2_ppm(50) is None                      # below the SCD40's 400 ppm floor
    assert co2_ppm(90000) is None                   # above its range
    assert co2_ppm(CONFIG.co2_min_ppm) == CONFIG.co2_min_ppm


def test_unparseable_co2_is_dropped():
    assert co2_ppm("n/a") is None
    assert co2_ppm(None) is None


def test_co2_and_eco2_stay_separate_fields():
    r = parse_reading({**BASE, "co2": 812, "eco2": 450})
    assert r.co2 == 812.0 and r.eco2 == 450.0


def test_bad_co2_never_invalidates_the_pm_reading():
    """CO2 is context, not a PM sensor — an impossible CO2 must not suppress a good PM value."""
    r = parse_reading({**BASE, "co2": 999999})
    q = assess_quality(r, now=NOW)
    assert r.co2 is None
    assert q.pm25_valid is True and q.usable is True


def test_missing_co2_does_not_affect_quality():
    q = assess_quality(Reading(device_id="P001", timestamp=NOW, pm25=20.0), now=NOW)
    assert q.pm25_valid is True and q.usable is True
