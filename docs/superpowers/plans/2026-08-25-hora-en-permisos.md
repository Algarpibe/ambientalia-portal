# Hora opcional en los permisos — plan de implementación

> **Para quien lo ejecute:** SUB-SKILL OBLIGATORIA: usa
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para ir tarea a tarea. Los pasos llevan checkbox
> (`- [ ]`) para poder marcarlos.

**Objetivo:** que un permiso de un solo día pueda llevar hora de inicio y de fin
opcionales, que viajen con la solicitud y que en el Google Calendar del equipo se
pinten como un bloque horario en vez de un evento de día completo.

**Arquitectura:** dos columnas `TIME` nulas en `solicitudes_ausencia` con un
CHECK que exige la pareja completa, el orden y un solo día; una rama nueva en el
constructor del payload de calendario que emite ISO con desfase explícito y sin
el `+1 día`; y un campo `todoElDia` en el payload que n8n lee **exigiendo el
`false`**, de modo que todo lo que no lo diga siga siendo de día completo.

**Stack:** Express 4 + TypeScript ESM (imports con `.js`), SQL crudo con `$1`,
Vitest 2.1.9, Postgres vía testcontainers para `test:db`, React en
`apps/ausencias` (sin tests: su único portón es `tsc --noEmit`), n8n para Google.

**Spec:** `docs/superpowers/specs/2026-08-25-hora-en-permisos-design.md`

---

## Antes de empezar

- Rama: `git checkout -b feat/hora-en-permisos` desde `main`.
- Docker tiene que estar arrancado para todo lo de `test:db`. Si diera
  «Could not find a working container runtime strategy»:
  `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"` y esperar
  unos diez segundos.
- Convenciones: código y comentarios **en español**, los comentarios explican el
  **porqué**. Con tildes en todo **excepto en los `.db.test.ts`**, que van sin
  ellas. Los `.sql` **sí** llevan tildes. Los mensajes de commit, en español y
  **sin tildes**. Nunca `git add -A`: rutas explícitas.
- No correr dos suites de Vitest a la vez: la contención de CPU provoca timeouts
  que parecen fallos reales.
- ⚠️ **Commitear ANTES de mutar** en la tarea 9: el `git checkout --` con el que
  se revierte cada mutación se lleva por delante lo que no esté commiteado.

## Estructura de ficheros

| Fichero | Qué le toca |
|---|---|
| `apps/hub-api/src/users/migrations/036_ausencias_hora_permiso.sql` | **Crear.** Las dos columnas y el CHECK. |
| `apps/hub-api/src/db.ts` | Añadir la 036 al array `MIGRATIONS`. |
| `apps/hub-api/src/ausencias/types.ts` | `Solicitud`, `NuevaSolicitud` y `EventoCalendario` ganan campos. |
| `apps/hub-api/src/ausencias/repo.ts` | `SELECT_SOLICITUD`, `FilaSolicitudDb`, `aSolicitud`, `DatosInsercion`, el INSERT, y los dos UPDATE que cambian fechas. |
| `apps/hub-api/src/ausencias/service.ts` | La validación en `validarNuevaSolicitud` y el paso de las horas al alta. |
| `apps/hub-api/src/ausencias/notificaciones.ts` | La rama con hora de `calendario()` y la hora en `bloqueFechas`. |
| `apps/hub-api/src/ausencias/repo.hora.db.test.ts` | **Crear.** Todo el SQL: el CHECK y los dos borrados. |
| `apps/hub-api/src/ausencias/service.test.ts` | La validación. |
| `apps/hub-api/src/ausencias/notificaciones.test.ts` | El payload de calendario y el correo. |
| `apps/ausencias/src/api.ts` | Espejo manual: `Solicitud` y `NuevaSolicitud`. |
| `apps/ausencias/src/dominio.ts` | `fechasDeLaFila` y `rangoFechas`. |
| `apps/ausencias/src/FormularioSolicitud.tsx` | Los dos `input type="time"`. |
| n8n `dh0xjWCHsGj9raYH` | Un campo en cada uno de dos nodos. |

---

## Task 1: La migración 036 y su candado

⚠️ **Añadir la migración al array `MIGRATIONS` de `db.ts` no da ningún error si
se olvida**: la migración simplemente no corre y la columna no existe en
producción. El primer test de esta tarea es lo único que lo caza.

**Files:**
- Create: `apps/hub-api/src/users/migrations/036_ausencias_hora_permiso.sql`
- Modify: `apps/hub-api/src/db.ts:24`
- Create: `apps/hub-api/src/ausencias/repo.hora.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/ausencias/repo.hora.db.test.ts` (sin tildes, es un
`.db.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// La hora opcional de los permisos contra Postgres de verdad.
//
// Todo lo de este fichero es SQL, y en este repo una regla escrita en SQL solo
// la vigila un test de test:db: el doble in-memory de router.test.ts no ejecuta
// consultas, asi que un CHECK que falte o un CASE mal puesto pasarian los mil y
// pico unitarios en verde.

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

/**
 * Inserta una solicitud A PELO, saltandose el repo a proposito: lo que se
 * prueba aqui es el CHECK de la base, y pasar por la validacion del servicio
 * probaria la validacion en vez de la constraint.
 */
async function insertar(
  empleadoId: string,
  fechaInicio: string,
  fechaFin: string,
  horaInicio: string | null,
  horaFin: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO portal.solicitudes_ausencia
       (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin, dias_habiles,
        hora_inicio, hora_fin)
     VALUES ('permiso', $1, 'ana@hora.test', $2::date, $3::date, 1, $4::time, $5::time)`,
    [empleadoId, fechaInicio, fechaFin, horaInicio, horaFin],
  );
}

