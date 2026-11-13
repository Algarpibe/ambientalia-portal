# Recuperación de contraseña por correo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que quien ha olvidado su contraseña del portal elija una nueva sin depender de nadie, con un
enlace de un solo uso que le llega por correo y caduca a los 30 minutos.

**Architecture:** módulo nuevo `apps/hub-api/src/users/password-reset/` en piezas de una sola
responsabilidad. `PasswordResetService` aplica las reglas (quién recibe enlace, frenos por cuenta,
caducidad, validación de la clave) y habla con dos puertos: `PasswordResetStore`, que implementa
`PasswordResetRepository` (SQL y transacciones sobre la tabla nueva `portal.password_reset_tokens`,
migración 077, que solo guarda la huella SHA-256 del token), y `ResetMailer`, que implementa
`createResetMailer` (cliente del webhook de n8n que nunca lanza). Los dos correos son funciones puras.
`createPasswordResetRouter` expone `POST /api/auth/forgot-password` y `POST /api/auth/reset-password`,
públicas y con rate limit por IP; `index.ts` lo monta junto al router de usuarios. En el portal, un
tercer modo «¿Olvidaste tu contraseña?» en el panel de acceso y la página pública `/auth/restablecer`,
que lee el token de `#t=` y lo quita de la URL. El correo sale por un flujo nuevo de n8n
(Webhook con Header Auth → Gmail → Respond 200).

**Tech Stack:** hub-api (Express 4, TypeScript ESM con imports `.js`, SQL crudo sobre `pg`, bcryptjs,
express-rate-limit 7, Vitest 2 + supertest, `*.db.test.ts` con testcontainers y Postgres 17); portal
(React 19, react-router-dom 7, Tailwind 3.4, lucide-react, Vitest 4 + jsdom + Testing Library con
`fireEvent`); n8n (vía MCP).

**Spec:** `docs/superpowers/specs/2026-11-13-recuperacion-contrasena-design.md`.
**Rama:** `feat/recuperacion-contrasena`, en una worktree propia (Task 0).

---

## Reglas para quien implemente

- **TDD estricto:** cada test se ve en ROJO, y por la razón esperada, antes de escribir el código.
- **Editar solo con Edit/Write.** Nunca `Set-Content`, `sed -i` ni `perl -pi`: corrompen las tildes.
- **Commits:** convencionales, en español, sin tildes ni eñes, **sin ninguna línea de atribución**
  (nada de `Co-Authored-By`), con rutas explícitas (`git add <ruta> <ruta>`, nunca `git add -A` ni
  `git add .`).
- **No tocar** `.gitignore` ni los ficheros sin seguimiento del usuario (`.atl/`, `img/`, `openspec/`,
  `apps/WO-sales/prompts/`). **Nunca `git stash` sin rutas.**
- **El repo es PÚBLICO:** ni correos reales ni secretos en código, tests, documentación o commits. En
  los tests, direcciones del estilo `persona@ejemplo.test`.
- **No lanzar vitest desde la raíz del repo** (se cuelan los `*.db.test.ts` y salen ~281 fallos
  falsos): siempre desde `apps/hub-api` o `apps/portal`.
- **Los tests de BD necesitan Docker.** Si no responde:
  `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"` y esperar a que arranque.
- **Comentarios** en español explicando el porqué. En los `*.db.test.ts`, sin tildes (convención de
  esos ficheros).
- **Candado de Trazabilidad** (`apps/hub-api/src/trazabilidad/envio-avisos.test.ts`, «CANDADO: el canal
  de salida»): ningún fuente nuevo de hub-api puede contener la palabra `remitir`, y `index.ts` no puede
  nombrar `envio-avisos`. Al citar ese patrón en un comentario, decir «el canal de avisos de
  Trazabilidad», sin la ruta entre comillas ni acentos graves.
- **`apps/hub-api/.env.example`:** si leerlo está bloqueado por permisos, no sortear el bloqueo con la
  shell: pedir al usuario que pegue a mano las líneas de la Task 4.
- **`apps/hub-api/src/users/users.service.ts`:** la spec dice que no se toca; la única excepción es
  exportar `BCRYPT_COST` y `MIN_PASSWORD_LENGTH` (Task 3), para no duplicar dos constantes de seguridad.

## File Structure

Todas las rutas son relativas a la raíz de la worktree.

| Fichero | Qué es / qué cambia |
|---|---|
| `apps/hub-api/src/users/migrations/077_password_reset_tokens.sql` | NUEVO. Tabla `portal.password_reset_tokens`, índice por usuario y fecha, permisos a `portal_app` (DATA-332) |
| `apps/hub-api/src/db.ts` | `077_password_reset_tokens.sql` al final de `MIGRATIONS` (L102) |
| `apps/hub-api/src/ausencias/notas.estatico.test.ts` | L16-18: la 076 deja de ser la última |
| `apps/hub-api/src/users/password-reset/migracion.test.ts` | NUEVO. La 077 sin BD: apuntada, idempotente, huella y permisos |
| `apps/hub-api/src/users/password-reset/password-reset.emails.ts` | NUEVO. `escapeHtml`, `resetLink`, `buildResetLinkEmail`, `buildPasswordChangedEmail` (puras) |
| `apps/hub-api/src/users/password-reset/password-reset.emails.test.ts` | NUEVO |
| `apps/hub-api/src/users/password-reset/password-reset.service.ts` | NUEVO. Puertos (`PasswordResetStore`, `ResetMailer`), `PasswordResetError`, `hashToken`, `generateToken`, `logEvent`, `PasswordResetService` |
| `apps/hub-api/src/users/password-reset/test-fakes.ts` | NUEVO. Solo para tests: `FakeStore`, `FakeMailer`, `FakeClock` |
| `apps/hub-api/src/users/password-reset/password-reset.service.test.ts` | NUEVO |
| `apps/hub-api/src/users/users.service.ts` | L9-10: `export` en `BCRYPT_COST` y `MIN_PASSWORD_LENGTH` |
| `apps/hub-api/src/users/password-reset/password-reset.mailer.ts` | NUEVO. `createResetMailer`: POST al webhook de n8n, nunca lanza |
| `apps/hub-api/src/users/password-reset/password-reset.mailer.test.ts` | NUEVO |
| `apps/hub-api/.env.example` | + `PASSWORD_RESET_N8N_URL` y `PASSWORD_RESET_N8N_TOKEN` (INFRA-537) |
| `apps/hub-api/src/users/password-reset/password-reset.repository.ts` | NUEVO. `PasswordResetRepository implements PasswordResetStore` |
| `apps/hub-api/src/users/password-reset/password-reset.repository.db.test.ts` | NUEVO. Contra Postgres real |
| `apps/hub-api/src/users/password-reset/password-reset.router.ts` | NUEVO. Las dos rutas, sus rate limits y el mapeo de errores |
| `apps/hub-api/src/users/password-reset/password-reset.router.test.ts` | NUEVO. supertest + montaje en `index.ts` |
| `apps/hub-api/src/index.ts` | Imports (tras L8) y montaje del router justo detrás de `createUsersRouter` (L129) |
| `apps/portal/src/components/Auth/recuperacion.ts` | NUEVO. `ModoAuth` y los mensajes compartidos |
| `apps/portal/src/components/Auth/OlvidoContrasena.tsx` | NUEVO. El modo «¿Olvidaste tu contraseña?» |
| `apps/portal/src/components/Auth/AuthRightPanel.tsx` | Enlace bajo la contraseña, estado `olvido`, prop `olvidoInicial` |
| `apps/portal/src/components/Auth/AuthRightPanel.test.tsx` | + `describe` del modo «olvidé» |
| `apps/portal/src/components/Auth/AuthCard.tsx` | Lee `location.state.modo` (`login` / `olvido`) |
| `apps/portal/src/components/Auth/AuthCard.test.tsx` | NUEVO |
| `apps/portal/src/pages/RestablecerContrasena.tsx` | NUEVO. Página pública `/auth/restablecer` |
| `apps/portal/src/pages/RestablecerContrasena.test.tsx` | NUEVO |
| `apps/portal/src/App.tsx` | Ruta pública `/auth/restablecer` (junto a `/auth`, L56) |
| `docs/n8n-automatizaciones.md` | + §2.4, el flujo «Portal — Restablecer contraseña» |

**Lo que NO cambia, a propósito:** `apps/portal/src/lib/interceptor401.ts`. Solo actúa ante un `401`
de hub-api, y las dos rutas nuevas responden `200`, `400` o `429` (`invalid_or_expired_token` es 400 y
no 401 justo para que el interceptor no lo tome por una sesión caducada). Tampoco el `Dockerfile` de
hub-api: ya copia la carpeta `migrations` entera a `dist` (L62).

---

### Task 0: Rama y worktree

**Files:** ninguno del código.

- [ ] **Step 1: Commitear este plan en `main` si aún no lo está**

```bash
git status --short docs/superpowers/plans/2026-11-13-recuperacion-contrasena.md
```

Si sale con `??`:

```bash
git add docs/superpowers/plans/2026-11-13-recuperacion-contrasena.md
git commit -m "docs(portal): plan de la recuperacion de contrasena por correo"
```

- [ ] **Step 2: Crear la worktree (junto al repo, nunca en `/tmp`)**

```bash
git worktree add ../antigravity-suite-R1.07-worktrees/recuperacion-contrasena -b feat/recuperacion-contrasena main
```

Desde aquí, todos los comandos se lanzan desde la raíz de esa worktree.

- [ ] **Step 3: Instalar dependencias**

```bash
cd ../antigravity-suite-R1.07-worktrees/recuperacion-contrasena && npm ci
```

Si `npm ci` falla al bajar `@algarpibe/zoho-sync` (registro privado), parar y preguntar al usuario.
No copiar `node_modules` de otra copia ni tocar `.npmrc`. Si se va a usar CodeGraph en la worktree,
inicializar su propio índice con `gentle-ai codegraph init --cwd <ruta absoluta de la worktree>`
(nunca copiar el `.codegraph/` de la copia principal).

- [ ] **Step 4: Línea base en verde**

```bash
cd apps/hub-api && npm test
cd apps/portal && npx vitest run
```

Esperado: todo en verde. Si cae `4.4 — registrar un email ya existente lanza 409…` de
`users.service.test.ts`, relanzarlo solo (`npx vitest run src/users/users.service.test.ts`): se cae
por timeout únicamente bajo carga.

---

### Task 1: Migración 077 — tabla de tokens de restablecimiento

**Files:**
- Create: `apps/hub-api/src/users/password-reset/migracion.test.ts`
- Create: `apps/hub-api/src/users/migrations/077_password_reset_tokens.sql`
- Modify: `apps/hub-api/src/db.ts` (L102, final del array `MIGRATIONS`)
- Modify: `apps/hub-api/src/ausencias/notas.estatico.test.ts` (L16-18)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/users/password-reset/migracion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La migración 077 sin base de datos: que está apuntada, que se puede repetir
// en cada arranque, que guarda la huella y no el token, y que da permisos a
// portal_app. Lo que hace contra Postgres lo vigila
// password-reset.repository.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_077 = leer('../migrations/077_password_reset_tokens.sql');
// Sin comentarios: el texto explicativo puede nombrar DROP o INSERT sin ser sentencia.
const SIN_COMENTARIOS = SQL_077.replace(/--.*$/gm, '');

describe('migración 077 (tokens de restablecimiento de contraseña)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 076, y es la última', () => {
    expect(leer('../../db.ts')).toMatch(/'076_ausencias_notas\.sql',\s*'077_password_reset_tokens\.sql'\];/);
  });

  it('no siembra, ni cambia, ni borra nada (se re-ejecuta en cada arranque)', () => {
    expect(SIN_COMENTARIOS).not.toMatch(/INSERT\s+INTO|UPDATE\s+portal|\b(DROP|TRUNCATE|ALTER)\b|DELETE\s+FROM/i);
  });

  it('solo DDL idempotente: una tabla y un índice, los dos IF NOT EXISTS', () => {
    const creates = SIN_COMENTARIOS.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^;]*/g) || [];
    expect(creates).toHaveLength(2);
    expect(creates.filter((c) => !/IF NOT EXISTS/.test(c))).toEqual([]);
  });

  it('guarda la huella del token (única), nunca el token, y se borra con el usuario', () => {
    expect(SIN_COMENTARIOS).toMatch(/token_hash\s+TEXT NOT NULL UNIQUE/);
    expect(SIN_COMENTARIOS).not.toMatch(/\btoken\s+TEXT/i);
    expect(SIN_COMENTARIOS).toMatch(/REFERENCES portal\.users\(id\) ON DELETE CASCADE/);
  });

  it('da sus permisos a portal_app si existe (DATA-332)', () => {
    expect(SIN_COMENTARIOS).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SIN_COMENTARIOS).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON portal\.password_reset_tokens TO portal_app/);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/migracion.test.ts
```

Esperado: FALLA al cargar el fichero con `ENOENT` sobre `077_password_reset_tokens.sql`.

- [ ] **Step 3: Crear la migración**

Crear `apps/hub-api/src/users/migrations/077_password_reset_tokens.sql`:

```sql
-- Migration 077: tokens de restablecimiento de contraseña (recuperación por correo).
--
-- Cada fila es un enlace «restablecer contraseña» enviado por correo. Solo se
-- guarda la huella SHA-256 (hex) del token: el token en claro viaja en el enlace
-- y en ningún otro sitio, así que con acceso a la BD no se puede reconstruir un
-- enlace válido.
--
-- `used_at` marca un token gastado o anulado (al pedir otro, o al restablecer):
-- en los dos casos deja de valer. Las horas las pone hub-api (reloj inyectable),
-- no now() de la BD.
--
-- Idempotente: las migraciones se re-ejecutan en cada arranque.

CREATE TABLE IF NOT EXISTS portal.password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Los frenos por cuenta (último enlace y cuántos en la última hora) leen por aquí.
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON portal.password_reset_tokens (user_id, created_at DESC);

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da. La
-- 068 concede ALL TABLES, pero corre antes que esta en el mismo arranque. No hay
-- secuencia que conceder: el id es UUID.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.password_reset_tokens TO portal_app;
  END IF;
END $$;
```

- [ ] **Step 4: Apuntarla en `MIGRATIONS`**

En `apps/hub-api/src/db.ts` (L102), sustituir el final del array:

```ts
'076_ausencias_notas.sql'];
```

por:

```ts
'076_ausencias_notas.sql', '077_password_reset_tokens.sql'];
```

- [ ] **Step 5: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/migracion.test.ts
```

Esperado: 5 tests en verde.

- [ ] **Step 6: Ver en rojo el test que daba la 076 por última**

```bash
cd apps/hub-api && npx vitest run src/ausencias/notas.estatico.test.ts
```

Esperado: FALLA `está apuntada en MIGRATIONS, detrás de la 075, y es la última` (la regex exige
`'076_ausencias_notas.sql'];`).

- [ ] **Step 7: Relajarlo como se hizo con la 075**

En `apps/hub-api/src/ausencias/notas.estatico.test.ts`, sustituir:

```ts
  it('está apuntada en MIGRATIONS, detrás de la 075, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'075_equipos_tablero_tema_tv\.sql',\s*'076_ausencias_notas\.sql'\];/);
  });
```

por:

```ts
  // Ya no es la última (la 077 de la recuperación de contraseña va detrás):
  // basta con que esté justo detrás de la 075. Mismo relevo que en
  // equipos/migracion.test.ts con la 075.
  it('está apuntada en MIGRATIONS, detrás de la 075', () => {
    expect(leer('../db.ts')).toMatch(/'075_equipos_tablero_tema_tv\.sql',\s*'076_ausencias_notas\.sql'[,\]]/);
  });
```

- [ ] **Step 8: Ver los dos en verde**

```bash
cd apps/hub-api && npx vitest run src/ausencias/notas.estatico.test.ts src/users/password-reset/migracion.test.ts
```

