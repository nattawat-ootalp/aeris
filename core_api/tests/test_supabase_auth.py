"""Supabase access-token verification across both signing schemes.

A project may sign with an asymmetric key pair (ES256/RS256, public half published as JWKS) or
with the older shared HS256 secret. Supabase now defaults to the former, so pinning the
verifier to HS256 rejects every real token while the secret looks correctly configured — which
is exactly what happened here, and reads as "invalid token" with no further explanation.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from core_api.app import security


def _es256_keypair():
    private = ec.generate_private_key(ec.SECP256R1())
    return private, private.public_key()


def _claims(**over):
    now = datetime.now(UTC)
    return {
        "sub": "d161df4e-314b-43b1-9ca0-9fc8ee18a03c",
        "aud": "authenticated",
        "role": "authenticated",
        "iat": now,
        "exp": now + timedelta(hours=1),
        **over,
    }


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJwks:
    def __init__(self, key):
        self._key = key

    def get_signing_key_from_jwt(self, token):  # noqa: ARG002 - signature mirrors PyJWKClient
        return _FakeSigningKey(self._key)


def test_es256_token_is_verified_against_the_published_jwks(monkeypatch):
    private, public = _es256_keypair()
    monkeypatch.setattr(security, "_supabase_jwks", lambda: _FakeJwks(public))
    token = jwt.encode(_claims(), private, algorithm="ES256")
    assert security.decode_supabase_token(token)["sub"].startswith("d161df4e")


def test_a_token_signed_by_a_different_key_is_rejected(monkeypatch):
    _, public = _es256_keypair()
    attacker, _ = _es256_keypair()
    monkeypatch.setattr(security, "_supabase_jwks", lambda: _FakeJwks(public))
    token = jwt.encode(_claims(), attacker, algorithm="ES256")
    with pytest.raises(jwt.PyJWTError):
        security.decode_supabase_token(token)


def test_wrong_audience_is_rejected(monkeypatch):
    private, public = _es256_keypair()
    monkeypatch.setattr(security, "_supabase_jwks", lambda: _FakeJwks(public))
    token = jwt.encode(_claims(aud="anon"), private, algorithm="ES256")
    with pytest.raises(jwt.PyJWTError):
        security.decode_supabase_token(token)


def test_legacy_hs256_tokens_still_verify(monkeypatch):
    """Projects that have not migrated keep working — the token header picks the scheme."""
    monkeypatch.setattr(security.settings, "SUPABASE_JWT_SECRET", "legacy-secret-value")
    token = jwt.encode(_claims(), "legacy-secret-value", algorithm="HS256")
    assert security.decode_supabase_token(token)["role"] == "authenticated"


def test_hs256_without_a_configured_secret_fails_clearly(monkeypatch):
    monkeypatch.setattr(security.settings, "SUPABASE_JWT_SECRET", "")
    token = jwt.encode(_claims(), "whatever", algorithm="HS256")
    with pytest.raises(jwt.InvalidKeyError):
        security.decode_supabase_token(token)


# ── require_user: which verifier a request actually reaches ──────────────────────────────────
# decode_supabase_token above was already covered; the dependency that calls it was not, and
# that is where the two schemes were being conflated.


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_a_signing_key_project_is_accepted_without_a_legacy_secret(monkeypatch):
    """The regression: an ES256 token verifies against the JWKS, which needs no shared secret.

    require_user used to skip the Supabase verifier entirely unless SUPABASE_JWT_SECRET was
    set, so a project that had migrated to signing keys — the current Supabase default — got a
    401 on every authenticated endpoint while nothing about its configuration was wrong.
    """
    private, public = _es256_keypair()
    monkeypatch.setattr(security, "_supabase_jwks", lambda: _FakeJwks(public))
    monkeypatch.setattr(security.settings, "SUPABASE_JWT_SECRET", "")
    token = jwt.encode(_claims(), private, algorithm="ES256")

    assert security.require_user(_creds(token))["sub"].startswith("d161df4e")


def test_our_own_token_is_tried_before_supabase(monkeypatch):
    """The admin/threshold flow must keep working even with no Supabase project reachable."""
    monkeypatch.setattr(security, "_supabase_jwks", lambda: None)
    monkeypatch.setattr(security.settings, "SUPABASE_JWT_SECRET", "")

    assert security.require_user(_creds(security.create_token("admin-1")))["sub"] == "admin-1"


def test_an_unverifiable_token_is_401_not_a_crash(monkeypatch):
    monkeypatch.setattr(security, "_supabase_jwks", lambda: None)
    monkeypatch.setattr(security.settings, "SUPABASE_JWT_SECRET", "")

    with pytest.raises(HTTPException) as raised:
        security.require_user(_creds("not-a-jwt"))
    assert raised.value.status_code == 401


def test_a_missing_header_is_401():
    with pytest.raises(HTTPException) as raised:
        security.require_user(None)
    assert raised.value.status_code == 401
