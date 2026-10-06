# Trazabilidad Mantenimientos Clientes

**Meta: que lleguen menos equipos de clientes sin avisar.** Para eso se avisa a cada cliente antes
de que se le venza la calibración de su GRIMM EDM 180 (objetivo: avisos automáticos a 90, 60 y 30 días).

⚠️ **Hoy el aviso automático es una SIMULACIÓN: nada en esta app ni en su API envía correos**
(ver «Aviso automático: simulación»). Los avisos se siguen copiando y enviando a mano.

App interna del portal para seguir los vencimientos de calibración de los **GRIMM EDM 180**
(180C y 180D) instalados en clientes y avisarles antes de que se les venza, para programar el
servicio de calibración y mantenimiento en vez de recibir el equipo sin previo aviso.

Fuente de datos: la hoja **F-ST-022 «Trazabilidad Mttos Clientes»** (Excel), que se importa
desde la propia app. El seguimiento (aviso enviado, «en Ambientalia», servicio programado, nota)
se registra en la app y sobrevive a las reimportaciones.

## Regla de negocio (la de la F-ST-022)

- Vigencia de calibración (días) = (Última calibración − HOY) + 365 → `vigenciaDias`.
- Vence = última calibración + 365 días.
- Estados (`apps/hub-api/src/trazabilidad/dominio.ts`): `FUERA_CICLO` (vigencia < −365, la hoja
  lo marca con Estado = 1), `VENCIDA` (−365…−1, llegada urgente posible), `VENCE_30` (0…30),
  `VENCE_60` (31…60), `VENCE_90` (61…90), `AL_DIA` (> 90), `SIN_FECHA`.
- «Hoy» es el día en Colombia (`hoyEnColombia`), calculado en el servidor.

## Dónde vive cada cosa

| Pieza | Ruta |
|---|---|
| Dominio puro (sin imports; lo usa servidor y UI) | `apps/hub-api/src/trazabilidad/dominio.ts` |
| Plazos en días hábiles y reloj con pausas, `calcularReloj` (sólo servidor: llama al calendario de Ausencias) | `apps/hub-api/src/trazabilidad/plazos.ts` |
| Cuándo se apuntan los cambios de estado: programador de 5 min + al leer «Servicios» (sólo servidor) | `apps/hub-api/src/trazabilidad/registro-estados.ts` |
| Validación de entrada (400 en español) | `apps/hub-api/src/trazabilidad/types.ts` |
| SQL | `apps/hub-api/src/trazabilidad/repo.ts` |
| HTTP (`requireAuth` + `requireApp('trazabilidad-mantenimientos')`) | `apps/hub-api/src/trazabilidad/router.ts` |
| Migraciones (esquema `portal`, idempotentes) | `apps/hub-api/src/users/migrations/042_trazabilidad_mantenimientos.sql`, `043_trazabilidad_plazos.sql`, `044_trazabilidad_servicios_tipo.sql`, `045_trazabilidad_tipo_combinado.sql`, `046_trazabilidad_estados_desk.sql`, `047_trazabilidad_estados_historial.sql`, `048_trazabilidad_contactos.sql` |
| UI (Vite + React, cargada en `/trazabilidad-mantenimientos/*`) | `apps/trazabilidad-mantenimientos/src/` |
| Lectura del Excel en el navegador | `src/lib/importar.ts` |
| Agregados, calendario y texto del aviso (`mensajeAviso`, también el de cada tramo) | `src/lib/vistas.ts` |
| Plan del aviso automático (`planAvisos`, `evaluarAviso`), contactos (`contactoDeTickets`, `contactoEfectivo`) y correos (`esEmail`, `esEmailInterno`, `DOMINIOS_INTERNOS`) | `apps/hub-api/src/trazabilidad/dominio.ts` (puro, compartido) |
| Asunto y cuerpo del correo simulado, resumen y revisión de los correos tecleados | `src/lib/simulacion.ts` |
| Sub-vista «Simulación automática» de «Avisos a clientes» | `src/vistas/SimulacionAvisos.tsx` (el selector Manual / Simulación está en `src/vistas/Avisos.tsx`) |
| Eje, barras (sus tramos, sus pausas y la marca de fin), colores, textos, filtros (`filtrarServicios`, `GRUPOS_PLAZO`), desplegable del tipo de «Servicios» y, de «Configuración», la nota del tipo compuesto y las opciones y textos del rol de cada estado | `src/lib/servicios.ts` |
| Pestañas «Servicios» (lista + calendario de barras) y «Configuración» (plazos y rol de cada estado de Desk) | `src/vistas/Servicios.tsx`, `src/vistas/Configuracion.tsx` |

Registro en el portal (los cinco puntos de siempre): `portal/src/lib/apps.ts`,
`portal/src/App.tsx`, `portal/src/pages/Aplicaciones.tsx`, `portal/tailwind.config.js` y el
`Dockerfile` raíz.

## Tablas

