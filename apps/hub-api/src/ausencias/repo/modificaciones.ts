import type { Pool } from '@algarpibe/zoho-sync';
import type {
  ClaseModificacion,
  EventoModificacion,
  Modificacion,
  PayloadEvento,
  Solicitud,
} from '../types.js';
import { bloquearDuenoDe, withTransaction, type PoolClient } from './comun.js';
import {
  COLS_MODIFICACION,
  SELECT_MODIFICACION,
  SELECT_SOLICITUD,
  aModificacion,
  aSolicitud,
  anotarEventoDeCalendario,
  type FilaModificacionDb,
  type FilaSolicitudDb,
} from './filas.js';
import { ocupaAgenda, solapeDe, type Solape } from './solapes.js';

// ARQ-612 — las propuestas de cambio sobre una solicitud (fechas o anulación),
// sacadas de repo.ts tal cual: pedirla, decidirla —aplicándola a la solicitud
// con su testigo y su comprobación de solape—, retirarla y leerla. Las clases
// de error `SolapeAlAplicar` y `SolicitudCambiada` viven aquí y las usa también
// la corrección de admin. repo.ts lo reexporta: el resto del código lo sigue
// llamando como `repo.*` (lo vigila barril.test.ts).

/** Lo que el servicio ya tiene resuelto cuando pide guardar la propuesta. */
export interface DatosModificacion {
  solicitudId: string;
  clase: ClaseModificacion;
  /**
   * El estado que el servicio LEYÓ de la solicitud. Viaja hasta el SQL como
   * testigo de concurrencia; ver el porqué en `crearModificacion`.
   */
  estadoEsperado: Solicitud['estado'];
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  /** Copiado de la solicitud por el servicio. NUNCA rederivado del organigrama. */
  aprobadorCorreo: string;
}

/**
 * Resultado del alta. Discriminado y no un `null` a secas porque las dos formas
 * de fallar piden mensajes distintos: «alguien decidió la solicitud mientras
 * escribías» no es «ya tienes una propuesta pendiente».
 */
export type ResultadoAlta =
  | { ok: true; modificacion: Modificacion }
  | { ok: false; razon: 'estado' | 'duplicada' };

/**
 * `satisfies` y no una cadena suelta: el literal viaja al CHECK de `evento` de
 * la 024, y una errata aquí compilaría y reventaría DENTRO de la transacción,
 * deshaciendo la propuesta entera por un fallo de tecleo.
 */
const EVENTO_ALTA_MODIFICACION = 'modificacion_solicitada' as const satisfies EventoModificacion;

/** El índice único parcial de la 024. Se nombra para poder reconocer SU 23505. */
const UX_UNA_PENDIENTE = 'ux_modificaciones_una_pendiente';

