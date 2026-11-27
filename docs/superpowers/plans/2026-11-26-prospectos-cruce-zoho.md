# Cruce de los prospectos con Zoho — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** añadir a la vista «Prospectos de grasas y aceites» una columna «Cliente» que cruza cada laboratorio con Zoho Books por NIT (estado comercial, última factura, OCMA vendido y últimos repuestos de OCMA), con su filtro y sus columnas en el Excel.

**Architecture:** hub-api expone `POST /api/laboratorios/clientes` (`requireAuth` + `requireApp('laboratorios-ambientales')`). Calcula el cruce completo desde la réplica `zoho-hub` con una consulta, lo agrega por NIT base en una función pura, lo guarda con `cached` y responde solo con los NIT pedidos, con tres fechas y nada más. La app de Laboratorios pide en una sola llamada los NIT de sus 90 prospectos. Deduce el estado con funciones puras en `src/lib/clientes.ts` y lo pinta con `CeldaCliente`. Si hub-api falla, la vista sigue igual con un aviso y «Reintentar».

**Tech Stack:**
- hub-api: Express + TypeScript (NodeNext, imports con `.js`), Vitest + supertest, `@algarpibe/zoho-sync` (`Pool`).
- App: React 19 + TypeScript 5.9 (Vite), Vitest 2 en entorno `node` (sin jsdom), ESLint 9 con `react-hooks` 7, `@suite/auth-client` (workspace).

---

**Diseño aprobado:** `docs/superpowers/specs/2026-11-26-prospectos-cruce-zoho-design.md`. Léelo entero antes de empezar: es el contrato.

## Convenciones de ejecución (obligatorias)

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07` (en Git Bash: `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`). Todos los comandos parten de ahí. Si tu shell no conserva el directorio entre llamadas, empieza cada una con `cd /c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07 &&`.
- **Rama:** `feat/laboratorios-cruce-zoho`. Ya existe y lleva el commit del diseño (`50de0d0`). Se trabaja en ella. **Este plan no hace push ni merge**: los hace el orquestador.
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write y Edit.
  - Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero.
  - Nunca hagas sustituciones de un carácter en todo un fichero.
  - Todos los ficheros que se tocan son LF.
  - Cada «sustituir» de este plan cita un texto que aparece una sola vez en su fichero. Si alguno no casa, lee ese tramo con Read y copia el texto de ahí.
- **Git:**
  - Con la herramienta **Bash (Git Bash)**, desde la raíz.
  - Mensajes con `git commit -F - <<'EOF' … EOF`: conventional commits en español, **sin línea «Co-Authored-By» ni ninguna atribución**.
  - Se añaden rutas explícitas. Nunca `git add -A` ni `git add .`; nunca `git stash`.
  - No se tocan `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/`: son del usuario.
- **Repo público:** NIT, nombres y fechas de las pruebas son **ficticios** (`900000001`, `@example.com`…). Nunca un cliente real.
- **TDD estricto** en hub-api (`src/laboratorios/`) y en `src/lib/` y `src/services/` de la app: prueba que falla, verla fallar, código mínimo, verla pasar, commit. `Prospectos.tsx` y `CeldaCliente.tsx` no tienen pruebas (no hay jsdom): se comprueban con lint, `tsc -b` y el `tsc -b` del portal.
- **Pruebas de hub-api:**
  - Una sola: `cd apps/hub-api && npx vitest run src/laboratorios/<fichero>.test.ts`.
  - La suite: `cd apps/hub-api && npm test`.
  - **Nunca** lances vitest de hub-api desde la raíz: mete los `.db.test.ts` y salen ~281 fallos falsos.
  - Tipos: `cd apps/hub-api && npx tsc -b`.
- **Pruebas de la app:**
  - Una sola: `cd apps/laboratorios-ambientales && npx vitest run src/lib/<fichero>.test.ts`.
  - La suite: `cd apps/laboratorios-ambientales && npm test`. Punto de partida: **10 ficheros, 172 pruebas, en verde** (comprobado el 2026-11-26).
- **`tsc -b` de la app también compila las pruebas** (`noUnusedLocals`): un import que sobra en un `.test.ts` rompe el build.
- **`auth.ts` lee `JWT_SECRET` al cargarse.** En las pruebas del router, el env se fija antes de importarlo y el router se importa de forma dinámica en `beforeAll` (Tarea 2 lo trae escrito).

## Decisiones tomadas en el plan

| # | Silencio o choque del diseño | Opción del plan |
|---|---|---|
| 1 | El diseño no fija el orden de las columnas nuevas del Excel. | Van al final, después de «Correo». Así no se mueven los índices que ya prueban los tests. |
| 2 | Una lista `nits` vacía. | Es válida: 200 con `clientes: []`. La app ni siquiera llama si no hay NIT. |
| 3 | NIT repetidos en la petición. | Se deduplican: cada NIT sale una vez en la respuesta. |
| 4 | El aviso «Consultando…» en una región `aria-live`. | Una sola región: la línea del recuento ya es `aria-live="polite"` y lleva «· Consultando Zoho…» mientras carga. Las celdas dicen «Consultando…» sin `aria-live` (serían 90 avisos). |
| 5 | `EstadoCruce` (`cargando`, `listo`, `error`). | Vive en `src/lib/clientes.ts`, no en el componente: `react-refresh` pide que los ficheros de componentes solo exporten componentes. |
| 6 | Fechas de la réplica. | Salen con `to_char(…, 'YYYY-MM-DD')`, valga `date` o `timestamp` la columna. |
| 7 | El aviso ámbar «Qué dice y qué no dice esta vista». | Se añade una frase: «OCMA vendido» solo cuenta lo que facturó Ambientalia. |
| 8 | Tipo de contacto. | `c.raw ->> 'contact_type' = 'customer'`. **Depende de la verificación previa:** si `books.contacts` no tiene `raw`, el orquestador cambia esa línea antes de la Tarea 1 (ver «Paso previo»). |
| 9 | Barrido de NIT a ciegas (encontrado en la revisión de la Tarea 2, 2026-11-27). | El usuario eligió la opción A: límite por usuario de 5 peticiones por minuto detrás de `requireApp`, `MAX_NITS` = 150, la validación dentro del `try` y el texto honesto. El código de la Tarea 2 de abajo es el original; lo que está en la rama es el del commit `fix(hub-api): límite por usuario…`. |

## Paso previo (orquestador, con el usuario): verificación contra la réplica

Antes de la Tarea 1, el usuario ejecuta en su `psql` del servidor (ver la memoria `sql-verification-command-format`):

```sql
\c zoho-hub
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'books' AND table_name = 'contacts' ORDER BY ordinal_position;
SELECT category_name, count(*) FROM books.items WHERE category_name ILIKE '%ocma%' GROUP BY 1 ORDER BY 1;
SELECT raw ->> 'contact_type' AS tipo, count(*) FROM books.contacts GROUP BY 1 ORDER BY 1;
SELECT status, count(*) FROM books.invoices GROUP BY 1 ORDER BY 1;
SELECT count(*) FILTER (WHERE nit ~ '^[0-9]{10}$') AS diez_digitos_sin_guion,
       count(*) FILTER (WHERE nit LIKE '%-%')      AS con_guion,
       count(*) FILTER (WHERE nit <> '')           AS con_nit
  FROM books.contacts;
SELECT data_type FROM information_schema.columns
 WHERE table_schema = 'books' AND table_name = 'invoices' AND column_name = 'date';
SELECT count(DISTINCT c.contact_id) AS con_facturas_y_no_cliente
  FROM books.contacts c
  JOIN books.invoices i ON i.customer_id = c.contact_id AND i.status NOT IN ('void', 'draft')
 WHERE c.raw ->> 'contact_type' IS DISTINCT FROM 'customer';
