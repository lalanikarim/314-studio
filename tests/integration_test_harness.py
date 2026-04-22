#!/usr/bin/env python3
"""
Integration Test Harness — runs per-flow test scripts against a live backend.

Usage:
    cd tests && uv run python integration_test_harness.py                # all flows
    cd tests && uv run python integration_test_harness.py --flows chat   # T1.x only
    cd tests && uv run python integration_test_harness.py --flows file-browse  # T2.x only

The backend must already be running on :8765 before invoking the harness.

Environment variables:
    TEST_MODEL_ID / TEST_MODEL_PROVIDER    — primary model (required)
    TEST_MODEL2_ID / TEST_MODEL2_PROVIDER  — secondary model (optional, model-switch tests)
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import sys
from pathlib import Path
from typing import Sequence

import httpx

# ── Paths & Config ───────────────────────────────────────────────────────────

from test_utils import API_BASE  # noqa: E402

TESTS_DIR = Path(__file__).parent.resolve()
TESTS_FIXTURE_DIR = Path.home() / "Projects" / "web-pi-integration-tests"

# ── Flow registry ────────────────────────────────────────────────────────────

_FLOW_MODULES: list[str] = [
    "test_flow1_browse_chat",
    "test_flow2_file_browse",
    "test_flow3_multi_session",
    "test_flow4_model_switch",
    "test_flow5_close_delete",
    "test_flow6_error_handling",
    "test_flow7_shutdown_cleanup",
]


def _import_flow(name: str):
    """Dynamically import a flow module from this directory."""
    sys.path.insert(0, str(TESTS_DIR))
    return importlib.import_module(name)


# ── Result tracking ──────────────────────────────────────────────────────────


class FlowResult:
    """Result for a single flow."""

    def __init__(self, name: str):
        self.name = name
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.failures: list[str] = []

    @property
    def total(self) -> int:
        return self.passed + self.failed + self.skipped

    def check(self, condition: bool, msg: str) -> None:
        """Record a passed or failed assertion."""
        if condition:
            print(f"    ✅ {msg}")
            self.passed += 1
        else:
            print(f"    ❌ {msg}")
            self.failed += 1
            self.failures.append(msg)

    def __str__(self) -> str:
        parts = [f"{self.name}: {self.passed} passed"]
        if self.failed:
            parts.append(f"{self.failed} failed")
        if self.skipped:
            parts.append(f"{self.skipped} skipped")
        return ", ".join(parts)


def print_summary(results: list[FlowResult]) -> None:
    """Print final summary table."""
    print(f"\n{'=' * 70}")
    print("  INTEGRATION TEST RESULTS")
    print(f"{'=' * 70}")

    for r in results:
        icon = "✅" if r.failed == 0 and r.skipped == 0 else ("⚠️" if r.skipped > 0 else "❌")
        print(f"  {icon} {r.name:<30} {r}")

    total_passed = sum(r.passed for r in results)
    total_failed = sum(r.failed for r in results)
    total_skipped = sum(r.skipped for r in results)
    print(f"\n  {'─' * 30}")
    print(f"  Total: {total_passed} passed, {total_failed} failed, {total_skipped} skipped")

    if total_failed > 0:
        print(f"\n  ❌ {total_failed} failure(s) across flows")
        for r in results:
            for f in r.failures:
                print(f"      {r.name}: {f}")
        sys.exit(1)
    else:
        print("\n  🎉 All tests passed!")
        sys.exit(0)


# ── Main ─────────────────────────────────────────────────────────────────────


async def check_server_ready() -> bool:
    """Verify the backend server is already running."""
    try:
        r = httpx.get(f"{API_BASE}/docs", timeout=5)
        if r.status_code == 200:
            print(f"  ✓ Backend server ready at {API_BASE}")
            return True
    except Exception as exc:
        print(f"  ⚠ Could not reach server at {API_BASE}: {exc}")
    return False


async def run_flow(module, result: FlowResult) -> FlowResult:
    """Run a single flow module and record results."""
    if not hasattr(module, "run"):
        print(f"  ⚠️  {module.__name__} has no 'run' function — skipping")
        result.skipped += 1
        return result

    try:
        print(f"\n{'─' * 70}")
        print(f"▶ {result.name}")
        print(f"{'─' * 70}")
        await module.run(result)
    except Exception as exc:
        print(f"\n  ❌ {result.name}: {type(exc).__name__}: {exc}")
        import traceback

        traceback.print_exc()
        result.failed += 1
        result.failures.append(f"{type(exc).__name__}: {exc}")

    return result


async def main(flows: Sequence[str] | None = None) -> None:
    """Entry point: check server, run flows, report results."""
    # Ensure fixture directory exists
    if not TESTS_FIXTURE_DIR.exists():
        print(f"  ⚠️  Test fixture dir not found: {TESTS_FIXTURE_DIR}")
        print("  Creating test directories...")
        TESTS_FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
        (TESTS_FIXTURE_DIR / "flat").mkdir(exist_ok=True)
        (TESTS_FIXTURE_DIR / "flat" / "main.py").write_text("def main(): print('hello')\n")
        (TESTS_FIXTURE_DIR / "flat" / "utils.py").write_text("def util(): pass\n")
        (TESTS_FIXTURE_DIR / "nested").mkdir(exist_ok=True)
        (TESTS_FIXTURE_DIR / "nested" / "README.md").write_text("# Nested\n")
        (TESTS_FIXTURE_DIR / "nested" / "src").mkdir(parents=True, exist_ok=True)
        (TESTS_FIXTURE_DIR / "nested" / "src" / "app.py").write_text("def app(): pass\n")
        (TESTS_FIXTURE_DIR / "nested" / "tests").mkdir(parents=True, exist_ok=True)
        (TESTS_FIXTURE_DIR / "nested" / "tests" / "test_app.py").write_text("def test(): pass\n")

    # Check server is running
    if not await check_server_ready():
        print(f"  FATAL: Backend server not running at {API_BASE}")
        print("  Start it first:  cd backend && uv run python app/main.py")
        sys.exit(1)

    # Determine which flows to run
    modules_to_run = _FLOW_MODULES if not flows else flows

    results: list[FlowResult] = []
    for flow_name in modules_to_run:
        mod_name = flow_name if flow_name.startswith("test_") else f"test_{flow_name}"
        result = FlowResult(flow_name)
        result = await run_flow(_import_flow(mod_name), result)
        results.append(result)

    print_summary(results)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Integration Test Harness")
    parser.add_argument(
        "--flows",
        nargs="+",
        default=None,
        help="Run only specified flows (e.g. 'chat' for T1.x, 'file-browse' for T2.x)",
    )
    args = parser.parse_args()

    # Map short flow names to full module names
    flow_map = {
        "browse": "test_flow1_browse_chat",
        "chat": "test_flow1_browse_chat",
        "full-flow": "test_flow1_browse_chat",
        "file-browse": "test_flow2_file_browse",
        "multi-session": "test_flow3_multi_session",
        "model-switch": "test_flow4_model_switch",
        "close-delete": "test_flow5_close_delete",
        "error-handling": "test_flow6_error_handling",
        "shutdown-cleanup": "test_flow7_shutdown_cleanup",
    }

    resolved_flows = None
    if args.flows:
        resolved_flows = []
        for f in args.flows:
            mod = flow_map.get(f, f"test_{f}")
            resolved_flows.append(mod)

    asyncio.run(main(flows=resolved_flows))
