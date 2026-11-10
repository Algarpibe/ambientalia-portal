/**
 * La copia de Drive que manda n8n (migración 072, revisión del 10/11/2026 del diseño):
 * `portal.equipos_drive_archivos` (un archivo o carpeta de Drive por fila) y
 * `portal.equipos_sincronizacion` (una fila por pasada de n8n). Solo SQL. Qué se acepta
 * lo decide sync.ts; escribe router-sync.ts (n8n) y leen fuente-n8n.ts y servicio.ts
 * (la corrida).
 *
 * Qué texto se pide (`faltaTexto`), solo en entradas y salidas escaneadas:
 *   · el que nunca llegó (alta, o archivo que vuelve de otra carpeta);
 *   · el de un archivo que cambió de nombre desde que llegó su texto (el viejo se
 *     conserva y se sigue usando hasta que llegue el nuevo);
 *   · el de un archivo con un fallo guardado, pasadas HORAS_REINTENTO_ERROR horas.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { ArchivoDrive } from './nucleo/tipos.js';
import { listadoSospechoso, type ArchivoListado, type Carpeta, type ConteosFin, type ResultadoTexto } from './sync.js';

type PoolClient = Awaited<ReturnType<Pool['connect']>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;

/** Un archivo con un fallo guardado se vuelve a pedir pasado este tiempo. */
export const HORAS_REINTENTO_ERROR = 6;
/** Una pasada sin «fin» más vieja que esto se da por abandonada (n8n murió a mitad); hasta entonces, no empieza otra. */
export const HORAS_PASADA_ABANDONADA = 2;

/** Una pasada completa (con «fin»). */
export interface SincronizacionHecha {
  pasada: string;
  inicio: string;
  fin: string;
}
export interface TextoGuardado {
  /** null = no llegó (`''` vale: carpeta de entrada sin documento). */
  texto: string | null;
  /** El último fallo de ese archivo, si lo hay. */
  errorStatus: number | null;
}
export type ResultadoListado =
  | { estado: 'ok'; faltaTexto: string[] }
  | { estado: 'pasada_cerrada' }
  | { estado: 'pasada_en_curso' }
  | { estado: 'sospechoso'; bajas: number; vivos: number };
export type CierrePasada = 'cerrada' | 'desconocida' | 'ya_cerrada' | 'incompleta' | 'tardia';

