# Diseño — Una persona no puede estar ausente dos veces a la vez

## Objetivo

Que una misma persona no pueda tener dos ausencias vivas que compartan un día.
Hoy puede: nada lo impide, y en producción ya hay un caso real —vacaciones
aprobadas del 10 al 14 de agosto y un permiso aprobado el 14, el mismo empleado—
que se creó sin que el sistema dijera nada.

## Lo que hay hoy, verificado

Tres hechos leídos del código, no supuestos. El primero condiciona todo el resto:

1. **No existe ninguna comprobación de solapamiento en ninguna parte.**
   `validarNuevaSolicitud` (`service.ts:78-113`) es puramente sintáctica: tipos,
   formatos, rango invertido, fecha en pasado, tamaño del adjunto. **Nunca toca la
   base de datos.** Añadir esta regla la convierte en una validación que consulta,
   y eso es un cambio de naturaleza, no un `if` más.

2. **El predicado de solapamiento ya está escrito**, en `repo.ausenciasEntre`:
   `fecha_inicio <= $hasta AND fecha_fin >= $desde`. Es la condición correcta
   —solapa, no contiene— y tiene su porqué documentado allí: la contención perdería
   justo las ausencias que cruzan el cambio de mes. Se reutiliza; no se escribe otra.

3. **`AusenciaError` no puede llevar datos** (`service.ts`): solo `code`, `status`
   y `field`, y `sendError` (`router.ts:28-31`) serializa esos tres. Un error que
   diga «te solapas» sin decir **con qué** deja a la persona sin saber qué corregir,
   así que hace falta una extensión mínima.

## La regla

Para una misma persona, dos ausencias **vivas** no pueden compartir ningún día.

- **Vivas**: `pendiente`, `pendiente_2`, `aprobada`.
- **No cuentan**: las rechazadas. Eso **incluye las anuladas**, que se guardan con
  ese mismo estado más `anulada_at`: nunca llegaron a ocurrir.
- **Las incapacidades no participan**: ni se bloquean ni bloquean a nadie.
- **Rangos inclusivos**: 10–14 y 14–14 solapan. Adyacentes (10–14 y 15–20) no.

> ⚠️ **Esa enumeración se quedó corta, y se anota en vez de reescribirse.**
> Comprobado contra el código el 2026-08-18, al documentar la regla ya
> implementada: `repo.ocupaAgenda` **no enumera** los estados vivos, dice
> `estado !== 'rechazada'`. Así que **`registrada` también ocupa**, y falta en
> la lista de arriba.
>
> No es un matiz sin consecuencia: hoy solo nace `registrada` una incapacidad
> —que queda fuera por su tipo—, pero `validarEdicionSolicitud` admite
> **cualquier tipo con cualquier estado**, así que un permiso `registrada` es
> alcanzable por el `PATCH` del *Registro general*, y ese sí ocupa agenda. El
> frontend ya lo contempla: `SOLAPE_POR_ESTADO` (`api.ts`) tiene su rama.
>
> Y está escrito en negativo **a propósito**, no por descuido de este spec: una
> lista de estados vivos deja fuera al que se invente mañana, y aquí quedarse
> fuera significa dejar pasar un solapamiento. El párrafo de arriba se deja como
> estaba, que es lo que este documento decía el día que se diseñó; la versión
> vigente vive en `docs/dev/app-ausencias.md`, sección «Una persona no puede
> estar ausente dos veces a la vez».

### Por qué las pendientes también ocupan

Bloquear solo contra las aprobadas deja un agujero que se cierra solo en el peor
momento: se piden dos solicitudes solapadas mientras ninguna está firmada, y al
aprobarlas el solapamiento existe igual, ya sin nadie que pueda impedirlo. La
regla tiene que morder antes de la firma o no muerde.

### Por qué la incapacidad es la excepción

Una incapacidad **no se pide: se informa** después de haber estado enfermo. Quien
cae malo durante sus vacaciones tiene que poder registrarla, y con las fechas ya
pasadas no puede anular (exige `fechaInicio >= hoy`) ni acortar (exige
`fechaFin >= hoy`) para hacerle sitio. Bloquearla dejaría a esa persona sin forma
de registrar algo que la ley sí reconoce.

**Fuera de alcance, y es una decisión, no un olvido**: informar una incapacidad
sobre unas vacaciones aprobadas **no** libera esos días ni los devuelve al saldo.
Es lo que suele hacer la ley, pero toca saldo, calendario, correos y el evento de
Google, y es un proyecto propio.

## Dónde se comprueba: cuatro puertas, no tres

Hay tres vías por las que se pueden crear o mover fechas, pero la del cambio de
fechas son **dos momentos distintos**:

| Puerta | Cuándo | Dónde |
|---|---|---|
| Alta de solicitud | al crear | `service.crearSolicitud` |
| Propuesta de cambio de fechas | al **proponer** | `service.pedirModificacion`, solo la clase de fechas |
| Decisión de la propuesta | al **aprobar** | dentro de la transacción de `repo.decidirModificacion` |
| Corrección de admin | al editar | `service` / `repo.actualizarSolicitud` (`PATCH`) |

Sin la tercera queda un hueco real: se propone mover al 20–22, entre medias le
aprueban otra cosa el 21, y el jefe firma el cambio encima. Va **dentro de la misma
transacción** que ya aplica el cambio, junto al testigo triple que ya vive ahí: si
choca, `ROLLBACK` y 409, exactamente como el testigo.

