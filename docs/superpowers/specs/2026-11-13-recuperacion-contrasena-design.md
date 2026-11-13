# Portal — recuperación de contraseña por correo (autoservicio)

**Fecha:** 2026-11-13
**Estado:** implementado en la rama `feat/recuperacion-contrasena` (plan:
`docs/superpowers/plans/2026-11-13-recuperacion-contrasena.md`); pendiente de fusionar y desplegar.
El flujo de n8n «Portal — Restablecer contraseña» (id `0jYHqM3Z2mHZNFOC`) ya está creado.
**Depende de:** el login real con JWT (`apps/hub-api/src/auth.ts`, `POST /api/login` en
`apps/hub-api/src/index.ts`), `UserRepository.updatePassword` (sube `token_version`, SEC-220),
`PORTAL_URL` (`apps/hub-api/src/ausencias/config.ts`) y la pantalla de acceso del portal
(`apps/portal/src/components/Auth/`).

## 1. Objetivo

Que quien ha olvidado su contraseña del portal pueda elegir una nueva sin depender de nadie.

Hoy no hay ninguna vía: el login no tiene enlace de «¿Olvidaste tu contraseña?», el único
cambio de clave (`PATCH /api/users/me/password`) exige sesión y la contraseña actual, y el panel
de administración no tiene acción de restablecer. La única salida es tocar `password_hash` a
mano en la BD.

## 2. Decisiones (cerradas en brainstorming)

- **Autoservicio por correo** con enlace de un solo uso. El restablecimiento por el admin queda
  fuera de esta entrega (§9).
- **Envío: webhook inmediato a n8n, sin esperar respuesta** (opción A). Descartadas la cola
  sondeada (B: 10 min de latencia, más piezas, el enlace quedaría guardado en la cola) y el SMTP
  directo (C: dependencia y secreto nuevos, rompe la convención de que todo correo sale por n8n).
- **Remitente:** el buzón de Gmail que ya está conectado en n8n. Sin cuenta nueva.
- **Caducidad del enlace: 30 minutos.** Siempre de un solo uso.
- **Correo de aviso tras el cambio:** sí («tu contraseña se ha cambiado; si no fuiste tú, avisa
  al administrador»).
- **Solo cuentas `active`.** Una cuenta `pending` o `inactive` no podría entrar aunque cambiara
  la clave; no recibe enlace.
- **Restablecer cierra todas las sesiones abiertas** (sube `token_version`).
- **Sin inicio de sesión automático** tras restablecer: la persona vuelve al login.

## 3. Datos — migración 077

Fichero `apps/hub-api/src/users/migrations/077_password_reset_tokens.sql`, añadido al array
`MIGRATIONS` de `apps/hub-api/src/db.ts`. Idempotente (`IF NOT EXISTS`), porque las migraciones
se re-ejecutan en cada arranque.

```sql
CREATE TABLE IF NOT EXISTS portal.password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES portal.users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON portal.password_reset_tokens (user_id, created_at DESC);
```

- `used_at` marca un token **gastado o anulado**; en ambos casos deja de valer.
- **Permisos (DATA-332):** la 068 concede `ALL TABLES` a `portal_app`, pero corre antes que esta
  en el mismo arranque. La 077 termina, como la 076, con un bloque `DO $$` que, si existe el rol
  `portal_app`, le concede `SELECT, INSERT, UPDATE, DELETE` sobre la tabla nueva. No hay
  secuencia (el `id` es UUID).

## 4. El token

- **Generación:** 32 bytes de `crypto.randomBytes`, codificados en base64url. Ese valor solo
  viaja en el enlace del correo.
- **Almacenamiento:** solo su huella **SHA-256** (hex) en `token_hash`. Con acceso a la BD no se
  puede reconstruir un enlace válido. SHA-256 y no bcrypt: el token ya tiene 256 bits de
  entropía y así se busca directamente por la huella.
- **Validez:** `expires_at = ahora + 30 min`. El servicio recibe un reloj inyectable y pasa la
  hora al repositorio, que compara contra ella (no contra `now()` de la BD) para que las pruebas
  controlen el tiempo.
- **Un token nuevo anula los anteriores** sin usar del mismo usuario (`used_at = ahora`).
- **Limpieza:** al crear un token se borran los de cualquier usuario con
  `expires_at < ahora - 1 día`.

## 5. hub-api

Módulo nuevo `apps/hub-api/src/users/password-reset/`, con piezas de una sola responsabilidad:

