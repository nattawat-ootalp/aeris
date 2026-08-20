"""Move every account's health rows onto one account.

The app creates an anonymous `auth.users` row on first use, so a person who has opened the
website in two browsers, reinstalled the app, or cleared storage owns several accounts, each
holding a slice of their own record. This reassigns all of them to a single owner.

It is deliberately a separate, explicit script rather than anything the app can do:

* It needs the service role key, because no user's own token can see — let alone rewrite —
  another account's rows. RLS is doing its job; this bypasses it on purpose.
* It cannot be undone. Once `user_id` is rewritten there is nothing left recording which
  account a row came from, so it prints the plan and requires --apply to act.
* It never merges `privacy_consents`. Consent is a statement someone made about one account,
  and silently transplanting it onto another would assert a choice they did not make there.

Usage:
    python scripts/consolidate_accounts.py --into <uuid|email>            # show the plan
    python scripts/consolidate_accounts.py --into <uuid|email> --apply    # do it
"""
from __future__ import annotations

import argparse
import os
import sys

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ingestion.app.config import settings  # noqa: E402

# Ownership is a plain `user_id` column on each of these. `exposure_results` is not here: it
# has no owner column and follows its parent simulation.
MOVABLE = (
    "devices",
    "exposure_events",
    "symptom_events",
    "personal_baseline",
    "patterns",
    "decision_events",
    "action_plans",
    "emergency_contacts",
    "sos_events",
    "exposure_simulations",
    "replay_bookmarks",
)

# Left where it is, on purpose — see the module docstring.
NOT_MOVED = ("privacy_consents",)

# `devices` is unique on (user_id, external_id) and `action_plans`/`privacy_consents` are
# unique per user, so moving rows can collide with what the target already owns. A collision
# is reported, not resolved: which of two action plans is the real one is not a decision a
# script should make.
UNIQUE_PER_USER = {"action_plans"}
UNIQUE_WITH = {"devices": "external_id"}


def headers(extra: dict | None = None) -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY is not set — this script cannot run without it.")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        **(extra or {}),
    }


