# Modificación de solicitudes ya enviadas — App «Vacaciones y Permisos»

## Context

Hoy, cuando un trabajador manda una solicitud de vacaciones, esa decisión es irreversible desde su lado. Si le cambian los planes no tiene ninguna salida dentro de la app: el único camino de edición es `PATCH /ausencias/solicitudes/:id`, que es `requireAdmin` y que **a propósito no encola notificaciones** («corregir el registro no es decidir», `repo.ts:618-621`). En la práctica eso significa pedirle por privado a un administrador que le toque la fila, sin rastro de quién lo pidió, por qué, ni con el visto bueno de nadie.

Esta feature abre ese camino con su debido proceso: **el trabajador pide cambiar las fechas o anular la solicitud, y su jefe lo aprueba o lo rechaza.** Aplica tanto a solicitudes ya aprobadas como a las que aún están pendientes de firma.

**Decisiones de producto ya tomadas:**
- Alcance: **cambiar fechas** y **anular**. No cambiar el tipo ni reasignar (eso sigue siendo del admin).
- Google: cuando se apruebe un cambio sobre una solicitud ya aprobada, el evento de Calendar y la fila de la hoja **no se corrigen solos**. Se manda un correo avisando de qué cambió y alguien lo ajusta a mano. No se toca n8n — el objetivo del proyecto es desenganchar Google, no invertir más en él.
  > **Superado el 2026-08-18 para el calendario.** Esta decisión daba por hecho que corregir el evento era caro porque no se sabía cuál era. Resultó que el id se puede **imponer** al crearlo, y con eso anular borra el evento y reprogramar lo mueve. La hoja sigue como dice este párrafo. Ver «El calendario se corrige solo» en `docs/dev/app-ausencias.md`.

## La forma: una tabla satélite, no estados nuevos

Una tabla `portal.solicitud_modificaciones` guarda la propuesta. **La fila de `solicitudes_ausencia` no se toca hasta que el jefe aprueba.** La máquina de estados (`types.ts:72-90`) queda intacta: ni un estado nuevo, ni el CHECK de `estado` que ampliar, ni ninguno de los seis `estado IN (...)` que revisar.

Se descartó añadir estados (`pendiente_cambio`, `anulada`) porque obligaría a tocar seis filtros escritos a mano, y **uno de ellos falla en abierto**: `repo.ts:1166` filtra `estado <> 'rechazada'`, así que un estado `anulada` **seguiría pintándose en el calendario** como ausencia vigente. Ese es el fallo que nadie detecta. Además, un estado nuevo destruye información: una `aprobada` que pasa a `pendiente_cambio` pierde el hecho de que estaba aprobada, y volver atrás cuando el jefe rechaza exige guardar el estado previo — que es la tabla satélite, con peor forma y dentro de la tabla caliente.

También se descartó «cancelar y recrear»: recrear pasa por `crearSolicitud`, que rederiva `aprobadoresDe` contra el organigrama de hoy, y la cancelación sería unilateral — justo lo que la feature existe para impedir.

**Anular no estrena estado.** Aprobar una anulación deja `estado = 'rechazada'` + una columna nueva `anulada_at`. Verificado: `rechazada` hereda la semántica correcta en los seis filtros — deja de consumir saldo (`saldo.ts:172`), no entra en trámite (`saldo.ts:180`), desaparece del calendario (`repo.ts:1166` y `calendario.ts:107`), no entra en la bandeja (`repo.ts:868`) y **sigue en el historial del jefe** (`repo.ts:892`), que es lo correcto porque él la decidió. La etiqueta «Anulada» se deriva en el frontend, no se almacena.

## Decisiones de diseño

**Quién aprueba: los firmantes congelados de la solicitud, nunca se rederiva el organigrama.** Una modificación no es una solicitud nueva, es una enmienda sobre una en vuelo o ya concedida. Rederivar mandaría «anula mis vacaciones aprobadas» a un jefe nuevo que no sabe que se aprobaron. Función pura nueva junto a `correoDelTurno` en `types.ts`:

