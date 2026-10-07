/**
 * La FUENTE de la agenda del taller: una sola capa de lectura con dos orígenes
 * detrás (D4 y sección B de docs/trazabilidad-agenda-taller.md).
 *
 *   · principal: la base `desk` de Desk 2.0, por la conexión opcional de sólo
 *     lectura de db-desk2.ts (`DESK2_DB_URL`). SQL en fuente-desk2.ts;
 *   · respaldo: la réplica `desk.tickets` de zoho-hub, la de siempre. SQL en
 *     fuente-replica.ts.
 *
 * Lo que venga después (categorías, puestos, filas, proyección) trabaja sobre
 * `TicketTaller` y no sabe de dónde salió. Sólo de servidor, y sólo lee: no
 * calcula filas ni proyección y no escribe en ninguna de las dos bases.
 *
 * Cuándo se usa el respaldo:
 *   · sin `DESK2_DB_URL` → siempre (`sin_variable`); no es un error;
 *   · si la principal falla EN UNA LLAMADA (no conecta, la consulta caduca, al
 *     rol le falta un permiso…) → el respaldo en esa llamada, sin reintentar;
 *   · y, tras ese fallo, durante `CORTACIRCUITOS_MS` (cortacircuitos abierto):
 *     las lecturas van derechas al respaldo, sin esperar otra vez el tope de
 *     tiempo de la principal. Pasado ese rato, la llamada siguiente la prueba
 *     una vez: si contesta vuelve a mandar ella; si no, otro rato.
 * Si lo que falla es la réplica, eso sí sale como error: no queda otra fuente.
 *
 * Una lectura servida con el cortacircuitos abierto ES de respaldo y lo dice
 * (`fuente: 'respaldo'`): la pasada de la agenda no apunta historial ni cierra
 * asignaciones con ella, ni la toma por «todos cerrados» (D17).
 *
 * Ningún ticket lleva marca de dato dudoso (D13): lo que hay es un aviso
 * global, `sincronizacionParada`, en `estadoFuente()`.
 *
 * ⚠️ El error de la principal no sale de aquí: ni al registro ni al estado va
 * su mensaje, que puede arrastrar host y usuario. Sólo un motivo de la lista
 * y, en el registro, el código del error.
 */

import { claveEstadoDesk, etiquetaEstadoDesk } from './dominio.js';
import { leerCierresDesk2, leerTicketsDesk2, ultimaSincronizacionDesk2 } from './fuente-desk2.js';
import { leerTicketsReplica, ultimaSincronizacionReplica } from './fuente-replica.js';

/** D13: con el máximo de `synced_at` de la base usada más viejo que esto, la sincronización se da por parada. */
export const UMBRAL_SINCRONIZACION_PARADA_MS = 60 * 60 * 1000;
/** Cortacircuitos: tras un fallo de la principal, cuánto tiempo se lee el respaldo sin volver a probarla. */
export const CORTACIRCUITOS_MS = 60_000;

export type NombreFuente = 'principal' | 'respaldo';

/** Por qué se está en el respaldo. */
export const MOTIVOS_RESPALDO = ['sin_variable', 'error_conexion', 'timeout', 'error_consulta'] as const;
export type MotivoRespaldo = (typeof MOTIVOS_RESPALDO)[number];
/** Los motivos que son un fallo de la principal (todos menos no tenerla configurada). */
export type MotivoFallo = Exclude<MotivoRespaldo, 'sin_variable'>;

export const MENSAJE_RESPALDO: Record<MotivoRespaldo, string> = {
  sin_variable: 'La conexión con Desk 2.0 no está configurada (falta DESK2_DB_URL): se lee la réplica de Zoho.',
  error_conexion: 'No se pudo conectar con la base de Desk 2.0: se lee la réplica de Zoho.',
  timeout: 'La base de Desk 2.0 tardó demasiado en responder: se lee la réplica de Zoho.',
  error_consulta: 'La base de Desk 2.0 rechazó la consulta (permisos o esquema): se lee la réplica de Zoho.',
};

