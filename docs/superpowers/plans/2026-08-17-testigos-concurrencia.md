# Testigos de concurrencia contra Postgres real — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que romper cualquiera de los tres testigos de concurrencia de `apps/hub-api/src/ausencias/repo.ts` ponga un test en rojo por lo que el SQL **hace**, y no por el texto que tiene escrito.

**Architecture:** Un contenedor de `postgres:16-alpine` levantado por el `globalSetup` de Vitest y migrado con el array real de `db.ts`. Los tests que lo usan viven en ficheros `*.db.test.ts`, excluidos del run normal y ejecutados por un cuarto portón, `npm run test:db`. El pool es `createPoolFromUrl` —el de producción— y las solicitudes se siembran con `crearSolicitud`, la función real del repo.

**Tech Stack:** Vitest 2.1.9, `@testcontainers/postgresql`, `pg` 8.22 vía `@algarpibe/zoho-sync`, TypeScript ESM (imports con `.js`), Docker 29.6.

**Spec:** `docs/superpowers/specs/2026-08-17-testigos-concurrencia-design.md`

**Rama:** `test/testigos-concurrencia` (ya creada, con el spec commiteado en `d815944`).

---

## Convenciones que hay que respetar

- Código y comentarios **en español y SIN tildes**. La prosa de la documentación sí las lleva.
- Mensajes de commit en español y sin tildes.
- Commitear siempre con rutas explícitas: `git commit -m "..." -- ruta1 ruta2`. **Nunca `git add -A`** (hay un `apps/WO-sales/prompts/` ajeno sin trackear). Los ficheros nuevos necesitan `git add <ruta exacta>` antes.
- PowerShell 5.1 pierde el directorio entre llamadas: abrir cada comando con `Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"`. **Nunca `2>&1`** sobre git o npm.
- Los comentarios explican **por qué**, no qué.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `apps/hub-api/vitest.config.ts` | **Crear.** Saca los `*.db.test.ts` del run normal. |
| `apps/hub-api/vitest.db.config.ts` | **Crear.** El cuarto portón: solo `*.db.test.ts`, en serie, con el contenedor. |
| `apps/hub-api/src/test-db/contenedor.ts` | **Crear.** `globalSetup`: levanta Postgres, lo migra, publica la URL. |
| `apps/hub-api/src/test-db/harness.ts` | **Crear.** Pool, limpieza entre tests y sembrado. Sin lógica de negocio. |
| `apps/hub-api/src/db.migraciones.db.test.ts` | **Crear.** Test 5: idempotencia y el `22001` del outbox. |
| `apps/hub-api/src/ausencias/repo.testigos.db.test.ts` | **Crear.** Tests 1-4: los tres testigos y el `23505`. |
| `apps/hub-api/src/db.ts` | **Modificar.** Extraer `aplicarMigraciones`. |
| `apps/hub-api/src/ausencias/repo.ts` | **Modificar.** Solo comentarios: el texto que dejó de ser cierto. |
| `apps/hub-api/src/ausencias/repo.test.ts` | **Modificar.** Borrar las aserciones de forma ya cubiertas. |
| `apps/hub-api/package.json` | **Modificar.** Script `test:db` y la dependencia de desarrollo. |
| `docs/dev/app-ausencias.md` | **Modificar.** El cuarto portón y la deuda que se cierra. |

---

### Task 1: Separar los portones

**Files:**
- Create: `apps/hub-api/vitest.config.ts`
- Create: `apps/hub-api/vitest.db.config.ts`
- Modify: `apps/hub-api/package.json`

- [x] **Step 1: Instalar la dependencia de desarrollo**

```bash
npm install -D @testcontainers/postgresql --workspace=apps/hub-api
```

Si falla pidiendo credenciales del registro privado (`@algarpibe/zoho-sync`), el `.npmrc` de la raíz del monorepo no tiene token válido: pararse y avisar, **no** editar el `.npmrc`.

- [x] **Step 2: Crear `apps/hub-api/vitest.config.ts`**

```ts
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Los *.db.test.ts necesitan Docker y tienen su propio porton
    // (`npm run test:db`). Sacarlos de aqui es lo que mantiene este run en
    // segundos y sin infraestructura: el porton de siempre no debe poder
    // fallar porque un demonio este parado.
    exclude: [...configDefaults.exclude, '**/*.db.test.ts'],
  },
});
```

- [x] **Step 3: Crear `apps/hub-api/vitest.db.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.db.test.ts'],
    globalSetup: ['./src/test-db/contenedor.ts'],
    // Un solo Postgres para toda la suite y un TRUNCATE por test: dos ficheros
    // corriendo a la vez se borrarian las filas el uno al otro.
    fileParallelism: false,
    // Arrancar el contenedor y migrarlo la primera vez baja una imagen.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
```

- [x] **Step 4: Añadir el script en `apps/hub-api/package.json`**

En el bloque `"scripts"`, después de `"test": "vitest run"`:

```json
    "test:db": "vitest run --config vitest.db.config.ts"
```

- [x] **Step 5: Verificar que el portón de siempre no ha cambiado**

```bash
npm run test --workspace=apps/hub-api
```

Esperado: los mismos 746 tests en verde, en segundos, sin Docker. (Flake conocido: `users.service.test.ts > property tests` da timeouts de fast-check ~1 de cada 5 veces. Reejecutar.)

- [x] **Step 6: Commit**

```bash
git add apps/hub-api/vitest.config.ts apps/hub-api/vitest.db.config.ts
git commit -m "test(hub-api): separa los tests que necesitan Postgres en su propio porton" -- apps/hub-api/vitest.config.ts apps/hub-api/vitest.db.config.ts apps/hub-api/package.json package-lock.json
```

---

### Task 2: Extraer `aplicarMigraciones`