```ts
decisorDeModificacion(s) = correoDelTurno(s) ?? s.aprobadorCorreo
```

En trámite decide quien tiene el turno; ya cerrada, el jefe inmediato. `null` (incapacidad) ⇒ no admite modificación.

**Sin segunda firma para la modificación.** La segunda firma valida la concesión, que ya está validada; y exigir dos firmas para *renunciar* a unas vacaciones es absurdo — es el mismo argumento con que se justificó la casilla `requiere_segunda_firma` en la 023. Para una `pendiente_2`, `decisorDeModificacion` ya devuelve al segundo firmante, que es el más sénior. **Sin rebote hacia atrás**: aprobar un cambio sobre una `pendiente_2` no la devuelve a `pendiente`; `transicionAlDecidir` es monótona por diseño y una arista hacia atrás repoblaría la bandeja del primer jefe mientras el segundo decide.

**El saldo no mira las propuestas. `saldo.ts` no se toca, cero líneas.** Una aprobada de 5 días con propuesta pendiente de 3 sigue diciendo `disfrutadas: 5`. Si la anulación pendiente liberara los días, el trabajador pediría la anulación y acto seguido esos mismos días en otras fechas, con el saldo bendiciéndolo; si el jefe rechaza, quedan dos ausencias sobre los mismos días y ningún sitio donde deshacerlo — la acción unilateral reintroducida por la puerta del saldo. Es además la regla ya escrita en `saldo.ts:171`: «media firma NO descuenta», y una propuesta es menos que media firma. Lo que sí se enseña al jefe es el **delta** en la `TarjetaSaldo` de la bandeja («aprobar esto le devuelve 2 días»).

**Qué solicitudes admiten modificación:**

| estado | ¿admite? | al aprobar |
|---|---|---|
| `pendiente` / `pendiente_2` | sí | fechas: reescribe, **el estado no cambia**. anulación: `rechazada` + `anulada_at` |
| `aprobada` | sí — el caso principal | igual; **es el único que dispara el aviso de ajustar Google** |
| `rechazada` | no, 409 | los días nunca se concedieron; lo que quiere es volver a pedir, y para eso está `POST /solicitudes` |
| `registrada` | no, 409 | una incapacidad se informa, no se concede: no hay aprobador a quien mandarlo |

Regla de fechas pasadas: **se admite si `fechaFin >= hoyEnColombia()`**, no `fechaInicio`. Una ausencia en curso es justo el caso donde «córtala, tengo que volver» es legítimo; una ya terminada es corrección de nómina, no aprobación.

Solo el **dueño** puede pedirla (`empleadoId` sale de la sesión, nunca del cuerpo, igual que en `crearSolicitud`). Puede **retirar** su propia propuesta pendiente, sin correo: retirar deja la solicitud exactamente como estaba.

**Concurrencia — el mismo patrón de comparar-y-actualizar que `repo.decidirSolicitud` (`repo.ts:938-982`), en tres puntos:**
1. El INSERT de la propuesta lleva `AND s.estado = $8` (el estado leído) y resuelve la foto previa en la misma sentencia. Sin él, `estado_previo` podría mentir y el correo no avisaría de tocar Google.
2. Al aprobar, el UPDATE de la solicitud lleva **testigo de tres campos** (`estado`, `fecha_inicio`, `fecha_fin`), no uno: con solo `estado` no se detecta que un admin haya corregido las fechas por `PATCH` entre medias y la aprobación las pisaría en silencio.
3. Dos propuestas a la vez las corta un **índice único parcial** en BD, no la lógica. Es load-bearing: `SELECT_SOLICITUD` se usa en **ocho** consultas y un `LEFT JOIN` con dos filas vivas multiplicaría resultados en todas.

Todo dentro de `withTransaction`, con el INSERT del outbox dentro, como en el resto del fichero.

**Tres eventos nuevos**, todos con `calendario: null` y `hoja: null` — así n8n recorre la rama de solo-correo que ya usan `creada` y `aprobacion`, sin tocar el workflow:

