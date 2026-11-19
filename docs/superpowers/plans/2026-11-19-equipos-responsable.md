# Equipos en taller — Responsable asignado desde la tabla: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que quien tenga la llave «edita ajustes» (o sea admin) elija desde la columna «Responsable» de la tabla a quién está asignada cada visita, entre los usuarios activos con la app `equipos-taller`, y que la tabla, el tablero, la TV y «Mis equipos» muestren el mismo responsable efectivo: la asignación del portal y, si no la hay, el Encargado de Desk 2.0.

**Architecture:** una tabla nueva `portal.equipos_responsable` (migración 078), con una fila por visita (`claveFila`) y el `user_id` asignado. `repo.ts` la lee solo con asignaciones vigentes (usuario activo y con la app) y la escribe. `router.ts` añade `GET /tecnicos` y `PUT|DELETE /responsables/:clave` detrás de `exigirEditar`, y `GET /` devuelve `responsables`. En el núcleo puro, `aplicarResponsables` va siempre detrás de `aplicarAjustes`, y `responsableDe` aplica la regla única D7. `tarjetaDe` la usa, así que el tablero, la TV y «Mis equipos» la heredan. `armarRespuestaTablero` (TV con llave) solo pasa el nombre. En la pantalla, la celda es un `<select>` para quien edita, guarda al elegir y vuelve atrás si falla. «Mis equipos» reconoce las visitas asignadas en el portal por la cuenta (`userId`), que manda `RutaMisEquipos`.

**Tech Stack:** hub-api: Express 4, TypeScript ESM con imports `.js`, SQL crudo con `pg`, Vitest y supertest con dobles, y `*.db.test.ts` con Testcontainers. Sub-app `apps/equipos-taller`: React 19, Tailwind 3.4, Vitest y Testing Library, con jsdom opt-in por docblock `// @vitest-environment jsdom`. Portal: React Router y `useProfile`.

**Spec (contrato, no se reabre):** `docs/superpowers/specs/2026-11-19-equipos-responsable-design.md` (decisiones D1–D8).
**Rama:** `feat/equipos-responsable` (ya existe; el diseño está en `fe36ca0`).

---

## Reglas para quien implemente

- **TDD estricto:** cada test se ve en ROJO, y por la razón esperada, antes de escribir el código.
- **Comandos:** para Git Bash (la herramienta Bash), desde la raíz del repo. Cada bloque empieza en la raíz.
  - hub-api se prueba **solo desde `apps/hub-api`**: `cd apps/hub-api && npx vitest run <rutas>`. Desde la raíz, Vitest mete los `*.db.test.ts` y salen ~281 fallos falsos.
  - Las pruebas de base de datos: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts <rutas>`. Necesitan Docker Desktop encendido; si no responde, en PowerShell: `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"` y esperar a que arranque.
  - Tipos de hub-api (su `tsc -b` incluye las pruebas): `cd apps/hub-api && npx tsc --noEmit -p tsconfig.json`.
  - Sub-app: `npm test --workspace=apps/equipos-taller -- <rutas>` y `npx tsc --noEmit -p apps/equipos-taller/tsconfig.json`.
- **Editar solo con Edit/Write.** Nunca `Set-Content`, `Out-File`, `sed -i` ni `perl -pi`: destrozan las tildes.
- **Commits:** conventional commits en español, **sin** `Co-Authored-By` ni ninguna atribución. Siempre `git add <ruta> <ruta>…` con rutas explícitas; nunca `git add -A` ni `git add .`.
- **No tocar ni preparar:** `.gitignore`, `.atl/`, `openspec/`, `img/`, `apps/WO-sales/prompts/`, `apps/equipos-desk2/` ni `apps/hub-api/src/equipos/nucleo/fixtures-reales/`. Nunca `git stash` sin rutas.
- **Repo PÚBLICO.** Solo datos inventados: el serial `18A90417` (clave `1BA9041T|2026-11-01`), `CLIENTE A`, `Técnico Uno`, `Técnico Dos`, `Admin Uno`, correos `@equipos.test` o `@ambientalia.com.co` ficticios. Antes de **cada** commit, en un comando aparte:

  ```bash
  cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
  ```

  Esperado: `Sin valores reales en: src/equipos, scripts, ../equipos-taller/src, ../../docs` y código de salida 0. Si dice `FUGA`, no se commitea.
- **Núcleo puro:** nada nuevo fuera de los siete ficheros que exige `nucleo/pureza.test.ts`. Por eso las funciones nuevas van en `pantalla.ts`, no en un fichero nuevo. Solo se añade un fichero de pruebas.
- **Kiosco:** `router-kiosco.test.ts` (T1–T8) sigue en verde en cada tarea. La respuesta de la TV con llave lleva nombres, **nunca** `userId`.
- **Tablero:** sin colores nuevos. Si hiciera falta alguno, solo con tokens `--tt-*`.

## Adaptaciones al código real (lo que la spec no fija o lo que el código contradice)

| # | Spec | Código real | Qué hace este plan |
|---|---|---|---|
| A1 | `asignado_por` guarda «el nombre de quien asignó, como `usuario` en los ajustes». | El JWT no lleva el nombre (`{ sub, user_id, role, apps }`) y `usuario` en los ajustes es el **correo** (`q.email`). | `guardarResponsable` resuelve el `full_name` actual de quien asigna con una subconsulta y, si no lo encuentra, guarda su correo. El `title` dice «Asignado por <nombre>». |
| A2 | `responsables: Record<clave, ResponsableAsignado>` en `GET /`. | Las pruebas de la sub-app construyen `RespuestaEquipos` en muchos sitios, y `tablero?` ya es opcional por compatibilidad. | `responsables?` es **opcional**; la pantalla lo trata como `{}`. |
| A3 | Si falla, «avisa con `notify`». | `EquiposServicio` no recibe `notify`: avisa con su línea `role="status"` (`setAviso`). | Se usa `setAviso`, como los ajustes. |
| A4 | `aplicarResponsables(rows, mapa)` con `ResponsableAsignado`. | El núcleo no puede importar `contrato.ts` (pureza). | El núcleo define `ResponsableFila` (`{ userId?, nombre, por?, en? }`) en `tipos.ts`. `ResponsableAsignado` encaja en él sin conversión. |
| A5 | `responsableDe` en el núcleo. | `SIN_TECNICO_DESK` vive en `taller-board.ts`, que importa `pantalla.ts`. | `SIN_TECNICO_DESK`, `encargadoDesk` y `responsableDe` pasan a `pantalla.ts`. `taller-board.ts` importa `responsableDe` (sin ciclo). |
| A6 | — | `migracion.db.test.ts` enumera todas las tablas `equipos_%`, y `users/password-reset/migracion.test.ts` exige que la 077 sea la **última**. | La Tarea 1 añade `equipos_responsable` a esa lista y relaja la 077 a «detrás de la 076». |
| A7 | — | `servicio.test.ts` tiene un doble **tipado** de `RepoEquipos`. `servicio-tablero.test.ts` pasa un repo literal al `Pick`. `router.test.ts` y `router-kiosco.test.ts` usan `as unknown`, pero fallan en ejecución si falta un método. `App.test.tsx` y `EquiposServicio.test.tsx` tienen dobles tipados de `ApiEquipos`. | Cada tarea actualiza los dobles a los que afecta (se indica en cada una). |
| A8 | D7: «Pendiente Asignar» se ve «Sin asignar». | Hoy la tabla pinta `z.enc` en crudo, «Pendiente Asignar» incluido. | La tabla también aplica D7: «Pendiente Asignar» se ve «Sin asignar»; un Encargado vacío sigue en blanco. |
| A9 | «Mis equipos»: sin asignación del portal, «se mantiene lo de hoy». | `tecnicosDelTablero` lista todos los nombres de las tarjetas. | Las tarjetas con `tecnico.userId` salen de la lista de «¿Quién eres?»: se reconocen por la cuenta, no por el nombre. |
| A10 | La tarjeta muestra el responsable efectivo. | Hoy, una visita **sin ticket** tiene siempre el pie «neutro» («Sin técnico»). | Si el portal asigna una visita sin ticket, su pie pasa a «técnico» con el nombre. |

---

## Mapa de archivos

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `apps/hub-api/src/users/migrations/078_equipos_responsable.sql` | Crear | Tabla `portal.equipos_responsable` (una fila por visita) y su bloque DATA-332. |
| `apps/hub-api/src/db.ts` | Modificar (~L102) | Registrar la 078 en `MIGRATIONS`. |
| `apps/hub-api/src/equipos/migracion.test.ts` | Modificar | La 078 sin base: registrada y última, idempotente, CHECK, FKs y GRANT. |
| `apps/hub-api/src/equipos/migracion.db.test.ts` | Modificar | La 078 contra Postgres; la lista de tablas `equipos_%` incluye la nueva. |
| `apps/hub-api/src/users/password-reset/migracion.test.ts` | Modificar (L15-17) | La 077 deja de ser la última. |
| `apps/hub-api/src/equipos/contrato.ts` | Modificar | `ResponsableAsignado`, `TecnicoAsignable`, `claveVisitaValida`, `responsables?` en la respuesta y nombres solos en `armarRespuestaTablero`. |
| `apps/hub-api/src/equipos/contrato.test.ts` | Modificar | `claveVisitaValida`. |
| `apps/hub-api/src/equipos/repo.ts` | Modificar | `listarResponsables`, `guardarResponsable`, `borrarResponsable`, `listarTecnicos` y `esTecnicoValido`. |
| `apps/hub-api/src/equipos/repo.db.test.ts` | Modificar | Esos cinco métodos contra Postgres. |
| `apps/hub-api/src/equipos/servicio.test.ts` | Modificar (doble ~L39-71) | El doble tipado implementa los cinco métodos. |
| `apps/hub-api/src/equipos/nucleo/tipos.ts` | Modificar (~L167-187) | `ResponsableFila` y `Fila.resp`. |
| `apps/hub-api/src/equipos/nucleo/pantalla.ts` | Modificar | `aplicarResponsables`, `encargadoDesk`, `responsableDe` y `ResponsableEfectivo`. |
| `apps/hub-api/src/equipos/nucleo/taller-board.ts` | Modificar (L4, L27, L173-193) | `Tarjeta.tecnico.userId`; `tarjetaDe` usa `responsableDe`. |
| `apps/hub-api/src/equipos/nucleo/responsables.test.ts` | Crear | D7, la clave de visita y `tarjetaDe` con el responsable efectivo. |
| `apps/hub-api/src/equipos/servicio-tablero.ts` | Modificar (L39, L98-104) | El kiosco lee las asignaciones. |
| `apps/hub-api/src/equipos/servicio-tablero.test.ts` | Modificar | Doble con `listarResponsables`; la TV recibe solo el nombre. |
| `apps/hub-api/src/equipos/router-kiosco.test.ts` | Modificar | Doble con `listarResponsables`; T4 con las rutas nuevas; T5 sin `userId`. |
| `apps/hub-api/src/equipos/router.ts` | Modificar | `GET /tecnicos`, `PUT|DELETE /responsables/:clave` y `responsables` en `GET /`. |
| `apps/hub-api/src/equipos/router.test.ts` | Modificar | 403/400/422, asignar, reasignar y quitar, y `GET /`. |
| `apps/equipos-taller/src/api.ts` | Modificar | `tecnicos`, `asignarResponsable` y `quitarResponsable`. |
| `apps/equipos-taller/src/api.test.ts` | Modificar | Rutas, cuerpos y 422. |
| `apps/equipos-taller/src/App.test.tsx` | Modificar (L17-23) | El doble tipado implementa los tres métodos nuevos. |
| `apps/equipos-taller/src/EquiposServicio.tsx` | Modificar | Celda «Responsable»: selector con permiso; nombre y firma sin él. |
| `apps/equipos-taller/src/EquiposServicio.test.tsx` | Modificar | Doble con los métodos nuevos; selector, D8, fallo de `/tecnicos` y firma. |
| `apps/equipos-taller/src/tablero/Tablero.tsx` | Modificar (L5-8, L171-174) | `useTableroDatos` encadena `aplicarResponsables`. |
| `apps/equipos-taller/src/tablero/Tablero.test.tsx` | Modificar | El tablero muestra al asignado. |
| `apps/equipos-taller/src/tecnico.ts` | Modificar | `esMia`; `tecnicosDelTablero` solo con los nombres de Desk. |
| `apps/equipos-taller/src/tecnico.test.ts` | Modificar | `esMia` y `tecnicosDelTablero`. |
| `apps/equipos-taller/src/MisEquipos.tsx` | Modificar | Prop `userId`; filtra con `esMia`. |
| `apps/equipos-taller/src/MisEquipos.test.tsx` | Modificar | Tarjeta por `userId`; asignada a otra cuenta. |
| `apps/portal/src/components/RutaMisEquipos.tsx` | Modificar (L17) | Manda `profile.id` además de `full_name`. |
| `apps/portal/src/components/RutaMisEquipos.test.tsx` | Modificar | El `userId` llega a la vista. |
| `docs/equipos-taller.md` | Modificar | Operación del responsable, permisos y «Mis equipos». |
| `apps/equipos-taller/CLAUDE.md` | Modificar | Dónde vive cada pieza del responsable. |

---

### Tarea 1: Migración 078 `portal.equipos_responsable`

**Files:**
- Create: `apps/hub-api/src/users/migrations/078_equipos_responsable.sql`
- Modify: `apps/hub-api/src/db.ts` (array `MIGRATIONS`, ~L102)
- Test: `apps/hub-api/src/equipos/migracion.test.ts`
- Test: `apps/hub-api/src/equipos/migracion.db.test.ts`
- Test: `apps/hub-api/src/users/password-reset/migracion.test.ts` (L15-17)

- [ ] **Step 1: Escribir las pruebas sin base que fallan**

En `apps/hub-api/src/equipos/migracion.test.ts`, reemplazar:

```ts
const SQL_075 = leer('../users/migrations/075_equipos_tablero_tema_tv.sql');
```

por:

```ts
const SQL_075 = leer('../users/migrations/075_equipos_tablero_tema_tv.sql');
const SQL_078 = leer('../users/migrations/078_equipos_responsable.sql');
// Sin comentarios: el texto explicativo puede nombrar DROP o INSERT sin ser sentencia.
const SIN_COMENTARIOS_078 = SQL_078.replace(/--.*$/gm, '');
```

Y añadir al final del fichero:

```ts
describe('migración 078 (responsable asignado desde la tabla)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 077, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'077_password_reset_tokens\.sql',\s*'078_equipos_responsable\.sql'\];/);
  });

  it('no siembra, ni cambia, ni borra nada (se re-ejecuta en cada arranque)', () => {
    expect(SIN_COMENTARIOS_078).not.toMatch(/INSERT\s+INTO|UPDATE\s+portal|\b(DROP|TRUNCATE|ALTER)\b|DELETE\s+FROM/i);
    expect(SIN_COMENTARIOS_078).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => soloIdempotente(SQL_078));

  it('la clave es la de una visita (sin «*SERIAL» ni «pdf:») y se guarda la cuenta, no el nombre', () => {
    expect(SIN_COMENTARIOS_078).toContain("CHECK (clave ~ '^[A-Z0-9]{3,20}\\|\\d{4}-\\d{2}-\\d{2}$')");
    expect(SIN_COMENTARIOS_078).toMatch(/user_id\s+uuid\s+NOT NULL REFERENCES portal\.users\(id\) ON DELETE CASCADE/);
    expect(SIN_COMENTARIOS_078).toMatch(/asignado_por_id\s+uuid\s+NULL REFERENCES portal\.users\(id\) ON DELETE SET NULL/);
  });

  it('da permisos a portal_app solo si el rol existe (DATA-332)', () => {
    expect(SIN_COMENTARIOS_078).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SIN_COMENTARIOS_078).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON portal\.equipos_responsable TO portal_app/);
  });
});
```

En `apps/hub-api/src/users/password-reset/migracion.test.ts`, reemplazar:

```ts
  it('está apuntada en MIGRATIONS, detrás de la 076, y es la última', () => {
    expect(leer('../../db.ts')).toMatch(/'076_ausencias_notas\.sql',\s*'077_password_reset_tokens\.sql'\];/);
  });
```

por:

```ts
  // Ya no es la última (la 078 de «Equipos en taller» va detrás): basta con que
  // esté justo detrás de la 076. Mismo relevo que la 075 en equipos/migracion.test.ts.
  it('está apuntada en MIGRATIONS, detrás de la 076', () => {
    expect(leer('../../db.ts')).toMatch(/'076_ausencias_notas\.sql',\s*'077_password_reset_tokens\.sql'[,\]]/);
  });
```

