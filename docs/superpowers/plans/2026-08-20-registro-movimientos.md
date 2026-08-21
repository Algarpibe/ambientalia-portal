# Registro de movimientos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionar «Historial de aprobaciones» dentro de «Registro general», convirtiéndolo en un registro de movimientos —solicitudes, anulaciones y cambios de fecha— visible para todo aprobador acotado a su rama de dos niveles y para el admin completo.

**Architecture:** El servidor gana un endpoint `GET /ausencias/movimientos` que mezcla dos tablas (`portal.solicitudes_ausencia` y `portal.solicitud_modificaciones`) en una lista plana ordenada, recortada por rama a partir de la sesión. El recorte de rama se extrae a un fragmento SQL compartido para que exista una sola vez. Una migración 031 añade el permiso de exportar CSV ficha a ficha, copiando el patrón de `ve_adjuntos`.

**Tech Stack:** Express 4 + TypeScript ESM (imports con `.js`), SQL crudo con `$1`, Vitest 2.1.9, testcontainers contra PostgreSQL 17, React 19.

**Spec:** `docs/superpowers/specs/2026-08-20-registro-movimientos-design.md`

---

## Convenciones de esta casa (leer antes de empezar)

- Código y comentarios **en español**; los comentarios explican **por qué**, no qué.
- JSDoc de `.ts` **con tildes**. Los `.sql` **también llevan tildes**. Los `.db.test.ts` van **sin tildes**. Commits en español **sin tildes**.
- **Nunca `git add -A`**: commitear con rutas explícitas, porque en el árbol conviven cambios del usuario (`apps/WO-sales/prompts/`, `img/`).
- Las migraciones son solo DDL, idempotentes, **se re-ejecutan en cada arranque**, y hay que **añadirlas a mano al array `MIGRATIONS` de `db.ts`** — olvidarlo no da error.
- ⚠️ **Commitear ANTES de mutar código para falsar un candado.** El `git checkout -- <fichero>` con el que se revierte la mutación se lleva por delante todo lo no commiteado de ese fichero.
- Orden de despliegue: **hub-api antes que el portal**. El plan respeta ese orden.

## Estructura de ficheros

**Backend (`apps/hub-api/src/`)**

| Fichero | Responsabilidad | Acción |
| --- | --- | --- |
| `users/migrations/031_registro_exportadores.sql` | Permiso de exportar ficha a ficha + su log | Crear |
| `db.ts` | Array `MIGRATIONS` | Modificar |
| `ausencias/types.ts` | Tipos `Movimiento`, `ClaseMovimiento`, `DecididaPor` | Modificar |
| `ausencias/repo.ts` | `ramaDeDosNiveles`, `movimientos`, `puedeExportarRegistro`, `fijarExportador`; retirar `solicitudesDecididas` y `todasLasSolicitudes` | Modificar |
| `ausencias/service.ts` | Guard + decisión del recorte; retirar `decididasPorMi` | Modificar |
| `ausencias/router.ts` | `GET /ausencias/movimientos`, `PUT /ausencias/empleados/:id/exportador`, contexto; retirar `/historico` y `/decididas` | Modificar |
| `test-db/harness.ts` | `sembrarEmpleado` con aprobador opcional | Modificar |
| `ausencias/repo.movimientos.db.test.ts` | **El candado de la rama** contra Postgres real | Crear |
| `ausencias/router.test.ts` | Doble del repo + candado de superficie | Modificar |

**Frontend (`apps/ausencias/src/`)**

| Fichero | Responsabilidad | Acción |
| --- | --- | --- |
| `api.ts` | Espejo de `Movimiento`; `fetchMovimientos`, `fijarExportador`; retirar `fetchDecididas`, `fetchHistorico` | Modificar |
| `RegistroGeneral.tsx` | Tabla de movimientos, columnas nuevas, filtro de clase, los cuatro candados | Modificar |
| `App.tsx` | Pestaña a `esAprobador \|\| esAdmin`; retirar `historial` | Modificar |
| `PanelOrganigrama.tsx` | Casilla del permiso de exportar | Modificar |
| `HistorialAprobador.tsx` | — | **Borrar** |

---

## Task 1: Migración 031 — el permiso de exportar

**Files:**
- Create: `apps/hub-api/src/users/migrations/031_registro_exportadores.sql`
- Modify: `apps/hub-api/src/db.ts:24`

- [ ] **Step 1: Escribir la migración**

Crear `apps/hub-api/src/users/migrations/031_registro_exportadores.sql`:

```sql
-- Migration 031: quién puede exportar el CSV del registro, ficha por ficha.
--
-- Mismo patrón que la 022 (`ve_adjuntos`) y por el mismo motivo: si la lista de
-- personas vive en el código, añadir a alguien exige tocar código y desplegar.
--
-- ⚠️ Lo que abre este permiso es un fichero con las ausencias de la plantilla:
-- datos personales, con lo que implica la Ley 1581. La lista tiene que quedarse
-- corta y cada persona estar justificada.
--
-- A DIFERENCIA de la 022, aquí NO se siembra a nadie. La 022 tuvo que hacerlo
-- porque venía de una constante del código que había que preservar; aquí no hay
-- nada que preservar, así que la columna nace en FALSE para todos y el
-- administrador da el permiso desde la pestaña Organigrama. Así ningún correo
-- concreto entra en el código.
--
-- El DEFAULT FALSE basta para ser idempotente: `initDb()` re-ejecuta esto en
-- cada arranque, y un ADD COLUMN IF NOT EXISTS no vuelve a tocar los valores.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS exporta_registro BOOLEAN NOT NULL DEFAULT FALSE;

-- El registro de quién dio o quitó el permiso. En BD y no por stdout, por lo
-- mismo que la 022: al salir la lista del código, git deja de ser el historial
-- de estos accesos, y los logs de EasyPanel se rotan.
--
-- Guarda el correo ADEMÁS del id, y sin clave foránea: si la ficha se borra, el
-- registro tiene que seguir diciendo a quién se le dio el permiso.
CREATE TABLE IF NOT EXISTS portal.exportadores_registro_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_email     VARCHAR(254) NOT NULL,
  empleado_id     UUID         NOT NULL,
  empleado_correo VARCHAR(254) NOT NULL,
  concedido       BOOLEAN      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Registrarla en el array `MIGRATIONS`**

En `apps/hub-api/src/db.ts:24`, añadir `'031_registro_exportadores.sql'` al final del array, después de `'030_ausencias_otorgamiento.sql'`.

⚠️ Este paso es el que se olvida y **no da error**: la migración simplemente no se ejecuta nunca.

- [ ] **Step 3: Verificar que aplica contra Postgres real**

Run: `cd apps/hub-api; npm run test:db -- src/db.migraciones.db.test.ts`
Expected: PASS. Ese fichero es el que acredita que todas las migraciones del array aplican limpias e idempotentes.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/users/migrations/031_registro_exportadores.sql apps/hub-api/src/db.ts
git commit -m "feat(ausencias): permiso de exportar el registro ficha a ficha"
```

