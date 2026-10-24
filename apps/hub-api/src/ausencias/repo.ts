import type { Pool } from '@algarpibe/zoho-sync';
import { cambiaLaHoja, estaEnElCalendario } from './types.js';
import type {
  Adjunto,
  ClaseModificacion,
  EstadoModificacion,
  EventoBorrado,
  EventoCorreccion,
  EventoModificacion,
  EventoSolicitud,
  Modificacion,
  PayloadEvento,
  Solicitud,
  TipoSolicitud,
  Transicion,
} from './types.js';

// Acceso a datos de la app de ausencias. SQL crudo con parámetros posicionales,
// como el resto del repo (no hay ORM). Todas las tablas van cualificadas con
// `portal.` — la BD zoho-hub tiene un `public` ajeno.

// ARQ-612 — la transacción, el candado por empleado (DATA-336) y el recorte por
// rama viven en repo/comun.ts, para que los trozos que salgan de este fichero
// los importen en vez de copiarlos. Se reexporta lo que ya se exportaba desde
// aquí: service.ts y router.ts lo usan como `repo.*`, y el doble de
// router.test.ts compara sus exportaciones con las de este fichero.
import {
  bloquearDuenoDe,
  bloquearEmpleado,
  conCandadoDelEmpleado,
  duenoDe,
  ramaDeDosNiveles,
  withTransaction,
  type Consultable,
  type PoolClient,
} from './repo/comun.js';
export { conCandadoDelEmpleado, ramaDeDosNiveles, type Consultable, type PoolClient };
// La regla del solape, en repo/solapes.ts (reexportado más abajo): la usan la
// decisión de una modificación y la corrección de admin, que siguen aquí.
import { ocupaAgenda, solapeDe, type Solape } from './repo/solapes.js';

// ── Empleados y organigrama ────────────────────────────────────────────────

// ARQ-612 — en repo/empleados.ts, los dos juntos: comparten las columnas y la
// traducción de la ficha. Se reexporta todo, como los grupos de abajo.
export * from './repo/empleados.js';

// ── Saldos: vacaciones y compensatorios ────────────────────────────────────

// ARQ-612 — en repo/saldos.ts (y la traducción de la fila, compartida con la
// baja, en repo/filas.ts, que es interno y NO se reexporta).
export * from './repo/saldos.js';

// ── Llaves de la ficha (visores y exportadores) ────────────────────────────

// ARQ-612 — en repo/visores.ts. Se reexporta todo, como los KPIs de abajo.
export * from './repo/visores.js';

// ── Panel de KPIs ──────────────────────────────────────────────────────────

// ARQ-612 — en repo/kpis.ts. Se reexporta todo: service.ts las llama como
// `repo.*` y el doble de router.test.ts compara sus exportaciones con estas.
export * from './repo/kpis.js';

// ── Histórico importado de la hoja ─────────────────────────────────────────

// ARQ-612 — en repo/historico.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/historico.js';

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

// Aquí estaba `todasLasSolicitudes`, la compañía entera sin acotar por nadie,
// que servía al `GET /ausencias/historico` de admin. La sustituye `movimientos`
// (al final del fichero): trae también las anulaciones y los cambios, y sobre
// todo acepta un `soloDe` con el que el servicio recorta por rama. Una consulta
// sin recorte que no llama nadie es una que alguien acaba llamando desde una
// ruta sin guard.

// ── Modificaciones ─────────────────────────────────────────────────────────

/**
 * Las columnas del satélite, siempre con el prefijo `mod_`.
 *
 * El prefijo no es cosmético: estas mismas columnas viajan dentro del `LEFT
 * JOIN` de `SELECT_SOLICITUD`, donde `id`, `estado`, `motivo_rechazo`,
 * `created_at`, `aprobador_correo`, `decidida_at` y `solicitante_email` chocan
 * una a una con las de la solicitud. Con un solo juego de alias, un único mapa
 * (`aModificacion`) sirve para la consulta suelta y para la del JOIN.
 *
 * Se consulta siempre con la tabla aliasada `m` por lo mismo.
 */
