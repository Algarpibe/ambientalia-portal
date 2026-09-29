import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Without these aliases `npm run dev` in the sub-app loads a SECOND copy of
    // React from apps/calibraciones/node_modules and hooks break (same as ausencias).
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  server: {
    port: 5186,
    // The UI imports the pure O3 engine from apps/hub-api by relative path.
    fs: { allow: [path.resolve(__dirname, '../..')] },
  },
})
