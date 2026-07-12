# Diseño — Conectar el "Conciliador de Pagos" al hub de Zoho (zoho-hub-db)

- **Fecha:** 2026-07-12
- **App objetivo:** `apps/payment-reconciliation` (Conciliador de Pagos)
- **Objetivo general del portal:** eliminar la subida de archivos Excel en **todas** las apps, leyendo los datos desde el hub central `zoho-hub`. Este spec cubre solo el Conciliador; las demás apps se migrarán después, una a una, reutilizando el mismo patrón.

## 1. Contexto y diagnóstico

**Estado inicial: NO INTEGRADA.**

| Chequeo | Resultado |
|---------|-----------|
| `@algarpibe/zoho-sync` en dependencies | ❌ No está |
| `.npmrc` → GitHub Packages | ❌ No existe |
| Uso de `pg` / `HUB_DB_URL` / `createPoolFromUrl` | ❌ Ninguno |
| Dockerfile con `NPM_TOKEN` | ❌ El portal solo compila estáticos (Nginx) |

**Brecha arquitectónica:** el Conciliador es una **SPA 100% cliente** (React + Vite) servida como estáticos por Nginx dentro del portal. Un navegador no puede conectarse a Postgres:
- No existe `pg` en el navegador (no hay sockets TCP a Postgres).
- El host del hub `ambientalia_project_zoho-hub-db:5432` es **interno** al proyecto EasyPanel.
- Poner `HUB_DB_URL` (credencial `hub_reader`) en el bundle del cliente la expondría públicamente.

Por tanto, conectar la app al hub requiere introducir una **capa backend** (API de solo-lectura) que viva dentro de EasyPanel.

**Punto de corte limpio:** hoy el flujo es `Excel → setInvoices()/setPayments()`. Si la API devuelve los mismos shapes (`InvoiceDetails[]`, `PaymentRecord[]`), toda la lógica de conciliación existente queda intacta; solo cambia la fuente de datos.

## 2. Decisiones tomadas (brainstorming)

1. **Capa backend:** un servicio Node **compartido y reutilizable** (`apps/hub-api`), desplegado aparte en EasyPanel. Lo usará el Conciliador ahora y las demás apps después.
2. **UX de carga:** **carga automática al entrar** — se quitan las tarjetas de subida de Excel; al abrir la app se traen los datos del hub.
3. **Alcance de datos:** **todo el histórico** por defecto (con parámetro opcional `from/to` para acotar si el volumen crece).
4. **Seguridad v1:** CORS restringido al dominio del portal + API key por header. **Nota honesta:** una API key embebida en el bundle de la SPA es visible para cualquiera que inspeccione el cliente — es un disuasivo ligero, **no** protección real. La protección real (auth integrada con el login del portal, p. ej. verificando un token de sesión en `hub-api`) queda como mejora posterior. Mientras tanto, la barrera efectiva es que el hub solo es alcanzable vía `hub-api` y que `hub-api` restringe CORS.

## 3. Arquitectura

```
Navegador (SPA Conciliador)
   │  fetch(VITE_HUB_API_URL/api/reconciliation/data)   ← auto-carga en useEffect al montar
   │  header: x-api-key: <API_KEY>
   ▼
apps/hub-api  (Node + Express — servicio EasyPanel con dominio público)
   │  createPoolFromUrl(HUB_DB_URL)  vía @algarpibe/zoho-sync  (un único Pool reutilizado)
   ▼
zoho-hub Postgres  (esquema books.*)  ← host interno ambientalia_project_zoho-hub-db:5432, user hub_reader
```

- `hub-api` está en el **mismo proyecto EasyPanel** que el hub (para alcanzar el host interno).
- La SPA nunca toca Postgres; solo consume JSON.

## 4. Componente nuevo: `apps/hub-api`

**Stack:** Node + Express + `@algarpibe/zoho-sync` (trae `pg`) + `cors`.

**Endpoints (solo-lectura):**

| Método | Ruta | Devuelve |
|--------|------|----------|
| `GET` | `/health` | `{ deals, invoices, tickets }` — conteos del hub (criterio de validación) |
| `GET` | `/api/reconciliation/data?from=&to=` | `{ invoices: InvoiceDetails[], payments: PaymentRecord[] }`; sin params = todo el histórico |

**Detalles:**
- Un único `Pool` creado con `createPoolFromUrl(process.env.HUB_DB_URL)` al arrancar y reutilizado.
- Escucha en `process.env.PORT` (EasyPanel lo inyecta; fallback razonable en dev).
- CORS restringido a `process.env.ALLOWED_ORIGIN`.
- API key: middleware que exige `x-api-key === process.env.API_KEY` en `/api/*` (no en `/health`).
- Mapea filas del hub → shapes `InvoiceDetails` / `PaymentRecord` (ver §7).
- Manejo de errores: respuestas JSON `{ error }` con status apropiado; nunca filtra credenciales ni SQL crudo al cliente.

