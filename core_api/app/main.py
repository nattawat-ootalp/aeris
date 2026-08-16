"""Aeris FastAPI application (single deploy unit on Render).

Composes the ingestion surface (webhook + portable) with the core read API. This is the
uvicorn entrypoint referenced by the Dockerfile: ``core_api.app.main:app``.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ingestion.app.config import settings
from ingestion.app.router import router as ingestion_router

from .read_api import router as core_router
from .realtime import router as ws_router

app = FastAPI(
    title="Aeris API",
    version="0.1.0",
    summary="Personal environmental exposure & decision support (non-diagnostic).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingestion_router)
app.include_router(core_router)
app.include_router(ws_router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "service": "aeris-core-api"}


@app.get("/health/auth", tags=["meta"])
def auth_health() -> dict:
    """Whether the deployed process actually loaded its signing secrets.

    Reports only a length and a truncated SHA-256 fingerprint — never the secret itself. That
    is enough to tell "not configured" from "configured with a different value than expected",
    which the shared 401 "invalid token" response cannot distinguish and which otherwise takes
    a deploy per guess to find.
    """
    import hashlib

    def fingerprint(secret: str) -> dict:
        if not secret:
            return {"configured": False, "length": 0, "sha256_8": None}
        return {
            "configured": True,
            "length": len(secret),
            "sha256_8": hashlib.sha256(secret.encode()).hexdigest()[:8],
        }

    return {
        "jwt_algorithm": settings.JWT_ALGORITHM,
        "jwt_secret": fingerprint(settings.JWT_SECRET),
        "supabase_jwt_secret": fingerprint(settings.SUPABASE_JWT_SECRET),
    }
