import { useState, useCallback, useRef } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, X, Globe } from 'lucide-react';

export interface BrowserWindowProps {
  initialUrl?: string;
  onNavigate?: (url: string) => void;
}

export function BrowserWindow({ initialUrl = '', onNavigate }: BrowserWindowProps): JSX.Element {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : []);
  const [historyIdx, setHistoryIdx] = useState(initialUrl ? 0 : -1);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const navigate = useCallback((target: string) => {
    let normalized = target.trim();
    if (!normalized) return;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    setUrl(normalized);
    setInputUrl(normalized);
    const newHistory = history.slice(0, historyIdx + 1);
    newHistory.push(normalized);
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
    onNavigate?.(normalized);
  }, [history, historyIdx, onNavigate]);

  const goBack = useCallback(() => {
    if (historyIdx > 0) {
      const idx = historyIdx - 1;
      setHistoryIdx(idx);
      setUrl(history[idx]);
      setInputUrl(history[idx]);
    }
  }, [history, historyIdx]);

  const goForward = useCallback(() => {
    if (historyIdx < history.length - 1) {
      const idx = historyIdx + 1;
      setHistoryIdx(idx);
      setUrl(history[idx]);
      setInputUrl(history[idx]);
    }
  }, [history, historyIdx]);

  const reload = useCallback(() => {
    if (iframeRef.current && url) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = '';
      iframeRef.current.src = currentSrc;
    }
  }, [url]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigate(inputUrl);
    }
  }, [inputUrl, navigate]);

  return (
    <div className="win95-browser">
      <div className="win95-browser-toolbar">
        <button
          className="win95-browser-btn"
          onClick={goBack}
          disabled={historyIdx <= 0}
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          className="win95-browser-btn"
          onClick={goForward}
          disabled={historyIdx >= history.length - 1}
          title="Forward"
        >
          <ArrowRight size={14} />
        </button>
        <button
          className="win95-browser-btn"
          onClick={reload}
          disabled={!url}
          title="Reload"
        >
          <RotateCw size={14} />
        </button>
        <div className="win95-browser-address-bar">
          <Globe size={12} className="win95-browser-address-icon" />
          <input
            type="text"
            className="win95-browser-address-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL..."
          />
        </div>
        <button
          className="win95-browser-btn"
          onClick={() => navigate(inputUrl)}
          title="Go"
        >
          <span style={{ fontSize: 11, fontWeight: 'bold' }}>Go</span>
        </button>
      </div>
      <div className="win95-browser-content">
        {url ? (
          <iframe
            ref={iframeRef}
            src={url}
            className="win95-browser-iframe"
            title="Browser"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        ) : (
          <div className="win95-browser-empty">
            <Globe size={48} />
            <p>Enter a URL above to browse the web</p>
          </div>
        )}
      </div>
      <div className="win95-browser-statusbar">
        <span>{url ? 'Done' : 'Ready'}</span>
        <span>Internet Zone</span>
      </div>
    </div>
  );
}
