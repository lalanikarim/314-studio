/**
 * Message processing helpers for the ChatPanel.
 *
 * Pure functions with zero DOM dependencies — safely testable in isolation.
 *
 * Each function extracts ONE specific piece of data from an RPC event,
 * returning either the extracted value or a sentinel (null / "" / false).
 * The component assembles these into display state.
 */

import type {
  AgentMessage,
  ChatMessage,
  MessageContentBlock,
  ToolCallEntry,
} from "../types/chat.js";

// ============================================================================
// History: AgentMessage → ChatMessage
// ============================================================================

/**
 * Convert a Pi RPC AgentMessage into ChatMessage(s) for display.
 * Used for hydrating history from get_messages / agent_end messages.
 */
export function agentMessageToDisplay(msg: AgentMessage): ChatMessage[] {
  const role = msg.role as string;
  const timestamp =
    typeof msg.timestamp === "number" ? msg.timestamp : Date.now();

  if (role === "user") {
    const content = extractUserContent(msg);
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
    return buildAssistantBlocks(msg, timestamp);
  }

  if (role === "toolResult" && msg.content) {
    return buildToolResultBlock(msg);
  }

  if (role === "bashExecution" && msg.command) {
    return buildBashBlock(msg);
  }

  return [];
}

// ============================================================================
// Streaming: Delta extraction from assistantMessageEvent
// ============================================================================

/**
 * Extract text content from a streaming event.
 *
 * IMPORTANT: The `delta` field in text_delta events contains the LAST WORD/
 * PHRASE ADDED, NOT the incremental text chunk. Accumulating deltas produces
 * gibberish. Instead, we read the accumulated text from `partial.content[contentIndex].text`.
 *
 * This function returns the FULL accumulated text for the content block,
 * not just the delta. The component should REPLACE its accumulator with
 * this value, not append to it.
 */
export function extractText(event: Record<string, unknown>): string | null {
  const ami = getAssistantMessageEvent(event);
  if (!ami) return null;
  if (ami.type !== "text_delta") return null;

  // The `partial` field is inside `assistantMessageEvent`, not at the top level.
  // Structure: event.assistantMessageEvent.partial.content[contentIndex].text
  const partial = ami.partial as { content?: Array<{ text?: string }> } | undefined;
  if (partial?.content && ami.contentIndex !== undefined) {
    const textBlock = partial.content[ami.contentIndex];
    if (textBlock?.text) {
      return textBlock.text;
    }
  }

  // Fallback: try delta (only for initial text_start events)
  const delta = ami.delta;
  return typeof delta === "string" && delta ? delta : null;
}

/**
 * Extract thinking content from a streaming event.
 *
 * Same issue as extractText: delta contains the last phrase, not incremental.
 * Read from partial.content[contentIndex].thinking (authoritative).
 */
export function extractThinking(event: Record<string, unknown>): string | null {
  const ami = getAssistantMessageEvent(event);
  if (!ami) return null;
  if (ami.type !== "thinking_delta") return null;

  // The `partial` field is inside `assistantMessageEvent`, not at the top level.
  // Structure: event.assistantMessageEvent.partial.content[contentIndex].thinking
  const partial = ami.partial as { content?: Array<{ thinking?: string }> } | undefined;
  if (partial?.content && ami.contentIndex !== undefined) {
    const thinkingBlock = partial.content[ami.contentIndex];
    if (thinkingBlock?.thinking) {
      return thinkingBlock.thinking;
    }
  }

  // Fallback: try delta
  const delta = ami.delta;
  return typeof delta === "string" && delta ? delta : null;
}

/**
 * Extract an incremental tool call args chunk.
 *
 * Only `toolcall_delta` carries incremental args.
 * `toolcall_end` carries the FULL toolCall object — use extractToolCallEnd()
 * for that instead to avoid duplication.
 */
export function extractToolCallDelta(
  event: Record<string, unknown>,
): ToolCallEntry | null {
  const ami = getAssistantMessageEvent(event);
  if (!ami) return null;
  if (ami.type !== "toolcall_delta") return null;
  return buildToolCallEntryFromAmi(ami);
}

/**
 * Extract the FULL tool call object from a `toolcall_end` event.
 *
 * Per Pi RPC docs, `toolcall_end` carries the complete `toolCall` object
 * with name, arguments, and id — NOT a delta. Use this to set the complete
 * tool call entry, not to accumulate.
 */
export function extractToolCallEnd(
  event: Record<string, unknown>,
): ToolCallEntry | null {
  const ami = getAssistantMessageEvent(event);
  if (!ami) return null;
  if (ami.type !== "toolcall_end") return null;
  if (!ami.toolCall) return null;
  return buildToolCallEntryFromToolCall(ami.toolCall, ami.id);
}

/**
 * Extract a tool call result from a streaming event.
 *
 * Handles two sources:
 * 1. `assistantMessageEvent.type === "toolcall_result"` with `ami.result.output`
 * 2. `tool_execution_end` events with `result.content[]`
 */
export function extractToolCallResult(
  event: Record<string, unknown>,
): { id?: string; result: string } | null {
  // Source 1: assistantMessageEvent toolcall_result
  const ami = getAssistantMessageEvent(event);
  if (ami && ami.type === "toolcall_result" && ami.result?.output !== undefined) {
    const toolCallId = ami.toolCall?.id || ami.id;
    const output =
      typeof ami.result.output === "string"
        ? ami.result.output
        : JSON.stringify(ami.result.output);
    return { id: toolCallId, result: output };
  }

  // Source 2: tool_execution_end
  if (event.type === "tool_execution_end") {
    const result = event.result as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined;
    if (result?.content) {
      const text = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("\n");
      return {
        id: (event.toolCallId as string) || undefined,
        result: text,
      };
    }
  }

  return null;
}

