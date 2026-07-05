import type { Model } from "../types/index.js";

/** Derive a display name from provider + model id, e.g. "Anthropic – claude-sonnet-4-20250514" */
export function deriveModelName(modelId: string, provider: string): string {
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
  return `${providerName} – ${modelId}`;
}

/**
 * Extract provider from model_id. Handles two formats:
 * - Slash-separated: "anthropic/claude-sonnet-4-20250514" → "anthropic"
 * - Prefix matching: "claude-sonnet-4" → matches known providers
 * Falls back to "anthropic" if no match found.
 */
const KNOWN_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "mistral",
  "groq",
  "together",
] as const;

export function extractProvider(
  modelId: string | null | undefined,
): string {
  if (!modelId) return "";
  if (modelId.includes("/")) return modelId.split("/")[0];
  const lower = modelId.toLowerCase();
  for (const p of KNOWN_PROVIDERS) {
    if (lower.startsWith(p)) return p;
  }
  return "anthropic";
}

/**
 * Create a minimal Model object from a raw model_id and provider.
 * Used when the full model config isn't available (e.g., from session metadata).
 */
export function createMinimalModel(
  modelId: string,
  provider: string,
  nameOverride?: string,
): Model {
  return {
    id: modelId,
    name: nameOverride ?? deriveModelName(modelId, provider),
    provider,
    contextWindow: 0,
    maxTokens: 0,
  };
}
