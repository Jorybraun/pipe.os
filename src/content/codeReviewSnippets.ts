/**
 * Code Review Snippets for Phase 2 MVP.
 * Each snippet contains buggy code and ground truth for scoring.
 * 
 * Bug Types:
 * - SECURITY: SQL injection, XSS, insecure auth, data leak
 * - LOGIC: Wrong operator, off-by-one, null/undefined crash, race condition
 * - PERFORMANCE: Memory leak, O(n^2), redundant re-renders, blocking loop
 * - EDGE_CASE: Empty input, negative value, overflow, timezone
 */

export interface Bug {
  line: number;
  type: 'SECURITY' | 'LOGIC' | 'PERFORMANCE' | 'EDGE_CASE';
  severity: 'critical' | 'major' | 'minor';
  explanation: string;
}

export interface CodeReviewSnippet {
  id: string;
  title: string;
  code: string;
  language: string;
  groundTruth: Bug[];
}

export const codeReviewSnippets: CodeReviewSnippet[] = [
  {
    id: 'js-auth-logic',
    title: 'JS_AUTH_MIDDLEWARE_CHALLENGE',
    language: 'javascript',
    code: `async function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  
  if (!token) {
    return res.status(401).send('Unauthorized');
  }

  try {
    // SECURITY: Potentially insecure token parsing
    const user = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    // LOGIC: Using assignment instead of comparison
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
        line: 11,
        type: 'SECURITY',
        severity: 'critical',
        explanation: 'The code parses the JWT payload without verifying the signature. Any user can spoof admin rights by sending a crafted token.'
      },
      {
        line: 14,
        type: 'LOGIC',
        severity: 'major',
        explanation: 'Using assignment (user.isAdmin = true) instead of comparison (user.isAdmin === true) will make every user an admin.'
      }
    ]
  },
  {
    id: 'ts-perf-edge',
    title: 'Data processing & cache',
    language: 'typescript',
    code: `function processItems(items: Item[]) {
  const result = [];
  
  // PERFORMANCE: O(n^2) search in a loop
  for (let i = 0; i < items.length; i++) {
    const isDuplicate = result.find(r => r.id === items[i].id);
    
    if (!isDuplicate) {
      // LOGIC: Potential null reference
      result.push({
        id: items[i].id,
        processed: items[i].metadata.timestamp > Date.now()
      });
    }
  }

  // EDGE_CASE: No handling for empty array
  return result[0].processed ? result : [];
}`,
    groundTruth: [
      {
        line: 6,
        type: 'PERFORMANCE',
        severity: 'major',
        explanation: 'Searching the result array inside the loop creates O(n^2) complexity. Should use a Set or Map for O(1) lookups.'
      },
      {
        line: 11,
        type: 'LOGIC',
        severity: 'minor',
        explanation: 'Accessing items[i].metadata.timestamp might crash if metadata is undefined.'
      },
      {
        line: 17,
        type: 'EDGE_CASE',
        severity: 'major',
        explanation: 'If items is empty, result[0] will be undefined and crash the application.'
      }
    ]
  },
  {
    id: 'all-around-bugs',
    title: 'JS_USER_REGISTRATION_SERVICE',
    language: 'javascript',
    code: `async function registerUser(email, password) {
  // SECURITY: SQL Injection vulnerability
  const query = \`SELECT * FROM users WHERE email = '\${email}'\`;
  const existingUser = await db.query(query);

  if (existingUser) {
    throw new Error("User already exists");
  }

  // LOGIC: Not awaiting the hash operation
  const hashedPassword = bcrypt.hash(password, 10);
  
  // PERFORMANCE: Heavy logging in production
  console.log("DEBUG: Storing password hash: ", hashedPassword);

  // EDGE_CASE: No password length validation
  return await db.users.create({ 
    email, 
    password: hashedPassword,
    createdAt: new Date().toISOString()
  });
}`,
    groundTruth: [
      {
        line: 3,
        type: 'SECURITY',
        severity: 'critical',
        explanation: 'Directly embedding the email in the query string allows for SQL injection.'
      },
      {
        line: 11,
        type: 'LOGIC',
        severity: 'major',
        explanation: 'The hash operation is async and needs to be awaited. Storing a promise object in the database.'
      },
      {
        line: 14,
        type: 'PERFORMANCE',
        severity: 'minor',
        explanation: 'Logging sensitive information like password hashes (even if hashed) is a bad practice and console.log is blocking.'
      },
      {
        line: 17,
        type: 'EDGE_CASE',
        severity: 'major',
        explanation: 'Missing validation for password length or complexity could allow weak credentials.'
      }
    ]
  }
];
