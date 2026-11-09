# WO-sales — DocumentoNúmero persistente: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la columna D (`DocumentoNúmero`) del archivo de World Office salga de una tabla
persistente: cada OV recibe un número una sola vez (OV-2026-212 = 38, congelada; la primera nueva, la 213, = 39) y lo conserva para siempre.

**Architecture:** Una tabla `portal.wo_sales_documento_numero` (migración 070) sembrada con 38 OV (las 37
ya cargadas en WO y la 212). Un repo asigna `MAX + 1` a las OV que aún no tienen número, en una
transacción con candado consultivo. El builder sigue puro: recibe un `Map<numeroOV, número>`.
Las cuatro vías que generan el archivo (preview, csv, xlsx, correo) asignan antes de construir.

**Tech Stack:** Express 4 + TypeScript ESM (imports con `.js`), `pg` vía `@algarpibe/zoho-sync`,
Vitest (unitarios en `vitest.config.ts`; contra Postgres real con Testcontainers en
`vitest.db.config.ts`).

**Spec:** `docs/superpowers/specs/2026-11-09-wo-sales-documento-numero-design.md`
**Rama:** `feat/wo-sales-documento-numero` (sale de `main`).

**Convenciones del repo que importan aquí:**
- Commits en conventional commits, en español, **sin** líneas `Co-Authored-By`.
- Los tests unitarios se corren **desde `apps/hub-api`**, nunca desde la raíz (desde la raíz
  Vitest recoge los `*.db.test.ts` y salen ~281 fallos falsos).
- Los `*.db.test.ts` necesitan Docker Desktop encendido (Testcontainers levanta `postgres:17`).
  Si Docker no está disponible, el job de CI `npm run test:db --workspace=apps/hub-api` los corre
  al empujar: no se marca la tarea como verificada sin ese resultado.
- `initDb()` re-ejecuta TODAS las migraciones en cada arranque: todo SQL de migración debe ser
  idempotente.

---

## Estructura de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `apps/hub-api/src/wo-sales/documento-numero.ts` | Crear | Puro: orden en que las OV sin número reciben el suyo. |
| `apps/hub-api/src/wo-sales/documento-numero.test.ts` | Crear | Unitarios del orden. |
| `apps/hub-api/src/users/migrations/070_wo_sales_documento_numero.sql` | Crear | Tabla + siembra de las 38 congeladas + permisos de `portal_app`. |
| `apps/hub-api/src/db.ts` | Modificar (línea 102, array `MIGRATIONS`) | Registrar la 070. |
| `apps/hub-api/src/wo-sales/documento-numero.repo.ts` | Crear | BD: `asignarDocumentoNumeros(db, numerosOV)`. |
| `apps/hub-api/src/wo-sales/documento-numero.db.test.ts` | Crear | Contra Postgres real: siembra, asignación, estabilidad, concurrencia. |
| `apps/hub-api/src/wo-sales/builder.ts` | Modificar (firma l.76, bloque l.221-234) | Escribir el número del mapa; lanzar si falta. |
| `apps/hub-api/src/wo-sales/config.ts` | Modificar (l.33-40, l.83-85) | Quitar `consecutivoInicial`. |
| `apps/hub-api/src/wo-sales/router.ts` | Modificar (l.142, 163, 199) | Asignar antes de construir. |
| `apps/hub-api/src/wo-sales/email.ts` | Modificar (l.79) | Asignar antes de construir. |
| `apps/hub-api/src/wo-sales/builder.test.ts` | Modificar | Pasar el mapa; tests nuevos de numeración. |
| `apps/hub-api/src/wo-sales/xlsx.test.ts` | Modificar (l.75) | Pasar el mapa. |
| `apps/hub-api/src/wo-sales/email.test.ts` | Modificar (fakeDb, `tokenActual`) | El doble responde a la consulta de `MAX`. |

---

### Task 1: Orden de asignación (puro)

**Files:**
- Create: `apps/hub-api/src/wo-sales/documento-numero.ts`
- Test: `apps/hub-api/src/wo-sales/documento-numero.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/wo-sales/documento-numero.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ordenarParaAsignar } from './documento-numero.js';

describe('ordenarParaAsignar', () => {
  it('ordena por año y consecutivo de la OV', () => {
    expect(ordenarParaAsignar(['OV-2026-213', 'OV-2025-199', 'OV-2026-212'])).toEqual([
      'OV-2025-199',
      'OV-2026-212',
      'OV-2026-213',
    ]);
  });

  it('compara el consecutivo como número, no como texto: la 999 va antes que la 1000', () => {
    expect(ordenarParaAsignar(['OV-2026-1000', 'OV-2026-999'])).toEqual(['OV-2026-999', 'OV-2026-1000']);
  });

  it('los números que no cumplen OV-AAAA-XXX van al final, en orden de texto', () => {
    expect(ordenarParaAsignar(['OV-2026-1000-01', 'OV-2026-005', 'ABC'])).toEqual([
      'OV-2026-005',
      'ABC',
      'OV-2026-1000-01',
    ]);
  });

  it('no modifica el arreglo que recibe', () => {
    const entrada = ['OV-2026-213', 'OV-2026-212'];
    ordenarParaAsignar(entrada);
    expect(entrada).toEqual(['OV-2026-213', 'OV-2026-212']);
  });
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `cd apps/hub-api && npx vitest run src/wo-sales/documento-numero.test.ts`
Expected: FAIL — `Failed to load url ./documento-numero.js` (el módulo no existe).

- [ ] **Step 3: Implementación mínima**

Crear `apps/hub-api/src/wo-sales/documento-numero.ts`:

```ts
/**
 * DocumentoNúmero persistente (§8.1). Lo puro de la numeración: en qué orden reciben su número
 * las OV que todavía no lo tienen. La parte de BD está en documento-numero.repo.ts.
 */

