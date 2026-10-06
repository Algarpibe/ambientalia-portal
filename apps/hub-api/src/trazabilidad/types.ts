/**
 * Tipos y validación de entrada de la API de Trazabilidad Mantenimientos
 * Clientes. Todo se valida antes de tocar la base: cada función lanza un
 * TzError 400 con mensaje en español y el campo culpable.
 */

import {
  PLAZO_MAX_DIAS,
  PLAZO_MIN_DIAS,
  claveTipoServicio,
  esFechaIso,
  modeloEdm180,
  type EstadoCalibracion,
  type EstadoPlazo,
  type OrigenTipo,
} from './dominio.js';

// Sin «parameter properties»: la app del portal importa este fichero (sólo
// tipos) y compila con erasableSyntaxOnly.
export class TzError extends Error {
  readonly code: string;
  readonly status: number;
  readonly messageEs: string;
  readonly field: string | undefined;

  constructor(code: string, status: number, messageEs: string, field?: string) {
    super(code);
    this.name = 'TzError';
    this.code = code;
    this.status = status;
    this.messageEs = messageEs;
    this.field = field;
  }
}

const invalido = (msg: string, field?: string) => new TzError('invalid_input', 400, msg, field);

/** Una fila de la F-ST-022, tal como la manda la app tras leer el Excel. */
export interface FilaImportada {
  serial: string;
  cliente: string;
  marca: string;
  modelo: string;
  fechaFactura: string | null;
  hojaVida: string | null;
  ultimaEntrada: string | null;
  ultimaCalibracion: string | null;
  entradasSt: number | null;
  calibracionesPeriodo: number | null;
  correctivosPeriodo: number | null;
}

export interface Importacion {
  archivo: string;
  filas: FilaImportada[];
}

export interface Seguimiento {
  enAmbientalia: boolean;
  avisoEnviado: string | null;
  servicioProgramado: string | null;
  nota: string;
}

export interface SeguimientoGuardado extends Seguimiento {
  actualizadoPor: string;
  actualizadoEn: string;
}

/** Ticket de servicio abierto en Zoho Desk para el serial del equipo (réplica desk.tickets). */
export interface TicketDesk {
  numero: number;
  /** Estado tal como lo nombra Desk. */
  estado: string;
  /** True si la réplica lleva más de un día sin refrescar el ticket: puede estar ya cerrado. */
  sinConfirmar: boolean;
}

export interface EquipoVista {
  clave: string;
  serial: string;
  cliente: string;
  marca: string;
  modelo: string;
  fechaFactura: string | null;
  hojaVida: string | null;
  ultimaEntrada: string | null;
  ultimaCalibracion: string | null;
  entradasSt: number | null;
  calibracionesPeriodo: number | null;
  correctivosPeriodo: number | null;
  vence: string | null;
  vigenciaDias: number | null;
  estado: EstadoCalibracion;
  /** True si el serial aparece en más de una fila de la hoja. */
  serialRepetido: boolean;
  seguimiento: SeguimientoGuardado | null;
  /** El ticket abierto de número más alto, o null si no hay ninguno. */
  ticket: TicketDesk | null;
}

export interface ResumenImportacion {
  id: number | null;
  archivo: string;
  total: number;
  nuevos: number;
  actualizados: number;
  retirados: number;
  por: string;
  en: string;
}

export interface Actor {
  userId: string | null;
  email: string;
}

export const MAX_FILAS = 3000;

function obj(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalido('El cuerpo de la petición no es válido.', field);
  return v as Record<string, unknown>;
}

function texto(v: unknown, field: string, max: number, requerido: boolean): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (requerido) throw invalido(`Falta «${field}».`, field);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw invalido(`«${field}» debe ser texto.`, field);
  const s = String(v).trim();
  if (s.length > max) throw invalido(`«${field}» supera ${max} caracteres.`, field);
  return s;
}

function fecha(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (!esFechaIso(v)) throw invalido(`«${field}» no es una fecha válida (AAAA-MM-DD).`, field);
  return v;
}

function entero(v: unknown, field: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100_000) {
    throw invalido(`«${field}» debe ser un entero no negativo.`, field);
  }
  return v;
}

