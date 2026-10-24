import type { Pool } from '@algarpibe/zoho-sync';
import type {
  ClaseModificacion,
  DecididaPor,
  EstadoModificacion,
  Movimiento,
  Solicitud,
  TipoSolicitud,
} from '../types.js';
import { ramaDeDosNiveles } from './comun.js';

// ARQ-612 — el registro de movimientos (el Registro general), sacado de repo.ts
// tal cual. Tiene sus propias consultas y su propia traducción de filas: no
// comparte las de solicitudes y modificaciones, porque lee columnas distintas
// (quién decidió, cuándo se cerró). El recorte por rama es el de comun.ts, el
// MISMO que el de los saldos (lo vigila comun.test.ts). repo.ts lo reexporta:
// el resto del código lo sigue llamando como `repo.*` (lo vigila
// barril.test.ts).

/**
 * Las columnas que TODA fila del registro trae, con los mismos alias venga de
 * la tabla que venga.
 *
 * Alias comunes y no los nombres nativos de cada tabla, por lo mismo que el
 * prefijo `mod_` de `COLS_MODIFICACION`: con un solo juego de nombres un único
 * mapa sirve para las dos consultas, y la segunda no se puede desviar de la
 * primera sin que el compilador lo vea.
 *
 * `estado` NO está aquí, y es la única ausencia deliberada: es justo lo que
 * distingue a las dos clases —en una solicitud es `EstadoSolicitud`, en una
 * modificación `EstadoModificacion`— y meterlo aquí con la unión de los dos
 * anularía la garantía que `Movimiento` compra al discriminar por `clase`.
 */
interface FilaMovimientoDb {
  id: string;
  solicitud_id: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  solicitante_email: string;
  tipo: TipoSolicitud;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  decidida_at: string | null;
  /** Del `LEFT JOIN` con `portal.users`: null si no hubo decisor de verdad. */
  decisor_nombre: string | null;
  decisor_correo: string | null;
  /** El congelado en el alta: quién DEBÍA firmar, que no es quién firmó. */
  aprobador_correo: string | null;
  /** El SEGUNDO firmante congelado. `null` = la cadena tenía una sola firma. */
  segundo_aprobador_correo: string | null;
  /** Cuándo firmó el jefe inmediato. NULA con la solicitud ya cerrada NO es un
   *  hueco: significa que cerró el segundo. Ver `correoDelQueCerro`. */
  primera_firma_at: string | null;
  created_at: string;
  motivo: string | null;
}

