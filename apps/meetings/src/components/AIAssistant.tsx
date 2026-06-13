import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

// AGUI Components
const MeetingCardSchema = z.object({
  id: z.number(),
  title: z.string(),
  scheduled_at: z.string(),
  status: z.string(),
});

function MeetingCard({ title, scheduled_at, status }: z.infer<typeof MeetingCardSchema>) {
  return (
    <div style={{
      padding: '12px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '6px',
      marginBottom: '8px',
    }}>
      <div style={{ fontSize: '12px', marginBottom: '4px' }}>
        <strong>{title || 'No title'}</strong>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--pipe-text-muted)', marginBottom: '4px' }}>
        {scheduled_at ? new Date(scheduled_at).toLocaleDateString() : 'No date'}
      </div>
      <div style={{ 
        fontSize: '10px', 
        padding: '2px 6px',
        background: status === 'SCHEDULED' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
        color: status === 'SCHEDULED' ? '#22c55e' : '#ef4444',
        borderRadius: '4px',
        display: 'inline-block',
      }}>
        {status}
      </div>
    </div>
  );
}

const ContactCardSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  type: z.string(),
});

function ContactCard({ name, email, company, title, type }: z.infer<typeof ContactCardSchema>) {
  return (
    <div style={{
      padding: '12px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '6px',
      marginBottom: '8px',
    }}>
      <div style={{ fontSize: '12px', marginBottom: '4px' }}>
        <strong>{name}</strong>
        {company && <span style={{ color: 'var(--pipe-text-muted)' }}> @ {company}</span>}
      </div>
      {email && (
        <div style={{ fontSize: '11px', color: 'var(--pipe-text-muted)', marginBottom: '4px' }}>
          {email}
        </div>
      )}
      {title && (
        <div style={{ fontSize: '11px', color: 'var(--pipe-text-muted)', marginBottom: '4px' }}>
          {title}
        </div>
      )}
      <div style={{ 
        fontSize: '10px', 
        padding: '2px 6px',
        background: 'rgba(59, 130, 246, 0.2)',
        color: '#60a5fa',
        borderRadius: '4px',
        display: 'inline-block',
      }}>
        {type}
      </div>
    </div>
  );
}

interface AIAssistantProps {
  onClose?: () => void;
}

export default function AIAssistant({ onClose }: AIAssistantProps) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Array<{role: string, content: string, components?: any}>>([
    { role: 'assistant', content: 'I can help you find and analyze prospects and show your meetings. Try: "Show me my meetings" or "Find my contacts"' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user' as const, content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8788/api/copilotkit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          threadId: 'default',
        }),
      });

      const data = await response.json();
      const assistantMessage = { 
        role: 'assistant' as const, 
        content: data.choices?.[0]?.message?.content || data.message || 'No response',
        components: data.actions || []
      };
      
      setMessages(prev => [...prev, assistantMessage]);

      // Handle agent-controlled navigation
      if (data.actions && data.actions.length > 0) {
        data.actions.forEach((action: any) => {
          if (action.type === 'navigate' && action.path) {
            navigate(action.path);
          }
          if (action.type === 'render' && action.component === 'ContactCard' && action.props) {
            // Open contact detail in the main content area
            // Store the selected contact in localStorage for the contacts page to pick up
            localStorage.setItem('selectedContact', JSON.stringify(action.props));
            navigate('/contacts');
          }
          if (action.type === 'render' && action.component === 'MeetingCard' && action.props) {
            // Open meeting detail in the main content area
            localStorage.setItem('selectedMeeting', JSON.stringify(action.props));
            navigate('/meetings');
          }
        });
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: 100,
      width: '400px',
      height: 'calc(100vh - 120px)',
      background: 'rgba(12, 12, 14, 0.98)',
      borderLeft: '1px solid rgba(255,255,255,0.1)',
      zIndex: 15,
      backdropFilter: 'blur(20px)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '14px', fontWeight: 'bold' }}>AI Assistant</span>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer',
              padding: '4px',
              fontSize: '16px',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            marginBottom: '12px',
            padding: '12px',
            borderRadius: '8px',
            background: msg.role === 'user' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.05)',
            border: msg.role === 'user' ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{ fontSize: '11px', color: 'var(--pipe-text-muted)', marginBottom: '4px', fontFamily: '"Space Mono", monospace' }}>
              {msg.role === 'user' ? 'YOU' : 'AI'}
            </div>
            <div style={{ fontSize: '13px', lineHeight: '1.4', marginBottom: '8px' }}>
              {msg.content}
            </div>
            {/* Render AGUI components */}
            {msg.components && msg.components.map((action: any, idx: number) => {
              if (action.type === 'render' && action.component === 'MeetingCard') {
                return <MeetingCard key={idx} {...action.props} />;
              }
              if (action.type === 'render' && action.component === 'ContactCard') {
                return <ContactCard key={idx} {...action.props} />;
              }
              return null;
            })}
          </div>
        ))}
        {isLoading && (
          <div style={{
            padding: '12px',
            borderRadius: '8px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            fontSize: '12px',
            color: 'var(--pipe-text-muted)',
          }}>
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: '16px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        gap: '8px',
      }}>
        <input
          type="text"
          placeholder="Ask about prospects or meetings..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isLoading) {
              handleSend();
            }
          }}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            color: 'white',
            fontSize: '13px',
            fontFamily: '"Space Mono", monospace',
          }}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
          style={{
            padding: '10px 16px',
            background: isLoading || !input.trim() ? 'rgba(255,255,255,0.1)' : 'rgba(59, 130, 246, 0.3)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            color: 'white',
            cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
