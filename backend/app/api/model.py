"""
Model API endpoints for managing available models.

Uses Pi RPC commands (get_available_models, set_model) when a session
is active; falls back to a small hardcoded default list otherwise.
"""

import json
from typing import List, Optional

from fastapi import APIRouter, Query

from ..schemas import ModelConfig
from ..session_manager import session_manager

router = APIRouter()

# Default model list (used when no RPC is active)
_DEFAULT_MODELS: List[ModelConfig] = [
    ModelConfig(
        id="claude-sonnet-4-20250514",
        provider="anthropic",
        contextWindow=200000,
        maxTokens=16384,
    ),
    ModelConfig(
        id="gpt-4.1",
        provider="openai",
        contextWindow=131072,
        maxTokens=16384,
    ),
    ModelConfig(
        id="deepseek-coder",
        provider="deepseek",
        contextWindow=65536,
        maxTokens=16384,
    ),
]


def _parse_rpc_models(raw: Optional[dict]) -> List[ModelConfig]:
    """Parse model objects from a Pi RPC get_available_models response."""
    if not raw:
        return _DEFAULT_MODELS

    models: List[ModelConfig] = []
    items = raw if isinstance(raw, list) else raw.get("models", raw.get("data", []))
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                models.append(
                    ModelConfig(
                        id=item.get("modelId", item.get("id", "unknown")),
                        provider=item.get("provider", "unknown"),
                        contextWindow=item.get("contextWindow"),
                        maxTokens=item.get("maxTokens"),
                    )
                )
    return models if models else _DEFAULT_MODELS


# ---------------------------------------------------------------------------
# GET / — list models
# ---------------------------------------------------------------------------


@router.get("/", response_model=List[ModelConfig])
async def list_models(
    session_id: Optional[str] = Query(None, description="Session to query for models"),
) -> List[ModelConfig]:
    """
    List all available models.
    Queries Pi RPC if a session is active; falls back to defaults.
    """
    if session_id:
        record = session_manager.get_session(session_id)
        if record and record.status == "running" and record.stdin:
            try:
                req_id = json.dumps({"type": "get_available_models"})
                record.stdin.write((req_id + "\n").encode("utf-8"))
                await record.stdin.drain()
                # Response will come back via the stdout reader → event_buffer.
                # For REST endpoint return defaults; frontend picks up update via WS.
                return _DEFAULT_MODELS
            except Exception:
                pass

    return _DEFAULT_MODELS


# ---------------------------------------------------------------------------
# POST /{session_id}/model — switch model
# ---------------------------------------------------------------------------


@router.post("/{session_id}/model")
async def switch_model(
    session_id: str,
    model_id: str = Query(...),
    provider: str = "anthropic",
) -> dict:
    """
    Switch the model for a session.
    Routes through the session API endpoint which handles it properly.
    """
    try:
        await session_manager.switch_model(session_id, model_id, provider)
        return {"message": "Model switched", "modelId": model_id, "provider": provider}
    except Exception as exc:
        return {"error": f"Failed to switch model: {exc}"}
