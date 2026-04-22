import { useState } from "react";
import { useApp } from "../store/AppContext";
import ProjectTree from "../components/ProjectTree";
import FilePreview from "../components/FilePreview";
import ChatPanel from "../components/ChatPanel";

export default function Workspace() {
	const { setView, selectedFolder } = useApp();
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [chatExpanded, setChatExpanded] = useState(false);

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
					</span>
				</div>
				<div className="view-workspace__header-center">
					<span
						className="view-workspace__project-title"
						onClick={() => setView("folders")}
						title="Back to folder view"
					>
						314 Studio
					</span>
				</div>
				<div className="view-workspace__header-right">
					<button
						className={`icon-btn ${chatExpanded ? "icon-btn--active" : ""}`}
						onClick={() => setChatExpanded(!chatExpanded)}
						title={chatExpanded ? "Collapse chat to full width" : "Expand chat"}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							width="18"
							height="18"
						>
							{chatExpanded ? (
								<path d="M18 6L6 18M6 6l12 12" />
							) : (
								<>
									<rect x="3" y="3" width="18" height="18" rx="2" />
									<path d="M9 3v18" />
								</>
							)}
						</svg>
					</button>
				</div>
			</header>

			<div
				className={`view-workspace__body ${chatExpanded ? "view-workspace__body--chat-expanded" : ""}`}
			>
				<div
					className={`view-workspace__sidebar ${sidebarCollapsed ? "view-workspace__sidebar--collapsed" : ""} ${chatExpanded ? "view-workspace__sidebar--hidden" : ""}`}
				>
					<ProjectTree />
				</div>

				<div
					className={`view-workspace__preview ${chatExpanded ? "view-workspace__preview--hidden" : ""}`}
				>
					<FilePreview />
				</div>

				<div
					className={`view-workspace__chat ${chatExpanded ? "view-workspace__chat--expanded" : ""}`}
				>
					<ChatPanel />
				</div>
			</div>
		</div>
	);
}
