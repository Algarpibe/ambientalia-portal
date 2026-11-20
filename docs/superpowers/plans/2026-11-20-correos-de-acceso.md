# Correos de acceso — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la persona se entere por correo, en el momento, de que un administrador le ha dado
acceso al portal (bienvenida al aprobar la cuenta, reactivación) o a una aplicación nueva, con los
enlaces para entrar; y que esos enlaces la lleven a donde dicen.

**Architecture:** módulo nuevo `apps/hub-api/src/users/access-emails/` en tres piezas de una sola
responsabilidad. `app-catalog.ts` es la copia del catálogo de apps del portal (id → nombre y ruta),
vigilada por un test candado que lee `apps/portal/src/lib/apps.ts` como texto. `access-emails.ts`
arma los tres correos (funciones puras). `access-notifier.ts` (`AccessNotifier`) aplica las reglas
del §3 del spec, arma el correo, lo entrega al puerto `ResetMailer` de la recuperación de contraseña y
deja siempre una línea de log; nunca lanza. `createUsersRouter(pool, deps)` recibe el notificador y lo
llama después de responder al admin en `PATCH /users/:id/status` (paso a `active`) y en
`PUT /users/:id/apps`, detrás de `Promise.resolve().then(...).catch(...)`. `index.ts` crea un único
`createResetMailer()` para la recuperación de contraseña y para el notificador. En el portal, `AuthCard`
abre en «Iniciar sesión» con `?modo=login` o con `state.from`, y el login vuelve a `state.from` si es
una ruta interna (`destinoTrasLogin`). En n8n solo se renombran el flujo y su nota.

**Tech Stack:** hub-api (Express 4, TypeScript ESM con imports `.js`, Vitest 2 + supertest); portal
(React 19, react-router-dom 7, Vitest 4 + jsdom + Testing Library con `fireEvent`); n8n (vía MCP).

**Spec:** `docs/superpowers/specs/2026-11-20-correos-de-acceso-design.md`.
**Rama:** `feat/correos-de-acceso`, en una worktree propia (Task 0).

---

## Reglas para quien implemente

- **TDD estricto:** cada test se ve en ROJO, y por la razón esperada, antes de escribir el código.
- **Editar solo con Edit/Write.** Nunca `Set-Content`, `sed -i` ni `perl -pi`: corrompen las tildes.
- **Commits:** convencionales, en español, sin tildes ni eñes, **sin ninguna línea de atribución**
  (nada de `Co-Authored-By`), con rutas explícitas (`git add <ruta> <ruta>`, nunca `git add -A` ni
  `git add .`).
- **No tocar** `.gitignore` ni los ficheros sin seguimiento del usuario (`.atl/`, `img/`, `openspec/`,
  `apps/WO-sales/prompts/`). **Nunca `git stash`** (ni con rutas ni sin ellas).
- **El repo es PÚBLICO:** ni correos reales ni secretos en código, tests, documentación o commits. En
  los tests, direcciones del estilo `persona@ejemplo.test`.
- **No lanzar vitest desde la raíz del repo** (se cuelan los `*.db.test.ts` y salen ~281 fallos
  falsos): siempre desde `apps/hub-api` o `apps/portal`. Este plan no añade tests de BD; si hiciera
  falta lanzar alguno, necesita Docker
  (`Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"` y esperar a que arranque).
- **Comentarios** en español explicando el porqué. Identificadores en inglés dentro de
  `apps/hub-api/src/users/access-emails/` (convención del módulo de usuarios). Los textos de los
  correos y de la interfaz, exactamente como en el spec y en este plan.
- **Candado de Trazabilidad** (`apps/hub-api/src/trazabilidad/envio-avisos.test.ts`, «CANDADO: el canal
  de salida»): ningún fuente nuevo de hub-api puede contener la palabra `remitir`, y `index.ts` no puede
  nombrar `envio-avisos`. Al citar ese patrón en un comentario, decir «el canal de avisos de
  Trazabilidad», sin la ruta entre comillas ni acentos graves.
- **Fuera del alcance, a propósito:** `apps/hub-api/src/users/users.service.ts` (el aviso cuelga de las
  rutas del admin, no de `UserService.approve`: así las aprobaciones de Calibraciones no avisan),
  `apps/hub-api/src/calibraciones/*`, `apps/portal/src/lib/apps.ts`, el panel de administración y el
  `Dockerfile` de hub-api.

**Lecciones de la recuperación de contraseña (plan 2026-11-13, «Desvíos»), ya incorporadas aquí:**
guarda contra fallos síncronos con `Promise.resolve().then(...)` en el router (Task 4) y `try/catch`
en el notificador (Task 3); escapar también los enlaces dentro del `href` y los nombres de las apps
(Task 2); el mailer avisa al arrancar si falta su configuración, así que se crea uno solo (Task 5); el
test de montaje de `index.ts` se actualiza en la misma tarea que el montaje (Task 5); tras cambiar una
firma, `tsc` de todo hub-api, porque el build de Docker compila también los tests (Tasks 4 y 5); en
n8n no se tocan los nodos tal como se construyeron (Webhook 2.1, Gmail 2.2 con «Gmail info@», Respond
to Webhook 1.5), solo el nombre y la nota (Task 9).

## File Structure

Todas las rutas son relativas a la raíz de la worktree.

| Fichero | Qué es / qué cambia |
|---|---|
| `apps/hub-api/src/users/access-emails/app-catalog.ts` | NUEVO. `AccessApp`, `ACCESS_APPS` (copia del catálogo del portal, mismo orden) y `knownApps` |
| `apps/hub-api/src/users/access-emails/app-catalog.test.ts` | NUEVO. Candado contra `apps/portal/src/lib/apps.ts` y tests de `knownApps` |
| `apps/hub-api/src/users/access-emails/access-emails.ts` | NUEVO. `AccessEmailContent`, `AccessEmailInput`, `buildWelcomeEmail`, `buildReactivatedEmail`, `buildNewAppsEmail` (puras) |
| `apps/hub-api/src/users/access-emails/access-emails.test.ts` | NUEVO |
| `apps/hub-api/src/users/access-emails/access-notifier.ts` | NUEVO. `AccessUser`, `toAccessUser`, `AccessNotifier`, `AccessNotifierActions` y los tipos de entrada |
| `apps/hub-api/src/users/access-emails/access-notifier.test.ts` | NUEVO |
| `apps/hub-api/src/users/users.router.ts` | Import (tras L9); `UsersRouterDeps` y `createUsersRouter(pool, deps = {})` con el ayudante `avisar` (L27-29); aviso en `PATCH /users/:id/status` (L182-183) y en `PUT /users/:id/apps` (L217-220) |
| `apps/hub-api/src/users.integration.test.ts` | Imports (L1-5); nuevo `describe('correos de acceso')` al final |
| `apps/hub-api/src/index.ts` | Import de `AccessNotifier` (tras L12); un solo `createResetMailer()` compartido (L130-145) |
| `apps/hub-api/src/users/password-reset/password-reset.router.test.ts` | `describe('montaje en index.ts')` (L240-254) con el mailer compartido |
| `apps/hub-api/src/users/password-reset/password-reset.mailer.ts` | Solo texto: comentario de cabecera (L5-7) y aviso de arranque (L60) |
| `apps/portal/src/components/Auth/destinoTrasLogin.ts` | NUEVO. `destinoTrasLogin(state)`: la ruta interna a la que volver, o `/` |
| `apps/portal/src/components/Auth/destinoTrasLogin.test.ts` | NUEVO |
| `apps/portal/src/components/Auth/AuthCard.tsx` | Abre en login con `?modo=login` o `state.from`; `state.modo` sigue mandando |
| `apps/portal/src/components/Auth/AuthCard.test.tsx` | Reescrito: el caso del `from` cambia de sentido |
| `apps/portal/src/components/Auth/AuthRightPanel.tsx` | `navigate(destinoTrasLogin(location.state))` en vez de `navigate('/')` (L2, L6, L25, L144) |
| `apps/portal/src/components/Auth/AuthRightPanel.test.tsx` | Imports (L4-10) y nuevo `describe` al final |
| `docs/n8n-automatizaciones.md` | §2.4 reescrita (L226-260) |
| n8n (fuera del repo) | Nombre y nota del flujo `0jYHqM3Z2mHZNFOC` |

**Lo que NO cambia, a propósito:** `RequireAuth.tsx` y `RequireAdmin.tsx` ya ponen
`state={{ from: location.pathname }}`. El `Dockerfile` de hub-api: el candado del catálogo lee el
fichero del portal con `readFileSync` solo cuando se ejecuta el test (no lo importa, así que `tsc` no
sale de `src/`), y el build de Docker compila los tests pero no los ejecuta. `.env.example`: no hay
variables nuevas.

---

### Task 0: Rama y worktree

**Files:** ninguno del código.

- [ ] **Step 1: Commitear este plan en `main` si aún no lo está**

```bash
git status --short docs/superpowers/plans/2026-11-20-correos-de-acceso.md
```

Si sale con `??`:

```bash
git add docs/superpowers/plans/2026-11-20-correos-de-acceso.md
git commit -m "docs(portal): plan de los correos de acceso"
```

- [ ] **Step 2: Crear la worktree (junto al repo, nunca en `/tmp`)**

```bash
git worktree add ../antigravity-suite-R1.07-worktrees/correos-de-acceso -b feat/correos-de-acceso main
```

Desde aquí, todos los comandos se lanzan desde la raíz de esa worktree. Si se va a usar CodeGraph en
ella, inicializar su propio índice con `gentle-ai codegraph init --cwd` y la ruta absoluta de la
worktree (nunca copiar el `.codegraph/` de la copia principal).

- [ ] **Step 3: Instalar dependencias — lo hace el usuario, en su propia ventana de PowerShell**

`npm ci` baja `@algarpibe/zoho-sync` del registro privado y necesita `NPM_TOKEN` (PAT clásico con
`read:packages`) en la MISMA ventana donde se lanza. Pedir al usuario que, desde la raíz de la copia
principal, ejecute primero estas dos líneas, cada una por separado (si se pega `Read-Host` junto con
otras, se traga la siguiente):

```powershell
Set-Location ..\antigravity-suite-R1.07-worktrees\correos-de-acceso
```

```powershell
$env:NPM_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'NPM_TOKEN' -AsSecureString)).Password
```

y después, en esa misma ventana:

```powershell
npm ci
```

Si falla con `E401`, parar y preguntar al usuario. No copiar `node_modules` de otra copia ni tocar
`.npmrc`.

- [ ] **Step 4: Línea base en verde**

```bash
cd apps/hub-api && npm test
cd apps/portal && npx vitest run
```

Esperado: todo en verde salvo dos fallos conocidos que no son de este trabajo:
`scripts/equipos-anonimizar.test.mjs` (falla en Windows) y, a veces, `4.4 — registrar un email ya
existente lanza 409…` de `users.service.test.ts`, que solo se cae por timeout bajo carga (relanzarlo
solo con `npx vitest run src/users/users.service.test.ts`).

---

### Task 1: El catálogo de apps en hub-api y su candado

