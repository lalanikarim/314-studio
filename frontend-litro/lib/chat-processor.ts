/**
 * Message processing helpers for the ChatPanel.
 *
 * Pure functions with zero DOM/React dependencies — safely testable in
 * isolation. Ported 1:1 from the React ChatPanel component.
 */

import type {
  AgentMessage,
  ChatMessage,
  MessageContentBlock,
  ToolCallEntry,
} from "../types/chat.js";

/**
 * Convert a Pi RPC AgentMessage into a ChatMessage with content blocks.
 * Each content block (text, thinking, toolCall) becomes a separate entry
 * in the content array, preserving the original order from the RPC response.
 */
export function agentMessageToDisplay(
  msg: AgentMessage,
): ChatMessage[] {
  const role = msg.role as string;
  const timestamp =
    typeof msg.timestamp === "number" ? msg.timestamp : Date.now();

  if (role === "user") {
    let content: string;
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      const blocks = msg.content as Array<{ type?: string; text?: string }>;
      content =
        blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text || "")
          .join("\n") || "[image attachment]";
    } else {
      content = "";
    }
    return [
      {
        id: `history-user-${crypto.randomUUID()}`,
        role: "user",
        timestamp,
        content: [{ kind: "text", content }],
      },
    ];
  }

  if (role === "assistant") {
    const blocks = msg.content as
      | Array<{
          type?: string;
          text?: string;
          thinking?: string;
          name?: string;
          arguments?: unknown;
          id?: string;
        }>
      | undefined;
    if (!blocks) return [];

    const contentBlocks: MessageContentBlock[] = [];

    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;

      if (block.type === "text" && block.text) {
        contentBlocks.push({ kind: "text", content: block.text });
      } else if (block.type === "thinking" && block.thinking) {
        contentBlocks.push({ kind: "thinking", content: block.thinking });
      } else if (block.type === "toolCall") {
        const entry: ToolCallEntry = {
          id: block.id,
          name: block.name || "unknown",
        };
        if (block.arguments) {
          try {
            entry.args =
              typeof block.arguments === "string"
                ? block.arguments
                : JSON.stringify(block.arguments);
          } catch {
            entry.args = String(block.arguments);
          }
        }
        contentBlocks.push({ kind: "toolCall", ...entry });
      }
    }

    if (contentBlocks.length === 0) return [];

    return [
      {
        id: `history-assistant-${crypto.randomUUID()}`,
        role: "assistant",
        timestamp,
        content: contentBlocks,
      },
    ];
  }

  if (role === "toolResult" && msg.content) {
    let content: string;
    if (Array.isArray(msg.content)) {
      const blocks = msg.content as Array<{ type?: string; text?: string }>;
      content = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("\n");
    } else if (typeof msg.content === "string") {
      content = msg.content;
    } else {
      content = "";
    }
    if (!content) return [];

    // Attach to the matching toolCall via toolCallId — this is the canonical
    // matching key from Pi's get_messages response.
    const toolCallId = (msg.toolCallId as string) || undefined;
    const toolName = (msg.toolName as string) || "tool";
    const isError = msg.isError;
    const resultText =
      `${isError ? "(error) " : ""}\`${content.substring(0, 200)}${content.length > 200 ? "..." : ""}\``;

    return [
      {
        id: `history-tool-${crypto.randomUUID()}`,
        role: "assistant",
        timestamp,
        content: [
          {
            kind: "toolCall",
            id: toolCallId,
            name: toolName,
            result: resultText,
          },
        ],
      },
    ];
  }

  if (role === "bashExecution" && msg.command) {
    const output = (msg.output as string) || "";
    return [
      {
        id: `history-bash-${crypto.randomUUID()}`,
        role: "assistant",
        timestamp,
        content: [
          {
            kind: "text",
            content: `\`bash\` ${msg.command as string} → exit code ${msg.exitCode ?? "?"}\n\n${output.substring(0, 300)}${output.length > 300 ? "..." : ""}`,
          },
        ],
      },
    ];
  }

  return [];
}