---

## Task 2: El recorte de rama, extraído a un sitio

Hoy la regla de dos niveles vive dentro de `empleadosConSaldo`. Va a usarla también la consulta de movimientos, y **dos copias que tienen que decir lo mismo fallan en silencio**: la consulta no lanza, solo devuelve de más.

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`empleadosConSaldo`, ~línea 318)

- [ ] **Step 1: Escribir el fragmento compartido**

En `apps/hub-api/src/ausencias/repo.ts`, justo encima de `empleadosConSaldo`:

```ts
/**
 * El recorte por rama: quien pregunta ve a sus subordinados directos y a los de
 * ellos —los «nietos»—, y a nadie más. Con el parámetro a NULL no acota nada,
 * que es lo que necesita un administrador.
 *
 * Existe una sola vez a propósito: lo usan la consulta de saldos y la de
 * movimientos, y tienen que decir EXACTAMENTE lo mismo. Una copia divergente no
 * lanza ni se pone roja — simplemente enseña filas de más, que aquí significa
 * enseñar ausencias de gente que no es de quien mira.
 *
 * Dos niveles y no un CTE recursivo porque es el alcance de lo que ese jefe
 * FIRMA: con la cascada le tocan también las de sus nietos. Un subárbol
 * completo le enseñaría gente cuyas solicitudes no decide nunca.
 *
 * Asume que la tabla `portal.empleados` está aliasada como `e` en la consulta
 * que lo incrusta. Lo cumplen las dos que lo usan.
 */
export function ramaDeDosNiveles(): string {
  return `($1::text IS NULL
           OR lower(e.aprobador_correo) = lower($1)
           OR EXISTS (SELECT 1 FROM portal.empleados j
                       WHERE j.activo
                         AND lower(j.correo) = lower(e.aprobador_correo)
                         AND lower(j.aprobador_correo) = lower($1)))`;
}
```

> **Corrección decidida durante la ejecución.** La firma nació como `ramaDeDosNiveles(placeholder: number)`, y la revisión de calidad señaló —con razón— que la correspondencia entre ese número y la posición real en el array de bindings de `db.query` es una invariante que no comprueba nadie: si una consulta futura pusiera `soloDe` en otra posición y alguien copiara `ramaDeDosNiveles(1)` por costumbre, el filtro de privacidad quedaría atado al parámetro equivocado **en silencio**. Con `$1` fijo, lo que hay que sincronizar pasa de dos sitios a uno, y el JSDoc deja dicho que **`soloDe` va siempre como primer parámetro**. Las dos consultas que lo usan lo cumplen.

- [ ] **Step 2: Usarlo en `empleadosConSaldo`**

Sustituir el bloque `AND ($1::text IS NULL OR lower(e.aprobador_correo) = ... )` de `empleadosConSaldo` por:

```ts
        AND ${ramaDeDosNiveles()}
```

- [ ] **Step 3: Verificar que no se ha roto nada**

Run: `cd apps/hub-api; npm run test:db -- src/ausencias/repo.saldos.db.test.ts`
Expected: PASS, sin cambios. Es una refactorización pura: el SQL generado tiene que ser equivalente.

- [ ] **Step 4: Falsar el candado**

Cambiar `lower(j.aprobador_correo) = lower($${placeholder})` por `TRUE` y volver a correr el test de saldos.
Expected: **FAIL**. Si sigue verde, el test de saldos no cubre el nivel de los nietos y hay que escribirlo antes de seguir.

Revertir con `git checkout -- apps/hub-api/src/ausencias/repo.ts` — **solo si el paso 5 ya está commiteado**. Si no, deshacer el cambio a mano.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts
git commit -m "refactor(ausencias): el recorte por rama existe una sola vez"
```

---

## Task 3: El tipo `Movimiento`

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts`

- [ ] **Step 1: Escribir los tipos**

Añadir al final de la sección de tipos de `apps/hub-api/src/ausencias/types.ts`:

```ts
/**
 * Las clases de movimiento del registro. Las dos de modificación se llaman
 * EXACTAMENTE igual que en la base de datos (`CLASES_MODIFICACION`), y no con
 * sinónimos como `cambio`: una traducción de vocabulario entre la tabla y la
 * pantalla es una capa más que puede derivar en silencio, y no compra nada.
 */
export const CLASES_MOVIMIENTO = ['solicitud', 'fechas', 'anulacion'] as const;
export type ClaseMovimiento = (typeof CLASES_MOVIMIENTO)[number];

/**
 * Quién tomó la decisión.
 *
 * `aproximado` no es decorativo: en las sesiones con token legacy
 * `aprobador_user_id` es NULL, y entonces esto sale del `aprobador_correo`
 * congelado en el alta, que es *quién debía firmar* y no necesariamente quién
 * firmó —un admin pudo destrabarla en su lugar—. Enseñarlo sin marca sería
 * afirmar una autoría que no consta.
 */
export interface DecididaPor {
  nombre: string | null;
  correo: string;
  aproximado: boolean;
}

/**
 * Una fila del registro: una solicitud, o una anulación o cambio de fecha ya
 * cerrados.
 *
 * Plana y no una unión con objetos anidados, porque los filtros por tipo,
 * persona y año, los contadores y el CSV ya operan sobre una lista plana de
 * solicitudes y así siguen valiendo casi sin tocarlos.
 */
export interface Movimiento {
  /** El de la solicitud o el de la modificación, según la clase. */
  id: string;
  clase: ClaseMovimiento;
  /** Siempre el de la solicitud afectada, también en anulaciones y cambios. */
  solicitudId: string;
  empleadoNombre: string;
  empleadoCargo: string | null;
  solicitanteEmail: string;
  /** El tipo de la SOLICITUD afectada, para que el filtro por tipo siga valiendo. */
  tipo: TipoSolicitud;
  /**
   * Las fechas y días EFECTIVOS del movimiento. En una `anulacion` son las
   * PREVIAS: un CHECK de la 024 garantiza que las nuevas van a null. En un
   * `fechas` son las nuevas, que es lo que se propuso.
   */
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  /** El estado del MOVIMIENTO, no el de la solicitud que lo recibe. */
  estado: EstadoSolicitud | EstadoModificacion;
  decididaAt: string | null;
  decididaPor: DecididaPor | null;
  createdAt: string;
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
}
```