/**
 * Cuál de los DOS firmantes congelados tomó la decisión final. Se llama solo
 * con `decidida_at` puesta: lo garantiza el respaldo de `quienDecidio`.
 *
 * Solo la usa ese respaldo, el `aproximado`: cuando hay decisor de verdad no
 * hay nada que deducir. Hasta el 2026-08-20 devolvía siempre `aprobador_correo`,
 * y en una solicitud con cascada cerrada en el segundo nivel eso nombraba al
 * jefe inmediato por un acto del segundo — una persona real, con nombre y
 * apellidos, que no fue. Un hueco es peor de leer que un nombre, pero mucho
 * menos grave que un nombre equivocado.
 *
 * ⚠️ **No vale `correoDelTurno` (types.ts), aunque parezca la misma pregunta.**
 * Aquella contesta a quién le toca firmar AHORA y devuelve `null` en todos los
 * estados terminales — y aquí toda fila que llega está cerrada. Con el
 * `?? aprobadorCorreo` de `decisorDeModificacion` colapsaría al primer firmante
 * SIEMPRE, que es exactamente el fallo que esto arregla. Las dos preguntas se
 * parecen y no son la misma: una mira el turno VIVO, esta un turno ya cerrado.
 *
 * La condición es «hay segundo firmante Y la primera firma NO es el mismo acto
 * que la decisión final». Los dos valores de `primera_firma_at` que la cumplen
 * llegan por caminos distintos, y ninguno de los dos se ve a simple vista:
 *
 *  - **Distinta de `decidida_at`**: dos actos, dos transacciones, dos `now()`.
 *    Firmó el jefe y cerró el segundo. Lo contrario —las dos marcas IGUALES—
 *    es una sola firma cerrándolo todo en la misma sentencia, y ahí entra el
 *    caso traicionero: el jefe inmediato RECHAZANDO una solicitud que sí
 *    llevaba cascada (`transicionAlDecidir`, rama `pendiente` + rechazo, con
 *    `esPrimeraFirma` y `esDecisionFinal` a la vez). Decidió el primero.
 *  - **NULA**: eso NO es un dato que falte, es un cierre en `pendiente_2` sin
 *    primera firma, y solo puede significar que decidió el segundo.
 *    `decidirSolicitud` es el ÚNICO escritor de `decidida_at` sobre
 *    `portal.solicitudes_ausencia` —ni `crearSolicitud`, ni
 *    `importarHistorico`, ni `actualizarSolicitud`, ni `aplicarALaSolicitud`
 *    la tocan—, y todo cierre que sale de `pendiente` lleva `esPrimeraFirma`,
 *    que sella la otra marca en el mismo UPDATE. Así que la combinación
 *    «cerrada y sin primera firma» solo la produce un camino: un admin que
 *    corrige el estado a `pendiente_2` para destrabar la solicitud
 *    —`validarEdicionSolicitud` admite la lista `ESTADOS` entera a propósito—
 *    y un segundo firmante que la cierra. Exigir aquí `primera_firma_at`
 *    no nula le colgaba esa decisión al jefe inmediato, que no la vio nunca.
 *
 * Comparar los dos `::text` es exacto y no una heurística: salen del mismo cast
 * en la misma consulta, así que o son la misma cadena o el sello ocurrió en dos
 * transacciones distintas (`now()` es `transaction_timestamp()`, constante
 * dentro de una).
 *
 * ⚠️ Los dos campos se leen con `?? null` y no directamente, y eso es una
 * trampa desarmada, no una manía. Las filas llegan aquí por un `as` desde el
 * driver, y la consulta de las modificaciones —otra clase de movimiento, otra
 * tabla, y ninguna de estas dos columnas— dejaría `undefined` en ellas. Como
 * `undefined !== null` es `true`, sin normalizar una modificación decidida sin
 * sesión entraría por la rama del segundo firmante, devolvería `undefined`, y
 * el `if (correo)` de `quienDecidio` lo convertiría en un hueco: perdería su
 * decisor EN SILENCIO. Es la misma forma de fallo contra la que avisa
 * `PayloadEvento` a cuenta de los campos ausentes.
 */
function correoDelQueCerro(r: FilaMovimientoDb): string | null {
  const segundoFirmante = r.segundo_aprobador_correo ?? null;
  const primeraFirmaAt = r.primera_firma_at ?? null;
  const cerroElSegundo = segundoFirmante !== null && primeraFirmaAt !== r.decidida_at;
  return cerroElSegundo ? segundoFirmante : r.aprobador_correo;
}

/**
 * Quién tomó la decisión, con la marca de si consta o se deduce.
 *
 * Las tres ramas son las que documenta `DecididaPor` (types.ts); aquí van sus
 * porqués operativos. Vive suelta porque es la única parte del mapeo que las
 * dos clases de movimiento comparten palabra por palabra.
 */
