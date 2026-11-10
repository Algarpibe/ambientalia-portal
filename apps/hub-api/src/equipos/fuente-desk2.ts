/**
 * Tickets y comentarios de «Equipos en taller», leídos de la base de Desk 2.0
 * (D4): `desk.tickets` y `desk.conversations`, por la conexión de sólo lectura de
 * db-desk2.ts (`DESK2_DB_URL`, rol `portal_agenda_reader`). No se usa la API de
 * Zoho. Sin respaldo (D5): si algo falla, el error sube tal cual y la corrida
 * termina fallida; para la causa, `motivoDesk2`, que nunca lleva el mensaje de
 * `pg` (puede arrastrar el host).
 *
 * El núcleo espera la forma de la API de Zoho (`TicketZoho`, `ComentarioZoho`):
 *   · el ticket sale de `raw` (la respuesta de Zoho que guarda Desk 2.0), con
 *     número, estado, tipo de estado y asunto de las COLUMNAS (Desk 2.0 los
 *     mantiene al día también en los tickets gestionados desde la app);
 *   · los `cf_*` salen de `raw->'cf'`. Ese objeto solo lo traen los tickets que
 *     Desk 2.0 ha releído al detalle (ver calibraciones-desk2.ts): lo que falte se
 *     completa con las columnas promovidas (`serial`, `tipo_servicio`,
 *     `fecha_remision_entrada`), y la sonda cuenta cuántos tickets no lo traen;
 *   · el id que usa el núcleo es el de la URL del ticket (`dv/<id>`) o el de la
 *     fila: aquí se recuerda a qué fila corresponde para leer sus comentarios.
 */
import { clasificarFallo, type DbLectura } from '../trazabilidad/fuente.js';
import type { ComentarioZoho, TicketZoho } from './nucleo/tipos.js';

/** Sin `DESK2_DB_URL`: todas las corridas fallan con «desk2: sin configurar». */
export class SinDesk2 extends Error {
  constructor() {
    super('Desk 2.0 sin configurar');
    this.name = 'SinDesk2';
  }
}

/** Para la causa de una corrida fallida: «desk2: <esto>». */
export function motivoDesk2(e: unknown): string {
  if (e instanceof SinDesk2) return 'sin configurar';
  const m = clasificarFallo(e);
  return m === 'timeout' ? 'tiempo agotado' : m === 'error_consulta' ? 'consulta rechazada (permisos o esquema)' : 'sin conexión';
}

export interface SondaDesk2 {
  /** Tickets en la tabla. */
  total: number;
  /** Cuántos traen `raw->'cf'`. */
  conCf: number;
}

export interface FuenteDesk2 {
  /** Comprueba tablas, columnas y permisos de todo lo que se va a leer, sin traer filas de comentarios. */
  sonda(): Promise<SondaDesk2>;
  tickets(serial: string): Promise<TicketZoho[]>;
  ticketNumero(n: string): Promise<TicketZoho[]>;
  comentarios(ticketId: string): Promise<ComentarioZoho[]>;
}

const COLUMNAS = `t.id, t.number, t.serial, t.tipo_servicio, t.fecha_remision_entrada::text AS fecha_remision_entrada,
       t.subject, t.status, t.status_type, t.created_time, t.raw`;
const COLUMNAS_COMENTARIO = 'c.ticket_id, c.kind, c.content, c.commented_time, c.raw';
/** Como la búsqueda de Zoho por serial: los 10 más recientes. */
export const LIMITE_TICKETS = 10;
/** Como la página de Claude (la API de Zoho con `limit=15`): los 15 comentarios más recientes. */
export const LIMITE_COMENTARIOS = 15;

const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const instante = (v: unknown): string | undefined => (v instanceof Date ? v.toISOString() : texto(v));
/** Escapa los comodines de ILIKE. */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export function fuenteDesk2(desk2: () => DbLectura | null): FuenteDesk2 {
  /** Id que usa el núcleo → id de la fila en desk.tickets. */
  const filas = new Map<string, string>();
  const db = (): DbLectura => {
    const d = desk2();
    if (!d) throw new SinDesk2();
    return d;
  };

  function aZoho(r: Record<string, unknown>): TicketZoho {
    const raw = esObj(r.raw) ? r.raw : {};
    const cf: Record<string, string | null | undefined> = esObj(raw.cf) ? { ...(raw.cf as Record<string, string | null>) } : {};
    cf.cf_serial ??= texto(r.serial);
    cf.cf_tipo_de_servicio ??= texto(r.tipo_servicio);
    cf.cf_fecha_remision_entreda ??= texto(r.fecha_remision_entrada);
    const id = String(r.id);
    const webUrl = texto(raw.webUrl) ?? '';
    filas.set((webUrl.match(/dv\/(\d+)/) || [])[1] || id, id);
    return {
      id,
      ticketNumber: String(r.number),
      status: texto(r.status) ?? texto(raw.status),
      statusType: texto(r.status_type) ?? texto(raw.statusType),
      createdTime: texto(raw.createdTime) ?? instante(r.created_time),
      closedTime: texto(raw.closedTime) ?? null,
      modifiedTime: texto(raw.modifiedTime) ?? '',
      subject: texto(r.subject) ?? texto(raw.subject),
      webUrl,
      cf,
    };
  }

  return {
    async sonda() {
      const { rows } = await db().query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE jsonb_typeof(t.raw->'cf') = 'object')::int AS con_cf,
                (SELECT count(*) FROM (SELECT ${COLUMNAS} FROM desk.tickets t WHERE false) s)::int AS sonda_tickets,
                (SELECT count(*) FROM (SELECT ${COLUMNAS_COMENTARIO} FROM desk.conversations c WHERE false) s)::int AS sonda_comentarios
           FROM desk.tickets t`,
      );
      return { total: Number(rows[0]?.total ?? 0), conCf: Number(rows[0]?.con_cf ?? 0) };
    },
    async tickets(serial) {
      const s = String(serial).trim();
      if (!s) return [];
      const { rows } = await db().query(
        `SELECT ${COLUMNAS}
           FROM desk.tickets t
          WHERE concat_ws(' ', t.serial, t.subject, (t.raw->'cf')::text, t.raw->>'subject') ILIKE '%' || $1 || '%'
          ORDER BY t.created_time DESC NULLS LAST, t.number DESC
          LIMIT ${LIMITE_TICKETS}`,
        [literal(s)],
      );
      return rows.map(aZoho);
    },
    async ticketNumero(n) {
      if (!/^\d{1,9}$/.test(String(n))) return [];
      const { rows } = await db().query(`SELECT ${COLUMNAS} FROM desk.tickets t WHERE t.number = $1::int LIMIT 1`, [String(n)]);
      return rows.map(aZoho);
    },
    async comentarios(ticketId) {
      const { rows } = await db().query(
        `SELECT ${COLUMNAS_COMENTARIO}
           FROM desk.conversations c
          WHERE c.ticket_id = $1 AND c.kind = 'comment'
          ORDER BY c.commented_time DESC
          LIMIT ${LIMITE_COMENTARIOS}`,
        [filas.get(ticketId) ?? ticketId],
      );
      return rows
        .map((c): ComentarioZoho => {
          const raw = esObj(c.raw) ? c.raw : {};
          const adj = Array.isArray(raw.attachments) ? raw.attachments : [];
          return {
            commentedTime: instante(c.commented_time) ?? '',
            content: String(c.content ?? ''),
            attachments: adj.filter((a) => esObj(a) && typeof a.name === 'string').map((a) => ({ name: String((a as { name: string }).name) })),
          };
        })
        .filter((c) => c.commentedTime);
    },
  };
}
