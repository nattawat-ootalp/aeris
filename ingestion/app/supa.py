"""Supabase REST (PostgREST) client.

# reused from AirSentinel (backend/app/supa.py) — Supabase is reached over HTTPS REST, not a
direct PG port (blocked on general networks). Uses the service_role key server-side only.
"""
from __future__ import annotations

import httpx

from .config import settings

_TIMEOUT = 15


def _headers() -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _url(table: str) -> str:
    return f"{settings.SUPABASE_URL}/rest/v1/{table}"


def sb_get(table: str, params: dict | None = None) -> list:
    r = httpx.get(_url(table), headers=_headers(), params=params or {}, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def sb_post(table: str, data) -> list:
    r = httpx.post(_url(table), headers=_headers(), json=data, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def sb_patch(table: str, params: dict, data: dict) -> list:
    r = httpx.patch(_url(table), headers=_headers(), params=params, json=data, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()


def sb_delete(table: str, params: dict) -> list:
    if not params:
        raise ValueError("sb_delete requires filter params")  # guard against wiping a table
    r = httpx.delete(_url(table), headers=_headers(), params=params, timeout=_TIMEOUT)
    r.raise_for_status()
    return r.json()
