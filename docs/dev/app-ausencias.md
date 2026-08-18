# App «Vacaciones y Permisos» (`ausencias`)

Sustituye al flujo de n8n *Solicitud vacaciones_permisos_compensatorios_
incapacidades 1.5* (`mt75OpO0fGIXv5QG`, 44 nodos), **despublicado el 2026-08-18**.
El formulario, la aprobación y el historial viven en el portal; n8n queda como
brazo ejecutor de Gmail, Calendar y Sheets, en el workflow *Ausencias — Portal*
(`dh0xjWCHsGj9raYH`, 18 nodos), que es el que consume el outbox.

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
| Una solicitud enviada solo la podía tocar un admin, a mano y sin rastro | El trabajador **pide** cambiar las fechas o anularla, y su jefe lo decide | Cambiar de planes es normal; pedirlo por privado para que alguien edite la fila no deja ni permiso ni historial |

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
  resultado (`solicitudes_ausencia.informado_correo`) y `024` la modificación de solicitudes ya enviadas (`portal.solicitud_modificaciones` + `solicitudes_ausencia.anulada_at`).
- **n8n**: workflow **«Ausencias — Portal»** (`dh0xjWCHsGj9raYH`), 18 nodos.

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
  → IF calendario → Switch por `accion` ┬→ crear (con id impuesto) ┐
  │                                      ├→ actualizar             │ las ramas
  │                                      ├→ borrar                 │ falsas
  │                                      └→ fallback: crear (legado)┘ siguen
  │     los tres nodos nuevos mandan sus fallos a «¿El fallo es esperable?»,
  │     que deja pasar 404/409/410 —el estado deseado ya se cumple— y corta
  │     cualquier otro, para que el evento siga pendiente y se reintente.
  → IF hoja  → Fila → Google Sheets ┘
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
| `modificacion_solicitada` | aviso a quien decide el cambio — **solo a él** | — | — |
| `modificacion_aprobada` | cambio aprobado, a **toda la cadena** (+ la copia de la ficha) | ✔ *(corrige o borra, si se puede)* | — |
| `modificacion_rechazada` | cambio rechazado, a **toda la cadena** (+ la copia de la ficha) | — | — |

El ✔ de `modificacion_aprobada` es el único que **no crea**: lleva un
`accion: 'actualizar'` o `'borrar'` sobre el evento que creó su `aprobada`. Sale
solo si la solicitud estaba `aprobada` **y** tiene `evento_calendario_id`; ver
«El calendario se corrige solo» más abajo.

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
>
> Y se cobró por el otro lado en la corrección del calendario (2026-08-18): un
> `modificacion_aprobada` con `calendario` **no nulo** entra por el IF de
> siempre, y con el workflow anterior habría caído en el nodo de crear —una
> anulación estrenando un evento para la ausencia que se acaba de cancelar—. Por
> eso el Switch por `accion` se publicó **antes**, y su salida *fallback* apunta
> al nodo de crear de siempre: mientras hub-api no mande `accion`, todo cae ahí
> y el comportamiento es idéntico. Esa salida es lo que permitió desplegar n8n
> solo y comprobarlo sin cambiar nada.

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
| `POST` | `/api/ausencias/solicitudes/:id/modificaciones` | idem — el **dueño** pide cambiar las fechas o anular; **409** si el estado no lo admite, si ya hay una propuesta viva, o si la solicitud cambió mientras tanto |
| `POST` | `/api/ausencias/modificaciones/:id/retirar` | idem — el **autor** se echa atrás; la fila no se borra, pasa a `retirada` |
| `GET` | `/api/ausencias/modificaciones/pendientes` | idem — los cambios que le toca decidir; cada fila trae `puedoDecidirla` ya calculado. Lista vacía, no **403** |
| `POST` | `/api/ausencias/modificaciones/:id/decision` | idem — **409** si ya estaba decidida, o si la solicitud cambió por debajo |
| `PATCH` | `/api/ausencias/solicitudes/:id` | `requireAdmin` — corrige el registro. **No manda ningún correo**: corregir no es decidir |
| `DELETE` | `/api/ausencias/solicitudes/:id` | `requireAdmin` — borra la fila; el adjunto y sus eventos se van por cascada |
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

**El widget de aprobación** (`ausencias-por-aprobar`, tamaño `4×3`) lo sirve
`GET /ausencias/pendientes`, el mismo endpoint que la bandeja. Enseña **solo
las de su turno**: cuenta las filas con `esMiTurno`, no la lista entera. La
diferencia solo se ve en un admin —a los demás la consulta ya les entrega solo
su turno—, y es deliberada: enseñarle un 12 a quien solo puede actuar sobre 3
es el mismo malentendido que partió la bandeja en dos.

