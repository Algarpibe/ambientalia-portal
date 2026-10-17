/**
 * SQL de las marcas en seguimiento (lote 9f, migración 061): leer cada marca
 * con su vista previa, encender o apagar una (con motivo y firma) y dejar su
 * apunte. Qué entra en el inventario lo decide `EN_INVENTARIO` (inventario.ts)
 * al leer: aquí no se escribe ningún equipo ni se le cambia el ámbito.
 *
 * Encender escribe además, en la MISMA transacción, lo que la marca necesita
 * para que sus fechas no se muevan (`planAdopcion`, marcas.ts): la fila
 * `fst022` de partida de cada equipo suyo, desde la hoja congelada, y la clave
 * de su equipo en las calibraciones guardadas sin clave que la pestaña ya le
 * atribuía por serial (de Desk y manuales). Una fecha NO se edita: la partida
 * es una fila nueva (una por equipo: si ya existe, no se duplica) y el enlace
 * sólo pone la clave a una fila que no la tenía; su fecha, su estado y sus
 * firmas se quedan como estaban. Apagar no borra nada: deja de contar.
 *
 * Una sincronización del maestro que da de alta un equipo de una marca
 * incluida lo hace entrar solo en el inventario; `adoptarIncluidas` le da su
 * partida y sus sueltas en esa misma transacción (maestro-repo.ts).
 *
 * Toma el bloqueo de la pasada de calibraciones (escribe calibraciones: una
 * pasada, una corrección a mano y esto van una detrás de otra) y el suyo.
 * marcas.test.ts vigila la lista de escrituras. No avisa a nadie.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { serialNorm } from './dominio.js';
import { leerEntradaHoja } from './hoja-repo.js';
import { tablaHoja, type EquipoHoja } from './hoja.js';
import { CLAVE_EDM180, claveMarca, marcasEnSeguimiento, planAdopcion, type Adopcion, type CambioMarca, type MarcaGuardada, type RespuestaMarcas } from './marcas.js';
import { withTransaction } from './repo.js';
import { TzError, type Actor } from './types.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Cuántos apuntes de cambios devuelve GET /marcas (los más recientes). */
export const CAMBIOS_MAX = 20;

const BLOQUEO_CALIBRACIONES = `SELECT pg_advisory_xact_lock(hashtext('portal.tmc_calibraciones_pasadas'))`;
const BLOQUEO_MARCAS = `SELECT pg_advisory_xact_lock(hashtext('portal.tmc_marcas'))`;

async function guardadas(db: Db): Promise<MarcaGuardada[]> {
  const { rows } = await db.query(`SELECT clave, marca, incluida, motivo, por, en::text AS en FROM portal.tmc_marcas ORDER BY clave`);
  return (rows as Row[]).map((r) => ({ clave: r.clave, marca: r.marca, incluida: r.incluida === true, motivo: r.motivo, por: r.por, en: r.en }));
}

/** La tabla de la pestaña a `hoy`, con los equipos que diga `fuera` FUERA del inventario: la que daba antes de encender su marca. */
async function leer(db: Db, hoy: string, fuera: (q: EquipoHoja) => boolean = () => false) {
  const { entrada } = await leerEntradaHoja(db, hoy);
  const tabla = tablaHoja({ ...entrada, equipos: entrada.equipos.map((q) => (fuera(q) ? { ...q, incluido: false } : q)) });
  return { tabla, equipos: entrada.equipos, sinClave: new Set(entrada.calibraciones.filter((c) => c.clave === null).map((c) => c.id)) };
}

/** Escribe una adopción: las partidas (con origen fst022; si el equipo ya tiene la suya, nada) y la clave de las sueltas que no la tenían. */
async function escribirAdopcion(c: Db, a: Adopcion, actor: Actor): Promise<void> {
  if (a.partidas.length > 0) {
    const filas = a.partidas.map((p) => ({ ...p, serialNorm: serialNorm(p.serial), motivo: `F-ST-022 congelada (fila ${p.fila}), al incluir su marca en seguimiento.${p.estado === 'en_revision' ? ' La fecha es posterior a hoy o absurda.' : ''}` }));
    await c.query(
      `INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, estado, motivo, por_id, por)
       SELECT x.clave, x.serial, x."serialNorm", x.fecha, 'fst022', x.estado, x.motivo, $2::uuid, $3
         FROM jsonb_to_recordset($1::jsonb) AS x(clave text, serial text, "serialNorm" text, fecha date, estado text, motivo text)
       ON CONFLICT (clave) WHERE origen = 'fst022' DO NOTHING`,
      [JSON.stringify(filas), actor.userId, actor.email],
    );
  }
  if (a.enlazar.length > 0) {
    await c.query(
      `UPDATE portal.tmc_calibraciones c
          SET clave = x.clave
         FROM jsonb_to_recordset($1::jsonb) AS x(id bigint, clave text)
        WHERE c.id = x.id AND c.clave IS NULL`,
      [JSON.stringify(a.enlazar)],
    );
  }
}

