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

Ajustes decididos el mismo día:

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

Una sola interfaz y dos implementaciones. Todo lo demás (categorías, puestos, duraciones, asignaciones, proyección) trabaja sobre `TicketTaller` y no sabe de dónde viene.

```ts
interface FuenteTaller {
  nombre: 'desk2' | 'replica';
  ticketsAbiertos(): Promise<TicketTaller[]>;
  cierres(desde: string, hasta: string): Promise<string[]>;     // [] con la réplica
  ultimaSincronizacion(): Promise<number | null>;               // máximo de synced_at de la base (D13)
  capacidades: { prioridad: boolean; cierres: boolean; llegadaExacta: boolean; flujoPorClasificacion: boolean };
}
interface TicketTaller {
  numero: number;
  estado: string;
  flujo: 'servicio' | 'equipo_nuevo';
  flujoOrigen: 'clasificacion' | 'deducido' | 'manual';
  prioridad: number;                                             // 0 = sin prioridad fijada
  llegada: { instante: number | null; exacta: boolean };         // entrada en el estado actual
  remisionEntrada: string | null;                                // fecha_remision_entrada, AAAA-MM-DD (D12)
}
const UMBRAL_SINCRONIZACION_PARADA_MS = 60 * 60 * 1000;          // D13: una hora
// elegirFuente(): desk2 si hay DESK2_DB_URL y responde; si no, replica. Devuelve además el motivo del respaldo.
```

### B.5 El orden de llegada

**Fila de entrada (D12).** Manda `fecha_remision_entrada`, ascendente. Con el mismo día, va primero el ticket con llegada exacta en `desk.ticket_transitions`; si no, el de número más bajo. Sin fecha, al final de la fila, con la marca «falta fecha de remisión».

La misma regla ordena a los tickets que ya están en su primera etapa sin puesto, porque llegaron a ella desde la fila de entrada (regla 4). La excepción son los que el historial muestra volviendo de un standby: esos van al final, por el momento en que regresaron.

**Etapas siguientes y vuelta de standby.** Manda la llegada al estado, por orden de preferencia:

1. **Transición de Desk 2.0:** último `performed_at` de `desk.ticket_transitions` con `to_status` = estado actual. Exacta.
2. **Historial del portal:** `desde` del tramo abierto en `tmc_estados_historial`. Exacta al minuto si `desde_real = TRUE`; aproximada si es primera observación.
3. **Sin dato:** al final, por número de ticket.

**El historial del portal debe seguir a la fuente principal.** Hoy `registrarEstados` lee la réplica (`repo.ts:645-689`). Con D4 debe leer del adaptador, y **no apuntar nada mientras se esté en respaldo**: las dos bases pueden discrepar (el 884 es «Finalizado» en una e «Ingresado» en la otra), y alternar de fuente escribiría cambios de estado que nunca ocurrieron.

### B.6 Prioridad (D1)

- **Criterio:** rango `Urgent` 4, `High` 3, `Medium` 2, `Low` 1 (`Desk2:packages/shared/src/prioridad.ts:22-23`, `:95-109`).
- **Solo cuenta la prioridad fijada en Desk 2.0**, es decir, la de tickets con `prioridad_en_app_at` relleno (`Desk2:apps/desk/server/db/prioridadCliente.ts:106-124`). El resto se trata como «sin prioridad».
- **Hoy no hay ninguna fijada** (D6): los `High` / `Low` que se ven en las dos bases son el valor de Zoho (Z2, D6) y no se usan. La fila es FIFO puro.

### B.7 Flujo: servicio o equipo nuevo (D11)

- **Con Desk 2.0:** equipo nuevo si `classification` normaliza a «equipo nuevo»; si no, servicio (`Desk2:packages/shared/src/flujos.ts:51-61`). Hoy son equipo nuevo los tickets 1000, 1001, 1002 y 1008 (D5).
- **Con la réplica:** `classification` está vacío (Z3). Se deduce: equipo nuevo si el asunto empieza por «Equipo Nuevo» o el código de servicio empieza por `HV_`.
- **Marca a mano por ticket:** gana siempre, con cualquier fuente. Se guarda en una tabla del portal (E.4).

