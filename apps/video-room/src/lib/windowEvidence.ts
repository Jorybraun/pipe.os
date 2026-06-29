import type { RoomSurface } from '../hooks/useRoomConnection';
import type { RoomPhase } from '../types';

export type WindowEvidenceActor = 'host' | 'guest';
export type WindowLifecycleKind = 'open' | 'close';
export type WindowLifecycleSource =
  | 'win95_desktop_ui'
  | 'win95_file_system'
  | 'win95_start_menu'
  | 'win95_window_chrome'
  | 'win95_taskbar'
  | 'clippy_action'
  | 'shared_state_sync';
export type WindowStateSource =
  | 'win95_desktop_ui'
  | 'win95_start_menu'
  | 'win95_window_chrome'
  | 'win95_taskbar';
export type WindowUiLaunchSource =
  | 'win95_desktop_ui'
  | 'win95_start_menu';
export type WindowDataSource =
  | 'win95_window_data_sync'
  | 'win95_file_delete_sync';

export interface WindowLifecycleEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface WindowStateUpdateEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface WindowDataUpdateEvidence {
  text: string;
  properties: Record<string, unknown>;
}

function supportedWindowStateEntry(value: unknown): value is number | boolean {
  return typeof value === 'number' || typeof value === 'boolean';
}

export function inferWindowStateAction(statePatch: Record<string, number | boolean>): string {
  if (statePatch.minimized === true) return 'minimize';
  if (statePatch.minimized === false && statePatch.focused === true) return 'restore_or_focus';
  if (statePatch.maximized === true) return 'maximize';
  if (statePatch.maximized === false) return 'restore_size';
  if ('x' in statePatch || 'y' in statePatch) return 'move';
  if ('width' in statePatch || 'height' in statePatch) return 'resize';
  if (statePatch.focused === true) return 'focus';
  return 'update';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function stableWindowDataValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableWindowDataValue).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableWindowDataValue(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function fingerprintText(prefix: string, value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function inferWindowDataAction(windowId: string, dataKeys: string[]): string {
  if (windowId === 'notepad' || dataKeys.includes('text')) return 'edit_text';
  if (windowId === 'paint' || dataKeys.includes('strokes')) return 'edit_paint';
  return 'update_data';
}

export function windowDataValueFingerprint(value: unknown): string {
  return fingerprintText('data', stableWindowDataValue(value));
}

export function buildWindowLifecycleEvidence(input: {
  kind: WindowLifecycleKind;
  actor: WindowEvidenceActor;
  windowId: string;
  windowType: string;
  windowTitle: string;
  source: WindowLifecycleSource;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}): WindowLifecycleEvidence {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  return {
    text: input.windowTitle,
    properties: {
      source: 'window_lifecycle_client_submit',
      lifecycleSource: input.source,
      lifecycleKind: input.kind,
      windowLifecycleId: [
        'window-lifecycle',
        input.actor,
        capturedAtMs,
        input.kind,
        input.windowId,
      ].join(':'),
      capturedAtMs,
      actor: input.actor,
      windowId: input.windowId,
      windowType: input.windowType,
      windowTitle: input.windowTitle,
      surface: input.surface,
      roomPhase: input.roomPhase,
      durableObjectReplayExpected: input.surface === 'win95',
    },
  };
}

export function buildWindowStateUpdateEvidence(input: {
  actor: WindowEvidenceActor;
  windowId: string;
  patch: Record<string, unknown>;
  source?: WindowStateSource;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}): WindowStateUpdateEvidence | null {
  const statePatch: Record<string, number | boolean> = {};
  for (const key of ['x', 'y', 'width', 'height', 'minimized', 'maximized', 'focused']) {
    const value = input.patch[key];
    if (supportedWindowStateEntry(value)) {
      statePatch[key] = value;
    }
  }

  const stateKeys = Object.keys(statePatch).sort();
  if (stateKeys.length === 0) return null;
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const action = inferWindowStateAction(statePatch);

  return {
    text: `Window state updated: ${input.windowId}`,
    properties: {
      source: 'window_state_client_submit',
      stateSource: input.source ?? 'win95_window_chrome',
      actor: input.actor,
      windowId: input.windowId,
      action,
      windowStateChangeId: [
        'window-state',
        input.actor,
        capturedAtMs,
        input.windowId,
        action,
      ].join(':'),
      capturedAtMs,
      surface: input.surface,
      roomPhase: input.roomPhase,
      statePatch,
      stateKeys,
      durableObjectReplayExpected: input.surface === 'win95',
    },
  };
}

export function buildWindowDataUpdateEvidence(input: {
  actor: WindowEvidenceActor;
  windowId: string;
  data: Record<string, unknown>;
  dataSource?: WindowDataSource;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}): WindowDataUpdateEvidence | null {
  const dataKeys = Object.keys(input.data).sort();
  if (dataKeys.length === 0) return null;
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const action = inferWindowDataAction(input.windowId, dataKeys);
  const dataValueFingerprints = Object.fromEntries(
    dataKeys.map((key) => [
      key,
      windowDataValueFingerprint(input.data[key]),
    ]),
  );

  return {
    text: `Window data updated: ${input.windowId}`,
    properties: {
      source: 'window_data_client_submit',
      dataSource: input.dataSource ?? 'win95_window_data_sync',
      actor: input.actor,
      windowId: input.windowId,
      action,
      windowDataUpdateId: [
        'window-data',
        input.actor,
        capturedAtMs,
        input.windowId,
        action,
      ].join(':'),
      capturedAtMs,
      surface: input.surface,
      roomPhase: input.roomPhase,
      dataKeys,
      dataValueFingerprints,
      durableObjectReplayExpected: input.surface === 'win95',
    },
  };
}