| Pieza | Responsabilidad |
|---|---|
| `password-reset.repository.ts` | SQL de la tabla y la transacción de restablecer |
| `password-reset.service.ts` | Reglas: quién recibe enlace, frenos por cuenta, caducidad, validación de la clave |
| `password-reset.mailer.ts` | Cliente del webhook de n8n (nunca lanza) |
| `password-reset.emails.ts` | Asunto y cuerpo de los dos correos (funciones puras) |
| `password-reset.router.ts` | Los dos endpoints, sus rate limits y el mapeo de errores |

`users.service.ts` solo gana un `export` en `BCRYPT_COST` y `MIN_PASSWORD_LENGTH` (la clave
nueva sigue las reglas del registro). El router se monta junto al de usuarios; las dos rutas son
públicas (sin `requireAuth`), igual que `/api/login` y `/api/auth/register`. Les aplica también
el limitador global de `/api/` (60/min).

### 5.1 `POST /api/auth/forgot-password` — body `{ email }`

1. Si `email` falta, no es texto, queda en blanco tras `trim()` o pasa de 320 caracteres →
   `400 { error: 'missing_email' }` (no revela nada).
2. **Responde ya** `200 { message: 'reset_requested' }`, sea cual sea el caso.
3. **Después de responder** (sin `await` en la ruta; `requestReset` se invoca tras
   `Promise.resolve().then(...)`, de modo que también un fallo síncrono se recoge; los errores
   van al log y a `captureError`):
   1. Normaliza el correo (`trim().toLowerCase()`) y busca al usuario.
   2. No existe, o no está `active` → no hace nada más.
   3. **Freno por cuenta:** si su último token se creó hace menos de 2 minutos, o ya tiene 5
      creados en la última hora → no crea ni envía; log `password_reset_frenado`.
   4. Crea el token (anulando los anteriores y limpiando caducados) y envía el correo del enlace.
   5. Log `password_reset_requested` con `user_id` (no el correo).

Responder antes de trabajar hace que el tiempo de respuesta no delate si la cuenta existe.

**Rate limit por IP:** 5 peticiones / 15 min (`express-rate-limit`, clave por defecto `req.ip`,
con `trust proxy 1` ya configurado).

### 5.2 `POST /api/auth/reset-password` — body `{ token, newPassword }`

Orden de las comprobaciones:

1. `newPassword` con menos de `MIN_PASSWORD_LENGTH` (8) → `400 { error: 'password_too_short' }`.
2. Formato del token, `/^[A-Za-z0-9_-]{43}$/` (32 bytes en base64url), **antes** de bcrypt: un
   token mal formado no llega a bcrypt ni a la BD.
3. `token` vacío, mal formado, desconocido, caducado o ya usado → `400 { error:
   'invalid_or_expired_token' }`. Es 400 y no 401 para que el interceptor del portal no lo trate
   como sesión caducada.
4. Hashea la clave nueva con bcrypt (coste `BCRYPT_COST`) **antes** de abrir la transacción.
5. **Transacción:**
   1. `UPDATE portal.password_reset_tokens SET used_at = $ahora WHERE token_hash = $1 AND
      used_at IS NULL AND expires_at > $ahora RETURNING user_id`. Si no devuelve fila →
      rollback y error del punto 2. Al ser una única sentencia condicionada, dos usos
      simultáneos del mismo token no pueden ganar los dos.
   2. Lee el usuario `FOR UPDATE`. Si no está `active` → rollback y el mismo error del punto 2.
   3. `UPDATE portal.users SET password_hash = $2, token_version = token_version + 1 WHERE
      id = $1` (misma semántica que `updatePassword`).
   4. Anula los demás tokens sin usar de ese usuario.
6. `200 { message: 'password_reset' }`. Después, sin esperar, envía el correo de aviso y deja el
   log `password_reset_completed` con `user_id`. El aviso posterior al commit no puede lanzar
   hacia la petición (va tras `Promise.resolve().then(...)` con su `catch`).

**Rate limit por IP:** 10 intentos / 15 min.

### 5.3 El correo

- `password-reset.mailer.ts` hace `POST` a `PASSWORD_RESET_N8N_URL` con la cabecera
  `X-Password-Reset-Token: <PASSWORD_RESET_N8N_TOKEN>` y el cuerpo `{ para, asunto, cuerpo }`.
  Mismo patrón que `trazabilidad/envio-avisos.ts`: `redirect: 'manual'`, timeout de 10 s.
