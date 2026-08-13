# Diseño — Aprobación en cascada de dos niveles (app Vacaciones y Permisos)

## Objetivo

Que una solicitud la firme **primero el jefe inmediato y después el superior de
ese jefe**. Hoy la firma una sola persona, y en la práctica siempre la misma:
`aprobador_correo` vale `comercial@ambientalia.com.co` para toda la plantilla,
porque es el DEFAULT de la columna y no existe ni pantalla ni endpoint para
cambiarlo. El backlog ya reservaba el hueco (`docs/dev/app-ausencias.md`).

Quien reporta directo a la cúspide se queda con una sola firma. La cascada no
sube más de dos escalones aunque el organigrama sea más profundo: son dos firmas,
no «todas las que haya por encima».

## El árbol

`portal.empleados.aprobador_correo` **no cambia de forma ni de nombre: cambia de
significado.** Pasa a ser «el correo de mi jefe inmediato», y el segundo
aprobador se **deriva subiendo un escalón**: es el `aprobador_correo` de la ficha
de mi jefe.

Cero columnas nuevas para el árbol. El organigrama existe **una sola vez** y no
puede desincronizarse consigo mismo. Se descartaron:

- **Una segunda columna plana** (`segundo_aprobador_correo` en `empleados`): no es
  un árbol, es una lista de parejas. Cambiar de jefe a una persona obligaría a
  reescribir a mano la segunda columna de todos los que cuelgan de ella, y nada
  en la base de datos detectaría que se han quedado mal.
- **Una tabla de cadena de aprobación** (`empleado_id, orden, correo`): N niveles
  configurables que hoy nadie necesita, y sigue sin saber quién depende de quién.

Los datos actuales ya son un árbol válido de un nivel, así que **nadie cambia de
aprobador el día del despliegue** (ver «Puesta en marcha»).

### Reglas de resolución

Viven en `apps/hub-api/src/ausencias/jerarquia.ts`, módulo puro con tests, misma
convención que `saldo.ts` y `calendario.ts`: la lógica con reglas no va en SQL,
porque en SQL no se puede probar — no hay Postgres en ningún test del repo.

```ts
aprobadoresDe(solicitante, jefe) -> { primero: string; segundo: string | null }
```

`primero` es **siempre y literalmente** `solicitante.aprobadorCorreo`, sin ninguna
condición. Es exactamente lo que hace hoy `service.crearSolicitud`, así que el
primer nivel no cambia de comportamiento en ningún caso — importa, porque ese
correo puede ser un buzón sin ficha de empleado y hoy funciona igual.

`segundo` es `jefe.aprobadorCorreo`, salvo que sea `null` por una de estas cuatro
razones:

1. **El jefe no tiene ficha activa en `empleados`.** Es el caso real de hoy: el
   buzón por defecto puede no estar dado de alta como empleado. También cubre al
   jefe que alguien desactivó — y entonces **no se salta al abuelo**: se corta.
2. **El jefe es su propio jefe** (es la raíz).
3. **El jefe del jefe coincide con el primero.**
4. **El jefe del jefe es el propio solicitante.** Sin esta regla, un ciclo de dos
   (A jefe de B y B jefe de A) haría que el segundo aprobador de A fuera A mismo:
   la cascada se convertiría en autoaprobación sin que nada fallara.

Todo se compara en minúsculas, como el resto del repo.

### Ciclos

`creariaCiclo(indice, empleado, nuevoJefe)` sube desde el nuevo jefe siguiendo el
índice. Dos invariantes con test:

- **Autoasignarse devuelve `false`.** Es como se declara la raíz, no un ciclo
  prohibido. Si el guard lo bloqueara, no habría forma de crear la raíz desde el
  panel.
- **El recorrido lleva un `Set` de visitados.** Con un ciclo preexistente ajeno al
  empleado que se está editando, un `while` ingenuo deja un handler de Express
  girando para siempre — no un error, un cuelgue.

