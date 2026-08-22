"""A personal baseline follows the person, not the device id they happen to be paired to.

A device id is issued by the platform — a browser hands out a fresh one per pairing — so a
baseline keyed on the id alone throws a person back to "not enough samples yet" with weeks of
their own readings still in the bucket under the previous id.
"""
from __future__ import annotations

import pytest

from core_api.app import repo


@pytest.fixture(autouse=True)
def _clear_caches():
    repo._account_devices_cache.clear()
    repo._baseline_cache.clear()
    yield
    repo._account_devices_cache.clear()
    repo._baseline_cache.clear()


NEW = "new-portable-id"
OLD = "old-portable-id"
STATION = "BKK-TRT-003"

ACCOUNT = [
    {"external_id": NEW, "kind": "portable"},
    {"external_id": OLD, "kind": "portable"},
    {"external_id": STATION, "kind": "station"},
]


def test_every_portable_on_the_account_is_pooled(monkeypatch):
    monkeypatch.setattr(repo, "list_devices", lambda sub: ACCOUNT)
    assert sorted(repo.baseline_device_ids("user-1", NEW)) == sorted([NEW, OLD])


def test_a_station_is_not_pooled_into_a_carried_devices_range(monkeypatch):
    """A station reports the ambient air of a whole area — folding it in would move the
    reference range for reasons that have nothing to do with what the person breathed."""
    monkeypatch.setattr(repo, "list_devices", lambda sub: ACCOUNT)
    assert STATION not in repo.baseline_device_ids("user-1", NEW)
    assert repo.baseline_device_ids("user-1", STATION) == [STATION]


def test_without_a_signed_in_user_only_the_device_asked_about(monkeypatch):
    monkeypatch.setattr(repo, "list_devices", lambda sub: pytest.fail("must not be queried"))
    assert repo.baseline_device_ids(None, NEW) == [NEW]


def test_a_device_not_registered_to_the_account_is_not_pooled(monkeypatch):
    monkeypatch.setattr(repo, "list_devices", lambda sub: ACCOUNT)
    assert repo.baseline_device_ids("user-1", "someone-elses-device") == ["someone-elses-device"]


def test_a_registry_failure_narrows_the_baseline_rather_than_failing_the_request(monkeypatch):
    def boom(sub):
        raise RuntimeError("supabase unreachable")

    monkeypatch.setattr(repo, "list_devices", boom)
    assert repo.baseline_device_ids("user-1", NEW) == [NEW]


def test_values_come_from_one_query_over_the_pooled_ids(monkeypatch):
    asked: list[list[str]] = []

    def fake_pm25_values(device_ids, hours):
        asked.append(list(device_ids))
        return [10.0, 11.0]

    monkeypatch.setattr(repo, "list_devices", lambda sub: ACCOUNT)
    monkeypatch.setattr(repo.influx_query, "pm25_values", fake_pm25_values)

    assert repo.get_baseline_values(NEW, user_sub="user-1") == [10.0, 11.0]
    assert len(asked) == 1
    assert sorted(asked[0]) == sorted([NEW, OLD])


def test_the_pooled_answer_does_not_overwrite_the_anonymous_one(monkeypatch):
    """The same device is asked about both ways. One cache entry for both would serve a
    signed-in caller's pooled range to an anonymous one, and vice versa."""
    monkeypatch.setattr(repo, "list_devices", lambda sub: ACCOUNT)
    monkeypatch.setattr(
        repo.influx_query,
        "pm25_values",
        lambda device_ids, hours: [float(len(device_ids))],
    )

    assert repo.get_baseline_values(NEW) == [1.0]
    assert repo.get_baseline_values(NEW, user_sub="user-1") == [2.0]
