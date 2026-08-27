# Cómo conectar una app del portal a los datos de Zoho (zoho-hub)

Guía para no volver a investigarlo cada vez que se crea una app nueva. Con los
nombres de archivo, el patrón exacto y los gotchas ya conocidos.

## Regla de oro

**Las apps (frontend) NUNCA se conectan a la base de datos.** Toda lectura de datos
de Zoho pasa por **hub-api**, que es el único que habla con la Postgres `zoho-hub`.
La app hace `fetch` a un endpoint de hub-api con un JWT; hub-api consulta la réplica
y devuelve JSON.

```
App (React)  ──fetch + Bearer JWT──►  hub-api (Express)  ──SQL──►  zoho-hub (Postgres)
 VITE_HUB_API_URL                       requireAuth + cached          esquema books.*
```

Ninguna app tiene credenciales de BD. `HUB_DB_URL` vive solo en el servicio hub-api.

---

## Parte 1 — Backend: exponer un endpoint nuevo en hub-api

Todo ocurre en `apps/hub-api/src/`. Ejemplos canónicos ya en el repo:
`reconciliation.ts`, `salesOrders.ts`, `inventory.ts`,
`customerValuation.ts`.

### 1. Crear el módulo de datos

`apps/hub-api/src/miApp.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';

export interface MiFila { /* ...campos que devuelves... */ }

const SQL = `
  SELECT ...
    FROM books.<tabla>
   WHERE ...`;

export async function getMiAppData(db: Pool): Promise<MiFila[]> {
  const { rows } = await db.query(SQL, [/* params $1, $2... */]);
  return rows as MiFila[]; // o mapea/agrega en TS (ver gotchas)
}
```

### 2. Registrar la ruta en `index.ts`

Importa arriba y añade la ruta junto a las demás (`/api/reconciliation/data`, etc.).
Usa SIEMPRE `requireAuth` (auth) y `cached` (caché de 2 min):

```ts
import { getMiAppData } from './miApp.js';   // ⚠️ extensión .js aunque el archivo sea .ts (NodeNext)

app.get('/api/mi-app/data', requireAuth, async (_req, res) => {
  try {
    const data = await cached('mi-app', () => getMiAppData(getHubPool()));
    res.json(data);
  } catch (e) {
    sendError(res, e, 'mi-app');   // loguea + Sentry + 500 genérico
  }
});
```

- `getHubPool()` (de `./db.js`) devuelve el pool compartido (creado con `HUB_DB_URL`).
- `cached(key, fn)` (de `./cache.js`) cachea el resultado `CACHE_TTL_MS` (2 min por
  defecto). La clave debe ser única por endpoint (+ parámetros si filtras por query).
- `sendError(res, e, tag)` responde 500 sin filtrar detalles internos.

### 3. Tests (opcional pero recomendado; el CI de hub-api los corre)

La lógica pura (agregaciones, clasificaciones) va en funciones testeables, y el test
en `apps/hub-api/src/miApp.test.ts` (Vitest). Ver `salesOrders.test.ts` de ejemplo.

### ⚠️ Desplegar

hub-api es un **servicio EasyPanel aparte** del portal. Un endpoint nuevo requiere
**redesplegar hub-api**, no solo el portal.

---

## Parte 2 — Frontend: consumir el endpoint desde una app

Patrón autocontenido (idéntico en todas las apps). Base URL y token:

- Base: `import.meta.env.VITE_HUB_API_URL`
- Token: `localStorage.getItem('ambientalia_token')` → header `Authorization: Bearer <jwt>`

```ts
const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const res = await fetch(`${API_BASE}/api/mi-app/data`, { headers: authHeaders() });
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const data = await res.json();
```

Ejemplos de hooks self-fetch listos para copiar:
`apps/inventory-optimization/src/widgets/useInventoryData.ts`,
`apps/payment-reconciliation/src/widgets/useReconciliationData.ts`.

> Si el dato es para un **widget del dashboard**, además hay que registrar el widget:
> ver `apps/portal/src/widgets/registry.ts` y el patrón `src/widgets/index.ts` de cada app.

---

## Parte 3 — Referencia del esquema zoho-hub

- **Servidor:** Postgres en EasyPanel, servicio `zoho-hub-db`.
- **Base de datos:** `zoho-hub` (¡NO `postgres`! si entras por consola: `\c zoho-hub`).
- **Esquema:** `books.*`. Un worker aparte (`zoho-hub-sync`, repo `ambientalia-desk`)
  replica Zoho Books cada ~3 min.

Tablas replicadas disponibles (las que usan los endpoints actuales):

