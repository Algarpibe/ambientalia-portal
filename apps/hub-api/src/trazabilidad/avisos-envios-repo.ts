/**
 * «Enviar correo» en «Avisos a clientes» (2026-11-08, migración 069): el flujo
 * del envío de una tarjeta y el SQL de su registro, `portal.tmc_avisos_envios`
 * (único fichero que lo escribe).
 *
 * El navegador sólo dice QUÉ tarjeta (cliente y tramo) y qué equipos vio (sus
 * claves). A quién va y con qué texto lo decide aquí el servidor, con el plan
 * de ese momento (`planAvisos` sobre el mismo inventario y los mismos
 * contactos que GET /equipos): si la tarjeta ya no está, 404; si sus equipos
 * no son los vistos, 409. Sus destinatarios de verdad tienen que ser de 1 a 5
 * correos válidos y distintos —también en prueba, para que la prueba enseñe lo
 * que el real rechazaría—: si no, 409. Nada sale sin una fila «en curso»
 * antes: el índice único parcial por (cliente, tramo) da un 409 al segundo de
 * un doble clic. Lo que conteste el canal decide el final: confirmado →
 * «enviado» (y, en modo real, en la misma transacción, los equipos quedan con
 * «Aviso enviado al cliente» = el día del envío, con `registrarAvisos`);
 * rechazado → «fallido», con el motivo del canal (ya sin el token); sin
 * respuesta, o si esa transacción falla → sigue «en curso», que la pantalla
 * enseña como «sin confirmar» y una persona resuelve («Sí salió» / «No salió»).
 *
 * Cómo se envía no lo sabe este fichero: el canal llega por parámetro
 * (`CanalAvisos`, avisos-correo.ts; el de verdad es envio-avisos.ts).
 */
import type { Pool } from '@algarpibe/zoho-sync';
import { captureError } from '../sentry.js';
import { MAX_DESTINATARIOS, SIN_CONFIRMAR_MS, correoQueSale, correoReal, destinatariosAceptables, estadoPresentado, huellaTexto, mismaHuella, mismosDestinatarios, type CanalAvisos, type CorreoAEnviar, type EnvioAviso, type EstadoCanal, type EstadoGuardado, type ResultadoRemision, type RespuestaEnvios } from './avisos-correo.js';
import { comoTramoAviso, planAvisos, type TramoAviso } from './dominio.js';
import { listarContactos, listarEquipos, registrarAvisos, withTransaction } from './repo.js';
import { TzError, type Actor, type PedidoEnvio } from './types.js';

type PoolClient = Awaited<ReturnType<Pool['connect']>>;
type Db = Pick<PoolClient, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Cuántos envíos enseña «Últimos envíos» (más todos los que sigan en curso). */
export const ULTIMOS_ENVIOS = 30;
const UNICO_EN_CURSO = 'tmc_avisos_envios_en_curso_uq';

const COLS = `id, creado_en::text AS creado_en, EXTRACT(EPOCH FROM (NOW() - creado_en)) * 1000 AS edad_ms, por, modo, clave_cliente, cliente,
  tramo, equipos, destinatarios, enviado_a, asunto, estado, message_id, error, resuelto_por, resuelto_en::text AS resuelto_en`;

function aEnvio(r: Row): EnvioAviso {
  return {
    id: Number(r.id),
    creadoEn: r.creado_en,
    por: r.por,
    modo: r.modo,
    claveCliente: r.clave_cliente,
    cliente: r.cliente,
    // La columna es texto ('90'); la API sirve el tramo canónico (90), el mismo del plan. La 069 sólo admite los cuatro.
    tramo: comoTramoAviso(r.tramo) as TramoAviso,
    equipos: r.equipos,
    destinatarios: r.destinatarios,
    enviadoA: r.enviado_a,
    asunto: r.asunto,
    estado: estadoPresentado(r.estado as EstadoGuardado, Number(r.edad_ms)),
    messageId: r.message_id,
    error: r.error,
    resueltoPor: r.resuelto_por,
    resueltoEn: r.resuelto_en,
  };
}

async function leerEnvio(db: Db, id: number): Promise<EnvioAviso> {
  const { rows } = await db.query(`SELECT ${COLS} FROM portal.tmc_avisos_envios WHERE id = $1`, [id]);
  return aEnvio(rows[0]);
}