### B.8 Aviso de sincronización parada (D13)

Ningún ticket lleva marca de «sin confirmar». La agenda muestra un aviso global cuando el máximo de `synced_at` de la base de la fuente activa tiene más de una hora (`UMBRAL_SINCRONIZACION_PARADA_MS`).

Se mide sobre toda la tabla, no por ticket, porque la sincronización de Desk 2.0 solo relee lo que cambia en Zoho: un ticket que nadie toca conserva una fecha antigua aunque su estado sea correcto (689, 881 y 882 el 06/10/2026, P6), y un ticket nacido en la app no la tiene nunca (10005). El máximo de la tabla, en cambio, se mueve cada pocos minutos mientras la sincronización funciona: el 06/10/2026 tenía 45 segundos (P5).

### B.9 Quién opera la agenda (D14)

El Director Técnico (rol `DIRECTOR_TECNICO`) confirma el reparto inicial, asigna y libera puestos, marca el flujo y configura puestos y duraciones. El resto de quienes tienen la app asignada solo consultan.

El rol llega con la fase de roles, que se construye antes que la agenda y usa la migración 049.

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

Todo en el esquema `portal`, migraciones idempotentes de la 050 a la 053. La última registrada hoy es la 048 (`apps/hub-api/src/db.ts:24`); la 049 queda reservada para la fase de roles, que va antes. Se reejecutan en cada arranque. Ninguna toca el esquema `desk` ni la base de Desk 2.0.

### E.1 Migración 050 — categoría y etapa de cada estado

Extiende `portal.tmc_estados_desk`; sin tabla paralela. No se puede editar la 046: `CREATE TABLE IF NOT EXISTS` no altera una tabla existente y las guardas de pruebas le prohíben `ALTER` (`apps/hub-api/src/trazabilidad/plazos.test.ts:501-509`). Precedentes de `ADD COLUMN IF NOT EXISTS`: `031_registro_exportadores.sql:21-22`, `034_token_version.sql:17`; de CHECK añadido de forma idempotente: `016_ausencias_historico.sql:36-45`.

```sql
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS categoria VARCHAR(12) NULL;
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS etapa     VARCHAR(12) NULL;
-- CHECK con nombre, dentro de DO $$ … IF NOT EXISTS (pg_constraint) … $$:
--   categoria IN ('por_llegar','entrada','activa','standby','fin','fuera')
--   etapa     IN ('diagnostico','proceso','verificacion')
--   (categoria = 'activa') = (etapa IS NOT NULL)
```

- **Valor por defecto en código, la tabla manda.** Una fila solo existe para los estados que alguien ha tocado y `actualizado_por` es obligatorio, así que no se siembra. El catálogo de C.3 vive como constante en `dominio.ts`; si la fila tiene `categoria`, gana la fila. `NULL` = «según el catálogo».
- **Contrato del PUT.** Hoy `PUT /estados` exige `rol` y lo sobrescribe siempre (`apps/hub-api/src/trazabilidad/types.ts:423-433`, `repo.ts:609-618`). Pasa a actualización parcial: `{ estado, rol?, categoria?, etapa? }`.
- **Guardas a actualizar:** la lista exacta de columnas de la tabla (`apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts:917-918`) y la que comprueba cuál es la última migración registrada (`plazos.test.ts:613-616`).

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
  sugerido         INTEGER      NULL,                          -- ticket que proponía la fila
  motivo           VARCHAR(500) NULL,                          -- obligatorio si numero <> sugerido
  origen           VARCHAR(12)  NOT NULL CHECK (origen IN ('fila','arranque')),
  asignado_por_id  UUID         NULL,
  asignado_por     VARCHAR(254) NOT NULL,
  cierre           VARCHAR(12)  NULL CHECK (cierre IN ('estado','manual','reduccion')),
  cierre_motivo    VARCHAR(500) NULL,                          -- obligatorio si cierre = 'manual' (D7)
  cerrado_por      VARCHAR(254) NULL,
  CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_puesto_uq ON portal.tmc_agenda_asignaciones (etapa, puesto) WHERE hasta IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_ticket_uq ON portal.tmc_agenda_asignaciones (numero)        WHERE hasta IS NULL;