const COLS_MODIFICACION = `
  m.id AS mod_id, m.solicitud_id AS mod_solicitud_id, m.clase AS mod_clase,
  m.estado_previo AS mod_estado_previo,
  m.fecha_inicio_previa::text AS mod_fecha_inicio_previa,
  m.fecha_fin_previa::text    AS mod_fecha_fin_previa,
  -- ::float8 por lo mismo que en dias_habiles de la solicitud: NUMERIC llega
  -- como STRING y "5.0" rompe la aritmetica de los correos y de la UI.
  m.dias_habiles_previos::float8 AS mod_dias_habiles_previos,
  m.fecha_inicio_nueva::text  AS mod_fecha_inicio_nueva,
  m.fecha_fin_nueva::text     AS mod_fecha_fin_nueva,
  m.dias_habiles_nuevos::float8 AS mod_dias_habiles_nuevos,
  m.motivo AS mod_motivo, m.estado AS mod_estado,
  m.aprobador_correo AS mod_aprobador_correo,
  m.solicitante_email AS mod_solicitante_email,
  m.decidida_at::text AS mod_decidida_at,
  m.motivo_rechazo AS mod_motivo_rechazo,
  m.created_at::text AS mod_created_at`;

const SELECT_MODIFICACION = `SELECT ${COLS_MODIFICACION} FROM portal.solicitud_modificaciones m`;

interface FilaModificacionDb {
  mod_id: string;
  mod_solicitud_id: string;
  mod_clase: ClaseModificacion;
  mod_estado_previo: Solicitud['estado'];
  mod_fecha_inicio_previa: string;
  mod_fecha_fin_previa: string;
  mod_dias_habiles_previos: number;
  mod_fecha_inicio_nueva: string | null;
  mod_fecha_fin_nueva: string | null;
  mod_dias_habiles_nuevos: number | null;
  mod_motivo: string | null;
  mod_estado: EstadoModificacion;
  mod_aprobador_correo: string;
  mod_solicitante_email: string;
  mod_decidida_at: string | null;
  mod_motivo_rechazo: string | null;
  mod_created_at: string;
}

/** Las mismas columnas vistas desde el LEFT JOIN: todas null si no hay propuesta. */
type FilaModificacionJoinDb = { [K in keyof FilaModificacionDb]: FilaModificacionDb[K] | null };

function aModificacion(r: FilaModificacionDb): Modificacion {
  return {
    id: r.mod_id,
    solicitudId: r.mod_solicitud_id,
    clase: r.mod_clase,
    estadoPrevio: r.mod_estado_previo,
    fechaInicioPrevia: r.mod_fecha_inicio_previa,
    fechaFinPrevia: r.mod_fecha_fin_previa,
    diasHabilesPrevios: r.mod_dias_habiles_previos,
    fechaInicioNueva: r.mod_fecha_inicio_nueva,
    fechaFinNueva: r.mod_fecha_fin_nueva,
    diasHabilesNuevos: r.mod_dias_habiles_nuevos,
    motivo: r.mod_motivo,
    estado: r.mod_estado,
    aprobadorCorreo: r.mod_aprobador_correo,
    solicitanteEmail: r.mod_solicitante_email,
    decididaAt: r.mod_decidida_at,
    motivoRechazo: r.mod_motivo_rechazo,
    createdAt: r.mod_created_at,
  };
}

// ── Solicitudes ────────────────────────────────────────────────────────────

