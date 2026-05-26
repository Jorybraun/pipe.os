/**
 * EvidenceNodeBadge — small badge showing source icon + node type icon.
 *
 * Maps source_type and node_type to emoji icons and source colors.
 */

import type { EvidenceNode } from '../../lib/api/types';

interface EvidenceNodeBadgeProps {
  sourceType: EvidenceNode['sourceType'];
  nodeType: EvidenceNode['nodeType'];
}

const sourceIconMap: Record<string, string> = {
  resume: '📄',
  code_review_session: '🔧',
  culture_interview: '💬',
  screening: '📝',
  enrichment: '🔗',
};

const sourceColorMap: Record<string, string> = {
  resume: '#60a5fa',        // Blue
  code_review_session: '#a78bfa', // Purple
  culture_interview: '#fb923c',   // Orange
  screening: '#9ca3af',     // Gray
  enrichment: '#2dd4bf',    // Teal
};

const nodeTypeIconMap: Record<string, string> = {
  Experience: '💼',
  TechnicalDemonstration: '🔧',
  Skill: '🎯',
  CulturalSignal: '💬',
};

export function EvidenceNodeBadge({ sourceType, nodeType }: EvidenceNodeBadgeProps): JSX.Element {
  const sourceIcon = sourceIconMap[sourceType] ?? '📎';
  const nodeIcon = nodeTypeIconMap[nodeType] ?? '📎';
  const sourceColor = sourceColorMap[sourceType] ?? '#9ca3af';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: '"Space Mono", monospace',
        letterSpacing: '0.04em',
        color: sourceColor,
        background: `${sourceColor}14`,
        border: `1px solid ${sourceColor}33`,
      }}
      title={`${nodeType} from ${sourceType}`}
    >
      <span>{nodeIcon}</span>
      <span>{sourceIcon}</span>
    </span>
  );
}
