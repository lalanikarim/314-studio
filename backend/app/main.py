"""
Main application module for FastAPI + React Pi Integration.

This backend provides REST API endpoints for project selection, session management,
file browsing, model management, and chat with the Pi coding agent via WebSocket RPC.

All interactions with Pi happen through WebSocket after starting pi --rpc.
"""

from fastapi import FastAPI
from app.api import (
    project_router,
    session_router,
    files_router,
    model_router,
    chat_router,
)

app = FastAPI(
    title="FastAPI React Pi Integration",
    description="API for Pi coding agent integration with React frontend. All Pi interactions go through WebSocket RPC.",
    version="0.1.0",
)

# Include API routers
# Note: Projects are existing folders under $HOME/Projects
app.include_router(project_router, prefix="/api/projects", tags=["projects"])
app.include_router(
    session_router, prefix="/api/projects/{project_name}", tags=["sessions"]
)
app.include_router(files_router, prefix="/api/projects/{project_name}", tags=["files"])
app.include_router(model_router, prefix="/api/models", tags=["models"])
app.include_router(chat_router, prefix="/api/projects/{project_name}", tags=["chat"])

# Serve frontend static files in production
# app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
