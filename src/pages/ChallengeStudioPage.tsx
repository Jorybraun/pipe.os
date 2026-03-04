import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  Eye, 
  Plus,
  Trash2,
} from 'lucide-react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { Skeleton } from '../components/ui/Skeleton';
import { ChallengeRegistry } from '../components/Assessment/ChallengeRegistry';

const client = generateClient<Schema>();

type Challenge = Schema['Challenge']['type'];

/**
 * ChallengeStudioPage - Simple, airy challenge authoring.
 * Styled after the Scheduling page (clean rows, glassy borders, no heavy cards).
 */
export default function ChallengeStudioPage(): JSX.Element {
  const { challengeId } = useParams<{ challengeId: string }>();
  const navigate = useNavigate();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const fetchData = useCallback(async () => {
    if (!challengeId) return;
    try {
      setIsLoading(true);
      const { data } = await client.models.Challenge.get({ id: challengeId });
      if (data) {
        setChallenge(data);
      }
    } catch (err) {
      console.error('[ChallengeStudio] Error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [challengeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!challenge) return;
    setIsSaving(true);
    try {
      await client.models.Challenge.update({
        id: challenge.id,
        title: challenge.title,
        instructions: challenge.instructions,
        config: challenge.config,
        serverConfig: challenge.serverConfig,
      });
      // Optional: success toast
    } catch (err) {
      console.error('[ChallengeStudio] Save Error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '0 20px' }}>
        <Skeleton width={120} height={8} style={{ marginBottom: 12 }} />
        <Skeleton width={300} height={32} style={{ marginBottom: 48 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3, 4].map(i => <Skeleton key={i} height={80} style={{ borderRadius: 8 }} />)}
        </div>
      </div>
    );
  }

  if (!challenge) return <div style={{ padding: 40, color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono' }}>NOT_FOUND</div>;

  const isReadOnly = !!challenge.isSystem;

  const handleClone = async () => {
    try {
      const { data: newChallenge } = await client.models.Challenge.create({
        title: `${challenge.title} (Copy)`,
        type: challenge.type as any,
        instructions: challenge.instructions,
        config: challenge.config,
        serverConfig: challenge.serverConfig,
        isSystem: false,
      });
      if (newChallenge) {
        navigate(`/studio/${newChallenge.id}`, { replace: true });
      }
    } catch (err) {
      console.error('[ChallengeStudio] Clone Error:', err);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px 100px' }}>
      {/* Simple Header */}
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start', 
        marginBottom: 48 
      }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <button 
            onClick={() => navigate(-1)}
            style={{ 
              background: 'rgba(255,255,255,0.03)', 
              border: '1px solid rgba(255,255,255,0.08)', 
              color: 'rgba(255,255,255,0.4)', 
              padding: '8px', 
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
              {isReadOnly ? 'SYSTEM_TEMPLATE' : 'CHALLENGE_DESIGN'} / {challenge.type}
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', margin: 0 }}>
              {challenge.title}
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            style={{
              padding: '10px 20px',
              background: isPreviewMode ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4,
              color: isPreviewMode ? '#fff' : 'rgba(255,255,255,0.5)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer'
            }}
          >
            <Eye size={12} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {isPreviewMode ? 'DESIGN_MODE' : 'PREVIEW'}
          </button>
          
          {isReadOnly ? (
            <button
              onClick={handleClone}
              style={{
                padding: '10px 24px',
                background: '#fff',
                border: 'none',
                borderRadius: 4,
                color: '#000',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer'
              }}
            >
              <Plus size={12} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              CLONE_TO_EDIT
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={isSaving}
              style={{
                padding: '10px 24px',
                background: '#fff',
                border: 'none',
                borderRadius: 4,
                color: '#000',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer'
              }}
            >
              <Save size={12} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {isSaving ? 'SAVING...' : 'SAVE'}
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      {isPreviewMode ? (
        <div style={{ 
          background: 'rgba(255,255,255,0.02)', 
          border: '1px solid rgba(255,255,255,0.06)', 
          borderRadius: 12,
          overflow: 'hidden',
          minHeight: 600
        }}>
          <ChallengeRegistry 
            challenge={challenge as any}
            onSubmissionChange={() => {}}
            onSubmit={() => {}}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: isReadOnly ? 0.7 : 1 }}>
          {/* Section: Basic Info */}
          <DesignRow 
            label="TITLE" 
            value={challenge.title} 
            readOnly={isReadOnly}
            onChange={(val) => setChallenge({...challenge, title: val})} 
          />

          <DesignRow 
            label="INSTRUCTIONS" 
            type="textarea"
            readOnly={isReadOnly}
            value={challenge.instructions || ''} 
            onChange={(val) => setChallenge({...challenge, instructions: val})} 
          />

          {/* Section: Challenge-Specific Config */}
          <div style={{ marginTop: 24, marginBottom: 12, fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)', fontFamily: 'Space Mono' }}>
            CONFIGURATION {isReadOnly && '(READ_ONLY)'}
          </div>

          {challenge.type === 'QUIZ_MCQ' && (
            <MCQEditor 
              challenge={challenge} 
              readOnly={isReadOnly}
              onChange={(updates) => setChallenge({...challenge, ...updates})} 
            />
          )}

          {challenge.type === 'CODE_REVIEW' && (
            <CodeEditor 
              label="SOURCE_CODE"
              readOnly={isReadOnly}
              value={(() => {
                const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                return config.code || '';
              })()}
              onChange={(val) => {
                const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                setChallenge({...challenge, config: JSON.stringify({...config, code: val})});
              }}
            />
          )}

          {challenge.type === 'QUIZ_SHORT_ANSWER' && (
            <DesignRow 
              label="SCORING_RUBRIC"
              type="textarea"
              readOnly={isReadOnly}
              value={(() => {
                const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                return config.rubric || '';
              })()}
              onChange={(val) => {
                const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
                setChallenge({...challenge, config: JSON.stringify({...config, rubric: val})});
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * DesignRow - A clean, glassy row for simple data entry.
 */
function DesignRow({ 
  label, 
  value, 
  onChange, 
  type = 'text',
  readOnly = false
}: { 
  label: string; 
  value: string; 
  onChange: (val: string) => void;
  type?: 'text' | 'textarea';
  readOnly?: boolean;
}): JSX.Element {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '200px 1fr',
      alignItems: type === 'text' ? 'center' : 'flex-start',
      gap: 32,
      padding: '24px 32px',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 8,
      transition: 'border-color 0.2s',
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono' }}>
        {label}
      </div>
      {type === 'text' ? (
        <input 
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          style={{ 
            background: 'transparent', 
            border: 'none', 
            color: readOnly ? 'rgba(255,255,255,0.5)' : '#fff', 
            fontSize: 14, 
            outline: 'none',
            width: '100%'
          }}
        />
      ) : (
        <textarea 
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          style={{ 
            background: 'transparent', 
            border: 'none', 
            color: readOnly ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.8)', 
            fontSize: 14, 
            outline: 'none',
            width: '100%',
            resize: 'none',
            lineHeight: 1.6
          }}
        />
      )}
    </div>
  );
}

/**
 * MCQEditor - Specialized editor for multiple choice.
 */
function MCQEditor({ challenge, onChange, readOnly }: { challenge: Challenge; onChange: (updates: Partial<Challenge>) => void; readOnly: boolean }): JSX.Element {
  const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
  const srvConfig = typeof challenge.serverConfig === 'string' ? JSON.parse(challenge.serverConfig) : (challenge.serverConfig || {});
  const options = config.options || [];
  const correctId = srvConfig.correctOptionId;

  const updateOptions = (newOptions: any[]) => {
    if (readOnly) return;
    onChange({ 
      config: JSON.stringify({ ...config, options: newOptions }),
      serverConfig: JSON.stringify({ ...srvConfig, options: newOptions })
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map((opt: any, idx: number) => (
        <div key={opt.id} style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr 100px',
          alignItems: 'center',
          gap: 16,
          padding: '12px 24px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 8,
        }}>
          <button 
            onClick={() => {
              if (readOnly) return;
              const newSrv = { ...srvConfig, correctOptionId: opt.id };
              onChange({ serverConfig: JSON.stringify(newSrv) });
            }}
            style={{
              width: 20, height: 20, borderRadius: '50%',
              background: correctId === opt.id ? '#4ade80' : 'transparent',
              border: `2px solid ${correctId === opt.id ? '#4ade80' : 'rgba(255,255,255,0.1)'}`,
              cursor: readOnly ? 'default' : 'pointer'
            }}
          />
          <input 
            value={opt.text}
            readOnly={readOnly}
            onChange={(e) => {
              const newOpts = [...options];
              newOpts[idx] = { ...opt, text: e.target.value };
              updateOptions(newOpts);
            }}
            style={{ background: 'transparent', border: 'none', color: readOnly ? 'rgba(255,255,255,0.5)' : '#fff', fontSize: 13, outline: 'none' }}
          />
          {!readOnly && (
            <button 
              onClick={() => updateOptions(options.filter((_: any, i: number) => i !== idx))}
              style={{ background: 'none', border: 'none', color: 'rgba(255,80,80,0.3)', cursor: 'pointer', textAlign: 'right' }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button 
          onClick={() => {
            const nextId = String.fromCharCode(97 + options.length);
            updateOptions([...options, { id: nextId, text: '' }]);
          }}
          style={{
            marginTop: 8,
            padding: '12px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.3)',
            fontSize: 10,
            fontFamily: 'Space Mono',
            cursor: 'pointer'
          }}
        >
          + ADD_OPTION
        </button>
      )}
    </div>
  );
}

/**
 * CodeEditor - Minimal code row.
 */
function CodeEditor({ label, value, onChange, readOnly }: { label: string; value: string; onChange: (v: string) => void; readOnly: boolean }): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: '24px 32px',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 8,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono' }}>
        {label}
      </div>
      <textarea 
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        rows={15}
        style={{ 
          background: 'rgba(0,0,0,0.2)', 
          border: '1px solid rgba(255,255,255,0.06)', 
          borderRadius: 8,
          padding: 20,
          color: readOnly ? '#60a5fa80' : '#60a5fa', 
          fontSize: 13, 
          fontFamily: 'Space Mono',
          outline: 'none',
          width: '100%',
          resize: 'none',
          lineHeight: 1.6
        }}
      />
    </div>
  );
}

