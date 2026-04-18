/**
 * API service for communicating with the FastAPI backend.
 * All fetch calls use relative URLs (Vite proxy or same-origin).
 *
 * Project endpoints now use `project_path` as a query parameter
 * instead of a route parameter, matching the backend scheme.
 */

const API_BASE = ''; // relative to Vite dev server or behind reverse proxy

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/') || contentType.includes('application/octet-stream')) {
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

export async function listDirectories(path: string = ''): Promise<DirNode[]> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return request<DirNode[]>(`/api/browse${qs}`);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  path: string;
  exists: boolean;
  is_directory: boolean;
}

export async function listProjects(): Promise<string[]> {
  return request<string[]>('/api/projects');
}

export async function getProjectInfo(projectPath: string): Promise<ProjectInfo> {
  return request<ProjectInfo>(
    `/api/projects/info?project_path=${encodeURIComponent(projectPath)}`
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSession(projectPath: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(
    `/api/projects/sessions?project_path=${encodeURIComponent(projectPath)}`,
    { method: 'POST' }
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

export async function listModels(projectName?: string): Promise<ModelConfig[]> {
  const qs = projectName ? `?project_name=${encodeURIComponent(projectName)}` : '';
  return request<ModelConfig[]>(`/api/models/${qs}`);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface FileInfo {
  path: string;
  isDirectory: boolean;
  size?: number;
}

/**
 * List files in a directory.
 * @param projectPath — full path of the project folder (e.g. ~/Projects/my-project)
 * @param relativePath — optional sub-directory path (e.g. "src/backend/app")
 */
export async function listFiles(projectPath: string, relativePath = ''): Promise<FileInfo[]> {
  const qs = relativePath ? `?project_path=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(relativePath)}`
    : `?project_path=${encodeURIComponent(projectPath)}`;
  return request<FileInfo[]>(`/api/projects/files${qs}`);
}

/**
 * Read a file's content.
 * @param projectPath — full path of the project folder (e.g. ~/Projects/my-project)
 * @param filePath — relative path of the file inside the project (e.g. "src/main.py")
 */
export async function readFile(projectPath: string, filePath: string): Promise<string> {
  const qs = `?project_path=${encodeURIComponent(projectPath)}&file_path=${encodeURIComponent(filePath)}`;
  return request<string>(`/api/projects/files/read${qs}`);
}