```

- **Un puesto, un ticket; un ticket, un puesto:** lo garantizan los dos índices parciales, como `tmc_estados_historial_abierto_uq` (`047…sql:39-55`).
- **`inicio`:** el día desde el que cuenta la duración. Normalmente el día de la asignación; en el arranque (D6), el día de llegada a la etapa si es exacto, para que los ya pasados de fecha se vean como tales.
- **Cierre automático (regla 5):** en la misma pasada que apunta los estados cada 5 minutos, si el estado del ticket ya no pertenece a la etapa de su asignación vigente, se cierra con `cierre = 'estado'`.
- **Liberación a mano (D7):** `cierre = 'manual'`, con `cerrado_por` y `cierre_motivo` obligatorios.
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

### E.5 Endpoints

Todos bajo `/api/trazabilidad`, tras `requireAuth` + `requireApp('trazabilidad-mantenimientos')` (`apps/hub-api/src/trazabilidad/router.ts:63`). Los cálculos se hacen en el servidor con «hoy» como argumento (`hoyOf`, `router.ts:52-59`).

Las lecturas (`GET`) están abiertas a quien tenga la app. Todo lo que escribe exige además el rol `DIRECTOR_TECNICO` (D14).

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/agenda` (`?hoy=`) | La agenda completa: fuente activa, capacidades y motivo del respaldo; etapas con puestos y ocupación; fila de cada etapa con fecha prevista y sugerido; standby; fin de taller; por llegar; proyección; saturación; primer hueco libre; festivos y cierres del eje; aviso de sincronización parada (D13) y demás avisos |
| GET | `/agenda/arranque` | La propuesta de reparto inicial (D6), sin escribir nada |
| POST | `/agenda/arranque` | Confirma el reparto: la lista `{ numero, etapa, puesto }` tal como la deja el Director Técnico. Todo o nada |
| POST | `/agenda/asignaciones` | `{ numero, etapa, puesto, motivo? }` → asigna; exige `motivo` si no es el sugerido |
| DELETE | `/agenda/asignaciones/:id` | Libera un puesto a mano, con `motivo` obligatorio (D7) |
| GET | `/agenda/config` | Etapas con sus puestos y la tabla de duraciones |
| PUT | `/agenda/etapas` | `{ etapa, puestos }` |
| PUT | `/agenda/duraciones` | `{ etapa, tipo, dias }`; `dias` vacío borra la fila, salvo la «*» |
| PUT | `/agenda/flujo/:numero` | `{ flujo }`; vacío quita la marca manual (D11) |
| PUT | `/estados` (existente) | Se amplía con `categoria` y `etapa`, en actualización parcial |

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

fila(e) = tickets en un estado de la etapa e SIN asignación vigente      // «en etapa sin puesto»
          seguidos de tickets de 'entrada' con etapaDestino = e          // fila de entrada

clave de orden de un ticket t en la fila de e:
    0. prioridad fijada en Desk 2.0, descendente      // solo si fuente.capacidades.prioridad; hoy no hay ninguna
    si t está en 'entrada', o está en e = primeraEtapa(t) y no vuelve de standby:      // D12
        1. tiene remisionEntrada antes que no tenerla          // sin fecha → al final, «falta fecha de remisión»
        2. remisionEntrada ascendente
        3. con el mismo día: llegada exacta antes que no exacta
        4. número de ticket ascendente
    si no:                                            // etapas siguientes y vuelta de standby
        1. llegada ascendente                         // instante de entrada en el estado
        2. número de ticket ascendente
        si la llegada no es exacta o hay empate  →  «orden aproximado»

