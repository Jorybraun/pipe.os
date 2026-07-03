import { describe, expect, it } from 'vitest';

import {
  resolveAppDevBasicAuth,
  resolveCodeReviewSmokeD1Target,
} from './smoke-code-review-assess-dev.mjs';

describe('CODE_REVIEW assess smoke app-dev Basic Auth resolution', () => {
  it('prefers app-dev-specific credentials over generic dev credentials', () => {
    expect(resolveAppDevBasicAuth({
      PIPE_APP_DEV_BASIC_AUTH_USER: 'app-user',
      PIPE_APP_DEV_BASIC_AUTH_PASSWORD: 'app-pass',
      PIPE_DEV_BASIC_AUTH_USER: 'generic-user',
      PIPE_DEV_BASIC_AUTH_PASSWORD: 'generic-pass',
    })).toEqual({
      user: 'app-user',
      password: 'app-pass',
    });
  });

  it('supports APP_DEV aliases used by other deployed app smokes', () => {
    expect(resolveAppDevBasicAuth({
      APP_DEV_BASIC_AUTH_USER: 'alias-user',
      APP_DEV_BASIC_AUTH_PASSWORD: 'alias-pass',
    })).toEqual({
      user: 'alias-user',
      password: 'alias-pass',
    });
  });

  it('keeps the legacy PIPE_DEV and DEV fallbacks', () => {
    expect(resolveAppDevBasicAuth({
      DEV_BASIC_AUTH_USER: 'legacy-user',
      DEV_BASIC_AUTH_PASSWORD: 'legacy-pass',
    })).toEqual({
      user: 'legacy-user',
      password: 'legacy-pass',
    });
  });

  it('uses remote D1 verification for deployed app-dev smokes', () => {
    expect(resolveCodeReviewSmokeD1Target({
      apiBase: 'https://api-dev.hire-pipe.com',
      rpcBase: 'https://api-dev.hire-pipe.com',
      env: {},
    })).toEqual({
      remote: true,
      databaseName: 'pipe-db-test',
      label: 'remote',
    });
  });

  it('keeps local D1 verification for localhost smokes', () => {
    expect(resolveCodeReviewSmokeD1Target({
      apiBase: 'http://localhost:8787',
      rpcBase: 'http://localhost:8787',
      env: {},
    })).toEqual({
      remote: false,
      databaseName: 'pipe-db',
      label: 'local',
    });
  });

  it('honors explicit CODE_REVIEW smoke D1 database names for both targets', () => {
    expect(resolveCodeReviewSmokeD1Target({
      apiBase: 'https://api-dev.hire-pipe.com',
      rpcBase: 'https://api-dev.hire-pipe.com',
      env: { CODE_REVIEW_SMOKE_D1_DATABASE: 'pipe-db-custom' },
    })).toEqual({
      remote: true,
      databaseName: 'pipe-db-custom',
      label: 'remote',
    });
  });
});
