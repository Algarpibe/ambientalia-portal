# Diseño — Corregir una solicitud desde el registro no deja Google desincronizado

## Objetivo

Que cuando un admin corrige una solicitud desde *Registro general*, el evento del
Google Calendar deje de contar una historia distinta a la del registro.

Hoy `PATCH /ausencias/solicitudes/:id` puede mover las fechas de una ausencia
**aprobada** y no encola nada: el registro dice una cosa, Google sigue diciendo la
anterior, y nadie se entera. Se nota más desde el 2026-08-18, porque las otras dos
vías —aprobar un cambio de fechas y anular— **sí** corrigen el calendario solas.

## Lo que hay hoy, verificado

Seis hechos leídos del código y del workflow vivo, no supuestos.

1. **El `PATCH` no pasa por el servicio.** `router.ts:370` llama derecho a
   `repo.actualizarSolicitud`. Por eso es la cuarta puerta del solapamiento y por
   eso su 409 se traduce en el `catch` de la ruta y no en `service`.

2. **El «no encola nada» es deliberado y está escrito** (`repo.ts:631`): «esto es
   corregir el registro, no tomar una decisión (…) un admin arreglando una fecha
   mal importada no debe disparar correos a nadie». La decisión se **respeta en su
   parte de correo y se corrige en su parte de calendario**: son cosas distintas.
   Un correo es una notificación; el evento de Google es un artefacto derivado que
   o está sincronizado o miente.

3. **Cada fila del outbox es exactamente un correo** (`types.ts:24`), y
   `PayloadEvento.correo` no es nulable. Confirmado por el otro lado en n8n: el
   nodo de Gmail cuelga directo de «Repartir eventos», sin ningún IF delante. **No
   existe forma de encolar una corrección de calendario sin mandar un correo con
   ella**, y hacerla existir obligaría a un IF nuevo publicado ANTES de desplegar
   hub-api — la trampa del `drive`, cobrada por tercera vez.

4. **La maquinaria de corregir Google existe y está probada en producción.**
   `correccionDeCalendario` (`notificaciones.ts:444`) decide `actualizar` o
   `borrar` mirando dos cosas: `tocaGoogle(estadoPrevio)` y
   `eventoCalendarioId !== null`.

5. **`evento_calendario_id` nunca se vacía.** `anotarEventoDeCalendario`
   (`repo.ts:958`) solo escribe, y solo cuando la acción es `crear`.
   `aplicarALaSolicitud` con una anulación pone `estado='rechazada'` y
   `anulada_at`, pero deja el id apuntando a un evento **que Google ya borró**. Eso
   pasa hoy en producción.

6. **Ningún nodo de n8n lee el nombre del evento.** Comprobado sobre el workflow
   publicado `dh0xjWCHsGj9raYH` (18 nodos, activo): Gmail lee `payload.correo.*`,
   los dos IF miran `payload.calendario !== null` y `payload.hoja !== null`, y el
   Switch mira `payload.calendario.accion`. **Un evento nuevo del outbox fluye sin
   tocar n8n**, así que este trabajo no tiene orden de despliegue que respetar.

## Alcance

Entra:

- La corrección de lo que **ya está** en Google: `actualizar` y `borrar`.
- Un correo a administración cuando la fila **estaba** en Google **y la corrección
  deja algo desajustado**, diciendo qué se arregló solo y qué queda a mano.

No entra, y es decisión tomada, no olvido:

- **El `crear`.** Que un admin lleve una solicitud de `pendiente` a `aprobada`
  desde el registro sigue sin poner nada en Google ni en la hoja. Aprobar se hace
  en la bandeja. Meter el `crear` aquí convertiría el `PATCH` en un segundo canal
  de aprobación que además no avisa al trabajador, y eso es otro diseño.
- **La fila de la hoja.** Nunca, por la razón de siempre: n8n hace `append` y no
  queda constancia de en qué fila cayó, así que a esa fila no se puede volver.

## Las tres preguntas

Son distintas y confundirlas es el bug que ya se pagó una vez con `ocupaAgenda`:

- **Antes** — ¿había un evento vivo que sepamos localizar?
  `solicitud.eventoCalendarioId !== null`, leído **dentro de la transacción y antes
  del UPDATE**.
- **Después** — ¿la fila corregida debería tener evento?
  `estaEnElCalendario(estado)`, que es `estado === 'aprobada' || estado === 'registrada'`.
