# Anticipos en las OV pendientes de facturar — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** mostrar en la tabla «OV pendientes de facturar» el anticipo cobrado y el
anticipo sin aplicar de cada OV, y avisar de los anticipos que no se pueden enlazar o que
se quedaron sin aplicar en una OV cerrada.

**Arquitectura:** el worker replica el módulo de facturas de anticipo de Zoho
(`/retainerinvoices`) en `books.retainer_invoices`. hub-api extrae la OV del texto de la
línea con funciones puras, cruza y añade los importes solo a quien tiene Contabilidad (o es
admin). El portal pinta dos columnas, un bloque en el modal y un aviso plegable.

**Stack:** TypeScript, Express, PostgreSQL (`zoho-hub`), React 19, Vitest (pg-mem en el
worker, supertest en hub-api, jsdom + React Testing Library en `apps/contabilidad`).

**Especificación:** [docs/superpowers/specs/2026-09-21-anticipos-ov-design.md](../specs/2026-09-21-anticipos-ov-design.md)

---

## Desviaciones respecto de la especificación (las recoge la Tarea E1)

1. **Columnas al final, tras ESTADO, no tras POR FACTURAR.** `useColumnPrefs.leer()` añade
   las claves nuevas **al final** para quien tiene una configuración guardada. Con las
   columnas tras POR FACTURAR, un usuario nuevo y uno antiguo las verían en sitios distintos,
   y a todos los antiguos se les marcaría la tabla como «personalizada». Al final, todos las
   ven igual. Se pueden arrastrar.
2. **Un admin ve los anticipos aunque no tenga la app Contabilidad.** Es la regla de
   `requireApp`, que ya deja pasar a los admin; hacer otra cosa sería contradecirla.
3. **El patrón acepta también la raya (–) y el guion largo (—)**, que salen al copiar de Word.
4. **`apps/contabilidad` estrena infraestructura de tests** (hoy no tiene ni script, ni
   config, ni dependencia de vitest).

## Mapa de ficheros

**Worker — repo `C:\dev\Desk_2_R1.023`:**

| Fichero | Cambio |
|---|---|
| `packages/zoho-sync/src/booksHub/mappers.ts` | `RetainerInvoiceRow` + `retainerInvoiceRow` |
| `packages/zoho-sync/src/booksHub/schema-books.sql` | tabla `books.retainer_invoices` |
| `packages/zoho-sync/src/booksHub/repo.ts` | tipo `BooksTable` (única fuente de la unión de tablas) + `upsertRetainerInvoice` |
| `packages/zoho-sync/src/booksHub/sync.ts` | `persistRetainerInvoice`, backfill, incremental y entidad del sweep |
| `apps/hub-sync/src/hubSync.ts` | guard de backfill de anticipos en `hubBootstrap` |
| tests: `mappers.test.ts`, `repo.test.ts`, `sync.test.ts`, `sweep.test.ts`, `migrate.test.ts`, `apps/hub-sync/src/hubSync.test.ts` | |
| `DEPLOY.md`, `openspec/specs/zoho-sync/spec.md` | la lista de entidades y el recuento de tablas (8 → 9) |

**Portal — este repo:**

| Fichero | Cambio |
|---|---|
| `apps/hub-api/src/contabilidad/anticipos.ts` | **nuevo**: `extraerOV`, `enlazarAnticipos`, `conAnticipo`, `getAnticiposEnlazados` |
| `apps/hub-api/src/contabilidad/anticipos.test.ts` | **nuevo** |
| `apps/hub-api/src/contabilidad/router.ts` | campos por permiso, resiliencia, endpoint `anticipos-atencion` |
| `apps/hub-api/src/contabilidad/router.anticipos.test.ts` | **nuevo** |
| `apps/contabilidad/package.json`, `vitest.config.ts`, `src/test/setup.ts` | infraestructura de tests |
| `apps/contabilidad/src/useColumnPrefs.test.ts` | **nuevo** (caracterización) |
| `apps/contabilidad/src/api.ts` | tipos + `fetchAnticiposAtencion` |
| `apps/contabilidad/src/ovTabla.ts` + `.test.ts` | **nuevo**: helpers puros de la tabla |
| `apps/contabilidad/src/OVPendientes.tsx` | dos columnas y la comparación de orden |
| `apps/contabilidad/src/DetalleModal.tsx` | bloque «Anticipos» |
| `apps/contabilidad/src/AnticiposAtencion.tsx` + `.test.tsx` | **nuevo**: el aviso |
| `apps/contabilidad/src/App.tsx` | monta el aviso en la pestaña de OV |

## Orden y puertas

```
Tarea 0 (sondeo de la API)  ──puerta──▶  Parte A (worker)  ──▶  despliegue del worker
        ──▶  Parte B (verificación SQL)  ──puerta──▶  empujar el portal (Parte F)
Parte C (hub-api) y Parte D (portal) se pueden hacer en cualquier momento después de la
Tarea 0: la resiliencia de hub-api hace seguro tenerlas listas antes. Lo que NO se hace
antes de pasar la Parte B es EMPUJAR este repo, porque aquí empujar es desplegar.
```

Comandos: en Bash (Git Bash) salvo que se diga otra cosa. **En este equipo PowerShell 5.1
corrompe las tildes con `Set-Content`**: editar ficheros solo con la herramienta Edit.

Commits: convencionales, en español, **sin línea Co-Authored-By**. En este repo hay
autorización permanente para commitear y empujar. **En el del worker no: se commitea y se
pide permiso antes de empujar.**

---

## Tarea 0: Sondeo de la API de anticipos (puerta de todo lo demás)

Confirma, antes de escribir código, los dos riesgos abiertos de la especificación (permisos
OAuth y filtro incremental) y los nombres de campo, que solo se han visto en la documentación.

Las credenciales de Books **no están en local** (el worker no tiene `.env`, solo
`.env.example`). El sondeo se ejecuta en la **consola del contenedor zoho-hub-sync en
EasyPanel**, que ya tiene las variables `ZOHO_BOOKS_*` en su entorno. Lo ejecuta el usuario.

- [ ] **Paso 1: Pedir al usuario que abra la consola del servicio zoho-hub-sync y, desde la
  raíz del repo dentro del contenedor (la carpeta que contiene `apps/` y `packages/`), pegue:**

```sh
cat > apps/hub-sync/src/_sondeo-anticipos.ts <<'EOF'
import { loadConfig } from '@ambientalia/zoho-sync/config'
import { createBooksClient } from '@ambientalia/zoho-sync/books/booksClient'

async function main() {
  const config = loadConfig()
  const { booksFetch } = createBooksClient({ config })
  const org = config.booksOrgId
  // Mismos parámetros que usa listPath en booksHub/sync.ts: si Zoho los rechaza, el
  // incremental no funcionaría.
  const lista = await booksFetch(`/retainerinvoices?organization_id=${org}&page=1&per_page=3&sort_column=last_modified_time&sort_order=D`)
  console.log('LISTA status:', lista.status)
  const cuerpo = JSON.parse((await lista.text()) || '{}')
  console.log('Claves de la respuesta:', Object.keys(cuerpo))
  const filas = cuerpo.retainerinvoices ?? []
  console.log('Fechas de modificación en la lista:', filas.map((f: any) => f.last_modified_time))
  if (!filas[0]) return
  const det = await booksFetch(`/retainerinvoices/${filas[0].retainerinvoice_id}?organization_id=${org}`)
  console.log('DETALLE status:', det.status)
  const d = JSON.parse((await det.text()) || '{}').retainerinvoice ?? {}
  console.log('numero:', d.retainerinvoice_number, '| estado:', d.status, '| moneda:', d.currency_code)
  console.log('payment_made:', d.payment_made, '| payment_drawn:', d.payment_drawn, '| total:', d.total)
  console.log('lineas:', JSON.stringify((d.line_items ?? []).map((l: any) => l.description)))
}
main().catch((e) => { console.error('Sondeo falló:', e); process.exit(1) })
EOF
npx tsx apps/hub-sync/src/_sondeo-anticipos.ts
rm apps/hub-sync/src/_sondeo-anticipos.ts
```

- [ ] **Paso 2: Evaluar la salida. Seguir SOLO si se cumple todo:**

| Comprobación | Esperado | Si falla |
|---|---|---|
| `LISTA status` | `200` | 401/403 → al token le faltan permisos: el usuario regenera el refresh token en la consola de Zoho incluyendo facturas de anticipo. **PARAR.** |
| `Claves de la respuesta` | contiene `retainerinvoices` | Otra clave → cambiar `'retainerinvoices'` por la real en las Tareas A3 y A4. |
| `Fechas de modificación` | tres fechas, no `undefined`, de más reciente a más antigua | `undefined` o desordenadas → el incremental cortaría en falso y dejaría de sincronizar en silencio. **PARAR y volver al usuario**: hace falta otro diseño de sincronización. |
| `DETALLE status` | `200` | **PARAR.** |
| `payment_made`, `payment_drawn` | números | `undefined` → **PARAR**: los nombres reales no son los de la documentación. |
| `lineas` | p. ej. `["Anticipo OV-2026-167"]` | vacío → **PARAR**: la descripción no está donde pensamos. |

- [ ] **Paso 3: Anotar la salida en la conversación.** Es la evidencia de que el diseño se
  apoya en la API real y no solo en su documentación.

---

## Parte A — Worker (repo `C:\dev\Desk_2_R1.023`)

Todos los comandos de esta parte se ejecutan en `C:\dev\Desk_2_R1.023`. Los tests usan
pg-mem en memoria: no hace falta base de datos.

### Tarea A1: Mapper `retainerInvoiceRow`

**Ficheros:**
- Modificar: `packages/zoho-sync/src/booksHub/mappers.ts`
- Test: `packages/zoho-sync/src/booksHub/mappers.test.ts`

- [ ] **Paso 1: Escribir el test que falla.** En `mappers.test.ts`, añadir
  `retainerInvoiceRow` al import de la línea 2:

```ts
import { contactRow, itemRow, salesOrderRow, soLineRow, invoiceRow, invoiceLineRow, customerPaymentRow, paymentInvoiceRow, purchaseOrderRow, poLineRow, retainerInvoiceRow } from './mappers'
```

y añadir este test justo antes del `})` final del `describe` (tras el de `paymentInvoiceRow`):

```ts
  it('retainerInvoiceRow mapea cobrado y aplicado, y deja las líneas en raw', () => {
    const r = retainerInvoiceRow({
      retainerinvoice_id: 'ri1', retainerinvoice_number: 'ANT-2026-063', reference_number: '',
      date: '2026-09-15', status: 'paid', customer_id: 'c1', customer_name: 'SGS Colombia S.A.S.',
      currency_code: 'COP', total: '9505784', payment_made: '9505784', payment_drawn: '0',
      last_modified_time: '2026-09-15T10:00:00-0500',
      line_items: [{ line_item_id: 'rl1', description: 'Anticipo OV-2026-167', item_total: 9505784 }],
    })
    expect(r.retainerinvoice_id).toBe('ri1')
    expect(r.retainerinvoice_number).toBe('ANT-2026-063')
    expect(r.reference_number).toBeNull()
    expect(r.status).toBe('paid')
    expect(r.total).toBe(9505784)
    expect(r.payment_made).toBe(9505784)
    expect(r.payment_drawn).toBe(0)
    expect(r.zoho_last_modified).toBe('2026-09-15T10:00:00-0500')
    expect((r.raw as any).line_items[0].description).toBe('Anticipo OV-2026-167')
  })
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/mappers.test.ts`
Expected: FAIL en el test nuevo con `TypeError: retainerInvoiceRow is not a function`.

- [ ] **Paso 3: Implementar.** En `mappers.ts`, añadir la interfaz tras la línea de
  `PoLineRow` (línea 15):

```ts
export interface RetainerInvoiceRow { retainerinvoice_id: string; retainerinvoice_number: string | null; reference_number: string | null; date: string | null; status: string | null; customer_id: string | null; customer_name: string | null; currency_code: string | null; total: number | null; payment_made: number | null; payment_drawn: number | null; raw: unknown; zoho_last_modified: string | null }
```

y la función al final del fichero:

```ts
export function retainerInvoiceRow(raw: any): RetainerInvoiceRow {
  // Sin tabla de líneas: una línea de anticipo solo trae descripción e importe, y la
  // descripción («Anticipo OV-2026-167») es lo único que la enlaza con su OV. hub-api la lee
  // de raw->'line_items'. payment_made = lo cobrado, payment_drawn = lo ya aplicado a facturas.
  return {
    retainerinvoice_id: raw.retainerinvoice_id, retainerinvoice_number: str(raw.retainerinvoice_number),
    reference_number: str(raw.reference_number), date: raw.date || null, status: str(raw.status),
    customer_id: str(raw.customer_id), customer_name: str(raw.customer_name), currency_code: str(raw.currency_code),
    total: num(raw.total), payment_made: num(raw.payment_made), payment_drawn: num(raw.payment_drawn),
    raw, zoho_last_modified: raw.last_modified_time ?? null,
  }
}
```