const SELECT_SOLICITUD = `
  SELECT s.id, s.tipo, s.empleado_id, e.nombre_completo AS empleado_nombre, e.cargo AS empleado_cargo,
         s.solicitante_email, s.fecha_inicio::text AS fecha_inicio, s.fecha_fin::text AS fecha_fin,
         -- ::float8 NO es cosmetico: desde que la columna es NUMERIC (para
         -- admitir el medio dia del historico), el driver la devolveria como
         -- STRING para no perder precision, y "5.0" romperia toda la aritmetica
         -- de la UI y de los correos. Cuatro digitos con un decimal caben de
         -- sobra en un double sin error de representacion observable.
         s.dias_habiles::float8 AS dias_habiles,
         -- to_char y no ::text: el driver devuelve un TIME como '09:00:00', y
         -- esos segundos se cuelan tal cual en el ISO que se le manda a Google
         -- y en el value de un <input type="time">, que solo entiende HH:MM.
         -- Es el mismo gotcha que el ::text de las fechas, con otra cara.
         to_char(s.hora_inicio, 'HH24:MI') AS hora_inicio,
         to_char(s.hora_fin,    'HH24:MI') AS hora_fin,
         s.observaciones, s.origen,
         s.comentarios, s.estado, s.aprobador_correo, s.segundo_aprobador_correo, s.informado_correo,
         -- ::text por lo mismo que las fechas de mas arriba: el driver devuelve
         -- timestamptz como objeto Date, y una comparacion lexicografica contra
         -- una cadena fallaria en silencio.
         s.primera_firma_at::text AS primera_firma_at,
         s.decidida_at::text AS decidida_at, s.motivo_rechazo, s.created_at::text AS created_at,
         s.anulada_at::text AS anulada_at,
         -- Sin ::text: es TEXT en la base, no una fecha ni un numero.
         s.evento_calendario_id,
         a.id AS adjunto_id, a.nombre_archivo, a.mime,
         -- octet_length y no el binario: las listas solo necesitan el tamano.
         octet_length(a.contenido) AS adjunto_bytes,
         e.copia_correo,
         ${COLS_MODIFICACION}
    FROM portal.solicitudes_ausencia s
    JOIN portal.empleados e ON e.id = s.empleado_id
    LEFT JOIN portal.solicitud_adjuntos a ON a.solicitud_id = s.id
    -- La propuesta VIVA, si la hay. El JOIN no puede multiplicar filas: el
    -- indice unico parcial ux_modificaciones_una_pendiente de la 024 admite
    -- como mucho una con estado 'pendiente' por solicitud. Si esa condicion
    -- desapareciera, las OCHO consultas que usan este SELECT empezarian a
    -- duplicar resultados a la vez.
    LEFT JOIN portal.solicitud_modificaciones m
           ON m.solicitud_id = s.id AND m.estado = 'pendiente'`;

interface FilaSolicitudDb extends FilaModificacionJoinDb {
  id: string;
  tipo: TipoSolicitud;
  empleado_id: string;
  empleado_nombre: string;
  empleado_cargo: string | null;
  solicitante_email: string;
  fecha_inicio: string;
  fecha_fin: string;
  dias_habiles: number;
  hora_inicio: string | null;
  hora_fin: string | null;
  observaciones: string | null;
  origen: Solicitud['origen'];
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobador_correo: string | null;
  segundo_aprobador_correo: string | null;
  informado_correo: string | null;
  primera_firma_at: string | null;
  decidida_at: string | null;
  motivo_rechazo: string | null;
  created_at: string;
  adjunto_id: string | null;
  nombre_archivo: string | null;
  mime: string | null;
  adjunto_bytes: number | null;
  copia_correo: string | null;
  anulada_at: string | null;
  evento_calendario_id: string | null;
}

function aSolicitud(r: FilaSolicitudDb): Solicitud {
  const adjunto: Adjunto | null = r.adjunto_id
    ? {
        id: r.adjunto_id,
        nombreArchivo: r.nombre_archivo ?? '',
        mime: r.mime ?? '',
        bytes: r.adjunto_bytes ?? 0,
      }
    : null;
  return {
    id: r.id,
    tipo: r.tipo,
    empleadoId: r.empleado_id,
    empleadoNombre: r.empleado_nombre,
    empleadoCargo: r.empleado_cargo,
    solicitanteEmail: r.solicitante_email,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
    diasHabiles: r.dias_habiles,
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
    observaciones: r.observaciones,
    origen: r.origen,
    comentarios: r.comentarios,
    estado: r.estado,
    aprobadorCorreo: r.aprobador_correo,
    segundoAprobadorCorreo: r.segundo_aprobador_correo,
    informadoCorreo: r.informado_correo,
    primeraFirmaAt: r.primera_firma_at,
    decididaAt: r.decidida_at,
    motivoRechazo: r.motivo_rechazo,
    createdAt: r.created_at,
    adjunto,
    copiaCorreo: r.copia_correo,
    // El cast es seguro por el `if`: en el LEFT JOIN, o vienen TODAS las
    // columnas del satélite o ninguna, así que `mod_id` decide por las demás.
    modificacionPendiente: r.mod_id ? aModificacion(r as FilaModificacionDb) : null,
    anuladaAt: r.anulada_at,
    eventoCalendarioId: r.evento_calendario_id,
  };
}

