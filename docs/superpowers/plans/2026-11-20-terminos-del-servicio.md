# Condiciones de uso y tratamiento de datos — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el portal publique sus condiciones de uso y su política de tratamiento de datos
personales (v1.0) y guarde constancia de quién las aceptó, qué versión y cuándo.

**Architecture:** hub-api añade la tabla `portal.terms_acceptances` (migración 079), la constante
`CURRENT_TERMS_VERSION` (`users/terms.ts`), `terms: { current, accepted }` en `GET /api/users/me`
(con una consulta APARTE: la del perfil no se toca), `POST /api/users/me/terms { version }` y un
`termsVersion` opcional en `POST /api/auth/register` que nunca tumba el registro. En el portal, el
texto vive como datos en `src/legal/terminos.ts` y lo pinta la página pública `/terminos`.
`useAuth` guarda el `terms` de la MISMA respuesta de `/users/me` que ya trae las apps en un
almacén de módulo (`lib/terminosSesion.ts`), y `RequireAuth` pasa por `AceptacionTerminos`, que
cambia el contenido por la pantalla de aceptación solo cuando hub-api dice `accepted: false`. Dos
candados: el de versión (hub-api lee el fichero del portal como texto) y el de huecos `[…]` (portal).

**Tech Stack:** hub-api (Express 4, TypeScript ESM con imports `.js`, PostgreSQL vía
`@algarpibe/zoho-sync`, Vitest 2 + supertest; Testcontainers para los `*.db.test.ts`); portal
(React 19, react-router-dom 7, Tailwind 3.4, lucide-react, Vitest 4 + jsdom + Testing Library con
`fireEvent`).

**Spec:** `docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md` (el texto que se
publica es el de su Anexo, tal cual).
**Rama:** `feat/terminos`, rama corta en la copia principal (Task 0). Sin worktree ni `npm ci`: la
copia principal ya tiene `node_modules`.

---

## Desvíos durante la ejecución (2026-11-21)

Lo que se hizo distinto o además de lo que dicen las tareas de más abajo (las tareas no se
reescriben), todo a raíz de las revisiones:

- **079 (Task 1):** `portal_app` solo lee e inserta: `GRANT SELECT, INSERT` + `REVOKE UPDATE, DELETE,
  TRUNCATE`, como la 070, porque la 068 vuelve a dar todo en cada arranque. La cascada funciona sin
  DELETE (Postgres la ejecuta como dueño de la tabla). Lo vigilan `db.roles.db.test.ts` (primer
  arranque y arranques siguientes) y un test de fecha que ya no puede pasar por casualidad.
- **`/users/me` (Task 2):** si falla solo la consulta de las condiciones, devuelve el perfil sin
  `terms` (no un 500); `terms` es opcional. Más candados: comparación estricta de la versión y la
  cuenta sale solo del JWT.
- **Texto legal y página (Task 3):** el candado compara el texto entero con el Anexo en los dos
  sentidos y en orden, y exige el ancho de cada fila; las tablas de dos columnas no tienen ancho
  mínimo, las regiones con scroll son enfocables y con nombre, la primera celda es cabecera de fila;
  título de pestaña, enlace «Volver al portal» y `mailto:` en el correo. El regex del candado de
  versión (Task 4) se ancló al inicio de línea porque un comentario citaba la declaración.
- **Almacén de sesión (Task 5):** test del cambio de cuenta en la misma pestaña.
- **Pantalla (Task 6):** solo aparece si `terms.current === TERMS_VERSION` (si hub-api va por
  delante, aceptar daría 400 sin salida); repinta con un contador (una segunda aceptación en el mismo
  montaje se quedaba pegada); sin aviso genérico ante un 401 (el interceptor ya manda a iniciar
  sesión); foco en el título, orden de tabulación igual al visual y «(se abre en una pestaña nueva)»
  en el enlace.
- **Casilla y Ajustes (Task 7):** el enlace de Ajustes lleva el mismo aviso de pestaña nueva; el del
  registro no, porque quedaba dentro del nombre accesible de la casilla.
- **Texto v1.0 corregido antes de publicar (revisión final, aprobado por el usuario):** §2.2 (cargo y
  notas de los administradores), §2.4 (qué muestra el calendario compartido), §2.5 (Google Calendar y
  Sheets con los datos de Ausencias) y §2.8 (la foto se guarda mientras exista la cuenta).
- **Norma de uso:** a quien deja la compañía se le desactiva la cuenta, no se elimina (spec §4).
- **Fecha y contacto (Task 8):** fecha de vigencia 24 de noviembre de 2026; la dirección de contacto
  la escribió el usuario a mano.

**Seguimientos (no bloquean):** si el calendario compartido debe decir «Ausencia» en vez de
«Incapacidad» (revisión legal, cambio en Ausencias); la autorización separada de los soportes (v1.1);
el borrado a los 3 años; vigilar el limitador de `/users/*` el día del despliegue.

---

## Reglas para quien implemente

- **TDD estricto:** cada test se ve en ROJO, y por la razón esperada, antes de escribir el código.
  Los candados que ya pasan al escribirlos (Task 4) se hacen morder con una mutación y se deshace.
- **Dos huecos del texto legal quedan abiertos hasta la Task 8, a propósito:**
  `TERMS_EFFECTIVE_DATE = '[fecha de vigencia]'` y `CORREO_CONTACTO = '[correo de contacto]'` en
  `apps/portal/src/legal/terminos.ts`. Por eso 3 tests de `terminos.test.ts` están en ROJO desde la
  Task 3: ese rojo es lo que impide fusionar por despiste. Nadie los «arregla» con un valor
  cualquiera. La fecha la dice el usuario (el día del despliegue) y la dirección de contacto la
  escribe el USUARIO a mano (Task 8, Step 5).
- **La dirección de contacto real no la escribe ningún agente.** El texto legal lleva, por decisión
  del usuario, la dirección real de la fila «Canal de contacto» del §2.1 del Anexo del spec; el
  filtro de privacidad de las herramientas no deja que un agente la escriba, y no se intenta
  esquivarlo (ni con scripts, ni copiándola por otra vía). Ni este plan ni los tests la llevan
  escrita: el test la lee del propio Anexo. Si el filtro bloquea un comando, se le pide al usuario
  que lo lance él con `!` y se sigue con su salida.
- **Editar solo con Edit/Write.** Nunca `sed -i`, `perl -pi`, `Set-Content`, heredocs ni
  redirecciones (`>`, `>>`) para escribir ficheros: corrompen las tildes.
- **Commits:** convencionales, en español, sin tildes ni eñes en el mensaje, **sin ninguna línea de
  atribución** (nada de `Co-Authored-By`), con rutas explícitas (`git add <ruta> <ruta>`, nunca
  `git add -A` ni `git add .`).
- **No tocar** `.gitignore` ni las carpetas sin seguimiento del usuario (`.atl/`, `img/`,
  `openspec/`, `apps/WO-sales/prompts/`). **Nunca `git stash`** (ni con rutas ni sin ellas).
- **No lanzar vitest desde la raíz del repo:** siempre desde `apps/hub-api` o `apps/portal`. En
  hub-api, `npm test` no incluye los `*.db.test.ts`; esos van con `npm run test:db` y necesitan
  Docker Desktop arrancado.
- **El repo es PÚBLICO:** ni correos reales ni secretos en código, tests, documentación o commits.
  Única excepción, decidida por el usuario: la dirección de contacto del Anexo dentro de
  `CORREO_CONTACTO` en `terminos.ts` (la pone él). Los tests usan direcciones ficticias
  (`persona@ejemplo.test`, dominios `.test`).
- **Migraciones:** idempotentes, apuntadas en `MIGRATIONS` de `apps/hub-api/src/db.ts`, con el
  bloque de permisos DATA-332 (`GRANT … TO portal_app` dentro de `IF EXISTS`).
- **Comentarios** en español explicando el porqué. Identificadores en inglés en hub-api (convención
  del módulo de usuarios); los textos de la interfaz y el texto legal, exactamente como en este plan.
- **No tocar la consulta de `UserRepository.getSelfProfile`:** tiene historia de incidente en
  producción. `terms` sale de una consulta aparte.
- **No añadir otra petición a `/api/users/me`:** hub-api limita `/api/users/*` a 20 peticiones por
  minuto por IP y el portal ya la pide. La pantalla lee lo que trae la petición de `useAuth`.
- **Sin dependencias nuevas** (nada de librerías de Markdown).
- **Fuera del alcance, a propósito:** la autorización separada de los soportes de incapacidad
  (v1.1), el borrado automático a los 3 años, una vista de las aceptaciones en el panel de
  administración y bloquear la API en hub-api para quien no aceptó (`requireAuth` no se toca).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `apps/hub-api/src/users/migrations/079_terms_acceptances.sql` | **nuevo**: tabla `portal.terms_acceptances` |
| `apps/hub-api/src/db.ts` | 079 en `MIGRATIONS` |
| `apps/hub-api/src/equipos/migracion.test.ts` | la 078 deja de ser la última |
| `apps/hub-api/src/users/terms.migracion.test.ts` | **nuevo**: la 079 sin base de datos |
| `apps/hub-api/src/users/terms.db.test.ts` | **nuevo**: la 079 y las dos consultas contra Postgres (Docker) |
| `apps/hub-api/src/users/users.repository.ts` | `recordTermsAcceptance()`, `hasAcceptedTerms()` |
| `apps/hub-api/src/users/terms.ts` | **nuevo**: `CURRENT_TERMS_VERSION` |
| `apps/hub-api/src/users/users.types.ts` | `TermsStatus`, `SelfProfileResponse`, `RegisterInput.termsVersion` |
| `apps/hub-api/src/users/users.service.ts` | `getSelfProfile` con `terms`, `acceptTerms()`, `register` guarda la aceptación |
| `apps/hub-api/src/users/users.router.ts` | `POST /users/me/terms`; `termsVersion` en el registro |
| `apps/hub-api/src/users.integration.test.ts` | pool falso + 14 tests |
| `apps/hub-api/src/users/terms.test.ts` | **nuevo**: candado de la versión con el portal |
| `apps/portal/src/legal/terminos.ts` | **nuevo**: texto v1.0, versión, fecha de vigencia, correo de contacto, casilla |
| `apps/portal/src/legal/terminos.test.ts` | **nuevo**: candado de huecos y copia fiel del Anexo |
| `apps/portal/src/pages/Terminos.tsx` | **nuevo**: página pública `/terminos` |
| `apps/portal/src/pages/Terminos.test.tsx` | **nuevo** |
| `apps/portal/src/App.tsx` | ruta `/terminos` fuera de `RequireAuth` |
| `apps/portal/src/lib/terminosSesion.ts` | **nuevo**: estado de las condiciones de la sesión |
| `apps/portal/src/lib/terminosSesion.test.ts` | **nuevo** |
| `apps/portal/src/hooks/useAuth.ts` | guarda `terms` de la misma respuesta de `/users/me` |
| `apps/portal/src/hooks/useAuth.test.ts` | 5 tests |
| `apps/portal/src/components/AceptacionTerminos.tsx` | **nuevo**: pantalla de aceptación |
| `apps/portal/src/components/AceptacionTerminos.test.tsx` | **nuevo** |
| `apps/portal/src/components/RequireAuth.tsx` | pasa por la pantalla de aceptación |
| `apps/portal/src/components/Auth/AuthRightPanel.tsx` | texto y enlace de la casilla; `termsVersion` |
| `apps/portal/src/components/Auth/AuthRightPanel.test.tsx` | 3 tests |
| `apps/portal/src/pages/Configuracion.tsx` | enlace a `/terminos` |
| `apps/portal/src/pages/Configuracion.test.tsx` | 1 test |
| `docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md` | estado |

**Orden de las tareas.** Es el sugerido, con un cambio: la parte del portal que extiende la cache
de `useAuth` (Task 5) va separada de la pantalla (Task 6), porque son dos unidades que se revisan
por separado y la pantalla depende de la primera. La Task 4 (candado de versión) va después de la
3 porque lee el fichero que la 3 crea.

---

### Task 0: Rama

- [ ] **Step 1: Crear la rama desde `main` al día**

Desde la raíz del repo:

```bash
git checkout main
git pull --ff-only
git checkout -b feat/terminos
git status --short
```

Expected: en `feat/terminos`; `git status` muestra solo lo del usuario (` M .gitignore` y las
carpetas `??`) y, si el controlador todavía no lo ha commiteado, este plan
(`?? docs/superpowers/plans/2026-11-20-terminos-del-servicio.md`). Nada de eso se toca.

---

### Task 1: hub-api — migración 079 y consultas del repositorio

**Files:**
- Create: `apps/hub-api/src/users/terms.migracion.test.ts`
- Create: `apps/hub-api/src/users/terms.db.test.ts`
- Create: `apps/hub-api/src/users/migrations/079_terms_acceptances.sql`
- Modify: `apps/hub-api/src/equipos/migracion.test.ts` (test de la 078, líneas 116-119)
- Modify: `apps/hub-api/src/db.ts` (array `MIGRATIONS`, línea 102)
- Modify: `apps/hub-api/src/users/users.repository.ts` (tras `countPending`, línea 253)

- [ ] **Step 1: Escribir el test de la migración sin base de datos**

