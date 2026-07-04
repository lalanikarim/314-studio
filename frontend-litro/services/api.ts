const API_BASE = '/api';

export async function fetchFolders(): Promise<Array<{ name: string; path: string }>> {
  const resp = await fetch(`${API_BASE}/`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
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
  return resp.json();
}

// SSE + REST command helpers
export class SSEClient {
  private eventSource: EventSource | null = null;
  private callbacks: Map<string, Array<(data: any) => void>> = new Map();

  connect(sessionId: string) {
    return new Promise<void>((resolve, reject) => {
      const url = `${API_BASE}/projects/sse?session_id=${encodeURIComponent(sessionId)}`;
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        resolve();
      };

      this.eventSource.onerror = (err) => {
        this.eventSource?.close();
        this.eventSource = null;
        reject(err);
      };
    });
  }

  close() {
    this.eventSource?.close();
    this.eventSource = null;
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);

    if (this.eventSource) {
      this.eventSource.addEventListener(event, (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        this.callbacks.get(event)!.forEach((cb) => cb(data));
      });
    }
  }

  async sendCommand(command: string, payload: Record<string, any> = {}) {
    const resp = await fetch(`${API_BASE}/projects/cmd?session_id=TODO`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, ...payload }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  async prompt(message: string, streamingBehavior?: string) {
    const cmd: Record<string, any> = { command: 'prompt', message };
    if (streamingBehavior) cmd.streamingBehavior = streamingBehavior;
    return this.sendCommand(cmd.command, cmd);
  }

  async abort() {
    return this.sendCommand('abort');
  }

  async compact(customInstructions?: string) {
    const cmd: Record<string, any> = { command: 'compact' };
    if (customInstructions) cmd.customInstructions = customInstructions;
    return this.sendCommand(cmd.command, cmd);
  }

  async getState() {
    return this.sendCommand('get_state');
  }

  async getMessages() {
    return this.sendCommand('get_messages');
  }

  async setModel(modelId: string, provider: string) {
    return this.sendCommand('set_model', { modelId, provider });
  }

  async setAutoCompaction(enabled: boolean) {
    return this.sendCommand('set_auto_compaction', { enabled });
  }

  async respondToExtensionUI(id: string, value: any, cancelled: boolean = false) {
    return this.sendCommand('extension_ui_response', { id, value, cancelled });
  }
}