- [ ] **Paso 4: Ejecutar y ver el verde.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/mappers.test.ts`
Expected: PASS, todos los tests del fichero.

- [ ] **Paso 5: Commit.**

```bash
git add packages/zoho-sync/src/booksHub/mappers.ts packages/zoho-sync/src/booksHub/mappers.test.ts
git commit -m "feat(books): mapper de facturas de anticipo"
```

### Tarea A2: Tabla, upsert y tipo único de tablas

**Ficheros:**
- Modificar: `packages/zoho-sync/src/booksHub/schema-books.sql`, `packages/zoho-sync/src/booksHub/repo.ts`
- Test: `packages/zoho-sync/src/booksHub/repo.test.ts`, `packages/zoho-sync/src/booksHub/migrate.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan.** En `repo.test.ts`, sustituir las líneas 5-6
  (los dos imports) por:

```ts
import { upsertContact, upsertItem, upsertSalesOrder, upsertInvoice, replaceSoLines, replaceInvoiceLines, upsertRetainerInvoice, maxZohoLastModified } from './repo'
import { contactRow, itemRow, salesOrderRow, soLineRow, invoiceRow, invoiceLineRow, retainerInvoiceRow } from './mappers'
```

y añadir antes del `})` final del `describe`:

```ts
  it('upsertRetainerInvoice inserta, actualiza sin duplicar y da marca de agua', async () => {
    await upsertRetainerInvoice(db, retainerInvoiceRow({ retainerinvoice_id: 'ri1', status: 'sent', payment_made: 0, payment_drawn: 0, last_modified_time: '2026-09-01T00:00:00Z' }))
    await upsertRetainerInvoice(db, retainerInvoiceRow({ retainerinvoice_id: 'ri1', status: 'paid', payment_made: 500, payment_drawn: 0, last_modified_time: '2026-09-02T00:00:00Z' }))
    const r = await db.query("SELECT status, payment_made FROM books.retainer_invoices WHERE retainerinvoice_id='ri1'")
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].status).toBe('paid')
    expect(Number(r.rows[0].payment_made)).toBe(500)
    const wm = await maxZohoLastModified(db, 'retainer_invoices')
    expect(new Date(wm!).getTime()).toBe(new Date('2026-09-02T00:00:00Z').getTime())
  })
```

En `migrate.test.ts`, cambiar el título y la lista del bucle (líneas 15 y 20):

```ts
  it('crea las tablas del esquema books', async () => {
```

```ts
    for (const t of ['contacts', 'items', 'sales_orders', 'salesorder_line_items', 'invoices', 'invoice_line_items', 'retainer_invoices']) {
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/repo.test.ts packages/zoho-sync/src/booksHub/migrate.test.ts`
Expected: FAIL. En repo: `TypeError: upsertRetainerInvoice is not a function`. En migrate:
error de pg-mem porque `books.retainer_invoices` no existe.

- [ ] **Paso 3: Crear la tabla.** En `schema-books.sql`, insertar tras el bloque de
  `books.purchase_order_line_items` (antes de los `CREATE INDEX`). **Sin comentarios SQL**:
  `migrateBooks` parte el fichero por cada `;`, y un `;` dentro de un comentario rompería la
  sentencia.

```sql
CREATE TABLE IF NOT EXISTS books.retainer_invoices (
  retainerinvoice_id text PRIMARY KEY, retainerinvoice_number text, reference_number text,
  date date, status text, customer_id text, customer_name text, currency_code text,
  total numeric, payment_made numeric, payment_drawn numeric,
  raw jsonb, zoho_last_modified timestamptz, synced_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Paso 4: Implementar el upsert y el tipo único.** En `repo.ts`, añadir
  `RetainerInvoiceRow` al import de tipos de la línea 2:

```ts
import type { ContactRow, ItemRow, SalesOrderRow, InvoiceRow, SoLineRow, InvoiceLineRow, CustomerPaymentRow, PaymentInvoiceRow, PurchaseOrderRow, PoLineRow, RetainerInvoiceRow } from './mappers'
```

Añadir tras `const J = …` (línea 4):

```ts
/**
 * Tablas-cabecera de books.* con marca de agua. Antes la unión se escribía a mano en dos
 * sitios (aquí y en `incremental` de sync.ts); una tabla nueva obligaba a acordarse de ambos.
 */
export type BooksTable = 'contacts' | 'items' | 'sales_orders' | 'invoices' | 'customer_payments' | 'purchase_orders' | 'retainer_invoices'
```

Añadir tras `replacePoLines`:

```ts
export async function upsertRetainerInvoice(db: Queryable, r: RetainerInvoiceRow): Promise<void> {
  await db.query(
    `INSERT INTO books.retainer_invoices (retainerinvoice_id,retainerinvoice_number,reference_number,date,status,customer_id,customer_name,currency_code,total,payment_made,payment_drawn,raw,zoho_last_modified,synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     ON CONFLICT (retainerinvoice_id) DO UPDATE SET retainerinvoice_number=EXCLUDED.retainerinvoice_number,reference_number=EXCLUDED.reference_number,
       date=EXCLUDED.date,status=EXCLUDED.status,customer_id=EXCLUDED.customer_id,customer_name=EXCLUDED.customer_name,
       currency_code=EXCLUDED.currency_code,total=EXCLUDED.total,payment_made=EXCLUDED.payment_made,payment_drawn=EXCLUDED.payment_drawn,
       raw=EXCLUDED.raw,zoho_last_modified=EXCLUDED.zoho_last_modified,synced_at=now()`,
    [r.retainerinvoice_id, r.retainerinvoice_number, r.reference_number, r.date, r.status, r.customer_id, r.customer_name, r.currency_code, r.total, r.payment_made, r.payment_drawn, J(r.raw), r.zoho_last_modified],
  )
}
```

Y cambiar la firma de `maxZohoLastModified`:

```ts
export async function maxZohoLastModified(db: Queryable, table: BooksTable): Promise<string | null> {
```

- [ ] **Paso 5: Ejecutar y ver el verde.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/repo.test.ts packages/zoho-sync/src/booksHub/migrate.test.ts`
Expected: PASS.

- [ ] **Paso 6: Commit.**

```bash
git add packages/zoho-sync/src/booksHub/schema-books.sql packages/zoho-sync/src/booksHub/repo.ts packages/zoho-sync/src/booksHub/repo.test.ts packages/zoho-sync/src/booksHub/migrate.test.ts
git commit -m "feat(books): tabla books.retainer_invoices y su upsert"
```

### Tarea A3: Sincronización (backfill e incremental)

**Ficheros:**
- Modificar: `packages/zoho-sync/src/booksHub/sync.ts`
- Test: `packages/zoho-sync/src/booksHub/sync.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan.** En `sync.test.ts`, añadir antes del `})`
  final del `describe`:

```ts
  it('backfillRetainerInvoices trae la cabecera por lista y la descripción de la línea por detalle', async () => {
    const booksFetch = vi.fn().mockImplementation((path: string) => {
      if (path.startsWith('/retainerinvoices?')) return Promise.resolve(page('retainerinvoices', [{ retainerinvoice_id: 'ri1', retainerinvoice_number: 'ANT-2026-063', last_modified_time: '2026-09-15T00:00:00Z' }]))
      if (path.startsWith('/retainerinvoices/ri1')) return Promise.resolve(detail('retainerinvoice', { retainerinvoice_id: 'ri1', retainerinvoice_number: 'ANT-2026-063', status: 'paid', payment_made: 9505784, payment_drawn: 0, last_modified_time: '2026-09-15T00:00:00Z', line_items: [{ line_item_id: 'rl1', description: 'Anticipo OV-2026-167' }] }))
      return Promise.resolve(page('retainerinvoices', []))
    })
    const sync = createBooksHubSync({ booksFetch: booksFetch as any, db, config })
    expect(await sync.backfillRetainerInvoices()).toBe(1)
    const { rows } = await db.query("SELECT payment_made, raw FROM books.retainer_invoices WHERE retainerinvoice_id='ri1'")
    expect(Number(rows[0].payment_made)).toBe(9505784)
    const raw = typeof rows[0].raw === 'string' ? JSON.parse(rows[0].raw) : rows[0].raw
    expect(raw.line_items[0].description).toBe('Anticipo OV-2026-167')
  })

  it('syncRecent incluye los anticipos', async () => {
    const booksFetch = vi.fn().mockImplementation((path: string) => {
      if (path.startsWith('/retainerinvoices?')) return Promise.resolve(page('retainerinvoices', [{ retainerinvoice_id: 'ri1', last_modified_time: '2026-09-15T00:00:00Z' }]))
      if (path.startsWith('/retainerinvoices/ri1')) return Promise.resolve(detail('retainerinvoice', { retainerinvoice_id: 'ri1', last_modified_time: '2026-09-15T00:00:00Z', line_items: [] }))
      // El resto de recursos responde sin su clave → lista vacía.
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })
    const sync = createBooksHubSync({ booksFetch: booksFetch as any, db, config })
    const r = await sync.syncRecent()
    expect(r.retainerInvoices).toBe(1)
  })
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/sync.test.ts`
Expected: FAIL en los dos tests nuevos: `sync.backfillRetainerInvoices is not a function` y
`expected undefined to be 1`.

- [ ] **Paso 3: Implementar.** En `sync.ts`, sustituir las líneas 3-4 (imports de repo y mappers):

```ts
import { upsertContact, upsertItem, upsertSalesOrder, upsertInvoice, replaceSoLines, replaceInvoiceLines, upsertCustomerPayment, replacePaymentInvoices, upsertPurchaseOrder, replacePoLines, upsertRetainerInvoice, maxZohoLastModified, type BooksTable } from './repo'
import { contactRow, itemRow, salesOrderRow, soLineRow, invoiceRow, invoiceLineRow, customerPaymentRow, paymentInvoiceRow, purchaseOrderRow, poLineRow, retainerInvoiceRow } from './mappers'
```

En la interfaz `BooksHubSync`, añadir tras `backfillPurchaseOrders(): Promise<number>`:

```ts
  backfillRetainerInvoices(): Promise<number>
```

y sustituir la línea de `syncRecent`:

```ts
  syncRecent(): Promise<{ contacts: number; items: number; salesOrders: number; invoices: number; payments: number; purchaseOrders: number; retainerInvoices: number }>
```

Añadir tras `persistPurchaseOrder`:

```ts
  async function persistRetainerInvoice(header: any): Promise<void> {
    // El listado no trae line_items, y la descripción de la línea («Anticipo OV-2026-167») es
    // el único enlace del anticipo con su OV: sin el detalle, hub-api no podría cruzarlo.
    const d = await fetchDetail('retainerinvoices', 'retainerinvoice', header.retainerinvoice_id)
    await upsertRetainerInvoice(db, retainerInvoiceRow(d))
  }
