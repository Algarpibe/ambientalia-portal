# Pagos recibidos por semana — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** una pestaña «Pagos recibidos» en Contabilidad con los pagos de clientes
agrupados por semana del mes (lunes-domingo, semana 1 corta si el mes no empieza en
lunes, hasta 6 semanas), y el detalle de a qué facturas y OV se aplicó cada pago.

**Arquitectura:** hub-api lee `books.customer_payments` ⟕ `customer_payment_invoices` ⟕
`invoices` ⟕ `sales_orders` en una consulta, y agrupa en TypeScript puro y testeado
(`semanaDelMes`, `rangoDeSemana`, `agruparPagos`). Un endpoint nuevo, solo para
Contabilidad, sirve las semanas ya armadas. El portal pinta una fila colapsable por
semana con la sub-tabla de pagos.

**Stack:** TypeScript, Express, PostgreSQL (`zoho-hub`), React 19, Vitest (supertest en
hub-api, jsdom + React Testing Library en `apps/contabilidad`).

**Especificación:** [docs/superpowers/specs/2026-10-01-pagos-por-semana-design.md](../specs/2026-10-01-pagos-por-semana-design.md)

---

## Mapa de ficheros

| Fichero | Cambio |
|---|---|
| `apps/hub-api/src/contabilidad/pagos.ts` | **nuevo**: tipos, `semanaDelMes`, `rangoDeSemana`, `agruparPagos`, `getPagosPorSemana` |
| `apps/hub-api/src/contabilidad/pagos.test.ts` | **nuevo** |
| `apps/hub-api/src/contabilidad/router.ts` | endpoint `GET /contabilidad/pagos` |
| `apps/hub-api/src/contabilidad/router.pagos.test.ts` | **nuevo** |
| `apps/contabilidad/src/api.ts` | tipos espejo + `fetchPagosPorSemana` |
| `apps/contabilidad/src/PagosPorSemana.tsx` | **nuevo**: la pestaña |
| `apps/contabilidad/src/PagosPorSemana.test.tsx` | **nuevo** |
| `apps/contabilidad/src/App.tsx` | tercera pestaña |

## Reglas para todas las tareas

- Comandos en Bash (Git Bash), desde la raíz del repo. **Ficheros solo con Write/Edit**:
  en este equipo PowerShell 5.1 corrompe las tildes con `Set-Content`.
- Tests de hub-api: `npm run test --workspace=apps/hub-api -- <ruta>`. **Nunca
  `npx vitest run apps/hub-api` desde la raíz**: se salta la config que excluye los
  `*.db.test.ts` y salen ~281 fallos falsos.
- Tests de contabilidad: `npm run test --workspace=apps/contabilidad -- <ruta>`.
- Git: añadir ficheros **por ruta**, nunca `git add -A`/`git add .` (hay cambios ajenos
  sin seguimiento en el árbol). Commits convencionales en español, **sin línea
  `Co-Authored-By` ni atribución de IA**. No empujar hasta la Tarea 8.

---

## Tarea 0: Verificación previa contra la base real (la ejecuta el usuario)

El diseño suma `amount` como pesos. Si hubiera pagos en otra moneda, el total de la
semana mezclaría monedas — el mismo tipo de error que ya pasó con los anticipos.

- [ ] **Paso 1:** en la consola de EasyPanel, primero solo `\c zoho-hub`, después:

```sql
SELECT currency_code, count(*) AS pagos, count(*) FILTER (WHERE date IS NULL) AS sin_fecha
  FROM books.customer_payments
 GROUP BY 1
 ORDER BY 2 DESC;
```

- [ ] **Paso 2:** evaluar.
  - Solo `COP` → seguir.
  - Aparece otra moneda → **PARAR y volver al usuario**: hay que decidir si se muestra
    la moneda por pago y se separan los totales.
  - `sin_fecha > 0` → seguir; esos pagos se descartan (sin fecha no tienen semana) y el
    código lo documenta.

---

## Tarea 1: `semanaDelMes` y `rangoDeSemana`

**Ficheros:**
- Crear: `apps/hub-api/src/contabilidad/pagos.ts`
- Test: `apps/hub-api/src/contabilidad/pagos.test.ts`

Fechas comprobadas: el 1-sep-2026 es martes, el 1-mar-2026 domingo, el 1-feb-2027 lunes
(febrero 2027 tiene 28 días).

