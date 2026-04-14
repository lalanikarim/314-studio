"""
Project API endpoints for browsing existing projects (under $HOME).
"""

from fastapi import APIRouter, HTTPException
from pathlib import Path
from typing import List

router = APIRouter()


@router.get("/", response_model=List[str])
async def list_projects() -> List[str]:
    """
    List all available projects (subdirectories of $HOME).
    Projects are existing folders under the user's home directory.
    """
    # Get home directory
    home_dir = Path.home()

    # Get current user's Projects directory
    # This assumes projects are under ~/Projects or similar
    projects_dir = home_dir / "Projects"

    # List subdirectories
    projects = []
    if projects_dir.exists():
        for item in projects_dir.iterdir():
            if item.is_dir() and not item.name.startswith("."):
                projects.append(item.name)

    return projects


@router.get("/{project_name}/info")
async def get_project_info(project_name: str) -> dict:
    """
    Get information about a specific project.
    """
    # Get home directory
    home_dir = Path.home()
    projects_dir = home_dir / "Projects"
    project_path = projects_dir / project_name

    if not project_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    return {"path": str(project_path), "exists": True, "is_directory": True}
