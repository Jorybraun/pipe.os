import { useState } from 'react';
import { ChevronDown, ChevronUp, Briefcase, Code, Wrench, Heart, Brain, FolderGit } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';

// ---------------------------------------------------------------------------
// Types (mirrors workers/api/src/lib/cultureAgentPipeline.ts)
// ---------------------------------------------------------------------------

interface CareerTimelineEntry {
  company: string;
  role: string;
  startDate: string;
  endDate: string | null;
  durationMonths: number;
  teamSize: number | null;
  scope: string;
  keyAccomplishments: string[];
  technologies: string[];
}

interface SkillInventoryEntry {
  skill: string;
  proficiency: 'exposure' | 'working' | 'expert';
  evidence: string;
  yearsExperience: number | null;
}

interface ProjectPortfolioEntry {
  name: string;
  description: string;
  technologies: string[];
  outcome: string;
}

interface WorkingStyleProfile {
  collaboration: string;
  autonomy: string;
  communication: string;
  decisionMaking: string;
  feedbackReceptiveness: string;
}

interface MotivationProfile {
  primaryDrivers: string[];
  dealbreakers: string[];
  growthTrajectory: string;
}

interface BehavioralEvidenceEntry {
  dimension: string;
  evidence: string;
  confidence: number;
}

export interface CandidateProfile {
  careerTimeline: CareerTimelineEntry[];
  skillsInventory: SkillInventoryEntry[];
  projectPortfolio: ProjectPortfolioEntry[];
  workingStyle: WorkingStyleProfile;
  motivation: MotivationProfile;
  behavioralEvidence: BehavioralEvidenceEntry[];
}

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 6,
        overflow: 'hidden',
        marginBottom: 12,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px',
          background: 'rgba(255,255,255,0.02)',
          border: 'none',
          color: 'var(--pipe-text, #fff)',
          cursor: 'pointer',
          fontFamily: '"Space Mono", monospace',
          fontSize: 11,
          letterSpacing: '0.05em',
          fontWeight: 700,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {icon}
          <span>{title}</span>
        </div>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div style={{ padding: '16px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function Badge({ text, color = 'rgba(255,255,255,0.1)' }: { text: string; color?: string }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 8px',
        background: color,
        borderRadius: 4,
        fontSize: 9,
        fontFamily: '"Space Mono", monospace',
        letterSpacing: '0.05em',
        color: 'rgba(255,255,255,0.7)',
      }}
    >
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Proficiency color
// ---------------------------------------------------------------------------

