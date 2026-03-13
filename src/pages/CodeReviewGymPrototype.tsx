import { useState } from 'react';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { ChromeMeshGrid } from '../components/ChromeMeshGrid';
import {
  GitPullRequest,
  FileCode,
  MessageSquare,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Terminal,
  ChevronRight,
  Eye,
  GitBranch,
  ClipboardList,
  Send,
} from 'lucide-react';
import Logo from '../components/ui/Logo';

// ─── Static Data ───────────────────────────────────────────────

const FEATURE_REQUEST = {
  id: 'FEAT-1042',
  title: 'Add batch email sending with rate limiting',
  priority: 'HIGH' as const,
  acceptance: [
    'Support sending to multiple recipients in a single call',
    'Implement configurable rate limiting (default: 100/min)',
    'Return partial success results when some sends fail',
    'Add retry logic with exponential backoff for transient errors',
  ],
  context:
    'The Gmail API simulator needs batch sending support for marketing automation use cases. The current implementation only handles single-recipient sends.',
};

const PR_META = {
  number: 847,
  branch: 'feat/batch-email-sender',
  base: 'main',
  author: 'candidate',
  filesChanged: 3,
  additions: 127,
  deletions: 14,
  status: 'OPEN' as const,
};

const DIFF_FILES = [
  {
    path: 'src/services/email_sender.py',
    status: 'modified' as const,
    additions: 89,
    deletions: 12,
    hunks: [
      {
        header: '@@ -15,8 +15,42 @@ class EmailSender:',
        lines: [
          { type: 'context' as const, num: 15, content: 'class EmailSender:' },
          { type: 'context' as const, num: 16, content: '    def __init__(self, client, config=None):' },
          { type: 'context' as const, num: 17, content: '        self.client = client' },
          { type: 'deletion' as const, num: 18, content: '        self.config = config or {}' },
          { type: 'addition' as const, num: 18, content: '        self.config = config or DEFAULT_CONFIG' },
          { type: 'addition' as const, num: 19, content: '        self.rate_limiter = RateLimiter(' },
          { type: 'addition' as const, num: 20, content: '            max_requests=self.config.get("rate_limit", 100),' },
          { type: 'addition' as const, num: 21, content: '            window_seconds=60' },
          { type: 'addition' as const, num: 22, content: '        )' },
          { type: 'context' as const, num: 23, content: '' },
          { type: 'deletion' as const, num: 24, content: '    def send(self, to, subject, body):' },
          { type: 'addition' as const, num: 24, content: '    def send_batch(self, messages):' },
          { type: 'addition' as const, num: 25, content: '        """Send multiple emails with rate limiting."""' },
          { type: 'addition' as const, num: 26, content: '        results = []' },
          { type: 'addition' as const, num: 27, content: '        for msg in messages:' },
          { type: 'addition' as const, num: 28, content: '            self.rate_limiter.acquire()' },
          { type: 'addition' as const, num: 29, content: '            try:' },
          { type: 'addition' as const, num: 30, content: '                resp = self.client.send(msg)' },
          { type: 'addition' as const, num: 31, content: '                results.append({"status": "ok", "id": resp.id})' },
          { type: 'addition' as const, num: 32, content: '            except Exception as e:' },
          { type: 'addition' as const, num: 33, content: '                results.append({"status": "error", "error": str(e)})' },
          { type: 'addition' as const, num: 34, content: '        return results' },
        ],
      },
    ],
  },
  {
    path: 'src/utils/rate_limiter.py',
    status: 'added' as const,
    additions: 31,
    deletions: 0,
    hunks: [
      {
        header: '@@ -0,0 +1,31 @@',
        lines: [
          { type: 'addition' as const, num: 1, content: 'import time' },
          { type: 'addition' as const, num: 2, content: 'from collections import deque' },
          { type: 'addition' as const, num: 3, content: '' },
          { type: 'addition' as const, num: 4, content: 'class RateLimiter:' },
          { type: 'addition' as const, num: 5, content: '    def __init__(self, max_requests, window_seconds):' },
          { type: 'addition' as const, num: 6, content: '        self.max_requests = max_requests' },
          { type: 'addition' as const, num: 7, content: '        self.window = window_seconds' },
          { type: 'addition' as const, num: 8, content: '        self.timestamps = deque()' },
          { type: 'addition' as const, num: 9, content: '' },
          { type: 'addition' as const, num: 10, content: '    def acquire(self):' },
          { type: 'addition' as const, num: 11, content: '        now = time.time()' },
          { type: 'addition' as const, num: 12, content: '        while self.timestamps and self.timestamps[0] < now - self.window:' },
          { type: 'addition' as const, num: 13, content: '            self.timestamps.popleft()' },
          { type: 'addition' as const, num: 14, content: '        if len(self.timestamps) >= self.max_requests:' },
          { type: 'addition' as const, num: 15, content: '            sleep_time = self.timestamps[0] - (now - self.window)' },
          { type: 'addition' as const, num: 16, content: '            time.sleep(sleep_time)' },
          { type: 'addition' as const, num: 17, content: '        self.timestamps.append(time.time())' },
        ],
      },
    ],
  },
  {
    path: 'tests/test_email_sender.py',
    status: 'modified' as const,
    additions: 7,
    deletions: 2,
    hunks: [
      {
        header: '@@ -22,6 +22,11 @@ class TestEmailSender:',
        lines: [
          { type: 'context' as const, num: 22, content: '    def test_send_single(self):' },
          { type: 'deletion' as const, num: 23, content: '        result = self.sender.send("a@b.com", "Hi", "Body")' },
          { type: 'deletion' as const, num: 24, content: '        assert result.status == "sent"' },
          { type: 'addition' as const, num: 23, content: '        result = self.sender.send_batch([' },
          { type: 'addition' as const, num: 24, content: '            {"to": "a@b.com", "subject": "Hi", "body": "Body"}' },
          { type: 'addition' as const, num: 25, content: '        ])' },
          { type: 'addition' as const, num: 26, content: '        assert len(result) == 1' },
          { type: 'addition' as const, num: 27, content: '        assert result[0]["status"] == "ok"' },
        ],
      },
    ],
  },
];

