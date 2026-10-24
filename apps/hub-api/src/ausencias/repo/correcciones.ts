import type { Pool } from '@algarpibe/zoho-sync';
import { cambiaLaHoja, estaEnElCalendario } from '../types.js';
import type {
  EstadoModificacion,
  EventoBorrado,
  EventoCorreccion,
  Modificacion,
  PayloadEvento,
  Solicitud,
  TipoSolicitud,
} from '../types.js';
import { bloquearEmpleado, duenoDe, withTransaction } from './comun.js';
import { SELECT_MODIFICACION, aModificacion, anotarEventoDeCalendario, type FilaModificacionDb } from './filas.js';
import { SolapeAlAplicar, SolicitudCambiada, modificacionPorId } from './modificaciones.js';
import { ocupaAgenda, solapeDe } from './solapes.js';
import { solicitudPorId } from './solicitudes.js';

// ARQ-612 — las correcciones de admin desde «Registro general», sacadas de
// repo.ts tal cual: corregir y borrar una solicitud, y corregir y borrar una
// fila del registro de movimientos. Las cuatro las llama el router
// directamente, sin pasar por el servicio. repo.ts lo reexporta: el resto del
// código lo sigue llamando como `repo.*` (lo vigila barril.test.ts).

/** Los campos que un admin puede corregir desde el registro general. */
export interface EdicionSolicitud {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  fechaFin: string;
  dias: number;
  estado: Solicitud['estado'];
  /**
   * El estado que tenía la fila cuando el admin abrió el formulario: el testigo
   * de DATA-337. `estado` es lo que quiere dejar; esto, lo que vio. Si ya no
   * coinciden con la fila, alguien decidió entre medias y no se escribe nada.
   */
  estadoLeido: Solicitud['estado'];
  comentarios: string | null;
  observaciones: string | null;
}

/**
 * Corrige una solicitud. Devuelve la versión actualizada, o null si no existía.
 *
 * `solicitante_email` se rescribe desde el empleado nuevo: está desnormalizado
 * en la fila, y si se reasigna a otra persona sin actualizarlo, el registro
 * diría un nombre y el correo de otro.
 *
 * NO avisa a la cadena de firmas ni al trabajador, y eso sigue siendo a
 * propósito: esto es corregir el registro, no tomar una decisión. Aprobar o
 * rechazar se hace en la bandeja, que es donde sí se avisa a la gente. Un admin
 * arreglando una fecha mal importada no manda a nadie a revisar su solicitud.
 *
 * Lo que sí encola —desde el 2026-08-19— es un `correccion_admin`, y por lo que
 * la decisión original pasaba por alto: el evento del calendario es un artefacto
 * DERIVADO de esta fila, así que o se corrige o se queda mintiendo para siempre
 * sin que nadie se entere. Mover las fechas de una aprobada dejaba el registro
 * diciendo una cosa y Google la anterior. El evento hace las dos mitades del
 * arreglo: la que se puede automatizar —Google, cuando la fila tiene apuntado su
 * `evento_calendario_id`— y la que no —la hoja, a la que n8n hace `append` y a
 * cuya fila no se puede volver—, que se le pide a administración por correo.
 *
 * El portón es `estaEnElCalendario(previa.estado) && cambiaLaHoja(previa,
 * actual)`, y el porqué de cada mitad está donde se aplica, más abajo.
 *
 * ⚠️ Es la CUARTA puerta del solapamiento: el registro general es la única vía
 * INTERACTIVA que puede llevar cualquier ausencia a cualquier fecha, y la única
 * de las cuatro que no pasa por el servicio —el router llama aquí directamente—,
 * así que su comprobación no puede vivir en `exigirSinSolape` como la del alta.
 * Si el destino está ocupado **LANZA** `SolapeAlAplicar`, y de ahí sale que esa
 * señal se exporte: no hay función intermedia donde cazarla, la traduce a 409 el
 * `catch` de la ruta en `router.ts`. Lanzar y no devolver `null` tampoco es
 * gusto: `null` ya significa «no encontrada» aquí, y el router lo contesta con
 * un 404 — un choque saldría diciendo que la solicitud no existe.
 *
 * Lo que NO es: el último escritor de la tabla. `importarHistorico` mete filas
 * sin pasar por puerta ninguna, y está exento a propósito — el porqué, en su
 * JSDoc.
 *
 * Va dentro de una transacción, y conviene decir exacto lo que eso da. Da que la
 * lectura de la foto previa, la comprobación, el UPDATE y el INSERT del outbox
 * viajen por la misma conexión y se deshagan juntos —una corrección que revienta
 * no puede dejar el correo dicho—, y que la relectura final vaya DESPUÉS del
 * UPDATE por ese mismo `client`: el UPDATE deja la fila bloqueada hasta el
 * COMMIT, así que lo que se devuelve lleva lo que ESTA petición escribió y no lo
 * que otra transacción pudiera colar entre dos consultas sueltas del pool. La
 * transacción sola NO cierra la ventana de carrera —`BEGIN` pelado es READ
 * COMMITTED y el `SELECT` del solape no lleva `FOR UPDATE`—: la cierra el
 * candado del empleado que se toma al entrar (DATA-336), el mismo que el alta y
 * que las otras dos puertas que mueven fechas. Lo vigila
 * `cambios-concurrentes.db.test.ts`.
 */
