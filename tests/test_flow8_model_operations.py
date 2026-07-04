#!/usr/bin/env python3
"""
Flow 8: Model Operations — Fetch, Switch, Chat via SSE

Covers: T8.1–T8.5
Tests:
  - T8.1: Fetch available models via GET /api/models?session_id=...
  - T8.2: Verify expected models (vllm + aurora) are present
  - T8.3: Switch model via POST /api/projects/{id}/model?model_id=...&provider=...
  - T8.4: Chat on original session and verify response (via SSE)
  - T8.5: Chat after model switch and verify response (via SSE)

Environment variables:
    TEST_MODEL_ID          — primary model (default: Qwen/Qwen3.6-35B-A3B)
    TEST_MODEL_PROVIDER    — primary model provider (default: vllm)
    TEST_MODEL2_ID         — secondary model (default: Qwen/Qwen3.5:27b)
    TEST_MODEL2_PROVIDER   — secondary model provider (default: aurora)
"""

from __future__ import annotations

import json
import os

import httpx

from test_utils import (
    API_BASE,
    TESTS_DIR,
    TIMEOUT,
    SSE_TIMEOUT,
    http_get,
    http_post_json,
    sse_collect,
    sse_connect,
    send_prompt,
    send_set_model,
)

# Model config — override from env, fall back to sensible defaults
TEST_MODEL_ID = os.environ.get("TEST_MODEL_ID", "Qwen/Qwen3.6-35B-A3B")
TEST_MODEL_PROVIDER = os.environ.get("TEST_MODEL_PROVIDER", "vllm")
TEST_MODEL2_ID = os.environ.get("TEST_MODEL2_ID", "Qwen/Qwen3.5:27b")
TEST_MODEL2_PROVIDER = os.environ.get("TEST_MODEL2_PROVIDER", "aurora")


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_create_session_for_model_ops(client, result):
    """T8.0 — Create a session for model operations (no model_id)."""
    print("\n  T8.0 Create session for model ops")
    resp = await http_post_json(
        client,
        "/api/projects/",
        body={"name": "ModelOps-Test"},
        params={"project_path": str(TESTS_DIR)},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append(f"T8.0: Create session returned {resp.status_code}")
        return None

    data = resp.json()
    session_id = data.get("session_id")
    print(f"     Session: {session_id}")

    result.check(data.get("status") == "running", "status == 'running'")
    result.check(
        data.get("model_id") is None, "model_id is unset (session creation is model-agnostic)"
    )
    result.check(session_id is not None, "session_id is present")

    return session_id


async def test_fetch_models(client, result, session_id: str):
    """T8.1 — Fetch available models via GET /api/models?session_id=...

    This sends `get_available_models` RPC to the pi process and waits for the response.
    Prints the full request/response.
    """
    print("\n  T8.1 Fetch available models")
    print(f"     → GET  /api/models/?session_id={session_id[:12]}...")

    resp = await http_get(
        client,
        "/api/models/",
        params={"session_id": session_id},
    )

    print(f"     ← {resp.status_code}")
    print("     ← Response body:")
    models = resp.json()
    print(f"        {json.dumps(models, indent=2)[:1000]}")

    if resp.status_code != 200:
        result.failed += 1
        result.failures.append(f"T8.1: List models returned {resp.status_code}")
        return None

    result.check(isinstance(models, list), f"Response is a list, got {type(models).__name__}")
    result.check(len(models) > 0, f"At least 1 model, got {len(models)}")

    return models


async def test_verify_model_presence(client, result, session_id: str):
    """T8.2 — Verify expected models (vllm + aurora) are present.

    Fetches models directly (idempotent) and verifies both providers/models.
    """
    print("\n  T8.2 Verify expected models present")
    print(f"     Expected providers: {TEST_MODEL_PROVIDER}, {TEST_MODEL2_PROVIDER}")
    print(f"     Expected model IDs: {TEST_MODEL_ID}, {TEST_MODEL2_ID}")

    # Fetch models (same API call as T8.1, just verifying content)
    resp = await http_get(client, "/api/models/", params={"session_id": session_id})
    models = resp.json()

    # Print all models found
    print(f"     Models returned ({len(models)}):")
    for m in models:
        mid = m.get("id", "?")
        provider = m.get("provider", "?")
        print(f"        - {mid} (provider={provider})")

    # Check providers present
    providers_found = {m.get("provider") for m in models if m.get("provider")}
    print(f"     Providers found: {providers_found}")

    result.check(
        TEST_MODEL_PROVIDER in providers_found,
        f"Provider '{TEST_MODEL_PROVIDER}' present in models",
    )
    result.check(
        TEST_MODEL2_PROVIDER in providers_found,
        f"Provider '{TEST_MODEL2_PROVIDER}' present in models",
    )

    # Check model IDs present (at least partially matching)
    model_ids = [m.get("id", "").lower() for m in models]
    print(f"     Model IDs found: {model_ids}")

    # Check if expected model IDs are present (case-insensitive partial match)
    expected_ids = [TEST_MODEL_ID.lower(), TEST_MODEL2_ID.lower()]
    for exp_id in expected_ids:
        found = any(exp_id in mid for mid in model_ids)
        result.check(
            found,
            f"Model '{exp_id}' found (partial match in: {model_ids})",
        )


async def test_switch_model(client, result, session_id: str):
    """T8.3 — Switch model via POST /api/projects/{id}/model?model_id=...&provider=...

    Prints request params and response.
    """
    print("\n  T8.3 Switch model")
    print(f"     → POST /api/projects/{session_id[:12]}/model")
    print(f"     → Params: model_id={TEST_MODEL2_ID}, provider={TEST_MODEL2_PROVIDER}")

    resp = await http_post_json(
        client,
        f"/api/projects/{session_id}/model",
        params={"model_id": TEST_MODEL2_ID, "provider": TEST_MODEL2_PROVIDER},
    )

    print(f"     ← {resp.status_code}")
    print(f"     ← Response body: {json.dumps(resp.json(), indent=2)[:500]}")

    if resp.status_code != 200:
        result.failed += 1
        result.failures.append(f"T8.3: Model switch REST returned {resp.status_code}")
        return None

    data = resp.json()
    result.check(
        isinstance(data, dict),
        "Model switch returns JSON response",
    )
    result.check(
        data.get("message") == "Model switched",
        "Response indicates model switched",
    )

    # Update stored model for subsequent tests
    result.model_switched_to = TEST_MODEL2_ID  # type: ignore[attr-defined]
    result.model_switched_provider = TEST_MODEL2_PROVIDER  # type: ignore[attr-defined]


async def test_chat_original_model(client, result, session_id: str):
    """T8.4 — Chat on session (before model switch) and verify response.

    Connects SSE, verifies initial set_model event, sends prompt via REST, collects response.
    """
    print("\n  T8.4 Chat on original model")

    # Connect SSE — sends set_model event on connect
    print(f"     → SSE  /api/projects/sse?session_id={session_id[:12]}...")
    sse_client, response = await sse_connect(session_id)

    # Collect initial set_model event
    print("     Collecting initial set_model event...")
    events = await sse_collect(response, sse_client, max_events=3, total_timeout=SSE_TIMEOUT)
    if events:
        init_type = events[0].get("type", "?")
        model_data = events[0].get("data", {})
        model_id = model_data.get("modelId", "") if isinstance(model_data, dict) else ""
        print(f"     ← Initial: type={init_type}, modelId={model_id}")
        result.check(init_type == "set_model", f"Got set_model event, got '{init_type}'")
    else:
        print("     (No initial message)")
        result.skipped += 1

    # Send prompt via REST
    prompt_msg = "Hello! Identify your model. What model are you running?"
    print(f"     → CMD  prompt: {prompt_msg[:60]}")
    resp = await send_prompt(session_id, prompt_msg)
    result.check(resp.get("status") == "ok", f"Prompt command returned ok")

    # Collect response from SSE
    print("     Collecting response...")
    events = await sse_collect(response, sse_client, max_events=30, total_timeout=30.0)
    if events:
        print(f"     ← {len(events)} events collected:")
        for i, evt in enumerate(events[:5]):
            evt_type = evt.get("type", "?")
            print(f"        [{i}] type={evt_type}")

        # Check for streaming events
        types = [e.get("type", "?") for e in events]
        has_streaming = any(t == "rpc_event" for t in types)
        result.check(
            has_streaming,
            f"Got rpc_event (streaming), types: {types[:5]}",
        )
        result.check(
            len(events) > 0,
            f"Received {len(events)} events from prompt",
        )
    else:
        result.failed += 1
        result.failures.append("T8.4: No events from prompt")

    await sse_client.aclose()


async def test_chat_after_model_switch(client, result, session_id: str):
    """T8.5 — Chat after model switch and verify response (via SSE).

    Connects SSE (auto-sends set_model for new model), sends prompt via REST,
    verifies response.
    """
    print("\n  T8.5 Chat after model switch")

    # Switch model first (if not already done by T8.3)
    switched_model = getattr(result, "model_switched_to", None)
    switched_provider = getattr(result, "model_switched_provider", None)

    if not switched_model or not switched_provider:
        switched_model = TEST_MODEL2_ID
        switched_provider = TEST_MODEL2_PROVIDER
        print(f"     Switching to: {switched_model} (provider={switched_provider})")
        resp = await http_post_json(
            client,
            f"/api/projects/{session_id}/model",
            params={"model_id": switched_model, "provider": switched_provider},
        )
        if resp.status_code != 200:
            result.failed += 1
            result.failures.append(f"T8.5: Model switch REST returned {resp.status_code}")
            return
        print(f"     ← Switched: {json.dumps(resp.json(), indent=2)[:300]}")
    else:
        print(f"     Model already switched to: {switched_model} (provider={switched_provider})")

    # Connect SSE — set_model event fires with new model
    print(f"     → SSE  /api/projects/sse?session_id={session_id[:12]}...")
    sse_client, response = await sse_connect(session_id)

    # Collect initial set_model event
    print("     Collecting initial set_model event...")
    events = await sse_collect(response, sse_client, max_events=3, total_timeout=SSE_TIMEOUT)
    if events:
        init_type = events[0].get("type", "?")
        model_data = events[0].get("data", {})
        model_id = model_data.get("modelId", "") if isinstance(model_data, dict) else ""
        print(f"     ← Initial: type={init_type}, modelId={model_id}")
        result.check(init_type == "set_model", f"Got set_model event: {init_type}")
        result.check(
            model_id == switched_model,
            f"set_model has correct model: {model_id} == {switched_model}",
        )
    else:
        print("     (No initial message)")
        result.skipped += 1

    # Send prompt via REST
    prompt_msg = f"Hello! I switched to {switched_model}. Identify yourself and confirm your model."
    print(f"     → CMD  prompt: {prompt_msg[:60]}")
    resp = await send_prompt(session_id, prompt_msg)
    result.check(resp.get("status") == "ok", f"Prompt command returned ok")

    # Collect response from SSE
    print("     Collecting response...")
    events = await sse_collect(response, sse_client, max_events=30, total_timeout=30.0)
    if events:
        print(f"     ← {len(events)} events collected:")
        for i, evt in enumerate(events[:5]):
            evt_type = evt.get("type", "?")
            print(f"        [{i}] type={evt_type}")

        types = [e.get("type", "?") for e in events]
        has_streaming = any(t == "rpc_event" for t in types)
        result.check(
            has_streaming,
            f"Got rpc_event after model switch, types: {types[:5]}",
        )
        result.check(
            len(events) > 0,
            f"Received {len(events)} events from prompt after model switch",
        )
    else:
        result.failed += 1
        result.failures.append("T8.5: No events from prompt after model switch")

    await sse_client.aclose()


# ── Runner ───────────────────────────────────────────────────────────────────


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # T8.0: Create session
        session_id = await test_create_session_for_model_ops(client, result)
        if session_id is None:
            result.failed += 4
            result.failures.append("T8.1–T8.5: Skipped due to session creation failure")
            return

        # T8.1: Fetch models
        models = await test_fetch_models(client, result, session_id)
        if models is None:
            result.failed += 3
            result.failures.append("T8.2–T8.5: Skipped due to model fetch failure")
            return

        # T8.2: Verify model presence (re-fetches models idempotently)
        await test_verify_model_presence(client, result, session_id)

        # T8.3: Switch model
        await test_switch_model(client, result, session_id)

        # T8.4: Chat on original model
        await test_chat_original_model(client, result, session_id)

        # T8.5: Chat after model switch
        await test_chat_after_model_switch(client, result, session_id)

        # Cleanup: close session
        try:
            await client.post(f"{API_BASE}/api/projects/{session_id}/close")
        except Exception:
            pass
