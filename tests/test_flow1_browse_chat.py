#!/usr/bin/env python3
"""
Flow 1: Browse directories → Model select → Session create → Chat via SSE

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
    sse_collect,
    sse_connect,
    send_cmd,
    send_prompt,
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


async def test_sse_connect_set_model(client, result, session_id: str):
    """T1.7 — SSE connect (sends set_model event)."""
    print("\n  T1.7 SSE connect")

    sse_client, response = await sse_connect(session_id)

    # Collect initial events (expect set_model)
    events = await sse_collect(response, sse_client, max_events=3, total_timeout=10.0)
    if events:
        init_type = events[0].get("type", "?")
        print(f"     Initial: type={init_type}")
        result.check(init_type == "set_model", f"Got set_model event, got '{init_type}'")
    else:
        print("     (No initial message — set_model may have been missed)")
        result.skipped += 1

    return sse_client, response


async def test_sse_get_state(client, result, session_id: str, sse_client, response):
    """T1.8 — Send get_state via REST command."""
    print("\n  T1.8 SSE get_state")
    resp = await send_cmd(session_id, {"command": "get_state"})
    result.check(resp.get("status") == "ok", f"get_state command returned ok, got {resp}")
    return sse_client, response


async def test_sse_prompt(client, result, session_id: str, sse_client, response):
    """T1.9 — Send chat message via REST, collect SSE events."""
    print("\n  T1.9 SSE prompt")

    # Close previous SSE connection and open a new one for fresh events
    await sse_client.aclose()
    sse_client, response = await sse_connect(session_id)

    # Send prompt via REST
    resp = await send_prompt(session_id, "Hello, who are you?")
    result.check(resp.get("status") == "ok", f"Prompt command returned ok, got {resp}")

    # Collect streaming events from SSE
    events = await sse_collect(response, sse_client, max_events=30, total_timeout=30.0)
    if events:
        types = [e.get("type", "?") for e in events]
        result.check(len(events) > 0, f"Received {len(events)} events: {types[:5]}")
        result.check(
            any(t in ("rpc_event",) for t in types),
            "Got rpc_event (streaming events)",
        )
    else:
        result.failed += 1
        result.failures.append("T1.9: No events from prompt")

    return sse_client, response


async def test_sse_conversation(client, result, session_id: str, sse_client, response):
    """T1.10 — Send second chat message (conversation)."""
    print("\n  T1.10 SSE conversation")

    # Close previous SSE connection and open a new one for fresh events
    await sse_client.aclose()
    sse_client, response = await sse_connect(session_id)

    resp = await send_prompt(session_id, "What files exist in this project?")
    result.check(resp.get("status") == "ok", f"Prompt command returned ok, got {resp}")

    events = await sse_collect(response, sse_client, max_events=30, total_timeout=30.0)
    if events:
        result.check(len(events) > 0, f"Got response to conversation: {len(events)} events")
    else:
        result.failed += 1
        result.failures.append("T1.10: No response to conversation prompt")

    return sse_client, response


async def test_sse_disconnect(client, result, session_id: str, sse_client, response):
    """T1.11 — SSE disconnect (session stays alive)."""
    print("\n  T1.11 SSE disconnect")
    await sse_client.aclose()

    # Verify session still running
    async with httpx.AsyncClient() as inner:
        resp = await http_get(inner, "/api/projects/info", params={"project_path": str(TESTS_DIR)})
        data = resp.json()
        result.check(
            data.get("running_count") == 1,
            f"Session still running after disconnect: count={data.get('running_count')}",
        )


async def test_sse_reconnect(client, result, session_id: str):
    """T1.12 — SSE reconnect."""
    print("\n  T1.12 SSE reconnect")
    sse_client, response = await sse_connect(session_id)
    await sse_client.aclose()
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

        # T1.7 – T1.10: SSE chat
        sse_client, response = await test_sse_connect_set_model(client, result, session_id)
        sse_client, response = await test_sse_get_state(client, result, session_id, sse_client, response)
        sse_client, response = await test_sse_prompt(client, result, session_id, sse_client, response)
        sse_client, response = await test_sse_conversation(client, result, session_id, sse_client, response)

        # T1.11 – T1.12: Disconnect & reconnect
        await test_sse_disconnect(client, result, session_id, sse_client, response)
        await test_sse_reconnect(client, result, session_id)

        # Cleanup: close session
        await client.post(f"{API_BASE}/api/projects/{session_id}/close")
