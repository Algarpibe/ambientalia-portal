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
| Una sola firma, siempre el mismo buzón | **Firma en cascada**: el jefe inmediato y, si la ficha del solicitante lo exige, el superior de ese jefe | Un solo aprobador para toda la empresa no es una jerarquía, es un cuello de botella |
| El rechazo no decía el motivo | El motivo viaja en el correo y queda en la BD | Obligaba a preguntar por otro canal |
| Sin historial para el empleado | Pestaña «Mis solicitudes» | — |

Lo que **no** cambió, a propósito: los textos de los correos, el calendario
«Ambientalia Staff» y las cuatro pestañas de la hoja
`consulta_vacaciones` con sus encabezados. Nómina no tiene que cambiar nada.

## Piezas

- **Frontend**: `apps/ausencias/` — pestañas *Nueva solicitud*, *Mis solicitudes*
  y *Calendario*; *Pendientes de aprobar* e *Historial de aprobaciones* si eres
  aprobador o admin; *Soportes adjuntos* si eres admin o tienes la casilla
  **Soportes** marcada en el Organigrama; *Empleados*, *Organigrama*, *Saldos*
  y *Registro general* solo admin.
- **Backend**: `apps/hub-api/src/ausencias/`
  - `festivos.ts` / `dias-habiles.ts` — el cálculo, con tests.
  - `saldo.ts` / `calendario.ts` / `jerarquia.ts` — módulos puros, con tests.
  - `config.ts` — ids de Google, correos en copia, firmas. **Un único sitio.**
  - `notificaciones.ts` — los correos y los efectos en Google, redactados aquí.
  - `service.ts` — validación y casos de uso. `repo.ts` — SQL. `router.ts` — HTTP.
- **BD**: migración `015_ausencias.sql` → `portal.empleados`,
  `portal.solicitudes_ausencia`, `portal.solicitud_adjuntos`,
  `portal.ausencias_outbox`; `017` el saldo, `018` la cascada de dos firmas, `019`
  la reserva del outbox, `020` la retirada de Drive, `021` la copia configurable,
  `022` los visores configurables y `023` la segunda firma opcional por ficha
  (`empleados.requiere_segunda_firma`) con el correo de quien solo se entera del
  resultado (`solicitudes_ausencia.informado_correo`).
- **n8n**: workflow **«Ausencias — Portal»** (`dh0xjWCHsGj9raYH`), 13 nodos.

## No se piden días que ya pasaron

`validarNuevaSolicitud` rechaza con **`fecha_en_pasado`** (400) cualquier alta
cuya `fechaInicio` sea anterior a hoy… **salvo las incapacidades**. Esa excepción
es la razón de que la regla mire el tipo, y no es un capricho: una incapacidad se
*informa* después de haber estado enfermo —uno va al médico, vuelve y sube el
soporte—, así que exigirle fecha de hoy en adelante haría imposible el caso
normal. Los tres tipos que sí requieren firma (vacaciones, permiso y
compensatorio) van juntos: si la regla mirara solo `vacaciones`, quedaría abierta
la misma puerta por otro lado.

El motivo de fondo es que aprobar el pasado no significa nada: cuando llegara la
firma, los días ya se habrían disfrutado (o no) y el saldo ya no se podría
reservar.

**El `min` de los `<input type="date">` es solo la barrera cómoda.** Se puede
teclear por encima, así que la regla de verdad vive en el servidor y hay un test
por HTTP que lo fija, no solo el de la función pura.

`hoy` se **inyecta** en `validarNuevaSolicitud` en vez de leerse del reloj, por lo
mismo que en `calcularSaldo`: para poder probar la regla sin depender del día en
que se ejecuten los tests. Quien llama pasa `hoyEnColombia()` — el desfase UTC−5
se resta ANTES de tomar la fecha, o entre las 19:00 y medianoche hora local el
servidor ya estaría en el día siguiente y rechazaría por «pasada» una solicitud
para mañana. El frontend usa el espejo de esa misma función en `dominio.ts`, y no
la fecha local del navegador: si se guiara por la zona del equipo, alguien fuera
del país vería habilitado un día que el servidor va a rechazar.

**Consecuencia para los tests:** `router.test.ts` congela `Date` en 2026-01-15
(solo `Date`, no los temporizadores, que supertest necesita). Sus fechas son
literales a propósito —caen en días concretos de la semana y rodean festivos
concretos, y de ahí salen los recuentos de días hábiles que afirma—, así que no
se pueden volver relativas a hoy sin perder lo que comprueban; y con el reloj
real, el servidor las rechazaría en cuanto el calendario las dejara atrás.
`service.test.ts` hace lo mismo con una constante `HOY`.

