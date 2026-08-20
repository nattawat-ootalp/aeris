"""A device id must reach the query as the id the caller named."""
from __future__ import annotations

from core_api.app.influx_query import _safe


def test_a_browser_issued_base64_id_keeps_its_padding():
    """Web Bluetooth identifies a portable with base64, padding included.

    Dropping the '==' asked Influx about an id nothing had ever written under, while the
    readings sat in the bucket under the real one — every device-scoped screen then reported
    No Data for a device that was reporting fine.
    """
    assert _safe("pvoEdP6l3oM_SflZ3KFiPQ==") == "pvoEdP6l3oM_SflZ3KFiPQ=="


def test_a_ble_mac_address_survives_intact():
    assert _safe("14:C1:9F:C1:25:F5") == "14:C1:9F:C1:25:F5"


def test_a_quote_is_escaped_rather_than_dropped():
    """The literal must stay one literal — that is what stops a value ending it early."""
    assert _safe('x"; drop') == 'x\\"; drop'


def test_a_backslash_is_escaped_so_it_cannot_escape_the_closing_quote():
    assert _safe("x\\") == "x\\\\"


def test_control_characters_are_removed():
    """They cannot appear in a Flux string literal at all, so there is nothing to escape."""
    assert _safe("dev\x00ice\n") == "device"
