/**
 * useBookingNotifications — SSE client that listens for real-time booking
 * updates from the scheduling backend.
 *
 * Connects to GET /api/v1/scheduling/events with Accept: text/event-stream.
 * Emits notifications when interviews transition via webhook or poll sync.
 *
 * Uses fetch + ReadableStream (not EventSource) so we can send the
 * Authorization header — EventSource doesn't support custom headers.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';

export interface BookingNotification {
  interviewId: string;
  status: string;
  scheduledAt: string | null;
  meetingUrl: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  candidateId: string | null;
  syncSource: string | null;
  updatedAt: string;
}

interface UseBookingNotificationsResult {
  notifications: BookingNotification[];
  isConnected: boolean;
  clearNotifications: () => void;
}

export function useBookingNotifications(): UseBookingNotificationsResult {
  const { getToken } = useClerkAuth();
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const [notifications, setNotifications] = useState<BookingNotification[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function connect(): Promise<void> {
      try {
        const token = await getTokenRef.current();
        const baseUrl =
          (typeof import.meta !== 'undefined' &&
            typeof import.meta.env !== 'undefined' &&
            import.meta.env.VITE_API_URL) ||
          '';
        const url = baseUrl
          ? `${baseUrl.replace(/\/$/, '')}/api/v1/scheduling/events`
          : '/api/v1/scheduling/events';

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          console.error('[useBookingNotifications] SSE connection failed:', response.status);
          return;
        }

        if (cancelled) return;
        setIsConnected(true);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let reading = true;

        while (reading) {
          const { done, value } = await reader.read();
          if (done) {
            reading = false;
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
            const chunk = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);

            const lines = chunk.split('\n');
            let eventType = '';
            let data = '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventType = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const lineData = line.slice(6);
                data = data ? data + '\n' + lineData : lineData;
              }
            }

            if (eventType === 'booking_update' && data) {
              try {
                const notification = JSON.parse(data) as BookingNotification;
                if (!cancelled) {
                  setNotifications((prev) => [...prev, notification]);
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useBookingNotifications] SSE error:', err);
      } finally {
        if (!cancelled) setIsConnected(false);
      }
    }

    void connect();

    return () => {
      cancelled = true;
      controller.abort();
      setIsConnected(false);
    };
  }, []);

  return { notifications, isConnected, clearNotifications };
}
