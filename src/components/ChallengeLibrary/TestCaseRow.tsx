import { Trash2 } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface TestCaseData {
  id: string;
  description: string;
  input: string;
  expectedOutput: string;
  isHidden?: boolean;
}

interface TestCaseRowProps {
  testCase: TestCaseData;
  index: number;
  onDescriptionChange: (value: string) => void;
  onInputChange: (value: string) => void;
  onExpectedChange: (value: string) => void;
  onToggleHidden: () => void;
  onDelete: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * TestCaseRow - A single test case editor row.
 * Shows description, input, expected output fields, a hidden toggle, and delete button.
 */
export function TestCaseRow({
  testCase,
  index,
  onDescriptionChange,
  onInputChange,
  onExpectedChange,
  onToggleHidden,
  onDelete,
}: TestCaseRowProps): JSX.Element {
  return (
    <div style={{
      background: 'rgba(0,0,0,0.2)',
      border: '1px solid rgba(255,255,255,0.04)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 14px',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.1em',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: 'Space Mono, monospace',
          }}>
            TEST_{String(index + 1).padStart(2, '0')}
          </span>

          {testCase.isHidden && (
            <span style={{
              fontSize: 7,
              fontWeight: 800,
              padding: '2px 6px',
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.2)',
              borderRadius: 2,
              color: '#fbbf24',
              letterSpacing: '0.1em',
              fontFamily: 'Space Mono, monospace',
            }}>
              HIDDEN
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={onToggleHidden}
            title={testCase.isHidden ? 'Make visible' : 'Hide from candidate'}
            style={{
              padding: '3px 8px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 3,
              color: 'rgba(255,255,255,0.25)',
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: 'Space Mono, monospace',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {testCase.isHidden ? 'SHOW' : 'HIDE'}
          </button>

          <button
            onClick={onDelete}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 3,
              color: 'rgba(255,255,255,0.2)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Fields */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 14,
      }}>
        {/* Description */}
        <div>
          <label style={{
            display: 'block',
            fontSize: 8,
            letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.2)',
            fontFamily: 'Space Mono, monospace',
            marginBottom: 6,
          }}>
            DESCRIPTION
          </label>
          <input
            value={testCase.description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="e.g., Should return the sum of two numbers"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 4,
              color: 'rgba(255,255,255,0.7)',
              fontSize: 11,
              fontFamily: 'Space Mono, monospace',
              outline: 'none',
            }}
          />
        </div>

        {/* Input + Expected side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: 8,
              letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.2)',
              fontFamily: 'Space Mono, monospace',
              marginBottom: 6,
            }}>
              INPUT
            </label>
            <textarea
              value={testCase.input}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder="add(2, 3)"
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 4,
                color: '#4ade80',
                fontSize: 11,
                fontFamily: 'Space Mono, monospace',
                lineHeight: 1.5,
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 8,
              letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.2)',
              fontFamily: 'Space Mono, monospace',
              marginBottom: 6,
            }}>
              EXPECTED_OUTPUT
            </label>
            <textarea
              value={testCase.expectedOutput}
              onChange={(e) => onExpectedChange(e.target.value)}
              placeholder="5"
              rows={3}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 4,
                color: '#60a5fa',
                fontSize: 11,
                fontFamily: 'Space Mono, monospace',
                lineHeight: 1.5,
                resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
