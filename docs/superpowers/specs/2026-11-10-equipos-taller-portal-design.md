# Equipos en taller — integración en el portal (diseño)

Fecha: 10/11/2026. Estado: implementado y desplegado; **revisado el 10/11/2026 (Drive vía n8n)** y **el 11/11/2026 (se actualiza sola cada hora)**. Plan original: `docs/superpowers/plans/2026-11-10-equipos-taller-portal.md`. Plan de la revisión: `docs/superpowers/plans/2026-11-10-equipos-taller-sync-n8n.md`.

## Revisión del 11/11/2026: se actualiza sola cada hora

**Por qué.** Con la copia de Drive llegando cada hora, el botón «Actualizar información» sobraba: para ver lo nuevo alguien tenía que acordarse de pulsarlo.

**Qué cambia:**

1. **Cada «fin» de n8n que cierra una pasada** (los dos 200: completa o con textos fallidos) lanza una corrida con un origen nuevo, `sincronizacion` (migración 073, que conserva `boton` en el CHECK por las filas viejas). hub-api responde a n8n primero y no espera a la corrida; un fallo al lanzarla va al log, sin detalles, y a Sentry. Si ya hay una en curso (la de las 06:30), se omite y lo dice el log. Un «fin» con 404 o 409 no lanza nada.
2. **Se retiran** el botón, el método `actualizar()` del cliente y la ruta `POST /api/equipos-taller/actualizar` (ahora 404). Mientras corre una corrida, la cabecera dice «Actualizando…» como texto y la pantalla consulta cada 3 s; al terminar, pide los datos una vez más.
3. **Los textos** que mandaban a pulsar el botón (pantalla sin datos, ilegibles y el correo de la alerta) dicen ahora que se actualiza sola cada hora.

**No cambian** la corrida diaria (`programada`, 06:30), las reglas de los incidentes (§5.2: solo las programadas suman y avisan; una corrida `sincronizacion` fallida abre el incidente como lo hacía el botón, y una buena lo cierra), el núcleo, los ajustes ni los flujos de n8n. Las menciones al botón en el resto de este documento son de antes de esta revisión.

## Revisión del 10/11/2026: Drive vía n8n

**Por qué.** hub-api leía Google Drive con una cuenta de servicio de Google (la D3 original). En producción apareció el bloqueo: el Google Workspace de la empresa prohíbe compartir con cuentas externas, y las cuentas de servicio (`*.gserviceaccount.com`) no se pueden añadir a la lista de permitidas. La cuenta de servicio nunca vería las carpetas. El dueño aprobó la «opción B» el 10/11/2026.

**Qué cambia:**

1. **n8n lee Drive.** Un flujo nuevo, «Equipos · Sincronizar remisiones», corre cada hora con la credencial de Google Drive que n8n ya tiene (§3.4). Por cada una de las tres carpetas manda a hub-api el listado completo (id y nombre). hub-api le contesta qué archivos necesitan texto y n8n se lo manda:
   - **entradas:** el Google Doc de la remisión que hay dentro de cada carpeta, exportado como Markdown (lo mismo que hacía hub-api);
   - **salidas escaneadas:** el OCR del PDF (copia como Google Doc con OCR en español, exportación a texto y borrado de la copia).

   Si no puede leer un archivo concreto, manda su código de error. Al terminar manda «fin» con los conteos. La primera pasada es una carga completa (unos 190 PDF).
2. **hub-api guarda la copia** (migración 072) y la recibe por tres rutas protegidas con un token de máquina (§3.3).
3. **La corrida diaria lee la copia, no Google.** La copia se entrega al núcleo con la misma interfaz de fuentes, así que el núcleo no cambia. D5 se mantiene con una condición más: si la última sincronización completa tiene más de `EQUIPOS_SYNC_MAX_HORAS` horas (6 por defecto), la corrida falla.
4. **Sin ninguna sincronización completa,** el módulo queda «sin configurar» y la pantalla dice «Falta la primera sincronización con n8n».
5. **Se retira de hub-api** la lectura directa de Drive: `fuente-drive.ts`, la cuenta de servicio, las variables de las carpetas y el barrido de la carpeta temporal del OCR. El barrido lo hace ahora n8n al empezar cada pasada.

**No cambian** el núcleo y sus reglas, la pantalla (salvo los textos de «sin configurar» y de copia atrasada), los ajustes, los incidentes, la alerta ni la lectura de Desk 2.0.

