import React, { createContext, useContext, useState, useCallback } from 'react';

interface TimerContextType {
  secondsRemaining: number | null;
  setSecondsRemaining: (seconds: number | null) => void;
  isExpired: boolean;
  setIsExpired: (expired: boolean) => void;
  formatTime: (seconds: number) => string;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  const formatTime = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return (
    <TimerContext.Provider value={{ 
      secondsRemaining, 
      setSecondsRemaining, 
      isExpired, 
      setIsExpired,
      formatTime 
    }}>
      {children}
    </TimerContext.Provider>
  );
}

export function useTimer() {
  const context = useContext(TimerContext);
  if (context === undefined) {
    throw new Error('useTimer must be used within a TimerProvider');
  }
  return context;
}
