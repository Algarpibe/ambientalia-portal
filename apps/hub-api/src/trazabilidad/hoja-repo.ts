/**
 * SQL de la pestaña «Trazabilidad F-ST-022» (lote 9d-1): reúne lo que necesita
 * la regla de hoja.ts. SÓLO LEE, y sólo de la base del PORTAL —la congelación
 * vigente, el inventario entero y las calibraciones guardadas—: no consulta
 * los tickets ni el maestro, así que responde igual con Desk 2.0 caído.
 *
 * Son cuatro consultas, haya las filas que haya (hoja.db.test.ts lo mide).
 * Las filas llevan clientes y seriales: nada de ellas va a un error ni al registro.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { Celda, FilaCongelada } from './fst022.js';
import { tablaHoja, type EquipoHoja, type RespuestaHoja } from './hoja.js';
import { leerCalibraciones } from './repo.js';

type Db = Pick<Awaited<ReturnType<Pool['connect']>>, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const MOTIVO_SIN_CONGELACION = 'En este entorno no hay ninguna F-ST-022 congelada: no hay hoja que enseñar. El inventario de GRIMM EDM 180 sigue en «Equipos».';

/** La tabla de la hoja a `hoy` (día en Colombia), con su resumen. Sin congelación vigente, vacía y con su motivo. */
export async function leerHoja(db: Db, hoy: string): Promise<RespuestaHoja> {
  const [vigentes, congeladas, inventario, calibraciones] = await Promise.all([
    db.query(`SELECT g.id, g.archivo, g.hoja, g.por, g.en::text AS en, g.cabeceras FROM portal.tmc_fst022_congelaciones g WHERE g.vigente`),
    // Con el último apunte de cada fila en tmc_retiros (059): si es un retiro, la fila está retirada a mano. Va en la misma consulta.
    db.query(
      `SELECT f.fila, f.celdas, f.serial_norm, f.clave_equipo, x.accion AS retiro, x.por AS retiro_por, x.en::text AS retiro_en, x.motivo AS retiro_motivo
         FROM portal.tmc_fst022_congelada f JOIN portal.tmc_fst022_congelaciones g ON g.id = f.congelacion_id
         LEFT JOIN LATERAL (SELECT * FROM portal.tmc_retiros x WHERE x.congelacion_id = f.congelacion_id AND x.fila = f.fila ORDER BY x.id DESC LIMIT 1) x ON TRUE
        WHERE g.vigente AND f.es_equipo
        ORDER BY f.fila`,
    ),
    // Entero, también lo que está fuera de seguimiento (otras marcas, 058): esta pestaña es la que lo enseña. Y con su marca de retirado a mano.
    db.query(`SELECT clave, serial, cliente, marca, modelo, activo, en_seguimiento, ultima_calibracion::text AS ultima_calibracion, retirado_en::text AS retirado_en, retirado_por, retirado_motivo FROM portal.tmc_equipos`),
    leerCalibraciones(db),
  ]);
  const v = vigentes.rows[0] as Row | undefined;
  const filas = (congeladas.rows as Row[]).map((r): FilaCongelada => ({ fila: r.fila, celdas: r.celdas, esEquipo: true, serialNorm: r.serial_norm, claveEquipo: r.clave_equipo }));
  const equipos = (inventario.rows as Row[]).map((r): EquipoHoja => ({ clave: r.clave, serial: r.serial, cliente: r.cliente, marca: r.marca, modelo: r.modelo, activo: r.activo, ultimaCalibracion: r.ultima_calibracion, enSeguimiento: r.en_seguimiento !== false, retirado: r.retirado_en ? { por: r.retirado_por ?? '', en: r.retirado_en, motivo: r.retirado_motivo ?? '' } : null }));
  const retiradas = (congeladas.rows as Row[]).filter((r) => r.retiro === 'retirar').map((r) => ({ fila: r.fila as number, por: r.retiro_por, en: r.retiro_en, motivo: r.retiro_motivo }));
  return {
    hoy,
    congelacion: v ? { id: Number(v.id), archivo: v.archivo, hoja: v.hoja, por: v.por, en: v.en } : null,
    motivo: v ? null : MOTIVO_SIN_CONGELACION,
    ...tablaHoja({ hoy, cabeceras: (v?.cabeceras as Celda[][] | undefined) ?? [], filas, equipos, calibraciones, retiradas }),
  };
}
