import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { VideoShell } from '../components/Shells/VideoShell';
import { ChromeMeshGrid } from '../components/ChromeMeshGrid';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { CheckCircle, AlertCircle, Loader2, User, Mail, FileText, Video } from 'lucide-react';
import type { MeetingType } from '../lib/scheduling/types';

interface InviteData {
  id: string;
  meetingType: MeetingType | null;
  recipientName: string | null;
  recipientEmail: string | null;
  status: string;
  scheduledAt: string | null;
  meetingUrl: string | null;
  schedulingUrl: string | null;
  cvProfile: Record<string, unknown> | null;
  candidateName: string | null;
  candidateEmail: string | null;
  pipelineTitle: string | null;
  stageTitle: string | null;
}

interface ProfileFormData {
  name: string;
  email: string;
  resume: string;
}

export default function RecipientInvitePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileSubmitted, setProfileSubmitted] = useState(false);
  const [profileData, setProfileData] = useState<ProfileFormData>({
    name: '',
    email: '',
    resume: '',
  });

  // Load invite data on mount
  useEffect(() => {
    if (!id) return;
    
    const loadInvite = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/v1/scheduling/invite/${id}`);
        if (!response.ok) {
          const errorData = await response.json() as { error?: { message?: string } };
          throw new Error(errorData.error?.message || 'Failed to load invite');
        }
        const data = await response.json() as { invite: InviteData };
        setInviteData(data.invite);
        
        // Pre-fill profile data if available from invite
        if (data.invite.recipientName || data.invite.recipientEmail) {
          setProfileData({
            name: data.invite.recipientName || '',
            email: data.invite.recipientEmail || '',
            resume: '',
          });
        }
        
        // If CV profile was already provided, skip profile step
        if (data.invite.cvProfile) {
          setProfileSubmitted(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invite');
      } finally {
        setIsLoading(false);
      }
    };
    
    void loadInvite();
  }, [id]);

  const handleProfileSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    
    setIsLoading(true);
    try {
      // Update the interview with profile data
      const response = await fetch(`/api/v1/scheduling/interviews/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recruiterNotes: JSON.stringify({ cvProfile: profileData }),
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to submit profile');
      }
      
      setProfileSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileChange = (field: keyof ProfileFormData, value: string): void => {
    setProfileData(prev => ({ ...prev, [field]: value }));
  };

  // Loading state
  if (isLoading && !inviteData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e' }}>
        <ChromeMeshGrid />
        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <Loader2 className="animate-spin" size={32} color="var(--pipe-text-dim)" />
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            LOADING_INVITE...
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 480, padding: 48, textAlign: 'center', zIndex: 1 }}>
          <AlertCircle size={48} color="rgba(255,100,100,0.5)" style={{ marginBottom: 24 }} />
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 16 }}>
            Invite Error
          </h2>
          <p style={{ fontSize: 14, color: 'var(--pipe-text-dim)', lineHeight: 1.6, marginBottom: 32, fontFamily: '"Space Mono", monospace' }}>
            {error}
          </p>
        </LiquidMetalCard>
      </div>
    );
  }

  // Completed state
  if (inviteData?.status === 'COMPLETED') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="chrome" style={{ maxWidth: 480, padding: 60, textAlign: 'center', zIndex: 1 }}>
          <CheckCircle size={64} color="#10b981" style={{ marginBottom: 32 }} />
          <h2 style={{ fontSize: 32, fontWeight: 800, color: 'var(--pipe-text, #fff)', marginBottom: 16, letterSpacing: '-0.02em' }}>
            Call Completed
          </h2>
          <p style={{ fontSize: 14, color: 'var(--pipe-text-muted)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace' }}>
            Your video call has been completed. Thank you for your time!
          </p>
        </LiquidMetalCard>
      </div>
    );
  }

  // Profile intake form (if not submitted and no pre-existing CV profile)
  if (!profileSubmitted && inviteData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="chrome" style={{ maxWidth: 520, padding: 48, zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <Video size={32} color="var(--pipe-text, #fff)" />
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 4 }}>
                {inviteData.meetingType === 'DIRECT_VIDEO_CALL' ? 'Video Call' : 'Screening Interview'}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                {inviteData.meetingType === 'DIRECT_VIDEO_CALL' ? 'DIRECT_VIDEO_CALL' : 'SCREENING_INTERVIEW'}
              </p>
            </div>
          </div>
          
          <p style={{ fontSize: 14, color: 'var(--pipe-text-muted)', lineHeight: 1.6, marginBottom: 32 }}>
            Please provide your basic information before joining the call.
          </p>
          
          <form onSubmit={handleProfileSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                FULL_NAME
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} color="var(--pipe-text-dim)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  value={profileData.name}
                  onChange={(e) => handleProfileChange('name', e.target.value)}
                  required
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '12px 12px 12px 40',
                    background: 'var(--pipe-surface-hover)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 8,
                    color: 'var(--pipe-text, #fff)',
                    fontSize: 14,
                    fontFamily: '"Space Mono", monospace',
                    outline: 'none',
                  }}
                  placeholder="Enter your full name"
                />
              </div>
            </div>
            
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                EMAIL_ADDRESS
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} color="var(--pipe-text-dim)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="email"
                  value={profileData.email}
                  onChange={(e) => handleProfileChange('email', e.target.value)}
                  required
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: '12px 12px 12px 40',
                    background: 'var(--pipe-surface-hover)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 8,
                    color: 'var(--pipe-text, #fff)',
                    fontSize: 14,
                    fontFamily: '"Space Mono", monospace',
                    outline: 'none',
                  }}
                  placeholder="Enter your email"
                />
              </div>
            </div>
            
            <div style={{ marginBottom: 32 }}>
              <label style={{ display: 'block', fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                RESUME_SUMMARY (OPTIONAL)
              </label>
              <div style={{ position: 'relative' }}>
                <FileText size={16} color="var(--pipe-text-dim)" style={{ position: 'absolute', left: 12, top: 12 }} />
                <textarea
                  value={profileData.resume}
                  onChange={(e) => handleProfileChange('resume', e.target.value)}
                  disabled={isLoading}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '12px 12px 12px 40',
                    background: 'var(--pipe-surface-hover)',
                    border: '1px solid var(--pipe-border)',
                    borderRadius: 8,
                    color: 'var(--pipe-text, #fff)',
                    fontSize: 14,
                    fontFamily: '"Space Mono", monospace',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                  placeholder="Brief summary of your experience (optional)"
                />
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '14px 24px',
                background: isLoading ? 'var(--pipe-surface-hover)' : 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                color: 'var(--pipe-text, #fff)',
                fontSize: 11,
                letterSpacing: '0.15em',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  SUBMITTING...
                </>
              ) : (
                'CONTINUE_TO_VIDEO_CALL'
              )}
            </button>
          </form>
        </LiquidMetalCard>
      </div>
    );
  }

  // Video call interface with VideoShell
  if (inviteData && profileSubmitted) {
    // Generate a stage ID for video signaling (use interview ID as stage ID)
    const stageId = inviteData.id;
    // Use a fixed candidate ID for contact-first calls (no real candidate yet)
    const candidateId = 'contact-first-recipient';
    
    return (
      <div style={{ height: '100vh', overflow: 'hidden', background: '#0c0c0e' }}>
        <ChromeMeshGrid />
        <VideoShell
          stageId={stageId}
          candidateId={candidateId}
          role="CANDIDATE"
        >
          <div style={{
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}>
            <LiquidMetalCard variant="chrome" style={{ maxWidth: 480, padding: 48, textAlign: 'center' }}>
              <Video size={48} color="var(--pipe-text, #fff)" style={{ marginBottom: 24 }} />
              <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 16 }}>
                {inviteData.meetingType === 'DIRECT_VIDEO_CALL' ? 'Video Call' : 'Screening Interview'}
              </h2>
              <p style={{ fontSize: 14, color: 'var(--pipe-text-muted)', lineHeight: 1.6, marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
                {inviteData.recipientName || 'Guest'}
              </p>
              <p style={{ fontSize: 12, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                Waiting for recruiter to join...
              </p>
              {inviteData.scheduledAt && (
                <p style={{ fontSize: 12, color: 'var(--pipe-text-dim)', marginTop: 16, fontFamily: '"Space Mono", monospace' }}>
                  Scheduled: {new Date(inviteData.scheduledAt).toLocaleString()}
                </p>
              )}
            </LiquidMetalCard>
          </div>
        </VideoShell>
      </div>
    );
  }

  // Fallback
  return <div />;
}
