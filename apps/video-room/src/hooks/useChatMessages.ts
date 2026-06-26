import { useCallback, useState } from 'react';
import type { ChatMessage, ChatRole } from '../components/ChatWindow';

let msgCounter = 0;
function nextMsgId(): string {
  msgCounter += 1;
  return `msg-${msgCounter}`;
}

export function useChatMessages(initialRole: 'HOST' | 'GUEST') {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const sendMessage = useCallback(
    (text: string, role?: ChatRole): void => {
      const msg: ChatMessage = {
        id: nextMsgId(),
        role: role ?? (initialRole === 'HOST' ? 'host' : 'candidate'),
        text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, msg]);
    },
    [initialRole],
  );

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>): void => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: nextMsgId(), timestamp: Date.now() },
    ]);
  }, []);

  return { messages, sendMessage, addMessage };
}