Lo que **no** pasa por esta regla, a propósito: la importación del histórico
(fechas viejas por definición) y la edición de un admin desde *Registro general*.

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
| `aprobada` | aprobado, a **toda la cadena** —incluido el informado— (+ la copia de la ficha) | ✔ | ✔ |
| `rechazada` | rechazado con motivo, a **toda la cadena** —incluido el informado— (+ la copia de la ficha) | — | ✔ |
| `registrada` | acuse de incapacidad (+ `COPIA_INCAPACIDADES` y la copia de la ficha) | ✔ | ✔ |

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
| `GET` | `/api/ausencias/adjuntos` | idem — solo admin o quien tenga la llave de los adjuntos (`ve_adjuntos`); **403** al resto |
| `GET` | `/api/ausencias/adjuntos/:id` | idem — dueño, **quien la firma** (uno o dos, según la ficha; **nunca el informado**), admin o quien tenga la llave de los adjuntos |
| `GET` | `/api/ausencias/saldos` | idem — acotado: admin ve a todos, aprobador los suyos y los de sus «nietos» |
| `GET` | `/api/ausencias/mi-saldo` | idem — solo el saldo propio; **500** si el cálculo falla, no un saldo en blanco |
| `GET` | `/api/ausencias/calendario?mes=YYYY-MM` | idem — **acotado**: admin ve la plantilla, el resto solo su fila |
| `PUT` | `/api/ausencias/empleados/:id/saldo` | `requireAdmin` |
| `PUT` | `/api/ausencias/empleados/:id/jefe` | `requireAdmin` — **409** si cerraría un círculo |
| `PUT` | `/api/ausencias/empleados/:id/copia` | `requireAdmin` — a quién se pone en copia; `null` = a nadie |
| `PUT` | `/api/ausencias/empleados/:id/visor` | `requireAdmin` — da o quita la llave de los adjuntos; **queda registrado** |
| `PUT` | `/api/ausencias/empleados/:id/segunda-firma` | `requireAdmin` — si sus solicitudes necesitan la segunda firma o basta con la del jefe inmediato |
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
| `GET /ausencias/mi-saldo` | cualquiera con la app — el mismo saldo propio, pero solo: lo usan el widget del dashboard y el refresco de la cabecera (los tres disparos están en «Lo que no refresca») |
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

En el formulario se le pasa **`soloSiAvisa`**: con el indicador de la cabecera a
un palmo, repetir ahí el mismo número era ruido. Con esa prop la tarjeta se
calla mientras no tenga nada que añadir, y aparece solo para las dos cosas que
el indicador no cubre —que falta configurar el saldo, o que los días pedidos no
caben—. El contenedor lleva `empty:hidden` porque su `mb-4` dejaría un hueco de
16 px cuando la tarjeta no renderiza.

La bandeja **no** pasa esa prop, y no debe pasarla: allí el saldo es de otra
persona y no está en ninguna otra parte de la pantalla.

**El widget** (`ausencias-mi-saldo`, tamaño `4×3`) lo sirve
`GET /ausencias/mi-saldo`, no `/ausencias/contexto`: la home del portal no
tiene por qué cargar los festivos de tres años para pintar un número. `3×2`
se probó primero y no cupo —la celda deja 117 px de contenido y el widget
mide 120 px en cuanto hay algo en trámite, justo la gente para la que
existe la línea de aviso—. Y el tamaño del descriptor solo manda hasta que
alguien añade el widget: `addWidget` copia `defaultSize` al layout que
persiste en el `localStorage` de cada usuario, así que ajustarlo más tarde
no habría corregido a quien ya lo tuviera añadido con el valor viejo.

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

## La copia de los correos

Quién va en copia de los correos de una persona dejó de ser una constante para
toda la empresa —`COPIA_ADMINISTRACION`, con `comercial@` y `administrativo@`
fijos— y pasó a ser un campo de su ficha: `portal.empleados.copia_correo`
(migración `021`), editable desde la pestaña *Organigrama*. `NULL` es sin
copia.

Entra en dos sitios del código, y son los únicos: `cadenaDeDecision`
—que junta solicitante, quien firmó, el informado y la copia para `aprobada` y
`rechazada`— y la rama de incapacidad de `acuseSolicitante`. El acuse de una
solicitud normal y los avisos a los aprobadores no llevan copia, y hay
tests que fijan cada una de esas ausencias para que la lista de destinatarios
no crezca por descuido el día que alguien retoque estas funciones.

