# RPC Session Shutdown

## Overview

Pi's RPC mode (`pi --mode rpc`) has **no built-in `quit`, `exit`, or `shutdown` command** in its JSON stdin/stdout protocol. The process is designed to stay alive indefinitely until it receives an external signal.

This document describes how to properly shut down a running RPC session.

## How RPC Mode Stays Alive

The RPC mode loop runs an infinite promise:

```js
// Keep process alive forever
return new Promise(() => {});
```

It listens for commands on stdin and streams events on stdout. The process will not exit on its own.

## Shutdown Mechanisms

Shutdown is only triggered by three external mechanisms:

### 1. Stdin EOF (Preferred)

Closing stdin sends an EOF to the process, which fires the `"end"` event and triggers the shutdown sequence:

```js
process.stdin.on("end", onInputEnd);  // calls shutdown()
```

This is the **recommended approach** — it allows Pi to run its `runtimeHost.dispose()` cleanup, unsubscribe from events, and exit cleanly.

### 2. Signal Handlers

SIGTERM and SIGHUP (non-Windows) trigger shutdown:

```js
process.on("SIGTERM", handler);  // exit code 143
process.on("SIGHUP", handler);   // exit code 129
```

### 3. Extension Shutdown Handler

An extension can set `shutdownRequested = true`, which is checked after each command. This is used internally for extension-initiated shutdowns.

## The Shutdown Sequence

```
shutdown(exitCode = 0)
  ├─ mark shuttingDown = true
  ├─ run all signal cleanup handlers
  ├─ unsubscribe from session events
  ├─ runtimeHost.dispose()     ← clean up session, free resources
  ├─ detachInput()             ← stop reading stdin
  ├─ process.stdin.pause()
  └─ process.exit(exitCode)
```

## Proper Shutdown Sequence

To cleanly shut down an RPC session, send commands then close stdin:

### Step 1: Compact (optional)

```json
{"type": "compact"}
```

This summarizes the conversation history to reduce token usage. A 60s timeout is recommended; if Pi doesn't respond, proceed without it.

### Step 2: Abort

```json
{"type": "abort"}
```

This cancels any in-progress turn (agent work, tool calls). If nothing is running, it returns success immediately.

### Step 3: Close stdin (triggers shutdown)

Close the stdin write end. This sends EOF, which triggers the shutdown sequence described above.

## Python Example

```python
import subprocess
import json

proc = subprocess.Popen(
    ["pi", "--mode", "rpc"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    text=True
)

def send(cmd):
    proc.stdin.write(json.dumps(cmd) + "\n")
    proc.stdin.flush()

# Shutdown sequence
send({"type": "compact"})
send({"type": "abort"})
proc.stdin.close()  # EOF → triggers shutdown()
exit_code = proc.wait()  # wait for clean exit
print(f"Exited with code {exit_code}")
```

## Node.js Example

```javascript
const { spawn } = require("child_process");
const agent = spawn("pi", ["--mode", "rpc"]);

function send(cmd) {
    agent.stdin.write(JSON.stringify(cmd) + "\n");
}

// Shutdown sequence
send({ type: "compact" });
send({ type: "abort" });
agent.stdin.end();  // EOF → triggers shutdown()
```

## What NOT to Do

### Don't just send `abort` and wait for process exit

```python
# ❌ WRONG — process will never exit on its own
send({"type": "abort"})
proc.wait(timeout=5)  # blocks, process still alive
proc.kill()            # force kill (not clean)
```

The process does not exit after `abort`. Without closing stdin or sending a signal, `wait()` will always time out, forcing a `kill()`.

### Don't rely on `abort` for cleanup

`abort` only cancels the current agent turn. It does not:
- Close stdin
- Run `runtimeHost.dispose()`
- Trigger the shutdown sequence

## Summary

| Mechanism | Command | Effect |
|-----------|---------|--------|
| **Stdin EOF** | Close stdin | Clean shutdown (recommended) |
| SIGTERM/SIGHUP | — | Signal-based shutdown |
| `compact` | `{"type": "compact"}` | Summarize conversation |
| `abort` | `{"type": "abort"}` | Cancel current turn |

**The correct sequence is: compact → abort → close stdin.**