Crear `apps/hub-api/src/users/terms.migracion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La migración 079 sin base de datos: que está apuntada (y es la última), que se
// puede repetir en cada arranque, que guarda lo mínimo y se borra con la cuenta,
// y que da permisos a portal_app. Lo que hace contra Postgres lo vigila
// terms.db.test.ts (con Docker).
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_079 = leer('./migrations/079_terms_acceptances.sql');
// Sin comentarios: el texto explicativo puede nombrar DROP o IP sin ser sentencia.
const SIN_COMENTARIOS = SQL_079.replace(/--.*$/gm, '');

describe('migración 079 (aceptaciones de las condiciones de uso)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 078, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'078_equipos_responsable\.sql',\s*'079_terms_acceptances\.sql'\];/);
  });

  it('no siembra, ni cambia, ni borra nada (se re-ejecuta en cada arranque)', () => {
    expect(SIN_COMENTARIOS).not.toMatch(/INSERT\s+INTO|UPDATE\s+portal|\b(DROP|TRUNCATE|ALTER)\b|DELETE\s+FROM/i);
  });

  it('solo DDL idempotente: una tabla, IF NOT EXISTS', () => {
    const creates = SIN_COMENTARIOS.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^;]*/g) || [];
    expect(creates).toHaveLength(1);
    expect(creates.filter((c) => !/IF NOT EXISTS/.test(c))).toEqual([]);
  });

  it('guarda usuario, versión y fecha y nada más (ni IP ni navegador), y se borra con la cuenta', () => {
    expect(SIN_COMENTARIOS).toMatch(/user_id\s+UUID NOT NULL REFERENCES portal\.users\(id\) ON DELETE CASCADE/);
    expect(SIN_COMENTARIOS).toMatch(/version\s+TEXT NOT NULL/);
    expect(SIN_COMENTARIOS).toMatch(/accepted_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
    expect(SIN_COMENTARIOS).toMatch(/PRIMARY KEY \(user_id, version\)/);
    expect(SIN_COMENTARIOS).not.toMatch(/\b(ip|user_agent)\b/i);
  });

  it('da sus permisos a portal_app si existe (DATA-332)', () => {
    expect(SIN_COMENTARIOS).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SIN_COMENTARIOS).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON portal\.terms_acceptances TO portal_app/);
  });
});
```

- [ ] **Step 2: Verlo en rojo**

Desde `apps/hub-api`:

```bash
npx vitest run src/users/terms.migracion.test.ts
```

Expected: FAIL al cargar el fichero, sin tests ejecutados:
`ENOENT: no such file or directory, open '…/src/users/migrations/079_terms_acceptances.sql'`.

- [ ] **Step 3: Escribir el test contra Postgres**

Crear `apps/hub-api/src/users/terms.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { UserRepository } from './users.repository.js';

// La 079 y las dos consultas de las condiciones de uso contra Postgres de verdad.
// Es la primera vez que esto toca una base real: el pool falso de
// users.integration.test.ts casa por regex y no valida SQL.
//
// Solo toca usuarios de @terminos.test: los ficheros de BD corren en serie y cada
// uno limpia lo suyo. Las aceptaciones se van con sus usuarios (ON DELETE
// CASCADE), así que el TRUNCATE de test-db/harness.ts no necesita la tabla nueva.

const DOMINIO = '@terminos.test';
const SQL_079 = readFileSync(
  fileURLToPath(new URL('./migrations/079_terms_acceptances.sql', import.meta.url)),
  'utf8',
);

let db: Pool;
let repo: UserRepository;

beforeAll(() => {
  db = poolDePrueba();
  repo = new UserRepository(db);
});
afterAll(async () => {
  await db?.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
  await db?.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
});

async function sembrarUsuario(local: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status)
     VALUES ('Persona de Prueba', $1, 'hash-ficticio', 'reader', 'active') RETURNING id`,
    [`${local}${DOMINIO}`],
  );
  return (rows[0] as { id: string }).id;
}

async function aceptacionesDe(userId: string): Promise<{ version: string; accepted_at: Date }[]> {
  const { rows } = await db.query(
    `SELECT version, accepted_at FROM portal.terms_acceptances WHERE user_id = $1 ORDER BY version`,
    [userId],
  );
  return rows as { version: string; accepted_at: Date }[];
}

