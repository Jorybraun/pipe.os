import type { RoomPhase, RoomWorkspace } from '../types';

export type RoomEvidenceActor = 'host' | 'guest';
export type RoomEvidenceSurface = 'standard' | 'win95';

export interface CodeEditorOpenEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export function buildCodeEditorOpenEvidence(input: {
  workspace: RoomWorkspace | null;
  actor: RoomEvidenceActor;
  surface: RoomEvidenceSurface;
  roomPhase: RoomPhase;
}): CodeEditorOpenEvidence | null {
  const session = input.workspace?.session;
  if (!session) return null;

  const repoLabel = input.workspace?.repoUrl ?? 'workspace repository';
  return {
    text: `VS Code workspace opened for ${repoLabel}`,
    properties: {
      source: 'code_server_workspace',
      editor: 'code-server',
      actor: input.actor,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceSessionId: session.sessionId,
      workspaceStatus: session.status,
      repoUrl: input.workspace?.repoUrl ?? null,
      githubPrNumber: input.workspace?.githubPrNumber ?? null,
      matchedRepoId: input.workspace?.matchedRepoId ?? null,
    },
  };
}
