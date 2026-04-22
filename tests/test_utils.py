"""
Shared test utilities for integration test flows.

Common HTTP helpers, WS helpers, constants, and paths used by all flow scripts.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx
import websockets  # type: ignore[import-untyped]

# ── Constants ────────────────────────────────────────────────────────────────

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765")
WS_BASE = os.environ.get("WS_BASE", "ws://127.0.0.1:8765")
TIMEOUT = 300.0
WS_TIMEOUT = 10.0
TESTS_DIR = Path(
    os.environ.get("TESTS_DIR", str(Path.home() / "Projects" / "web-pi-integration-tests"))
)
FLAT_DIR = TESTS_DIR / "flat"
NESTED_DIR = TESTS_DIR / "nested"

# Model config from environment
TEST_MODEL_ID = "Qwen/Qwen3.6-35B-A3B"
TEST_MODEL2_ID = os.environ.get("TEST_MODEL2_ID", "")


# ── HTTP helpers ─────────────────────────────────────────────────────────────


async def http_get(client: httpx.AsyncClient, path: str, params: dict | None = None):
    url = f"{API_BASE}{path}"
    q = ""
    if params:
        q = "?" + "&".join(f"{k}={v}" for k, v in params.items())
    print(f"  → GET  {path}{q}")
    resp = await client.get(url, params=params, timeout=TIMEOUT)
    print(f"     ← {resp.status_code}")
    return resp


async def http_post_json(client, path, body=None, params=None):
    """POST with JSON body, print request/response."""
    url = f"{API_BASE}{path}"
    q = ""
    if params:
        q = "?" + "&".join(f"{k}={v}" for k, v in params.items())
    print(f"  → POST {path}{q}")
    resp = await client.post(url, json=body, params=params, timeout=TIMEOUT)
    print(f"     ← {resp.status_code}")
    return resp


# ── WebSocket helpers ────────────────────────────────────────────────────────


async def ws_connect(session_id: str):
    """Connect to WS endpoint, return websocket object."""
    url = f"{WS_BASE}/api/projects/ws?session_id={session_id}"
    print(f"  → WS   /api/projects/ws?session_id={session_id[:12]}...")
    ws = await websockets.connect(url)
    print("     ← WS connected")
    return ws


async def ws_send(ws, payload: dict):
    """Send a JSON message over WS."""
    msg = json.dumps(payload)
    await ws.send(msg)


async def ws_receive(ws, timeout: float = WS_TIMEOUT):
    """Receive and parse one JSON message from WS. Returns None on timeout."""
    try:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        return json.loads(raw)
    except asyncio.TimeoutError:
        return None


async def ws_collect(ws, max_events: int = 50, total_timeout: float = 25.0):
    """Collect streaming events until we get a terminal event (turn_end/agent_end/response)."""
    events = []
    deadline = asyncio.get_event_loop().time() + total_timeout
    while len(events) < max_events and asyncio.get_event_loop().time() < deadline:
        remaining = deadline - asyncio.get_event_loop().time()
        if remaining <= 0:
            break
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=min(5.0, remaining))
            evt = json.loads(raw)
            events.append(evt)
            etype = evt.get("type", evt.get("kind", "unknown"))
            if etype in ("turn_end", "agent_end", "response"):
                break
        except asyncio.TimeoutError:
            continue
    return events
