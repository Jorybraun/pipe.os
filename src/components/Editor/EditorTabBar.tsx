// ---------------------------------------------------------------------------
// EditorTabBar — section tabs for the challenge editor
// ---------------------------------------------------------------------------

interface Tab {
  key: string;
  label: string;
  badge?: string;
}

interface EditorTabBarProps {
  tabs: Tab[];
  activeKey: string;
  onSelect: (key: string) => void;
}

export function EditorTabBar({ tabs, activeKey, onSelect }: EditorTabBarProps): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(255,255,255,0.02)',
    }}>
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            onClick={() => onSelect(tab.key)}
            style={{
              padding: '12px 20px',
              background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid #a78bfa' : '2px solid transparent',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 10,
              fontWeight: 800,
              fontFamily: 'Space Mono',
              letterSpacing: '0.1em',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 150ms ease',
            }}
          >
            {tab.label}
            {tab.badge && (
              <span style={{
                fontSize: 8,
                fontWeight: 700,
                padding: '2px 6px',
                background: isActive ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.08)',
                color: isActive ? '#a78bfa' : 'rgba(255,255,255,0.3)',
                fontFamily: 'Space Mono',
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