```

Cambiar la firma de `incremental` para usar el tipo único:

```ts
  async function incremental(resource: string, key: string, table: BooksTable, extra: Record<string, string>, persist: (raw: any) => Promise<void>): Promise<number> {
```

En el objeto devuelto, añadir tras `backfillPurchaseOrders: …`:

```ts
    backfillRetainerInvoices: () => backfillSimple('retainerinvoices', 'retainerinvoices', {}, persistRetainerInvoice),
```

y dentro de `syncRecent`, tras la línea de `purchaseOrders`:

```ts
        retainerInvoices: await incremental('retainerinvoices', 'retainerinvoices', 'retainer_invoices', {}, persistRetainerInvoice),
```

- [ ] **Paso 4: Ejecutar y ver el verde.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/sync.test.ts`
Expected: PASS, incluidos los tests que ya existían (el de `syncRecent` antiguo sigue en
verde porque su respuesta por defecto no trae la clave `retainerinvoices` y cuenta 0).

- [ ] **Paso 5: Commit.**

```bash
git add packages/zoho-sync/src/booksHub/sync.ts packages/zoho-sync/src/booksHub/sync.test.ts
git commit -m "feat(books): sincroniza las facturas de anticipo (backfill e incremental)"
```

### Tarea A4: Barrido de borrados

**Ficheros:**
- Modificar: `packages/zoho-sync/src/booksHub/sync.ts`
- Test: `packages/zoho-sync/src/booksHub/sweep.test.ts`

- [ ] **Paso 1: Escribir el test que falla.** En `sweep.test.ts`, añadir antes del `})` final
  del `describe`:

```ts
  it('anticipos: borra el huérfano confirmado ausente y deja el vivo', async () => {
    for (const id of ['R1', 'R2']) await db.query('INSERT INTO books.retainer_invoices (retainerinvoice_id) VALUES ($1)', [id])
    const booksFetch = vi.fn().mockImplementation((path: string) => {
      const other = emptyOthers(path)
      if (other) return Promise.resolve(other)
      if (path.startsWith('/retainerinvoices/R2')) return Promise.resolve(new Response(JSON.stringify({ code: 1002, message: 'El recurso no existe.' }), { status: 404 }))
      if (path.startsWith('/retainerinvoices')) return Promise.resolve(new Response(JSON.stringify({ retainerinvoices: [{ retainerinvoice_id: 'R1' }] }), { status: 200 }))
      // Las facturas del beforeEach siguen vivas: aquí solo se mide el barrido de anticipos.
      if (path.startsWith('/invoices')) return Promise.resolve(new Response(JSON.stringify({ invoices: [{ invoice_id: 'A' }, { invoice_id: 'B' }, { invoice_id: 'C' }] }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    })
    const sync = createBooksHubSync({ booksFetch: booksFetch as any, db, config })
    const reports = await sync.sweep({ dryRun: false, guard })
    const ant = reports.find((r) => r.table === 'books.retainer_invoices')!
    expect(ant).toMatchObject({ live: 1, replica: 2, orphans: 1, confirmed: 1, deleted: 1 })
    expect((await db.query('SELECT retainerinvoice_id FROM books.retainer_invoices')).rows.map((r: any) => r.retainerinvoice_id)).toEqual(['R1'])
  })
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/sweep.test.ts`
Expected: FAIL en el test nuevo: `toMatchObject` recibe `undefined` (no hay informe para
`books.retainer_invoices`).

- [ ] **Paso 3: Implementar.** En `sync.ts`, dentro de `sweep`, añadir al final del array
  `entities` (tras la entrada de `items`):

```ts
        // Anticipos: sin tabla hija, las líneas viven en raw. Un anticipo borrado en Zoho que
        // siguiera en la réplica dispararía en el portal un aviso falso de «sin aplicar».
        { schema: 'books', table: 'retainer_invoices', pk: 'retainerinvoice_id', collectLive: () => collectLiveIds('retainerinvoices', 'retainerinvoices', 'retainerinvoice_id'), confirmDeleted: (id) => verifyDeleted('retainerinvoices', id) },
```

- [ ] **Paso 4: Ejecutar y ver el verde.**

Run: `npx vitest run packages/zoho-sync/src/booksHub/sweep.test.ts`
Expected: PASS, los cuatro tests.

- [ ] **Paso 5: Commit.**

```bash
git add packages/zoho-sync/src/booksHub/sync.ts packages/zoho-sync/src/booksHub/sweep.test.ts
git commit -m "feat(books): el barrido diario cubre las facturas de anticipo"
```

### Tarea A5: Backfill al arrancar

**Ficheros:**
- Modificar: `apps/hub-sync/src/hubSync.ts`
- Test: `apps/hub-sync/src/hubSync.test.ts`

- [ ] **Paso 1: Actualizar el test para que falle.** En `hubSync.test.ts`, en **los dos**
  objetos `BooksHubSync` (el del test «migra books.* y backfillea si está vacío», líneas 47-56,
  y `mockBooks`, líneas 67-76), añadir tras la línea de `backfillPurchaseOrders`:

```ts
      backfillRetainerInvoices: async () => { calls.push('ant'); return 0 },
```

y sustituir su línea de `syncRecent` por:

```ts
      syncRecent: async () => ({ contacts: 0, items: 0, salesOrders: 0, invoices: 0, payments: 0, purchaseOrders: 0, retainerInvoices: 0 }),
```

(en `mockBooks` la indentación es de 4 espacios, no de 6). Y sustituir la aserción de la
línea 61:

```ts
    expect(calls).toEqual(['c', 'i', 'so', 'inv', 'pay', 'po', 'ant'])
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npx vitest run apps/hub-sync/src/hubSync.test.ts`
Expected: FAIL en «migra books.* y backfillea si está vacío»: falta `'ant'` en `calls`. Los
tests de `BACKFILL_CONTACTS` siguen en verde: solo comprueban que `'c'` está o no está.

- [ ] **Paso 3: Implementar.** En `hubSync.ts`, añadir tras el guard de órdenes de compra
  (tras su `}` de cierre, dentro de `if (booksHubSync)`):

```ts
    // Guard aparte: los anticipos (facturas de anticipo, /retainerinvoices) llegaron después
    // que el resto de Books. Aislado igual que los demás: un fallo aquí nunca tumba el worker.
    if ((await maxZohoLastModified(db, 'retainer_invoices')) == null) {
      console.log('Books anticipos vacío: backfill…')
      try {
        const n = await booksHubSync.backfillRetainerInvoices()
        console.log(`Backfill de anticipos: ${n} anticipos`)
      } catch (e) {
        console.error('Backfill de anticipos falló (se reintentará en el incremental):', e)
      }
    }
```

- [ ] **Paso 4: Ejecutar y ver el verde.**

Run: `npx vitest run apps/hub-sync/src/hubSync.test.ts`
Expected: PASS.

- [ ] **Paso 5: Commit.**

```bash
git add apps/hub-sync/src/hubSync.ts apps/hub-sync/src/hubSync.test.ts
git commit -m "feat(hub-sync): backfill de anticipos al arrancar si la tabla está vacía"
```

### Tarea A6: Documentación, portones y empuje (con permiso)

**Ficheros:**
- Modificar: `DEPLOY.md`, `openspec/specs/zoho-sync/spec.md`

- [ ] **Paso 1: Actualizar la documentación.** En `DEPLOY.md` línea 35, la lista de entidades:

```md
(artículos, órdenes de venta, facturas, pagos, órdenes de compra, facturas de anticipo) y `crm.*` cuando sus
```

En `openspec/specs/zoho-sync/spec.md`, sustituir la línea 221 entera por (la interfaz de
`sync.ts` creció una línea, de ahí `8-18`):

```md
| **Zoho Books (rico)** | contactos, artículos, órdenes de venta, facturas, pagos, órdenes de compra y facturas de anticipo, con sus líneas | `books.*`, **9** tablas | `booksHub/sync.ts:8-18`; `booksHub/schema-books.sql` |
```

y en la línea 223 cambiar solo el fragmento `` `grep -cE "^CREATE TABLE" schema-books.sql` = 8 ``
por `` `grep -cE "^CREATE TABLE" schema-books.sql` = 9 ``, dejando intacto el resto de la línea.

- [ ] **Paso 2: Comprobar el recuento que cita la documentación.**

Run: `grep -cE "^CREATE TABLE" packages/zoho-sync/src/booksHub/schema-books.sql`
Expected: `9`

- [ ] **Paso 3: Portones.**

Run: `npx vitest run packages/zoho-sync apps/hub-sync`
Expected: PASS.

Run: `npm run typecheck`
Expected: sale con 0. (`npx tsc -p packages/zoho-sync --noEmit` tiene **un error previo y
ajeno** en `src/db/mappers.test.ts(101,3)` por `fecha_aviso_cliente`; no es de este cambio y
`npm run typecheck` no lo incluye.)

- [ ] **Paso 4: Comprobador de citas** (el hook de pre-push bloquea si una cita cae en una
  línea en blanco o más allá del final del fichero).

Run: `node_modules/.bin/tsx apps/desk/server/citas/cli.ts --sha HEAD`
Expected: sin errores. Si marca alguna cita en `booksHub/sync.ts` o `hubSync.ts`, abrir el
documento citante y mover el rango al código que citaba antes (ahora desplazado).

- [ ] **Paso 5: Commit.**

```bash
git add DEPLOY.md openspec/specs/zoho-sync/spec.md
git commit -m "docs(books): las facturas de anticipo en la lista de entidades y tablas"
```

- [ ] **Paso 6: PEDIR PERMISO AL USUARIO para empujar el repo del worker.** No hay
  autorización permanente en este repo. Con el permiso: `git push`.

- [ ] **Paso 7: El usuario redespliega zoho-hub-sync en EasyPanel.** En el log del arranque
  deben aparecer `Books anticipos vacío: backfill…` y `Backfill de anticipos: N anticipos`,
  con N del orden de las decenas.

---

## Parte B — Verificación contra la base real (puerta del despliegue del portal)

Las ejecuta el usuario en la consola de la base. Primero, solo: `\c zoho-hub`. Después, cada
consulta **por separado**: un metacomando de psql pegado junto a una consulta se traga el SQL
como argumentos.

- [ ] **Paso 1: Los campos llegan.**

```sql
SELECT count(*)                                                   AS anticipos,
       count(*) FILTER (WHERE payment_made IS NOT NULL)            AS con_cobrado,
       count(*) FILTER (WHERE payment_drawn IS NOT NULL)           AS con_aplicado,
       count(*) FILTER (WHERE jsonb_typeof(raw -> 'line_items') = 'array') AS con_lineas
  FROM books.retainer_invoices;
```

Expected: las cuatro columnas iguales. Si `con_cobrado` o `con_aplicado` es menor, **PARAR**.

- [ ] **Paso 2: Caso de control.**

```sql
SELECT retainerinvoice_number, status, payment_made, payment_drawn,
       raw -> 'line_items' -> 0 ->> 'description' AS descripcion
  FROM books.retainer_invoices
 WHERE retainerinvoice_number = 'ANT-2026-063';
```

Expected: `paid`, `9505784`, `0` (o lo que se haya aplicado desde el 15-sep), y
`Anticipo OV-2026-167`.

- [ ] **Paso 3: Tasa de enlace.** Aproximación en SQL del patrón de `extraerOV`:

```sql
WITH t AS (
  SELECT retainerinvoice_number AS ant,
         concat_ws(' | ',
           (SELECT string_agg(l ->> 'description', ' | ')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw -> 'line_items') = 'array'
                                             THEN raw -> 'line_items' ELSE '[]'::jsonb END) l),
           reference_number) AS texto
    FROM books.retainer_invoices
   WHERE COALESCE(status, '') NOT IN ('draft', 'void')
)
SELECT CASE WHEN texto ~* 'OV\s*[-–—]?\s*\d{4}' THEN 'con OV legible' ELSE 'sin OV legible' END AS resultado,
       count(*)
  FROM t
 GROUP BY 1;
```

Expected: «sin OV legible» por debajo del 10 % del total. **Si pasa del 10 %, PARAR y
revisarlo con el usuario antes de desplegar el portal**: la especificación pide repensar el
diseño si los que no enlazan son muchos.

- [ ] **Paso 4: Ver los que no se leen**, para saber si alguna variante real falta en la tabla
  de `extraerOV`:

```sql
WITH t AS (
  SELECT retainerinvoice_number AS ant,
         concat_ws(' | ',
           (SELECT string_agg(l ->> 'description', ' | ')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw -> 'line_items') = 'array'
                                             THEN raw -> 'line_items' ELSE '[]'::jsonb END) l),
           reference_number) AS texto
    FROM books.retainer_invoices
   WHERE COALESCE(status, '') NOT IN ('draft', 'void')
)
SELECT ant, texto FROM t WHERE texto IS NULL OR texto !~* 'OV\s*[-–—]?\s*\d{4}' ORDER BY ant;
```

Si aparece una forma de escribirlo que se repite y es inequívoca, se añade una fila a la tabla
de la Tarea C1 **antes** de implementarla (o como tarea extra si ya estaba hecha).

---

## Parte C — hub-api (este repo)

Comandos desde la raíz del repo. Un fichero de tests de hub-api:
`npm run test --workspace=apps/hub-api -- src/contabilidad/<fichero>.test.ts`.

**No lanzar `npx vitest run apps/hub-api` desde la raíz:** no hay config de vitest en la raíz,
así que se salta `apps/hub-api/vitest.config.ts`, que excluye `*.db.test.ts`, y salen unos 281
fallos falsos por no tener Postgres levantado.

### Tarea C1: `extraerOV`

**Ficheros:**
- Crear: `apps/hub-api/src/contabilidad/anticipos.ts`
- Test: `apps/hub-api/src/contabilidad/anticipos.test.ts`

- [ ] **Paso 1: Escribir el test.** Crear `anticipos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extraerOV } from './anticipos.js';

describe('extraerOV', () => {
  // Esta tabla ES la especificación de cómo se escribe un anticipo en Zoho. Una forma nueva
  // que aparezca en los datos reales se añade aquí primero.
  it.each([
    ['Anticipo OV-2026-167', ['OV-2026-167']],
    ['anticipo ov-2026-167', ['OV-2026-167']],
    ['Anticipo OV 2026-167', ['OV-2026-167']],
    ['Anticipo OV2026-167', ['OV-2026-167']],
    ['Anticipo OV-2026-0167', ['OV-2026-167']],
    ['Anticipo OV–2026–167', ['OV-2026-167']],
    ['Anticipo OV-2026-5', ['OV-2026-005']],
    ['Anticipo OV-2026-1000', ['OV-2026-1000']],
    ['Anticipo OV-2026-150 y OV-2026-151', ['OV-2026-150', 'OV-2026-151']],
    ['Anticipo OV-2026-167 | OV-2026-167', ['OV-2026-167']],
    ['Anticipo 50% del pedido', []],
    ['MOV-2026-167', []],
    ['Anticipo OV-26-167', []],
    ['', []],
  ])('%s → %j', (texto, esperado) => {
    expect(extraerOV(texto)).toEqual(esperado);
  });
});
```

- [ ] **Paso 2: Crear el módulo con los tipos y un `extraerOV` vacío**, para que el fallo sea
  de aserción y no de importación. Crear `anticipos.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';

// Anticipos (facturas de anticipo de Zoho, módulo /retainerinvoices) enlazados a su OV.
//
// Zoho NO enlaza el anticipo con la OV: el vínculo es el texto que alguien escribe a mano en
// la descripción de la línea («Anticipo OV-2026-167»). Por eso todo lo que no se pueda leer
// con certeza va a la lista de atención en vez de perderse en silencio: un número mal
// tecleado no da error, simplemente no enlaza.

/** Un anticipo de books.retainer_invoices, con las descripciones de línea ya sacadas de raw. */
export interface AnticipoRow {
  numero: string;
  fecha: string | null;
  estado: string | null;
  cliente: string | null;
  moneda: string | null;
  cobrado: number | string | null;   // payment_made (numeric de pg llega como texto)
  aplicado: number | string | null;  // payment_drawn
  referencia: string | null;
  descripciones: string[];
}

/** La OV a la que apunta un anticipo, con lo necesario para clasificarlo. */
export interface OVRef {
  numero: string;
  estado: string;
  moneda: string | null;
}

export interface AnticipoDeOV {
  numero: string;
  fecha: string | null;
  estado: string | null;
  cobrado: number;
  sinAplicar: number;
}

export interface ImportesAnticipo {
  cobrado: number;
  sinAplicar: number;
  anticipos: AnticipoDeOV[];
}

export type MotivoAtencion =
  | 'sin_referencia'
  | 'varias_ov'
  | 'ov_inexistente'
  | 'moneda_distinta'
  | 'sin_aplicar_ov_cerrada';

export interface AnticipoAtencion {
  numero: string;
  cliente: string | null;
  fecha: string | null;
  cobrado: number;
  sinAplicar: number;
  motivo: MotivoAtencion;
  ov: string | null;        // la OV nombrada, o varias separadas por comas
  estadoOV: string | null;
  texto: string;            // descripción y referencia tal cual se escribieron
}

export interface AnticiposEnlazados {
  porOV: Map<string, ImportesAnticipo>;
  atencion: AnticipoAtencion[];
}

/** Las OV distintas que nombra un texto, normalizadas a OV-AAAA-NNN. Pura. */
export function extraerOV(_texto: string): string[] {
  return [];
}
```

- [ ] **Paso 3: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/anticipos.test.ts`
Expected: FAIL en las 10 filas que esperan alguna OV. Las 4 que esperan `[]` pasan.

- [ ] **Paso 4: Implementar.** Sustituir el `extraerOV` vacío por:

```ts
// «OV» que empieza palabra (MOV-2026-167 no cuenta), separadores tolerantes (guion, raya o
// guion largo, que salen al copiar de Word, o solo espacios) y año de cuatro cifras: un
// «OV-26-167» no se adivina, va al aviso. El número admite ceros a la izquierda.
const PATRON_OV = /(?<![A-Za-z])OV\s*[-–—]?\s*(\d{4})(?!\d)\s*[-–—]?\s*(\d{1,4})(?!\d)/gi;

/** Las OV distintas que nombra un texto, normalizadas a OV-AAAA-NNN. Pura. */
export function extraerOV(texto: string): string[] {
  const vistas = new Set<string>();
  for (const m of texto.matchAll(PATRON_OV)) {
    vistas.add(`OV-${m[1]}-${String(Number(m[2])).padStart(3, '0')}`);
  }
  return [...vistas];
}
```

- [ ] **Paso 5: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/anticipos.test.ts`
Expected: PASS, las 14 filas.

- [ ] **Paso 6: Commit.**

```bash
git add apps/hub-api/src/contabilidad/anticipos.ts apps/hub-api/src/contabilidad/anticipos.test.ts
git commit -m "feat(contabilidad): extraer la OV del texto de un anticipo"
```

### Tarea C2: `enlazarAnticipos` y `conAnticipo`

**Ficheros:**
- Modificar: `apps/hub-api/src/contabilidad/anticipos.ts`
- Test: `apps/hub-api/src/contabilidad/anticipos.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan.** En `anticipos.test.ts`, sustituir el import
  por:

```ts
import { extraerOV, enlazarAnticipos, conAnticipo, type AnticipoRow, type OVRef } from './anticipos.js';
```

y añadir al final:

```ts
// Caso real: ANT-2026-063 de SGS Colombia, cobrado entero el 15-sep y sin aplicar aún.
const ant = (over: Partial<AnticipoRow>): AnticipoRow => ({
  numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cliente: 'SGS Colombia S.A.S.',
  moneda: 'COP', cobrado: '9505784', aplicado: '0', referencia: null,
  descripciones: ['Anticipo OV-2026-167'], ...over,
});
const OV167: OVRef = { numero: 'OV-2026-167', estado: 'open', moneda: 'COP' };

describe('enlazarAnticipos', () => {
  it('caso real ANT-2026-063: suma en OV-2026-167 y no genera aviso', () => {
    const r = enlazarAnticipos([ant({})], [OV167]);
    expect(r.porOV.get('OV-2026-167')).toEqual({
      cobrado: 9505784,
      sinAplicar: 9505784,
      anticipos: [{ numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cobrado: 9505784, sinAplicar: 9505784 }],
    });
    expect(r.atencion).toEqual([]);
  });

  it('suma varios anticipos de la misma OV', () => {
    const r = enlazarAnticipos([
      ant({ numero: 'A1', cobrado: 100, aplicado: 0 }),
      ant({ numero: 'A2', cobrado: 50, aplicado: 50 }),
    ], [OV167]);
    expect(r.porOV.get('OV-2026-167')).toMatchObject({ cobrado: 150, sinAplicar: 100 });
  });

  it('lo sin aplicar nunca es negativo', () => {
    const r = enlazarAnticipos([ant({ cobrado: 100, aplicado: 120 })], [OV167]);
    expect(r.porOV.get('OV-2026-167')!.sinAplicar).toBe(0);
  });

  it('un anticipo aún sin cobrar enlaza con cobrado 0', () => {
    const r = enlazarAnticipos([ant({ estado: 'sent', cobrado: null, aplicado: null })], [OV167]);
    expect(r.porOV.get('OV-2026-167')).toMatchObject({ cobrado: 0, sinAplicar: 0 });
  });

  it('lee la OV también de la referencia', () => {
    const r = enlazarAnticipos([ant({ descripciones: ['Anticipo 50%'], referencia: 'OV-2026-167' })], [OV167]);
    expect(r.porOV.has('OV-2026-167')).toBe(true);
  });

  it('sin_referencia: la descripción no nombra ninguna OV', () => {
    const r = enlazarAnticipos([ant({ descripciones: ['Anticipo 50% del pedido'] })], [OV167]);
    expect(r.atencion).toMatchObject([{ numero: 'ANT-2026-063', motivo: 'sin_referencia', ov: null, texto: 'Anticipo 50% del pedido' }]);
    expect(r.porOV.size).toBe(0);
  });

  it('varias_ov: no reparte el importe', () => {
    const r = enlazarAnticipos([ant({ descripciones: ['Anticipo OV-2026-150 y OV-2026-151'] })], []);
    expect(r.atencion).toMatchObject([{ motivo: 'varias_ov', ov: 'OV-2026-150, OV-2026-151' }]);
    expect(r.porOV.size).toBe(0);
  });

  it('descripción y referencia con OV distintas cuentan como varias', () => {
    const r = enlazarAnticipos([ant({ referencia: 'OV-2026-168' })], [OV167]);
    expect(r.atencion[0].motivo).toBe('varias_ov');
  });

  it('ov_inexistente: el número no está en Zoho', () => {
    const r = enlazarAnticipos([ant({})], []);
    expect(r.atencion).toMatchObject([{ motivo: 'ov_inexistente', ov: 'OV-2026-167', estadoOV: null }]);
  });

  it('moneda_distinta: no suma pesos con dólares', () => {
    const r = enlazarAnticipos([ant({ moneda: 'USD' })], [OV167]);
    expect(r.atencion).toMatchObject([{ motivo: 'moneda_distinta', ov: 'OV-2026-167' }]);
    expect(r.porOV.size).toBe(0);
  });

  it('sin_aplicar_ov_cerrada: OV ya facturada con saldo sin aplicar', () => {
    const r = enlazarAnticipos([ant({})], [{ ...OV167, estado: 'invoiced' }]);
    expect(r.atencion).toMatchObject([{ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'invoiced', sinAplicar: 9505784 }]);
  });

  it('sin_aplicar_ov_cerrada también en una OV anulada', () => {
    const r = enlazarAnticipos([ant({})], [{ ...OV167, estado: 'void' }]);
    expect(r.atencion[0]).toMatchObject({ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'void' });
  });

  it('OV cerrada con el anticipo ya aplicado del todo: sin aviso', () => {
    const r = enlazarAnticipos([ant({ aplicado: '9505784' })], [{ ...OV167, estado: 'invoiced' }]);
    expect(r.atencion).toEqual([]);
  });

  it('la moneda gana a la OV cerrada (orden de los motivos)', () => {
    const r = enlazarAnticipos([ant({ moneda: 'USD' })], [{ ...OV167, estado: 'invoiced' }]);
    expect(r.atencion[0].motivo).toBe('moneda_distinta');
  });

  it('la lista de atención va de más reciente a más antigua', () => {
    const r = enlazarAnticipos([
      ant({ numero: 'viejo', fecha: '2026-07-01', descripciones: ['x'] }),
      ant({ numero: 'nuevo', fecha: '2026-09-01', descripciones: ['y'] }),
    ], []);
    expect(r.atencion.map((a) => a.numero)).toEqual(['nuevo', 'viejo']);
  });
});

describe('conAnticipo', () => {
  it('añade los importes sin tocar el original, y null si la OV no tiene anticipos', () => {
    const enl = enlazarAnticipos([ant({})], [OV167]);
    const original = { salesorder_number: 'OV-2026-167' };
    expect(conAnticipo(original, enl)).toEqual({ salesorder_number: 'OV-2026-167', anticipoCobrado: 9505784, anticipoSinAplicar: 9505784 });
    expect(original).toEqual({ salesorder_number: 'OV-2026-167' });
    expect(conAnticipo({ salesorder_number: 'OV-2026-999' }, enl)).toMatchObject({ anticipoCobrado: null, anticipoSinAplicar: null });
  });
});
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/anticipos.test.ts`
Expected: FAIL en los tests nuevos con `TypeError: enlazarAnticipos is not a function` y
`conAnticipo is not a function`. Las filas de `extraerOV` siguen en verde.

- [ ] **Paso 3: Implementar.** Añadir al final de `anticipos.ts`:

```ts
// Una OV ya no pendiente de facturar. Si le queda anticipo sin aplicar, hay algo que hacer:
// facturada → se le cobró el total sin descontar lo pagado; anulada → hay que devolverlo.
const ESTADOS_CERRADOS = new Set(['invoiced', 'void']);

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Texto donde se busca la OV: todas las descripciones de línea más la referencia. Pura. */
export function textoDe(a: AnticipoRow): string {
  return [...a.descripciones, a.referencia ?? ''].filter(Boolean).join(' | ');
}

/**
 * Clasifica cada anticipo: o suma en su OV, o va a la lista de atención con UN motivo.
 * Los motivos se evalúan en este orden y gana el primero que cumple: sin referencia, varias
 * OV, OV inexistente, moneda distinta, sin aplicar en OV cerrada. Uno en otra moneda sobre
 * una OV facturada sale como `moneda_distinta`: hasta aclarar la moneda no se puede afirmar
 * nada de su saldo. Pura.
 */
export function enlazarAnticipos(anticipos: AnticipoRow[], ovs: OVRef[]): AnticiposEnlazados {
  const ovPorNumero = new Map(ovs.map((o) => [o.numero, o]));
  const porOV = new Map<string, ImportesAnticipo>();
  const atencion: AnticipoAtencion[] = [];

  for (const a of anticipos) {
    const cobrado = num(a.cobrado);
    const sinAplicar = Math.max(0, cobrado - num(a.aplicado));
    const texto = textoDe(a);
    const refs = extraerOV(texto);
    const avisar = (motivo: MotivoAtencion, ov: string | null, estadoOV: string | null) =>
      atencion.push({ numero: a.numero, cliente: a.cliente, fecha: a.fecha, cobrado, sinAplicar, motivo, ov, estadoOV, texto });

    if (refs.length === 0) { avisar('sin_referencia', null, null); continue; }
    if (refs.length > 1) { avisar('varias_ov', refs.join(', '), null); continue; }
    const ov = ovPorNumero.get(refs[0]);
    if (!ov) { avisar('ov_inexistente', refs[0], null); continue; }
    if ((a.moneda ?? '') !== (ov.moneda ?? '')) { avisar('moneda_distinta', ov.numero, ov.estado); continue; }
    if (ESTADOS_CERRADOS.has(ov.estado) && sinAplicar > 0) { avisar('sin_aplicar_ov_cerrada', ov.numero, ov.estado); continue; }

    const acum = porOV.get(ov.numero) ?? { cobrado: 0, sinAplicar: 0, anticipos: [] };
    acum.cobrado += cobrado;
    acum.sinAplicar += sinAplicar;
    acum.anticipos.push({ numero: a.numero, fecha: a.fecha, estado: a.estado, cobrado, sinAplicar });
    porOV.set(ov.numero, acum);
  }

  atencion.sort((x, y) => (y.fecha ?? '').localeCompare(x.fecha ?? ''));
  return { porOV, atencion };
}

/**
 * Devuelve una COPIA de la OV con los importes de anticipo; `null` = la OV no tiene ninguno.
 * Nunca muta: la lista de OV está cacheada y la comparten las dos apps.
 */
export function conAnticipo<T extends { salesorder_number: string }>(
  o: T,
  enl: AnticiposEnlazados,
): T & { anticipoCobrado: number | null; anticipoSinAplicar: number | null } {
  const a = enl.porOV.get(o.salesorder_number);
  return { ...o, anticipoCobrado: a ? a.cobrado : null, anticipoSinAplicar: a ? a.sinAplicar : null };
}
```

- [ ] **Paso 4: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/anticipos.test.ts`
Expected: PASS.

- [ ] **Paso 5: Commit.**

```bash
git add apps/hub-api/src/contabilidad/anticipos.ts apps/hub-api/src/contabilidad/anticipos.test.ts
git commit -m "feat(contabilidad): enlazar anticipos con su OV y clasificar los que requieren atención"
```

### Tarea C3: Lectura de la base (`getAnticiposEnlazados`)

**Ficheros:**
- Modificar: `apps/hub-api/src/contabilidad/anticipos.ts`
- Test: `apps/hub-api/src/contabilidad/anticipos.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan.** Sustituir los imports de `anticipos.test.ts`
  por:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { extraerOV, enlazarAnticipos, conAnticipo, getAnticiposEnlazados, type AnticipoRow, type OVRef } from './anticipos.js';
```

y añadir al final:

```ts
describe('getAnticiposEnlazados', () => {
  it('saca las descripciones de raw, consulta solo las OV nombradas y enlaza', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cliente: 'SGS Colombia S.A.S.', moneda: 'COP',
        cobrado: '9505784', aplicado: '0', referencia: null,
        lineas: [{ description: 'Anticipo OV-2026-167' }, { description: '' }, { otra: 1 }],
      }] })
      .mockResolvedValueOnce({ rows: [{ numero: 'OV-2026-167', estado: 'open', moneda: 'COP' }] });
    const r = await getAnticiposEnlazados({ query } as unknown as Pool);
    expect(query.mock.calls[1][1]).toEqual([['OV-2026-167']]);
    expect(r.porOV.get('OV-2026-167')).toMatchObject({ cobrado: 9505784, sinAplicar: 9505784 });
    expect(r.atencion).toEqual([]);
  });

  it('sin anticipos no consulta las OV', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const r = await getAnticiposEnlazados({ query } as unknown as Pool);
    expect(query).toHaveBeenCalledTimes(1);
    expect(r.porOV.size).toBe(0);
    expect(r.atencion).toEqual([]);
  });

  it('lineas que no son una lista no rompen: el anticipo va al aviso', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      numero: 'ANT-X', fecha: null, estado: 'paid', cliente: null, moneda: 'COP',
      cobrado: 1, aplicado: 0, referencia: null, lineas: null,
    }] });
    const r = await getAnticiposEnlazados({ query } as unknown as Pool);
    expect(r.atencion).toMatchObject([{ numero: 'ANT-X', motivo: 'sin_referencia' }]);
  });
});
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/anticipos.test.ts`
Expected: FAIL en los tres tests nuevos: `getAnticiposEnlazados is not a function`.

- [ ] **Paso 3: Implementar.** Añadir al final de `anticipos.ts`:

```ts
// Borradores y anulados no cuentan: ni se han emitido ni se van a cobrar.
const ANTICIPOS_SQL = `
  SELECT ri.retainerinvoice_number AS numero,
         ri.date::text              AS fecha,
         ri.status                  AS estado,
         ri.customer_name           AS cliente,
         ri.currency_code           AS moneda,
         ri.payment_made            AS cobrado,
         ri.payment_drawn           AS aplicado,
         ri.reference_number        AS referencia,
         ri.raw -> 'line_items'     AS lineas
    FROM books.retainer_invoices ri
   WHERE COALESCE(ri.status, '') NOT IN ('draft', 'void')`;

// Solo las OV que algún anticipo nombra, en CUALQUIER estado: hace falta saber también de las
// ya facturadas o anuladas para avisar de su anticipo sin aplicar.
const OVS_SQL = `
  SELECT salesorder_number AS numero, status AS estado, currency_code AS moneda
    FROM books.sales_orders
   WHERE salesorder_number = ANY($1::text[])`;

interface FilaAnticipo extends Omit<AnticipoRow, 'descripciones'> {
  lineas: unknown;
}

function descripcionesDe(lineas: unknown): string[] {
  if (!Array.isArray(lineas)) return [];
  return lineas
    .map((l) => (l && typeof l === 'object' ? (l as { description?: unknown }).description : null))
    .filter((d): d is string => typeof d === 'string' && d.trim() !== '');
}

/** Lee los anticipos y las OV que nombran, y los enlaza. */
export async function getAnticiposEnlazados(db: Pool): Promise<AnticiposEnlazados> {
  const { rows } = await db.query(ANTICIPOS_SQL);
  const anticipos: AnticipoRow[] = (rows as FilaAnticipo[]).map(({ lineas, ...r }) => ({
    ...r,
    descripciones: descripcionesDe(lineas),
  }));
  const numeros = [...new Set(anticipos.flatMap((a) => extraerOV(textoDe(a))))];
  const ovs = numeros.length ? ((await db.query(OVS_SQL, [numeros])).rows as OVRef[]) : [];
  return enlazarAnticipos(anticipos, ovs);
}
```

- [ ] **Paso 4: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/anticipos.test.ts`
Expected: PASS.

- [ ] **Paso 5: Commit.**

```bash
git add apps/hub-api/src/contabilidad/anticipos.ts apps/hub-api/src/contabilidad/anticipos.test.ts
git commit -m "feat(contabilidad): leer los anticipos de la réplica y las OV que nombran"
```

### Tarea C4: Endpoints — permiso, resiliencia y aviso

**Ficheros:**
- Modificar: `apps/hub-api/src/contabilidad/router.ts`
- Test: crear `apps/hub-api/src/contabilidad/router.anticipos.test.ts`

Test aparte de `router.test.ts` porque necesita simular módulos (`anticipos`,
`ovPendientes`, `detalle`) que los tests de ese fichero usan de verdad.

- [ ] **Paso 1: Escribir el test que falla.** Crear `router.anticipos.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';
import { clearCache } from '../cache.js';

// Mismo arranque que router.test.ts: auth.ts lee JWT_SECRET AL CARGAR, así que el env se fija
// antes de importar el router, y el router se importa dinámicamente en beforeAll.
const SECRET = 'test-secret-anticipos';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// requireAuth consulta la BD y PISA role/apps con lo que diga la fila: el mock devuelve
// exactamente lo que acuña token().
const estadoAuth = vi.hoisted(() => ({ role: 'reader', apps: [] as string[] }));
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async () => ({
      rows: [{ role: estadoAuth.role, status: 'active', apps: estadoAuth.apps, token_version: 0 }],
      rowCount: 1,
    }),
    on: () => {},
  }),
}));

