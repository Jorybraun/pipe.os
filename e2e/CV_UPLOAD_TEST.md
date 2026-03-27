# CV Upload and Profile Verification E2E Test

## Overview

This BDD end-to-end test verifies the complete CV upload, AI parsing, and profile display flow.

**Test file:** `e2e/cv-upload-and-profile.spec.ts`

**Feature:** CV Upload and AI Parsing with Profile Verification

## What It Tests

### 1. **Candidate Creation with CV Upload**
- ✅ Recruiter navigates to pipeline
- ✅ Opens "Add Candidate" modal
- ✅ Fills in candidate name and email
- ✅ Uploads PDF resume
- ✅ Submits intake form

### 2. **AI Parsing**
- ✅ CV file uploads to S3 successfully
- ✅ `parseCandidateCV` Lambda is triggered
- ✅ PDF text extraction works (using pdfjs-dist)
- ✅ Mistral API parses resume and extracts structured data
- ✅ Parsing step shows in UI ("PARSING" indicator)
- ✅ Confirmation step displays extracted data

### 3. **Profile Data Verification**
- ✅ Candidate profile page loads
- ✅ "AI_PARSED_PROFILE" section is visible
- ✅ Current role is populated (not "—")
- ✅ Years of experience is displayed
- ✅ Education details are shown (not "—")
- ✅ Skills are displayed as uppercase tags
- ✅ At least one skill tag is visible

### 4. **CV Download**
- ✅ "VIEW_RESUME" button is present
- ✅ Button opens PDF in new tab
- ✅ S3 presigned URL is generated correctly
- ✅ PDF filename is preserved

## Prerequisites

### 1. **Environment Setup**
```bash
# Ensure dev server and sandbox are running
npm run dev -- --port 5174    # Terminal 1
npx ampx sandbox               # Terminal 2
```

### 2. **Secrets Configuration**
```bash
# Set Mistral API key if not already set
npx ampx sandbox secret set MISTRAL_API_KEY
```

### 3. **Authentication**
The test uses authenticated sessions. Ensure you have test credentials in `.env.local`:
```env
E2E_EMAIL=braunjory@gmail.com
E2E_PASSWORD=Wrx7UB35t$
```

## Running the Test

### Run just the CV upload test
```bash
npx playwright test --project=cv-upload
```

### Run with UI (watch test execute)
```bash
npx playwright test --project=cv-upload --ui
```

### Run in debug mode (step through)
```bash
npx playwright test --project=cv-upload --debug
```

### Run all E2E tests
```bash
npx playwright test
```

## Expected Timeline

| Phase | Duration | What's Happening |
|-------|----------|------------------|
| Pipeline creation | ~2s | Creates test pipeline |
| Candidate intake | ~3s | Opens modal, fills form |
| CV upload | ~1s | Uploads PDF to S3 |
| **AI parsing** | **10-30s** | Extracts text, calls Mistral API |
| Confirmation | ~2s | Shows extracted data |
| Profile load | ~1s | Navigates to candidate profile |
| Verification | ~2s | Checks all fields |
| **Total** | **~20-40s** | Full test execution |

## What to Check If Test Fails

### 1. **Timeout on PARSING step (2 min)**
**Cause:** Lambda timeout or Mistral API slow response

**Check:**
```bash
# Check Lambda logs
aws logs tail /aws/lambda/amplify-amplifyvitereactt-parseCandidateCVlambda42-S7DM64sIIzOJ \
  --region us-east-1 --since 5m --follow
```

**Common issues:**
- `MISTRAL_API_KEY not configured` → Run `npx ampx sandbox secret set MISTRAL_API_KEY`
- `pdf-parse error` → PDF library issue (should be fixed with pdfjs-dist)
- `fetch failed` → Network issue calling Mistral API

### 2. **Profile shows "—" for all fields**
**Cause:** Lambda succeeded but didn't save data to DynamoDB

**Check:**
```bash
# Verify candidate record in DynamoDB
aws dynamodb get-item \
  --table-name <candidate-table-name> \
  --key '{"id":{"S":"<candidate-id>"}}' \
  --region us-east-1
```

**Look for:** `skills`, `currentRole`, `yearsOfExperience`, `education`, `resumeS3Key` attributes

### 3. **"No skills extracted" message**
**Cause:** Mistral API returned empty skills array

**Check Lambda logs for:**
- "LLM output text:" → See what Mistral returned
- "Successfully parsed:" → Check parsed JSON structure

### 4. **VIEW_RESUME button doesn't open PDF**
**Cause:** S3 presigned URL generation failed

**Check:**
- S3 bucket has correct permissions
- `resumeS3Key` is saved correctly
- `getUrl()` has proper IAM permissions

## Test Output

### Success ✅
```
✓ Given: recruiter creates a test pipeline (2.1s)
✓ Scenario: recruiter uploads CV and sees parsed data on profile (28.4s)

[TEST] Created pipeline: a1b2c3d4-...
[TEST] CV upload successful, waiting for AI parsing...
[TEST] AI parsing complete, confirmation step appeared
[TEST] Navigated to candidate profile: e5f6g7h8-...
[TEST] Current role: Senior Software Engineer
[TEST] Found 10 skill tags
[TEST] Resume opened in new tab: https://s3.amazonaws.com/...
[TEST] ✓ CV upload and profile verification complete

2 passed (30.5s)
```

### Failure ❌
```
✗ Scenario: recruiter uploads CV and sees parsed data on profile (122.3s)

TimeoutError: locator.waitFor: Timeout 120000ms exceeded.
  waiting for getByText('CONFIRM')

[BROWSER ERROR] Failed to parse resume data from AI response
[TEST] AI parsing timeout - check Lambda logs
```

## Debugging Tips

### 1. **Take screenshots on failure**
Screenshots are automatically saved to `test-results/` on failure.

### 2. **Watch the test in UI mode**
```bash
npx playwright test --project=cv-upload --ui
```
This lets you see exactly where it fails.

### 3. **Check browser console logs**
The test captures console errors:
```
[BROWSER ERROR] message from browser console
[PAGE ERROR] JavaScript errors
```

### 4. **Run with headed browser**
```bash
npx playwright test --project=cv-upload --headed
```
Watch the test execute in a real browser window.

## Continuous Integration

To run in CI:
```yaml
# .github/workflows/e2e.yml
- name: Run CV upload E2E test
  run: npx playwright test --project=cv-upload
  env:
    E2E_EMAIL: ${{ secrets.E2E_EMAIL }}
    E2E_PASSWORD: ${{ secrets.E2E_PASSWORD }}
```

## Maintenance

### Update test when schema changes
If you add new fields to the Candidate model:

1. Update DynamoDB write in `parseCandidateCV/handler.ts`
2. Update profile display in `CandidateProfilePage.tsx`
3. Update test assertions in `cv-upload-and-profile.spec.ts`

### Update fixture PDF
To change the test resume:
1. Replace `e2e/fixtures/test-resume.pdf`
2. Update expected values in test assertions
3. Re-run test to verify

## Related Files

- **Test:** `e2e/cv-upload-and-profile.spec.ts`
- **Fixture:** `e2e/fixtures/test-resume.pdf`
- **Lambda:** `amplify/functions/parseCandidateCV/handler.ts`
- **Page:** `src/pages/CandidateProfilePage.tsx`
- **Modal:** `src/components/Candidate/CandidateIntakeModal.tsx`
- **Config:** `playwright.config.ts`