> **Tres correcciones decididas durante la ejecución**, a raíz de la revisión de calidad. El código real de `types.ts` manda sobre este bloque:
>
> 1. **`Movimiento` pasa a ser una unión discriminada por `clase`**, manteniendo la planitud (los campos comunes viven en una `MovimientoBase` compartida). Sin el discriminante, combinaciones imposibles compilan —`{ clase: 'solicitud', estado: 'retirada' }`— y, como `EstadoSolicitud` y `EstadoModificacion` comparten tres literales (`pendiente`, `aprobada`, `rechazada`), un `switch` sobre `estado` no recibe ninguna exhaustividad del compilador. Importa el doble aquí porque el front copia el tipo a mano y sin test de contrato.
> 2. **`diasHabiles` recupera la nota de que es decimal** (medios días, 6,5), que `Solicitud` ya lleva para la misma columna. Sin ella, quien copie el tipo al front puede asumir entero y romperlo con un redondeo o una pluralización.
> 3. **Regla nueva: con `estado === 'retirada'`, `decididaPor` va a `null`.** Una retirada la echa atrás el propio solicitante, no la decide un aprobador; rellenarla con el aprobador congelado atribuiría el acto a alguien que no lo hizo. Quien la retiró ya consta en `solicitanteEmail`, así que no se pierde nada. La Task 6 la implementa y **la prueba**.

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/hub-api; npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/ausencias/types.ts
git commit -m "feat(ausencias): el tipo Movimiento del registro"
```

---

## Task 4: El candado de la rama, contra Postgres real

Este es **el test que importa** de todo el plan. Va antes que la implementación (TDD) y contra Postgres de verdad, no contra el doble: el doble de `router.test.ts` reimplementa el repo y su candado de superficie caza **renombres, no filtros**, así que un recorte mal escrito lo pasaría sin despeinarse. Es exactamente la desviación que ya mordió con `ausenciasQueTocanElSaldo` y `ocupaAgenda`.

> **Ampliación decidida durante la ejecución de la Task 2.** Al falsar el recorte —mutando la condición de los nietos a `AND TRUE`— **no se puso rojo ni un solo test**. La causa, verificada por dos agentes de forma independiente: `repo.saldos.db.test.ts` solo llama a `empleadosConSaldo` con `soloDe = null`, y los únicos casos con `soloDe` no nulo viven en `router.test.ts`, que mockea el repo entero y por tanto nunca ejecuta ese SQL. O sea: **el recorte por rama no se ha validado nunca contra Postgres real**, ni siquiera en el primer nivel, pese a que producción sí lo usa en la ruta de no-admin (`service.ts:1633`).
>
> Es un hueco preexistente, no introducido por este trabajo, y es el caso literal de «cuando una mutación no muerde, escribe el test que la haga morder». Por eso esta tarea añade **también** un caso que ejercita `empleadosConSaldo` con `soloDe` no nulo sobre la misma jerarquía sembrada. Al ser ya una sola función compartida, un único test deja cerrados los dos sitios que la usan — que es exactamente lo que compró la extracción de la Task 2.

**Files:**
- Modify: `apps/hub-api/src/test-db/harness.ts:47`
- Create: `apps/hub-api/src/ausencias/repo.movimientos.db.test.ts`

- [ ] **Step 1: Dar al harness un aprobador configurable**

`sembrarEmpleado` fija hoy `aprobador_correo` a `'jefe1@ambientalia.com.co'`. Para sembrar una jerarquía hace falta poder elegirlo. Parámetro **opcional con el valor actual por defecto**, para no tocar a los seis ficheros que ya lo usan.

En `apps/hub-api/src/test-db/harness.ts`, sustituir `sembrarEmpleado` por:

```ts
export async function sembrarEmpleado(
  db: Pool,
  correo: string,
  aprobadorCorreo = 'jefe1@ambientalia.com.co',
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.empleados (nombre_completo, correo, cargo, aprobador_correo)
     VALUES ('Ana Ruiz', $1, 'Analista', $2)
     RETURNING id`,
    [correo, aprobadorCorreo],
  );
  return (rows[0] as { id: string }).id;
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `apps/hub-api/src/ausencias/repo.movimientos.db.test.ts` (**sin tildes**, como el resto de `.db.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { movimientos, empleadosConSaldo } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// El recorte por rama del registro de movimientos, contra Postgres de verdad.
//
// Este fichero existe porque el doble in-memory de router.test.ts NO ejECUTA
// SQL: su candado compara NOMBRES de funcion, asi que caza un renombre pero no
// un filtro mal escrito. Y aqui un filtro mal escrito no da un rojo — enseña
// las ausencias de gente que no es de quien mira.
//
// La jerarquia sembrada, con JEFE como quien pregunta:
//
//   JEFE
//    +- HIJO      (subordinado directo)
//    |   +- NIETO (subordinado de su subordinado: SI entra, por la cascada)
//    |       +- BISNIETO (NO entra: tres niveles)
//    +- (PRIMO cuelga de OTRO_JEFE: NO entra)

const JEFE = 'jefe@ambientalia.com.co';
const HIJO = 'hijo@ambientalia.com.co';
const NIETO = 'nieto@ambientalia.com.co';
const BISNIETO = 'bisnieto@ambientalia.com.co';
const PRIMO = 'primo@ambientalia.com.co';
const OTRO_JEFE = 'otrojefe@ambientalia.com.co';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  await limpiar(db);
  // Una solicitud aprobada por cada uno, para que haya algo que contar.
  for (const [correo, jefe] of [
    [HIJO, JEFE],
    [NIETO, HIJO],
    [BISNIETO, NIETO],
    [PRIMO, OTRO_JEFE],
  ] as const) {
    const id = await sembrarEmpleado(db, correo, jefe);
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo,
      estado: 'aprobada',
      fechaInicio: '2026-03-02',
      fechaFin: '2026-03-04',
      segundoAprobadorCorreo: null,
    });
  }
});

/** Los correos de los solicitantes que ve quien pregunta. */
async function vistosPor(correo: string | null): Promise<string[]> {
  const ms = await movimientos(db, correo);
  return [...new Set(ms.map((m) => m.solicitanteEmail))].sort();
}

