# Análisis — Agenda del taller (app Trazabilidad Mantenimientos Clientes)

Fase 1, solo análisis. No cambia código, migraciones ni configuración. Fecha de los datos: **06/10/2026**.

Convenciones de este documento:

- Cada afirmación lleva ruta y línea, la referencia a una consulta (`Z1`…`Z11` en la base `zoho-hub`; `D1`…`D10` y `P1`…`P7` en la base `desk`; todas ejecutadas el 06/10/2026 en modo solo lectura) o la palabra **hipótesis**.
- Las rutas que empiezan por `Desk2:` son del repositorio de Desk 2.0 (`C:\dev\Desk_2_R1.023`, HEAD `b14cd0f`), que solo se leyó. El resto son de este repositorio.
- No hay nombres de clientes, seriales ni correos: solo números de ticket, estados y recuentos. El repositorio es público.
- «Desk 2.0» es la aplicación y su base `desk`; «la réplica» es `desk.tickets` de la base `zoho-hub`, la que el portal lee hoy.

## Objetivo

Una **agenda del taller**: ver en calendario los tickets activos, cuándo terminará cada uno su etapa y en qué hueco entrará cada ticket que espera, para acomodar los servicios y, más adelante, permitir que el cliente reserve.

## Reglas de negocio

Decididas por Gerencia antes de este análisis:

1. Capacidad = puestos simultáneos por etapa, configurables en la app.
2. Cada estado pertenece a una categoría: fila de entrada, etapa activa (Diagnóstico, Proceso, Verificación), standby o fin de taller. Configurable, apoyado en `tmc_estados_desk`.
3. Un ticket ocupa puesto solo en una etapa activa con puesto asignado. Standby y fin de taller liberan el puesto.
4. Fila de la primera etapa en orden de la remisión de entrada; etapas siguientes y salidas de standby, al final de la fila.
5. Asignación «FIFO sugerido + confirmar»; la asignación es de la app y se cierra sola cuando el estado sale de la etapa.
6. Duración en días hábiles por etapa y tipo de servicio. Un ticket pasado de su fin estimado sigue ocupando y empuja la fila: se asume que sale el día hábil siguiente.
7. Proyección por etapa repartiendo la fila FIFO. Los tickets en standby no se proyectan.

### DECIDIDO el 06/10/2026

| | Decisión |
|---|---|
| **D1** | **Fila = FIFO con prioridad, y la prioridad solo sale de Desk 2.0** (criterio de `Desk2:packages/shared/src/prioridad.ts`). El `High` / `Low` que viene de Zoho no se usa. Mientras no haya prioridades fijadas en Desk 2.0, la fila es FIFO puro. |
| **D2** | **«Notificado» sigue ocupando el puesto**: es parte de la etapa Diagnóstico (revisión interna del Director Técnico). Solo liberan los standby que dependen del cliente, de Comercial o de terceros. |
| **D3** | **Calendario de la agenda** = días hábiles con festivos de Colombia (`apps/hub-api/src/trazabilidad/plazos.ts`) menos los cierres de empresa de Desk 2.0 (`public.calendario_cierres`). Con la réplica de respaldo no se descuentan cierres y la pantalla lo avisa. No se usan horas hábiles. |
| **D4** | **La agenda lee de la base `desk` de Desk 2.0** por una conexión de solo lectura: variable `DESK2_DB_URL` y rol `portal_agenda_reader`. El rol lo crea Gerencia, con `SELECT` sobre `desk.tickets`, `desk.ticket_transitions`, `desk.ticket_history`, `public.remisiones` y `public.calendario_cierres`, y `default_transaction_read_only = on`. Motivo: es una copia de Zoho más completa y al día que la réplica del portal; leerla no cambia dónde se trabaja, que sigue siendo Zoho Desk. **La réplica queda de respaldo** detrás del mismo adaptador: sin la variable, o si la conexión falla, la agenda usa la réplica y lo avisa. El cruce entre las dos es por número de ticket. |
| **D5** | **«Por Facturar» y «Por Entregar» pasan a papel «terminado»** en `tmc_estados_desk`. Lo cambia Gerencia desde Configuración. |
| **D6** | **Arranque con «Proponer reparto inicial».** La app reparte por orden de llegada en los puestos libres de cada etapa y el Director Técnico confirma todo de una vez o ajusta. Lo que no cabe queda en la fila. |
| **D7** | **El Director Técnico puede liberar un puesto a mano**; queda registrado quién y por qué. La marca «sin confirmar» por ticket que acompañaba a esta decisión queda sustituida por D13. |
| **D8** | **No se reconstruyen llegadas pasadas.** Se usa el orden aproximado y el reordenado del Director Técnico en el arranque. Ampliada por D12 para la fila de entrada. |
| **D9** | **Sin tipo de servicio → duración por defecto de la etapa** (fila «*») y marca «sin tipo». El tipo puesto a mano (`tmc_servicios_tipo`) sigue valiendo y gana. |
| **D10** | **«Pendiente» y «Solicitud Soporte»** (soporte remoto) quedan fuera de la agenda. |
| **D11** | **Flujo de equipo nuevo = `classification` de Desk 2.0.** Con la réplica de respaldo se deduce del asunto («Equipo Nuevo») o del prefijo `HV_` del código, y se puede marcar a mano por ticket. |
| **D12** | **El orden de llegada de la fila de entrada es `fecha_remision_entrada`** (Desk 2.0). Con el mismo día, va primero el que tenga llegada exacta en `desk.ticket_transitions` y, si no, el de número más bajo. Sin fecha, el ticket va al final de la fila con la marca «falta fecha de remisión», para que alguien la complete en Zoho. Gerencia confirma que en los tickets en «Ingresado» sin fecha el equipo sí llegó: falta escribirla. En la réplica de respaldo se aplica la misma regla si trae el campo y, si no, la de D8. Las filas de las etapas siguientes y la vuelta de standby no cambian: van al final por el momento de entrada en el estado. |
| **D13** | **Ningún ticket lleva la marca «sin confirmar».** En su lugar hay un aviso global en la agenda cuando la sincronización entera parece parada: cuando el máximo de `synced_at` de la base de la fuente tiene más de 1 hora. El umbral va en una constante. |
| **D14** | **El «jefe de taller» de la agenda es el Director Técnico** (rol `DIRECTOR_TECNICO`). También configura puestos y duraciones. |

### DECIDIDO el 07/10/2026

| | Decisión |
|---|---|
| **D15** | **La prioridad (D1) adelanta al ticket por delante de TODA su fila**, no dentro de su grupo: un ticket con prioridad fijada en Desk 2.0 va delante de todos los que no la tienen, también si él vuelve de standby o viene de una etapa siguiente y los otros son de la primera etapa. Es lo que ya hacía el código del lote 3; F.3 decía otra cosa y queda corregida. |
| **D16** | **Ninguna fecha prevista de entrada ni de inicio cae en un día no hábil** (fin de semana, festivo o cierre de empresa). Si «hoy» no es hábil, lo primero que se proyecta es el siguiente día hábil. Vale también para el día desde el que cuenta la duración de una asignación. |
| **D17** | **Un historial de estados por fuente.** `tmc_estados_historial` sigue exactamente como estaba, alimentado desde la réplica, y es el de «Servicios». La agenda lleva el suyo (`tmc_agenda_historial`, migración 054), alimentado desde la fuente principal, que **no apunta nada mientras la agenda esté en respaldo**. En esa misma pasada se cierran solas las asignaciones cuyo ticket salió de su etapa. Las dos pasadas no se pisan: cada una con su bloqueo, y si la principal falla solo se salta la de la agenda. Sustituye a lo que B.5 pedía en un principio (un único historial pasado a la principal), que dejaba incoherente a «Servicios». Unificar los dos historiales queda para un lote posterior (sección J, lote 8). |
| **D18** | **Liberar un puesto va por NÚMERO DE TICKET**, no por el identificador de la asignación: como mucho hay una asignación vigente por ticket (índice único de E.3), así que el número basta y es lo que la pantalla tiene a mano. Corrige la sección E.7, que decía `DELETE /agenda/asignaciones/:id`. |
| **D19** | **El reparto inicial solo rellena puestos libres; nunca reemplaza una asignación.** Para mover a alguien: liberar y asignar. El cierre `'reparto'` («reemplazada por un reparto») queda en el `CHECK` de la 052 **reservado y sin uso**: ningún código lo escribe. |
| **D20** | **Pasada de la agenda a demanda.** Antes de servir la agenda y antes de cualquier escritura de asignación (asignar, confirmar el reparto, liberar) se lanza la pasada de la agenda (`registrarEstadosAgenda`), salvo que haya habido una buena hace menos de 30 s. Mismo patrón que «Servicios»: un fallo de la pasada no hace fallar la petición; se sirve lo que haya y se avisa (`pasada_fallida`). |

Ajustes decididos el 06/10/2026:

- **Clasificación propia de la agenda.** La categoría de un estado en la agenda es independiente de la clasificación de esperas y SLA de Desk 2.0, porque sirven para cosas distintas. «Por Entregar» es fin de taller y libera el puesto, aunque Desk 2.0 lo trate como espera externa (`Desk2:packages/shared/src/estados.ts:59-106`). Es una diferencia documentada, no un conflicto.
- **Orden aproximado.** Cuando la llegada de un ticket no es exacta o hay empate, se ordena por número de ticket y la pantalla lo marca como «orden aproximado».

---

## A. Remisiones de entrada de Desk 2.0

### A.1 Dónde están

- **Otra base, en otro servicio.** Desk 2.0 usa la base `desk` del servicio `desk-db`; el portal lee la base `zoho-hub` del servicio `zoho-hub-db` (`Desk2:DEPLOY.md:22-36`). Verificado: en el servidor de Desk 2.0 la base se llama `desk` y las tablas de tickets están en el esquema `desk` (D1); en el servidor del hub esa base no existe (comprobado el 06/10/2026 al intentar conectarse).
- **No hay réplica hacia el portal.** Solo cuatro tablas se replican, y en sentido hub → desk (`Desk2:DEPLOY.md:38-42`). `zoho-hub` tiene las tablas `public.remisiones` y `public.calendario_cierres` porque ejecuta el mismo esquema (Z11), pero sin datos de la app: `desk.ticket_transitions` tiene 0 filas allí (Z10).
- **Tabla:** `public.remisiones` de la base `desk` (`Desk2:packages/zoho-sync/src/db/schema.sql:271-287`). Sin CHECK ni claves foráneas; un ticket puede tener varias remisiones (único índice: `idx_remisiones_ticket`, `schema.sql:288`).

### A.2 Columnas que importan

| Columna | Tipo | Significado | Ref. |
|---|---|---|---|
| `id` | `text` PK | `rem-<uuid>` en las de la app; hash en las históricas | `schema.sql:272` |
| `ticket_id` | `text`, admite NULL | Enlace al ticket por **id**, no por número | `schema.sql:273`, `Desk2:apps/desk/server/db/remisiones.ts:100` |
| `tipo` | `text`, por defecto `'entrada'` | Solo existe `'entrada'`; la de salida está en hoja de ruta | `Desk2:packages/shared/src/types.ts:505` |
| `fecha` | `date` | Fecha del servicio | `schema.sql:275` |
| `estado` | `text`, por defecto `'pendiente'` | `pendiente` / `ok` / `ok_con_avisos` / `error` | `Desk2:packages/shared/src/remision.ts:60` |
| `created_at` | `timestamptz` | Momento de creación. En las históricas es `fecha + 12 h`, no un instante real | `schema.sql:286`, `:320` |
| `origen` | `text`, por defecto `'app'` | `'app'` o `'historico'` | `schema.sql:313` |
| `anulada_at`, `anulada_por` | `timestamptz`, `text` | Anulación | `schema.sql:316-317` |

Estados de la remisión (`Desk2:packages/shared/src/remision.ts:60`, `:78-83`): `pendiente` (creada o enviándose), `ok` (documento creado), `ok_con_avisos` (documento creado, falló un aviso; cuenta como éxito), `error` (no hay documento).

Dos definiciones de «remisión válida» conviven en Desk 2.0:

- **Vigente** (la que exige «Habilitar Servicio»): `tipo = 'entrada'` y no anulada, sea cual sea el estado (`remision.ts:121-128`).
- **Confirmada** (la que mueve el ticket a «Remisión creada»): no anulada y `estado IN ('ok','ok_con_avisos')` (`Desk2:apps/desk/server/db/estadoPorRemision.ts:43-46`).

### A.3 El «momento de entrada» que usa `ordenarPorEntrada`

**No es la fecha de la remisión.** `ordenarPorEntrada` (`Desk2:packages/shared/src/listaPorEntrada.ts:10-16`) ordena por `enEstadoDesde` ascendente; los nulos van al final; desempata el número de ticket; la prioridad no interviene (`:5`).

`enEstadoDesde` es el `performed_at` de la última fila de `desk.ticket_transitions` cuyo `to_status` coincide con el estado actual del ticket (`Desk2:apps/desk/server/db/sla.ts:78-102`). Para «Remisión creada», esa fila se escribe cuando n8n confirma el documento (`Desk2:apps/desk/server/routes/remision.ts:364-374`). Anular y restaurar la remisión reinicia el turno, porque gana la última entrada.

La agenda usa esa definición de llegada (el instante de entrada en el estado) para las etapas siguientes y la vuelta de standby. Para la fila de entrada usa la fecha de remisión que el taller escribe en el ticket, `desk.tickets.fecha_remision_entrada` (D12), que es una columna distinta de la tabla `public.remisiones`.

### A.4 Qué hay hoy en esas tablas

| Dato | Valor | Consulta |
|---|---|---|
| Remisiones | 149, todas `entrada` / `ok` / `historico`, ninguna anulada | D8 |
| Remisiones con ticket enlazado | 90 (59 sin ticket) | D8 |
| Rango de fechas | 29/01/2025 – 24/07/2026 | D8 |
| Remisiones creadas en la app | 0 | D8 |
| Transiciones registradas | 3, de un solo ticket, el 30/09/2026 | D7 |
| Tickets nacidos en la app | 1 (número 10005) | D3 |
| Cierres de empresa cargados | 0 | D9 |

**Consecuencia:** ningún ticket abierto hoy tiene remisión posterior al 24/07/2026, y solo 1 de los 35 abiertos tiene momento de entrada en su estado (D4). Por eso la regla 4 se aplica con `fecha_remision_entrada` del propio ticket, que sí viene rellena en 30 de los 35 abiertos (P2), y no con la tabla de remisiones (D12).

Además, «Remisión creada» solo la alcanzan los tickets nacidos en la app: su único origen es «Ticket creado» (`estadoPorRemision.ts:32-41`). Los nacidos en Zoho pasan de «OV asignada» a «Ingresado».

### A.5 Cómo se leen desde hub-api (D4)

