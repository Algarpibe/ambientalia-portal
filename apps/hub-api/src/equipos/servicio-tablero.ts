/**
 * Ajustes del tablero y llaves de kiosco de la TV (§4a del diseño).
 *
 * La llave: `tvk_` + 32 bytes aleatorios en base64url (256 bits). Solo se guarda su SHA-256 hex;
 * el secreto sale UNA vez, en la respuesta que lo crea, y no se registra en ningún log. Se valida
 * contra la base en CADA petición (una revocada falla en la siguiente), buscando por el resumen y
 * comparándolo otra vez en tiempo constante (el mismo patrón que SEC-236).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { armarRespuestaTablero, avisoFoto, type Kiosco, type RespuestaTablero } from './contrato.js';
import { KPI_IDS, KPIS_REQUERIDOS, validarAjustesTablero, type AjustesTablero } from './nucleo/index.js';
import type { RepoEquipos } from './repo.js';
import type { RepoTablero } from './repo-tablero.js';

/** Formato exacto de una llave: se rechaza lo que no lo cumpla ANTES de tocar la base (T8). */
export const formatoToken = /^tvk_[A-Za-z0-9_-]{43}$/;
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const MAX_NOMBRE = 60;
const CINCO_MIN = 5 * 60_000;
const fmt = (d: string) => (d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }) : '');

export type ResultadoAjustes = { ok: true; ajustes: AjustesTablero } | { ok: false; motivo: string };
export type ResultadoToken = { ok: true; kiosco: Kiosco; secreto: string } | { ok: false; motivo: 'nombre' | 'repetido' };

export interface ServicioTablero {
  /** Los efectivos (o los de por defecto). */
  ajustes(): Promise<AjustesTablero>;
  /** Acepta un cambio parcial: se valida el resultado combinado; si no vale, nada cambia. */
  guardarAjustes(parcial: unknown, por: string): Promise<ResultadoAjustes>;
  crearToken(nombre: string, por: string): Promise<ResultadoToken>;
  listarTokens(): Promise<Kiosco[]>;
  revocarToken(id: string, por: string): Promise<boolean>;
  /** null si la llave no existe, está revocada o el resumen no coincide. */
  validarKiosco(token: string): Promise<{ id: string; nombre: string } | null>;
  tableroKiosco(ahoraMs: number): Promise<RespuestaTablero>;
}

export interface DepsTablero {
  repo: Pick<RepoEquipos, 'leerFoto' | 'leerAjustes' | 'ultimaCorridaTerminada' | 'ultimaCorridaBuena' | 'incidenteAbierto'>;
  tablero: RepoTablero;
  configurado: () => Promise<boolean>;
  ahora?: () => number;
}

/** Por qué no valen unos ajustes (validarAjustesTablero solo dice que no). */
function motivoInvalido(x: unknown): string {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'Los ajustes deben ser un objeto';
  const o = x as Record<string, unknown>;
  const entero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  if (!entero(o.umbralAmbar) || o.umbralAmbar < 1) return 'El umbral ámbar debe ser un entero positivo';
  if (!entero(o.umbralRojo) || o.umbralRojo <= o.umbralAmbar) return 'El umbral rojo debe ser un entero mayor que el ámbar';
  const hora = (v: unknown) => entero(v) && v >= 0 && v <= 23;
  if (!hora(o.nocheDesde) || !hora(o.nocheHasta)) return 'Las horas deben ser enteros de 0 a 23';
  if (!Array.isArray(o.kpis) || o.kpis.length !== KPIS_REQUERIDOS) return `Hay que elegir exactamente ${KPIS_REQUERIDOS} KPIs`;
  if (!o.kpis.every((k) => (KPI_IDS as readonly unknown[]).includes(k))) return 'Hay un KPI desconocido';
  return `Los ${KPIS_REQUERIDOS} KPIs deben ser distintos`;
}

export function crearServicioTablero(deps: DepsTablero): ServicioTablero {
  const ahora = deps.ahora ?? Date.now;
  const { repo, tablero } = deps;
  return {
    ajustes: () => tablero.leerAjustesTablero(),

    async guardarAjustes(parcial, por) {
      if (!parcial || typeof parcial !== 'object' || Array.isArray(parcial)) return { ok: false, motivo: motivoInvalido(parcial) };
      const combinado = { ...(await tablero.leerAjustesTablero()), ...(parcial as object) };
      const valido = validarAjustesTablero(combinado);
      if (!valido) return { ok: false, motivo: motivoInvalido(combinado) };
      await tablero.guardarAjustesTablero(valido, por);
      return { ok: true, ajustes: valido };
    },

    async crearToken(nombre, por) {
      const limpio = typeof nombre === 'string' ? nombre.trim() : '';
      if (limpio.length < 1 || limpio.length > MAX_NOMBRE) return { ok: false, motivo: 'nombre' };
      const secreto = 'tvk_' + randomBytes(32).toString('base64url');
      const kiosco = await tablero.crearKiosco(limpio, hashToken(secreto), por);
      return kiosco ? { ok: true, kiosco, secreto } : { ok: false, motivo: 'repetido' };
    },

    listarTokens: () => tablero.listarKioscos(),
    revocarToken: (id, por) => tablero.revocarKiosco(id, por),

    async validarKiosco(token) {
      const hash = hashToken(token);
      const k = await tablero.kioscoPorHash(hash);
      if (!k) return null;
      const guardado = Buffer.from(k.hash, 'hex');
      const calculado = Buffer.from(hash, 'hex');
      if (guardado.length !== calculado.length || !timingSafeEqual(guardado, calculado)) return null;
      // A lo sumo cada 5 minutos: el sondeo de 60 s no escribe en la base en cada petición. Un fallo aquí no tumba la TV.
      if (k.ultimoUsoEn === null || ahora() - Date.parse(k.ultimoUsoEn) >= CINCO_MIN) await tablero.marcarUso(k.id).catch(() => undefined);
      return { id: k.id, nombre: k.nombre };
    },

    async tableroKiosco(ahoraMs) {
      const [snap, ajustes, cfg, configurado, ultima, ultimaBuena, incidente] = await Promise.all([
        repo.leerFoto(), repo.leerAjustes(), tablero.leerAjustesTablero(), deps.configurado(),
        repo.ultimaCorridaTerminada(), repo.ultimaCorridaBuena(), repo.incidenteAbierto(),
      ]);
      return armarRespuestaTablero({ snap, ajustes, cfg, aviso: avisoFoto({ configurado, ultima, ultimaBuena, incidente }, fmt) }, ahoraMs);
    },
  };
}
