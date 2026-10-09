/**
 * Tipos y validación de entrada de la API de Trazabilidad Mantenimientos
 * Clientes. Todo se valida antes de tocar la base: cada función lanza un
 * TzError 400 con mensaje en español y el campo culpable.
 */

import {
  CATEGORIAS_AGENDA,
  CONTACTO_MAX_EMAILS,
  CONTACTO_MAX_TEXTO,
  EMAIL_MAX,
  ETAPAS_AGENDA,
  FLUJOS_AGENDA,
  PLAZO_MAX_DIAS,
  PLAZO_MIN_DIAS,
  PUESTOS_MAX,
  TIPO_POR_DEFECTO,
  categoriaCoherente,
  claveCliente,
  claveEstadoDesk,
  claveTipoServicio,
  esCategoriaAgenda,
  esEmail,
  esEtapaAgenda,
  esFechaIso,
  esRolEstado,
  modeloEdm180,
  normalizarEmail,
  partesDeTipo,
  type CategoriaAgenda,
  type ContactoEquipo,
  type DuracionEtapa,
  type EtapaAgenda,
  type EstadoCalibracion,
  type EstadoPlazo,
  type FlujoAgenda,
  type OrigenTipo,
  type RangoFechas,
  type RolEstado,
  type TipoAbierto,
  type TramoPlazo,
} from './dominio.js';
import { FST022_MAX_COLUMNAS, FST022_MAX_FILAS, FST022_MAX_TEXTO, prepararFst022, type Celda, type Fst022Preparada, type ResumenFst022 } from './fst022.js';
import { ROLES_APP, esRolApp, type Permiso, type RolApp } from './roles.js';

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
  /**
   * A quién iría su aviso: el contacto puesto a mano a su cliente si lo hay y,
   * si no, el del ticket de Desk más reciente con un correo que valga (ni
   * vacío, ni mal formado, ni interno). Null si no hay ninguno.
   */
  contacto: ContactoEquipo | null;
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

// ── Congelación de la F-ST-022 (lote 9a) ────────────────────────────────────

/** Una congelación: de qué fichero salió, sus recuentos y quién la hizo (y, si ya no es la vigente, quién la reemplazó). */
export interface CongelacionFst022 extends ResumenFst022 {
  id: number;
  archivo: string;
  sha256: string;
  hoja: string;
  vigente: boolean;
  motivo: string | null;
  por: string;
  en: string;
  reemplazadaPor: string | null;
  reemplazadaEn: string | null;
  reemplazadaMotivo: string | null;
}

/** Lo que responde POST /trazabilidad/fst022/congelaciones: con `simulado` no se ha escrito nada y `congelacion` es null. */
export interface ResultadoCongelacion {
  simulado: boolean;
  archivo: string;
  sha256: string;
  hoja: string;
  resumen: ResumenFst022;
  /** Los títulos de cada columna, de arriba abajo. */
  titulos: string[];
  /** La que había vigente antes (la que se reemplaza), o null. */
  anterior: CongelacionFst022 | null;
  congelacion: CongelacionFst022 | null;
}

export interface NuevaCongelacion {
  archivo: string;
  sha256: string;
  hoja: string;
  motivo: string | null;
  preparada: Fst022Preparada;
}

const CLAVES_CELDA = new Set(['v', 't', 'enlace']);
const esTexto = (v: unknown): v is string => typeof v === 'string' && v.length <= FST022_MAX_TEXTO && !v.includes('\u0000');
const esValor = (v: unknown): boolean => v === null || typeof v === 'boolean' || esTexto(v) || (typeof v === 'number' && Number.isFinite(v));
function esCelda(c: unknown): c is Celda {
  if (c === null || typeof c !== 'object') return esValor(c);
  const o = c as Record<string, unknown>;
  if (Array.isArray(c) || !Object.keys(o).every((k) => CLAVES_CELDA.has(k)) || !esValor(o.v)) return false;
  if (o.enlace !== undefined && !esTexto(o.enlace)) return false;
  return o.t === undefined || (o.t === 'fecha' && esFechaIso(o.v)) || (o.t === 'error' && typeof o.v === 'string');
}

