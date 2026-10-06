# Trazabilidad Mantenimientos Clientes

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
| Plazos en días hábiles (sólo servidor: llama al calendario de Ausencias) | `apps/hub-api/src/trazabilidad/plazos.ts` |
| Validación de entrada (400 en español) | `apps/hub-api/src/trazabilidad/types.ts` |
| SQL | `apps/hub-api/src/trazabilidad/repo.ts` |
| HTTP (`requireAuth` + `requireApp('trazabilidad-mantenimientos')`) | `apps/hub-api/src/trazabilidad/router.ts` |
| Migraciones (esquema `portal`, idempotentes) | `apps/hub-api/src/users/migrations/042_trazabilidad_mantenimientos.sql`, `043_trazabilidad_plazos.sql`, `044_trazabilidad_servicios_tipo.sql`, `045_trazabilidad_tipo_combinado.sql` |
| UI (Vite + React, cargada en `/trazabilidad-mantenimientos/*`) | `apps/trazabilidad-mantenimientos/src/` |
| Lectura del Excel en el navegador | `src/lib/importar.ts` |
| Agregados, calendario y texto del aviso | `src/lib/vistas.ts` |
| Eje, barras (y sus tramos), colores, textos, desplegable del tipo de «Servicios» y nota del tipo compuesto en «Configuración» | `src/lib/servicios.ts` |
| Pestañas «Servicios» (lista + calendario de barras) y «Configuración» (plazos) | `src/vistas/Servicios.tsx`, `src/vistas/Configuracion.tsx` |

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

## API (`/api/trazabilidad/*`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/trazabilidad/equipos` (`?hoy=`) | Equipos activos con estado, seguimiento y `ticket` (el abierto en Zoho Desk, o `null`) + última importación |
| POST | `/trazabilidad/importaciones` (`?simular=1`) | `{archivo, filas[]}` → altas / cambios / retiradas. Con `simular` no escribe |
| PUT | `/trazabilidad/seguimiento/:clave` | `{enAmbientalia, avisoEnviado, servicioProgramado, nota}` |
| POST | `/trazabilidad/avisos` | `{claves[], fecha}`: marca el aviso en bloque sin tocar el resto del seguimiento |
| GET | `/trazabilidad/servicios` (`?hoy=`) | `{hoy, servicios[], festivos[], tipos[]}`: tickets de Desk sin cerrar con ingreso, tipo efectivo (`tipoServicio`) y su origen (`tipoOrigen`: `manual` / `desk` / `null`, `tipoDesk`, `tipoManual: {clave, por, en}`), fecha límite, días hábiles y estado del plazo, y `tramos` (`[{clave, etiqueta, dias, hasta}]`, sólo en un tipo compuesto con plazo; `null` en el resto): el día en que acaba cada parte, el último = `fechaLimite`; `festivos` son los del tramo del calendario de barras; `tipos` (`{clave, etiqueta, dias}`) son los que se pueden elegir a mano: las filas de `tmc_plazos` en el orden de Configuración, con `dias` ya resuelto (la suma, en un compuesto) |
| PUT | `/trazabilidad/servicios/:numero/tipo` (`?hoy=`) | `{tipo}`: pone a mano el tipo de servicio del ticket; `null` o vacío lo quita. 400 si `numero` no es un entero positivo o si el tipo no está (por clave normalizada) en `tmc_plazos`; 404 si el ticket no existe en `desk.tickets`. Devuelve lo mismo que el GET, ya recalculado |
| GET | `/trazabilidad/plazos` | `{plazos[]}`: las filas de `tmc_plazos` más los tipos que traigan los tickets abiertos y aún no tengan fila; `ticketsAbiertos` cuenta por tipo efectivo. Cada plazo lleva `derivadoDe`: `null` en un tipo simple y, en uno compuesto, sus partes `[{clave, etiqueta, dias}]` (entonces `dias` es su suma, o `null` si a alguna le falta) |
| PUT | `/trazabilidad/plazos` | `{tipo, dias}` (entero 1..365, o vacío = sin plazo). Devuelve `{plazos[]}` ya actualizado. 400 en `tipo` si es un tipo compuesto: su plazo se calcula, no se guarda |