- [ ] **Step 2: Escribir la prueba contra Postgres que falla**

En `apps/hub-api/src/equipos/migracion.db.test.ts`, reemplazar:

```ts
const SQL_073 = leer('073_equipos_origen_sincronizacion.sql');
```

por:

```ts
const SQL_073 = leer('073_equipos_origen_sincronizacion.sql');
const SQL_078 = leer('078_equipos_responsable.sql');
```

Reemplazar:

```ts
  it('deja sus cinco tablas y sus dos vistas (equipos_drive_archivos y equipos_sincronizacion son de la 072; equipos_kiosco y equipos_tablero_config, de la 074)', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name LIKE 'equipos\\_%' ORDER BY 1`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'equipos_ajuste', 'equipos_drive_archivos', 'equipos_ejecucion', 'equipos_estado', 'equipos_incidente', 'equipos_kiosco', 'equipos_llaves',
      'equipos_sincronizacion', 'equipos_tablero_config', 'equipos_v_equipos', 'equipos_v_remisiones_ilegibles',
    ]);
  });
```

por:

```ts
  it('deja sus cinco tablas y sus dos vistas (equipos_drive_archivos y equipos_sincronizacion son de la 072; equipos_kiosco y equipos_tablero_config, de la 074; equipos_responsable, de la 078)', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name LIKE 'equipos\\_%' ORDER BY 1`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'equipos_ajuste', 'equipos_drive_archivos', 'equipos_ejecucion', 'equipos_estado', 'equipos_incidente', 'equipos_kiosco', 'equipos_llaves',
      'equipos_responsable', 'equipos_sincronizacion', 'equipos_tablero_config', 'equipos_v_equipos', 'equipos_v_remisiones_ilegibles',
    ]);
  });
```

Y añadir al final del fichero:

```ts
describe('migración 078 contra Postgres', () => {
  const vaciar = async () => {
    await db.query('TRUNCATE portal.equipos_responsable');
    await db.query(`DELETE FROM portal.users WHERE email LIKE '%@equipos.test'`);
  };
  const usuario = async (email: string): Promise<string> =>
    (await db.query(
      `INSERT INTO portal.users (full_name, email, password_hash, role, status) VALUES ($1, $2, 'x', 'reader', 'active') RETURNING id::text AS id`,
      [email.split('@')[0], email],
    )).rows[0].id;
  const asignar = (clave: string, userId: string, por: string | null = null) =>
    db.query(`INSERT INTO portal.equipos_responsable (clave, user_id, asignado_por_id, asignado_por) VALUES ($1, $2, $3, 'x')`, [clave, userId, por]);
  const cuantas = async () => (await db.query('SELECT count(*)::int AS n FROM portal.equipos_responsable')).rows[0].n;

  it('se puede aplicar dos veces más sin cambiar columnas ni borrar filas', async () => {
    await vaciar();
    await asignar('1BA9041T|2026-11-01', await usuario('uno@equipos.test'));
    const columnas = async () =>
      (await db.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = 'portal' AND table_name = 'equipos_responsable' ORDER BY 1`,
      )).rows;
    const antes = await columnas();
    await db.query(SQL_078);
    await db.query(SQL_078);
    expect(await columnas()).toEqual(antes);
    expect(await cuantas()).toBe(1);
    await vaciar();
  });

  it('no siembra ninguna fila', async () => {
    await vaciar();
    await db.query(SQL_078);
    expect(await cuantas()).toBe(0);
  });

  it('la clave es solo de visita: el CHECK rechaza «*SERIAL», «pdf:» y cualquier otra cosa', async () => {
    await vaciar();
    const u = await usuario('uno@equipos.test');
    for (const mala of ['*1BA9041T', 'pdf:Abcdefghij_-12', "x' OR 1=1", '1ba9041t|2026-11-01', '1BA9041T|26-11-01']) {
      await expect(asignar(mala, u), mala).rejects.toMatchObject({ code: '23514' });
    }
    await asignar('1BA9041T|2026-11-01', u);
    expect(await cuantas()).toBe(1);
    await vaciar();
  });

  it('al borrar un usuario se borran sus asignaciones; al borrar a quien asignó, solo se olvida su id (D6)', async () => {
    await vaciar();
    const tecnico = await usuario('tecnico@equipos.test');
    const jefe = await usuario('jefe@equipos.test');
    await asignar('1BA9041T|2026-11-01', tecnico, jefe);
    await db.query('DELETE FROM portal.users WHERE id = $1', [jefe]);
    expect((await db.query('SELECT asignado_por_id, asignado_por FROM portal.equipos_responsable')).rows).toEqual([{ asignado_por_id: null, asignado_por: 'x' }]);
    await db.query('DELETE FROM portal.users WHERE id = $1', [tecnico]);
    expect(await cuantas()).toBe(0);
    await vaciar();
  });
});
```

- [ ] **Step 3: Verlas fallar**

```bash
cd apps/hub-api && npx vitest run src/equipos/migracion.test.ts src/users/password-reset/migracion.test.ts
```

Esperado: FAIL en `src/equipos/migracion.test.ts` con `ENOENT: no such file or directory` sobre `078_equipos_responsable.sql`. La de password-reset pasa: el `[,\]]` también casa hoy.

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/migracion.db.test.ts
```

Esperado: FAIL con el mismo `ENOENT` al cargar el fichero (necesita Docker).

- [ ] **Step 4: Crear la migración**

Crear `apps/hub-api/src/users/migrations/078_equipos_responsable.sql`:

```sql
-- Migration 078: «Equipos en taller», responsable asignado desde la tabla
-- (docs/superpowers/specs/2026-11-19-equipos-responsable-design.md).
--
-- Una fila por VISITA: la clave «SERIAL|AAAA-MM-DD» de claveFila (núcleo), sin las variantes
-- «*SERIAL» ni «pdf:» de equipos_ajuste. Tabla propia, no equipos_ajuste: su clave es PRIMARY KEY
-- y una visita con un ajuste no podría tener además responsable (D3). La siguiente visita del
-- mismo equipo empieza sin asignación (D2).
--   · user_id: a quién se asignó. Se guarda la cuenta y no el nombre: «Mis equipos» la reconoce
--     por el usuario y un cambio de nombre no la deja huérfana. Si el usuario se borra, se borran
--     sus asignaciones; si solo se desactiva o pierde la app, la fila se conserva y deja de contar
--     hasta que la recupere (eso lo filtra repo.listarResponsables, no la base) (D6).
--   · asignado_por / asignado_por_id: quién asignó, con su nombre de ese momento.
--
-- La clasificación de cada hora no toca esta tabla: solo reescribe foto, exits y ent.
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque. Solo DDL idempotente.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.equipos_responsable (
  clave            text        PRIMARY KEY
                               CHECK (clave ~ '^[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}$'),
  user_id          uuid        NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  asignado_por_id  uuid        NULL REFERENCES portal.users(id) ON DELETE SET NULL,
  asignado_por     text        NOT NULL,
  asignado_en      timestamptz NOT NULL DEFAULT now()
);

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da. La 068 concede
-- ALL TABLES, pero corre antes que esta en el mismo arranque. No hay secuencia: la clave es texto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_responsable TO portal_app;
  END IF;
END $$;
```

En `apps/hub-api/src/db.ts`, reemplazar:

```ts
'076_ausencias_notas.sql', '077_password_reset_tokens.sql'];
```

por:

```ts
'076_ausencias_notas.sql', '077_password_reset_tokens.sql', '078_equipos_responsable.sql'];
```

- [ ] **Step 5: Verlas pasar**

```bash
cd apps/hub-api && npx vitest run src/equipos/migracion.test.ts src/users/password-reset/migracion.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/migracion.db.test.ts src/equipos/repo.db.test.ts
```

Esperado: PASS en los cuatro ficheros. `repo.db.test.ts` sigue verde con la tabla nueva.

- [ ] **Step 6: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/hub-api/src/users/migrations/078_equipos_responsable.sql apps/hub-api/src/db.ts apps/hub-api/src/equipos/migracion.test.ts apps/hub-api/src/equipos/migracion.db.test.ts apps/hub-api/src/users/password-reset/migracion.test.ts
git commit -m "feat(equipos-taller): migración 078 del responsable asignado por visita"
```

---

### Tarea 2: Contrato: tipos del responsable y clave de visita

**Files:**
- Modify: `apps/hub-api/src/equipos/contrato.ts` (tras `UsuarioConLlaves` ~L122, tras `claveValida` ~L132 y en `RespuestaEquipos` ~L84)
- Test: `apps/hub-api/src/equipos/contrato.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

En `apps/hub-api/src/equipos/contrato.test.ts`, reemplazar la línea de import:

```ts
import { ajusteValido, avisoFoto, CAUSA_SYNC_ATRASADA, CAUSA_TEXTOS_FALLIDOS, claveValida, type Corrida } from './contrato.js';
```

por:

```ts
import { ajusteValido, avisoFoto, CAUSA_SYNC_ATRASADA, CAUSA_TEXTOS_FALLIDOS, claveValida, claveVisitaValida, type Corrida } from './contrato.js';
```

Y añadir, justo antes de `describe('avisoFoto (§5.3)', () => {`:

```ts
describe('claves de visita (responsable asignado)', () => {
  it('solo «SERIAL|AAAA-MM-DD» con una fecha que exista: ni «*SERIAL», ni «pdf:», ni nada más', () => {
    expect(['1BA9041T|2026-11-01', '1BA90417|2028-02-29'].every(claveVisitaValida)).toBe(true);
    expect(['*1BA9041T', 'pdf:Abcdefghij_-12', "x' OR 1=1", '1ba9041t|2026-11-01', '1BA9041T|2026-02-30', 'AB|2026-11-01', ''].some(claveVisitaValida)).toBe(false);
  });
});

```

- [ ] **Step 2: Verla fallar**

```bash
cd apps/hub-api && npx vitest run src/equipos/contrato.test.ts
```

Esperado: FAIL en «claves de visita» con `TypeError: undefined is not a function` (`claveVisitaValida` no existe).

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/equipos/contrato.ts`, reemplazar:

```ts
  /** Ajustes efectivos del tablero. Opcional: un servidor anterior no lo manda y la pantalla usa los de por defecto. */
  tablero?: AjustesTablero;
}
```

por:

```ts
  /** Ajustes efectivos del tablero. Opcional: un servidor anterior no lo manda y la pantalla usa los de por defecto. */
  tablero?: AjustesTablero;
  /**
   * Responsables asignados desde la tabla, por clave de visita (`claveFila`). Solo los VIGENTES (D6: usuario
   * activo y con la app). Opcional: un servidor anterior no lo manda y la pantalla lo trata como vacío.
   */
  responsables?: Record<string, ResponsableAsignado>;
}
```

Reemplazar:

```ts
/** Una fila de GET /api/equipos-taller/llaves. */
export interface UsuarioConLlaves extends LlavesUsuario {
  userId: string;
  nombre: string;
  email: string;
  esAdmin: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}
```

por:

```ts
/** Una fila de GET /api/equipos-taller/llaves. */
export interface UsuarioConLlaves extends LlavesUsuario {
  userId: string;
  nombre: string;
  email: string;
  esAdmin: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

/** El responsable asignado desde la tabla a una visita (`portal.equipos_responsable`), con el nombre ACTUAL del usuario. */
export interface ResponsableAsignado {
  userId: string;
  nombre: string;
  /** Quién lo asignó (su nombre en ese momento o, si no se encontró, su correo). */
  por: string;
  /** Cuándo (ISO). */
  en: string;
}

/** Un usuario al que se puede asignar una visita: activo y con la app `equipos-taller` (D5). Respuesta de GET /tecnicos. */
export interface TecnicoAsignable {
  userId: string;
  nombre: string;
}
```

Reemplazar:

```ts
export const TIPOS_AJUSTE: readonly Ajuste['t'][] = ['in', 'out', 'ret', 'pdf'];
```

por:

```ts
const CLAVE_VISITA = /^[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}$/;
/** Clave de UNA visita («SERIAL|AAAA-MM-DD»), la única que admite el responsable: ni «*SERIAL» ni «pdf:». */
export const claveVisitaValida = (k: string): boolean => CLAVE_VISITA.test(k) && claveValida(k);

export const TIPOS_AJUSTE: readonly Ajuste['t'][] = ['in', 'out', 'ret', 'pdf'];
```

- [ ] **Step 4: Verla pasar**

```bash
cd apps/hub-api && npx vitest run src/equipos/contrato.test.ts
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS; los dos `tsc` sin errores. El contrato también lo compila la sub-app.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/hub-api/src/equipos/contrato.ts apps/hub-api/src/equipos/contrato.test.ts
git commit -m "feat(equipos-taller): contrato del responsable asignado y claves de visita"
```

---

### Tarea 3: Repositorio de responsables y técnicos asignables

**Files:**
- Modify: `apps/hub-api/src/equipos/repo.ts` (L2-4, L12, interfaz ~L70-75, tras `aUsuario` ~L141 y tras `guardarLlaves` ~L295)
- Modify: `apps/hub-api/src/equipos/servicio.test.ts` (doble tipado, ~L67-70)
- Test: `apps/hub-api/src/equipos/repo.db.test.ts`

- [ ] **Step 1: Escribir las pruebas contra Postgres que fallan**

En `apps/hub-api/src/equipos/repo.db.test.ts`, reemplazar (con «reemplazar todas»: aparece dos veces, en `afterAll` y en `beforeEach`):

```ts
  await db.query('TRUNCATE portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion, portal.equipos_incidente, portal.equipos_llaves RESTART IDENTITY');
```

por:

```ts
  await db.query('TRUNCATE portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion, portal.equipos_incidente, portal.equipos_llaves, portal.equipos_responsable RESTART IDENTITY');
```

Y añadir al final del fichero:

```ts
describe('responsables (migración 078)', () => {
  const K = '1BA9041T|2026-11-01';

  it('guardar, reasignar y borrar (idempotente), con el nombre ACTUAL del usuario y la firma de quien asignó', async () => {
    const uno = await usuario('uno@equipos.test', { app: true });
    const dos = await usuario('dos@equipos.test', { app: true });
    const jefe = await usuario('jefe@equipos.test', { app: true });
    const a = await repo.guardarResponsable(K, uno, { userId: jefe, email: 'jefe@equipos.test' });
    expect(a).toEqual({ userId: uno, nombre: 'uno', por: 'jefe', en: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    await repo.guardarResponsable(K, dos, { userId: jefe, email: 'jefe@equipos.test' });
    expect(Object.keys(await repo.listarResponsables())).toEqual([K]);
    expect((await repo.listarResponsables())[K]).toMatchObject({ userId: dos, nombre: 'dos', por: 'jefe' });
    await db.query(`UPDATE portal.users SET full_name = 'Dos Renombrado' WHERE id = $1`, [dos]);
    expect((await repo.listarResponsables())[K].nombre).toBe('Dos Renombrado');
    await repo.borrarResponsable(K);
    await repo.borrarResponsable(K);
    expect(await repo.listarResponsables()).toEqual({});
  });

  it('sin la cuenta de quien asigna, la firma es su correo', async () => {
    const uno = await usuario('uno@equipos.test', { app: true });
    expect((await repo.guardarResponsable(K, uno, { userId: null, email: 'quien@equipos.test' })).por).toBe('quien@equipos.test');
  });

  it('listarResponsables omite a los usuarios inactivos o sin la app; la fila se conserva y vuelve a contar (D6)', async () => {
    const baja = await usuario('baja@equipos.test', { app: true });
    const sinApp = await usuario('sin-app@equipos.test', { app: true });
    const vigente = await usuario('vigente@equipos.test', { app: true });
    await repo.guardarResponsable('1BA90001|2026-11-01', baja, { userId: null, email: 'x@equipos.test' });
    await repo.guardarResponsable('1BA90002|2026-11-01', sinApp, { userId: null, email: 'x@equipos.test' });
    await repo.guardarResponsable('1BA90003|2026-11-01', vigente, { userId: null, email: 'x@equipos.test' });
    await db.query(`UPDATE portal.users SET status = 'inactive' WHERE id = $1`, [baja]);
    await db.query('DELETE FROM portal.user_apps WHERE user_id = $1', [sinApp]);
    expect(Object.keys(await repo.listarResponsables())).toEqual(['1BA90003|2026-11-01']);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_responsable')).rows[0].n).toBe(3);
    await db.query(`INSERT INTO portal.user_apps (user_id, app_id) VALUES ($1, 'equipos-taller')`, [sinApp]);
    expect(Object.keys(await repo.listarResponsables())).toEqual(['1BA90002|2026-11-01', '1BA90003|2026-11-01']);
  });

  it('técnicos asignables: activos con la app, por nombre; ni inactivos, ni sin la app, ni un admin sin ella (D5)', async () => {
    const beta = await usuario('beta@equipos.test', { app: true });
    const alfa = await usuario('alfa@equipos.test', { app: true });
    const baja = await usuario('baja@equipos.test', { app: true, status: 'inactive' });
    const sinApp = await usuario('sin-app@equipos.test');
    const admin = await usuario('admin@equipos.test', { role: 'admin' });
    const mios = new Set([beta, alfa, baja, sinApp, admin]);
    expect((await repo.listarTecnicos()).filter((t) => mios.has(t.userId))).toEqual([{ userId: alfa, nombre: 'alfa' }, { userId: beta, nombre: 'beta' }]);
    expect(await repo.esTecnicoValido(alfa)).toBe(true);
    for (const id of [baja, sinApp, admin, '00000000-0000-4000-8000-00000000dead']) expect(await repo.esTecnicoValido(id), id).toBe(false);
  });
});
```

- [ ] **Step 2: Verlas fallar**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/repo.db.test.ts
```

Esperado: FAIL en los cuatro tests nuevos con `TypeError: repo.guardarResponsable is not a function`, `repo.listarTecnicos is not a function`, etc. Los demás siguen en verde.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/equipos/repo.ts`, reemplazar:

```ts
 * Lectura y escritura de las tablas `portal.equipos_*` (migración 071). Solo SQL:
 * qué se escribe lo deciden servicio.ts (corridas), incidente.ts (incidentes) y
 * router.ts (ajustes y llaves).
```

por:

```ts
 * Lectura y escritura de las tablas `portal.equipos_*` (migraciones 071 y 078). Solo SQL:
 * qué se escribe lo deciden servicio.ts (corridas), incidente.ts (incidentes) y
 * router.ts (ajustes, llaves y responsables).
```

Reemplazar:

```ts
import type { AjusteFirmado, Corrida, Incidente, LlavesUsuario, OrigenCorrida, UsuarioConLlaves } from './contrato.js';
```

por:

```ts
import type { AjusteFirmado, Corrida, Incidente, LlavesUsuario, OrigenCorrida, ResponsableAsignado, TecnicoAsignable, UsuarioConLlaves } from './contrato.js';
```

Reemplazar (final de la interfaz):

```ts
  /** null si el usuario no existe. */
  guardarLlaves(userId: string, l: LlavesUsuario, actualizadoPor: string): Promise<UsuarioConLlaves | null>;
}
```

por:

```ts
  /** null si el usuario no existe. */
  guardarLlaves(userId: string, l: LlavesUsuario, actualizadoPor: string): Promise<UsuarioConLlaves | null>;
  /** Las asignaciones VIGENTES (D6: usuario activo y con la app), por clave de visita, con el nombre actual del usuario. */
  listarResponsables(): Promise<Record<string, ResponsableAsignado>>;
  /** Upsert por clave. `quien` firma: su nombre de ahora o, si no se encuentra, su correo. */
  guardarResponsable(clave: string, userId: string, quien: { userId: string | null; email: string }): Promise<ResponsableAsignado>;
  /** Idempotente. */
  borrarResponsable(clave: string): Promise<void>;
  /** Usuarios activos con la app, por nombre (D5). Un admin sin la app no entra. */
  listarTecnicos(): Promise<TecnicoAsignable[]>;
  /** ¿Activo y con la app? */
  esTecnicoValido(userId: string): Promise<boolean>;
}
```

Reemplazar:

```ts
  actualizadoPor: x.actualizado_por ?? null,
  actualizadoEn: iso(x.actualizado_en),
});
```

por:

```ts
  actualizadoPor: x.actualizado_por ?? null,
  actualizadoEn: iso(x.actualizado_en),
});

