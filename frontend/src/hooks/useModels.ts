import { useState, useEffect, useRef } from "react";
import type { Model } from "../types";
import { createSession, listModels } from "../services/api";

/** Derive a display name from provider + model id, e.g. "Anthropic – claude-sonnet-4-20250514" */
function deriveModelName(modelId: string, provider: string): string {
	const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
	return `${providerName} – ${modelId}`;
}

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
	const prevProjectRef = useRef<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		// Cancel any previous polling cycle (e.g. when selectedModel changes)
		abortRef.current?.abort();
		const abortController = new AbortController();
		abortRef.current = abortController;
		cancelledRef.current = false;

		// Only reset launch guard when projectPath actually changes
		if (prevProjectRef.current !== projectPath) {
			launchedRef.current = false;
			prevProjectRef.current = projectPath ?? null;
			setSessionId(null);
			setModels([]);
			setLoading(true);
			setError(null);
		}

		let timer: ReturnType<typeof setTimeout>;

		const run = async () => {
			if (!projectPath) {
				// No project selected — nothing to load
				setLoading(false);
				return;
			}

			// Step 1: Launch pi RPC session (model is set later via WS `set_model` on connect)
			let activeSessionId = sessionId;
			if (!launchedRef.current) {
				launchedRef.current = true;
				try {
					const session = await createSession(projectPath);
					activeSessionId = session.session_id;
					setSessionId(session.session_id);
				} catch {
					if (!cancelledRef.current) {
						setError("Failed to connect to Pi. Could not fetch models.");
						setLoading(false);
					}
					return;
				}
			}

			if (!activeSessionId) {
				setLoading(false);
				return;
			}

			// Step 2: Poll for real models from Pi (via session)
			const deadline = Date.now() + PI_INIT_TIMEOUT_MS;
			while (
				Date.now() < deadline &&
				!cancelledRef.current &&
				!abortController.signal.aborted
			) {
				timer = setTimeout(() => {}, 0);
				await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

				if (cancelledRef.current || abortController.signal.aborted) break;

				try {
					const resp = await listModels(activeSessionId!);
					if (resp && resp.length > 0) {
						const mapped: Model[] = resp.map((m) => ({
							id: m.id,
							name: deriveModelName(m.id, m.provider),
							provider: m.provider,
							contextWindow: m.contextWindow || 0,
							maxTokens: m.maxTokens || 0,
						}));
						if (!cancelledRef.current && !abortController.signal.aborted) {
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

			// Timeout reached — no models available
			if (!cancelledRef.current && !abortController.signal.aborted) {
				if (!error) {
					setError(
						"Timed out waiting for Pi to initialize. No models available.",
					);
				}
				setLoading(false);
			}
		};

		run();

		return () => {
			cancelledRef.current = true;
			abortController.abort();
			if (timer) clearTimeout(timer);
		};
	}, [projectPath, selectedModel]);

	return { models, loading, error, sessionId };
}