| Tabla | Contenido |
|---|---|
| `portal.tmc_equipos` | Un equipo por `clave` (el serial; si la hoja repite un serial, la 2.ª aparición lleva `-2`). `activo = false` cuando una importación ya no lo trae: no se borra |
| `portal.tmc_seguimiento` | Seguimiento por `clave`, sin FK a propósito (sobrevive a retiradas y vuelve con el equipo) |
| `portal.tmc_importaciones` | Registro de cada importación: archivo, recuentos y quién |
| `portal.tmc_plazos` | Plazo en días hábiles por tipo de servicio: `clave` (tipo normalizado), `etiqueta`, `dias_habiles` (NULL = sin plazo) y quién lo cambió. Semilla: Diagnóstico = 3, Calibración = 4; Mantenimiento, Garantía, Otro y No aplica sin plazo. La semilla es `ON CONFLICT DO NOTHING`: un arranque nunca pisa lo editado. La 045 añade, igual de idempotente, la fila del tipo compuesto `diagnostico + calibracion` («Diagnóstico + Calibración») con `dias_habiles` NULL: esa columna **no se lee** para un compuesto (ver «Tipo compuesto») |
| `portal.tmc_servicios_tipo` | Tipo de servicio puesto a mano, por `numero` de ticket de Desk (sin FK a `desk.*` ni a `tmc_plazos`): `clave` (la de `tmc_plazos`), `etiqueta` (la de ese tipo al elegirlo) y quién y cuándo (`actualizado_por_id`, `actualizado_por`, `actualizado_en`). Quitarlo borra la fila. La 044 sólo tiene `CREATE … IF NOT EXISTS`: un arranque no toca lo elegido |
| `portal.tmc_estados_desk` | El **rol** de cada estado de Desk en el reloj del plazo: `clave` (el estado normalizado, PK, sin FK a `desk.*`), `etiqueta` (como se escribía al elegirlo), `rol` (`VARCHAR(10) NOT NULL DEFAULT 'cuenta'`, con `CHECK` a `cuenta` / `standby` / `terminado`) y quién y cuándo (`actualizado_por_id`, `actualizado_por`, `actualizado_en`). Sólo hay fila para los estados que alguien ha tocado: los demás valen `cuenta` sin estar en la tabla. Volver a `cuenta` no borra la fila (queda quién lo hizo). La 046 sólo tiene `CREATE … IF NOT EXISTS`, **sin semilla**: nada nace marcado. ⚠️ La 046 se reescribió antes de desplegarse (antes tenía un booleano `standby`): una base donde hubiera corrido la versión vieja conserva la tabla vieja, porque `CREATE TABLE IF NOT EXISTS` no la cambia; ahí hay que borrarla a mano (`DROP TABLE portal.tmc_estados_desk`) y arrancar otra vez |
| `portal.tmc_estados_historial` | En qué estado ha estado cada ticket, por tramos: `id`, `numero` (ticket de Desk, sin FK), `clave` y `etiqueta` del estado tal como se vio (`TEXT`; la clave puede ser vacía), `desde`, `hasta` (NULL = tramo abierto) y `desde_real` (FALSE = primera observación: el comienzo real no se sabe). `CHECK (hasta IS NULL OR hasta >= desde)`; índice único parcial `(numero) WHERE hasta IS NULL` = como mucho un tramo abierto por ticket; índice `(numero, desde)`. Sólo la escribe `registrarEstados`. **No guarda el rol.** La 047 sólo tiene `CREATE … IF NOT EXISTS`: un arranque no toca el historial, que no se puede reconstruir |
| `portal.tmc_contactos` | El **contacto puesto a mano a un cliente** (a quién iría su aviso): `clave` (el nombre del cliente normalizado con `claveCliente`, PK, sin FK), `cliente` (como se escribió), `emails` (`TEXT[]`, entre 1 y 5 por `CHECK`, en minúsculas y sin repetir), `nombre` (persona de contacto, `''` si no se puso) y quién y cuándo (`actualizado_por_id`, `actualizado_por`, `actualizado_en`). Sólo hay fila para los clientes a los que alguien se lo ha puesto; quitarlo borra la fila. La 048 sólo tiene `CREATE … IF NOT EXISTS`, sin semilla. **Sólo guarda direcciones**: no hay tabla de mensajes, de envíos ni de pendientes en este módulo (`trazabilidad.db.test.ts` vigila la lista de tablas `tmc_*`) |

