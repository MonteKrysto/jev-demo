import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'apps/web', plugins: [react()],
  server: {
    port: Number(process.env.DEV_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': process.env.DEV_API_TARGET ?? 'http://127.0.0.1:3001' },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true }
});
