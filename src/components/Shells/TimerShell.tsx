import React, { useEffect, useRef } from 'react';
import { useTimer } from '../Assessment/TimerContext';

interface TimerShellProps {
  timeLimit: number | null; // Minutes. null = untimed (renders children directly).
  onExpire?: () => void;
  warningThreshold?: number; // Seconds remaining for yellow warning. Default: 90.
  children: React.ReactNode;
}

/**
 * TimerShell - Behavioral wrapper that adds timing capabilities to a challenge.
 * Syncs with TimerContext to allow StageShell to display the global timer.
 */
export function TimerShell({
  timeLimit,
  onExpire,
  children,
}: TimerShellProps): JSX.Element {
  const { setSecondsRemaining, setIsExpired } = useTimer();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const initialTimeLimit = useRef(timeLimit);

  useEffect(() => {
    // If untimed, clear any existing timer and state
    if (initialTimeLimit.current === null) {
      setSecondsRemaining(null);
      setIsExpired(false);
      return;
    }

    const initialSeconds = initialTimeLimit.current * 60;
    setSecondsRemaining(initialSeconds);
    setIsExpired(false);

    let currentSeconds = initialSeconds;

    timerRef.current = setInterval(() => {
      currentSeconds -= 1;
      setSecondsRemaining(currentSeconds);

      if (currentSeconds <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        setIsExpired(true);
        if (onExpire) onExpire();
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [onExpire, setSecondsRemaining, setIsExpired]);

  useEffect(() => {
    initialTimeLimit.current = timeLimit
  }, [timeLimit])

  return <>{children}</>;
}