// Los anticipos se simulan con la lógica REAL de enlace sobre un caso fijo; `falla` imita que
// books.retainer_invoices aún no exista (el worker sin desplegar).
const anticiposMock = vi.hoisted(() => ({ falla: false }));
vi.mock('./anticipos.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./anticipos.js')>();
  return {
    ...real,
    getAnticiposEnlazados: vi.fn(async () => {
      if (anticiposMock.falla) throw new Error('relation "books.retainer_invoices" does not exist');
      return real.enlazarAnticipos(
        [{ numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cliente: 'SGS', moneda: 'COP', cobrado: 1000, aplicado: 0, referencia: null, descripciones: ['Anticipo OV-2026-167'] }],
        [{ numero: 'OV-2026-167', estado: 'open', moneda: 'COP' }],
      );
    }),
  };
});

vi.mock('./ovPendientes.js', () => ({
  getOVPendientesFacturables: vi.fn(async () => [{
    salesorder_number: 'OV-2026-167', date: '2026-09-01', customer_name: 'SGS', status: 'open',
    currency_code: 'COP', total: 1000, pending: 1000, shipment_date: null,
    despachada: false, despachoParcial: false, soloPaquete: false, ticketPorFacturar: false,
    paquetePorCrear: false, facturable: false, ticket: null, trato: '', qt: '',
  }]),
}));