/** Activo y con la app asignada: a quién se puede asignar una visita y qué asignaciones cuentan (D5, D6). Sin excepción para los admin. */
const SQL_CON_LA_APP = `u.status = 'active' AND EXISTS (SELECT 1 FROM portal.user_apps a WHERE a.user_id = u.id AND a.app_id = 'equipos-taller')`;
const aResponsable = (x: Fila): ResponsableAsignado => ({
  userId: String(x.user_id),
  nombre: x.full_name ?? '',
  por: x.asignado_por ?? '',
  en: iso(x.asignado_en) ?? '',
});
```

Reemplazar (final de `crearRepoEquipos`):

```ts
      const { rows } = await db.query(`SELECT ${SQL_USUARIO_LLAVES} WHERE u.id = $1::uuid`, [userId]);
      return aUsuario(rows[0]);
    },
  };
}
```

por:

```ts
      const { rows } = await db.query(`SELECT ${SQL_USUARIO_LLAVES} WHERE u.id = $1::uuid`, [userId]);
      return aUsuario(rows[0]);
    },

    async listarResponsables() {
      const { rows } = await db.query(
        `SELECT r.clave, r.user_id::text AS user_id, u.full_name, r.asignado_por, r.asignado_en
           FROM portal.equipos_responsable r JOIN portal.users u ON u.id = r.user_id
          WHERE ${SQL_CON_LA_APP}
          ORDER BY r.clave`,
      );
      return Object.fromEntries(rows.map((x: Fila) => [x.clave, aResponsable(x)]));
    },

    async guardarResponsable(clave, userId, quien) {
      // La firma es el nombre de quien asigna EN ESTE MOMENTO (el JWT no lo lleva); sin su fila, su correo.
      const { rows } = await db.query(
        `WITH g AS (
           INSERT INTO portal.equipos_responsable (clave, user_id, asignado_por_id, asignado_por, asignado_en)
           VALUES ($1, $2::uuid, $3::uuid,
                   COALESCE((SELECT NULLIF(btrim(p.full_name), '') FROM portal.users p WHERE p.id = $3::uuid), $4), now())
           ON CONFLICT (clave) DO UPDATE SET user_id = EXCLUDED.user_id, asignado_por_id = EXCLUDED.asignado_por_id,
                                             asignado_por = EXCLUDED.asignado_por, asignado_en = now()
           RETURNING clave, user_id, asignado_por, asignado_en
         )
         SELECT g.clave, g.user_id::text AS user_id, u.full_name, g.asignado_por, g.asignado_en
           FROM g JOIN portal.users u ON u.id = g.user_id`,
        [clave, userId, quien.userId, quien.email],
      );
      return aResponsable(rows[0]);
    },

    async borrarResponsable(clave) {
      await db.query('DELETE FROM portal.equipos_responsable WHERE clave = $1', [clave]);
    },

    async listarTecnicos() {
      const { rows } = await db.query(`SELECT u.id::text AS user_id, u.full_name FROM portal.users u WHERE ${SQL_CON_LA_APP} ORDER BY lower(u.full_name), u.id`);
      return rows.map((x: Fila) => ({ userId: String(x.user_id), nombre: x.full_name ?? '' }));
    },

    async esTecnicoValido(userId) {
      const { rows } = await db.query(`SELECT 1 FROM portal.users u WHERE u.id = $1::uuid AND ${SQL_CON_LA_APP}`, [userId]);
      return rows.length > 0;
    },
  };
}
```

En `apps/hub-api/src/equipos/servicio.test.ts` (doble tipado de `RepoEquipos`), reemplazar:

```ts
    llavesDe: async () => ({ editaAjustes: false, recibeAlertas: false }),
    listarLlaves: async () => [],
    guardarLlaves: async () => null,
  };
```

por:

```ts
    llavesDe: async () => ({ editaAjustes: false, recibeAlertas: false }),
    listarLlaves: async () => [],
    guardarLlaves: async () => null,
    listarResponsables: async () => ({}),
    guardarResponsable: async () => { throw new Error('no se usa'); },
    borrarResponsable: async () => {},
    listarTecnicos: async () => [],
    esTecnicoValido: async () => false,
  };
```

- [ ] **Step 4: Verlas pasar**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/repo.db.test.ts
cd apps/hub-api && npx vitest run src/equipos/servicio.test.ts
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: PASS en los dos ficheros y `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/hub-api/src/equipos/repo.ts apps/hub-api/src/equipos/repo.db.test.ts apps/hub-api/src/equipos/servicio.test.ts
git commit -m "feat(equipos-taller): repositorio de responsables y técnicos asignables"
```

---

### Tarea 4: Núcleo: el responsable efectivo (D7) y la tarjeta

**Files:**
- Modify: `apps/hub-api/src/equipos/nucleo/tipos.ts` (~L167-187)
- Modify: `apps/hub-api/src/equipos/nucleo/pantalla.ts` (L3-4 y tras `aplicarAjustes` ~L31)
- Modify: `apps/hub-api/src/equipos/nucleo/taller-board.ts` (L4, L27, L173-193)
- Create (test): `apps/hub-api/src/equipos/nucleo/responsables.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/nucleo/responsables.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AJUSTES_TABLERO_POR_DEFECTO, EST, aplicarAjustes, aplicarResponsables, avatarDe, claveFila, construirTablero, encargadoDesk, responsableDe,
  type Fila, type ResponsableFila, type Tarjeta, type TicketFila,
} from './index.js';

// Responsable de cada visita (D7): la asignación del portal manda sobre el Encargado de Desk; «Pendiente
// Asignar» no es nadie. Todo ficticio: serial, cliente y personas inventados.
const AHORA = Date.parse('2026-11-19T20:00:00Z');
const tk = (enc: string): TicketFila => ({ n: '1001', id: '1', st: 'En Proceso', stt: 'Open', u: '', m: '', enc, eq: 'Equipo Z', srv: '', fs: '', cl: '' });
const fila = (o: Partial<Fila> = {}): Fila =>
  ({ id: 'E1', d: '2026-11-01', c: 'CLIENTE A', sn: '18A90417', est: EST.TALLER, src: '', why: [], x: null, z: tk('Técnico Uno'), zc: false, pa: [], xd: '', eq: '', ...o });