Esperado: PASA.

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/users/migrations/077_password_reset_tokens.sql apps/hub-api/src/db.ts apps/hub-api/src/users/password-reset/migracion.test.ts apps/hub-api/src/ausencias/notas.estatico.test.ts
git commit -m "feat(hub-api): tabla de tokens para restablecer la contrasena (migracion 077)"
```

---

### Task 2: Los dos correos (funciones puras)

**Files:**
- Create: `apps/hub-api/src/users/password-reset/password-reset.emails.test.ts`
- Create: `apps/hub-api/src/users/password-reset/password-reset.emails.ts`

No hay ningún `escapeHtml` en hub-api (todos los correos actuales son texto plano), así que se crea
aquí.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/users/password-reset/password-reset.emails.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPasswordChangedEmail, buildResetLinkEmail, escapeHtml, resetLink } from './password-reset.emails.js';

// Asunto y cuerpo de los dos correos de la recuperación de contraseña. Puras:
// ni red, ni reloj, ni entorno.

const PORTAL = 'https://portal.ejemplo.test';
const TOKEN = 'AbC123_-xyz';
const ENLACE = `${PORTAL}/auth/restablecer#t=${TOKEN}`;
const CORREO_EN_TEXTO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe('resetLink', () => {
  it('lleva el token tras #t=, en /auth/restablecer', () => {
    expect(resetLink(PORTAL, TOKEN)).toBe(ENLACE);
  });

  it('no duplica la barra si la base acaba en /', () => {
    expect(resetLink(`${PORTAL}/`, TOKEN)).toBe(ENLACE);
  });
});

describe('escapeHtml', () => {
  it('escapa los cinco caracteres con significado en HTML', () => {
    expect(escapeHtml(`<b>"Ana" & 'Luis'</b>`)).toBe('&lt;b&gt;&quot;Ana&quot; &amp; &#39;Luis&#39;&lt;/b&gt;');
  });
});

