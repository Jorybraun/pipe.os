import { describe, expect, it } from 'vitest';
import { buildRoomFileEvidence, roomFileEvidenceText } from './roomFileEvidence';

describe('buildRoomFileEvidence', () => {
  it('captures Notepad saves with deterministic content provenance', async () => {
    const evidence = await buildRoomFileEvidence({
      actor: 'guest',
      operation: 'upsert',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1700000000000,
      file: {
        id: 'desktop-notes',
        name: 'Notes.txt',
        kind: 'text',
        content: 'Candidate writes a replay test plan.',
        mimeType: 'text/plain',
        metadata: { app: 'notepad', path: 'Desktop/Notes.txt' },
        createdAt: 1699999999000,
        updatedAt: 1700000000000,
      },
    });

    expect(evidence).toMatchObject({
      text: 'Notes.txt',
      properties: {
        source: 'win95_shared_file_system',
        fileEventSource: 'browser_client_submit',
        fileChangeId: 'file:guest:1700000000000:upsert:desktop-notes',
        actor: 'guest',
        operation: 'upsert',
        fileId: 'desktop-notes',
        fileName: 'Notes.txt',
        fileKind: 'text',
        surface: 'win95',
        roomPhase: 'connected',
        capturedAtMs: 1700000000000,
        contentLength: 36,
        contentPreview: 'Candidate writes a replay test plan.',
        contentExactText: 'Candidate writes a replay test plan.',
        mimeType: 'text/plain',
        path: 'Desktop/Notes.txt',
        fileCreatedAt: 1699999999000,
        fileUpdatedAt: 1700000000000,
        durableObjectReplayExpected: true,
      },
    });
    expect(evidence.properties.contentHash).toMatch(/^content_[a-f0-9]{32}$/);
  });

  it('captures Paint saves with exact JSON provenance but no preview', async () => {
    const paintJson = '[{"kind":"rectangle","start":{"x":1,"y":2},"end":{"x":3,"y":4}}]';
    const evidence = await buildRoomFileEvidence({
      actor: 'guest',
      operation: 'upsert',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1700000000500,
      file: {
        id: 'desktop-paint',
        name: 'Sketch.pipe-paint',
        kind: 'paint',
        content: paintJson,
        mimeType: 'application/json',
        metadata: { app: 'paint', path: 'Desktop/Sketch.pipe-paint' },
        createdAt: 1699999999000,
        updatedAt: 1700000000500,
      },
    });

    expect(evidence).toMatchObject({
      text: 'Sketch.pipe-paint',
      properties: {
        source: 'win95_shared_file_system',
        fileEventSource: 'browser_client_submit',
        fileChangeId: 'file:guest:1700000000500:upsert:desktop-paint',
        operation: 'upsert',
        fileId: 'desktop-paint',
        fileKind: 'paint',
        contentLength: paintJson.length,
        contentExactJson: paintJson,
      },
    });
    expect(evidence.properties.contentHash).toMatch(/^content_[a-f0-9]{32}$/);
    expect(evidence.properties).not.toHaveProperty('contentPreview');
  });

  it('captures Paint deletes without storing raw paint previews', async () => {
    const paintJson = '[{"kind":"rectangle","start":{"x":1,"y":2},"end":{"x":3,"y":4}}]';
    const evidence = await buildRoomFileEvidence({
      actor: 'host',
      operation: 'delete',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1700000001000,
      file: {
        id: 'desktop-paint',
        name: 'Sketch.pipe-paint',
        kind: 'paint',
        content: paintJson,
        mimeType: 'application/json',
        metadata: { app: 'paint', path: 'Desktop/Sketch.pipe-paint' },
        createdAt: 1699999999000,
        updatedAt: 1700000000500,
      },
    });

    expect(evidence).toMatchObject({
      text: 'Sketch.pipe-paint',
      properties: {
        source: 'win95_shared_file_system',
        fileEventSource: 'browser_client_submit',
        fileChangeId: 'file:host:1700000001000:delete:desktop-paint',
        actor: 'host',
        operation: 'delete',
        fileId: 'desktop-paint',
        fileKind: 'paint',
        capturedAtMs: 1700000001000,
        deletedContentLength: paintJson.length,
        deletedContentExactJson: paintJson,
        deletedFileCreatedAt: 1699999999000,
        deletedFileUpdatedAt: 1700000000500,
      },
    });
    expect(evidence.properties.deletedContentHash).toMatch(/^content_[a-f0-9]{32}$/);
    expect(evidence.properties).not.toHaveProperty('deletedContentPreview');
  });

  it('formats readable file activity text without replacing source properties', () => {
    expect(roomFileEvidenceText('guest', 'upsert', 'Notes.txt')).toBe('Guest saved Notes.txt');
    expect(roomFileEvidenceText('host', 'delete', 'Sketch.pipe-paint')).toBe('Host deleted Sketch.pipe-paint');
  });
});
