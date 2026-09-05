import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: { rollupOptions: { input: { home: 'index.html', dayline: 'dayline/index.html' } } },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
