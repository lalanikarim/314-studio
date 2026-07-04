export interface Folder {
  name: string;
  path: string;
}

export interface Model {
  id: string;
  provider: string;
  contextWindow: number;
}

export interface Session {
  session_id: string;
  project_path: string;
  name: string;
  model_id?: string;
  status: string;
  pid?: number;
  created_at: string;
}

export interface ProjectInfo {
  project_path: string;
  running_count: number;
  sessions: Session[];
}