const NUMERO_OV = /^OV-(\d{4})-(\d+)$/i;

function clave(numeroOV: string): readonly [number, number] | null {
  const m = NUMERO_OV.exec(numeroOV.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function porTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orden de asignación: por año y consecutivo NUMÉRICOS de "OV-AAAA-XXX" (la OV-2026-999 antes que
 * la OV-2026-1000), para que en un lote la OV-2026-212 reciba su número antes que la 213. Lo que
 * no cumpla el patrón va al final, en orden de texto. Devuelve un arreglo nuevo.
 */
export function ordenarParaAsignar(numerosOV: readonly string[]): string[] {
  return [...numerosOV].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    if (ka && kb) return ka[0] - kb[0] || ka[1] - kb[1] || porTexto(a, b);
    if (ka) return -1;
    if (kb) return 1;
    return porTexto(a, b);
  });
}
```

- [ ] **Step 4: Correrlo y ver que pasa**

Run: `cd apps/hub-api && npx vitest run src/wo-sales/documento-numero.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/wo-sales/documento-numero.ts apps/hub-api/src/wo-sales/documento-numero.test.ts
git commit -m "feat(wo-sales): orden en que las OV reciben su DocumentoNúmero"
```

---

### Task 2: Migración 070 + repo de asignación (BD)

**Files:**
- Create: `apps/hub-api/src/users/migrations/070_wo_sales_documento_numero.sql`
- Modify: `apps/hub-api/src/db.ts:102` (array `MIGRATIONS`)
- Create: `apps/hub-api/src/wo-sales/documento-numero.repo.ts`
- Test: `apps/hub-api/src/wo-sales/documento-numero.db.test.ts`

- [ ] **Step 1: Comprobar que Docker está disponible**

Run: `docker version --format "{{.Server.Version}}"`
Expected: una versión (p. ej. `27.x`). Si falla, encender Docker Desktop y repetir. Si no se
puede, seguir con el resto de la tarea y dejar la verificación de los Steps 3 y 7 al job de CI
(anotarlo en el resumen final; NO darla por buena sin ese resultado).

- [ ] **Step 2: Escribir el test que falla**

Crear `apps/hub-api/src/wo-sales/documento-numero.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { asignarDocumentoNumeros } from './documento-numero.repo.js';
import { poolDePrueba } from '../test-db/harness.js';

// DocumentoNúmero persistente (§8.1) contra Postgres de verdad: la siembra de la migración, la
// asignación MAX + 1 y la carrera entre dos generaciones simultáneas solo se ven con el motor real.

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  // Las congeladas son de la migración y se conservan; se borra solo lo que asignan los tests
  // (email.db.test.ts también asigna, a su 'OV-1').
  await db.query(`DELETE FROM portal.wo_sales_documento_numero WHERE origen = 'asignado'`);
});

interface Fila {
  numero_ov: string;
  documento_numero: number;
  origen: string;
}

async function filas(): Promise<Fila[]> {
  const { rows } = await db.query(
    `SELECT numero_ov, documento_numero, origen FROM portal.wo_sales_documento_numero ORDER BY documento_numero`,
  );
  return rows as Fila[];
}

describe('migración 070: siembra del archivo del 31/10', () => {
  it('congela las 37 OV ya cargadas en WO más la 212, del 1 al 38 sin huecos', async () => {
    const congeladas = (await filas()).filter((f) => f.origen === 'congelado');
    expect(congeladas.map((f) => f.documento_numero)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1));
    expect(congeladas[0].numero_ov).toBe('OV-2022-105');
    expect(congeladas[36].numero_ov).toBe('OV-2026-211');
    expect(congeladas[37].numero_ov).toBe('OV-2026-212');
  });

  it('re-ejecutarla (initDb lo hace en cada arranque) no duplica ni cambia nada', async () => {
    const ruta = fileURLToPath(new URL('../users/migrations/070_wo_sales_documento_numero.sql', import.meta.url));
    await db.query(readFileSync(ruta, 'utf8'));
    const todas = await filas();
    expect(todas).toHaveLength(38);
    expect(todas[36]).toMatchObject({ numero_ov: 'OV-2026-211', documento_numero: 37 });
    expect(todas[37]).toMatchObject({ numero_ov: 'OV-2026-212', documento_numero: 38 });
  });
});