Un ciclo que ya esté en la base de datos **no se bloquea**: bloquear la edición lo
haría imposible de arreglar desde la interfaz, que es justo lo contrario de lo que
hace falta. Se avisa en el panel y `aprobadoresDe` lo corta por la regla 4.

## La máquina de estados

Estado nuevo `pendiente_2`, evento nuevo del outbox `aprobacion_2`.

| Estado | Acción | → | Evento |
|---|---|---|---|
| `pendiente` | aprueba, hay segundo | `pendiente_2` | `aprobacion_2` |
| `pendiente` | aprueba, no hay segundo | `aprobada` | `aprobada` |
| `pendiente` | rechaza | `rechazada` | `rechazada` |
| `pendiente_2` | aprueba | `aprobada` | `aprobada` |
| `pendiente_2` | rechaza | `rechazada` | `rechazada` |
| cualquier otro | — | 409 `ya_decidida` | — |

El rechazo es terminal en los dos niveles. Las incapacidades no entran aquí: siguen
naciendo `registrada` y no se aprueban (`requiereAprobacion`).

**`pendiente_2` y no otro nombre** porque un `grep pendiente` sigue encontrando los
dos, y el riesgo número uno de esta feature es un consumidor de `estado` que nadie
revisa. Y porque **no contiene la subcadena `aprobada`**: cualquier filtro
descuidado por subcadena —o un CSV que alguien filtre en Excel por «aprobada»—
contaría media firma como firma entera, y en `saldo.ts` eso son días descontados
que no han ocurrido. Por eso quedan descartados `aprobada_1`, `preaprobada` y
`aprobada_parcial`.

**`aprobacion_2` y no reutilizar `aprobacion`** porque `notificaciones.ts` hace
`conDrive = evento === 'aprobacion' || evento === 'registrada'`: reutilizarlo
subiría el PDF a Drive por segunda vez. Con nombre propio, además, `CORREO_DE` es
un `Record<EventoOutbox, …>` exhaustivo y **no compila** hasta que se escribe el
correo del evento nuevo.

### Quién firma qué

`aprobador_correo` **no rota**. Se lee en `SELECT_SOLICITUD`, `adjuntoPorId`,
`avisoAprobador` y `puedeVerAdjunto`; rotarlo cambiaría el significado de una
columna que se lee en todas partes y **perdería al primer firmante** (con tokens
legacy las columnas `*_user_id` son NULL, así que la traza real son los correos).

Se añade a la solicitud `segundo_aprobador_correo` como **copia congelada en el
alta**, igual que ya se congela `aprobador_correo`: un cambio de organigrama a
mitad de trámite no mueve una solicitud en vuelo. La fuente de verdad sigue siendo
el árbol de `empleados`; esto es una foto.

El turno se deriva del estado, y `puedeDecidir` tiene tres ramas:

- en `pendiente`, **solo el primero**. Escribirlo como un `OR` de los dos campos
  —que es la forma más natural— dejaría al superior saltarse la primera firma, y
  la cascada dejaría de existir sin que nada fallara;
- en `pendiente_2`, solo el segundo;
- en estado terminal, cualquiera de los dos, para que el repo devuelva el 409 de
  «ya decidida», que describe mejor lo ocurrido que un 403.

El admin sigue destrabando en cualquier nivel y **avanza un escalón, no salta al
final**. Sale gratis: la transición solo mira el estado, no quién firma.

### Atomicidad

El UPDATE de `decidirSolicitud` lleva hoy `AND estado = 'pendiente'` literal; pasa
a `AND estado = $3` con el estado que el servicio ya leyó, como testigo de
concurrencia optimista.

**No** se hace en un solo statement con `WHERE estado IN ('pendiente','pendiente_2')`
y un `CASE` para el destino. Sería atómico, pero destruiría el 409: un doble clic
del jefe encadenaría `pendiente → pendiente_2 → aprobada` con una sola persona
firmando las dos veces. Es la regresión más peligrosa de todo el trabajo. El estado
destino se calcula en TypeScript; el SQL solo escribe si nadie se ha adelantado.

