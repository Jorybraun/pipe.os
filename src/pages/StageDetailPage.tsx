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
      const { data } = await client.models.Stage.get({ 
        id: stageId,
      }, {
        selectionSet: ['id', 'order', 'challenges.id', 'challenges.title', 'challenges.type', 'challenges.order', 'challenges.instructions']
      } as any);
      
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

  const handleChallengeSelect = async (type: any) => {
    if (!stageId) return;
    setPickerOpen(false);
    setIsLoading(true);
    try {
      await client.models.Challenge.create({
        stageId: stageId,
        type,
        title: `New ${type.replace('_', ' ')}`,
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

  const challenges = [...(stage.challenges || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

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
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>Stage Details</h1>
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
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
              Settings for this stage container. You can add multiple challenges that the candidate will complete in sequence.
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
