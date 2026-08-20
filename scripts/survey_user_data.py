"""What is stored, and under which account.

Every health table is owned by an `auth.users` id. The app creates an anonymous account on
first use, so a person who has used the app from several browsers or reinstalled it owns
several accounts, each holding part of their record. This prints that picture before anything
is moved, because a consolidation cannot be undone and the counts are the only way to tell
"this account is the real one" from "this account was a browser I opened once".

Read-only. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS, which
is the point — no single user's token can see across accounts).
"""
from __future__ import annotations

import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ingestion.app.config import settings  # noqa: E402

# The tables keyed on a single owner column. `exposure_results` is deliberately absent: it
# inherits its owner through `simulation_id` and moves with its parent.
OWNED_TABLES = (
    "devices",
    "exposure_events",
    "symptom_events",
    "personal_baseline",
    "patterns",
    "decision_events",
    "privacy_consents",
    "action_plans",
    "emergency_contacts",
    "sos_events",
    "exposure_simulations",
    "replay_bookmarks",
)


def _headers() -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise SystemExit(
            "SUPABASE_SERVICE_ROLE_KEY is not set. This script reads across every account, so "
            "it needs the service role key; the anon key cannot see past RLS."
        )
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}


def auth_users() -> list[dict]:
    r = httpx.get(
        f"{settings.SUPABASE_URL}/auth/v1/admin/users",
        headers=_headers(), params={"per_page": 1000}, timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("users", body if isinstance(body, list) else [])


def rows(table: str) -> list[dict]:
    """Every row's owner and timestamp. Tables are small here; a count per user would need one
    request each and would still not show when the account was last actually used."""
    r = httpx.get(
        f"{settings.SUPABASE_URL}/rest/v1/{table}",
        headers=_headers(), params={"select": "user_id,created_at"}, timeout=30,
    )
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return r.json()


def main() -> None:
    users = auth_users()
    by_id = {u["id"]: u for u in users}
    print(f"{len(users)} account(s); {sum(1 for u in users if u.get('email'))} with an email\n")

    per_user: dict[str, dict[str, int]] = {}
    for table in OWNED_TABLES:
        try:
            for row in rows(table):
                uid = row.get("user_id")
                if uid:
                    per_user.setdefault(uid, {})[table] = per_user.setdefault(uid, {}).get(table, 0) + 1
        except httpx.HTTPStatusError as e:
            print(f"  ! {table}: {e.response.status_code} {e.response.text[:80]}")

    if not per_user:
        print("No owned rows in any table.")
    ranked = sorted(per_user.items(), key=lambda kv: sum(kv[1].values()), reverse=True)
    for uid, tables in ranked:
        u = by_id.get(uid, {})
        who = u.get("email") or "(anonymous)"
        total = sum(tables.values())
        print(f"{uid}  {who:32} {total:4} rows  created {u.get('created_at', '?')[:19]}")
        for t, n in sorted(tables.items(), key=lambda kv: -kv[1]):
            print(f"    {n:4}  {t}")

    empty = [u for u in users if u["id"] not in per_user]
    print(f"\n{len(empty)} account(s) own nothing at all.")


if __name__ == "__main__":
    main()
