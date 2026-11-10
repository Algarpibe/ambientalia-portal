# Equipos en taller — integración en el portal (diseño)

Fecha: 10/11/2026. Estado: aprobado en brainstorming, pendiente del plan de implementación.

## 1. Objetivo

Saber en todo momento qué equipos están **físicamente** dentro del taller de servicio técnico, ordenados por fecha de llegada. Para eso se cruzan las remisiones de entrada y de salida de Google Drive con los tickets de Desk y sus comentarios.

El módulo ya existe como código TypeScript probado en `apps/equipos-desk2/`. Se escribió para Desk 2.0, pero **el portal y Desk 2.0 son independientes**: el módulo se integra en el portal, adaptado a su estructura y sin compromiso de compatibilidad con Desk 2.0.

**No cambian:** las reglas de negocio (§5 del prompt original, que queda en local), las vistas, los filtros, los ajustes manuales ni la pantalla. Esto no es un rediseño: solo cambian las fuentes, el almacén y el encaje en el portal.

## 2. Decisiones

| # | Decisión | Motivo |
|---|---|---|
| D1 | App propia, con su tarjeta en el portal. Id de app: `equipos-taller`. | Es un dominio distinto al de Trazabilidad (calibraciones y agenda), con permisos propios, y la pantalla se traslada sin rediseño. |
| D2 | El motor vive en hub-api (`apps/hub-api/src/equipos/`). La pantalla, en la sub-app `apps/equipos-taller/`, que importa el núcleo por ruta relativa. | Es el patrón de Calibraciones: funciona con `tsc -b` y con el Dockerfile sin tocar el build. |
| D3 | Drive se lee con una **cuenta de servicio de Google**, por `fetch` y sin dependencias nuevas. Tiene lectura en las 3 carpetas y edición solo en una carpeta temporal para el OCR. | El código ya existe y está probado. Con n8n habría que reescribir las fuentes y construir un OCR asíncrono. |
| D4 | Los tickets salen de `desk.tickets` y los comentarios de `desk.conversations`, en la base de Desk 2.0, por `getDesk2Pool()` (`DESK2_DB_URL`, rol `portal_agenda_reader`). **No se usa la API de Zoho.** | Zoho Desk deja de usarse el próximo año y Desk 2.0 conserva los datos. `desk.conversations` está completa desde el 02/11/2026. |
| D5 | **Sin réplica de respaldo.** Si falla Desk 2.0 **o Drive**, no se actualiza: se conserva la última foto buena. Hay dos excepciones: un PDF concreto que Drive no puede pasar a texto va a la lista de ilegibles, y una remisión de entrada que no se puede leer se indica en los avisos sin hacer fallar la corrida (§5.1). | Nunca se muestra una clasificación hecha con datos incompletos. La réplica no tiene comentarios, así que con ella la regla 6 se apagaría sin avisar. |
| D6 | Alerta por un webhook de n8n, **una vez por incidente**, cuando hay 2 corridas programadas fallidas seguidas. | Evita el ruido de avisar en cada fallo. |
| D7 | Llaves por usuario: `edita_ajustes` y `recibe_alertas`. | Es el mismo modelo de llaves por ficha que usa Ausencias. |
| D8 | Las tablas van en el esquema `portal`, con prefijo `equipos_`. | Es la convención del portal, y el rol de hub-api ya es dueño de ese esquema. |
| D9 | Al repo solo van fixtures **anonimizadas**. Las reales y el prompt original se quedan en local, ignorados por git. | El repo es público y las fixtures reales llevan razones sociales y seriales de clientes. |

## 3. Componentes

### 3.1 Backend: `apps/hub-api/src/equipos/`