El filtro es `esMiTurno !== false`, no `=== true`, por la ventana en que el
portal va por delante de hub-api: con el campo ausente degrada a contarlas
todas —un número inflado se ve— y no a 0, que diría «nada pendiente» mientras
las solicitudes se pudren.

La antigüedad que enseña se mide desde `primeraFirmaAt` en las `pendiente_2` y
desde `createdAt` en las demás: al segundo firmante no se le puede cobrar la
tardanza del primero. Y se cuenta en **días del calendario colombiano**, no en
bloques de 24 h: `resumirPendientes` recorta el desfase UTC−5 antes de trocear,
con el mismo criterio que `hoyEnColombia` en `dominio.ts`. Sin eso, algo
llegado ayer a las 18:00 se anunciaría como «llegó hoy».

Se refresca al montar y al volver a la pestaña (`visibilitychange` y el `focus`
de la ventana, con 60 s de guarda), no con un `setInterval`: un dashboard se
queda abierto toda la mañana y sondearlo serían ~12 llamadas/hora por pestaña
aunque nadie mire.

Quien no aprueba a nadie puede añadirlo igual —`useWidgetRegistry` filtra por
app, no por rol— y verá siempre «Nada pendiente de firmar.».

Para aterrizar en la bandeja, la app acepta abrir una pestaña por hash
(`/ausencias#bandeja`): `App.tsx` lo lee en el inicializador del `useState` del
tab, y la lista `PESTANAS_VALIDAS` es la fuente de verdad de la que se deriva el
tipo `Pestana`. No hace falta comprobar permisos ahí, porque el efecto que
devuelve a la primera pestaña disponible cuando la activa no le corresponde al
usuario ya lo cubre; el hash no puede abrir nada que no se pudiera abrir
pinchando.

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
migración libre** —hoy la `025`, porque la `024` ya existe y es la modificación de
solicitudes enviadas— que haga `ALTER COLUMN copia_correo DROP DEFAULT`. Y el literal de la `021` no se edita
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
   veces**. Dos peticiones por HTTP no llegan a solaparse contra el doble en
   memoria, así que esto vivió sin test hasta el **cuarto portón**: hoy lo cubre
   `repo.testigos.db.test.ts` contra un Postgres de verdad —dos llamadas con el
   mismo `estadoEsperado`, y la segunda tiene que dar `null` sin encolar un
   segundo correo—, y se falsó sustituyendo el testigo por un `IN`.
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

### La bandeja de un admin: su turno y el rescate, separados

`solicitudesPendientes` filtra por **turno** —en `pendiente` la ve quien firma
primero, en `pendiente_2` quien firma después—, **salvo para un admin**: su
`$2::boolean` anula el filtro entero y le entrega las pendientes de toda la
empresa, para que pueda destrabar una aprobación cuyo firmante no está
disponible. `puedeDecidir` le deja además firmarlas.

Eso hacía que un administrador viera los botones de aprobar en solicitudes que
esperaban a otra persona, sin nada que lo distinguiera de su propio trabajo. Se
reportó como fallo de la cascada y no lo era: el correo de aviso solo se manda al
firmante que toca (`avisoAprobador` lee `s.aprobadorCorreo` a secas), lo que
sobraba era cómo se presentaba la bandeja.

`pendientesDeAprobar` marca ahora cada fila con **`esMiTurno`**, calculado en el
servidor con `correoDelTurno` para que la regla siga viviendo en un solo sitio.
La bandeja parte la lista en dos: lo que hay que firmar, con sus botones, y
*Esperando a otra persona*, que dice a quién se espera y esconde los botones
detrás de un **«Firmar en su lugar»**. Dos gestos, no uno: destrabar es una
excepción, no el trabajo de cada día.

> La pestaña tiene desde entonces una **tercera** sección, *Cambios pedidos*, que
> NO sale de este reparto: viene de otra consulta y decide con `puedoDecidirla`,
> no con `esMiTurno`. Ver «Modificar o anular una solicitud enviada».

Para quien no es admin, `esMiTurno` es **siempre** `true` y la segunda lista no
existe: la consulta ya le entrega solo su turno.

⚠️ **Firmar en lugar de otro sigue registrándose a nombre de esa otra persona.**
La transición sella el correo congelado en la solicitud, no el del admin; el
único rastro de quién pulsó es `aprobador_user_id`, que hoy no se enseña en
ninguna pantalla. Si algún día hace falta distinguirlo, es una spec aparte.

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

