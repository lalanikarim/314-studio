"""
Shared test utilities for integration test flows.

Common HTTP helpers, SSE helpers, constants, and paths used by all flow scripts.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx

# ── Constants ────────────────────────────────────────────────────────────────

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000")
TIMEOUT = 300.0
SSE_TIMEOUT = 10.0
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


# ── SSE helpers ──────────────────────────────────────────────────────────────


async def sse_connect(session_id: str):
    """Open SSE stream for a session. Returns (httpx.AsyncClient, httpx.Response).

    The caller should use sse_collect() to read events from the stream.
    Both client and response are closed by sse_collect.
    """
    url = f"{API_BASE}/api/projects/sse?session_id={session_id}"
    print(f"  → SSE  /api/projects/sse?session_id={session_id[:12]}...")
    client = httpx.AsyncClient(timeout=TIMEOUT)
    response = await client.stream("GET", url)
    await response.aread()  # Trigger the request; check status
    if response.status_code != 200:
        await client.aclose()
        raise RuntimeError(f"SSE connection failed: {response.status_code}")
    return client, response


async def sse_collect(
    response_stream,
    client: httpx.AsyncClient,
    max_events: int = 50,
    total_timeout: float = 25.0,
) -> list[dict]:
    """Read SSE events from a streaming response.

    Returns list of parsed event dicts: {"type": ..., "data": {...}}

    SSE wire format:
      - event:  → event type name
      - data:   → JSON payload
      - :       → comment (keepalive), ignored
      - Events separated by \n\n (empty line)
    """
    events = []
    current_event = ""
    current_type = None
    deadline = asyncio.get_event_loop().time() + total_timeout

    async with response_stream:
        async for line in response_stream.aiter_lines():
            if line == "":
                # Empty line = event boundary
                if current_event:
                    try:
                        data = json.loads(current_event)
                    except json.JSONDecodeError:
                        data = current_event
                    events.append({"type": current_type, "data": data})
                    current_event = ""
                    current_type = None
                if len(events) >= max_events:
                    break
                continue

            if line.startswith("event:"):
                current_type = line[6:].strip()
            elif line.startswith("id:"):
                pass  # Event IDs — not used in tests
            elif line.startswith("data:"):
                current_event += line[5:].strip() + "\n"
            elif line.startswith(":"):
                pass  # Comment / keepalive — ignore

            # Check timeout
            if asyncio.get_event_loop().time() >= deadline:
                break

    await client.aclose()
    return events


async def send_cmd(session_id: str, command: dict) -> dict:
    """Send a REST command to the session.

    Maps directly to POST /api/projects/{session_id}/cmd.
    """
    url = f"{API_BASE}/api/projects/{session_id}/cmd"
    print(f"  → CMD  /api/projects/{session_id[:12]}... command={command.get('command')}")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(url, json=command, timeout=TIMEOUT)
        result = resp.json()
        print(f"     ← {resp.status_code} {result}")
        return result


async def send_prompt(session_id: str, message: str, streaming_behavior: str | None = None) -> dict:
    """Convenience: send a chat prompt via REST command."""
    cmd: dict = {"command": "prompt", "message": message}
    if streaming_behavior:
        cmd["streamingBehavior"] = streaming_behavior
    return await send_cmd(session_id, cmd)


async def send_abort(session_id: str) -> dict:
    """Send an abort command via REST."""
    return await send_cmd(session_id, {"command": "abort"})


async def send_compact(session_id: str) -> dict:
    """Send a compact command via REST."""
    return await send_cmd(session_id, {"command": "compact"})


async def send_get_state(session_id: str) -> dict:
    """Send a get_state command via REST."""
    return await send_cmd(session_id, {"command": "get_state"})


async def send_set_model(session_id: str, model_id: str, provider: str = "") -> dict:
    """Send a set_model command via REST."""
    return await send_cmd(session_id, {"command": "set_model", "modelId": model_id, "provider": provider})
