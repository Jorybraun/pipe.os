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
import {
  UserPlus, Search, X, ChevronRight, Loader,
  Mail, Phone, Building2, Briefcase, Link, StickyNote, Trash2, Save,
} from 'lucide-react';
import { createApiClient } from '../lib/api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type ContactType = 'lead' | 'candidate' | 'customer' | 'other';

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
  candidate: 'CANDIDATE',
  customer:  'CUSTOMER',
  other:     'OTHER',
};

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ContactsPage(): JSX.Element {
  const { getToken } = useAuth();
  const api = createApiClient({ getToken });

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ContactType | 'all'>('all');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [showAdd, setShowAdd] = useState(false);

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
    if (typeFilter !== 'all' && c.type !== typeFilter) return false;
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
              CONTACTS
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {contacts.length} {contacts.length === 1 ? 'person' : 'people'}
            </div>
          </div>

          {/* Type filter pills */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'lead', 'candidate', 'customer', 'other'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
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
                    ? (t === 'all' ? 'rgba(255,255,255,0.3)' : TYPE_COLORS[t as ContactType])
                    : 'var(--pipe-border)',
                  background: typeFilter === t
                    ? (t === 'all' ? 'rgba(255,255,255,0.06)' : `${TYPE_COLORS[t as ContactType]}18`)
                    : 'transparent',
                  color: typeFilter === t
                    ? (t === 'all' ? 'var(--pipe-text)' : TYPE_COLORS[t as ContactType])
                    : 'var(--pipe-text-dim)',
                }}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

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
            <UserPlus size={13} /> ADD
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
              placeholder="SEARCH BY NAME, EMAIL, COMPANY..."
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
                {search || typeFilter !== 'all' ? 'NO_MATCHES_FOUND' : 'NO_CONTACTS_YET'}
              </div>
              {!search && typeFilter === 'all' && (
                <div style={{ fontSize: 9, opacity: 0.6 }}>
                  Add someone by clicking ADD above
                </div>
              )}
            </div>
          )}
          {filtered.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              isSelected={selected?.id === contact.id}
              onClick={() => { setSelected(contact); setShowAdd(false); }}
            />
          ))}
        </div>
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
        background: isSelected ? 'rgba(255,255,255,0.04)' : 'transparent',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)'; }}
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
            background: 'rgba(255,255,255,0.03)',
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
            background: 'rgba(255,255,255,0.03)',
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
              {t.toUpperCase()}
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