/** Un ticket sin cerrar, igual venga de donde venga. Lo que una fuente no tiene va como `null`. */
export interface TicketTaller {
  numero: number;
  /** Tal como lo escribe Desk; se casa por `claveEstadoDesk`. */
  estado: string;
  /** `status_type` de Desk: `Open` / `On Hold`. */
  tipoEstado: string | null;
  /** `classification`: de aquí sale el flujo (servicio / equipo nuevo, D11). */
  clasificacion: string | null;
  tipoServicio: string | null;
  /** `fecha_remision_entrada`, AAAA-MM-DD: el orden de la fila de entrada (D12). */
  remisionEntrada: string | null;
  /** AAAA-MM-DD: `fecha_creacion_ticket` o, si falta, el día en Colombia de `created_time` (el «ingreso» de Servicios). */
  fechaCreacion: string | null;
  /** La prioridad fijada en Desk 2.0 (`Urgent` / `High` / `Medium` / `Low`); `null` si no hay ninguna fijada o en respaldo (D1). */
  prioridad: string | null;
  /** Llegada exacta al estado de ahora, en milisegundos: la última transición a ese estado en Desk 2.0; `null` si no consta. */
  llegadaEstado: number | null;
  /**
   * El asunto del ticket, de las dos fuentes (lote 7): identifica el equipo en la pantalla de la agenda
   * (`detallesDeTickets`) y, en respaldo, ayuda a deducir el flujo. ⚠️ Es texto de terceros y suele llevar
   * el nombre del cliente: sólo sale por GET /agenda; el diagnóstico de la fuente no lo devuelve.
   */
  asunto: string | null;
  /** SÓLO en respaldo (`null` con la principal): con él y el asunto se deduce el flujo cuando no hay clasificación (D11, `flujoDeTicket`). No se enseña. */
  codigoServicio: string | null;
  fuente: NombreFuente;
}

export interface EstadoFuente {
  /** La que ha contestado en esta llamada. */
  fuente: NombreFuente;
  /** Por qué el respaldo; `null` con la principal. */
  motivo: MotivoRespaldo | null;
  /** El motivo, para enseñarlo; `null` con la principal. */
  mensaje: string | null;
  /** Máximo de `synced_at` de la base usada (ISO), o `null` si nunca se ha sincronizado. */
  ultimaSincronizacion: string | null;
  /** D13: la última sincronización supera el umbral (o no hay ninguna). Aviso global, no por ticket. */
  sincronizacionParada: boolean;
  umbralSincronizacionMs: number;
  /** El último fallo de la principal visto por este proceso, aunque ya haya vuelto; `null` si no ha fallado. */
  ultimoFalloPrincipal: { motivo: MotivoFallo; en: string } | null;
  /** Cortacircuitos abierto: hasta cuándo (ISO) no se vuelve a probar la principal; `null` si está cerrado. */
  cortacircuitosHasta: string | null;
}