**Anular no se comprueba**: quitar una ausencia nunca puede crear un solapamiento.

## La consulta

Función nueva en `repo.ts`, pegada a `ausenciasEntre` y con su mismo predicado:

```sql
SELECT id, tipo, estado,
       fecha_inicio::text AS fecha_inicio,
       fecha_fin::text    AS fecha_fin
  FROM portal.solicitudes_ausencia
 WHERE empleado_id = $1
   AND estado <> 'rechazada'
   AND tipo   <> 'incapacidad'
   AND ($4::uuid IS NULL OR id <> $4)
   AND fecha_inicio <= $3::date
   AND fecha_fin    >= $2::date
 ORDER BY fecha_inicio, id
 LIMIT 1
```

Devuelve **la primera colisión o nada**: el mensaje solo puede nombrar una, y
buscar todas sería trabajo que nadie lee.

Dos cosas que el código tiene que explicar:

- **`id <> $4` es imprescindible.** Sin él, cambiar las fechas de una solicitud
  chocaría siempre contra ella misma. Qué pasa cada puerta: el **alta**, `null`
  —todavía no hay fila—; las otras tres, **el id de la solicitud que se está
  moviendo**. Y las fechas que se comparan son siempre **las propuestas**, no las
  que la solicitud tiene ahora.
- **Aquí el filtro de rechazadas falla en CERRADO**, al revés que en
  `ausenciasEntre`. Si mañana aparece un estado nuevo, allí se pintaría de más y
  aquí se bloquearía de más. Bloquear de más lo reporta un usuario el mismo día;
  pintar de más no lo nota nadie.

## El error

`rango_solapado`, **409** —es un conflicto con el estado, como `solicitud_ya_pasada`
y `anulacion_ya_empezada`— y con el campo `fechaInicio`.

`AusenciaError` gana un cuarto parámetro opcional:

```ts
public readonly detalle?: Record<string, unknown>,
```

y `sendError` pasa a serializar `{ error, field, detalle }`. `JSON.stringify` omite
las claves `undefined`, así que ninguna respuesta actual cambia de forma.

El `detalle` lleva la colisión: tipo, estado y las dos fechas. Con eso el frontend
redacta:

> «Ya tienes unas **vacaciones aprobadas del 17 al 21 de agosto**. Cambia las
> fechas o anula esa solicitud primero.»

## En pantalla

- `api.ts` (espejo) mapea el error nuevo y su `detalle`.
- El formulario de **Nueva solicitud** y el modal de **Cambiar fechas** lo pintan
  en su banner de error, que ya existe en los dos.
- **No** se avisa mientras se escriben las fechas. Exigiría consultar en cada
  pulsación, y un 409 con el texto de arriba resuelve el caso igual de bien.

## Tests

La validación pura ya no cubre esto, así que la cobertura se reparte:

**`router.test.ts`** (doble in-memory), el ciclo completo por HTTP:

- alta solapada da 409 `rango_solapado`, con el `detalle` de la que choca;
- alta **adyacente** (15–20 tras 10–14) da 201: el borde es donde se rompen estas reglas;
- **incapacidad** sobre vacaciones aprobadas da 201;
- una **anulada** y una **rechazada** en el rango dan 201: no bloquean;
- cambiar fechas encima de otra viva da 409 al proponer;
- mover una solicitud sin sacarla de sus fechas da 201: no choca consigo misma;
- `PATCH` de admin encima de otra da 409.

**Contra Postgres real**, lo que el doble no puede probar:

- el SQL de solapamiento con los cuatro bordes: mismo día, extremo con extremo,
  contenida, y a caballo del cambio de mes;
- que otro empleado con las mismas fechas **no** interfiere;
- que aprobar una propuesta que se volvió solapada **entre la propuesta y la firma**
  hace `ROLLBACK` y no deja rastro en el outbox.

**Falsación**: cada candado se rompe de verdad. En concreto, quitar `id <> $4` debe
poner rojo el test de «no choca consigo misma», y estrechar el filtro de estados a
solo las aprobadas debe poner rojo el de las pendientes.

> ⚠️ Este párrafo decía «**y solo ése**», y era falso. Medido el 2026-08-18 sobre
> lo ya implementado: quitar `id <> $4` pone rojos **cuatro** tests, uno de ellos
> de camino feliz. La cobertura salió mejor de lo que este spec prometió, pero la
> afirmación estaba equivocada — y en el párrafo que existe justo para registrar
> falsaciones. La otra mitad sí se cumple: estrechar el filtro de estados pone
> rojos exactamente dos, los dos de las pendientes.

## Lo que NO hace

- **No hay restricción de exclusión en Postgres.** Los solapes que ya existen se
  quedan —y hay al menos uno en producción—, y dos peticiones simultáneas podrían
  colarse por una ventana de milisegundos. Se descartó a propósito: la restricción
  falla al aplicarse si hay datos que la incumplen, y una migración que lanza deja
  hub-api sin arrancar y el portal entero en 502.
- **No libera días** al informar una incapacidad sobre vacaciones aprobadas.
- **No hay escape para el admin.** Si algún día hace falta una excepción, habrá que
  quitar la comprobación del `PATCH` a conciencia.