**Files:**
- Modify: `apps/hub-api/src/db.ts:53-58`

- [x] **Step 1: Extraer el bucle a una función exportada**

En `apps/hub-api/src/db.ts`, sustituir el bucle que hoy vive dentro de `initDb()` por una función exportada, y hacer que `initDb()` la llame. El resultado:

```ts
/**
 * Aplica en orden las migraciones del array. Exportada —y no en linea dentro de
 * `initDb()`— porque los tests contra Postgres real siembran su contenedor con
 * ESTA funcion: asi recorren el mismo array `MIGRATIONS` y el esquema de test no
 * puede envejecer por su cuenta. Anadir una migracion sin apuntarla en el array
 * es el olvido que no da error, y ahi es donde se delata.
 */
export async function aplicarMigraciones(db: Pool): Promise<void> {
  const dir = migrationsDir();
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.query(sql);
    console.log(`migration applied: ${file}`);
  }
}
```

Y en `initDb()`, donde estaba el bucle:

```ts
  await aplicarMigraciones(db);

  await seedUsersFromEnv(db);
```

`initDb()` no se reutiliza tal cual en los tests: hace `process.exit(1)` sin `HUB_DB_URL` —mataría a vitest— y siembra usuarios desde `AUTH_USERS`.

- [x] **Step 2: Verificar los dos portones**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
```

Esperado: build sin errores, 746 en verde.

- [x] **Step 3: Commit**

```bash
git commit -m "refactor(hub-api): aplicarMigraciones sale de initDb para poder sembrar un contenedor" -- apps/hub-api/src/db.ts
```

---

### Task 3: El harness y el test de las migraciones

**Files:**
- Create: `apps/hub-api/src/test-db/contenedor.ts`
- Create: `apps/hub-api/src/test-db/harness.ts`
- Create: `apps/hub-api/src/db.migraciones.db.test.ts`

- [x] **Step 1: Escribir el test que va a fallar**

Crear `apps/hub-api/src/db.migraciones.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from './db.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from './test-db/harness.js';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('las migraciones contra una base de verdad', () => {
  it('se re-ejecutan sobre una base ya migrada sin romper nada', async () => {
    // `initDb()` las lanza en CADA arranque, y no captura: si una revienta,
    // hub-api no arranca y cae el portal entero. El contenedor ya las aplico
    // una vez en el globalSetup, asi que esto es la segunda pasada.
    await expect(aplicarMigraciones(db)).resolves.toBeUndefined();
  });

  it('CANDADO: los tres eventos de modificacion pasan el CHECK Y caben en la columna', async () => {
    // El 22001 del 2026-08-17: la 024 amplio el CHECK de `evento` y dejo la
    // columna en VARCHAR(20); los tres nombres nuevos miden 21-23 y reventaban
    // en la primera peticion real. Son DOS restricciones distintas y hay que
    // mirar las dos. Lo arreglo la 025.
    const empleadoId = await sembrarEmpleado(db, 'ana.ruiz@ambientalia.com.co');
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: 'ana.ruiz@ambientalia.com.co',
      estado: 'aprobada',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });

    for (const evento of ['modificacion_solicitada', 'modificacion_aprobada', 'modificacion_rechazada']) {
      await db.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [s.id, evento, '{}'],
      );
    }

    expect(await eventosDelOutbox(db)).toEqual([
      'modificacion_solicitada',
      'modificacion_aprobada',
      'modificacion_rechazada',
    ]);
  });
});
```

- [x] **Step 2: Ejecutarlo para verlo fallar**

```bash
npm run test:db --workspace=apps/hub-api
```

Esperado: FALLA al resolver `./test-db/harness.js` (no existe todavía).

- [x] **Step 3: Crear el `globalSetup`**

`apps/hub-api/src/test-db/contenedor.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { GlobalSetupContext } from 'vitest/node';
import { createPoolFromUrl } from '@algarpibe/zoho-sync';
import { aplicarMigraciones } from '../db.js';

let contenedor: StartedPostgreSqlContainer | null = null;

/**
 * Un Postgres de verdad para toda la suite, migrado con el MISMO array que usa
 * el arranque de produccion.
 *
 * La imagen se fija a mano: un `postgres:latest` haria que el harness dijera ser
 * fiel a produccion mientras deriva solo.
 */
export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  // El timeout va AQUI y no en el `hookTimeout` de vitest: ese solo envuelve los
  // before*/after* de los tests, y NO la funcion `setup` de un globalSetup
  // (comprobado en el codigo de vitest 2.1.9). Sin esto, un registry lento o una
  // VPN caida dejan `test:db` colgado para siempre en vez de fallar.
  contenedor = await new PostgreSqlContainer('postgres:16-alpine').withStartupTimeout(180_000).start();
  const url = contenedor.getConnectionUri();

  const db = createPoolFromUrl(url);
  try {
    await aplicarMigraciones(db);
  } finally {
    // Este pool muere aqui: cada fichero de test abre el suyo.
    await db.end();
  }

  provide('urlBd', url);
}

export async function teardown(): Promise<void> {
  await contenedor?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    urlBd: string;
  }
}
```

- [x] **Step 4: Crear el harness**

`apps/hub-api/src/test-db/harness.ts`:

```ts
import { inject } from 'vitest';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearSolicitud } from '../ausencias/repo.js';
import type { PayloadEvento, Solicitud } from '../ausencias/types.js';

/** El pool REAL de produccion, apuntando al contenedor. Ningun doble. */
export function poolDePrueba(): Pool {
  return createPoolFromUrl(inject('urlBd'));
}

/**
 * Vacia las tablas entre tests.
 *
 * No sirve envolver cada test en una transaccion: el codigo bajo prueba abre las
 * suyas con `withTransaction`, y anidarlas exigiria savepoints — justo lo que no
 * se quiere simular, porque el ROLLBACK real es una de las cosas que se prueban.
 */
