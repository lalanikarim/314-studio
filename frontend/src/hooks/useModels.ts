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
 * @returns models list, loading state, error message, and session_id for WS connection
 */
export function useModels(projectPath?: string | null): UseModelsResult {
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const launchedRef = useRef(false);
	const prevProjectRef = useRef<string | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		// Cancel any previous polling cycle (e.g. when projectPath changes)
		abortControllerRef.current?.abort();
		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		// Only reset launch guard when projectPath actually changes
		if (prevProjectRef.current !== projectPath) {
			launchedRef.current = false;
			prevProjectRef.current = projectPath ?? null;
			setSessionId(null);
			setModels([]);
			setLoading(true);
			setError(null);
		}

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
					if (!abortControllerRef.current?.signal.aborted) {
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
				!abortControllerRef.current?.signal.aborted
			) {
				await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

				if (abortControllerRef.current?.signal.aborted) break;

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
						if (!abortControllerRef.current?.signal.aborted) {
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
			if (!abortControllerRef.current?.signal.aborted) {
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
			abortControllerRef.current?.abort();
		};
	}, [projectPath]);

	return { models, loading, error, sessionId };
}