function quienDecidio(r: FilaMovimientoDb, estado: Solicitud['estado'] | EstadoModificacion): DecididaPor | null {
  // ⚠️ Con `retirada`, SIEMPRE null, y la guarda va la PRIMERA para que ninguna
  // rama de abajo se le adelante: una retirada la quita el propio solicitante
  // —quién fue ya consta en `solicitanteEmail`—, así que rellenar esto con el
  // `aprobador_correo` congelado en el alta atribuiría el acto a alguien que no
  // lo hizo. Desde aquí hoy es inalcanzable: una SOLICITUD nunca está
  // `retirada`, ese estado es de las modificaciones. Se deja puesta igual
  // porque esta función es la que van a compartir las dos clases, y añadir la
  // guarda después —cuando ya haya filas que la necesiten— es exactamente cómo
  // se cuela una atribución falsa sin que nada se ponga rojo.
  if (estado === 'retirada') return null;
  // Decisor REAL: `aprobador_user_id` resolvió a una fila de `portal.users`.
  // Basta con mirar el correo: `email` es NOT NULL en esa tabla, así que solo
  // llega null cuando el LEFT JOIN no encontró a nadie.
  if (r.decisor_correo) return { nombre: r.decisor_nombre, correo: r.decisor_correo, aproximado: false };
  // Sin usuario pero con la decisión sellada: sesión con token legacy. Lo único
  // que queda es el correo de quien DEBÍA firmar —un admin pudo destrabarla en
  // su lugar—, y `aproximado` es lo que impide que la pantalla lo enseñe como
  // una autoría probada.
  //
  // CUÁL de los dos firmantes lo decide `correoDelQueCerro`, y no una lectura
  // directa de `aprobador_correo`: en una cascada cerrada en el segundo nivel
  // ese campo es el jefe inmediato, que no fue. Es la misma clase de mentira
  // que evita la guarda de `retirada` de aquí arriba —nombrar a quien no fue—,
  // solo que por el otro camino.
  if (r.decidida_at) {
    const correo = correoDelQueCerro(r);
    if (correo) return { nombre: null, correo, aproximado: true };
  }
  // En trámite: no ha decidido nadie todavía, y así hay que enseñarlo.
  return null;
}

/**
 * Los campos que las dos clases rellenan igual. Sin `clase` ni `estado`: esos
 * los pone cada clase con sus propios literales, y es lo que permite construir
 * la unión discriminada sin un `as Movimiento` que anularía la garantía.
 *
 * El tipo de retorno se deja INFERIR a propósito: `MovimientoBase` no se
 * exporta (types.ts), así que anotarlo aquí obligaría a exportarla o a escribir
 * un `Omit<>` sobre la unión que se lee peor que el objeto que hay debajo.
 */
function camposComunesDelMovimiento(r: FilaMovimientoDb, estado: Solicitud['estado'] | EstadoModificacion) {
  return {
    id: r.id,
    solicitudId: r.solicitud_id,
    empleadoNombre: r.empleado_nombre,
    empleadoCargo: r.empleado_cargo,
    solicitanteEmail: r.solicitante_email,
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    diasHabiles: r.dias_habiles,
    decididaAt: r.decidida_at,
    decididaPor: quienDecidio(r, estado),
    createdAt: r.created_at,
    motivo: r.motivo,
  };
}

/**
 * Una fila de la consulta de solicitudes: lo común más SU estado, SU
 * `anulada_at` y SUS `observaciones`.
 *
 * Las dos últimas van aquí y no en `FilaMovimientoDb`: solo la consulta de
 * solicitudes las selecciona (ver `movimientosDeSolicitudes`), y la de
 * modificaciones no tiene nada parecido que mapear.
 */
interface FilaMovimientoSolicitudDb extends FilaMovimientoDb {
  estado: Solicitud['estado'];
  anulada_at: string | null;
  observaciones: string | null;
  /** Ya en `HH:MM`: el SELECT las saca con `to_char`, no con `::text`. */
  hora_inicio: string | null;
  hora_fin: string | null;
}

/**
 * Una solicitud, ya como fila del registro.
 *
 * `clase: 'solicitud'` es un literal de TypeScript y no `r.clase`: es AQUÍ
 * donde el compilador comprueba que este objeto encaja en una de las dos ramas
 * de `Movimiento` —la que lleva `EstadoSolicitud`— y por eso no hace falta
 * ningún cast. Leerlo de la fila movería esa comprobación a una promesa sobre
 * lo que devuelve Postgres, que no verifica nadie.
 *
 * `anuladaAt` y `observaciones` se mapean AQUÍ y no en
 * `camposComunesDelMovimiento`, por la misma razón que viven en esta única
 * rama de `Movimiento`: no son campos comunes, son de la solicitud.
 */
