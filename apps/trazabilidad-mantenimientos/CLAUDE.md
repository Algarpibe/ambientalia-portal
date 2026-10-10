# Trazabilidad Mantenimientos Clientes

**Meta: que lleguen menos equipos de clientes sin avisar.** Para eso se avisa a cada cliente antes
de que se le venza la calibración de su GRIMM EDM 180 (objetivo: avisos automáticos a 90, 60 y 30 días).

⚠️ **Hoy el aviso automático es una SIMULACIÓN: nada en esta app ni en su API envía correos**
(ver «Aviso automático: simulación»). Los avisos se siguen copiando y enviando a mano.

App interna del portal para seguir los vencimientos de calibración de los **GRIMM EDM 180**
(180C y 180D) instalados en clientes y avisarles antes de que se les venza, para programar el
servicio de calibración y mantenimiento en vez de recibir el equipo sin previo aviso.

Fuente de datos: el inventario (`portal.tmc_equipos`) es el que dejó la última importación de la
hoja **F-ST-022 «Trazabilidad Mttos Clientes»** (Excel). El seguimiento (aviso enviado, «en
Ambientalia», servicio programado, nota) se registra en la app. ⚠️ **La Excel ya no se sube**
(decisión del 10/10/2026): la hoja está congelada y ni se importa ni se vuelve a congelar. Ver
«F-ST-022: congelación y relevo de la Excel».

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
| HTTP (`requireAuth` + `requireApp('trazabilidad-mantenimientos')`; cada escritura, además, con `escritura(permiso, …)`) | `apps/hub-api/src/trazabilidad/router.ts` |
| Roles y matriz de permisos (puro, sin imports; **único sitio** de la matriz; lo usan servidor y UI) | `apps/hub-api/src/trazabilidad/roles.ts` |
| Fuente de la agenda del taller: interfaz, `TicketTaller`, caída al respaldo (sólo servidor, sólo lee) | `apps/hub-api/src/trazabilidad/fuente.ts`; el SQL de cada origen en `fuente-desk2.ts` y `fuente-replica.ts` |
| Configuración de la agenda, reglas puras: categoría y etapa de un estado (`categoriaDeEstado`, `CATALOGO_ESTADOS_AGENDA`), flujo (`flujoDeTicket`), etapa inicial (`etapaInicial`) y duración (`duracionDeEtapa`) | `apps/hub-api/src/trazabilidad/dominio.ts` (puro, compartido) |
| Calendario de la agenda: días hábiles menos cierres de empresa (`esHabilAgenda`, `sumarDiasHabilesAgenda`; sólo servidor) | `apps/hub-api/src/trazabilidad/agenda-calendario.ts` |
| Proyección de la agenda: puestos, filas ordenadas, fechas previstas y listas aparte (`proyectarAgenda`), quién vuelve de standby (`vuelvenDeStandby`) el reparto inicial que se propone (`proponerReparto`) y cuándo entraría un equipo que llegara hoy (`huecosDeEtapa`); pura, sólo servidor | `apps/hub-api/src/trazabilidad/agenda.ts` |
| Agenda: la lectura que lo reúne todo (`leerAgenda`), su configuración entera (`leerConfiguracionAgenda`), asignar, liberar, reparto inicial y flujo a mano (SQL), y la pasada de la agenda (`registrarEstadosAgenda`: su historial y el cierre automático de asignaciones) | `apps/hub-api/src/trazabilidad/repo.ts`; sus validadores y los `parse…` del cuerpo de cada petición en `types.ts`; sus rutas en `router.ts` (ver «Agenda: API»); cuándo sale la pasada, en `registro-estados.ts` (`agendaAlDia`, `registrarAgendaSinFallar`), encendida en `apps/hub-api/src/index.ts` |
| Conexión opcional y de sólo lectura a la base de Desk 2.0 (`DESK2_DB_URL`) | `apps/hub-api/src/db-desk2.ts` |
| Migraciones (esquema `portal`, idempotentes) | `apps/hub-api/src/users/migrations/042_trazabilidad_mantenimientos.sql`, `043_trazabilidad_plazos.sql`, `044_trazabilidad_servicios_tipo.sql`, `045_trazabilidad_tipo_combinado.sql`, `046_trazabilidad_estados_desk.sql`, `047_trazabilidad_estados_historial.sql`, `048_trazabilidad_contactos.sql`, `049_trazabilidad_roles.sql`, `050_trazabilidad_estados_categoria.sql`, `051_trazabilidad_agenda_config.sql`, `052_trazabilidad_agenda_asignaciones.sql`, `053_trazabilidad_agenda_flujo.sql`, `054_trazabilidad_agenda_historial.sql`, `055_trazabilidad_fst022_congelacion.sql` |
| Congelación de la F-ST-022, **sólo lectura**: la forma de lo guardado (`Celda`, `FilaCongelada`, `ResumenFst022`, `PROBLEMAS_FST022`; sin imports) | `apps/hub-api/src/trazabilidad/fst022.ts`; su SQL (`listarCongelaciones`, `congelacionVigente`) en `repo.ts`; las dos rutas de subida retiradas (`retirada`, 410) en `router.ts` |
| Tarjeta «Origen de los datos · F-ST-022 congelada» de Configuración y lo que calcula (`vigenteDe`, `textoOrigen` —la línea de la cabecera de la app—, `lineasOrigen`, `ETIQUETA_PROBLEMA`, `huellaCorta`) | `src/vistas/OrigenDatos.tsx` y `src/lib/origen.ts` |
| UI (Vite + React, cargada en `/trazabilidad-mantenimientos/*`) | `apps/trazabilidad-mantenimientos/src/` |
| Navegación en dos niveles (grupos y secciones, `seccionDeHash`) y lo que se enseña según el rol (`tiene`, `etiquetaMiRol`, `motivoSinPermiso`) | `src/lib/navegacion.ts` |
| Quién soy, al alcance de cualquier vista (`PermisosContext`, `usePermisos`) | `src/permisos.ts` (lo rellena `src/App.tsx` con `GET /roles/me`) |
| Sección «Roles» (sólo administradores del portal) | `src/vistas/Roles.tsx` |
| Agregados, calendario y texto del aviso (`mensajeAviso`, también el de cada tramo) | `src/lib/vistas.ts` |
| Plan del aviso automático (`planAvisos`, `evaluarAviso`), contactos (`contactoDeTickets`, `contactoEfectivo`) y correos (`esEmail`, `esEmailInterno`, `DOMINIOS_INTERNOS`) | `apps/hub-api/src/trazabilidad/dominio.ts` (puro, compartido) |
| Asunto y cuerpo del correo simulado, resumen y revisión de los correos tecleados | `src/lib/simulacion.ts` |
| Sub-vista «Simulación automática» de «Avisos a clientes» | `src/vistas/SimulacionAvisos.tsx` (el selector Manual / Simulación está en `src/vistas/Avisos.tsx`) |
| Eje, barras (sus tramos, sus pausas y la marca de fin), colores, textos, filtros (`filtrarServicios`, `GRUPOS_PLAZO`), desplegable del tipo de «Servicios» y, de «Configuración», la nota del tipo compuesto y las opciones y textos del rol de cada estado | `src/lib/servicios.ts` |
| Pestañas «Servicios» (lista + calendario de barras) y «Configuración» (plazos y rol de cada estado de Desk) | `src/vistas/Servicios.tsx`, `src/vistas/Configuracion.tsx` |
| Configuración de la agenda del taller (lote 6): puestos, duraciones y categoría de cada estado | `src/vistas/ConfiguracionAgenda.tsx` (los tres bloques y `useAgendaConfig`); lo que calculan —columnas y casillas de la tabla de duraciones, filtro y orden de los estados, firmas— en `src/lib/agenda.ts` (ver «Agenda: pantalla de configuración») |
| Pantalla «Agenda del taller» (lote 7, `#agenda`): cabecera, resumen, filas, listas aparte y ficha lateral; el calendario por puesto y la lista del teléfono; y las acciones con permiso | `src/vistas/Agenda.tsx`, `src/vistas/AgendaGantt.tsx` y `src/vistas/AgendaAcciones.tsx`; lo que calculan —eje, barras, resumen, lista por días, textos y la propuesta de reparto editable— en `src/lib/agendaTaller.ts` (ver «Agenda: pantalla») |
| Diálogos y panel lateral: foco al abrir, Tab que no sale, Escape sólo para el de encima y título como etiqueta (`useDialogo`; único sitio) | `src/ui.tsx` (`Modal`, `Drawer`) |
| Fechas: `fmtFecha` y `fmtFechaHora` (un instante se enseña en hora de **Colombia**; único sitio) | `src/lib/vistas.ts` |
| Aspecto de un control desactivado (`DESACTIVADO`: fondo gris y cursor de «no permitido»; único sitio) | `src/ui.tsx` |

Registro en el portal (los cinco puntos de siempre): `portal/src/lib/apps.ts`,
`portal/src/App.tsx`, `portal/src/pages/Aplicaciones.tsx`, `portal/tailwind.config.js` y el
`Dockerfile` raíz.

## Tablas