export async function actualizarSolicitud(
  db: Pool,
  id: string,
  campos: EdicionSolicitud,
  adminEmail: string,
  construirPayload: (previa: Solicitud, actual: Solicitud, adminEmail: string) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    // DATA-336 — el candado del empleado, antes de cualquier lectura que decida.
    // Sin él, dos correcciones simultáneas (o una corrección y un alta, o una
    // firma) miraban las dos el destino libre y las dos escribían.
    //
    // Es la única puerta con DOS empleados: el destino (`campos.empleadoId`),
    // cuya agenda se comprueba, y el de origen, porque una reasignación le quita
    // la fila y `bloquearDuenoDe` cuenta con que nadie cambie el dueño sin su
    // candado. Se piden ordenados para que dos PATCH cruzados (A→B y B→A) no se
    // esperen el uno al otro para siempre; el resto de puertas pide uno solo.
    const origen = await duenoDe(client, id);
    const llaves = [...new Set([campos.empleadoId, ...(origen === null ? [] : [origen])])].sort();
    for (const llave of llaves) await bloquearEmpleado(client, llave);
    // Otro PATCH reasignó la fila mientras se esperaba: el origen que se
    // bloqueó ya no es el suyo. Es el mismo 409 que el testigo de DATA-337.
    if (origen !== null && (await duenoDe(client, id)) !== origen) throw new SolicitudCambiada();

    // Solo hay algo que comprobar si la fila que va a quedar OCUPA agenda. Las
    // dos mitades importan y la del estado se pasó por alto la primera vez: sin
    // ella, corregirle una errata a una RECHAZADA que tuviera una ausencia viva
    // encima —el caso corriente de a quien le rechazan unos días y los vuelve a
    // pedir— salía 409 señalando `fechaInicio`, un campo que nadie había tocado.
    if (ocupaAgenda(campos.tipo, campos.estado)) {
      const choque = await solapeDe(
        client,
        // El empleado DESTINO, no el que tuviera la fila: si la corrección la
        // reasigna, la agenda que hay que mirar es la de quien se la queda.
        campos.empleadoId,
        campos.fechaInicio,
        campos.fechaFin,
        // Excluida por su id, o una corrección que no mueva las fechas —el
        // estado, un comentario, un día mal contado— chocaría contra la propia
        // fila que corrige, y ninguna solicitud VIVA se podría ya tocar (las
        // rechazadas sí: no llegan hasta aquí).
        //
        // ⚠️ Las incapacidades SÍ llegan desde el 2026-08-21, cuando dejaron de
        // estar exentas. Y eso tiene una consecuencia operativa con los datos
        // que ya existían: una incapacidad informada encima de otra ausencia
        // mientras la exención vivía sigue en la tabla, y ahora esa pareja es
        // un estado que la regla prohíbe. Corregirla SIN mover las fechas da
        // 409; lo que sí se puede es moverla a fechas libres —la comprobación
        // mira las NUEVAS— o borrarla, que no pasa por esta puerta.
        id,
      );
      if (choque) throw new SolapeAlAplicar(choque);
    }

    // La foto del ANTES, dentro de la transaccion y antes del UPDATE. Es lo
    // unico que permite saber si la fila estaba en Google y si la correccion
    // desajusta algo: despues del UPDATE ese dato ya no existe en ningun sitio.
    //
    // Va DESPUES de la puerta del solape y no antes, y no es indiferente: por
    // delante, su `return null` contestaria 404 a una correccion sobre una fila
    // borrada cuyo destino esta ocupado, donde hoy sale el solape. Ese reparto
    // esta FIJADO por un test de `repo.solapes.db.test.ts` («sobre una solicitud
    // que no existe manda el solape, no el 404»), que es justo quien caza el
    // volteo. Subirla arriba del todo «para tenerlo junto» cambia una decision
    // ajena a esta feature. Aqui abajo la posicion no cuesta nada: la puerta se
    // pregunta por `campos`, no por `previa`.
    const previa = await solicitudPorId(client, id);
    if (previa === null) return null;

    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia s
          SET empleado_id       = $2,
              solicitante_email = e.correo,
              tipo              = $3,
              fecha_inicio      = $4::date,
              fecha_fin         = $5::date,
              dias_habiles      = $6,
              estado            = $7,
              comentarios       = $8,
              observaciones     = $9,
              -- ⚠️ Las horas se BORRAN cuando dejan de caber. Sin esto, estirar
              -- a dos dias un permiso con horas viola el CHECK de la 036, y como
              -- este UPDATE vive dentro de la transaccion que ademas encola el
              -- evento del outbox, el ROLLBACK se lleva la escritura buena y el
              -- admin recibe un 500 sin ninguna pista. Mismo patron que el CHECK
              -- sobre "evento" de la 027.
              --
              -- Mira TAMBIEN el tipo, al reves que su gemelo de
              -- aplicarALaSolicitud: esta es la unica via que puede cambiarlo, y
              -- el CHECK de la BD no lo vigila -a proposito, para no atarse a
              -- que solo "permiso" admita hora-.
              --
              -- El ::varchar no es adorno, y tiene que ser ESE tipo: el
              -- "tipo = $3" de arriba le fija a $3 el tipo de la columna
              -- -VARCHAR(20)-, y comparar aqui contra un literal pelado -o
              -- contra ::text- se lo deduciria como text. Postgres rechaza
              -- entonces la consulta ENTERA con "inconsistent types deduced for
              -- parameter $3", que en esta transaccion es exactamente el 500 sin
              -- pista que este CASE viene a evitar.
              hora_inicio       = CASE WHEN $3::varchar = 'permiso' AND $4::date = $5::date
                                       THEN s.hora_inicio ELSE NULL END,
              hora_fin          = CASE WHEN $3::varchar = 'permiso' AND $4::date = $5::date
                                       THEN s.hora_fin ELSE NULL END
         FROM portal.empleados e
        -- DATA-337 — el testigo del estado que vio el admin. El formulario se
        -- cargó minutos antes: si el jefe aprobó entre medias, escribir el
        -- estado del formulario devolvería la solicitud a pendiente con el
        -- correo «aprobada» ya encolado. En el WHERE y no en un if sobre
        -- previa, que se leyó sin candado: si la firma confirma justo ahora,
        -- Postgres espera a que suelte la fila y vuelve a evaluar esto sobre la
        -- versión ya firmada. Va después del solape y del 404 de previa: no
        -- cambia lo que contestan esas dos puertas. (Sin comillas invertidas:
        -- este comentario vive dentro de la plantilla de la consulta.)
        WHERE s.id = $1 AND e.id = $2 AND s.estado = $10
        RETURNING s.id`,
      [
        id,
        campos.empleadoId,
        campos.tipo,
        campos.fechaInicio,
        campos.fechaFin,
        campos.dias,
        campos.estado,
        campos.comentarios,
        campos.observaciones,
        campos.estadoLeido,
      ],
    );
    if (rows.length === 0) {
      // Cero filas puede ser el testigo o el empleado destino que no existe; solo
      // lo segundo es un 404.
      const ahora = await solicitudPorId(client, id);
      if (ahora !== null && ahora.estado !== campos.estadoLeido) throw new SolicitudCambiada();
      return null;
    }

    const actual = await solicitudPorId(client, id);
    // Imposible en la practica —acabamos de escribir esa fila por este mismo
    // client—, pero el tipo lo admite y devolver `previa` seria mentir.
    if (actual === null) return null;

    // Las dos mitades niegan cosas distintas y las dos hacen falta:
    //  - `estaEnElCalendario(previa.estado)`: la fila ESTABA en Google. Corregir
    //    una pendiente no desajusta nada, porque nunca se mando nada. Es ademas
    //    la precondicion que `construirPayloadCorreccion` documenta: su correo
    //    afirma que la ausencia ya estaba alli.
    //  - `cambiaLaHoja`: hay algo que ajustar de verdad. Es el porton unico, y
    //    CONTIENE a `cambiaElCalendario`, asi que no se pierde ninguna
    //    correccion de calendario por pasar por aqui.
    //
    // Y como cada fila del outbox es EXACTAMENTE UN correo, esta condicion es a
    // la vez la de que exista la fila: no hay correccion de calendario sin
    // correo ni correo sin correccion.
    if (estaEnElCalendario(previa.estado) && cambiaLaHoja(previa, actual)) {
      // Anotado y no un literal suelto, por lo mismo que en
      // `decidirModificacion`: el valor viaja al CHECK de `evento` de la 027, y
      // una errata compilaria y reventaria DENTRO de la transaccion, deshaciendo
      // una correccion que el admin cree guardada.
      const evento: EventoCorreccion = 'correccion_admin';
      const payload = construirPayload(previa, actual, adminEmail);
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, evento, JSON.stringify(payload)],
      );
      // Va DESPUES del INSERT y en la MISMA transaccion, igual que en
      // `decidirSolicitud` y `decidirModificacion`: si el evento sale, la marca
      // cambia, y si hay ROLLBACK no cambia ninguna de las dos.
      await anotarEventoDeCalendario(client, actual, payload);
    }

    return actual;
  });
}

/**
 * Borra una solicitud y devuelve lo que había, o null si no existía.
 *
 * Se permite borrar CUALQUIERA, también las importadas: restringirlo a las que
 * nacieron en el portal dejaría el único camino para una fila mala de la hoja en
 * la consola de psql, que es justo lo que este borrado viene a evitar. Y una
 * importada se recupera reimportando el Excel; una del portal, no. La red de
 * seguridad es la confirmación de la interfaz, no una regla en el SQL.
 *
 * Es irreversible y toca el registro de la compañía, así que **encola el borrado
 * de su evento del Google Calendar** antes de irse: hasta el 2026-08-19 hacía un
 * `DELETE` pelado y dejaba el evento huérfano en el calendario de Staff, donde
 * nadie iba a relacionarlo con nada.
 *
 * Tres pasos, y el orden de los dos primeros NO es indiferente:
 *
 *  1. Se lleva las filas del outbox de esa solicitud que sigan **sin servirse**.
 *     Es lo que hacía la cascada de la clave ajena hasta la migración 028, ahora
 *     escrito a propósito: sin esto se entregarían correos anunciando una
 *     solicitud que ya no existe.
 *  2. Encola el `borrado_admin` **si la fila estaba en Google**. Va DESPUÉS del
 *     paso 1 —invertidos, el paso 1 se lleva por delante lo que el 2 acaba de
 *     encolar— y ANTES del paso 3, porque la clave ajena valida en el `INSERT`.
 *  3. Borra la solicitud. La clave ajena, ya `ON DELETE SET NULL`, deja la fila
 *     del paso 2 viva con su `solicitud_id` a `null`.
 *
 * La condición del paso 2 es `estaEnElCalendario`, NO «hay `eventoCalendarioId`»:
 * cada fila del outbox es exactamente un correo, así que esa condición decide si
 * se avisa. Una aprobada anterior a la 026 no tiene id —su `calendario` irá a
 * `null` y el ⚠️ pedirá hacerlo a mano— pero sí hay que avisar de ella, que es
 * justo el caso donde nadie más va a darse cuenta.
 *
 * La transacción da que un fallo del payload no deje ni la solicitud borrada ni
 * el correo dicho. Lo que **no** da es cerrar ninguna ventana de carrera: `BEGIN`
 * pelado, READ COMMITTED, como el resto del fichero.
 *
 * ⚠️ **Aprobar y borrar dentro de los diez minutos es un caso decidido, no un
 * descuido.** El paso 1 se lleva el evento `aprobada` que todavía no se había
 * servido —el que iba a CREAR el evento en Google— y el paso 2 encola el borrado
 * de algo que Google nunca llegó a crear, así que contesta 404. Es uno de los
 * tres códigos que el IF «¿El fallo es esperable?» del workflow ya tolera a
 * propósito, así que sale ruido en el historial de n8n y nada más. La
 * alternativa —conservar el `aprobada` pendiente para que se cree y se borre en
 * orden— entregaría un correo anunciando la aprobación de una solicitud ya
 * borrada, que es peor. Ningún test lo cubre: haría falta Google de verdad.
 */
export async function borrarSolicitud(
  db: Pool,
  id: string,
  adminEmail: string,
  construirPayload: (borrada: Solicitud, adminEmail: string) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const previa = await solicitudPorId(client, id);
    if (previa === null) return null;

    // PASO 1. `enviado_at IS NULL` y no `servido_at IS NULL`: una fila que n8n ya
    // tiene en la mano pero no ha confirmado tambien muere aqui, igual que moria
    // con la cascada. n8n la procesara y su confirmacion no encontrara fila, que
    // es un no-op.
    await client.query(`DELETE FROM portal.ausencias_outbox WHERE solicitud_id = $1 AND enviado_at IS NULL`, [id]);

    // PASO 2.
    if (estaEnElCalendario(previa.estado)) {
      // Anotado y no un literal suelto: el valor viaja al CHECK de la 028, y una
      // errata compilaria y reventaria DENTRO de esta transaccion.
      const evento: EventoBorrado = 'borrado_admin';
      await client.query(
        `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
        [id, evento, JSON.stringify(construirPayload(previa, adminEmail))],
      );
    }

    // PASO 3.
    await client.query('DELETE FROM portal.solicitudes_ausencia WHERE id = $1', [id]);
    return previa;
  });
}

