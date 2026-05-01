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
  Activity,
  Copy,
  Mail,
  Link as LinkIcon,
  Send,
  AlertCircle,
} from "lucide-react";
import { LiquidMetalCard } from "..";
import { FieldGroup, TextInput } from "../ui/form";
import { useCandidateCreate } from "../../hooks/useCandidateCreate";
import { useAuth as useClerkAuth } from "@clerk/react";
import { useTheme } from "../../contexts/ThemeContext";

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
  const [githubHandle, setGithubHandle] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [createdCandidateId, setCreatedCandidateId] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
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
  const { theme } = useTheme();
  const isLight = theme.mode === 'light' || theme.mode === 'anatomy';

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://pipe.build';
  const inviteUrl = inviteToken ? `${baseUrl}/assess/${inviteToken}` : '';

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

  const handleGithubBlur = () => {
    setGithubHandle((prev) => prev.replace(/^@/, ""));
  };

  const handleCopyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy link to clipboard.");
    }
  };

  const handleResendEmail = async () => {
    if (!createdCandidateId || resendStatus === 'sending') return;
    setResendStatus('sending');
    try {
      const token = await getToken();
      const apiUrl =
        typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
          ? import.meta.env.VITE_API_URL
          : "http://localhost:8787";

      const response = await fetch(
        `${apiUrl}/api/v1/candidates/${createdCandidateId}/send-invite`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to resend invite (${response.status})`);
      }

      setResendStatus('sent');
      setTimeout(() => setResendStatus('idle'), 3000);
    } catch (err) {
      console.error('[CandidateIntake] Resend failed:', err);
      setResendStatus('error');
      setTimeout(() => setResendStatus('idle'), 3000);
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
        const result = await create({
          pipelineId,
          name,
          email,
          ...(stageId ? { currentStageId: stageId } : {}),
        });

        if (!result) throw new Error("Failed to create candidate");
        setCreatedCandidateId(result.id);
        setInviteToken(result.inviteToken);
        setStep("CONFIRM");
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
      const createResult = await create({
        pipelineId,
        name,
        email,
        ...(stageId ? { currentStageId: stageId } : {}),
      });

      if (!createResult) throw new Error("Failed to create candidate");
      candidateId = createResult.id;
      setCreatedCandidateId(candidateId);
      setInviteToken(createResult.inviteToken);

      // 2. Upload CV directly to the Worker, which stores it in R2.
      //    The Worker returns the R2 key and persists it on the candidate record.
      const formData = new FormData();
      formData.append("file", file);
      if (githubHandle.trim()) {
        formData.append("githubHandle", githubHandle.trim());
      }

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
      background: isLight ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.8)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20
    }}>
      <LiquidMetalCard 
        variant={isLight ? "default" : "chrome"} 
        style={{ 
          width: "100%", 
          maxWidth: 640, 
          padding: 0,
          overflow: "hidden",
          background: isLight ? "var(--pipe-surface-solid, #ffffff)" : undefined,
          boxShadow: isLight ? "0 24px 60px rgba(0,0,0,0.15)" : "0 24px 60px rgba(0,0,0,0.5)"
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
           aria-label="Close">
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

              {/* GitHub Handle */}
              <div>
                <label style={{
                  display: "block",
                  fontSize: 10,
                  color: "var(--pipe-text-dim)",
                  marginBottom: 12,
                  fontFamily: "Space Mono",
                  fontWeight: 600
                }}>
                  GITHUB_HANDLE (OPTIONAL)
                </label>
                <TextInput
                  value={githubHandle}
                  onChange={setGithubHandle}
                  onBlur={handleGithubBlur}
                  placeholder="username (not the full URL)"
                  ariaLabel="GitHub handle"
                />
                <div style={{
                  fontSize: 10,
                  color: "var(--pipe-text-dim)",
                  fontFamily: "Space Mono",
                  marginTop: 8,
                  lineHeight: 1.5
                }}>
                  We&apos;ll use your public GitHub activity to enrich your profile. We only read public data you&apos;ve shared.
                </div>
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
                    border: isLight ? "1px dashed var(--pipe-border)" : "1px dashed rgba(255,255,255,0.1)",
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

              {/* Invite link + actions */}
              <div style={{ 
                padding: 24,
                background: "var(--pipe-surface)",
                borderRadius: 8,
                border: "1px solid var(--pipe-border-light)",
                display: "flex",
                flexDirection: "column",
                gap: 16
              }}>
                <div style={{ fontSize: 9, color: "var(--pipe-text-dim)", fontFamily: "Space Mono", marginBottom: 4 }}>
                  <Mail size={10} style={{ marginRight: 6 }} /> INVITE_STATUS
                </div>
                <div style={{ fontSize: 12, color: "#34d399", fontFamily: "Space Mono" }}>
                  ✓ Invite email sent automatically
                </div>

                <div style={{ 
                  display: "flex", 
                  alignItems: "center", 
                  gap: 12,
                  padding: 12,
                  background: "rgba(0,0,0,0.2)",
                  borderRadius: 4,
                  border: "1px solid var(--pipe-border-light)"
                }}>
                  <LinkIcon size={14} color="var(--pipe-text-dim)" />
                  <div style={{ 
                    flex: 1,
                    fontSize: 11, 
                    color: "var(--pipe-text-muted)", 
                    fontFamily: "Space Mono",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap"
                  }}>
                    {inviteUrl}
                  </div>
                  <button
                    onClick={handleCopyLink}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 12px",
                      background: copied ? "rgba(52, 211, 153, 0.1)" : "var(--pipe-surface-hover)",
                      border: `1px solid ${copied ? "#34d399" : "var(--pipe-border)"}`,
                      borderRadius: 4,
                      color: copied ? "#34d399" : "var(--pipe-text-dim)",
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "Space Mono",
                      cursor: "pointer",
                      whiteSpace: "nowrap"
                    }}
                  >
                    <Copy size={12} />
                    {copied ? "COPIED" : "COPY"}
                  </button>
                </div>

                <button
                  onClick={handleResendEmail}
                  disabled={resendStatus === 'sending'}
                  style={{
                    width: "100%",
                    padding: "12px",
                    background: "var(--pipe-surface-hover)",
                    border: "1px solid var(--pipe-border)",
                    borderRadius: 4,
                    color: resendStatus === 'sent' ? '#34d399' : resendStatus === 'error' ? '#f87171' : 'var(--pipe-text-dim)',
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: "Space Mono",
                    cursor: resendStatus === 'sending' ? 'default' : 'pointer',
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: resendStatus === 'sending' ? 0.6 : 1
                  }}
                >
                  {resendStatus === 'sending' ? (
                    <><Loader2 size={14} className="animate-spin" /> SENDING...</>
                  ) : resendStatus === 'sent' ? (
                    <><CheckCircle size={14} /> EMAIL SENT</>
                  ) : resendStatus === 'error' ? (
                    <><AlertCircle size={14} /> FAILED — TRY AGAIN</>
                  ) : (
                    <><Send size={14} /> RESEND INVITE EMAIL</>
                  )}
                </button>
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
