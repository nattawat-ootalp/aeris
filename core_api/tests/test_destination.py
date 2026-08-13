"""§6 Destination Assessment — nearest valid node, freshness, unavailable/stale."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from core_api.app.destination import NodeContext, assess_destination, haversine_km
from intelligence.models import Decision, Reason

NOW = datetime(2026, 8, 12, 12, 0, 0, tzinfo=UTC)
# a reference point (Bangkok-ish) and a very close node
DEST = (13.7563, 100.5018)


def _node(code, dlat=0.0, dlon=0.0, pm25=10.0, age_sec=60, healthy=True):
    return NodeContext(
        node_code=code, lat=DEST[0] + dlat, lon=DEST[1] + dlon,
        last_seen=NOW - timedelta(seconds=age_sec), pm25=pm25, sensor_healthy=healthy,
    )


def test_haversine_zero_and_positive():
    assert haversine_km(*DEST, *DEST) == 0.0
    assert haversine_km(13.75, 100.50, 13.76, 100.51) > 0


def test_ok_uses_nearest_valid_node():
    nodes = [_node("FAR", dlat=0.02, pm25=90), _node("NEAR", dlat=0.001, pm25=80)]
    a = assess_destination(*DEST, nodes, NOW)
    assert a.status == "ok" and a.node_code == "NEAR"
    assert a.decision == Decision.HIGH and a.pm25 == 80


def test_stale_node_is_not_current():
    a = assess_destination(*DEST, [_node("N1", pm25=90, age_sec=100000)], NOW)
    assert a.status == "stale" and a.decision == Decision.NO_DATA
    assert Reason.DATA_STALE in a.reason_codes
    assert a.pm25 is None  # old value never presented as current


def test_no_node_in_range_is_unavailable():
    far = _node("FARAWAY", dlat=5.0, pm25=10)  # ~hundreds of km
    a = assess_destination(*DEST, [far], NOW)
    assert a.status == "unavailable" and a.decision == Decision.NO_DATA
    assert Reason.DESTINATION_UNAVAILABLE in a.reason_codes


def test_unhealthy_or_missing_sensor_excluded():
    nodes = [_node("SICK", dlat=0.001, pm25=90, healthy=False), _node("OK", dlat=0.002, pm25=20)]
    a = assess_destination(*DEST, nodes, NOW)
    assert a.node_code == "OK" and a.decision == Decision.NORMAL