function comoMovimientoDeSolicitud(r: FilaMovimientoSolicitudDb): Movimiento {
  return {
    ...camposComunesDelMovimiento(r, r.estado),
    clase: 'solicitud',
    estado: r.estado,
    anuladaAt: r.anulada_at,
    observaciones: r.observaciones,
    // Aquí y no en `camposComunesDelMovimiento`, por lo mismo que las dos de
    // arriba: solo ESTA consulta las selecciona. Una modificación no tiene
    // franja propia y su mapeador las pone a `null` a mano.
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
  };
}

/**
 * Las solicitudes como movimientos: TODAS, en cualquier estado.
 *
 * Sin filtro por estado a propósito. El registro es un registro y no un archivo
 * de cerradas: una en trámite tiene que verse, con la decisión vacía —
 * `quienDecidio` devuelve `null` y la pantalla la pinta como pendiente—.
 *
 * Tampoco lleva `ORDER BY`: el orden lo pone `movimientos`, que mezcla esta
 * lista con la de las modificaciones. Ordenar aquí sería un orden que la mezcla
 * deshace.
 */
async function movimientosDeSolicitudes(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const { rows } = await db.query(
    // Los casts NO son estilo, y son los mismos que explica `SELECT_SOLICITUD`:
    // sin `::float8` un NUMERIC llega como STRING —y "5.0" rompe la aritmética
    // de los contadores y del CSV—, y sin `::text` un DATE o un timestamptz
    // llega como objeto Date, con lo que cualquier comparación lexicográfica
    // contra una cadena falla EN SILENCIO.
    //
    // `clase` viaja en la fila aunque el mapeo no la lea: hace que la consulta
    // se pueda ejecutar suelta en un psql y se entienda sin el TypeScript al
    // lado. Quien discrimina la unión es el literal de
    // `comoMovimientoDeSolicitud`, y está allí y no aquí a propósito: si esta
    // constante y ese literal se desviaran, mapear desde la fila daría una
    // unión mentirosa que el compilador no podría cazar.
    `SELECT s.id, 'solicitud'::text AS clase, s.id AS solicitud_id,
            e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
            s.solicitante_email, s.tipo,
            s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
            s.dias_habiles::float8 AS dias_habiles,
            s.estado, s.decidida_at::text AS decidida_at,
            -- ::text por lo mismo que las fechas de arriba: sin el, un
            -- timestamptz llega como objeto Date y chipDeSolicitud (dominio.ts
            -- del portal) compararia contra el de una anulada en falso.
            --
            -- Sin comillas invertidas a proposito: esta linea vive DENTRO del
            -- template literal de la consulta, y una comilla invertida sin
            -- escapar lo cerraria a mitad de frase.
            s.anulada_at::text AS anulada_at,
            -- Sin cast: observaciones ya es TEXT en la tabla, no timestamptz
            -- ni NUMERIC como las columnas de arriba que si lo llevan.
            s.observaciones,
            -- to_char y NO ::text, por lo mismo que en SELECT_SOLICITUD: el
            -- driver devuelve un TIME como '14:00:00', y esos segundos se
            -- colarian tal cual en la celda del registro.
            to_char(s.hora_inicio, 'HH24:MI') AS hora_inicio,
            to_char(s.hora_fin,    'HH24:MI') AS hora_fin,
            -- full_name y email son los nombres reales de las columnas de
            -- portal.users (migracion 001). Ahi no hay ninguna columna "name".
            u.full_name AS decisor_nombre, u.email AS decisor_correo,
            -- Los tres los lee el respaldo de quienDecidio, y hacen falta los
            -- tres: con cascada, quien cerro en el segundo nivel NO es el
            -- aprobador_correo congelado en el alta. Ver correoDelQueCerro.
            s.aprobador_correo, s.segundo_aprobador_correo,
            s.primera_firma_at::text AS primera_firma_at,
            s.created_at::text AS created_at,
            s.comentarios AS motivo
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
       -- LEFT: en las sesiones con token legacy aprobador_user_id es NULL, y un
       -- JOIN normal borraria del registro justo las solicitudes cuya autoria
       -- peor consta.
       LEFT JOIN portal.users u ON u.id = s.aprobador_user_id
      WHERE ${ramaDeDosNiveles()}`,
    // `soloDe` como PRIMER parámetro, siempre: es la regla que impone
    // `ramaDeDosNiveles` para no tener que sincronizar un número con una
    // posición.
    [soloDe],
  );
  return (rows as FilaMovimientoSolicitudDb[]).map(comoMovimientoDeSolicitud);
}

