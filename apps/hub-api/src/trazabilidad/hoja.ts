/**
 * La tabla de la pestaña «Trazabilidad F-ST-022» (lote 9d-1): la hoja
 * congelada tal como la entiende HOY el portal. Regla pura: sin base, sin
 * reloj (`hoy` llega como argumento) y de SÓLO LECTURA; la app lee de aquí los
 * tipos. La edición (corregir fechas, revisar marcas, retirar equipos) es del 9d-2.
 *
 * Una fila por fila de equipo de la congelación vigente, en el orden de la hoja:
 *  - Cliente, marca, modelo y serial: los del inventario (`tmc_equipos`) si la
 *    fila es de un equipo suyo —por la `clave_equipo` de la congelada y, si no,
 *    por un serial que no se repita ni en la hoja ni en el inventario—; lo que
 *    difiera de la hoja va además en `enHoja`. Si no, los de la hoja tal cual.
 *  - Última calibración: para un equipo del inventario, la MISMA que enseña
 *    «Equipos» (`fechaEfectiva`); para una fila sólo de la hoja, su fecha como
 *    punto de partida más las calibraciones guardadas sin equipo de ese serial
 *    (otras marcas), con la misma regla (`calibracionQueCuenta`).
 *  - Vigencia y estado: recalculados a hoy (`estadoCalibracion`). El número de
 *    «Vigencia» que quedó congelado dependía del día y no se enseña.
 * Aparte, los equipos del inventario que no casan con ninguna fila.
 *
 * Lote 9d-2a: `tmc_equipos` lleva también las demás marcas, enlazadas con Desk
 * 2.0 pero FUERA de seguimiento (058). Una fila de uno de ésos enseña cliente,
 * marca, modelo y serial del maestro (situación `enlazado`), pero su fecha
 * sale IGUAL que cuando sólo estaba en la hoja —la hoja como punto de partida
 * más las calibraciones de su serial—: enlazarla no le mueve la fecha.
 */
import { FECHA_MINIMA_CALIBRACION, calibracionQueCuenta, fechaEfectiva, type EstadoFilaCalibracion, type FilaCalibracion, type OrigenCalibracion } from './calibraciones.js';
import { ESTADOS, claveCliente, esFechaIso, estadoCalibracion, serialNorm, type EstadoCalibracion, type EstadoEquipo } from './dominio.js';
import type { Celda, FilaCongelada } from './fst022.js';

/** Lo que conviene mirar de una fila, en el orden en que se enseña (su texto, en la app: `src/lib/hoja.ts`). */
export const AVISOS_HOJA = ['sin_serial', 'serial_repetido', 'serial_numerico', 'sin_fecha', 'en_revision', 'calibraciones_sin_atribuir', 'marca_distinta', 'modelo_distinto'] as const;
export type AvisoHoja = (typeof AVISOS_HOJA)[number];
/** En el inventario en seguimiento (activo), en él pero inactivo, enlazado con Desk 2.0 fuera de seguimiento (otras marcas), o sólo en la hoja. */
export type SituacionHoja = 'inventario' | 'inactivo' | 'enlazado' | 'hoja';

/** Un equipo de `tmc_equipos` (activo o no), con su fecha de respaldo. `enSeguimiento: false` = otra marca, fuera de seguimiento; si falta, en seguimiento. */
export interface EquipoHoja { clave: string; serial: string; cliente: string; marca: string; modelo: string; activo: boolean; ultimaCalibracion: string | null; enSeguimiento?: boolean }
/** Una calibración conocida de la fila. `cuenta` = es la que da su «última calibración». La de origen `fst022` de una fila sólo de la hoja es su propia fecha. */
export interface CalibracionHoja { fecha: string; origen: OrigenCalibracion; ticket: number | null; corrigeTicket: number | null; estado: EstadoFilaCalibracion; cuenta: boolean }
/** Lo que decía la hoja, sólo de lo que hoy es distinto. */
export interface EnHoja { cliente?: string; marca?: string; modelo?: string; serial?: string; ultimaCalibracion?: string | null }

