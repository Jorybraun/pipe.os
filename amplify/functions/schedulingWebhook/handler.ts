/**
 * Scheduling Webhook Lambda Handler
 *
 * Public-facing webhook receiver for Calendly and Cal.com callbacks.
 * Identifies the provider, verifies HMAC, normalizes the payload, and
 * updates the corresponding ScheduledInterview record.
 *
 * Exposed via Lambda Function URL.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import type { WebhookNormalizer, NormalizedSchedulingEvent } from "./types";
import { calendlyNormalizer } from "./providers/calendly";
import { calcomNormalizer } from "./providers/calcom";

// ---------------------------------------------------------------------------
// DynamoDB setup
// ---------------------------------------------------------------------------

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CONNECTION_TABLE =
  process.env["SCHEDULINGCONNECTION_TABLE_NAME"] ?? "SchedulingConnection";
const INTERVIEW_TABLE =
  process.env["SCHEDULEDINTERVIEW_TABLE_NAME"] ?? "ScheduledInterview";
const CANDIDATE_TABLE =
  process.env["CANDIDATE_TABLE_NAME"] ?? "Candidate";

// ---------------------------------------------------------------------------
// Normalizer registry
// ---------------------------------------------------------------------------

const normalizers: WebhookNormalizer[] = [calendlyNormalizer, calcomNormalizer];

/**
 * Resolve which normalizer handles this webhook based on headers.
 */
