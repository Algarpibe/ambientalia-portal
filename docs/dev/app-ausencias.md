# App «Vacaciones y Permisos» (`ausencias`)

Sustituye al flujo de n8n *Solicitud vacaciones_permisos_compensatorios_
incapacidades 1.5* (`mt75OpO0fGIXv5QG`, 44 nodos). El formulario, la aprobación y
el historial viven en el portal; n8n queda como brazo ejecutor de Gmail,
Calendar y Sheets.

## Qué cambió respecto del flujo viejo

| Antes (n8n) | Ahora (portal) | Por qué |
|---|---|---|
| El empleado teclea un **número de credencial** y un agente de OpenAI lo busca en una hoja de Google | La identidad sale de la **sesión del portal**; el maestro está en `portal.empleados` | La credencial era «personal e intransferible» pero nada impedía usar la de otro, y el agente costaba tokens en cada solicitud y podía devolver datos equivocados |
| Lista de **festivos escrita a mano** que terminaba el 2026-12-25 | `festivos.ts` los **calcula** (Ley Emiliani + Pascua por Butcher/Meeus) | Desde enero de 2027 el flujo habría contado los festivos como laborables, sin avisar |
| `new Date(str)` + `toISOString()` para contar días | Aritmética en UTC sobre cadenas `YYYY-MM-DD` | El servidor corre en UTC y Colombia es UTC−5: el original podía desplazar un día |
| Aprobación con **Gmail `sendAndWait`** | **Bandeja en el portal** con rastro de quién y cuándo | La ejecución de n8n se quedaba colgada esperando, y no había historial |
| Una sola firma, siempre el mismo buzón | **Dos firmas en cascada**: el jefe inmediato y su superior | Un solo aprobador para toda la empresa no es una jerarquía, es un cuello de botella |
| El rechazo no decía el motivo | El motivo viaja en el correo y queda en la BD | Obligaba a preguntar por otro canal |
| Sin historial para el empleado | Pestaña «Mis solicitudes» | — |

Lo que **no** cambió, a propósito: los textos de los correos, el calendario
«Ambientalia Staff» y las cuatro pestañas de la hoja
`consulta_vacaciones` con sus encabezados. Nómina no tiene que cambiar nada.

## Piezas

- **Frontend**: `apps/ausencias/` — pestañas *Nueva solicitud*, *Mis solicitudes*
  y *Calendario*; *Pendientes de aprobar* e *Historial de aprobaciones* si eres
  aprobador o admin; *Soportes adjuntos* si eres admin o estás en VISORES_ADJUNTOS;
  *Empleados*, *Saldos* y *Registro general* solo admin.
- **Backend**: `apps/hub-api/src/ausencias/`
  - `festivos.ts` / `dias-habiles.ts` — el cálculo, con tests.
  - `saldo.ts` / `calendario.ts` / `jerarquia.ts` — módulos puros, con tests.
  - `config.ts` — ids de Google, correos en copia, firmas. **Un único sitio.**
  - `notificaciones.ts` — los correos y los efectos en Google, redactados aquí.
  - `service.ts` — validación y casos de uso. `repo.ts` — SQL. `router.ts` — HTTP.
- **BD**: migración `015_ausencias.sql` → `portal.empleados`,
  `portal.solicitudes_ausencia`, `portal.solicitud_adjuntos`,
  `portal.ausencias_outbox`; `017` el saldo, `018` la cascada de dos firmas, `019`
  la reserva del outbox y `020` la retirada de Drive.
- **n8n**: workflow **«Ausencias — Portal»** (`dh0xjWCHsGj9raYH`), 13 nodos.

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
  → IF calendario → Google Calendar ┐ las ramas falsas
  → IF hoja  → Fila → Google Sheets ┘ siguen la cadena
  → POST /api/ausencias/n8n/confirmado  { ids: [id] }