/**
 * Extract a *streaming text chunk* from a Pi RPC event.
 *
 * Per rpc.md, `message_update` events stream content via deltas:
 *   - `text_delta`     → `assistantMessageEvent.delta` is a text chunk
 *   - `thinking_delta` → `assistantMessageEvent.delta` is a thinking chunk
 *   - `text_start` / `text_end` / `thinking_start` / `thinking_end` carry the
 *     *accumulated* `partial` state, NOT a chunk to append.
 *
 * The caller *appends* whatever this returns to `streamingContent`. Therefore
 * we MUST only return the incremental `delta` — returning the accumulated
 * `partial.content[].text` on `text_end` would re-append the full message and
 * double the displayed text.
 */
export function extractText(event: Record<string, unknown>): string {
  // Direct fields (fallback for non-message_update events)
  if (typeof event.content === "string") return event.content;
  if (typeof event.text === "string") return event.text;
  if (typeof event.message === "string") return event.message;

  const ami = event.assistantMessageEvent as
    | { type?: string; delta?: unknown }
    | undefined;
  if (!ami) return "";

  // Only true streaming chunks contribute. Everything else (start/end/done)
  // carries accumulated state and must NOT be appended.
  if (ami.type === "text_delta") {
    const delta = ami.delta;
    if (typeof delta === "string" && delta) return delta;
  }

  return "";
}

/**
 * Extract a *streaming thinking chunk* from a Pi RPC event.
 *
 * Mirrors `extractText` but only matches `thinking_delta` (not `text_delta`).
 * Thinking deltas are accumulated separately so the thinking block can be
 * rendered in a collapsible container.
 */
export function extractThinking(event: Record<string, unknown>): string {
  const ami = event.assistantMessageEvent as
    | { type?: string; delta?: unknown }
    | undefined;
  if (!ami) return "";

  if (ami.type === "thinking_delta") {
    const delta = ami.delta;
    if (typeof delta === "string" && delta) return delta;
  }

  return "";
}

/**
 * Extract a tool call entry from a Pi RPC event.
 * Returns null if the event doesn't represent a tool call.
 */
export function extractToolCall(
  event: Record<string, unknown>,
): ToolCallEntry | null {
  // Direct fields (fallback)
  if (typeof event.tool_name === "string") {
    return { name: event.tool_name, args: undefined, result: undefined };
  }
  if (typeof event.command === "string") {
    return { name: event.command, args: undefined, result: undefined };
  }
  if (typeof event.function === "string") {
    return { name: event.function, args: undefined, result: undefined };
  }

  const ami = event.assistantMessageEvent as
    | {
        type?: string;
        id?: string;
        toolCall?: { id?: string; name?: unknown; arguments?: unknown };
        result?: { output?: unknown };
      }
    | undefined;
  if (ami) {
    const deltaType = ami.type;

    // toolcall_delta: toolCall.name + toolCall.arguments + toolCall.id
    if (deltaType === "toolcall_delta" || deltaType === "toolcall_end") {
      if (ami.toolCall) {
        const toolCallId = ami.toolCall.id || ami.id;
        const entry: ToolCallEntry = {
          id: toolCallId,
          name: "",
          args: undefined,
          result: undefined,
        };
        if (typeof ami.toolCall.name === "string" && ami.toolCall.name) {
          entry.name = ami.toolCall.name;
        }
        if (ami.toolCall.arguments) {
          try {
            entry.args =
              typeof ami.toolCall.arguments === "string"
                ? ami.toolCall.arguments
                : JSON.stringify(ami.toolCall.arguments);
          } catch {
            entry.args = String(ami.toolCall.arguments);
          }
        }
        return entry;
      }
    }

    // toolcall_result: capture result output + toolCallId for matching
    if (
      deltaType === "toolcall_result" &&
      ami.result?.output !== undefined
    ) {
      const toolCallId = ami.toolCall?.id || ami.id;
      return {
        id: toolCallId,
        name: (event._toolName as string) || "unknown",
        args: undefined,
        result:
          typeof ami.result.output === "string"
            ? ami.result.output
            : JSON.stringify(ami.result.output),
      };
    }
  }

  return null;
}

/**
 * Check if an event is a stream finalizer (end_turn, agent_end, turn_end, etc.).
 * These signal the end of a streaming turn.
 */
export function isStreamFinalizer(event: Record<string, unknown>): boolean {
  if (event.type === "end_turn" || event.type === "end") return true;
  if (event.type === "agent_end") return true;
  if (event.type === "turn_end") return true;
  if (event.status === "done" || event.status === "finished") return true;
  if (event.type === "response" && event.id) return true;
  return false;
}