## API (`/api/trazabilidad/*`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/trazabilidad/equipos` (`?hoy=`) | `{hoy, equipos[], ultimaImportacion, contactos[]}`. Equipos activos con estado, seguimiento, `ticket` (el abierto en Zoho Desk, o `null`) y `contacto: {nombre, email, origen: 'desk' \| 'manual', ticket} \| null` (a quién iría su aviso). `contactos` son los puestos a mano a clientes: `{clave, cliente, nombre, emails[], internos[], actualizadoPor, actualizadoEn}` (`internos` = los de `emails` que son de un dominio propio) |
| PUT | `/trazabilidad/contactos` (`?hoy=`) | `{cliente, emails[], nombre?}`: pone a mano el contacto de un cliente y lo firma; `emails: []` lo quita (vuelve a valer el de Desk). Devuelve lo mismo que el GET de equipos, ya actualizado. 400 en `cliente` si no es un texto no vacío de 200 caracteres como mucho; 400 en `emails` si no es una lista o trae más de 5 correos distintos; 400 en `emails[i]` si ese correo no tiene forma de correo o pasa de 254 caracteres; 400 en `nombre` si no es texto o pasa de 200. Los correos se pasan a minúsculas y se quitan los repetidos. Un correo interno **sí** vale aquí (para probar con un buzón propio) y vuelve señalado en `internos`. **No envía nada** |
| POST | `/trazabilidad/importaciones` (`?simular=1`) | `{archivo, filas[]}` → altas / cambios / retiradas. Con `simular` no escribe |
| PUT | `/trazabilidad/seguimiento/:clave` | `{enAmbientalia, avisoEnviado, servicioProgramado, nota}` |
| POST | `/trazabilidad/avisos` | `{claves[], fecha}`: marca el aviso en bloque sin tocar el resto del seguimiento |
| GET | `/trazabilidad/servicios` (`?hoy=`) | `{hoy, servicios[], festivos[], tipos[]}`: tickets de Desk sin cerrar con ingreso, tipo efectivo (`tipoServicio`) y su origen (`tipoOrigen`: `manual` / `desk` / `null`, `tipoDesk`, `tipoManual: {clave, por, en}`), el reloj con pausas (`rolEstado`: `cuenta` / `standby` / `terminado`, el del estado de ahora; `enPausa`; `diasPausados`; `pausas: [{desde, hasta}]`; `terminadoEl`; `medidoDesde`; `fechaLimiteBase` = la fecha sin pausas), `plazoDias`, `fechaLimite` (ya corrida), `diasHabiles` y `estadoPlazo` (`EN_PLAZO` / `VENCE_HOY` / `VENCIDO` / `SIN_PLAZO` en marcha; `CUMPLIDO` / `INCUMPLIDO` / `TERMINADO` con el trabajo terminado), y `tramos` (`[{clave, etiqueta, dias, hasta}]`, sólo en un tipo compuesto con plazo; `null` en el resto): el día en que acaba cada parte, el último = `fechaLimite`; `festivos` son los del tramo del calendario de barras; `tipos` (`{clave, etiqueta, dias}`) son los que se pueden elegir a mano: las filas de `tmc_plazos` en el orden de Configuración, con `dias` ya resuelto (la suma, en un compuesto). Antes de leer apunta los cambios de estado (`registrarEstados`), si se puede: un fallo ahí no falla la petición |
| PUT | `/trazabilidad/servicios/:numero/tipo` (`?hoy=`) | `{tipo}`: pone a mano el tipo de servicio del ticket; `null` o vacío lo quita. 400 si `numero` no es un entero positivo o si el tipo no está (por clave normalizada) en `tmc_plazos`; 404 si el ticket no existe en `desk.tickets`. Devuelve lo mismo que el GET, ya recalculado |
| GET | `/trazabilidad/plazos` | `{plazos[]}`: las filas de `tmc_plazos` más los tipos que traigan los tickets abiertos y aún no tengan fila; `ticketsAbiertos` cuenta por tipo efectivo. Cada plazo lleva `derivadoDe`: `null` en un tipo simple y, en uno compuesto, sus partes `[{clave, etiqueta, dias}]` (entonces `dias` es su suma, o `null` si a alguna le falta) |
| PUT | `/trazabilidad/plazos` | `{tipo, dias}` (entero 1..365, o vacío = sin plazo). Devuelve `{plazos[]}` ya actualizado. 400 en `tipo` si es un tipo compuesto: su plazo se calcula, no se guarda |
| GET | `/trazabilidad/estados` | `{estados[]}`: todos los estados que existen en `desk.tickets` (de cualquier ticket, cerrados incluidos) más los ya guardados en `tmc_estados_desk` aunque ningún ticket los tenga. Cada uno: `{clave, etiqueta, tipoDesk, ticketsAbiertos, rol, actualizadoPor, actualizadoEn}`; `rol` es `cuenta` (mientras nadie lo cambie), `standby` o `terminado`; `tipoDesk` es el `status_type` de Desk (`Open` / `On Hold` / `Closed`, o `null`) y sólo orienta. Orden: tipo abierto, en espera, cerrado y sin tipo; dentro, más tickets abiertos primero y después alfabético |
| PUT | `/trazabilidad/estados` | `{estado, rol}`: elige el rol de un estado y lo firma. Devuelve `{estados[]}` ya actualizado. 400 en `estado` si no es un texto no vacío de 80 caracteres como mucho; 400 en `rol` si no es, tal cual, `cuenta`, `standby` o `terminado` (el `{estado, standby}` de antes ya no vale). Vale cualquier texto de estado: se puede elegir el rol de uno antes de que un ticket lo use. No toca el historial: el cambio vale hacia atrás desde la lectura siguiente |

Permisos: cualquiera con la app asignada lee, importa, registra seguimiento, cambia plazos, pone
a mano el tipo de servicio de un ticket, elige el rol de cada estado de Desk y pone a mano el
contacto de un cliente; todo queda firmado con su correo. El historial de estados no lo escribe
nadie a mano: lo apunta hub-api.

## Contactos: a quién iría el aviso

Cada equipo lleva `contacto` (o `null`). Sale de dos sitios, y **el puesto a mano gana**:

1. **De Zoho Desk** (`contactosDeDesk` en `repo.ts` + `contactoDeTickets` en `dominio.ts`): el
   ticket de `number` más alto —abierto **o cerrado**— con el mismo serial (sin mayúsculas ni
   espacios, como el cruce del ticket abierto) cuyo correo no esté vacío, tenga forma de correo
   (`esEmail`) y **no sea interno**. Si el más reciente no vale, se retrocede al anterior. El
   correo es `raw->>'email'` y, si falta, `raw->'contact'->>'email'`; el nombre, `firstName` +
   `lastName` de `raw->'contact'` (puede quedar vacío). El SQL sólo trae los candidatos; qué
   correo vale se decide en JS, con la misma regla que usa la app.
2. **A mano, por cliente** (`portal.tmc_contactos`, `PUT /trazabilidad/contactos`): vale para
   **todos** los equipos del cliente. Casa por `claveCliente` (la misma normalización que
   `claveTipoServicio`: sin mayúsculas, tildes ni espacios repetidos), en JS. Existe porque el
   contacto de Desk es quien abrió el último ticket, que puede no ser quien decide. En el
   `contacto` del equipo va el primer correo; la lista entera va en `contactos` del GET.

**Dominios internos** (`DOMINIOS_INTERNOS` en `dominio.ts`, único sitio; hoy `ambientalia.com.co`,
sin distinguir mayúsculas y contando sus subdominios): los tickets viejos llevan como contacto a
gente de la casa, y un correo así **nunca** se usa como destinatario si viene de Desk (lo filtra
el servidor y otra vez el plan). Puesto a mano sí se admite —para probar con un buzón propio— y
se señala como «interno» en la respuesta y en la UI.

La ficha del equipo (`FichaEquipo.tsx`) enseña su contacto en sólo lectura (nombre, correo, origen
y ticket); se cambia en «Avisos a clientes» → «Simulación automática».

## Aviso automático: simulación

**Estado: ensayo en seco (dry run).** El negocio está en fase de pruebas y ha decidido que **no
puede salir ningún correo a un cliente**. Por eso en este módulo **no hay ningún camino de código
que envíe**: ni llamada a un servicio de correo ni a un automatizador externo, ni tabla de
mensajes pendientes, ni programador de envíos, ni botón de enviar. Todo lo de abajo sólo
**calcula y enseña** lo que se enviaría. `router.test.ts` y `plazos.test.ts` tienen candados que
fallan si aparece algo así en `router.ts`, `repo.ts`, `dominio.ts`, `types.ts` o en la 048. Pasar
a enviar de verdad es otra tarea, con su decisión de negocio; no es «activar» nada de aquí.

La regla (`evaluarAviso` y `planAvisos`, `dominio.ts`; puras, con `hoy` como argumento):

- **Tramos 90, 60 y 30**: el tramo de un equipo es el de su estado de hoy (`VENCE_90` → 90,
  `VENCE_60` → 60, `VENCE_30` → 30). `AL_DIA` y `SIN_FECHA` no están en ninguno (`SIN_TRAMO`).
- **Una vez por tramo**: se entra en un tramo el día `vence − tramo` (`entradaTramo`). Si el
  «aviso enviado» del seguimiento (`tmc_seguimiento.aviso_enviado`, el mismo de la vista manual)
  es de ese día o posterior, ya está avisado en este tramo (`YA_AVISADO`); si es anterior —fue el
  del tramo de antes— o no hay, **toca** (`DEBIDO`). No hay registro propio de avisos todavía.
- **Nunca en servicio** (`enServicio`: «en Ambientalia» a mano o ticket abierto en Desk) →
  `EN_SERVICIO`, que manda sobre «ya avisado».
- **`VENCIDA` y `FUERA_CICLO` quedan fuera de la regla automática** (motivos `VENCIDA` y
  `FUERA_CICLO`): no generan correo simulado. Se enseñan aparte para que se vea a quién deja
  fuera: «Vencidas sin aviso» = vencidas hasta un año, fuera de servicio y sin «aviso enviado»
  del día del vencimiento o posterior; «Fuera de ciclo» = todas las de más de un año.
- **Un correo por cliente y tramo** (agrupa por `claveCliente`), con los equipos de ese cliente a
  los que toca. **Destinatarios**: los correos puestos a mano al cliente si los tiene; si no, los
  correos distintos de los contactos de Desk de esos equipos. Sin ninguno → «sin destinatario».
- **Texto** (`correoAviso` en `src/lib/simulacion.ts`, sobre `mensajeAviso`): el cuerpo del aviso
  manual con la frase de entrada del tramo (90 = primer aviso «con antelación», 60 =
  recordatorio, 30 = «último aviso») y un asunto por tramo. Saluda por su nombre si entre los
  destinatarios hay exactamente uno con nombre; si no, el «Estimado cliente …» de siempre. (En el
  contacto puesto a mano, el nombre va con el primer correo.)

En la UI, «Avisos a clientes» tiene dos vistas: **«Manual»** (la de siempre: redactar, copiar,
marcar como avisado; intacta) y **«Simulación automática»**: un aviso fijo de que es una
simulación, el resumen (correos, clientes, equipos, grupos sin destinatario), una tarjeta por
correo (cliente, tramo, destinatarios con su origen y la marca «interno», equipos, asunto y texto
plegados con «Copiar texto», y «Cambiar destinatario»), los grupos «Sin destinatario» con el
editor del contacto abierto, y cuatro secciones plegadas que explican lo que queda fuera («Ya
avisados en este tramo», «En servicio», «Vencidas sin aviso», «Fuera de ciclo»).