describe('migración 079 contra Postgres', () => {
  it('se puede aplicar dos veces más sobre la ya aplicada (idempotente)', async () => {
    await db.query(SQL_079);
    await db.query(SQL_079);
  });

  it('deja portal.terms_acceptances con usuario, versión y fecha, las tres obligatorias', async () => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'terms_acceptances' ORDER BY ordinal_position`,
    );
    expect(rows).toEqual([
      { column_name: 'user_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'version', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'accepted_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
  });

  it('re-aplicarla no borra las aceptaciones que ya hay', async () => {
    const id = await sembrarUsuario('reaplicar');
    await repo.recordTermsAcceptance(id, '1.0');
    await db.query(SQL_079);
    expect(await aceptacionesDe(id)).toHaveLength(1);
  });

  it('la clave primaria (user_id, version) impide dos filas iguales', async () => {
    const id = await sembrarUsuario('clave');
    await db.query(`INSERT INTO portal.terms_acceptances (user_id, version) VALUES ($1, '1.0')`, [id]);
    await expect(
      db.query(`INSERT INTO portal.terms_acceptances (user_id, version) VALUES ($1, '1.0')`, [id]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('borrar la cuenta borra sus aceptaciones (ON DELETE CASCADE, supresión de datos)', async () => {
    const id = await sembrarUsuario('borrado');
    await repo.recordTermsAcceptance(id, '1.0');
    expect(await repo.delete(id)).toBe(true);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM portal.terms_acceptances WHERE user_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('UserRepository · condiciones de uso', () => {
  it('hasAcceptedTerms es false sin aceptación y true tras recordTermsAcceptance', async () => {
    const id = await sembrarUsuario('acepta');
    expect(await repo.hasAcceptedTerms(id, '1.0')).toBe(false);
    await repo.recordTermsAcceptance(id, '1.0');
    expect(await repo.hasAcceptedTerms(id, '1.0')).toBe(true);
  });

  it('otra versión u otra cuenta no cuentan', async () => {
    const ana = await sembrarUsuario('ana');
    const beto = await sembrarUsuario('beto');
    await repo.recordTermsAcceptance(ana, '0.9');
    await repo.recordTermsAcceptance(beto, '1.0');
    expect(await repo.hasAcceptedTerms(ana, '1.0')).toBe(false);
  });

  it('repetir la misma aceptación no falla y conserva la fecha de la primera', async () => {
    const id = await sembrarUsuario('repite');
    await repo.recordTermsAcceptance(id, '1.0');
    const [primera] = await aceptacionesDe(id);
    await repo.recordTermsAcceptance(id, '1.0');
    const filas = await aceptacionesDe(id);
    expect(filas).toHaveLength(1);
    expect(filas[0].accepted_at.toISOString()).toBe(primera.accepted_at.toISOString());
  });

  it('una versión nueva es otra fila: quedan las dos aceptaciones', async () => {
    const id = await sembrarUsuario('dos-versiones');
    await repo.recordTermsAcceptance(id, '1.0');
    await repo.recordTermsAcceptance(id, '1.1');
    expect((await aceptacionesDe(id)).map((f) => f.version)).toEqual(['1.0', '1.1']);
  });
});
```

- [ ] **Step 4: Verlo en rojo contra Postgres**

Este paso necesita Docker Desktop arrancado: `docker info` debe responder sin error. Si no lo está,
abrir Docker Desktop y esperar a «Engine running». Si no se puede arrancar, este paso y el Step 10
NO se saltan en silencio: se anota en el informe de la tarea y se corren en la Task 8, Step 3.

Desde `apps/hub-api`:

```bash
npx vitest run --config vitest.db.config.ts src/users/terms.db.test.ts
```

Expected: arranca el contenedor de Postgres (la primera vez tarda) y el fichero FAIL al cargar:
`ENOENT: no such file or directory, open '…/src/users/migrations/079_terms_acceptances.sql'`.

- [ ] **Step 5: La 078 deja de ser la última**

En `apps/hub-api/src/equipos/migracion.test.ts`, sustituir:

```ts
describe('migración 078 (responsable asignado desde la tabla)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 077, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'077_password_reset_tokens\.sql',\s*'078_equipos_responsable\.sql'\];/);
  });
```

por:

```ts
describe('migración 078 (responsable asignado desde la tabla)', () => {
  // Ya no es la última (la 079 de las condiciones de uso va detrás): basta con que
  // esté justo detrás de la 077. La última la vigila users/terms.migracion.test.ts.
  it('está apuntada en MIGRATIONS, detrás de la 077', () => {
    expect(leer('../db.ts')).toMatch(/'077_password_reset_tokens\.sql',\s*'078_equipos_responsable\.sql'[,\]]/);
  });
```

Desde `apps/hub-api`:

```bash
npx vitest run src/equipos/migracion.test.ts
```

Expected: PASS (todavía no hay 079 detrás; `[,\]]` acepta los dos casos).

- [ ] **Step 6: La migración**

Crear `apps/hub-api/src/users/migrations/079_terms_acceptances.sql`:

```sql
-- Migration 079: constancia de aceptación de las condiciones de uso y de la
-- política de tratamiento de datos del portal (Ley 1581 de 2012, Decreto 1377 de
-- 2013; spec docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md).
--
-- Una fila por usuario y versión aceptada: es la prueba de la autorización. Solo
-- usuario, versión y fecha: el texto publicado promete «fecha y versión», y guardar
-- más (dirección de red, navegador) obligaría a declararlo en el §2.2 del texto.
--   · PRIMARY KEY (user_id, version): aceptar dos veces la misma versión no duplica
--     nada. hub-api inserta con ON CONFLICT DO NOTHING, así que la fecha que queda
--     es la de la primera aceptación.
--   · ON DELETE CASCADE: borrar la cuenta borra sus aceptaciones, coherente con la
--     supresión de los datos.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque. No siembra nada.

CREATE TABLE IF NOT EXISTS portal.terms_acceptances (
  user_id      UUID NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  accepted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da. La
-- 068 concede ALL TABLES, pero corre antes que esta en el mismo arranque. No hay
-- secuencia que conceder: la clave es (user_id, version).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.terms_acceptances TO portal_app;
  END IF;
END $$;
```

- [ ] **Step 7: Apuntarla en `MIGRATIONS`**

En `apps/hub-api/src/db.ts`, sustituir (final de la línea del array `MIGRATIONS`):

```ts
'077_password_reset_tokens.sql', '078_equipos_responsable.sql'];
```

por:

```ts
'077_password_reset_tokens.sql', '078_equipos_responsable.sql', '079_terms_acceptances.sql'];
```

- [ ] **Step 8: Las dos consultas del repositorio**

En `apps/hub-api/src/users/users.repository.ts`, justo después de:

```ts
  /** Cuántas cuentas esperan aprobación (aviso del enlace «Usuarios» del portal). */
  async countPending(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS total FROM portal.users WHERE status = 'pending'`,
    );
    return rows[0]?.total ?? 0;
  }
```

añadir:

```ts

  /**
   * Guarda que el usuario aceptó `version` de las condiciones de uso (migración
   * 079). `ON CONFLICT DO NOTHING`: aceptar otra vez la misma versión no falla ni
   * mueve la fecha; la que vale como prueba es la de la primera aceptación.
   */
  async recordTermsAcceptance(userId: string, version: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO portal.terms_acceptances (user_id, version) VALUES ($1, $2)
       ON CONFLICT (user_id, version) DO NOTHING`,
      [userId, version],
    );
  }

  /** true si el usuario tiene aceptada `version` de las condiciones de uso. */
  async hasAcceptedTerms(userId: string, version: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM portal.terms_acceptances WHERE user_id = $1 AND version = $2',
      [userId, version],
    );
    return rows.length > 0;
  }
```

- [ ] **Step 9: Los tests sin base de datos, en verde**

Desde `apps/hub-api`:

```bash
npx vitest run src/users/terms.migracion.test.ts src/equipos/migracion.test.ts
```

Expected: PASS los dos ficheros (los 5 de la 079 y todos los de equipos).

- [ ] **Step 10: El test contra Postgres, en verde**

Con Docker arrancado (ver Step 4), desde `apps/hub-api`:

```bash
npx vitest run --config vitest.db.config.ts src/users/terms.db.test.ts
```

Expected: PASS los 9 (el contenedor aplica el array `MIGRATIONS`, ya con la 079).

- [ ] **Step 11: Tipos**

```bash
npx tsc --noEmit -p .
```

Expected: sin salida, exit 0.

- [ ] **Step 12: Commit**

Desde la raíz del repo:

```bash
git add apps/hub-api/src/users/migrations/079_terms_acceptances.sql apps/hub-api/src/db.ts apps/hub-api/src/equipos/migracion.test.ts apps/hub-api/src/users/terms.migracion.test.ts apps/hub-api/src/users/terms.db.test.ts apps/hub-api/src/users/users.repository.ts
git commit -m "feat(hub-api): tabla de aceptaciones de las condiciones de uso (migracion 079)"
```

---

### Task 2: hub-api — `terms` en `/users/me`, `POST /users/me/terms` y registro con versión

**Files:**
- Create: `apps/hub-api/src/users/terms.ts`
- Modify: `apps/hub-api/src/users.integration.test.ts` (import, línea 6; pool falso, líneas 32-34 y
  78; tests al final del fichero)
- Modify: `apps/hub-api/src/users/users.types.ts` (`RegisterInput`, líneas 56-61)
- Modify: `apps/hub-api/src/users/users.service.ts` (imports, líneas 2-3; `register`, líneas 73-94;
  `getSelfProfile`, líneas 171-176)
- Modify: `apps/hub-api/src/users/users.router.ts` (registro, líneas 66-81; comentario de
  `GET /users/me`, línea 83; ruta nueva tras `PATCH /users/me/password`, línea 153)

- [ ] **Step 1: La constante de la versión vigente**

Va antes de los tests porque los tests la importan: sin el fichero, el de integración ni cargaría
y el rojo no diría nada. Es un valor, no comportamiento. Crear `apps/hub-api/src/users/terms.ts`:

```ts
// Versión vigente de las condiciones de uso y de la política de tratamiento de
// datos del portal (spec docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md).
//
// El texto vive en el portal (apps/portal/src/legal/terminos.ts) con su propia
// TERMS_VERSION: las dos tienen que coincidir, y lo vigila ./terms.test.ts.
// Cambiarla vuelve a pedir la aceptación a todos en su siguiente acceso.
export const CURRENT_TERMS_VERSION = '1.0';
```

- [ ] **Step 2: Enseñar al pool falso la tabla nueva**

En `apps/hub-api/src/users.integration.test.ts`:

1. Sustituir:

```ts
import type { AccessNotifierActions } from './users/access-emails/access-notifier.js';
```

por:

```ts
import type { AccessNotifierActions } from './users/access-emails/access-notifier.js';
import { CURRENT_TERMS_VERSION } from './users/terms.js';
```

2. Sustituir:

```ts
  users: Row[] = [];
  apps: { user_id: string; app_id: string }[] = [];
  private seq = 0;
```

por:

```ts
  users: Row[] = [];
  apps: { user_id: string; app_id: string }[] = [];
  /** portal.terms_acceptances (migración 079): las aceptaciones de las condiciones de uso. */
  terms: { user_id: string; version: string }[] = [];
  /** Con true, guardar una aceptación lanza: simula un fallo de la base a mitad del registro. */
  failTermsInsert = false;
  private seq = 0;
```

3. Sustituir:

```ts
    if (/^INSERT INTO portal.users/i.test(sql)) {
      const [full_name, email, password_hash] = params as string[];
```

por:

```ts
    // Condiciones de uso (spec 2026-11-20-terminos). Van antes que todo lo de
    // portal.users: ninguna de esas ramas las reconoce, y una genérica que casara
    // por error devolvería filas de otra tabla.
    if (/^INSERT INTO portal.terms_acceptances/i.test(sql)) {
      if (this.failTermsInsert) throw new Error('fallo forzado al guardar la aceptación');
      const [user_id, version] = params as string[];
      // ON CONFLICT (user_id, version) DO NOTHING: repetir no añade otra fila.
      if (this.terms.some((t) => t.user_id === user_id && t.version === version)) return { rows: [], rowCount: 0 };
      this.terms.push({ user_id, version });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM portal.terms_acceptances WHERE user_id = \$1 AND version = \$2/i.test(sql)) {
      const [user_id, version] = params as string[];
      const rows = this.terms
        .filter((t) => t.user_id === user_id && t.version === version)
        .map(() => ({ '?column?': 1 }));
      return { rows, rowCount: rows.length };
    }
    if (/^INSERT INTO portal.users/i.test(sql)) {
      const [full_name, email, password_hash] = params as string[];
```

- [ ] **Step 3: Escribir los tests de las rutas**

En el mismo fichero, sustituir el final:

```ts
    const asignar = await request(app).put(`/api/users/${p.id}/apps`).set(bearer(adminToken)).send({ apps: ['ausencias'] });
    expect(asignar.body).toEqual({ message: 'apps_updated', apps: ['ausencias'] });
  });
});
```

por:

```ts
    const asignar = await request(app).put(`/api/users/${p.id}/apps`).set(bearer(adminToken)).send({ apps: ['ausencias'] });
    expect(asignar.body).toEqual({ message: 'apps_updated', apps: ['ausencias'] });
  });
});

// Condiciones de uso y tratamiento de datos (spec 2026-11-20-terminos-del-servicio,
// §4 y §7). La constancia es la fila de portal.terms_acceptances; aquí, el array
// `terms` del pool falso. Lo que hace contra Postgres: users/terms.db.test.ts.
describe('condiciones de uso', () => {
  afterEach(() => vi.restoreAllMocks());

  const aceptacionesDe = (userId: string) => db.terms.filter((t) => t.user_id === userId);
  const registrar = (extra: Record<string, unknown>) =>
    request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Persona Nueva', email: 'persona@ejemplo.test', password: 'clave-ficticia-1', ...extra });

  it('GET /me trae la versión vigente y accepted false a quien no la aceptó', async () => {
    const res = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(res.status).toBe(200);
    expect(res.body.terms).toEqual({ current: CURRENT_TERMS_VERSION, accepted: false });
  });

  it('GET /me: accepted true con la vigente aceptada', async () => {
    db.terms.push({ user_id: READER_ID, version: CURRENT_TERMS_VERSION });
    const res = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(res.body.terms).toEqual({ current: CURRENT_TERMS_VERSION, accepted: true });
  });

  it('GET /me: haber aceptado otra versión no cuenta (una versión nueva se vuelve a pedir)', async () => {
    db.terms.push({ user_id: READER_ID, version: '0.9' });
    const res = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(res.body.terms).toEqual({ current: CURRENT_TERMS_VERSION, accepted: false });
  });

  it('GET /me: la aceptación de otra cuenta no cuenta', async () => {
    db.terms.push({ user_id: ADMIN_ID, version: CURRENT_TERMS_VERSION });
    const res = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(res.body.terms).toEqual({ current: CURRENT_TERMS_VERSION, accepted: false });
  });

  it('POST /me/terms sin token → 401', async () => {
    const res = await request(app).post('/api/users/me/terms').send({ version: CURRENT_TERMS_VERSION });
    expect(res.status).toBe(401);
  });

  it('POST /me/terms con otra versión → 400 invalid_terms_version y no guarda nada', async () => {
    const res = await request(app).post('/api/users/me/terms').set(bearer(readerToken)).send({ version: '0.9' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_terms_version', field: 'version' });
    expect(db.terms).toEqual([]);
  });

  it('POST /me/terms sin versión → 400', async () => {
    const res = await request(app).post('/api/users/me/terms').set(bearer(readerToken)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_terms_version');
  });

  it('POST /me/terms con la vigente → 200, queda guardada y GET /me ya lo dice', async () => {
    const res = await request(app)
      .post('/api/users/me/terms')
      .set(bearer(readerToken))
      .send({ version: CURRENT_TERMS_VERSION });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    expect(aceptacionesDe(READER_ID)).toEqual([{ user_id: READER_ID, version: CURRENT_TERMS_VERSION }]);
    const me = await request(app).get('/api/users/me').set(bearer(readerToken));
    expect(me.body.terms).toEqual({ current: CURRENT_TERMS_VERSION, accepted: true });
  });

  it('POST /me/terms repetido → 200 otra vez y una sola aceptación', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/api/users/me/terms')
        .set(bearer(readerToken))
        .send({ version: CURRENT_TERMS_VERSION });
      expect(res.status).toBe(200);
    }
    expect(aceptacionesDe(READER_ID)).toHaveLength(1);
  });

  it('registro con la versión vigente → 201 y la cuenta nueva queda con su aceptación', async () => {
    const res = await registrar({ termsVersion: CURRENT_TERMS_VERSION });
    expect(res.status).toBe(201);
    expect(aceptacionesDe(res.body.userId)).toEqual([{ user_id: res.body.userId, version: CURRENT_TERMS_VERSION }]);
  });

  it.each([
    { caso: 'sin termsVersion (portal anterior)', extra: {} },
    { caso: 'con otra versión', extra: { termsVersion: '0.9' } },
    { caso: 'con un termsVersion que no es texto', extra: { termsVersion: 1 } },
  ])('registro $caso → 201 igual, sin aceptación', async ({ extra }) => {
    const res = await registrar(extra);
    expect(res.status).toBe(201);
    expect(db.users.some((u) => u.id === res.body.userId)).toBe(true);
    expect(db.terms).toEqual([]);
  });

  it('registro: si guardar la aceptación falla, la cuenta se crea igual y el log lleva el user_id, no el correo', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.failTermsInsert = true;
    const res = await registrar({ termsVersion: CURRENT_TERMS_VERSION });
    expect(res.status).toBe(201);
    expect(db.users.some((u) => u.id === res.body.userId)).toBe(true);
    expect(error).toHaveBeenCalledWith('register_terms error', { user_id: res.body.userId }, expect.any(Error));
    expect(JSON.stringify(error.mock.calls)).not.toContain('persona@ejemplo.test');
  });
});
```

- [ ] **Step 4: Verlos en rojo**

Desde `apps/hub-api`:

```bash
npx vitest run src/users.integration.test.ts -t "condiciones de uso"
```

Expected: FAIL 11 de los 14, por la razón esperada:
- los 4 de `GET /me`: `res.body.terms` no existe (`expected undefined to deeply equal { current: '1.0', accepted: false }`);
- los 5 de `POST /me/terms`: la ruta no existe y Express responde 404 (`expected 404 to be 401`,
  `… to be 400`, `… to be 200`);
- «registro con la versión vigente»: `expected [] to deeply equal [ { user_id: …, version: '1.0' } ]`;
- «si guardar la aceptación falla»: `console.error` no se llama con `'register_terms error'`.

Los 3 del `it.each` («sin termsVersion», «con otra versión», «que no es texto») ya pasan: son el
candado de que sin la versión vigente no se guarda nada.

- [ ] **Step 5: Tipos**

En `apps/hub-api/src/users/users.types.ts`, sustituir:

```ts
/** Payload de entrada del registro por autoservicio (`POST /api/auth/register`). */
export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
}
```

por:

```ts
/**
 * Estado de las condiciones de uso del propio usuario (spec
 * 2026-11-20-terminos-del-servicio): `current` es la versión vigente y
 * `accepted`, si este usuario la tiene aceptada.
 */
export interface TermsStatus {
  current: string;
  accepted: boolean;
}

/**
 * Lo que devuelve `GET /api/users/me`: el perfil más el estado de las condiciones.
 * Tipo aparte y no un campo más de `SelfProfile` porque `terms` no sale de la
 * consulta del perfil (ver UserService.getSelfProfile).
 */
export interface SelfProfileResponse extends SelfProfile {
  terms: TermsStatus;
}

/** Payload de entrada del registro por autoservicio (`POST /api/auth/register`). */
export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  /**
   * Versión de las condiciones de uso que la persona aceptó en la casilla del
   * registro. Opcional: un portal anterior no la manda. `unknown` porque llega tal
   * cual del cuerpo y solo se compara con la vigente.
   */
  termsVersion?: unknown;
}
```

- [ ] **Step 6: Servicio**

En `apps/hub-api/src/users/users.service.ts`:

1. Sustituir:

```ts
import type { UserRepository } from './users.repository.js';
import type { PaginatedUsers, RegisterInput, UserPublic, UserRole, SelfProfile } from './users.types.js';
```

por:

```ts
import type { UserRepository } from './users.repository.js';
import type { PaginatedUsers, RegisterInput, UserPublic, UserRole, SelfProfileResponse } from './users.types.js';
import { CURRENT_TERMS_VERSION } from './terms.js';
import { captureError } from '../sentry.js';
```

2. Sustituir `register` entero:

```ts
  /**
   * Registro por autoservicio. Valida, hashea con bcrypt (coste ≥ 12) y crea el
   * usuario en estado `pending` (default de BD). Lanza 409 si el email ya existe.
   */
  async register(input: RegisterInput): Promise<UserPublic> {
    const clean = validateRegisterInput(input);

    // Pre-chequeo explícito; la unique constraint cubre la carrera concurrente.
    if (await this.repo.findByEmail(clean.email)) {
      throw new UserError('email_already_registered', 409, 'email');
    }

    const hash = await bcrypt.hash(clean.password, this.bcryptCost);
    try {
      return await this.repo.create(clean, hash);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new UserError('email_already_registered', 409, 'email');
      }
      throw err;
    }
  }
```

por:

```ts
  /**
   * Registro por autoservicio. Valida, hashea con bcrypt (coste ≥ 12) y crea el
   * usuario en estado `pending` (default de BD). Lanza 409 si el email ya existe.
   *
   * Si `termsVersion` es la versión vigente, guarda además la aceptación de las
   * condiciones de uso (la casilla del registro). Ese paso NUNCA tumba el
   * registro: si falta, no coincide o falla al guardarse, la cuenta se crea igual
   * y la pantalla de aceptación del portal se la pedirá en su primer acceso. Así
   * un portal anterior, durante el despliegue, sigue pudiendo registrar.
   */
  async register(input: RegisterInput): Promise<UserPublic> {
    const clean = validateRegisterInput(input);

    // Pre-chequeo explícito; la unique constraint cubre la carrera concurrente.
    if (await this.repo.findByEmail(clean.email)) {
      throw new UserError('email_already_registered', 409, 'email');
    }

    const hash = await bcrypt.hash(clean.password, this.bcryptCost);
    let user: UserPublic;
    try {
      user = await this.repo.create(clean, hash);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new UserError('email_already_registered', 409, 'email');
      }
      throw err;
    }

    if (input?.termsVersion === CURRENT_TERMS_VERSION) {
      try {
        await this.repo.recordTermsAcceptance(user.id, CURRENT_TERMS_VERSION);
      } catch (err) {
        // Solo el user_id: el correo no va a los logs (spec §4).
        console.error('register_terms error', { user_id: user.id }, err);
        captureError(err, { endpoint: 'register_terms', user_id: user.id });
      }
    }
    return user;
  }
```

3. Sustituir:

```ts
  /** Perfil propio del usuario autenticado; 404 si no existe. */
  async getSelfProfile(id: string): Promise<SelfProfile> {
    const profile = await this.repo.getSelfProfile(id);
    if (!profile) throw new UserError('user_not_found', 404);
    return profile;
  }
```

por:

```ts
  /**
   * Perfil propio del usuario autenticado, con el estado de las condiciones de
   * uso; 404 si no existe.
   *
   * `terms` sale de una consulta APARTE y no de una columna más en la del perfil:
   * esa consulta comparte forma con la de `requireAuth`, que tumbó la
   * autenticación en producción el 2026-08-23 al tocarla, y esto no necesita ir
   * en ella.
   */
  async getSelfProfile(id: string): Promise<SelfProfileResponse> {
    const profile = await this.repo.getSelfProfile(id);
    if (!profile) throw new UserError('user_not_found', 404);
    const accepted = await this.repo.hasAcceptedTerms(id, CURRENT_TERMS_VERSION);
    return { ...profile, terms: { current: CURRENT_TERMS_VERSION, accepted } };
  }

  /**
   * El propio usuario acepta las condiciones de uso y la política de datos. Solo
   * vale la versión vigente: aceptar otra (un portal desfasado, un valor
   * inventado) no dejaría constancia de lo que de verdad rige. Repetirla no cambia
   * nada: la fecha que queda es la de la primera aceptación.
   */
  async acceptTerms(id: string, version: unknown): Promise<void> {
    if (version !== CURRENT_TERMS_VERSION) throw new UserError('invalid_terms_version', 400, 'version');
    await this.repo.recordTermsAcceptance(id, CURRENT_TERMS_VERSION);
  }
```

- [ ] **Step 7: Router**

En `apps/hub-api/src/users/users.router.ts`:

1. Sustituir:

```ts
  // POST /api/auth/register — registro por autoservicio, sin autenticación.
  // Éxito → 201 y estado pending (no emite JWT). Validación → 400; duplicado → 409.
  // No se audita: no es una operación de admin (no hay adminEmail).
  router.post('/auth/register', registerLimiter, async (req: Request, res: Response) => {
    try {
      const { fullName, email, password } = (req.body ?? {}) as {
        fullName?: string;
        email?: string;
        password?: string;
      };
      const user = await service.register({ fullName: fullName!, email: email!, password: password! });
```

por:

```ts
  // POST /api/auth/register — registro por autoservicio, sin autenticación.
  // Éxito → 201 y estado pending (no emite JWT). Validación → 400; duplicado → 409.
  // `termsVersion` (opcional) es la versión de las condiciones de uso aceptada en
  // la casilla; con la vigente queda la constancia (ver UserService.register).
  // No se audita: no es una operación de admin (no hay adminEmail).
  router.post('/auth/register', registerLimiter, async (req: Request, res: Response) => {
    try {
      const { fullName, email, password, termsVersion } = (req.body ?? {}) as {
        fullName?: string;
        email?: string;
        password?: string;
        termsVersion?: unknown;
      };
      const user = await service.register({ fullName: fullName!, email: email!, password: password!, termsVersion });
```

2. Sustituir:

```ts
  // GET /api/users/me — perfil propio (nombre, email, rol, avatar, alta).
```

por:

```ts
  // GET /api/users/me — perfil propio (nombre, email, rol, avatar, alta, apps) y el
  // estado de las condiciones de uso (`terms`), que el portal lee de esta misma
  // respuesta para decidir si pide la aceptación.
```

3. Justo después del bloque:

```ts
      sendError(res, e, 'change_password');
    }
  });
```

añadir:

```ts

  // POST /api/users/me/terms { version } — el propio usuario acepta las condiciones
  // de uso y la política de tratamiento de datos (Ley 1581). El objetivo es el
  // user_id del JWT, así que basta requireAuth; pasa por el limitador de /users/*
  // como el resto. Solo vale la versión vigente (400 si no); repetirla responde
  // igual y no cambia la fecha de la primera. No se audita: la constancia ES la
  // fila de portal.terms_acceptances.
  router.post('/users/me/terms', requireAuth, async (req: Request, res: Response) => {
    const payload = getPayload(req);
    if (!payload?.user_id) return void res.status(401).json({ error: 'unauthorized' });
    try {
      await service.acceptTerms(payload.user_id, (req.body ?? {}).version);
      res.json({ accepted: true });
    } catch (e) {
      sendError(res, e, 'accept_terms');
    }
  });
```

- [ ] **Step 8: Verlos en verde**

Desde `apps/hub-api`:

```bash
npx vitest run src/users.integration.test.ts src/users/users.service.test.ts
```

Expected: PASS los dos ficheros (los 14 nuevos y todos los que ya había; las propiedades del
servicio no mandan `termsVersion` y no cambian).

- [ ] **Step 9: Tipos**

```bash
npx tsc --noEmit -p .
```

Expected: sin salida, exit 0.

- [ ] **Step 10: Commit**

Desde la raíz del repo:

```bash
git add apps/hub-api/src/users/terms.ts apps/hub-api/src/users.integration.test.ts apps/hub-api/src/users/users.types.ts apps/hub-api/src/users/users.service.ts apps/hub-api/src/users/users.router.ts
git commit -m "feat(hub-api): aceptacion de las condiciones de uso en users/me y en el registro"
```

---

### Task 3: Portal — texto legal, candado de huecos y página `/terminos`

**Files:**
- Create: `apps/portal/src/legal/terminos.ts`
- Create: `apps/portal/src/legal/terminos.test.ts`
- Create: `apps/portal/src/pages/Terminos.tsx`
- Create: `apps/portal/src/pages/Terminos.test.tsx`
- Modify: `apps/portal/src/App.tsx` (import, línea 18; ruta, tras la línea 61)

- [ ] **Step 1: Escribir el candado de huecos**

Crear `apps/portal/src/legal/terminos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as legal from './terminos';

// CANDADO: el texto que se publica en /terminos no puede llevar huecos «[…]» de
// borrador («[plazo por definir]», «[fecha de aprobación]»…), y cada pieza tiene
// que estar TAL CUAL en el Anexo del spec, que es el texto aprobado. Recorre TODO
// lo que exporta terminos.ts —también la fecha de vigencia y el correo de
// contacto—, así que una pieza nueva queda vigilada sin tocar este test.
//
// Mientras TERMS_EFFECTIVE_DATE y CORREO_CONTACTO sean huecos, los tests del
// hueco, de la fecha y del correo están en ROJO a propósito: se rellenan en el
// último commit antes de fusionar (spec §8).

interface Texto {
  ruta: string;
  texto: string;
}

function textos(valor: unknown, ruta: string, salida: Texto[] = []): Texto[] {
  if (typeof valor === 'string') {
    salida.push({ ruta, texto: valor });
  } else if (Array.isArray(valor)) {
    valor.forEach((v, i) => textos(v, `${ruta}[${i}]`, salida));
  } else if (valor !== null && typeof valor === 'object') {
    for (const [clave, v] of Object.entries(valor)) {
      // `tipo` es la etiqueta interna del bloque («parrafo», «tabla»…): no se publica.
      if (clave !== 'tipo') textos(v, `${ruta}.${clave}`, salida);
    }
  }
  return salida;
}

const publicados = textos({ ...legal }, 'terminos');

const SPEC = fileURLToPath(
  new URL('../../../../docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md', import.meta.url),
);
const normalizar = (t: string) => t.replace(/\s+/g, ' ');
const ANEXO = normalizar(readFileSync(SPEC, 'utf8').split('## Anexo')[1] ?? '');
// La dirección de contacto se lee del propio Anexo (fila «Canal de contacto» del
// §2.1): así este test no la lleva escrita. La única copia en código es la de
// CORREO_CONTACTO en terminos.ts.
const CORREO_DEL_ANEXO = /\| Canal de contacto \| (\S+) \|/.exec(ANEXO)?.[1] ?? '';

describe('CANDADO: el texto publicado en /terminos', () => {
  it('el recorrido encuentra el texto (si no, el candado no vigilaría nada)', () => {
    expect(publicados.length).toBeGreaterThan(50);
    expect(publicados.some((t) => t.texto.includes('Ley 1581 de 2012'))).toBe(true);
  });

  it('ningún texto lleva un hueco entre corchetes', () => {
    expect(publicados.filter((t) => /\[[^\]]*\]/.test(t.texto))).toEqual([]);
  });

  it('la fecha de vigencia está puesta y sale en la línea de versión y en el §2.8', () => {
    expect(legal.TERMS_EFFECTIVE_DATE).toMatch(
      /^\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{4}$/,
    );
    expect(legal.LINEA_VERSION).toContain(legal.TERMS_EFFECTIVE_DATE);
    expect(
      publicados.some((t) => t.texto.startsWith(`Esta política rige desde el ${legal.TERMS_EFFECTIVE_DATE}.`)),
    ).toBe(true);
  });

  it('el correo de contacto está puesto y es el del Anexo (§2.1)', () => {
    expect(CORREO_DEL_ANEXO).toContain('@');
    expect(legal.CORREO_CONTACTO).toBe(CORREO_DEL_ANEXO);
  });

  it('cada texto publicado está tal cual en el Anexo del spec (sin erratas ni texto inventado)', () => {
    expect(ANEXO.length).toBeGreaterThan(1000);
    // En el Anexo la fecha es el hueco «{fecha de vigencia}» y el correo, el real:
    // se comparan así para que este test no dependa de que ya estén rellenados.
    const comoEnElAnexo = (t: string) =>
      normalizar(
        t
          .split(legal.TERMS_EFFECTIVE_DATE)
          .join('{fecha de vigencia}')
          .split(legal.CORREO_CONTACTO)
          .join(CORREO_DEL_ANEXO),
      );
    expect(publicados.filter((t) => !ANEXO.includes(comoEnElAnexo(t.texto))).map((t) => t.ruta)).toEqual([]);
  });
});
```

- [ ] **Step 2: Verlo en rojo**

Desde `apps/portal`:

```bash
npx vitest run src/legal/terminos.test.ts
```

Expected: FAIL al cargar el fichero: no se resuelve `./terminos`.

- [ ] **Step 3: El texto legal**

Crear `apps/portal/src/legal/terminos.ts`. El texto es el del Anexo del spec, carácter a carácter
(las comillas tipográficas “ ” y la raya — también). `CORREO_CONTACTO` se deja como hueco: lo
rellena el usuario en la Task 8 (ver Reglas).

```ts
// Condiciones de uso y política de tratamiento de datos personales del portal,
// versión 1.0 (spec docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md,
// Anexo). Es lo que se publica en /terminos y lo que cada usuario acepta.
//
// Va como datos y no como Markdown: sin dependencias nuevas, y la página decide
// cómo se pinta cada pieza.
//
// Dos candados:
//   · apps/hub-api/src/users/terms.test.ts lee este fichero como TEXTO y exige que
//     TERMS_VERSION sea la CURRENT_TERMS_VERSION de hub-api. Cambiar el texto de
//     verdad es subir la versión en los dos sitios, y todos vuelven a aceptarlo. Por
//     eso la línea `export const TERMS_VERSION = '…';` no cambia de forma.
//   · ./terminos.test.ts falla si queda un hueco «[…]» en cualquier texto exportado
//     o si un texto no está tal cual en el Anexo del spec.

export const TERMS_VERSION = '1.0';

/**
 * Día en que entra en vigor: el del despliegue del portal (spec §8), escrito
 * «24 de noviembre de 2026». Se fija en el último commit antes de fusionar;
 * mientras sea un hueco «[…]», el candado de ./terminos.test.ts falla a propósito.
 */
export const TERMS_EFFECTIVE_DATE = '[fecha de vigencia]';

/**
 * El canal de contacto del §2.1 y del §2.7: la dirección real de la fila «Canal
 * de contacto» del Anexo, a propósito (decisión del usuario, spec §2). Es el único
 * sitio del código donde puede aparecer. La escribe a mano el usuario antes de
 * fusionar: el filtro de privacidad no deja que la escriba un agente. Mientras sea
 * un hueco «[…]», el candado de ./terminos.test.ts falla a propósito.
 */
export const CORREO_CONTACTO = '[correo de contacto]';

/** Un párrafo; `destacado` es su arranque en negrita («1.1 Quién puede usarlo.»). */
export interface Parrafo {
  tipo: 'parrafo';
  destacado?: string;
  texto: string;
}

export interface Lista {
  tipo: 'lista';
  items: string[];
}

export interface Tabla {
  tipo: 'tabla';
  columnas: string[];
  filas: string[][];
}

export type Bloque = Parrafo | Lista | Tabla;

/** Un apartado («2.1 Responsable del tratamiento») y lo que lleva debajo. Sin título, va pegado al de la sección. */
export interface Apartado {
  titulo?: string;
  bloques: Bloque[];
}

export interface Seccion {
  titulo: string;
  apartados: Apartado[];
}

export const TITULO_TERMINOS =
  'Condiciones de uso y política de tratamiento de datos personales — Portal de aplicaciones';

export const INTRODUCCION =
  'Este documento reúne las condiciones de uso del portal de aplicaciones internas de AMBIENTALIA S.A.S. y la política con la que la compañía trata los datos personales de quienes lo usan. Al ingresar al portal, el usuario acepta ambas.';

export const LINEA_VERSION = `Versión ${TERMS_VERSION} · Vigente desde ${TERMS_EFFECTIVE_DATE}`;

const parrafo = (texto: string): Parrafo => ({ tipo: 'parrafo', texto });
const arranque = (destacado: string, texto: string): Parrafo => ({ tipo: 'parrafo', destacado, texto });
const lista = (...items: string[]): Lista => ({ tipo: 'lista', items });
const tabla = (columnas: string[], ...filas: string[][]): Tabla => ({ tipo: 'tabla', columnas, filas });

export const SECCIONES: Seccion[] = [
  {
    titulo: '1. Condiciones de uso',
    apartados: [
      {
        bloques: [
          arranque(
            '1.1 Quién puede usarlo.',
            'El portal es para empleados y colaboradores de AMBIENTALIA. La cuenta solo queda activa después de que un administrador la aprueba.',
          ),
          arranque(
            '1.2 Cuenta.',
            'La cuenta es personal e intransferible. La contraseña no se comparte con nadie. Si otra persona la conoce o el usuario sospecha un acceso indebido, debe avisar de inmediato a un administrador. AMBIENTALIA puede desactivar la cuenta en cualquier momento, y lo hará cuando termine el vínculo con la compañía.',
          ),
          arranque(
            '1.3 Uso aceptable.',
            'El portal se usa solo para el trabajo. No está permitido sacar información fuera de la compañía, intentar entrar a aplicaciones que no han sido asignadas ni automatizar accesos. El incumplimiento puede llevar a la desactivación de la cuenta y a las medidas previstas en el Reglamento Interno de Trabajo.',
          ),
          arranque(
            '1.4 Confidencialidad.',
            'El portal muestra información de clientes, contabilidad e inventario. Esa información es confidencial: no se divulga ni se comparte con terceros, durante el vínculo con la compañía ni después de terminado.',
          ),
          arranque(
            '1.5 Registro de actividad.',
            'Por seguridad y auditoría, el portal registra las acciones de administración y los errores técnicos. Los errores se registran con el servicio Sentry.',
          ),
          arranque(
            '1.6 Disponibilidad.',
            'AMBIENTALIA no garantiza un servicio continuo. El portal puede tener interrupciones por mantenimiento o por fallas.',
          ),
          arranque(
            '1.7 Cambios.',
            'Estas condiciones y la política de tratamiento de datos llevan número de versión y fecha. Cuando cambien, el portal lo avisará a los usuarios.',
          ),
        ],
      },
    ],
  },
  {
    titulo: '2. Política de tratamiento de datos personales',
    apartados: [
      {
        bloques: [
          parrafo(
            'AMBIENTALIA trata los datos personales de los usuarios del portal conforme a la Ley 1581 de 2012 y al Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015.',
          ),
        ],
      },
      {
        titulo: '2.1 Responsable del tratamiento',
        bloques: [
          tabla(
            ['Dato', 'Información'],
            ['Razón social', 'AMBIENTALIA S.A.S.'],
            ['NIT', '900.700.933-5'],
            ['Domicilio', 'Calle 86 # 24-27, Bogotá D.C., Colombia'],
            ['Canal de contacto', CORREO_CONTACTO],
          ),
        ],
      },
      {
        titulo: '2.2 Datos que se tratan',
        bloques: [
          tabla(
            ['Dato', 'Detalle'],
            ['Nombre, correo y rol', 'Los registra el usuario al crear la cuenta; el rol lo asigna un administrador'],
            ['Contraseña', 'Se guarda solo como huella cifrada; nadie en la compañía puede conocerla'],
            ['Foto de perfil', 'Opcional; solo si el usuario decide subirla'],
            ['Ausencias', 'Fechas, tipo de ausencia y soportes que el usuario carga en la aplicación Ausencias'],
          ),
          parrafo(
            'El portal registra además las acciones de administración y los errores técnicos, que pueden quedar asociados al usuario que los originó.',
          ),
        ],
      },
      {
        titulo: '2.3 Finalidad',
        bloques: [
          parrafo('Los datos se usan únicamente para:'),
          lista(
            'Gestionar el acceso al portal: crear, aprobar, administrar y desactivar cuentas.',
            'Operar las aplicaciones internas, incluida la gestión de ausencias.',
            'Enviar los correos de acceso y de recuperación de contraseña.',
            'Mantener la seguridad del portal y permitir su auditoría.',
          ),
          parrafo(
            'AMBIENTALIA no usa estos datos con fines comerciales ni los entrega a terceros para fines propios de estos.',
          ),
        ],
      },
      {
        titulo: '2.4 Autorización y datos sensibles',
        bloques: [
          parrafo(
            'El tratamiento se basa en la autorización previa, expresa e informada del usuario, que la otorga al aceptar esta política al crear su cuenta o, si ya la tenía, en su siguiente ingreso al portal. Cuando la política cambie de versión, el portal pedirá aceptarla de nuevo. El portal guarda constancia de cada aceptación, con fecha y versión.',
          ),
          parrafo(
            'Los soportes de incapacidad que se cargan en Ausencias contienen datos de salud, que la ley considera sensibles. Para ellos:',
          ),
          lista(
            'El usuario no está obligado a autorizar el tratamiento de datos sensibles.',
            'Solo se usan para tramitar y soportar la ausencia.',
            'Solo los ven el usuario, quienes aprueban su solicitud, las personas que AMBIENTALIA autoriza expresamente para tramitar ausencias y los administradores del portal.',
          ),
        ],
      },
      {
        titulo: '2.5 Terceros que procesan datos',
        bloques: [
          parrafo(
            'Estos proveedores procesan datos por cuenta de AMBIENTALIA, solo para las finalidades de esta política:',
          ),
          tabla(
            ['Proveedor', 'Servicio', 'Datos'],
            ['Hostinger', 'Alojamiento del portal y de su base de datos', 'Todos los datos del portal'],
            [
              'Google (Gmail), mediante n8n',
              'Envío de los correos de acceso y de recuperación de contraseña',
              'Nombre y correo',
            ],
            ['Sentry', 'Registro de errores técnicos', 'Datos técnicos del error, que pueden incluir el usuario afectado'],
          ),
          parrafo(
            'Algunos de estos proveedores tienen servidores fuera de Colombia, por lo que los datos pueden almacenarse o procesarse en otros países. Al aceptar esta política, el usuario autoriza esa transmisión.',
          ),
        ],
      },
      {
        titulo: '2.6 Derechos del titular',
        bloques: [
          parrafo('El usuario puede, sin costo:'),
          lista(
            'Conocer, actualizar y rectificar sus datos.',
            'Solicitar la supresión de sus datos.',
            'Revocar la autorización.',
            'Solicitar prueba de la autorización y ser informado del uso que se ha dado a sus datos.',
            'Presentar una queja ante la Superintendencia de Industria y Comercio, después de haber tramitado la consulta o el reclamo ante AMBIENTALIA.',
          ),
          parrafo(
            'La supresión y la revocatoria no proceden mientras exista un deber legal o contractual de conservar los datos.',
          ),
        ],
      },
      {
        titulo: '2.7 Procedimiento para ejercer los derechos',
        bloques: [
          parrafo(
            `Las solicitudes se envían a ${CORREO_CONTACTO} con el asunto “Datos personales”, indicando nombre, identificación y lo que se solicita.`,
          ),
          tabla(
            ['Trámite', 'Para qué sirve', 'Plazo de respuesta'],
            [
              'Consulta',
              'Conocer los datos que tiene el portal y cómo se usan',
              '10 días hábiles desde el recibo, prorrogables hasta por 5 más',
            ],
            [
              'Reclamo',
              'Corregir, actualizar o suprimir datos, revocar la autorización o advertir un incumplimiento',
              '15 días hábiles desde el día siguiente al recibo, prorrogables hasta por 8 más',
            ],
          ),
          parrafo(
            'Si AMBIENTALIA necesita la prórroga, informará antes del vencimiento el motivo y la nueva fecha. Si un reclamo llega incompleto, pedirá completarlo dentro de los 5 días hábiles siguientes al recibo.',
          ),
        ],
      },
      {
        titulo: '2.8 Vigencia y conservación',
        bloques: [
          parrafo(`Esta política rige desde el ${TERMS_EFFECTIVE_DATE}. Los datos se conservan así:`),
          tabla(
            ['Dato', 'Conservación'],
            [
              'Cuenta: nombre, correo, rol y huella de la contraseña',
              'Mientras dure el vínculo con la compañía; después la cuenta se desactiva y se elimina a los 3 años',
            ],
            ['Foto de perfil', 'Hasta que el usuario la retire o se desactive la cuenta'],
            ['Ausencias y sus soportes', '3 años después de terminado el vínculo con la compañía'],
            ['Registros de administración y de errores', '3 años desde que se generan'],
          ),
          parrafo(
            'Vencidos estos plazos, los datos se eliminan, salvo que una norma obligue a conservarlos por más tiempo.',
          ),
        ],
      },
    ],
  },
];

/**
 * La casilla del registro y de la pantalla de aceptación, en trozos: en el
 * registro, `enlace` es el que abre /terminos.
 */
export const CASILLA = {
  antes: 'Acepto las ',
  enlace: 'condiciones de uso',
  despues: ' y autorizo el tratamiento de mis datos personales según la política de AMBIENTALIA S.A.S.',
};

/** La casilla entera, en una sola frase (la pantalla de aceptación la pinta así). */
export const TEXTO_CASILLA = `${CASILLA.antes}${CASILLA.enlace}${CASILLA.despues}`;
```

- [ ] **Step 4: El candado, en rojo SOLO por los dos huecos**

```bash
npx vitest run src/legal/terminos.test.ts
```

Expected: PASS 2 («el recorrido encuentra el texto» y «cada texto publicado está tal cual en el
Anexo»). FAIL 3, **a propósito**:
- «ningún texto lleva un hueco entre corchetes»: lista `TERMS_EFFECTIVE_DATE`, `CORREO_CONTACTO`,
  `LINEA_VERSION`, la celda «Canal de contacto» del §2.1 y los primeros párrafos del §2.7 y del
  §2.8;
- «la fecha de vigencia está puesta…»;
- «el correo de contacto está puesto…» (`expected '[correo de contacto]' to be …`: el mensaje
  enseña la dirección del Anexo; es salida del terminal, no se copia a ningún fichero).

No se tocan los huecos (ver Reglas). Si el del Anexo falla, el array lista las rutas de los textos
que no coinciden (p. ej. `terminos.SECCIONES[1].apartados[3].bloques[1].items[0]`): se corrige la
errata en `terminos.ts`, nunca en el spec.

- [ ] **Step 5: Escribir los tests de la página**

Crear `apps/portal/src/pages/Terminos.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Terminos from './Terminos';
import { LINEA_VERSION, SECCIONES, TITULO_TERMINOS } from '../legal/terminos';

// /terminos: página pública con el texto de legal/terminos.ts. No lee la sesión
// ni pide nada al servidor, así que se pinta sin router y sin token.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/terminos', () => {
  it('pinta el título, la versión y la fecha de vigencia', () => {
    render(<Terminos />);
    expect(screen.getByRole('heading', { level: 1, name: TITULO_TERMINOS })).toBeTruthy();
    expect(screen.getByText(LINEA_VERSION)).toBeTruthy();
  });

  it('pinta las dos secciones y todos sus apartados con título', () => {
    render(<Terminos />);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    for (const seccion of SECCIONES) {
      expect(screen.getByRole('heading', { level: 2, name: seccion.titulo })).toBeTruthy();
      for (const apartado of seccion.apartados) {
        if (apartado.titulo) expect(screen.getByRole('heading', { level: 3, name: apartado.titulo })).toBeTruthy();
      }
    }
  });

  it('los arranques de la sección 1 van en negrita delante de su párrafo', () => {
    render(<Terminos />);
    const arranque = screen.getByText('1.1 Quién puede usarlo.');
    expect(arranque.tagName).toBe('STRONG');
    expect(arranque.parentElement?.textContent).toMatch(/^1\.1 Quién puede usarlo\. El portal es para empleados/);
  });

  it('pinta las tablas con sus cabeceras y sus celdas', () => {
    render(<Terminos />);
    expect(screen.getByRole('cell', { name: '900.700.933-5' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Calle 86 # 24-27, Bogotá D.C., Colombia' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Plazo de respuesta' })).toBeTruthy();
  });

  it('en el celular una tabla ancha se desplaza dentro de su caja, no la página entera', () => {
    render(<Terminos />);
    const tablas = document.querySelectorAll('table');
    expect(tablas).toHaveLength(5);
    for (const t of tablas) expect(t.parentElement?.className).toContain('overflow-x-auto');
  });

  it('no necesita sesión: se pinta sin token y sin pedir nada al servidor', () => {
    localStorage.removeItem('ambientalia_token');
    const red = vi.fn();
    vi.stubGlobal('fetch', red);
    render(<Terminos />);
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(red).not.toHaveBeenCalled();
  });
});

describe('App.tsx: /terminos es pública', () => {
  it('va FUERA de RequireAuth y antes de /*', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const ruta = src.indexOf('<Route path="/terminos" element={<Terminos />} />');
    expect(ruta).toBeGreaterThan(-1);
    expect(ruta).toBeLessThan(src.indexOf('<RequireAuth>'));
    expect(ruta).toBeLessThan(src.indexOf('path="/*"'));
  });
});
```

- [ ] **Step 6: Verlos en rojo**

```bash
npx vitest run src/pages/Terminos.test.tsx
```

Expected: FAIL al cargar el fichero: no se resuelve `./Terminos`.

- [ ] **Step 7: La página**

Crear `apps/portal/src/pages/Terminos.tsx`:

```tsx
import {
  INTRODUCCION,
  LINEA_VERSION,
  SECCIONES,
  TITULO_TERMINOS,
  type Bloque,
} from '../legal/terminos';

// /terminos — pública, fuera de RequireAuth (spec 2026-11-20-terminos, §5). La
// enlazan el registro (todavía sin sesión), la pantalla de aceptación y Ajustes,
// siempre en pestaña nueva. Solo pinta el texto de legal/terminos.ts: no lee la
// sesión ni pide nada al servidor. Mismo fondo y tarjetas que Configuración.

function PintarBloque({ bloque }: { bloque: Bloque }) {
  if (bloque.tipo === 'parrafo') {
    return (
      <p className="text-gray-700 leading-relaxed">
        {bloque.destacado && (
          <>
            <strong className="font-semibold text-gray-900">{bloque.destacado}</strong>{' '}
          </>
        )}
        {bloque.texto}
      </p>
    );
  }
  if (bloque.tipo === 'lista') {
    return (
      <ul className="list-disc pl-6 space-y-1 text-gray-700 leading-relaxed">
        {bloque.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  // Una tabla de tres columnas no cabe en un celular: se desplaza DENTRO de su
  // caja, nunca la página entera.
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm text-left border border-gray-200">
        <thead className="bg-gray-50 text-gray-900">
          <tr>
            {bloque.columnas.map((columna) => (
              <th key={columna} scope="col" className="px-3 py-2 font-semibold border-b border-gray-200">
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloque.filas.map((fila, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              {fila.map((celda, j) => (
                <td key={j} className="px-3 py-2 align-top text-gray-700">
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Terminos() {
  return (
    <div className="min-h-screen bg-[#F7F8FA] text-gray-900">
      <main className="max-w-3xl mx-auto px-4 py-8 md:py-12">
        <article className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-10 space-y-8">
          <header className="space-y-3">
            <h1 className="text-2xl md:text-3xl font-bold text-blue-700">{TITULO_TERMINOS}</h1>
            <p className="text-gray-700 leading-relaxed">{INTRODUCCION}</p>
            <p className="text-sm font-medium text-gray-500">{LINEA_VERSION}</p>
          </header>
          {SECCIONES.map((seccion) => (
            <section key={seccion.titulo} className="space-y-5">
              <h2 className="text-xl font-semibold text-gray-900">{seccion.titulo}</h2>
              {seccion.apartados.map((apartado, i) => (
                <div key={apartado.titulo ?? i} className="space-y-3">
                  {apartado.titulo && <h3 className="text-base font-semibold text-gray-900">{apartado.titulo}</h3>}
                  {apartado.bloques.map((bloque, j) => (
                    <PintarBloque key={j} bloque={bloque} />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </article>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: La ruta pública**

En `apps/portal/src/App.tsx`:

1. Sustituir:

```tsx
import RestablecerContrasena from './pages/RestablecerContrasena';
```

por:

```tsx
import RestablecerContrasena from './pages/RestablecerContrasena';
import Terminos from './pages/Terminos';
```

2. Sustituir:

```tsx
        {/* Restablecer la contraseña desde el enlace del correo — pública, sin sidebar */}
        <Route path="/auth/restablecer" element={<RestablecerContrasena />} />
```

por:

```tsx
        {/* Restablecer la contraseña desde el enlace del correo — pública, sin sidebar */}
        <Route path="/auth/restablecer" element={<RestablecerContrasena />} />

        {/* Condiciones de uso y tratamiento de datos — pública, sin sidebar: la enlazan
            el registro (todavía sin sesión), la pantalla de aceptación y Ajustes */}
        <Route path="/terminos" element={<Terminos />} />
```

- [ ] **Step 9: Verlos en verde**

```bash
npx vitest run src/pages/Terminos.test.tsx src/legal/terminos.test.ts
```

Expected: PASS los 7 de `Terminos.test.tsx`. En `terminos.test.ts`, el mismo resultado del Step 4:
2 PASS y 3 FAIL por los dos huecos, a propósito.

- [ ] **Step 10: Commit**

Desde la raíz del repo:

```bash
git add apps/portal/src/legal/terminos.ts apps/portal/src/legal/terminos.test.ts apps/portal/src/pages/Terminos.tsx apps/portal/src/pages/Terminos.test.tsx apps/portal/src/App.tsx
git commit -m "feat(portal): pagina publica de condiciones de uso y tratamiento de datos"
```

---

### Task 4: hub-api — candado de la versión con el portal

**Files:**
- Create: `apps/hub-api/src/users/terms.test.ts`

- [ ] **Step 1: Escribir el candado**

Crear `apps/hub-api/src/users/terms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CURRENT_TERMS_VERSION } from './terms.js';

// CANDADO: la versión que hub-api da por vigente es la del texto que publica el
// portal. Si no coinciden, la pantalla de aceptación mandaría una versión que
// hub-api rechaza (400) y nadie podría pasar; o hub-api pediría aceptar un texto
// que el portal no enseña. El fichero del portal se lee como TEXTO, no se importa:
// queda fuera de src/ y tsc no lo compilaría (ni el build de Docker, que solo
// copia apps/hub-api). Mismo patrón que access-emails/app-catalog.test.ts.

const PORTAL_TERMINOS = fileURLToPath(new URL('../../../portal/src/legal/terminos.ts', import.meta.url));

/** Las versiones que declara el portal con `export const TERMS_VERSION = '…';`. */
function versionesDelPortal(): string[] {
  const fuente = readFileSync(PORTAL_TERMINOS, 'utf8');
  // Anclado al inicio de línea (`^` con `m`): un comentario que cite la declaración
  // no cuenta como otra versión. Sin `$`: con CRLF fallaría antes del `\r`.
  return [...fuente.matchAll(/^export const TERMS_VERSION = '([^']+)';/gm)].map(([, version]) => version);
}

describe('CANDADO: CURRENT_TERMS_VERSION es la TERMS_VERSION de apps/portal/src/legal/terminos.ts', () => {
  it('el lector encuentra UNA declaración de la versión en el fichero del portal', () => {
    expect(versionesDelPortal()).toHaveLength(1);
  });

  it('las dos versiones coinciden', () => {
    expect(versionesDelPortal()).toEqual([CURRENT_TERMS_VERSION]);
  });
});
```

- [ ] **Step 2: Correrlo**

Desde `apps/hub-api`:

```bash
npx vitest run src/users/terms.test.ts
```

Expected: PASS los 2. Es un candado sobre algo que ya es cierto (las Tasks 2 y 3 ponen `'1.0'` en
los dos lados); el Step 3 demuestra que muerde.

- [ ] **Step 3: Verlo morder y deshacerlo**

En `apps/hub-api/src/users/terms.ts`, sustituir con Edit:

```ts
export const CURRENT_TERMS_VERSION = '1.0';
```

por:

```ts
export const CURRENT_TERMS_VERSION = '9.9';
```

```bash
npx vitest run src/users/terms.test.ts
```

Expected: FAIL «las dos versiones coinciden» (`expected [ '1.0' ] to deeply equal [ '9.9' ]`).

Deshacer con Edit (volver a `export const CURRENT_TERMS_VERSION = '1.0';`) y comprobar:

```bash
npx vitest run src/users/terms.test.ts
git status --short apps/hub-api/src/users/terms.ts
```

Expected: PASS los 2; `git status` sin salida (el fichero queda como en el commit de la Task 2).

- [ ] **Step 4: Commit**

Desde la raíz del repo:

```bash
git add apps/hub-api/src/users/terms.test.ts
git commit -m "test(hub-api): candado de la version de las condiciones de uso con el portal"
```

---

### Task 5: Portal — el estado de las condiciones viaja en la misma consulta de `/users/me`

**Files:**
- Create: `apps/portal/src/lib/terminosSesion.ts`
- Create: `apps/portal/src/lib/terminosSesion.test.ts`
- Modify: `apps/portal/src/hooks/useAuth.ts` (import, línea 3; `cargarAppsDelServidor`, líneas 104-108)
- Modify: `apps/portal/src/hooks/useAuth.test.ts` (tests al final del fichero)

- [ ] **Step 1: Escribir los tests del almacén**

Crear `apps/portal/src/lib/terminosSesion.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { guardarTerminos, leerTerminos, marcarTerminosAceptados, olvidarTerminos } from './terminosSesion';

// El estado de las condiciones de uso de la sesión: lo que dijo GET /api/users/me
// en su campo `terms`, por cuenta. Lógica pura, sin DOM.

beforeEach(() => olvidarTerminos());

describe('terminosSesion', () => {
  it('sin nada guardado no se sabe: null', () => {
    expect(leerTerminos('u1')).toBeNull();
  });

  it('guarda el terms de /users/me y lo devuelve para esa cuenta', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    expect(leerTerminos('u1')).toEqual({ current: '1.0', accepted: false });
  });

  it('lo de una cuenta no vale para otra, ni sin cuenta', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    expect(leerTerminos('u2')).toBeNull();
    expect(leerTerminos(null)).toBeNull();
  });

  it.each([
    ['ausente (hub-api anterior)', undefined],
    ['null', null],
    ['sin accepted', { current: '1.0' }],
    ['con accepted que no es booleano', { current: '1.0', accepted: 'no' }],
    ['con current que no es texto', { current: 1, accepted: false }],
    ['un texto suelto', 'aceptado'],
  ])('un terms %s no se guarda: sin dato no se pide nada', (_caso, valor) => {
    guardarTerminos('u1', valor);
    expect(leerTerminos('u1')).toBeNull();
  });

  it('marcarTerminosAceptados la da por aceptada sin tocar la versión', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    marcarTerminosAceptados('u1');
    expect(leerTerminos('u1')).toEqual({ current: '1.0', accepted: true });
  });

  it('marcar otra cuenta no cambia la guardada', () => {
    guardarTerminos('u1', { current: '1.0', accepted: false });
    marcarTerminosAceptados('u2');
    expect(leerTerminos('u1')).toEqual({ current: '1.0', accepted: false });
    expect(leerTerminos('u2')).toBeNull();
  });
});
```

- [ ] **Step 2: Verlos en rojo**

Desde `apps/portal`:

```bash
npx vitest run src/lib/terminosSesion.test.ts
```

Expected: FAIL al cargar el fichero: no se resuelve `./terminosSesion`.

- [ ] **Step 3: El almacén**

Crear `apps/portal/src/lib/terminosSesion.ts`:

```ts
// Estado de las condiciones de uso del usuario con sesión (spec
// 2026-11-20-terminos-del-servicio, §5): el campo `terms` de GET /api/users/me.
//
// No hace su propia petición: lo rellena hooks/useAuth.ts con la MISMA respuesta
// que trae las apps. hub-api limita /api/users/* a 20 peticiones por minuto por IP
// y el portal ya pide /users/me; otra petición solo para esto gastaría cupo en
// cada carga de página.
//
// Va en su propio módulo y no dentro de useAuth.ts porque varios tests simulan
// useAuth entero (RutaTableroTv, RutaMisEquipos): si la pantalla de aceptación
// leyera de allí, esos tests reventarían por una exportación que su simulación no
// tiene. Aquí, sin nadie que lo rellene, simplemente no hay dato y no se pide nada.
//
// Por cuenta, como la cache de apps: lo de una cuenta no vale para la siguiente
// que entre en la misma pestaña.

