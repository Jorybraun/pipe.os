import { DynamoDBStreamEvent, Handler } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dbClient = new DynamoDBClient({});
const sesClient = new SESClient({});

const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME;
const STAGE_TABLE = process.env.STAGE_TABLE_NAME;
const PIPELINE_TABLE = process.env.PIPELINE_TABLE_NAME;
const SCHEDULED_INTERVIEW_TABLE = process.env.SCHEDULEDINTERVIEW_TABLE_NAME;
const SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'invites@pipe-os.com';

interface NotificationTemplate {
  trigger: 'INVITATION' | 'SUCCESS' | 'FAILURE' | 'INVITED' | 'SCHEDULED';
  subject: string;
  body: string;
}

/**
 * notificationService - Deterministic Communication Engine
 */
export const handler: Handler = async (event: any) => {
  console.log('[notificationService] Received event:', JSON.stringify(event, null, 2));

  // 1. Handle DynamoDB Stream Events
  if (event.Records) {
    const streamEvent = event as DynamoDBStreamEvent;
    for (const record of streamEvent.Records) {
      try {
        await processStreamRecord(record);
      } catch (err) {
        console.error('[notificationService] Error processing record:', err);
      }
    }
  }

  // 2. Handle AppSync Mutation (sendNotification)
  if (event.arguments) {
    const { candidateId, stageId, templateType } = event.arguments;
    console.log(`[notificationService] Manual trigger for ${candidateId} in stage ${stageId} (${templateType})`);
    try {
      await sendNotification(candidateId, stageId, templateType);
    } catch (err) {
      console.error('[notificationService] Error sending manual notification:', err);
    }
  }

  return { success: true };
};

async function processStreamRecord(record: any) {
  const newImageRaw = record.dynamodb?.NewImage;
  const oldImageRaw = record.dynamodb?.OldImage;

  if (!newImageRaw) return;

  // Manually unmarshall because the Lambda event format slightly differs from SDK expectations
  const newImage = unmarshall(newImageRaw as any);
  const oldImage = oldImageRaw ? unmarshall(oldImageRaw as any) : null;

  // ---------------------------------------------------------------------------
  // 1. ScheduledInterview stream: LIVE_VIDEO stage invite emails
  // ---------------------------------------------------------------------------
  if (record.eventSourceARN?.includes('ScheduledInterview')) {
    const interview = newImage as any;
    const oldInterview = oldImage as any;

    console.log(`[notificationService] Checking ScheduledInterview: status=${interview.status}, id=${interview.id}`);

    // Trigger: Status changed to INVITED
    if (interview.status === 'INVITED' && (!oldInterview || oldInterview.status !== 'INVITED')) {
      console.log(`[notificationService] Triggering INVITATION for candidate ${interview.candidateId}`);
      await sendNotification(interview.candidateId, interview.stageId, 'INVITATION', interview.id);
    }
    return;
  }

  // ---------------------------------------------------------------------------
  // 2. Candidate stream: ASYNC stage invite emails on candidate creation
  // ---------------------------------------------------------------------------
  if (record.eventSourceARN?.includes('Candidate')) {
    const candidate = newImage as any;

    // Only fire on INSERT (new candidate) with status INVITED
    if (record.eventName !== 'INSERT') {
      console.log(`[notificationService] Candidate event is ${record.eventName}, not INSERT. Skipping.`);
      return;
    }

    if (candidate.status !== 'INVITED') {
      console.log(`[notificationService] Candidate status is ${candidate.status}, not INVITED. Skipping.`);
      return;
    }

    if (!candidate.email) {
      console.warn(`[notificationService] Candidate ${candidate.id} has no email. Skipping.`);
      return;
    }

    console.log(`[notificationService] New candidate created: id=${candidate.id}, pipelineId=${candidate.pipelineId}`);

    // Find the first stage (order=0) in this pipeline to use in the email
    const firstStage = await findFirstStage(candidate.pipelineId);
    if (!firstStage) {
      console.warn(`[notificationService] No stages found for pipeline ${candidate.pipelineId}. Sending email with pipeline-level context.`);
    }

    const stageId = firstStage?.id ?? 'unknown';
    console.log(`[notificationService] Triggering INVITATION for new candidate ${candidate.id} (stage=${stageId})`);
    await sendCandidateInvite(candidate, firstStage);
    return;
  }

  console.log(`[notificationService] Unhandled stream source: ${record.eventSourceARN}`);
}

