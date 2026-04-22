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

interface ModelsCache {
	models: Model[];
	timestamp: number;
}

const MODELS_CACHE_KEY = "pi_models_cache";
const MODELS_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function getCachedModels(): Model[] | null {
	try {
		const cached = localStorage.getItem(MODELS_CACHE_KEY);
		if (!cached) return null;

		const parsed: ModelsCache = JSON.parse(cached);
		if (Date.now() - parsed.timestamp > MODELS_MAX_AGE_MS) return null;

		return parsed.models;
	} catch {
		return null;
	}
}

function cacheModels(models: Model[]) {
	try {
		const cache: ModelsCache = {
			models,
			timestamp: Date.now(),
		};
		localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// Ignore localStorage errors (privacy mode, quota exceeded, etc.)
	}
}

interface UseModelsResult {
	models: Model[];
	loading: boolean;
	error: string | null;
	sessionId: string | null;
	runningCount: number | null;
}

/**
 * Fetch available models from Pi RPC.
 *
 * Flow:
 * 1. If projectPath is provided, create a Pi RPC session (unless existingSessionId is provided)
 * 2. Poll `/api/models?session_id=...` until models arrive or timeout
 * 3. Fall back to defaults on error or timeout
 *
 * @param projectPath — optional project folder path (triggers session creation)
 * @param existingSessionId — optional existing session id to use instead of creating one
 * @returns models list, loading state, error message, and session_id for WS connection
 */
export function useModels(
	projectPath?: string | null,
	existingSessionId?: string | null,
): UseModelsResult {
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [runningCount, setRunningCount] = useState<number | null>(null);
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
			setRunningCount(null);
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

			// Step 0: Check cache first
			const cachedModels = getCachedModels();
			let useCache = false;
			if (cachedModels && cachedModels.length > 0) {
				if (!abortControllerRef.current?.signal.aborted) {
					setModels(cachedModels);
					setLoading(false);
					useCache = true;
				}
			}

			// Step 1: Launch pi RPC session (model is set later via WS `set_model` on connect)
			let activeSessionId = existingSessionId || sessionId;
			if (!launchedRef.current && !existingSessionId) {
				launchedRef.current = true;
				try {
					const session = await createSession(projectPath!);
					activeSessionId = session.session_id;
					setSessionId(session.session_id);
					if (session.running_count !== undefined) {
						setRunningCount(session.running_count);
					}
				} catch {
					if (!abortControllerRef.current?.signal.aborted) {
						setError("Failed to connect to Pi. Could not fetch models.");
						setLoading(false);
					}
					return;
				}
			} else if (existingSessionId) {
				launchedRef.current = true;
				activeSessionId = existingSessionId;
			}

			if (!activeSessionId) {
				setLoading(false);
				return;
			}

			// Step 2: Poll for real models from Pi (via session)
			// Skip polling if we already have cached models
			if (useCache) {
				return;
			}
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
						// Deduplicate by provider:id composite key
						const seen = new Set<string>();
						const mapped: Model[] = [];
						for (const m of resp) {
							const key = `${m.provider}:${m.id}`;
							if (!seen.has(key)) {
								seen.add(key);
								mapped.push({
									id: m.id,
									name: deriveModelName(m.id, m.provider),
									provider: m.provider,
									contextWindow: m.contextWindow || 0,
									maxTokens: m.maxTokens || 0,
								});
							}
						}
						if (!abortControllerRef.current?.signal.aborted) {
							setModels(mapped);
							setError(null);
							cacheModels(mapped); // Cache the models for next load
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

	return { models, loading, error, sessionId, runningCount };
}