const EXISTING_COMMENTS = [
  {
    id: 1,
    author: 'senior-eng',
    file: 'src/services/email_sender.py',
    line: 33,
    body: 'The bare `except Exception` here will swallow everything including KeyboardInterrupt. Should we narrow this to specific API exceptions?',
    time: '2h ago',
    severity: 'concern' as const,
  },
  {
    id: 2,
    author: 'tech-lead',
    file: 'src/utils/rate_limiter.py',
    line: 16,
    body: 'time.sleep() in the rate limiter will block the entire thread. Consider using asyncio or a token bucket approach instead.',
    time: '1h ago',
    severity: 'blocker' as const,
  },
];

// ─── Component ─────────────────────────────────────────────────

export default function CodeReviewGymPrototype(): JSX.Element {
  const [activeFile, setActiveFile] = useState(0);
  const [verdict, setVerdict] = useState<'approve' | 'request_changes' | 'comment' | null>(null);
  const [commentText, setCommentText] = useState('');
  const [inlineComments, setInlineComments] = useState<Array<{
    file: string;
    line: number;
    body: string;
  }>>([]);
  const [commentingLine, setCommentingLine] = useState<number | null>(null);
  const [inlineText, setInlineText] = useState('');

  const file = DIFF_FILES[activeFile];

  const handleAddInline = (): void => {
    if (commentingLine !== null && inlineText.trim()) {
      setInlineComments(prev => [
        ...prev,
        { file: file.path, line: commentingLine, body: inlineText },
      ]);
      setInlineText('');
      setCommentingLine(null);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0c0c0e',
      color: '#fff',
      fontFamily: '"Space Mono", monospace',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <ChromeMeshGrid />

      {/* ── Header ──────────────────────────────────────────────── */}
      <header style={{
        padding: '24px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(12, 12, 14, 0.8)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky',
        top: 0,
        zIndex: 90,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 32, height: 32 }}>
            <Logo />
          </div>

          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)' }} />

          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
              CODE_REVIEW_GYM
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
              Pull Request Review
            </h2>
          </div>

          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.08)' }} />

          <div style={{ display: 'flex', gap: 8 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: i === 0 ? '#fff' : 'rgba(255,255,255,0.1)',
                transition: 'all 0.3s',
              }} />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 16px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 4,
          }}>
            <Clock size={14} color="rgba(255,255,255,0.4)" />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>25:00</span>
          </div>

          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 20px',
              background: 'linear-gradient(135deg, rgba(167,139,250,0.2), rgba(139,92,246,0.15))',
              border: '1px solid rgba(167,139,250,0.4)',
              color: '#a78bfa',
              fontSize: 10,
              letterSpacing: '0.15em',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Terminal size={14} />
            OPEN_DEV_CONTAINER
          </button>
        </div>
      </header>

      {/* ── Main Content ────────────────────────────────────────── */}
      <main style={{
        flex: 1,
        display: 'flex',
        gap: 0,
        position: 'relative',
        zIndex: 1,
      }}>

        {/* ── Left Panel: Feature Request + PR Context ──────── */}
        <div style={{
          width: 340,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(12, 12, 14, 0.5)',
          overflowY: 'auto',
        }}>
          {/* Feature Request */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
              FEATURE_REQUEST
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
            }}>
              <span style={{
                fontSize: 8,
                fontWeight: 800,
                letterSpacing: '0.15em',
                padding: '4px 8px',
                background: 'rgba(248, 113, 113, 0.1)',
                border: '1px solid rgba(248, 113, 113, 0.2)',
                color: '#f87171',
                borderRadius: 4,
              }}>
                {FEATURE_REQUEST.priority}
              </span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                {FEATURE_REQUEST.id}
              </span>
            </div>

            <h3 style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#fff',
              margin: 0,
              marginBottom: 12,
              lineHeight: 1.5,
              letterSpacing: '0.01em',
            }}>
              {FEATURE_REQUEST.title}
            </h3>

            <p style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.35)',
              lineHeight: 1.7,
              margin: 0,
            }}>
              {FEATURE_REQUEST.context}
            </p>
          </div>

          {/* Acceptance Criteria */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
            }}>
              <ClipboardList size={12} color="rgba(255,255,255,0.3)" />
              <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>
                ACCEPTANCE_CRITERIA
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {FEATURE_REQUEST.acceptance.map((item, i) => (
                <div key={i} style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                }}>
                  <div style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.02)',
                    flexShrink: 0,
                    marginTop: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)' }}>{i + 1}</span>
                  </div>
                  <span style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.5)',
                    lineHeight: 1.5,
                  }}>
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* PR Meta */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
            }}>
              <GitPullRequest size={12} color="#34d399" />
              <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>
                PULL_REQUEST
              </span>
            </div>

            <LiquidMetalCard variant="default" style={{
              padding: 16,
              borderRadius: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{
                  fontSize: 8,
                  fontWeight: 800,
                  letterSpacing: '0.15em',
                  padding: '3px 8px',
                  background: 'rgba(52, 211, 153, 0.1)',
                  border: '1px solid rgba(52, 211, 153, 0.2)',
                  color: '#34d399',
                  borderRadius: 4,
                }}>
                  {PR_META.status}
                </span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>
                  #{PR_META.number}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <GitBranch size={10} color="rgba(255,255,255,0.2)" />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                  {PR_META.branch}
                </span>
                <ChevronRight size={10} color="rgba(255,255,255,0.15)" />
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
                  {PR_META.base}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>+{PR_META.additions}</span> / <span style={{ color: '#f87171', fontWeight: 700 }}>-{PR_META.deletions}</span>
                </span>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
                  {PR_META.filesChanged} files
                </span>
              </div>
            </LiquidMetalCard>
          </div>

          {/* Existing Comments Thread */}
          <div style={{ padding: 24, flex: 1 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
            }}>
              <MessageSquare size={12} color="rgba(255,255,255,0.3)" />
              <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)' }}>
                REVIEW_COMMENTS
              </span>
              <span style={{
                fontSize: 9,
                color: 'rgba(255,255,255,0.2)',
                marginLeft: 'auto',
              }}>
                {EXISTING_COMMENTS.length}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {EXISTING_COMMENTS.map(comment => (
                <div key={comment.id} style={{
                  padding: 12,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${comment.severity === 'blocker' ? 'rgba(248, 113, 113, 0.15)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 4,
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                  }}>
                    {comment.severity === 'blocker' ? (
                      <AlertTriangle size={10} color="#f87171" />
                    ) : (
                      <Eye size={10} color="#fbbf24" />
                    )}
                    <span style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: comment.severity === 'blocker' ? '#f87171' : '#fbbf24',
                      letterSpacing: '0.1em',
                    }}>
                      {comment.severity === 'blocker' ? 'BLOCKER' : 'CONCERN'}
                    </span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' }}>
                      {comment.time}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 6 }}>
                    {comment.file}:{comment.line}
                  </div>
                  <p style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.55)',
                    lineHeight: 1.6,
                    margin: 0,
                  }}>
                    {comment.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Center Panel: Diff Viewer ─────────────────────── */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          minWidth: 0,
        }}>
          {/* File tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(12, 12, 14, 0.6)',
            overflowX: 'auto',
          }}>
            {DIFF_FILES.map((f, i) => (
              <button
                key={f.path}
                onClick={() => setActiveFile(i)}
                style={{
                  padding: '12px 20px',
                  background: i === activeFile ? 'rgba(255,255,255,0.04)' : 'transparent',
                  border: 'none',
                  borderBottom: i === activeFile ? '2px solid #a78bfa' : '2px solid transparent',
                  color: i === activeFile ? '#fff' : 'rgba(255,255,255,0.3)',
                  fontSize: 10,
                  fontFamily: '"Space Mono", monospace',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                }}
              >
                <FileCode size={12} color={i === activeFile ? '#a78bfa' : 'rgba(255,255,255,0.2)'} />
                {f.path.split('/').pop()}
                <span style={{
                  fontSize: 8,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: f.status === 'added'
                    ? 'rgba(74, 222, 128, 0.1)'
                    : 'rgba(255,255,255,0.04)',
                  color: f.status === 'added'
                    ? '#4ade80'
                    : 'rgba(255,255,255,0.3)',
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                }}>
                  {f.status === 'added' ? 'NEW' : 'MOD'}
                </span>
              </button>
            ))}
          </div>

          {/* File header */}
          <div style={{
            padding: '12px 24px',
            background: 'rgba(255,255,255,0.02)',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              {file.path}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
              <span style={{ color: '#4ade80' }}>+{file.additions}</span>
              {' / '}
              <span style={{ color: '#f87171' }}>-{file.deletions}</span>
            </span>
          </div>

          {/* Diff content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {file.hunks.map((hunk, hunkIdx) => (
              <div key={hunkIdx}>
                <div style={{
                  padding: '8px 24px',
                  background: 'rgba(96, 165, 250, 0.04)',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  borderTop: hunkIdx > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  fontSize: 10,
                  color: 'rgba(96, 165, 250, 0.5)',
                }}>
                  {hunk.header}
                </div>

                {hunk.lines.map((line, lineIdx) => {
                  const bgColor =
                    line.type === 'addition' ? 'rgba(74, 222, 128, 0.04)' :
                    line.type === 'deletion' ? 'rgba(248, 113, 113, 0.04)' :
                    'transparent';

                  const borderLeft =
                    line.type === 'addition' ? '2px solid rgba(74, 222, 128, 0.3)' :
                    line.type === 'deletion' ? '2px solid rgba(248, 113, 113, 0.3)' :
                    '2px solid transparent';

                  const hasInlineComment = inlineComments.some(
                    c => c.file === file.path && c.line === line.num
                  );

                  return (
                    <div key={lineIdx}>
                      <div
                        onClick={() => {
                          if (line.type !== 'deletion') {
                            setCommentingLine(commentingLine === line.num ? null : line.num);
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'stretch',
                          background: bgColor,
                          borderLeft,
                          cursor: line.type !== 'deletion' ? 'pointer' : 'default',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (line.type !== 'deletion') {
                            (e.currentTarget as HTMLDivElement).style.background =
                              line.type === 'addition'
                                ? 'rgba(74, 222, 128, 0.08)'
                                : 'rgba(255,255,255,0.03)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLDivElement).style.background = bgColor;
                        }}
                      >
                        {/* Line number */}
                        <div style={{
                          width: 56,
                          padding: '4px 12px',
                          textAlign: 'right',
                          fontSize: 10,
                          color: 'rgba(255,255,255,0.15)',
                          userSelect: 'none',
                          flexShrink: 0,
                        }}>
                          {line.num}
                        </div>

                        {/* Marker */}
                        <div style={{
                          width: 20,
                          padding: '4px 4px',
                          textAlign: 'center',
                          fontSize: 10,
                          color: line.type === 'addition' ? 'rgba(74, 222, 128, 0.5)' :
                                 line.type === 'deletion' ? 'rgba(248, 113, 113, 0.5)' :
                                 'transparent',
                          userSelect: 'none',
                          flexShrink: 0,
                        }}>
                          {line.type === 'addition' ? '+' : line.type === 'deletion' ? '−' : ' '}
                        </div>

                        {/* Code */}
                        <div style={{
                          flex: 1,
                          padding: '4px 16px',
                          fontSize: 11,
                          color: line.type === 'deletion' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.7)',
                          whiteSpace: 'pre',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          textDecoration: line.type === 'deletion' ? 'line-through' : 'none',
                          opacity: line.type === 'deletion' ? 0.6 : 1,
                        }}>
                          {line.content}
                        </div>

                        {/* Comment indicator */}
                        {hasInlineComment && (
                          <div style={{
                            width: 24,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                            <MessageSquare size={10} color="#a78bfa" />
                          </div>
                        )}
                      </div>

                      {/* Inline comment input */}
                      {commentingLine === line.num && (
                        <div style={{
                          padding: '12px 24px 12px 78px',
                          background: 'rgba(167, 139, 250, 0.03)',
                          borderTop: '1px solid rgba(167, 139, 250, 0.1)',
                          borderBottom: '1px solid rgba(167, 139, 250, 0.1)',
                          display: 'flex',
                          gap: 8,
                        }}>
                          <input
                            type="text"
                            value={inlineText}
                            onChange={e => setInlineText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddInline(); }}
                            placeholder="ADD_COMMENT..."
                            autoFocus
                            style={{
                              flex: 1,
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              color: '#fff',
                              fontSize: 11,
                              padding: '8px 12px',
                              fontFamily: '"Space Mono", monospace',
                              outline: 'none',
                              borderRadius: 2,
                            }}
                          />
                          <button
                            onClick={handleAddInline}
                            style={{
                              padding: '8px 16px',
                              background: 'rgba(167,139,250,0.15)',
                              border: '1px solid rgba(167,139,250,0.3)',
                              color: '#a78bfa',
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: '0.1em',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                              borderRadius: 2,
                            }}
                          >
                            ADD
                          </button>
                        </div>
                      )}

                      {/* Show inline comment */}
                      {inlineComments
                        .filter(c => c.file === file.path && c.line === line.num)
                        .map((c, ci) => (
                          <div key={ci} style={{
                            padding: '10px 24px 10px 78px',
                            background: 'rgba(167, 139, 250, 0.02)',
                            borderTop: '1px solid rgba(167, 139, 250, 0.06)',
                            borderBottom: '1px solid rgba(167, 139, 250, 0.06)',
                          }}>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginBottom: 4,
                            }}>
                              <MessageSquare size={10} color="#a78bfa" />
                              <span style={{ fontSize: 9, color: '#a78bfa', fontWeight: 700, letterSpacing: '0.1em' }}>
                                YOUR_COMMENT
                              </span>
                            </div>
                            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, margin: 0 }}>
                              {c.body}
                            </p>
                          </div>
                        ))
                      }
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Right Panel: Review Verdict ───────────────────── */}
        <div style={{
          width: 300,
          borderLeft: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(12, 12, 14, 0.5)',
          overflowY: 'auto',
        }}>
          {/* Verdict */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
              REVIEW_VERDICT
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { key: 'approve' as const, label: 'APPROVE', icon: CheckCircle2, color: '#34d399', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.2)' },
                { key: 'request_changes' as const, label: 'REQUEST_CHANGES', icon: XCircle, color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)' },
                { key: 'comment' as const, label: 'COMMENT_ONLY', icon: MessageSquare, color: '#fbbf24', bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.2)' },
              ]).map(opt => {
                const isActive = verdict === opt.key;
                const Icon = opt.icon;
                return (
                  <div
                    key={opt.key}
                    onClick={() => setVerdict(opt.key)}
                    style={{
                      padding: '14px 16px',
                      background: isActive ? opt.bg : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isActive ? opt.border : 'rgba(255,255,255,0.06)'}`,
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Icon size={14} color={isActive ? opt.color : 'rgba(255,255,255,0.2)'} />
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      color: isActive ? opt.color : 'rgba(255,255,255,0.35)',
                    }}>
                      {opt.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Comment */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
              SUMMARY_COMMENT
            </div>

            <textarea
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="Summarize your review findings..."
              style={{
                width: '100%',
                minHeight: 120,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                color: '#fff',
                fontSize: 11,
                padding: 12,
                fontFamily: '"Space Mono", monospace',
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
              }}
            />
          </div>

          {/* Review Stats */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 16 }}>
              REVIEW_SUMMARY
            </div>

            <LiquidMetalCard variant="default" style={{ padding: 16, borderRadius: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Files Reviewed</span>
                  <span style={{ fontSize: 10, color: '#fff', fontWeight: 700 }}>
                    {activeFile + 1}/{DIFF_FILES.length}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Inline Comments</span>
                  <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>
                    {inlineComments.length}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Existing Comments</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>
                    {EXISTING_COMMENTS.length}
                  </span>
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Verdict</span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: verdict === 'approve' ? '#34d399' :
                           verdict === 'request_changes' ? '#f87171' :
                           verdict === 'comment' ? '#fbbf24' :
                           'rgba(255,255,255,0.15)',
                  }}>
                    {verdict ? verdict.toUpperCase().replace('_', ' ') : '—'}
                  </span>
                </div>
              </div>
            </LiquidMetalCard>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer style={{
        padding: '20px 40px',
        background: 'rgba(12, 12, 14, 0.9)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        bottom: 0,
        zIndex: 90,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {verdict ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34d399' }}>
              <CheckCircle2 size={16} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>
                READY_TO_SUBMIT
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.2)' }}>
              <AlertTriangle size={16} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>
                SELECT_VERDICT_TO_CONTINUE
              </span>
            </div>
          )}
        </div>

        <button
          disabled={!verdict}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 32px',
            background: verdict ? '#fff' : 'rgba(255,255,255,0.05)',
            color: verdict ? '#000' : 'rgba(255,255,255,0.2)',
            border: 'none',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            fontFamily: '"Space Mono", monospace',
            cursor: verdict ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
          }}
        >
          SUBMIT_REVIEW
          <Send size={14} />
        </button>
      </footer>
    </div>
  );
}
