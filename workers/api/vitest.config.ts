import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    root: '.',
    include: [
      'src/**/__tests__/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
    exclude: [
      '**/.worktrees/**',
      'node_modules',
    ],
    environment: 'node',
  },
  resolve: {
    alias: {
      // `cloudflare:workers` is a workerd virtual module — node/vitest needs
      // a stub so unit tests that import DurableObject can load.
      'cloudflare:workers': path.resolve(
        __dirname,
        'src/__tests__/stubs/cloudflare-workers.ts',
      ),
      // `@cloudflare/containers` transitively imports `cloudflare:workers` and
      // therefore cannot load under plain Node. Redirect to a minimal stub.
      '@cloudflare/containers': path.resolve(
        __dirname,
        'src/__tests__/stubs/cloudflare-containers.ts',
      ),
    },
  },
});
