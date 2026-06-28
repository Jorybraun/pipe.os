/**
 * useRoomStatusNotifications — SSE client for live video-room presence updates.
 *
 * Uses fetch + ReadableStream so Clerk bearer auth can be sent with the
 * streaming request.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuth as useClerkAuth } from '@clerk/react';

export interface RoomStatusNotification {
  interviewId: string;
  meetingId: string | null;
  meetingStatus: string | null;
  roomStatus: string | null;
  guestJoinedAt: string | null;
  guestLeftAt: string | null;
  guestWaiting: boolean;
  updatedAt: string;
}

interface UseRoomStatusNotificationsResult {
  updates: RoomStatusNotification[];
  isConnected: boolean;
}

function apiBaseUrl(): string {
  return (
    (typeof import.meta !== 'undefined'
      && typeof import.meta.env !== 'undefined'
      && import.meta.env.VITE_API_URL)
    || ''
  );
}

export function useRoomStatusNotifications(): UseRoomStatusNotificationsResult {
  const { getToken } = useClerkAuth();
  const getTokenRef = useRef(getToken);
  const [updates, setUpdates] = useState<RoomStatusNotification[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function connect(): Promise<void> {
      try {
        const token = await getTokenRef.current();
        const baseUrl = apiBaseUrl();
        const url = baseUrl
          ? `${baseUrl.replace(/\/$/, '')}/api/v1/scheduling/room-events`
          : '/api/v1/scheduling/room-events';

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          console.error('[useRoomStatusNotifications] SSE connection failed:', response.status);
          return;
        }

        if (cancelled) return;
        setIsConnected(true);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

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
                data = data ? `${data}\n${lineData}` : lineData;
              }
            }

            if (eventType !== 'room_status' || !data) continue;
            try {
              const update = JSON.parse(data) as RoomStatusNotification;
              if (!cancelled) {
                setUpdates((prev) => [...prev, update]);
              }
            } catch {
              // Ignore malformed SSE payloads.
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useRoomStatusNotifications] SSE error:', err);
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

  return { updates, isConnected };
}