```

- La penúltima dice si `invoices.date` es `date` o `timestamptz`. Con `timestamptz`, el `to_char` depende de la zona horaria de la sesión: se cambia por `MAX(i.date)::date`.
- La última cuenta los contactos con facturas que ya no son de tipo cliente. Si salen más de 0, el filtro de tipo pasa a ser «cliente, o con alguna factura que cuente»: `HAVING bool_or(c.raw ->> 'contact_type' = 'customer') OR MAX(i.date) IS NOT NULL`, en lugar de la condición del `WHERE`.

Qué cambia según la respuesta:
- **No existe `raw` en `books.contacts`** (la tercera consulta falla): si hay una columna `contact_type`, la línea del filtro de la Tarea 1 pasa a `AND c.contact_type = 'customer'`. Si no hay ninguna de las dos, se quita la línea y se anota en el README que los proveedores con NIT cuentan como «En Zoho sin compras».
- **Las categorías no se escriben** «OCMA-500 Series» y «C&R OCMA-500»: se corrigen `CATEGORIA_OCMA` y `CATEGORIA_REPUESTOS_OCMA` en la Tarea 1 y en el diseño.
- **Los estados de factura** no incluyen `void`/`draft` con esa grafía: se ajusta el `NOT IN`.
- **`diez_digitos_sin_guion` > 0:** se anota en el README. Es lo que el diseño deja fuera de alcance.

## Mapa de ficheros

| Fichero | Tarea | Responsabilidad |
|---|---|---|
| `apps/hub-api/src/laboratorios/clientes.ts` (nuevo) | 1 | `nitBase`, `agruparPorNit`, `leerHechosZoho` y la consulta. |
| `apps/hub-api/src/laboratorios/clientes.test.ts` (nuevo) | 1 | Pruebas de lo anterior con un pool falso. |
| `apps/hub-api/src/laboratorios/router.ts` (nuevo) | 2 | `leerNits` y `createLaboratoriosRouter` con la ruta. |
| `apps/hub-api/src/laboratorios/router.test.ts` (nuevo) | 2 | Auth, validación, filtro, caché y 500. |
| `apps/hub-api/src/index.ts` | 2 | Monta el router. |
| `apps/laboratorios-ambientales/src/lib/clientes.ts` (nuevo) | 3 | Tipos y reglas puras del estado del cliente. |
| `apps/laboratorios-ambientales/src/lib/clientes.test.ts` (nuevo) | 3 | Sus pruebas. |
| `apps/laboratorios-ambientales/src/services/clientesZoho.ts` (nuevo) | 4 | `fetchClientesZoho`. |
| `apps/laboratorios-ambientales/src/services/clientesZoho.test.ts` (nuevo) | 4 | Sus pruebas con `fetch` simulado. |
| `apps/laboratorios-ambientales/package.json` + `package-lock.json` | 4 | Dependencia `@suite/auth-client`. |
| `apps/laboratorios-ambientales/src/lib/exportProspects.ts` (+ test) | 5 | Cuatro columnas nuevas. |
| `apps/laboratorios-ambientales/src/components/CeldaCliente.tsx` (nuevo) | 6 | La celda. |
| `apps/laboratorios-ambientales/src/pages/Prospectos.tsx` | 6 | Consulta, columna, filtro, aviso, Excel. |
| `apps/laboratorios-ambientales/README.md`, `docs/PRIVACY-RETENTION.md` | 7 | Documentación. |

---

### Task 1: hub-api — hechos de Zoho por NIT

**Files:**
- Create: `apps/hub-api/src/laboratorios/clientes.ts`
- Test: `apps/hub-api/src/laboratorios/clientes.test.ts`

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `apps/hub-api/src/laboratorios/clientes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  CATEGORIA_OCMA,
  CATEGORIA_REPUESTOS_OCMA,
  agruparPorNit,
  leerHechosZoho,
  nitBase,
  type FilaContacto,
} from './clientes.js';

// NIT y fechas ficticios: el repo es público.
const fila = (over: Partial<FilaContacto> = {}): FilaContacto => ({
  nit: '900000001',
  ultima_factura: null,
  ocma_vendido: null,
  ultimos_repuestos: null,
  ...over,
});

describe('nitBase', () => {
  it('quita puntos y el dígito de verificación', () => {
    expect(nitBase('900.000.001-7')).toBe('900000001');
  });

  it('deja igual un NIT que ya viene solo con dígitos', () => {
    expect(nitBase('900000001')).toBe('900000001');
  });

  it('quita espacios', () => {
    expect(nitBase(' 900 000 001 ')).toBe('900000001');
  });

  it('ignora los de relleno (menos de 6 dígitos) y los de más de 10', () => {
    expect(nitBase('0')).toBeNull();
    expect(nitBase('12345')).toBeNull();
    expect(nitBase('12345678901')).toBeNull();
  });

  it('acepta los bordes de 6 y 10 dígitos', () => {
    expect(nitBase('123456')).toBe('123456');
    expect(nitBase('1234567890')).toBe('1234567890');
  });

  it('null, vacío o sin dígitos dan null', () => {
    expect(nitBase(null)).toBeNull();
    expect(nitBase('')).toBeNull();
    expect(nitBase('N/A')).toBeNull();
  });
});

describe('agruparPorNit', () => {
  it('un contacto da sus tres fechas', () => {
    const mapa = agruparPorNit([
      fila({ ultima_factura: '2026-03-10', ocma_vendido: '2024-05-02', ultimos_repuestos: '2026-01-15' }),
    ]);
    expect(mapa.get('900000001')).toEqual({
      ultimaFactura: '2026-03-10',
      ocmaVendido: '2024-05-02',
      ultimosRepuestos: '2026-01-15',
    });
  });

  it('dos contactos con el mismo NIT base se quedan con la fecha más reciente de cada tipo', () => {
    const mapa = agruparPorNit([
      fila({ nit: '900000001', ultima_factura: '2025-01-01', ocma_vendido: '2024-05-02', ultimos_repuestos: null }),
      fila({ nit: '900.000.001-7', ultima_factura: '2026-03-10', ocma_vendido: null, ultimos_repuestos: '2025-08-20' }),
    ]);
    expect(mapa.size).toBe(1);
    expect(mapa.get('900000001')).toEqual({
      ultimaFactura: '2026-03-10',
      ocmaVendido: '2024-05-02',
      ultimosRepuestos: '2025-08-20',
    });
  });

  it('un contacto sin facturas está en el mapa con las tres fechas a null', () => {
    expect(agruparPorNit([fila()]).get('900000001')).toEqual({
      ultimaFactura: null,
      ocmaVendido: null,
      ultimosRepuestos: null,
    });
  });

  it('los NIT de relleno o vacíos no aparecen', () => {
    const mapa = agruparPorNit([fila({ nit: '0', ultima_factura: '2026-01-01' }), fila({ nit: null })]);
    expect(mapa.size).toBe(0);
  });
});