describe('CANDADO: el recorte por rama del registro', () => {
  it('un jefe ve a su hijo y a su nieto', async () => {
    expect(await vistosPor(JEFE)).toEqual([HIJO, NIETO].sort());
  });

  // El OTRO sitio que usa `ramaDeDosNiveles`. Va aqui y no en
  // repo.saldos.db.test.ts porque la jerarquia de tres niveles ya esta sembrada
  // en este fichero, y porque lo que se prueba es la funcion compartida.
  //
  // Existe por una falsacion que NO mordio: hasta ahora ningun test contra
  // Postgres real llamaba a `empleadosConSaldo` con `soloDe` no nulo, asi que
  // el recorte se podia romper entero sin que nada se pusiera rojo. Produccion
  // si lo usa, en la ruta de no-admin.
  it('CANDADO: el mismo recorte acota tambien los saldos', async () => {
    const conSaldo = await empleadosConSaldo(db, JEFE, null);
    const correos = conSaldo.map((e) => e.correo).sort();
    expect(correos).toEqual([HIJO, NIETO].sort());
    expect(correos).not.toContain(BISNIETO);
    expect(correos).not.toContain(PRIMO);
  });

  it('un jefe NO ve al bisnieto: la rama son dos niveles', async () => {
    expect(await vistosPor(JEFE)).not.toContain(BISNIETO);
  });

  it('un jefe NO ve a un primo de otra rama', async () => {
    expect(await vistosPor(JEFE)).not.toContain(PRIMO);
  });

  it('sin acotar —un admin— se ve la compania entera', async () => {
    expect(await vistosPor(null)).toEqual([BISNIETO, HIJO, NIETO, PRIMO].sort());
  });
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `cd apps/hub-api; npm run test:db -- src/ausencias/repo.movimientos.db.test.ts`
Expected: **FAIL** con `movimientos is not a function` — todavía no existe.

- [ ] **Step 4: Commit del test**

```bash
git add apps/hub-api/src/test-db/harness.ts apps/hub-api/src/ausencias/repo.movimientos.db.test.ts
git commit -m "test(ausencias): candado del recorte por rama del registro"
```

---

## Task 5: `repo.movimientos` — la parte de las solicitudes

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 1: Escribir la consulta de solicitudes**

Añadir a `apps/hub-api/src/ausencias/repo.ts`:

```ts
/** La fila cruda de un movimiento, antes del mapeo. */
interface FilaMovimientoDb {
  id: string;
  clase: ClaseMovimiento;
  solicitud_id: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  solicitante_email: string;
  tipo: TipoSolicitud;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  estado: EstadoSolicitud | EstadoModificacion;
  decidida_at: string | null;
  decisor_nombre: string | null;
  decisor_correo: string | null;
  aprobador_correo: string | null;
  created_at: string;
  motivo: string | null;
}

function aMovimiento(r: FilaMovimientoDb): Movimiento {
  // Una RETIRADA no la decide nadie: la echa atrás el propio solicitante, que
  // ya consta en `solicitanteEmail`. Caer aquí al aprobador congelado
  // atribuiría el acto a alguien que no lo hizo, y eso es peor que dejarlo
  // vacío. La regla está escrita en el JSDoc de `DecididaPor`.
  //
  // Por lo demás: el decisor REAL manda; si no consta —token legacy—, se cae al
  // aprobador congelado y se MARCA. Ver `DecididaPor.aproximado`.
  //
  // ⚠️ Y el respaldo NO es el primer aprobador sin mirar. Si la solicitud
  // llevaba cascada de dos firmas y se cerró estando en `pendiente_2`, quien
  // debía firmar era el SEGUNDO. Caer al primero nombraría a una persona real y
  // equivocada, que no es aproximar: es mentir con nombre y apellidos, la misma
  // clase de fallo que evita la guarda de `retirada` de aquí arriba.
  //
  // La regla final, tras dos correcciones que costaron sendos candados:
  //
  //   segundo_aprobador_correo != null
  //   && primera_firma_at != decidida_at
  //
  // NO lleva un `primera_firma_at != null`. Ese término parecía obvio y era
  // incorrecto: cuando un admin destraba una solicitud a `pendiente_2` desde el
  // registro general, `primera_firma_at` no se sella nunca, así que una fila
  // cerrada con esa marca NULA es precisamente un cierre del segundo. Vale
  // porque `decidirSolicitud` es el ÚNICO escritor de `decidida_at`, y todo
  // cierre que sale de `pendiente` sella las dos marcas a la vez.
  //
  // Sin el tercero, el caso simétrico se misatribuye igual de mal. Cuando el
  // jefe inmediato RECHAZA una solicitud que sí llevaba cascada,
  // `transicionAlDecidir` devuelve `esPrimeraFirma` y `esDecisionFinal` a la
  // vez, y `decidirSolicitud` sella las dos marcas con el mismo `now()` en la
  // misma sentencia: queda segundo firmante no nulo y primera firma no nula, y
  // sin embargo decidió el primero. Comparar los dos instantes distingue «un
  // solo acto» de «dos transacciones», y es exacto —no aproximado— porque las
  // dos cadenas salen del mismo cast en la misma consulta.
  //
  // `correoDelTurno` NO sirve aquí: contesta a quién le toca firmar AHORA y
  // devuelve null en todo estado terminal, y aquí toda fila está cerrada.
  //
  // Con candado propio en `repo.movimientos.db.test.ts` —uno por cada final
  // posible—, porque una regla sin test es un comentario.
  const decididaPor: DecididaPor | null =
    r.estado === 'retirada'
      ? null
      : r.decisor_correo
        ? { nombre: r.decisor_nombre, correo: r.decisor_correo, aproximado: false }
        : r.decidida_at && r.aprobador_correo
          ? { nombre: null, correo: r.aprobador_correo, aproximado: true }
          : null;
  return {
    id: r.id,
    clase: r.clase,
    solicitudId: r.solicitud_id,
    empleadoNombre: r.empleado_nombre,
    empleadoCargo: r.empleado_cargo,
    solicitanteEmail: r.solicitante_email,
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    diasHabiles: r.dias_habiles,
    estado: r.estado,
    decididaAt: r.decidida_at,
    decididaPor,
    createdAt: r.created_at,
    motivo: r.motivo,
  };
}

/**
 * Las solicitudes como movimientos. TODAS, en cualquier estado: el registro es
 * un registro y no un archivo de cerrados, y una en trámite tiene que verse con
 * la decisión vacía.
 *
 * Los casts NO son estilo, por lo mismo que en `SELECT_SOLICITUD`: sin
 * `::float8` un NUMERIC llega como string y "5.0" rompe la aritmética; sin
 * `::text` un timestamptz llega como objeto Date y cualquier comparación
 * lexicográfica contra una cadena falla en silencio.
 */
async function movimientosDeSolicitudes(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const { rows } = await db.query(
    `SELECT s.id, 'solicitud'::text AS clase, s.id AS solicitud_id,
            e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
            s.solicitante_email, s.tipo,
            s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
            s.dias_habiles::float8 AS dias_habiles,
            s.estado, s.decidida_at::text AS decidida_at,
            u.full_name AS decisor_nombre, u.email AS decisor_correo,
            s.aprobador_correo,
            s.created_at::text AS created_at,
            s.comentarios AS motivo
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
       LEFT JOIN portal.users u ON u.id = s.aprobador_user_id
      WHERE ${ramaDeDosNiveles()}`,
    [soloDe],
  );
  return (rows as FilaMovimientoDb[]).map(aMovimiento);
}
```

Los nombres de columna de `portal.users` están confirmados contra `001_create_users.sql`: son `full_name` y `email` (no `name`).

- [ ] **Step 2: Exportar `movimientos` provisionalmente**

```ts
/**
 * El registro de movimientos. `soloDe = null` = la compañía entera (admin).
 *
 * Dos consultas y mezcla en TypeScript, no un `UNION ALL`: las formas de columna
 * de las dos tablas son muy distintas, la vista carga todo de una sola vez, y
 * separadas se pueden probar sin Postgres.
 */
export async function movimientos(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  return movimientosDeSolicitudes(db, soloDe);
}
```

- [ ] **Step 3: Correr el candado de la rama**

Run: `cd apps/hub-api; npm run test:db -- src/ausencias/repo.movimientos.db.test.ts`
Expected: **PASS**, los cinco.

- [ ] **Step 4: Falsar el candado**

⚠️ **`WHERE TRUE` a secas NO sirve como falsación.** Al quitar el `$1` del SQL, la consulta pasa a requerir cero parámetros mientras el código sigue pasando uno, y Postgres corta con `bind message supplies 1 parameters, but prepared statement "" requires 0`. Los tests mueren de error de binding, no de dato mal filtrado: un rojo que no distingue nada y que da una falsa sensación de candado.

La mutación honesta **conserva la aridad y anula el recorte**: sustituir el cuerpo de `ramaDeDosNiveles()` por `($1::text IS NULL OR TRUE)`. Volver a correr.

Expected: **FAIL** en el test del bisnieto, en el del primo y en el de «ve a su hijo y a su nieto». Sigue verde el del admin, y es correcto: con `soloDe = null` la rama no acota de todos modos. Revertir después.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts
git commit -m "feat(ausencias): las solicitudes como movimientos del registro"
```

---

## Task 6: `repo.movimientos` — anulaciones y cambios

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `apps/hub-api/src/ausencias/repo.movimientos.db.test.ts`:

```ts
describe('CANDADO: que filas entran', () => {
  it('una modificacion CERRADA entra como movimiento propio', async () => {
    const id = await sembrarEmpleado(db, 'solo@ambientalia.com.co', JEFE);
    const s = await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'solo@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-04-01',
      fechaFin: '2026-04-03',
      segundoAprobadorCorreo: null,
    });
    await db.query(
      `INSERT INTO portal.solicitud_modificaciones
         (solicitud_id, clase, estado_previo, fecha_inicio_previa, fecha_fin_previa,
          dias_habiles_previos, estado, aprobador_correo, solicitante_email, decidida_at)
       VALUES ($1, 'anulacion', 'aprobada', '2026-04-01', '2026-04-03', 3,
               'aprobada', $2, 'solo@ambientalia.com.co', now())`,
      [s.id, JEFE],
    );

    const ms = await movimientos(db, JEFE);
    const anulacion = ms.find((m) => m.clase === 'anulacion');
    expect(anulacion).toBeDefined();
    // Las fechas efectivas de una anulacion son las PREVIAS: un CHECK de la 024
    // garantiza que las nuevas van a null.
    expect(anulacion?.fechaInicio).toBe('2026-04-01');
    expect(anulacion?.diasHabiles).toBe(3);
  });

  it('una modificacion VIVA no entra: ya se ve en su solicitud', async () => {
    const id = await sembrarEmpleado(db, 'viva@ambientalia.com.co', JEFE);
    const s = await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'viva@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-05-01',
      fechaFin: '2026-05-02',
      segundoAprobadorCorreo: null,
    });
    await db.query(
      `INSERT INTO portal.solicitud_modificaciones
         (solicitud_id, clase, estado_previo, fecha_inicio_previa, fecha_fin_previa,
          dias_habiles_previos, estado, aprobador_correo, solicitante_email)
       VALUES ($1, 'anulacion', 'aprobada', '2026-05-01', '2026-05-02', 2,
               'pendiente', $2, 'viva@ambientalia.com.co')`,
      [s.id, JEFE],
    );

    const ms = await movimientos(db, JEFE);
    expect(ms.filter((m) => m.clase === 'anulacion')).toHaveLength(0);
  });

  // La regla del JSDoc de `DecididaPor`, con candado propio: sin esto es solo un
  // comentario, y lo que impide es una ATRIBUCION FALSA — decir que un jefe
  // decidio algo que en realidad echo atras el solicitante.
  it('CANDADO: una RETIRADA no la decide nadie, asi que decididaPor va vacio', async () => {
    const id = await sembrarEmpleado(db, 'retira@ambientalia.com.co', JEFE);
    const s = await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'retira@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-06-01',
      fechaFin: '2026-06-02',
      segundoAprobadorCorreo: null,
    });
    await db.query(
      `INSERT INTO portal.solicitud_modificaciones
         (solicitud_id, clase, estado_previo, fecha_inicio_previa, fecha_fin_previa,
          dias_habiles_previos, estado, aprobador_correo, solicitante_email, decidida_at)
       VALUES ($1, 'anulacion', 'aprobada', '2026-06-01', '2026-06-02', 2,
               'retirada', $2, 'retira@ambientalia.com.co', now())`,
      [s.id, JEFE],
    );

    const retirada = (await movimientos(db, JEFE)).find((m) => m.estado === 'retirada');
    expect(retirada).toBeDefined();
    // Aunque la fila TIENE aprobador_correo y TIENE decidida_at, que es
    // justamente lo que haria caer al aprobador congelado si no hubiera guarda.
    expect(retirada?.decididaPor).toBeNull();
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `cd apps/hub-api; npm run test:db -- src/ausencias/repo.movimientos.db.test.ts`
Expected: **FAIL** en «una modificacion CERRADA entra» — todavía no se consultan.

