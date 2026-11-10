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
 *   · los `cf_*` salen de TRES sitios (ver calibraciones-desk2.ts y las
 *     PROMOTED_COLUMNS de Desk 2.0): `raw->'cf'` (nombre interno; solo lo traen los
 *     tickets releídos al detalle y NO se actualiza en los `managed_by_app`),
 *     `custom_fields` (etiqueta → valor, SIN las etiquetas promovidas) y las columnas
 *     promovidas (`CAMPOS`). Ticket normal: raw.cf, luego custom_fields, luego columnas.
 *     `managed_by_app`: al revés (raw.cf está rancio), y estado, cierre y última
 *     modificación salen de las columnas. La sonda cuenta cuántos tickets traen
 *     `raw.cf` o `custom_fields`;
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
  /** Cuántos traen `raw->'cf'` o `custom_fields` (los que no, solo cuentan con las columnas promovidas). */
  conCf: number;
}

export interface FuenteDesk2 {
  /** Comprueba tablas, columnas y permisos de todo lo que se va a leer, sin traer filas de comentarios. */
  sonda(): Promise<SondaDesk2>;
  tickets(serial: string): Promise<TicketZoho[]>;
  ticketNumero(n: string): Promise<TicketZoho[]>;
  comentarios(ticketId: string): Promise<ComentarioZoho[]>;
}

/** `cf_*` del núcleo → columna promovida de desk.tickets y etiqueta de Zoho (custom_fields). */
const CAMPOS: { cf: string; col?: string; etiqueta: string }[] = [
  { cf: 'cf_serial', col: 'serial', etiqueta: 'Serial' },
  { cf: 'cf_serial1', etiqueta: 'Serial 1' },
  { cf: 'cf_serial2', etiqueta: 'Serial 2' },
  { cf: 'cf_serial3', etiqueta: 'Serial 3' },
  { cf: 'cf_codigo_servicio', col: 'codigo_servicio', etiqueta: 'Código Servicio' },
  { cf: 'cf_equipo_1', col: 'equipo', etiqueta: 'Equipo' },
  { cf: 'cf_modelo', col: 'modelo', etiqueta: 'Modelo de equipo' },
  { cf: 'cf_encargado', col: 'encargado', etiqueta: 'Encargado' },
  { cf: 'cf_tipo_de_servicio', col: 'tipo_servicio', etiqueta: 'Tipo de Servicio' },
  { cf: 'cf_fecha_remision_entreda', col: 'fecha_remision_entrada', etiqueta: 'Fecha Remisión Entrada' },
  { cf: 'cf_fecha_remision_de_salida', col: 'fecha_remision_salida', etiqueta: 'Fecha Remisión de Salida' },
  { cf: 'cf_fecha_finalizacion_st', col: 'fecha_finalizacion_st', etiqueta: 'Fecha Finalización ST' },
  { cf: 'cf_fecha_entrada_de_servicio_externo', col: 'fecha_entrada_servicio_externo', etiqueta: 'Fecha Entrada de servicio externo' },
  { cf: 'cf_fecha_salida_servicio_externo', col: 'fecha_salida_servicio_externo', etiqueta: 'Fecha Salida Servicio externo' },
];
const FECHAS = new Set(['fecha_remision_entrada', 'fecha_remision_salida', 'fecha_finalizacion_st', 'fecha_entrada_servicio_externo', 'fecha_salida_servicio_externo']);
const COLUMNAS = `t.id, t.number, t.subject, t.status, t.status_type, t.created_time, t.modified_time, t.closed_time,
       t.managed_by_app, t.custom_fields, t.raw,
       ${CAMPOS.filter((c) => c.col).map((c) => (FECHAS.has(c.col!) ? `t.${c.col}::text AS ${c.col}` : `t.${c.col}`)).join(', ')}`;
const COLUMNAS_COMENTARIO = 'c.ticket_id, c.kind, c.content, c.commented_time, c.raw';
/** Como la búsqueda de Zoho por serial: los 10 más recientes. */
export const LIMITE_TICKETS = 10;
/** Como la página de Claude (la API de Zoho con `limit=15`): los 15 comentarios más recientes. */
export const LIMITE_COMENTARIOS = 15;

const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const instante = (v: unknown): string | undefined => (v instanceof Date ? v.toISOString() : texto(v));
/** Escapa los comodines de ILIKE. */
/** Etiqueta sin mayúsculas, tildes ni separadores: «Serial 1» = «serial_1». */
const clave = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export function fuenteDesk2(desk2: () => DbLectura | null): FuenteDesk2 {
  /**
   * Id que usa el núcleo → id de la fila en desk.tickets. Vive lo que vive la fuente: el
   * servicio crea una por corrida (`fuentes: () => FuentesCorrida`); el tope es sólo una red.
   */
  const filas = new Map<string, string>();
  const db = (): DbLectura => {
    const d = desk2();
    if (!d) throw new SinDesk2();
    return d;
  };

  function aZoho(r: Record<string, unknown>): TicketZoho {
    const raw = esObj(r.raw) ? r.raw : {};
    const gestionado = r.managed_by_app === true;
    const deRaw: Record<string, string | null | undefined> = esObj(raw.cf) ? { ...(raw.cf as Record<string, string | null>) } : {};
    const porEtiqueta = new Map<string, unknown>();
    if (esObj(r.custom_fields)) for (const [k, v] of Object.entries(r.custom_fields)) porEtiqueta.set(clave(k), v);
    const cf: Record<string, string | null | undefined> = { ...deRaw };
    for (const c of CAMPOS) {
      const candidatos = [texto(deRaw[c.cf]), texto(porEtiqueta.get(clave(c.etiqueta))), c.col ? texto(r[c.col]) : undefined];
      if (gestionado) candidatos.push(candidatos.shift()); // raw.cf está rancio: va el último
      const v = candidatos.find((x) => x !== undefined);
      if (v !== undefined) cf[c.cf] = v;
    }
    const id = String(r.id);
    const webUrl = texto(raw.webUrl) ?? '';
    if (filas.size > 5000) filas.clear();
    filas.set((webUrl.match(/dv\/(\d+)/) || [])[1] || id, id);
    return {
      id,
      ticketNumber: String(r.number),
      status: texto(r.status) ?? texto(raw.status),
      statusType: texto(r.status_type) ?? texto(raw.statusType),
      createdTime: texto(raw.createdTime) ?? instante(r.created_time),
      closedTime: (gestionado ? instante(r.closed_time) ?? texto(raw.closedTime) : texto(raw.closedTime) ?? instante(r.closed_time)) ?? null,
      modifiedTime: (gestionado ? instante(r.modified_time) ?? texto(raw.modifiedTime) : texto(raw.modifiedTime) ?? instante(r.modified_time)) ?? '',
      subject: texto(r.subject) ?? texto(raw.subject),
      webUrl,
      cf,
    };
  }

  return {
    async sonda() {
      const { rows } = await db().query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE jsonb_typeof(t.raw->'cf') = 'object' OR t.custom_fields <> '{}'::jsonb)::int AS con_cf,
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
          WHERE concat_ws(' ', t.serial, t.codigo_servicio, t.subject, (t.raw->'cf')::text, t.custom_fields::text, t.raw->>'subject') ILIKE '%' || $1 || '%'
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
          ORDER BY c.commented_time DESC NULLS LAST
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