> ⚠️ **La columna «2ª firma» no tiene NINGUNA red automática de comportamiento.**
> El backend que hay detrás sí —endpoint, servicio, repo y `aprobadoresDe` están
> cubiertos—, pero lo que la casilla *hace* no lo comprueba nada: `apps/ausencias`
> no tiene tests. Desde el 2026-08-18 su `typecheck` estricto **sí es portón**
> (`npm run typecheck`, con su paso propio en el CI), así que los errores de tipo
> ya no pasan; lo que sigue sin red es la lógica. Su **única** verificación es abrirla en
> el navegador y mirarla. Los modos de fallo son de los que no se ven: la casilla
> guardando sin que nadie la mire, el `!!` que evita que el checkbox se vuelva no
> controlado si el backend deja de mandar el campo, o la línea de abajo diciendo
> «— solo informado» de un correo que ya no está arriba. **El próximo que la
> toque tiene que probarla a mano.**

## Modificar o anular una solicitud enviada

El trabajador pide **cambiar las fechas** o **anular** una solicitud que ya mandó
—esté aprobada o todavía pendiente— y su jefe lo aprueba o lo rechaza. Puede
retirar su propia petición mientras nadie la haya decidido.

Antes de esto, una solicitud enviada era inmutable desde su lado: la única salida
era pedirle por privado a un administrador que tocara la fila con
`PATCH /api/ausencias/solicitudes/:id`, que no deja rastro de quién lo pidió ni
por qué, y que **a propósito no manda ningún correo** («corregir el registro no es
decidir»). Ese camino sigue existiendo y sigue siendo solo de admin; lo nuevo es
el que pasa por aprobación.

### La propuesta vive aparte, y la solicitud no se toca hasta que hay decisión

La petición se guarda en `portal.solicitud_modificaciones` (migración `024`) y la
fila de `portal.solicitudes_ausencia` **no cambia hasta que el jefe decide**.

Se descartó añadir estados (`pendiente_cambio`, `anulada`) porque la máquina de
estados no vive en un solo sitio: hay **seis filtros escritos a mano** que miran
`estado`, y uno de ellos **falla en abierto**. `repo.ausenciasEntre` filtra
`estado <> 'rechazada'`, así que un estado `anulada` habría seguido pintándose en
el calendario como ausencia vigente — el fallo que nadie detecta porque no rompe
nada. Además, un estado nuevo destruye información: una `aprobada` que pasara a
`pendiente_cambio` perdería el hecho de que estaba aprobada, y volver atrás al
rechazar exigiría guardar el estado previo, que es esta misma tabla con peor forma
y dentro de la tabla caliente.

Como mucho hay **una propuesta viva por solicitud**, y eso lo garantiza un índice
único parcial en la base (`ux_modificaciones_una_pendiente`), no una comprobación
en el servicio: dos peticiones a la vez pasarían las dos comprobaciones antes de
que cualquiera escribiera. No es higiene — `SELECT_SOLICITUD` gana un `LEFT JOIN`
contra esta tabla y se usa en **ocho** consultas, dos de ellas sin ningún filtro;
dos filas vivas multiplicarían resultados en todas.

Las columnas `*_previa` guardan la **foto de la solicitud** en el instante en que
se pidió el cambio. No son redundancia: sostienen las dos cosas que sin ellas no
se pueden hacer — que el correo diga «de estas fechas a estas otras», que es lo
único que permite ajustar Google a mano, y el testigo de concurrencia de abajo.

### Anular no estrena estado

Aprobar una anulación deja la solicitud en **`rechazada` con `anulada_at` sellado**.
`rechazada` ya hereda la semántica correcta en los seis filtros:

| Filtro | Qué le pasa a una anulada | ¿Correcto? |
|---|---|---|
| `saldo.disfrutadas` (solo `aprobada`) | deja de consumir días | sí |
| `saldo.enTramite` (`pendiente`/`pendiente_2`) | no entra | sí |
| `repo.ausenciasEntre` (`<> 'rechazada'`) | sale del calendario | sí |
| `calendario.ts` (`continue` si `rechazada`) | no se pinta | sí |
| `repo.solicitudesPendientes` | no entra en la bandeja | sí |
| `repo.solicitudesDecididas` (`aprobada`/`rechazada`) | **sigue en el historial del jefe** | sí — él la decidió |

La etiqueta **«Anulada»** se **deriva** al pintar (`estado === 'rechazada' && anuladaAt`),
no se almacena. Un bundle viejo lee «Rechazada»: menos preciso, no roto.

> ⚠️ **`motivo_rechazo` tiene ahora dos autores.** Lo escribe el jefe al rechazar,
> y lo escribe **el trabajador** al pedir la anulación. Por eso `TablaSolicitudes`
> rotula el texto según el caso («Motivo del rechazo» frente a «Motivo que dio
> quien pidió anularla»). Cualquier pantalla nueva que enseñe ese campo tiene que
> hacer lo mismo, o atribuirá al jefe una frase que escribió otra persona. Lo
> mismo vale para el CSV del *Registro general*, que exporta la etiqueta derivada
> y no el estado crudo.

### Quién decide, y por qué no se rederiva