describe('asignarDocumentoNumeros', () => {
  it('una OV congelada conserva su número', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-211', 'OV-2026-212', 'OV-2025-030']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-211': 37, 'OV-2026-212': 38, 'OV-2025-030': 2 });
  });

  it('la primera OV nueva recibe el 39 (la 212 está congelada con el 38)', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-213']);
    expect(m.get('OV-2026-213')).toBe(39);
  });

  it('un lote se reparte por número de OV: la 213 antes que la 214', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-213', 'OV-2026-211']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-211': 37, 'OV-2026-213': 39, 'OV-2026-214': 40 });
  });

  it('pedir otra vez las mismas OV devuelve los mismos números sin crear filas', async () => {
    const primera = await asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-214']);
    const segunda = await asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-213']);
    expect(Object.fromEntries(segunda)).toEqual(Object.fromEntries(primera));
    expect((await filas()).filter((f) => f.origen === 'asignado')).toHaveLength(2);
  });

  it('una OV que sale del archivo (facturada) no libera su número', async () => {
    await asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-214']);
    // La 213 se facturó y ya no se pide; entra la 215.
    const m = await asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-215']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-214': 40, 'OV-2026-215': 41 });
  });

  it('dos asignaciones a la vez no repiten número ni dejan huecos', async () => {
    const [a, b] = await Promise.all([
      asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-214']),
      asignarDocumentoNumeros(db, ['OV-2026-214', 'OV-2026-215']),
    ]);
    expect(a.get('OV-2026-214')).toBe(b.get('OV-2026-214'));
    const nuevos = (await filas()).filter((f) => f.origen === 'asignado').map((f) => f.documento_numero);
    expect(nuevos).toEqual([39, 40, 41]);
  });

  it('un número de OV repetido en la entrada cuenta una sola vez', async () => {
    const m = await asignarDocumentoNumeros(db, ['OV-2026-213', 'OV-2026-213']);
    expect(Object.fromEntries(m)).toEqual({ 'OV-2026-213': 39 });
  });

  it('sin OV devuelve un mapa vacío y no crea filas', async () => {
    const m = await asignarDocumentoNumeros(db, []);
    expect(m.size).toBe(0);
    expect(await filas()).toHaveLength(38);
  });
});
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/wo-sales/documento-numero.db.test.ts`
Expected: FAIL — `Failed to load url ./documento-numero.repo.js` (el repo no existe).

- [ ] **Step 4: Crear la migración**

Crear `apps/hub-api/src/users/migrations/070_wo_sales_documento_numero.sql`:

```sql
-- Migration 070: DocumentoNúmero persistente e irrepetible de WO-sales (§8.1, ARQ-610).
--
-- El builder numeraba por POSICIÓN en cada archivo, desde 1: cada archivo chocaba con los
-- pedidos ya cargados en World Office, y cuando una OV salía del archivo (facturada) las de
-- detrás se corrían un número. Aquí cada OV recibe su número UNA vez y lo conserva para
-- siempre: las filas nunca se borran ni se modifican (por eso portal_app solo tiene SELECT e
-- INSERT). Un solo contador para todos los prefijos (OV_25, OV_26, OV_27…), que nunca se
-- reinicia: el siguiente es MAX + 1 (documento-numero.repo.ts), no una SEQUENCE, que gastaría
-- números en un INSERT que choca o se revierte.
--
-- Siembra: las 37 OV del archivo DocumentosVentasEncabezadosMovimientoInventarioWO_2026-10-31.xls
-- (lo que ya está cargado en WO), con el número que llevaban allí. Número de OV reconstruido como
-- OV-20{AA}-{Nota} a partir del prefijo y la Nota. Más la OV-2026-212 con el 38; la siguiente nueva, OV-2026-213, recibe el 39.
--
-- Solo DDL e INSERT idempotentes: initDb() re-ejecuta las migraciones en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.wo_sales_documento_numero (
  numero_ov        text        PRIMARY KEY,
  documento_numero integer     NOT NULL UNIQUE CHECK (documento_numero > 0),
  origen           text        NOT NULL CHECK (origen IN ('congelado', 'asignado')),
  asignado_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO portal.wo_sales_documento_numero (numero_ov, documento_numero, origen) VALUES
  ('OV-2022-105',  1, 'congelado'),
  ('OV-2025-030',  2, 'congelado'),
  ('OV-2025-086',  3, 'congelado'),
  ('OV-2025-087',  4, 'congelado'),
  ('OV-2025-199',  5, 'congelado'),
  ('OV-2026-021',  6, 'congelado'),
  ('OV-2026-033',  7, 'congelado'),
  ('OV-2026-057',  8, 'congelado'),
  ('OV-2026-081',  9, 'congelado'),
  ('OV-2026-142', 10, 'congelado'),
  ('OV-2026-143', 11, 'congelado'),
  ('OV-2026-146', 12, 'congelado'),
  ('OV-2026-153', 13, 'congelado'),
  ('OV-2026-155', 14, 'congelado'),
  ('OV-2026-156', 15, 'congelado'),
  ('OV-2026-157', 16, 'congelado'),
  ('OV-2026-160', 17, 'congelado'),
  ('OV-2026-167', 18, 'congelado'),
  ('OV-2026-171', 19, 'congelado'),
  ('OV-2026-187', 20, 'congelado'),
  ('OV-2026-188', 21, 'congelado'),
  ('OV-2026-189', 22, 'congelado'),
  ('OV-2026-193', 23, 'congelado'),
  ('OV-2026-194', 24, 'congelado'),
  ('OV-2026-196', 25, 'congelado'),
  ('OV-2026-198', 26, 'congelado'),
  ('OV-2026-201', 27, 'congelado'),
  ('OV-2026-202', 28, 'congelado'),
  ('OV-2026-203', 29, 'congelado'),
  ('OV-2026-204', 30, 'congelado'),
  ('OV-2026-205', 31, 'congelado'),
  ('OV-2026-206', 32, 'congelado'),
  ('OV-2026-207', 33, 'congelado'),
  ('OV-2026-208', 34, 'congelado'),
  ('OV-2026-209', 35, 'congelado'),
  ('OV-2026-210', 36, 'congelado'),
  ('OV-2026-211', 37, 'congelado'),
  -- Decisión del usuario (2026-11-09): la 212 ya está facturada en Zoho y nunca saldrá en el archivo;
  -- se congela con el 38 para que la 213 reciba el 39. NO estaba en el archivo del 31/10.
  ('OV-2026-212', 38, 'congelado')
ON CONFLICT DO NOTHING;

-- DATA-332: el rol de las peticiones lee y añade números, nunca los cambia ni los borra.
-- La 068 re-concede SELECT, INSERT, UPDATE y DELETE sobre TODAS las tablas del esquema en cada
-- arranque y corre ANTES que esta: sin el REVOKE, desde el segundo arranque portal_app volvería
-- a poder modificar y borrar números.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT ON portal.wo_sales_documento_numero TO portal_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON portal.wo_sales_documento_numero FROM portal_app;
  END IF;
END $$;
```

- [ ] **Step 5: Registrarla en `MIGRATIONS`**

En `apps/hub-api/src/db.ts:102`, al final del array, cambiar:

```ts
'069_trazabilidad_avisos_envios.sql'];
```

por:

```ts
'069_trazabilidad_avisos_envios.sql', '070_wo_sales_documento_numero.sql'];
```

(El Dockerfile ya copia la carpeta entera `src/users/migrations` a `dist/users/`: no hay que
tocarlo.)

- [ ] **Step 6: Crear el repo**

Crear `apps/hub-api/src/wo-sales/documento-numero.repo.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import { ordenarParaAsignar } from './documento-numero.js';

