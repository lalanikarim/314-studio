#!/usr/bin/env python3
"""
Flow 5: Session Lifecycle — Close vs Delete

Covers: T5.1–T5.4
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
)

TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # ── T5.1: Create session ─────────────────────────────────────────
        print("\n  T5.1 Create session")
        resp = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "CloseTest"},
            params={"project_path": str(TESTS_DIR)},
        )
        if resp.status_code != 200:
            result.failed += 4
            result.failures.append("T5.1–T5.4: Session creation failed")
            return

        data = resp.json()
        close_session_id = data.get("session_id")
        result.check(data.get("status") == "running", "status == running")
        result.check(data.get("pid") is not None, "PID is set")

        # ── T5.2: Close session (compact path) ───────────────────────────
        print("\n  T5.2 Close session (compact)")
        resp = await http_post_json(client, f"/api/projects/{close_session_id}/close")
        if resp.status_code != 200:
            result.failed += 1
            result.failures.append(f"T5.2: Close returned {resp.status_code}")
        else:
            close_data = resp.json()
            result.check(close_data.get("compacted") is True, "compacted == true")

        # ── T5.3: Create session for delete test ─────────────────────────
        print("\n  T5.3 Create session for delete")
        resp = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "DeleteTest"},
            params={"project_path": str(TESTS_DIR)},
        )
        if resp.status_code != 200:
            result.failed += 2
            result.failures.append("T5.3: Create session for delete failed")
            return

        data = resp.json()
        delete_session_id = data.get("session_id")
        result.check(data.get("status") == "running", "status == running")

        # ── T5.4: Delete session (no compact) ────────────────────────────
        print("\n  T5.4 Delete session (no compact)")
        resp = await http_post_json(client, f"/api/projects/{delete_session_id}/delete")
        if resp.status_code != 200:
            result.failed += 1
            result.failures.append(f"T5.4: Delete returned {resp.status_code}")
        else:
            del_data = resp.json()
            result.check(del_data.get("compacted") is False, "compacted == false")

        # ── Verify clean state ───────────────────────────────────────────
        print("\n  Verify: no sessions remaining")
        resp = await http_get(
            client,
            "/api/projects/info",
            params={"project_path": str(TESTS_DIR)},
        )
        if resp.status_code == 200:
            info = resp.json()
            result.check(
                info.get("running_count") == 0,
                f"running_count == 0, got {info.get('running_count')}",
            )
            result.check(info.get("sessions") == [], "sessions empty")