## Cruce con Zoho Desk (ticket abierto)

`listarEquipos` (`repo.ts`) cruza cada equipo con la réplica `desk.tickets` —la escribe el worker
de zoho-hub; hub-api sólo la lee y no tiene migración para ella— y devuelve
`ticket: { numero, estado, sinConfirmar } | null`.

- Abierto = `status_type` distinto de `'Closed'` y con serial. Cruce por serial sin mayúsculas ni
  espacios; con varios abiertos gana el de `number` más alto.
- **«Sin confirmar»**: si `synced_at` tiene más de un día (o es NULL) el ticket no se oculta, se
  marca `sinConfirmar` (el worker a veces deja de refrescar tickets viejos y puede estar ya cerrado).
- `enServicio(e)` (`dominio.ts`; `src/lib/vistas.ts` la reexporta) = «en Ambientalia» a mano **o** con ticket abierto:
  esos equipos no entran en los avisos a clientes y sí en el filtro e indicador «En Ambientalia».
  El campo manual no se toca.
- `modelo` y `marca` de la réplica vienen vacíos: no usarlos. `tipo_servicio` también viene vacío
  hoy, pero «Servicios» ya lo lee y deja ponerlo a mano (ver abajo).
- En `test:db` la tabla la crea `asegurarDeskTickets` (`src/test-db/harness.ts`), sólo con las
  columnas que hub-api lee.

## Servicios: plazo de los tickets abiertos

Pestaña «Servicios» = **todos** los tickets de `desk.tickets` con `status_type` distinto de
`'Closed'` (cualquier marca, con o sin serial: va de tickets, no de equipos), en lista y en
calendario de barras. Pestaña «Configuración» = el plazo de cada tipo de servicio y, debajo, el
rol de cada estado de Desk en el reloj (ver «Reloj del plazo»). Lo que sigue es la regla base;
el tiempo en standby se descuenta y el trabajo terminado para el reloj, y eso va en esa sección.

- **Fecha límite = ingreso + N días hábiles**, con N el plazo del tipo de servicio del ticket. Es
  alternativo por tipo, no acumulado (salvo el tipo compuesto, abajo). El día de ingreso no cuenta
  (lunes + 3 → jueves). Sin tipo, o con un tipo sin plazo → `SIN_PLAZO`: sale en la lista, sin barra.
- **Tipo compuesto «Diagnóstico + Calibración»** (clave `diagnostico + calibracion`): un tipo más
  del desplegable, cuyo plazo es la **suma en vivo** de los de Diagnóstico y Calibración (3 + 4 = 7
  por defecto). Es derivado, nunca se guarda: cambiar Diagnóstico a 5 lo deja en 9 sin tocar nada
  más, y si a una parte le falta el plazo queda «sin plazo».
  - La composición se define en **un solo sitio**: `TIPOS_COMPUESTOS` en `dominio.ts` (clave del
    compuesto → claves de sus partes, ya normalizadas; una parte no puede ser otro compuesto). No
    hay columna para esto.
  - Se resuelve en `diasDeTipo` (`dominio.ts`), y en el servidor siempre a través de
    `resolverPlazos` (`repo.ts`), que usan `listarServicios`, `listarTiposServicio` y
    `listarPlazos`: lista, fecha límite, contadores, `ticketsAbiertos` y el desplegable salen del
    mismo número. Para añadir otro compuesto: una entrada en `TIPOS_COMPUESTOS` y una migración
    que siembre su fila (`dias_habiles` NULL).
  - La fila de `tmc_plazos` (migración 045) existe sólo para que el tipo se pueda elegir y salga
    en Configuración; su `dias_habiles` se ignora aunque alguien lo escriba por SQL.
  - `PUT /trazabilidad/plazos` sobre él → 400 (`parsePlazo`, y otra vez en `guardarPlazo`). En
    Configuración su fila es de sólo lectura: los días calculados y «suma de Diagnóstico (3) y
    Calibración (4)», o «sin plazo» y a qué parte le falta (`notaDerivado`).
  - **Barra en dos tramos**: el servidor manda `tramos` (`calcularTramos` en `plazos.ts`, con el
    mismo contador de días hábiles) y `segmentosBarra` (`src/lib/servicios.ts`) los pasa a
    columnas: Diagnóstico del ingreso a su fin, Calibración del día siguiente a la fecha límite;
    el segundo va aclarado y con una raya blanca delante, y cada uno dice en su `title` cuándo
    acaba. El color (en plazo / vence hoy / vencido) y el tramo rayado de atraso los sigue
    mandando la fecha límite **final**. En la lista, la fecha intermedia va en el `title` de la
    fecha límite (subrayado punteado), sin columna nueva.
