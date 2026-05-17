# Founder Interview: PIPE Product Overview

**Date:** 2026-05-16
**Interviewer:** Business Requirements Agent
**Interviewee:** Hans (Founder)
**Status:** Complete

---

## Section 1: The Elevator Pitch

**Q1. In one sentence: What is PIPE? What does it do?**

> Pipe is an AI-native hiring pipeline that assesses candidates' ability to reason and read.

---

## Section 2: Current State — What Works vs. What Doesn't

**Q2. Which assessment types are real, which are vapor, and which matter most?**

> None of them work E2E today.
> - Code review is not matching
> - Open source has no repo or anything behind it
> - Culture interview: unclear status, "really lacking"
> - All plans are in knowledge/plan

**Q3. What DOES exist? What's closest to working?**

> Honestly nothing actually works yet. It's a mess.

---

## Section 3: The MVP — What "Working" Means

**Q4. If you had to ship ONE thing in the next 2 weeks, what would it be?**

> A full 3-stage interview E2E: code review, culture, screener.
> But the actual flow is:
> **Screener + Culture → Filtered based on role → Email → Code Review**
> 
> Code review means candidate is matched to a repo based on their living graph, a challenge is created, and they can actually be assessed.
> 
> Need 3 code reviews (multi-PR) to get any real signal.
> 
> Repo matching is super important and hasn't been seen working yet.

---

## Section 4: The Flow — Step by Step

**Q5. Screener + Culture → Filtered → Email → Code Review. What does each step mean?**

### Screener + Culture

> Should probably be back-to-back. No need to make candidates wait.
> 
> Culture interview should assess: how candidates use their skills, where they use them — validating what they claim on their CV.
> 
> Culture interview is currently "really lacking."

### Filtering

> The vision: build a candidate graph from resume + GitHub + culture interview, then do similarity matching against the role.
> 
> Reality: this is hard. Probably all candidates should move forward for now, or at least a certain threshold.

### Email

> Automated emails after each stage, but this should be configurable.
> 
> Code review email might need a delay because custom challenges take time to generate.
> 
> If stages are back-to-back, maybe no email needed between them.

### Code Review

> Every candidate gets a **custom code review with brand new bugs** — personalized to them.
> 
> Scoring happens automatically on submission.
> 
> Need 3 PRs (multi-PR) for reliable signal.

### Recruiter Dashboard

> Haven't thought about this in detail.
> 
> Should show ranked candidates by relevance — recruiter makes the final decision, not the system.

---

## Key Business Requirements Extracted

1. **3-stage interview flow**: Screener → Culture → Code Review (back-to-back where possible)
2. **Culture interview validates resume skills**: How/where candidates use their claimed skills
3. **Custom code review challenges**: Per-candidate, with fresh bugs (not reused content)
4. **Multi-PR code review**: 3 PRs per candidate for reliable signal
5. **Repo matching**: Match candidate to repo based on living graph (resume + GitHub + culture)
6. **Automated scoring**: On submission for code review; culture scoring TBD
7. **Automated emails**: After each stage, configurable, with potential delay for code review (generation time)
8. **Recruiter sees ranked candidates**: Not final decisions; human makes the hire
9. **Filtering**: Vision is graph-based similarity; reality is probably pass-all for now
10. **Content freshness**: Every candidate gets new bugs; no content reuse

---

## Tensions / Unresolved Questions

- Culture interview scoring model is undefined
- Filtering logic is undefined (pass-all vs. threshold vs. graph similarity)
- Recruiter dashboard is undefined
- Email timing (back-to-back vs. delayed) needs configuration
- Custom challenge generation pipeline is vapor
- Culture interview lacks clear requirements

