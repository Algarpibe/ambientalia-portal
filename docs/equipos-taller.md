# Equipos en taller

Qué equipos están **físicamente** dentro del taller de servicio técnico, ordenados por fecha de llegada. Cruza las remisiones de entrada y de salida de Google Drive (la copia que manda n8n cada hora) con los tickets de Desk 2.0 y sus comentarios. Diseño: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`, con la revisión «Drive vía n8n» del 10/11/2026 y la de «se actualiza sola» del 11/11/2026.

**No hay botón para actualizar.** La pantalla se actualiza sola: cada vez que n8n termina una pasada de la copia de Drive (cada hora), hub-api lanza una corrida. Además está la diaria de las 06:30.

- **App del portal:** `equipos-taller` (ruta `/equipos-taller`, sub-app `apps/equipos-taller`). Aparece en la barra lateral (`apps/portal/src/lib/apps.ts`) y en Aplicaciones; **no** tiene tarjeta en el Dashboard.
- **Motor:** `apps/hub-api/src/equipos/`. Las reglas viven SOLO en `nucleo/` (puro, sin E/S); la pantalla lo importa por ruta relativa.
- **Datos:** `portal.equipos_*` (migraciones 071, 072 y 073). Para psql: `portal.equipos_v_equipos` y `portal.equipos_v_remisiones_ilegibles`.

## De dónde sale cada dato

**Desk 2.0** (`apps/hub-api/src/equipos/fuente-desk2.ts`, solo lectura, mismo pool que Trazabilidad):

- **Campos `cf_*`:** cada uno se rellena en este orden: `raw.cf`, luego `custom_fields` por etiqueta y luego la columna tipada promovida. En los tickets `managed_by_app` el orden se invierte: primero `custom_fields` y columnas, y `raw.cf` al final. El estado, la fecha de modificación y la de cierre de un ticket gestionado salen de las columnas.
- **Comentarios:** `desk.conversations` con `kind = 'comment'`, los 15 más recientes (`commented_time DESC NULLS LAST`).
- **Etiquetas comprobadas** en la base de Desk 2.0 el 10/11/2026:
  - `custom_fields` guarda «Serial1», «Serial2» y «Serial3» (sin espacio). La búsqueda por etiqueta ignora los separadores, así que coinciden con `cf_serial1` a `cf_serial3`.
  - «Equipo» (`cf_equipo_1`) no aparece en `custom_fields` porque Desk 2.0 lo pasa a la columna `equipo`, que es de donde se lee.
  - «Equipo1» a «Equipo3» son otros campos (los de las remisiones con varios equipos) y el núcleo no los usa.

**Drive, vía n8n.** hub-api no habla con Google: el Workspace de la empresa no deja compartir Drive con cuentas de servicio. El flujo de n8n «Equipos · Sincronizar remisiones» (abajo) lista cada hora las tres carpetas: entradas, salidas generadas por n8n y salidas escaneadas. Manda a hub-api los nombres y los textos, que se guardan en `portal.equipos_drive_archivos` (la copia). Cada pasada queda en `portal.equipos_sincronizacion`.

- **Qué ve la corrida:** la copia tal como la dejó la **última pasada completa**, sin lo borrado en Drive y sin los archivos pendientes de texto que cambiaron después del «fin» de esa pasada (los trajo una pasada que aún no ha terminado). Los tres listados y el OCR de los PDF se leen en **una sola instantánea** (transacción `REPEATABLE READ` de solo lectura), así que una pasada que llega a mitad no parte la vista.
- **Texto de una remisión de entrada:** el primer Google Doc de la carpeta, exportado como Markdown. Si no hay documento, es un texto vacío.
- **Texto de una salida escaneada:** el OCR. n8n copia el PDF como Google Doc con OCR en español, lo exporta a texto y borra la copia.
- **Salidas generadas por n8n:** solo el listado; no llevan texto.
- **Qué texto pide hub-api** (`faltaTexto`, solo en entradas y salidas escaneadas): el de lo nuevo; el de lo que cambió de nombre desde que llegó su texto (mientras llega el nuevo, vale el viejo); y, cada 6 h, el de lo que tiene un fallo guardado.

## Una corrida

1. **Candado.**
   - Sin ninguna sincronización completa de n8n, la corrida se omite («sin configurar») y no se registra nada.
   - Si no, se inserta la corrida «en curso» (`portal.equipos_ejecucion`). Si ya hay otra, se omite («ocupado»): pasa, por ejemplo, si llega un «fin» de n8n mientras corre la de las 06:30.
   - Una corrida colgada más de 180 min se da por abandonada. Hasta entonces, si el proceso murió a mitad (caída o despliegue), las corridas nuevas se omiten. El indicador «actualizando» caduca con esos mismos 180 min.
2. **Desk 2.0:** una sonda de `desk.tickets` y `desk.conversations`. Si falla → `desk2: <motivo>`.
3. **Frescura de la copia:** si la última pasada completa de n8n tiene más de `EQUIPOS_SYNC_MAX_HORAS` (6 h por defecto) → `drive: sincronización de n8n atrasada`. Si, además, la última pasada **cerrada** terminó con `motivo = 'textos_fallidos'`, la causa es `drive: n8n no pudo leer los textos de Drive (OCR)`.
4. **Copia de Drive y núcleo:** se leen los listados de la copia, el OCR de **todos** los PDF y las remisiones de entrada que no están en la caché `ent`. Luego, los tickets por serial y los comentarios de los equipos que siguen adentro.
   - El OCR se relee de la copia: la caché `exits` no se usa como entrada, porque releer es una consulta. Así, un PDF renombrado se ve con su nombre nuevo.
   - Cualquier fallo de una fuente hace fallida la corrida. Una corrida fallida **no escribe** la caché `exits`: la suya tendría solo parte de los PDF y pisaría la buena. Solo la escribe una corrida buena.
   - **Excepciones:**
     - Un PDF sin texto en la copia (n8n guardó su fallo, o el texto aún no llegó) va a remisiones ilegibles y se reintenta en cada corrida.
     - Una remisión de ENTRADA sin texto genera un aviso. La entrada se cuenta igual y se reintenta.
     - Solo si fallan **todos** los intentados (2 o más), la corrida falla.
5. **Foto:** la foto y el cierre de la corrida, en una transacción.

Una corrida fallida **nunca** toca la foto: la pantalla sigue con la última buena. Una corrida abandonada (180 min) tampoco sobrescribe nunca una foto más nueva, y no cuenta para los incidentes. La siguiente corrida es el reintento.

**Aviso de foto vieja en pantalla:**
- Se calcula con la última corrida **terminada**, no con la que está en curso, para que no desaparezca mientras corre.
- Sin ninguna sincronización completa, dice «Falta la primera sincronización con n8n».
- Con la copia atrasada dice «La copia de Google Drive (n8n) está atrasada; datos del …».
- Con la causa de textos fallidos dice «n8n no pudo leer las remisiones de Drive; datos del …».
- El detalle del último error de la alerta (`alertaUltimoError`) solo lo reciben los admin.

| Causa | Qué mirar |
|---|---|
| `desk2: sin configurar` | Falta `DESK2_DB_URL` en hub-api. |
| `desk2: sin conexión` / `tiempo agotado` | La base de Desk 2.0 no responde (mismo pool que Trazabilidad: 3 s para conectar, 5 s por consulta). |
| `desk2: consulta rechazada (permisos o esquema)` | Falta el `GRANT SELECT ON desk.conversations TO portal_agenda_reader`, o cambió una columna. |
| `drive: sincronización de n8n atrasada` | n8n lleva más de `EQUIPOS_SYNC_MAX_HORAS` sin terminar una pasada **que valga**. Mirar las ejecuciones del flujo en n8n y `portal.equipos_sincronizacion` (abajo, columna `motivo`). Puede ser una credencial de Drive caducada, el flujo desactivado, un `EQUIPOS_SYNC_TOKEN` distinto del de la credencial Header Auth (401), un listado rechazado (409) o una pasada que tardó más de 2 h (`pasada_tardia`). |
| `drive: n8n no pudo leer los textos de Drive (OCR)` | n8n sincroniza, pero la copia lleva más de `EQUIPOS_SYNC_MAX_HORAS` sin una pasada que valga y la última pasada cerrada acabó con `motivo = 'textos_fallidos'`. Es la regla de abajo: el OCR o la exportación fallan en todo lo nuevo. Mirar `error_status` en `portal.equipos_drive_archivos` y las ejecuciones del flujo. En pantalla: «n8n no pudo leer las remisiones de Drive». |
| `drive: no se pudo convertir ningún PDF (HTTP 4xx)` | Todos los PDF intentados tienen un fallo guardado. Casi siempre, la cuenta de n8n no puede editar la carpeta temporal del OCR. Un solo PDF que falla no aparece aquí: sale en remisiones ilegibles. |
| `drive: no se pudo convertir ningún PDF (texto pendiente de n8n)` | n8n listó los PDF pero no mandó sus textos (mirar sus ejecuciones). |
| `drive: no se pudo leer ninguna remisión de entrada (…)` | Lo mismo, con las remisiones de entrada. |
| `interno: no se pudo leer la copia de Drive` | Falló la consulta a `portal.equipos_drive_archivos` (la base de hub-api). |

**Regla de los textos fallidos.** La corrida da por buenos los PDF que ya tienen texto, así que un OCR roto solo para lo nuevo no la haría fallar. Lo vigila el «fin» de cada pasada:
- Cada texto apunta la pasada en la que llegó, y cada racha de fallos de un archivo, la pasada y la hora en que empezó (los reintentos no la mueven).
- Si en entradas o en salidas escaneadas hay **2 o más** archivos cuya racha empezó en las últimas **24 h** y en una pasada posterior a la del último texto bueno de esa carpeta, la pasada se cierra con `ok = false` y `motivo = 'textos_fallidos'`. No cuenta como fresca.
- Se limpia con el primer texto bueno de esa carpeta. Un par de archivos rotos de verdad deja de contar a las 24 h.

### Si el servidor cayó o se redesplegó a mitad de una corrida

La corrida queda «en curso» en la base y nadie la cierra. Hasta que pasan los 180 min, las corridas nuevas (la de cada hora y la diaria) se omiten y la pantalla sigue en «Actualizando…».

Para liberarla antes, el dueño puede ejecutar esto en psql. Solo marca como abandonadas las corridas que siguen «en curso» y llevan más de 10 minutos (es el mismo `UPDATE` que usa `repo.ts`, con 10 en vez de 180). Ejecútalo **solo si no hay una corrida realmente en marcha**:

```sql
UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = false, causa = 'abandonada' WHERE en_curso AND inicio < now() - make_interval(mins => 10);
```

La foto no se toca y la corrida abandonada no cuenta para los incidentes.

### Notas de operación

- **Límites de Drive.** Drive informa de los límites de uso como 429, o como 403 con motivo `rateLimitExceeded` o `userRateLimitExceeded`. El flujo no los manda como fallo del archivo: el archivo se pide en la pasada siguiente. Otro 403 de un archivo (por ejemplo, demasiado grande para exportarlo) sí se guarda, y se vuelve a pedir cada 6 h. Mientras, el PDF sale como «sin texto legible».
- **Límite de peticiones de hub-api.** `/api/` admite 60 peticiones por minuto y por IP, y todas las de n8n salen de la misma. Por eso el flujo hace una pausa de 1 s antes de cada envío de texto y reintenta los 429.
- **Pool de Desk 2.0.** El pool tiene 2 conexiones y las comparte con Trazabilidad. Si aparece `desk2: tiempo agotado`, esa es la causa más probable.

## Corrida de cada hora, corrida diaria e incidentes

- **Cada hora (origen `sincronizacion`):** cada «fin» que cierra una pasada de n8n (los dos 200: completa o con textos fallidos) lanza una corrida.
  - hub-api responde a n8n **antes** y no espera a la corrida: ni lo que tarde ni un fallo cambian la respuesta. Un fallo al lanzarla va al log («no se pudo lanzar la corrida», sin detalles) y a Sentry.
  - Si ya hay una en curso (por ejemplo, la de las 06:30) o falta configurar, se omite y lo dice el log: «corrida tras la sincronización omitida (ya hay una en curso)» o «(falta configurar)».
  - Un «fin» con 404 o 409 no lanza nada.
- **Diaria (origen `programada`):** a las `EQUIPOS_HORA_DIARIA` de Colombia (06:30 por defecto). No hay corrida de recuperación al arrancar: si un despliegue cae después de la hora, la corrida de cada hora cubre el hueco.
- **Programador:** se enciende siempre. Mientras no haya ninguna sincronización completa, cada corrida programada se omite (lo dice el log: «corrida programada omitida (falta configurar)») y no cuenta para los incidentes.
- **Incidente:**
  - Lo abre la primera corrida fallida tras una buena, sea programada o de cada hora.
  - Solo las corridas **programadas** suman fallos. Con 2 seguidos se envía **una** alerta. Las de cada hora nunca suman ni avisan.
  - Si el envío falla, se guarda el error (`alerta_ultimo_error`) y se reintenta en la siguiente programada.
  - Una corrida buena lo cierra, sea programada o de cada hora.
  - Si n8n deja de sincronizar, las corridas programadas fallan por copia atrasada y, a la segunda, sale la alerta.
- **Destinatarios:** solo los usuarios **activos** que sean admin o tengan la app, **y** tengan la llave «recibe alertas». Si no hay ninguno, `EQUIPOS_ALERTA_RESERVA` (por defecto comercial@ambientalia.com.co). Solo direcciones `@ambientalia.com.co`.

```sql
-- Últimas corridas y el incidente abierto. origen: 'sincronizacion' (cada hora), 'programada' (la diaria)
-- o 'boton' (filas de antes del 11/11/2026, cuando había botón).
SELECT id, origen, inicio, fin, ok, causa FROM portal.equipos_ejecucion ORDER BY id DESC LIMIT 10;
SELECT * FROM portal.equipos_incidente WHERE cerrado_en IS NULL;
```

## Pantalla

Vistas, columnas, motivos y ajustes manuales vienen de la herramienta original. Los filtros **Cliente**, **Estado en Desk**, **Sin ticket** y **Quitar filtros** se portaron de la versión nueva del original (`nucleo/pantalla.ts`).

`RETIRADOS_FIJOS` está **vacío a propósito**. Tras el despliegue hay un caso conocido que debe volver a marcarse a mano con «Marcar retirado».

**Sin botón «Actualizar información»** (retirado el 11/11/2026): la pantalla se actualiza sola con la corrida de cada hora. Mientras corre una corrida, la cabecera dice «Actualizando…» (texto, no botón) y la pantalla consulta cada 3 s hasta que termina; entonces pide los datos una vez más. Sin datos todavía, dice «Se actualiza sola cada hora, cuando termina la sincronización con n8n.».

## Tablero kanban

Una vista más sobre la misma foto, **de solo lectura** (cambio SDD `tablero-kanban-taller`, 11/11/2026). La tabla no cambia.

| Dónde | Qué |
|---|---|
| Botones «Tabla \| Tablero» de la app (`?vista=tablero`) | El tablero dentro del portal, para todos los que tienen la app. Con el tablero a la vista salen los botones «Día \| Noche»: Día por defecto, y cada dispositivo recuerda el que se eligió (en el navegador). No sigue la hora ni el tema de la TV. |
| `/equipos-taller/tv` | La TV: pantalla completa, con sesión o con llave de kiosco. Tema según el ajuste «Tema de la TV» (Día por defecto); `?tema=` manda en cada TV. Guía: [equipos-taller-kiosco.md](equipos-taller-kiosco.md). |
| `/equipos-taller/mis-equipos` | «Mis equipos» en el móvil: los equipos del técnico, agrupados por columna. Le reconoce por el nombre del portal; si no coincide con ningún responsable de Desk, o con varios, pregunta «¿Quién eres?» y el móvil lo recuerda. Sin botones de cambio de estado. |

- **Columnas** (`nucleo/taller-columns.ts`): Entrada – Remisión (sin ticket, Ticket creado, OV asignada, Remisión creada), Rev. / Diagnóstico, Notificación cliente, En proceso, Servicio externo y Por entregar. El reparto de los 26 estados de Desk está en ese archivo; una prueba falla si alguno queda sin columna. Un estado desconocido va a Rev. / Diagnóstico con una etiqueta que lo nombra.
- **Tarjetas**: solo las filas «En taller» y «Servicio externo», ya con los ajustes manuales aplicados. La suma de las columnas es igual a esos dos contadores. Las de «Servicio externo» van a su columna sea cual sea el estado del ticket.
- **Contadores**: los mismos `VISTAS` de la tabla (`nucleo/taller-board.ts`). Cuáles 5 se ven se elige en Ajustes.
- **Días**: de calendario, desde la entrada hasta hoy en Bogotá. Semáforo verde / ámbar / rojo con los umbrales de Ajustes (30 y 90 por defecto).
- **Ajustes** (solo admin): Ajustes → «Equipos en taller · Tablero» (umbrales, tema de la TV, horas del tema noche, 5 contadores) y «Equipos en taller · Kiosco» (llaves de la TV). Se guardan en `portal.equipos_tablero_config` (una fila) y `portal.equipos_kiosco` (migración 074).
- **Tema de la TV**: Día (por defecto), Noche o Automático (por horario). Las horas de noche solo cuentan en Automático. Columna `tema_tv` de `portal.equipos_tablero_config` (migración 075; la fila que ya hubiera queda en Día). Viaja en `tablero` de `GET /api/equipos-taller` y en `ajustes` de la respuesta de kiosco, así que hub-api se despliega antes que el portal.
- **Datos de la TV con llave**: `GET /api/equipos-taller/kiosco/tablero`, cabecera `X-Kiosk-Token`. Devuelve solo el tablero ya armado; ninguna otra ruta acepta la llave.

## Permisos

| Acción | Quién |
|---|---|
| Abrir y filtrar | Quien tenga la app `equipos-taller`, y los admin. |
| Ajustes manuales («Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste», «Ya revisada») | La llave `edita_ajustes`, o ser admin. |
| Gestionar las llaves (Ajustes → «Equipos en taller · Llaves») | Solo los admin. Las llaves solo se pueden dar a usuarios **activos** que tengan la app (o sean admin). Las casillas no guardan solas: cada fila se guarda con su botón «Guardar». |
| Recibir la alerta | La llave `recibe_alertas` (los admin no la tienen por defecto), con el usuario activo y con la app o admin. |
| Mandar la copia de Drive | Solo n8n, con el token `EQUIPOS_SYNC_TOKEN`. |
| Ver el tablero, la TV con sesión y «Mis equipos» | Quien tenga la app `equipos-taller`, y los admin. |
| Ajustes del tablero y llaves de kiosco (generar, ver la lista, revocar) | Solo los admin. |
| Ver la TV sin sesión | Una llave de kiosco activa. Solo abre los datos del tablero. |

La migración no siembra ni la app ni las llaves: se asignan a mano.

## Variables de hub-api

| Variable | Uso |
|---|---|
| `EQUIPOS_SYNC_TOKEN` | El token de máquina de las rutas de n8n (cabecera `X-Equipos-Sync-Token`). Es el mismo valor que la credencial Header Auth del flujo. Sin él, n8n no puede mandar la copia (lo dice el log al arrancar). ⚠️ Es un secreto: mismo cuidado que el resto mientras EasyPanel imprima las variables en el log de build. |
| `EQUIPOS_SYNC_MAX_HORAS` | Antigüedad máxima de la última sincronización completa, en horas enteras de 1 a 168. Por defecto, 6. |
| `EQUIPOS_HORA_DIARIA` | HH:MM de Colombia. Por defecto, `06:30`. |
| `EQUIPOS_ALERTA_WEBHOOK_URL`, `EQUIPOS_ALERTA_TOKEN` | El webhook de n8n y su token. Sin los dos, la alerta queda apagada (lo dice el log al arrancar). |
| `EQUIPOS_ALERTA_RESERVA` | Dirección de reserva. Por defecto, comercial@ambientalia.com.co. |
| `DESK2_DB_URL` | Ya existe (Trazabilidad). Si falta, todas las corridas fallan con `desk2: sin configurar`. |

Ya no hay variables de la cuenta de servicio ni de las carpetas de Drive. Los IDs de las carpetas viven solo en el nodo «Configuración» del flujo de n8n.

## Pasos pendientes del usuario

1. **`.env.example`:** **sustituir** el bloque «Equipos en taller» de `apps/hub-api/.env.example` por el nuevo (sin las variables de la cuenta de servicio ni de las carpetas de Drive, con `EQUIPOS_SYNC_TOKEN` y `EQUIPOS_SYNC_MAX_HORAS`), porque los agentes no pueden escribir ficheros `.env*`. Hasta entonces, `src/env-example.test.ts` falla en «cada variable del código está en el ejemplo».
2. **Desk 2.0:** `GRANT SELECT ON desk.conversations TO portal_agenda_reader;` (hecho el 10/11/2026).
3. **Token en n8n:** crear la credencial **Header Auth** «Token sincronización Equipos» (nombre de la cabecera `X-Equipos-Sync-Token`; valor, el mismo que `EQUIPOS_SYNC_TOKEN`).
4. **Token en EasyPanel:** cargar `EQUIPOS_SYNC_TOKEN` en hub-api. Si se cargaron, quitar las variables de Drive de la versión anterior.
5. **Flujo de sincronización en n8n** (abajo):
   - ponerle la credencial «Google Drive account» y la credencial del token, y revisar «Configuración»;
   - ejecutarlo **a mano** una vez (es la carga completa) y comprobar en psql que la pasada terminó con `ok = true` en `portal.equipos_sincronizacion`;
   - si la carga completa tarda más de 2 horas, la pasada termina como `tardia` (`ok = false`): los textos ya recibidos se conservan, así que basta con **volver a ejecutarlo a mano**, que esta vez termina rápido;
   - solo entonces, activarlo.
6. **Flujo de la alerta:** dejarlo **inactivo** hasta configurar la alerta.
7. **App y llaves:** asignarlas a los usuarios, y volver a marcar a mano el retirado conocido.
8. **Cuenta de servicio:** la cuenta de servicio de Google, su clave y el proyecto de Google Cloud que se creó para ella ya no se usan: se pueden borrar.

## Flujo de n8n «Equipos · Sincronizar remisiones»

Está en n8n, **inactivo** y sin credenciales hasta que el usuario las ponga (pasos de arriba). Sus ids no se escriben en el repo.

El usuario completa tres cosas:
- le pone la credencial «Google Drive account» de n8n y la del token (Header Auth);
- rellena el nodo «Configuración»: la URL de hub-api (la misma que usan los flujos de WO-sales y Ausencias), los IDs de las tres carpetas y el de la carpeta temporal del OCR. Los IDs no se escriben en el repo;
- se asegura de que la carpeta temporal está en el Drive de la cuenta de Google de n8n (comercial@ambientalia.com.co), donde esa cuenta puede crear y borrar archivos.

**Cómo corre:**
- **Cuándo:** cada hora. Cada ejecución es una **pasada**, y su id es `{{ $execution.id }}`.
- **Autenticación:** las tres llamadas a hub-api llevan la cabecera `X-Equipos-Sync-Token`. Sin la variable en hub-api, o con otro valor: `401 { "error": "unauthorized" }`.
- **Orden de una pasada:** comprobación de la carpeta temporal y barrido → entradas → salidas generadas por n8n → salidas escaneadas → «fin». En cada carpeta: el listado completo y, después, los textos de `faltaTexto`.
- **Parámetros de Drive:** las llamadas de listado, copia, borrado y comprobación llevan `supportsAllDrives=true`; las de listado, además, `includeItemsFromAllDrives=true` y `corpora=allDrives`, como hacía hub-api. Las exportaciones (`files.export`) no admiten ese parámetro y no lo llevan.
- **Listados incompletos:** si un listado de Drive no se puede leer entero (falla una página), la ejecución se para sin mandar ni ese listado ni el «fin». La pasada no cuenta.
- **429 y 5xx:** en el listado y en el «fin», n8n reintenta hasta 3 veces con esperas de 35 s (para no caer los tres intentos en la misma ventana de 60 s del límite de peticiones de hub-api); un fallo que sigue después de los reintentos para la ejecución.
- **Nombres de archivo:** antes de mandar un listado, n8n recorta los nombres a 300 caracteres y pone `(sin nombre)` a los vacíos, porque hub-api rechaza el listado entero si alguno no cumple.
- **Carpeta temporal:** al empezar, n8n comprueba que puede escribir en ella; si no, la pasada se para antes de tocar hub-api.
- **Barrido:** también al empezar, n8n borra de la carpeta temporal las copias `ocr-tmp-*` de más de 30 minutos (restos de pasadas que murieron a mitad). Las recientes se respetan, porque pueden ser de una pasada en marcha.

**1. Listado** — `POST <hub>/api/equipos-taller/sync/listado`

```json
{ "pasada": "4711", "carpeta": "entradas", "archivos": [{ "id": "<id de Drive>", "titulo": "261101 - CLIENTE A - 18A90001" }] }
```

- **`carpeta`:** `entradas`, `salidas_n8n` o `salidas_escaneadas`.
- **`archivos`:** TODOS los de la carpeta (todas las páginas), con `id` y `titulo` (el nombre en Drive, tal cual). Hasta 10 000, con nombres de 1 a 300 caracteres e ids sin repetir.
- **Qué se lista:** siempre con `trashed = false`.
  - En entradas y salidas_n8n, las carpetas (`mimeType = 'application/vnd.google-apps.folder'`).
  - En salidas_escaneadas, los PDF y las imágenes (`mimeType = 'application/pdf' or mimeType contains 'image/'`).
- **Respuestas:**
  - `200 { "faltaTexto": ["<id>", …] }`: los ids a los que n8n debe mandar texto. Siempre está vacío en salidas_n8n.
  - `409 { "error": "pasada_en_curso" }`: otra pasada empezó hace menos de 2 h y no ha terminado. La ejecución se para. Es normal si la anterior (la carga completa) sigue en marcha. Pasadas las 2 h, la vieja se cierra con `ok = false` y `motivo = 'abandonada'`.
  - `409 { "error": "pasada_cerrada" }`: esta pasada ya mandó «fin».
  - `409 { "error": "listado_sospechoso", "bajas": n, "vivos": m, "carpeta": "<carpeta>" }`: el listado viene vacío con la carpeta llena, o borraría más de 10 archivos y más de la mitad. `carpeta` es la que perdería los archivos: la del listado o, si los ids son de otra carpeta (se moverían a esta), esa otra; el mensaje la nombra. No se aplica nada. Casi siempre es un ID de carpeta equivocado o un permiso perdido; si de verdad se vació la carpeta, ver más abajo.
  - `400 { "error": "invalid_input", "message": "…" }`: el cuerpo no vale. El mensaje es fijo y no repite lo recibido.

**2. Texto** — `POST <hub>/api/equipos-taller/sync/texto`, uno por archivo:

```json
{ "id": "<id de Drive>", "texto": "…" }
{ "id": "<id de Drive>", "error": { "status": 403 } }
```

- **Entradas:** `texto` es el **primer** Google Doc de la carpeta, exportado con `files/<doc>/export?mimeType=text/markdown`. Se busca con `'<id>' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'` y `pageSize=5`, y vale el primero que devuelva Drive. Sin documento: `"texto": ""`.
- **Salidas escaneadas:** `texto` es el OCR, en tres llamadas:
  1. `POST files/<pdf>/copy?supportsAllDrives=true&ocrLanguage=es&fields=id` con `{ "mimeType": "application/vnd.google-apps.document", "name": "ocr-tmp-<id del pdf>", "parents": ["<carpeta temporal>"] }`. Sin reintentos: no es idempotente.
  2. `GET files/<copia>/export?mimeType=text/plain`.
  3. `DELETE files/<copia>?supportsAllDrives=true`, **siempre**, también si la exportación falló.
