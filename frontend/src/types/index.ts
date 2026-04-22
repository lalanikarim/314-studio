export interface Model {
	id: string;
	name: string;
	provider: string;
	contextWindow: number;
	maxTokens: number;
}

export interface FileNode {
	name: string;
	path: string;
	isDirectory: boolean;
	size?: number;
	children?: FileNode[];
}

export interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

export type AppView = "folders" | "models" | "workspace";

export interface AppState {
	view: AppView;
	selectedFolder: string | null;
	selectedModel: Model | null;
	currentModel: Model | null;
	selectedFile: string | null;
	sessionId: string | null;
	selectedSession: {
		session_id: string;
		name: string;
		project_path: string;
		model_id: string;
		status: string;
		ws_connected: boolean;
		created_at: string;
	} | null;
}
