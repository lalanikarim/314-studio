"""HTTP helpers for the harness — wraps httpx calls."""

from __future__ import annotations

import httpx

from .colors import err, info
from .config import API_BASE, HTTP_TIMEOUT


async def http_get(client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict:
    """GET request with query params."""
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    info(f"GET {path}{'?...' if params else ''}")
    resp = await client.get(url, params=params, timeout=HTTP_TIMEOUT)
    if resp.status_code != 200:
        err(f"GET {path} → {resp.status_code}: {resp.text[:300]}")
        raise RuntimeError(f"GET failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()


async def http_post(
    client: httpx.AsyncClient,
    path: str,
    body: dict | None = None,
    params: dict | None = None,
) -> dict:
    """POST request with JSON body and optional query params."""
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    info(f"POST {path}{'?...' if params else ''}" + (f" body={body}" if body else ""))
    resp = await client.post(url, json=body, params=params, timeout=HTTP_TIMEOUT)
    if resp.status_code not in (200, 201):
        err(f"POST {path} → {resp.status_code}: {resp.text[:300]}")
        raise RuntimeError(f"POST failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()