| Tabla | Contenido |
|---|---|
| `books.invoices` | facturas (`invoice_number`, `customer_name`, `date`, `due_date`, `status`, `total`, `raw`) |
| `books.invoice_line_items` | líneas de factura |
| `books.customer_payments` | pagos (`payment_number`, `customer_name`, `date`, `exchange_rate`, `amount`) |
| `books.customer_payment_invoices` | pagos aplicados por factura (`amount_applied`) |
| `books.sales_orders` | órdenes de venta (`salesorder_number`, `date`, `status`, `customer_name`, `raw`) |
| `books.salesorder_line_items` | líneas de OV (`quantity`, `rate`, `item_id`, `raw`) |
| `books.purchase_orders`, `books.purchase_order_line_items` | órdenes de compra |
| `books.items` | maestro de artículos (`sku`, `name`, `raw`) |
| `books.contacts` | clientes/proveedores (`contact_id`, `nit`) |

### La columna `raw` (jsonb) — clave

Cada fila trae `raw`: el objeto Zoho completo. **Muchos campos SOLO existen en `raw`**,
no como columna propia. Ejemplos reales:

- Saldo de factura: NO hay columna `balance`; se lee `raw->>'balance'`
  (con fallback a `total`: `COALESCE(NULLIF(raw->>'balance','')::numeric, total, 0)`).
- Cantidad facturada de una línea de OV: `raw->>'quantity_invoiced'`.
- Fecha de entrega de una OV: `raw->>'shipment_date'`.

---

## Gotchas (aprendidos a la mala)

1. **No castees texto de `raw` a `::numeric` en SQL.** Zoho mete valores como `"12.5%"`
   en campos numéricos; un solo `'12.5%'::numeric` **aborta la consulta entera**. Trae
   el campo como texto (`NULLIF(raw->>'campo','')`) y **parséalo/agrégalo en TypeScript**.
   Ver `salesOrders.ts` (`aggregatePendingOrders`) y `wo-sales/hub.source.ts`.

2. **Agrega en TS, no en SQL,** cuando dependas de campos de `raw` (por lo anterior).

3. **Duplicados / registros huérfanos.** El worker no borra de la réplica lo que se
   borra o reemplaza en Zoho, así que puede haber filas fantasma (mismo `invoice_number`
   o `salesorder_number` repetido). Al agregar por número, verifica que no estés
   doblando. Ver `docs/incidents/2026-07-17-facturas-fantasma-zoho-hub.md` (incluye
   consultas de diagnóstico).

4. **Caché de 2 min.** Tras cambiar datos en Zoho, el endpoint puede tardar hasta
   `CACHE_TTL_MS` + el ciclo del worker en reflejarlo. Un redespliegue de hub-api limpia
   la caché.

5. **Import con `.js`.** hub-api usa NodeNext: importa `./miApp.js` aunque el archivo
   sea `miApp.ts`.

6. **El pool es de solo lectura de facto** para estos endpoints. No hagas escrituras a
   `books.*` desde hub-api (esas tablas las gobierna el worker).

---

## Auth y variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `VITE_HUB_API_URL` | build del portal (frontend) | base URL de hub-api |
| `HUB_DB_URL` | servicio hub-api (backend) | conexión a la Postgres `zoho-hub` |
| `JWT_SECRET` | servicio hub-api | firma/verificación del JWT |
| `CACHE_TTL_MS` | servicio hub-api (opcional) | TTL de caché (2 min por defecto) |
| `ambientalia_token` (localStorage) | navegador | el JWT que el portal guarda tras el login |

El JWT lo emite `POST /api/login` y trae `{ sub, user_id, role, apps }`. `requireAuth`
lo verifica en cada endpoint de datos y re-comprueba que el usuario siga `active` en BD.
El claim `apps` es el que usa el portal (`AppGuard`) para permitir el acceso a cada app.

---

## Checklist para una app nueva que necesita datos de Zoho

1. [ ] ¿El dato ya está en `books.*`? (mira las tablas arriba; si no, hay que sumarlo
       al worker `zoho-hub-sync` en `ambientalia-desk` — fuera de este repo).
2. [ ] Crear `apps/hub-api/src/<app>.ts` con la consulta + agregación en TS.
3. [ ] Registrar `GET /api/<app>/data` en `index.ts` con `requireAuth` + `cached`.
4. [ ] (Opcional) test de la lógica pura en `<app>.test.ts`.
5. [ ] Hook self-fetch en la app usando `VITE_HUB_API_URL` + `ambientalia_token`.
6. [ ] (Si es widget) registrar en `apps/portal/src/widgets/registry.ts`.
7. [ ] **Redesplegar hub-api** (endpoint nuevo) y el portal (frontend).
