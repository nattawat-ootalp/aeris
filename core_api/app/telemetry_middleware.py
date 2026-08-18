"""Request metrics for the API (§ monitoring).

One middleware, three numbers per request: how many, how long, and what came back. That is
enough to answer the questions that actually get asked during an incident — is it up, is it
slow, is it erroring — without instrumenting each endpoint by hand and then forgetting to
instrument the next one.

The path is recorded as its ROUTE, not its URL. `/nodes/BKK-TRT-003/telemetry` and
`/nodes/DEMO-TRT-PARK/telemetry` are the same endpoint, and one series per device id would
turn a handful of metrics into thousands and bury the endpoint's real behaviour.
"""
from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

import observability


def _route_template(request: Request) -> str:
    """The matched route's path pattern, falling back to the literal path.

    A request that matched nothing (404) has no pattern; those are grouped under `unmatched`
    so a scanner probing random URLs cannot create a metric series per guess.
    """
    route = request.scope.get("route")
    template = getattr(route, "path", None)
    if template:
        return template
    return "unmatched"


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            # In the finally block so an endpoint that raised is still counted. An error that
            # disappears from the metrics is the one most worth seeing.
            elapsed_ms = (time.perf_counter() - started) * 1000
            tags = {
                "route": _route_template(request),
                "method": request.method,
                "status": status,
            }
            observability.metric("http.requests", 1, tags)
            observability.metric("http.duration_ms", elapsed_ms, tags)
            if status >= 500:
                observability.metric("http.server_errors", 1, tags)
