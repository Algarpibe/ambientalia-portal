import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  server: {
    port: 5175,
  },
  test: {
    // El entorno lo sigue declarando cada archivo con su docblock
    // `// @vitest-environment jsdom`: hay tests de logica pura que no lo
    // necesitan y no tiene sentido pagarles un DOM. Esto solo aporta la
    // preparacion comun. Ver src/vitest.setup.ts para el porque.
    setupFiles: ['./src/vitest.setup.ts'],
  },
})
