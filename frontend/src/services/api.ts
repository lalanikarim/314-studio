/**
 * API service for communicating with the FastAPI backend.
 * All fetch calls use relative URLs (Vite proxy or same-origin).
 *
 * Architecture: REST = metadata only, WebSocket = all Pi RPC actions.
 * Project-scoped endpoints use `project_path` as a query parameter.
 */

const API_BASE = ""; // relative to Vite dev server or behind reverse proxy

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`API ${res.status}: ${body || res.statusText}`);
	}
	const contentType = res.headers.get("content-type") || "";
	if (
		contentType.includes("text/") ||
		contentType.includes("application/octet-stream")
	) {
		return (await res.text()) as unknown as T;
	}
	return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Browse / Directory Tree
// ---------------------------------------------------------------------------

export interface DirNode {
	path: string;
	name: string;
	isDirectory: true;
}

export async function listDirectories(path: string = ""): Promise<DirNode[]> {
	const qs = path ? `?path=${encodeURIComponent(path)}` : "";
	return request<DirNode[]>(`/api/browse${qs}`);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectInfo {
	path: string;
	exists: boolean;
	is_directory: boolean;
	sessions?: SessionListItem[];
	running_count?: number;
}

export interface SessionListItem {
	session_id: string;
	name: string;
	project_path: string;
	model_id: string;
	status: string;
	pid?: number;
	created_at: string;
	ws_session_id?: string;
	ws_connected: boolean;
}

/** List project folder names under ~/Projects */
export async function listProjects(): Promise<string[]> {
	return request<string[]>("/api");
}

/** List all active sessions across all projects */
export async function listSessions(): Promise<SessionListItem[]> {
	return request<SessionListItem[]>("/api/projects/sessions");
}

/** Get project details including all active sessions */
export async function getProjectInfo(
	projectPath: string,
): Promise<ProjectInfo> {
	return request<ProjectInfo>(
		`/api/projects/info?project_path=${encodeURIComponent(projectPath)}`,
	);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface CreateSessionBody {
	name?: string;
}

export interface SessionRecord {
	session_id: string;
	project_path: string;
	name: string;
	model_id: string;
	status: string;
	pid?: number;
	created_at: string;
	ws_session_id?: string;
	ws_connected: boolean;
	running_count?: number;
}

/**
 * Create a new session (model is set later via WS `set_model` on connect).
 */
export async function createSession(
	projectPath: string,
	name?: string,
): Promise<SessionRecord> {
	const body: CreateSessionBody = { name };
	return request<SessionRecord>(
		`/api/projects/?project_path=${encodeURIComponent(projectPath)}`,
		{ method: "POST", body: JSON.stringify(body) },
	);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelConfig {
	id: string;
	provider: string;
	contextWindow?: number;
	maxTokens?: number;
	[key: string]: unknown;
}

/**
 * List available models.
 * No session_id required — server serves cached models from `pi --list-models`.
 */
export async function listModels(sessionId?: string): Promise<ModelConfig[]> {
	const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
	return request<ModelConfig[]>(`/api/models/${qs}`);
}

/**
 * Switch model for a session (updates session metadata).
 * The actual set_model RPC is sent via WebSocket on next connect.
 */
export interface ModelSwitchResponse {
	message: string;
	modelId: string;
	provider: string;
}

export async function switchModel(
	sessionId: string,
	modelId: string,
	provider: string = "",
): Promise<ModelSwitchResponse> {
	const qs = `?model_id=${encodeURIComponent(modelId)}&provider=${encodeURIComponent(provider)}`;
	return request<ModelSwitchResponse>(`/api/projects/${sessionId}/model${qs}`);
}

// ---------------------------------------------------------------------------
// Sessions (close/delete)
// ---------------------------------------------------------------------------

export interface SessionCloseResponse {
	session_id: string;
	compacted: boolean;
}

/**
 * Close a session: compact conversation then terminate process.
 */
export async function closeSession(
	sessionId: string,
): Promise<SessionCloseResponse> {
	return request<SessionCloseResponse>(`/api/projects/${sessionId}/close`, {
		method: "POST",
	});
}

/**
 * Delete a session: abort current turn then terminate process (no compact).
 */
export async function deleteSession(
	sessionId: string,
): Promise<SessionCloseResponse> {
	return request<SessionCloseResponse>(`/api/projects/${sessionId}/delete`, {
		method: "POST",
	});
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface FileInfo {
	name: string;
	path: string;
	isDirectory: boolean;
	size?: number;
}

/**
 * List files in a directory.
 * @param projectPath — full path of the project folder
 * @param relativePath — optional sub-directory path (e.g. "src/backend/app")
 */
export async function listFiles(
	projectPath: string,
	relativePath = "",
): Promise<FileInfo[]> {
	const qs = relativePath
		? `?project_path=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(relativePath)}`
		: `?project_path=${encodeURIComponent(projectPath)}`;
	return request<FileInfo[]>(`/api/projects/files${qs}`);
}

/**
 * Read a file's content.
 * @param projectPath — full path of the project folder
 * @param filePath — relative path of the file inside the project
 */
export async function readFile(
	projectPath: string,
	filePath: string,
): Promise<string> {
	const qs = `?project_path=${encodeURIComponent(projectPath)}&file_path=${encodeURIComponent(filePath)}`;
	return request<string>(`/api/projects/files/read${qs}`);
}