const ASIGNADO: ResponsableFila = { userId: '00000000-0000-4000-8000-0000000000c2', nombre: 'Técnico Dos', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' };
const tarjeta = (r: Fila): Tarjeta => construirTablero([r], AJUSTES_TABLERO_POR_DEFECTO, AHORA).columnas.flatMap((c) => c.tarjetas)[0];

describe('aplicarResponsables', () => {
  it('pone la asignación en la visita por su clave (serial en clase OCR + fecha de entrada)', () => {
    expect(claveFila(fila())).toBe('1BA9041T|2026-11-01');
    const [r] = aplicarResponsables([fila()], { '1BA9041T|2026-11-01': ASIGNADO });
    expect(r.resp).toEqual(ASIGNADO);
  });

  it('una visita nueva del mismo serial no hereda la asignación', () => {
    const vieja = fila();
    const nueva = fila({ id: 'E2', d: '2026-11-15' });
    const [a, b] = aplicarResponsables([vieja, nueva], { [claveFila(vieja)]: ASIGNADO });
    expect(a.resp).toEqual(ASIGNADO);
    expect(b.resp).toBeUndefined();
  });

  it('deja igual las filas sin asignación y no toca la lista recibida', () => {
    const rows = [fila()];
    const out = aplicarResponsables(rows, {});
    expect(out[0]).toBe(rows[0]);
    expect(rows[0].resp).toBeUndefined();
  });

  it('va detrás de aplicarAjustes: un ajuste y un responsable conviven en la misma visita', () => {
    const r = fila({ est: EST.REVISAR });
    const [x] = aplicarResponsables(aplicarAjustes([r], { [claveFila(r)]: { t: 'in', m: '', at: '2026-11-02' } }), { [claveFila(r)]: ASIGNADO });
    expect([x.est, x.resp?.nombre]).toEqual([EST.TALLER, 'Técnico Dos']);
  });
});

describe('responsableDe (D7)', () => {
  it('la asignación del portal manda sobre el Encargado de Desk', () => {
    expect(responsableDe({ ...fila(), resp: ASIGNADO })).toEqual({ nombre: 'Técnico Dos', userId: ASIGNADO.userId, origen: 'portal' });
  });

  it('sin asignación, el Encargado de Desk', () => {
    expect(responsableDe(fila())).toEqual({ nombre: 'Técnico Uno', origen: 'desk' });
    expect(encargadoDesk(fila())).toBe('Técnico Uno');
  });

  it('«Pendiente Asignar» no es una persona: sin responsable (se ve «Sin asignar»)', () => {
    for (const enc of ['Pendiente Asignar', ' PENDIENTE  asignar ']) {
      expect(responsableDe(fila({ z: tk(enc) })), enc).toBeNull();
      expect(encargadoDesk(fila({ z: tk(enc) })), enc).toBe('');
    }
  });

  it('sin ticket ni asignación, nadie; sin ticket pero asignado en el portal, el asignado', () => {
    expect(responsableDe(fila({ z: null }))).toBeNull();
    expect(responsableDe({ ...fila({ z: null }), resp: ASIGNADO })?.nombre).toBe('Técnico Dos');
  });

  it('una asignación solo con el nombre (la de la TV con llave) no inventa la cuenta', () => {
    expect(responsableDe({ ...fila(), resp: { nombre: 'Técnico Dos' } })).toEqual({ nombre: 'Técnico Dos', origen: 'portal' });
  });
});

describe('tarjetaDe usa el responsable efectivo', () => {
  it('con asignación: el asignado y su cuenta, aunque Desk diga otro', () => {
    const t = tarjeta({ ...fila(), resp: ASIGNADO });
    expect(t.tecnico).toEqual({ nombre: 'Técnico Dos', iniciales: 'TD', avatar: avatarDe('Técnico Dos'), userId: ASIGNADO.userId });
    expect(t.pie).toBe('tecnico');
  });

  it('sin asignación: el de Desk, sin cuenta', () => {
    const t = tarjeta(fila());
    expect(t.tecnico).toEqual({ nombre: 'Técnico Uno', iniciales: 'TU', avatar: 2 });
    expect(t.tecnico !== null && 'userId' in t.tecnico).toBe(false);
  });

  it('un equipo sin ticket asignado en el portal deja de ser «Sin técnico»', () => {
    const t = tarjeta({ ...fila({ z: null }), resp: ASIGNADO });
    expect([t.pie, t.tecnico?.nombre]).toEqual(['tecnico', 'Técnico Dos']);
  });
});
```

- [ ] **Step 2: Verla fallar**

```bash
cd apps/hub-api && npx vitest run src/equipos/nucleo/responsables.test.ts
```

Esperado: FAIL con `TypeError: aplicarResponsables is not a function` (y lo mismo con `responsableDe` y `encargadoDesk`). Los de `tarjetaDe` fallan porque el técnico sigue saliendo de Desk.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/equipos/nucleo/tipos.ts`, reemplazar:

```ts
/** Una fila de la pantalla: una entrada de un equipo. */
export interface Fila {
```

por:

```ts
/**
 * Responsable asignado desde el portal a una visita (`portal.equipos_responsable`). La TV con llave solo
 * recibe `nombre`: ni la cuenta, ni quién lo asignó, ni cuándo.
 */
export interface ResponsableFila {
  userId?: string;
  nombre: string;
  /** Quién lo asignó y cuándo (ISO). */
  por?: string;
  en?: string;
}

/** Una fila de la pantalla: una entrada de un equipo. */
export interface Fila {
```

Y reemplazar:

```ts
  /** Marcada por un ajuste manual (1 = de esta entrada, 2 = del serial). */
  man?: 1 | 2;
}
```

por:

```ts
  /** Marcada por un ajuste manual (1 = de esta entrada, 2 = del serial). */
  man?: 1 | 2;
  /** Responsable asignado en el portal (D7: manda sobre el Encargado de Desk). Lo pone aplicarResponsables; la foto no lo guarda. */
  resp?: ResponsableFila;
}
```

En `apps/hub-api/src/equipos/nucleo/pantalla.ts`, reemplazar:

```ts
import { ADENTRO, cls, key, nrm } from "./reglas.js";
import { EST, type Ajuste, type Ajustes, type Fila, type Foto, type Ilegible } from "./tipos.js";
```

por:

```ts
import { ADENTRO, cls, key, nkey, nrm } from "./reglas.js";
import { EST, type Ajuste, type Ajustes, type Fila, type Foto, type Ilegible, type ResponsableFila } from "./tipos.js";
```

Y reemplazar:

```ts
    if (b && r.est !== EST.ENTREGADO) return { ...r, est: EST.RETIRADO, src: "manual", why: r.why.concat(b) };
    return r;
  });
}
```

por:

```ts
    if (b && r.est !== EST.ENTREGADO) return { ...r, est: EST.RETIRADO, src: "manual", why: r.why.concat(b) };
    return r;
  });
}

/**
 * Pone en cada visita su responsable asignado en el portal (por `claveFila`: la visita siguiente del mismo
 * serial no lo hereda). Va SIEMPRE detrás de aplicarAjustes: en la tabla, en el tablero y en la TV.
 */
export function aplicarResponsables(rows: Fila[], mapa: Record<string, ResponsableFila>): Fila[] {
  return rows.map((r) => {
    const a = mapa[claveFila(r)];
    return a ? { ...r, resp: a } : r;
  });
}

/** Lo que Desk pone en «Encargado» cuando el ticket aún no tiene técnico: no es una persona. */
const SIN_TECNICO_DESK = new Set(["Pendiente Asignar"].map(nkey));

/** El Encargado del ticket en Desk 2.0, o "" si no hay ticket, está vacío o es «Pendiente Asignar». */
export function encargadoDesk(r: Pick<Fila, "z">): string {
  const crudo = r.z?.enc?.trim() ?? "";
  return SIN_TECNICO_DESK.has(nkey(crudo)) ? "" : crudo;
}

export interface ResponsableEfectivo {
  nombre: string;
  /** Solo si viene del portal con su cuenta (la TV con llave no la recibe). */
  userId?: string;
  origen: "portal" | "desk";
}

/**
 * Responsable efectivo de una visita (D7): la asignación del portal; si no, el Encargado de Desk.
 * «Pendiente Asignar» no es nadie (se muestra «Sin asignar»). La misma regla en la tabla, el tablero,
 * la TV y «Mis equipos».
 */
export function responsableDe(r: Pick<Fila, "z" | "resp">): ResponsableEfectivo | null {
  const nombre = (r.resp?.nombre ?? "").trim();
  if (nombre) return r.resp?.userId ? { nombre, userId: r.resp.userId, origen: "portal" } : { nombre, origen: "portal" };
  const enc = encargadoDesk(r);
  return enc ? { nombre: enc, origen: "desk" } : null;
}
```

En `apps/hub-api/src/equipos/nucleo/taller-board.ts`, reemplazar:

```ts
import { VISTAS, VISTA_PARCIALES, VISTA_TICKET_ABIERTO, claveFila } from "./pantalla.js";
```

por:

```ts
import { VISTAS, VISTA_PARCIALES, VISTA_TICKET_ABIERTO, claveFila, responsableDe } from "./pantalla.js";
```

Reemplazar:

```ts
  tecnico: { nombre: string; iniciales: string; avatar: number } | null;
```

por:

```ts
  /** El responsable efectivo (D7). `userId` solo si lo asignó el portal; vacío si viene de Desk o en la TV con llave. */
  tecnico: { nombre: string; iniciales: string; avatar: number; userId?: string } | null;
```

Y reemplazar:

```ts
/** Lo que Desk pone en «Encargado» cuando el ticket aún no tiene técnico: no es una persona. */
const SIN_TECNICO_DESK = new Set(["Pendiente Asignar"].map(nkey));

function tarjetaDe(r: Fila, cfg: AjustesTablero, ahoraMs: number): Tarjeta {
  const dias = diasEnTaller(r.d, ahoraMs);
  const crudo = r.z?.enc?.trim() ?? "";
  const enc = SIN_TECNICO_DESK.has(nkey(crudo)) ? "" : crudo;
  return {
```

por:

```ts
function tarjetaDe(r: Fila, cfg: AjustesTablero, ahoraMs: number): Tarjeta {
  const dias = diasEnTaller(r.d, ahoraMs);
  // D7: la asignación del portal; si no, el Encargado de Desk («Pendiente Asignar» no es nadie).
  const resp = responsableDe(r);
  return {
```

Y reemplazar:

```ts
    tecnico: enc ? { nombre: enc, iniciales: iniciales(enc), avatar: avatarDe(enc) } : null,
    ticket: r.z ? r.z.n : null,
    pie: !r.z ? "neutro" : enc ? "tecnico" : "sin_asignar",
```

por:

```ts
    tecnico: resp
      ? { nombre: resp.nombre, iniciales: iniciales(resp.nombre), avatar: avatarDe(resp.nombre), ...(resp.userId ? { userId: resp.userId } : {}) }
      : null,
    ticket: r.z ? r.z.n : null,
    pie: resp ? "tecnico" : !r.z ? "neutro" : "sin_asignar",
```

(`nkey` sigue importado en `taller-board.ts`: lo usa `avatarDe`.)

- [ ] **Step 4: Verla pasar (con todo el núcleo)**

```bash
cd apps/hub-api && npx vitest run src/equipos/nucleo
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS en `responsables.test.ts`, `taller-board.test.ts` y `pureza.test.ts` («son los siete ficheros del módulo» sigue igual: no hay fichero nuevo fuera de las pruebas). Los dos `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/hub-api/src/equipos/nucleo/tipos.ts apps/hub-api/src/equipos/nucleo/pantalla.ts apps/hub-api/src/equipos/nucleo/taller-board.ts apps/hub-api/src/equipos/nucleo/responsables.test.ts
git commit -m "feat(equipos-taller): el núcleo aplica el responsable del portal antes que el de Desk"
```

---

### Tarea 5: La TV con llave muestra el responsable, solo con su nombre

**Files:**
- Modify: `apps/hub-api/src/equipos/contrato.ts` (L9 y `armarRespuestaTablero` ~L95-102)
- Modify: `apps/hub-api/src/equipos/servicio-tablero.ts` (L39 y `tableroKiosco` L98-104)
- Test: `apps/hub-api/src/equipos/servicio-tablero.test.ts`
- Test: `apps/hub-api/src/equipos/router-kiosco.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `apps/hub-api/src/equipos/servicio-tablero.test.ts`, reemplazar:

```ts
import { armarRespuestaTablero, type AjusteFirmado, type Kiosco } from './contrato.js';
import { aplicarAjustes, construirTablero, AJUSTES_TABLERO_POR_DEFECTO, EST, type Foto } from './nucleo/index.js';
```

por:

```ts
import { armarRespuestaTablero, type AjusteFirmado, type Kiosco, type ResponsableAsignado } from './contrato.js';
import { aplicarAjustes, aplicarResponsables, avatarDe, construirTablero, AJUSTES_TABLERO_POR_DEFECTO, EST, type Foto } from './nucleo/index.js';
```

Reemplazar:

```ts
const AJUSTES: Record<string, AjusteFirmado> = { '18A90001|2026-11-01': { t: 'in', m: 'NOTA-PRIVADA', at: '2026-11-02', usuario: 'quien@equipos.test', creadoEn: '2026-11-02T10:00:00.000Z' } };
```

por:

```ts
const AJUSTES: Record<string, AjusteFirmado> = { '18A90001|2026-11-01': { t: 'in', m: 'NOTA-PRIVADA', at: '2026-11-02', usuario: 'quien@equipos.test', creadoEn: '2026-11-02T10:00:00.000Z' } };
// La visita 18A90001 del 1/11 (clave en clase OCR) asignada en el portal: la TV solo debe ver el nombre.
const ASIGNADO_ID = '00000000-0000-4000-8000-00000000abcd';
const RESPONSABLES: Record<string, ResponsableAsignado> = {
  '1BA90001|2026-11-01': { userId: ASIGNADO_ID, nombre: 'Técnico Dos', por: 'Admin Uno', en: '2026-11-11T15:00:00.000Z' },
};
```

Reemplazar:

```ts
  leerAjustes: async () => AJUSTES,
  ultimaCorridaTerminada: async () => null,
```

por:

```ts
  leerAjustes: async () => AJUSTES,
  listarResponsables: async () => RESPONSABLES,
  ultimaCorridaTerminada: async () => null,
```

Reemplazar:

```ts
  it('el mismo resultado que armar el tablero en el cliente con la misma foto y el mismo reloj', async () => {
    const r = await s.tableroKiosco(AHORA);
    const cfg = { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 10, umbralRojo: 20 };
    expect(r.tablero).toEqual(construirTablero(aplicarAjustes(FOTO.rows, AJUSTES), cfg, AHORA));
    expect(r.tablero.columnas.flatMap((c) => c.tarjetas)).toHaveLength(2);
    expect(r).toEqual(armarRespuestaTablero({ snap: FOTO, ajustes: AJUSTES, cfg, aviso: null }, AHORA));
```

por:

```ts
  it('el mismo resultado que armar el tablero en el cliente con la misma foto y el mismo reloj (salvo la cuenta del responsable)', async () => {
    const r = await s.tableroKiosco(AHORA);
    const cfg = { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 10, umbralRojo: 20 };
    const soloNombre = { '1BA90001|2026-11-01': { nombre: 'Técnico Dos' } };
    expect(r.tablero).toEqual(construirTablero(aplicarResponsables(aplicarAjustes(FOTO.rows, AJUSTES), soloNombre), cfg, AHORA));
    expect(r.tablero.columnas.flatMap((c) => c.tarjetas)).toHaveLength(2);
    expect(r).toEqual(armarRespuestaTablero({ snap: FOTO, ajustes: AJUSTES, responsables: RESPONSABLES, cfg, aviso: null }, AHORA));
```

Y añadir, justo antes de `  it('la TV con llave recibe el tema elegido en Ajustes dentro de «ajustes»', async () => {`:

```ts
  it('el responsable asignado en el portal llega a la TV solo con su nombre: ni la cuenta, ni quién ni cuándo', async () => {
    const r = await s.tableroKiosco(AHORA);
    const t = r.tablero.columnas.flatMap((c) => c.tarjetas).find((x) => x.sn === '18A90001')!;
    expect([t.pie, t.tecnico]).toEqual(['tecnico', { nombre: 'Técnico Dos', iniciales: 'TD', avatar: avatarDe('Técnico Dos') }]);
    const texto = JSON.stringify(r);
    for (const prohibido of [ASIGNADO_ID, 'userId', 'Admin Uno', '2026-11-11T15:00:00.000Z']) expect(texto, prohibido).not.toContain(prohibido);
  });

```

En `apps/hub-api/src/equipos/router-kiosco.test.ts`, reemplazar:

```ts
import { AJUSTES_TABLERO_POR_DEFECTO } from './nucleo/index.js';
```

por:

```ts
import { AJUSTES_TABLERO_POR_DEFECTO, EST, type Fila } from './nucleo/index.js';
import type { ResponsableAsignado } from './contrato.js';
```

Reemplazar:

```ts
let fallaFoto: boolean;
```

por:

```ts
let fallaFoto: boolean;
let filas: Fila[];
let responsables: Record<string, ResponsableAsignado>;
```

Reemplazar:

```ts
    return { at: '2026-11-12T03:00:00.000Z', hoy: '2026-11-11', rows: [], ilegibles: [] };
  },
  leerAjustes: async () => ({}),
```

por:

```ts
    return { at: '2026-11-12T03:00:00.000Z', hoy: '2026-11-11', rows: filas, ilegibles: [] };
  },
  leerAjustes: async () => ({}),
  listarResponsables: async () => responsables,
```

Reemplazar:

```ts
  fallaFoto = false;
  vistos = [];
```

por:

```ts
  fallaFoto = false;
  filas = [];
  responsables = {};
  vistos = [];
```

Y añadir, dentro de `describe('T5 sobreexposición y T6 robo de la base', () => {`, justo antes de `  it('la base solo ve el resumen SHA-256: la llave en claro nunca se busca ni se guarda', async () => {`:

```ts
  it('el responsable asignado en el portal llega solo con su nombre: ni la cuenta, ni quién lo asignó, ni cuándo', async () => {
    filas = [{ id: 'E1', d: '2026-11-01', c: 'CLIENTE A', sn: '18A90417', est: EST.TALLER, src: '', why: [], x: null, z: null, zc: false, pa: [], xd: '', eq: '' }];
    responsables = { '1BA9041T|2026-11-01': { userId: '00000000-0000-4000-8000-00000000abcd', nombre: 'Técnico Uno', por: 'Admin Uno', en: '2026-11-11T15:00:00.000Z' } };
    const r = await pedir(await secretoNuevo());
    expect(r.status).toBe(200);
    const tarjetas = r.body.tablero.columnas.flatMap((c: { tarjetas: { tecnico: unknown }[] }) => c.tarjetas);
    expect(tarjetas[0].tecnico).toEqual({ nombre: 'Técnico Uno', iniciales: 'TU', avatar: 2 });
    for (const prohibido of ['userId', '00000000-0000-4000-8000-00000000abcd', 'Admin Uno', '2026-11-11T15:00:00.000Z']) expect(r.text, prohibido).not.toContain(prohibido);
  });

```

- [ ] **Step 2: Verlas fallar**

```bash
cd apps/hub-api && npx vitest run src/equipos/servicio-tablero.test.ts src/equipos/router-kiosco.test.ts
```

Esperado: FAIL en «el mismo resultado…» y en los dos tests nuevos: `tecnico` sale `null` porque el kiosco aún no lee las asignaciones. El resto de T1–T8 sigue en verde.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/equipos/contrato.ts`, reemplazar:

```ts
import { aplicarAjustes } from './nucleo/pantalla.js';
```

por:

```ts
import { aplicarAjustes, aplicarResponsables } from './nucleo/pantalla.js';
```

Y reemplazar:

```ts
/**
 * El tablero que ve la TV: el MISMO cálculo que hace el navegador con una sesión (aplicarAjustes + construirTablero),
 * así que con la misma foto y el mismo reloj los dos caminos dan lo mismo. Lista blanca: solo estos cuatro campos salen
 * (nada de motivos, salidas, ids de Drive, notas, firmas, permisos ni llaves).
 */
export function armarRespuestaTablero(e: { snap: Foto | null; ajustes: Record<string, AjusteFirmado>; cfg: AjustesTablero; aviso: AvisoFoto | null }, ahoraMs: number): RespuestaTablero {
  return { tablero: construirTablero(aplicarAjustes(e.snap?.rows ?? [], e.ajustes), e.cfg, ahoraMs), ajustes: e.cfg, fotoEn: e.snap?.at ?? null, aviso: e.aviso };
}
```

por:

```ts
/**
 * El tablero que ve la TV: el MISMO cálculo que hace el navegador con una sesión (aplicarAjustes + aplicarResponsables +
 * construirTablero), así que con la misma foto y el mismo reloj los dos caminos dan lo mismo, salvo la cuenta del
 * responsable: la TV solo recibe su NOMBRE (ni userId, ni quién lo asignó, ni cuándo). Lista blanca: solo estos cuatro
 * campos salen (nada de motivos, salidas, ids de Drive, notas, firmas, permisos ni llaves).
 */
export function armarRespuestaTablero(
  e: { snap: Foto | null; ajustes: Record<string, AjusteFirmado>; responsables?: Record<string, ResponsableAsignado>; cfg: AjustesTablero; aviso: AvisoFoto | null },
  ahoraMs: number,
): RespuestaTablero {
  const soloNombres = Object.fromEntries(Object.entries(e.responsables ?? {}).map(([k, r]) => [k, { nombre: r.nombre }]));
  const filas = aplicarResponsables(aplicarAjustes(e.snap?.rows ?? [], e.ajustes), soloNombres);
  return { tablero: construirTablero(filas, e.cfg, ahoraMs), ajustes: e.cfg, fotoEn: e.snap?.at ?? null, aviso: e.aviso };
}
```

En `apps/hub-api/src/equipos/servicio-tablero.ts`, reemplazar:

```ts
  repo: Pick<RepoEquipos, 'leerFoto' | 'leerAjustes' | 'ultimaCorridaTerminada' | 'ultimaCorridaBuena' | 'incidenteAbierto'>;
```

por:

```ts
  repo: Pick<RepoEquipos, 'leerFoto' | 'leerAjustes' | 'listarResponsables' | 'ultimaCorridaTerminada' | 'ultimaCorridaBuena' | 'incidenteAbierto'>;
```

Y reemplazar:

```ts
      const [snap, ajustes, cfg, configurado, ultima, ultimaBuena, incidente] = await Promise.all([
        repo.leerFoto(), repo.leerAjustes(), tablero.leerAjustesTablero(), deps.configurado(),
        repo.ultimaCorridaTerminada(), repo.ultimaCorridaBuena(), repo.incidenteAbierto(),
      ]);
      return armarRespuestaTablero({ snap, ajustes, cfg, aviso: avisoFoto({ configurado, ultima, ultimaBuena, incidente }, fmt) }, ahoraMs);
```

por:

```ts
      const [snap, ajustes, responsables, cfg, configurado, ultima, ultimaBuena, incidente] = await Promise.all([
        repo.leerFoto(), repo.leerAjustes(), repo.listarResponsables(), tablero.leerAjustesTablero(), deps.configurado(),
        repo.ultimaCorridaTerminada(), repo.ultimaCorridaBuena(), repo.incidenteAbierto(),
      ]);
      // armarRespuestaTablero deja solo el nombre del responsable: la TV sin sesión nunca ve la cuenta.
      return armarRespuestaTablero({ snap, ajustes, responsables, cfg, aviso: avisoFoto({ configurado, ultima, ultimaBuena, incidente }, fmt) }, ahoraMs);
```

- [ ] **Step 4: Verlas pasar**

```bash
cd apps/hub-api && npx vitest run src/equipos/servicio-tablero.test.ts src/equipos/router-kiosco.test.ts src/equipos/contrato.test.ts
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: PASS, con T1–T8 en verde, y `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/hub-api/src/equipos/contrato.ts apps/hub-api/src/equipos/servicio-tablero.ts apps/hub-api/src/equipos/servicio-tablero.test.ts apps/hub-api/src/equipos/router-kiosco.test.ts
git commit -m "feat(equipos-taller): la TV con llave muestra el responsable del portal, solo con su nombre"
```

---

### Tarea 6: Rutas de técnicos y responsables, y `responsables` en `GET /`

**Files:**
- Modify: `apps/hub-api/src/equipos/router.ts` (comentario L5-9, import L25, `GET /` L101-121, rutas nuevas tras el `DELETE` de ajustes ~L138)
- Test: `apps/hub-api/src/equipos/router.test.ts`
- Test: `apps/hub-api/src/equipos/router-kiosco.test.ts` (T4)

- [ ] **Step 1: Escribir las pruebas que fallan**

En `apps/hub-api/src/equipos/router.test.ts`, reemplazar:

```ts
import type { AjusteFirmado, Corrida, Incidente, LlavesUsuario, OrigenCorrida, UsuarioConLlaves } from './contrato.js';
```

por:

```ts
import type { AjusteFirmado, Corrida, Incidente, LlavesUsuario, OrigenCorrida, ResponsableAsignado, UsuarioConLlaves } from './contrato.js';
```

Reemplazar:

```ts
let enCurso: Corrida | null = null;
let terminada: Corrida | null = null;
const repo = {
```

por:

```ts
let enCurso: Corrida | null = null;
let terminada: Corrida | null = null;
// Responsables: dos técnicos con la app; cualquier otro uuid «no está activo o no tiene la app».
const TEC_UNO = '00000000-0000-4000-8000-0000000000c1';
const TEC_DOS = '00000000-0000-4000-8000-0000000000c2';
const asignados = new Map<string, ResponsableAsignado>();
const firmas: { clave: string; userId: string; quien: { userId: string | null; email: string } }[] = [];
const borradosResp: string[] = [];
const repo = {
```

Reemplazar:

```ts
  guardarLlaves: async (userId: string, l: LlavesUsuario, por: string): Promise<UsuarioConLlaves | null> =>
    userId.endsWith('999999999999') ? null : { userId, nombre: 'X', email: 'x@ambientalia.com.co', esAdmin: false, ...l, actualizadoPor: por, actualizadoEn: '2026-11-10T15:00:00.000Z' },
} as unknown as RepoEquipos;
```

por:

```ts
  guardarLlaves: async (userId: string, l: LlavesUsuario, por: string): Promise<UsuarioConLlaves | null> =>
    userId.endsWith('999999999999') ? null : { userId, nombre: 'X', email: 'x@ambientalia.com.co', esAdmin: false, ...l, actualizadoPor: por, actualizadoEn: '2026-11-10T15:00:00.000Z' },
  listarResponsables: async () => Object.fromEntries(asignados),
  listarTecnicos: async () => [{ userId: TEC_UNO, nombre: 'Técnico Uno' }, { userId: TEC_DOS, nombre: 'Técnico Dos' }],
  esTecnicoValido: async (userId: string) => userId === TEC_UNO || userId === TEC_DOS,
  guardarResponsable: async (clave: string, userId: string, quien: { userId: string | null; email: string }): Promise<ResponsableAsignado> => {
    firmas.push({ clave, userId, quien });
    const r = { userId, nombre: userId === TEC_UNO ? 'Técnico Uno' : 'Técnico Dos', por: quien.email, en: '2026-11-19T15:00:00.000Z' };
    asignados.set(clave, r);
    return r;
  },
  borrarResponsable: async (clave: string) => {
    borradosResp.push(clave);
    asignados.delete(clave);
  },
} as unknown as RepoEquipos;
```

Reemplazar:

```ts
  revoca = true;
  vi.restoreAllMocks();
});
```

por:

```ts
  revoca = true;
  asignados.clear();
  firmas.length = 0;
  borradosResp.length = 0;
  vi.restoreAllMocks();
});
```

Reemplazar:

```ts
  it('sin la llave, puedeEditar es false (salvo admin)', async () => {
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.permisos.puedeEditar).toBe(false);
    expect((await request(app()).get(B).set('Authorization', token({ role: 'admin' }).auth)).body.permisos.puedeEditar).toBe(true);
  });
});
```

por:

```ts
  it('sin la llave, puedeEditar es false (salvo admin)', async () => {
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.permisos.puedeEditar).toBe(false);
    expect((await request(app()).get(B).set('Authorization', token({ role: 'admin' }).auth)).body.permisos.puedeEditar).toBe(true);
  });
  it('lleva las asignaciones vigentes en «responsables», también a quien no tiene la llave', async () => {
    const r1 = { userId: TEC_UNO, nombre: 'Técnico Uno', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' };
    asignados.set('1BA9041T|2026-11-01', r1);
    const r = await request(app()).get(B).set('Authorization', token().auth);
    expect(r.body.responsables).toEqual({ '1BA9041T|2026-11-01': r1 });
  });
});
```

Y añadir, justo antes de `describe('llaves', () => {`:

```ts
describe('responsable asignado desde la tabla', () => {
  const K = '1BA9041T|2026-11-01';
  const R = (k: string) => B + '/responsables/' + encodeURIComponent(k);
  const put = (auth: string, k: string, b: object) => request(app()).put(R(k)).set('Authorization', auth).send(b);
  const conLlave = () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    return t;
  };

  it('403 sin_llave en las tres rutas, sin tocar nada; 401 sin sesión', async () => {
    const a = token().auth;
    const rs = [await request(app()).get(B + '/tecnicos').set('Authorization', a), await put(a, K, { userId: TEC_UNO }), await request(app()).delete(R(K)).set('Authorization', a)];
    expect(rs.map((r) => [r.status, r.body.error])).toEqual([[403, 'sin_llave'], [403, 'sin_llave'], [403, 'sin_llave']]);
    expect([firmas, borradosResp]).toEqual([[], []]);
    expect((await request(app()).get(B + '/tecnicos')).status).toBe(401);
  });

  it('GET /tecnicos con la llave: los usuarios con la app, sin caché', async () => {
    const r = await request(app()).get(B + '/tecnicos').set('Authorization', conLlave().auth);
    expect([r.status, r.headers['cache-control'], r.body]).toEqual([200, 'no-store', { tecnicos: [{ userId: TEC_UNO, nombre: 'Técnico Uno' }, { userId: TEC_DOS, nombre: 'Técnico Dos' }] }]);
  });

  it('asignar, reasignar y quitar (dos veces: 200 también si ya no había asignación)', async () => {
    const t = conLlave();
    const a = await put(t.auth, K, { userId: TEC_UNO });
    expect([a.status, a.body]).toEqual([200, { responsable: { userId: TEC_UNO, nombre: 'Técnico Uno', por: t.email, en: '2026-11-19T15:00:00.000Z' } }]);
    expect((await put(t.auth, K, { userId: TEC_DOS })).body.responsable.userId).toBe(TEC_DOS);
    expect(asignados.get(K)?.userId).toBe(TEC_DOS);
    for (let i = 0; i < 2; i++) {
      const d = await request(app()).delete(R(K)).set('Authorization', t.auth);
      expect([d.status, d.body]).toEqual([200, { ok: true }]);
    }
    expect(borradosResp).toEqual([K, K]);
    expect(asignados.size).toBe(0);
  });

  it('un admin puede sin la llave, y firma el token, no lo que mande el cliente', async () => {
    const adm = token({ role: 'admin' });
    expect((await put(adm.auth, K, { userId: TEC_UNO, por: 'otro@ambientalia.com.co', quien: 'otro' })).status).toBe(200);
    expect(firmas).toEqual([{ clave: K, userId: TEC_UNO, quien: { userId: adm.userId, email: adm.email } }]);
  });

  it('422 usuario_sin_app si el usuario no está activo o no tiene la app', async () => {
    const r = await put(conLlave().auth, K, { userId: '00000000-0000-4000-8000-0000000000ff' });
    expect([r.status, r.body.error]).toEqual([422, 'usuario_sin_app']);
    expect(firmas).toEqual([]);
  });

  it('400 si la clave no es de una visita o falta el userId', async () => {
    const a = conLlave().auth;
    for (const mala of ['*1BA9041T', 'pdf:Abcdefghij_-12', "x' OR 1=1", '1BA9041T|2026-02-30']) {
      const r = await put(a, mala, { userId: TEC_UNO });
      expect([mala, r.status, r.body.error]).toEqual([mala, 400, 'invalid_input']);
      expect((await request(app()).delete(R(mala)).set('Authorization', a)).status, mala).toBe(400);
    }
    for (const b of [{}, { userId: 5 }, { userId: 'no-es-uuid' }]) expect((await put(a, K, b)).status, JSON.stringify(b)).toBe(400);
    expect([firmas, borradosResp]).toEqual([[], []]);
  });
});

```

En `apps/hub-api/src/equipos/router-kiosco.test.ts` (T4), reemplazar:

```ts
      ['post', B + '/sync/fin'],
    ];
```

por:

```ts
      ['post', B + '/sync/fin'],
      ['get', B + '/tecnicos'], ['put', B + '/responsables/1BA9041T%7C2026-11-01'], ['delete', B + '/responsables/1BA9041T%7C2026-11-01'],
    ];
```

- [ ] **Step 2: Verlas fallar**

```bash
cd apps/hub-api && npx vitest run src/equipos/router.test.ts src/equipos/router-kiosco.test.ts
```

Esperado: FAIL. Las rutas nuevas dan 404 en vez de 403/200/400/422/401, `responsables` llega `undefined` y T4 recibe 404 en vez de 401 en las tres rutas nuevas.

- [ ] **Step 3: Implementar**

En `apps/hub-api/src/equipos/router.ts`, reemplazar:

```ts
 *   DELETE /equipos-taller/ajustes/:clave   204           (edita_ajustes o admin)
```

por:

```ts
 *   DELETE /equipos-taller/ajustes/:clave   204           (edita_ajustes o admin)
 *   GET    /equipos-taller/tecnicos         { tecnicos }  a quién se puede asignar una visita (edita_ajustes o admin)
 *   PUT    /equipos-taller/responsables/:clave  ← { userId } → { responsable } · 400 · 422 usuario_sin_app (edita_ajustes o admin)
 *   DELETE /equipos-taller/responsables/:clave  → { ok: true }, también si no había asignación (edita_ajustes o admin)
```

Reemplazar:

```ts
import { ajusteValido, APP_ID, claveValida, type RespuestaEquipos } from './contrato.js';
```

por:

```ts
import { ajusteValido, APP_ID, claveValida, claveVisitaValida, type RespuestaEquipos } from './contrato.js';
```

Reemplazar:

```ts
    const [snap, ajustes, enCurso, ultima, ultimaBuena, incidente, llaves, configurado, tablero] = await Promise.all([
      deps.repo.leerFoto(), deps.repo.leerAjustes(), deps.repo.ultimaCorrida(), deps.repo.ultimaCorridaTerminada(), deps.repo.ultimaCorridaBuena(), deps.repo.incidenteAbierto(), deps.repo.llavesDe(q.userId), deps.servicio.configurado(), deps.tablero.ajustes(),
    ]);
```

por:

```ts
    const [snap, ajustes, enCurso, ultima, ultimaBuena, incidente, llaves, configurado, tablero, responsables] = await Promise.all([
      deps.repo.leerFoto(), deps.repo.leerAjustes(), deps.repo.ultimaCorrida(), deps.repo.ultimaCorridaTerminada(), deps.repo.ultimaCorridaBuena(), deps.repo.incidenteAbierto(), deps.repo.llavesDe(q.userId), deps.servicio.configurado(), deps.tablero.ajustes(),
      deps.repo.listarResponsables(),
    ]);
```

Reemplazar:

```ts
      permisos: { ...llaves, esAdmin: q.esAdmin, puedeEditar: q.esAdmin || llaves.editaAjustes },
      tablero,
    };
```

por:

```ts
      permisos: { ...llaves, esAdmin: q.esAdmin, puedeEditar: q.esAdmin || llaves.editaAjustes },
      tablero,
      responsables,
    };
```

Y reemplazar:

```ts
    if (!claveValida(clave)) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Clave no válida' });
    await deps.repo.borrarAjuste(clave);
    res.status(204).end();
  }));
```

por:

```ts
    if (!claveValida(clave)) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Clave no válida' });
    await deps.repo.borrarAjuste(clave);
    res.status(204).end();
  }));

  // Responsable de cada visita: asigna quien tiene la llave «edita ajustes» o es admin (D4), y solo a
  // usuarios activos con la app (D5). La clave es la de UNA visita: ni «*SERIAL» ni «pdf:».
  router.get('/equipos-taller/tecnicos', ...gated, ruta('equipos_tecnicos', async (req, res) => {
    await exigirEditar(req);
    res.set('Cache-Control', 'no-store').json({ tecnicos: await deps.repo.listarTecnicos() });
  }));

  router.put('/equipos-taller/responsables/:clave', ...gated, ruta('equipos_responsable_guardar', async (req, res) => {
    const q = await exigirEditar(req);
    const clave = String(req.params.clave);
    const { userId } = (req.body ?? {}) as { userId?: unknown };
    if (!claveVisitaValida(clave) || typeof userId !== 'string' || !UUID.test(userId)) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Asignación no válida' });
    if (!(await deps.repo.esTecnicoValido(userId))) {
      throw new ErrorRuta(422, { error: 'usuario_sin_app', message: 'Ese usuario no está activo o no tiene la app «Equipos en taller».' });
    }
    // La firma sale del token, nunca del cuerpo.
    const responsable = await deps.repo.guardarResponsable(clave, userId, { userId: q.userId, email: q.email });
    res.json({ responsable });
  }));

  router.delete('/equipos-taller/responsables/:clave', ...gated, ruta('equipos_responsable_borrar', async (req, res) => {
    await exigirEditar(req);
    const clave = String(req.params.clave);
    if (!claveVisitaValida(clave)) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Clave no válida' });
    await deps.repo.borrarResponsable(clave);
    res.json({ ok: true });
  }));
```

- [ ] **Step 4: Verlas pasar (con todo el servidor)**

```bash
cd apps/hub-api && npx vitest run src/equipos scripts
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: PASS en todo `src/equipos` (T1–T8 incluidas) y en `scripts`; `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/hub-api/src/equipos/router.ts apps/hub-api/src/equipos/router.test.ts apps/hub-api/src/equipos/router-kiosco.test.ts
git commit -m "feat(equipos-taller): rutas para listar técnicos y asignar o quitar el responsable"
```

---

### Tarea 7: Cliente de la API de responsables

**Files:**
- Modify: `apps/equipos-taller/src/api.ts` (L6, interfaz L8-14, implementación L58-73)
- Modify: `apps/equipos-taller/src/App.test.tsx` (doble L17-23)
- Modify: `apps/equipos-taller/src/EquiposServicio.test.tsx` (L7, doble L37-49)
- Test: `apps/equipos-taller/src/api.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

En `apps/equipos-taller/src/api.test.ts`, añadir dentro de `describe('apiEquipos', () => {`, justo antes de su `});` final (detrás del test «el error de un 401 lleva su código…»):

```ts
  it('responsables: técnicos, asignar con la clave codificada y quitar', async () => {
    const R = { userId: 'u2', nombre: 'Técnico Dos', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' };
    const { f, pedidos } = falso({
      ['GET ' + B + '/tecnicos']: J({ tecnicos: [{ userId: 'u2', nombre: 'Técnico Dos' }] }),
      ['PUT ' + B + '/responsables/1BA9041T%7C2026-11-01']: J({ responsable: R }),
      ['DELETE ' + B + '/responsables/1BA9041T%7C2026-11-01']: J({ ok: true }),
    });
    const api = apiEquipos(B, f, cab);
    expect(await api.tecnicos()).toEqual([{ userId: 'u2', nombre: 'Técnico Dos' }]);
    expect(await api.asignarResponsable('1BA9041T|2026-11-01', 'u2')).toEqual(R);
    await expect(api.quitarResponsable('1BA9041T|2026-11-01')).resolves.toBeUndefined();
    expect(pedidos.map((p) => p.init.body ?? null)).toEqual([null, '{"userId":"u2"}', null]);
  });
  it('un 422 al asignar lanza el texto fijo del servidor', async () => {
    const msg = 'Ese usuario no está activo o no tiene la app «Equipos en taller».';
    const { f } = falso({ ['PUT ' + B + '/responsables/1BA9041T%7C2026-11-01']: J({ error: 'usuario_sin_app', message: msg }, 422) });
    await expect(apiEquipos(B, f, cab).asignarResponsable('1BA9041T|2026-11-01', 'u9')).rejects.toThrow(msg);
  });
```

- [ ] **Step 2: Verla fallar**

```bash
npm test --workspace=apps/equipos-taller -- src/api.test.ts
```

Esperado: FAIL con `TypeError: api.tecnicos is not a function` y `…asignarResponsable is not a function`.

- [ ] **Step 3: Implementar**

En `apps/equipos-taller/src/api.ts`, reemplazar:

```ts
import type { Ajuste, AjusteFirmado, AjustesTablero, Kiosco, LlavesUsuario, RespuestaEquipos, RespuestaTablero, UsuarioConLlaves } from './nucleo';

export interface ApiEquipos {
  estado(senal?: AbortSignal): Promise<RespuestaEquipos>;
  guardarAjuste(clave: string, t: Ajuste['t'], m?: string): Promise<AjusteFirmado>;
  borrarAjuste(clave: string): Promise<void>;
  llaves(): Promise<UsuarioConLlaves[]>;
  guardarLlaves(userId: string, l: LlavesUsuario): Promise<UsuarioConLlaves>;
}
```

por:

```ts
import type {
  Ajuste, AjusteFirmado, AjustesTablero, Kiosco, LlavesUsuario, ResponsableAsignado, RespuestaEquipos, RespuestaTablero, TecnicoAsignable, UsuarioConLlaves,
} from './nucleo';

export interface ApiEquipos {
  estado(senal?: AbortSignal): Promise<RespuestaEquipos>;
  guardarAjuste(clave: string, t: Ajuste['t'], m?: string): Promise<AjusteFirmado>;
  borrarAjuste(clave: string): Promise<void>;
  llaves(): Promise<UsuarioConLlaves[]>;
  guardarLlaves(userId: string, l: LlavesUsuario): Promise<UsuarioConLlaves>;
  /** A quién se puede asignar una visita (usuarios activos con la app). Solo con la llave «edita ajustes» o admin. */
  tecnicos(): Promise<TecnicoAsignable[]>;
  asignarResponsable(clave: string, userId: string): Promise<ResponsableAsignado>;
  /** Vuelve al Encargado de Desk. Vale también si no había asignación. */
  quitarResponsable(clave: string): Promise<void>;
}
```

Y reemplazar:

```ts
  const k = (clave: string) => '/ajustes/' + encodeURIComponent(clave);
  return {
    estado: (senal) => pedir<RespuestaEquipos>('GET', '', undefined, senal),
```

por:

```ts
  const k = (clave: string) => '/ajustes/' + encodeURIComponent(clave);
  const r = (clave: string) => '/responsables/' + encodeURIComponent(clave);
  return {
    estado: (senal) => pedir<RespuestaEquipos>('GET', '', undefined, senal),
    tecnicos: async () => (await pedir<{ tecnicos: TecnicoAsignable[] }>('GET', '/tecnicos')).tecnicos,
    asignarResponsable: async (clave, userId) => (await pedir<{ responsable: ResponsableAsignado }>('PUT', r(clave), { userId })).responsable,
    quitarResponsable: async (clave) => { await pedir<{ ok: true }>('DELETE', r(clave)); },
```

En `apps/equipos-taller/src/App.test.tsx`, reemplazar:

```ts
  llaves: async () => [],
  guardarLlaves: async () => { throw new Error('no se usa'); },
});
```

por:

```ts
  llaves: async () => [],
  guardarLlaves: async () => { throw new Error('no se usa'); },
  tecnicos: async () => [],
  asignarResponsable: async () => { throw new Error('no se usa'); },
  quitarResponsable: async () => {},
});
```

En `apps/equipos-taller/src/EquiposServicio.test.tsx`, reemplazar:

```ts
import { CAUSA_TEXTOS_FALLIDOS, EST, type Ajuste, type AjusteFirmado, type Corrida, type Fila, type RespuestaEquipos, type UsuarioConLlaves } from './nucleo';
```

por:

```ts
import { CAUSA_TEXTOS_FALLIDOS, EST, type Ajuste, type AjusteFirmado, type Corrida, type Fila, type ResponsableAsignado, type RespuestaEquipos, type UsuarioConLlaves } from './nucleo';
```

Y reemplazar:

```ts
function apiFalsa(o: Partial<RespuestaEquipos> = {}) {
  const e = estado(o);
  const llamadas: string[] = [];
```

por:

```ts
// Dos técnicos con la app a los que se puede asignar una visita (GET /tecnicos).
const TEC_DOS = '00000000-0000-4000-8000-0000000000c2';
const TEC_TRES = '00000000-0000-4000-8000-0000000000c3';
function apiFalsa(o: Partial<RespuestaEquipos> = {}) {
  const e = estado(o);
  const llamadas: string[] = [];
  // Las del responsable van aparte: varias pruebas miran `llamadas[0]` y `tecnicos` se pide al montar.
  const resp: string[] = [];
```

Reemplazar:

```ts
    guardarLlaves: async (userId, l) => { llamadas.push('llaves ' + userId + ' ' + l.editaAjustes + ' ' + l.recibeAlertas); return { ...usuarios[0], ...l }; },
  };
  return { api, llamadas };
}
```

por:

```ts
    guardarLlaves: async (userId, l) => { llamadas.push('llaves ' + userId + ' ' + l.editaAjustes + ' ' + l.recibeAlertas); return { ...usuarios[0], ...l }; },
    tecnicos: async () => { resp.push('tecnicos'); return [{ userId: TEC_DOS, nombre: 'Técnico Dos' }, { userId: TEC_TRES, nombre: 'Técnico Tres' }]; },
    asignarResponsable: async (k, userId) => {
      resp.push('put ' + k + ' ' + userId);
      const r: ResponsableAsignado = { userId, nombre: userId === TEC_DOS ? 'Técnico Dos' : 'Técnico Tres', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' };
      e.responsables = { ...(e.responsables ?? {}), [k]: r };
      return r;
    },
    quitarResponsable: async (k) => {
      resp.push('delete ' + k);
      const m = { ...(e.responsables ?? {}) };
      delete m[k];
      e.responsables = m;
    },
  };
  return { api, llamadas, resp };
}
```

- [ ] **Step 4: Verla pasar**

```bash
npm test --workspace=apps/equipos-taller -- src/api.test.ts src/App.test.tsx src/EquiposServicio.test.tsx
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS (la pantalla aún no usa los métodos nuevos) y `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/equipos-taller/src/api.ts apps/equipos-taller/src/api.test.ts apps/equipos-taller/src/App.test.tsx apps/equipos-taller/src/EquiposServicio.test.tsx
git commit -m "feat(equipos-taller): cliente de la API de responsables"
```

---

### Tarea 8: Selector de responsable en la tabla

**Files:**
- Modify: `apps/equipos-taller/src/EquiposServicio.tsx` (import L9-12, módulo tras `fmt` L27, estado tras L48, `todas` L84, funciones tras `deshacer` L120, celda L157)
- Test: `apps/equipos-taller/src/EquiposServicio.test.tsx`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `apps/equipos-taller/src/EquiposServicio.test.tsx`, la prueba de conteos ya no puede buscar «Técnico Uno» con `getByText`: con permiso, el nombre vive en la opción «De Desk: Técnico Uno» del selector en cuanto llega la lista. Reemplazar:

```ts
    expect(screen.getByText('Técnico Uno')).toBeTruthy();
    expect(screen.getByText('1 aviso en la última ejecución')).toBeTruthy();
```

por:

```ts
    expect((await screen.findByText('18A90001')).closest('tr')!.textContent).toContain('Técnico Uno');
    expect(screen.getByText('1 aviso en la última ejecución')).toBeTruthy();
```

Y añadir al final del fichero:

```ts
describe('responsable asignado desde la tabla', () => {
  const K1 = '1BA90001|2026-06-01'; // claveFila de 18A90001 entrado el 2026-06-01 (serial en clase OCR)
  const ASIGNADO: ResponsableAsignado = { userId: TEC_DOS, nombre: 'Técnico Dos', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' };
  const SIN_PERMISO = { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false };
  const selectorDe = () => screen.findByRole<HTMLSelectElement>('combobox', { name: 'Responsable de 18A90001' });
  const selectorYa = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Responsable de 18A90001' });

  it('sin permiso no hay selector ni se piden los técnicos: solo el nombre, como hoy', async () => {
    const { api, resp } = apiFalsa({ permisos: SIN_PERMISO });
    render(<EquiposServicio api={api} />);
    expect(await screen.findByText('Técnico Uno')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Responsable de/ })).toBeNull();
    expect(resp).toEqual([]);
  });

  it('con permiso, la celda es un selector: «De Desk: <Encargado>» y luego los técnicos con la app, pedidos una vez', async () => {
    const { api, resp } = apiFalsa();
    render(<EquiposServicio api={api} />);
    const s = await selectorDe();
    expect([...s.options].map((x) => x.textContent)).toEqual(['De Desk: Técnico Uno', 'Técnico Dos', 'Técnico Tres']);
    expect(s.value).toBe('');
    expect(resp).toEqual(['tecnicos']);
  });

  it('elegir un técnico lo guarda al momento y la celda lleva quién y cuándo lo asignó', async () => {
    const { api, resp } = apiFalsa();
    render(<EquiposServicio api={api} />);
    fireEvent.change(await selectorDe(), { target: { value: TEC_DOS } });
    await waitFor(() => expect(resp).toContain('put ' + K1 + ' ' + TEC_DOS));
    await waitFor(() => expect(selectorYa().title).toBe('Asignado por Admin Uno el 19/11/2026'));
    expect(selectorYa().value).toBe(TEC_DOS);
  });

  it('la opción «De Desk» quita la asignación', async () => {
    const { api, resp } = apiFalsa({ responsables: { [K1]: ASIGNADO } });
    render(<EquiposServicio api={api} />);
    const s = await selectorDe();
    await waitFor(() => expect(s.value).toBe(TEC_DOS));
    fireEvent.change(s, { target: { value: '' } });
    await waitFor(() => expect(resp).toContain('delete ' + K1));
    expect(selectorYa().value).toBe('');
  });

  it('si el servidor falla, el selector vuelve a lo de antes y avisa (D8)', async () => {
    const { api } = apiFalsa();
    api.asignarResponsable = async () => { throw new Error('Ese usuario no está activo o no tiene la app «Equipos en taller».'); };
    render(<EquiposServicio api={api} />);
    fireEvent.change(await selectorDe(), { target: { value: TEC_TRES } });
    expect(await screen.findByText('No se pudo cambiar el responsable: Ese usuario no está activo o no tiene la app «Equipos en taller».')).toBeTruthy();
    expect(selectorYa().value).toBe('');
  });

  it('si no se pueden cargar los técnicos, la columna se ve como sin permiso y avisa una vez', async () => {
    const { api } = apiFalsa();
    let veces = 0;
    api.tecnicos = async () => { veces++; throw new Error('Error 500'); };
    render(<EquiposServicio api={api} />);
    expect(await screen.findByText('No se pudo cargar la lista de técnicos: Error 500')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /Responsable de/ })).toBeNull();
    expect(screen.getByText('Técnico Uno')).toBeTruthy();
    expect(veces).toBe(1);
  });

  it('sin permiso, el nombre asignado en el portal manda sobre Desk y lleva su firma en el title', async () => {
    render(<EquiposServicio api={apiFalsa({ permisos: SIN_PERMISO, responsables: { [K1]: ASIGNADO } }).api} />);
    const nombre = await screen.findByText('Técnico Dos');
    expect(nombre.getAttribute('title')).toBe('Asignado por Admin Uno el 19/11/2026');
    expect(screen.queryByText('Técnico Uno')).toBeNull();
  });

  it('«Pendiente Asignar» de Desk se ve como «Sin asignar»', async () => {
    const base = estado();
    const rows = base.snap!.rows.map((r) => (r.sn === '18A90001' ? { ...r, z: { ...r.z!, enc: 'Pendiente Asignar' } } : r));
    render(<EquiposServicio api={apiFalsa({ permisos: SIN_PERMISO, snap: { ...base.snap!, rows } }).api} />);
    const tr = (await screen.findByText('18A90001')).closest('tr')!;
    expect(within(tr).getByText('Sin asignar')).toBeTruthy();
    expect(within(tr).queryByText('Pendiente Asignar')).toBeNull();
  });
});
```

- [ ] **Step 2: Verlas fallar**

```bash
npm test --workspace=apps/equipos-taller -- src/EquiposServicio.test.tsx
```

Esperado: FAIL en los tests nuevos de selector, D8, fallo de técnicos, firma y «Sin asignar»: no hay `combobox` «Responsable de 18A90001», la celda pinta `z.enc` en crudo y `tecnicos` no se pide. Las pruebas que ya existían siguen en verde.

- [ ] **Step 3: Implementar**

En `apps/equipos-taller/src/EquiposServicio.tsx`, reemplazar:

```ts
import {
  ADENTRO, EST, VISTAS, TONO, SIN_FILTROS, aplicarAjustes, aplicarFiltros, avisoFoto, claveFila, claveIlegible, dias, enlaceArchivo, enlaceCarpeta,
  filasDeVista, hayFiltros, ilegiblesPendientes, opcionesFiltro, Reglas, type Ajuste, type Fila, type Filtros, type Ilegible, type RespuestaEquipos,
} from './nucleo';
```

por:

```ts
import {
  ADENTRO, EST, VISTAS, TONO, SIN_FILTROS, aplicarAjustes, aplicarFiltros, aplicarResponsables, avisoFoto, claveFila, claveIlegible, claveVisitaValida, dias,
  encargadoDesk, enlaceArchivo, enlaceCarpeta, fechaBogota, filasDeVista, hayFiltros, ilegiblesPendientes, opcionesFiltro, Reglas, responsableDe,
  type Ajuste, type Fila, type Filtros, type Ilegible, type ResponsableAsignado, type RespuestaEquipos, type TecnicoAsignable,
} from './nucleo';
```

Reemplazar:

```ts
const fmt = (d: string) => (d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }) : '');
```

por:

```ts
const fmt = (d: string) => (d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }) : '');
/** «Asignado por <quien> el dd/mm/aaaa» (fecha de Bogotá) de una asignación del portal, o nada. */
function firmaResponsable(r: Fila): string | undefined {
  const ms = r.resp?.en ? Date.parse(r.resp.en) : NaN;
  if (!r.resp?.por || !Number.isFinite(ms)) return undefined;
  const [a, m, d] = fechaBogota(ms).split('-');
  return 'Asignado por ' + r.resp.por + ' el ' + d + '/' + m + '/' + a;
}
```

Reemplazar:

```ts
  const [fl, setFl] = useState<Filtros>(SIN_FILTROS);
