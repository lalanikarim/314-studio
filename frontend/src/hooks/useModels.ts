import { useState, useEffect, useRef } from "react";
import type { Model } from "../types";
import { createSession, listModels } from "../services/api";

/** Derive a display name from provider + model id, e.g. "Anthropic – claude-sonnet-4-20250514" */
function deriveModelName(modelId: string, provider: string): string {
	const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
	return `${providerName} – ${modelId}`;
}

const DEFAULT_MODELS: Model[] = [
	{
		id: "claude-sonnet-4-20250514",
		name: "Anthropic – claude-sonnet-4-20250514",
		provider: "anthropic",
		contextWindow: 200000,
		maxTokens: 16384,
	},
	{
		id: "gpt-4.1",
		name: "Openai – gpt-4.1",
		provider: "openai",
		contextWindow: 131072,
		maxTokens: 16384,
	},
	{
		id: "deepseek-coder",
		name: "Deepseek – deepseek-coder",
		provider: "deepseek",
		contextWindow: 65536,
		maxTokens: 16384,
	},
];

const PI_INIT_TIMEOUT_MS = 15_000; // wait up to 15s for pi to initialize
const POLL_INTERVAL_MS = 1500; // poll every 1.5s

interface UseModelsResult {
	models: Model[];
	loading: boolean;
	error: string | null;
	sessionId: string | null;
}

/**
 * Fetch available models from Pi RPC.
 *
 * Flow:
 * 1. If projectPath is provided, create a Pi RPC session
 * 2. Poll `/api/models?session_id=...` until models arrive or timeout
 * 3. Fall back to defaults on error or timeout
 *
 * @param projectPath — optional project folder path (triggers session creation)
 * @param selectedModel — optional model to use for session (defaults to first default)
 * @returns models list, loading state, error message, and session_id for WS connection
 */
export function useModels(
	projectPath?: string | null,
	selectedModel?: Model | null,
): UseModelsResult {
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const launchedRef = useRef(false);
	const cancelledRef = useRef(false);

	useEffect(() => {
		cancelledRef.current = false;
		launchedRef.current = false;

		let timer: ReturnType<typeof setTimeout>;

		const run = async () => {
			if (!projectPath) {
				// No project selected — just show defaults (e.g. in ChatPanel)
				setModels(DEFAULT_MODELS);
				setLoading(false);
				return;
			}

			// Step 1: Launch pi RPC session if not already done
			if (!launchedRef.current) {
				launchedRef.current = true;
				try {
					const modelId = selectedModel?.id || DEFAULT_MODELS[0].id;
					const session = await createSession(projectPath, modelId);
					setSessionId(session.session_id);
				} catch {
					if (!cancelledRef.current) {
						setError("Failed to connect to Pi. Showing fallback models.");
						setModels(DEFAULT_MODELS);
						setLoading(false);
					}
					return;
				}
			}

			if (!sessionId) {
				setLoading(false);
				return;
			}

			// Step 2: Poll for real models from Pi (via session)
			const deadline = Date.now() + PI_INIT_TIMEOUT_MS;
			while (Date.now() < deadline && !cancelledRef.current) {
				timer = setTimeout(() => {}, 0);
				await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

				if (cancelledRef.current) break;

				try {
					const resp = await listModels(sessionId);
					if (resp && resp.length > 0) {
						const mapped: Model[] = resp.map((m) => ({
							id: m.id,
							name: deriveModelName(m.id, m.provider),
							provider: m.provider,
							contextWindow: m.contextWindow || 0,
							maxTokens: m.maxTokens || 0,
						}));
						if (!cancelledRef.current) {
							setModels(mapped);
							setError(null);
							setLoading(false);
							return; // done
						}
					}
				} catch {
					// Ignore transient errors during polling
				}
			}

			// Timeout reached — fall back to defaults
			if (!cancelledRef.current) {
				setModels(DEFAULT_MODELS);
				setLoading(false);
			}
		};

		run();

		return () => {
			cancelledRef.current = true;
			if (timer) clearTimeout(timer);
		};
	}, [projectPath, selectedModel, sessionId]);

	return { models, loading, error, sessionId };
}
