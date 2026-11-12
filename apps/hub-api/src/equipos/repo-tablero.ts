/**
 * Lectura y escritura de `portal.equipos_tablero_config` y `portal.equipos_kiosco` (migraciones 074 y 075).
 * Solo SQL: qué se acepta lo deciden servicio-tablero.ts (validación) y router.ts (permisos).
 * De la llave solo se guarda el SHA-256 del secreto; el texto plano nunca llega aquí.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { Kiosco } from './contrato.js';
import { AJUSTES_TABLERO_POR_DEFECTO, type AjustesTablero, type KpiId, type ModoTemaTv } from './nucleo/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;

/** Lo que el guardia necesita de una llave activa: el resumen se vuelve a comparar en tiempo constante. */
export interface KioscoActivo {
  id: string;
  nombre: string;
  hash: string;
  ultimoUsoEn: string | null;
}

export interface RepoTablero {
  /** Sin fila guardada, los de por defecto. */
  leerAjustesTablero(): Promise<AjustesTablero>;
  guardarAjustesTablero(a: AjustesTablero, por: string): Promise<void>;
  /** null si ya hay otra llave ACTIVA con ese nombre. */
  crearKiosco(nombre: string, hash: string, creadoPor: string): Promise<Kiosco | null>;
  /** Solo metadatos, las más nuevas primero. */
  listarKioscos(): Promise<Kiosco[]>;
  /** Solo las NO revocadas: una revocada no se encuentra. */
  kioscoPorHash(hash: string): Promise<KioscoActivo | null>;
  /** false si no existe o ya estaba revocada. */
  revocarKiosco(id: string, por: string): Promise<boolean>;
  marcarUso(id: string): Promise<void>;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const COLS_KIOSCO = 'id::text AS id, nombre, creado_por, creado_en, revocado_en, ultimo_uso_en';
const aKiosco = (x: Fila): Kiosco => ({
  id: x.id,
  nombre: x.nombre,
  creadoPor: x.creado_por,
  creadoEn: iso(x.creado_en) ?? '',
  revocadoEn: iso(x.revocado_en),
  ultimoUsoEn: iso(x.ultimo_uso_en),
});
/** 23505: unique_violation. */
const esDuplicado = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '23505';

export function crearRepoTablero(db: Pool): RepoTablero {
  return {
    async leerAjustesTablero() {
      const { rows } = await db.query('SELECT umbral_ambar, umbral_rojo, noche_desde, noche_hasta, kpis, tema_tv FROM portal.equipos_tablero_config');
      const x = rows[0] as Fila | undefined;
      if (!x) return { ...AJUSTES_TABLERO_POR_DEFECTO, kpis: [...AJUSTES_TABLERO_POR_DEFECTO.kpis] };
      return {
        umbralAmbar: x.umbral_ambar, umbralRojo: x.umbral_rojo, nocheDesde: x.noche_desde, nocheHasta: x.noche_hasta,
        kpis: x.kpis as KpiId[], temaTv: x.tema_tv as ModoTemaTv,
      };
    },

    async guardarAjustesTablero(a, por) {
      await db.query(
        `INSERT INTO portal.equipos_tablero_config (id, umbral_ambar, umbral_rojo, noche_desde, noche_hasta, kpis, tema_tv, actualizado_por, actualizado_en)
         VALUES (true, $1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (id) DO UPDATE SET umbral_ambar = EXCLUDED.umbral_ambar, umbral_rojo = EXCLUDED.umbral_rojo,
           noche_desde = EXCLUDED.noche_desde, noche_hasta = EXCLUDED.noche_hasta, kpis = EXCLUDED.kpis, tema_tv = EXCLUDED.tema_tv,
           actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
        [a.umbralAmbar, a.umbralRojo, a.nocheDesde, a.nocheHasta, a.kpis, a.temaTv, por],
      );
    },

    async crearKiosco(nombre, hash, creadoPor) {
      try {
        const { rows } = await db.query(
          `INSERT INTO portal.equipos_kiosco (nombre, hash, creado_por) VALUES ($1, $2, $3) RETURNING ${COLS_KIOSCO}`,
          [nombre, hash, creadoPor],
        );
        return aKiosco(rows[0]);
      } catch (e) {
        if (esDuplicado(e)) return null;
        throw e;
      }
    },

    async listarKioscos() {
      const { rows } = await db.query(`SELECT ${COLS_KIOSCO} FROM portal.equipos_kiosco ORDER BY creado_en DESC, id`);
      return rows.map(aKiosco);
    },

    async kioscoPorHash(hash) {
      const { rows } = await db.query('SELECT id::text AS id, nombre, hash, ultimo_uso_en FROM portal.equipos_kiosco WHERE hash = $1 AND revocado_en IS NULL', [hash]);
      const x = rows[0] as Fila | undefined;
      return x ? { id: x.id, nombre: x.nombre, hash: x.hash, ultimoUsoEn: iso(x.ultimo_uso_en) } : null;
    },

    async revocarKiosco(id, por) {
      const r = await db.query('UPDATE portal.equipos_kiosco SET revocado_en = now(), revocado_por = $2 WHERE id = $1 AND revocado_en IS NULL', [id, por]);
      return (r.rowCount ?? 0) > 0;
    },

    async marcarUso(id) {
      await db.query('UPDATE portal.equipos_kiosco SET ultimo_uso_en = now() WHERE id = $1', [id]);
    },
  };
}