export interface TermsStatus {
  /** Versión vigente según hub-api. */
  current: string;
  /** Si este usuario la tiene aceptada. */
  accepted: boolean;
}

let cache: { userId: string; terms: TermsStatus } | null = null;

/**
 * Guarda el `terms` de un perfil. Lo que no tenga la forma esperada (un hub-api
 * que todavía no lo manda, un cuerpo raro) no se guarda: sin dato no se pide la
 * aceptación, y un fallo pasajero no deja a nadie fuera del portal.
 */
export function guardarTerminos(userId: string, valor: unknown): void {
  if (valor === null || typeof valor !== 'object') return;
  const { current, accepted } = valor as { current?: unknown; accepted?: unknown };
  if (typeof current !== 'string' || typeof accepted !== 'boolean') return;
  cache = { userId, terms: { current, accepted } };
}

/** El estado de `userId`, o null si no se sabe (cargando, fallo, hub-api anterior u otra cuenta). */
export function leerTerminos(userId: string | null): TermsStatus | null {
  return userId !== null && cache?.userId === userId ? cache.terms : null;
}

/** Tras un POST /api/users/me/terms con éxito: la pantalla deja de pedirla sin otra petición. */
export function marcarTerminosAceptados(userId: string): void {
  if (cache?.userId === userId) cache = { userId, terms: { ...cache.terms, accepted: true } };
}

