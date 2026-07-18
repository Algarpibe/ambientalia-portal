import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Solo para `npm run dev` en local. En producción el portal importa App.tsx
// directamente y aporta el CSS (Tailwind) desde su propia build.
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