- [ ] **Paso 1: Escribir el test.** Crear `pagos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { semanaDelMes, rangoDeSemana } from './pagos.js';

// Regla aprobada (2026-10-01): la semana empieza en lunes; la semana 1 va del día 1 al
// primer domingo, aunque quede corta; puede haber hasta 6 semanas.
describe('semanaDelMes', () => {
  it.each([
    // septiembre 2026: empieza en martes, 30 días
    ['2026-09-01', 1], ['2026-09-06', 1], ['2026-09-07', 2], ['2026-09-13', 2],
    ['2026-09-14', 3], ['2026-09-27', 4], ['2026-09-28', 5], ['2026-09-30', 5],
    // febrero 2027: empieza en lunes, 28 días → exactamente 4 semanas
    ['2027-02-01', 1], ['2027-02-07', 1], ['2027-02-08', 2], ['2027-02-28', 4],
    // marzo 2026: empieza en domingo → semana 1 de un solo día, y semana 6
    ['2026-03-01', 1], ['2026-03-02', 2], ['2026-03-29', 5], ['2026-03-30', 6], ['2026-03-31', 6],
  ])('%s → semana %i', (fecha, semana) => {
    const [anio, mes] = fecha.split('-').map(Number);
    expect(semanaDelMes(fecha)).toEqual({ anio, mes, semana });
  });
});

describe('rangoDeSemana', () => {
  it.each([
    [2026, 9, 1, '2026-09-01', '2026-09-06', '1-6 sep 2026'],
    [2026, 9, 2, '2026-09-07', '2026-09-13', '7-13 sep 2026'],
    [2026, 9, 5, '2026-09-28', '2026-09-30', '28-30 sep 2026'],
    [2026, 3, 1, '2026-03-01', '2026-03-01', '1 mar 2026'],
    [2026, 3, 6, '2026-03-30', '2026-03-31', '30-31 mar 2026'],
    [2027, 2, 4, '2027-02-22', '2027-02-28', '22-28 feb 2027'],
  ])('%i-%i semana %i → %s a %s', (anio, mes, semana, desde, hasta, etiqueta) => {
    expect(rangoDeSemana(anio, mes, semana)).toEqual({ desde, hasta, etiqueta });
  });
});
```

- [ ] **Paso 2: Crear el módulo con funciones vacías**, para que el fallo sea de aserción.
  Crear `pagos.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';

// Pagos de clientes agrupados por semana del mes, para la pestaña «Pagos recibidos» de
// Contabilidad. Toda la lógica de semanas vive aquí, en funciones puras: SQL solo trae
// las filas.

export interface SemanaDelMes {
  anio: number;
  mes: number;    // 1-12
  semana: number; // 1-6
}

export function semanaDelMes(_fecha: string): SemanaDelMes {
  return { anio: 0, mes: 0, semana: 0 };
}

export function rangoDeSemana(_anio: number, _mes: number, _semana: number): { desde: string; hasta: string; etiqueta: string } {
  return { desde: '', hasta: '', etiqueta: '' };
}
```

