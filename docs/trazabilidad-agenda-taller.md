# Análisis — Agenda del taller (app Trazabilidad Mantenimientos Clientes)

Fase 1, solo análisis. No cambia código, migraciones ni configuración. Fecha de los datos: **06/10/2026**.

Convenciones de este documento:

- Cada afirmación lleva ruta y línea, la referencia a una consulta (`Z1`…`Z11` en la base `zoho-hub`, `D1`…`D10` en la base `desk`, ejecutadas el 06/10/2026 en modo solo lectura) o la palabra **hipótesis**.
- Las rutas que empiezan por `Desk2:` son del repositorio de Desk 2.0 (`C:\dev\Desk_2_R1.023`, HEAD `b14cd0f`), que solo se leyó. El resto son de este repositorio.
- No hay nombres de clientes, seriales ni correos: solo números de ticket, estados y recuentos. El repositorio es público.

## Objetivo

Una **agenda del taller**: ver en calendario los tickets activos, cuándo terminará cada uno su etapa y en qué hueco entrará cada ticket que espera, para acomodar los servicios y, más adelante, permitir que el cliente reserve.

## Reglas de negocio vigentes

Decididas por Gerencia antes de este análisis (no se rediscuten):

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
| **D1** | **Fila = FIFO con prioridad.** Dentro de cada fila van primero los tickets con prioridad en Desk 2.0 (criterio de `Desk2:packages/shared/src/prioridad.ts`), por prioridad y después por llegada; el resto, por llegada. La prioridad solo se aplica con la conexión a Desk 2.0 encendida. |
| **D2** | **«Notificado» sigue ocupando el puesto**: es parte de la etapa Diagnóstico (revisión interna del Director Técnico). Solo liberan los standby que dependen del cliente, de Comercial o de terceros. |
| **D3** | **Calendario de la agenda** = días hábiles con festivos de Colombia (`apps/hub-api/src/trazabilidad/plazos.ts`) menos los cierres de empresa de Desk 2.0 (`public.calendario_cierres`). Sin conexión no se descuentan cierres y la pantalla lo avisa. No se usan horas hábiles. |
| **D4** | **Dos fuentes detrás de un adaptador**: hoy la réplica de Zoho; al encender la conexión, Desk 2.0 (remisiones, transiciones, prioridad, cierres). La agenda funciona ya con Zoho y cambia de fuente sin rehacerse. Con fuente Zoho, fila de entrada = «Ingresado»; «OV asignada» / «Ticket creado» = «por llegar», en lista aparte y sin proyectar. |

Ajustes decididos el mismo día:

- **Clasificación propia de la agenda.** La categoría de un estado en la agenda es independiente de la clasificación de esperas y SLA de Desk 2.0, porque sirven para cosas distintas. «Por Entregar» es fin de taller y libera el puesto, aunque Desk 2.0 lo trate como espera externa (`Desk2:packages/shared/src/estados.ts:59-106`). Es una diferencia documentada, no un conflicto.
- **El flujo se distingue por `classification`** (equipo nuevo frente a servicio); la etapa inicial depende del flujo.
- **Orden aproximado con fuente Zoho.** La llegada es el `desde` de `tmc_estados_historial`; si el tramo es de primera observación (`desde_real = FALSE`) o hay empate, se ordena por número de ticket y la pantalla lo marca como «orden aproximado».

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

**Consecuencia:** ningún ticket abierto hoy tiene remisión posterior al 24/07/2026, y solo 1 de los 35 abiertos tiene momento de entrada en su estado (D4). Con la conexión encendida hoy, la «orden de la remisión de entrada» de la regla 4 no tendría datos. Los tendrá cuando los tickets nazcan en Desk 2.0.

Además, «Remisión creada» solo la alcanzan los tickets nacidos en la app: su único origen es «Ticket creado» (`estadoPorRemision.ts:32-41`). Los nacidos en Zoho se quedan en «OV asignada».

### A.5 Cómo leerlas desde hub-api (solo lectura)

Hoy hub-api tiene una sola conexión, `HUB_DB_URL` (`apps/hub-api/src/db.ts:10-20`), y ningún precedente de segunda conexión. El patrón de la casa para algo opcional es «variable ausente = función apagada», como `AUSENCIAS_WEBHOOK_URL` (`apps/hub-api/src/ausencias/avisar.ts:29-31`) o `SENTRY_DSN` (`apps/hub-api/src/sentry.ts:5-19`).

Propuesta:

- **Variable nueva y opcional:** `DESK2_DB_URL`. Se documenta en `apps/hub-api/.env.example` y `apps/hub-api/README.md` y se define en el entorno del servicio en EasyPanel; no requiere tocar el Dockerfile. Ningún valor en el repositorio ni en el chat.
- **Interruptor que nace apagado:** sin la variable, la fuente es la réplica de Zoho. La agenda funciona, la fila de entrada sale de «Ingresado», no se descuentan cierres ni se aplica prioridad, y la pantalla lo avisa en un rótulo fijo.
- **Usuario de base de solo lectura, nuevo:** en la base `desk` solo existe el rol `postgres` (D10). Propuesta de nombre: `portal_agenda_reader`, con permisos **por tabla**, no por esquema, porque `public` contiene también la tabla de usuarios de Desk 2.0:

  ```sql
  -- A ejecutar por quien administre desk-db. La contraseña se genera allí y no se guarda en ningún repositorio.
  CREATE ROLE portal_agenda_reader LOGIN PASSWORD '<generada fuera del repo>';
  GRANT CONNECT ON DATABASE desk TO portal_agenda_reader;
  GRANT USAGE ON SCHEMA desk, public TO portal_agenda_reader;
  GRANT SELECT ON desk.tickets, desk.ticket_transitions TO portal_agenda_reader;
  GRANT SELECT ON public.remisiones, public.calendario_cierres TO portal_agenda_reader;
  ALTER ROLE portal_agenda_reader SET default_transaction_read_only = on;
  ```