| Tabla | Contenido |
|---|---|
| `portal.tmc_equipos` | Un equipo por `clave` (el serial; si la hoja repetía un serial, la 2.ª aparición lleva `-2`: `asignarClaves`). `activo = false` = lo retiró una importación: no se borra. **Ya nada de la app escribe aquí** (lo llenaba la importación de la Excel, retirada el 10/10/2026): contiene lo que dejó la última |
| `portal.tmc_seguimiento` | Seguimiento por `clave`, sin FK a propósito (sobrevive a retiradas y vuelve con el equipo) |
| `portal.tmc_importaciones` | Registro de cada importación que se hizo: archivo, recuentos y quién. **Histórico**: ya no se añade ninguna fila |
| `portal.tmc_fst022_congelaciones` | (**Sólo lectura** desde el 10/10/2026: ningún código inserta ni cambia nada en las dos tablas `tmc_fst022_*`; `fst022.test.ts` lo vigila.) Una fila por **congelación de la F-ST-022** (055): `archivo`, `sha256` del fichero (lo calcula el navegador), `hoja`, `fila_cabecera` y `cabeceras` (`JSONB`: las filas de títulos tal cual), recuentos (`total_filas`, `total_columnas`, `filas_guardadas`, `filas_equipo`, `filas_con_serial`, `filas_edm180` y `problemas`, `JSONB` de recuentos por tipo), `vigente`, `motivo`, la firma (`por_id`, `por`, `en`) y, al dejar de ser la vigente, `reemplazada_por_id` / `reemplazada_por` / `reemplazada_en` / `reemplazada_motivo`. Índice único parcial `tmc_fst022_congelaciones_vigente_uq` = **como mucho una vigente**; `CHECK` `tmc_fst022_vigente_o_reemplazada` = reemplazada si y sólo si no es la vigente, y entonces firmada y con motivo. Nunca se borra. Sólo `CREATE … IF NOT EXISTS`, sin semilla |
| `portal.tmc_fst022_congelada` | Las **filas congeladas**: PK `(congelacion_id, fila)` (`fila` = número de fila de Excel; con FK a su congelación), `celdas` (`JSONB`, array posicional: texto, número, booleano, `null`, o `{v, t, enlace}` con `t` = `fecha` (`v` = AAAA-MM-DD) / `error` (`v` = «#VALUE!»…) y `enlace` = destino del hipervínculo) y lo derivado: `es_equipo`, `serial_norm` (`serialNorm`, `dominio.ts`: el `upper(trim())` del cruce con Desk) y `clave_equipo` (la de `tmc_equipos`, sólo si la importación de entonces aceptaba la fila). Las filas vacías no se guardaron. ⚠️ **Inmutable**: sólo se lee; `fst022.test.ts` falla si algún fuente la inserta, la cambia o la borra |
| `portal.tmc_plazos` | Plazo en días hábiles por tipo de servicio: `clave` (tipo normalizado), `etiqueta`, `dias_habiles` (NULL = sin plazo) y quién lo cambió. Semilla: Diagnóstico = 3, Calibración = 4; Mantenimiento, Garantía, Otro y No aplica sin plazo. La semilla es `ON CONFLICT DO NOTHING`: un arranque nunca pisa lo editado. La 045 añade, igual de idempotente, la fila del tipo compuesto `diagnostico + calibracion` («Diagnóstico + Calibración») con `dias_habiles` NULL: esa columna **no se lee** para un compuesto (ver «Tipo compuesto») |
| `portal.tmc_servicios_tipo` | Tipo de servicio puesto a mano, por `numero` de ticket de Desk (sin FK a `desk.*` ni a `tmc_plazos`): `clave` (la de `tmc_plazos`), `etiqueta` (la de ese tipo al elegirlo) y quién y cuándo (`actualizado_por_id`, `actualizado_por`, `actualizado_en`). Quitarlo borra la fila. La 044 sólo tiene `CREATE … IF NOT EXISTS`: un arranque no toca lo elegido |
| `portal.tmc_estados_desk` | El **rol** de cada estado de Desk en el reloj del plazo: `clave` (el estado normalizado, PK, sin FK a `desk.*`), `etiqueta` (como se escribía al elegirlo), `rol` (`VARCHAR(10) NOT NULL DEFAULT 'cuenta'`, con `CHECK` a `cuenta` / `standby` / `terminado`) y quién y cuándo (`actualizado_por_id`, `actualizado_por`, `actualizado_en`). Sólo hay fila para los estados que alguien ha tocado: los demás valen `cuenta` sin estar en la tabla. Volver a `cuenta` no borra la fila (queda quién lo hizo). La 046 sólo tiene `CREATE … IF NOT EXISTS`, **sin semilla**: nada nace marcado. ⚠️ La 046 se reescribió antes de desplegarse (antes tenía un booleano `standby`): una base donde hubiera corrido la versión vieja conserva la tabla vieja, porque `CREATE TABLE IF NOT EXISTS` no la cambia; ahí hay que borrarla a mano (`DROP TABLE portal.tmc_estados_desk`) y arrancar otra vez. **Desde la 050 lleva además `categoria` y `etapa`** (la categoría del estado en la agenda del taller; ver «Agenda: configuración»): `VARCHAR(12) NULL` las dos, con tres `CHECK` con nombre (`categoria` en `por_llegar` / `entrada` / `activa` / `standby` / `fin` / `fuera`; `etapa` en `diagnostico` / `proceso` / `verificacion`; y etapa sólo —y siempre— con `activa`). **Cada cosa lleva su firma**: `actualizado_por_id` / `actualizado_por` / `actualizado_en` son la del **rol del reloj**; `categoria_por_id` (`UUID NULL`) / `categoria_por` (`VARCHAR(254) NULL`) / `categoria_en` (`TIMESTAMPTZ NULL`), también de la 050, la de la **categoría y la etapa**. La 050 quita además el `NOT NULL` de `actualizado_por` y `actualizado_en`: una fila puede existir sólo por su categoría, y entonces su rol es el de por defecto y **no lo firma nadie** (las tres `actualizado_*` vacías). La 050 **sí siembra**: crea una fila por cada uno de los 23 estados de la propuesta que no la tenga (con `rol` por defecto, `cuenta`, sin firma del rol y con `categoria_por = 'semilla (migracion 050)'`), así que lo de «sólo hay fila para los estados que alguien ha tocado» ya no vale para ellos. **Ni la 050 ni `guardarCategoriaEstado` escriben `rol` ni `actualizado_*` en una fila que ya existe, y `guardarEstadoDesk` no escribe `categoria`, `etapa` ni `categoria_*`** |
| `portal.tmc_agenda_etapas` | Los **puestos simultáneos de cada etapa** del taller: `etapa` (PK, `CHECK` a las tres etapas), `etiqueta`, `orden`, `puestos` (`INTEGER NOT NULL`, `CHECK` 0..50 = `PUESTOS_MAX`) y quién y cuándo (`actualizado_*`, NULL en lo sembrado). Semilla de la 051, `ON CONFLICT DO NOTHING`: Diagnóstico 3, Proceso 4, Verificación 2. Sin clave foránea |
| `portal.tmc_agenda_duraciones` | Cuántos **días hábiles ocupa un puesto** de una etapa un tipo de servicio: PK `(etapa, tipo)`; `tipo` es la clave de un tipo de servicio (`claveTipoServicio`) o **`*`, la fila por defecto de la etapa** (D9); `dias_habiles` (`NOT NULL`, `CHECK` 1..365) y quién y cuándo (NULL en lo sembrado). Semilla de la 051, `ON CONFLICT DO NOTHING`: sólo las `*` (Diagnóstico 3, Proceso 4, Verificación 1). La `*` no se quita desde la app; una fila de tipo quitada no vuelve con el arranque. No es `tmc_plazos`: aquél es el plazo comprometido con el cliente; esto, lo que se ocupa un puesto |
| `portal.tmc_agenda_asignaciones` | **Qué ticket ocupa (u ocupó) qué puesto** de qué etapa. Una fila por asignación y ninguna se borra: `id`, `numero` (ticket, sin FK), `etapa` (`CHECK` a las tres), `puesto` (`CHECK` 1..50), `desde` (instante en que se asignó), `inicio` (`DATE`: el día, siempre hábil, desde el que cuenta la duración), `hasta` (NULL = vigente), `origen` (`fila` / `arranque`), `sugerido` (a quién proponía la fila), `motivo`, quién la hizo (`asignado_por_id`, `asignado_por`) y cómo se cerró: `cierre` (`estado` = sola al salir el ticket de la etapa, `manual` = liberada a mano, `reparto` = reemplazada por un reparto), `cierre_motivo`, `cerrado_por_id`, `cerrado_por`. Dos índices únicos parciales sobre las vigentes: `tmc_agenda_asig_ticket_uq (numero)` y `tmc_agenda_asig_puesto_uq (etapa, puesto)` = **como mucho una asignación por ticket y un ocupante por puesto**. Cuatro `CHECK` con nombre: `hasta >= desde`; cerrada si y sólo si dice cómo; con origen `fila`, motivo obligatorio si `sugerido` es otro ticket; y con cierre `manual`, motivo y firma obligatorios. Que el puesto no pase de los **configurados** lo comprueba la app al asignar, no la tabla. La 052 sólo tiene `CREATE … IF NOT EXISTS`, **sin semilla** |
| `portal.tmc_agenda_flujo` | El **flujo marcado a mano** a un ticket (D11): `numero` (PK, sin FK), `flujo` (`CHECK` a `servicio` / `equipo_nuevo`) y quién y cuándo. Sólo se marca el ticket cuya fuente no trae clasificación; quitar la marca borra la fila. La 053 sólo tiene `CREATE … IF NOT EXISTS`, sin semilla |
| `portal.tmc_agenda_historial` | El **historial de estados propio de la agenda** (D17): mismas columnas e índices que `tmc_estados_historial` (`tmc_agenda_historial_abierto_uq` = un tramo abierto por ticket), pero alimentado desde la **fuente principal** y sólo cuando contesta ella. Sólo lo escribe `registrarEstadosAgenda`. De aquí sale «vuelve de standby». La 054 sólo tiene `CREATE … IF NOT EXISTS`, sin semilla y sin copiar nada del otro historial |
| `portal.tmc_estados_historial` | (El de **«Servicios»**, desde la réplica.) En qué estado ha estado cada ticket, por tramos: `id`, `numero` (ticket de Desk, sin FK), `clave` y `etiqueta` del estado tal como se vio (`TEXT`; la clave puede ser vacía), `desde`, `hasta` (NULL = tramo abierto) y `desde_real` (FALSE = primera observación: el comienzo real no se sabe). `CHECK (hasta IS NULL OR hasta >= desde)`; índice único parcial `(numero) WHERE hasta IS NULL` = como mucho un tramo abierto por ticket; índice `(numero, desde)`. Sólo la escribe `registrarEstados`. **No guarda el rol.** La 047 sólo tiene `CREATE … IF NOT EXISTS`: un arranque no toca el historial, que no se puede reconstruir |
| `portal.tmc_contactos` | El **contacto puesto a mano a un cliente** (a quién iría su aviso): `clave` (el nombre del cliente normalizado con `claveCliente`, PK, sin FK), `cliente` (como se escribió), `emails` (`TEXT[]`, entre 1 y 5 por `CHECK`, en minúsculas y sin repetir), `nombre` (persona de contacto, `''` si no se puso) y quién y cuándo (`actualizado_por_id`, `actualizado_por`, `actualizado_en`). Sólo hay fila para los clientes a los que alguien se lo ha puesto; quitarlo borra la fila. La 048 sólo tiene `CREATE … IF NOT EXISTS`, sin semilla. **Sólo guarda direcciones**: no hay tabla de mensajes, de envíos ni de pendientes en este módulo (`trazabilidad.db.test.ts` vigila la lista de tablas `tmc_*`) |
| `portal.tmc_user_roles` | El **rol de cada persona en la app**: `user_id` (`UUID`, PK, **con** clave foránea a `portal.users(id)` y `ON DELETE CASCADE`: es la única tabla `tmc_*` que la lleva, porque un rol sin su usuario no significa nada), `role` (`VARCHAR(20) NOT NULL`, **sin valor por defecto**, con `CHECK` a `LECTOR` / `COMERCIAL` / `TECNICO` / `DIRECTOR_TECNICO`) y quién y cuándo lo repartió (`actualizado_por_id`, `actualizado_por`, `actualizado_en`). Una fila por usuario; **sin fila se es `LECTOR`**. Cambiar el rol reescribe la fila; poner `LECTOR` también la guarda (queda quién lo dejó así). La 049 sólo tiene `CREATE … IF NOT EXISTS`, **sin semilla**: nadie nace con rol. El `CHECK` lleva los mismos valores que `ROLES_APP` de `roles.ts` y `plazos.test.ts` vigila que coincidan |

## API (`/api/trazabilidad/*`)

Todas piden sesión y la app asignada. Los `GET` no piden nada más (salvo `GET
/trazabilidad/agenda/reparto`, que pide `agenda.reparto`). Los que escriben piden además
un permiso (ver «Permisos»): sin él, 403 `forbidden_role` con mensaje en español, antes de validar
el cuerpo y antes de cualquier consulta de negocio. Las rutas de la agenda del taller van en la
segunda tabla, más abajo.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/trazabilidad/roles/me` | Quién soy en la app: `{userId, email, role, admin, permissions[], canManageRoles}`. `role` es el guardado o `LECTOR` si no hay fila (o si el valor guardado no se conoce); `admin` = administrador del portal; `permissions` son los nombres de la matriz que tiene (todos, si es administrador) y con ellos la UI decide qué enseña; `canManageRoles` = `admin` |
| GET | `/trazabilidad/roles` | **Sólo administradores del portal** (403 `forbidden_admin` si no). `{usuarios[]}`: quien tiene la app asignada, quien ya tiene un rol guardado y los administradores del portal, por nombre. Cada uno: `{userId, fullName, email, status, admin, role}` |
| PUT | `/trazabilidad/roles/:userId` | **Sólo administradores del portal.** `{role}`: pone el rol de esa persona y lo firma. Devuelve `{userId, role}`. 400 en `userId` si no es un UUID; 400 en `role` si no es, tal cual, uno de los cuatro; 404 si el usuario no existe en `portal.users`; **409 `usuario_admin` si esa persona es administrador del portal**: ya lo puede todo, así que no lleva rol en la app (en la sección «Roles» sale como «Admin del portal», en sólo lectura y sin desplegable). Un rol guardado de antes de ser administrador se conserva y vuelve a valer si deja de serlo |
| GET | `/trazabilidad/equipos` (`?hoy=`) | `{hoy, equipos[], ultimaImportacion, contactos[]}` (`ultimaImportacion` = la última que quedó registrada; la app ya no la enseña). Equipos activos con estado, seguimiento, `ticket` (el abierto en Zoho Desk, o `null`) y `contacto: {nombre, email, origen: 'desk' \| 'manual', ticket} \| null` (a quién iría su aviso). `contactos` son los puestos a mano a clientes: `{clave, cliente, nombre, emails[], internos[], actualizadoPor, actualizadoEn}` (`internos` = los de `emails` que son de un dominio propio) |
| PUT | `/trazabilidad/contactos` (`?hoy=`) | `{cliente, emails[], nombre?}`: pone a mano el contacto de un cliente y lo firma; `emails: []` lo quita (vuelve a valer el de Desk). Devuelve lo mismo que el GET de equipos, ya actualizado. 400 en `cliente` si no es un texto no vacío de 200 caracteres como mucho; 400 en `emails` si no es una lista o trae más de 5 correos distintos; 400 en `emails[i]` si ese correo no tiene forma de correo o pasa de 254 caracteres; 400 en `nombre` si no es texto o pasa de 200. Los correos se pasan a minúsculas y se quitan los repetidos. Un correo interno **sí** vale aquí (para probar con un buzón propio) y vuelve señalado en `internos`. **No envía nada** |
| POST | `/trazabilidad/importaciones` y `/trazabilidad/fst022/congelaciones` (también con `?simular=1`) | **Retiradas el 10/10/2026: 410 `subida_retirada`** para cualquiera, administrador incluido («La subida de la Excel F-ST-022 se retiró el 10/10/2026: la hoja está congelada y ya no se importa ni se vuelve a congelar…»). Van tras la sesión y la app (401 / 403 como siempre) y no validan el cuerpo ni miran el rol ni la base (`retirada`, `router.ts`). Siguen registradas sólo para decírselo a un portal sin actualizar; ya no tienen parser propio (un cuerpo de más de 2 MB es el 413 del global) |
| GET | `/trazabilidad/fst022/congelaciones` | `{congelaciones[]}`, la más reciente primero: metadatos, firma y recuentos (`CongelacionFst022`); ni clientes ni seriales |
| GET | `/trazabilidad/fst022/congelaciones/vigente` (`?desde=&limite=`) | `{congelacion, cabeceras, filas[], siguiente}`: la vigente (o `null`) y sus filas `{fila, celdas, esEquipo, serialNorm, claveEquipo}` posteriores a `desde`, de `limite` en `limite` (500 por defecto, 1000 como mucho); `siguiente` es el `desde` de la página que sigue, o `null`. Lleva clientes y seriales, como `GET /equipos` |
| PUT | `/trazabilidad/seguimiento/:clave` | `{enAmbientalia, avisoEnviado, servicioProgramado, nota}` |
| POST | `/trazabilidad/avisos` | `{claves[], fecha}`: marca el aviso en bloque sin tocar el resto del seguimiento |
| GET | `/trazabilidad/servicios` (`?hoy=`) | `{hoy, servicios[], festivos[], tipos[]}`: tickets de Desk sin cerrar con ingreso, tipo efectivo (`tipoServicio`) y su origen (`tipoOrigen`: `manual` / `desk` / `null`, `tipoDesk`, `tipoManual: {clave, por, en}`), el reloj con pausas (`rolEstado`: `cuenta` / `standby` / `terminado`, el del estado de ahora; `enPausa`; `diasPausados`; `pausas: [{desde, hasta}]`; `terminadoEl`; `medidoDesde`; `fechaLimiteBase` = la fecha sin pausas), `plazoDias`, `fechaLimite` (ya corrida), `diasHabiles` y `estadoPlazo` (`EN_PLAZO` / `VENCE_HOY` / `VENCIDO` / `SIN_PLAZO` en marcha; `CUMPLIDO` / `INCUMPLIDO` / `TERMINADO` con el trabajo terminado), y `tramos` (`[{clave, etiqueta, dias, hasta}]`, sólo en un tipo compuesto con plazo; `null` en el resto): el día en que acaba cada parte, el último = `fechaLimite`; `festivos` son los del tramo del calendario de barras; `tipos` (`{clave, etiqueta, dias}`) son los que se pueden elegir a mano: las filas de `tmc_plazos` en el orden de Configuración, con `dias` ya resuelto (la suma, en un compuesto). Antes de leer apunta los cambios de estado (`registrarEstados`), si se puede: un fallo ahí no falla la petición |
| PUT | `/trazabilidad/servicios/:numero/tipo` (`?hoy=`) | `{tipo}`: pone a mano el tipo de servicio del ticket; `null` o vacío lo quita. 400 si `numero` no es un entero positivo o si el tipo no está (por clave normalizada) en `tmc_plazos`; 404 si el ticket no existe en `desk.tickets`. Devuelve lo mismo que el GET, ya recalculado |
| GET | `/trazabilidad/plazos` | `{plazos[]}`: las filas de `tmc_plazos` más los tipos que traigan los tickets abiertos y aún no tengan fila; `ticketsAbiertos` cuenta por tipo efectivo. Cada plazo lleva `derivadoDe`: `null` en un tipo simple y, en uno compuesto, sus partes `[{clave, etiqueta, dias}]` (entonces `dias` es su suma, o `null` si a alguna le falta) |
| PUT | `/trazabilidad/plazos` | `{tipo, dias}` (entero 1..365, o vacío = sin plazo). Devuelve `{plazos[]}` ya actualizado. 400 en `tipo` si es un tipo compuesto: su plazo se calcula, no se guarda |
| GET | `/trazabilidad/estados` | `{estados[]}`: todos los estados que existen en `desk.tickets` (de cualquier ticket, cerrados incluidos) más los ya guardados en `tmc_estados_desk` aunque ningún ticket los tenga. Cada uno: `{clave, etiqueta, tipoDesk, ticketsAbiertos, rol, actualizadoPor, actualizadoEn, categoria, etapa, categoriaPor, categoriaEn}`; `rol` es `cuenta` (mientras nadie lo cambie), `standby` o `terminado`; `tipoDesk` es el `status_type` de Desk (`Open` / `On Hold` / `Closed`, o `null`) y sólo orienta. Los cuatro últimos (añadidos con la agenda; la pantalla de hoy no los usa) son la categoría del estado en la agenda —la guardada o, sin ella, la de la propuesta; `null` = sin categoría— y **su firma, que es otra que la del rol** (`null` si sale de la propuesta). Orden: tipo abierto, en espera, cerrado y sin tipo; dentro, más tickets abiertos primero y después alfabético |
| PUT | `/trazabilidad/estados` | `{estado, rol}`: elige el rol de un estado y lo firma. Devuelve `{estados[]}` ya actualizado. 400 en `estado` si no es un texto no vacío de 80 caracteres como mucho; 400 en `rol` si no es, tal cual, `cuenta`, `standby` o `terminado` (el `{estado, standby}` de antes ya no vale). Vale cualquier texto de estado: se puede elegir el rol de uno antes de que un ticket lo use. No toca el historial: el cambio vale hacia atrás desde la lectura siguiente. **Sólo el rol**: no escribe la categoría ni su firma, y lo que venga de más en el cuerpo (`categoria`, `etapa`) se ignora; la categoría va por `PUT /trazabilidad/agenda/configuracion/estados` |
| GET | `/trazabilidad/agenda/fuente` | Diagnóstico de la fuente de la agenda (ver «Fuente de la agenda»): `{fuente, motivo, mensaje, ultimaSincronizacion, sincronizacionParada, umbralSincronizacionMs, ultimoFalloPrincipal, cortacircuitosHasta, abiertos: {total, porEstado: [{estado, tickets}]}}`. `fuente` es `principal` (Desk 2.0) o `respaldo` (la réplica); `motivo`, `null` o `sin_variable` / `error_conexion` / `timeout` / `error_consulta`; `cortacircuitosHasta`, hasta cuándo no se vuelve a probar la principal (`null` si no ha fallado hace poco). Sólo recuentos: ni clientes, ni seriales, ni correos. Si Desk 2.0 no contesta responde 200 igual, con el respaldo |

**Agenda del taller** (lote 5; reglas en «Agenda: API»). Los cuatro cambios de la agenda devuelven
la agenda ya leída otra vez (lo mismo que `GET /trazabilidad/agenda`, a hoy) y los tres de la
configuración, la configuración entera. Errores como en el resto: `{error, message, field}`.

| Método | Ruta | Permiso | Qué hace y qué errores da |
|---|---|---|---|
| GET | `/trazabilidad/agenda` (`?hoy=`) | — | La agenda: `{hoy, fuente: {fuente, motivo, ultimaSincronizacion}, etapas[], standby[], porLlegar[], finTaller, fueraAgenda, sinCategoria[], avisos[], totalAbiertos, estadoFuente}`. Cada etapa: `{etapa, etiqueta, puestos[], fila[], encadenados[], saturacion: {ocupados, puestos}, primerHueco}` (ver «Agenda: proyección»); `estadoFuente` es el de `GET /agenda/fuente` sin `abiertos`; `avisos` son `{codigo, mensaje}` con `sincronizacion_parada`, `fuente_respaldo`, `estados_sin_categoria` y `pasada_fallida`. Antes de leer lanza la pasada de la agenda. 400 en `hoy`. **Desde el lote 7** (sólo lectura, para la pantalla): cada puesto lleva `finPlanificado`; y la respuesta, `tickets[]` —la ficha de cada abierto: `{numero, asunto, estado, tipo, tipoManual, flujo, flujoOrigen, remisionEntrada, ultimaTransicion}`— y `eje: {desde, hasta, festivos[], cierres[]}` (ver «Agenda: pantalla»). Las cuatro escrituras devuelven lo mismo |
| GET | `/trazabilidad/agenda/reparto` (`?hoy=`) | `agenda.reparto` | La propuesta de reparto inicial (D6), sin escribir: `{hoy, reparto: [{numero, etapa, puesto, desde}]}` |
| POST | `/trazabilidad/agenda/reparto` | `agenda.reparto` | `{reparto: [{numero, etapa, puesto}]}`: la propuesta tal cual o ajustada, todo o nada. 400 en `reparto` si no es una lista o repite ticket o puesto, y en `numero` / `etapa` / `puesto` de una línea (también si la etapa no tiene ese puesto); **409 `puesto_ocupado` diciendo cuál** («El puesto 2 de Proceso ya está ocupado…»): sólo rellena puestos libres (D19); 409 `ticket_fuera_de_etapa` / `ticket_con_puesto` |
| POST | `/trazabilidad/agenda/asignaciones` | `agenda.asignar` | `{numero, etapa, puesto, motivo?}`. 400 en `motivo` si el ticket no es el primero de la fila y no se dice; 400 en `puesto` si la etapa no lo tiene; 409 `puesto_ocupado`, `ticket_fuera_de_etapa` o `ticket_con_puesto` |
| POST | `/trazabilidad/agenda/liberar` | `agenda.liberar` | `{numero, motivo}`: **por número de ticket** (D18). 400 en `numero` o en `motivo` (obligatorio); 404 si el ticket no tiene puesto |
| PUT | `/trazabilidad/agenda/flujo/:numero` | `agenda.flujo` | `{flujo}`: `servicio` / `equipo_nuevo`, o `null` para quitar la marca. 400 en `numero` o `flujo`; 404 si la fuente no trae abierto el ticket; 409 `flujo_de_la_fuente` si ya trae su clasificación |
| GET | `/trazabilidad/agenda/huecos` (`?etapa=&tipo=&hoy=`) | — | Cuándo entraría un equipo que llegara hoy a esa etapa: `{hoy, etapa, tipo, duracionDias, sinTipo, fuente, huecos: [{puesto, entrada, fin}]}`, las 5 próximas entradas (`HUECOS_PROXIMOS`), una tras otra. `tipo` es opcional (sin él, la «*»). 400 en `etapa`, `tipo` u `hoy`. Sólo lectura: para la futura reserva del cliente |
| GET | `/trazabilidad/agenda/configuracion` | — | `{etapas[], duraciones[], estados[], tiposAbiertos[]}`: `etapas` = `{etapa, etiqueta, orden, puestos, actualizadoPor, actualizadoEn}`; `duraciones` = `{etapa, tipo, dias, actualizadoPor, actualizadoEn}` (la «*» de cada etapa delante); `estados` = lo mismo que `GET /estados` (rol y categoría con **sus dos firmas**), pero con `ticketsAbiertos` contados en la **fuente de la agenda**; `tiposAbiertos` (lote 6) = `{clave, etiqueta, tickets}`, los tipos de servicio que traen los tickets abiertos de esa misma fuente (`tiposDeTickets`, `dominio.ts`): sólo tipos y recuentos |
| PUT | `/trazabilidad/agenda/configuracion/puestos` | `config.write` | `{etapa, puestos}` (entero 0..50). 400 en `etapa` o `puestos` |
| PUT | `/trazabilidad/agenda/configuracion/duraciones` | `config.write` | `{etapa, tipo, dias}` (entero 1..365); `dias: null` quita la fila del tipo; **la «*» no se quita: 400 en `dias`**. 400 en `etapa`, `tipo` o `dias` (que falte también) |
| PUT | `/trazabilidad/agenda/configuracion/estados` | `config.write` | `{estado, categoria, etapa?}`: sólo la categoría (y la etapa, si es `activa`), con su firma; **no toca el rol del reloj ni la suya**. 400 en `estado`, `categoria` o `etapa` (etapa sólo y siempre con `activa`) |

## Permisos

**Leer** está abierto a cualquiera con la app asignada. **Cambiar** algo depende del rol de la
persona en la app, que reparten los administradores del portal en «Administración» → «Roles».
Todo cambio sigue quedando firmado con el correo de quien lo hace. El historial de estados no lo
escribe nadie a mano: lo apunta hub-api.

- **La matriz vive en un solo sitio**: `apps/hub-api/src/trazabilidad/roles.ts` (`ROLES_APP`,
  `PERMISOS`, `puede`, `permisosDe`, `resolverRol`, `ETIQUETA_ROL_APP`). Es puro y sin imports; la
  UI lo importa por `src/dominio.ts`. `roles.test.ts` recorre la matriz entera (cada rol × cada
  permiso). ⚠️ El «rol» de un **estado de Desk** en el reloj (`cuenta` / `standby` / `terminado`,
  `ROLES_ESTADO` en `dominio.ts`) es otra cosa: lo de las personas lleva siempre «App» o «Permiso».
- **Sin fila en `portal.tmc_user_roles` se es `LECTOR`** (también con un valor guardado que no se
  conozca). Al desplegar esto, por tanto, todos pasan a Lector salvo los administradores.
- **Administradores del portal** (`portal.users.role = 'admin'`, que `requireAuth` relee de la base
  en cada petición): tienen **todos** los permisos, tengan el rol que tengan y sin necesidad de
  fila, y son los **únicos** que reparten roles (`roles.manage` no lo tiene ningún rol).

| Permiso | Lector | Comercial | Técnico | Director Técnico | Qué protege hoy |
|---|:-:|:-:|:-:|:-:|---|
| `seguimiento.write` | — | sí | sí | sí | `PUT /trazabilidad/seguimiento/:clave` |
| `avisos.write` | — | sí | — | sí | `POST /trazabilidad/avisos` |
| `contactos.write` | — | sí | — | sí | `PUT /trazabilidad/contactos` |
| `servicios.tipo.write` | — | — | sí | sí | `PUT /trazabilidad/servicios/:numero/tipo` |
| `importar` | — | — | — | sí | **Nada**: protegía la importación y la congelación de la Excel, retiradas el 10/10/2026 (410 para todos). Se queda en la matriz porque los nombres de permiso son estables (`roles.ts` lo dice); `router.test.ts` falla si alguna ruta vuelve a pedirlo |
| `config.write` | — | — | — | sí | `PUT /trazabilidad/plazos`, `PUT /trazabilidad/estados` y los tres `PUT /trazabilidad/agenda/configuracion/…` (puestos, duraciones y categoría de cada estado) |
| `agenda.asignar` | — | — | — | sí | `POST /trazabilidad/agenda/asignaciones` |
| `agenda.liberar` | — | — | — | sí | `POST /trazabilidad/agenda/liberar` |
| `agenda.reparto` | — | — | — | sí | `POST /trazabilidad/agenda/reparto` y, aunque sólo lee, `GET /trazabilidad/agenda/reparto` (la propuesta) |
| `agenda.flujo` | — | — | — | sí | `PUT /trazabilidad/agenda/flujo/:numero` |
| `calibraciones.write` | — | — | sí | sí | Nada todavía (reservado): confirmar o registrar calibraciones |
| `roles.manage` | — | — | — | — | `GET /trazabilidad/roles` y `PUT /trazabilidad/roles/:userId`: sólo administradores del portal |

El Director Técnico es el de D14 en `docs/trazabilidad-agenda-taller.md`: los endpoints de la
agenda piden los permisos `agenda.*` y `config.write` de la matriz, no comparan el rol a mano.

**En el servidor** (`router.ts`): toda ruta que escribe se registra con
`escritura('<permiso>', ctx, fn)`, que mira el rol **antes de validar y antes de cualquier
consulta de negocio** y responde 403 `forbidden_role` («Tu rol en Trazabilidad (Lector) no
permite hacer este cambio…»); a un administrador no hace falta mirarle el rol. Las de reparto de
roles van con `soloAdmin(ctx, fn)` (403 `forbidden_admin`). `router.test.ts` lee `router.ts` y
**falla si una ruta `post` / `put` / `patch` / `delete` se registra sin una de las dos**, o con un
permiso que no es el de la lista `ESCRITURAS` de esa prueba (ruta a ruta): al añadir una escritura
hay que darle permiso y apuntarla ahí. `escritura` es el alias de `conPermiso`, que con ese nombre
sólo usa la única lectura que pide permiso (`GET /trazabilidad/agenda/reparto`); la prueba también
falla si otra lectura lo pide o si una lleva `escritura`. La tercera forma es `retirada(ctx)`: una
ruta que ya no deja pasar a nadie (410); la prueba fija cuáles son (las dos subidas de la Excel).

**En la UI**: `App.tsx` pide `GET /roles/me` al entrar y lo deja en `PermisosContext`; las vistas
preguntan con `usePermisos().puede('<permiso>')`. Mientras no llega (o si falla) vale `SIN_ROL`,
es decir, modo de consulta. Sin el permiso: el seguimiento de la
ficha va desactivado y sin «Guardar»; en «Avisos a clientes» no sale «Marcar como avisado» (sí
«Redactar aviso» y copiar) ni, en la simulación, «Cambiar destinatario» ni el editor de contacto;
el desplegable del tipo en «Servicios» va desactivado; y en «Configuración» los plazos, la agenda y
los estados se ven pero no se editan, con un aviso arriba. **Lo desactivado se nota**: todo
`<input>`, `<select>` y `<textarea>` lleva `DESACTIVADO` (`src/ui.tsx`: fondo gris y cursor de «no
permitido»); un control nuevo que se pueda desactivar tiene que llevarlo. La cabecera enseña «Tu rol: …»
(`etiquetaMiRol`; a un administrador, «Administrador del portal»). Ocultar es comodidad: **la
guarda de verdad es la del servidor**.

## Navegación

Dos niveles (`src/lib/navegacion.ts`): arriba el **grupo**, debajo sus **secciones**.

| Grupo | Secciones (hash) |
|---|---|
| Clientes y calibraciones | Resumen (`#resumen`), Equipos (`#equipos`), Calendario Calibraciones (`#calendario`), Avisos a clientes (`#avisos`, con sus vistas Manual / Simulación automática dentro) |
| Taller | Servicios (`#servicios`) y Agenda del taller (`#agenda`) |
| Administración | Configuración (`#configuracion`) y Roles (`#roles`, sólo se ofrece a los administradores del portal) |

El grupo no va en la URL: se deduce de la sección, así que los hashes de siempre siguen valiendo.
Un hash vacío o desconocido lleva al Resumen. `#roles` escrito a mano por quien no es
administrador enseña un aviso (y el servidor tampoco le daría la lista).

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

## Fuente de la agenda

Primer lote de la **agenda del taller** (`docs/trazabilidad-agenda-taller.md`, decisiones D4, D12
y D13; plan en su sección J). Es sólo la **capa de lectura**: la pantalla va en «Agenda: pantalla» (el modelo
de la configuración va en «Agenda: configuración», el cálculo en «Agenda: proyección» y las escrituras en «Agenda: asignaciones y arranque»), y «Servicios» y el historial de estados siguen leyendo la réplica como siempre
(**cada pantalla lleva el historial de la base de la que lee**: la agenda tiene el suyo, `tmc_agenda_historial`; ver «Agenda: asignaciones y arranque»).
`abiertosConOrigen()` da los mismos tickets que `ticketsAbiertos()` y dice además quién los dio en esa llamada.

- **Dos orígenes, una interfaz** (`crearFuenteAgenda` en `fuente.ts`):
  - **principal**: la base `desk` de Desk 2.0 (servicio `desk-db`), por `DESK2_DB_URL` y el rol
    `portal_agenda_reader`. Lee `desk.tickets`, `desk.ticket_transitions` y
    `public.calendario_cierres`;
  - **respaldo**: la réplica `desk.tickets` de zoho-hub, la de «Servicios».
- **`ticketsAbiertos()`** → `TicketTaller[]`, igual venga de donde venga: `numero`, `estado` (tal
  cual; se casa por `claveEstadoDesk`), `tipoEstado`, `clasificacion`, `tipoServicio`,
  `remisionEntrada` (`fecha_remision_entrada`), `fechaCreacion` (la de «Servicios»:
  `fecha_creacion_ticket` o el día en Colombia de `created_time`), `prioridad` (**sólo** la fijada
  en Desk 2.0, con `prioridad_en_app_at`; el `High` / `Low` de Zoho da `null`), `llegadaEstado`
  (milisegundos del `performed_at` de la última transición al estado de ahora), `asunto`,
  `codigoServicio` y `fuente`. En
  respaldo, `prioridad` y `llegadaEstado` son siempre `null`, y `clasificacion` y
  `remisionEntrada` se leen sólo si la réplica trae la columna (`to_jsonb(t)->>…`: si no existe,
  `null` en vez de error). **Ningún ticket lleva marca «sin confirmar»** (D13).
  `asunto` (`subject`) viene **de las dos fuentes desde el lote 7**: identifica el equipo en la
  pantalla de la agenda. `codigoServicio` (`codigo_servicio`) sigue **sólo en respaldo** (con la
  principal es `null`) y, con el asunto, sirve para deducir el flujo (`flujoDeTicket`). ⚠️ El
  asunto es texto de terceros y suele llevar el nombre del cliente: **sólo sale por `GET
  /trazabilidad/agenda`** (en `tickets`), la pantalla lo pinta siempre como texto, y `GET
  /trazabilidad/agenda/fuente` no lo devuelve (`router.test.ts` lo vigila). Ni serial ni correo.
- **`cierresEmpresa(desde, hasta)`** → fechas de `public.calendario_cierres`; `[]` en respaldo.
- **`estadoFuente()`** → cuál contesta y por qué (`motivo`: `sin_variable`, `error_conexion`,
  `timeout`, `error_consulta`), el máximo de `synced_at` de la base usada y
  `sincronizacionParada` (más de `UMBRAL_SINCRONIZACION_PARADA_MS`, una hora, o ninguna
  sincronización). Su consulta es también una **sonda**: nombra todo lo que leen las otras, así
  que si al rol le falta un permiso el estado cae al respaldo igual que los tickets.
  `ultimoFalloPrincipal` guarda el último fallo visto por el proceso, aunque ya haya vuelto, y
  `cortacircuitosHasta`, hasta cuándo no se la vuelve a probar (`null` = cerrado).
- **Caída al respaldo, por llamada**: sin la variable se usa siempre la réplica y no es un error.
  Con ella, cada llamada prueba la principal **una vez**; si falla, esa llamada lee la réplica.
  Si falla la réplica, eso sí es un 500.
- **Cortacircuitos** (`CORTACIRCUITOS_MS`, 60 s): tras un fallo de la principal, las lecturas van
  **derechas al respaldo** sin esperar otra vez su tope de tiempo (hasta 3 s de conexión o 5 s de
  consulta). Pasado el minuto, la llamada siguiente la prueba una vez: si contesta, vuelve a
  mandar ella; si no, otro minuto desde ese intento. El estado es de cada fuente creada:
  `index.ts` crea **una** y se la da a las rutas y al programador, así que lo comparten. ⚠️ Una
  lectura servida con el cortacircuitos abierto **es de respaldo y lo dice** (`fuente:
  'respaldo'`, también en `abiertosConOrigen`): la pasada de la agenda no apunta historial ni
  cierra asignaciones con ella, ni la toma por «todos cerrados» (`fuente.test.ts` y
  `agenda-api.db.test.ts` lo prueban).
- **La conexión** (`db-desk2.ts`): pool propio y perezoso (no se comprueba nada al arrancar), 2
  conexiones como mucho, 3 s para conectar y `statement_timeout` de 5 s. Sólo lectura por partida
  doble: el rol ya lo trae y cada conexión fija `default_transaction_read_only=on` al conectar.
- ⚠️ **La URL no sale nunca**: ni en el registro (se enmascara con `enmascararUrl`), ni en un
  error, ni en una respuesta. Del error de `pg` —que puede llevar host y usuario— sólo se usa el
  código para elegir el motivo; su mensaje no se escribe ni se devuelve.
- **Nombres de Desk 2.0**: tablas y columnas están citadas con ruta y línea en la cabecera de
  `fuente-desk2.ts`. Desk 2.0 es otro repositorio y aquí sólo se lee su base: ninguna migración
  de hub-api toca nada suyo.
- **Encenderlo**: variable `DESK2_DB_URL` en el entorno de hub-api (ver
  `apps/hub-api/README.md`) y reiniciar. `GET /api/trazabilidad/agenda/fuente` debe responder
  `fuente: "principal"`. Quitar la variable y reiniciar lo apaga.

## Agenda: configuración

Segundo lote de la agenda (`docs/trazabilidad-agenda-taller.md`, secciones C, E y J): el **modelo**
(migraciones 050 y 051) y las **reglas**. Sus endpoints (lote 5) están en la tabla de la API,
bajo `/trazabilidad/agenda/configuracion`, y su pantalla (lote 6) en «Agenda: pantalla de
configuración». Nada de esto lo usa
«Servicios» ni el reloj del plazo.

### Categoría y etapa de cada estado

Cada estado de Desk tiene una **categoría** en la agenda y, si es una etapa activa, su **etapa**
(`CATEGORIAS_AGENDA`, `ETAPAS_AGENDA` y sus etiquetas, en `dominio.ts`):

| Categoría (`tmc_estados_desk.categoria`) | Qué es |
|---|---|
| `por_llegar` — «Por llegar» | El equipo aún no ha llegado; lista aparte, sin proyectar |
| `entrada` — «Fila de entrada» | Llegó y espera su primera etapa |
| `activa` — «Etapa activa» | Ocupa un puesto. Lleva `etapa`: `diagnostico`, `proceso` o `verificacion` |
| `standby` — «Standby» | No ocupa puesto: depende del cliente, de Comercial, de Compras o de terceros |
| `fin` — «Fin de taller» | Trabajo hecho; libera el puesto |
| `fuera` — «Fuera de la agenda» | Soporte remoto (D10) |

- ⚠️ **Categoría y rol del reloj son dos columnas con dos usos** y ninguna cambia a la otra: el
  `rol` (`cuenta` / `standby` / `terminado`) gobierna el plazo de «Servicios»; la categoría, los
  puestos y las filas. Que las dos tengan un valor llamado `standby` es coincidencia: un estado
  puede ser etapa activa en la agenda y estar en standby en el reloj.
- **`categoriaDeEstado(estado, guardadas?)`** → `{categoria, etapa}` o `null`. Casa por
  `claveEstadoDesk`. **Lo guardado gana** (`guardadas` = `leerCategoriasEstados(db)`); sin nada
  guardado vale la propuesta (`CATALOGO_ESTADOS_AGENDA`); un estado que no está en ninguno de los
  dos sitios queda **sin categoría** (`null`) hasta que alguien se la elija.
- **La propuesta** (`CATALOGO_ESTADOS_AGENDA`, sección C.3 del análisis; los 23 estados del
  blueprint): OV asignada y Ticket creado → por llegar; Remisión creada e Ingresado → fila de
  entrada; Rev./Diagnostico y **Notificado** → Diagnóstico (D2: sigue ocupando el puesto); En
  Proceso y Continuación del proceso → Proceso; Verificación → Verificación; Notificación a
  Compras, Notificación Comercial, Notificación cliente, En espera de SKU inventario, En Espera de
  Repuestos, Solicitado y Servicio externo → standby; Por Facturar, Liberación Comercial, Por
  Entregar, Por Entregar / Sin facturar y Finalizado → fin de taller; **Pendiente y Solicitud
  Soporte → fuera** (D10).
- **La semilla (migración 050) es esa misma lista** (`agenda-config.test.ts` falla si el SQL y la
  constante dejan de coincidir) y **sólo rellena donde no hay categoría**: es un
  `INSERT … ON CONFLICT (clave) DO UPDATE SET categoria, etapa, categoria_por, categoria_en …
  WHERE e.categoria IS NULL`. La app nunca guarda una categoría vacía, así que una elegida no se
  pisa en ningún arranque. La sentencia no nombra `rol`: en una fila que ya existía se queda como
  esté, y una fila nueva nace con el de por defecto.
- **Dos firmas, una por cosa.** La categoría la firma quien la elige en `categoria_por_id`,
  `categoria_por` y `categoria_en` (la semilla, con `categoria_por = 'semilla (migracion 050)'` y
  sin id); el rol del reloj sigue firmándose en `actualizado_*`. **Cambiar una no toca la firma
  de la otra**, en ninguno de los dos sentidos (`agenda-config.db.test.ts` lo prueba). En una
  fila que la semilla o `guardarCategoriaEstado` **crean**, las `actualizado_*` quedan vacías: el
  rol por defecto no lo ha elegido nadie. Por eso `actualizado_por` y `actualizado_en` ya admiten
  NULL, y quien inserte en esa tabla sin querer firmar el rol tiene que escribir
  `actualizado_en = NULL` (la columna conserva su `DEFAULT NOW()`).
- **Guardar**: `guardarCategoriaEstado(db, {estado, categoria, etapa}, actor)` (`repo.ts`), con
  `validarCategoriaEstado` (`types.ts`): 400 si la categoría o la etapa no existen, o si no
  cuadran (etapa sólo y siempre con `activa`). Los tres `CHECK` de la tabla dicen lo mismo.
  `leerCategoriasEstados` sólo da categoría y etapa (es lo que usa la proyección); la firma de
  la categoría la lee `listarEstadosDesk`, junto a la del rol.

### Flujo y etapa inicial (D11)

- **`flujoDeTicket({fuente, clasificacion, asunto, codigoServicio})`** → `{flujo, deducido}`, con
  `flujo` = `servicio` o `equipo_nuevo`. **Con clasificación manda ella**: equipo nuevo si
  normaliza a «equipo nuevo», servicio con cualquier otra. Sin ella, la fuente principal da
  servicio; **en respaldo se deduce** (`deducido: true`): equipo nuevo si el asunto empieza por
  «Equipo Nuevo» o el código de servicio por `HV_`. La marca a mano por ticket
  (`tmc_agenda_flujo`) gana a eso, pero **sólo existe para el ticket sin clasificación**.
- **`etapaInicial(flujo)`**: `diagnostico` para servicio, `proceso` para equipo nuevo.

### Puestos y duraciones (D9)

- `leerConfigAgenda(db)` → `{etapas[], duraciones[]}`: las etapas en su orden con sus puestos, y
  las duraciones con la `*` de cada etapa delante de sus tipos.
- **`duracionDeEtapa(duraciones, etapa, tipoManual, tipoFuente)`** →
  `{dias, origen: 'tipo' | 'defecto' | null, tipo, sinTipo}`: la fila **exacta** del tipo; si no
  la hay, la **`*`** de la etapa; si tampoco, **sin duración** (`dias: null`). El tipo es el
  efectivo —el puesto a mano (`tmc_servicios_tipo`) gana al de la fuente, `tipoEfectivo`— y casa
  por `claveTipoServicio`. Sin tipo: la `*`, con `sinTipo: true`. Un tipo compuesto
  («Diagnóstico + Calibración») no se descompone aquí: casa por su propia clave o cae en la `*`.
- `guardarPuestosEtapa(db, {etapa, puestos}, actor)` (entero 0..50) y
  `guardarDuracionEtapa(db, {etapa, tipo, dias}, actor)` (entero 1..365; `dias: null` quita la
  fila del tipo; **quitar la `*` es un 400**). No se exige que el tipo tenga fila en `tmc_plazos`.

### Calendario (D3)

`agenda-calendario.ts`: `esHabilAgenda(fecha, cierres)` y `sumarDiasHabilesAgenda(desde, n,
cierres)` = los días hábiles de `plazos.ts` (su `esHabil`, sin repetir la regla) **menos** los
cierres de empresa que da la fuente (`cierresEmpresa`; vacíos en respaldo). El día de partida no
cuenta; sin cierres da lo mismo que `sumarDiasHabiles`.

### Sus endpoints, y lo que no cambió en «Estados de Desk»

Las tres escrituras de la agenda (puestos, duraciones y categoría) van por `PUT
/trazabilidad/agenda/configuracion/…`, tras `escritura('config.write', …)`. **`PUT
/trazabilidad/estados` sigue siendo sólo del rol**, con el cuerpo `{estado, rol}` que envía la
pantalla de hoy: no se hizo «parcial» ni aprendió `categoria` (lo que el análisis preveía en un
principio); la categoría tiene su ruta y así ninguna de las dos puede pisar a la otra por un
campo que falte. `GET /trazabilidad/estados` devuelve ya la categoría y su firma (campos
añadidos) y **lista los 23 estados sembrados** aunque ningún ticket los tenga (son filas
guardadas): en la pantalla salen como cualquier estado que nadie ha tocado (`rol: 'cuenta'`,
`actualizadoPor: null`, «Nadie lo ha cambiado»), porque la semilla firma la categoría
(`categoriaPor: 'semilla (migracion 050)'`), no el rol.

## Agenda: proyección

Tercer lote (`docs/trazabilidad-agenda-taller.md`, secciones B.5, F y H): el cálculo entero de la
agenda como **función pura**, `proyectarAgenda(entrada)` en `agenda.ts`. La sirve `GET
/trazabilidad/agenda` y la pinta «Agenda: pantalla». No mira el reloj ni la base (`agenda.test.ts`
tiene la guarda) y no cambia lo que recibe.

- **Entrada** (`EntradaAgenda`): `hoy`, `tickets` (los de la fuente), `categorias`
  (`leerCategoriasEstados`), `config` (`leerConfigAgenda` vale tal cual), `tiposManuales` (número
  → tipo de `tmc_servicios_tipo`), `cierres`, `estadoFuente` y `asignaciones`
  (`AsignacionAgenda`: `numero`, `etapa`, `puesto`, `desde` = el **día** desde el que cuenta la
  duración). Dos opcionales: `vuelvenDeStandby` (números que el historial muestra volviendo de un
  standby) y `flujosManuales` (número → flujo marcado a mano). Todo ello lo reúne
  `leerEntradaAgenda` (`repo.ts`).
- **Nada se proyecta en un día no hábil (D16)**: si `hoy` es sábado, domingo, festivo o cierre de
  empresa, los puestos libres y la fila arrancan el siguiente día hábil (`primerDiaHabilAgenda`).
  Ninguna entrada prevista ni primer hueco cae en un día no hábil.
- **Salida** (`AgendaTaller`, serializable; sólo números de ticket, estados, fechas y marcas):
  `etapas` en el orden configurado —cada una con `puestos`, `fila`, `encadenados`, `saturacion`
  (`ocupados` / `puestos`) y `primerHueco`—, `standby` (con `desde` y `dias`), `porLlegar`,
  `finTaller` y `fueraAgenda` (recuentos), `sinCategoria` (clave, estado y tickets), `avisos`
  (`sincronizacion_parada`, `fuente_respaldo`, `estados_sin_categoria`), `fuente` y `totalAbiertos`.
- **Un ticket, un sitio**: ocupante de un puesto, fila de una etapa, standby, por llegar, fin de
  taller, fuera o sin categoría. La suma da el total de abiertos. `encadenados` es lo único que
  repite: es previsión (el equipo nuevo que llegará de Proceso a Verificación).
- **Sin asignaciones todo el que está en una etapa activa va en su fila** y el reparto FIFO se
  simula desde hoy: es lo que propondrá el «reparto inicial» (D6).
- **Orden de la fila** (`ordenDe`): prioridad fijada (sólo fuente principal, D1) → grupo A (la
  primera etapa del flujo: fecha de remisión; sin fecha, detrás y con `faltaRemision`; mismo día,
  llegada exacta primero) → grupo B (etapas siguientes y vueltas de standby: llegada al estado)
  → número de ticket. `motivo` dice cuál decidió. `ordenAproximado` = sin llegada exacta en el
  grupo B, o un empate que resolvió el número. En respaldo sin fecha de remisión en ningún ticket,
  el grupo A se ordena como el B y nadie lleva `faltaRemision` (D8).
- **Reparto** (`tomarPuesto`): cada uno de la fila toma el puesto que antes queda libre (en
  empate, el de número menor); el día en que sale uno entra el siguiente. Sin duración (ni tipo ni
  «*»): `sinDuracion`, sin fechas y sin reservar puesto.
- **Puesto ocupado**: fin = `desde` + duración; si ya pasó, `pasadoDeFecha` y fin = el siguiente
  día hábil a hoy, que empuja la fila. Acabar hoy no es ir pasado. Una asignación cuyo ticket la
  fuente trae en otra etapa **no cuenta** (manda el estado); si la fuente no lo trae, conserva el
  puesto con `sinDatosFuente`. Un puesto por encima de los configurados sale `aExtinguir`: sigue
  ocupado y no recibe a nadie (ahí `ocupados` supera a `puestos`).
- **Avisos**: salen de `estadoFuente` (y de que algún ticket venga de la réplica); no marcan
  ningún ticket ni cambian la proyección (D13). El umbral de una hora lo aplica la fuente, que
  tiene el reloj; aquí sólo se lee `sincronizacionParada`.

## Agenda: asignaciones y arranque

Lote 4a (`docs/trazabilidad-agenda-taller.md`, secciones E.3, E.4, F.5 y J): las tablas 052 y 053
y lo que las lee y escribe, en `repo.ts`. Sus rutas llegaron con el lote 5 («Agenda: API»);
sus botones, con el lote 7b («Agenda: pantalla»). Todas reciben la fuente (`FuenteAgenda`) y `hoy` como argumentos.

- **`leerEntradaAgenda(db, fuente, hoy)`** reúne lo que pide `proyectarAgenda`: abiertos, estado y
  cierres de la fuente (de `hoy` − 120 a `hoy` + 365 días), categorías, puestos y duraciones, el
  tipo puesto a mano, las asignaciones **vigentes**, `vuelvenDeStandby` y los flujos a mano.
  **`leerAgenda`** devuelve la agenda ya proyectada.
- **`vuelvenDeStandby`** (`agenda.ts`, pura): el ticket está en una etapa activa y, justo antes de
  entrar en ella, el historial lo tiene en un estado de categoría standby; cambiar de estado
  dentro de la etapa no lo borra. Sólo se afirma si el tramo abierto es el estado que da la
  fuente y no hay hueco antes de la etapa. Lee **`tmc_agenda_historial`**, el de la agenda, no el
  de «Servicios». Lo anterior a la primera pasada de ese historial no se conoce ni se
  reconstruye (D8): quien volvió de standby antes no cuenta como vuelto.
- **`asignar(db, fuente, {numero, etapa, puesto, motivo?}, actor, hoy)`** — permiso
  `agenda.asignar`. 400 en `puesto` si la etapa no tiene ese puesto; 409 `puesto_ocupado`; 409
  `ticket_con_puesto`; 409 `ticket_fuera_de_etapa` si el ticket no está en un **estado de esa
  etapa** según la fuente (fila de entrada, standby, otra etapa o desconocido). **«El primero de
  la fila» es el primero que ya está en la etapa**: a cualquier otro se le exige `motivo` (400), y
  en `sugerido` queda a quién se saltó. `inicio` = hoy o el siguiente día hábil (D16).
- **`proponerRepartoInicial`** (no escribe; `proponerReparto` en `agenda.ts`) y
  **`confirmarRepartoInicial(db, fuente, lineas, actor, hoy)`** — permiso `agenda.reparto` (D6):
  los puestos libres de cada etapa, por número, para los que ya están en la etapa en el orden de
  su fila; lo que no cabe queda en la fila. Confirmar acepta la propuesta o una ajustada, sin
  motivo; sólo rellena puestos libres; `inicio` = la llegada exacta al estado si consta, o hoy.
  **Todo o nada**, en una transacción.
- **`liberar(db, {numero, motivo}, actor)`** — permiso `agenda.liberar` (D7): cierra la vigente
  con `cierre = 'manual'`, motivo obligatorio (400) y firma; 404 si no tiene puesto.
- **`marcarFlujo(db, fuente, numero, flujo | null, actor)`** — permiso `agenda.flujo` (D11): sólo
  el ticket que la fuente trae abierto (404) y **sin clasificación** (409 `flujo_de_la_fuente`);
  `null` quita la marca, siempre. Una marca de un ticket que ahora trae clasificación no se aplica.
- **Los permisos no se miran en `repo.ts`**: los mira `escritura('<permiso>', …)` en `router.ts`.
- **Dos a la vez**: la última palabra la tienen los dos índices únicos parciales; quien llega
  segundo recibe el 409 y su transacción se deshace entera. El 409 de un puesto ocupado **dice
  cuál** (etapa y número), venga de la proyección o del índice.

**El reparto inicial sólo rellena puestos libres; nunca reemplaza una asignación (D19).** Para
mover a alguien: liberar y asignar. Por eso `cierre = 'reparto'` («reemplazada por un reparto»)
está en el `CHECK` de la 052 **reservado y sin uso**: ningún código lo escribe.

### La pasada de la agenda: su historial y el cierre automático (lote 4b, D17)

**Dos historiales, uno por fuente.** «Servicios» lee sus tickets de la réplica y su historial
(`tmc_estados_historial`, `registrarEstados`) sigue **exactamente como estaba**. La agenda lee de
la fuente principal y lleva el suyo, `tmc_agenda_historial`. Unificarlos es un lote posterior
(sección J del documento, lote 8).

- **`registrarEstadosAgenda(db, fuente)`** (`repo.ts`) → `{fuente, abiertos, cerrados,
  asignacionesCerradas}`. En una transacción: coge **su** bloqueo
  (`hashtext('portal.tmc_agenda_historial')`, distinto del de `registrarEstados`), lee la fuente
  (`abiertosConOrigen`) y, **si no contestó la principal, termina sin escribir nada**: ni sin
  `DESK2_DB_URL` ni con Desk 2.0 caído se apunta ni se cierra nada, y una lectura de la réplica
  nunca se toma por «todos cerrados». Con la principal, apunta los tramos con las reglas de
  `registrarEstados` y, con el mismo instante, **cierra las asignaciones** cuyo ticket ya no está
  en un estado de la etapa de su puesto (`cierre = 'estado'`, sin motivo ni firma): pasó a
  standby, a fin de taller, a otra etapa o a un estado sin categoría, o ya no viene entre los
  abiertos. Cambiar de estado dentro de la etapa no cierra.
- **Primer arranque**: la primera pasada apunta cada ticket como primera observación
  (`desde_real` FALSE). No inventa cambios ni vueltas de standby, y no cierra una asignación
  recién hecha (el cierre mira el estado de ahora, no el historial).
- **Cuándo sale** (`registro-estados.ts`): en el programador de 5 minutos, en el mismo turno que
  la de «Servicios» pero por **otra puerta**, `registrarAgendaSinFallar(db, tarea, {forzar?})`,
  con su propia «una sola a la vez» y su propia frescura de 30 s. Ninguna espera a la otra y el
  fallo de una no toca a la otra (sus errores salen como `tmc_registrar_agenda`). La enciende
  `index.ts` con la opción `agenda` de `iniciarRegistroEstados`; sin esa opción el programador
  es el de siempre. **`GET /servicios` no la dispara.** Además sale **a demanda** (D20), por la
  misma puerta (`agendaAlDia`, que dice si salió bien): antes de servir `GET /agenda` y antes de
  asignar, confirmar el reparto o liberar (ver «Agenda: API»).
- ⚠️ **El desfase que queda**: entre el cambio de estado y la pasada siguiente, la asignación
  sigue vigente en la tabla. La proyección ya no la cuenta y da su puesto por libre, pero ni ese
  puesto ni ese ticket se pueden asignar (409) hasta que una pasada la cierre o se libere a
  mano. Con la pasada a demanda eso dura como mucho los 30 s de frescura (no 5 minutos), salvo
  que la pasada falle o la agenda esté en respaldo.
- ⚠️ **Sin `DESK2_DB_URL`** la agenda funciona en respaldo, pero su historial no crece y nada se
  cierra solo: sólo queda liberar a mano.
- La fuente se lee con el bloqueo ya cogido (dos pasadas a la vez no pueden escribir una lectura
  vieja sobre una nueva): mientras la principal tarda en fallar, la pasada retiene una conexión
  de la base del portal, y nada más.

## Agenda: API

Lote 5 (`docs/trazabilidad-agenda-taller.md`, D18 a D20 y sección E.7): las rutas de la tabla
«Agenda del taller» de la API, en `router.ts`. Las llaman las pantallas de los lotes 6 y 7.

- **Pasada a demanda (D20)**: `GET /agenda`, `POST /agenda/reparto`, `POST /agenda/asignaciones` y
  `POST /agenda/liberar` lanzan antes la pasada de la agenda (`ponerAlDia` → `agendaAlDia` →
  `registrarEstadosAgenda`), salvo que haya una buena de hace menos de 30 s (`FRESCURA_MS`). En
  una escritura va **después** del permiso y de validar el cuerpo. Mismo patrón que «Servicios»:
  **si falla, la petición no falla**; sigue con lo que haya, el error va al registro
  (`tmc_registrar_agenda`) y la respuesta lleva el aviso `pasada_fallida`. No la lanzan la
  propuesta de reparto, los huecos, el flujo ni la configuración.
- **Lo que cambia la agenda devuelve la agenda** (una petición menos por acción; hub-api limita a
  60 por minuto y por IP toda `/api`).
- **`hoy`**: en los `GET`, `?hoy=AAAA-MM-DD` como en el resto de la app, y además tiene que ser
  un día que exista (`hoyAgenda`; 400 con `2026-02-30`). No tiene tope de rango. **Las
  escrituras no lo aceptan**: usan siempre el día de hoy en Colombia, porque de él sale el
  `inicio` que se guarda.
- **Reparto inicial (D19)**: sólo rellena puestos libres. **Liberar (D18)**: por número de ticket.
- **Huecos** (`huecosDeEtapa`, `agenda.ts`): un equipo que llegara hoy va detrás de toda la fila
  de la etapa y de los equipos nuevos encadenados; los 5 huecos son sucesivos (cada uno supone
  ocupados los anteriores durante la duración de ese tipo). Es una previsión, no una reserva:
  nada se guarda.
- **Configuración**: `ticketsAbiertos` de cada estado se cuenta en la fuente de la agenda (la
  de `GET /estados`, en la réplica): pueden no coincidir.
- ⚠️ **Nada de esto lleva clientes, seriales ni correos**, y de un fallo de Desk 2.0 sólo sale
  el motivo: `router.test.ts` vigila las dos cosas.

## Agenda: pantalla de configuración

Lote 6 (`docs/trazabilidad-agenda-taller.md`, sección J). En «Administración» → «Configuración»,
debajo de los plazos. La **pantalla de la agenda** (lote 7) va en «Agenda: pantalla». Todo pide
`config.write`; sin él se ve igual, en consulta.

- **«Agenda del taller · Puestos»**: una fila por etapa con sus puestos (0 a 50), los **tickets
  que están hoy en un estado de esa etapa** (tengan puesto o no; `ticketsPorEtapa` sobre
  `estados`, en ámbar si pasan de los puestos) y la firma. Guarda al salir de la casilla o con
  Intro; Escape deshace lo escrito.
- **«Duraciones (días hábiles)»**: etapas × tipos. Columnas (`columnasDuraciones`): la «*», los
  tipos de `GET /plazos`, los de `tiposAbiertos` y los de duraciones ya guardadas que no estén en
  ninguno (para poder quitarlas). Casilla vacía = hereda la «*» de su etapa, que se ve en gris
  (`celdaDuracion`); escribir crea la fila, vaciar la quita, y la «*» no se puede vaciar (no se
  envía: la casilla queda en rojo). La firma de cada casilla va en su `title`.
- **«Estados de Desk → agenda»**, junto a **«Estados de Desk → reloj del plazo»** (el bloque de
  siempre, con otro título y ya con su firma a la vista): categoría, etapa (sólo si es activa),
  tickets abiertos en la fuente de la agenda y la firma de la categoría («semilla» si la puso la
  050). Filtro «Sólo estados con tickets», encendido de partida; los estados **sin categoría
  salen siempre y arriba**, con un aviso ámbar. Elegir «Etapa activa» **no guarda hasta elegir
  la etapa** (una sin la otra es un 400). Cada bloque guarda por su ruta y no recarga al otro.
- **Los cambios van en fila** (`useAgendaConfig`): cada respuesta trae la configuración entera y
  dos a la vez podrían pisarse.
- **Fechas**: las firmas son instantes (`…::text`, «2026-10-07 01:10:00+00»). `fmtFecha` da su
  día y `fmtFechaHora` su día y hora **en Colombia** (UTC−5 fijo), con aritmética sobre UTC: no
  dependen de la zona del navegador. Un día suelto («2026-10-07») no se mueve.

**Pulido del lote 7**: el bloque del reloj tiene el mismo filtro «Sólo estados con tickets»
(`estadosReloj`), encendido de partida; una duración heredada se ve en gris y cursiva y dice
«(por defecto)» debajo, también en consulta; y todas las tarjetas ocupan el mismo ancho.

## Agenda: pantalla

Lote 7 (`docs/trazabilidad-agenda-taller.md`, secciones G y J). «Taller» → «Agenda del taller»
(`#agenda`). **Sólo pinta**: todo llega calculado de `GET /trazabilidad/agenda`.

- **Lo que el servidor añadió para ella (sólo lectura, sin rutas ni migraciones nuevas)**:
  - `tickets[]` (`detallesDeTickets`, `agenda.ts`, pura): la ficha de cada abierto. `tipo` es el
    efectivo (el puesto a mano, con su etiqueta, gana) y `tipoManual` lo dice; `flujoOrigen` es
    `clasificacion` (lo trae la fuente: no se puede marcar), `manual`, `deducido` (respaldo) o
    `defecto`; `ultimaTransicion: {en, origen}` es la transición de la fuente (`fuente`) o, sin
    ella, el tramo abierto de `tmc_agenda_historial` (`historial` si fue un cambio visto,
    `primera_observacion` si no). `proyectarAgenda` sigue sin asuntos: van aparte.
  - `eje` (`ejeAgenda`, `agenda-calendario.ts`): desde hace `EJE_HABILES_ATRAS` (3) días hábiles
    hasta `EJE_DIAS_ADELANTE` (28) días después de hoy, con sus festivos y cierres de empresa.
  - `finPlanificado` en cada puesto: el fin que le daba su duración; de ahí a hoy va el retraso.
- **Refresco**: sola cada 2 minutos (`REFRESCO_MS`) y **sólo con la pestaña visible**
  (`tocaRefrescar`); un reloj local mira cada 10 s si toca, sin pedir nada. hub-api limita a 60
  peticiones por minuto y por IP: no bajar ese intervalo.
- **Calendario** (`AgendaGantt.tsx`): una fila por puesto, agrupadas por etapa; posiciones en
  porcentaje del eje (mínimo 26 px por día; por debajo, desplazamiento dentro de su caja). **Las
  barras van de la mitad del día de entrada a la mitad del de salida** (`franja`): el día de
  inicio no cuenta en la duración y el día en que sale uno entra el siguiente, así que no se
  pisan; la línea de hoy va también a mitad de columna. Ocupante: transcurrido en sólido, lo que
  falta en claro y el retraso rayado en rojo, con «pasado de fecha» escrito; previstos (fila y
  encadenados) en contorno discontinuo y con «previsto». Cada barra abre la ficha y lleva todo
  el detalle en su `title`.
- **Por debajo de 640 px** no hay calendario: `ListaDias` (`listaPorDias`), por días y por etapa.
- **Acciones** (`AgendaAcciones.tsx`, `useAccionesAgenda`), cada una sólo con su permiso:
  «Proponer reparto inicial» (`agenda.reparto`, si hay puestos libres y asignables: diálogo
  editable, `lineasDeReparto` / `cambiarLinea`; ante un fallo —el 409— lo explica y vuelve a
  pedir agenda y propuesta); «Asignar» en la fila (`agenda.asignar`: el primero asignable, con un
  clic al puesto libre de número menor; cualquier otro, diálogo con puesto y motivo); «Liberar
  puesto» (`agenda.liberar`: junto al nombre del puesto y en la ficha; el diálogo con motivo es
  la confirmación); «Marcar flujo» (`agenda.flujo`: en la ficha, sólo si `flujoOrigen` no es
  `clasificacion`). **Toda escritura pone la agenda que devuelve**, sin pedirla otra vez.
- ⚠️ **El flujo sólo mueve a quien está en la fila de entrada**: un ticket que ya está en un
  estado de una etapa se queda en ella aunque se le marque «equipo nuevo» (manda el estado).
- **No se usan `alert` / `confirm` / `prompt`** del navegador.

## F-ST-022: congelación y relevo de la Excel

**Estado: la hoja está congelada y la Excel ya no se sube** (ni importar ni volver a congelar).

**Decisiones de Alfonso (09/10/2026).** La Excel F-ST-022 **deja de ser la fuente**: se congela su
contenido de hoy y, por lotes, la releva el portal.

- La congelación cubre **toda la hoja**: todas las marcas, no sólo GRIMM EDM 180.
- `desk.equipos` de Desk 2.0 se acepta como **maestro de equipos** (se mantiene a mano allí; el
  serial no es único; hay borrado físico).
- La fecha de calibración saldrá del campo de Zoho «Fecha de Calibración»
  (`cf_fecha_de_calibracion`, que se promoverá a columna en Desk 2.0). **Una corrección manual
  manda sobre la fecha de Desk hasta que cambie la de ese ticket en Zoho.**
- Exportar: la misma información en las mismas columnas, **sin calco visual**.

**Decisiones de Alfonso (10/10/2026).**

- **Se congeló la V3**, «F-ST-022 Trazabilidad Mttos Clientes V3.xlsx», una Excel ya limpia: es
  **el punto de partida firmado**. No la V2.
- **Se retira toda subida de Excel**: ni la importación de siempre ni la congelación. **Sin
  re-congelación**: se ofreció dejar «Volver a congelar» sólo a administradores y se descartó.
- Motivo añadido: importar la V3 habría puesto a NULL `hoja_vida`, `ultima_entrada`,
  `fecha_factura` y los recuentos de `tmc_equipos` (la V3 no trae esas columnas) y habría tomado
  «calibraciones / correctivos del periodo» por posición, de las columnas de Serial y Modelo.

### Lo congelado: la V3

Una sola hoja, «Trazabilidad»: bloque de título en las filas 1 a 3, **cabecera en la fila 5** y
**seis columnas**: Cliente · Marca · Modelo · Serial · Última Calibración · Vigencia de Calibración
(Dias). En producción: 371 filas × 6 columnas, 366 filas de equipo (todas con serial), 116 GRIMM
EDM 180, 2 «otras filas», y dos avisos: 6 filas con un serial que se repite y 2 con el serial
numérico largo (14 cifras, íntegro: Excel sólo lo *muestra* en notación científica).

- **Cómo quedó guardada** (tablas `tmc_fst022_*`, arriba): la hoja entera y **tal cual**, sin
  arreglar nada. De «Vigencia» (una fórmula) se guardó el último valor calculado, que depende del
  día en que se guardó el fichero. Una fecha va como `{v: 'AAAA-MM-DD', t: 'fecha'}`.
- **Lo que se derivó al congelar** (ya no hay código que lo haga): fila de equipo = bajo la
  cabecera, con algo en cliente, marca, modelo o serial; `serial_norm`; `clave_equipo` con las
  reglas de la importación; y los «avisos» (`problemas`), recuentos de filas de equipo que nunca
  bloquearon nada. Sus claves son datos guardados (`serial_cientifico` incluido): no se renombran;
  lo que se corrigió es su rótulo (`ETIQUETA_PROBLEMA`, `src/lib/origen.ts`).
- *Nota histórica*: la V2, la hoja de trabajo de antes, tenía tres filas de títulos con celdas
  combinadas y 14 columnas (hoja de vida con hipervínculo, última entrada, días, mantenimientos
  del periodo, dos columnas sin título…), datos sucios y un pie de totales. Para ella se hicieron
  el lector del navegador y las reglas del lote 9a; no se llegó a congelar en producción.

### Qué queda en la app (lote 9a + retirada)

- **Nadie sube nada.** No hay botón «Importar F-ST-022», ni diálogo, ni ningún selector de
  fichero; el lector del navegador (`src/lib/importar.ts`) y todo el código que importaba o
  congelaba en el servidor se borraron. Las dos rutas contestan **410** (tabla de la API).
- **La congelación se ve, en sólo lectura y para cualquiera con la app**: tarjeta «Origen de los
  datos · F-ST-022 congelada», al final de «Configuración» (`OrigenDatos.tsx`): archivo, hoja,
  fila de la cabecera, quién y cuándo, sha256 abreviado (el entero en su `title`), los recuentos
  y los avisos, y las anteriores si las hubiera. Sin congelación lo dice en ámbar, sin ofrecer
  subir nada. **Sólo recuentos**: ningún cliente ni serial.
- **Cabecera de la app**: «… · F-ST-022 congelada el 10/10/2026 desde «archivo» por quien»
  (`textoOrigen`; el día, en Colombia). Antes decía la última importación. Sin congelación, o si
  la lista no llega, no dice nada.
- ⚠️ **El inventario sigue siendo `tmc_equipos`**, que ya nadie escribe: es el de la última
  importación que se hizo (anterior a la V3) y **no** se rellenó desde la congelación. Hasta el
  9b, la cabecera habla del origen firmado, no de qué fichero llenó esa tabla.
- **`xlsx` (SheetJS) quedó sin uso en esta app**; sigue en su `package.json` hasta que el lote de
  exportar decida.

### Congelar un entorno nuevo

Ya no hay ruta. Un entorno sin congelación funciona (la tarjeta lo dice y la cabecera calla). Si
hiciera falta una: (a) copiar por SQL las filas de `tmc_fst022_congelaciones` y
`tmc_fst022_congelada` desde un entorno que la tenga (primero la congelación, por la clave
foránea); o (b) recuperar del historial de git el lector y la ruta (`233c340`, el merge del 9a),
congelar en una rama o en local y llevar el resultado por SQL. La ruta **no** se vuelve a
desplegar: `router.test.ts` tiene un candado que lo impide.

### Lo que viene (no construido)

- **9b · maestro de equipos**: el inventario sale de `desk.equipos` (Desk 2.0) en vez de
  `tmc_equipos`, cruzado con la congelada por `serial_norm`.
- **9c · fechas de calibración**: de `cf_fecha_de_calibracion` de los tickets, con la corrección
  manual por encima (tabla propia de calibraciones; el permiso `calibraciones.write` ya existe).
- **9d · pestaña «Trazabilidad F-ST-022»**: la hoja en el portal, editable, con **las seis
  columnas de la V3** (la vigencia, calculada), sobre la congelada y lo que aporten 9b y 9c.
- **9e · «Exportar F-ST-022»**: un .xlsx con **esas seis columnas** en su orden (las `cabeceras`
  guardadas lo dan), sin calco visual. Es el lote que decide qué hacer con `xlsx`.

## Pruebas

- `npm test --workspace=apps/trazabilidad-mantenimientos` — agregados, aviso,
  lo que calcula la pantalla de la agenda (`src/lib/agendaTaller.test.ts`: eje, barras, resumen,
  lista por días, textos, reparto editable y refresco, sin reloj ni zona de la máquina),
  las fechas en hora de Colombia (`src/lib/vistas.test.ts`), lo que calcula la configuración de
  la agenda (`src/lib/agenda.test.ts`),
  geometría del calendario de barras (pausas y marca de fin incluidas) y la simulación (texto por
  tramo, saludo, resumen y correos tecleados: `src/lib/simulacion.test.ts`), y la navegación en
  dos niveles con lo que se enseña según el rol (`src/lib/navegacion.test.ts`). Las vistas no
  tienen pruebas de componente: lo que ocultan o desactivan se revisa en el navegador.
- `npm test --workspace=apps/hub-api` — dominio, el plan del aviso y los contactos
  (`avisos.test.ts`), plazos (el reloj con pausas, con `hoy` y los tramos como argumentos), la
  matriz de roles entera (`roles.test.ts`), las reglas de la configuración de la agenda y las
  guardas de las migraciones 050 y 051 (`agenda-config.test.ts`), las de la 052 y la 053 y la de
  cuál es la última migración apuntada en `db.ts` (`agenda-asignaciones.test.ts`), la proyección
  de la agenda (`agenda.test.ts`: el ejemplo H como prueba dorada, los casos frontera de la
  sección F, D16, `vuelvenDeStandby`, `proponerReparto` y las propiedades —misma entrada, misma
  salida; ningún ticket dos veces; las listas suman el total— sobre casos generados con
  semilla), router (401, 403 sin la app, 403 por rol en cada
  escritura, Lector por defecto, administrador con todo, y la API de roles) y el programador con
  reloj de mentira (`src/trazabilidad/*.test.ts`).
- `npm run test:db` en hub-api — `trazabilidad.db.test.ts` contra Postgres real: `registrarEstados`
  (también con llamadas a la vez), «Servicios» de punta a punta con un historial sembrado y `hoy`
  fijo, el contacto de cada equipo (Desk y puesto a mano), el orden del cliente en «Servicios» y
  los roles (la 049 aplicada varias veces sin tocar lo repartido, el `CHECK`, la clave foránea y
  la lista de la sección «Roles»). `fuente.db.test.ts` prueba la fuente de la agenda contra una
  imitación de la base de Desk 2.0 (`asegurarDesk2` en `src/test-db/harness.ts`: otra base del
  mismo contenedor, con sólo las columnas que se leen y un rol de sólo lectura): el SQL de las
  dos fuentes, que una escritura por ese pool falla, que el tope de tiempo corta y la caída al
  respaldo con fallos de verdad. Lo mismo con bases de mentira, en `fuente.test.ts`, y el pool
  opcional en `src/db-desk2.test.ts`. `agenda-config.db.test.ts` prueba la configuración de la
  agenda: la 050 y la 051 ejecutadas varias veces (también sobre una tabla como la de antes de
  la 050, con roles ya elegidos) sin pisar lo elegido ni tocar el rol del reloj, los `CHECK` y
  el SQL de leer y guardar. `agenda-asignaciones.db.test.ts` prueba el lote 4a con la imitación
  de Desk 2.0 como fuente principal: la 052 y la 053 repetidas, los índices únicos y los `CHECK`,
  asignar (puesto ocupado, motivo, ticket fuera de la etapa, dos peticiones a la vez), el reparto
  inicial todo o nada (también cuando lo que falla es la base), liberar, el flujo a mano y
  `leerAgenda` en principal y en respaldo. `agenda-historial.db.test.ts` prueba la pasada de la
  agenda: la 054 repetida, el primer arranque, el cierre automático (a standby, a fin de taller,
  a otra etapa, cerrado o desaparecido; no dentro de la etapa), que no escribe sin la variable
  ni con la principal caída mientras «Servicios» sigue apuntando, varias pasadas a la vez y que
  los dos bloqueos son independientes. El programador con las dos pasadas, sin base, en
  `registro-agenda.test.ts`. `agenda-api.db.test.ts` recorre el lote 5 de punta a punta, con las
  rutas de verdad sobre la base de pruebas y la imitación de Desk 2.0 (sólo la sesión es un
  doble): leer → repartir → asignar → cambio de estado en la imitación → pasada a demanda → la
  asignación se cierra → la agenda lo refleja; liberar, D19, el Lector sin permiso, el flujo, la
  configuración (categoría y rol sin pisarse) y el cortacircuitos con una principal caída de
  verdad. Sin base, en `router.test.ts`: cada ruta de la agenda con su 401, su 403 sin la app,
  su 403 por rol, sus 400, 404 y 409, la pasada a demanda (antes de leer, sin repetirse, y el
  aviso si falla) y la guarda de permisos ruta a ruta; el cortacircuitos, con reloj inyectado,
  en `fuente.test.ts`; y los huecos, en `agenda.test.ts`.
- La F-ST-022 congelada y la subida retirada: en la app, `src/lib/origen.test.ts` (la línea de la cabecera, los recuentos de
  la tarjeta y los rótulos de los avisos); en hub-api, `fst022.test.ts` (guardas de la 055, última migración y que ningún fuente
  escribe en `tmc_fst022_*`), `router.test.ts` (410 en las dos rutas para Lector, Director Técnico y administrador, 401, 403 sin
  la app, que las lecturas siguen, y el candado contra una ruta que vuelva a aceptar un fichero) y `fst022.db.test.ts` (la 055
  repetida, los `CHECK`, las lecturas sobre una congelación **sembrada por SQL con la forma de la V3** y que los 410 dejan la base
  como estaba). `trazabilidad.db.test.ts` siembra el inventario a mano (`sembrar`, con `asignarClaves`): ya no hay `repo.importar`.
- Datos de prueba siempre ficticios (el repo es público): «Cliente Uno», seriales `18A00001`,
  correos en `@example.com` / `@cliente-uno.example`.
