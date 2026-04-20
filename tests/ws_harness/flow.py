"""Main harness orchestration — follows the frontend flow EXACTLY.

Steps:
  1. FolderSelector → setSelectedFolder + setView('models')
  2. ModelSelector mounts → useModels → createSession (POST)
  3. useModels polls GET /api/models/ until models arrive
  4. User selects model → switchModel + setView('workspace')
  5. ChatPanel mounts → useWebSocket → doConnect
  6. WS onopen → send get_state + set_model
  7. Send prompt "Tell me about this project"
  8. Relay inbound messages
"""

from __future__ import annotations

import asyncio
import json
import time

import httpx

from .colors import (
    banner,
    err,
    info,
    ok,
    verdict_inconclusive,
    verdict_stable,
    verdict_stall,
    warn,
)
from .config import (
    API_BASE,
    MAX_POLL_TIME,
    POLL_INTERVAL,
    PROJECT_NAME,
    RELAY_WINDOW,
    TEST_MODEL_ID,
)
from .http_client import http_get, http_post
from .project_resolver import list_projects, resolve_project_path
from .ws_client import ws_connect, ws_receive, ws_send


def _select_model(models: list[dict] | None) -> tuple[str, str]:
    """Pick the best model from the list, falling back to default."""
    if not models:
        return TEST_MODEL_ID, ""
    for m in models:
        if TEST_MODEL_ID in m.get("id", ""):
            return m["id"], m.get("provider", "")
    return TEST_MODEL_ID, ""


def _format_msg(msg: dict, elapsed: float) -> str:
    """Format a WS inbound message for display."""
    kind = msg.get("kind", msg.get("type", "unknown"))
    event = msg.get("event", {})
    etype = event.get("type", event.get("status", kind))

    if kind == "rpc_event":
        return f"[+{elapsed:.0f}s] ◉ rpc_event type={etype}"
    if kind == "extension_ui_request":
        return f"[+{elapsed:.0f}s] ❗ extension_ui_request method={msg.get('method')}"
    if kind == "extension_ui_response":
        return f"[+{elapsed:.0f}s] ◉ extension_ui_response"
    if kind == "response":
        return f"[+{elapsed:.0f}s] ✓ response"
    return f"[+{elapsed:.0f}s] {kind}: {json.dumps(msg)[:300]}"


def _extract_content(msg: dict) -> str:
    """Extract text content from a Pi RPC streaming event.

    Per the official RPC protocol docs, message_update events have this shape:
      { type: "message_update", assistantMessageEvent: { type, delta, partial } }

    Text deltas come in two forms:
      - text_delta:   ami.delta contains the new chunk
      - text_start:   ami.partial.content[0].text has accumulated text
    """
    if msg.get("kind") != "rpc_event":
        return ""

    event = msg.get("event", {})
    if event.get("type") != "message_update":
        return ""

    # assistantMessageEvent is the actual stream payload (per RPC docs)
    ami = event.get("assistantMessageEvent", {})
    if not ami or not isinstance(ami, dict):
        return ""

    delta_type = ami.get("type", "")

    # text_delta: single text chunk in ami.delta
    if delta_type == "text_delta":
        delta = ami.get("delta", "")
        if isinstance(delta, str) and delta:
            return delta

    # text_start / other: accumulated text in ami.partial.content[0].text
    partial = ami.get("partial", {})
    if isinstance(partial, dict):
        content_list = partial.get("content", [])
        if isinstance(content_list, list) and content_list:
            first = content_list[0]
            if isinstance(first, dict):
                text = first.get("text", "")
                if isinstance(text, str) and text:
                    return text

    return ""