vi.mock('./detalle.js', () => ({
  getDetalleFactura: vi.fn(async () => null),
  getDetalleOV: vi.fn(async (_db: unknown, numero: string) => ({
    numero, cliente: 'SGS', nit: null, direccion: null, fecha: '2026-09-01', entrega: null,
    terminos: null, lineas: [], subtotal: 0, iva: 0, total: 0,
  })),
}));

let createContabilidadRouter: typeof import('./router.js')['createContabilidadRouter'];
beforeAll(async () => {
  ({ createContabilidadRouter } = await import('./router.js'));
});

// La caché del router es de módulo y dura 120 s: sin limpiarla, un test vería lo del anterior.
beforeEach(() => {
  clearCache();
  anticiposMock.falla = false;
});

const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function token(apps: string[], role = 'reader'): string {
  estadoAuth.role = role;
  estadoAuth.apps = apps;
  return jwt.sign({ sub: 'u@t.co', user_id: USER_ID, role, apps, token_version: 0 }, SECRET);
}

function app(): express.Express {
  const a = express();
  a.use(express.json());
  a.use('/api', createContabilidadRouter({ query: vi.fn() } as unknown as Pool));
  return a;
}

const get = (ruta: string, apps: string[], role = 'reader') =>
  request(app()).get(ruta).set('Authorization', `Bearer ${token(apps, role)}`);

