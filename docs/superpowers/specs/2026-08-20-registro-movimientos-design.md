# Registro de movimientos: fusionar «Historial de aprobaciones» en «Registro general»

Fecha: 2026-08-20
Estado: diseño aprobado, pendiente de plan de implementación

## El problema

La app de Vacaciones y Permisos tiene hoy dos pestañas que, vistas desde una
cuenta de administrador, dicen casi lo mismo:

- **Historial de aprobaciones** (`HistorialAprobador.tsx`, pestaña `historial`):
  lo que ha cerrado el aprobador que mira, acotado a su propio correo. Se le
  muestra a `esAprobador`.
- **Registro general** (`RegistroGeneral.tsx`, pestaña `historico`): todas las
  solicitudes de la compañía, del portal y las importadas de la hoja. Se le
  muestra **solo a `esAdmin`**.

La redundancia es real para un admin, que ve las dos. Pero **no tienen el mismo
público**, y ahí está el nudo del cambio: borrar el Historial sin más dejaría a
todo jefe que no sea administrador sin ninguna ventana a lo que ha firmado.

Además, dos cosas que hoy no se ven en ninguna parte:

- **Quién** decidió cada solicitud. Se guarda `aprobador_user_id` al firmar,
  pero no se expone. Lo que viaja al front es `aprobadorCorreo`, que es *quién
  debía firmar* congelado en el alta — no necesariamente quién firmó, porque un
  admin puede haber destrabado la solicitud en lugar del jefe.
- Las **anulaciones y cambios de fecha ya decididos**. Viven en
  `portal.solicitud_modificaciones`, con su propio ciclo
  (`pendiente → aprobada/rechazada/retirada`) y su propia `decidida_at`. El
  Registro general solo enseña la modificación *viva* de cada solicitud
  (`modificacionPendiente`); las cerradas desaparecen de la vista.

## Qué se quiere conseguir

Una sola pestaña, «Registro general», que sea un **registro de movimientos**: un
histórico consultable de todo lo que se mueve en la app —solicitudes,
anulaciones y cambios de fecha— con cuándo se decidió cada cosa y quién la
decidió, visible para los jefes acotado a su equipo y para el administrador
completo.

## Decisiones tomadas

| Decisión | Resultado |
| --- | --- |
| Público de la pestaña | `esAprobador \|\| esAdmin` |
| Alcance para un jefe | Su rama, **dos niveles**: subordinados directos y los de ellos |
| Alcance para un admin | La compañía entera |
| Filas | Solicitudes **y** anulaciones/cambios, como movimientos propios |
| Columnas nuevas | «Decidida» (fecha) y «Decidida por» (quien firmó de verdad) |
| Editar / borrar | Solo admin, y solo en filas de solicitud |
| Exportar CSV | Admin, más un permiso por ficha (migración 031) |
| Nombre de la pestaña | «Registro general» para todos |
| Se elimina | Pestaña `historial`, `HistorialAprobador.tsx`, `GET /ausencias/decididas` |

### Por qué la rama son dos niveles y no un subárbol recursivo

Porque la app **ya tiene** esa regla, en `empleadosConSaldo`
(`apps/hub-api/src/ausencias/repo.ts`), y su motivo está escrito allí: con la
cascada de firmas un jefe firma también las vacaciones de sus «nietos» —el
equipo de sus subordinados—, así que verlas es exactamente el alcance de lo que
decide. Un subárbol recursivo le enseñaría gente cuyas solicitudes no firma
nunca, y contradiría la regla que ya rige en el panel de Saldos.

Esa regla se implementa hoy con un `EXISTS` de dos niveles, no con un CTE
recursivo. El cambio debe **extraerla a un fragmento SQL compartido** para que
exista una sola vez, en lugar de copiarla a la consulta nueva: hoy son dos
consultas que tienen que decir lo mismo, y el modo de fallo de una copia es
silencioso.

### Por qué «Decidida por» necesita backend

`aprobador_user_id` existe en las dos tablas —`portal.solicitudes`
(migración 015) y `portal.solicitud_modificaciones` (migración 024)—, las dos
con clave foránea a `portal.users`. Así que la columna sale simétrica para los
dos tipos de movimiento con el mismo `JOIN`.

En `COLS_MODIFICACION` esa columna todavía no se selecciona: hay que añadirla.

**El caso `NULL`.** En sesiones con token legacy `aprobador_user_id` es nulo. En
esas filas se cae al `aprobador_correo` congelado, pero **marcado en la interfaz**
como aproximación. Mostrarlo sin marca sería afirmar que firmó alguien que quizá
no firmó, que es justo la mentira que se descartó al elegir esta columna.

## Arquitectura

### El modelo de fila: un movimiento plano

Una fila plana con un discriminador, no una unión con objetos anidados. El
motivo es concreto: los filtros por tipo, persona y año, los contadores y el CSV
ya operan sobre una lista plana de solicitudes, y una fila plana los mantiene
vivos casi sin tocarlos.