## 1. Objetivo

Saber en todo momento qué equipos están **físicamente** dentro del taller de servicio técnico, ordenados por fecha de llegada. Para eso se cruzan las remisiones de entrada y de salida de Google Drive (la copia que manda n8n) con los tickets de Desk y sus comentarios.

El módulo ya existe como código TypeScript probado en `apps/equipos-desk2/`. Se escribió para Desk 2.0, pero **el portal y Desk 2.0 son independientes**: el módulo se integra en el portal, adaptado a su estructura y sin compromiso de compatibilidad con Desk 2.0.

**No cambian:** las reglas de negocio (§5 del prompt original, que queda en local), las vistas, los filtros, los ajustes manuales ni la pantalla. Esto no es un rediseño: solo cambian las fuentes, el almacén y el encaje en el portal.

## 2. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | App propia, con su tarjeta en el portal. Id de app: `equipos-taller`. | Es un dominio distinto al de Trazabilidad (calibraciones y agenda), con permisos propios, y la pantalla se traslada sin rediseño. |
| D2 | El motor vive en hub-api (`apps/hub-api/src/equipos/`). La pantalla, en la sub-app `apps/equipos-taller/`, que importa el núcleo por ruta relativa. | Es el patrón de Calibraciones: funciona con `tsc -b` y con el Dockerfile sin tocar el build. |
| D3 | **Drive lo lee n8n, no hub-api.** El flujo «Equipos · Sincronizar remisiones» lista las 3 carpetas cada hora con la credencial de Google Drive de n8n y manda a hub-api los listados y los textos. hub-api guarda la copia y la corrida diaria la lee. | El Workspace no deja compartir Drive con cuentas de servicio, y la credencial de n8n ya tiene acceso (revisión del 10/11/2026). *Antes: una cuenta de servicio de Google desde hub-api.* |
| D4 | Los tickets salen de `desk.tickets` y los comentarios de `desk.conversations`, en la base de Desk 2.0, por `getDesk2Pool()` (`DESK2_DB_URL`, rol `portal_agenda_reader`). **No se usa la API de Zoho.** | Zoho Desk deja de usarse el próximo año y Desk 2.0 conserva los datos. `desk.conversations` está completa desde el 02/11/2026. |
| D5 | **Sin réplica de respaldo.** No se actualiza (se conserva la última foto buena) si falla Desk 2.0, si la copia de Drive no se puede leer o si su última sincronización completa tiene más de `EQUIPOS_SYNC_MAX_HORAS` horas. Hay dos excepciones: un PDF concreto sin texto va a la lista de ilegibles, y una remisión de entrada sin texto se indica en los avisos sin hacer fallar la corrida (§5.1). | Nunca se muestra una clasificación hecha con datos incompletos, y una copia vieja es un dato incompleto. La réplica no tiene comentarios, así que con ella la regla 6 se apagaría sin avisar. |
| D6 | Alerta por un webhook de n8n, **una vez por incidente**, cuando hay 2 corridas programadas fallidas seguidas. | Evita el ruido de avisar en cada fallo. |
| D7 | Llaves por usuario: `edita_ajustes` y `recibe_alertas`. | Es el mismo modelo de llaves por ficha que usa Ausencias. |
| D8 | Las tablas van en el esquema `portal`, con prefijo `equipos_`. | Es la convención del portal, y el rol de hub-api ya es dueño de ese esquema. |
| D9 | Al repo solo van fixtures **anonimizadas**. Las reales y el prompt original se quedan en local, ignorados por git. | El repo es público y las fixtures reales llevan razones sociales y seriales de clientes. |
| D10 | La corrida **no usa la caché `exits` como entrada**: relee de la copia el OCR de todos los PDF. La caché `ent` (remisiones de entrada) sí se usa. | Releer un texto guardado es una consulta, no un OCR. Así, un PDF renombrado (lo que piden las ilegibles con fecha errada) o un texto que n8n vuelve a mandar se ve en la corrida siguiente. `ent` aporta el nombre del equipo a filas que ya no vuelven a pedir su remisión. |

## 3. Componentes

### 3.1 Backend: `apps/hub-api/src/equipos/`

