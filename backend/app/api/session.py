"""
Session API endpoints for managing coding sessions.
These now work through WebSocket to Pi RPC, not direct files.
"""

from typing import List

from fastapi import APIRouter, HTTPException

from ..schemas import ModelConfig, Session, SessionBase

router = APIRouter()


@router.get("/sessions", response_model=List[SessionBase])
async def list_sessions(project_name: str) -> List[SessionBase]:
    """
    List all sessions for a project.
    This information comes from Pi RPC via WebSocket, not direct filesystem access.
    """
    # In the new workflow, this information would come from Pi RPC
    # For now, we return an empty list - the real data comes through WebSocket
    return []


@router.post("/sessions", response_model=Session)
async def create_session(project_name: str, session_data: dict) -> Session:
    """
    Create a new session for a project.
    The actual creation happens through Pi RPC.
    """
    # In the new workflow:
    # 1. WebSocket connects to Pi RPC
    # 2. Send create_session command via WebSocket
    # 3. Get session info back

    # For now, return a stub - the real session comes from Pi RPC
    model_config = ModelConfig(id="claude-sonnet-4-20250514", provider="anthropic")

    return Session(
        session_id=f"session-{project_name}-{session_data.get('name', 'new-session')}",
        name=session_data.get("name", "New Session"),
        project=project_name,
        messages=[],
        model=model_config,
        thinking="medium",
    )


@router.get("/sessions/{session_id}", response_model=Session)
async def get_session(project_name: str, session_id: str) -> Session:
    """
    Get session details.
    This information comes from Pi RPC via WebSocket.
    """
    # In the new workflow, this comes from Pi RPC
    raise HTTPException(status_code=404, detail="Session info available via WebSocket")