/** Una fila de la consulta de modificaciones: lo común, SU estado y SU clase. */
interface FilaMovimientoModificacionDb extends FilaMovimientoDb {
  clase: ClaseModificacion;
  estado: EstadoModificacion;
}

/**
 * Una modificación, ya como fila del registro.
 *
 * Aquí `clase` SÍ se lee de la fila, al revés que en
 * `comoMovimientoDeSolicitud`, y no es una incoherencia: esta consulta trae dos
 * clases —`fechas` y `anulacion`— y un literal solo puede nombrar una. Lo que
 * sostiene el tipo es que `ClaseModificacion` son exactamente esos dos
 * literales, los mismos que la rama de modificación de `Movimiento`, y que el
 * CHECK `clase IN ('fechas','anulacion')` de la 024 impide que la columna
 * contenga otra cosa. Sin ese CHECK, el `as` de abajo sería una promesa sobre
 * Postgres que no verifica nadie.
 */
function comoMovimientoDeModificacion(r: FilaMovimientoModificacionDb): Movimiento {
  return {
    ...camposComunesDelMovimiento(r, r.estado),
    clase: r.clase,
    estado: r.estado,
    // `null` EXPLÍCITO, no una propiedad ausente: una anulación o un cambio de
    // fechas no tiene franja propia y esta consulta ni siquiera selecciona esas
    // columnas. Omitirlas dejaría `undefined` en la fila, y `fechasDeLaFila`
    // —que recibe la unión entera— se comportaría igual hoy pero por accidente,
    // no por contrato.
    horaInicio: null,
    horaFin: null,
  };
}

/**
 * Las modificaciones como movimientos: solo las YA CERRADAS.
 *
 * `m.estado <> 'pendiente'` y no una lista de estados: `retirada` entra, aunque
 * no la decidiera ningún jefe —la echó atrás el solicitante—, porque forma
 * parte del rastro de la solicitud. Su decisor va a `null`, y de eso se encarga
 * la primera guarda de `quienDecidio`.
 *
 * La viva se queda FUERA a propósito, y no por ahorrarse una fila: el `LEFT
 * JOIN` de `SELECT_SOLICITUD` ya la cuelga de su solicitud
 * (`modificacionPendiente`), así que meterla además como movimiento propio la
 * contaría dos veces en pantalla. Y esa duplicidad no rompe nada: solo suma.
 *
 * Sin `ORDER BY`, por lo mismo que la consulta de las solicitudes: el orden lo
 * pone la mezcla de `movimientos`, y ordenar aquí sería un orden que ella
 * deshace.
 */
