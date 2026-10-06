/**
 * Tipos y validación de entrada de la API de Trazabilidad Mantenimientos
 * Clientes. Todo se valida antes de tocar la base: cada función lanza un
 * TzError 400 con mensaje en español y el campo culpable.
 */

import { esFechaIso, modeloEdm180, type EstadoCalibracion } from './dominio.js';

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