export async function limpiar(db: Pool): Promise<void> {
  await db.query(
    `TRUNCATE portal.solicitud_modificaciones, portal.solicitudes_ausencia,
              portal.ausencias_outbox, portal.empleados
     RESTART IDENTITY CASCADE`,
  );
}

/** El payload no se ejercita aqui: lo cubre entero notificaciones.test.ts. */
export const payloadStub = () => ({ correo: { para: '', asunto: '', cuerpo: '' } }) as unknown as PayloadEvento;

/**
 * Un empleado por INSERT directo y no por `asegurarEmpleado`: esa funcion exige
 * una fila en `portal.users` con su hash de contrasena, y estos tests no van de
 * altas de usuario. La SOLICITUD si se crea con la funcion real del repo, que es
 * la que importa.
 */
export async function sembrarEmpleado(db: Pool, correo: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.empleados (nombre_completo, correo, cargo, aprobador_correo)
     VALUES ('Ana Ruiz', $1, 'Analista', 'jefe1@ambientalia.com.co')
     RETURNING id`,
    [correo],
  );
  return (rows[0] as { id: string }).id;
}

export interface DatosSiembra {
  empleadoId: string;
  correo: string;
  estado: Solicitud['estado'];
  fechaInicio: string;
  fechaFin: string;
  /** Con correo, la solicitud lleva cascada de dos firmas; con null, una sola. */
  segundoAprobadorCorreo: string | null;
}

/** Una solicitud creada por `crearSolicitud`, sin adjunto y sin eventos. */
export async function sembrarSolicitud(db: Pool, d: DatosSiembra): Promise<Solicitud> {
  return crearSolicitud(
    db,
    {
      tipo: 'vacaciones',
      empleadoId: d.empleadoId,
      solicitanteEmail: d.correo,
      fechaInicio: d.fechaInicio,
      fechaFin: d.fechaFin,
      diasHabiles: 5,
      comentarios: null,
      estado: d.estado,
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
      segundoAprobadorCorreo: d.segundoAprobadorCorreo,
      informadoCorreo: null,
    },
    null,
    // Sin eventos de alta: asi el outbox de cada test cuenta SOLO lo que el
    // propio test provoca.
    [],
    payloadStub,
  );
}

/** Los eventos del outbox, en el orden en que se sirven (por `id`). */
export async function eventosDelOutbox(db: Pool): Promise<string[]> {
  const { rows } = await db.query('SELECT evento FROM portal.ausencias_outbox ORDER BY id');
  return (rows as { evento: string }[]).map((r) => r.evento);
}
```

- [x] **Step 4b: Corregir el comentario de `vitest.db.config.ts`**

El comentario que hoy acompaña al `hookTimeout` promete algo que ese ajuste no da (no cubre el `globalSetup`). Sustituirlo:

```ts
    // Cubre los before*/after* de los tests, NO el arranque del contenedor: el
    // globalSetup se protege solo, con su propio `withStartupTimeout`.
    hookTimeout: 180_000,
```

- [x] **Step 5: Ejecutar y ver verde**

```bash
npm run test:db --workspace=apps/hub-api
```

Esperado: 2 tests en verde. La primera vez tarda (descarga de la imagen).

- [x] **Step 6: Falsar el candado del `22001`**

Quitar `'025_ausencias_evento_ancho.sql'` del array `MIGRATIONS` de `apps/hub-api/src/db.ts` y volver a correr `npm run test:db`.

Esperado: el test del outbox **falla con `22001` (`value too long for type character varying(20)`)**, que es exactamente el fallo que tumbó la primera petición real el 2026-08-17. El de idempotencia sigue verde.

Revertir: `git checkout -- apps/hub-api/src/db.ts` y confirmar que vuelve a verde. **Reportar la salida de las dos ejecuciones.**

- [x] **Step 7: Commit**

```bash
git add apps/hub-api/src/test-db/contenedor.ts apps/hub-api/src/test-db/harness.ts apps/hub-api/src/db.migraciones.db.test.ts
git commit -m "test(hub-api): las migraciones se prueban contra un Postgres de verdad" -- apps/hub-api/src/test-db/contenedor.ts apps/hub-api/src/test-db/harness.ts apps/hub-api/src/db.migraciones.db.test.ts
```

---

### Task 4: Testigo de `decidirSolicitud` (el doble clic)

**Files:**
- Create: `apps/hub-api/src/ausencias/repo.testigos.db.test.ts`

- [x] **Step 1: Escribir el test**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { decidirSolicitud, solicitudPorId } from './repo.js';
import { transicionAlDecidir } from './types.js';
import {
  poolDePrueba,
  limpiar,
  payloadStub,
  sembrarEmpleado,
  sembrarSolicitud,
  eventosDelOutbox,
} from '../test-db/harness.js';

const CORREO = 'ana.ruiz@ambientalia.com.co';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('decidirSolicitud contra Postgres real', () => {
  it('CANDADO: el doble clic del jefe decide UNA vez, no dos', async () => {
    // Las dos peticiones leen `pendiente` antes de que ninguna escriba, asi que
    // las dos calculan la MISMA transicion y llegan con el mismo testigo. Sin el
    // `AND estado = $7` las dos escribirian, y saldrian dos correos.
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'pendiente',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: 'jefe2@ambientalia.com.co',
    });

    const transicion = transicionAlDecidir(s, true);
    if (!transicion) throw new Error('una solicitud pendiente siempre tiene transicion');

    const primera = await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub);
    const segunda = await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub);

    expect(primera?.estado).toBe('pendiente_2');
    // El servicio traduce este null a 409. Es un conflicto, no un fallo.
    expect(segunda).toBeNull();

    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('pendiente_2');
    // UN aviso al segundo firmante, no dos.
    expect(await eventosDelOutbox(db)).toEqual(['aprobacion_2']);
  });
});
```

- [x] **Step 2: Ejecutar y ver verde**

```bash
npm run test:db --workspace=apps/hub-api
```

Esperado: 3 tests en verde.

- [x] **Step 3: Falsar el candado**

En `apps/hub-api/src/ausencias/repo.ts:1057`, sustituir:

```sql
        WHERE id = $1 AND estado = $7