/**
 * Guarda la propuesta y encola su aviso, en una transacción.
 *
 * ⚠️ Dos cosas sostienen la corrección de este INSERT y ninguna es opcional:
 *
 *  1. El `SELECT` dentro del `INSERT` resuelve la foto previa (estado, fechas,
 *     días, correo del solicitante) en la MISMA sentencia. Leerla antes y
 *     grabarla después dejaría una ventana en la que la foto ya no describe lo
 *     que hay en la tabla. De AQUÍ, y no del testigo, sale que `estado_previo`
 *     sea el estado real de la fila. Con un matiz que conviene no perder: es
 *     cierto respecto al snapshot de ESA sentencia, no para siempre —
 *     `withTransaction` abre un `BEGIN` pelado (READ COMMITTED) y el `SELECT` no
 *     lleva `FOR UPDATE`, así que una aprobación que confirme justo después lo
 *     deja obsoleto. Quien lo verifica en el momento de USARLO es el testigo
 *     TRIPLE de `aplicarALaSolicitud`.
 *  2. El `AND s.estado = $8` lleva el estado que leyó el servicio, y lo que
 *     protege es **`aprobador_correo` (`$7`)**: el único dato de este INSERT que
 *     el servicio DERIVÓ de su lectura anterior, con `decisorDeModificacion`,
 *     que devuelve el firmante DEL TURNO y por tanto depende del estado. Si la
 *     solicitud avanza de nivel entre la lectura y el INSERT, la propuesta se
 *     congela a nombre del jefe que ya firmó y salió del turno — y
 *     `modificacionesPendientes`, `puedeDecidirModificacion` y el correo del
 *     alta filtran los tres por ese mismo campo: la propuesta entera aterriza en
 *     la bandeja de quien ya no tiene el turno, y el firmante que sí lo tiene no
 *     la ve nunca. Sin 403 y sin error.
 *
 * Mismo aviso que en `decidirSolicitud`: NO sustituir el testigo por un
 * `IN ('pendiente','pendiente_2','aprobada')`. Es tentador precisamente porque
 * `estado_previo` seguiría siendo cierto —lo da el `SELECT` de al lado—, pero lo
 * que destruye es la coherencia entre la fila y el decisor congelado sobre ella.
 * Lo vigila `repo.testigos.db.test.ts`, que ejecuta este SQL contra un Postgres
 * de verdad en el cuarto portón (`npm run test:db`).
 *
 * Cero filas ⇒ alguien se adelantó (`razon: 'estado'`). Una violación de
 * `ux_modificaciones_una_pendiente` (23505 **con ese nombre**) ⇒ ya había otra
 * propuesta viva; esa carrera la corta la BASE y no una comprobación previa,
 * porque dos peticiones simultáneas pasarían las dos comprobaciones antes de que
 * ninguna escribiera.
 */
