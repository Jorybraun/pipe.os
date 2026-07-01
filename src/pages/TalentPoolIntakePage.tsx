import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Github,
  Globe2,
  History,
  Linkedin,
  Loader2,
  Phone,
  Upload,
} from 'lucide-react';

type TalentPoolStatus =
  | 'PROFILE_NEEDED'
  | 'PROFILE_RECEIVED'
  | 'PHONE_SCREENER_OFFERED'
  | 'PHONE_SCREENER_SCHEDULED'
  | 'CHALLENGE_PREPARING'
  | 'CHALLENGE_READY'
  | 'ASSESSMENT_IN_PROGRESS'
  | 'COMPLETED';

type PhoneScreenerStatus = 'NOT_REQUESTED' | 'PHONE_SCREENER_OFFERED' | 'PHONE_SCREENER_SCHEDULED';

interface ReadyChallenge {
  title: string;
  type: string;
  entryUrl: string;
  summary: string;
}

interface CompletedChallenge {
  title: string;
  completedAt: string | null;
  summary: string;
}

interface TalentPoolDashboard {
  status: TalentPoolStatus;
  candidateName: string | null;
  profileReceivedAt: string | null;
  phoneScreener: {
    consent: boolean;
    status: PhoneScreenerStatus;
    phoneNumber: string | null;
    timezone: string | null;
    availability: string | null;
  };
  readyChallenges: ReadyChallenge[];
  completedChallenges: CompletedChallenge[];
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

interface FormState {
  resumeText: string;
  profileFile: File | null;
  githubUrl: string;
  linkedinUrl: string;
  portfolioUrl: string;
  phoneScreenerConsent: boolean;
  phoneNumber: string;
  timezone: string;
  availability: string;
}

const initialForm: FormState = {
  resumeText: '',
  profileFile: null,
  githubUrl: '',
  linkedinUrl: '',
  portfolioUrl: '',
  phoneScreenerConsent: false,
  phoneNumber: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
  availability: '',
};

const API_BASE =
  typeof import.meta !== 'undefined' && import.meta.env
    ? (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || '')
    : '';

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE) return normalizedPath;
  return `${API_BASE.replace(/\/$/, '')}${normalizedPath}`;
}

async function parseDashboardResponse(response: Response): Promise<TalentPoolDashboard> {
  if (response.ok) {
    return await response.json() as TalentPoolDashboard;
  }

  let body: ApiErrorBody | null = null;
  try {
    body = await response.json() as ApiErrorBody;
  } catch {
    body = null;
  }

  throw new Error(body?.error?.message ?? `Request failed with ${response.status}`);
}

function statusTitle(status: TalentPoolStatus): string {
  if (status === 'PROFILE_NEEDED') return 'Talent Pool';
  if (status === 'CHALLENGE_READY') return 'A challenge is ready';
  if (status === 'ASSESSMENT_IN_PROGRESS') return 'Assessment in progress';
  if (status === 'COMPLETED') return 'Completed work';
  return 'Profile received';
}

