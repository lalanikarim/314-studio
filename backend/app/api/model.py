"""
Model API endpoints for managing available models.

Models are cached at server startup via ``pi --list-models``.
This endpoint returns the cached list without requiring an active session.

For backward compatibility, when a `session_id` is provided and no cache is
available, it falls back to querying the session's Pi RPC process.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..schemas import ModelConfig
from ..session_manager import session_manager

router = APIRouter()


def _parse_rpc_models(raw: Optional[dict]) -> List[ModelConfig]:
    """Parse model objects from a Pi RPC get_available_models response dict."""
    if not raw:
        return []

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
    return models


# ---------------------------------------------------------------------------
# GET / — list models
# ---------------------------------------------------------------------------


@router.get("/", response_model=List[ModelConfig])
async def list_models(
    session_id: Optional[str] = Query(
        None, description="Session to query (optional – uses cache if available)"
    ),
) -> List[ModelConfig]:
    """
    List all available models.

    Primary source is the server-side cache populated at startup via
    ``pi --list-models``.  A `session_id` is accepted for backward
    compatibility — if no cache is available the RPC path is used.

    Returns an empty list when neither cache nor session is available.
    """
    # 1. Return cached models (no session needed)
    if session_manager._cached_models:
        return [ModelConfig(**m) for m in session_manager._cached_models]

    # 2. Cache not ready yet — fall back to RPC if session_id provided
    if session_id:
        record = session_manager.get_session(session_id)
        if record and record.status == "running" and record.stdin:
            try:
                result = await session_manager._send_command_internal(
                    record, {"type": "get_available_models"}, timeout=30.0
                )
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Pi RPC failed: {exc}")

            return _parse_rpc_models(result.get("result", result.get("data", result)))

    # 3. Nothing available
    return []


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