- **Conexión defensiva:** pool propio, pequeño y perezoso; `statement_timeout` corto; lectura siempre dentro de `try`. Si la lectura falla, la agenda cae a la fuente Zoho con un aviso, igual que `registrarEstadosSinFallar` no rompe `GET /servicios` (`apps/hub-api/src/trazabilidad/registro-estados.ts:85-92`).
- **Red:** falta comprobar que el servicio hub-api alcanza `desk-db` dentro de EasyPanel (**no verificado**).

---

## B. Tickets: cómo se casan y qué fuente manda

### B.1 Identidad

- **Tickets de Zoho:** id numérico de Zoho y número correlativo. En la base `desk` hay 775, con números del 171 al 1010 (D3); son los mismos números que ve el portal en la réplica (Z5 frente a D5).
- **Tickets nacidos en Desk 2.0:** id `app-<uuid>` (`Desk2:packages/zoho-sync/src/db/repo.ts:413`) y número tomado de una secuencia que arranca en 10.000 (`Desk2:packages/zoho-sync/src/db/migrate.ts:43-50`). Hoy hay uno, el 10005 (D3).
- **Los rangos no se pisan:** Zoho va por el 1010 y la app empieza en 10.000.

**El casamiento se hace por `number`.** Todas las tablas del portal ya usan el número (`tmc_servicios_tipo.numero`, `tmc_estados_historial.numero`), así que no hay que migrar claves. El id se guarda como dato secundario.

### B.2 Qué fuente manda para el estado

| Situación | Manda | Motivo |
|---|---|---|
| Conexión apagada | Réplica de Zoho | Única fuente disponible |
| Conexión encendida, ticket en ambas | **Desk 2.0** | Es un superconjunto y está más al día (ver abajo) |
| Conexión encendida, ticket solo en Desk 2.0 (`app-`) | Desk 2.0 | No existe en Zoho |
| Conexión encendida, ticket solo en la réplica | Réplica, marcado «solo en Zoho» | No debería ocurrir; se muestra y se avisa |

Motivos para que mande Desk 2.0:

- **Es un superconjunto.** Su `desk.tickets` contiene los 775 tickets de Zoho más los nacidos en la app (D3).
- **Está más al día.** El ticket 884 figura «Finalizado» en Desk 2.0 (741 cerrados, D2) y sigue «Ingresado» en la réplica del portal (740 cerrados, Z1). El trabajador del hub solo relee los 100 tickets más recientes.
- **Cuando la app toca un ticket, Zoho deja de mandar.** Con `managed_by_app = true` la sincronización no reescribe la fila (`Desk2:packages/zoho-sync/src/db/repo.ts:71`), así que la réplica de Zoho quedaría desfasada para ese ticket.
- **Desk 2.0 sustituirá a Zoho Desk.** Con el adaptador, apagar Zoho es no usar más la fuente antigua.

### B.3 El adaptador

Una sola interfaz, dos implementaciones. Boceto:

```ts
interface FuenteTaller {
  nombre: 'zoho' | 'desk2';
  ticketsAbiertos(): Promise<TicketTaller[]>;   // numero, estado, flujo, prioridad, llegada
  cierres(desde: string, hasta: string): Promise<string[]>;   // fechas; [] con Zoho
  capacidades: { prioridad: boolean; cierres: boolean; llegadaExacta: boolean; flujoPorClasificacion: boolean };
}
interface TicketTaller {
  numero: number;
  estado: string;
  flujo: 'servicio' | 'equipo_nuevo';
  prioridad: number;                               // 0 con Zoho
  llegada: { instante: number | null; exacta: boolean };   // entrada en el estado actual
  sinConfirmar: boolean;
}
```

Todo lo demás (categorías, puestos, duraciones, asignaciones, proyección) trabaja sobre `TicketTaller` y no sabe de dónde viene. `capacidades` decide los rótulos de la pantalla.

### B.4 Prioridad (D1)

- **Criterio de Desk 2.0:** rango `Urgent` 4, `High` 3, `Medium` 2, `Low` 1, desconocido 0; dentro del rango, por fecha (`Desk2:packages/shared/src/prioridad.ts:22-23`, `:95-109`).
- **La réplica de Zoho sí tiene un campo de prioridad:** `desk.tickets.priority`, relleno en 774 de 775 tickets, con valores `High` (439), `Low` (324) y `Medium` (11); entre los abiertos, 15 `High` y 20 `Low` (Z2).
- **Pero hoy es el mismo dato en las dos fuentes.** En Desk 2.0 ningún ticket tiene la prioridad fijada en la app (`prioridad_en_app_at` vacío en todos, D6): los 15 `High` y 19 `Low` abiertos son el valor que vino de Zoho. La prioridad por cliente «Top 5» de Desk 2.0 (`Desk2:apps/desk/server/db/prioridadCliente.ts:106-124`) aún no se ha usado.
- **Conclusión:** técnicamente la prioridad de Zoho es utilizable sin conexión, pero D1 dice que solo se aplica con la conexión encendida. Queda como decisión abierta si el `High` / `Low` de Zoho significa lo mismo que la prioridad de Desk 2.0 (ver I.4).

