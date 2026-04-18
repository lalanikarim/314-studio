"""
Project API endpoints for browsing existing projects (under $HOME/Projects).
"""

from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()


@router.get("/", response_model=List[str])
async def list_projects() -> List[str]:
    """
    List all available projects (subdirectories of ~/Projects).
    """
    projects_dir = Path.home() / "Projects"

    projects = []
    if projects_dir.exists():
        for item in sorted(projects_dir.iterdir(), key=lambda e: e.name.lower()):
            if item.is_dir() and not item.name.startswith("."):
                projects.append(item.name)

    return projects


@router.get("/info")
async def get_project_info(
    project_path: str = Query(..., description="Absolute path to the project directory"),
) -> dict:
    """
    Get information about a specific project.
    """
    resolved = Path(project_path).expanduser()

    # If not absolute and doesn't exist, try ~/Projects/{name}
    if not resolved.is_absolute() and not resolved.exists():
        candidate = Path.home() / "Projects" / project_path
        if candidate.exists():
            resolved = candidate

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {resolved}")

    return {"path": str(resolved), "exists": True, "is_directory": True}
