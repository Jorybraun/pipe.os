# {{Conventional Commit Message as Title}}

## Summary

{{Brief 2-3 sentence description of what this PR does and why it's needed}}

## Related Issues

{{List related issues, specs, or documentation}}

- Closes #{{issue-number}}
- Related to #{{issue-number}}
- Implements [Technical Spec: {{spec-name}}](/docs/specs/{{spec-name}}.md)

## Changes Made

### {{Area/Module Name}}

- {{Change 1 - be specific}}
- {{Change 2 - be specific}}
- {{Change 3 - be specific}}

### {{Another Area/Module}}

- {{Change 1}}
- {{Change 2}}

### Files Changed

**Added:**

- `{{path/to/new/file.ts}}` - {{Brief description}}
- `{{path/to/another/file.test.ts}}` - {{Brief description}}

**Modified:**

- `{{path/to/existing/file.ts}}` - {{What changed}}
- `{{path/to/another/file.tsx}}` - {{What changed}}

**Deleted:**

- `{{path/to/removed/file.ts}}` - {{Why removed}}

## Amplify Changes

{{If backend changes, describe them here. Otherwise remove this section.}}

### Schema Updates

```typescript
// Changes to amplify/data/resource.ts
{{Schema changes}}
```

### Authorization Changes

- {{Authorization change 1}}
- {{Authorization change 2}}

### New AWS Resources

- {{Resource 1}} - {{Description}}
- {{Resource 2}} - {{Description}}

## Testing

### Unit Tests (Vitest)

- {{What was tested}}
- Test file: `{{path/to/test.test.ts}}`
- All tests passing: `npm run test`

### Component Tests (Storybook)

- {{What components were documented}}
- Stories file: `{{path/to/stories.stories.tsx}}`
- View in Storybook: `npm run storybook`

### E2E Tests (Playwright)

- {{What user flows were tested}}
- Test file: `{{e2e/feature.spec.ts}}`
- All tests passing: `npm run test:e2e`

### Manual Testing

{{Describe any manual testing performed}}

1. {{Step 1}}
2. {{Step 2}}
3. {{Step 3}}

**Verified on:**

- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Mobile (responsive)

## Screenshots / Videos

{{If UI changes, add before/after screenshots or videos}}

### Before

{{Screenshot or description of previous state}}

### After

{{Screenshot or description of new state}}

## Documentation

- [ ] Code includes inline comments explaining complex logic
- [ ] All functions have JSDoc comments
- [ ] Storybook stories document component usage
- [ ] README updated (if applicable)

**Updated Documentation:**

- {{Link to updated README or docs}}

## Breaking Changes

{{If there are breaking changes, describe them here. Otherwise remove this section.}}

### What's Breaking

- {{Breaking change 1}}
- {{Breaking change 2}}

### Migration Guide

**Before:**

```typescript
{{old-api-usage}}
```

**After:**

```typescript
{{new-api-usage}}
```

## Security Considerations

{{Describe any security implications, or remove this section}}

- {{Security consideration 1}}
- {{Security consideration 2}}

## Performance Impact

{{Describe any performance implications, or remove this section}}

- {{Performance change 1}}
- {{Performance change 2}}

**Metrics:**

- {{Metric before}} -> {{Metric after}}

## Known Issues / Limitations

{{List any known issues or limitations, or remove this section}}

- {{Issue 1}} - {{Plan to address}}
- {{Issue 2}} - {{Plan to address}}

## Checklist

### Code Quality

- [ ] Code follows project style guidelines
- [ ] No `console.log` or debug statements
- [ ] No `any` types used
- [ ] Error handling implemented
- [ ] Sensitive data redacted from logs
- [ ] Imports properly ordered

### Amplify Patterns

- [ ] Authorization rules defined in schema
- [ ] Amplify Data client used with proper types
- [ ] Real-time subscriptions cleaned up on unmount
- [ ] API errors handled (data/errors destructuring)

### Testing

- [ ] Unit tests written and passing (Vitest)
- [ ] Component stories created (Storybook)
- [ ] E2E tests written and passing (Playwright)
- [ ] Edge cases covered
- [ ] Error states tested

### Documentation

- [ ] JSDoc added to all exported functions
- [ ] Inline comments explain complex logic
- [ ] Storybook stories document components

### Quality Checks

- [ ] `npm run lint` passes with no errors
- [ ] `npm run build` passes with no errors
- [ ] `npm run test` passes
- [ ] `npm run test:e2e` passes (if applicable)

### UI/UX (if applicable)

- [ ] Responsive design verified
- [ ] Loading states implemented
- [ ] Error states implemented
- [ ] Accessibility checked (WCAG 2.1 AA)
- [ ] AWS Amplify UI components used correctly

### Deployment

- [ ] Environment variables documented (if added)
- [ ] Amplify backend changes tested in sandbox
- [ ] No merge conflicts with base branch

## Review Focus Areas

{{Highlight specific areas that need extra attention from reviewers}}

- **{{Area 1}}**: {{Why this needs extra attention}}
- **{{Area 2}}**: {{Why this needs extra attention}}

## Deployment Notes

{{Any special considerations for deployment, or remove this section}}

- {{Deployment note 1}}
- {{Deployment note 2}}

**Rollback Plan:**
{{How to rollback if issues arise}}

## Additional Context

{{Any other context, decisions, or information reviewers should know}}

---

## Reviewer Guidelines

When reviewing this PR, please:

1. Check that all checklist items are completed
2. Verify tests are comprehensive and passing
3. Review Amplify schema changes for authorization gaps
4. Check for security vulnerabilities
5. Verify Storybook stories document components well
6. Test the feature manually if possible
7. Provide constructive feedback