describe('leerHechosZoho', () => {
  it('consulta la réplica con las dos categorías como parámetros y agrega las filas', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [fila({ nit: '900.000.001-7', ultima_factura: '2026-03-10' })],
    });
    const mapa = await leerHechosZoho({ query } as unknown as Pool);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('books.contacts');
    expect(params).toEqual([CATEGORIA_OCMA, CATEGORIA_REPUESTOS_OCMA]);
    expect(mapa.get('900000001')?.ultimaFactura).toBe('2026-03-10');
  });

  it('las categorías son las de Zoho', () => {
    expect(CATEGORIA_OCMA).toBe('OCMA-500 Series');
    expect(CATEGORIA_REPUESTOS_OCMA).toBe('C&R OCMA-500');
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que falla**

Run: `cd apps/hub-api && npx vitest run src/laboratorios/clientes.test.ts`
Expected: FAIL, porque no se encuentra el módulo `./clientes.js`.

- [ ] **Step 3: Escribe la implementación mínima**

Crea `apps/hub-api/src/laboratorios/clientes.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';

/**
 * Hechos de Zoho que la app de Laboratorios ambientales necesita de cada NIT:
 * solo fechas. Nunca importes, nombres ni identificadores de Zoho (ver
 * docs/superpowers/specs/2026-11-26-prospectos-cruce-zoho-design.md).
 */
export interface HechosZoho {
  ultimaFactura: string | null;
  ocmaVendido: string | null;
  ultimosRepuestos: string | null;
}

/** Una fila de HECHOS_SQL: un contacto cliente con su NIT tal cual y sus tres fechas. */
export interface FilaContacto {
  nit: string | null;
  ultima_factura: string | null;
  ocma_vendido: string | null;
  ultimos_repuestos: string | null;
}

// Categorías de artículo de Zoho Books: el equipo y sus repuestos y consumibles.
export const CATEGORIA_OCMA = 'OCMA-500 Series';
export const CATEGORIA_REPUESTOS_OCMA = 'C&R OCMA-500';

const NIT_MIN_DIGITOS = 6;
const NIT_MAX_DIGITOS = 10;

/**
 * NIT base: lo que hay antes del primer «-», solo dígitos. `900.000.001-7` da
 * `900000001`. Menos de 6 dígitos es relleno (hay contactos con «0») y más de
 * 10 no es un NIT: los dos dan null.
 */
export function nitBase(nit: string | null | undefined): string | null {
  if (!nit) return null;
  const digitos = nit.split('-')[0].replace(/\D/g, '');
  return digitos.length >= NIT_MIN_DIGITOS && digitos.length <= NIT_MAX_DIGITOS ? digitos : null;
}

// Las fechas son AAAA-MM-DD: comparar como texto es comparar como fecha.
function masReciente(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/**
 * Una entrada por NIT base. Varios contactos con el mismo NIT (pasa en Zoho) se
 * suman: de cada tipo de fecha se queda la más reciente.
 */
export function agruparPorNit(filas: FilaContacto[]): Map<string, HechosZoho> {
  const mapa = new Map<string, HechosZoho>();
  for (const fila of filas) {
    const nit = nitBase(fila.nit);
    if (nit === null) continue;
    const previo = mapa.get(nit);
    mapa.set(nit, {
      ultimaFactura: masReciente(previo?.ultimaFactura ?? null, fila.ultima_factura),
      ocmaVendido: masReciente(previo?.ocmaVendido ?? null, fila.ocma_vendido),
      ultimosRepuestos: masReciente(previo?.ultimosRepuestos ?? null, fila.ultimos_repuestos),
    });
  }
  return mapa;
}

// Una fila por contacto CLIENTE con NIT. Las facturas anuladas y los borradores
// no cuentan, como en customerValuation.ts. `lineas` marca, por factura, si lleva
// algún artículo de cada categoría; to_char da AAAA-MM-DD sea la columna date o
// timestamp. $1 = CATEGORIA_OCMA, $2 = CATEGORIA_REPUESTOS_OCMA.
const HECHOS_SQL = `
  WITH lineas AS (
    SELECT li.invoice_id,
           bool_or(it.category_name = $1) AS con_ocma,
           bool_or(it.category_name = $2) AS con_repuestos
      FROM books.invoice_line_items li
      JOIN books.items it ON it.item_id = li.item_id
     WHERE it.category_name IN ($1, $2)
     GROUP BY li.invoice_id
  )
  SELECT c.nit,
         to_char(MAX(i.date), 'YYYY-MM-DD')                              AS ultima_factura,
         to_char(MAX(i.date) FILTER (WHERE l.con_ocma), 'YYYY-MM-DD')      AS ocma_vendido,
         to_char(MAX(i.date) FILTER (WHERE l.con_repuestos), 'YYYY-MM-DD') AS ultimos_repuestos
    FROM books.contacts c
    LEFT JOIN books.invoices i
           ON i.customer_id = c.contact_id
          AND i.status NOT IN ('void', 'draft')
    LEFT JOIN lineas l ON l.invoice_id = i.invoice_id
   WHERE c.nit IS NOT NULL AND c.nit <> ''
     AND c.raw ->> 'contact_type' = 'customer'
   GROUP BY c.contact_id, c.nit`;

/** El cruce completo de la réplica, por NIT base. */
export async function leerHechosZoho(db: Pool): Promise<Map<string, HechosZoho>> {
  const { rows } = await db.query(HECHOS_SQL, [CATEGORIA_OCMA, CATEGORIA_REPUESTOS_OCMA]);
  return agruparPorNit(rows as FilaContacto[]);
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasa**

Run: `cd apps/hub-api && npx vitest run src/laboratorios/clientes.test.ts`
Expected: PASS, 12 pruebas.

Run: `cd apps/hub-api && npx tsc -b`
Expected: sin errores. Si `db.query` no acepta un segundo argumento con ese tipo, mira cómo lo llama `src/contabilidad/detalle.ts` y copia la forma.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/laboratorios/clientes.ts apps/hub-api/src/laboratorios/clientes.test.ts
git commit -F - <<'EOF'
feat(hub-api): hechos de Zoho por NIT para la app de Laboratorios

Una consulta a la réplica da, por contacto cliente con NIT, la última factura,
la última con un OCMA-500 y la última con repuestos o consumibles de OCMA.
agruparPorNit las junta por NIT base (sin puntos ni dígito de verificación)
y descarta los NIT de relleno.
EOF
```

---

### Task 2: hub-api — ruta `POST /api/laboratorios/clientes`

**Files:**
- Create: `apps/hub-api/src/laboratorios/router.ts`
- Test: `apps/hub-api/src/laboratorios/router.test.ts`
- Modify: `apps/hub-api/src/index.ts` (import en la línea 18 y montaje en la línea 162)

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `apps/hub-api/src/laboratorios/router.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';
import { clearCache } from '../cache.js';

// auth.ts captura JWT_SECRET al cargarse: el env va antes de importarlo y el
// router se importa de forma dinámica en beforeAll. Mismo patrón que
// contabilidad/router.test.ts.
const SECRET = 'test-secret-laboratorios';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// requireAuth consulta la fila del usuario en cada petición (SEC-224) y pisa
// role/apps del token con los de la fila: el mock y token() dicen lo mismo.
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

let createLaboratoriosRouter: typeof import('./router.js')['createLaboratoriosRouter'];
let MAX_NITS: number;
beforeAll(async () => {
  ({ createLaboratoriosRouter, MAX_NITS } = await import('./router.js'));
});

// La caché es del módulo: sin esto, una prueba vería el resultado de la anterior.
beforeEach(() => clearCache());

const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function token(apps: string[], role = 'reader'): string {
  estadoAuth.role = role;
  estadoAuth.apps = apps;
  return jwt.sign({ sub: 'u@t.co', user_id: USER_ID, role, apps, token_version: 0 }, SECRET);
}

// NIT y fechas ficticios: el repo es público.
const FILAS = [
  { nit: '900000001', ultima_factura: '2026-03-10', ocma_vendido: '2024-05-02', ultimos_repuestos: null },
  { nit: '900.000.002-5', ultima_factura: null, ocma_vendido: null, ultimos_repuestos: null },
];

function poolFalso(filas: unknown[] = FILAS) {
  return { query: vi.fn().mockResolvedValue({ rows: filas }) };
}

function appCon(pool: { query: unknown }): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createLaboratoriosRouter(pool as unknown as Pool));
  return app;
}

const RUTA = '/api/laboratorios/clientes';
const CON_APP = () => `Bearer ${token(['laboratorios-ambientales'])}`;

describe('POST /api/laboratorios/clientes — acceso', () => {
  it('401 sin token', async () => {
    const res = await request(appCon(poolFalso())).post(RUTA).send({ nits: ['900000001'] });
    expect(res.status).toBe(401);
  });

  it('403 si el usuario no tiene la app de Laboratorios', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', `Bearer ${token(['contabilidad'])}`)
      .send({ nits: ['900000001'] });
    expect(res.status).toBe(403);
  });

  it('un admin sin la app asignada entra', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', `Bearer ${token([], 'admin')}`)
      .send({ nits: ['900000001'] });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/laboratorios/clientes — cuerpo', () => {
  it.each([
    ['sin cuerpo', undefined],
    ['nits que no es una lista', { nits: '900000001' }],
    ['un NIT que no es texto', { nits: [900000001] }],
    ['un NIT de relleno', { nits: ['0'] }],
    ['un NIT de más de 10 dígitos', { nits: ['12345678901'] }],
  ])('400 con %s', async (_caso, cuerpo) => {
    const pool = poolFalso();
    const peticion = request(appCon(pool)).post(RUTA).set('Authorization', CON_APP());
    const res = await (cuerpo === undefined ? peticion : peticion.send(cuerpo));
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('400 con 501 NIT', async () => {
    const nits = Array.from({ length: MAX_NITS + 1 }, (_, i) => String(900000000 + i));
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits });
    expect(res.status).toBe(400);
  });

  it('acepta exactamente 500 NIT', async () => {
    const nits = Array.from({ length: MAX_NITS }, (_, i) => String(900000000 + i));
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits });
    expect(res.status).toBe(200);
  });

  it('una lista vacía da 200 con clientes vacío', async () => {
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clientes: [] });
  });
});

describe('POST /api/laboratorios/clientes — respuesta', () => {
  it('devuelve solo los NIT pedidos que están en Zoho, en NIT base', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', CON_APP())
      .send({ nits: ['900.000.001-7', '800000009'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      clientes: [{ nit: '900000001', ultimaFactura: '2026-03-10', ocmaVendido: '2024-05-02', ultimosRepuestos: null }],
    });
  });

  it('cada cliente lleva exactamente cuatro campos: nada de importes ni nombres', async () => {
    const filaConDeMas = { ...FILAS[0], total: 123, customer_name: 'Cliente Ficticio' };
    const res = await request(appCon(poolFalso([filaConDeMas])))
      .post(RUTA)
      .set('Authorization', CON_APP())
      .send({ nits: ['900000001'] });
    expect(Object.keys(res.body.clientes[0]).sort()).toEqual(['nit', 'ocmaVendido', 'ultimaFactura', 'ultimosRepuestos']);
  });

  it('un NIT en Zoho sin facturas sale con las tres fechas a null', async () => {
    const res = await request(appCon(poolFalso())).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000002'] });
    expect(res.body.clientes).toEqual([
      { nit: '900000002', ultimaFactura: null, ocmaVendido: null, ultimosRepuestos: null },
    ]);
  });

  it('un NIT pedido dos veces, con y sin formato, sale una vez', async () => {
    const res = await request(appCon(poolFalso()))
      .post(RUTA)
      .set('Authorization', CON_APP())
      .send({ nits: ['900000001', '900.000.001-7'] });
    expect(res.body.clientes).toHaveLength(1);
  });

  it('la segunda petición sale de la caché y no vuelve a consultar la réplica', async () => {
    const pool = poolFalso();
    const app = appCon(pool);
    await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    await request(app).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000002'] });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('500 sin detalle si falla la réplica', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('conexión rota')) };
    const res = await request(appCon(pool)).post(RUTA).set('Authorization', CON_APP()).send({ nits: ['900000001'] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que falla**

Run: `cd apps/hub-api && npx vitest run src/laboratorios/router.test.ts`
Expected: FAIL, porque no se encuentra el módulo `./router.js`.

- [ ] **Step 3: Escribe la implementación mínima**

Crea `apps/hub-api/src/laboratorios/router.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import type { Pool } from '@algarpibe/zoho-sync';
import { requireAuth, requireApp } from '../auth.js';
import { captureError } from '../sentry.js';
import { cached } from '../cache.js';
import { leerHechosZoho, nitBase, type HechosZoho } from './clientes.js';

const APP_ID = 'laboratorios-ambientales';
const CACHE_KEY = 'laboratorios:clientes';

/** Tope de NIT por petición. La app envía unos 85. */
export const MAX_NITS = 500;

export interface ClienteZoho extends HechosZoho {
  nit: string;
}

function sendError(res: Response, e: unknown, ctx: string): void {
  console.error(`${ctx} error`, e);
  captureError(e, { endpoint: ctx });
  res.status(500).json({ error: 'internal error' });
}

/**
 * Los NIT base pedidos, sin repetir, o null si el cuerpo no vale: `nits` tiene
 * que ser una lista de como mucho MAX_NITS textos, y cada uno tiene que dar un
 * NIT base de 6 a 10 dígitos.
 */
export function leerNits(cuerpo: unknown): string[] | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const nits = (cuerpo as { nits?: unknown }).nits;
  if (!Array.isArray(nits) || nits.length > MAX_NITS) return null;
  const base = new Set<string>();
  for (const nit of nits) {
    if (typeof nit !== 'string') return null;
    const b = nitBase(nit);
    if (b === null) return null;
    base.add(b);
  }
  return [...base];
}

/**
 * Cruce de los prospectos de la app de Laboratorios ambientales con Zoho Books.
 * El cruce completo se calcula una vez y se cachea, pero cada respuesta lleva
 * solo los NIT pedidos: desde aquí no se puede sacar la lista de clientes.
 */
export function createLaboratoriosRouter(db: Pool): Router {
  const router = Router();

  router.post('/laboratorios/clientes', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    const nits = leerNits(req.body);
    if (nits === null) return void res.status(400).json({ error: 'nits inválidos' });
    try {
      const hechos = await cached(CACHE_KEY, () => leerHechosZoho(db));
      const clientes: ClienteZoho[] = [];
      for (const nit of nits) {
        const h = hechos.get(nit);
        // Campo a campo, y no con un spread: la respuesta lleva estos cuatro y
        // ninguno más, aunque HechosZoho creciera.
        if (h) clientes.push({ nit, ultimaFactura: h.ultimaFactura, ocmaVendido: h.ocmaVendido, ultimosRepuestos: h.ultimosRepuestos });
      }
      res.json({ clientes });
    } catch (e) {
      sendError(res, e, 'laboratorios_clientes');
    }
  });

  return router;
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasa**

Run: `cd apps/hub-api && npx vitest run src/laboratorios/router.test.ts`
Expected: PASS, 17 pruebas. La de 500 escribe un `console.error` en la salida: es lo esperado.

- [ ] **Step 5: Monta el router en `index.ts`**

En `apps/hub-api/src/index.ts`, sustituye:

```ts
import { createCalibracionesRouter } from './calibraciones/router.js';
```

por:

```ts
import { createCalibracionesRouter } from './calibraciones/router.js';
import { createLaboratoriosRouter } from './laboratorios/router.js';
```

Y sustituye:

```ts
    app.use('/api', createCalibracionesRouter(getHubPool()));
```

por:

```ts
    app.use('/api', createCalibracionesRouter(getHubPool()));
    // Cruce de los prospectos de Laboratorios ambientales con Zoho por NIT.
    app.use('/api', createLaboratoriosRouter(getHubPool()));
```

- [ ] **Step 6: Tipos y suite completa de hub-api**

Run: `cd apps/hub-api && npx tsc -b`
Expected: sin errores.

Run: `cd apps/hub-api && npm test`
Expected: todo en verde salvo, como mucho, la prueba 4.4 de users, que se cae por timeout solo bajo carga (memoria `tests-fallos-conocidos`). Si falla, repítela sola: `npx vitest run src/users`. Apunta el total de pruebas en el informe.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/laboratorios/router.ts apps/hub-api/src/laboratorios/router.test.ts apps/hub-api/src/index.ts
git commit -F - <<'EOF'
feat(hub-api): POST /api/laboratorios/clientes

Cruza los NIT que envía la app de Laboratorios ambientales con Zoho y
devuelve, de los que están, tres fechas: última factura, OCMA vendido y
últimos repuestos de OCMA. Con requireApp('laboratorios-ambientales'); el
cruce completo se cachea, pero solo salen los NIT pedidos.
EOF
```

---

### Task 3: App — reglas del estado del cliente

**Files:**
- Create: `apps/laboratorios-ambientales/src/lib/clientes.ts`
- Test: `apps/laboratorios-ambientales/src/lib/clientes.test.ts`

- [ ] **Step 1: Escribe las pruebas que fallan**

Crea `apps/laboratorios-ambientales/src/lib/clientes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Prospecto } from './prospects';
import type { CruceZoho, HechosZoho } from './clientes';
import {
  ESTADOS_CLIENTE,
  ETIQUETA_ESTADO_CLIENTE,
  estadoCliente,
  filtrarPorCliente,
  hechosDe,
  nitBase,
  nitsParaConsultar,
} from './clientes';

