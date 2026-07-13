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

## Comandos

```bash
npm run dev                          # levanta el portal (Vite)
npm run build                        # build de todos los workspaces
npm run build --workspace=apps/portal   # solo el portal (lo que despliega EasyPanel)
npm test  --workspace=apps/hub-api   # tests del backend (vitest)
```
