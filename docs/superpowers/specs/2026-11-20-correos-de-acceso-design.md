# Portal — correos de acceso: bienvenida, reactivación y apps nuevas

**Fecha:** 2026-11-20
**Estado:** diseño aprobado en brainstorming; pendiente de plan.
**Depende de:** la gestión de usuarios (`apps/hub-api/src/users/users.router.ts`,
`users.service.ts`), el envío por n8n de la recuperación de contraseña
(`apps/hub-api/src/users/password-reset/password-reset.mailer.ts` y
`password-reset.emails.ts`, spec `2026-11-13-recuperacion-contrasena-design.md`) y el catálogo de
apps del portal (`apps/portal/src/lib/apps.ts`).

## 1. Objetivo

Que la persona se entere por correo, en el momento, de que un administrador le ha dado acceso al
portal o a una aplicación, con los enlaces para entrar.

Hoy no recibe nada: se aprueba la cuenta o se le asignan apps y solo lo sabe si alguien se lo dice.

## 2. Decisiones (cerradas en brainstorming)

- **Tres disparadores:** aprobar la cuenta, reactivarla y asignarle apps nuevas.
- **Dos correos, no uno combinado:** aprobar y asignar apps justo después produce dos correos, cada
  uno de lo suyo. El panel de administración no cambia.
- **Envío:** el mismo cliente del webhook y el mismo flujo de n8n que la recuperación de contraseña
  (opción A). Sin variables ni credenciales nuevas; el flujo se renombra en n8n.
- **Catálogo en hub-api:** una copia del catálogo del portal con un test candado que compara ambas
  listas (opción A). Un paquete compartido obligaría a tocar el Dockerfile de hub-api, que deja fuera
  `packages/*` a propósito.

## 3. Reglas

| Acción del admin (ruta) | Correo | Condición |
|---|---|---|
| `PATCH /api/users/:id/status {active}` con estado anterior `pending` | Bienvenida | Siempre |
| `PATCH /api/users/:id/status {active}` con estado anterior `inactive` | Reactivación | Siempre |
| `PUT /api/users/:id/apps` | Apps nuevas | Gana al menos una app conocida **y** la cuenta está `active` |

- **Apps nuevas** = apps de después que no estaban antes. Quitar apps o guardar la misma lista no
  avisa.
- Asignar apps a una cuenta `pending` o `inactive` no avisa: esa persona no puede entrar. La
  bienvenida y la reactivación **listan las apps que la cuenta tiene en ese momento**, así que se
  entera al recibir cualquiera de las dos.
- `{active}` sobre una cuenta que **ya estaba** `active` no avisa (hoy el router la trata como
  reactivación; el correo exige que el estado anterior sea `inactive`).
- El admin que se asigna apps a sí mismo no recibe correo.
- Desactivar, cambiar el rol y eliminar no avisan.
- Un id que no está en el catálogo se omite del correo. Si ninguna app nueva es conocida, no sale
  correo.
- El aviso nunca bloquea ni cambia la respuesta al admin: sale después de guardar, sin esperar a n8n,
  y un fallo solo queda en el log.
- Las aprobaciones que hace Calibraciones (`calibraciones/router.ts`, `calibraciones/seed.ts`) no
  avisan: el aviso cuelga de las rutas del admin, no de `UserService.approve`.

## 4. hub-api

Módulo nuevo `apps/hub-api/src/users/access-emails/`:

| Pieza | Responsabilidad |
|---|---|
| `app-catalog.ts` | `ACCESS_APPS`: id → `{ label, route }`, copia de `apps/portal/src/lib/apps.ts` |
| `app-catalog.test.ts` | Candado: lee `apps/portal/src/lib/apps.ts` y falla si ids, nombres o rutas no coinciden |
| `access-emails.ts` | Funciones puras: `buildWelcomeEmail`, `buildReactivatedEmail`, `buildNewAppsEmail` → `{ asunto, cuerpo }` |
| `access-notifier.ts` | `AccessNotifier`: aplica las reglas del §3, arma el correo y lo envía; nunca lanza |

### 4.1 `AccessNotifier`

Dependencias inyectadas: el mailer (puerto `ResetMailer` de `password-reset.service.ts`, que el
mailer real implementa y nunca rechaza), `portalUrl` (`urlPortal()`), una función de log.

- `statusChanged({ user, previousStatus, apps })` → bienvenida si `previousStatus === 'pending'`,
  reactivación si `'inactive'`, nada en otro caso.
- `appsChanged({ user, before, after, isSelf })` → correo de apps nuevas según el §3.
- Cada método termina siempre en una línea de log: `user_access_email_sent` (con `kind`),
  `user_access_email_skipped` (con `reason`: `not_active`, `self`, `no_new_apps`,
  `no_known_apps`, `no_transition`) o `user_access_email_failed`. Siempre con `user_id`, nunca con el
  correo.

### 4.2 Router y montaje