/** GET /trazabilidad/avisos/envios: el modo efectivo y los últimos envíos —los que siguen en curso, todos—, el más reciente primero. */
export async function leerEnvios(db: Db, canal: EstadoCanal): Promise<RespuestaEnvios> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM portal.tmc_avisos_envios
      WHERE estado = 'en_curso' OR id IN (SELECT id FROM portal.tmc_avisos_envios ORDER BY id DESC LIMIT $1)
      ORDER BY id DESC`,
    [ULTIMOS_ENVIOS],
  );
  return { canal, envios: (rows as Row[]).map(aEnvio) };
}

/**
 * La tarjeta de ahora del pedido, leída con `db`: el plan sobre el inventario y
 * los contactos de ese momento. 404 si ya no está; 409 si sus equipos no son
 * los vistos (la huella son sus claves, no sus seriales: las mismas que se
 * apuntan y que marca `registrarAvisos`).
 */
async function tarjetaVigente(db: Db, pedido: PedidoEnvio, hoy: string, estado: EstadoCanal) {
  // Lo que se confirmó es lo que sale: el mismo modo y, más abajo, los mismos destinatarios de verdad.
  if (estado.modo !== pedido.modo) throw new TzError('modo_cambiado', 409, 'El modo del envío cambió desde que abriste la confirmación: no se ha enviado nada. Se ha actualizado la pantalla; revisa y vuelve a enviar.');
  const [equipos, contactos] = await Promise.all([listarEquipos(db, hoy), listarContactos(db)]);
  const tarjeta = planAvisos(equipos, hoy, contactos).correos.find((c) => c.claveCliente === pedido.claveCliente && c.tramo === pedido.tramo);
  if (!tarjeta) throw new TzError('tarjeta_no_encontrada', 404, 'Ese aviso ya no está pendiente (puede que ya se haya enviado o que sus equipos hayan cambiado): recarga la página.');
  const claves = tarjeta.equipos.map((a) => a.equipo.clave);
  if (!mismaHuella(claves, pedido.equipos)) throw new TzError('tarjeta_cambiada', 409, 'La tarjeta cambió desde que la abriste: recarga la página y revísala antes de enviar.');
  // Primero que se pueda enviar (también en prueba, para que la prueba enseñe lo que el real rechazaría); después, que sea a quien se confirmó.
  const ahora = correoReal(tarjeta).para;
  if (!destinatariosAceptables(ahora)) {
    throw new TzError('destinatarios_no_validos', 409, `Este aviso no se puede enviar: tiene que ir a entre 1 y ${MAX_DESTINATARIOS} correos válidos y distintos. Pon a mano el contacto del cliente, con ${MAX_DESTINATARIOS} direcciones como mucho, y vuelve a intentarlo. No se ha enviado ni apuntado nada.`);
  }
  if (!mismosDestinatarios(ahora, pedido.para)) throw new TzError('destinatarios_cambiados', 409, 'Los destinatarios de esta tarjeta cambiaron desde que abriste la confirmación: no se ha enviado nada. Se ha actualizado la pantalla; revisa y vuelve a enviar.');
  if (huellaTexto(correoReal(tarjeta)) !== pedido.huellaTexto) throw new TzError('texto_cambiado', 409, 'El texto del aviso cambió desde que abriste la confirmación (una fecha de calibración o un nombre): no se ha enviado nada. Se ha actualizado la pantalla; léelo de nuevo y vuelve a enviar.');
  return { tarjeta, claves };
}

/**
 * Las consultas sobre una conexión, de una en una: el plan lanza varias a la
 * vez, y pg no quiere que se encolen en un mismo cliente. Tras la primera que
 * falla, las demás fallan con su mismo error sin llegar a la conexión: no deben
 * correr tras el ROLLBACK, ni sobre un cliente ya devuelto al pool.
 */
export function enSerie(c: Db): Db {
  let cola: Promise<unknown> = Promise.resolve();
  let fallo: { error: unknown } | null = null;
  const query = (...args: unknown[]) => {
    const p = cola.then(() => {
      if (fallo) throw fallo.error;
      return (c.query as (...a: unknown[]) => Promise<unknown>)(...args);
    });
    cola = p.catch((error: unknown) => {
      fallo ??= { error };
    });
    return p;
  };
  return { query } as unknown as Db;
}

/**
 * Entrega el correo al canal. Si el canal revienta (no debería: contesta
 * siempre) es una duda —pudo salir—: cuenta como sin respuesta. A Sentry va
 * sólo la clase del error, nunca su texto, que podría llevar el correo o la
 * configuración del canal.
 */
async function entregar(canal: CanalAvisos, correo: CorreoAEnviar, id: number): Promise<ResultadoRemision> {
  try {
    return await canal.remitir(correo, id);
  } catch (e) {
    captureError(new Error(`El canal de los avisos falló al entregar (${e instanceof Error ? e.constructor.name : typeof e}).`), { endpoint: 'tmc_aviso_remitir', envio: id });
    return { tipo: 'sin_respuesta' };
  }
}

/**
 * POST /trazabilidad/avisos/envios: envía el aviso de UNA tarjeta y devuelve su
 * envío tal como queda («enviado», «fallido» o «sin confirmar»). `hoy` es el día
 * de Colombia: el del plan y el que se apunta como «Aviso enviado al cliente».
 */
export async function enviarAviso(db: Pool, canal: CanalAvisos, pedido: PedidoEnvio, actor: Actor, hoy: string): Promise<EnvioAviso> {
  const estado = canal.estado();
  if (estado.modo === 'apagado') throw new TzError('envio_apagado', 409, 'El envío de avisos está apagado: no se ha enviado nada.');
  const { tarjeta, claves } = await tarjetaVigente(db, pedido, hoy, estado);
  const real = correoReal(tarjeta);
  const sale = correoQueSale(tarjeta, estado) as CorreoAEnviar; // no es null: apagado ya se rechazó arriba
  // Apuntar y volver a mirar la tarjeta, en UNA transacción y en ese orden. Si otro envío de la misma tarjeta cerró (y marcó sus
  // equipos) entre la lectura de arriba y este apunte, el índice único ya no lo para —ese otro ya no está «en curso»—, pero la segunda
  // lectura, posterior al INSERT (READ COMMITTED), sí lo ve: ROLLBACK, sin fila y sin llamar al canal.
  const id = await withTransaction(db, async (c) => {
    let nuevo: number;
    try {
      const { rows } = await c.query(
        `INSERT INTO portal.tmc_avisos_envios (dia, por_id, por, modo, clave_cliente, cliente, tramo, equipos, destinatarios, enviado_a, asunto)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::text[], $11) RETURNING id`,
        [hoy, actor.userId, actor.email, estado.modo, tarjeta.claveCliente, tarjeta.cliente, String(tarjeta.tramo), claves, real.para, sale.para, sale.asunto],
      );
      nuevo = Number(rows[0].id);
    } catch (e) {
      const pg = e as { code?: string; constraint?: string };
      if (pg.code === '23505' && pg.constraint === UNICO_EN_CURSO) throw new TzError('ya_enviando', 409, 'Este aviso ya se está enviando, o quedó sin confirmar: míralo en «Últimos envíos».');
      throw e;
    }
    await tarjetaVigente(enSerie(c), pedido, hoy, canal.estado());
    return nuevo;
  });
  const r = await entregar(canal, sale, id);
  if (r.tipo === 'rechazado') {
    await db.query(`UPDATE portal.tmc_avisos_envios SET estado = 'fallido', error = $2, terminado_en = NOW() WHERE id = $1 AND estado = 'en_curso'`, [id, r.motivo]);
  } else if (r.tipo === 'enviado') {
    try {
      await withTransaction(db, async (c) => {
        const { rows } = await c.query(
          `UPDATE portal.tmc_avisos_envios SET estado = 'enviado', message_id = $2, terminado_en = NOW()
            WHERE id = $1 AND estado = 'en_curso' RETURNING modo, equipos, dia::text AS dia`,
          [id, r.messageId],
        );
        // Llegó tarde: alguien ya lo resolvió a mano. No se toca, pero el desajuste queda a la vista.
        if (rows.length === 0) captureError(new Error('El canal confirmó un aviso que ya estaba resuelto a mano.'), { endpoint: 'tmc_aviso_enviado_tardio', envio: id, messageId: r.messageId });
        else if (rows[0].modo === 'real') await registrarAvisos(c, rows[0].equipos, rows[0].dia, actor);
      });
    } catch (e) {
      // El correo salió, pero no quedó apuntado: sigue «en curso» y una persona lo resuelve («Sí salió»).
      captureError(e, { endpoint: 'tmc_aviso_enviar_cierre' });
    }
  }
  const envio = await leerEnvio(db, id);
  return envio.estado === 'en_curso' ? { ...envio, estado: 'sin_confirmar' } : envio;
}

/**
 * POST /trazabilidad/avisos/envios/:id/resolver: una persona dice si un «sin
 * confirmar» salió (`salio`) o no. Sólo vale para un «en curso» de 2 minutos o
 * más; «Sí salió» en modo real marca los equipos con el día del envío.
 */
export async function resolverEnvio(db: Pool, id: number, salio: boolean, actor: Actor): Promise<EnvioAviso> {
  return withTransaction(db, async (c) => {
    const { rows } = await c.query(
      `UPDATE portal.tmc_avisos_envios
          SET estado = $2::varchar, error = CASE WHEN $2::varchar = 'fallido' THEN 'No salió: resuelto a mano.' ELSE error END,
              terminado_en = NOW(), resuelto_por_id = $3, resuelto_por = $4, resuelto_en = NOW()
        WHERE id = $1 AND estado = 'en_curso' AND creado_en <= NOW() - make_interval(secs => $5)
        RETURNING modo, equipos, dia::text AS dia`,
      [id, salio ? 'enviado' : 'fallido', actor.userId, actor.email, SIN_CONFIRMAR_MS / 1000],
    );
    if (rows.length === 0) {
      const { rows: hay } = await c.query('SELECT 1 FROM portal.tmc_avisos_envios WHERE id = $1', [id]);
      if (hay.length === 0) throw new TzError('not_found', 404, 'Ese envío no existe.');
      throw new TzError('no_sin_confirmar', 409, 'Ese envío no está sin confirmar: ya se resolvió o todavía se está enviando (espera un par de minutos).');
    }
    if (salio && rows[0].modo === 'real') await registrarAvisos(c, rows[0].equipos, rows[0].dia, actor);
    return leerEnvio(c, id);
  });
}
