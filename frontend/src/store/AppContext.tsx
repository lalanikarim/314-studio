/* @refresh reset */
import {
	createContext,
	useContext,
	useState,
	useCallback,
	type ReactNode,
} from "react";
import type { AppState, AppView, Model } from "../types";

export interface SessionRecord {
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

const initialAppState: AppState = {
	view: "folders",
	selectedFolder: null,
	selectedModel: null,
	currentModel: null,
	selectedFile: null,
	sessionId: null,
	selectedSession: null,
};

interface AppContextType extends AppState {
	setView: (view: AppView) => void;
	setSelectedFolder: (folder: string | null) => void;
	setSelectedModel: (model: Model | null) => void;
	setCurrentModel: (model: Model | null) => void;
	switchModel: (model: Model) => void;
	setSelectedFile: (path: string | null) => void;
	setSessionId: (id: string | null) => void;
	setSelectedSession: (session: SessionRecord | null) => void;
}

const AppContext = createContext<AppContextType>(
	null as unknown as AppContextType,
);

export function AppProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AppState>(initialAppState);

	const setView = useCallback((view: AppView) => {
		setState((prev) => ({ ...prev, view }));
	}, []);

	const setSelectedFolder = useCallback((folder: string | null) => {
		setState((prev) => ({ ...prev, selectedFolder: folder }));
	}, []);

	const setSelectedModel = useCallback((model: Model | null) => {
		setState((prev) => ({ ...prev, selectedModel: model }));
	}, []);

	const setCurrentModel = useCallback((model: Model | null) => {
		setState((prev) => ({ ...prev, currentModel: model }));
	}, []);

	const switchModel = useCallback((model: Model) => {
		setState((prev) => ({
			...prev,
			currentModel: model,
			selectedModel: model,
		}));
	}, []);

	const setSelectedFile = useCallback((path: string | null) => {
		setState((prev) => ({ ...prev, selectedFile: path }));
	}, []);

	const setSessionId = useCallback((id: string | null) => {
		setState((prev) => ({ ...prev, sessionId: id }));
	}, []);

	const setSelectedSession = useCallback((session: SessionRecord | null) => {
		setState((prev) => ({
			...prev,
			sessionId: session ? session.session_id : prev.sessionId,
			selectedSession: session,
			selectedFolder: session ? session.project_path : prev.selectedFolder,
		}));
	}, []);

	return (
		<AppContext.Provider
			value={{
				...state,
				setView,
				setSelectedFolder,
				setSelectedModel,
				setCurrentModel,
				switchModel,
				setSelectedFile,
				setSessionId,
				setSelectedSession,
			}}
		>
			{children}
		</AppContext.Provider>
	);
}

/* eslint-disable react-refresh/only-export-components */
export function useApp() {
	return useContext(AppContext);
}
