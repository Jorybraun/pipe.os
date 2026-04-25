# ADR-018: Dev Container Access Control

**Status:** Proposed  
**Date:** 2026-03-07  
**Deciders:** Engineering Team  
**Related:** [ADR-016: Dev Container Architecture](./ADR-016-dev-container-architecture.md)

## Context

Dev containers (code-server instances) are exposed via a public ALB on HTTP. Without access control, anyone with the session URL can access a candidate's interview environment. We need to ensure:

1. Only authorized users (recruiter + candidate) can access a session
2. Sessions cannot be embedded in third-party sites
3. Direct URL access is prevented
4. Minimal friction for legitimate users

### Current State
- ALB routes `/session/{id}/*` to container IP:8080
- code-server has password auth (random, unknown to app)
- No additional access control layer
- URLs are predictable (session ID in path)

### Security Threats
1. **URL Sharing:** Candidate shares URL with friend for help
2. **URL Guessing:** Attacker brute-forces session IDs
3. **Embedding Attacks:** Malicious site iframes the session
4. **Session Hijacking:** Attacker intercepts URL from network traffic

## Decision

Implement **multi-layer access control** using:

### Layer 1: Signed Session Tokens (Primary)
- Backend generates short-lived JWT tokens (60-min TTL)
- Token includes: `sessionId`, `userId`, `role` (recruiter/candidate), `exp`
- URL format: `http://alb/session/{id}/?token={jwt}`
- Lambda@Edge validates token before forwarding to container

### Layer 2: WAF Rules (Defense in Depth)
- AWS WAF on ALB blocks requests without:
  - Valid `Referer` header (app domain)
  - OR valid token query parameter
- Rate limiting: 100 req/min per IP per session

### Layer 3: code-server Auth Disabled
- Remove password auth (set `--auth none`)
- Access control handled entirely by Layers 1 & 2
- Simplifies UX (no password prompt)

### Layer 4: Network Egress Hardening (Existing)
- Containers cannot access internet (ADR-017)
- Prevents data exfiltration

## Implementation

### Token Generation (Backend)
```typescript
// In devContainerLaunch Lambda or AppSync resolver
const token = jwt.sign(
  { sessionId, userId, role: 'candidate', exp: Date.now() + 3600000 },
  process.env.SESSION_SECRET
);
const url = `http://${albDomain}/session/${sessionId}/?token=${token}`;
```

### Token Validation (Lambda@Edge)
```typescript
// CloudFront Origin Request trigger
export const handler = async (event) => {
  const request = event.Records[0].cf.request;
  const token = request.querystring.match(/token=([^&]+)/)?.[1];
  
  if (!token) return { status: 403, body: 'Forbidden' };
  
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    if (payload.sessionId !== extractSessionId(request.uri)) {
      return { status: 403, body: 'Invalid token' };
    }
    return request; // Forward to ALB
  } catch {
    return { status: 403, body: 'Invalid or expired token' };
  }
};
```

### WAF Rule (Terraform)
```hcl
resource "aws_wafv2_web_acl" "dev_containers" {
  rule {
    name     = "require-referer-or-token"
    priority = 1
    statement {
      or_statement {
        statement {
          byte_match_statement {
            field_to_match { single_header { name = "referer" } }
            positional_constraint = "CONTAINS"
            search_string = var.app_domain
          }
        }
        statement {
          byte_match_statement {
            field_to_match { single_query_argument { name = "token" } }
            positional_constraint = "EXACTLY"
            search_string = "eyJ" # JWT prefix
          }
        }
      }
    }
    action { allow {} }
  }
  default_action { block {} }
}
```

## Alternatives Considered

### A. Password-Based Auth (Current)
- **Pros:** Simple, built-in to code-server
- **Cons:** Password unknown to app, poor UX, no session binding
- **Rejected:** Cannot integrate with app auth

### B. OAuth2 Proxy
- **Pros:** Industry standard, mature
- **Cons:** Adds latency, complex setup, overkill for ephemeral sessions
- **Rejected:** Too heavy for 60-min sessions

### C. VPN / Private Network
- **Pros:** Strong isolation
- **Cons:** Requires candidate VPN setup, terrible UX
- **Rejected:** Non-starter for public interviews

### D. IP Whitelisting
- **Pros:** Simple
- **Cons:** Candidates on mobile/dynamic IPs, doesn't prevent URL sharing
- **Rejected:** Incompatible with remote interviews

### E. CloudFront Signed URLs
- **Pros:** AWS-native, no custom Lambda
- **Cons:** Cannot validate session-specific claims, 24hr min TTL
- **Rejected:** Insufficient granularity

## Consequences

### Positive
- ✅ Prevents unauthorized access (URL sharing, guessing)
- ✅ Prevents embedding attacks (WAF Referer check)
- ✅ Session-specific tokens (cannot reuse across sessions)
- ✅ Time-limited access (auto-expires after interview)
- ✅ No password UX friction
- ✅ Audit trail (token claims logged)

### Negative
- ⚠️ Adds Lambda@Edge (cold start latency ~100ms)
- ⚠️ Token in URL (visible in browser history, logs)
- ⚠️ Requires secret rotation strategy
- ⚠️ WAF costs (~$5/month + $1 per million requests)

### Mitigations
- Use CloudFront caching to reduce Lambda@Edge invocations
- Rotate `SESSION_SECRET` monthly via AWS Secrets Manager
- Consider moving token to `Authorization` header (requires proxy)

## Compliance

- **GDPR:** Session tokens are pseudonymous identifiers (not PII)
- **SOC 2:** Access control + audit logging satisfies AC-3
- **OWASP Top 10:** Mitigates A01 (Broken Access Control)

## Future Enhancements

1. **Token Refresh:** Allow extending session without new URL
2. **Multi-Device:** Same token works on recruiter + candidate devices
3. **Revocation:** Invalidate tokens on session end
4. **mTLS:** Mutual TLS between app and ALB (overkill for MVP)

## References

- [AWS WAF Best Practices](https://docs.aws.amazon.com/waf/latest/developerguide/security-best-practices.html)
- [Lambda@Edge Use Cases](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-examples.html)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [ADR-016: Dev Container Architecture](./ADR-016-dev-container-architecture.md)
- [ADR-017: Dev Container Egress Hardening](./ADR-017-dev-container-egress-hardening.md)