**`comercial@` sigue fijo en el acuse de incapacidad**, vía `COPIA_INCAPACIDADES`
en `config.ts`, y es la única mitad de la vieja `COPIA_ADMINISTRACION` que
sobrevive —la otra, `administrativo@`, pasó a vivir en la ficha, sembrada por
la `021`—. El motivo no es cosmético: una incapacidad genera un único evento,
`registrada`, y nunca uno de decisión, así que ese buzón no le llega por
`cadenaDeDecision` como en aprobada y rechazada. Sin la constante, gerencia
habría dejado de enterarse de las incapacidades el día del despliegue —el plan
de esta feature decía que el cambio no perdía nada, y para esta mitad era
falso.

**La copia no se congela en el alta**, al revés que los firmantes y que el
informado, y la diferencia es de fondo, no de forma: la copia es una
**preferencia de aviso** de la ficha, mientras que los otros tres salen del
**árbol** en el momento del alta. Por eso la línea divisoria no es «permiso sí,
aviso no» —el informado tampoco decide nada y aun así se congela—, sino de dónde
nace el dato: un cambio de organigrama a mitad de trámite no debe reescribir a
quién se le prometió el resultado, pero corregir una copia mal puesta sí debe
arreglar lo que ya está en vuelo. `SELECT_SOLICITUD`
la lee de `portal.empleados` al construir cada correo, así que corregir una
copia mal puesta en el organigrama arregla también lo que ya está en trámite.
Sale gratis: el `JOIN` con `empleados` ya estaba ahí por `aprobador_correo`,
`nombre_completo` y `cargo`.

La migración siembra `administrativo@ambientalia.com.co` con un `DEFAULT` en
el `ADD COLUMN`, nunca con un `UPDATE`: `initDb()` re-ejecuta las migraciones
en cada arranque, y un `UPDATE` machacaría en cada despliegue cualquier copia
que se hubiera ajustado a mano desde el panel.

El `DEFAULT` se queda después de sembrar. Consecuencia asumida: toda ficha
nueva nace con administración en copia sin que nadie lo decida, y eso incluye
el acuse de sus propias incapacidades. Es reversible con **la siguiente
migración libre** —hoy la `024`, porque la `023` ya existe y es la segunda firma
opcional— que haga `ALTER COLUMN copia_correo DROP DEFAULT`. Y el literal de la `021` no se edita
nunca en sitio para cambiar el valor sembrado: las bases que ya la corrieron
no se enterarían —el `IF NOT EXISTS` corta— pero una base nueva sí, y los
entornos divergirían en silencio; para cambiarlo hace falta una migración
nueva con `ALTER COLUMN ... SET DEFAULT`.

**`COPIA_POR_DEFECTO`** hace por la copia lo mismo que `APROBADOR_POR_DEFECTO`
hace por el jefe: el endpoint valida el correo contra los empleados activos,
pero acepta ese buzón aunque su ficha se desactive. Sin la excepción, el valor
con el que la `021` sembró toda la plantilla se volvería irreponible desde el
panel en cuanto alguien lo cambiara.

**El aviso de privacidad.** Quien queda en copia recibe también los acuses de
incapacidad de esa persona, que son datos de salud —la migración `022` ya cita
la Ley 1581 a propósito de la llave de los adjuntos, y aplica igual aquí—, y el
panel lo advierte en ámbar antes de guardar. La llave de los adjuntos no cambia
con esto: estar en copia da el aviso de que existe una incapacidad, no el
acceso al PDF del soporte. Son dos permisos distintos, y uno no implica el otro.

## Los adjuntos

**El PDF vive en PostgreSQL, y siempre ha vivido ahí.**
`portal.solicitud_adjuntos.contenido` es un `BYTEA NOT NULL` que se escribe en la
misma transacción que la solicitud. Google Drive era una copia secundaria que n8n
subía después tirando del propio hub-api; **se retiró**.

El binario no viaja en ninguna lista: `SELECT_SOLICITUD` trae
`octet_length(a.contenido)` y nada más. La única consulta que lo lee es
`adjuntoPorId`, y solo la usa `GET /ausencias/adjuntos/:id`.

### Quién puede abrir uno

`puedeVerAdjunto`: el solicitante, su jefe inmediato, la segunda firma,
cualquier admin, y quien tenga la casilla **Soportes** marcada en el
Organigrama. La ruta devuelve **404 y no 403** a quien no pasa: quien no tiene
nada que ver con la solicitud tampoco debería poder confirmar que ese adjunto
existe.

