import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

export interface Annotation {
  id?: string;
  file: string;
  line: number;
  severity: 'critical' | 'major' | 'minor';
  comment: string;
}

export interface GroundTruthAnnotationEditorProps {
  initialAnnotations?: {
    senior?: Annotation[];
    mid?: Annotation[];
    junior?: Annotation[];
  };
  onAnnotationsChange: (annotations: {
    senior: Annotation[];
    mid: Annotation[];
    junior: Annotation[];
  }) => void;
}

const REVIEWER_LEVELS = ['senior', 'mid', 'junior'] as const;
const SEVERITY_LEVELS = [
  { value: 'critical', label: 'CRITICAL', color: '#f87171' },
  { value: 'major', label: 'MAJOR', color: '#fbbf24' },
  { value: 'minor', label: 'MINOR', color: '#60a5fa' },
] as const;

/**
 * GroundTruthAnnotationEditor Component
 * 
 * Allows admins to define expected annotations for each reviewer level.
 * These are used for scoring candidate reviews.
 */
export function GroundTruthAnnotationEditor({
  initialAnnotations = { senior: [], mid: [], junior: [] },
  onAnnotationsChange,
}: GroundTruthAnnotationEditorProps): JSX.Element {
  const [annotations, setAnnotations] = useState<{
    senior: Annotation[];
    mid: Annotation[];
    junior: Annotation[];
  }>({
    senior: (initialAnnotations?.senior || []),
    mid: (initialAnnotations?.mid || []),
    junior: (initialAnnotations?.junior || []),
  });
  const [expandedLevels, setExpandedLevels] = useState<Set<string>>(
    new Set(['senior', 'mid', 'junior'])
  );

  useEffect(() => {
    onAnnotationsChange(annotations);
  }, [annotations]);

  const toggleLevel = (level: string) => {
    const newExpanded = new Set(expandedLevels);
    if (newExpanded.has(level)) {
      newExpanded.delete(level);
    } else {
      newExpanded.add(level);
    }
    setExpandedLevels(newExpanded);
  };

  const handleAddAnnotation = (level: 'senior' | 'mid' | 'junior') => {
    const newAnnotation: Annotation = {
      id: `${level}-${Date.now()}`,
      file: '',
      line: 1,
      severity: 'major',
      comment: '',
    };
    setAnnotations({
      ...annotations,
      [level]: [...(annotations[level] || []), newAnnotation],
    });
  };

  const handleRemoveAnnotation = (
    level: 'senior' | 'mid' | 'junior',
    annotationId: string | undefined
  ) => {
    setAnnotations({
      ...annotations,
      [level]: (annotations[level] || []).filter((a) => a.id !== annotationId),
    });
  };

  const handleAnnotationChange = (
    level: 'senior' | 'mid' | 'junior',
    annotationId: string | undefined,
    field: keyof Annotation,
    value: any
  ) => {
    setAnnotations({
      ...annotations,
      [level]: (annotations[level] || []).map((a) =>
        a.id === annotationId ? { ...a, [field]: value } : a
      ),
    });
  };

  const levelLabels: Record<string, string> = {
    senior: 'SENIOR REVIEWER',
    mid: 'MID-LEVEL REVIEWER',
    junior: 'JUNIOR REVIEWER',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'Space Mono', fontWeight: 700, letterSpacing: '0.2em', marginBottom: 20 }}>
          EXPECTED_ANNOTATIONS
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
          Define what annotations each reviewer level should find. These will be used to score candidate reviews.
        </div>
      </div>

      {REVIEWER_LEVELS.map((level) => {
        const levelAnnotations = annotations[level] || [];
        const isExpanded = expandedLevels.has(level);

        return (
          <div
            key={level}
            style={{
              background: 'rgba(12, 12, 14, 0.5)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Level Header */}
            <button
              onClick={() => toggleLevel(level)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent',
                border: 'none',
                borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {isExpanded ? (
                  <ChevronUp size={14} color="rgba(255,255,255,0.3)" />
                ) : (
                  <ChevronDown size={14} color="rgba(255,255,255,0.3)" />
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'Space Mono', color: '#fff' }}>
                    {levelLabels[level]}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      fontFamily: 'Space Mono',
                      color: 'rgba(255,255,255,0.3)',
                      background: 'rgba(255,255,255,0.05)',
                      padding: '4px 8px',
                      borderRadius: 3,
                    }}
                  >
                    {levelAnnotations.length} ANNOTATIONS
                  </div>
                </div>
              </div>
            </button>

            {/* Level Content */}
            {isExpanded && (
              <div style={{ padding: '20px' }}>
                {levelAnnotations.length === 0 ? (
                  <div
                    style={{
                      padding: '20px',
                      textAlign: 'center',
                      background: 'rgba(0, 0, 0, 0.2)',
                      borderRadius: 4,
                      border: '1px dashed rgba(255,255,255,0.1)',
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.3)',
                        fontFamily: 'Space Mono',
                      }}
                    >
                      No annotations yet
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                    {levelAnnotations.map((annotation, _idx) => (
                      <div
                        key={annotation.id}
                        style={{
                          padding: 16,
                          background: 'rgba(0, 0, 0, 0.2)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          borderRadius: 4,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                        }}
                      >
                        {/* First Row: File and Line */}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <label
                              style={{
                                fontSize: 9,
                                color: 'rgba(255,255,255,0.3)',
                                fontFamily: 'Space Mono',
                                display: 'block',
                                marginBottom: 4,
                              }}
                            >
                              FILE_PATH
                            </label>
                            <input
                              type="text"
                              value={annotation.file}
                              onChange={(e) =>
                                handleAnnotationChange(level, annotation.id, 'file', e.target.value)
                              }
                              placeholder="src/services/email.py"
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                background: 'rgba(0, 0, 0, 0.3)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 3,
                                color: '#fff',
                                fontSize: 11,
                                fontFamily: 'Space Mono',
                                outline: 'none',
                              }}
                            />
                          </div>
                          <div style={{ width: 80 }}>
                            <label
                              style={{
                                fontSize: 9,
                                color: 'rgba(255,255,255,0.3)',
                                fontFamily: 'Space Mono',
                                display: 'block',
                                marginBottom: 4,
                              }}
                            >
                              LINE_#
                            </label>
                            <input
                              type="number"
                              value={annotation.line}
                              onChange={(e) =>
                                handleAnnotationChange(level, annotation.id, 'line', parseInt(e.target.value, 10))
                              }
                              min="1"
                              style={{
                                width: '100%',
                                padding: '8px 12px',
                                background: 'rgba(0, 0, 0, 0.3)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 3,
                                color: '#fff',
                                fontSize: 11,
                                fontFamily: 'Space Mono',
                                outline: 'none',
                              }}
                            />
                          </div>
                          <button
                            onClick={() => handleRemoveAnnotation(level, annotation.id)}
                            style={{
                              padding: '8px 12px',
                              background: 'rgba(248, 113, 113, 0.1)',
                              border: '1px solid rgba(248, 113, 113, 0.2)',
                              borderRadius: 3,
                              color: '#f87171',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              marginTop: 'auto',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {/* Second Row: Severity */}
                        <div>
                          <label
                            style={{
                              fontSize: 9,
                              color: 'rgba(255,255,255,0.3)',
                              fontFamily: 'Space Mono',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            SEVERITY
                          </label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {SEVERITY_LEVELS.map((sev) => (
                              <button
                                key={sev.value}
                                onClick={() =>
                                  handleAnnotationChange(level, annotation.id, 'severity', sev.value)
                                }
                                style={{
                                  padding: '6px 12px',
                                  background:
                                    annotation.severity === sev.value
                                      ? `${sev.color}20`
                                      : 'rgba(0, 0, 0, 0.3)',
                                  border:
                                    annotation.severity === sev.value
                                      ? `1px solid ${sev.color}`
                                      : '1px solid rgba(255,255,255,0.1)',
                                  borderRadius: 3,
                                  color: annotation.severity === sev.value ? sev.color : 'rgba(255,255,255,0.3)',
                                  fontSize: 9,
                                  fontWeight: 700,
                                  fontFamily: 'Space Mono',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                }}
                              >
                                {sev.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Third Row: Comment */}
                        <div>
                          <label
                            style={{
                              fontSize: 9,
                              color: 'rgba(255,255,255,0.3)',
                              fontFamily: 'Space Mono',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            COMMENT
                          </label>
                          <textarea
                            value={annotation.comment}
                            onChange={(e) =>
                              handleAnnotationChange(level, annotation.id, 'comment', e.target.value)
                            }
                            placeholder="Expected annotation comment..."
                            style={{
                              width: '100%',
                              minHeight: 60,
                              padding: '8px 12px',
                              background: 'rgba(0, 0, 0, 0.3)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              borderRadius: 3,
                              color: '#fff',
                              fontSize: 11,
                              fontFamily: 'Space Mono',
                              outline: 'none',
                              resize: 'vertical',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Annotation Button */}
                <button
                  onClick={() => handleAddAnnotation(level as any)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 16px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 4,
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: 'Space Mono',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <Plus size={12} />
                  ADD_ANNOTATION
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