los tickets del segundo grupo van detrás de los del primero dentro de la misma fila
«vuelve de standby» = el tramo anterior del historial del portal es de categoría standby
sugerido(e) = primer ticket de fila(e)
```

Con la réplica de respaldo `remisionEntrada` viene vacía, así que todos caerían en «sin fecha»; en ese caso no se pone la marca y se ordena por llegada y número, como en D8.

### F.4 Simulación por etapa

```
para cada etapa e:
    libre = []                                             // (puesto, día en que queda libre)
    para cada puesto p de 1..puestos[e]:
        si p tiene asignación vigente a (ticket t):
            fin = sumar(a.inicio, duracion(t, e))
            si fin < hoy:  fin = sumar(hoy, 1)             // pasado de fecha: empuja (regla 6)
            barra(t, p, a.inicio, fin);  libre.añadir(p, fin)
        si no:
            libre.añadir(p, hoy)                           // hueco libre ya
    para cada ticket t de fila(e), en orden:
        (p, d) = el puesto de libre con el día más temprano     // empate → puesto de número menor
        inicio = max(d, hoy)
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
        para cada puesto libre p, por número:
            t = siguiente candidato;  si no hay, terminar
            inicio = t.llegada.exacta ? dia(t.llegada) : hoy
            propuesta.añadir(t, e, p, inicio)
    devolver propuesta          // no escribe; lo que no cabe queda en la fila
confirmarArranque(lista):       // la que deja el Director Técnico, igual o ajustada
    validar puestos y tickets;  insertar todas con origen = 'arranque' en una transacción
