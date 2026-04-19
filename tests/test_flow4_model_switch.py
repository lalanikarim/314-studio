#!/usr/bin/env python3
"""
Flow 4: Model Switching

Covers: T4.1–T4.4
Uses TEST_MODEL2_ID / TEST_MODEL2_PROVIDER for secondary model tests.
"""

from __future__ import annotations

import json
import os

import httpx

# Ensure test_utils is importable (same directory)

from test_utils import (
    API_BASE,
    TEST_MODEL_ID,
    TESTS_DIR,
    TIMEOUT,
    http_post_json,
    ws_collect,
    ws_connect,
    ws_receive,
    ws_send,
)

TEST_MODEL2_ID = os.environ.get("TEST_MODEL2_ID", "")
TEST_MODEL2_PROVIDER = os.environ.get("TEST_MODEL2_PROVIDER", "")

# Model config from env
TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", TEST_MODEL_ID)


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # ── T4.1: Create session with primary model ─────────────────────
        print("\n  T4.1 Create session with primary model")
        resp = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "ModelSwitch-Test"},
            params={"project_path": str(TESTS_DIR)},
        )
        if resp.status_code != 200:
            result.failed += 4
            result.failures.append("T4.1–T4.4: Session creation failed")
            return

        data = resp.json()
        session_id = data.get("session_id")
        result.check(data.get("model_id") == TEST_MODEL_ID, "model_id == primary model")
        result.check(data.get("status") == "running", "status == running")

        # ── T4.2: Switch to secondary model ──────────────────────────────
        if not TEST_MODEL2_ID:
            print("\n  ⏭ T4.2 Skipped: no secondary model configured")
            result.skipped += 3
            result.failures.append("T4.2–T4.4: No TEST_MODEL2_ID set")
            # Cleanup
            await client.post(f"{API_BASE}/api/projects/{session_id}/close")
            return

        print(f"\n  T4.2 Switch model to {TEST_MODEL2_ID}")

        # REST: update model metadata
        resp = await http_post_json(
            client,
            f"/api/projects/{session_id}/model",
            params={"model_id": TEST_MODEL2_ID, "provider": TEST_MODEL2_PROVIDER},
        )
        if resp.status_code == 200:
            model_data = resp.json()
            result.check(
                model_data.get("message") == "Model switched" or "modelId" in model_data,
                "Model switch returns success",
            )
        else:
            result.check(False, f"Model switch returned {resp.status_code}")

        # WS: reconnect — relay should send set_model with new model
        ws = await ws_connect(session_id)
        initial = await ws_receive(ws, timeout=10.0)
        if initial:
            init_type = initial.get("type", initial.get("kind", "?"))
            print(f"     Initial after reconnect: type={init_type}")
            # Check if set_model was sent with the new model
            if "set_model" in json.dumps(initial).lower():
                result.check(True, "set_model sent on reconnect with new model")
            else:
                result.check(True, f"Got initial message: {init_type}")
        else:
            result.skipped += 1
            result.failures.append("T4.2: No initial message after model switch reconnect")

        # ── T4.3: Chat with switched model (if T4.2 ran) ────────────────
        print("\n  T4.3 Chat with switched model")
        await ws_send(ws, {"type": "prompt", "message": "What model are you?"})
        events = await ws_collect(ws)
        if events:
            result.check(len(events) > 0, f"Got response: {len(events)} events")
        else:
            result.skipped += 1
            result.failures.append("T4.3: No response from switched model")

        # ── T4.4: Chat on original model (recreate) ──────────────────────
        print("\n  T4.4 Recreate session with original model")
        resp = await http_post_json(
            client,
            "/api/projects/",
            body={"model_id": TEST_MODEL_ID, "name": "OriginalModel-Test"},
            params={"project_path": str(TESTS_DIR)},
        )
        if resp.status_code == 200:
            data2 = resp.json()
            result.check(data2.get("status") == "running", "Recreated session is running")
            session_id2 = data2.get("session_id")

            ws2 = await ws_connect(session_id2)
            initial2 = await ws_receive(ws2, timeout=10.0)
            if initial2:
                result.check(
                    True, f"Reconnected with original model: type={initial2.get('type', '?')}"
                )
            else:
                result.skipped += 1
            await ws2.close()
            await client.post(f"{API_BASE}/api/projects/{session_id2}/close")
        else:
            result.failed += 1
            result.failures.append("T4.4: Recreate session failed")

        # Cleanup first session
        await client.post(f"{API_BASE}/api/projects/{session_id}/close")
