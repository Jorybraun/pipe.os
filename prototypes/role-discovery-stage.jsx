import React, { useState, useRef, useEffect } from 'react';

// ============================================================================
// INLINE SVG ICONS
// ============================================================================

const Icons = {
  User: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Users: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Target: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  GitBranch: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>,
  Clock: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  MessageSquare: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  FileText: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  Sparkles: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 19l.5 1.5L7 21l-1.5.5L5 23l-.5-1.5L3 21l1.5-.5L5 19z"/><path d="M19 11l.5 1.5L21 13l-1.5.5L19 15l-.5-1.5L17 13l1.5-.5L19 11z"/></svg>,
  Code: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  Zap: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Heart: ({ size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  ChevronDown: ({ size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>,
  Check: ({ size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
  X: ({ size = 10 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Send: ({ size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  AlertCircle: ({ size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  ArrowRight: ({ size = 14 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>,
  Brain: ({ size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>,
};

// ============================================================================
// DESIGN SYSTEM COMPONENTS
// ============================================================================

function LiquidMetalCard({ children, style = {}, variant = 'default', hover = false, onClick }) {
  const [isHovered, setIsHovered] = useState(false);
  
  const variants = {
    default: {
      background: `linear-gradient(135deg, 
        rgba(180, 180, 190, 0.08) 0%, 
        rgba(120, 120, 140, 0.04) 25%,
        rgba(200, 200, 210, 0.08) 50%,
        rgba(100, 100, 120, 0.04) 75%,
        rgba(160, 160, 180, 0.08) 100%
      )`,
      border: '1px solid rgba(255, 255, 255, 0.12)',
    },
    chrome: {
      background: `linear-gradient(135deg,
        rgba(220, 220, 230, 0.15) 0%,
        rgba(180, 180, 200, 0.08) 20%,
        rgba(255, 255, 255, 0.2) 40%,
        rgba(160, 160, 180, 0.08) 60%,
        rgba(200, 200, 220, 0.12) 80%,
        rgba(140, 140, 160, 0.08) 100%
      )`,
      border: '1px solid rgba(255, 255, 255, 0.2)',
    },
    mercury: {
      background: `linear-gradient(160deg,
        rgba(200, 210, 230, 0.12) 0%,
        rgba(180, 190, 220, 0.06) 30%,
        rgba(220, 225, 240, 0.15) 50%,
        rgba(170, 180, 210, 0.08) 70%,
        rgba(190, 200, 225, 0.1) 100%
      )`,
      border: '1px solid rgba(200, 210, 240, 0.15)',
    },
    dark: {
      background: `linear-gradient(135deg,
        rgba(40, 40, 50, 0.6) 0%,
        rgba(60, 60, 80, 0.5) 50%,
        rgba(30, 30, 40, 0.7) 100%
      )`,
      border: '1px solid rgba(255, 255, 255, 0.1)',
    },
  };
  
  const v = variants[variant];
  
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setIsHovered(true)}
      onMouseLeave={() => hover && setIsHovered(false)}
      style={{
        background: v.background,
        backdropFilter: 'blur(40px) saturate(150%)',
        WebkitBackdropFilter: 'blur(40px) saturate(150%)',
        border: v.border,
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        transform: isHovered ? 'translateY(-2px)' : 'none',
        boxShadow: isHovered 
          ? '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)'
          : 'inset 0 1px 0 rgba(255,255,255,0.1)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      <div style={{
        position: 'absolute',
        top: 0,
        left: isHovered ? '100%' : '-100%',
        width: '50%',
        height: '100%',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
        transition: 'left 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        pointerEvents: 'none',
      }} />
      {children}
    </div>
  );
}

function SubTitle({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
      <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{children}</span>
    </div>
  );
}

function SidebarNav({ activeSection, onSectionChange }) {
  const navItems = [
    { id: 'profile', icon: Icons.User },
    { id: 'pipeline', icon: Icons.Target },
    { id: 'flow', icon: Icons.GitBranch },
    { id: 'history', icon: Icons.Clock },
    { id: 'messages', icon: Icons.MessageSquare },
    { id: 'docs', icon: Icons.FileText },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {navItems.map(item => {
        const Icon = item.icon;
        const isActive = activeSection === item.id;
        return (
          <button key={item.id} onClick={() => onSectionChange(item.id)} style={{
            width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', cursor: 'pointer', position: 'relative',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            background: isActive ? 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))' : 'transparent',
            backdropFilter: isActive ? 'blur(20px)' : 'none',
            boxShadow: isActive ? '0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.2)' : 'none',
            color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
          }}>
            {isActive && <div style={{ position: 'absolute', left: -16, width: 3, height: 24, background: 'linear-gradient(180deg, rgba(255,255,255,0.8), rgba(200,200,220,0.6))', boxShadow: '0 0 12px rgba(255,255,255,0.4)' }} />}
            <Icon size={18} />
          </button>
        );
      })}
      
      <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)', margin: '12px 0' }} />
      
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, background: 'rgba(150,255,150,0.8)', boxShadow: '0 0 8px rgba(150,255,150,0.6)' }} />
        <button style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}>
          <Icons.Sparkles size={18} />
        </button>
        <div style={{ fontSize: 7, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 2 }}>AVG</div>
      </div>
    </div>
  );
}

// ============================================================================
// FORM SECTION COMPONENT
// ============================================================================

function FormSection({ icon: Icon, title, isOpen, onToggle, isComplete, children }) {
  return (
    <LiquidMetalCard variant="dark" style={{ marginBottom: 8 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          padding: 20,
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          cursor: 'pointer',
          fontFamily: '"Space Mono", monospace',
        }}
      >
        <div style={{
          width: 36,
          height: 36,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.4)',
        }}>
          <Icon size={16} />
        </div>
        <span style={{
          flex: 1,
          textAlign: 'left',
          fontSize: 10,
          letterSpacing: '0.15em',
          color: isOpen ? '#fff' : 'rgba(255,255,255,0.5)',
        }}>
          {title}
        </span>
        {isComplete && (
          <div style={{
            width: 8,
            height: 8,
            background: 'rgba(150,255,150,0.8)',
            boxShadow: '0 0 8px rgba(150,255,150,0.5)',
          }} />
        )}
        <div style={{
          color: 'rgba(255,255,255,0.3)',
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          <Icons.ChevronDown size={14} />
        </div>
      </button>
      {isOpen && (
        <div style={{ padding: '0 20px 24px 72px' }}>
          {children}
        </div>
      )}
    </LiquidMetalCard>
  );
}

// ============================================================================
// FORM INPUTS
// ============================================================================

function FieldLabel({ children, required }) {
  return (
    <div style={{
      fontSize: 8,
      letterSpacing: '0.2em',
      color: 'rgba(255,255,255,0.3)',
      marginBottom: 10,
      textTransform: 'uppercase',
    }}>
      {children} {required && <span style={{ color: 'rgba(255,100,100,0.6)' }}>*</span>}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '12px 16px',
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff',
  fontSize: 12,
  fontFamily: '"Space Mono", monospace',
  outline: 'none',
};

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
    />
  );
}

function SelectInput({ value, onChange, placeholder, options }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      style={{
        ...inputStyle,
        cursor: 'pointer',
        color: value ? '#fff' : 'rgba(255,255,255,0.3)',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function RadioGroup({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 20 }}>
      {options.map(opt => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <div style={{
            width: 16,
            height: 16,
            border: `2px solid ${value === opt ? 'rgba(139, 92, 246, 0.8)' : 'rgba(255,255,255,0.3)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {value === opt && (
              <div style={{ width: 8, height: 8, background: 'rgba(139, 92, 246, 0.8)' }} />
            )}
          </div>
          <input type="radio" checked={value === opt} onChange={() => onChange(opt)} style={{ display: 'none' }} />
          <span style={{ fontSize: 11, color: value === opt ? '#fff' : 'rgba(255,255,255,0.5)' }}>{opt}</span>
        </label>
      ))}
    </div>
  );
}

function TagsInput({ value = [], onChange, placeholder }) {
  const [input, setInput] = useState('');
  
  const add = () => {
    if (input.trim()) {
      onChange([...value, input.trim()]);
      setInput('');
    }
  };

  return (
    <div>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {value.map((tag, i) => (
            <span key={i} style={{
              padding: '6px 12px',
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.15))',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              fontSize: 10,
              color: 'rgba(139, 92, 246, 0.9)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              {tag}
              <span 
                style={{ cursor: 'pointer', opacity: 0.6 }}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Icons.X size={10} />
              </span>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); }}}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

function TextareaInput({ value, onChange, placeholder }) {
  return (
    <textarea
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      style={{
        ...inputStyle,
        resize: 'vertical',
        minHeight: 80,
        lineHeight: 1.7,
      }}
    />
  );
}

function FieldGroup({ label, required, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
    </div>
  );
}

// ============================================================================
// RIGHT PANEL
// ============================================================================

function RightPanel({ tab, setTab, baseline, context, progress, gaps }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    setMessages(m => [...m, { from: 'user', text: input.trim() }]);
    setInput('');
    setTimeout(() => {
      const q = input.toLowerCase();
      let r = "Ask me about the interview design process.";
      if (q.includes('why')) r = "Each field shapes the interview. Title sets difficulty, stack targets questions.";
      else if (q.includes('skip')) r = "60% completeness unlocks Phase 2. More context = better results.";
      else if (q.includes('next')) r = "Next, we select interview stages based on this role model.";
      setMessages(m => [...m, { from: 'agent', text: r }]);
    }, 350);
  };

  return (
    <div style={{
      width: 360,
      background: 'linear-gradient(180deg, rgba(20,20,30,0.95) 0%, rgba(15,15,25,0.98) 100%)',
      borderRight: '1px solid rgba(255,255,255,0.04)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {['AGENT', 'ROLE MODEL'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '16px 20px',
              background: tab === t ? 'rgba(255,255,255,0.02)' : 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid rgba(139, 92, 246, 0.8)' : '2px solid transparent',
              color: tab === t ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 9,
              letterSpacing: '0.15em',
              cursor: 'pointer',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'AGENT' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Agent header */}
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{
                width: 48,
                height: 48,
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(139, 92, 246, 0.9)',
              }}>
                <Icons.Brain size={20} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>
                  ROLE DISCOVERY AGENT
                </div>
                <div style={{ fontSize: 9, color: 'rgba(139, 92, 246, 0.8)', letterSpacing: '0.15em', marginTop: 4 }}>
                  PHASE 1
                </div>
              </div>
            </div>

            <LiquidMetalCard variant="dark" style={{ padding: 16 }}>
              <div style={{
                fontSize: 10,
                letterSpacing: '0.1em',
                color: progress >= 60 ? 'rgba(150,255,150,0.8)' : 'rgba(255,255,255,0.4)',
              }}>
                {progress >= 60 ? '✓ READY TO PROCEED' : 'WAITING FOR INPUT'}
              </div>
            </LiquidMetalCard>
          </div>

          {/* Progress */}
          <div style={{ padding: '0 24px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>COMPLETENESS</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{progress}%</span>
            </div>
            <div style={{ height: 4, background: 'rgba(255,255,255,0.06)' }}>
              <div style={{
                width: `${progress}%`,
                height: '100%',
                background: progress >= 60 
                  ? 'linear-gradient(90deg, rgba(150,255,150,0.5), rgba(150,255,150,0.9))'
                  : 'linear-gradient(90deg, rgba(139, 92, 246, 0.4), rgba(139, 92, 246, 0.8))',
                boxShadow: progress >= 60 
                  ? '0 0 12px rgba(150,255,150,0.4)'
                  : '0 0 10px rgba(139, 92, 246, 0.3)',
                transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </div>
          </div>

          {/* Chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
              {messages.length === 0 ? (
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, margin: 0 }}>
                  Ask me anything about this phase or what information helps design better interviews.
                </p>
              ) : messages.map((m, i) => (
                <LiquidMetalCard
                  key={i}
                  variant={m.from === 'user' ? 'dark' : 'mercury'}
                  style={{ padding: 12, marginBottom: 8 }}
                >
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, margin: 0 }}>
                    {m.text}
                  </p>
                </LiquidMetalCard>
              ))}
            </div>

            <div style={{ padding: '16px 24px 24px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && send()}
                  placeholder="Ask me anything..."
                  style={{ ...inputStyle, flex: 1, fontSize: 11 }}
                />
                <button
                  onClick={send}
                  style={{
                    padding: '12px 14px',
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))',
                    border: '1px solid rgba(139, 92, 246, 0.4)',
                    color: 'rgba(139, 92, 246, 0.9)',
                    cursor: 'pointer',
                  }}
                >
                  <Icons.Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {baseline ? (
            <LiquidMetalCard variant="chrome" style={{ padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                {baseline.level} {baseline.title}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 16, letterSpacing: '0.1em' }}>
                {baseline.department} · {baseline.location}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
                {baseline.teamSize} → {baseline.reportsTo}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {baseline.stack?.map((tech, i) => (
                  <span key={i} style={{
                    padding: '4px 8px',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    fontSize: 9,
                    color: 'rgba(255,255,255,0.6)',
                  }}>{tech}</span>
                ))}
              </div>
            </LiquidMetalCard>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: 0 }}>
                Complete the baseline to build the role model
              </p>
            </div>
          )}

          {Object.keys(context).length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <SubTitle>CONTEXT</SubTitle>
              <div style={{ marginTop: 16 }}>
                {Object.entries(context).map(([k, v]) => (
                  <LiquidMetalCard key={k} variant="dark" style={{ padding: 16, marginBottom: 8 }}>
                    <div style={{ fontSize: 8, letterSpacing: '0.15em', color: 'rgba(139, 92, 246, 0.8)', marginBottom: 8, textTransform: 'uppercase' }}>
                      {k.replace(/_/g, ' ')}
                    </div>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, margin: 0 }}>{v}</p>
                  </LiquidMetalCard>
                ))}
              </div>
            </div>
          )}

          {gaps.length > 0 && (
            <div>
              <SubTitle>GAPS</SubTitle>
              <div style={{ marginTop: 16 }}>
                {gaps.map((g, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'rgba(255,200,100,0.1)',
                    border: '1px solid rgba(255,200,100,0.2)',
                    marginBottom: 8,
                  }}>
                    <span style={{ color: 'rgba(255,200,100,0.9)' }}><Icons.AlertCircle size={14} /></span>
                    <span style={{ fontSize: 10, color: 'rgba(255,200,100,0.9)' }}>{g}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RoleDiscoveryPhase1() {
  const [mounted, setMounted] = useState(false);
  const [activeSection, setActiveSection] = useState('profile');
  const [data, setData] = useState({});
  const [openSection, setOpenSection] = useState('identity');
  const [tab, setTab] = useState('AGENT');

  useEffect(() => { setMounted(true); }, []);

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  const sections = {
    identity: ['title', 'level', 'department', 'location'],
    team: ['teamSize', 'reportsTo'],
    tech: ['stack'],
    success: ['successCriteria'],
    challenges: ['challenges'],
    culture: ['culture'],
  };

  const done = (s) => sections[s].every(k => {
    const v = data[k];
    return Array.isArray(v) ? v.length > 0 : v?.toString().trim();
  });

  const total = Object.values(sections).flat().length;
  const filled = Object.values(sections).flat().filter(k => {
    const v = data[k];
    return Array.isArray(v) ? v.length > 0 : v?.toString().trim();
  }).length;
  const progress = Math.round((filled / total) * 100);

  const gaps = [];
  if (!done('identity')) gaps.push('Role identity incomplete');
  if (!done('team')) gaps.push('Team context incomplete');
  if (!done('tech')) gaps.push('Technical environment incomplete');
  if (!done('success')) gaps.push('Success criteria undefined');

  const baseline = done('identity') && done('team') && done('tech') ? data : null;
  const context = {};
  if (data.successCriteria) context.success = data.successCriteria;
  if (data.challenges) context.challenges = data.challenges;
  if (data.culture) context.culture = data.culture;

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', fontFamily: '"Space Mono", monospace', color: '#fff' }}>
      {/* Header */}
      <header style={{
        padding: '24px 32px',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ width: 6, height: 6, background: 'rgba(255,255,255,0.4)' }} />
          <span style={{ fontSize: 9, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)' }}>PIPE_OS // V.2.0.4 // PHASE 1</span>
        </div>
        <h1 style={{
          fontSize: 48,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          margin: 0,
          fontStyle: 'italic',
          background: 'linear-gradient(135deg, #fff 0%, rgba(200,210,230,0.8) 25%, #fff 50%, rgba(180,190,220,0.7) 75%, rgba(240,240,250,0.9) 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 4px 30px rgba(200,210,230,0.2))',
        }}>
          ROLE_DISCOVERY
        </h1>
      </header>

      <div style={{ display: 'flex', position: 'relative', minHeight: 'calc(100vh - 140px)' }}>
        {/* Left Panel - Agent */}
        <RightPanel tab={tab} setTab={setTab} baseline={baseline} context={context} progress={progress} gaps={gaps} />

        {/* Main Content - Form */}
        <main style={{ flex: 1, padding: '0 32px 120px', position: 'relative', zIndex: 1 }}>
          {/* Stats bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            marginBottom: 32,
            paddingBottom: 20,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
          }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>SECTIONS</div>
              <div style={{ fontSize: 24, fontWeight: 800, background: 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {Object.keys(sections).length}
              </div>
            </div>
            <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>COMPLETE</div>
              <div style={{
                fontSize: 24,
                fontWeight: 800,
                background: progress >= 60 
                  ? 'linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)'
                  : 'linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {progress}%
              </div>
            </div>
            <div style={{ width: 1, height: 40, background: 'rgba(255,255,255,0.08)' }} />
            <div>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>GAPS</div>
              <div style={{
                fontSize: 24,
                fontWeight: 800,
                background: gaps.length === 0
                  ? 'linear-gradient(180deg, rgba(150,255,150,0.9) 0%, rgba(150,255,150,0.6) 100%)'
                  : 'linear-gradient(180deg, rgba(255,200,100,0.9) 0%, rgba(255,200,100,0.6) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                {gaps.length}
              </div>
            </div>
          </div>

          {/* Form Sections */}
          <div style={{ maxWidth: 700 }}>
            <FormSection icon={Icons.User} title="ROLE IDENTITY" isOpen={openSection === 'identity'} onToggle={() => setOpenSection(openSection === 'identity' ? null : 'identity')} isComplete={done('identity')}>
              <FieldGroup label="Job Title" required><TextInput value={data.title} onChange={v => set('title', v)} placeholder="e.g., Senior Software Engineer" /></FieldGroup>
              <FieldGroup label="Level" required><SelectInput value={data.level} onChange={v => set('level', v)} placeholder="Select level..." options={['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Lead', 'Manager']} /></FieldGroup>
              <FieldGroup label="Department" required><TextInput value={data.department} onChange={v => set('department', v)} placeholder="e.g., Engineering, Platform" /></FieldGroup>
              <FieldGroup label="Location" required><RadioGroup value={data.location} onChange={v => set('location', v)} options={['Remote', 'Hybrid', 'Onsite']} /></FieldGroup>
            </FormSection>

            <FormSection icon={Icons.Users} title="TEAM CONTEXT" isOpen={openSection === 'team'} onToggle={() => setOpenSection(openSection === 'team' ? null : 'team')} isComplete={done('team')}>
              <FieldGroup label="Team Size" required><TextInput value={data.teamSize} onChange={v => set('teamSize', v)} placeholder="e.g., 6 engineers" /></FieldGroup>
              <FieldGroup label="Reports To" required><TextInput value={data.reportsTo} onChange={v => set('reportsTo', v)} placeholder="e.g., Engineering Manager" /></FieldGroup>
            </FormSection>

            <FormSection icon={Icons.Code} title="TECHNICAL ENVIRONMENT" isOpen={openSection === 'tech'} onToggle={() => setOpenSection(openSection === 'tech' ? null : 'tech')} isComplete={done('tech')}>
              <FieldGroup label="Tech Stack" required><TagsInput value={data.stack} onChange={v => set('stack', v)} placeholder="Press Enter to add technologies" /></FieldGroup>
              <FieldGroup label="Engineering Practices"><TextareaInput value={data.practices} onChange={v => set('practices', v)} placeholder="Code review, testing, deployment practices..." /></FieldGroup>
            </FormSection>

            <FormSection icon={Icons.Target} title="SUCCESS CRITERIA" isOpen={openSection === 'success'} onToggle={() => setOpenSection(openSection === 'success' ? null : 'success')} isComplete={done('success')}>
              <FieldGroup label="90-Day Goals"><TextareaInput value={data.successCriteria} onChange={v => set('successCriteria', v)} placeholder="What should this person achieve in 90 days?" /></FieldGroup>
              <FieldGroup label="Failure Signals"><TextareaInput value={data.failureSignals} onChange={v => set('failureSignals', v)} placeholder="What would indicate this hire isn't working out?" /></FieldGroup>
            </FormSection>

            <FormSection icon={Icons.Zap} title="CHALLENGES" isOpen={openSection === 'challenges'} onToggle={() => setOpenSection(openSection === 'challenges' ? null : 'challenges')} isComplete={done('challenges')}>
              <FieldGroup label="Key Challenges"><TextareaInput value={data.challenges} onChange={v => set('challenges', v)} placeholder="What makes this role difficult?" /></FieldGroup>
              <FieldGroup label="Growth Opportunities"><TextareaInput value={data.growth} onChange={v => set('growth', v)} placeholder="What skills will they develop?" /></FieldGroup>
            </FormSection>

            <FormSection icon={Icons.Heart} title="CULTURE" isOpen={openSection === 'culture'} onToggle={() => setOpenSection(openSection === 'culture' ? null : 'culture')} isComplete={done('culture')}>
              <FieldGroup label="Team Culture"><TextareaInput value={data.culture} onChange={v => set('culture', v)} placeholder="How does the team work together?" /></FieldGroup>
              <FieldGroup label="Red Flags"><TextareaInput value={data.redFlags} onChange={v => set('redFlags', v)} placeholder="What behaviors would be a poor fit?" /></FieldGroup>
            </FormSection>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer style={{
        position: 'fixed',
        bottom: 0,
        left: 360,
        right: 0,
        padding: '20px 32px',
        background: 'linear-gradient(180deg, rgba(12,12,14,0.9) 0%, rgba(12,12,14,0.98) 100%)',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>COMPLETENESS</span>
          <div style={{ width: 140, height: 4, background: 'rgba(255,255,255,0.06)' }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: progress >= 60 
                ? 'linear-gradient(90deg, rgba(150,255,150,0.5), rgba(150,255,150,0.9))'
                : 'linear-gradient(90deg, rgba(139, 92, 246, 0.4), rgba(139, 92, 246, 0.8))',
              boxShadow: progress >= 60 
                ? '0 0 12px rgba(150,255,150,0.4)'
                : '0 0 10px rgba(139, 92, 246, 0.3)',
              transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{progress}%</span>
        </div>

        <button
          disabled={progress < 60}
          style={{
            padding: '12px 24px',
            background: progress >= 60 
              ? 'linear-gradient(135deg, rgba(150,255,150,0.2), rgba(100,200,100,0.15))'
              : 'rgba(255,255,255,0.05)',
            border: `1px solid ${progress >= 60 ? 'rgba(150,255,150,0.3)' : 'rgba(255,255,255,0.1)'}`,
            color: progress >= 60 ? '#fff' : 'rgba(255,255,255,0.3)',
            fontSize: 10,
            letterSpacing: '0.15em',
            fontWeight: 700,
            cursor: progress >= 60 ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          CONTINUE TO PHASE 2
          <Icons.ArrowRight size={14} />
        </button>
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.25); }
        input:focus, textarea:focus, select:focus { border-color: rgba(139, 92, 246, 0.5) !important; outline: none; }
        select option { background: #1a1a24; color: #fff; }
      `}</style>
    </div>
  );
}