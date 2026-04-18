import { useEffect, useState, useMemo, useRef } from 'react';
import { useApp } from '../store/AppContext';
import { listDirectories } from '../services/api';
import './views.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface DirItem {
  path: string;
  name: string;
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
  const loadingRef = useRef(false);
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
        setError(e instanceof Error ? e.message : 'Failed to load');
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
          {search ? 'No matching folders' : 'Empty directory'}
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
  // Highlight matched text in search
  const displayName = useMemo(() => {
    if (!search.trim()) return item.name;
    const q = search.toLowerCase();
    const idx = item.name.toLowerCase().indexOf(q);
    if (idx < 0) return item.name;
    return (
      <>
        {item.name.slice(0, idx)}
        <mark className="folder-tree__mark">{item.name.slice(idx, idx + search.length)}</mark>
        {item.name.slice(idx + search.length)}
      </>
    );
  }, [item.name, search]);

  return (
    <div className="folder-tree__node">
      <div
        className={`folder-tree__row ${isExpanded ? 'folder-tree__row--expanded' : ''}`}
        style={{ '--depth': depth } as React.CSSProperties}
      >
        <button
          className="folder-tree__toggle"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(item.path);
          }}
          aria-expanded={isExpanded}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? '▾' : '▸'}
        </button>

        <div
          className="folder-tree__folder-btn"
          onClick={() => onToggle(item.path)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onToggle(item.path)}
        >
          <span className="folder-tree__icon" aria-hidden="true">
            {isExpanded ? '📂' : '📁'}
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
  const { setSelectedFolder, setSelectedModel, setView } = useApp();
  const [search, setSearch] = useState('');
  const ROOT_PATH = ''; // empty → resolves to ~/Projects on the backend
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([ROOT_PATH]));

  const handleOpen = (path: string) => {
    setSelectedFolder(path); // store full path for backend query params
    setSelectedModel(null);
    setView('models');
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

  return (
    <div className="view-folder">
      <div className="view-folder__inner">
        <div className="view-folder__header">
          <h1>Open Project</h1>
          <p className="view-folder__subtitle">Navigate to a project folder to open with Pi</p>
        </div>

        <div className="view-folder__search">
          <svg className="view-folder__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search folders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="view-folder__list">
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
        </div>
      </div>
    </div>
  );
}
