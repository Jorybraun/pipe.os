import { useState, useEffect } from "react";
import { ConversationalForm } from "../components/RoleDiscovery/Conversational/ConversationalForm";
import { PhaseProgress } from "../components/RoleDiscovery/Conversational/PhaseProgress";
import { LiquidMetalCard } from "../components/ui/LiquidMetalCard";
import { FieldGroup, RadioGroup, SelectInput } from "../components/ui/form";
import { Settings, Loader2, Zap, Shield, Target } from "lucide-react";
import { useRoleDiscovery } from "../hooks/useRoleDiscovery";
import type { RoleDiscoveryData } from "../types/roleDiscovery";
import type { Baseline } from "../types/discovery";

/**
 * RoleDiscoveryPage - Conversational Role Discovery Flow
 *
 * A multi-phase, guided onboarding experience for gathering role context.
 * Implements a single semantic form with a powerful configuration sidebar.
 */
export default function RoleDiscoveryPage(): JSX.Element {
  const {
    roleContext,
    isLoading,
    error,
    costTracking,
    submitBaseline,
  } = useRoleDiscovery();

  const [currentPhase, setCurrentPhase] = useState(0);

  // Local state for the form inputs and pipeline configuration
  const [formData, setFormData] = useState<Partial<RoleDiscoveryData & { 
    allowFollowUps: boolean,
    includeAlgorithm: boolean,
    includeQuiz: boolean,
    includeCodeReview: boolean,
    questionLimit: string
  }>>({
    allowFollowUps: true,
    includeAlgorithm: true,
    includeQuiz: true,
    includeCodeReview: true,
    questionLimit: '5',
    stack: [],
  });

  const handleChange = (field: string, value: any): void => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handlePhaseChange = async (nextPhase: number) => {
    if (nextPhase === 6 && !roleContext.baseline) {
      const baseline: Baseline = {
        title: formData.title || "",
        level: (formData.level?.toLowerCase() as any) || "mid",
        department: formData.department || "",
        workModel: (formData.location?.toLowerCase() as any) || "hybrid",
        teamSize: formData.teamSize || "",
        reportsTo: formData.reportsTo || "",
        stack: formData.stack || [],
      };

      const config = {
        questionLimit: formData.questionLimit,
        includeAlgorithm: formData.includeAlgorithm,
        includeQuiz: formData.includeQuiz,
        includeCodeReview: formData.includeCodeReview,
        allowFollowUps: formData.allowFollowUps
      };

      await submitBaseline(baseline, config);
    }
    setCurrentPhase(nextPhase);
  };

  const handleComplete = (finalData: any) => {
    console.log("Conversational Form Complete:", finalData);
  };

  const phases = [
    "Role Identity",
    "Team Context",
    "Technical Environment",
    "Success Criteria",
    "Challenges",
    "Culture",
    "Agent Review"
  ];

  return (
    <div style={{ padding: "0 20px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header / Progress Indicator */}
      <PhaseProgress current={currentPhase + 1} phases={phases} />

      <div style={{ display: "flex", gap: 24, marginTop: 32, position: 'relative' }}>
        {/* Main Content Area */}
        <section
          style={{
            flex: 1,
            position: "relative",
            minHeight: "70vh",
          }}
        >
          <LiquidMetalCard 
            variant="default"
            style={{ 
              padding: '48px',
              minHeight: '640px',
              position: 'relative'
            }}
          >
            {/* Loading Overlay */}
            {isLoading && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(10, 10, 15, 0.7)',
                backdropFilter: 'blur(4px)',
                zIndex: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 20
              }}>
                <Loader2 size={40} className="animate-spin" color="#8b5cf6" />
                <div style={{ fontSize: 12, letterSpacing: '0.2em', color: '#fff' }}>AGENT_THINKING...</div>
              </div>
            )}

            <ConversationalForm
              data={formData}
              onChange={handleChange}
              onComplete={handleComplete}
              currentPhase={currentPhase}
              onPhaseChange={handlePhaseChange}
            />

            {/* Error Message */}
            {error && (
              <div style={{ 
                marginTop: 24, 
                padding: 16, 
                background: 'rgba(239, 68, 68, 0.1)', 
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#ef4444',
                fontSize: 12,
                fontFamily: '"Space Mono", monospace'
              }}>
                ERROR: {error.message.toUpperCase()}
              </div>
            )}
          </LiquidMetalCard>
        </section>

        {/* Right Sidebar - Pipeline Configuration */}
        <aside style={{ width: 400 }}>
           <div 
             style={{ 
               padding: 32,
               height: 'fit-content',
               minHeight: '640px',
               background: 'rgba(255, 255, 255, 0.03)',
               backdropFilter: 'blur(40px) saturate(150%)',
               border: '1px solid rgba(255, 255, 255, 0.1)',
               borderRadius: 16,
               boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
               position: 'relative',
               overflow: 'hidden',
               display: 'flex',
               flexDirection: 'column',
               gap: 32
             }}
           >
             {/* Decorative Gradient Glow */}
             <div style={{
               position: 'absolute',
               top: -50,
               right: -50,
               width: 150,
               height: 150,
               background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
               filter: 'blur(30px)',
               pointerEvents: 'none'
             }} />

             <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Settings size={18} color="#8b5cf6" />
                <h3 style={{ 
                  fontSize: 11, 
                  letterSpacing: '0.3em', 
                  color: '#fff', 
                  textTransform: 'uppercase',
                  fontFamily: '"Space Mono", monospace',
                  fontWeight: 700
                }}>
                  PIPELINE_CONFIGURATION
                </h3>
             </div>

             <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                
                {/* Discovery Mode */}
                <FieldGroup 
                  label="AI DISCOVERY AGENT" 
                  hint="Tailored agents generate specific follow-ups based on role nuance."
                >
                  <RadioGroup
                    value={formData.allowFollowUps ? 'Enabled' : 'Disabled'}
                    onChange={(val) => handleChange('allowFollowUps', val === 'Enabled')}
                    options={['Enabled', 'Disabled']}
                  />
                </FieldGroup>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

                {/* Pipeline Stages Config */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                    PIPELINE_STAGES
                  </span>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { id: 'includeAlgorithm', label: 'ALGORITHM_QUESTION', icon: Zap },
                      { id: 'includeQuiz', label: 'TECHNICAL_QUIZ', icon: Shield },
                      { id: 'includeCodeReview', label: 'CODE_REVIEW_CHALLENGE', icon: Target },
                    ].map((stage) => (
                      <div 
                        key={stage.id}
                        onClick={() => handleChange(stage.id, !formData[stage.id as keyof typeof formData])}
                        style={{
                          padding: '16px',
                          background: formData[stage.id as keyof typeof formData] 
                            ? 'rgba(139, 92, 246, 0.1)' 
                            : 'rgba(255,255,255,0.02)',
                          border: `1px solid ${formData[stage.id as keyof typeof formData] 
                            ? 'rgba(139, 92, 246, 0.3)' 
                            : 'rgba(255,255,255,0.05)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <stage.icon size={14} color={formData[stage.id as keyof typeof formData] ? '#a78bfa' : 'rgba(255,255,255,0.2)'} />
                          <span style={{ 
                            fontSize: 10, 
                            color: formData[stage.id as keyof typeof formData] ? '#fff' : 'rgba(255,255,255,0.4)',
                            fontWeight: 600,
                            letterSpacing: '0.05em'
                          }}>
                            {stage.label}
                          </span>
                        </div>
                        <div style={{
                          width: 12,
                          height: 12,
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: formData[stage.id as keyof typeof formData] ? '#8b5cf6' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {formData[stage.id as keyof typeof formData] && (
                            <div style={{ width: 6, height: 6, background: '#fff' }} />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

                {/* Question Config */}
                <FieldGroup label="AI PROBE LIMIT" hint="Max follow-up questions asked by the agent.">
                  <SelectInput
                    value={formData.questionLimit}
                    onChange={(val) => handleChange('questionLimit', val)}
                    options={['3', '5', '10']}
                  />
                </FieldGroup>

                {/* Discovery Insights (Real-time cost) */}
                <div style={{ 
                  marginTop: 'auto',
                  padding: 20, 
                  background: 'rgba(139, 92, 246, 0.03)', 
                  border: '1px solid rgba(139, 92, 246, 0.1)',
                  borderRadius: 8
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em' }}>SESSION_COST</span>
                    <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>${costTracking.sessionCost.toFixed(4)}</span>
                  </div>
                  <div style={{ height: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
                    <div style={{ 
                      height: '100%', 
                      width: `${(costTracking.sessionCost / 0.50) * 100}%`, 
                      background: '#8b5cf6' 
                    }} />
                  </div>
                </div>
             </div>
           </div>
        </aside>
      </div>
      <style>{`
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
