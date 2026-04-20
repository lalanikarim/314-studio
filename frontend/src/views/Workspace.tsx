import { useState, useEffect } from "react";
import { useApp } from "../store/AppContext";
import { getProjectInfo } from "../services/api";
import ProjectTree from "../components/ProjectTree";
import FilePreview from "../components/FilePreview";
import ChatPanel from "../components/ChatPanel";

export default function Workspace() {
	const { currentModel, selectedFolder } = useApp();
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [chatCollapsed, setChatCollapsed] = useState(false);
	const [runningCount, setRunningCount] = useState<number | null>(null);

	// Fetch project info to show running session count
	useEffect(() => {
		if (!selectedFolder) return;
		getProjectInfo(selectedFolder)
			.then((info) => setRunningCount(info.running_count ?? 0))
			.catch(() => setRunningCount(null));
	}, [selectedFolder]);

	return (
		<div className="view-workspace">
			<header className="view-workspace__header">
				<div className="view-workspace__header-left">
					<button
						className="icon-btn"
						onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
						title="Toggle file tree"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							width="18"
							height="18"
						>
							<rect x="3" y="3" width="18" height="18" rx="2" />
							<path d="M9 3v18" />
						</svg>
					</button>
					<span className="view-workspace__project">
						{selectedFolder?.split("/").filter(Boolean).pop()}
						{runningCount !== null && runningCount > 0 && (
							<span className="view-workspace__session-badge">
								{runningCount} session{runningCount !== 1 ? "s" : ""}
							</span>
						)}
					</span>
				</div>
				<div className="view-workspace__header-center">
					<span className="view-workspace__model-badge">
						{currentModel?.name}
					</span>
				</div>
				<div className="view-workspace__header-right">
					<button
						className="icon-btn"
						onClick={() => setChatCollapsed(!chatCollapsed)}
						title="Toggle chat"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							width="18"
							height="18"
						>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</svg>
					</button>
				</div>
			</header>

			<div className="view-workspace__body">
				<div
					className={`view-workspace__sidebar ${sidebarCollapsed ? "view-workspace__sidebar--collapsed" : ""}`}
				>
					<ProjectTree />
				</div>

				<div className="view-workspace__preview">
					<FilePreview />
				</div>

				<div
					className={`view-workspace__chat ${chatCollapsed ? "view-workspace__chat--collapsed" : ""}`}
				>
					<ChatPanel />
				</div>
			</div>
		</div>
	);
}
