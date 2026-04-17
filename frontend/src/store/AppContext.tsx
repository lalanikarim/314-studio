import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AppState, AppView, Model } from '../types';
import { initialModel } from '../services/mockData';

const initialAppState: AppState = {
  view: 'folders',
  selectedFolder: null,
  selectedModel: initialModel,
  currentModel: initialModel,
  selectedFile: null,
};

interface AppContextType extends AppState {
  setView: (view: AppView) => void;
  setSelectedFolder: (folder: string | null) => void;
  setSelectedModel: (model: Model | null) => void;
  setCurrentModel: (model: Model | null) => void;
  switchModel: (model: Model) => void;
  setSelectedFile: (path: string | null) => void;
}

const AppContext = createContext<AppContextType>(null as unknown as AppContextType);

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
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