// Hoy − 36 meses = 2023-11-26.
const HOY = '2026-11-26';

// NIT y fechas ficticios: el repo es público.
const hechos = (over: Partial<HechosZoho> = {}): HechosZoho => ({
  ultimaFactura: null,
  ocmaVendido: null,
  ultimosRepuestos: null,
  ...over,
});

const prospecto = (over: Partial<Prospecto> = {}): Prospecto => ({
  codigo: '101',
  nombre: 'LABORATORIO ANDINO DE AGUAS S.A.S.',
  nit: '900.000.001-7',
  ciudad: 'Medellín',
  departamento: 'Antioquia',
  contacto: '',
  telefono: '',
  correo: '',
  matrices: ['Agua'],
  metodos: ['SM 5520 B'],
  grupo: 'gravimetria',
  vigenciaMasProxima: null,
  ...over,
});

const cruce = (entradas: Record<string, HechosZoho>): CruceZoho => new Map(Object.entries(entradas));

describe('nitBase', () => {
  it('el formato del dataset da el NIT de Zoho', () => {
    expect(nitBase('900.000.001-7')).toBe('900000001');
  });

  it('vacío, de relleno o de más de 10 dígitos da null', () => {
    expect(nitBase('')).toBeNull();
    expect(nitBase('123')).toBeNull();
    expect(nitBase('12345678901')).toBeNull();
  });
});

describe('estadoCliente', () => {
  it('sin NIT', () => {
    expect(estadoCliente('', cruce({}), HOY)).toBe('sin-nit');
  });

  it('no está en Zoho', () => {
    expect(estadoCliente('900.000.001-7', cruce({}), HOY)).toBe('no-en-zoho');
  });

  it('en Zoho sin compras', () => {
    expect(estadoCliente('900.000.001-7', cruce({ '900000001': hechos() }), HOY)).toBe('sin-compras');
  });

  it('activo justo en el límite de 36 meses, y antiguo el día anterior', () => {
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2023-11-26' }) }), HOY)).toBe('activo');
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2023-11-25' }) }), HOY)).toBe('antiguo');
  });

  it('activo con una factura reciente', () => {
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2026-10-01' }) }), HOY)).toBe('activo');
  });

  it('con hoy a 29 de febrero, el límite es el último día de febrero de hace 3 años', () => {
    const hoy = '2028-02-29';
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2025-02-28' }) }), hoy)).toBe('activo');
    expect(estadoCliente('900000001', cruce({ '900000001': hechos({ ultimaFactura: '2025-02-27' }) }), hoy)).toBe('antiguo');
  });
});

describe('hechosDe', () => {
  it('busca por NIT base', () => {
    const h = hechos({ ocmaVendido: '2024-05-02' });
    expect(hechosDe('900.000.001-7', cruce({ '900000001': h }))).toBe(h);
  });

  it('null sin NIT o fuera de Zoho', () => {
    expect(hechosDe('', cruce({}))).toBeNull();
    expect(hechosDe('900000001', cruce({}))).toBeNull();
  });
});

describe('nitsParaConsultar', () => {
  it('NIT base sin repetir y ordenados; los que no valen no van', () => {
    const nits = nitsParaConsultar([
      prospecto({ nit: '900.000.002-5' }),
      prospecto({ nit: '900.000.001-7' }),
      prospecto({ nit: '900000001' }),
      prospecto({ nit: '' }),
    ]);
    expect(nits).toEqual(['900000001', '900000002']);
  });
});

describe('filtrarPorCliente', () => {
  const lista = [prospecto({ nit: '900.000.001-7', nombre: 'A' }), prospecto({ nit: '', nombre: 'B' })];
  const c = cruce({ '900000001': hechos({ ultimaFactura: '2026-10-01' }) });

  it('«Todos» devuelve la lista entera', () => {
    expect(filtrarPorCliente(lista, '', c, HOY)).toBe(lista);
  });

  it('sin cruce (cargando o con error) no filtra', () => {
    expect(filtrarPorCliente(lista, 'activo', null, HOY)).toBe(lista);
  });

  it('con un estado deja solo los de ese estado', () => {
    expect(filtrarPorCliente(lista, 'activo', c, HOY).map((p) => p.nombre)).toEqual(['A']);
    expect(filtrarPorCliente(lista, 'sin-nit', c, HOY).map((p) => p.nombre)).toEqual(['B']);
  });
});