def auth_users() -> list[dict]:
    r = httpx.get(
        f"{settings.SUPABASE_URL}/auth/v1/admin/users",
        headers=headers(), params={"per_page": 1000}, timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    return body.get("users", body if isinstance(body, list) else [])


def resolve_target(wanted: str, users: list[dict]) -> dict:
    for u in users:
        if u["id"] == wanted or (u.get("email") or "").lower() == wanted.lower():
            return u
    known = ", ".join(sorted(u.get("email") or u["id"][:8] for u in users))
    raise SystemExit(f"No account matches {wanted!r}.\nAccounts: {known}")


def select(table: str, columns: str, params: dict | None = None) -> list[dict]:
    r = httpx.get(
        f"{settings.SUPABASE_URL}/rest/v1/{table}",
        headers=headers(), params={"select": columns, **(params or {})}, timeout=30,
    )
    if r.status_code == 404:
        return []
    r.raise_for_status()
    return r.json()


def reassign(table: str, from_uid: str, to_uid: str) -> int:
    r = httpx.patch(
        f"{settings.SUPABASE_URL}/rest/v1/{table}",
        headers=headers({"Prefer": "return=representation"}),
        params={"user_id": f"eq.{from_uid}"},
        json={"user_id": to_uid},
        timeout=60,
    )
    r.raise_for_status()
    return len(r.json())


def move_devices(tid: str) -> int:
    """Collapse the device registry to one row per device, owned by the target.

    `devices` is unique on (user_id, external_id), so a straight reassignment collides twice
    over: with what the target already holds, and with rows arriving from another account in
    the same run. Deduplicating first is safe in a way it would not be for any other table —
    a device row is a registry entry the app rewrites on the next connection (registerDevice),
    not a record of anything measured, so the copies are interchangeable.

    The survivor is the target's own row where it has one, otherwise the oldest, which is the
    one whose id anything else may already refer to.
    """
    rows = select("devices", "id,user_id,external_id,created_at")
    keep: dict[str, dict] = {}
    for row in rows:
        ext = row.get("external_id")
        if not ext:
            continue
        current = keep.get(ext)
        if current is None:
            keep[ext] = row
            continue
        if current.get("user_id") == tid:
            continue
        if row.get("user_id") == tid or (row.get("created_at") or "") < (current.get("created_at") or ""):
            keep[ext] = row

    survivors = {r["id"] for r in keep.values()}
    dropped = 0
    for row in rows:
        if row["id"] in survivors:
            continue
        r = httpx.delete(
            f"{settings.SUPABASE_URL}/rest/v1/devices",
            headers=headers(), params={"id": f"eq.{row['id']}"}, timeout=30,
        )
        r.raise_for_status()
        dropped += 1

    moved = 0
    for row in keep.values():
        if row.get("user_id") == tid:
            continue
        r = httpx.patch(
            f"{settings.SUPABASE_URL}/rest/v1/devices",
            headers=headers({"Prefer": "return=representation"}),
            params={"id": f"eq.{row['id']}"}, json={"user_id": tid}, timeout=30,
        )
        r.raise_for_status()
        moved += len(r.json())
    print(f"  devices                {moved} moved, {dropped} duplicate row(s) dropped")
    return moved


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--into", required=True, help="target account: uuid or email")
    ap.add_argument("--apply", action="store_true", help="actually rewrite (default: plan only)")
    args = ap.parse_args()

    users = auth_users()
    target = resolve_target(args.into, users)
    tid = target["id"]
    print(f"target: {tid}  {target.get('email') or '(anonymous)'}\n")

    plan: dict[str, dict[str, int]] = {}
    collisions: list[str] = []
    duplicate_devices: list[str] = []

    for table in MOVABLE:
        cols = "user_id"
        if table in UNIQUE_WITH:
            cols = f"user_id,{UNIQUE_WITH[table]}"
        rows = select(table, cols)
        mine = [r for r in rows if r.get("user_id") == tid]
        others = [r for r in rows if r.get("user_id") and r["user_id"] != tid]
        if not others:
            continue
        for r in others:
            plan.setdefault(r["user_id"], {})[table] = plan.setdefault(r["user_id"], {}).get(table, 0) + 1

        if table in UNIQUE_PER_USER and mine and others:
            collisions.append(f"{table}: target already has one and {len(others)} would move in")
        if table in UNIQUE_WITH:
            key = UNIQUE_WITH[table]
            held = {r.get(key) for r in mine}
            clashing = sorted({r.get(key) for r in others if r.get(key) in held})
            if clashing:
                # A device row is a registry entry, not a record of anything measured: the app
                # writes it again on the next connection (registerDevice). Two accounts holding
                # the same external_id are the same physical device seen from two browsers, so
                # dropping the incoming copy loses nothing, and is the one collision here that
                # can be settled without guessing.
                duplicate_devices.extend(clashing)

    if not plan:
        print("Nothing to move: every row already belongs to the target.")
        return

    total = 0
    for uid, tables in sorted(plan.items(), key=lambda kv: -sum(kv[1].values())):
        n = sum(tables.values())
        total += n
        print(f"  {uid}  {n:4} rows  " + ", ".join(f"{t} x{c}" for t, c in sorted(tables.items())))
    print(f"\n{total} rows from {len(plan)} account(s) would move onto {tid}.")
    print(f"not moved: {', '.join(NOT_MOVED)} (consent belongs to the account that gave it)")
    if duplicate_devices:
        dupes = sorted(set(duplicate_devices))
        print(f"duplicate device registrations dropped rather than moved: {dupes}")

    if collisions:
        print("\nUNIQUE CONSTRAINTS THAT WILL REJECT THE MOVE:")
        for c in collisions:
            print("  !", c)
        print("Resolve these by hand first — which of two rows is the real one is not a call")
        print("this script should make.")
        if args.apply:
            raise SystemExit(1)

    if not args.apply:
        print("\nPlan only. Re-run with --apply to rewrite. This cannot be undone.")
        return

    print("\napplying:")
    moved = 0
    moved += move_devices(tid)
    for table in MOVABLE:
        if table == "devices":
            continue  # handled above, one row per external_id
        for uid in plan:
            if table not in plan[uid]:
                continue
            n = reassign(table, uid, tid)
            moved += n
            print(f"  {table:22} {uid[:8]}... -> {n} row(s)")
    print(f"\n{moved} row(s) now belong to {tid}.")


if __name__ == "__main__":
    main()