```

por:

```sql
        WHERE id = $1 AND estado IN ('pendiente', 'pendiente_2') AND $7::text IS NOT NULL
```

⚠️ El `AND $7::text IS NOT NULL` es imprescindible y no es decorativo. Si se quita `$7` del todo, el array de valores sigue mandando siete y Postgres **rechaza el bind** («bind message supplies 7 parameters, but prepared statement requires 6») antes de ejecutar nada: el test se pone rojo, pero por un error del driver en la PRIMERA llamada, sin llegar a ejercitar la carrera. Eso no falsa el candado, solo demuestra que el SQL está roto. Manteniendo el parámetro pero inerte, el testigo muere y la carrera sí ocurre. El `::text` fija el tipo, que si no Postgres no puede inferirlo.

Correr `npm run test:db`.

Esperado: **rojo**. `segunda` deja de ser `null` (la segunda petición vuelve a escribir) y el outbox trae dos `aprobacion_2`: dos correos contradictorios al mismo firmante por un doble clic.

Revertir con `git checkout -- apps/hub-api/src/ausencias/repo.ts`, confirmar verde y **reportar las dos salidas**.

- [x] **Step 4: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.testigos.db.test.ts
git commit -m "test(ausencias): el testigo de decidirSolicitud se prueba ejecutando el SQL" -- apps/hub-api/src/ausencias/repo.testigos.db.test.ts
```

---

### Task 5: Testigo de `crearModificacion` (la foto que miente)

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.testigos.db.test.ts`

- [x] **Step 0: Factorizar la siembra antes de que se copie cinco veces**

Las tareas 5 a 8 siembran todas lo mismo y solo cambian el `estado`. Introducir en el fichero, bajo la constante `CORREO`, un helper local:

```ts
/**
 * La solicitud de partida de cada caso. Solo varian el estado y si hay cascada:
 * las fechas y el correo son los mismos en todos, y repetirlos en cada test
 * enterraria lo unico que cada uno cambia.
 */
async function sembrarCaso(
  estado: Solicitud['estado'],
  segundoAprobadorCorreo: string | null = null,
): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  return sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo,
  });
}
```

Necesita `import type { Solicitud } from './types.js';` junto al de `transicionAlDecidir`.

Y reescribir la siembra del test de la Task 4 para usarlo:

```ts
    const s = await sembrarCaso('pendiente', 'jefe2@ambientalia.com.co');
```

Correr `npm run test:db` y comprobar que los 3 tests siguen en verde antes de seguir: es un refactor, no debe cambiar ningún resultado.

Aprovechar para copiar en el `afterAll` de este fichero el comentario que ya justifica el `db?.end()` en `db.migraciones.db.test.ts`: sin él, un futuro editor quita el `?` creyendo que sobra, y el TypeError taparía el error que de verdad importa.

- [x] **Step 1: Añadir el import de `crearModificacion`**

En la línea del import de `./repo.js`, dejarla así:

```ts
import { decidirSolicitud, solicitudPorId, crearModificacion } from './repo.js';
```

- [x] **Step 2: Añadir el bloque de test al final del fichero**

```ts
describe('crearModificacion contra Postgres real', () => {
  it('CANDADO: si la aprueban mientras escribes, la propuesta NO se guarda con una foto falsa', async () => {
    // `estado_previo` es cierto POR CONSTRUCCION gracias al testigo. Si se
    // guardara una foto que dice `pendiente` sobre algo que ya esta aprobada y
    // ya esta en el calendario de Google, el correo de la decision no avisaria
    // de tocarlo.
    const s = await sembrarCaso('pendiente');

    // El jefe la aprueba entre que el servicio leyo el estado y llega el INSERT.
    await db.query(`UPDATE portal.solicitudes_ausencia SET estado = 'aprobada' WHERE id = $1`, [s.id]);

    const r = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'pendiente',
        fechaInicioNueva: '2026-07-13',
        fechaFinNueva: '2026-07-17',
        diasHabilesNuevos: 5,
        motivo: 'Cita medica',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );

    expect(r).toEqual({ ok: false, razon: 'estado' });

    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.solicitud_modificaciones');
    expect((rows[0] as { n: number }).n).toBe(0);
    expect(await eventosDelOutbox(db)).toEqual([]);
  });
});
```

- [x] **Step 3: Ejecutar y ver verde**

```bash
npm run test:db --workspace=apps/hub-api
```

Esperado: 4 tests en verde.

- [x] **Step 4: Falsar el candado**

En `apps/hub-api/src/ausencias/repo.ts`, dentro del `INSERT INTO portal.solicitud_modificaciones`, sustituir:

```sql
          WHERE s.id = $1 AND s.estado = $8
```

por:

```sql
          WHERE s.id = $1 AND s.estado IN ('pendiente', 'pendiente_2', 'aprobada') AND $8::text IS NOT NULL
```

⚠️ Igual que en la Task 4: el `AND $8::text IS NOT NULL` mantiene vivo el parámetro. Sin él, el array sigue mandando ocho valores para siete placeholders y Postgres rechaza el bind antes de ejecutar nada — un rojo del driver que no falsa el candado.

Correr `npm run test:db`.

Esperado: **rojo**. `r` pasa a `{ok:true, ...}`, queda una fila en `solicitud_modificaciones` con `estado_previo = 'pendiente'` mintiendo sobre una solicitud aprobada, y el outbox trae un `modificacion_solicitada`.

Revertir, confirmar verde y **reportar las dos salidas**.

- [x] **Step 5: Commit**

```bash
git commit -m "test(ausencias): el testigo de crearModificacion se prueba ejecutando el SQL" -- apps/hub-api/src/ausencias/repo.testigos.db.test.ts
```

---

### Task 6: El testigo TRIPLE (la corrección pisada)

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.testigos.db.test.ts`