async function movimientosDeModificaciones(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const { rows } = await db.query(
    // Los mismos casts, y por los mismos motivos, que la consulta de las
    // solicitudes: `::float8` para que un NUMERIC no llegue como STRING, y
    // `::text` para que un DATE o un timestamptz no llegue como objeto Date.
    `SELECT m.id, m.clase::text AS clase, m.solicitud_id,
            e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
            -- El congelado en la PROPUESTA: quien pidio el cambio. Puede no ser
            -- el de la solicitud si la ficha cambio de correo entre medias.
            m.solicitante_email, s.tipo,
            -- ⚠️ El COALESCE no es cosmetico. En una anulacion las tres columnas
            -- "nuevas" van a NULL -lo exige el CHECK modificaciones_campos_por_clase
            -- de la 024-, asi que sus fechas EFECTIVAS son las previas. Leyendo
            -- solo las nuevas, toda anulacion saldria sin fechas ni dias: una
            -- fila que dice que se anularon unos dias pero no cuales.
            COALESCE(m.fecha_inicio_nueva, m.fecha_inicio_previa)::text AS fecha_inicio,
            COALESCE(m.fecha_fin_nueva, m.fecha_fin_previa)::text       AS fecha_fin,
            COALESCE(m.dias_habiles_nuevos, m.dias_habiles_previos)::float8 AS dias_habiles,
            m.estado, m.decidida_at::text AS decidida_at,
            u.full_name AS decisor_nombre, u.email AS decisor_correo,
            -- ⚠️ El aprobador congelado va SOLO, sin segundo_aprobador_correo ni
            -- primera_firma_at: una modificacion la decide UNA sola persona, no
            -- hay cascada que deducir. Los dos campos ausentes los lee
            -- correoDelQueCerro con "?? null" justo para esto, y esa
            -- normalizacion es lo unico que impide que la rama del segundo
            -- firmante se dispare aqui con undefined y pierda el decisor EN
            -- SILENCIO. No anadirlos: traerlos reactivaria la regla de la
            -- cascada donde no aplica.
            m.aprobador_correo,
            m.created_at::text AS created_at,
            -- El motivo del CAMBIO, no los comentarios de la solicitud.
            m.motivo
       FROM portal.solicitud_modificaciones m
       -- La solicitud hace falta para el tipo y para llegar al empleado: la
       -- propuesta no guarda ninguno de los dos.
       JOIN portal.solicitudes_ausencia s ON s.id = m.solicitud_id
       JOIN portal.empleados e ON e.id = s.empleado_id
       -- LEFT por lo mismo que en las solicitudes: con token legacy
       -- aprobador_user_id es NULL, y un JOIN normal borraria del registro justo
       -- las filas cuya autoria peor consta.
       LEFT JOIN portal.users u ON u.id = m.aprobador_user_id
      WHERE m.estado <> 'pendiente'
        AND ${ramaDeDosNiveles()}`,
    // `soloDe` como PRIMER parámetro, igual que en la otra consulta: es la regla
    // que impone `ramaDeDosNiveles`.
    [soloDe],
  );
  return (rows as FilaMovimientoModificacionDb[]).map(comoMovimientoDeModificacion);
}

/**
 * El orden del registro: lo último decidido arriba.
 *
 * Es el mismo `decidida_at DESC NULLS LAST, created_at DESC` que escribía en SQL
 * `solicitudesDecididas`, la consulta del historial del aprobador a la que este
 * registro sustituyó, y el `NULLS LAST` sigue aquí por el mismo motivo que había
 * allí: hay dos formas de llegar a estado terminal sin `decidida_at`
 * —el PATCH de admin, que corrige la fila sin decidir nada, y aprobar una
 * ANULACIÓN sobre una solicitud aún pendiente— y encima el registro trae
 * también las que siguen en trámite, que no tienen fecha de cierre por
 * definición. Sin el `NULLS LAST` todas ellas encabezarían la lista por delante
 * de las decisiones de esta semana.
 *
 * Se exporta SOLO para poder probarla suelta. Ninguna de las dos consultas
 * lleva `ORDER BY`, así que el desempate por `createdAt` es invisible desde
 * fuera: contra Postgres, el orden en que llegan las filas sin cerrar es el que
 * elige el plan de ejecución, y para un dataset de test cabe que coincida con
 * el esperado por casualidad. Se comprobó: con el desempate sustituido por
 * `return 0`, la batería contra Postgres seguía entera en verde. La regla se
 * fija en `repo.test.ts`, con movimientos inventados y en un orden de entrada
 * distinto del de salida —`Array.prototype.sort` es estable, así que un
 * comparador que no desempata deja la entrada tal cual—.
 *
 * Se compara con `<`/`>` sobre las cadenas y no parseando fechas: los dos
 * valores salen del MISMO `::text` sobre un `timestamptz`, y el texto de un
 * `timestamptz` no lo fija la consulta sino dos GUC del SERVIDOR, `DateStyle` y
 * `TimeZone`. Mientras nadie los cambie, todas las filas comparten formato y
 * offset y el orden lexicográfico es el cronológico. Es la misma propiedad en
 * la que ya se apoya `correoDelQueCerro`.
 *
 * ⚠️ La invariante es «mismo GUC de servidor», y NO «misma sesión», que es lo
 * que parecería a simple vista. `movimientos` lanza las dos consultas con
 * `Promise.all` sobre un `Pool`, así que con concurrencia real salen por DOS
 * conexiones físicas distintas — y comparar una fila de una lista contra una de
 * la otra, que es exactamente lo que hace esta función, cruza esas dos
 * conexiones. Hoy se sostiene porque en todo el repo no hay un solo
 * `SET TimeZone`, ni un `options=-c` en la cadena de conexión, ni un `PGTZ`:
 * `createPoolFromUrl` es un `new Pool({ connectionString })` pelado y toda
 * conexión hereda el GUC del servidor. El día que alguien fije la zona por
 * sesión, esto se desordenaría EN SILENCIO.
 *
 * No se parsea a epoch a propósito, y no es pereza: el texto que devuelve
 * Postgres (`2026-08-20 18:39:20.12+00`) no es ISO 8601 —espacio en vez de `T`,
 * offset de dos dígitos—, así que `Date.parse` cae en su rama definida por la
 * implementación. Cambiaría una invariante documentada, que un `grep` basta
 * para vigilar, por otra que depende del motor de JS y que no vigila nadie.
 */