Decide **quien tenga el turno en ese momento**, y si la solicitud ya está cerrada,
el jefe inmediato — todo leído de la **solicitud**, nunca del organigrama actual:

```ts
decisorDeModificacion(s) = correoDelTurno(s) ?? s.aprobadorCorreo
```

Rederivar con `aprobadoresDe` mandaría «anula mis vacaciones aprobadas» a un jefe
nuevo que no sabe que se aprobaron ni por qué. Es el mismo invariante que congela
los firmantes en el alta, un paso más tarde.

**No hay segunda firma para el cambio.** La segunda firma valida la concesión, y
la concesión ya está validada; y exigir dos firmas para *renunciar* a unas
vacaciones es el mismo argumento con el que se justificó la casilla **Necesaria**.
Sobre una `pendiente_2` decide el segundo firmante, que es el más sénior de los
dos.

**No hay rebote hacia atrás.** Aprobar un cambio de fechas sobre una `pendiente_2`
**no** la devuelve a `pendiente` para que el primer jefe refirme: esa arista
repoblaría su bandeja mientras el segundo decide y rompería el razonamiento del
testigo. El primer firmante se entera por el correo, que va a la cadena entera.

### El saldo no mira las propuestas

Una solicitud aprobada de 5 días con una propuesta pendiente de 3 sigue contando
**5** en `disfrutadas`. `saldo.ts` no se tocó: cero líneas.

Si una anulación pendiente liberara los días, el trabajador pediría la anulación y
acto seguido esos mismos días en otras fechas, con el saldo bendiciéndolo; y si el
jefe rechaza, quedan dos ausencias sobre los mismos días y ningún sitio donde
deshacerlo. Es la acción unilateral que esta feature existe para impedir,
reintroducida por la puerta del saldo. Es además la regla que ya estaba escrita:
«media firma NO descuenta», y una propuesta es menos que media firma.

Al jefe sí se le enseña el **delta** al decidir («aprobarlo le devuelve 2 días»),
que es el dato que necesita, sin contaminar la aritmética del saldo.

### Qué admite modificación, y las dos reglas de fecha

| Estado | ¿Admite? | Al aprobar |
|---|---|---|
| `pendiente` / `pendiente_2` | sí | fechas: reescribe. **El estado no cambia.** anulación: `rechazada` + `anulada_at` |
| `aprobada` | sí — el caso principal | igual; **es el único que dispara el aviso de Google** |
| `rechazada` | no — 409 | los días nunca se concedieron: lo que quiere es volver a pedir |
| `registrada` | no — 409 | una incapacidad se informa, no se concede: no hay aprobador a quien mandarlo |

Las dos reglas de vigencia son **distintas a propósito**:

- **Cambiar fechas** exige `fechaFin >= hoy`. Permite acortar una ausencia **en
  curso**, que es el caso legítimo de «vuelvo antes de tiempo».
- **Anular** exige `fechaInicio >= hoy`. Anular una ausencia ya empezada
  devolvería al saldo días que sí se disfrutaron: quien se fue el lunes y vuelve
  el miércoles tiene que **acortar**, no anular.

> ⚠️ **`>=` y no `>`, en la regla de anular.** Una ausencia que empieza HOY sí se
> puede anular: un día solo queda consumido al terminar, y cancelar la mañana del
> primer día es un caso real. Con `>` esa persona se quedaría sin salida, porque
> tampoco se puede acortar a menos de un día. El riesgo residual —anular a las
> cinco de la tarde habiendo disfrutado el día— es de un solo día, exige mala fe y
> deja rastro en el outbox. **No cambiar a `>` sin releer esto.**

Solo el **dueño** puede pedirla. `empleadoId` sale de la sesión y nunca del
cuerpo, igual que en el alta.

### La concurrencia: dos testigos aquí, y el de `decidirSolicitud`

Mismo patrón de comparar-y-actualizar que `decidirSolicitud`, en dos momentos:

1. **Al pedir**, el `INSERT ... SELECT` lleva `AND s.estado = $8` con el estado que
   leyó el servicio, y resuelve la foto previa en la misma sentencia. Son dos
   garantías distintas y conviene no confundirlas, porque este texto las confundió
   hasta que unas sondas contra Postgres real lo desmintieron: que `estado_previo`
   sea el estado real de la fila lo da el `SELECT` de dentro del `INSERT`, **con
   testigo y sin él**. Lo que el testigo protege es **`aprobador_correo`**, el único
   dato que el servicio derivó de su lectura anterior (`decisorDeModificacion`, que
   devuelve el firmante *del turno* y por tanto depende del estado). Si la solicitud
   avanza de nivel entre la lectura y el `INSERT`, la propuesta se congela a nombre
   del jefe que **ya firmó y salió del turno** — y la bandeja de cambios, el guard
   `puedeDecidirModificacion` y el correo del alta filtran los tres por ese campo:
   la propuesta aterriza entera en la bandeja de quien ya no tiene el turno, y el
   firmante que sí lo tiene no la ve nunca. Sin 403 y sin error.