**El informado NO está en esa lista, y es deliberado.** Cuando la ficha del
solicitante no exige segunda firma, el de segundo nivel recibe el correo del
resultado pero no abre el soporte de esa solicitud: enterarse de que alguien
estuvo incapacitado no es lo mismo que poder leer su parte médico. La función
no necesitó ninguna rama nueva para conseguirlo —compara contra
`segundoAprobadorCorreo`, e `informado_correo` es otra columna—, así que el
día que alguien decida lo contrario tendrá que añadirla a mano. Lo fija el bloque
`el informado no hereda ningún permiso del segundo firmante` de `service.test.ts`,
que le pasa a `puedeVerAdjunto` un adjunto **con** `informadoCorreo` puesto
aunque `AdjuntoCompleto` no tenga hoy ese campo: sin ese detalle, ampliar la
función para mirar al informado dejaría el test en verde por comparar contra
`undefined`. La única vía por la que un informado sí abriría el PDF es la casilla
**Soportes**, que es una llave maestra y no tiene nada que ver con esta solicitud
en concreto — y ese caso también está fijado.

El jefe lo tiene también en la práctica, no solo sobre el papel: *Pendientes
de aprobar* (`BandejaAprobacion.tsx`) monta la misma `TablaSolicitudes` que
pinta el clip de descarga en *Soportes adjuntos*, así que quien firma ve el
PDF de la solicitud que está decidiendo sin salir de su bandeja.

**La lista salió de `config.ts` a `portal.empleados.ve_adjuntos`** (migración
`022`), editable ficha a ficha desde el Organigrama, y **cada cambio queda
registrado** en `portal.visores_adjuntos_log`: quién lo dio o lo quitó, sobre
quién, y cuándo. El motivo es literal, no cosmético: al salir del código, git
dejó de ser el historial de estos accesos, y los logs de EasyPanel se rotan —
sin esta tabla, dentro de unas semanas nadie podría reconstruir quién tuvo la
llave el día que hiciera falta saberlo. El registro guarda el **correo además
del id**, y **sin clave foránea**: si la ficha se borra, el rastro de a quién
se le dio la llave tiene que sobrevivirla. Se escribe **solo cuando el valor
cambia** — el botón del panel guarda la fila entera (jefe, copia y visor
juntos), así que llegaría al endpoint también al tocar solo el jefe o la
copia, y sin esa comprobación cada guardado dejaría una fila de auditoría que
no cambió nada.

`puedeVerAdjunto` **sigue siendo pura**: el booleano entra por parámetro y lo
resuelve quien llama con `repo.esVisorDeAdjuntos`, en vez de que la propia
función consulte la BD. La razón es la misma de siempre en esta app: **no hay
Postgres en ningún test** del repo, y meterle el `Pool` la sacaría de la red
de tests que hoy la cubre.

**La llave AÑADE acceso y nunca lo condiciona.** Quitársela a alguien no puede
dejarle sin ver sus propias solicitudes ni las que firma como aprobador — hay
un test dedicado a eso (`quitar la llave no cierra el adjunto a quien lo
pidió ni a quien lo firma`).

**El sembrado de la 022 no usa un `DEFAULT`** como la 021, porque aquí el
valor de arranque no es el mismo para todos: solo dos correos nacen con la
llave, no la plantilla entera. El `UPDATE` va **dentro del `IF NOT EXISTS`**
que protege el `ADD COLUMN`, y no suelto como cualquier `UPDATE`:
`initDb()` re-ejecuta las migraciones en cada arranque, y sin esa guarda
devolvería la llave a quien un admin se la hubiera quitado, en cada
despliegue. Y va **dentro de un `EXECUTE`** para no depender de cuándo plpgsql
planifica: la sentencia referencia una columna que se acaba de crear dos líneas
más arriba en el mismo `DO`, y `EXECUTE` difiere el análisis hasta el momento
de ejecutarla, cuando la columna existe sin lugar a dudas. En la práctica
plpgsql planifica de forma perezosa y habría funcionado igual, así que no es
que sin él «no compile»; es que el margen de duda no compensa cuando el precio
de equivocarse es que hub-api no arranque y se caiga el portal entero.

> ⚠️ **En una base virgen el sembrado afecta a 0 filas.** `portal.empleados`
> está vacía en el instante en que corre la migración —las fichas se crean
> solas al primer acceso de cada persona, no antes—, y el guard `IF NOT
> EXISTS` impide reintentarlo en el arranque siguiente. En producción no
> aplica, porque las fichas ya existían cuando se desplegó la 022, y es
> recuperable aunque pasara: un admin sigue teniendo acceso sin necesitar la
> llave. Pero en un entorno nuevo hay que dar la llave a mano desde el
> Organigrama la primera vez.

**Lo que sigue sin haber: registro de descargas.** Se sabe **quién tenía** la
llave y desde cuándo —eso es justo lo que añade `visores_adjuntos_log`—, pero
no **quién la usó**: `/adjuntos/:id` no loguea nada al servir el PDF. Si la
lista de visores crece, ese log es lo siguiente que hace falta.

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