describe('buildResetLinkEmail', () => {
  const correo = buildResetLinkEmail({ fullName: 'Ana Ruiz', portalUrl: PORTAL, token: TOKEN });

  it('asunto fijo', () => {
    expect(correo.asunto).toBe('Restablecer tu contraseña del Portal Ambientalia');
  });

  it('el enlace va como botón y también en texto, con el token tras #t=', () => {
    expect(correo.cuerpo.split(`href="${ENLACE}"`).length - 1).toBe(2);
    expect(correo.cuerpo).toContain(`>${ENLACE}</a>`);
  });

  it('saluda por el nombre y explica la caducidad, el solo uso y qué hacer si no lo pidió', () => {
    expect(correo.cuerpo).toContain('Hola, Ana Ruiz:');
    expect(correo.cuerpo).toContain('30 minutos');
    expect(correo.cuerpo).toContain('una sola vez');
    expect(correo.cuerpo).toContain('tu contraseña no cambia');
  });

  it('escapa el nombre: lo escribió la persona al registrarse', () => {
    const c = buildResetLinkEmail({ fullName: '<script>alert(1)</script>', portalUrl: PORTAL, token: TOKEN });
    expect(c.cuerpo).not.toContain('<script>');
    expect(c.cuerpo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('buildPasswordChangedEmail', () => {
  // 03:30 UTC del 14 son las 22:30 del 13 en Bogotá (UTC-5): manda la hora de Colombia.
  const correo = buildPasswordChangedEmail({ fullName: 'Ana Ruiz', changedAt: new Date('2026-11-14T03:30:00Z') });

  it('asunto fijo', () => {
    expect(correo.asunto).toBe('Tu contraseña del Portal Ambientalia se ha cambiado');
  });

  it('saluda por el nombre y da fecha y hora de Colombia', () => {
    expect(correo.cuerpo).toContain('Hola, Ana Ruiz:');
    expect(correo.cuerpo).toContain('13 de noviembre de 2026');
    expect(correo.cuerpo).toContain('22:30');
    expect(correo.cuerpo).not.toContain('14 de noviembre');
  });

  it('pide avisar al administrador y no trae ningún correo de contacto (el repo es público)', () => {
    expect(correo.cuerpo).toContain('avisa al administrador');
    expect(correo.cuerpo).not.toMatch(CORREO_EN_TEXTO);
  });

  it('escapa el nombre', () => {
    const c = buildPasswordChangedEmail({ fullName: 'Ana <b>Ruiz</b>', changedAt: new Date('2026-11-14T03:30:00Z') });
    expect(c.cuerpo).toContain('Ana &lt;b&gt;Ruiz&lt;/b&gt;');
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.emails.test.ts
```

Esperado: FALLA al cargar, porque `./password-reset.emails.js` no existe.

- [ ] **Step 3: Implementar los correos**

Crear `apps/hub-api/src/users/password-reset/password-reset.emails.ts`:

```ts
/**
 * Asunto y cuerpo de los dos correos de la recuperación de contraseña: el del
 * enlace y el aviso de que la contraseña cambió. Funciones puras —ni red, ni
 * reloj, ni entorno—; los envía password-reset.mailer.ts.
 *
 * HTML sencillo con estilos en línea (los clientes de correo ignoran las hojas
 * de estilo). El nombre de la persona se escapa siempre: lo escribió ella al
 * registrarse, y un `<` suelto rompería el correo o colaría marcado.
 */

/** Lo que lleva cada correo; el destinatario lo pone quien lo envía. */
export interface ResetEmailContent {
  asunto: string;
  cuerpo: string;
}

/** Fecha y hora de Colombia, p. ej. «13 de noviembre de 2026, 22:30». */
const FECHA_COLOMBIA = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Bogota',
});

/** Escapa los cinco caracteres con significado en HTML (vale para texto y atributos). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * El enlace del correo. El token va tras el `#`, que el navegador no envía al
 * servidor: no queda en los logs de nginx ni en la cabecera Referer.
 */
export function resetLink(portalUrl: string, token: string): string {
  return `${portalUrl.replace(/\/+$/, '')}/auth/restablecer#t=${token}`;
}

const envolver = (html: string): string =>
  `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">${html}</div>`;

/** El correo con el enlace para elegir una contraseña nueva. */
export function buildResetLinkEmail({
  fullName,
  portalUrl,
  token,
}: {
  fullName: string;
  portalUrl: string;
  token: string;
}): ResetEmailContent {
  const nombre = escapeHtml(fullName);
  const enlace = escapeHtml(resetLink(portalUrl, token));
  return {
    asunto: 'Restablecer tu contraseña del Portal Ambientalia',
    cuerpo: envolver(
      `<p>Hola, ${nombre}:</p>` +
        '<p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta del Portal Ambientalia.</p>' +
        `<p><a href="${enlace}" style="display: inline-block; padding: 10px 18px; background: #1abc9c; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">Elegir una contraseña nueva</a></p>` +
        `<p>Si el botón no funciona, copia este enlace en el navegador:<br><a href="${enlace}">${enlace}</a></p>` +
        '<p>El enlace vale 30 minutos y se puede usar una sola vez.</p>' +
        '<p>Si no lo has pedido tú, puedes ignorar este correo: tu contraseña no cambia.</p>',
    ),
  };
}

/** El aviso que sale después de cambiar la contraseña. */
export function buildPasswordChangedEmail({ fullName, changedAt }: { fullName: string; changedAt: Date }): ResetEmailContent {
  return {
    asunto: 'Tu contraseña del Portal Ambientalia se ha cambiado',
    cuerpo: envolver(
      `<p>Hola, ${escapeHtml(fullName)}:</p>` +
        `<p>La contraseña de tu cuenta del Portal Ambientalia se cambió el ${FECHA_COLOMBIA.format(changedAt)} (hora de Colombia).</p>` +
        '<p>Si no fuiste tú, avisa al administrador del portal cuanto antes.</p>',
    ),
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.emails.test.ts
```

Esperado: 11 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/users/password-reset/password-reset.emails.ts apps/hub-api/src/users/password-reset/password-reset.emails.test.ts
git commit -m "feat(hub-api): correos de restablecer y de contrasena cambiada"
```

---

### Task 3: El servicio — reglas, frenos y caducidad

**Files:**
- Create: `apps/hub-api/src/users/password-reset/test-fakes.ts`
- Create: `apps/hub-api/src/users/password-reset/password-reset.service.test.ts`
- Create: `apps/hub-api/src/users/password-reset/password-reset.service.ts`
- Modify: `apps/hub-api/src/users/users.service.ts` (L9-10)

- [ ] **Step 1: Crear los dobles**

Crear `apps/hub-api/src/users/password-reset/test-fakes.ts`:

```ts
import type { UserStatus } from '../users.types.js';
import type {
  ConsumeTokenInput,
  CreateTokenInput,
  PasswordResetStore,
  ResetEmail,
  ResetMailer,
  ResetUser,
  ResetUserRef,
  TokenStats,
} from './password-reset.service.js';

// Solo para los tests de la recuperación de contraseña (servicio y router).
// Dobles en memoria de los dos puertos del servicio y un reloj que se mueve a
// mano. FakeStore imita la semántica del SQL de password-reset.repository.ts,
// la que vigila password-reset.repository.db.test.ts contra Postgres: si uno
// cambia, el otro también.

const DAY_MS = 24 * 60 * 60_000;

export interface FakeUser extends ResetUser {
  passwordHash: string;
  tokenVersion: number;
}

export interface FakeToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export class FakeStore implements PasswordResetStore {
  users: FakeUser[] = [];
  tokens: FakeToken[] = [];
  private seq = 0;

  addUser({ email, fullName = 'Ana Ruiz', status = 'active' }: { email: string; fullName?: string; status?: UserStatus }): FakeUser {
    const user: FakeUser = {
      id: `user-${++this.seq}`,
      email: email.trim().toLowerCase(),
      fullName,
      status,
      passwordHash: 'hash-viejo',
      tokenVersion: 0,
    };
    this.users.push(user);
    return user;
  }

  userById(id: string): FakeUser {
    const user = this.users.find((u) => u.id === id);
    if (!user) throw new Error(`FakeStore: no existe el usuario ${id}`);
    return user;
  }

  async findUserByEmail(email: string): Promise<ResetUser | null> {
    const u = this.users.find((x) => x.email === email.trim().toLowerCase());
    return u ? { id: u.id, email: u.email, fullName: u.fullName, status: u.status } : null;
  }

  async recentTokenStats(userId: string, since: Date): Promise<TokenStats> {
    const suyos = this.tokens.filter((t) => t.userId === userId);
    const lastCreatedAt = suyos.reduce<Date | null>(
      (max, t) => (max === null || t.createdAt.getTime() > max.getTime() ? t.createdAt : max),
      null,
    );
    return { lastCreatedAt, countSince: suyos.filter((t) => t.createdAt.getTime() >= since.getTime()).length };
  }

  async createToken({ userId, tokenHash, expiresAt, now }: CreateTokenInput): Promise<void> {
    for (const t of this.tokens) if (t.userId === userId && t.usedAt === null) t.usedAt = now;
    this.tokens = this.tokens.filter((t) => t.expiresAt.getTime() >= now.getTime() - DAY_MS);
    this.tokens.push({ userId, tokenHash, expiresAt, usedAt: null, createdAt: now });
  }

  async consumeAndSetPassword({ tokenHash, passwordHash, now }: ConsumeTokenInput): Promise<ResetUserRef | null> {
    const token = this.tokens.find(
      (t) => t.tokenHash === tokenHash && t.usedAt === null && t.expiresAt.getTime() > now.getTime(),
    );
    if (!token) return null;
    const user = this.users.find((u) => u.id === token.userId);
    // La transacción de verdad hace ROLLBACK: ni el token ni la clave cambian.
    if (!user || user.status !== 'active') return null;
    token.usedAt = now;
    user.passwordHash = passwordHash;
    user.tokenVersion += 1;
    for (const t of this.tokens) if (t.userId === user.id && t.usedAt === null) t.usedAt = now;
    return { userId: user.id, email: user.email, fullName: user.fullName };
  }
}

export class FakeMailer implements ResetMailer {
  sent: ResetEmail[] = [];
  /** Con true, `send` rechaza (el mailer de verdad no lo hace nunca). */
  fail = false;

  async send(email: ResetEmail): Promise<void> {
    if (this.fail) throw new Error('n8n caído');
    this.sent.push(email);
  }
}

export class FakeClock {
  constructor(private t: number) {}

  readonly now = (): Date => new Date(this.t);

  advance(ms: number): void {
    this.t += ms;
  }

  set(ms: number): void {
    this.t = ms;
  }
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `apps/hub-api/src/users/password-reset/password-reset.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  MAX_REQUESTS_PER_HOUR,
  MIN_REQUEST_INTERVAL_MS,
  PasswordResetError,
  PasswordResetService,
  RESET_TOKEN_TTL_MS,
  generateToken,
  hashToken,
  type ResetLog,
} from './password-reset.service.js';
import { FakeClock, FakeMailer, FakeStore } from './test-fakes.js';

// Las reglas de la recuperación de contraseña sin BD ni red: repositorio,
// correo y reloj son dobles (test-fakes.ts). Los tokens salen de una secuencia
// fija (token-1, token-2…) salvo en el test que mira el generador de verdad.

const PORTAL = 'https://portal.ejemplo.test';
const T0 = Date.parse('2026-11-13T15:00:00.000Z');
const MIN = 60_000;
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
/** El error con el que rechaza una promesa, o null si resuelve. */
const fallo = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

function montar({ tokenReal = false }: { tokenReal?: boolean } = {}) {
  const store = new FakeStore();
  const mailer = new FakeMailer();
  const reloj = new FakeClock(T0);
  const eventos: { event: string; data: Record<string, unknown> }[] = [];
  const log: ResetLog = (event, data = {}) => {
    eventos.push({ event, data });
  };
  let n = 0;
  const service = new PasswordResetService({
    store,
    mailer,
    now: reloj.now,
    portalUrl: PORTAL,
    bcryptCost: 4,
    log,
    randomToken: tokenReal ? undefined : () => `token-${++n}`,
  });
  return { store, mailer, reloj, eventos, service };
}

/** Una cuenta activa con un enlace ya pedido (token-1), y correo y log vacíos. */
async function conEnlace() {
  const m = montar();
  const ana = m.store.addUser({ email: 'ana@ejemplo.test', fullName: 'Ana Ruiz' });
  await m.service.requestReset('ana@ejemplo.test');
  m.mailer.sent.length = 0;
  m.eventos.length = 0;
  return { ...m, ana };
}

describe('generateToken y hashToken', () => {
  it('el token son 32 bytes aleatorios en base64url (43 caracteres) y no se repite', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('la huella es SHA-256 en hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('requestReset', () => {
  it('una cuenta active recibe el enlace, con el correo normalizado y el token tras #t=', async () => {
    const { store, mailer, eventos, service } = montar();
    const ana = store.addUser({ email: 'ana@ejemplo.test', fullName: 'Ana Ruiz' });
    await service.requestReset('  ANA@Ejemplo.test ');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].para).toBe('ana@ejemplo.test');
    expect(mailer.sent[0].asunto).toBe('Restablecer tu contraseña del Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`href="${PORTAL}/auth/restablecer#t=token-1"`);
    // El log lleva el id, nunca el correo.
    expect(eventos).toEqual([{ event: 'password_reset_requested', data: { user_id: ana.id } }]);
  });

  it.each(['pending', 'inactive'] as const)('una cuenta %s no recibe nada', async (status) => {
    const { store, mailer, eventos, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test', status });
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toEqual([]);
    expect(store.tokens).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('un correo desconocido no recibe nada y no falla', async () => {
    const { store, mailer, eventos, service } = montar();
    await service.requestReset('nadie@ejemplo.test');
    expect(mailer.sent).toEqual([]);
    expect(store.tokens).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('al repositorio solo llega la huella SHA-256, nunca el token', async () => {
    const { store, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    expect(store.tokens).toHaveLength(1);
    expect(store.tokens[0].tokenHash).toBe(sha256('token-1'));
    expect(JSON.stringify(store.tokens)).not.toContain('token-1');
  });

  it('el enlace caduca a los 30 minutos de pedirlo', async () => {
    const { store, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    expect(RESET_TOKEN_TTL_MS).toBe(30 * MIN);
    expect(store.tokens[0].expiresAt.getTime()).toBe(T0 + 30 * MIN);
  });

  it('freno: si el último salió hace menos de 2 minutos no crea ni envía (password_reset_frenado)', async () => {
    const { store, mailer, reloj, eventos, service } = montar();
    const ana = store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    reloj.advance(2 * MIN - 1);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(1);
    expect(store.tokens).toHaveLength(1);
    expect(eventos.at(-1)).toEqual({ event: 'password_reset_frenado', data: { user_id: ana.id } });

    reloj.advance(1);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(2);
    expect(MIN_REQUEST_INTERVAL_MS).toBe(2 * MIN);
  });

  it('freno: como mucho 5 en una hora; el sexto sale cuando el primero deja la ventana', async () => {
    const { store, mailer, reloj, eventos, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    for (let i = 0; i < 5; i++) {
      await service.requestReset('ana@ejemplo.test');
      reloj.advance(3 * MIN);
    }
    expect(mailer.sent).toHaveLength(5);

    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(5);
    expect(eventos.at(-1)?.event).toBe('password_reset_frenado');

    // A los 60 minutos justos el primero (T0) sigue dentro de la ventana.
    reloj.set(T0 + 60 * MIN);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(5);

    reloj.set(T0 + 60 * MIN + 1);
    await service.requestReset('ana@ejemplo.test');
    expect(mailer.sent).toHaveLength(6);
    expect(MAX_REQUESTS_PER_HOUR).toBe(5);
  });

  it('un enlace nuevo anula el anterior: el primero deja de valer', async () => {
    const { store, reloj, service } = montar();
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    reloj.advance(3 * MIN);
    await service.requestReset('ana@ejemplo.test');

    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(await fallo(service.resetPassword('token-2', 'clave-nueva-1'))).toBeNull();
  });

  it('sin randomToken usa generateToken: 32 bytes en base64url, y a la BD va su huella', async () => {
    const { store, mailer, service } = montar({ tokenReal: true });
    store.addUser({ email: 'ana@ejemplo.test' });
    await service.requestReset('ana@ejemplo.test');
    const token = /#t=([^"<]+)"/.exec(mailer.sent[0].cuerpo)?.[1] ?? '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.tokens[0].tokenHash).toBe(sha256(token));
  });
});

describe('resetPassword', () => {
  it('clave de menos de 8 caracteres → password_too_short (400), y el enlace sigue sin gastar', async () => {
    const { store, service, ana } = await conEnlace();
    const error = await fallo(service.resetPassword('token-1', '1234567'));
    expect(error).toBeInstanceOf(PasswordResetError);
    expect(error).toMatchObject({ code: 'password_too_short', status: 400 });
    expect(store.tokens[0].usedAt).toBeNull();
    expect(store.userById(ana.id).passwordHash).toBe('hash-viejo');
  });

  it('una clave que no es texto → password_too_short', async () => {
    const { service } = await conEnlace();
    expect(await fallo(service.resetPassword('token-1', 12345678))).toMatchObject({ code: 'password_too_short' });
  });

  it.each([
    ['vacío', ''],
    ['que no es texto', 42],
    ['ausente', undefined],
    ['desconocido', 'token-que-nadie-pidio'],
  ])('token %s → invalid_or_expired_token (400)', async (_caso, token) => {
    const { service } = await conEnlace();
    expect(await fallo(service.resetPassword(token, 'clave-nueva-1'))).toMatchObject({
      code: 'invalid_or_expired_token',
      status: 400,
    });
  });

  it('restablece: guarda el bcrypt de la clave nueva, sube token_version y gasta el enlace', async () => {
    const { store, eventos, service, ana } = await conEnlace();
    await service.resetPassword('token-1', 'clave-nueva-1');
    const u = store.userById(ana.id);
    expect(await bcrypt.compare('clave-nueva-1', u.passwordHash)).toBe(true);
    expect(u.tokenVersion).toBe(1);
    expect(store.tokens[0].usedAt).toEqual(new Date(T0));
    expect(eventos).toContainEqual({ event: 'password_reset_completed', data: { user_id: ana.id } });
  });

  it('tras restablecer avisa por correo a la propia cuenta', async () => {
    const { mailer, service } = await conEnlace();
    await service.resetPassword('token-1', 'clave-nueva-1');
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    expect(mailer.sent[0]).toMatchObject({
      para: 'ana@ejemplo.test',
      asunto: 'Tu contraseña del Portal Ambientalia se ha cambiado',
    });
  });

  it('vale hasta un milisegundo antes de los 30 minutos', async () => {
    const { reloj, service } = await conEnlace();
    reloj.advance(30 * MIN - 1);
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toBeNull();
  });

  it('a los 30 minutos ya no vale, y la clave no cambia', async () => {
    const { store, reloj, service, ana } = await conEnlace();
    reloj.advance(30 * MIN);
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(store.userById(ana.id).passwordHash).toBe('hash-viejo');
  });

  it('solo sirve una vez', async () => {
    const { store, service, ana } = await conEnlace();
    await service.resetPassword('token-1', 'clave-nueva-1');
    expect(await fallo(service.resetPassword('token-1', 'otra-clave-2'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(store.userById(ana.id).tokenVersion).toBe(1);
  });

  it('si la cuenta deja de estar activa antes de usar el enlace → invalid_or_expired_token', async () => {
    const { store, service, ana } = await conEnlace();
    store.userById(ana.id).status = 'inactive';
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toMatchObject({ code: 'invalid_or_expired_token' });
    expect(store.userById(ana.id).passwordHash).toBe('hash-viejo');
  });

  it('si el aviso falla, el restablecimiento no se deshace', async () => {
    const { store, mailer, eventos, service, ana } = await conEnlace();
    mailer.fail = true;
    expect(await fallo(service.resetPassword('token-1', 'clave-nueva-1'))).toBeNull();
    expect(store.userById(ana.id).tokenVersion).toBe(1);
    await vi.waitFor(() =>
      expect(eventos).toContainEqual({ event: 'password_reset_envio_fallido', data: { user_id: ana.id } }),
    );
  });

  it('sin bcryptCost usa el coste del registro (12)', async () => {
    const store = new FakeStore();
    const ana = store.addUser({ email: 'ana@ejemplo.test' });
    const service = new PasswordResetService({
      store,
      mailer: new FakeMailer(),
      now: new FakeClock(T0).now,
      portalUrl: PORTAL,
      randomToken: () => 'token-1',
      log: () => {},
    });
    await service.requestReset('ana@ejemplo.test');
    await service.resetPassword('token-1', 'clave-nueva-1');
    expect(store.userById(ana.id).passwordHash).toMatch(/^\$2[ab]\$12\$/);
  });
});
```

- [ ] **Step 3: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.service.test.ts
```

Esperado: FALLA al cargar, porque `./password-reset.service.js` no existe.

- [ ] **Step 4: Exportar las dos constantes de `users.service.ts`**

En `apps/hub-api/src/users/users.service.ts`, sustituir:

```ts
const BCRYPT_COST = 12; // Requirement 1.3: coste mínimo 12
const MIN_PASSWORD_LENGTH = 8; // Requirement 1.6
```

por:

```ts
// Exportadas para la recuperación de contraseña (password-reset/): la clave
// nueva sigue las mismas reglas que la del registro, sin copiar los números.
export const BCRYPT_COST = 12; // Requirement 1.3: coste mínimo 12
export const MIN_PASSWORD_LENGTH = 8; // Requirement 1.6
```

- [ ] **Step 5: Implementar el servicio**

Crear `apps/hub-api/src/users/password-reset/password-reset.service.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { BCRYPT_COST, MIN_PASSWORD_LENGTH } from '../users.service.js';
import type { UserStatus } from '../users.types.js';
import { buildPasswordChangedEmail, buildResetLinkEmail } from './password-reset.emails.js';

/**
 * Reglas de la recuperación de contraseña por correo (spec 2026-11-13): quién
 * recibe enlace, los frenos por cuenta, la caducidad y la validación de la
 * clave nueva. No sabe de SQL ni de red: habla con el repositorio y con el
 * correo a través de los dos puertos de abajo, y recibe el reloj para que los
 * tests controlen el tiempo.
 */

/** Cuánto vale un enlace. */
export const RESET_TOKEN_TTL_MS = 30 * 60_000;
/** Freno por cuenta: no sale otro enlace si el último salió hace menos de esto. */
export const MIN_REQUEST_INTERVAL_MS = 2 * 60_000;
/** Freno por cuenta: enlaces como mucho en la última hora. */
export const MAX_REQUESTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60_000;

/** Lo que hace falta saber de la cuenta para decidir si se manda el enlace. */
export interface ResetUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
}

/** A quién se le acaba de cambiar la contraseña (para el aviso). */
export interface ResetUserRef {
  userId: string;
  email: string;
  fullName: string;
}

/** Cuándo se creó el último enlace de la cuenta y cuántos desde `since`. */
export interface TokenStats {
  lastCreatedAt: Date | null;
  countSince: number;
}

export interface CreateTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
}

export interface ConsumeTokenInput {
  tokenHash: string;
  passwordHash: string;
  now: Date;
}

/** Puerto del repositorio: lo implementan PasswordResetRepository (SQL) y, en los tests, FakeStore. */
export interface PasswordResetStore {
  findUserByEmail(email: string): Promise<ResetUser | null>;
  recentTokenStats(userId: string, since: Date): Promise<TokenStats>;
  /** En una transacción: anula los enlaces sin usar de la cuenta, borra los caducados hace más de un día y guarda el nuevo. */
  createToken(input: CreateTokenInput): Promise<void>;
  /**
   * En una transacción: gasta el token si vale, comprueba que la cuenta siga
   * activa, cambia la clave subiendo token_version y anula los demás enlaces.
   * null (y nada cambia) si el token no vale o la cuenta ya no está activa.
   */
  consumeAndSetPassword(input: ConsumeTokenInput): Promise<ResetUserRef | null>;
}

/** Un correo listo para el webhook de n8n. */
export interface ResetEmail {
  para: string;
  asunto: string;
  cuerpo: string;
}

/** Puerto del correo. El de verdad (createResetMailer) nunca rechaza. */
export interface ResetMailer {
  send(email: ResetEmail): Promise<void>;
}

/** Una línea de log estructurada: el evento y sus datos (nunca el correo de la persona). */
export type ResetLog = (event: string, data?: Record<string, unknown>) => void;

export const logEvent: ResetLog = (event, data = {}) => {
  console.log(JSON.stringify({ event, ...data }));
};

export type PasswordResetErrorCode = 'password_too_short' | 'invalid_or_expired_token';

/** Error de negocio de restablecer; el router lo traduce a `400 { error: code }`. */
export class PasswordResetError extends Error {
  readonly status = 400;

  constructor(public readonly code: PasswordResetErrorCode) {
    super(code);
    this.name = 'PasswordResetError';
  }
}

/** La huella que se guarda en la BD: SHA-256 en hex. Sin sal ni bcrypt: el token ya trae 256 bits de azar. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 32 bytes aleatorios en base64url: el valor que solo viaja en el enlace del correo. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface PasswordResetDeps {
  store: PasswordResetStore;
  mailer: ResetMailer;
  now: () => Date;
  /** Base pública del portal (urlPortal()). */
  portalUrl: string;
  /** Solo para los tests; el servidor usa BCRYPT_COST, el mismo que el registro. */
  bcryptCost?: number;
  /** Solo para los tests; el servidor usa generateToken. */
  randomToken?: () => string;
  log?: ResetLog;
}

export class PasswordResetService {
  private readonly store: PasswordResetStore;
  private readonly mailer: ResetMailer;
  private readonly now: () => Date;
  private readonly portalUrl: string;
  private readonly bcryptCost: number;
  private readonly randomToken: () => string;
  private readonly log: ResetLog;

  constructor(deps: PasswordResetDeps) {
    this.store = deps.store;
    this.mailer = deps.mailer;
    this.now = deps.now;
    this.portalUrl = deps.portalUrl;
    this.bcryptCost = deps.bcryptCost ?? BCRYPT_COST;
    this.randomToken = deps.randomToken ?? generateToken;
    this.log = deps.log ?? logEvent;
  }

  /**
   * Pide un enlace. Nunca delata si la cuenta existe: el router ya respondió
   * antes de llamar aquí, y los casos que no mandan nada (desconocida, no
   * activa, frenada) terminan en silencio. Solo rechaza ante un fallo de
   * verdad (la BD), que el router manda al log.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.store.findUserByEmail(email.trim().toLowerCase());
    // Una cuenta pending o inactive no podría entrar aunque cambiara la clave.
    if (!user || user.status !== 'active') return;

    const now = this.now();
    const stats = await this.store.recentTokenStats(user.id, new Date(now.getTime() - HOUR_MS));
    const muyPronto =
      stats.lastCreatedAt !== null && now.getTime() - stats.lastCreatedAt.getTime() < MIN_REQUEST_INTERVAL_MS;
    if (muyPronto || stats.countSince >= MAX_REQUESTS_PER_HOUR) {
      this.log('password_reset_frenado', { user_id: user.id });
      return;
    }

    const token = this.randomToken();
    // A la BD solo llega la huella: el token en claro vive en el correo y en ningún otro sitio.
    await this.store.createToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      now,
    });
    await this.mailer.send({
      para: user.email,
      ...buildResetLinkEmail({ fullName: user.fullName, portalUrl: this.portalUrl, token }),
    });
    this.log('password_reset_requested', { user_id: user.id });
  }

  /**
   * Cambia la clave con un enlace. Recibe el cuerpo tal cual (por eso `unknown`)
   * y lanza PasswordResetError si la clave es corta o el enlace no vale.
   * Cierra todas las sesiones (token_version) y no inicia ninguna.
   */
  async resetPassword(token: unknown, newPassword: unknown): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new PasswordResetError('password_too_short');
    }
    if (typeof token !== 'string' || token === '') {
      throw new PasswordResetError('invalid_or_expired_token');
    }

    // bcrypt ANTES de la transacción: son cientos de milisegundos que no deben
    // pasarse con filas bloqueadas.
    const passwordHash = await bcrypt.hash(newPassword, this.bcryptCost);
    const now = this.now();
    const user = await this.store.consumeAndSetPassword({ tokenHash: hashToken(token), passwordHash, now });
    if (!user) throw new PasswordResetError('invalid_or_expired_token');

    this.log('password_reset_completed', { user_id: user.userId });
    // El aviso sale sin esperar: la respuesta no depende de él, y un fallo del
    // correo no deshace un cambio que ya está confirmado en la BD. El mailer de
    // verdad nunca rechaza; el catch cubre a cualquier otro que lo hiciera.
    void this.mailer
      .send({ para: user.email, ...buildPasswordChangedEmail({ fullName: user.fullName, changedAt: now }) })
      .catch(() => this.log('password_reset_envio_fallido', { user_id: user.userId }));
  }
}
```

- [ ] **Step 6: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.service.test.ts
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 7: Comprobar que exportar las constantes no cambia nada en usuarios**

```bash
cd apps/hub-api && npx vitest run src/users/users.service.test.ts src/users.integration.test.ts
```

Esperado: PASA (si cae solo `4.4`, relanzar el fichero solo; ver Task 0).

- [ ] **Step 8: Commit**

```bash
git add apps/hub-api/src/users/password-reset/password-reset.service.ts apps/hub-api/src/users/password-reset/password-reset.service.test.ts apps/hub-api/src/users/password-reset/test-fakes.ts apps/hub-api/src/users/users.service.ts
git commit -m "feat(hub-api): servicio de recuperacion de contrasena con frenos por cuenta"
```

---

### Task 4: El mailer — cliente del webhook de n8n que nunca lanza

**Files:**
- Create: `apps/hub-api/src/users/password-reset/password-reset.mailer.test.ts`
- Create: `apps/hub-api/src/users/password-reset/password-reset.mailer.ts`
- Modify: `apps/hub-api/.env.example` (al final)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/users/password-reset/password-reset.mailer.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MAILER_TIMEOUT_MS, TOKEN_HEADER, createResetMailer } from './password-reset.mailer.js';

// El cliente del webhook de n8n de la recuperación de contraseña. Nada de aquí
// llama a la red: la red es de mentira, y el log y captureError también.

const URL_N8N = 'https://n8n.ejemplo.test/webhook/portal-restablecer-contrasena';
const ENV = { PASSWORD_RESET_N8N_URL: URL_N8N, PASSWORD_RESET_N8N_TOKEN: 'token-ficticio' };
const CORREO = { para: 'persona@ejemplo.test', asunto: 'Asunto ficticio', cuerpo: '<p>Cuerpo ficticio</p>' };

/** Una red de mentira que apunta lo que se le pide y contesta lo que se le diga. */
function red(contestar: () => Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  return {
    llamadas,
    fn: async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return contestar();
    },
  };
}

/** El log y captureError de mentira. */
function registro() {
  const eventos: { event: string; data: Record<string, unknown> }[] = [];
  const errores: unknown[] = [];
  return {
    eventos,
    errores,
    log: (event: string, data: Record<string, unknown> = {}) => {
      eventos.push({ event, data });
    },
    report: (e: unknown) => {
      errores.push(e);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('createResetMailer', () => {
  it('hace POST a la URL con la cabecera del token y el cuerpo {para, asunto, cuerpo}, sin seguir redirecciones', async () => {
    const r = red(async () => new Response('{"ok":true}', { status: 200 }));
    const reg = registro();
    await createResetMailer({ env: ENV, net: r.fn, log: reg.log, report: reg.report }).send(CORREO);
    expect(r.llamadas).toHaveLength(1);
    const { url, init } = r.llamadas[0];
    expect(url).toBe(URL_N8N);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Password-Reset-Token': 'token-ficticio' });
    expect(JSON.parse(String(init.body))).toEqual(CORREO);
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(reg.eventos).toEqual([]);
    expect(reg.errores).toEqual([]);
  });

  it('la espera máxima es de 10 s, con AbortSignal.timeout', async () => {
    const espia = vi.spyOn(AbortSignal, 'timeout');
    const reg = registro();
    await createResetMailer({ env: ENV, net: red(async () => new Response('', { status: 200 })).fn, log: reg.log, report: reg.report }).send(CORREO);
    expect(MAILER_TIMEOUT_MS).toBe(10_000);
    expect(espia).toHaveBeenCalledWith(10_000);
    expect(TOKEN_HEADER).toBe('X-Password-Reset-Token');
  });

  it.each([
    ['un 500', async () => new Response('', { status: 500 })],
    ['un 403 (token malo)', async () => new Response('', { status: 403 })],
    ['un 3xx (no se siguen redirecciones)', async () => new Response('', { status: 307, headers: { Location: 'https://otro.ejemplo.test/' } })],
    ['un fallo de red', async (): Promise<Response> => { throw new TypeError('fetch failed'); }],
    ['la espera agotada', async (): Promise<Response> => { throw new DOMException('La espera se acabó', 'TimeoutError'); }],
  ])('%s: no lanza, deja password_reset_envio_fallido y lo manda a captureError', async (_caso, contestar) => {
    const reg = registro();
    await expect(
      createResetMailer({ env: ENV, net: red(contestar).fn, log: reg.log, report: reg.report }).send(CORREO),
    ).resolves.toBeUndefined();
    expect(reg.eventos.map((e) => e.event)).toEqual(['password_reset_envio_fallido']);
    expect(reg.errores).toHaveLength(1);
  });

  it('el log del fallo no lleva ni el correo ni el cuerpo', async () => {
    const reg = registro();
    await createResetMailer({ env: ENV, net: red(async () => new Response('', { status: 500 })).fn, log: reg.log, report: reg.report }).send(CORREO);
    const texto = JSON.stringify(reg.eventos);
    expect(texto).not.toContain('persona@ejemplo.test');
    expect(texto).not.toContain('Cuerpo ficticio');
  });

  it.each([
    ['sin ninguna variable', {}],
    ['sin la URL', { PASSWORD_RESET_N8N_TOKEN: 'token-ficticio' }],
    ['sin el token', { PASSWORD_RESET_N8N_URL: URL_N8N }],
    ['con el token en blanco', { ...ENV, PASSWORD_RESET_N8N_TOKEN: '   ' }],
  ])('%s: no llama a la red y deja password_reset_sin_configurar', async (_caso, env) => {
    const r = red(async () => new Response('', { status: 200 }));
    const reg = registro();
    await createResetMailer({ env, net: r.fn, log: reg.log, report: reg.report }).send(CORREO);
    expect(r.llamadas).toEqual([]);
    expect(reg.eventos.map((e) => e.event)).toEqual(['password_reset_sin_configurar']);
    expect(reg.errores).toEqual([]);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.mailer.test.ts
```

Esperado: FALLA al cargar, porque `./password-reset.mailer.js` no existe.

- [ ] **Step 3: Implementar el mailer**

Crear `apps/hub-api/src/users/password-reset/password-reset.mailer.ts`:

```ts
import { captureError } from '../../sentry.js';
import { logEvent, type ResetEmail, type ResetLog, type ResetMailer } from './password-reset.service.js';

/**
 * Cliente del webhook de n8n que envía los correos de la recuperación de
 * contraseña (flujo «Portal — Restablecer contraseña»: Webhook con Header Auth
 * → Gmail → Respond 200). Mismo patrón que el canal de avisos de Trazabilidad:
 * POST JSON, token en una cabecera, sin seguir redirecciones (el token y el
 * enlace no viajan a otro sitio) y con una espera máxima.
 *
 * NUNCA lanza. Quien pidió el enlace ya tiene su respuesta y nadie reintenta:
 * si n8n falla (red, espera agotada, respuesta que no es 2xx), queda el log
 * `password_reset_envio_fallido` y captureError, y la persona vuelve a pedirlo.
 * Sin PASSWORD_RESET_N8N_URL o PASSWORD_RESET_N8N_TOKEN no sale nada y queda
 * `password_reset_sin_configurar`. El correo de la persona nunca va al log.
 */

/** Cuánto se espera, como mucho, la respuesta de n8n. */
export const MAILER_TIMEOUT_MS = 10_000;
/** La cabecera del token: la credencial Header Auth del Webhook de n8n la comprueba. */
export const TOKEN_HEADER = 'X-Password-Reset-Token';

type Env = Readonly<Record<string, string | undefined>>;
type Net = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Las dos variables, leídas una a una por su nombre: así las ve el detector de
 * `.env.example` (INFRA-537), que no entiende `process.env` suelto.
 */
const envFromProcess = (): Env => ({
  PASSWORD_RESET_N8N_URL: process.env.PASSWORD_RESET_N8N_URL,
  PASSWORD_RESET_N8N_TOKEN: process.env.PASSWORD_RESET_N8N_TOKEN,
});

export interface ResetMailerOptions {
  env?: Env;
  net?: Net;
  log?: ResetLog;
  report?: (error: unknown, context: Record<string, unknown>) => void;
}

/**
 * El mailer de verdad. En producción, con el entorno del proceso y el `fetch`
 * de Node; las pruebas le pasan los suyos. Lee el entorno una vez, al crearse
 * (al arrancar hub-api): cambiarlo es cambiar la variable y desplegar.
 */
export function createResetMailer({
  env = envFromProcess(),
  net = fetch,
  log = logEvent,
  report = captureError,
}: ResetMailerOptions = {}): ResetMailer {
  const url = (env.PASSWORD_RESET_N8N_URL ?? '').trim();
  const token = (env.PASSWORD_RESET_N8N_TOKEN ?? '').trim();
  return {
    async send({ para, asunto, cuerpo }: ResetEmail): Promise<void> {
      if (url === '' || token === '') {
        log('password_reset_sin_configurar');
        return;
      }
      try {
        const res = await net(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [TOKEN_HEADER]: token },
          body: JSON.stringify({ para, asunto, cuerpo }),
          // Sin seguir redirecciones: el token y el enlace no deben viajar a otro sitio.
          redirect: 'manual',
          signal: AbortSignal.timeout(MAILER_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`El webhook de n8n respondió ${res.status}`);
      } catch (e) {
        log('password_reset_envio_fallido', { motivo: e instanceof Error ? e.message : String(e) });
        report(e, { endpoint: 'password_reset_mailer' });
      }
    },
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.mailer.test.ts
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 5: Ver en rojo el detector de `.env.example`**

```bash
cd apps/hub-api && npx vitest run src/env-example.test.ts
```

Esperado: FALLA `cada variable del código está en el ejemplo` con
`["PASSWORD_RESET_N8N_TOKEN", "PASSWORD_RESET_N8N_URL"]`.

- [ ] **Step 6: Documentar las dos variables**

Leer `apps/hub-api/.env.example` con Read y añadir al final, con Edit, estas líneas exactas (si la
lectura está bloqueada por permisos, pedir al usuario que las pegue a mano):

```
# Recuperación de contraseña por correo: webhook del flujo n8n «Portal — Restablecer contraseña».
# URL de producción del Webhook y el valor de su credencial Header Auth (cabecera
# X-Password-Reset-Token). Sin cualquiera de las dos, hub-api no envía el correo y lo
# deja en el log (password_reset_sin_configurar).
PASSWORD_RESET_N8N_URL=
PASSWORD_RESET_N8N_TOKEN=
```

- [ ] **Step 7: Ver el detector en verde**

```bash
cd apps/hub-api && npx vitest run src/env-example.test.ts src/users/password-reset/password-reset.mailer.test.ts
```

Esperado: PASA.

- [ ] **Step 8: Commit**

```bash
git add apps/hub-api/src/users/password-reset/password-reset.mailer.ts apps/hub-api/src/users/password-reset/password-reset.mailer.test.ts apps/hub-api/.env.example
git commit -m "feat(hub-api): cliente del webhook de n8n para los correos de contrasena"
```

---

### Task 5: El repositorio contra Postgres

**Files:**
- Create: `apps/hub-api/src/users/password-reset/password-reset.repository.db.test.ts`
- Create: `apps/hub-api/src/users/password-reset/password-reset.repository.ts`

- [ ] **Step 1: Escribir el test de BD que falla**

Crear `apps/hub-api/src/users/password-reset/password-reset.repository.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../../test-db/harness.js';
import { PasswordResetRepository } from './password-reset.repository.js';

// El repositorio de la recuperacion de contrasena contra Postgres de verdad: la
// transaccion de restablecer, la carrera de dos usos del mismo token, el
// rollback de una cuenta que ya no esta activa, la cascada al borrar el usuario
// y la limpieza de caducados. Las horas las pone el test: el repositorio
// compara contra el `now` que recibe, no contra now() de la BD.
//
// Solo toca usuarios de @restablecer.test y la tabla de tokens: los ficheros de
// BD corren en serie y cada uno limpia lo suyo.

const DOMINIO = '@restablecer.test';
const T0 = new Date('2026-11-13T15:00:00.000Z');
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const at = (ms: number) => new Date(T0.getTime() + ms);

let db: Pool;
let repo: PasswordResetRepository;

beforeAll(() => {
  db = poolDePrueba();
  repo = new PasswordResetRepository(db);
});
afterAll(async () => {
  await db?.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
  await db?.end();
});
beforeEach(async () => {
  await db.query(`DELETE FROM portal.password_reset_tokens`);
  await db.query(`DELETE FROM portal.users WHERE email LIKE $1`, [`%${DOMINIO}`]);
});

async function sembrarUsuario(local: string, nombre: string, status = 'active'): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status)
     VALUES ($1, $2, 'hash-viejo', 'reader', $3) RETURNING id`,
    [nombre, `${local}${DOMINIO}`, status],
  );
  return (rows[0] as { id: string }).id;
}

async function insertarToken(
  userId: string,
  tokenHash: string,
  f: { createdAt: Date; expiresAt: Date; usedAt?: Date | null },
): Promise<void> {
  await db.query(
    `INSERT INTO portal.password_reset_tokens (user_id, token_hash, created_at, expires_at, used_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, f.createdAt, f.expiresAt, f.usedAt ?? null],
  );
}

interface FilaToken {
  token_hash: string;
  used_at: Date | null;
  created_at: Date;
  expires_at: Date;
}

async function tokensDe(userId: string): Promise<FilaToken[]> {
  const { rows } = await db.query(
    `SELECT token_hash, used_at, created_at, expires_at
       FROM portal.password_reset_tokens WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows as FilaToken[];
}

async function usuario(id: string): Promise<{ password_hash: string; token_version: number }> {
  const { rows } = await db.query(`SELECT password_hash, token_version FROM portal.users WHERE id = $1`, [id]);
  return rows[0] as { password_hash: string; token_version: number };
}

describe('findUserByEmail', () => {
  it('normaliza el correo y devuelve id, correo, nombre y estado', async () => {
    const id = await sembrarUsuario('ana', 'Ana Ruiz', 'pending');
    expect(await repo.findUserByEmail('  ANA@Restablecer.test ')).toEqual({
      id,
      email: `ana${DOMINIO}`,
      fullName: 'Ana Ruiz',
      status: 'pending',
    });
  });

  it('un correo desconocido: null', async () => {
    expect(await repo.findUserByEmail(`nadie${DOMINIO}`)).toBeNull();
  });
});

describe('recentTokenStats', () => {
  it('sin enlaces: ninguno', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    expect(await repo.recentTokenStats(yo, at(-HORA))).toEqual({ lastCreatedAt: null, countSince: 0 });
  });

  it('el ultimo de la cuenta y cuantos desde `since` (gastados incluidos; los de otra cuenta no)', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    const otro = await sembrarUsuario('luis', 'Luis Gil');
    await insertarToken(yo, 'h1', { createdAt: at(-90 * MIN), expiresAt: at(-60 * MIN) });
    await insertarToken(yo, 'h2', { createdAt: at(-30 * MIN), expiresAt: at(0) });
    await insertarToken(yo, 'h3', { createdAt: at(-5 * MIN), expiresAt: at(25 * MIN), usedAt: at(-MIN) });
    await insertarToken(otro, 'h4', { createdAt: at(-MIN), expiresAt: at(29 * MIN) });
    expect(await repo.recentTokenStats(yo, at(-HORA))).toEqual({ lastCreatedAt: at(-5 * MIN), countSince: 2 });
  });
});

describe('createToken', () => {
  it('guarda el nuevo con la hora que recibe y anula los anteriores sin usar de esa cuenta, no los de otra', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    const otro = await sembrarUsuario('luis', 'Luis Gil');
    await repo.createToken({ userId: otro, tokenHash: 'de-otro', expiresAt: at(30 * MIN), now: T0 });
    await repo.createToken({ userId: yo, tokenHash: 'primero', expiresAt: at(31 * MIN), now: at(MIN) });
    await repo.createToken({ userId: yo, tokenHash: 'segundo', expiresAt: at(34 * MIN), now: at(4 * MIN) });

    const mios = await tokensDe(yo);
    expect(mios.map((f) => [f.token_hash, f.used_at])).toEqual([
      ['primero', at(4 * MIN)],
      ['segundo', null],
    ]);
    expect(mios[1].created_at).toEqual(at(4 * MIN));
    expect(mios[1].expires_at).toEqual(at(34 * MIN));
    expect((await tokensDe(otro))[0].used_at).toBeNull();
  });

  it('borra los caducados hace mas de un dia, de cualquier cuenta, y no los demas', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    const otro = await sembrarUsuario('luis', 'Luis Gil');
    await insertarToken(otro, 'viejo', { createdAt: at(-DIA - 31 * MIN), expiresAt: at(-DIA - MIN) });
    await insertarToken(otro, 'reciente', { createdAt: at(-DIA - 29 * MIN), expiresAt: at(-DIA + MIN), usedAt: at(-DIA) });
    await repo.createToken({ userId: yo, tokenHash: 'nuevo', expiresAt: at(30 * MIN), now: T0 });
    expect((await tokensDe(otro)).map((f) => f.token_hash)).toEqual(['reciente']);
    expect((await tokensDe(yo)).map((f) => f.token_hash)).toEqual(['nuevo']);
  });
});

describe('consumeAndSetPassword', () => {
  it('restablece: cambia password_hash, sube token_version, gasta el token y dice a quien', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    const r = await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(5 * MIN) });
    expect(r).toEqual({ userId: yo, email: `ana${DOMINIO}`, fullName: 'Ana Ruiz' });
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-nuevo', token_version: 1 });
    expect((await tokensDe(yo))[0].used_at).toEqual(at(5 * MIN));
  });

  it('solo sirve una vez', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(MIN) });
    expect(await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-otro', now: at(2 * MIN) })).toBeNull();
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-nuevo', token_version: 1 });
  });

  it('caducado (expires_at <= now): null y nada cambia', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    expect(await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(30 * MIN) })).toBeNull();
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-viejo', token_version: 0 });
    expect((await tokensDe(yo))[0].used_at).toBeNull();
  });

  it('un token desconocido: null', async () => {
    expect(await repo.consumeAndSetPassword({ tokenHash: 'no-existe', passwordHash: 'hash-nuevo', now: T0 })).toBeNull();
  });

  it('dos consumos simultaneos del mismo token: solo uno gana', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    const [a, b] = await Promise.all([
      repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-a', now: at(MIN) }),
      repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-b', now: at(MIN) }),
    ]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    const u = await usuario(yo);
    expect(u.token_version).toBe(1);
    expect(u.password_hash).toBe(a !== null ? 'hash-a' : 'hash-b');
  });

  it('cuenta no active al usar el token: null y ROLLBACK (ni la clave ni el token cambian)', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    await db.query(`UPDATE portal.users SET status = 'inactive' WHERE id = $1`, [yo]);
    expect(await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(MIN) })).toBeNull();
    expect(await usuario(yo)).toEqual({ password_hash: 'hash-viejo', token_version: 0 });
    expect((await tokensDe(yo))[0].used_at).toBeNull();
  });

  it('anula los demas tokens sin usar de la cuenta', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await insertarToken(yo, 'otra-huella', { createdAt: at(-MIN), expiresAt: at(29 * MIN) });
    await insertarToken(yo, 'huella', { createdAt: T0, expiresAt: at(30 * MIN) });
    await repo.consumeAndSetPassword({ tokenHash: 'huella', passwordHash: 'hash-nuevo', now: at(2 * MIN) });
    expect((await tokensDe(yo)).map((f) => [f.token_hash, f.used_at])).toEqual([
      ['otra-huella', at(2 * MIN)],
      ['huella', at(2 * MIN)],
    ]);
  });
});

describe('ON DELETE CASCADE', () => {
  it('borrar el usuario borra sus tokens', async () => {
    const yo = await sembrarUsuario('ana', 'Ana Ruiz');
    await repo.createToken({ userId: yo, tokenHash: 'huella', expiresAt: at(30 * MIN), now: T0 });
    await db.query(`DELETE FROM portal.users WHERE id = $1`, [yo]);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM portal.password_reset_tokens WHERE user_id = $1`, [yo]);
    expect((rows[0] as { n: number }).n).toBe(0);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/users/password-reset/password-reset.repository.db.test.ts
```

Esperado: FALLA al cargar, porque `./password-reset.repository.js` no existe. (Si en cambio falla el
arranque del contenedor, es Docker: ver las reglas de arriba.)

- [ ] **Step 3: Implementar el repositorio**

Crear `apps/hub-api/src/users/password-reset/password-reset.repository.ts`:

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { UserStatus } from '../users.types.js';
import type {
  ConsumeTokenInput,
  CreateTokenInput,
  PasswordResetStore,
  ResetUser,
  ResetUserRef,
  TokenStats,
} from './password-reset.service.js';

// El tipo del cliente transaccional se deriva del Pool, como en
// users.repository.ts (los @types de 'pg' no están en este paquete).
type PoolClient = Awaited<ReturnType<Pool['connect']>>;

/**
 * SQL de `portal.password_reset_tokens` y la transacción de restablecer.
 * Parámetros posicionales siempre. Todas las horas llegan como `now` desde el
 * servicio (reloj inyectable): aquí no se usa now() de la BD para decidir nada.
 */
export class PasswordResetRepository implements PasswordResetStore {
  constructor(private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<ResetUser | null> {
    const { rows } = await this.pool.query(
      `SELECT id, email, full_name, status FROM portal.users WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    const row = rows[0] as { id: string; email: string; full_name: string; status: UserStatus } | undefined;
    return row ? { id: row.id, email: row.email, fullName: row.full_name, status: row.status } : null;
  }

  async recentTokenStats(userId: string, since: Date): Promise<TokenStats> {
    const { rows } = await this.pool.query(
      `SELECT max(created_at) AS last_created_at,
              (count(*) FILTER (WHERE created_at >= $2))::int AS count_since
         FROM portal.password_reset_tokens
        WHERE user_id = $1`,
      [userId, since],
    );
    const row = rows[0] as { last_created_at: Date | string | null; count_since: number };
    return {
      lastCreatedAt: row.last_created_at === null ? null : new Date(row.last_created_at),
      countSince: row.count_since,
    };
  }

  async createToken({ userId, tokenHash, expiresAt, now }: CreateTokenInput): Promise<void> {
    await this.transaction(async (client) => {
      // Un enlace nuevo anula los anteriores sin usar de la misma cuenta.
      await client.query(
        `UPDATE portal.password_reset_tokens SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
        [userId, now],
      );
      // Limpieza de paso: los caducados hace más de un día, de cualquier cuenta.
      await client.query(
        `DELETE FROM portal.password_reset_tokens WHERE expires_at < $1::timestamptz - interval '1 day'`,
        [now],
      );
      await client.query(
        `INSERT INTO portal.password_reset_tokens (user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, tokenHash, expiresAt, now],
      );
    });
  }

  async consumeAndSetPassword({ tokenHash, passwordHash, now }: ConsumeTokenInput): Promise<ResetUserRef | null> {
    return this.transaction(
      async (client) => {
        // Una sola sentencia condicionada: si dos peticiones usan el mismo token
        // a la vez, la segunda espera al bloqueo de la fila, vuelve a evaluar
        // `used_at IS NULL` y no encuentra nada. No pueden ganar las dos.
        const consumed = await client.query(
          `UPDATE portal.password_reset_tokens
              SET used_at = $2
            WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2
        RETURNING user_id`,
          [tokenHash, now],
        );
        const userId = (consumed.rows[0] as { user_id: string } | undefined)?.user_id;
        if (!userId) return null;

        const found = await client.query(
          `SELECT email, full_name, status FROM portal.users WHERE id = $1 FOR UPDATE`,
          [userId],
        );
        const user = found.rows[0] as { email: string; full_name: string; status: UserStatus } | undefined;
        // Una cuenta que dejó de estar activa no restablece: ROLLBACK, y el token queda como estaba.
        if (!user || user.status !== 'active') return null;

        // Misma semántica que UserRepository.updatePassword (SEC-220): la clave y
        // token_version van juntas, así que restablecer cierra todas las sesiones.
        await client.query(
          `UPDATE portal.users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`,
          [userId, passwordHash],
        );
        await client.query(
          `UPDATE portal.password_reset_tokens SET used_at = $2 WHERE user_id = $1 AND used_at IS NULL`,
          [userId, now],
        );
        return { userId, email: user.email, fullName: user.full_name };
      },
      (result) => result !== null,
    );
  }

  /**
   * BEGIN, el trabajo y COMMIT si `commitIf` lo aprueba (ROLLBACK si no). Un
   * error hace ROLLBACK y se propaga. Mismo estilo que
   * UserRepository.withTransaction, con la salida de deshacer sin lanzar.
   */
  private async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    commitIf: (result: T) => boolean = () => true,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query(commitIf(result) ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/users/password-reset/password-reset.repository.db.test.ts
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/users/password-reset/password-reset.repository.ts apps/hub-api/src/users/password-reset/password-reset.repository.db.test.ts
git commit -m "feat(hub-api): repositorio de tokens de restablecimiento contra Postgres"
```

---

### Task 6: El router — dos rutas públicas con su rate limit

**Files:**
- Create: `apps/hub-api/src/users/password-reset/password-reset.router.test.ts`
- Create: `apps/hub-api/src/users/password-reset/password-reset.router.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/users/password-reset/password-reset.router.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import {
  FORGOT_LIMIT,
  LIMIT_WINDOW_MS,
  RESET_LIMIT,
  createPasswordResetRouter,
  type PasswordResetActions,
} from './password-reset.router.js';
import { PasswordResetError, PasswordResetService } from './password-reset.service.js';
import { FakeClock, FakeMailer, FakeStore } from './test-fakes.js';

// Las dos rutas públicas de la recuperación de contraseña. El servicio es el de
// verdad sobre dobles (test-fakes.ts) cuando importa lo que pasa por dentro, y
// un stub cuando solo importa la ruta. Cada `montar` crea un router nuevo, y
// con él limitadores nuevos.

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const FORGOT = '/api/auth/forgot-password';
const RESET = '/api/auth/reset-password';

afterEach(() => vi.restoreAllMocks());

function montar(service: PasswordResetActions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createPasswordResetRouter(service));
  return app;
}

function conServicioReal() {
  const store = new FakeStore();
  const mailer = new FakeMailer();
  let n = 0;
  const service = new PasswordResetService({
    store,
    mailer,
    now: new FakeClock(Date.parse('2026-11-13T15:00:00.000Z')).now,
    portalUrl: 'https://portal.ejemplo.test',
    bcryptCost: 4,
    randomToken: () => `token-${++n}`,
    log: () => {},
  });
  return { store, mailer, app: montar(service) };
}

const stub = (parcial: Partial<PasswordResetActions> = {}): PasswordResetActions => ({
  requestReset: vi.fn(async () => {}),
  resetPassword: vi.fn(async () => {}),
  ...parcial,
});

describe('POST /api/auth/forgot-password', () => {
  it('responde idéntico para una cuenta activa, una inactiva y una desconocida; solo la activa recibe el correo', async () => {
    const { store, mailer, app } = conServicioReal();
    store.addUser({ email: 'activa@ejemplo.test' });
    store.addUser({ email: 'inactiva@ejemplo.test', status: 'inactive' });
    const respuestas: { status: number; body: unknown }[] = [];
    for (const email of ['activa@ejemplo.test', 'inactiva@ejemplo.test', 'nadie@ejemplo.test']) {
      const res = await request(app).post(FORGOT).send({ email });
      respuestas.push({ status: res.status, body: res.body });
    }
    expect(respuestas).toEqual(Array(3).fill({ status: 200, body: { message: 'reset_requested' } }));
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    expect(mailer.sent[0].para).toBe('activa@ejemplo.test');
  });

  it('responde antes de trabajar: no espera a requestReset', async () => {
    const service = stub({ requestReset: vi.fn(() => new Promise<void>(() => {})) });
    const res = await request(montar(service)).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'reset_requested' });
    expect(service.requestReset).toHaveBeenCalledWith('ana@ejemplo.test');
  });

  it.each([
    ['sin cuerpo', undefined],
    ['sin email', {}],
    ['con un email que no es texto', { email: 42 }],
    ['con el email en blanco', { email: '   ' }],
  ])('%s → 400 missing_email, y no trabaja', async (_caso, cuerpo) => {
    const service = stub();
    const peticion = request(montar(service)).post(FORGOT);
    const res = cuerpo === undefined ? await peticion : await peticion.send(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'missing_email' });
    expect(service.requestReset).not.toHaveBeenCalled();
  });

  it('si el trabajo de después falla, la respuesta ya salió y el error va al log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = stub({
      requestReset: vi.fn(async () => {
        throw new Error('BD caída');
      }),
    });
    const res = await request(montar(service)).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('forgot_password error', expect.any(Error)));
  });

  it(`más de ${FORGOT_LIMIT} en 15 minutos desde la misma IP → 429`, async () => {
    const app = montar(stub());
    for (let i = 0; i < FORGOT_LIMIT; i++) {
      expect((await request(app).post(FORGOT).send({ email: 'ana@ejemplo.test' })).status).toBe(200);
    }
    const res = await request(app).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'too many requests' });
    expect(FORGOT_LIMIT).toBe(5);
    expect(LIMIT_WINDOW_MS).toBe(15 * 60_000);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('con un enlace válido → 200 password_reset, y la clave cambia', async () => {
    const { store, mailer, app } = conServicioReal();
    const ana = store.addUser({ email: 'ana@ejemplo.test' });
    await request(app).post(FORGOT).send({ email: 'ana@ejemplo.test' });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    const res = await request(app).post(RESET).send({ token: 'token-1', newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'password_reset' });
    expect(store.userById(ana.id).tokenVersion).toBe(1);
  });

  it('clave corta → 400 password_too_short', async () => {
    const { app } = conServicioReal();
    const res = await request(app).post(RESET).send({ token: 'token-1', newPassword: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'password_too_short' });
  });

  it.each([
    ['desconocido', { token: 'token-que-nadie-pidio', newPassword: 'clave-nueva-1' }],
    ['vacío', { token: '', newPassword: 'clave-nueva-1' }],
    ['ausente', { newPassword: 'clave-nueva-1' }],
  ])('token %s → 400 invalid_or_expired_token (400 y no 401: no es una sesión caducada)', async (_caso, cuerpo) => {
    const { app } = conServicioReal();
    const res = await request(app).post(RESET).send(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_or_expired_token' });
  });

  it('un error inesperado → 500 genérico, sin el detalle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = stub({
      resetPassword: vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.1:5432');
      }),
    });
    const res = await request(montar(service)).post(RESET).send({ token: 't', newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
  });

  it(`más de ${RESET_LIMIT} intentos en 15 minutos desde la misma IP → 429`, async () => {
    const app = montar(
      stub({
        resetPassword: vi.fn(async () => {
          throw new PasswordResetError('invalid_or_expired_token');
        }),
      }),
    );
    for (let i = 0; i < RESET_LIMIT; i++) {
      expect((await request(app).post(RESET).send({ token: 't', newPassword: 'clave-nueva-1' })).status).toBe(400);
    }
    const res = await request(app).post(RESET).send({ token: 't', newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'too many requests' });
    expect(RESET_LIMIT).toBe(10);
  });
});

describe('sin sesión', () => {
  it('ninguna de las dos rutas pide sesión: el router no usa la autenticación de auth.ts', () => {
    // Las peticiones de arriba van sin Authorization y reciben 200/400/429;
    // esto vigila que nadie le añada después un requireAuth.
    expect(leer('./password-reset.router.ts')).not.toMatch(/\brequire(Auth|Admin)\b|getPayload|auth\.js/);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.router.test.ts
```

Esperado: FALLA al cargar, porque `./password-reset.router.js` no existe.

- [ ] **Step 3: Implementar el router**

Crear `apps/hub-api/src/users/password-reset/password-reset.router.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { captureError } from '../../sentry.js';
import { PasswordResetError, type PasswordResetService } from './password-reset.service.js';

// Las dos rutas de la recuperación de contraseña, montadas bajo `/api` (ver
// index.ts). Sin sesión, como /api/login y /api/auth/register: quien las usa no
// puede iniciarla. Cada una con su rate limit por IP (clave por defecto
// `req.ip`; `trust proxy 1` ya está puesto en index.ts), creado DENTRO de la
// fábrica para que cada router —y cada test— empiece de cero. El limitador
// global de /api/ (60/min) les aplica además.

export const LIMIT_WINDOW_MS = 15 * 60_000;
export const FORGOT_LIMIT = 5;
export const RESET_LIMIT = 10;

/** Lo que el router necesita del servicio (los tests le pasan un stub). */
export type PasswordResetActions = Pick<PasswordResetService, 'requestReset' | 'resetPassword'>;

export function createPasswordResetRouter(service: PasswordResetActions): Router {
  const router = Router();
  const limitOptions = {
    windowMs: LIMIT_WINDOW_MS,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests' },
  };
  const forgotLimiter = rateLimit({ ...limitOptions, max: FORGOT_LIMIT });
  const resetLimiter = rateLimit({ ...limitOptions, max: RESET_LIMIT });

  // POST /api/auth/forgot-password { email } — responde YA, sea cual sea el
  // caso, y trabaja después: así el tiempo de respuesta no delata si la cuenta
  // existe. Los fallos de después van al log y a captureError.
  router.post('/auth/forgot-password', forgotLimiter, (req: Request, res: Response) => {
    const { email } = (req.body ?? {}) as { email?: unknown };
    if (typeof email !== 'string' || email.trim() === '') {
      res.status(400).json({ error: 'missing_email' });
      return;
    }
    res.json({ message: 'reset_requested' });
    void service.requestReset(email).catch((e: unknown) => {
      console.error('forgot_password error', e);
      captureError(e, { endpoint: 'forgot_password' });
    });
  });

  // POST /api/auth/reset-password { token, newPassword } — 400 con el código de
  // PasswordResetError (nunca 401: el interceptor del portal lo tomaría por una
  // sesión caducada); cualquier otro error, 500 genérico.
  router.post('/auth/reset-password', resetLimiter, async (req: Request, res: Response) => {
    const { token, newPassword } = (req.body ?? {}) as { token?: unknown; newPassword?: unknown };
    try {
      await service.resetPassword(token, newPassword);
      res.json({ message: 'password_reset' });
    } catch (e) {
      if (e instanceof PasswordResetError) {
        res.status(e.status).json({ error: e.code });
        return;
      }
      console.error('reset_password error', e);
      captureError(e, { endpoint: 'reset_password' });
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.router.test.ts
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/users/password-reset/password-reset.router.ts apps/hub-api/src/users/password-reset/password-reset.router.test.ts
git commit -m "feat(hub-api): rutas publicas forgot-password y reset-password"
```

---

### Task 7: Montar el router en `index.ts`

**Files:**
- Modify: `apps/hub-api/src/users/password-reset/password-reset.router.test.ts` (nuevo `describe` al final)
- Modify: `apps/hub-api/src/index.ts` (imports tras L8; montaje tras L129)

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `apps/hub-api/src/users/password-reset/password-reset.router.test.ts`:

```ts
describe('montaje en index.ts', () => {
  it('se monta en /api justo detrás del router de usuarios, con el repositorio, el mailer y la base del portal', () => {
    const index = leer('../../index.ts');
    const usuarios = index.indexOf("app.use('/api', createUsersRouter(getHubPool()));");
    const restablecer = index.indexOf("app.use('/api', createPasswordResetRouter(");
    expect(usuarios).toBeGreaterThan(-1);
    expect(restablecer).toBeGreaterThan(usuarios);
    // Nada montado entre medias.
    expect(index.slice(usuarios + 1, restablecer)).not.toMatch(/app\.use\(/);
    const montaje = index.slice(restablecer, index.indexOf('})));', restablecer));
    expect(montaje).toMatch(/new PasswordResetRepository\(getHubPool\(\)\)/);
    expect(montaje).toMatch(/createResetMailer\(\)/);
    expect(montaje).toMatch(/portalUrl: urlPortal\(\)/);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.router.test.ts -t "montaje en index.ts"
```

Esperado: FALLA, `expected -1 to be greater than …` (todavía no hay `createPasswordResetRouter` en
`index.ts`).

- [ ] **Step 3: Añadir los imports**

En `apps/hub-api/src/index.ts`, sustituir:

```ts
import { createUsersRouter } from './users/users.router.js';
```

por:

```ts
import { createUsersRouter } from './users/users.router.js';
import { createPasswordResetRouter } from './users/password-reset/password-reset.router.js';
import { PasswordResetService } from './users/password-reset/password-reset.service.js';
import { PasswordResetRepository } from './users/password-reset/password-reset.repository.js';
import { createResetMailer } from './users/password-reset/password-reset.mailer.js';
import { urlPortal } from './ausencias/config.js';
```

- [ ] **Step 4: Montar el router**

En `apps/hub-api/src/index.ts`, sustituir:

```ts
    app.use('/api', createUsersRouter(getHubPool()));
```

por:

```ts
    app.use('/api', createUsersRouter(getHubPool()));
    // Recuperación de contraseña por correo → /api/auth/forgot-password y
    // /api/auth/reset-password. Públicas, como /api/auth/register: cada una con
    // su rate limit por IP, y el global de /api/ encima. El enlace del correo
    // apunta a PORTAL_URL (urlPortal, la misma base que los correos de
    // Ausencias) y el correo sale por el webhook de n8n.
    app.use('/api', createPasswordResetRouter(new PasswordResetService({
      store: new PasswordResetRepository(getHubPool()),
      mailer: createResetMailer(),
      now: () => new Date(),
      portalUrl: urlPortal(),
    })));
```

- [ ] **Step 5: Ver que pasa, y que los candados de `index.ts` siguen en verde**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.router.test.ts src/trazabilidad/envio-avisos.test.ts src/errores-json.test.ts src/cabeceras-seguridad.test.ts src/env-example.test.ts
```

Esperado: PASA.

- [ ] **Step 6: Tipos de todo hub-api (tests incluidos: el build de Docker los compila)**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/index.ts apps/hub-api/src/users/password-reset/password-reset.router.test.ts
git commit -m "feat(hub-api): monta la recuperacion de contrasena en /api"
```

---

### Task 8: Portal — el modo «¿Olvidaste tu contraseña?»

**Files:**
- Modify: `apps/portal/src/components/Auth/AuthRightPanel.test.tsx` (nuevo `describe` al final)
- Create: `apps/portal/src/components/Auth/recuperacion.ts`
- Create: `apps/portal/src/components/Auth/OlvidoContrasena.tsx`
- Modify: `apps/portal/src/components/Auth/AuthRightPanel.tsx` (imports L4-5, props L16-22, pestañas
  L154-173, formulario de login L343-435)

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `apps/portal/src/components/Auth/AuthRightPanel.test.tsx` (ya tiene
`vi.mock('../../auth', …)` con `API_BASE: 'http://test'`, `fetch` stubeado en `beforeEach` y
`renderSignup` arriba):

```tsx
// Recuperación de contraseña por correo (spec 2026-11-13, §6.1): un tercer modo
// del panel, solo desde la pestaña de iniciar sesión.
describe('AuthRightPanel — ¿Olvidaste tu contraseña?', () => {
  function renderLogin() {
    return render(
      <MemoryRouter>
        <AuthRightPanel isSignUp={false} onToggle={() => {}} />
      </MemoryRouter>,
    );
  }
  const abrirOlvido = () => fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
  function enviarCorreo(correo: string) {
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: correo } });
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar enlace' }).closest('form')!);
  }

  it('el enlace está en la pestaña de iniciar sesión y no en la de registro', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeTruthy();
    cleanup();
    renderSignup();
    expect(screen.queryByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeNull();
  });

  it('abre el modo «olvidé»: correo, «Enviar enlace» y «Volver a iniciar sesión»', () => {
    renderLogin();
    abrirOlvido();
    expect(screen.getByRole('heading', { name: '¿Olvidaste tu contraseña?' })).toBeTruthy();
    expect((screen.getByLabelText('Correo electrónico') as HTMLInputElement).type).toBe('email');
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a iniciar sesión' }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('pulsar la pestaña «Iniciar sesión» también cierra el modo «olvidé»', () => {
    renderLogin();
    abrirOlvido();
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('«Enviar enlace» no se puede pulsar sin correo', () => {
    renderLogin();
    abrirOlvido();
    expect((screen.getByRole('button', { name: 'Enviar enlace' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('envía el correo a forgot-password y muestra el mensaje genérico', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: 'reset_requested' }) } as unknown as Response);
    renderLogin();
    abrirOlvido();
    enviarCorreo('  persona@ejemplo.test ');
    expect(
      await screen.findByText('Si el correo está registrado, recibirás un enlace en unos minutos. Revisa también la carpeta de spam.'),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://test/api/auth/forgot-password');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ email: 'persona@ejemplo.test' });
  });

  it('429 → «Demasiados intentos, espera unos minutos.»', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'too many requests' }) } as unknown as Response);
    renderLogin();
    abrirOlvido();
    enviarCorreo('persona@ejemplo.test');
    expect((await screen.findByRole('alert')).textContent).toContain('Demasiados intentos, espera unos minutos.');
  });

  it('sin red → «No se pudo conectar con el servidor. Reintenta.»', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    renderLogin();
    abrirOlvido();
    enviarCorreo('persona@ejemplo.test');
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo conectar con el servidor. Reintenta.');
  });

  it('con olvidoInicial se abre directamente en el modo «olvidé»', () => {
    render(
      <MemoryRouter>
        <AuthRightPanel isSignUp={false} onToggle={() => {}} olvidoInicial />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/portal && npx vitest run src/components/Auth/AuthRightPanel.test.tsx
```

Esperado: FALLAN los tests del `describe` nuevo (no hay ningún botón «¿Olvidaste tu contraseña?»; el
de `olvidoInicial` no encuentra «Enviar enlace»). Los anteriores siguen en verde.

- [ ] **Step 3: Crear los mensajes compartidos**

Crear `apps/portal/src/components/Auth/recuperacion.ts`:

```ts
// Piezas compartidas de la recuperación de contraseña entre el panel de acceso
// (modo «¿Olvidaste tu contraseña?») y la página /auth/restablecer. Spec
// 2026-11-13, §6.

/** Con qué se abre /auth cuando se llega desde otra pantalla (`location.state.modo`). */
export type ModoAuth = 'login' | 'olvido';

/** Tras pedir el enlace: el mismo texto exista o no la cuenta. */
export const MENSAJE_ENLACE_PEDIDO =
  'Si el correo está registrado, recibirás un enlace en unos minutos. Revisa también la carpeta de spam.';
export const MENSAJE_DEMASIADOS_INTENTOS = 'Demasiados intentos, espera unos minutos.';
export const MENSAJE_SIN_SERVIDOR = 'No se pudo conectar con el servidor. Reintenta.';
/** Cualquier otra respuesta que no sea 200 ni 429 (no debería darse: hub-api responde 200 antes de trabajar). */
export const MENSAJE_NO_ENVIADO = 'No se pudo enviar el enlace. Reintenta.';
```

- [ ] **Step 4: Crear el modo «olvidé»**

Crear `apps/portal/src/components/Auth/OlvidoContrasena.tsx`:

```tsx
import { useId, useState } from 'react';
import { Mail, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../../auth';
import {
  MENSAJE_DEMASIADOS_INTENTOS,
  MENSAJE_ENLACE_PEDIDO,
  MENSAJE_NO_ENVIADO,
  MENSAJE_SIN_SERVIDOR,
} from './recuperacion';

// Tercer modo del panel de acceso: pedir el enlace para restablecer la
// contraseña. hub-api responde SIEMPRE lo mismo, exista o no la cuenta, así que
// aquí tampoco se distingue: tras un 200, el mismo mensaje para todos.

interface OlvidoContrasenaProps {
  /** Vuelve al formulario de iniciar sesión. */
  onVolver: () => void;
}

export default function OlvidoContrasena({ onVolver }: OlvidoContrasenaProps) {
  const [correo, setCorreo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState('');
  const idCorreo = `${useId()}-correo`;

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = correo.trim();
    if (email === '') return;
    setEnviando(true);
    setError('');
    try {
      if (!API_BASE) throw new Error('config');
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setEnviado(true);
        return;
      }
      setError(res.status === 429 ? MENSAJE_DEMASIADOS_INTENTOS : MENSAJE_NO_ENVIADO);
    } catch {
      setError(MENSAJE_SIN_SERVIDOR);
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <CheckCircle2 className="w-16 h-16 text-cyan-400 mb-6" />
        <h3 className="text-2xl font-bold text-white mb-3">Revisa tu correo</h3>
        <p role="status" className="text-gray-300 mb-8 max-w-sm">
          {MENSAJE_ENLACE_PEDIDO}
        </p>
        <button
          type="button"
          onClick={onVolver}
          className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
          Volver a iniciar sesión
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="flex-1" noValidate>
      <h3 className="text-2xl font-bold text-white mb-3">¿Olvidaste tu contraseña?</h3>
      <p className="text-gray-300 text-sm mb-8">
        Escribe el correo con el que entras al portal y te enviaremos un enlace para elegir una contraseña nueva.
      </p>

      {/* role="alert" para que se anuncie (FE-419), como en el login. */}
      {error && (
        <div role="alert" className="mb-6 p-4 bg-red-500 bg-opacity-20 border border-red-500 border-opacity-50 rounded-lg">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      <div className="mb-8">
        <label htmlFor={idCorreo} className="block text-sm font-medium text-gray-300 mb-2">
          Correo electrónico
        </label>
        <div className="relative group">
          <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
          <input
            id={idCorreo}
            type="email"
            name="email"
            value={correo}
            onChange={(e) => {
              setCorreo(e.target.value);
              setError('');
            }}
            placeholder="tu@ejemplo.com"
            maxLength={254}
            autoComplete="email"
            className="w-full pl-12 pr-4 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={enviando || correo.trim() === ''}
        style={{
          background: 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)',
          boxShadow: '0 8px 20px rgba(26, 188, 156, 0.3)',
        }}
        className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-not-allowed">
        {enviando ? (
          <span className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Enviando...
          </span>
        ) : (
          'Enviar enlace'
        )}
      </button>

      <p className="text-center text-sm mt-6">
        <button
          type="button"
          onClick={onVolver}
          className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
          Volver a iniciar sesión
        </button>
      </p>
    </form>
  );
}
```

- [ ] **Step 5: Engancharlo en `AuthRightPanel.tsx`**

Seis ediciones en `apps/portal/src/components/Auth/AuthRightPanel.tsx`.

5a. Import. Sustituir:

```tsx
import { API_BASE, setToken } from '../../auth';
import { notify } from '../../lib/notify';
```

por:

```tsx
import { API_BASE, setToken } from '../../auth';
import { notify } from '../../lib/notify';
import OlvidoContrasena from './OlvidoContrasena';
```

5b. Prop y estado. Sustituir:

```tsx
interface AuthRightPanelProps {
  isSignUp: boolean;
  onToggle: (value: boolean) => void;
}

export default function AuthRightPanel({ isSignUp, onToggle }: AuthRightPanelProps) {
  const navigate = useNavigate();
```

por:

```tsx
interface AuthRightPanelProps {
  isSignUp: boolean;
  onToggle: (value: boolean) => void;
  /** Abre directamente el modo «¿Olvidaste tu contraseña?» (desde un enlace caducado). */
  olvidoInicial?: boolean;
}

export default function AuthRightPanel({ isSignUp, onToggle, olvidoInicial = false }: AuthRightPanelProps) {
  const navigate = useNavigate();
  // Tercer modo del panel: «¿Olvidaste tu contraseña?». Solo existe dentro de la
  // pestaña de iniciar sesión, por eso vive aquí y no en AuthCard; cambiar de
  // pestaña lo cierra.
  const [olvido, setOlvido] = useState(olvidoInicial);
  const irAPestana = (signUp: boolean) => {
    setOlvido(false);
    onToggle(signUp);
  };
```

5c. Que todo cambio de pestaña pase por `irAPestana`. Con Edit y `replace_all: true` (son 5
apariciones: las dos pestañas, «Volver a iniciar sesión» del registro enviado, «Iniciar sesión» del
registro y «Registrarse» del login), sustituir:

```tsx
onClick={() => onToggle(
```

por:

```tsx
onClick={() => irAPestana(
```

5d. El formulario de login se oculta en el modo «olvidé». Sustituir:

```tsx
      {/* Sign In Form */}
      {!isSignUp && (
```

por:

```tsx
      {/* Sign In Form */}
      {!isSignUp && !olvido && (
```

5e. El enlace bajo el campo de contraseña del login. Sustituir:

```tsx
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
```

por:

```tsx
            </div>
            {/* Recuperación de contraseña: solo en la pestaña de iniciar sesión. */}
            <div className="mt-2 text-right">
              <button
                type="button"
                onClick={() => setOlvido(true)}
                className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
```

5f. El modo «olvidé» al final del panel. Sustituir:

```tsx
          </p>
        </form>
      )}
    </div>
  );
}
```

por:

```tsx
          </p>
        </form>
      )}

      {/* ¿Olvidaste tu contraseña? */}
      {!isSignUp && olvido && <OlvidoContrasena onVolver={() => setOlvido(false)} />}
    </div>
  );
}
```

- [ ] **Step 6: Ver que pasa**

```bash
cd apps/portal && npx vitest run src/components/Auth/AuthRightPanel.test.tsx
```

Esperado: PASA, todos los tests del fichero en verde (los de registro y FE-419 incluidos).

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/components/Auth/recuperacion.ts apps/portal/src/components/Auth/OlvidoContrasena.tsx apps/portal/src/components/Auth/AuthRightPanel.tsx apps/portal/src/components/Auth/AuthRightPanel.test.tsx
git commit -m "feat(portal): modo olvide mi contrasena en el acceso"
```

---

### Task 9: Portal — `/auth` se abre en login u «olvidé» según de dónde se llegue

**Files:**
- Create: `apps/portal/src/components/Auth/AuthCard.test.tsx`
- Modify: `apps/portal/src/components/Auth/AuthCard.tsx` (fichero entero, 25 líneas)

Mecanismo: quien navega a `/auth` puede pasar `state: { modo: 'login' | 'olvido' }`. Sin `modo` (o con
el `{ from }` que deja `RequireAuth`), el panel se abre en el registro, como hasta ahora.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/portal/src/components/Auth/AuthCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCard from './AuthCard';

// Con qué se abre /auth: lo decide `location.state.modo` de quien navega hasta
// aquí (la página de restablecer contraseña). Sin indicación, el registro.

afterEach(() => cleanup());

function abrirCon(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/auth', state }]}>
      <AuthCard />
    </MemoryRouter>,
  );
}

describe('AuthCard — con qué se abre', () => {
  it('sin indicación, en el registro (como hasta ahora)', () => {
    abrirCon();
    expect(screen.getByText('Crea tu cuenta')).toBeTruthy();
  });

  it('el `from` que deja RequireAuth no cambia nada', () => {
    abrirCon({ from: '/ausencias' });
    expect(screen.getByText('Crea tu cuenta')).toBeTruthy();
  });

  it('con modo login, en iniciar sesión', () => {
    abrirCon({ modo: 'login' });
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('con modo olvido, directamente en «¿Olvidaste tu contraseña?»', () => {
    abrirCon({ modo: 'olvido' });
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/portal && npx vitest run src/components/Auth/AuthCard.test.tsx
```

Esperado: FALLAN `con modo login…` (no encuentra «Bienvenido de vuelta») y `con modo olvido…` (no
encuentra «Enviar enlace»); los dos primeros pasan.

- [ ] **Step 3: Leer `location.state.modo` en `AuthCard`**

Sustituir el contenido entero de `apps/portal/src/components/Auth/AuthCard.tsx` por:

```tsx
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import AuthLeftPanel from './AuthLeftPanel';
import AuthRightPanel from './AuthRightPanel';
import type { ModoAuth } from './recuperacion';

export default function AuthCard() {
  // Quien llega desde otra pantalla puede pedir con qué se abre, en
  // `location.state.modo`: «login» tras restablecer la contraseña y «olvido»
  // desde un enlace no válido. Sin indicación, el registro, como siempre.
  const modo = (useLocation().state as { modo?: ModoAuth } | null)?.modo;
  const [isSignUp, setIsSignUp] = useState(modo !== 'login' && modo !== 'olvido');

  return (
    <div
      className="w-full max-h-[90vh] rounded-[18px] overflow-hidden shadow-2xl flex"
      style={{
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 40px rgba(255, 107, 107, 0.1)'
      }}>
      {/* Left Panel - Visual/Branding */}
      <div className="hidden md:flex md:w-1/2">
        <AuthLeftPanel />
      </div>

      {/* Right Panel - Authentication */}
      <div className="w-full md:w-1/2">
        <AuthRightPanel isSignUp={isSignUp} onToggle={setIsSignUp} olvidoInicial={modo === 'olvido'} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/portal && npx vitest run src/components/Auth/AuthCard.test.tsx src/components/Auth/AuthRightPanel.test.tsx
```

Esperado: PASA.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/components/Auth/AuthCard.tsx apps/portal/src/components/Auth/AuthCard.test.tsx
git commit -m "feat(portal): /auth se abre en login u olvido segun de donde se llegue"
```

---

### Task 10: Portal — la página `/auth/restablecer`

**Files:**
- Create: `apps/portal/src/pages/RestablecerContrasena.test.tsx`
- Create: `apps/portal/src/pages/RestablecerContrasena.tsx`
- Modify: `apps/portal/src/App.tsx` (import tras L16; ruta tras L56)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/portal/src/pages/RestablecerContrasena.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RestablecerContrasena from './RestablecerContrasena';
import AuthCard from '../components/Auth/AuthCard';

// La página pública del enlace del correo. El token llega en el hash de la URL
// real (window.location), no en la del router: por eso cada test fija la URL de
// jsdom antes de pintar. /auth se pinta con el AuthCard de verdad para ver
// adónde llevan los botones.

// API_BASE fijo (en los tests no hay VITE_HUB_API_URL); clearToken, el de verdad.
vi.mock('../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth')>()),
  API_BASE: 'http://test',
}));

const TOKEN = 'TokenDePrueba_-123';

function abrir(url: string) {
  window.history.replaceState(null, '', url);
  return render(
    <MemoryRouter initialEntries={['/auth/restablecer']}>
      <Routes>
        <Route path="/auth/restablecer" element={<RestablecerContrasena />} />
        <Route path="/auth" element={<AuthCard />} />
      </Routes>
    </MemoryRouter>,
  );
}

const respuesta = (status: number, cuerpo: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo }) as unknown as Response;

function escribir(clave: string, confirmacion: string) {
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: clave } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: confirmacion } });
  fireEvent.submit(screen.getByRole('button', { name: 'Guardar contraseña' }).closest('form')!);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('/auth/restablecer', () => {
  it('lee el token de #t=, lo quita de la barra de direcciones y lo manda con la clave nueva', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/auth/restablecer');

    vi.mocked(fetch).mockResolvedValue(respuesta(200, { message: 'password_reset' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    await screen.findByText('Contraseña actualizada');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://test/api/auth/reset-password');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ token: TOKEN, newPassword: 'clave-nueva-1' });
  });

  it('rechaza una clave de menos de 8 caracteres sin llamar al servidor', () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    escribir('corta', 'corta');
    expect(screen.getByRole('alert').textContent).toContain('La contraseña debe tener al menos 8 caracteres.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechaza dos claves que no coinciden sin llamar al servidor', () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    escribir('clave-nueva-1', 'clave-nueva-2');
    expect(screen.getByRole('alert').textContent).toContain('Las contraseñas no coinciden.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('el ojo muestra y oculta las dos claves', () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseñas' }));
    expect((screen.getByLabelText('Nueva contraseña') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('Confirmar contraseña') as HTMLInputElement).type).toBe('text');
    const ocultar = screen.getByRole('button', { name: 'Ocultar contraseñas' });
    expect(ocultar.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(ocultar);
    expect((screen.getByLabelText('Nueva contraseña') as HTMLInputElement).type).toBe('password');
  });

  it('en el éxito borra el token de sesión y el botón lleva al login', async () => {
    localStorage.setItem('ambientalia_token', 'sesion-vieja');
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(200, { message: 'password_reset' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    await screen.findByText('Contraseña actualizada');
    expect(localStorage.getItem('ambientalia_token')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a iniciar sesión' }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('sin token: enlace no válido, y el botón abre «¿Olvidaste tu contraseña?»', () => {
    abrir('/auth/restablecer');
    expect(screen.getByText('Este enlace no es válido o ha caducado')).toBeTruthy();
    expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pedir un enlace nuevo' }));
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('400 invalid_or_expired_token: enlace no válido', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(400, { error: 'invalid_or_expired_token' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect(await screen.findByText('Este enlace no es válido o ha caducado')).toBeTruthy();
  });

  it('429 → «Demasiados intentos, espera unos minutos.»', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(429, { error: 'too many requests' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect((await screen.findByRole('alert')).textContent).toContain('Demasiados intentos, espera unos minutos.');
  });

  it('sin red → «No se pudo conectar con el servidor. Reintenta.»', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo conectar con el servidor. Reintenta.');
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/portal && npx vitest run src/pages/RestablecerContrasena.test.tsx
```

Esperado: FALLA al cargar, porque `./RestablecerContrasena` no existe.

- [ ] **Step 3: Crear la página**

Crear `apps/portal/src/pages/RestablecerContrasena.tsx`:

```tsx
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, KeyRound, Shield, TriangleAlert } from 'lucide-react';
import AuthLeftPanel from '../components/Auth/AuthLeftPanel';
import { API_BASE, clearToken } from '../auth';
import { MENSAJE_DEMASIADOS_INTENTOS, MENSAJE_SIN_SERVIDOR, type ModoAuth } from '../components/Auth/recuperacion';

// /auth/restablecer — pública, fuera de RequireAuth (spec 2026-11-13, §6.2).
// Llega desde el enlace del correo de «¿Olvidaste tu contraseña?», con el token
// tras el `#` (#t=…): el navegador no lo manda al servidor, así que no queda en
// los logs de nginx ni en el Referer. Al montar se lee y se quita de la barra de
// direcciones para que tampoco quede en el historial. Mismo diseño de tarjeta
// que /auth.

const MIN_PASSWORD = 8; // coincide con el backend (MIN_PASSWORD_LENGTH)
const MENSAJE_CLAVE_CORTA = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
const MENSAJE_NO_COINCIDEN = 'Las contraseñas no coinciden.';
const MENSAJE_NO_RESTABLECIDA = 'No se pudo restablecer la contraseña. Reintenta.';
const CLASE_CAMPO =
  'w-full pl-12 pr-12 py-3 rounded-lg bg-white bg-opacity-5 border border-white border-opacity-10 text-white placeholder-gray-500 transition-all duration-300 focus:outline-none focus:bg-opacity-10 focus:border-opacity-30 focus:ring-2 focus:ring-cyan-400 focus:ring-opacity-20';

type Estado = 'formulario' | 'hecho' | 'invalido';

/** El token de `#t=<token>`, o cadena vacía si no viene. */
function leerToken(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('t') ?? '';
}

export default function RestablecerContrasena() {
  const navigate = useNavigate();
  // En el inicializador y no en el efecto: en StrictMode el efecto corre dos
  // veces, y la segunda ya no encontraría el hash.
  const [token] = useState(() => leerToken(window.location.hash));
  const [estado, setEstado] = useState<Estado>(token ? 'formulario' : 'invalido');
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [verClaves, setVerClaves] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const uid = useId();
  const ids = { clave: `${uid}-clave`, confirmacion: `${uid}-confirmacion` };

  useEffect(() => {
    if (window.location.hash) {
      // Conserva el `state` del historial: react-router guarda ahí su índice.
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }, []);

  const irAlAcceso = (modo: ModoAuth) => {
    navigate('/auth', { state: { modo } });
  };

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (clave.length < MIN_PASSWORD) {
      setError(MENSAJE_CLAVE_CORTA);
      return;
    }
    if (clave !== confirmacion) {
      setError(MENSAJE_NO_COINCIDEN);
      return;
    }
    setGuardando(true);
    setError('');
    try {
      if (!API_BASE) throw new Error('config');
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: clave }),
      });
      if (res.ok) {
        // La sesión que hubiera abierta ya no vale (token_version subió): fuera.
        clearToken();
        setEstado('hecho');
        return;
      }
      if (res.status === 429) {
        setError(MENSAJE_DEMASIADOS_INTENTOS);
        return;
      }
      const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 400 && cuerpo.error === 'invalid_or_expired_token') {
        setEstado('invalido');
        return;
      }
      setError(res.status === 400 && cuerpo.error === 'password_too_short' ? MENSAJE_CLAVE_CORTA : MENSAJE_NO_RESTABLECIDA);
    } catch {
      setError(MENSAJE_SIN_SERVIDOR);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #ff6b6b 0%, #ff8787 25%, #ffa5a5 50%, #ffb3b3 75%, #ffc5c5 100%)',
        backgroundAttachment: 'fixed',
      }}>
      <div className="w-full max-w-4xl mx-auto px-4 py-8">
        <div
          className="w-full max-h-[90vh] rounded-[18px] overflow-hidden shadow-2xl flex"
          style={{ boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 40px rgba(255, 107, 107, 0.1)' }}>
          <div className="hidden md:flex md:w-1/2">
            <AuthLeftPanel />
          </div>

          <div className="w-full md:w-1/2">
            <div
              className="w-full h-full flex flex-col p-8 md:p-12 overflow-y-auto"
              style={{ background: 'linear-gradient(135deg, #2d3561 0%, #1a2847 100%)' }}>
              {estado === 'invalido' && (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <TriangleAlert className="w-16 h-16 text-amber-300 mb-6" />
                  <h3 className="text-2xl font-bold text-white mb-3">Este enlace no es válido o ha caducado</h3>
                  <p className="text-gray-300 mb-8 max-w-sm">
                    Los enlaces para restablecer la contraseña valen 30 minutos y una sola vez. Pide uno nuevo.
                  </p>
                  <button
                    type="button"
                    onClick={() => irAlAcceso('olvido')}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
                    Pedir un enlace nuevo
                  </button>
                </div>
              )}

              {estado === 'hecho' && (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="w-16 h-16 text-cyan-400 mb-6" />
                  <h3 className="text-2xl font-bold text-white mb-3">Contraseña actualizada</h3>
                  <p className="text-gray-300 mb-8 max-w-sm">
                    Ya puedes iniciar sesión con tu nueva contraseña. Por seguridad, se han cerrado todas las sesiones
                    que tenías abiertas.
                  </p>
                  <button
                    type="button"
                    onClick={() => irAlAcceso('login')}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors">
                    Ir a iniciar sesión
                  </button>
                </div>
              )}

              {estado === 'formulario' && (
                <form onSubmit={guardar} className="flex-1" noValidate>
                  <h3 className="text-2xl font-bold text-white mb-3">Elige una contraseña nueva</h3>
                  <p className="text-gray-300 text-sm mb-8">Mínimo {MIN_PASSWORD} caracteres.</p>

                  {/* role="alert" para que se anuncie (FE-419), como en el login. */}
                  {error && (
                    <div role="alert" className="mb-6 p-4 bg-red-500 bg-opacity-20 border border-red-500 border-opacity-50 rounded-lg">
                      <p className="text-red-300 text-sm">{error}</p>
                    </div>
                  )}

                  <div className="mb-6">
                    <label htmlFor={ids.clave} className="block text-sm font-medium text-gray-300 mb-2">
                      Nueva contraseña
                    </label>
                    <div className="relative group">
                      <KeyRound className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
                      <input
                        id={ids.clave}
                        type={verClaves ? 'text' : 'password'}
                        value={clave}
                        onChange={(e) => {
                          setClave(e.target.value);
                          setError('');
                        }}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        className={CLASE_CAMPO}
                      />
                      {/* Un solo ojo para los dos campos, como en Configuración (FE-419):
                          el nombre dice lo que hará y aria-pressed su estado. */}
                      <button
                        type="button"
                        onClick={() => setVerClaves((v) => !v)}
                        aria-label={verClaves ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
                        aria-pressed={verClaves}
                        className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
                        {verClaves ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="mb-8">
                    <label htmlFor={ids.confirmacion} className="block text-sm font-medium text-gray-300 mb-2">
                      Confirmar contraseña
                    </label>
                    <div className="relative group">
                      <Shield className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-cyan-400 transition-colors" />
                      <input
                        id={ids.confirmacion}
                        type={verClaves ? 'text' : 'password'}
                        value={confirmacion}
                        onChange={(e) => {
                          setConfirmacion(e.target.value);
                          setError('');
                        }}
                        placeholder="••••••••"
                        autoComplete="new-password"
                        className={CLASE_CAMPO}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={guardando}
                    style={{
                      background: 'linear-gradient(135deg, #1abc9c 0%, #48dbfb 100%)',
                      boxShadow: '0 8px 20px rgba(26, 188, 156, 0.3)',
                    }}
                    className="w-full py-3 px-4 rounded-lg font-semibold text-white transition-all duration-300 hover:shadow-lg hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 disabled:cursor-not-allowed">
                    {guardando ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Guardando...
                      </span>
                    ) : (
                      'Guardar contraseña'
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/portal && npx vitest run src/pages/RestablecerContrasena.test.tsx
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 5: Declarar la ruta pública en `App.tsx`**

`App.tsx` no tiene test propio (importa todas las sub-apps); este paso es cableado de una línea y se
comprueba con el compilador aquí y en el navegador en la Task 13.

En `apps/portal/src/App.tsx`, sustituir:

```tsx
import Auth from './pages/Auth';
```

por:

```tsx
import Auth from './pages/Auth';
import RestablecerContrasena from './pages/RestablecerContrasena';
```

y sustituir:

```tsx
        <Route path="/auth" element={<Auth />} />
```

por:

```tsx
        <Route path="/auth" element={<Auth />} />

        {/* Restablecer la contraseña desde el enlace del correo — pública, sin sidebar */}
        <Route path="/auth/restablecer" element={<RestablecerContrasena />} />
```

- [ ] **Step 6: Tipos del portal**

```bash
cd apps/portal && npx tsc -b
```

Esperado: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/pages/RestablecerContrasena.tsx apps/portal/src/pages/RestablecerContrasena.test.tsx apps/portal/src/App.tsx
git commit -m "feat(portal): pagina publica para restablecer la contrasena"
```

---

### Task 11: n8n — flujo «Portal — Restablecer contraseña»

**Files:**
- Modify: `docs/n8n-automatizaciones.md` (nueva §2.4, antes de `## 3. Checklist para una app nueva`)
- Fuera del repo: un flujo nuevo en n8n.

Antes de cualquier llamada al MCP de n8n, cargar la skill `n8n-mcp-skills:using-n8n-mcp-skills`. En
las pruebas no se envía nada a ninguna persona real: solo al buzón de prueba que elija el usuario.

- [ ] **Step 1: El usuario crea a mano la credencial Header Auth (el secreto no pasa por el chat)**

Pedir al usuario que, en su propia terminal de PowerShell, genere un token aleatorio:

```powershell
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

y que en n8n cree una credencial **Header Auth** llamada «Token restablecer contraseña», con
*Name* `X-Password-Reset-Token` y *Value* ese token. El mismo valor irá después a
`PASSWORD_RESET_N8N_TOKEN` en EasyPanel (Task 13). Si el valor aparece en un chat o en un log, se
genera otro y se cambia en los dos sitios.

- [ ] **Step 2: Crear el flujo con el MCP (sin credenciales)**

Con `n8n_create_workflow`:

```json
{
  "name": "Portal — Restablecer contraseña",
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [0, 0],
      "parameters": {
        "httpMethod": "POST",
        "path": "portal-restablecer-contrasena",
        "authentication": "headerAuth",
        "responseMode": "responseNode",
        "options": {}
      }
    },
    {
      "name": "Enviar correo",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [260, 0],
      "parameters": {
        "resource": "message",
        "operation": "send",
        "sendTo": "={{ $json.body.para }}",
        "subject": "={{ $json.body.asunto }}",
        "emailType": "html",
        "message": "={{ $json.body.cuerpo }}",
        "options": { "appendAttribution": false }
      }
    },
    {
      "name": "Responder 200",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [520, 0],
      "parameters": {
        "respondWith": "json",
        "responseBody": "{\"ok\": true}",
        "options": { "responseCode": 200 }
      }
    }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Enviar correo", "type": "main", "index": 0 }]] },
    "Enviar correo": { "main": [[{ "node": "Responder 200", "type": "main", "index": 0 }]] }
  },
  "settings": {
    "executionOrder": "v1",
    "saveDataSuccessExecution": "none",
    "saveDataErrorExecution": "all"
  }
}
```

Sin rama de error en Gmail, a propósito: si Gmail falla, la ejecución falla (y se guarda, para
diagnosticar) y n8n responde 500, que hub-api apunta como `password_reset_envio_fallido`. Un token
malo lo rechaza el propio Webhook con 403, como en el flujo de avisos de Trazabilidad (§2.3 del doc).

- [ ] **Step 3: Validarlo**

`n8n_validate_workflow` con el id devuelto. Corregir solo avisos de formato o de `typeVersion` (si el
MCP propone una versión más nueva de un nodo, usarla manteniendo los mismos parámetros). Los avisos de
«credencial sin asignar» son esperables hasta el paso siguiente.

- [ ] **Step 4: El usuario engancha las credenciales y activa el flujo**

En la interfaz de n8n:
- Nodo **Webhook** → *Authentication* Header Auth → credencial «Token restablecer contraseña».
- Nodo **Enviar correo** → la credencial de Gmail del buzón ya conectado que el usuario confirme. Ojo:
  n8n asigna por defecto la «Gmail account» compartida al abrir un nodo Gmail nuevo (ver §2.3 del
  doc); el usuario decide cuál.
- Comprobar en *Settings* del flujo: «Save successful production executions» = No, «Save failed
  production executions» = Yes.
- Guardar y **activar**.

- [ ] **Step 5: Prueba a mano, solo a un buzón propio**

El usuario, en su PowerShell. Primero esta línea sola (lee el token sin enseñarlo; si se pega junto con
otras, `Read-Host` se traga la siguiente):

```powershell
$t = [System.Net.NetworkCredential]::new('', (Read-Host 'Token' -AsSecureString)).Password
```

Después:

```powershell
$para = Read-Host 'Buzón de prueba (uno propio, nunca el de otra persona)'
$json = @{ para = $para; asunto = '[PRUEBA] Restablecer contraseña'; cuerpo = '<p>Prueba del flujo <b>Portal — Restablecer contraseña</b>.</p>' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'https://ambientalia-project-n8n.842ean.easypanel.host/webhook/portal-restablecer-contrasena' -Headers @{ 'X-Password-Reset-Token' = $t } -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
```

Esperado: `ok : True`, y en el buzón de prueba un correo con asunto «[PRUEBA] Restablecer contraseña»
y la negrita pintada (HTML, no texto con etiquetas), sin la firma de n8n.

Sin la cabecera:

```powershell
try { Invoke-RestMethod -Method Post -Uri 'https://ambientalia-project-n8n.842ean.easypanel.host/webhook/portal-restablecer-contrasena' -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) } catch { $_.Exception.Response.StatusCode.value__ }
```

Esperado: `403`. En *Executions* del flujo no debe aparecer la ejecución correcta (no se guardan).

- [ ] **Step 6: Documentar el flujo**

En `docs/n8n-automatizaciones.md`, sustituir:

```markdown
  salió y que no salió (con una espera temporal de 40 s, ya quitada).

---

## 3. Checklist para una app nueva
```

por:

````markdown
  salió y que no salió (con una espera temporal de 40 s, ya quitada).

### 2.4 Recuperación de contraseña del portal (webhook síncrono, sin barrera)

Los correos de «¿Olvidaste tu contraseña?» (2026-11-13) siguen la forma de 2.3, más simple: hub-api
llama al Webhook al momento y espera 10 s como mucho, pero la persona no espera a n8n (hub-api ya le ha
respondido) y nadie reintenta: si falla, vuelve a pedir el enlace.

| Workflow | Forma |
|---|---|
| **Portal — Restablecer contraseña** | Webhook síncrono (`POST /webhook/portal-restablecer-contrasena`): un correo por llamada |

```
hub-api (POST JSON {para, asunto, cuerpo}, cabecera X-Password-Reset-Token,
         espera 10 s como mucho, no sigue redirecciones; nunca lanza)
      ▼
Webhook (Header Auth, credencial «Token restablecer contraseña») ── token malo ──▶ 403 de n8n
      ▼
Gmail (HTML; appendAttribution = false; sin reintentos)
      │ (error) ──▶ la ejecución falla y n8n responde 500
      ▼
Respond 200 {ok: true}
```

- Lo llama `apps/hub-api/src/users/password-reset/password-reset.mailer.ts`. Cualquier respuesta que no
  sea 2xx, o 10 s sin respuesta, deja en el log de hub-api `password_reset_envio_fallido`; sin
  `PASSWORD_RESET_N8N_URL` o `PASSWORD_RESET_N8N_TOKEN`, `password_reset_sin_configurar` y no sale nada.
- **No guarda las ejecuciones correctas** (`saveDataSuccessExecution: none`): el enlace con su token no
  queda en el historial. Las fallidas sí se guardan, para diagnosticar, y llevan el enlace y la
  cabecera: restringir quién ve el flujo. El enlace caduca a los 30 minutos y es de un solo uso.
- El token es el valor de la credencial Header Auth y el mismo que `PASSWORD_RESET_N8N_TOKEN` en
  EasyPanel. Propio de este flujo. Si aparece en un chat o en un log, se rota en los dos sitios.
- Sin barrera de dominio: el destinatario es siempre el correo de la propia cuenta, que hub-api lee de
  `portal.users`, nunca del cuerpo de la petición del navegador.
- Probarlo a mano como en 2.3 (el token leído con `-AsSecureString`) y SIEMPRE a un buzón propio.

---

## 3. Checklist para una app nueva
````

- [ ] **Step 7: Commit**

```bash
git add docs/n8n-automatizaciones.md
git commit -m "docs(n8n): flujo de restablecer contrasena del portal"
```

---

### Task 12: Verificación completa

**Files:** ninguno.

- [ ] **Step 1: hub-api, unitarios con cobertura**

```bash
cd apps/hub-api && npm test
```

Esperado: todo en verde y los umbrales de cobertura cumplidos. Si cae solo
`4.4 — registrar un email ya existente lanza 409…`, relanzarlo aislado
(`npx vitest run src/users/users.service.test.ts`) antes de darlo por fallo: solo se cae por timeout
bajo carga.

- [ ] **Step 2: hub-api, contra Postgres (Docker)**

```bash
cd apps/hub-api && npm run test:db
```

Esperado: todo en verde; en el arranque del contenedor aparece
`migration applied: 077_password_reset_tokens.sql`.

- [ ] **Step 3: hub-api, tipos (el build de Docker compila también los tests)**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: sin errores.

- [ ] **Step 4: portal, tests, tipos y lint de lo tocado**

```bash
cd apps/portal && npx vitest run
cd apps/portal && npx tsc -b
cd apps/portal && npx eslint src/components/Auth src/pages/RestablecerContrasena.tsx src/pages/RestablecerContrasena.test.tsx src/App.tsx
```

Esperado: todo en verde, sin errores de tipos ni de lint.

- [ ] **Step 5: Revisión de privacidad del diff (repo público), en un comando aparte**

```bash
git diff main...HEAD | grep -noE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" | sort -u
```

Esperado: solo direcciones ficticias (`@ejemplo.test`, `@restablecer.test`, `tu@ejemplo.com`). Ningún
correo real, token ni URL con credenciales.

---

### Task 13: Integrar en `main` y desplegar

**Files:** ninguno del código.

- [ ] **Step 1: Merge a `main` (desde la copia principal, no desde la worktree)**

En la raíz de la copia principal (`antigravity-suite-R1.07`, en `main`; el `.gitignore` modificado y
los ficheros sin seguimiento del usuario se quedan como están):

```bash
git merge --no-ff feat/recuperacion-contrasena -m "merge: recuperacion de contrasena por correo"
```

- [ ] **Step 2: Revisión de privacidad, en un comando aparte, antes de empujar**

```bash
git diff origin/main..main | grep -noE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" | sort -u
```

Esperado: las mismas direcciones ficticias de la Task 12.

- [ ] **Step 3: Empujar**

```bash
git push origin main
```

Empujar no despliega: el despliegue lo hace el usuario a mano en EasyPanel.

- [ ] **Step 4: Retirar la worktree y la rama**

```bash
git worktree remove ../antigravity-suite-R1.07-worktrees/recuperacion-contrasena
git branch -d feat/recuperacion-contrasena
```

Si `git worktree remove` se niega por ficheros sin seguimiento, listarlos con
`git -C ../antigravity-suite-R1.07-worktrees/recuperacion-contrasena status --short` y usar `--force`
solo si son `.codegraph/` o restos de instalación; si hay otra cosa, preguntar al usuario.

- [ ] **Step 5: Despliegue — lo hace el usuario (spec §10), en este orden**

Quien ejecuta el plan no despliega; deja al usuario esta lista:

- [ ] El flujo «Portal — Restablecer contraseña» está activo en n8n, con la credencial Header Auth y la
  de Gmail confirmadas (Task 11).
- [ ] En EasyPanel, servicio hub-api, añadir:
  `PASSWORD_RESET_N8N_URL=https://ambientalia-project-n8n.842ean.easypanel.host/webhook/portal-restablecer-contrasena`
  y `PASSWORD_RESET_N8N_TOKEN` con el mismo valor de la credencial Header Auth.
  Nota: EasyPanel imprime las variables en cada log de build (pendiente conocido de rotación de
  secretos); añadir este token a esa lista.
- [ ] Desplegar **hub-api** primero. En el log: `migration applied: 077_password_reset_tokens.sql` y
  `hub-api listening on :…`. Si el portal saliera antes, el enlace «¿Olvidaste tu contraseña?»
  aparecería pero las rutas darían 404.
- [ ] Desplegar el **portal**.
- [ ] Prueba en producción con una cuenta propia del usuario (nunca la de otra persona):
  1. En `/auth`, pestaña «Iniciar sesión» → «¿Olvidaste tu contraseña?» → correo → «Enviar enlace» →
     sale el mensaje genérico.
  2. Llega el correo «Restablecer tu contraseña del Portal Ambientalia» con el botón y el enlace en
     texto.
  3. Al abrir el enlace, la barra de direcciones queda en `/auth/restablecer`, sin `#t=…`.
  4. Elegir una contraseña nueva → «Contraseña actualizada» → «Ir a iniciar sesión» abre la pestaña de
     iniciar sesión → entrar con la clave nueva. Una sesión abierta en otro navegador queda fuera.
  5. Llega el aviso «Tu contraseña del Portal Ambientalia se ha cambiado» con la hora de Colombia.
  6. Volver a abrir el mismo enlace → «Este enlace no es válido o ha caducado» → «Pedir un enlace nuevo»
     abre el modo «¿Olvidaste tu contraseña?».
  7. En el log de hub-api: `password_reset_requested` y `password_reset_completed` con `user_id`, sin
     ningún correo. En n8n, ninguna ejecución correcta guardada.
