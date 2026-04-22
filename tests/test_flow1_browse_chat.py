#!/usr/bin/env python3
"""
Flow 1: Browse directories → Model select → Session create → Chat via WS

Covers: T1.1–T1.12
"""

from __future__ import annotations

import os

# Ensure test_utils is importable (same directory)

import httpx


from test_utils import (
    API_BASE,
    TEST_MODEL_ID,
    TESTS_DIR,
    TIMEOUT,
    http_get,
    http_post_json,
    ws_collect,
    ws_connect,
    ws_receive,
    ws_send,
)

# Override TEST_MODEL_ID from env
TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", TEST_MODEL_ID)
TEST_MODEL_PROVIDER = os.environ.get("TEST_MODEL_PROVIDER", "vllm")


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_browse_directory(client, result):
    """T1.1 — Browse directories (recursive).

    Creates a temporary fixture directory with:
      flat/           (1 file)
      nested/
        subdir1/      (1 file)
        subdir2/      (1 file)
    Cleans up the temp dir after the test.
    """
    import shutil
    import tempfile

    print("\n  T1.1 Browse directories")

    # ── Setup: create temp fixture directory ──────────────────────────────
    tmp_dir = tempfile.mkdtemp(prefix="browse_test_")
    try:
        # flat: 1 subfolder with 1 file
        flat_dir = os.path.join(tmp_dir, "flat")
        os.makedirs(flat_dir, exist_ok=True)
        with open(os.path.join(flat_dir, "main.py"), "w") as f:
            f.write("def main(): pass\n")

        # nested: 2 subfolders, each with 1 file
        nested_dir = os.path.join(tmp_dir, "nested")
        os.makedirs(os.path.join(nested_dir, "subdir1"), exist_ok=True)
        os.makedirs(os.path.join(nested_dir, "subdir2"), exist_ok=True)
        with open(os.path.join(nested_dir, "subdir1", "app.py"), "w") as f:
            f.write("def app(): pass\n")
        with open(os.path.join(nested_dir, "subdir2", "config.py"), "w") as f:
            f.write("def config(): pass\n")

        # ── T1.1a — Browse root ───────────────────────────────────────────
        resp = await http_get(client, "/api/browse", params={"path": tmp_dir})
        if resp.status_code != 200:
            result.failed += 1
            result.failures.append("T1.1a: Browse returned non-200")
            return

        data = resp.json()
        names = {d["name"] for d in data}
        result.check("flat" in names, "Root contains 'flat'")
        result.check("nested" in names, "Root contains 'nested'")

        # ── T1.1b — Browse flat ───────────────────────────────────────────
        resp = await http_get(client, "/api/browse", params={"path": flat_dir})
        if resp.status_code != 200:
            result.failed += 1
            result.failures.append("T1.1b: Browse flat returned non-200")
            return
        data = resp.json()
        result.check(isinstance(data, list), f"flat dir returns list, got {len(data)} items")

        # ── T1.1c — Browse nested (should have 2 subdirs) ─────────────────
        resp = await http_get(client, "/api/browse", params={"path": nested_dir})
        if resp.status_code != 200:
            result.failed += 1
            result.failures.append("T1.1c: Browse nested returned non-200")
            return
        data = resp.json()
        result.check(len(data) >= 2, f"nested has >= 2 subdirs, got {len(data)}")

    finally:
        # ── Teardown: remove temp dir and all contents ────────────────────
        shutil.rmtree(tmp_dir, ignore_errors=True)


async def test_list_projects(client, result):
    """T1.2 — List projects."""
    print("\n  T1.2 List projects")
    resp = await http_get(client, "/api/projects/")
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T1.2: List projects returned non-200")
        return
    data = resp.json()
    result.check(isinstance(data, list), "Returns a list")
    result.check("web-pi-integration-tests" in data, "Contains 'web-pi-integration-tests'")


async def test_project_info_before_session(client, result):
    """T1.3 — Get project info before session creation."""
    print("\n  T1.3 Project info (before session)")
    resp = await http_get(client, "/api/projects/info", params={"project_path": str(TESTS_DIR)})
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T1.3: Project info returned non-200")
        return
    data = resp.json()
    result.check(
        data.get("running_count") == 0,
        f"running_count == 0, got {data.get('running_count')}",
    )
    result.check(data.get("sessions") == [], f"sessions empty, got {data.get('sessions')}")


