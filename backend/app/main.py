"""
Main application module for FastAPI + React Pi Integration.

This backend provides REST API endpoints for project selection, session management,
file browsing, model management, and chat with the Pi coding agent via Server-Sent Events.

Process lifecycle is managed by SessionManager (one `pi --mode rpc` process per session).
All RPC interactions go through SSE (streaming) and REST (commands).

Project identification uses `project_path` as a query parameter (absolute path to project
directory), not as a route parameter.
"""

import logging
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.api import (
    browse_router,
    chat_router,
    files_router,
    model_router,
    project_router,
    session_router,
)
from app.session_manager import SessionManager, session_manager
from app.utils import RateLimiter, get_remote_key

logger = logging.getLogger(__name__)

# Rate limiter: 60 requests per minute per client IP
rate_limiter = RateLimiter(max_requests=60, window_seconds=60.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events for the application."""
    # Startup
    await session_manager.initialize()
    await session_manager.fetch_available_models()
    cached = SessionManager.get_cached_models()
    if cached:
        logger.info("Cached %d models at startup", len(cached))
    session_manager.start_cleanup_task()
    yield
    # Shutdown
    await session_manager.shutdown_all()


app = FastAPI(
    title="314 Studio API",
    description=(
        "Backend API for 314 Studio — browser workspace for the Pi coding agent. "
        "One pi --mode rpc process per session. "
        "All Pi interactions go through Server-Sent Events (SSE)."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


app.add_middleware(GZipMiddleware, minimum_size=500)


@app.get("/health")
async def health_check():
    """Health check for monitoring and load balancers."""
    running = len([s for s in session_manager.get_all_sessions() if s.status == "running"])
    return {
        "status": "ok",
        "running_sessions": running,
    }


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Add a request ID to every request and response."""
    request.state.request_id = str(uuid.uuid4())[:12]
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Apply rate limiting to all requests. Disabled when RATE_LIMIT_DISABLED=1."""
    if os.environ.get("RATE_LIMIT_DISABLED") != "1":
        try:
            rate_limiter.check(get_remote_key(request))
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)


# CORS - allow Vite dev server and its proxy target
_frontend_port = int(os.getenv("FRONTEND_PORT", "5173"))
_backend_port = int(os.getenv("BACKEND_PORT", "8000"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{_frontend_port}",
        f"http://localhost:{_backend_port}",
    ],
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

    _backend_port = int(os.getenv("BACKEND_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=_backend_port)