- [ ] **Paso 3: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/pagos.test.ts`
Expected: FAIL en las 23 filas (17 de `semanaDelMes`, 6 de `rangoDeSemana`), todas por
aserción. (`tsc` avisaría de que `Pool` no se usa todavía; vitest no comprueba tipos.)

- [ ] **Paso 4: Implementar.** Sustituir las dos funciones vacías por:

```ts
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Día de la semana del día 1 del mes, 0=lunes … 6=domingo. En UTC a propósito: el
// servidor corre en UTC y las fechas llegan como 'AAAA-MM-DD' sin hora, así que no hay
// zona horaria que pueda mover el día.
function diaIsoDelDia1(anio: number, mes: number): number {
  return (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

const dos = (n: number) => String(n).padStart(2, '0');

/**
 * Semana del mes de una fecha 'AAAA-MM-DD'. Regla aprobada el 2026-10-01: la semana empieza
 * en lunes; la semana 1 va del día 1 al primer domingo aunque quede corta, y un mes de 30
 * días que empieza en domingo (o de 31 que empieza en sábado o domingo) llega a semana 6.
 */
export function semanaDelMes(fecha: string): SemanaDelMes {
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number);
  return { anio, mes, semana: Math.floor((dia - 1 + diaIsoDelDia1(anio, mes)) / 7) + 1 };
}

/** Primer y último día de una semana del mes, y su etiqueta legible («1-6 sep 2026»). */
export function rangoDeSemana(anio: number, mes: number, semana: number): { desde: string; hasta: string; etiqueta: string } {
  const iso = diaIsoDelDia1(anio, mes);
  const diaDesde = Math.max(1, 7 * (semana - 1) - iso + 1);
  const diaHasta = Math.min(7 * semana - iso, diasDelMes(anio, mes));
  const dias = diaDesde === diaHasta ? `${diaDesde}` : `${diaDesde}-${diaHasta}`;
  return {
    desde: `${anio}-${dos(mes)}-${dos(diaDesde)}`,
    hasta: `${anio}-${dos(mes)}-${dos(diaHasta)}`,
    etiqueta: `${dias} ${MESES[mes - 1]} ${anio}`,
  };
}
```

- [ ] **Paso 5: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/pagos.test.ts`
Expected: PASS, 23/23.

- [ ] **Paso 6: Commit.**

```bash
git add apps/hub-api/src/contabilidad/pagos.ts apps/hub-api/src/contabilidad/pagos.test.ts
git commit -m "feat(contabilidad): semana del mes de un pago (lunes a domingo, hasta 6 semanas)"
```

---

## Tarea 2: `agruparPagos`

**Ficheros:**
- Modificar: `apps/hub-api/src/contabilidad/pagos.ts`
- Test: `apps/hub-api/src/contabilidad/pagos.test.ts`

- [ ] **Paso 1: Escribir los tests.** En `pagos.test.ts`, sustituir el import por:

```ts
import { semanaDelMes, rangoDeSemana, agruparPagos, type FilaPago } from './pagos.js';
```

y añadir al final:

```ts
// Una fila SQL por (pago, factura aplicada). Caso real: PC-2026-276 de SHI, que pagó
// ANT-2026-061 / AM1492 de OV-2026-162. Los numéricos de pg llegan como texto.
const fila = (over: Partial<FilaPago>): FilaPago => ({
  payment_id: 'p1', payment_number: 'PC-2026-276', customer_name: 'SHI', fecha: '2026-09-02',
  payment_mode: 'Transferencia bancaria', reference_number: null,
  amount: '1500', unused_amount: '0',
  invoice_number: 'AM1492', amount_applied: '1000', salesorder_number: 'OV-2026-162',
  ...over,
});

describe('agruparPagos', () => {
  it('un pago aplicado a dos facturas es UN pago con dos aplicaciones, sin duplicar el importe', () => {
    const r = agruparPagos([
      fila({}),
      fila({ invoice_number: 'AM1500', amount_applied: '500', salesorder_number: null }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cantidadPagos: 1, totalCobrado: 1500 });
    expect(r[0].pagos[0].aplicaciones).toEqual([
      { factura: 'AM1492', ov: 'OV-2026-162', importe: 1000 },
      { factura: 'AM1500', ov: null, importe: 500 },
    ]);
  });

  it('un pago sin ninguna aplicación sigue apareciendo, con su saldo sin aplicar', () => {
    const r = agruparPagos([
      fila({ invoice_number: null, amount_applied: null, salesorder_number: null, unused_amount: '1500' }),
    ]);
    expect(r[0].pagos[0]).toMatchObject({ importe: 1500, sinAplicar: 1500, aplicaciones: [] });
  });

  it('arma la semana con su rango y su etiqueta', () => {
    const r = agruparPagos([fila({})]);
    expect(r[0]).toMatchObject({
      anio: 2026, mes: 9, semana: 1, desde: '2026-09-01', hasta: '2026-09-06', etiqueta: '1-6 sep 2026',
    });
  });

  it('dos pagos de la misma semana suman y cuentan; el más reciente primero', () => {
    const r = agruparPagos([
      fila({ payment_id: 'p1', payment_number: 'PC-1', fecha: '2026-09-02', amount: '100' }),
      fila({ payment_id: 'p2', payment_number: 'PC-2', fecha: '2026-09-05', amount: '200' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ cantidadPagos: 2, totalCobrado: 300 });
    expect(r[0].pagos.map((p) => p.numero)).toEqual(['PC-2', 'PC-1']);
  });

  it('las semanas van de la más reciente a la más antigua, también entre meses', () => {
    const r = agruparPagos([
      fila({ payment_id: 'p1', fecha: '2026-08-31' }),
      fila({ payment_id: 'p2', fecha: '2026-09-15' }),
      fila({ payment_id: 'p3', fecha: '2026-09-01' }),
    ]);
    expect(r.map((s) => `${s.mes}-${s.semana}`)).toEqual(['9-3', '9-1', '8-6']);
  });

  it('un pago sin fecha se descarta: no tiene semana a la que pertenecer', () => {
    expect(agruparPagos([fila({ fecha: null })])).toEqual([]);
  });
});
```

(31-ago-2026 es lunes, día 31 de un agosto que empieza en sábado: semana 6. El test de
orden entre meses lo comprueba de paso.)

- [ ] **Paso 2: Añadir los tipos y un `agruparPagos` vacío** al final de `pagos.ts`:

```ts
/** Una fila de la consulta: un pago × una factura aplicada (o ninguna). */
export interface FilaPago {
  payment_id: string;
  payment_number: string | null;
  customer_name: string | null;
  fecha: string | null;
  payment_mode: string | null;
  reference_number: string | null;
  amount: number | string | null;          // numeric de pg llega como texto
  unused_amount: number | string | null;
  invoice_number: string | null;           // null: el pago no se aplicó a ninguna factura
  amount_applied: number | string | null;
  salesorder_number: string | null;        // null: la factura no tiene OV enlazada
}

export interface AplicacionPago {
  factura: string;
  ov: string | null;
  importe: number;
}

export interface Pago {
  numero: string;
  cliente: string;
  fecha: string;
  modo: string | null;
  referencia: string | null;
  importe: number;
  sinAplicar: number;
  aplicaciones: AplicacionPago[];
}

export interface SemanaDePagos extends SemanaDelMes {
  etiqueta: string;
  desde: string;
  hasta: string;
  cantidadPagos: number;
  totalCobrado: number;
  pagos: Pago[];
}

export function agruparPagos(_filas: FilaPago[]): SemanaDePagos[] {
  return [];
}
```

- [ ] **Paso 3: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/pagos.test.ts`
Expected: FAIL en 5 de los 6 tests nuevos. «un pago sin fecha se descarta» pasa ya, porque
el stub devuelve `[]` siempre; morderá con la implementación real. Los 23 de la Tarea 1
siguen en verde.

- [ ] **Paso 4: Implementar.** Sustituir el `agruparPagos` vacío por:

```ts
function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Filas SQL (pago × factura) → semanas con sus pagos. Un pago aparece UNA vez aunque se
 * aplicara a varias facturas, y aparece aunque no se aplicara a ninguna: es justo lo que la
 * pestaña tiene que dejar ver. La semana sale de la fecha del PAGO (pagos recibidos), no de
 * la de cada aplicación. Más reciente primero, en las semanas y dentro de cada semana. Pura.
 */
export function agruparPagos(filas: FilaPago[]): SemanaDePagos[] {
  const pagos = new Map<string, Pago>();
  for (const f of filas) {
    if (!f.fecha) continue; // sin fecha no hay semana a la que asignarlo
    let p = pagos.get(f.payment_id);
    if (!p) {
      p = {
        numero: f.payment_number ?? '',
        cliente: f.customer_name ?? '',
        fecha: f.fecha.slice(0, 10),
        modo: f.payment_mode,
        referencia: f.reference_number,
        importe: num(f.amount),
        sinAplicar: num(f.unused_amount),
        aplicaciones: [],
      };
      pagos.set(f.payment_id, p);
    }
    if (f.invoice_number) {
      p.aplicaciones.push({ factura: f.invoice_number, ov: f.salesorder_number, importe: num(f.amount_applied) });
    }
  }

  const semanas = new Map<string, SemanaDePagos>();
  for (const p of pagos.values()) {
    const { anio, mes, semana } = semanaDelMes(p.fecha);
    const clave = `${anio}-${mes}-${semana}`;
    let s = semanas.get(clave);
    if (!s) {
      s = { anio, mes, semana, ...rangoDeSemana(anio, mes, semana), cantidadPagos: 0, totalCobrado: 0, pagos: [] };
      semanas.set(clave, s);
    }
    s.pagos.push(p);
    s.cantidadPagos += 1;
    s.totalCobrado += p.importe;
  }

  for (const s of semanas.values()) {
    s.pagos.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.numero.localeCompare(a.numero));
  }
  return [...semanas.values()].sort((a, b) => b.desde.localeCompare(a.desde));
}
```

- [ ] **Paso 5: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/pagos.test.ts`
Expected: PASS, 29/29.