/**
 * Extract tool execution progress update.
 *
 * Per Pi RPC docs: `tool_execution_update` carries ACCUMULATED output
 * (not deltas), so clients should replace their display on each update.
 */
export function extractToolExecutionUpdate(
  event: Record<string, unknown>,
): { id: string; partialText: string } | null {
  if (event.type !== "tool_execution_update") return null;

  const partial = event.partialResult as
    | { content?: Array<{ type?: string; text?: string }> }
    | undefined;
  if (!partial?.content) return null;

  const text = partial.content
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("\n");

  return {
    id: (event.toolCallId as string) || "",
    partialText: text,
  };
}

// ============================================================================
// Event classification predicates
// ============================================================================

/** Whether this event is `message_end` (authoritative message checkpoint) */
export function isMessageEnd(event: Record<string, unknown>): boolean {
  return event.type === "message_end";
}

/** Whether this event is `turn_end` (turn completed) */
export function isTurnEnd(event: Record<string, unknown>): boolean {
  return event.type === "turn_end";
}

/** Whether this event is `agent_end` (agent completed all turns) */
export function isAgentEnd(event: Record<string, unknown>): boolean {
  return event.type === "agent_end";
}

/**
 * Whether the assistantMessageEvent signals message completion.
 * `done` = generation finished normally (stop/length/toolUse).
 * `error` = generation failed (aborted/error).
 */
export function isMessageTerminal(event: Record<string, unknown>): boolean {
  const ami = getAssistantMessageEvent(event);
  if (!ami) return false;
  return ami.type === "done" || ami.type === "error";
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Get the assistantMessageEvent payload from a streaming event.
 * Returns null if the event is not a streaming update with ami data.
 */
function getAssistantMessageEvent(
  event: Record<string, unknown>,
): {
  type: string;
  delta?: unknown;
  partial?: {
    content?: Array<{
      text?: string;
      thinking?: string;
    }>;
  };
  toolCall?: {
    id?: string;
    name?: unknown;
    arguments?: unknown;
  };
  result?: { output?: unknown };
  id?: string;
} | null {
  const ami = event.assistantMessageEvent;
  if (!ami || typeof ami !== "object") return null;
  return ami as {
    type: string;
    delta?: unknown;
    partial?: {
      content?: Array<{
        text?: string;
        thinking?: string;
      }>;
    };
    toolCall?: {
      id?: string;
      name?: unknown;
      arguments?: unknown;
    };
    result?: { output?: unknown };
    id?: string;
  };
}

function buildToolCallEntryFromAmi(
  ami: ReturnType<typeof getAssistantMessageEvent>,
): ToolCallEntry | null {
  if (!ami || !ami.toolCall) return null;
  return buildToolCallEntryFromToolCall(ami.toolCall, ami.id);
}

function buildToolCallEntryFromToolCall(
  toolCall: { id?: string; name?: unknown; arguments?: unknown },
  amiId?: string,
): ToolCallEntry {
  const entry: ToolCallEntry = {
    id: toolCall.id || amiId || undefined,
    name: "",
  };
  if (typeof toolCall.name === "string" && toolCall.name) {
    entry.name = toolCall.name;
  }
  if (toolCall.arguments) {
    try {
      entry.args =
        typeof toolCall.arguments === "string"
          ? toolCall.arguments
          : JSON.stringify(toolCall.arguments);
    } catch {
      entry.args = String(toolCall.arguments);
    }
  }
  return entry;
}

// ============================================================================
// History building helpers
// ============================================================================

function extractUserContent(msg: AgentMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    const blocks = msg.content as Array<{ type?: string; text?: string }>;
    return (
      blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n") ||
      "[image attachment]"
    );
  }
  return "";
}

function buildAssistantBlocks(
  msg: AgentMessage,
  timestamp: number,
): ChatMessage[] {
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
      contentBlocks.push({
        kind: "toolCall",
        id: block.id,
        name: block.name || "unknown",
        args: block.arguments
          ? safeStringify(block.arguments)
          : undefined,
      });
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

function buildToolResultBlock(msg: AgentMessage): ChatMessage[] {
  const content =
    Array.isArray(msg.content)
      ? (msg.content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === "text")
          .map((b) => b.text || "")
          .join("\n")
      : typeof msg.content === "string"
        ? msg.content
        : "";

  if (!content) return [];

  const toolCallId = (msg.toolCallId as string) || undefined;
  const toolName = (msg.toolName as string) || "tool";
  const isError = msg.isError;
  const resultText =
    `${isError ? "(error) " : ""}\`${content.substring(0, 200)}${content.length > 200 ? "..." : ""}\``;

  return [
    {
      id: `history-tool-${crypto.randomUUID()}`,
      role: "assistant",
      timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
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

function buildBashBlock(msg: AgentMessage): ChatMessage[] {
  const output = (msg.output as string) || "";
  return [
    {
      id: `history-bash-${crypto.randomUUID()}`,
      role: "assistant",
      timestamp: typeof msg.timestamp === "number" ? msg.timestamp : Date.now(),
      content: [
        {
          kind: "text",
          content: `\`bash\` ${msg.command as string} → exit code ${msg.exitCode ?? "?"}\n\n${output.substring(0, 300)}${output.length > 300 ? "..." : ""}`,
        },
      ],
    },
  ];
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
