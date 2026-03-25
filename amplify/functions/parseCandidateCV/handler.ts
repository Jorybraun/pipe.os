import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { marshall } from "@aws-sdk/util-dynamodb";

// ─── Clients ─────────────────────────────────────────────────────────────────

const dynamo = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Textract replaces pdf-parse: no bundling issues, works with scanned PDFs, fully AWS-native
const textract = new TextractClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// ─── Config ───────────────────────────────────────────────────────────────────

const CANDIDATE_TABLE = process.env.CANDIDATE_TABLE_NAME || "Candidate";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
// mistral-small is used intentionally: AppSync Lambda resolvers have a hard 30s timeout,
// so mistral-large (~45-60s) always times out. mistral-small reliably finishes in <15s.
const MISTRAL_MODEL = "mistral-small-latest";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedCV {
  name?: string;
  skills: string[];
  yearsOfExperience?: number;
  currentRole?: string;
  education?: string[];
}

interface ParseEvent {
  arguments: {
    candidateId: string;
    resumeS3Key: string;
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: ParseEvent) => {
  console.log("[ParseCandidateCV] Invoked", { event: JSON.stringify(event) });

  const { candidateId, resumeS3Key } = event.arguments;

  try {
    console.log("[ParseCandidateCV] Starting CV parsing for candidate:", candidateId);
    console.log("[ParseCandidateCV] Resume S3 key:", resumeS3Key);

    const bucketName = process.env.ASSET_BUCKET_NAME;
    if (!bucketName) throw new Error("ASSET_BUCKET_NAME env var not set");

    // 1. Extract text via Textract — reads directly from S3, no PDF library needed.
    // Textract handles text PDFs, scanned PDFs, and multi-page documents.
    console.log(`[ParseCandidateCV] Extracting text via Textract: ${bucketName}/${resumeS3Key}`);
    const textractResult = await textract.send(new DetectDocumentTextCommand({
      Document: {
        S3Object: {
          Bucket: bucketName,
          Name: resumeS3Key,
        },
      },
    }));

    const cvText = textractResult.Blocks
      ?.filter((block) => block.BlockType === "LINE")
      ?.map((block) => block.Text ?? "")
      ?.join("\n") ?? "";

    console.log("[ParseCandidateCV] Textract extracted chars:", cvText.length);

    if (!cvText || cvText.trim().length === 0) {
      throw new Error("No text extracted from document");
    }

    // Truncate to 3000 chars — enough for skills/role/education extraction.
    // Keeps the Mistral API call well under AppSync's 30s resolver timeout.
    const truncatedText = cvText.trim().slice(0, 3000);

    // 2. Parse with Mistral
    console.log("[ParseCandidateCV] Calling Mistral for structured extraction");
    const parsedData = await parseWithLLM(truncatedText);

    // 3. Update Candidate in DynamoDB
    console.log(`[ParseCandidateCV] Updating Candidate ${candidateId} in DynamoDB`, parsedData);

    await dynamo.send(new UpdateItemCommand({
      TableName: CANDIDATE_TABLE,
      Key: marshall({ id: candidateId }),
      UpdateExpression: "SET skills = :skills, yearsOfExperience = :yoe, currentRole = :role, education = :edu, resumeS3Key = :key",
      ExpressionAttributeValues: marshall({
        ":skills": parsedData.skills || [],
        ":yoe": parsedData.yearsOfExperience || 0,
        ":role": parsedData.currentRole || "",
        ":edu": parsedData.education || [],
        ":key": resumeS3Key,
      }),
    }));

    return {
      success: true,
      data: parsedData,
    };

  } catch (error) {
    console.error("[ParseCandidateCV] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseWithLLM(text: string): Promise<ParsedCV> {
  if (!MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY not configured");
  }

  const systemPrompt = `You are an expert recruitment assistant. Extract structured data from the following resume text.
Return ONLY valid JSON. Do not include any explanation or markdown formatting.

The JSON should follow this schema:
{
  "name": "Full Name",
  "skills": ["skill1", "skill2"],
  "yearsOfExperience": number,
  "currentRole": "Current Job Title",
  "education": ["Degree 1", "Degree 2"]
}`;

  console.log("[ParseCandidateCV] Calling Mistral API with model:", MISTRAL_MODEL);

  const response = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Resume Text:\n${text}` },
      ],
      temperature: 0.1,
      max_tokens: 400, // Structured JSON output is small; lower = faster response
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[ParseCandidateCV] Mistral API error:", response.status, errorText);
    throw new Error(`Mistral API error: ${response.status} ${errorText}`);
  }

  const responseBody = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  console.log("[ParseCandidateCV] Mistral response received");

  const outputText = responseBody.choices?.[0]?.message?.content;

  if (!outputText) {
    console.error("[ParseCandidateCV] Unexpected response structure:", responseBody);
    throw new Error("No content in Mistral response");
  }

  console.log("[ParseCandidateCV] LLM output text:", outputText);

  try {
    // Clean up any potential markdown or extra text
    const cleaned = outputText.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned) as ParsedCV;
    console.log("[ParseCandidateCV] Successfully parsed:", parsed);
    return parsed;
  } catch (err) {
    console.error("[ParseCandidateCV] Failed to parse LLM output:", outputText);
    console.error("[ParseCandidateCV] Parse error:", err);
    throw new Error("Failed to parse resume data from AI response");
  }
}