2. **Al aplicar**, el `UPDATE` de la solicitud lleva un **testigo de tres campos**
   (`estado`, `fecha_inicio`, `fecha_fin`) contra las columnas `*_previa`. Con solo
   `estado` no se detectaría que un admin corrigió las fechas por `PATCH` entre
   medias, y la aprobación **le pisaría la corrección en silencio**. Con los tres,
   ese choque sale 409 y alguien mira.

Si el segundo paso no encuentra fila, **lanza**, y el ROLLBACK deshace también la
decisión de la propuesta: si no, la propuesta diría «aprobada» mientras la
solicitud conserva las fechas viejas, y el correo anunciaría un cambio que no
ocurrió.

Los **tres** testigos —estos dos y el `WHERE estado = $7` de `decidirSolicitud`,
que arrastraba el mismo hueco desde la 018— los ejecuta ya el cuarto portón contra
un Postgres de verdad, y cada uno se falsó rompiéndolo. Ver «El cuarto portón, y
lo que sigue sin proteger», más abajo.

### Los correos

Tres eventos nuevos. `modificacion_solicitada` y `modificacion_rechazada` van con
`calendario: null` y `hoja: null`, y con los dos campos en `null` el workflow
recorre **la rama de solo-correo** que ya usan `creada` y `aprobacion`.

> Esto decía «y por eso n8n no se tocó», y fue cierto hasta el 2026-08-18.
> `modificacion_aprobada` lleva ahora `calendario` cuando puede corregirlo: ver
> «El calendario se corrige solo».

| Evento | Correo |
|---|---|
| `modificacion_solicitada` | **solo al decisor** — es un trámite, no un veredicto |
| `modificacion_aprobada` | a **toda la cadena** (+ la copia de la ficha) |
| `modificacion_rechazada` | a **toda la cadena** (+ la copia de la ficha) |

Las dos decisiones van a la cadena entera porque el primer firmante tiene que
enterarse de que lo que avaló cambió.

El correo de aprobación lleva **las cuatro fechas** —las dos de antes y las dos de
después— y los dos recuentos de días, redactado desde la propuesta y no desde la
solicitud ya actualizada: sin el «desde qué», nadie puede ajustar el calendario.

> ⚠️ **El aviso de ajustar Google a mano.** Cuando la solicitud estaba **aprobada**,
> su evento de Calendar y su fila de la hoja ya se enviaron con las fechas viejas.
> **El calendario ya se corrige solo**; la hoja no, así que el correo de
> aprobación llega con el asunto prefijado `⚠️ Ajustar la hoja —` y un párrafo
> dirigido a administración que dice qué se hizo solo y qué queda.
>
> Si la solicitud es de las que **no** tienen `evento_calendario_id` —aprobadas
> antes de la 026— el aviso vuelve a ser el de siempre, `⚠️ Ajustar calendario y
> hoja —`, porque ahí sigue siendo verdad.
>
> Ese ⚠️ aparece **solo** si la solicitud estaba aprobada. Si seguía `pendiente`
> nunca se mandó nada a Google, y avisar ahí sería una alarma falsa: entrenar a la
> gente a ignorar el ⚠️ es la forma segura de que el día que importe no lo lean.
> Por lo mismo el texto enumera **lo que queda**, no lo que hubo: un ⚠️ que manda
> al calendario cuando el calendario ya está bien enseña a no leerlos igual de
> rápido. El aviso y el payload salen los dos de `correccionDeCalendario`, así que
> no pueden discrepar.

### El calendario se corrige solo

Desde el 2026-08-18, anular una ausencia **borra** su evento del Google Calendar
«Ambientalia Staff» y reprogramarla lo **mueve**, sin que nadie toque Google.

Esto estuvo mucho tiempo descartado por una razón que resultó ser falsa. El
argumento era: el payload no lleva ninguna identidad del evento creado, así que
emitir `calendario` en una modificación crearía uno nuevo en vez de corregir el
viejo. Cierto, pero la premisa de fondo —que el id lo decide Google— no lo es:

> **El id del evento no hay que averiguarlo: se puede imponer.** El nodo de Google
> Calendar expone `additionalFields.id` en el `create`, y Google acepta cualquier
> id base32hex (de 5 a 1024 caracteres de `[0-9a-v]`). Un uuid sin guiones son 32
> caracteres de `[0-9a-f]`, que cae dentro. Así que el evento se llama como la
> solicitud, y volver a él es trivial.