/**
 * Vacía lo guardado. La usan los tests para empezar de cero; la app no la
 * necesita: cada cuenta lleva su id y lo de otra no se usa.
 */
export function olvidarTerminos(): void {
  cache = null;
}
```

- [ ] **Step 4: Verlos en verde**

```bash
npx vitest run src/lib/terminosSesion.test.ts
```

Expected: PASS los 11 (5 sueltos y 6 del `it.each`).

- [ ] **Step 5: Escribir los tests de `useAuth`**

En `apps/portal/src/hooks/useAuth.test.ts`, sustituir el final:

```ts
  it('sin sesión no hay nada que esperar: true', async () => {
    h.token = null;
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    expect(result.current.appsConfirmadas).toBe(true);
  });
});
```

por:

```ts
  it('sin sesión no hay nada que esperar: true', async () => {
    h.token = null;
    const useAuth = await cargarUseAuth();
    const { result } = renderHook(() => useAuth());
    expect(result.current.appsConfirmadas).toBe(true);
  });
});

// Condiciones de uso (spec 2026-11-20-terminos, §5): viajan en la MISMA respuesta
// de /users/me que las apps y se guardan en lib/terminosSesion. hub-api limita
// /api/users/* a 20 peticiones por minuto por IP: no se hace otra.
describe('useAuth — guarda las condiciones de uso de la misma respuesta de /users/me', () => {
  beforeEach(() => {
    vi.resetModules();
    h.token = makeToken({
      sub: 'persona@ejemplo.test',
      user_id: 'u1',
      role: 'reader',
      apps: ['ausencias'],
      exp: futureExp(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** El hook y el almacén del MISMO juego de módulos: los dos, detrás de resetModules. */
  async function cargar() {
    const { useAuth } = await import('./useAuth');
    const { leerTerminos } = await import('../lib/terminosSesion');
    return { useAuth, leerTerminos };
  }

  it('las guarda para quien preguntó y quien usa el hook se vuelve a pintar, sin otra petición', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'u1', apps: ['ausencias'], terms: { current: '1.0', accepted: false } }),
    });
    const { useAuth, leerTerminos } = await cargar();
    // Igual que la pantalla de aceptación: usa el hook y lee el almacén al pintar.
    const { result } = renderHook(() => {
      useAuth();
      return leerTerminos('u1');
    });
    expect(result.current).toBeNull();
    await dejarQueRespondaElServidor();
    expect(result.current).toEqual({ current: '1.0', accepted: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/users/me');
  });

  it('las guarda aunque el perfil no traiga apps: una cosa no depende de la otra', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'u1', terms: { current: '1.0', accepted: true } }) });
    const { useAuth, leerTerminos } = await cargar();
    const { result } = renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(leerTerminos('u1')).toEqual({ current: '1.0', accepted: true });
    expect(result.current.apps).toEqual(['ausencias']);
    expect(result.current.appsConfirmadas).toBe(true);
  });

  it('ignora las de un perfil que no es de quien preguntó', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'OTRO', apps: [], terms: { current: '1.0', accepted: false } }),
    });
    const { useAuth, leerTerminos } = await cargar();
    renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(leerTerminos('u1')).toBeNull();
    expect(leerTerminos('OTRO')).toBeNull();
  });

  it('sin terms (hub-api anterior) no guarda nada y las apps llegan igual', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'u1', apps: ['ausencias', 'wo-sales'] }) });
    const { useAuth, leerTerminos } = await cargar();
    const { result } = renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(leerTerminos('u1')).toBeNull();
    expect(result.current.apps).toEqual(['ausencias', 'wo-sales']);
    expect(result.current.appsConfirmadas).toBe(true);
  });

  it('si /users/me falla, no se sabe nada: null', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    const { useAuth, leerTerminos } = await cargar();
    renderHook(() => useAuth());
    await dejarQueRespondaElServidor();
    expect(leerTerminos('u1')).toBeNull();
  });
});
```

- [ ] **Step 6: Verlos en rojo**

```bash
npx vitest run src/hooks/useAuth.test.ts
```

Expected: FAIL 2 de los 5 nuevos, porque `useAuth` todavía no guarda nada:
- «las guarda para quien preguntó…»: `expected null to deeply equal { current: '1.0', accepted: false }`;
- «las guarda aunque el perfil no traiga apps»: `expected null to deeply equal { current: '1.0', accepted: true }`.

Los otros 3 nuevos (perfil ajeno, sin `terms`, fallo) ya pasan: son el candado de que sin dato
válido no se pide nada. Los que ya había, en verde.

- [ ] **Step 7: Guardarlas desde `useAuth`**

En `apps/portal/src/hooks/useAuth.ts`:

1. Sustituir:

```ts
import { authFetch } from '../lib/api';
```

por:

```ts
import { authFetch } from '../lib/api';
import { guardarTerminos } from '../lib/terminosSesion';
```

2. Sustituir:

```ts
    const perfil = (await res.json()) as { id?: unknown; apps?: unknown };
    // Que el perfil sea de quien preguntó: entre la petición y la respuesta ha
    // podido cambiar la sesión, y escribir la cache con el id viejo le daría al
    // recién llegado las apps del anterior.
    if (perfil?.id !== userId) return;