Una solicitud la firma **el jefe inmediato** y, **si la ficha del solicitante lo
exige**, después el superior de ese jefe. La primera firma la deja en
`pendiente_2`; la segunda la pasa a `aprobada`. Se queda con una sola firma quien
reporta a la cúspide del organigrama **y también quien tenga apagada la casilla
«Necesaria» de su ficha** — en ese segundo caso la primera firma cierra la
solicitud, y el de arriba sigue recibiendo el correo del resultado sin firmar
nada. Lo explica entero «La segunda firma es opcional por ficha», más abajo.

### El organigrama es una sola columna

`portal.empleados.aprobador_correo` significa **«el correo de mi jefe
inmediato»**. No hay tabla de jerarquía ni segundo aprobador guardado en el
maestro: el segundo se **deriva subiendo un escalón**, que es lo que hace que el
árbol exista una sola vez y no pueda desincronizarse consigo mismo.

Las reglas viven en `apps/hub-api/src/ausencias/jerarquia.ts`, puro y con tests
—misma convención que `saldo.ts` y `calendario.ts`—. `aprobadoresDe` devuelve
`{ primero, segundo, informado }`, y hay **cuatro cortes** que dejan a la vez
`segundo` e `informado` en `null` porque no hay nadie de segundo nivel: el jefe
no tiene ficha **activa** (y entonces **no salta al abuelo**), el jefe es su
propio jefe (raíz), el jefe del jefe ya firma primero, o el jefe del jefe es el
propio solicitante. Este último corta los ciclos de dos: sin él, A se firmaría a
sí mismo la segunda aprobación.

> **Los cuatro cortes se aplican ANTES de mirar la casilla**, y ese orden es la
> propiedad: apagar la segunda firma no puede inventar un destinatario donde el
> árbol ya se acababa. Solo cuando existe alguien de segundo nivel decide la
> casilla su papel — firmante (`segundo`) o informado (`informado`).

> ⚠️ **`creariaCiclo` lleva un `Set` de visitados y no es defensivo.** Si ya hay
> un ciclo en la base de datos ajeno al empleado que se edita, un recorrido sin
> visitados deja un handler de Express girando para siempre — no es un error que
> se vea, es un cuelgue. Hay un test con `timeout` que lo convierte en un fallo.

Un ciclo que ya esté en la base de datos **no bloquea la edición**: bloquearla lo
haría imposible de deshacer desde el panel. Se avisa en ámbar y `aprobadoresDe`
lo corta.

### La segunda firma es opcional por ficha

`portal.empleados.requiere_segunda_firma` (migración `023`) decide si las
solicitudes de esa persona necesitan la firma del jefe de su jefe o basta con la
del jefe inmediato. Se enciende y se apaga **por trabajador**, desde la casilla
**Necesaria** de la columna «2ª firma» del panel *Organigrama*, contra
`PUT /ausencias/empleados/:id/segunda-firma` (solo admin, cuarto endpoint del
panel).

**Toda la plantilla arrancó con la casilla encendida.** La `023` la añade con
`DEFAULT TRUE` y **sin ningún `UPDATE`**, por la misma razón que la `021`:
`initDb()` re-ejecuta las migraciones en cada arranque, y un `UPDATE` devolvería
la doble firma en cada despliegue a quien se la hubieran quitado desde el panel.
El día del despliegue, por tanto, no cambió nada para nadie. El `DEFAULT` se
queda después de sembrar, también a propósito: `asegurarEmpleado` crea fichas
solas en el primer acceso de cada persona, y así ninguna nace saltándose una
firma por descuido.

**De firmante a informado, no a nadie.** Cuando hay alguien de segundo nivel y la
casilla está apagada, ese alguien **no desaparece del circuito**: pasa a
`informado_correo` y sigue recibiendo el correo del resultado —el de la
aprobación **y** el del rechazo—. Lo que pierde es todo lo demás:

- **No firma.** `puedeDecidir` compara contra los dos correos de firma y no
  contra el informado, ni con la solicitud pendiente ni con la solicitud ya en
  estado terminal — donde a los firmantes sí se les deja pasar para que gane el
  409 sobre el 403, y a él no.
- **No abre el soporte adjunto** de esa solicitud (ver «Quién puede abrir uno»),
  salvo que tenga la llave maestra **Soportes**, que es otra vía y no depende de
  esta solicitud.
- **No le cuenta en su «Historial de aprobaciones».** `solicitudesDecididas`
  filtra por `aprobador_correo` o `segundo_aprobador_correo`; el informado no
  aparece en ninguno de los dos, y eso es lo correcto: no aprobó nada.

