#!/usr/bin/env python3
"""
Flow 9: Cached Model List — `pi --list-models` at startup

Covers: T9.1–T9.3
Tests:
  - T9.1: GET /api/models/ without session_id returns models
  - T9.2: Parsed providers are valid (anthropic, ollama, etc.)
  - T9.3: contextWindow is correctly parsed as int
"""

from __future__ import annotations

import httpx

from test_utils import TIMEOUT, http_get

# ── Tests ───────── ────── —— ──── ─ ── ─ ────── ──── ────── ─ ─ ─ ─── ─ ─ ─ ─


async def test_list_models_no_session(client, result):
    """T9.1 — GET /api/models/ without session_id returns cached models."""
    print("\n  T9.1 List models without session_id")
    print("     → GET  /api/models/")

    resp = await http_get(client, "/api/models/")

    print(f"     ← {resp.status_code}")
    models = resp.json()
    print(f"     ← {len(models)} models")

    result.check(resp.status_code == 200, "Status is 200")
    result.check(isinstance(models, list), "Response is a list")
    result.check(len(models) > 0, f"At least 1 model, got {len(models)}")

    return models


async def test_models_have_valid_providers(client, result, models):
    """T9.2 — Parsed providers match known providers."""
    print("\n  T9.2 Verify providers")

    if models is None:
        result.failed += 1
        result.failures.append("T9.2: models is None from T9.1")
        return

    providers = {m["provider"] for m in models}
    print(f"     Providers: {sorted(providers)}")

    # We expect at least anthropic and ollama from this test machine
    result.check(
        "anthropic" in providers or "ollama" in providers,
        f"At least one known provider, got {sorted(providers)}",
    )

    # Check total count
    result.check(len(providers) >= 2, f"At least 2 providers, got {len(providers)}")


async def test_models_have_valid_context(client, result, models):
    """T9.3 — contextWindow is correctly parsed as int >= 0."""
    print("\n  T9.3 Verify contextWindow")

    if models is None:
        result.failed += 1
        result.failures.append("T9.3: models is None from T9.1")
        return

    for m in models[:5]:  # Check first 5
        cw = m.get("contextWindow")
        mid = m.get("id", "?")
        provider = m.get("provider", "?")
        print(f"     {mid} ({provider}): contextWindow={cw!r} (type={type(cw).__name__})")
        result.check(isinstance(cw, int), f"contextWindow is int for {mid}")
        result.check(
            cw >= 0,
            f"contextWindow >= 0 for {mid}, got {cw}",
        )


# ── Runner ───────── ────── ────── ─── ── ─ ───── ───── ─ ─ ─ ─── ─ ─ ─ ─


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        # T9.1: Fetch models without session
        models = await test_list_models_no_session(client, result)
        if models is None or (isinstance(models, list) and len(models) == 0):
            result.failed += 2
            result.failures.append("T9.2–T9.3: Skipped due to empty model list")
            return

        # T9.2: Verify providers
        await test_models_have_valid_providers(client, result, models)

        # T9.3: Verify context parsing
        await test_models_have_valid_context(client, result, models)