`idDeEventoCalendario(solicitudId)` es esa derivación, y tiene un candado sobre el
alfabeto que **no es decorativo**: una derivación que se salga de `[0-9a-v]` no
rompe ningún test de forma, rompe contra Google y solo en producción.

**`portal.solicitudes_ausencia.evento_calendario_id` (migración 026).** Lo que la
hace útil no es el valor —que se deriva del `id`— sino que **esté o no esté**:

| Valor | Qué significa | Qué pasa al anular o reprogramar |
|---|---|---|
| `NULL` y estado nunca aprobado | nunca se mandó nada a Google | nada que corregir, y **sin** ⚠️ |
| `NULL` y aprobada | aprobada **antes** de la 026: su evento lleva el id que inventó Google, que nadie apuntó | no se puede localizar → ⚠️ completo, a mano |
| con id | el evento lo creamos nosotros | se corrige o se borra solo → ⚠️ solo de la hoja |

Esa segunda fila es la cola, y se vacía sola. **No hay backfill**: rellenar la
columna para las viejas sería afirmar que controlamos un evento que no
controlamos, justo lo que la columna existe para distinguir.

La marca la escribe `anotarEventoDeCalendario` (repo.ts) **dentro de la misma
transacción** que encola el evento del outbox, y decide leyendo el **payload** y
no una lista de eventos copiada allí: así se escribe exactamente cuando se emite
una creación, y no puede desincronizarse de `construirPayload` el día que cambie
el reparto de efectos.

**Un regalo:** con el id impuesto, un evento servido dos veces —la reserva de 5
min expira y n8n lo reprocesa— devuelve **409 duplicado** en vez de crear un
segundo evento. Es exactamente el incidente del 2026-08-13, cerrado por
construcción y no por vigilancia.

⚠️ **Orden de despliegue: n8n primero, siempre.** Ver el filo del `undefined !==
null` en «El contrato con n8n». El Switch por `accion` tiene una salida
*fallback* que apunta al nodo de crear de siempre, así que se puede publicar solo
y no cambia nada mientras hub-api no mande `accion`.

**Los fallos que n8n tolera.** `409` al crear («ya existe»), `404` y `410` al
actualizar o borrar («ya no está»). En los tres el estado deseado ya se cumple:
reintentar no arregla nada y el evento no se confirmaría nunca, así que n8n lo
reprocesaría cada 10 minutos para siempre. Cualquier otro fallo se queda **sin
salida** a propósito: el evento sigue pendiente en hub-api y el ciclo siguiente lo
reintenta, que es la red que ya existía.

**Lo que sigue a mano.** La hoja. n8n hace `append` y no queda constancia de en
qué fila cayó, así que a esa fila no se puede volver. Cerrarlo exigiría una
columna clave con el uuid en las cuatro pestañas y pasar el nodo a
`appendOrUpdate`, y hay que decidirlo con Nómina — que es quien lee esa hoja— y
sopesarlo contra el backlog, que dice retirar esa copia, no invertir en ella.

Y `PATCH /ausencias/solicitudes/:id`: un admin sigue pudiendo mover las fechas de
una aprobada sin encolar nada, así que ni avisa ni corrige. Ahora se nota más,
porque por la vía del trabajador sí se corrige.

### En pantalla

- **Mis solicitudes** gana botones en la última columna: «Cambiar fechas» y
  «Anular» (la segunda solo si se puede), y con una propuesta viva, el chip ámbar
  **«Cambio pendiente»** más un enlace «Retirar». El modal dice, y no puede dejar
  de decir, **«Esto es una petición. Las fechas no cambian hasta que tu jefe la
  apruebe.»**
- **Pendientes de aprobar** gana una **tercera sección, «Cambios pedidos»**,
  separada de la tabla principal. Separada a propósito: dos parejas de botones con
  significados distintos en la misma fila —unos deciden la solicitud, otros el
  cambio— es cómo alguien aprueba lo que no era.
- El chip **«Cambio pendiente»** vive en la celda de Estado de `TablaSolicitudes`,
  así que sale en las cuatro pantallas que usan ese componente, y también en el
  *Registro general*, para que un admin no edite a ciegas una fila con una
  propuesta viva.

**`puedoDecidirla`** es a los cambios lo que `esMiTurno` a las solicitudes: lo
calcula el servidor y viaja por fila, para que el navegador no reimplemente el
guard. Incluye **excluir al propio solicitante**, que no es un caso raro — la raíz
del organigrama es su propio jefe, así que recibe su propia propuesta. Con
`puedoDecidirla: false` la fila se ve pero los botones salen apagados con el
motivo al lado, nunca ausentes.

> ⚠️ **El contador de la pestaña y el del widget tienen que contar lo mismo.** Los
> dos usan `contarPorAtender` de `dominio.ts` justamente para que la regla exista
> una sola vez. El número del `<h3>` de «Cambios pedidos» es otra cosa —cuenta
> filas de la tabla, no decisiones propias— y no hay que «unificarlo».

