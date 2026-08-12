# App «Vacaciones y Permisos» (`ausencias`)

Sustituye al flujo de n8n *Solicitud vacaciones_permisos_compensatorios_
incapacidades 1.5* (`mt75OpO0fGIXv5QG`, 44 nodos). El formulario, la aprobación y
el historial viven en el portal; n8n queda como brazo ejecutor de Gmail,
Calendar, Drive y Sheets.

## Qué cambió respecto del flujo viejo

| Antes (n8n) | Ahora (portal) | Por qué |
|---|---|---|
| El empleado teclea un **número de credencial** y un agente de OpenAI lo busca en una hoja de Google | La identidad sale de la **sesión del portal**; el maestro está en `portal.empleados` | La credencial era «personal e intransferible» pero nada impedía usar la de otro, y el agente costaba tokens en cada solicitud y podía devolver datos equivocados |
| Lista de **festivos escrita a mano** que terminaba el 2026-12-25 | `festivos.ts` los **calcula** (Ley Emiliani + Pascua por Butcher/Meeus) | Desde enero de 2027 el flujo habría contado los festivos como laborables, sin avisar |
| `new Date(str)` + `toISOString()` para contar días | Aritmética en UTC sobre cadenas `YYYY-MM-DD` | El servidor corre en UTC y Colombia es UTC−5: el original podía desplazar un día |
| Aprobación con **Gmail `sendAndWait`** | **Bandeja en el portal** con rastro de quién y cuándo | La ejecución de n8n se quedaba colgada esperando, y no había historial |
| El rechazo no decía el motivo | El motivo viaja en el correo y queda en la BD | Obligaba a preguntar por otro canal |
| Sin historial para el empleado | Pestaña «Mis solicitudes» | — |

Lo que **no** cambió, a propósito: los textos de los correos, el calendario
«Ambientalia Staff», las carpetas de Drive y las cuatro pestañas de la hoja
`consulta_vacaciones` con sus encabezados. Nómina no tiene que cambiar nada.

## Piezas

- **Frontend**: `apps/ausencias/` — pestañas *Nueva solicitud*, *Mis solicitudes*,
  *Pendientes de aprobar* (si eres aprobador o admin) y *Empleados* (solo admin).
- **Backend**: `apps/hub-api/src/ausencias/`
  - `festivos.ts` / `dias-habiles.ts` — el cálculo, con tests.
  - `config.ts` — ids de Google, correos en copia, firmas. **Un único sitio.**
  - `notificaciones.ts` — los correos y los efectos en Google, redactados aquí.
  - `service.ts` — validación y casos de uso. `repo.ts` — SQL. `router.ts` — HTTP.
- **BD**: migración `015_ausencias.sql` → `portal.empleados`,
  `portal.solicitudes_ausencia`, `portal.solicitud_adjuntos`,
  `portal.ausencias_outbox`.
- **n8n**: workflow **«Ausencias — Portal»** (`dh0xjWCHsGj9raYH`), 14 nodos.

## El contrato con n8n

Mismo patrón que WO-sales (ver [n8n-automatizaciones.md](../n8n-automatizaciones.md)):
**hub-api decide QUÉ hay que hacer; n8n pregunta por horario, ejecuta y confirma.**

```
Cada 10 min ─────────────────┐
                             ├→ GET /api/ausencias/n8n/pendiente
POST /webhook/ausencias-aviso┘        (X-Ausencias-Cron-Token)
  → IF token válido ────────┘
  → IF hay → Repartir eventos (uno por evento)
  → Enviar correo (Gmail)
  → IF calendario → Google Calendar ┐
  → IF hoja  → Fila → Google Sheets ┤ las ramas falsas siguen la cadena
  → IF drive → GET adjunto → Drive  ┘
  → POST /api/ausencias/n8n/confirmado  { ids: [id] }
```

**Dos disparadores, uno solo obligatorio.** El barrido de 10 minutos es el
mecanismo; el webhook es un atajo para que el correo salga en un segundo. hub-api
pega en él al encolar (`avisar.ts`) **sin esperar respuesta y sin propagar
errores**: si n8n está caído o el aviso se pierde, la solicitud ya está guardada
y el barrido la recoge. Por eso el push no necesita reintentos ni cola propia.

El webhook es público, así que el primer nodo compara la cabecera contra
`$env.AUSENCIAS_CRON_TOKEN` y corta si no coincide — verificado: una llamada sin
token ejecuta dos nodos y se para. Reutiliza el token del cron a propósito: es la
misma frontera de confianza en el otro sentido, y un secreto más solo añadiría
algo que rotar.

Empezó siendo un barrido de 1 minuto. Funcionaba, pero eran 1.440 ejecuciones
diarias para no hacer nada casi siempre; con el híbrido son 144 más una por
solicitud o decisión real.

