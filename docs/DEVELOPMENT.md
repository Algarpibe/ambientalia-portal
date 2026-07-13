# Desarrollo — antigravity-suite

[![CI](https://github.com/Algarpibe/ambientalia-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/Algarpibe/ambientalia-portal/actions/workflows/ci.yml)

Monorepo npm workspaces (`apps/*`). Node **>= 20** (ver `.nvmrc`).

## Requisitos de build

El backend `apps/hub-api` depende del paquete **privado** `@algarpibe/zoho-sync`
(GitHub Packages, ver `.npmrc`). Para instalar desde un clone limpio necesitas un
**`NPM_TOKEN`** (Personal Access Token de GitHub con scope `read:packages`):

```bash
export NPM_TOKEN=ghp_xxx        # PAT con read:packages
npm install                     # instala todos los workspaces
```

Sin `NPM_TOKEN`, `npm install` falla con 401 al resolver `@algarpibe/zoho-sync`.

En EasyPanel, `NPM_TOKEN` se pasa como **build-arg** al `Dockerfile` de hub-api
(ver `apps/hub-api/Dockerfile`, donde se usa inline en el `RUN`, nunca como ENV).

## Variables de entorno

Ver los `.env.example` de cada servicio:
- Raíz `.env.example` — `NPM_TOKEN` (build).
- `apps/hub-api/.env.example` — `HUB_DB_URL`, `API_KEY`, `ALLOWED_ORIGIN`, `PORT`.
- `apps/portal/.env.example` — `VITE_HUB_API_URL`, `VITE_HUB_API_KEY`
  (⚠ estas viajan al bundle; ver SEC-001 en `AUDIT_REPORT.md`).

> **CORS fail-closed**: fijar `ALLOWED_ORIGIN` (origen del portal) en el entorno
> del hub-api **antes de desplegar**, o el navegador bloqueará las peticiones.

## Observabilidad (Sentry)

El código de Sentry está integrado y es **no-op sin DSN** (seguro desplegar sin
él). Se activa fijando el DSN de cada servicio en EasyPanel:

1. En https://sentry.io → un proyecto **Node/Express** (hub-api) y uno **React**
   (portal). Cada uno da su propio **DSN**.
2. En EasyPanel:
   - Servicio **hub-api** → variable `SENTRY_DSN` = DSN del proyecto Node → Implementar.
   - Servicio **portal** → variable `VITE_SENTRY_DSN` = DSN del proyecto React → **Rebuild**.

### ⚠️ hub-api vs portal: runtime vs build-time
- **hub-api** (`SENTRY_DSN`) es **runtime**: basta redeploy/restart. Verifica en
  los logs la línea `Sentry habilitado (hub-api)`.
- **portal** (`VITE_SENTRY_DSN`) es **build-time**: Vite lo hornea en el bundle,
  así que un *restart no basta* — hay que **reconstruir la imagen**. Si solo se
  reinicia (o el build reusa caché), el DSN no entra y Sentry queda inactivo.
  El portal **no** imprime log; verifica en el navegador:
  - DevTools → Console → `window.__SENTRY__` debe devolver un **objeto** (no `undefined`).
  - Diagnóstico si sigue `undefined`: DevTools → Sources → Ctrl+Shift+F → buscar
    `ingest.sentry.io`. Si no aparece, el DSN no se horneó → el build no se rehizo
    con la variable (fuerza un rebuild con un commit nuevo o sin caché).

Captura: hub-api → errores 500 de los endpoints, fallos de `/health`, y
`unhandledRejection`/`uncaughtException`. portal → errores JS del `ErrorBoundary`.

## Comandos

```bash
npm run dev                          # levanta el portal (Vite)
npm run build                        # build de todos los workspaces
npm run build --workspace=apps/portal   # solo el portal (lo que despliega EasyPanel)
npm test  --workspace=apps/hub-api   # tests del backend (vitest)
```
