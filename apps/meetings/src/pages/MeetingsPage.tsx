/**
 * MeetingsPage — manage meetings for the Meetings app.
 *
 * Route: /meetings
 *
 * Features:
 *   - List upcoming and past meetings
 *   - Create new meeting with participants
 *   - View meeting details with participant list
 *   - Filter by meeting type
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@clerk/react';
import {
  Calendar, Search, X, ChevronRight, Loader, Plus, Users, Clock, Video,
  Copy, ExternalLink, FileText, Save,
} from 'lucide-react';
import { createApiClient } from '../lib/api/client';
import type {
  Meeting,
  MeetingType,
  MeetingStatus,
  MeetingParticipant,
  ParticipantWithContact,
  Contact,
} from '../types';

// ─── Type Colors ───────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<MeetingType, string> = {
  DISCOVERY: '#fbbf24',
  INTERVIEW: '#60a5fa',
  FOLLOW_UP: '#4ade80',
  DEMO: '#f472b6',
  OTHER: '#9ca3af',
};

const TYPE_LABELS: Record<MeetingType, string> = {
  DISCOVERY: 'DISCOVERY',
  INTERVIEW: 'INTERVIEW',
  FOLLOW_UP: 'FOLLOW_UP',
  DEMO: 'DEMO',
  OTHER: 'OTHER',
};

const STATUS_COLORS: Record<MeetingStatus, string> = {
  SCHEDULED: '#60a5fa',
  IN_PROGRESS: '#fbbf24',
  COMPLETED: '#4ade80',
  CANCELLED: '#f87171',
};

// ─── Main page ───────────────────────────────────────────────────────────────

export default function MeetingsPage(): JSX.Element {
  const { getToken } = useAuth();
  const api = createApiClient({ getToken });

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MeetingType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [meetingsRes, contactsRes] = await Promise.all([
        api.get<{ meetings: Meeting[] }>('/api/v1/meetings'),
        api.get<{ contacts: Contact[] }>('/api/v1/contacts'),
      ]);
      setMeetings(meetingsRes.meetings);
      setContacts(contactsRes.contacts);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const filtered = meetings.filter((m) => {
    if (typeFilter !== 'all' && m.meeting_type !== typeFilter) return false;
    
    if (statusFilter === 'upcoming') {
      return m.status === 'SCHEDULED' || m.status === 'IN_PROGRESS';
    }
    if (statusFilter === 'past') {
      return m.status === 'COMPLETED' || m.status === 'CANCELLED';
    }
    
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      (m.description?.toLowerCase().includes(q) ?? false)
    );
  });

  // Sort by scheduled_at (upcoming first, then past)
  const sorted = [...filtered].sort((a, b) => {
    const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
    const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: selected ? '1fr 420px' : '1fr',
      height: 'calc(100vh - 100px)',
      margin: '-24px 0 -24px 0',
      overflow: 'hidden',
      transition: 'grid-template-columns 0.25s cubic-bezier(0.4,0,0.2,1)',
    }}>
      {/* ── List ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--pipe-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', marginBottom: 4 }}>
              MEETINGS
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {meetings.length} {meetings.length === 1 ? 'meeting' : 'meetings'}
            </div>
          </div>

          {/* Status filter */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['upcoming', 'past', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '4px 10px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  border: '1px solid',
                  borderRadius: 3,
                  cursor: 'pointer',
                  borderColor: statusFilter === s ? 'rgba(255,255,255,0.3)' : 'var(--pipe-border)',
                  background: statusFilter === s ? 'rgba(255,255,255,0.06)' : 'transparent',
                  color: statusFilter === s ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                }}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'DISCOVERY', 'INTERVIEW', 'FOLLOW_UP', 'DEMO', 'OTHER'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t === 'all' ? 'all' : t as MeetingType)}
                style={{
                  padding: '4px 10px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  border: '1px solid',
                  borderRadius: 3,
                  cursor: 'pointer',
                  borderColor: typeFilter === t
                    ? (t === 'all' ? 'rgba(255,255,255,0.3)' : TYPE_COLORS[t as MeetingType])
                    : 'var(--pipe-border)',
                  background: typeFilter === t
                    ? (t === 'all' ? 'rgba(255,255,255,0.06)' : `${TYPE_COLORS[t as MeetingType]}18`)
                    : 'transparent',
                  color: typeFilter === t
                    ? (t === 'all' ? 'var(--pipe-text)' : TYPE_COLORS[t as MeetingType])
                    : 'var(--pipe-text-dim)',
                }}
              >
                {t === 'all' ? 'ALL' : TYPE_LABELS[t as MeetingType]}
              </button>
            ))}
          </div>

          <button
            onClick={() => { setShowCreate(true); setSelected(null); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', fontSize: 9, fontWeight: 700,
              letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace',
              background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
              borderRadius: 4, color: '#4ade80', cursor: 'pointer',
            }}
          >
            <Plus size={13} /> NEW
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--pipe-border)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              color: 'var(--pipe-text-dim)',
            }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SEARCH BY TITLE, DESCRIPTION..."
              style={{
                width: '100%', padding: '8px 8px 8px 30px',
                fontSize: 9, fontFamily: '"Space Mono", monospace',
                letterSpacing: '0.08em',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 4, color: 'var(--pipe-text)', outline: 'none',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 0,
              }}>
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Meeting list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading && (
            <div style={{ padding: 40, display: 'flex', justifyContent: 'center', color: 'var(--pipe-text-dim)' }}>
              <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          )}
          {!isLoading && sorted.length === 0 && (
            <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--pipe-text-dim)' }}>
              <div style={{ fontSize: 11, marginBottom: 8 }}>
                {search || typeFilter !== 'all' || statusFilter !== 'all' ? 'NO_MATCHES_FOUND' : 'NO_MEETINGS_YET'}
              </div>
              {!search && typeFilter === 'all' && statusFilter === 'all' && (
                <div style={{ fontSize: 9, opacity: 0.6 }}>
                  Create a meeting by clicking NEW above
                </div>
              )}
            </div>
          )}
          {sorted.map((meeting) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              isSelected={selected?.id === meeting.id}
              onClick={() => { setSelected(meeting); setShowCreate(false); }}
            />
          ))}
        </div>
      </div>

      {/* ── Detail / Create panel ────────────────────────────────────────────── */}
      {(selected || showCreate) && (
        <div style={{
          borderLeft: '1px solid var(--pipe-border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {showCreate && !selected ? (
            <CreateMeetingPanel
              onSaved={(m) => { setMeetings((prev) => [m, ...prev]); setSelected(m); setShowCreate(false); }}
              onClose={() => setShowCreate(false)}
              api={api}
              contacts={contacts}
            />
          ) : selected ? (
            <MeetingDetailPanel
              meeting={selected}
              onClose={() => setSelected(null)}
              api={api}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Meeting Row ─────────────────────────────────────────────────────────────

function MeetingRow({ meeting, isSelected, onClick }: {
  meeting: Meeting;
  isSelected: boolean;
  onClick: () => void;
}): JSX.Element {
  const scheduledDate = meeting.scheduled_at
    ? new Date(meeting.scheduled_at)
    : null;
  
  const dateStr = scheduledDate
    ? scheduledDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'TBD';
  
  const timeStr = scheduledDate
    ? scheduledDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 24px',
        borderBottom: '1px solid var(--pipe-border)',
        cursor: 'pointer',
        background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)'; }}
      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {/* Date badge */}
      <div style={{
        width: 48, height: 48, borderRadius: 8, flexShrink: 0,
        background: `${TYPE_COLORS[meeting.meeting_type]}18`,
        border: `1px solid ${TYPE_COLORS[meeting.meeting_type]}40`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLORS[meeting.meeting_type] }}>
          {dateStr}
        </span>
        {timeStr && (
          <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)' }}>
            {timeStr}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meeting.title}
          </span>
          <span style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.1em',
            padding: '2px 5px', borderRadius: 2,
            background: `${TYPE_COLORS[meeting.meeting_type]}18`,
            color: TYPE_COLORS[meeting.meeting_type],
            flexShrink: 0,
          }}>
            {TYPE_LABELS[meeting.meeting_type]}
          </span>
          <span style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.1em',
            padding: '2px 5px', borderRadius: 2,
            background: `${STATUS_COLORS[meeting.status]}18`,
            color: STATUS_COLORS[meeting.status],
            flexShrink: 0,
          }}>
            {meeting.status}
          </span>
        </div>
        {meeting.description && (
          <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meeting.description}
          </div>
        )}
      </div>
      <ChevronRight size={12} style={{ color: 'var(--pipe-text-dim)', flexShrink: 0 }} />
    </div>
  );
}