## Trazabilidad

`aprobador_user_id` y `decidida_at` **no cambian de significado**: siguen siendo la
decisión final, así que ninguna fila existente pasa a decir otra cosa. Se añaden
`primera_firma_user_id` y `primera_firma_at`.

Cuando hay una sola firma se rellenan las dos parejas con los mismos valores: «la
primera firma» es cierta también en ese caso, y así ninguna consulta de auditoría
necesita un `COALESCE`.

## Correos

Sin correo de avance intermedio. El empleado recibe el acuse al enviar y el
veredicto al final: dos correos, como hoy. Lo que pasa en medio lo ve en «Mis
solicitudes» y no le pide hacer nada.

- **`avisoAprobador` no cambia.** Sigue leyendo `s.aprobadorCorreo`, que sigue
  siendo el primer nivel. Hacerlo polimórfico según el turno lo ataría al estado de
  la fila en el momento de construir el payload: dependencia sutil y evitable.
- **`avisoSegundoAprobador`**, nuevo, lee `s.segundoAprobadorCorreo` directamente.
  Sin copia a administración: es un trámite interno, no un veredicto. Reutiliza
  `bloqueFechas`, `bloqueComentarios` y `bloqueAdjunto`, y añade la frase que lo
  distingue: «Esta solicitud ya cuenta con el visto bueno de su jefe inmediato.
  Falta tu aprobación para que quede en firme.» No nombra al primer firmante: los
  correos actuales no nombran a nadie, y hay un test que castiga cualquier
  `undefined` interpolado.
- **El acuse inicial** menciona las dos firmas solo si hay segundo.

`aprobacion_2` no lleva calendario, ni hoja, ni Drive. Google Calendar y la hoja
`consulta_vacaciones` solo se tocan al llegar a `aprobada`, como hasta ahora.

## Mantenimiento del organigrama

### El bug que hay que arreglar primero

`importarEmpleados` reescribe `aprobador_correo` en cada reimportación de la hoja
`consolidado`, porque el parser del navegador solo manda cuatro columnas y el
`COALESCE` rellena con el buzón por defecto **antes** del `ON CONFLICT`. Cualquier
organigrama que se cargue hoy se borra en la siguiente importación.

El arreglo es **quitar `aprobador_correo` del `DO UPDATE SET`**, no condicionarlo:
el `DO UPDATE` no ve el alias de la SELECT, solo `EXCLUDED`, y ahí el valor ya
viene con el `COALESCE` aplicado — es imposible distinguir «no vino la columna» de
«vino el buzón por defecto». En el INSERT (alta nueva) se sigue respetando.

### El panel

`PUT /api/ausencias/empleados/:id/jefe`, solo admin, calcado de
`PUT .../empleados/:id/saldo`. Validación manual (no hay zod): regex de correo; el
jefe tiene que ser una ficha activa **o** el `APROBADOR_POR_DEFECTO` de `config.ts`
—hay que dejarlo legal, es de quien cuelga todo el mundo hoy y puede no tener
ficha— → 400; ciclo → 409; empleado inexistente o inactivo → 404.

`GET /ausencias/empleados` pasa a devolver por fila `segundoAprobadorCorreo` y
`enCiclo`, **derivados en hub-api** con el módulo puro: la regla vive en un solo
sitio y el admin ve exactamente lo que se congelaría en una solicitud nueva.

En la pestaña «Empleados», un `PanelOrganigrama` aparte —no engordar
`ImportarEmpleados`, que ya tiene dos secciones— con el patrón de `PanelSaldos`:
desplegable de jefe y botón «Guardar» por fila, estado `guardando/error/exito` por
fila, y `role="status"` para el lector de pantalla. Una columna de solo lectura
«2ª firma» con el segundo derivado o «—», que es lo que hace comprensible el
desplegable: al cambiar el jefe de alguien se ve al instante a quién sube su
solicitud. Aviso ámbar arriba si hay ciclos.

