---
mode: agent
description: Commit changes and create a draft pull request with comprehensive description
---
# DRAFT-PR Task

**Persona:** Execute this task as the `@developer` subagent (Devin, Staff Engineer).
Load the persona characteristics from `.rulesync/subagents/developer.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/code-quality.md` - Quality standards for pre-commit verification
- `.rulesync/rules/documentation.md` - Documentation requirements for PRs

---

## Task Objective

Commit code changes following conventional commits format, push to a feature branch, and create a well-structured draft pull request with a comprehensive description.

---

## Task Instructions

1. **Pre-commit verification:**
   - Check git status to see what files have changed
   - List all modified, added, and deleted files
   - Ask: "I see the following changes. Should I proceed with creating a PR for these changes?"

2. **Run quality checks:**

   Follow quality gates from `.rulesync/rules/code-quality.md`:

   ```bash
   npm run lint
   npm run build
   ```

   If any checks fail, report errors and ask if user wants to fix them first.
   **DO NOT proceed if quality checks fail unless explicitly instructed.**

3. **Determine commit details:**

   Ask these questions in sequence:
   1. "What type of change is this?"
      - `feat` - New feature
      - `fix` - Bug fix
      - `docs` - Documentation only
      - `refactor` - Code change that neither fixes bug nor adds feature
      - `perf` - Performance improvement
      - `test` - Adding/correcting tests
      - `chore` - Other changes
   2. "What is the scope of this change?" (e.g., auth, pipeline, ui, data, amplify)
   3. "Provide a brief description of the change"
   4. "Are there any breaking changes?" (if yes, add `!` to commit type)

4. **Generate conventional commit message:**

   Format: `<type>[scope][!]: <description>`

   Examples:
   - `feat(pipeline): add stage reordering support`
   - `fix(auth): resolve session timeout issues`
   - `feat(data)!: change pipeline schema structure` (breaking)

5. **Stage and commit changes:**
   - Stage: `git add .` (or specific files if user prefers)
   - Commit with the generated message
   - Show commit hash and message

6. **Handle branch strategy:**
   - Check current branch: `git branch --show-current`
   - If on `main` or `dev`, suggest creating feature branch: `<type>/<short-description>`
   - Ask: "Would you like to create a feature branch?"
   - Create and checkout if approved
   - If already on feature branch, proceed with push

7. **Push changes:**
   - First time: `git push -u origin <branch-name>`
   - Subsequent: `git push origin <branch-name>`
   - Show push result
   - If push fails, report error and ask how to proceed

8. **Generate PR description:**

   **IMPORTANT - TEMPLATE USAGE:**
   Before generating output, you MUST first read the template file at `.rulesync/templates-v3/pr-description-template.md`.
   Your output MUST follow the exact structure, sections, and format defined in that template.
   - Fill in all sections based on:
     - Changes made (from git diff)
     - Commit message
     - Test results
     - Documentation updates
     - Related issues/specs
   - Include screenshots if UI changes
   - Document any Amplify schema changes

9. **Create draft PR (optional):**
   - Ask: "Would you like me to create a draft PR on GitHub?"
   - If yes, use `gh pr create`:
     - Set `--draft` flag
     - Target branch: usually `main` (ask if unsure)
   - If gh not available:
     - Provide PR description formatted for copy-paste
     - Provide instructions: "Visit https://github.com/<org>/<repo>/compare/<base>...<branch>"

10. **Provide summary:**
    - Recap what was committed (commit hash, message)
    - Show the branch that was pushed
    - Show the PR URL (if created) or instructions to create it
    - Remind about follow-up actions:
      - "Run `/review` to verify all quality gates pass"
      - "Request reviews from team members"
      - "Link any related issues"
      - "Mark PR as ready for review when appropriate"

---

## Amplify-Specific Considerations

When changes include Amplify resources:

- Document schema changes in PR description
- Note any authorization rule changes
- Highlight breaking changes to data models
- Mention if sandbox testing was performed

```markdown
## Amplify Changes

### Schema Updates
- Added `Stage` model with `belongsTo` relationship to `Pipeline`
- Updated `Pipeline` authorization to include group access

### Authorization Changes
- Added `admins` group with read access to all pipelines

### Testing
- Tested in Amplify sandbox environment
- Verified schema deployment successful
```

---

## Notes

- Use conventional commits format strictly
- Ensure all quality checks pass before committing
- Keep commit messages clear and under 72 characters
- Include comprehensive PR descriptions with all relevant context
- Document Amplify-specific changes explicitly
