"""Project path resolution — matches backend logic."""

from __future__ import annotations

from pathlib import Path


def resolve_project_path(name: str) -> Path:
    """Resolve project path like the backend does.

    Handles absolute paths, paths starting with ~, and bare project names
    under ~/Projects.
    """
    p = Path(name).expanduser()
    if not p.is_absolute() and not p.exists():
        candidate = Path.home() / "Projects" / name
        if candidate.exists():
            p = candidate
    return p


def list_projects() -> list[str]:
    """List available projects under ~/Projects."""
    projects_dir = Path.home() / "Projects"
    if not projects_dir.exists():
        return []
    return [
        item.name
        for item in sorted(projects_dir.iterdir())
        if item.is_dir() and not item.name.startswith(".")
    ]