export async function crearModificacion(
  db: Pool,
  datos: DatosModificacion,
  construirPayload: (
    solicitud: Solicitud,
    modificacion: Modificacion,
    evento: typeof EVENTO_ALTA_MODIFICACION,
  ) => PayloadEvento,
  /**
   * Las comprobaciones del servicio que tienen que correr BAJO el candado y por
   * esta misma conexión: hoy, el solape de las fechas propuestas
   * (`exigirSinSolape`). Lo que lance sale tal cual, con ROLLBACK. Opcional
   * porque los tests de repo siembran propuestas sin pasar por el servicio.
   */
  comprobarBajoCandado?: (client: PoolClient) => Promise<void>,
): Promise<ResultadoAlta> {
  try {
    return await withTransaction(db, async (client): Promise<ResultadoAlta> => {
      // DATA-336 — el candado del dueño, antes de la comprobación del solape.
      // Sin él, el servicio miraba el destino por el pool mientras un alta de
      // la misma persona ya lo había comprobado y estaba a punto de confirmar:
      // la propuesta nacía apuntando a un día que ya estaba ocupado. La firma lo
      // habría cazado después, pero el aviso que da esta puerta llegaba tarde.
      if (!(await bloquearDuenoDe(client, datos.solicitudId))) return { ok: false, razon: 'estado' };
      if (comprobarBajoCandado) await comprobarBajoCandado(client);

      const { rows } = await client.query(
        `INSERT INTO portal.solicitud_modificaciones
           (solicitud_id, clase, estado_previo, fecha_inicio_previa, fecha_fin_previa,
            dias_habiles_previos, fecha_inicio_nueva, fecha_fin_nueva, dias_habiles_nuevos,
            motivo, aprobador_correo, solicitante_email)
         SELECT s.id, $2, s.estado, s.fecha_inicio, s.fecha_fin, s.dias_habiles,
                $3::date, $4::date, $5::numeric, $6, $7, s.solicitante_email
           FROM portal.solicitudes_ausencia s
          -- ⚠️ $8 es el estado que LEYO el servicio, NO una lista de estados
          -- admisibles. No cambiar por IN ('pendiente','pendiente_2','aprobada'):
          -- estado_previo seguiria siendo cierto —sale de s.estado, aqui al
          -- lado—, pero $7, el decisor congelado, lo calculo el servicio con el
          -- estado viejo. Si la solicitud avanza de nivel entre medias, la
          -- propuesta queda a nombre del firmante que ya firmo, y la bandeja, el
          -- guard y el correo la mandan los tres alli: el que tiene el turno no
          -- la ve. Lo vigila repo.testigos.db.test.ts, que ejecuta este SQL
          -- contra un Postgres de verdad; se comprobo poniendo el IN y el test se
          -- pone rojo. Corre en el cuarto porton, "npm run test:db".
          WHERE s.id = $1 AND s.estado = $8
         RETURNING id`,
        [
          datos.solicitudId,
          datos.clase,
          datos.fechaInicioNueva,
          datos.fechaFinNueva,
          datos.diasHabilesNuevos,
          datos.motivo,
          datos.aprobadorCorreo,
          datos.estadoEsperado,
        ],
      );
      if (rows.length === 0) return { ok: false, razon: 'estado' };
      const id = (rows[0] as { id: string }).id;

      const { rows: creada } = await client.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [id]);
      const modificacion = aModificacion(creada[0] as FilaModificacionDb);

      // La solicitud se relee DESPUÉS del INSERT: así viene ya con su
      // `modificacionPendiente` por el LEFT JOIN, y el correo se redacta sobre
      // exactamente lo que quedó guardado.
      const { rows: solicitudes } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [datos.solicitudId]);
      const solicitud = aSolicitud(solicitudes[0] as FilaSolicitudDb);

      // El evento va dentro de la transacción, como el resto del fichero: una
      // propuesta guardada sin su aviso no la vería nunca quien tiene que
      // decidirla, y un aviso sin propuesta es basura que n8n reintentaría.
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [
          datos.solicitudId,
          EVENTO_ALTA_MODIFICACION,
          JSON.stringify(construirPayload(solicitud, modificacion, EVENTO_ALTA_MODIFICACION)),
        ],
      );

      return { ok: true, modificacion };
    });
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    // 23505 = unique_violation, pero se exige además el NOMBRE. Dentro de este
    // `try` hay otra tabla que no controlamos —`ausencias_outbox`—, y añadirle
    // un UNIQUE por idempotencia es de lo más natural que puede pasar en la
    // Fase 3, que mete tres eventos por modificación. El día que ocurra, un
    // fallo real del outbox se convertiría en un «ya tienes una propuesta
    // pendiente» que nadie entiende y que además diría que no se escribió nada.
    if (e?.code === '23505' && e.constraint === UX_UNA_PENDIENTE) {
      return { ok: false, razon: 'duplicada' };
    }
    throw err;
  }
}

// ── Modificaciones: la decisión ────────────────────────────────────────────

/**
 * Resultado de decidir. Las tres formas de fallar son un 409, pero cuentan cosas
 * distintas y el cliente tiene que poder distinguirlas: «alguien ya la decidió»
 * (o un doble clic) no es «la solicitud se movió debajo y hay que mirar».
 *
 * `solape` es la única de las tres que no habla de quien firma: la propuesta era
 * legal cuando se pidió y el destino se ocupó después, así que el mensaje no
 * puede quedarse en «no se puede» — tiene que nombrar la ausencia con la que
 * choca, y por eso esta razón viaja acompañada y las otras dos no.
 */
export type ResultadoDecisionModificacion =
  | { ok: true; modificacion: Modificacion; solicitud: Solicitud }
  | { ok: false; razon: 'ya_decidida' | 'solicitud_cambio_de_estado' }
  | { ok: false; razon: 'solape'; solape: Solape };

/**
 * Señal interna para abortar la transacción cuando el testigo triple no casa.
 *
 * Es un THROW y no un `return` a propósito: cuando el paso 2 falla, el paso 1 ya
 * ha escrito, y **solo el ROLLBACK lo deshace**. Ver el porqué entero en
 * `decidirModificacion`. No sale de este módulo — se caza abajo y se traduce a
 * un resultado normal, para que el servicio no tenga que conocerla.
 */