/** Valida el cuerpo de POST /trazabilidad/importaciones. */
export function parseImportacion(body: unknown): Importacion {
  const b = obj(body, 'body');
  const archivo = texto(b.archivo, 'archivo', 255, true)!;
  if (!Array.isArray(b.filas)) throw invalido('Faltan las filas del archivo.', 'filas');
  if (b.filas.length === 0) throw invalido('El archivo no trae ningún GRIMM EDM 180.', 'filas');
  if (b.filas.length > MAX_FILAS) throw invalido(`El archivo trae más de ${MAX_FILAS} filas.`, 'filas');
  const filas = b.filas.map((raw, i): FilaImportada => {
    const f = obj(raw, `filas[${i}]`);
    const p = (campo: string) => `filas[${i}].${campo}`;
    const modelo = modeloEdm180(f.modelo);
    if (!modelo) throw invalido(`La fila ${i + 1} no es un GRIMM EDM 180.`, p('modelo'));
    const marca = texto(f.marca, p('marca'), 60, true)!;
    if (marca.toLowerCase() !== 'grimm') throw invalido(`La fila ${i + 1} no es de marca GRIMM.`, p('marca'));
    return {
      serial: texto(f.serial, p('serial'), 120, true)!,
      cliente: texto(f.cliente, p('cliente'), 200, true)!,
      marca: 'Grimm',
      modelo,
      fechaFactura: fecha(f.fechaFactura, p('fechaFactura')),
      hojaVida: texto(f.hojaVida, p('hojaVida'), 200, false),
      ultimaEntrada: fecha(f.ultimaEntrada, p('ultimaEntrada')),
      ultimaCalibracion: fecha(f.ultimaCalibracion, p('ultimaCalibracion')),
      entradasSt: entero(f.entradasSt, p('entradasSt')),
      calibracionesPeriodo: entero(f.calibracionesPeriodo, p('calibracionesPeriodo')),
      correctivosPeriodo: entero(f.correctivosPeriodo, p('correctivosPeriodo')),
    };
  });
  return { archivo, filas };
}

/** Valida el cuerpo de PUT /trazabilidad/seguimiento/:clave. */
export function parseSeguimiento(body: unknown): Seguimiento {
  const b = obj(body, 'body');
  if (typeof b.enAmbientalia !== 'boolean') throw invalido('«enAmbientalia» debe ser verdadero o falso.', 'enAmbientalia');
  return {
    enAmbientalia: b.enAmbientalia,
    avisoEnviado: fecha(b.avisoEnviado, 'avisoEnviado'),
    servicioProgramado: fecha(b.servicioProgramado, 'servicioProgramado'),
    nota: texto(b.nota, 'nota', 2000, false) ?? '',
  };
}

/** Valida el cuerpo de POST /trazabilidad/avisos. */
export function parseAvisos(body: unknown): { claves: string[]; fecha: string } {
  const b = obj(body, 'body');
  const f = fecha(b.fecha, 'fecha');
  if (!f) throw invalido('Falta la fecha del aviso.', 'fecha');
  if (!Array.isArray(b.claves) || b.claves.length === 0) throw invalido('No hay equipos que marcar.', 'claves');
  if (b.claves.length > 500) throw invalido('Demasiados equipos en un solo aviso.', 'claves');
  const claves = b.claves.map((c, i) => {
    if (typeof c !== 'string' || !esClave(c)) throw invalido('Clave de equipo no válida.', `claves[${i}]`);
    return c;
  });
  return { claves: [...new Set(claves)], fecha: f };
}

export function esClave(s: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(s);
}

/** Tipo de servicio puesto a mano a un ticket (portal.tmc_servicios_tipo). */
export interface TipoManual {
  /** El tipo normalizado: la `clave` de su fila en Configuración. */
  clave: string;
  /** Correo de quien lo puso. */
  por: string;
  en: string;
}

/** Un tipo de servicio que se puede elegir a mano: una fila de portal.tmc_plazos. */
export interface TipoServicioOpcion {
  clave: string;
  etiqueta: string;
  /** Su plazo en días hábiles; null = se puede elegir, pero el servicio queda «sin plazo». */
  dias: number | null;
}

