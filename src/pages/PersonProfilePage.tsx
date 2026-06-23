import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  FileText,
  Mail,
  Network,
  Phone,
  Signal,
  UserRound,
} from 'lucide-react';
import { LivingContextGraph } from '../components/Candidate/LivingContextGraph';
import { createApiClient } from '../lib/api/client';
import type { LivingContextReadModel } from '../lib/api/types';

interface PersonContact {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  role: string | null;
  phone: string | null;
  linkedin: string | null;
  notes: string | null;
  type: string;
  created_at: string;
  updated_at: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function typeLabel(value: string | null | undefined): string {
  if (!value) return 'person';
  return value.replace(/[_-]+/g, ' ').toLowerCase();
}

function metadataSummary(metadata: Record<string, unknown>): string | null {
  const summary = metadata.summary ?? metadata.title ?? metadata.description ?? metadata.event;
  if (typeof summary === 'string' && summary.trim()) return summary;
  return null;
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div style={{
      border: '1px solid var(--pipe-border-light)',
      background: 'var(--pipe-surface-solid)',
      padding: 14,
      minHeight: 72,
    }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--pipe-text)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
        {label}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: JSX.Element; label: string; value: string | null | undefined }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ color: 'var(--pipe-text-dim)', marginTop: 1 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--pipe-text)', overflowWrap: 'anywhere' }}>
          {value || 'Not recorded'}
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ children }: { children: string }): JSX.Element {
  return (
    <div style={{
      border: '1px dashed var(--pipe-border)',
      color: 'var(--pipe-text-dim)',
      padding: 24,
      textAlign: 'center',
      fontSize: 12,
    }}>
      {children}
    </div>
  );
}