/**
 * Valida el cuerpo de POST /trazabilidad/fst022/congelaciones: la hoja entera,
 * celda a celda. Los mensajes dicen DÓNDE está el fallo y nunca qué traía la
 * celda (las filas llevan clientes y seriales).
 */
export function parseCongelacion(body: unknown): NuevaCongelacion {
  const b = obj(body, 'body');
  const archivo = texto(b.archivo, 'archivo', 255, true)!;
  const hoja = texto(b.hoja, 'hoja', 100, true)!;
  if (typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256)) throw invalido('La huella del archivo (sha256) no es válida.', 'sha256');
  if (!Array.isArray(b.matriz)) throw invalido('Faltan las filas de la hoja.', 'matriz');
  if (b.matriz.length > FST022_MAX_FILAS) throw invalido(`La hoja trae más de ${FST022_MAX_FILAS} filas.`, 'matriz');
  b.matriz.forEach((r: unknown, i) => {
    if (!Array.isArray(r)) throw invalido(`La fila ${i + 1} de la hoja no es válida.`, `matriz[${i}]`);
    if (r.length > FST022_MAX_COLUMNAS) throw invalido(`La fila ${i + 1} trae más de ${FST022_MAX_COLUMNAS} columnas.`, `matriz[${i}]`);
    const j = r.findIndex((c) => !esCelda(c));
    if (j >= 0) throw invalido(`La celda de la fila ${i + 1}, columna ${j + 1}, no se puede guardar (valor no admitido o texto de más de ${FST022_MAX_TEXTO} caracteres).`, `matriz[${i}][${j}]`);
  });
  const preparada = prepararFst022(b.matriz as Celda[][]);
  if (!preparada) throw invalido(b.matriz.some((r) => r.length > 0) ? 'No encuentro la cabecera «Cliente / Serial» en la hoja.' : 'La hoja está vacía.', 'matriz');
  if (preparada.resumen.filasEquipo === 0) throw invalido('La hoja no trae ninguna fila de equipo bajo la cabecera.', 'matriz');
  return { archivo, sha256: b.sha256, hoja, motivo: motivoLimpio(b.motivo), preparada };
}

/** `?desde=&limite=` de GET /trazabilidad/fst022/congelaciones/vigente: filas posteriores a `desde`, de `limite` en `limite`. */
export function parsePaginaFst022(query: Record<string, unknown>): { desde: number; limite: number } {
  const n = (campo: string, defecto: number, min: number, max: number): number => {
    const v = query[campo];
    if (v === undefined) return defecto;
    if (typeof v !== 'string' || !/^\d{1,7}$/.test(v) || Number(v) < min || Number(v) > max) throw invalido(`«${campo}» debe ser un entero entre ${min} y ${max}.`, campo);
    return Number(v);
  };
  return { desde: n('desde', 0, 0, 9_999_999), limite: n('limite', 500, 1, 1000) };
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
  /**
   * Su plazo en días hábiles; null = se puede elegir, pero el servicio queda
   * «sin plazo». En un tipo compuesto es la suma de sus partes, ya calculada.
   */
  dias: number | null;
}

/** Una parte de un tipo compuesto, con el plazo que tiene hoy en Configuración. */
export interface PartePlazo {
  clave: string;
  /** La etiqueta de su fila en Configuración; si no tiene fila, su clave. */
  etiqueta: string;
  /** null = a esta parte le falta el plazo, y por eso el compuesto no tiene. */
  dias: number | null;
}

/** De dónde sale el cliente de un servicio: el inventario (por serial), la cuenta de Desk, el contacto del ticket o su asunto. */
export type OrigenCliente = 'equipo' | 'cuenta' | 'contacto' | 'asunto';