**Estructura tentativa:**
```
apps/hub-api/
  package.json        # express, cors, @algarpibe/zoho-sync
  tsconfig.json
  Dockerfile          # ARG NPM_TOKEN; node runtime; usa process.env.PORT
  src/
    index.ts          # arranque del server + pool + rutas
    db.ts             # createPoolFromUrl(HUB_DB_URL), singleton
    reconciliation.ts # queries books.* → InvoiceDetails[] / PaymentRecord[]
    auth.ts           # middleware API key
```

## 5. Cambios en la SPA `apps/payment-reconciliation`

- Eliminar las 2 tarjetas de subida de Excel y `handleFileUpload` (ruta de datos).
- `useEffect` al montar: `fetch(`${import.meta.env.VITE_HUB_API_URL}/api/reconciliation/data`, { headers: { 'x-api-key': ... } })` → `setInvoices` / `setPayments` → llamar `reconcile()`.
- Estados: carga (usa `SkeletonLoader` existente), error con botón "Reintentar".
- Nueva env de build `VITE_HUB_API_URL` (y la API key pública si se usa así).
- **Sin cambios** en `reconcile()`, tablas, KPIs, `CustomerAnalysis`, `GeneralAnalysis`, `CashFlowProjections`, exportación a Excel.
- El parseo de Excel (`xlsx`) puede conservarse solo para la **exportación** de resultados (que ya existe), no para la entrada.

## 6. Despliegue (EasyPanel)

**Servicio `hub-api` (nuevo):**
- Fuente: mismo repo GitHub, root dir `apps/hub-api` (o Dockerfile dedicado).
- Build arg: `NPM_TOKEN` (PAT GitHub, scope `read:packages`) — necesario porque `@algarpibe/zoho-sync` es privado.
- Runtime env: `HUB_DB_URL` (con `hub_reader`), `ALLOWED_ORIGIN` (dominio del portal), `API_KEY`, `PORT` (lo pone EasyPanel).
- Dominio público propio (la SPA lo llama desde el navegador).

**Portal:**
- Añadir build env `VITE_HUB_API_URL` = dominio público de `hub-api` (+ `VITE_HUB_API_KEY` si aplica).

**`.npmrc` en la raíz del repo (seguro de commitear):**
```
@algarpibe:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

**Dockerfile de `hub-api` (patrón):**
```dockerfile
ARG NPM_TOKEN
ENV NPM_TOKEN=$NPM_TOKEN
COPY package.json package-lock.json* .npmrc ./
RUN npm ci
ENV NPM_TOKEN=""   # limpia el token del runtime
# ... build TS, CMD node dist/index.js escuchando en $PORT
```

## 7. Mapeo de datos (hub → shapes de la app) — A VERIFICAR

La app matchea pagos con facturas por **número de factura** (string). Shapes destino:

```ts
InvoiceDetails { invoiceNumber, orderNumber, clientName, invoiceDate, dueDate, status, total, balance }
PaymentRecord  { paymentNumber, clientName, invoiceNumber, paymentDate, amountFCY, unusedFCY, amountBCY, unusedBCY }
```

**Riesgo crítico a resolver en implementación (antes de fijar el SQL):**
- Nombres exactos de tablas/columnas de `books.invoices` y `books.customer_payments` en el hub.
- **Cómo se enlaza un pago con su(s) factura(s):** en Zoho Books un pago puede aplicarse a varias facturas (tabla de aplicaciones pago↔factura con importe por factura). Hay que confirmar si existe esa tabla de líneas/aplicaciones en el hub y usarla para reconstruir `PaymentRecord.invoiceNumber` + importes por factura.
- Verificar contra el `SCHEMA.md` del repo `Algarpibe/zoho-sync` o por introspección en vivo (`information_schema` / `db.query`).

## 8. Criterio de éxito (validación)

1. `GET /health` de `hub-api` devuelve conteos > 0 (`invoices`, `deals`, `tickets`).
2. `GET /api/reconciliation/data` devuelve arrays no vacíos con los shapes correctos.
3. Al abrir el Conciliador en el portal, carga automáticamente y muestra la conciliación **sin subir ningún Excel**, con resultados coherentes con los que antes producían los Excel.
4. La credencial `hub_reader`, `HUB_DB_URL`, `NPM_TOKEN` y `API_KEY` nunca aparecen en el código ni en el repo.

## 9. Fuera de alcance (este spec)

- Migración de las otras apps del portal (se hará después, reutilizando este patrón).
- Auth real integrada con el login del portal (mejora posterior; v1 usa CORS + API key).
- Escritura hacia Zoho / ingesta de datos (lo hace el worker central; las apps solo leen).
- Paginación/streaming del payload (se añade solo si el volumen lo exige; el parámetro `from/to` ya deja la puerta abierta).

## 10. Prerrequisitos del operador (secretos — sin exponer valores)

- `NPM_TOKEN`: PAT GitHub con scope `read:packages`, en Entorno del servicio `hub-api`.
- `HUB_DB_URL`: `postgres://hub_reader:<PASSWORD>@ambientalia_project_zoho-hub-db:5432/zoho-hub`.
- `API_KEY`: secreto compartido entre `hub-api` y el portal.
- `ALLOWED_ORIGIN`: dominio público del portal.