- [ ] **Paso 6: Comprobar que el guarda de la fecha muerde.** Cambiar temporalmente
  `if (!f.fecha) continue;` por `if (!f.fecha) f.fecha = '2026-01-01';`, ejecutar el mismo
  comando: debe FALLAR «un pago sin fecha se descarta». **Restaurar la línea original** y
  volver a ejecutar: PASS.

- [ ] **Paso 7: Commit.**

```bash
git add apps/hub-api/src/contabilidad/pagos.ts apps/hub-api/src/contabilidad/pagos.test.ts
git commit -m "feat(contabilidad): agrupar los pagos recibidos por semana con sus aplicaciones"
```

---

## Tarea 3: `getPagosPorSemana` (lectura de la base)

**Ficheros:**
- Modificar: `apps/hub-api/src/contabilidad/pagos.ts`
- Test: `apps/hub-api/src/contabilidad/pagos.test.ts`

- [ ] **Paso 1: Escribir el test.** Sustituir los imports de `pagos.test.ts` por:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { semanaDelMes, rangoDeSemana, agruparPagos, getPagosPorSemana, type FilaPago } from './pagos.js';
```

y añadir al final:

```ts
describe('getPagosPorSemana', () => {
  it('una sola consulta, con LEFT JOIN para no perder los pagos sin aplicar', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [
      fila({}),
      fila({ payment_id: 'p2', payment_number: 'PC-2', invoice_number: null, amount_applied: null, salesorder_number: null }),
    ] });
    const r = await getPagosPorSemana({ query } as unknown as Pool);
    expect(query).toHaveBeenCalledTimes(1);
    // La decisión de diseño que importa: un JOIN normal haría desaparecer el pago sin
    // aplicar, que es justo lo que la pestaña tiene que enseñar.
    expect(query.mock.calls[0][0]).toMatch(/LEFT JOIN books\.customer_payment_invoices/);
    expect(r[0].pagos.map((p) => p.numero).sort()).toEqual(['PC-2', 'PC-2026-276']);
  });
});
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/pagos.test.ts`
Expected: FAIL en el test nuevo: `getPagosPorSemana is not a function`.

- [ ] **Paso 3: Implementar.** Añadir al final de `pagos.ts`:

```ts
// LEFT JOIN desde customer_payments, no JOIN: un pago con todo el saldo sin aplicar no
// tiene filas en customer_payment_invoices y desaparecería. El salto a la OV va por
// invoices.salesorder_id (poblado al 100%, ver source.ts), no por reference_number.
const PAGOS_SQL = `
  SELECT p.payment_id,
         p.payment_number,
         p.customer_name,
         p.date::text          AS fecha,
         p.payment_mode,
         p.reference_number,
         p.amount,
         p.unused_amount,
         cpi.invoice_number,
         cpi.amount_applied,
         so.salesorder_number
    FROM books.customer_payments p
    LEFT JOIN books.customer_payment_invoices cpi ON cpi.payment_id = p.payment_id
    LEFT JOIN books.invoices i ON i.invoice_id = cpi.invoice_id
    LEFT JOIN books.sales_orders so ON so.salesorder_id = i.salesorder_id
   ORDER BY p.date, p.payment_number, cpi.invoice_number`;