- **¿Cambió algo?** — dos predicados, uno por artefacto. Ver abajo.

| Antes | Después | Cambió el calendario | Acción |
|---|---|---|---|
| hay id | sí | sí | `actualizar` |
| hay id | sí | no | ninguna |
| hay id | no | — (la presencia ya cambió) | `borrar` |
| sin id | — | — | ninguna |

### Qué cuenta como «cambió»

**El calendario** solo muestra tres cosas: la presencia del evento, sus fechas y su
`resumen`. Así que `cambiaElCalendario` mira `estaEnElCalendario(estado)`,
`fechaInicio`, `fechaFin`, `tipo` y `empleadoId` —los dos últimos porque componen
el `resumen`—. **No** mira `dias`, `comentarios` ni `observaciones`.

Sin este predicado, corregir solo los días de una aprobada —el caso más corriente
del histórico importado, donde el Excel anotó recuentos que no cuadran— mandaría a
Google un `actualizar` idéntico al evento que ya hay y un correo diciendo que «el
evento del calendario ya se ha corregido solo». Es literalmente el ⚠️ falso contra
el que avisa el JSDoc de `correccionDeCalendario`.

**La hoja** muestra más, y —esto se descubrió revisando la implementación, no
diseñando— **muestra cosas distintas según el tipo**. `hoja()` tiene dos juegos de
columnas:

| | Nombre | Fechas | Días | Tipo | Comentarios | ¿Aprobado? | Adjunto? |
|---|---|---|---|---|---|---|---|
| Incapacidad | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| Las otras tres | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

De ahí salen dos cosas que un `cambiaElCalendario + dias + comentarios` ingenuo
habría hecho mal:

- **En una incapacidad, los comentarios no salen en la hoja.** Contarlos daría un
  ⚠️ «ajustar la hoja» por una celda que esa pestaña no tiene — el ⚠️ falso que
  esta feature existe para evitar. Y una incapacidad `registrada` pasa el portón
  de fuera, así que el caso es alcanzable. `Adjunto?` no hace falta mirarlo:
  `validarEdicionSolicitud` no admite tocar el adjunto.
- **La celda «¿Aprobado?» tiene TRES valores** —`Sí`, `No` y vacío— y
  `estaEnElCalendario` solo distingue dos. Mirarla a través de ese predicado
  perdería `aprobada → registrada`, que cambia la celda de `Sí` a vacío sin mover
  nada del calendario. Por eso la hoja compara el **estado entero** donde el
  calendario compara solo la presencia: cada artefacto con su pregunta.

Solo `observaciones` queda fuera de los dos predicados: es una nota interna que no
viaja a ningún sitio.

⚠️ **`cambiaElCalendario` está contenido en `cambiaLaHoja`**, y de eso depende que
`cambiaLaHoja` pueda hacer de portón único de «hay algo que ajustar» sin dejar
fuera ningún caso de calendario.

**Esa contención es IMPUESTA, no emergente**, y confundirlo es peligroso. Este
spec dijo primero que se sostenía sola —«todo lo que mueve el evento de Google
mueve también la fila de la hoja»—, y **es falso**: una incapacidad
`registrada → rechazada` obliga a borrar su evento del calendario y no cambia
**ninguna** celda de su pestaña, que no enseña el estado. Lo único que hace que
`cambiaLaHoja` devuelva `true` en ese caso es que **delega en
`cambiaElCalendario` en su primera línea, antes de la rama del tipo**.

Consecuencia práctica: reordenar las ramas —subir el corte de las incapacidades
por encima de la delegación, que es el reordenado que parece inocente— rompe la
invariante **en silencio**, y una incapacidad reprogramada dejaría su evento de
Google con las fechas viejas para siempre. Lo cubre un caso del candado
estructural de `types.test.ts`; sin él, la mutación pasa con todo en verde.

### `estaEnElCalendario` NO es `ocupaAgenda`

`ocupaAgenda` contesta a la regla de solapamiento y **excluye las incapacidades**;
`estaEnElCalendario` contesta a qué hay en Google, y una incapacidad `registrada`
**sí** tiene evento —`construirPayload` le da `calendario` y `hoja`—. Dos
preguntas sobre la misma fila con dos respuestas distintas: es exactamente la
forma que tuvo el bug de la cuarta puerta, donde se copió media regla.