**La hoja de Google no es la fuente de verdad del organigrama.** Se descartó añadir
una columna «Jefe» a `consolidado`: convertiría la hoja en autoridad justo cuando
el objetivo del proyecto es desenchufarla, y un correo mal tecleado ahí no se vería
hasta que alguien pidiera vacaciones.

## Lo que rompe en silencio

Cinco consumidores de `estado` que no dan error, dan un resultado equivocado:

- **`saldo.ts`** — `sumar` compara el estado exacto y `enTramite` solo suma
  `'pendiente'`. Un `pendiente_2` desaparecería del saldo: ni en trámite ni
  disfrutado. `sumar` pasa a aceptar una lista de estados.
- **`Calendario.tsx`** — dos comparaciones `=== 'pendiente'`, para la atenuación y
  para el `aria-label`. Media firma se pintaría sólida, **idéntica a una aprobada**.
- **`puedeVerAdjunto`** — solo mira al solicitante y a `aprobadorCorreo`. El segundo
  aprobador recibiría 404 al abrir el PDF que tiene que firmar, y como esa ruta
  devuelve 404 y no 403 a propósito, ni sabría por qué.
- **`empleadosConSaldo`** — acota por `aprobador_correo`, así que el segundo
  aprobador firmaría vacaciones sin ver el saldo, que es justo la tarjeta que se
  añadió a la bandeja para poder decidir. Se amplía a dos niveles: **decisión
  consciente de ensanchar la privacidad**, el superior pasa a ver el saldo de sus
  «nietos».
- **`esAprobadorDeAlguien`** — consulta el maestro. Si el jefe intermedio se
  desactiva mientras hay algo en `pendiente_2`, su superior deja de ser «aprobador
  de alguien», la pestaña desaparece y la solicitud queda muerta hasta que la saque
  un admin. Se le añade un `OR EXISTS` sobre las solicitudes vivas.

Dos `Record` exhaustivos trabajan a favor y **no compilan** hasta cubrir el caso
nuevo: `CORREO_DE` y `CHIP_ESTADO`. El `tsc` del build es el único que los ve —
Vitest transpila con esbuild y no comprueba tipos.

## Migración 018

Solo DDL e idempotente, como todas: se re-ejecutan en cada arranque y hay que
añadirla a mano al array `MIGRATIONS` de `db.ts`.

Tres columnas nuevas en `solicitudes_ausencia` (`segundo_aprobador_correo`,
`primera_firma_user_id`, `primera_firma_at`), un índice parcial para el segundo
nivel, y los dos `CHECK` cerrados —`estado` y `evento`— reemplazados.

Los CHECK de 015 se crearon inline, así que **su nombre lo puso Postgres**: se
localizan por la columna que restringen (`conkey`), no por un LIKE sobre
`pg_get_constraintdef`, que podría pillar otro CHECK de rebote. La guarda por el
nombre nuevo hace el bloque un no-op a partir del segundo arranque; sin ella cada
boot tomaría un ACCESS EXCLUSIVE y revalidaría la tabla entera.

**Los dos CHECK van en la misma migración.** Si el INSERT del outbox rebotara
contra el CHECK viejo del evento, reventaría dentro de la transacción de la firma
y el ROLLBACK desharía la primera firma entera: el jefe pulsaría «Aprobar», vería
un 500, y la solicitud seguiría `pendiente` para siempre.

**Sin backfill, a propósito.** Un UPDATE de datos en una migración que se
re-ejecuta en cada arranque se repetiría en cada despliegue y movería solicitudes
en vuelo cada vez que alguien tocara el organigrama. Las filas anteriores quedan
con `segundo_aprobador_correo IS NULL` → una sola firma, exactamente como nacieron.

## Puesta en marcha

