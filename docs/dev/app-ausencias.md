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
| `GET` | `/api/ausencias/saldos` | idem — acotado: admin ve a todos, aprobador solo a los suyos |
| `GET` | `/api/ausencias/calendario?mes=YYYY-MM` | idem — sin acotar por rol, lo ve toda la plantilla |
| `PUT` | `/api/ausencias/empleados/:id/saldo` | `requireAdmin` |
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

> El saldo de vacaciones no sale de aquí: estas cuatro pestañas traen el
> histórico de solicitudes, no el consolidado de días disponibles. Ese vive en
> la hoja `Total`, y de ahí sale la configuración por empleado que se explica
> en la siguiente sección.

## Saldo de vacaciones

Última pieza para poder desenchufar `consulta_vacaciones`: cada empleado y
quien aprueba ven, dentro de la app, cuántos días le quedan.
`apps/hub-api/src/ausencias/saldo.ts` es el cálculo — puro, sin `Pool`, para
que se pueda probar sin BD.

**La fórmula no parte de la fecha de ingreso.** El Excel calcula
`días trabajados / 30 × 1,25` desde el ingreso; lo implementado hace otra
cosa: parte del saldo que hoy vive en la hoja `Total` (`saldo_corte` a
`fecha_corte`, migración `017_saldo_vacaciones.sql`) y sigue devengando desde
ahí:

```
saldo(hoy) = saldo_corte + (días desde el corte / 30) × 1,25 − disfrutadas desde el corte
```

Es algebraicamente idéntica a recalcular desde el ingreso —el devengo es
proporcional al tiempo y a la MISMA tasa para todos, sin tramos por
antigüedad— y ahorra reunir quince fechas de contratación y parsear las nueve
hojas-calendario 2018-2026 (369 columnas cada una) donde viven las vacaciones
disfrutadas históricas.

**La fecha de corte es la frontera, y se descuenta por fecha de inicio, no por
`origen`.** Se resta toda solicitud de vacaciones cuya `fecha_inicio` sea
igual o posterior a `fecha_corte`, venga del portal o del histórico importado
de la hoja. Se decidió así y no filtrando por `origen = 'portal'` porque el
histórico trae filas con fecha posterior al corte que el consolidado del
Excel todavía no tenía descontadas; filtrar por origen las habría dejado
fuera y el saldo habría salido alto.

> ⚠️ **El gotcha operativo más importante.** `fecha_corte` NO tiene por qué
> ser hoy: es la última fecha en la que el consolidado estaba cuadrado. Si el
> Excel no trae descontadas las vacaciones ya aprobadas para las próximas
> semanas, hay que retrasar el corte hasta donde sí lo estaba. Ponerlo en
> "hoy" porque es cuando se teclea es el error más fácil de cometer al cargar
> los saldos iniciales, y descuadra el saldo de todo el mundo.

**El año devenga 15,2 días, no 15 — a propósito.** `DIAS_POR_MES` en
`saldo.ts` es 30, no 30,44, porque es lo que hace el Excel. El resultado,
365/30 × 1,25, da 15,2 días al año en vez de 15. "Corregirlo" descuadraría
contra el consolidado, así que se mantiene, y hay un test que fija el valor
exacto (`el año devenga 15,2 días, no 15…`) para que nadie lo enmiende
creyendo que es un bug.

**Un empleado sin configurar no ve ningún número.** Dos columnas nuevas en
`portal.empleados` —`saldo_corte` y `fecha_corte`— con la constraint
`empleados_saldo_completo` (`CHECK (saldo_corte IS NULL) = (fecha_corte IS
NULL)`) que impide dejar la configuración a medias. Como la ficha de empleado
se crea sola al entrar en la app (`repo.asegurarEmpleado`), las dos columnas
en NULL —"sin configurar"— es el estado por defecto de todo el que se da de
alta. La app lo dice con esas palabras; nunca enseña un 0 disfrazado de saldo
real. Los saldos iniciales del consolidado se teclean a mano en la pestaña
*Saldos* (solo admin).

**Qué cuenta como disfrutado.** Solo `tipo = 'vacaciones'` en
`estado = 'aprobada'`. Las `pendiente` van a un contador aparte (`enTramite`,
"en trámite") que NO resta del saldo firme (`disponible`), pero el aviso del
formulario sí compara contra `disponible − enTramite`, para que nadie agote
el saldo real mandando varias solicitudes seguidas antes de que se decida la
primera. Permisos, compensatorios e incapacidades no tocan el saldo en
absoluto.

**Los tres endpoints:**

| Endpoint | Quién |
|---|---|
| `GET /ausencias/contexto` | cualquiera con la app — trae el saldo del propio solicitante dentro del payload de arranque, sin llamada aparte |
| `GET /ausencias/saldos` | admin ve a todos los empleados; un aprobador no-admin ve solo los suyos (los que tienen su correo en `aprobador_correo`) — misma regla que `repo.solicitudesPendientes` |
| `PUT /ausencias/empleados/:id/saldo` | solo admin — fija el corte; no manda correos, igual que editar el registro general |

**Dos decisiones que conviene no revertir sin pensar:**

