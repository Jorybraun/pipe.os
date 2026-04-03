/**
 * ChallengeDndLayout — Nested layout route that wraps StageDetailPage
 * with a DndContext for drag-and-drop challenge management.
 *
 * Renders ChallengeBrowserPanel as a sidebar when on the /challenges sub-route.
 * The DndContext covers both the sidebar (drag source) and the page (drop target).
 *
 * Route structure:
 *   /pipeline/:id/stages/:stageId             → StageDetailPage (no sidebar)
 *   /pipeline/:id/stages/:stageId/challenges  → StageDetailPage + sidebar
 */

import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { ChallengeDndProvider, useChallengeDndState } from '../contexts/ChallengeDndContext';
import { ChallengeBrowserPanel } from '../components/Pipeline/ChallengeBrowserPanel';
import type { ChallengeTemplate } from '../content/challengeLibrary';

function ChallengeDndLayoutInner(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const panelOpen = location.pathname.endsWith('/challenges');
  const getState = useChallengeDndState();

  const [activeDrag, setActiveDrag] = useState<{
    type: 'template' | 'challenge';
    title: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const closePanel = (): void => {
    // Navigate up from /challenges to the stage detail
    const basePath = location.pathname.replace(/\/challenges$/, '');
    navigate(basePath, { replace: true });
  };

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current;
    if (data?.type === 'template') {
      setActiveDrag({ type: 'template', title: (data.template as ChallengeTemplate).title });
    } else if (data?.type === 'challenge') {
      setActiveDrag({ type: 'challenge', title: data.title as string });
    }
  };

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const state = getState();
    if (!state) return;

    const activeType = active.data.current?.type as string;

    if (activeType === 'template') {
      // Add new challenge from sidebar at drop position
      const template = active.data.current?.template as ChallengeTemplate;
      const challenges = state.challenges;

      // Compute insertion index from the over target
      let insertIndex = challenges.length;
      if (over.id !== 'challenge-list-droppable') {
        const overIndex = challenges.findIndex((c) => c.id === over.id);
        if (overIndex >= 0) insertIndex = overIndex + 1;
      }

      await state.createChallenge(state.stageId, {
        type: template.type,
        title: template.title,
        instructions: template.instructions,
        config: template.config as Record<string, unknown>,
        order: insertIndex,
      });
      await state.refetch();
    } else if (activeType === 'challenge') {
      // Reorder existing challenges
      const challenges = state.challenges;
      const oldIndex = challenges.findIndex((c) => c.id === active.id);
      const newIndex = challenges.findIndex((c) => c.id === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(challenges, oldIndex, newIndex).map((c, i) => ({
        id: c.id,
        order: i,
      }));
      await state.reorderChallenges(state.stageId, reordered);
      await state.refetch();
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={(e) => void handleDragEnd(e)}
    >
      <div style={{ display: 'flex', minHeight: '100%' }}>
        {panelOpen && <ChallengeBrowserPanel onClose={closePanel} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Outlet />
        </div>
      </div>
      <DragOverlay
        dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0.5' } },
          }),
        }}
      >
        {activeDrag && (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(12, 12, 14, 0.95)',
              border: '1px solid rgba(167,139,250,0.3)',
              borderRadius: 8,
              color: '#a78bfa',
              fontSize: 10,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
          >
            {activeDrag.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

export default function ChallengeDndLayout(): JSX.Element {
  return (
    <ChallengeDndProvider>
      <ChallengeDndLayoutInner />
    </ChallengeDndProvider>
  );
}
