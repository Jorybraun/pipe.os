/**
 * CandidateOverviewTab — the "presentable profile" view.
 *
 * Surfaces the AI-enriched candidate data (narrative, skills, match score)
 * alongside assessment results in a single scrollable overview.
 * This is the default recruiter view — it answers "who is this person?"
 * instead of forcing the recruiter to click through stage tabs.
 */

import type { ProfileStage, CandidateEnrichmentRecord, CandidateProfileRecord, ProfileSection, CultureInterviewSession, UnifiedMatchResult } from '../../lib/api/types';
import { LiquidMetalCard, SubTitle } from '../';
import { CandidateEnrichmentTab } from './CandidateEnrichmentTab';
import { RequirementMatchList } from '../Match/RequirementMatchList';
import { CheckCircle, XCircle, Minus, Briefcase, GraduationCap, Award, TrendingUp, MessageSquare } from 'lucide-react';
import { SecureVideoPlayer } from './SecureVideoPlayer';

// ─── Types ─────────────────────────────────────────────────────────────────

interface CandidateOverviewTabProps {
  candidate: CandidateProfileRecord;
  stages: ProfileStage[];
  ingestion: CandidateEnrichmentRecord | null;
  profileSections: ProfileSection[];
  cultureInterviewSessions: CultureInterviewSession[];
  candidateId: string;
  matchResult?: UnifiedMatchResult | null;
}

// ─── Mini components ───────────────────────────────────────────────────────

