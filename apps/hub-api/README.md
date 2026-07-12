# hub-api

Read-only HTTP API over the central **zoho-hub** Postgres. Deployed as a
separate EasyPanel service in the **same project** as `zoho-hub-db` (so it can
reach the internal DB host). The portal SPAs read business data from this API
instead of parsing Excel exports.

## Endpoints

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| GET | `/health` | none | `{ ok, deals, invoices, tickets }` (hub counts) |
| GET | `/api/reconciliation/data?from=&to=` | `x-api-key` | `{ invoices: InvoiceDetails[], payments: PaymentRecord[] }` |
| GET | `/debug/schema` | `x-api-key` | books tables/columns + sample `raw` keys (temporary — for finalizing the payments query; remove after) |

## EasyPanel service

- **Source:** this repo, branch `main`.
- **Build:** Dockerfile `apps/hub-api/Dockerfile`, **build context = repo root**.
- **Build arg** (set in *Entorno* — EasyPanel passes env as build args too):
  - `NPM_TOKEN` — GitHub PAT with scope `read:packages` (needed to install the
    private `@algarpibe/zoho-sync`).
- **Runtime env** (*Entorno*):
  - `HUB_DB_URL=postgres://hub_reader:<PASSWORD>@ambientalia_project_zoho-hub-db:5432/zoho-hub`
  - `ALLOWED_ORIGIN=<portal public domain>` (e.g. `https://portal.tu-dominio.com`)
  - `API_KEY=<shared secret>`
  - `PORT` — injected by EasyPanel; the app listens on it.
- **Domain:** assign a public domain to the service, pointing to the container
  port EasyPanel maps (the app uses `$PORT`).

## Portal build env (for the Conciliador SPA)

Set these where the portal image is built:
- `VITE_HUB_API_URL=<hub-api public domain>` (e.g. `https://api.tu-dominio.com`)
- `VITE_HUB_API_KEY=<same shared secret>`  ⚠️ visible in the client bundle — a
  light deterrent only, not real protection (see the design spec).

## Local development

```bash
# install (needs the token once)
NPM_TOKEN=<pat> npm install --workspace=apps/hub-api
# run against the hub (needs network reach to the DB, e.g. a tunnel)
HUB_DB_URL="postgres://hub_reader:***@host:5432/zoho-hub" API_KEY=dev \
  npm run dev --workspace=apps/hub-api
curl http://localhost:3001/health
curl -H "x-api-key: dev" http://localhost:3001/api/reconciliation/data | head -c 400
```

## Security note

`API_KEY` is a shared secret embedded in the SPA bundle — it deters casual
access but is not real auth. The effective boundary is that the hub is only
reachable through this service and that CORS is restricted to the portal
origin. Real per-user auth (validating the portal login in `hub-api`) is a
planned follow-up.
