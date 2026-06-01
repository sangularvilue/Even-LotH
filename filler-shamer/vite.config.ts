import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // vosk-browser ships its own web worker + wasm. Vite's dep pre-bundling
  // mangles the worker bootstrap, so exclude it and let it load as-is.
  optimizeDeps: {
    exclude: ['vosk-browser'],
  },
  server: {
    host: '0.0.0.0',
    port: 5181,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