La advertencia va en el JSDoc **de las dos**, y en grande, porque no son vecinas:
`ocupaAgenda` vive en `repo.ts` y `estaEnElCalendario` tiene que vivir en
`types.ts` —la usan `repo.ts` y `notificaciones.ts`, y el primero no puede
importar al segundo—. Nadie las va a ver juntas por casualidad.

Va por **estado** y no por evento porque el estado es lo que la fila conserva:
`aprobada` y `registrada` son los estados que dejan los dos únicos eventos que
emiten un `crear`.

## El correo

### Cuándo

`estaEnElCalendario(previa.estado) && cambiaLaHoja(previa, actual)`. Las dos
mitades hacen falta y niegan cosas distintas:

- **`estaEnElCalendario(previa.estado)`** — la fila **estaba** en Google. No es
  «el calendario se pudo corregir»: el caso que más necesita a una persona es una
  aprobada **anterior a la migración 026**, que no tiene id, y ni su calendario ni
  su hoja se corrigen solos. Con el criterio estrecho ese caso no mandaría nada.
- **`cambiaLaHoja(previa, actual)`** — hay algo que ajustar de verdad. Corregir
  solo las `observaciones` de una aprobada no deja nada desincronizado, y un ⚠️
  por eso es un ⚠️ que enseña a no leerlos.

Se emite el evento del outbox solo si se cumplen las dos. Y como cada fila del
outbox es exactamente un correo, **eso es también la condición de que exista la
fila**: no hay corrección de calendario sin correo ni correo sin corrección.

### `tocaGoogle` desaparece: era `estaEnElCalendario` con otro nombre

`tocaGoogle(estadoPrevio)` pregunta «¿esta fila estaba en Google?» y
`estaEnElCalendario(estado)` pregunta «¿una fila con este estado está en Google?».
Una vez ensanchado el primero a `registrada`, **son la misma función aplicada a
argumentos distintos**. Se deja una sola, en `types.ts`, y `notificaciones.ts`
pasa a llamar `estaEnElCalendario(m.estadoPrevio)`.

Tenía que salir de `notificaciones.ts` de todos modos: **`repo.ts` no puede
importar `notificaciones.ts`** —la inyección de `construirPayload` como parámetro
existe justo para que no dependa de él— y el `PATCH` necesita el predicado dentro
de la transacción para decidir si emite. `types.ts` es donde ya viven
`requiereAprobacion` y `correoDelTurno`, y de donde beben los dos módulos.

El ensanche a `registrada` sigue siendo el punto delicado: hoy `tocaGoogle` lo
excluye a propósito y con razón escrita —por el flujo de modificaciones es
inalcanzable, así que la rama sería código muerto que haría creer que el caso está
contemplado—. **El `PATCH` sí lo alcanza**, y una incapacidad editada por un admin
tiene evento en Google. El JSDoc de `estaEnElCalendario` tiene que conservar esa
explicación y decir qué la volvió alcanzable, o el próximo que lo lea creerá que
sobra. Para el flujo de modificaciones el comportamiento no cambia: `registrada`
sigue siendo inalcanzable por ahí.

### A quién

`destinatarios(s.copiaCorreo ?? COPIA_POR_DEFECTO)` — la copia de la ficha, que
hoy es `administrativo@`.

El `??` no es paranoia. `copiaCorreo` es `string | null` y `destinatarios` salta
los nulos, así que una ficha con la copia vaciada desde el Organigrama produciría
un `sendTo` vacío. Este es **el único correo de la app con una sola fuente de
destinatario**: en todos los demás la cadena de firmas rellena la lista. Un
`sendTo` vacío no degrada el aviso, deja una fila del outbox que el nodo de Gmail
rechaza y n8n reintenta cada diez minutos para siempre.

**No va al trabajador.** Decisión tomada: el `PATCH` es la vía de corregir el
registro, y avisar al dueño de cada errata corregida es lo que la decisión
original de `repo.ts:631` quería evitar.

### Qué dice

⚠️ **El texto se escribe nuevo, NO se reutiliza `avisoDeAjustarGoogle`.** Aquel
contempla dos situaciones y aquí hay **cuatro**, porque el calendario puede además
no necesitar nada:

| `SituacionCalendario` | Acción en el payload | Prefijo del asunto | Qué dice el cuerpo |
|---|---|---|---|
| `no_cambia` | ninguna | `⚠️ Ajustar la hoja — ` | el evento no cambia |
| `a_mano` | ninguna | `⚠️ Ajustar calendario y hoja — ` | hay que ajustarlo a mano |
| `actualizado` | `actualizar` | `⚠️ Ajustar la hoja — ` | ya se ha corregido solo |
| `borrado` | `borrar` | `⚠️ Ajustar la hoja — ` | ya se ha borrado solo |