export interface FuenteAgenda {
  /** Tickets sin cerrar, por número. */
  ticketsAbiertos(): Promise<TicketTaller[]>;
  /**
   * Los mismos tickets y QUIÉN los ha dado en esta llamada. Para quien no puede confundir «la principal
   * dice que no hay ninguno abierto» con «la principal no contestó»: una lista vacía no lo distingue.
   */
  abiertosConOrigen(): Promise<{ fuente: NombreFuente; tickets: TicketTaller[] }>;
  /** Cierres de empresa del tramo (AAAA-MM-DD, ambos incluidos). Vacío en respaldo: la réplica no los tiene (D3). */
  cierresEmpresa(desde: string, hasta: string): Promise<string[]>;
  estadoFuente(): Promise<EstadoFuente>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FilaTicket = Record<string, any>;
/** Lo único que la fuente necesita de una base: consultar. */
export interface DbLectura {
  query(sql: string, params?: unknown[]): Promise<{ rows: FilaTicket[] }>;
}

const textoONull = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

/** Una fila de cualquiera de las dos consultas → `TicketTaller`. */
export function normalizarTicket(fila: FilaTicket, fuente: NombreFuente): TicketTaller {
  return {
    numero: Number(fila.numero),
    estado: String(fila.estado ?? ''),
    tipoEstado: textoONull(fila.tipo_estado),
    clasificacion: textoONull(fila.clasificacion),
    tipoServicio: textoONull(fila.tipo_servicio),
    remisionEntrada: textoONull(fila.remision_entrada),
    fechaCreacion: textoONull(fila.fecha_creacion),
    prioridad: textoONull(fila.prioridad),
    llegadaEstado: fila.llegada_ms == null ? null : Number(fila.llegada_ms),
    asunto: textoONull(fila.asunto),
    codigoServicio: textoONull(fila.codigo_servicio),
    fuente,
  };
}

/** Códigos SQLSTATE que hablan de la conexión y no de la consulta: 08 conexión, 28 credenciales, 3D base, 53 recursos, 57 parada del servidor. */
const CLASES_DE_CONEXION = ['08', '28', '3D', '53', '57'];

/**
 * Un fallo de la principal → su motivo. Mira el código del error (SQLSTATE de
 * Postgres o el de Node) y, sólo para reconocer un tope de tiempo de `pg`, su
 * mensaje; el mensaje no se guarda ni se devuelve.
 */
export function clasificarFallo(e: unknown): MotivoFallo {
  const err = (e ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  // 57014 = consulta cancelada por statement_timeout.
  if (code === '57014' || code === 'ETIMEDOUT' || /timeout/i.test(typeof err.message === 'string' ? err.message : '')) return 'timeout';
  // Un SQLSTATE son cinco caracteres con algún dígito; los códigos de Node (EPIPE, ECONNREFUSED…) son sólo letras.
  if (/^[0-9A-Z]{5}$/.test(code) && /\d/.test(code) && !CLASES_DE_CONEXION.includes(code.slice(0, 2))) return 'error_consulta';
  return 'error_conexion';
}

/** Recuento de tickets por estado (casado por su clave), de más a menos y después alfabético. Para el diagnóstico. */
export function recuentoPorEstado(tickets: readonly TicketTaller[]): { estado: string; tickets: number }[] {
  const porClave = new Map<string, { estado: string; tickets: number }>();
  for (const t of tickets) {
    const clave = claveEstadoDesk(t.estado);
    const fila = porClave.get(clave) ?? { estado: etiquetaEstadoDesk(t.estado), tickets: 0 };
    fila.tickets++;
    porClave.set(clave, fila);
  }
  return [...porClave.values()].sort((a, b) => b.tickets - a.tickets || a.estado.localeCompare(b.estado, 'es'));
}

export interface DepsFuente {
  /** La base del hub (la réplica). */
  hub: DbLectura;
  /** La conexión a Desk 2.0, o `null` si no está configurada (`getDesk2Pool`). Se pide en cada llamada. */
  desk2: () => DbLectura | null;
  /** El reloj, para las pruebas. */
  ahora?: () => number;
}

export function crearFuenteAgenda({ hub, desk2, ahora = Date.now }: DepsFuente): FuenteAgenda {
  let ultimoFallo: { motivo: MotivoFallo; en: string } | null = null;
  /** El motivo del último aviso escrito en el registro, para no repetirlo en cada llamada. */
  let avisado: MotivoFallo | null = null;
  /** Cortacircuitos: el instante (ms) hasta el que no se prueba la principal; `null` = cerrado. */
  let abiertoHasta: number | null = null;
  const cortado = () => abiertoHasta !== null && ahora() < abiertoHasta;

  /**
   * Una lectura: la principal si está y contesta; si no, el respaldo, en esta
   * misma llamada. Un intento a la principal por llamada, y ninguno mientras
   * el cortacircuitos esté abierto.
   */
  async function leer<T>(dePrincipal: (db: DbLectura) => Promise<T>, deRespaldo: () => Promise<T>): Promise<{ valor: T; fuente: NombreFuente; motivo: MotivoRespaldo | null }> {
    let db: DbLectura | null;
    let motivo: MotivoRespaldo = 'sin_variable';
    try {
      db = desk2();
      if (db && cortado() && ultimoFallo) motivo = ultimoFallo.motivo;
      else if (db) {
        const valor = await dePrincipal(db);
        avisado = null;
        abiertoHasta = null;
        return { valor, fuente: 'principal', motivo: null };
      }
    } catch (e) {
      const fallo = clasificarFallo(e);
      motivo = fallo;
      abiertoHasta = ahora() + CORTACIRCUITOS_MS;
      ultimoFallo = { motivo: fallo, en: new Date(ahora()).toISOString() };
      if (avisado !== fallo) {
        avisado = fallo;
        const code = (e as { code?: unknown } | null)?.code;
        console.warn(`agenda: la base de Desk 2.0 no respondió (${fallo}, código ${typeof code === 'string' ? code : 'desconocido'}); se lee la réplica`);
      }
    }
    return { valor: await deRespaldo(), fuente: 'respaldo', motivo };
  }

  async function abiertosConOrigen() {
    const { valor, fuente } = await leer(
      async (db) => (await leerTicketsDesk2(db)).map((f) => normalizarTicket(f, 'principal')),
      async () => (await leerTicketsReplica(hub)).map((f) => normalizarTicket(f, 'respaldo')),
    );
    return { fuente, tickets: valor };
  }

  return {
    abiertosConOrigen,
    async ticketsAbiertos() {
      return (await abiertosConOrigen()).tickets;
    },

    async cierresEmpresa(desde, hasta) {
      const { valor } = await leer(
        (db) => leerCierresDesk2(db, desde, hasta),
        async () => [],
      );
      return valor;
    },

    async estadoFuente() {
      const { valor: ms, fuente, motivo } = await leer(ultimaSincronizacionDesk2, () => ultimaSincronizacionReplica(hub));
      return {
        fuente,
        motivo,
        mensaje: motivo ? MENSAJE_RESPALDO[motivo] : null,
        ultimaSincronizacion: ms === null ? null : new Date(ms).toISOString(),
        sincronizacionParada: ms === null || ahora() - ms > UMBRAL_SINCRONIZACION_PARADA_MS,
        umbralSincronizacionMs: UMBRAL_SINCRONIZACION_PARADA_MS,
        ultimoFalloPrincipal: ultimoFallo,
        cortacircuitosHasta: cortado() ? new Date(abiertoHasta!).toISOString() : null,
      };
    },
  };
}
