import type { RoomPhase } from '../types';
import type { RoomFile, RoomFileKind, RoomSurface } from '../hooks/useRoomConnection';

export type RoomFileEvidenceOperation = 'upsert' | 'delete';
export type RoomFileEvidenceActor = 'host' | 'guest';

interface RoomFileEvidenceInput {
  actor: RoomFileEvidenceActor;
  operation: RoomFileEvidenceOperation;
  file: Pick<RoomFile, 'id' | 'name' | 'kind' | 'content' | 'mimeType' | 'metadata' | 'createdAt' | 'updatedAt'>;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}

export interface RoomFileEvidence {
  text: string;
  properties: Record<string, unknown>;
}

const TEXT_PREVIEW_LIMIT = 1000;

function actorLabel(actor: RoomFileEvidenceActor): string {
  return actor === 'host' ? 'Host' : 'Guest';
}

function operationLabel(operation: RoomFileEvidenceOperation): string {
  return operation === 'delete' ? 'deleted' : 'saved';
}

function compactPreview(content: string, fileKind: RoomFileKind): string | undefined {
  if (fileKind === 'paint') return undefined;
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  return trimmed.length > TEXT_PREVIEW_LIMIT
    ? `${trimmed.slice(0, TEXT_PREVIEW_LIMIT)}...`
    : trimmed;
}

function filePath(file: RoomFileEvidenceInput['file']): string | null {
  const path = file.metadata?.path;
  return typeof path === 'string' && path.trim().length > 0 ? path : null;
}

async function deterministicContentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(`content\u0000${content}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `content_${hex.slice(0, 32)}`;
}

export async function buildRoomFileEvidence(input: RoomFileEvidenceInput): Promise<RoomFileEvidence> {
  const contentHash = await deterministicContentHash(input.file.content);
  const preview = compactPreview(input.file.content, input.file.kind);
  const path = filePath(input.file);
  const capturedAtMs = Number.isFinite(input.capturedAtMs) ? Math.max(0, Math.round(input.capturedAtMs)) : 0;
  const sharedProperties: Record<string, unknown> = {
    source: 'win95_shared_file_system',
    fileEventSource: 'browser_client_submit',
    fileChangeId: `file:${input.actor}:${capturedAtMs}:${input.operation}:${input.file.id}`,
    actor: input.actor,
    operation: input.operation,
    action: input.operation,
    fileId: input.file.id,
    fileName: input.file.name,
    fileKind: input.file.kind,
    surface: input.surface,
    roomPhase: input.roomPhase,
    capturedAtMs,
    durableObjectReplayExpected: input.surface === 'win95',
  };
  if (input.file.mimeType) sharedProperties.mimeType = input.file.mimeType;
  if (path) sharedProperties.path = path;

  if (input.operation === 'delete') {
    return {
      text: input.file.name,
      properties: {
        ...sharedProperties,
        deletedContentLength: input.file.content.length,
        deletedContentHash: contentHash,
        deletedFileCreatedAt: input.file.createdAt,
        deletedFileUpdatedAt: input.file.updatedAt,
        ...(preview ? { deletedContentPreview: preview } : {}),
      },
    };
  }

  return {
    text: input.file.name,
    properties: {
      ...sharedProperties,
      contentLength: input.file.content.length,
      contentHash,
      fileCreatedAt: input.file.createdAt,
      fileUpdatedAt: input.file.updatedAt,
      ...(preview ? { contentPreview: preview } : {}),
    },
  };
}

export function roomFileEvidenceText(actor: RoomFileEvidenceActor, operation: RoomFileEvidenceOperation, fileName: string): string {
  return `${actorLabel(actor)} ${operationLabel(operation)} ${fileName}`;
}
