# Baja de empleados — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin pueda retirar a alguien que se va de la compañía, con fecha (incluso futura), congelando su devengo de vacaciones en su último día.

**Architecture:** `portal.empleados` gana `fecha_retiro`, `retirado_por` y `retirado_at`. La columna `activo` sigue siendo la única bandera que apagan las ~15 consultas existentes; la fecha solo decide *cuándo* se apaga, mediante un barrido idempotente colgado de la carga del contexto. El devengo se congela pasando `min(hoy, fecha_retiro)` a `calcularSaldo` desde el bucle de `combinar` — un solo punto.

**Tech Stack:** Express 4 + TypeScript ESM (imports con `.js`), SQL crudo con `$1`, Vitest 2.1.9, testcontainers para `test:db`, React 19 en el front.

**Diseño de referencia:** `docs/superpowers/specs/2026-08-24-baja-de-empleados-design.md`

---

## Antes de empezar

- **Trabajar en rama**: `git checkout -b feat/baja-de-empleados`. Mezclar al final con `git merge --no-ff`.
- **Docker tiene que estar arrancado** para las tareas con `test:db`:
  `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"` (tarda ~10 s).
- **Nunca `git add -A`**: rutas explícitas en cada commit.
- **Commits en español sin tildes.** Código y comentarios en español CON tildes; los `.db.test.ts` sin tildes.
- **Comprometer antes de mutar**: la falsación de la tarea 12 revierte con `git checkout -- <fichero>`, que se lleva por delante lo no commiteado.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `apps/hub-api/src/users/migrations/035_ausencias_baja_empleado.sql` | **Crear.** Las tres columnas nuevas. |
| `apps/hub-api/src/db.ts:24` | **Modificar.** Añadir la 035 al array `MIGRATIONS`. |
| `apps/hub-api/src/ausencias/repo.ts` | **Modificar.** Leer las columnas, fijar/limpiar el retiro, el barrido y las dos consultas de bloqueo. |
| `apps/hub-api/src/ausencias/types.ts` | **Modificar.** `Empleado` gana tres campos. |
| `apps/hub-api/src/ausencias/service.ts` | **Modificar.** `hoyCongelado`; `combinar` congela; `retirarEmpleado`/`reactivarEmpleado`; `listaDeRetirados`; la guarda de alta de solicitudes. |
| `apps/hub-api/src/ausencias/router.ts` | **Modificar.** El barrido en `/contexto`; `PUT`/`DELETE` de `/empleados/:id/retiro`; `GET /empleados/retirados`. |
| `apps/hub-api/src/ausencias/repo.baja.db.test.ts` | **Crear.** Todo lo que es SQL: columnas, barrido, bloqueos. |
| `apps/hub-api/src/ausencias/saldo.test.ts` | **Modificar.** La congelación (función pura). |
| `apps/ausencias/src/api.ts` | **Modificar.** Tipos y las dos llamadas. |
| `apps/ausencias/src/ImportarEmpleados.tsx` | **Modificar.** Vistas Activos/Retirados y los botones. |

---

## Task 1: La migración 035 y su candado