```

Hubo un tercer IF (`drive → GET adjunto → Drive`) que subía el PDF a Google Drive.
Se retiró: los adjuntos se consultan desde el portal. Ver «Los adjuntos» abajo.

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

| Evento | Correo | Calendario | Hoja |
|---|---|---|---|
| `creada` | acuse al solicitante | — | — |
| `aprobacion` | aviso al jefe inmediato | — | — |
| `aprobacion_2` | aviso al segundo aprobador | — | — |
| `aprobada` | aprobado, a **toda la cadena** (+ administración) | ✔ | ✔ |
| `rechazada` | rechazado con motivo, a **toda la cadena** (+ administración) | — | ✔ |
| `registrada` | acuse de incapacidad | ✔ | ✔ |

`aprobacion_2` tiene nombre propio y no reutiliza `aprobacion` porque su **texto
es distinto**: `avisoSegundoAprobador` lleva su propio asunto y dice que la
solicitud ya cuenta con el visto bueno del jefe inmediato. `CORREO_DE` necesita
una clave por texto, así que fundirlos mandaría el correo equivocado. (Nació
además para no duplicar la subida a Drive; esa razón desapareció al retirar Drive,
la de arriba no.)

**El workflow no discrimina por nombre de evento** —sus dos IF miran
`payload.calendario` y `payload.hoja` contra `null`, y Gmail lee `payload.correo`
directamente—, así que un evento nuevo fluye sin tocar n8n. Verificado sobre el
workflow vivo al añadir `aprobacion_2`.

> ⚠️ Ese mismo diseño tiene un filo. Los IF comparan **contra `null`**, así que si
> hub-api deja de emitir un campo, el valor pasa a ser `undefined` y
> `undefined !== null` es **`true`**: la rama se activa para *todos* los eventos.
> Al retirar Drive hubo que quitar los nodos en n8n **antes** de desplegar el
> hub-api sin el campo. Si algún día vuelve un campo así, el IF tiene que existir
> antes de que hub-api empiece a emitirlo, nunca después.

El estado **no avanza al servir el evento, solo al confirmarlo**: si Gmail falla,
el ciclo siguiente lo reintenta. El precio es que un fallo *después* de enviar el
correo puede duplicarlo — se prefiere un correo repetido a una solicitud que
nadie ve. `intentos` en `portal.ausencias_outbox` delata un evento atascado.

Pero servir **sí reserva**: `servido_at` aparta la fila de la cola durante cinco
minutos (`RESERVA` en `repo.ts`, migración 019). Al expirar vuelve sola, así que
la propiedad de arriba se mantiene intacta.

> ⚠️ **Sin esa reserva los dos disparadores se pisan.** Pasó en producción el
> 2026-08-13: el webhook del portal arrancó a las 17:40:41,3 y el barrido de diez
> minutos a las 17:40:42,0. Entre servir y confirmar pasa lo que tarde el envío
> (unos 3 s con Gmail), así que el segundo leyó las mismas filas que el primero
> aún no había confirmado y **el empleado recibió el correo dos veces**
> (ejecuciones `32915` e `32916`: mismos ids 10 y 11, `intentos` 1 y 2, y la
> segunda confirmación devolvió `confirmados: 0`). No era solo un correo repetido:
> sobre un evento `aprobada` habrían salido dos eventos de Google Calendar y dos
> filas en la hoja que consulta Nómina.
>
> La reserva **no puede acercarse a los 10 minutos del barrido**: si la supera, un
> envío que falló de verdad tarda dos pasadas en reintentarse. Y no puede bajar de
> lo que tarda un lote completo, o vuelve el duplicado.

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
| `GET` | `/api/ausencias/pendientes` | idem — solo lo que le toca firmar AHORA |
| `GET` | `/api/ausencias/decididas` | idem — lo que le tocaba firmar y ya está cerrado |
| `POST` | `/api/ausencias/solicitudes/:id/decision` | idem — **409** si ya estaba decidida |
| `GET` | `/api/ausencias/dias-habiles?desde&hasta` | idem |
| `GET` | `/api/ausencias/adjuntos` | idem — solo admin o `VISORES_ADJUNTOS`; **403** al resto |
| `GET` | `/api/ausencias/adjuntos/:id` | idem — dueño, sus **dos** aprobadores, admin o `VISORES_ADJUNTOS` |
| `GET` | `/api/ausencias/saldos` | idem — acotado: admin ve a todos, aprobador los suyos y los de sus «nietos» |
| `GET` | `/api/ausencias/mi-saldo` | idem — solo el saldo propio; **500** si el cálculo falla, no un saldo en blanco |
| `GET` | `/api/ausencias/calendario?mes=YYYY-MM` | idem — **acotado**: admin ve la plantilla, el resto solo su fila |
| `PUT` | `/api/ausencias/empleados/:id/saldo` | `requireAdmin` |
| `PUT` | `/api/ausencias/empleados/:id/jefe` | `requireAdmin` — **409** si cerraría un círculo |
| `GET`/`POST` | `/api/ausencias/empleados[/sincronizar]` | `requireAdmin` |
| `GET`/`POST` | `/api/ausencias/n8n/{pendiente,confirmado}` | `requireCronToken` |

## El histórico de la hoja

Las cuatro pestañas de solicitudes de `consulta_vacaciones` (53 filas desde
octubre de 2025) se importan a `portal.solicitudes_ausencia` desde
*Registro general* (solo admin). El Excel **se lee en el navegador** y solo viaja
el JSON: `apps/ausencias/src/leerExcel.ts`.

Se lee el fichero en vez de pedir que se peguen las filas por un motivo concreto:
**al pegar, las fechas llegan como `10/11/2025` y dd/mm es indistinguible de
mm/dd**. El 10 de noviembre y el 11 de octubre se confundirían en silencio y
nadie lo notaría hasta tener un histórico mal por meses. Con `cellDates` llegan
ya como `Date`.

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

**Los cuatro endpoints:**

| Endpoint | Quién |
|---|---|
| `GET /ausencias/contexto` | cualquiera con la app — trae el saldo del propio solicitante dentro del payload de arranque, sin llamada aparte |
| `GET /ausencias/mi-saldo` | cualquiera con la app — el mismo saldo propio, pero solo, para quien no necesita el resto del contexto (el widget del dashboard; ver «Dónde se ve» más abajo) |
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

### Dónde se ve

La regla de qué número se enseña vive en un solo sitio, `IndicadorSaldo.tsx`:
el número grande es `disponible`, y `enTramite` aparece como línea de aviso
solo cuando hay algo pendiente. La usan dos superficies —la cabecera de la
app y el widget del dashboard— y viven ahí precisamente para que no se
puedan separar: si cada una escribiera la regla por su cuenta, la primera vez
que alguien tocara una sola acabarían enseñando cifras distintas de la misma
persona.

No se enseña en grande el «pedible» (`disponible − enTramite`, la cuenta que
de verdad se puede pedir): `disponible` es el número que ve un administrador
en el panel de *Saldos*, y poner otro en la cabecera daría dos cifras para
«mi saldo» sin nada que explicara la diferencia. `enTramite` no desaparece,
solo baja de rango: queda como aviso aparte, no restado del número principal.

**Un `disponible` negativo se pinta en rojo.** Es alcanzable: `calcularSaldo`
no le pone suelo y `saldo_corte` no lleva más constraint que exigir que corte
y fecha vayan juntos o ninguno de los dos, así que una vacación aprobada que
el saldo de corte ya traía descontada se resta dos veces. El rojo no arregla
el dato —eso es trabajo de datos—, pero evita que la cabecera presente un
imposible con la misma cara que un saldo sano.

**Con `saldo === null` o `configurado: false` la cabecera no enseña nada, ni
un cartel.** Sería permanente y en todas las pestañas, y hoy todavía le falta
el saldo inicial a una decena de personas. Ese aviso ya lo da `TarjetaSaldo`
en *Nueva solicitud*, que es donde importa. El widget sí lo dice —ahí no hay
nada más que enseñar—, y nunca como un 0,0: se leería como «no me quedan
días», no como «nadie ha fijado tu punto de partida».

**`TarjetaSaldo` sigue viva y no es lo mismo.** Además del saldo, avisa en
rojo si los días que se están escribiendo en el formulario no caben. Vive en
*Nueva solicitud* y en la bandeja de aprobación, donde el saldo es el de otra
persona —por eso recibe el título por prop en vez de un texto fijo.

**El widget** (`ausencias-mi-saldo`, tamaño `4×3`) lo sirve
`GET /ausencias/mi-saldo`, no `/ausencias/contexto`: la home del portal no
tiene por qué cargar los festivos de tres años para pintar un número. `3×2`
se probó primero y no cupo —la celda deja 117 px de contenido y el widget
mide 120 px en cuanto hay algo en trámite, justo la gente para la que existe
la línea de aviso—. Y el tamaño del descriptor solo manda hasta que alguien añade el
widget: `addWidget` copia `defaultSize` al layout que persiste en el
`localStorage` de cada usuario, así que ajustarlo más tarde no habría
corregido a quien ya lo tuviera añadido con el valor viejo.

**La asimetría del admin.** `useWidgetRegistry` filtra el catálogo de
widgets por el claim `apps` del JWT sin mirar el rol, mientras que
`requireApp`, en el backend, deja pasar a cualquier admin aunque no tenga la
app asignada. Un admin sin `ausencias` en su lista no ve el widget en
«Editar panel», aunque el endpoint le respondería si lo llamara. Es un
comportamiento de serie del mecanismo de widgets del dashboard, no algo
propio de esta app.

### Lo que no refresca

`refrescarSaldoPropio` (`App.tsx`) se dispara en tres sitios: al crear una
solicitud, al decidirla, y al fijar un saldo de corte desde el panel de
*Saldos*. No se dispara al borrar ni al editar una solicitud desde
*Registro general* (`RegistroGeneral.tsx`), que son acciones de admin: el
borrado y la edición ahí solo tocan la tabla local del registro, sin avisar
al contexto. Si un admin borra una vacación aprobada suya, su propia cabecera
sigue enseñando el número anterior hasta que recarga la página. Se dejó así
a propósito —cablear el aviso obligaba a hacer pasar un callback por más
componentes de los que hoy lo conocen—, pero conviene tenerlo escrito: el
síntoma, «mi saldo no cambió», es difícil de atribuir a una edición hecha
desde otra pestaña.

## Los adjuntos

**El PDF vive en PostgreSQL, y siempre ha vivido ahí.**
`portal.solicitud_adjuntos.contenido` es un `BYTEA NOT NULL` que se escribe en la
misma transacción que la solicitud. Google Drive era una copia secundaria que n8n
subía después tirando del propio hub-api; **se retiró**.

El binario no viaja en ninguna lista: `SELECT_SOLICITUD` trae
`octet_length(a.contenido)` y nada más. La única consulta que lo lee es
`adjuntoPorId`, y solo la usa `GET /ausencias/adjuntos/:id`.

### Quién puede abrir uno

`puedeVerAdjunto`: el solicitante, sus dos aprobadores, cualquier admin, y los
correos de **`VISORES_ADJUNTOS`** (`config.ts`). La ruta devuelve **404 y no 403**
a quien no pasa: quien no tiene nada que ver con la solicitud tampoco debería
poder confirmar que ese adjunto existe.

> ⚠️ `VISORES_ADJUNTOS` es una llave maestra, y lo que abre incluye **el soporte
> médico de las incapacidades ajenas** — dato de salud. La lista tiene que
> quedarse corta. Y **no hay registro de descargas**: `/adjuntos/:id` no loguea
> nada, a diferencia del PATCH y el DELETE del registro. Si la lista crece, ese
> log es lo siguiente que hay que añadir.

### Por qué hay una pestaña propia

*Soportes adjuntos* (`GET /ausencias/adjuntos`, solo las solicitudes con PDF) la
ven admin y los visores. Hace falta porque **las incapacidades no aparecen en
ninguna otra pantalla**: nacen `registrada` y sin aprobador, así que ni la bandeja
(`pendiente`/`pendiente_2`) ni el historial del aprobador
(`aprobada`/`rechazada`) las alcanzan, y *Registro general* es solo de admin. Y
son justo las que siempre traen soporte médico. Antes de esto, el PDF de una
incapacidad ajena solo se podía abrir desde Drive.

Ese endpoint devuelve **403** y no 404, al revés que el del fichero: allí el 404
evita confirmar la existencia de un adjunto concreto; una colección no dice nada
de nadie en particular.

Se descartó abrir *Registro general* a los visores: habría que relajar **dos**
guards de admin —el del histórico y el de empleados, que el componente pide
juntos—, les daría el registro entero con su exportación CSV, y dejaría el
borrado a un `if` de distancia.

### Lo que se retiró con Drive

`DRIVE_ID`, `CARPETA_DRIVE`, `construirPayload().drive`, `SubidaDrive`,
`GET /ausencias/n8n/adjunto/:id`, el bloque `adjuntos` de `/n8n/confirmado`,
`marcarAdjuntoEnDrive` y la columna `drive_file_id` (migración 020, estaba toda a
NULL porque el workflow solo mandaba `{ ids }`).

`/n8n/confirmado` **sigue aceptando** un `adjuntos` en el cuerpo y lo ignora sin
protestar: un workflow antiguo que alguien reactive tiene que poder confirmar, que
es lo único que importa.

Los PDF que ya estaban en Drive **se quedan ahí**; esto solo cortó los nuevos. Las
53 filas importadas del Excel nunca tuvieron bytes en la base de datos: su
`observaciones` dice «Adjunto en Drive: …» y sigue siendo cierto.

## Aprobación en cascada

Una solicitud la firman **el jefe inmediato y después el superior de ese jefe**.
La primera firma la deja en `pendiente_2`; la segunda la pasa a `aprobada`. Quien
reporta a la cúspide del organigrama se queda con una sola firma.

### El organigrama es una sola columna

`portal.empleados.aprobador_correo` significa **«el correo de mi jefe
inmediato»**. No hay tabla de jerarquía ni segundo aprobador guardado en el
maestro: el segundo se **deriva subiendo un escalón**, que es lo que hace que el
árbol exista una sola vez y no pueda desincronizarse consigo mismo.

Las reglas viven en `apps/hub-api/src/ausencias/jerarquia.ts`, puro y con tests
—misma convención que `saldo.ts` y `calendario.ts`—. `aprobadoresDe` devuelve
`segundo: null` en cuatro casos: el jefe no tiene ficha **activa** (y entonces
**no salta al abuelo**), el jefe es su propio jefe (raíz), el jefe del jefe ya
firma primero, o el jefe del jefe es el propio solicitante. Este último corta los
ciclos de dos: sin él, A se firmaría a sí mismo la segunda aprobación.

> ⚠️ **`creariaCiclo` lleva un `Set` de visitados y no es defensivo.** Si ya hay
> un ciclo en la base de datos ajeno al empleado que se edita, un recorrido sin
> visitados deja un handler de Express girando para siempre — no es un error que
> se vea, es un cuelgue. Hay un test con `timeout` que lo convierte en un fallo.

Un ciclo que ya esté en la base de datos **no bloquea la edición**: bloquearla lo
haría imposible de deshacer desde el panel. Se avisa en ámbar y `aprobadoresDe`
lo corta.

### Los firmantes se congelan en el alta

La solicitud guarda `aprobador_correo` y `segundo_aprobador_correo` en el momento
de crearse. Mover el organigrama **no mueve nada que ya esté en trámite**. La
fuente de verdad sigue siendo el árbol de `empleados`; esto es una foto.

`aprobador_correo` **no rota** al avanzar de nivel: se lee en `SELECT_SOLICITUD`,
`adjuntoPorId`, `avisoAprobador` y `puedeVerAdjunto`, y rotarlo perdería al primer
firmante (con tokens legacy las columnas `*_user_id` son NULL, así que la traza
real son los correos). El turno se deriva del estado, no de quién aparece dónde.

`aprobador_user_id` y `decidida_at` siguen significando **la decisión final**, así
que ninguna fila anterior cambió de sentido; la primera firma tiene sus propias
columnas. Con una sola firma se rellenan las dos parejas, para que ninguna
consulta de auditoría necesite un `COALESCE`.

### Tres cosas que no se pueden tocar sin romper algo en silencio

1. **El UPDATE de `decidirSolicitud` se condiciona al estado que se leyó**
   (`WHERE estado = $7`), no a un `IN ('pendiente','pendiente_2')`. La lista sería
   igual de atómica y destruiría el 409: dos clics simultáneos del jefe leen los
   dos `pendiente`, pasan los dos el guard, y encadenarían
   `pendiente → pendiente_2 → aprobada` **con una sola persona firmando las dos
   veces**. No hay test que lo cubra —dos peticiones por HTTP no llegan a
   solaparse contra el doble en memoria, y el SQL real necesita Postgres—; solo
   está fijado el cableado, que el servicio pasa el estado que leyó.
2. **`puedeDecidir` separa las ramas por estado.** Escribirlo como un `OR` de los
   dos correos —que es la forma más natural— deja al segundo aprobador firmar una
   solicitud que su jefe todavía no ha visto: la cascada desaparece sin que nada
   falle. En estado terminal sí pasan los dos, para que gane el 409 sobre el 403.
3. **`enTramite` del saldo suma los DOS estados.** `sumar` comparaba un estado
   exacto: con `pendiente_2` fuera, la media firma no sumaba en ningún sitio y
   desaparecía del saldo, ni en trámite ni disfrutada.

### Quién se entera de qué

El acuse inicial menciona las dos firmas solo si hay segunda. No hay correo de
avance intermedio: el empleado recibe el acuse y el veredicto, dos correos, y el
paso de un nivel a otro lo ve en *Mis solicitudes* si le interesa.

**Los correos de decisión van a toda la cadena que firmó**, no solo al
solicitante: `cadenaDeDecision` junta solicitante + los dos aprobadores +
administración. Hasta que se corrigió, el jefe inmediato daba su visto bueno y no
volvía a saber en qué acababa; parecía que funcionaba porque el segundo firmante
suele ser el mismo buzón que ya iba en copia a administración. En el rechazo
importa aún más: si el segundo superior tumba algo que el jefe ya había avalado,
es el jefe quien tiene que reorganizar el trabajo.

> ⚠️ `destinatarios()` deduplica, y no es cosmético: los dos firmantes y la copia
> fija se solapan a menudo —hoy media plantilla cuelga del buzón que ya va en
> copia—, y sin ella el mismo correo aparecería dos veces en el `sendTo` de Gmail.
> También filtra los nulos: `segundoAprobadorCorreo` lo es en toda cadena de una
> sola firma, y sin filtrar saldría un «, ,» en medio de la lista.

### El historial del aprobador

*Pendientes de aprobar* solo enseña lo que toca firmar **ahora**, así que al
decidir algo desaparecía de la vista y no volvía a aparecer en ningún sitio: un
aprobador no tenía forma de responder a «¿qué le aprobé a esta persona en marzo?».
La pestaña *Historial de aprobaciones* (`GET /ausencias/decididas`) lo cubre.

Dos decisiones que conviene no revertir sin pensarlo:

- **Filtra por el correo congelado en la solicitud, no por quién pulsó el botón.**
  `aprobador_user_id` sería más preciso, pero es NULL en las sesiones con token
  legacy: filtrar por él dejaría el historial vacío sin decir por qué. Además una
  solicitud que un admin destrabó en su lugar sigue siendo suya —estuvo en su
  bandeja— y esconderla haría el historial incompleto.
- **Va acotado al propio correo también para un admin.** Para verlo todo está
  *Registro general*; que esta pestaña enseñara la empresa entera la convertiría
  en un duplicado peor de aquella.

⚠️ El `ORDER BY` lleva `NULLS LAST`: el `PATCH` de admin puede dejar una fila en
estado terminal sin tocar `decidida_at`, y sin eso esas filas encabezarían la
lista por delante de las decisiones de esta semana.

⚠️ La columna «Decidida» usa `formatInstante`, no `formatFecha`. La segunda
espera `YYYY-MM-DD` y le concatena `T00:00:00Z`, así que con un `timestamptz`
devuelve «Invalid Date»; y cortar los diez primeros caracteres —lo que primero se
piensa— fecharía al día siguiente todo lo decidido después de las 19:00 hora de
Colombia.

### El mantenimiento del árbol

Se hace en el **panel de organigrama** de la pestaña *Empleados*
(`PanelOrganigrama.tsx`, con el patrón de `PanelSaldos.tsx`), contra
`PUT /ausencias/empleados/:id/jefe`. Autoasignarse es cómo se declara la raíz, no
un ciclo prohibido. El buzón por defecto se acepta aunque no tenga ficha de
empleado: es de quien cuelga toda la plantilla hoy.

> ⚠️ **La importación de empleados por pegado se RETIRÓ** (el bloque «Completar
> cargos desde la hoja» de la pestaña *Empleados*, con su endpoint
> `POST /ausencias/empleados/import`, `validarFilasEmpleados` y
> `repo.importarEmpleados`). Escribía el maestro entero desde la pestaña
> `consolidado`, y su `DO UPDATE SET` pisaba `aprobador_correo` con `EXCLUDED`,
> que viene con el `COALESCE` al buzón por defecto ya aplicado: como el parser del
> navegador mandaba cuatro columnas, **cada reimportación devolvía a toda la
> plantilla al buzón por defecto y borraba el árbol entero**. Se llegó a arreglar
> quitando esa columna del `UPDATE` —no se puede condicionar: dentro del
> `DO UPDATE` no se ve el alias de la SELECT y `EXCLUDED` no distingue «no vino»
> de «vino el valor por defecto»— y luego se retiró la funcionalidad entera: la
> plantilla ya está cargada y el organigrama se mantiene en su propio panel.
> **No reintroducir una vía de escritura masiva del maestro desde la hoja**: es la
> fuente de verdad de quién aprueba a quién, y el proyecto va en la dirección de
> desenchufar esa hoja, no de darle más poder.

Consecuencia asumida: `cargo` y `credencial` ya no se pueden rellenar desde
ningún sitio. Los valores actuales siguen en la base de datos; una ficha nueva
nace sin ellos. `cargo` solo decora (aparece en el aviso al aprobador y en la
tabla del maestro) y `credencial` solo servía para cruzar el histórico de la
hoja, que ya está importado. Si algún día vuelven a hacer falta, lo que toca es
un campo editable por fila en el maestro, no resucitar el pegado.

### Lo que no cubre ningún test

No hay tests en el frontend de esta app. Dos sitios hay que mirarlos con los ojos
tras desplegar, y los dos fallan enseñando algo plausible en vez de romperse:

- **La atenuación del calendario** (`Calendario.tsx`) usa `enTramite(...)`, no
  `=== 'pendiente'`. Con la comparación directa, media firma se pinta sólida:
  **idéntica a una aprobada**.
- **El chip del estado** se pide con `chipDe(...)`, que degrada a gris si no
  conoce el estado. Con el acceso directo al `Record`, un estado desconocido da
  `undefined` y **revienta la tabla entera** al leer `chip.clase`.

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

**La pestaña la abre todo el que tenga ficha de empleado, pero el contenido va
acotado por rol: solo un admin ve a la plantilla entera; el resto recibe
únicamente su propia fila.**

Nació al revés —visible para todos, para poder coordinarse— y se cambió a
petición expresa: la rejilla le enseñaba a cualquiera cuándo falta cada
compañero. Un aprobador tampoco ve a su equipo; si algún día hiciera falta,
el organigrama ya está montado para acotarlo por jerarquía.

El recorte se hace en el SQL (`empleadosActivos` y `ausenciasEntre` reciben un
`soloEmpleadoId`), no filtrando la respuesta: si las marcas ajenas llegaran al
navegador ya estarían expuestas, por mucho que no se pinten. Es la misma lección
del enmascarado de arriba.

> ⚠️ **`null` significa «sin acotar» en los dos repos.** Un usuario sin ficha que
> cayera en esa rama vería la plantilla entera, justo lo contrario de lo que toca;
> por eso el servicio usa un uuid inexistente en vez de `null` cuando no encuentra
> ficha. Hay un test que lo fija.

> ⚠️ **Esto no oculta tanto como parece.** n8n sigue publicando cada ausencia
> aprobada en el Google Calendar «Ambientalia Staff» con el nombre de la persona
> en el título. Quien tenga ese calendario compartido ve lo mismo por otra vía.
> Si el objetivo fuera privacidad real y no orden, habría que revisar también a
> quién está compartido ese calendario.

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
- **`overflow-y-auto` en el `<main>` anula el `sticky` de la cabecera — el que
  más caro salió.** `position: sticky` se resuelve contra el scrollport más
  cercano, y `overflow-y: auto` crea uno exista o no desbordamiento. El
  `<main>` de esta app nunca desborda: ningún ancestro le fija altura — el
  contenedor raíz del portal usa `min-h-screen` (`min-height`, con
  `height: auto`) y el propio `<main>` es `flex-grow` (equivale a
  `flex-grow: 1`, no al atajo `flex: 1`). Así que un `overflow-y-auto` ahí
  crearía un scrollport que jamás se desplaza, y `sticky top-0` quedaría
  anclado a un contenedor inerte: la clase sigue aplicada, nada falla ni
  avisa, y la cabecera con el saldo simplemente deja de acompañar el scroll.
  Otras páginas del portal (Dashboard, Herramientas) sí llevan
  `overflow-y-auto` en su `<main>` — quien copie ese patrón aquí rompe el
  sticky en silencio.
- **`apps/ausencias/tsconfig.json` es más estricto que el del portal, y como
  gate propio no lo ejecuta nadie — pero el código sí se typechequea, con las
  reglas equivocadas.** Trae `verbatimModuleSyntax`, `noUnusedLocals` y
  `noUnusedParameters` en `true`; `apps/portal/tsconfig.app.json` los trae en
  `false` a propósito, porque empaqueta el código fuente de cada sub-app y
  tiene que admitir convenciones distintas de las suyas. El `build` de
  `ausencias` es `vite build` a secas —esbuild transpila sin comprobar
  tipos— y no hay paso de CI dedicado a esta app. Pero el portal importa
  `apps/ausencias/src/App` (la ruta `/ausencias`) y `widgets/index` (el
  catálogo) con imports normales, así que el propio `tsc -b` del portal
  arrastra TODO el árbol de `ausencias/src` a su programa y lo compila con
  las reglas relajadas del portal, no con las suyas — verificado con
  `tsc --listFilesOnly`. El resultado es un typecheck automático en cada CI,
  solo que el más flojo de los dos: código que violara `noUnusedLocals` o
  `verbatimModuleSyntax` pasaría igual. El gate estricto propio,
  `npx tsc --noEmit -p apps/ausencias/tsconfig.json`, sigue siendo un
  comando manual que hay que acordarse de teclear — hoy sale limpio, igual
  que el del portal. Convertirlo en portón sería una línea
  (`"build": "tsc --noEmit && vite build"`), y está **pendiente de
  decisión**, no hecho.

## Puesta en marcha

1. `git push origin main` y **redesplegar hub-api** (corre la migración 015) y
   luego el **portal**. Son dos servicios distintos; commit local ≠ desplegado.

   > ⚠️ **Para la aprobación en cascada el orden es el CONTRARIO: primero el
   > portal, después hub-api.** Si hub-api va delante, el bundle viejo del portal
   > recibe `estado: 'pendiente_2'` y —antes de que existiera `chipDe`— reventaba
   > la tabla entera para todo el que tuviera algo en trámite. Al revés no pasa
   > nada: los campos nuevos llegan como `undefined` y la app degrada a un solo
   > nivel; solo el botón «Guardar» del organigrama da 404 unos minutos, en una
   > pestaña de admin. La regla general: **quien primero deja de entender al otro
   > va detrás.**
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
   desde el portal** para tener la lista completa de una vez.
6. Activar el workflow **«Ausencias — Portal»** en n8n.
7. Convivencia: dejar el flujo viejo (`mt75OpO0fGIXv5QG`) activo unos días y
   **desactivarlo** —no borrarlo— cuando el nuevo lleve una semana sin incidencias.
8. *(Cascada)* **Se despliega apagada y se enciende sola.** Toda la plantilla
   cuelga hoy de `comercial@ambientalia.com.co`, y ese buzón es su propio jefe por
   el mismo DEFAULT: raíz, luego `segundo = null` para todo el mundo y una sola
   firma, exactamente como antes. La cascada se activa persona a persona según se
   rellena el organigrama en *Empleados*. No hay big bang: desplegar, comprobar
   que nada cambió, y empezar por una sola persona de prueba.

## Pendiente (backlog)

- Cargar los saldos iniciales del consolidado (nombre, días y a qué fecha son
  válidos) en la pestaña *Saldos*. Hasta entonces todo el mundo aparece como
  "sin configurar", que es el comportamiento correcto.
- Rellenar el organigrama en *Empleados*. Hasta que se haga, todo el mundo cuelga
  del buzón por defecto y firma una sola persona.
- Retirar la copia a Google Sheets cuando Nómina consulte solo el portal.
- Widget de dashboard con las ausencias del mes.
- **Desactivar el flujo viejo `mt75OpO0fGIXv5QG`.** Sigue `active: true` con su
  formulario público y sus propios nodos de Google Drive, así que cualquiera con
  la URL guardada puede seguir mandando solicitudes que esquivan el portal — y
  subiendo PDF a Drive. Mientras siga encendido, «Drive fuera» es solo la mitad.
- Registro de descargas de adjuntos, si `VISORES_ADJUNTOS` crece.