**Cada fila del outbox es exactamente un correo**, y por eso el alta de una
solicitud genera dos (`creada` = acuse al solicitante, `aprobacion` = aviso a
quien aprueba). Ese detalle es lo que permite que el flujo sea una cadena lineal
en vez de un árbol con cuatro ramas.

Reparto de los efectos, para que ninguno se duplique ni se pierda:

| Evento | Correo | Calendario | Hoja | Drive |
|---|---|---|---|---|
| `creada` | acuse al solicitante | — | — | — |
| `aprobacion` | aviso a quien aprueba | — | — | sube el PDF (para que pueda verlo) |
| `aprobada` | aprobado (+ administración) | ✔ | ✔ | — |
| `rechazada` | rechazado con motivo | — | ✔ | — |
| `registrada` | acuse de incapacidad | ✔ | ✔ | ✔ |

El estado **no avanza al servir el evento, solo al confirmarlo**: si Gmail falla,
el ciclo siguiente lo reintenta. El precio es que un fallo *después* de enviar el
correo puede duplicarlo — se prefiere un correo repetido a una solicitud que
nadie ve. `intentos` en `portal.ausencias_outbox` delata un evento atascado.

> ⚠️ Los eventos se sirven en lotes de hasta 20. Si uno falla, el lote entero se
> queda sin confirmar y se reintenta completo, así que los correos ya enviados de
> ese lote se repiten. Con el volumen real (unas pocas solicitudes al día) el
> lote casi siempre trae uno o dos eventos.

## Endpoints

| Método | Ruta | Auth |
|---|---|---|
| `GET` | `/api/ausencias/contexto` | `requireAuth` + `requireApp('ausencias')` |
| `POST` | `/api/ausencias/solicitudes` | idem |
| `GET` | `/api/ausencias/mis-solicitudes` | idem |
| `GET` | `/api/ausencias/pendientes` | idem |
| `POST` | `/api/ausencias/solicitudes/:id/decision` | idem — **409** si ya estaba decidida |
| `GET` | `/api/ausencias/dias-habiles?desde&hasta` | idem |
| `GET` | `/api/ausencias/adjuntos/:id` | idem — solo dueño, aprobador o admin |
| `GET`/`POST` | `/api/ausencias/empleados[/import\|/sincronizar]` | `requireAdmin` |
| `GET`/`POST` | `/api/ausencias/n8n/{pendiente,adjunto/:id,confirmado}` | `requireCronToken` |

## El histórico de la hoja

Las cuatro pestañas de solicitudes de `consulta_vacaciones` (53 filas desde
octubre de 2025) se importan a `portal.solicitudes_ausencia` desde
*Registro general* (solo admin). El Excel **se lee en el navegador** y solo viaja
el JSON: `apps/ausencias/src/leerExcel.ts`.

Se lee el fichero en vez de pedir que se peguen las filas —que es lo que hace la
importación de empleados— por un motivo concreto: **al pegar, las fechas llegan
como `10/11/2025` y dd/mm es indistinguible de mm/dd**. El 10 de noviembre y el
11 de octubre se confundirían en silencio y nadie lo notaría hasta tener un
histórico mal por meses. Con `cellDates` llegan ya como `Date`.

Lo que el análisis del fichero obligó a cambiar:

| Hallazgo | Consecuencia |
|---|---|
| Hay un `6.5` y un `"1*"` en la columna Días | `dias_habiles` pasó a `NUMERIC(4,1)`. El asterisco entra como 1 y su nota va a `observaciones` |
| 13 grafías distintas para 9 personas, y **ningún correo** en la hoja | `resolverEmpleado` casa por subconjunto de palabras normalizadas. Verificado contra el fichero real: las 13 resuelven sin ambigüedad |
| La octava columna de vacaciones no tiene cabecera | Va a `observaciones` |
| `Adjunto?` guarda el JSON crudo de n8n | Se extrae solo el nombre del PDF; el fichero sigue en Drive |
| Una fila ya la había creado el portal | El INSERT lleva `NOT EXISTS` por (empleado, tipo, fechas) |

La importación **reporta los nombres que no casan en vez de abortar el lote**:
reimportar es inocuo, así que corregir el maestro y volver a pasar el fichero es
el camino natural. La UI llama primero con `dryRun` y solo importa tras enseñar
el recuento.

> Lo que esto **no** resuelve: el saldo de vacaciones. Sale de la hoja `Total`
> (`días trabajados / 30 × 1,25` menos las disfrutadas) y las disfrutadas viven
> en las nueve hojas-calendario 2018-2026, no en estas cuatro pestañas. Hasta que
> eso se migre, la hoja sigue haciendo falta para consultar saldos.

## Gotchas que costaron