- **Nunca lanza.** Un fallo (red, timeout, respuesta no 2xx) deja el log
  `password_reset_envio_fallido` y `captureError`. Descarta el cuerpo de la respuesta
  (`res.body.cancel()`) para liberar el socket.
- Si falta cualquiera de las dos variables → no envía nada y deja el log
  `password_reset_sin_configurar`. La respuesta al usuario no cambia. Además, al crearse el
  mailer (al arrancar hub-api) emite un `console.warn` único
  `password_reset_sin_configurar_al_arrancar`, para que el fallo no espere a la primera petición.
- **Enlace:** `${PORTAL_URL}/auth/restablecer#t=<token>`. El token va tras el `#`, que el
  navegador no envía al servidor: no queda en los logs de nginx ni en la cabecera `Referer`.
- **Contenido** (HTML sencillo, construido en `password-reset.emails.ts`). El nombre de la
  persona se **escapa** antes de insertarlo, porque lo escribió ella al registrarse.
  - *Enlace* — asunto «Restablecer tu contraseña del Portal Ambientalia». Saluda por el nombre,
    explica que se pidió restablecer la contraseña, muestra el enlace como botón y también en
    texto, dice que vale 30 minutos y una sola vez, y que si no lo pidió puede ignorar el correo
    porque su contraseña no cambia.
  - *Aviso* — asunto «Tu contraseña del Portal Ambientalia se ha cambiado». Saluda por el
    nombre, indica fecha y hora del cambio (hora de Colombia) y pide avisar al administrador si
    no fue ella. No incluye ningún correo de contacto concreto (el repo es público).

### 5.4 Variables de entorno nuevas

`PASSWORD_RESET_N8N_URL` y `PASSWORD_RESET_N8N_TOKEN`, añadidas a `apps/hub-api/.env.example`
(el test INFRA-537 exige que estén todas las que se leen por nombre).

## 6. Portal

### 6.1 Login (`apps/portal/src/components/Auth/`)

- Enlace **«¿Olvidaste tu contraseña?»** bajo el campo de contraseña, solo en la pestaña de
  iniciar sesión.
- Al pulsarlo, el panel pasa a un **tercer modo** con un campo de correo, el botón
  «Enviar enlace» y «Volver a iniciar sesión».
- Tras enviar (respuesta 200), siempre el mismo mensaje: «Si el correo está registrado,
  recibirás un enlace en unos minutos. Revisa también la carpeta de spam».
- 429 → «Demasiados intentos, espera unos minutos». Fallo de red → «No se pudo conectar con el
  servidor. Reintenta». Cualquier otro estado que no sea 200 → «No se pudo enviar el enlace.
  Reintenta».
- Foco: el campo de correo se enfoca al abrir el modo y, tras enviar, el título de la
  confirmación recibe el foco.
- `/auth` puede abrirse directamente en «iniciar sesión» o en «olvidé» con
  `navigate('/auth', { state: { modo } })` (`modo`: `'login'` | `'olvido'`); sin indicación,
  abre el registro como siempre.

### 6.2 Página `/auth/restablecer`

- Ruta **pública** en `apps/portal/src/App.tsx`, fuera de `RequireAuth`, con el mismo diseño de
  tarjeta que el login.
- Al montar, lee el token de `#t=` y **lo quita de la barra de direcciones**
  (`history.replaceState`) para que no quede en el historial.
- Formulario: nueva contraseña + confirmación, con el ojo de mostrar/ocultar como en
  Configuración. Valida en cliente: mínimo 8 caracteres y que coincidan.
- **Éxito:** «Contraseña actualizada» y botón para ir al login. Borra el token de sesión que
  hubiera en `localStorage` (`ambientalia_token`), que ya no vale.
- **Sin token, con un token mal formado (que no cumple `/^[A-Za-z0-9_-]{43}$/`), o `400
  invalid_or_expired_token`:** «Este enlace no es válido o ha caducado», con un botón que lleva
  al modo «¿Olvidaste tu contraseña?» del login. Un token mal formado va directo a esta vista,
  sin mostrar el formulario ni hacer ninguna petición; el hash se quita igualmente.
- 429 y fallo de red: los mismos mensajes que en §6.1. Un `400 password_too_short` del servidor
  se muestra como el aviso de clave corta; cualquier otro estado no esperado, «No se pudo
  restablecer la contraseña. Reintenta».
- Foco: el campo de contraseña nueva se enfoca al abrir; los títulos de «Contraseña
  actualizada» y de «enlace no válido» reciben el foco al aparecer.