class ChoqueConLaSolicitud extends Error {}

/**
 * Señal para abortar la transacción cuando las fechas que se van a escribir ya
 * están ocupadas por otra ausencia viva de la misma persona. La lanzan las dos
 * puertas del solapamiento que corren dentro de una transacción de este módulo:
 * firmar el cambio (`decidirModificacion`) y el `PATCH` de admin
 * (`actualizarSolicitud`).
 *
 * En `decidirModificacion` es THROW y no `return` por el mismo motivo que
 * `ChoqueConLaSolicitud`, y allí es todavía más fácil de perder de vista: cuando
 * esto salta, **las dos escrituras ya están hechas** —la propuesta marcada
 * `aprobada` y la solicitud movida a las fechas nuevas—. Un `return` desde dentro
 * de `withTransaction` sale por la puerta del `COMMIT` —no hay error que provoque
 * el `ROLLBACK`—, así que confirmaría las dos y dejaría exactamente el estado que
 * esa puerta existe para impedir: dos ausencias vivas de la misma persona sobre
 * el mismo día, con un 409 devuelto al jefe diciéndole que no se hizo nada. Se
 * comprobó cambiándolo por un `return`: el test del ROLLBACK se pone rojo. En
 * `actualizarSolicitud` la comprobación va ANTES del UPDATE, así que cuando salta
 * no hay nada escrito: allí el throw no deshace la escritura, la impide — y
 * `return null` está ocupado, porque significa «no encontrada».
 *
 * Lleva el choque encima porque el aviso tiene que nombrarlo.
 *
 * ⚠️ Es la única de las dos señales que SALE del módulo, y se exporta por una
 * razón concreta: el `PATCH` va del router al repo sin pasar por el servicio, así
 * que no hay ninguna función intermedia donde cazarla y traducirla a un
 * resultado, como sí hace `decidirModificacion` aquí abajo. La caza el `catch` de
 * esa ruta en `router.ts`.
 */
export class SolapeAlAplicar extends Error {
  constructor(public readonly solape: Solape) {
    super('solape');
  }
}

/**
 * La solicitud ya no está en el estado que el admin vio al abrir el formulario
 * (DATA-337): alguien la firmó, la rechazó o la anuló entre medias. Sale del
 * módulo por lo mismo que `SolapeAlAplicar`: el `PATCH` no pasa por el servicio y
 * la traduce a 409 el `catch` de su ruta.
 */
export class SolicitudCambiada extends Error {
  constructor() {
    super('solicitud_cambiada');
  }
}

/**
 * El testigo TRIPLE del UPDATE de la solicitud, escrito una sola vez para que
 * las dos clases de cambio no puedan divergir.
 *
 * `$1` = id, `$2` = estado previo, `$3` = fecha de inicio previa, `$4` = fecha
 * de fin previa. Lo que cada clase escribe empieza en `$5`.
 */
const TESTIGO_SOLICITUD = `
  WHERE id = $1
    -- ⚠️ TRES campos, y los tres hacen falta. Con solo el estado no se detecta
    -- que un admin haya corregido las fechas por PATCH entre que se pidio el
    -- cambio y se aprobo, y la aprobacion le pisaria la correccion EN SILENCIO
    -- (el PATCH no encola nada, asi que nadie se enteraria nunca). Con los tres,
    -- ese choque sale 409 y alguien mira. Es el segundo motivo por el que
    -- existen las columnas *_previa de la 024.
    --
    -- Lo vigilan TRES tests de repo.testigos.db.test.ts, uno por cada cosa que
    -- este testigo puede perder: que un admin corrija las fechas por PATCH entre
    -- medias, que la solicitud avance de nivel —ese es el campo estado, y las
    -- fechas no lo ven— y que la rama de ANULACION lleve el mismo testigo que la
    -- de fechas: las dos comparten esta constante pero tienen SET distintos, y
    -- desenganchar la de anulacion dejaba la bateria entera en verde. Los tres se
    -- falsaron rompiendo el SQL. Corren en el cuarto porton, "npm run test:db",
    -- contra un Postgres de verdad.
    AND estado       = $2
    AND fecha_inicio = $3::date
    AND fecha_fin    = $4::date`;