async def run() -> int:
    """Run the full frontend flow and return exit code."""

    # ── Resolve project path ───────────────────────────────────────────

    project_path = resolve_project_path(PROJECT_NAME)
    if not project_path.exists():
        err(f"Project not found: {PROJECT_NAME}")
        print("\nAvailable in ~/Projects:")
        for name in list_projects():
            print(f"  - {name}")
        return 1

    print(f"Project: {project_path}")
    print(f"Model:   {TEST_MODEL_ID}")

    # ── Step 1: FolderSelector ─────────────────────────────────────────

    banner("STEP 1: FolderSelector — setSelectedFolder + setView('models')")
    info(f"selectedFolder = {project_path}")
    info("selectedModel = null")
    info("view = 'models'")

    # ── Step 2: ModelSelector mounts → useModels → createSession ───────

    banner("STEP 2: ModelSelector mounts → useModels creates session")
    info("useModels(folder) → createSession(projectPath)")
    info("POST /api/projects/?project_path=...")

    async with httpx.AsyncClient(timeout=60) as client:
        # Verify server reachable
        try:
            await client.get(f"http://{API_BASE.replace('http://', '')}/docs", timeout=5)
            ok(f"Backend reachable at {API_BASE}")
        except Exception as e:
            err(f"Cannot reach backend at {API_BASE}: {e}")
            return 1

        # Create session
        try:
            session_data = await http_post(
                client,
                "/api/projects/",
                body={},  # body is required by FastAPI even if empty
                params={"project_path": str(project_path)},
            )
            session_id = session_data["session_id"]
            info(f"session_id = {session_id}")
            info(f"status = {session_data.get('status')}")
            info(f"model_id = {session_data.get('model_id')}")
            ok("Session created (status=running)")
        except Exception as e:
            err(f"Failed to create session: {e}")
            return 1

        info("AppContext.sessionId = session_id ✓")

        # ── Step 3: useModels polls for models ─────────────────────────

        banner("STEP 3: useModels polls for models")
        info("GET /api/models/?session_id=...  (polls every 1.5s for up to 30s)")

        start_poll = time.monotonic()
        models: list[dict] | None = None
        poll_count = 0
        while time.monotonic() - start_poll < MAX_POLL_TIME:
            poll_count += 1
            try:
                raw = await http_get(
                    client,
                    "/api/models/",
                    params={"session_id": session_id},
                )
                models = raw if isinstance(raw, list) else []
                if models and len(models) > 0:
                    ok(
                        f"Models arrived after {poll_count} poll(s) "
                        f"({time.monotonic() - start_poll:.1f}s)"
                    )
                    for m in models[:3]:
                        info(f"  - {m.get('provider', '?')} — {m.get('id', '?')}")
                    break
            except Exception as e:
                if poll_count % 4 == 0:
                    warn(f"Poll {poll_count}: {e}")
            await asyncio.sleep(POLL_INTERVAL)
        else:
            warn("Timeout waiting for models — continuing anyway")

        # ── Step 4: User selects model ─────────────────────────────────

        banner("STEP 4: User selects model → switchModel + setView('workspace')")
        info("switchModel(selectedModel)")
        info("setCurrentModel(selectedModel)")
        info("setView('workspace')")
        info("No REST API call — model switch is client-side only")

        selected_model_id, selected_provider = (
            _select_model(models) if models else (TEST_MODEL_ID, "")
        )
        info(f"Selected model: {selected_model_id} (provider: {selected_provider})")

        # ── Step 5: ChatPanel mounts → useWebSocket ────────────────────

        banner("STEP 5: ChatPanel mounts → useWebSocket(folder, modelRef, sessionId)")
        info(f"selectedFolder = {project_path}")
        info(f"modelRef.current = model(id={selected_model_id})")
        info(f"sessionId = {session_id}")
        info("useWebSocket mount effect → doConnect()")

        # ── Step 6: WS Connect ─────────────────────────────────────────

        banner("STEP 6: WS Connect — mimics useWebSocket doConnect()")
        ws = await ws_connect(session_id)

        connection_start = time.monotonic()
        messages_received: list[dict] = []
        set_model_sent = False

        # ── Step 7: WS onopen → get_state + set_model ──────────────────

        banner("STEP 7: WS onopen → get_state + set_model")
        await asyncio.sleep(0.5)  # let WS settle

        await ws_send(ws, {"type": "get_state"})
        await asyncio.sleep(0.5)

        await ws_send(
            ws,
            {
                "type": "set_model",
                "provider": selected_provider,
                "modelId": selected_model_id,
            },
        )
        set_model_sent = True
        ok("get_state + set_model sent")

        # ── Step 8: Send prompt ────────────────────────────────────────

        banner("STEP 8: Send prompt message")
        await ws_send(ws, "Tell me about this project")
        info("Message sent. Waiting for response...")

        # ── Step 9: Relay inbound messages ─────────────────────────────

        banner("STEP 9: Relay inbound messages (60s window)")
        relay_start = time.monotonic()
        collected_content = []  # accumulate text content for final display
        last_content_len = 0  # track how much new content each time

        try:
            while time.monotonic() - relay_start < RELAY_WINDOW:
                elapsed = time.monotonic() - connection_start
                msg = await ws_receive(ws, timeout=5.0)
                if msg is None:
                    info(f"[+{elapsed:.0f}s] (timeout, waiting...)")
                    continue

                messages_received.append(msg)

                # ── Dump first 3 message_update events to stderr for inspection ──
                if msg.get("kind") == "rpc_event":
                    event = msg.get("event", {})
                    etype = event.get("type", "")
                    if etype == "message_update":
                        import sys

                        msg_idx = len(messages_received)
                        # Count how many message_update events we've seen so far
                        update_count = sum(
                            1
                            for m in messages_received
                            if m.get("kind") == "rpc_event"
                            and m.get("event", {}).get("type") == "message_update"
                        )
                        if update_count <= 3:
                            sys.stderr.write(f"\n{'=' * 70}\n")
                            sys.stderr.write(f"RAW MESSAGE_UPDATE #{update_count} (stderr):\n")
                            sys.stderr.write(f"{'=' * 70}\n")
                            sys.stderr.write(f"Top-level keys: {list(msg.keys())}\n")
                            sys.stderr.write(f"Event keys: {list(event.keys())}\n")
                            if "data" in event:
                                sys.stderr.write(f"event.data type: {type(event['data'])}\n")
                                if isinstance(event["data"], dict):
                                    for dk in list(event["data"].keys())[:8]:
                                        dv = event["data"][dk]
                                        val = str(dv)[:300]
                                        sys.stderr.write(f"  data.{dk} = {val}\n")
                            else:
                                for dk in list(event.keys())[:8]:
                                    dv = event[dk]
                                    val = str(dv)[:300]
                                    sys.stderr.write(f"  event.{dk} = {val}\n")
                            sys.stderr.write(f"{'=' * 70}\n")
                            sys.stderr.flush()
                kind = msg.get("kind", msg.get("type", "unknown"))

                # Extract content from message_update events
                if kind == "rpc_event":
                    content = _extract_content(msg)
                    if content:
                        collected_content.append(content)

                    # Print a condensed summary of event types
                    event = msg.get("event", {})
                    etype = event.get("type", "unknown")
                    if etype == "message_update" and content:
                        # Show running content update
                        current_text = "".join(collected_content)
                        new_text = current_text[last_content_len:]
                        last_content_len = len(current_text)
                        if new_text.strip():
                            info(f"[+{elapsed:.0f}s] text: {new_text[:80]}...")
                    elif etype in ("message_start", "turn_start", "agent_start"):
                        info(f"[+{elapsed:.0f}s] ◉ {etype}")
                    elif etype in ("tool_execution_start", "tool_execution_end"):
                        tool = event.get("tool_name", event.get("name", ""))
                        info(f"[+{elapsed:.0f}s] ◉ {etype} {tool}")
                    elif etype == "agent_end":
                        # Agent is fully idle — no more turns or tool calls.
                        # Per RPC docs: "Emitted when the agent completes."
                        # The messages array has the full response as backup.
                        info(f"[+{elapsed:.0f}s] ◉ {etype}")
                        if event.get("messages"):
                            info(
                                f"  agent_end includes {len(event['messages'])} message(s) "
                                f"(backup text source)"
                            )
                        info(f"[+{elapsed:.0f}s] Agent idle — breaking relay loop")
                        break
                    elif etype in ("turn_end", "message_end"):
                        info(f"[+{elapsed:.0f}s] ◉ {etype}")
                    else:
                        info(f"[+{elapsed:.0f}s] ◉ {etype}")
                elif kind == "response":
                    info(f"[+{elapsed:.0f}s] ✓ response")
                elif kind == "extension_ui_request":
                    info(f"[+{elapsed:.0f}s] ❗ {msg.get('method')}")
                else:
                    info(f"[+{elapsed:.0f}s] {kind}")
        except asyncio.CancelledError:
            pass

        # ── Summary ────────────────────────────────────────────────────

        total_time = time.monotonic() - connection_start
        banner("SUMMARY")
        info(f"Total WS time: {total_time:.1f}s")
        info(f"Total inbound messages: {len(messages_received)}")
        info(f"set_model sent: {set_model_sent}")

        rpc_events = sum(1 for m in messages_received if m.get("kind") == "rpc_event")
        ext_requests = sum(1 for m in messages_received if m.get("kind") == "extension_ui_request")
        ext_responses = sum(
            1 for m in messages_received if m.get("kind") == "extension_ui_response"
        )
        responses = sum(
            1 for m in messages_received if m.get("type") == "response" and m.get("kind") is None
        )

        info(f"  rpc_events: {rpc_events}")
        info(f"  extension_ui_requests: {ext_requests}")
        info(f"  extension_ui_responses: {ext_responses}")
        info(f"  responses: {responses}")

        # Verdict
        if rpc_events > 0:
            verdict_stable()
            info(f"  {len(messages_received)} inbound, {rpc_events} RPC events, no loop")

            # Print the full response
            if collected_content:
                full_text = "".join(collected_content)
                banner("RESPONSE FROM MODEL")
                print(f"{full_text}")
            return 0
        elif total_time >= RELAY_WINDOW:
            verdict_stall()
            info(f"  60s elapsed, {len(messages_received)} messages — connection stalled")
            return 1
        else:
            verdict_inconclusive()
            info(f"  {len(messages_received)} messages in {total_time:.1f}s")
            return 1