- **El adjunto y el límite de body.** El PDF viaja en base64 y `index.ts` tiene un
  `express.json({ limit: '2mb' })` global. El parser de 12 MB de la ruta de
  creación **tiene que registrarse ANTES** que el global: si el de 2 MB corre
  primero, devuelve 413 y ninguna incapacidad escaneada puede subirse.
  body-parser se salta el segundo cuando el primero ya dejó `req.body` puesto, así
  que el resto de endpoints conserva su límite.
- **El fin de un evento *all-day* en Google es exclusivo.** Sin el `+1 día`, el
  último día de la ausencia no se pinta en el calendario.
- **La pestaña de incapacidades tiene `Adjunto?`, no `Aprobado?`.** No es una
  simplificación: es el esquema real de la hoja.
- **La ficha de empleado se crea sola.** Quien tiene la app asignada ya tiene el
  permiso; la ficha se deriva de `portal.users` la primera vez que entra
  (`asegurarEmpleado`). No hay alta manual en el onboarding. Solo queda 403
  cuando de verdad no hay de dónde sacarla: una cuenta legacy sin fila en
  `portal.users`, o una ficha que un admin desactivó a propósito — y eso se
  respeta, el alta automática no la reactiva.
  El maestro se puede importar igualmente desde la hoja para rellenar los
  **cargos** en bloque, o rellenar de golpe con el botón *Dar de alta desde el
  portal*. Los tres caminos van indexados por correo y se componen.
- **Un empleado sin cuenta del portal no puede pedir nada**, aunque esté en el
  maestro: la identidad viene de la sesión. Si la ficha se importó antes de que
  existiera la cuenta, `user_id` queda NULL y el vínculo se hace por correo en
  cuanto la cuenta aparece. La pestaña *Empleados* avisa de cuántos están así.
- **`NUMERIC` vuelve del driver como texto.** Al pasar `dias_habiles` a
  `NUMERIC(4,1)` para admitir el medio día, `pg` empezaría a devolver `"5.0"` en
  vez de `5` —lo hace para no perder precisión— y eso rompe la aritmética de la
  UI y de los correos. Por eso el `SELECT` lleva `::float8`.
- **Ojo con los backticks dentro de un SQL en template literal.** Un comentario
  con `pg` entre acentos graves cierra la plantilla y el fichero deja de parsear
  con un error que apunta a otro sitio.
- **Cada automatización, su propio secreto.** `requireCronToken` acepta ahora
  `{ env, header }`; ausencias usa `AUSENCIAS_CRON_TOKEN` /
  `X-Ausencias-Cron-Token`. El token de WO-sales **no** sirve aquí, y hay un test
  que lo comprueba.

## Puesta en marcha

1. `git push origin main` y **redesplegar hub-api** (corre la migración 015) y
   luego el **portal**. Son dos servicios distintos; commit local ≠ desplegado.
2. Variables nuevas en hub-api: `AUSENCIAS_CRON_TOKEN`, `PORTAL_URL` y
   `AUSENCIAS_WEBHOOK_URL`
   (`https://<n8n>/webhook/ausencias-aviso`; sin ella todo funciona, solo que el
   correo espera al barrido).
3. La misma `AUSENCIAS_CRON_TOKEN` como **variable de entorno del contenedor de
   n8n** en EasyPanel, y reiniciar el servicio. No es la pantalla *Settings →
   Variables* de n8n: los nodos la leen con `$env`, que son las del proceso.
4. Asignar la app `ausencias` a los usuarios en *Admin → Usuarios*. Quien ya
   tuviera sesión abierta debe **cerrar sesión y volver a entrar**: el `apps[]`
   viaja congelado en el JWT. Con eso ya pueden solicitar — la ficha de empleado
   se crea sola al entrar.
5. *(Opcional)* En *Vacaciones y Permisos → Empleados*, pulsar **Dar de alta
   desde el portal** para tener la lista completa de una vez, y pegar la pestaña
   `consolidado` (Nombre y Apellidos · Cargo · Correo · Número clave) para
   rellenar los cargos.
6. Activar el workflow **«Ausencias — Portal»** en n8n.
7. Convivencia: dejar el flujo viejo (`mt75OpO0fGIXv5QG`) activo unos días y
   **desactivarlo** —no borrarlo— cuando el nuevo lleve una semana sin incidencias.

## Pendiente (backlog)

- Saldo de días de vacaciones por empleado (hoy no existe en ninguna parte:
  requiere el histórico completo y la fecha de ingreso).
- Aprobación por jefe directo. El campo `aprobador_correo` ya deja el hueco; hoy
  todo va a `comercial@ambientalia.com.co`.
- Retirar la copia a Google Sheets cuando Nómina consulte solo el portal.
- Widget de dashboard con las ausencias del mes.
- `drive_file_id` se queda en NULL: el endpoint `/n8n/confirmado` acepta
  `adjuntos: [{id, driveFileId}]`, pero el workflow todavía no lo manda.
