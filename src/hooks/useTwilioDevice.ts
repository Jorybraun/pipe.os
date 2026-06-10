/**
 * useTwilioDevice — manages the Twilio Voice SDK Device lifecycle for browser-based calling.
 *
 * Dynamically imports @twilio/voice-sdk to avoid bundling it unless the phone drawer opens.
 * Fetches an access token from the Worker, creates a Device, and provides connect/disconnect controls.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/react';
import { createApiClient } from '../lib/api/client';

type TwilioDevice = import('@twilio/voice-sdk').Device;
type TwilioCall = import('@twilio/voice-sdk').Call;

export interface UseTwilioDeviceReturn {
  isReady: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  activeCall: TwilioCall | null;
  error: string | null;
  callDuration: number;
  connect: (toNumber: string) => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  isMuted: boolean;
  sendDigits: (digits: string) => void;
}

export function useTwilioDevice(): UseTwilioDeviceReturn {
  const { getToken } = useAuth();
  const deviceRef = useRef<TwilioDevice | null>(null);
  const callRef = useRef<TwilioCall | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [activeCall, setActiveCall] = useState<TwilioCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Initialize device on mount
  useEffect(() => {
    let cancelled = false;

    const init = async (): Promise<void> => {
      try {
        // Dynamic import to avoid bundling the SDK unless needed
        const { Device } = await import('@twilio/voice-sdk');

        // Fetch access token from our Worker
        const api = createApiClient({ getToken });
        const { token } = await api.post<{ token: string; identity: string }>(
          '/api/v1/phone/token',
          {},
        );

        if (cancelled) return;

        const { Call } = await import('@twilio/voice-sdk');
        const device = new Device(token, {
          codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
          closeProtection: true,
        });

        device.on('registered', () => {
          if (!cancelled) setIsReady(true);
        });

        device.on('error', (err: Error) => {
          console.error('[useTwilioDevice] Device error:', err);
          if (!cancelled) setError(err.message);
        });

        await device.register();
        deviceRef.current = device;
      } catch (err) {
        console.error('[useTwilioDevice] Init failed:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to initialize phone');
      }
    };

    void init();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (deviceRef.current) {
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    };
  }, [getToken]);

  const startTimer = useCallback((): void => {
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration((d) => d + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback((): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const connect = useCallback(async (toNumber: string): Promise<void> => {
    if (!deviceRef.current) {
      setError('Phone device not ready');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const call = await deviceRef.current.connect({
        params: { To: toNumber },
      });

      callRef.current = call;
      setActiveCall(call);

      call.on('accept', () => {
        setIsConnecting(false);
        setIsConnected(true);
        startTimer();
      });

      call.on('disconnect', () => {
        setIsConnected(false);
        setIsConnecting(false);
        setActiveCall(null);
        callRef.current = null;
        stopTimer();
      });

      call.on('error', (err: Error) => {
        console.error('[useTwilioDevice] Call error:', err);
        setError(err.message);
        setIsConnecting(false);
        setIsConnected(false);
        setActiveCall(null);
        callRef.current = null;
        stopTimer();
      });

      call.on('ringing', () => {
        // Still connecting, ringing on remote end
      });
    } catch (err) {
      console.error('[useTwilioDevice] Connect failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect call');
      setIsConnecting(false);
    }
  }, [startTimer, stopTimer]);

  const disconnect = useCallback((): void => {
    if (callRef.current) {
      callRef.current.disconnect();
    }
  }, []);

  const toggleMute = useCallback((): void => {
    if (callRef.current) {
      const newMuted = !callRef.current.isMuted();
      callRef.current.mute(newMuted);
      setIsMuted(newMuted);
    }
  }, []);

  const sendDigits = useCallback((digits: string): void => {
    if (callRef.current) {
      callRef.current.sendDigits(digits);
    }
  }, []);

  return {
    isReady,
    isConnecting,
    isConnected,
    activeCall,
    error,
    callDuration,
    connect,
    disconnect,
    toggleMute,
    isMuted,
    sendDigits,
  };
}
