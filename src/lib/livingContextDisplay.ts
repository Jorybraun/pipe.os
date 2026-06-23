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
  const trimmed = value.trim();
  if (!trimmed) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  const hasLetters = letters.length > 0;
  const isAllCapsPhrase = hasLetters && letters === letters.toUpperCase() && letters.length > 8;
  return /^[A-Z0-9_:-]+$/.test(trimmed)
    || trimmed.includes('_')
    || trimmed.length > 80
    || isAllCapsPhrase;
}

export function contextRecordTitle(record: LivingContextRecord): string {
  const predicate = record.predicate ?? record.recordType;
  const narrativeTitle = firstReadableSentence(record.narrative);
  return isMachineSemanticKey(predicate)
    ? !isMachineSemanticKey(narrativeTitle) && narrativeTitle
      ? narrativeTitle
      : displaySemanticLabel(predicate)
    : displaySemanticLabel(predicate);
}

export function contextRecordNarrative(record: LivingContextRecord): string {
  const narrative = record.narrative.trim();
  if (!narrative) return '';
  return isMachineSemanticKey(narrative)
    ? displaySemanticLabel(narrative)
    : narrative;
}

export function contextRecordTypeLabel(record: LivingContextRecord): string {
  return displaySemanticLabel(record.recordType);
}