export interface DatosInsercion {
  tipo: TipoSolicitud;
  empleadoId: string;
  solicitanteEmail: string;
  fechaInicio: string;
  fechaFin: string;
  diasHabiles: number;
  /** Solo en un permiso de un día. Las dos o ninguna: lo exige el CHECK. */
  horaInicio: string | null;
  horaFin: string | null;
  comentarios: string | null;
  estado: Solicitud['estado'];
  aprobadorCorreo: string | null;
  /** Copia congelada: un cambio de organigrama no mueve una solicitud en vuelo. */
  segundoAprobadorCorreo: string | null;
  /** Congelado por lo mismo que los firmantes: nace del árbol, no de un ajuste. */
  informadoCorreo: string | null;
}

/**
 * Deja constancia de si esta solicitud es dueña de un evento VIVO en el
 * calendario.
 *
 * La columna no significa «alguna vez impusimos un id»: significa «ahora
 * mismo hay un evento en Google que responde a este id». `crear` la anota y
 * `borrar` la vacía, porque el evento que describía ya no existe. Las
 * solicitudes aprobadas antes de esto nunca la anotaron: llevan en Google un
 * id que inventó Google y que nadie apuntó, y por eso siguen pidiendo el
 * ajuste a mano. Ver `correccionDeCalendario` en notificaciones.ts.
 *
 * Va en la MISMA transacción que el INSERT del outbox: si el evento sale, la
 * marca cambia, y si hay ROLLBACK no cambia ninguna de las dos.
 */
async function anotarEventoDeCalendario(
  client: PoolClient,
  solicitud: Solicitud,
  payload: PayloadEvento,
): Promise<void> {
  // La condicion se lee del PAYLOAD, no de una lista de eventos copiada aqui:
  // asi la marca se escribe exactamente cuando se emite la accion, y no puede
  // desincronizarse de construirPayload el dia que cambie el reparto de efectos.
  const cal = payload.calendario;
  if (cal?.accion !== 'crear' && cal?.accion !== 'borrar') return;
  // `borrar` la VACIA: la columna dice si hay evento vivo en Google, no si
  // alguna vez impusimos un id. Dejarla puesta tras un borrado hace que la
  // siguiente correccion mande un `actualizar` contra un evento que no existe,
  // y el IF de fallos esperables de n8n se lo traga como 404: en silencio.
  const id = cal.accion === 'crear' ? cal.eventId : null;
  await client.query(`UPDATE portal.solicitudes_ausencia SET evento_calendario_id = $2 WHERE id = $1`, [
    solicitud.id,
    id,
  ]);
  // La fila se leyo con SELECT_SOLICITUD ANTES de este UPDATE, asi que el objeto
  // que se devuelve llevaria un valor que dejo de ser cierto hace dos lineas. Y
  // este campo decide si Google se corrige solo: devolverlo obsoleto es
  // exactamente la clase de texto caducado que mas cara sale en esta app.
  solicitud.eventoCalendarioId = id;
}

/**
 * Crea la solicitud, su adjunto y el evento de outbox **en una transacción**:
 * una solicitud guardada sin su evento nunca notificaría a nadie, y un evento
 * sin solicitud es basura que n8n reintentaría en bucle.
 *
 * El alta del servidor NO pasa por aquí sino por `insertarSolicitud`, dentro de
 * `conCandadoDelEmpleado` (DATA-336). Esta se queda para quien ya sabe que no
 * compite con nadie, como la siembra de los tests.
 */