```

por:

```ts
    const perfil = (await res.json()) as { id?: unknown; apps?: unknown; terms?: unknown };
    // Que el perfil sea de quien preguntó: entre la petición y la respuesta ha
    // podido cambiar la sesión, y escribir la cache con el id viejo le daría al
    // recién llegado las apps del anterior.
    if (perfil?.id !== userId) return;
    // Las condiciones de uso viajan en esta MISMA respuesta (spec
    // 2026-11-20-terminos): hub-api limita /api/users/* a 20 peticiones por minuto
    // por IP, y otra solo para esto gastaría cupo en cada carga. Se guardan antes
    // de mirar las apps para que una cosa no dependa de la otra; el aviso del
    // `finally` es lo que vuelve a pintar la pantalla de aceptación.
    guardarTerminos(userId, perfil.terms);
```

- [ ] **Step 8: Verlos en verde**

```bash
npx vitest run src/hooks/useAuth.test.ts src/lib/terminosSesion.test.ts src/components/AppGuard.test.tsx
```

Expected: PASS los tres ficheros (`appsConfirmadas` y `AppGuard` no cambian).

- [ ] **Step 9: Commit**

Desde la raíz del repo:

```bash
git add apps/portal/src/lib/terminosSesion.ts apps/portal/src/lib/terminosSesion.test.ts apps/portal/src/hooks/useAuth.ts apps/portal/src/hooks/useAuth.test.ts
git commit -m "feat(portal): estado de las condiciones de uso desde la misma consulta de users/me"
```

---

### Task 6: Portal — pantalla de aceptación en todas las rutas protegidas

**Files:**
- Create: `apps/portal/src/components/AceptacionTerminos.test.tsx`
- Create: `apps/portal/src/components/AceptacionTerminos.tsx`
- Modify: `apps/portal/src/components/RequireAuth.tsx` (fichero entero, 12 líneas)

- [ ] **Step 1: Escribir los tests**

Crear `apps/portal/src/components/AceptacionTerminos.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UseAuthResult } from '../hooks/useAuth';
import RequireAuth from './RequireAuth';
import { guardarTerminos, leerTerminos, olvidarTerminos } from '../lib/terminosSesion';
import { TERMS_VERSION, TEXTO_CASILLA } from '../legal/terminos';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';
import { logout } from '../auth';

