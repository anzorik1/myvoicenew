import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.WEB_PORT ?? 5173) },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.trycloudflare.com', 'myvoice24.com', '.myvoice24.com'],
  },
  build: { sourcemap: true },
});
