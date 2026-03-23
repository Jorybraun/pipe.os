/**
 * Challenge Library — pre-built templates for the Challenge Picker.
 *
 * Usage:
 *   - Feeds the Challenge Picker modal (search + filter by type/topic/difficulty)
 *   - Populates pipelinePresets.ts for DEFAULT and role-specific presets
 *   - Can be seeded into DynamoDB via scripts/seedChallengeLibrary.ts (post-MVP)
 *
 * Template IDs are stable — never rename them after first use in a preset or seed.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChallengeType = 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP';

export interface Bug {
  line: number;
  type: 'SECURITY' | 'LOGIC' | 'PERFORMANCE' | 'EDGE_CASE';
  severity: 'critical' | 'major' | 'minor';
  explanation: string;
}

export interface CodeArtifactDefinition {
  title: string;
  language: string;
  code: string;
  groundTruth?: Bug[];
}

export interface CodeReviewConfig {
  code: string;
  language: string;
  title: string;
  groundTruth: Bug[];
  prDescription?: string; // High-fidelity context for the review
}

export interface CodeImplementationConfig {
  starterCode?: string;
  language: string;
  problemStatement: string;
  examples?: Array<{ input: string; output: string; explanation?: string }>;
  constraints?: string[];
}

export interface QuizMCQConfig {
  question: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation?: string;
}

export interface QuizShortAnswerConfig {
  question: string;
  placeholder?: string;
  maxLength?: number;
  rubric?: string;
}

export interface ChallengeTemplate {
  id: string;
  type: ChallengeType;
  title: string;
  description: string;
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  topic: string;
  estimatedMinutes: number;
  instructions: string;
  config: CodeReviewConfig | CodeImplementationConfig | QuizMCQConfig | QuizShortAnswerConfig | Record<string, never>;
}

// ─── CODE_REVIEW Templates ──────────────────────────────────────────────────

export const CODE_REVIEW_TEMPLATES: ChallengeTemplate[] = [
  {
    id: 'cr-jwt-auth-bypass',
    type: 'CODE_REVIEW',
    title: 'JWT Auth Middleware',
    description: 'Express middleware that parses JWTs without signature verification.',
    tags: ['security', 'authentication', 'javascript', 'node'],
    difficulty: 'intermediate',
    topic: 'Security',
    estimatedMinutes: 10,
    instructions: 'Review this Express authentication middleware. Identify all security vulnerabilities and logic errors. Annotate each bug with its location, type, and a brief explanation of the impact.',
    config: {
      language: 'javascript',
      title: 'JWT Auth Middleware',
      prDescription: `## PR: Implement stateless authentication middleware

This PR adds a new middleware to handle JWT authentication. 
It decodes the token from the authorization header and attaches the user to the request object. 
If the user is an admin, it skips the session check for better performance.

**Testing performed:**
- Verified that requests with valid tokens are accepted.
- Verified that requests without tokens return 401.`,
      code: `async function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(401).send('Unauthorized');
  }

  try {
    // Parse JWT payload without verifying signature
    const user = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

    if (user.isAdmin = true) {
      req.user = user;
      return next();
    }

    const session = await db.sessions.findOne({ userId: user.id });
    if (session) {
      req.user = user;
      next();
    } else {
      res.status(403).send('Forbidden');
    }
  } catch (err) {
    res.status(500).send('Server Error');
  }
}`,
      groundTruth: [
        {
          line: 9,
          type: 'SECURITY',
          severity: 'critical',
          explanation: 'The JWT payload is decoded but the signature is never verified with a secret key. Any attacker can craft a token claiming any identity or role.',
        },
        {
          line: 11,
          type: 'LOGIC',
          severity: 'critical',
          explanation: 'Using assignment (=) instead of comparison (===) unconditionally sets user.isAdmin to true, granting admin access to every request.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-on2-processing',
    type: 'CODE_REVIEW',
    title: 'Data Processing with Cache',
    description: 'TypeScript function with O(n²) duplicate detection and a null-dereference edge case.',
    tags: ['performance', 'typescript', 'algorithms', 'edge-case'],
    difficulty: 'intermediate',
    topic: 'Performance',
    estimatedMinutes: 8,
    instructions: 'Review this data processing function. Identify any performance issues, logic errors, and edge cases.',
    config: {
      language: 'typescript',
      title: 'Data Processing with Cache',
      code: `function processItems(items: Item[]) {
  const result = [];

  for (let i = 0; i < items.length; i++) {
    const isDuplicate = result.find(r => r.id === items[i].id);

    if (!isDuplicate) {
      result.push({
        id: items[i].id,
        processed: items[i].metadata.timestamp > Date.now()
      });
    }
  }

  return result[0].processed ? result : [];
}`,
      groundTruth: [
        {
          line: 5,
          type: 'PERFORMANCE',
          severity: 'major',
          explanation: 'Array.find inside a loop creates O(n²) complexity. A Set or Map for seen IDs would give O(n).',
        },
        {
          line: 10,
          type: 'LOGIC',
          severity: 'minor',
          explanation: 'items[i].metadata could be null or undefined, causing a runtime crash when accessing .timestamp.',
        },
        {
          line: 14,
          type: 'EDGE_CASE',
          severity: 'major',
          explanation: 'If items is empty, result[0] is undefined and accessing .processed throws a TypeError.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-user-registration',
    type: 'CODE_REVIEW',
    title: 'User Registration Service',
    description: 'Node.js registration handler with SQL injection, missing await, and password logging.',
    tags: ['security', 'javascript', 'sql', 'async'],
    difficulty: 'beginner',
    topic: 'Security',
    estimatedMinutes: 8,
    instructions: 'Review this user registration function. Find all security vulnerabilities, async bugs, and missing validations.',
    config: {
      language: 'javascript',
      title: 'User Registration Service',
      code: `async function registerUser(email, password) {
  const query = \`SELECT * FROM users WHERE email = '\${email}'\`;
  const existingUser = await db.query(query);

  if (existingUser) {
    throw new Error("User already exists");
  }

  const hashedPassword = bcrypt.hash(password, 10);

  console.log("DEBUG: Storing password hash:", hashedPassword);

  return await db.users.create({
    email,
    password: hashedPassword,
    createdAt: new Date().toISOString()
  });
}`,
      groundTruth: [
        {
          line: 2,
          type: 'SECURITY',
          severity: 'critical',
          explanation: 'String interpolation in a SQL query allows SQL injection. Use parameterized queries: db.query("SELECT * FROM users WHERE email = ?", [email]).',
        },
        {
          line: 9,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'bcrypt.hash is async and must be awaited. Without await, hashedPassword is a Promise object, which gets stored as a string in the database.',
        },
        {
          line: 11,
          type: 'SECURITY',
          severity: 'major',
          explanation: 'Logging the password hash (even hashed) to the console is a bad security practice. Remove all credential-related logging.',
        },
        {
          line: 1,
          type: 'EDGE_CASE',
          severity: 'major',
          explanation: 'No validation of password length or complexity. An empty string would be hashed and stored as a valid password.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-react-use-effect-leak',
    type: 'CODE_REVIEW',
    title: 'React Data Fetching Hook',
    description: 'useEffect with a missing cleanup function and stale dependency array.',
    tags: ['react', 'hooks', 'javascript', 'memory-leak'],
    difficulty: 'intermediate',
    topic: 'React',
    estimatedMinutes: 10,
    instructions: 'Review this React component. Identify memory leaks, stale closure issues, and hook dependency problems.',
    config: {
      language: 'javascript',
      title: 'React Data Fetching Hook',
      code: `function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      const response = await fetch(\`/api/users/\${userId}\`);
      const data = await response.json();
      setUser(data);
      setLoading(false);
    }

    fetchUser();
  }, []);

  const handleUpdate = async (newName) => {
    const response = await fetch(\`/api/users/\${userId}\`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName }),
    });
    setUser(await response.json());
  };

  if (loading) return <div>Loading...</div>;
  return <div>{user.name}</div>;
}`,
      groundTruth: [
        {
          line: 9,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'setUser and setLoading are called with no check for whether the component is still mounted. If the user navigates away before the fetch completes, this causes a "setState on unmounted component" warning (React 17) or silent failure (React 18).',
        },
        {
          line: 12,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'The effect has no cleanup function. If userId changes mid-request, two concurrent fetches race and the older one may overwrite the newer result.',
        },
        {
          line: 13,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'Missing userId in the dependency array. If userId changes, the effect does not re-run, so the displayed user is stuck showing the first userId\'s data.',
        },
        {
          line: 18,
          type: 'LOGIC',
          severity: 'minor',
          explanation: 'Missing Content-Type header. The server may not parse the JSON body correctly without "Content-Type": "application/json".',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-stale-closure-listener',
    type: 'CODE_REVIEW',
    title: 'Keyboard Shortcut Counter',
    description: 'React counter using a global event listener with a stale closure bug.',
    tags: ['react', 'hooks', 'closure', 'memory-leak', 'javascript'],
    difficulty: 'intermediate',
    topic: 'React',
    estimatedMinutes: 8,
    instructions: 'Review this React component that increments a counter on Enter keypress. Identify the stale closure, memory leak, and any hook issues.',
    config: {
      language: 'javascript',
      title: 'Keyboard Shortcut Counter',
      code: `function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Enter') {
        console.log('Current count:', count);
        setCount(count + 1);
      }
    };

    window.addEventListener('keypress', handleKeyPress);
  }, []);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
    </div>
  );
}`,
      groundTruth: [
        {
          line: 7,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'Stale closure: count is captured as 0 when the effect runs once. The console.log will always print 0 regardless of subsequent state updates.',
        },
        {
          line: 8,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'Stale closure: setCount(count + 1) uses the captured count (always 0), so pressing Enter repeatedly always sets count to 1. Should use the functional form: setCount(c => c + 1).',
        },
        {
          line: 11,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'The event listener is never removed. This creates a memory leak and accumulates listeners if the component mounts and unmounts multiple times. The effect should return () => window.removeEventListener("keypress", handleKeyPress).',
        },
        {
          line: 12,
          type: 'LOGIC',
          severity: 'minor',
          explanation: 'Empty dependency array means the effect runs only once. But since handleKeyPress uses count (which changes), the correct fix is the functional update form, not adding count to deps (which would re-register the listener on every keystroke).',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-python-rate-limiter',
    type: 'CODE_REVIEW',
    title: 'Python Rate Limiter',
    description: 'In-memory rate limiter with a race condition and timezone bug.',
    tags: ['python', 'concurrency', 'race-condition', 'security', 'edge-case'],
    difficulty: 'advanced',
    topic: 'Security',
    estimatedMinutes: 12,
    instructions: 'Review this Python rate limiting function. Identify concurrency issues, timezone problems, and architectural limitations.',
    config: {
      language: 'python',
      title: 'Python Rate Limiter',
      code: `import time
from datetime import datetime

request_counts = {}

def check_rate_limit(user_id: str, limit: int = 100) -> bool:
    now = datetime.now()
    window_start = now.timestamp() - 3600

    if user_id not in request_counts:
        request_counts[user_id] = []

    request_counts[user_id] = [
        ts for ts in request_counts[user_id]
        if ts > window_start
    ]

    if len(request_counts[user_id]) >= limit:
        return False

    request_counts[user_id].append(now.timestamp())
    return True`,
      groundTruth: [
        {
          line: 4,
          type: 'LOGIC',
          severity: 'critical',
          explanation: 'Global mutable dictionary is not thread-safe. In a multithreaded web server (gunicorn, uWSGI), two threads can concurrently read and write request_counts, corrupting the data.',
        },
        {
          line: 7,
          type: 'EDGE_CASE',
          severity: 'minor',
          explanation: 'datetime.now() returns the local system time without timezone info. Should use datetime.now(timezone.utc) or datetime.utcnow() for consistent behavior across server environments.',
        },
        {
          line: 17,
          type: 'LOGIC',
          severity: 'critical',
          explanation: 'Classic TOCTOU (time-of-check to time-of-use) race condition. Two threads can both pass the len() check before either appends, allowing both to proceed past the limit.',
        },
        {
          line: 4,
          type: 'PERFORMANCE',
          severity: 'major',
          explanation: 'In-memory storage means all rate limit data is lost on server restart, does not work across multiple server instances, and leaks memory indefinitely as user_ids accumulate. Use Redis for production.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-xss-comments',
    type: 'CODE_REVIEW',
    title: 'Comment Display Component',
    description: 'React component rendering user-generated HTML content unsanitized.',
    tags: ['security', 'xss', 'react', 'javascript'],
    difficulty: 'beginner',
    topic: 'Security',
    estimatedMinutes: 8,
    instructions: 'Review this comment display and submission component. Find all security vulnerabilities and edge cases.',
    config: {
      language: 'javascript',
      title: 'Comment Display Component',
      code: `function CommentDisplay({ comments }) {
  return (
    <div className="comments">
      {comments.map(comment => (
        <div key={comment.id}>
          <span className="author">{comment.author}</span>
          <div dangerouslySetInnerHTML={{ __html: comment.body }} />
          <small>{new Date(comment.createdAt).toString()}</small>
        </div>
      ))}
    </div>
  );
}

function CommentForm({ onSubmit }) {
  const [body, setBody] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ body, createdAt: Date.now() });
    setBody('');
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea value={body} onChange={e => setBody(e.target.value)} />
      <button type="submit">Post</button>
    </form>
  );
}`,
      groundTruth: [
        {
          line: 7,
          type: 'SECURITY',
          severity: 'critical',
          explanation: 'dangerouslySetInnerHTML with unsanitized user content is a direct XSS vulnerability. A comment containing <script>document.cookie</script> would execute in every viewer\'s browser. Use a sanitization library like DOMPurify, or render as plain text.',
        },
        {
          line: 8,
          type: 'EDGE_CASE',
          severity: 'minor',
          explanation: 'If comment.createdAt is an invalid date string, new Date(comment.createdAt).toString() renders "Invalid Date" to the user.',
        },
        {
          line: 19,
          type: 'SECURITY',
          severity: 'major',
          explanation: 'Comment body is not sanitized before submission or storage. The server-side API receiving this data should also sanitize, but the client sending clean data is the first line of defence.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-shallow-copy-mutation',
    type: 'CODE_REVIEW',
    title: 'Cart State Management',
    description: 'TypeScript shopping cart utilities that mutate input objects and shared defaults.',
    tags: ['typescript', 'mutation', 'immutability', 'logic'],
    difficulty: 'intermediate',
    topic: 'State Management',
    estimatedMinutes: 8,
    instructions: 'Review these cart helper functions. Identify any places where input data is mutated unexpectedly, and any precision issues.',
    config: {
      language: 'typescript',
      title: 'Cart State Management',
      code: `interface CartItem {
  id: string;
  quantity: number;
  price: number;
}

function applyDiscount(cart: CartItem[], discountPercent: number): CartItem[] {
  return cart.map(item => {
    item.price = item.price * (1 - discountPercent / 100);
    return item;
  });
}

function addItem(cart: CartItem[], newItem: CartItem): CartItem[] {
  cart.push(newItem);
  return cart;
}

function getTotal(cart: CartItem[]): number {
  let total = 0;
  for (const item of cart) {
    total += item.price * item.quantity;
  }
  return total;
}`,
      groundTruth: [
        {
          line: 9,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'applyDiscount mutates the original cart item in place instead of returning a new object. Callers that hold a reference to the original items will see their prices silently changed. Should be: return { ...item, price: item.price * (1 - discountPercent / 100) }.',
        },
        {
          line: 15,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'cart.push() mutates the input array. The function signature implies it returns a new cart, but it modifies and returns the same reference. Should use [...cart, newItem].',
        },
        {
          line: 22,
          type: 'EDGE_CASE',
          severity: 'minor',
          explanation: 'Floating point arithmetic on prices can produce results like 10.999999999. Should round to 2 decimal places: Math.round(total * 100) / 100.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-promise-swallowing',
    type: 'CODE_REVIEW',
    title: 'Dashboard Data Loader',
    description: 'Parallel fetch with unhandled rejections and unchecked HTTP response status.',
    tags: ['javascript', 'async', 'promises', 'error-handling'],
    difficulty: 'intermediate',
    topic: 'Async / Error Handling',
    estimatedMinutes: 10,
    instructions: 'Review this async data loading function. Find all error handling gaps, and places where failures would be silently swallowed.',
    config: {
      language: 'javascript',
      title: 'Dashboard Data Loader',
      code: `async function fetchDashboardData(userId) {
  const [userData, ordersData, notificationsData] = await Promise.all([
    fetch(\`/api/users/\${userId}\`).then(r => r.json()),
    fetch(\`/api/orders/\${userId}\`).then(r => r.json()),
    fetch(\`/api/notifications/\${userId}\`).then(r => r.json()).catch(() => []),
  ]);

  return {
    user: userData,
    orders: ordersData.items,
    unread: notificationsData.filter(n => !n.read).length,
  };
}

fetchDashboardData(userId)
  .then(data => setDashboard(data))`,
      groundTruth: [
        {
          line: 3,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'response.json() is called without checking response.ok first. A 404 or 500 response will still have a JSON body (e.g. {"error":"Not found"}), which gets parsed and returned as if it were valid user data.',
        },
        {
          line: 5,
          type: 'LOGIC',
          severity: 'minor',
          explanation: 'Only the notifications fetch has error handling (.catch(() => [])). If the user or orders fetch fails, Promise.all rejects and the entire dashboard load fails rather than degrading gracefully.',
        },
        {
          line: 10,
          type: 'EDGE_CASE',
          severity: 'major',
          explanation: 'ordersData.items assumes the response has an "items" field. If the orders API returns an error object or an array directly, this will be undefined and silently return an empty orders section (or crash on map/filter calls downstream).',
        },
        {
          line: 15,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'No .catch() on the top-level call. An unhandled promise rejection here will either crash the process (Node.js) or show an uncaught exception in the browser console with no user feedback.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-node-event-emitter-leak',
    type: 'CODE_REVIEW',
    title: 'Node.js Data Stream',
    description: 'EventEmitter subclass with duplicate listeners, memory accumulation, and missing error handler.',
    tags: ['node', 'javascript', 'events', 'memory-leak', 'performance'],
    difficulty: 'advanced',
    topic: 'Node.js',
    estimatedMinutes: 12,
    instructions: 'Review this Node.js DataStream class. Identify memory leaks, listener management issues, and missing error handling.',
    config: {
      language: 'javascript',
      title: 'Node.js Data Stream',
      code: `const EventEmitter = require('events');

class DataStream extends EventEmitter {
  constructor(source) {
    super();
    this.source = source;
    this.data = [];
  }

  start() {
    this.source.on('data', (chunk) => {
      this.data.push(chunk);
      this.emit('data', chunk);
    });

    this.source.on('end', () => {
      this.emit('end', this.data);
    });
  }

  stop() {
    this.source.removeAllListeners();
  }
}`,
      groundTruth: [
        {
          line: 7,
          type: 'PERFORMANCE',
          severity: 'major',
          explanation: 'this.data accumulates every chunk indefinitely with no size limit. For large streams this will exhaust heap memory. Data should be flushed after emitting "end", or the class should not buffer at all.',
        },
        {
          line: 10,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'If start() is called multiple times, a new "data" and "end" listener is added each time without removing the old ones. Node will emit a MaxListenersExceededWarning and each chunk will be processed N times.',
        },
        {
          line: 10,
          type: 'LOGIC',
          severity: 'critical',
          explanation: 'No "error" event listener is attached to the source. In Node.js, an "error" event with no listener throws an uncaught exception and crashes the process.',
        },
        {
          line: 22,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'removeAllListeners() removes every listener on the source, including ones added by other consumers of the same source object. Should remove only the specific handlers this class attached, using named function references.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-sort-parseint',
    type: 'CODE_REVIEW',
    title: 'Score Aggregator',
    description: 'JavaScript score processing with lexicographic sort and NaN propagation bugs.',
    tags: ['javascript', 'coercion', 'sorting', 'edge-case'],
    difficulty: 'beginner',
    topic: 'JavaScript Gotchas',
    estimatedMinutes: 8,
    instructions: 'Review this score processing function. Identify type coercion issues, incorrect sorting, and missing edge case handling.',
    config: {
      language: 'javascript',
      title: 'Score Aggregator',
      code: `function processScores(rawScores) {
  const scores = rawScores.map(s => parseInt(s));

  const sorted = scores.sort();

  const avg = scores.reduce((sum, n) => sum + n, 0) / scores.length;

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(avg * 100) / 100,
    count: scores.length,
  };
}`,
      groundTruth: [
        {
          line: 2,
          type: 'LOGIC',
          severity: 'minor',
          explanation: 'parseInt without a radix. While this works for decimal strings today, it\'s a known footgun. Use parseInt(s, 10) or Number(s). Also, parseInt("10.5") returns 10, silently losing the decimal.',
        },
        {
          line: 4,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'Array.sort() without a comparator sorts lexicographically (as strings). [10, 9, 100].sort() produces [10, 100, 9], making min and max completely wrong for any multi-digit values. Use .sort((a, b) => a - b).',
        },
        {
          line: 6,
          type: 'EDGE_CASE',
          severity: 'major',
          explanation: 'If rawScores is empty, scores.length is 0, and avg becomes 0/0 = NaN. The returned object\'s avg field will be NaN.',
        },
        {
          line: 2,
          type: 'EDGE_CASE',
          severity: 'major',
          explanation: 'If rawScores contains non-numeric strings (e.g. "abc"), parseInt returns NaN. NaN propagates through every reduce and arithmetic operation, making all output values NaN with no error thrown.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-config-shared-reference',
    type: 'CODE_REVIEW',
    title: 'Config Factory',
    description: 'TypeScript config builder with shared mutable references across instances.',
    tags: ['typescript', 'mutation', 'immutability', 'objects'],
    difficulty: 'intermediate',
    topic: 'State Management',
    estimatedMinutes: 8,
    instructions: 'Review this configuration factory. Identify subtle mutation bugs that could cause hard-to-debug cross-request contamination.',
    config: {
      language: 'typescript',
      title: 'Config Factory',
      code: `interface Config {
  timeout: number;
  retries: number;
  headers: Record<string, string>;
  endpoints: string[];
}

const DEFAULT_CONFIG: Config = {
  timeout: 5000,
  retries: 3,
  headers: { 'Content-Type': 'application/json' },
  endpoints: ['https://api.example.com'],
};

function createConfig(overrides: Partial<Config>): Config {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  config.headers['Authorization'] = 'Bearer token';
  return config;
}

const configA = createConfig({ timeout: 3000 });
const configB = createConfig({});`,
      groundTruth: [
        {
          line: 15,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'Spread only performs a shallow copy. config.headers and config.endpoints are still the same object references as DEFAULT_CONFIG.headers and DEFAULT_CONFIG.endpoints.',
        },
        {
          line: 16,
          type: 'LOGIC',
          severity: 'critical',
          explanation: 'config.headers["Authorization"] = ... mutates DEFAULT_CONFIG.headers directly (since they share the same reference). After the first call, every subsequent call — and DEFAULT_CONFIG itself — has the Authorization header permanently set. This is a classic hidden global mutation bug.',
        },
        {
          line: 20,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'configA.headers and configB.headers point to the same object as DEFAULT_CONFIG.headers. Modifying headers on any config affects all of them. Deep clone the nested objects: headers: { ...DEFAULT_CONFIG.headers, ...overrides?.headers }.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-react-prop-mutation',
    type: 'CODE_REVIEW',
    title: 'React List Sorter',
    description: 'React component that mutates props and uses array index as key.',
    tags: ['react', 'javascript', 'mutation', 'keys'],
    difficulty: 'beginner',
    topic: 'React',
    estimatedMinutes: 8,
    instructions: 'Review this React list component. Find prop mutations, incorrect key usage, and any missing edge cases.',
    config: {
      language: 'javascript',
      title: 'React List Sorter',
      code: `function SortableList({ items, onSelect }) {
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = () => {
    items.sort((a, b) => sortAsc
      ? a.name.localeCompare(b.name)
      : b.name.localeCompare(a.name)
    );
    setSortAsc(!sortAsc);
  };

  return (
    <div>
      <button onClick={handleSort}>Sort</button>
      <ul>
        {items.map((item, index) => (
          <li key={index} onClick={() => onSelect(item)}>
            {item.name}
          </li>
        ))}
      </ul>
    </div>
  );
}`,
      groundTruth: [
        {
          line: 5,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'items.sort() mutates the props array in place. Props should be treated as read-only. The component should sort a copy: [...items].sort(...). Mutating props will cause unpredictable behavior in the parent component.',
        },
        {
          line: 16,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'Using array index as the React key means React cannot correctly identify which items changed when the list is reordered. After sorting, items will appear to stay in the same positions visually because React reuses DOM nodes based on index. Use item.id instead.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-csrf-rest-handler',
    type: 'CODE_REVIEW',
    title: 'REST API Transfer Handler',
    description: 'Express endpoint for fund transfers with missing authentication and CSRF protection.',
    tags: ['security', 'javascript', 'csrf', 'authentication', 'node'],
    difficulty: 'advanced',
    topic: 'Security',
    estimatedMinutes: 12,
    instructions: 'Review this bank transfer API endpoint for security vulnerabilities. Consider authentication, authorization, and cross-site request forgery vectors.',
    config: {
      language: 'javascript',
      title: 'REST API Transfer Handler',
      code: `app.post('/api/transfer', async (req, res) => {
  const { fromAccount, toAccount, amount } = req.body;

  if (amount <= 0) {
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  const sender = await db.accounts.findOne({ id: fromAccount });
  if (sender.balance < amount) {
    return res.status(400).json({ error: 'Insufficient funds' });
  }

  await db.accounts.update(
    { id: fromAccount },
    { $inc: { balance: -amount } }
  );
  await db.accounts.update(
    { id: toAccount },
    { $inc: { balance: amount } }
  );

  res.json({ success: true });
});`,
      groundTruth: [
        {
          line: 1,
          type: 'SECURITY',
          severity: 'critical',
          explanation: 'No authentication check. Any unauthenticated request can call this endpoint. The handler must verify that the caller is a logged-in user (e.g. by checking a session or JWT) before proceeding.',
        },
        {
          line: 1,
          type: 'SECURITY',
          severity: 'critical',
          explanation: 'No CSRF protection. A malicious website can submit a form that POSTs to /api/transfer using the victim\'s browser cookies. Cookie-based sessions require a CSRF token (or the same-site cookie attribute).',
        },
        {
          line: 8,
          type: 'SECURITY',
          severity: 'critical',
          explanation: 'No authorization check. The code verifies the balance but never checks that the authenticated user owns the fromAccount. Any logged-in user can drain any other user\'s account.',
        },
        {
          line: 13,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'The two update operations are not in a transaction. If the debit succeeds but the credit fails (e.g. network error), money disappears. This requires a database transaction or a compensating transaction pattern.',
        },
      ],
    } satisfies CodeReviewConfig,
  },

  {
    id: 'cr-python-dict-mutation',
    type: 'CODE_REVIEW',
    title: 'Python Report Generator',
    description: 'Python function mutating a dictionary while iterating and using mutable defaults.',
    tags: ['python', 'mutation', 'iteration', 'logic'],
    difficulty: 'intermediate',
    topic: 'Python',
    estimatedMinutes: 10,
    instructions: 'Review this Python report generation function. Find mutation-during-iteration bugs, mutable default argument issues, and edge cases.',
    config: {
      language: 'python',
      title: 'Python Report Generator',
      code: `def generate_report(data: dict, filters: list = []) -> dict:
    report = data.copy()

    for key in report:
        if key in filters:
            del report[key]

    totals = {}
    for category, items in report.items():
        totals[category] = sum(item['value'] for item in items)

    if not totals:
        return {}

    filters.append('generated_at')

    report['totals'] = totals
    report['generated_at'] = datetime.now().isoformat()
    return report`,
      groundTruth: [
        {
          line: 1,
          type: 'LOGIC',
          severity: 'critical',
          explanation: 'Mutable default argument (filters: list = []). Python evaluates default arguments once at function definition time. Every call that doesn\'t pass filters shares the same list object. Mutations to it persist across calls. Use filters: list | None = None and default inside the body.',
        },
        {
          line: 4,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'Iterating over report while deleting keys from it raises RuntimeError: dictionary changed size during iteration. The loop should iterate over a copy: for key in list(report.keys()).',
        },
        {
          line: 10,
          type: 'EDGE_CASE',
          severity: 'minor',
          explanation: 'sum(item[\'value\'] ...) assumes every item has a "value" key. If any item is missing this key, a KeyError is raised with no informative context. Should use item.get(\'value\', 0) or add error handling.',
        },
        {
          line: 14,
          type: 'LOGIC',
          severity: 'major',
          explanation: 'filters.append(\'generated_at\') mutates the caller\'s filters list (the mutable default or the passed-in list). This is a hidden side effect — callers don\'t expect their list to be modified.',
        },
      ],
    } satisfies CodeReviewConfig,
  },
];

// ─── QUIZ_MCQ Templates ──────────────────────────────────────────────────────

export const QUIZ_MCQ_TEMPLATES: ChallengeTemplate[] = [
  // ── React ──
  {
    id: 'mcq-react-equality',
    type: 'QUIZ_MCQ',
    title: 'React: JS Equality Quirk',
    description: 'Tests knowledge of JavaScript type coercion with equality operators.',
    tags: ['javascript', 'coercion', 'beginner'],
    difficulty: 'beginner',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the result of `[] == ![]` in JavaScript?',
      options: [
        { id: 'a', text: 'true' },
        { id: 'b', text: 'false' },
        { id: 'c', text: 'undefined' },
        { id: 'd', text: 'TypeError' },
      ],
      correctOptionId: 'a',
      explanation: '![] is false (empty array is truthy). [] == false triggers abstract equality: [] coerces to "" then to 0; false coerces to 0. 0 == 0 is true.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-react-use-effect',
    type: 'QUIZ_MCQ',
    title: 'React: useEffect',
    description: 'Tests knowledge of the hook for running side effects.',
    tags: ['react', 'hooks', 'beginner'],
    difficulty: 'beginner',
    topic: 'React',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'In a React functional component, which hook is used to perform side effects?',
      options: [
        { id: 'a', text: 'useState' },
        { id: 'b', text: 'useContext' },
        { id: 'c', text: 'useEffect' },
        { id: 'd', text: 'useReducer' },
      ],
      correctOptionId: 'c',
      explanation: 'useEffect is React\'s escape hatch for side effects like data fetching, subscriptions, and DOM mutations. It runs after every render by default, or only when specified dependencies change.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-interface-vs-type',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: interface vs type',
    description: 'Tests understanding of the key structural difference between interface and type alias.',
    tags: ['typescript', 'beginner'],
    difficulty: 'beginner',
    topic: 'TypeScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'In TypeScript, what is the primary structural difference between an interface and a type alias?',
      options: [
        { id: 'a', text: 'Interfaces can be extended, type aliases cannot' },
        { id: 'b', text: 'Type aliases can be extended, interfaces cannot' },
        { id: 'c', text: 'Interfaces support declaration merging, type aliases do not' },
        { id: 'd', text: 'There is no meaningful difference' },
      ],
      correctOptionId: 'c',
      explanation: 'Interfaces support declaration merging — you can declare the same interface name multiple times and TypeScript will merge the declarations. Both interfaces and type aliases support extension/intersection, but only interfaces can be merged.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-closure',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: Closures',
    description: 'Tests the conceptual definition of a closure.',
    tags: ['javascript', 'closures', 'beginner'],
    difficulty: 'beginner',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is a closure in JavaScript?',
      options: [
        { id: 'a', text: 'A function combined with its lexical environment' },
        { id: 'b', text: 'A way to close a database connection' },
        { id: 'c', text: 'A method to terminate a loop' },
        { id: 'd', text: 'A private variable declared in a class' },
      ],
      correctOptionId: 'a',
      explanation: 'A closure is a function that retains access to variables from its surrounding lexical scope, even after that outer function has returned. This is the basis for patterns like module patterns, partial application, and private state.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-react-keys',
    type: 'QUIZ_MCQ',
    title: 'React: List Keys',
    description: 'Tests understanding of why stable keys matter in React lists.',
    tags: ['react', 'performance', 'beginner'],
    difficulty: 'beginner',
    topic: 'React',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'Why are stable `key` props important when rendering lists in React?',
      options: [
        { id: 'a', text: 'They uniquely identify elements among their siblings so React can correctly reconcile updates' },
        { id: 'b', text: 'They improve CSS styling of list elements' },
        { id: 'c', text: 'They are required for ARIA accessibility compliance' },
        { id: 'd', text: 'They speed up initial rendering of the list' },
      ],
      correctOptionId: 'a',
      explanation: 'React uses keys to match elements between renders. Without stable keys (e.g. using array index), re-ordering a list causes React to re-render all items instead of moving them, and can corrupt component state (e.g. input focus and values).',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-event-loop',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: Event Loop',
    description: 'Tests understanding of how the event loop processes async callbacks.',
    tags: ['javascript', 'async', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the primary role of the JavaScript event loop?',
      options: [
        { id: 'a', text: 'To execute all code in multiple threads simultaneously' },
        { id: 'b', text: 'To dequeue callbacks from the task queue and push them onto the call stack when the stack is empty' },
        { id: 'c', text: 'To manage heap memory allocation for objects' },
        { id: 'd', text: 'To compile JavaScript into optimized machine code' },
      ],
      correctOptionId: 'b',
      explanation: 'JavaScript is single-threaded. The event loop continuously checks whether the call stack is empty, and if so, moves the next callback from the task queue (or microtask queue) onto the stack to execute.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-generics',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: Generics Syntax',
    description: 'Tests basic familiarity with TypeScript generic syntax.',
    tags: ['typescript', 'generics', 'beginner'],
    difficulty: 'beginner',
    topic: 'TypeScript',
    estimatedMinutes: 1,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'Which syntax is used to define a generic type parameter in TypeScript?',
      options: [
        { id: 'a', text: '( )' },
        { id: 'b', text: '[ ]' },
        { id: 'c', text: '{ }' },
        { id: 'd', text: '< >' },
      ],
      correctOptionId: 'd',
      explanation: 'TypeScript uses angle brackets for generic type parameters: function identity<T>(arg: T): T { return arg; }. The <T> declares a type variable that is filled in by the caller.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-react-useref',
    type: 'QUIZ_MCQ',
    title: 'React: useRef',
    description: 'Tests understanding of the primary use case for useRef.',
    tags: ['react', 'hooks', 'beginner'],
    difficulty: 'beginner',
    topic: 'React',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the primary use case for `useRef` in React?',
      options: [
        { id: 'a', text: 'To store a value that triggers a re-render when changed' },
        { id: 'b', text: 'To access or store mutable values that persist across renders without causing re-renders' },
        { id: 'c', text: 'To share state between multiple unrelated components' },
        { id: 'd', text: 'To memoize expensive calculations' },
      ],
      correctOptionId: 'b',
      explanation: 'useRef returns a mutable ref object whose .current property persists for the full lifetime of the component. Mutating .current does not trigger a re-render. Common uses: storing DOM references, keeping a previous value, or persisting timers/subscriptions.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-hoisting',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: Hoisting',
    description: 'Tests understanding of which declarations are fully hoisted in JavaScript.',
    tags: ['javascript', 'hoisting', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'Which of the following is NOT accessible before its declaration in JavaScript due to the temporal dead zone?',
      options: [
        { id: 'a', text: 'Function declarations' },
        { id: 'b', text: 'var variables' },
        { id: 'c', text: 'let and const variables' },
        { id: 'd', text: 'Class expressions assigned to var' },
      ],
      correctOptionId: 'c',
      explanation: 'let and const are hoisted to the top of their block but are in a "temporal dead zone" until the declaration is reached. Accessing them before declaration throws a ReferenceError. var is hoisted and initialized to undefined; function declarations are fully hoisted.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-react-memo',
    type: 'QUIZ_MCQ',
    title: 'React: React.memo',
    description: 'Tests understanding of the memoization behavior of React.memo.',
    tags: ['react', 'performance', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'React',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What does `React.memo` do?',
      options: [
        { id: 'a', text: 'Automatically saves component state to localStorage' },
        { id: 'b', text: 'Skips re-rendering a component if its props have not changed (shallow comparison)' },
        { id: 'c', text: 'Speeds up the initial mount of a component' },
        { id: 'd', text: 'Memoizes expensive function calls inside the component body' },
      ],
      correctOptionId: 'b',
      explanation: 'React.memo is a higher-order component that wraps a functional component and performs a shallow comparison of its props before each render. If props are the same, the previous render result is reused. It does not affect the first render.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-react-use-callback',
    type: 'QUIZ_MCQ',
    title: 'React: useCallback vs useMemo',
    description: 'Tests the difference between useCallback and useMemo.',
    tags: ['react', 'hooks', 'performance', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'React',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the key difference between `useCallback` and `useMemo`?',
      options: [
        { id: 'a', text: 'useCallback is for class components; useMemo is for functional components' },
        { id: 'b', text: 'useCallback memoizes a function reference; useMemo memoizes the return value of a function' },
        { id: 'c', text: 'useCallback runs asynchronously; useMemo is synchronous' },
        { id: 'd', text: 'There is no meaningful difference — they are aliases' },
      ],
      correctOptionId: 'b',
      explanation: 'useCallback(fn, deps) returns a memoized version of the callback function itself. useMemo(() => computeValue(), deps) returns the memoized result of calling the function. useCallback(fn, deps) is equivalent to useMemo(() => fn, deps).',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-react-strict-mode',
    type: 'QUIZ_MCQ',
    title: 'React: Strict Mode',
    description: 'Tests understanding of what React StrictMode does in development.',
    tags: ['react', 'debugging', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'React',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What does React.StrictMode do in development?',
      options: [
        { id: 'a', text: 'It prevents any state mutations' },
        { id: 'b', text: 'It intentionally double-invokes renders and effects to surface side effects and unsafe patterns' },
        { id: 'c', text: 'It enables TypeScript strict mode for React components' },
        { id: 'd', text: 'It enforces WCAG accessibility rules at runtime' },
      ],
      correctOptionId: 'b',
      explanation: 'In development, React.StrictMode double-invokes render functions, state initializers, and effects to help detect side effects and non-idempotent code. This behavior only occurs in development and has no effect in production.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-utility-partial',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: Partial<T>',
    description: 'Tests knowledge of the Partial utility type.',
    tags: ['typescript', 'utility-types', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'TypeScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What does `Partial<User>` produce if User is `{ id: string; name: string; email: string }`?',
      options: [
        { id: 'a', text: '{ id?: string; name?: string; email?: string }' },
        { id: 'b', text: '{ id: string; name?: string; email?: string }' },
        { id: 'c', text: 'Removes all optional properties from User' },
        { id: 'd', text: 'Makes all properties readonly' },
      ],
      correctOptionId: 'a',
      explanation: 'Partial<T> makes all properties of T optional by adding ? to each. This is useful for update/patch operations where you only want to send changed fields. Required<T> is the inverse.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-unknown-vs-any',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: unknown vs any',
    description: 'Tests understanding of the type safety difference between unknown and any.',
    tags: ['typescript', 'type-safety', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'TypeScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the key difference between `unknown` and `any` in TypeScript?',
      options: [
        { id: 'a', text: 'unknown is only for function parameters; any works everywhere' },
        { id: 'b', text: 'any disables type checking entirely; unknown requires a type guard before use' },
        { id: 'c', text: 'unknown is equivalent to null | undefined; any includes all other types' },
        { id: 'd', text: 'They are interchangeable — both opt out of type checking' },
      ],
      correctOptionId: 'b',
      explanation: 'With any, TypeScript disables all type checking for that value — you can call methods, access properties, and assign freely. With unknown, TypeScript requires you to narrow the type (via typeof, instanceof, or a type guard) before doing anything with the value. unknown is the type-safe alternative to any.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-discriminated-union',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: Discriminated Unions',
    description: 'Tests understanding of discriminated unions for exhaustive type narrowing.',
    tags: ['typescript', 'type-narrowing', 'advanced'],
    difficulty: 'advanced',
    topic: 'TypeScript',
    estimatedMinutes: 3,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'In a discriminated union like `type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number }`, what makes it a "discriminated" union?',
      options: [
        { id: 'a', text: 'Using the union operator (|) with exactly two members' },
        { id: 'b', text: 'A shared literal property (the discriminant) that TypeScript uses to narrow the type in conditional checks' },
        { id: 'c', text: 'Having the same property names across all union members' },
        { id: 'd', text: 'Being defined with the discriminate keyword' },
      ],
      correctOptionId: 'b',
      explanation: 'The discriminant is the shared property (here, "kind") with a unique literal type for each union member. When you check `if (shape.kind === "circle")`, TypeScript narrows shape to the circle branch. This enables exhaustive switch statements and catch-all checks via never.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-mapped-types',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: Mapped Types',
    description: 'Tests ability to read and predict the output of a mapped type.',
    tags: ['typescript', 'mapped-types', 'advanced'],
    difficulty: 'advanced',
    topic: 'TypeScript',
    estimatedMinutes: 3,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What type does `{ [K in keyof T]: T[K] extends string ? K : never }[keyof T]` produce?',
      options: [
        { id: 'a', text: 'All values of T that are strings' },
        { id: 'b', text: 'All keys of T whose value type is string' },
        { id: 'c', text: 'A new object type with only string-valued keys' },
        { id: 'd', text: 'This is a syntax error' },
      ],
      correctOptionId: 'b',
      explanation: 'The mapped type produces an object where each key maps to either the key name (if the value is a string) or never. Indexing with [keyof T] then unions all the values, which filters out never and leaves only the keys whose value type extends string.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-readonly',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: Readonly Arrays',
    description: 'Tests understanding of readonly and const in TypeScript.',
    tags: ['typescript', 'readonly', 'beginner'],
    difficulty: 'beginner',
    topic: 'TypeScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the difference between `const arr: number[] = [1, 2, 3]` and `const arr: readonly number[] = [1, 2, 3]`?',
      options: [
        { id: 'a', text: 'const prevents reassignment; readonly also prevents push, pop, and splice on the array' },
        { id: 'b', text: 'They are identical — const already makes arrays immutable' },
        { id: 'c', text: 'readonly prevents reassignment; const only applies to primitive values' },
        { id: 'd', text: 'readonly arrays are slower because TypeScript checks mutations at runtime' },
      ],
      correctOptionId: 'a',
      explanation: 'const prevents the variable binding from being reassigned (arr = [] would be an error). But you can still mutate the array contents with arr.push(4). readonly number[] additionally disallows all mutating methods (push, pop, sort, splice etc.) at the type level. TypeScript only enforces this at compile time — there is no runtime difference.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-ts-infer',
    type: 'QUIZ_MCQ',
    title: 'TypeScript: infer keyword',
    description: 'Tests understanding of the infer keyword within conditional types.',
    tags: ['typescript', 'conditional-types', 'advanced'],
    difficulty: 'advanced',
    topic: 'TypeScript',
    estimatedMinutes: 3,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What does `type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never` do?',
      options: [
        { id: 'a', text: 'Checks if T is a function and, if so, captures and returns its return type as R' },
        { id: 'b', text: 'Returns true if T is a function, false otherwise' },
        { id: 'c', text: 'Converts any function type T into the never type' },
        { id: 'd', text: 'Infers the argument types of T, not the return type' },
      ],
      correctOptionId: 'a',
      explanation: 'infer R within a conditional type declares a type variable R that TypeScript will infer from the matched type. If T extends a function, R is inferred as the function\'s return type and returned. If T is not a function, the type evaluates to never.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-prototype-chain',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: Prototype Chain',
    description: 'Tests understanding of JavaScript prototypal inheritance.',
    tags: ['javascript', 'prototypes', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'When you access a property on an object in JavaScript, what happens if the property is not found on the object itself?',
      options: [
        { id: 'a', text: 'JavaScript throws a TypeError immediately' },
        { id: 'b', text: 'JavaScript looks up the prototype chain until the property is found or the chain ends at null' },
        { id: 'c', text: 'JavaScript creates the property with value undefined on the object' },
        { id: 'd', text: 'JavaScript returns the value from the parent class constructor' },
      ],
      correctOptionId: 'b',
      explanation: 'JavaScript uses prototypal inheritance. If a property is not found on the object, the engine looks at the object\'s [[Prototype]] (accessible via Object.getPrototypeOf or __proto__), then that object\'s [[Prototype]], and so on until null is reached (the end of the chain), at which point undefined is returned.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-promise-vs-async',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: async/await vs Promises',
    description: 'Tests understanding of the relationship between async/await and Promises.',
    tags: ['javascript', 'async', 'promises', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What does an `async` function always return?',
      options: [
        { id: 'a', text: 'The value returned by the return statement, wrapped in an object' },
        { id: 'b', text: 'A Promise that resolves to the returned value' },
        { id: 'c', text: 'An Observable that can be subscribed to' },
        { id: 'd', text: 'Nothing — async functions are purely for their side effects' },
      ],
      correctOptionId: 'b',
      explanation: 'An async function always returns a Promise. If you return a non-Promise value, it is automatically wrapped in Promise.resolve(value). If you throw, the function returns a rejected Promise. async/await is syntactic sugar over Promise chains.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-this-binding',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: this Binding',
    description: 'Tests understanding of how this is determined in different call contexts.',
    tags: ['javascript', 'this', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the value of `this` inside an arrow function?',
      options: [
        { id: 'a', text: 'The object that called the arrow function' },
        { id: 'b', text: 'The arrow function\'s own execution context, set at call time' },
        { id: 'c', text: 'The lexical this from the surrounding scope at the time the arrow function was defined' },
        { id: 'd', text: 'Always undefined in strict mode' },
      ],
      correctOptionId: 'c',
      explanation: 'Arrow functions do not have their own this binding. They capture this from the enclosing lexical scope where they are defined (not where they are called). This makes them useful for callbacks where you want to preserve the outer this.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-var-vs-let',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: var vs let Scope',
    description: 'Tests understanding of function scope vs block scope.',
    tags: ['javascript', 'scope', 'beginner'],
    difficulty: 'beginner',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the scope of a `var` declaration vs a `let` declaration?',
      options: [
        { id: 'a', text: 'Both are block-scoped' },
        { id: 'b', text: 'var is function-scoped; let is block-scoped' },
        { id: 'c', text: 'var is block-scoped; let is function-scoped' },
        { id: 'd', text: 'Both are global-scoped when declared at the top level' },
      ],
      correctOptionId: 'b',
      explanation: 'var is scoped to the nearest enclosing function (or global if at the top level), and is hoisted to the top of that function. let and const are block-scoped — they only exist within the {} block where they are declared, and are in the temporal dead zone before the declaration.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-js-structuredclone',
    type: 'QUIZ_MCQ',
    title: 'JavaScript: Deep Cloning',
    description: 'Tests awareness of the limitations of common deep clone approaches.',
    tags: ['javascript', 'objects', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'Which of the following correctly describes a limitation of `JSON.parse(JSON.stringify(obj))` for deep cloning?',
      options: [
        { id: 'a', text: 'It fails to clone string and number values' },
        { id: 'b', text: 'It loses functions, undefined values, Date objects (becomes strings), and throws on circular references' },
        { id: 'c', text: 'It only clones one level deep' },
        { id: 'd', text: 'It is not supported in modern browsers' },
      ],
      correctOptionId: 'b',
      explanation: 'JSON serialization drops functions and undefined (they become null in arrays or are omitted in objects), converts Date objects to ISO strings (losing the Date prototype), and throws a TypeError on circular references. Use structuredClone() (modern) or a library like Lodash\'s cloneDeep() for robust deep cloning.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-css-specificity',
    type: 'QUIZ_MCQ',
    title: 'CSS: Specificity',
    description: 'Tests understanding of CSS specificity calculation order.',
    tags: ['css', 'beginner'],
    difficulty: 'beginner',
    topic: 'CSS',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'Which CSS selector has the highest specificity?',
      options: [
        { id: 'a', text: '.container p.highlight' },
        { id: 'b', text: '#sidebar .item' },
        { id: 'c', text: 'div > ul > li > a' },
        { id: 'd', text: 'p.text-bold.large' },
      ],
      correctOptionId: 'b',
      explanation: 'Specificity is calculated as (inline, IDs, classes/attributes/pseudo-classes, elements). #sidebar .item = (0, 1, 1, 0). .container p.highlight = (0, 0, 2, 1). div > ul > li > a = (0, 0, 0, 4). p.text-bold.large = (0, 0, 2, 1). The ID selector in option B gives it the highest specificity.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-css-box-model',
    type: 'QUIZ_MCQ',
    title: 'CSS: Box Model',
    description: 'Tests understanding of box-sizing behavior.',
    tags: ['css', 'beginner'],
    difficulty: 'beginner',
    topic: 'CSS',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'If a div has `width: 200px`, `padding: 20px`, and `box-sizing: content-box`, what is its total rendered width?',
      options: [
        { id: 'a', text: '200px' },
        { id: 'b', text: '240px' },
        { id: 'c', text: '220px' },
        { id: 'd', text: '160px' },
      ],
      correctOptionId: 'b',
      explanation: 'With box-sizing: content-box (the default), width sets the content area only. Total width = content (200) + padding-left (20) + padding-right (20) = 240px. With box-sizing: border-box, the 200px would include padding, giving a 160px content area and 200px total width.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-css-flexbox-align',
    type: 'QUIZ_MCQ',
    title: 'CSS: Flexbox Alignment',
    description: 'Tests the difference between align-items and justify-content in flexbox.',
    tags: ['css', 'flexbox', 'beginner'],
    difficulty: 'beginner',
    topic: 'CSS',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'In a flex container with `flex-direction: row`, which property aligns items along the vertical (cross) axis?',
      options: [
        { id: 'a', text: 'justify-content' },
        { id: 'b', text: 'align-items' },
        { id: 'c', text: 'align-self' },
        { id: 'd', text: 'flex-wrap' },
      ],
      correctOptionId: 'b',
      explanation: 'In a row flex container, the main axis is horizontal and the cross axis is vertical. justify-content aligns items along the main (horizontal) axis. align-items aligns items along the cross (vertical) axis. align-self overrides align-items for a specific child.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-css-position',
    type: 'QUIZ_MCQ',
    title: 'CSS: Positioning',
    description: 'Tests understanding of CSS position: sticky behavior.',
    tags: ['css', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'CSS',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the behavior of `position: sticky`?',
      options: [
        { id: 'a', text: 'The element is removed from the document flow and positioned relative to the viewport' },
        { id: 'b', text: 'The element behaves like relative positioning until it reaches a scroll threshold, then sticks like fixed positioning within its containing block' },
        { id: 'c', text: 'The element is always fixed to the top of the nearest scrollable ancestor' },
        { id: 'd', text: 'The element follows the cursor position on the page' },
      ],
      correctOptionId: 'b',
      explanation: 'position: sticky is a hybrid. The element is positioned normally until it would scroll past a threshold (e.g. top: 0). At that point it "sticks" in place within its scrolling container. It unsticks when the parent scrolls past the element\'s end. Requires overflow: visible on parents to work.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-css-stacking-context',
    type: 'QUIZ_MCQ',
    title: 'CSS: Stacking Context',
    description: 'Tests understanding of what creates a new stacking context.',
    tags: ['css', 'z-index', 'advanced'],
    difficulty: 'advanced',
    topic: 'CSS',
    estimatedMinutes: 3,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'Which of the following creates a new CSS stacking context?',
      options: [
        { id: 'a', text: 'Setting z-index on any element' },
        { id: 'b', text: 'opacity less than 1, or position with z-index other than auto, or transform, or isolation: isolate' },
        { id: 'c', text: 'Setting display: block on an element' },
        { id: 'd', text: 'Any element that has a parent with position: relative' },
      ],
      correctOptionId: 'b',
      explanation: 'A stacking context is created by several CSS properties: opacity < 1, any position value with a z-index other than auto, will-change, transform, filter, clip-path, mask, and isolation: isolate. Elements within a stacking context are rendered as a unit and z-index comparisons are only meaningful within the same stacking context.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-node-event-loop',
    type: 'QUIZ_MCQ',
    title: 'Node.js: Event Loop Phases',
    description: 'Tests understanding of microtask vs macrotask queue ordering.',
    tags: ['node', 'async', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Node.js',
    estimatedMinutes: 3,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'In what order do these run: `setTimeout(fn, 0)`, `Promise.resolve().then(fn)`, and `process.nextTick(fn)`?',
      options: [
        { id: 'a', text: 'setTimeout → Promise.then → process.nextTick' },
        { id: 'b', text: 'process.nextTick → Promise.then → setTimeout' },
        { id: 'c', text: 'Promise.then → process.nextTick → setTimeout' },
        { id: 'd', text: 'All run in the order they were registered' },
      ],
      correctOptionId: 'b',
      explanation: 'process.nextTick callbacks are processed before any other async work after the current operation completes. Promise microtasks run next (the microtask queue). setTimeout(fn, 0) is a macrotask and runs in the timers phase of the event loop, after all microtasks are drained.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-node-streams',
    type: 'QUIZ_MCQ',
    title: 'Node.js: Streams',
    description: 'Tests understanding of the main advantage of streams over buffering.',
    tags: ['node', 'streams', 'performance', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Node.js',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the primary advantage of using Node.js streams over loading an entire file into memory?',
      options: [
        { id: 'a', text: 'Streams automatically compress data before processing' },
        { id: 'b', text: 'Streams process data in chunks, keeping memory usage constant regardless of file size' },
        { id: 'c', text: 'Streams are faster because they run on a separate thread' },
        { id: 'd', text: 'Streams support more file formats than fs.readFile' },
      ],
      correctOptionId: 'b',
      explanation: 'Streams process data incrementally in chunks. Reading a 10GB file with fs.readFile loads all 10GB into memory. A readable stream pipes chunks through the pipeline as they arrive, so memory usage stays roughly constant at the chunk size. This enables processing files larger than available RAM.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-node-modules-cjs-esm',
    type: 'QUIZ_MCQ',
    title: 'Node.js: CommonJS vs ES Modules',
    description: 'Tests understanding of the difference between require and import in Node.',
    tags: ['node', 'modules', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Node.js',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the key difference between CommonJS `require()` and ES Module `import`?',
      options: [
        { id: 'a', text: 'require() only works in Node; import works in both Node and browsers' },
        { id: 'b', text: 'require() is synchronous and evaluated at runtime; import is static and analyzed at parse time, enabling tree-shaking' },
        { id: 'c', text: 'import is faster because it runs in a separate thread' },
        { id: 'd', text: 'require() supports named exports; import only supports default exports' },
      ],
      correctOptionId: 'b',
      explanation: 'CommonJS require() is synchronous and dynamic — the module path can be a variable and it runs at call time. ES Module import is static — paths must be string literals, imports are analyzed before execution, enabling bundlers to perform tree-shaking. ES modules also always run in strict mode and use different semantics for this.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-algo-big-o',
    type: 'QUIZ_MCQ',
    title: 'Algorithms: Time Complexity',
    description: 'Tests ability to identify the time complexity of a nested loop pattern.',
    tags: ['algorithms', 'big-o', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Algorithms',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the time complexity of searching for duplicates in an array using two nested for-loops iterating over n elements?',
      options: [
        { id: 'a', text: 'O(n)' },
        { id: 'b', text: 'O(n log n)' },
        { id: 'c', text: 'O(n²)' },
        { id: 'd', text: 'O(2n)' },
      ],
      correctOptionId: 'c',
      explanation: 'Two nested loops each iterating n times results in n × n = n² comparisons, giving O(n²) time complexity. This can be reduced to O(n) using a HashSet to track seen values, or O(n log n) by sorting first and checking adjacent elements.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-algo-hash-map',
    type: 'QUIZ_MCQ',
    title: 'Algorithms: HashMap Lookup',
    description: 'Tests understanding of average-case HashMap time complexity.',
    tags: ['algorithms', 'data-structures', 'beginner'],
    difficulty: 'beginner',
    topic: 'Algorithms',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the average-case time complexity for a lookup in a hash map (JavaScript Map or object)?',
      options: [
        { id: 'a', text: 'O(n)' },
        { id: 'b', text: 'O(log n)' },
        { id: 'c', text: 'O(1)' },
        { id: 'd', text: 'O(n log n)' },
      ],
      correctOptionId: 'c',
      explanation: 'Hash maps provide O(1) average-case lookup because the key is hashed to a bucket index directly. In the worst case (all keys hash to the same bucket), lookup degrades to O(n), but hash functions are designed to minimize this. This is why replacing an array.includes() call inside a loop with a Set.has() call reduces complexity from O(n²) to O(n).',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-algo-recursion-stack',
    type: 'QUIZ_MCQ',
    title: 'Algorithms: Recursion and the Stack',
    description: 'Tests understanding of stack overflow risk in recursive algorithms.',
    tags: ['algorithms', 'recursion', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Algorithms',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'Why can deep recursion cause a "stack overflow" error in JavaScript?',
      options: [
        { id: 'a', text: 'JavaScript does not support recursion in strict mode' },
        { id: 'b', text: 'Each function call pushes a stack frame onto the call stack; when nesting exceeds the engine\'s limit, the stack overflows' },
        { id: 'c', text: 'Recursive functions consume more heap memory than iterative equivalents' },
        { id: 'd', text: 'The event loop cannot process async callbacks during deep recursion' },
      ],
      correctOptionId: 'b',
      explanation: 'Each function call creates a stack frame containing local variables, arguments, and the return address. The call stack has a finite depth limit (typically ~10,000 calls in V8). Deep recursion (e.g. traversing a 100,000-item linked list recursively) exceeds this limit and throws a RangeError: Maximum call stack size exceeded. Tail call optimization or iterative approaches avoid this.',
    } satisfies QuizMCQConfig,
  },
  {
    id: 'mcq-algo-binary-search',
    type: 'QUIZ_MCQ',
    title: 'Algorithms: Binary Search',
    description: 'Tests understanding of binary search preconditions and complexity.',
    tags: ['algorithms', 'searching', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Algorithms',
    estimatedMinutes: 2,
    instructions: 'Choose the correct answer.',
    config: {
      question: 'What is the required precondition for binary search to work correctly?',
      options: [
        { id: 'a', text: 'The data must be stored in a hash map' },
        { id: 'b', text: 'The array must be sorted' },
        { id: 'c', text: 'The array must have an odd number of elements' },
        { id: 'd', text: 'The array must contain only integers' },
      ],
      correctOptionId: 'b',
      explanation: 'Binary search works by comparing the target to the middle element and eliminating half the search space each time. This only works if the array is sorted — otherwise, eliminating half the array is not safe. Binary search has O(log n) time complexity, compared to O(n) for linear search.',
    } satisfies QuizMCQConfig,
  },
];

// ─── QUIZ_SHORT_ANSWER Templates ─────────────────────────────────────────────

export const SHORT_ANSWER_TEMPLATES: ChallengeTemplate[] = [
  {
    id: 'sa-rest-vs-graphql',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'REST vs GraphQL Trade-offs',
    description: 'Candidate explains when they would choose GraphQL over REST and vice versa.',
    tags: ['architecture', 'api-design', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Architecture',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'When would you choose GraphQL over REST for an API, and when would you choose REST over GraphQL? Give one concrete reason for each.',
      placeholder: 'REST is better when... GraphQL is better when...',
      maxLength: 1000,
      rubric: 'Strong answers mention GraphQL\'s ability to fetch exactly the required data (avoiding over/under-fetching), its benefit for mobile or bandwidth-constrained clients, and its suitability when multiple clients need different data shapes from the same API. For REST: simplicity, HTTP caching, mature tooling, better for simple CRUD APIs, no query complexity to manage.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-state-management',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'When to Use Global State',
    description: 'Candidate reasons through when to lift state to global state management vs. local state.',
    tags: ['react', 'state-management', 'architecture', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Architecture',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'How do you decide when a piece of state should live in a global state store (like Redux or Zustand) vs. local component state? Walk through your decision process.',
      placeholder: 'I start by asking...',
      maxLength: 1000,
      rubric: 'Strong answers mention: (1) whether the state is needed by multiple unrelated components (if so, lift or globalize); (2) whether the state needs to persist across navigation; (3) whether it\'s derived/computed (prefer useMemo over global state); (4) server state vs. UI state (React Query handles server state better than Redux). Watch for candidates who default to Redux for everything — that signals over-engineering instinct.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-performance-debug',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Debugging a Slow Page Load',
    description: 'Candidate describes their process for diagnosing and fixing frontend performance issues.',
    tags: ['performance', 'debugging', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Performance',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'A page in your app is noticeably slow to load. Walk through the steps you would take to diagnose and fix the problem.',
      placeholder: 'First I would open DevTools and...',
      maxLength: 1000,
      rubric: 'Strong answers mention Chrome DevTools Performance panel or Lighthouse, checking Network tab for large/slow requests, checking bundle size (webpack-bundle-analyzer), looking for unnecessary re-renders (React Profiler), checking Core Web Vitals (LCP, CLS, FID/INP), and code-splitting large dependencies. Bonus: mention server-side vs client-side rendering trade-offs for initial load.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-accessibility',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Making a Component Accessible',
    description: 'Candidate explains what they would check to make a custom dropdown accessible.',
    tags: ['accessibility', 'wcag', 'html', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Accessibility',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'You\'ve been asked to build a custom dropdown menu component. What steps would you take to ensure it is accessible to keyboard and screen reader users?',
      placeholder: 'For keyboard access, I would...',
      maxLength: 1000,
      rubric: 'Strong answers cover: keyboard navigation (Tab to focus, Enter/Space to open, arrow keys to navigate options, Escape to close), ARIA roles (role="combobox" or role="listbox", aria-expanded, aria-haspopup, aria-selected), focus management (focus moves into list on open, returns to trigger on close), visible focus indicator, and using a native <select> as a fallback where possible. Bonus: mention testing with screen readers (NVDA, VoiceOver).',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-code-review-approach',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Your Code Review Approach',
    description: 'Candidate describes what they look for when reviewing a pull request.',
    tags: ['code-review', 'soft-skills', 'intermediate'],
    difficulty: 'beginner',
    topic: 'Engineering Practice',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'Describe your process for reviewing a pull request from a peer. What do you look for, and how do you balance thoroughness with speed?',
      placeholder: 'I start by...',
      maxLength: 1000,
      rubric: 'Strong answers mention: understanding the context/intent first (reading the PR description), checking correctness (does it do what it claims), looking for edge cases and error handling, checking test coverage, assessing readability and maintainability, looking for security issues, and being constructive in comments. Candidates who mention distinguishing blocking issues from suggestions (nits) show maturity. Red flag: candidates who only mention style/formatting as primary concern.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-testing-strategy',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Testing Strategy for a New Feature',
    description: 'Candidate outlines what types of tests they would write for a new feature.',
    tags: ['testing', 'tdd', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Engineering Practice',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'You\'re adding a new checkout flow to an e-commerce app. What types of tests would you write, and how would you prioritize them?',
      placeholder: 'I would write...',
      maxLength: 1000,
      rubric: 'Strong answers reference the testing pyramid: unit tests for individual functions (e.g. price calculation, coupon validation), integration tests for the cart→checkout→payment data flow, and at least one E2E test for the happy path (add item → checkout → payment → confirmation). Candidates should mention testing error states (payment failure, out of stock) and accessibility. Watch for candidates who only write unit tests or only E2E tests.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-css-architecture',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'CSS Architecture at Scale',
    description: 'Candidate explains how they would organize CSS for a large application.',
    tags: ['css', 'architecture', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'CSS',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'How do you approach CSS architecture in a large React application? What problems are you trying to prevent, and what techniques or tools do you use?',
      placeholder: 'The main problems I try to prevent are...',
      maxLength: 1000,
      rubric: 'Strong answers mention: specificity conflicts and cascade problems (solved by CSS Modules, CSS-in-JS, or strict BEM naming), unused CSS accumulation (tree-shaking with CSS Modules or purgecss), global style leakage (scoped styles), and design token usage for consistency. Tools to mention: CSS Modules, styled-components, Tailwind (utility-first), or vanilla-extract. Bonus: mention co-locating styles with components as a principle.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-monolith-vs-microservices',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Monolith vs Microservices',
    description: 'Candidate reasons about when microservices are the right architectural choice.',
    tags: ['architecture', 'backend', 'advanced'],
    difficulty: 'advanced',
    topic: 'Architecture',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'When would you recommend a microservices architecture over a monolith? What costs should a team expect when making that transition?',
      placeholder: 'I would recommend microservices when...',
      maxLength: 1000,
      rubric: 'Strong answers acknowledge that a well-structured monolith is the right starting point for most products. Microservices make sense when: different components have significantly different scaling needs, teams are large enough to own services independently (Conway\'s Law), or when different parts need different deployment cadences. Costs include: distributed system complexity (network failures, distributed transactions), latency overhead, operational burden (service discovery, observability), and the danger of a "distributed monolith" if service boundaries are wrong.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-async-error-handling',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Async Error Handling Strategy',
    description: 'Candidate explains their approach to handling errors in async React code.',
    tags: ['javascript', 'async', 'error-handling', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'What is your strategy for handling errors in async operations in a React application? How do you ensure users always see a meaningful message rather than a broken UI?',
      placeholder: 'At the hook level, I...',
      maxLength: 1000,
      rubric: 'Strong answers mention: try/catch around await calls, error state in hooks (const [error, setError] = useState(null)), error boundaries for unexpected render errors, distinguishing network errors from validation errors, and providing user-visible error messages (not raw error.message strings). Bonus: mention React Query\'s error handling, or retry logic for transient errors.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-explain-concept-simply',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Explain a Technical Concept Simply',
    description: 'Candidate demonstrates ability to communicate a complex concept to a non-technical audience.',
    tags: ['communication', 'soft-skills', 'beginner'],
    difficulty: 'beginner',
    topic: 'Communication',
    estimatedMinutes: 5,
    instructions: 'Write for a non-technical audience — no code, no jargon.',
    config: {
      question: 'Explain what an API is to someone who has never written code. Use a real-world analogy.',
      placeholder: 'An API is like...',
      maxLength: 500,
      rubric: 'Good answers use an accessible analogy (e.g. a restaurant menu and waiter — you (client) order from a menu (API contract), the waiter (API) takes your request to the kitchen (server), and brings back your food (response)). Candidates should avoid technical terms. A clear, concise analogy with one example of what an API enables (e.g. "how a weather app gets today\'s forecast") is the target.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-tradeoff-caching',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Caching Trade-offs',
    description: 'Candidate reasons through when caching helps vs. hurts.',
    tags: ['architecture', 'performance', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Architecture',
    estimatedMinutes: 5,
    instructions: 'Answer in 3–5 sentences.',
    config: {
      question: 'Caching can dramatically improve performance, but it also introduces problems. Describe the main trade-offs and how you decide what to cache and for how long.',
      placeholder: 'Caching helps when...',
      maxLength: 1000,
      rubric: 'Strong answers mention: cache invalidation as the hard problem (when data changes, stale cache can serve wrong data), TTL (time-to-live) as the simplest strategy, write-through vs. write-invalidate patterns, the cost of serving stale data vs. cache miss latency. Good candidates distinguish caching at different layers: browser cache, CDN, API/application cache, database query cache. Phil Karlton quote about naming things is a bonus.',
    } satisfies QuizShortAnswerConfig,
  },
  {
    id: 'sa-pair-programming',
    type: 'QUIZ_SHORT_ANSWER',
    title: 'Working with AI Coding Tools',
    description: 'Candidate reflects on how they use AI tools effectively in their workflow.',
    tags: ['ai-tools', 'workflow', 'soft-skills', 'beginner'],
    difficulty: 'beginner',
    topic: 'Engineering Practice',
    estimatedMinutes: 5,
    instructions: 'Be specific about when AI tools help and when they don\'t.',
    config: {
      question: 'How do you use AI coding assistants (like GitHub Copilot or ChatGPT) in your daily work? Where do they add the most value, and where do you find you can\'t rely on them?',
      placeholder: 'I find AI tools most useful for...',
      maxLength: 1000,
      rubric: 'Strong answers reflect genuine experience: AI tools help with boilerplate, test generation, documentation, and common patterns they\'ve seen before. They struggle with: application-specific context, novel problems, security-sensitive code (sometimes generates vulnerable patterns), and are confidently wrong about recent APIs or library versions. The best candidates mention that they always review and understand AI-generated code before committing it.',
    } satisfies QuizShortAnswerConfig,
  },
];

// ─── CODE_IMPLEMENTATION Templates ───────────────────────────────────────────

export const CODE_IMPLEMENTATION_TEMPLATES: ChallengeTemplate[] = [
  {
    id: 'impl-debounce',
    type: 'CODE_IMPLEMENTATION',
    title: 'Implement debounce()',
    description: 'Implement a debounce function that delays invoking fn until after wait ms have elapsed since the last call.',
    tags: ['javascript', 'closures', 'timers', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript Utilities',
    estimatedMinutes: 15,
    instructions: 'Implement the `debounce` function described in the problem statement. The implementation should handle the cancel method and the leading/trailing call behavior.',
    config: {
      language: 'javascript',
      starterCode: `/**
 * Creates a debounced version of fn that delays invoking it
 * until after wait milliseconds have elapsed since the last invocation.
 *
 * @param {Function} fn - The function to debounce
 * @param {number} wait - Milliseconds to delay
 * @returns {Function} - The debounced function with a .cancel() method
 */
