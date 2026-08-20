# Diseño — Borrar una solicitud limpia su evento del calendario

## Objetivo

Que borrar una solicitud desde *Registro general* deje de abandonar su evento en
el Google Calendar de Ambientalia Staff.

Hoy `repo.borrarSolicitud` hace un `DELETE` pelado y **no encola nada**. Nunca lo
ha hecho: no es una regresión del trabajo del calendario, es el único camino de
los cuatro que sigue sin usar la maquinaria que ya existe. Borrar una ausencia
aprobada deja un evento fantasma que nadie va a relacionar con nada.

Se descubrió el 2026-08-19 preparando la limpieza de las solicitudes de prueba:
tres de ellas tenían evento vivo en Google y el borrado se las habría dejado
puestas.

## Lo que hay hoy, verificado

Cinco hechos leídos del código, no supuestos. Los tres primeros son los que
deciden el diseño.

1. **`eventosPendientes` NO hace `JOIN` con `solicitudes_ausencia`**
   (`repo.ts:1844`). Lee solo del outbox y devuelve `payload`, que es
   autocontenido. Una fila del outbox **funcionaría igual aunque su solicitud ya
   no exista**: n8n nunca mira la solicitud.

2. **`/ausencias/n8n/confirmado` confirma por `id` del outbox**, no por
   `solicitud_id` (`router.ts:548`). Así que `solicitud_id` es puramente
   informativo en la respuesta a n8n: no se usa ni para entregar ni para
   confirmar.

3. **`ausencias_outbox.solicitud_id` es `ON DELETE CASCADE`**
   (`015_ausencias.sql:92`). Es lo ÚNICO que impide encolar un borrado y borrar
   la fila: las dos operaciones se anulan mutuamente.

4. **La cascada hace un segundo trabajo que nadie eligió.** Además de impedir el
   borrado del evento, **suprime los correos pendientes** de esa solicitud. Borrar
   una recién creada mata su acuse antes de que salga. Ese comportamiento es
   correcto y hay que conservarlo — pero hoy es un efecto colateral, no una
   decisión.

5. **`borrarSolicitud` no es transaccional**: dos consultas sueltas contra el
   `Pool` (`repo.ts`, ~línea 730).

## La forma elegida: `ON DELETE SET NULL`

`solicitud_id` deja de ser `NOT NULL` y la clave ajena pasa a `ON DELETE SET
NULL`. La fila del outbox sobrevive a su solicitud con `solicitud_id = NULL`.

Se eligió sobre las otras dos por una razón concreta: **el `NULL` significa algo
legible en el dato** —«su solicitud ya no existe»— en vez de exigir saberlo. Y la
clave ajena **sigue validando en el `INSERT`**, así que un id inventado se sigue
rechazando; lo único que se relaja es qué pasa al borrar.

Las descartadas:

- **Quitar la clave ajena entera.** Cero cambios de tipo, pero el outbox pasaría a
  no tener ninguna relación declarada con nada y se perdería la validación al
  insertar.
- **Una tabla aparte para los huérfanos.** Deja el outbox intacto a cambio de dos
  colas, dos sitios donde mirar y un `UNION` en la consulta que corre cada minuto.

Coste asumido: `EventoPendiente.solicitudId` pasa a `string | null`, y ese `null`
viaja en el JSON que recibe n8n. **No rompe a nadie** —verificado en los hechos 1
y 2— y es la verdad sobre esa fila.

## Los tres pasos, y por qué en ese orden

`borrarSolicitud` pasa a `withTransaction`:

```
lee la fila entera (después del DELETE ya no existe en ningún sitio)
1. DELETE de sus filas del outbox con `enviado_at IS NULL`
2. si estaEnElCalendario(previa.estado) → INSERT del `borrado_admin`
3. DELETE de la solicitud → la cascada pone a NULL el `solicitud_id` del paso 2
```

**La condición del paso 2 es `estaEnElCalendario(previa.estado)`, no «hay
`eventoCalendarioId`».** Son dos preguntas distintas y aquí importa no
confundirlas, porque cada fila del outbox **es exactamente un correo**:

