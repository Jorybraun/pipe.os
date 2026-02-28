# Changelog: PR Description Support

**Date:** 2026-02-27
**Status:** 🟢 DONE

## Summary
Added support for Pull Request descriptions in `CODE_REVIEW` challenges. This provides candidates with necessary context (the "why" behind changes) during the assessment, increasing challenge fidelity.

## Changes
- **ChallengeEditorPage.tsx**: Added Markdown-supported textarea for PR Description in the Code Review content form.
- **ProblemPanel.tsx**: Updated to render `prDescription` above instructions when available.
- **Data Flow**: PR descriptions are stored in the challenge `config` and passed to the candidate renderer.