/**
 * Cuándo ocurrió el movimiento de esta fila, para ordenar el registro.
 *
 * Normalmente es `decididaAt`. La excepción son las `registrada`: una
 * incapacidad NO se decide, se informa, así que su `decidida_at` se queda en
 * NULL para siempre y el movimiento ocurrió al crearla.
 *
 * ⚠️ Sin esta excepción, el `NULLS LAST` de abajo mandaba TODA incapacidad al
 * fondo del registro de por vida, debajo de cualquier decisión por vieja que
 * fuera. En producción eran siete enterradas bajo setenta y ocho filas, y
 * parecía que la pantalla no las traía.
 *
 * ⚠️ Y NO se generaliza a todo lo que tenga `decididaAt` en null, por dos
 * casos que deben seguir al fondo:
 *
 *  · Las PENDIENTES, porque todavía no ha ocurrido nada. Subirlas llenaría la
 *    cabecera de solicitudes sin cerrar, y su sitio es la bandeja.
 *  · Las APROBADAS sin `decidida_at`, que son el histórico importado de la
 *    hoja: su `created_at` es el día de la IMPORTACIÓN y no el de la ausencia,
 *    así que ordenarlas por él las amontonaría todas en la fecha en que se
 *    cargó el Excel.
 */
function cuandoOcurrio(m: Movimiento): string | null {
  if (m.decididaAt !== null) return m.decididaAt;
  return m.clase === 'solicitud' && m.estado === 'registrada' ? m.createdAt : null;
}

export function porFechaDeCierre(a: Movimiento, b: Movimiento): number {
  const cierreA = cuandoOcurrio(a);
  const cierreB = cuandoOcurrio(b);
  if (cierreA !== cierreB) {
    if (cierreA === null) return 1;
    if (cierreB === null) return -1;
    return cierreA < cierreB ? 1 : -1;
  }
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

/**
 * El registro de movimientos. `soloDe = null` = la compañía entera (admin).
 *
 * Dos consultas y mezcla en TypeScript, no un `UNION ALL`: las formas de columna
 * de las dos tablas son muy distintas, la vista carga todo de una sola vez, y
 * separadas se pueden probar sin Postgres.
 *
 * `Promise.all` y no dos `await` seguidos: son independientes —ninguna necesita
 * el resultado de la otra— y encadenarlas pagaría dos veces la latencia de la
 * red por nada.
 */
export async function movimientos(db: Pool, soloDe: string | null): Promise<Movimiento[]> {
  const [deSolicitudes, deModificaciones] = await Promise.all([
    movimientosDeSolicitudes(db, soloDe),
    movimientosDeModificaciones(db, soloDe),
  ]);
  return [...deSolicitudes, ...deModificaciones].sort(porFechaDeCierre);
}
