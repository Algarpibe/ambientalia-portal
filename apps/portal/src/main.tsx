import './sentry' // init de Sentry (no-op sin VITE_SENTRY_DSN) — primero
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '../../payment-reconciliation/src/App.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