describe('migracion 036', () => {
  it('CANDADO: las dos columnas existen (o sea, la 036 esta en el array MIGRATIONS)', async () => {
    // Olvidar el array no da ningun error: la migracion no corre y la columna
    // no existe solo en produccion. Este test es el unico que lo caza.
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'solicitudes_ausencia'
          AND column_name IN ('hora_inicio', 'hora_fin')
        ORDER BY column_name`,
    );
    // Se fija el tipo entero y no solo el nombre, mismo patron que el candado
    // de la 035: un data_type que cambiara sin que este test se enterara
    // pasaria desapercibido hasta que una comparacion de otra tarea mirara
    // contra el tipo equivocado.
    expect(rows).toEqual([
      { column_name: 'hora_fin', data_type: 'time without time zone', is_nullable: 'YES' },
      { column_name: 'hora_inicio', data_type: 'time without time zone', is_nullable: 'YES' },
    ]);
  });

  it('una solicitud sin horas se guarda igual que siempre', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-03', null, null);
    const { rows } = await db.query('SELECT hora_inicio, hora_fin FROM portal.solicitudes_ausencia');
    expect(rows[0]).toEqual({ hora_inicio: null, hora_fin: null });
  });

  it('acepta la pareja completa en un permiso de UN dia', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-01', '09:00', '11:00');
    const { rows } = await db.query(
      `SELECT to_char(hora_inicio, 'HH24:MI') AS ini, to_char(hora_fin, 'HH24:MI') AS fin
         FROM portal.solicitudes_ausencia`,
    );
    expect(rows[0]).toEqual({ ini: '09:00', fin: '11:00' });
  });

  it('CANDADO: media pareja NO entra, con la hora de inicio suelta', async () => {
    // Las dos direcciones por separado y no una de muestra: son las que caen en
    // la trampa del CHECK que PASA cuando la expresion da NULL. Sin los dos
    // `IS NOT NULL` de la constraint, esta fila entraria y a Google se le
    // mandaria un ISO con null dentro.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', '09:00', null)).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: media pareja NO entra, con la hora de fin suelta', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', null, '11:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: la hora de fin no puede ser igual a la de inicio', async () => {
    // Un permiso de duracion cero no es un permiso, y en Google seria un evento
    // sin altura que no se ve.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', '09:00', '09:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: la hora de fin no puede ser anterior a la de inicio', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', '11:00', '09:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: con horas, el rango tiene que ser de UN solo dia', async () => {
    // «Del lunes al viernes de 9:00 a 11:00» no tiene lectura unica. Si esto
    // entrara, `calendario()` construiria el ISO con la fecha de inicio y el
    // evento mentiria sobre los otros cuatro dias.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-02', '09:00', '11:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`

Expected: FAIL — `column "hora_inicio" of relation "solicitudes_ausencia" does not exist`.

- [ ] **Step 3: Escribir la migración**

Crear `apps/hub-api/src/users/migrations/036_ausencias_hora_permiso.sql` (con
tildes, que es la convención de los `.sql`):

```sql
-- Migración 036: hora de inicio y de fin opcionales en un permiso.
--
-- Un permiso casi nunca es un día entero: es «me voy dos horas al médico el
-- martes por la mañana». Hasta ahora esa hora se escribía en Comentarios, y en
-- el Google Calendar del equipo el permiso se pintaba como un evento de día
-- completo, indistinguible de unas vacaciones.
--
-- Las dos columnas son NULL por defecto, así que ninguna solicitud existente
-- cambia: un permiso sin horas sigue siendo un permiso de día completo.

ALTER TABLE portal.solicitudes_ausencia
  ADD COLUMN IF NOT EXISTS hora_inicio TIME,
  ADD COLUMN IF NOT EXISTS hora_fin    TIME;

-- Los CHECK no admiten IF NOT EXISTS, así que se comprueba antes. Mismo patrón
-- que la 029.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'portal.solicitudes_ausencia'::regclass
       AND conname  = 'solicitudes_horas_coherentes'
  ) THEN
    ALTER TABLE portal.solicitudes_ausencia
      ADD CONSTRAINT solicitudes_horas_coherentes
      CHECK (
        (hora_inicio IS NULL AND hora_fin IS NULL)
        OR (hora_inicio IS NOT NULL AND hora_fin IS NOT NULL
            AND hora_fin > hora_inicio
            AND fecha_inicio = fecha_fin)
      );
  END IF;
END $$;
```

⚠️ **Los dos `IS NOT NULL` no son redundantes y no se pueden quitar «porque la
comparación ya lo cubre».** En Postgres un CHECK rechaza solo cuando la
expresión da `FALSE`; una expresión `NULL` **pasa**. Con media pareja,
`hora_fin > hora_inicio` es `NULL`, la disyunción entera es `NULL` y la fila
entra. Los dos tests de «media pareja» de arriba existen para eso.

⚠️ **El CHECK NO mira el tipo, a propósito.** Que solo Permiso admita hora es una
regla por tipo, y las reglas por tipo de esta app viven en la validación del
servicio. Ponerla también aquí obligaría a una migración el día que
Compensatorio quiera medias jornadas.

- [ ] **Step 4: Añadirla al array `MIGRATIONS`**

En `apps/hub-api/src/db.ts`, línea 24, al final del array:

```ts
'034_token_version.sql', '035_ausencias_baja_empleado.sql', '036_ausencias_hora_permiso.sql'];
```

- [ ] **Step 5: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`

Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/users/migrations/036_ausencias_hora_permiso.sql apps/hub-api/src/db.ts apps/hub-api/src/ausencias/repo.hora.db.test.ts
git commit -m "feat(ausencias): migracion 036, hora opcional en los permisos"
```

---

## Task 2: El repo lee y escribe las horas

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts` (`Solicitud`)
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`SELECT_SOLICITUD`, `FilaSolicitudDb`, `aSolicitud`, `DatosInsercion`, el INSERT de `crearSolicitud`)
- Test: `apps/hub-api/src/ausencias/repo.hora.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `repo.hora.db.test.ts`, y ampliar el import de la cabecera a
`import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';`
más `import { solicitudesDeEmpleado } from './repo.js';`:

```ts
describe('el repo lee y escribe las horas', () => {
  it('CANDADO: devuelve HH:MM, no HH:MM:SS ni un objeto', async () => {
    // Sin el to_char, el driver devuelve un TIME como la cadena '09:00:00', y
    // esa cadena se concatena tal cual dentro del ISO que se le manda a Google
    // -«...T09:00:00:00-05:00»- y en el value de un <input type="time">, que
    // solo entiende HH:MM. Las dos roturas son silenciosas.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-01', '09:00', '11:00');
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBe('09:00');
    expect(s.horaFin).toBe('11:00');
  });

  it('una solicitud sin horas las devuelve en null', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-03', null, null);
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBeNull();
    expect(s.horaFin).toBeNull();
  });

  it('crearSolicitud guarda las horas que le pasan', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'ana@hora.test',
      estado: 'pendiente',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      segundoAprobadorCorreo: null,
      tipo: 'permiso',
      horaInicio: '14:00',
      horaFin: '16:30',
    });
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBe('14:00');
    expect(s.horaFin).toBe('16:30');
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`

Expected: FAIL — `tsc`/Vitest se queja de que `horaInicio` no existe en `Solicitud`.

- [ ] **Step 3: Ampliar el tipo `Solicitud`**

En `apps/hub-api/src/ausencias/types.ts`, dentro de `export interface Solicitud`,
justo después de `diasHabiles`:

```ts
  /**
   * La franja del día, solo en un PERMISO de un solo día. `null` = día completo,
   * que es lo que era todo antes de esto.
   *
   * `HH:MM`, sin segundos y sin zona: es la hora local de Colombia, y el desfase
   * se lo pone `calendario()` al construir el ISO para Google. Las dos van
   * siempre juntas — lo garantiza el CHECK `solicitudes_horas_coherentes`.
   */
  horaInicio: string | null;
  horaFin: string | null;
```

- [ ] **Step 4: Leerlas en el repo**

En `apps/hub-api/src/ausencias/repo.ts`, dentro de `SELECT_SOLICITUD`, justo
después de la línea de `dias_habiles`:

```sql
         -- to_char y no ::text: el driver devuelve un TIME como '09:00:00', y
         -- esos segundos se cuelan tal cual en el ISO que se le manda a Google
         -- y en el value de un <input type="time">, que solo entiende HH:MM.
         -- Es el mismo gotcha que el ::text de las fechas, con otra cara.
         to_char(s.hora_inicio, 'HH24:MI') AS hora_inicio,
         to_char(s.hora_fin,    'HH24:MI') AS hora_fin,
```

En `interface FilaSolicitudDb`, junto a `dias_habiles`:

```ts
  hora_inicio: string | null;
  hora_fin: string | null;
```

En `function aSolicitud`, junto a `diasHabiles`:

```ts
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
```

- [ ] **Step 5: Escribirlas en el alta**

En `export interface DatosInsercion`, después de `diasHabiles`:

```ts
  /** Solo en un permiso de un día. Las dos o ninguna: lo exige el CHECK. */
  horaInicio: string | null;
  horaFin: string | null;
```

Y en el `INSERT` de `crearSolicitud`, ampliar columnas, placeholders y array:

```ts
      `INSERT INTO portal.solicitudes_ausencia
         (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
          dias_habiles, comentarios, estado, aprobador_correo, segundo_aprobador_correo,
          informado_correo, hora_inicio, hora_fin)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12::time, $13::time)
       RETURNING id`,
      [
        datos.tipo,
        datos.empleadoId,
        datos.solicitanteEmail,
        datos.fechaInicio,
        datos.fechaFin,
        datos.diasHabiles,
        datos.comentarios,
        datos.estado,
        datos.aprobadorCorreo,
        datos.segundoAprobadorCorreo,
        datos.informadoCorreo,
        datos.horaInicio,
        datos.horaFin,
      ],
```

- [ ] **Step 6: Que el harness pueda sembrarlas**

En `apps/hub-api/src/test-db/harness.ts`, en `interface DatosSiembra`:

```ts
  /** Opcionales porque a casi ningun test le importan. Solo en permisos de un dia. */
  horaInicio?: string | null;
  horaFin?: string | null;
```

Y en `sembrarSolicitud`, dentro del objeto que se le pasa a `crearSolicitud`,
junto a `diasHabiles: 5`:

```ts
      horaInicio: d.horaInicio ?? null,
      horaFin: d.horaFin ?? null,
```

- [ ] **Step 7: Arreglar a los demás llamantes**

`DatosInsercion` gana dos campos obligatorios, así que `tsc` señalará cada sitio
que construye uno. Hoy es solo `service.ts` (el alta). Pasarle
`horaInicio: null, horaFin: null` de momento; la tarea 3 los rellena de verdad.

Run: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

- [ ] **Step 8: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: PASS (11 tests).

Run: `cd apps/hub-api && npx vitest run`
Expected: todo en verde.

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/test-db/harness.ts apps/hub-api/src/ausencias/repo.hora.db.test.ts
git commit -m "feat(ausencias): el repo lee y escribe la hora del permiso"
```

---

## Task 3: La validación en el alta

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts` (`NuevaSolicitud`)
- Modify: `apps/hub-api/src/ausencias/service.ts` (`validarNuevaSolicitud` y el alta)
- Test: `apps/hub-api/src/ausencias/service.test.ts`

- [ ] **Step 1: Escribir el test que falla**

En `apps/hub-api/src/ausencias/service.test.ts`, dentro del bloque que ya prueba
`validarNuevaSolicitud` (con tildes, que aquí sí van):

Usa el helper `validar(body)` y la constante `HOY` que **ya existen** en ese
fichero (líneas 35 y 46: `HOY = '2026-07-01'`). No declarar otro `HOY` local: lo
sombrearía y las fechas del bloque dejarían de significar lo mismo que en el
resto del fichero.

```ts
describe('validarNuevaSolicitud — la hora del permiso', () => {
  const base = { tipo: 'permiso', fechaInicio: '2026-07-02', fechaFin: '2026-07-02' };

  it('sin horas, un permiso sigue siendo de día completo', () => {
    const r = validar(base);
    expect(r.horaInicio).toBeNull();
    expect(r.horaFin).toBeNull();
  });

  it('acepta la pareja completa', () => {
    const r = validar({ ...base, horaInicio: '09:00', horaFin: '11:00' });
    expect(r.horaInicio).toBe('09:00');
    expect(r.horaFin).toBe('11:00');
  });

  it('CANDADO: media pareja es un 400', () => {
    // La BD ya lo rechaza, pero ahí llega como un 500 opaco desde dentro de una
    // transacción. Aquí sale como un 400 con el campo señalado.
    expect(() => validar({ ...base, horaInicio: '09:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400 }),
    );
    expect(() => validar({ ...base, horaFin: '11:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400 }),
    );
  });

  it('CANDADO: un formato que no sea HH:MM es un 400', () => {
    // '9:5' compilaría y se concatenaría al ISO de Google sin que nadie avise.
    for (const mala of ['9:00', '09:0', '25:00', '09:60', 'mañana', '09:00:00']) {
      expect(() => validar({ ...base, horaInicio: mala, horaFin: '18:00' })).toThrow(
        expect.objectContaining({ code: 'hora_invalida' }),
      );
    }
  });

  it('CANDADO: la hora de fin tiene que ser posterior a la de inicio', () => {
    expect(() => validar({ ...base, horaInicio: '11:00', horaFin: '09:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400 }),
    );
    expect(() => validar({ ...base, horaInicio: '09:00', horaFin: '09:00' })).toThrow(
      expect.objectContaining({ code: 'hora_invalida', status: 400 }),
    );
  });

  it('CANDADO: solo un PERMISO admite hora', () => {
    expect(() =>
      validar({ ...base, tipo: 'vacaciones', horaInicio: '09:00', horaFin: '11:00' }),
    ).toThrow(expect.objectContaining({ code: 'hora_no_permitida', status: 400 }));
  });

  it('CANDADO: con horas, el rango tiene que ser de un solo día', () => {
    expect(() =>
      validar({ ...base, fechaFin: '2026-07-03', horaInicio: '09:00', horaFin: '11:00' }),
    ).toThrow(expect.objectContaining({ code: 'hora_no_permitida', status: 400 }));
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/service.test.ts`
Expected: FAIL — `horaInicio` no existe en el tipo que devuelve.

- [ ] **Step 3: Ampliar `NuevaSolicitud`**

En `apps/hub-api/src/ausencias/types.ts`, dentro de `export interface NuevaSolicitud`:

```ts
  /**
   * La franja del día. SOLO en un permiso de un solo día, y las dos o ninguna.
   *
   * No es opcional con `?` sino `string | null`, al revés que `comentarios`: el
   * validador siempre las resuelve a un valor, y dejarlas opcionales obligaría a
   * cada llamante a decidir otra vez qué significa que falten.
   */
  horaInicio: string | null;
  horaFin: string | null;
```

- [ ] **Step 4: Validarlas**

En `apps/hub-api/src/ausencias/service.ts`, encima de `validarNuevaSolicitud`:

```ts
/**
 * `HH:MM` de 24 horas, y nada más.
 *
 * Estricto por lo mismo que `esFechaValida` con las fechas: esta cadena se
 * concatena dentro del ISO que se le manda a Google y se le pone de `value` a un
 * `<input type="time">`. Un `9:5` no lanzaría en ninguno de los dos sitios —
 * produciría un instante equivocado en uno y un campo vacío en el otro.
 */
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Resuelve la pareja de horas de una solicitud nueva.
 *
 * Dos códigos y no uno: cada uno se traduce a una frase distinta en la caja roja
 * de la app, y un código que significa dos cosas obliga a escribir un mensaje
 * que no dice ninguna.
 *
 *  - `hora_invalida`     → la pareja está mal (media, mal escrita, o del revés).
 *  - `hora_no_permitida` → la pareja está bien, pero no cabe en esta solicitud.
 */
function validarHoras(
  b: Record<string, unknown>,
  tipo: TipoSolicitud,
  fechaInicio: string,
  fechaFin: string,
): { horaInicio: string | null; horaFin: string | null } {
  const ini = typeof b.horaInicio === 'string' ? b.horaInicio.trim() : '';
  const fin = typeof b.horaFin === 'string' ? b.horaFin.trim() : '';
  if (ini === '' && fin === '') return { horaInicio: null, horaFin: null };

  // Media pareja no significa nada: «desde las 9:00» no dice cuánto dura, y un
  // rango a medias en el calendario es peor que no tener rango.
  if (!HORA.test(ini)) throw new AusenciaError('hora_invalida', 400, 'horaInicio');
  if (!HORA.test(fin)) throw new AusenciaError('hora_invalida', 400, 'horaFin');
  // Lexicográfico y no aritmético: con HH:MM de ancho fijo las dos comparaciones
  // dan lo mismo, y esta no necesita parsear nada.
  if (fin <= ini) throw new AusenciaError('hora_invalida', 400, 'horaFin');

  if (tipo !== 'permiso') throw new AusenciaError('hora_no_permitida', 400, 'tipo');
  // «Del lunes al viernes de 9:00 a 11:00» no tiene lectura única. El CHECK de
  // la 036 lo repite en la BD; aquí sale como un 400 y no como un 500 desde
  // dentro de una transacción.
  if (fechaInicio !== fechaFin) throw new AusenciaError('hora_no_permitida', 400, 'fechaFin');

  return { horaInicio: ini, horaFin: fin };
}
```

Y en el `return` de `validarNuevaSolicitud`, sustituir la línea final por:

```ts
  const { horaInicio, horaFin } = validarHoras(b, tipo, fechaInicio, fechaFin);

  return { tipo, fechaInicio, fechaFin, comentarios: comentarios || undefined, adjunto, dias, horaInicio, horaFin };
```

- [ ] **Step 5: Pasarlas al alta**

En `service.ts`, donde se construye el `DatosInsercion` de `repo.crearSolicitud`,
sustituir los dos `null` provisionales de la tarea 2 por:

```ts
      horaInicio: datos.horaInicio,
      horaFin: datos.horaFin,
```

- [ ] **Step 6: Verlo pasar**

Run: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: sin salida del typecheck; todo en verde.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/service.test.ts
git commit -m "feat(ausencias): valida la hora del permiso en el alta"
```

---

## Task 4: Las horas no sobreviven a un rango de varios días

⚠️ **Esta es la tarea que evita un 500 opaco en producción.** El CHECK de la 036
exige `fecha_inicio = fecha_fin` mientras haya horas, y hay dos caminos que
cambian las fechas de una solicitud ya creada. Los dos escriben **dentro de una
transacción que también encola el evento del outbox**: si el `UPDATE` viola el
CHECK, el `ROLLBACK` se lleva por delante la escritura buena. Es el mismo patrón
del CHECK sobre `evento` del outbox, que ya mordió una vez.

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`aplicarALaSolicitud` y `actualizarSolicitud`)
- Test: `apps/hub-api/src/ausencias/repo.hora.db.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `repo.hora.db.test.ts`. Ampliar el import de `./repo.js` a
`import { solicitudesDeEmpleado, actualizarSolicitud } from './repo.js';`:

```ts
describe('las horas no sobreviven a un rango de varios dias', () => {
  /** Un permiso de un dia con horas, listo para que se lo estiren. */
  async function permisoConHoras(): Promise<{ empleadoId: string; solicitudId: string }> {
    const empleadoId = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(empleadoId, '2026-09-01', '2026-09-01', '09:00', '11:00');
    const [s] = await solicitudesDeEmpleado(db, empleadoId);
    return { empleadoId, solicitudId: s.id };
  }

  it('CANDADO: actualizarSolicitud estirando a dos dias NO revienta, y borra las horas', async () => {
    // Sin el CASE, el UPDATE viola el CHECK, la transaccion entera hace ROLLBACK
    // -con su evento de outbox dentro- y el admin recibe un 500 sin ninguna
    // pista. Es el motivo entero de esta tarea.
    const { empleadoId, solicitudId } = await permisoConHoras();

    const actual = await actualizarSolicitud(db, solicitudId, {
      empleadoId,
      tipo: 'permiso',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-03',
      dias: 3,
      estado: 'pendiente',
      comentarios: null,
      observaciones: null,
    });

    expect(actual).not.toBeNull();
    expect(actual?.fechaFin).toBe('2026-09-03');
    expect(actual?.horaInicio).toBeNull();
    expect(actual?.horaFin).toBeNull();
  });

  it('actualizarSolicitud sin mover las fechas CONSERVA las horas', async () => {
    // La otra mitad del CASE. Sin ella, corregir un comentario borraria una hora
    // que nadie pidio cambiar.
    const { empleadoId, solicitudId } = await permisoConHoras();

    const actual = await actualizarSolicitud(db, solicitudId, {
      empleadoId,
      tipo: 'permiso',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      dias: 1,
      estado: 'pendiente',
      comentarios: 'una nota nueva',
      observaciones: null,
    });

    expect(actual?.horaInicio).toBe('09:00');
    expect(actual?.horaFin).toBe('11:00');
  });

  it('CANDADO: cambiar el TIPO a uno que no admite hora tambien las borra', async () => {
    // El PATCH del registro es la unica via que puede cambiar el tipo, y el
    // CHECK de la BD no mira el tipo: sin esta mitad, unas vacaciones acabarian
    // con una franja horaria pegada que la app pintaria tal cual.
    const { empleadoId, solicitudId } = await permisoConHoras();

    const actual = await actualizarSolicitud(db, solicitudId, {
      empleadoId,
      tipo: 'vacaciones',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      dias: 1,
      estado: 'pendiente',
      comentarios: null,
      observaciones: null,
    });

    expect(actual?.tipo).toBe('vacaciones');
    expect(actual?.horaInicio).toBeNull();
    expect(actual?.horaFin).toBeNull();
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`

Expected: FAIL en el primer y el tercer test con
`new row for relation "solicitudes_ausencia" violates check constraint "solicitudes_horas_coherentes"`.

- [ ] **Step 3: El CASE en `actualizarSolicitud`**

En `apps/hub-api/src/ausencias/repo.ts`, dentro del `UPDATE` de
`actualizarSolicitud`, después de `observaciones = $9`:

```sql
              -- ⚠️ Las horas se BORRAN cuando dejan de caber. Sin esto, estirar
              -- a dos dias un permiso con horas viola el CHECK de la 036, y como
              -- este UPDATE vive dentro de la transaccion que ademas encola el
              -- evento del outbox, el ROLLBACK se lleva la escritura buena y el
              -- admin recibe un 500 sin ninguna pista. Mismo patron que el CHECK
              -- sobre `evento` de la 027.
              --
              -- Mira TAMBIEN el tipo, al reves que su gemelo de
              -- `aplicarALaSolicitud`: esta es la unica via que puede cambiarlo,
              -- y el CHECK de la BD no lo vigila -a proposito, para no atarse a
              -- que solo `permiso` admita hora-.
              hora_inicio       = CASE WHEN $3 = 'permiso' AND $4::date = $5::date
                                       THEN s.hora_inicio ELSE NULL END,
              hora_fin          = CASE WHEN $3 = 'permiso' AND $4::date = $5::date
                                       THEN s.hora_fin ELSE NULL END
```

(`$3` es `campos.tipo`, `$4` `campos.fechaInicio` y `$5` `campos.fechaFin`: los
placeholders ya existen, no se añade ninguno.)

- [ ] **Step 4: El CASE en `aplicarALaSolicitud`**

En la rama que no es `anulacion` del `UPDATE` de `aplicarALaSolicitud`:

```sql
          `UPDATE portal.solicitudes_ausencia
              -- Ni el estado, ni decidida_at, ni aprobador_user_id: esto no es
              -- una decision sobre la solicitud, es una enmienda de sus fechas.
              SET fecha_inicio = $5::date, fecha_fin = $6::date, dias_habiles = $7,
                  -- Gemelo del CASE de `actualizarSolicitud`, y por lo mismo: sin
                  -- el, aprobar un cambio que estira el permiso a dos dias viola
                  -- el CHECK de la 036 DENTRO de la transaccion y el ROLLBACK se
                  -- lleva la decision del jefe.
                  --
                  -- Aqui NO se mira el tipo: una modificacion solo cambia
                  -- fechas, nunca el tipo de la solicitud.
                  hora_inicio = CASE WHEN $5::date = $6::date THEN hora_inicio ELSE NULL END,
                  hora_fin    = CASE WHEN $5::date = $6::date THEN hora_fin    ELSE NULL END
            ${TESTIGO_SOLICITUD}
           RETURNING id`,
```

- [ ] **Step 5: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: PASS (14 tests).

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts`
Expected: toda la suite de BD en verde.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo.hora.db.test.ts
git commit -m "fix(ausencias): las horas se borran cuando el permiso deja de ser de un dia"
```

---

## Task 5: El evento de Google con hora

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts` (`EventoCalendario`)
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts` (`calendario`)
- Test: `apps/hub-api/src/ausencias/notificaciones.test.ts`

- [ ] **Step 1: Escribir el test que falla**

En `apps/hub-api/src/ausencias/notificaciones.test.ts`, en el bloque que ya
prueba el payload de calendario. Usar el helper de solicitud que ya exista en el
fichero; el ejemplo asume uno llamado `solicitud({...})`:

```ts
describe('calendario — el permiso con hora', () => {
  it('sin horas, el evento sigue siendo de día completo y con el +1', () => {
    const p = construirPayload(
      solicitud({ tipo: 'permiso', fechaInicio: '2026-09-01', fechaFin: '2026-09-01', estado: 'aprobada' }),
      'aprobada',
      null,
    );
    expect(p.calendario).toMatchObject({
      todoElDia: true,
      inicio: '2026-09-01',
      // Google trata el `end` de un all-day como EXCLUSIVO: sin el +1 no se
      // pinta el último día.
      fin: '2026-09-02',
    });
  });

  it('con horas, emite ISO con desfase de Colombia', () => {
    const p = construirPayload(
      solicitud({
        tipo: 'permiso',
        fechaInicio: '2026-09-01',
        fechaFin: '2026-09-01',
        estado: 'aprobada',
        horaInicio: '09:00',
        horaFin: '11:00',
      }),
      'aprobada',
      null,
    );
    expect(p.calendario).toMatchObject({
      todoElDia: false,
      inicio: '2026-09-01T09:00:00-05:00',
      fin: '2026-09-01T11:00:00-05:00',
    });
  });

  it('CANDADO: con horas NO se le suma el día al fin', () => {
    // El +1 solo es correcto para un evento de día completo. Aplicado a uno con
    // hora, un permiso de 9:00 a 11:00 del martes acabaría el miércoles a las
    // 11:00 — un evento de 26 horas en el calendario del equipo.
    const p = construirPayload(
      solicitud({
        tipo: 'permiso',
        fechaInicio: '2026-09-01',
        fechaFin: '2026-09-01',
        estado: 'aprobada',
        horaInicio: '09:00',
        horaFin: '11:00',
      }),
      'aprobada',
      null,
    );
    expect(p.calendario?.fin.startsWith('2026-09-01')).toBe(true);
  });

  it('CANDADO: el desfase va explícito, no se deja a la zona del calendario', () => {
    // Un `dateTime` sin offset lo interpreta Google en la zona por defecto del
    // calendario, que no la controla esta app: el día que alguien la cambie, se
    // moverían todos los permisos y nada se pondría rojo.
    const p = construirPayload(
      solicitud({
        tipo: 'permiso',
        fechaInicio: '2026-09-01',
        fechaFin: '2026-09-01',
        estado: 'aprobada',
        horaInicio: '09:00',
        horaFin: '11:00',
      }),
      'aprobada',
      null,
    );
    expect(p.calendario?.inicio).toMatch(/-05:00$/);
    expect(p.calendario?.fin).toMatch(/-05:00$/);
  });
});
```

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/notificaciones.test.ts`
Expected: FAIL — `todoElDia` no existe en `EventoCalendario`.

- [ ] **Step 3: Ampliar `EventoCalendario`**

En `apps/hub-api/src/ausencias/types.ts`, dentro de `export interface EventoCalendario`,
y **cambiando el comentario de `fin`**, que deja de ser cierto siempre:

```ts
  /**
   * Si el evento ocupa el día entero o una franja horaria.
   *
   * ⚠️ Viaja SIEMPRE, también en un `borrar`, por lo mismo que los tres de
   * arriba: al otro lado un campo ausente es `undefined`, y este contrato no
   * distingue eso de un valor. Y aquí importa más que en ninguno — la expresión
   * que lo lee en n8n exige el `false` explícito justo por eso.
   */
  todoElDia: boolean;
  resumen: string;
  /** `YYYY-MM-DD` si `todoElDia`; ISO con desfase (`...T09:00:00-05:00`) si no. */
  inicio: string;
  /**
   * Con `todoElDia`, fin EXCLUSIVO: Google no pinta el último día si no se le
   * suma uno. Con hora, el fin es el fin de verdad y NO se le suma nada.
   */
  fin: string;
```

- [ ] **Step 4: La rama de `calendario()`**

En `apps/hub-api/src/ausencias/notificaciones.ts`, sustituir `function calendario`:

```ts
/**
 * UTC−5 fijo: Colombia no tiene horario de verano, así que no hay casuística.
 *
 * Va explícito en el ISO y no se deja a Google: un `dateTime` sin desfase se
 * interpreta en la zona por defecto DEL CALENDARIO, que no la controla esta app.
 * El día que alguien la cambiara, todos los permisos con hora se moverían y no
 * habría nada que se pusiera rojo.
 */
const OFFSET_COLOMBIA = '-05:00';

function calendario(s: Solicitud): EventoCalendario {
  const base = {
    calendarId: CALENDARIO_STAFF,
    eventId: idDeEventoCalendario(s.id),
    accion: 'crear' as const,
    resumen: `${ETIQUETA_TIPO[s.tipo]} ${s.empleadoNombre}`,
  };
  // Las dos horas van siempre juntas —lo garantiza el CHECK de la 036—, pero se
  // comprueban las dos: es lo que estrecha el tipo para el ISO de abajo.
  if (s.horaInicio !== null && s.horaFin !== null) {
    return {
      ...base,
      todoElDia: false,
      // Sin el +1: ese solo es correcto para un evento de día completo, donde
      // Google trata el `end` como EXCLUSIVO. Con hora, el fin es el fin —
      // sumarle un día haría un evento de 26 horas.
      inicio: `${s.fechaInicio}T${s.horaInicio}:00${OFFSET_COLOMBIA}`,
      fin: `${s.fechaInicio}T${s.horaFin}:00${OFFSET_COLOMBIA}`,
    };
  }
  return {
    ...base,
    todoElDia: true,
    inicio: s.fechaInicio,
    // Google trata el `end` de un evento all-day como EXCLUSIVO: sin este +1 el
    // último día de la ausencia no se pinta.
    fin: sumarDias(s.fechaFin, 1),
  };
}
```

- [ ] **Step 5: Verlo pasar**

Run: `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: sin salida del typecheck; todo en verde. `tsc` señalará cualquier otro
sitio que construya un `EventoCalendario` y le falte `todoElDia`; rellenarlo con
`true`, que es lo que esos sitios significan.

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/notificaciones.ts apps/hub-api/src/ausencias/notificaciones.test.ts
git commit -m "feat(ausencias): el permiso con hora va al calendario como bloque horario"
```

---

## Task 6: El correo dice la hora

**Files:**
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts` (`bloqueFechas`)
- Test: `apps/hub-api/src/ausencias/notificaciones.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
describe('bloqueFechas — la hora del permiso', () => {
  it('un permiso con hora la dice en el correo', () => {
    // Quien firma tiene que poder decidir leyendo el correo: si la hora solo
    // estuviera en el portal, el aviso diría menos de lo que hay que aprobar.
    const p = construirPayload(
      solicitud({
        tipo: 'permiso',
        fechaInicio: '2026-09-01',
        fechaFin: '2026-09-01',
        horaInicio: '09:00',
        horaFin: '11:00',
      }),
      'aprobacion',
      null,
    );
    expect(p.correo.cuerpo).toContain('09:00 a 11:00');
  });

  it('CANDADO: sin hora, el correo no inventa ninguna franja', () => {
    const p = construirPayload(
      solicitud({ tipo: 'permiso', fechaInicio: '2026-09-01', fechaFin: '2026-09-03' }),
      'aprobacion',
      null,
    );
    expect(p.correo.cuerpo).not.toMatch(/\d\d:\d\d/);
  });
});
```

(`p.correo.cuerpo` y el helper `solicitud(over: Partial<Solicitud>)` son los que
ya usa el fichero — ver sus líneas 14 y 116.)

- [ ] **Step 2: Verlo fallar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/notificaciones.test.ts`
Expected: FAIL en el primero — el cuerpo no contiene la franja.

- [ ] **Step 3: Añadir la línea**

En `notificaciones.ts`, sustituir `bloqueFechas`:

```ts
function bloqueFechas(s: Solicitud): string {
  const p = PERIODO[s.tipo];
  const lineas = [
    `📅 Fecha primer día ${p}: ${s.fechaInicio}`,
    `📅 Fecha último día ${p}: ${s.fechaFin}`,
  ];
  // Solo cuando existe: una línea «🕘 Horario: —» en todos los demás correos
  // afirmaría que ahí falta un dato, y en unas vacaciones no falta nada.
  if (s.horaInicio !== null && s.horaFin !== null) {
    lineas.push(`🕘 Horario: de ${s.horaInicio} a ${s.horaFin}`);
  }
  lineas.push('', `📊 Total solicitado: ${dias(s.diasHabiles)}`);
  return lineas.join('\n');
}
```

- [ ] **Step 4: Verlo pasar**

Run: `cd apps/hub-api && npx vitest run src/ausencias/notificaciones.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/notificaciones.ts apps/hub-api/src/ausencias/notificaciones.test.ts
git commit -m "feat(ausencias): el correo de un permiso con hora dice la franja"
```

---

## Task 7: El cliente — espejo, tabla y formulario

⚠️ **`apps/ausencias` no tiene tests: su único portón es `tsc --noEmit`.** Y
`api.ts` es un espejo MANUAL del backend, sin generación ni test de contrato: los
nombres hay que copiarlos a mano y exactos. Un nombre mal copiado da `undefined`
en pantalla, no un rojo.

**Files:**
- Modify: `apps/ausencias/src/api.ts`
- Modify: `apps/ausencias/src/dominio.ts`
- Modify: `apps/ausencias/src/FormularioSolicitud.tsx`

- [ ] **Step 1: El espejo**

En `apps/ausencias/src/api.ts`, en `export interface Solicitud`, junto a
`diasHabiles`:

```ts
  /**
   * La franja del día, solo en un permiso de un solo día. `null` = día completo.
   * Espejo manual de `Solicitud` en hub-api: mismo nombre, obligatorio.
   */
  horaInicio: string | null;
  horaFin: string | null;
```

Y en `export interface NuevaSolicitud`, **opcionales** aquí y no `| null`, porque
el formulario simplemente no las manda cuando no las hay:

```ts
  /** Solo en un permiso de un solo día, y las dos o ninguna. `HH:MM`. */
  horaInicio?: string;
  horaFin?: string;
```

Añadir además los dos mensajes al mapa de errores de `errorDeAusencia`, junto a
los del otorgamiento y los de la incapacidad, **en un mapa propio** (mismo
criterio que `DE_LA_INCAPACIDAD`: juntarlos haría que el nombre del mapa dijera
algo falso sobre la mitad de sus claves):

```ts
  // Los de la hora del permiso. Ninguno debería verlos un usuario normal —el
  // formulario no deja llegar ahí—, pero `mensajeDeError` devuelve el código
  // crudo en los 400, así que sin esto la caja roja diría `hora_invalida`.
  const DE_LA_HORA: Record<string, string> = {
    hora_invalida:
      'Revisa el horario: hacen falta las dos horas, en formato HH:MM, y la de fin tiene que ser posterior a la de inicio.',
    hora_no_permitida:
      'El horario solo se puede poner en un permiso de un único día. Si son varios días, quita las horas.',
  };
  if (cuerpo?.error && DE_LA_HORA[cuerpo.error]) return new Error(DE_LA_HORA[cuerpo.error]);
```

- [ ] **Step 2: Las celdas «Desde» y «Hasta»**

En `apps/ausencias/src/dominio.ts`, línea 797, ampliar el `Pick` (todos los
llamantes pasan una `Solicitud` entera, así que no hace falta que sean
opcionales):

```ts
type ParaLaTabla = Pick<Solicitud, 'tipo' | 'fechaInicio' | 'fechaFin' | 'diasHabiles' | 'horaInicio' | 'horaFin'>;
```

Y sustituir `fechasDeLaFila`:

```ts
/**
 * Las celdas «Desde» y «Hasta» de una fila.
 *
 * Un otorgamiento tiene una sola fecha —el día trabajado— repetida en las dos
 * columnas, y «6 jun – 6 jun» se lee como una errata. Se enseña una vez y la
 * segunda queda vacía.
 *
 * Un permiso con hora es de un solo día por definición (lo garantiza el CHECK de
 * la 036), así que se reparte igual: el día con su hora de inicio en «Desde», y
 * solo la de fin en «Hasta». Repetir ahí la fecha se leería como la misma
 * errata.
 */
export function fechasDeLaFila(s: ParaLaTabla): { desde: string; hasta: string } {
  if (esOtorgamiento(s.tipo)) return { desde: formatFecha(s.fechaInicio), hasta: '' };
  if (s.horaInicio && s.horaFin) {
    return { desde: `${formatFecha(s.fechaInicio)} · ${s.horaInicio}`, hasta: s.horaFin };
  }
  return { desde: formatFecha(s.fechaInicio), hasta: formatFecha(s.fechaFin) };
}
```

Y ampliar `rangoFechas` con dos parámetros **opcionales**, para que el encabezado
de `PedirModificacion` no mienta sobre lo que se está cambiando. Al ser
opcionales, ningún llamante actual cambia:

```ts
/** «6 jul 2026 – 10 jul 2026», o «6 jul 2026 · 9:00–11:00» si lleva franja. */
export function rangoFechas(
  inicio: string,
  fin: string,
  horaInicio?: string | null,
  horaFin?: string | null,
): string {
  const base = inicio === fin ? formatFecha(inicio) : `${formatFecha(inicio)} – ${formatFecha(fin)}`;
  return horaInicio && horaFin ? `${base} · ${horaInicio}–${horaFin}` : base;
}
```

En `PedirModificacion.tsx`, línea ~165, pasarle las horas de la solicitud:

```tsx
              {`${ETIQUETA_TIPO[solicitud.tipo]} · ${rangoFechas(
                solicitud.fechaInicio,
                solicitud.fechaFin,
                solicitud.horaInicio,
                solicitud.horaFin,
              )}`}
```

- [ ] **Step 3: Los dos campos del formulario**

En `apps/ausencias/src/FormularioSolicitud.tsx`, dos estados nuevos junto a los
de las fechas:

Junto a los estados que ya hay (línea ~59). **Sin `useEffect`**: este fichero
importa `useMemo, useRef, useState` y no lo trae, y aquí no hace ninguna falta.

```tsx
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFin, setHoraFin] = useState('');

  // La franja solo cabe en un permiso de un solo dia. DERIVADO y no un estado
  // mas: un estado tendria que sincronizarse a mano cada vez que cambian el
  // tipo o las fechas, y el dia que una de esas rutas se olvidara, el formulario
  // mandaria una hora que el servidor rechaza con un 400.
  const admiteHora = tipo === 'permiso' && fechaInicio !== '' && fechaInicio === fechaFin;

  // Y por lo mismo NO se borran con un efecto al dejar de caber: basta con que
  // solo viajen cuando caben. Asi no hay estado que pueda quedarse caducado, y
  // si el usuario vuelve a poner un solo dia recupera lo que habia tecleado.
  const conHoras = admiteHora && horaInicio !== '' && horaFin !== '';
```

El bloque de campos, justo debajo del `grid` de las dos fechas y **fuera** de la
rama del otorgamiento:

```tsx
      {admiteHora && (
        <div className="mb-4">
          <p className="mb-1 block text-sm font-medium text-gray-700">
            Horario <span className="font-normal text-gray-500">(opcional)</span>
          </p>
          <p className="mb-2 text-xs text-gray-500">
            Si el permiso es de unas horas y no del día entero, dilo aquí: así se ve en el calendario del equipo.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <input
              type="time"
              value={horaInicio}
              onChange={(e) => setHoraInicio(e.target.value)}
              aria-label="Hora de inicio del permiso"
              className={CAMPO}
            />
            <input
              type="time"
              value={horaFin}
              onChange={(e) => setHoraFin(e.target.value)}
              aria-label="Hora de fin del permiso"
              className={CAMPO}
            />
          </div>
          {horaInicio !== '' && horaFin !== '' && horaFin <= horaInicio && (
            <p className="mt-1 text-sm text-red-600">La hora de fin tiene que ser posterior a la de inicio.</p>
          )}
          {(horaInicio === '') !== (horaFin === '') && (
            <p className="mt-1 text-sm text-amber-700">Pon las dos horas, o ninguna.</p>
          )}
        </div>
      )}
```

Y en el envío, donde se construye la `NuevaSolicitud`, añadir las dos claves solo
cuando la pareja completa **cabe** —de ahí que `conHoras` mire también
`admiteHora`—:

```tsx
        ...(conHoras ? { horaInicio, horaFin } : {}),
```

Deshabilitar «Enviar solicitud» cuando la pareja esté a medias o del revés,
sumando a la condición de `disabled` que ya exista. Las dos condiciones van
guardadas por `admiteHora`: si la franja ni siquiera se está pintando, unas horas
tecleadas antes no pueden bloquear el botón.

```tsx
    || (admiteHora && (horaInicio !== '') !== (horaFin !== ''))
    || (conHoras && horaFin <= horaInicio)
```

- [ ] **Step 4: Comprobar**

Run: `cd apps/ausencias && npx tsc --noEmit`
Expected: sin salida. **Es el único portón de esta app.**

Run: `cd apps/ausencias && npx vite build`
Expected: `✓ built in ...`

- [ ] **Step 5: Commit**

```bash
git add apps/ausencias/src/api.ts apps/ausencias/src/dominio.ts apps/ausencias/src/FormularioSolicitud.tsx apps/ausencias/src/PedirModificacion.tsx
git commit -m "feat(ausencias): la hora del permiso en el formulario y en las tablas"
```

---

## Task 8: El cambio en n8n

⚠️ **Es el único paso que toca producción.** Se hace con el MCP de n8n, sobre el
workflow `dh0xjWCHsGj9raYH` («Ausencias — Portal»). **Dos nodos, un campo cada
uno.** No se toca ninguna conexión, ni el nodo `Crear evento en el calendario`
—la rama por defecto del switch, que ningún evento de esta funcionalidad
alcanza—.

- [ ] **Step 1: Leer los dos nodos antes de tocarlos**

```
n8n_get_workflow con { id: 'dh0xjWCHsGj9raYH', mode: 'filtered',
  nodeNames: ['Crear evento con id', 'Actualizar evento del calendario'] }
```

Confirmar que `additionalFields.allday` y `updateFields.allday` valen hoy
literalmente `"yes"`.

- [ ] **Step 2: Cambiar los dos campos**

Con `n8n_update_partial_workflow`, poner en los dos esta expresión:

```
={{ $('Repartir eventos').item.json.payload.calendario.todoElDia === false ? 'no' : 'yes' }}
```

| Nodo | Campo |
|---|---|
| `Crear evento con id` | `additionalFields.allday` |
| `Actualizar evento del calendario` | `updateFields.allday` |

⚠️ **El `=== false` no es defensivo por gusto, y NO se puede simplificar a
`todoElDia ? 'no' : 'yes'` ni a `!todoElDia ? ...`.** Para cualquier evento que
no traiga la clave —los que estén esperando en el outbox durante la ventana de
despliegue— `undefined` no es `false`, y con la versión corta todos ellos
pasarían a tratarse como eventos con hora a partir de una fecha suelta. Es el
mismo bug que tuvo el campo `drive`, documentado en `notificaciones.ts`. Con el
`=== false`, todo lo que no diga explícitamente «con hora» es de día completo, y
por eso **el orden de despliegue de hub-api y n8n deja de importar**.

- [ ] **Step 3: Validar el workflow**

```
n8n_validate_workflow con { id: 'dh0xjWCHsGj9raYH' }
```

Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

No hay nada que commitear —el workflow vive en n8n—, pero **sí hay que dejar
constancia**. Añadir la nota al spec y commitearla:

```bash
git add docs/superpowers/specs/2026-08-25-hora-en-permisos-design.md
git commit -m "docs(ausencias): los dos nodos de n8n ya leen todoElDia"
```

---

## Task 9: Falsar los candados

El método que más ha rendido en este repo: romper el código de verdad y ver morir
el test que dice vigilarlo. Un candado que no se falsa no es un candado.

- [ ] **Step 1: Asegurarse de que no queda nada sin commitear**

Run: `git status --short`
Expected: solo los untracked de siempre (`apps/WO-sales/prompts/`, `img/`).
**Si hay algo modificado, commitearlo antes**: el `git checkout --` de revertir
cada mutación se lleva por delante lo no commiteado.

- [ ] **Step 2: Quitar los dos `IS NOT NULL` del CHECK**

En la 036, dejar el CHECK así:

```sql
        (hora_inicio IS NULL AND hora_fin IS NULL)
        OR (hora_fin > hora_inicio AND fecha_inicio = fecha_fin)
```

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: FAIL en los DOS tests de «media pareja». Si pasaran, el CHECK no está
vigilando la regla de la pareja y hay que arreglarlo.

⚠️ Las migraciones se re-ejecutan en cada arranque pero **el `IF NOT EXISTS` del
CHECK impide que se recree**: entre esta mutación y la siguiente hay que dejar
que testcontainers levante un contenedor limpio, cosa que hace en cada corrida de
`vitest.db.config.ts`. Si aun así el CHECK viejo sobreviviera, comprobar que el
contenedor no se está reutilizando.

Revertir: `git checkout -- apps/hub-api/src/users/migrations/036_ausencias_hora_permiso.sql`

- [ ] **Step 3: Quitar el `fecha_inicio = fecha_fin` del CHECK**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: FAIL en «con horas, el rango tiene que ser de UN solo dia».

Revertir: `git checkout -- apps/hub-api/src/users/migrations/036_ausencias_hora_permiso.sql`

- [ ] **Step 4: Sacar la 036 del array `MIGRATIONS`**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: FAIL en el CANDADO de las dos columnas (y en casi todo lo demás).

Revertir: `git checkout -- apps/hub-api/src/db.ts`

- [ ] **Step 5: Quitar el CASE de `actualizarSolicitud`**

⚠️ Al implementar la tarea 4 salieron **tres cosas que este plan tenía mal**, y
quedan anotadas aquí para que la falsación no tropiece con ellas:

1. La función se llama **`actualizarSolicitud`**, no `corregirSolicitud`, y tiene
   cinco argumentos: `(db, id, campos, adminEmail, construirPayload)`.
2. Los comentarios de ese `CASE` van **dentro de un template literal**, así que
   no pueden llevar backticks: `esbuild` revienta el fichero entero antes de
   correr un solo test. Van con comillas dobles, como los comentarios SQL
   vecinos.
3. La comparación tiene que ser **`$3::varchar = 'permiso'`**, no `$3` a secas ni
   `$3::text`: el `tipo = $3` del mismo SET le fija a `$3` el tipo de la columna
   (`VARCHAR(20)`), y sin el cast Postgres deduce `text` y contesta
   `inconsistent types deduced for parameter $3`.

Dejar el `UPDATE` sin las dos líneas de `hora_inicio`/`hora_fin`.

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: FAIL en «actualizarSolicitud estirando a dos dias NO revienta» **con el
error del CHECK**, que es exactamente el 500 que la tarea 4 existe para evitar.

Revertir: `git checkout -- apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 6: Quitar solo la mitad del tipo en ese CASE**

Cambiar `CASE WHEN $3 = 'permiso' AND $4::date = $5::date` por
`CASE WHEN $4::date = $5::date` en las dos líneas.

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: FAIL en «cambiar el TIPO a uno que no admite hora tambien las borra».

Revertir: `git checkout -- apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 7: Quitar el CASE de `aplicarALaSolicitud`**

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts`
Expected: FAIL en el describe «las horas tampoco sobreviven a una MODIFICACION
aprobada», con el error del CHECK.

⚠️ **Ese candado NO estaba en la versión original de este plan.** Al implementar
la tarea 4 se comprobó que quitar este `CASE` no ponía roja **ni una sola** de las
212 pruebas de BD: los tres tests que el plan escribía iban todos por
`actualizarSolicitud`, y el gemelo se quedaba sin vigilancia. Se cerró con un test
que recorre el camino real —`crearModificacion` + `decidirModificacion`, que es
quien llama a `aplicarALaSolicitud`— y se falsó en las dos direcciones. Si esta
mutación vuelve a no matar nada, el candado se ha perdido por el camino.

Revertir: `git checkout -- apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 8: Sumarle el día al fin del evento con hora**

En `calendario()`, en la rama con horas, cambiar
`fin: \`${s.fechaInicio}T...\`` por `fin: \`${sumarDias(s.fechaInicio, 1)}T...\``.

Run: `cd apps/hub-api && npx vitest run src/ausencias/notificaciones.test.ts`
Expected: FAIL en «CANDADO: con horas NO se le suma el día al fin».

Revertir: `git checkout -- apps/hub-api/src/ausencias/notificaciones.ts`

- [ ] **Step 9: Quitar el desfase del ISO**

Cambiar `${OFFSET_COLOMBIA}` por `''` en las dos líneas.

Run: `cd apps/hub-api && npx vitest run src/ausencias/notificaciones.test.ts`
Expected: FAIL en «CANDADO: el desfase va explícito».

Revertir: `git checkout -- apps/hub-api/src/ausencias/notificaciones.ts`

- [ ] **Step 10: Quitar el `to_char` del SELECT**

Cambiar `to_char(s.hora_inicio, 'HH24:MI') AS hora_inicio` por `s.hora_inicio`
(y su gemela).

Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.hora.db.test.ts`
Expected: FAIL en «CANDADO: devuelve HH:MM, no HH:MM:SS ni un objeto».

Revertir: `git checkout -- apps/hub-api/src/ausencias/repo.ts`

- [ ] **Step 11: Anotar lo que sobreviva**

Cualquier mutación que **no** ponga rojo nada es un hueco real, no un despiste:
anotarlo en un comentario junto al código que no vigila nadie, con el patrón que
ya usa el repo (`⚠️ REGLA DE SQL REIMPLEMENTADA AQUI, Y HOY NO LA VIGILA NINGUN
TEST`). Y **no escribir en un comentario que «sin esto el test pasaría en verde»
sin haberlo mutado**: esa frase es tan falsable como el código.

- [ ] **Step 12: Confirmar que todo vuelve a estar verde**

Run: `git status --short` → sin modificados.
Run: `cd apps/hub-api && npx vitest run` → todo en verde.
Run: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts` → todo en verde.

---

## Task 10: Cerrar

- [ ] **Step 1: Las tres suites y los dos typecheck**

```bash
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vitest run --config vitest.db.config.ts
cd ../ausencias && npx tsc --noEmit && npx vite build
cd ../portal && npx vitest run
```

Expected: hub-api y la suite de BD enteras en verde; ausencias compila y
construye; portal **65 ✓ / 11 ✗** — esos 11 son los conocidos de Node 26 local
frente a `.nvmrc=20` (`Sidebar` 7 + `useDashboardLayout` 4, todos
`localStorage.clear()`). **Cualquier otro fallo del portal es real.**

- [ ] **Step 2: Mezclar y desplegar**

```bash
git checkout main
git merge --no-ff feat/hora-en-permisos -m "merge: hora opcional en los permisos"
git push origin main
```

⚠️ **El push ES el despliegue.** EasyPanel reconstruye hub-api primero y el
portal después, ~11 min cada uno. Aquí el orden **no** importa: el `=== false` de
n8n hace que todo lo que no traiga `todoElDia` siga siendo de día completo, así
que durante la ventana los permisos simplemente no llevan hora.

- [ ] **Step 3: Comprobar en producción**

Con la cuenta de pruebas, y mirando el Google Calendar del equipo:

1. Un permiso **de un día con hora** → el evento ocupa la franja, no el día.
2. Un permiso **de un día sin hora** → evento de día completo, como siempre.
3. Unas **vacaciones de varios días** → evento de día completo y con el último
   día pintado (o sea, el `+1` sigue vivo donde tocaba).
4. Pedir un permiso de dos días con el formulario: las horas deben desaparecer
   solas al mover la fecha de fin.
