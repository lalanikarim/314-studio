"""
Session API endpoints for managing individual sessions.

Sessions are managed by SessionManager which owns the lifecycle of
pi --rpc processes. These endpoints provide the REST surface for:
  - Closing a session (compact + abort + terminate)
  - Deleting a session (abort + terminate, no compact)
  - Switching model on a running session
"""

from fastapi import APIRouter, HTTPException, Query

from ..session_manager import session_manager

router = APIRouter()


# ---------------------------------------------------------------------------
# POST /sessions/{id}/close — compact + terminate
# ---------------------------------------------------------------------------


@router.post("/{session_id}/close")
async def close_session(session_id: str) -> dict:
    """
    Close a session: compact → abort → terminate process → remove record.

    Compact saves the conversation state before terminating the process.
    """
    try:
        return await session_manager.close_session(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to close session: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /sessions/{id}/delete — abort + terminate (no compact)
# ---------------------------------------------------------------------------


@router.post("/{session_id}/delete")
async def delete_session(session_id: str) -> dict:
    """
    Delete a session: abort → terminate process → remove record.

    Unlike close(), no compact is performed — the conversation state is lost.
    """
    try:
        return await session_manager.delete_session(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {exc}") from exc


# ---------------------------------------------------------------------------
# POST /sessions/{id}/model — switch model
# ---------------------------------------------------------------------------


@router.post("/{session_id}/model")
async def switch_model(
    session_id: str,
    model_id: str = Query(..., description="Model ID to switch to"),
    provider: str | None = Query(None, description="Provider (e.g. 'anthropic', 'openai')"),
) -> dict:
    """Update the session's model metadata.

    The actual set_model RPC command is sent over WebSocket when the client
    connects. This endpoint only records the desired model in the session record.
    """
    result = await session_manager.switch_model(session_id, model_id, provider)
    if not result:
        raise HTTPException(
            status_code=404, detail=f"Session {session_id} not found or not running"
        )
    return {"message": "Model switched", "modelId": model_id, "provider": provider or ""}