/** Lee todos los pagos con sus aplicaciones y los agrupa por semana del mes. */
export async function getPagosPorSemana(db: Pool): Promise<SemanaDePagos[]> {
  const { rows } = await db.query(PAGOS_SQL);
  return agruparPagos(rows as FilaPago[]);
}
```

- [ ] **Paso 4: Ejecutar y ver el verde.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/pagos.test.ts`
Expected: PASS, 30/30.

- [ ] **Paso 5: Portón de tipos.**

Run: `npm run build --workspace=apps/hub-api`
Expected: `tsc -b` sin errores.

- [ ] **Paso 6: Commit.**

```bash
git add apps/hub-api/src/contabilidad/pagos.ts apps/hub-api/src/contabilidad/pagos.test.ts
git commit -m "feat(contabilidad): leer los pagos recibidos con sus facturas y OV"
```

---

## Tarea 4: Endpoint `GET /contabilidad/pagos`

**Ficheros:**
- Modificar: `apps/hub-api/src/contabilidad/router.ts`
- Test: crear `apps/hub-api/src/contabilidad/router.pagos.test.ts`

Fichero de test aparte porque simula `./pagos.js`, igual que `router.anticipos.test.ts`
simula `./anticipos.js`.

- [ ] **Paso 1: Escribir el test.** Crear `router.pagos.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Pool } from '@algarpibe/zoho-sync';
import { clearCache } from '../cache.js';

// Mismo arranque que router.anticipos.test.ts: auth.ts lee JWT_SECRET AL CARGAR, así que el
// env se fija antes de importar el router, y el router se importa dinámicamente en beforeAll.
const SECRET = 'test-secret-pagos';
process.env.JWT_SECRET = SECRET;
process.env.AUTH_USERS = '';

// requireAuth consulta la BD y PISA role/apps con lo que diga la fila.
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

const SEMANA = {
  anio: 2026, mes: 9, semana: 1, etiqueta: '1-6 sep 2026', desde: '2026-09-01', hasta: '2026-09-06',
  cantidadPagos: 1, totalCobrado: 1000,
  pagos: [{ numero: 'PC-1', cliente: 'SHI', fecha: '2026-09-02', modo: null, referencia: null, importe: 1000, sinAplicar: 0, aplicaciones: [] }],
};
const pagosMock = vi.hoisted(() => ({ falla: false }));
vi.mock('./pagos.js', () => ({
  getPagosPorSemana: vi.fn(async () => {
    if (pagosMock.falla) throw new Error('relation "books.customer_payments" does not exist');
    return [SEMANA];
  }),
}));

let createContabilidadRouter: typeof import('./router.js')['createContabilidadRouter'];
beforeAll(async () => {
  ({ createContabilidadRouter } = await import('./router.js'));
});

// La caché del router es de módulo y dura 120 s: sin limpiarla, un test vería lo del anterior.
beforeEach(() => {
  clearCache();
  pagosMock.falla = false;
});

const USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
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

const get = (apps: string[], role = 'reader') =>
  request(app()).get('/api/contabilidad/pagos').set('Authorization', `Bearer ${token(apps, role)}`);

describe('GET /contabilidad/pagos', () => {
  it('401 sin token', async () => {
    const res = await request(app()).get('/api/contabilidad/pagos');
    expect(res.status).toBe(401);
  });

  it('403 con SOLO ov-pendientes: es información de cobro', async () => {
    const res = await get(['ov-pendientes']);
    expect(res.status).toBe(403);
  });

  it('200 con Contabilidad y devuelve las semanas', async () => {
    const res = await get(['contabilidad']);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ semanas: [SEMANA] });
  });

  it('un admin sin la app también entra: misma regla que requireApp', async () => {
    const res = await get([], 'admin');
    expect(res.status).toBe(200);
  });

  it('si la lectura falla responde 500', async () => {
    pagosMock.falla = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(['contabilidad']);
    spy.mockRestore();
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Paso 2: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad/router.pagos.test.ts`
Expected: FAIL en los 5, todos con 404: la ruta no existe, y `requireAuth` es middleware
de ruta, así que sin ruta ni siquiera llega a responder 401.

- [ ] **Paso 3: Implementar.** En `router.ts`, añadir a los imports:

```ts
import { getPagosPorSemana } from './pagos.js';
```

y justo antes de `return router;`:

```ts
  // Pagos recibidos por semana del mes, con las facturas y OV a las que se aplicaron. Solo
  // Contabilidad: es información de cobro, igual que los anticipos. Endpoint propio, así que
  // un fallo aquí no arrastra a ninguna otra respuesta: basta con el 500 normal.
  router.get('/contabilidad/pagos', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try {
      const semanas = await cached('contabilidad:pagos', () => getPagosPorSemana(db));
      res.json({ semanas });
    } catch (e) {
      sendError(res, e, 'contabilidad_pagos');
    }
  });
```

- [ ] **Paso 4: Ejecutar y ver el verde, con el resto de contabilidad.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad`
Expected: PASS en todos los ficheros de `src/contabilidad`.

- [ ] **Paso 5: Comprobar que la guarda muerde.** Cambiar temporalmente
  `requireApp(APP_ID)` de esta ruta por `requireApp(APP_ID, 'ov-pendientes')` y ejecutar
  `npm run test --workspace=apps/hub-api -- src/contabilidad/router.pagos.test.ts`: debe
  FALLAR «403 con SOLO ov-pendientes». **Restaurar** y volver a ejecutar: PASS.

- [ ] **Paso 6: Portón de tipos.**

Run: `npm run build --workspace=apps/hub-api`
Expected: sin errores.

- [ ] **Paso 7: Commit.**

```bash
git add apps/hub-api/src/contabilidad/router.ts apps/hub-api/src/contabilidad/router.pagos.test.ts
git commit -m "feat(contabilidad): endpoint de pagos recibidos por semana, solo para Contabilidad"
```

---

## Tarea 5: Tipos y cliente de la API en el portal

**Ficheros:**
- Modificar: `apps/contabilidad/src/api.ts`

Solo tipos y una función con el mismo patrón que las demás; su comportamiento lo cubre la
Tarea 6 a través del componente.

- [ ] **Paso 1:** Añadir al final de `api.ts`:

```ts
/** Espejo de apps/hub-api/src/contabilidad/pagos.ts */
export interface AplicacionPago {
  factura: string;
  ov: string | null;
  importe: number;
}

export interface Pago {
  numero: string;
  cliente: string;
  fecha: string;
  modo: string | null;
  referencia: string | null;
  importe: number;
  sinAplicar: number;
  aplicaciones: AplicacionPago[];
}

export interface SemanaDePagos {
  anio: number;
  mes: number;
  semana: number;
  etiqueta: string;
  desde: string;
  hasta: string;
  cantidadPagos: number;
  totalCobrado: number;
  pagos: Pago[];
}