| Fichero | Responsabilidad | Origen |
|---|---|---|
| `nucleo/tipos.ts`, `nucleo/reglas.ts`, `nucleo/actualizar.ts`, `nucleo/pantalla.ts` | Dominio puro, sin E/S: lectura de OCR, enlace con tickets, clasificación, ilegibles, ajustes, vistas, orden y filtros. **Es la única fuente de verdad de las reglas.** | Se copia de `packages/equipos/src`. Solo cambian los imports. |
| `sync.ts` | Lo que manda n8n: las tres carpetas, los límites y la validación estricta de los cuerpos. Puro. | Nuevo (revisión). |
| `repo-sync.ts` | La copia de Drive: listados (altas, nombres, borrados y qué texto falta), textos, pasadas, y lo que ve la corrida. | Nuevo (revisión). |
| `router-sync.ts` | Las rutas de n8n (§3.3), con token de máquina. Se montan dentro de `router.ts`. | Nuevo (revisión). |
| `fuente-n8n.ts` | Las fuentes de Drive que espera el núcleo, leídas de la copia. Un archivo sin texto es un `FalloArchivo` (A9). | Nuevo (revisión). Sustituye a `fuente-drive.ts` (cuenta de servicio, listado y OCR contra Google), que se retira. |
| `fuente-desk2.ts` | Lee los tickets (`desk.tickets.raw`, con la forma de la API de Zoho, campos `cf_*` incluidos) y los comentarios (`desk.conversations`), y los traduce a la forma que espera el núcleo. Si falla, lanza el error; no tiene respaldo. | Nuevo. Sustituye al espejo y a la API de Zoho. |
| `repo.ts` | Lectura y escritura de `portal.equipos_*` (salvo la copia de Drive). | Se adapta de `servidor/almacen-postgres.ts`. |
| `servicio.ts` | Una corrida: candado → Desk 2.0 → frescura de la copia → cálculo → foto. Registra la corrida y actualiza el incidente. | Se adapta de `servidor/servicio.ts`. |
| `incidente.ts` | Decisión **pura** de alerta, a partir de la última corrida, el origen y el estado del incidente. | Nuevo. |
| `alerta.ts` | Envía el correo de alerta por el webhook de n8n con su token. Sigue el patrón de `trazabilidad/envio-avisos.ts`. | Nuevo. |
| `programador.ts` | Corrida diaria a las 06:30, hora de Colombia. Se enciende siempre; antes de la primera sincronización, cada corrida programada se omite. | Mismo patrón que `trazabilidad/programador-pasadas.ts`. |
| `config.ts` | Variables de entorno: hora, alerta, token y frescura de la sincronización. | Se adapta de `servidor/config.ts`. |
| `router.ts` | Las rutas de la pantalla (§3.3). | Se adapta de `apps/desk/server/equipos/router.ts`. |
| `users/migrations/071_equipos_taller.sql`, `072_equipos_drive_n8n.sql` | Las tablas y vistas de §4. Son idempotentes y se registran en `db.ts`. | 071: se adapta de `sql/equipos.sql`. 072: nueva (revisión). |

### 3.2 Frontend

- **`apps/equipos-taller/`**: es la sub-app Vite. Lleva `EquiposServicio.tsx` y `api.ts`, que se trasladan **sin rediseño**. `api.ts` hace las peticiones con `VITE_HUB_API_URL` y `ambientalia_token`, como el resto de apps. Se añaden tres cosas:
  - el aviso de foto vieja (§5.3);
  - el panel de llaves, que solo ven los admin;
  - los botones de ajuste ocultos para quien no tenga `edita_ajustes`.
- **Portal**: ruta perezosa `/equipos-taller`, entrada en el Sidebar (vía `apps/portal/src/lib/apps.ts`) y en Aplicaciones (el Dashboard solo muestra widgets, así que no lleva tarjeta), el id de la app en la gestión de usuarios y el `COPY` del `package.json` de la sub-app en el `Dockerfile` raíz.

### 3.3 API

Las rutas de la pantalla van bajo `requireAuth` + `requireApp('equipos-taller')`.

