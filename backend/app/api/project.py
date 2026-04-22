"""
Project API endpoints for browsing existing projects and managing sessions.

Session management delegates to SessionManager, which owns the lifecycle of
pi --rpc processes. Each session gets its own process.
"""

from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from ..schemas import SessionCreateRequest
from ..session_manager import SessionRecord, session_manager

router = APIRouter(redirect_slashes=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_project_path(project_path: Optional[str]) -> Path:
    """Resolve the project path string to a Path object.

    Handles absolute paths, paths starting with ~, and bare project names
    under ~/Projects.
    """
    if not project_path:
        raise HTTPException(
            status_code=400, detail="Missing required query parameter: project_path"
        )

    resolved = Path(project_path).expanduser()

    # If it's not absolute and doesn't exist, try ~/Projects/{name}
    if not resolved.is_absolute() and not resolved.exists():
        candidate = Path.home() / "Projects" / project_path
        if candidate.exists():
            resolved = candidate

    return resolved


# ---------------------------------------------------------------------------
# GET / — list projects
# ---------------------------------------------------------------------------


@router.get("/", response_model=List[str])
async def list_projects() -> List[str]:
    """List all available projects (subdirectories of ~/Projects)."""
    projects_dir = Path.home() / "Projects"

    projects = []
    if projects_dir.exists():
        for item in sorted(projects_dir.iterdir(), key=lambda e: e.name.lower()):
            if item.is_dir() and not item.name.startswith("."):
                projects.append(item.name)

    return projects


# ---------------------------------------------------------------------------
# GET /sessions — all active sessions across all projects
# ---------------------------------------------------------------------------


@router.get("/sessions", response_model=List[SessionRecord])
async def list_sessions():
    """List all active sessions across all projects."""
    return session_manager.get_all_sessions()


# ---------------------------------------------------------------------------
# GET /info — project info + sessions
# ---------------------------------------------------------------------------


@router.get("/info")
async def get_project_info(
    project_path: str = Query(..., description="Absolute path to the project directory"),
) -> dict:
    """Get project information including all active sessions."""
    resolved = _resolve_project_path(project_path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {resolved}")

    sessions = session_manager.get_sessions(str(resolved))
    running = [s for s in sessions if s.status == "running"]

    return {
        "path": str(resolved),
        "sessions": sessions,
        "running_count": len(running),
    }


# ---------------------------------------------------------------------------
# POST / — create new session
# ---------------------------------------------------------------------------


@router.post("", response_model=dict)
@router.post("/", response_model=dict, include_in_schema=False)
async def create_session(
    req: SessionCreateRequest,
    project_path: str = Query(..., description="Absolute path to the project directory"),
) -> SessionRecord:
    """Create a new session on a pi --rpc process.

    The session is created with the specified model_id stored as metadata.
    No RPC calls (get_available_models, set_model) are made during launch —
    they happen only when explicitly requested by the client.
    """
    resolved = _resolve_project_path(project_path)

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {resolved}")

    # Default session name
    existing = session_manager.get_sessions(str(resolved))
    name = req.name or f"Session {len(existing) + 1}"

    try:
        record = await session_manager.launch_session(
            project_path=str(resolved),
            name=name,
        )
        existing = session_manager.get_sessions(str(resolved))
        running_count = len([s for s in existing if s.status == "running"])
        return {**record.model_dump(), "running_count": running_count}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create session: {exc}") from exc