> ⚠️ **Al compartir `quienDecidio` con las modificaciones**, pasarle
> `primera_firma_at` y `segundo_aprobador_correo` **a `null` explícitamente**. Una
> modificación no tiene ninguna de las dos —la decide una sola persona, y su
> `aprobador_correo` se copia de la solicitud—, así que dejar que la fila las
> traiga por casualidad reactivaría la regla de la cascada donde no aplica.

- [ ] **Step 3: Escribir la consulta de modificaciones**

Añadir a `repo.ts`:

```ts
/**
 * Las modificaciones YA CERRADAS como movimientos. Incluye `retirada`, que es la
 * que el propio solicitante echó atrás: no es la decisión de un jefe, pero sella
 * `decidida_at` y forma parte del rastro de lo que se movió.
 *
 * Las `pendiente` NO entran: ya viajan con su solicitud vía el LEFT JOIN de
 * `SELECT_SOLICITUD` (`modificacionPendiente`), y meterlas además como fila las
 * contaría dos veces en pantalla.
 *
 * `COALESCE` en las fechas porque una anulación tiene las nuevas a null por un
 * CHECK de la 024: sus fechas efectivas son las previas.
 */
async function movimientosDeModificaciones(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const { rows } = await db.query(
    `SELECT m.id, m.clase::text AS clase, m.solicitud_id,
            e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
            m.solicitante_email, s.tipo,
            COALESCE(m.fecha_inicio_nueva, m.fecha_inicio_previa)::text AS fecha_inicio,
            COALESCE(m.fecha_fin_nueva, m.fecha_fin_previa)::text       AS fecha_fin,
            COALESCE(m.dias_habiles_nuevos, m.dias_habiles_previos)::float8 AS dias_habiles,
            m.estado, m.decidida_at::text AS decidida_at,
            u.full_name AS decisor_nombre, u.email AS decisor_correo,
            m.aprobador_correo,
            m.created_at::text AS created_at,
            m.motivo
       FROM portal.solicitud_modificaciones m
       JOIN portal.solicitudes_ausencia s ON s.id = m.solicitud_id
       JOIN portal.empleados e ON e.id = s.empleado_id
       LEFT JOIN portal.users u ON u.id = m.aprobador_user_id
      WHERE m.estado <> 'pendiente'
        AND ${ramaDeDosNiveles()}`,
    [soloDe],
  );
  return (rows as FilaMovimientoDb[]).map(aMovimiento);
}
```