export interface RepoSync {
  /** El listado COMPLETO de una carpeta en una pasada: altas, nombres y borrados. Devuelve los ids a los que les falta texto. */
  registrarListado(pasada: string, carpeta: Carpeta, archivos: ArchivoListado[]): Promise<ResultadoListado>;
  /** El texto (o el fallo) de un archivo. false si no está, está borrado o su carpeta no lleva texto. */
  guardarTexto(id: string, r: ResultadoTexto): Promise<boolean>;
  /** Cierra la pasada como completa. Exige el listado de las tres carpetas; si lleva abierta más de HORAS_PASADA_ABANDONADA la cierra como fallida ('tardia'). */
  cerrarPasada(pasada: string, conteos: ConteosFin): Promise<CierrePasada>;
  /** La última pasada COMPLETA, o null si nunca hubo una. */
  ultimaSincronizacion(): Promise<SincronizacionHecha | null>;
  /**
   * Lo que la corrida ve de una carpeta: sin los borrados ni los pendientes de texto que
   * cambiaron después del «fin» de `pasada` (los trajo una pasada que no ha terminado).
   */
  listarCarpeta(carpeta: Carpeta, pasada: string): Promise<ArchivoDrive[]>;
  /** null si el archivo no está en esa carpeta (o está borrado). */
  leerTexto(carpeta: Carpeta, id: string): Promise<TextoGuardado | null>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

async function enTransaccion<T>(db: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export function crearRepoSync(db: Pool): RepoSync {
  return {
    async registrarListado(pasada, carpeta, archivos) {
      const ids = archivos.map((a) => a.id);
      return enTransaccion(db, async (c): Promise<ResultadoListado> => {
        // Un escritor de listados a la vez: dos pasadas no se cruzan a mitad de uno.
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('equipos-taller:sync'))`);
        // Una pasada sin «fin» de hace más de HORAS_PASADA_ABANDONADA: n8n murió a mitad.
        await c.query(
          `UPDATE portal.equipos_sincronizacion SET fin = now(), ok = false
            WHERE fin IS NULL AND pasada <> $1 AND inicio < now() - make_interval(hours => $2)`,
          [pasada, HORAS_PASADA_ABANDONADA],
        );
        const p = (await c.query(
          `SELECT bool_or(pasada = $1 AND fin IS NOT NULL) AS cerrada, bool_or(pasada <> $1 AND fin IS NULL) AS otra
             FROM portal.equipos_sincronizacion WHERE pasada = $1 OR fin IS NULL`,
          [pasada],
        )).rows[0];
        if (p?.cerrada) return { estado: 'pasada_cerrada' };
        if (p?.otra) return { estado: 'pasada_en_curso' };
        const n = (await c.query(
          `SELECT count(*)::int AS vivos, count(*) FILTER (WHERE NOT (id = ANY($2::text[])))::int AS bajas
             FROM portal.equipos_drive_archivos WHERE carpeta = $1 AND NOT borrado`,
          [carpeta, ids],
        )).rows[0];
        if (listadoSospechoso(n.bajas, n.vivos, archivos.length)) return { estado: 'sospechoso', bajas: n.bajas, vivos: n.vivos };
        // Los que saldrían de OTRA carpeta hacia esta cuentan como bajas de la suya (un listado
        // mandado a la carpeta equivocada no puede vaciarla ni borrarle el texto).
        const fuera = (await c.query(
          `SELECT o.carpeta, o.vivos::int AS vivos, count(*)::int AS movidos
             FROM portal.equipos_drive_archivos a
             JOIN (SELECT carpeta, count(*) AS vivos FROM portal.equipos_drive_archivos WHERE NOT borrado GROUP BY carpeta) o ON o.carpeta = a.carpeta
            WHERE a.id = ANY($2::text[]) AND a.carpeta <> $1 AND NOT a.borrado
            GROUP BY o.carpeta, o.vivos`,
          [carpeta, ids],
        )).rows;
        for (const o of fuera) {
          if (listadoSospechoso(o.movidos, o.vivos, o.vivos - o.movidos)) return { estado: 'sospechoso', bajas: o.movidos, vivos: o.vivos };
        }
        await c.query(
          `INSERT INTO portal.equipos_sincronizacion (pasada, listados) VALUES ($1, jsonb_build_object($2::text, $3::int))
           ON CONFLICT (pasada) DO UPDATE SET listados = portal.equipos_sincronizacion.listados || EXCLUDED.listados`,
          [pasada, carpeta, archivos.length],
        );
        // Altas, cambios de nombre, reapariciones y archivos que vienen de otra carpeta. Si
        // vienen de otra, su texto era de otra clase y se descarta. En el SET, `a.` es la fila
        // de antes. Las filas sin cambios no se reescriben.
        await c.query(
          `INSERT INTO portal.equipos_drive_archivos AS a (id, carpeta, titulo)
           SELECT l.id, $1::text, l.titulo FROM unnest($2::text[], $3::text[]) AS l(id, titulo)
           ON CONFLICT (id) DO UPDATE SET
             texto        = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.texto END,
             titulo_texto = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.titulo_texto END,
             error_status = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.error_status END,
             texto_en     = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.texto_en END,
             carpeta = EXCLUDED.carpeta, titulo = EXCLUDED.titulo, borrado = false, actualizado_en = now()
           WHERE a.titulo IS DISTINCT FROM EXCLUDED.titulo OR a.borrado OR a.carpeta <> EXCLUDED.carpeta`,
          [carpeta, ids, archivos.map((a) => a.titulo)],
        );
        await c.query(
          `UPDATE portal.equipos_drive_archivos SET borrado = true, actualizado_en = now()
            WHERE carpeta = $1 AND NOT borrado AND NOT (id = ANY($2::text[]))`,
          [carpeta, ids],
        );
        const { rows } = await c.query(
          `SELECT id FROM portal.equipos_drive_archivos
            WHERE carpeta = $1 AND carpeta <> 'salidas_n8n' AND NOT borrado
              AND CASE WHEN error_status IS NOT NULL
                       THEN texto_en IS NULL OR texto_en < now() - make_interval(hours => $2)
                       ELSE texto IS NULL OR titulo_texto IS DISTINCT FROM titulo END
            ORDER BY id`,
          [carpeta, HORAS_REINTENTO_ERROR],
        );
        return { estado: 'ok', faltaTexto: rows.map((x: Fila) => String(x.id)) };
      });
    },

    async guardarTexto(id, r) {
      const res = 'texto' in r
        ? await db.query(
          `UPDATE portal.equipos_drive_archivos SET texto = $2, titulo_texto = titulo, error_status = NULL, texto_en = now()
            WHERE id = $1 AND NOT borrado AND carpeta <> 'salidas_n8n'`,
          [id, r.texto],
        )
        // Un fallo no borra el texto que hubiera: sigue valiendo hasta que llegue uno nuevo.
        : await db.query(
          `UPDATE portal.equipos_drive_archivos SET error_status = $2, texto_en = now()
            WHERE id = $1 AND NOT borrado AND carpeta <> 'salidas_n8n'`,
          [id, r.status],
        );
      return res.rowCount === 1;
    },

    async cerrarPasada(pasada, conteos) {
      // Una sola sentencia: si lleva abierta más de HORAS_PASADA_ABANDONADA se cierra como
      // fallida (la frescura se mide desde «fin», y una pasada tan larga no es fresca).
      const { rows } = await db.query(
        `UPDATE portal.equipos_sincronizacion
            SET fin = now(),
                ok = inicio >= now() - make_interval(hours => $3),
                conteos = CASE WHEN inicio >= now() - make_interval(hours => $3) THEN $2::jsonb ELSE conteos END
          WHERE pasada = $1 AND fin IS NULL AND listados ?& ARRAY['entradas', 'salidas_n8n', 'salidas_escaneadas']
          RETURNING ok`,
        [pasada, JSON.stringify(conteos), HORAS_PASADA_ABANDONADA],
      );
      if (rows.length) return rows[0].ok ? 'cerrada' : 'tardia';
      const p = await db.query('SELECT fin FROM portal.equipos_sincronizacion WHERE pasada = $1', [pasada]);
      if (!p.rows.length) return 'desconocida';
      return p.rows[0].fin ? 'ya_cerrada' : 'incompleta';
    },

    async ultimaSincronizacion() {
      const { rows } = await db.query('SELECT pasada, inicio, fin FROM portal.equipos_sincronizacion WHERE ok ORDER BY fin DESC LIMIT 1');
      return rows[0] ? { pasada: String(rows[0].pasada), inicio: iso(rows[0].inicio), fin: iso(rows[0].fin) } : null;
    },

    async listarCarpeta(carpeta, pasada) {
      // Sin la pasada (no debería pasar), 'infinity': no se esconde nada.
      const { rows } = await db.query(
        `SELECT id, titulo FROM portal.equipos_drive_archivos
          WHERE carpeta = $1 AND NOT borrado
            AND NOT (carpeta <> 'salidas_n8n' AND texto IS NULL AND error_status IS NULL
                     AND actualizado_en > COALESCE((SELECT fin FROM portal.equipos_sincronizacion WHERE pasada = $2), 'infinity'::timestamptz))
          ORDER BY titulo, id`,
        [carpeta, pasada],
      );
      return rows.map((x: Fila) => ({ id: String(x.id), title: String(x.titulo) }));
    },

    async leerTexto(carpeta, id) {
      const { rows } = await db.query(
        'SELECT texto, error_status FROM portal.equipos_drive_archivos WHERE id = $1 AND carpeta = $2 AND NOT borrado',
        [id, carpeta],
      );
      return rows[0] ? { texto: rows[0].texto ?? null, errorStatus: rows[0].error_status ?? null } : null;
    },
  };
}