| Fichero | Responsabilidad | Origen |
|---|---|---|
| `nucleo/tipos.ts`, `nucleo/reglas.ts`, `nucleo/actualizar.ts`, `nucleo/pantalla.ts` | Dominio puro, sin E/S: lectura de OCR, enlace con tickets, clasificación, ilegibles, ajustes, vistas, orden y filtros. **Es la única fuente de verdad de las reglas.** | Se copia de `packages/equipos/src`. Solo cambian los imports. |
| `fuente-drive.ts` | Token de la cuenta de servicio (JWT firmado con `node:crypto`), listado de las 3 carpetas, OCR (copia a Google Doc → exportar texto → borrar la copia). | Se adapta de `servidor/fuentes-google-zoho.ts`. |
| `fuente-desk2.ts` | Lee los tickets (`desk.tickets.raw`, con la forma de la API de Zoho, campos `cf_*` incluidos) y los comentarios (`desk.conversations`), y los traduce a la forma que espera el núcleo. Si falla, lanza el error; no tiene respaldo. | Nuevo. Sustituye al espejo y a la API de Zoho. |
| `repo.ts` | Lectura y escritura de `portal.equipos_*`. | Se adapta de `servidor/almacen-postgres.ts`. |
| `servicio.ts` | Una corrida: candado → Desk 2.0 → Drive → cálculo → foto. Registra la corrida y actualiza el incidente. | Se adapta de `servidor/servicio.ts`. |
| `incidente.ts` | Decisión **pura** de alerta, a partir de la última corrida, el origen y el estado del incidente. | Nuevo. |
| `alerta.ts` | Envía el correo de alerta por el webhook de n8n con su token. Sigue el patrón de `trazabilidad/envio-avisos.ts`. | Nuevo. |
| `programador.ts` | Corrida diaria a las 06:30, hora de Colombia. | Mismo patrón que `trazabilidad/programador-pasadas.ts`. |
| `config.ts` | Variables de entorno. Si falta la configuración de Drive, el módulo queda en estado «sin configurar». | Se adapta de `servidor/config.ts`. |
| `router.ts` | Las rutas de §3.3. | Se adapta de `apps/desk/server/equipos/router.ts`. |
| `users/migrations/071_equipos_taller.sql` | Las tablas y vistas de §4. Es idempotente y se registra en `db.ts`. | Se adapta de `sql/equipos.sql`. |

### 3.2 Frontend

- **`apps/equipos-taller/`**: es la sub-app Vite. Lleva `EquiposServicio.tsx` y `api.ts`, que se trasladan **sin rediseño**. `api.ts` hace las peticiones con `VITE_HUB_API_URL` y `ambientalia_token`, como el resto de apps. Se añaden tres cosas:
  - el aviso de foto vieja (§5.3);
  - el panel de llaves, que solo ven los admin;
  - los botones de ajuste ocultos para quien no tenga `edita_ajustes`.
- **Portal**: ruta perezosa `/equipos-taller`, tarjeta en el Dashboard y en Aplicaciones, el id de la app en la gestión de usuarios y el `COPY` del `package.json` de la sub-app en el `Dockerfile` raíz.

### 3.3 API

Todas las rutas van bajo `requireAuth` + `requireApp('equipos-taller')`.

| Ruta | Permiso extra | Respuesta |
|---|---|---|
| `GET /api/equipos-taller` | — | La foto, los ajustes, la última corrida, la última corrida buena, el estado del incidente, si el módulo está configurado y las llaves del usuario. |
| `POST /api/equipos-taller/actualizar` | — | 202 si la corrida empieza, 409 si ya hay una en curso y 503 si el módulo está sin configurar. |
| `PUT /api/equipos-taller/ajustes/:clave` | `edita_ajustes` o admin | El ajuste guardado, firmado con el usuario y la fecha. |
| `DELETE /api/equipos-taller/ajustes/:clave` | `edita_ajustes` o admin | 204. |
| `GET /api/equipos-taller/llaves` | admin | Los usuarios que tienen la app y sus llaves. |
| `PUT /api/equipos-taller/llaves/:userId` | admin | Las llaves actualizadas, firmadas. |

## 4. Modelo de datos (esquema `portal`)

