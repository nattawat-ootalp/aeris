"""Backend service configuration (shared by ingestion + core-api).

# reused from AirSentinel (backend/app/config.py) — loads .env and exposes service creds.
Extended for Aeris. Secrets come only from the environment / gitignored .env — never hardcoded.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

# load the repo-root .env (…/aeris/.env) if present; on Render the vars are already in the env
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


class Settings:
    # ── Supabase ──
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    # Legacy HS256 JWT secret (Supabase dashboard -> Project Settings -> API) — verifies
    # mobile-issued Supabase Auth tokens (email + anonymous sign-in). Empty = mobile auth
    # tokens are rejected; internal admin tokens (create_token) still work without it.
    SUPABASE_JWT_SECRET: str = os.getenv("SUPABASE_JWT_SECRET", "")

    # ── InfluxDB Cloud ──
    INFLUXDB_URL: str = os.getenv("INFLUXDB_URL", "")
    INFLUXDB_TOKEN: str = os.getenv("INFLUXDB_TOKEN", "")
    INFLUXDB_ORG: str = os.getenv("INFLUXDB_ORG", "")
    INFLUXDB_BUCKET: str = os.getenv("INFLUXDB_BUCKET", "sensor_data")

    # ── HiveMQ ──
    HIVEMQ_HOST: str = os.getenv("HIVEMQ_HOST", "")
    HIVEMQ_PORT: int = int(os.getenv("HIVEMQ_PORT", "8883"))
    HIVEMQ_USERNAME: str = os.getenv("HIVEMQ_USERNAME", "")
    HIVEMQ_PASSWORD: str = os.getenv("HIVEMQ_PASSWORD", "")

    # ── Backend / API ──
    BACKEND_HOST: str = os.getenv("BACKEND_HOST", "0.0.0.0")
    BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8000"))
    JWT_SECRET: str = os.getenv("JWT_SECRET", "change-me")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    JWT_EXPIRE_HOURS: int = int(os.getenv("JWT_EXPIRE_HOURS", "12"))
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    # The website is one app served from several addresses: the production domain, the
    # per-branch alias, and a fresh preview URL for every deployment. An exact allow-list can
    # only ever name the first, so opening any of the others left the browser blocking every
    # API call while the page itself loaded fine — which reads as the API being down.
    # Matches this project's own Vercel deployments and nothing else.
    CORS_ORIGIN_REGEX: str = os.getenv(
        "CORS_ORIGIN_REGEX", r"https://aeris-web-nextair[a-z0-9-]*\.vercel\.app"
    )

    # ── Ingestion security ──
    # HMAC secret for the HiveMQ webhook. Empty = dev mode (accept + warn), never in prod.
    WEBHOOK_SECRET: str = os.getenv("WEBHOOK_SECRET", "")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