function debounce(fn, wait) {
  // TODO: implement
}

// Example usage:
// const debouncedSearch = debounce(search, 300);
// debouncedSearch('react'); // won't fire
// debouncedSearch('react h'); // won't fire
// debouncedSearch('react hooks'); // fires 300ms after last call`,
      problemStatement: `## Implement debounce(fn, wait)

Debouncing limits how often a function can fire. A debounced function will only execute **wait ms after the last time it was called**. If it's called again before wait ms elapse, the timer resets.

**Requirements:**
1. Return a new function that, when called, resets the timer and schedules fn to be called after wait ms
2. If the debounced function is called again before wait ms elapse, cancel the previous timer and start a new one
3. When fn finally fires, it should receive the most recent arguments and the correct \`this\` context
4. The returned function should have a \`.cancel()\` method that cancels any pending invocation

**Examples:**
\`\`\`js
const fn = debounce(console.log, 500);
fn(1);        // timer set for 500ms
fn(2);        // previous timer cancelled, new timer set for 500ms
fn(3);        // previous timer cancelled, new timer set for 500ms
// ...500ms later → logs 3 (the most recent call's argument)
\`\`\``,
      examples: [
        {
          input: 'fn called 3 times within 100ms, wait = 500',
          output: 'fn fires once, 500ms after the third call',
          explanation: 'Each call resets the timer. Only the last call results in fn being invoked.',
        },
      ],
      constraints: [
        'The debounced function must pass the correct this context to fn',
        'The .cancel() method must clear any pending timer',
        'Do not use any external libraries',
      ],
    } satisfies CodeImplementationConfig,
  },

  {
    id: 'impl-throttle',
    type: 'CODE_IMPLEMENTATION',
    title: 'Implement throttle()',
    description: 'Implement a throttle function that ensures fn is called at most once per wait ms interval.',
    tags: ['javascript', 'closures', 'timers', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript Utilities',
    estimatedMinutes: 15,
    instructions: 'Implement the `throttle` function. It should invoke fn at most once per wait ms, executing immediately on the leading edge and optionally on the trailing edge.',
    config: {
      language: 'javascript',
      starterCode: `/**
 * Creates a throttled function that invokes fn at most once per wait ms.
 * The first call fires immediately (leading edge).
 *
 * @param {Function} fn - The function to throttle
 * @param {number} wait - Minimum ms between invocations
 * @returns {Function} - The throttled function
 */
function throttle(fn, wait) {
  // TODO: implement
}`,
      problemStatement: `## Implement throttle(fn, wait)

Throttling ensures a function is called at most once per time interval, regardless of how many times it is invoked. Unlike debounce, throttle fires the function **immediately** and then ignores calls for the next \`wait\` ms.

**Requirements:**
1. The first call to the throttled function must fire fn immediately (leading-edge execution)
2. Subsequent calls within the wait window are silently ignored
3. After wait ms have elapsed, the throttled function can fire again
4. fn should receive the correct arguments and \`this\` context

**Examples:**
\`\`\`js
const fn = throttle(console.log, 1000);
fn(1);  // fires immediately → logs 1
fn(2);  // ignored (within 1000ms window)
fn(3);  // ignored
// ...1000ms later...
fn(4);  // fires immediately → logs 4
\`\`\``,
      constraints: [
        'Leading-edge execution (fires immediately on first call)',
        'Must handle rapid successive calls without memory leaks',
        'No external libraries',
      ],
    } satisfies CodeImplementationConfig,
  },

  {
    id: 'impl-flatten',
    type: 'CODE_IMPLEMENTATION',
    title: 'Flatten Nested Array',
    description: 'Implement a function to flatten an arbitrarily nested array to any specified depth.',
    tags: ['javascript', 'recursion', 'arrays', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript Utilities',
    estimatedMinutes: 10,
    instructions: 'Implement the `flatten` function. Handle the depth parameter correctly and all edge cases.',
    config: {
      language: 'typescript',
      starterCode: `/**
 * Flattens a nested array up to the given depth.
 * Equivalent to Array.prototype.flat() — implement it from scratch.
 *
 * @param arr - The array to flatten
 * @param depth - Maximum depth to flatten (default: 1, Infinity for full flatten)
 * @returns A new flattened array
 */
function flatten<T>(arr: unknown[], depth: number = 1): T[] {
  // TODO: implement
}

// Examples:
// flatten([1, [2, [3, [4]]]]) → [1, 2, [3, [4]]]
// flatten([1, [2, [3, [4]]]], Infinity) → [1, 2, 3, 4]
// flatten([1, [2, [3]]], 0) → [1, [2, [3]]]`,
      problemStatement: `## Flatten Nested Array

Implement \`flatten(arr, depth)\` that returns a new array with all sub-array elements concatenated into it recursively up to the specified depth.

**Requirements:**
1. With depth = 1 (default), only one level of nesting is removed
2. With depth = Infinity, all levels of nesting are removed
3. With depth = 0, the array is returned unchanged
4. Should not mutate the input array
5. Should handle empty arrays and non-array elements correctly`,
      examples: [
        { input: 'flatten([1, [2, 3]])', output: '[1, 2, 3]' },
        { input: 'flatten([1, [2, [3]]])', output: '[1, 2, [3]]' },
        { input: 'flatten([1, [2, [3]]], Infinity)', output: '[1, 2, 3]' },
        { input: 'flatten([1, [2, [3]]], 0)', output: '[1, [2, [3]]]' },
      ],
      constraints: ['Do not use Array.prototype.flat()', 'Do not mutate the input array'],
    } satisfies CodeImplementationConfig,
  },

  {
    id: 'impl-memoize',
    type: 'CODE_IMPLEMENTATION',
    title: 'Implement memoize()',
    description: 'Implement a memoization wrapper that caches the results of a function by its arguments.',
    tags: ['typescript', 'caching', 'closures', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'JavaScript Utilities',
    estimatedMinutes: 15,
    instructions: 'Implement a generic `memoize` function. Consider how to handle multiple arguments and different argument types.',
    config: {
      language: 'typescript',
      starterCode: `/**
 * Returns a memoized version of fn.
 * Caches results based on the arguments passed.
 * Repeated calls with identical arguments return the cached result.
 *
 * @param fn - The function to memoize
 * @returns Memoized function with a .cache Map and .clear() method
 */
function memoize<T extends (...args: unknown[]) => unknown>(fn: T): T & {
  cache: Map<string, ReturnType<T>>;
  clear: () => void;
} {
  // TODO: implement
}

// Example:
// const memoFib = memoize((n: number): number =>
//   n <= 1 ? n : memoFib(n - 1) + memoFib(n - 2)
// );
// memoFib(40) // fast — each sub-problem computed once`,
      problemStatement: `## Implement memoize(fn)

Memoization is an optimization technique that stores the results of function calls and returns the cached result when the same inputs occur again.

**Requirements:**
1. Cache should be a Map keyed by a string representation of the arguments
2. If fn was previously called with the same arguments, return the cached result without calling fn again
3. Expose \`.cache\` (the Map) and \`.clear()\` (resets the cache) on the returned function
4. Handle functions with multiple arguments
5. Should work with recursive functions (see Fibonacci example)

**Examples:**
\`\`\`ts
let callCount = 0;
const expensive = memoize((n: number) => { callCount++; return n * 2; });

expensive(5); // → 10 (callCount = 1)
expensive(5); // → 10 (callCount still 1 — cached)
expensive(6); // → 12 (callCount = 2)
\`\`\``,
      constraints: [
        'The cache key must correctly distinguish different argument combinations',
        'Works for functions with 0–5 arguments of any serializable type',
      ],
    } satisfies CodeImplementationConfig,
  },

  {
    id: 'impl-event-emitter',
    type: 'CODE_IMPLEMENTATION',
    title: 'Implement EventEmitter',
    description: 'Implement a basic Node.js-style EventEmitter class with on, off, emit, and once methods.',
    tags: ['javascript', 'oop', 'observer-pattern', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'Design Patterns',
    estimatedMinutes: 20,
    instructions: 'Implement the EventEmitter class. Pay attention to the once() edge case and proper listener removal.',
    config: {
      language: 'typescript',
      starterCode: `class EventEmitter {
  // TODO: implement

  /**
   * Registers a listener for the given event.
   * Multiple listeners can be registered for the same event.
   */
  on(event: string, listener: (...args: unknown[]) => void): this {
    // TODO
    return this;
  }

  /**
   * Removes a previously registered listener.
   * If listener is not registered, does nothing.
   */
  off(event: string, listener: (...args: unknown[]) => void): this {
    // TODO
    return this;
  }

  /**
   * Emits an event, calling all registered listeners with the given args.
   */
  emit(event: string, ...args: unknown[]): boolean {
    // TODO: return true if the event had listeners, false otherwise
    return false;
  }

  /**
   * Registers a listener that fires at most once, then auto-removes itself.
   */
  once(event: string, listener: (...args: unknown[]) => void): this {
    // TODO
    return this;
  }
}`,
      problemStatement: `## Implement EventEmitter

Implement an EventEmitter class similar to Node.js's built-in EventEmitter.

**Methods to implement:**

| Method | Description |
|--------|-------------|
| \`on(event, listener)\` | Register a listener. Returns \`this\` for chaining. |
| \`off(event, listener)\` | Remove a registered listener by reference. |
| \`emit(event, ...args)\` | Call all listeners for the event. Returns \`true\` if there were listeners. |
| \`once(event, listener)\` | Register a listener that fires once then auto-removes itself. |

**Requirements:**
- Multiple listeners per event are supported and called in registration order
- \`off\` removes only the first matching listener by reference (not all)
- \`once\` listeners are removed before the listener is called (so recursive emit works)
- Methods should be chainable (return \`this\`)`,
      examples: [
        {
          input: `const emitter = new EventEmitter();
emitter.on('data', console.log);
emitter.emit('data', 'hello'); // logs 'hello'`,
          output: "'hello' logged to console, emit returns true",
        },
        {
          input: `emitter.once('connect', () => console.log('connected'));
emitter.emit('connect'); // logs 'connected'
emitter.emit('connect'); // nothing logged`,
          output: 'Listener fires once then is auto-removed',
        },
      ],
    } satisfies CodeImplementationConfig,
  },

  {
    id: 'impl-use-local-storage',
    type: 'CODE_IMPLEMENTATION',
    title: 'useLocalStorage React Hook',
    description: 'Build a custom React hook that syncs state with localStorage, handling JSON serialization and SSR.',
    tags: ['react', 'hooks', 'typescript', 'intermediate'],
    difficulty: 'intermediate',
    topic: 'React',
    estimatedMinutes: 20,
    instructions: 'Implement the `useLocalStorage` hook. It should behave like useState but persist values in localStorage.',
    config: {
      language: 'typescript',
      starterCode: `import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook that syncs state with localStorage.
 * Behaves like useState but persists the value across page reloads.
 *
 * @param key - localStorage key
 * @param initialValue - Default value if key is not in localStorage
 * @returns [storedValue, setValue] - Same API as useState
 */
function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // TODO: implement

  // Considerations:
  // 1. Reading from localStorage on mount
  // 2. Handling JSON parse errors (corrupted storage)
  // 3. Syncing changes back to localStorage
  // 4. Supporting functional updates (like useState's setState(prev => ...))
  // 5. What happens if localStorage is unavailable (SSR, private mode)?
}

export default useLocalStorage;`,
      problemStatement: `## useLocalStorage Hook

Build a custom React hook that provides the same interface as \`useState\` but syncs its value to \`localStorage\`, so the state persists across page reloads.

**API:**
\`\`\`ts
const [value, setValue] = useLocalStorage('theme', 'light');
// setValue('dark')                    // sets state + updates localStorage
// setValue(prev => prev === 'dark' ? 'light' : 'dark')  // functional update
\`\`\`

**Requirements:**
1. Initialize from localStorage if the key exists; otherwise use initialValue
2. Serialize/deserialize with JSON.stringify/JSON.parse
3. Handle JSON parse errors gracefully (corrupted storage) — fall back to initialValue
4. Support functional updates: \`setValue(prev => ...)\`
5. Handle environments where localStorage may be unavailable (SSR, private mode) without throwing`,
      constraints: [
        'Must support generic type T',
        'Must handle localStorage unavailability gracefully',
        'Should not cause infinite render loops',
      ],
    } satisfies CodeImplementationConfig,
  },

  {
    id: 'impl-deep-clone',
    type: 'CODE_IMPLEMENTATION',
    title: 'Deep Clone Object',
    description: 'Implement a deep clone function that handles nested objects, arrays, Dates, and circular references.',
    tags: ['javascript', 'recursion', 'objects', 'advanced'],
    difficulty: 'advanced',
    topic: 'JavaScript Utilities',
    estimatedMinutes: 20,
    instructions: 'Implement `deepClone`. Handle all the edge cases described — especially circular references.',
    config: {
      language: 'javascript',
      starterCode: `/**
 * Creates a deep clone of the given value.
 * Handles: primitives, objects, arrays, Date, circular references.
 * Does NOT need to handle: functions, WeakMap, WeakSet, Symbol keys.
 *
 * @param {*} value - The value to clone
 * @param {WeakMap} [seen] - Internal: tracks visited objects for circular ref detection
 * @returns {*} A deep clone
 */
function deepClone(value, seen = new WeakMap()) {
  // TODO: implement
}

// Tests to pass:
// deepClone(42) → 42
// deepClone({ a: { b: 1 } }) → { a: { b: 1 } } (different reference)
// deepClone([1, [2, 3]]) → [1, [2, 3]] (different reference)
// deepClone(new Date('2024-01-01')) → new Date('2024-01-01') (Date instance)
// const obj = {}; obj.self = obj;
// deepClone(obj) → no infinite loop (handles circular reference)`,
      problemStatement: `## Deep Clone

Implement \`deepClone(value)\` that creates a structurally identical but fully independent copy of the input.

**Must handle:**
- Primitives (numbers, strings, booleans, null, undefined) — return as-is
- Plain objects — deeply clone all own enumerable properties
- Arrays — deeply clone all elements
- Date objects — clone as a new Date with the same timestamp
- Circular references — if object A references B which references A, do not infinite-loop; the cloned structure should mirror the circular structure

**Does not need to handle:**
- Functions (can be copied by reference or omitted)
- Symbol keys
- Map, Set, WeakMap, RegExp (bonus if you handle them)

**Example — circular reference:**
\`\`\`js
const a = { name: 'a' };
const b = { name: 'b', ref: a };
a.ref = b;  // circular!

const cloneA = deepClone(a);
cloneA !== a              // true (different object)
cloneA.ref !== b          // true (b is also cloned)
cloneA.ref.ref === cloneA // true (circular structure preserved)
\`\`\``,
      constraints: ['No JSON.parse/stringify (would fail on dates and circles)', 'No lodash or external libraries'],
    } satisfies CodeImplementationConfig,
  },
];

// ─── FOLLOW_UP Templates ─────────────────────────────────────────────────────

export const FOLLOW_UP_TEMPLATES: ChallengeTemplate[] = [
  {
    id: 'follow-up-standard',
    type: 'FOLLOW_UP',
    title: 'Follow-Up Questions',
    description: 'AI-generated follow-up questions based on the candidate\'s previous challenge submission. Probes depth of understanding through a debrief conversation.',
    tags: ['follow-up', 'ai-generated', 'debrief'],
    difficulty: 'intermediate',
    topic: 'Assessment',
    estimatedMinutes: 5,
    instructions: 'Answer 5 follow-up questions generated from your previous submission.',
    config: {},
  },
];

// ─── Aggregated Exports ──────────────────────────────────────────────────────

/** All templates combined — used for the Challenge Picker search index */
export const ALL_CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  ...CODE_REVIEW_TEMPLATES,
  ...QUIZ_MCQ_TEMPLATES,
  ...SHORT_ANSWER_TEMPLATES,
  ...CODE_IMPLEMENTATION_TEMPLATES,
  ...FOLLOW_UP_TEMPLATES,
];

/** Template lookup by ID */
export const TEMPLATE_BY_ID: Record<string, ChallengeTemplate> = Object.fromEntries(
  ALL_CHALLENGE_TEMPLATES.map(t => [t.id, t])
);

/** All unique topics for the Challenge Picker filter dropdown */
export const ALL_TOPICS: string[] = [
  ...new Set(ALL_CHALLENGE_TEMPLATES.map(t => t.topic)),
].sort();

/** Stats for quick display */
export const LIBRARY_STATS = {
  total: ALL_CHALLENGE_TEMPLATES.length,
  byType: {
    CODE_REVIEW: CODE_REVIEW_TEMPLATES.length,
    QUIZ_MCQ: QUIZ_MCQ_TEMPLATES.length,
    QUIZ_SHORT_ANSWER: SHORT_ANSWER_TEMPLATES.length,
    CODE_IMPLEMENTATION: CODE_IMPLEMENTATION_TEMPLATES.length,
    FOLLOW_UP: FOLLOW_UP_TEMPLATES.length,
  },
} as const;
