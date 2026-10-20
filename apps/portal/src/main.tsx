import './sentry' // init de Sentry (no-op sin VITE_SENTRY_DSN) — primero
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '../../payment-reconciliation/src/App.css'
import App from './App.tsx'
import { API_BASE, clearToken } from './auth'
import { instalarInterceptor401 } from './lib/interceptor401'

// FE-412 — un 401 de hub-api en CUALQUIER app saca del portal. Antes de pintar
// nada, para que ninguna petición se escape sin pasar por él. Recarga entera y
// no `navigate`: además de volver a /auth, tira el estado en memoria de la app
// en la que estaba, que se cargó con una sesión que ya no vale.
if (API_BASE) {
  instalarInterceptor401({
    apiBase: API_BASE,
    alExpirar: () => {
      clearToken()
      if (window.location.pathname !== '/auth') window.location.assign('/auth')
    },
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