export async function crearSolicitud(
  db: Pool,
  datos: DatosInsercion,
  adjunto: { nombreArchivo: string; mime: string; contenido: Buffer } | null,
  eventos: EventoSolicitud[],
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud> {
  return withTransaction(db, (client) => insertarSolicitud(client, datos, adjunto, eventos, construirPayload));
}

/** Lo que hace `crearSolicitud`, sobre una transacción que ya abrió otro. */
export async function insertarSolicitud(
  client: PoolClient,
  datos: DatosInsercion,
  adjunto: { nombreArchivo: string; mime: string; contenido: Buffer } | null,
  eventos: EventoSolicitud[],
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud> {
  const { rows } = await client.query(
    `INSERT INTO portal.solicitudes_ausencia
       (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin,
        dias_habiles, comentarios, estado, aprobador_correo, segundo_aprobador_correo,
        informado_correo, hora_inicio, hora_fin)
     VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12::time, $13::time)
     RETURNING id`,
    [
      datos.tipo,
      datos.empleadoId,
      datos.solicitanteEmail,
      datos.fechaInicio,
      datos.fechaFin,
      datos.diasHabiles,
      datos.comentarios,
      datos.estado,
      datos.aprobadorCorreo,
      datos.segundoAprobadorCorreo,
      datos.informadoCorreo,
      datos.horaInicio,
      datos.horaFin,
    ],
  );
  const id = (rows[0] as { id: string }).id;

  if (adjunto) {
    await client.query(
      `INSERT INTO portal.solicitud_adjuntos (solicitud_id, nombre_archivo, mime, contenido)
       VALUES ($1, $2, $3, $4)`,
      [id, adjunto.nombreArchivo, adjunto.mime, adjunto.contenido],
    );
  }

  const { rows: creada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
  const solicitud = aSolicitud(creada[0] as FilaSolicitudDb);

  // El orden importa: el outbox se sirve por `id` ascendente, así que el
  // acuse al solicitante sale antes que el aviso a quien aprueba.
  for (const evento of eventos) {
    const payload = construirPayload(solicitud, evento);
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, evento, JSON.stringify(payload)],
    );
    await anotarEventoDeCalendario(client, solicitud, payload);
  }

  return solicitud;
}

export async function solicitudesDeEmpleado(db: Pool, empleadoId: string): Promise<Solicitud[]> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.empleado_id = $1 ORDER BY s.created_at DESC`, [
    empleadoId,
  ]);
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * Las solicitudes que le toca decidir a `aprobadorCorreo` **ahora**. Un admin
 * (`todas`) ve las de todo el mundo: es quien destraba una aprobación bloqueada.
 *
 * El filtro es por TURNO, no por «aparezco en la solicitud»: en `pendiente` solo
 * la ve quien firma primero, y en `pendiente_2` solo quien firma después. Si
 * fuera un OR de los dos correos, el segundo aprobador vería —y podría firmar—
 * solicitudes que su jefe intermedio todavía no ha visto.
 */
export async function solicitudesPendientes(db: Pool, aprobadorCorreo: string, todas: boolean): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      WHERE s.estado IN ('pendiente', 'pendiente_2')
        AND ($2::boolean
             OR (s.estado = 'pendiente'   AND lower(s.aprobador_correo)         = lower($1))
             OR (s.estado = 'pendiente_2' AND lower(s.segundo_aprobador_correo) = lower($1)))
      ORDER BY s.created_at`,
    [aprobadorCorreo, todas],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

// Aquí estaba `solicitudesDecididas`, el historial del aprobador: lo ya cerrado
// que le tocaba firmar a un correo. Lo sustituye `movimientos` (al final del
// fichero), que enseña ese mismo rastro y el de toda su rama, con las
// anulaciones y los cambios que esta consulta no alcanzaba. Su `ORDER BY`
// sobrevive en `porFechaDeCierre`, con el porqué del `NULLS LAST` intacto.

/**
 * Las solicitudes que llevan un PDF, de cualquiera y en cualquier estado.
 *
 * Sin acotar por persona: quien llega aquí ya pasó el guard de administración del
 * servicio. Reutiliza `SELECT_SOLICITUD`, así que el binario NO viaja — solo su
 * `octet_length`.
 *
 * Nota: `solicitud_adjuntos` no tiene UNIQUE sobre `solicitud_id`. Hoy no puede
 * haber dos, porque el alta inserta uno como mucho, pero si algún día los
 * hubiera, esta consulta duplicaría la fila y sería aquí donde se vería.
 */
/**
 * Quienes tienen a `$1` como JEFE INMEDIATO —la primera firma—, y nadie más.
 *
 * ⚠️ UN SOLO NIVEL, más estrecho que `ramaDeDosNiveles`, y la diferencia es
 * deliberada. Aquel sirve al Calendario y al Registro general, donde el dato es
 * «fulano no está»; este sirve a los SOPORTES, que son PDF médicos. Quien firma
 * una solicitud necesita abrir su soporte; el jefe de su jefe no ha necesitado
 * abrirlo para nada, y con dos niveles vería los informes médicos de una
 * organización entera sin haber firmado una sola de esas solicitudes.
 *
 * Que un permiso sea MÁS estrecho que el del calendario no es una incoherencia:
 * es que el dato de debajo es más sensible.
 *
 * Asume que `portal.empleados` va aliasada como `e`, igual que su hermana.
 */
export function equipoDirecto(): string {
  return `($1::text IS NULL OR lower(e.aprobador_correo) = lower($1))`;
}

export async function solicitudesConAdjunto(db: Pool, soloDe: string | null): Promise<Solicitud[]> {
  const { rows } = await db.query(
    `${SELECT_SOLICITUD}
      WHERE a.id IS NOT NULL
        AND ${equipoDirecto()}
      ORDER BY s.fecha_inicio DESC`,
    [soloDe],
  );
  return (rows as FilaSolicitudDb[]).map(aSolicitud);
}

/**
 * ¿Tiene `correoEmpleado` a `correoJefe` como jefe inmediato?
 *
 * ⚠️ Existe para que `GET /ausencias/adjuntos/:id` aplique EL MISMO recorte que
 * la lista. Sin ella, acotar la pestaña no serviría de nada: la ruta del adjunto
 * suelto seguiría sirviendo cualquier PDF a quien tuviera la llave, y bastaría
 * con conocer la URL. Una pantalla que esconde lo que la API entrega no protege
 * nada; es la versión incómoda del mismo acceso.
 *
 * NO exige que el empleado esté activo, al contrario que las listas que usan
 * estos predicados para pintar plantilla: los soportes de quien se fue siguen
 * existiendo y su jefe sigue necesitando abrirlos.
 */
export async function esDeSuEquipoDirecto(
  db: Pool,
  correoJefe: string,
  correoEmpleado: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados e
      WHERE lower(e.correo) = lower($2)
        AND ${equipoDirecto()}`,
    [correoJefe, correoEmpleado],
  );
  return rows.length > 0;
}

/**
 * Una solicitud por su id, con lo que le cuelga del `SELECT_SOLICITUD`.
 *
 * Acepta `PoolClient` además de `Pool` por lo mismo que `solapeDe`: cuando
 * `actualizarSolicitud` la usa para releer lo que acaba de escribir, tiene que ir
 * por la conexión de la transacción o no vería el UPDATE sin confirmar y
 * devolvería la fila de antes.
 */
export async function solicitudPorId(db: Pool | PoolClient, id: string): Promise<Solicitud | null> {
  const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
  return rows.length ? aSolicitud(rows[0] as FilaSolicitudDb) : null;
}

/**
 * Registra la decisión y encola su notificación, en una transacción.
 *
 * El `WHERE estado = $N` es lo que hace la operación idempotente sin bloqueos:
 * dos clics en «Aprobar» a la vez, o un reintento del navegador, y solo el
 * primero actualiza. El segundo no encuentra fila y el servicio lo traduce a 409,
 * en vez de mandar dos correos contradictorios.
 *
 * ⚠️ `estadoEsperado` es el estado que el servicio LEYÓ, y funciona como testigo
 * de concurrencia optimista. No sustituirlo por un `IN ('pendiente','pendiente_2')`
 * con un CASE para el destino: sería igual de atómico pero destruiría el 409, y un
 * doble clic del jefe inmediato encadenaría `pendiente → pendiente_2 → aprobada`
 * con una sola persona firmando las dos veces.
 *
 * Lo vigila `repo.testigos.db.test.ts`: dos llamadas con el mismo
 * `estadoEsperado` —el doble clic— y la segunda tiene que devolver `null` sin
 * encolar un segundo correo. Falsado sustituyendo el testigo por un `IN`: el
 * test se pone rojo. Corre en el cuarto portón, `npm run test:db`.
 */
export async function decidirSolicitud(
  db: Pool,
  id: string,
  estadoEsperado: Solicitud['estado'],
  transicion: Transicion,
  motivo: string | null,
  userId: string | null,
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
  /**
   * El segundo constructor, para el aviso de la propuesta que caduca. Va aparte
   * del de arriba y no fundido en uno polimórfico porque son dos payloads con
   * dos formas distintas — uno habla de la solicitud y el otro de la propuesta—,
   * y fundirlos obligaría a discriminar por el nombre del evento dentro.
   */
  construirPayloadCaducada: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia
          SET estado                = $2,
              motivo_rechazo        = $3,
              primera_firma_user_id = CASE WHEN $5::boolean THEN $4 ELSE primera_firma_user_id END,
              primera_firma_at      = CASE WHEN $5::boolean THEN now() ELSE primera_firma_at END,
              aprobador_user_id     = CASE WHEN $6::boolean THEN $4 ELSE aprobador_user_id END,
              decidida_at           = CASE WHEN $6::boolean THEN now() ELSE decidida_at END
        WHERE id = $1 AND estado = $7
        RETURNING id`,
      [
        id,
        transicion.estado,
        motivo,
        userId,
        transicion.esPrimeraFirma,
        transicion.esDecisionFinal,
        estadoEsperado,
      ],
    );
    // Sin fila = ya la decidió otro (o no existe). No es un error de servidor:
    // el servicio lo traduce a 409 y no se encola ninguna notificación.
    if (rows.length === 0) return null;

    const { rows: actualizada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(actualizada[0] as FilaSolicitudDb);

    const payload = construirPayload(solicitud, transicion.evento);
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, transicion.evento, JSON.stringify(payload)],
    );
    await anotarEventoDeCalendario(client, solicitud, payload);

    await caducarPropuestaViva(client, id, solicitud, construirPayloadCaducada);

    return solicitud;
  });
}

