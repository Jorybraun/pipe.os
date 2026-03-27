# Plan: Navigate from ChallengeCard to ChallengeEditor

## Context

Currently, when a user clicks on a ChallengeCard in the StageDetailPage, there's an `onEdit` handler that's passed to the ChallengeCard component, but it's not properly wired up to navigate to the ChallengeEditorPage. The routing infrastructure is already in place, but the navigation action needs to be implemented.

## Approach

The implementation will be straightforward:
1. In the StageDetailPage, update the `onEdit` handler in the ChallengeCard to navigate to the ChallengeEditorPage with the correct route parameters.
2. Ensure the route parameters (pipelineId and challengeId) are correctly passed to the navigation function.

## Files to modify

- `src/pages/StageDetailPage.tsx` - Update the `onEdit` handler to navigate to the ChallengeEditorPage

## Reuse

- Existing routing infrastructure in `src/App.tsx` already has the route defined:
  ```tsx
  <Route
    path="/pipeline/:pipelineId/challenges/:challengeId"
    element={<ChallengeEditorPage />}
  />
  ```
- The `useNavigate` hook from react-router-dom is already imported and used in StageDetailPage
- The `useParams` hook is already used to get the pipeline `id`

## Steps

1. [ ] Update the `onEdit` handler in StageDetailPage to navigate to the ChallengeEditorPage with the correct parameters
2. [ ] Verify that the navigation works correctly by clicking on a ChallengeCard in the stage detail page
3. [ ] Ensure the ChallengeEditorPage loads with the correct challenge data

## Verification

1. Run the application and navigate to a stage detail page
2. Click on a ChallengeCard's edit button
3. Verify that the application navigates to the ChallengeEditorPage for that specific challenge
4. Check that the challenge data is correctly loaded in the editor