| evento | destinatarios |
|---|---|
| `modificacion_solicitada` | solo el decisor |
| `modificacion_aprobada` | `cadenaDeDecision(s)` completa |
| `modificacion_rechazada` | `cadenaDeDecision(s)` completa |

El correo de aprobación lleva las **cuatro fechas** (antes y después) y los dos recuentos. El párrafo de ⚠️ «hay que ajustar el calendario y la hoja a mano» aparece **solo si `estado_previo ∈ {aprobada, registrada}`** — si la original seguía pendiente nunca se mandó nada a Google, y entrenar a la gente a ignorar el ⚠️ es la forma segura de que el día que importe no lo lean.

## Ficheros

**Backend** (`apps/hub-api/src/`)
- `users/migrations/024_ausencias_modificaciones.sql` — **nuevo**: la tabla, el índice único parcial, `anulada_at`, y la ampliación del CHECK del outbox.
- `db.ts:24` — añadir la migración al array `MIGRATIONS`. Olvidarlo no da error.
- `ausencias/types.ts` — tipos, `decisorDeModificacion`, los tres eventos en `EVENTOS`.
- `ausencias/repo.ts` — `crearModificacion`, `decidirModificacion`, `retirarModificacion`, `modificacionesPendientes`, y el `LEFT JOIN` en `SELECT_SOLICITUD` (`repo.ts:686`).
- `ausencias/service.ts` — `validarNuevaModificacion`, `pedirModificacion`, `decidirModificacion`, `puedePedirModificacion`, `puedeDecidirModificacion`.
- `ausencias/notificaciones.ts` — los tres correos y `construirPayloadModificacion`. Ampliar también el JSDoc del reparto de efectos en `construirPayload` (`:275-292`), único sitio que documenta qué evento lleva qué efecto.
- `ausencias/router.ts` — cuatro endpoints, todos bajo `...gated`.

**Frontend** (`apps/ausencias/src/`)
- `PedirModificacion.tsx` — **nuevo**. Molde: `EditarSolicitud.tsx` (overlay, `role="dialog"`, banner de error, contador de días, pie de botones), recortado a: radio fechas/anular, dos `input type=date`, motivo, un antes/después explícito, y la frase que no puede faltar: *«Esto es una petición. Las fechas no cambian hasta que tu jefe la apruebe.»*
- `TablaSolicitudes.tsx` — el slot `acciones` (`:12,40,82`) **ya existe y hoy no se usa** en «Mis solicitudes»; ahí van los botones. Añadir el chip ámbar «Cambio pendiente» en la celda Estado, que con una sola edición cubre las cuatro pantallas.
- `BandejaAprobacion.tsx` — tercera sección «Cambios pedidos», **separada** de la tabla principal: dos parejas de botones con significados distintos en la misma fila es cómo alguien aprueba lo que no era. Reutiliza el patrón de motivo inline (`:79-107`).
- `App.tsx` — cargar en el `Promise.all` del arranque (`:81-94`) con `.catch(() => [])`, refresco in-place copiando `onDecidida` (`:164-195`), y el contador de la pestaña sumando modificaciones.
- `api.ts` / `dominio.ts` — espejo manual de los tipos, `puedePedirModificacion`, `resumenCambio`.

**Red de compatibilidad obligatoria:** `modificacionPendiente` y `anuladaAt` ausentes (hub-api viejo) deben degradar al comportamiento anterior, nunca a uno roto. Precedentes: `chipDe`, `esMiTurno !== false`.

## Fases

Cada una desplegable sola; hub-api siempre antes que el portal.

1. **Migración sola, sin código.** Si una migración lanza, `initDb` no captura y hub-api no arranca — se cae el portal entero. Aislarla deja el arranque como única cosa que verificar.
2. **Backend: crear y retirar.** Al terminar se puede verificar con `curl` en producción antes de que exista ningún botón.
3. **Backend: decidir.** Incluye los candados de concurrencia. Backend completo y probado por HTTP, aún sin UI.
4. **Frontend del trabajador.**
5. **Frontend del jefe** + (opcional) que el widget del dashboard cuente también los cambios, o su contador discrepará del de la pestaña.