- [ ] **Step 4: Mezclar y ordenar**

Sustituir el cuerpo de `movimientos` por:

```ts
export async function movimientos(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const [solicitudes, modificaciones] = await Promise.all([
    movimientosDeSolicitudes(db, soloDe),
    movimientosDeModificaciones(db, soloDe),
  ]);
  // Mismo criterio que `solicitudesDecididas`, y el NULLS LAST no es decorativo:
  // hay dos formas de llegar a estado terminal sin `decidida_at` —el PATCH de
  // admin, y aprobar una anulacion sobre una que seguia pendiente—. Sin esto,
  // esas filas encabezarian la lista por delante de las decisiones de esta
  // semana.
  return [...solicitudes, ...modificaciones].sort((a, b) => {
    if (a.decididaAt && b.decididaAt) return b.decididaAt.localeCompare(a.decididaAt);
    if (a.decididaAt) return -1;
    if (b.decididaAt) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
```

- [ ] **Step 5: Correr los tests**

Run: `cd apps/hub-api; npm run test:db -- src/ausencias/repo.movimientos.db.test.ts`
Expected: **PASS**, los ocho.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo.movimientos.db.test.ts
git commit -m "feat(ausencias): anulaciones y cambios como movimientos del registro"
```

---

## Task 7: El permiso de exportar en el repo

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 1: Escribir las dos funciones**

Copiar el patrón de `esVisorDeAdjuntos` y `fijarVisor` (repo.ts ~522 y ~553):

```ts
/** Si ese correo tiene marcado el permiso de exportar el registro. */
export async function puedeExportarRegistro(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND exporta_registro`,
    [email],
  );
  return rows.length > 0;
}

/**
 * Da o quita el permiso de exportar, y lo DEJA REGISTRADO.
 *
 * El log guarda el correo además del id y sin clave foránea, por lo mismo que
 * `visores_adjuntos_log`: si la ficha se borra, el registro tiene que seguir
 * diciendo a quién se le dio. Un registro que desaparece con su sujeto no es un
 * registro de auditoría.
 */
export async function fijarExportador(
  db: Pool,
  adminEmail: string,
  empleadoId: string,
  concedido: boolean,
): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE portal.empleados SET exporta_registro = $2 WHERE id = $1 AND activo RETURNING correo`,
    [empleadoId, concedido],
  );
  if (!rows.length) return false;
  await db.query(
    `INSERT INTO portal.exportadores_registro_log
       (admin_email, empleado_id, empleado_correo, concedido)
     VALUES ($1, $2, $3, $4)`,
    [adminEmail, empleadoId, (rows[0] as { correo: string }).correo, concedido],
  );
  return true;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/hub-api; npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts
git commit -m "feat(ausencias): repo del permiso de exportar el registro"
```

---

## Task 8: Servicio y router

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts`
- Modify: `apps/hub-api/src/ausencias/router.ts`

- [ ] **Step 1: Escribir el servicio**

En `service.ts`, sustituir `decididasPorMi` por:

```ts
/**
 * El registro de movimientos que le corresponde a quien pregunta.
 *
 * ⚠️ El recorte lo decide AQUÍ el servidor a partir de la sesión, y nunca un
 * parámetro que mande el cliente: es la única barrera entre un jefe y el
 * historial de toda la empresa.
 */
export async function movimientosVisibles(db: Pool, sesion: Sesion): Promise<Movimiento[]> {
  if (!sesion.esAdmin && !(await repo.esAprobadorDeAlguien(db, sesion.email))) {
    throw new AusenciaError('no_es_aprobador', 403);
  }
  return repo.movimientos(db, sesion.esAdmin ? null : sesion.email);
}

/** Da o quita el permiso de exportar el CSV del registro. Solo admin. */
export async function fijarExportador(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  if (typeof body?.concedido !== 'boolean') throw new AusenciaError('concedido_invalido', 400);
  const ok = await repo.fijarExportador(db, sesion.email, empleadoId, body.concedido);
  if (!ok) throw new AusenciaError('no_encontrado', 404);
  return { ok: true };
}
```