/**
 * Aplica la propuesta a la fila de la solicitud. Lanza si el testigo no casa.
 *
 * Las dos clases escriben cosas distintas y ninguna es la otra:
 *  - `fechas`    → reescribe las fechas y los días. **El `estado` NO se toca**:
 *    aprobar un cambio no re-decide la solicitud, así que una `pendiente` sigue
 *    `pendiente` y una `aprobada` sigue `aprobada`.
 *  - `anulacion` → `rechazada` + `anulada_at`. No estrena estado: `rechazada` ya
 *    hereda la semántica correcta en los seis filtros que miran el estado (ver
 *    la cabecera de la 024), y `anulada_at` es lo único que la distingue de un
 *    rechazo del jefe.
 */
async function aplicarALaSolicitud(client: PoolClient, m: Modificacion): Promise<void> {
  const testigo = [m.solicitudId, m.estadoPrevio, m.fechaInicioPrevia, m.fechaFinPrevia];
  const { rows } =
    m.clase === 'anulacion'
      ? await client.query(
          `UPDATE portal.solicitudes_ausencia
              SET estado = 'rechazada', anulada_at = now(),
                  -- El motivo que escribio QUIEN PIDIO la anulacion. Sin el, la
                  -- fila quedaria "rechazada" a secas y el historial del jefe no
                  -- diria por que unos dias concedidos no se disfrutaron.
                  motivo_rechazo = $5
            ${TESTIGO_SOLICITUD}
           RETURNING id`,
          [...testigo, m.motivo],
        )
      : await client.query(
          `UPDATE portal.solicitudes_ausencia
              -- Ni el estado, ni decidida_at, ni aprobador_user_id: esto no es
              -- una decision sobre la solicitud, es una enmienda de sus fechas.
              SET fecha_inicio = $5::date, fecha_fin = $6::date, dias_habiles = $7,
                  -- Gemelo del CASE de actualizarSolicitud, y por lo mismo: sin
                  -- el, aprobar un cambio que estira el permiso a dos dias viola
                  -- el CHECK de la 036 DENTRO de la transaccion y el ROLLBACK se
                  -- lleva la decision del jefe.
                  --
                  -- Aqui NO se mira el tipo: una modificacion solo cambia
                  -- fechas, nunca el tipo de la solicitud.
                  hora_inicio = CASE WHEN $5::date = $6::date THEN hora_inicio ELSE NULL END,
                  hora_fin    = CASE WHEN $5::date = $6::date THEN hora_fin    ELSE NULL END
            ${TESTIGO_SOLICITUD}
           RETURNING id`,
          [...testigo, m.fechaInicioNueva, m.fechaFinNueva, m.diasHabilesNuevos],
        );
  if (rows.length === 0) throw new ChoqueConLaSolicitud();
}