describe('anticipos en GET /contabilidad/ov-pendientes', () => {
  it('con Contabilidad cada OV trae anticipoCobrado y anticipoSinAplicar', async () => {
    const res = await get('/api/contabilidad/ov-pendientes', ['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body.orders[0]).toMatchObject({ anticipoCobrado: 1000, anticipoSinAplicar: 1000 });
  });

  it('con SOLO ov-pendientes los campos NO se envían, ni siquiera a cero', async () => {
    const res = await get('/api/contabilidad/ov-pendientes', ['ov-pendientes']);
    expect(res.status).toBe(200);
    expect(res.body.orders[0]).not.toHaveProperty('anticipoCobrado');
    expect(res.body.orders[0]).not.toHaveProperty('anticipoSinAplicar');
  });

  it('un admin sin la app los ve: misma regla que requireApp', async () => {
    const res = await get('/api/contabilidad/ov-pendientes', [], 'admin');
    expect(res.body.orders[0]).toHaveProperty('anticipoCobrado', 1000);
  });

  it('si leer los anticipos falla, la tabla responde igual, sin ellos', async () => {
    anticiposMock.falla = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/api/contabilidad/ov-pendientes', ['contabilidad']);
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).not.toHaveProperty('anticipoCobrado');
  });

  it('no contamina la lista cacheada: después de Contabilidad, ov-pendientes sigue sin campos', async () => {
    await get('/api/contabilidad/ov-pendientes', ['contabilidad']);
    const res = await get('/api/contabilidad/ov-pendientes', ['ov-pendientes']);
    expect(res.body.orders[0]).not.toHaveProperty('anticipoCobrado');
  });
});

describe('anticipos en GET /contabilidad/ov/:numero', () => {
  it('con Contabilidad trae la lista de anticipos de la OV', async () => {
    const res = await get('/api/contabilidad/ov/OV-2026-167', ['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body.anticipos).toEqual([
      { numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cobrado: 1000, sinAplicar: 1000 },
    ]);
  });

  it('una OV sin anticipos trae la lista vacía', async () => {
    const res = await get('/api/contabilidad/ov/OV-2026-999', ['contabilidad']);
    expect(res.body.anticipos).toEqual([]);
  });

  it('con SOLO ov-pendientes no trae la lista', async () => {
    const res = await get('/api/contabilidad/ov/OV-2026-167', ['ov-pendientes']);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('anticipos');
  });
});

describe('GET /contabilidad/anticipos-atencion', () => {
  it('403 con SOLO ov-pendientes', async () => {
    const res = await get('/api/contabilidad/anticipos-atencion', ['ov-pendientes']);
    expect(res.status).toBe(403);
  });

  it('200 con Contabilidad y devuelve la lista', async () => {
    const res = await get('/api/contabilidad/anticipos-atencion', ['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body.anticipos).toEqual([]);
  });
});
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/router.anticipos.test.ts`
Expected: FAIL en seis tests: «con Contabilidad cada OV trae…», «un admin sin la app…», los
dos del modal con Contabilidad, y los dos de `/anticipos-atencion` (la ruta no existe: 404).
Pasan ya cuatro, porque hoy nunca se envían campos de anticipo: «NO se envían», «si leer los
anticipos falla…», «no contamina la lista cacheada» y «con SOLO ov-pendientes no trae la
lista». Son los guardas del permiso y de la resiliencia; el Paso 5 comprueba que muerden.

- [ ] **Paso 3: Implementar.** En `router.ts`, añadir a los imports:

```ts
import { getAnticiposEnlazados, conAnticipo, type AnticiposEnlazados } from './anticipos.js';
```

Añadir tras la función `sendError`:

```ts
const CACHE_ANTICIPOS = 'contabilidad:anticipos';

// Los anticipos son información de cobro: solo los ve quien tiene Contabilidad, o un admin
// (misma regla que requireApp). La app `ov-pendientes` existe precisamente para quien no debe
// ver la facturación, así que a ella ni siquiera se le envían.
function veAnticipos(req: Request): boolean {
  const u = getPayload(req);
  return u?.role === 'admin' || !!u?.apps?.includes(APP_ID);
}

// Los anticipos NUNCA pueden tumbar la tabla de OV. Si su lectura falla (p. ej. porque el
// worker aún no creó books.retainer_invoices), se responde sin ellos y se registra.
async function anticiposSeguros(db: Pool): Promise<AnticiposEnlazados | null> {
  try {
    return await cached(CACHE_ANTICIPOS, () => getAnticiposEnlazados(db));
  } catch (e) {
    console.error('contabilidad_anticipos error', e);
    captureError(e, { endpoint: 'contabilidad_anticipos' });
    return null;
  }
}
```

Sustituir el handler de `/contabilidad/ov-pendientes` entero por:

```ts
  router.get('/contabilidad/ov-pendientes', requireAuth, requireApp(APP_ID, APP_ID_OV), async (req: Request, res: Response) => {
    try {
      const orders = await cached('contabilidad:ov-pendientes', () => getOVPendientesFacturables(db));
      const enl = veAnticipos(req) ? await anticiposSeguros(db) : null;
      // conAnticipo devuelve copias: `orders` es el array cacheado que comparten las dos apps.
      res.json({ orders: enl ? orders.map((o) => conAnticipo(o, enl)) : orders });
    } catch (e) {
      sendError(res, e, 'contabilidad_ov_pendientes');
    }
  });
```

Sustituir el handler de `/contabilidad/ov/:numero` entero por:

```ts
  router.get('/contabilidad/ov/:numero', requireAuth, requireApp(APP_ID, APP_ID_OV), async (req: Request, res: Response) => {
    try {
      const d = await getDetalleOV(db, req.params.numero);
      if (!d) return void res.status(404).json({ error: 'ov no encontrada' });
      const enl = veAnticipos(req) ? await anticiposSeguros(db) : null;
      res.json(enl ? { ...d, anticipos: enl.porOV.get(d.numero)?.anticipos ?? [] } : d);
    } catch (e) {
      sendError(res, e, 'contabilidad_detalle_ov');
    }
  });

  // Anticipos que no se pudieron enlazar con una OV, o con saldo sin aplicar en una OV ya
  // cerrada. Solo Contabilidad: es información de cobro.
  router.get('/contabilidad/anticipos-atencion', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const enl = await cached(CACHE_ANTICIPOS, () => getAnticiposEnlazados(db));
      res.json({ anticipos: enl.atencion });
    } catch (e) {
      sendError(res, e, 'contabilidad_anticipos_atencion');
    }
  });
```

- [ ] **Paso 4: Ejecutar y ver el verde**, junto con los tests que ya había del router.

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad`
Expected: PASS, todos los ficheros de `src/contabilidad`.

- [ ] **Paso 5: Comprobar que los guardas del permiso muerden.** Cambiar temporalmente en
  `veAnticipos` la línea del `return` por `return true;` y ejecutar:

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/router.anticipos.test.ts`
Expected: FAIL en «con SOLO ov-pendientes los campos NO se envían», «no contamina la lista
cacheada» y «con SOLO ov-pendientes no trae la lista». **Restaurar la línea original** y
volver a ejecutar: PASS.

- [ ] **Paso 6: Portón de tipos.**

Run: `npm run build --workspace=apps/hub-api`
Expected: `tsc -b` sin errores (incluye los `*.test.ts` de hub-api).

- [ ] **Paso 7: Commit.**

```bash
git add apps/hub-api/src/contabilidad/router.ts apps/hub-api/src/contabilidad/router.anticipos.test.ts
git commit -m "feat(contabilidad): anticipos en las OV pendientes, solo para Contabilidad"
```

---

## Parte D — Portal (`apps/contabilidad`, este repo)

### Tarea D1: Infraestructura de tests

`apps/contabilidad` no tiene tests, ni script, ni config, ni vitest. Se calca de
`apps/inventory-optimization`, más el arreglo de `localStorage` del portal (en Node 22+ el
`localStorage` de Node tapa al de jsdom y vale `undefined`).

**Ficheros:**
- Modificar: `apps/contabilidad/package.json` (vía npm)
- Crear: `apps/contabilidad/vitest.config.ts`, `apps/contabilidad/src/test/setup.ts`
- Test: crear `apps/contabilidad/src/useColumnPrefs.test.ts`

- [ ] **Paso 1: Añadir vitest y el script.**

Run: `npm install --save-dev vitest@^2.1.9 --workspace=apps/contabilidad`
Expected: `apps/contabilidad/package.json` gana `"vitest": "^2.1.9"` en `devDependencies`, y
cambia `package-lock.json`.

Añadir a los `scripts` de `apps/contabilidad/package.json`, tras `"preview": "vite preview"`:

```json
    "preview": "vite preview",
    "test": "vitest run"
```

- [ ] **Paso 2: Crear `apps/contabilidad/vitest.config.ts`:**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tests de la app: jsdom + React Testing Library, como apps/inventory-optimization. No toca
// el build (ese usa vite.config.ts) ni entra en el portón de tipos del portal.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **Paso 3: Crear `apps/contabilidad/src/test/setup.ts`:**

```ts
// Setup de los tests: matchers de jest-dom, limpieza del DOM entre tests (RTL 16 no limpia
// sola sin globals) y el arreglo de localStorage.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { JSDOM } from 'jsdom';

// En Node 22+ el `localStorage` de Node tapa al de jsdom y vale `undefined` (la explicación
// entera está en apps/portal/src/vitest.setup.ts). Se trae uno de un JSDOM aparte; la URL es
// obligatoria, porque jsdom niega localStorage a los orígenes opacos.
if (typeof window !== 'undefined' && !globalThis.localStorage) {
  globalThis.localStorage = new JSDOM('', { url: 'http://localhost:3000' }).window.localStorage;
}

afterEach(() => {
  cleanup();
});
```

- [ ] **Paso 4: Test de caracterización de `useColumnPrefs`.** No es TDD: el hook ya lo hace.
  Se fija porque la aparición de las columnas nuevas depende de ello y hoy no lo protege
  ningún test. Crear `apps/contabilidad/src/useColumnPrefs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useColumnPrefs } from './useColumnPrefs';

const CLAVE = 'contabilidad:columnas:ov-pendientes:u1';

beforeEach(() => localStorage.clear());

describe('useColumnPrefs con columnas nuevas', () => {
  it('una configuración guardada antigua recibe las columnas nuevas al final, visibles', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ orden: ['b', 'a'], ocultas: ['a'], anchos: { b: 200 } }));
    const { result } = renderHook(() => useColumnPrefs(CLAVE, ['a', 'b', 'nueva']));
    expect(result.current.orden).toEqual(['b', 'a', 'nueva']);
    expect(result.current.esVisible('nueva')).toBe(true);
    expect(result.current.esVisible('a')).toBe(false);
    expect(result.current.anchoDe('b')).toBe(200);
  });

  it('sin nada guardado usa el orden por defecto', () => {
    const { result } = renderHook(() => useColumnPrefs(CLAVE, ['a', 'b']));
    expect(result.current.orden).toEqual(['a', 'b']);
    expect(result.current.personalizado).toBe(false);
  });
});
```

- [ ] **Paso 5: Ejecutar.**

Run: `npm run test --workspace=apps/contabilidad`
Expected: PASS, 2 tests. Si falla por `localStorage is not defined` o similar, el arreglo del
setup no se aplicó: revisar `setupFiles`.

- [ ] **Paso 6: Commit.**

```bash
git add apps/contabilidad/package.json package-lock.json apps/contabilidad/vitest.config.ts apps/contabilidad/src/test/setup.ts apps/contabilidad/src/useColumnPrefs.test.ts
git commit -m "test(contabilidad): infraestructura de tests y caracterización de useColumnPrefs"
```

### Tarea D2: Tipos y cliente de la API

Solo tipos y una función de fetch con el mismo patrón que las demás; su comportamiento se
cubre en la Tarea D6 a través del componente.

**Ficheros:**
- Modificar: `apps/contabilidad/src/api.ts`

- [ ] **Paso 1: Ampliar `OVPendienteFacturable`.** Sustituir la interfaz entera por:

```ts
export interface OVPendienteFacturable extends PendingSalesOrder {
  despachada: boolean;
  despachoParcial: boolean;
  soloPaquete: boolean;
  ticketPorFacturar: boolean;
  paquetePorCrear: boolean;
  facturable: boolean;
  ticket: string | null;
  trato: string;
  qt: string;
  /** Solo llegan si el usuario tiene Contabilidad. `null` = la OV no tiene anticipos. */
  anticipoCobrado?: number | null;
  anticipoSinAplicar?: number | null;
}
```

- [ ] **Paso 2: Ampliar `DetalleOV`.** Sustituir la interfaz entera y añadir `AnticipoDeOV`
  justo antes:

```ts
/** Espejo de AnticipoDeOV en apps/hub-api/src/contabilidad/anticipos.ts */
export interface AnticipoDeOV { numero: string; fecha: string | null; estado: string | null; cobrado: number; sinAplicar: number; }
export interface DetalleOV {
  numero: string; cliente: string; nit: string | null; direccion: string | null;
  fecha: string; entrega: string | null; terminos: string | null;
  lineas: DetalleLinea[]; subtotal: number; iva: number; total: number;
  /** Solo llega si el usuario tiene Contabilidad. */
  anticipos?: AnticipoDeOV[];
}
```

- [ ] **Paso 3: Añadir al final del fichero:**

```ts
/** Espejo de apps/hub-api/src/contabilidad/anticipos.ts */
export type MotivoAtencion =
  | 'sin_referencia'
  | 'varias_ov'
  | 'ov_inexistente'
  | 'moneda_distinta'
  | 'sin_aplicar_ov_cerrada';