Hoy hub-api tiene una sola conexión, `HUB_DB_URL` (`apps/hub-api/src/db.ts:10-20`), y ningún precedente de segunda conexión. El patrón de la casa para algo opcional es «variable ausente = función apagada», como `AUSENCIAS_WEBHOOK_URL` (`apps/hub-api/src/ausencias/avisar.ts:29-31`) o `SENTRY_DSN` (`apps/hub-api/src/sentry.ts:5-19`).

- **Variable:** `DESK2_DB_URL`, opcional. Se documenta en `apps/hub-api/.env.example` y `apps/hub-api/README.md` y se define en el entorno del servicio en EasyPanel; no requiere tocar el Dockerfile. Ningún valor en el repositorio ni en el chat.
- **Rol:** `portal_agenda_reader`. Lo crea Gerencia en `desk-db`; hoy allí solo existe el rol `postgres` (D10). Los permisos son por tabla, no por esquema, porque `public` contiene también la tabla de usuarios de Desk 2.0:

  ```sql
  -- A ejecutar por Gerencia en desk-db. La contraseña se genera allí y no se guarda en ningún repositorio.
  CREATE ROLE portal_agenda_reader LOGIN PASSWORD '<generada fuera del repo>';
  GRANT CONNECT ON DATABASE desk TO portal_agenda_reader;
  GRANT USAGE ON SCHEMA desk, public TO portal_agenda_reader;
  GRANT SELECT ON desk.tickets, desk.ticket_transitions, desk.ticket_history TO portal_agenda_reader;
  GRANT SELECT ON public.remisiones, public.calendario_cierres TO portal_agenda_reader;
  ALTER ROLE portal_agenda_reader SET default_transaction_read_only = on;
  ```

- **Sin la variable, o si la conexión falla:** la agenda usa la réplica y lo avisa en un rótulo fijo. Con la réplica no hay cierres de empresa, ni prioridad, ni llegadas exactas, y el flujo se deduce (D11).
- **Conexión defensiva:** pool propio, pequeño y perezoso; `statement_timeout` corto; lectura siempre dentro de `try`. Mismo criterio que `registrarEstadosSinFallar`, que no deja que un fallo rompa `GET /servicios` (`apps/hub-api/src/trazabilidad/registro-estados.ts:85-92`).
- **Red:** falta comprobar que el servicio hub-api alcanza `desk-db` dentro de EasyPanel (**no verificado**; se comprueba en el lote 1).

---

## B. Tickets: fuente principal, respaldo y cruce

### B.1 Fuente principal: Desk 2.0

La agenda lee los tickets de `desk.tickets` de la base `desk` (D4). Qué aporta cada tabla:

| Dato de la agenda | Tabla de Desk 2.0 | Nota |
|---|---|---|
| Ticket, estado, tipo de estado, sincronización | `desk.tickets` | 776 tickets, 35 abiertos (D2, D3) |
| Flujo (servicio / equipo nuevo) | `desk.tickets.classification` | Relleno en 34 de los 35 abiertos; 4 son «Equipo Nuevo» (D5) |
| Orden de la fila de entrada | `desk.tickets.fecha_remision_entrada` | Rellena en 30 de 35 abiertos; precisión de día (P2, D12) |
| Llegada exacta a un estado | `desk.ticket_transitions` | Solo movimientos hechos en la app: 1 de 35 abiertos (D4) |
| Salud de la sincronización | máximo de `desk.tickets.synced_at` | Para el aviso global (D13) |
| Prioridad fijada | `desk.tickets.priority` con `prioridad_en_app_at` | Ninguna fijada hoy (D6) |
| Cierres de empresa | `public.calendario_cierres` | 0 filas hoy (D9) |
| Remisiones de entrada | `public.remisiones` | Solo históricas hoy (D8) |
| Historial de eventos de Zoho | `desk.ticket_history` | Con permiso de lectura; no se usa en esta fase (D8) |

**Leer de Desk 2.0 no cambia dónde se trabaja.** El taller sigue moviendo los tickets en Zoho Desk; Desk 2.0 los sincroniza por su cuenta (`Desk2:apps/desk/server/index.ts:85-93`) y la agenda solo lee.

**Por qué es mejor fuente que la réplica:**

- **Más completa.** Contiene los 775 tickets de Zoho más los nacidos en la app (D3), y trae `classification`, que en la réplica está vacío en los 775 (Z3).
- **Más al día, al menos en el caso comprobado.** El ticket 884 figura «Finalizado» en Desk 2.0 (741 cerrados, D2) y sigue «Ingresado» en la réplica (740 cerrados, Z1).
- **Es el camino hacia el relevo de Zoho.** Cuando un ticket se mueve desde la app, la sincronización con Zoho deja de reescribirlo (`managed_by_app`, `Desk2:packages/zoho-sync/src/db/repo.ts:71`), y solo Desk 2.0 conoce su estado.

**Cómo se mantiene al día:** el código actual de Desk 2.0 ya no relee solo los 100 tickets con actividad más reciente. Pide a Zoho los modificados desde la última marca y relee cada uno por su detalle, con campos personalizados incluidos (`sincronizarModificados`, `Desk2:packages/zoho-sync/src/sync.ts:360-410`); si esa búsqueda falla, cae al método antiguo (`sync.ts:174`, `:404-407`). Eso explica que allí estén el cierre del 884 y la `classification`. **Verificado en producción el 06/10/2026:** 33 de los 35 abiertos traen campos personalizados y la base se había sincronizado 45 segundos antes de consultarla (P2, P5). El trabajador del hub no la usa: en la réplica esos campos siguen vacíos (Z3).

### B.2 Respaldo: la réplica del portal

Sin `DESK2_DB_URL`, o si la conexión falla, el mismo adaptador sirve los tickets de `desk.tickets` de `zoho-hub`, como hace hoy la pestaña Servicios (`apps/hub-api/src/trazabilidad/repo.ts:335-354`).

| Capacidad | Con Desk 2.0 | Con la réplica (respaldo) |
|---|---|---|
| Estados | Sí | Sí, puede ir más atrasada |
| Flujo | `classification` | Deducido del asunto («Equipo Nuevo») o del prefijo `HV_`; corregible a mano (D11) |
| Orden de la fila de entrada | `fecha_remision_entrada` (D12) | La misma regla si trae el campo; hoy no lo trae, así que rige D8 |
| Llegada a un estado | Exacta si hay transición; si no, aproximada | Aproximada (historial del portal) |
| Aviso de sincronización parada | Sí, sobre la base `desk` | Sí, sobre la réplica |
| Prioridad | La fijada en Desk 2.0 | No hay: FIFO puro |
| Cierres de empresa | Sí | No, y se avisa |
| Tickets nacidos en la app | Sí | No existen |

La pantalla muestra siempre qué fuente está activa y qué no puede dar.

### B.3 Cruce por número de ticket

- **Tickets de Zoho:** números del 171 al 1010, los mismos en las dos bases (D3; Z5 frente a D5).
- **Tickets nacidos en Desk 2.0:** id `app-<uuid>` (`Desk2:packages/zoho-sync/src/db/repo.ts:413`) y número desde 10.000 (`Desk2:packages/zoho-sync/src/db/migrate.ts:43-50`). Hoy hay uno, el 10005.
- **No se pisan.** Y todas las tablas del portal ya usan el número (`tmc_servicios_tipo.numero`, `tmc_estados_historial.numero`), así que el tipo de servicio puesto a mano y el historial siguen valiendo con cualquiera de las dos fuentes.

| Situación | Manda |
|---|---|
| Conexión activa, ticket en las dos | Desk 2.0 |
| Conexión activa, ticket solo en Desk 2.0 | Desk 2.0 |
| Conexión activa, ticket solo en la réplica | No se muestra: Desk 2.0 es la referencia. Se cuenta en un aviso de diagnóstico |
| Sin conexión o conexión caída | La réplica, con rótulo de respaldo |

### B.4 El adaptador

Una sola interfaz y dos orígenes. Todo lo demás (categorías, puestos, duraciones, asignaciones, proyección) trabaja sobre `TicketTaller` y no sabe de dónde viene.

**Construido en el lote 1** (`apps/hub-api/src/trazabilidad/fuente.ts`, con el SQL en `fuente-desk2.ts` y `fuente-replica.ts` y la conexión en `apps/hub-api/src/db-desk2.ts`). La interfaz quedó así:

```ts
interface FuenteAgenda {
  ticketsAbiertos(): Promise<TicketTaller[]>;
  cierresEmpresa(desde: string, hasta: string): Promise<string[]>;   // [] con la réplica
  estadoFuente(): Promise<EstadoFuente>;
}
interface TicketTaller {
  numero: number;
  estado: string;                    // tal cual; se casa por claveEstadoDesk
  tipoEstado: string | null;         // status_type
  clasificacion: string | null;      // classification: de aquí sale el flujo (D11)
  tipoServicio: string | null;
  remisionEntrada: string | null;    // fecha_remision_entrada, AAAA-MM-DD (D12)
  fechaCreacion: string | null;      // fecha_creacion_ticket o el día en Colombia de created_time
  prioridad: string | null;          // sólo la fijada en Desk 2.0 (D1); null si no hay o en respaldo
  llegadaEstado: number | null;      // ms de la última transición al estado de ahora; null si no consta
  fuente: 'principal' | 'respaldo';
}
interface EstadoFuente {
  fuente: 'principal' | 'respaldo';
  motivo: 'sin_variable' | 'error_conexion' | 'timeout' | 'error_consulta' | null;
  mensaje: string | null;
  ultimaSincronizacion: string | null;   // máximo de synced_at de la base usada (D13)
  sincronizacionParada: boolean;
  umbralSincronizacionMs: number;
  ultimoFalloPrincipal: { motivo: string; en: string } | null;
  cortacircuitosHasta: string | null;    // lote 5: hasta cuándo no se prueba la principal; null = cerrado
}
const UMBRAL_SINCRONIZACION_PARADA_MS = 60 * 60 * 1000;   // D13: una hora
const CORTACIRCUITOS_MS = 60_000;                         // lote 5: un minuto
```

Diferencias con el boceto de la fase de análisis:

- **No hay `elegirFuente()` ni un objeto por fuente.** La caída es por llamada: cada lectura prueba la principal una vez y, si falla, lee la réplica en esa misma llamada. Cada ticket dice de qué fuente vino y `estadoFuente()` dice cuál contesta y por qué.
- **Cortacircuitos (lote 5).** Tras un fallo de la principal, durante `CORTACIRCUITOS_MS` (60 s) las lecturas van derechas al respaldo, sin esperar otra vez su tope de tiempo; pasado ese rato, la llamada siguiente la prueba una vez y, si sigue caída, se abre otro minuto. `estadoFuente()` lo cuenta en `cortacircuitosHasta`. Una lectura servida así es de respaldo y lo dice (`abiertosConOrigen`), de modo que la pasada de la agenda sigue sin apuntar historial ni cerrar asignaciones con ella (D17). hub-api crea una sola fuente para las rutas y para el programador, que comparten el cortacircuitos.
- **Las «capacidades» se deducen de la fuente:** con `respaldo` no hay prioridad, cierres ni llegada exacta.
- **El adaptador entrega datos, no reglas.** Da `clasificacion`, `prioridad` y `llegadaEstado` tal como están; el flujo (D11, con su deducción en respaldo y la marca a mano), el rango de la prioridad, el tipo puesto a mano y la llegada aproximada del historial del portal se resuelven en los lotes 2 a 4, que son los que tienen esas reglas y tablas. Para deducir el flujo en respaldo, el lote 2 añadió a la lectura de la réplica el asunto y el código de servicio (`asunto` y `codigoServicio` en `TicketTaller`; `null` con la fuente principal). El diagnóstico de la fuente no los devuelve.
- **La consulta de `estadoFuente()` es también una sonda:** nombra todo lo que leen las demás, para que un permiso que falte en una sola tabla no deje el rótulo en «Desk 2.0» con tickets de la réplica.
- **Diagnóstico:** `GET /api/trazabilidad/agenda/fuente` devuelve `estadoFuente()` y el recuento de abiertos por estado.

### B.5 El orden de llegada

**Fila de la primera etapa (D12, confirmado por Gerencia el 06/10/2026).** La primera etapa es Diagnóstico en el flujo de servicio y Proceso en el de equipo nuevo. Su fila es **una sola**, formada por:

- los tickets en la fila de entrada («Ingresado», «Remisión creada») que van a esa etapa, y
- los tickets que ya están en un estado de esa etapa sin puesto asignado.

Los dos grupos se mezclan y se ordenan juntos por `fecha_remision_entrada`, ascendente. Con el mismo día, va primero el ticket con llegada exacta en `desk.ticket_transitions`; si no, el de número más bajo. Sin fecha, al final, con la marca «falta fecha de remisión». Estar ya en el estado de la etapa no da preferencia sobre quien sigue en «Ingresado»: manda la fecha de remisión.

**Excepción:** los tickets que el historial muestra volviendo de un standby van al final de la fila de su etapa, detrás de todos los anteriores, ordenados por el momento de entrada en el estado.

**Etapas siguientes y vuelta de standby.** Manda la llegada al estado, por orden de preferencia:

1. **Transición de Desk 2.0:** último `performed_at` de `desk.ticket_transitions` con `to_status` = estado actual. Exacta.
2. **Historial de la agenda:** `desde` del tramo abierto en `tmc_agenda_historial` (D17). Todavía no entra en el orden: hoy la llegada es solo la de la fuente. Exacta al minuto si `desde_real = TRUE`; aproximada si es primera observación.
3. **Sin dato:** al final, por número de ticket.

**El historial del portal debe seguir a la fuente principal.** Hoy `registrarEstados` lee la réplica (`repo.ts:645-689`). Con D4 debe leer del adaptador, y **no apuntar nada mientras se esté en respaldo**: las dos bases pueden discrepar (el 884 es «Finalizado» en una e «Ingresado» en la otra), y alternar de fuente escribiría cambios de estado que nunca ocurrieron.

**Cómo quedó (D17, 07/10/2026): un historial por fuente.** El párrafo anterior, tal cual, dejaba incoherente a «Servicios»: seguiría leyendo sus tickets y el estado de ahora de la réplica con un historial de la principal, y sin `DESK2_DB_URL` su historial dejaría de crecer (el análisis está en la sección J, lote 4b). Por eso:

- **`tmc_estados_historial` y `registrarEstados` no cambian.** Siguen leyendo la réplica y son el historial de «Servicios», que lee sus tickets de esa misma base.
- **La agenda lleva el suyo: `tmc_agenda_historial`** (E.6), que apunta `registrarEstadosAgenda` desde la fuente principal y **nunca en respaldo** (ni sin la variable ni con la principal caída). «Respaldo» se decide por quién dio la lista de abiertos en esa llamada, no por si viene vacía: una lectura fallida no se interpreta como «todos cerrados».
- **La «vuelta de standby» sale del historial de la agenda.** No se reconstruye nada (D8): un paso por standby anterior a la primera pasada de este historial no se conoce, y ese ticket se ordena como los demás. La primera pasada apunta cada ticket como primera observación (`desde_real = FALSE`): no inventa cambios ni vueltas.
- **En respaldo** el historial de la agenda se queda como estaba; como «vuelve de standby» exige que el tramo abierto sea el estado que da la fuente, un desfase con la réplica solo hace que no se afirme.