### El cuarto portón, y lo que sigue sin proteger

Los tests de este módulo corren contra un doble in-memory, así que durante toda la
vida de la app cambiar `AND s.estado = $8` por un `IN (...)` —o quitarle dos
columnas al testigo triple— dejaba **la suite entera en verde**. Ya no: hay un
**cuarto portón** que ejecuta ese SQL de verdad.

```bash
npm run test:db --workspace=apps/hub-api
```

> ⚠️ **No corre con `npm run test`, pero el CI sí lo invoca**, en un step propio
> (`Tests contra Postgres real`). El portón de siempre sigue en 752 tests, sin
> infraestructura y en segundos, porque `vitest.config.ts` excluye los
> `*.db.test.ts`: el portón que corre en cada commit no debe poder fallar porque
> un demonio esté parado en la máquina de alguien. En local, este otro **necesita
> Docker arrancado**; si no lo está no salen tests rojos, sale un error de
> conexión de testcontainers. En el runner de Actions Docker siempre está, así
> que ahí el candado se vigila solo en vez de depender de que alguien se acuerde.

> ⚠️ **`@testcontainers/postgresql` se queda en la línea 11.** La 12 arrastra
> `undici@8`, que exige Node ≥ 22.19 y revienta al cargar el módulo
> (`webidl.util.markAsUncloneable is not a function`), antes de levantar ningún
> contenedor. Este repo va por **Node 20** —`.nvmrc` y `node:20-alpine` en el
> Dockerfile—, y la línea 11 trae `undici@7`, que pide ≥ 20.18.1. Se descubrió en
> el CI y no en local: en la máquina de desarrollo había Node 26, donde la 12
> funciona, y el `npm install` sólo avisó de `engines`. Subir esa dependencia
> obliga a subir Node antes, en el `.nvmrc` **y** en el Dockerfile.

Levanta un contenedor **`postgres:17`** —la misma versión mayor que corre
producción, verificada con un `SELECT version()` contra EasyPanel el 2026-08-18:
PostgreSQL 17.10 sobre Debian. La imagen se fija a mano porque un `latest`
derivaría solo, y se usa la variante Debian y no la `-alpine` porque alpine va
con musl y la ordenación de texto depende de la libc— y lo migra con el array
real de `MIGRATIONS` llamando a
`aplicarMigraciones`, la misma función que usa `initDb` en cada arranque. Lo que
eso garantiza es **fidelidad**: el esquema de prueba no puede divergir del de
producción, porque los dos salen del mismo array. Lo que **no** garantiza es
detectar una migración que nadie apuntó en `MIGRATIONS` —producción tampoco la
aplicaría, así que los dos esquemas coinciden en no tenerla—; eso solo se delata
de rebote, cuando algún test de BD toca el esquema que esa migración traía.

Son **22** tests. Dos de migraciones: que se re-ejecuten sobre una base ya migrada
**y con datos** sin romper nada —que es como re-arranca producción—, y que los
nueve eventos del outbox pasen el `CHECK` **y quepan en la columna**, que era la
regresión del `22001` del 2026-08-17: dos restricciones distintas de las que solo
se miró una. Ocho de los testigos: `decidirSolicitud`, `crearModificacion`, los
**tres** del testigo triple (fechas por `PATCH`, avance de nivel, y la rama de
anulación, que comparte el testigo con la de fechas pero tiene otro `SET`), el
`23505` del índice único parcial emitido por Postgres y reconocido por su nombre,
y lo que escribe aprobar una modificación de cada clase.

Y **cuatro del calendario**, sobre `ausenciasEntre`: que la consulta busca las que
**solapan** con el rango y no las contenidas en él —la condición natural perdería
justo las que cruzan el cambio de mes, que son las que más importa ver—; que una
solicitud anulada no se pinta y una incapacidad `registrada` sí; que una ficha
desactivada no aporta ausencias; y que el filtro por empleado distingue «el mío»
de «el de todos». Ese `AND s.estado <> 'rechazada'` es el que **falla en abierto**,
y por eso el test que fija que la anulada desaparece sostiene una decisión de
diseño: si anular hubiera estrenado un estado `'anulada'` en vez de reutilizar
`rechazada`, seguiría pintándose como ausencia vigente.

