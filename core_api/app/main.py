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
