/**
 * Message processing helpers for the ChatPanel.
 *
 * Pure functions with zero DOM/React dependencies — safely testable in
 * isolation. Ported 1:1 from the React ChatPanel component.
 */

import type {
  AgentMessage,
  DisplayMessage,
  ToolCallEntry,
} from "../types/chat.js";

/**
 * Convert a Pi RPC AgentMessage into a DisplayMessage for rendering.
 * Handles user, assistant, tool result, and bash execution messages.
 */
export function agentMessageToDisplay(
  msg: AgentMessage,
): DisplayMessage | null {
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
    return {
      id: `history-user-${crypto.randomUUID()}`,
      role: "user",
      content,
      toolCalls: [],
      timestamp,
    };
  }

  if (role === "assistant") {
    const blocks = msg.content as
      | Array<{
          type?: string;
          text?: string;
          thinking?: string;
          name?: string;
          arguments?: unknown;
        }>
      | undefined;
    if (!blocks) return null;
    const textParts: string[] = [];
    const toolCalls: ToolCallEntry[] = [];
    const thinkingParts: string[] = [];
    for (const block of blocks) {
      if (typeof block !== "object" || block === null) continue;
      if (block.type === "text" && block.text) textParts.push(block.text);
      else if (block.type === "thinking" && block.thinking)
        thinkingParts.push(
          "[thinking] " + block.thinking.substring(0, 120) + "...",
        );
      else if (block.type === "toolCall") {
        const entry: ToolCallEntry = { name: block.name || "unknown" };
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
        toolCalls.push(entry);
      }
    }
    const content = [thinkingParts.join("\n"), textParts.join("\n")]
      .filter(Boolean)
      .join("\n\n");
    if (!content && toolCalls.length === 0) return null;
    return {
      id: `history-assistant-${crypto.randomUUID()}`,
      role: "assistant",
      content,
      toolCalls,
      timestamp,
    };
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
    if (!content) return null;
    const toolName = (msg.toolName as string) || "tool";
    const isError = msg.isError;
    return {
      id: `history-tool-${crypto.randomUUID()}`,
      role: "assistant",
      content: `> ${toolName}${isError ? " (error)" : ""}\n\n\`${content.substring(0, 200)}${content.length > 200 ? "..." : ""}\``,
      toolCalls: [],
      timestamp,
    };
  }

  if (role === "bashExecution" && msg.command) {
    const output = (msg.output as string) || "";
    return {
      id: `history-bash-${crypto.randomUUID()}`,
      role: "assistant",
      content: `\`bash\` ${msg.command as string} → exit code ${msg.exitCode ?? "?"}\n\n${output.substring(0, 300)}${output.length > 300 ? "..." : ""}`,
      toolCalls: [],
      timestamp,
    };
  }

  return null;
}

/**
 * Extract streaming text content from a Pi RPC event.
 *
 * Per the official RPC protocol, message_update events contain:
 *   event.assistantMessageEvent.delta    — streaming text chunk
 *   event.assistantMessageEvent.partial.content[0].text — accumulated text
 */
export function extractText(event: Record<string, unknown>): string {
  // Direct fields (fallback for non-message_update events)
  if (typeof event.content === "string") return event.content;
  if (typeof event.text === "string") return event.text;
  if (typeof event.message === "string") return event.message;

  const ami = event.assistantMessageEvent as
    | {
        type?: string;
        delta?: unknown;
        partial?: { content?: unknown[] };
      }
    | undefined;
  if (ami) {
    const deltaType = ami.type;

    // text_delta: single chunk in delta field
    if (deltaType === "text_delta") {
      const delta = ami.delta;
      if (typeof delta === "string" && delta) return delta;
    }

    // text_start / other: accumulated in partial.content[0].text
    const partial = ami.partial;
    if (partial) {
      const content = partial.content;
      if (Array.isArray(content) && content.length > 0) {
        const first = content[0];
        if (
          typeof first === "object" &&
          first !== null &&
          "text" in first
        ) {
          const text = (first as { text: unknown }).text;
          if (typeof text === "string" && text) return text;
        }
      }
    }
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
        toolCall?: { name?: unknown; arguments?: unknown };
        result?: { output?: unknown };
      }
    | undefined;
  if (ami) {
    const deltaType = ami.type;

    // toolcall_delta: toolCall.name + toolCall.arguments
    if (deltaType === "toolcall_delta" || deltaType === "toolcall_end") {
      if (ami.toolCall) {
        const entry: ToolCallEntry = {
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

    // toolcall_result: capture result output
    if (
      deltaType === "toolcall_result" &&
      ami.result?.output !== undefined
    ) {
      return {
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