/**
 * El jefe aprueba o rechaza la propuesta, en **una sola transacción** y con el
 * evento del outbox dentro, como el resto del fichero.
 *
 * Tres pasos:
 *
 *  1. **Decidir la propuesta.** El `AND estado = 'pendiente'` mata el doble clic
 *     igual que en `decidirSolicitud`: solo el primero actualiza, el segundo no
 *     encuentra fila y el servicio lo traduce a 409 en vez de mandar dos correos
 *     contradictorios.
 *  2. **Aplicarla a la solicitud**, y solo si se aprueba. Rechazar deja la fila
 *     exactamente como estaba: no hay nada que escribir.
 *  3. Releer, comprobar que el cambio no ha dejado a esa persona con dos
 *     ausencias vivas sobre el mismo día, y encolar el aviso.
 *
 * ⚠️ Esa comprobación del paso 3 es la TERCERA puerta del solapamiento, y la
 * única que llega a tiempo: entre PROPONER el cambio y FIRMARLO le han podido
 * aprobar a esa persona otra ausencia encima, y la de `pedirModificacion` miró
 * cuando el destino aún estaba libre. Va DESPUÉS del UPDATE y no antes porque
 * ahí `solicitud` ya está releída y trae el empleado y el tipo, que es lo único
 * que le falta a `Modificacion`; ve exactamente lo mismo que vería antes, porque
 * `solapeDe` excluye a esta solicitud por su id. Si choca, **LANZA** —por lo
 * mismo que el paso 2, ver abajo— y el ROLLBACK se lleva por delante los pasos
 * 1 y 2, con lo que el outbox se queda sin aviso. La carrera —esto es READ
 * COMMITTED y el `SELECT` no lleva `FOR UPDATE`— la cierra el candado del
 * empleado que se toma al entrar (DATA-336, ver `bloquearDuenoDe`).
 *
 * ⚠️ Si el paso 2 no encuentra fila, esto **LANZA**, y ese lanzamiento es lo más
 * importante de la función. El ROLLBACK deshace también el paso 1, así que la
 * propuesta se queda `pendiente` y el cliente ve un 409. Si el paso 1 pudiera
 * confirmarse con el paso 2 fallido, la propuesta diría «aprobada» mientras la
 * solicitud conserva las fechas viejas, **y el correo anunciaría un cambio que
 * no ha ocurrido**: el trabajador se iría de vacaciones las fechas que dice el
 * correo y en el registro constarían otras.
 *
 * Es literalmente el argumento que ya está escrito en `fijarVisorConRegistro`
 * más arriba —«si el UPDATE cuajara y el INSERT fallara… quedaría concedida sin
 * una sola línea de registro»—, con la diferencia de que aquí el estado a medias
 * además se comunica por correo. Por eso las dos escrituras van juntas o no van.
 */