Las dos clases de modificación se llaman **exactamente igual que en la base de
datos** (`CLASES_MODIFICACION = ['fechas', 'anulacion']`), y no con sinónimos
como `cambio`: una traducción de vocabulario entre la tabla y la pantalla es una
capa más que puede derivar en silencio, y no compra nada.

```ts
type ClaseMovimiento = 'solicitud' | 'fechas' | 'anulacion';

interface Movimiento {
  /** Id del movimiento: el de la solicitud o el de la modificación. */
  id: string;
  clase: ClaseMovimiento;
  /** Siempre el de la solicitud afectada, también en anulaciones y cambios. */
  solicitudId: string;
  empleadoNombre: string;
  empleadoCargo: string | null;
  solicitanteEmail: string;
  /** El tipo de la SOLICITUD afectada, para que el filtro por tipo siga valiendo. */
  tipo: TipoSolicitud;
  /** Las fechas y días EFECTIVOS del movimiento. Ver nota de las anulaciones. */
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  /** El estado del movimiento, no el de la solicitud. */
  estado: EstadoSolicitud | EstadoModificacion;
  decididaAt: string | null;
  decididaPor: DecididaPor | null;
  createdAt: string;
  /** `comentarios` en una solicitud; `motivo` en una anulación o un cambio. */
  motivo: string | null;
}

interface DecididaPor {
  nombre: string | null;
  correo: string;
  /** `true` = viene del aprobador congelado porque `aprobador_user_id` es NULL. */
  aproximado: boolean;
}
```

**Las anulaciones no tienen fechas nuevas.** Un `CHECK` de la migración 024
garantiza que `fecha_inicio_nueva`, `fecha_fin_nueva` y `dias_habiles_nuevos`
van los tres a `null` en una anulación. Así que las fechas efectivas de un
movimiento de clase `anulacion` son las **previas**; las de un `fechas` son las
nuevas.

### Qué filas entran, exactamente

- **Todas las solicitudes**, en cualquier estado, no solo las decididas. El
  Registro general ya funciona así hoy y es lo que lo hace un registro y no un
  archivo de cerrados. Una solicitud en trámite aparece con «Decidida» y
  «Decidida por» vacías.
- **Las modificaciones ya cerradas**: `aprobada`, `rechazada` y también
  `retirada`. La retirada es la que el propio solicitante echó atrás; no es una
  decisión de un jefe, pero sella `decidida_at` y forma parte del rastro de lo
  que se movió.
- **Las modificaciones vivas (`pendiente`) NO entran como fila propia.** Ya se
  ven, en su solicitud, a través de `modificacionPendiente`, que viaja con toda
  solicitud desde el `LEFT JOIN` del `SELECT` común. Meterlas además como fila
  las contaría dos veces en pantalla y haría creer que hay dos cosas en curso
  donde solo hay una.

### Los cuatro candados de la mezcla

Meter dos entidades en una tabla rompe cuatro cosas que hoy funcionan. Cada una
tiene que quedar cerrada explícitamente:

1. **Los totales.** «Días de ausencia» y «Compensatorios concedidos» cuentan
   solo filas `clase === 'solicitud'`. Si un cambio de fechas sumara, los días
   se contarían dos veces.
2. **Los chips de `porPersona`.** Misma regla: solo solicitudes.
3. **El CSV es el fichero de nómina.** `exportarCsv` sustituye al Excel de
   nómina y su columna «Días» significa días fuera, sin ninguna columna que diga
   el signo. Ya tiene un candado documentado por eso: los otorgamientos no se
   exportan, porque una fila de días concedidos ahí es un error que se descubre
   en un recibo. **Las anulaciones y los cambios caen bajo la misma regla**: el
   CSV sigue exportando solo `clase === 'solicitud'` y solo ausencias.
4. **Editar y borrar.** Solo en filas `clase === 'solicitud'` y solo para admin.
   El servidor lo vuelve a comprobar; la interfaz solo decide si dibuja el botón.

### Backend

**Repo.** `movimientos(db, soloDe)`, con `soloDe = null` para el admin.

Dos consultas y mezcla ordenada en TypeScript, **no** un `UNION ALL`: las formas
de columna de las dos tablas son muy distintas, la vista ya carga todo de una
sola vez, y separadas se pueden probar en unitarios sin Postgres.

El orden de la lista mezclada es `decididaAt DESC NULLS LAST, createdAt DESC`,
el mismo criterio que ya usa `solicitudesDecididas`. El `NULLS LAST` no es
decorativo, y su motivo está documentado en esa función: hay dos formas de
llegar a estado terminal sin `decidida_at`.

**Endpoint.** `GET /ausencias/movimientos`. Se retira `GET /ausencias/historico`.

`POST /ausencias/historico/import` **no se toca**: sigue siendo de admin y es
otra cosa.

**Guard.** `requireAuth` más una comprobación de `esAdmin || esAprobador` en el
servicio. El recorte de rama lo decide el servidor a partir de la sesión —
`soloDe = sesion.esAdmin ? null : sesion.email`—, **nunca un parámetro que
mande el cliente**.

**Se borran** `GET /ausencias/decididas` y `repo.solicitudesDecididas` al morir
la pestaña de Historial.