function resolveNormalizer(
  headers: Record<string, string | undefined>,
): WebhookNormalizer | null {
  return (
    normalizers.find((n) =>
      n.identifyProvider(headers as Record<string, string>),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Status transition validation (mirrors client-side canTransition)
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  INVITED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: ["INVITED"],
  NO_SHOW: ["SCHEDULED", "CANCELLED"],
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionRecord {
  id: string;
  recruiterId: string;
  providerId: string;
  webhookSecret?: string;
  status: string;
}

interface InterviewRecord {
  id: string;
  status: string;
  externalEventId?: string;
  candidateId: string;
  pipelineId: string;
}

// ---------------------------------------------------------------------------
// DynamoDB helpers
// ---------------------------------------------------------------------------

/**
 * Find the ACTIVE SchedulingConnection for a given provider.
 * A recruiter should have at most one ACTIVE connection per provider.
 */
async function findConnectionByProvider(
  providerId: string,
): Promise<ConnectionRecord | null> {
  // NOTE: Do NOT use Limit with FilterExpression — Limit restricts items
  // *scanned*, not items *returned*. With multiple connections the scan may
  // read one REVOKED row, apply the filter, return 0 results, and stop.
  const result = await ddb.send(
    new ScanCommand({
      TableName: CONNECTION_TABLE,
      FilterExpression: "#pid = :pid AND #st = :st",
      ExpressionAttributeNames: {
        "#pid": "providerId",
        "#st": "status",
      },
      ExpressionAttributeValues: {
        ":pid": providerId,
        ":st": "ACTIVE",
      },
    }),
  );

  const item = result.Items?.[0];
  if (!item) return null;

  return {
    id: item["id"] as string,
    recruiterId: item["recruiterId"] as string,
    providerId: item["providerId"] as string,
    webhookSecret: item["webhookSecret"] as string | undefined,
    status: item["status"] as string,
  };
}

/**
 * Find a ScheduledInterview by externalEventId, or by candidate email
 * (for the first booking when externalEventId hasn't been stored yet).
 */
async function findScheduledInterview(
  normalized: NormalizedSchedulingEvent,
): Promise<InterviewRecord | null> {
  // 1. Try matching by externalEventId (for subsequent updates / cancellations)
  if (normalized.externalEventId) {
    const result = await ddb.send(
      new ScanCommand({
        TableName: INTERVIEW_TABLE,
        FilterExpression: "#eid = :eid",
        ExpressionAttributeNames: { "#eid": "externalEventId" },
        ExpressionAttributeValues: { ":eid": normalized.externalEventId },
        Limit: 1,
      }),
    );

    const item = result.Items?.[0];
    if (item) {
      return {
        id: item["id"] as string,
        status: item["status"] as string,
        externalEventId: item["externalEventId"] as string | undefined,
        candidateId: item["candidateId"] as string,
        pipelineId: item["pipelineId"] as string,
      };
    }
  }

  // 2. Fallback: match by candidate email → find their INVITED ScheduledInterview
  if (normalized.candidateEmail) {
    console.log("[schedulingWebhook] No match by externalEventId, trying candidateEmail", {
      candidateEmail: normalized.candidateEmail,
    });

    // Find candidate(s) with this email
    const candidateResult = await ddb.send(
      new ScanCommand({
        TableName: CANDIDATE_TABLE,
        FilterExpression: "#email = :email",
        ExpressionAttributeNames: { "#email": "email" },
        ExpressionAttributeValues: { ":email": normalized.candidateEmail },
      }),
    );

    const candidates = candidateResult.Items ?? [];
    console.log("[schedulingWebhook] Candidate email lookup", {
      candidateEmail: normalized.candidateEmail,
      candidateCount: candidates.length,
      candidateIds: candidates.map((c) => c["id"]).slice(0, 10),
    });
    if (candidates.length === 0) {
      console.log("[schedulingWebhook] No candidate found with email", {
        candidateEmail: normalized.candidateEmail,
      });
      return null;
    }

    // For each candidate, find an INVITED ScheduledInterview
    for (const candidate of candidates) {
      const candidateId = candidate["id"] as string;
      const interviewResult = await ddb.send(
        new ScanCommand({
          TableName: INTERVIEW_TABLE,
          FilterExpression: "#cid = :cid AND #status = :status",
          ExpressionAttributeNames: {
            "#cid": "candidateId",
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":cid": candidateId,
            ":status": "INVITED",
          },
        }),
      );

      const item = interviewResult.Items?.[0];
      if (item) {
        console.log("[schedulingWebhook] Matched interview by email", {
          candidateEmail: normalized.candidateEmail,
          candidateId,
          interviewId: item["id"],
        });
        return {
          id: item["id"] as string,
          status: item["status"] as string,
          externalEventId: item["externalEventId"] as string | undefined,
          candidateId: item["candidateId"] as string,
          pipelineId: item["pipelineId"] as string,
        };
      }
    }
  }

  return null;
}

/**
 * Update a ScheduledInterview record with webhook data.
 */
async function updateInterview(
  id: string,
  normalized: NormalizedSchedulingEvent,
): Promise<void> {
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: INTERVIEW_TABLE,
      Key: { id },
      UpdateExpression:
        "SET #status = :status, #scheduledAt = :scheduledAt, #syncSource = :syncSource, #lastSyncedAt = :lastSyncedAt, #externalEventId = :externalEventId, #updatedAt = :updatedAt" +
        (normalized.meetingUrl ? ", #meetingUrl = :meetingUrl" : ""),
      ExpressionAttributeNames: {
        "#status": "status",
        "#scheduledAt": "scheduledAt",
        "#syncSource": "syncSource",
        "#lastSyncedAt": "lastSyncedAt",
        "#externalEventId": "externalEventId",
        "#updatedAt": "updatedAt",
        ...(normalized.meetingUrl ? { "#meetingUrl": "meetingUrl" } : {}),
      },
      ExpressionAttributeValues: {
        ":status": normalized.status,
        ":scheduledAt": normalized.scheduledAt,
        ":syncSource": "WEBHOOK",
        ":lastSyncedAt": now,
        ":externalEventId": normalized.externalEventId,
        ":updatedAt": now,
        ...(normalized.meetingUrl
          ? { ":meetingUrl": normalized.meetingUrl }
          : {}),
      },
    }),
  );
}

/**
 * Update the SchedulingConnection's lastSyncAt timestamp.
 */
