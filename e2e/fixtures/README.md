# E2E Test Fixtures

This directory contains test files used in end-to-end tests.

## Files

### test-resume.pdf
A sample resume PDF used in the CV upload and parsing test (`cv-upload-and-profile.spec.ts`).

**Contents:**
- Name: John Smith
- Role: Senior Software Engineer
- Experience: 8 years
- Skills: JavaScript, TypeScript, React, Node.js, AWS, Python, Docker, Kubernetes
- Education: B.S. Computer Science, UC Berkeley

This file tests the complete CV upload flow:
1. File upload during candidate intake
2. S3 storage
3. AI parsing via Mistral API
4. Profile data extraction (skills, role, experience, education)
5. CV download functionality

## Adding New Fixtures

To add new test files:

1. **PDF resumes:** Add to this directory with descriptive names
2. **Expected data:** Update test assertions to match the CV content
3. **Update tests:** Reference the fixture path in your spec files

Example:
```typescript
const testPdfPath = join(process.cwd(), 'e2e/fixtures/test-resume.pdf');
await fileInput.setInputFiles(testPdfPath);
```

## Generating Test PDFs

If you need to create a new test PDF from scratch:

```bash
# Using wkhtmltopdf (if installed)
wkhtmltopdf test-resume.html test-resume.pdf

# Or convert from text using LibreOffice
libreoffice --headless --convert-to pdf test-resume.txt
```
