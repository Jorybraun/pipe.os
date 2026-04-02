import { ReactNode, useState } from 'react';
import { ChevronUp, ChevronDown, Play } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunState {
  status: 'idle' | 'running' | 'success' | 'error';
  logs: string[];
  error?: string;
  durationMs?: number;
}

interface ChallengeWorkspaceProps {
  layoutType: 'browser' | 'algorithm';
  descriptionPanel: ReactNode;
  codeEditorPanel: ReactNode;
  /** Browser mode: live preview panel */
  previewPanel?: ReactNode;
  /** Algorithm mode: test cases panel */
  testCasesPanel?: ReactNode;
  /** Node rendered in the right panel's tab bar (e.g. language selector) */
  codeHeaderRight?: ReactNode;
  language?: string;
  onRun?: (() => void) | undefined;
  runState?: RunState;
}

// ---------------------------------------------------------------------------
// PanelHeader
// ---------------------------------------------------------------------------

interface Tab {
  id: string;
  label: string;
}

function PanelHeader({
  tabs,
  activeTab,
  onTabChange,
  right,
}: {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  right?: ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 44,
        flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: '#111113',
      }}
    >
      {/* + button */}
      <button
        style={{
          width: 44,
          background: 'none',
          border: 'none',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          color: 'var(--pipe-text-dim)',
          fontSize: 18,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        +
      </button>

      {/* Tabs */}
      <div style={{ display: 'flex', flex: 1, alignItems: 'stretch' }}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active
                  ? '2px solid rgba(255,255,255,0.85)'
                  : '2px solid transparent',
                color: active
                  ? 'rgba(255,255,255,0.9)'
                  : 'rgba(255,255,255,0.35)',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                fontFamily: 'inherit',
                padding: '0 20px',
                cursor: tabs.length > 1 ? 'pointer' : 'default',
                letterSpacing: 0,
                transition: 'color 0.1s',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Right slot: language selector or ··· */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          paddingRight: 12,
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          paddingLeft: 12,
        }}
      >
        {right ?? (
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              fontSize: 16,
              cursor: 'pointer',
              letterSpacing: 1,
              padding: 0,
            }}
          >
            ···
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConsoleStrip
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<RunState['status'], string> = {
  idle: 'rgba(255,255,255,0.2)',
  running: '#60a5fa',
  success: '#34d399',
  error: '#f87171',
};

const STATUS_LABELS: Record<RunState['status'], string> = {
  idle: 'IDLE',
  running: 'RUNNING',
  success: 'PASS',
  error: 'FAIL',
};