- [x] **Step 0: Que el rojo del test anterior nombre el daño**

En el test de `crearModificacion`, justo antes de `expect(r).toEqual({ ok: false, razon: 'estado' })`, añadir:

```ts
    // El rojo tiene que decir QUE se colo, no solo que se colo: sin esto el diff
    // elide los 17 campos de la propuesta y el decisor obsoleto —lo unico que
    // protege el testigo— no aparece por ningun lado.
    if (r.ok) {
      throw new Error(
        `el testigo dejo pasar la propuesta, congelada a nombre de ${r.modificacion.aprobadorCorreo} cuando el turno es de jefe2@ambientalia.com.co`,
      );
    }
```

Y rebajar el comentario de la aserción de `modificacionesPendientes` a lo que de verdad es: en verde es redundante con el `count(*) = 0` de dos líneas antes, y en rojo no llega a ejecutarse porque Vitest aborta en el primer `expect` fallido. Está ahí para que el lector vea cuál era la consecuencia, no para probarla.

- [x] **Step 1: Ampliar el import de `./repo.js`**

```ts
import {
  decidirSolicitud,
  solicitudPorId,
  crearModificacion,
  decidirModificacion,
  modificacionPorId,
} from './repo.js';
```

- [x] **Step 2: Añadir el bloque de test al final del fichero**

```ts
describe('el testigo TRIPLE de aplicarALaSolicitud', () => {
  it('CANDADO: aprobar un cambio NO pisa la correccion que un admin hizo por PATCH', async () => {
    // Los tres campos hacen falta. Solo con el estado no se detecta que un admin
    // haya corregido las fechas entre medias, y la aprobacion se las pisaria EN
    // SILENCIO: el PATCH no encola nada, asi que nadie se enteraria nunca.
    const s = await sembrarCaso('aprobada');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: '2026-07-13',
        fechaFinNueva: '2026-07-17',
        diasHabilesNuevos: 5,
        motivo: 'Cita medica',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta deberia haber funcionado, y dio ${alta.razon}`);

    // El admin corrige las fechas por PATCH. No encola nada.
    await db.query(
      `UPDATE portal.solicitudes_ausencia
          SET fecha_inicio = '2026-07-07', fecha_fin = '2026-07-11'
        WHERE id = $1`,
      [s.id],
    );

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r).toEqual({ ok: false, razon: 'solicitud_cambio_de_estado' });

    // El ROLLBACK de verdad: el paso 1 YA habia escrito «aprobada» sobre la
    // propuesta cuando el paso 2 choco, y solo deshacer la transaccion entera lo
    // devuelve a `pendiente`.
    const m = await modificacionPorId(db, alta.modificacion.id);
    expect(m?.estado).toBe('pendiente');

    // La correccion del admin sigue en pie.
    const final = await solicitudPorId(db, s.id);
    expect(final?.fechaInicio).toBe('2026-07-07');
    expect(final?.fechaFin).toBe('2026-07-11');

    // Y no ha salido ningun correo anunciando un cambio que no ha ocurrido: en
    // el outbox solo esta el aviso del alta de la propuesta.
    expect(await eventosDelOutbox(db)).toEqual(['modificacion_solicitada']);
  });
});
```

- [x] **Step 3: Ejecutar y ver verde**

```bash
npm run test:db --workspace=apps/hub-api
```

Esperado: 5 tests en verde.

Las fechas se comparan contra cadenas porque `SELECT_SOLICITUD` las castea: `s.fecha_inicio::text AS fecha_inicio` (`repo.ts:771`). Sin ese cast el driver las devolvería como `Date` y la comparación fallaría en silencio.

- [x] **Step 4: Falsar el candado**

En `apps/hub-api/src/ausencias/repo.ts`, en la constante `TESTIGO_SOLICITUD`, reducir el testigo al estado **manteniendo los dos parámetros mencionados y tipados**:

```sql
  WHERE id = $1
    AND estado       = $2
    AND $3::date IS NOT NULL
    AND $4::date IS NOT NULL
```

⚠️ Borrar las dos líneas a secas **no funciona**, y por un motivo distinto al de las tareas 4 y 5. Aquí el número de parámetros sí cuadra (`$5`, `$6` y `$7` siguen usándose en el `SET`), pero al desaparecer `$3` y `$4` del texto Postgres **no tiene de dónde inferir su tipo** y falla en el `Parse`: «could not determine data type of parameter $3». Ese rojo solo demuestra que el SQL ya no compila. Con el `::date` siguen tipados y son siempre ciertos, así que el testigo queda reducido al estado y la carrera ocurre de verdad.

Correr `npm run test:db`.

Esperado: **rojo** en `expect(r).toEqual({ ok: false, razon: 'solicitud_cambio_de_estado' })`. Y el daño, verificado con sonda: la solicitud queda con `2026-07-13`/`2026-07-17` —la corrección del admin pisada y sin rastro, porque el PATCH no encola nada—, la propuesta queda `aprobada` (sin `ChoqueConLaSolicitud` no hay ROLLBACK) y el outbox trae `modificacion_aprobada`, o sea el correo anunciando un cambio que nadie autorizó.

Revertir, confirmar verde y **reportar las dos salidas**.

- [x] **Step 5: Commit**

```bash
git commit -m "test(ausencias): el testigo triple se prueba ejecutando el SQL" -- apps/hub-api/src/ausencias/repo.testigos.db.test.ts
```

---

### Task 7: El `23505` que emite Postgres

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.testigos.db.test.ts`

