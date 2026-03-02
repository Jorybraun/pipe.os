import { ChallengeListSidebar } from '../components/ChallengeLibrary/ChallengeListSidebar';
import { ChallengeWorkspace } from '../components/ChallengeLibrary/ChallengeWorkspace';
import { EmptyWorkspace } from '../components/ChallengeLibrary/EmptyWorkspace';
import { InstructionsTab } from '../components/ChallengeLibrary/InstructionsTab';
import { CodeTab } from '../components/ChallengeLibrary/CodeTab';
import { TestsTab } from '../components/ChallengeLibrary/TestsTab';
import { PreviewTab } from '../components/ChallengeLibrary/PreviewTab';
import type { ChallengeListItemData } from '../components/ChallengeLibrary/ChallengeListItem';
import type { FileTabData } from '../components/ChallengeLibrary/FileTabBar';
import type { TestCaseData } from '../components/ChallengeLibrary/TestCaseRow';

// ============================================================================
// Mock data — will be replaced with Amplify data + state management
// ============================================================================

const MOCK_CHALLENGES: ChallengeListItemData[] = [
  {
    id: '1',
    title: 'Two Sum',
    type: 'CODE_IMPLEMENTATION',
    language: 'TypeScript',
    difficulty: 'EASY',
    timeEstimate: 15,
    tags: ['arrays', 'hash-map'],
  },
  {
    id: '2',
    title: 'Fix the useEffect Hook',
    type: 'CODE_REVIEW',
    language: 'TypeScript',
    difficulty: 'MEDIUM',
    timeEstimate: 10,
    tags: ['react', 'hooks', 'bugs'],
  },
  {
    id: '3',
    title: 'Build a Counter Component',
    type: 'CODE_IMPLEMENTATION',
    language: 'TypeScript',
    difficulty: 'EASY',
    timeEstimate: 20,
    tags: ['react', 'state', 'components'],
  },
  {
    id: '4',
    title: 'JavaScript Event Loop',
    type: 'QUIZ_MCQ',
    difficulty: 'MEDIUM',
    timeEstimate: 5,
    tags: ['javascript', 'async'],
  },
  {
    id: '5',
    title: 'Explain Closures',
    type: 'QUIZ_SHORT_ANSWER',
    difficulty: 'MEDIUM',
    timeEstimate: 5,
    tags: ['javascript', 'fundamentals'],
  },
  {
    id: '6',
    title: 'Debounce Function',
    type: 'CODE_IMPLEMENTATION',
    language: 'TypeScript',
    difficulty: 'MEDIUM',
    timeEstimate: 20,
    tags: ['utilities', 'timing'],
  },
  {
    id: '7',
    title: 'Review: Promise.all Handling',
    type: 'CODE_REVIEW',
    language: 'TypeScript',
    difficulty: 'HARD',
    timeEstimate: 15,
    tags: ['async', 'error-handling'],
  },
];

const MOCK_FILES: FileTabData[] = [
  { id: 'f1', name: 'solution.ts', language: 'typescript', isEntryPoint: true },
  { id: 'f2', name: 'helpers.ts', language: 'typescript' },
  { id: 'f3', name: 'types.ts', language: 'typescript' },
];

const MOCK_TEST_CASES: TestCaseData[] = [
  { id: 't1', description: 'Basic case with two numbers', input: '[2, 7, 11, 15], 9', expectedOutput: '[0, 1]', isHidden: false },
  { id: 't2', description: 'No valid pair exists', input: '[1, 2, 3], 10', expectedOutput: '[]', isHidden: false },
  { id: 't3', description: 'Hidden: negative numbers', input: '[-1, -2, -3, -4], -6', expectedOutput: '[1, 3]', isHidden: true },
];

const MOCK_CODE = `function twoSum(nums: number[], target: number): number[] {
  const map = new Map<number, number>();
  
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (map.has(complement)) {
      return [map.get(complement)!, i];
    }
    map.set(nums[i], i);
  }
  
  return [];
}`;

