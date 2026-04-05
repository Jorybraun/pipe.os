/**
 * RoleDiscoveryPage — AI-powered role context interview (ADR-027)
 *
 * Three-phase flow:
 * 1. Baseline form — structured data always collected
 * 2. AI interview — turn-based conversation with typed inputs
 * 3. Synthesis — narrative summary + domain coverage
 *
 * Route: /pipeline/new
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { FieldGroup, TextInput, TextareaInput, TagsInput, SelectInput, RadioGroup } from '../components/ui/form';
import { useRoleDiscovery } from '../hooks/useRoleDiscovery';
import { usePipelineCreate } from '../hooks/usePipelineCreate';
import { useApiClient } from '../hooks/useApiClient';
import { Loader2, ArrowRight, Sparkles, Check, MessageSquare, ChevronDown, Upload, FileText, Mic, Square } from 'lucide-react';
import type { RoleContextBaseline, RoleContextQuestion, RoleContextProgress, DomainCoverage, ParseJDResponse } from '../lib/api/types';
import type { PastExchange } from '../hooks/useRoleDiscovery';

// ─── Constants ──────────────────────────────────────────────────────────────

const LEVEL_OPTIONS = ['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Lead', 'Manager'];
const WORK_MODEL_OPTIONS = ['Remote', 'Hybrid', 'On-site'];
const BUDGET_OPTIONS = [
  { value: 5, label: '5 — Quick' },
  { value: 10, label: '10 — Standard' },
  { value: 15, label: '15 — Thorough' },
  { value: 20, label: '20 — Deep Dive' },
];

const DOMAIN_LABELS: Record<string, string> = {
  why: 'WHY',
  work: 'WORK',
  team: 'TEAM',
  bar: 'BAR',
  codebase: 'CODE',
  process: 'PROC',
};

const COVERAGE_LEVELS: Record<DomainCoverage, number> = {
  none: 0,
  sparse: 0.2,
  partial: 0.45,
  covered: 0.75,
  deep: 1,
};

const COVERAGE_COLORS: Record<DomainCoverage, string> = {
  none: 'rgba(255,255,255,0.06)',
  sparse: 'rgba(251, 191, 36, 0.4)',
  partial: 'rgba(251, 191, 36, 0.65)',
  covered: 'rgba(74, 222, 128, 0.6)',
  deep: 'rgba(74, 222, 128, 0.9)',
};

// ─── Domain Coverage Bars ───────────────────────────────────────────────────

function DomainBars({ domains }: { domains: Record<string, DomainCoverage> }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 48 }}>
      {Object.entries(DOMAIN_LABELS).map(([key, label]) => {
        const coverage = (domains[key] ?? 'none') as DomainCoverage;
        const level = COVERAGE_LEVELS[coverage];
        const color = COVERAGE_COLORS[coverage];
        return (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                width: 28,
                height: 36,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: `${level * 100}%`,
                  background: color,
                  transition: 'height 0.6s cubic-bezier(0.16, 1, 0.3, 1), background 0.4s ease',
                }}
              />
            </div>
            <span style={{
              fontSize: 7,
              letterSpacing: '0.1em',
              color: coverage === 'none' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)',
              fontFamily: '"Space Mono", monospace',
            }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Typing Indicator ───────────────────────────────────────────────────────

function TypingIndicator(): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '16px 0', alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'rgba(139, 92, 246, 0.6)',
            animation: `typingPulse 1.4s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes typingPulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ─── Past Exchange (collapsed) ──────────────────────────────────────────────

function PastExchangeCard({ exchange, index }: { exchange: PastExchange; index: number }): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        padding: expanded ? '16px 20px' : '10px 20px',
        background: 'rgba(255,255,255,0.02)',
        borderLeft: '2px solid rgba(139, 92, 246, 0.2)',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        marginBottom: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            fontSize: 8,
            letterSpacing: '0.15em',
            color: 'rgba(139, 92, 246, 0.5)',
            fontFamily: '"Space Mono", monospace',
            flexShrink: 0,
          }}>
            Q{index + 1}
          </span>
          <span style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.4)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'normal' : 'nowrap',
            fontFamily: '"Space Mono", monospace',
          }}>
            {exchange.questionText}
          </span>
        </div>
        <ChevronDown
          size={12}
          style={{
            color: 'rgba(255,255,255,0.2)',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.2s ease',
            flexShrink: 0,
          }}
        />
      </div>
      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.3)',
            marginBottom: 6,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
          }}>
            YOUR ANSWER
          </div>
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.55)',
            lineHeight: 1.6,
            fontFamily: '"Space Mono", monospace',
          }}>
            {exchange.answer}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dynamic Input Renderer ─────────────────────────────────────────────────

function QuestionInput({
  question,
  value,
  onChange,
  onSubmit,
}: {
  question: RoleContextQuestion;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}): JSX.Element {
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // Submit on Enter (but not in textarea — there use Cmd+Enter)
    if (e.key === 'Enter' && !e.shiftKey && question.input.type !== 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && question.input.type === 'textarea') {
      e.preventDefault();
      if (value.trim()) onSubmit();
    }
  };

  const inputProps = {
    value: value || '',
    onChange,
    placeholder: question.input.placeholder ?? '',
  };

  return (
    <div onKeyDown={handleKeyDown}>
      {question.input.type === 'textarea' && (
        <TextareaInput {...inputProps} rows={4} />
      )}
      {question.input.type === 'text' && (
        <TextInput {...inputProps} />
      )}
      {question.input.type === 'select' && question.input.options && (
        <SelectInput {...inputProps} options={question.input.options} />
      )}
      {question.input.type === 'radio' && question.input.options && (
        <RadioGroup value={value} onChange={onChange} options={question.input.options} />
      )}
      {question.input.type === 'tags' && (
        <TagsInput
          value={value ? value.split('|||') : []}
          onChange={(tags) => onChange(tags.join('|||'))}
          placeholder={question.input.placeholder ?? ''}
        />
      )}

      {/* Submit hint */}
      <div style={{
        marginTop: 10,
        fontSize: 9,
        color: 'rgba(255,255,255,0.2)',
        fontFamily: '"Space Mono", monospace',
        letterSpacing: '0.1em',
      }}>
        {question.input.type === 'textarea' ? 'CMD+ENTER TO SEND' : 'ENTER TO SEND'}
      </div>
    </div>
  );
}