/**
 * Cierra la petición de cambio que estuviera viva sobre esta solicitud, porque
 * acaba de dejar de poder aplicarse.
 *
 * ⚠️ Esto NO es una decisión de producto que se pueda discutir aparte: la
 * propuesta ya estaba muerta antes de existir esta función. El `TESTIGO_SOLICITUD`
 * de `decidirModificacion` compara el ESTADO de la solicitud, así que en cuanto
 * la solicitud se mueve —y firmarla la mueve SIEMPRE, incluso el paso de
 * `pendiente` a `pendiente_2`— aprobarla contesta 409 y nada la revive. Lo único
 * que cambia aquí es que el sistema lo reconoce en vez de dejarla `pendiente`
 * para siempre.
 *
 * Y lo que arregla no es cosmético. El índice único parcial de la 024 solo admite
 * UNA propuesta viva por solicitud, así que esa fila muerta dejaba al trabajador
 * sin poder pedir otro cambio sobre esa misma solicitud, con un 409 que hablaba
 * de una petición que él daba por perdida.
 *
 * Va DENTRO de la transacción de la firma, y con su aviso en el outbox, por lo
 * mismo que el resto: si se hiciera después y el proceso se cayera entre medias,
 * la propuesta quedaría caducada sin que nadie se lo hubiera dicho a nadie.
 */