**Firmante e informado son EXCLUYENTES, y de eso depende todo lo demás.**
`segundo_aprobador_correo` tiene valor si firma; `informado_correo` si solo se
entera; **nunca los dos**. Esa exclusión es la razón de que esta feature no haya
tenido que tocar la máquina de estados, el permiso de firma, el del adjunto ni el
historial: mientras `segundo_aprobador_correo` sea `NULL`, «una sola firma» sigue
significando exactamente lo que ya significaba, y todo el código que lo lee sigue
siendo correcto sin un solo condicional nuevo.

> ⚠️ **Nada la fuerza salvo la disciplina.** La `023` **no lleva ningún `CHECK`**
> y el tipo `Solicitud` tampoco impide que los dos campos tengan valor a la vez.
> La exclusión la garantizan dos sitios y solo dos: `aprobadoresDe`, que deriva
> los dos campos juntos en la misma llamada, y `crearSolicitud`, que los congela
> de esa misma llamada. **Cualquier vía nueva que escriba estos dos campos tiene
> que respetarla a mano** — si un día coexisten, el informado empezaría a recibir
> correos de una solicitud que además está esperando su firma, y ninguna de las
> piezas de arriba avisaría. Hay un test que fija la invariante
> (`firmante e informado nunca tienen valor a la vez`, `jerarquia.test.ts`).

**El reparto se congela en el alta**, así que cambiar la casilla **no mueve nada
que ya esté en trámite**: una solicitud creada con doble firma la sigue
necesitando aunque después se apague la casilla, y al revés. Es la misma regla
que ya valía para los firmantes, y la sección siguiente la explica.

**En el maestro, en cambio, se recalcula en cada consulta.**
`EmpleadoConJefatura` trae `segundoAprobadorCorreo` **e** `informadoCorreo` —los
dos, por la misma exclusión— para que el panel pueda decir QUIÉN está en el
escalón de arriba aunque hoy no firme. No confundir ese `informadoCorreo` con el
de `Solicitud`: aquel es una foto del alta, este cambia en cuanto se mueve el
organigrama o se toca la casilla.

### Los firmantes se congelan en el alta

La solicitud guarda `aprobador_correo`, `segundo_aprobador_correo` e
`informado_correo` en el momento de crearse. Mover el organigrama —o cambiar la
casilla de la segunda firma— **no mueve nada que ya esté en trámite**. La
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

El acuse inicial menciona las dos firmas solo si de verdad hay **segunda firma**
—mira `segundoAprobadorCorreo`, no si hay alguien arriba—, así que con la casilla
apagada el solicitante no recibe la promesa de una espera que no va a ocurrir. No
hay correo de avance intermedio: el empleado recibe el acuse y el veredicto, dos
correos, y el paso de un nivel a otro lo ve en *Mis solicitudes* si le interesa.

**Los correos de decisión van a toda la cadena**, no solo al solicitante:
`cadenaDeDecision` junta solicitante + quien firmó + **el informado** +
administración. Hasta que se corrigió, el jefe inmediato daba su visto bueno y no
volvía a saber en qué acababa; parecía que funcionaba porque el segundo firmante
suele ser el mismo buzón que ya iba en copia a administración. En el rechazo
importa aún más: si el segundo superior tumba algo que el jefe ya había avalado,
es el jefe quien tiene que reorganizar el trabajo.

El informado entra ahí por lo mismo: apagarle la firma a alguien no era quitarle
la información. Sin ese cuarto destinatario, encender la casilla habría dejado en
silencio a quien hasta ese día se enteraba de todo lo que firmaba su equipo —y
nadie lo habría notado hasta echar de menos un correo que ya no llega.

> ⚠️ `destinatarios()` deduplica, y no es cosmético: los firmantes, el informado y
> la copia se solapan a menudo —hoy media plantilla cuelga del buzón que ya va en
> copia—, y sin ella el mismo correo aparecería dos veces en el `sendTo` de Gmail.
> También filtra los nulos: `segundoAprobadorCorreo` e `informadoCorreo` son
> `null` por turnos —nunca los dos a la vez tienen valor, y en una cadena de un
> solo escalón lo son los dos—, y sin filtrar saldría un «, ,» en medio de la
> lista.

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

**El informado no aparece aquí.** El `WHERE` mira `aprobador_correo` y
`segundo_aprobador_correo`, y nada más: una solicitud de la que solo se recibió
el correo del resultado no es una aprobación de nadie, y meterla en el historial
diría que esa persona la firmó. Quien quiera el rastro completo de una solicitud
así lo tiene en *Registro general* (admin) o en el propio correo.

