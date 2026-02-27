import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  MapPin,
  Mail,
  Briefcase,
  CheckCircle,
  Phone,
  Zap,
  Code,
  Mic,
  Users,
  FileText,
} from "lucide-react";
import {
  LiquidMetalCard,
  MetalScoreRing,
  SubTitle,
} from "../components";
import { Skeleton } from "../components/ui/Skeleton";
import { generateClient } from 'aws-amplify/data';
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

const ProfileSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
    {/* Stages Skeleton */}
    <div style={{ display: "flex", gap: 12 }}>
      {[1, 2, 3].map(i => (
        <LiquidMetalCard key={i} style={{ flex: 1, minWidth: 280, height: 140, padding: 24 }}>
          <Skeleton width={20} height={20} style={{ marginBottom: 16 }} />
          <Skeleton width={80} height={8} style={{ marginBottom: 16 }} />
          <Skeleton width={60} height={28} />
        </LiquidMetalCard>
      ))}
    </div>

    {/* Hero Grid Skeleton */}
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 200px", gap: 24 }}>
      <LiquidMetalCard variant="chrome" style={{ height: 480, padding: 0 }}>
        <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Skeleton width={120} height={120} />
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton width="80%" height={12} />
          <Skeleton width="60%" height={12} />
          <Skeleton width="70%" height={12} />
        </div>
      </LiquidMetalCard>

      <LiquidMetalCard variant="mercury" style={{ padding: 48 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 40 }}>
          <div style={{ flex: 1 }}>
            <Skeleton width={100} height={12} style={{ marginBottom: 20 }} />
            <Skeleton width="80%" height={60} />
          </div>
          <Skeleton width={120} height={120} circle />
        </div>
        <Skeleton width="100%" height={100} />
      </LiquidMetalCard>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[1, 2, 3].map(i => (
          <LiquidMetalCard key={i} style={{ flex: 1, padding: 20 }}>
            <Skeleton width="40%" height={8} style={{ marginBottom: 12 }} />
            <Skeleton width="60%" height={32} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={4} />
          </LiquidMetalCard>
        ))}
      </div>
    </div>
  </div>
);

/**
 * CandidateProfilePage - Detailed candidate profile
 *
 * Shows candidate avatar, AI verdict, assessment scores, and pipeline status
 * Matches the profile-example.tsx design
 */

// Map stage names to icons
const stageIcons: Record<string, typeof Phone> = {
  "Code Review": Code,
  "Voice Interview": Mic,
  "System Design": FileText,
  Screening: Phone,
  "AI Collaboration": Zap,
  "Panel Interview": Users,
};