- **`error.status`:** solo si el fallo es de ESE archivo, es decir, un 4xx que no sea 401 ni 429, ni un 403 de cuota (motivo `rateLimitExceeded` o `userRateLimitExceeded`). hub-api rechaza con 400 cualquier otro `status`. Cualquier otro fallo (401, 429, 5xx, red, copia sin id) no se manda: el archivo queda pendiente y se pide en la pasada siguiente.
- **Límites:** el texto se recorta a 200 000 caracteres (n8n y hub-api lo hacen), y hub-api quita el carácter nulo.
- **Respuestas:**
  - `204`: guardado.
  - `404 { "error": "desconocido" }`: el archivo ya no está en la copia (se borró entre medias), o es de salidas_n8n, que no lleva texto. Se ignora.
  - `400`: el cuerpo no vale.

**3. Fin** — `POST <hub>/api/equipos-taller/sync/fin`

```json
{ "pasada": "4711", "conteos": { "entradas": 312, "salidas_n8n": 40, "salidas_escaneadas": 190 } }
```

- **`conteos`:** los archivos listados en cada carpeta. Lleva las tres claves, con enteros ≥ 0, y ninguna más.
- **Respuestas:**
  - `200 { "ok": true, "completa": true }`: la pasada cuenta como **completa**. Las corridas la usan y miden desde ella la frescura.
  - `200 { "ok": true, "completa": false, "motivo": "textos_fallidos" }`: la pasada se cerró, pero **no** cuenta como fresca (regla de los textos fallidos, arriba). Para n8n es como el otro 200: no hay que hacer nada distinto. Si sigue así más de `EQUIPOS_SYNC_MAX_HORAS`, las corridas fallan con `drive: n8n no pudo leer los textos de Drive (OCR)` y salta la alerta.
  - Con cualquiera de los dos 200, hub-api lanza después la corrida de cada hora (origen `sincronizacion`). n8n no tiene que hacer nada: la respuesta no la espera.
  - `404 { "error": "pasada_desconocida" }`.
  - `409 { "error": "pasada_cerrada" }`.
  - `409 { "error": "pasada_incompleta" }`: falta el listado de alguna carpeta.
  - `409 { "error": "pasada_tardia" }`: la pasada lleva más de 2 h abierta. Se cierra con `ok = false` y `motivo = 'tardia'`, y no cuenta como fresca; la siguiente ejecución empieza otra.