- **`equipos_estado`**: `clave text PK`, `valor jsonb`, `actualizado_en`. Las claves son:
  - `foto`: las filas y las ilegibles. Se conservan las claves cortas de JSON (`d`, `c`, `sn`, `est`, `src`, `why`, `x`, `z`, `zc`, `pa`, `xd`, `eq`).
  - `exits`: la caché del texto de OCR. **Su versión sigue siendo CV = 3**, y solo se sube si cambia lo que se extrae de cada PDF.
  - `ent`: las entradas ya leídas.
  - Ya no hay caché de comentarios (`cmt`), porque se leen en cada corrida.
- **`equipos_ajuste`**: `clave text PK`, `tipo` (`in`/`out`/`ret`/`pdf`), `nota`, `user_id`, `usuario`, `creado_en`. Los formatos de clave no cambian: `SERIAL_cls|AAAA-MM-DD`, `*SERIAL_cls` y `pdf:<idDrive>`.
- **`equipos_ejecucion`**: `id`, `origen` (`programada`/`boton`), `user_id`, `inicio`, `fin`, `en_curso`, `ok`, `causa`, `conteos jsonb`. Lleva un índice único parcial sobre `en_curso` que impide dos corridas a la vez.
- **`equipos_incidente`**: `id`, `abierto_en`, `cerrado_en`, `fallos_programados`, `alerta_enviada_en`, `alerta_ultimo_error`. Como mucho hay un incidente abierto.
- **`equipos_llaves`**: `user_id PK` (FK a `portal.users`), `edita_ajustes`, `recibe_alertas`, `actualizado_por`, `actualizado_en`.
- **Vistas** `equipos_v_equipos` y `equipos_v_remisiones_ilegibles`, para consultar en psql.

**La migración no siembra ni permisos ni apps.** Las migraciones se vuelven a ejecutar en cada arranque, así que una semilla devolvería permisos que un admin hubiera quitado.

## 5. Flujo de una corrida y fallos

### 5.1 Pasos

1. **Candado.** Se inserta la corrida con `en_curso`. Si choca con el índice único, la respuesta es 409 «ya se está actualizando».
2. **Desk 2.0.** Si falla, la corrida termina como fallida, con la causa `desk2: <motivo>`.
3. **Drive.** Se hace el OCR solo de los PDF que no están en la caché. Si falla, la corrida termina como fallida, con la causa `drive: <motivo>`. El texto que ya se extrajo **se guarda** en `exits` igualmente, porque es caché y no una clasificación.
   - **Excepción (decisión del 10/11/2026): un PDF concreto que Drive no puede pasar a texto no hace fallar la corrida.** Es un error 4xx de ese archivo que no sea 401 ni 429.
     - Ese PDF va a la lista de remisiones ilegibles con el motivo «sin texto legible» (regla 11) y la explicación «Google Drive no pudo convertir este PDF a texto».
     - No entra en la caché, así que se reintenta en cada corrida y desaparece de la lista en cuanto se arregla en Drive.
     - Si fallan **todos** los PDF intentados (2 o más) y ninguno sale, el problema es de Drive (por ejemplo, permisos de la carpeta temporal) y la corrida falla con `drive: no se pudo convertir ningún PDF (HTTP <código>)`.
     - El listado de las carpetas, el token, la cuota, los 5xx y la red siguen haciendo fallar la corrida.
   - **La misma excepción vale para las remisiones de entrada (decisión del 10/11/2026).** Si Drive no puede leer el documento de una remisión de entrada (4xx de ese archivo):
     - El equipo sigue contando como entrada, porque la fecha, el cliente y el serial salen del nombre de la carpeta.
     - Se pierde lo que aporta el documento (el número de ticket y el nombre del equipo), y el enlace con el ticket sigue con las reglas 2 a 4.
     - La corrida lo indica en sus avisos y lo reintenta en la siguiente.
     - Si fallan todas las intentadas (2 o más) y ninguna sale, la corrida falla con `drive: no se pudo leer ninguna remisión de entrada (HTTP <código>)`.
   - **Limpieza de la carpeta temporal.** Al empezar cada corrida, después de la sonda de Desk 2.0, se borran las copias de OCR que hayan quedado de corridas anteriores (prefijo `ocr-tmp-`, solo en la carpeta temporal).
     - Si no se puede listar esa carpeta, la corrida falla.
     - Si alguna copia no se puede borrar, la corrida sigue y lo indica en sus avisos.
