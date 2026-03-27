import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: appRoot,
  server: {
    host: '0.0.0.0',
    port: 5179,
    fs: {
      allow: [resolve(appRoot, '..')],
    },
    proxy: {
      '/api': 'https://loth.grannis.xyz',
    },
  },
  build: {
    outDir: resolve(appRoot, 'dist'),
    emptyOutDir: true,
  },
})