function ConsoleStrip({
  onRun,
  runState,
}: {
  onRun?: (() => void) | undefined;
  runState?: RunState;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const state = runState ?? { status: 'idle' as const, logs: [] };

  return (
    <div
      style={{
        flexShrink: 0,
        height: open ? 220 : 44,
        transition: 'height 0.18s ease',
        overflow: 'hidden',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        background: '#0e0e10',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header row */}
      <div
        style={{
          height: 44,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
        }}
      >
        {/* Left: status + label + toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--pipe-text-dim)',
            fontSize: 12,
            fontFamily: 'inherit',
            padding: 0,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: STATUS_COLORS[state.status],
              flexShrink: 0,
              transition: 'background 0.2s',
            }}
          />
          Run tests / Console
          <span style={{ color: STATUS_COLORS[state.status], fontSize: 11 }}>
            {STATUS_LABELS[state.status]}
            {typeof state.durationMs === 'number' ? ` / ${state.durationMs}ms` : ''}
          </span>
          {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>

        {/* Right: Run + Submit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onRun}
            disabled={!onRun || state.status === 'running'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 6,
              color:
                onRun && state.status !== 'running'
                  ? 'rgba(255,255,255,0.8)'
                  : 'rgba(255,255,255,0.2)',
              fontSize: 12,
              fontFamily: 'inherit',
              padding: '6px 14px',
              cursor:
                onRun && state.status !== 'running' ? 'pointer' : 'not-allowed',
            }}
          >
            <Play size={11} />
            {state.status === 'running' ? 'Running...' : 'Run'}
          </button>
          <button
            style={{
              background: '#fbbf24',
              border: 'none',
              borderRadius: 6,
              color: '#000',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'inherit',
              padding: '6px 16px',
              cursor: 'pointer',
            }}
          >
            Submit
          </button>
        </div>
      </div>

      {/* Log output */}
      {open && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px 12px',
            fontFamily: 'Space Mono, monospace',
            fontSize: 11,
            lineHeight: 1.6,
          }}
        >
          {state.error && (
            <div style={{ color: '#f87171', marginBottom: 6 }}>{state.error}</div>
          )}
          {state.logs.length === 0 && !state.error ? (
            <span style={{ color: 'rgba(255,255,255,0.18)' }}>
              // Run tests to see output
            </span>
          ) : (
            state.logs.map((line, i) => (
              <div key={i} style={{ color: 'rgba(255,255,255,0.5)' }}>
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browser Layout
// ---------------------------------------------------------------------------

function BrowserWorkspace({
  descriptionPanel,
  codeEditorPanel,
  previewPanel,
  codeHeaderRight,
  language,
}: {
  descriptionPanel: ReactNode;
  codeEditorPanel: ReactNode;
  previewPanel: ReactNode;
  codeHeaderRight?: ReactNode;
  language: string;
}): JSX.Element {
  const [rightTab, setRightTab] = useState<'browser' | 'console'>('browser');
  const ext = language.toLowerCase() === 'typescript' ? 'tsx' : 'jsx';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '47% 1fr 30%',
        height: 'calc(100vh - 146px)',
        minHeight: 500,
        gap: '1px',
        background: 'var(--pipe-surface)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* Left: Description */}
      <div style={{ background: '#0f0f11', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <PanelHeader
          tabs={[
            { id: 'desc', label: 'Description' },
            { id: 'solution', label: 'Solution' },
          ]}
          activeTab="desc"
          onTabChange={() => {}}
        />
        <div style={{ flex: 1, overflowY: 'auto' }}>{descriptionPanel}</div>
      </div>

      {/* Center: Code */}
      <div style={{ background: '#0c0c0e', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <PanelHeader
          tabs={[{ id: 'code', label: `App.${ext}` }]}
          activeTab="code"
          onTabChange={() => {}}
          right={codeHeaderRight}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {codeEditorPanel}
        </div>
      </div>

      {/* Right: Browser / Console */}
      <div style={{ background: '#0f0f11', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <PanelHeader
          tabs={[
            { id: 'browser', label: 'Browser' },
            { id: 'console', label: 'Console' },
          ]}
          activeTab={rightTab}
          onTabChange={(id) => setRightTab(id as 'browser' | 'console')}
        />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: rightTab === 'browser' ? 'flex' : 'none',
            flexDirection: 'column',
          }}
        >
          {previewPanel}
        </div>
        {rightTab === 'console' && (
          <div
            style={{
              flex: 1,
              padding: 16,
              fontFamily: 'Space Mono, monospace',
              fontSize: 11,
              color: 'var(--pipe-text-dim)',
              overflowY: 'auto',
            }}
          >
            // Console output will appear here
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Algorithm Layout
// ---------------------------------------------------------------------------

function AlgorithmWorkspace({
  descriptionPanel,
  codeEditorPanel,
  testCasesPanel,
  codeHeaderRight,
  onRun,
  runState,
}: {
  descriptionPanel: ReactNode;
  codeEditorPanel: ReactNode;
  testCasesPanel: ReactNode;
  codeHeaderRight?: ReactNode;
  onRun?: (() => void) | undefined;
  runState?: RunState;
}): JSX.Element {
  const [rightTab, setRightTab] = useState<'code' | 'testcases'>('code');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 146px)',
        minHeight: 500,
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* Two-column grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '47% 1fr',
          gap: '1px',
          background: 'var(--pipe-surface)',
        }}
      >
        {/* Left: Description */}
        <div style={{ background: '#0f0f11', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PanelHeader
            tabs={[
              { id: 'desc', label: 'Description' },
              { id: 'solution', label: 'Solution' },
              { id: 'submissions', label: 'Submissions' },
            ]}
            activeTab="desc"
            onTabChange={() => {}}
          />
          <div style={{ flex: 1, overflowY: 'auto' }}>{descriptionPanel}</div>
        </div>

        {/* Right: Code / Test Cases */}
        <div style={{ background: '#0c0c0e', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PanelHeader
            tabs={[
              { id: 'code', label: 'Code' },
              { id: 'testcases', label: 'Test cases' },
            ]}
            activeTab={rightTab}
            onTabChange={(id) => setRightTab(id as 'code' | 'testcases')}
            right={codeHeaderRight}
          />
          {/* display:none preserves Monaco instance across tab switches */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: rightTab === 'code' ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            {codeEditorPanel}
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: rightTab === 'testcases' ? 'flex' : 'none',
              flexDirection: 'column',
              overflowY: 'auto',
            }}
          >
            {testCasesPanel}
          </div>
        </div>
      </div>

      {/* Console strip */}
      <ConsoleStrip
        {...(onRun !== undefined ? { onRun } : {})}
        {...(runState !== undefined ? { runState } : {})}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChallengeWorkspace — public export
// ---------------------------------------------------------------------------

export function ChallengeWorkspace({
  layoutType,
  descriptionPanel,
  codeEditorPanel,
  previewPanel,
  testCasesPanel,
  codeHeaderRight,
  language = 'javascript',
  onRun,
  runState,
}: ChallengeWorkspaceProps): JSX.Element {
  if (layoutType === 'browser') {
    return (
      <BrowserWorkspace
        descriptionPanel={descriptionPanel}
        codeEditorPanel={codeEditorPanel}
        previewPanel={previewPanel ?? <div />}
        codeHeaderRight={codeHeaderRight}
        language={language}
      />
    );
  }

  return (
    <AlgorithmWorkspace
      descriptionPanel={descriptionPanel}
      codeEditorPanel={codeEditorPanel}
      codeHeaderRight={codeHeaderRight}
      {...(onRun !== undefined ? { onRun } : {})}
      {...(runState !== undefined ? { runState } : {})}
      testCasesPanel={
        testCasesPanel ?? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'Space Mono',
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              letterSpacing: '0.1em',
            }}
          >
            TEST_CASES_COMING_SOON
          </div>
        )
      }
    />
  );
}
