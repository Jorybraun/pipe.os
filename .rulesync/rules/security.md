---
name: Security Standards
targets: ["*"]
description: "AWS Amplify Auth patterns, security best practices, and data protection guidelines"
globs: []
alwaysApply: false
---

# Security Standards

## Authentication

### AWS Amplify Auth

All authentication is handled through AWS Amplify Auth backed by Amazon Cognito.

```typescript
// Configure in main.tsx
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";

Amplify.configure(outputs);
```

### Protected Routes

```typescript
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import { Navigate } from "react-router-dom";

// Wrap entire app or specific sections
function App() {
  return (
    <Authenticator>
      {({ user }) => (
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pipelines" element={<Pipelines />} />
        </Routes>
      )}
    </Authenticator>
  );
}

// Or create a protected route component
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { authStatus } = useAuthenticator();

  if (authStatus === "configuring") {
    return <LoadingSpinner />;
  }

  if (authStatus !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

### Auth State Management

```typescript
import { getCurrentUser, fetchAuthSession, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";

// Check current authentication state
async function checkAuth() {
  try {
    const user = await getCurrentUser();
    return user;
  } catch {
    return null; // Not authenticated
  }
}

// Get access token for API calls
async function getAccessToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

// Listen to auth events
function useAuthListener() {
  useEffect(() => {
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      switch (payload.event) {
        case "signedIn":
          console.log("User signed in");
          break;
        case "signedOut":
          console.log("User signed out");
          break;
        case "tokenRefresh":
          console.log("Token refreshed");
          break;
        case "tokenRefresh_failure":
          console.error("Token refresh failed");
          break;
      }
    });

    return () => unsubscribe();
  }, []);
}
```

## Authorization

### Amplify Data Authorization Rules

Define authorization at the model level in your schema:

```typescript
// amplify/data/resource.ts
const schema = a.schema({
  // Owner-only access
  PrivatePipeline: a
    .model({
      name: a.string().required(),
      content: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  // Team access with roles
  TeamPipeline: a
    .model({
      name: a.string().required(),
      teamId: a.string().required(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group("admins"),
      allow.group("managers").to(["read", "update"]),
      allow.group("viewers").to(["read"]),
    ]),

  // Public read, authenticated create
  PublicPipeline: a
    .model({
      name: a.string().required(),
      isPublished: a.boolean().default(false),
    })
    .authorization((allow) => [
      allow.guest().to(["read"]),
      allow.authenticated().to(["read", "create"]),
      allow.owner(),
    ]),

  // Field-level authorization
  CandidateProfile: a
    .model({
      name: a.string().required(),
      email: a.email().required(),
      // Only owner can see private notes
      privateNotes: a.string().authorization((allow) => [allow.owner()]),
      // Only admins can see internal score
      internalScore: a
        .float()
        .authorization((allow) => [allow.group("admins")]),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(["read"]),
    ]),
});
```

### Client-side Authorization Checks

```typescript
// Check user group membership
import { fetchAuthSession } from "aws-amplify/auth";

async function getUserGroups(): Promise<string[]> {
  const session = await fetchAuthSession();
  const groups = session.tokens?.accessToken?.payload["cognito:groups"];
  return Array.isArray(groups) ? groups : [];
}

async function isAdmin(): Promise<boolean> {
  const groups = await getUserGroups();
  return groups.includes("admins");
}

// Component with role-based rendering
function AdminPanel() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    getUserGroups().then((groups) => {
      setIsAdmin(groups.includes("admins"));
    });
  }, []);

  if (!isAdmin) {
    return <AccessDenied />;
  }

  return <AdminDashboard />;
}
```

## Input Validation

### Client-side Validation with Zod

```typescript
import { z } from "zod";

// Define schemas
const PipelineSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less")
    .regex(
      /^[a-zA-Z0-9\s-]+$/,
      "Name can only contain letters, numbers, spaces, and hyphens"
    ),
  description: z
    .string()
    .max(1000, "Description must be 1000 characters or less")
    .optional(),
  maxCandidates: z
    .number()
    .int("Must be a whole number")
    .min(1, "Must have at least 1 candidate")
    .max(10000, "Cannot exceed 10,000 candidates")
    .default(100),
});

type PipelineInput = z.infer<typeof PipelineSchema>;

// Validate input
function validatePipeline(input: unknown): PipelineInput {
  return PipelineSchema.parse(input);
}

// Safe validation (returns result object)
function safeParsePipeline(input: unknown) {
  const result = PipelineSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.flatten().fieldErrors,
    };
  }
  return { success: true, data: result.data };
}
```

### Form Validation

```typescript
import { z } from "zod";