- [ ] **Step 2: Cambiar el router**

En `router.ts`:

1. Sustituir el handler de `GET /ausencias/historico` (línea ~371) por:

```ts
  /**
   * El registro de movimientos. Sin `requireAdmin`: el recorte por rama lo hace
   * el servicio a partir de la sesión, y un jefe tiene derecho a ver la suya.
   */
  router.get('/ausencias/movimientos', requireAuth, async (req: Request, res: Response) => {
    try {
      res.json({ movimientos: await service.movimientosVisibles(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_movimientos');
    }
  });
```

2. Borrar el handler de `GET /ausencias/decididas` (línea ~155).

3. Añadir junto al de `/visor` (línea ~348):

```ts
  /** Da o quita el permiso de exportar el registro. Solo admin, y queda registrado. */
  router.put('/ausencias/empleados/:id/exportador', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarExportador(db, sesionDe(req), req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_exportador');
    }
  });
```

4. En el contexto (línea ~109), junto a `esVisorAdjuntos`:

```ts
        // Pliega admin dentro, igual que `esVisorAdjuntos`: la app decide con un
        // solo booleano y no replica la regla en el navegador.
        esExportadorRegistro: sesion.esAdmin || (await repo.puedeExportarRegistro(db, sesion.email)),
```

- [ ] **Step 3: Retirar lo que muere en el repo**

Borrar de `repo.ts` las funciones `solicitudesDecididas` y `todasLasSolicitudes`, que ya no llama nadie.

- [ ] **Step 4: Actualizar el doble y su candado**

En `apps/hub-api/src/ausencias/router.test.ts`, en el `vi.mock('./repo.js', …)` de la línea 226: quitar `solicitudesDecididas` y `todasLasSolicitudes`, y añadir `movimientos`, `puedeExportarRegistro` y `fijarExportador`.

⚠️ El candado de superficie de la línea ~908 compara nombres de export. Si no se actualiza el doble, se pone rojo — que es exactamente lo que tiene que hacer.

- [ ] **Step 5: Correr los portones**

Run: `cd apps/hub-api; npm run test`
Expected: PASS. Run: `npm run test:db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): endpoint del registro de movimientos"
```

---

## Task 9: El espejo del front

⚠️ `apps/ausencias/src/api.ts` y `dominio.ts` son **espejos manuales** del backend, sin generación ni test de contrato. Lo que se escriba aquí tiene que coincidir exactamente con `types.ts`.

**Files:**
- Modify: `apps/ausencias/src/api.ts`

- [ ] **Step 1: Copiar los tipos**

Añadir a `api.ts` los tipos `ClaseMovimiento`, `DecididaPor` y `Movimiento` **idénticos** a los de `apps/hub-api/src/ausencias/types.ts` (Task 3), con un comentario cruzado que diga de dónde son espejo.

- [ ] **Step 2: Cambiar los fetchers**

```ts
export const fetchMovimientos = () =>
  get<{ movimientos: Movimiento[] }>('/api/ausencias/movimientos').then((d) => d.movimientos);

/** Da o quita el permiso de exportar el registro. Solo admin. */
export const fijarExportador = (id: string, concedido: boolean) =>
  put<{ ok: boolean }>(`/api/ausencias/empleados/${id}/exportador`, { concedido });
```

Borrar `fetchDecididas` y `fetchHistorico`. Añadir `esExportadorRegistro: boolean` a la interfaz del contexto (línea ~183, junto a `esVisorAdjuntos`) y `exportaRegistro: boolean` a la de empleado.

- [ ] **Step 3: Verificar**

Run: `cd apps/ausencias; npx tsc --noEmit`
Expected: errores **esperados** en `RegistroGeneral.tsx` y `HistorialAprobador.tsx`, que se arreglan en las tareas siguientes. Es su único portón: no hay tests.

- [ ] **Step 4: Commit**

```bash
git add apps/ausencias/src/api.ts
git commit -m "feat(ausencias): espejo del registro de movimientos en el front"
```

---

## Task 10: `RegistroGeneral` — los cuatro candados

**Files:**
- Modify: `apps/ausencias/src/RegistroGeneral.tsx`

- [ ] **Step 1: Cambiar la carga y el estado**

Sustituir `fetchHistorico()` por `fetchMovimientos()` y el estado `solicitudes: Solicitud[]` por `movs: Movimiento[]`. La prop nueva `esAdmin: boolean` y `puedeExportar: boolean` llegan desde `App.tsx`.

- [ ] **Step 2: Cerrar los cuatro candados**

Este es el corazón de la tarea. Derivar una lista solo de solicitudes y colgar de ella **todo lo que no puede contar movimientos**:

```tsx
// ⚠️ LOS CUATRO CANDADOS DE LA MEZCLA. Meter dos entidades en una tabla rompe
// cuatro cosas que antes eran ciertas por construccion, porque solo habia
// solicitudes. Cada una cuelga de esta lista y NO de `filtradas`.
const soloSolicitudes = useMemo(() => filtradas.filter((m) => m.clase === 'solicitud'), [filtradas]);
```

1. **Totales**: `totalDias` y `totalConcedido` se calculan sobre `soloSolicitudes`. Si un cambio de fechas sumara, los días se contarían dos veces.
2. **Chips `porPersona`**: misma lista.
3. **CSV**: `exportarCsv` recorre `soloSolicitudes` y sigue excluyendo los otorgamientos. Ampliar el comentario que ya está allí:

```tsx
    // ⚠️ Los otorgamientos NO se exportan, y desde el registro de movimientos
    // las ANULACIONES y los CAMBIOS tampoco. Este fichero es el que sustituye al
    // Excel de nomina y su columna «Dias» significa dias fuera en las ocho
    // columnas que tiene; no hay ninguna que diga el signo ni que diga que una
    // fila es una anulacion. Cualquiera de las dos ahi dentro es un error que se
    // descubre en un recibo.
```

4. **Acciones**: los botones de editar y borrar se dibujan solo si `esAdmin && m.clase === 'solicitud'`.