### B.5 Flujo: servicio o equipo nuevo

- **En Desk 2.0** el flujo sale de `classification`: equipo nuevo si normaliza a «Equipo nuevo» y el estado pertenece a ese catálogo; si no, servicio (`Desk2:packages/shared/src/flujos.ts:51-61`). En la base `desk` el campo viene relleno en 34 de los 35 abiertos: 4 son «Equipo Nuevo» (1000, 1001, 1002, 1008) (D5).
- **En la réplica de Zoho `classification` está vacío en los 775 tickets** (Z3). Con la fuente Zoho no se puede distinguir el flujo por ese campo.
- **Hipótesis para la fuente Zoho:** los tickets de equipo nuevo llevan un código de servicio con prefijo `HV_` y un asunto que empieza por «Equipo Nuevo» (observado el 06/10/2026 en los cuatro tickets anteriores). Si se acepta, el adaptador de Zoho deduce el flujo de ahí y lo marca como deducido; si no, se asigna a mano (ver I.5).

---

## C. Estados: réplica frente a blueprint

### C.1 Estados que existen hoy

| Estado | Tipo en Desk | Tickets (réplica) | Abiertos (réplica) | Abiertos (Desk 2.0) |
|---|---|---|---|---|
| Finalizado | Closed | 740 | 0 | 0 |
| Servicio externo | On Hold | 7 | 7 | 7 |
| Notificación cliente | On Hold | 6 | 6 | 6 |
| Por Facturar | On Hold | 5 | 5 | 5 |
| OV asignada | On Hold | 1 | 1 | 1 |
| En Espera de Repuestos | On Hold | 1 | 1 | 1 |
| En espera de SKU inventario | On Hold | 1 | 1 | 1 |
| Rev./Diagnostico | Open | 6 | 6 | 7 |
| Ingresado | Open | 4 | 4 | 3 |
| En Proceso | Open | 3 | 3 | 3 |
| Por Entregar | Open | 1 | 1 | 1 |

Fuentes: Z1 y D2. Las dos diferencias son el ticket 884 (cerrado en Desk 2.0, «Ingresado» en la réplica) y el 10005 (solo en Desk 2.0, en «Rev./Diagnostico»).

Son 11 estados en uso. El blueprint de Desk 2.0 define 23 (`Desk2:packages/shared/src/estados.ts:59-106`).

### C.2 Qué falta en cada lado

- **En el blueprint y sin ningún ticket hoy en ninguna de las dos bases (12):** «Ticket creado», «Remisión creada», «Notificado», «Notificación a Compras», «Notificación Comercial», «Solicitado», «Continuación del proceso», «Liberación Comercial», «Por Entregar / Sin facturar», «Verificación», «Pendiente» y «Solicitud Soporte».
- **En las bases y no en el blueprint:** ninguno.
- **Aviso:** «Notificación Comercial» tuvo un ticket en la réplica durante el 06/10/2026, escrito con doble espacio («Notificación  Comercial»). La clave normalizada lo absorbe (`claveEstadoDesk`, `apps/hub-api/src/trazabilidad/dominio.ts:360-362`).
- **Dos nombres para la misma fase inicial:** «OV asignada» es el de Zoho y «Ticket creado» el de la app (`Desk2:packages/shared/src/transitions.ts:127-144`).

### C.3 Categoría propuesta para cada estado

| Estado | Categoría en la agenda | Etapa | Nota |
|---|---|---|---|
| OV asignada | Por llegar | — | D4. Lista aparte, sin proyectar |
| Ticket creado | Por llegar | — | D4 |
| Remisión creada | Fila de entrada | — | Solo con fuente Desk 2.0 |
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
| Pendiente | Sin categoría clara | — | Flujo de soporte remoto; no ocupa taller (**hipótesis**) |
| Solicitud Soporte | Sin categoría clara | — | Flujo de soporte remoto; no ocupa taller (**hipótesis**) |

«Notificación a Compras» no estaba en la lista de standby de la regla 2. Se propone como standby porque depende de Compras, coherente con D2.

### C.4 Papeles ya guardados en `tmc_estados_desk` (Z4)

| Estado | Papel guardado hoy | Categoría propuesta | ¿Contradicción? |
|---|---|---|---|
| Notificación cliente | standby | Standby | No |
| Servicio externo | standby | Standby | No |
| Por Facturar | standby | Fin de taller | **Sí** |
| Por Entregar | standby | Fin de taller | **Sí** |

El papel (`cuenta` / `standby` / `terminado`) gobierna el reloj del plazo de la pestaña Servicios; la categoría gobernará los puestos de la agenda. Para los puestos el efecto es el mismo (ambos liberan), pero no para la fila: un standby vuelve al final de la fila, un fin de taller no vuelve. Por eso la categoría debe ser una columna propia y no derivarse del papel. Queda abierta la decisión de si además se corrige el papel de esos dos estados a «Trabajo terminado» (ver I.3).

---

## D. ¿Basta el historial de estados?

**Hoy no.** Qué da y qué no da `portal.tmc_estados_historial` (`apps/hub-api/src/users/migrations/047_trazabilidad_estados_historial.sql:39-55`, `apps/hub-api/src/trazabilidad/repo.ts:645-689`):