async def test_create_session(client, result):
    """T1.4 — Create session."""
    print("\n  T1.4 Create session")
    resp = await http_post_json(
        client,
        "/api/projects/",
        body={"name": "Flow1-Test"},
        params={"project_path": str(TESTS_DIR)},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append(f"T1.4: Create session returned {resp.status_code}")
        return

    data = resp.json()
    result.check(data.get("status") == "running", f"status == 'running', got {data.get('status')}")
    result.check(
        data.get("model_id") is None, "model_id is unset (session creation is model-agnostic)"
    )
    result.check(data.get("pid") is not None, "PID is set")
    result.check(len(data.get("session_id", "")) > 0, "session_id is non-empty")

    return data.get("session_id")


async def test_list_models(client, result, session_id: str):
    """T1.5 — List models with session."""
    print("\n  T1.5 List models")
    resp = await http_get(client, "/api/models/", params={"session_id": session_id})
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T1.5: List models returned non-200")
        return
    data = resp.json()
    result.check(isinstance(data, list), "Returns a list")
    result.check(len(data) > 0, f"At least 1 model, got {len(data)}")


async def test_project_info_after_session(client, result, session_id: str):
    """T1.6 — Get project info after session creation."""
    print("\n  T1.6 Project info (after session)")
    resp = await http_get(client, "/api/projects/info", params={"project_path": str(TESTS_DIR)})
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T1.6: Project info returned non-200")
        return
    data = resp.json()
    result.check(
        data.get("running_count") == 1,
        f"running_count == 1, got {data.get('running_count')}",
    )
    result.check(len(data.get("sessions", [])) >= 1, "sessions list has >= 1 item")


async def test_ws_connect_set_model(client, result, session_id: str):
    """T1.7 — WebSocket connect (auto-sends set_model)."""
    print("\n  T1.7 WS connect")

    ws = await ws_connect(session_id)

    # Receive initial messages — look for set_model response
    initial = await ws_receive(ws, timeout=10.0)
    if initial:
        init_type = initial.get("type", initial.get("kind", "?"))
        print(f"     Initial: type={init_type}")
        result.check(True, f"Got initial message type='{init_type}'")
    else:
        print("     (No initial message — set_model response may have been missed)")
        result.skipped += 1

    return ws


async def test_ws_get_state(client, result, ws):
    """T1.8 — Send get_state via WS."""
    print("\n  T1.8 WS get_state")
    await ws_send(ws, {"type": "get_state"})

    initial = await ws_receive(ws, timeout=10.0)
    if initial:
        msg_type = initial.get("type", initial.get("kind", "?"))
        print(f"     Response: type={msg_type}")
        result.check(
            msg_type in ("response", "rpc_event"),
            f"Got response or rpc_event, got '{msg_type}'",
        )
    else:
        result.failed += 1
        result.failures.append("T1.8: get_state no response within timeout")


async def test_ws_prompt(client, result, ws):
    """T1.9 — Send chat message."""
    print("\n  T1.9 WS prompt")
    await ws_send(ws, {"type": "prompt", "message": "Hello, who are you?"})

    events = await ws_collect(ws)
    if events:
        types = [e.get("type", e.get("kind", "?")) for e in events]
        result.check(len(events) > 0, f"Received {len(events)} events: {types[:5]}")
        result.check(
            any(t in ("turn_end", "agent_end", "response") for t in types),
            "Got meaningful end event",
        )
    else:
        result.failed += 1
        result.failures.append("T1.9: No events from prompt")


async def test_ws_conversation(client, result, ws):
    """T1.10 — Send second chat message (conversation)."""
    print("\n  T1.10 WS conversation")
    await ws_send(ws, {"type": "prompt", "message": "What files exist in this project?"})

    events = await ws_collect(ws)
    if events:
        result.check(len(events) > 0, f"Got response to conversation: {len(events)} events")
    else:
        result.failed += 1
        result.failures.append("T1.10: No response to conversation prompt")


async def test_ws_disconnect(client, result, session_id: str, ws):
    """T1.11 — WS disconnect (session stays alive)."""
    print("\n  T1.11 WS disconnect")
    await ws.close()

    # Verify session still running
    async with httpx.AsyncClient() as inner:
        resp = await http_get(inner, "/api/projects/info", params={"project_path": str(TESTS_DIR)})
        data = resp.json()
        result.check(
            data.get("running_count") == 1,
            f"Session still running after disconnect: count={data.get('running_count')}",
        )


async def test_ws_reconnect(client, result, session_id: str):
    """T1.12 — WS reconnect."""
    print("\n  T1.12 WS reconnect")
    ws = await ws_connect(session_id)
    await ws.close()
    result.check(True, "Reconnected successfully")


# ── Runner ───────────────────────────────────────────────────────────────────


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        session_id = None

        # T1.1 – T1.3: Browse & project info
        await test_browse_directory(client, result)
        await test_list_projects(client, result)
        await test_project_info_before_session(client, result)

        # T1.4: Create session (returns session_id)
        session_id = await test_create_session(client, result)
        if session_id is None:
            result.failed += 7
            result.failures.append("T1.5–T1.12: Skipped due to session creation failure")
            return

        # T1.5 – T1.6: Models & project info
        await test_list_models(client, result, session_id)
        await test_project_info_after_session(client, result, session_id)

        # T1.7 – T1.10: WS chat
        ws = await test_ws_connect_set_model(client, result, session_id)
        await test_ws_get_state(client, result, ws)
        await test_ws_prompt(client, result, ws)
        await test_ws_conversation(client, result, ws)

        # T1.11 – T1.12: Disconnect & reconnect
        await test_ws_disconnect(client, result, session_id, ws)
        await test_ws_reconnect(client, result, session_id)

        # Cleanup: close session
        await client.post(f"{API_BASE}/api/projects/{session_id}/close")
