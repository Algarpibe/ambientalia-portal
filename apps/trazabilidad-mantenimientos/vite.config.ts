import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Sin estos alias, `npm run dev` en la sub-app carga una SEGUNDA copia de
    // React desde su node_modules y los hooks se rompen (igual que ausencias).
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  server: {
    port: 5187,
    // La UI importa el dominio puro de apps/hub-api por ruta relativa.
    fs: { allow: [path.resolve(__dirname, '../..')] },
  },
})