// ─── Create Meeting Panel ─────────────────────────────────────────────────────

function CreateMeetingPanel({ onSaved, onClose, api, contacts }: {
  onSaved: (m: Meeting) => void;
  onClose: () => void;
  api: ReturnType<typeof createApiClient>;
  contacts: Contact[];
}): JSX.Element {
  const [form, setForm] = useState({
    title: '',
    description: '',
    scheduled_at: '',
    meeting_type: 'DISCOVERY' as MeetingType,
    participant_ids: [] as string[],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (): Promise<void> => {
    if (!form.title) { setError('Title is required'); return; }
    setError(null);
    setIsSaving(true);
    try {
      const res = await api.post<{ meeting: Meeting }>('/api/v1/meetings', {
        title: form.title,
        meeting_type: form.meeting_type,
        description: form.description || undefined,
        scheduled_at: form.scheduled_at || undefined,
        participant_contact_ids: form.participant_ids,
      });
      onSaved(res.meeting);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleParticipant = (contactId: string) => {
    setForm((prev) => ({
      ...prev,
      participant_ids: prev.participant_ids.includes(contactId)
        ? prev.participant_ids.filter((id) => id !== contactId)
        : [...prev.participant_ids, contactId],
    }));
  };

  return (
    <MeetingForm
      title="NEW_MEETING"
      form={form}
      onChange={(k, v) => setForm((prev) => ({ ...prev, [k]: v }))}
      onSave={() => void handleSave()}
      onClose={onClose}
      isSaving={isSaving}
      error={error}
      saveLabel="CREATE"
      contacts={contacts}
      onToggleParticipant={toggleParticipant}
    />
  );
}

// ─── Meeting Detail Panel ─────────────────────────────────────────────────────

function MeetingDetailPanel({ meeting, onClose, api }: {
  meeting: Meeting;
  onClose: () => void;
  api: ReturnType<typeof createApiClient>;
}): JSX.Element {
  const [participants, setParticipants] = useState<ParticipantWithContact[]>([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState(true);
  const [roomLinks, setRoomLinks] = useState<{
    hostUrl: string;
    guestUrl: string;
  } | null>(null);
  const [isPreparingRoom, setIsPreparingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  useEffect(() => {
    const loadParticipants = async () => {
      setIsLoadingParticipants(true);
      try {
        const res = await api.get<{ participants: Array<
          MeetingParticipant & {
            contact_name: string;
            contact_email: string | null;
            contact_type: Contact['type'];
          }
        > }>(
          `/api/v1/meetings/${meeting.id}`
        );
        setParticipants(res.participants.map((participant) => ({
          ...participant,
          contact: {
            id: participant.contact_id,
            owner_id: meeting.owner_id,
            type: participant.contact_type,
            name: participant.contact_name,
            email: participant.contact_email,
            phone: null,
            company: null,
            title: null,
            notes: null,
            candidate_id: null,
            tags: '[]',
            created_at: participant.created_at,
            updated_at: participant.updated_at,
          },
        })));
      } catch {
        // ignore
      } finally {
        setIsLoadingParticipants(false);
      }
    };
    void loadParticipants();
  }, [meeting.id, api]);

  const scheduledDate = meeting.scheduled_at
    ? new Date(meeting.scheduled_at)
    : null;

  const prepareRoom = async (): Promise<void> => {
    setRoomError(null);
    setIsPreparingRoom(true);
    try {
      const result = await api.post<{
        room: { hostUrl: string; guestUrl: string };
      }>(`/api/v1/meetings/${meeting.id}/room`, {});
      setRoomLinks(result.room);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Unable to prepare room');
    } finally {
      setIsPreparingRoom(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--pipe-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em' }}>MEETING</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 4 }}>
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {/* Title */}
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
          {meeting.title}
        </div>

        {/* Type and status badges */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
            padding: '4px 8px', borderRadius: 3,
            background: `${TYPE_COLORS[meeting.meeting_type]}18`,
            color: TYPE_COLORS[meeting.meeting_type],
          }}>
            {TYPE_LABELS[meeting.meeting_type]}
          </span>
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
            padding: '4px 8px', borderRadius: 3,
            background: `${STATUS_COLORS[meeting.status]}18`,
            color: STATUS_COLORS[meeting.status],
          }}>
            {meeting.status}
          </span>
        </div>

        {/* Description */}
        {meeting.description && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
              DESCRIPTION
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5 }}>
              {meeting.description}
            </div>
          </div>
        )}

        {/* Scheduled time */}
        {scheduledDate && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
              SCHEDULED
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <Calendar size={14} style={{ color: 'var(--pipe-text-dim)' }} />
              <span>{scheduledDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, marginTop: 4 }}>
              <Clock size={14} style={{ color: 'var(--pipe-text-dim)' }} />
              <span>{scheduledDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          </div>
        )}

        {/* Meeting URL */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 8, letterSpacing: '0.1em' }}>
            VIDEO_ROOM
          </div>
          {!roomLinks ? (
            <button
              onClick={() => void prepareRoom()}
              disabled={isPreparingRoom}
              style={{
                width: '100%', minHeight: 40, display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 8, border: '1px solid rgba(96,165,250,.35)',
                borderRadius: 4, background: 'rgba(96,165,250,.08)', color: '#60a5fa',
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {isPreparingRoom ? <Loader size={14} className="spin" /> : <Video size={14} />}
              PREPARE_VIDEO_ROOM
            </button>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <a
                href={roomLinks.hostUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, borderRadius: 4, background: '#e8ebef', color: '#0c0c0e',
                  textDecoration: 'none', fontSize: 10, fontWeight: 700,
                }}
              >
                <ExternalLink size={14} /> OPEN_HOST_ROOM
              </a>
              <button
                onClick={() => void navigator.clipboard.writeText(roomLinks.guestUrl)}
                style={{
                  minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, border: '1px solid var(--pipe-border)', borderRadius: 4,
                  background: 'transparent', color: 'var(--pipe-text-muted)', cursor: 'pointer',
                  fontSize: 9, fontWeight: 700,
                }}
              >
                <Copy size={13} /> COPY_GUEST_LINK
              </button>
            </div>
          )}
          {roomError && (
            <div style={{ marginTop: 8, color: '#f87171', fontSize: 9 }}>{roomError}</div>
          )}
        </div>

        {meeting.meeting_url && !roomLinks && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
              CURRENT_GUEST_LINK
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <Video size={14} style={{ color: 'var(--pipe-text-dim)' }} />
              <a
                href={meeting.meeting_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#60a5fa', textDecoration: 'none' }}
              >
                {meeting.meeting_url}
              </a>
            </div>
          </div>
        )}

        {(meeting.transcript_summary || meeting.transcript_status !== 'NONE') && (
          <div data-testid="meeting-intelligence" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 8, letterSpacing: '0.1em' }}>
              MEETING_INTELLIGENCE
            </div>
            <div style={{
              padding: 12, border: '1px solid var(--pipe-border)', borderRadius: 4,
              background: 'rgba(255,255,255,.02)',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: meeting.transcript_summary ? 8 : 0 }}>
                <FileText size={13} color="var(--pipe-text-dim)" />
                <span style={{ fontSize: 9, fontWeight: 700 }}>{meeting.transcript_status}</span>
              </div>
              {meeting.transcript_summary && (
                <p style={{ fontSize: 10, lineHeight: 1.6, color: 'var(--pipe-text-muted)' }}>
                  {meeting.transcript_summary}
                </p>
              )}
              {meeting.transcript_error && (
                <p style={{ fontSize: 9, lineHeight: 1.5, color: '#f87171' }}>
                  {meeting.transcript_error}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Participants */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 8, letterSpacing: '0.1em' }}>
            PARTICIPANTS
          </div>
          {isLoadingParticipants ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
              <Loader size={16} style={{ animation: 'spin 1s linear infinite', color: 'var(--pipe-text-dim)' }} />
            </div>
          ) : participants.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
              No participants yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {participants.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px',
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: 4,
                  }}
                >
                  <Users size={14} style={{ color: 'var(--pipe-text-dim)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>
                      {p.contact.name}
                    </div>
                    {p.contact.email && (
                      <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)' }}>
                        {p.contact.email}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                    padding: '2px 6px', borderRadius: 2,
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--pipe-text-dim)',
                  }}>
                    {p.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ─── Shared Form ──────────────────────────────────────────────────────────────

function MeetingForm({ title, form, onChange, onSave, onClose, isSaving, error, saveLabel, contacts, onToggleParticipant }: {
  title: string;
  form: { title: string; description: string; scheduled_at: string; meeting_type: MeetingType; participant_ids: string[] };
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
  error: string | null;
  saveLabel: string;
  contacts: Contact[];
  onToggleParticipant: (contactId: string) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--pipe-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.15em' }}>{title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 4 }}>
          <X size={14} />
        </button>
      </div>

      {/* Fields */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Meeting type selector */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
            MEETING_TYPE
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['DISCOVERY', 'INTERVIEW', 'FOLLOW_UP', 'DEMO', 'OTHER'] as MeetingType[]).map((t) => (
              <button
                key={t}
                onClick={() => onChange('meeting_type', t)}
                style={{
                  padding: '6px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace', border: '1px solid', borderRadius: 3, cursor: 'pointer',
                  borderColor: form.meeting_type === t ? TYPE_COLORS[t] : 'var(--pipe-border)',
                  background: form.meeting_type === t ? `${TYPE_COLORS[t]}18` : 'transparent',
                  color: form.meeting_type === t ? TYPE_COLORS[t] : 'var(--pipe-text-dim)',
                }}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
            TITLE
          </div>
          <input
            value={form.title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder="Meeting title..."
            style={{
              width: '100%', padding: '10px 12px', fontSize: 11,
              fontFamily: '"Space Mono", monospace',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--pipe-border)', borderRadius: 4,
              color: 'var(--pipe-text)', outline: 'none',
            }}
          />
        </div>

        {/* Description */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
            DESCRIPTION
          </div>
          <textarea
            value={form.description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder="Meeting description..."
            rows={3}
            style={{
              width: '100%', padding: '10px 12px', fontSize: 11,
              fontFamily: '"Space Mono", monospace',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--pipe-border)', borderRadius: 4,
              color: 'var(--pipe-text)', outline: 'none', resize: 'vertical',
            }}
          />
        </div>

        {/* Scheduled time */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
            SCHEDULED_AT
          </div>
          <input
            type="datetime-local"
            value={form.scheduled_at}
            onChange={(e) => onChange('scheduled_at', e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', fontSize: 11,
              fontFamily: '"Space Mono", monospace',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--pipe-border)', borderRadius: 4,
              color: 'var(--pipe-text)', outline: 'none',
            }}
          />
        </div>

        {/* Participants */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em' }}>
            PARTICIPANTS
          </div>
          {contacts.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
              No contacts available. Add contacts first.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => onToggleParticipant(contact.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px',
                    background: form.participant_ids.includes(contact.id)
                      ? 'rgba(74,222,128,0.1)'
                      : 'rgba(255,255,255,0.02)',
                    border: form.participant_ids.includes(contact.id)
                      ? '1px solid rgba(74,222,128,0.3)'
                      : '1px solid var(--pipe-border)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Users size={14} style={{ color: form.participant_ids.includes(contact.id) ? '#4ade80' : 'var(--pipe-text-dim)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>
                      {contact.name}
                    </div>
                    {contact.email && (
                      <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)' }}>
                        {contact.email}
                      </div>
                    )}
                  </div>
                  {form.participant_ids.includes(contact.id) && (
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#4ade80',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontSize: 10, color: '#0c0c0e', fontWeight: 700 }}>✓</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 10, color: '#f87171' }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 20px', borderTop: '1px solid var(--pipe-border)',
        display: 'flex', gap: 8, flexShrink: 0,
      }}>
        <button
          onClick={onSave}
          disabled={isSaving}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 4, color: '#4ade80', cursor: isSaving ? 'not-allowed' : 'pointer',
            opacity: isSaving ? 0.5 : 1,
          }}
        >
          {isSaving ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
