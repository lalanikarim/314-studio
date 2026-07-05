const API_BASE = '/api';

export interface DirNode {
  path: string;
  name: string;
  isDirectory: boolean;
}

/** Browse a directory tree (defaults to ~/Projects root). */
export async function browseDirectories(path = ''): Promise<DirNode[]> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  const resp = await fetch(`${API_BASE}/browse${qs}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** Back-compat alias used by the FolderSelector page. */
export async function fetchFolders(): Promise<DirNode[]> {
  return browseDirectories('');
}

export async function fetchProjectInfo(projectPath: string) {
  const resp = await fetch(`${API_BASE}/projects/info?project_path=${encodeURIComponent(projectPath)}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createSession(projectPath: string, modelId?: string, name?: string) {
  const body: Record<string, string> = {};
  if (modelId) body.model_id = modelId;
  if (name) body.name = name;
  const resp = await fetch(
    `${API_BASE}/projects/?project_path=${encodeURIComponent(projectPath)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function closeSession(sessionId: string) {
  const resp = await fetch(`${API_BASE}/projects/${sessionId}/close`, { method: 'POST' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function deleteSession(sessionId: string) {
  const resp = await fetch(`${API_BASE}/projects/${sessionId}/delete`, { method: 'POST' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface SessionItem {
  session_id: string;
  project_path: string;
  name: string;
  model_id: string | null;
  status: string;
  sse_connected: boolean;
  created_at: string;
}

/** List all active sessions across all projects. */
export async function fetchSessions(): Promise<SessionItem[]> {
  const resp = await fetch(`${API_BASE}/projects/sessions`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** Compact a session (reduce context size, session stays alive). */
export async function compactSession(sessionId: string) {
  const resp = await sendCommand(sessionId, { command: 'compact' });
  return resp;
}

export async function switchModel(sessionId: string, modelId: string, provider: string) {
  const resp = await fetch(
    `${API_BASE}/projects/${sessionId}/model?model_id=${encodeURIComponent(modelId)}&provider=${encodeURIComponent(provider)}`,
    { method: 'POST' }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchModels(sessionId?: string) {
  const url = sessionId
    ? `${API_BASE}/models/?session_id=${sessionId}`
    : `${API_BASE}/models/`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function browseDirectory(path: string) {
  const resp = await fetch(`${API_BASE}/browse?path=${encodeURIComponent(path)}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function listFiles(projectPath: string, path: string = '') {
  const resp = await fetch(
    `${API_BASE}/projects/files?project_path=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(path)}`
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function readFile(projectPath: string, filePath: string) {
  const resp = await fetch(
    `${API_BASE}/projects/files/read?project_path=${encodeURIComponent(projectPath)}&file_path=${encodeURIComponent(filePath)}`
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

// Send a command to a session via the REST cmd endpoint.
// The backend expects `session_id` as a query param and a JSON body whose
// top-level `command` field names the RPC command; remaining fields are the
// command payload. Responses arrive over the SSE stream (rpc_response events).
export async function sendCommand(sessionId: string, body: Record<string, any>) {
  const resp = await fetch(
    `${API_BASE}/projects/cmd?session_id=${encodeURIComponent(sessionId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// SSE + REST command helpers
export class SSEClient {
  private eventSource: EventSource | null = null;
  private sessionId = '';
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  connect(sessionId: string) {
    this.sessionId = sessionId;
    return new Promise<void>((resolve, reject) => {
      const url = `${API_BASE}/projects/sse?session_id=${encodeURIComponent(sessionId)}`;
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => resolve();
      this.eventSource.onerror = (err) => {
        this.eventSource?.close();
        this.eventSource = null;
        reject(err);
      };

      // Re-dispatch every named event to registered listeners. The data field
      // is JSON for rpc_event/rpc_response/set_model; some events send a bare
      // string, so parse defensively.
      const dispatch = (event: string, raw: string) => {
        let data: any = raw;
        try { data = JSON.parse(raw); } catch { /* keep raw string */ }
        this.listeners.get(event)?.forEach((cb) => cb(data));
      };
      for (const evt of [
        'set_model', 'rpc_event', 'rpc_response',
        'extension_ui_request', 'extension_ui_response',
        'session_terminated', 'error',
      ]) {
        this.eventSource.addEventListener(evt, (e) => dispatch(evt, (e as MessageEvent).data));
      }
    });
  }

  close() {
    this.eventSource?.close();
    this.eventSource = null;
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  send(command: string, payload: Record<string, any> = {}) {
    return sendCommand(this.sessionId, { command, ...payload });
  }

  prompt(message: string, streamingBehavior?: string) {
    const body: Record<string, any> = { message };
    if (streamingBehavior) body.streamingBehavior = streamingBehavior;
    return this.send('prompt', body);
  }

  abort() { return this.send('abort'); }
  compact(customInstructions?: string) {
    const body: Record<string, any> = {};
    if (customInstructions) body.customInstructions = customInstructions;
    return this.send('compact', body);
  }
  getState() { return this.send('get_state'); }
  getMessages() { return this.send('get_messages'); }
  setModel(modelId: string, provider: string) { return this.send('set_model', { modelId, provider }); }
  setAutoCompaction(enabled: boolean) { return this.send('set_auto_compaction', { enabled }); }
  respondToExtensionUI(id: string, value: any, cancelled = false) {
    return this.send('extension_ui_response', { id, value, cancelled });
  }
}
