# WO-sales — Envío automático del archivo por correo (Fase 2)

**Fecha:** 2026-07-16
**Estado:** diseño aprobado, pendiente de escribir el plan de implementación
**Depende de:** WO-sales V1 (`docs/superpowers/specs/2026-07-15-wo-sales-design.md`), ya en producción.

## 1. Objetivo

Enviar por correo el archivo `.xls` de pedidos de World Office a una lista de
destinatarios **configurable desde la propia app**, cuando las órdenes de venta vivas
cambian. Reemplaza el envío manual (descargar y adjuntar a mano).

## 2. Decisiones (cerradas en brainstorming)

- **Cadencia**: un correo **por lote**, no por cada OV. Si en un ciclo cambiaron 5 OV, es
  un solo correo. Encaja con que el sync de Zoho no es instantáneo (~cada 3 min).
- **Proveedor de correo**: **n8n** (ya está en su VPS). hub-api NO envía correo ni tiene
  SMTP; solo decide *qué* enviar y *a quién*. n8n hace el envío con sus credenciales.
- **Coordinación**: **n8n consulta a hub-api por horario** (pull). hub-api sigue siendo
  request-response, sin reloj propio.
- **Robustez**: con **confirmado** de vuelta. n8n avisa "enviado" y solo entonces hub-api
  marca ese estado como enviado. Un fallo de correo se reintenta en vez de perderse.
- **Destinatarios**: gestionados por usuarios con la app WO-sales asignada. Se guarda
  `email`, `nombre`, `activo`.
- **Contenido**: el `.xls` **completo y actualizado** (todas las OV vivas del año, igual
  que la descarga manual), no un diff. El cuerpo del correo indica qué OV cambiaron.

## 3. Flujo

```
n8n (Schedule, ~cada 5 min)
   │  1. GET  /api/wo-sales/email/pendiente   (cabecera X-WO-Sales-Cron-Token)
   ▼
hub-api  → ¿el archivo cambió desde el último envío CONFIRMADO?  (hash del contenido)
   │        · no, o sin destinatarios activos → { enviar: false }
   │        · sí → { enviar: true, xlsBase64, nombreArchivo, destinatarios[],
   │                 asunto, cuerpo, resumen, token }
   ▼
n8n  → si enviar: nodo Email (adjunta el .xls decodificado del base64)
   │  2. POST /api/wo-sales/email/confirmado  { token }
   ▼
hub-api  → guarda ese hash como "último enviado" y sella la fecha
```

hub-api no envía nada ni programa nada. n8n pone el horario, el reintento y el envío.

## 4. Datos nuevos (esquema `portal`, una migración)

`portal.wo_sales_recipients`:
```
id          uuid  PK default gen_random_uuid()
email       text  not null
nombre      text  not null
activo      bool  not null default true
created_at  timestamptz not null default now()
```

`portal.wo_sales_email_estado` (una sola fila, singleton):
```
id             int  PK check (id = 1)   -- fuerza una única fila
ultimo_hash    text                     -- huella del último archivo CONFIRMADO como enviado
ultimo_envio_at timestamptz
```

**Gotcha del repo**: las migraciones de hub-api son una lista hardcodeada en
`src/db.ts` (`const MIGRATIONS = [...]`), no un readdir. La migración nueva
(`004_wo_sales_email.sql`, en `src/users/migrations/`) hay que **añadirla al array**.

## 5. Detección de cambios (lo más delicado)

En cada consulta, hub-api construye el archivo con el filtro por defecto (año actual, OV
vivas) usando `buildWorldOfficeCsv`, y calcula un **hash** (sha-256) de la matriz. Si el
hash ≠ `ultimo_hash` → algo cambió y hay que enviar. El hash cubre los tres casos: OV
nueva, OV modificada y **OV que sale del archivo** (por facturarse) — comparar solo
fechas de modificación no detectaría la que desaparece. El `token` que viaja a n8n **es
ese hash**; el `confirmado` lo persiste. Idempotente: reenviar el mismo estado no pasa
dos veces.