/** Un ticket de Zoho Desk que no está cerrado, con su plazo ya calculado (pestaña «Servicios»). */
export interface ServicioVista {
  numero: number;
  /** Asunto del ticket, tal como viene de Desk. */
  asunto: string;
  /**
   * El cliente, por este orden: el del equipo del inventario con el mismo
   * serial; la cuenta de Desk; el nombre del contacto del ticket; y, a falta de
   * todo, el asunto sin el código de servicio.
   */
  cliente: string;
  /** De cuál de los cuatro sale `cliente`. */
  clienteOrigen: OrigenCliente;
  /** True si `cliente` sale del asunto (`clienteOrigen` = 'asunto'): no es un nombre de cliente fiable. */
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
  /** El rol que su estado de AHORA tiene en Configuración: cuenta, standby (reloj en pausa) o terminado (reloj parado). */
  rolEstado: RolEstado;
  /** True si su estado de ahora es standby: el reloj del plazo está en pausa y la fecha límite se va corriendo. */
  enPausa: boolean;
  /** Días hábiles que lleva en pausa (los que acabó en un estado standby o terminado), desde `medidoDesde`. */
  diasPausados: number;
  /**
   * Esos días en rangos de fechas (ambas incluidas), para pintarlos: todos caen
   * después del ingreso y no más allá de hoy. Entre dos días de un mismo rango
   * no hay ningún día hábil activo (puede haber un fin de semana).
   */
  pausas: RangoFechas[];
  /** El día en que llegó a «trabajo terminado», si lo está ahora: ahí se paró el reloj. Null si sigue en marcha. */
  terminadoEl: string | null;
  /**
   * El día en que el portal apuntó su estado por primera vez. Lo anterior no se
   * puede saber y cuenta como tiempo activo. Null si aún no hay nada apuntado.
   */
  medidoDesde: string | null;
  /** Día de ingreso en Colombia (AAAA-MM-DD). */
  ingreso: string | null;
  /** Plazo configurado para su tipo, en días hábiles (la suma de sus partes si es compuesto); null = sin plazo. */
  plazoDias: number | null;
  /** El día en que cae el último día hábil ACTIVO del plazo: ya corrida por las pausas. Con el trabajo terminado, la que valía el día en que se paró el reloj. */
  fechaLimite: string | null;
  /** La que tendría sin ninguna pausa (ingreso + plazo). Igual que `fechaLimite` si no hay días en pausa. */
  fechaLimiteBase: string | null;
  /**
   * Sólo en un tipo compuesto con plazo: un tramo por parte, en orden, con el
   * día en que acaba cada uno (el último es `fechaLimite`), también corridos
   * por las pausas. Null en los tipos simples y cuando no hay fecha límite.
   */
  tramos: TramoPlazo[] | null;
  /**
   * Días hábiles que quedan; negativo = días hábiles de atraso (sin contar los
   * que pasó en pausa). Con el trabajo terminado, el margen o el atraso con que
   * llegó, ya congelado.
   */
  diasHabiles: number | null;
  /**
   * En marcha: EN_PLAZO / VENCE_HOY / VENCIDO contra la fecha límite ya corrida
   * (que esté en pausa lo dice `enPausa`, no un estado aparte). Con el trabajo
   * terminado: CUMPLIDO / INCUMPLIDO, o TERMINADO si no se vio cuándo llegó.
   * Sin plazo, SIN_PLAZO en los dos casos.
   */
  estadoPlazo: EstadoPlazo;
  /** True si la réplica lleva más de un día sin refrescar el ticket: puede estar ya cerrado. */
  sinConfirmar: boolean;
}

