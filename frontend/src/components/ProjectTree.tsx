import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { mockProjectFiles } from '../services/mockData';
import type { FileNode } from '../types';
import './components.css';

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function TreeNode({ node, depth, selectedPath, onSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDirectory) {
      setExpanded(!expanded);
    } else {
      onSelect(node.path);
    }
  };

  const isSelected = selectedPath === node.path;

  return (
    <div className="tree-node">
      <div
        className={`tree-node__row ${isSelected ? 'tree-node__row--selected' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
      >
        <span className="tree-node__icon">
          {node.isDirectory ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" style={{ opacity: expanded ? 1 : 0.6 }}>
              <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
            </svg>
          ) : (
            <span className="tree-node__file-icon">{getFileExtensionIcon(node.name)}</span>
          )}
        </span>
        <span className="tree-node__name">{node.name}</span>
        {node.isDirectory && node.children && (
          <span className="tree-node__toggle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d={expanded ? 'M6 9l6 6 6-6' : 'M9 5l7 7-7 7'} />
            </svg>
          </span>
        )}
      </div>
      {node.isDirectory && expanded && node.children && (
        <div className="tree-node__children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

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
  };
  return iconMap[ext] || '📄';
}

export default function ProjectTree() {
  const { selectedFolder, selectedFile, setSelectedFile } = useApp();

  const files = useMemo(() => {
    if (!selectedFolder) return [];
    return mockProjectFiles(selectedFolder);
  }, [selectedFolder]);

  const handleSelect = (path: string) => {
    setSelectedFile(path);
  };

  return (
    <div className="panel panel--tree">
      <div className="panel__header">
        <span>Explorer</span>
        <span className="panel__count">{files.length} items</span>
      </div>
      <div className="panel__content">
        {files.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedFile}
            onSelect={handleSelect}
          />
        ))}
      </div>
    </div>
  );
}
