import { useState, useEffect, useRef } from "react";
import type { Model } from "../types";
import { createSession, listModels } from "../services/api";
import type { ModelConfig } from "../services/api";
import { deriveModelName } from "../utils/model";

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

/** Module-level Set tracking which project paths have had sessions created.
 *  Using a module-level Set (not a ref) because React StrictMode creates
 *  separate component instances, each with their own useRef state. A ref
 *  set in one instance is invisible to the other instance. */
const sessionCreatedProjects = new Set<string>();

function getCachedModels(): Model[] | null {
	try {
		const cached = localStorage.getItem(MODELS_CACHE_KEY);
		if (!cached) return null;

		const parsed: ModelsCache = JSON.parse(cached);
		if (Date.now() - parsed.timestamp > MODELS_MAX_AGE_MS) return null;

		return parsed.models;
	} catch (e) {
		console.warn("Failed to read models cache:", e);
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
	} catch (e) {
		console.warn("Failed to write models cache:", e);
		// Continue — localStorage errors (privacy mode, quota exceeded, etc.)
		// are non-fatal; models will be fetched from the server on next load.
	}
}

interface UseModelsResult {
	models: Model[];
	loading: boolean;
	error: string | null;
	sessionId: string | null;
	runningCount: number | null;
	refresh: () => void;
}

/**
 * Fetch available models from Pi RPC.
 *
 * Flow:
 * 1. Check localStorage cache (instant, survives page reload)
 * 2. Call `/api/models` WITHOUT session → uses server-side cache (instant, no session needed)
 * 3. Create Pi RPC session for actual communication
 * 4. RPC polling as final fallback (only if steps 0-1 both failed)
 *
 * @param projectPath — optional project folder path (triggers session creation)
 * @param existingSessionId — optional existing session id to use instead of creating one
 * @returns models list, loading state, error message, and session_id for SSE connection
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
	const prevExistingSessionRef = useRef<string | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	// Track whether models were loaded in steps 0/1, so step 3 can be skipped
	const modelsLoadedRef = useRef(false);

	// Extract fetch logic into a reusable function for refresh support
	const fetchModels = async () => {
		if (!projectPath) {
			setLoading(false);
			return;
		}

		// Step 0: Check localStorage cache first (display models immediately,
		// but still continue to create a session for actual Pi communication)
		const cachedModels = getCachedModels();
		if (cachedModels && cachedModels.length > 0) {
			if (!abortControllerRef.current?.signal.aborted) {
				setModels(cachedModels);
				setLoading(false);
				modelsLoadedRef.current = true;
			}
		}

		// Step 1: Fetch models WITHOUT creating a session (skip if already loaded
		// e.g. from localStorage or during StrictMode re-mount).
		// The server serves cached models from `pi --list-models` populated at startup.
		if (!modelsLoadedRef.current) {
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
						modelsLoadedRef.current = true;
						setLoading(false);
						setError(null);
					}
				}
			} catch {
				// Server cache unavailable — ignore, will fall back to RPC polling
			}
		}

		// Step 2: Launch pi RPC session (model is set later via WS `set_model` on connect)
		// This happens regardless of whether models were already loaded.
		// We need the session for actual communication with Pi.
		let activeSessionId = existingSessionId || sessionId;
		// Use module-level Set instead of ref because React StrictMode creates
		// separate component instances, each with their own useRef state.
		const projectKey = projectPath || "";
		const alreadyHasSession = sessionCreatedProjects.has(projectKey);
		const shouldCreate = !alreadyHasSession && !existingSessionId && !sessionId;
		if (shouldCreate) {
			// Only create a session if we don't have one yet (guard against
			// StrictMode double-render and other edge cases).
			launchedRef.current = true;
			// Mark this project as having a session (module-level, persists
			// across StrictMode's separate component instances).
			sessionCreatedProjects.add(projectKey);
			try {
				const session = await createSession(projectPath!);
				activeSessionId = session.session_id;
				setSessionId(session.session_id);
				if (session.running_count !== undefined) {
					setRunningCount(session.running_count);
				}
			} catch {
				// Reset on failure so the next attempt can try again
				sessionCreatedProjects.delete(projectKey);
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

		// Step 3: RPC polling as final fallback (only if models weren't loaded in steps 0/1)
		if (modelsLoadedRef.current) {
			return; // Models already loaded, no need to poll
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
							mapped.push(mapModelConfig(m));
						}
					}
					if (!abortControllerRef.current?.signal.aborted) {
						setModels(mapped);
						setError(null);
						cacheModels(mapped); // Cache the models for next load
						setLoading(false);
						modelsLoadedRef.current = true;
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

	// Refresh function: clear cache, reset state, re-fetch
	const refresh = () => {
		localStorage.removeItem(MODELS_CACHE_KEY);
		modelsLoadedRef.current = false;
		setModels([]);
		setLoading(true);
		setError(null);
		fetchModels();
	};

	useEffect(() => {
		// Cancel any previous polling cycle (e.g. when projectPath changes)
		abortControllerRef.current?.abort();
		const abortController = new AbortController();
		abortControllerRef.current = abortController;

		const projectChanged = prevProjectRef.current !== projectPath;
		const sessionChanged = prevExistingSessionRef.current !== existingSessionId;

		// Reset launch guard when projectPath or existingSessionId changes.
		// Switching sessions without changing project must re-fetch models for
		// the new session; the old `launchedRef` would otherwise block it.
		if (projectChanged || sessionChanged) {
			launchedRef.current = false;
			// Clear the module-level set so a new project can create a session
			if (projectChanged && projectPath) {
				sessionCreatedProjects.delete(projectPath);
			}
			modelsLoadedRef.current = false;
			prevProjectRef.current = projectPath ?? null;
			prevExistingSessionRef.current = existingSessionId ?? null;
			setSessionId(null);
			setRunningCount(null);
			setModels([]);
			setLoading(true);
			setError(null);
		}

		fetchModels();

		return () => {
			abortControllerRef.current?.abort();
		};
	}, [projectPath, existingSessionId]);

	return { models, loading, error, sessionId, runningCount, refresh };
}