**Si algo falla a mitad:**
- Un listado de Drive que falla, o un listado que hub-api no acepta, para la ejecución sin «fin». La pasada no cuenta.
- Si n8n no termina ninguna pasada en `EQUIPOS_SYNC_MAX_HORAS`, las corridas fallan con «sincronización de n8n atrasada» y, a la segunda programada, sale la alerta.
- Un texto que no se pudo mandar (tras 3 intentos) no para la pasada: ese archivo se vuelve a pedir en la siguiente.

### Comprobar en psql

```sql
-- Últimas pasadas
SELECT id, pasada, inicio, fin, ok, motivo, listados, conteos FROM portal.equipos_sincronizacion ORDER BY id DESC LIMIT 10;
-- Archivos sin texto o con un fallo guardado
SELECT carpeta, id, titulo, error_status, texto_en FROM portal.equipos_drive_archivos
 WHERE NOT borrado AND carpeta <> 'salidas_n8n' AND (texto IS NULL OR error_status IS NOT NULL) ORDER BY carpeta, titulo;
```

### Si se vacía una carpeta a propósito

hub-api rechaza el listado como sospechoso (`409 listado_sospechoso`). Si de verdad se vació o se movió casi todo, hay que marcar a mano como borrado lo de esa carpeta. La siguiente pasada vuelve a dar de alta lo que siga allí, y conserva sus textos:

```sql
UPDATE portal.equipos_drive_archivos SET borrado = true, actualizado_en = now() WHERE carpeta = 'salidas_escaneadas' AND NOT borrado;
```

## Flujo de n8n «Equipos · Alerta de foto vieja»

Lo crea el usuario en n8n, **inactivo** hasta que se configure la alerta. hub-api lo llama así:

- **Petición:** `POST <EQUIPOS_ALERTA_WEBHOOK_URL>`, `Content-Type: application/json`, cabecera `X-Equipos-Alerta-Token: <EQUIPOS_ALERTA_TOKEN>`. hub-api no sigue redirecciones y espera 30 s como mucho.
- **Cuerpo:**

  ```json
  { "referencia": 12, "para": ["persona@ambientalia.com.co"], "asunto": "Equipos en taller: la información no se actualiza desde el …", "cuerpo": "La actualización diaria de «Equipos en taller» ha fallado 2 veces seguidas.\n\n…" }
  ```

  - `referencia` es el id del incidente.
  - `para` trae de 1 a N direcciones, todas `@ambientalia.com.co`.
  - `cuerpo` es texto plano, con párrafos separados por una línea en blanco.

- **Nodos:**
  1. **Webhook** (POST) con la credencial **Header Auth** (nombre `X-Equipos-Alerta-Token`, valor = el token). Respuesta: «Using 'Respond to Webhook' node».
  2. **Barrera de dominio** (IF / Code): si alguna dirección de `para` no termina en `@ambientalia.com.co`, o `asunto` está vacío → **Respond to Webhook** `422` con `{ "ok": false, "error": "destino fuera del dominio" }` y nada más.
  3. **Enviar correo** (Gmail o SMTP de la cuenta de servicio técnico) a `para`, con `asunto` y `cuerpo`.
  4. **Respond to Webhook** `200` con `{ "ok": true }`. Si el envío falla, `500` con `{ "ok": false, "error": "<motivo corto>" }` (sin datos de la cuenta).