| Pregunta | Respuesta |
|---|---|
| ¿Cuándo entró el ticket en su estado actual? | Solo si el tramo abierto tiene `desde_real = TRUE`, con precisión de 5 minutos más el retraso del trabajador. Si es `FALSE`, `desde` es la primera vez que el portal lo vio |
| ¿Cuándo entró en su etapa (varios estados)? | Derivable recorriendo hacia atrás los tramos contiguos de la misma etapa, como hace `inicioDeRacha` para «terminado» (`apps/hub-api/src/trazabilidad/plazos.ts:195-204`). Es real solo si el primer tramo de la racha tiene `desde_real = TRUE` |
| ¿En qué orden llegaron los que ya estaban? | No se sabe. Todos los vistos en la misma pasada comparten `desde` |

Estado real del historial el 06/10/2026 (Z6 y Z5): 35 tramos, uno por ticket abierto, **0 con `desde_real`**, y todos con el mismo instante (06/10/2026 22:12:04 UTC, primera pasada tras el despliegue). El orden de llegada de los 35 tickets abiertos es hoy desconocido para el portal: se ordenan por número y se marcan «orden aproximado».

A partir de ahora cada cambio de estado deja un tramo real, así que el dato mejora solo con el tiempo.

### Qué falta y de dónde podría salir

1. **`desk.ticket_transitions` de Desk 2.0** da el instante exacto de entrada en cada estado, pero solo de los movimientos hechos en la app (`Desk2:apps/desk/server/db/sla.ts:28-32`). Hoy lo tiene 1 de 35 abiertos (D4).
2. **`desk.ticket_history` de la base `zoho-hub`** guarda el registro de eventos de Zoho: 42.588 eventos de los 775 tickets, entre ellos 4.433 `BlueprintTransitionPerformed`; los 35 abiertos tienen historial (Z7, Z8, Z9). **Hipótesis:** el campo `raw` de esos eventos contiene la transición o el estado de destino, lo que permitiría reconstruir cuándo entró cada ticket en su estado actual. No se comprobó la forma de `raw` (no se consultó para no exponer datos). Limitación conocida: el último evento es del 02/10/2026, porque el trabajador descarga el historial de cada ticket una sola vez.
3. **Etapa sin estado propio.** La tabla guarda la clave del estado, no la etapa; la correspondencia estado → etapa se aplica al leer, igual que el papel.

Recomendación: usar el historial del portal como base, completar con `ticket_transitions` cuando la conexión esté encendida, y estudiar el punto 2 como mejora para el arranque (ver I.7).

---

## E. Modelo de datos propuesto

Todo en el esquema `portal`, migraciones idempotentes desde la 049 (la última registrada es la 048, `apps/hub-api/src/db.ts:24`). Las migraciones se reejecutan en cada arranque.

### E.1 Migración 049 — categoría y etapa de cada estado

Extiende `portal.tmc_estados_desk`; sin tabla paralela. No se puede editar la 046: `CREATE TABLE IF NOT EXISTS` no altera una tabla existente y las guardas de pruebas le prohíben `ALTER` (`apps/hub-api/src/trazabilidad/plazos.test.ts:501-509`). Precedentes de `ADD COLUMN IF NOT EXISTS`: `031_registro_exportadores.sql:21-22`, `034_token_version.sql:17`; de CHECK añadido de forma idempotente: `016_ausencias_historico.sql:36-45`.

```sql
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS categoria VARCHAR(12) NULL;
ALTER TABLE portal.tmc_estados_desk ADD COLUMN IF NOT EXISTS etapa     VARCHAR(12) NULL;
-- CHECK con nombre, dentro de DO $$ … IF NOT EXISTS (pg_constraint) … $$:
--   categoria IN ('por_llegar','entrada','activa','standby','fin')
--   etapa     IN ('diagnostico','proceso','verificacion')
--   (categoria = 'activa') = (etapa IS NOT NULL)
```

- **Valor por defecto en código, la tabla manda.** Una fila solo existe para los estados que alguien ha tocado, y `actualizado_por` es obligatorio, así que no se puede sembrar. El catálogo de C.3 vive como constante en `dominio.ts`; si la fila tiene `categoria`, gana la fila. `NULL` = «según el catálogo».
- **Contrato del PUT.** Hoy `PUT /estados` exige `rol` y lo sobrescribe siempre (`apps/hub-api/src/trazabilidad/types.ts:423-433`, `repo.ts:609-618`). Hay que pasarlo a actualización parcial: `{ estado, rol?, categoria?, etapa? }`.
- **Guardas que habrá que actualizar:** la lista exacta de columnas de la tabla (`apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts:917-918`) y «la 048 es la última» (`plazos.test.ts:613-616`).

### E.2 Migración 050 — puestos por etapa y duraciones

```sql
CREATE TABLE IF NOT EXISTS portal.tmc_agenda_etapas (
  etapa               VARCHAR(12)  PRIMARY KEY CHECK (etapa IN ('diagnostico','proceso','verificacion')),
  etiqueta            VARCHAR(40)  NOT NULL,
  orden               SMALLINT     NOT NULL,
  puestos             INTEGER      NOT NULL DEFAULT 1 CHECK (puestos BETWEEN 0 AND 50),
  dias_por_defecto    INTEGER      NULL CHECK (dias_por_defecto BETWEEN 1 AND 365),
  actualizado_por_id  UUID         NULL,
  actualizado_por     VARCHAR(254) NULL,
  actualizado_en      TIMESTAMPTZ  NULL
);
-- Semilla de las tres etapas con ON CONFLICT (etapa) DO NOTHING.

CREATE TABLE IF NOT EXISTS portal.tmc_agenda_duraciones (
  etapa               VARCHAR(12)  NOT NULL,
  tipo                VARCHAR(80)  NOT NULL,          -- clave de tipo de servicio (claveTipoServicio)
  dias_habiles        INTEGER      NOT NULL CHECK (dias_habiles BETWEEN 1 AND 365),
  actualizado_por_id  UUID         NULL,
  actualizado_por     VARCHAR(254) NOT NULL,
  actualizado_en      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (etapa, tipo)
);
```