| Ruta | Permiso extra | Respuesta |
|---|---|---|
| `GET /api/equipos-taller` | — | La foto, los ajustes, la última corrida, la última corrida buena, el estado del incidente, si el módulo está configurado (hay una sincronización completa de n8n) y las llaves del usuario. |
| `POST /api/equipos-taller/actualizar` | — | 202 si la corrida empieza, 409 si ya hay una en curso y 503 si el módulo está sin configurar. |
| `PUT /api/equipos-taller/ajustes/:clave` | `edita_ajustes` o admin | El ajuste guardado, firmado con el usuario y la fecha. |
| `DELETE /api/equipos-taller/ajustes/:clave` | `edita_ajustes` o admin | 204. |
| `GET /api/equipos-taller/llaves` | admin | Los usuarios que tienen la app y sus llaves. |
| `PUT /api/equipos-taller/llaves/:userId` | admin | Las llaves actualizadas, firmadas. |

**Rutas de n8n** (revisión). No llevan sesión: las protege un token de máquina con el patrón de WO-sales y Ausencias (`requireCronToken`: cabecera `X-Equipos-Sync-Token` contra `EQUIPOS_SYNC_TOKEN`; sin la variable, no pasa nadie).

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/equipos-taller/sync/listado` | `{ pasada, carpeta, archivos: [{ id, titulo }] }`, con el listado **completo** de una carpeta. | 200 `{ faltaTexto: [ids] }`: da de alta los nuevos, actualiza los nombres y marca `borrado` lo que ya no está. 409 si la pasada ya terminó, si hay otra pasada en curso o si el listado vaciaría la carpeta (o borraría más de la mitad y más de 10 archivos); también si movería así los de otra carpeta. El 409 sospechoso lleva `{ bajas, vivos, carpeta }`, con la carpeta que perdería los archivos. |
| `POST /api/equipos-taller/sync/texto` | `{ id, texto }` o `{ id, error: { status } }`. | 204; 404 si el archivo no está en la copia. |
| `POST /api/equipos-taller/sync/fin` | `{ pasada, conteos }`. | 200 `{ ok: true, completa: true }`; o 200 `{ ok: true, completa: false, motivo: 'textos_fallidos' }`, cerrada pero sin contar como fresca (ver abajo); 404 si la pasada no existe; 409 si ya terminó o le falta el listado de alguna carpeta. |

- `pasada` es el id de la ejecución de n8n, y `carpeta` es `entradas`, `salidas_n8n` o `salidas_escaneadas`.
- **Qué texto se pide:** solo en entradas y salidas escaneadas. Se pide el de un archivo nuevo, el de uno que cambió de nombre desde que llegó su texto (el viejo se sigue usando hasta que llega el nuevo) y, cada 6 horas, el de uno con fallo guardado.
- **Fallos que se guardan:** `status` solo admite un fallo de ese archivo, es decir, un 4xx que no sea 401 ni 429. Un fallo pasajero no se manda: el archivo queda pendiente y n8n lo pide en la pasada siguiente.
- **Textos fallidos:** como la corrida da por buenos los PDF que ya tienen texto (D10), un OCR roto para todo lo nuevo no la haría fallar. Por eso «fin» cierra la pasada como fallida (`motivo = 'textos_fallidos'`, no cuenta como fresca) si en entradas o en salidas escaneadas hay 2 o más archivos cuya racha de fallos empezó **en las últimas 24 horas** (reloj de la base) y en una pasada posterior a la del último texto bueno de esa carpeta. Se juzga por pasadas (un texto bueno en la misma pasada basta), una pasada sin resultados no lo limpia y lo limpia el primer texto bueno. Un par de archivos rotos de verdad deja de contar con un texto bueno posterior a su primer fallo o, sin él, a las 24 horas: sus reintentos no rejuvenecen la racha. Un OCR roto de verdad sigue detectado, porque cada archivo nuevo que falla abre una racha nueva. Si dura más de `EQUIPOS_SYNC_MAX_HORAS`, la corrida falla con su propia causa, `drive: n8n no pudo leer los textos de Drive (OCR)` (§5.1), y salta la alerta (§5.2).
- **Validación estricta:** ids con la forma de Drive, sin repetidos; hasta 10 000 archivos por listado; nombres de hasta 300 caracteres; los textos se recortan a 200 000. Cabe en el límite de 2 MB del servidor.

### 3.4 Flujo de n8n «Equipos · Sincronizar remisiones»

Corre cada hora con la credencial de Google Drive de n8n. Los IDs de las carpetas viven solo en el flujo (nodo «Configuración»), nunca en el repo.

1. **Barrido:** borra de la carpeta temporal del OCR las copias `ocr-tmp-*` que hayan quedado de pasadas anteriores.
2. **Por cada carpeta,** en este orden: entradas, salidas generadas por n8n, salidas escaneadas.
   1. Lista la carpeta entera (todas las páginas) y manda el listado.
   2. Por cada id de `faltaTexto`:
      - **Entradas:** exporta como Markdown el primer Google Doc de la carpeta (texto vacío si no hay ninguno).
      - **Salidas escaneadas:** copia el PDF como Google Doc con OCR en español, exporta la copia a texto plano y borra la copia pase lo que pase.
   3. Manda el texto o, si el fallo es de ese archivo, su código.
3. **Fin:** manda «fin» con los conteos. Si antes falla un listado o su envío, la pasada se queda sin «fin» y no cuenta.

Se crea **inactivo y sin credenciales**: el usuario le pone la credencial de Drive y crea la credencial Header Auth del token. El contrato completo está en `docs/equipos-taller.md`.

## 4. Modelo de datos (esquema `portal`)

- **`equipos_estado`**: `clave text PK`, `valor jsonb`, `actualizado_en`. Las claves son:
  - `foto`: las filas y las ilegibles. Se conservan las claves cortas de JSON (`d`, `c`, `sn`, `est`, `src`, `why`, `x`, `z`, `zc`, `pa`, `xd`, `eq`).
  - `exits`: la caché del texto de OCR. **Su versión sigue siendo CV = 3**. Desde la revisión la corrida no la usa como entrada (D10): solo la guarda una corrida buena, completa. Una fallida no la toca, porque la suya tendría solo parte de los PDF.
  - `ent`: las entradas ya leídas.
  - Ya no hay caché de comentarios (`cmt`), porque se leen en cada corrida.
- **`equipos_ajuste`**: `clave text PK`, `tipo` (`in`/`out`/`ret`/`pdf`), `nota`, `user_id`, `usuario`, `creado_en`. No tiene columna `hasta`: un ajuste dura hasta que alguien lo deshace. Los formatos de clave no cambian: `SERIAL_cls|AAAA-MM-DD`, `*SERIAL_cls` y `pdf:<idDrive>`.
- **`equipos_ejecucion`**: `id`, `origen` (`programada`/`boton`), `user_id`, `inicio`, `fin`, `en_curso`, `ok`, `causa`, `avisos jsonb`, `conteos jsonb`. Lleva un índice único parcial sobre `en_curso` que impide dos corridas a la vez.
- **`equipos_incidente`**: `id`, `abierto_en`, `cerrado_en`, `fallos_programados`, `alerta_enviada_en`, `alerta_ultimo_error`. Como mucho hay un incidente abierto.
- **`equipos_llaves`**: `user_id PK` (FK a `portal.users`), `edita_ajustes`, `recibe_alertas`, `actualizado_por`, `actualizado_en`.
- **`equipos_drive_archivos`** (072): la copia de Drive, con un archivo o carpeta por fila.
  - `id` (el de Drive, PK), `carpeta` y `titulo`.
  - `texto`: NULL hasta que llega; un texto vacío es válido (carpeta de entrada sin documento).
  - `titulo_texto`: el nombre que tenía el archivo cuando llegó su texto.
  - `error_status`: el fallo de ese archivo.
  - `texto_sync`, `error_sync` y `error_desde`: la pasada en la que llegó su último texto, y la pasada y la hora en que empezó su racha de fallos (para los textos fallidos, §3.3).
  - `texto_en`, `borrado`, `creado_en` y `actualizado_en` (el último cambio del listado).
  - La base comprueba la forma del id, la carpeta y que `salidas_n8n` no lleve texto.
- **`equipos_sincronizacion`** (072): una fila por pasada de n8n.
  - `pasada` (el id de la ejecución, único), `inicio`, `fin` y `ok`.
  - `motivo`: por qué no vale una pasada cerrada (`abandonada`, `tardia` o `textos_fallidos`); NULL si vale.
  - `listados`: carpeta → archivos recibidos.
  - `conteos`: los que manda «fin».
  - Una pasada sin «fin» de más de 2 horas se cierra como fallida cuando empieza otra. Hasta entonces, no puede empezar otra.
- **Vistas** `equipos_v_equipos` y `equipos_v_remisiones_ilegibles`, para consultar en psql.

**Las migraciones no siembran ni permisos ni apps.** Las migraciones se vuelven a ejecutar en cada arranque, así que una semilla devolvería permisos que un admin hubiera quitado.

## 5. Flujo de una corrida y fallos

### 5.1 Pasos

1. **Candado.** Sin ninguna sincronización completa de n8n, la respuesta es «sin configurar» (503) y no se registra nada. Si la hay, se inserta la corrida con `en_curso`. Si choca con el índice único, la respuesta es 409 «ya se está actualizando».
2. **Desk 2.0.** Si falla, la corrida termina como fallida, con la causa `desk2: <motivo>`.
3. **Frescura de la copia de Drive.** Si la última sincronización completa de n8n tiene más de `EQUIPOS_SYNC_MAX_HORAS` horas (6 por defecto), la corrida falla con la causa `drive: sincronización de n8n atrasada`. Si la última pasada cerrada lo fue con `motivo = 'textos_fallidos'` (§3.3), la causa es `drive: n8n no pudo leer los textos de Drive (OCR)`: n8n sí sincroniza, pero no puede leer los textos. La regla de frescura es la misma. Cuenta para el incidente como cualquier otra corrida programada fallida.
4. **Copia de Drive.** La corrida ve la copia tal como la dejó la última pasada completa:
   - Sin los archivos borrados en Drive.
   - Sin los que trajo una pasada posterior y todavía no tienen texto.
   - El OCR de todos los PDF se relee de la copia (D10). Las remisiones de entrada se leen solo si no están en la caché `ent`.
   - Los tres listados y el OCR de los PDF se leen en **una sola instantánea** (REPEATABLE READ, solo lectura). Una pasada que aplica un listado mientras la corrida lee no puede dejar un archivo en dos carpetas, ni en ninguna.
   - Si la copia no se puede leer (falla la base), la corrida falla con `interno: no se pudo leer la copia de Drive`.
   - **Excepción (decisión del 10/11/2026): un archivo concreto sin texto no hace fallar la corrida.** Es un archivo cuyo fallo guardó n8n (un 4xx que no sea 401 ni 429), o cuyo texto no llegó en la última pasada completa.
     - **Un PDF** va a la lista de remisiones ilegibles con el motivo «sin texto legible» (regla 11). La explicación es «Google Drive no pudo convertir este PDF a texto (HTTP <código>)» o «n8n todavía no ha enviado el texto de este PDF».
     - **Una remisión de entrada:** el equipo sigue contando como entrada, porque la fecha, el cliente y el serial salen del nombre de la carpeta. Se pierde lo que aporta el documento (el número de ticket y el nombre del equipo), y el enlace con el ticket sigue con las reglas 2 a 4. La corrida lo indica en sus avisos.
     - Nada de eso entra en la caché, así que se reintenta en cada corrida. n8n vuelve a pedir cada 6 horas el texto de un archivo con fallo.
     - Si fallan **todos** los intentados (2 o más) y ninguno sale, la corrida falla con `drive: no se pudo convertir ningún PDF (…)` o `drive: no se pudo leer ninguna remisión de entrada (…)`.
5. **Cálculo.** Se aplican el núcleo y los ajustes. La foto y el cierre de la corrida se escriben **en una sola transacción**.

Una corrida fallida **nunca** modifica `foto`. La siguiente corrida es el reintento.

**Las causas no llevan secretos.** Nunca incluyen la URL de la base, un token ni el error crudo de `pg` o de Google. Se registran con `enmascararUrl` y mensajes saneados, como en `db-desk2.ts`.

*Histórico: antes de la revisión, el paso 3 era el barrido de las copias `ocr-tmp-*` de la carpeta temporal, y el paso 4 leía Drive con la cuenta de servicio, con OCR solo de los PDF que no estaban en la caché.*

### 5.2 Incidentes y alerta

- **Abrir:** la primera corrida fallida después de una buena abre el incidente.
- **Contar:** solo suman a `fallos_programados` las corridas **programadas**. Las del botón no cuentan.
- **Avisar:** cuando `fallos_programados` llega a 2 y todavía no hay `alerta_enviada_en`, se envía la alerta.
- **Si el envío falla:** se guarda `alerta_ultimo_error` y se reintenta en la siguiente corrida programada del mismo incidente.
- **Cerrar:** una corrida buena cierra el incidente. Si después vuelve a fallar, se abre uno nuevo y se puede avisar otra vez.
- **Destinatarios:** los usuarios activos con `recibe_alertas`. Si no hay ninguno, la dirección de reserva, comercial@ambientalia.com.co, configurable.
- **En n8n:** una barrera de dominio solo deja salir a direcciones `@ambientalia.com.co`.
- **Sin las variables `EQUIPOS_ALERTA_WEBHOOK_URL` y `EQUIPOS_ALERTA_TOKEN`:** la alerta queda apagada y se registra en el log.
- **Si n8n deja de sincronizar:** no hace falta un aviso aparte. Las corridas programadas fallan por copia atrasada y, a la segunda, sale la alerta.

### 5.3 Aviso en pantalla

| Estado | Aviso |
|---|---|
| La última corrida falló | «No se pudo leer Desk 2.0», «No se pudo leer Google Drive», «La copia de Google Drive (n8n) está atrasada» o «n8n no pudo leer las remisiones de Drive», seguido de «; datos del <fecha y hora de la foto buena>». |
| Incidente con 2 o más corridas programadas fallidas | El mismo aviso, **destacado**. |
| Módulo sin configurar (ninguna sincronización completa de n8n) | «Falta la primera sincronización con n8n». El botón «Actualizar información» queda desactivado. |

## 6. Permisos

| Acción | Quién |
|---|---|
| Abrir la app, ver las pestañas, filtrar y pulsar «Actualizar información» | Quien tenga la app `equipos-taller`, y los admin. |
| Ajustes manuales: «Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste» y «Ya revisada» | La llave `edita_ajustes`, o ser admin. |
| Gestionar las llaves | Los admin. |
| Recibir la alerta | La llave `recibe_alertas`. Se asigna explícitamente y los admin no la tienen por defecto. |
| Mandar la copia de Drive | Solo n8n, con el token `EQUIPOS_SYNC_TOKEN`. |

El servidor comprueba cada llave; la pantalla solo oculta los botones.

**Asignación inicial**, que se hace a mano tras el despliegue: el Director Comercial y el Director Técnico reciben la app, `edita_ajustes` y `recibe_alertas`.

## 7. Configuración (variables de hub-api)

| Variable | Uso |
|---|---|
| `EQUIPOS_SYNC_TOKEN` | El token de máquina de las rutas de n8n (cabecera `X-Equipos-Sync-Token`). Es el mismo valor que la credencial Header Auth del flujo. Sin él, n8n no puede mandar la copia (lo dice el log al arrancar) y el módulo sigue «sin configurar». |
| `EQUIPOS_SYNC_MAX_HORAS` | La antigüedad máxima de la última sincronización completa, en horas enteras de 1 a 168. Por defecto, 6. |
| `EQUIPOS_HORA_DIARIA` | La hora de la corrida diaria. Por defecto, `06:30` en America/Bogota. |
| `EQUIPOS_ALERTA_WEBHOOK_URL`, `EQUIPOS_ALERTA_TOKEN`, `EQUIPOS_ALERTA_RESERVA` | La alerta (§5.2). |
| `DESK2_DB_URL` | Ya existe, y es la misma que usa Trazabilidad. Si falta, todas las corridas fallan con `desk2: sin configurar`. |

Ya no existen `EQUIPOS_GOOGLE_CUENTA_SERVICIO` ni `EQUIPOS_DRIVE_*`: los IDs de las carpetas viven solo en el flujo de n8n.

⚠️ **`EQUIPOS_SYNC_TOKEN` es un secreto.** Mientras EasyPanel siga imprimiendo las variables en el log de build, se trata con el mismo cuidado que el resto, y entra en la rotación de secretos pendiente.

## 8. Pruebas

Se hacen con Vitest. **El código nuevo se escribe en TDD estricto.** Las pruebas de hub-api se ejecutan desde `apps/hub-api`, no desde la raíz.

- **Núcleo:** se trasladan las pruebas de reglas, actualización y pantalla, con fixtures **anonimizadas**. Los clientes y seriales se sustituyen de forma determinista, y se conservan los casos difíciles del OCR: el serial deformado, los ceros a la izquierda, O/0, I/1, S/5, T/7, B/8, el serial sin dígitos, la remisión ilegible y el PDF con fecha futura. Una suite **solo local** con las fixtures reales se salta sola si los ficheros no están.
- **`fuente-desk2`:** con una base falsa. Cubre que los `cf_*` lleguen bien, la forma de los comentarios y que un error se propague sin respaldo.
- **Copia de Drive** (revisión):
  - `sync`, puro: la validación de los tres cuerpos y la regla del listado sospechoso.
  - `repo-sync`, contra Postgres: altas, nombres, borrados, qué texto se pide, pasadas y lo que ve la corrida.
  - `router-sync`, con Express real: el token, los 400, 404 y 409, y un listado de 10 000 archivos.
  - `fuente-n8n`, con un repositorio falso: textos, fallos y pendientes.
- **`incidente`** (puro): 1 fallo no avisa; 2 programados avisan; las corridas del botón no cuentan; se avisa una sola vez; el reintento si el webhook falla; el cierre y la nueva alerta tras recuperarse.
- **`servicio`:** una corrida fallida no toca `foto` ni `exits`; el 409 con el candado; «sin configurar» sin sincronización; la copia atrasada; los archivos sin texto (A9).
- **Router:** con Express real. Las llaves, el 403 sin la app o sin la llave, el 503 sin configurar.
- **Migraciones y repositorios:** en `*.db.test.ts`, contra el Postgres de pruebas. Cada migración debe poder ejecutarse dos veces sin cambiar nada.
- **Pantalla:** prueba de React con jsdom en la sub-app. Cubre los avisos y los botones ocultos sin la llave.

## 9. Puesta en marcha

1. **Requisitos, que hace Gerencia:**
   - `GRANT SELECT ON desk.conversations TO portal_agenda_reader;` (`desk.ticket_transitions` ya está concedido).
   - Una carpeta temporal para el OCR en el Drive de la cuenta de la credencial de n8n, con permiso de edición para esa cuenta.
   - Crear el flujo de n8n «Equipos · Alerta de foto vieja», **inactivo**, con su token y la barrera de dominio.
2. **Desplegar hub-api** (migración 072 y rutas de n8n) y cargar `EQUIPOS_SYNC_TOKEN`. Justo después, desplegar el portal. Si se habían cargado las variables de Drive de la versión anterior, se quitan.
3. **Crear el flujo «Equipos · Sincronizar remisiones»** (§3.4), **inactivo y sin credenciales**. El usuario le pone la credencial de Drive, crea la credencial Header Auth con el token y rellena «Configuración» (los IDs de las carpetas y la URL de hub-api).
4. **Primera pasada:** se ejecuta el flujo a mano una vez. Es la carga completa (unos 190 PDF con OCR) y tarda un buen rato. Se comprueba en psql que la pasada terminó con `ok = true` y, después, se activa el flujo.
5. **Asignar** a mano la app y las llaves (§6).
6. **Primera corrida:** se lanza con el botón.
7. **Validar en paralelo, el mismo día:** comparar la pestaña «En taller» y la lista de ilegibles con la página de Claude. La referencia del 7–9/11/2026 es de 21 equipos en taller (19 GRIMM y 2 Horiba). Si hay diferencias por el orden del texto del OCR, se corrigen en el núcleo.
8. **Retirar la página de Claude** solo cuando coincidan las dos. Hasta entonces, `claude/build.mjs` se construye desde `apps/hub-api/src/equipos/nucleo/`.
9. **Limpiar** `apps/equipos-desk2/`: se eliminan `apps/desk`, `apps/hub-sync` y `packages/equipos`. `Prompt.txt` y las fixtures reales se quedan en local.
10. **Borrar la cuenta de servicio de Google y su clave,** que ya no se usan.

## 10. Fuera de alcance y pendientes

- **Enero de 2027.** En los tickets nacidos en Desk 2.0, la recogida es la transición «Entrega al cliente», no un comentario. Hay que revisar la regla 6 (con `desk.ticket_transitions`) antes de que esos tickets empiecen a cerrarse.
- **Posible fuente futura.** El `public.remisiones` de Desk 2.0 podría sustituir a la lectura de las carpetas de entrada. No se hace ahora.
- **Ajustes de la página de Claude.** No se migran: son pocos y se rehacen en la pantalla nueva.
- **Pendientes de Ambientalia sobre los datos.** Equipos sin ticket que hay que verificar físicamente, tickets que hay que corregir en Zoho y PDF mal nombrados. Siguen su curso fuera de este desarrollo.
- **La caché `ent` no se invalida.** Si n8n vuelve a mandar la remisión de una entrada ya leída (por ejemplo, porque cambió el nombre de la carpeta), la corrida sigue con la primera lectura, igual que antes de la revisión.