4. **Cálculo.** Se aplican el núcleo y los ajustes. La foto y el cierre de la corrida se escriben **en una sola transacción**.

Una corrida fallida **nunca** modifica `foto`. La siguiente corrida es el reintento.

**Las causas no llevan secretos.** Nunca incluyen la URL de la base, el token ni el error crudo de `pg` o de Google. Se registran con `enmascararUrl` y mensajes saneados, como en `db-desk2.ts`.

### 5.2 Incidentes y alerta

- **Abrir:** la primera corrida fallida después de una buena abre el incidente.
- **Contar:** solo suman a `fallos_programados` las corridas **programadas**. Las del botón no cuentan.
- **Avisar:** cuando `fallos_programados` llega a 2 y todavía no hay `alerta_enviada_en`, se envía la alerta.
- **Si el envío falla:** se guarda `alerta_ultimo_error` y se reintenta en la siguiente corrida programada del mismo incidente.
- **Cerrar:** una corrida buena cierra el incidente. Si después vuelve a fallar, se abre uno nuevo y se puede avisar otra vez.
- **Destinatarios:** los usuarios activos con `recibe_alertas`. Si no hay ninguno, la dirección de reserva, comercial@ambientalia.com.co, configurable.
- **En n8n:** una barrera de dominio solo deja salir a direcciones `@ambientalia.com.co`.
- **Sin las variables `EQUIPOS_ALERTA_WEBHOOK_URL` y `EQUIPOS_ALERTA_TOKEN`:** la alerta queda apagada y se registra en el log.

### 5.3 Aviso en pantalla

| Estado | Aviso |
|---|---|
| La última corrida falló | «No se pudo leer Desk 2.0» o «No se pudo leer Google Drive», seguido de «; datos del <fecha y hora de la foto buena>». |
| Incidente con 2 o más corridas programadas fallidas | El mismo aviso, **destacado**. |
| Módulo sin configurar | «Falta configurar Google Drive». El botón «Actualizar información» queda desactivado. |

## 6. Permisos

| Acción | Quién |
|---|---|
| Abrir la app, ver las pestañas, filtrar y pulsar «Actualizar información» | Quien tenga la app `equipos-taller`, y los admin. |
| Ajustes manuales: «Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste» y «Ya revisada» | La llave `edita_ajustes`, o ser admin. |
| Gestionar las llaves | Los admin. |
| Recibir la alerta | La llave `recibe_alertas`. Se asigna explícitamente y los admin no la tienen por defecto. |

El servidor comprueba cada llave; la pantalla solo oculta los botones.

**Asignación inicial**, que se hace a mano tras el despliegue: el Director Comercial y el Director Técnico reciben la app, `edita_ajustes` y `recibe_alertas`.

## 7. Configuración (variables de hub-api)

| Variable | Uso |
|---|---|
| `EQUIPOS_GOOGLE_CUENTA_SERVICIO` | El JSON de la cuenta de servicio. Sin esta variable, el módulo queda «sin configurar». |
| `EQUIPOS_DRIVE_ENTRADAS`, `EQUIPOS_DRIVE_SALIDAS_N8N`, `EQUIPOS_DRIVE_SALIDAS_ESCANEADAS`, `EQUIPOS_DRIVE_TEMPORAL` | Los IDs de las carpetas. No se escriben en el repo. |
| `EQUIPOS_HORA_DIARIA` | La hora de la corrida diaria. Por defecto, `06:30` en America/Bogota. |
| `EQUIPOS_ALERTA_WEBHOOK_URL`, `EQUIPOS_ALERTA_TOKEN`, `EQUIPOS_ALERTA_RESERVA` | La alerta (§5.2). |
| `DESK2_DB_URL` | Ya existe, y es la misma que usa Trazabilidad. Si falta, todas las corridas fallan con `desk2: sin configurar`. |