- El botón de éxito lleva a `/auth` en modo «iniciar sesión» y el de enlace no válido, en modo
  «olvidé» (`navigate('/auth', { state: { modo } })`).

### 6.3 Sentry

El depurador de URLs de Sentry en el portal (`stripQuery` en `apps/portal/src/sentry.ts`) quita
ahora la query string **y el fragmento**: el token de restablecer (`#t=`) y la llave del kiosco
de TV (`#k=`) viajan en el fragmento, y la instrumentación del historial registra la URL previa
al `replaceState` que los quita de la barra.

## 7. n8n

Flujo nuevo **«Portal — Restablecer contraseña»**, creado con el MCP de n8n:

- **Webhook** (POST, v2.1) que exige la cabecera `X-Password-Reset-Token` → **Gmail** (v2.2) con
  la credencial «Gmail info@» (`para`, `asunto`, `cuerpo` como HTML) → **Respond to Webhook**
  (v1.5) 200.
- **Ajustes del flujo:** no guardar las ejecuciones correctas (el enlace no queda en el
  historial); sí guardar las fallidas, para diagnosticar. **Las ejecuciones fallidas conservan
  el enlace y el secreto de la cabecera**: conviene restringir quién puede ver este flujo en n8n.
- La credencial de Gmail la confirma el usuario a mano; el MCP no la engancha.

## 8. Pruebas (TDD estricto)

- **Servicio** (repositorio, mailer y reloj falsos):
  - solo las cuentas `active` reciben enlace; `pending`, `inactive` y desconocidas no;
  - frenos por cuenta: menos de 2 minutos desde el último, y 5 por hora;
  - en el repositorio solo llega la huella, nunca el token;
  - un token nuevo anula los anteriores;
  - caduca a los 30 minutos y solo sirve una vez;
  - clave corta → `password_too_short`;
  - tras restablecer se envía el aviso; si el mailer falla, el restablecimiento no se deshace.
- **Correos** (funciones puras): el enlace lleva el token tras `#t=`, el nombre se escapa.
- **Mailer:** cabecera y cuerpo correctos, timeout, nunca lanza, sin variables no envía.
- **Repositorio — `*.db.test.ts`** contra Postgres real (testcontainers):
  - dos consumos simultáneos del mismo token: solo uno gana;
  - restablecer sube `token_version` y cambia `password_hash`;
  - cuenta no `active` en el momento de usar el token → rollback;
  - borrar el usuario borra sus tokens (cascada);
  - la limpieza borra los caducados hace más de un día y no los demás.
- **Router** (supertest): `forgot-password` responde idéntico para cuenta activa, inactiva y
  desconocida; los 400 de `reset-password`; las dos rutas no piden sesión.
- **Portal:**
  - login: el enlace solo aparece en la pestaña de iniciar sesión, el modo «olvidé» envía el
    correo y muestra el mensaje genérico;
  - `/auth/restablecer`: lee el token y lo quita de la URL, rechaza claves que no coinciden o
    cortas, muestra el error de enlace no válido, y en el éxito borra el token de sesión.

## 9. Fuera de alcance

- **Restablecimiento por el admin.** Cuando se haga, reutilizará este mismo mecanismo de token
  (botón que envía el enlace + «Copiar enlace»), sin contraseñas temporales.
- Reintentos automáticos si n8n falla: la persona vuelve a pedir el enlace.
- CAPTCHA.
- Forzar el cambio de contraseña en el siguiente login.

## 10. Limitaciones aceptadas

- Un token cuenta para los frenos por cuenta aunque n8n no haya podido enviarlo.
- El límite por IP (5 / 15 min) lo comparten las personas que salen por la misma conexión de la
  oficina.
- bcrypt se ejecuta para los tokens bien formados pero desconocidos (acotado por el límite por
  IP).
- El freno por cuenta (comprobar y luego insertar) no es atómico: dos peticiones simultáneas
  pueden enviar las dos; el límite por IP lo acota.

## 11. Despliegue

1. Flujo de n8n (ya creado): confirmar la credencial de Gmail, comprobar que está **activo** y,
   antes de desplegar, enviar una prueba a un buzón propio.
2. Añadir `PASSWORD_RESET_N8N_URL` y `PASSWORD_RESET_N8N_TOKEN` a hub-api en EasyPanel.
3. Desplegar hub-api (aplica la migración 077).
4. Desplegar el portal.

Si el portal sale antes que hub-api, el enlace aparece pero los endpoints dan 404.