const FormSchema = z
  .object({
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain an uppercase letter")
      .regex(/[a-z]/, "Password must contain a lowercase letter")
      .regex(/[0-9]/, "Password must contain a number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

function SignUpForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (formData: FormData) => {
    const input = {
      email: formData.get("email"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    };

    const result = FormSchema.safeParse(input);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const [field, messages] of Object.entries(
        result.error.flatten().fieldErrors
      )) {
        fieldErrors[field] = messages?.[0] ?? "Invalid";
      }
      setErrors(fieldErrors);
      return;
    }

    // Proceed with valid data
    submitSignUp(result.data);
  };

  return (
    <form action={handleSubmit}>
      <input name="email" type="email" />
      {errors.email && <span className="error">{errors.email}</span>}
      {/* ... */}
    </form>
  );
}
```

## XSS Prevention

### Content Sanitization

React automatically escapes content in JSX:

```typescript
// Safe - React escapes this automatically
function DisplayName({ name }: { name: string }) {
  return <div>{name}</div>;
}

// Even with user input containing HTML
<DisplayName name="<script>alert('xss')</script>" />;
// Renders as text: <script>alert('xss')</script>
```

### Dangerous Patterns to Avoid

```typescript
// NEVER use dangerouslySetInnerHTML with user content
function BadComponent({ userHtml }: { userHtml: string }) {
  return <div dangerouslySetInnerHTML={{ __html: userHtml }} />; // XSS vulnerability!
}

// If you must render HTML, sanitize it first
import DOMPurify from "dompurify";

function SafeHtmlComponent({ html }: { html: string }) {
  const sanitizedHtml = DOMPurify.sanitize(html);
  return <div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}

// NEVER construct URLs from user input without validation
function BadLink({ userUrl }: { userUrl: string }) {
  return <a href={userUrl}>Click here</a>; // Could be javascript:evil()
}

// Validate URLs
function SafeLink({ userUrl }: { userUrl: string }) {
  let validUrl = "#";
  try {
    const url = new URL(userUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      validUrl = url.toString();
    }
  } catch {
    // Invalid URL, use fallback
  }
  return <a href={validUrl}>Click here</a>;
}
```

## Secrets Management

### Environment Variables

```typescript
// In Vite, environment variables must be prefixed with VITE_
// Access in code:
const apiUrl = import.meta.env.VITE_API_URL;

// Never expose secrets in client code!
// BAD - This would be visible in browser
const apiKey = import.meta.env.VITE_API_KEY;

// Use Amplify backend for server-side secrets
// amplify/functions/my-function/resource.ts
export const myFunction = defineFunction({
  name: "myFunction",
  environment: {
    API_KEY: secret("API_KEY"), // Stored securely in AWS
  },
});
```

### Amplify Sandbox Secrets

```bash
# Set a secret for development
npx ampx sandbox secret set API_KEY

# Set a secret for production
npx ampx secret set API_KEY --branch main
```

## Security Headers

### Content Security Policy

Configure in your hosting settings or serverless functions:

```typescript
// For Amplify hosting, use amplify/hosting/csp.json
{
  "customHeaders": [
    {
      "pattern": "**/*",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    }
  ]
}
```

## Logging Security

### What NOT to Log

```typescript
// NEVER log:
// - Passwords or secrets
// - Full API tokens or session tokens
// - Personal identifiable information (PII)
// - Credit card numbers
// - Full request/response bodies with sensitive data

// BAD
console.log("User login:", { email, password });
console.log("API response:", response.data); // May contain sensitive data

// GOOD
console.log("User login attempt:", { email: maskEmail(email) });
console.log("API response received:", {
  status: response.status,
  dataLength: response.data?.length,
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local[0]}***@${domain}`;
}
```

### Audit Logging

```typescript
// Log security-relevant events
function logSecurityEvent(event: {
  type: "login" | "logout" | "permission_denied" | "data_export";
  userId?: string;
  details: Record<string, unknown>;
}) {
  console.log("[SECURITY]", {
    timestamp: new Date().toISOString(),
    ...event,
  });
}

// Usage
logSecurityEvent({
  type: "permission_denied",
  userId: user.id,
  details: {
    resource: "pipeline",
    action: "delete",
    reason: "not_owner",
  },
});
```

## Security Checklist

### Before Deployment

- [ ] All API endpoints require authentication (unless intentionally public)
- [ ] Authorization rules are defined for all data models
- [ ] Input validation is implemented for all user inputs
- [ ] No secrets are hardcoded in client code
- [ ] Environment variables are properly configured
- [ ] Content Security Policy is configured
- [ ] HTTPS is enforced
- [ ] Error messages don't leak sensitive information
- [ ] Audit logging is in place for security events
- [ ] Dependencies are up to date (no known vulnerabilities)