Permisos: cualquiera con la app asignada lee, importa, registra seguimiento, cambia plazos y pone
a mano el tipo de servicio de un ticket; todo queda firmado con su correo.

## Cruce con Zoho Desk (ticket abierto)

`listarEquipos` (`repo.ts`) cruza cada equipo con la réplica `desk.tickets` —la escribe el worker
de zoho-hub; hub-api sólo la lee y no tiene migración para ella— y devuelve
`ticket: { numero, estado, sinConfirmar } | null`.

- Abierto = `status_type` distinto de `'Closed'` y con serial. Cruce por serial sin mayúsculas ni
  espacios; con varios abiertos gana el de `number` más alto.
- **«Sin confirmar»**: si `synced_at` tiene más de un día (o es NULL) el ticket no se oculta, se
  marca `sinConfirmar` (el worker a veces deja de refrescar tickets viejos y puede estar ya cerrado).
- En la UI, `enServicio(e)` (`src/lib/vistas.ts`) = «en Ambientalia» a mano **o** con ticket abierto:
  esos equipos no entran en los avisos a clientes y sí en el filtro e indicador «En Ambientalia».
  El campo manual no se toca.
- `modelo` y `marca` de la réplica vienen vacíos: no usarlos. `tipo_servicio` también viene vacío
  hoy, pero «Servicios» ya lo lee y deja ponerlo a mano (ver abajo).
- En `test:db` la tabla la crea `asegurarDeskTickets` (`src/test-db/harness.ts`), sólo con las
  columnas que hub-api lee.

## Servicios: plazo de los tickets abiertos

Pestaña «Servicios» = **todos** los tickets de `desk.tickets` con `status_type` distinto de
`'Closed'` (cualquier marca, con o sin serial: va de tickets, no de equipos), en lista y en
calendario de barras. Pestaña «Configuración» = el plazo de cada tipo de servicio.

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
  `VENCE_HOY`, `VENCIDO`, `SIN_PLAZO`); la UI sólo coloca columnas. El estado compara fechas de
  calendario: un sábado tras un límite en viernes ya es `VENCIDO` con 0 días hábiles de atraso.
- **Calendario de barras** (`src/lib/servicios.ts`): una columna por día; barra del ingreso a la
  fecha límite (verde / ámbar si vence hoy / rojo) y, si está vencido, tramo rayado hasta hoy. El
  eje no retrocede más de `RETROCESO_MAX_DIAS` (60) desde hoy; lo anterior se recorta con «‹‹».
- **Modelo** = tercer tramo de `codigo_servicio`. **Cliente** =
  `raw->'contact'->'account'->>'accountName'` y, si no viene, el asunto sin el código de servicio
  (`clienteDeAsunto = true`, en cursiva gris). ⚠️ Esa ruta del `raw` es una suposición sin verificar
  contra producción.
- **Depende del worker de zoho-hub**: hoy `tipo_servicio` y `fecha_creacion_ticket` llegan NULL en
  todas las filas (el worker no trae los campos personalizados de Zoho), así que un servicio sale
  «sin tipo» y sin barra hasta que alguien le pone el tipo a mano; un aviso azul lo explica y se
  va cuando todos tienen tipo. No hay que tocar nada aquí cuando el worker los traiga: los que no
  tengan tipo a mano cogen el de Desk solos, y los que sí lo tengan lo conservan.
- Ninguna migración de hub-api crea ni altera nada en el esquema `desk`.

## Pruebas

- `npm test --workspace=apps/trazabilidad-mantenimientos` — lector del Excel, agregados, aviso y
  geometría del calendario de barras.
- `npm test --workspace=apps/hub-api` — dominio, plazos y router (`src/trazabilidad/*.test.ts`).
- `npm run test:db` en hub-api — `trazabilidad.db.test.ts` contra Postgres real.