⚠️ **La clave de la cuenta de servicio no se carga en EasyPanel mientras EasyPanel siga imprimiendo las variables en el log de build.** Primero hay que resolver la rotación de secretos pendiente. Mientras tanto, el módulo se despliega «sin configurar».

## 8. Pruebas

Se hacen con Vitest. **El código nuevo se escribe en TDD estricto.** Las pruebas de hub-api se ejecutan desde `apps/hub-api`, no desde la raíz.

- **Núcleo:** se trasladan las pruebas de reglas, actualización y pantalla, con fixtures **anonimizadas**. Los clientes y seriales se sustituyen de forma determinista, y se conservan los casos difíciles del OCR: el serial deformado, los ceros a la izquierda, O/0, I/1, S/5, T/7, B/8, el serial sin dígitos, la remisión ilegible y el PDF con fecha futura. Una suite **solo local** con las fixtures reales se salta sola si los ficheros no están.
- **`fuente-desk2`:** con una base falsa. Cubre que los `cf_*` lleguen bien, la forma de los comentarios y que un error se propague sin respaldo.
- **`incidente`** (puro): 1 fallo no avisa; 2 programados avisan; las corridas del botón no cuentan; se avisa una sola vez; el reintento si el webhook falla; el cierre y la nueva alerta tras recuperarse.
- **`servicio`:** una corrida fallida no toca `foto` pero sí guarda `exits`; el 409 con el candado.
- **Router:** con Express real. Las llaves, el 403 sin la app o sin la llave, el 503 sin configurar.
- **Migración y repositorio:** en `*.db.test.ts`, contra el Postgres de pruebas. La migración debe poder ejecutarse dos veces sin cambiar nada.
- **Pantalla:** prueba de React con jsdom en la sub-app. Cubre los avisos y los botones ocultos sin la llave.

## 9. Puesta en marcha

1. **Requisitos, que hace Gerencia:**
   - `GRANT SELECT ON desk.conversations TO portal_agenda_reader;` (`desk.ticket_transitions` ya está concedido).
   - Crear la cuenta de servicio y compartirle las carpetas. A `REMISIONES 2026\SALIDA` le falta hoy.
   - Crear la carpeta temporal del OCR.
   - Crear el flujo de n8n «Equipos · Alerta de foto vieja», **inactivo**, con su token y la barrera de dominio.
2. **Desplegar** primero hub-api y justo después el portal.
3. **Asignar** a mano la app y las llaves (§6).
4. **Cuando la rotación de secretos esté resuelta,** cargar las variables de Drive y lanzar la primera corrida con el botón. Hace el OCR de unos 190 PDF y tarda varios minutos; la pantalla consulta el estado cada 3 s.
5. **Validar en paralelo, el mismo día:** comparar la pestaña «En taller» y la lista de ilegibles con la página de Claude. La referencia del 7–9/11/2026 es de 21 equipos en taller (19 GRIMM y 2 Horiba). Si hay diferencias por el orden del texto del OCR, se corrigen en el núcleo.
6. **Retirar la página de Claude** solo cuando coincidan las dos. Hasta entonces, `claude/build.mjs` se construye desde `apps/hub-api/src/equipos/nucleo/`.
7. **Limpiar** `apps/equipos-desk2/`: se eliminan `apps/desk`, `apps/hub-sync` y `packages/equipos`. `Prompt.txt` y las fixtures reales se quedan en local.

## 10. Fuera de alcance y pendientes

- **Enero de 2027.** En los tickets nacidos en Desk 2.0, la recogida es la transición «Entrega al cliente», no un comentario. Hay que revisar la regla 6 (con `desk.ticket_transitions`) antes de que esos tickets empiecen a cerrarse.
- **Posible fuente futura.** El `public.remisiones` de Desk 2.0 podría sustituir a la lectura de las carpetas de entrada. No se hace ahora.
- **Ajustes de la página de Claude.** No se migran: son pocos y se rehacen en la pantalla nueva.
- **Pendientes de Ambientalia sobre los datos.** Equipos sin ticket que hay que verificar físicamente, tickets que hay que corregir en Zoho y PDF mal nombrados. Siguen su curso fuera de este desarrollo.