### B.6 Prioridad (D1)

- **Criterio:** rango `Urgent` 4, `High` 3, `Medium` 2, `Low` 1 (`Desk2:packages/shared/src/prioridad.ts:22-23`, `:95-109`).
- **Solo cuenta la prioridad fijada en Desk 2.0**, es decir, la de tickets con `prioridad_en_app_at` relleno (`Desk2:apps/desk/server/db/prioridadCliente.ts:106-124`). El resto se trata como «sin prioridad».
- **Hoy no hay ninguna fijada** (D6): los `High` / `Low` que se ven en las dos bases son el valor de Zoho (Z2, D6) y no se usan. La fila es FIFO puro.

### B.7 Flujo: servicio o equipo nuevo (D11)

- **Con Desk 2.0:** equipo nuevo si `classification` normaliza a «equipo nuevo»; si no, servicio (`Desk2:packages/shared/src/flujos.ts:51-61`). Hoy son equipo nuevo los tickets 1000, 1001, 1002 y 1008 (D5).
- **Con la réplica:** `classification` está vacío (Z3). Se deduce: equipo nuevo si el asunto empieza por «Equipo Nuevo» o el código de servicio empieza por `HV_`.
- **Marca a mano por ticket:** solo para el ticket cuya fuente **no trae `classification`** (decidido el 07/10/2026; antes decía «gana siempre»). Con clasificación manda ella: la marca no se puede poner y, si existía de antes, deja de valer. Se guarda en una tabla del portal (E.4).

### B.8 Aviso de sincronización parada (D13)

Ningún ticket lleva marca de «sin confirmar». La agenda muestra un aviso global cuando el máximo de `synced_at` de la base de la fuente activa tiene más de una hora (`UMBRAL_SINCRONIZACION_PARADA_MS`).

Se mide sobre toda la tabla, no por ticket, porque la sincronización de Desk 2.0 solo relee lo que cambia en Zoho: un ticket que nadie toca conserva una fecha antigua aunque su estado sea correcto (689, 881 y 882 el 06/10/2026, P6), y un ticket nacido en la app no la tiene nunca (10005). El máximo de la tabla, en cambio, se mueve cada pocos minutos mientras la sincronización funciona: el 06/10/2026 tenía 45 segundos (P5).

### B.9 Quién opera la agenda (D14)

El Director Técnico (rol `DIRECTOR_TECNICO`) confirma el reparto inicial, asigna y libera puestos, marca el flujo y configura puestos y duraciones. El resto de quienes tienen la app asignada solo consultan.

El rol llegó con la fase de roles (migración 049, tabla `portal.tmc_user_roles`), construida antes que la agenda. La matriz de permisos está en `apps/hub-api/src/trazabilidad/roles.ts` y ya incluye los de la agenda: `agenda.reparto` (confirmar el reparto inicial), `agenda.asignar`, `agenda.liberar`, `agenda.flujo` y `config.write` (puestos, duraciones, categoría y etapa de cada estado). Hoy solo los tiene el rol `DIRECTOR_TECNICO`; los administradores del portal tienen todos los permisos. Los endpoints de la agenda piden el permiso, no comparan el rol.

---

## C. Estados: las dos bases frente al blueprint

### C.1 Estados que existen hoy

| Estado | Tipo en Desk | Abiertos en Desk 2.0 | Abiertos en la réplica |
|---|---|---|---|
| Rev./Diagnostico | Open | 7 | 6 |
| Servicio externo | On Hold | 7 | 7 |
| Notificación cliente | On Hold | 6 | 6 |
| Por Facturar | On Hold | 5 | 5 |
| Ingresado | Open | 3 | 4 |
| En Proceso | Open | 3 | 3 |
| OV asignada | On Hold | 1 | 1 |
| En Espera de Repuestos | On Hold | 1 | 1 |
| En espera de SKU inventario | On Hold | 1 | 1 |
| Por Entregar | Open | 1 | 1 |
| Finalizado | Closed | 0 (741 cerrados) | 0 (740 cerrados) |

Fuentes: D2 y Z1. Las dos diferencias son el ticket 884 (cerrado en Desk 2.0, «Ingresado» en la réplica) y el 10005 (solo en Desk 2.0, en «Rev./Diagnostico»). Son 35 abiertos en cada base.

Son 11 estados en uso. El blueprint de Desk 2.0 define 23 (`Desk2:packages/shared/src/estados.ts:59-106`).

### C.2 Qué falta en cada lado

- **En el blueprint y sin ningún ticket hoy en ninguna de las dos bases (12):** «Ticket creado», «Remisión creada», «Notificado», «Notificación a Compras», «Notificación Comercial», «Solicitado», «Continuación del proceso», «Liberación Comercial», «Por Entregar / Sin facturar», «Verificación», «Pendiente» y «Solicitud Soporte».
- **En las bases y no en el blueprint:** ninguno.
- **Aviso:** «Notificación Comercial» tuvo un ticket durante el 06/10/2026, escrito con doble espacio. La clave normalizada lo absorbe (`claveEstadoDesk`, `apps/hub-api/src/trazabilidad/dominio.ts:360-362`).
- **Dos nombres para la misma fase inicial:** «OV asignada» es el de Zoho y «Ticket creado» el de la app (`Desk2:packages/shared/src/transitions.ts:127-144`).

### C.3 Categoría de cada estado

| Estado | Categoría en la agenda | Etapa | Nota |
|---|---|---|---|
| OV asignada | Por llegar | — | Lista aparte, sin proyectar |
| Ticket creado | Por llegar | — | |
| Remisión creada | Fila de entrada | — | Solo tickets nacidos en la app |
| Ingresado | Fila de entrada | — | En el flujo de equipo nuevo alimenta Proceso, no Diagnóstico |
| Rev./Diagnostico | Etapa activa | Diagnóstico | |
| Notificado | Etapa activa | Diagnóstico | D2: sigue ocupando el puesto |
| En Proceso | Etapa activa | Proceso | |
| Continuación del proceso | Etapa activa | Proceso | |
| Verificación | Etapa activa | Verificación | Solo flujo de equipo nuevo |
| Notificación a Compras | Standby | — | Depende de Compras |
| Notificación Comercial | Standby | — | Depende de Comercial |
| Notificación cliente | Standby | — | Depende del cliente |
| En espera de SKU inventario | Standby | — | Depende de Compras |
| En Espera de Repuestos | Standby | — | Depende de terceros |
| Solicitado | Standby | — | Repuestos pedidos desde Proceso |
| Servicio externo | Standby | — | Depende de terceros |
| Por Facturar | Fin de taller | — | |
| Liberación Comercial | Fin de taller | — | |
| Por Entregar | Fin de taller | — | Espera externa en Desk 2.0; diferencia documentada |
| Por Entregar / Sin facturar | Fin de taller | — | |
| Finalizado | Fin de taller | — | Cerrado; no aparece en la agenda |
| Pendiente | Fuera de la agenda | — | D10: soporte remoto |
| Solicitud Soporte | Fuera de la agenda | — | D10: soporte remoto |

«Notificación a Compras» no estaba en la lista de standby de la regla 2. Va como standby porque depende de Compras, coherente con D2.

### C.4 Papeles en `tmc_estados_desk`

Papel guardado el 06/10/2026 (Z4) y papel tras D5:

| Estado | Papel el 06/10/2026 | Papel tras D5 | Categoría en la agenda |
|---|---|---|---|
| Notificación cliente | standby | standby | Standby |
| Servicio externo | standby | standby | Standby |
| Por Facturar | standby | **terminado** | Fin de taller |
| Por Entregar | standby | **terminado** | Fin de taller |

El cambio de D5 lo hace Gerencia desde Configuración; este documento no modifica datos. Con él, papel y categoría quedan alineados: el plazo de Servicios se detiene con veredicto en los mismos estados en que la agenda da el trabajo por terminado.

Papel y categoría siguen siendo columnas distintas. El papel (`cuenta` / `standby` / `terminado`) gobierna el reloj del plazo; la categoría gobierna puestos y filas, y distingue además «por llegar», «fila de entrada» y la etapa, que el papel no conoce.

---

## D. ¿Basta el historial de estados?

**Basta para lo decidido.** Con D8 no se reconstruye el pasado: se trabaja con orden aproximado y con el reparto inicial que confirma el Director Técnico (D6).

Qué da y qué no da `portal.tmc_estados_historial` (`apps/hub-api/src/users/migrations/047_trazabilidad_estados_historial.sql:39-55`, `apps/hub-api/src/trazabilidad/repo.ts:645-689`):

| Pregunta | Respuesta |
|---|---|
| ¿Cuándo entró el ticket en su estado actual? | Si el tramo abierto tiene `desde_real = TRUE`, con precisión de 5 minutos más el retraso de la sincronización. Si es `FALSE`, `desde` es la primera vez que el portal lo vio |
| ¿Cuándo entró en su etapa (varios estados)? | Derivable recorriendo hacia atrás los tramos contiguos de la misma etapa, como hace `inicioDeRacha` para «terminado» (`apps/hub-api/src/trazabilidad/plazos.ts:195-204`). Es real solo si el primer tramo de la racha tiene `desde_real = TRUE` |
| ¿En qué orden llegaron los que ya estaban? | No se sabe. Todos los vistos en la misma pasada comparten `desde` |

Estado real el 06/10/2026 (Z6 y Z5): 35 tramos, uno por ticket abierto, **0 con `desde_real`**, todos con el mismo instante (06/10/2026 22:12:04 UTC, primera pasada tras el despliegue). A partir de ahí cada cambio de estado deja un tramo real, así que el dato mejora solo con el tiempo.

Lo que hay que cambiar en el historial para la agenda:

1. **Que lea de la fuente principal** y no apunte en respaldo (B.5).
2. **Etapa al leer.** La tabla guarda la clave del estado; la correspondencia estado → etapa se aplica al leer, igual que el papel.

`desk.ticket_history` guarda el registro de eventos de Zoho (en la réplica, 42.588 eventos y 4.433 transiciones de blueprint, Z7 y Z8; en Desk 2.0, 41.521 y 4.304, con el último evento del 20/08/2026, P7). El rol tendrá permiso de lectura sobre la tabla de Desk 2.0, pero por D8 no se usa en esta construcción.

---

## E. Modelo de datos

Todo en el esquema `portal`, migraciones idempotentes de la 050 a la 054, las cinco ya construidas y registradas en `apps/hub-api/src/db.ts` (la 054 es la última): 050 categoría de cada estado (E.1), 051 puestos y duraciones (E.2), 052 asignaciones (E.3), 053 flujo a mano (E.4) y 054 historial de la agenda (E.6). Se reejecutan en cada arranque. Ninguna toca el esquema `desk` ni la base de Desk 2.0.

### E.1 Migración 050 — categoría y etapa de cada estado

Extiende `portal.tmc_estados_desk`; sin tabla paralela. No se puede editar la 046: `CREATE TABLE IF NOT EXISTS` no altera una tabla existente y las guardas de pruebas le prohíben `ALTER` (`apps/hub-api/src/trazabilidad/plazos.test.ts:501-509`). Precedentes de `ADD COLUMN IF NOT EXISTS`: `031_registro_exportadores.sql:21-22`, `034_token_version.sql:17`; de CHECK añadido de forma idempotente: `016_ausencias_historico.sql:36-45`.

```sql
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS categoria VARCHAR(12) NULL;
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS etapa     VARCHAR(12) NULL;
-- La firma de la categoría, aparte de la del papel (actualizado_*):
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS categoria_por_id UUID         NULL;
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS categoria_por    VARCHAR(254) NULL;
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS categoria_en     TIMESTAMPTZ  NULL;
-- La firma del papel deja de ser obligatoria:
ALTER TABLE portal.tmc_estados_desk ALTER COLUMN actualizado_por DROP NOT NULL, ALTER COLUMN actualizado_en DROP NOT NULL;
-- CHECK con nombre, dentro de DO $$ … IF NOT EXISTS (pg_constraint) … $$:
--   categoria IN ('por_llegar','entrada','activa','standby','fin','fuera')
--   etapa     IN ('diagnostico','proceso','verificacion')
--   (categoria IS NOT DISTINCT FROM 'activa') = (etapa IS NOT NULL)
-- Semilla: INSERT de los 23 estados de C.3 … ON CONFLICT (clave) DO UPDATE
--   SET categoria, etapa, categoria_por, categoria_en … WHERE la fila no tiene categoría
```

**Construido en el lote 2**, con dos cambios respecto al diseño de la fase de análisis:

- **La tabla se siembra** (el diseño inicial decía que no). La 050 crea una fila por cada estado de C.3 que no la tenga y, en las que ya existían, rellena la categoría solo si está vacía. La sentencia no nombra la columna del papel: no lo lee ni lo escribe.
- **Dos firmas en la misma fila.** El papel del reloj se firma en `actualizado_por_id`, `actualizado_por` y `actualizado_en`; la categoría y la etapa, en `categoria_por_id`, `categoria_por` y `categoria_en`. Elegir una no toca la firma de la otra, en ningún sentido. La semilla firma la categoría con `categoria_por = 'semilla (migracion 050)'`. En una fila que ya existía, la firma del papel se queda como estaba. En una fila que la semilla crea, el papel es el de por defecto (`cuenta`, el mismo que vale para un estado sin fila) y su firma queda vacía: nadie lo ha elegido. Por eso `actualizado_por` y `actualizado_en` pasan a admitir `NULL`.
- **No pisa lo elegido.** La app nunca guarda una categoría vacía, así que «categoría vacía» solo puede significar «nadie ha elegido». Reejecutar la migración en cada arranque no cambia una categoría puesta a mano.
- **El catálogo de C.3 vive además como constante** (`CATALOGO_ESTADOS_AGENDA` en `dominio.ts`), y una prueba falla si la semilla y la constante dejan de coincidir. `categoriaDeEstado` aplica: fila guardada → catálogo → sin categoría.
- **Un estado que no está en C.3 queda sin categoría** (`NULL`) hasta que alguien se la elija. La proyección (lote 3) debe tratarlo como caso propio y avisarlo.
- **Efecto en Configuración:** el bloque «Estados de Desk» lista los estados guardados aunque ningún ticket los tenga, así que tras desplegar aparecen los 23 del blueprint (12 sin tickets hoy). Salen como cualquier estado que nadie ha tocado: papel «Cuenta» y sin autor ni fecha («Nadie lo ha cambiado»). La semilla no figura ahí, porque ese bloque enseña la firma del papel y la semilla solo firma la categoría. `GET /estados` no cambia.
- **Contrato del PUT (resuelto en el lote 5, distinto de lo previsto).** Se preveía hacer de `PUT /estados` una actualización parcial `{ estado, rol?, categoria?, etapa? }`. No se hizo: **`PUT /estados` sigue siendo solo del papel**, con el cuerpo `{ estado, rol }` que envía la pantalla de hoy (`guardarEstadoDesk` no nombra la categoría; lo que venga de más se ignora), y **la categoría tiene su ruta**, `PUT /agenda/configuracion/estados` con `{ estado, categoria, etapa? }` (`guardarCategoriaEstado`, que no nombra el papel). Así ninguna puede pisar a la otra por un campo que falte y la pantalla actual no cambia. `GET /estados` y `GET /agenda/configuracion` devuelven las dos firmas.
- **Guardas:** la lista de columnas de la tabla (`trazabilidad.db.test.ts`) y la de «última migración registrada», que pasó de `plazos.test.ts` a `agenda-config.test.ts` (bloque de la 051).

