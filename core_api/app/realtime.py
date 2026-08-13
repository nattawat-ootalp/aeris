"""WS /ws/realtime — push telemetry/decision updates to connected clients (TDD §8).

Minimal broadcast hub. Ingestion (or a future task) can call ``manager.broadcast(...)`` to fan
out fresh decisions; clients that drop are pruned so a dead socket can't wedge the loop.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger("aeris.realtime")
router = APIRouter()


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict) -> None:
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 — drop dead sockets, keep serving the rest
                self.disconnect(ws)


manager = ConnectionManager()


@router.websocket("/ws/realtime")
async def ws_realtime(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        await ws.send_json({"type": "hello", "service": "aeris"})
        while True:
            await ws.receive_text()  # keepalive pings; inbound is ignored for now
    except WebSocketDisconnect:
        manager.disconnect(ws)
