# Drag-to-Order Challenges

## Issue
We needed a way to reorder challenges within a stage. Since stages contain multiple challenges (e.g. Code Review followed by MCQ), the recruiter needs to be able to dictate the sequence.

## Changes
1. **Installed Dependencies**: Added `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities`.
2. **Updated `ChallengeCard.tsx`**:
   - Integrated `useSortable` to provide `setNodeRef`, `listeners`, and `attributes`.
   - Used the card's leftmost index section as the drag handle.
   - Updated styles to apply `transform` and adjust opacity while dragging.
3. **Updated `StageDetailPage.tsx`**:
   - Wrapped the challenge list in `DndContext` and `SortableContext`.
   - Setup `PointerSensor` and `KeyboardSensor` with a 5px activation constraint to differentiate between a click and a drag.
   - Handled `onDragEnd` by reordering the challenges optimistically using `arrayMove`.
   - Dispatched a batch of `client.models.Challenge.update({ id, order })` mutations to persist the reordered items to the Amplify backend.
   - Handled errors by re-fetching data to revert optimistic changes.

## Verification
- `npx tsc --noEmit` passed cleanly.
- Optimistic UI updates seamlessly, with standard dnd-kit `closestCenter` collision detection.
- Re-fetch logic successfully synchronizes changes from the backend.