describe('etiquetas', () => {
  it('cinco estados, cada uno con su etiqueta', () => {
    expect(ESTADOS_CLIENTE.map((e) => ETIQUETA_ESTADO_CLIENTE[e])).toEqual([
      'Cliente activo',
      'Cliente antiguo',
      'En Zoho sin compras',
      'No está en Zoho',
      'Sin NIT',
    ]);
  });
});
```

- [ ] **Step 2: Ejecuta y comprueba que falla**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/clientes.test.ts`
Expected: FAIL, porque no se encuentra `./clientes`.

- [ ] **Step 3: Escribe la implementación mínima**

Crea `apps/laboratorios-ambientales/src/lib/clientes.ts`:

```ts
import type { Prospecto } from './prospects';
import { sumarMeses } from './fechas';

// Cruce de los prospectos con Zoho Books por NIT. Ver
// docs/superpowers/specs/2026-11-26-prospectos-cruce-zoho-design.md.

export type EstadoCliente = 'activo' | 'antiguo' | 'sin-compras' | 'no-en-zoho' | 'sin-nit';

/** Lo que hub-api devuelve de cada NIT: solo fechas AAAA-MM-DD. */
export type HechosZoho = {
  ultimaFactura: string | null;
  ocmaVendido: string | null;
  ultimosRepuestos: string | null;
};

/** El cruce, por NIT base. Un NIT que no está es «No está en Zoho». */
export type CruceZoho = ReadonlyMap<string, HechosZoho>;

/** Cómo va la consulta a hub-api. */
export type EstadoCruce = 'cargando' | 'listo' | 'error';

// Sin facturarle en este tiempo, el cliente pasa de activo a antiguo.
export const MESES_CLIENTE_ACTIVO = 36;

export const ESTADOS_CLIENTE: readonly EstadoCliente[] = ['activo', 'antiguo', 'sin-compras', 'no-en-zoho', 'sin-nit'];

export const ETIQUETA_ESTADO_CLIENTE: Record<EstadoCliente, string> = {
  activo: 'Cliente activo',
  antiguo: 'Cliente antiguo',
  'sin-compras': 'En Zoho sin compras',
  'no-en-zoho': 'No está en Zoho',
  'sin-nit': 'Sin NIT',
};

/**
 * NIT base, la misma regla que hub-api: lo de antes del primer «-», solo
 * dígitos, de 6 a 10. `900.000.001-7` da `900000001`. Un NIT que no vale no se
 * envía: hub-api rechazaría la petición entera.
 */
export function nitBase(nit: string): string | null {
  const digitos = nit.split('-')[0].replace(/\D/g, '');
  return digitos.length >= 6 && digitos.length <= 10 ? digitos : null;
}

export function hechosDe(nit: string, cruce: CruceZoho): HechosZoho | null {
  const base = nitBase(nit);
  return base === null ? null : (cruce.get(base) ?? null);
}

/**
 * El estado comercial del laboratorio. «Activo» si la última factura cae en los
 * últimos 36 meses de calendario, con el límite incluido: con hoy 2026-11-26,
 * una factura del 2023-11-26 todavía cuenta.
 */
export function estadoCliente(nit: string, cruce: CruceZoho, hoy: string): EstadoCliente {
  const base = nitBase(nit);
  if (base === null) return 'sin-nit';
  const hechos = cruce.get(base);
  if (!hechos) return 'no-en-zoho';
  if (hechos.ultimaFactura === null) return 'sin-compras';
  // Las fechas son AAAA-MM-DD: comparar como texto es comparar como fecha.
  return hechos.ultimaFactura >= sumarMeses(hoy, -MESES_CLIENTE_ACTIVO) ? 'activo' : 'antiguo';
}

/** Los NIT base que se envían a hub-api: sin repetir y ordenados. */
export function nitsParaConsultar(prospectos: Prospecto[]): string[] {
  const nits = new Set<string>();
  for (const prospecto of prospectos) {
    const base = nitBase(prospecto.nit);
    if (base !== null) nits.add(base);
  }
  return [...nits].sort();
}

/** Sin estado elegido, o sin cruce (cargando o con error), no filtra. */
export function filtrarPorCliente(
  prospectos: Prospecto[],
  estado: EstadoCliente | '',
  cruce: CruceZoho | null,
  hoy: string,
): Prospecto[] {
  if (estado === '' || cruce === null) return prospectos;
  return prospectos.filter((prospecto) => estadoCliente(prospecto.nit, cruce, hoy) === estado);
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasa**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/clientes.test.ts`
Expected: PASS, 15 pruebas.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/clientes.ts apps/laboratorios-ambientales/src/lib/clientes.test.ts
git commit -F - <<'EOF'
feat(laboratorios): reglas del estado de cliente de cada prospecto

Cinco estados a partir del cruce con Zoho: cliente activo (factura en los
últimos 36 meses, límite incluido), cliente antiguo, en Zoho sin compras, no
está en Zoho y sin NIT. Más el NIT base, los NIT a consultar y el filtro.
EOF
```

---

### Task 4: App — cliente HTTP de hub-api

**Files:**
- Modify: `apps/laboratorios-ambientales/package.json`, `package-lock.json` (raíz)
- Create: `apps/laboratorios-ambientales/src/services/clientesZoho.ts`
- Test: `apps/laboratorios-ambientales/src/services/clientesZoho.test.ts`

- [ ] **Step 1: Añade la dependencia**

En `apps/laboratorios-ambientales/package.json`, sustituye:

```json
  "dependencies": {
    "react": "^19.2.0",
```

por:

```json
  "dependencies": {
    "@suite/auth-client": "*",
    "react": "^19.2.0",
```

Run (desde la raíz): `npm install`
Expected: termina sin errores.

Run: `git diff --stat package-lock.json`
Expected: el lock cambia solo en la entrada `apps/laboratorios-ambientales` (una o dos líneas). Si cambia mucho más, para y avisa al orquestador; no lo commitees.

- [ ] **Step 2: Escribe las pruebas que fallan**

Crea `apps/laboratorios-ambientales/src/services/clientesZoho.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchClientesZoho } from './clientesZoho';
import { REQUEST_TIMEOUT_MS } from './api';

// NIT y fechas ficticios: el repo es público.
const CABECERAS = () => ({ Authorization: 'Bearer t' });

const respuesta = (cuerpo: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => cuerpo,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchClientesZoho', () => {
  it('sin NIT no llama a hub-api', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchClientesZoho([], undefined, CABECERAS)).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envía los NIT por POST con la cabecera de autorización', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta({ clientes: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchClientesZoho(['900000001', '900000002'], undefined, CABECERAS);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/api/laboratorios/clientes')).toBe(true);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
    expect(JSON.parse(init.body as string)).toEqual({ nits: ['900000001', '900000002'] });
  });

  it('convierte la respuesta en un mapa por NIT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuesta({
          clientes: [{ nit: '900000001', ultimaFactura: '2026-03-10', ocmaVendido: null, ultimosRepuestos: '2025-08-20' }],
        }),
      ),
    );
    const cruce = await fetchClientesZoho(['900000001'], undefined, CABECERAS);
    expect(cruce.get('900000001')).toEqual({ ultimaFactura: '2026-03-10', ocmaVendido: null, ultimosRepuestos: '2025-08-20' });
  });

  it('lanza un error con un 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta({ error: 'internal error' }, 500)));
    await expect(fetchClientesZoho(['900000001'], undefined, CABECERAS)).rejects.toThrow('hub-api respondió 500');
  });

  it('lanza un error si la respuesta no trae la lista de clientes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta({})));
    await expect(fetchClientesZoho(['900000001'], undefined, CABECERAS)).rejects.toThrow('clientes');
  });

  it('corta a los REQUEST_TIMEOUT_MS y lo dice', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
          }),
      ),
    );
    const promesa = fetchClientesZoho(['900000001'], undefined, CABECERAS);
    const comprobacion = expect(promesa).rejects.toThrow(`hub-api no respondió en ${REQUEST_TIMEOUT_MS / 1000} s`);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await comprobacion;
  });

  it('si quien llama aborta, la petición se aborta', async () => {
    let senal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            senal = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
          }),
      ),
    );
    const controller = new AbortController();
    const promesa = fetchClientesZoho(['900000001'], controller.signal, CABECERAS);
    controller.abort();
    await expect(promesa).rejects.toThrow('aborted');
    expect(senal?.aborted).toBe(true);
  });
});
```

- [ ] **Step 3: Ejecuta y comprueba que falla**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/services/clientesZoho.test.ts`
Expected: FAIL, porque no se encuentra `./clientesZoho`.

- [ ] **Step 4: Escribe la implementación mínima**

Crea `apps/laboratorios-ambientales/src/services/clientesZoho.ts`:

