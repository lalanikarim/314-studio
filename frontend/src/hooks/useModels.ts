import { useState, useEffect, useRef } from "react";
import type { Model } from "../types";
import { createSession, listModels } from "../services/api";
import type { ModelConfig } from "../services/api";

/** Derive a display name from provider + model id, e.g. "Anthropic – claude-sonnet-4-20250514" */
function deriveModelName(modelId: string, provider: string): string {
	const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
	return `${providerName} – ${modelId}`;
}

/** Convert a ModelConfig into the frontend Model type */
function mapModelConfig(config: ModelConfig): Model {
	return {
		id: config.id,
		name: deriveModelName(config.id, config.provider),
		provider: config.provider,
		contextWindow: config.contextWindow ?? 0,
		maxTokens: config.maxTokens ?? 0,
	};
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
 * 1. Check localStorage cache (instant, survives page reload)
 * 2. Call `/api/models` WITHOUT session → uses server-side cache (instant, no session needed)
 * 3. Create Pi RPC session + WebSocket for actual communication
 * 4. RPC polling as final fallback (cache may be stale)
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

			// Step 0: Check localStorage cache first
			const cachedModels = getCachedModels();
			if (cachedModels && cachedModels.length > 0) {
				if (!abortControllerRef.current?.signal.aborted) {
					setModels(cachedModels);
					setLoading(false);
					return; // ✅ immediate — no session needed
				}
			}

			// Step 1: Fetch models WITHOUT creating a session.
			// The server serves cached models from `pi --list-models` populated at startup.
			// This is instant — no subprocess, no session required.
			try {
				const serverModels = await listModels(); // no session_id → uses cache
				if (
					serverModels &&
					serverModels.length > 0 &&
					!abortControllerRef.current?.signal.aborted
				) {
					// Deduplicate by provider:id composite key
					const seen = new Set<string>();
					const mapped: Model[] = [];
					for (const m of serverModels) {
						const key = `${m.provider}:${m.id}`;
						if (!seen.has(key)) {
							seen.add(key);
							mapped.push(mapModelConfig(m));
						}
					}
					if (!abortControllerRef.current?.signal.aborted) {
						setModels(mapped);
						cacheModels(mapped);
						setLoading(false);
						setError(null);
					}
				}
			} catch {
				// Server cache unavailable — ignore, will fall back to RPC
			}

			// Step 2: Launch pi RPC session (model is set later via WS `set_model` on connect)
			// This happens regardless of whether models were already loaded.
			// We need the session for actual communication with Pi.
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
						setError("Failed to connect to Pi. No models available.");
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

			// Step 3: RPC polling as final fallback (use cached models if available)
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
								mapped.push(mapModelConfig(m));
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