async function updateConnectionLastSync(connectionId: string): Promise<void> {
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: connectionId },
      UpdateExpression:
        "SET #lastSyncAt = :lastSyncAt, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#lastSyncAt": "lastSyncAt",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":lastSyncAt": now,
        ":updatedAt": now,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Lambda handler entry point.
 *
 * Called via Lambda Function URL.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const startTime = Date.now();

  console.log("[schedulingWebhook] Starting request", {
    method: event.requestContext.http.method,
    headers: event.headers,
  });

  // Rollback switch
  if (process.env["WEBHOOK_ENABLED"] === "false") {
    return {
      statusCode: 503,
      body: JSON.stringify({ message: "Webhook processing disabled" }),
    };
  }

  try {
    // Step 1: Identify provider
    const normalizer = resolveNormalizer(event.headers);

    if (!normalizer) {
      console.warn("[schedulingWebhook] Unknown provider or missing headers", {
        headers: event.headers,
      });
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Unknown provider" }),
      };
    }

    // Step 2: Find the SchedulingConnection for this provider
    const connection = await findConnectionByProvider(normalizer.providerId);

    if (!connection) {
      console.warn("[schedulingWebhook] No active connection for provider", {
        provider: normalizer.providerId,
      });
      return {
        statusCode: 404,
        body: JSON.stringify({ message: "No active connection found" }),
      };
    }

    // Step 3: Verify HMAC signature
    const payloadStr = event.body || "";

    // Each provider has its own signature header name
    const signatureHeader =
      normalizer.providerId === "CALENDLY"
        ? "calendly-webhook-signature"
        : "x-cal-signature-v2";
    const signature = event.headers[signatureHeader];

    if (connection.webhookSecret) {
      if (!signature) {
        console.error(
          "[schedulingWebhook] Webhook secret configured but no signature header present",
          {
            provider: normalizer.providerId,
            header: signatureHeader,
          },
        );
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Missing webhook signature" }),
        };
      }

      const isValid = normalizer.verifySignature(
        payloadStr,
        signature,
        connection.webhookSecret,
      );

      if (!isValid) {
        console.error("[schedulingWebhook] Invalid HMAC signature", {
          provider: normalizer.providerId,
          connectionId: connection.id,
        });
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Invalid webhook signature" }),
        };
      }
    } else {
      console.log(
        "[schedulingWebhook] Skipping HMAC verification (no secret configured)",
        {
          provider: normalizer.providerId,
        },
      );
    }

    // Step 4: Normalize the payload
    const parsed: unknown = JSON.parse(payloadStr);
    const normalized = normalizer.normalize(parsed);

    console.log("[schedulingWebhook] Normalized event", {
      externalEventId: normalized.externalEventId,
      status: normalized.status,
      candidateEmail: normalized.candidateEmail,
    });

    // Step 5: Find matching ScheduledInterview
    const interview = await findScheduledInterview(normalized);

    if (!interview) {
      console.log("[schedulingWebhook] No matching interview found", {
        externalEventId: normalized.externalEventId,
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "No matching interview found",
          event: normalized,
        }),
      };
    }

    // Step 6: Validate status transition
    const currentStatus = interview.status ?? "INVITED";
    if (!canTransition(currentStatus, normalized.status)) {
      console.warn("[schedulingWebhook] Invalid status transition", {
        interviewId: interview.id,
        from: currentStatus,
        to: normalized.status,
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Transition not allowed`,
          event: normalized,
        }),
      };
    }

    // Step 7: Update ScheduledInterview
    await updateInterview(interview.id, normalized);

    // Step 8: Update connection lastSyncAt
    await updateConnectionLastSync(connection.id);

    console.log("[schedulingWebhook] Complete", {
      processingTime: Date.now() - startTime,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Interview updated", event: normalized }),
    };
  } catch (error) {
    console.error("[schedulingWebhook] Fatal error", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}
