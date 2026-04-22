import { useState, useEffect, useMemo } from "react";
import { useApp } from "../store/AppContext";
import { useModels } from "../hooks/useModels";
import "./views.css";
import "./common.css";

export default function ModelSelector() {
	const {
		selectedFolder,
		selectedModel,
		setSelectedModel,
		switchModel,
		setCurrentModel,
		setView,
		setSessionId,
	} = useApp();
	const { models, loading, error, sessionId, runningCount } =
		useModels(selectedFolder);
	const [switching, setSwitching] = useState(false);
	const [search, setSearch] = useState("");
	const [selectedProviders, setSelectedProviders] = useState<string[]>([]);

	// Extract unique providers from fetched models
	const providers = useMemo(() => {
		const providerSet = new Set(models.map((m) => m.provider));
		return Array.from(providerSet).sort();
	}, [models]);

	// When models first load, set all providers as selected so the
	// filter initially shows everything (select-all = no filter applied).

	// Toggle provider filter
	const toggleProvider = (provider: string) => {
		setSelectedProviders((prev) =>
			prev.includes(provider)
				? prev.filter((p) => p !== provider)
				: [...prev, provider],
		);
	};

	// Filter models by search AND provider filters
	const filteredModels = useMemo(() => {
		let result = models;

		// Apply provider filter only when at least one provider is selected.
		// Default state = all selected → shows all models.
		if (selectedProviders.length > 0) {
			result = result.filter((m) => selectedProviders.includes(m.provider));
		}

		// Apply search filter
		if (search.trim()) {
			const q = search.toLowerCase();
			result = result.filter((m) => m.name.toLowerCase().includes(q));
		}

		return result;
	}, [models, search, selectedProviders, providers]);

	// Clear all filters
	const clearFilters = () => {
		setSearch("");
		setSelectedProviders([...providers]);
	};

	const hasActiveFilters =
		search.trim() ||
		(selectedProviders.length > 0 &&
			selectedProviders.length < providers.length);

	// Highlight matching text in model name
	function highlightMatch(text: string, search: string) {
		if (!search.trim()) return text;
		const q = search.toLowerCase();
		const idx = text.toLowerCase().indexOf(q);
		if (idx < 0) return text;
		return (
			<>
				{text.slice(0, idx)}
				<mark className="view-models__mark">
					{text.slice(idx, idx + search.length)}
				</mark>
				{text.slice(idx + search.length)}
			</>
		);
	}

	// Persist sessionId so ChatPanel can use it for WebSocket URL
	useEffect(() => {
		if (sessionId) setSessionId(sessionId);
	}, [sessionId, setSessionId]);

	const handleSwitch = async () => {
		if (!selectedModel || !selectedFolder) return;
		setSwitching(true);
		try {
			// Switch model on backend (session_id is generated when WebSocket connects)
			// For now, we switch on connect in the Workspace — this sets the UI selection
			switchModel(selectedModel);
			setCurrentModel(selectedModel);
			setView("workspace");
		} catch (e) {
			console.error("Failed to switch model:", e);
		} finally {
			setSwitching(false);
		}
	};

	return (
		<div className="view-models">
			<div className="view-models__inner">
				<div className="view-models__header">
					<button
						className="view-models__back"
						onClick={() => setView("folders")}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							width="18"
							height="18"
						>
							<path d="M19 12H5M12 19l-7-7 7-7" />
						</svg>
						Back
					</button>
					<h1>Choose a Model</h1>
					<p className="view-models__project">
						<span>
							Project: {selectedFolder?.split("/").filter(Boolean).pop()}
						</span>
						{runningCount !== null && runningCount > 0 && (
							<span className="view-models__session-count">
								{runningCount} session
								{runningCount !== 1 ? "s" : ""} running
							</span>
						)}
					</p>
				</div>

				<div className="view-models__search">
					<svg
						className="view-models__search-icon"
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
						placeholder="Search models…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>

				{/* Provider filter chips */}
				{!loading && providers.length > 0 && (
					<div className="view-models__providers">
						{providers.map((provider) => {
							const isActive = selectedProviders.includes(provider);
							return (
								<button
									key={provider}
									className={`view-models__provider-btn ${isActive ? "view-models__provider-btn--active" : ""}`}
									onClick={() => toggleProvider(provider)}
								>
									{provider}
									<span className="view-models__provider-count">
										{models.filter((m) => m.provider === provider).length}
									</span>
								</button>
							);
						})}
						{hasActiveFilters && (
							<button
								className="view-models__clear-btn"
								onClick={clearFilters}
								title="Clear all filters"
							>
								✕
							</button>
						)}
					</div>
				)}

				{loading && (
					<div className="view-models__loading">
						<svg
							className="view-models__spinner"
							viewBox="0 0 24 24"
							width="32"
							height="32"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
						</svg>
						<p>{error ? error : "Connecting to Pi and fetching models..."}</p>
					</div>
				)}

				{!loading && (
					<>
						{error && <p className="view-models__error">{error}</p>}
						<div className="view-models__list">
							{filteredModels.map((model) => (
								<div
									key={`${model.provider}:${model.id}`}
									className={`view-models__card ${selectedModel?.id === model.id ? "view-models__card--selected" : ""}`}
									onClick={() => setSelectedModel(model)}
								>
									<div className="view-models__card-header">
										<div className="view-models__card-name">
											{highlightMatch(model.name, search)}
										</div>
										{selectedModel?.id === model.id && (
											<span className="view-models__badge">Selected</span>
										)}
									</div>
									<div className="view-models__card-meta">
										<span>{model.provider}</span>
										{model.contextWindow > 0 && (
											<>
												<span className="view-models__divider">&middot;</span>
												<span>
													{model.contextWindow.toLocaleString()} context
												</span>
											</>
										)}
										{model.maxTokens > 0 && (
											<>
												<span className="view-models__divider">&middot;</span>
												<span>
													{model.maxTokens.toLocaleString()} max tokens
												</span>
											</>
										)}
									</div>
								</div>
							))}
							{filteredModels.length === 0 && models.length > 0 && (
								<div className="view-models__empty">No matching models</div>
							)}
						</div>

						<div className="view-models__actions">
							<button
								className="btn btn--primary btn--lg"
								disabled={!selectedModel || switching}
								onClick={handleSwitch}
							>
								{switching ? "Switching..." : "Switch Model & Open"}
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
