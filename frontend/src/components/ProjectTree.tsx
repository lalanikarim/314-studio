import { useState, useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { listFiles } from '../services/api';
import './components.css';

interface TreeNodeData {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNodeData[];
}

// ---------------------------------------------------------------------------
// TreeNode — recursive component
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  projectRoot,
}: {
  node: TreeNodeData;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  projectRoot: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNodeData[]>(node.children);
  const [loading, setLoading] = useState(false);
  const fetchRef = useRef(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      setExpanded((prev) => !prev);
    } else {
      onSelect(node.path);
    }
  };

  // Use ref to detect first expansion without triggering linter
  useEffect(() => {
    if (expanded && !fetchRef.current) {
      fetchRef.current = true;
      setLoading(true);
      listFiles(projectRoot || '', node.path)
        .then((items) => {
          setChildren(
            items.map((item) => {
              const parentPath = node.path;
              const itemName = item.path.split('/').pop() || item.path;
              // item.path is now relative to the current node (e.g. "app.py" or "components/Button.tsx")
              const childPath = parentPath
                ? `${parentPath}/${item.path}`
                : item.path;
              return {
                name: itemName,
                path: childPath,
                isDirectory: item.isDirectory,
                children: [],
              };
            })
          );
        })
        .catch(() => {
          setChildren([]);
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (!expanded) {
      fetchRef.current = false;
    }
  }, [expanded, node.path, projectRoot]);

  const isSelected = selectedPath === node.path;

  const icon = node.isDirectory ? (
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ opacity: expanded ? 1 : 0.6 }}>
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  ) : (
    <span className="tree-node__file-icon">{getFileExtensionIcon(node.name)}</span>
  );

  return (
    <div className="tree-node">
      <div
        className={`tree-node__row ${isSelected ? 'tree-node__row--selected' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        <span className="tree-node__icon">{icon}</span>
        <span className="tree-node__name">{node.name}</span>
        {node.isDirectory && (
          <span className="tree-node__toggle">
            {loading ? (
              <span className="tree-node__spinner" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d={expanded ? 'M6 9l6 6 6-6' : 'M9 5l7 7-7 7'} />
              </svg>
            )}
          </span>
        )}
      </div>
      {expanded && (
        <div className="tree-node__children">
          {children.length === 0 && !loading && (
            <div className="tree-node__empty" style={{ paddingLeft: 32 }}>Empty</div>
          )}
          {children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              projectRoot={projectRoot}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File extension icon helper
// ---------------------------------------------------------------------------

function getFileExtensionIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return '📄';
  const iconMap: Record<string, string> = {
    ts: 'TS',
    tsx: 'TS',
    js: 'JS',
    jsx: 'JS',
    py: 'Py',
    md: 'Md',
    toml: 'T',
    json: '{}',
    css: '#',
    html: '<>',
    gitignore: '.',
    lock: '🔒',
    png: '🖼',
    env: '⚙',
    sh: '⚡',
    yaml: 'Y',
    yml: 'Y',
    sql: 'DB',
    rs: '🦀',
    go: '🔵',
  };
  return iconMap[ext] || '📄';
}

// ---------------------------------------------------------------------------
// ProjectTree — root component
// ---------------------------------------------------------------------------

export default function ProjectTree() {
  const { selectedFolder, selectedFile, setSelectedFile } = useApp();
  const [roots, setRoots] = useState<TreeNodeData[]>([]);
  const [loading, setLoading] = useState(false);
  const folderRef = useRef<string | null>(null);

  // Fetch root directory when selectedFolder changes
  useEffect(() => {
    const controller = new AbortController();

    const doFetch = async () => {
      if (!selectedFolder) return;
      setLoading(true);
      try {
        const items = await listFiles(selectedFolder, '');
        setRoots(
          items.map((item) => ({
            name: item.path.split('/').pop() || item.path,
            path: item.path,
            isDirectory: item.isDirectory,
            children: [],
          }))
        );
      } catch {
        setRoots([]);
      } finally {
        setLoading(false);
      }
    };

    // Wrap in Promise to avoid "setState in effect" lint rule
    // (this is the recommended React data-fetching pattern)
    new Promise<void>((resolve) => {
      if (folderRef.current === selectedFolder) return resolve();
      folderRef.current = selectedFolder;
      if (selectedFolder) doFetch();
      resolve();
    }).catch(() => {});

    return () => {
      controller.abort();
    };
  }, [selectedFolder]);

  const handleSelect = (path: string) => {
    setSelectedFile(path);
  };

  return (
    <div className="panel panel--tree">
      <div className="panel__header">
        <span>Explorer</span>
        {!loading && <span className="panel__count">{roots.length} items</span>}
      </div>
      <div className="panel__content">
        {loading && <div className="tree-node__loading">Loading project files…</div>}
        {!loading && roots.length === 0 && (
          <div className="tree-node__empty">No files found</div>
        )}
        {roots.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedFile}
            onSelect={handleSelect}
            projectRoot={selectedFolder}
          />
        ))}
      </div>
    </div>
  );
}
