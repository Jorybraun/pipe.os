import { Calendar, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { useScheduledInterview } from '../../hooks/useScheduledInterview';
import { resolveSchedulingProvider, ALL_PROVIDERS } from '../Scheduling/provider';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';

interface SchedulingStepProps {
  candidateId: string;
  stageId: string;
  candidateName: string;
  candidateEmail?: string;
}

/**
 * SchedulingStep — candidate-facing scheduling widget for LIVE_VIDEO stages.
 *
 * Loads the ScheduledInterview record for this candidate + stage, resolves
 * the appropriate scheduling provider, and renders the booking widget.
 *
 * TODO: After the candidate books via Calendly/Cal.com there is no automatic
 * webhook back to Pipe to update status → SCHEDULED. Until a webhook
 * integration is built, the recruiter must manually update status in the
 * dashboard. Add a note in the UI so candidates don't think nothing happened.
 */
export function SchedulingStep({
  candidateId,
  stageId,
  candidateName,
  candidateEmail,
}: SchedulingStepProps): JSX.Element {
  const { interview, isLoading, error } = useScheduledInterview(candidateId, stageId);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64 }}>
        <Loader2 className="animate-spin" size={28} color="var(--pipe-text-dim)" />
        <span style={{ marginLeft: 12, fontSize: 11, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
          LOADING_SCHEDULE...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <LiquidMetalCard variant="mercury" style={{ padding: 40, textAlign: 'center' }}>
        <AlertCircle size={40} color="rgba(255,100,100,0.5)" style={{ marginBottom: 16 }} />
        <p style={{ color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
          Could not load scheduling information. Please contact your recruiter.
        </p>
      </LiquidMetalCard>
    );
  }

  if (!interview) {
    // No ScheduledInterview record yet — recruiter hasn't sent an invite
    return (
      <LiquidMetalCard variant="mercury" style={{ padding: 40, textAlign: 'center' }}>
        <Calendar size={40} color="var(--pipe-text-dim)" style={{ marginBottom: 16 }} />
        <p style={{ color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontSize: 13, lineHeight: 1.7 }}>
          This stage requires a live interview. Your recruiter will send you a scheduling link shortly.
        </p>
      </LiquidMetalCard>
    );
  }

  // Already booked or completed
  if (interview.status === 'SCHEDULED') {
    const formattedDate = interview.scheduledAt
      ? new Date(interview.scheduledAt).toLocaleString()
      : null;

    return (
      <LiquidMetalCard variant="chrome" style={{ padding: 48, textAlign: 'center' }}>
        <CheckCircle size={48} color="#10b981" style={{ marginBottom: 24 }} />
        <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 12 }}>
          Interview Scheduled
        </h3>
        {formattedDate && (
          <p style={{ color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
            {formattedDate}
          </p>
        )}
        {interview.meetingUrl && (
          <a
            href={interview.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: 24,
              padding: '12px 28px',
              background: 'rgba(96,165,250,0.15)',
              border: '1px solid rgba(96,165,250,0.3)',
              color: '#60a5fa',
              fontSize: 11,
              letterSpacing: '0.15em',
              fontFamily: '"Space Mono", monospace',
              textDecoration: 'none',
            }}
          >
            JOIN MEETING →
          </a>
        )}
      </LiquidMetalCard>
    );
  }

  if (interview.status === 'COMPLETED') {
    return (
      <LiquidMetalCard variant="chrome" style={{ padding: 40, textAlign: 'center' }}>
        <CheckCircle size={40} color="#10b981" style={{ marginBottom: 16 }} />
        <p style={{ color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
          Your interview has been completed. Thank you!
        </p>
      </LiquidMetalCard>
    );
  }

  if (interview.status === 'CANCELLED') {
    return (
      <LiquidMetalCard variant="mercury" style={{ padding: 40, textAlign: 'center' }}>
        <AlertCircle size={40} color="rgba(255,100,100,0.5)" style={{ marginBottom: 16 }} />
        <p style={{ color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
          This interview has been cancelled. Please contact your recruiter to reschedule.
        </p>
      </LiquidMetalCard>
    );
  }

  // status === 'INVITED' or 'NO_SHOW' — show the booking widget
  const url = interview.schedulingUrl ?? '';
  if (!url) {
    return (
      <LiquidMetalCard variant="mercury" style={{ padding: 40, textAlign: 'center' }}>
        <Calendar size={40} color="var(--pipe-text-dim)" style={{ marginBottom: 16 }} />
        <p style={{ color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace', fontSize: 13 }}>
          Your recruiter has invited you to an interview. A scheduling link will be available soon.
        </p>
      </LiquidMetalCard>
    );
  }
  const provider = resolveSchedulingProvider(url, ALL_PROVIDERS);
  const { Widget } = provider;

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Calendar size={18} color="var(--pipe-text-dim)" />
        <span style={{ fontSize: 11, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
          SCHEDULE_YOUR_INTERVIEW
        </span>
      </div>

      <Widget
        schedulingUrl={url}
        candidateName={candidateName}
        candidateEmail={candidateEmail}
        interviewId={interview.id}
      />

      <p style={{ marginTop: 16, fontSize: 11, color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', textAlign: 'center' }}>
        After booking, your recruiter will confirm the appointment.
        {/* TODO: Remove this note once webhook auto-updates status → SCHEDULED */}
      </p>
    </div>
  );
}
