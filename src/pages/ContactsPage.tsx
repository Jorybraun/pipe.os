/**
 * ContactsPage — unified address book for leads, candidates, customers.
 *
 * Route: /contacts
 *
 * Features:
 *   - List all contacts with search + type filter
 *   - Add a contact by email (name auto-populated if you know it)
 *   - Click a contact to open a detail/edit drawer
 *   - Delete a contact
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@clerk/react';
import { useNavigate } from 'react-router-dom';
import {
  UserPlus, Search, X, ChevronRight, Loader,
  Mail, Phone, Building2, Briefcase, Link, StickyNote, Trash2, Save,
} from 'lucide-react';
import { createApiClient } from '../lib/api/client';
import type { LivingContextReadModel } from '../lib/api/types';
import { LivingContextGraph } from '../components/Candidate/LivingContextGraph';

// ─── Types ───────────────────────────────────────────────────────────────────

type ContactType = 'lead' | 'candidate' | 'customer' | 'other';

interface PdlPerson {
  poolId: string;
  status: string;
  personId: string | null;
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  job_title_role: string | null;
  job_title_levels: string[] | null;
  job_company_name: string | null;
  job_company_website: string | null;
  location_name: string | null;
  location_country: string | null;
  // PDL returns email/phone as presence flags (boolean) in search results
  work_email?: boolean;
  personal_emails?: boolean;
  recommended_personal_email?: boolean;
  mobile_phone?: boolean;
  phone_numbers?: boolean;
  // Legacy/mock format (array of objects)
  emails?: Array<{ address: string; type: string }> | null;
  phone_numbers_legacy?: Array<{ number: string; type: string }> | null;
  linkedin_url: string | null;
  github_url: string | null;
  skills: string[] | null;
  industry: string | null;
}

interface Contact {
  id:         string;
  email:      string;
  name:       string | null;
  company:    string | null;
  role:       string | null;
  phone:      string | null;
  linkedin:   string | null;
  notes:      string | null;
  type:       ContactType;
  created_at: string;
  updated_at: string;
}

const TYPE_COLORS: Record<ContactType, string> = {
  lead:      '#fbbf24',
  candidate: '#60a5fa',
  customer:  '#4ade80',
  other:     '#9ca3af',
};

const TYPE_LABELS: Record<ContactType, string> = {
  lead:      'LEAD',
  candidate: 'PERSON',
  customer:  'CLIENT',
  other:     'OTHER',
};

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ContactsPage(): JSX.Element {
  const { getToken } = useAuth();
  const api = createApiClient({ getToken });
  const navigate = useNavigate();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [activeTab, setActiveTab] = useState<'contacts' | 'source'>('contacts');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ contacts: Contact[] }>('/api/v1/contacts');
      setContacts(res.contacts);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const filtered = contacts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.email.toLowerCase().includes(q) ||
      (c.name?.toLowerCase().includes(q) ?? false) ||
      (c.company?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: selected ? '1fr 380px' : '1fr',
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
              {activeTab === 'contacts' ? 'PEOPLE' : 'SOURCE'}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {activeTab === 'contacts'
                ? `${contacts.length} ${contacts.length === 1 ? 'person' : 'people'}`
                : 'Find people'}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['contacts', 'source'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setActiveTab(t); setSelected(null); setShowAdd(false); }}
                style={{
                  padding: '4px 10px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  border: '1px solid',
                  borderRadius: 3,
                  cursor: 'pointer',
                  borderColor: activeTab === t ? 'var(--pipe-accent-border)' : 'var(--pipe-border)',
                  background: activeTab === t ? 'var(--pipe-accent-surface)' : 'transparent',
                  color: activeTab === t ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
                }}
              >
                {t === 'contacts' ? 'PEOPLE' : 'SOURCE'}
              </button>
            ))}
          </div>

          {activeTab === 'contacts' && (
            <button
              onClick={() => { setShowAdd(true); setSelected(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace',
                background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
                borderRadius: 4, color: '#4ade80', cursor: 'pointer',
              }}
            >
              <UserPlus size={13} /> ADD PERSON
            </button>
          )}
        </div>

        {activeTab === 'contacts' ? (
          <>
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
                  placeholder="SEARCH BY NAME, EMAIL, COMPANY..."
                  style={{
                    width: '100%', padding: '8px 8px 8px 30px',
                    fontSize: 9, fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.08em',
                    background: 'var(--pipe-surface)',
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

            {/* Contact list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {isLoading && (
                <div style={{ padding: 40, display: 'flex', justifyContent: 'center', color: 'var(--pipe-text-dim)' }}>
                  <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />
                </div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--pipe-text-dim)' }}>
                  <div style={{ fontSize: 11, marginBottom: 8 }}>
                    {search ? 'No matches found' : 'No people yet'}
                  </div>
                  {!search && (
                    <div style={{ fontSize: 9, opacity: 0.6 }}>
                      Add a person or invite someone to an interview.
                    </div>
                  )}
                </div>
              )}
              {filtered.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  isSelected={selected?.id === contact.id}
                  onClick={() => { navigate(`/people/${contact.id}`); }}
                />
              ))}
            </div>
          </>
        ) : (
          <SourceSearchPanel
            api={api}
            onContact={() => { setActiveTab('contacts'); void load(); }}
          />
        )}
      </div>

      {/* ── Detail / Add panel ────────────────────────────────────────────── */}
      {(selected || showAdd) && (
        <div style={{
          borderLeft: '1px solid var(--pipe-border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {showAdd && !selected ? (
            <AddContactPanel
              onSaved={(c) => { setContacts((prev) => [c, ...prev]); setSelected(c); setShowAdd(false); }}
              onClose={() => setShowAdd(false)}
              api={api}
            />
          ) : selected ? (
            <ContactDetailPanel
              contact={selected}
              onUpdated={(c) => {
                setContacts((prev) => prev.map((x) => x.id === c.id ? c : x));
                setSelected(c);
              }}
              onDeleted={() => {
                setContacts((prev) => prev.filter((x) => x.id !== selected.id));
                setSelected(null);
              }}
              onClose={() => setSelected(null)}
              api={api}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Contact Row ─────────────────────────────────────────────────────────────

function ContactRow({ contact, isSelected, onClick }: {
  contact: Contact;
  isSelected: boolean;
  onClick: () => void;
}): JSX.Element {
  const initials = contact.name
    ? contact.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : (contact.email[0] ?? '?').toUpperCase();

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--pipe-border)',
        cursor: 'pointer',
        background: isSelected ? 'var(--pipe-surface-hover)' : 'transparent',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'var(--pipe-surface)'; }}
      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      {/* Avatar */}
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: `${TYPE_COLORS[contact.type as ContactType]}18`,
        border: `1px solid ${TYPE_COLORS[contact.type as ContactType]}40`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: TYPE_COLORS[contact.type as ContactType],
      }}>
        {initials}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contact.name ?? contact.email}
          </span>
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
            padding: '2px 5px', borderRadius: 2,
            background: `${TYPE_COLORS[contact.type as ContactType]}18`,
            color: TYPE_COLORS[contact.type as ContactType],
            flexShrink: 0,
          }}>
            {TYPE_LABELS[contact.type as ContactType]}
          </span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {contact.name ? contact.email : ''}
          {contact.company && ` · ${contact.company}`}
        </div>
      </div>
      <ChevronRight size={12} style={{ color: 'var(--pipe-text-dim)', flexShrink: 0 }} />
    </div>
  );
}

