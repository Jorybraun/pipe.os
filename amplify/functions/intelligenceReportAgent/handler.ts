import { Mistral } from '@mistralai/mistralai';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// ─── Clients ─────────────────────────────────────────────────────────────────

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// ─── Config ───────────────────────────────────────────────────────────────────

const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME ?? 'Candidate';
const ASSESSMENT_TABLE = process.env.ASSESSMENT_TABLE_NAME ?? 'Assessment';
const CHALLENGE_SUBMISSION_TABLE = process.env.CHALLENGE_SUBMISSION_TABLE_NAME ?? 'ChallengeSubmission';
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME ?? 'Challenge';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL ?? 'mistral-large-latest';

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: any): Promise<any> => {
  const { candidateId } = event.arguments;

  try {
    // 1. Fetch Candidate
    const candidateRes = await dynamo.send(new GetItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: marshall({ id: candidateId }),
    }));
    const candidate = unmarshall(candidateRes.Item!);

    // 2. Fetch all Assessments for this candidate
    const assessmentsRes = await dynamo.send(new QueryCommand({
      TableName: ASSESSMENT_TABLE,
      IndexName: 'assessmentsByCandidateAndStage',
      KeyConditionExpression: 'candidateId = :cid',
      ExpressionAttributeValues: marshall({ ':cid': candidateId }),
    }));
    const assessments = assessmentsRes.Items?.map(i => unmarshall(i)) || [];

    // 3. Fetch all Submissions and Challenges for context
    const reportData = await Promise.all(assessments.map(async (ass) => {
      const subsRes = await dynamo.send(new QueryCommand({
        TableName: CHALLENGE_SUBMISSION_TABLE,
        IndexName: 'submissionsByAssessmentAndChallenge',
        KeyConditionExpression: 'assessmentId = :aid',
        ExpressionAttributeValues: marshall({ ':aid': ass.id }),
      }));
      const subs = subsRes.Items?.map(i => unmarshall(i)) || [];
      
      const hydratedSubs = await Promise.all(subs.map(async (s) => {
        const chalRes = await dynamo.send(new GetItemCommand({
          TableName: CHALLENGE_TABLE,
          Key: marshall({ id: s.challengeId }),
        }));
        return { ...s, challenge: unmarshall(chalRes.Item!) };
      }));

      return { ...ass, submissions: hydratedSubs };
    }));

    // 4. Build AI Prompt
    const systemPrompt = `You are the Pipe Intelligence Agent. Your goal is to generate a dynamic, high-fidelity intelligence report for a candidate.
    
You have access to a rich registry of UI blocks, including advanced data visualisations. You must decide which blocks best represent the candidate's journey and performance.

### Available Visualization Blocks:

1. EXECUTIVE_SUMMARY (Full Width)
   - Usage: Narrative overview.
   - Schema: { "summary": "string" }

2. SKILL_RADAR (Half Width)
   - Usage: Multi-axis spider chart for technical/soft skills.
   - Schema: { "skills": { "Label": number (0-100), ... } } (minimum 3 labels)

3. HIRE_RECOMMENDATION (Half Width)
   - Usage: Final verdict and alignment score.
   - Schema: { "score": number (0-100), "signal": "STRONG|YES|MAYBE|NO" }

4. STRENGTHS_CONCERNS (Full Width)
   - Usage: Key highlights and risks.
   - Schema: { "strengths": ["string"], "concerns": ["string"] }

5. PERFORMANCE_TIMELINE (Full Width)
   - Usage: Bar chart showing score progression across stages.
   - Schema: { "points": [{ "label": "string", "value": number (0-100) }] }

6. RADIAL_GAUGE (Half or Full Width)
   - Usage: Circular gauges for focus areas (e.g. Code Quality, System Design).
   - Schema: { "gauges": [{ "label": "string", "value": number (0-100), "color": "hex_code" }] }

7. KEY_FINDINGS (Full Width)
   - Usage: Detailed observations with status icons.
   - Schema: { "findings": [{ "title": "string", "detail": "string", "icon": "trend|alert" }] }

### Output Format:
Return ONLY a JSON array of block objects.
Example:
[
  { "id": "1", "type": "HIRE_RECOMMENDATION", "title": "Recommendation", "data": { "score": 85, "signal": "STRONG" }, "priority": 0, "width": "half" },
  { "id": "2", "type": "SKILL_RADAR", "title": "Skill Matrix", "data": { "skills": { "Logic": 90, "Security": 70, "Communication": 85 } }, "priority": 1, "width": "half" }
]`;

    const userPrompt = `Generate a high-fidelity intelligence report for ${candidate.name}.
    
Context:
${JSON.stringify(reportData, null, 2)}`;

    const response = await mistral.chat.complete({
      model: MISTRAL_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    const cleaned = (typeof content === 'string' ? content : '').replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    
    return JSON.parse(cleaned);

  } catch (error) {
    console.error('[IntelligenceAgent] Error:', error);
    return [{
      id: 'error',
      type: 'EXECUTIVE_SUMMARY',
      title: 'Report Generation Failed',
      data: { summary: 'The AI was unable to generate a structured report at this time.' },
      priority: 0,
      width: 'full'
    }];
  }
};
