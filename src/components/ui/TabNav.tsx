import { type ReactNode, type KeyboardEvent, useRef, useEffect } from 'react';

/**
 * Tab definition.
 */
export interface Tab {
  /**
   * Unique identifier for the tab.
   */
  id: string;

  /**
   * Display label for the tab.
   */
  label: string;

  /**
   * Optional icon component to display before the label.
   */
  icon?: ReactNode;
}

/**
 * Props for the TabNav component.
 */
export interface TabNavProps {
  /**
   * Array of tab definitions.
   */
  tabs: Tab[];

  /**
   * ID of the currently active tab.
   */
  activeTab: string;

  /**
   * Callback fired when a tab is selected.
   */
  onTabChange: (tabId: string) => void;
}

/**
 * Accessible tab navigation component with keyboard support.
 *
 * Implements WAI-ARIA tab pattern with full keyboard navigation:
 * - Arrow Left/Right: Navigate between tabs
 * - Home/End: Jump to first/last tab
 * - Enter/Space: Activate focused tab
 *
 * @example
 * ```tsx
 * const tabs = [
 *   { id: 'question', label: 'QUESTION', icon: <Icon /> },
 *   { id: 'video', label: 'VIDEO' },
 * ];
 *
 * <TabNav
 *   tabs={tabs}
 *   activeTab="question"
 *   onTabChange={(id) => setActiveTab(id)}
 * />
 * ```
 */
export function TabNav({ tabs, activeTab, onTabChange }: TabNavProps): JSX.Element {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus the active tab when activeTab changes
  useEffect(() => {
    const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
    if (activeIndex !== -1 && tabRefs.current[activeIndex]) {
      tabRefs.current[activeIndex]?.focus();
    }
  }, [activeTab, tabs]);

  /**
   * Handle keyboard navigation.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let newIndex: number | null = null;

    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        newIndex = index > 0 ? index - 1 : tabs.length - 1;
        break;

      case 'ArrowRight':
        event.preventDefault();
        newIndex = index < tabs.length - 1 ? index + 1 : 0;
        break;

      case 'Home':
        event.preventDefault();
        newIndex = 0;
        break;

      case 'End':
        event.preventDefault();
        newIndex = tabs.length - 1;
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        onTabChange(tabs[index]!.id);
        break;

      default:
        break;
    }

    if (newIndex !== null && tabRefs.current[newIndex]) {
      tabRefs.current[newIndex]?.focus();
      onTabChange(tabs[newIndex]!.id);
    }
  };

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 2,
        marginBottom: 24,
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`${tab.id}-panel`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{
              padding: '12px 24px',
              background: isActive
                ? 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(200,200,220,0.08))'
                : 'transparent',
              border: `1px solid ${isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
              borderBottom: isActive
                ? '2px solid rgba(255,255,255,0.4)'
                : '1px solid rgba(255,255,255,0.06)',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 10,
              letterSpacing: '0.15em',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