### E.2 Migración 051 — puestos por etapa y duraciones

```sql
CREATE TABLE IF NOT EXISTS portal.tmc_agenda_etapas (
  etapa               VARCHAR(12)  PRIMARY KEY CHECK (etapa IN ('diagnostico','proceso','verificacion')),
  etiqueta            VARCHAR(40)  NOT NULL,
  orden               SMALLINT     NOT NULL,
  puestos             INTEGER      NOT NULL CHECK (puestos BETWEEN 0 AND 50),
  actualizado_por_id  UUID         NULL,
  actualizado_por     VARCHAR(254) NULL,
  actualizado_en      TIMESTAMPTZ  NULL
);

CREATE TABLE IF NOT EXISTS portal.tmc_agenda_duraciones (
  etapa               VARCHAR(12)  NOT NULL,
  tipo                VARCHAR(80)  NOT NULL,     -- clave de tipo de servicio, o '*' = por defecto de la etapa
  dias_habiles        INTEGER      NOT NULL CHECK (dias_habiles BETWEEN 1 AND 365),
  actualizado_por_id  UUID         NULL,
  actualizado_por     VARCHAR(254) NULL,
  actualizado_en      TIMESTAMPTZ  NULL,
  PRIMARY KEY (etapa, tipo)
);
-- Semillas con ON CONFLICT DO NOTHING (no pisan lo que se edite):
--   etapas:     diagnostico 3 puestos · proceso 4 · verificacion 2
--   duraciones: (diagnostico,'*') 3 · (proceso,'*') 4 · (verificacion,'*') 1
```

- **Valores iniciales:** los de la configuración de partida de este análisis. Se ajustan en Configuración.
- **Duración de un ticket en una etapa (D9):** la fila `(etapa, tipo efectivo)` si existe; si no, la fila `(etapa, '*')`.
- **Tipo efectivo:** el que ya resuelve `tipoEfectivo` (`dominio.ts:263-268`): el puesto a mano en `tmc_servicios_tipo` gana sobre el de Desk. Si no hay ninguno, el ticket lleva la marca «sin tipo» y usa la fila «*».
- **No se reutiliza `tmc_plazos`:** aquel es el plazo comprometido con el cliente por tipo; esto es cuánto ocupa un puesto en cada etapa.
- **Construido en el lote 2** tal cual, con dos `CHECK` más en `tmc_agenda_duraciones`: `etapa` en las tres etapas y `tipo <> ''`. Sin claves foráneas. La regla es `duracionDeEtapa` (`dominio.ts`): fila exacta → «*» → sin duración. Un tipo compuesto («Diagnóstico + Calibración») no se descompone: casa por su propia clave o usa la «*». Quitar la «*» desde la app es un error 400; borrar la fila de un tipo no la resucita el arranque.

### E.3 Migración 052 — asignaciones

```sql
CREATE TABLE IF NOT EXISTS portal.tmc_agenda_asignaciones (
  id               BIGSERIAL    PRIMARY KEY,
  numero           INTEGER      NOT NULL CHECK (numero > 0),   -- ticket
  etapa            VARCHAR(12)  NOT NULL,
  puesto           INTEGER      NOT NULL CHECK (puesto >= 1),
  desde            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  inicio           DATE         NOT NULL,                      -- día desde el que cuenta la duración
  hasta            TIMESTAMPTZ  NULL,                          -- NULL = vigente
  origen           VARCHAR(12)  NOT NULL CHECK (origen IN ('fila','arranque')),
  sugerido         INTEGER      NULL,                          -- ticket que proponía la fila
  motivo           VARCHAR(500) NULL,                          -- obligatorio con origen 'fila' si numero <> sugerido
  asignado_por_id  UUID         NULL,
  asignado_por     VARCHAR(254) NOT NULL,
  cierre           VARCHAR(12)  NULL CHECK (cierre IN ('estado','manual','reparto')),
  cierre_motivo    VARCHAR(500) NULL,                          -- obligatorio si cierre = 'manual' (D7)
  cerrado_por_id   UUID         NULL,
  cerrado_por      VARCHAR(254) NULL,
  CONSTRAINT tmc_agenda_asig_fechas_ck CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT tmc_agenda_asig_cierre_ck CHECK ((hasta IS NULL) = (cierre IS NULL)),
  CONSTRAINT tmc_agenda_asig_motivo_ck CHECK (origen <> 'fila' OR sugerido IS NULL OR sugerido = numero OR btrim(COALESCE(motivo, '')) <> ''),
  CONSTRAINT tmc_agenda_asig_manual_ck CHECK (cierre IS DISTINCT FROM 'manual' OR (btrim(COALESCE(cierre_motivo, '')) <> '' AND cerrado_por IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_ticket_uq ON portal.tmc_agenda_asignaciones (numero)        WHERE hasta IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_puesto_uq ON portal.tmc_agenda_asignaciones (etapa, puesto) WHERE hasta IS NULL;
CREATE INDEX        IF NOT EXISTS tmc_agenda_asig_numero_idx ON portal.tmc_agenda_asignaciones (numero, desde);
```

**Construida en el lote 4a**, sin semilla. Lo que cambió respecto al diseño: `etapa` lleva su `CHECK`; `puesto` tiene tope (1..50, `PUESTOS_MAX`); el cierre `'reduccion'` pasa a ser `'reparto'` (reemplazada por un reparto); hay `cerrado_por_id`; y los tres `CHECK` con nombre de coherencia.

- **Un puesto, un ticket; un ticket, un puesto:** lo garantizan los dos índices parciales, como `tmc_estados_historial_abierto_uq` (`047…sql:39-55`). Son además lo que resuelve dos peticiones a la vez: la segunda recibe un 409.
- **Puesto dentro de los configurados:** lo comprueba la app al asignar (`comprobarLinea`, `repo.ts`), no la tabla: reducir los puestos no desaloja a nadie.
- **`inicio`:** el día desde el que cuenta la duración, siempre hábil (D16). El día de la asignación o, si no es hábil, el siguiente; en el arranque (D6), el día de llegada a la etapa si es exacto, para que los ya pasados de fecha se vean como tales.
- **Motivo:** obligatorio al asignar a quien no es el primero de la fila (`sugerido`), y al liberar a mano. En el reparto inicial no se pide.
- **Liberación a mano (D7):** `cierre = 'manual'`, con `cerrado_por` y `cierre_motivo` obligatorios. `liberar` en `repo.ts`.
- **Cierre automático (regla 5), construido en el lote 4b:** en la pasada de la agenda (`registrarEstadosAgenda`, E.6), si el ticket ya no está en un estado de la etapa de su asignación vigente —pasó a standby, a fin de taller, a otra etapa o a un estado sin categoría, o ya no viene entre los abiertos de la principal—, se cierra con `cierre = 'estado'` y `hasta` = el instante de esa pasada, sin motivo ni firma. Cambiar de estado dentro de la etapa no cierra. Entre el cambio de estado y la pasada siguiente (hasta 5 minutos) la asignación sigue vigente en la tabla: la proyección ya no la cuenta, pero ni su puesto ni su ticket se pueden volver a asignar (409) hasta que la pasada la cierre o alguien la libere. Con la pasada a demanda (D20) ese desfase baja a los 30 s de frescura, salvo que la pasada falle o la agenda esté en respaldo.
- **`cierre = 'reparto'`** está admitido por la tabla, **reservado y sin uso** (D19): el reparto inicial solo rellena puestos libres y nunca reemplaza una asignación. Para mover a alguien: liberar y asignar.
- **No se escribe nada en Desk 2.0 ni en Zoho.**

### E.4 Migración 053 — flujo marcado a mano