```

por:

```ts
  const [fl, setFl] = useState<Filtros>(SIN_FILTROS);
  // A quién se puede asignar una visita (GET /tecnicos): se pide UNA vez, y solo con permiso. null = sin
  // lista (sin permiso, o falló): la columna «Responsable» se ve como sin permiso, solo nombres.
  const [tecnicos, setTecnicos] = useState<TecnicoAsignable[] | null>(null);
  const pidioTecnicos = useRef(false);
```

Reemplazar:

```ts
  const todas = useMemo(() => aplicarAjustes(snap?.rows || [], ajustes), [snap, ajustes]);
```

por:

```ts
  const responsables = datos?.responsables;
  // Mismo encadenado que el tablero y la TV: ajustes manuales y luego el responsable del portal (D7).
  const todas = useMemo(() => aplicarResponsables(aplicarAjustes(snap?.rows || [], ajustes), responsables ?? {}), [snap, ajustes, responsables]);
  useEffect(() => {
    if (!puedeEditar || pidioTecnicos.current) return;
    pidioTecnicos.current = true;
    api.tecnicos().then(setTecnicos, (e: Error) => setAviso('No se pudo cargar la lista de técnicos: ' + e.message));
  }, [puedeEditar, api]);
```

Reemplazar:

```ts
      setDatos((d) => { if (!d) return d; const aj = { ...d.ajustes }; existentes.forEach((k) => delete aj[k]); return { ...d, ajustes: aj }; });
    } catch (e) { setAviso('No se pudo deshacer: ' + (e as Error).message); }
  }
