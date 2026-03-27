import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5180,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