```

### F.6 Casos frontera

| Caso | Tratamiento |
|---|---|
| **Empate en la fila de entrada** | Misma fecha de remisión: primero el que tiene llegada exacta en `desk.ticket_transitions`; si no, el de número más bajo (D12) |
| **Ticket sin fecha de remisión** | Al final de la fila de entrada, con la marca «falta fecha de remisión». En cuanto se escribe en Zoho y se sincroniza, ocupa su sitio (D12) |
| **Empate de llegada en etapas siguientes** | Decide el número de ticket; se marca «orden aproximado» |
| **Pasado de fecha que empuja** | Sigue ocupando; fin proyectado = día hábil siguiente a hoy; se pinta en rojo. Cada día que siga ahí, toda la fila se corre un día |
| **Standby que libera y vuelve** | Al entrar en standby la asignación se cierra (`cierre = 'estado'`) y sale de la proyección. Al volver a un estado de la etapa entra al final de la fila, con la llegada del momento en que regresó |
| **Equipo nuevo, dos etapas seguidas** | Ingresado → Proceso → Verificación. Se proyecta en cadena: la llegada prevista a Verificación es el fin previsto en Proceso. Es el único caso en que una etapa alimenta a otra sin standby en medio |
| **Tipo sin duración** | No puede darse: la fila «*» de cada etapa es obligatoria y no se puede borrar (D9). Un ticket sin tipo usa la «*» y lleva la marca «sin tipo» |
| **Puesto que se reduce estando ocupado** | No se desaloja a nadie. Los puestos por encima del nuevo tope quedan «a extinguir»: siguen ocupados hasta que su ticket salga y no reciben a nadie más. La saturación puede superar el 100 % y se avisa |
| **Más tickets en la etapa que puestos** | Los que no caben encabezan la fila de esa etapa, por delante de la fila de entrada, marcados «en etapa sin puesto» (D6) |
| **Diagnóstico no encadena con Proceso** | Entre ambas hay siempre standby (notificación y aprobación del cliente), que no se proyecta. La fila de Proceso solo contiene tickets que ya están en «En Proceso» o «Continuación del proceso» |
| **Sincronización parada** | Si el máximo de `synced_at` de la fuente tiene más de una hora, aviso global arriba de la agenda. No se marca ningún ticket ni se cambia la proyección (D13) |
| **Ticket que ya no debería ocupar puesto** | El Director Técnico libera el puesto a mano, con motivo; queda registrado (D7) |
| **Cambio a respaldo** | Las asignaciones vigentes se conservan; no se cierra ninguna automáticamente ni se apunta historial mientras dure. Un ticket que solo existe en Desk 2.0 conserva su puesto, marcado «sin datos de la fuente» |
| **Ticket con marca manual de flujo** | La marca gana a la fuente; cambiarla recalcula a qué etapa alimenta |

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
4. **Dos procesos sincronizan Zoho por separado.** Desk 2.0 y el trabajador del hub pueden discrepar sobre un mismo ticket. Por eso el historial del portal no apunta en respaldo (B.5).
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
- **Que el rol `DIRECTOR_TECNICO` exista en el portal:** llega con la fase de roles (migración 049), que no se ha revisado aquí.
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

Siete lotes pequeños, en orden. Cada uno se entrega con sus pruebas en verde, con TDD estricto, y por debajo de 800 líneas de cambio. Datos de prueba siempre ficticios. Ningún lote envía correo ni escribe en Desk 2.0 o Zoho.

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

- **Objetivo:** categoría y etapa por estado, puestos por etapa y duraciones por etapa y tipo, con sus reglas puras.
- **Ficheros:** `H/dominio.ts` (categorías, etapas, catálogo por defecto de C.3, `categoriaDe`), `H/types.ts` (validación de `PUT /estados` parcial, etapas, duraciones), `H/repo.ts` (lectura y escritura), `apps/hub-api/src/db.ts` (registro de migraciones) y sus pruebas.
- **Migración:** `M/050_trazabilidad_estados_categoria.sql` y `M/051_trazabilidad_agenda_config.sql` (con semillas).
- **Pruebas:**
  - Guardas de migración: idempotentes, sin referencia al esquema `desk`, CHECK coherentes con las constantes.
  - Catálogo por defecto frente a fila guardada; la fila gana.
  - `(categoria = 'activa')` exige etapa.
  - Actualización parcial de `PUT /estados` sin pisar el papel.
  - La fila «*» no se puede borrar; duración por tipo y por defecto (D9).
  - Reejecutar las migraciones no pisa lo editado.

### Lote 3 — Filas y proyección (puro)

- **Objetivo:** la función pura que, con tickets, configuración, asignaciones, «hoy» y calendario, devuelve puestos, filas, fechas previstas, saturación y primer hueco.
- **Ficheros:** `H/agenda.ts` y `H/agenda.test.ts`. Reutiliza `sumarDiasHabiles` de `H/plazos.ts`, ampliado para descontar cierres.
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

- **Objetivo:** guardar asignaciones, cerrarlas solas, liberar a mano, marcar el flujo y proponer y confirmar el reparto inicial.
- **Ficheros:** `H/repo.ts` (asignar, liberar, cierre automático, flujo manual), `H/agenda.ts` (`proponerArranque`), `H/registro-estados.ts` y `H/repo.ts` (`registrarEstados` lee del adaptador y no apunta en respaldo; cierra asignaciones en la misma pasada), y pruebas de Postgres.
- **Migración:** `M/052_trazabilidad_agenda_asignaciones.sql` y `M/053_trazabilidad_agenda_flujo.sql`.
- **Pruebas:**
  - Un puesto, un ticket; un ticket, un puesto (índices parciales), también con dos peticiones a la vez.
  - Asignar a otro que el sugerido exige motivo.
  - Cierre automático al salir de la etapa; no al cambiar entre estados de la misma etapa.
  - Liberación manual con motivo y firma (D7).
  - Propuesta de arranque: no escribe; lo que no cabe queda en la fila; confirmar es todo o nada (D6).
  - En respaldo no se cierra ni se apunta nada.

### Lote 5 — API

- **Objetivo:** exponer la agenda y su configuración.
- **Ficheros:** `H/router.ts`, `H/types.ts` (formas de respuesta) y `H/router.test.ts`.
- **Migración:** ninguna.
- **Pruebas:**
  - Todos los endpoints de E.5 tras `requireAuth` + `requireApp`.
  - Los que escriben exigen además el rol `DIRECTOR_TECNICO`; sin él, 403 (D14).
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

### Orden y dependencias

Antes de la agenda va la fase de roles, que usa la migración 049 y aporta el rol `DIRECTOR_TECNICO`; por eso la agenda usa de la 050 a la 053. Los lotes 1 a 4 no dependen del rol; el 5, el 6 y el 7, sí.

`1 → 2 → 3 → 4 → 5 → 6 → 7`. El 3 solo depende de los tipos del 1 y de las constantes del 2. El 6 puede desplegarse antes que el 7 para que la configuración esté lista cuando llegue la pantalla. En cada despliegue, hub-api antes que el portal.