/**
 * Candado de la numeración (§8.1). Serializa dos generaciones simultáneas del archivo (dos
 * disparadores de n8n, o n8n y una descarga): sin él, las dos leerían el mismo MAX y darían el
 * mismo número a OV distintas. El UNIQUE de la tabla es la red de seguridad. Distinto del
 * candado del correo ('wo-sales:email'): las dos transacciones no se anidan.
 */
const BLOQUEO = `SELECT pg_advisory_xact_lock(hashtext('portal.wo_sales_documento_numero'))`;

interface FilaNumero {
  numero_ov: string;
  documento_numero: number;
}

/**
 * DocumentoNúmero de cada OV (§8.1). Las que ya tienen uno lo conservan; a las que no, se les
 * asigna MAX + 1, + 2… en el orden de `ordenarParaAsignar`. Las filas nunca se borran: una OV
 * que sale del archivo no libera su número. Devuelve el mapa completo (número de OV → número).
 * Todo en una transacción: si algo falla no queda numeración a medias.
 */
export async function asignarDocumentoNumeros(db: Pool, numerosOV: readonly string[]): Promise<Map<string, number>> {
  const unicos = [...new Set(numerosOV)];
  if (unicos.length === 0) return new Map();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(BLOQUEO);

    const { rows } = await client.query(
      `SELECT numero_ov, documento_numero
         FROM portal.wo_sales_documento_numero
        WHERE numero_ov = ANY($1::text[])`,
      [unicos],
    );
    const numeros = new Map<string, number>(
      (rows as FilaNumero[]).map((r) => [r.numero_ov, Number(r.documento_numero)]),
    );

    const faltan = ordenarParaAsignar(unicos.filter((n) => !numeros.has(n)));
    if (faltan.length > 0) {
      const { rows: maxRows } = await client.query(
        `SELECT COALESCE(MAX(documento_numero), 0)::int AS max FROM portal.wo_sales_documento_numero`,
      );
      const base = Number((maxRows as { max: number }[])[0]?.max ?? 0);
      const nuevos = faltan.map((_, i) => base + 1 + i);
      await client.query(
        `INSERT INTO portal.wo_sales_documento_numero (numero_ov, documento_numero, origen)
         SELECT n, d, 'asignado' FROM unnest($1::text[], $2::int[]) AS u(n, d)`,
        [faltan, nuevos],
      );
      faltan.forEach((n, i) => numeros.set(n, nuevos[i]));
    }

    await client.query('COMMIT');
    return numeros;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 7: Correr los tests de BD y ver que pasan**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/wo-sales/documento-numero.db.test.ts`
Expected: PASS (10 tests).

Si «dos asignaciones a la vez» falla con `duplicate key value violates unique constraint`, el
candado no se está tomando con el mismo `client` de la transacción: revisar el Step 6.

- [ ] **Step 8: Correr también el resto de tests de BD de WO-sales (la 070 no rompe nada)**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/wo-sales/`
Expected: PASS (`email.db.test.ts` + `documento-numero.db.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/users/migrations/070_wo_sales_documento_numero.sql apps/hub-api/src/db.ts apps/hub-api/src/wo-sales/documento-numero.repo.ts apps/hub-api/src/wo-sales/documento-numero.db.test.ts
git commit -m "feat(wo-sales): tabla de DocumentoNúmero con las 37 OV ya cargadas en WO (ARQ-610)"
```

---

### Task 3: El builder escribe el número de la tabla; cablear las cuatro vías

Una sola tarea y un solo commit: en cuanto el builder exige el mapa, los llamadores que no se lo
pasen lanzan, así que builder, llamadores y tests tienen que cambiar juntos para que el commit
quede en verde.

**Files:**
- Modify: `apps/hub-api/src/wo-sales/builder.test.ts`
- Modify: `apps/hub-api/src/wo-sales/xlsx.test.ts:75`
- Modify: `apps/hub-api/src/wo-sales/email.test.ts` (fakeDb y `tokenActual`, l.46-72)
- Modify: `apps/hub-api/src/wo-sales/builder.ts:76` y `:221-234`
- Modify: `apps/hub-api/src/wo-sales/config.ts:33-40` y `:83-85`
- Modify: `apps/hub-api/src/wo-sales/router.ts:142,163,199`
- Modify: `apps/hub-api/src/wo-sales/email.ts:79`

- [ ] **Step 1: `builder.test.ts` — pasar el mapa a las llamadas existentes**

1. Reemplazar TODAS las apariciones de `buildWorldOfficeCsv(` por `build(` en
   `apps/hub-api/src/wo-sales/builder.test.ts` (Edit con `replace_all`). La línea del `import`
   no cambia porque allí aparece `buildWorldOfficeCsv,` sin paréntesis.
2. Justo después de la función `decodificar` (l.7-9), añadir:

```ts
/** DocumentoNúmero por orden de aparición: lo que importa a casi todos los tests es el resto
 *  del archivo. Los tests de numeración pasan su propio mapa a buildWorldOfficeCsv. */
function numerar(ordenes: SalesOrder[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of ordenes) if (!m.has(o.numero)) m.set(o.numero, m.size + 1);
  return m;
}

function build(ordenes: SalesOrder[], config = DEFAULT_CONFIG) {
  return buildWorldOfficeCsv(ordenes, config, numerar(ordenes));
}
```

(Añadirlo DESPUÉS del `replace_all`, o el propio `build` acabaría llamándose a sí mismo.)

- [ ] **Step 2: `builder.test.ts` — sustituir los dos tests de numeración por posición**

Dentro de `describe('DocumentoNúmero: un consecutivo por OV', …)`:

1. Renombrar el `describe` a `'DocumentoNúmero: el número fijo de cada OV'`.
2. Reemplazar el test `'las líneas de una OV comparten número; en la misma fecha se ordena por número de OV'`
   completo por:

```ts
  it('las líneas de una OV comparten número; las filas van por fecha y número de OV', () => {
    const linea = OV_BASE.lineas[0];
    const ovB: SalesOrder = { ...OV_BASE, numero: 'OV-2026-179', lineas: [linea, linea] };
    const ovA: SalesOrder = { ...OV_BASE, numero: 'OV-2026-178', lineas: [linea] };
    const numeros = new Map([
      ['OV-2026-178', 40],
      ['OV-2026-179', 41],
    ]);
    const filas = decodificar(buildWorldOfficeCsv([ovB, ovA], DEFAULT_CONFIG, numeros).csv).filter(Boolean).slice(1);
    const pares = filas.map((f) => {
      const c = f.split(';');
      return [c[COLUMNS.indexOf('DocumentoNúmero')], c[COLUMNS.indexOf('Nota')]];
    });
    expect(pares).toEqual([['40', '178'], ['41', '179'], ['41', '179']]);
  });
```

3. Reemplazar el test `'numera desde consecutivoInicial, por fecha ascendente'` completo por:

```ts
  it('escribe el número que trae el mapa, no uno por posición', () => {
    const numeros = new Map([
      ['OV-2026-212', 38],
      ['OV-2026-150', 7],
    ]);
    const filas = filasDoc(
      buildWorldOfficeCsv(
        [
          { ...OV_BASE, numero: 'OV-2026-212', fecha: '2026-11-03' },
          { ...OV_BASE, numero: 'OV-2026-150', fecha: '2026-09-01' },
        ],
        DEFAULT_CONFIG,
        numeros
      ).csv
    );
    expect(filas.map((f) => f.doc)).toEqual(['7', '38']);
  });

  it('la misma OV lleva el mismo número aunque otra salga del archivo', () => {
    const numeros = new Map([
      ['OV-2026-150', 7],
      ['OV-2026-212', 38],
    ]);
    const a: SalesOrder = { ...OV_BASE, numero: 'OV-2026-150' };
    const b: SalesOrder = { ...OV_BASE, numero: 'OV-2026-212' };
    const antes = filasDoc(buildWorldOfficeCsv([a, b], DEFAULT_CONFIG, numeros).csv);
    const despues = filasDoc(buildWorldOfficeCsv([b], DEFAULT_CONFIG, numeros).csv); // la 150 se facturó
    expect(antes.map((f) => f.doc)).toEqual(['7', '38']);
    expect(despues.map((f) => f.doc)).toEqual(['38']);
  });

  it('lanza si a una OV le falta número: nunca sale la columna D vacía', () => {
    expect(() => buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG, new Map())).toThrow(/OV-2026-138/);
  });
```

4. En el primer `describe` (l.63 aprox.), cambiar el comentario obsoleto:

```ts
    expect(valor('DocumentoNúmero')).toBe('1'); // 1er grupo, consecutivoInicial 1
```

por:

```ts
    expect(valor('DocumentoNúmero')).toBe('1'); // el que le da numerar() a la primera OV
```

- [ ] **Step 3: Correr los tests del builder y ver que fallan los nuevos**

Run: `cd apps/hub-api && npx vitest run src/wo-sales/builder.test.ts`
Expected: FAIL en 4 tests — `las líneas de una OV comparten número…` (sale `1`/`2`),
`escribe el número que trae el mapa…` (sale `1`/`2`), `la misma OV lleva el mismo número…` y
`lanza si a una OV le falta número…` (no lanza). El resto pasa.

- [ ] **Step 4: Implementar en `builder.ts`**

1. Firma (l.76). Cambiar:

```ts
export function buildWorldOfficeCsv(ordenes: SalesOrder[], config: WoSalesConfig): BuildResult {
```

por:

```ts
/**
 * `documentoNumeros`: el DocumentoNúmero fijo de cada OV (número de OV → número), de
 * portal.wo_sales_documento_numero vía asignarDocumentoNumeros (§8.1). El builder no toca la BD.
 */
export function buildWorldOfficeCsv(
  ordenes: SalesOrder[],
  config: WoSalesConfig,
  documentoNumeros: ReadonlyMap<string, number>
): BuildResult {
```

2. Bloque de numeración (l.221-234). Cambiar:

```ts
  // DocumentoNúmero (§3): un consecutivo por OV, desde consecutivoInicial. Un pedido de WO
  // por OV para que cada pedido se convierta en la factura de su OV (en Zoho cada OV se
  // factura por separado). Agrupar por (fecha, NIT) escondía OV dentro del pedido de otra:
  // OV-2026-178..182 salían dentro del pedido con Nota "177". Una OV tiene una sola fecha
  // y un solo NIT, así que la llave de documento sigue siendo coherente (§7.4). Orden:
  // fecha ascendente y, en la misma fecha, número de OV; las líneas de una OV quedan
  // contiguas.
  const ordenadas = [...ordenes].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero)
  );
  let siguienteNumero = config.consecutivoInicial;

  for (const ov of ordenadas) {
    const documentoNumero = siguienteNumero++;
```

por:

```ts
  // DocumentoNúmero (§3, §8.1): el número FIJO de cada OV, de la tabla persistente. Un pedido
  // de WO por OV para que cada pedido se convierta en la factura de su OV (en Zoho cada OV se
  // factura por separado). Agrupar por (fecha, NIT) escondía OV dentro del pedido de otra:
  // OV-2026-178..182 salían dentro del pedido con Nota "177". Una OV tiene una sola fecha
  // y un solo NIT, así que la llave de documento sigue siendo coherente (§7.4). Orden de las
  // filas: fecha ascendente y, en la misma fecha, número de OV; las líneas de una OV quedan
  // contiguas. El orden ya NO decide el número: una OV lleva el mismo en todos los archivos.
  const ordenadas = [...ordenes].sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero)
  );

  for (const ov of ordenadas) {
    const documentoNumero = documentoNumeros.get(ov.numero);
    if (documentoNumero === undefined) {
      // Fallo de programación (el llamador no asignó), no un dato de Zoho: mejor ningún
      // archivo que uno con la columna D vacía o con un número inventado.
      throw new Error(`WO-sales: la OV ${ov.numero} no tiene DocumentoNúmero asignado`);
    }
```

- [ ] **Step 5: Quitar `consecutivoInicial` de `config.ts`**

1. En el tipo (l.33-40), borrar este bloque entero:

```ts
  /**
   * Primer número de documento (§3). `DocumentoNúmero` ya NO es fijo: es un consecutivo
   * por OV (un pedido de WO por OV). Este es el número de la PRIMERA OV; las demás
   * siguen en orden de fecha y número de OV. OJO (§8.1): el par (prefijo, DocumentoNúmero) debe ser
   * único en WO para todo el año — hay que persistir el último usado entre archivos y
   * arrancar desde ahí, NO desde 1. Pendiente de cablear la persistencia.
   */
  consecutivoInicial: number;
```

2. En `DEFAULT_CONFIG` (l.83-85), borrar:

```ts
  // Primer consecutivo. Default 1 SOLO para arrancar; en producción debe venir del
  // último número ya cargado en WO (§8.1), no hardcodearse en 1.
  consecutivoInicial: 1,
```

- [ ] **Step 6: Correr los tests del builder y ver que pasan**

Run: `cd apps/hub-api && npx vitest run src/wo-sales/builder.test.ts`
Expected: PASS (todos).

- [ ] **Step 7: `xlsx.test.ts` — pasar el mapa**

En `apps/hub-api/src/wo-sales/xlsx.test.ts:75`, cambiar:

```ts
  const buf = () => buildWorldOfficeXlsx(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG).matriz);
```

por:

```ts
  const buf = () =>
    buildWorldOfficeXlsx(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG, new Map([[OV_BASE.numero, 1]])).matriz);
```

- [ ] **Step 8: `email.test.ts` — el doble de BD responde a la numeración**

1. En `fakeDb` (l.46-62), justo antes de `if (sql.includes('UPDATE portal.wo_sales_email_frecuencia'))`,
   añadir:

```ts
      // asignarDocumentoNumeros: tabla vacía en el doble → MAX 0, así que 'OV-1' recibe el 1.
      if (sql.includes('MAX(documento_numero)')) return { rows: [{ max: 0 }] };
```

   (El `SELECT … WHERE numero_ov = ANY` y el `INSERT` caen al `rows: []` del final.)

2. Cambiar `tokenActual` (l.72):

```ts
  const tokenActual = () => hashMatriz(buildWorldOfficeCsv([ov], DEFAULT_CONFIG).matriz);
```

por:

```ts
  const tokenActual = () => hashMatriz(buildWorldOfficeCsv([ov], DEFAULT_CONFIG, new Map([['OV-1', 1]])).matriz);
```

- [ ] **Step 9: Correr los tests de email y ver que fallan**

Run: `cd apps/hub-api && npx vitest run src/wo-sales/email.test.ts`
Expected: FAIL en los tests de `computarPendiente` — `WO-sales: la OV OV-1 no tiene DocumentoNúmero asignado`
(email.ts todavía no asigna).

- [ ] **Step 10: Cablear `email.ts`**

1. Añadir el import junto a los demás de `./`:

```ts
import { asignarDocumentoNumeros } from './documento-numero.repo.js';
```

2. En `computarPendiente` (l.78-79), cambiar:

```ts
  const ordenes = await source.ordenesVivas(filtro);
  const { matriz, warnings } = buildWorldOfficeCsv(ordenes, config);
```

por:

```ts
  const ordenes = await source.ordenesVivas(filtro);
  // DocumentoNúmero fijo por OV (§8.1). Toma su propio candado y hace COMMIT antes de entrar al
  // del correo: los dos no se anidan.
  const numeros = await asignarDocumentoNumeros(db, ordenes.map((o) => o.numero));
  const { matriz, warnings } = buildWorldOfficeCsv(ordenes, config, numeros);
```

- [ ] **Step 11: Cablear `router.ts`**

1. Añadir el import junto a los demás de `./`:

```ts
import { asignarDocumentoNumeros } from './documento-numero.repo.js';
```

2. En `/wo-sales/preview` (l.142), cambiar:

```ts
      const { warnings, filas } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG);
```

por:

```ts
      const numeros = await asignarDocumentoNumeros(db, ordenes.map((o) => o.numero));
      const { warnings, filas } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG, numeros);
```

3. En `/wo-sales/csv` (l.163), cambiar:

```ts
      const { csv, warnings } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG);
```

por:

```ts
      const numeros = await asignarDocumentoNumeros(db, ordenes.map((o) => o.numero));
      const { csv, warnings } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG, numeros);
```

4. En `/wo-sales/xlsx` (l.199), cambiar:

```ts
      const { matriz, warnings } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG);
```

por:

```ts
      const numeros = await asignarDocumentoNumeros(db, ordenes.map((o) => o.numero));
      const { matriz, warnings } = buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG, numeros);
```

- [ ] **Step 12: Comprobar que no queda ninguna llamada sin mapa ni rastro de `consecutivoInicial`**

Run: `cd apps/hub-api && grep -rn "consecutivoInicial" src; grep -rn "buildWorldOfficeCsv(" src --include=*.ts`
Expected: ninguna línea con `consecutivoInicial`. Todas las llamadas a `buildWorldOfficeCsv(` en
código de producción (`router.ts`, `email.ts`) llevan `numeros` como tercer argumento.

- [ ] **Step 13: Correr toda la suite unitaria de WO-sales**

Run: `cd apps/hub-api && npx vitest run src/wo-sales`
Expected: PASS (todos los ficheros, sin los `.db.test.ts`).

- [ ] **Step 14: Typecheck (el build de CI)**

Run: `npm run build --workspace=apps/hub-api`
Expected: termina sin errores de `tsc`.

- [ ] **Step 15: Tests de BD de WO-sales (email.db.test.ts ahora también numera)**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/wo-sales/`
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git add apps/hub-api/src/wo-sales/builder.ts apps/hub-api/src/wo-sales/config.ts apps/hub-api/src/wo-sales/router.ts apps/hub-api/src/wo-sales/email.ts apps/hub-api/src/wo-sales/builder.test.ts apps/hub-api/src/wo-sales/xlsx.test.ts apps/hub-api/src/wo-sales/email.test.ts
git commit -m "feat(wo-sales): DocumentoNúmero fijo por OV desde la tabla persistente (§8.1)"
```

---

### Task 4: Verificación completa, documentación y push

**Files:**
- Modify: `docs/superpowers/specs/2026-11-09-wo-sales-documento-numero-design.md` (línea `**Estado:**`)

- [ ] **Step 1: Suite unitaria completa de hub-api**

Run: `cd apps/hub-api && npx vitest run`
Expected: PASS. (Si `users` 4.4 cae por timeout bajo carga, es un fallo conocido que no es de este
cambio: re-correr solo ese fichero para confirmarlo.)

- [ ] **Step 2: Suite de BD completa de hub-api**

Run: `npm run test:db --workspace=apps/hub-api`
Expected: PASS.

- [ ] **Step 3: Marcar la spec como implementada**

En `docs/superpowers/specs/2026-11-09-wo-sales-documento-numero-design.md`, cambiar:

```markdown
**Estado:** diseño aprobado, pendiente de escribir el plan de implementación
```

por:

```markdown
**Estado:** implementado en la rama `feat/wo-sales-documento-numero` (plan:
`docs/superpowers/plans/2026-11-09-wo-sales-documento-numero.md`); pendiente de desplegar hub-api
y la SPA de WO-sales
```

- [ ] **Step 4: Commit y push**

```bash
git add docs/superpowers/specs/2026-11-09-wo-sales-documento-numero-design.md docs/superpowers/plans/2026-11-09-wo-sales-documento-numero.md
git commit -m "docs(wo-sales): la spec del DocumentoNúmero persistente queda implementada"
git push -u origin feat/wo-sales-documento-numero
```

Expected: la rama sube y el CI (build + `test:db`) queda en verde.

---

### Task 5: Despliegue (lo hace el usuario; aquí solo el guion)

No es código. Empujar no despliega: el usuario fusiona a `main` y despliega a mano en EasyPanel
**hub-api y la SPA de WO-sales, juntas**. La SPA cambia por el aviso `ov_numero_repetido`
(`WARNING_META`) y por la clave de las filas de la vista previa; una SPA vieja mostraría el aviso
con su nombre técnico.

- [ ] **Step 1: ANTES de desplegar — ¿hay OV vivas anteriores a la 213 sin número congelado?**

En la consola Postgres de EasyPanel (abre en la base `postgres`):

```sql
\c zoho-hub
SELECT so.salesorder_number, so.date, so.status
  FROM books.sales_orders so
 WHERE (so.status IN ('open', 'overdue', 'partially_invoiced')
        OR (so.status = 'invoiced' AND EXISTS (
              SELECT 1 FROM books.invoices i
               WHERE i.salesorder_id = so.salesorder_id
                 AND i.status IN ('draft', 'approved'))))
   AND so.salesorder_number <> 'OV-2026-1000-01'
   AND so.salesorder_number NOT IN (
     'OV-2022-105','OV-2025-030','OV-2025-086','OV-2025-087','OV-2025-199',
     'OV-2026-021','OV-2026-033','OV-2026-057','OV-2026-081','OV-2026-142',
     'OV-2026-143','OV-2026-146','OV-2026-153','OV-2026-155','OV-2026-156',
     'OV-2026-157','OV-2026-160','OV-2026-167','OV-2026-171','OV-2026-187',
     'OV-2026-188','OV-2026-189','OV-2026-193','OV-2026-194','OV-2026-196',
     'OV-2026-198','OV-2026-201','OV-2026-202','OV-2026-203','OV-2026-204',
     'OV-2026-205','OV-2026-206','OV-2026-207','OV-2026-208','OV-2026-209',
     'OV-2026-210','OV-2026-211','OV-2026-212')
 ORDER BY so.salesorder_number;
```

Expected: solo OV-2026-213 en adelante. Si sale alguna anterior (p. ej. OV-2026-150), esa se
llevaría el 39 y la 213 bajaría al 40: decidir antes de desplegar (cerrarla en Zoho o congelarla
con su número de WO).

Una OV de esa lista sin líneas pendientes (en la vista previa sale con `ov_sin_lineas`) no
consume número, así que no mueve la 213.

- [ ] **Step 1b: ANTES de desplegar — las 38 claves congeladas existen en Zoho**

La siembra reconstruye el número de OV como `OV-20{AA}-{Nota}`, con el año del PREFIJO, que el
builder sacaba de la FECHA de la OV. Si alguna OV tuviera un número de otro año que su fecha, su
clave congelada no casaría y recibiría un número nuevo (≥ 39) en silencio:

```sql
\c zoho-hub
SELECT count(*) AS encontradas
  FROM books.sales_orders
 WHERE salesorder_number IN (
     'OV-2022-105','OV-2025-030','OV-2025-086','OV-2025-087','OV-2025-199',
     'OV-2026-021','OV-2026-033','OV-2026-057','OV-2026-081','OV-2026-142',
     'OV-2026-143','OV-2026-146','OV-2026-153','OV-2026-155','OV-2026-156',
     'OV-2026-157','OV-2026-160','OV-2026-167','OV-2026-171','OV-2026-187',
     'OV-2026-188','OV-2026-189','OV-2026-193','OV-2026-194','OV-2026-196',
     'OV-2026-198','OV-2026-201','OV-2026-202','OV-2026-203','OV-2026-204',
     'OV-2026-205','OV-2026-206','OV-2026-207','OV-2026-208','OV-2026-209',
     'OV-2026-210','OV-2026-211','OV-2026-212');
```

Expected: `encontradas = 38`. Si sale menos, no desplegar: hay que corregir la clave de la que
falte en la migración 070.

- [ ] **Step 1c: Avisar a contabilidad del correo que llegará tras desplegar**

La columna D cambia de número por posición a número fijo, así que la huella del archivo
(`hashMatriz`) cambia una vez para todos: quien tenga frecuencia `inmediato` recibe un correo en
el primer ciclo de n8n tras el despliegue (los de diario/semanal/fin de mes, en su próxima franja),
probablemente sin «OV con cambios» que lo explique. Decirle a Xiomara que ese correo trae el mismo
contenido con la numeración nueva (la 213 = 39) y que es el primero que se puede cargar sin
retocar la columna D. El primer archivo traerá la 213 = 39 y la 214 = 40. La OV-2026-212 (= 38) NO saldrá en el archivo porque ya está facturada en Zoho; si hay que tenerla en WO, se carga a mano con DocumentoNúmero 38.

- [ ] **Step 2: Fusionar a `main` y desplegar hub-api y la SPA de WO-sales en EasyPanel**

Justo después de desplegar, nadie debe abrir una vista previa FILTRADA (por cliente o por fecha)
antes de la primera generación sin filtros: esperar al primer ciclo de n8n (≤ 5 min) o abrir la
vista previa sin filtros. La primera generación decide el orden de los números nuevos.

**Rollback**: volver a la imagen anterior de hub-api cuando ya se cargaron en WO archivos con
números fijos reiniciaría la numeración desde 1 y chocaría con lo cargado. Solo es seguro antes de
subir a WO el primer archivo con números fijos.

- [ ] **Step 3: DESPUÉS de desplegar — comprobar la numeración**

Tras el primer ciclo de n8n (≤ 5 min) o una vista previa en la app:

```sql
\c zoho-hub
SELECT numero_ov, documento_numero, origen, asignado_at
  FROM portal.wo_sales_documento_numero
 ORDER BY documento_numero DESC
 LIMIT 10;
```

Expected: `OV-2026-213 → 39` (`origen = asignado`) y las siguientes consecutivas; debajo,
`OV-2026-212 → 38` (`congelado`) y
`OV-2026-211 → 37` (`congelado`).

- [ ] **Step 4: Revisar el primer archivo antes de subirlo a WO**

Descargar el `.xls` desde la app y comprobar que la columna D de la OV-2026-213 es 39 y que
ninguna OV ya cargada aparece con un número distinto al de su carga.