// ─── Baseline Form ────��─────────────────────────────────────────────────────

function BaselinePhase({
  onSubmit,
  isLoading,
}: {
  onSubmit: (baseline: RoleContextBaseline, budget: number) => void;
  isLoading: boolean;
}): JSX.Element {
  const api = useApiClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [level, setLevel] = useState('Senior');
  const [stack, setStack] = useState<string[]>([]);
  const [department, setDepartment] = useState('');
  const [workModel, setWorkModel] = useState('');
  const [location, setLocation] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [reportsTo, setReportsTo] = useState('');
  const [budget, setBudget] = useState(10);

  // JD import state
  const [jdText, setJdText] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [didImport, setDidImport] = useState(false);

  const canSubmit = title.trim().length > 0 && !isLoading && !isParsing;

  const applyParsed = (parsed: ParseJDResponse['parsed']): void => {
    if (parsed.title) setTitle(parsed.title);
    if (parsed.level && LEVEL_OPTIONS.includes(parsed.level)) setLevel(parsed.level);
    if (parsed.stack?.length) setStack(parsed.stack);
    if (parsed.department) setDepartment(parsed.department);
    if (parsed.workModel && WORK_MODEL_OPTIONS.includes(parsed.workModel)) setWorkModel(parsed.workModel);
    if (parsed.location) setLocation(parsed.location);
    if (parsed.teamSize) setTeamSize(parsed.teamSize);
    if (parsed.reportsTo) setReportsTo(parsed.reportsTo);
    setDidImport(true);
  };

  const handleParseText = async (): Promise<void> => {
    if (jdText.trim().length < 20) return;
    setIsParsing(true);
    setParseError(null);
    try {
      const data = await api.post<ParseJDResponse>('/api/v1/role-contexts/parse-jd', { text: jdText });
      applyParsed(data.parsed);
      setJdText('');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setParseError('Only PDF files are supported.');
      return;
    }
    setJdFile(file);
    setIsParsing(true);
    setParseError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use raw fetch for multipart — the API client only does JSON
      const baseUrl = import.meta.env?.VITE_API_URL ?? 'http://localhost:8787';
      const clerkWindow = window as { Clerk?: { session?: { getToken: () => Promise<string> } } };
      const token = await clerkWindow.Clerk?.session?.getToken();

      const response = await fetch(`${baseUrl}/api/v1/role-contexts/parse-jd`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Upload failed (${response.status})`);
      }

      const data = (await response.json()) as ParseJDResponse;
      applyParsed(data.parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    const baseline: RoleContextBaseline = {
      title: title.trim(),
      level,
    };
    if (stack.length > 0) baseline.stack = stack;
    if (department.trim()) baseline.department = department.trim();
    if (workModel) baseline.workModel = workModel;
    if (location.trim()) baseline.location = location.trim();
    if (teamSize.trim()) baseline.teamSize = teamSize.trim();
    if (reportsTo.trim()) baseline.reportsTo = reportsTo.trim();
    onSubmit(baseline, budget);
  };

  return (
    <div>
      {/* Header — matches ListingPage / OverviewPage */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 8,
          }}>
            ROLE_DISCOVERY
          </div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 800,
            color: 'var(--pipe-text, #fff)',
            letterSpacing: '-0.02em',
            margin: 0,
          }}>
            New Role
          </h1>
        </div>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: '14px 28px',
            background: canSubmit
              ? 'rgba(74, 222, 128, 0.08)'
              : 'rgba(255,255,255,0.03)',
            border: canSubmit
              ? '1px solid rgba(74, 222, 128, 0.3)'
              : '1px solid rgba(255,255,255,0.06)',
            color: canSubmit ? 'rgba(74, 222, 128, 0.9)' : 'rgba(255,255,255,0.2)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.15em',
            fontFamily: '"Space Mono", monospace',
            cursor: canSubmit ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {isLoading ? (
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Sparkles size={14} />
          )}
          START_INTERVIEW
        </button>
      </div>

      {/* JD Import zone */}
      {!didImport && (
        <div style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 12,
          }}>
            IMPORT_JOB_DESCRIPTION
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <TextareaInput
                value={jdText}
                onChange={setJdText}
                placeholder="Paste a job description here and we'll extract the details..."
                rows={3}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              <button
                onClick={handleParseText}
                disabled={jdText.trim().length < 20 || isParsing}
                style={{
                  padding: '10px 20px',
                  background: jdText.trim().length >= 20 && !isParsing
                    ? 'rgba(74, 222, 128, 0.08)'
                    : 'transparent',
                  border: jdText.trim().length >= 20 && !isParsing
                    ? '1px solid rgba(74, 222, 128, 0.3)'
                    : '1px solid rgba(255,255,255,0.06)',
                  color: jdText.trim().length >= 20 && !isParsing
                    ? 'rgba(74, 222, 128, 0.9)'
                    : 'rgba(255,255,255,0.2)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: jdText.trim().length >= 20 && !isParsing ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isParsing ? (
                  <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Sparkles size={12} />
                )}
                PARSE
              </button>
              <div
                onClick={() => !isParsing && fileInputRef.current?.click()}
                style={{
                  padding: '10px 20px',
                  border: '1px dashed rgba(255,255,255,0.08)',
                  cursor: isParsing ? 'default' : 'pointer',
                  fontSize: 10,
                  fontFamily: '"Space Mono", monospace',
                  color: 'rgba(255,255,255,0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {jdFile ? (
                  <>
                    <FileText size={12} />
                    {jdFile.name.slice(0, 18)}
                  </>
                ) : (
                  <>
                    <Upload size={12} />
                    UPLOAD_PDF
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>
          </div>
          {parseError && (
            <div style={{
              marginTop: 10,
              fontSize: 10,
              color: 'rgba(248, 113, 113, 0.85)',
              fontFamily: '"Space Mono", monospace',
            }}>
              {parseError}
            </div>
          )}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', marginTop: 24 }} />
        </div>
      )}

      {/* Import success */}
      {didImport && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 20,
        }}>
          <Check size={12} style={{ color: 'rgba(74, 222, 128, 0.7)' }} />
          <span style={{
            fontSize: 10,
            letterSpacing: '0.1em',
            color: 'rgba(74, 222, 128, 0.5)',
            fontFamily: '"Space Mono", monospace',
          }}>
            IMPORTED_FROM_JD
          </span>
        </div>
      )}

      {/* Role fields — flat grid, no card wrappers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginBottom: 28 }}>
        <div style={{ gridColumn: '1 / 3' }}>
          <FieldGroup label="Role Title" required>
            <TextInput value={title} onChange={setTitle} placeholder="Senior Backend Engineer" />
          </FieldGroup>
        </div>
        <FieldGroup label="Level">
          <SelectInput value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
        </FieldGroup>
        <FieldGroup label="Department">
          <TextInput value={department} onChange={setDepartment} placeholder="Engineering" />
        </FieldGroup>
        <FieldGroup label="Work Model">
          <SelectInput value={workModel} onChange={setWorkModel} options={WORK_MODEL_OPTIONS} placeholder="Select..." />
        </FieldGroup>
        <FieldGroup label="Location">
          <TextInput value={location} onChange={setLocation} placeholder="San Francisco, CA / Remote" />
        </FieldGroup>
        <FieldGroup label="Team Size">
          <TextInput value={teamSize} onChange={setTeamSize} placeholder="4 engineers" />
        </FieldGroup>
        <FieldGroup label="Reports To">
          <TextInput value={reportsTo} onChange={setReportsTo} placeholder="Engineering Manager" />
        </FieldGroup>
      </div>

      {/* Tech Stack + Interview Depth — flat, side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <FieldGroup label="Tech Stack" hint="Press Enter to add each technology">
          <TagsInput value={stack} onChange={setStack} placeholder="TypeScript, React, Kafka..." />
        </FieldGroup>

        <div>
          <div style={{
            fontSize: 8,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            marginBottom: 10,
            textTransform: 'uppercase',
          }}>
            INTERVIEW_DEPTH
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {BUDGET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setBudget(opt.value)}
                style={{
                  padding: '10px 8px',
                  background: budget === opt.value
                    ? 'rgba(255,255,255,0.06)'
                    : 'transparent',
                  border: budget === opt.value
                    ? '1px solid rgba(255,255,255,0.15)'
                    : '1px solid rgba(255,255,255,0.04)',
                  color: budget === opt.value
                    ? 'var(--pipe-text, #fff)'
                    : 'rgba(255,255,255,0.3)',
                  fontSize: 10,
                  fontFamily: '"Space Mono", monospace',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  letterSpacing: '0.05em',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Interview Phase ──────────��─────────────────────────────────────────────

function InterviewPhase({
  acknowledgment,
  question,
  progress,
  pastExchanges,
  isLoading,
  onRespond,
  onComplete,
}: {
  acknowledgment: string | null;
  question: RoleContextQuestion | null;
  progress: RoleContextProgress | null;
  pastExchanges: PastExchange[];
  isLoading: boolean;
  onRespond: (answer: string, questionId: string) => void;
  onComplete: () => void;
}): JSX.Element {
  const [answer, setAnswer] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll on new question
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [question?.id, pastExchanges.length]);

  // Reset answer when question changes
  useEffect(() => {
    setAnswer('');
  }, [question?.id]);

  const handleSubmit = (): void => {
    if (!question || !answer.trim() || isLoading) return;
    const finalAnswer = question.input.type === 'tags'
      ? answer.split('|||').join(', ')
      : answer.trim();
    onRespond(finalAnswer, question.id);
  };

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      setRecordDuration(0);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

        if (chunksRef.current.length === 0) return;

        setIsTranscribing(true);
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const formData = new FormData();
        formData.append('audio', blob, 'voice.webm');

        try {
          const baseUrl = import.meta.env?.VITE_API_URL ?? 'http://localhost:8787';
          const clerkWindow = window as { Clerk?: { session?: { getToken: () => Promise<string> } } };
          const token = await clerkWindow.Clerk?.session?.getToken();

          const res = await fetch(`${baseUrl}/api/v1/role-contexts/transcribe`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });

          if (res.ok) {
            const data = (await res.json()) as { transcript: string };
            if (data.transcript) {
              setAnswer((prev) => prev ? `${prev} ${data.transcript}` : data.transcript);
            }
          }
        } catch (err) {
          console.error('[InterviewPhase] Transcription failed:', err);
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(250);
      timerRef.current = setInterval(() => setRecordDuration((d) => d + 1), 1000);
      setIsRecording(true);
    } catch {
      console.error('[InterviewPhase] Mic access denied');
    }
  }, []);

  const stopRecording = useCallback((): void => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const asked = progress?.asked ?? 0;
  const budget = progress?.budget ?? 10;
  const remaining = budget - asked;

  return (
    <div>
      {/* Header bar — matches page style */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32 }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: '0.2em',
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 8,
          }}>
            QUESTION_{asked + 1}_OF_{budget}
          </div>
          <div style={{
            height: 2,
            width: 200,
            background: 'rgba(255,255,255,0.04)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${(asked / budget) * 100}%`,
              background: 'rgba(74, 222, 128, 0.5)',
              transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {progress?.domains && <DomainBars domains={progress.domains} />}
          {remaining <= 2 && remaining > 0 && (
            <button
              onClick={onComplete}
              disabled={isLoading}
              style={{
                padding: '8px 16px',
                fontSize: 10,
                letterSpacing: '0.15em',
                color: 'rgba(251, 191, 36, 0.7)',
                background: 'rgba(251, 191, 36, 0.06)',
                border: '1px solid rgba(251, 191, 36, 0.2)',
                cursor: 'pointer',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              FINISH_EARLY
            </button>
          )}
        </div>
      </div>

      {/* Past exchanges (collapsed) */}
      {pastExchanges.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {pastExchanges.map((ex, i) => (
            <PastExchangeCard key={ex.questionId} exchange={ex} index={i} />
          ))}
        </div>
      )}

      {/* Current turn */}
      {isLoading && !question ? (
        <TypingIndicator />
      ) : question ? (
        <div ref={scrollRef}>
          {/* Agent message — flat, no card */}
          {acknowledgment && (
            <div style={{
              fontSize: 12,
              color: 'rgba(255,255,255,0.45)',
              lineHeight: 1.7,
              marginBottom: 12,
              fontFamily: '"Space Mono", monospace',
            }}>
              {acknowledgment}
            </div>
          )}
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--pipe-text, #fff)',
            lineHeight: 1.4,
            marginBottom: 24,
            letterSpacing: '-0.01em',
          }}>
            {question.text}
          </div>

          {/* Input + controls */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
            <div style={{ flex: 1 }}>
              <QuestionInput
                question={question}
                value={answer}
                onChange={setAnswer}
                onSubmit={handleSubmit}
                disabled={isLoading}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
              {/* Send */}
              <button
                onClick={handleSubmit}
                disabled={!answer.trim() || isLoading}
                style={{
                  padding: '10px 20px',
                  background: answer.trim() && !isLoading
                    ? 'rgba(74, 222, 128, 0.08)'
                    : 'transparent',
                  border: answer.trim() && !isLoading
                    ? '1px solid rgba(74, 222, 128, 0.3)'
                    : '1px solid rgba(255,255,255,0.06)',
                  color: answer.trim() && !isLoading
                    ? 'rgba(74, 222, 128, 0.9)'
                    : 'rgba(255,255,255,0.15)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  fontFamily: '"Space Mono", monospace',
                  cursor: answer.trim() && !isLoading ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isLoading ? (
                  <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <ArrowRight size={12} />
                )}
                SEND
              </button>

              {/* Voice input — only for text/textarea */}
              {(question.input.type === 'text' || question.input.type === 'textarea') && (
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isTranscribing}
                  style={{
                    padding: '10px 20px',
                    background: isRecording
                      ? 'rgba(248, 113, 113, 0.1)'
                      : isTranscribing
                        ? 'rgba(255,255,255,0.02)'
                        : 'transparent',
                    border: isRecording
                      ? '1px solid rgba(248, 113, 113, 0.3)'
                      : '1px solid rgba(255,255,255,0.06)',
                    color: isRecording
                      ? 'rgba(248, 113, 113, 0.9)'
                      : isTranscribing
                        ? 'rgba(255,255,255,0.3)'
                        : 'rgba(255,255,255,0.25)',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    fontFamily: '"Space Mono", monospace',
                    cursor: isTranscribing ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      ...
                    </>
                  ) : isRecording ? (
                    <>
                      <Square size={10} fill="currentColor" />
                      {recordDuration}s
                    </>
                  ) : (
                    <>
                      <Mic size={12} />
                      VOICE
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Synthesis Phase ────────────────────────────────────────────────────────

function SynthesisPhase({
  synthesis,
  progress,
  onCreatePipeline,
  isCreating,
}: {
  synthesis: string;
  progress: RoleContextProgress | null;
  onCreatePipeline: () => void;
  isCreating: boolean;
}): JSX.Element {
  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 32,
      }}>
        <div style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(74, 222, 128, 0.1)',
          border: '1px solid rgba(74, 222, 128, 0.3)',
        }}>
          <Check size={16} style={{ color: 'rgba(74, 222, 128, 0.8)' }} />
        </div>
        <div>
          <div style={{
            fontSize: 8,
            letterSpacing: '0.25em',
            color: 'rgba(74, 222, 128, 0.6)',
            fontFamily: '"Space Mono", monospace',
            marginBottom: 4,
          }}>
            INTERVIEW COMPLETE
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--pipe-text, #fff)',
          }}>
            Role Profile
          </div>
        </div>
      </div>

      {/* Domain coverage final state */}
      {progress?.domains && (
        <div style={{ marginBottom: 28 }}>
          <DomainBars domains={progress.domains} />
        </div>
      )}

      {/* Synthesis narrative */}
      <LiquidMetalCard variant="mercury" style={{ padding: 28, marginBottom: 32 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 16,
        }}>
          <MessageSquare size={14} style={{ color: 'rgba(139, 92, 246, 0.6)' }} />
          <span style={{
            fontSize: 8,
            letterSpacing: '0.2em',
            color: 'rgba(139, 92, 246, 0.5)',
            fontFamily: '"Space Mono", monospace',
          }}>
            SYNTHESIS
          </span>
        </div>
        <div style={{
          fontSize: 13,
          color: 'rgba(255,255,255,0.75)',
          lineHeight: 1.8,
          fontFamily: '"Space Mono", monospace',
        }}>
          {synthesis}
        </div>
      </LiquidMetalCard>

      {/* Create pipeline CTA */}
      <button
        onClick={onCreatePipeline}
        disabled={isCreating}
        style={{
          width: '100%',
          padding: '16px 32px',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(59, 130, 246, 0.2))',
          border: '1px solid rgba(139, 92, 246, 0.4)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.15em',
          fontFamily: '"Space Mono", monospace',
          cursor: isCreating ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        {isCreating ? (
          <>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            CREATING PIPELINE...
          </>
        ) : (
          <>
            <ArrowRight size={14} />
            CREATE PIPELINE FROM PROFILE
          </>
        )}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────��─────────────────────────

export default function RoleDiscoveryPage(): JSX.Element {
  const navigate = useNavigate();
  const api = useApiClient();
  const rd = useRoleDiscovery();
  const { create: createPipeline, isCreating } = usePipelineCreate();

  const handleBaselineSubmit = async (baseline: RoleContextBaseline, budget: number): Promise<void> => {
    try {
      await rd.createAndStart(baseline, budget);
    } catch {
      // Error is surfaced via rd.error
    }
  };

  const handleRespond = (answer: string, questionId: string): void => {
    rd.respond(answer, questionId).catch(() => {
      // Error surfaced via rd.error
    });
  };

  const handleCreatePipeline = async (): Promise<void> => {
    try {
      // Use baseline data from the discovery session
      const baseline = rd.baseline;
      const pipelineId = await createPipeline({
        title: baseline?.title ?? 'New Role',
        level: (baseline?.level as 'Senior') ?? 'Senior',
        status: 'DRAFT',
        creationMode: 'BLANK',
      });

      // Link the role context to this pipeline
      if (rd.contextId) {
        try {
          await api.patch(`/api/v1/role-contexts/${rd.contextId}`, { pipelineId });
        } catch (err) {
          console.error('[RoleDiscoveryPage] Failed to link role context:', err);
        }
      }

      navigate(`/pipeline/${pipelineId}`);
    } catch {
      // Error surfaced via pipeline create hook
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: 40 }}>
      {/* Error banner */}
      {rd.error && (
        <div style={{
          marginBottom: 0,
          padding: '12px 20px',
          background: 'rgba(252, 165, 165, 0.08)',
          border: '1px solid rgba(252, 165, 165, 0.2)',
          fontSize: 11,
          color: 'rgba(252, 165, 165, 0.85)',
          fontFamily: '"Space Mono", monospace',
        }}>
          {rd.error}
        </div>
      )}

      {/* Phase rendering */}
      {(rd.phase === 'IDLE' || rd.phase === 'BASELINE') && (
        <BaselinePhase
          onSubmit={handleBaselineSubmit}
          isLoading={rd.isLoading}
        />
      )}

      {rd.phase === 'INTERVIEWING' && (
        <InterviewPhase
          acknowledgment={rd.acknowledgment}
          question={rd.currentQuestion}
          progress={rd.progress}
          pastExchanges={rd.pastExchanges}
          isLoading={rd.isLoading}
          onRespond={handleRespond}
          onComplete={() => { rd.completeEarly().catch(() => {}); }}
        />
      )}

      {rd.phase === 'COMPLETE' && rd.synthesis && (
        <SynthesisPhase
          synthesis={rd.synthesis}
          progress={rd.progress}
          onCreatePipeline={handleCreatePipeline}
          isCreating={isCreating}
        />
      )}
    </div>
  );
}