// ---------------------------------------------------------------------------
// Candidate invite email (ASYNC stages — triggered by Candidate creation)
// ---------------------------------------------------------------------------

/**
 * Find the first stage (lowest order) in a pipeline by scanning the Stage table.
 */
async function findFirstStage(pipelineId: string): Promise<Record<string, any> | null> {
  try {
    const res = await dbClient.send(new ScanCommand({
      TableName: STAGE_TABLE!,
      FilterExpression: 'pipelineId = :pid',
      ExpressionAttributeValues: { ':pid': { S: pipelineId } },
    }));

    if (!res.Items || res.Items.length === 0) return null;

    const stages = res.Items.map(item => unmarshall(item));
    // Sort by order ascending, pick first
    stages.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    return stages[0] ?? null;
  } catch (err) {
    console.error(`[notificationService] Error finding first stage for pipeline ${pipelineId}:`, err);
    return null;
  }
}

/**
 * Send an invite email to a newly created candidate.
 * Resolves the assessment URL from inviteToken or falls back to a scheduling link.
 */
async function sendCandidateInvite(candidate: Record<string, any>, stage: Record<string, any> | null): Promise<void> {
  const pipeline = await fetchItem(PIPELINE_TABLE!, { id: { S: candidate.pipelineId } });
  const appUrl = process.env.APP_URL || 'https://app.pipe-os.com';

  // Build the assessment link
  const assessUrl = candidate.inviteToken
    ? `${appUrl}/assess/${candidate.inviteToken}`
    : `${appUrl}`;

  // Determine if this is a scheduling (LIVE_VIDEO) or challenge (ASYNC) link
  const isLiveVideo = stage?.mode === 'LIVE_VIDEO';
  const bookingUrl = isLiveVideo && pipeline?.schedulingUrl
    ? `${pipeline.schedulingUrl}?name=${encodeURIComponent(candidate.name || '')}&email=${encodeURIComponent(candidate.email || '')}`
    : assessUrl;

  const candidateName = candidate.name || 'Candidate';
  const pipelineName = pipeline?.title || 'the role';
  const recruiterName = pipeline?.recruiterName || 'The Team';

  // Use stage-level notification templates if available, otherwise use defaults
  const templates = (stage?.notificationTemplates || []) as NotificationTemplate[];
  const template = templates.find(t => t.trigger === 'INVITATION') || getDefaultCandidateTemplate(isLiveVideo);

  const variables: Record<string, string> = {
    name: candidateName,
    candidateName,
    stageName: stage?.title || 'Assessment',
    pipelineName,
    bookingUrl,
    assessUrl,
    recruiterName,
    companyName: 'Pipe OS',
  };

  const subject = substituteVariables(template.subject, variables);
  const body = substituteVariables(template.body, variables);

  console.log(`[notificationService] Sending candidate invite: To=${candidate.email}, Subject="${subject}"`);

  try {
    await sesClient.send(new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: { ToAddresses: [candidate.email] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: body.replace(/\n/g, '<br>') } },
      },
    }));
    console.log(`[notificationService] Candidate invite sent successfully to ${candidate.email}`);
  } catch (sesErr) {
    console.error('[notificationService] SES Error sending candidate invite:', sesErr);
    throw sesErr;
  }
}

/**
 * Default template for candidate invitations, differentiated by stage mode.
 */
function getDefaultCandidateTemplate(isLiveVideo: boolean): NotificationTemplate {
  if (isLiveVideo) {
    return {
      trigger: 'INVITATION',
      subject: 'Interview Invitation: {{pipelineName}}',
      body: 'Hi {{name}},\n\nYou have been invited to an interview for the {{pipelineName}} role.\n\nPlease book your interview slot here:\n{{bookingUrl}}\n\nBest,\n{{recruiterName}}',
    };
  }
  return {
    trigger: 'INVITATION',
    subject: 'You\'re invited: {{pipelineName}} Assessment',
    body: 'Hi {{name}},\n\nYou have been invited to complete an assessment for the {{pipelineName}} role.\n\nStart your assessment here:\n{{assessUrl}}\n\nThe assessment includes a {{stageName}} stage. Take your time and do your best!\n\nBest,\n{{recruiterName}}',
  };
}

// ---------------------------------------------------------------------------
// ScheduledInterview notification (LIVE_VIDEO stages)
// ---------------------------------------------------------------------------