export async function decidirModificacion(
  db: Pool,
  id: string,
  aprueba: boolean,
  motivoRechazo: string | null,
  userId: string | null,
  construirPayload: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<ResultadoDecisionModificacion> {
  try {
    return await withTransaction(db, async (client): Promise<ResultadoDecisionModificacion> => {
      // DATA-336 — el candado del dueño de la solicitud, lo primero. Sin él, dos
      // firmas simultáneas que llevaban dos solicitudes de la misma persona al
      // mismo día comprobaban el solape las dos antes de que ninguna confirmara,
      // y las dos se aplicaban. `solicitud_id` no cambia nunca en una propuesta,
      // así que leerlo sin candado es seguro; el dueño, no (ver
      // `bloquearDuenoDe`), y si cambió mientras se esperaba la solicitud se ha
      // movido debajo: el mismo 409 que el testigo triple.
      const { rows: propia } = await client.query(
        `SELECT solicitud_id FROM portal.solicitud_modificaciones WHERE id = $1`,
        [id],
      );
      if (propia.length > 0 && !(await bloquearDuenoDe(client, (propia[0] as { solicitud_id: string }).solicitud_id))) {
        throw new ChoqueConLaSolicitud();
      }

      const { rows } = await client.query(
        `UPDATE portal.solicitud_modificaciones m
            SET estado = $2, decidida_at = now(), aprobador_user_id = $3, motivo_rechazo = $4
          -- Mismo testigo que en decidirSolicitud: el doble clic no decide dos
          -- veces. Cero filas = alguien se adelanto, y el servicio da 409.
          WHERE m.id = $1 AND m.estado = 'pendiente'
         RETURNING ${COLS_MODIFICACION}`,
        [id, aprueba ? 'aprobada' : 'rechazada', userId, motivoRechazo],
      );
      if (rows.length === 0) return { ok: false, razon: 'ya_decidida' };
      const modificacion = aModificacion(rows[0] as FilaModificacionDb);

      if (aprueba) await aplicarALaSolicitud(client, modificacion);

      // La solicitud se relee DESPUÉS de aplicarla: el correo se redacta sobre
      // exactamente lo que quedó guardado. Ya no trae `modificacionPendiente`
      // —la propuesta salió del índice único parcial al dejar de estar viva—,
      // que es justo lo que la interfaz necesita ver.
      const { rows: filas } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [modificacion.solicitudId]);
      const solicitud = aSolicitud(filas[0] as FilaSolicitudDb);

      // Las tres condiciones, y ninguna sobra igual:
      //  - `aprueba` no es un atajo de rendimiento: rechazar no escribe nada en
      //    la solicitud, así que no puede solapar a nadie, y comprobarlo también
      //    ahí dejaría IRRECHAZABLE una propuesta que se quedó solapada —409 al
      //    jefe cada vez, y solo el solicitante podría quitarla de en medio
      //    retirándola—. Lo vigila un test de `repo.solapes.db.test.ts` escrito
      //    para esto: antes de él, quitarlo dejaba los cuatro portones en verde.
      //  - `ocupaAgenda` es la MISMA función que usan las otras tres puertas, y
      //    no una copia: pregunta si la fila que queda escrita cuenta como
      //    ausencia viva. `solicitud` viene releída, así que su tipo y su estado
      //    son los de la fila, no los que traía la petición. Sigue sin poder
      //    llamarse a `exigirSinSolape` —aquello vive en el servicio, con un
      //    `Pool` y lanzando `AusenciaError`—; lo que se comparte es la REGLA,
      //    que es lo que podía divergir. Divergió: la puerta del `PATCH` nació
      //    copiando solo la mitad del tipo. Alcanzable hoy — ese mismo `PATCH`
      //    admite cualquier tipo con cualquier estado, así que hay
      //    `incapacidad`es en `aprobada`.
      //  - la clase, en cambio, hoy no cambia el resultado por su cuenta: en toda
      //    anulación las tres columnas nuevas van a `null` —lo exige el CHECK
      //    `modificaciones_campos_por_clase` de la 024—, así que el trozo de las
      //    fechas, que pide el compilador (`Modificacion` es plana y
      //    `clase === 'fechas'` no estrecha `string | null`), ya la excluye sola.
      //    Se deja porque nombra a qué clase se aplica la regla, igual que en
      //    `pedirModificacion`, y con la misma letra pequeña: no obliga a nadie a
      //    volver aquí si mañana aparece una tercera clase con fechas.
      if (
        aprueba &&
        ocupaAgenda(solicitud.tipo, solicitud.estado) &&
        modificacion.clase === 'fechas' &&
        modificacion.fechaInicioNueva &&
        modificacion.fechaFinNueva
      ) {
        const choque = await solapeDe(
          client,
          solicitud.empleadoId,
          modificacion.fechaInicioNueva,
          modificacion.fechaFinNueva,
          // El id de la SOLICITUD, no el de la propuesta: sin esta exclusión la
          // ausencia choca SIEMPRE contra sí misma —la fila que se acaba de
          // mover ya lleva las fechas nuevas— y no se podría aprobar ni un solo
          // cambio de los que se piden de verdad.
          modificacion.solicitudId,
        );
        if (choque) throw new SolapeAlAplicar(choque);
      }

      // Anotado y no un literal suelto: el valor viaja al CHECK de `evento` de la
      // 024, y una errata reventaría DENTRO de la transacción, deshaciendo una
      // decisión que el jefe cree tomada.
      const evento: EventoModificacion = aprueba ? 'modificacion_aprobada' : 'modificacion_rechazada';
      const payload = construirPayload(solicitud, modificacion, evento);
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [modificacion.solicitudId, evento, JSON.stringify(payload)],
      );
      // Va DESPUES del INSERT y en la MISMA transaccion, igual que en
      // `decidirSolicitud`: si el evento sale, la marca cambia, y si hay ROLLBACK
      // no cambia ninguna de las dos.
      await anotarEventoDeCalendario(client, solicitud, payload);

      return { ok: true, modificacion, solicitud };
    });
  } catch (err) {
    // Los dos choques ya provocaron el ROLLBACK dentro de `withTransaction`:
    // aquí solo se traducen a un resultado, para que el servicio no tenga que
    // conocer estas clases ni distinguirlas de un fallo real.
    if (err instanceof ChoqueConLaSolicitud) return { ok: false, razon: 'solicitud_cambio_de_estado' };
    if (err instanceof SolapeAlAplicar) return { ok: false, razon: 'solape', solape: err.solape };
    throw err;
  }
}

