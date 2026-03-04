import { defineConfig } from 'vitest';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts']
  },
});