// ─── Add Contact Panel ────────────────────────────────────────────────────────

function AddContactPanel({ onSaved, onClose, api }: {
  onSaved: (c: Contact) => void;
  onClose: () => void;
  api: ReturnType<typeof createApiClient>;
}): JSX.Element {
  const [form, setForm] = useState({ email: '', name: '', company: '', role: '', phone: '', linkedin: '', notes: '', type: 'lead' as ContactType });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (): Promise<void> => {
    if (!form.email) { setError('Email is required'); return; }
    setError(null);
    setIsSaving(true);
    try {
      const res = await api.post<{ contact: Contact }>('/api/v1/contacts', {
        ...form,
        name:     form.name     || undefined,
        company:  form.company  || undefined,
        role:     form.role     || undefined,
        phone:    form.phone    || undefined,
        linkedin: form.linkedin || undefined,
        notes:    form.notes    || undefined,
      });
      onSaved(res.contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ContactForm
      title="ADD_CONTACT"
      form={form}
      onChange={(k, v) => setForm((prev) => ({ ...prev, [k]: v }))}
      onSave={() => void handleSave()}
      onClose={onClose}
      isSaving={isSaving}
      error={error}
      saveLabel="ADD"
    />
  );
}

// ─── Contact Detail Panel ─────────────────────────────────────────────────────

function ContactDetailPanel({ contact, onUpdated, onDeleted, onClose, api }: {
  contact: Contact;
  onUpdated: (c: Contact) => void;
  onDeleted: () => void;
  onClose: () => void;
  api: ReturnType<typeof createApiClient>;
}): JSX.Element {
  const [form, setForm] = useState({
    email: contact.email,
    name: contact.name ?? '',
    company: contact.company ?? '',
    role: contact.role ?? '',
    phone: contact.phone ?? '',
    linkedin: contact.linkedin ?? '',
    notes: contact.notes ?? '',
    type: contact.type,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'context'>('details');

  // Reset form when contact changes
  useEffect(() => {
    setForm({
      email: contact.email,
      name: contact.name ?? '',
      company: contact.company ?? '',
      role: contact.role ?? '',
      phone: contact.phone ?? '',
      linkedin: contact.linkedin ?? '',
      notes: contact.notes ?? '',
      type: contact.type,
    });
    setError(null);
    setActiveTab('details');
  }, [contact.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (): Promise<void> => {
    setError(null);
    setIsSaving(true);
    try {
      const res = await api.patch<{ contact: Contact }>(`/api/v1/contacts/${contact.id}`, {
        ...form,
        name:     form.name     || undefined,
        company:  form.company  || undefined,
        role:     form.role     || undefined,
        phone:    form.phone    || undefined,
        linkedin: form.linkedin || undefined,
        notes:    form.notes    || undefined,
      });
      onUpdated(res.contact);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!confirm(`Delete ${contact.name ?? contact.email}?`)) return;
    setIsDeleting(true);
    try {
      await api.del(`/api/v1/contacts/${contact.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setIsDeleting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with tabs */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--pipe-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['details', 'context'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '4px 10px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                border: '1px solid',
                borderRadius: 3,
                cursor: 'pointer',
                borderColor: activeTab === tab ? 'var(--pipe-accent-border)' : 'var(--pipe-border)',
                background: activeTab === tab ? 'var(--pipe-accent-surface)' : 'transparent',
                color: activeTab === tab ? 'var(--pipe-text)' : 'var(--pipe-text-dim)',
              }}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 4 }}>
          <X size={14} />
        </button>
      </div>

      {/* Tab content */}
      <div style={{
        flex: 1,
        overflow: activeTab === 'details' ? 'hidden' : 'auto',
        padding: activeTab === 'context' ? 16 : 0,
      }}>
        {activeTab === 'details' ? (
          <ContactForm
            title="CONTACT"
            form={form}
            onChange={(k, v) => setForm((prev) => ({ ...prev, [k]: v }))}
            onSave={() => void handleSave()}
            onClose={onClose}
            onDelete={() => void handleDelete()}
            isSaving={isSaving}
            isDeleting={isDeleting}
            error={error}
            saveLabel="SAVE"
          />
        ) : (
          <ContactLivingContext contactId={contact.id} api={api} />
        )}
      </div>
    </div>
  );
}

// ─── Shared Form ──────────────────────────────────────────────────────────────

function ContactForm({ title, form, onChange, onSave, onClose, onDelete, isSaving, isDeleting, error, saveLabel }: {
  title: string;
  form: { email: string; name: string; company: string; role: string; phone: string; linkedin: string; notes: string; type: ContactType };
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDelete?: () => void;
  isSaving: boolean;
  isDeleting?: boolean;
  error: string | null;
  saveLabel: string;
}): JSX.Element {
  const field = (icon: React.ReactNode, key: string, placeholder: string, multiline = false): JSX.Element => (
    <div style={{ display: 'flex', gap: 10, alignItems: multiline ? 'flex-start' : 'center' }}>
      <div style={{ color: 'var(--pipe-text-dim)', flexShrink: 0, paddingTop: multiline ? 2 : 0 }}>
        {icon}
      </div>
      {multiline ? (
        <textarea
          value={form[key as keyof typeof form]}
          onChange={(e) => onChange(key, e.target.value)}
          placeholder={placeholder}
          rows={4}
          style={{
            flex: 1, padding: '8px 10px', fontSize: 11,
            fontFamily: '"Space Mono", monospace',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)', borderRadius: 4,
            color: 'var(--pipe-text)', outline: 'none', resize: 'vertical',
          }}
        />
      ) : (
        <input
          value={form[key as keyof typeof form]}
          onChange={(e) => onChange(key, e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1, padding: '8px 10px', fontSize: 11,
            fontFamily: '"Space Mono", monospace',
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)', borderRadius: 4,
            color: 'var(--pipe-text)', outline: 'none',
          }}
        />
      )}
    </div>
  );

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
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Type selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          {(['lead', 'candidate', 'customer', 'other'] as ContactType[]).map((t) => (
            <button
              key={t}
              onClick={() => onChange('type', t)}
              style={{
                padding: '4px 10px', fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace', border: '1px solid', borderRadius: 3, cursor: 'pointer',
                borderColor: form.type === t ? TYPE_COLORS[t] : 'var(--pipe-border)',
                background: form.type === t ? `${TYPE_COLORS[t]}18` : 'transparent',
                color: form.type === t ? TYPE_COLORS[t] : 'var(--pipe-text-dim)',
              }}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {field(<Mail size={13} />, 'email', 'email@example.com')}
        {field(<UserPlus size={13} />, 'name', 'Full name')}
        {field(<Building2 size={13} />, 'company', 'Company')}
        {field(<Briefcase size={13} />, 'role', 'Role / title')}
        {field(<Phone size={13} />, 'phone', '+1 555 000 0000')}
        {field(<Link size={13} />, 'linkedin', 'linkedin.com/in/...')}
        {field(<StickyNote size={13} />, 'notes', 'Notes...', true)}

        {error && (
          <div style={{
            padding: '8px 12px', background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4,
            fontSize: 10, color: '#f87171',
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{
        padding: '12px 20px', borderTop: '1px solid var(--pipe-border)',
        display: 'flex', gap: 8, flexShrink: 0,
      }}>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={isDeleting}
            style={{
              width: 36, height: 36, borderRadius: 4, border: 'none', flexShrink: 0,
              background: 'rgba(248,113,113,0.08)', color: '#f87171', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {isDeleting ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={13} />}
          </button>
        )}
        <button
          onClick={onSave}
          disabled={isSaving}
          style={{
            flex: 1, padding: '10px 0', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 4, color: '#4ade80', cursor: isSaving ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {isSaving
            ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> SAVING...</>
            : <><Save size={12} /> {saveLabel}</>}
        </button>
      </div>
    </div>
  );
}

// ─── Source Search Panel ─────────────────────────────────────────────────────

function trimPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/, '').trim();
}

function firstSentence(raw: string): string {
  // Stop at first sentence terminator followed by space or end of string
  const m = raw.match(/^([^.,;:!?]+[.,;:!?]?)(?:\s+|$)/);
  return m ? m[1]!.trim() : raw.trim();
}

function parseSearchQuery(raw: string): { jobTitleRole: string | undefined; jobCompanyName: string | undefined; locationCountry: string | undefined } {
  const sentence = firstSentence(raw.toLowerCase().trim());
  if (!sentence) return { jobTitleRole: undefined, jobCompanyName: undefined, locationCountry: undefined };

  const atInMatch = sentence.match(/^(.*?)\s+at\s+(.+?)(?:\s+in\s+(.+))?$/);
  if (atInMatch) {
    return {
      jobTitleRole: trimPunctuation(atInMatch[1]!).trim(),
      jobCompanyName: trimPunctuation(atInMatch[2]!).trim(),
      locationCountry: atInMatch[3] ? trimPunctuation(atInMatch[3]).trim() : undefined,
    };
  }

  const inMatch = sentence.match(/^(.*?)\s+in\s+(.+)$/);
  if (inMatch) {
    return {
      jobTitleRole: trimPunctuation(inMatch[1]!).trim(),
      jobCompanyName: undefined,
      locationCountry: trimPunctuation(inMatch[2]!).trim(),
    };
  }

  return { jobTitleRole: trimPunctuation(sentence), jobCompanyName: undefined, locationCountry: undefined };
}

function SourceSearchPanel({ api, onContact }: {
  api: ReturnType<typeof createApiClient>;
  onContact: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({
    hasPhone: false,
    hasEmail: true,
    size: 10,
  });
  const [results, setResults] = useState<PdlPerson[]>([]);
  const [total, setTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionIds, setActionIds] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<Set<'role' | 'company' | 'location'>>(new Set());

  const parsed = parseSearchQuery(query);

  const handleSearch = async (): Promise<void> => {
    setIsSearching(true);
    setSearchError(null);
    try {
      const payload: Record<string, unknown> = { size: filters.size };
      if (parsed.jobTitleRole && !excluded.has('role')) payload.jobTitleRole = parsed.jobTitleRole;
      if (parsed.jobCompanyName && !excluded.has('company')) payload.jobCompanyName = parsed.jobCompanyName;
      if (parsed.locationCountry && !excluded.has('location')) payload.locationCountry = parsed.locationCountry;
      if (filters.hasPhone) payload.hasPhone = true;
      if (filters.hasEmail) payload.hasEmail = true;

      const res = await api.post<{ results: PdlPerson[]; total: number; cached: boolean }>('/api/v1/outreach/search', payload);
      setResults(res.results);
      setTotal(res.total);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleFlag = async (person: PdlPerson): Promise<void> => {
    setActionIds((prev) => new Set(prev).add(person.poolId));
    try {
      await api.post('/api/v1/outreach/flag', { poolId: person.poolId });
      setResults((prev) => prev.map((p) => p.poolId === person.poolId ? { ...p, status: 'flagged' } : p));
    } catch (err) {
      console.error('[SourceSearchPanel] flag failed:', err);
    } finally {
      setActionIds((prev) => { const next = new Set(prev); next.delete(person.poolId); return next; });
    }
  };

  const handleDismiss = async (person: PdlPerson): Promise<void> => {
    setActionIds((prev) => new Set(prev).add(person.poolId));
    try {
      await api.post('/api/v1/outreach/dismiss', { poolId: person.poolId });
      setResults((prev) => prev.filter((p) => p.poolId !== person.poolId));
    } catch (err) {
      console.error('[SourceSearchPanel] dismiss failed:', err);
    } finally {
      setActionIds((prev) => { const next = new Set(prev); next.delete(person.poolId); return next; });
    }
  };

  const handleContact = async (person: PdlPerson, channel: 'phone' | 'email' | 'invite'): Promise<void> => {
    setActionIds((prev) => new Set(prev).add(person.poolId));
    try {
      await api.post('/api/v1/outreach/contact', { poolId: person.poolId, channel });
      setResults((prev) => prev.map((p) => p.poolId === person.poolId ? { ...p, status: 'contacted' } : p));
      onContact();
    } catch (err) {
      console.error('[SourceSearchPanel] contact failed:', err);
    } finally {
      setActionIds((prev) => { const next = new Set(prev); next.delete(person.poolId); return next; });
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Search form */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--pipe-border)', flexShrink: 0 }}>
        <div style={{ marginBottom: 10 }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setExcluded(new Set()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
            placeholder="e.g. software engineer at Stripe in united states"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 12,
              fontFamily: '"Space Mono", monospace',
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)', borderRadius: 4,
              color: 'var(--pipe-text)', outline: 'none',
            }}
          />
          <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 6 }}>
            Try: <em style={{ color: 'var(--pipe-text-muted)' }}>"software engineer at google in united states"</em> or <em style={{ color: 'var(--pipe-text-muted)' }}>"product manager in canada"</em>
          </div>
        </div>

        {/* Parsed filter chips */}
        {(parsed.jobTitleRole || parsed.jobCompanyName || parsed.locationCountry) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 8, color: 'var(--pipe-text-dim)', marginRight: 4 }}>Parsed:</span>
            {parsed.jobTitleRole && (
              <button
                onClick={() => setExcluded((prev) => { const n = new Set(prev); if (n.has('role')) n.delete('role'); else n.add('role'); return n; })}
                style={{
                  fontSize: 9, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  background: excluded.has('role') ? 'transparent' : 'rgba(96,165,250,0.12)',
                  color: excluded.has('role') ? 'var(--pipe-text-dim)' : '#60a5fa',
                  textDecoration: excluded.has('role') ? 'line-through' : 'none',
                }}
                title={excluded.has('role') ? 'Click to include role in search' : 'Click to exclude role from search'}
              >
                role: {parsed.jobTitleRole} {excluded.has('role') ? '+' : '×'}
              </button>
            )}
            {parsed.jobCompanyName && (
              <button
                onClick={() => setExcluded((prev) => { const n = new Set(prev); if (n.has('company')) n.delete('company'); else n.add('company'); return n; })}
                style={{
                  fontSize: 9, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  background: excluded.has('company') ? 'transparent' : 'rgba(168,85,247,0.12)',
                  color: excluded.has('company') ? 'var(--pipe-text-dim)' : '#a855f7',
                  textDecoration: excluded.has('company') ? 'line-through' : 'none',
                }}
                title={excluded.has('company') ? 'Click to include company in search' : 'Click to exclude company from search'}
              >
                company: {parsed.jobCompanyName} {excluded.has('company') ? '+' : '×'}
              </button>
            )}
            {parsed.locationCountry && (
              <button
                onClick={() => setExcluded((prev) => { const n = new Set(prev); if (n.has('location')) n.delete('location'); else n.add('location'); return n; })}
                style={{
                  fontSize: 9, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  background: excluded.has('location') ? 'transparent' : 'rgba(34,197,94,0.12)',
                  color: excluded.has('location') ? 'var(--pipe-text-dim)' : '#22c55e',
                  textDecoration: excluded.has('location') ? 'line-through' : 'none',
                }}
                title={excluded.has('location') ? 'Click to include location in search' : 'Click to exclude location from search'}
              >
                location: {parsed.locationCountry} {excluded.has('location') ? '+' : '×'}
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--pipe-text-dim)', cursor: 'pointer' }}>
            <input type="checkbox" checked={filters.hasEmail} onChange={(e) => setFilters((p) => ({ ...p, hasEmail: e.target.checked }))} /> Has email
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--pipe-text-dim)', cursor: 'pointer' }}>
            <input type="checkbox" checked={filters.hasPhone} onChange={(e) => setFilters((p) => ({ ...p, hasPhone: e.target.checked }))} /> Has phone
          </label>
        </div>

        <button onClick={() => void handleSearch()} disabled={isSearching} style={{ width: '100%', padding: '10px 0', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 4, color: '#4ade80', cursor: isSearching ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {isSearching ? <><Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> SEARCHING...</> : <><Search size={12} /> SEARCH</>}
        </button>
        {searchError && <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4, fontSize: 10, color: '#f87171' }}>{searchError}</div>}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {results.length === 0 && !isSearching && !searchError && <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--pipe-text-dim)' }}><div style={{ fontSize: 11 }}>Enter filters and click SEARCH</div></div>}
        {results.length > 0 && <div style={{ padding: '8px 24px', fontSize: 9, color: 'var(--pipe-text-dim)', borderBottom: '1px solid var(--pipe-border)' }}>{results.length} of {total} results</div>}
        {results.map((person) => (
          <div key={person.poolId} style={{ padding: '14px 24px', borderBottom: '1px solid var(--pipe-border)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: person.status === 'flagged' ? 'rgba(251,191,36,0.12)' : 'rgba(96,165,250,0.12)', border: `1px solid ${person.status === 'flagged' ? 'rgba(251,191,36,0.3)' : 'rgba(96,165,250,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: person.status === 'flagged' ? '#fbbf24' : '#60a5fa' }}>
              {(person.full_name ?? '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{person.full_name ?? 'Unknown'}</span>
                {person.status === 'flagged' && <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 5px', borderRadius: 2, background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>FLAGGED</span>}
                {person.status === 'contacted' && <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', padding: '2px 5px', borderRadius: 2, background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>CONTACTED</span>}
              </div>
              <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 4 }}>{person.job_title ?? 'No title'}{person.job_company_name && ` @ ${person.job_company_name}`}</div>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {person.work_email && <span>work email</span>}
                {person.personal_emails && <span>personal email</span>}
                {person.mobile_phone && <span>mobile phone</span>}
                {person.phone_numbers === true && <span>phone</span>}
                {person.emails && Array.isArray(person.emails) && person.emails[0] && <span>{person.emails[0].address}</span>}
                {person.phone_numbers_legacy && Array.isArray(person.phone_numbers_legacy) && person.phone_numbers_legacy[0] && <span>{person.phone_numbers_legacy[0].number}</span>}
                {person.location_name && <span>{person.location_name}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {person.status !== 'contacted' && (
                <>
                  <button onClick={() => void handleFlag(person)} disabled={actionIds.has(person.poolId)} style={{ padding: '5px 8px', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace', background: person.status === 'flagged' ? 'rgba(251,191,36,0.12)' : 'var(--pipe-surface)', border: '1px solid var(--pipe-border)', borderRadius: 3, color: person.status === 'flagged' ? '#fbbf24' : 'var(--pipe-text-dim)', cursor: actionIds.has(person.poolId) ? 'default' : 'pointer' }}>
                    {person.status === 'flagged' ? 'UNFLAG' : 'FLAG'}
                  </button>
                  <button onClick={() => void handleContact(person, 'phone')} disabled={actionIds.has(person.poolId)} style={{ padding: '5px 8px', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 3, color: '#4ade80', cursor: actionIds.has(person.poolId) ? 'default' : 'pointer' }}>CALL</button>
                  <button onClick={() => void handleContact(person, 'email')} disabled={actionIds.has(person.poolId)} style={{ padding: '5px 8px', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 3, color: '#4ade80', cursor: actionIds.has(person.poolId) ? 'default' : 'pointer' }}>EMAIL</button>
                  <button onClick={() => void handleContact(person, 'invite')} disabled={actionIds.has(person.poolId)} style={{ padding: '5px 8px', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 3, color: '#60a5fa', cursor: actionIds.has(person.poolId) ? 'default' : 'pointer' }}>INVITE</button>
                  <button onClick={() => void handleDismiss(person)} disabled={actionIds.has(person.poolId)} style={{ padding: '5px 8px', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', fontFamily: '"Space Mono", monospace', background: 'transparent', border: '1px solid var(--pipe-border)', borderRadius: 3, color: 'var(--pipe-text-dim)', cursor: actionIds.has(person.poolId) ? 'default' : 'pointer' }}>DISMISS</button>
                </>
              )}
              {person.status === 'contacted' && (
                <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)' }}>In graph</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Contact Living Context ─────────────────────────────────────────────────────

function ContactLivingContext({ contactId, api }: { contactId: string; api: ReturnType<typeof createApiClient> }): JSX.Element {
  const [livingContext, setLivingContext] = useState<LivingContextReadModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const endpoint = `/api/v1/contacts/${contactId}/living-context`;

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const res = await api.get<LivingContextReadModel>(endpoint);
        setLivingContext(res);
      } catch {
        setLivingContext(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [api, endpoint]);

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--pipe-text-dim)' }}>Loading context...</div>;
  if (!livingContext || livingContext.summary.interactionCount === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--pipe-text-dim)' }}>No context captured yet.</div>;
  }

  return (
    <LivingContextGraph
      candidateId={contactId}
      livingContextEndpoint={endpoint}
      initialLivingContext={livingContext}
    />
  );
}