- *El saldo del contexto degrada a `null`; `GET /ausencias/saldos` no.* Si
  `saldoDeSesion` lanza dentro de `/ausencias/contexto`, el error se registra
  y se sigue: ahí el saldo es un campo accesorio de un payload que la app
  necesita para arrancar (sin él tampoco habría festivos ni pestañas). En
  `/ausencias/saldos` el saldo ES la respuesta entera, así que un fallo se
  deja salir como 500 en vez de devolver una lista con una fila en blanco —
  una lista de saldos incompleta sería un panel que miente por omisión, peor
  que un error visible.
- *El saldo viaja al backend como cadena, no como número.* El panel de admin
  manda `saldoCorte` como `string`: si lo convirtiera con `Number()` antes de
  mandarlo, un `'abc'` tecleado por error daría `NaN`, y `JSON.stringify(NaN)`
  produce `null` — el backend recibiría "vaciar la configuración" en vez de
  "esto no es un número". Mandando la cadena tal cual, la validación de forma
  vive en un solo sitio (`validarSaldo` en `service.ts`, con su regex) y el
  error que llega es el correcto.

## Calendario

La pestaña *Calendario* es una rejilla persona × día: quién está fuera y
cuándo, para todo el mes en curso o el que se navegue. `apps/hub-api/src/
ausencias/calendario.ts` hace la expansión (puro, sin `Pool`, mismo criterio
que `saldo.ts`); `service.calendarioDelMes` la une con `repo.empleadosActivos`
y `repo.ausenciasEntre`; `GET /ausencias/calendario?mes=YYYY-MM` la sirve.

**Convive con el Google Calendar «Ambientalia Staff»** que n8n sigue
publicando por cada ausencia aprobada — eso no se toca. Son dos sitios con la
misma información y **no se sincronizan entre sí**: una edición manual en
Google (mover un evento, borrarlo) no se refleja aquí, porque este calendario
no lee de Google, lee de `portal.solicitudes_ausencia` directamente.

**El endpoint devuelve las marcas ya expandidas por día, no los rangos.**
`marcasDelMes` convierte cada ausencia en una fila `{empleadoId, fecha, tipo,
estado}` por cada día que ocupa, acotada al mes pedido, y el frontend solo
pinta lo que recibe — no calcula ninguna fecha. Es deliberado: expandir un
rango a celdas es el cálculo que más errores de un día produce, y esta app ya
lleva dos incidentes de esa familia (el `+1` del fin exclusivo de un evento
*all-day* en Google Calendar, y el UTC−5 del saldo). La aritmética vive en
hub-api porque es donde hay tests para fijarla; los del portal (`apps/
ausencias/src/*.test.tsx`, si llegan a escribirse) no sirven de red de
seguridad todavía — están rotos por un desajuste de `jsdom` ajeno a esta
función.

**El filtro SQL de `ausenciasEntre` es de solapamiento, no de contención.**
La condición «natural» —`fecha_inicio >= desde AND fecha_fin <= hasta`—
perdería exactamente las ausencias que cruzan el cambio de mes, que son las
que más importa ver: sin ellas, el calendario de agosto no diría que alguien
sigue fuera el día 1 porque sus vacaciones empezaron en julio. El acotado al
mes ocurre después, en `marcasDelMes`, recortando cada rango contra los
límites del mes antes de expandirlo.

**Las incapacidades se muestran como cualquier otro tipo, sin enmascarar.**
Hubo una versión con `tipo: null` para las incapacidades ajenas, alegando
privacidad, y se retiró porque no ocultaba nada: `tipo: null` solo se
producía en incapacidades ajenas, así que la propia celda enmascarada
delataba justo lo que pretendía tapar (y `estado: 'registrada'` es un segundo
delator independiente, por construcción — una incapacidad se *registra*, no
se aprueba). Además el dato ya es público por el otro lado: el evento que
n8n publica en Google Calendar se llama «Incapacidades Nombre Apellido». No
reintroducir el enmascarado creyendo que tapa algo.

**La pestaña la ve todo el que tenga ficha de empleado**, no solo
administración — a diferencia de *Saldos* y *Registro general*, que son solo
de admin. Es decisión de producto: un calendario de equipo que no vea todo el
equipo no sirve para coordinarse.

> ⚠️ **Mantenimiento: el filtro de rechazadas usa `continue`, no `break`.**
> `for (const a of ausencias) { if (a.estado === 'rechazada') continue; ... }`
> en `marcasDelMes`. Cambiarlo a `break` sobrevive a un caso de prueba con una
> sola ausencia (con un elemento, `continue` y `break` son indistinguibles),
> pero con varias en la lista, `break` corta el bucle entero: una única
> rechazada a mitad de la lista borraría del calendario a todos los
> empleados que vinieran después, sin error y sin log. Hay un test que lo fija
> (`calendario.test.ts`, «una rechazada en medio de la lista no debe silenciar
> a los empleados siguientes»).

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

- Cargar los saldos iniciales del consolidado (nombre, días y a qué fecha son
  válidos) en la pestaña *Saldos*. Hasta entonces todo el mundo aparece como
  "sin configurar", que es el comportamiento correcto.
- Aprobación por jefe directo. El campo `aprobador_correo` ya deja el hueco; hoy
  todo va a `comercial@ambientalia.com.co`.
- Retirar la copia a Google Sheets cuando Nómina consulte solo el portal.
- Widget de dashboard con las ausencias del mes.
- `drive_file_id` se queda en NULL: el endpoint `/n8n/confirmado` acepta
  `adjuntos: [{id, driveFileId}]`, pero el workflow todavía no lo manda.