⚠️ El `ORDER BY` lleva `NULLS LAST`: el `PATCH` de admin puede dejar una fila en
estado terminal sin tocar `decidida_at`, y sin eso esas filas encabezarían la
lista por delante de las decisiones de esta semana.

⚠️ La columna «Decidida» usa `formatInstante`, no `formatFecha`. La segunda
espera `YYYY-MM-DD` y le concatena `T00:00:00Z`, así que con un `timestamptz`
devuelve «Invalid Date»; y cortar los diez primeros caracteres —lo que primero se
piensa— fecharía al día siguiente todo lo decidido después de las 19:00 hora de
Colombia.

### El mantenimiento del árbol

Se hace en la pestaña *Organigrama* (solo admin; hasta 2026-08-14 vivía dentro de *Empleados*)
(`PanelOrganigrama.tsx`, con el patrón de `PanelSaldos.tsx`), contra
`PUT /ausencias/empleados/:id/jefe`. Autoasignarse es cómo se declara la raíz, no
un ciclo prohibido. El buzón por defecto se acepta aunque no tenga ficha de
empleado: es de quien cuelga toda la plantilla hoy.

**Un solo botón por fila, pero CUATRO endpoints detrás** —jefe, 2ª firma, copia y
soportes—, y se llama a cada uno **solo si su campo cambió**. Van **secuenciales,
no en paralelo**: los cuatro responden el maestro entero, así que con
`Promise.all` la respuesta que llegara última podría ser la construida ANTES de
los otros cambios. Después se recarga el maestro completo y no solo esa fila:
cambiar el jefe de alguien cambia quién está en el escalón de arriba de todos los
que cuelgan de él.

En la columna «2ª firma» conviven dos cosas que salen de sitios distintos, y la
diferencia importa si se toca el componente: **quién** está arriba se lee de lo
**guardado** (`e`) —cambiar el jefe en el desplegable cambia el abuelo y el
navegador no puede recalcularlo—, mientras que su **papel** («— solo informado»)
se lee de lo **editado** (`fila`), porque los cuatro cortes de `aprobadoresDe` se
aplican antes de mirar la casilla: firmante o informado es el mismo correo en
otra ranura, no hay nada que adivinar.

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

No hay tests en el frontend de esta app. Tres sitios hay que mirarlos con los ojos
tras desplegar, y los tres fallan enseñando algo plausible en vez de romperse:

- **La atenuación del calendario** (`Calendario.tsx`) usa `enTramite(...)`, no
  `=== 'pendiente'`. Con la comparación directa, media firma se pinta sólida:
  **idéntica a una aprobada**.
- **El chip del estado** se pide con `chipDe(...)`, que degrada a gris si no
  conoce el estado. Con el acceso directo al `Record`, un estado desconocido da
  `undefined` y **revienta la tabla entera** al leer `chip.clase`.
- **La columna «2ª firma» del Organigrama** (`PanelOrganigrama.tsx`): la casilla
  **Necesaria** y la línea de debajo que dice quién está arriba y si firma o solo
  se entera.

> ⚠️ **La columna «2ª firma» no tiene NINGUNA red automática.** El backend que
> hay detrás sí —endpoint, servicio, repo y `aprobadoresDe` están cubiertos—,
> pero la casilla en sí no la comprueba nada: `apps/ausencias` no tiene tests, y
> su `typecheck` estricto **no es portón** (ver el último punto de «Gotchas que
> costaron»: el `build` es `vite build` a secas y nadie corre
> `tsc -p apps/ausencias/tsconfig.json`). Su **única** verificación es abrirla en
> el navegador y mirarla. Los modos de fallo son de los que no se ven: la casilla
> guardando sin que nadie la mire, el `!!` que evita que el checkbox se vuelva no
> controlado si el backend deja de mandar el campo, o la línea de abajo diciendo
> «— solo informado» de un correo que ya no está arriba. **El próximo que la
> toque tiene que probarla a mano.**

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
  `height: auto`), así que no hay un alto fijo contra el que desbordar. Un
  `overflow-y-auto` ahí crearía un scrollport que jamás se desplaza, y
  `sticky top-0` quedaría anclado a un contenedor inerte: la clase sigue
  aplicada, nada falla ni avisa, y la cabecera con el saldo simplemente deja
  de acompañar el scroll. Otras páginas del portal (Dashboard, Herramientas)
  sí llevan `overflow-y-auto` en su `<main>` — quien copie ese patrón aquí
  rompe el sticky en silencio.