- [x] **Step 1: Añadir el bloque de test al final del fichero**

```ts
describe('el indice unico parcial de la 024', () => {
  it('CANDADO: la segunda propuesta viva la corta la BASE, y el codigo la reconoce por su nombre', async () => {
    // Esta carrera no la puede cortar una comprobacion en JS: dos peticiones
    // simultaneas pasarian las dos antes de que ninguna escribiera. Y el `catch`
    // exige el NOMBRE del constraint, asi que el que emite Postgres y el que
    // compara el codigo tienen que ser el mismo. Con un pool falso eso es
    // circular: el test se inventa el nombre que el codigo espera.
    const s = await sembrarCaso('aprobada');

    const datos = {
      solicitudId: s.id,
      clase: 'fechas' as const,
      estadoEsperado: 'aprobada' as const,
      fechaInicioNueva: '2026-07-13',
      fechaFinNueva: '2026-07-17',
      diasHabilesNuevos: 5,
      motivo: 'Cita medica',
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
    };

    const primera = await crearModificacion(db, datos, payloadStub);
    expect(primera.ok).toBe(true);

    const segunda = await crearModificacion(db, datos, payloadStub);
    expect(segunda).toEqual({ ok: false, razon: 'duplicada' });

    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.solicitud_modificaciones');
    expect((rows[0] as { n: number }).n).toBe(1);
  });
});
```

- [x] **Step 2: Ejecutar y ver verde**

```bash
npm run test:db --workspace=apps/hub-api
```

Esperado: 6 tests en verde.

- [x] **Step 3: Falsar el candado**

En `apps/hub-api/src/ausencias/repo.ts`, cambiar la constante:

```ts
const UX_UNA_PENDIENTE = 'ux_modificaciones_una_pendiente';
```

por:

```ts
const UX_UNA_PENDIENTE = 'ux_modificaciones_otra_cosa';
```

Correr `npm run test:db`.

Esperado: **rojo**, con el error del driver propagándose (`duplicate key value violates unique constraint`) en vez de traducirse a `{ok:false, razon:'duplicada'}`. Es decir: un 500 en producción el día que alguien renombre el índice en una migración. Eso es justo lo que el test con pool falso no podía ver.

Revertir, confirmar verde y **reportar las dos salidas**.

- [x] **Step 4: Commit**

```bash
git commit -m "test(ausencias): el 23505 del indice unico lo emite Postgres, no el test" -- apps/hub-api/src/ausencias/repo.testigos.db.test.ts
```

---

### Task 8: Limpiar las aserciones de forma ya cubiertas

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.test.ts`

- [x] **Step 1: Borrar los tres tests de forma redundantes**

Borrar de `apps/hub-api/src/ausencias/repo.test.ts`, enteros:

1. `it('CANDADO (de forma): el INSERT lleva el testigo `AND s.estado = $8`', ...)` — lo cubre ahora la Task 5, por comportamiento.
2. `it('CANDADO (de forma): el UPDATE de la solicitud lleva el testigo TRIPLE', ...)` — lo cubre la Task 6.
3. `it('CANDADO (de forma): aprobar un cambio de fechas NO escribe el estado', ...)` — sustituido en el Step 2.

**No** borrar: `it('CANDADO: un 23505 de OTRO constraint se propaga...')` ni `it('un error que no es 23505 se propaga tal cual')`. Ese sigue siendo el sitio de los errores del driver, que Postgres no puede dar sin ensuciar el esquema.

**No** borrar `it('CANDADO (de forma): la anulacion deja rechazada + anulada_at, con el mismo testigo')` todavía: se sustituye en el Step 2.

Si al borrar quedan sin usar los helpers `forma`, `hizo` o `updateDeLaSolicitud`, borrar también los que ya no se usen — el typecheck lo dirá.

- [x] **Step 2: Sustituirlos por comportamiento en el fichero de BD**

Añadir al final de `apps/hub-api/src/ausencias/repo.testigos.db.test.ts`:

```ts
describe('lo que escribe aprobar una modificacion', () => {
  it('CANDADO: aprobar un cambio de fechas NO re-decide la solicitud', async () => {
    // Aprobar un cambio no es decidir la solicitud. Si el SET tocara `estado`,
    // una `pendiente` quedaria concedida sin que ningun firmante la firmara.
    const s = await sembrarCaso('pendiente');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'pendiente',
        fechaInicioNueva: '2026-07-13',
        fechaFinNueva: '2026-07-17',
        diasHabilesNuevos: 5,
        motivo: 'Cita medica',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta deberia haber funcionado, y dio ${alta.razon}`);

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r.ok).toBe(true);

    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('pendiente');
    expect(final?.fechaInicio).toBe('2026-07-13');
    expect(final?.anuladaAt).toBeNull();
  });

  it('CANDADO: anular deja rechazada + anulada_at, y NO toca las fechas', async () => {
    // Anular no estrena estado: `rechazada` ya hereda la semantica correcta en
    // los seis filtros que miran el estado, y `anulada_at` es lo unico que la
    // distingue de un rechazo del jefe. Las fechas se conservan: la ausencia
    // anulada sigue diciendo cual era.
    const s = await sembrarCaso('aprobada');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'anulacion',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: null,
        fechaFinNueva: null,
        diasHabilesNuevos: null,
        motivo: 'Se cancelo el viaje',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta deberia haber funcionado, y dio ${alta.razon}`);

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r.ok).toBe(true);

    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('rechazada');
    expect(final?.anuladaAt).not.toBeNull();
    expect(final?.fechaInicio).toBe('2026-07-06');
    expect(final?.fechaFin).toBe('2026-07-10');
  });
});
```

- [x] **Step 3: Borrar el test de forma de la anulación**

Ahora sí, borrar de `repo.test.ts` el `it('CANDADO (de forma): la anulacion deja `rechazada` + `anulada_at`, con el mismo testigo', ...)`.

- [x] **Step 3b: Cerrar los dos huecos que abre el borrado**

Al quitar las aserciones de forma se pierde cobertura que **ningún** test de comportamiento tenía. Verificado mutando: neutralizando las dos cosas de abajo, los 742 + 8 se quedan verdes y nadie se entera.

Añadir dos `it` más al `describe('el testigo TRIPLE de aplicarALaSolicitud')`:

1. **El campo `estado` del testigo triple.** Ningún test movía el estado entre el alta de la propuesta y su decisión. Sembrar `pendiente` con cascada, crear la propuesta, mover la solicitud a `pendiente_2` con `decidirSolicitud` real, y aprobar: `{ok:false, razon:'solicitud_cambio_de_estado'}`, propuesta en `pendiente`, fechas originales intactas. *Falsación:* `AND estado = $2` → `AND $2::text IS NOT NULL`.

2. **La rama de anulación.** Las dos clases comparten `TESTIGO_SOLICITUD` con `SET` distintos, y **todos** los tests del testigo corrían por la rama de `fechas`: desenganchar la de anulación dejaba la batería en verde. Sembrar `aprobada`, propuesta de `clase: 'anulacion'` (los tres campos nuevos a `null`, lo exige el CHECK `modificaciones_campos_por_clase`), PATCH del admin sobre las fechas, y aprobar: mismo choque. *Falsación:* dejarle a la rama de anulación un `WHERE id = $1` a secas.

- [x] **Step 4: Verificar los cuatro portones**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
npm run test:db --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

Esperado: build limpio, **742** tests en verde (746 menos los **cuatro** borrados), **10** tests de BD en verde, portal compila.

- [x] **Step 5: Commit**

```bash
git commit -m "test(ausencias): las aserciones de forma dejan paso al comportamiento" -- apps/hub-api/src/ausencias/repo.test.ts apps/hub-api/src/ausencias/repo.testigos.db.test.ts
```

---

### Task 9: El texto que dejó de ser cierto

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts`
- Modify: `apps/hub-api/src/ausencias/repo.test.ts`
- Modify: `docs/dev/app-ausencias.md`

