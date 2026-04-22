import React, { useState, useEffect, useMemo, useRef } from "react";
import { useApp } from "../store/AppContext";
import {
	listDirectories,
	listSessions,
	closeSession,
	deleteSession,
} from "../services/api";
import "./views.css";

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = "projects" | "sessions";

interface DirItem {
	path: string;
	name: string;
}

/** Derive a display name from provider + model id, e.g. "Anthropic – claude-sonnet-4-20250514" */
function deriveModelName(modelId: string, provider: string): string {
	const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
	return `${providerName} – ${modelId}`;
}

/** Extract provider from model_id if it uses provider/id format */
function extractProvider(modelId: string | null | undefined): string {
	if (!modelId) return "";
	if (modelId.includes("/")) return modelId.split("/")[0];
	for (const p of [
		"anthropic",
		"openai",
		"google",
		"deepseek",
		"mistral",
		"groq",
		"together",
	]) {
		if (modelId.toLowerCase().startsWith(p)) return p;
	}
	return "anthropic";
}

// ---------------------------------------------------------------------------
// Confirmation dialog for session shutdown
// ---------------------------------------------------------------------------

function ShutdownDialog({
	sessionName,
	onCancel,
	onGraceful,
	onForce,
}: {
	sessionName: string;
	onCancel: () => void;
	onGraceful: () => void;
	onForce: () => void;
}) {
	return (
		<div className="shutdown-dialog__overlay" onClick={onCancel}>
			<div
				className="shutdown-dialog__panel"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="shutdown-dialog__title">Shutdown Session</h2>
				<p className="shutdown-dialog__message">
					Shutdown <strong>{sessionName}</strong>?
				</p>
				<div className="shutdown-dialog__actions">
					<button
						className="shutdown-dialog__btn shutdown-dialog__btn--graceful"
						onClick={onGraceful}
					>
						⏻ Graceful
						<span className="shutdown-dialog__btn--desc">Compact + Abort</span>
					</button>
					<button
						className="shutdown-dialog__btn shutdown-dialog__btn--force"
						onClick={onForce}
					>
						⨟ Force
						<span className="shutdown-dialog__btn--desc">Abort only</span>
					</button>
					<button
						className="shutdown-dialog__btn shutdown-dialog__btn--cancel"
						onClick={onCancel}
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Session list row component
// ---------------------------------------------------------------------------

function SessionRow({
	session,
	onClick,
	onShutdown,
}: {
	session: {
		session_id: string;
		name: string;
		project_path: string;
		model_id: string;
		status: string;
		ws_connected: boolean;
		created_at: string;
	};
	onClick: () => void;
	onShutdown: () => void;
}) {
	const projectName =
		session.project_path.split("/").filter(Boolean).pop() ||
		session.project_path;
	const time = new Date(session.created_at);
	const timeStr =
		time.toLocaleDateString([], { month: "short", day: "numeric" }) +
		" " +
		time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

	return (
		<div className="session-row" onClick={onClick}>
			<div className="session-row__top">
				<div className="session-row__info">
					<span className="session-row__name">
						<span
							className={`session-row__status ${session.ws_connected ? "session-row__status--connected" : session.status === "running" ? "session-row__status--running" : ""}`}
						/>
						{session.name || projectName}
					</span>
					<span className="session-row__time">{timeStr}</span>
				</div>
				<button
					className="session-row__shutdown-btn"
					onClick={(e) => {
						e.stopPropagation();
						onShutdown();
					}}
					title="Shutdown session"
				>
					⏻
				</button>
			</div>
			<div className="session-row__meta">
				<span>{projectName}</span>
				<span className="session-row__divider">&middot;</span>
				<span>
					{session.model_id
						? deriveModelName(
								session.model_id,
								extractProvider(session.model_id),
							)
						: "—"}
				</span>
			</div>
		</div>
	);
}

// ── Recursive directory tree component ─────────────────────────────────────

function DirectoryTree({
	path,
	depth,
	expandedPaths,
	search,
	onToggle,
	onOpen,
}: {
	path: string;
	depth: number;
	expandedPaths: Set<string>;
	search: string;
	onToggle: (path: string) => void;
	onOpen: (path: string) => void;
}) {
	const [items, setItems] = useState<DirItem[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isLoaded, setIsLoaded] = useState(false);
	const loadingRef = React.useRef(false);
	const isExpanded = expandedPaths.has(path);

	// Load children when expanded
	useEffect(() => {
		if (!isExpanded) {
			loadingRef.current = false;
			return;
		}
		if (isLoaded || loadingRef.current) return;

		loadingRef.current = true;
		listDirectories(path)
			.then((dirs) => {
				setItems(dirs.map((d) => ({ ...d })));
			})
			.catch((e) => {
				setError(e instanceof Error ? e.message : "Failed to load");
				setItems([]);
			})
			.finally(() => {
				loadingRef.current = false;
				setIsLoaded(true);
			});
	}, [isExpanded, path]);

	const filteredItems = useMemo(() => {
		if (!search.trim()) return items;
		const q = search.toLowerCase();
		return items.filter((i) => i.name.toLowerCase().includes(q));
	}, [items, search]);

	if (error && items.length === 0) {
		return (
			<div className="folder-tree__error">
				<span className="folder-tree__error-text">{error}</span>
			</div>
		);
	}

	return (
		<div className="folder-tree">
			{filteredItems.map((item) => (
				<DirectoryTreeNode
					key={item.path}
					item={item}
					depth={depth}
					isExpanded={expandedPaths.has(item.path)}
					expandedPaths={expandedPaths}
					search={search}
					onToggle={onToggle}
					onOpen={() => onOpen(item.path)}
				/>
			))}
			{filteredItems.length === 0 && items.length > 0 && (
				<div className="folder-tree__empty">
					{search ? "No matching folders" : "Empty directory"}
				</div>
			)}
			{!isLoaded && !error && isExpanded && (
				<div className="folder-tree__loading">Loading…</div>
			)}
		</div>
	);
}

// ── Single tree node ──────────────────────────────────────────────────────

function DirectoryTreeNode({
	item,
	depth,
	isExpanded,
	expandedPaths,
	search,
	onToggle,
	onOpen,
}: {
	item: DirItem;
	depth: number;
	isExpanded: boolean;
	expandedPaths: Set<string>;
	search: string;
	onToggle: (path: string) => void;
	onOpen: () => void;
}) {
	const displayName = useMemo(() => {
		if (!search.trim()) return item.name;
		const q = search.toLowerCase();
		const idx = item.name.toLowerCase().indexOf(q);
		if (idx < 0) return item.name;
		return (
			<>
				{item.name.slice(0, idx)}
				<mark className="folder-tree__mark">
					{item.name.slice(idx, idx + search.length)}
				</mark>
				{item.name.slice(idx + search.length)}
			</>
		);
	}, [item.name, search]);

	return (
		<div className="folder-tree__node">
			<div
				className={`folder-tree__row ${isExpanded ? "folder-tree__row--expanded" : ""}`}
				style={{ "--depth": depth } as React.CSSProperties}
			>
				<button
					className="folder-tree__toggle"
					onClick={(e) => {
						e.stopPropagation();
						onToggle(item.path);
					}}
					aria-expanded={isExpanded}
					title={isExpanded ? "Collapse" : "Expand"}
				>
					{isExpanded ? "▾" : "▸"}
				</button>

				<div
					className="folder-tree__folder-btn"
					onClick={() => onToggle(item.path)}
					role="button"
					tabIndex={0}
					onKeyDown={(e) => e.key === "Enter" && onToggle(item.path)}
				>
					<span className="folder-tree__icon" aria-hidden="true">
						{isExpanded ? "📂" : "📁"}
					</span>
					<span className="folder-tree__name">{displayName}</span>
				</div>

				<button
					className="folder-tree__open-btn"
					onClick={(e) => {
						e.stopPropagation();
						onOpen();
					}}
					title={`Open ${item.name}`}
				>
					Open
				</button>
			</div>

			{isExpanded && (
				<DirectoryTree
					path={item.path}
					depth={depth + 1}
					expandedPaths={expandedPaths}
					search={search}
					onToggle={onToggle}
					onOpen={onOpen}
				/>
			)}
		</div>
	);
}

// ── Main FolderSelector ───────────────────────────────────────────────────

export default function FolderSelector() {
	const { setSelectedFolder, setSelectedModel, setView, setSelectedSession } =
		useApp();
	const [search, setSearch] = useState("");
	const [activeTab, setActiveTab] = useState<Tab>("projects");
	const ROOT_PATH = "";
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
		new Set([ROOT_PATH]),
	);
	const [sessions, setSessions] = useState<
		Array<{
			session_id: string;
			name: string;
			project_path: string;
			model_id: string;
			status: string;
			ws_connected: boolean;
			created_at: string;
		}>
	>([]);
	const [shutdownTarget, setShutdownTarget] = useState<{
		session_id: string;
		name: string;
	} | null>(null);
	const [shuttingDown, setShuttingDown] = useState(false);
	const sessionsFetched = useRef(false);

	// Fetch active sessions on mount (always, so the Sessions tab can appear)
	useEffect(() => {
		if (sessionsFetched.current) return;
		sessionsFetched.current = true;
		listSessions()
			.then((s) => {
				const running = s.filter((item) => item.status === "running");
				setSessions(running);
			})
			.catch(() => {});
	}, []);

	const handleOpen = (path: string) => {
		setSelectedFolder(path);
		setSelectedModel(null);
		setSelectedSession(null);
		setView("models");
	};

	const handleSelectSession = (session: {
		session_id: string;
		project_path: string;
		model_id: string;
		name: string;
		status: string;
		ws_connected: boolean;
		created_at: string;
	}) => {
		setSelectedSession({
			session_id: session.session_id,
			name: session.name,
			project_path: session.project_path,
			model_id: session.model_id,
			status: session.status,
			ws_connected: session.ws_connected,
			created_at: session.created_at,
		});
		setSelectedFolder(session.project_path);
		setSelectedModel(null);
		setView("workspace");
	};

	const handleToggle = (path: string) => {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	// ── Session shutdown handlers ──────────────────────────────────────────

	const handleGracefulShutdown = async () => {
		if (!shutdownTarget || shuttingDown) return;
		setShuttingDown(true);
		try {
			await closeSession(shutdownTarget.session_id);
			setSessions((prev) =>
				prev.filter((s) => s.session_id !== shutdownTarget.session_id),
			);
		} catch (e) {
			console.error("Failed to close session:", e);
		} finally {
			setShutdownTarget(null);
			setShuttingDown(false);
		}
	};

	const handleForceShutdown = async () => {
		if (!shutdownTarget || shuttingDown) return;
		setShuttingDown(true);
		try {
			await deleteSession(shutdownTarget.session_id);
			setSessions((prev) =>
				prev.filter((s) => s.session_id !== shutdownTarget.session_id),
			);
		} catch (e) {
			console.error("Failed to delete session:", e);
		} finally {
			setShutdownTarget(null);
			setShuttingDown(false);
		}
	};

	return (
		<div className="view-folder">
			<div className="view-folder__inner">
				<div className="view-folder__header">
					<h1>Open Project</h1>
					<p className="view-folder__subtitle">
						Navigate to a project folder to open with Pi
					</p>
				</div>

				{/* Tabs */}
				<div className="view-folder__tabs">
					<button
						className={`view-folder__tab ${activeTab === "projects" ? "view-folder__tab--active" : ""}`}
						onClick={() => setActiveTab("projects")}
					>
						Projects
					</button>
					<button
						className={`view-folder__tab ${activeTab === "sessions" ? "view-folder__tab--active" : ""}`}
						onClick={() => setActiveTab("sessions")}
					>
						Sessions {sessions.length > 0 && `(${sessions.length})`}
					</button>
				</div>

				{/* Search */}
				<div className="view-folder__search">
					<svg
						className="view-folder__search-icon"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
					>
						<circle cx="11" cy="11" r="8" />
						<path d="m21 21-4.35-4.35" />
					</svg>
					<input
						type="text"
						placeholder={
							activeTab === "sessions" ? "Search sessions…" : "Search folders…"
						}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>

				{/* Content */}
				<div className="view-folder__list">
					{activeTab === "projects" ? (
						<>
							<DirectoryTree
								path={ROOT_PATH}
								depth={0}
								expandedPaths={expandedPaths}
								search={search}
								onToggle={handleToggle}
								onOpen={handleOpen}
							/>

							{expandedPaths.size === 0 && (
								<button
									className="view-folder__expand-all"
									onClick={() => setExpandedPaths(new Set([ROOT_PATH]))}
								>
									▸ Show folders
								</button>
							)}
						</>
					) : (
						<>
							{sessions.length === 0 ? (
								<div className="folder-tree__empty">No active sessions</div>
							) : (
								sessions.map((session) => (
									<SessionRow
										key={session.session_id}
										session={session}
										onClick={() => handleSelectSession(session)}
										onShutdown={() =>
											setShutdownTarget({
												session_id: session.session_id,
												name: session.name,
											})
										}
									/>
								))
							)}
						</>
					)}
				</div>
			</div>

			{/* Shutdown confirmation dialog */}
			{shutdownTarget && (
				<ShutdownDialog
					sessionName={shutdownTarget.name}
					onCancel={() => setShutdownTarget(null)}
					onGraceful={handleGracefulShutdown}
					onForce={handleForceShutdown}
				/>
			)}
		</div>
	);
}
