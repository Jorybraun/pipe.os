import type { LivingContextRecord } from './api/types';

export function titleCaseSemanticLabel(value: string): string {
  return value
    .replace(/[_:-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function displaySemanticLabel(value: string): string {
  return titleCaseSemanticLabel(value.toLowerCase());
}

export function firstReadableSentence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(.+?[.!?])(?:\s+|$)/);
  return (match?.[1] ?? trimmed).slice(0, 140);
}

export function isMachineSemanticKey(value: string): boolean {
  return /^[A-Z0-9_:-]+$/.test(value) || value.includes('_') || value.length > 80;
}

export function contextRecordTitle(record: LivingContextRecord): string {
  const predicate = record.predicate ?? record.recordType;
  return isMachineSemanticKey(predicate)
    ? firstReadableSentence(record.narrative) || displaySemanticLabel(record.recordType)
    : displaySemanticLabel(predicate);
}

export function contextRecordTypeLabel(record: LivingContextRecord): string {
  return displaySemanticLabel(record.recordType);
}