- [x] **Step 1: Reescribir el comentario de `crearModificacion`**

⚠️ **El JSDoc SÍ se toca, y es lo más importante de esta tarea.** La revisión de la Task 5 demostró, con sondas contra Postgres real, que su explicación es falsa: dice que sin el testigo la propuesta se guardaría con `estado_previo = 'pendiente'` sobre algo ya aprobado, pero `estado_previo` sale de `s.estado` en el mismo `SELECT` y es el valor real de la fila **con testigo y sin él**. Esa garantía es del punto 1 (el `SELECT` dentro del `INSERT`), no del testigo.

Lo que el testigo protege de verdad es **`aprobador_correo` (`$7`)**, el único dato del INSERT que el servicio DERIVÓ de su lectura: `service.ts:579` lo rellena con `decisorDeModificacion(solicitud)` = `correoDelTurno(s) ?? s.aprobadorCorreo`, y `correoDelTurno` depende del estado. Si la solicitud avanza de `pendiente` a `pendiente_2` entre la lectura y el INSERT, la propuesta se congela a nombre del jefe que **ya firmó**; y `modificacionesPendientes`, `puedeDecidirModificacion` y el correo del alta filtran los tres por ese campo, así que la propuesta entera aterriza en la bandeja de quien ya no tiene el turno y el firmante que sí lo tiene no la ve nunca. Sin 403 y sin error: se decide en silencio y mal.

Hay un segundo matiz que el JSDoc borra: `estado_previo` es cierto respecto al **snapshot de su sentencia**, no para siempre. `withTransaction` abre un `BEGIN` pelado (READ COMMITTED) y el `SELECT` no lleva `FOR UPDATE`, así que una aprobación que confirme justo después lo deja obsoleto — con testigo y sin él por igual. Quien lo verifica en el momento de USARLO es el testigo TRIPLE de `aplicarALaSolicitud`.

Reescribir el bullet 2 del JSDoc con ese contenido, y el párrafo del «Mismo aviso que en `decidirSolicitud`» dejando claro que el `IN` es tentador precisamente porque `estado_previo` seguiría siendo cierto, y que lo que destruye es la coherencia entre la fila y el decisor congelado.

La misma corrección va en `docs/dev/app-ausencias.md`, punto 1 de «La concurrencia: dos testigos» (línea 1087 aprox.).

Y dentro del SQL, sustituir el bloque:

```
          -- NINGUN TEST EJECUTA ESTE SQL: el doble de router.test.ts es in-memory
          -- y los 677 siguen verdes con el IN. Lo unico que lo vigila es una
          -- asercion de FORMA en repo.test.ts que busca este texto literal, y
          -- este comentario.
```

por:

```
          -- ⚠️ $8 es el estado que LEYO el servicio, NO una lista de estados
          -- admisibles. No cambiar por IN ('pendiente','pendiente_2','aprobada'):
          -- `estado_previo` seguiria siendo cierto —sale de s.estado, aqui al
          -- lado—, pero $7, el decisor congelado, lo calculo el servicio con el
          -- estado viejo. Si la solicitud avanza de nivel entre medias, la
          -- propuesta queda a nombre del firmante que ya firmo, y la bandeja, el
          -- guard y el correo la mandan los tres alli: el que tiene el turno no
          -- la ve. Lo vigila `repo.testigos.db.test.ts`, que ejecuta este SQL
          -- contra un Postgres de verdad; se comprobo poniendo el IN y el test se
          -- pone rojo. Corre en el cuarto porton, `npm run test:db`.
```

