import { memo, type ComponentType } from 'react';
import { useInterview, type InterviewState } from '../../contexts/InterviewContext';

/**
 * HOC that connects a pure panel component to InterviewContext.
 *
 * - `Component` stays props-only (pure, reusable, testable)
 * - `useProps` is a hook that selects from context → component props
 * - Returns a memoized component that only re-renders when selected props change
 *
 * Usage:
 *   const ConnectedMonaco = connectInterview(MonacoPanel, () => {
 *     const { currentChallenge, submission, updateSubmission } = useInterview();
 *     return { language: ..., value: ..., onChange: ... };
 *   });
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function connectInterview<P extends Record<string, any>>(
  Component: ComponentType<P>,
  useProps: (ctx: InterviewState) => P,
): ComponentType {
  const Connected = memo(function Connected() {
    const ctx = useInterview();
    const props = useProps(ctx);
    return <Component {...props} />;
  });

  Connected.displayName = `Connected(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Connected;
}
