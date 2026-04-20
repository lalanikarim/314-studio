"""WebSocket helpers for the harness."""

from __future__ import annotations

import asyncio
import json
import websockets  # type: ignore[import-untyped]

from .colors import info, ok
from .config import WS_BASE, WS_RECV_TIMEOUT


async def ws_connect(session_id: str) -> websockets.WebSocketClientProtocol:
    """Connect to WS endpoint — mimics useWebSocket connect."""
    url = f"{WS_BASE}/api/projects/ws?session_id={session_id}"
    info(f"WebSocket: {url}")
    ws = await websockets.connect(url)
    ok("WS connected")
    return ws


async def ws_send(ws, payload: dict | str) -> None:
    """Send a message over WS (auto-JSON-encode dicts)."""
    msg = json.dumps(payload) if isinstance(payload, dict) else payload
    info(f"→ send: {msg[:300]}")
    await ws.send(msg)


async def ws_receive(ws, timeout: float = WS_RECV_TIMEOUT) -> dict | None:
    """Receive one JSON message. Returns None on timeout."""
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        return json.loads(raw)
    except asyncio.TimeoutError:
        return None