function AssessmentSnapshot({ stages }: { stages: ProfileStage[] }): JSX.Element {
  return (
    <LiquidMetalCard variant="default" style={{ padding: 28, borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Award size={14} color="var(--pipe-accent)" />
        <SubTitle>ASSESSMENT_RESULTS</SubTitle>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {stages.map((stage) => {
          const scoredChallenges = stage.challenges.filter((ch) => ch.submission?.score != null);
          const stageScore = scoredChallenges.length > 0
            ? Math.round(scoredChallenges.reduce((sum, ch) => sum + (ch.submission?.score ?? 0), 0) / scoredChallenges.length)
            : null;
          const isComplete = stage.challenges.length > 0 && stage.challenges.every((ch) => ch.submission !== null);
          const hasAnySubmission = stage.challenges.some((ch) => ch.submission !== null);

          return (
            <div key={stage.id}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isComplete ? (
                    <CheckCircle size={12} color="#4ade80" />
                  ) : hasAnySubmission ? (
                    <TrendingUp size={12} color="#fbbf24" />
                  ) : (
                    <Minus size={12} color="var(--pipe-text-dim)" />
                  )}
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--pipe-text, #fff)',
                    fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em',
                  }}>
                    {stage.title?.toUpperCase()}
                  </span>
                </div>
                {stageScore !== null && (
                  <span style={{
                    fontSize: 12, fontWeight: 900, color: 'var(--pipe-text, #fff)',
                    fontFamily: '"Space Mono", monospace',
                  }}>
                    {stageScore}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              <div style={{
                height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden', marginBottom: 10,
              }}>
                <div style={{
                  width: stageScore !== null ? `${stageScore}%` : isComplete ? '100%' : hasAnySubmission ? '50%' : '0%',
                  height: '100%',
                  background: stageScore != null
                    ? (stageScore >= 80 ? '#10b981' : stageScore >= 60 ? '#fbbf24' : '#f87171')
                    : isComplete ? '#4ade80' : 'rgba(255,255,255,0.1)',
                  borderRadius: 2,
                  transition: 'width 0.6s ease',
                }} />
              </div>

              {/* Challenge mini-list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 20 }}>
                {stage.challenges.map((ch) => {
                  const score = ch.submission?.score;
                  const hasSubmission = ch.submission !== null;
                  return (
                    <div key={ch.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 4,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
                          color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace',
                          textTransform: 'uppercase',
                        }}>
                          {ch.type.replace(/_/g, ' ')}
                        </span>
                        <span style={{
                          fontSize: 11, color: 'var(--pipe-text-muted)', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280,
                        }}>
                          {ch.title}
                        </span>
                      </div>
                      {score != null ? (
                        <span style={{
                          fontSize: 11, fontWeight: 900,
                          color: score >= 80 ? '#10b981' : score >= 60 ? '#fbbf24' : '#f87171',
                          fontFamily: '"Space Mono", monospace',
                        }}>
                          {score}
                        </span>
                      ) : hasSubmission ? (
                        <span style={{
                          fontSize: 9, color: '#fbbf24', fontFamily: '"Space Mono", monospace', letterSpacing: '0.06em',
                        }}>
                          PENDING_SCORE
                        </span>
                      ) : (
                        <span style={{
                          fontSize: 9, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', letterSpacing: '0.06em',
                        }}>
                          NOT_STARTED
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </LiquidMetalCard>
  );
}

function BackgroundCard({ candidate }: { candidate: CandidateProfileRecord }): JSX.Element | null {
  if (!candidate.currentRole && !candidate.skills?.length && !candidate.education?.length && candidate.yearsOfExperience == null) {
    return null;
  }

  return (
    <LiquidMetalCard variant="default" style={{ padding: 28, borderRadius: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <Briefcase size={14} color="var(--pipe-accent)" />
        <SubTitle>BACKGROUND</SubTitle>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {candidate.currentRole && (
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 4,
            }}>
              CURRENT_ROLE
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pipe-text, #fff)' }}>
              {candidate.currentRole}
            </div>
            {candidate.yearsOfExperience != null && candidate.yearsOfExperience > 0 && (
              <div style={{
                fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginTop: 4,
              }}>
                {candidate.yearsOfExperience} YEARS EXPERIENCE
              </div>
            )}
          </div>
        )}

        {candidate.skills && candidate.skills.length > 0 && (
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8,
            }}>
              SKILLS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {candidate.skills.map((skill) => (
                <span key={skill} style={{
                  padding: '4px 10px',
                  background: 'rgba(96,165,250,0.08)',
                  border: '1px solid rgba(96,165,250,0.18)',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#60a5fa',
                  fontFamily: '"Space Mono", monospace',
                  letterSpacing: '0.04em',
                }}>
                  {skill.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        )}

        {candidate.education && candidate.education.length > 0 && (
          <div>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
              color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8,
            }}>
              EDUCATION
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {candidate.education.map((edu, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <GraduationCap size={11} color="var(--pipe-text-dim)" />
                  <span style={{ fontSize: 12, color: 'var(--pipe-text-muted)' }}>{edu}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </LiquidMetalCard>
  );
}

function CultureInterviewSnapshot({ sessions, candidateId }: { sessions: CultureInterviewSession[]; candidateId: string }): JSX.Element | null {
  if (sessions.length === 0) return null;

  const session = sessions[0]!; // Show most recent session (length > 0 guaranteed by guard above)
  const turns = Array.isArray(session.transcript.turns) ? session.transcript.turns as Array<Record<string, unknown>> : [];

  return (
    <LiquidMetalCard variant="default" style={{ padding: 28, borderRadius: 16, border: '1px solid rgba(6,182,212,0.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <MessageSquare size={14} color="#06b6d4" />
        <SubTitle>CULTURE_INTERVIEW</SubTitle>
        <span style={{
          padding: '2px 8px', background: session.state === 'complete' ? 'rgba(16,185,129,0.1)' : 'rgba(251,191,36,0.1)',
          border: session.state === 'complete' ? '1px solid rgba(16,185,129,0.25)' : '1px solid rgba(251,191,36,0.25)',
          borderRadius: 4, fontSize: 8, fontWeight: 700,
          color: session.state === 'complete' ? '#10b981' : '#fbbf24',
          fontFamily: '"Space Mono", monospace', letterSpacing: '0.06em',
        }}>
          {session.state.toUpperCase()}
        </span>
      </div>

      {turns.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontStyle: 'italic' }}>
          No transcript recorded yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {turns.map((turn, idx) => {
            const isQuestion = turn.candidateResponse === null;
            const text = isQuestion ? (turn.questionText as string) : (turn.candidateResponse as string);
            const videoR2Key = typeof turn.videoR2Key === 'string' ? turn.videoR2Key : undefined;
            if (!text && !videoR2Key) return null;
            return (
              <div key={idx} style={{
                background: isQuestion ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.03)',
                padding: 14, borderRadius: 8, border: '1px solid var(--pipe-border-light)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                    fontFamily: '"Space Mono", monospace',
                    color: isQuestion ? '#60a5fa' : '#4ade80',
                  }}>
                    {isQuestion ? 'AI' : 'CANDIDATE'}
                  </span>
                </div>
                {text && (
                  <div style={{ fontSize: 13, color: 'var(--pipe-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {text}
                  </div>
                )}
                {videoR2Key && (
                  <div style={{ marginTop: 4 }}>
                    <SecureVideoPlayer candidateId={candidateId} r2Key={videoR2Key} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </LiquidMetalCard>
  );
}

function LegacyMatchSnapshot({ ingestion }: { ingestion: CandidateEnrichmentRecord | null }): JSX.Element | null {
  if (!ingestion || ingestion.status !== 'matched') return null;

  const score = ingestion.triangulatedScore;
  const dims = ingestion.dimensions;

  return (
    <LiquidMetalCard variant="default" style={{ padding: 28, borderRadius: 16, border: '1px solid rgba(16,185,129,0.15)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrendingUp size={14} color="#10b981" />
          <SubTitle>MATCH_ANALYSIS</SubTitle>
        </div>
        {ingestion.matchPhilosophy && (
          <span style={{
            padding: '3px 10px', background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.2)', borderRadius: 4,
            fontSize: 9, fontWeight: 700, color: '#10b981',
            fontFamily: '"Space Mono", monospace', letterSpacing: '0.06em',
          }}>
            {ingestion.matchPhilosophy.toUpperCase()}
          </span>
        )}
      </div>

      {score != null && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{
              fontSize: 28, fontWeight: 900, color: score >= 0.7 ? '#10b981' : score >= 0.4 ? '#fbbf24' : '#f87171',
              fontFamily: '"Space Mono", monospace', lineHeight: 1,
            }}>
              {Math.round(score * 100)}
            </span>
            <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
              / 100 MATCH
            </span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, Math.max(0, score * 100))}%`, height: '100%',
              background: score >= 0.7 ? '#10b981' : score >= 0.4 ? '#fbbf24' : '#f87171',
              borderRadius: 2,
            }} />
          </div>
        </div>
      )}

      {dims && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {([
            { key: 'skillCoverage' as const, label: 'SKILLS' },
            { key: 'semanticSimilarity' as const, label: 'SEMANTIC' },
            { key: 'situationFit' as const, label: 'SITUATION' },
            { key: 'roleAlignment' as const, label: 'ALIGNMENT' },
          ]).map(({ key, label }) => {
            const val = (dims as unknown as Record<string, number | null>)[key];
            if (val == null) return null;
            return (
              <div key={key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
                    color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace',
                  }}>
                    {label}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 900, color: 'var(--pipe-text, #fff)',
                    fontFamily: '"Space Mono", monospace',
                  }}>
                    {Math.round(val * 100)}
                  </span>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, Math.max(0, val * 100))}%`, height: '100%',
                    background: val >= 0.7 ? '#10b981' : val >= 0.4 ? '#fbbf24' : '#f87171',
                    borderRadius: 2,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {ingestion.reasoning?.matches && ingestion.reasoning.matches.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--pipe-border)' }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8,
          }}>
            STRENGTHS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ingestion.reasoning.matches.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <CheckCircle size={10} color="#10b981" style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--pipe-text-muted)', lineHeight: 1.5 }}>{m}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ingestion.reasoning?.mismatches && ingestion.reasoning.mismatches.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 8,
          }}>
            GAPS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ingestion.reasoning.mismatches.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <XCircle size={10} color="#f87171" style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--pipe-text-muted)', lineHeight: 1.5 }}>{m}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </LiquidMetalCard>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function CandidateOverviewTab({
  candidate,
  stages,
  ingestion,
  profileSections,
  cultureInterviewSessions,
  candidateId,
  matchResult,
}: CandidateOverviewTabProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* AI-enriched profile sections (hero, narrative, skills, etc.) */}
      {profileSections.length > 0 && (
        <CandidateEnrichmentTab sections={profileSections} />
      )}

      {/* Fallback background card if no enrichment sections */}
      {profileSections.length === 0 && <BackgroundCard candidate={candidate} />}

      {/* Culture interview transcript (from sessions — works even without formal submission) */}
      <CultureInterviewSnapshot sessions={cultureInterviewSessions} candidateId={candidateId} />

      {/* Match analysis */}
      {matchResult ? (
        <RequirementMatchList
          overallScore={matchResult.score}
          requirementMatches={matchResult.requirementMatches}
          dealbreakerFailures={matchResult.dealbreakerFailures}
        />
      ) : ingestion?.status === 'matched' ? (
        <LegacyMatchSnapshot ingestion={ingestion} />
      ) : null}

      {/* Assessment summary */}
      <AssessmentSnapshot stages={stages} />
    </div>
  );
}
