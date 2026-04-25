import React, { useState, useRef } from "react";
import {
  X,
  Upload,
  FileText,
  CheckCircle,
  Loader2,
  Shield,
  ChevronRight,
  Briefcase,
  GraduationCap,
  Sparkles,
  Activity
} from "lucide-react";
import { LiquidMetalCard } from "..";
import { FieldGroup, TextInput } from "../ui/form";
import { useCandidateCreate } from "../../hooks/useCandidateCreate";
import { useAuth as useClerkAuth } from "@clerk/react";

interface CandidateIntakeModalProps {
  pipelineId: string;
  stageId?: string;
  onClose: () => void;
  onSuccess: (candidateId: string) => void;
}

export function CandidateIntakeModal({
  pipelineId,
  stageId,
  onClose,
  onSuccess
}: CandidateIntakeModalProps) {
  const [step, setStep] = useState<"BASIC" | "PARSING" | "CONFIRM">("BASIC");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [createdCandidateId, setCreatedCandidateId] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<{
    name?: string;
    skills?: string[];
    yearsOfExperience?: number;
    currentRole?: string;
    education?: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { create, isSubmitting: isCreating } = useCandidateCreate();
  const { getToken } = useClerkAuth();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === "application/pdf" || 
          selectedFile.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        setFile(selectedFile);
        setError(null);
      } else {
        setError("Only .pdf and .docx files are supported.");
      }
    }
  };

  const handleProcess = async () => {
    if (!name || !email) {
      setError("Name and Email are required.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    // If no file, skip parsing step entirely
    if (!file) {
      try {
        const candidateId = await create({
          pipelineId,
          name,
          email,
          ...(stageId ? { currentStageId: stageId } : {}),
        });

        if (!candidateId) throw new Error("Failed to create candidate");
        onSuccess(candidateId);
      } catch (err) {
        console.error("[CandidateIntake] Error:", err);
        setError(err instanceof Error ? err.message : "An error occurred during intake.");
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    // If file is present, show parsing step
    setStep("PARSING");
    let candidateId: string | null = null;

    try {
      // 1. Create Candidate
      candidateId = await create({
        pipelineId,
        name,
        email,
        ...(stageId ? { currentStageId: stageId } : {}),
      });

      if (!candidateId) throw new Error("Failed to create candidate");
      setCreatedCandidateId(candidateId);

      // 2. Upload CV directly to the Worker, which stores it in R2.
      //    The Worker returns the R2 key and persists it on the candidate record.
      const formData = new FormData();
      formData.append("file", file);

      const token = await getToken();
      const baseUrl =
        typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
          ? import.meta.env.VITE_API_URL
          : "http://localhost:8787";

      const uploadResponse = await fetch(
        `${baseUrl}/api/v1/candidates/${candidateId}/resume`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          // Do NOT set Content-Type — browser must set the multipart boundary.
          body: formData,
        }
      );

      if (!uploadResponse.ok) {
        let errMsg = `Upload failed (HTTP ${uploadResponse.status})`;
        try {
          const body = (await uploadResponse.json()) as { error?: { message?: string } };
          if (body.error?.message) errMsg = body.error.message;
        } catch { /* non-JSON body */ }
        throw new Error(errMsg);
      }

      // Worker parses the CV inline and returns structured data
      const uploadResult = (await uploadResponse.json()) as {
        success: boolean;
        r2Key: string;
        parsed?: {
          name?: string;
          skills?: string[];
          yearsOfExperience?: number;
          currentRole?: string;
          education?: string[];
        } | null;
      };

      if (uploadResult.parsed) {
        setParsedData(uploadResult.parsed);
      }

      setStep("CONFIRM");

    } catch (err) {
      // Reaches here if candidate creation or R2 upload failed.
      console.error("[CandidateIntake] Fatal intake error:", err);
      setError(err instanceof Error ? err.message : "An error occurred during intake.");
      setStep("BASIC");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      background: "rgba(0,0,0,0.8)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20
    }}>
      <LiquidMetalCard 
        variant="chrome" 
        style={{ 
          width: "100%", 
          maxWidth: 640, 
          padding: 0,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)"
        }}
      >
        {/* Header */}
        <div style={{
          padding: "24px 32px",
          borderBottom: "1px solid var(--pipe-border-light)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <div style={{ 
              fontSize: 9, 
              letterSpacing: "0.2em", 
              color: "var(--pipe-text-dim)", 
              fontFamily: "Space Mono",
              marginBottom: 4
            }}>
              CANDIDATE_INTAKE_PROTOCOL
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--pipe-text, #fff)", margin: 0 }}>
              {step === "CONFIRM" ? "INTAKE_COMPLETE" : "CREATE_NEW_CANDIDATE"}
            </h2>
          </div>
          <button 
            onClick={onClose}
            style={{ 
              background: "none", 
              border: "none", 
              color: "var(--pipe-text-dim)", 
              cursor: "pointer" 
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 40 }}>
          {step === "BASIC" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {/* Basic Info */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                <FieldGroup label="FULL_NAME">
                  <TextInput 
                    value={name} 
                    onChange={setName} 
                    placeholder="E.g. John Doe"
                  />
                </FieldGroup>
                <FieldGroup label="EMAIL_ADDRESS">
                  <TextInput 
                    value={email} 
                    onChange={setEmail} 
                    placeholder="john@example.com"
                  />
                </FieldGroup>
              </div>

              {/* CV Upload */}
              <div>
                <label style={{ 
                  display: "block", 
                  fontSize: 10, 
                  color: "var(--pipe-text-dim)", 
                  marginBottom: 12,
                  fontFamily: "Space Mono"
                }}>
                  CV_RESUME_UPLOAD (.PDF, .DOCX)
                </label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: "1px dashed rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: 40,
                    textAlign: "center",
                    cursor: "pointer",
                    background: file ? "rgba(255,255,255,0.02)" : "transparent",
                    transition: "all 0.2s ease"
                  }}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange}
                    style={{ display: "none" }}
                    accept=".pdf,.docx"
                  />
                  {file ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      <div style={{ 
                        width: 48, 
                        height: 48, 
                        borderRadius: "50%", 
                        background: "rgba(96, 165, 250, 0.1)", 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "center" 
                      }}>
                        <FileText size={24} color="#60a5fa" />
                      </div>
                      <div style={{ fontSize: 13, color: "var(--pipe-text, #fff)", fontWeight: 700 }}>
                        {file.name}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--pipe-text-dim)", fontFamily: "Space Mono" }}>
                        {(file.size / 1024 / 1024).toFixed(2)} MB • CLICK_TO_REPLACE
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      <Upload size={32} color="var(--pipe-text-dim)" />
                      <div style={{ fontSize: 12, color: "var(--pipe-text-dim)", fontFamily: "Space Mono" }}>
                        DRAG_&_DROP_OR_CLICK_TO_UPLOAD
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div style={{ 
                  padding: 12, 
                  background: "rgba(248, 113, 113, 0.1)", 
                  border: "1px solid rgba(248, 113, 113, 0.2)",
                  color: "#f87171",
                  fontSize: 11,
                  fontFamily: "Space Mono",
                  borderRadius: 4
                }}>
                  ERROR: {error.toUpperCase()}
                </div>
              )}

              <button 
                onClick={handleProcess}
                disabled={isCreating || isProcessing || !name || !email}
                style={{
                  width: "100%",
                  padding: "16px",
                  background: "var(--pipe-text, #fff)",
                  color: "#000",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 800,
                  fontFamily: "Space Mono",
                  cursor: (isCreating || isProcessing || !name || !email) ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  opacity: (isCreating || isProcessing || !name || !email) ? 0.5 : 1
                }}
              >
                {isCreating || isProcessing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    PROCESSING_INTAKE...
                  </>
                ) : (
                  <>
                    INITIATE_INTAKE <ChevronRight size={16} />
                  </>
                )}
              </button>
            </div>
          )}

          {step === "PARSING" && (
            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              alignItems: "center", 
              justifyContent: "center",
              gap: 24,
              minHeight: 300 
            }}>
              <div style={{ position: "relative" }}>
                <Loader2 size={48} color="#60a5fa" className="animate-spin" />
                <Sparkles 
                  size={24} 
                  color="#fbbf24" 
                  style={{ 
                    position: "absolute", 
                    top: -10, 
                    right: -10,
                    animation: "bounce 2s infinite" 
                  }} 
                />
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ 
                  fontSize: 12, 
                  fontWeight: 800, 
                  color: "var(--pipe-text, #fff)", 
                  fontFamily: "Space Mono",
                  marginBottom: 8
                }}>
                  ANALYZING_RESUME_VIA_AI
                </div>
                <div style={{ 
                  fontSize: 10, 
                  color: "var(--pipe-text-dim)", 
                  fontFamily: "Space Mono",
                  maxWidth: 300
                }}>
                  EXTRACTING_SKILLS_EXPERIENCE_AND_EDUCATION_DATA...
                </div>
              </div>
            </div>
          )}

          {step === "CONFIRM" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  borderRadius: "50%", 
                  background: "rgba(52, 211, 153, 0.1)", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center" 
                }}>
                  <CheckCircle size={24} color="#34d399" />
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--pipe-text, #fff)" }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--pipe-text-muted)", fontFamily: "Space Mono" }}>
                    {email}
                  </div>
                </div>
              </div>

              {parsedData && (
                <div style={{ 
                  display: "grid", 
                  gridTemplateColumns: "1fr", 
                  gap: 24,
                  padding: 24,
                  background: "var(--pipe-surface)",
                  borderRadius: 8,
                  border: "1px solid var(--pipe-border-light)"
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 9, color: "var(--pipe-text-dim)", fontFamily: "Space Mono", marginBottom: 8 }}>
                        <Briefcase size={10} style={{ marginRight: 6 }} /> CURRENT_ROLE
                      </div>
                      <div style={{ fontSize: 13, color: "var(--pipe-text, #fff)", fontWeight: 700 }}>
                        {parsedData.currentRole || "Not specified"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "var(--pipe-text-dim)", fontFamily: "Space Mono", marginBottom: 8 }}>
                        <Activity size={10} style={{ marginRight: 6 }} /> EXPERIENCE
                      </div>
                      <div style={{ fontSize: 13, color: "var(--pipe-text, #fff)", fontWeight: 700 }}>
                        {parsedData.yearsOfExperience || 0} Years
                      </div>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 9, color: "var(--pipe-text-dim)", fontFamily: "Space Mono", marginBottom: 12 }}>
                      <Shield size={10} style={{ marginRight: 6 }} /> SKILLS_EXTRACTED
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {parsedData.skills?.map((skill: string) => (
                        <span key={skill} style={{
                          padding: "4px 10px",
                          background: "var(--pipe-surface)",
                          border: "1px solid var(--pipe-border)",
                          borderRadius: 4,
                          fontSize: 10,
                          color: "var(--pipe-text-muted)",
                          fontFamily: "Space Mono"
                        }}>
                          {skill.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 9, color: "var(--pipe-text-dim)", fontFamily: "Space Mono", marginBottom: 8 }}>
                      <GraduationCap size={10} style={{ marginRight: 6 }} /> EDUCATION
                    </div>
                    <div style={{ fontSize: 11, color: "var(--pipe-text-muted)", lineHeight: 1.6 }}>
                      {parsedData.education?.join(", ") || "No education history found."}
                    </div>
                  </div>
                </div>
              )}

              <button 
                onClick={() => onSuccess(createdCandidateId ?? "")}
                style={{
                  width: "100%",
                  padding: "16px",
                  background: "var(--pipe-text, #fff)",
                  color: "#000",
                  border: "none",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 800,
                  fontFamily: "Space Mono",
                  cursor: "pointer"
                }}
              >
                COMPLETE_INTAKE
              </button>
            </div>
          )}
        </div>
      </LiquidMetalCard>
    </div>
  );
}
