/**
 * Lectura y escritura de las tablas `portal.equipos_*` (migración 071). Solo SQL:
 * qué se escribe lo deciden servicio.ts (corridas), incidente.ts (incidentes) y
 * router.ts (ajustes y llaves).
 *
 * `equipos_estado` guarda tres claves: `foto` (lo que muestra la pantalla),
 * `exits` (caché del texto de OCR, versión CV del núcleo) y `ent` (remisiones de
 * entrada ya leídas). Ya no hay caché de comentarios: se leen en cada corrida.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { CacheEscaneos, Foto, RemisionEntrada } from './nucleo/tipos.js';
import type { AjusteFirmado, Corrida, Incidente, LlavesUsuario, OrigenCorrida, UsuarioConLlaves } from './contrato.js';
import type { DecisionIncidente } from './incidente.js';
import type { ResultadoAlerta } from './alerta.js';

type PoolClient = Awaited<ReturnType<Pool['connect']>>;
type Db = Pick<PoolClient, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;

/**
 * Una corrida que lleva más de esto «en curso» se da por abandonada (el proceso cayó a mitad).
 * Consecuencias: tras una caída o un redeploy a mitad de corrida, las corridas nuevas (la de
 * cada hora y la diaria) se omiten («ocupado») hasta que pasan estos minutos; y las corridas abandonadas
 * (ok = false, causa 'abandonada') no cuentan para los incidentes.
 */
export const MINUTOS_ABANDONO = 180;

/** Se lanza al cerrar una corrida que ya no está en curso (abandonada y quizá sustituida por otra). */
const CORRIDA_CERRADA = 'corrida ya cerrada o abandonada';

/** La corrida ya no estaba en curso (abandonada o cerrada) al intentar cerrarla: su resultado se descarta. */
export class CorridaCerrada extends Error {
  constructor() {
    super(CORRIDA_CERRADA);
    this.name = 'CorridaCerrada';
  }
}

export interface CorridaBuena {
  foto: Foto;
  exits: CacheEscaneos;
  ent: Record<string, RemisionEntrada>;
  avisos: string[];
  conteos: Record<string, number>;
}

