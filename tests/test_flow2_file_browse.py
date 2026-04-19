#!/usr/bin/env python3
"""
Flow 2: File Browse → File Preview

Covers: T2.1–T2.7
"""

from __future__ import annotations


import httpx


from test_utils import (
    TESTS_DIR,
    TIMEOUT,
    http_get,
)

NESTED_SRC = TESTS_DIR / "nested" / "src"


# ── Tests ────────────────────────────────────────────────────────────────────


async def test_list_root(client, result):
    """T2.1 — List root files."""
    print("\n  T2.1 List root files")
    resp = await http_get(
        client,
        "/api/projects/files",
        params={"project_path": str(TESTS_DIR)},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T2.1: List root files returned non-200")
        return

    data = resp.json()
    names = {f["name"] if isinstance(f, dict) else "?" for f in data}
    result.check(isinstance(data, list), "Returns a list")
    result.check("flat" in names, "Root contains 'flat' dir")
    result.check("nested" in names, "Root contains 'nested' dir")
    result.check("README.md" in names, "Root contains 'README.md'")

    dirs = [f for f in data if f.get("isDirectory")]
    files = [f for f in data if not f.get("isDirectory")]
    result.check(len(dirs) >= 2, f"Found {len(dirs)} directories")
    result.check(len(files) >= 1, f"Found {len(files)} files")


async def test_list_flat_dir(client, result):
    """T2.2 — List flat directory."""
    print("\n  T2.2 List flat directory")
    resp = await http_get(
        client,
        "/api/projects/files",
        params={"project_path": str(TESTS_DIR), "path": "flat"},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T2.2: List flat returned non-200")
        return

    data = resp.json()
    names = {f["name"] for f in data}
    result.check("main.py" in names, "flat contains 'main.py'")
    result.check("utils.py" in names, "flat contains 'utils.py'")
    result.check(len(data) == 2, f"flat has 2 items, got {len(data)}")
    result.check(all(not f.get("isDirectory") for f in data), "All items are files")


async def test_list_nested_src(client, result):
    """T2.3 — List nested/src directory."""
    print("\n  T2.3 List nested/src directory")
    resp = await http_get(
        client,
        "/api/projects/files",
        params={"project_path": str(TESTS_DIR), "path": "nested/src"},
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T2.3: List nested/src returned non-200")
        return

    data = resp.json()
    names = {f["name"] for f in data}
    result.check("app.py" in names, "nested/src contains 'app.py'")
    result.check("config.py" in names, "nested/src contains 'config.py'")
    result.check(len(data) == 2, f"nested/src has 2 items, got {len(data)}")


async def test_read_main_py(client, result):
    """T2.4 — Read file: main.py."""
    print("\n  T2.4 Read flat/main.py")
    resp = await http_get(
        client,
        "/api/projects/files/read",
        params={
            "project_path": str(TESTS_DIR),
            "file_path": "flat/main.py",
        },
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T2.4: Read main.py returned non-200")
        return

    content = resp.text
    result.check(isinstance(content, str), "Response is a string")
    result.check(len(content) > 0, "Content is non-empty")
    result.check("def main" in content, "Content contains 'def main'")


async def test_read_app_py(client, result):
    """T2.5 — Read file: app.py."""
    print("\n  T2.5 Read nested/src/app.py")
    resp = await http_get(
        client,
        "/api/projects/files/read",
        params={
            "project_path": str(TESTS_DIR),
            "file_path": "nested/src/app.py",
        },
    )
    if resp.status_code != 200:
        result.failed += 1
        result.failures.append("T2.5: Read app.py returned non-200")
        return

    content = resp.text
    result.check(isinstance(content, str), "Response is a string")
    result.check(len(content) > 0, "Content is non-empty")
    result.check("def create_app" in content, "Content contains 'def create_app'")


async def test_read_nonexistent(client, result):
    """T2.6 — Read non-existent file returns 404."""
    print("\n  T2.6 Read non-existent file")
    resp = await http_get(
        client,
        "/api/projects/files/read",
        params={
            "project_path": str(TESTS_DIR),
            "file_path": "nonexistent.py",
        },
    )
    result.check(resp.status_code == 404, f"Returns 404, got {resp.status_code}")


async def test_path_traversal(client, result):
    """T2.7 — Path traversal prevention returns 403."""
    print("\n  T2.7 Path traversal prevention")

    # Try to browse outside project
    resp = await http_get(
        client,
        "/api/projects/files",
        params={
            "project_path": str(TESTS_DIR),
            "path": "../../../etc",
        },
    )
    result.check(resp.status_code == 403, f"Browsing ../.. returns 403, got {resp.status_code}")

    # Try to read file outside project
    resp2 = await http_get(
        client,
        "/api/projects/files/read",
        params={
            "project_path": str(TESTS_DIR),
            "file_path": "../../etc/passwd",
        },
    )
    result.check(resp2.status_code == 403, f"Reading ../.. returns 403, got {resp2.status_code}")


# ── Runner ───────────────────────────────────────────────────────────────────


async def run(result):
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        await test_list_root(client, result)
        await test_list_flat_dir(client, result)
        await test_list_nested_src(client, result)
        await test_read_main_py(client, result)
        await test_read_app_py(client, result)
        await test_read_nonexistent(client, result)
        await test_path_traversal(client, result)


