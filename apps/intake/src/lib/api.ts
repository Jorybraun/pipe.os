const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export interface ResolveTokenResponse {
  id: string;
  sessionToken: string;
  pipelineId: string | null;
  status: string;
  name: string | null;
}

export async function resolveToken(inviteToken: string): Promise<ResolveTokenResponse> {
  const response = await fetch(apiUrl('/rpc/resolve-token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteToken }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Failed to resolve token (${response.status})`);
  }
  return response.json();
}

export interface StageConfigResponse {
  isComplete: boolean;
  stageId: string | null;
  candidateId: string;
  stageTitle: string;
  mode: string;
  challenges: Array<{ type: string; order: number; title: string }>;
  upcoming?: Array<{ type: string; title: string }>;
  currentIndex: number;
}

export async function getStageConfig(sessionToken: string): Promise<StageConfigResponse> {
  const response = await fetch(apiUrl('/rpc/get-stage-config'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Failed to get stage config (${response.status})`);
  }
  return response.json();
}

export interface IngestionStatusResponse {
  status: string;
  current_step: string | null;
  candidate_searchable_profile: string | null;
  key_concepts_json: string | null;
  error_text: string | null;
  estimated_completion_at: string | null;
}

export async function getIngestionStatus(sessionToken: string): Promise<IngestionStatusResponse> {
  const response = await fetch(apiUrl('/rpc/ingestion-status'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  if (!response.ok) {
    return { status: 'not_started', current_step: null, candidate_searchable_profile: null, key_concepts_json: null, error_text: null, estimated_completion_at: null };
  }
  return response.json();
}

export async function uploadResume(sessionToken: string, file: File, challengeId: string): Promise<{ r2Key: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('challengeId', challengeId);

  const response = await fetch(apiUrl('/rpc/upload-media'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Upload failed (${response.status})`);
  }

  return response.json();
}

export async function submitChallengeResponse(
  sessionToken: string,
  order: number,
  submission: Record<string, unknown>,
): Promise<{ success: boolean; next?: boolean; message?: string }> {
  const response = await fetch(apiUrl('/rpc/submit-challenge-response'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ order, submission }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Submission failed (${response.status})`);
  }

  return response.json();
}
