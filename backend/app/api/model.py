"""
Model API endpoints for managing available models.

Queries the session's Pi RPC process for model information when a session
is active. Model switching is handled via session_manager.py.
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
    session_id: str = Query(..., description="Session to query for models"),
) -> List[ModelConfig]:
    """
    List all available models via the session's Pi RPC process.

    Sends `get_available_models` through SessionManager and waits
    for the response synchronously.
    """
    record = session_manager.get_session(session_id)
    if not record or record.status != "running" or not record.stdin:
        raise HTTPException(
            status_code=404, detail=f"Session {session_id} not found or not running"
        )

    try:
        result = await session_manager._send_command_internal(
            record, {"type": "get_available_models"}, timeout=30.0
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Pi RPC failed: {exc}")

    return _parse_rpc_models(result.get("result", result.get("data", result)))


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