/** Pagos recibidos agrupados por semana del mes. Solo Contabilidad; lanza si falla. */
export async function fetchPagosPorSemana(): Promise<SemanaDePagos[]> {
  const res = await fetch(`${API_BASE}/api/contabilidad/pagos`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const data = (await res.json()) as { semanas?: SemanaDePagos[] };
  if (!Array.isArray(data.semanas)) throw new Error('Formato inesperado del hub (pagos).');
  return data.semanas;
}
```

- [ ] **Paso 2: Portón de tipos.**

Run: `npm run build --workspace=apps/portal`
Expected: `tsc -b && vite build` sin errores.

- [ ] **Paso 3: Commit.**

```bash
git add apps/contabilidad/src/api.ts
git commit -m "feat(contabilidad): tipos y cliente de los pagos por semana"
```

---

## Tarea 6: Componente `PagosPorSemana`

**Ficheros:**
- Crear: `apps/contabilidad/src/PagosPorSemana.tsx`
- Test: `apps/contabilidad/src/PagosPorSemana.test.tsx`

- [ ] **Paso 1: Escribir el test.** Crear `PagosPorSemana.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PagosPorSemana from './PagosPorSemana';
import { fetchPagosPorSemana, type SemanaDePagos } from './api';
import { formatCOP } from './format';

vi.mock('./api', () => ({ fetchPagosPorSemana: vi.fn() }));
const mockFetch = fetchPagosPorSemana as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

const semana = (over: Partial<SemanaDePagos>): SemanaDePagos => ({
  anio: 2026, mes: 9, semana: 1, etiqueta: '1-6 sep 2026', desde: '2026-09-01', hasta: '2026-09-06',
  cantidadPagos: 1, totalCobrado: 11150331,
  pagos: [{
    numero: 'PC-2026-276', cliente: 'SHI', fecha: '2026-09-02', modo: 'Transferencia bancaria',
    referencia: null, importe: 11150331, sinAplicar: 0,
    aplicaciones: [{ factura: 'AM1492', ov: 'OV-2026-162', importe: 11150331 }],
  }],
  ...over,
});

describe('PagosPorSemana', () => {
  it('las semanas llegan plegadas y el detalle aparece al desplegar', async () => {
    mockFetch.mockResolvedValue([semana({})]);
    render(<PagosPorSemana />);
    const boton = await screen.findByRole('button', { name: /Semana 1 · 1-6 sep 2026/ });
    expect(screen.queryByText('PC-2026-276')).toBeNull();
    fireEvent.click(boton);
    expect(screen.getByText('PC-2026-276')).toBeInTheDocument();
    expect(screen.getByText(/AM1492 \(OV-2026-162\)/)).toBeInTheDocument();
  });

  it('un pago sin aplicar enseña su saldo pendiente', async () => {
    mockFetch.mockResolvedValue([semana({
      totalCobrado: 800000,
      pagos: [{
        numero: 'PC-9', cliente: 'Secolab', fecha: '2026-09-03', modo: null, referencia: null,
        importe: 800000, sinAplicar: 500000, aplicaciones: [],
      }],
    })]);
    render(<PagosPorSemana />);
    fireEvent.click(await screen.findByRole('button', { name: /Semana 1/ }));
    expect(screen.getByText(formatCOP(500000))).toBeInTheDocument();
  });

  it('se pueden tener varias semanas abiertas a la vez', async () => {
    mockFetch.mockResolvedValue([
      semana({ semana: 2, etiqueta: '7-13 sep 2026', pagos: [{ ...semana({}).pagos[0], numero: 'PC-A' }] }),
      semana({ semana: 1, etiqueta: '1-6 sep 2026', pagos: [{ ...semana({}).pagos[0], numero: 'PC-B' }] }),
    ]);
    render(<PagosPorSemana />);
    fireEvent.click(await screen.findByRole('button', { name: /Semana 2/ }));
    fireEvent.click(screen.getByRole('button', { name: /Semana 1/ }));
    expect(screen.getByText('PC-A')).toBeInTheDocument();
    expect(screen.getByText('PC-B')).toBeInTheDocument();
  });

  it('si la petición falla enseña el error', async () => {
    mockFetch.mockRejectedValue(new Error('No tienes acceso a esta información.'));
    render(<PagosPorSemana />);
    expect(await screen.findByText(/No tienes acceso a esta información\./)).toBeInTheDocument();
  });

  it('sin pagos lo dice', async () => {
    mockFetch.mockResolvedValue([]);
    render(<PagosPorSemana />);
    expect(await screen.findByText('No hay pagos registrados.')).toBeInTheDocument();
  });
});
```

- [ ] **Paso 2: Crear un componente vacío**, para que el fallo sea de aserción. Crear
  `PagosPorSemana.tsx`:

```tsx
export default function PagosPorSemana() {
  return null;
}
```

- [ ] **Paso 3: Ejecutar y ver el fallo.**

Run: `npm run test --workspace=apps/contabilidad -- src/PagosPorSemana.test.tsx`
Expected: FAIL en los 5 (el stub no pinta nada, así que todos los `findBy…` agotan su
espera).

- [ ] **Paso 4: Implementar.** Sustituir `PagosPorSemana.tsx` entero por:

```tsx
import { Fragment, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { fetchPagosPorSemana, type SemanaDePagos } from './api';
import { formatCOP } from './format';

const claveDe = (s: SemanaDePagos) => `${s.anio}-${s.mes}-${s.semana}`;

/**
 * Pagos recibidos agrupados por semana del mes, de la más reciente a la más antigua. Cada
 * semana se despliega para ver sus pagos y a qué facturas (y OV) se aplicó cada uno. Todas
 * llegan plegadas: son siete años de historia.
 */
export default function PagosPorSemana() {
  const [semanas, setSemanas] = useState<SemanaDePagos[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Un Set y no un booleano: a diferencia del aviso de anticipos, aquí puede haber varias
  // semanas abiertas a la vez.
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let vivo = true;
    fetchPagosPorSemana()
      .then((s) => { if (vivo) setSemanas(s); })
      .catch((e: Error) => { if (vivo) setError(e.message); });
    return () => { vivo = false; };
  }, []);

  const alternar = (clave: string) =>
    setAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(clave)) sig.delete(clave);
      else sig.add(clave);
      return sig;
    });

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!semanas) {
    return <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Cargando pagos…</div>;
  }
  if (semanas.length === 0) return <p className="text-sm text-gray-500">No hay pagos registrados.</p>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-soft">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-2 py-2 text-left font-semibold">PERIODO</th>
            <th className="px-2 py-2 text-right font-semibold">PAGOS</th>
            <th className="px-2 py-2 text-right font-semibold">TOTAL COBRADO</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {semanas.map((s) => {
            const clave = claveDe(s);
            const abierta = abiertas.has(clave);
            return (
              <Fragment key={clave}>
                <tr className="hover:bg-gray-50">
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => alternar(clave)}
                      aria-expanded={abierta}
                      className="flex items-center gap-1.5 font-medium text-gray-800"
                    >
                      {abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      Semana {s.semana} · {s.etiqueta}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.cantidadPagos}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCOP(s.totalCobrado)}</td>
                </tr>
                {abierta && (
                  <tr>
                    <td colSpan={3} className="bg-gray-50/60 px-3 py-2">
                      <table className="min-w-full text-xs">
                        <thead className="text-gray-500">
                          <tr>
                            <th className="px-2 py-1 text-left font-medium">PAGO</th>
                            <th className="px-2 py-1 text-left font-medium">CLIENTE</th>
                            <th className="px-2 py-1 text-left font-medium">FECHA</th>
                            <th className="px-2 py-1 text-left font-medium">MODO</th>
                            <th className="px-2 py-1 text-right font-medium">IMPORTE</th>
                            <th className="px-2 py-1 text-left font-medium">APLICADO A</th>
                            <th className="px-2 py-1 text-right font-medium">SIN APLICAR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.pagos.map((p) => (
                            <tr key={p.numero} className="align-top">
                              <td className="whitespace-nowrap px-2 py-1 font-medium">{p.numero}</td>
                              <td className="px-2 py-1">{p.cliente || '—'}</td>
                              <td className="whitespace-nowrap px-2 py-1">{p.fecha}</td>
                              <td className="px-2 py-1">{p.modo ?? '—'}</td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">{formatCOP(p.importe)}</td>
                              <td className="px-2 py-1">
                                {p.aplicaciones.length === 0
                                  ? '—'
                                  : p.aplicaciones.map((a) => (
                                      <div key={a.factura}>
                                        {a.factura}{a.ov ? ` (${a.ov})` : ''}: {formatCOP(a.importe)}
                                      </div>
                                    ))}
                              </td>
                              <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                                {p.sinAplicar > 0 ? formatCOP(p.sinAplicar) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Paso 5: Ejecutar y ver el verde, con el resto de la app.**

Run: `npm run test --workspace=apps/contabilidad`
Expected: PASS en todos los ficheros, incluidos los 5 nuevos.

- [ ] **Paso 6: Commit.**

```bash
git add apps/contabilidad/src/PagosPorSemana.tsx apps/contabilidad/src/PagosPorSemana.test.tsx
git commit -m "feat(contabilidad): tabla de pagos recibidos por semana, plegable"
```

---

## Tarea 7: La pestaña en `App.tsx`

**Ficheros:**
- Modificar: `apps/contabilidad/src/App.tsx`

- [ ] **Paso 1: Import.** Añadir tras `import AnticiposAtencion from './AnticiposAtencion';`:

```tsx
import PagosPorSemana from './PagosPorSemana';
```

- [ ] **Paso 2: Tipo del estado.** Sustituir:

```tsx
  const [tab, setTab] = useState<'facturacion' | 'ov'>('facturacion');
```

por:

```tsx
  const [tab, setTab] = useState<'facturacion' | 'ov' | 'pagos'>('facturacion');
```

- [ ] **Paso 3: Botón.** Sustituir:

```tsx
        {([['facturacion', 'Facturación'], ['ov', 'OV pendientes de facturar']] as const).map(([k, label]) => (
```

por:

```tsx
        {([['facturacion', 'Facturación'], ['ov', 'OV pendientes de facturar'], ['pagos', 'Pagos recibidos']] as const).map(([k, label]) => (
```

- [ ] **Paso 4: Contenido.** Añadir justo después del bloque
  `<div className={tab === 'ov' ? '' : 'hidden'}> … </div>` (antes de
  `{detalleFactura && (`):

```tsx
      <div className={tab === 'pagos' ? '' : 'hidden'}>
        <PagosPorSemana />
      </div>
```

- [ ] **Paso 5: Portón de tipos.**

Run: `npm run build --workspace=apps/portal`
Expected: sin errores.

- [ ] **Paso 6: Commit.**

```bash
git add apps/contabilidad/src/App.tsx
git commit -m "feat(contabilidad): pestaña Pagos recibidos"
```

---

## Tarea 8: Portones, despliegue y comprobación en producción

- [ ] **Paso 1: Portones.**

Run: `npm run test --workspace=apps/hub-api -- src/contabilidad`
Expected: PASS.

Run: `npm run build --workspace=apps/hub-api`
Expected: sin errores.

Run: `npm run test --workspace=apps/contabilidad`
Expected: PASS.

Run: `npm run build --workspace=apps/portal`
Expected: sin errores.

- [ ] **Paso 2: Empujar** (autorización permanente en este repo; empujar es desplegar).

```bash
git push origin main
```

- [ ] **Paso 3: El usuario redespliega en EasyPanel: hub-api, después portal.**

- [ ] **Paso 4: Comprobación contra la base real.** El usuario abre la pestaña y, en la
  consola (`\c zoho-hub` primero), corre la misma regla de semanas en SQL para septiembre
  2026:

```sql
SELECT ((extract(day from p.date)::int - 1 + extract(isodow from date_trunc('month', p.date))::int - 1) / 7) + 1 AS semana,
       count(*)      AS pagos,
       sum(p.amount) AS total
  FROM books.customer_payments p
 WHERE p.date >= '2026-09-01' AND p.date < '2026-10-01'
 GROUP BY 1
 ORDER BY 1;
```

Expected: el número de pagos y el total de cada semana coinciden con las filas «Semana N ·
… sep 2026» de la pestaña. Si alguna no cuadra, **PARAR** y comparar antes de tocar código.
