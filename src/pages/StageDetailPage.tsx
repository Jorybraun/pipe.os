import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Settings } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../components';
import { Skeleton } from '../components/ui/Skeleton';
import { ChallengeCard } from '../components/Pipeline/ChallengeCard';
import { ChallengePicker } from '../components/Pipeline/ChallengePicker';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

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

  const fetchData = useCallback(async () => {
    if (!stageId) return;
    try {
      setIsLoading(true);
      const { data: stages } = await client.models.Stage.list({ 
        filter: { id: { eq: stageId } },
        selectionSet: [
          'id', 'title', 'order', 'timeLimit', 
          'challenges.*'
        ]
      });
      
      const data = stages[0];
      if (data) {
        setStage(data);
      }
    } catch (err) {
      console.error('[StageDetail] Error fetching stage:', err);
    } finally {
      setIsLoading(false);
    }
  }, [stageId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleChallengeSelect = async (template: any) => {
    if (!stageId) return;
    setPickerOpen(false);
    setIsLoading(true);
    try {
      await client.models.Challenge.create({
        stageId: stageId,
        type: template.type,
        title: template.title,
        instructions: template.instructions,
        config: JSON.stringify(template.config),
        order: stage?.challenges?.length || 0,
      });
      await fetchData();
    } catch (err) {
      console.error("Failed to add challenge:", err);
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
              onChange={async (e) => {
                const newVal = e.target.value;
                setStage({ ...stage, title: newVal });
                // In real app, would debounce this
                await client.models.Stage.update({ id: stage.id, title: newVal });
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
            <div style={{ marginTop: 20 }}>
              {challenges.map((c, i) => (
                <ChallengeCard 
                  key={c.id} 
                  challenge={c} 
                  index={i} 
                  onEdit={() => navigate(`/pipeline/${pipelineId}/challenges/${c.id}`)}
                  onDelete={handleChallengeDelete}
                />
              ))}
            </div>
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