export interface FilaHoja extends EstadoEquipo {
  /** Número de fila en la Excel congelada; null en un equipo que no está en la hoja. */
  fila: number | null;
  /** Su equipo en el inventario (`tmc_equipos.clave`), o null. */
  clave: string | null;
  situacion: SituacionHoja;
  cliente: string;
  marca: string;
  /** La marca normalizada, sólo para agrupar y filtrar («HORIBA» y «Horiba» son la misma). */
  marcaClave: string;
  modelo: string;
  serial: string;
  enHoja: EnHoja;
  ultimaCalibracion: string | null;
  avisos: AvisoHoja[];
  /** La más reciente primero. Si ninguna cuenta y hay fecha, es la de respaldo del inventario. */
  calibraciones: CalibracionHoja[];
}

export interface ResumenHoja {
  total: number;
  /** Filas que son de un equipo del inventario (de ellas, `inactivos`) y filas que sólo están en la hoja. */
  enInventario: number;
  inactivos: number;
  soloHoja: number;
  conAvisos: number;
  /** Equipos del inventario que no casan con ninguna fila. */
  fueraDeHoja: number;
  /** Calibraciones guardadas sin equipo (sin anular) que no son de ninguna fila: su serial no está en la hoja, o está repetido. */
  calibracionesSueltas: number;
  /** De más a menos filas; `marca` es la forma más escrita de esa marca. */
  porMarca: { clave: string; marca: string; total: number }[];
  porEstado: Record<EstadoCalibracion, number>;
}

export interface EntradaHoja { hoy: string; cabeceras: readonly Celda[][]; filas: readonly FilaCongelada[]; equipos: readonly EquipoHoja[]; calibraciones: readonly FilaCalibracion[] }
export interface TablaHoja { filas: FilaHoja[]; fueraDeHoja: FilaHoja[]; resumen: ResumenHoja }

/** GET /trazabilidad/hoja. Sin congelación vigente, `congelacion` es null, `motivo` dice por qué y la tabla va vacía. */
export interface RespuestaHoja extends TablaHoja {
  hoy: string;
  congelacion: { id: number; archivo: string; hoja: string; por: string; en: string } | null;
  motivo: string | null;
}

const valor = (c: Celda | undefined): unknown => (c !== null && typeof c === 'object' ? c.v : c);

/** Una celda como texto: un número, entero y sin notación científica (Excel guarda como número un serial hecho sólo de cifras). */
export function textoCelda(c: Celda | undefined): string {
  const v = valor(c);
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(v).toString() : String(v);
  return v === null || v === undefined ? '' : String(v).trim();
}

function agrupar<T>(items: readonly T[], clave: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of items) {
    const k = clave(t);
    if (k) m.set(k, [...(m.get(k) ?? []), t]);
  }
  return m;
}

/** La forma más escrita de cada grupo (a igualdad, la primera): quien escribe otra, desentona. */
function formaComun(filas: readonly FilaHoja[], grupo: (f: FilaHoja) => string, texto: (f: FilaHoja) => string): Map<string, string> {
  const veces = new Map<string, Map<string, number>>();
  for (const f of filas) {
    const m = veces.get(grupo(f)) ?? new Map<string, number>();
    veces.set(grupo(f), m.set(texto(f), (m.get(texto(f)) ?? 0) + 1));
  }
  return new Map([...veces].map(([g, m]) => [g, [...m].reduce((a, b) => (b[1] > a[1] ? b : a))[0]]));
}

const CAMPOS = ['cliente', 'marca', 'modelo', 'serial'] as const;
/** Una marca o un modelo sin lo que no lo distingue: mayúsculas, tildes, espacios, guiones y puntos («APNA 370» = «APNA-370»). */
const sinRuido = (v: string): string => claveCliente(v).replace(/[\s\-_./]/g, '');
const claveModelo = (f: FilaHoja): string => `${f.marcaClave}|${sinRuido(f.modelo)}`;