- [x] **Step 2: Reescribir el comentario de `TESTIGO_SOLICITUD`**

Sustituir:

```
    -- NINGUN TEST EJECUTA ESTE SQL: el doble de router.test.ts es in-memory y
    -- modela el testigo por su cuenta, asi que quitar dos de los tres campos
    -- deja toda la bateria en verde. Lo unico que lo vigila es una asercion de
    -- FORMA en repo.test.ts que busca este texto literal, y este comentario.
```

por:

```
    -- Lo vigila `repo.testigos.db.test.ts` contra un Postgres de verdad: un admin
    -- corrige las fechas por PATCH entre medias y la aprobacion tiene que chocar.
    -- Se comprobo quitando las dos lineas de fecha: el test se pone rojo. Corre
    -- en el cuarto porton, `npm run test:db`.
```

- [x] **Step 3: Añadir a `decidirSolicitud` la nota que nunca tuvo**

En su JSDoc, después del párrafo del `⚠️ estadoEsperado`, añadir:

```
 * Lo vigila `repo.testigos.db.test.ts`: dos llamadas con el mismo `estadoEsperado`
 * —el doble clic— y la segunda tiene que devolver `null` sin encolar un segundo
 * correo. Falsado sustituyendolo por un `IN`: el test se pone rojo.
```

- [x] **Step 4: Actualizar la cabecera de `repo.test.ts`**

Sustituir «Los únicos tests del repo que no necesitan Postgres» y el párrafo que sigue por una cabecera que diga qué queda aquí y qué se fue:

```ts
// Los tests del repo que NO necesitan Postgres: como se traduce un error del
// DRIVER, que el doble de `router.test.ts` nunca lanza porque comprueba en JS
// antes de escribir.
//
// Lo que era «forma del SQL» se fue a `repo.testigos.db.test.ts`, que ejecuta
// las mismas consultas contra un Postgres de verdad (`npm run test:db`). Asertar
// sobre el texto de una consulta protege el texto, no lo que hace.
```

- [x] **Step 5: Actualizar la documentación viva**

En `docs/dev/app-ausencias.md`, en los sitios exactos donde hoy vive el texto invalidado:

- **Línea 1165**, el bloque `> ⚠️ **Los dos testigos de concurrencia viven en SQL que ningún test ejecuta.**` (hasta el «no es deuda nueva, es cómo funciona este módulo» de la 1174): sustituirlo por la descripción del cuarto portón — qué cubre, cómo se corre (`npm run test:db --workspace=apps/hub-api`), que **necesita Docker arrancado** y que la imagen es `postgres:16-alpine`.
- **Sección «La concurrencia: dos testigos» (línea 1085)**: añadir que ahora son **tres** los vigilados —`decidirSolicitud` incluido, que no lo estaba— y que cada uno se falsó rompiéndolo.
- **Línea 1182**, el párrafo del doble in-memory de `router.test.ts`: se queda, sigue siendo deuda. Añadir que los demás invariantes que solo viven en SQL (`ausenciasEntre`, bandejas, saldo) siguen sin ejecutarse en ningún test.
- Donde se listan los portones, añadir el cuarto dejando claro que **no** corre con `npm run test`.

- [x] **Step 6: Verificar los cuatro portones otra vez**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
npm run test:db --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

- [x] **Step 7: Commit**

```bash
git commit -m "docs(ausencias): el texto de los testigos cuenta lo que ahora los vigila" -- apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo.test.ts docs/dev/app-ausencias.md
```

---

### Task 10: Cerrar la rama

**Files:** ninguno nuevo.

- [x] **Step 1: Los cuatro portones, en limpio y seguidos**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
npm run test:db --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

Reportar el número exacto de tests de cada uno. Si `users.service.test.ts > property tests` da timeout, reejecutar (flake conocido de fast-check).

- [x] **Step 2: Revisar el diff entero**

```bash
git diff main...test/testigos-concurrencia --stat
git diff main...test/testigos-concurrencia
```

Comprobar que **ninguna** de las cinco mutaciones de falsación se ha quedado dentro. Esto es lo más importante de la revisión: una mutación olvidada en `repo.ts` va a producción.

- [x] **Step 3: Mezclar**

```bash
git checkout main
git merge --no-ff test/testigos-concurrencia -m "merge: los testigos de concurrencia se prueban contra Postgres de verdad"
```

- [x] **Step 4: No desplegar todavía**

Esto no toca código de producción salvo la extracción de `aplicarMigraciones` en `db.ts`, que sí va en la imagen. Empujar cuando el usuario lo diga; el orden de despliegue es hub-api primero, portal después.

---

## Riesgos conocidos

- ~~**La imagen `postgres:16-alpine` es una asunción.**~~ **Cerrado el 2026-08-18: era falsa.** EasyPanel corre **PostgreSQL 17.10 sobre Debian**. Corregido a `postgres:17` (variante Debian, no alpine: alpine va con musl y la ordenación de texto depende de la libc). Los 10 tests pasan contra la 17, y las 21 migraciones aplican limpias sobre ella desde cero.
- **Docker tiene que estar arrancado.** Si el demonio está parado, `test:db` falla con un error de conexión de testcontainers, no con un test rojo. Es esperado: por eso vive en un portón aparte.
- **La primera ejecución descarga la imagen** y puede tardar minutos. El límite lo pone `withStartupTimeout(180_000)` dentro de `contenedor.ts`, **no** el `hookTimeout` de Vitest: ese no envuelve la función `setup()` de un `globalSetup` (comprobado en el código de Vitest 2.1.9).
- **`tsconfig.json` incluye `src` entero**, así que `tsc -b` typechequea también los `*.db.test.ts`. Si `@testcontainers/postgresql` no está instalado, el portón de build falla — no solo el de BD.