- **Cómo lo entiende hub-api:**
  - Solo `2xx` con `{ "ok": true }` es «enviado» (se guarda `alerta_enviada_en`).
  - Cualquier otra cosa se guarda en `alerta_ultimo_error` como `n8n respondió <código>[: <error>]`, sin el token y cortado a 300 caracteres, y se reintenta en la siguiente corrida programada del mismo incidente.

## Datos de prueba y privacidad

El repo es público. Las fixtures del núcleo (`apps/hub-api/src/equipos/nucleo/fixtures/`) están **anonimizadas** con `apps/hub-api/scripts/equipos-anonimizar.mjs`: clientes, seriales, tickets y textos sustituidos de forma determinista, conservando las peculiaridades del OCR. Las reales, `roles.local.json` y el prompt original solo existen en local (`apps/hub-api/src/equipos/nucleo/fixtures-reales/` y `apps/equipos-desk2/`, ignorados por git).

```bash
cd apps/hub-api
node scripts/equipos-anonimizar.mjs generar src/equipos/nucleo/fixtures-reales src/equipos/nucleo/fixtures   # regenerar
node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs  # buscar fugas
```

`nucleo/reales.local.test.ts` comprueba en local que las anonimizadas están al día y que el núcleo da lo mismo con unas y otras; sin las reales se salta sola.

## Pendiente (§10 del diseño)

- **Enero de 2027:** en los tickets nacidos en Desk 2.0 la recogida es la transición «Entrega al cliente», no un comentario. Hay que revisar la regla 6 (con `desk.ticket_transitions`) antes de que esos tickets empiecen a cerrarse.
- **Remisiones de Desk 2.0:** `public.remisiones` podría sustituir a la lectura de las carpetas de entrada.
- **Caché `ent`:** no se invalida. Si n8n reenvía la remisión de una entrada ya leída (por ejemplo, porque cambió el nombre de la carpeta), la corrida sigue con la primera lectura.
