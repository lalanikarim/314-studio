"""
Browse endpoint for navigating the filesystem tree (used by FolderSelector).
"""

from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter

router = APIRouter()


@router.get("/browse")
async def browse(path: Optional[str] = None) -> List[dict]:
    """
    List subdirectories at the given path (defaults to ~/Projects).
    Returns only directories, suitable for building a folder tree view.
    """
    if path:
        # Resolve relative paths against home
        target = Path(path).expanduser()
    else:
        target = Path.home() / "Projects"

    if not target.exists():
        return []

    dirs = []
    for entry in sorted(target.iterdir(), key=lambda e: e.name.lower()):
        if entry.is_dir() and not entry.name.startswith(".") and not entry.name.startswith("_"):
            dirs.append(
                {
                    "path": str(entry),
                    "name": entry.name,
                    "isDirectory": True,
                }
            )

    return dirs