```ts
import { authHeaders } from '@suite/auth-client';
import type { CruceZoho, HechosZoho } from '../lib/clientes';
import { REQUEST_TIMEOUT_MS } from './api';

// Cruce de los prospectos con Zoho, servido por hub-api. Un 401 lo resuelve el
// interceptor del portal (parchea fetch): aquí basta con fallar.
const URL_CLIENTES = `${(import.meta.env.VITE_HUB_API_URL as string | undefined) ?? ''}/api/laboratorios/clientes`;

type ClienteZoho = HechosZoho & { nit: string };

/**
 * Pide a hub-api el cruce de estos NIT base. Sin NIT no llama. Con el mismo
 * tope de tiempo que datos.gov.co; `signal` permite cancelarla al cerrar la
 * vista. `cabeceras` solo se cambia en las pruebas.
 */
export async function fetchClientesZoho(
  nits: string[],
  signal?: AbortSignal,
  cabeceras: () => Record<string, string> = authHeaders,
): Promise<CruceZoho> {
  if (nits.length === 0) return new Map();

  const controller = new AbortController();
  let vencido = false;
  const timer = setTimeout(() => {
    vencido = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const alAbortar = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', alAbortar, { once: true });

  try {
    const respuesta = await fetch(URL_CLIENTES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cabeceras() },
      body: JSON.stringify({ nits }),
      signal: controller.signal,
    });
    if (!respuesta.ok) throw new Error(`hub-api respondió ${respuesta.status}`);
    const cuerpo = (await respuesta.json()) as { clientes?: ClienteZoho[] };
    if (!Array.isArray(cuerpo.clientes)) throw new Error('La respuesta de hub-api no trae «clientes»');
    return new Map(
      cuerpo.clientes.map(({ nit, ultimaFactura, ocmaVendido, ultimosRepuestos }) => [
        nit,
        { ultimaFactura, ocmaVendido, ultimosRepuestos },
      ]),
    );
  } catch (error) {
    if (vencido) throw new Error(`hub-api no respondió en ${REQUEST_TIMEOUT_MS / 1000} s`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', alAbortar);
  }
}
```

- [ ] **Step 5: Ejecuta y comprueba que pasa**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/services/clientesZoho.test.ts`
Expected: PASS, 7 pruebas.

Run: `cd apps/laboratorios-ambientales && npx tsc -b`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/laboratorios-ambientales/package.json package-lock.json apps/laboratorios-ambientales/src/services/clientesZoho.ts apps/laboratorios-ambientales/src/services/clientesZoho.test.ts
git commit -F - <<'EOF'
feat(laboratorios): cliente de hub-api para el cruce con Zoho

fetchClientesZoho envía los NIT base en un POST con el JWT del portal y
devuelve el cruce como mapa. Mismo tope de tiempo que datos.gov.co y
cancelable al cerrar la vista. Añade la dependencia @suite/auth-client.
EOF
```

---

### Task 5: App — columnas del cruce en el Excel

**Files:**
- Modify: `apps/laboratorios-ambientales/src/lib/exportProspects.ts`
- Test: `apps/laboratorios-ambientales/src/lib/exportProspects.test.ts`

- [ ] **Step 1: Cambia las pruebas existentes y añade las nuevas (que fallan)**

En `apps/laboratorios-ambientales/src/lib/exportProspects.test.ts`, sustituye:

```ts
import type { Prospecto } from './prospects';
import { COLUMNAS_EXCEL, HOJA_EXCEL, filasExcel, nombreDeFichero } from './exportProspects';
```

por:

```ts
import type { Prospecto } from './prospects';
import type { CruceZoho } from './clientes';
import { COLUMNAS_EXCEL, HOJA_EXCEL, filasExcel, nombreDeFichero } from './exportProspects';
```

Sustituye:

```ts
  it('la primera fila es la cabecera, con las trece columnas en su orden', () => {
```

por:

```ts
  it('la primera fila es la cabecera, con las diecisiete columnas en su orden', () => {
```

Sustituye (en la cabecera esperada de esa misma prueba):

```ts
        'Teléfono',
        'Correo',
      ],
    ]);
```

por:

```ts
        'Teléfono',
        'Correo',
        'Cliente',
        'Última factura',
        'OCMA vendido',
        'Últimos repuestos OCMA',
      ],
    ]);
```

Sustituye (al final de la fila esperada de la prueba «una fila por laboratorio…»):

```ts
      '6040000001',
      'lab.andino@example.com',
    ]);
  });
```

por:

```ts
      '6040000001',
      'lab.andino@example.com',
      '',
      '',
      '',
      '',
    ]);
  });
```

Sustituye:

```ts
  it('cada fila tiene una celda por columna', () => {
    for (const fila of filasExcel([prospecto(), prospecto({ vigenciaMasProxima: null })], HOY)) {
      expect(fila).toHaveLength(COLUMNAS_EXCEL.length);
    }
  });
```

por:

```ts
  it('cada fila tiene una celda por columna', () => {
    for (const fila of filasExcel([prospecto(), prospecto({ vigenciaMasProxima: null })], HOY)) {
      expect(fila).toHaveLength(COLUMNAS_EXCEL.length);
    }
  });

  it('con el cruce, las cuatro últimas columnas llevan el estado y las fechas', () => {
    const cruce: CruceZoho = new Map([
      ['900000001', { ultimaFactura: '2026-03-10', ocmaVendido: '2024-05-02', ultimosRepuestos: null }],
    ]);
    const fila = filasExcel([prospecto()], HOY, cruce)[1];
    expect(fila.slice(-4)).toEqual(['Cliente activo', '2026-03-10', '2024-05-02', '']);
  });

  it('con el cruce, un laboratorio que no está en Zoho lo dice y deja las fechas vacías', () => {
    const fila = filasExcel([prospecto()], HOY, new Map())[1];
    expect(fila.slice(-4)).toEqual(['No está en Zoho', '', '', '']);
  });

  it('sin cruce (cargando o con error), las cuatro columnas van vacías', () => {
    const fila = filasExcel([prospecto()], HOY, null)[1];
    expect(fila.slice(-4)).toEqual(['', '', '', '']);
  });
```

(El NIT del `prospecto()` de este fichero es `900.000.001-1`, cuyo NIT base es `900000001`.)

- [ ] **Step 2: Ejecuta y comprueba que falla**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/exportProspects.test.ts`
Expected: FAIL. La cabecera no tiene las columnas nuevas, y `filasExcel` todavía ignora el tercer argumento, así que las filas tienen 13 celdas.

- [ ] **Step 3: Escribe la implementación mínima**

En `apps/laboratorios-ambientales/src/lib/exportProspects.ts`, sustituye:

```ts
import type { GrupoProspecto, Prospecto } from './prospects';
import { ETIQUETA_GRUPO, ETIQUETA_VIGENCIA, estadoVigencia } from './prospects';
```

por:

```ts
import type { GrupoProspecto, Prospecto } from './prospects';
import { ETIQUETA_GRUPO, ETIQUETA_VIGENCIA, estadoVigencia } from './prospects';
import type { CruceZoho } from './clientes';
import { ETIQUETA_ESTADO_CLIENTE, estadoCliente, hechosDe } from './clientes';
```

Sustituye:

```ts
  'Teléfono',
  'Correo',
] as const;
```

por:

```ts
  'Teléfono',
  'Correo',
  'Cliente',
  'Última factura',
  'OCMA vendido',
  'Últimos repuestos OCMA',
] as const;
```

Sustituye:

```ts
export function filasExcel(prospectos: Prospecto[], hoy: string): string[][] {
  return [
    [...COLUMNAS_EXCEL],
    ...prospectos.map((prospecto) => [
```

por:

```ts
// Las cuatro columnas del cruce con Zoho. Sin cruce (consultando o con error)
// van vacías: un «No está en Zoho» sin haber preguntado sería falso.
function celdasCliente(prospecto: Prospecto, hoy: string, cruce: CruceZoho | null): string[] {
  if (cruce === null) return ['', '', '', ''];
  const hechos = hechosDe(prospecto.nit, cruce);
  return [
    ETIQUETA_ESTADO_CLIENTE[estadoCliente(prospecto.nit, cruce, hoy)],
    hechos?.ultimaFactura ?? '',
    hechos?.ocmaVendido ?? '',
    hechos?.ultimosRepuestos ?? '',
  ];
}

export function filasExcel(prospectos: Prospecto[], hoy: string, cruce: CruceZoho | null = null): string[][] {
  return [
    [...COLUMNAS_EXCEL],
    ...prospectos.map((prospecto) => [
```

Sustituye:

```ts
      prospecto.telefono,
      prospecto.correo,
    ]),
  ];
}
```

por:

```ts
      prospecto.telefono,
      prospecto.correo,
      ...celdasCliente(prospecto, hoy, cruce),
    ]),
  ];
}
```

- [ ] **Step 4: Ejecuta y comprueba que pasa**

Run: `cd apps/laboratorios-ambientales && npx vitest run src/lib/exportProspects.test.ts`
Expected: PASS, 11 pruebas.

Run: `cd apps/laboratorios-ambientales && npx tsc -b`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/laboratorios-ambientales/src/lib/exportProspects.ts apps/laboratorios-ambientales/src/lib/exportProspects.test.ts
git commit -F - <<'EOF'
feat(laboratorios): el Excel de prospectos lleva el cruce con Zoho

Cuatro columnas al final: Cliente, Última factura, OCMA vendido y Últimos
repuestos OCMA. Sin cruce (consultando o con error) van vacías.
EOF
```