export default function CandidateProfilePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [candidate, setCandidate] = useState<Schema['Candidate']['type'] | null>(null);
  const [assessments, setAssessments] = useState<Schema['Assessment']['type'][]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      setError(null);
      const { data: cand } = await client.models.Candidate.get({ id });
      if (!cand) return;
      setCandidate(cand);

      const [assData, stagesData] = await Promise.all([
        client.models.Assessment.list({ 
          filter: { candidateId: { eq: id } },
          selectionSet: ['id', 'challengeId', 'score', 'submission', 'completedAt']
        }),
        client.models.Stage.list({ 
          filter: { pipelineId: { eq: cand.pipelineId } },
          selectionSet: ['id', 'order', 'type', 'challenges.id', 'challenges.title', 'challenges.type', 'challenges.order']
        }),
      ]);

      setAssessments(assData.data as any);
      const sortedStages = stagesData.data.sort((a, b) => (a.order || 0) - (b.order || 0));
      setStages(sortedStages);
      
      if (sortedStages.length > 0) {
        setSelectedStageId(sortedStages[0].id);
      }
    } catch (err) {
      console.error("[CandidateProfilePage] Error fetching data:", err);
      setError(err instanceof Error ? err : new Error("Failed to load candidate profile"));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return <ProfileSkeleton />;
  }

  if (error) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 400, padding: 40, textAlign: 'center' }}>
          <div style={{ color: '#f87171', marginBottom: 16, fontSize: 12, fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            ERROR_LOADING_PROFILE
          </div>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            {error.message}
          </p>
          <button
            onClick={() => fetchData()}
            style={{
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer'
            }}
          >
            RETRY_CONNECTION
          </button>
        </LiquidMetalCard>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          color: 'rgba(255,255,255,0.4)',
          fontFamily: 'Space Mono'
        }}
      >
        CANDIDATE_NOT_FOUND
      </div>
    );
  }

  const avgScore = assessments.length > 0
    ? Math.round(assessments.reduce((sum, a) => sum + (a.score || 0), 0) / assessments.length)
    : 0;

  const signal = avgScore >= 85 ? "STRONG" : avgScore >= 70 ? "YES" : avgScore >= 50 ? "MAYBE" : "NO";

  const aiProfile = {
    verdict: signal === "STRONG" ? "STRONG\nYES" : signal === "YES" ? "YES" : signal === "MAYBE" ? "MAYBE" : "NO_GO",
    reasoning: signal === "STRONG" 
      ? "Exceeds requirements in technical depth and problem solving. Highly recommended."
      : signal === "YES"
      ? "Solid performance. Meets technical requirements for the role."
      : signal === "MAYBE"
      ? "Showing potential but inconsistent. Further investigation recommended."
      : "Technical performance below threshold for this role.",
    roleFitScore: avgScore / 100,
    cultureFitScore: Math.min((avgScore + 5) / 100, 0.95),
    growthPotentialScore: Math.min((avgScore + 10) / 100, 0.98),
  };

  const initials = (candidate.name || "")
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      {/* <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {stages.map((s) => (
          <div key={s.id} style={{ flex: 1, minWidth: 280 }}>
            <StageHeaderCard
              stage={s}
              candidates={candidatesByStage[s.id] || []}
              isActive={stage === s.id}
              onClick={() => navigate(`/pipeline/${id}/${s.id}`)}
            />
          </div>
        ))}
      </div> */}

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        {stages.map((stage) => {
          const Icon = stage.type ? (stageIcons[stage.type] || FileText) : FileText;
          
          // Calculate stage score as average of challenge assessments
          const challengeIds = (stage.challenges || []).map((c: any) => c.id);
          const stageAssessments = assessments.filter(a => challengeIds.includes(a.challengeId));
          const isComplete = stageAssessments.length > 0 && stageAssessments.length === challengeIds.length;
          
          const stageScore = stageAssessments.length > 0
            ? Math.round(stageAssessments.reduce((sum, a) => sum + (a.score || 0), 0) / stageAssessments.length)
            : null;

          const isActive = selectedStageId === stage.id;

          return (
            <div key={stage.id} style={{ flex: 1, minWidth: 280 }}>
              <LiquidMetalCard
                key={stage.id}
                variant={isActive ? "chrome" : "default"}
                hover
                onClick={() => setSelectedStageId(stage.id)}
                style={{
                  padding: 24,
                  cursor: 'pointer',
                  opacity: !isComplete && !isActive ? 0.6 : 1,
                  border: isActive ? '1px solid rgba(255,255,255,0.4)' : undefined
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <Icon
                    size={16}
                    color={isActive ? "#fff" : "rgba(255,255,255,0.4)"}
                  />
                  {isComplete && (
                    <CheckCircle size={12} color="rgba(150,255,150,0.8)" />
                  )}
                </div>

                <div
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.2em",
                    color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
                    marginBottom: 8,
                  }}
                >
                  {stage.type ? stage.type.replace('_', ' ').toUpperCase() : 'STAGE'}
                </div>

                {stageScore !== null ? (
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      background:
                        "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {stageScore}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 800,
                      color: "rgba(255,255,255,0.15)",
                    }}
                  >
                    —
                  </div>
                )}
              </LiquidMetalCard>
            </div>
          );
        })}
      </div>
      {/* Hero Grid: Avatar + AI Verdict + Score Stack */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr 200px",
          gap: 24,
          marginBottom: 60,
        }}
      >
        {/* Avatar Block */}
        <LiquidMetalCard variant="chrome" hover style={{ padding: 0 }}>
          <div
            style={{
              height: 320,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              background: `
                radial-gradient(
                  ellipse at 30% 30%,
                  rgba(255,255,255,0.15) 0%,
                  transparent 50%
                ),
                radial-gradient(
                  ellipse at 70% 70%,
                  rgba(200,210,230,0.1) 0%,
                  transparent 50%
                )
              `,
            }}
          >
            {/* Large liquid metal monogram */}
            <div
              style={{
                fontSize: 120,
                fontWeight: 900,
                background: `
                  linear-gradient(135deg,
                    rgba(255,255,255,1) 0%,
                    rgba(200,200,220,0.7) 20%,
                    rgba(255,255,255,0.95) 40%,
                    rgba(180,190,210,0.6) 60%,
                    rgba(220,220,240,0.9) 80%,
                    rgba(255,255,255,1) 100%
                  )
                `,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                filter: "drop-shadow(0 10px 40px rgba(200,210,230,0.3))",
                letterSpacing: "0.05em",
              }}
            >
              {initials}
            </div>
          </div>

          {/* Contact info */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            {[
              { icon: Briefcase, value: "Candidate" },
              { icon: MapPin, value: "Remote" },
              { icon: Mail, value: candidate.email },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px 24px",
                  borderBottom:
                    i < 2 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  fontSize: 11,
                  letterSpacing: "0.05em",
                  color: "rgba(255,255,255,0.5)",
                }}
              >
                <item.icon size={14} color="rgba(255,255,255,0.25)" />
                {(item.value || "").toUpperCase()}
              </div>
            ))}
          </div>
        </LiquidMetalCard>

        {/* AI Recommendation */}
        <LiquidMetalCard variant="mercury" hover style={{ padding: 48 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              marginBottom: 40,
            }}
          >
            <div>
              <div style={{ marginBottom: 20 }}>
                <SubTitle>AI_VERDICT</SubTitle>
              </div>

              <div
                style={{
                  fontSize: 72,
                  fontWeight: 900,
                  lineHeight: 0.85,
                  letterSpacing: "-0.03em",
                  background: `
                    linear-gradient(135deg,
                      #fff 0%,
                      rgba(200, 210, 230, 0.8) 25%,
                      #fff 50%,
                      rgba(180, 190, 220, 0.7) 75%,
                      rgba(240, 240, 250, 0.9) 100%
                    )
                  `,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  filter: "drop-shadow(0 4px 30px rgba(200, 210, 230, 0.2))",
                  whiteSpace: "pre-line",
                }}
              >
                {aiProfile.verdict}
              </div>
            </div>

            <MetalScoreRing value={avgScore} label="AVG" />
          </div>

          <div
            style={{
              padding: 24,
              background: "rgba(0,0,0,0.2)",
              borderLeft: "2px solid rgba(255,255,255,0.2)",
              fontSize: 13,
              lineHeight: 1.7,
              color: "rgba(255,255,255,0.6)",
              letterSpacing: "0.02em",
            }}
          >
            {aiProfile.reasoning}
          </div>
        </LiquidMetalCard>

        {/* Score Stack */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "ROLE", value: aiProfile.roleFitScore },
            { label: "CULTURE", value: aiProfile.cultureFitScore },
            { label: "GROWTH", value: aiProfile.growthPotentialScore },
          ].map((item, i) => (
            <LiquidMetalCard key={i} hover style={{ flex: 1, padding: 20 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: "0.3em",
                    color: "rgba(255,255,255,0.3)",
                  }}
                >
                  {item.label}
                </span>

                <span
                  style={{
                    fontSize: 36,
                    fontWeight: 800,
                    background:
                      "linear-gradient(180deg, #fff 0%, rgba(200,210,230,0.7) 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {Math.round(item.value * 100)}
                </span>

                {/* Chrome bar */}
                <div
                  style={{
                    height: 3,
                    background: "rgba(255,255,255,0.06)",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: "100%",
                      width: `${item.value * 100}%`,
                      background:
                        "linear-gradient(90deg, rgba(255,255,255,0.4), rgba(255,255,255,0.8), rgba(200,210,230,0.6))",
                      boxShadow: "0 0 15px rgba(255,255,255,0.3)",
                    }}
                  />
                </div>
              </div>
            </LiquidMetalCard>
          ))}
        </div>
      </section>

      {/* Challenge Results for Selected Stage */}
      {selectedStageId && (
        <section style={{ marginBottom: 100 }}>
          <div style={{ marginBottom: 32 }}>
            <SubTitle>
              {stages.find(s => s.id === selectedStageId)?.type?.replace('_', ' ') || 'STAGE'}_RESULTS
            </SubTitle>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {stages.find(s => s.id === selectedStageId)?.challenges?.map((challenge: any) => {
              const assessment = assessments.find(a => a.challengeId === challenge.id);
              const submission = assessment?.submission ? (typeof assessment.submission === 'string' ? JSON.parse(assessment.submission) : assessment.submission) : null;

              return (
                <LiquidMetalCard key={challenge.id} variant="dark" style={{ padding: 32 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                    <div>
                      <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', marginBottom: 8, fontFamily: 'Space Mono' }}>
                        {challenge.type}
                      </div>
                      <h4 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{challenge.title}</h4>
                    </div>
                    {assessment && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{assessment.score}</div>
                        <div style={{ fontSize: 8, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>CHALLENGE SCORE</div>
                      </div>
                    )}
                  </div>

                  {!assessment ? (
                    <div style={{ padding: '24px', border: '1px dashed rgba(255,255,255,0.05)', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
                      NO_SUBMISSION_YET
                    </div>
                  ) : (
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: 24, borderRadius: 4 }}>
                      {challenge.type === 'QUIZ_MCQ' && submission?.answers && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {Object.entries(submission.answers).map(([qId, ans]: [string, any]) => (
                            <div key={qId} style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                              <span style={{ color: 'rgba(255,255,255,0.3)', marginRight: 8 }}>Q_{qId}:</span>
                              Selected Option {ans}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {challenge.type === 'CODE_REVIEW' && submission?.annotations && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          {Object.entries(submission.annotations).map(([snippetId, snipAnnotations]: [string, any]) => (
                            <div key={snippetId}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', marginBottom: 12 }}>SNIPPET: {snippetId}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {snipAnnotations.map((ann: any, idx: number) => (
                                  <div key={idx} style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 4 }}>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>LINE {ann.line}</span>
                                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>{ann.severity}</span>
                                    </div>
                                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{ann.comment}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {challenge.type === 'QUIZ_SHORT_ANSWER' && (
                        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {submission.text}
                        </div>
                      )}
                    </div>
                  )}
                </LiquidMetalCard>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