export interface AnticipoAtencion {
  numero: string;
  cliente: string | null;
  fecha: string | null;
  cobrado: number;
  sinAplicar: number;
  motivo: MotivoAtencion;
  ov: string | null;
  estadoOV: string | null;
  texto: string;
}

/** Anticipos que requieren atención. Solo Contabilidad; lanza si falla, como las demás. */
export async function fetchAnticiposAtencion(): Promise<AnticipoAtencion[]> {
  const res = await fetch(`${API_BASE}/api/contabilidad/anticipos-atencion`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { anticipos?: AnticipoAtencion[] };
  if (!Array.isArray(data.anticipos)) throw new Error('Formato inesperado del hub (anticipos).');
  return data.anticipos;
}
```

- [ ] **Paso 4: Commit.**

```bash
git add apps/contabilidad/src/api.ts
git commit -m "feat(contabilidad): tipos y cliente de los anticipos"
```

### Tarea D3: Helpers puros de la tabla (`ovTabla.ts`)

**Ficheros:**
- Crear: `apps/contabilidad/src/ovTabla.ts`
- Test: `apps/contabilidad/src/ovTabla.test.ts`

- [ ] **Paso 1: Escribir el test.** Crear `ovTabla.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compararValores, traeAnticipos, columnasDisponibles, celdaAnticipo, motivoLegible, estadoAnticipo } from './ovTabla';
import { formatCOP } from './format';

describe('compararValores', () => {
  it('ordena números por valor', () => {
    expect(compararValores(2, 10)).toBeLessThan(0);
  });
  it('una OV sin anticipo (null) va por debajo de un anticipo de 0', () => {
    expect(compararValores(null, 0)).toBeLessThan(0);
    expect(compararValores(0, null)).toBeGreaterThan(0);
  });
  it('dos vacíos empatan', () => {
    expect(compararValores(null, null)).toBe(0);
  });
  it('los textos van en orden alfabético español', () => {
    expect(compararValores('Ñandú', 'Oso')).toBeLessThan(0);
  });
});

describe('traeAnticipos', () => {
  it('solo si las filas traen el campo, aunque valga null', () => {
    expect(traeAnticipos([{ anticipoCobrado: null }])).toBe(true);
    expect(traeAnticipos([{ salesorder_number: 'OV-1' }])).toBe(false);
    expect(traeAnticipos([])).toBe(false);
    expect(traeAnticipos(null)).toBe(false);
  });
});

describe('columnasDisponibles', () => {
  it('sin acceso quita las dos columnas de anticipo y conserva el orden del resto', () => {
    const orden = ['status', 'anticipoCobrado', 'pending', 'anticipoSinAplicar'];
    expect(columnasDisponibles(orden, false)).toEqual(['status', 'pending']);
    expect(columnasDisponibles(orden, true)).toEqual(orden);
  });
});

describe('celdaAnticipo', () => {
  it('«—» si la OV no tiene anticipos; el importe si los tiene, aunque sea 0', () => {
    expect(celdaAnticipo(null)).toBe('—');
    expect(celdaAnticipo(undefined)).toBe('—');
    expect(celdaAnticipo(0)).toBe(formatCOP(0));
    expect(celdaAnticipo(9505784)).toBe(formatCOP(9505784));
  });
});

describe('motivoLegible', () => {
  it('explica cada motivo y distingue la OV facturada de la anulada', () => {
    expect(motivoLegible({ motivo: 'sin_referencia', estadoOV: null })).toMatch(/no nombra ninguna OV/);
    expect(motivoLegible({ motivo: 'varias_ov', estadoOV: null })).toMatch(/varias OV/);
    expect(motivoLegible({ motivo: 'ov_inexistente', estadoOV: null })).toMatch(/no existe/);
    expect(motivoLegible({ motivo: 'moneda_distinta', estadoOV: 'open' })).toMatch(/monedas distintas/);
    expect(motivoLegible({ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'invoiced' })).toMatch(/facturada/);
    expect(motivoLegible({ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'void' })).toMatch(/anulada/);
  });
});

describe('estadoAnticipo', () => {
  it('traduce los estados de Zoho y deja pasar los desconocidos', () => {
    expect(estadoAnticipo('paid')).toBe('Pagado');
    expect(estadoAnticipo('partially_paid')).toBe('Pago parcial');
    expect(estadoAnticipo('raro')).toBe('raro');
    expect(estadoAnticipo(null)).toBe('—');
  });
});
```

- [ ] **Paso 2: Crear el módulo con funciones vacías**, para que el fallo sea de aserción.
  Crear `ovTabla.ts`:

```ts
import type { AnticipoAtencion } from './api';

export const COLUMNAS_ANTICIPO: readonly string[] = ['anticipoCobrado', 'anticipoSinAplicar'];

export function compararValores(_av: unknown, _bv: unknown): number { return 0; }
export function traeAnticipos(_ordenes: readonly object[] | null): boolean { return false; }
export function columnasDisponibles<K extends string>(orden: readonly K[], _conAnticipos: boolean): K[] { return [...orden]; }
export function celdaAnticipo(_v: number | null | undefined): string { return ''; }
export function motivoLegible(_a: Pick<AnticipoAtencion, 'motivo' | 'estadoOV'>): string { return ''; }
export function estadoAnticipo(_s: string | null): string { return ''; }
```

- [ ] **Paso 3: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/contabilidad -- src/ovTabla.test.ts`
Expected: FAIL en todos menos «dos vacíos empatan», que pasa porque el stub devuelve 0, igual
que la implementación en ese caso.

- [ ] **Paso 4: Implementar.** Sustituir `ovTabla.ts` entero por:

```ts
import type { AnticipoAtencion, MotivoAtencion } from './api';
import { formatCOP } from './format';

// Helpers puros de la tabla de OV pendientes: aquí viven las decisiones que se pueden
// testear sin montar el componente.

/** Claves de las columnas de anticipo. Solo existen si el servidor manda los campos. */
export const COLUMNAS_ANTICIPO: readonly string[] = ['anticipoCobrado', 'anticipoSinAplicar'];

/**
 * Compara dos valores de celda para ordenar. Si alguno es número, la columna es numérica y lo
 * vacío (una OV sin anticipos) queda por debajo de cualquier importe, incluido el 0. Si no,
 * orden alfabético español.
 */
export function compararValores(av: unknown, bv: unknown): number {
  const an = typeof av === 'number' ? av : null;
  const bn = typeof bv === 'number' ? bv : null;
  if (an !== null || bn !== null) return (an ?? -1) - (bn ?? -1);
  return String(av ?? '').localeCompare(String(bv ?? ''), 'es');
}

/** ¿Trae la respuesta los campos de anticipo? El servidor solo los manda a Contabilidad. */
export function traeAnticipos(ordenes: readonly object[] | null): boolean {
  return !!ordenes?.some((o) => 'anticipoCobrado' in o);
}

/** Quita las columnas de anticipo cuando el usuario no las recibe. */
export function columnasDisponibles<K extends string>(orden: readonly K[], conAnticipos: boolean): K[] {
  return conAnticipos ? [...orden] : orden.filter((k) => !COLUMNAS_ANTICIPO.includes(k));
}

/** «—» si la OV no tiene anticipos (null); el importe si los tiene, aunque ya esté aplicado (0). */
export function celdaAnticipo(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : formatCOP(v);
}

const MOTIVOS: Record<Exclude<MotivoAtencion, 'sin_aplicar_ov_cerrada'>, string> = {
  sin_referencia: 'La descripción no nombra ninguna OV',
  varias_ov: 'Nombra varias OV: no se puede repartir el importe',
  ov_inexistente: 'La OV nombrada no existe en Zoho',
  moneda_distinta: 'El anticipo y la OV van en monedas distintas',
};

/** El motivo de atención en lenguaje llano. */
export function motivoLegible(a: Pick<AnticipoAtencion, 'motivo' | 'estadoOV'>): string {
  if (a.motivo === 'sin_aplicar_ov_cerrada') {
    return a.estadoOV === 'void'
      ? 'OV anulada con anticipo sin aplicar: ¿hay que devolverlo?'
      : 'OV ya facturada con anticipo sin aplicar: posible cobro doble';
  }
  return MOTIVOS[a.motivo];
}

const ESTADOS: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  viewed: 'Visto',
  unpaid: 'Sin pagar',
  partially_paid: 'Pago parcial',
  paid: 'Pagado',
  overdue: 'Vencido',
  void: 'Anulado',
};

/** Estado de un anticipo en español; los desconocidos pasan tal cual. */
export function estadoAnticipo(s: string | null): string {
  if (!s) return '—';
  return ESTADOS[s] ?? s;
}
```

- [ ] **Paso 5: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/contabilidad -- src/ovTabla.test.ts`
Expected: PASS.

- [ ] **Paso 6: Commit.**

```bash
git add apps/contabilidad/src/ovTabla.ts apps/contabilidad/src/ovTabla.test.ts
git commit -m "feat(contabilidad): helpers puros de la tabla de OV para los anticipos"
```

### Tarea D4: Las dos columnas en `OVPendientes.tsx`

La lógica ya está testeada en D3; aquí solo se cablea. Lo comprueba el portón de tipos y la
revisión en el navegador de la Parte F.

**Ficheros:**
- Modificar: `apps/contabilidad/src/OVPendientes.tsx`

- [ ] **Paso 1: Import.** Añadir tras `import ResizeHandle from './ResizeHandle';`:

```tsx
import { compararValores, traeAnticipos, columnasDisponibles, celdaAnticipo } from './ovTabla';
```

- [ ] **Paso 2: Tipo de columna.** Sustituir la línea `kind` de `ColDef`:

```tsx
  kind: 'text' | 'money' | 'estado' | 'indicio' | 'anticipo';
```

- [ ] **Paso 3: Claves.** Sustituir `CLAVES`:

```tsx
// Las de anticipo van AL FINAL a propósito: useColumnPrefs añade las claves nuevas al final
// para quien ya tiene la tabla personalizada, así que en cualquier otra posición un usuario
// nuevo y uno antiguo las verían en sitios distintos.
const CLAVES = [
  'indicio', 'salesorder_number', 'ticket', 'customer_name', 'trato', 'qt', 'date',
  'shipment_date', 'total', 'pending', 'status', 'anticipoCobrado', 'anticipoSinAplicar',
] as const;
```

- [ ] **Paso 4: Definiciones.** Añadir al final del array `COLUMNAS`, tras la de `status`:

```tsx
  { key: 'anticipoCobrado', label: 'ANTICIPO COBRADO ($)', align: 'right', kind: 'anticipo', ancho: 160 },
  { key: 'anticipoSinAplicar', label: 'ANTICIPO SIN APLICAR ($)', align: 'right', kind: 'anticipo', ancho: 180 },
```

- [ ] **Paso 5: Columnas visibles según permiso.** Sustituir el `useMemo` de `visibles`:

```tsx
  // Las columnas de anticipo solo existen si el servidor manda los campos (solo lo hace a
  // quien tiene Contabilidad); para el resto se quitan del orden, del menú y de la tabla.
  const conAnticipos = useMemo(() => traeAnticipos(ordenes), [ordenes]);
  const ordenDisponible = useMemo(() => columnasDisponibles(cols.orden, conAnticipos), [cols.orden, conAnticipos]);

  const visibles = useMemo(
    () => ordenDisponible.map((k) => DEF.get(k)).filter((c): c is ColDef => !!c && cols.esVisible(c.key)),
    [ordenDisponible, cols],
  );
```

- [ ] **Paso 6: Orden.** Sustituir el comparador dentro de `filtradas`:

```tsx
    arr.sort((a, b) => compararValores(a[sort.key], b[sort.key]) * sort.dir);
```

y la función `toggleSort`, para que los importes empiecen de mayor a menor:

```tsx
  const IMPORTES: SortKey[] = ['pending', 'total', 'anticipoCobrado', 'anticipoSinAplicar'];
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: IMPORTES.includes(key) ? -1 : 1 }));
```

- [ ] **Paso 7: Menú de columnas.** En `<ColumnasMenu`, sustituir `orden={cols.orden}` por:

```tsx
                orden={ordenDisponible}
```

- [ ] **Paso 8: Celda.** En el cuerpo de la tabla, añadir justo después de
  `const v = o[c.key as SortKey];`:

```tsx
                      if (c.kind === 'anticipo') {
                        return <td key={c.key} className="truncate px-2 py-1 text-right tabular-nums">{celdaAnticipo(v as number | null | undefined)}</td>;
                      }