---

### Task 6: App — la columna, el filtro y el aviso en la vista

**Files:**
- Create: `apps/laboratorios-ambientales/src/components/CeldaCliente.tsx`
- Modify: `apps/laboratorios-ambientales/src/pages/Prospectos.tsx`

Sin pruebas (no hay jsdom): se comprueba con lint, `tsc -b` de la app y del portal, y la suite.

- [ ] **Step 1: Crea la celda**

Crea `apps/laboratorios-ambientales/src/components/CeldaCliente.tsx`:

```tsx
import type { CruceZoho, EstadoCliente, EstadoCruce } from '../lib/clientes';
import { ETIQUETA_ESTADO_CLIENTE, estadoCliente, hechosDe } from '../lib/clientes';

type Props = {
  nit: string;
  cruce: CruceZoho | null;
  estadoCruce: EstadoCruce;
  hoy: string;
};

// La etiqueta lleva siempre su texto: el color solo acompaña.
const INSIGNIA_CLIENTE: Record<EstadoCliente, string> = {
  activo: 'bg-emerald-100 text-emerald-800',
  antiguo: 'bg-amber-100 text-amber-800',
  'sin-compras': 'bg-sky-100 text-sky-800',
  'no-en-zoho': 'bg-slate-100 text-slate-700',
  'sin-nit': 'bg-slate-100 text-slate-500',
};

export default function CeldaCliente({ nit, cruce, estadoCruce, hoy }: Props) {
  // El aviso para lectores de pantalla va en la línea del recuento, una sola vez.
  if (estadoCruce === 'cargando') return <span className="text-xs text-slate-500">Consultando…</span>;
  if (estadoCruce === 'error' || cruce === null) return <span className="text-slate-500">—</span>;

  const estado = estadoCliente(nit, cruce, hoy);
  const hechos = hechosDe(nit, cruce);
  return (
    <>
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${INSIGNIA_CLIENTE[estado]}`}
      >
        {ETIQUETA_ESTADO_CLIENTE[estado]}
      </span>
      {hechos?.ultimaFactura && (
        <p className="mt-1 text-xs text-slate-600 whitespace-nowrap">Última factura {hechos.ultimaFactura}</p>
      )}
      {hechos?.ocmaVendido && <p className="text-xs text-slate-600 whitespace-nowrap">OCMA vendido {hechos.ocmaVendido}</p>}
      {hechos?.ultimosRepuestos && (
        <p className="text-xs text-slate-600 whitespace-nowrap">Repuestos OCMA {hechos.ultimosRepuestos}</p>
      )}
    </>
  );
}
```

- [ ] **Step 2: Imports y estado en `Prospectos.tsx`**

En `apps/laboratorios-ambientales/src/pages/Prospectos.tsx`, sustituye:

```tsx
import { useMemo, useState } from 'react';
```

por:

```tsx
import { useEffect, useMemo, useState } from 'react';
```

Sustituye:

```tsx
import { HOJA_EXCEL, filasExcel, nombreDeFichero } from '../lib/exportProspects';
import { hoyLocal } from '../lib/fechas';
```

por:

```tsx
import { HOJA_EXCEL, filasExcel, nombreDeFichero } from '../lib/exportProspects';
import { hoyLocal } from '../lib/fechas';
import type { CruceZoho, EstadoCliente, EstadoCruce } from '../lib/clientes';
import { ESTADOS_CLIENTE, ETIQUETA_ESTADO_CLIENTE, filtrarPorCliente, nitsParaConsultar } from '../lib/clientes';
import { fetchClientesZoho } from '../services/clientesZoho';
import CeldaCliente from '../components/CeldaCliente';
```

Sustituye:

```tsx
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState('');
```

por:

```tsx
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState('');
  const [filtroCliente, setFiltroCliente] = useState<EstadoCliente | ''>('');
  const [cruce, setCruce] = useState<CruceZoho | null>(null);
  const [estadoCruce, setEstadoCruce] = useState<EstadoCruce>('cargando');
  // Subirlo repite la consulta: es lo que hace «Reintentar».
  const [intento, setIntento] = useState(0);
```

- [ ] **Step 3: La consulta y los filtros**

Sustituye:

```tsx
  // El número de cada pestaña cuenta su grupo con el departamento y la búsqueda aplicados.
  const recuentos = useMemo<Record<GrupoProspecto, number>>(
    () => ({
      infrarrojo: filterProspects(todos, { grupo: 'infrarrojo', departamento, busqueda }).length,
      gravimetria: filterProspects(todos, { grupo: 'gravimetria', departamento, busqueda }).length,
    }),
    [todos, departamento, busqueda],
  );

  const visibles = useMemo(
    () => sortProspects(filterProspects(todos, { grupo, departamento, busqueda })),
    [todos, grupo, departamento, busqueda],
  );
```

por:

```tsx
  // Una sola consulta con los NIT de las dos pestañas. La dependencia es el texto
  // y no la lista: si los datos se refrescan con los mismos NIT, no se repite.
  const claveNits = useMemo(() => nitsParaConsultar(todos).join(','), [todos]);
  useEffect(() => {
    const controller = new AbortController();
    fetchClientesZoho(claveNits === '' ? [] : claveNits.split(','), controller.signal).then(
      (resultado) => {
        setCruce(resultado);
        setEstadoCruce('listo');
      },
      () => {
        // Al cerrar la vista se aborta: eso no es un error que haya que enseñar.
        if (!controller.signal.aborted) setEstadoCruce('error');
      },
    );
    return () => controller.abort();
  }, [claveNits, intento]);

  const reintentar = () => {
    setEstadoCruce('cargando');
    setIntento((n) => n + 1);
  };

  // Mientras no hay cruce, el filtro «Cliente» no cuenta y el Excel sale sin él.
  const cruceListo = estadoCruce === 'listo' ? cruce : null;
  const clienteElegido = cruceListo === null ? '' : filtroCliente;

  // El número de cada pestaña cuenta su grupo con los demás filtros aplicados.
  const recuentos = useMemo<Record<GrupoProspecto, number>>(
    () => ({
      infrarrojo: filtrarPorCliente(
        filterProspects(todos, { grupo: 'infrarrojo', departamento, busqueda }),
        clienteElegido,
        cruceListo,
        hoy,
      ).length,
      gravimetria: filtrarPorCliente(
        filterProspects(todos, { grupo: 'gravimetria', departamento, busqueda }),
        clienteElegido,
        cruceListo,
        hoy,
      ).length,
    }),
    [todos, departamento, busqueda, clienteElegido, cruceListo, hoy],
  );

  const visibles = useMemo(
    () =>
      sortProspects(
        filtrarPorCliente(filterProspects(todos, { grupo, departamento, busqueda }), clienteElegido, cruceListo, hoy),
      ),
    [todos, grupo, departamento, busqueda, clienteElegido, cruceListo, hoy],
  );
```

- [ ] **Step 4: El Excel y «Limpiar filtros»**

Sustituye:

```tsx
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(visibles, hoy)), HOJA_EXCEL);
```

por:

```tsx
      XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(filasExcel(visibles, hoy, cruceListo)), HOJA_EXCEL);
```

Sustituye:

```tsx
  const limpiarFiltros = () => {
    setDepartamento('');
    setBusqueda('');
  };
```

por:

```tsx
  const limpiarFiltros = () => {
    setDepartamento('');
    setBusqueda('');
    setFiltroCliente('');
  };