/** Un ticket de Zoho Desk que no está cerrado, con su plazo ya calculado (pestaña «Servicios»). */
export interface ServicioVista {
  numero: number;
  /** Asunto del ticket, tal como viene de Desk. */
  asunto: string;
  /** La cuenta de Desk; si la réplica no la trae, el asunto sin el código de servicio. */
  cliente: string;
  /** True si `cliente` sale del asunto y no de la cuenta de Desk. */
  clienteDeAsunto: boolean;
  serial: string;
  /** Tercer tramo del código de servicio; vacío si no lo hay. */
  modelo: string;
  /**
   * El tipo que vale para el plazo: el puesto a mano si lo hay (con la etiqueta
   * de Configuración) y, si no, el de Desk tal como lo escribe. Vacío = sin tipo.
   */
  tipoServicio: string;
  /** De dónde sale `tipoServicio`; null si el ticket no tiene tipo. */
  tipoOrigen: OrigenTipo | null;
  /** Lo que trae Desk, valga o no; vacío mientras la réplica no lo traiga. */
  tipoDesk: string;
  /** El tipo puesto a mano, quién lo puso y cuándo; null si no hay ninguno. */
  tipoManual: TipoManual | null;
  /** Estado tal como lo nombra Desk. */
  estado: string;
  /** Día de ingreso en Colombia (AAAA-MM-DD). */
  ingreso: string | null;
  /** Plazo configurado para su tipo, en días hábiles; null = sin plazo. */
  plazoDias: number | null;
  fechaLimite: string | null;
  /** Días hábiles que quedan; negativo = días hábiles de atraso. */
  diasHabiles: number | null;
  estadoPlazo: EstadoPlazo;
  /** True si la réplica lleva más de un día sin refrescar el ticket: puede estar ya cerrado. */
  sinConfirmar: boolean;
}

/** Plazo de un tipo de servicio (pestaña «Configuración»). */
export interface PlazoServicio {
  /** El tipo normalizado (`claveTipoServicio`): con ella casan los tickets. */
  clave: string;
  etiqueta: string;
  /** Días hábiles; null = sin plazo. */
  dias: number | null;
  /** Tickets abiertos en Desk con este tipo. */
  ticketsAbiertos: number;
  /** Quién lo cambió por última vez; null si sigue como se sembró. */
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

export interface CambioPlazo {
  tipo: string;
  dias: number | null;
}

/** Valida el cuerpo de PUT /trazabilidad/plazos. Vacío (null o '') = sin plazo. */
export function parsePlazo(body: unknown): CambioPlazo {
  const b = obj(body, 'body');
  const tipo = texto(b.tipo, 'tipo', 80, true)!;
  if (!claveTipoServicio(tipo)) throw invalido('Falta «tipo».', 'tipo');
  const d = b.dias;
  if (d === null || d === undefined || d === '') return { tipo, dias: null };
  if (typeof d !== 'number' || !Number.isInteger(d) || d < PLAZO_MIN_DIAS || d > PLAZO_MAX_DIAS) {
    throw invalido(`El plazo debe ser un número entero de días hábiles entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o quedar vacío.`, 'dias');
  }
  return { tipo, dias: d };
}

/**
 * El número de ticket de la ruta PUT /trazabilidad/servicios/:numero/tipo: un
 * entero positivo escrito sólo con dígitos (cabe de sobra en el INTEGER de la tabla).
 */
export function parseNumeroTicket(v: unknown): number {
  if (typeof v !== 'string' || !/^[1-9]\d{0,8}$/.test(v)) throw invalido('El número de ticket no es válido.', 'numero');
  return Number(v);
}

/**
 * Valida el cuerpo de PUT /trazabilidad/servicios/:numero/tipo. `tipo` null o
 * vacío = quitar el puesto a mano (vuelve a valer el de Desk). Que el tipo esté
 * en Configuración lo comprueba el repo, que es quien ve la tabla.
 */
export function parseTipoManual(body: unknown): { tipo: string | null } {
  const b = obj(body, 'body');
  const t = b.tipo;
  if (t === undefined) throw invalido('Falta «tipo».', 'tipo');
  if (t === null) return { tipo: null };
  if (typeof t !== 'string') throw invalido('«tipo» debe ser texto, o quedar vacío para quitarlo.', 'tipo');
  return { tipo: texto(t, 'tipo', 80, false) };
}
