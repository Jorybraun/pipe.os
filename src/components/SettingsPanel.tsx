/**
 * SettingsPanel — Tabbed settings panel with Display + Integrations sections.
 *
 * Replaces the old DisplaySettingsPanel in the agentPanel slot.
 */

import { useState } from 'react';
import { X, Palette, Link2 } from 'lucide-react';
import { DisplaySettings } from './settings/DisplaySettings';
import { IntegrationsSettings } from './settings/IntegrationsSettings';

type SettingsTab = 'display' | 'integrations';

interface SettingsPanelProps {
  onClose: () => void;
  /** Which tab to open initially */
  initialTab?: SettingsTab | undefined;
}

export function SettingsPanel({ onClose, initialTab = 'display' }: SettingsPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const tabs: { key: SettingsTab; label: string; icon: JSX.Element }[] = [
    { key: 'display', label: 'DISPLAY', icon: <Palette size={12} /> },
    { key: 'integrations', label: 'INTEGRATIONS', icon: <Link2 size={12} /> },
  ];

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: '"Space Mono", monospace',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '20px 20px 0',
      }}>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.2em',
          color: 'var(--pipe-text-dim)',
        }}>
          SETTINGS
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        padding: '16px 20px 0',
        borderBottom: '1px solid var(--pipe-border, rgba(255,255,255,0.06))',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '10px 0',
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.12em',
              fontFamily: '"Space Mono", monospace',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.key
                ? '2px solid var(--pipe-accent)'
                : '2px solid transparent',
              color: activeTab === tab.key ? 'var(--pipe-accent)' : 'var(--pipe-text-dim)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'display' && <DisplaySettings />}
        {activeTab === 'integrations' && <IntegrationsSettings />}
      </div>
    </div>
  );
}