- **Duración de un ticket en una etapa:** la fila `(etapa, tipo efectivo)` si existe; si no, `dias_por_defecto` de la etapa; si tampoco, «sin duración» (caso frontera F.5).
- **El tipo efectivo** es el que ya resuelve `tipoEfectivo` (`dominio.ts:263-268`): el elegido a mano manda sobre el de Desk.
- **No se reutiliza `tmc_plazos`:** aquel es el plazo comprometido con el cliente por tipo; esto es cuánto ocupa un puesto en cada etapa.

### E.3 Migración 051 — asignaciones

```sql
CREATE TABLE IF NOT EXISTS portal.tmc_agenda_asignaciones (
  id               BIGSERIAL    PRIMARY KEY,
  numero           INTEGER      NOT NULL CHECK (numero > 0),   -- ticket
  etapa            VARCHAR(12)  NOT NULL,
  puesto           INTEGER      NOT NULL CHECK (puesto >= 1),
  desde            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  hasta            TIMESTAMPTZ  NULL,                          -- NULL = vigente
  sugerido         INTEGER      NULL,                          -- ticket que proponía la fila
  motivo           VARCHAR(500) NULL,                          -- obligatorio si numero <> sugerido
  asignado_por_id  UUID         NULL,
  asignado_por     VARCHAR(254) NOT NULL,
  cierre           VARCHAR(12)  NULL CHECK (cierre IN ('estado','manual','reduccion')),
  cerrado_por      VARCHAR(254) NULL,
  CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_puesto_uq ON portal.tmc_agenda_asignaciones (etapa, puesto) WHERE hasta IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tmc_agenda_asig_ticket_uq ON portal.tmc_agenda_asignaciones (numero)        WHERE hasta IS NULL;
```

- **Un puesto, un ticket; un ticket, un puesto:** lo garantizan los dos índices parciales, igual que `tmc_estados_historial_abierto_uq` (`047…sql:39-55`).
- **Cierre automático:** en la misma pasada que ya apunta los estados cada 5 minutos (`registrarEstados`, `repo.ts:645-689`), si el estado del ticket ya no pertenece a la etapa de su asignación vigente, se cierra con `cierre = 'estado'`.
- **No se escribe nada en Desk ni en Zoho.** Sin claves foráneas a `desk.*`.

### E.4 Endpoints previstos

Todos bajo `/api/trazabilidad`, tras `requireAuth` + `requireApp('trazabilidad-mantenimientos')` (`apps/hub-api/src/trazabilidad/router.ts:63`).

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/agenda` (`?hoy=`) | La agenda completa: fuente activa y sus capacidades, etapas con puestos y ocupación, fila de cada etapa con fecha prevista, carril de standby, fin de taller, por llegar, proyección, saturación, primer hueco libre y avisos |
| PUT | `/agenda/etapas` | `{ etapa, puestos, diasPorDefecto }` → puestos y duración por defecto de una etapa |
| PUT | `/agenda/duraciones` | `{ etapa, tipo, dias }` → duración por etapa y tipo; `dias` vacío borra la fila |
| POST | `/agenda/asignaciones` | `{ numero, etapa, puesto, motivo? }` → asigna; exige `motivo` si no es el sugerido |
| DELETE | `/agenda/asignaciones/:id` | Libera a mano un puesto, con motivo |
| PUT | `/estados` (existente) | Se amplía con `categoria` y `etapa`, en actualización parcial |

Los cálculos se hacen en el servidor con «hoy» como argumento, como en Servicios (`hoyOf`, `router.ts:52-59`), para que las pruebas sean deterministas.

---

## F. Algoritmo de la proyección

### F.1 Calendario

```
esHabilAgenda(d) = esHabil(d)                 // lunes a viernes sin festivos de Colombia (plazos.ts)
                   y d no está en cierres     // cierres de Desk 2.0; conjunto vacío con fuente Zoho (D3)
sumar(d, n)      = el n-ésimo día hábil de agenda después de d (d no cuenta), como sumarDiasHabiles
```

### F.2 Preparación

```
tickets   = fuente.ticketsAbiertos()
para cada ticket t:
    cat, etapa = categoriaDe(t.estado)                       // tabla → catálogo
    si cat = 'entrada':  etapaDestino = (t.flujo = 'equipo_nuevo') ? 'proceso' : 'diagnostico'
    si cat = 'standby' | 'fin' | 'por_llegar': fuera de la proyección
puestos[e] = tmc_agenda_etapas.puestos
asignada   = asignaciones vigentes (hasta IS NULL)
```

### F.3 Fila de una etapa

```
fila(e) = tickets en un estado de la etapa e SIN asignación vigente     // ya están en la etapa
          seguidos de tickets de 'entrada' cuya etapaDestino = e        // aún no han entrado
orden dentro de cada tramo de la fila (D1):
    1. prioridad descendente          (solo si fuente.capacidades.prioridad)
    2. llegada ascendente             (instante de entrada en el estado)
    3. número de ticket ascendente    (desempate y llegada desconocida)
