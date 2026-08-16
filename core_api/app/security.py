"""JWT auth for write endpoints.

# reused from AirSentinel (backend/app/security.py) pattern — HS256 tokens, FastAPI dependency.
Write endpoints (set threshold, log symptom) require a bearer token; public reads do not.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ingestion.app.config import settings

_bearer = HTTPBearer(auto_error=False)


def create_token(subject: str, extra: dict | None = None, hours: int | None = None) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(hours=hours or settings.JWT_EXPIRE_HOURS),
        **(extra or {}),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


# Tokens are issued by other machines — a phone, Supabase's auth server — whose clocks are
# not synchronised with this one. Without slack, a clock a single second ahead makes a
# just-issued token fail as "not yet valid (iat)", which surfaces as an unexplained 401 that
# comes and goes. 30 s is far below any sensible token lifetime, so it costs no real security.
CLOCK_SKEW_LEEWAY_SEC = 30


def decode_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
        leeway=CLOCK_SKEW_LEEWAY_SEC,
    )


_jwks_client: jwt.PyJWKClient | None = None


def _supabase_jwks() -> jwt.PyJWKClient | None:
    """Cached JWKS client for the project's published signing keys.

    Supabase issues **ES256** access tokens signed with an asymmetric key pair and publishes
    the public half at this endpoint (no apikey required). The legacy shared HS256 secret still
    exists in the dashboard but does not verify these tokens, so a project that has moved to
    signing keys cannot be supported by the secret alone.
    """
    global _jwks_client
    if _jwks_client is None and settings.SUPABASE_URL:
        _jwks_client = jwt.PyJWKClient(
            f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            timeout=5,
        )
    return _jwks_client


def decode_supabase_token(token: str) -> dict:
    """Verify a Supabase Auth access token (email or anonymous sign-in) — mobile clients
    authenticate this way so RLS policies key on the same `auth.uid()` as the token's `sub`.

    Handles both signing schemes a project may be on: asymmetric (ES256/RS256, verified
    against the published JWKS) and the older shared HS256 secret. The algorithm in the token
    header decides which, so a project can migrate without a backend change.
    """
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")

    if alg.startswith(("ES", "RS")):
        client = _supabase_jwks()
        if client is None:
            raise jwt.InvalidKeyError("SUPABASE_URL is not configured")
        key = client.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience="authenticated",
            leeway=CLOCK_SKEW_LEEWAY_SEC,
        )

    if not settings.SUPABASE_JWT_SECRET:
        raise jwt.InvalidKeyError("SUPABASE_JWT_SECRET is not configured")
    return jwt.decode(
        token,
        settings.SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        audience="authenticated",
        leeway=CLOCK_SKEW_LEEWAY_SEC,
    )


def require_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    # Try our own tokens first (admin/threshold flows), then Supabase Auth tokens (mobile).
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWTError:
        pass
    if settings.SUPABASE_JWT_SECRET:
        try:
            return decode_supabase_token(creds.credentials)
        except jwt.PyJWTError as e:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from e
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