/** Plazo de un tipo de servicio (pestaña «Configuración»). */
export interface PlazoServicio {
  /** El tipo normalizado (`claveTipoServicio`): con ella casan los tickets. */
  clave: string;
  etiqueta: string;
  /** Días hábiles; null = sin plazo. En un tipo compuesto, la suma de sus partes (no se guarda). */
  dias: number | null;
  /**
   * Null en un tipo simple. En un tipo compuesto, sus partes en orden, cada una
   * con su plazo de hoy: `dias` es su suma y no se puede editar (PUT → 400).
   */
  derivadoDe: PartePlazo[] | null;
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

/**
 * El 400 de quien intenta ponerle (o quitarle) plazo a un tipo compuesto: no
 * tiene plazo propio, es la suma de los de sus partes.
 */
export function errorPlazoDerivado(tipo: string): TzError {
  return invalido(`El plazo de «${tipo.trim()}» no se edita: se calcula sumando los plazos de sus partes. Cambia el de cada parte.`, 'tipo');
}

/**
 * Valida el cuerpo de PUT /trazabilidad/plazos. Vacío (null o '') = sin plazo.
 * Un tipo compuesto (`TIPOS_COMPUESTOS`) se rechaza: su plazo es derivado.
 */
export function parsePlazo(body: unknown): CambioPlazo {
  const b = obj(body, 'body');
  const tipo = texto(b.tipo, 'tipo', 80, true)!;
  if (!claveTipoServicio(tipo)) throw invalido('Falta «tipo».', 'tipo');
  if (partesDeTipo(claveTipoServicio(tipo))) throw errorPlazoDerivado(tipo);
  const d = b.dias;
  if (d === null || d === undefined || d === '') return { tipo, dias: null };
  if (typeof d !== 'number' || !Number.isInteger(d) || d < PLAZO_MIN_DIAS || d > PLAZO_MAX_DIAS) {
    throw invalido(`El plazo debe ser un número entero de días hábiles entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o quedar vacío.`, 'dias');
  }
  return { tipo, dias: d };
}

/** Un estado de Zoho Desk y su rol en el reloj del plazo (bloque «Estados de Desk» de «Configuración»). */
export interface EstadoDesk {
  /** El estado normalizado (`claveEstadoDesk`): con ella casan los tickets. */
  clave: string;
  /** Como lo escribe Desk; si ningún ticket lo tiene ya, como se guardó al elegir su rol. */
  etiqueta: string;
  /** El `status_type` que le da Desk ('Open' | 'On Hold' | 'Closed'); null si ningún ticket lo tiene o Desk no lo manda. Sólo orienta. */
  tipoDesk: string | null;
  /** Tickets sin cerrar que están ahora en este estado. */
  ticketsAbiertos: number;
  /** cuenta (el de partida, mientras nadie lo cambie), standby (reloj en pausa) o terminado (reloj parado). */
  rol: RolEstado;
  /** Quién eligió su rol por última vez; null si nadie lo ha tocado. */
  actualizadoPor: string | null;
  actualizadoEn: string | null;
  /** Su categoría en la agenda del taller (y la etapa, si es una etapa activa): la guardada o, sin ella, la de la propuesta; null = sin categoría. */
  categoria: CategoriaAgenda | null;
  etapa: EtapaAgenda | null;
  /** La firma de la CATEGORÍA, aparte de la del rol: quién la guardó (la semilla de la 050 también firma); null si sale de la propuesta o no tiene. */
  categoriaPor: string | null;
  categoriaEn: string | null;
}

export interface CambioEstadoDesk {
  estado: string;
  rol: RolEstado;
}

/** Largo máximo de un estado de Desk, y de su clave (las dos columnas de portal.tmc_estados_desk). */
export const ESTADO_DESK_MAX = 80;

/**
 * Valida el cuerpo de PUT /trazabilidad/estados. Vale cualquier texto de
 * estado: se puede elegir el rol de uno antes de que ningún ticket lo use.
 * `rol` tiene que ser, tal cual, uno de los tres de `ROLES_ESTADO` (ni un
 * booleano, ni otra grafía).
 */
export function parseEstadoDesk(body: unknown): CambioEstadoDesk {
  const b = obj(body, 'body');
  if (typeof b.estado !== 'string') throw invalido(b.estado === null || b.estado === undefined ? 'Falta «estado».' : '«estado» debe ser texto.', 'estado');
  const estado = texto(b.estado, 'estado', ESTADO_DESK_MAX, true)!;
  const clave = claveEstadoDesk(estado);
  if (!clave) throw invalido('Falta «estado».', 'estado');
  // Quitar tildes puede alargar la clave en alfabetos que se descomponen en varias letras.
  if (clave.length > ESTADO_DESK_MAX) throw invalido(`«estado» supera ${ESTADO_DESK_MAX} caracteres.`, 'estado');
  if (!esRolEstado(b.rol)) throw invalido('«rol» debe ser «cuenta», «standby» o «terminado».', 'rol');
  return { estado, rol: b.rol };
}

// ── Agenda del taller: configuración ────────────────────────────────────────
// Estos validadores los llama el repo antes de escribir; el cuerpo de cada
// petición lo leen los `parse…` de más abajo, que se apoyan en ellos.

/** Los puestos de una etapa del taller, con quién los cambió (null = como los sembró la migración 051). */
export interface EtapaAgendaConfig {
  etapa: EtapaAgenda;
  etiqueta: string;
  orden: number;
  puestos: number;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

/** Una fila de duraciones: `tipo` es la clave de un tipo de servicio o «*», la de por defecto de la etapa. */
export interface DuracionAgendaConfig extends DuracionEtapa {
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

export interface ConfigAgenda {
  etapas: EtapaAgendaConfig[];
  duraciones: DuracionAgendaConfig[];
}

/** Lo que devuelve GET /trazabilidad/agenda/configuracion: en `estados`, `ticketsAbiertos` son los de la FUENTE de la agenda. */
export interface ConfiguracionAgenda extends ConfigAgenda {
  estados: EstadoDesk[];
  /** Los tipos de servicio que traen los tickets abiertos de esa misma fuente (`tiposDeTickets`): sólo tipos y recuentos. */
  tiposAbiertos: TipoAbierto[];
}

export interface CambioCategoriaEstado {
  estado: string;
  categoria: CategoriaAgenda;
  /** Obligatoria si la categoría es «activa»; null en las demás. */
  etapa: EtapaAgenda | null;
}

export interface CambioPuestosEtapa {
  etapa: EtapaAgenda;
  puestos: number;
}

export interface CambioDuracionEtapa {
  etapa: EtapaAgenda;
  /** Un tipo de servicio (casa por su clave) o «*». */
  tipo: string;
  /** null = quitar la fila de ese tipo (vuelve a valer la «*»). La «*» no se quita. */
  dias: number | null;
}

const lista = (valores: readonly string[]) => valores.map((v) => `«${v}»`).join(', ');
const etapaValida = (etapa: unknown): void => {
  if (!esEtapaAgenda(etapa)) throw invalido(`«etapa» debe ser una de: ${lista(ETAPAS_AGENDA)}.`, 'etapa');
};

/** La categoría (y la etapa) que se le elige a un estado: categoría de la lista, y etapa sólo —y siempre— en una etapa activa. */
export function validarCategoriaEstado(c: CambioCategoriaEstado): CambioCategoriaEstado {
  const clave = claveEstadoDesk(c.estado);
  if (!clave) throw invalido('Falta «estado».', 'estado');
  if (clave.length > ESTADO_DESK_MAX || c.estado.trim().length > ESTADO_DESK_MAX) throw invalido(`«estado» supera ${ESTADO_DESK_MAX} caracteres.`, 'estado');
  if (!esCategoriaAgenda(c.categoria)) throw invalido(`«categoria» debe ser una de: ${lista(CATEGORIAS_AGENDA)}.`, 'categoria');
  const etapa = c.etapa ?? null;
  if (etapa !== null) etapaValida(etapa);
  if (!categoriaCoherente(c.categoria, etapa)) {
    throw invalido(etapa === null ? 'Una etapa activa necesita su etapa.' : 'Sólo una etapa activa lleva etapa.', 'etapa');
  }
  return { estado: c.estado, categoria: c.categoria, etapa };
}

export function validarPuestosEtapa(c: CambioPuestosEtapa): CambioPuestosEtapa {
  etapaValida(c.etapa);
  if (!Number.isInteger(c.puestos) || c.puestos < 0 || c.puestos > PUESTOS_MAX) {
    throw invalido(`Los puestos deben ser un número entero entre 0 y ${PUESTOS_MAX}.`, 'puestos');
  }
  return { etapa: c.etapa, puestos: c.puestos };
}

/** Devuelve el cambio con el tipo ya como clave («*» tal cual). */
export function validarDuracionEtapa(c: CambioDuracionEtapa): CambioDuracionEtapa {
  etapaValida(c.etapa);
  const tipo = String(c.tipo ?? '').trim() === TIPO_POR_DEFECTO ? TIPO_POR_DEFECTO : claveTipoServicio(c.tipo);
  if (!tipo) throw invalido('Falta «tipo».', 'tipo');
  if (tipo.length > 80) throw invalido('«tipo» supera 80 caracteres.', 'tipo');
  if (c.dias === null) {
    if (tipo === TIPO_POR_DEFECTO) throw invalido('La duración por defecto de una etapa no se puede quitar: cámbiale los días.', 'dias');
    return { etapa: c.etapa, tipo, dias: null };
  }
  if (!Number.isInteger(c.dias) || c.dias < PLAZO_MIN_DIAS || c.dias > PLAZO_MAX_DIAS) {
    throw invalido(`La duración debe ser un número entero de días hábiles entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}.`, 'dias');
  }
  return { etapa: c.etapa, tipo, dias: c.dias };
}

// ── Agenda del taller: asignaciones, reparto inicial y flujo a mano (lote 4) ──

/** De dónde sale una asignación: de la fila, una a una, o del reparto inicial (D6). */
export const ORIGENES_ASIGNACION = ['fila', 'arranque'] as const;
/** Cómo se cierra: sola, al salir el ticket de la etapa; liberada a mano (D7); o reemplazada por un reparto. */
export const CIERRES_ASIGNACION = ['estado', 'manual', 'reparto'] as const;
/** Tope del motivo de una asignación o de una liberación. */
export const MOTIVO_MAX = 500;

/** Un ticket a un puesto de una etapa. En el reparto inicial no lleva motivo. */
export interface LineaReparto {
  numero: number;
  etapa: EtapaAgenda;
  puesto: number;
}

export interface NuevaAsignacion extends LineaReparto {
  /** Obligatorio si el ticket no es el primero de la fila. */
  motivo?: string | null;
}

export interface Liberacion {
  numero: number;
  motivo: string;
}

export function validarNumeroTicket(numero: unknown): number {
  if (typeof numero !== 'number' || !Number.isInteger(numero) || numero <= 0) throw invalido('El número de ticket debe ser un entero positivo.', 'numero');
  return numero;
}

/** El motivo sin espacios sobrantes; vacío o ausente → null. */
function motivoLimpio(motivo: unknown): string | null {
  if (motivo !== null && motivo !== undefined && typeof motivo !== 'string') throw invalido('«motivo» debe ser un texto.', 'motivo');
  const m = (motivo ?? '').trim();
  if (m.length > MOTIVO_MAX) throw invalido(`«motivo» supera ${MOTIVO_MAX} caracteres.`, 'motivo');
  return m === '' ? null : m;
}

function validarLinea(c: LineaReparto): LineaReparto {
  const numero = validarNumeroTicket(c?.numero);
  etapaValida(c.etapa);
  if (!Number.isInteger(c.puesto) || c.puesto < 1 || c.puesto > PUESTOS_MAX) throw invalido(`El puesto debe ser un número entero entre 1 y ${PUESTOS_MAX}.`, 'puesto');
  return { numero, etapa: c.etapa, puesto: c.puesto };
}

export function validarAsignacion(c: NuevaAsignacion): LineaReparto & { motivo: string | null } {
  return { ...validarLinea(c), motivo: motivoLimpio(c.motivo) };
}

/** Las líneas de un reparto: cada ticket y cada puesto, una sola vez. */
export function validarReparto(lineas: unknown): LineaReparto[] {
  if (!Array.isArray(lineas)) throw invalido('«reparto» debe ser una lista de asignaciones.', 'reparto');
  const out = lineas.map((l) => validarLinea(l as LineaReparto));
  const repetido = (claves: (number | string)[]) => new Set(claves).size !== claves.length;
  if (repetido(out.map((l) => l.numero))) throw invalido('El reparto nombra dos veces el mismo ticket.', 'reparto');
  if (repetido(out.map((l) => `${l.etapa}/${l.puesto}`))) throw invalido('El reparto da el mismo puesto a dos tickets.', 'reparto');
  return out;
}

export function validarLiberacion(c: Liberacion): Liberacion {
  const numero = validarNumeroTicket(c?.numero);
  const motivo = motivoLimpio(c.motivo);
  if (motivo === null) throw invalido('Para liberar un puesto a mano hay que decir el motivo.', 'motivo');
  return { numero, motivo };
}

/** El flujo que se marca a mano; null = quitar la marca. */
export function validarFlujoManual(flujo: unknown): FlujoAgenda | null {
  if (flujo === null) return null;
  if (!FLUJOS_AGENDA.includes(flujo as FlujoAgenda)) throw invalido(`«flujo» debe ser uno de: ${lista(FLUJOS_AGENDA)}; o vacío para quitar la marca.`, 'flujo');
  return flujo as FlujoAgenda;
}

// ── Agenda del taller: el cuerpo de cada petición (lote 5) ──────────────────
// Lo que llega por HTTP no tiene tipo: aquí se comprueba que el cuerpo es un
// objeto y que cada campo es del tipo que toca antes de pasarlo al validador.

const textoDe = (v: unknown, field: string): string => {
  if (typeof v !== 'string') throw invalido(v === null || v === undefined ? `Falta «${field}».` : `«${field}» debe ser texto.`, field);
  return v;
};

/** POST /agenda/asignaciones: {numero, etapa, puesto, motivo?}. */
export function parseAsignacion(body: unknown): LineaReparto & { motivo: string | null } {
  return validarAsignacion(obj(body, 'body') as unknown as NuevaAsignacion);
}

/** POST /agenda/reparto: {reparto: [{numero, etapa, puesto}]}. */
export function parseReparto(body: unknown): LineaReparto[] {
  return validarReparto(obj(body, 'body').reparto);
}

/** POST /agenda/liberar: {numero, motivo}. Se libera por número de ticket (D18). */
export function parseLiberacion(body: unknown): Liberacion {
  return validarLiberacion(obj(body, 'body') as unknown as Liberacion);
}

/** PUT /agenda/flujo/:numero: {flujo}; null (o vacío) quita la marca. */
export function parseFlujoManual(body: unknown): FlujoAgenda | null {
  const { flujo } = obj(body, 'body');
  return validarFlujoManual(flujo === '' ? null : flujo);
}

/** PUT /agenda/configuracion/puestos: {etapa, puestos}. */
export function parsePuestosEtapa(body: unknown): CambioPuestosEtapa {
  return validarPuestosEtapa(obj(body, 'body') as unknown as CambioPuestosEtapa);
}

/** PUT /agenda/configuracion/duraciones: {etapa, tipo, dias}; `dias: null`, dicho así, quita la fila del tipo. */
export function parseDuracionEtapa(body: unknown): CambioDuracionEtapa {
  const b = obj(body, 'body');
  etapaValida(b.etapa);
  const tipo = textoDe(b.tipo, 'tipo');
  if (b.dias !== null && typeof b.dias !== 'number') throw invalido(`La duración debe ser un número entero de días hábiles entre ${PLAZO_MIN_DIAS} y ${PLAZO_MAX_DIAS}, o null para quitarla.`, 'dias');
  return validarDuracionEtapa({ etapa: b.etapa as EtapaAgenda, tipo, dias: b.dias });
}

/** PUT /agenda/configuracion/estados: {estado, categoria, etapa?}. Sólo la categoría: el rol del reloj no viaja aquí. */
export function parseCategoriaEstado(body: unknown): CambioCategoriaEstado {
  const b = obj(body, 'body');
  return validarCategoriaEstado({ estado: textoDe(b.estado, 'estado'), categoria: b.categoria as CategoriaAgenda, etapa: (b.etapa ?? null) as EtapaAgenda | null });
}

/** GET /agenda/huecos?etapa=&tipo=: la etapa es obligatoria; el tipo, opcional (sin él vale la «*»). */
export function parseHuecos(query: Record<string, unknown>): { etapa: EtapaAgenda; tipo: string | null } {
  etapaValida(query.etapa);
  if (query.tipo !== undefined && typeof query.tipo !== 'string') throw invalido('«tipo» debe ser un solo texto.', 'tipo');
  const tipo = String(query.tipo ?? '').trim();
  if (tipo.length > 80) throw invalido('«tipo» supera 80 caracteres.', 'tipo');
  return { etapa: query.etapa as EtapaAgenda, tipo: tipo === '' ? null : tipo };
}

/** El contacto que se le pone a mano a un cliente; `emails` vacío = quitarlo (vuelve a valer el de Desk). */
export interface CambioContacto {
  cliente: string;
  /** En minúsculas y sin repetir. */
  emails: string[];
  nombre: string;
}

/**
 * Valida el cuerpo de PUT /trazabilidad/contactos. `emails` es una lista de
 * entre cero y `CONTACTO_MAX_EMAILS` correos distintos (se pasan a minúsculas
 * y se quitan los repetidos antes de contar); vacía = quitar el contacto
 * puesto a mano. Aquí SÍ vale un correo de un dominio propio: quien lo pone
 * puede querer probar con su buzón (la respuesta lo señala como interno).
 */
export function parseContacto(body: unknown): CambioContacto {
  const b = obj(body, 'body');
  if (typeof b.cliente !== 'string') throw invalido(b.cliente === null || b.cliente === undefined ? 'Falta «cliente».' : '«cliente» debe ser texto.', 'cliente');
  const cliente = texto(b.cliente, 'cliente', CONTACTO_MAX_TEXTO, true)!;
  const clave = claveCliente(cliente);
  if (!clave) throw invalido('Falta «cliente».', 'cliente');
  if (clave.length > CONTACTO_MAX_TEXTO) throw invalido(`«cliente» supera ${CONTACTO_MAX_TEXTO} caracteres.`, 'cliente');
  if (!Array.isArray(b.emails)) throw invalido('«emails» debe ser una lista de correos (vacía para quitar el contacto).', 'emails');
  if (b.emails.length > 50) throw invalido(`Como mucho ${CONTACTO_MAX_EMAILS} correos por cliente.`, 'emails');
  const emails: string[] = [];
  b.emails.forEach((v, i) => {
    const e = normalizarEmail(v);
    if (e.length > EMAIL_MAX) throw invalido(`El correo n.º ${i + 1} supera ${EMAIL_MAX} caracteres.`, `emails[${i}]`);
    if (!esEmail(e)) throw invalido(`El correo n.º ${i + 1} no es una dirección válida.`, `emails[${i}]`);
    if (!emails.includes(e)) emails.push(e);
  });
  if (emails.length > CONTACTO_MAX_EMAILS) throw invalido(`Como mucho ${CONTACTO_MAX_EMAILS} correos por cliente.`, 'emails');
  const n = b.nombre;
  if (n !== undefined && n !== null && typeof n !== 'string') throw invalido('«nombre» debe ser texto.', 'nombre');
  const nombre = (texto(n, 'nombre', CONTACTO_MAX_TEXTO, false) ?? '').replace(/\s+/g, ' ');
  return { cliente: cliente.replace(/\s+/g, ' '), emails, nombre };
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

// ── Roles de la app ─────────────────────────────────────────────────────────

/** Lo que devuelve GET /trazabilidad/roles/me: con `permissions` decide la app qué enseña y qué desactiva. */
export interface MiRol {
  userId: string;
  email: string;
  /** El rol guardado, o LECTOR si no tiene fila. */
  role: RolApp;
  /** Administrador del portal: tiene todos los permisos, tenga el rol que tenga. */
  admin: boolean;
  permissions: Permiso[];
  /** Si puede repartir roles (sólo los administradores del portal). */
  canManageRoles: boolean;
}

/** Una fila de la sección «Roles». */
export interface UsuarioRol {
  userId: string;
  fullName: string;
  email: string;
  /** El estado del usuario en el portal (`active`, `pending`, `inactive`). */
  status: string;
  /** Administrador del portal: lo puede todo, tenga el rol que tenga. */
  admin: boolean;
  role: RolApp;
}

/** El id de usuario de la ruta PUT /trazabilidad/roles/:userId: un UUID. */
export function parseUserId(v: unknown): string {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw invalido('El usuario no es válido.', 'userId');
  }
  return v.toLowerCase();
}

/** Valida el cuerpo de PUT /trazabilidad/roles/:userId: `{role}`, uno de los cuatro de la matriz, tal cual. */
export function parseRolApp(body: unknown): { role: RolApp } {
  const b = obj(body, 'body');
  if (!esRolApp(b.role)) throw invalido(`El rol no es válido. Opciones: ${ROLES_APP.join(', ')}.`, 'role');
  return { role: b.role };
}
