import type { CSSProperties } from 'react';

export const RECRUITER_FONT = '"Space Mono", monospace';

export const recruiterPageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  width: '100%',
  maxWidth: 1180,
  margin: '0 auto',
  padding: 22,
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-elevated)',
  boxShadow: '0 24px 80px var(--pipe-shadow)',
};

export const recruiterHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 22,
  paddingBottom: 24,
  borderBottom: '1px solid var(--pipe-border)',
  flexWrap: 'wrap',
};

export const recruiterSectionStyle: CSSProperties = {
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
};

export const recruiterSectionTitleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 16,
  color: 'var(--pipe-text)',
  fontFamily: RECRUITER_FONT,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

export const recruiterFieldLabelStyle: CSSProperties = {
  marginBottom: 5,
  color: 'var(--pipe-text-dim)',
  fontFamily: RECRUITER_FONT,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

export const recruiterFieldValueStyle: CSSProperties = {
  minWidth: 0,
  overflowWrap: 'anywhere',
  color: 'var(--pipe-text)',
  fontSize: 13,
  lineHeight: 1.5,
};

export const recruiterEyebrowStyle: CSSProperties = {
  marginBottom: 8,
  color: 'var(--pipe-text-dim)',
  fontFamily: RECRUITER_FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
};

export const recruiterTitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontSize: 32,
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: 0,
  overflowWrap: 'anywhere',
};

export const recruiterSubtitleStyle: CSSProperties = {
  marginTop: 8,
  color: 'var(--pipe-text-dim)',
  fontFamily: RECRUITER_FONT,
  fontSize: 12,
  lineHeight: 1.5,
};

export const recruiterBackButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  width: 'fit-content',
  border: 'none',
  background: 'transparent',
  color: 'var(--pipe-text-dim)',
  cursor: 'pointer',
  fontFamily: RECRUITER_FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.12em',
  padding: 0,
};

export const recruiterPrimaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 6,
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  cursor: 'pointer',
  fontFamily: RECRUITER_FONT,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
};

export const recruiterTextButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--pipe-accent)',
  cursor: 'pointer',
  fontFamily: RECRUITER_FONT,
  fontSize: 12,
  fontWeight: 700,
};

export const recruiterInlineLinkStyle: CSSProperties = {
  color: 'var(--pipe-accent)',
  textDecoration: 'none',
  overflowWrap: 'anywhere',
};

export const recruiterTagStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: '100%',
  padding: '5px 8px',
  borderRadius: 999,
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  fontFamily: RECRUITER_FONT,
  fontSize: 10,
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
};

export const recruiterInsetCardStyle: CSSProperties = {
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
  padding: 12,
};

export const recruiterEmptyTextStyle: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontFamily: RECRUITER_FONT,
  fontSize: 12,
};