## Verificación

**Portones:** `npm run build --workspace=apps/hub-api`, `npm run test --workspace=apps/hub-api` (609 tests hoy), `npm run build --workspace=apps/portal`. PowerShell: `Set-Location` absoluto al principio de cada comando, nunca `2>&1` sobre `npm`/`git`.

**Tests nuevos** en `service.test.ts` (puros), `notificaciones.test.ts` y `router.test.ts` (HTTP con doble in-memory). Los **candados**, que son lo que de verdad rinde:

- `puedeDecidirModificacion`: **el otro firmante congelado NO puede** (escribirlo como un OR de los dos correos es lo natural y es el bug que `service.ts:328-332` ya documenta), y **el propio solicitante tampoco** (autoaprobarse).
- **Los firmantes no se rederivan**: crear solicitud → cambiar el jefe en la plantilla → pedir modificación → el correo va al jefe **viejo**. *Falsarlo:* llamar a `aprobadoresDe` en `crearModificacion`.
- **El saldo ignora las propuestas**: aprobada de 5 + propuesta de 3 ⇒ `disfrutadas: 5`, `enTramite: 0`. Ídem con anulación pendiente.
- **Nada toca Google**: los tres eventos salen por `GET /ausencias/n8n/pendiente` con `calendario: null` y `hoja: null`, comprobado **sobre el payload HTTP**, que es el contrato que n8n lee. *Falsarlo:* «arreglar» Google emitiendo `calendario` → n8n crearía un evento duplicado en vez de corregir el viejo.
- **El aviso de Google en los dos sentidos**: aparece con `estado_previo = 'aprobada'`, **no** aparece con `'pendiente'`. Un solo test del caso positivo no detecta el falso positivo.
- **Concurrencia A/B/C**: estado cambiado entre read e insert ⇒ 409 y cero filas; doble decisión ⇒ 200 + 409 y **un solo evento** en el outbox; `PATCH` de admin entre medias ⇒ 409 y las fechas del admin intactas.
- **Aprobar un cambio no re-decide la solicitud**: sobre una `aprobada`, el estado sigue siendo `aprobada`. Y **rechazar la deja idéntica**, comparando el objeto entero.

**Criterio de aceptación, no opcional:** cada candado se valida **rompiendo el invariante en local y viendo el test en rojo** antes de mezclar. La lección del equipo es literal — cuatro tests que pasaban por construcción no detectaban nada.

**Fixtures nuevos tipados**, sin repetir el `null as any` de `router.test.ts:34`, que ya costó una vez 11 tests caídos sin que el build dijera nada.

**Manual, tras cada despliegue de backend:** `curl` a los cuatro endpoints, y `SELECT evento, payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 5` para confirmar que los eventos de modificación llevan `calendario` y `hoja` en `null`.

## Riesgos y fuera de alcance

**Riesgos:** el `DROP + ADD CONSTRAINT` toma un ACCESS EXCLUSIVE momentáneo sobre `ausencias_outbox`, que es la tabla que n8n consulta cada minuto (milisegundos, aceptable). La guarda de idempotencia del CHECK **no puede copiarse tal cual de la 018**: allí el constraint no existía y se comprobaba por nombre; aquí sí existe, así que la guarda debe mirar el **contenido** (`pg_get_constraintdef ... LIKE '%modificacion_solicitada%'`) o el bloque nunca se ejecutaría y el INSERT del outbox reventaría dentro de la transacción de la primera decisión. La corrección manual de Google no tiene acuse: nadie sabe si se hizo — aceptado por decisión de producto.

**Fuera de alcance (YAGNI):** cambiar el tipo o reasignar; segunda firma de la modificación; corrección automática de Google *(se hizo el 2026-08-18 para el calendario: ver la nota de arriba)*; historial de propuestas en la UI (la tabla las guarda todas, ninguna pantalla las lista); contra-propuesta del jefe (rechaza con motivo y el trabajador vuelve a pedir); adjuntar PDF a la modificación; runner de tests del frontend; tocar n8n.