const MOCK_MARKDOWN = `# Two Sum

Given an array of integers \`nums\` and an integer \`target\`, return indices of the two numbers such that they add up to \`target\`.

## Constraints

- Each input has **exactly one solution**
- You may not use the same element twice
- Return the answer in any order

## Examples

\`\`\`
Input: nums = [2,7,11,15], target = 9
Output: [0,1]
Explanation: nums[0] + nums[1] == 9
\`\`\`
`;

// ============================================================================
// Component
// ============================================================================

/**
 * ChallengeLibraryPage — Master-detail view for browsing and editing challenges.
 *
 * Left panel: Searchable, filterable list of challenges.
 * Right panel: Workspace with tabbed editing (Instructions, Code, Tests, Preview).
 *
 * NOTE: This is the stateless visual shell. All interactivity is stubbed with
 * mock data and no-op callbacks. State management will be wired in a follow-up.
 */
export default function ChallengeLibraryPage(): JSX.Element {
  // Hardcoded visual state — will be replaced with useState/useReducer
  const selectedId: string | null = '1';
  const searchQuery = '';
  const activeFilter = 'ALL' as const;
  const activeTab: string = 'instructions';

  const selectedChallenge = MOCK_CHALLENGES.find((c) => c.id === selectedId);

  // No-op handlers
  const noop = (): void => undefined;
  const noopStr = (_s: string): void => undefined;

  // Render the active tab content
  function renderTabContent(): JSX.Element {
    switch (activeTab) {
      case 'instructions':
        return (
          <InstructionsTab
            markdown={MOCK_MARKDOWN}
            mode="split"
            onModeChange={noop}
            onMarkdownChange={noopStr}
            onUploadClick={noop}
          />
        );
      case 'code':
        return (
          <CodeTab
            files={MOCK_FILES}
            activeFileId="f1"
            activeFileContent={MOCK_CODE}
            activeFileLanguage="typescript"
            onFileSelect={noopStr}
            onFileClose={noopStr}
            onAddFile={noop}
            onFileSettings={noopStr}
            onContentChange={noopStr}
          />
        );
      case 'tests':
        return (
          <TestsTab
            testCases={MOCK_TEST_CASES}
            onAddTestCase={noop}
            onDeleteTestCase={noopStr}
            onUpdateTestCase={noop as never}
            onRunTests={noop}
            isRunning={false}
          />
        );
      case 'preview':
        return (
          <PreviewTab
            mode="browser"
            onModeChange={noop as never}
            onRun={noop}
            onRefresh={noop}
            isRunning={false}
          />
        );
      default:
        return (
          <InstructionsTab
            markdown={MOCK_MARKDOWN}
            mode="split"
            onModeChange={noop}
            onMarkdownChange={noopStr}
            onUploadClick={noop}
          />
        );
    }
  }

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 64px)',
      width: '100%',
      overflow: 'hidden',
      background: '#0c0c0e',
    }}>
      {/* Left panel — Challenge list */}
      <ChallengeListSidebar
        challenges={MOCK_CHALLENGES}
        selectedId={selectedId}
        searchQuery={searchQuery}
        activeFilter={activeFilter}
        onSelect={noopStr}
        onSearchChange={noopStr}
        onFilterChange={noop as never}
        onCreateNew={noop}
      />

      {/* Divider */}
      <div style={{
        width: 1,
        background: 'rgba(255,255,255,0.04)',
        flexShrink: 0,
      }} />

      {/* Right panel — Workspace or empty state */}
      {selectedChallenge ? (
        <ChallengeWorkspace
          title={selectedChallenge.title}
          type={selectedChallenge.type}
          language={selectedChallenge.language}
          difficulty={selectedChallenge.difficulty}
          timeEstimate={selectedChallenge.timeEstimate}
          tags={selectedChallenge.tags}
          activeTab={activeTab}
          onTabChange={noopStr}
          onPreview={noop}
        >
          {renderTabContent()}
        </ChallengeWorkspace>
      ) : (
        <EmptyWorkspace />
      )}
    </div>
  );
}
