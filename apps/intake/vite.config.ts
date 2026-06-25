import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
      '/rpc': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