function statusCopy(status: TalentPoolStatus): string {
  if (status === 'PROFILE_NEEDED') return 'Share your profile and availability.';
  if (status === 'CHALLENGE_READY') return 'Your next assignment is available.';
  if (status === 'ASSESSMENT_IN_PROGRESS') return 'Your current assignment is open.';
  if (status === 'COMPLETED') return 'Your completed work is on file.';
  return "We're preparing the right challenge.";
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function createInitialFormFromDashboard(dashboard: TalentPoolDashboard): FormState {
  return {
    ...initialForm,
    profileFile: null,
    phoneScreenerConsent: dashboard.phoneScreener.consent,
    phoneNumber: dashboard.phoneScreener.phoneNumber ?? '',
    timezone: dashboard.phoneScreener.timezone ?? initialForm.timezone,
    availability: dashboard.phoneScreener.availability ?? '',
  };
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0c0c0e',
    color: '#f7f7fb',
    fontFamily: '"Space Mono", monospace',
  },
  shell: {
    width: 'min(1120px, calc(100vw - 32px))',
    margin: '0 auto',
    padding: '32px 0 56px',
  },
  masthead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    padding: '18px 0 28px',
    borderBottom: '1px solid rgba(255,255,255,0.14)',
  },
  wordmark: {
    fontSize: 13,
    letterSpacing: '0.18em',
    fontWeight: 700,
  },
  tokenPill: {
    minHeight: 32,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.68)',
    padding: '8px 12px',
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  hero: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: 32,
    alignItems: 'start',
    paddingTop: 42,
  },
  statusRail: {
    position: 'sticky',
    top: 24,
    paddingTop: 4,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    marginBottom: 18,
  },
  h1: {
    margin: 0,
    fontSize: 42,
    lineHeight: 1.05,
    letterSpacing: 0,
  },
  lead: {
    margin: '18px 0 0',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 15,
    lineHeight: 1.7,
    maxWidth: 440,
  },
  form: {
    display: 'grid',
    gap: 18,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.055)',
    padding: 22,
  },
  gridTwo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 14,
  },
  field: {
    display: 'grid',
    gap: 8,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 12,
    letterSpacing: '0.08em',
  },
  input: {
    width: '100%',
    minHeight: 44,
    boxSizing: 'border-box',
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(12,12,14,0.8)',
    color: '#f7f7fb',
    padding: '12px 13px',
    fontFamily: 'inherit',
    fontSize: 13,
    outline: 'none',
  },
  textarea: {
    width: '100%',
    minHeight: 176,
    resize: 'vertical',
    boxSizing: 'border-box',
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(12,12,14,0.8)',
    color: '#f7f7fb',
    padding: '13px',
    fontFamily: 'inherit',
    fontSize: 13,
    lineHeight: 1.6,
    outline: 'none',
  },
  checkboxRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    minHeight: 44,
    padding: '10px 0',
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
  },
  checkbox: {
    width: 18,
    height: 18,
    accentColor: '#f7f7fb',
  },
  submit: {
    minHeight: 48,
    border: '1px solid rgba(255,255,255,0.28)',
    background: '#f7f7fb',
    color: '#0c0c0e',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    fontFamily: 'inherit',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  secondaryBand: {
    borderTop: '1px solid rgba(255,255,255,0.14)',
    paddingTop: 24,
    marginTop: 28,
  },
  dashboard: {
    display: 'grid',
    gap: 22,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'rgba(255,255,255,0.05)',
    padding: 18,
  },
  rowTitle: {
    margin: 0,
    fontSize: 14,
    letterSpacing: 0,
  },
  rowCopy: {
    margin: '7px 0 0',
    color: 'rgba(255,255,255,0.64)',
    fontSize: 12,
    lineHeight: 1.6,
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    fontSize: 13,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    margin: '0 0 12px',
  },
  empty: {
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.035)',
    color: 'rgba(255,255,255,0.58)',
    padding: 16,
    fontSize: 12,
  },
  challengeButton: {
    minHeight: 42,
    border: '1px solid rgba(255,255,255,0.24)',
    background: 'transparent',
    color: '#f7f7fb',
    cursor: 'pointer',
    padding: '10px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: 'inherit',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: '1px solid rgba(255,110,110,0.45)',
    background: 'rgba(255,110,110,0.08)',
    color: '#ffc9c9',
    padding: 14,
    fontSize: 12,
    lineHeight: 1.5,
  },
  loader: {
    minHeight: '70vh',
    display: 'grid',
    placeItems: 'center',
    color: 'rgba(255,255,255,0.64)',
  },
};

function TalentPoolIntakePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const inviteToken = token ?? '';
  const [dashboard, setDashboard] = useState<TalentPoolDashboard | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolveToken(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(apiUrl('/rpc/talent/resolve-token'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inviteToken }),
        });
        const nextDashboard = await parseDashboardResponse(response);
        if (cancelled) return;
        setDashboard(nextDashboard);
        setForm(createInitialFormFromDashboard(nextDashboard));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load invite.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (inviteToken) {
      void resolveToken();
    } else {
      setLoading(false);
      setError('Invite token is missing.');
    }

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const canSubmit = useMemo(
    () => (form.resumeText.trim().length >= 20 || form.profileFile !== null) && !submitting,
    [form.profileFile, form.resumeText, submitting],
  );

  function appendIfPresent(formData: FormData, key: keyof FormState, value: string | boolean): void {
    if (typeof value === 'boolean') {
      formData.set(key, value ? 'true' : 'false');
      return;
    }
    if (value.trim().length > 0) formData.set(key, value.trim());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = form.profileFile
        ? await (async (): Promise<Response> => {
            const formData = new FormData();
            formData.set('inviteToken', inviteToken);
            formData.set('file', form.profileFile as File);
            appendIfPresent(formData, 'resumeText', form.resumeText);
            appendIfPresent(formData, 'githubUrl', form.githubUrl);
            appendIfPresent(formData, 'linkedinUrl', form.linkedinUrl);
            appendIfPresent(formData, 'portfolioUrl', form.portfolioUrl);
            appendIfPresent(formData, 'phoneScreenerConsent', form.phoneScreenerConsent);
            appendIfPresent(formData, 'phoneNumber', form.phoneNumber);
            appendIfPresent(formData, 'timezone', form.timezone);
            appendIfPresent(formData, 'availability', form.availability);
            return await fetch(apiUrl('/rpc/talent/upload-profile'), {
              method: 'POST',
              body: formData,
            });
          })()
        : await fetch(apiUrl('/rpc/talent/submit-profile'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inviteToken, ...form, profileFile: undefined }),
          });
      const nextDashboard = await parseDashboardResponse(response);
      setDashboard(nextDashboard);
      setForm(createInitialFormFromDashboard(nextDashboard));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit profile.');
    } finally {
      setSubmitting(false);
    }
  }

  const title = dashboard ? statusTitle(dashboard.status) : 'Talent Pool';
  const copy = dashboard ? statusCopy(dashboard.status) : 'Share your profile and availability.';
  const showForm = dashboard?.status === 'PROFILE_NEEDED';

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.loader}>
          <Loader2 size={22} aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.masthead}>
          <div style={styles.wordmark}>PIPE_OS</div>
          <div style={styles.tokenPill}>Talent Pool</div>
        </header>

        <div style={styles.hero}>
          <aside style={styles.statusRail}>
            <div style={styles.eyebrow}>
              {dashboard?.candidateName ? dashboard.candidateName : 'Candidate intake'}
            </div>
            <h1 style={styles.h1}>{title}</h1>
            <p style={styles.lead}>{copy}</p>
            {dashboard?.profileReceivedAt && (
              <p style={styles.lead}>Received {formatDate(dashboard.profileReceivedAt)}.</p>
            )}
          </aside>

          <div>
            {error && (
              <div role="alert" style={styles.error}>
                <AlertTriangle size={16} aria-hidden="true" />
                {error}
              </div>
            )}

            {showForm ? (
              <form style={styles.form} onSubmit={(event) => void handleSubmit(event)}>
                <label style={styles.field}>
                  <span style={styles.label}><Upload size={15} aria-hidden="true" />Resume file</span>
                  <input
                    aria-label="Resume file"
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    onChange={(event) => setForm((prev) => ({
                      ...prev,
                      profileFile: event.target.files?.[0] ?? null,
                    }))}
                    style={styles.input}
                  />
                  {form.profileFile && (
                    <span style={styles.rowCopy}>{form.profileFile.name}</span>
                  )}
                </label>

                <label style={styles.field}>
                  <span style={styles.label}>Resume or profile</span>
                  <textarea
                    aria-label="Resume or profile"
                    value={form.resumeText}
                    onChange={(event) => setForm((prev) => ({ ...prev, resumeText: event.target.value }))}
                    style={styles.textarea}
                    required={form.profileFile === null}
                    minLength={form.profileFile === null ? 20 : undefined}
                  />
                </label>

                <div style={styles.gridTwo}>
                  <label style={styles.field}>
                    <span style={styles.label}><Github size={15} aria-hidden="true" />GitHub</span>
                    <input
                      aria-label="GitHub"
                      value={form.githubUrl}
                      onChange={(event) => setForm((prev) => ({ ...prev, githubUrl: event.target.value }))}
                      style={styles.input}
                      inputMode="url"
                    />
                  </label>
                  <label style={styles.field}>
                    <span style={styles.label}><Linkedin size={15} aria-hidden="true" />LinkedIn</span>
                    <input
                      aria-label="LinkedIn"
                      value={form.linkedinUrl}
                      onChange={(event) => setForm((prev) => ({ ...prev, linkedinUrl: event.target.value }))}
                      style={styles.input}
                      inputMode="url"
                    />
                  </label>
                </div>

                <label style={styles.field}>
                  <span style={styles.label}><Globe2 size={15} aria-hidden="true" />Portfolio</span>
                  <input
                    aria-label="Portfolio"
                    value={form.portfolioUrl}
                    onChange={(event) => setForm((prev) => ({ ...prev, portfolioUrl: event.target.value }))}
                    style={styles.input}
                    inputMode="url"
                  />
                </label>

                <div style={styles.secondaryBand}>
                  <label style={styles.checkboxRow}>
                    <input
                      aria-label="Open to a short phone screen"
                      checked={form.phoneScreenerConsent}
                      onChange={(event) => setForm((prev) => ({
                        ...prev,
                        phoneScreenerConsent: event.target.checked,
                      }))}
                      type="checkbox"
                      style={styles.checkbox}
                    />
                    <span>Open to a short phone screen</span>
                  </label>

                  {form.phoneScreenerConsent && (
                    <div style={styles.gridTwo}>
                      <label style={styles.field}>
                        <span style={styles.label}><Phone size={15} aria-hidden="true" />Phone number</span>
                        <input
                          aria-label="Phone number"
                          value={form.phoneNumber}
                          onChange={(event) => setForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                          style={styles.input}
                          inputMode="tel"
                        />
                      </label>
                      <label style={styles.field}>
                        <span style={styles.label}><Clock3 size={15} aria-hidden="true" />Timezone</span>
                        <input
                          aria-label="Timezone"
                          value={form.timezone}
                          onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                          style={styles.input}
                        />
                      </label>
                      <label style={{ ...styles.field, gridColumn: '1 / -1' }}>
                        <span style={styles.label}>Availability</span>
                        <input
                          aria-label="Availability"
                          value={form.availability}
                          onChange={(event) => setForm((prev) => ({ ...prev, availability: event.target.value }))}
                          style={styles.input}
                        />
                      </label>
                    </div>
                  )}
                </div>

                <button type="submit" style={styles.submit} disabled={!canSubmit}>
                  {submitting ? <Loader2 size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                  Submit profile
                </button>
              </form>
            ) : dashboard ? (
              <section style={styles.dashboard}>
                <div style={styles.row}>
                  <div>
                    <h2 style={styles.rowTitle}>Profile status</h2>
                    <p style={styles.rowCopy}>Your profile is on file.</p>
                  </div>
                  <CheckCircle2 size={20} aria-hidden="true" />
                </div>

                <div style={styles.row}>
                  <div>
                    <h2 style={styles.rowTitle}>Short phone screen</h2>
                    <p style={styles.rowCopy}>
                      {dashboard.phoneScreener.consent
                        ? 'Open to a short call.'
                        : 'No phone screen requested.'}
                    </p>
                  </div>
                  <Phone size={20} aria-hidden="true" />
                </div>

                <section>
                  <h2 style={styles.sectionTitle}>
                    <ArrowRight size={15} aria-hidden="true" />
                    Ready challenges
                  </h2>
                  {dashboard.readyChallenges.length === 0 ? (
                    <div style={styles.empty}>No ready challenges yet.</div>
                  ) : (
                    <div style={styles.dashboard}>
                      {dashboard.readyChallenges.map((challenge) => (
                        <div key={`${challenge.type}:${challenge.entryUrl}`} style={styles.row}>
                          <div>
                            <h3 style={styles.rowTitle}>{challenge.title}</h3>
                            <p style={styles.rowCopy}>{challenge.summary}</p>
                          </div>
                          <button
                            type="button"
                            style={styles.challengeButton}
                            onClick={() => {
                              window.location.assign(challenge.entryUrl);
                            }}
                          >
                            Open
                            <ArrowRight size={14} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <h2 style={styles.sectionTitle}>
                    <History size={15} aria-hidden="true" />
                    Past work
                  </h2>
                  {dashboard.completedChallenges.length === 0 ? (
                    <div style={styles.empty}>No completed challenges yet.</div>
                  ) : (
                    <div style={styles.dashboard}>
                      {dashboard.completedChallenges.map((item) => (
                        <div key={`${item.title}:${item.completedAt ?? 'unknown'}`} style={styles.row}>
                          <div>
                            <h3 style={styles.rowTitle}>{item.title}</h3>
                            <p style={styles.rowCopy}>
                              {item.completedAt ? `Completed ${formatDate(item.completedAt)}.` : item.summary}
                            </p>
                          </div>
                          <CheckCircle2 size={18} aria-hidden="true" />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

export default TalentPoolIntakePage;
