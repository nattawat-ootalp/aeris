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


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


def require_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from e