- `createUsersRouter(pool, deps?)`: `deps.notifier` opcional para no romper los tests existentes;
  sin él no se avisa.
- `PATCH /users/:id/status`: ya lee `current` antes de cambiar; tras el éxito, si el estado nuevo es
  `active`, llama a `notifier.statusChanged` con `previousStatus = current.status` y las apps
  actuales de la cuenta.
- `PUT /users/:id/apps`: lee las apps de antes (`service.getUserApps`) antes de `setApps`; tras el
  éxito llama a `notifier.appsChanged` con `isSelf = id === admin.user_id` y el estado de la cuenta.
- Las llamadas van detrás de `Promise.resolve().then(...)` con `.catch` a log + `captureError`, igual
  que en la recuperación de contraseña: la respuesta al admin sale antes y no depende del correo.
- `index.ts` crea **un solo** `createResetMailer()` y lo pasa a la recuperación de contraseña y al
  `AccessNotifier`.

### 4.3 Contenido

HTML sencillo, con el nombre escapado (`escapeHtml` de `password-reset.emails.ts`) y sin ningún correo
de contacto concreto (repo público).

- **Bienvenida** — asunto «Bienvenido al Portal Ambientalia». «Hola, {nombre}: tu cuenta del Portal
  Ambientalia ya está activa.» Botón «Entrar al portal». Lista de sus apps con enlace o, si no tiene,
  «Todavía no tienes aplicaciones asignadas; te avisaremos cuando te den acceso a alguna.» Cierre: «Si
  olvidas tu contraseña, usa “¿Olvidaste tu contraseña?” en la pantalla de acceso.»
- **Reactivación** — asunto «Tu acceso al Portal Ambientalia está activo de nuevo». Mismo esquema.
- **Apps nuevas** — asunto con una app «Ya tienes acceso a {app} en el Portal Ambientalia»; con varias
  «Tienes acceso a nuevas aplicaciones del Portal Ambientalia». Lista solo de las nuevas y botón
  «Entrar al portal».
- **Enlaces:** el botón apunta a `${PORTAL_URL}/auth?modo=login`; cada app a `${PORTAL_URL}{route}`.

## 5. Portal

Dos arreglos para que los enlaces del correo lleven a donde dicen:

1. **`AuthCard` abre en «Iniciar sesión»** con `?modo=login` en la URL o cuando se llega redirigido
   desde una ruta protegida (`location.state.from`, que ya ponen `RequireAuth` y `RequireAdmin`). Hoy
   `/auth` abre en registro. `location.state.modo` (de la recuperación de contraseña) sigue mandando
   sobre lo demás.
2. **Tras iniciar sesión se vuelve a la ruta pedida** (`location.state.from`) en vez de a `/`, solo
   si es interna: empieza por `/` y no por `//`. Cualquier otra cosa lleva a `/` (sin redirecciones
   abiertas).

## 6. n8n

Renombrar «Portal — Restablecer contraseña» (`0jYHqM3Z2mHZNFOC`) a **«Portal — Correos a usuarios»** y
actualizar su nota: ahora lo usan la recuperación de contraseña y los correos de acceso. El webhook,
la credencial y las variables `PASSWORD_RESET_N8N_*` no cambian (el nombre de las variables queda
histórico; se documenta en `docs/n8n-automatizaciones.md` §2.4).

## 7. Pruebas (TDD estricto)

- **`AccessNotifier`** (mailer falso): bienvenida desde `pending`, reactivación desde `inactive`, nada
  desde `active`; apps nuevas con cuenta activa; nada al quitar apps, con la misma lista, con cuenta
  no activa, en la propia cuenta o con solo ids desconocidos; un fallo del mailer no se propaga; cada
  caso deja su línea de log sin el correo.
- **Correos** (puras): asuntos, singular y plural, enlaces (`/auth?modo=login` y rutas de app), lista
  vacía, nombre escapado.
- **Catálogo:** el candado contra `apps/portal/src/lib/apps.ts`.
- **Router** (supertest): la respuesta al admin no cambia; el notificador recibe `previousStatus`,
  `before`, `after` e `isSelf` correctos; un notificador que falla no afecta a la respuesta; sin
  notificador no pasa nada.
- **Portal:** `AuthCard` abre en login con `?modo=login` y con `state.from`; `state.modo` sigue
  mandando; tras el login se navega a `state.from` interno y a `/` con uno externo (`//evil.test`,
  `https://…`) o ausente.

## 8. Fuera de alcance

- Un correo combinado para aprobar y asignar apps a la vez.
- Que el admin elija si avisar o no.
- Avisar al desactivar, cambiar el rol o quitar apps.
- Reintentos si n8n falla.

## 9. Despliegue

hub-api y portal son independientes entre sí (en cualquier orden). Renombrar el flujo en n8n. Probar
con una cuenta propia de prueba: aprobarla, asignarle apps, quitarle una, reactivarla; nunca con la
cuenta de otra persona.