// ── Correcciones de admin sobre una modificación ───────────────────────────

/** Los campos de una modificación que un admin puede corregir desde el registro. */
export interface CorreccionModificacion {
  /** Los tres van NULL en una anulación; lo exige el CHECK de la 024. */
  fechaInicioNueva: string | null;
  fechaFinNueva: string | null;
  diasHabilesNuevos: number | null;
  motivo: string | null;
  estado: EstadoModificacion;
}

/**
 * Corrige a mano una fila del registro de movimientos. Solo la usa el admin
 * desde «Registro general».
 *
 * ⚠️ Corrige el ASIENTO, no la solicitud. Cambiar aquí el estado de una
 * anulación de `aprobada` a `rechazada` NO desanula la solicitud: eso ya pasó, y
 * su fila propia es la que dice en qué estado quedó. Las dos son editables por
 * separado desde el mismo registro a propósito — un admin que quiera deshacer
 * de verdad una anulación tiene que tocar las dos, y este comentario existe para
 * que nadie le añada aquí un efecto lateral sobre la solicitud creyendo que
 * arregla una incoherencia. Ese efecto lateral ES la bandeja, y allí ya vive.
 *
 * `clase` NO se puede cambiar, y no es un olvido: es lo que decide qué columnas
 * pueden ir a NULL (el CHECK `modificaciones_campos_por_clase`), así que
 * convertir una anulación en un cambio de fechas exigiría inventarse unas fechas
 * nuevas. Quien se equivocó de clase borra la fila y la vuelve a pedir.
 *
 * `decidida_at` y `aprobador_user_id` tampoco: son el testigo de QUIÉN decidió y
 * CUÁNDO, y el registro existe justo para conservarlos. Editar lo que se decidió
 * es corregir un dato; editar quién lo decidió es falsificarlo.
 */