si llegada.exacta = falso o hay empate  →  marcar «orden aproximado»
```

### F.4 Simulación por etapa

```
para cada etapa e:
    libre = []                                               // (puesto, día en que queda libre)
    para cada puesto p de 1..puestos[e]:
        si p tiene asignación a (ticket t):
            fin = sumar(dia(a.desde), duracion(t, e))
            si fin < hoy:  fin = sumar(hoy, 1)               // pasado de fecha: empuja (regla 6)
            barra(t, p, dia(a.desde), fin);  libre.añadir(p, fin)
        si no:
            libre.añadir(p, hoy)                             // hueco libre ya
    para cada ticket t de fila(e), en orden:
        (p, d) = el puesto de libre con el día más temprano  // empate → puesto de número menor
        inicio = max(d, hoy)
        fin    = sumar(inicio, duracion(t, e))
        previsto(t) = { puesto p, inicio, fin };  libre.actualizar(p, fin)
    primerHueco(e) = el día más temprano de libre tras repartir la fila
    saturacion(e)  = ocupados / puestos[e], y nº de tickets en fila
```

El día en que un puesto queda libre es el mismo en que entra el siguiente, porque el día de inicio no cuenta en `sumar`.

### F.5 Casos frontera

| Caso | Tratamiento |
|---|---|
| **Empate de llegada** | Decide el número de ticket; se marca «orden aproximado» |
| **Pasado de fecha que empuja** | Sigue ocupando; fin proyectado = día hábil siguiente a hoy; se pinta en rojo. Cada día que siga ahí, toda la fila se corre un día |
| **Standby que libera y vuelve** | Al entrar en standby la asignación se cierra (`cierre = 'estado'`) y sale de la proyección. Al volver a un estado de la etapa entra al final de la fila, con la llegada del momento en que regresó (regla 4) |
| **Equipo nuevo, dos etapas seguidas** | Ingresado → Proceso → Verificación. Se proyecta en cadena: la llegada prevista a Verificación es el fin previsto en Proceso. Es el único caso en que una etapa alimenta a otra sin standby en medio |
| **Tipo sin duración** | Se usa `dias_por_defecto` de la etapa. Si tampoco hay, el ticket ocupa su puesto pero no tiene fin estimado: se pinta «sin duración», no se proyecta nada detrás en ese puesto, y la pantalla lo avisa |
| **Puesto que se reduce estando ocupado** | No se desaloja a nadie. Los puestos por encima del nuevo tope quedan «a extinguir»: siguen ocupados hasta que su ticket salga y no reciben a nadie más. La saturación puede superar el 100 % y se avisa |
| **Más tickets en la etapa que puestos** | Los que no tienen asignación encabezan la fila de esa etapa, por delante de la fila de entrada (ya están físicamente en la etapa). Se marca «en etapa sin puesto» (ver I.2) |
| **Diagnóstico no encadena con Proceso** | Entre ambas hay siempre standby (notificación y aprobación del cliente), que no se proyecta (regla 7). La fila de Proceso solo contiene tickets que ya están en «En Proceso» o «Continuación del proceso» |
| **Ticket «sin confirmar»** | El que la réplica lleva más de un día sin refrescar se proyecta al final de su fila y marcado; puede estar ya cerrado (caso real: 884) (ver I.6) |

---

## G. Boceto de la pantalla «Agenda del taller»

```
 Agenda del taller                                       hoy mar 06/10/2026
 Fuente: Zoho (réplica) · sin prioridad · sin cierres de empresa · orden aproximado
 ─────────────────────────────────────────────────────────────────────────────────────
                    oct
                    06  07  08  09 │ 10  11  12 │ 13  14  15  16 │ 17  18 │ 19  20
                    ma  mi  ju  vi │ sá  do  lu*│ ma  mi  ju  vi │ sá  do │ lu  ma
 ▌DIAGNÓSTICO  3/3 puestos · fila 7 · primer hueco: vie 09/10
   Puesto 1         [#993 ██████████]░░░░░░░░░░░[·#1006·········]
   Puesto 2         [#999 ██████████]░░░░░░░░░░░[·#1007·········]
   Puesto 3         [#1005 █████████]░░░░░░░░░░░[·#1010·········]
   Fila ▸ #1006 vie 09 · #1007 vie 09 · #1010 vie 09 · #880 jue 15 · #881 jue 15 · #882 jue 15 · #884? mar 20
          └ en etapa sin puesto ─────────────┘   └ fila de entrada (Ingresado) ───────────────┘

 ▌PROCESO      3/4 puestos · fila 0 · primer hueco: hoy
   Puesto 1         [#984 ██████████████░░░░░░░░░░░██]
   Puesto 2         [#990 ██████████████░░░░░░░░░░░██]
   Puesto 3         [#1009 █████████████░░░░░░░░░░░██]
   Puesto 4         ( libre )

 ▌VERIFICACIÓN 0/2 puestos · fila 0 · primer hueco: hoy
   Puesto 1         ( libre )
   Puesto 2         ( libre )
 ─────────────────────────────────────────────────────────────────────────────────────
 STANDBY (15) no ocupan puesto ni se proyectan
   Servicio externo 7 · Notificación cliente 6 · En Espera de Repuestos 1 · En espera de SKU 1
 FIN DE TALLER (6)   Por Facturar 5 · Por Entregar 1
 POR LLEGAR (1)      OV asignada 1

 Leyenda: ██ ocupado · [·#···] previsto · ░ no hábil (lu* = festivo) · ? sin confirmar · rojo = pasado de fecha
```

Elementos:

- **Gantt por puesto agrupado por etapa.** Una fila por puesto; barra llena para el ticket que lo ocupa, barra punteada para los previstos. Reutiliza el eje, los días no hábiles y los rayados de `Barras` (`apps/trazabilidad-mantenimientos/src/vistas/Servicios.tsx:494-668`) y la geometría de `apps/trazabilidad-mantenimientos/src/lib/servicios.ts` (`ejeServicios` `:335-348`, `diasDelEje` `:527-534`).
- **Fila de cada etapa** con la fecha prevista de entrada de cada ticket. El primero es el «sugerido»: un botón «Asignar» lo confirma; elegir otro abre el campo de motivo.
- **Carril de standby** agrupado por estado, sin fechas.
- **Saturación y primer hueco libre** en la cabecera de cada etapa.
- **Rótulo de fuente** fijo arriba, con lo que la fuente activa no puede dar.
- **Configuración:** un bloque nuevo con puestos y duraciones, y dos columnas más (categoría y etapa) en el bloque «Estados de Desk» (`apps/trazabilidad-mantenimientos/src/vistas/Configuracion.tsx:45-158`).

---

## H. Ejemplo resuelto con los tickets abiertos de hoy

**Datos:** los 35 tickets abiertos de la réplica el 06/10/2026 (Z5), fuente Zoho. **Configuración supuesta:** Diagnóstico 3 puestos / 3 días, Proceso 4 puestos / 4 días, Verificación 2 puestos / 1 día, para todos los tipos.

**Supuestos necesarios, porque hoy no hay asignaciones ni llegadas reales:**

- El orden es por número de ticket («orden aproximado»): los 35 tramos del historial son de primera observación y comparten instante (Z6).
- Los tres primeros de cada etapa se dan por asignados hoy, martes 06/10/2026, y su etapa empieza a contar hoy.
- El lunes 12/10/2026 es festivo en Colombia. No hay cierres de empresa (fuente Zoho; y en Desk 2.0 la tabla está vacía, D9).
- Sin prioridad (fuente Zoho, D1).

### Reparto por categoría

| Categoría | Tickets | Números |
|---|---|---|
| Etapa Diagnóstico (Rev./Diagnostico) | 6 | 993, 999, 1005, 1006, 1007, 1010 |
| Etapa Proceso (En Proceso) | 3 | 984, 990, 1009 |
| Etapa Verificación | 0 | — |
| Fila de entrada (Ingresado) | 4 | 880, 881, 882, 884 |
| Standby | 15 | Servicio externo: 991, 1000, 1001, 1002, 1003, 1004, 1008 · Notificación cliente: 689, 948, 958, 962, 968, 975 · En Espera de Repuestos: 976 · En espera de SKU inventario: 978 |
| Fin de taller | 6 | Por Facturar: 977, 981, 982, 983, 992 · Por Entregar: 985 |
| Por llegar (OV asignada) | 1 | 996 |

Suman 35.

### Puestos

| Etapa | Puesto | Ticket | Inicio | Fin estimado |
|---|---|---|---|---|
| Diagnóstico | 1 | 993 | mar 06/10 | vie 09/10 |
| Diagnóstico | 2 | 999 | mar 06/10 | vie 09/10 |
| Diagnóstico | 3 | 1005 | mar 06/10 | vie 09/10 |
| Proceso | 1 | 984 | mar 06/10 | mar 13/10 |
| Proceso | 2 | 990 | mar 06/10 | mar 13/10 |
| Proceso | 3 | 1009 | mar 06/10 | mar 13/10 |
| Proceso | 4 | libre | — | — |
| Verificación | 1 y 2 | libres | — | — |

Cuentas: Diagnóstico, 3 días hábiles desde el 06/10 → mié 7, jue 8, vie 9. Proceso, 4 días hábiles → mié 7, jue 8, vie 9, mar 13 (el lunes 12 es festivo).

### Fila de Diagnóstico y fechas previstas

| Orden | Ticket | Situación | Entra | Termina |
|---|---|---|---|---|
| 1 | 1006 | En etapa sin puesto | vie 09/10 | jue 15/10 |
| 2 | 1007 | En etapa sin puesto | vie 09/10 | jue 15/10 |
| 3 | 1010 | En etapa sin puesto | vie 09/10 | jue 15/10 |
| 4 | 880 | Fila de entrada | jue 15/10 | mar 20/10 |
| 5 | 881 | Fila de entrada | jue 15/10 | mar 20/10 |
| 6 | 882 | Fila de entrada | jue 15/10 | mar 20/10 |
| 7 | 884 | Fila de entrada, sin confirmar | mar 20/10 | vie 23/10 |

Cuentas: desde el vie 09/10, 3 días hábiles → mar 13, mié 14, jue 15. Desde el jue 15/10 → vie 16, lun 19, mar 20. Desde el mar 20/10 → mié 21, jue 22, vie 23.

Las cinco primeras fechas previstas son las de los tickets 1006, 1007, 1010, 880 y 881.

### Lo que enseña el ejemplo

- **Diagnóstico está saturado desde el primer día:** 6 tickets en la etapa para 3 puestos. Los que no caben encabezan la fila.
- **Proceso tiene un hueco libre hoy y fila vacía.** No se puede prever quién lo ocupará, porque los que saldrán de Diagnóstico pasan antes por standby.
- **Verificación está vacía:** el estado no tiene tickets. Los cuatro de equipo nuevo están en «Servicio externo».
- **La fila de entrada es poco fiable hoy:** tres «Ingresado» son de febrero y el cuarto (884) ya está cerrado en Desk 2.0.
- **Con la fuente Desk 2.0** cambiarían dos cosas: el 884 desaparece (está «Finalizado», D2) y aparece el 10005 en Diagnóstico, que tiene llegada exacta (30/09/2026, D5) y por tanto iría el primero de la fila de los que no tienen puesto. La prioridad no cambiaría nada en Diagnóstico: los siete son `Low` o sin prioridad (D5).

---

## I. Riesgos y decisiones abiertas

Solo lo que sigue abierto después de D1–D4.

### Decisiones que necesita Gerencia

1. **Conexión de solo lectura a la base `desk`.** Propuesta: variable `DESK2_DB_URL` y rol `portal_agenda_reader` con permisos de lectura sobre cuatro tablas concretas (A.5). Falta decidir quién crea el rol y confirmar los nombres.
2. **Arranque con más tickets en una etapa que puestos.** El día uno no hay asignaciones. ¿La app reparte sola los puestos por orden y deja el resto «en etapa sin puesto», o el jefe de taller asigna todo a mano la primera vez? El documento propone lo primero, con confirmación.
3. **Papel de «Por Facturar» y «Por Entregar».** Hoy están como standby en `tmc_estados_desk` (Z4) y la agenda los trata como fin de taller. ¿Se cambia también su papel a «Trabajo terminado», para que el plazo de Servicios se detenga con veredicto, o se dejan como están?
4. **Prioridad heredada de Zoho.** Hoy Desk 2.0 no tiene ninguna prioridad fijada en la app; al encender la conexión, la «prioridad» serían los `High` / `Low` de Zoho (15 y 19 de los abiertos). ¿Se aplica D1 con ese dato, o solo cuando la prioridad se haya fijado en Desk 2.0?
5. **Equipo nuevo con la fuente Zoho.** La réplica no trae `classification`. ¿Se acepta deducir el flujo del asunto y del prefijo `HV_` del código (hipótesis), o se marca a mano en la agenda hasta que haya conexión?
6. **Tickets «sin confirmar».** ¿Se proyectan al final y marcados, como propone el documento, o se excluyen de la agenda hasta que la réplica los refresque?
7. **Reconstruir llegadas pasadas.** ¿Merece la pena leer el historial de eventos de Zoho (`desk.ticket_history`) para ordenar bien los tickets que ya estaban abiertos, o basta el «orden aproximado» hasta que el historial del portal se llene solo?
8. **Duración cuando el ticket no tiene tipo de servicio.** Hoy casi ninguno lo tiene (5 de 35 con tipo manual, Z5). ¿Vale la duración por defecto de la etapa, o se exige elegir tipo antes de asignar puesto?
9. **«Pendiente» y «Solicitud Soporte».** Son del flujo de soporte remoto. ¿Quedan fuera de la agenda?

### Riesgos

- **La réplica de Zoho se desfasa.** El trabajador del hub solo relee los 100 tickets más recientes; un ticket antiguo puede ocupar fila estando ya cerrado (884).
- **El orden de llegada actual es desconocido.** Los 35 abiertos comparten instante de primera observación (Z6).
- **La remisión de entrada aún no ordena nada.** No hay remisiones de la app ni posteriores al 24/07/2026 (D8).
- **El cambio de fuente altera la agenda de golpe.** Al encender la conexión cambian estados (884), aparecen tickets (10005) y entra la prioridad. Conviene hacerlo con el jefe de taller delante.
- **Dos procesos escriben el estado de un ticket.** Desk 2.0 y el trabajador del hub sincronizan Zoho por separado (`Desk2:apps/desk/server/index.ts:85-93`); mientras convivan, las dos bases pueden discrepar.
- **Precisión de 5 minutos.** Un paso muy breve por un estado puede no quedar registrado, y una asignación puede cerrarse hasta 5 minutos tarde.
- **La proyección no cruza el standby.** La ocupación futura de Proceso depende de aprobaciones de clientes que la agenda no puede prever.
- **Calendarios distintos.** Desk 2.0 mide sus alarmas en horas hábiles 08–17 (`Desk2:packages/shared/src/calendarioLaboral.ts:14`); la agenda, en días. Un mismo ticket puede estar «en plazo» en un sitio y con alarma en el otro.

---

## Fuera de alcance de esta fase

- Cualquier cambio de código, migración o configuración.
- La reserva por parte del cliente.
- Escribir en Desk 2.0 o en Zoho.
- Cualquier envío de correo.

## Lo que no se pudo verificar

- **La forma del campo `raw` de `desk.ticket_history`**, de la que depende la hipótesis de D.2: no se consultó para no exponer datos de clientes.
- **Que hub-api alcance el servicio `desk-db`** dentro de EasyPanel: no se probó ninguna conexión.
- **Los valores reales de `DATABASE_URL` y `DB_SCHEMA` de Desk 2.0 en producción:** el propio repositorio los marca como no verificados (`Desk2:DEPLOY.md:331-333`). Sí se verificó el resultado: base `desk`, tablas en el esquema `desk` (D1).
- **Que los ids de los tickets de Zoho coincidan en las dos bases:** se comparó por número, no por id.
- **Que el asunto «Equipo Nuevo» y el prefijo `HV_` identifiquen siempre el flujo de equipo nuevo:** observado en cuatro tickets, no comprobado en el histórico.
- **El comportamiento real de la agenda:** no existe todavía; el ejemplo de H es un cálculo a mano.