**La feature se despliega apagada y se enciende sola.** Hoy toda la plantilla
cuelga de `comercial@ambientalia.com.co`, y ese buzón es su propio jefe por el
mismo DEFAULT → raíz → `segundo = null` para todo el mundo. No hay big bang: la
cascada se activa persona a persona según el admin rellena el organigrama.
Desplegar, verificar que nada cambió, y empezar por una sola persona de prueba.

**Orden: portal primero, luego hub-api.** Es el contrario al del calendario. Si
hub-api va primero, el bundle viejo del portal recibe `estado: 'pendiente_2'`,
`CHIP_ESTADO[...]` da `undefined` y **la tabla entera deja de renderizar** para
todo el que tenga algo en trámite. Al revés no pasa nada: los campos nuevos llegan
como `undefined` y degradan a un solo nivel; solo el botón «Guardar jefe» da 404
unos minutos, en una pestaña de admin. Se añade además un fallback en el lookup del
chip para que este razonamiento no vuelva a hacer falta.

**Antes de desplegar hay que mirar el workflow de n8n** «Ausencias — Portal»
(`dh0xjWCHsGj9raYH`). Reparte eventos con IFs sobre `calendario`/`hoja`/`drive` sin
mirar el nombre del evento, con lo que `aprobacion_2` debería fluir solo — pero si
tuviera un `Switch` con lista blanca, el correo del segundo nivel no saldría nunca
y las solicitudes se quedarían en `pendiente_2` sin que nadie se entere. Detectable
en `portal.ausencias_outbox` por `intentos` subiendo sin `enviado_at`.

La migración puede tumbar el portal entero: `initDb` no captura errores, así que si
el `DO $$` falla hub-api no levanta. Probarla contra `zoho-hub` desde la consola de
EasyPanel antes de subir.

## Interfaz

En la bandeja, dentro del contenedor de acciones, una línea que diga qué se está
firmando: «1ª de 2 firmas · después pasa a {segundo}» o «2ª firma · con esta queda
aprobada». Y el botón «Aprobar» pasa a decir **«Dar visto bueno»** cuando es la
primera de dos: que el jefe crea que ya la ha aprobado cuando solo la ha subido un
escalón es el malentendido más probable de esta feature.

`onDecidida` deja de filtrar siempre la fila de la bandeja. Si la decisión la deja
en `pendiente_2` y sigue correspondiéndole a quien mira —el caso del admin, que ve
la bandeja entera— hay que sustituirla, no quitarla.

## Pruebas

`jerarquia.test.ts`: cadena de tres; jefe sin ficha (el caso real de hoy); jefe con
ficha inactiva → no salta al abuelo; raíz; ciclo de dos → `segundo: null`;
mayúsculas; `creariaCiclo` devuelve `false` al autoasignarse; y `creariaCiclo` sobre
un grafo con un ciclo ajeno **termina** (con timeout, porque sin el `Set` el test
cuelga en vez de fallar).

En `router.test.ts` hay que ampliar el doble in-memory, que modela invariantes del
SQL: `decidirSolicitud` recibe el estado esperado y devuelve `null` si no casa;
`solicitudesPendientes` filtra por turno; `esAprobadorDeAlguien` modela la rama de
bandeja viva.

Mutantes que deben morir, en el estilo del `continue`/`break` del calendario:

- `WHERE estado = $3` → `IN (...)`: destruye el 409 y una persona firma dos veces.
- `sumar('pendiente')` sin el intermedio: el saldo miente justo cuando más se
  consulta.
- `aprobacion_2` colado en `conDrive`: duplica el PDF en Drive.
- Mandar todo a `pendiente_2` ignorando el `null`: atasca a media plantilla el día
  del despliegue.
- El `OR` de los dos correos en la rama `pendiente` de `puedeDecidir`: el segundo
  se salta la cola y la cascada deja de existir.

No hay tests en el frontend de esta app y no es el momento de montar la
infraestructura. La atenuación del calendario y el chip se verifican a mano tras
desplegar, y quedan anotados en `docs/dev/app-ausencias.md`, que es la convención
del repo para lo que no cubre un test.