async function sendNotification(candidateId: string, stageId: string, type: string, interviewId?: string) {
  console.log(`[notificationService] Preparing ${type} for candidate ${candidateId} in stage ${stageId}`);

  const candidate = await fetchItem(CANDIDATE_TABLE!, { id: { S: candidateId } });
  const stage = await fetchItem(STAGE_TABLE!, { id: { S: stageId } });
  
  if (!candidate || !stage) {
    console.error(`[notificationService] Missing metadata: candidate=${!!candidate}, stage=${!!stage}`);
    return;
  }

  const pipeline = await fetchItem(PIPELINE_TABLE!, { id: { S: stage.pipelineId } });
  const templates = (stage.notificationTemplates || []) as NotificationTemplate[];
  const template = templates.find(t => t.trigger === type) || getDefaultTemplate(type);

  const variables = {
    name: candidate.name || 'Candidate',
    candidateName: candidate.name || 'Candidate',
    stageName: stage.title || 'Interview',
    pipelineName: pipeline?.title || 'the role',
    bookingUrl: await resolveBookingUrl(candidate, stage, pipeline),
    recruiterName: pipeline?.recruiterName || 'The Team',
    companyName: 'Pipe OS',
  };

  const subject = substituteVariables(template.subject, variables);
  const body = substituteVariables(template.body, variables);

  if (!candidate.email) {
    console.warn(`[notificationService] Candidate ${candidateId} has no email. Skipping.`);
    return;
  }

  console.log(`[notificationService] Sending email via SES: From=${SENDER_EMAIL}, To=${candidate.email}`);
  
  try {
    await sesClient.send(new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: { ToAddresses: [candidate.email] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: body.replace(/\n/g, '<br>') } },
      },
    }));
    console.log(`[notificationService] SES Email sent successfully to ${candidate.email}`);
  } catch (sesErr) {
    console.error('[notificationService] SES Error:', sesErr);
    throw sesErr;
  }

  // Update emailSentAt audit field (matches schema)
  if (interviewId && type === 'INVITATION') {
    console.log(`[notificationService] Updating emailSentAt for interview ${interviewId}`);
    await dbClient.send(new UpdateItemCommand({
      TableName: SCHEDULED_INTERVIEW_TABLE!,
      Key: { id: { S: interviewId } },
      UpdateExpression: 'SET emailSentAt = :now',
      ExpressionAttributeValues: { ':now': { S: new Date().toISOString() } },
    }));
  }
}

async function fetchItem(tableName: string, key: any) {
  const res = await dbClient.send(new GetItemCommand({
    TableName: tableName,
    Key: key,
  }));
  return res.Item ? unmarshall(res.Item) : null;
}

function substituteVariables(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(.*?)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    return vars[trimmedKey] || match;
  });
}

async function resolveBookingUrl(candidate: any, stage: any, pipeline: any): Promise<string> {
  const appUrl = process.env.APP_URL || 'https://app.pipe-os.com';
  
  if (candidate.inviteToken) {
    return `${appUrl}/assess/${candidate.inviteToken}`;
  }

  if (pipeline?.schedulingUrl) {
    return `${pipeline.schedulingUrl}?name=${encodeURIComponent(candidate.name || '')}&email=${encodeURIComponent(candidate.email || '')}`;
  }
  return 'https://calendly.com/pipe-demo';
}

function getDefaultTemplate(type: string): NotificationTemplate {
  switch (type) {
    case 'INVITATION':
      return {
        trigger: 'INVITATION',
        subject: 'Interview Invitation: {{pipelineName}}',
        body: 'Hi {{name}},\n\nYou have been invited to an interview for the {{pipelineName}} role. Please book your slot here: {{bookingUrl}}\n\nBest,\n{{recruiterName}}',
      };
    case 'SUCCESS':
      return {
        trigger: 'SUCCESS',
        subject: 'Great news! You passed the {{stageName}}',
        body: 'Hi {{name}},\n\nCongratulations! You have passed the {{stageName}} stage. We will reach out shortly with next steps.',
      };
    case 'FAILURE':
      return {
        trigger: 'FAILURE',
        subject: 'Update regarding your application',
        body: 'Hi {{name}},\n\nThank you for your interest in the {{pipelineName}} role. Unfortunately, we will not be moving forward with your application at this time.',
      };
    default:
      return { trigger: 'INVITATION' as any, subject: 'Notification', body: '...' };
  }
}
