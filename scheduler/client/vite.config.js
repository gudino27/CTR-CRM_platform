import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig(({ mode }) => {
  // The API's PORT lives in the shared scheduler/.env
  const { PORT = '3000' } = loadEnv(mode, '..', '');
  return {
    plugins: [react()],
    cacheDir: join(tmpdir(), 'ctr-scheduler-vite'),
    server: {
      port: 5173,
      // 127.0.0.1 rather than localhost, so another app on the same port over IPv6 can't answer instead
      proxy: { '/api': `http://127.0.0.1:${PORT}` },
    },
  };
});