```

- [ ] **Step 5: El aviso de qué dice la vista y el de error**

Sustituye:

```tsx
  return (
    // Todo el ancho: la tabla tiene 7 columnas y la de contacto se cortaba a 1280 px.
```

por:

```tsx
  return (
    // Todo el ancho: la tabla tiene 8 columnas y la de contacto se cortaba a 1280 px.
```

Sustituye:

```tsx
          identifica el equipo: no dice quién tiene un OCMA ni de qué marca es su equipo de infrarrojo.
        </p>
      </div>
```

por:

```tsx
          identifica el equipo: no dice quién tiene un OCMA ni de qué marca es su equipo de infrarrojo. La columna
          Cliente sale de Zoho: «OCMA vendido» solo cuenta los que facturó Ambientalia.
        </p>
      </div>

      {estadoCruce === 'error' && (
        <div
          role="alert"
          className="bg-amber-50 ring-1 ring-amber-200 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-amber-900">No se pudo consultar Zoho; la columna Cliente queda vacía.</p>
          <button
            type="button"
            onClick={reintentar}
            className="px-4 py-2 bg-amber-700 text-white font-semibold rounded-lg hover:bg-amber-800 transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}
```

- [ ] **Step 6: El filtro «Cliente»**

Sustituye:

```tsx
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
```

por:

```tsx
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
```

Sustituye:

```tsx
              {departamentos.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>
        </div>
```

por:

```tsx
              {departamentos.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {opcion}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cliente-prospectos" className="block text-sm font-semibold text-gray-700 mb-1">
              Cliente
            </label>
            <select
              id="cliente-prospectos"
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value as EstadoCliente | '')}
              disabled={estadoCruce !== 'listo'}
              className={`${SELECT_CLASS} disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed`}
            >
              <option value="">Todos</option>
              {ESTADOS_CLIENTE.map((opcion) => (
                <option key={opcion} value={opcion}>
                  {ETIQUETA_ESTADO_CLIENTE[opcion]}
                </option>
              ))}
            </select>
          </div>
        </div>
```

- [ ] **Step 7: El aviso de carga en la línea del recuento**

Sustituye:

```tsx
          {visibles.length.toLocaleString('es-CO')} {visibles.length === 1 ? 'laboratorio' : 'laboratorios'}
        </p>
```

por:

```tsx
          {visibles.length.toLocaleString('es-CO')} {visibles.length === 1 ? 'laboratorio' : 'laboratorios'}
          {estadoCruce === 'cargando' && ' · Consultando Zoho…'}
        </p>
```

- [ ] **Step 8: La columna en la tabla**

Sustituye:

```tsx
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Laboratorio
                  </th>
```

por:

```tsx
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Laboratorio
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold text-slate-600">
                    Cliente
                  </th>
```

Sustituye:

```tsx
                          NIT {prospecto.nit || '—'} &middot; Código {prospecto.codigo || '—'}
                        </p>
                      </td>
```

por:

```tsx
                          NIT {prospecto.nit || '—'} &middot; Código {prospecto.codigo || '—'}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <CeldaCliente nit={prospecto.nit} cruce={cruce} estadoCruce={estadoCruce} hoy={hoy} />
                      </td>
```

- [ ] **Step 9: Lint, tipos y suite**

Run: `cd apps/laboratorios-ambientales && npx eslint src/pages/Prospectos.tsx src/components/CeldaCliente.tsx src/lib/clientes.ts src/services/clientesZoho.ts`
Expected: sin errores. Si `react-hooks/set-state-in-effect` se queja: en el efecto solo se llama a `setState` dentro de los `.then`, nunca de forma síncrona. Revisa que no se haya colado un `setEstadoCruce('cargando')` en el cuerpo del efecto.

Run: `cd apps/laboratorios-ambientales && npx tsc -b && npm test`
Expected: sin errores de tipos. Suite: 12 ficheros y 197 pruebas, todo en verde.

Run: `cd apps/portal && npx tsc -b`
Expected: sin errores (tarda unos 25 s).

- [ ] **Step 10: Commit**

```bash
git add apps/laboratorios-ambientales/src/components/CeldaCliente.tsx apps/laboratorios-ambientales/src/pages/Prospectos.tsx
git commit -F - <<'EOF'
feat(laboratorios): columna Cliente en los prospectos de grasas y aceites

Al abrir la vista se pide a hub-api el cruce de los NIT con Zoho. La columna
enseña el estado (activo, antiguo, sin compras, no está en Zoho, sin NIT) y
las fechas de la última factura, del OCMA vendido y de los últimos
repuestos. Hay un filtro por estado, y el Excel lleva el cruce. Si hub-api
falla, la vista sigue con un aviso y «Reintentar».
EOF
```

---

### Task 7: Documentación

**Files:**
- Modify: `apps/laboratorios-ambientales/README.md`
- Modify: `docs/PRIVACY-RETENTION.md`

- [ ] **Step 1: README de la app**

En `apps/laboratorios-ambientales/README.md`, sustituye:

```md
  OCMA ni Horiba: la vista no sabe quién tiene un OCMA. Eso lo dirían Zoho o
  Desk 2.0, que quedan fuera.
```

por:

```md
  OCMA ni Horiba: el dataset no sabe quién tiene un OCMA. Lo que dice Zoho va
  en la columna «Cliente» (ver abajo); Desk 2.0 queda fuera.
```

Sustituye:

```md
- **En el Buscador,** «Aceites y Grasas» y «Grasas y Aceites» son una sola
  casilla: `variableKey` lleva un sinónimo explícito, solo para ese par.
```

por:

```md
- **En el Buscador,** «Aceites y Grasas» y «Grasas y Aceites» son una sola
  casilla: `variableKey` lleva un sinónimo explícito, solo para ese par.

### Cruce con Zoho (columna «Cliente»)

Al abrir la vista, la app envía a hub-api (`POST /api/laboratorios/clientes`,
con el JWT del portal y `requireApp('laboratorios-ambientales')`) los NIT base
de los 90 laboratorios. Responde, de los que están en Zoho, tres fechas y nada
más: ni importes, ni nombres, ni identificadores.

| Estado | Cuándo |
|---|---|
| Cliente activo | Última factura (sin anuladas ni borradores) en los últimos 36 meses, límite incluido. |
| Cliente antiguo | Última factura más antigua. |
| En Zoho sin compras | Hay un contacto cliente con ese NIT, sin facturas. |
| No está en Zoho | Ningún contacto cliente tiene ese NIT. |
| Sin NIT | El dataset no trae NIT, o no da de 6 a 10 dígitos. |

- **NIT base:** lo de antes del primer «-», solo dígitos (`900.000.001-7` →
  `900000001`). Es el formato de `cf_nit` en Zoho. Varios contactos con el
  mismo NIT se suman.
- **OCMA vendido** y **Repuestos OCMA:** la factura más reciente con un artículo
  de la categoría «OCMA-500 Series» o «C&R OCMA-500». Solo cuentan los que
  facturó Ambientalia.
- **Si hub-api falla,** la vista funciona igual: aviso con «Reintentar», la
  columna vacía, el filtro «Cliente» desactivado y el Excel sin el cruce.
- **El Excel** lleva cuatro columnas más al final: Cliente, Última factura,
  OCMA vendido y Últimos repuestos OCMA.
- hub-api cachea el cruce completo 2 minutos y solo devuelve los NIT pedidos.
  El servidor no sabe cuáles son prospectos, así que frena el barrido por
  volumen: como mucho 150 NIT por petición y 5 peticiones por minuto y usuario
  (después, 429). Hoy la vista envía unos 85; si el dataset pasara de 150
  laboratorios de grasas y aceites, la petición daría 400 y habría que
  partirla.
```

Sustituye:

```md
- Cruzar los prospectos con Zoho por NIT (cliente o no, si se le vendió un
  OCMA). La tabla admite una columna «Cliente» más sin rehacerse.
- El cache completo (~3 MB) va a `localStorage`, que comparte los ~5 MB del
```

por:

```md
- El cache completo (~3 MB) va a `localStorage`, que comparte los ~5 MB del
```

- [ ] **Step 2: Registro de privacidad**

En `docs/PRIVACY-RETENTION.md`, sustituye:

```md
- **Dirección** del cliente (`billing_address` → `address`, `city`), en el modal de
  *detalle* de factura/OV de **Contabilidad** y **Conciliador de Pagos**.
```

por:

```md
- **Dirección** del cliente (`billing_address` → `address`, `city`), en el modal de
  *detalle* de factura/OV de **Contabilidad** y **Conciliador de Pagos**.
- **Si un NIT es cliente**, en **Laboratorios ambientales**
  (`POST /api/laboratorios/clientes`). La app envía NIT que ya son públicos (el
  dataset del IDEAM en datos.gov.co) y recibe, de los que están en Zoho, solo
  tres fechas: la de la última factura, la del último OCMA vendido y la de los
  últimos repuestos de OCMA. No salen nombres, importes ni identificadores. El
  cruce completo (NIT → fechas) se guarda en memoria 2 minutos (`cached`), pero
  la respuesta lleva solo los NIT pedidos. El servidor no comprueba que sean
  del dataset: un usuario con la app podría probar NIT a ciegas. Se frena por
  volumen (150 NIT por petición, 5 peticiones por minuto y usuario: unos 750
  NIT por minuto como mucho), no se impide.
```

Sustituye:

```md
  `requireApp('contabilidad')`; y los endpoints de datos/detalle de las demás apps
```

por:

```md
  `requireApp('contabilidad')`; `/api/laboratorios/clientes` →
  `requireApp('laboratorios-ambientales')`; y los endpoints de datos/detalle de las demás apps
```

- [ ] **Step 3: Comprueba que no se rompió nada**

Run: `git diff --stat`
Expected: solo los dos ficheros de documentación.

- [ ] **Step 4: Commit**

```bash
git add apps/laboratorios-ambientales/README.md docs/PRIVACY-RETENTION.md
git commit -F - <<'EOF'
docs(laboratorios): el cruce de los prospectos con Zoho

README de la app con los estados, el NIT base y qué pasa si hub-api falla.
Registro de privacidad con el endpoint nuevo y su requireApp.
EOF
```

---

## Cierre (orquestador)

1. Revisión final de toda la rama (`git diff main...feat/laboratorios-cruce-zoho`) contra el diseño.
2. Suites: `cd apps/hub-api && npm test`, `cd apps/laboratorios-ambientales && npm test && npm run build`, `cd apps/portal && npx tsc -b`.
3. Comprobación de privacidad en un comando aparte, antes del push: que no se haya colado ningún NIT, nombre ni correo real en los ficheros nuevos.
4. Merge `--no-ff` a `main` con un mensaje `merge: …`, push y seguimiento del CI (`build-and-test`, `imagen-hub-api`).
5. Al usuario: desplegar primero hub-api y después el portal; luego probarlo en el navegador.
