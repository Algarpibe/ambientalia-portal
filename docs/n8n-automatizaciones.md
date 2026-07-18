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

Referencia: workflow **"WO-sales — envío de pedidos a World Office"** (id `79t0zWPuHgMZ4IMf`).
Cadena de nodos:

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

---

## 3. Checklist para una app nueva

1. **hub-api**: crea `router.ts` con `GET .../pendiente` y `POST .../confirmado`, ambos con
   `requireCronToken`. Mete la lógica en un `*.ts` puro y testeable (como `email.ts`).
2. **Token de cron**: define la env (reutiliza `WO_SALES_CRON_TOKEN` o crea uno) en
   EasyPanel (hub-api) **y** en n8n (Settings → Variables).
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
