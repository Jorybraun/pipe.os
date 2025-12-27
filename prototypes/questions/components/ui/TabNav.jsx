import React from 'react';

/**
 * Tab navigation component.
 * Stateless - navigation state controlled by parent.
 */
export function TabNav({ activeTab, onTabChange, tabs }) {
  return (
    <div style={{ display: 'flex', gap: 2, marginBottom: 24 }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          style={{
            padding: '12px 24px',
            background: activeTab === tab.id
              ? 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(200,200,220,0.08))'
              : 'transparent',
            border: `1px solid ${activeTab === tab.id ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
            borderBottom: activeTab === tab.id ? '2px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.06)',
            color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.4)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            letterSpacing: '0.15em',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <tab.icon size={14} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
