import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'

// Solo para `npm run dev` en local. En producción el portal importa App.tsx
// directamente, aporta el router (BrowserRouter) y el CSS (Tailwind) desde su
// propia build.
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  )
}
