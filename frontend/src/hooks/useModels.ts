import { useState, useEffect, useRef } from 'react';
import type { Model } from '../types';
import { listModels, createSession } from '../services/api';

/** Derive a display name from provider + model id, e.g. "Anthropic – claude-sonnet-4-20250514" */
function deriveModelName(modelId: string, provider: string): string {
  const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
  return `${providerName} – ${modelId}`;
}

const DEFAULT_MODELS: Model[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Anthropic – claude-sonnet-4-20250514', provider: 'anthropic', contextWindow: 200000, maxTokens: 16384 },
  { id: 'gpt-4.1', name: 'Openai – gpt-4.1', provider: 'openai', contextWindow: 131072, maxTokens: 16384 },
  { id: 'deepseek-coder', name: 'Deepseek – deepseek-coder', provider: 'deepseek', contextWindow: 65536, maxTokens: 16384 },
];

const PI_INIT_TIMEOUT_MS = 15_000; // wait up to 15s for pi to initialize
const POLL_INTERVAL_MS = 1500;     // poll every 1.5s

export function useModels(projectName?: string | null) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const launchedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    launchedRef.current = false;

    let timer: ReturnType<typeof setTimeout>;

    const run = async () => {
      if (!projectName) {
        if (!cancelledRef.current) {
          setModels([]);
          setLoading(false);
        }
        return;
      }

      // Step 1: Launch pi RPC session if not already done
      if (!launchedRef.current) {
        launchedRef.current = true;
        try {
          await createSession(projectName);
        } catch {
          // Session creation failed — still show defaults with an error
          if (!cancelledRef.current) {
            setError('Failed to connect to Pi. Showing fallback models.');
            setModels(DEFAULT_MODELS);
            setLoading(false);
          }
          return;
        }
      }

      // Step 2: Poll for real models from Pi
      const deadline = Date.now() + PI_INIT_TIMEOUT_MS;
      while (Date.now() < deadline && !cancelledRef.current) {
        // Wait a tick before first poll (pi needs ~1-2s to start)
        timer = setTimeout(() => {}, 0);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        if (cancelledRef.current) break;

        try {
          const resp = await listModels(projectName);
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
  }, [projectName]);

  return { models, loading, error };
}