**Las cuatro las decide una sola función**, `situacionDelCalendario(previa, actual)`,
y de ella derivan el payload y los dos textos. Esto no es adorno: el primer intento
de este diseño calculaba la condición **tres veces en paralelo** —una en el
constructor del payload y una en cada texto— con un JSDoc que afirmaba ser fuente
única. Lo cazó la revisión de la Tarea 5. Cambiar una rama y olvidar las otras
habría dejado el correo diciendo una cosa y n8n haciendo otra, sin que nada se
pusiera rojo.

Y no vale compartir un `EventoCalendario | null`, que es lo que hace el flujo
hermano: ese `null` colapsa `no_cambia` con `a_mano`, y **esa es justamente la
distinción que el asunto tiene que enseñar**. Por eso hay un tipo con nombre y no
una comprobación de nulidad. El aviso es un `Record<SituacionCalendario, string>`
exhaustivo, para que una situación nueva no compile hasta que se le escriba texto.

**Precondición de `construirPayloadCorreccion`, y va escrita en su JSDoc:** solo
puede llamarse cuando `estaEnElCalendario(previa.estado)`. El cuerpo del correo
afirma «que ya estaba en el calendario y en la hoja» como un hecho, así que
llamarla sobre una solicitud que nunca salió de `pendiente` mandaría a
administración un aviso falso. Quien la garantiza es el portón del repo; no se
duplica aquí como comprobación defensiva, porque eso sería otra vez dos sitios
decidiendo lo mismo.

`prefijoDeAsunto` y `avisoDeAjustarGoogle` tampoco son reutilizables aunque se
quisiera: los dos toman una `Modificacion`, que aquí no existe. Lo que sí se
reutiliza es lo que de verdad importaba —`calendario(s)` para construir el evento y
`destinatarios` para la lista—, y el criterio de que el ⚠️ nombre a quien tiene que
actuar («Administración:»).

El cuerpo lleva el antes y el después y **quién lo corrigió**. Esa identidad no la
recibe hoy `actualizarSolicitud`; el router ya la tiene (`sesionDe(req).email`) y
solo la usa para el log. Se le pasa: en una corrección del registro de la compañía,
«alguien cambió esto» sin decir quién vale mucho menos que el nombre.

## El evento nuevo

Grupo propio, por la misma razón que `EVENTOS_MODIFICACION` está aparte: su
constructor de payload necesita la foto del **antes**, que los de solicitud no
tienen.

```ts
export const EVENTOS_CORRECCION = ['correccion_admin'] as const;
export type EventoCorreccion = (typeof EVENTOS_CORRECCION)[number];
export const EVENTOS = [...EVENTOS_SOLICITUD, ...EVENTOS_MODIFICACION, ...EVENTOS_CORRECCION] as const;
```

`construirPayloadCorreccion(previa, actual, adminEmail)` devuelve:

- `correo`: el de arriba.
- `calendario`: la acción de la tabla, o `null`.
- `hoja`: **`null` siempre**.

Sin parámetro `evento`, al contrario que `construirPayloadModificacion`: allí hay
tres textos que elegir y aquí uno solo. Si algún día aparece un segundo, se añade
entonces.

**Los dos primeros parámetros son `Solicitud` enteras** —la relectura previa al
UPDATE y la posterior—, no estructuras nuevas. Llevan ya todo lo que hace falta
—estado, fechas, días, tipo, empleado y `eventoCalendarioId`— y una foto parcial
sería una tercera forma de describir la misma fila.

### Migración 027

Solo para ampliar el CHECK `outbox_evento_check` con `correccion_admin`. El ancho
**no** hace falta tocarlo: la 025 dejó la columna en `VARCHAR(40)` y el nombre
mide 16. Se dice explícito aquí porque la lección de la 024 fue justo esa —CHECK y
ancho son dos restricciones distintas—, y esta vez la mitad que faltaba ya está
pagada.

DDL, idempotente, y **añadir a mano al array `MIGRATIONS` de `db.ts`**: olvidarlo
no da error.

## La columna que hoy miente

`evento_calendario_id` pasa a significar «hay un evento vivo en Google», no
«impusimos un id alguna vez». Se vacía cuando se emite un `borrar`.