Y **seis de la marca del calendario** (`repo.evento-calendario.db.test.ts`), que
usan el `construirPayload` real y no el `payloadStub` del harness, porque lo que
se prueba es justamente que la marca sale del payload: que aprobar anota el id y
es el **mismo** que viaja en el evento —si se separaran, la fila apuntaría a un
evento que Google no creó nunca y la corrección daría un 404 en silencio—; que la
solicitud devuelta lo lleva ya, y no el `null` que se leyó un `UPDATE` antes; que
rechazar no anota nada; que una incapacidad `registrada` sí, que es el camino que
no pasa por `decidirSolicitud` y el que se olvida; que el doble clic del jefe deja
un evento y una marca; y que `SELECT_SOLICITUD` la trae, sin lo cual
`construirPayloadModificacion` vería `undefined`, no entraría por la guarda de
`null` y emitiría una corrección con `eventId: undefined` —que no es hipotético:
pasó al escribir esto, y lo destapó el doble in-memory de `router.test.ts`—.

**Cada candado se falsó rompiendo el código de verdad** y comprobando que se pone
rojo por el motivo correcto.

`repo.test.ts` se queda con lo que un Postgres real no da: los errores del `Pool`
que la base no provoca sin ensuciar el esquema —un `23505` de **otro** constraint,
que tiene que propagar en vez de disfrazarse de «ya hay una propuesta»— y qué
sentencias llegaron a mandarse, que no se lee en las filas resultantes: que hubo
`ROLLBACK` y no `COMMIT`, que no se escribió en el outbox.

> ⚠️ **El doble in-memory ya es un segundo sistema.** Son unas 445 líneas
> modelando un `repo.ts` de 1682, y reimplementa en JavaScript el testigo, el
> índice único parcial y el `LEFT JOIN`. Quien toque esta tabla mantiene **dos**
> implementaciones, no una.
>
> El cuarto portón **no cierra ese hueco**: cubre los testigos y el filtro del
> calendario, y nada más. Los demás invariantes que viven únicamente en SQL siguen
> sin ejecutarse en ningún test —los filtros de las bandejas, las consultas del
> saldo—, y ahí sigue mandando el doble.

En el frontend no hay tests, como en el resto de la app: el modal, la tercera
sección de la bandeja y los dos contadores se comprueban mirándolos.

### Límites conocidos

- **La hoja no se corrige sola, y no hay acuse de que alguien lo haya hecho.** El
  correo avisa; nadie sabe si se ajustó. El arreglo barato el día que duela es una
  columna `google_ajustado_at` y un botón «Ya lo ajusté» en el *Registro general*.
- Se puede modificar una solicitud **ya modificada**. Es lo correcto, pero no hay
  límite: si alguien encadena peticiones, encadena correos.
- El jefe **no puede contraproponer** («no del 6 al 8, del 7 al 9»): rechaza con
  motivo y el trabajador vuelve a pedir. Una contrapropuesta tendría otro autor y
  otro decisor, y duplicaría la máquina.

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
  **Hecho el 2026-08-18, y efectivamente no era una línea.** Como decía este
  punto, cambiar el `build` de `ausencias` no habría servido de nada: nada lo
  invoca —el CI solo construye `apps/portal` y `apps/hub-api`, el `build` de
  la raíz no lo llama nadie (no hay `turbo.json` pese al `turbo` de las
  devDependencies) y los tres Dockerfiles apuntan a workspaces concretos—.
  Hicieron falta las dos piezas: un script `typecheck` en el `package.json`
  de `ausencias` (`tsc --noEmit -p tsconfig.json`) **y** un paso propio en
  `ci.yml` que corre `npm run typecheck --workspaces --if-present`, con
  `--if-present` para que la sub-app que lo añada mañana entre sola.

  El agujero era real, no teórico, y se comprobó antes de taparlo: metiendo
  `const variableQueNadieUsa = 42;` en `focoDeModal.ts`, el tsconfig propio
  da `TS6133` y el build del portal pasa **sin una queja**, porque
  `apps/portal/tsconfig.app.json` pone `noUnusedLocals`,
  `noUnusedParameters` y `verbatimModuleSyntax` en `false` a propósito.

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
   **Hecho el 2026-08-18**: despublicado, no borrado, y sigue ahí por si hay que
   consultar cómo redactaba algún correo.
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
- ~~**Desactivar el flujo viejo `mt75OpO0fGIXv5QG`.**~~ **Hecho el 2026-08-18.** Se
  despublicó, y con él se cerró el formulario público y sus nodos de Google Drive:
  ya no hay forma de mandar una solicitud que esquive el portal. Verificado antes
  de apagarlo que su **único** disparador era `On form submission` y que ninguno de
  sus 44 nodos tocaba el outbox — los correos de la app los sirve *Ausencias —
  Portal* (`dh0xjWCHsGj9raYH`), que sigue activo y es otro workflow. Ojo al
  nombre: existe además un `4UZH0VUYgOj6Zpwp` llamado «…_Portal_1.5» que está
  archivado desde agosto y no sirve a nada; los tres nombres se parecen mucho.
- Registro de descargas de adjuntos, si la lista de visores crece.


