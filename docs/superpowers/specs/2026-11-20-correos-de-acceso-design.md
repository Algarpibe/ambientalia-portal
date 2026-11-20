# Portal — correos de acceso: bienvenida, reactivación y apps nuevas

**Fecha:** 2026-11-20
**Estado:** implementado en la rama `feat/correos-de-acceso` (plan
`docs/superpowers/plans/2026-11-20-correos-de-acceso.md`); pendiente de fusionar y desplegar. El flujo
de n8n `0jYHqM3Z2mHZNFOC` ya está renombrado a «Portal — Correos a usuarios».
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

Tres arreglos para que los enlaces del correo lleven a donde dicen:

### 5.1 Pantalla de acceso

**`AuthCard` abre en «Iniciar sesión»** con `?modo=login` en la URL o cuando se llega redirigido
   desde una ruta protegida (`location.state.from`, que ya ponen `RequireAuth` y `RequireAdmin`). Hoy
   `/auth` abre en registro. `location.state.modo` (de la recuperación de contraseña) sigue mandando
   sobre lo demás.
### 5.2 Destino tras iniciar sesión

**Tras iniciar sesión se vuelve a la ruta pedida** (`location.state.from`) en vez de a `/`, solo
si es interna: empieza por `/`, no por `//` y no contiene `/\` ni ningún espacio en blanco.
Cualquier otra cosa lleva a `/` (sin redirecciones abiertas). Los dos últimos descartes existen
porque los navegadores ignoran tabuladores y saltos de línea dentro de una URL y tratan `\` como `/`:
`/\t/evil` se convertiría en `//evil`.

### 5.3 Guardia de apps

**`AppGuard` espera a la lista del servidor antes de negar el acceso.** El guardia decide en el primer
render con las apps del token, que dura 7 días y no se refresca nunca; la lista real de la BD solo
llega cuando contesta `GET /api/users/me`. Quien acaba de recibir una app nueva y abre su enlace
desde el correo de «apps nuevas» (una carga completa de página) llegaba con el token anterior, veía
«No tienes acceso a esta aplicación.» y era devuelto a `/` antes de que llegara la respuesta.

- `useAuth` expone `appsConfirmadas`: `true` cuando ya llegó la lista del servidor para ese usuario, o
  cuando el intento terminó sin datos utilizables (error, perfil ajeno, sin `apps`, fallo de red) y
  valen las del token, o cuando no hay sesión. Se lleva a nivel de módulo por usuario, como la caché de
  apps, y avisa a los suscriptores al terminar el intento, tenga o no datos.
- `AppGuard`: si el token ya trae la app, renderiza sin esperar; si no y la lista aún no es definitiva,
  muestra un marcador neutro (`role="status"`) sin redirigir ni avisar; si ya es definitiva y no la
  trae, redirige y notifica como antes.

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

Desplegar **primero el portal** (o los dos a la vez) y después hub-api. Si hub-api saliera antes, los
correos ya enlazarían a `/auth?modo=login` y a rutas de app que el portal antiguo no maneja bien: abre
el registro, el inicio de sesión lleva a `/` y el guardia niega con las apps viejas del token. El
renombrado del flujo en n8n ya está hecho. Probar con una cuenta propia de prueba: aprobarla,
asignarle apps, quitarle una, reactivarla; nunca con la cuenta de otra persona.

## 10. Limitaciones aceptadas

- `before` (las apps de antes) se lee fuera de la transacción de `setApps`: dos guardados simultáneos
  podrían calcular mal la diferencia y avisar de más o de menos.
- `user_access_email_sent` significa «entregado al mailer», no «recibido»: un fallo de n8n queda en el
  log como `password_reset_envio_fallido`, sin `user_id`.
- El interceptor de 401 y el cierre de sesión siguen enviando a `/auth`, que abre en registro; queda
  fuera de alcance.
