import { useState } from "react";
import { ConversationalForm } from "../components/RoleDiscovery/Conversational/ConversationalForm";
import { PhaseProgress } from "../components/RoleDiscovery/Conversational/PhaseProgress";
import { LiquidMetalCard } from "../components/ui/LiquidMetalCard";
import { TabNav } from "../components/ui/TabNav";
import { FieldGroup, RadioGroup } from "../components/ui/form";
import { Layout } from "lucide-react";
import { Settings } from "lucide-react";
import type { RoleDiscoveryData } from "../types/roleDiscovery";

/**
 * RoleDiscoveryPage - Conversational Role Discovery Flow
 *
 * A multi-phase, guided onboarding experience for gathering role context.
 * Implements a single semantic form with sliding transitions between phases.
 */
export default function RoleDiscoveryPage(): JSX.Element {
  const [data, setData] = useState<Partial<RoleDiscoveryData & { allowFollowUps: boolean }>>({
    allowFollowUps: true, // Default to enabled
    stack: [],
  });
  const [currentPhase, setCurrentPhase] = useState(0); // 0-indexed internally
  const [activeTab, setActiveTab] = useState("summary");

  // Update a single field
  const handleChange = (
    field: string,
    value: any,
  ): void => {
    setData((prev) => ({ ...prev, [field]: value }));
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
    "Final Review"
  ];

  const sidebarTabs = [
    { id: "summary", label: "SUMMARY", icon: <Layout size={14} /> },
    { id: "settings", label: "SETTINGS", icon: <Settings size={14} /> }
  ];

  return (
    <div style={{ padding: "0 20px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header / Progress Indicator */}
      <PhaseProgress current={currentPhase + 1} phases={phases} />

      <div style={{ display: "flex", gap: 24, marginTop: 32 }}>
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
              minHeight: '640px'
            }}
          >
            <ConversationalForm
              data={data}
              onChange={handleChange}
              onComplete={handleComplete}
              currentPhase={currentPhase}
              onPhaseChange={setCurrentPhase}
            />
          </LiquidMetalCard>
        </section>

        {/* Right Sidebar - Dynamic Context / Settings */}
        <aside style={{ width: 400 }}>
           <div 
             style={{ 
               padding: 32,
               height: 'fit-content',
               minHeight: '500px',
               background: 'rgba(255, 255, 255, 0.03)',
               backdropFilter: 'blur(40px) saturate(150%)',
               border: '1px solid rgba(255, 255, 255, 0.1)',
               borderRadius: 16,
               boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
               position: 'relative',
               overflow: 'hidden'
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

             <TabNav 
               tabs={sidebarTabs} 
               activeTab={activeTab} 
               onTabChange={setActiveTab} 
             />

             {activeTab === "summary" && (
               <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  <div style={{ 
                    fontSize: 22, 
                    fontWeight: 800,
                    color: data.title ? '#fff' : 'rgba(255,255,255,0.15)',
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '-0.02em',
                    textTransform: 'uppercase',
                    lineHeight: 1.2
                  }}>
                    {data.title || 'ROLE_TITLE...'}
                  </div>
                  
                  <div style={{ 
                    height: '1px', 
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
                  }} />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em' }}>LEVEL</span>
                      <span style={{ fontSize: 11, color: data.level ? '#fff' : 'rgba(255,255,255,0.1)', fontWeight: 700 }}>{data.level || 'NOT_SET'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em' }}>DEPT</span>
                      <span style={{ fontSize: 11, color: data.department ? '#fff' : 'rgba(255,255,255,0.1)', fontWeight: 700 }}>{data.department?.toUpperCase() || 'NOT_SET'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em' }}>LOC</span>
                      <span style={{ fontSize: 11, color: data.location ? '#fff' : 'rgba(255,255,255,0.1)', fontWeight: 700 }}>{data.location?.toUpperCase() || 'NOT_SET'}</span>
                    </div>
                  </div>
                  
                  {data.stack && data.stack.length > 0 && (
                    <>
                      <div style={{ 
                        height: '1px', 
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
                      }} />
                      <div>
                        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', display: 'block', marginBottom: 12 }}>TECH_STACK</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {data.stack.map(s => (
                            <div key={s} style={{ 
                              fontSize: 9, 
                              padding: '6px 10px', 
                              background: 'rgba(139, 92, 246, 0.08)', 
                              border: '1px solid rgba(139, 92, 246, 0.2)',
                              borderRadius: 4,
                              color: '#a78bfa',
                              fontWeight: 700
                            }}>
                              {s.toUpperCase()}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
               </div>
             )}

             {activeTab === "settings" && (
               <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                 <div style={{ 
                    fontSize: 14, 
                    fontWeight: 700,
                    color: '#fff',
                    fontFamily: '"Space Mono", monospace',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase'
                  }}>
                    AGENT_CONFIGURATION
                 </div>
                 
                 <div style={{ 
                    height: '1px', 
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
                  }} />

                  <FieldGroup 
                    label="AI FOLLOW-UP QUESTIONS" 
                    hint="Should the AI agent ask clarifying questions to deepen the role discovery?"
                  >
                    <RadioGroup
                      value={data.allowFollowUps ? 'Enabled' : 'Disabled'}
                      onChange={(val) => handleChange('allowFollowUps', val === 'Enabled')}
                      options={['Enabled', 'Disabled']}
                    />
                  </FieldGroup>
               </div>
             )}
           </div>
        </aside>
      </div>
    </div>
  );
}