export async function corregirModificacion(
  db: Pool,
  id: string,
  campos: CorreccionModificacion,
): Promise<Modificacion | null> {
  const { rows } = await db.query(
    `UPDATE portal.solicitud_modificaciones
        SET fecha_inicio_nueva  = $2::date,
            fecha_fin_nueva     = $3::date,
            dias_habiles_nuevos = $4::numeric,
            motivo              = $5,
            estado              = $6
      WHERE id = $1
      RETURNING id`,
    [
      id,
      campos.fechaInicioNueva,
      campos.fechaFinNueva,
      campos.diasHabilesNuevos,
      campos.motivo,
      campos.estado,
    ],
  );
  if (!rows.length) return null;
  // Se relee con el SELECT común en vez de devolver el RETURNING entero: es lo
  // que garantiza que la forma sea EXACTAMENTE la misma que la del resto de
  // lecturas de modificaciones —los casts de `::text` incluidos—, y no una
  // segunda proyección que haya que mantener en paralelo.
  return modificacionPorId(db, id);
}

/**
 * Borra una fila del registro de movimientos. Irreversible.
 *
 * NO toca la solicitud. Borrar la anulación que dejó unas vacaciones anuladas
 * las deja anuladas, y sin nada que explique por qué: es lo que hace que esto
 * sea de admin y quede en el log de hub-api.
 *
 * Devuelve la fila borrada —leída ANTES del DELETE— para que quien llama pueda
 * decir en el log qué era. Después ya no hay a quién preguntárselo.
 */
export async function borrarModificacion(db: Pool, id: string): Promise<Modificacion | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [id]);
    if (!rows.length) return null;
    const borrada = aModificacion(rows[0] as FilaModificacionDb);
    await client.query(`DELETE FROM portal.solicitud_modificaciones WHERE id = $1`, [id]);
    return borrada;
  });
}