export default function PersonProfilePage(): JSX.Element {
  const { personId } = useParams<{ personId: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const api = useMemo(() => createApiClient({ getToken }), [getToken]);

  const [contact, setContact] = useState<PersonContact | null>(null);
  const [livingContext, setLivingContext] = useState<LivingContextReadModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSourceGraph, setShowSourceGraph] = useState(false);

  const contextEndpoint = personId ? `/api/v1/contacts/${personId}/living-context` : null;

  const load = useCallback(async (): Promise<void> => {
    if (!personId || !contextEndpoint) return;
    setIsLoading(true);
    setError(null);
    try {
      const [contactResponse, contextResponse] = await Promise.all([
        api.get<{ contact: PersonContact }>(`/api/v1/contacts/${personId}`),
        api.get<LivingContextReadModel>(contextEndpoint),
      ]);
      setContact(contactResponse.contact);
      setLivingContext(contextResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load person profile.');
      setContact(null);
      setLivingContext(null);
    } finally {
      setIsLoading(false);
    }
  }, [api, contextEndpoint, personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayName = contact?.name
    ?? livingContext?.person?.displayName
    ?? contact?.email
    ?? 'Person';

  const recentInteractions = livingContext?.interactions.slice(0, 5) ?? [];
  const recentRecords = livingContext?.contextRecords.slice(0, 5) ?? [];
  const sourceBackedSignals = livingContext?.signals
    .filter((signal) => signal.evidence.some((evidence) => evidence.sources.length > 0))
    .slice(0, 5) ?? [];
  const evidenceArtifacts = livingContext?.artifacts.slice(0, 5) ?? [];

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: 'var(--pipe-text-dim)' }}>
        Loading person context...
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div style={{ padding: 32 }}>
        <button onClick={() => navigate('/people')} style={backButtonStyle}>
          <ArrowLeft size={14} /> PEOPLE
        </button>
        <EmptyPanel>{error ?? 'Person not found.'}</EmptyPanel>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 32px 48px', maxWidth: 1320, margin: '0 auto' }}>
      <button onClick={() => navigate('/people')} style={backButtonStyle}>
        <ArrowLeft size={14} /> PEOPLE
      </button>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 0.78fr) minmax(0, 1.22fr)',
        gap: 24,
        alignItems: 'stretch',
        marginTop: 18,
      }}>
        <div style={{
          border: '1px solid var(--pipe-border)',
          background: 'var(--pipe-surface-solid)',
          padding: 24,
          minHeight: 260,
        }}>
          <div style={{
            width: 56,
            height: 56,
            border: '1px solid var(--pipe-accent-border)',
            background: 'var(--pipe-accent-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            color: 'var(--pipe-accent)',
          }}>
            <UserRound size={26} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--pipe-text-dim)', marginBottom: 8 }}>
            {typeLabel(contact.type)}
          </div>
          <h1 style={{
            margin: 0,
            color: 'var(--pipe-text)',
            fontSize: 34,
            lineHeight: 1.05,
            letterSpacing: 0,
          }}>
            {displayName}
          </h1>
          <p style={{ color: 'var(--pipe-text-muted)', margin: '12px 0 0', fontSize: 13, lineHeight: 1.5 }}>
            {livingContext?.person?.relationshipSummary
              ?? contact.notes
              ?? 'No relationship summary has been earned from evidence yet.'}
          </p>
        </div>

        <div style={{
          border: '1px solid var(--pipe-border)',
          background: 'var(--pipe-surface)',
          padding: 24,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 18,
          alignContent: 'start',
        }}>
          <InfoRow icon={<Mail size={14} />} label="Email" value={contact.email} />
          <InfoRow icon={<Phone size={14} />} label="Phone" value={contact.phone ?? livingContext?.person?.primaryPhone} />
          <InfoRow icon={<Briefcase size={14} />} label="Role / context" value={contact.role ?? livingContext?.person?.roles[0]?.label} />
          <InfoRow icon={<Calendar size={14} />} label="Known since" value={formatDate(contact.created_at)} />
        </div>
      </section>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10,
        marginTop: 18,
      }}>
        <Metric label="Interactions" value={livingContext?.summary.interactionCount ?? 0} />
        <Metric label="Context records" value={livingContext?.summary.contextRecordCount ?? 0} />
        <Metric label="Source spans" value={livingContext?.summary.sourceSpanCount ?? 0} />
        <Metric label="Source artifacts" value={livingContext?.summary.artifactCount ?? 0} />
      </section>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: 18,
        marginTop: 18,
      }}>
        <Panel title="Relationship Timeline" icon={<Calendar size={15} />}>
          {recentInteractions.length === 0 ? (
            <EmptyPanel>No interactions have been captured yet.</EmptyPanel>
          ) : recentInteractions.map((interaction) => (
            <article key={interaction.id} style={listItemStyle}>
              <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                {typeLabel(interaction.interactionType)}
              </div>
              <div style={{ marginTop: 5, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                {formatDate(interaction.startedAt ?? interaction.createdAt)}
              </div>
              {interaction.externalReference && (
                <div style={{ marginTop: 6, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                  {interaction.externalReference}
                </div>
              )}
              {metadataSummary(interaction.metadata) && (
                <p style={{ margin: '8px 0 0', color: 'var(--pipe-text-muted)', fontSize: 12, lineHeight: 1.45 }}>
                  {metadataSummary(interaction.metadata)}
                </p>
              )}
            </article>
          ))}
        </Panel>

        <Panel title="Interview Performance" icon={<Signal size={15} />}>
          {sourceBackedSignals.length === 0 ? (
            <EmptyPanel>No source-backed performance evidence yet.</EmptyPanel>
          ) : sourceBackedSignals.map((signal) => (
            <article key={signal.signalKey} style={listItemStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                  {signal.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                  {signal.evidenceCount} evidence
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.45 }}>
                {Math.round(signal.totalScore * 100)}% accumulated from {signal.sourceDiversity} source{signal.sourceDiversity === 1 ? '' : 's'}.
              </div>
            </article>
          ))}
        </Panel>

        <Panel title="Context Records" icon={<Network size={15} />}>
          {recentRecords.length === 0 ? (
            <EmptyPanel>No context records yet.</EmptyPanel>
          ) : recentRecords.map((record) => (
            <article key={record.id} style={listItemStyle}>
              <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                {record.predicate}
              </div>
              <p style={{ margin: '8px 0 0', color: 'var(--pipe-text-muted)', fontSize: 12, lineHeight: 1.45 }}>
                {record.narrative ?? record.recordType}
              </p>
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                {record.sources.length} source {record.sources.length === 1 ? 'span' : 'spans'}
              </div>
            </article>
          ))}
        </Panel>

        <Panel title="Source Evidence" icon={<FileText size={15} />}>
          {evidenceArtifacts.length === 0 ? (
            <EmptyPanel>No source artifacts have been attached yet.</EmptyPanel>
          ) : evidenceArtifacts.map((artifact) => (
            <article key={artifact.id} style={listItemStyle}>
              <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                {artifact.artifactType}
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                {artifact.logicalKey ?? artifact.id}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                {artifact.sourceSpans.length} exact {artifact.sourceSpans.length === 1 ? 'span' : 'spans'}
              </div>
            </article>
          ))}
        </Panel>
      </section>

      <section style={{ marginTop: 22 }}>
        <div style={GRAPH_HEADER}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Network size={16} color="var(--pipe-accent)" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--pipe-text)', letterSpacing: 0 }}>
                Source Graph
              </h2>
              <p style={GRAPH_SUBTITLE}>
                Inspect the exact records, spans, assertions, and projections behind this profile.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowSourceGraph((value) => !value)}
            style={GRAPH_TOGGLE}
          >
            {showSourceGraph ? 'Hide graph' : 'Open graph'}
          </button>
        </div>
        {showSourceGraph && contextEndpoint ? (
          <LivingContextGraph
            candidateId={personId ?? contact.id}
            livingContextEndpoint={contextEndpoint}
            initialLivingContext={livingContext}
          />
        ) : (
          <div style={SOURCE_GRAPH_PLACEHOLDER}>
            This profile is summarized from source-backed context. Open the graph when you need to audit provenance or debug ingestion.
          </div>
        )}
      </section>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: JSX.Element; children: ReactNode }): JSX.Element {
  return (
    <section style={{
      border: '1px solid var(--pipe-border)',
      background: 'var(--pipe-surface-solid)',
      minHeight: 240,
    }}>
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid var(--pipe-border-light)',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        color: 'var(--pipe-text)',
        fontSize: 12,
        fontWeight: 800,
      }}>
        <span style={{ color: 'var(--pipe-text-dim)' }}>{icon}</span>
        {title}
      </div>
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        {children}
      </div>
    </section>
  );
}

const backButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--pipe-text-dim)',
  cursor: 'pointer',
  fontSize: 11,
  padding: 0,
} satisfies CSSProperties;

const listItemStyle = {
  border: '1px solid var(--pipe-border-light)',
  background: 'var(--pipe-surface)',
  padding: 12,
} satisfies CSSProperties;

const GRAPH_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 12,
};

const GRAPH_SUBTITLE: CSSProperties = {
  maxWidth: 680,
  margin: '6px 0 0',
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.5,
};

const GRAPH_TOGGLE: CSSProperties = {
  flex: '0 0 auto',
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  cursor: 'pointer',
  padding: '9px 12px',
  fontSize: 11,
  fontWeight: 700,
};

const SOURCE_GRAPH_PLACEHOLDER: CSSProperties = {
  border: '1px dashed var(--pipe-border)',
  background: 'var(--pipe-surface-solid)',
  color: 'var(--pipe-text-dim)',
  padding: 18,
  fontSize: 12,
  lineHeight: 1.6,
};