Se arregla donde ya se escribe, extendiendo `anotarEventoDeCalendario`: `crear`
escribe, `borrar` vacía. Y **`decidirModificacion` pasa a llamarla**, que hoy no lo
hace: emite su `borrar` con un `INSERT` directo y deja el id puesto.

Tiene **un solo lector real** (`correccionDeCalendario`, `notificaciones.ts:445`),
así que el cambio de significado se aplica en un sitio. `apps/ausencias/src/api.ts`
lo declara en la interfaz pero no lo usa para decidir nada.

Sin esto, devolver a `aprobada` una fila anulada mandaría un `actualizar` contra un
evento que Google ya no tiene. El IF «¿El fallo es esperable?» se lo tragaría como
404 esperable y **nadie sabría que el evento no volvió**.

## Tests

⚠️ **Los unitarios de `router.test.ts` mockean el repo entero, así que estos
candados no los caza el portón rápido.** Van a `.db.test.ts`, contra Postgres real,
que es el cuarto portón (`npm run test:db`) y es un step bloqueante del CI. Es
literalmente la lección de ayer: estrechar el `WHERE` del solapamiento dejaba
531/531 unitarios en verde.

Cada candado se falsa rompiéndolo de verdad y comprobando por qué cae:

| Mutación | Qué tiene que ponerse rojo |
|---|---|
| El predicado del «después» se estrecha a solo `aprobada` | Una incapacidad `registrada` editada deja su evento colgado en Google |
| Se quita `cambiaElCalendario` y se emite `actualizar` siempre | Corregir solo los días de una aprobada manda a Google un update idéntico y un correo que dice que se corrigió algo |
| Se quita `cambiaLaHoja` y se emite con solo `estaEnElCalendario` | Corregir solo las `observaciones` manda un ⚠️ sin nada que ajustar |
| `cambiaElCalendario` se amplía a `dias` o `comentarios` | Vuelve el update no-op: esos dos campos no salen en el evento de Google |
| Se quita el vaciado del id en `borrar` | Re-aprobar una anulada emite `actualizar` sobre un evento inexistente |
| El `INSERT` del outbox sale de la transacción | Una corrección que revienta deja el correo dicho |
| El destinatario pasa a ser el solicitante | El aviso va a quien no tiene que tocar la hoja |
| Se quita el `?? COPIA_POR_DEFECTO` | Una ficha sin copia deja una fila del outbox que n8n reintenta para siempre |

Los textos del correo son funciones puras: esos sí van en los unitarios de
`notificaciones.test.ts`, donde el doble no estorba.

## Lo que NO hace

- **No crea eventos.** El `crear` queda fuera; ver *Alcance*.
- **No toca la hoja.** Nunca, y el ⚠️ lo dice en los tres casos.
- **No cierra ninguna ventana de carrera.** `withTransaction` abre un `BEGIN`
  pelado (READ COMMITTED) y la lectura previa no lleva `FOR UPDATE`, igual que en
  el solapamiento. Lo que gana la transacción es que el correo y la fila se
  deshagan juntos.
- **No arregla las filas ya desincronizadas.** Las aprobadas antes del 026 siguen
  sin id y siguen pidiendo el ajuste a mano; se vacían solas con el tiempo.
- **No cambia n8n.** Verificado, no supuesto.

## Riesgo aceptado

El `PATCH` empieza a mandar correos donde antes no mandaba ninguno. Las filas
importadas del Excel no tienen `evento_calendario_id` pero sí `estado='aprobada'`,
así que caen en el caso «⚠️ Ajustar calendario y hoja» — el que **sí** manda
correo. `cambiaLaHoja` recorta el ruido pero no lo elimina: solo se callan las
correcciones de `observaciones`. Marcar una fila como `rechazada` o cuadrarle los
días **sí** manda correo, que son justo las dos cosas que hace una limpieza del
histórico.

No se filtra por `origen`, aunque se consideró. Una fila `origen='hoja'` está en
el calendario y en la hoja igual que las demás: las puso ahí el flujo viejo de
n8n. El ⚠️ dice la verdad sobre ellas, y filtrarlas sería callarse justo en los
casos donde el histórico y Google pueden discrepar de verdad.

La limpieza pendiente de los dos solapes reales entra por aquí: hacerla **antes**
de desplegar esto la deja sin correo; después, manda uno por fila tocada. Ninguna
de las dos opciones es mala — conviene saber cuál se elige.
