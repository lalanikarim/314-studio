"""
Session Manager — orchestrates `pi --mode rpc` processes and WebSocket relays.

Architecture:
  - One `pi --mode rpc` process per session (not per project).
  - Sessions persist independently of WebSocket connections.
  - WebSocket is a thin relay channel; reconnect swaps the channel without
    touching the underlying RPC process.
  - Session close = compact + abort + terminate process.
  - Session delete = abort + terminate process (no compact).

Usage:
  from app.session_manager import session_manager

  # Create a new session (spawns pi --rpc)
  record = await session_manager.launch_session(project_path, name)

  # Connect a WebSocket to an existing session
  await session_manager.connect_ws(session_id, websocket_id)

  # Send a command (compact, abort, set_model, etc.) via WS relay
  session_manager.send_to_session(session_id, {"type": "compact"})

  # Close / delete a session
  await session_manager.close_session(session_id)       # compact + abort + terminate
  await session_manager.delete_session(session_id)       # abort + terminate

  # Switch model (updates metadata; actual RPC sent on WS connect)
  await session_manager.switch_model(session_id, model_id, provider)

  # Shutdown all (called on app shutdown)
  await session_manager.shutdown_all()
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Extension UI handling (shared with chat.py WS relay)
# ---------------------------------------------------------------------------

_FIRE_AND_FORGET_METHODS = frozenset(
    {
        "notify",
        "setStatus",
        "setTitle",
        "setFooter",
        "setHeader",
        "setWidget",
        "setEditorComponent",
        "set_tools_expanded",
    }
)

_INTERACTIVE_METHODS = frozenset({"select", "confirm", "input", "editor"})


def _make_extension_ui_response(req_id: str) -> dict:
    return {
        "type": "extension_ui_response",
        "id": req_id,
        "value": None,
        "cancelled": False,
    }


# ---------------------------------------------------------------------------
# Session record
# ---------------------------------------------------------------------------


class SessionRecord(BaseModel):
    """State for one pi --rpc session."""

    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)

    session_id: str
    project_path: str
    name: str
    model_id: Optional[str] = None
    status: str = "creating"  # creating | running | closing | stopped
    pid: Optional[int] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    ws_session_id: Optional[str] = None
    ws_connected: bool = False

    # Runtime-only fields — excluded from JSON serialization
    process: Any = Field(default=None, exclude=True)  # noqa: ANN401
    stdin: Any = Field(default=None, exclude=True)  # noqa: ANN401
    stdout: Any = Field(default=None, exclude=True)  # noqa: ANN401
    stdout_task: Optional[asyncio.Task] = Field(default=None, exclude=True)  # noqa: ANN401
    ws_to_stdin_queue: Optional[asyncio.Queue] = Field(default=None, exclude=True)  # noqa: ANN401
    pending_requests: dict[str, asyncio.Future] = Field(default_factory=dict, exclude=True)  # noqa: ANN401
    event_buffer: asyncio.Queue = Field(default_factory=asyncio.Queue, exclude=True)  # noqa: ANN401


# ---------------------------------------------------------------------------
# SessionManager (singleton)
# ---------------------------------------------------------------------------


class SessionManager:
    """Manages pi --rpc processes and their sessions."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}
        self._lock = asyncio.Lock()
        self._initialized = False
        # Background task that cleans up expired Futures
        self._cleanup_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def initialize(self) -> None:
        """Called on app startup. No-op for now — future: preload sessions."""
        self._initialized = True
        logger.info("SessionManager initialized")

    async def shutdown_all(self) -> None:
        """Terminate every running session. Called on app shutdown."""
        logger.info("SessionManager shutting down all sessions")
        if not self._initialized:
            return
        ids = [sid for sid, s in self._sessions.items() if s.status == "running"]
        for sid in ids:
            await self._safe_terminate(sid, "shutdown")

    # ------------------------------------------------------------------
    # ----------------------------------------
    # Model cache
    # ----------------------------------------

    _cached_models: list[dict] | None = None  # class-level cache of parsed models

    async def fetch_available_models(self) -> list[dict] | None:
        """
        Run ``pi --list-models`` and parse the tabular output.
        Result is cached at class level so repeated calls are O(1).

        Returns the list of model dicts on success, ``None`` on failure.
        """
        if self._cached_models is not None:
            return self._cached_models

        proc = await asyncio.create_subprocess_exec(
            "pi",
            "--list-models",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15.0)
        except asyncio.TimeoutError:
            logger.warning("pi --list-models timed out at startup")
            return None

        if proc.returncode != 0:
            stderr_text = stderr.decode(errors="replace")
            logger.warning(
                "pi --list-models failed (exit %d): %s",
                proc.returncode,
                stderr_text[:200],
            )
            return None

        raw = stdout.decode()  # model list goes to stdout
        if not raw.strip():
            logger.warning("pi --list-models produced no output")
            return None

        return self._parse_models_output(raw)

    @staticmethod
    def _parse_models_output(text: str) -> list[dict] | None:
        """Parse the tabular output of ``pi --list-models``.

        Output format (space-aligned columns):
            provider   model   context   max-out   thinking   images

        Model names can contain colons and slashes (e.g. ``hf.co/unsloth/...``),
        so we compute the model field from the left while parsing context from
        the right: ``parts[1:-4]`` covers the model field.
        """
        models: list[dict] = []
        known_providers = {
            "anthropic",
            "ollama",
            "aurora",
            "spark",
            "vllm",
            "google",
        }

        for line in text.splitlines():
            s = line.strip()
            if not s or s.startswith("[") or s.startswith("provider"):
                continue

            parts = s.split()
            if len(parts) < 6:
                continue

            provider = parts[0]
            if provider not in known_providers:
                continue

            model_id = " ".join(parts[1:-4])
            context_str = parts[-4]

            context = SessionManager._parse_context(context_str)
            if context < 0:  # _parse_context returns -1 on failure
                continue

            models.append(
                {
                    "id": model_id,
                    "provider": provider,
                    "contextWindow": context,
                }
            )

        SessionManager._cached_models = models
        logger.info("Parsed %d models from ``pi --list-models``", len(models))
        return models

    @staticmethod
    def _parse_context(s: str) -> int:
        """Convert a context string like ``200K``, ``1M``, ``163.8K``, ``512`` into an int."""
        s = s.strip().upper()
        if s.endswith("M"):
            return int(float(s[:-1]) * 1_000_000)
        if s.endswith("K"):
            return int(float(s[:-1]) * 1_000)
        try:
            return int(s)
        except ValueError:
            return -1

    # Launch
    # ------------------------------------------------------------------

    async def launch_session(self, project_path: str, name: str | None = None) -> SessionRecord:
        """
        Spawn a new `pi --mode rpc` process and wait for it to be ready.

        Returns the SessionRecord (status="running").
        """
        async with self._lock:
            session_id = f"sess_{uuid.uuid4().hex[:12]}"
            session_name = name or f"Session {len(self._sessions) + 1}"

            # Spawn process
            proc = await asyncio.create_subprocess_exec(
                "pi",
                "--mode",
                "rpc",
                cwd=project_path,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            record = SessionRecord(
                session_id=session_id,
                project_path=project_path,
                name=session_name,
                status="creating",
                pid=proc.pid,
                process=proc,
                stdin=proc.stdin,
                stdout=proc.stdout,
            )
            self._sessions[session_id] = record

        # Wait for RPC ready OUTSIDE the lock (stdout reader needs process alive)
        try:
            await self._wait_for_ready(record)
            record.status = "running"
        except Exception:
            record.status = "stopped"
            logger.error("Session %s failed to become ready", session_id, exc_info=True)
            # Attempt cleanup
            try:
                await self._safe_terminate(session_id, "launch_failure")
            except Exception:
                pass
            raise

        # Start stdout reader
        self._start_stdout_reader(record)

        return record

    async def _wait_for_ready(self, record: SessionRecord) -> None:
        """Verify the process started successfully (no RPC commands sent).

        No automatic RPC calls (get_available_models, set_model, etc.).
        All RPC interactions happen only when explicitly requested by the client
        (e.g. WS connect, model-switch endpoint).
        """
        # Brief poll to verify the process started successfully
        for _ in range(10):
            await asyncio.sleep(0.1)
            if record.process.returncode is None:
                logger.info(
                    "Session %s process alive (pid=%s)",
                    record.session_id,
                    record.pid,
                )
                return
            # Process exited immediately — something went wrong
            logger.error(
                "Session %s process exited with code %s",
                record.session_id,
                record.process.returncode,
            )
            raise RuntimeError(
                f"pi --rpc process exited immediately with code {record.process.returncode}"
            )

    # ------------------------------------------------------------------
    # Close / Delete
    # ------------------------------------------------------------------

    async def close_session(self, session_id: str) -> dict:
        """Compact → abort → terminate → remove. Returns {session_id, compacted: bool}."""
        async with self._lock:
            record = self._sessions.get(session_id)
            if not record or record.status != "running":
                raise ValueError(
                    f"Session {session_id} not found or not running"
                    f" (status={record.status if record else 'none'})"
                )
            record.status = "closing"

        compacted = False
        try:
            # Compact with a 5min timeout — context size can vary widely;
            # allow up to 300s for the compact RPC to complete before giving up
            await self._send_command_internal(record, {"type": "compact"}, timeout=300.0)
            compacted = True
            logger.info("Session %s compacted", session_id)
        except asyncio.TimeoutError:
            logger.warning("Session %s compact timed out, proceeding anyway", session_id)
        except Exception as exc:
            logger.warning("Session %s compact failed: %s, proceeding anyway", session_id, exc)

        # Always abort + terminate
        await self._safe_terminate(session_id, "close")
        return {"session_id": session_id, "compacted": compacted}

    async def delete_session(self, session_id: str) -> dict:
        """Abort → terminate → remove (no compact). Returns {session_id, compacted: bool}."""
        async with self._lock:
            record = self._sessions.get(session_id)
            if not record or record.status not in ("running",):
                raise ValueError(f"Session {session_id} not found or not running")
            record.status = "closing"

        await self._safe_terminate(session_id, "delete")
        return {"session_id": session_id, "compacted": False}

    # ------------------------------------------------------------------
    # Model switch
    # ------------------------------------------------------------------

    async def switch_model(
        self, session_id: str, model_id: str, provider: str | None = None
    ) -> SessionRecord | None:
        """Update the model metadata for a session.

        This only records the desired model in the session record. The actual
        set_model RPC command is sent over WebSocket when the client connects
        (ensuring all Pi actions go through WS, never direct HTTP→stdin).
        """
        async with self._lock:
            record = self._sessions.get(session_id)
            if not record or record.status != "running":
                return None
            record.model_id = model_id
            return record

    async def get_model_id(self, session_id: str) -> str | None:
        """Get the configured model_id for a session (used by WS on connect)."""
        async with self._lock:
            record = self._sessions.get(session_id)
            return record.model_id if record else None

    # ------------------------------------------------------------------
    # WebSocket management
    # ------------------------------------------------------------------

    async def connect_ws(self, session_id: str, websocket_id: str) -> bool:
        """Mark a session as having an active WebSocket. Returns False if not found/running."""
        async with self._lock:
            record = self._sessions.get(session_id)
            if not record or record.status != "running":
                return False
            record.ws_session_id = websocket_id
            record.ws_connected = True
            return True

    async def disconnect_ws(self, session_id: str, websocket_id: str) -> None:
        """Clear WebSocket tracking (only if this specific websocket_id)."""
        async with self._lock:
            record = self._sessions.get(session_id)
            if record and record.ws_session_id == websocket_id:
                record.ws_session_id = None
                record.ws_connected = False

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get_session(self, session_id: str) -> SessionRecord | None:
        return self._sessions.get(session_id)

    def get_sessions(self, project_path: str) -> list[SessionRecord]:
        return [s for s in self._sessions.values() if s.project_path == project_path]

    def get_all_sessions(self) -> list[SessionRecord]:
        return list(self._sessions.values())

    def get_running_instances(self) -> list[SessionRecord]:
        return [s for s in self._sessions.values() if s.status == "running"]

    # ------------------------------------------------------------------
    # Relay helpers (called from WS relay in chat.py)
    # ------------------------------------------------------------------

    async def get_next_event(self, session_id: str) -> dict | None:
        """Get next queued event from the session's event buffer. Blocks until one arrives."""
        record = self._sessions.get(session_id)
        if not record:
            return None
        return await record.event_buffer.get()

    def send_to_session(self, session_id: str, payload: dict) -> None:
        """Enqueue a WebSocket message to be sent to the session's stdin by the relay task.

        This is a low-level enqueue — the WS relay task reads from this and writes to stdin.
        """
        record = self._sessions.get(session_id)
        if not record or record.status != "running":
            return
        # We use a special marker queue for WS→stdin messages
        if record.ws_to_stdin_queue is None:
            record.ws_to_stdin_queue = asyncio.Queue()
        record.ws_to_stdin_queue.put_nowait(payload)

    # ------------------------------------------------------------------
    # Internal: command sending
    # ------------------------------------------------------------------

    async def _send_command_internal(
        self, record: SessionRecord, command: dict, timeout: float | None = None
    ) -> dict:
        """Send a command and wait for the matching response. Raises on timeout."""
        req_id = command.get("id") or str(uuid.uuid4())
        command["id"] = req_id

        loop = asyncio.get_event_loop()
        future: asyncio.Future[dict] = loop.create_future()
        record.pending_requests[req_id] = future

        try:
            line = json.dumps(command, ensure_ascii=False) + "\n"
            record.stdin.write(line.encode("utf-8"))
            await record.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as exc:
            record.pending_requests.pop(req_id, None)
            raise RuntimeError(f"Session {record.session_id} process pipe broken: {exc}") from exc

        try:
            if timeout is not None:
                result = await asyncio.wait_for(future, timeout=timeout)
            else:
                result = await future
            return result
        except asyncio.TimeoutError:
            record.pending_requests.pop(req_id, None)
            raise

    # ------------------------------------------------------------------
    # Internal: stdout reader
    # ------------------------------------------------------------------

    def _start_stdout_reader(self, record: SessionRecord) -> None:
        """Start the background task that reads stdout and routes to Futures / event buffer."""
        record.stdout_task = asyncio.create_task(
            self._stdout_reader_loop(record),
            name=f"stdout_reader_{record.session_id}",
        )
        logger.info("Started stdout reader for session %s", record.session_id)

    async def _stdout_reader_loop(self, record: SessionRecord) -> None:
        """Continuously read JSON lines from stdout.

        Routes:
          - "response" with matching id → resolves pending_request Future
          - "extension_ui_request" → auto-reply (fire-and-forget) or queue in event_buffer
          - Everything else → queues in event_buffer for WS relay
        """
        try:
            while True:
                line = await record.stdout.readline()
                if not line:
                    # EOF — process exited
                    logger.info("Session %s stdout closed", record.session_id)
                    break

                decoded = line.decode().strip()
                if not decoded:
                    continue

                try:
                    data = json.loads(decoded)
                except json.JSONDecodeError:
                    continue

                if not isinstance(data, dict):
                    continue

                msg_type = data.get("type")

                # Route response to pending request Future
                req_id = data.get("id")
                if req_id and req_id in record.pending_requests:
                    future = record.pending_requests.pop(req_id)
                    if not future.done():
                        future.set_result(data)
                    continue

                # Route extension_ui_request
                if msg_type == "extension_ui_request":
                    method = data.get("method", "")
                    req_id_val = data.get("id", str(uuid.uuid4()))
                    if method in _FIRE_AND_FORGET_METHODS:
                        # Auto-ack so Pi doesn't block
                        reply = _make_extension_ui_response(req_id_val)
                        try:
                            line_out = json.dumps(reply, ensure_ascii=False) + "\n"
                            record.stdin.write(line_out.encode("utf-8"))
                            await record.stdin.drain()
                        except Exception:
                            pass
                    elif method in _INTERACTIVE_METHODS:
                        # Forward to frontend via event buffer
                        wrapped = {"kind": "extension_ui_request", **data}
                        await record.event_buffer.put(wrapped)
                    else:
                        # Unknown method — auto-ack
                        reply = _make_extension_ui_response(req_id_val)
                        try:
                            line_out = json.dumps(reply, ensure_ascii=False) + "\n"
                            record.stdin.write(line_out.encode("utf-8"))
                            await record.stdin.drain()
                        except Exception:
                            pass

                # Everything else goes to event buffer for WS relay
                elif msg_type == "response":
                    # Response without matching pending_request — still relay to WS
                    wrapped = data
                    await record.event_buffer.put(wrapped)
                else:
                    # Streaming events
                    wrapped = {"kind": "rpc_event", "event": data}
                    await record.event_buffer.put(wrapped)

        except asyncio.CancelledError:
            logger.info("Session %s stdout reader cancelled", record.session_id)
        except Exception as exc:
            logger.error(
                "Session %s stdout reader error: %s", record.session_id, exc, exc_info=True
            )
        finally:
            # Mark session stopped if not already
            if record.status == "running":
                record.status = "stopped"
            # Wake up anyone waiting on event_buffer
            try:
                await record.event_buffer.put(None)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Internal: termination
    # ------------------------------------------------------------------

    async def _safe_terminate(self, session_id: str, reason: str = "unknown") -> None:
        """Terminate the session's process and clean up the record."""
        async with self._lock:
            record = self._sessions.get(session_id)
            if not record:
                return
            record.status = "stopped"

        # Cancel stdout reader
        if record.stdout_task and not record.stdout_task.done():
            record.stdout_task.cancel()
            try:
                await record.stdout_task
            except asyncio.CancelledError:
                pass

        # Terminate process
        if record.process and record.process.returncode is None:
            try:
                record.process.terminate()
                try:
                    await asyncio.wait_for(record.process.wait(), timeout=2.0)
                except asyncio.TimeoutError:
                    record.process.kill()
                    await record.process.wait()
            except Exception:
                # Process might have already exited
                pass

        # Resolve all pending Futures with error
        async with self._lock:
            record = self._sessions.get(session_id)
            if record:
                for future in record.pending_requests.values():
                    if not future.done():
                        future.set_exception(RuntimeError(f"Session terminated ({reason})"))
                # Remove from dict
                self._sessions.pop(session_id, None)

        logger.info("Session %s terminated (reason=%s)", session_id, reason)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_provider(model_id: str) -> str:
        """Extract provider from model_id if it uses provider/id format."""
        # Common conventions: "anthropic/claude-sonnet-4", "openai/gpt-4.1", etc.
        if "/" in model_id:
            return model_id.split("/", 1)[0]
        # Heuristic: common prefixes
        for provider in (
            "anthropic",
            "openai",
            "google",
            "deepseek",
            "mistral",
            "groq",
            "together",
        ):
            if model_id.startswith(provider):
                return provider
        return "anthropic"

    # ------------------------------------------------------------------
    # Future cleanup (background)
    # ------------------------------------------------------------------

    def start_cleanup_task(self) -> None:
        """Start a background task that removes expired pending_requests."""
        if self._cleanup_task and not self._cleanup_task.done():
            return
        self._cleanup_task = asyncio.create_task(
            self._cleanup_loop(), name="session_manager_cleanup"
        )

    async def _cleanup_loop(self) -> None:
        """Every 30 seconds, remove expired Futures from all sessions."""
        while True:
            await asyncio.sleep(30)
            for record in list(self._sessions.values()):
                for req_id, future in list(record.pending_requests.items()):
                    if future.done():
                        del record.pending_requests[req_id]


# Module-level singleton
session_manager = SessionManager()
