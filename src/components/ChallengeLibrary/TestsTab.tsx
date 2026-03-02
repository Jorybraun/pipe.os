import { Plus, Play, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { TestCaseRow, type TestCaseData } from './TestCaseRow';

// ============================================================================
// Types
// ============================================================================

interface TestsTabProps {
  testCases: TestCaseData[];
  onAddTestCase: () => void;
  onDeleteTestCase: (id: string) => void;
  onUpdateTestCase: (id: string, field: keyof TestCaseData, value: string | boolean) => void;
  onRunTests: () => void;
  isRunning?: boolean;
  results?: Array<{ id: string; passed: boolean; output?: string; error?: string }>;
}

// ============================================================================
// Component
// ============================================================================

/**
 * TestsTab - Test case authoring and execution panel.
 * Shows a list of TestCaseRows, an "add test" button, and a "run tests" button.
 * Optionally displays test results when available.
 */
export function TestsTab({
  testCases,
  onAddTestCase,
  onDeleteTestCase,
  onUpdateTestCase,
  onRunTests,
  isRunning = false,
  results,
}: TestsTabProps): JSX.Element {
  const passCount = results ? results.filter(r => r.passed).length : 0;
  const failCount = results ? results.filter(r => !r.passed).length : 0;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(0,0,0,0.2)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.1em',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: 'Space Mono, monospace',
          }}>
            {testCases.length} TEST{testCases.length !== 1 ? 'S' : ''}
          </span>

          {/* Results summary */}
          {results && (
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 9,
                color: '#4ade80',
                fontFamily: 'Space Mono, monospace',
              }}>
                <CheckCircle2 size={11} />
                {passCount} PASSED
              </span>
              {failCount > 0 && (
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 9,
                  color: '#f87171',
                  fontFamily: 'Space Mono, monospace',
                }}>
                  <XCircle size={11} />
                  {failCount} FAILED
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onAddTestCase}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 4,
              color: 'rgba(255,255,255,0.5)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: 'Space Mono, monospace',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Plus size={11} />
            ADD TEST
          </button>

          <button
            onClick={onRunTests}
            disabled={isRunning || testCases.length === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background: isRunning ? 'rgba(74, 222, 128, 0.08)' : 'rgba(74, 222, 128, 0.12)',
              border: '1px solid rgba(74, 222, 128, 0.25)',
              borderRadius: 4,
              color: '#4ade80',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: 'Space Mono, monospace',
              cursor: isRunning || testCases.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              opacity: testCases.length === 0 ? 0.4 : 1,
            }}
          >
            {isRunning ? (
              <>
                <Clock size={11} style={{ animation: 'spin 1s linear infinite' }} />
                RUNNING...
              </>
            ) : (
              <>
                <Play size={11} />
                RUN TESTS
              </>
            )}
          </button>
        </div>
      </div>

      {/* Test cases list */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
      }}>
        {testCases.length > 0 ? (
          testCases.map((tc, i) => (
            <div key={tc.id}>
              <TestCaseRow
                testCase={tc}
                index={i}
                onDescriptionChange={(v) => onUpdateTestCase(tc.id, 'description', v)}
                onInputChange={(v) => onUpdateTestCase(tc.id, 'input', v)}
                onExpectedChange={(v) => onUpdateTestCase(tc.id, 'expectedOutput', v)}
                onToggleHidden={() => onUpdateTestCase(tc.id, 'isHidden', !tc.isHidden)}
                onDelete={() => onDeleteTestCase(tc.id)}
              />

              {/* Test result */}
              {results && (() => {
                const result = results.find(r => r.id === tc.id);
                if (!result) return null;
                return (
                  <div style={{
                    marginTop: 6,
                    padding: '8px 14px',
                    background: result.passed ? 'rgba(74, 222, 128, 0.05)' : 'rgba(248, 113, 113, 0.05)',
                    border: `1px solid ${result.passed ? 'rgba(74, 222, 128, 0.15)' : 'rgba(248, 113, 113, 0.15)'}`,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    {result.passed ? (
                      <CheckCircle2 size={12} color="#4ade80" />
                    ) : (
                      <XCircle size={12} color="#f87171" />
                    )}
                    <span style={{
                      fontSize: 10,
                      color: result.passed ? '#4ade80' : '#f87171',
                      fontFamily: 'Space Mono, monospace',
                    }}>
                      {result.passed ? 'PASSED' : 'FAILED'}
                    </span>
                    {result.output && (
                      <span style={{
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.3)',
                        fontFamily: 'Space Mono, monospace',
                        marginLeft: 8,
                      }}>
                        → {result.output}
                      </span>
                    )}
                    {result.error && (
                      <span style={{
                        fontSize: 10,
                        color: '#f87171',
                        fontFamily: 'Space Mono, monospace',
                        marginLeft: 8,
                      }}>
                        {result.error}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          ))
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
          }}>
            <Play size={32} color="rgba(255,255,255,0.06)" />
            <div style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.15)',
              fontFamily: 'Space Mono, monospace',
              textAlign: 'center',
            }}>
              No test cases yet
            </div>
            <div style={{
              fontSize: 9,
              color: 'rgba(255,255,255,0.1)',
              fontFamily: 'Space Mono, monospace',
              textAlign: 'center',
              maxWidth: 300,
              lineHeight: 1.6,
            }}>
              Add test cases to validate the candidate's solution. Hidden tests are not shown to the candidate.
            </div>
            <button
              onClick={onAddTestCase}
              style={{
                marginTop: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 4,
                color: 'rgba(255,255,255,0.5)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                fontFamily: 'Space Mono, monospace',
                cursor: 'pointer',
              }}
            >
              <Plus size={12} />
              ADD FIRST TEST
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