- **Tipo efectivo: el puesto a mano GANA al de Desk** (`tipoEfectivo` en `dominio.ts`, aplicado en
  `listarServicios` de `repo.ts`). Si el ticket tiene fila en `portal.tmc_servicios_tipo`, ese es su
  tipo y con él se busca el plazo; si no, vale `desk.tickets.tipo_servicio`; sin ninguno, «sin tipo».
  Quitar el puesto a mano (borra la fila) vuelve al de Desk. El puesto a mano sólo puede ser un tipo
  con fila en `tmc_plazos` (tenga plazo o no: sin plazo sale `SIN_PLAZO`) y se enseña con la
  etiqueta que esa fila tenga hoy. Se elige en la columna «Tipo de servicio» de la lista
  (desplegable por fila; primera opción «Sin tipo» o «Según Desk: …» = nada puesto a mano); guarda al
  cambiar y el `PUT` devuelve todos los servicios recalculados, que sustituyen a los que había.
- **Ingreso** = `fecha_creacion_ticket` o, si falta, el día en Colombia de `created_time`.
- **El tipo casa por `claveTipoServicio`** (`dominio.ts`): sin mayúsculas, tildes ni espacios de
  más. Se casa en JS, no en SQL (sin `unaccent`).
- **Días hábiles** = lunes a viernes sin festivos de Colombia. `plazos.ts` no repite la regla: llama
  a `contarDiasHabiles` y `festivosColombia` de `apps/hub-api/src/ausencias/`. Todo se calcula en el
  servidor (`fechaLimite`, `diasHabiles` —negativo = atraso— y `estadoPlazo`: `EN_PLAZO`,
  `VENCE_HOY`, `VENCIDO`, `SIN_PLAZO`, más `CUMPLIDO` / `INCUMPLIDO` / `TERMINADO` con el trabajo
  terminado); la UI sólo coloca columnas. El estado compara fechas de
  calendario: un sábado tras un límite en viernes ya es `VENCIDO` con 0 días hábiles de atraso.
- **Calendario de barras** (`src/lib/servicios.ts`): una columna por día; barra del ingreso a la
  fecha límite (verde / ámbar si vence hoy / rojo) y, si está vencido, tramo rayado hasta hoy. El
  eje no retrocede más de `RETROCESO_MAX_DIAS` (60) desde hoy; lo anterior se recorta con «‹‹».
- **Modelo** = tercer tramo de `codigo_servicio`. **Cliente** (`clienteDeServicio`, `repo.ts`), por
  este orden, con su origen en `clienteOrigen`:
  1. `equipo` — el cliente del equipo de `portal.tmc_equipos` con el mismo serial (sin mayúsculas
     ni espacios; con varios, el activo y, si no hay ninguno activo, uno retirado): es el nombre
     de la F-ST-022;
  2. `cuenta` — `raw->'contact'->'account'->>'accountName'` (en producción `account` llega casi
     siempre `null`);
  3. `contacto` — nombre y apellido de `raw->'contact'`;
  4. `asunto` — el asunto sin el código de servicio (`clienteDeAsunto = true`, en cursiva gris:
     no es un nombre fiable).

  `clienteDeAsunto` sólo es `true` en el caso 4. El `title` de la celda dice de dónde sale.
- **Depende del worker de zoho-hub**: hoy `tipo_servicio` y `fecha_creacion_ticket` llegan NULL en
  todas las filas (el worker no trae los campos personalizados de Zoho), así que un servicio sale
  «sin tipo» y sin barra hasta que alguien le pone el tipo a mano; un aviso azul lo explica y se
  va cuando todos tienen tipo. No hay que tocar nada aquí cuando el worker los traiga: los que no
  tengan tipo a mano cogen el de Desk solos, y los que sí lo tengan lo conservan.
- Ninguna migración de hub-api crea ni altera nada en el esquema `desk`.

## Reloj del plazo: standby lo pausa, «trabajo terminado» lo para

El plazo de un ticket ya no corre siempre. Cada **estado de Desk** (`desk.tickets.status`) tiene
un **rol** en el reloj, y sólo uno. Se elige por estado, no por ticket, en el bloque «Estados de
Desk» de «Configuración» (un desplegable por estado, que guarda al momento y queda firmado con
id, correo y fecha):

| Rol (`tmc_estados_desk.rol`) | Qué le hace al reloj |
|---|---|
| `cuenta` — «Cuenta» | El tiempo corre. Es el de partida: un estado sin fila vale `cuenta` |
| `standby` — «Standby» | **Pausa**: el ticket depende de una decisión del cliente o de un servicio externo. Los días hábiles que pasa así no cuentan y la fecha límite se corre |
| `terminado` — «Trabajo terminado» | **Para**: el trabajo técnico está hecho («Por Facturar», «Por Entregar»). El ticket se juzga por el día en que llegó a ese estado |

- **Nada viene marcado.** El `status_type` de Desk (`Open` / `On Hold` / `Closed`, que el bloque
  enseña como «Abierto» / «En espera» / «Cerrado») sólo orienta: «Por Facturar» es «En espera» en
  Desk y no es una espera del cliente.
- **El estado casa por `claveEstadoDesk`** (`dominio.ts`): la misma normalización que
  `claveTipoServicio` (sin mayúsculas, tildes ni espacios repetidos o sobrantes), así que
  «Notificación  Comercial» (con dos espacios, como llega de Desk) y «Notificación Comercial» son
  el mismo estado. Se casa en JS, no en SQL. La etiqueta que se enseña es la grafía más usada en
  los tickets, sin espacios de más (`etiquetaEstadoDesk`); si ningún ticket tiene ya ese estado,
  la guardada.
