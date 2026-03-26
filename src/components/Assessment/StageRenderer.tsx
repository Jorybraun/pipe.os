import type { ReactNode } from 'react';
import { useInterview } from '../../contexts/InterviewContext';
import { COMPONENT_MAP } from '../../lib/challenge/componentMap';

// ---------------------------------------------------------------------------
// StageRenderer — wraps ChallengeRenderer in stage-level shells
// ---------------------------------------------------------------------------

export function StageRenderer(): JSX.Element {
  const { stageConfig } = useInterview();

  let content: JSX.Element = <ChallengeRenderer />;

  // Wrap stage-level shells outside-in (reverse so first in array = outermost)
  for (const shellType of [...stageConfig.shells].reverse()) {
    const Shell = COMPONENT_MAP[shellType];
    if (Shell) {
      content = <Shell>{content}</Shell>;
    }
  }

  return content;
}

// ---------------------------------------------------------------------------
// ChallengeRenderer — reads current challenge config, builds layout + panels
// ---------------------------------------------------------------------------

function ChallengeRenderer(): JSX.Element {
  const { currentChallenge } = useInterview();
  const { shells, layout, panels } = currentChallenge;

  // Build slot map: position → ReactNode[]
  const slots: Record<string, ReactNode> = {};
  for (const [position, panelTypes] of Object.entries(panels)) {
    if (!panelTypes) continue;
    slots[position] = (
      <>
        {(panelTypes as string[]).map((type: string) => {
          const Panel = COMPONENT_MAP[type];
          if (!Panel) return <div key={type} />;
          return <Panel key={type} />;
        })}
      </>
    );
  }

  // Resolve layout component — it receives slots generically
  const Layout = COMPONENT_MAP[layout];
  let content: JSX.Element;

  if (Layout) {
    // Pass slots as props — layouts destructure what they need
    content = <Layout slots={slots} />;
  } else {
    // No layout found — render panels flat
    content = <>{Object.values(slots)}</>;
  }

  // Wrap challenge-level shells
  for (const shellType of [...shells].reverse()) {
    const Shell = COMPONENT_MAP[shellType];
    if (Shell) {
      content = <Shell>{content}</Shell>;
    }
  }

  return content;
}
