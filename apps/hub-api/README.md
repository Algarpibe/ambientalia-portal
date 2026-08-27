# hub-api

Read-only HTTP API over the central **zoho-hub** Postgres. Deployed as a
separate EasyPanel service in the **same project** as `zoho-hub-db` (so it can
reach the internal DB host). The portal SPAs read business data from this API
instead of parsing Excel exports.

## Endpoints

Auth = `Authorization: Bearer <jwt>` (el JWT se obtiene en `/api/login`).

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| GET | `/health` | none | `{ ok, deals, invoices, tickets }` (hub counts) |
| POST | `/api/login` | none | `{ token }` — valida credenciales (`AUTH_USERS`) y emite un JWT |
| GET | `/api/reconciliation/data?from=&to=` | Bearer JWT | `{ invoices, payments }` |
| GET | `/api/inventory/data` | Bearer JWT | datos de inventario/reposición |
| GET | `/api/customer-valuation/data` | Bearer JWT | valoración de clientes |

## EasyPanel service

- **Source:** this repo, branch `main`.
- **Build:** Dockerfile `apps/hub-api/Dockerfile`, **build context = repo root**.
- **Build arg** (set in *Entorno* — EasyPanel passes env as build args too):
  - `NPM_TOKEN` — GitHub PAT with scope `read:packages` (needed to install the
    private `@algarpibe/zoho-sync`).
- **Runtime env** (*Entorno*):
  - `HUB_DB_URL=postgres://hub_reader:<PASSWORD>@ambientalia_project_zoho-hub-db:5432/zoho-hub`
  - `ALLOWED_ORIGIN=<portal public domain>` (e.g. `https://portal.tu-dominio.com`)
  - `JWT_SECRET=<secreto largo aleatorio>` — firma/verifica los JWT.
  - `AUTH_USERS=email:hashBcrypt,...` — usuarios permitidos (hashes bcrypt).
  - `JWT_TTL` — opcional, vida del token (por defecto `8h`).
  - `PORT` — injected by EasyPanel; the app listens on it.
- **Domain:** assign a public domain to the service, pointing to the container
  port EasyPanel maps (the app uses `$PORT`).

## Portal build env

Set these where the portal image is built:
- `VITE_HUB_API_URL=<hub-api public domain>` (e.g. `https://api.tu-dominio.com`)

El portal autentica con JWT (login → `Authorization: Bearer`), así que **no**
lleva ninguna clave de API en el bundle.

## Local development

```bash
# install (needs the token once)
NPM_TOKEN=<pat> npm install --workspace=apps/hub-api
# run against the hub (needs network reach to the DB, e.g. a tunnel).
# AUTH_USERS: usa un hash bcrypt de una contraseña de prueba.
HUB_DB_URL="postgres://hub_reader:***@host:5432/zoho-hub" \
  JWT_SECRET=dev-secret AUTH_USERS="dev@x.com:<hashBcrypt>" \
  npm run dev --workspace=apps/hub-api
curl http://localhost:3001/health
# login → token, luego llamar con Bearer
TOKEN=$(curl -s -XPOST http://localhost:3001/api/login \
  -H 'content-type: application/json' \
  -d '{"email":"dev@x.com","password":"<pass>"}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/reconciliation/data | head -c 400
```

## Security note

Auth real por JWT: `/api/login` valida credenciales (bcrypt contra `AUTH_USERS`)
y emite un token firmado con `JWT_SECRET`; los endpoints de datos exigen
`Authorization: Bearer`. Defensa en profundidad: el hub solo es alcanzable a
través de este servicio y CORS está restringido al origen del portal
(`ALLOWED_ORIGIN`). No hay ninguna clave compartida en el bundle del cliente.
