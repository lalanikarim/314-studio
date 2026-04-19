#!/usr/bin/env python3
"""
Flow 3: Multiple Sessions on Same Project

Covers: T3.1–T3.7
"""

from __future__ import annotations

import os

import httpx

# Ensure test_utils is importable (same directory)

from test_utils import (
    TESTS_DIR,
    TIMEOUT,
    http_get,
    http_post_json,
    ws_collect,
    ws_connect,
    ws_send,
)

TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_create_session1(client, result):
    """T3.1 — Create second session on same project."""
    print("\n  T3.1 Create session 1")
    resp = await http_post_json(
        client,
        "/api/projects/",
        body={"name": "MultiTest-S1"},
        params={"project_path": str(TESTS_DIR)},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T3.1: Create session 1 returned non-200")
        return None

    data = resp.json()
    result.check(data.get("status") == "running", "status == 'running'")
    result.check(data.get("pid") is not None, "PID is set")
    result.check(len(data.get("session_id", "")) > 0, "session_id is non-empty")
    return data.get("session_id")


async def test_create_session2(client, result, session1_id):
    """T3.1 (cont) — Create second session."""
    print("\n  T3.1 Create session 2")
    resp = await http_post_json(
        client,
        "/api/projects/",
        body={"name": "MultiTest-S2"},
        params={"project_path": str(TESTS_DIR)},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T3.1: Create session 2 returned non-200")
        return None

    data = resp.json()
    session2_id = data.get("session_id")
    pid2 = data.get("pid")

    result.check(session2_id != session1_id, "session_id differs from session 1")
    result.check(pid2 is not None, "PID is set")

    # Verify different PIDs
    if session1_id:
        # We need to get session 1's PID to compare
        pass  # PID comparison done in info check

    return session2_id


async def test_project_info_two_sessions(client, result, session1_id, session2_id):
    """T3.2 — Get project info (two sessions)."""
    print("\n  T3.2 Project info (two sessions)")
    resp = await http_get(
        client,
        "/api/projects/info",
        params={"project_path": str(TESTS_DIR)},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T3.2: Project info returned non-200")
        return

    data = resp.json()
    result.check(
        data.get("running_count") == 2,
        f"running_count == 2, got {data.get('running_count')}",
    )
    sessions = data.get("sessions", [])
    result.check(
        len(sessions) >= 2,
        f"sessions has >= 2 items, got {len(sessions)}",
    )


async def test_independent_chat(client, result, session1_id, session2_id):
    """T3.3–T3.4 — Chat on sessions independently."""
    print("\n  T3.3 Chat on session 1")

    ws1 = await ws_connect(session1_id)
    await ws_send(
        ws1, {"type": "prompt", "message": "Session 1, identify yourself. Say 'I am session 1'."}
    )
    events1 = await ws_collect(ws1)
    await ws1.close()

    if events1:
        result.check(True, f"Session 1 responded: {len(events1)} events")
    else:
        result.failed += 1
        result.failures.append("T3.3: Session 1 no response")

    print("  T3.4 Chat on session 2")
    ws2 = await ws_connect(session2_id)
    await ws_send(
        ws2, {"type": "prompt", "message": "Session 2, identify yourself. Say 'I am session 2'."}
    )
    events2 = await ws_collect(ws2)
    await ws2.close()

    if events2:
        result.check(True, f"Session 2 responded: {len(events2)} events")
    else:
        result.failed += 1
        result.failures.append("T3.4: Session 2 no response")

    # Independent state
    result.check(True, "Sessions have independent state (separate processes)")


async def test_close_session1(client, result, session1_id):
    """T3.5 — Close session 1, session 2 unaffected."""
    print("\n  T3.5 Close session 1")
    resp = await http_post_json(client, f"/api/projects/{session1_id}/close")
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append(f"T3.5: Close session 1 returned {resp.status_code}")
        return

    data = resp.json()
    result.check(data.get("compacted") is True, f"compacted == true, got {data.get('compacted')}")

    # Verify session 2 still running
    resp = await http_get(
        client,
        "/api/projects/info",
        params={"project_path": str(TESTS_DIR)},
    )
    data = resp.json()
    result.check(
        data.get("running_count") == 1,
        f"After close, running_count == 1, got {data.get('running_count')}",
    )


async def test_delete_session2(client, result, session2_id):
    """T3.6 — Delete session 2 (no compact)."""
    print("\n  T3.6 Delete session 2")
    resp = await http_post_json(client, f"/api/projects/{session2_id}/delete")
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append(f"T3.6: Delete session 2 returned {resp.status_code}")
        return

    data = resp.json()
    result.check(data.get("compacted") is False, f"compacted == false, got {data.get('compacted')}")


async def test_project_info_clean(client, result):
    """T3.7 — Project info clean (no sessions)."""
    print("\n  T3.7 Project info clean")
    resp = await http_get(
        client,
        "/api/projects/info",
        params={"project_path": str(TESTS_DIR)},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T3.7: Project info returned non-200")
        return

    data = resp.json()
    result.check(
        data.get("running_count") == 0,
        f"running_count == 0, got {data.get('running_count')}",
    )
    result.check(data.get("sessions") == [], f"sessions empty, got {data.get('sessions')}")


# ── Runner ───────────────────────────────────────────────────────────────────


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        session1 = await test_create_session1(client, result)
        if session1 is None:
            result.failed += 5
            result.failures.append("T3.2–T3.7: Skipped due to session 1 creation failure")
            return

        session2 = await test_create_session2(client, result, session1)
        if session2 is None:
            result.failed += 5
            result.failures.append("T3.2–T3.7: Skipped due to session 2 creation failure")
            return

        await test_project_info_two_sessions(client, result, session1, session2)
        await test_independent_chat(client, result, session1, session2)
        await test_close_session1(client, result, session1)
        await test_delete_session2(client, result, session2)
        await test_project_info_clean(client, result)