// La pantalla de aceptación de las condiciones de uso, montada como en la app:
// detrás de RequireAuth, delante de una ruta protegida cualquiera. useAuth se
// simula (solo importa el user_id); el estado de las condiciones va por el
// almacén REAL (lib/terminosSesion), que es de donde lee la pantalla.

const estado = vi.hoisted(() => ({ auth: null as UseAuthResult | null, sesion: true }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => estado.auth }));
vi.mock('../auth', () => ({
  isAuthenticated: () => estado.sesion,
  logout: vi.fn(async () => {}),
  RUTA_INICIAR_SESION: '/auth?modo=login',
}));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;
const USUARIO = 'u1';
const TITULO = 'Condiciones de uso y tratamiento de datos';

function montar() {
  return render(
    <MemoryRouter initialEntries={['/contabilidad']}>
      <Routes>
        <Route path="/auth" element={<div>LOGIN</div>} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <div>CONTENIDO PROTEGIDO</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Lo que diría /users/me de alguien sin la versión vigente aceptada. */
const pendiente = () => guardarTerminos(USUARIO, { current: TERMS_VERSION, accepted: false });
const botonAceptar = () => screen.getByRole('button', { name: 'Aceptar y continuar' }) as HTMLButtonElement;
const marcarCasilla = () => fireEvent.click(screen.getByRole('checkbox', { name: TEXTO_CASILLA }));

beforeEach(() => {
  olvidarTerminos();
  estado.sesion = true;
  estado.auth = {
    isAuthenticated: true,
    user_id: USUARIO,
    email: 'persona@ejemplo.test',
    role: 'reader',
    apps: [],
    appsConfirmadas: true,
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AceptacionTerminos (detrás de RequireAuth)', () => {
  it('sin la versión vigente aceptada: la pantalla, en vez del contenido, con sus textos y el enlace', () => {
    pendiente();
    montar();
    expect(screen.getByRole('heading', { name: TITULO })).toBeTruthy();
    expect(
      screen.getByText(
        `Para seguir usando el portal, lee y acepta las condiciones de uso y la política de tratamiento de datos personales de AMBIENTALIA S.A.S. (versión ${TERMS_VERSION}).`,
      ),
    ).toBeTruthy();
    const enlace = screen.getByRole('link', { name: 'Leer el documento completo' });
    expect(enlace.getAttribute('href')).toBe('/terminos');
    expect(enlace.getAttribute('target')).toBe('_blank');
    expect(enlace.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('checkbox', { name: TEXTO_CASILLA })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salir' })).toBeTruthy();
    expect(screen.queryByText('CONTENIDO PROTEGIDO')).toBeNull();
  });

  it('con la vigente aceptada no aparece', () => {
    guardarTerminos(USUARIO, { current: TERMS_VERSION, accepted: true });
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('sin dato (cargando, /users/me falló o hub-api sin terms) no aparece: no deja a nadie fuera', () => {
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('lo que se sabe de otra cuenta no cuenta', () => {
    guardarTerminos('otra-cuenta', { current: TERMS_VERSION, accepted: false });
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
  });

  // Si hub-api publica una versión antes de que llegue el portal con su texto, pedirla
  // sería un callejón sin salida: el portal enviaría la suya y hub-api contestaría 400.
  it('si hub-api pide una versión que este portal no tiene, no aparece', () => {
    guardarTerminos(USUARIO, { current: `${TERMS_VERSION}-otra`, accepted: false });
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('sin sesión, RequireAuth manda al login antes de mirar las condiciones', () => {
    estado.sesion = false;
    pendiente();
    montar();
    expect(screen.getByText('LOGIN')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('«Aceptar y continuar» está deshabilitado hasta marcar la casilla', () => {
    pendiente();
    montar();
    expect(botonAceptar().disabled).toBe(true);
    marcarCasilla();
    expect(botonAceptar().disabled).toBe(false);
  });

  it('aceptar manda la versión a POST /api/users/me/terms, quita la pantalla y sigue a la ruta', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: true }) });
    pendiente();
    montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    expect(await screen.findByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith('/api/users/me/terms', {
      method: 'POST',
      body: JSON.stringify({ version: TERMS_VERSION }),
    });
    expect(leerTerminos(USUARIO)).toEqual({ current: TERMS_VERSION, accepted: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it('mientras se guarda, el botón queda deshabilitado: no se envía dos veces', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    pendiente();
    montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    expect(botonAceptar().disabled).toBe(true);
    fireEvent.click(botonAceptar());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['un error del servidor', () => mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })],
    ['un fallo de red', () => mockFetch.mockRejectedValue(new Error('sin red'))],
  ])('con %s al guardar avisa y la pantalla sigue', async (_caso, preparar) => {
    preparar();
    pendiente();
    montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('No se pudo guardar tu aceptación. Inténtalo de nuevo.', 'error'),
    );
    expect(screen.getByRole('heading', { name: TITULO })).toBeTruthy();
    expect(botonAceptar().disabled).toBe(false);
    expect(leerTerminos(USUARIO)?.accepted).toBe(false);
  });

  it('«Salir» cierra la sesión y lleva a iniciar sesión, sin guardar nada', async () => {
    pendiente();
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByText('LOGIN')).toBeTruthy();
    expect(logout).toHaveBeenCalledOnce();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verlos en rojo**

Desde `apps/portal`:

```bash
npx vitest run src/components/AceptacionTerminos.test.tsx
```

Expected: FAIL 7 de los 12, porque `RequireAuth` todavía pinta el contenido sin mirar las
condiciones: «sin la versión vigente aceptada…», «está deshabilitado hasta marcar», «aceptar
manda la versión…», «mientras se guarda…», los 2 del `it.each` y «Salir» (`Unable to find an
accessible element with the role "heading" and name "Condiciones de uso y tratamiento de datos"`,
o con el role `button`). Los 5 que esperan el contenido o el login ya pasan: son el candado de que
sin dato, con la vigente aceptada, con otra cuenta, con una versión que el portal no tiene o sin
sesión no cambia nada. El de «una versión que este portal no tiene» se hace morder en el Step 4:
quitar `|| terminos.current !== TERMS_VERSION` de la condición, ver que falla, y volver a ponerlo.

- [ ] **Step 3: La pantalla**

Crear `apps/portal/src/components/AceptacionTerminos.tsx`:

```tsx
import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';
import { logout, RUTA_INICIAR_SESION } from '../auth';
import { leerTerminos, marcarTerminosAceptados } from '../lib/terminosSesion';
import { TERMS_VERSION, TEXTO_CASILLA } from '../legal/terminos';

// Pantalla de aceptación de las condiciones de uso (spec 2026-11-20-terminos, §3 y
// §5). Va DENTRO de RequireAuth para cubrir todas las rutas protegidas: el portal,
// la TV del taller y «Mis equipos».
//
// Solo aparece cuando hub-api dice que este usuario NO tiene aceptada la versión
// vigente. Mientras carga, si /users/me falla o si viene de un hub-api sin `terms`,
// se deja pasar: un fallo pasajero no debe dejar a nadie fuera, y la pantalla se
// pedirá en la siguiente carga que funcione. La prueba legal es la fila que guarda
// hub-api; esto solo impide seguir sin aceptar.

export default function AceptacionTerminos({ children }: { children: ReactNode }) {
  // useAuth y no una petición propia: la respuesta de /users/me que trae las apps
  // trae también `terms` (lib/terminosSesion), y su aviso al llegar es lo que
  // vuelve a pintar este componente.
  const { user_id } = useAuth();
  // Solo para volver a pintar tras aceptar: lo que decide es el almacén, que
  // `marcarTerminosAceptados` ya ha puesto al día.
  const [, setRecienAceptada] = useState(false);
  const terminos = leerTerminos(user_id);
  // Solo se pide la versión que este portal sabe mostrar: si hub-api va por delante
  // (otra versión publicada antes que el portal), aceptar daría 400 sin salida.
  if (!user_id || !terminos || terminos.accepted || terminos.current !== TERMS_VERSION) return <>{children}</>;
  return <PantallaTerminos userId={user_id} onAceptada={() => setRecienAceptada(true)} />;
}

function PantallaTerminos({ userId, onAceptada }: { userId: string; onAceptada: () => void }) {
  const navigate = useNavigate();
  const uid = useId();
  const [marcada, setMarcada] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const aceptar = async () => {
    setGuardando(true);
    try {
      // La versión del texto que se enseña, no la que diga hub-api: se acepta lo
      // que se leyó. El candado de hub-api (users/terms.test.ts) las mantiene iguales.
      const res = await authFetch('/api/users/me/terms', {
        method: 'POST',
        body: JSON.stringify({ version: TERMS_VERSION }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      marcarTerminosAceptados(userId);
      onAceptada();
    } catch {
      notify('No se pudo guardar tu aceptación. Inténtalo de nuevo.', 'error');
      setGuardando(false);
    }
  };

  const salir = async () => {
    await logout();
    navigate(RUTA_INICIAR_SESION);
  };

  return (
    <main className="min-h-screen bg-[#F7F8FA] flex items-center justify-center px-4 py-8">
      <section
        aria-labelledby={`${uid}-titulo`}
        className="w-full max-w-lg bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-8 space-y-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-blue-600 shrink-0" aria-hidden="true" />
          <h1 id={`${uid}-titulo`} className="text-xl font-bold text-gray-900">
            Condiciones de uso y tratamiento de datos
          </h1>
        </div>
        <p className="text-gray-700 leading-relaxed">
          Para seguir usando el portal, lee y acepta las condiciones de uso y la política de tratamiento de datos
          personales de AMBIENTALIA S.A.S. (versión {TERMS_VERSION}).
        </p>
        <a
          href="/terminos"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-semibold text-blue-700 hover:underline">
          Leer el documento completo
        </a>
        <div className="flex items-start gap-3">
          <input
            id={`${uid}-casilla`}
            type="checkbox"
            checked={marcada}
            onChange={(e) => setMarcada(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
          />
          <label htmlFor={`${uid}-casilla`} className="text-sm text-gray-700 leading-relaxed">
            {TEXTO_CASILLA}
          </label>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={salir}
            className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50">
            Salir
          </button>
          <button
            type="button"
            onClick={aceptar}
            disabled={!marcada || guardando}
            className="px-4 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            Aceptar y continuar
          </button>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: `RequireAuth` pasa por la pantalla**

En `apps/portal/src/components/RequireAuth.tsx`:

1. Sustituir:

```tsx
import { isAuthenticated } from '../auth';

// Envuelve las rutas protegidas: sin sesión válida → redirige a /auth.
```

por:

```tsx
import { isAuthenticated } from '../auth';
import AceptacionTerminos from './AceptacionTerminos';

// Envuelve las rutas protegidas: sin sesión válida → redirige a /auth. Con sesión,
// pasa por la aceptación de las condiciones de uso antes de pintar nada protegido:
// así la pantalla cubre el portal, la TV del taller y «Mis equipos», que son las
// tres rutas que usan este guardia.
```

2. Sustituir:

```tsx
  return <>{children}</>;
```

por:

```tsx
  return <AceptacionTerminos>{children}</AceptacionTerminos>;
```

- [ ] **Step 5: Verlos en verde, y las rutas que ya usaban `RequireAuth`**

```bash
npx vitest run src/components/AceptacionTerminos.test.tsx src/components/RutaTableroTv.test.tsx src/components/RutaMisEquipos.test.tsx src/components/AppGuard.test.tsx
```

Expected: PASS los cuatro ficheros. Los de la TV y «Mis equipos» simulan `useAuth` y nadie rellena
el almacén: sin dato no hay pantalla y se comportan igual que antes.

- [ ] **Step 6: Commit**

Desde la raíz del repo:

```bash
git add apps/portal/src/components/AceptacionTerminos.tsx apps/portal/src/components/AceptacionTerminos.test.tsx apps/portal/src/components/RequireAuth.tsx
git commit -m "feat(portal): pantalla de aceptacion de las condiciones de uso en las rutas protegidas"
```

---

### Task 7: Portal — casilla del registro y enlace en Ajustes

**Files:**
- Modify: `apps/portal/src/components/Auth/AuthRightPanel.test.tsx` (import, línea 11; tests al final)
- Modify: `apps/portal/src/components/Auth/AuthRightPanel.tsx` (import, línea 5; cuerpo del
  registro, líneas 100-104; casilla, líneas 311-316)
- Modify: `apps/portal/src/pages/Configuracion.test.tsx` (test al final)
- Modify: `apps/portal/src/pages/Configuracion.tsx` (import de iconos, línea 2; tarjeta tras
  «Miembro desde», línea 240)

- [ ] **Step 1: Escribir los tests del registro**

En `apps/portal/src/components/Auth/AuthRightPanel.test.tsx`:

1. Sustituir:

```tsx
import { setToken } from '../../auth';
```

por:

```tsx
import { setToken } from '../../auth';
import { TERMS_VERSION, TEXTO_CASILLA } from '../../legal/terminos';
```

2. Sustituir el final:

```tsx
  ])('%s, al inicio', async (_caso, state) => {
    entrarDesde(state);
    expect((await screen.findByTestId('destino')).textContent).toBe('/');
  });
});
```

por:

```tsx
  ])('%s, al inicio', async (_caso, state) => {
    entrarDesde(state);
    expect((await screen.findByTestId('destino')).textContent).toBe('/');
  });
});

// Condiciones de uso (spec 2026-11-20-terminos, §5): la casilla dice qué se acepta,
// enlaza el texto y, marcada, manda la versión para que quede constancia.
describe('AuthRightPanel — condiciones de uso', () => {
  function rellenar() {
    fill('Juan Pérez', 'Persona Prueba');
    fill('tu@ejemplo.com', 'persona@ejemplo.test');
    fill('••••••••', 'clave-ficticia-1');
  }
  const cuerpoEnviado = () =>
    JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;

  it('la casilla dice el texto de la política y «condiciones de uso» abre /terminos en pestaña nueva', () => {
    renderSignup();
    expect(screen.getByRole('checkbox').closest('label')?.textContent).toBe(TEXTO_CASILLA);
    const enlace = screen.getByRole('link', { name: 'condiciones de uso' });
    expect(enlace.getAttribute('href')).toBe('/terminos');
    expect(enlace.getAttribute('target')).toBe('_blank');
    expect(enlace.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('con la casilla marcada, el registro manda termsVersion', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 201, json: async () => ({}) } as unknown as Response);
    const { container } = renderSignup();
    rellenar();
    fireEvent.click(screen.getByRole('checkbox'));
    submit(container);
    await screen.findByText(/pendiente de aprobación/i);
    expect(cuerpoEnviado()).toEqual({
      fullName: 'Persona Prueba',
      email: 'persona@ejemplo.test',
      password: 'clave-ficticia-1',
      termsVersion: TERMS_VERSION,
    });
  });

  it('sin la casilla marcada no manda termsVersion: no hay aceptación de la que dejar constancia', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 201, json: async () => ({}) } as unknown as Response);
    const { container } = renderSignup();
    rellenar();
    submit(container);
    await screen.findByText(/pendiente de aprobación/i);
    expect(cuerpoEnviado()).not.toHaveProperty('termsVersion');
  });
});
```

- [ ] **Step 2: Escribir el test de Ajustes**

En `apps/portal/src/pages/Configuracion.test.tsx`, sustituir el final:

```tsx
    const ocultar = screen.getAllByRole('button', { name: 'Ocultar contraseñas' });
    expect(ocultar[0].getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Nueva Contraseña') as HTMLInputElement).type).toBe('text');
  });
});
```

por:

```tsx
    const ocultar = screen.getAllByRole('button', { name: 'Ocultar contraseñas' });
    expect(ocultar[0].getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Nueva Contraseña') as HTMLInputElement).type).toBe('text');
  });
});