/** GET /trazabilidad/marcas: cada marca con su vista previa a `hoy` y los últimos cambios. Sólo recuentos y firmas. */
export async function leerMarcas(db: Db, hoy: string): Promise<RespuestaMarcas> {
  const { tabla, equipos, sinClave } = await leer(db, hoy);
  const g = await guardadas(db);
  const { rows } = await db.query(`SELECT id, clave, marca, accion, motivo, equipos, partidas, enlazadas, por, en::text AS en FROM portal.tmc_marcas_cambios ORDER BY id DESC LIMIT ${CAMBIOS_MAX}`);
  const cambios = (rows as Row[]).map((r): CambioMarca => ({ id: Number(r.id), clave: r.clave, marca: r.marca, accion: r.accion, motivo: r.motivo, equipos: r.equipos, partidas: r.partidas, enlazadas: r.enlazadas, por: r.por, en: r.en }));
  return { hoy, marcas: marcasEnSeguimiento({ tabla, equipos, guardadas: g, sinClave }), cambios };
}

/**
 * Enciende (`incluir`) o apaga una marca, con motivo y firma, todo o nada. 409 `marca_fija` para GRIMM EDM 180; 404 si no hay ningún
 * equipo de esa marca fuera de seguimiento ni está guardada; 409 `ya_incluida` / `no_incluida` si ya estaba así (no escribe nada).
 * Devuelve las marcas ya actualizadas.
 */
export async function cambiarMarca(db: Pool, clave: string, cambio: { incluir: boolean; motivo: string }, actor: Actor, hoy: string): Promise<RespuestaMarcas> {
  if (clave === CLAVE_EDM180) throw new TzError('marca_fija', 409, 'GRIMM EDM 180 está siempre en seguimiento: no tiene interruptor.');
  await withTransaction(db, async (c) => {
    await c.query(BLOQUEO_CALIBRACIONES);
    await c.query(BLOQUEO_MARCAS);
    const g = (await guardadas(c)).find((x) => x.clave === clave);
    const { tabla, equipos, sinClave } = await leer(c, hoy);
    const suyos = equipos.filter((q) => q.enSeguimiento === false && claveMarca(q.marca) === clave);
    if (!g && suyos.length === 0) throw new TzError('not_found', 404, 'No hay ningún equipo de esa marca en el portal.');
    if ((g?.incluida ?? false) === cambio.incluir) throw new TzError(cambio.incluir ? 'ya_incluida' : 'no_incluida', 409, cambio.incluir ? 'Esa marca ya está en seguimiento: no se ha cambiado nada.' : 'Esa marca no está en seguimiento: no se ha cambiado nada.');
    const marca = marcasEnSeguimiento({ tabla, equipos, guardadas: g ? [g] : [], sinClave }).find((m) => m.clave === clave)!;
    const adopcion = cambio.incluir ? planAdopcion(tabla, new Set(suyos.map((q) => q.clave)), sinClave) : { partidas: [], enlazar: [] };
    await escribirAdopcion(c, adopcion, actor);
    const nombre = marca.marca.slice(0, 60);
    await c.query(
      `INSERT INTO portal.tmc_marcas (clave, marca, incluida, motivo, por_id, por, en)
       VALUES ($1, $2, $3, $4, $5::uuid, $6, NOW())
       ON CONFLICT (clave) DO UPDATE SET marca = EXCLUDED.marca, incluida = EXCLUDED.incluida, motivo = EXCLUDED.motivo, por_id = EXCLUDED.por_id, por = EXCLUDED.por, en = NOW()`,
      [clave, nombre, cambio.incluir, cambio.motivo, actor.userId, actor.email],
    );
    await c.query(
      `INSERT INTO portal.tmc_marcas_cambios (clave, marca, accion, motivo, equipos, partidas, enlazadas, por_id, por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9)`,
      [clave, nombre, cambio.incluir ? 'incluir' : 'excluir', cambio.motivo, marca.resumen.equipos, adopcion.partidas.length, adopcion.enlazar.length, actor.userId, actor.email],
    );
  });
  return leerMarcas(db, hoy);
}

/**
 * Tras una sincronización del maestro, dentro de su transacción: los equipos de las marcas incluidas que aún no tengan su partida o
 * tengan calibraciones sueltas reciben lo mismo que al encender la marca (lo que ya lo tenía no cambia). Con todas las marcas
 * apagadas no hace nada más que mirarlo. Devuelve cuántas filas escribió.
 */
export async function adoptarIncluidas(c: Db, actor: Actor, hoy: string = hoyEnColombia()): Promise<number> {
  const { rows } = await c.query(`SELECT clave FROM portal.tmc_marcas WHERE incluida`);
  if (rows.length === 0) return 0;
  const incluidas = new Set((rows as Row[]).map((r) => r.clave as string));
  await c.query(BLOQUEO_CALIBRACIONES);
  const suya = (q: EquipoHoja): boolean => q.enSeguimiento === false && incluidas.has(claveMarca(q.marca));
  const { tabla, equipos, sinClave } = await leer(c, hoy, suya);
  const adopcion = planAdopcion(tabla, new Set(equipos.filter(suya).map((q) => q.clave)), sinClave);
  await escribirAdopcion(c, adopcion, actor);
  return adopcion.partidas.length + adopcion.enlazar.length;
}