**Regla clave**: el hash solo se avanza en `/confirmado`, no en `/pendiente`. Si n8n no
confirma (correo falló), el próximo ciclo vuelve a ver el cambio y reintenta.

**Sin destinatarios activos**: `/pendiente` responde `enviar: false` y **no avanza el
hash**, para que cuando se añada un destinatario el envío pendiente salga. La UI muestra
que hay cambios sin enviar por falta de destinatarios.

## 6. Endpoints (hub-api)

**Para n8n** — auth por cabecera secreta `X-WO-Sales-Cron-Token` (env `WO_SALES_CRON_TOKEN`),
no JWT de usuario. 401 si falta o no coincide.

- `GET /api/wo-sales/email/pendiente`
  → `{ enviar: false }` | `{ enviar: true, xlsBase64, nombreArchivo, destinatarios:
  [{email, nombre}], asunto, cuerpo, resumen: { ordenes, filas, cambiadas: string[],
  advertencias: number }, token }`
  El `asunto` y `cuerpo` los arma hub-api (una sola fuente, testeable). `cambiadas` =
  OV vivas con `zoho_last_modified > ultimo_envio_at` (mejor esfuerzo, para el cuerpo).
- `POST /api/wo-sales/email/confirmado`  `{ token }`
  → valida que el token siga siendo el hash actual, guarda `ultimo_hash = token`,
  `ultimo_envio_at = now()`. 200 idempotente.

**Para la app** — auth normal `requireAuth` + `requireApp('WO-sales')`:

- `GET    /api/wo-sales/destinatarios`            → lista
- `POST   /api/wo-sales/destinatarios`  `{ email, nombre }`  → alta (valida email)
- `PATCH  /api/wo-sales/destinatarios/:id`  `{ activo }`     → activar/desactivar
- `DELETE /api/wo-sales/destinatarios/:id`                    → baja

## 7. UI (dentro de WO-sales)

Un panel **"Destinatarios del correo automático"** en la misma app: tabla con
email / nombre / interruptor activo, un formulario para añadir, y borrar por fila.
Si hay cambios pendientes sin destinatarios activos, un aviso. Nada de pantalla aparte.

## 8. El flujo de n8n

Se crea **después** de que existan los endpoints. Dos vías (decisión operativa, no de
diseño): (a) por el MCP de n8n ya conectado, o (b) importando un JSON que se entrega.
Nodos: **Schedule** (~5 min, ≥ intervalo de sync) → **HTTP Request** GET `/email/pendiente`
con la cabecera del token → **IF** `enviar == true` → **Email** (a `destinatarios`
activos, `asunto`/`cuerpo`, adjunta el `.xls` decodificado del base64) → **HTTP Request**
POST `/email/confirmado` `{ token }`. El reintento del nodo Email cubre fallos
transitorios; si aun así falla, al no confirmar, el ciclo siguiente reintenta.

## 9. Errores

- Token de cron ausente/incorrecto → 401.
- Sin destinatarios activos → `enviar: false`, hash sin avanzar, aviso en la UI.
- Email inválido en el alta → 400.
- El `.xls` se construye desde la matriz del builder (misma fuente que la descarga), así
  que hereda sus advertencias; no se envía nada roto en silencio.

## 10. Tests

- Detección de cambios: hash igual → `enviar: false`; OV modificada / nueva / que sale →
  `enviar: true`; sin destinatarios → `enviar: false` y hash sin avanzar.
- `confirmado` avanza el hash y sella la fecha; con token viejo no hace nada.
- CRUD de destinatarios (alta valida email, patch activa/desactiva, delete).
- Auth: `/email/*` exige el token de cron; los de destinatarios exigen `requireApp`.

## 11. Configuración / pendientes

- **`WO_SALES_CRON_TOKEN`**: secreto nuevo en el env de hub-api (EasyPanel).
- **Intervalo del Schedule** en n8n: sugerido 5 min (≥ los 3 min del sync).
- **Remitente, asunto base y plantilla del cuerpo**: el asunto/cuerpo los arma hub-api;
  el remitente es la credencial de correo de n8n. Confirmar con Xiomara el texto.
- **Rotar** la API key de n8n que quedó expuesta en el chat al montar el MCP.