export function tablaHoja(e: EntradaHoja): TablaHoja {
  const { hoy } = e;
  const titulos = (e.cabeceras.at(-1) ?? []).map((t) => claveCliente(valor(t)));
  const celda = (f: FilaCongelada, titulo: string): Celda | undefined => f.celdas[titulos.indexOf(titulo)];
  const hoja = e.filas.filter((f) => f.esEquipo).sort((a, b) => a.fila - b.fila);
  const hojaPorSerial = agrupar(hoja, (f) => f.serialNorm);
  const repetido = (f: FilaCongelada): boolean => f.serialNorm !== null && (hojaPorSerial.get(f.serialNorm)?.length ?? 0) > 1;

  // Enlace con el inventario: primero por la clave de la congelada; después, por un serial sin ambigüedad. Un equipo, en una fila como mucho.
  const porClave = new Map(e.equipos.map((q) => [q.clave, q]));
  const porSerial = agrupar(e.equipos, (q) => serialNorm(q.serial));
  const equipoDe = new Map<number, EquipoHoja>();
  const enlazados = new Set<string>();
  const enlazar = (f: FilaCongelada, q: EquipoHoja | undefined): void => {
    if (!q || equipoDe.has(f.fila) || enlazados.has(q.clave)) return;
    equipoDe.set(f.fila, q);
    enlazados.add(q.clave);
  };
  for (const f of hoja) enlazar(f, f.claveEquipo ? porClave.get(f.claveEquipo) : undefined);
  for (const f of hoja) {
    const candidatos = f.serialNorm && !repetido(f) ? (porSerial.get(f.serialNorm) ?? []) : [];
    if (candidatos.length === 1) enlazar(f, candidatos[0]);
  }

  const deEquipo = agrupar(e.calibraciones, (c) => c.clave);
  const sinEquipo = agrupar(e.calibraciones.filter((c) => c.clave === null), (c) => serialNorm(c.serial));
  const atribuidas = new Set<number>();

  const armar = (f: FilaCongelada | null, q: EquipoHoja | undefined): FilaHoja => {
    const deHoja = { cliente: f ? textoCelda(celda(f, 'cliente')) : '', marca: f ? textoCelda(celda(f, 'marca')) : '', modelo: f ? textoCelda(celda(f, 'modelo')) : '', serial: f ? textoCelda(celda(f, 'serial')) : '' };
    const enCelda = f ? valor(celda(f, 'ultima calibracion')) : null;
    const fechaHoja = esFechaIso(enCelda) ? enCelda : null;
    const actual = q ?? deHoja;
    /** Enlazado con Desk 2.0, fuera de seguimiento: sus datos son del maestro, pero su fecha se calcula como la de una fila sólo de la hoja. */
    const fuera = q?.enSeguimiento === false;
    // Las calibraciones de la fila: las del equipo en seguimiento o, si no lo es, su fecha de la hoja como punto de partida y las guardadas sin equipo de su serial.
    let conocidas: FilaCalibracion[];
    if (q && !fuera) conocidas = deEquipo.get(q.clave) ?? [];
    else {
      // El serial por el que se le atribuyen: el de su fila si no se repite en la hoja; sin fila, el suyo si la hoja no lo tiene.
      const serie = f ? (repetido(f) ? null : f.serialNorm) : q && !hojaPorSerial.has(serialNorm(q.serial)) ? serialNorm(q.serial) : null;
      const sueltas = serie ? (sinEquipo.get(serie) ?? []) : [];
      for (const c of sueltas) atribuidas.add(c.id);
      const propias = q ? (deEquipo.get(q.clave) ?? []) : [];
      const revision = fechaHoja !== null && (fechaHoja > hoy || fechaHoja < FECHA_MINIMA_CALIBRACION);
      const partida: FilaCalibracion[] = f && fechaHoja && !propias.some((c) => c.origen === 'fst022') ? [{ id: -f.fila, clave: null, serial: deHoja.serial, deskEquipoId: null, fecha: fechaHoja, origen: 'fst022', ticket: null, estado: revision ? 'en_revision' : 'vigente', corrigeTicket: null, corrigeFecha: null, anuladaAMano: false }] : [];
      conocidas = [...partida, ...propias, ...sueltas];
    }
    const cuenta = calibracionQueCuenta(conocidas, hoy);
    const ultima = q && !fuera ? fechaEfectiva(conocidas, q.ultimaCalibracion, hoy) : (cuenta?.fecha ?? null);
    const enHoja: EnHoja = {};
    // Lo que hoy es distinto de la hoja. En un equipo en seguimiento, literal (como siempre); en uno fuera, la marca y el modelo sin el ruido de cómo se escriben.
    const distinto = (k: (typeof CAMPOS)[number], hoyVale: string, enLaHoja: string): boolean => hoyVale !== enLaHoja && !(fuera && (k === 'marca' || k === 'modelo') && sinRuido(hoyVale) === sinRuido(enLaHoja));
    if (f && q) for (const k of CAMPOS) if (distinto(k, q[k], deHoja[k])) enHoja[k] = deHoja[k];
    if (f && ultima !== fechaHoja) enHoja.ultimaCalibracion = fechaHoja;
    const avisos = new Set<AvisoHoja>();
    if (actual.serial === '') avisos.add('sin_serial');
    if (f && repetido(f)) avisos.add('serial_repetido');
    if (f && typeof valor(celda(f, 'serial')) === 'number') avisos.add('serial_numerico');
    if (ultima === null) avisos.add('sin_fecha');
    if (conocidas.some((c) => c.estado === 'en_revision')) avisos.add('en_revision');
    if (f && !q && repetido(f) && sinEquipo.has(f.serialNorm ?? '')) avisos.add('calibraciones_sin_atribuir');
    return {
      fila: f?.fila ?? null, clave: q?.clave ?? null, situacion: !q ? 'hoja' : fuera ? 'enlazado' : q.activo ? 'inventario' : 'inactivo',
      cliente: actual.cliente, marca: actual.marca, marcaClave: claveCliente(actual.marca), modelo: actual.modelo, serial: actual.serial, enHoja,
      ultimaCalibracion: ultima, ...estadoCalibracion(ultima, hoy), avisos: [...avisos],
      calibraciones: conocidas.map((c) => ({ fecha: c.fecha, origen: c.origen, ticket: c.ticket, corrigeTicket: c.corrigeTicket, estado: c.estado, cuenta: c === cuenta })).sort((a, b) => b.fecha.localeCompare(a.fecha)),
    };
  };

  const filas = hoja.map((f) => armar(f, equipoDe.get(f.fila)));
  const fueraDeHoja = e.equipos.filter((q) => !enlazados.has(q.clave)).sort((a, b) => a.cliente.localeCompare(b.cliente, 'es') || a.serial.localeCompare(b.serial)).map((q) => armar(null, q));

  // Marca y modelo escritos de otra forma que el resto de su grupo: se enseña lo que hay, y se avisa.
  const marcas = formaComun(filas, (f) => f.marcaClave, (f) => f.marca);
  const modelos = formaComun(filas, claveModelo, (f) => f.modelo);
  for (const f of filas) {
    if (f.marca !== marcas.get(f.marcaClave)) f.avisos.push('marca_distinta');
    if (f.modelo !== modelos.get(claveModelo(f))) f.avisos.push('modelo_distinto');
  }

  const cuantas = (situaciones: SituacionHoja[]): number => filas.filter((f) => situaciones.includes(f.situacion)).length;
  const porEstado = Object.fromEntries(ESTADOS.map((s) => [s, filas.filter((f) => f.estado === s).length])) as Record<EstadoCalibracion, number>;
  const porMarca = [...marcas].map(([clave, marca]) => ({ clave, marca, total: filas.filter((f) => f.marcaClave === clave).length })).sort((a, b) => b.total - a.total || a.clave.localeCompare(b.clave));
  const resumen: ResumenHoja = {
    total: filas.length, enInventario: cuantas(['inventario', 'inactivo']), inactivos: cuantas(['inactivo']), soloHoja: cuantas(['hoja']), conAvisos: filas.filter((f) => f.avisos.length > 0).length, fueraDeHoja: fueraDeHoja.length,
    calibracionesSueltas: e.calibraciones.filter((c) => c.clave === null && c.estado !== 'anulada' && !atribuidas.has(c.id)).length, porMarca, porEstado,
  };
  return { filas, fueraDeHoja, resumen };
}