- **`apps/ausencias/tsconfig.json` es más estricto que el del portal, y como
  gate propio no lo ejecuta nadie — pero el código sí se typechequea, con las
  reglas equivocadas.** Trae `verbatimModuleSyntax`, `noUnusedLocals` y
  `noUnusedParameters` en `true`; `apps/portal/tsconfig.app.json` los trae en
  `false` a propósito, porque empaqueta el código fuente de cada sub-app y
  tiene que admitir convenciones distintas de las suyas. El `build` de
  `ausencias` es `vite build` a secas —esbuild transpila sin comprobar
  tipos— y no hay paso de CI dedicado a esta app. Pero el portal importa
  `apps/ausencias/src/App` (la ruta `/ausencias`) y `widgets/index` (el
  catálogo) con `import()` dinámico —para el code-splitting de Vite—, y eso
  no cambia nada a efectos de tipos: `tsc` resuelve el especificador igual
  que en un import estático y arrastra el módulo a su programa. Así, el
  propio `tsc -b` del portal typechequea **20 de los 21** ficheros de
  `ausencias/src` —falta `main.tsx`, la entrada suelta de la app que nadie
  importa, y que por eso es el único punto donde esta red automática tiene
  un agujero real— con las reglas relajadas del portal, no con las suyas;
  verificado con `tsc --listFilesOnly`. El resultado es un typecheck
  automático en cada CI, solo que el más flojo de los dos: código que
  violara `noUnusedLocals` o `verbatimModuleSyntax` pasaría igual. El gate
  estricto propio, `npx tsc --noEmit -p apps/ausencias/tsconfig.json`,
  sigue siendo un comando manual que hay que acordarse de teclear — hoy
  sale limpio, igual que el del portal.
  **Convertirlo en portón NO es solo una línea.** Cambiar el `build` de
  `ausencias` a `"tsc --noEmit && vite build"` no basta, porque nada
  ejecuta ese `build`: el CI (`.github/workflows/ci.yml`) solo corre
  `npm run build` para `apps/portal` y `apps/hub-api`, y el `build` de la
  raíz (`npm run build --workspaces --if-present`) existe en el
  `package.json` raíz pero no lo invoca nadie —no hay `turbo.json` pese al
  `turbo` en las devDependencies, y los tres Dockerfiles (`Dockerfile`,
  `apps/portal/Dockerfile`, `apps/hub-api/Dockerfile`) llaman a builds de
  workspace concretos, nunca al de la raíz—. Haría falta el cambio en el
  `package.json` de `ausencias` **y además** un paso nuevo en el CI que lo
  invoque; el primero sin el segundo daría una falsa sensación de gate.
  Sigue **pendiente de decisión**, no hecho.

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
   rellena el organigrama en *Organigrama*. No hay big bang: desplegar, comprobar
   que nada cambió, y empezar por una sola persona de prueba.
9. *(Segunda firma opcional)* **También se despliega sin cambiar nada.** La `023`
   siembra `requiere_segunda_firma = TRUE` para toda la plantilla, así que el
   comportamiento del día del despliegue es el de siempre; apagarla es una
   decisión persona a persona desde la casilla **Necesaria** del *Organigrama*.

   > ⚠️ **Aquí el orden es el NORMAL —hub-api primero, portal después—, al revés
   > que en la cascada.** Un bundle viejo del portal ignora los campos nuevos y
   > sigue pintando su columna «2ª firma» de siempre. Al revés sí duele: un portal
   > nuevo contra un hub-api viejo recibiría `requiereSegundaFirma: undefined`,
   > que el `!!` de la casilla convierte en **apagada**, y enseñaría a un admin
   > toda la plantilla con la segunda firma aparentemente desactivada — que es
   > justo lo contrario de la verdad. Además el botón «Guardar» daría 404 en
   > cuanto alguien tocara la casilla. Sigue valiendo la regla general: **quien
   > primero deja de entender al otro va detrás.**

## Pendiente (backlog)

- Cargar los saldos iniciales del consolidado (nombre, días y a qué fecha son
  válidos) en la pestaña *Saldos*. Hasta entonces todo el mundo aparece como
  "sin configurar", que es el comportamiento correcto.
- Rellenar el organigrama en *Organigrama*. Hasta que se haga, todo el mundo cuelga
  del buzón por defecto y firma una sola persona.
- Retirar la copia a Google Sheets cuando Nómina consulte solo el portal.
- Widget de dashboard con las ausencias del mes.
- **Desactivar el flujo viejo `mt75OpO0fGIXv5QG`.** Sigue `active: true` con su
  formulario público y sus propios nodos de Google Drive, así que cualquiera con
  la URL guardada puede seguir mandando solicitudes que esquivan el portal — y
  subiendo PDF a Drive. Mientras siga encendido, «Drive fuera» es solo la mitad.
- Registro de descargas de adjuntos, si la lista de visores crece.