```sql
CREATE TABLE IF NOT EXISTS portal.tmc_agenda_flujo (
  numero              INTEGER      PRIMARY KEY CHECK (numero > 0),
  flujo               VARCHAR(12)  NOT NULL CHECK (flujo IN ('servicio','equipo_nuevo')),
  actualizado_por_id  UUID         NULL,
  actualizado_por     VARCHAR(254) NOT NULL,
  actualizado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

Mismo patrón que `tmc_servicios_tipo` (`044_trazabilidad_servicios_tipo.sql:26-33`): una fila por ticket corregido; borrarla vuelve al flujo de la fuente (D11).

**Construida en el lote 4a** tal cual, sin semilla. `marcarFlujo` (`repo.ts`) solo marca un ticket que la fuente trae abierto y **sin `classification`** (409 si la trae); quitar la marca se puede siempre. Al leer, una marca de un ticket que ahora sí trae clasificación no se aplica (`leerEntradaAgenda`).

### E.5 Lo que lee y escribe el lote 4 (`repo.ts`; sus endpoints, en E.7)

| Función | Permiso que pide su endpoint | Qué hace |
|---|---|---|
| `leerEntradaAgenda(db, fuente, hoy)` / `leerAgenda(db, fuente, hoy)` | — (lectura) | Reúne todo lo que pide `proyectarAgenda` —fuente, configuración, categorías, tipos a mano, cierres, asignaciones vigentes, `vuelvenDeStandby` y flujos a mano— y devuelve la entrada o la agenda |
| `asignar(db, fuente, {numero, etapa, puesto, motivo?}, actor, hoy)` | `agenda.asignar` | 409 `puesto_ocupado`, `ticket_fuera_de_etapa` o `ticket_con_puesto`; 400 en `puesto` si no existe en la etapa y en `motivo` si el ticket no es el primero de la fila |
| `proponerRepartoInicial(db, fuente, hoy)` | — (lectura) | La propuesta de F.5; no escribe |
| `confirmarRepartoInicial(db, fuente, lineas, actor, hoy)` | `agenda.reparto` | Las mismas comprobaciones por línea, 400 en `reparto` si repite ticket o puesto; una transacción, todo o nada |
| `liberar(db, {numero, motivo}, actor)` | `agenda.liberar` | 400 sin motivo; 404 si el ticket no tiene puesto |
| `marcarFlujo(db, fuente, numero, flujo \| null, actor)` | `agenda.flujo` | 400 en `flujo` o `numero`; 404 si la fuente no lo trae abierto; 409 `flujo_de_la_fuente` |
| `registrarEstadosAgenda(db, fuente)` | — (la lanza el programador, no una persona) | La pasada de la agenda: su historial y el cierre automático de asignaciones (E.6) |

### E.6 Migración 054 — historial de estados de la agenda (D17)

```sql
CREATE TABLE IF NOT EXISTS portal.tmc_agenda_historial (
  id          BIGSERIAL    PRIMARY KEY,
  numero      INTEGER      NOT NULL CHECK (numero > 0),
  clave       TEXT         NOT NULL,                 -- estado normalizado (claveEstadoDesk)
  etiqueta    TEXT         NOT NULL,
  desde       TIMESTAMPTZ  NOT NULL,
  hasta       TIMESTAMPTZ  NULL,                     -- NULL = tramo abierto
  desde_real  BOOLEAN      NOT NULL,                 -- FALSE = primera observación
  CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_historial_abierto_uq ON portal.tmc_agenda_historial (numero) WHERE hasta IS NULL;
CREATE INDEX        IF NOT EXISTS tmc_agenda_historial_numero_idx ON portal.tmc_agenda_historial (numero, desde);
```

Misma forma que `tmc_estados_historial` (047; una prueba vigila que las columnas coincidan), sin semilla y **sin copiar nada de aquélla**: son historiales de bases distintas.

**La pasada de la agenda** (`registrarEstadosAgenda(db, fuente)`, `repo.ts`), en una transacción:

1. coge **su** bloqueo (`pg_advisory_xact_lock(hashtext('portal.tmc_agenda_historial'))`), distinto del de `registrarEstados`;
2. lee la fuente ya con el bloqueo (`abiertosConOrigen`, que dice quién contestó). **Si no fue la principal, termina sin escribir nada**;
3. toma el instante (`clock_timestamp()`), apunta los tramos con las reglas de `registrarEstados` y cierra las asignaciones fuera de etapa con ese mismo instante (E.3).

Devuelve `{fuente, abiertos, cerrados, asignacionesCerradas}`.

**Cuándo se dispara:** en el programador de 5 minutos de `registro-estados.ts`, en el mismo turno que la de «Servicios» pero por otra puerta (`registrarAgendaSinFallar`): ninguna espera a la otra, el fallo de una no toca a la otra y cada una tiene su «una sola a la vez». `GET /servicios` no la dispara. **A demanda (D20, lote 5):** `GET /agenda` y las escrituras de asignación (asignar, confirmar el reparto, liberar) la piden antes, por la misma puerta (`agendaAlDia`, que además dice si salió bien); sin `forzar` no repite una pasada buena de hace menos de 30 s. Si falla, la petición sigue y la respuesta lleva el aviso `pasada_fallida`.

**Si la principal falla o no está configurada:** la pasada de la agenda no escribe; mientras espera a la principal (hasta unos 3 s de conexión o 5 s de consulta) retiene solo su bloqueo y una conexión de la base del portal. La de «Servicios» no se entera.

### E.7 Endpoints

**Construidos en el lote 5** (`apps/hub-api/src/trazabilidad/router.ts`). Todos bajo `/api/trazabilidad/agenda`, tras `requireAuth` + `requireApp('trazabilidad-mantenimientos')`. Los cálculos se hacen en el servidor con «hoy» como argumento.

Las lecturas (`GET`) están abiertas a quien tenga la app, con una excepción: la propuesta de reparto pide `agenda.reparto` (es el borrador de una decisión del Director Técnico). Todo lo que escribe exige además su permiso de la matriz de `roles.ts`, que hoy solo tiene el rol `DIRECTOR_TECNICO` (D14) y los administradores del portal. Cada ruta se registra con `escritura('<permiso>', …)` (la lectura con permiso, con `conPermiso`), que lo comprueba antes de validar y antes de consultar; una prueba lee `router.ts` y falla si una ruta que escribe se queda sin guarda o pide un permiso que no es el suyo.

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/agenda` (`?hoy=`) | — | La agenda completa: la proyección (`proyectarAgenda` sobre `leerEntradaAgenda`) con sus avisos, más el estado entero de la fuente (`estadoFuente`, con el cortacircuitos). Antes lanza la pasada a demanda (D20) |
| GET | `/agenda/reparto` (`?hoy=`) | `agenda.reparto` | La propuesta de reparto inicial (D6), sin escribir nada |
| POST | `/agenda/reparto` | `agenda.reparto` | `{ reparto: [{ numero, etapa, puesto }] }`, la propuesta tal cual o ajustada. Una transacción, todo o nada. 409 si algún puesto ya no está libre, diciendo cuál (D19) |
| POST | `/agenda/asignaciones` | `agenda.asignar` | `{ numero, etapa, puesto, motivo? }`. 409 si el puesto está ocupado o el ticket no está en esa etapa; 400 si falta el motivo y no es el primero de la fila |
| POST | `/agenda/liberar` | `agenda.liberar` | `{ numero, motivo }`: libera a mano el puesto de ese ticket (D7, D18). 404 si no lo tiene |
| PUT | `/agenda/flujo/:numero` | `agenda.flujo` | `{ flujo }`; `null` quita la marca (D11). 404 si la fuente no lo trae abierto; 409 si ya trae `classification` |
| GET | `/agenda/huecos` (`?etapa=&tipo=&hoy=`) | — | Las próximas fechas en que entraría un equipo que llegara hoy a esa etapa, según la proyección. Solo lectura, pensado para la futura reserva del cliente |
| GET | `/agenda/configuracion` | — | Etapas con sus puestos, duraciones y la categoría y etapa de cada estado, con las dos firmas (categoría y papel del reloj) y los tickets abiertos por estado en la fuente de la agenda |
| PUT | `/agenda/configuracion/puestos` | `config.write` | `{ etapa, puestos }` |
| PUT | `/agenda/configuracion/duraciones` | `config.write` | `{ etapa, tipo, dias }`; `dias: null` quita la fila, salvo la «*», que no se puede quitar (400) |
| PUT | `/agenda/configuracion/estados` | `config.write` | `{ estado, categoria, etapa? }`: solo la categoría; no toca el papel del reloj |
| GET | `/agenda/fuente` | — | El diagnóstico del lote 1, como estaba (su respuesta gana el campo `cortacircuitosHasta`) |

**Lo que quedó distinto del diseño de la fase de análisis:**

- **Nombres de ruta:** `/agenda/reparto` (antes «arranque»), `/agenda/configuracion` con sus tres escrituras debajo (antes `/agenda/config`, `/agenda/etapas` y `/agenda/duraciones`).
- **Liberar es `POST /agenda/liberar` por número de ticket** (D18), no `DELETE /agenda/asignaciones/:id`.
- **`PUT /estados` no se amplió** (E.1): la categoría va por `PUT /agenda/configuracion/estados`.
- **`GET /agenda/huecos` es nuevo.** Los huecos son sucesivos: cada uno supone ocupados los anteriores durante lo que dura ese tipo de servicio en la etapa.
- **Las escrituras de la agenda devuelven la agenda** ya leída otra vez, y las de configuración, la configuración: una petición menos por acción.
- **`hoy` solo en las lecturas.** Además del formato se exige que el día exista. Las escrituras usan siempre el día de hoy en Colombia: de él sale el `inicio` que se guarda, y no debe poder elegirse.
- **El eje (festivos y cierres) no va todavía en `GET /agenda`:** el diseño lo preveía y no se ha construido. Se añadirá con la pantalla (lote 7), que es la que sabe qué tramo pinta; las fechas previstas ya vienen calculadas con festivos y cierres.

---

## F. Algoritmo de la proyección

Función pura: recibe los tickets del adaptador, la configuración, las asignaciones vigentes, «hoy» y el calendario. No lee el reloj ni la base.

### F.1 Calendario (D3)

```
esHabilAgenda(d) = esHabil(d)               // lunes a viernes sin festivos de Colombia (plazos.ts)
                   y d no está en cierres   // fuente.cierres(); conjunto vacío en respaldo
sumar(d, n)      = el n-ésimo día hábil de agenda después de d (d no cuenta), como sumarDiasHabiles
```

### F.2 Preparación

```
fuente  = elegirFuente()                                   // desk2, o replica en respaldo
tickets = fuente.ticketsAbiertos()
para cada ticket t:
    t.flujo = marcaManual(t.numero) ?? t.flujo             // D11
    cat, etapa = categoriaDe(t.estado)                     // tabla → catálogo de C.3
    si cat = 'entrada':
        etapaDestino(t) = (t.flujo = 'equipo_nuevo') ? 'proceso' : 'diagnostico'
    si cat ∈ { standby, fin, por_llegar, fuera }:  no se proyecta
duracion(t, e) = duraciones[e][tipoEfectivo(t)] ?? duraciones[e]['*']      // D9
```

### F.3 Fila de una etapa (D1, D12)

```
primeraEtapa(t) = (t.flujo = 'equipo_nuevo') ? 'proceso' : 'diagnostico'

candidatos(e) = tickets de 'entrada' con etapaDestino = e                  // «Ingresado», «Remisión creada»
              ∪ tickets en un estado de la etapa e SIN asignación vigente  // «en etapa sin puesto»

con prioridad (D1, D15) = candidatos con prioridad fijada en Desk 2.0, de mayor a menor
        // por delante de TODA la fila, sean del grupo A o del B; solo con la fuente principal; hoy no hay ninguna
        // entre dos con la misma prioridad deciden las reglas de abajo

grupo A (una sola fila, D12) = candidatos t con e = primeraEtapa(t) que no vuelven de standby
        // mezcla a los de 'entrada' con los que ya están en la etapa sin puesto: no hay preferencia entre ellos
    orden:
        1. tiene remisionEntrada antes que no tenerla     // sin fecha → al final, «falta fecha de remisión»
        2. remisionEntrada ascendente
        3. con el mismo día: llegada exacta antes que no exacta
        4. número de ticket ascendente

grupo B (al final) = el resto: etapas siguientes y los que vuelven de standby
    orden:
        1. llegada ascendente                             // instante de entrada en el estado
        2. número de ticket ascendente
        si la llegada no es exacta o hay empate  →  «orden aproximado»

fila(e) = los que tienen prioridad, después el grupo A y después el grupo B
«vuelve de standby» = el ticket está en una etapa activa y, justo antes de entrar en ella, el historial de la agenda
                      lo tiene en un estado de categoría standby (cambiar de estado dentro de la etapa no lo borra)
sugerido(e) = el primer ticket de fila(e) que YA está en un estado de la etapa
              // quien espera en la fila de entrada no puede recibir puesto, aunque vaya delante
```

«Vuelve de standby» solo se afirma con el historial en la mano (`vuelvenDeStandby`, `agenda.ts`): si el tramo abierto del ticket no es el estado que da la fuente, o hay un hueco antes de la etapa, no cuenta como vuelto.

Con la réplica de respaldo `remisionEntrada` viene vacía, así que todos caerían en «sin fecha»; en ese caso no se pone la marca y se ordena por llegada y número, como en D8.

### F.4 Simulación por etapa

```
arranque = esHabilAgenda(hoy) ? hoy : sumar(hoy, 1)        // D16: nada entra ni empieza en un día no hábil
para cada etapa e:
    libre = []                                             // (puesto, día en que queda libre)
    para cada puesto p de 1..puestos[e]:
        si p tiene asignación vigente a (ticket t):
            fin = sumar(a.inicio, duracion(t, e))
            si fin < hoy:  fin = sumar(hoy, 1)             // pasado de fecha: empuja (regla 6)
            barra(t, p, a.inicio, fin);  libre.añadir(p, fin)
        si no:
            libre.añadir(p, arranque)                      // hueco libre ya (o el primer día hábil)
    para cada ticket t de fila(e), en orden:
        (p, d) = el puesto de libre con el día más temprano     // empate → puesto de número menor
        inicio = max(d, arranque)
        fin    = sumar(inicio, duracion(t, e))
        previsto(t) = { puesto p, inicio, fin };  libre.actualizar(p, fin)
    primerHueco(e) = el día más temprano de libre tras repartir la fila
    saturacion(e)  = puestos ocupados / puestos[e], más el tamaño de la fila

sincronizacionParada = ahora − fuente.ultimaSincronizacion() > UMBRAL_SINCRONIZACION_PARADA_MS     // D13, aviso global
```

El día en que un puesto queda libre es el mismo en que entra el siguiente, porque el día de inicio no cuenta en `sumar`.

### F.5 Reparto inicial (D6)

```
proponerArranque():
    para cada etapa e:
        candidatos = tickets en un estado de e sin asignación, en el orden de F.3
        para cada puesto libre p, por número:              // ni ocupado ni «a extinguir»
            t = siguiente candidato;  si no hay, terminar
            inicio = primerDiaHabil(t.llegada.exacta ? dia(t.llegada) : hoy)      // D16
            propuesta.añadir(t, e, p, inicio)
    devolver propuesta          // no escribe; lo que no cabe queda en la fila
confirmarArranque(lista):       // la que deja el Director Técnico, igual o ajustada
    validar puestos y tickets;  insertar todas con origen = 'arranque' en una transacción
```

**Construido en el lote 4a:** `proponerReparto` (`agenda.ts`, pura: es la misma proyección leída de otra forma) y `proponerRepartoInicial` / `confirmarRepartoInicial` (`repo.ts`). Confirmar solo rellena puestos libres con tickets que estén en esa etapa y sin puesto; no pide motivo aunque se ajuste, y guarda en `sugerido` a quién se proponía para cada puesto.

### F.6 Casos frontera

| Caso | Tratamiento |
|---|---|
| **Empate en la fila de entrada** | Misma fecha de remisión: primero el que tiene llegada exacta en `desk.ticket_transitions`; si no, el de número más bajo (D12) |
| **Ticket sin fecha de remisión** | Al final de la fila de entrada, con la marca «falta fecha de remisión». En cuanto se escribe en Zoho y se sincroniza, ocupa su sitio (D12) |
| **Empate de llegada en etapas siguientes** | Decide el número de ticket; se marca «orden aproximado» |
| **Pasado de fecha que empuja** | Sigue ocupando; fin proyectado = día hábil siguiente a hoy; se pinta en rojo. Cada día que siga ahí, toda la fila se corre un día |
| **Hoy no es hábil** | Sábado, domingo, festivo o cierre de empresa: lo primero que se proyecta es el siguiente día hábil. Ninguna entrada prevista, ningún primer hueco y ningún inicio de asignación cae en un día no hábil (D16) |
| **Standby que libera y vuelve** | Al entrar en standby la asignación sale de la proyección (manda el estado) y se cierra sola con `cierre = 'estado'` en la siguiente pasada de la agenda (E.6). Al volver a un estado de la etapa entra al final de la fila, con la llegada del momento en que regresó |
| **Equipo nuevo, dos etapas seguidas** | Ingresado → Proceso → Verificación. Se proyecta en cadena: la llegada prevista a Verificación es el fin previsto en Proceso. Es el único caso en que una etapa alimenta a otra sin standby en medio |
| **Tipo sin duración** | No puede darse: la fila «*» de cada etapa es obligatoria y no se puede borrar (D9). Un ticket sin tipo usa la «*» y lleva la marca «sin tipo» |
| **Puesto que se reduce estando ocupado** | No se desaloja a nadie. Los puestos por encima del nuevo tope quedan «a extinguir»: siguen ocupados hasta que su ticket salga y no reciben a nadie más. La saturación puede superar el 100 % y se avisa |
| **Ticket en la primera etapa sin puesto** | Forma una sola fila con los de la fila de entrada, ordenada por fecha de remisión (D12). No pasa por delante de un «Ingresado» que llegó antes. Se marca «en etapa sin puesto». Ejemplo: en Diagnóstico, un ticket en «Rev./Diagnostico» con remisión del 25/09 va detrás de uno en «Ingresado» con remisión del 20/09 |
| **Ticket que vuelve de standby a la primera etapa** | No entra en la fila única: va al final de la fila de su etapa, por el momento en que volvió al estado (D12) |
| **Más tickets en una etapa siguiente que puestos** | Los que no caben quedan en la fila de esa etapa, por llegada al estado, marcados «en etapa sin puesto» (D6) |
| **Diagnóstico no encadena con Proceso** | Entre ambas hay siempre standby (notificación y aprobación del cliente), que no se proyecta. La fila de Proceso solo contiene tickets que ya están en «En Proceso» o «Continuación del proceso» |
| **Sincronización parada** | Si el máximo de `synced_at` de la fuente tiene más de una hora, aviso global arriba de la agenda. No se marca ningún ticket ni se cambia la proyección (D13) |
| **Ticket que ya no debería ocupar puesto** | El Director Técnico libera el puesto a mano, con motivo; queda registrado (D7) |
| **Cambio a respaldo** | Las asignaciones vigentes se conservan; no se cierra ninguna automáticamente ni se apunta historial mientras dure. Un ticket que solo existe en Desk 2.0 conserva su puesto, marcado «sin datos de la fuente» |
| **Ticket con marca manual de flujo** | Solo se marca el ticket cuya fuente no trae clasificación; cambiarla recalcula a qué etapa alimenta. Si la fuente pasa a traerla, manda la clasificación |

---

## G. Boceto de la pantalla «Agenda del taller»

```
 Agenda del taller                                       hoy mar 06/10/2026
 Fuente: Desk 2.0 · sincronizada hace menos de 1 h · prioridad: ninguna fijada (FIFO puro) · cierres de empresa: 0
 [ Proponer reparto inicial ]                                              (solo Director Técnico)
 ─────────────────────────────────────────────────────────────────────────────────────────────────────
                    oct
                    06  07  08  09 │ 10  11  12 │ 13  14  15  16 │ 17  18 │ 19  20  21  22  23
                    ma  mi  ju  vi │ sá  do  lu*│ ma  mi  ju  vi │ sá  do │ lu  ma  mi  ju  vi
 ▌DIAGNÓSTICO  3/3 puestos · fila 7 · primer hueco: mar 20/10
   Puesto 1         [#999 █████████][·#1006···░░░░░░░░░░░·······][·#1010···░░░░░░·····][·#882·········]
   Puesto 2         [#993 █████████][·#1007···░░░░░░░░░░░·······][·#880····░░░░░░·····]
   Puesto 3         [#1005 ████████][·#10005··░░░░░░░░░░░·······][·#881····░░░░░░·····]
   Fila ▸ #1006 vie 09 · #1007 vie 09 · #10005 vie 09 · #1010 jue 15 · #880! jue 15 · #881! jue 15 · #882! mar 20
          └ en etapa sin puesto, por fecha de remisión ───────┘   └ fila de entrada ───────────────────┘
          [ Asignar #1006 al Puesto 1 ]   (sugerido; elegir otro pide motivo)

 ▌PROCESO      3/4 puestos · fila 0 · primer hueco: hoy
   Puesto 1         [#984 ██████████████░░░░░░░░░░░██]
   Puesto 2         [#990 ██████████████░░░░░░░░░░░██]
   Puesto 3         [#1009 █████████████░░░░░░░░░░░██]
   Puesto 4         ( libre )

 ▌VERIFICACIÓN 0/2 puestos · fila 0 · primer hueco: hoy
   Puesto 1         ( libre )
   Puesto 2         ( libre )
 ─────────────────────────────────────────────────────────────────────────────────────────────────────
 STANDBY (15) no ocupan puesto ni se proyectan
   Servicio externo 7 · Notificación cliente 6 · En Espera de Repuestos 1 · En espera de SKU 1
 FIN DE TALLER (6)   Por Facturar 5 · Por Entregar 1
 POR LLEGAR (1)      OV asignada 1

 Leyenda: ██ ocupado · ▓▓ pasado de fecha · [·#···] previsto · ░ no hábil (lu* = festivo)
          ! falta fecha de remisión · «sin tipo» = duración por defecto de la etapa
```

Elementos:

- **Gantt por puesto agrupado por etapa.** Una fila por puesto; barra llena para el ticket que lo ocupa, barra punteada para los previstos. Reutiliza el eje, los días no hábiles y los rayados de `Barras` (`apps/trazabilidad-mantenimientos/src/vistas/Servicios.tsx:494-668`) y la geometría de `apps/trazabilidad-mantenimientos/src/lib/servicios.ts` (`ejeServicios` `:335-348`, `diasDelEje` `:527-534`).
- **Fila de cada etapa** con la fecha prevista de entrada de cada ticket. El primero es el «sugerido»: un botón lo confirma; elegir otro abre el campo de motivo.
- **Marca «falta fecha de remisión»** (D12) en los tickets de la fila de entrada que no la tienen, con la indicación de completarla en Zoho.
- **«Proponer reparto inicial»** (D6): abre la propuesta completa, editable, con un único botón de confirmar.
- **Liberar puesto** (D7): en cada barra ocupada, con motivo obligatorio.
- **Acciones solo para el Director Técnico** (D14): reparto inicial, asignar, liberar, marcar el flujo y configurar. Los demás ven la agenda sin botones.
- **Carril de standby** agrupado por estado, sin fechas.
- **Saturación y primer hueco libre** en la cabecera de cada etapa.
- **Rótulo de fuente** fijo arriba. En respaldo cambia a «Fuente: réplica de Zoho (respaldo) · sin prioridad · sin cierres de empresa · flujo deducido», con el motivo.
- **Aviso de sincronización parada** (D13): una banda de aviso sobre toda la agenda cuando la fuente lleva más de una hora sin sincronizar, con la hora de la última sincronización. No marca ningún ticket.
- **Configuración:** un bloque nuevo con puestos y duraciones, y dos columnas más (categoría y etapa) en el bloque «Estados de Desk» (`apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx:45-158`).

---

## H. Ejemplo resuelto con los tickets abiertos de hoy

**Datos:** los 35 tickets abiertos de la base `desk` el 06/10/2026 (D5, P6), fuente Desk 2.0. **Configuración:** Diagnóstico 3 puestos / 3 días, Proceso 4 puestos / 4 días, Verificación 2 puestos / 1 día, con la fila «*» para todos los tipos.

**Condiciones del día:**

- **Sin prioridad:** ninguna fijada en Desk 2.0 (P2). FIFO puro.
- **Sin cierres de empresa:** la tabla está vacía (D9). El lunes 12/10/2026 es festivo en Colombia.
- **Sincronización al día:** la base se refrescó 45 segundos antes de la consulta (P5); no hay aviso global.
- **Orden de la primera etapa por fecha de remisión de entrada** (D12, P6).
- **Sin asignaciones previas:** se parte del reparto inicial (D6).

Desde el lote 3 este ejemplo es la prueba dorada de `apps/hub-api/src/trazabilidad/agenda.test.ts`, con números de ticket ficticios: la función da estas mismas fechas, tanto antes del reparto inicial (los diez de Diagnóstico en la fila) como con él confirmado.

### Reparto por categoría

| Categoría | Tickets | Números |
|---|---|---|
| Etapa Diagnóstico (Rev./Diagnostico) | 7 | 993, 999, 1005, 1006, 1007, 1010, 10005 |
| Etapa Proceso (En Proceso) | 3 | 984, 990, 1009 |
| Etapa Verificación | 0 | — |
| Fila de entrada (Ingresado) | 3 | 880, 881, 882 |
| Standby | 15 | Servicio externo: 991, 1000, 1001, 1002, 1003, 1004, 1008 · Notificación cliente: 689, 948, 958, 962, 968, 975 · En Espera de Repuestos: 976 · En espera de SKU inventario: 978 |
| Fin de taller | 6 | Por Facturar: 977, 981, 982, 983, 992 · Por Entregar: 985 |
| Por llegar (OV asignada) | 1 | 996 |

Suman 35. Los cuatro tickets de equipo nuevo (1000, 1001, 1002, 1008) están en «Servicio externo», es decir, en standby.

### Orden de llegada en Diagnóstico (D12)

| Orden | Ticket | Fecha de remisión de entrada | Nota |
|---|---|---|---|
| 1 | 999 | 31/08/2026 | |
| 2 | 993 | 18/09/2026 | |
| 3 | 1005 | 25/09/2026 | Mismo día que 1006 y 1007; ninguno tiene llegada exacta, decide el número |
| 4 | 1006 | 25/09/2026 | |
| 5 | 1007 | 25/09/2026 | |
| 6 | 10005 | 29/09/2026 | Tiene llegada exacta, pero no comparte día con nadie |
| 7 | 1010 | 02/10/2026 | |
| 8 | 880 | sin fecha | Fila de entrada; «falta fecha de remisión» |
| 9 | 881 | sin fecha | Fila de entrada; «falta fecha de remisión» |
| 10 | 882 | sin fecha | Fila de entrada; «falta fecha de remisión» |

Los siete primeros ya están en «Rev./Diagnostico»; los tres últimos esperan en «Ingresado». Ninguno de los siete consta como vuelto de standby: el historial del portal solo tiene su primera observación (Z6).

### Reparto inicial propuesto (D6)

| Etapa | Puesto | Ticket | Inicio | Fin estimado |
|---|---|---|---|---|
| Diagnóstico | 1 | 999 | mar 06/10 | vie 09/10 |
| Diagnóstico | 2 | 993 | mar 06/10 | vie 09/10 |
| Diagnóstico | 3 | 1005 | mar 06/10 | vie 09/10 |
| Proceso | 1 | 984 | mar 06/10 | mar 13/10 |
| Proceso | 2 | 990 | mar 06/10 | mar 13/10 |
| Proceso | 3 | 1009 | mar 06/10 | mar 13/10 |
| Proceso | 4 | libre | — | — |
| Verificación | 1 y 2 | libres | — | — |

Cuentas:

- Diagnóstico: ninguno de los tres tiene llegada exacta a la etapa, así que su duración cuenta desde hoy. 3 días hábiles desde el 06/10 → mié 7, jue 8, vie 9.
- Proceso: 4 días hábiles desde el 06/10 → mié 7, jue 8, vie 9, mar 13 (el lunes 12 es festivo).

### Fila de Diagnóstico y fechas previstas

| Orden | Ticket | Situación | Puesto | Entra | Termina |
|---|---|---|---|---|---|
| 1 | 1006 | En etapa sin puesto | 1 | vie 09/10 | jue 15/10 |
| 2 | 1007 | En etapa sin puesto | 2 | vie 09/10 | jue 15/10 |
| 3 | 10005 | En etapa sin puesto | 3 | vie 09/10 | jue 15/10 |
| 4 | 1010 | En etapa sin puesto | 1 | jue 15/10 | mar 20/10 |
| 5 | 880 | Fila de entrada, falta fecha de remisión | 2 | jue 15/10 | mar 20/10 |
| 6 | 881 | Fila de entrada, falta fecha de remisión | 3 | jue 15/10 | mar 20/10 |
| 7 | 882 | Fila de entrada, falta fecha de remisión | 1 | mar 20/10 | vie 23/10 |

Cuentas: desde el vie 09/10 → mar 13, mié 14, jue 15. Desde el jue 15/10 → vie 16, lun 19, mar 20. Desde el mar 20/10 → mié 21, jue 22, vie 23.

Las cinco primeras fechas previstas son las de los tickets 1006, 1007, 10005, 1010 y 880. El primer hueco libre en Diagnóstico tras repartir la fila es el mar 20/10.

### Lo que enseña el ejemplo

- **Diagnóstico está saturado desde el primer día:** 7 tickets en la etapa para 3 puestos. Cuatro quedan «en etapa sin puesto» y encabezan la fila.
- **La fecha de remisión cambia quién va primero.** Con el orden aproximado de D8 el primer puesto era para el 10005; por remisión es para el 999, que llegó el 31/08, y el 10005 pasa al sexto lugar.
- **Proceso tiene un hueco libre hoy y fila vacía.** No se puede prever quién lo ocupará, porque los que salgan de Diagnóstico pasan antes por standby.
- **Verificación está vacía.**
- **Los tres tickets de la fila de entrada no tienen fecha de remisión** (880, 881, 882). El equipo sí llegó (D12); en cuanto se escriba la fecha en Zoho, pasarían por delante de los que llegaron después.
- **Con la réplica de respaldo** el resultado cambiaría: no existiría el 10005, aparecería el 884 en la fila de entrada (en Desk 2.0 ya está cerrado) y, al no traer fecha de remisión, el orden sería por número de ticket (D8).

---

## I. Riesgos

No quedan decisiones de negocio abiertas. Las nueve de la primera versión de este documento se resolvieron el 06/10/2026 (D4 a D11), y las tres que dejó la verificación de la base `desk`, el mismo día (D12 a D14).

1. **Desk 2.0 también puede atrasarse.** Su sincronización por tickets modificados cae al método antiguo (los 100 con actividad más reciente) cuando la búsqueda de Zoho falla. El 06/10/2026 estaba al día (P5). El aviso global de D13 detecta una parada completa, no un ticket suelto que se quede atrás; para eso está la liberación manual (D7).
2. **La fecha de remisión se escribe a mano en Zoho.** Tiene precisión de día y puede faltar o estar mal: 5 de los 35 abiertos no la tienen (P2). El orden de la fila de entrada depende de que el taller la mantenga (D12).
3. **El orden en etapas siguientes sigue siendo aproximado.** 34 de los 35 abiertos no tienen llegada exacta a su estado. El reparto inicial lo corrige el Director Técnico (D6, D8).
4. **Dos procesos sincronizan Zoho por separado.** Desk 2.0 y el trabajador del hub pueden discrepar sobre un mismo ticket. Por eso cada pantalla lleva el historial de la base de la que lee sus tickets, y el de la agenda no apunta en respaldo (B.5, D17).
5. **Entrar y salir del respaldo.** La agenda cambia de aspecto: aparecen o desaparecen tickets (10005, 884), se pierde la prioridad y los cierres. Las asignaciones se conservan.
6. **Precisión de 5 minutos.** Un paso muy breve por un estado puede no quedar registrado, y una asignación puede cerrarse hasta 5 minutos tarde.
7. **La proyección no cruza el standby.** La ocupación futura de Proceso depende de aprobaciones de clientes que la agenda no puede prever.
8. **Calendarios distintos.** Desk 2.0 mide sus alarmas en horas hábiles 08–17 (`Desk2:packages/shared/src/calendarioLaboral.ts:14`); la agenda, en días. Un mismo ticket puede estar «en plazo» en un sitio y con alarma en el otro.
9. **Una segunda conexión en hub-api.** Es la primera; un fallo de red o de permisos no debe tumbar el resto de la app. Se cubre con el respaldo y con pruebas del lote 1.
10. **La tabla de cierres está vacía.** D3 no tendrá efecto hasta que alguien cargue cierres en Desk 2.0.

## Fuera de alcance

- La reserva por parte del cliente.
- Escribir en Desk 2.0 o en Zoho.
- Cualquier envío de correo.
- Reconstruir llegadas pasadas (D8).
- El flujo de soporte remoto (D10).

## Lo que no se pudo verificar

- **Que hub-api alcance el servicio `desk-db`** dentro de EasyPanel: no se probó ninguna conexión, porque esta fase no toca configuración. Se comprueba en el lote 1.
- **Los valores reales de `DATABASE_URL` y `DB_SCHEMA` de Desk 2.0 en producción:** el propio repositorio los marca como no verificados (`Desk2:DEPLOY.md:331-333`). Sí se verificó el resultado: base `desk`, tablas en el esquema `desk` (D1).
- **Que los ids de los tickets de Zoho coincidan en las dos bases:** se comparó por número, que es la clave del cruce.
- **Que «Equipo Nuevo» en el asunto y `HV_` en el código identifiquen siempre ese flujo:** visto en cuatro tickets. Solo afecta al respaldo, y hay marca manual (D11).
- **Que el rol `DIRECTOR_TECNICO` exista en el portal:** resuelto después de este análisis. La fase de roles (migración 049) ya está construida; falta que un administrador del portal asigne el rol a la persona que lo ejerce.
- **Que la réplica de respaldo traiga `fecha_remision_entrada`:** el 06/10/2026 sus campos personalizados estaban vacíos; no se consultó esa columna en concreto.
- **El comportamiento real de la agenda:** no existe todavía; el ejemplo de H es un cálculo a mano.

## Verificación de la fuente principal (base `desk`, 06/10/2026)

Consultas `P1`…`P7`, ejecutadas en modo solo lectura sobre la base `desk` el 06/10/2026 a las 23:52 UTC. No devuelven clientes, seriales ni correos.

### Resultados

**P1 — Abiertos por estado.** 35 abiertos, en los mismos diez estados que D2: Rev./Diagnostico 7, Servicio externo 7, Notificación cliente 6, Por Facturar 5, En Proceso 3, Ingresado 3, y uno en cada uno de En Espera de Repuestos, En espera de SKU inventario, OV asignada y Por Entregar.

**P2 — Qué traen rellenos los 35 abiertos.**

| Dato | Abiertos que lo tienen |
|---|---|
| Tipo de servicio (`tipo_servicio`) | 34 |
| Fecha de creación del ticket (`fecha_creacion_ticket`) | 33 |
| Fecha de remisión de entrada (`fecha_remision_entrada`) | 30 |
| Campos personalizados (`custom_fields`) | 33 |
| Fecha de modificación (`modified_time`) | 34 |
| Clasificación (`classification`) | 34 |
| Prioridad fijada en la app (`prioridad_en_app_at`) | 0 |

**P3 — Tipo de servicio de los abiertos.** Diagnostico 26, Mantenimiento 3, No aplica 3, Calibración 2 (escrita una vez con mayúscula y otra sin ella) y 1 sin tipo.

**P4 — Clasificación.**

| `classification` | Tickets | Abiertos |
|---|---|---|
| (vacía) | 707 | 1 |
| Equipo Para Servicio | 59 | 29 |
| Equipo Nuevo | 9 | 4 |
| Equipo para servicio de mantenimiento | 1 | 1 |

**P5 — Antigüedad de la sincronización.** Última sincronización de la base: 45 segundos antes de la consulta. De los 35 abiertos, 31 se sincronizaron el mismo día y 4 llevan más de un día: tres de Zoho (689 desde el 18/06/2026; 881 y 882 desde el 14/09/2026) y el 10005, que nació en la app y no tiene fecha de sincronización.

**P7 — Historial de eventos.** 41.521 eventos de 747 tickets, 4.304 de ellos transiciones de blueprint. El último evento es del 20/08/2026.

### Lo que confirman

- **La sincronización por detalle está en producción.** 33 de los 35 abiertos traen campos personalizados y 34 la fecha de modificación (P2), y la base se refrescó segundos antes de consultarla (P5). En la réplica del portal esos campos están vacíos en todos los tickets.
- **El tipo de servicio viene de Zoho.** 34 de 35 abiertos lo traen (P2), así que con Desk 2.0 la marca «sin tipo» de D9 afecta hoy a un solo ticket (968). El tipo puesto a mano en el portal sigue ganando. Las dos grafías de «calibración» caen en la misma clave (`claveTipoServicio`, `apps/hub-api/src/trazabilidad/dominio.ts:190-197`).
- **El flujo se puede leer de `classification`** en 34 de 35 abiertos (D11). Hay una tercera grafía, «Equipo para servicio de mantenimiento», en el ticket nacido en la app; no es equipo nuevo, así que va al flujo de servicio.
- **Ninguna prioridad fijada** (D1): FIFO puro.
- **El historial de eventos no sirve para llegadas recientes:** se detuvo el 20/08/2026 (P7). Coherente con D8.

### Dos consecuencias para el diseño

Las dos se llevaron a Gerencia y quedaron decididas el mismo día: la primera en D13 y la segunda en D12.

1. **«Sin confirmar» no puede medirse igual con Desk 2.0.** Su sincronización solo relee los tickets que cambian en Zoho. Un ticket que nadie toca conserva una fecha de sincronización antigua aunque su estado sea correcto: es el caso del 689, el 881 y el 882, cuyo estado coincidía con Zoho Desk el 06/10/2026. Y un ticket nacido en la app no tiene fecha de sincronización nunca. Con la regla de D7 tal cual («más de un día sin refrescar») esos cuatro saldrían marcados de forma permanente. El adaptador excluye de la marca a los tickets gestionados por la app; para los de Zoho, la marca con Desk 2.0 significa «sin cambios desde hace más de un día», no «dato dudoso». Como D7 los mantiene en la agenda en cualquier caso, no altera la proyección, solo el rótulo.
2. **Hay una fecha de remisión de entrada utilizable.** `desk.tickets.fecha_remision_entrada` viene rellena en 30 de los 35 abiertos (P2, P6). Es la fecha que el taller escribe en Zoho al recibir el equipo, con precisión de día. No es una reconstrucción del historial, sino una columna actual, y es justo el criterio de la regla 4. Los cinco que no la tienen son los tres «Ingresado» (880, 881, 882), el «OV asignada» (996) y el 968.

### Cómo se resolvió

- **Orden por fecha de remisión de entrada:** aceptado como D12. El ejemplo H está rehecho con ese orden.
- **Tickets en «Ingresado» sin fecha de remisión:** Gerencia confirma que el equipo sí llegó y que falta escribir la fecha en Zoho. Van al final de la fila con la marca «falta fecha de remisión» (D12).
- **Marca «sin confirmar»:** eliminada. La sustituye un aviso global cuando la sincronización de la fuente lleva más de una hora parada (D13).

### Consultas ejecutadas

```sql
SET default_transaction_read_only = on;
SET search_path = desk, public;
SELECT status_type, status, count(*) AS abiertos, 'P1 abiertos por estado' AS consulta FROM tickets WHERE status_type IS DISTINCT FROM 'Closed' GROUP BY 1, 2 ORDER BY 1, 3 DESC;
SELECT count(*) AS abiertos, count(NULLIF(trim(tipo_servicio), '')) AS con_tipo_servicio, count(fecha_creacion_ticket) AS con_fecha_creacion, count(fecha_remision_entrada) AS con_fecha_remision, count(*) FILTER (WHERE custom_fields <> '{}'::jsonb) AS con_campos_personalizados, count(modified_time) AS con_fecha_modificacion, count(NULLIF(trim(classification), '')) AS con_clasificacion, count(prioridad_en_app_at) AS con_prioridad_fijada, 'P2 completitud de los abiertos' AS consulta FROM tickets WHERE status_type IS DISTINCT FROM 'Closed';
SELECT NULLIF(trim(tipo_servicio), '') AS tipo_servicio, count(*) AS abiertos, 'P3 tipo de servicio' AS consulta FROM tickets WHERE status_type IS DISTINCT FROM 'Closed' GROUP BY 1 ORDER BY 2 DESC;
SELECT NULLIF(trim(classification), '') AS classification, count(*) AS tickets, count(*) FILTER (WHERE status_type IS DISTINCT FROM 'Closed') AS abiertos, 'P4 clasificacion' AS consulta FROM tickets GROUP BY 1 ORDER BY 2 DESC;
SELECT now() AS ahora, max(synced_at) AS ultima_sync_global, min(synced_at) FILTER (WHERE status_type IS DISTINCT FROM 'Closed') AS sync_mas_antigua_abiertos, max(synced_at) FILTER (WHERE status_type IS DISTINCT FROM 'Closed') AS sync_mas_reciente_abiertos, count(*) FILTER (WHERE status_type IS DISTINCT FROM 'Closed' AND (synced_at IS NULL OR synced_at < now() - interval '1 day')) AS abiertos_sin_confirmar, count(*) FILTER (WHERE status_type IS DISTINCT FROM 'Closed' AND synced_at IS NULL) AS abiertos_sin_sync, 'P5 antiguedad de la sincronizacion' AS consulta FROM tickets;
SELECT number AS ticket, status, NULLIF(trim(classification), '') AS classification, NULLIF(trim(tipo_servicio), '') AS tipo_servicio, fecha_creacion_ticket, fecha_remision_entrada, created_time::date AS creado, synced_at::date AS sync, managed_by_app, 'P6 abiertos' AS consulta FROM tickets WHERE status_type IS DISTINCT FROM 'Closed' ORDER BY number;
SELECT count(*) AS eventos, count(*) FILTER (WHERE event_name = 'BlueprintTransitionPerformed') AS transiciones_blueprint, count(DISTINCT ticket_id) AS tickets, max(event_time)::date AS ultimo_evento, 'P7 historial de eventos' AS consulta FROM ticket_history;
```

---

## J. Plan de construcción

Siete lotes pequeños, en orden, y un octavo anotado para después (unificar el historial). Cada uno se entrega con sus pruebas en verde, con TDD estricto, y por debajo de 800 líneas de cambio. Datos de prueba siempre ficticios. Ningún lote envía correo ni escribe en Desk 2.0 o Zoho.

Rutas base: `H` = `apps/hub-api/src/trazabilidad`, `M` = `apps/hub-api/src/users/migrations`, `U` = `apps/trazabilidad-mantenimientos/src`.

### Lote 1 — Adaptador de fuente con respaldo

- **Objetivo:** que hub-api pueda leer los tickets abiertos de Desk 2.0 por `DESK2_DB_URL` y caer a la réplica sin romperse (D4).
- **Ficheros:** `H/fuente.ts` (interfaz, `TicketTaller`, `elegirFuente`), `H/fuente-desk2.ts`, `H/fuente-replica.ts`, `apps/hub-api/src/db-desk2.ts` (pool opcional, perezoso, solo lectura, con `statement_timeout`), `apps/hub-api/.env.example`, `apps/hub-api/README.md`, `apps/hub-api/src/test-db/harness.ts` (tablas mínimas de Desk 2.0 para pruebas).
- **Migración:** ninguna.
- **Pruebas:**
  - Sin variable → fuente réplica y motivo «sin configurar».
  - Conexión que falla o consulta que caduca → respaldo, sin excepción hacia fuera.
  - Cruce por número; ticket `app-` desde 10.000.
  - Flujo por `classification`; flujo deducido en la réplica (asunto y `HV_`).
  - Llegada exacta desde `ticket_transitions`; aproximada desde el historial del portal.
  - Prioridad: solo la fijada (`prioridad_en_app_at`); el `High` / `Low` de Zoho da 0.
  - Fecha de remisión de entrada (`fecha_remision_entrada`) leída de Desk 2.0; vacía en respaldo si la réplica no la trae (D12).
  - Última sincronización de la fuente = máximo de `synced_at` de toda la tabla; los tickets nacidos en la app, sin fecha, no la alteran (D13).
  - El adaptador no calcula ninguna marca «sin confirmar» por ticket (D13).
  - Tipo de servicio leído de Desk 2.0; el puesto a mano en el portal gana.
  - Cierres: lista de fechas con Desk 2.0, vacía en respaldo.
  - Guarda: el módulo no contiene ninguna sentencia de escritura contra Desk 2.0.
- **Comprobación manual al desplegar:** que hub-api alcanza `desk-db` con el rol `portal_agenda_reader`.

### Lote 2 — Configuración: modelo y reglas

**Construido.** Sin endpoints ni pantalla.

- **Objetivo:** categoría y etapa por estado, puestos por etapa y duraciones por etapa y tipo, con sus reglas puras.
- **Ficheros:**
  - `H/dominio.ts`: categorías, etapas, catálogo de C.3 (`CATALOGO_ESTADOS_AGENDA`), `categoriaDeEstado`, `flujoDeTicket` (D11), `etapaInicial` y `duracionDeEtapa` (D9).
  - `H/agenda-calendario.ts`: `esHabilAgenda` y `sumarDiasHabilesAgenda` (D3). Usa `esHabil` de `H/plazos.ts`, que solo pasó a exportarse.
  - `H/types.ts`: tipos y validadores (`validarCategoriaEstado`, `validarPuestosEtapa`, `validarDuracionEtapa`).
  - `H/repo.ts`: `leerCategoriasEstados`, `guardarCategoriaEstado`, `leerConfigAgenda`, `guardarPuestosEtapa` y `guardarDuracionEtapa`.
  - `H/fuente.ts` y `H/fuente-replica.ts`: `TicketTaller` lleva `asunto` y `codigoServicio`, leídos solo de la réplica, para deducir el flujo en respaldo.
  - `apps/hub-api/src/db.ts`: registro de las dos migraciones.
- **Migración:** `M/050_trazabilidad_estados_categoria.sql` y `M/051_trazabilidad_agenda_config.sql`, las dos con semilla (E.1 y E.2).
- **Pruebas** (`H/agenda-config.test.ts` y `H/agenda-config.db.test.ts`):
  - Guardas de migración: idempotentes, sin referencia al esquema `desk`, CHECK y semillas coherentes con las constantes.
  - Catálogo frente a fila guardada; la fila gana; un estado desconocido queda sin categoría.
  - `(categoria = 'activa')` exige etapa, en la validación y en la tabla.
  - Guardar la categoría no toca el papel, y elegir el papel no toca la categoría.
  - Flujo por `classification`; deducido en respaldo del asunto y de `HV_`.
  - La fila «*» no se puede borrar; duración por tipo y por defecto (D9).
  - Calendario con un cierre de empresa en mitad de una duración (D3).
  - Reejecutar las migraciones no pisa lo editado, tampoco sobre una tabla anterior a la 050 con papeles ya elegidos.
- **Pasa al lote 5:** la actualización parcial de `PUT /estados` y la validación del cuerpo de cada `PUT`, que se monta sobre los validadores de este lote. Cada escritura va con `config.write`.

### Lote 3 — Filas y proyección (puro)

**Construido** (`H/agenda.ts`, `proyectarAgenda`; pruebas en `H/agenda.test.ts`). Sin endpoints ni pantalla. Lo que quedó distinto de lo previsto, o decidido donde este documento no decidía:

- **Dos entradas más, opcionales**, que rellenará el lote 4: `vuelvenDeStandby` (los tickets que el historial muestra volviendo de un standby; la función no lee el historial) y `flujosManuales` (D11). Sin ellas nadie cuenta como vuelto y el flujo es el de la fuente.
- **La llegada a un estado es solo la de la fuente** (`llegadaEstado`). La del historial del portal (B.5, punto 2) no entra todavía: sin llegada exacta el orden es por número, con «orden aproximado».
- **La prioridad (D1) va por delante de toda la fila**, también del corte entre el grupo A y el B de F.3.
- **«Orden aproximado» también en la primera etapa** cuando dos tickets comparten día de remisión y los separa el número. Quien no tiene fecha lleva solo «falta fecha de remisión».
- **La asignación lleva `desde` como día** (el `inicio` de E.3), no como instante.
- **Sin asignaciones, la saturación es 0 / puestos** y todos los de la etapa están en la fila: las fechas son las mismas que da H tras el reparto inicial.
- **El aviso de sincronización parada lee `estadoFuente.sincronizacionParada`.** El umbral de una hora lo aplica la fuente (lote 1), que es quien tiene el reloj.
- **Cadena de equipo nuevo:** los que llegarán de Proceso a Verificación van en una lista aparte de la etapa (`encadenados`), detrás de su fila; el primer hueco de la etapa es el de la fila propia.
- **Sin duración** (ni la del tipo ni la «*», que por SQL sí puede faltar): marca, sin fechas y sin reservar puesto. Un puesto ocupado por un ticket sin duración no se promete a nadie.
- **Una asignación cuyo ticket está en la fuente pero ya no en esa etapa no cuenta:** manda el estado, hasta que el lote 4 la cierre.
- **No cubierto aquí, porque es una acción del lote 4:** liberar un puesto a mano (D7).

- **Objetivo:** la función pura que, con tickets, configuración, asignaciones, «hoy» y calendario, devuelve puestos, filas, fechas previstas, saturación y primer hueco.
- **Ficheros:** `H/agenda.ts` y `H/agenda.test.ts`. Usa `sumarDiasHabilesAgenda` de `H/agenda-calendario.ts` (lote 2), que ya descuenta los cierres; `H/plazos.ts` no se toca.
- **Migración:** ninguna.
- **Pruebas:** un caso por cada fila de F.6, más:
  - Orden de la fila de entrada y de la primera etapa (D12): fecha de remisión; mismo día → llegada exacta primero, luego número; sin fecha → al final con «falta fecha de remisión».
  - En respaldo, sin fecha de remisión en ningún ticket: orden por llegada y número, sin la marca (D8).
  - Orden en etapas siguientes y vuelta de standby: llegada al estado y número; marca «orden aproximado».
  - La prioridad fijada en Desk 2.0 va por delante de todo lo anterior (D1).
  - Aviso global de sincronización parada: salta por encima del umbral de una hora y no por debajo; no marca tickets ni cambia la proyección (D13).
  - Festivo y cierre de empresa en mitad de una duración.
  - El ejemplo de la sección H, con datos ficticios equivalentes, da las mismas fechas.
  - Equipo nuevo encadenado Proceso → Verificación.
  - Reducción de puestos con ocupación.

### Lote 4 — Asignaciones y arranque

Partido en dos el 07/10/2026 y **construido entero**: el 4a primero y, tras decidirse D17, el 4b.

#### Lote 4a — Construido

Sin endpoints ni pantalla.

- **Objetivo:** guardar asignaciones, liberar a mano, marcar el flujo, proponer y confirmar el reparto inicial, y la lectura que reúne todo lo que pide la proyección.
- **Ficheros:**
  - `M/052_trazabilidad_agenda_asignaciones.sql` y `M/053_trazabilidad_agenda_flujo.sql` (E.3 y E.4), sin semilla, registradas en `apps/hub-api/src/db.ts`.
  - `H/agenda.ts`: D16 en `proyectarAgenda`, `vuelvenDeStandby`, `proponerReparto` e `inicioDeReparto` (puras). `H/agenda-calendario.ts`: `primerDiaHabilAgenda`.
  - `H/types.ts`: `validarAsignacion`, `validarReparto`, `validarLiberacion`, `validarFlujoManual`, `validarNumeroTicket` y las constantes de origen y cierre.
  - `H/repo.ts`: las funciones de E.5.
- **Pruebas:** `H/agenda.test.ts` (D16, `vuelvenDeStandby`, `proponerReparto`; el ejemplo H sigue dando las mismas fechas), `H/agenda-asignaciones.test.ts` (guardas de la 052 y la 053, y la de «última migración») y `H/agenda-asignaciones.db.test.ts` (restricciones, las dos migraciones repetidas, asignar, puesto ocupado, motivo, dos peticiones a la vez, reparto todo o nada —también cuando falla la base—, liberar, flujo a mano y `leerAgenda` en principal y en respaldo).
- **Lo que quedó distinto del plan, o decidido donde no lo estaba:**
  - **«El primero de la fila» es el primero que ya está en un estado de la etapa.** Un ticket en la fila de entrada puede ir delante por fecha de remisión, pero no puede recibir puesto: asignar al primero que sí puede no pide motivo.
  - **Asignar exige que el ticket esté en un estado de esa etapa** según la fuente: ni fila de entrada, ni standby, ni otra etapa, ni un ticket que la fuente no trae.
  - **El flujo a mano solo vale sin `classification`** (B.7).
  - **«Vuelve de standby»** leía en el 4a el historial de «Servicios»; desde el 4b lee el de la agenda.
  - **`cierre = 'reparto'`** existe en la tabla y nadie lo escribe todavía.

#### Lote 4b — Construido (opción B, D17)

- **Objetivo:** el historial propio de la agenda desde la fuente principal, sin apuntar en respaldo, y el cierre automático de las asignaciones en esa misma pasada, transacción y bloqueo. «Servicios», `registrarEstados` y `tmc_estados_historial` no cambian.
- **Ficheros:** `M/054_trazabilidad_agenda_historial.sql` (E.6); `H/fuente.ts` (`abiertosConOrigen`: los abiertos y quién los dio); `H/repo.ts` (`registrarEstadosAgenda`, y `leerEntradaAgenda` pasa a leer `tmc_agenda_historial`); `H/registro-estados.ts` (`registrarAgendaSinFallar` y la opción `agenda` del programador); `apps/hub-api/src/index.ts` (la enciende).
- **Pruebas:** `H/agenda-historial.db.test.ts` (la 054 repetida; primer arranque; cierre al pasar a standby, a fin de taller, a otra etapa y al cerrarse o desaparecer, y no al cambiar de estado dentro de la etapa; ida y vuelta de standby; nada escrito sin la variable ni con la principal caída mientras «Servicios» sigue apuntando; varias pasadas de la agenda a la vez; la de «Servicios» y la de la agenda a la vez; y que cada bloqueo es independiente), `H/registro-agenda.test.ts` (las dos pasadas en el programador sin esperarse ni contagiarse los fallos) y la guarda de la 054 en `H/agenda-asignaciones.test.ts`. Las pruebas que ya había de `registrarEstados` y de «Servicios» siguen en verde sin tocarlas.
- **Decidido aquí:**
  - **La fuente se lee con el bloqueo ya cogido**, para que dos pasadas a la vez no puedan escribir una lectura vieja sobre una nueva. A cambio, mientras la principal tarda en fallar la pasada retiene una conexión de la base del portal (y solo su bloqueo).
  - **Un estado sin categoría también saca al ticket de su etapa** y cierra la asignación: es lo mismo que ya hacía la proyección al no contarla.
  - **La pasada solo sale del programador.** `GET /servicios` no la dispara; `GET /agenda` (lote 5) podrá pedirla antes de leer.
  - **Sin `DESK2_DB_URL` el historial de la agenda no crece y nada se cierra solo**: queda la liberación a mano (D7).

**Por qué no se hizo lo que B.5 pedía en un principio** (un único historial pasado a la principal). Se conserva el análisis:

- **Qué se pedía:** que `registrarEstados` leyera de la fuente principal y no apuntara en respaldo.
- **Por qué se paró.** «Servicios» lee sus tickets y el estado de ahora de la réplica (`H/repo.ts`, `listarServicios`), y con ese estado y los tramos de `tmc_estados_historial` calcula el reloj (`calcularReloj`, `H/plazos.ts`). Si el historial pasa a escribirse desde la principal:
  1. **Sin `DESK2_DB_URL` el historial deja de crecer.** Sin la variable la fuente es siempre «respaldo» (`H/fuente.ts`, `leer`), así que «no apuntar en respaldo» es no apuntar nunca. Los tramos abiertos se quedan como estén: quien entre después en standby solo tiene en pausa el día de hoy, quien salga sigue en pausa para siempre, y un «trabajo terminado» nuevo queda sin fecha ni veredicto. Lo mismo, mientras dure, cada vez que Desk 2.0 no conteste.
  2. **Estado de ahora de una base, pasado de la otra.** El día de hoy lo decide el estado de la réplica y los días anteriores, los tramos de la principal. Si discrepan, un mismo día cuenta como pausa hoy y como activo mañana, y la fecha límite cambia sola.
  3. **Un cierre que solo ve una.** El 884 (cerrado en Desk 2.0, «Ingresado» en la réplica) perdería su tramo y «Servicios» lo seguiría listando, ya sin historial. Un ticket que solo está en la réplica no tendría historial nunca.
  4. **El día del cambio.** La primera pasada desde la principal apuntaría como cambio visto (`desde_real`) cada discrepancia entre las dos bases, con la hora del despliegue: un «terminado» con fecha y veredicto inventados.
- **El cierre automático depende de lo mismo:** hecho con la pasada de hoy cerraría, por el estado de la réplica, asignaciones que se dieron con el de la principal (la de un ticket nacido en la app, a los cinco minutos).
- **Opciones:**
  - **A. Tal como está escrito.** Exige `DESK2_DB_URL` en todo entorno y acepta los puntos 2 a 4 en «Servicios».
  - **B. Un historial por fuente.** `tmc_estados_historial` sigue como hoy, de la réplica, para «Servicios»; la agenda lleva el suyo, de la principal y sin apuntar en respaldo, y en esa pasada se cierran las asignaciones. «Servicios» no cambia en nada. Cuesta una migración (054) y una segunda pasada.
  - **C. Como A, pero sin la variable se sigue apuntando desde la réplica** (sin ella no hay alternancia posible); solo un fallo de una principal configurada suspende el historial. Resuelve el punto 1 a medias (no las caídas) y deja los puntos 2 a 4.
  - **D. Pasar también «Servicios» a la fuente de la agenda**, para que tickets e historial salgan del mismo sitio. Es lo coherente a largo plazo, pero cambia «Servicios» y la fuente no trae hoy lo que esa pantalla enseña (serial, asunto, contacto).
- **Decidido (D17):** B. La D queda anotada como lote 8.

### Lote 5 — API

**Construido** el 07/10/2026, entero y sin partir (D18, D19 y D20; endpoints en E.7). Sin pantalla.

- **Ficheros, además de los previstos:** `H/fuente.ts` (cortacircuitos de la principal, pendiente desde el lote 1), `H/registro-estados.ts` (`agendaAlDia`: la puerta de la pasada dice si salió bien), `H/agenda.ts` (`huecosDeEtapa`), `H/repo.ts` (`leerConfiguracionAgenda`, la firma de la categoría en `listarEstadosDesk` y el 409 que nombra el puesto) y `apps/hub-api/src/index.ts` (una sola fuente para las rutas y el programador).
- **Pruebas:** `H/router.test.ts` (cada ruta: 401, 403 sin la app, 403 por rol, 400, 404 y 409; la pasada a demanda; la guarda de permisos ruta a ruta), `H/agenda-api.db.test.ts` (de punta a punta con la imitación de Desk 2.0: leer → repartir → asignar → cambio de estado → pasada a demanda → cierre → la agenda lo refleja; y el cortacircuitos con una principal caída de verdad), `H/fuente.test.ts` (cortacircuitos con reloj inyectado), `H/agenda.test.ts` (huecos) y `H/registro-agenda.test.ts` (`agendaAlDia`).
- **Lo aplazado del lote 2, cerrado:** `PUT /estados` se queda como está y la categoría va por su ruta (E.1); `GET /estados` devuelve además la firma de la categoría.
- **Lo que queda de la API para el lote 7:** los festivos y cierres del eje del Gantt en `GET /agenda` (E.7).

Plan original:

- **Objetivo:** exponer la agenda y su configuración.
- **Ficheros:** `H/router.ts`, `H/types.ts` (formas de respuesta) y `H/router.test.ts`.
- **Migración:** ninguna.
- **Pruebas:**
  - Todos los endpoints de E.7 tras `requireAuth` + `requireApp`.
  - Los que escriben exigen además su permiso (`agenda.*` o `config.write`, E.7), que hoy solo tiene el rol `DIRECTOR_TECNICO`; sin él, 403 (D14). Cada ruta nueva se apunta en la lista `ESCRITURAS` de `router.test.ts`.
  - Validación con mensajes en español.
  - `GET /agenda` responde aunque Desk 2.0 no conteste, indicando el respaldo y su motivo.
  - `?hoy=` determinista.
  - Guarda existente de «ningún código de envío» sigue en verde.

### Lote 6 — Pantalla: Configuración

- **Objetivo:** que el Director Técnico pueda ajustar puestos, duraciones y la categoría y etapa de cada estado (D14). Quien no tiene el rol ve la configuración sin poder editarla.
- **Ficheros:** `U/api.ts`, `U/dominio.ts`, `U/lib/agenda.ts` (textos y opciones) con su prueba, `U/vistas/Configuracion.tsx` (bloque «Agenda del taller» y dos columnas en «Estados de Desk»).
- **Migración:** ninguna.
- **Pruebas:** ayudantes puros de `lib/agenda.ts`; typecheck, build del portal y lint.

### Lote 7 — Pantalla: Agenda del taller

- **Objetivo:** la pestaña con el Gantt por puesto, las filas, el carril de standby, la saturación, el primer hueco, el reparto inicial y las acciones de asignar y liberar.
- **Ficheros:** `U/App.tsx` (pestaña), `U/vistas/Agenda.tsx`, `U/lib/agenda.ts` (geometría de barras por puesto, apoyada en `U/lib/servicios.ts`) con su prueba, y `apps/trazabilidad-mantenimientos/CLAUDE.md`.
- **Migración:** ninguna.
- **Pruebas:**
  - Geometría: barra ocupada, prevista, pasada de fecha, recorte en los bordes del eje.
  - Textos del rótulo de fuente en principal y en respaldo, del aviso de sincronización parada y de la marca «falta fecha de remisión».
  - Las acciones solo se ofrecen al Director Técnico.
  - Typecheck, build del portal y lint.
  - Revisión visual en navegador antes de darlo por bueno; es lo único que las pruebas no cubren.
- **Si supera las 800 líneas:** se parte en 7a (lectura: Gantt, filas, standby) y 7b (acciones: arranque, asignar, liberar).

### Lote 8 (posterior) — «Servicios» lee de la fuente de la agenda y se unifica el historial

Anotado el 07/10/2026; sin fecha y fuera de los siete lotes de la agenda.

- **Objetivo:** que «Servicios» lea sus tickets de la misma fuente que la agenda (Desk 2.0, con la réplica de respaldo) y que haya **un solo historial de estados**, en vez de los dos de D17.
- **Lo que le falta hoy a la fuente** (`TicketTaller`, `H/fuente-desk2.ts`) para lo que esa pantalla enseña y calcula:
  - el **serial** del equipo (el cruce con `tmc_equipos` y el nombre del cliente);
  - el **asunto** y el **código de servicio** con la fuente principal (hoy solo se leen en respaldo): de ahí salen el modelo y el cliente «de asunto»;
  - el **contacto** (`raw->'contact'`: cuenta, nombre y apellido, y el correo que usan los avisos);
  - la marca «sin confirmar» por ticket, que la agenda descartó (D13) y «Servicios» aún enseña;
  - y el permiso de lectura del rol `portal_agenda_reader` sobre lo que haga falta de eso.
- **Lo que hay que decidir entonces:** qué pasa con el reloj del plazo mientras se está en respaldo (los puntos 1 a 4 del análisis del lote 4b vuelven a aplicar), y cómo se funden `tmc_estados_historial` y `tmc_agenda_historial` sin inventar cambios el día del cambio.
- **Migración:** la que toque entonces (la 055 es la primera libre).

### Orden y dependencias

Antes de la agenda va la fase de roles, que usa la migración 049 y aporta el rol `DIRECTOR_TECNICO`; por eso la agenda usa de la 050 a la 054. Los lotes 1 a 4 no dependen del rol; el 5, el 6 y el 7, sí.

`1 → 2 → 3 → 4 → 5 → 6 → 7`. El 3 solo depende de los tipos del 1 y de las constantes del 2. El 6 puede desplegarse antes que el 7 para que la configuración esté lista cuando llegue la pantalla. En cada despliegue, hub-api antes que el portal.
