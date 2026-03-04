import { useState } from 'react';
import { X, Code, Shield, FileText, Zap } from 'lucide-react';

type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';

interface CreateChallengeModalProps {
  onClose: () => void;
  onCreate: (title: string, type: ChallengeType) => Promise<void>;
}

const TYPES: Array<{ value: ChallengeType; label: string; icon: any; desc: string }> = [
  { 
    value: 'CODE_REVIEW', 
    label: 'CODE REVIEW', 
    icon: Code, 
    desc: 'Candidate finds bugs and leaves comments on a provided snippet.' 
  },
  { 
    value: 'CODE_IMPLEMENTATION', 
    label: 'IMPLEMENTATION', 
    icon: Zap, 
    desc: 'Candidate writes code to solve a problem with automated tests.' 
  },
  { 
    value: 'QUIZ_MCQ', 
    label: 'MULTIPLE CHOICE', 
    icon: Shield, 
    desc: 'Single or multiple correct answers from a list of options.' 
  },
  { 
    value: 'QUIZ_SHORT_ANSWER', 
    label: 'SHORT ANSWER', 
    icon: FileText, 
    desc: 'Free-text response scored against a provided rubric.' 
  },
];

export function CreateChallengeModal({ onClose, onCreate }: CreateChallengeModalProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ChallengeType>('CODE_REVIEW');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setIsSubmitting(true);
    try {
      await onCreate(title, type);
    } catch (err) {
      console.error('Failed to create challenge:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontFamily: '"Space Mono", monospace',
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: 24
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          background: '#0c0c0e',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: 40,
          position: 'relative'
        }}
      >
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 24, right: 24, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}
        >
          <X size={20} />
        </button>

        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', fontFamily: '"Space Mono", monospace', marginBottom: 8 }}>
            STUDIO / INITIALIZATION
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: 0 }}>Create New Challenge</h2>
        </div>

        <div style={{ marginBottom: 32 }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace', marginBottom: 12 }}>
            CHALLENGE TITLE
          </label>
          <input
            autoFocus
            placeholder="e.g. Debugging React useEffect"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />

          <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace', marginBottom: 16 }}>
            CHALLENGE TYPE
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {TYPES.map((t) => {
              const isActive = type === t.value;
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  style={{
                    textAlign: 'left',
                    padding: 16,
                    background: isActive ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Icon size={14} color={isActive ? '#fff' : 'rgba(255,255,255,0.3)'} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#fff' : 'rgba(255,255,255,0.5)', fontFamily: '"Space Mono", monospace' }}>
                      {t.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', lineHeight: 1.4 }}>
                    {t.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
            }}
          >
            CANCEL
          </button>
          <button
            disabled={!title.trim() || isSubmitting}
            onClick={handleSubmit}
            style={{
              padding: '12px 32px',
              background: '#fff',
              border: 'none',
              borderRadius: 6,
              color: '#000',
              fontSize: 11,
              fontWeight: 800,
              fontFamily: '"Space Mono", monospace',
              cursor: (title.trim() && !isSubmitting) ? 'pointer' : 'not-allowed',
              opacity: (title.trim() && !isSubmitting) ? 1 : 0.5,
              transition: 'all 0.2s',
            }}
          >
            {isSubmitting ? 'CREATING...' : 'INITIALIZE_STUDIO'}
          </button>
        </div>
      </div>
    </div>
  );
}