// Condiciones de uso (spec 2026-11-20-terminos, §5): el texto aceptado, a mano.
describe('Configuración · condiciones de uso', () => {
  it('enlaza «Condiciones de uso y datos personales» a /terminos en pestaña nueva', () => {
    render(<Configuracion />);
    const enlace = screen.getByRole('link', { name: 'Condiciones de uso y datos personales' });
    expect(enlace.getAttribute('href')).toBe('/terminos');
    expect(enlace.getAttribute('target')).toBe('_blank');
    expect(enlace.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
```

- [ ] **Step 3: Verlos en rojo**

Desde `apps/portal`:

```bash
npx vitest run src/components/Auth/AuthRightPanel.test.tsx src/pages/Configuracion.test.tsx
```

Expected: FAIL 3 de los 4 nuevos:
- «la casilla dice el texto…»: `expected 'Acepto todos los términos de servicio' to be 'Acepto las condiciones de uso y autorizo…'`;
- «con la casilla marcada…»: el cuerpo no trae `termsVersion` (`toEqual` falla);
- Ajustes: `Unable to find an accessible element with the role "link" and name "Condiciones de uso y datos personales"`.

«sin la casilla marcada no manda termsVersion» ya pasa: es el candado de que solo viaja si se marcó.
Los que ya había, en verde.

- [ ] **Step 4: La casilla del registro**

En `apps/portal/src/components/Auth/AuthRightPanel.tsx`:

1. Sustituir:

```tsx
import { notify } from '../../lib/notify';
```

por:

```tsx
import { notify } from '../../lib/notify';
import { CASILLA, TERMS_VERSION } from '../../legal/terminos';
```

2. Sustituir:

```tsx
        body: JSON.stringify({
          fullName: formData.fullName.trim(),
          email: formData.email.trim(),
          password: formData.password,
        }),
```

por:

```tsx
        body: JSON.stringify({
          fullName: formData.fullName.trim(),
          email: formData.email.trim(),
          password: formData.password,
          // Constancia de la aceptación (Ley 1581): solo si la casilla está marcada.
          // hub-api la guarda si es la versión vigente; si no, crea la cuenta igual
          // y la pantalla de aceptación se la pedirá al entrar.
          ...(agreeTerms ? { termsVersion: TERMS_VERSION } : {}),
        }),
```

3. Sustituir:

```tsx
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                Acepto todos los{' '}
                <a href="#" className="text-cyan-400 hover:text-cyan-300 transition-colors">
                  términos de servicio
                </a>
              </span>
```

por:

```tsx
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                {CASILLA.antes}
                {/* Pestaña nueva: el formulario a medio rellenar no se pierde. */}
                <a
                  href="/terminos"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 transition-colors">
                  {CASILLA.enlace}
                </a>
                {CASILLA.despues}
              </span>
```

- [ ] **Step 5: El enlace en Ajustes**

En `apps/portal/src/pages/Configuracion.tsx`:

1. Sustituir:

```tsx
import { User, Mail, Lock, KeyRound, Shield, Camera, Save, Clock, Eye, EyeOff } from 'lucide-react';
```

por:

```tsx
import { User, Mail, Lock, KeyRound, Shield, Camera, Save, Clock, Eye, EyeOff, FileText } from 'lucide-react';
```

2. Sustituir:

```tsx
                  <p className="text-lg font-bold text-blue-700">{formatDate(profile.created_at)}</p>
                </div>
              </div>
            )}
          </div>
```

por:

```tsx
                  <p className="text-lg font-bold text-blue-700">{formatDate(profile.created_at)}</p>
                </div>
              </div>
            )}

            {/* Condiciones de uso y política de datos: el texto que la persona aceptó.
                <a> y pestaña nueva, como en el registro y en la pantalla de
                aceptación: /terminos es pública y Ajustes no se pierde. */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                <FileText className="w-5 h-5" />
              </div>
              <a
                href="/terminos"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-blue-700 hover:underline">
                Condiciones de uso y datos personales
              </a>
            </div>
          </div>
```

- [ ] **Step 6: Verlos en verde**

```bash
npx vitest run src/components/Auth/AuthRightPanel.test.tsx src/pages/Configuracion.test.tsx
```

Expected: PASS los dos ficheros (los 4 nuevos y todos los que ya había).

- [ ] **Step 7: Commit**

Desde la raíz del repo:

```bash
git add apps/portal/src/components/Auth/AuthRightPanel.tsx apps/portal/src/components/Auth/AuthRightPanel.test.tsx apps/portal/src/pages/Configuracion.tsx apps/portal/src/pages/Configuracion.test.tsx
git commit -m "feat(portal): casilla del registro y enlace en Ajustes a las condiciones de uso"
```

---

### Task 8: Verificación final, fecha de vigencia y correo de contacto

- [ ] **Step 1: Suites completas**

Desde `apps/hub-api`:

```bash
npm test
```

Expected: PASS, con los umbrales de cobertura en verde. (Si el test 4.4 de users cae por timeout
solo bajo carga, relanzar ese fichero solo: es un fallo conocido y ajeno a este cambio.)

Desde `apps/portal`:

```bash
npm test
```

Expected: todo PASS **salvo** `src/legal/terminos.test.ts`, con exactamente 3 FAIL a propósito:
«ningún texto lleva un hueco entre corchetes», «la fecha de vigencia está puesta…» y «el correo de
contacto está puesto…». Cualquier otro rojo es un fallo de verdad y se arregla antes de seguir.

- [ ] **Step 2: Tipos y lint**

Desde `apps/hub-api`:

```bash
npx tsc --noEmit -p .
```

Expected: sin salida, exit 0.

Desde `apps/portal`:

```bash
npx tsc -b
npx eslint src/legal/terminos.ts src/legal/terminos.test.ts src/pages/Terminos.tsx src/pages/Terminos.test.tsx src/App.tsx src/lib/terminosSesion.ts src/lib/terminosSesion.test.ts src/hooks/useAuth.ts src/hooks/useAuth.test.ts src/components/AceptacionTerminos.tsx src/components/AceptacionTerminos.test.tsx src/components/RequireAuth.tsx src/components/Auth/AuthRightPanel.tsx src/components/Auth/AuthRightPanel.test.tsx src/pages/Configuracion.tsx src/pages/Configuracion.test.tsx
```

Expected: sin salida en los dos (antes de este cambio, los ficheros existentes de la lista
pasaban eslint sin avisos).

- [ ] **Step 3: Tests contra Postgres (Docker)**

Arrancar Docker Desktop si no lo está y esperar a «Engine running»; `docker info` debe responder
sin error. Desde `apps/hub-api`:

```bash
npm run test:db
```

Expected: PASS toda la suite de BD (tarda unos minutos), incluidos los 9 de
`src/users/terms.db.test.ts`. Los ficheros que borran usuarios (p. ej. `seed-from-env.db.test.ts`)
siguen en verde: la FK nueva es `ON DELETE CASCADE`. Si en la Task 1 no se pudo correr con Docker,
este es el paso que lo cubre: no se fusiona sin haberlo visto en verde.

- [ ] **Step 4: Estado del spec**

En `docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md`, sustituir:

```markdown
**Estado:** diseño aprobado; pendiente del plan de implementación.
```

por:

```markdown
**Estado:** implementado en la rama `feat/terminos` (plan
`docs/superpowers/plans/2026-11-20-terminos-del-servicio.md`); pendiente de fijar la fecha de
vigencia y el correo de contacto, fusionar y desplegar (hub-api primero, luego el portal).
```

Desde la raíz del repo:

```bash
git add docs/superpowers/specs/2026-11-20-terminos-del-servicio-design.md
git commit -m "docs(portal): estado de las condiciones de uso"
```

- [ ] **Step 5: Fecha de vigencia y correo de contacto (lo hace el CONTROLADOR, con el usuario)**

El subagente se detiene aquí. El controlador:

1. Pregunta al usuario, y espera su respuesta: «¿Qué día vas a desplegar el portal? Esa será la
   fecha de vigencia de las condiciones (se escribe así: 24 de noviembre de 2026)».

2. Con la respuesta, en `apps/portal/src/legal/terminos.ts`, sustituye con Edit:

```ts
export const TERMS_EFFECTIVE_DATE = '[fecha de vigencia]';
```

   por la fecha que dijo el usuario, con ese formato. Por ejemplo, para el 24 de noviembre de 2026:

```ts
export const TERMS_EFFECTIVE_DATE = '24 de noviembre de 2026';
```

3. Le pide al usuario que escriba él la dirección de contacto (las herramientas de los agentes no
   pueden): «Abre `apps/portal/src/legal/terminos.ts`, busca
   `export const CORREO_CONTACTO = '[correo de contacto]';` y cambia `[correo de contacto]` por la
   dirección de la fila "Canal de contacto" del §2.1 del Anexo del spec, entre las mismas comillas
   simples. Guarda y avísame». Espera a que lo confirme.

4. Desde `apps/portal` (si el filtro de privacidad bloquea el comando, se le pide al usuario que
   lo lance él con `!`):

```bash
npx vitest run src/legal/terminos.test.ts
npm test
```

   Expected: PASS los 5 de `terminos.test.ts` (el del correo confirma que es el del Anexo) y PASS
   toda la suite del portal.

5. Es el último commit antes de fusionar. Desde la raíz del repo:

```bash
git add apps/portal/src/legal/terminos.ts
git commit -m "chore(portal): fecha de vigencia y contacto de las condiciones de uso"
```

- [ ] **Step 6: Privacidad (el repo es público) y estado final**

Desde la raíz del repo, en Git Bash:

```bash
git diff main...HEAD -U0 -- . ':(exclude)apps/portal/src/legal/terminos.ts' | grep '^+' | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort -u
git diff main...HEAD -U0 -- apps/portal/src/legal/terminos.ts | grep '^+' | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | sort | uniq -c
git log --oneline main..HEAD
git status --short
```

Expected:
- la primera, solo `persona@ejemplo.test` y `tu@ejemplo.com` (este es el placeholder del campo de
  correo del registro, que ya existía: los tests lo usan para encontrar el campo);
- la segunda, una sola línea con cuenta `1`: la dirección de `CORREO_CONTACTO`, la misma de la fila
  «Canal de contacto» del Anexo (la excepción decidida por el usuario). Cualquier otra dirección se
  cambia por una ficticia antes de seguir;
- 9 commits en la rama (Tasks 1-7, el del spec y el del Step 5);
- `git status` solo con lo del usuario (` M .gitignore` y las carpetas `??`).

**Despliegue (lo hace el usuario a mano en EasyPanel; empujar no despliega):** hub-api primero (al
arrancar aplica la 079 y ya responde `terms`), luego el portal (spec §8). En cualquier orden no se
rompe nada, pero en este nadie ve la pantalla antes de que hub-api pueda guardar la aceptación.

**Comprobación tras desplegar (usuario, en el navegador):**
- `/terminos` en una ventana privada, sin sesión: se ve el texto con la fecha de vigencia y el
  correo de contacto.
- Entrar con una cuenta que ya existía: aparece la pantalla; «Aceptar y continuar» se habilita al
  marcar la casilla; al aceptar se entra a la ruta pedida y al recargar no vuelve a salir.
- «Salir» en la pantalla lleva a «Iniciar sesión».
- La TV del taller con sesión y «Mis equipos» en el celular piden lo mismo la primera vez.
- Un registro nuevo con la casilla marcada: tras aprobar la cuenta, su primer acceso no muestra
  la pantalla.
