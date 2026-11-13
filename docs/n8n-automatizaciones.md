# Automatizaciones con n8n (vía MCP) para apps del portal

Guía de referencia para **conectar una app del portal a una automatización de n8n**
(envíos de correo, notificaciones, sincronizaciones periódicas, etc.) sin tener que
reinvestigar el montaje cada vez. La implementación de referencia es el **envío
automático del archivo de World Office** de la app WO-sales (Fase 2).

Índice:
1. [La conexión MCP con n8n](#1-la-conexión-mcp-con-n8n)
2. [El patrón: cómo se automatiza una app del portal](#2-el-patrón-cómo-se-automatiza-una-app-del-portal)
3. [Checklist para una app nueva](#3-checklist-para-una-app-nueva)
4. [Playbook de diagnóstico](#4-playbook-de-diagnóstico-cuando-algo-no-llega)

---

## 1. La conexión MCP con n8n

n8n corre en nuestro VPS (EasyPanel). Claude Code se conecta a él por **MCP** usando el
servidor comunitario [`n8n-mcp`](https://www.npmjs.com/package/n8n-mcp), lo que permite
**crear, editar, validar e inspeccionar workflows y ejecuciones desde el chat**, sin
entrar a la UI de n8n.

### Cómo está montado

Registrado a nivel de **usuario** (`-s user`, disponible en todos los proyectos), con la
URL de nuestra instancia y una API key de n8n:

```powershell
# PowerShell — en UNA sola línea (la versión bash con \ de continuación falla en PS).
claude mcp add n8n-mcp -s user `
  -e MCP_MODE=stdio -e LOG_LEVEL=error -e DISABLE_CONSOLE_OUTPUT=true `
  -e N8N_API_URL=https://ambientalia-project-n8n.842ean.easypanel.host `
  -e N8N_API_KEY=<API_KEY_DE_N8N> `
  -- npx n8n-mcp
```

> En PowerShell, o lo pones todo en una línea, o usas el backtick `` ` `` como
> continuación (NO la barra `\` de bash).

- **`N8N_API_URL`**: la raíz de la instancia n8n en EasyPanel
  (`https://ambientalia-project-n8n.842ean.easypanel.host`), **no** la URL de la app.
- **`N8N_API_KEY`**: se genera en n8n → **Settings → n8n API → Create API key**. Es un
  JWT. Es un secreto: no se commitea. Vive solo en la config del MCP.

### Comprobar / quitar

```bash
claude mcp list              # ¿está "n8n-mcp: ... ✓ Connected"?
claude mcp get n8n-mcp       # ver comando + env (muestra la key: no la pegues en sitios)
claude mcp remove n8n-mcp -s user
```

### Herramientas MCP disponibles (prefijo `mcp__n8n-mcp__`)

| Necesito… | Herramienta |
|---|---|
| Buscar/entender un tipo de nodo | `search_nodes`, `get_node`, `validate_node` |
| Crear un workflow entero | `n8n_create_workflow` |
| Editar un nodo sin reenviar todo | `n8n_update_partial_workflow` (ops `updateNode`, `addNode`, dot-notation `parameters.x.y`) |
| Validar antes de activar | `n8n_validate_workflow` |
| Listar / leer workflows | `n8n_list_workflows`, `n8n_get_workflow` |
| Ver ejecuciones (¡diagnóstico!) | `n8n_executions` (`action:list` / `action:get` con `mode:filtered`) |

> **Ojo con las credenciales dentro de n8n**: la API del MCP gestiona la *estructura* del
> workflow, pero las **credenciales** (p.ej. la cuenta de Gmail OAuth) se configuran a
> mano en la UI de n8n y se referencian por id. El MCP no las crea.

---

## 2. El patrón: cómo se automatiza una app del portal

La automatización vive en **dos lados** que se hablan por HTTP. La regla de oro:

> **hub-api decide QUÉ hay que hacer y a quién; n8n solo pregunta por horario y ejecuta.**
> Toda la lógica de negocio está en hub-api (testeable, versionada); n8n es "tontos con
> horario": schedule → preguntar → si hay algo, hacerlo → confirmar.

### 2.1 Lado hub-api — dos endpoints con auth de máquina

Referencia: [`apps/hub-api/src/wo-sales/router.ts`](../apps/hub-api/src/wo-sales/router.ts),
[`email.ts`](../apps/hub-api/src/wo-sales/email.ts), [`email.repo.ts`](../apps/hub-api/src/wo-sales/email.repo.ts).

- **`GET /api/<app>/<accion>/pendiente`** → devuelve `{ enviar: false }` si no hay nada
  que hacer, o el **payload completo** de qué ejecutar (destinatarios, adjunto en base64,
  asunto, cuerpo, y un `token`).
- **`POST /api/<app>/<accion>/confirmado`** → n8n lo llama **después** de ejecutar con
  éxito. Avanza el estado (idempotente). **Clave**: el estado NO se avanza en `/pendiente`
  sino aquí, para que **si el envío falla, el próximo ciclo reintente** solo.

**Auth máquina-a-máquina** — NO es el JWT de usuario. Es
[`requireCronToken`](../apps/hub-api/src/auth.ts): compara la cabecera
`X-WO-Sales-Cron-Token` contra la env `WO_SALES_CRON_TOKEN` de hub-api. **Fail-closed**:
si la env no está configurada, no pasa nadie. Para una app nueva, o reutilizas ese token
o añades uno propio (y generalizas el nombre de la cabecera).

**Decisiones de diseño reutilizables** (probadas en WO-sales):

- **Detección de cambios por hash**: `token = sha256(contenido)`. Si el contenido no
  cambió, no se hace nada. Cubre altas, bajas y modificaciones de una sola vez.
- **Destinatarios = usuarios del portal con la app asignada.** Una sola fuente de verdad:
  `portal.users u JOIN portal.user_apps ua WHERE ua.app_id = '<id-de-la-app>' AND
  u.status = 'active'`. Se administra en **Gestión de Usuarios → Asignar apps**, sin lista
  aparte. El `app_id` es el `id` del catálogo [`apps/portal/src/lib/apps.ts`](../apps/portal/src/lib/apps.ts)
  (p.ej. `'WO-sales'`), **no** el label ni la ruta.
- **Seguimiento por destinatario** (tabla `wo_sales_email_sent`): cada quién guarda el
  último hash que recibió; se le envía cuando su hash ≠ el actual. Así un usuario
  **recién asignado** recibe el archivo actual sin esperar a que cambie el contenido, y
  no se reenvía a quien ya lo tenía.

### 2.2 Lado n8n — el workflow

Hay dos implementaciones vivas de este patrón:

| Workflow | Id | Forma |
|---|---|---|
| **WO-sales — envío de pedidos a World Office** | `79t0zWPuHgMZ4IMf` | Un único envío por ciclo, con hash de contenido |
| **Ausencias — Portal** | `dh0xjWCHsGj9raYH` | **Cola de eventos**: N acciones por ciclo, cada una se confirma por su `id` |

El segundo es el que conviene copiar cuando la automatización tiene que hacer
*varias cosas distintas* (correo, calendario, hoja): hub-api emite una fila de
outbox por cada acción, con **exactamente un correo por fila** y los efectos ya
resueltos (`payload.calendario`, `payload.hoja`, o `null`). Así n8n es una
**cadena lineal de IFs cuyas ramas falsas siguen adelante**, en vez de un árbol
que hay que volver a unir. Ver [dev/app-ausencias.md](dev/app-ausencias.md).

> ⚠️ El filo de ese patrón: los IF comparan `payload.X !== null`, así que **quitar
> un campo del payload no apaga su rama, la enciende** — `undefined !== null` es
> `true`. Los nodos van fuera ANTES de que hub-api deje de emitir el campo. Pasó
> al retirar la subida a Drive de ausencias.

Cadena de nodos del caso simple (WO-sales):

```
Schedule Trigger (cada 5 min)
      │
      ▼
HTTP Request GET  /api/<app>/<accion>/pendiente
      │   Header: X-WO-Sales-Cron-Token = {{ $env.WO_SALES_CRON_TOKEN }}
      ▼
IF  {{ $json.enviar }} === true ──(false)──▶ (fin, no hace nada)
      │ (true)
      ▼
[acción]  p.ej. Convert to File (base64→binario) → Gmail (adjunto)
      │
      ▼
HTTP Request POST /api/<app>/<accion>/confirmado   (retryOnFail, 3 intentos)
      Body: { token, emails }   ← devuelve lo que realmente ejecutó
```

Notas de implementación que costaron tiempo:
- El **token de cron** se guarda como **variable de entorno en n8n** y se referencia con
  `{{ $env.WO_SALES_CRON_TOKEN }}` en la cabecera. No se hardcodea en el nodo.
- Para adjuntar un archivo: hub-api lo manda en **base64** dentro del JSON; en n8n un nodo
  **Convert to File** (`toBinary`, `binaryPropertyName: "data"`) lo pasa a binario y el
  nodo de correo lo adjunta desde esa propiedad (`attachmentsBinary: [{ property: "data" }]`).
- El nodo **Gmail** usa una credencial OAuth configurada a mano en n8n (el MCP no la crea).
  Para que no ponga la firma de n8n: `options.appendAttribution = false`.
- El `/confirmado` **devuelve los `emails`** que se enviaron
  (`{{ $('Pedir pendiente').item.json.destinatarios.map(d => d.email) }}`) para marcar
  exactamente a quien recibió, no a quien se haya podido añadir entre medias.

### 2.3 La variante síncrona: hub-api llama a un Webhook y espera (avisos de Trazabilidad)

El envío de los avisos a clientes de Trazabilidad (2026-11-08) **no** sigue el patrón de arriba: no
hay cola ni sondeo, porque quien pulsa «Enviar correo» necesita saber al momento si salió (y la cola
con sondeo fue el mecanismo del incidente de los 700 correos de agosto de 2026).

| Workflow | Id | Forma |
|---|---|---|
| **Trazabilidad · Avisos a clientes (envío)** | `VqI0Esq61vdpNsOu` | Webhook síncrono (`POST /webhook/tmc-avisos-clientes`): un correo por llamada, con respuesta |

```
hub-api (POST JSON {referencia, para, asunto, cuerpo}, cabecera X-Tmc-Avisos-Token,
         espera 30 s como mucho, no sigue redirecciones)
      ▼
Webhook (Header Auth, credencial «Token avisos TMC») ── token malo ──▶ 403 de n8n
      ▼
Set «Barrera de dominio» + IF: ¿1 a 5 destinatarios, todos exactamente @ambientalia.com.co,
                              con asunto (sin saltos de línea) y texto?
      │ (no) ──▶ Respond 422 {ok: false, error: 'barrera: …'}
      ▼ (sí)
Gmail (credencial «Gmail info@»; texto plano; appendAttribution = false; sin reintentos)
      │ (error) ──▶ Respond 502 {error: 'gmail: …'}   ← SIN ok:false, a propósito
      ▼
Respond 200 {ok: true, messageId}
```

Cómo lo lee hub-api (`apps/hub-api/src/trazabilidad/envio-avisos.ts`, la única pieza que llama a la red):

| Respuesta | Para hub-api | Qué pasa en la app |
|---|---|---|
| 2xx con `ok: true` y `messageId` | enviado | queda «Enviado» (en modo real, el equipo se marca avisado) |
| `ok: false` (cualquier código), 3xx o 4xx | rechazado: **seguro** que no salió | «Fallido», se puede reenviar |
| cualquier otra cosa (5xx sin `ok:false`, sin respuesta en 30 s) | sin confirmar: **pudo** salir | la tarjeta se bloquea; a los 2 min una persona pulsa «Sí salió» / «No salió» mirando Enviados de info@ |

- Por eso el fallo de Gmail responde 502 **sin** `ok:false`: un fallo tardío (p. ej. un timeout con
  Google) puede llegar después de que el correo saliera; tratarlo como «no salió» permitiría reenviarlo.
  Y por eso el Gmail no reintenta.
- Variables de hub-api en EasyPanel: `TMC_AVISOS_ENVIO` (`apagado` | `prueba` | `real`; cualquier otro
  valor = apagado), `TMC_AVISOS_BUZON_PRUEBA`, `TMC_AVISOS_N8N_URL` y `TMC_AVISOS_N8N_TOKEN`. Si la URL
  no es https (o un host interno de una sola palabra) o falta el token, el portal dice «Envío apagado ·
  falta la configuración del canal» (le pasó la primera vez: la línea del token estaba vacía).
- El token es el valor de la credencial Header Auth del Webhook y el mismo que `TMC_AVISOS_N8N_TOKEN`.
  Propio de este flujo: no se reutiliza el de otra app. Si aparece en un chat o en un log, se rota en
  los dos sitios.
- **La credencial de Gmail es propia de info@** («Gmail info@»). No usar la «Gmail account»
  compartida: la usan 66 flujos (WO-sales, Vacaciones, Remisiones…) y el correo saldría desde otra
  cuenta. n8n asigna esa por defecto al abrir un nodo Gmail nuevo: revisarlo.
- El cliente OAuth de Google es el del proyecto `n8n-easypanel-ambientalia` (cuenta comercial@),
  pasado a **«Interno»** el 2026-11-10: cualquier cuenta @ambientalia.com.co puede conectarse y las
  conexiones ya no caducan cada 7 días (pasaba mientras era «Externo» en modo «Prueba»).
- **La barrera de dominio es un candado**: mientras exista, nada sale fuera de Ambientalia aunque
  hub-api estuviera en modo real. Quitarla es la fase 5 del plan de pruebas
  (`docs/superpowers/specs/2026-11-08-envio-avisos-clientes-design.md`), con la decisión explícita de
  Alfonso y los secretos ya rotados.
- Las ejecuciones de n8n guardan la cabecera con el token y el cuerpo del correo: restringir quién
  ve el flujo.
- Probarlo a mano desde PowerShell: `Read-Host` **enseña** lo que se teclea (dos veces acabó la clave
  en el chat). Leerla así, que la oculta:
  `$t = [System.Net.NetworkCredential]::new('', (Read-Host 'Token' -AsSecureString)).Password`,
  y ejecutar esa línea sola (si se pega junto con otras, `Read-Host` se traga la siguiente).
- Probado el 2026-11-10 (fases 2 a 4): envío directo, barrera (422, Gmail no se ejecuta), sin token
  (403), tarjetas reales en modo prueba, flujo desactivado (404 → «Fallido»), «sin confirmar» que sí
  salió y que no salió (con una espera temporal de 40 s, ya quitada).

### 2.4 Recuperación de contraseña del portal (webhook síncrono, sin barrera)

Los correos de «¿Olvidaste tu contraseña?» (2026-11-13) siguen la forma de 2.3, más simple: hub-api
llama al Webhook al momento y espera 10 s como mucho, pero la persona no espera a n8n (hub-api ya le ha
respondido) y nadie reintenta: si falla, vuelve a pedir el enlace.

| Workflow | Forma |
|---|---|
| **Portal — Restablecer contraseña** (id `0jYHqM3Z2mHZNFOC`) | Webhook síncrono (`POST /webhook/portal-restablecer-contrasena`): un correo por llamada |

```
hub-api (POST JSON {para, asunto, cuerpo}, cabecera X-Password-Reset-Token,
         espera 10 s como mucho, no sigue redirecciones; nunca lanza)
      ▼
Webhook 2.1 (Header Auth, credencial «Token restablecer contraseña») ── token malo ──▶ 403 de n8n
      ▼
Gmail 2.2 (credencial «Gmail info@», la misma de 2.3; HTML; appendAttribution = false; sin reintentos)
      │ (error) ──▶ la ejecución falla y n8n responde 500
      ▼
Respond to Webhook 1.5 → 200 {ok: true}
```

- Lo llama `apps/hub-api/src/users/password-reset/password-reset.mailer.ts`. Cualquier respuesta que no
  sea 2xx, o 10 s sin respuesta, deja en el log de hub-api `password_reset_envio_fallido`; sin
  `PASSWORD_RESET_N8N_URL` o `PASSWORD_RESET_N8N_TOKEN`, `password_reset_sin_configurar` y no sale nada.
- **No guarda las ejecuciones correctas** (`saveDataSuccessExecution: none`): el enlace con su token no
  queda en el historial. Las fallidas sí se guardan, para diagnosticar, y llevan el enlace y la
  cabecera: restringir quién ve el flujo. El enlace caduca a los 30 minutos y es de un solo uso.
- El Gmail no tiene salida de error a propósito: con ella la ejecución acabaría «bien» y, al no
  guardarse las correctas, se perdería el rastro del fallo.
- El token es el valor de la credencial Header Auth y el mismo que `PASSWORD_RESET_N8N_TOKEN` en
  EasyPanel. Propio de este flujo. Si aparece en un chat o en un log, se rota en los dos sitios.
- Sin barrera de dominio: el destinatario es siempre el correo de la propia cuenta, que hub-api lee de
  `portal.users`, nunca del cuerpo de la petición del navegador.
- Probarlo a mano como en 2.3 (el token leído con `-AsSecureString`) y SIEMPRE a un buzón propio.

---

## 3. Checklist para una app nueva

1. **hub-api**: crea `router.ts` con `GET .../pendiente` y `POST .../confirmado`, ambos con
   `requireCronToken`. Mete la lógica en un `*.ts` puro y testeable (como `email.ts`).
2. **Token de cron**: define la env **propia de la automatización** en EasyPanel (hub-api)
   **y** en n8n (Settings → Variables), y pásasela al middleware:
   `requireCronToken({ env: 'MI_APP_CRON_TOKEN', header: 'X-Mi-App-Cron-Token' })`.
   Sin argumentos sigue usando los de WO-sales. **No reutilices el token de otra app**:
   rotarlo tumbaría las dos, y un flujo con un fallo no debería poder pegar a los
   endpoints del otro (hay un test que lo comprueba en `auth.requireCronToken.test.ts`).
3. **Destinatarios/permisos**: si aplica, filtra por `portal.user_apps` con el `id` de la
   app del catálogo. Recuerda: quien recibe = quien tiene la app asignada y está `active`.
4. **n8n (por MCP)**: `n8n_create_workflow` con la cadena Schedule → GET → IF → acción →
   POST. Luego `n8n_validate_workflow`. Las credenciales (Gmail, etc.) se enganchan a mano
   en la UI.
5. **Prueba en vivo**: provoca un cambio real, mira `n8n_executions` y confirma que la
   acción se ejecutó y `/confirmado` respondió `{ ok: true }`.
6. Despliega hub-api (EasyPanel construye `origin/main`; corre las migraciones al arrancar).

---

## 4. Playbook de diagnóstico ("no llegó nada")

Orden de comprobación, de la evidencia más barata a la más cara. **No adivinar**: cada
capa se verifica.

1. **¿n8n dispara?** `n8n_executions(action:list, workflowId)`. Si hay ejecuciones
   `success` cada N min, el schedule va. **Ejecuciones muy cortas (<400ms) = el IF cortó
   en "no hacer nada"** (la API devolvió `enviar:false`).
2. **¿Qué devolvió `/pendiente`?** `n8n_executions(action:get, id, mode:filtered,
   nodeNames:["Pedir pendiente","¿Hay que enviar?"])`. Si es `{enviar:false}`, el problema
   está en hub-api (no hay nada pendiente), no en n8n.
3. **¿Qué versión de hub-api está desplegada?** Sonda sin credenciales: pega a un endpoint
   que sabes que cambió (p.ej. uno eliminado → 404 = build nuevo; 401 = build viejo).
4. **Estado real en la BD** — consola Postgres de EasyPanel del servicio `zoho-hub-db`:
   > ⚠️ **La consola abre `psql` conectado a la base `postgres` por defecto**, donde NO
   > están nuestras tablas. **Primero `\c zoho-hub`** (la base real, donde viven tanto
   > `portal.*` como `books.*`). Sin eso, todo da *"relation does not exist"* y parece un
   > problema que no es. (Si `\c zoho-hub` falla, `\l` para ver los nombres.)

   Consultas útiles:
   ```sql
   \c zoho-hub
   -- Destinatarios que ve el código:
   SELECT u.email, u.status, ua.app_id
     FROM portal.users u JOIN portal.user_apps ua ON ua.user_id = u.id
    WHERE ua.app_id = '<id-app>';
   -- ¿Los datos de origen ya se replicaron desde Zoho? (el flujo lee la RÉPLICA, no Zoho en vivo)
   SELECT salesorder_number, status, date, zoho_last_modified
     FROM books.sales_orders ORDER BY zoho_last_modified DESC NULLS LAST LIMIT 10;
   ```

**Caso real (2026-07-17):** "creé 2 OV y no llegó el correo". No era un bug: las 2 OV
estaban en estado **`pending_approval`**, que WO-sales excluye a propósito
(`estadosVivos = ['open','overdue','partially_invoiced']` en
[`config.ts`](../apps/hub-api/src/wo-sales/config.ts)). Al no ser "vivas", no entraban al
archivo → el hash no cambiaba → `enviar:false`. Se aprobaron en Zoho y el correo salió
solo en el siguiente ciclo. Moraleja: **el flujo lee la réplica y solo el subconjunto de
datos que la app considera "vivo"**; verifica ambos antes de sospechar del correo.
