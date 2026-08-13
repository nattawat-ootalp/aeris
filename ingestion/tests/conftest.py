"""Ingestion test fixtures — a TestClient plus an autouse guard that keeps tests offline
(no InfluxDB / Supabase network calls)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from core_api.app.main import app
from ingestion.app import supa, writers


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    calls: dict[str, list] = {"write_reading": [], "upsert_device": [], "sb_post": []}
    monkeypatch.setattr(writers, "write_reading", lambda *a, **k: calls["write_reading"].append((a, k)))
    monkeypatch.setattr(writers, "upsert_device", lambda *a, **k: calls["upsert_device"].append((a, k)))
    monkeypatch.setattr(supa, "sb_post", lambda *a, **k: calls["sb_post"].append((a, k)) or [{}])
    return calls