- **Si emitir la fila** lo decide `estaEnElCalendario(previa.estado)`: la ausencia
  estaba en el calendario y en la hoja, así que al borrarla queda algo
  desincronizado y hay que avisar.
- **Si esa fila lleva acción de calendario** lo decide `eventoCalendarioId !==
  null`: solo se puede borrar el evento cuyo id impusimos nosotros.

Una aprobada **anterior a la migración 026** cae en medio: sí emite la fila —hay
que avisar, porque su evento y su fila de la hoja siguen ahí— pero su `calendario`
va a `null` y el ⚠️ pide hacerlo a mano. Guardar el paso 2 detrás del id dejaría
justo ese caso, el que más necesita a una persona, sin avisar a nadie.

Es el mismo reparto que en la corrección del registro, y por el mismo motivo.

**El paso 1 es lo que hoy hace la cascada, ahora escrito a propósito.** Al relajar
la clave ajena, esa supresión desaparecería sola y empezarían a entregarse correos
anunciando una solicitud que ya no existe. Que estuviera bien era casualidad; ahora
es una decisión con su motivo.

**El orden de 1 y 2 no es indiferente:** invertidos, el paso 1 se lleva por delante
el borrado que el paso 2 acaba de encolar, y el evento se queda en Google. Es
exactamente el fallo que esta feature viene a arreglar, reintroducido por dentro.

**El paso 2 va antes del 3** porque la clave ajena valida en el `INSERT`: con la
solicitud ya borrada, ese `INSERT` fallaría.

La transacción gana algo concreto y acotado: si el constructor del payload
revienta, no queda ni la solicitud borrada ni el correo dicho. Lo que **no** gana
es cerrar ninguna ventana de carrera —`BEGIN` pelado, READ COMMITTED—, igual que
en el resto del fichero.

### El caso límite: aprobar y borrar dentro de los diez minutos

Decisión tomada, no descuido. El paso 1 se lleva el evento `aprobada` que todavía
no se había servido —el que iba a **crear** el evento en Google— y el paso 2 encola
el borrado de algo que Google nunca llegó a crear. Google contesta **404**, que es
uno de los tres códigos que el IF «¿El fallo es esperable?» del workflow ya tolera
a propósito.

Sale ruido en el historial de n8n, no un fallo. La alternativa —conservar el
`aprobada` pendiente para que se cree y se borre en orden— entregaría un correo
anunciando la aprobación de una solicitud ya borrada, que es peor.

## La migración 028

Tres cambios, los tres idempotentes y solo DDL:

1. `solicitud_id` deja de ser `NOT NULL`.
2. La clave ajena pasa a `ON DELETE SET NULL`.
3. El CHECK `outbox_evento_check` admite `borrado_admin`.

⚠️ **La guarda de idempotencia de la clave ajena mira `confdeltype` en
`pg_constraint`, no el nombre.** El nombre lo puso Postgres solo
(`ausencias_outbox_solicitud_id_fkey`) y darlo por bueno es la misma trampa que
documenta la 024. Si `confdeltype` ya es `'n'`, el bloque no se ejecuta.

El ancho de `evento` no hace falta tocarlo: la 025 lo dejó en `VARCHAR(40)` y
`borrado_admin` mide 13.

**Hay que añadirla a mano al array `MIGRATIONS` de `db.ts`**; olvidarlo no da
ningún error.

## El correo

### Cuándo

`estaEnElCalendario(previa.estado)`, y solo eso. **No hay `cambiaLaHoja` aquí**:
un borrado cambia todo, siempre. Si la fila nunca estuvo en Google no hay nada que
avisar, y borrarla no encola nada.

### A quién

`destinatarios(previa.copiaCorreo ?? COPIA_POR_DEFECTO)` — administración, la copia
de la ficha. **Nunca al trabajador ni a la cadena de firmas**, por el mismo
criterio que la corrección del registro: el `PATCH` y el borrado son vías de
mantener el registro, no de decidir sobre la ausencia de nadie.

