/**
 * Server-side pipeline presets.
 *
 * Self-contained — no imports from the frontend codebase.
 * Template data is copied verbatim from src/content/challengeLibrary.ts
 * and src/lib/pipelinePresets.ts.
 *
 * When challenge templates change in the frontend library, mirror the
 * relevant templates here.
 */

export type ChallengeType =
  | 'CODE_REVIEW'
  | 'CODE_IMPLEMENTATION'
  | 'QUIZ_MCQ'
  | 'QUIZ_SHORT_ANSWER'
  | 'FOLLOW_UP'
  | 'INTAKE';

export interface PresetChallenge {
  type: ChallengeType;
  title: string;
  instructions: string;
  /** Public config serialised to JSON before writing to D1. */
  config: Record<string, unknown>;
  /** Private server config (answer keys). Never sent to clients. */
  serverConfig?: Record<string, unknown>;
}

export interface PresetStage {
  title: string;
  description?: string;
  sortOrder: number;
  challenges: PresetChallenge[];
}

export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  stages: PresetStage[];
}

// ─── Challenge templates used by presets ─────────────────────────────────────

const CR_JWT_AUTH_BYPASS: PresetChallenge = {
  type: 'CODE_REVIEW',
  title: 'JWT Auth Middleware',
  instructions:
    'Review this Express authentication middleware. Identify all security vulnerabilities and logic errors. Annotate each bug with its location, type, and a brief explanation of the impact.',
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
  },
  serverConfig: {
    groundTruth: [
      {
        line: 9,
        type: 'SECURITY',
        severity: 'critical',
        explanation:
          'The JWT payload is decoded but the signature is never verified with a secret key. Any attacker can craft a token claiming any identity or role.',
      },
      {
        line: 11,
        type: 'LOGIC',
        severity: 'critical',
        explanation:
          'Using assignment (=) instead of comparison (===) unconditionally sets user.isAdmin to true, granting admin access to every request.',
      },
    ],
  },
};

const MCQ_REACT_USE_EFFECT: PresetChallenge = {
  type: 'QUIZ_MCQ',
  title: 'React: useEffect',
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
    explanation:
      "useEffect is React's escape hatch for side effects like data fetching, subscriptions, and DOM mutations. It runs after every render by default, or only when specified dependencies change.",
  },
};

const MCQ_TS_INTERFACE_VS_TYPE: PresetChallenge = {
  type: 'QUIZ_MCQ',
  title: 'TypeScript: interface vs type',
  instructions: 'Choose the correct answer.',
  config: {
    question:
      'In TypeScript, what is the primary structural difference between an interface and a type alias?',
    options: [
      { id: 'a', text: 'Interfaces can be extended, type aliases cannot' },
      { id: 'b', text: 'Type aliases can be extended, interfaces cannot' },
      { id: 'c', text: 'Interfaces support declaration merging, type aliases do not' },
      { id: 'd', text: 'There is no meaningful difference' },
    ],
    correctOptionId: 'c',
    explanation:
      'Interfaces support declaration merging — you can declare the same interface name multiple times and TypeScript will merge the declarations. Both interfaces and type aliases support extension/intersection, but only interfaces can be merged.',
  },
};

// ─── Preset definitions ───────────────────────────────────────────────────────

const PRESETS: Record<string, PipelinePreset> = {
  DEFAULT: {
    id: 'DEFAULT',
    name: 'Default MVP',
    description: 'Includes a Code Review challenge and a Technical Quiz.',
    stages: [
      {
        title: 'Technical Assessment',
        sortOrder: 0,
        challenges: [CR_JWT_AUTH_BYPASS, MCQ_REACT_USE_EFFECT, MCQ_TS_INTERFACE_VS_TYPE],
      },
    ],
  },
  BLANK: {
    id: 'BLANK',
    name: 'Blank Pipeline',
    description: 'Start with an empty pipeline and build it from scratch.',
    stages: [],
  },
};

/**
 * Returns the preset definition for the given ID, or `null` if unknown.
 *
 * @param presetId - Case-sensitive preset identifier (e.g. 'DEFAULT', 'BLANK').
 */
export function expandPreset(presetId: string): PipelinePreset | null {
  return PRESETS[presetId] ?? null;
}
