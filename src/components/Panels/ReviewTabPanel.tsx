/**
 * ReviewTabPanel — Tabbed right panel for code review.
 *
 * When enableExplainer is on, shows two tabs:
 *   - REVIEW: the existing ReviewConversationPanel (bug-finding + implementer)
 *   - ASK: the ExplainerPanel (free-form questions to the PR author)
 *
 * When enableExplainer is off, renders ReviewConversationPanel directly.
 */

import { useState } from 'react';
import { MessageSquare, HelpCircle } from 'lucide-react';
import { useInterview } from '../../contexts/InterviewContext';
import { TabNav, type Tab } from '../ui/TabNav';
import { ReviewConversationPanel } from './ReviewConversationPanel';
import { ExplainerPanel } from './ExplainerPanel';

// ─── Tab definitions ────────────────────────────────────────────────────────

const TABS: Tab[] = [
  { id: 'review', label: 'REVIEW', icon: <MessageSquare size={12} /> },
  { id: 'ask', label: 'ASK', icon: <HelpCircle size={12} /> },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function ReviewTabPanel(): JSX.Element {
  const ctx = useInterview();
  const [activeTab, setActiveTab] = useState<string>('review');

  const challengeData = ctx.currentChallenge?.data as Record<string, unknown> | undefined;
  const enableExplainer = !!challengeData?.enableExplainer;

  // No explainer — render review panel directly
  if (!enableExplainer) {
    return <ReviewConversationPanel />;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'rgba(12,12,14,0.95)',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Tab navigation */}
      <div style={{ padding: '12px 16px 0' }}>
        <TabNav
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        id={`${activeTab}-panel`}
        aria-labelledby={activeTab}
        style={{ flex: 1, overflow: 'hidden' }}
      >
        {activeTab === 'review' && <ReviewConversationPanel />}
        {activeTab === 'ask' && <ExplainerPanel />}
      </div>
    </div>
  );
}
