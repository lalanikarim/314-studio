"""
Main application module for FastAPI + React Pi Integration.

This backend provides REST API endpoints for project selection, session management,
file browsing, model management, and chat with the Pi coding agent via WebSocket RPC.

Process lifecycle is managed by SessionManager (one `pi --mode rpc` process per session).
All RPC interactions with Pi go through WebSocket.

Project identification uses `project_path` as a query parameter (absolute path to project
directory), not as a route parameter.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    browse_router,
    chat_router,
    files_router,
    model_router,
    project_router,
    session_router,
)
from app.session_manager import session_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events for the application."""
    # Startup
    await session_manager.initialize()
    await session_manager.fetch_available_models()
    if session_manager._cached_models:
        logger = __import__("logging").getLogger(__name__)
        logger.info("Cached %d models at startup", len(session_manager._cached_models))
    session_manager.start_cleanup_task()
    yield
    # Shutdown
    await session_manager.shutdown_all()


app = FastAPI(
    title="314 Studio API",
    description=(
        "Backend API for 314 Studio — browser workspace for the Pi coding agent. "
        "One pi --mode rpc process per session. "
        "All Pi interactions go through WebSocket RPC."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# CORS - allow Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
# All project-scoped endpoints now use `project_path` as a query parameter
# instead of a route parameter for consistent path resolution.
app.include_router(browse_router, prefix="/api", tags=["browse"])
app.include_router(project_router, prefix="/api/projects", tags=["projects"])
app.include_router(session_router, prefix="/api/projects", tags=["sessions"])
app.include_router(files_router, prefix="/api/projects", tags=["files"])
app.include_router(model_router, prefix="/api/models", tags=["models"])
app.include_router(chat_router, prefix="/api/projects", tags=["chat"])

# Serve frontend static files in production
# app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