**Files:**
- Create: `apps/hub-api/src/users/access-emails/app-catalog.test.ts`
- Create: `apps/hub-api/src/users/access-emails/app-catalog.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/users/access-emails/app-catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCESS_APPS, knownApps } from './app-catalog.js';

// CANDADO: ACCESS_APPS es una copia del catálogo del portal, que es la fuente de
// verdad. El fichero del portal se lee como TEXTO, no se importa: queda fuera de
// src/ y tsc no lo compilaría (ni el build de Docker, que solo copia
// apps/hub-api). Se comparan id, nombre y ruta, en el mismo orden.

const PORTAL_APPS = fileURLToPath(new URL('../../../../portal/src/lib/apps.ts', import.meta.url));

/** Las entradas de `APPS` del portal y cuántos `id:` hay en el bloque (para cazar un formato nuevo). */
function catalogoDelPortal() {
  const fuente = readFileSync(PORTAL_APPS, 'utf8');
  const inicio = fuente.indexOf('export const APPS');
  const bloque = fuente.slice(inicio, fuente.indexOf('];', inicio));
  const entradas = [...bloque.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*route:\s*'([^']+)'/g)].map(
    ([, id, label, route]) => ({ id, label, route }),
  );
  return { entradas, total: (bloque.match(/\bid:/g) ?? []).length };
}

describe('CANDADO: ACCESS_APPS es la copia de apps/portal/src/lib/apps.ts', () => {
  it('el lector entiende el fichero del portal: todas sus entradas, ninguna a medias', () => {
    const { entradas, total } = catalogoDelPortal();
    expect(entradas.length).toBeGreaterThan(0);
    expect(entradas).toHaveLength(total);
  });

  it('mismos ids, nombres y rutas, en el mismo orden', () => {
    const copia = Object.entries(ACCESS_APPS).map(([id, { label, route }]) => ({ id, label, route }));
    expect(copia).toEqual(catalogoDelPortal().entradas);
  });
});

describe('knownApps', () => {
  it('devuelve las conocidas en el orden del catálogo, sin repetir', () => {
    expect(knownApps(['contabilidad', 'payment-reconciliation', 'contabilidad'])).toEqual([
      { label: 'Conciliador de Pagos', route: '/conciliador-pagos' },
      { label: 'Contabilidad', route: '/contabilidad' },
    ]);
  });

  it('omite los ids que no están en el catálogo', () => {
    expect(knownApps(['app-que-no-existe', 'ausencias'])).toEqual([{ label: 'Vacaciones y Permisos', route: '/ausencias' }]);
  });

  it('sin ids conocidos, lista vacía', () => {
    expect(knownApps([])).toEqual([]);
    expect(knownApps(['app-que-no-existe'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/access-emails/app-catalog.test.ts
```

Esperado: FALLA al cargar el fichero, porque `./app-catalog.js` no existe.

- [ ] **Step 3: Implementar el catálogo**

Crear `apps/hub-api/src/users/access-emails/app-catalog.ts`:

```ts
/**
 * Las apps del portal que pueden salir en un correo de acceso: el nombre y la
 * ruta de cada id de portal.user_apps.
 *
 * Es una COPIA de apps/portal/src/lib/apps.ts (la fuente de verdad), en el
 * mismo orden. hub-api no puede importar el portal: su Dockerfile solo copia
 * apps/hub-api, y un paquete compartido obligaría a cambiarlo. Para que la copia
 * no se quede atrás, app-catalog.test.ts lee el fichero del portal y falla si
 * ids, nombres o rutas no coinciden: quien añada o renombre una app en el
 * portal, que la cambie también aquí.
 */

export interface AccessApp {
  label: string;
  route: string;
}

export const ACCESS_APPS: Readonly<Record<string, AccessApp>> = {
  'payment-reconciliation': { label: 'Conciliador de Pagos', route: '/conciliador-pagos' },
  'inventory-optimization': { label: 'Análisis de Inventario', route: '/analisis-inventario' },
  'inventory-consolidation': { label: 'Consolidador de Inventario', route: '/consolidador-inventario' },
  'laboratorios-ambientales': { label: 'Laboratorios Ambientales', route: '/laboratorios-ambientales' },
  'customer-valuation': { label: 'Valoración de Clientes', route: '/valoracion-clientes' },
  'WO-sales': { label: 'Carga de Pedidos WO', route: '/carga-pedidos-wo' },
  contabilidad: { label: 'Contabilidad', route: '/contabilidad' },
  'ov-pendientes': { label: 'OV pendientes de facturar', route: '/ov-pendientes' },
  ausencias: { label: 'Vacaciones y Permisos', route: '/ausencias' },
  calibraciones: { label: 'Calibraciones', route: '/calibraciones' },
  'trazabilidad-mantenimientos': { label: 'Trazabilidad Mantenimientos Clientes', route: '/trazabilidad-mantenimientos' },
  'equipos-taller': { label: 'Equipos en taller', route: '/equipos-taller' },
};

/**
 * Las apps conocidas de `ids`, en el orden del catálogo y sin repetir. Un id que
 * no está en el catálogo se omite: el correo no puede nombrar ni enlazar una app
 * que no sabe cuál es.
 */
export function knownApps(ids: readonly string[]): AccessApp[] {
  const pedidas = new Set(ids);
  return Object.entries(ACCESS_APPS)
    .filter(([id]) => pedidas.has(id))
    .map(([, app]) => app);
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/access-emails/app-catalog.test.ts
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/users/access-emails/app-catalog.ts apps/hub-api/src/users/access-emails/app-catalog.test.ts
git commit -m "feat(hub-api): catalogo de apps para los correos de acceso"
```

---

### Task 2: Los tres correos (funciones puras)

**Files:**
- Create: `apps/hub-api/src/users/access-emails/access-emails.test.ts`
- Create: `apps/hub-api/src/users/access-emails/access-emails.ts`

El spec (§4.3) fija los asuntos, el saludo de la bienvenida, el texto sin apps y el cierre. El saludo
de la reactivación y el de las apps nuevas salen de sus asuntos, y la lista de la bienvenida y de la
reactivación va precedida de «Tus aplicaciones:».

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/users/access-emails/access-emails.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildNewAppsEmail,
  buildReactivatedEmail,
  buildWelcomeEmail,
  type AccessEmailContent,
  type AccessEmailInput,
} from './access-emails.js';

// Asunto y cuerpo de los tres correos de acceso (spec 2026-11-20, §4.3).
// Puras: ni red, ni reloj, ni entorno.

const PORTAL = 'https://portal.ejemplo.test';
const ENTRAR = `href="${PORTAL}/auth?modo=login"`;
const CONTABILIDAD = { label: 'Contabilidad', route: '/contabilidad' };
const AUSENCIAS = { label: 'Vacaciones y Permisos', route: '/ausencias' };
const SIN_APPS = 'Todavía no tienes aplicaciones asignadas; te avisaremos cuando te den acceso a alguna.';
const CIERRE = 'Si olvidas tu contraseña, usa “¿Olvidaste tu contraseña?” en la pantalla de acceso.';
const CORREO_EN_TEXTO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const datos = (parcial: Partial<AccessEmailInput> = {}): AccessEmailInput => ({
  fullName: 'Ana Ruiz',
  portalUrl: PORTAL,
  apps: [CONTABILIDAD, AUSENCIAS],
  ...parcial,
});

// Bienvenida y reactivación comparten esquema; cambian el asunto y el saludo.
const CUENTA_ACTIVA: [string, (input: AccessEmailInput) => AccessEmailContent, string, string][] = [
  ['buildWelcomeEmail', buildWelcomeEmail, 'Bienvenido al Portal Ambientalia', 'Hola, Ana Ruiz: tu cuenta del Portal Ambientalia ya está activa.'],
  [
    'buildReactivatedEmail',
    buildReactivatedEmail,
    'Tu acceso al Portal Ambientalia está activo de nuevo',
    'Hola, Ana Ruiz: tu acceso al Portal Ambientalia está activo de nuevo.',
  ],
];

