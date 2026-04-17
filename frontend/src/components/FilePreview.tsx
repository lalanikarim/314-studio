import { useApp } from '../store/AppContext';
import { useFileContent } from '../hooks/useFileContent';
import './components.css';

export default function FilePreview() {
  const { selectedFolder, selectedFile } = useApp();
  const fileContent = useFileContent(selectedFolder || '', selectedFile || '');

  if (!selectedFolder) {
    return (
      <div className="panel panel--preview panel--empty">
        <div className="panel__empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
          <p>Select a file to preview</p>
        </div>
      </div>
    );
  }

  if (fileContent.error) {
    return (
      <div className="panel panel--preview">
        <div className="panel__empty-state">
          <p>{fileContent.error}</p>
        </div>
      </div>
    );
  }

  if (fileContent.loading) {
    return (
      <div className="panel panel--preview">
        <div className="panel__loading">
          <div className="panel__spinner" />
          <p>Loading file...</p>
        </div>
      </div>
    );
  }

  const displayContent = fileContent.content || `// No file selected.\n// Click a file in the explorer to view its contents.`;
  const lineNumberCount = displayContent.split('\n').length;

  return (
    <div className="panel panel--preview">
      <div className="panel__header">
        <span>{fileContent.fileName || 'Untitled'}</span>
      </div>
      <div className="panel__content panel__content--code">
        <div className="panel__line-numbers">
          {Array.from({ length: Math.min(lineNumberCount, 200) }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <pre className="panel__code">{displayContent}</pre>
      </div>
    </div>
  );
}
