import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw } from 'lucide-react';
import {
  isKnownEmbedBlockedUrl,
  normalizeBrowserNavigationUrl,
  type BrowserNavigationTrigger,
} from '../lib/browserNavigationEvidence';

export interface BrowserWindowProps {
  initialUrl?: string;
  currentUrl?: string;
  onNavigate?: (url: string, metadata: { trigger: BrowserNavigationTrigger; knownEmbedBlocked: boolean }) => void;
}

export function BrowserWindow({ initialUrl = '', currentUrl, onNavigate }: BrowserWindowProps): JSX.Element {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>(initialUrl ? [initialUrl] : []);
  const [historyIdx, setHistoryIdx] = useState(initialUrl ? 0 : -1);
  const [iframeFailed, setIframeFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const embedBlocked = Boolean(url) && (isKnownEmbedBlockedUrl(url) || iframeFailed);

  useEffect(() => {
    if (currentUrl === undefined || currentUrl === url) return;
    setUrl(currentUrl);
    setInputUrl(currentUrl);
    setIframeFailed(false);
    if (!currentUrl) {
      setHistory([]);
      setHistoryIdx(-1);
      return;
    }
    setHistory((prev) => {
      if (prev[prev.length - 1] === currentUrl) return prev;
      const next = [...prev, currentUrl];
      setHistoryIdx(next.length - 1);
      return next;
    });
  }, [currentUrl, url]);

  const notifyNavigate = useCallback((nextUrl: string, trigger: BrowserNavigationTrigger): void => {
    onNavigate?.(nextUrl, { trigger, knownEmbedBlocked: isKnownEmbedBlockedUrl(nextUrl) });
  }, [onNavigate]);

  const navigate = useCallback((target: string, trigger: BrowserNavigationTrigger) => {
    const normalized = normalizeBrowserNavigationUrl(target);
    if (!normalized) return;
    setUrl(normalized);
    setInputUrl(normalized);
    setIframeFailed(false);
    const newHistory = history.slice(0, historyIdx + 1);
    newHistory.push(normalized);
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
    notifyNavigate(normalized, trigger);
  }, [history, historyIdx, notifyNavigate]);

  const goBack = useCallback(() => {
    if (historyIdx > 0) {
      const idx = historyIdx - 1;
      const nextUrl = history[idx];
      setHistoryIdx(idx);
      setUrl(nextUrl);
      setInputUrl(nextUrl);
      setIframeFailed(false);
      notifyNavigate(nextUrl, 'history_back');
    }
  }, [history, historyIdx, notifyNavigate]);

  const goForward = useCallback(() => {
    if (historyIdx < history.length - 1) {
      const idx = historyIdx + 1;
      const nextUrl = history[idx];
      setHistoryIdx(idx);
      setUrl(nextUrl);
      setInputUrl(nextUrl);
      setIframeFailed(false);
      notifyNavigate(nextUrl, 'history_forward');
    }
  }, [history, historyIdx, notifyNavigate]);

  const reload = useCallback(() => {
    if (iframeRef.current && url) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = '';
      iframeRef.current.src = currentSrc;
    }
  }, [url]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigate(inputUrl, 'address_bar');
    }
  }, [inputUrl, navigate]);

  const openExternally = useCallback((): void => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [url]);

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
            data-testid="room-browser-address-input"
          />
        </div>
        <button
          className="win95-browser-btn"
          onClick={() => navigate(inputUrl, 'go_button')}
          title="Go"
          data-testid="room-browser-go"
        >
          <span style={{ fontSize: 11, fontWeight: 'bold' }}>Go</span>
        </button>
      </div>
      <div className="win95-browser-content">
        {embedBlocked ? (
          <div className="win95-browser-blocked" data-testid="room-browser-embed-blocked">
            <Globe size={46} />
            <strong>This site blocks embedded browsing.</strong>
            <p>{url}</p>
            <button type="button" className="win95-browser-open-external" onClick={openExternally}>
              <ExternalLink size={14} />
              Open site
            </button>
          </div>
        ) : url ? (
          <iframe
            ref={iframeRef}
            src={url}
            className="win95-browser-iframe"
            title="Browser"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            onError={() => setIframeFailed(true)}
          />
        ) : (
          <div className="win95-browser-empty">
            <Globe size={48} />
            <p>Enter a URL above to browse the web</p>
          </div>
        )}
      </div>
      <div className="win95-browser-statusbar">
        <span>{embedBlocked ? 'Blocked by site' : url ? 'Done' : 'Ready'}</span>
        <span>Edge Zone</span>
      </div>
    </div>
  );
}