export interface RepoEquipos {
  /** El candado: inserta la corrida «en curso». null si ya hay otra. */
  iniciarCorrida(origen: OrigenCorrida, userId: string | null): Promise<number | null>;
  leerCaches(): Promise<{ exits: CacheEscaneos | null; ent: Record<string, RemisionEntrada> }>;
  /** La foto, los cachés y el cierre de la corrida, en UNA transacción. */
  terminarBien(id: number, r: CorridaBuena): Promise<void>;
  /** Cierra la corrida como fallida. No toca `foto`; `exits`, si llega, sí. servicio.ts ya no la pasa (D10: sería parcial). */
  terminarMal(id: number, causa: string, exits: CacheEscaneos | null): Promise<void>;
  leerFoto(): Promise<Foto | null>;
  leerAjustes(): Promise<Record<string, AjusteFirmado>>;
  guardarAjuste(clave: string, a: { t: AjusteFirmado['t']; m: string }, firma: { userId: string | null; usuario: string }): Promise<AjusteFirmado>;
  borrarAjuste(clave: string): Promise<void>;
  ultimaCorrida(): Promise<Corrida | null>;
  ultimaCorridaBuena(): Promise<Corrida | null>;
  /** La última corrida YA CERRADA (ok o fallida); ignora la que está en curso. */
  ultimaCorridaTerminada(): Promise<Corrida | null>;
  incidenteAbierto(): Promise<Incidente | null>;
  /** Aplica la decisión. Devuelve el id del incidente que queda abierto, o null. */
  aplicarIncidente(d: DecisionIncidente, abiertoId: number | null): Promise<number | null>;
  marcarAlerta(incidenteId: number, r: ResultadoAlerta): Promise<void>;
  /** Correos de los usuarios activos con `recibe_alertas`. */
  correosAlerta(): Promise<string[]>;
  llavesDe(userId: string | null): Promise<LlavesUsuario>;
  /** Los usuarios activos que tienen la app (o son admin), con sus llaves. */
  listarLlaves(): Promise<UsuarioConLlaves[]>;
  /** null si el usuario no existe. */
  guardarLlaves(userId: string, l: LlavesUsuario, actualizadoPor: string): Promise<UsuarioConLlaves | null>;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const json = <T>(v: unknown): T | null => (v == null ? null : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

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

const guardarEstado = (c: Db, clave: 'foto' | 'exits' | 'ent', valor: unknown) =>
  c.query(
    `INSERT INTO portal.equipos_estado (clave, valor, actualizado_en) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [clave, JSON.stringify(valor)],
  );

const COLS_CORRIDA = 'id, origen, inicio, fin, en_curso, ok, causa, avisos, conteos';
const aCorrida = (x: Fila): Corrida => ({
  id: Number(x.id),
  origen: x.origen,
  inicio: iso(x.inicio) ?? '',
  fin: iso(x.fin),
  enCurso: x.en_curso === true,
  ok: x.ok ?? null,
  causa: x.causa ?? null,
  avisos: json<string[]>(x.avisos) ?? [],
  conteos: json<Record<string, number>>(x.conteos),
});

const COLS_INCIDENTE = 'id, abierto_en, fallos_programados, alerta_enviada_en, alerta_ultimo_error';
const aIncidente = (x: Fila): Incidente => ({
  id: Number(x.id),
  abiertoEn: iso(x.abierto_en) ?? '',
  fallosProgramados: Number(x.fallos_programados),
  alertaEnviadaEn: iso(x.alerta_enviada_en),
  alertaUltimoError: x.alerta_ultimo_error ?? null,
});

const SQL_AJUSTE = `clave, tipo, nota, usuario, creado_en, (creado_en AT TIME ZONE 'America/Bogota')::date::text AS dia`;
const aAjuste = (x: Fila): AjusteFirmado => ({ t: x.tipo, m: x.nota ?? '', at: String(x.dia), usuario: x.usuario ?? '', creadoEn: iso(x.creado_en) ?? '' });

const SQL_USUARIO_LLAVES = `u.id::text AS user_id, u.full_name, u.email, u.role,
       COALESCE(l.edita_ajustes, false) AS edita_ajustes, COALESCE(l.recibe_alertas, false) AS recibe_alertas,
       l.actualizado_por, l.actualizado_en
  FROM portal.users u
  LEFT JOIN portal.equipos_llaves l ON l.user_id = u.id`;
const aUsuario = (x: Fila): UsuarioConLlaves => ({
  userId: String(x.user_id),
  nombre: x.full_name ?? '',
  email: x.email ?? '',
  esAdmin: x.role === 'admin',
  editaAjustes: x.edita_ajustes === true,
  recibeAlertas: x.recibe_alertas === true,
  actualizadoPor: x.actualizado_por ?? null,
  actualizadoEn: iso(x.actualizado_en),
});

export function crearRepoEquipos(db: Pool): RepoEquipos {
  return {
    async iniciarCorrida(origen, userId) {
      await db.query(
        `UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = false, causa = 'abandonada'
          WHERE en_curso AND inicio < now() - make_interval(mins => $1)`,
        [MINUTOS_ABANDONO],
      );
      try {
        const r = await db.query('INSERT INTO portal.equipos_ejecucion (origen, user_id) VALUES ($1, $2) RETURNING id', [origen, userId]);
        return Number(r.rows[0].id);
      } catch (e) {
        if ((e as { code?: unknown }).code === '23505') return null; // equipos_ejecucion_una_a_la_vez
        throw e;
      }
    },

    async leerCaches() {
      const { rows } = await db.query(`SELECT clave, valor FROM portal.equipos_estado WHERE clave IN ('exits', 'ent')`);
      const v = (k: string) => rows.find((x: Fila) => x.clave === k)?.valor;
      return { exits: json<CacheEscaneos>(v('exits')), ent: json<Record<string, RemisionEntrada>>(v('ent')) ?? {} };
    },

    async terminarBien(id, r) {
      await enTransaccion(db, async (c) => {
        await guardarEstado(c, 'exits', r.exits);
        await guardarEstado(c, 'ent', r.ent);
        await guardarEstado(c, 'foto', r.foto);
        const cierre = await c.query(
          `UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = true, causa = NULL, avisos = $2::jsonb, conteos = $3::jsonb
            WHERE id = $1 AND en_curso`,
          [id, JSON.stringify(r.avisos), JSON.stringify(r.conteos)],
        );
        if (cierre.rowCount !== 1) throw new CorridaCerrada(); // el ROLLBACK descarta también foto y cachés
      });
    },

    async terminarMal(id, causa, exits) {
      await enTransaccion(db, async (c) => {
        if (exits) await guardarEstado(c, 'exits', exits);
        const cierre = await c.query(`UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = false, causa = $2 WHERE id = $1 AND en_curso`, [id, causa.slice(0, 300)]);
        if (cierre.rowCount !== 1) throw new CorridaCerrada();
      });
    },

    async leerFoto() {
      const { rows } = await db.query(`SELECT valor FROM portal.equipos_estado WHERE clave = 'foto'`);
      return rows[0] ? json<Foto>(rows[0].valor) : null;
    },

    async leerAjustes() {
      const { rows } = await db.query(`SELECT ${SQL_AJUSTE} FROM portal.equipos_ajuste ORDER BY clave`);
      return Object.fromEntries(rows.map((x: Fila) => [x.clave, aAjuste(x)]));
    },

    async guardarAjuste(clave, a, firma) {
      const { rows } = await db.query(
        `INSERT INTO portal.equipos_ajuste (clave, tipo, nota, user_id, usuario, creado_en) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (clave) DO UPDATE SET tipo = EXCLUDED.tipo, nota = EXCLUDED.nota, user_id = EXCLUDED.user_id,
                                           usuario = EXCLUDED.usuario, creado_en = now()
         RETURNING ${SQL_AJUSTE}`,
        [clave, a.t, a.m.slice(0, 300), firma.userId, firma.usuario],
      );
      return aAjuste(rows[0]);
    },

    async borrarAjuste(clave) {
      await db.query('DELETE FROM portal.equipos_ajuste WHERE clave = $1', [clave]);
    },

    async ultimaCorrida() {
      const { rows } = await db.query(`SELECT ${COLS_CORRIDA} FROM portal.equipos_ejecucion ORDER BY id DESC LIMIT 1`);
      return rows[0] ? aCorrida(rows[0]) : null;
    },

    async ultimaCorridaBuena() {
      const { rows } = await db.query(`SELECT ${COLS_CORRIDA} FROM portal.equipos_ejecucion WHERE ok ORDER BY id DESC LIMIT 1`);
      return rows[0] ? aCorrida(rows[0]) : null;
    },

    async ultimaCorridaTerminada() {
      const { rows } = await db.query(`SELECT ${COLS_CORRIDA} FROM portal.equipos_ejecucion WHERE en_curso IS NULL ORDER BY id DESC LIMIT 1`);
      return rows[0] ? aCorrida(rows[0]) : null;
    },

    async incidenteAbierto() {
      const { rows } = await db.query(`SELECT ${COLS_INCIDENTE} FROM portal.equipos_incidente WHERE cerrado_en IS NULL`);
      return rows[0] ? aIncidente(rows[0]) : null;
    },

    async aplicarIncidente(d, abiertoId) {
      if (d.accion === 'abrir') {
        const { rows } = await db.query('INSERT INTO portal.equipos_incidente (fallos_programados) VALUES ($1) RETURNING id', [d.fallosProgramados]);
        return Number(rows[0].id);
      }
      if (abiertoId === null) return null;
      if (d.accion === 'cerrar') {
        await db.query('UPDATE portal.equipos_incidente SET cerrado_en = now() WHERE id = $1 AND cerrado_en IS NULL', [abiertoId]);
        return null;
      }
      if (d.accion === 'contar') await db.query('UPDATE portal.equipos_incidente SET fallos_programados = $2 WHERE id = $1', [abiertoId, d.fallosProgramados]);
      return abiertoId;
    },

    async marcarAlerta(incidenteId, r) {
      if (r.ok) await db.query('UPDATE portal.equipos_incidente SET alerta_enviada_en = now(), alerta_ultimo_error = NULL WHERE id = $1', [incidenteId]);
      else await db.query('UPDATE portal.equipos_incidente SET alerta_ultimo_error = $2 WHERE id = $1', [incidenteId, r.error.slice(0, 300)]);
    },

    async correosAlerta() {
      const { rows } = await db.query(
        `SELECT u.email FROM portal.equipos_llaves l JOIN portal.users u ON u.id = l.user_id
          WHERE l.recibe_alertas AND u.status = 'active'
            AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM portal.user_apps a WHERE a.user_id = u.id AND a.app_id = 'equipos-taller'))
          ORDER BY lower(u.email)`,
      );
      return rows.map((x: Fila) => String(x.email));
    },

    async llavesDe(userId) {
      if (!userId) return { editaAjustes: false, recibeAlertas: false };
      const { rows } = await db.query('SELECT edita_ajustes, recibe_alertas FROM portal.equipos_llaves WHERE user_id = $1::uuid', [userId]);
      return { editaAjustes: rows[0]?.edita_ajustes === true, recibeAlertas: rows[0]?.recibe_alertas === true };
    },

    async listarLlaves() {
      const { rows } = await db.query(
        `SELECT ${SQL_USUARIO_LLAVES}
          WHERE u.status = 'active'
            AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM portal.user_apps a WHERE a.user_id = u.id AND a.app_id = 'equipos-taller'))
          ORDER BY lower(u.full_name), lower(u.email)`,
      );
      return rows.map(aUsuario);
    },

    async guardarLlaves(userId, l, actualizadoPor) {
      // Solo a quien hoy puede entrar a la app: activo y (admin o con la app asignada).
      const existe = await db.query(
        `SELECT 1 FROM portal.users u WHERE u.id = $1::uuid AND u.status = 'active'
            AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM portal.user_apps a WHERE a.user_id = u.id AND a.app_id = 'equipos-taller'))`,
        [userId],
      );
      if (!existe.rows.length) return null;
      await db.query(
        `INSERT INTO portal.equipos_llaves (user_id, edita_ajustes, recibe_alertas, actualizado_por, actualizado_en)
         VALUES ($1::uuid, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE SET edita_ajustes = EXCLUDED.edita_ajustes, recibe_alertas = EXCLUDED.recibe_alertas,
                                             actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
        [userId, l.editaAjustes, l.recibeAlertas, actualizadoPor],
      );
      const { rows } = await db.query(`SELECT ${SQL_USUARIO_LLAVES} WHERE u.id = $1::uuid`, [userId]);
      return aUsuario(rows[0]);
    },
  };
}
