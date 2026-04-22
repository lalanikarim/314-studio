#!/usr/bin/env python3
"""
Observe pi --rpc startup: spawn, read stdout for 3 min, report all events.

No commands are sent. No interaction. Just a raw reader watching stdout.

Usage:
    uv run observe_startup.py [iterations]
"""

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

PROJECT_DIR = Path(__file__).parent / "tmp_test_project"
PROJECT_DIR.mkdir(exist_ok=True)


def parse_args():
    parser = argparse.ArgumentParser(description="Observe pi --rpc startup behavior")
    parser.add_argument(
        "iterations", type=int, default=1, nargs="?", help="Number of iterations (default: 1)"
    )
    return parser.parse_args()


async def run_iteration(iteration: int) -> dict:
    """Run one iteration: spawn pi --rpc, read stdout for 3 min, report."""
    print(f"\n{'=' * 70}")
    print(f"  ITERATION {iteration}  —  {datetime.now(timezone.utc).isoformat()}")
    print(f"{'=' * 70}")

    proc = await asyncio.create_subprocess_exec(
        "pi",
        "--mode",
        "rpc",
        cwd=str(PROJECT_DIR),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    pid = proc.pid
    print(f"  PID: {pid}")

    events: list[dict] = []
    auto_replies = 0
    start_time = asyncio.get_event_loop().time()

    async def reader():
        nonlocal auto_replies
        deadline = start_time + 180.0
        try:
            while True:
                elapsed = asyncio.get_event_loop().time() - start_time
                if elapsed >= 180.0:
                    print(f"\n  [TIMEOUT] 3 min reached at {elapsed:.1f}s")
                    break

                try:
                    line = await asyncio.wait_for(
                        proc.stdout.readline(),
                        timeout=min(
                            2.0,
                            max(0.1, 180.0 - (asyncio.get_event_loop().time() - start_time)),
                        ),
                    )
                except (TimeoutError, asyncio.CancelledError):
                    continue

                if not line:
                    print(f"  [EOF] stdout closed")
                    break

                decoded = line.decode().strip()
                if not decoded:
                    continue

                ts = asyncio.get_event_loop().time() - start_time

                try:
                    obj = json.loads(decoded)
                except json.JSONDecodeError:
                    obj = {"_raw": decoded}

                events.append({"ts": ts, "obj": obj})

                etype = obj.get("type", "?")
                eid = obj.get("id", "")
                cmd = obj.get("command", "")
                kind = obj.get("kind", "")

                print(f"  [{ts:6.1f}s] {etype:20s} id={eid[:16]:16s} cmd={cmd:12s} kind={kind:12s}")
                preview = json.dumps(obj, default=str)[:250]
                print(f"           {preview}")

                if isinstance(obj, dict) and obj.get("type") == "extension_ui_request":
                    auto_replies += 1
                    reply = {
                        "type": "extension_ui_response",
                        "id": obj["id"],
                        "value": None,
                        "cancelled": False,
                    }
                    try:
                        proc.stdin.write(f"{json.dumps(reply)}\n".encode())
                        await proc.stdin.drain()
                        method = obj.get("method", "unknown")
                        print(f"  >>> AUTO-REPLY to extension_ui_request (method={method})")
                    except Exception as exc:
                        print(f"  !!! Auto-reply failed: {exc}")

        except (TimeoutError, asyncio.CancelledError):
            pass

    reader_task = asyncio.create_task(reader())
    await reader_task

    # Process state
    if proc.returncode is not None:
        print(f"  Process exited during read — returncode: {proc.returncode}")

    # Force terminate
    if proc.returncode is None:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=3.0)
        except (TimeoutError, asyncio.CancelledError):
            proc.kill()
            await proc.wait()

    # Stderr
    try:
        stderr_raw = await proc.stderr.read()
        stderr_lines = stderr_raw.decode().strip().split("\n")[:20]
    except (TimeoutError, asyncio.CancelledError, Exception):
        stderr_lines = []

    # Event type summary
    event_types: dict[str, int] = {}
    for ev in events:
        etype = ev["obj"].get("type", ev["obj"].get("kind", "unknown"))
        event_types[etype] = event_types.get(etype, 0) + 1

    result = {
        "iteration": iteration,
        "pid": pid,
        "total_events": len(events),
        "auto_replies": auto_replies,
        "event_types": event_types,
        "events": events,
        "stderr_lines": stderr_lines,
        "returncode": proc.returncode,
        "exited_during": proc.returncode is not None and proc.returncode != 143,
    }

    # Print summary
    print(f"\n  {'─' * 70}")
    print(f"  ITERATION {iteration} SUMMARY")
    print(f"  {'─' * 70}")
    print(f"  Duration:          180s")
    print(f"  Total events:      {len(events)}")
    print(f"  Auto-replies sent: {auto_replies}")
    print(f"  Event types:       {event_types}")
    if events:
        print(f"  First event at:    {events[0]['ts']:.1f}s")
        print(f"  Last event at:     {events[-1]['ts']:.1f}s")
        print(f"\n  Last event:")
        last = events[-1]["obj"]
        print(f"    {json.dumps(last, default=str, indent=2)[:500]}")
    if stderr_lines:
        print(f"\n  Stderr:")
        for line in stderr_lines:
            print(f"    {line[:140]}")

    return result


async def main():
    args = parse_args()
    iterations = args.iterations

    print(f"\n{'=' * 70}")
    print(
        f"  PI --RPC STARTUP OBSERVER  ({iterations} iteration{'s' if iterations != 1 else ''}, 3 min each)"
    )
    print(f"{'=' * 70}")

    results = []
    for i in range(1, iterations + 1):
        result = await run_iteration(i)
        results.append(result)

    # Cross-iteration comparison
    if len(results) > 1:
        print(f"\n{'#' * 70}")
        print(f"#  COMPARISON")
        print(f"#{'=' * 70}")
        print(
            f"{'Iter':>4}  {'PID':>7}  {'Events':>6}  {'AutoReply':>9}  {'Types':>6}  {'Exited':>7}"
        )
        print(f"{'─' * 4}  {'─' * 7}  {'─' * 6}  {'─' * 9}  {'─' * 6}  {'─' * 7}")
        for r in results:
            exited = "yes" if r["exited_during"] else "no"
            print(
                f"{r['iteration']:>4}  {r['pid']:>7}  {r['total_events']:>6}  "
                f"{r['auto_replies']:>9}  {len(r['event_types']):>6}  {exited:>7}"
            )


if __name__ == "__main__":
    asyncio.run(main())