describe.each(CUENTA_ACTIVA)('%s', (_nombre, build, asunto, saludo) => {
  it('asunto fijo y saludo por el nombre', () => {
    const correo = build(datos());
    expect(correo.asunto).toBe(asunto);
    expect(correo.cuerpo).toContain(`<p>${saludo}</p>`);
  });

  it('el botón «Entrar al portal» abre /auth en «Iniciar sesión»', () => {
    const { cuerpo } = build(datos());
    expect(cuerpo).toContain(ENTRAR);
    expect(cuerpo).toContain('>Entrar al portal</a>');
  });

  it('lista sus apps, cada una con el enlace a su ruta en el portal', () => {
    const { cuerpo } = build(datos());
    expect(cuerpo).toContain('<p>Tus aplicaciones:</p>');
    expect(cuerpo).toContain(`<a href="${PORTAL}/contabilidad">Contabilidad</a>`);
    expect(cuerpo).toContain(`<a href="${PORTAL}/ausencias">Vacaciones y Permisos</a>`);
    expect(cuerpo).not.toContain(SIN_APPS);
  });

  it('sin apps, dice que se le avisará cuando tenga alguna', () => {
    const { cuerpo } = build(datos({ apps: [] }));
    expect(cuerpo).toContain(SIN_APPS);
    expect(cuerpo).not.toContain('<ul>');
  });

  it('cierra recordando «¿Olvidaste tu contraseña?», tenga apps o no', () => {
    expect(build(datos()).cuerpo).toContain(CIERRE);
    expect(build(datos({ apps: [] })).cuerpo).toContain(CIERRE);
  });

  it('no duplica la barra si la base acaba en /', () => {
    const { cuerpo } = build(datos({ portalUrl: `${PORTAL}//` }));
    expect(cuerpo).toContain(ENTRAR);
    expect(cuerpo).toContain(`href="${PORTAL}/contabilidad"`);
    expect(cuerpo).not.toContain('.test//');
  });

  it('escapa el nombre: lo escribió la persona al registrarse', () => {
    const { cuerpo } = build(datos({ fullName: '<script>alert(1)</script>' }));
    expect(cuerpo).not.toContain('<script>');
    expect(cuerpo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('no trae ningún correo de contacto (el repo es público)', () => {
    expect(build(datos()).cuerpo).not.toMatch(CORREO_EN_TEXTO);
  });
});

describe('buildNewAppsEmail', () => {
  it('con una app, el asunto y el saludo la nombran', () => {
    const correo = buildNewAppsEmail(datos({ apps: [CONTABILIDAD] }));
    expect(correo.asunto).toBe('Ya tienes acceso a Contabilidad en el Portal Ambientalia');
    expect(correo.cuerpo).toContain('<p>Hola, Ana Ruiz: ya tienes acceso a Contabilidad en el Portal Ambientalia.</p>');
  });

  it('con varias, el asunto va en plural', () => {
    const correo = buildNewAppsEmail(datos());
    expect(correo.asunto).toBe('Tienes acceso a nuevas aplicaciones del Portal Ambientalia');
    expect(correo.cuerpo).toContain('<p>Hola, Ana Ruiz: tienes acceso a nuevas aplicaciones del Portal Ambientalia.</p>');
  });

  it('lista las que recibe, con su enlace, y lleva el botón «Entrar al portal»', () => {
    const { cuerpo } = buildNewAppsEmail(datos());
    expect(cuerpo).toContain(`<a href="${PORTAL}/contabilidad">Contabilidad</a>`);
    expect(cuerpo).toContain(`<a href="${PORTAL}/ausencias">Vacaciones y Permisos</a>`);
    expect(cuerpo).toContain(ENTRAR);
    expect(cuerpo).toContain('>Entrar al portal</a>');
  });

  it('escapa el nombre de la app y su enlace dentro del href: una comilla no puede romper el atributo', () => {
    const { cuerpo } = buildNewAppsEmail(datos({ apps: [{ label: 'Informe <b>', route: '/x?a=1&b="y' }] }));
    expect(cuerpo).toContain('Informe &lt;b&gt;');
    expect(cuerpo).not.toContain('Informe <b>');
    expect(cuerpo).toContain(`href="${PORTAL}/x?a=1&amp;b=&quot;y"`);
    expect(cuerpo).not.toContain('"y');
  });

  it('escapa el nombre de la persona', () => {
    const { cuerpo } = buildNewAppsEmail(datos({ fullName: 'Ana <b>Ruiz</b>' }));
    expect(cuerpo).toContain('Ana &lt;b&gt;Ruiz&lt;/b&gt;');
  });

  it('no trae ningún correo de contacto (el repo es público)', () => {
    expect(buildNewAppsEmail(datos()).cuerpo).not.toMatch(CORREO_EN_TEXTO);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/access-emails/access-emails.test.ts
```

Esperado: FALLA al cargar, porque `./access-emails.js` no existe.

- [ ] **Step 3: Implementar los correos**

Crear `apps/hub-api/src/users/access-emails/access-emails.ts`:

```ts
import { escapeHtml } from '../password-reset/password-reset.emails.js';
import type { AccessApp } from './app-catalog.js';

/**
 * Asunto y cuerpo de los tres correos de acceso al portal (spec 2026-11-20,
 * §4.3): bienvenida al aprobar la cuenta, reactivación y apps nuevas. Funciones
 * puras —ni red, ni reloj, ni entorno—; los envía access-notifier.ts.
 *
 * Mismo HTML sencillo con estilos en línea que los de la recuperación de
 * contraseña (los clientes de correo ignoran las hojas de estilo). Se escapa
 * todo lo que se inserta: el nombre (lo escribió la persona al registrarse), los
 * nombres de las apps y los enlaces dentro del href, donde una comilla rompería
 * el atributo. Sin ningún correo de contacto: el repo es público.
 */

/** Lo que lleva cada correo; el destinatario lo pone quien lo envía. */
export interface AccessEmailContent {
  asunto: string;
  cuerpo: string;
}

export interface AccessEmailInput {
  fullName: string;
  /** Base pública del portal (urlPortal()); se toleran barras al final. */
  portalUrl: string;
  /** Las apps que se listan, ya filtradas y ordenadas por knownApps. */
  apps: readonly AccessApp[];
}

const base = (portalUrl: string): string => portalUrl.replace(/\/+$/, '');

const envolver = (html: string): string =>
  `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;">${html}</div>`;

/** El botón abre /auth directamente en «Iniciar sesión» (el portal lee `?modo=login`). */
const botonEntrar = (portalUrl: string): string =>
  `<p><a href="${escapeHtml(`${base(portalUrl)}/auth?modo=login`)}" style="display: inline-block; padding: 10px 18px; background: #1abc9c; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">Entrar al portal</a></p>`;

/** Cada app con el enlace a su ruta. Sin sesión, el portal pide entrar y después vuelve a esa ruta. */
const listaApps = (portalUrl: string, apps: readonly AccessApp[]): string =>
  `<ul>${apps
    .map((app) => `<li><a href="${escapeHtml(`${base(portalUrl)}${app.route}`)}">${escapeHtml(app.label)}</a></li>`)
    .join('')}</ul>`;

const SIN_APPS = '<p>Todavía no tienes aplicaciones asignadas; te avisaremos cuando te den acceso a alguna.</p>';
const CIERRE = '<p>Si olvidas tu contraseña, usa “¿Olvidaste tu contraseña?” en la pantalla de acceso.</p>';

/**
 * Bienvenida y reactivación comparten esquema: saludo, botón, las apps que la
 * cuenta tiene en ese momento (o el aviso de que aún no tiene) y el cierre.
 */
function cuentaActiva(saludo: string, { portalUrl, apps }: AccessEmailInput): string {
  const susApps = apps.length > 0 ? `<p>Tus aplicaciones:</p>${listaApps(portalUrl, apps)}` : SIN_APPS;
  return envolver(`<p>${saludo}</p>${botonEntrar(portalUrl)}${susApps}${CIERRE}`);
}

/** Al aprobar una cuenta pending. */
export function buildWelcomeEmail(input: AccessEmailInput): AccessEmailContent {
  return {
    asunto: 'Bienvenido al Portal Ambientalia',
    cuerpo: cuentaActiva(`Hola, ${escapeHtml(input.fullName)}: tu cuenta del Portal Ambientalia ya está activa.`, input),
  };
}

/** Al reactivar una cuenta inactive. */
export function buildReactivatedEmail(input: AccessEmailInput): AccessEmailContent {
  return {
    asunto: 'Tu acceso al Portal Ambientalia está activo de nuevo',
    cuerpo: cuentaActiva(`Hola, ${escapeHtml(input.fullName)}: tu acceso al Portal Ambientalia está activo de nuevo.`, input),
  };
}

/**
 * Al asignar apps nuevas a una cuenta activa: lista solo las nuevas. El asunto
 * va en texto plano (no es HTML) y los nombres salen del catálogo.
 */
export function buildNewAppsEmail({ fullName, portalUrl, apps }: AccessEmailInput): AccessEmailContent {
  const nombre = escapeHtml(fullName);
  const una = apps.length === 1 ? apps[0] : undefined;
  const saludo = una
    ? `Hola, ${nombre}: ya tienes acceso a ${escapeHtml(una.label)} en el Portal Ambientalia.`
    : `Hola, ${nombre}: tienes acceso a nuevas aplicaciones del Portal Ambientalia.`;
  return {
    asunto: una
      ? `Ya tienes acceso a ${una.label} en el Portal Ambientalia`
      : 'Tienes acceso a nuevas aplicaciones del Portal Ambientalia',
    cuerpo: envolver(`<p>${saludo}</p>${listaApps(portalUrl, apps)}${botonEntrar(portalUrl)}`),
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/access-emails/access-emails.test.ts
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/users/access-emails/access-emails.ts apps/hub-api/src/users/access-emails/access-emails.test.ts
git commit -m "feat(hub-api): correos de bienvenida, reactivacion y apps nuevas"
```

---

### Task 3: `AccessNotifier` — reglas, envío y log

**Files:**
- Create: `apps/hub-api/src/users/access-emails/access-notifier.test.ts`
- Create: `apps/hub-api/src/users/access-emails/access-notifier.ts`

El mailer de verdad (`createResetMailer`) nunca rechaza: si n8n falla, deja su propia línea
`password_reset_envio_fallido` y vuelve con normalidad. Por eso `user_access_email_sent` significa
«entregado al mailer», y `user_access_email_failed` solo aparece si el mailer rechaza (el doble de los
tests, o un fallo inesperado). La Task 9 lo deja escrito en la documentación.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/users/access-emails/access-notifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ResetLog } from '../password-reset/password-reset.service.js';
import { FakeMailer } from '../password-reset/test-fakes.js';
import type { UserStatus } from '../users.types.js';
import { AccessNotifier, toAccessUser, type AccessUser } from './access-notifier.js';

// Las reglas de los correos de acceso (spec 2026-11-20, §3 y §4.1) sin red: el
// mailer es el doble de la recuperación de contraseña (test-fakes.ts) y el log
// se apunta en una lista. Qué dice cada correo lo vigila access-emails.test.ts;
// aquí, cuándo sale, a quién y qué queda en el log.

const PORTAL = 'https://portal.ejemplo.test';

const cuenta = (status: UserStatus = 'active'): AccessUser => ({
  id: 'user-1',
  email: 'ana@ejemplo.test',
  fullName: 'Ana Ruiz',
  status,
});

function montar() {
  const mailer = new FakeMailer();
  const eventos: { event: string; data: Record<string, unknown> }[] = [];
  const log: ResetLog = (event, data = {}) => {
    eventos.push({ event, data });
  };
  return { mailer, eventos, notifier: new AccessNotifier({ mailer, portalUrl: PORTAL, log }) };
}

const omitido = (reason: string) => ({ event: 'user_access_email_skipped', data: { user_id: 'user-1', reason } });

describe('statusChanged', () => {
  it('desde pending → bienvenida a la propia cuenta, con sus apps', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: ['contabilidad'] });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].para).toBe('ana@ejemplo.test');
    expect(mailer.sent[0].asunto).toBe('Bienvenido al Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`<a href="${PORTAL}/contabilidad">Contabilidad</a>`);
    expect(eventos).toEqual([{ event: 'user_access_email_sent', data: { user_id: 'user-1', kind: 'welcome' } }]);
  });

  it('desde inactive → reactivación', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'inactive', apps: ['ausencias'] });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].asunto).toBe('Tu acceso al Portal Ambientalia está activo de nuevo');
    expect(mailer.sent[0].cuerpo).toContain(`<a href="${PORTAL}/ausencias">Vacaciones y Permisos</a>`);
    expect(eventos).toEqual([{ event: 'user_access_email_sent', data: { user_id: 'user-1', kind: 'reactivated' } }]);
  });

  it('desde active (el router lo trata como reactivación) → nada: no_transition', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'active', apps: ['ausencias'] });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('no_transition')]);
  });

  it('lista solo las apps conocidas, en el orden del catálogo', async () => {
    const { mailer, notifier } = montar();
    await notifier.statusChanged({
      user: cuenta(),
      previousStatus: 'pending',
      apps: ['contabilidad', 'app-que-no-existe', 'payment-reconciliation'],
    });
    const { cuerpo } = mailer.sent[0];
    expect(cuerpo.indexOf('Conciliador de Pagos')).toBeGreaterThan(-1);
    expect(cuerpo.indexOf('Conciliador de Pagos')).toBeLessThan(cuerpo.indexOf('Contabilidad'));
    expect(cuerpo).not.toContain('app-que-no-existe');
  });

  it('sin apps, la bienvenida sale igual y dice que se le avisará', async () => {
    const { mailer, notifier } = montar();
    await notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: [] });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].cuerpo).toContain('Todavía no tienes aplicaciones asignadas');
  });
});

describe('appsChanged', () => {
  it('gana una app conocida con la cuenta activa → correo solo con la nueva', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: ['contabilidad'], after: ['ausencias', 'contabilidad'], isSelf: false });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].para).toBe('ana@ejemplo.test');
    expect(mailer.sent[0].asunto).toBe('Ya tienes acceso a Vacaciones y Permisos en el Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`${PORTAL}/ausencias`);
    expect(mailer.sent[0].cuerpo).not.toContain(`${PORTAL}/contabilidad`);
    expect(eventos).toEqual([{ event: 'user_access_email_sent', data: { user_id: 'user-1', kind: 'new_apps' } }]);
  });

  it('gana varias → asunto en plural, y las lista todas', async () => {
    const { mailer, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias', 'contabilidad'], isSelf: false });
    expect(mailer.sent[0].asunto).toBe('Tienes acceso a nuevas aplicaciones del Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).toContain(`${PORTAL}/ausencias`);
    expect(mailer.sent[0].cuerpo).toContain(`${PORTAL}/contabilidad`);
  });

  it.each<[string, string[], string[]]>([
    ['quitar apps', ['ausencias', 'contabilidad'], ['contabilidad']],
    ['guardar la misma lista, aunque sea en otro orden', ['ausencias', 'contabilidad'], ['contabilidad', 'ausencias']],
    ['dejarla vacía', ['ausencias'], []],
  ])('%s → nada: no_new_apps', async (_caso, before, after) => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before, after, isSelf: false });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('no_new_apps')]);
  });

  it.each(['pending', 'inactive'] as const)('con la cuenta %s → nada: not_active (no puede entrar)', async (status) => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(status), before: [], after: ['ausencias'], isSelf: false });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('not_active')]);
  });

  it('en la propia cuenta del admin → nada: self', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: true });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('self')]);
  });

  it('si las nuevas son todas desconocidas → nada: no_known_apps', async () => {
    const { mailer, eventos, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: ['contabilidad'], after: ['contabilidad', 'app-que-no-existe'], isSelf: false });
    expect(mailer.sent).toEqual([]);
    expect(eventos).toEqual([omitido('no_known_apps')]);
  });

  it('una nueva conocida y otra desconocida → correo solo con la conocida, en singular', async () => {
    const { mailer, notifier } = montar();
    await notifier.appsChanged({ user: cuenta(), before: [], after: ['app-que-no-existe', 'calibraciones'], isSelf: false });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].asunto).toBe('Ya tienes acceso a Calibraciones en el Portal Ambientalia');
    expect(mailer.sent[0].cuerpo).not.toContain('app-que-no-existe');
  });
});

describe('nunca lanza', () => {
  it('si el mailer falla en la bienvenida, no se propaga y queda user_access_email_failed', async () => {
    const { mailer, eventos, notifier } = montar();
    mailer.fail = true;
    await expect(notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: [] })).resolves.toBeUndefined();
    expect(eventos).toEqual([
      { event: 'user_access_email_failed', data: { user_id: 'user-1', kind: 'welcome', motivo: 'n8n caído' } },
    ]);
  });

  it('lo mismo con el correo de apps nuevas', async () => {
    const { mailer, eventos, notifier } = montar();
    mailer.fail = true;
    await expect(
      notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: false }),
    ).resolves.toBeUndefined();
    expect(eventos).toEqual([
      { event: 'user_access_email_failed', data: { user_id: 'user-1', kind: 'new_apps', motivo: 'n8n caído' } },
    ]);
  });
});

describe('el log', () => {
  it('cada llamada deja exactamente una línea, siempre con el user_id y nunca con el correo', async () => {
    const { mailer, eventos, notifier } = montar();
    const llamadas = [
      () => notifier.statusChanged({ user: cuenta(), previousStatus: 'pending', apps: ['contabilidad'] }),
      () => notifier.statusChanged({ user: cuenta(), previousStatus: 'active', apps: [] }),
      () => notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: false }),
      () => notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: true }),
      async () => {
        mailer.fail = true;
        await notifier.appsChanged({ user: cuenta(), before: [], after: ['ausencias'], isSelf: false });
      },
    ];
    for (const [i, llamar] of llamadas.entries()) {
      await llamar();
      expect(eventos).toHaveLength(i + 1);
    }
    expect(eventos.every((e) => e.data.user_id === 'user-1')).toBe(true);
    expect(JSON.stringify(eventos)).not.toContain('@');
  });
});

describe('toAccessUser', () => {
  it('saca de la cuenta pública lo que el notificador necesita', () => {
    expect(
      toAccessUser({
        id: 'user-1',
        full_name: 'Ana Ruiz',
        email: 'ana@ejemplo.test',
        role: 'reader',
        status: 'active',
        created_at: '2026-11-20T15:00:00.000Z',
      }),
    ).toEqual({ id: 'user-1', email: 'ana@ejemplo.test', fullName: 'Ana Ruiz', status: 'active' });
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/access-emails/access-notifier.test.ts
```

Esperado: FALLA al cargar, porque `./access-notifier.js` no existe.

- [ ] **Step 3: Implementar el notificador**

Crear `apps/hub-api/src/users/access-emails/access-notifier.ts`:

```ts
import { logEvent, type ResetLog, type ResetMailer } from '../password-reset/password-reset.service.js';
import type { UserPublic, UserStatus } from '../users.types.js';
import { buildNewAppsEmail, buildReactivatedEmail, buildWelcomeEmail, type AccessEmailContent } from './access-emails.js';
import { knownApps } from './app-catalog.js';

/**
 * Correos de acceso al portal (spec 2026-11-20): bienvenida al aprobar una
 * cuenta, reactivación y apps nuevas. Aplica las reglas de cuándo sale cada uno
 * (§3), arma el correo y lo entrega al mailer de la recuperación de contraseña,
 * que habla con el mismo flujo de n8n. Lo llama el router de usuarios DESPUÉS de
 * responder al admin.
 *
 * NUNCA lanza, y cada llamada deja exactamente una línea de log, siempre con el
 * user_id y nunca con el correo: user_access_email_sent (con `kind`),
 * user_access_email_skipped (con `reason`) o user_access_email_failed.
 *
 * El mailer de verdad tampoco lanza: si n8n falla, deja su propia línea
 * (password_reset_envio_fallido, nombre histórico) y aquí queda
 * user_access_email_sent, que significa «entregado al mailer».
 */

/** Lo que el notificador necesita saber de la cuenta. */
export interface AccessUser {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
}

export interface StatusChangedInput {
  /** La cuenta, ya cambiada. */
  user: AccessUser;
  /** El estado ANTES del cambio: decide entre bienvenida (pending) y reactivación (inactive). */
  previousStatus: UserStatus;
  /** Los ids de las apps que la cuenta tiene ahora (portal.user_apps). */
  apps: string[];
}

export interface AppsChangedInput {
  user: AccessUser;
  /** Los ids de las apps antes de guardar. */
  before: string[];
  /** Los ids tal como quedaron guardados. */
  after: string[];
  /** El admin se ha cambiado sus propias apps. */
  isSelf: boolean;
}

export type AccessEmailKind = 'welcome' | 'reactivated' | 'new_apps';
export type AccessSkipReason = 'not_active' | 'self' | 'no_new_apps' | 'no_known_apps' | 'no_transition';

export interface AccessNotifierDeps {
  /** El puerto de la recuperación de contraseña; el de verdad es createResetMailer(). */
  mailer: ResetMailer;
  /** Base pública del portal (urlPortal()). */
  portalUrl: string;
  log?: ResetLog;
}

/** O un correo que enviar, o el motivo para no enviarlo. */
type Decision = { kind: AccessEmailKind; email: AccessEmailContent } | { reason: AccessSkipReason };

/** Lo que el notificador necesita de una cuenta tal como la devuelve UserService. */
export function toAccessUser(user: UserPublic): AccessUser {
  return { id: user.id, email: user.email, fullName: user.full_name, status: user.status };
}

export class AccessNotifier {
  private readonly mailer: ResetMailer;
  private readonly portalUrl: string;
  private readonly log: ResetLog;

  constructor(deps: AccessNotifierDeps) {
    this.mailer = deps.mailer;
    this.portalUrl = deps.portalUrl;
    this.log = deps.log ?? logEvent;
  }

  /**
   * Tras pasar una cuenta a active: bienvenida si venía de pending, reactivación
   * si venía de inactive. Desde active no hay correo (el router trata `{active}`
   * sobre una cuenta activa como una reactivación, pero no ha cambiado nada).
   * Las dos listan las apps que la cuenta tiene AHORA: quien recibió apps
   * estando pending o inactive se entera aquí.
   */
  async statusChanged({ user, previousStatus, apps }: StatusChangedInput): Promise<void> {
    await this.notify(user, () => {
      const input = { fullName: user.fullName, portalUrl: this.portalUrl, apps: knownApps(apps) };
      if (previousStatus === 'pending') return { kind: 'welcome', email: buildWelcomeEmail(input) };
      if (previousStatus === 'inactive') return { kind: 'reactivated', email: buildReactivatedEmail(input) };
      return { reason: 'no_transition' };
    });
  }

  /**
   * Tras guardar las apps de una cuenta: correo con las que gana. Quitar apps o
   * guardar la misma lista no avisa; tampoco a quien no puede entrar (pending o
   * inactive) ni al admin que se cambia las suyas.
   */
  async appsChanged({ user, before, after, isSelf }: AppsChangedInput): Promise<void> {
    await this.notify(user, () => {
      if (isSelf) return { reason: 'self' };
      if (user.status !== 'active') return { reason: 'not_active' };
      const antes = new Set(before);
      const nuevas = after.filter((id) => !antes.has(id));
      if (nuevas.length === 0) return { reason: 'no_new_apps' };
      const conocidas = knownApps(nuevas);
      if (conocidas.length === 0) return { reason: 'no_known_apps' };
      return {
        kind: 'new_apps',
        email: buildNewAppsEmail({ fullName: user.fullName, portalUrl: this.portalUrl, apps: conocidas }),
      };
    });
  }

  /** Decide, envía y deja SIEMPRE una línea de log. Nada de aquí dentro sale como excepción. */
  private async notify(user: AccessUser, decide: () => Decision): Promise<void> {
    let kind: AccessEmailKind | undefined;
    try {
      const decision = decide();
      if ('reason' in decision) {
        this.log('user_access_email_skipped', { user_id: user.id, reason: decision.reason });
        return;
      }
      kind = decision.kind;
      await this.mailer.send({ para: user.email, ...decision.email });
      this.log('user_access_email_sent', { user_id: user.id, kind });
    } catch (e) {
      this.log('user_access_email_failed', { user_id: user.id, kind, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Lo que el router de usuarios necesita del notificador (los tests le pasan un doble). */
export type AccessNotifierActions = Pick<AccessNotifier, 'statusChanged' | 'appsChanged'>;
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users/access-emails/
```

Esperado: PASA, los tres ficheros de `access-emails/` en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/users/access-emails/access-notifier.ts apps/hub-api/src/users/access-emails/access-notifier.test.ts
git commit -m "feat(hub-api): notificador de los correos de acceso"
```

---

### Task 4: El router de usuarios avisa después de responder

**Files:**
- Modify: `apps/hub-api/src/users.integration.test.ts` (imports L1-5; nuevo `describe` al final)
- Modify: `apps/hub-api/src/users/users.router.ts` (import tras L9; L27-29; L182-183; L217-220)

Los tests van en `users.integration.test.ts` porque ya monta el router real sobre un `FakeDb` y mockea
`db.js` para que `requireAdmin` funcione. El notificador es un doble; las decisiones las vigila la
Task 3. El router llama al notificador en cada caso candidato y el notificador decide (por ejemplo,
`{active}` sobre una cuenta ya activa llega con `previousStatus: 'active'` y él no envía nada).

- [ ] **Step 1: Escribir el test que falla**

En `apps/hub-api/src/users.integration.test.ts`, sustituir:

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
```

por:

```ts
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AccessNotifierActions } from './users/access-emails/access-notifier.js';
```

Y al final del fichero, sustituir:

```ts
  it('logout sin token → 401', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  });
});
```

por:

```ts
  it('logout sin token → 401', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  });
});

// Correos de acceso (spec 2026-11-20, §4.2). El router avisa al notificador
// DESPUÉS de responder y sin esperarlo; aquí el notificador es un doble. Qué
// decide y qué envía lo vigila users/access-emails/access-notifier.test.ts.
describe('correos de acceso', () => {
  afterEach(() => vi.restoreAllMocks());

  function conNotificador() {
    const notifier = {
      statusChanged: vi.fn<AccessNotifierActions['statusChanged']>(async () => {}),
      appsChanged: vi.fn<AccessNotifierActions['appsChanged']>(async () => {}),
    };
    const conAviso = express();
    conAviso.use(express.json());
    conAviso.use('/api', createUsersRouter(db, { notifier }));
    return { notifier, app: conAviso };
  }

  /** Deja correr lo que el router lanza después de responder. */
  const despues = () => new Promise((r) => setTimeout(r, 20));

  it('aprobar (pending → active): la respuesta no cambia y el notificador recibe previousStatus pending y las apps de ahora', async () => {
    const { notifier, app: conAviso } = conNotificador();
    const p = db.seedUser({ email: 'pedro@ejemplo.test', full_name: 'Pedro Pérez', status: 'pending', role: 'reader' });
    db.apps.push({ user_id: p.id, app_id: 'ausencias' });
    const res = await request(conAviso).patch(`/api/users/${p.id}/status`).set(bearer(adminToken)).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['message', 'user']);
    expect(res.body).toMatchObject({ message: 'status_updated', user: { id: p.id, status: 'active', role: 'reader' } });
    await vi.waitFor(() => expect(notifier.statusChanged).toHaveBeenCalledTimes(1));
    expect(notifier.statusChanged).toHaveBeenCalledWith({
      user: { id: p.id, email: 'pedro@ejemplo.test', fullName: 'Pedro Pérez', status: 'active' },
      previousStatus: 'pending',
      apps: ['ausencias'],
    });
  });

  it('reactivar (inactive → active): previousStatus inactive', async () => {
    const { notifier, app: conAviso } = conNotificador();
    const u = db.seedUser({ email: 'lucia@ejemplo.test', full_name: 'Lucía Gómez', status: 'inactive' });
    const res = await request(conAviso).patch(`/api/users/${u.id}/status`).set(bearer(adminToken)).send({ status: 'active' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(notifier.statusChanged).toHaveBeenCalledTimes(1));
    expect(notifier.statusChanged).toHaveBeenCalledWith({
      user: { id: u.id, email: 'lucia@ejemplo.test', fullName: 'Lucía Gómez', status: 'active' },
      previousStatus: 'inactive',
      apps: [],
    });
  });

  it('{active} sobre una cuenta ya activa: llega con previousStatus active (el notificador no envía nada)', async () => {
    const { notifier, app: conAviso } = conNotificador();
    const u = db.seedUser({ email: 'marta@ejemplo.test', status: 'active' });
    await request(conAviso).patch(`/api/users/${u.id}/status`).set(bearer(adminToken)).send({ status: 'active' });
    await vi.waitFor(() => expect(notifier.statusChanged).toHaveBeenCalledTimes(1));
    expect(notifier.statusChanged.mock.calls[0][0].previousStatus).toBe('active');
  });

  it('desactivar, cambiar el rol y eliminar no llaman al notificador', async () => {
    const { notifier, app: conAviso } = conNotificador();
    const u = db.seedUser({ email: 'marta@ejemplo.test', status: 'active' });
    const v = db.seedUser({ email: 'raul@ejemplo.test', status: 'active' });
    expect((await request(conAviso).patch(`/api/users/${u.id}/status`).set(bearer(adminToken)).send({ status: 'inactive' })).status).toBe(200);
    expect((await request(conAviso).patch(`/api/users/${u.id}/role`).set(bearer(adminToken)).send({ role: 'admin' })).status).toBe(200);
    expect((await request(conAviso).delete(`/api/users/${v.id}`).set(bearer(adminToken))).status).toBe(200);
    await despues();
    expect(notifier.statusChanged).not.toHaveBeenCalled();
    expect(notifier.appsChanged).not.toHaveBeenCalled();
  });

  it('PUT apps: la respuesta no cambia y el notificador recibe before, after e isSelf', async () => {
    const { notifier, app: conAviso } = conNotificador();
    const u = db.seedUser({ email: 'lucia@ejemplo.test', full_name: 'Lucía Gómez', status: 'active' });
    db.apps.push({ user_id: u.id, app_id: 'contabilidad' });
    const res = await request(conAviso).put(`/api/users/${u.id}/apps`).set(bearer(adminToken)).send({ apps: ['contabilidad', 'ausencias'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'apps_updated', apps: ['ausencias', 'contabilidad'] });
    await vi.waitFor(() => expect(notifier.appsChanged).toHaveBeenCalledTimes(1));
    expect(notifier.appsChanged).toHaveBeenCalledWith({
      user: { id: u.id, email: 'lucia@ejemplo.test', fullName: 'Lucía Gómez', status: 'active' },
      before: ['contabilidad'],
      after: ['ausencias', 'contabilidad'],
      isSelf: false,
    });
  });

  it('PUT apps a una cuenta pending: llega con su estado (el notificador no envía nada)', async () => {
    const { notifier, app: conAviso } = conNotificador();
    const u = db.seedUser({ email: 'pedro@ejemplo.test', status: 'pending' });
    await request(conAviso).put(`/api/users/${u.id}/apps`).set(bearer(adminToken)).send({ apps: ['ausencias'] });
    await vi.waitFor(() => expect(notifier.appsChanged).toHaveBeenCalledTimes(1));
    expect(notifier.appsChanged.mock.calls[0][0].user.status).toBe('pending');
  });

  it('PUT apps sobre la propia cuenta del admin: isSelf true', async () => {
    const { notifier, app: conAviso } = conNotificador();
    await request(conAviso).put(`/api/users/${ADMIN_ID}/apps`).set(bearer(adminToken)).send({ apps: ['ausencias'] });
    await vi.waitFor(() => expect(notifier.appsChanged).toHaveBeenCalledTimes(1));
    expect(notifier.appsChanged.mock.calls[0][0].isSelf).toBe(true);
  });

  it('un PUT apps que falla (404) no llama al notificador', async () => {
    const { notifier, app: conAviso } = conNotificador();
    const res = await request(conAviso).put('/api/users/no-existe/apps').set(bearer(adminToken)).send({ apps: ['ausencias'] });
    expect(res.status).toBe(404);
    await despues();
    expect(notifier.appsChanged).not.toHaveBeenCalled();
  });

  it('la respuesta no espera al notificador', async () => {
    const { notifier, app: conAviso } = conNotificador();
    notifier.statusChanged.mockImplementation(() => new Promise<void>(() => {}));
    const p = db.seedUser({ email: 'pedro@ejemplo.test', status: 'pending' });
    const res = await request(conAviso).patch(`/api/users/${p.id}/status`).set(bearer(adminToken)).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('status_updated');
  });

  it('un notificador que rechaza no cambia la respuesta: el fallo queda en el log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { notifier, app: conAviso } = conNotificador();
    notifier.statusChanged.mockRejectedValue(new Error('n8n caído'));
    const p = db.seedUser({ email: 'pedro@ejemplo.test', status: 'pending' });
    const res = await request(conAviso).patch(`/api/users/${p.id}/status`).set(bearer(adminToken)).send({ status: 'active' });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('access_email_status error', expect.any(Error)));
  });

  it('un fallo síncrono del notificador tampoco cambia la respuesta', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { notifier, app: conAviso } = conNotificador();
    notifier.appsChanged.mockImplementation(() => {
      throw new Error('fallo síncrono');
    });
    const u = db.seedUser({ email: 'lucia@ejemplo.test', status: 'active' });
    const res = await request(conAviso).put(`/api/users/${u.id}/apps`).set(bearer(adminToken)).send({ apps: ['ausencias'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'apps_updated', apps: ['ausencias'] });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('access_email_apps error', expect.any(Error)));
  });

  it('sin notificador, aprobar y asignar apps responden igual que siempre', async () => {
    const p = db.seedUser({ email: 'pedro@ejemplo.test', status: 'pending' });
    const aprobar = await request(app).patch(`/api/users/${p.id}/status`).set(bearer(adminToken)).send({ status: 'active' });
    expect(aprobar.status).toBe(200);
    expect(aprobar.body.message).toBe('status_updated');
    const asignar = await request(app).put(`/api/users/${p.id}/apps`).set(bearer(adminToken)).send({ apps: ['ausencias'] });
    expect(asignar.body).toEqual({ message: 'apps_updated', apps: ['ausencias'] });
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users.integration.test.ts
```

Esperado: FALLAN los tests que esperan una llamada al notificador (aprobar, reactivar, `{active}` sobre
activa, los tres de PUT apps que lo esperan, y los dos de fallos, cuyo `console.error` no llega):
`expected "spy" to be called 1 times, but got 0 times`, porque `createUsersRouter` ignora todavía su
segundo argumento. Los demás pasan ya (vigilan que no cambie lo que hoy funciona).

- [ ] **Step 3: Importar el notificador en el router**

En `apps/hub-api/src/users/users.router.ts`, sustituir:

```ts
import type { AuditOperation } from './users.types.js';
```

por:

```ts
import type { AuditOperation } from './users.types.js';
import { toAccessUser, type AccessNotifierActions } from './access-emails/access-notifier.js';
```

- [ ] **Step 4: Recibir el notificador y el ayudante que avisa sin esperar**

En `apps/hub-api/src/users/users.router.ts`, sustituir:

```ts
export function createUsersRouter(pool: Pool): Router {
  const router = Router();
  const service = new UserService(new UserRepository(pool));
```

por:

```ts
/** Lo que el router recibe además del pool. Todo opcional: sin ello, hace lo de siempre. */
export interface UsersRouterDeps {
  /**
   * Correos de acceso (bienvenida, reactivación y apps nuevas). Sin él no se
   * avisa a nadie: así lo montan los tests que no van de esto.
   */
  notifier?: AccessNotifierActions;
}

export function createUsersRouter(pool: Pool, deps: UsersRouterDeps = {}): Router {
  const router = Router();
  const service = new UserService(new UserRepository(pool));

  /**
   * Lanza un correo de acceso DESPUÉS de responder al admin y sin esperarlo: la
   * respuesta no depende de n8n. `Promise.resolve().then(...)` recoge también un
   * fallo síncrono del notificador, igual que en la recuperación de contraseña.
   * Un fallo solo queda en el log y en Sentry.
   */
  const avisar = (endpoint: string, aviso: (notifier: AccessNotifierActions) => Promise<void>): void => {
    const { notifier } = deps;
    if (!notifier) return;
    void Promise.resolve()
      .then(() => aviso(notifier))
      .catch((e: unknown) => {
        console.error(`${endpoint} error`, e);
        captureError(e, { endpoint });
      });
  };
```

- [ ] **Step 5: Avisar al pasar una cuenta a `active`**

En `apps/hub-api/src/users/users.router.ts` (ruta `PATCH /users/:id/status`), sustituir:

```ts
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: user.email, operation });
      res.json({ message: 'status_updated', user });
```

por:

```ts
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: user.email, operation });
      res.json({ message: 'status_updated', user });
      // Correo de acceso: bienvenida si venía de pending, reactivación si venía de
      // inactive (desde active no sale nada: lo decide el notificador). Lleva las
      // apps que la cuenta tiene AHORA, que se leen ya fuera de la respuesta.
      if (status === 'active') {
        const destinatario = toAccessUser(user);
        const previousStatus = current.status;
        avisar('access_email_status', async (notifier) =>
          notifier.statusChanged({ user: destinatario, previousStatus, apps: await service.getUserApps(id) }),
        );
      }
```

- [ ] **Step 6: Avisar al asignar apps**

En `apps/hub-api/src/users/users.router.ts` (ruta `PUT /users/:id/apps`), sustituir:

```ts
      const target = await service.getUser(id); // 404 + email para auditoría
      const apps = await service.setApps(id, (req.body ?? {}).apps);
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: target.email, operation: 'update_apps' });
      res.json({ message: 'apps_updated', apps });
```

por:

```ts
      const target = await service.getUser(id); // 404 + email para auditoría
      // Las de antes, para que el correo sepa cuáles son nuevas. Va antes de
      // guardar, así que sí forma parte de la petición.
      const before = await service.getUserApps(id);
      const apps = await service.setApps(id, (req.body ?? {}).apps);
      AuditLogger.log({ adminEmail: admin.sub, targetEmail: target.email, operation: 'update_apps' });
      res.json({ message: 'apps_updated', apps });
      // Correo de apps nuevas: el notificador decide (cuenta activa, que no sea la
      // del propio admin, y al menos una app conocida que no tuviera).
      const destinatario = toAccessUser(target);
      const isSelf = id === admin.user_id;
      avisar('access_email_apps', (notifier) => notifier.appsChanged({ user: destinatario, before, after: apps, isSelf }));
```

- [ ] **Step 7: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/users.integration.test.ts
```

Esperado: PASA, todos los tests del fichero en verde (los de antes y los de `correos de acceso`).

- [ ] **Step 8: Tipos de todo hub-api (tests incluidos: el build de Docker los compila)**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: sin errores.

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/users/users.router.ts apps/hub-api/src/users.integration.test.ts
git commit -m "feat(hub-api): el router de usuarios avisa por correo al dar acceso"
```

---

### Task 5: `index.ts` — un solo mailer para los dos usos

**Files:**
- Modify: `apps/hub-api/src/users/password-reset/password-reset.router.test.ts` (L240-254)
- Modify: `apps/hub-api/src/index.ts` (import tras L12; montaje L130-145)

El test de montaje de la recuperación de contraseña busca hoy el texto exacto
`app.use('/api', createUsersRouter(getHubPool()));` y `createResetMailer()` dentro del montaje de
`createPasswordResetRouter`. Las dos cosas cambian, así que el test se reescribe en esta misma tarea.

- [ ] **Step 1: Reescribir el test de montaje (falla)**

En `apps/hub-api/src/users/password-reset/password-reset.router.test.ts`, sustituir:

```ts
describe('montaje en index.ts', () => {
  it('se monta en /api justo detras del router de usuarios, con el repositorio, el mailer y la base del portal', () => {
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

por:

```ts
describe('montaje en index.ts', () => {
  it('se monta en /api justo detras del router de usuarios, con el repositorio, el mailer compartido y la base del portal', () => {
    const index = leer('../../index.ts');
    const mailer = index.indexOf('const portalMailer = createResetMailer();');
    const usuarios = index.indexOf("app.use('/api', createUsersRouter(getHubPool(), {");
    const restablecer = index.indexOf("app.use('/api', createPasswordResetRouter(");
    expect(mailer).toBeGreaterThan(-1);
    expect(usuarios).toBeGreaterThan(mailer);
    expect(restablecer).toBeGreaterThan(usuarios);
    // Nada montado entre medias.
    expect(index.slice(usuarios + 1, restablecer)).not.toMatch(/app\.use\(/);
    const montaje = index.slice(restablecer, index.indexOf('})));', restablecer));
    expect(montaje).toMatch(/new PasswordResetRepository\(getHubPool\(\)\)/);
    expect(montaje).toMatch(/mailer: portalMailer,/);
    expect(montaje).toMatch(/portalUrl: urlPortal\(\)/);
  });

  it('un solo mailer en todo el arranque, compartido con los correos de acceso del router de usuarios', () => {
    const index = leer('../../index.ts');
    // Dos clientes avisarían dos veces al arrancar de la configuración que falta.
    expect(index.match(/createResetMailer\(\)/g)).toHaveLength(1);
    const usuarios = index.indexOf("app.use('/api', createUsersRouter(getHubPool(), {");
    const montaje = index.slice(usuarios, index.indexOf('}));', usuarios));
    expect(montaje).toMatch(/notifier: new AccessNotifier\(\{ mailer: portalMailer, portalUrl: urlPortal\(\) \}\)/);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.router.test.ts -t "montaje en index.ts"
```

Esperado: FALLAN los dos: el primero con `expected -1 to be greater than -1` (todavía no hay
`const portalMailer`) y el segundo al no encontrar `notifier: new AccessNotifier(…)`.

- [ ] **Step 3: Importar el notificador**

En `apps/hub-api/src/index.ts`, sustituir:

```ts
import { createResetMailer } from './users/password-reset/password-reset.mailer.js';
```

por:

```ts
import { createResetMailer } from './users/password-reset/password-reset.mailer.js';
import { AccessNotifier } from './users/access-emails/access-notifier.js';
```

- [ ] **Step 4: Un solo mailer, compartido**

En `apps/hub-api/src/index.ts`, sustituir:

```ts
    // Router de gestión de usuarios. Se monta tras initDb (getHubPool ya
    // validado) para no romper el chequeo de arranque de HUB_DB_URL.
    // Montado en '/api' → expone /api/users*, /api/auth/register. El rate limit
    // propio del router corre antes de requireAuth/requireAdmin.
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

por:

```ts
    // UN solo cliente del webhook de n8n («Portal — Correos a usuarios») para
    // los dos que escriben a los usuarios del portal: los correos de acceso
    // (bienvenida, reactivación y apps nuevas, que el router de usuarios lanza
    // después de responder al admin) y la recuperación de contraseña. Uno solo
    // para que el aviso de configuración incompleta salga una vez al arrancar.
    const portalMailer = createResetMailer();
    // Router de gestión de usuarios. Se monta tras initDb (getHubPool ya
    // validado) para no romper el chequeo de arranque de HUB_DB_URL.
    // Montado en '/api' → expone /api/users*, /api/auth/register. El rate limit
    // propio del router corre antes de requireAuth/requireAdmin.
    app.use('/api', createUsersRouter(getHubPool(), {
      notifier: new AccessNotifier({ mailer: portalMailer, portalUrl: urlPortal() }),
    }));
    // Recuperación de contraseña por correo → /api/auth/forgot-password y
    // /api/auth/reset-password. Públicas, como /api/auth/register: cada una con
    // su rate limit por IP, y el global de /api/ encima. El enlace del correo
    // apunta a PORTAL_URL (urlPortal, la misma base que los correos de
    // Ausencias) y el correo sale por el webhook de n8n.
    app.use('/api', createPasswordResetRouter(new PasswordResetService({
      store: new PasswordResetRepository(getHubPool()),
      mailer: portalMailer,
      now: () => new Date(),
      portalUrl: urlPortal(),
    })));
```

- [ ] **Step 5: Ver que pasa, y que los candados de `index.ts` siguen en verde**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.router.test.ts src/trazabilidad/envio-avisos.test.ts src/errores-json.test.ts src/cabeceras-seguridad.test.ts src/ausencias/notas.estatico.test.ts src/trazabilidad/programador-pasadas.test.ts
```

Esperado: PASA.

- [ ] **Step 6: Tipos de todo hub-api**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/index.ts apps/hub-api/src/users/password-reset/password-reset.router.test.ts
git commit -m "feat(hub-api): un solo mailer para la recuperacion y los correos de acceso"
```

---

### Task 6: Portal — a dónde se vuelve tras iniciar sesión (función pura)

**Files:**
- Create: `apps/portal/src/components/Auth/destinoTrasLogin.test.ts`
- Create: `apps/portal/src/components/Auth/destinoTrasLogin.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/portal/src/components/Auth/destinoTrasLogin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { destinoTrasLogin } from './destinoTrasLogin';

// A dónde se vuelve tras iniciar sesión (spec 2026-11-20, §5.2): a la ruta
// protegida de la que se llegó, solo si es interna; si no, al inicio.

describe('destinoTrasLogin', () => {
  it.each(['/contabilidad', '/ausencias/solicitudes', '/'])('una ruta interna (%s) se respeta', (from) => {
    expect(destinoTrasLogin({ from })).toBe(from);
  });

  it.each([
    ['sin state', undefined],
    ['con state null', null],
    ['sin from', {}],
    ['con un from que no es texto', { from: 42 }],
    ['con un from vacío', { from: '' }],
    ['relativa al protocolo (//)', { from: '//evil.test' }],
    ['absoluta', { from: 'https://evil.test/' }],
    ['con barra invertida', { from: '/\\evil.test' }],
    ['javascript:', { from: 'javascript:alert(1)' }],
    ['sin barra inicial', { from: 'contabilidad' }],
    ['con un tabulador que el navegador quitaría', { from: '/\t/evil.test' }],
  ])('%s → al inicio', (_caso, state) => {
    expect(destinoTrasLogin(state)).toBe('/');
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/portal && npx vitest run src/components/Auth/destinoTrasLogin.test.ts
```

Esperado: FALLA al cargar, porque `./destinoTrasLogin` no existe.

- [ ] **Step 3: Implementar**

Crear `apps/portal/src/components/Auth/destinoTrasLogin.ts`:

```ts
/**
 * A dónde se vuelve tras iniciar sesión (spec 2026-11-20, §5.2).
 *
 * `state.from` lo dejan RequireAuth y RequireAdmin al mandar a /auth a quien
 * llega sin sesión, por ejemplo desde el enlace a una app de un correo de
 * acceso. Solo vale una ruta INTERNA del portal: empieza por «/», no sigue otra
 * «/» ni «\» (el navegador lee «//otra.web» y «/\otra.web» como otra web) y no
 * lleva espacios en blanco (el navegador quita tabuladores y saltos de línea de
 * las URL, y «/<tab>/otra.web» acabaría siendo «//otra.web»). Cualquier otra
 * cosa lleva al inicio: sin redirecciones abiertas.
 */
export function destinoTrasLogin(state: unknown): string {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  if (typeof from !== 'string') return '/';
  if (!/^\/(?![/\\])/.test(from) || /[\\\s]/.test(from)) return '/';
  return from;
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/portal && npx vitest run src/components/Auth/destinoTrasLogin.test.ts
```

Esperado: PASA, todos los tests del fichero en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/portal/src/components/Auth/destinoTrasLogin.ts apps/portal/src/components/Auth/destinoTrasLogin.test.ts
git commit -m "feat(portal): destino seguro tras iniciar sesion"
```

---

### Task 7: Portal — `/auth` abre en «Iniciar sesión» con `?modo=login` o desde una ruta protegida

**Files:**
- Modify: `apps/portal/src/components/Auth/AuthCard.test.tsx` (fichero entero, 45 líneas)
- Modify: `apps/portal/src/components/Auth/AuthCard.tsx` (fichero entero, 31 líneas)

El test actual `el \`from\` que deja RequireAuth no cambia nada` (L26-29) fija justo lo contrario de lo
que pide el spec (§5.1): se sustituye por su versión nueva.

- [ ] **Step 1: Reescribir el test (falla)**

Sustituir el contenido entero de `apps/portal/src/components/Auth/AuthCard.test.tsx` por:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCard from './AuthCard';

// Con qué se abre /auth: manda `location.state.modo` de quien navega hasta aquí;
// si no, «Iniciar sesión» con `?modo=login` (el botón de los correos de acceso)
// o con el `from` que dejan RequireAuth y RequireAdmin. Sin nada de eso, el
// registro.

afterEach(() => cleanup());

function abrirCon(state?: unknown, search = '') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/auth', search, state }]}>
      <AuthCard />
    </MemoryRouter>,
  );
}

const enRegistro = () => expect(screen.getByText('Crea tu cuenta')).toBeTruthy();
const enLogin = () => expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();

describe('AuthCard — con qué se abre', () => {
  it('sin indicación, en el registro (como hasta ahora)', () => {
    abrirCon();
    enRegistro();
  });

  it('con ?modo=login en la URL (el botón «Entrar al portal» de los correos), en iniciar sesión', () => {
    abrirCon(undefined, '?modo=login');
    enLogin();
  });

  it('un ?modo con otro valor no cambia nada', () => {
    abrirCon(undefined, '?modo=registro');
    enRegistro();
  });

  it('con el `from` que dejan RequireAuth y RequireAdmin, en iniciar sesión: quien viene de una ruta protegida ya tiene cuenta', () => {
    abrirCon({ from: '/contabilidad' });
    enLogin();
  });

  it('un `from` que no es texto no cuenta', () => {
    abrirCon({ from: 42 });
    enRegistro();
  });

  it('con modo login, en iniciar sesión', () => {
    abrirCon({ modo: 'login' });
    enLogin();
  });

  it('con modo olvido, directamente en «¿Olvidaste tu contraseña?»', () => {
    abrirCon({ modo: 'olvido' });
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('state.modo manda: olvido gana a ?modo=login y al from', () => {
    abrirCon({ modo: 'olvido', from: '/contabilidad' }, '?modo=login');
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('un modo desconocido o basura cae al registro sin romper', () => {
    abrirCon({ modo: 'cualquier-cosa' });
    enRegistro();
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/portal && npx vitest run src/components/Auth/AuthCard.test.tsx
```

Esperado: FALLAN `con ?modo=login en la URL…` y `con el \`from\` que dejan RequireAuth y RequireAdmin…`
(`Unable to find an element with the text: Bienvenido de vuelta`); los demás pasan.

- [ ] **Step 3: Leer `?modo=login` y `state.from` en `AuthCard`**

Sustituir el contenido entero de `apps/portal/src/components/Auth/AuthCard.tsx` por:

```tsx
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import AuthLeftPanel from './AuthLeftPanel';
import AuthRightPanel from './AuthRightPanel';
import type { ModoAuth } from './recuperacion';

export default function AuthCard() {
  // Con qué se abre /auth, por este orden:
  //  1. `location.state.modo`, de quien navega hasta aquí desde otra pantalla:
  //     «login» tras restablecer la contraseña y «olvido» desde un enlace no
  //     válido. Manda sobre lo demás.
  //  2. «Iniciar sesión» si la URL trae `?modo=login` (el botón «Entrar al
  //     portal» de los correos de acceso) o si se llega echado de una ruta
  //     protegida (`state.from`, que ponen RequireAuth y RequireAdmin): quien
  //     viene de ahí ya tiene cuenta.
  //  3. Si no, el registro, como siempre.
  const location = useLocation();
  const state = location.state as { modo?: ModoAuth; from?: unknown } | null;
  const modo = state?.modo;
  const abreEnLogin =
    modo === 'login' ||
    modo === 'olvido' ||
    new URLSearchParams(location.search).get('modo') === 'login' ||
    typeof state?.from === 'string';
  const [isSignUp, setIsSignUp] = useState(!abreEnLogin);

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
git commit -m "feat(portal): /auth abre en iniciar sesion con ?modo=login o desde una ruta protegida"
```

---

### Task 8: Portal — tras iniciar sesión se vuelve a la ruta pedida

**Files:**
- Modify: `apps/portal/src/components/Auth/AuthRightPanel.test.tsx` (imports L4-10; nuevo `describe` al
  final)
- Modify: `apps/portal/src/components/Auth/AuthRightPanel.tsx` (L2, L6, L25, L144)

- [ ] **Step 1: Escribir el test que falla**

En `apps/portal/src/components/Auth/AuthRightPanel.test.tsx`, sustituir:

```tsx
import { MemoryRouter } from 'react-router-dom';
import AuthRightPanel from './AuthRightPanel';
```

por:

```tsx
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AuthRightPanel from './AuthRightPanel';
```

Sustituir:

```tsx
import { notify } from '../../lib/notify';
```

por:

```tsx
import { notify } from '../../lib/notify';
import { setToken } from '../../auth';
```

Y al final del fichero, sustituir:

```tsx
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

por:

```tsx
  it('con olvidoInicial se abre directamente en el modo «olvidé»', () => {
    render(
      <MemoryRouter>
        <AuthRightPanel isSignUp={false} onToggle={() => {}} olvidoInicial />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });
});

// Tras iniciar sesión (spec 2026-11-20, §5.2): se vuelve a la ruta protegida de
// la que se llegó (`state.from`), solo si es interna; si no, al inicio.
describe('AuthRightPanel — a dónde se vuelve tras iniciar sesión', () => {
  /** Lo que se pinta fuera de /auth: la ruta a la que se navegó. */
  function Destino() {
    const { pathname } = useLocation();
    return <p data-testid="destino">{pathname}</p>;
  }

  function entrarDesde(state: unknown) {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ token: 'token-ficticio' }) } as unknown as Response);
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/auth', state }]}>
        <Routes>
          <Route path="/auth" element={<AuthRightPanel isSignUp={false} onToggle={() => {}} />} />
          <Route path="*" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@ejemplo.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-ficticia-1' } });
    fireEvent.submit(container.querySelector('form')!);
  }

  it('vuelve a la ruta protegida de la que se llegó', async () => {
    entrarDesde({ from: '/contabilidad' });
    expect((await screen.findByTestId('destino')).textContent).toBe('/contabilidad');
    expect(setToken).toHaveBeenCalledWith('token-ficticio');
  });

  it.each([
    ['sin `from`', undefined],
    ['con un `from` a otra web (//)', { from: '//evil.test' }],
    ['con un `from` absoluto', { from: 'https://evil.test/' }],
  ])('%s, al inicio', async (_caso, state) => {
    entrarDesde(state);
    expect((await screen.findByTestId('destino')).textContent).toBe('/');
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/portal && npx vitest run src/components/Auth/AuthRightPanel.test.tsx
```

Esperado: FALLA `vuelve a la ruta protegida de la que se llegó` (`expected '/' to be '/contabilidad'`:
hoy siempre navega a `/`). Los tres casos «al inicio» pasan ya.

- [ ] **Step 3: Navegar a `destinoTrasLogin(location.state)`**

En `apps/portal/src/components/Auth/AuthRightPanel.tsx`, sustituir:

```tsx
import { useNavigate } from 'react-router-dom';
```

por:

```tsx
import { useLocation, useNavigate } from 'react-router-dom';
```

Sustituir:

```tsx
import OlvidoContrasena from './OlvidoContrasena';
```

por:

```tsx
import OlvidoContrasena from './OlvidoContrasena';
import { destinoTrasLogin } from './destinoTrasLogin';
```

Sustituir:

```tsx
  const navigate = useNavigate();
```

por:

```tsx
  const navigate = useNavigate();
  // `state.from` lo dejan RequireAuth y RequireAdmin al mandar aquí a quien no
  // tenía sesión: tras entrar se vuelve a esa ruta (p. ej. el enlace a una app
  // de un correo de acceso), solo si es interna (destinoTrasLogin).
  const location = useLocation();
```

Sustituir:

```tsx
      navigate('/');
```

por:

```tsx
      navigate(destinoTrasLogin(location.state));
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/portal && npx vitest run src/components/Auth/
```

Esperado: PASA, todos los ficheros de `src/components/Auth/` en verde.

- [ ] **Step 5: Tipos y lint de lo tocado**

```bash
cd apps/portal && npx tsc -b
cd apps/portal && npx eslint src/components/Auth
```

Esperado: sin errores de tipos ni de lint.

- [ ] **Step 6: Commit**

```bash
git add apps/portal/src/components/Auth/AuthRightPanel.tsx apps/portal/src/components/Auth/AuthRightPanel.test.tsx
git commit -m "feat(portal): tras iniciar sesion se vuelve a la ruta pedida"
```

---

### Task 9: n8n — el flujo se renombra; documentación y textos del mailer

**Files:**
- Modify: `docs/n8n-automatizaciones.md` (§2.4, L226-260)
- Modify: `apps/hub-api/src/users/password-reset/password-reset.mailer.ts` (solo texto: L5-7 y L60)
- Fuera del repo: el flujo `0jYHqM3Z2mHZNFOC` de n8n.

Los pasos 1 a 4 los ejecuta quien coordina el plan, con el MCP de n8n (un subagente sin ese MCP no
puede). Antes de cualquier llamada al MCP, cargar la skill `n8n-mcp-skills:using-n8n-mcp-skills`. No se
lanza ninguna ejecución de prueba del flujo (enviaría un correo). No se tocan el webhook, la
credencial, los nodos ni las variables `PASSWORD_RESET_N8N_*`.

- [ ] **Step 1: Leer el flujo**

`n8n_get_workflow` con `id: "0jYHqM3Z2mHZNFOC"`. Comprobar: nombre «Portal — Restablecer contraseña»,
`active: true`, nodos Webhook (ruta `portal-restablecer-contrasena`), Gmail y Respond to Webhook, y
apuntar el nombre del nodo de tipo `n8n-nodes-base.stickyNote` si existe. No copiar al chat nada de
las credenciales.

- [ ] **Step 2: Renombrar el flujo y reescribir su nota**

Texto nuevo de la nota (va tal cual en `parameters.content`, con sus saltos de línea):

```markdown
## Portal — Correos a usuarios

Un correo por llamada desde hub-api: POST JSON {para, asunto, cuerpo} con la cabecera X-Password-Reset-Token.

Lo usan:
- la recuperación de contraseña: el enlace para restablecerla y el aviso de que cambió;
- los correos de acceso: bienvenida al aprobar una cuenta, reactivación y apps nuevas, desde el panel de usuarios.

En hub-api, PASSWORD_RESET_N8N_URL y PASSWORD_RESET_N8N_TOKEN. Los nombres (variables, cabecera, ruta del webhook, credencial) son de cuando el flujo solo restablecía contraseñas; sirven para los dos usos.

No guarda las ejecuciones correctas. Probar SIEMPRE con un buzón propio.
Documentación: docs/n8n-automatizaciones.md §2.4
```

Si el flujo tiene nota, `n8n_update_partial_workflow` con:

```json
{
  "id": "0jYHqM3Z2mHZNFOC",
  "operations": [
    { "type": "updateName", "name": "Portal — Correos a usuarios" },
    { "type": "updateNode", "nodeName": "<el nombre de la nota apuntado en el Step 1>", "updates": { "parameters.content": "<el texto de arriba>" } }
  ]
}
```

Si no tiene nota, la segunda operación es, en su lugar:

```json
{
  "type": "addNode",
  "node": {
    "name": "Nota",
    "type": "n8n-nodes-base.stickyNote",
    "typeVersion": 1,
    "position": [-60, -260],
    "parameters": { "content": "<el texto de arriba>", "width": 520, "height": 300 }
  }
}
```

- [ ] **Step 3: Comprobarlo**

`n8n_get_workflow` otra vez: nombre «Portal — Correos a usuarios», la nota con el texto nuevo, los tres
nodos y la ruta del webhook sin cambios, y `active: true`. Si quedara inactivo, pedir al usuario que lo
active desde la interfaz de n8n (sin tocar las credenciales).

- [ ] **Step 4: Avisar al usuario de que el flujo está renombrado**

Una línea: el flujo se llama ahora «Portal — Correos a usuarios»; webhook, credencial y variables no
cambian.

- [ ] **Step 5: Reescribir la §2.4 de la documentación**

En `docs/n8n-automatizaciones.md`, sustituir:

````markdown
### 2.4 Recuperación de contraseña del portal (webhook síncrono, sin barrera)

Los correos de «¿Olvidaste tu contraseña?» (2026-11-13) siguen la forma de 2.3, más simple: hub-api
llama al Webhook al momento y espera 10 s como mucho, pero la persona no espera a n8n (hub-api ya le ha
respondido) y nadie reintenta: si falla, vuelve a pedir el enlace.

| Workflow | Forma |
|---|---|
| **Portal — Restablecer contraseña** (id `0jYHqM3Z2mHZNFOC`) | Webhook síncrono (`POST /webhook/portal-restablecer-contrasena`): un correo por llamada |
````

por:

````markdown
### 2.4 Correos del portal a sus usuarios (webhook síncrono, sin barrera)

Un solo flujo envía los correos que el portal manda a sus propios usuarios:

- **Recuperación de contraseña** (2026-11-13): el enlace de «¿Olvidaste tu contraseña?» y el aviso de
  que la contraseña cambió.
- **Correos de acceso** (2026-11-20): bienvenida al aprobar una cuenta, reactivación y apps nuevas,
  cuando un administrador actúa en el panel de usuarios.

Sigue la forma de 2.3, más simple: hub-api llama al Webhook al momento y espera 10 s como mucho, pero
nadie espera a n8n (hub-api ya ha respondido a la persona o al administrador) y nadie reintenta.

| Workflow | Forma |
|---|---|
| **Portal — Correos a usuarios** (id `0jYHqM3Z2mHZNFOC`; hasta el 2026-11-20, «Portal — Restablecer contraseña») | Webhook síncrono (`POST /webhook/portal-restablecer-contrasena`): un correo por llamada |
````

Y sustituir:

```markdown
- Lo llama `apps/hub-api/src/users/password-reset/password-reset.mailer.ts`. Cualquier respuesta que no
  sea 2xx, o 10 s sin respuesta, deja en el log de hub-api `password_reset_envio_fallido`; sin
  `PASSWORD_RESET_N8N_URL` o `PASSWORD_RESET_N8N_TOKEN`, `password_reset_sin_configurar` y no sale nada.
```

por:

```markdown
- Lo llama `apps/hub-api/src/users/password-reset/password-reset.mailer.ts`: **un solo** cliente,
  creado en `apps/hub-api/src/index.ts` y compartido por la recuperación de contraseña y por
  `apps/hub-api/src/users/access-emails/access-notifier.ts`. Cualquier respuesta que no sea 2xx, o 10 s
  sin respuesta, deja en el log de hub-api `password_reset_envio_fallido`; sin `PASSWORD_RESET_N8N_URL`
  o `PASSWORD_RESET_N8N_TOKEN`, `password_reset_sin_configurar` y no sale nada.
- **Nombres históricos:** las variables `PASSWORD_RESET_N8N_*`, la cabecera `X-Password-Reset-Token`, la
  ruta `portal-restablecer-contrasena`, la credencial «Token restablecer contraseña» y los eventos
  `password_reset_envio_fallido` y `password_reset_sin_configurar` conservan el nombre de cuando el
  flujo solo restablecía contraseñas. Sirven para los dos usos; cambiarlos obligaría a tocar EasyPanel y
  n8n a la vez sin ganar nada.
- Los correos de acceso dejan además su propia línea, siempre con `user_id` y nunca con el correo:
  `user_access_email_sent` (con `kind`: `welcome`, `reactivated` o `new_apps`),
  `user_access_email_skipped` (con `reason`: `not_active`, `self`, `no_new_apps`, `no_known_apps` o
  `no_transition`) o `user_access_email_failed`. `sent` significa «entregado al cliente del webhook»:
  si n8n falla, la línea de justo antes es `password_reset_envio_fallido`.
```

Y sustituir:

```markdown
- Sin barrera de dominio: el destinatario es siempre el correo de la propia cuenta, que hub-api lee de
  `portal.users`, nunca del cuerpo de la petición del navegador.
```

por:

```markdown
- Sin barrera de dominio: el destinatario es siempre el correo de la cuenta afectada, que hub-api lee de
  `portal.users`, nunca del cuerpo de la petición del navegador.
```

El diagrama y el resto de viñetas de la §2.4 se quedan como están.

- [ ] **Step 6: Los textos del mailer (sin comportamiento nuevo)**

Solo cambia texto: el comentario de cabecera y el mensaje del aviso de arranque. El test del mailer
vigila el código del evento (`password_reset_sin_configurar_al_arrancar`), que no cambia.

En `apps/hub-api/src/users/password-reset/password-reset.mailer.ts`, sustituir:

```ts
 * Cliente del webhook de n8n que envía los correos de la recuperación de
 * contraseña (flujo «Portal — Restablecer contraseña»: Webhook con Header Auth
 * → Gmail → Respond 200). Mismo patrón que el canal de avisos de Trazabilidad:
```

por:

```ts
 * Cliente del webhook de n8n que envía los correos del portal a sus usuarios
 * (flujo «Portal — Correos a usuarios»: Webhook con Header Auth → Gmail →
 * Respond 200): los de la recuperación de contraseña y los de acceso
 * (access-emails/). index.ts crea uno solo y los dos lo comparten. Los nombres
 * (variables, cabecera, eventos) son de cuando solo restablecía contraseñas y
 * se quedan así. Mismo patrón que el canal de avisos de Trazabilidad:
```

Y sustituir:

```ts
      'WARNING: password_reset_sin_configurar_al_arrancar — falta PASSWORD_RESET_N8N_URL o PASSWORD_RESET_N8N_TOKEN; no saldrá ningún correo de restablecer contraseña.',
```

por:

```ts
      'WARNING: password_reset_sin_configurar_al_arrancar — falta PASSWORD_RESET_N8N_URL o PASSWORD_RESET_N8N_TOKEN; no saldrá ningún correo a los usuarios del portal (ni de restablecer contraseña ni de acceso).',
```

- [ ] **Step 7: Ver que el mailer y el candado de Trazabilidad siguen en verde**

```bash
cd apps/hub-api && npx vitest run src/users/password-reset/password-reset.mailer.test.ts src/trazabilidad/envio-avisos.test.ts
```

Esperado: PASA.

- [ ] **Step 8: Commit**

```bash
git add docs/n8n-automatizaciones.md apps/hub-api/src/users/password-reset/password-reset.mailer.ts
git commit -m "docs: el flujo de correos del portal sirve tambien a los correos de acceso"
```

---

### Task 10: Verificación completa

**Files:** ninguno.

- [ ] **Step 1: hub-api, unitarios con cobertura**

```bash
cd apps/hub-api && npm test
```

Esperado: todo en verde y los umbrales de cobertura cumplidos (`users.router.ts` está dentro del de
`src/users/`). Fallos conocidos que no son de este trabajo: `scripts/equipos-anonimizar.test.mjs` en
Windows, y `4.4 — registrar un email ya existente lanza 409…`, que hay que relanzar aislado
(`npx vitest run src/users/users.service.test.ts`) antes de darlo por fallo.

- [ ] **Step 2: hub-api, tipos (el build de Docker compila también los tests)**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: sin errores. No hace falta `npm run test:db`: no cambia ningún SQL.

- [ ] **Step 3: portal, tests, tipos y lint de lo tocado**

```bash
cd apps/portal && npx vitest run
cd apps/portal && npx tsc -b
cd apps/portal && npx eslint src/components/Auth
```

Esperado: todo en verde, sin errores de tipos ni de lint.

- [ ] **Step 4: Revisión de privacidad del diff (repo público), en un comando aparte**

```bash
git diff main...HEAD | grep -noE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" | sort -u
```

Esperado: solo direcciones ficticias (`@ejemplo.test`, y las `@x.com` que ya había en
`users.integration.test.ts` y salen como contexto del diff). Ningún correo real, token ni URL con
credenciales.

---

### Task 11: Integrar en `main` y desplegar

**Files:** ninguno del código.

- [ ] **Step 1: Merge a `main` (desde la copia principal, no desde la worktree)**

En la raíz de la copia principal (`antigravity-suite-R1.07`, en `main`; el `.gitignore` modificado y
los ficheros sin seguimiento del usuario se quedan como están):

```bash
git merge --no-ff feat/correos-de-acceso -m "merge: correos de acceso"
```

- [ ] **Step 2: Revisión de privacidad, en un comando aparte, antes de empujar**

```bash
git diff origin/main..main | grep -noE "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" | sort -u
```

Esperado: las mismas direcciones ficticias de la Task 10.

- [ ] **Step 3: Empujar**

```bash
git push origin main
```

Empujar no despliega: el despliegue lo hace el usuario a mano en EasyPanel.

- [ ] **Step 4: Retirar la worktree y la rama**

```bash
git worktree remove ../antigravity-suite-R1.07-worktrees/correos-de-acceso
git branch -d feat/correos-de-acceso
```

Si `git worktree remove` se niega por ficheros sin seguimiento, listarlos con
`git -C ../antigravity-suite-R1.07-worktrees/correos-de-acceso status --short` y usar `--force` solo si
son `.codegraph/` o restos de instalación; si hay otra cosa, preguntar al usuario.

OneDrive puede dejar la carpeta en disco aunque git ya la haya soltado. Comprobar qué queda:

```bash
ls -la ../antigravity-suite-R1.07-worktrees/correos-de-acceso
```

Si solo quedan restos (`node_modules/`, `.codegraph/`, carpetas vacías), borrarla y podar:

```bash
rm -rf ../antigravity-suite-R1.07-worktrees/correos-de-acceso
git worktree prune
```

Si queda cualquier otra cosa, preguntar al usuario antes de borrar.

- [ ] **Step 5: Despliegue — lo hace el usuario (spec §9)**

Quien ejecuta el plan no despliega; deja al usuario esta lista:

- [ ] El flujo de n8n se llama «Portal — Correos a usuarios» y sigue activo (Task 9). No hay variables
  nuevas en EasyPanel.
- [ ] Desplegar **hub-api** y el **portal**, en cualquier orden. Mientras solo esté desplegado hub-api,
  el botón «Entrar al portal» abre `/auth` en el registro (el portal viejo no lee `?modo=login`): basta
  con pulsar «Iniciar sesión».
- [ ] Prueba en producción con una cuenta de prueba propia del usuario, con un buzón suyo (nunca la
  cuenta de otra persona):
  1. Registrar la cuenta de prueba en `/auth` y aprobarla desde el panel de usuarios → llega
     «Bienvenido al Portal Ambientalia» con «Todavía no tienes aplicaciones asignadas; te avisaremos
     cuando te den acceso a alguna.». El botón «Entrar al portal» abre `/auth` en «Iniciar sesión».
  2. Asignarle una app → llega «Ya tienes acceso a {app} en el Portal Ambientalia». Con la sesión
     cerrada, el enlace de la app pide iniciar sesión (ya en esa pestaña) y, al entrar, lleva a la app.
  3. Asignarle dos apps más a la vez → llega «Tienes acceso a nuevas aplicaciones del Portal
     Ambientalia» con solo esas dos.
  4. Quitarle una app, y después guardar la misma lista sin cambios → no llega nada.
  5. Desactivarla → no llega nada. Reactivarla → llega «Tu acceso al Portal Ambientalia está activo de
     nuevo» con las apps que tiene en ese momento.
  6. En el log de hub-api: `user_access_email_sent` (con `kind` `welcome`, `new_apps` y `reactivated`) y
     `user_access_email_skipped` (con `reason` `no_new_apps`), siempre con `user_id` y sin ningún
     correo; ningún `password_reset_envio_fallido`. En n8n, ninguna ejecución correcta guardada.
  7. Si la cuenta de prueba ya no hace falta, eliminarla desde el panel de usuarios.