```

- [ ] **Paso 9: Portón de tipos.**

Run: `npm run build --workspace=apps/portal`
Expected: `tsc -b` y `vite build` sin errores (el portal compila las fuentes de contabilidad
por sus imports relativos).

- [ ] **Paso 10: Commit.**

```bash
git add apps/contabilidad/src/OVPendientes.tsx
git commit -m "feat(contabilidad): columnas de anticipo cobrado y sin aplicar"
```

### Tarea D5: Bloque «Anticipos» en el modal de la OV

**Ficheros:**
- Modificar: `apps/contabilidad/src/DetalleModal.tsx`

- [ ] **Paso 1: Import.** Añadir tras `import { formatCOP } from './format';`:

```tsx
import { estadoAnticipo } from './ovTabla';
```

- [ ] **Paso 2: Bloque.** Insertar justo antes de `{/* Totales */}`:

```tsx
            {/* Anticipos de la OV. Solo llegan a quien tiene Contabilidad, y el bloque solo
                aparece si hay alguno. */}
            {detalle._tipo === 'ov' && detalle.anticipos && detalle.anticipos.length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs">
                <div className="mb-1.5 font-semibold text-emerald-800">Anticipos</div>
                <table className="min-w-full">
                  <thead className="text-emerald-700">
                    <tr>
                      <th className="py-1 text-left font-medium">Anticipo</th>
                      <th className="py-1 text-left font-medium">Fecha</th>
                      <th className="py-1 text-left font-medium">Estado</th>
                      <th className="py-1 text-right font-medium">Cobrado</th>
                      <th className="py-1 text-right font-medium">Sin aplicar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.anticipos.map((a) => (
                      <tr key={a.numero}>
                        <td className="py-0.5 font-medium">{a.numero}</td>
                        <td className="py-0.5">{a.fecha ?? '—'}</td>
                        <td className="py-0.5">{estadoAnticipo(a.estado)}</td>
                        <td className="py-0.5 text-right tabular-nums">{formatCOP(a.cobrado)}</td>
                        <td className="py-0.5 text-right tabular-nums">{formatCOP(a.sinAplicar)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

```

- [ ] **Paso 3: Portón de tipos.**

Run: `npm run build --workspace=apps/portal`
Expected: sin errores.

- [ ] **Paso 4: Commit.**

```bash
git add apps/contabilidad/src/DetalleModal.tsx
git commit -m "feat(contabilidad): anticipos en el detalle de la OV"
```

### Tarea D6: El aviso de atención

**Ficheros:**
- Crear: `apps/contabilidad/src/AnticiposAtencion.tsx`
- Test: `apps/contabilidad/src/AnticiposAtencion.test.tsx`
- Modificar: `apps/contabilidad/src/App.tsx`

- [ ] **Paso 1: Escribir el test.** Crear `AnticiposAtencion.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnticiposAtencion from './AnticiposAtencion';
import { fetchAnticiposAtencion, type AnticipoAtencion } from './api';

vi.mock('./api', () => ({ fetchAnticiposAtencion: vi.fn() }));
const mockFetch = fetchAnticiposAtencion as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const aviso = (over: Partial<AnticipoAtencion>): AnticipoAtencion => ({
  numero: 'ANT-2026-050', cliente: 'Secolab S.A.S.', fecha: '2026-07-10', cobrado: 1338645,
  sinAplicar: 1338645, motivo: 'sin_referencia', ov: null, estadoOV: null,
  texto: 'Anticipo 50% del pedido', ...over,
});

describe('AnticiposAtencion', () => {
  it('muestra el recuento plegado y la tabla al desplegar', async () => {
    mockFetch.mockResolvedValue([
      aviso({}),
      aviso({ numero: 'ANT-2026-051', motivo: 'varias_ov', ov: 'OV-2026-150, OV-2026-151', texto: 'Anticipo OV-2026-150 y OV-2026-151' }),
    ]);
    render(<AnticiposAtencion />);
    const boton = await screen.findByRole('button', { name: /2 anticipos requieren atención/ });
    expect(screen.queryByText('ANT-2026-050')).toBeNull();
    fireEvent.click(boton);
    expect(screen.getByText('ANT-2026-050')).toBeInTheDocument();
    expect(screen.getByText('Anticipo 50% del pedido')).toBeInTheDocument();
    expect(screen.getByText(/no nombra ninguna OV/)).toBeInTheDocument();
  });

  it('con un solo anticipo habla en singular', async () => {
    mockFetch.mockResolvedValue([aviso({})]);
    render(<AnticiposAtencion />);
    expect(await screen.findByRole('button', { name: /1 anticipo requiere atención/ })).toBeInTheDocument();
  });

  // Guardas: el aviso no puede estorbar a la tabla de OV que tiene debajo.
  it('con la lista vacía no pinta nada', async () => {
    mockFetch.mockResolvedValue([]);
    const { container } = render(<AnticiposAtencion />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('si la petición falla no pinta nada', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<AnticiposAtencion />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Paso 2: Crear un componente vacío**, para que el fallo sea de aserción. Crear
  `AnticiposAtencion.tsx`:

```tsx
export default function AnticiposAtencion() {
  return null;
}
```

- [ ] **Paso 3: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/contabilidad -- src/AnticiposAtencion.test.tsx`
Expected: FAIL en «muestra el recuento…» y «habla en singular» (no hay botón). Los dos
guardas pasan ya con el componente vacío; morderán en cuanto el componente pinte algo.

- [ ] **Paso 4: Implementar.** Sustituir `AnticiposAtencion.tsx` entero por:

```tsx
import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchAnticiposAtencion, type AnticipoAtencion } from './api';
import { formatCOP } from './format';
import { motivoLegible } from './ovTabla';

/**
 * Aviso de anticipos que requieren atención: los que no se pudieron enlazar con una OV y los
 * que tienen saldo sin aplicar en una OV ya cerrada. Solo se monta en Contabilidad.
 *
 * Nunca estorba: con la lista vacía no pinta nada, y si su petición falla tampoco. La tabla de
 * OV que tiene debajo tiene que seguir funcionando pase lo que pase aquí.
 */
export default function AnticiposAtencion() {
  const [lista, setLista] = useState<AnticipoAtencion[]>([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetchAnticiposAtencion()
      .then((l) => { if (vivo) setLista(l); })
      .catch((e: Error) => console.error('anticipos-atencion:', e.message));
    return () => { vivo = false; };
  }, []);

  if (lista.length === 0) return null;

  const titulo = lista.length === 1 ? '1 anticipo requiere atención' : `${lista.length} anticipos requieren atención`;

  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 text-sm">
      <button
        type="button"
        onClick={() => setAbierto((x) => !x)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-amber-800"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {titulo}
        {abierto ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
      </button>
      {abierto && (
        <div className="overflow-x-auto border-t border-amber-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">ANTICIPO</th>
                <th className="px-2 py-1.5 text-left font-semibold">CLIENTE</th>
                <th className="px-2 py-1.5 text-left font-semibold">FECHA</th>
                <th className="px-2 py-1.5 text-right font-semibold">COBRADO</th>
                <th className="px-2 py-1.5 text-right font-semibold">SIN APLICAR</th>
                <th className="px-2 py-1.5 text-left font-semibold">MOTIVO</th>
                <th className="px-2 py-1.5 text-left font-semibold">DESCRIPCIÓN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((a) => (
                <tr key={a.numero}>
                  <td className="whitespace-nowrap px-2 py-1 font-medium">{a.numero}</td>
                  <td className="px-2 py-1">{a.cliente ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1">{a.fecha ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatCOP(a.cobrado)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatCOP(a.sinAplicar)}</td>
                  <td className="px-2 py-1">{motivoLegible(a)}{a.ov ? ` (${a.ov})` : ''}</td>
                  {/* El texto tal cual se escribió: así el error se ve sin entrar a Zoho. */}
                  <td className="px-2 py-1 text-gray-500" title={a.texto}>{a.texto || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Paso 5: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/contabilidad`
Expected: PASS, todos los tests de la app.

- [ ] **Paso 6: Montarlo en la pestaña de OV.** En `App.tsx`, añadir tras
  `import OVPendientes from './OVPendientes';`:

```tsx
import AnticiposAtencion from './AnticiposAtencion';
```

y sustituir el bloque de la pestaña de OV:

```tsx
      {/* `bare`: la cabecera propia de la sección sobra, ya la da la pestaña. El aviso de
          anticipos va solo aquí: ni la app ov-pendientes ni el widget lo montan. */}
      <div className={tab === 'ov' ? '' : 'hidden'}>
        <AnticiposAtencion />
        <OVPendientes bare />
      </div>
```

- [ ] **Paso 7: Portón de tipos.**

Run: `npm run build --workspace=apps/portal`
Expected: sin errores.

- [ ] **Paso 8: Commit.**

```bash
git add apps/contabilidad/src/AnticiposAtencion.tsx apps/contabilidad/src/AnticiposAtencion.test.tsx apps/contabilidad/src/App.tsx
git commit -m "feat(contabilidad): aviso de anticipos que requieren atención"
```

---

## Parte E — Especificación

### Tarea E1: Recoger las desviaciones en la especificación

**Ficheros:**
- Modificar: `docs/superpowers/specs/2026-09-21-anticipos-ov-design.md`

- [ ] **Paso 1:** En «3. Portal», sustituir el párrafo que empieza por «**Columnas.**» por:

```md
**Columnas.** Dos entradas nuevas en la configuración de columnas de
`OVPendientes.tsx`, **al final, después de «ESTADO»**: «ANTICIPO COBRADO ($)» y
«ANTICIPO SIN APLICAR ($)». Visibles por defecto, ocultables, ordenables y
redimensionables como las demás. Van al final porque `useColumnPrefs` añade las claves
nuevas al final para quien ya tiene la tabla personalizada: en cualquier otra posición, un
usuario nuevo y uno antiguo las verían en sitios distintos, y a todos los antiguos se les
marcaría la tabla como personalizada.
```

- [ ] **Paso 2:** En «Endpoints», añadir tras la tabla:

```md
«Tiene Contabilidad» significa ser `admin` o tener la app asignada: la misma regla de
`requireApp`, que ya deja pasar a los admin. Un admin ve los anticipos aunque no tenga la app.
```

- [ ] **Paso 3:** En la tabla de `extraerOV`, añadir tras la fila de `Anticipo OV-2026-0167`:

```md
| `Anticipo OV–2026–167` | `[OV-2026-167]` — raya o guion largo, como sale al copiar de Word |
```

- [ ] **Paso 4:** En «4. Tests», añadir al final de la sección:

```md
`apps/contabilidad` no tenía tests: estrena vitest con jsdom, React Testing Library y el
arreglo de `localStorage` para Node 22+ (el mismo del portal).
```
- [ ] **Paso 5: Commit.**

```bash
git add docs/superpowers/specs/2026-09-21-anticipos-ov-design.md
git commit -m "docs(contabilidad): la especificación de anticipos recoge lo decidido al planificar"
```

---

## Parte F — Portones finales y despliegue del portal

**Requisito: la Parte B superada.**

- [ ] **Paso 1: Portones.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad`
Expected: PASS.

Run: `npm run build --workspace=apps/hub-api`
Expected: sin errores.

Run: `npm run test --workspace=apps/contabilidad`
Expected: PASS.

Run: `npm run build --workspace=apps/portal`
Expected: sin errores.

La suite completa de hub-api (`npm test --workspace=apps/hub-api`) tarda unos 33 minutos. Si
se lanza, el test `users.service.test.ts > 4.4` puede agotar su timeout por carga: es un fallo
conocido y ajeno, que pasa aislado en ~41 s.

- [ ] **Paso 2: Empujar este repo** (autorización permanente; empujar es desplegar).

```bash
git push origin main
```

- [ ] **Paso 3: El usuario redespliega en EasyPanel, en este orden: hub-api, después portal.**

- [ ] **Paso 4: Comprobación en producción:**
  1. Contabilidad → pestaña de OV: aparecen «ANTICIPO COBRADO ($)» y «ANTICIPO SIN APLICAR
     ($)» al final. Si OV-2026-167 sigue pendiente, muestra 9.505.784 cobrados.
  2. Clic en esa OV: el modal enseña el bloque «Anticipos» con ANT-2026-063.
  3. Encima de la tabla, el aviso «N anticipos requieren atención», si hay alguno.
     Desplegarlo y contrastar uno con Zoho.
  4. **Con un usuario que solo tenga la app `ov-pendientes`** (un admin no sirve: ve los
     anticipos a propósito): sin columnas de anticipo, y en DevTools → Red, la respuesta de
     `/api/contabilidad/ov-pendientes` no contiene `anticipoCobrado`.