async function caducarPropuestaViva(
  client: PoolClient,
  solicitudId: string,
  solicitud: Solicitud,
  construirPayload: (s: Solicitud, m: Modificacion, evento: EventoModificacion) => PayloadEvento,
): Promise<void> {
  const { rows } = await client.query(
    `UPDATE portal.solicitud_modificaciones
        SET estado = 'caducada'
      WHERE solicitud_id = $1 AND estado = 'pendiente'
      RETURNING id`,
    [solicitudId],
  );
  // Lo normal: no había ninguna viva y no hay nada que avisar.
  if (rows.length === 0) return;

  // Se relee con el SELECT común en vez de construirla desde el RETURNING: es lo
  // que garantiza que el correo hable de la MISMA forma de propuesta que el
  // resto del módulo, con sus `::text` incluidos.
  const { rows: cerrada } = await client.query(`${SELECT_MODIFICACION} WHERE m.id = $1`, [
    (rows[0] as { id: string }).id,
  ]);
  const modificacion = aModificacion(cerrada[0] as FilaModificacionDb);

  await client.query(
    `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
    [
      solicitudId,
      'modificacion_caducada',
      JSON.stringify(construirPayload(solicitud, modificacion, 'modificacion_caducada')),
    ],
  );
}

/**
 * El dueño retira su propia solicitud, antes de que nadie la haya firmado.
 *
 * La deja en `rechazada` + `anulada_at`, que es el MISMO estado terminal en el
 * que la dejaría una anulación aprobada. Reutilizarlo y no estrenar un
 * `'retirada'` es deliberado: `estado <> 'rechazada'` está repartido por media
 * docena de consultas —el calendario, el solape, el saldo— y un estado nuevo
 * tendría que añadirse a todas ellas, con el fallo cayendo del lado de contar
 * como ausencia unos días que ya nadie disfruta.
 *
 * ⚠️ El testigo del WHERE es lo único que impide la carrera contra la firma. Las
 * dos condiciones hacen falta y no sobra ninguna:
 *  - `estado = 'pendiente'`: si el jefe firma entre el SELECT del servicio y
 *    este UPDATE, aquí ya no hay fila y gana él. Cero filas → 409, igual que en
 *    `decidirSolicitud`.
 *  - `primera_firma_at IS NULL`: cinturón sobre lo mismo por otra vía. Un admin
 *    puede devolver una solicitud a `pendiente` con el PATCH del registro sin
 *    borrar esa marca, y entonces «pendiente» convive con una firma YA DADA.
 *    Retirarla ahí borraría el visto bueno del jefe inmediato sin decírselo.
 *
 * NO se toca `decidida_at` ni `aprobador_user_id`: no ha decidido nadie. El
 * registro lo enseña como anulada y sin decisor, que es exactamente lo que pasó
 * — y es lo que distingue una retirada de una anulación firmada por un jefe.
 */
export async function retirarSolicitud(
  db: Pool,
  id: string,
  construirPayload: (solicitud: Solicitud, evento: EventoSolicitud) => PayloadEvento,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `UPDATE portal.solicitudes_ausencia
          SET estado = 'rechazada', anulada_at = now()
        WHERE id = $1 AND estado = 'pendiente' AND primera_firma_at IS NULL
        RETURNING id`,
      [id],
    );
    if (rows.length === 0) return null;

    const { rows: actualizada } = await client.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const solicitud = aSolicitud(actualizada[0] as FilaSolicitudDb);

    // Sin `anotarEventoDeCalendario`: una `pendiente` nunca creó evento, así que
    // no hay id que apuntar ni nada que borrar en Google.
    await client.query(
      `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, 'retirada', JSON.stringify(construirPayload(solicitud, 'retirada'))],
    );

    return solicitud;
  });
}

// ── Modificaciones: alta y retirada ────────────────────────────────────────

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

// ── Adjuntos ───────────────────────────────────────────────────────────────

// ARQ-612 — en repo/adjuntos.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/adjuntos.js';

// ── Outbox ─────────────────────────────────────────────────────────────────

// ARQ-612 — el lado lector, en repo/outbox.ts. Los INSERT de eventos se quedan
// dentro de las transacciones de solicitudes y modificaciones de este fichero.
export * from './repo/outbox.js';

// ── Calendario ─────────────────────────────────────────────────────────────

// ARQ-612 — en repo/calendario.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/calendario.js';

// ── Solapes ────────────────────────────────────────────────────────────────

// ARQ-612 — en repo/solapes.ts. Se reexporta todo; las escrituras de este
// fichero que comprueban el solape lo importan arriba.
export * from './repo/solapes.js';

// ── El registro de movimientos ─────────────────────────────────────────────

// ARQ-612 — en repo/registro.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/registro.js';

// ── Baja de empleados ──────────────────────────────────────────────────────

// ARQ-612 — en repo/retiro.ts. Se reexporta todo, como los grupos de arriba.
export * from './repo/retiro.js';