- [ ] **Step 3: Columnas y filtro nuevos**

Añadir las columnas «Decidida» y «Decidida por» a la tabla. En «Decidida por», cuando `decididaPor.aproximado` es `true`, marcarlo visualmente —por ejemplo en gris y con `title="Sesión antigua: es el aprobador previsto, no consta quién firmó"`— porque si no se estaría afirmando una autoría que no consta.

Añadir un `<select>` de clase de movimiento (todas / solicitudes / anulaciones / cambios de fecha) junto a los de tipo, persona y año.

- [ ] **Step 4: Subtítulo según el rol**

```tsx
{esAdmin ? 'Todas las solicitudes de la compañía, y los cambios y anulaciones que se han decidido sobre ellas.'
         : 'Los movimientos de tu equipo: tus subordinados y los suyos.'}
```

El nombre de la pestaña no cambia; el subtítulo sí, o la pantalla miente sobre lo que enseña.

- [ ] **Step 5: El botón de exportar**

`{puedeExportar && (<button …>Exportar CSV</button>)}`

- [ ] **Step 6: Verificar**

Run: `cd apps/ausencias; npx tsc --noEmit`
Expected: solo quedan errores de `HistorialAprobador.tsx`, que muere en la Task 11.

- [ ] **Step 7: Commit**

```bash
git add apps/ausencias/src/RegistroGeneral.tsx
git commit -m "feat(ausencias): el registro general pasa a ser de movimientos"
```

---

## Task 11: La pestaña, y borrar el Historial

**Files:**
- Modify: `apps/ausencias/src/App.tsx:169,184`
- Delete: `apps/ausencias/src/HistorialAprobador.tsx`

- [ ] **Step 1: Mover la pestaña**

En `App.tsx`, borrar la línea `p.push(['historial', 'Historial de aprobaciones']);` del bloque de `esAprobador`, y sacar `p.push(['historico', 'Registro general']);` del bloque de `esAdmin` para ponerlo con su propia condición:

```tsx
    // No es una pestaña de admin desde que el registro es de movimientos: la
    // abre cualquier aprobador, pero lo que ENSEÑA va acotado a su rama de dos
    // niveles, y ese recorte lo hace hub-api en el SQL, no esta lista. Es el
    // mismo reparto de responsabilidad que ya tiene el calendario.
    if (contexto?.esAprobador) p.push(['historico', 'Registro general']);
```

Pasarle a `<RegistroGeneral>` las props `esAdmin={contexto.esAdmin}` y `puedeExportar={contexto.esExportadorRegistro}`.

- [ ] **Step 2: Borrar el Historial**

```bash
git rm apps/ausencias/src/HistorialAprobador.tsx
```

Quitar su import y su render de `App.tsx`.

- [ ] **Step 3: Verificar**

Run: `cd apps/ausencias; npx tsc --noEmit`
Expected: **sin errores**.

- [ ] **Step 4: Commit**

```bash
git add apps/ausencias/src/App.tsx
git commit -m "feat(ausencias): una sola pestana de registro, sin historial aparte"
```

---

## Task 12: La casilla del Organigrama

**Files:**
- Modify: `apps/ausencias/src/PanelOrganigrama.tsx`

- [ ] **Step 1: Copiar el mecanismo de «Soportes»**

Replicar exactamente lo que ya hace `veAdjuntos` (líneas 15, 25, 116, 213, 227, 354-358) para un campo `exportaRegistro`: cabecera de columna «Exporta», casilla con `checked={!!fila.exportaRegistro}`, detección de cambio en la comparación de la línea 227, y llamada a `fijarExportador` en el guardado diferido de la línea 116.

- [ ] **Step 2: Explicarlo en el texto de ayuda**

Añadir al párrafo de la línea ~175 una frase que diga qué abre la casilla nueva: el CSV con las ausencias de la plantilla, que son datos personales.

- [ ] **Step 3: Verificar**

Run: `cd apps/ausencias; npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/ausencias/src/PanelOrganigrama.tsx
git commit -m "feat(ausencias): casilla del permiso de exportar en el organigrama"
```

---

## Task 13: Portones completos y mezcla

- [ ] **Step 1: Correr todo**

```bash
npm run typecheck --workspaces --if-present
cd apps/hub-api; npm run test; npm run test:db; npm run build
cd ../portal; npm run build
```

Expected: todo verde. ⚠️ Los 11 tests del portal (`Sidebar`, `useDashboardLayout`) fallan **solo en esta máquina** por un problema de entorno local con jsdom 29 — en CI pasan los 14 ficheros. No son de esta rama y no la bloquean.

- [ ] **Step 2: Mezclar**

```bash
git checkout main
git merge --no-ff feat/registro-movimientos
```

- [ ] **Step 3: Empujar**

⚠️ **El push ES el despliegue**, y hay que pedírselo al usuario: el clasificador de auto-mode lo bloquea aunque el permiso esté en `.claude/settings.local.json` — son dos capas distintas.

Al desplegar, **hub-api antes que el portal**, ~11 minutos por servicio.

- [ ] **Step 4: Después del despliegue**

1. Marcar la casilla «Exporta» a Marcela Noreña Vargas desde la pestaña Organigrama. Nace en `FALSE` para todos a propósito, para que su correo no esté en el código.
2. Comprobar en el navegador, con una cuenta de jefe **no** administrador, que el Registro general se abre y **no** enseña gente de fuera de su rama.

---

## Autorrevisión del plan

**Cobertura del spec:** público (T8, T11), rama de dos niveles (T2, T4, T5), filas de solicitud y modificación (T5, T6), qué filas entran (T6), columnas nuevas (T3, T5, T10), editar/borrar solo admin (T10), CSV con permiso (T1, T7, T8, T12), nombre y subtítulo (T10), borrado del Historial (T8, T11), pruebas (T4, T6), espejos (T9). Sin huecos.

**Sin huecos abiertos.** El único supuesto que quedaba —los nombres de columna de `portal.users`— se confirmó contra `001_create_users.sql` y se corrigió en las dos consultas: son `full_name` y `email`.

**Lo más frágil del plan**, para que quien lo ejecute lo sepa: la Task 10 es la que concentra el riesgo real de regresión, porque los cuatro candados de la mezcla eran ciertos *por construcción* mientras la tabla solo tenía solicitudes, y al meter dos entidades dejan de serlo todos a la vez. El más caro de los cuatro es el del CSV, porque su fallo no se ve en pantalla: se descubre en una nómina.