function proficiencyColor(p: string): string {
  switch (p) {
    case 'expert': return 'rgba(52, 211, 153, 0.15)';
    case 'working': return 'rgba(96, 165, 250, 0.15)';
    case 'exposure': return 'rgba(255, 255, 255, 0.06)';
    default: return 'rgba(255, 255, 255, 0.06)';
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CandidateProfileReviewProps {
  profile: CandidateProfile | null;
  onConfirm?: () => void;
  onEdit?: () => void;
}

export function CandidateProfileReview({
  profile,
  onConfirm,
  onEdit,
}: CandidateProfileReviewProps): JSX.Element {
  if (!profile) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', textAlign: 'center', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
        No profile data available.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <LiquidMetalCard
        variant="mercury"
        style={{ padding: '32px 28px', marginBottom: 20 }}
      >
        <h2
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--pipe-text, #fff)',
            margin: '0 0 8px',
            letterSpacing: '-0.02em',
          }}
        >
          Your Profile
        </h2>
        <p
          style={{
            fontSize: 12,
            color: 'var(--pipe-text-dim)',
            lineHeight: 1.5,
            margin: 0,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          Generated from your interview responses. Review for accuracy.
        </p>
      </LiquidMetalCard>

      {/* Career Timeline */}
      <Section icon={<Briefcase size={14} color="#60a5fa" />} title="CAREER TIMELINE" defaultOpen>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {profile.careerTimeline.map((entry, i) => (
            <div key={i} style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>
                  {entry.role}
                </span>
                <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                  {entry.startDate} – {entry.endDate ?? 'Present'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                {entry.company} · {entry.durationMonths}mo · {entry.scope}
              </div>
              {entry.keyAccomplishments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {entry.keyAccomplishments.map((a, j) => (
                    <Badge key={j} text={a} />
                  ))}
                </div>
              )}
              {entry.technologies.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {entry.technologies.map((t, j) => (
                    <Badge key={j} text={t} color="rgba(96, 165, 250, 0.1)" />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Skills */}
      <Section icon={<Code size={14} color="#a78bfa" />} title="SKILLS">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {profile.skillsInventory.map((skill, i) => (
            <div
              key={i}
              style={{
                padding: '8px 12px',
                background: proficiencyColor(skill.proficiency),
                borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pipe-text, #fff)' }}>
                {skill.skill}
              </div>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginTop: 2, fontFamily: '"Space Mono", monospace' }}>
                {skill.proficiency.toUpperCase()}
                {skill.yearsExperience != null ? ` · ${skill.yearsExperience}y` : ''}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Projects */}
      <Section icon={<FolderGit size={14} color="#fbbf24" />} title="PROJECTS">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {profile.projectPortfolio.map((proj, i) => (
            <div key={i} style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 4 }}>
                {proj.name}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8, lineHeight: 1.5 }}>
                {proj.description}
              </div>
              <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                Outcome: {proj.outcome}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {proj.technologies.map((t, j) => (
                  <Badge key={j} text={t} color="rgba(251, 191, 36, 0.1)" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Working Style */}
      <Section icon={<Wrench size={14} color="#34d399" />} title="WORKING STYLE">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {Object.entries(profile.workingStyle).map(([key, value]) => (
            <div key={key} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 4, fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em' }}>
                {key.replace(/([A-Z])/g, ' $1').toUpperCase()}
              </div>
              <div style={{ fontSize: 11, color: 'var(--pipe-text, #fff)', lineHeight: 1.4 }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Motivation */}
      <Section icon={<Heart size={14} color="#f87171" />} title="MOTIVATION">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em' }}>
              PRIMARY DRIVERS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {profile.motivation.primaryDrivers.map((d, i) => (
                <Badge key={i} text={d} color="rgba(248, 113, 113, 0.1)" />
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em' }}>
              DEALBREAKERS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {profile.motivation.dealbreakers.map((d, i) => (
                <Badge key={i} text={d} color="rgba(239, 68, 68, 0.1)" />
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--pipe-text-dim)', marginBottom: 6, fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em' }}>
              GROWTH TRAJECTORY
            </div>
            <div style={{ fontSize: 11, color: 'var(--pipe-text, #fff)', lineHeight: 1.4 }}>
              {profile.motivation.growthTrajectory}
            </div>
          </div>
        </div>
      </Section>

      {/* Behavioral Evidence */}
      <Section icon={<Brain size={14} color="#a78bfa" />} title="BEHAVIORAL EVIDENCE">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {profile.behavioralEvidence.map((ev, i) => (
            <div key={i} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Badge text={ev.dimension} color="rgba(167, 139, 250, 0.1)" />
                <span style={{ fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                  {Math.round(ev.confidence * 100)}% CONF
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>
                {ev.evidence}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Actions */}
      {(onConfirm || onEdit) && (
        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'center' }}>
          {onEdit && (
            <button
              onClick={onEdit}
              style={{
                padding: '12px 24px',
                background: 'var(--pipe-surface-hover)',
                border: '1px solid var(--pipe-border)',
                color: 'var(--pipe-text, #fff)',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              REQUEST EDIT
            </button>
          )}
          {onConfirm && (
            <button
              onClick={onConfirm}
              style={{
                padding: '12px 24px',
                background: '#fff',
                border: 'none',
                color: '#000',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              LOOKS GOOD
            </button>
          )}
        </div>
      )}
    </div>
  );
}