```

por:

```ts
      setDatos((d) => { if (!d) return d; const aj = { ...d.ajustes }; existentes.forEach((k) => delete aj[k]); return { ...d, ajustes: aj }; });
    } catch (e) { setAviso('No se pudo deshacer: ' + (e as Error).message); }
  }
  /** D8: se guarda al elegir. La tabla cambia al momento; si el servidor falla, vuelve a lo de antes y avisa. */
  async function asignar(clave: string, userId: string) {
    const antes = datos?.responsables?.[clave];
    const poner = (r: ResponsableAsignado | undefined) =>
      setDatos((d) => {
        if (!d) return d;
        const m = { ...(d.responsables ?? {}) };
        if (r) m[clave] = r;
        else delete m[clave];
        return { ...d, responsables: m };
      });
    const t = tecnicos?.find((x) => x.userId === userId);
    poner(userId && t ? { userId, nombre: t.nombre, por: '', en: '' } : undefined);
    try {
      if (userId) poner(await api.asignarResponsable(clave, userId));
      else await api.quitarResponsable(clave);
    } catch (e) {
      poner(antes);
      setAviso('No se pudo cambiar el responsable: ' + (e as Error).message);
    }
  }
```

Reemplazar:

```ts
  function filaEquipo(r: Fila) {
```

por:

```ts
  // Columna «Responsable» (D7): el asignado en el portal o el Encargado de Desk; «Pendiente Asignar» se ve
  // «Sin asignar». Con permiso, una clave de visita válida y la lista de técnicos, es un selector que guarda al
  // elegir. Sin eso, solo el nombre, como antes.
  function celdaResponsable(r: Fila, k: string) {
    const ef = responsableDe(r);
    const texto = ef ? ef.nombre : r.z?.enc?.trim() ? 'Sin asignar' : '';
    const firma = firmaResponsable(r);
    if (!puedeEditar || !tecnicos || !claveVisitaValida(k)) return <span title={firma}>{texto}</span>;
    const elegido = ef?.origen === 'portal' && ef.userId ? ef.userId : '';
    // Una asignación vigente siempre es de alguien de la lista; si la lista se quedó vieja, no se pierde.
    const opciones = elegido && !tecnicos.some((x) => x.userId === elegido) ? [...tecnicos, { userId: elegido, nombre: ef?.nombre ?? '' }] : tecnicos;
    return (
      <select aria-label={'Responsable de ' + r.sn} title={firma} value={elegido} onChange={(e) => void asignar(k, e.target.value)}
        className="max-w-[14rem] rounded border border-slate-300 bg-white px-1 py-0.5 text-sm">
        <option value="">{'De Desk: ' + (encargadoDesk(r) || 'sin asignar')}</option>
        {opciones.map((x) => <option key={x.userId} value={x.userId}>{x.nombre}</option>)}
      </select>
    );
  }

  function filaEquipo(r: Fila) {
```

Y reemplazar:

```tsx
        <td className="px-2 py-2">{z?.enc || ''}</td>
```

por:

```tsx
        <td className="px-2 py-2">{celdaResponsable(r, k)}</td>
```

- [ ] **Step 4: Verlas pasar**

```bash
npm test --workspace=apps/equipos-taller -- src/EquiposServicio.test.tsx src/App.test.tsx
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS en los dos ficheros, también en el refresco de 60 s y en «Sigue en taller», que sigue mirando `llamadas[0]`. `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/equipos-taller/src/EquiposServicio.tsx apps/equipos-taller/src/EquiposServicio.test.tsx
git commit -m "feat(equipos-taller): selector de responsable en la tabla para quien edita ajustes"
```

---

### Tarea 9: El tablero y la TV con sesión muestran el responsable del portal

**Files:**
- Modify: `apps/equipos-taller/src/tablero/Tablero.tsx` (L5-8 y `useTableroDatos` L171-174)
- Test: `apps/equipos-taller/src/tablero/Tablero.test.tsx`

`useTableroDatos` alimenta la pestaña «Tablero», la TV con sesión (`TvSesion`) y «Mis equipos». La TV con llave ya la cubrió la Tarea 5.

- [ ] **Step 1: Escribir la prueba que falla**

En `apps/equipos-taller/src/tablero/Tablero.test.tsx`, reemplazar:

```ts
import {
  AJUSTES_TABLERO_POR_DEFECTO, EST, aplicarAjustes, construirTablero,
  type AjustesTablero, type Fila, type RespuestaEquipos,
} from '../nucleo';
```

por:

```ts
import {
  AJUSTES_TABLERO_POR_DEFECTO, EST, aplicarAjustes, claveFila, construirTablero,
  type AjustesTablero, type Fila, type RespuestaEquipos,
} from '../nucleo';
```

Y añadir dentro de `describe('Tablero (con sondeo)', () => {`, justo antes de `  it('al desmontar no deja temporizadores', async () => {`:

```ts
  it('muestra al responsable asignado en el portal, aunque Desk diga otro (D7)', async () => {
    const responsables = { [claveFila(FILAS[0])]: { userId: '00000000-0000-4000-8000-0000000000c2', nombre: 'Técnico Dos', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' } };
    render(<Tablero api={apiCon(resp({ responsables }))} />);
    await avanzar(0);
    const t = within(screen.getByRole('article', { name: 'Equipo 18A90001' }));
    expect(t.getByText('Técnico Dos')).toBeTruthy();
    expect(t.getByText('TD')).toBeTruthy();
    expect(t.queryByText('Técnico Uno')).toBeNull();
  });
```

- [ ] **Step 2: Verla fallar**

```bash
npm test --workspace=apps/equipos-taller -- src/tablero/Tablero.test.tsx
```

Esperado: FAIL: no encuentra «Técnico Dos» en la tarjeta, que sigue con «Técnico Uno» de Desk.

- [ ] **Step 3: Implementar**

En `apps/equipos-taller/src/tablero/Tablero.tsx`, reemplazar:

```ts
import {
  AJUSTES_TABLERO_POR_DEFECTO, aplicarAjustes, construirTablero, horaBogota,
```

por:

```ts
import {
  AJUSTES_TABLERO_POR_DEFECTO, aplicarAjustes, aplicarResponsables, construirTablero, horaBogota,
```

Y reemplazar:

```ts
  const modelo = useMemo(
    () => (datos && snap ? construirTablero(aplicarAjustes(snap.rows, datos.ajustes), ajustes, ahora) : null),
    [datos, snap, ajustes, ahora],
  );
```

por:

```ts
  const modelo = useMemo(
    // Mismo encadenado que la tabla y la TV con llave: ajustes manuales y luego el responsable del portal (D7).
    () => (datos && snap ? construirTablero(aplicarResponsables(aplicarAjustes(snap.rows, datos.ajustes), datos.responsables ?? {}), ajustes, ahora) : null),
    [datos, snap, ajustes, ahora],
  );
```

- [ ] **Step 4: Verla pasar (también la TV y los colores)**

```bash
npm test --workspace=apps/equipos-taller -- src/tablero src/TvEquipos.test.tsx src/MisEquipos.test.tsx
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS, con `tablero.css.test.ts` y `temas.test.ts` en verde (no hay colores nuevos), y `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/equipos-taller/src/tablero/Tablero.tsx apps/equipos-taller/src/tablero/Tablero.test.tsx
git commit -m "feat(equipos-taller): el tablero y la TV con sesión muestran el responsable del portal"
```

---

### Tarea 10: «Mis equipos» reconoce las asignaciones del portal por la cuenta

**Files:**
- Modify: `apps/equipos-taller/src/tecnico.ts`
- Modify: `apps/equipos-taller/src/MisEquipos.tsx` (L1-3, L9, L55, L66-69, L94)
- Test: `apps/equipos-taller/src/tecnico.test.ts`
- Test: `apps/equipos-taller/src/MisEquipos.test.tsx`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `apps/equipos-taller/src/tecnico.test.ts`, reemplazar:

```ts
import { coincideTecnico } from './tecnico';
```

por:

```ts
import type { Tablero, Tarjeta } from './nucleo';
import { coincideTecnico, esMia, tecnicosDelTablero } from './tecnico';

const tarjeta = (tecnico: Tarjeta['tecnico']): Tarjeta => ({
  clave: '1BA9041T|2026-11-01', sn: '18A90417', equipo: 'EDM180C', cliente: 'CLIENTE A', entrada: '2026-11-01', dias: 18, tono: 'verde',
  etiquetas: [], tecnico, ticket: '1001', pie: tecnico ? 'tecnico' : 'sin_asignar',
});
const deDesk = (nombre: string) => tarjeta({ nombre, iniciales: 'XX', avatar: 0 });
const delPortal = (nombre: string, userId: string) => tarjeta({ nombre, iniciales: 'XX', avatar: 0, userId });
```

Y añadir al final del fichero:

```ts
describe('esMia', () => {
  it('con asignación del portal, por la cuenta aunque el nombre no coincida', () => {
    expect(esMia(delPortal('Nombre En Cuenta', 'u-yo'), { userId: 'u-yo', nombre: 'Otro Nombre' })).toBe(true);
    expect(esMia(delPortal('Nombre En Cuenta', 'u-yo'), { userId: 'u-yo', nombre: null })).toBe(true);
  });
  it('si el portal la asignó a otra cuenta, no es tuya aunque el nombre coincida', () => {
    expect(esMia(delPortal('María Pérez Gómez', 'u-otro'), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(false);
    expect(esMia(delPortal('María Pérez Gómez', 'u-otro'), { userId: null, nombre: 'María Pérez Gómez' })).toBe(false);
  });
  it('sin asignación del portal, como antes: el nombre frente al Encargado de Desk', () => {
    expect(esMia(deDesk('maria perez gomez'), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(true);
    expect(esMia(deDesk('Técnico Dos'), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(false);
    expect(esMia(deDesk('Técnico Dos'), { userId: 'u-yo', nombre: null })).toBe(false);
    expect(esMia(tarjeta(null), { userId: 'u-yo', nombre: 'María Pérez Gómez' })).toBe(false);
  });
});

describe('tecnicosDelTablero', () => {
  it('solo los nombres de Desk: las asignaciones del portal se reconocen por la cuenta, no por «¿Quién eres?»', () => {
    const t: Tablero = { kpis: [], columnas: [{ id: 'proceso', nombre: 'En proceso', descripcion: '', tarjetas: [deDesk('Técnico Uno'), delPortal('Técnico Dos', 'u2'), deDesk('TECNICO UNO')] }] };
    expect(tecnicosDelTablero(t)).toEqual(['Técnico Uno']);
  });
});
```

En `apps/equipos-taller/src/MisEquipos.test.tsx`, reemplazar:

```ts
import { EST, type Fila, type RespuestaEquipos } from './nucleo';
```

por:

```ts
import { EST, claveFila, type Fila, type RespuestaEquipos } from './nucleo';
```

Y añadir, justo antes de `describe('MisEquipos: lista y cabecera', () => {`:

```ts
describe('MisEquipos: asignación del portal (por la cuenta)', () => {
  const asignado = (userId: string, nombre: string) => ({ userId, nombre, por: 'Admin Uno', en: '2026-11-11T15:00:00.000Z' });

  it('encuentra la tarjeta por userId aunque el nombre no coincida, sin preguntar «¿Quién eres?»', async () => {
    const filas = [...FILAS, fila('18A90008', '2026-11-05', 'Ingresado', '')];
    const r: RespuestaEquipos = { ...resp(filas), responsables: { [claveFila(filas[5])]: asignado('u-yo', 'Nombre En Cuenta') } };
    render(<MisEquipos nombre="Alguien Más" userId="u-yo" pedir={vi.fn(async () => structuredClone(r))} />);
    await listo();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Equipo 18A90008']);
    expect(screen.queryByRole('group', { name: '¿Quién eres?' })).toBeNull();
  });

  it('si el portal asignó la visita a otra cuenta, no te aparece aunque el nombre coincida y Desk diga que es tuya', async () => {
    const r: RespuestaEquipos = { ...resp(), responsables: { [claveFila(FILAS[0])]: asignado('u-otro', UNO) } };
    render(<MisEquipos nombre={UNO} userId="u-yo" pedir={vi.fn(async () => structuredClone(r))} />);
    await listo();
    expect(screen.queryByLabelText('Equipo 18A90001')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});

```

- [ ] **Step 2: Verlas fallar**

```bash
npm test --workspace=apps/equipos-taller -- src/tecnico.test.ts src/MisEquipos.test.tsx
```

Esperado: FAIL. `esMia` no existe (`TypeError: esMia is not a function`) y `tecnicosDelTablero` aún devuelve `['Técnico Dos', 'Técnico Uno']`. En «Mis equipos», la primera prueba no encuentra ningún `article` y la segunda ve 4 tarjetas (casa por nombre).

- [ ] **Step 3: Implementar**

En `apps/equipos-taller/src/tecnico.ts`, reemplazar todo el contenido por:

```ts
// Identidad del técnico en «Mis equipos». Una visita asignada en el portal es de la CUENTA a la que se asignó
// (`tecnico.userId`). Las demás se reconocen como antes: el nombre del usuario frente al Encargado de Desk, sin
// importar mayúsculas, tildes ni espacios (D16). Sin escrituras ni tabla de equivalencias.
import { Reglas, type Tablero, type Tarjeta } from './nucleo';

const nkey = Reglas.nkey;

const palabras = (n: string): Set<string> => new Set(nkey(n).split(' ').filter(Boolean));

/** Mismas palabras, o las del nombre más corto (2 o más) están todas en el más largo. */
export function coincideTecnico(a: string, b: string): boolean {
  const [x, y] = [palabras(a), palabras(b)].sort((p, q) => p.size - q.size);
  if (x.size === 0) return false;
  if (x.size === y.size) return [...x].every((p) => y.has(p));
  return x.size >= 2 && [...x].every((p) => y.has(p));
}

/**
 * Nombres distintos (por clave normalizada) de los técnicos de DESK con tarjetas, en orden alfabético. Las
 * asignadas en el portal no entran: se reconocen por la cuenta, no por «¿Quién eres?».
 */
export function tecnicosDelTablero(t: Tablero): string[] {
  const vistos = new Map<string, string>();
  for (const c of t.columnas) {
    for (const k of c.tarjetas) {
      if (k.tecnico && !k.tecnico.userId && !vistos.has(nkey(k.tecnico.nombre))) vistos.set(nkey(k.tecnico.nombre), k.tecnico.nombre);
    }
  }
  return [...vistos.values()].sort((p, q) => p.localeCompare(q, 'es'));
}

/** Las tarjetas del técnico `nombre` (igualdad de clave normalizada). */
export const esDe = (k: Tarjeta, nombre: string): boolean => !!k.tecnico && nkey(k.tecnico.nombre) === nkey(nombre);

/**
 * ¿Es mía esta tarjeta? Con asignación del portal, solo si es de mi cuenta (aunque Desk o el nombre digan otra
 * cosa). Sin ella, por el nombre elegido o reconocido, como antes.
 */
export function esMia(k: Tarjeta, yo: { userId: string | null; nombre: string | null }): boolean {
  if (k.tecnico?.userId) return yo.userId !== null && k.tecnico.userId === yo.userId;
  return yo.nombre !== null && esDe(k, yo.nombre);
}
```

En `apps/equipos-taller/src/MisEquipos.tsx`, reemplazar:

```ts
// «Mis equipos»: vista de solo lectura, pensada para el celular, de los equipos de un técnico. Reutiliza el
// sondeo y el modelo del tablero (no duplica reglas) y filtra las tarjetas por el nombre del técnico.
// El nombre del usuario entra por `nombre` (lo da el portal); sin coincidencia única se pregunta «¿Quién eres?».
```

por:

```ts
// «Mis equipos»: vista de solo lectura, pensada para el celular, de los equipos de un técnico. Reutiliza el
// sondeo y el modelo del tablero (no duplica reglas). Una visita asignada en el portal es tuya si se asignó a tu
// cuenta (`userId`). Las demás, por tu nombre frente al Encargado de Desk. Los dos datos los da el portal; sin
// coincidencia única de nombre se pregunta «¿Quién eres?».
```

Reemplazar:

```ts
import { coincideTecnico, esDe, tecnicosDelTablero } from './tecnico';
```

por:

```ts
import { coincideTecnico, esMia, tecnicosDelTablero } from './tecnico';
```

Reemplazar:

```ts
export default function MisEquipos({ nombre, pedir: pedirProp }: { nombre: string | null; pedir?: (s: AbortSignal) => ReturnType<ReturnType<typeof apiEquipos>['estado']> }) {
```

por:

```ts
export default function MisEquipos({ nombre, userId = null, pedir: pedirProp }: {
  nombre: string | null;
  /** La cuenta del usuario: reconoce las visitas que el portal le asignó aunque su nombre no coincida. */
  userId?: string | null;
  pedir?: (s: AbortSignal) => ReturnType<ReturnType<typeof apiEquipos>['estado']>;
}) {
```

Reemplazar:

```ts
  const grupos = elegido
    ? modelo.columnas.map((c) => ({ ...c, tarjetas: c.tarjetas.filter((t) => esDe(t, elegido)) })).filter((c) => c.tarjetas.length > 0)
    : [];
```

por:

```ts
  const grupos = modelo.columnas
    .map((c) => ({ ...c, tarjetas: c.tarjetas.filter((t) => esMia(t, { userId, nombre: elegido })) }))
    .filter((c) => c.tarjetas.length > 0);
```

Y reemplazar:

```tsx
      {!elegido || todas.length === 0 || cambiando ? <Selector nombres={nombres} onElegir={elegir} /> : null}
```

por:

```tsx
      {todas.length === 0 || cambiando ? <Selector nombres={nombres} onElegir={elegir} /> : null}
```

(Sin asignaciones del portal, `!elegido` implica `todas.length === 0`: el comportamiento de antes no cambia.)

- [ ] **Step 4: Verlas pasar**

```bash
npm test --workspace=apps/equipos-taller -- src/tecnico.test.ts src/MisEquipos.test.tsx
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS (las pruebas de identidad, lista, navegación y escáner que ya existían siguen en verde) y `tsc` sin errores.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/equipos-taller/src/tecnico.ts apps/equipos-taller/src/tecnico.test.ts apps/equipos-taller/src/MisEquipos.tsx apps/equipos-taller/src/MisEquipos.test.tsx
git commit -m "feat(equipos-taller): «Mis equipos» reconoce las asignaciones del portal por la cuenta"
```

---

### Tarea 11: `RutaMisEquipos` manda el id del usuario

**Files:**
- Modify: `apps/portal/src/components/RutaMisEquipos.tsx` (L13-18)
- Test: `apps/portal/src/components/RutaMisEquipos.test.tsx`

`Profile` (`apps/portal/src/hooks/useProfile.ts`) ya trae `id` (de `GET /api/users/me`).

- [ ] **Step 1: Escribir la prueba que falla**

En `apps/portal/src/components/RutaMisEquipos.test.tsx`, reemplazar:

```ts
const estado = vi.hoisted(() => ({ auth: null as AuthState | null, sesion: true, perfil: { profile: { full_name: 'María Pérez Gómez' } as { full_name: string } | null, loading: false }, montada: vi.fn() }));
```

por:

```ts
const estado = vi.hoisted(() => ({ auth: null as AuthState | null, sesion: true, perfil: { profile: { id: 'u-perfil', full_name: 'María Pérez Gómez' } as { id: string; full_name: string } | null, loading: false }, montada: vi.fn() }));
```

Reemplazar:

```ts
  default: ({ nombre }: { nombre: string | null }) => { estado.montada(); return <div>{`MIS EQUIPOS DE ${nombre}`}</div>; },
```

por:

```ts
  default: ({ nombre, userId }: { nombre: string | null; userId?: string | null }) => { estado.montada(); return <div>{`MIS EQUIPOS DE ${nombre} (${userId})`}</div>; },
```

Reemplazar:

```ts
afterEach(() => { cleanup(); vi.clearAllMocks(); estado.sesion = true; estado.perfil = { profile: { full_name: 'María Pérez Gómez' }, loading: false }; });
```

por:

```ts
afterEach(() => { cleanup(); vi.clearAllMocks(); estado.sesion = true; estado.perfil = { profile: { id: 'u-perfil', full_name: 'María Pérez Gómez' }, loading: false }; });
```

Y reemplazar:

```ts
  it('con sesión y la app asignada monta la vista con el nombre del perfil', async () => {
    estado.auth = auth(['equipos-taller']);
    montar();
    expect(await screen.findByText('MIS EQUIPOS DE María Pérez Gómez')).toBeTruthy();
  });
```

por:

```ts
  it('con sesión y la app asignada monta la vista con el nombre y la cuenta del perfil', async () => {
    estado.auth = auth(['equipos-taller']);
    montar();
    expect(await screen.findByText('MIS EQUIPOS DE María Pérez Gómez (u-perfil)')).toBeTruthy();
  });
```

- [ ] **Step 2: Verla fallar**

```bash
npm test --workspace=apps/portal -- src/components/RutaMisEquipos.test.tsx
```

Esperado: FAIL: la vista pinta `MIS EQUIPOS DE María Pérez Gómez (undefined)`.

- [ ] **Step 3: Implementar**

En `apps/portal/src/components/RutaMisEquipos.tsx`, reemplazar:

```tsx
/** Espera al perfil propio: sin él, la vista preguntaría «¿Quién eres?» aunque el nombre coincida. */
function ConPerfil() {
  const { profile, loading } = useProfile();
  if (loading) return cargando;
  return <MisEquipos nombre={profile?.full_name ?? null} />;
}
```

por:

```tsx
/**
 * Espera al perfil propio: sin él, la vista preguntaría «¿Quién eres?» aunque el nombre coincida. Manda el
 * nombre (para los equipos de Desk) y la cuenta (para los que el portal asignó a este usuario).
 */
function ConPerfil() {
  const { profile, loading } = useProfile();
  if (loading) return cargando;
  return <MisEquipos nombre={profile?.full_name ?? null} userId={profile?.id ?? null} />;
}
```

Y reemplazar:

```tsx
 * superior). Requiere sesión y la app «equipos-taller»; el nombre sale de `GET /api/users/me`.
```

por:

```tsx
 * superior). Requiere sesión y la app «equipos-taller»; el nombre y el id salen de `GET /api/users/me`.
```

- [ ] **Step 4: Verla pasar y compilar el portal**

```bash
npm test --workspace=apps/portal -- src/components/RutaMisEquipos.test.tsx
npm run build --workspace=apps/portal; echo "exit=$?"
```

Esperado: PASS, y el build termina con `exit=0`. Comprobar el código de salida aunque se lea «built in»: en Windows ya apareció una vez un cierre `0xC0000409` justo después. Si sale distinto de 0, repetir el build; si persiste, es un fallo real.

- [ ] **Step 5: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add apps/portal/src/components/RutaMisEquipos.tsx apps/portal/src/components/RutaMisEquipos.test.tsx
git commit -m "feat(portal): «Mis equipos» recibe el id del usuario además del nombre"
```

---

### Tarea 12: Documentación de operación y de la sub-app

**Files:**
- Modify: `docs/equipos-taller.md` (L9, tras L120, L130 y tras L145)
- Modify: `apps/equipos-taller/CLAUDE.md` (tras L23)

Documentación pasiva: la comprobación es releerla (Step 3), sin prueba automática.

- [ ] **Step 1: `docs/equipos-taller.md`**

Reemplazar:

```markdown
- **Datos:** `portal.equipos_*` (migraciones 071, 072 y 073). Para psql: `portal.equipos_v_equipos` y `portal.equipos_v_remisiones_ilegibles`.
```

por:

```markdown
- **Datos:** `portal.equipos_*` (migraciones 071 a 075 y 078). Para psql: `portal.equipos_v_equipos` y `portal.equipos_v_remisiones_ilegibles`.
```

Reemplazar:

```markdown
## Tablero kanban
```

por:

````markdown
**Responsable** (19/11/2026; diseño `docs/superpowers/specs/2026-11-19-equipos-responsable-design.md`). La columna muestra, por este orden (`responsableDe` en `nucleo/pantalla.ts`: la misma regla en la tabla, el tablero, la TV y «Mis equipos»):

1. la persona asignada en el portal a esa visita, si sigue activa y con la app;
2. si no, el Encargado del ticket en Desk 2.0;
3. «Pendiente Asignar» de Desk se ve «Sin asignar».

- Quien tiene la llave «edita ajustes» (o es admin) ve un selector. «De Desk: <Encargado>» quita la asignación; debajo están los usuarios activos con la app. Se guarda al elegir; si falla, vuelve a lo de antes y avisa. Sin permiso, o en una visita con el serial ilegible, solo se ve el nombre. Un nombre asignado en el portal lleva en el `title` quién lo asignó y cuándo.
- La asignación es **por visita** (`portal.equipos_responsable`, migración 078): si el equipo vuelve al taller, la entrada nueva empieza sin asignación.
- Desk 2.0 no cambia: el portal y Desk pueden mostrar personas distintas para el mismo equipo.
- Si el usuario asignado deja de estar activo o pierde la app, la visita vuelve a mostrar el Encargado de Desk; si la recupera, su asignación vuelve a contar. Si se borra el usuario, se borran sus asignaciones.
- Si dos personas asignan a la vez, gana la última; la otra lo ve en el siguiente refresco de 60 s.
- La TV con llave solo recibe el nombre: ni la cuenta, ni quién asignó, ni cuándo.
- `responsables` viaja en `GET /api/equipos-taller`: hub-api (078) se despliega antes que el portal.

```sql
-- Asignaciones guardadas (las de usuarios inactivos o sin la app están, pero no cuentan).
SELECT r.clave, u.full_name, u.status, r.asignado_por, r.asignado_en
  FROM portal.equipos_responsable r JOIN portal.users u ON u.id = r.user_id
 ORDER BY r.asignado_en DESC;
```

## Tablero kanban
````

Reemplazar:

```markdown
| `/equipos-taller/mis-equipos` | «Mis equipos» en el móvil: los equipos del técnico, agrupados por columna. Le reconoce por el nombre del portal; si no coincide con ningún responsable de Desk, o con varios, pregunta «¿Quién eres?» y el móvil lo recuerda. Sin botones de cambio de estado. |
```

por:

```markdown
| `/equipos-taller/mis-equipos` | «Mis equipos» en el móvil: los equipos del técnico, agrupados por columna. Una visita asignada en el portal es suya si se asignó a su cuenta (aunque el nombre no coincida), y de nadie más. Las demás se reconocen por el nombre del portal frente al Encargado de Desk; si no coincide con ninguno, o con varios, pregunta «¿Quién eres?» y el móvil lo recuerda. Sin botones de cambio de estado. |
```

Reemplazar:

```markdown
| Ajustes manuales («Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste», «Ya revisada») | La llave `edita_ajustes`, o ser admin. |
```

por:

```markdown
| Ajustes manuales («Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste», «Ya revisada») | La llave `edita_ajustes`, o ser admin. |
| Asignar el responsable de una visita (columna «Responsable» de la tabla) | La llave `edita_ajustes`, o ser admin. Solo a usuarios **activos** con la app: un admin sin la app no aparece. |
```

- [ ] **Step 2: `apps/equipos-taller/CLAUDE.md`**

Reemplazar:

```markdown
  - Servidor: `servicio-tablero.ts`, `repo-tablero.ts`, `router-kiosco.ts` (la ÚNICA ruta que acepta la llave de kiosco) y migraciones 074 y 075 (tema de la TV). Operación: `docs/equipos-taller-kiosco.md`.
```

por:

```markdown
  - Servidor: `servicio-tablero.ts`, `repo-tablero.ts`, `router-kiosco.ts` (la ÚNICA ruta que acepta la llave de kiosco) y migraciones 074 y 075 (tema de la TV). Operación: `docs/equipos-taller-kiosco.md`.
- **Responsable asignado desde la tabla** (diseño `docs/superpowers/specs/2026-11-19-equipos-responsable-design.md`):
  - Regla única en el núcleo (D7): `responsableDe` y `aplicarResponsables`, en `nucleo/pantalla.ts`. `aplicarResponsables` va SIEMPRE detrás de `aplicarAjustes`: en la tabla, en `useTableroDatos` (tablero, TV con sesión y «Mis equipos») y en `armarRespuestaTablero` (TV con llave, que solo recibe el nombre).
  - Servidor: `portal.equipos_responsable` (migración 078, una fila por visita); `repo.ts` (`listarResponsables`, `guardarResponsable`, `borrarResponsable`, `listarTecnicos`, `esTecnicoValido`); y las rutas `GET /tecnicos` y `PUT|DELETE /responsables/:clave` de `router.ts` (llave «edita ajustes» o admin).
  - Pantalla: la misma columna «Responsable» de siempre; el selector solo aparece con permiso. «Mis equipos» (`tecnico.ts`, `esMia`): con asignación del portal, por la cuenta (`userId`, que manda `RutaMisEquipos`); sin ella, por el nombre como antes.
```

- [ ] **Step 3: Releer los dos ficheros**

Releer las secciones tocadas en los dos ficheros: que las tablas Markdown sigan con el mismo número de columnas y que el bloque `sql` cierre bien.

- [ ] **Step 4: Privacidad y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git add docs/equipos-taller.md apps/equipos-taller/CLAUDE.md
git commit -m "docs(equipos-taller): responsable asignado desde la tabla"
```

---

### Tarea 13: Verificación final y despliegue

**Files:** ninguno (solo comprobaciones).

- [ ] **Step 1: Todas las suites**

```bash
cd apps/hub-api && npx vitest run src/equipos scripts src/users/password-reset/migracion.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos
cd apps/hub-api && npx vitest run
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
npm test --workspace=apps/equipos-taller
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
npm test --workspace=apps/portal -- src/components/RutaMisEquipos.test.tsx src/components/RutaTableroTv.test.tsx
npm run build --workspace=apps/portal; echo "exit=$?"
```

Esperado:
- todo PASS y `exit=0` en el build del portal;
- el `vitest run` completo de hub-api, sin `*.db.test.ts`: si solo cae el 4.4 de `users` por tiempo agotado bajo carga, es el fallo conocido; se relanza ese fichero solo y debe pasar;
- `router-kiosco.test.ts` con T1–T8 en verde y `nucleo/pureza.test.ts` en verde.

- [ ] **Step 2: Privacidad, en un comando aparte, antes de empujar**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

```bash
git status --short
git log --oneline main..feat/equipos-responsable
git diff --stat main..feat/equipos-responsable
```

Esperado:
- la verificación dice `Sin valores reales en: …`;
- `git status` solo muestra lo que ya era del usuario: ` M .gitignore` y `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`;
- el diff solo toca los ficheros del mapa de archivos y el diseño;
- nada de `fixtures-reales/` ni `apps/equipos-desk2/`.

- [ ] **Step 3: Empujar (rama → fast-forward a `main` → push)**

```bash
git checkout main
git merge --ff-only feat/equipos-responsable
git push origin main
git checkout feat/equipos-responsable
```

Los cambios sin commitear del usuario (`.gitignore` y las carpetas sin seguimiento) viajan intactos entre ramas: **no** hacer `git stash`. Si `--ff-only` falla porque `main` avanzó, parar y avisar; no hacer merge ni rebase por cuenta propia.

- [ ] **Step 4: Nota de despliegue para el usuario (empujar no despliega)**

1. **EasyPanel → hub-api primero.** Aplica la migración 078 al arrancar y empieza a mandar `responsables` y a servir `/tecnicos` y `/responsables/:clave`.
2. **Después, el portal.** Si se despliega antes, la tabla funciona igual (`responsables` es opcional), pero con permiso el selector no carga: `/tecnicos` daría 404 y la tabla avisaría «No se pudo cargar la lista de técnicos».
3. **Prueba en el navegador:**
   - con la llave «edita ajustes», asignar una visita y volver a «De Desk»;
   - comprobar el `title` «Asignado por…»;
   - ver el nombre en el Tablero y en la TV (con sesión y con llave);
   - abrir «Mis equipos» con la cuenta asignada.
4. **Nada que sembrar:** la 078 no crea asignaciones. Solo aparecen como técnicos los usuarios activos con la app «Equipos en taller».