- Los roles y sus etiquetas viven en `dominio.ts` (`ROLES_ESTADO`, `ETIQUETA_ROL`,
  `rolPausaReloj`); el `CHECK` de la migración 046 lleva los mismos tres valores y
  `plazos.test.ts` vigila que coincidan.

### El historial: el portal mide el tiempo él mismo

La réplica `desk.tickets` sólo trae el estado **de ahora**, así que hub-api apunta los cambios
que ve en `portal.tmc_estados_historial` (migración 047): una fila = un tramo, «el ticket
`numero` estuvo en el estado `clave` de `desde` a `hasta`» (`hasta` NULL = sigue ahí).

- **`registrarEstados(db)`** (`repo.ts`) es lo único que escribe ahí. Lee el estado de cada
  ticket sin cerrar y los tramos abiertos, y: ticket sin tramo abierto → abre uno; ticket cuyo
  estado (por clave normalizada) ya no es el de su tramo → lo cierra y abre otro **en el mismo
  instante**; ticket cerrado en Desk o desaparecido de la réplica → cierra su tramo y no abre
  otro. Otra grafía del mismo estado **no** es un cambio. Sin cambios no escribe nada.
- **`desde_real`**: `TRUE` si `desde` es un cambio de estado que el portal vio; `FALSE` si es la
  primera vez que vio el ticket, que ya estaba así (entonces `desde` es ese primer instante y el
  comienzo real no se sabe). Un ticket que se cierra y se reabre vuelve a empezar con `FALSE`.
- **Como mucho un tramo abierto por ticket**: índice único parcial
  `tmc_estados_historial_abierto_uq (numero) WHERE hasta IS NULL`. Con llamadas a la vez es
  seguro por partida doble: toda la pasada va en una transacción que primero se pone en fila
  (`pg_advisory_xact_lock`), y las escrituras no pisan aunque no lo hiciera (sólo se cierra un
  tramo que siga abierto; el alta es `ON CONFLICT … DO NOTHING` sobre ese índice). El instante
  se toma con `clock_timestamp()` ya con el bloqueo, y el mismo valor cierra y abre.
- **Cuándo se llama** (`registro-estados.ts`, sólo servidor), por dos caminos y una sola puerta:
  1. un **programador** dentro de hub-api, cada 5 minutos (`INTERVALO_MS`), con la primera pasada
     20 s después de arrancar (`PRIMERA_PASADA_MS`). Lo enciende `index.ts` tras `initDb()`
     (`iniciarRegistroEstados`) y nadie más: importar el módulo no arranca nada, así que en los
     tests no hay temporizadores. Un fallo se apunta (`console.error` + `captureError`) y la
     pasada siguiente sale igual;
  2. **`GET /trazabilidad/servicios`**, antes de leer, «si se puede» (`registrarEstadosSinFallar`):
     si falla, la petición responde igual con lo que haya.

  No hacen el trabajo dos veces: en un proceso hay **una sola pasada a la vez** (quien llega
  durante una se cuelga de ella) y una petición no repite una pasada buena de hace menos de 30 s
  (`FRESCURA_MS`); el programador sí pasa siempre, que para eso tiene su turno.
- **El rol NO se copia al historial.** Los tramos guardan el estado; el rol se mira **al leer**,
  con lo que diga `tmc_estados_desk` en ese momento. Cambiar el rol de un estado reevalúa
  también los días ya pasados (para bien y para mal: marcar hoy «En Proceso» como standby pausa
  todo el tiempo que cada ticket lleva apuntado en «En Proceso»).
- ⚠️ **Lo que no se puede saber**: lo anterior al primer tramo de un ticket. Los tickets que ya
  estaban abiertos cuando esto se desplegó no tienen pasado: ese tiempo **cuenta como activo**,
  estuvieran como estuvieran. `medidoDesde` (el día del primer tramo) va en cada servicio para
  que la UI lo diga. Tampoco se ve lo que pase entre dos pasadas (un estado que dura menos de
  5 minutos puede no quedar apuntado), ni lo que ocurra con hub-api caído: al volver, el tramo
  abierto se cierra en el momento en que se ve el estado nuevo, no cuando cambió de verdad. Y
  todo va con el retraso del worker de zoho-hub: se apunta cuándo lo vio el portal, no cuándo
  cambió en Desk.

### La regla, por días (`calcularReloj`, `plazos.ts`)

Pura y de servidor: recibe `hoy`, el rol del estado de ahora, los tramos y el rol de cada estado;
no mira el reloj ni la base. Todo va por **días de calendario de Bogotá** y sólo cuentan los
**hábiles**.

- **Día en pausa**: un día hábil D, posterior al ingreso y no posterior a hoy, está en pausa si
  **al acabar el día en Bogotá** (23:59:59,999) el ticket estaba en un tramo cuyo estado tiene
  hoy rol `standby` **o `terminado`**. El día de **hoy**, que no ha acabado, lo decide el estado
  de ahora. Consecuencias: una pausa que empieza y acaba el mismo día no pausa nada; el día en
  que entra en standby ya no cuenta y el día en que sale sí.