/**
 * Las solicitudes con una propuesta VIVA que le toca decidir a este correo. Un
 * admin (`todas`) las ve todas, igual que en `solicitudesPendientes`: es quien
 * destraba una decisión bloqueada.
 *
 * Devuelve SOLICITUDES y no propuestas sueltas, y no es pereza: la propuesta por
 * sí sola no dice de quién es, ni de qué tipo, ni qué comentarios traía, así que
 * una bandeja hecha con ellas necesitaría una segunda consulta por fila. El
 * `LEFT JOIN` de `SELECT_SOLICITUD` ya la cuelga de su solicitud, y la trae
 * completa.
 *
 * El filtro va contra `m.aprobador_correo` —el decisor CONGELADO en la
 * propuesta— y no contra los firmantes de la solicitud, que es el mismo correo
 * que exige `puedeDecidirModificacion`.
 *
 * ⚠️ Eso NO basta para garantizar que todo lo que sale de aquí sea decidible por
 * quien pregunta, y no hay que intentar arreglarlo en este SQL. La RAÍZ del
 * organigrama es su propio jefe (`aprobadoresDe`), así que sobre sus propias
 * solicitudes el decisor congelado es ella misma y el guard del solicitante la
 * frena; y un admin recibe además las de todo el mundo. Quién puede decidir cada
 * fila lo decora el servicio con `puedoDecidirla`, que llama al MISMO guard que
 * el endpoint de decisión — que es lo único que impide que la bandeja ofrezca un
 * botón que responde 403.
 */
export async function modificacionesPendientes(
  db: Pool,
  aprobadorCorreo: string,
  todas: boolean,
): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      -- El JOIN ya filtra por m.estado = 'pendiente': esto solo descarta las
      -- solicitudes que no tienen ninguna propuesta viva colgando.
      WHERE m.id IS NOT NULL
        AND ($2::boolean OR lower(m.aprobador_correo) = lower($1))
      ORDER BY m.created_at`,
    [aprobadorCorreo, todas],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * El solicitante se echa atrás. La fila NO se borra: pasa a `retirada`, sale del
 * índice único parcial —así puede pedir otra— y deja el rastro de que existió.
 *
 * `decidida_at` se sella también aquí, aunque no sea una decisión del jefe: es
 * el instante en que la propuesta dejó de estar viva, y sin él no habría forma
 * de ordenar el historial de una solicitud con varios intentos.
 *
 * `AND estado = 'pendiente'` por lo mismo que el testigo del alta: si el jefe la
 * decidió mientras tanto, esto no puede pisarle la decisión. Devuelve `null` y
 * el servicio lo traduce a 409.
 *
 * No encola nada: retirar deja la solicitud exactamente como estaba, así que no
 * hay nada que comunicar a nadie.
 */
export async function retirarModificacion(db: Pool, id: string): Promise<Modificacion | null> {
  const { rows } = await db.query(
    `UPDATE portal.solicitud_modificaciones m
        SET estado = 'retirada', decidida_at = now()
      WHERE m.id = $1 AND m.estado = 'pendiente'
     RETURNING ${COLS_MODIFICACION}`,
    [id],
  );
  return rows.length ? aModificacion(rows[0] as FilaModificacionDb) : null;
}

export async function modificacionPorId(db: Pool, id: string): Promise<Modificacion | null> {
  const { rows } = await db.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [id]);
  return rows.length ? aModificacion(rows[0] as FilaModificacionDb) : null;
}