**Files:**
- Create: `apps/hub-api/src/users/migrations/035_ausencias_baja_empleado.sql`
- Modify: `apps/hub-api/src/db.ts:24`
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts` (crear)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/ausencias/repo.baja.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// La baja de empleados contra Postgres de verdad.
//
// Todo lo de este fichero es SQL, y en este repo una regla escrita en SQL solo
// la vigila un test de test:db: el doble in-memory de router.test.ts no ejecuta
// consultas, asi que una columna que falte o un WHERE mal puesto pasarian los
// 1013 unitarios en verde.

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('migracion 035', () => {
  it('CANDADO: las tres columnas existen (o sea, la 035 esta en el array MIGRATIONS)', async () => {
    // Olvidar el array no da ningun error: la migracion no corre y la columna
    // no existe solo en produccion. Este test es el unico que lo caza.
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'empleados'
          AND column_name IN ('fecha_retiro', 'retirado_por', 'retirado_at')
        ORDER BY column_name`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { column_name: string }) => r.column_name)).toEqual([
      'fecha_retiro',
      'retirado_at',
      'retirado_por',
    ]);
    // Nullable las tres: una ficha activa no tiene retiro.
    expect(rows.every((r: { is_nullable: string }) => r.is_nullable === 'YES')).toBe(true);
  });

  it('una ficha recien sembrada nace sin retiro', async () => {
    const id = await sembrarEmpleado(db, 'ana@baja.test');
    const { rows } = await db.query(
      'SELECT fecha_retiro, retirado_por, retirado_at FROM portal.empleados WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ fecha_retiro: null, retirado_por: null, retirado_at: null });
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — el primer test devuelve 0 filas en vez de 3.

- [ ] **Step 3: Escribir la migración**

Crear `apps/hub-api/src/users/migrations/035_ausencias_baja_empleado.sql`:

```sql
-- Baja de empleados que se retiran de la compañía.
--
-- `fecha_retiro` es el ÚLTIMO DÍA QUE TRABAJA, y ese día la ficha todavía está
-- activa. No es el primer día que ya no está. De esa definición cuelgan todas
-- las comparaciones del código: el barrido usa `<` y no `<=`, y la congelación
-- del devengo usa `min(hoy, fecha_retiro)`. Con `<=` se retiraría a alguien en
-- su último día de trabajo y se le recortaría un día de devengo — sobre un
-- número que se le paga.
--
-- `retirado_por` y `retirado_at` no son adorno: son la constancia de quién fijó
-- ese número. Se rellenan al REGISTRAR la baja, no al aplicarla.
--
-- Sin CHECK que ate las tres: una ficha desactivada a mano antes de que esta
-- feature existiera tiene `activo = false` y las tres a null, y es un estado
-- legítimo que no hay que romper.
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS fecha_retiro DATE;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS retirado_por VARCHAR(254);

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS retirado_at TIMESTAMPTZ;

-- El barrido pregunta por las fichas activas con fecha vencida. Parcial porque
-- la inmensa mayoría de las filas tienen `fecha_retiro` a null y no interesan.
CREATE INDEX IF NOT EXISTS idx_empleados_fecha_retiro
  ON portal.empleados (fecha_retiro)
  WHERE fecha_retiro IS NOT NULL;
```

- [ ] **Step 4: Añadirla al array `MIGRATIONS`**

En `apps/hub-api/src/db.ts:24`, añadir al final del array, después de `'034_token_version.sql'`:

```ts
'035_ausencias_baja_empleado.sql'
```

- [ ] **Step 5: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/users/migrations/035_ausencias_baja_empleado.sql apps/hub-api/src/db.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): migracion 035 con la fecha de retiro y su constancia"
```

---

## Task 2: El repo lee las columnas nuevas

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts:50-88` (`COLS_EMPLEADO`, `FilaEmpleadoDb`, `aEmpleado`)
- Modify: `apps/hub-api/src/ausencias/types.ts` (interfaz `Empleado`)
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `repo.baja.db.test.ts`, con este import extra arriba:

```ts
import { empleadoPorId } from './repo.js';
```

```ts
describe('el repo lee la fecha de retiro', () => {
  it('devuelve fechaRetiro, retiradoPor y retiradoAt', async () => {
    const id = await sembrarEmpleado(db, 'ana@baja.test');
    await db.query(
      `UPDATE portal.empleados
          SET fecha_retiro = '2026-09-30', retirado_por = 'admin@ambientalia.com.co',
              retirado_at = NOW()
        WHERE id = $1`,
      [id],
    );
    const e = await empleadoPorId(db, id);
    // ::text en la consulta: sin el, un DATE llega como objeto Date y cualquier
    // comparacion lexicografica contra 'YYYY-MM-DD' falla EN SILENCIO.
    expect(e?.fechaRetiro).toBe('2026-09-30');
    expect(e?.retiradoPor).toBe('admin@ambientalia.com.co');
    expect(typeof e?.retiradoAt).toBe('string');
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — `e.fechaRetiro` es `undefined`.

- [ ] **Step 3: Ampliar el tipo `Empleado`**

En `apps/hub-api/src/ausencias/types.ts`, dentro de `interface Empleado`, añadir:

```ts
  /**
   * El último día que trabaja. `null` mientras no haya baja registrada.
   *
   * Puede estar en el futuro: una baja se puede dejar programada y la persona
   * sigue trabajando, pidiendo y firmando hasta ese día incluido.
   */
  fechaRetiro: string | null;
  /** Quién registró la baja. Constancia: el saldo congelado es lo que se paga. */
  retiradoPor: string | null;
  retiradoAt: string | null;
```

- [ ] **Step 4: Leerlas en el repo**

En `apps/hub-api/src/ausencias/repo.ts`, `COLS_EMPLEADO` pasa a:

```ts
const COLS_EMPLEADO = `
  id, nombre_completo, correo, cargo, credencial,
  aprobador_correo, copia_correo, user_id, activo, ve_adjuntos, exporta_registro, ve_toda_la_empresa,
  requiere_segunda_firma,
  fecha_retiro::text AS fecha_retiro,
  retirado_por,
  retirado_at::text AS retirado_at`;
```

En `interface FilaEmpleadoDb` añadir:

```ts
  fecha_retiro: string | null;
  retirado_por: string | null;
  retirado_at: string | null;
```

En `aEmpleado`, dentro del objeto devuelto:

```ts
    fechaRetiro: r.fecha_retiro,
    retiradoPor: r.retirado_por,
    retiradoAt: r.retirado_at,
```

- [ ] **Step 5: Verlo pasar y comprobar que no se rompió nada**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (3 tests)

Run: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json`
Expected: sin salida. Si algún doble de test construye un `Empleado` a mano, `tsc` señalará exactamente dónde faltan los tres campos — añadirles `fechaRetiro: null, retiradoPor: null, retiradoAt: null`.

Run: `cd apps/hub-api && npx vitest run`
Expected: PASS, 1013 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): el repo lee la fecha de retiro de la ficha"
```

---

## Task 3: Congelar el devengo

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (interfaz `EmpleadoConSaldo` y la consulta `empleadosConSaldo`)
- Modify: `apps/hub-api/src/ausencias/service.ts:1982-2008` (`combinar`)
- Test: `apps/hub-api/src/ausencias/saldo.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `apps/hub-api/src/ausencias/saldo.test.ts`. Importar `hoyCongelado` desde `./service.js` — la función se crea en el paso 3.

```ts
describe('hoyCongelado — el devengo se para en el último día trabajado', () => {
  it('sin fecha de retiro, devuelve hoy tal cual', () => {
    expect(hoyCongelado(null, '2026-08-24')).toBe('2026-08-24');
  });

  it('con la fecha ya pasada, devuelve la fecha de retiro', () => {
    expect(hoyCongelado('2026-03-15', '2026-08-24')).toBe('2026-03-15');
  });

  it('CANDADO: el DÍA del retiro todavía cuenta entero', () => {
    // La fecha es el ÚLTIMO DÍA QUE TRABAJA. Devolver la fecha aquí en vez de
    // hoy da el mismo número, pero el candado importa por su gemelo del
    // barrido: si alguien cambia esto a `<=` para "simplificar", le recorta un
    // día de devengo a alguien sobre un número que se paga.
    expect(hoyCongelado('2026-08-24', '2026-08-24')).toBe('2026-08-24');
  });

  it('con la fecha en el futuro, sigue devengando: devuelve hoy', () => {
    expect(hoyCongelado('2026-12-31', '2026-08-24')).toBe('2026-08-24');
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/saldo.test.ts`
Expected: FAIL — `hoyCongelado is not a function` / error de importación.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/ausencias/service.ts`, justo encima de `combinar`:

```ts
/**
 * El «hoy» con el que se calcula el saldo de UNA ficha.
 *
 * Para quien se fue, el devengo tiene que pararse en su último día: si no,
 * `calcularSaldo` sigue haciendo `diasEntre(fechaCorte, hoy)` con un `hoy` que
 * no deja de avanzar, y alguien que se fue en marzo aparece en agosto con cinco
 * meses de vacaciones que no ganó.
 *
 * ⚠️ `<` y no `<=`: `fechaRetiro` es el último día que TRABAJA, así que ese día
 * todavía devenga entero. Con `<=` se le restaría un día — y este número es el
 * que se le paga en la liquidación.
 *
 * Una fecha futura no congela nada: quien tiene la salida prevista sigue
 * devengando hasta que llegue.
 *
 * Exportada solo para poder probarla suelta: es la clase de aritmética de
 * fechas en la que un signo mal puesto no se ve leyendo el código.
 */
export function hoyCongelado(fechaRetiro: string | null, hoy: string): string {
  if (fechaRetiro !== null && fechaRetiro < hoy) return fechaRetiro;
  return hoy;
}
```

Y dentro de `combinar`, en el `empleados.map((e) => {`, sustituir los tres usos de `hoy` por el congelado:

```ts
    // El «hoy» de ESTA ficha, no el de la pantalla: un retirado dejó de devengar
    // en su último día. Va aquí y no dentro de `calcularSaldo` porque el corte
    // es una propiedad del empleado, no del cálculo.
    const suHoy = hoyCongelado(e.fechaRetiro, hoy);
```

y en el `return`:

```ts
      saldo: conEtiqueta(e.correo, 'vacaciones', () => calcularSaldo(configVacaciones, suyas, suHoy)),
      compensatorios: conEtiqueta(e.correo, 'compensatorios', () =>
        calcularSaldoCompensatorios(configCompensatorios, suyas, suHoy),
      ),
```

- [ ] **Step 4: Que `EmpleadoConSaldo` traiga la fecha**

En `apps/hub-api/src/ausencias/repo.ts`, en `interface EmpleadoConSaldo` añadir:

```ts
  /** Para congelar el devengo de quien ya se fue. Ver `hoyCongelado`. */
  fechaRetiro: string | null;
```

En `interface FilaEmpleadoSaldoDb` añadir `fecha_retiro: string | null;`, en `aEmpleadoConSaldo` añadir `fechaRetiro: r.fecha_retiro,`, y en la consulta de `empleadosConSaldo` añadir la columna al SELECT (con `::text`, por lo mismo que las otras dos fechas):

```sql
            e.fecha_retiro::text   AS fecha_retiro,
```

- [ ] **Step 5: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/saldo.test.ts`
Expected: PASS (4 tests nuevos, más los que ya había)

Run: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/saldo.test.ts
git commit -m "feat(ausencias): el devengo se congela en el ultimo dia trabajado"
```

---

## Task 4: El barrido que aplica las bajas vencidas

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (nueva `aplicarRetirosVencidos`)
- Modify: `apps/hub-api/src/ausencias/service.ts` (llamarla desde el contexto)
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir `aplicarRetirosVencidos` al import de `./repo.js` en `repo.baja.db.test.ts` y luego:

```ts
describe('aplicarRetirosVencidos', () => {
  async function fechaRetiroDe(id: string, fecha: string): Promise<void> {
    await db.query('UPDATE portal.empleados SET fecha_retiro = $2 WHERE id = $1', [id, fecha]);
  }
  async function sigueActivo(id: string): Promise<boolean> {
    const { rows } = await db.query('SELECT activo FROM portal.empleados WHERE id = $1', [id]);
    return (rows[0] as { activo: boolean }).activo;
  }

  it('desactiva a quien tiene la fecha ya pasada', async () => {
    const id = await sembrarEmpleado(db, 'ida@baja.test');
    await fechaRetiroDe(id, '2026-08-20');
    const cuantos = await aplicarRetirosVencidos(db, '2026-08-24');
    expect(cuantos).toBe(1);
    expect(await sigueActivo(id)).toBe(false);
  });

  it('CANDADO: el DIA del retiro sigue activo, que es su ultimo dia de trabajo', async () => {
    // Con `<=` en vez de `<` este test muere. Es el gemelo del candado de
    // hoyCongelado, y el motivo por el que los dos existen: la fecha es el
    // ultimo dia TRABAJADO.
    const id = await sembrarEmpleado(db, 'hoy@baja.test');
    await fechaRetiroDe(id, '2026-08-24');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(true);
  });

  it('no toca a quien tiene la fecha en el futuro', async () => {
    const id = await sembrarEmpleado(db, 'futuro@baja.test');
    await fechaRetiroDe(id, '2026-12-31');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(true);
  });

  it('no toca a quien no tiene fecha', async () => {
    const id = await sembrarEmpleado(db, 'normal@baja.test');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(true);
  });

  it('es idempotente: la segunda pasada no encuentra nada', async () => {
    const id = await sembrarEmpleado(db, 'dos@baja.test');
    await fechaRetiroDe(id, '2026-08-20');
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(1);
    expect(await aplicarRetirosVencidos(db, '2026-08-24')).toBe(0);
    expect(await sigueActivo(id)).toBe(false);
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — `aplicarRetirosVencidos is not a function`.

- [ ] **Step 3: Implementar en el repo**

En `apps/hub-api/src/ausencias/repo.ts`:

```ts
/**
 * Apaga las fichas cuya baja programada ya venció. Devuelve cuántas.
 *
 * Es lo que hace que una fecha futura signifique algo sin necesidad de un cron:
 * se llama desde la carga del contexto, así que la aplica el primero que abra la
 * app ese día. Si no la abre nadie, tampoco hay nadie mirando las listas que
 * esta baja debería limpiar.
 *
 * Idempotente: el `AND activo` hace que la segunda pasada no encuentre filas, y
 * por eso dos peticiones concurrentes pueden ejecutarla a la vez sin estorbarse.
 *
 * ⚠️ `<` y no `<=`: `fecha_retiro` es el último día que TRABAJA. Con `<=` se le
 * apagaría el acceso en su último día y perdería un día de devengo. Su candado
 * vive en `repo.baja.db.test.ts` y su gemelo en `hoyCongelado`.
 */
export async function aplicarRetirosVencidos(db: Pool, hoy: string): Promise<number> {
  const res = await db.query(
    `UPDATE portal.empleados
        SET activo = false
      WHERE activo AND fecha_retiro IS NOT NULL AND fecha_retiro < $1::date`,
    [hoy],
  );
  return res.rowCount ?? 0;
}
```

- [ ] **Step 4: Colgarlo de la carga del contexto**

El contexto **no vive en un servicio**: se arma inline en el handler de la ruta. En `apps/hub-api/src/ausencias/router.ts:60`, dentro de `router.get('/ausencias/contexto', ...)`, como primera línea del `try` y **antes** de `asegurarEmpleado`:

```ts
      // El barrido de bajas vencidas va aquí: el contexto lo carga cualquiera
      // que abra la app, así que la primera visita del día aplica las que
      // tocaban. Va ANTES de `asegurarEmpleado` a propósito — si quien entra es
      // justo el que se retiró ayer, su ficha se apaga primero y el upsert la
      // respeta (su `ON CONFLICT DO NOTHING` no revive una ficha inactiva), que
      // es exactamente lo que debe pasar.
      //
      // El error se traga: una baja sin aplicar no puede impedir que la app
      // arranque. Volverá a intentarse en la siguiente visita.
      await repo.aplicarRetirosVencidos(db, hoyEnColombia()).catch(() => {});
```

- [ ] **Step 5: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (8 tests)

Run: `cd apps/hub-api && npx vitest run`
Expected: PASS, 1013 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): el barrido aplica las bajas programadas que vencen"
```

---

## Task 5: Las dos consultas de bloqueo

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`diasPosterioresA`, `personasACargoDe`)
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir `diasPosterioresA` y `personasACargoDe` al import de `./repo.js`, y `sembrarSolicitud` al de `../test-db/harness.js`:

```ts
describe('diasPosterioresA', () => {
  it('encuentra las vacaciones vivas o aprobadas que pasan de la fecha', async () => {
    const id = await sembrarEmpleado(db, 'pos@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'pos@baja.test',
      estado: 'aprobada',
      fechaInicio: '2026-10-05',
      fechaFin: '2026-10-09',
      segundoAprobadorCorreo: null,
    });
    const chocan = await diasPosterioresA(db, id, '2026-09-30');
    expect(chocan).toHaveLength(1);
    expect(chocan[0].fechaFin).toBe('2026-10-09');
  });

  it('CANDADO: lo ANTERIOR a la fecha no estorba', async () => {
    // Es legitimo y corriente: quien se va el 30 de septiembre puede tener
    // vacaciones pendientes de firma para la semana que viene.
    const id = await sembrarEmpleado(db, 'ant@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'ant@baja.test',
      estado: 'pendiente',
      fechaInicio: '2026-09-07',
      fechaFin: '2026-09-11',
      segundoAprobadorCorreo: null,
    });
    expect(await diasPosterioresA(db, id, '2026-09-30')).toHaveLength(0);
  });

  it('CANDADO: una rechazada posterior tampoco estorba', async () => {
    // Solo cuentan las que consumen dias. Bloquear por una rechazada obligaria
    // a limpiar historia para poder dar de baja a alguien.
    const id = await sembrarEmpleado(db, 'rech@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'rech@baja.test',
      estado: 'rechazada',
      fechaInicio: '2026-10-05',
      fechaFin: '2026-10-09',
      segundoAprobadorCorreo: null,
    });
    expect(await diasPosterioresA(db, id, '2026-09-30')).toHaveLength(0);
  });

  it('el dia exacto de la fecha NO estorba: es su ultimo dia', async () => {
    const id = await sembrarEmpleado(db, 'exacto@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'exacto@baja.test',
      estado: 'aprobada',
      fechaInicio: '2026-09-28',
      fechaFin: '2026-09-30',
      segundoAprobadorCorreo: null,
    });
    expect(await diasPosterioresA(db, id, '2026-09-30')).toHaveLength(0);
  });
});

describe('personasACargoDe', () => {
  it('encuentra a quien lo tiene de jefe', async () => {
    await sembrarEmpleado(db, 'jefe@baja.test');
    await sembrarEmpleado(db, 'subordinado@baja.test', 'jefe@baja.test');
    const gente = await personasACargoDe(db, 'jefe@baja.test');
    expect(gente).toEqual(['Ana Ruiz']);
  });

  it('encuentra a quien lo tiene en copia', async () => {
    await sembrarEmpleado(db, 'copia@baja.test');
    const otro = await sembrarEmpleado(db, 'otro@baja.test');
    await db.query('UPDATE portal.empleados SET copia_correo = $2 WHERE id = $1', [
      otro,
      'copia@baja.test',
    ]);
    expect(await personasACargoDe(db, 'copia@baja.test')).toEqual(['Ana Ruiz']);
  });

  it('CANDADO: una ficha ya inactiva no cuenta', async () => {
    // Si contara, no se podria dar de baja a un jefe cuyo equipo ya se fue.
    await sembrarEmpleado(db, 'jefe2@baja.test');
    const sub = await sembrarEmpleado(db, 'exsub@baja.test', 'jefe2@baja.test');
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [sub]);
    expect(await personasACargoDe(db, 'jefe2@baja.test')).toEqual([]);
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — las dos funciones no existen.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/ausencias/repo.ts`:

```ts
/** Una solicitud que estorba a una baja, reducida a lo que el mensaje necesita. */
export interface DiaPosterior {
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  estado: string;
}

/**
 * Las solicitudes de alguien que TERMINAN después de una fecha y que consumen
 * días: las vivas y las ya aprobadas.
 *
 * Es lo que bloquea una baja. Las anteriores a la fecha no se miran a propósito:
 * quien se va el 30 de septiembre puede tener vacaciones pendientes de firma
 * para la semana que viene, y son perfectamente legítimas.
 *
 * `fecha_fin > $2` y no `>=`: la fecha de retiro es su último día trabajado, así
 * que unas vacaciones que acaban justo ese día caben.
 *
 * Las rechazadas, retiradas y caducadas quedan fuera: no consumen nada, y
 * bloquear por ellas obligaría a limpiar historia para poder dar de baja a
 * alguien.
 */
export async function diasPosterioresA(db: Pool, empleadoId: string, fecha: string): Promise<DiaPosterior[]> {
  const { rows } = await db.query(
    `SELECT tipo, fecha_inicio::text AS fecha_inicio, fecha_fin::text AS fecha_fin, estado
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1
        AND fecha_fin > $2::date
        AND estado IN ('pendiente', 'pendiente_2', 'aprobada', 'registrada')
      ORDER BY fecha_inicio`,
    [empleadoId, fecha],
  );
  return (rows as { tipo: string; fecha_inicio: string; fecha_fin: string; estado: string }[]).map((r) => ({
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    estado: r.estado,
  }));
}

/**
 * Los nombres de quienes tienen a este correo como jefe o en copia.
 *
 * `WHERE activo` porque una ficha ya inactiva no necesita que nadie le firme
 * nada: sin eso, no se podría dar de baja a un jefe cuyo equipo ya se fue.
 */
export async function personasACargoDe(db: Pool, correo: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT nombre_completo
       FROM portal.empleados
      WHERE activo
        AND (lower(aprobador_correo) = lower($1) OR lower(copia_correo) = lower($1))
      ORDER BY nombre_completo`,
    [correo],
  );
  return (rows as { nombre_completo: string }[]).map((r) => r.nombre_completo);
}
```

- [ ] **Step 4: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): las dos consultas que bloquean una baja incoherente"
```

---

## Task 6: Registrar y deshacer la baja (repo)

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`fijarRetiro`, `limpiarRetiro`)
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir `fijarRetiro` y `limpiarRetiro` al import de `./repo.js`:

```ts
describe('fijarRetiro / limpiarRetiro', () => {
  it('guarda la fecha y la constancia, sin desactivar todavia', async () => {
    const id = await sembrarEmpleado(db, 'fijar@baja.test');
    expect(await fijarRetiro(db, id, '2026-12-31', 'admin@ambientalia.com.co')).toBe(true);
    const { rows } = await db.query(
      `SELECT fecha_retiro::text AS fecha_retiro, retirado_por, retirado_at, activo
         FROM portal.empleados WHERE id = $1`,
      [id],
    );
    expect(rows[0].fecha_retiro).toBe('2026-12-31');
    expect(rows[0].retirado_por).toBe('admin@ambientalia.com.co');
    expect(rows[0].retirado_at).not.toBeNull();
    // Fecha futura: sigue trabajando. Lo apaga el barrido cuando venza.
    expect(rows[0].activo).toBe(true);
  });

  it('limpiarRetiro deshace la baja y reactiva', async () => {
    const id = await sembrarEmpleado(db, 'volver@baja.test');
    await fijarRetiro(db, id, '2026-08-20', 'admin@ambientalia.com.co');
    await aplicarRetirosVencidos(db, '2026-08-24');
    expect(await limpiarRetiro(db, id)).toBe(true);
    const { rows } = await db.query(
      `SELECT fecha_retiro, retirado_por, retirado_at, activo
         FROM portal.empleados WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      fecha_retiro: null,
      retirado_por: null,
      retirado_at: null,
      activo: true,
    });
  });

  it('CANDADO: fijarRetiro SI alcanza a una ficha ya inactiva', async () => {
    // Al reves que fijarSaldo y fijarJefe, que llevan `AND activo`. Aqui seria
    // un error: una ficha desactivada a mano —las cuentas de prueba— tiene que
    // poder recibir su fecha despues. Sin esto quedarian sin via de arreglo.
    const id = await sembrarEmpleado(db, 'inactiva@baja.test');
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [id]);
    expect(await fijarRetiro(db, id, '2026-08-20', 'admin@ambientalia.com.co')).toBe(true);
  });

  it('devuelve false si el empleado no existe', async () => {
    const inventado = '00000000-0000-4000-8000-000000000000';
    expect(await fijarRetiro(db, inventado, '2026-08-20', 'admin@ambientalia.com.co')).toBe(false);
    expect(await limpiarRetiro(db, inventado)).toBe(false);
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — las funciones no existen.

- [ ] **Step 3: Implementar**

```ts
/**
 * Registra la baja: la fecha y quién la puso. Devuelve false si no existía.
 *
 * ⚠️ SIN `AND activo`, al revés que `fijarSaldo` y `fijarJefe`. Aquí ese filtro
 * sería un error: una ficha desactivada a mano —como las dos cuentas de prueba
 * del 2026-08-24— tiene que poder recibir su fecha después, y con el `AND
 * activo` se quedaría para siempre sin vía de arreglo desde la app.
 *
 * NO toca `activo`. Una baja con fecha futura deja a la persona trabajando; de
 * apagarla se encarga `aplicarRetirosVencidos` cuando llegue el día. Separarlo
 * es lo que permite que una baja programada sea solo un dato hasta que vence.
 */
export async function fijarRetiro(
  db: Pool,
  empleadoId: string,
  fechaRetiro: string,
  adminEmail: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE portal.empleados
        SET fecha_retiro = $2::date, retirado_por = $3, retirado_at = NOW()
      WHERE id = $1`,
    [empleadoId, fechaRetiro, adminEmail.toLowerCase()],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Deshace una baja: limpia las tres columnas y reactiva. False si no existía. */
export async function limpiarRetiro(db: Pool, empleadoId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE portal.empleados
        SET fecha_retiro = NULL, retirado_por = NULL, retirado_at = NULL, activo = true
      WHERE id = $1`,
    [empleadoId],
  );
  return (res.rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (19 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): registrar y deshacer la baja en el repo"
```

---

## Task 7: El servicio con los bloqueos

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (`retirarEmpleado`, `reactivarEmpleado`)
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts` (sección de servicio)

- [ ] **Step 1: Escribir el test que falla**

Añadir al import de `./service.js` en el fichero de test: `import { retirarEmpleado, reactivarEmpleado } from './service.js';`

```ts
describe('retirarEmpleado', () => {
  const ADMIN = 'admin@ambientalia.com.co';

  it('registra la baja cuando no hay nada que estorbe', async () => {
    const id = await sembrarEmpleado(db, 'ok@baja.test');
    const e = await retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN);
    expect(e.fechaRetiro).toBe('2026-09-30');
    expect(e.retiradoPor).toBe(ADMIN);
  });

  it('409 si tiene dias posteriores a la fecha', async () => {
    const id = await sembrarEmpleado(db, 'choca@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'choca@baja.test',
      estado: 'aprobada',
      fechaInicio: '2026-10-05',
      fechaFin: '2026-10-09',
      segundoAprobadorCorreo: null,
    });
    await expect(retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN)).rejects.toMatchObject({
      code: 'retiro_con_dias_posteriores',
      status: 409,
    });
  });

  it('409 si alguien lo tiene de jefe', async () => {
    await sembrarEmpleado(db, 'jefe3@baja.test');
    await sembrarEmpleado(db, 'sub3@baja.test', 'jefe3@baja.test');
    const { rows } = await db.query('SELECT id FROM portal.empleados WHERE correo = $1', [
      'jefe3@baja.test',
    ]);
    await expect(
      retirarEmpleado(db, (rows[0] as { id: string }).id, { fechaRetiro: '2026-09-30' }, ADMIN),
    ).rejects.toMatchObject({ code: 'retiro_con_personas_a_cargo', status: 409 });
  });

  it('400 si la fecha no es una fecha', async () => {
    const id = await sembrarEmpleado(db, 'malafecha@baja.test');
    await expect(retirarEmpleado(db, id, { fechaRetiro: '30/09/2026' }, ADMIN)).rejects.toMatchObject({
      code: 'fecha_retiro_invalida',
      status: 400,
    });
  });

  it('404 si el empleado no existe', async () => {
    await expect(
      retirarEmpleado(db, '00000000-0000-4000-8000-000000000000', { fechaRetiro: '2026-09-30' }, ADMIN),
    ).rejects.toMatchObject({ code: 'empleado_no_encontrado', status: 404 });
  });

  it('reactivarEmpleado deshace la baja', async () => {
    const id = await sembrarEmpleado(db, 'reac@baja.test');
    await retirarEmpleado(db, id, { fechaRetiro: '2026-09-30' }, ADMIN);
    const e = await reactivarEmpleado(db, id);
    expect(e.fechaRetiro).toBeNull();
    expect(e.activo).toBe(true);
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — las funciones no existen.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/ausencias/service.ts`:

```ts
/**
 * Registra la baja de un empleado. Solo admin (lo exige el router).
 *
 * Bloquea en vez de arreglar por su cuenta, y es una decisión de diseño, no
 * pereza: el saldo que queda congelado es lo que se le paga a esa persona, así
 * que el sistema no cierra solicitudes ajenas ni recorta días. Dice qué falta y
 * el admin lo resuelve.
 *
 * Lo que NO bloquea son los días anteriores a la fecha: quien se va el 30 de
 * septiembre puede tener vacaciones pendientes de firma para la semana que
 * viene, y su jefe las firmará con normalidad — la bandeja no filtra por
 * `activo`, así que sigue viéndolas incluso después de que la baja se aplique.
 */
export async function retirarEmpleado(
  db: Pool,
  empleadoId: string,
  body: unknown,
  adminEmail: string,
): Promise<Empleado> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const fecha = typeof b.fechaRetiro === 'string' ? b.fechaRetiro.trim() : '';
  // `esFechaValida` y no un parseo laxo: 'YYYY-MM-DD' es el formato con el que
  // esta fecha se compara lexicográficamente contra otras (el barrido, el
  // congelado). Una '30/09/2026' compilaría y rompería esas comparaciones en
  // silencio, que es el gotcha que documenta `sumarDesdeElCorte`.
  if (!esFechaValida(fecha)) throw new AusenciaError('fecha_retiro_invalida', 400, 'fechaRetiro');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  const posteriores = await repo.diasPosterioresA(db, empleadoId, fecha);
  if (posteriores.length > 0) {
    // El detalle es obligatorio, no decorativo: «no puedes» sin decir cuáles es
    // inaccionable, y el admin tendría que buscarlas a mano en el registro.
    throw new AusenciaError('retiro_con_dias_posteriores', 409, 'fechaRetiro', {
      solicitudes: posteriores,
    });
  }

  const aCargo = await repo.personasACargoDe(db, empleado.correo);
  if (aCargo.length > 0) {
    throw new AusenciaError('retiro_con_personas_a_cargo', 409, 'fechaRetiro', { personas: aCargo });
  }

  if (!(await repo.fijarRetiro(db, empleadoId, fecha, adminEmail))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  // Se relee en vez de construir la respuesta a mano: `retirado_at` lo pone la
  // BD con NOW(), así que el único sitio donde está el valor real es la fila.
  const actualizado = await repo.empleadoPorId(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/** Deshace una baja y devuelve la ficha a la lista de activos. Solo admin. */
export async function reactivarEmpleado(db: Pool, empleadoId: string): Promise<Empleado> {
  if (!(await repo.limpiarRetiro(db, empleadoId))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  const actualizado = await repo.empleadoPorId(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}
```

**Ojo:** `repo.empleadoPorId` lleva hoy `AND activo` en su consulta. Para que `reactivarEmpleado` y la relectura de `retirarEmpleado` funcionen sobre fichas inactivas, añadir en `repo.ts` una hermana sin ese filtro y usarla en las dos funciones nuevas:

```ts
/**
 * La ficha por id, ACTIVA O NO. Hermana de `empleadoPorId`, que lleva `AND
 * activo` porque casi todo el código solo quiere fichas vivas.
 *
 * Existe para la baja: sin ella, reactivar a alguien no podría releer la fila
 * que acaba de tocar, y `retirarEmpleado` devolvería 404 justo cuando la baja
 * acaba de aplicarse.
 */
export async function empleadoPorIdIncluyendoInactivos(db: Pool, id: string): Promise<Empleado | null> {
  const { rows } = await db.query(`SELECT ${COLS_EMPLEADO} FROM portal.empleados WHERE id = $1`, [id]);
  return rows[0] ? aEmpleado(rows[0] as FilaEmpleadoDb) : null;
}
```

Usar `repo.empleadoPorIdIncluyendoInactivos` en las **relecturas** de las dos funciones y en la búsqueda inicial de `retirarEmpleado`.

- [ ] **Step 4: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (25 tests)

Run: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): el servicio de baja bloquea lo que dejaria incoherente"
```

---

## Task 8: Los dos endpoints

**Files:**
- Modify: `apps/hub-api/src/ausencias/router.ts` (junto al resto de `PUT /empleados/:id/...`, sobre la línea 412)
- Test: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Step 1: Escribir el test que falla**

En `apps/hub-api/src/ausencias/router.test.ts`, siguiendo el patrón de los tests de `PUT /empleados/:id/jefe` que ya hay en ese fichero (localizarlos con `grep -n "empleados/.*jefe" router.test.ts`), añadir:

```ts
  it('PUT /empleados/:id/retiro sin ser admin → 403', async () => {
    const res = await request(app)
      .put('/api/ausencias/empleados/emp-1/retiro')
      .set(bearer(tokenLector))
      .send({ fechaRetiro: '2026-09-30' });
    expect(res.status).toBe(403);
  });

  it('DELETE /empleados/:id/retiro sin ser admin → 403', async () => {
    const res = await request(app)
      .delete('/api/ausencias/empleados/emp-1/retiro')
      .set(bearer(tokenLector));
    expect(res.status).toBe(403);
  });
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/router.test.ts`
Expected: FAIL — 404 en vez de 403 (la ruta no existe).

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/ausencias/router.ts`, después del bloque de `visor-empresa`:

```ts
  /**
   * Registra la baja de un empleado que se va de la compañía.
   *
   * `sesionDe(req).email` y no un campo del body: quién retira a alguien es un
   * dato de la sesión, no algo que el cliente pueda decir. El saldo que queda
   * congelado es lo que se le paga a esa persona, y la constancia de quién lo
   * fijó tiene que ser fiable — la misma razón por la que la firma de los
   * correos de decisión sale de la sesión.
   */
  router.put('/ausencias/empleados/:id/retiro', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.retirarEmpleado(db, req.params.id, req.body, sesionDe(req).email));
    } catch (e) {
      sendError(res, e, 'ausencias_retirar_empleado');
    }
  });

  /** Deshace una baja. DELETE del recurso «retiro», no de la ficha. */
  router.delete('/ausencias/empleados/:id/retiro', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.reactivarEmpleado(db, req.params.id));
    } catch (e) {
      sendError(res, e, 'ausencias_reactivar_empleado');
    }
  });
```

- [ ] **Step 4: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/router.test.ts`
Expected: PASS

Run: `cd apps/hub-api && npx vitest run`
Expected: PASS, 1015 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): endpoints de registrar y deshacer la baja"
```

---

## Task 9: No pedir días más allá del último día

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (`crearSolicitud`)
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('no se piden dias mas alla del retiro', () => {
  it('409 al pedir vacaciones que terminan despues de la fecha de retiro', async () => {
    const id = await sembrarEmpleado(db, 'limite@baja.test');
    await fijarRetiro(db, id, '2026-09-30', 'admin@ambientalia.com.co');
    await expect(
      crearSolicitud(
        db,
        { email: 'limite@baja.test', userId: null, esAdmin: false },
        { tipo: 'vacaciones', fechaInicio: '2026-10-05', fechaFin: '2026-10-09', comentarios: '' },
      ),
    ).rejects.toMatchObject({ code: 'fecha_posterior_al_retiro', status: 409 });
  });

  it('CANDADO: hasta su ultimo dia SI puede pedir', async () => {
    const id = await sembrarEmpleado(db, 'hasta@baja.test');
    await fijarRetiro(db, id, '2026-09-30', 'admin@ambientalia.com.co');
    const s = await crearSolicitud(
      db,
      { email: 'hasta@baja.test', userId: null, esAdmin: false },
      { tipo: 'vacaciones', fechaInicio: '2026-09-28', fechaFin: '2026-09-30', comentarios: '' },
    );
    expect(s.estado).toBe('pendiente');
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — el primero crea la solicitud en vez de lanzar.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/ausencias/service.ts`, dentro de `crearSolicitud`, justo después de `const empleado = await empleadoDeSesion(db, sesion);`:

```ts
  // La otra mitad del bloqueo de la baja: allí se impide fijar una fecha que
  // deje días huérfanos detrás, y aquí se impide crear esos días después. Sin
  // las dos, la regla se puede saltar por el otro extremo.
  //
  // Va aquí y no en `validarNuevaSolicitud` porque esa función es pura y no
  // conoce la ficha; mismo criterio que `exigirSinSolape` y
  // `exigirVacacionesSuficientes`.
  if (empleado.fechaRetiro !== null && datos.fechaFin > empleado.fechaRetiro) {
    throw new AusenciaError('fecha_posterior_al_retiro', 409, 'fechaFin', {
      fechaRetiro: empleado.fechaRetiro,
    });
  }
```

- [ ] **Step 4: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (27 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): nadie pide dias mas alla de su ultimo dia"
```

---

## Task 10: La lista de retirados con su saldo congelado

⚠️ **Esta tarea existe porque `empleadosConSaldo` lleva `WHERE e.activo`.** Un
retirado no sale de esa consulta, así que la vista de Retirados no tendría de
dónde sacar el saldo congelado — que es justo a lo que se viene. Hace falta una
consulta propia; ampliar `empleadosConSaldo` con una bandera se descartó porque
esa función la comparten el panel de Saldos y `ramaDeDosNiveles()`, y un
parámetro mal pasado colaría retirados en la pantalla de todos.

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`retiradosConSaldo`, `solicitudesVivasDe`)
- Modify: `apps/hub-api/src/ausencias/service.ts` (`listaDeRetirados`)
- Modify: `apps/hub-api/src/ausencias/router.ts` (`GET /ausencias/empleados/retirados`)
- Test: `apps/hub-api/src/ausencias/repo.baja.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('listaDeRetirados', () => {
  const ADMIN = 'admin@ambientalia.com.co';

  it('devuelve al retirado con su saldo CONGELADO en la fecha de retiro', async () => {
    const id = await sembrarEmpleado(db, 'liq@baja.test');
    await db.query(
      `UPDATE portal.empleados SET saldo_corte = 10, fecha_corte = '2026-01-01' WHERE id = $1`,
      [id],
    );
    await fijarRetiro(db, id, '2026-03-01', ADMIN);
    await aplicarRetirosVencidos(db, '2026-08-24');

    const lista = await listaDeRetirados(db);
    expect(lista).toHaveLength(1);
    // Dos meses de devengo (enero y febrero), no siete. Si esto trae el devengo
    // hasta hoy, la congelacion no esta llegando a esta consulta.
    expect(lista[0].saldo.devengadas).toBeCloseTo(2.5, 1);
    expect(lista[0].fechaRetiro).toBe('2026-03-01');
    expect(lista[0].retiradoPor).toBe(ADMIN);
  });

  it('cuenta las solicitudes vivas, que son las que pueden mover el numero', async () => {
    const id = await sembrarEmpleado(db, 'viva@baja.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'viva@baja.test',
      estado: 'pendiente',
      fechaInicio: '2026-02-02',
      fechaFin: '2026-02-04',
      segundoAprobadorCorreo: null,
    });
    await fijarRetiro(db, id, '2026-03-01', ADMIN);
    await aplicarRetirosVencidos(db, '2026-08-24');

    const lista = await listaDeRetirados(db);
    expect(lista[0].solicitudesVivas).toBe(1);
  });

  it('CANDADO: una ficha desactivada a mano, sin fecha, tambien sale', async () => {
    // Son las dos cuentas de prueba del 2026-08-24. Si no salieran aqui, no
    // apareceririan en ninguna de las dos vistas.
    const id = await sembrarEmpleado(db, 'prueba@baja.test');
    await db.query('UPDATE portal.empleados SET activo = false WHERE id = $1', [id]);
    const lista = await listaDeRetirados(db);
    expect(lista).toHaveLength(1);
    expect(lista[0].fechaRetiro).toBeNull();
  });

  it('no devuelve a nadie activo', async () => {
    await sembrarEmpleado(db, 'sigue@baja.test');
    expect(await listaDeRetirados(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL — `listaDeRetirados is not a function`.

- [ ] **Step 3: Las dos consultas del repo**

```ts
/**
 * Las fichas INACTIVAS con su configuración de saldo.
 *
 * Hermana de `empleadosConSaldo`, que lleva `WHERE e.activo` y por eso no puede
 * servir a esta pantalla. No se unificaron con una bandera: aquella la comparte
 * el panel de Saldos y `ramaDeDosNiveles()`, y un parámetro mal pasado colaría
 * retirados en la pantalla de todo el mundo. Dos consultas separadas no pueden
 * equivocarse de público.
 *
 * Sin `ramaDeDosNiveles()`: esto solo lo sirve un endpoint de admin.
 */
export async function retiradosConSaldo(db: Pool): Promise<EmpleadoConSaldo[]> {
  const { rows } = await db.query(
    `SELECT e.id, e.nombre_completo, e.correo,
            e.saldo_corte::float8 AS saldo_corte,
            e.fecha_corte::text   AS fecha_corte,
            e.compensatorios_saldo_corte::float8 AS compensatorios_saldo_corte,
            e.compensatorios_fecha_corte::text   AS compensatorios_fecha_corte,
            e.fecha_retiro::text  AS fecha_retiro
       FROM portal.empleados e
      WHERE NOT e.activo
      ORDER BY e.fecha_retiro DESC NULLS LAST, e.nombre_completo`,
  );
  return (rows as FilaEmpleadoSaldoDb[]).map(aEmpleadoConSaldo);
}

/**
 * Cuántas solicitudes vivas tiene cada uno de estos empleados.
 *
 * «Vivas» es esperando firma, no «posteriores a una fecha»: mientras quede una,
 * su saldo todavía puede moverse, porque la bandeja del jefe NO filtra por
 * `activo` y puede firmarla después del retiro. Es la diferencia entre un número
 * provisional y el que se paga.
 */
export async function solicitudesVivasDe(db: Pool, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT empleado_id, COUNT(*)::int AS vivas
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = ANY($1::uuid[])
        AND estado IN ('pendiente', 'pendiente_2')
      GROUP BY empleado_id`,
    [ids],
  );
  return new Map((rows as { empleado_id: string; vivas: number }[]).map((r) => [r.empleado_id, r.vivas]));
}
```

- [ ] **Step 4: El servicio**

En `service.ts`:

```ts
/** Una ficha retirada, con lo que hace falta para liquidarla. */
export interface Retirado extends SaldoDeEmpleado {
  fechaRetiro: string | null;
  retiradoPor: string | null;
  /** Mientras sea > 0, el saldo de arriba todavía puede moverse. */
  solicitudesVivas: number;
  /**
   * True cuando la fecha de retiro es ANTERIOR al corte del saldo. Aritméticamente
   * da un devengo de cero y no revienta, pero casi siempre significa que alguien
   * se equivocó de año al teclear. Se avisa, no se bloquea.
   */
  retiroAntesDelCorte: boolean;
}

/** Las fichas retiradas con su saldo ya congelado. Solo admin (lo exige el router). */
export async function listaDeRetirados(db: Pool): Promise<Retirado[]> {
  const fichas = await repo.retiradosConSaldo(db);
  if (fichas.length === 0) return [];
  const ids = fichas.map((f) => f.empleadoId);
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, ids);
  const vivas = await repo.solicitudesVivasDe(db, ids);
  // `combinar` ya congela por ficha vía `hoyCongelado`: pasa el mismo `hoy` y
  // cada una decide el suyo. No hay que congelar nada aquí otra vez.
  const conSaldo = combinar(fichas, ausencias, hoyEnColombia());
  return conSaldo.map((s, i) => ({
    ...s,
    fechaRetiro: fichas[i].fechaRetiro,
    retiradoPor: null,
    solicitudesVivas: vivas.get(s.empleadoId) ?? 0,
    retiroAntesDelCorte:
      fichas[i].fechaRetiro !== null &&
      s.saldo.configurado &&
      fichas[i].fechaRetiro < s.saldo.fechaCorte,
  }));
}
```

**Ojo:** `EmpleadoConSaldo` no trae `retiradoPor`. Añadirlo igual que `fechaRetiro` en la Task 3 (campo en la interfaz, columna `retirado_por` en `retiradosConSaldo` y en `empleadosConSaldo`, y el mapeo en `aEmpleadoConSaldo`), y sustituir el `retiradoPor: null` de arriba por `fichas[i].retiradoPor`.

- [ ] **Step 5: El endpoint**

En `router.ts`, junto a los demás de empleados:

```ts
  /** Las fichas retiradas con su saldo congelado. Es la vista de liquidación. */
  router.get('/ausencias/empleados/retirados', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ retirados: await service.listaDeRetirados(db) });
    } catch (e) {
      sendError(res, e, 'ausencias_retirados');
    }
  });
```

- [ ] **Step 6: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: PASS (31 tests)

Run: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: sin salida; 1015 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/repo.baja.db.test.ts
git commit -m "feat(ausencias): la lista de retirados con el saldo congelado"
```

---

## Task 11: El cliente y la interfaz

**Files:**
- Modify: `apps/ausencias/src/api.ts`
- Modify: `apps/ausencias/src/ImportarEmpleados.tsx`

- [ ] **Step 1: Ampliar el tipo y añadir las llamadas**

En `apps/ausencias/src/api.ts`, en la interfaz `Empleado`, añadir los tres campos —**este fichero es un espejo manual del backend, sin generación ni test de contrato, así que hay que copiarlos a mano y con el mismo nombre**:

```ts
  /** El último día que trabaja. `null` mientras no haya baja registrada. */
  fechaRetiro: string | null;
  retiradoPor: string | null;
  retiradoAt: string | null;
```

Junto a `fijarJefe` (línea ~1015). **No hay helper `del` en este fichero** —solo
`post` y `put` sobre `conCuerpo` (línea 621)—, así que el DELETE se escribe a
mano con el mismo patrón que `borrarSolicitud` (línea ~957), con la diferencia de
que este sí lee la respuesta:

```ts
/** Registra la baja. La fecha es el último día que trabaja. */
export const fijarRetiro = (id: string, fechaRetiro: string) =>
  put<Empleado>(`/api/ausencias/empleados/${encodeURIComponent(id)}/retiro`, { fechaRetiro });

/** Deshace una baja y devuelve la ficha a Activos. */
export async function reactivarEmpleado(id: string): Promise<Empleado> {
  const res = await fetch(`${API_BASE}/api/ausencias/empleados/${encodeURIComponent(id)}/retiro`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return (await res.json()) as Empleado;
}

/** Una ficha retirada con su saldo ya congelado. Espejo manual de `Retirado`. */
export interface Retirado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
  fechaRetiro: string | null;
  retiradoPor: string | null;
  solicitudesVivas: number;
  retiroAntesDelCorte: boolean;
}

export const fetchRetirados = () =>
  get<{ retirados: Retirado[] }>('/api/ausencias/empleados/retirados').then((d) => d.retirados);
```

- [ ] **Step 2: Las dos vistas en el panel**

En `apps/ausencias/src/ImportarEmpleados.tsx`:

```tsx
  const [vista, setVista] = useState<'activos' | 'retirados'>('activos');

  // Un retirado es una ficha apagada. Se mira `activo` y no `fechaRetiro`
  // porque las fichas que se desactivaron a mano antes de esta feature —las dos
  // cuentas de prueba— no tienen fecha, y esconderlas de las dos vistas las
  // dejaría sin ningún sitio donde aparecer.
  const visibles = empleados.filter((e) => (vista === 'activos' ? e.activo : !e.activo));
```

Selector encima de la tabla:

```tsx
  <div className="mb-3 flex gap-2">
    {(['activos', 'retirados'] as const).map((v) => (
      <button
        key={v}
        type="button"
        onClick={() => setVista(v)}
        className={`rounded-xl border px-3 py-1.5 text-sm ${
          vista === v ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-300 text-gray-700'
        }`}
      >
        {v === 'activos' ? 'Activos' : 'Retirados'}
      </button>
    ))}
  </div>
```

En la vista `activos`, cada fila lleva la etiqueta de salida prevista y el botón:

```tsx
  {e.fechaRetiro && (
    <span className="rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
      Sale el {formatFecha(e.fechaRetiro)}
    </span>
  )}
```

La vista `retirados` **no se pinta desde `empleados`**: se carga con
`fetchRetirados()` al entrar en ella, porque el saldo congelado y el recuento de
solicitudes vivas solo vienen de ese endpoint.

```tsx
  const [retirados, setRetirados] = useState<Retirado[]>([]);

  useEffect(() => {
    if (vista !== 'retirados') return;
    fetchRetirados().then(setRetirados).catch((e) => setError((e as Error).message));
  }, [vista, recarga]);
```

Y cada fila:

```tsx
  <td className="px-4 py-3">{r.nombreCompleto}</td>
  <td className="px-4 py-3">
    {r.fechaRetiro ? formatFecha(r.fechaRetiro) : <span className="text-gray-400">sin fecha</span>}
  </td>
  <td className="px-4 py-3 text-gray-500">{r.retiradoPor ?? '—'}</td>
  <td className="px-4 py-3 text-right tabular-nums">
    <b>{formatDias(r.saldo.disponible)}</b> días
    {/* Sin esto, alguien pagaría un número provisional creyéndolo definitivo:
        la bandeja del jefe no filtra por `activo`, así que una solicitud viva
        todavía puede firmarse y mover el saldo. */}
    {r.solicitudesVivas > 0 && (
      <p className="mt-0.5 text-xs font-medium text-amber-700">
        {r.solicitudesVivas} {r.solicitudesVivas === 1 ? 'solicitud' : 'solicitudes'} sin firmar — el
        saldo puede moverse
      </p>
    )}
    {/* El riesgo 3 del diseño: se avisa, no se bloquea. Casi siempre es un año
        mal tecleado, pero puede ser legítimo y no es esta pantalla quien debe
        decidirlo. */}
    {r.retiroAntesDelCorte && (
      <p className="mt-0.5 text-xs font-medium text-red-700">
        La fecha de retiro es anterior al corte del saldo: revisa que sea correcta.
      </p>
    )}
  </td>
  <td className="px-4 py-3 text-right">
    <button
      type="button"
      onClick={() => reactivarEmpleado(r.empleadoId).then(() => setRecarga((n) => n + 1))}
      className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
    >
      Reactivar
    </button>
  </td>
```

`setRecarga` es un contador `useState(0)` que dispara el `useEffect` de arriba y
recarga también `fetchEmpleados()`, para que la ficha reaparezca en Activos sin
recargar la página.

- [ ] **Step 3: Comprobar**

Run: `cd apps/ausencias && npx tsc --noEmit`
Expected: sin salida. **Es el único portón de esta app: no tiene tests.**

Run: `cd apps/ausencias && npx vite build`
Expected: `✓ built in ...`

- [ ] **Step 4: Commit**

```bash
git add apps/ausencias/src/api.ts apps/ausencias/src/ImportarEmpleados.tsx
git commit -m "feat(ausencias): vistas de activos y retirados en la pestana Empleados"
```

---

## Task 12: Falsar los candados

El método que más ha rendido en este repo: romper el código de verdad y ver morir el test que dice vigilarlo. Un candado que no se falsa no es un candado.

- [ ] **Step 1: Asegurarse de que no queda nada sin commitear**

Run: `git status --short`
Expected: solo los untracked de siempre (`apps/WO-sales/prompts/`, `img/`). **Si hay algo modificado, commitearlo antes**: el `git checkout --` de revertir cada mutación se lleva por delante lo no commiteado.

- [ ] **Step 2: Mutar el barrido de `<` a `<=`**

En `repo.ts`, `aplicarRetirosVencidos`: cambiar `fecha_retiro < $1::date` por `fecha_retiro <= $1::date`.

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL en «el DIA del retiro sigue activo». Si pasa, el candado no vale y hay que arreglarlo.

Revertir: `git checkout -- apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 3: Mutar `hoyCongelado` a `<=`**

Cambiar `fechaRetiro < hoy` por `fechaRetiro <= hoy`.

Run: `cd apps/hub-api && npx vitest run src/ausencias/saldo.test.ts`
Expected: el test del día exacto sigue en verde (los dos caminos dan el mismo string), así que **este candado NO muerde por sí solo** — el que de verdad protege la regla es el del barrido. Anotarlo y seguir: es una limitación real, no un fallo.

Revertir: `git checkout -- apps/hub-api/src/ausencias/service.ts`

- [ ] **Step 4: Mutar el filtro de estados de `diasPosterioresA`**

Cambiar `AND estado IN ('pendiente', 'pendiente_2', 'aprobada', 'registrada')` por `AND ($3::text IS NULL OR TRUE)` — **conservando la aridad**: una mutación a `WHERE TRUE` a secas rompe el binding y los tests mueren de error de conexión, no de dato mal filtrado, que es una falsación falsa. Añadir el tercer parámetro al array.

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL en «una rechazada posterior tampoco estorba».

Revertir: `git checkout -- apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 5: Mutar el `WHERE activo` de `personasACargoDe`**

Quitarlo.

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL en «una ficha ya inactiva no cuenta».

Revertir: `git checkout -- apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 6: Sacar la 035 del array `MIGRATIONS`**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.baja.db.test.ts`
Expected: FAIL en el CANDADO de las tres columnas.

Revertir: `git checkout -- apps/hub-api/src/db.ts`

- [ ] **Step 7: Confirmar que todo vuelve a estar verde**

Run: `git status --short` → sin modificados.
Run: `cd apps/hub-api && npx vitest run` → 1015 en verde.
Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts` → todo en verde.

---

## Task 13: Cerrar

- [ ] **Step 1: Las tres suites y los dos typecheck**

```bash
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vitest run --config vitest.db.config.ts
cd ../ausencias && npx tsc --noEmit && npx vite build
cd ../portal && npx vitest run
```

Expected: hub-api 1015 ✓ y la suite de BD entera ✓; ausencias compila y construye; portal **65 ✓ / 11 ✗** — esos 11 son los conocidos de Node 26 (`Sidebar` 7 + `useDashboardLayout` 4, todos `localStorage.clear()`). Cualquier otro fallo del portal es real.

- [ ] **Step 2: Mezclar y desplegar**

```bash
git checkout main
git merge --no-ff feat/baja-de-empleados -m "merge: baja de empleados que se retiran de la compania"
git push origin main
```

⚠️ **El push ES el despliegue.** EasyPanel reconstruye hub-api primero y el portal después, ~11 min cada uno. El orden importa aquí: la app de ausencias llama a endpoints que solo existen tras el despliegue de hub-api, así que durante esa ventana los botones nuevos darían 404. Es la ventana de siempre y se cierra sola.

- [ ] **Step 3: Comprobar en producción**

Con una ficha de prueba: registrar una baja con fecha futura, comprobar que aparece «Sale el …» en Activos y que la persona sigue pudiendo pedir días anteriores a esa fecha. Después mover la fecha al pasado por el panel y recargar la app: el barrido debe pasarla a Retirados con su saldo congelado.