- **Fecha límite** = el día en que cae el N-ésimo día hábil **activo** después del ingreso: se
  avanza saltando fines de semana, festivos y días en pausa. Los días que aún no han llegado se
  dan por activos (es una proyección): mientras el ticket siga en standby, la fecha se corre un
  día hábil por cada día hábil que pasa. Que esté en pausa **no** es un estado del plazo: va en
  `enPausa`, y `estadoPlazo` sigue siendo `EN_PLAZO` / `VENCE_HOY` / `VENCIDO` contra la fecha ya
  corrida. `fechaLimiteBase` es la que tendría sin pausas.
- **`diasHabiles`**: lo que queda son los días hábiles de hoy a la fecha límite (todos futuros,
  todos activos). El **atraso** tampoco cuenta los días en pausa posteriores al límite.
- **Tipo compuesto**: los tramos siguen el mismo paso, así que la fecha intermedia también se corre.
- **`pausas`**: los días en pausa en rangos `{desde, hasta}` (ambos incluidos), para pintarlos.
  Empiezan y acaban en un día en pausa; dos días en pausa van en el mismo rango si entre ellos no
  hay ningún día hábil activo (un fin de semana no parte el rango). `diasPausados` cuenta sólo
  los hábiles.
- **Trabajo terminado**: si el estado **de ahora** tiene rol `terminado`, el reloj se para en
  `terminadoEl` = el día de Bogotá del `desde` del **primer tramo de la racha** de estados
  `terminado` en la que el ticket sigue (hacia atrás desde el tramo abierto, mientras el anterior
  también sea `terminado` y acabe donde empieza el siguiente: «Por Facturar» → «Por Entregar» es
  una sola racha). La fecha límite se calcula **a ese día** (con las pausas anteriores; ese día y
  los siguientes cuentan como activos) y ya no se mueve. `estadoPlazo` pasa a ser el veredicto
  (`veredictoTerminado`, `dominio.ts`): **`CUMPLIDO`** si `terminadoEl` ≤ fecha límite,
  **`INCUMPLIDO`** si no, y **`TERMINADO`** si la racha empieza en una primera observación
  (`desde_real` FALSE) o el historial aún no tiene el tramo: se sabe que está terminado, no desde
  cuándo. `diasHabiles` es el margen o el atraso con que llegó, congelado.
- **Si sale de «terminado»** a un estado que cuenta, el reloj sigue: `terminadoEl` vuelve a null
  y los días que acabó en «terminado» quedan **en pausa**, igual que los de standby (no se le
  carga el tiempo en que el trabajo se dio por hecho).
- **Sin tipo o sin plazo** → `SIN_PLAZO`, como siempre, pero con su rol, sus pausas, `terminadoEl`
  y `medidoDesde`.

### En «Servicios»

- **Lista**: etiqueta gris «standby» junto al estado (su `title`: cuántos días hábiles lleva en
  pausa y desde cuándo se mide) o «terminado» (cuándo se paró y con qué veredicto). El plazo dice
  «en pausa · quedan N d háb.» mientras está en standby, y «cumplido» (verde) / «incumplido · N d
  háb.» (rojo) / «terminado» (neutro) con el trabajo terminado. Con días en pausa, la fecha
  límite es la corrida y su `title` da la de sin pausas y cuántos días son (`tituloFechaLimite`);
  sin columna nueva.
- **Filtros** (`GRUPOS_PLAZO`): Vencido, Vence hoy, En plazo, Sin plazo y uno solo, «Terminado N»,
  que cubre `CUMPLIDO`, `INCUMPLIDO` y `TERMINADO` (el desglose, en su `title`). «Standby N» sigue
  aparte y se suma a los del plazo. Por urgencia, los terminados van detrás de los que siguen en
  marcha (`porUrgenciaPlazo`).
- **Calendario de barras**: la barra acaba en la fecha límite corrida; los días en pausa van
  encima como una banda rayada gris (`pausasBarra`), distinta del rayado rojo del atraso. Con el
  trabajo terminado la barra acaba en `terminadoEl` con una marca oscura, en un tono más claro
  (verde / rojo / neutro según el veredicto) y sin tramo de atraso detrás. La leyenda sólo
  enseña lo que hay pintado (`leyendaServicios`).

## Pruebas

- `npm test --workspace=apps/trazabilidad-mantenimientos` — lector del Excel, agregados, aviso,
  geometría del calendario de barras (pausas y marca de fin incluidas) y la simulación (texto por
  tramo, saludo, resumen y correos tecleados: `src/lib/simulacion.test.ts`).
- `npm test --workspace=apps/hub-api` — dominio, el plan del aviso y los contactos
  (`avisos.test.ts`), plazos (el reloj con pausas, con `hoy` y los tramos como argumentos), router
  y el programador con reloj de mentira (`src/trazabilidad/*.test.ts`).
- `npm run test:db` en hub-api — `trazabilidad.db.test.ts` contra Postgres real: `registrarEstados`
  (también con llamadas a la vez), «Servicios» de punta a punta con un historial sembrado y `hoy`
  fijo, el contacto de cada equipo (Desk y puesto a mano) y el orden del cliente en «Servicios».
- Datos de prueba siempre ficticios (el repo es público): «Cliente Uno», seriales `18A00001`,
  correos en `@example.com` / `@cliente-uno.example`.