El `??` por lo mismo que allí: es el único correo con una sola fuente de
destinatario, y un `sendTo` vacío deja una fila que n8n reintenta cada diez
minutos para siempre.

### Qué dice

Dos situaciones, no cuatro como en la corrección: no existe el caso «el calendario
no cambia».

| Situación | Prefijo del asunto | Qué dice del calendario |
|---|---|---|
| Con `eventoCalendarioId` | `⚠️ Ajustar la hoja — ` | ya se ha borrado solo |
| Sin él | `⚠️ Ajustar calendario y hoja — ` | hay que borrarlo a mano |

⚠️ **Los textos son nuevos, no los de la corrección con otra situación.** El verbo
cambia: en una corrección la fila de la hoja se **ajusta**; en un borrado se
**borra**. Reutilizar aquellos mandaría a administración a «ajustar a las fechas
nuevas» una fila cuya solicitud ya no existe.

El cuerpo lleva la foto de lo borrado —tipo, fechas, días, estado y empleado— y
**quién lo borró**. Esa identidad ya la tiene el router (`sesionDe(req).email`) y
hoy solo la usa para el log; se le pasa al repo, como en el `PATCH`.

## Lo que NO hace

- **No toca la hoja.** Nunca, por la razón de siempre: n8n hace `append` y no queda
  constancia de en qué fila cayó.
- **No hace el borrado reversible ni le añade confirmación.** Sigue siendo
  irreversible y sigue sin preguntar. Esta feature no cambia eso.
- **No crea eventos**, obviamente, ni corrige nada: solo borra.
- **No cierra ninguna ventana de carrera.**
- **No cambia n8n.** Ningún nodo lee el nombre del evento —verificado sobre el
  workflow publicado `dh0xjWCHsGj9raYH` al construir la corrección del registro—,
  así que un `borrado_admin` fluye por el Switch como cualquier otro.

## Tests

⚠️ Van todos a `.db.test.ts`, contra Postgres real. El doble en memoria de
`router.test.ts` **no tiene transacción ni claves ajenas**, así que ninguno de
estos candados es cazable ahí. Es la lección de la regla de solapes, otra vez.

Cada candado se falsa rompiéndolo de verdad:

| Mutación | Qué tiene que ponerse rojo |
|---|---|
| Devolver la clave ajena a `ON DELETE CASCADE` en la 028 | La fila del `borrado_admin` desaparece con su solicitud |
| Invertir los pasos 1 y 2 | La limpieza de pendientes se lleva el borrado recién encolado |
| Quitar el paso 1 | Borrar una solicitud recién creada entrega su acuse igualmente |
| Quitar la guarda de `estaEnElCalendario` | Borrar una `pendiente` manda un ⚠️ sobre una fila que nunca estuvo en Google |
| Guardar el paso 2 detrás de `eventoCalendarioId` en vez de `estaEnElCalendario` | Borrar una aprobada anterior a la 026 no avisa a nadie, y es el caso que más lo necesita |
| Sacar el `INSERT` de la transacción | Un fallo del payload deja el correo dicho y la solicitud sin borrar |

Y un test que **no** es un candado sino la prueba de que la clave ajena hace lo
suyo: tras el borrado, la fila del outbox existe **y su `solicitud_id` es `NULL`**.
Es lo que distingue esta forma de las otras dos que se descartaron.

## Riesgo aceptado

Las filas del outbox de solicitudes borradas **ya no se limpian solas**: se quedan
ahí con `solicitud_id` a `NULL`. Es lo que se pidió —son el registro de algo que
ocurrió— pero conviene decirlo: esa tabla deja de vaciarse por sí sola cuando se
borra una solicitud, y crece de forma monótona.

No se añade purga en esta feature. Si algún día la tabla molesta, el criterio
natural es borrar por `enviado_at` antiguo, no por `solicitud_id IS NULL`: lo
huérfano no es lo viejo.