### Migración 031: el permiso de exportar

Copia el patrón de la 022 (`ve_adjuntos`), cuyo motivo es literalmente el de
aquí: sacar del código una lista de personas para no tener que desplegar cada
vez que cambia.

- Columna `exporta_registro BOOLEAN NOT NULL DEFAULT FALSE` en
  `portal.empleados`.
- **Sin sembrado.** La 022 tuvo que sembrar porque venía de una constante que
  había que preservar; aquí no hay nada que preservar. La columna nace en
  `FALSE` para todos y el administrador marca la casilla desde la pestaña
  Organigrama. Así ningún correo concreto entra en el código.
- Tabla de registro de concesiones, como `visores_adjuntos_log`: si el permiso
  sale del código, git deja de ser el historial de quién pudo exportar datos
  personales de la plantilla.
- El admin lo tiene por rol: `sesion.esAdmin || (await repo.puedeExportar(...))`,
  igual que `esVisorAdjuntos`.

Recordatorio de la casa: **añadirla a mano al array `MIGRATIONS` de `db.ts`**.
Olvidarlo no da error.

### Frontend

- `App.tsx`: la pestaña `historico` sale del bloque de `esAdmin` y pasa a
  `esAprobador || esAdmin`. Se elimina la entrada `historial`.
- El **subtítulo** cambia según el rol: para el admin sigue siendo el registro
  de la compañía; para un jefe tiene que decir que es su equipo, o la pantalla
  miente sobre lo que enseña. El nombre de la pestaña no cambia para nadie.
- Columnas nuevas «Decidida» y «Decidida por», y un filtro nuevo por clase de
  movimiento; sin él la tabla se vuelve ruidosa.
- Se borran `HistorialAprobador.tsx`, `fetchDecididas` y la entrada de pestaña.
- `PanelOrganigrama.tsx`: casilla nueva para el permiso de exportar, al lado de
  «Soportes» y con el mismo mecanismo de guardado diferido.

**Los adjuntos no cambian.** `GET /ausencias/adjuntos/:id` tiene su propio
permiso (`puedeVerAdjunto` más `ve_adjuntos`), así que ver una fila en el
registro **no** da acceso al PDF de una incapacidad. La interfaz oculta el clip
cuando no corresponde; el servidor lo impide igualmente.

**Los espejos.** `apps/ausencias/src/api.ts` y `dominio.ts` son espejos manuales
del backend, sin generación ni test de contrato. El tipo `Movimiento` y la regla
de las fechas efectivas viven en los dos lados y tienen que coincidir
exactamente.

## Pruebas

El candado que importa: **un jefe no puede ver movimientos fuera de sus dos
niveles.**

Ese va como test contra Postgres real (`.db.test.ts`), no solo contra el doble
de `router.test.ts`. El motivo es concreto y ya ha mordido dos veces
(`ausenciasQueTocanElSaldo`, `ocupaAgenda`): el doble reimplementa las funciones
del repo y su candado de superficie caza **renombres, no filtros**. Un recorte
de rama mal escrito en el SQL pasaría el doble sin despeinarse.

Cobertura mínima:

- `.db.test.ts`: un jefe ve a sus directos y a sus nietos, y **no** ve a un
  bisnieto ni a un primo; un admin lo ve todo; el recorte no depende de nada que
  mande el cliente.
- Unitarios: la mezcla y su orden; las fechas efectivas de una anulación son las
  previas; los cuatro candados de la mezcla (totales, chips, CSV, acciones).
- Router: el guard rechaza a quien no es ni admin ni aprobador.
- `apps/ausencias`: solo `tsc --noEmit`, que es su único portón.

Método de la casa: **falsar cada candado rompiendo el código de verdad**, y
cuando una mutación no muerda, escribir el test que la haga morder. Y commitear
**antes** de mutar: el `git checkout -- <fichero>` con el que se revierte la
mutación se lleva por delante todo lo no commiteado de ese fichero.

## Riesgo principal

Esto **amplía la visibilidad sobre datos personales** de la plantilla: hasta hoy
solo un administrador veía movimientos de gente que no aprueba. La propia
migración 022 cita la Ley 1581 al hablar de las incapacidades.

El diseño lo acota por tres vías —rama de dos niveles, adjuntos con permiso
aparte, CSV con llave propia— pero la corrección del recorte de rama es la
única barrera real entre un jefe y el historial de toda la empresa, y por eso va
probada contra Postgres real.

Antecedente que conviene tener presente: hace muy poco se cerró un agujero en
esta misma app en el que la raíz del organigrama se aprobaba sus propias
solicitudes, y **ninguno de los 847 tests existentes se puso rojo** al
arreglarlo, porque no había ni uno que cubriera el caso.

## Fuera de alcance

- Purgar el outbox, que sigue creciendo de forma monótona.
- La hoja de Sheets, que sigue actualizándose a mano.
- Paginación del registro: hoy se carga todo de una vez y este cambio no lo
  empeora de forma cualitativa, pero el volumen crecerá al sumar movimientos.
