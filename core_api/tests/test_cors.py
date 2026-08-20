"""The website is one app served from several addresses; all of them must reach the API.

A browser enforces CORS, curl does not — so an origin the API does not answer for produces a
page that loads normally and then fails every request, which reads as the backend being down.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from core_api.app.main import app

client = TestClient(app)

PROD = "https://aeris-web-nextair.vercel.app"
PREVIEW = "https://aeris-web-nextair-git-main-someone.vercel.app"
DEPLOYMENT = "https://aeris-web-nextair-abc123-someone.vercel.app"


def _allowed(origin: str) -> str | None:
    r = client.get("/health", headers={"Origin": origin})
    assert r.status_code == 200
    return r.headers.get("access-control-allow-origin")


def test_the_production_origin_is_allowed():
    assert _allowed(PROD) == PROD


def test_a_branch_alias_is_allowed():
    """Vercel serves the same build from a per-branch URL; it is the same app."""
    assert _allowed(PREVIEW) == PREVIEW


def test_a_per_deployment_preview_is_allowed():
    assert _allowed(DEPLOYMENT) == DEPLOYMENT


def test_an_unrelated_origin_is_not_allowed():
    """The regex must match this project's deployments, not vercel.app at large."""
    assert _allowed("https://somebody-elses-app.vercel.app") is None
    assert _allowed("https://aeris-web-nextair.vercel.app.evil.test") is None
