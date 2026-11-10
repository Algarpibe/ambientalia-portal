# Equipos en taller

Qué equipos están **físicamente** dentro del taller de servicio técnico, ordenados por fecha de llegada. Cruza las remisiones de entrada y de salida de Google Drive con los tickets de Desk 2.0 y sus comentarios. Diseño: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`.

- App del portal: `equipos-taller` (ruta `/equipos-taller`, sub-app `apps/equipos-taller`). Aparece en la barra lateral (`apps/portal/src/lib/apps.ts`) y en Aplicaciones; **no** tiene tarjeta en el Dashboard.
- Motor: `apps/hub-api/src/equipos/`. Las reglas viven SOLO en `nucleo/` (puro, sin E/S); la pantalla lo importa por ruta relativa.
- Datos: `portal.equipos_*` (migración 071). Para psql: `portal.equipos_v_equipos` y `portal.equipos_v_remisiones_ilegibles`.

## De dónde sale cada dato

**Desk 2.0** (`apps/hub-api/src/equipos/fuente-desk2.ts`, solo lectura, mismo pool que Trazabilidad):

- Cada campo `cf_*` se rellena en este orden: `raw.cf`, luego `custom_fields` por etiqueta, luego la columna tipada promovida. En los tickets `managed_by_app` el orden se invierte: primero `custom_fields` y columnas, y `raw.cf` al final. Estado, fecha de modificación y de cierre de un ticket gestionado salen de las columnas.
- Comentarios: `desk.conversations` con `kind = 'comment'`, los 15 más recientes (`commented_time DESC NULLS LAST`).
- Etiquetas comprobadas en la base de Desk 2.0 el 10/11/2026: `custom_fields` guarda «Serial1», «Serial2» y «Serial3» (sin espacio). La búsqueda por etiqueta ignora los separadores, así que coinciden con `cf_serial1` a `cf_serial3`. «Equipo» (`cf_equipo_1`) no aparece en `custom_fields` porque Desk 2.0 lo pasa a la columna `equipo`, que es de donde se lee. «Equipo1» a «Equipo3» son otros campos (los de las remisiones con varios equipos) y el núcleo no los usa.

**Drive:** tres carpetas (entradas, salidas generadas por n8n, salidas escaneadas) más una temporal para el OCR. Solo se hace OCR de los PDF que no están en la caché.

## Una corrida

1. **Candado:** se inserta la corrida «en curso» (`portal.equipos_ejecucion`). Si ya hay otra: 409 «Ya se está actualizando». Una corrida colgada más de 180 min se da por abandonada; hasta entonces, si el proceso murió a mitad (caída o despliegue), el botón responde 409. El indicador «actualizando» caduca con esos mismos 180 min.
2. **Desk 2.0:** una sonda de `desk.tickets` y `desk.conversations`. Si falla → `desk2: <motivo>`.
3. **Limpieza de la carpeta temporal:** justo después de la sonda, antes de leer Drive, se borran las copias `ocr-tmp-*` huérfanas de corridas anteriores (`limpiarTemporal`). Las que no se pueden borrar pasan a avisos de la corrida y se reintentan en la siguiente. La petición de copia del OCR no se reintenta.
4. **Drive y núcleo:** listado de las 3 carpetas, OCR solo de los PDF que no están en la caché (`exits`, versión CV del núcleo), tickets por serial y comentarios de los equipos que siguen adentro. Cualquier fallo de una fuente hace fallida la corrida (`drive: …` o `desk2: …`); el texto de OCR ya extraído se guarda igual. Excepciones:
   - Un PDF concreto que Drive no puede pasar a texto va a remisiones ilegibles («Google Drive no pudo convertir este PDF a texto»); no se guarda en la caché y se reintenta en cada corrida.
   - Un documento de remisión de ENTRADA que Drive no puede leer genera un aviso; la entrada se cuenta igual y se reintenta.
   - Solo si fallan **todos** los intentados (2 o más) la corrida falla.
5. **Foto:** la foto y el cierre de la corrida, en una transacción.

Una corrida fallida **nunca** toca la foto: la pantalla sigue con la última buena. Una corrida abandonada (180 min) tampoco sobrescribe nunca una foto más nueva y no cuenta para los incidentes. La siguiente corrida es el reintento.

**Aviso de foto vieja en pantalla:** se calcula con la última corrida **terminada** (no con la que está en curso), para que no desaparezca mientras corre. El detalle del último error de la alerta (`alertaUltimoError`) solo lo reciben los admin.

| Causa | Qué mirar |
|---|---|
| `desk2: sin configurar` | Falta `DESK2_DB_URL` en hub-api. |
| `desk2: sin conexión` / `tiempo agotado` | La base de Desk 2.0 no responde (mismo pool que Trazabilidad: 3 s para conectar, 5 s por consulta). |
| `desk2: consulta rechazada (permisos o esquema)` | Falta el `GRANT SELECT ON desk.conversations TO portal_agenda_reader`, o cambió una columna. |
| `drive: token rechazado (HTTP 4xx)` | La cuenta de servicio (`EQUIPOS_GOOGLE_CUENTA_SERVICIO`) no vale o está deshabilitada. |
| `drive: HTTP 403` / `404` | A la cuenta de servicio le falta una carpeta compartida (lectura en las 3; edición en la temporal). |
| `drive: no se pudo convertir ningún PDF (HTTP 4xx)` | Fallan todos los PDF al pasarlos a texto: casi siempre, a la cuenta de servicio le falta edición en la carpeta temporal del OCR. (Un solo PDF que falla no aparece aquí: sale en remisiones ilegibles.) |

### Si el servidor cayó o se redesplegó a mitad de una corrida

La corrida queda «en curso» en la base y nadie la cierra. Hasta que pasan los 180 min, el botón responde 409 y la pantalla sigue en «Actualizando…». Para liberarla antes, el dueño puede ejecutar esto en psql. Solo marca como abandonadas las corridas que siguen «en curso» y llevan más de 10 minutos (es el mismo `UPDATE` que usa `repo.ts`, con 10 en vez de 180). Ejecútalo **solo si no hay una corrida realmente en marcha**:

```sql
UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = false, causa = 'abandonada' WHERE en_curso AND inicio < now() - make_interval(mins => 10);
```

La foto no se toca y la corrida abandonada no cuenta para los incidentes.

### Notas de operación

- **Límites de Drive.** Drive informa de los límites de uso como 403, y el sistema trata un 403 de un archivo como error de ese PDF. Esos PDF salen como «sin texto legible» durante una corrida y se corrigen solos en la siguiente. Es lo esperado en la primera corrida (unos 190 PDF).
- **Pool de Desk 2.0.** El pool tiene 2 conexiones y las comparte con Trazabilidad. Si aparece `desk2: tiempo agotado`, esa es la causa más probable.

## Corrida diaria e incidentes

- A las `EQUIPOS_HORA_DIARIA` de Colombia (06:30 por defecto). No hay corrida de recuperación al arrancar: si un despliegue cae después de la hora, usar el botón.
- **Incidente:** lo abre la primera corrida fallida tras una buena; solo las corridas **programadas** suman fallos; con 2 seguidos se envía **una** alerta; si el envío falla se guarda el error (`alerta_ultimo_error`) y se reintenta en la siguiente programada; una corrida buena lo cierra.
- **Destinatarios:** solo los usuarios **activos** que sean admin o tengan la app, **y** tengan la llave «recibe alertas»; si no hay ninguno, `EQUIPOS_ALERTA_RESERVA` (por defecto comercial@ambientalia.com.co). Solo direcciones `@ambientalia.com.co`.

```sql
-- Últimas corridas y el incidente abierto
SELECT id, origen, inicio, fin, ok, causa FROM portal.equipos_ejecucion ORDER BY id DESC LIMIT 10;
SELECT * FROM portal.equipos_incidente WHERE cerrado_en IS NULL;
```

## Pantalla

Vistas, columnas, motivos y ajustes manuales vienen de la herramienta original. Los filtros **Cliente**, **Estado en Desk**, **Sin ticket** y **Quitar filtros** se portaron de la versión nueva del original (`nucleo/pantalla.ts`).

`RETIRADOS_FIJOS` está **vacío a propósito**. Tras el despliegue hay un caso conocido que debe volver a marcarse a mano con «Marcar retirado».

## Permisos

| Acción | Quién |
|---|---|
| Abrir, filtrar, «Actualizar información» | Quien tenga la app `equipos-taller`, y los admin. |
| Ajustes manuales («Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste», «Ya revisada») | La llave `edita_ajustes`, o ser admin. |
| Gestionar las llaves («Llaves de la app», al final de la pantalla) | Los admin. Las llaves solo se pueden dar a usuarios **activos** que tengan la app (o sean admin). |
| Recibir la alerta | La llave `recibe_alertas` (los admin no la tienen por defecto), con el usuario activo y con la app o admin. |

La migración no siembra ni la app ni las llaves: se asignan a mano.

## Variables de hub-api

| Variable | Uso |
|---|---|
| `EQUIPOS_GOOGLE_CUENTA_SERVICIO` | JSON de la cuenta de servicio, en una línea. Sin ella (o sin alguna carpeta) el módulo queda «sin configurar». ⚠️ No cargarla en EasyPanel mientras EasyPanel imprima las variables en el log de build; antes, rotar los secretos. |
| `EQUIPOS_DRIVE_ENTRADAS`, `EQUIPOS_DRIVE_SALIDAS_N8N`, `EQUIPOS_DRIVE_SALIDAS_ESCANEADAS`, `EQUIPOS_DRIVE_TEMPORAL` | IDs de las carpetas. No se escriben en el repo. |
| `EQUIPOS_HORA_DIARIA` | HH:MM de Colombia. Por defecto `06:30`. |
| `EQUIPOS_ALERTA_WEBHOOK_URL`, `EQUIPOS_ALERTA_TOKEN` | El webhook de n8n y su token. Sin los dos, la alerta queda apagada (lo dice el log al arrancar). |
| `EQUIPOS_ALERTA_RESERVA` | Dirección de reserva. Por defecto comercial@ambientalia.com.co. |
| `DESK2_DB_URL` | Ya existe (Trazabilidad). Si falta, todas las corridas fallan con `desk2: sin configurar`. |

## Pasos pendientes del usuario

1. Pegar el bloque `EQUIPOS_*` en `apps/hub-api/.env.example` (los agentes no pueden escribir ficheros `.env*`).
2. `GRANT SELECT ON desk.conversations TO portal_agenda_reader;`
3. Crear la cuenta de servicio, compartirle las 3 carpetas (lectura) y la temporal (edición).
4. Dejar el flujo de n8n **inactivo** hasta configurar la alerta.
5. Rotar los secretos antes de cargar la clave de la cuenta de servicio en EasyPanel.
6. Asignar la app y las llaves a los usuarios; volver a marcar a mano el retirado conocido.

## Flujo de n8n «Equipos · Alerta de foto vieja»

Lo crea el usuario en n8n, **inactivo** hasta que se configure la alerta. hub-api lo llama así:

- **Petición:** `POST <EQUIPOS_ALERTA_WEBHOOK_URL>`, `Content-Type: application/json`, cabecera `X-Equipos-Alerta-Token: <EQUIPOS_ALERTA_TOKEN>`. hub-api no sigue redirecciones y espera 30 s como mucho.
- **Cuerpo:**

  ```json
  { "referencia": 12, "para": ["persona@ambientalia.com.co"], "asunto": "Equipos en taller: la información no se actualiza desde el …", "cuerpo": "La actualización diaria de «Equipos en taller» ha fallado 2 veces seguidas.\n\n…" }
  ```

  `referencia` es el id del incidente. `para` trae de 1 a N direcciones, todas `@ambientalia.com.co`. `cuerpo` es texto plano con párrafos separados por una línea en blanco.

- **Nodos:**
  1. **Webhook** (POST) con la credencial **Header Auth** (nombre `X-Equipos-Alerta-Token`, valor = el token). Respuesta: «Using 'Respond to Webhook' node».
  2. **Barrera de dominio** (IF / Code): si alguna dirección de `para` no termina en `@ambientalia.com.co`, o `asunto` está vacío → **Respond to Webhook** `422` con `{ "ok": false, "error": "destino fuera del dominio" }` y nada más.
  3. **Enviar correo** (Gmail o SMTP de la cuenta de servicio técnico) a `para`, con `asunto` y `cuerpo`.
  4. **Respond to Webhook** `200` con `{ "ok": true }`. Si el envío falla, `500` con `{ "ok": false, "error": "<motivo corto>" }` (sin datos de la cuenta).
- **Cómo lo entiende hub-api:** solo `2xx` con `{ "ok": true }` es «enviado» (se guarda `alerta_enviada_en`). Cualquier otra cosa se guarda en `alerta_ultimo_error` como `n8n respondió <código>[: <error>]` (sin el token, cortado a 300 caracteres) y se reintenta en la siguiente corrida programada del mismo incidente.

## Datos de prueba y privacidad

El repo es público. Las fixtures del núcleo (`apps/hub-api/src/equipos/nucleo/fixtures/`) están **anonimizadas** con `apps/hub-api/scripts/equipos-anonimizar.mjs`: clientes, seriales, tickets y textos sustituidos de forma determinista, conservando las peculiaridades del OCR. Las reales, `roles.local.json` y el prompt original solo existen en local (`apps/hub-api/src/equipos/nucleo/fixtures-reales/` y `apps/equipos-desk2/`, ignorados por git).

```bash
cd apps/hub-api
node scripts/equipos-anonimizar.mjs generar src/equipos/nucleo/fixtures-reales src/equipos/nucleo/fixtures   # regenerar
node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs  # buscar fugas
```

`nucleo/reales.local.test.ts` comprueba en local que las anonimizadas están al día y que el núcleo da lo mismo con unas y otras; sin las reales se salta sola.

## Pendiente (§10 del diseño)

- **Enero de 2027:** en los tickets nacidos en Desk 2.0 la recogida es la transición «Entrega al cliente», no un comentario. Revisar la regla 6 (con `desk.ticket_transitions`) antes de que esos tickets empiecen a cerrarse.
- `public.remisiones` de Desk 2.0 podría sustituir a la lectura de las carpetas de entrada.
