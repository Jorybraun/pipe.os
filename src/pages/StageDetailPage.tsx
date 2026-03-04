import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Settings, Video } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../components';
import { Skeleton } from '../components/ui/Skeleton';
import { ChallengeCard } from '../components/Pipeline/ChallengeCard';
import { ChallengePicker } from '../components/Pipeline/ChallengePicker';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

const client = generateClient<Schema>();

/**
 * StageDetailPage - Manage challenges within a specific stage.
 */
export default function StageDetailPage(): JSX.Element {
  const { id: pipelineId, stageId } = useParams<{ id: string; stageId: string }>();
  const navigate = useNavigate();

  const [stage, setStage] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  // False until we confirm Stage.mode exists in the deployed sandbox schema.
  // Run `npx ampx sandbox` to deploy Phase 8 schema, then this becomes true automatically.
  const [modeFieldReady, setModeFieldReady] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 5px movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Probe whether Stage.mode exists in the deployed sandbox schema.
  // The Amplify client validates field names against amplify_outputs.json at call-time.
  // If this throws, the Phase 8 schema hasn't been deployed yet (`npx ampx sandbox`).
  const checkModeField = useCallback(async (stageId: string) => {
    try {
      await client.models.Stage.list({
        filter: { id: { eq: stageId } },
        selectionSet: ['id', 'mode'],
      });
      setModeFieldReady(true);
    } catch {
      setModeFieldReady(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!stageId) return;
    try {
      setIsLoading(true);
      // Include 'mode' only once the schema probe confirms it exists in the deployed sandbox.
      const { data: stages } = modeFieldReady
        ? await client.models.Stage.list({
            filter: { id: { eq: stageId } },
            selectionSet: ['id', 'title', 'order', 'timeLimit', 'mode', 'challenges.*'],
          })
        : await client.models.Stage.list({
            filter: { id: { eq: stageId } },
            selectionSet: ['id', 'title', 'order', 'timeLimit', 'challenges.*'],
          });

      const data = stages[0];
      if (data) setStage(data);
    } catch (err) {
      console.error('[StageDetail] Error fetching stage:', err);
    } finally {
      setIsLoading(false);
    }
  }, [stageId, modeFieldReady]);

  useEffect(() => {
    if (stageId) void checkModeField(stageId);
  }, [stageId, checkModeField]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChallengeSelect = async (templates: any[]) => {
    if (!stageId) return;
    setPickerOpen(false);
    setIsLoading(true);
    try {
      const currentCount = stage?.challenges?.length || 0;
      
      // Create challenges in sequence to preserve order and avoid potential race conditions
      // although Promise.all would be faster, sequence is safer for 'order' field.
      for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        await client.models.Challenge.create({
          stageId: stageId,
          type: template.type,
          title: template.title,
          instructions: template.instructions,
          config: JSON.stringify(template.config),
          order: currentCount + i,
        });
      }
      
      await fetchData();
    } catch (err) {
      console.error("Failed to add challenges:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChallengeDelete = async (challenge: any) => {
    if (!window.confirm('Delete this challenge?')) return;
    try {
      await client.models.Challenge.delete({ id: challenge.id });
      await fetchData();
    } catch (err) {
      console.error('Failed to delete challenge:', err);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id && stage) {
      const oldIndex = stage.challenges.findIndex((c: any) => c.id === active.id);
      const newIndex = stage.challenges.findIndex((c: any) => c.id === over.id);
      
      if (oldIndex !== -1 && newIndex !== -1) {
        // Optimistic UI update
        const newChallenges = arrayMove(stage.challenges, oldIndex, newIndex).map((c: any, i: number) => ({
          ...c,
          order: i,
        }));
        
        setStage({ ...stage, challenges: newChallenges });

        // Batch save to backend
        try {
          await Promise.all(
            newChallenges.map((c: any) => 
              client.models.Challenge.update({ id: c.id, order: c.order })
            )
          );
        } catch (err) {
          console.error('Failed to update challenge order:', err);
          // Revert on failure
          fetchData();
        }
      }
    }
  };

  if (isLoading && !stage) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton width={200} height={32} style={{ marginBottom: 40 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} height={80} />)}
        </div>
      </div>
    );
  }

  if (!stage) return <div style={{ padding: 40, color: '#fff' }}>Stage not found.</div>;

  const challenges = [...(stage.challenges || [])]
    .filter(c => c !== null)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <button 
            onClick={() => navigate(`/pipeline/${pipelineId}`)} 
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: 'Space Mono' }}>
              PIPELINE_STAGE / {stage.id.substring(0, 8)}
            </div>
            <input 
              value={stage.title || ''}
              onChange={(e) => {
                const newVal = e.target.value;
                setStage({ ...stage, title: newVal });
              }}
              onBlur={async () => {
                if (stage.title) {
                  try {
                    await client.models.Stage.update({ id: stage.id, title: stage.title });
                  } catch (err) {
                    console.error("Failed to update stage title:", err);
                  }
                }
              }}
              style={{ 
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                fontSize: 24, 
                fontWeight: 800, 
                color: '#fff', 
                margin: 0,
                padding: '4px 0',
                outline: 'none',
                width: '100%',
                minWidth: 300
              }}
              placeholder="Stage Title"
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => setPickerOpen(true)}
            style={{ 
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px', 
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', 
              borderRadius: 4, color: '#fff', fontSize: 10, fontWeight: 700, 
              letterSpacing: '0.1em', fontFamily: 'Space Mono', cursor: 'pointer' 
            }}
          >
            <Plus size={14} />
            ADD_CHALLENGE
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 40, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SubTitle>CHALLENGES ({challenges.length})</SubTitle>
          
          {challenges.length > 0 ? (
            <DndContext 
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext 
                items={challenges.map(c => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div style={{ marginTop: 20 }}>
                  {challenges.map((c, i) => (
                    <ChallengeCard 
                      key={c.id} 
                      challenge={c} 
                      index={i} 
                      onDelete={handleChallengeDelete}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div style={{ 
              marginTop: 20, padding: '60px 24px', textAlign: 'center', 
              border: '1px dashed rgba(255,255,255,0.05)', borderRadius: 12 
            }}>
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginBottom: 24 }}>
                No challenges added to this stage yet.
              </div>
              <button
                onClick={() => setPickerOpen(true)}
                style={{ 
                  padding: '10px 20px', background: '#fff', color: '#000', 
                  border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 800, 
                  fontFamily: 'Space Mono', cursor: 'pointer' 
                }}
              >
                + ADD_FIRST_CHALLENGE
              </button>
            </div>
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <LiquidMetalCard variant="chrome" style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <Settings size={14} color="rgba(255,255,255,0.4)" />
              <div style={{ fontSize: 10, letterSpacing: '0.1em', fontWeight: 700, color: '#fff', fontFamily: 'Space Mono' }}>STAGE_SETTINGS</div>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <label style={{ display: 'block', fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: 'Space Mono' }}>
                  DEFAULT_TIME_LIMIT (MINS)
                </label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <input 
                    type="number"
                    value={stage.timeLimit || ''}
                    onChange={async (e) => {
                      const val = e.target.value ? parseInt(e.target.value) : null;
                      setStage({ ...stage, timeLimit: val });
                      await client.models.Stage.update({ id: stage.id, timeLimit: val });
                    }}
                    placeholder="Untimed"
                    style={{ 
                      flex: 1,
                      background: 'rgba(0,0,0,0.2)', 
                      border: '1px solid rgba(255,255,255,0.1)', 
                      padding: '8px 12px', 
                      color: '#fff', 
                      fontSize: 13, 
                      outline: 'none',
                      fontFamily: 'Space Mono'
                    }}
                  />
                </div>
                <p style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.2)', lineHeight: 1.4 }}>
                  Applied to all challenges in this stage unless overridden.
                </p>
              </div>

              {/* STAGE_MODE — ASYNC (default) or LIVE_VIDEO */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 12, fontFamily: 'Space Mono' }}>
                  <Video size={12} />
                  STAGE_MODE
                </label>
                {!modeFieldReady ? (
                  <div style={{ padding: '10px 12px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 4 }}>
                    <p style={{ margin: 0, fontSize: 9, color: 'rgba(251,191,36,0.7)', lineHeight: 1.6, fontFamily: 'Space Mono' }}>
                      ⚠ SCHEMA_NOT_DEPLOYED<br />
                      <span style={{ opacity: 0.6 }}>Run <code>npx ampx sandbox</code> to enable live video stages.</span>
                    </p>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 0, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden' }}>
                      {(['ASYNC', 'LIVE_VIDEO'] as const).map((m) => {
                        const isActive = (stage.mode ?? 'ASYNC') === m;
                        return (
                          <button
                            key={m}
                            onClick={async () => {
                              if (isActive) return;
                              setStage({ ...stage, mode: m });
                              try {
                                await client.models.Stage.update({ id: stage.id, mode: m });
                              } catch (err) {
                                console.error('[StageDetail] Failed to update mode:', err);
                                setStage({ ...stage, mode: stage.mode });
                              }
                            }}
                            style={{
                              flex: 1,
                              padding: '8px 0',
                              background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
                              border: 'none',
                              color: isActive ? '#fff' : 'rgba(255,255,255,0.3)',
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: '0.12em',
                              fontFamily: 'Space Mono',
                              cursor: isActive ? 'default' : 'pointer',
                              transition: 'background 0.15s, color 0.15s',
                            }}
                          >
                            {m === 'LIVE_VIDEO' ? '⦿ LIVE_VIDEO' : 'ASYNC'}
                          </button>
                        );
                      })}
                    </div>
                    {(stage.mode ?? 'ASYNC') === 'LIVE_VIDEO' && (
                      <p style={{ marginTop: 8, fontSize: 10, color: 'rgba(96,165,250,0.7)', lineHeight: 1.4 }}>
                        Candidate will join a live WebRTC video call before accessing challenges.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 20 }}>
                This stage acts as a container. Add technical challenges or questions that the candidate will complete in sequence.
              </div>
            </div>
          </LiquidMetalCard>
        </aside>
      </div>

      <ChallengePicker 
        isOpen={pickerOpen} 
        onClose={() => setPickerOpen(false)} 
        onSelect={handleChallengeSelect} 
      />
    </div>
  );
}
