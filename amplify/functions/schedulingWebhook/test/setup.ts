import { expect } from 'vitest';

// Bypassing aws-sdk-client-mock-jest matchers as they are causing Chalk TypeErrors in this environment.
// Using manual verification via commandCalls() instead.
