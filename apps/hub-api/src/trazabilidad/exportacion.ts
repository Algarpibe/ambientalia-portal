/**
 * Exportar la F-ST-022 (lote 9e): de la tabla de la pestaña «Trazabilidad
 * F-ST-022» a un libro .xlsx en memoria. Generador PURO: sin base, sin red y
 * sin reloj (el instante de la exportación llega como argumento). No calcula
 * nada de la hoja: recibe la respuesta de GET /hoja ya hecha (hoja.ts) y sólo
 * la escribe, así que lo exportado y lo que se ve en la pestaña coinciden.
 *
 * Decisión de Alfonso (09/10/2026): «la misma información en las mismas
 * columnas», sin calco visual. Lo demás son valores POR DEFECTO, revisables, y
 * cada uno se cambia en un solo sitio de este fichero:
 *  - las columnas de la principal, sus títulos y su orden: COLUMNAS_FST022;
 *  - qué filas salen y en qué orden: `filasExportadas`;
 *  - la vigencia «viva» (fórmula con su valor en caché): FORMULA_VIGENCIA y la
 *    celda que la usa (quitarle la fórmula la deja en el número del día);
 *  - las hojas de más y lo que llevan: HOJAS_LIBRO y sus tres funciones;
 *  - el nombre del fichero: `nombreFichero`.
 *
 * SheetJS (la edición que hay) no escribe estilos ni colores: no se intenta.
 * TODO texto va como celda de texto, escrita a mano (nunca se arma una celda a
 * partir de una cadena): un cliente o un motivo que empiece por «=», «+», «-»
 * o «@» no puede salir como fórmula, y un serial hecho de cifras no pierde
 * ceros ni acaba en notación científica. La única fórmula es la de la vigencia.
 */
import * as XLSX from 'xlsx';
import { ESTADOS, ETIQUETA_ESTADO } from './dominio.js';
import type { FilaHoja, RespuestaHoja } from './hoja.js';

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Las hojas del libro, en su orden. La principal se llama como la de la F-ST-022. */
export const HOJAS_LIBRO = ['Trazabilidad', 'Retirados', 'Detalle', 'Notas'] as const;
export const TITULO_LIBRO = 'F-ST-022 · Trazabilidad Mttos Clientes';
/** Como en la hoja: título en las filas 1 a 3, cabecera en la 5 y los equipos desde la 6. */
export const FILA_CABECERA = 5;
/** El día es el de los valores (hoy en Colombia). */
export const nombreFichero = (hoy: string): string => `F-ST-022 Trazabilidad Mttos Clientes ${hoy}.xlsx`;
/** La de la hoja: (última calibración − HOY) + 365. La fecha está en la columna E. Excel la recalcula al abrir el libro. */
export const FORMULA_VIGENCIA = (fila: number): string => `E${fila}-TODAY()+365`;

/** Lo que va en una casilla: un texto (siempre celda de texto), un número, nada, o una celda ya hecha (una fecha, la vigencia). */
type Valor = string | number | null | XLSX.CellObject;

const EPOCA_EXCEL = Date.UTC(1899, 11, 30);
/**
 * AAAA-MM-DD → celda de FECHA de Excel: el número de días desde su época, entero y calculado sobre UTC, con formato de fecha.
 * No lleva hora ni zona: es ese día se abra donde se abra.
 */
function fecha(iso: string | null): Valor {
  if (iso === null) return null;
  const [a, m, d] = iso.split('-').map(Number);
  return { t: 'n', v: Math.round((Date.UTC(a, m - 1, d) - EPOCA_EXCEL) / 86_400_000), z: 'dd/mm/yyyy' };
}

/** Las seis columnas de la V3, con sus títulos y en su orden, y de dónde sale cada valor (ÚNICO sitio). `fila` = la de Excel donde cae. */
export const COLUMNAS_FST022: readonly { titulo: string; ancho: number; celda: (x: FilaHoja, fila: number) => Valor }[] = [
  { titulo: 'Cliente', ancho: 46, celda: (x) => x.cliente },
  { titulo: 'Marca', ancho: 16, celda: (x) => x.marca },
  { titulo: 'Modelo', ancho: 18, celda: (x) => x.modelo },
  { titulo: 'Serial', ancho: 22, celda: (x) => x.serial },
  { titulo: 'Última Calibración', ancho: 18, celda: (x) => fecha(x.ultimaCalibracion) },
  // Sin fecha no hay vigencia: la celda va vacía (una fórmula sobre una fecha vacía daría un número absurdo).
  { titulo: 'Vigencia de Calibración (Dias)', ancho: 16, celda: (x, fila) => (x.vigenciaDias === null ? null : { t: 'n', v: x.vigenciaDias, z: '0', f: FORMULA_VIGENCIA(fila) }) },
];

/** Las filas de la principal: primero las de la hoja congelada, en su orden; después, lo que está en el inventario o en Desk 2.0 y no en la hoja. Lo retirado a mano no sale (va en su hoja). */
export function filasExportadas(tabla: Pick<RespuestaHoja, 'filas' | 'fueraDeHoja'>): FilaHoja[] {
  return [...tabla.filas, ...tabla.fueraDeHoja].filter((x) => x.retirado === null);
}

/** De dónde sale la última calibración de una fila. */
export const ORIGENES_FECHA = {
  fst022: { etiqueta: 'Hoja F-ST-022', significa: 'La fecha que traía la hoja congelada: el punto de partida firmado.' },
  desk: { etiqueta: 'Ticket de Desk 2.0', significa: 'El campo «Fecha de Calibración» de un ticket de Zoho, traído de Desk 2.0.' },
  manual: { etiqueta: 'Manual', significa: 'Registrada a mano en el portal, con su motivo y su firma; puede corregir la fecha de un ticket.' },
  inventario: { etiqueta: 'Inventario del portal', significa: 'El equipo no tiene ninguna calibración guardada: vale la fecha de respaldo del inventario.' },
  sin_fecha: { etiqueta: 'Sin fecha', significa: 'No se conoce ninguna calibración que cuente: la fecha y la vigencia van vacías.' },
} as const;
export type OrigenFecha = keyof typeof ORIGENES_FECHA;

export function origenDeFecha(x: Pick<FilaHoja, 'calibraciones' | 'ultimaCalibracion'>): OrigenFecha {
  return x.calibraciones.find((c) => c.cuenta)?.origen ?? (x.ultimaCalibracion ? 'inventario' : 'sin_fecha');
}

const INSTANTE = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?\s*(Z|[+-]\d\d(?::?\d\d)?)$/i;
const diaMesAnio = (dia: string): string => dia.slice(0, 10).split('-').reverse().join('/');
/** Un instante con zona («…T01:10:00Z», «… 01:10:00+00») → «DD/MM/AAAA HH:MM» en hora de COLOMBIA (UTC−5 todo el año). Aritmética sobre UTC. */
function enColombia(instante: string): string {
  const m = INSTANTE.exec(instante.trim());
  if (!m) return diaMesAnio(instante);
  const z = m[7].replace(':', '');
  const zona = /z/i.test(z) ? 0 : (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3) || 0));
  const local = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - zona * 60_000 - 5 * 3_600_000).toISOString();
  return `${diaMesAnio(local)} ${local.slice(11, 16)}`;
}

/** Una hoja a partir de sus casillas. Cada celda se escribe con su tipo: un texto es SIEMPRE una celda de texto. */
function hojaDe(filas: readonly Valor[][], anchos: readonly number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  filas.forEach((casillas, r) =>
    casillas.forEach((v, c) => {
      const celda: XLSX.CellObject | null = typeof v === 'string' ? (v === '' ? null : { t: 's', v }) : typeof v === 'number' ? { t: 'n', v } : v;
      if (celda) ws[XLSX.utils.encode_cell({ r, c })] = celda;
    }),
  );
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(filas.length, 1) - 1, c: Math.max(...filas.map((x) => x.length), 1) - 1 } });
  ws['!cols'] = anchos.map((wch) => ({ wch }));
  return ws;
}

const partida = (c: RespuestaHoja['congelacion']): string => (c ? `Hoja «${c.hoja}» de «${c.archivo}», congelada el ${enColombia(c.en).slice(0, 10)} por ${c.por} (congelación n.º ${c.id})` : 'Sin F-ST-022 congelada en este entorno: sólo salen los equipos del inventario y de Desk 2.0.');

export interface EntradaLibro {
  /** La respuesta de GET /hoja, tal cual. */
  tabla: RespuestaHoja;
  /** Quién exporta y en qué instante (con zona). */
  exporta: { por: string; en: string };
}
export interface LibroFst022 { nombre: string; cuerpo: Buffer; /** Filas de equipo de la principal. */ filas: number; /** Lo que va en «Retirados». */ retirados: number }

/** Lo último que se exportó (portal.tmc_exportaciones): para saber qué copia circula. Ni clientes ni seriales. */
export interface Exportacion { id: number; por: string; en: string; hoy: string; filas: number; retirados: number; congelacionId: number | null; archivo: string; sha256: string }
/** GET /trazabilidad/exportaciones. */
export interface RespuestaExportaciones { ultima: Exportacion | null; total: number }

export function libroFst022({ tabla, exporta }: EntradaLibro): LibroFst022 {
  const vivas = filasExportadas(tabla);
  const retirados = [...tabla.filas, ...tabla.fueraDeHoja].filter((x) => x.retirado !== null);
  const c = tabla.congelacion;
  const cuando = enColombia(exporta.en);
  const primera = FILA_CABECERA + 1;

  const principal = hojaDe(
    [
      [TITULO_LIBRO],
      [`Exportado del portal el ${cuando.slice(0, 10)} a las ${cuando.slice(11)} (hora de Colombia) por ${exporta.por} · valores al ${diaMesAnio(tabla.hoy)}`],
      [c ? `Punto de partida: hoja «${c.hoja}» congelada el ${enColombia(c.en).slice(0, 10)} desde «${c.archivo}» por ${c.por}` : partida(null)],
      ...Array.from({ length: FILA_CABECERA - 4 }, (): Valor[] => []),
      COLUMNAS_FST022.map((k) => k.titulo),
      ...vivas.map((x, i) => COLUMNAS_FST022.map((k) => k.celda(x, primera + i))),
    ],
    COLUMNAS_FST022.map((k) => k.ancho),
  );

  const deRetirados = hojaDe(
    [
      ['Fila en la hoja congelada', 'Cliente', 'Marca', 'Modelo', 'Serial', 'Última Calibración', 'Qué se retiró', 'Retirado por', 'Retirado el (hora de Colombia)', 'Motivo'],
      ...retirados.map((x): Valor[] => [x.fila, x.cliente, x.marca, x.modelo, x.serial, fecha(x.ultimaCalibracion), x.clave === null ? 'Fila de la hoja' : 'Equipo', x.retirado!.por, enColombia(x.retirado!.en), x.retirado!.motivo]),
    ],
    [12, 46, 16, 18, 22, 18, 16, 30, 20, 60],
  );

  const detalle = hojaDe(
    [
      ['Fila en este libro', 'Fila en la hoja congelada', 'Serial', 'Origen de la fecha', 'Vence', 'Estado'],
      ...vivas.map((x, i): Valor[] => {
        const origen = origenDeFecha(x);
        const ticket = origen === 'desk' ? x.calibraciones.find((k) => k.cuenta)?.ticket : null;
        return [primera + i, x.fila, x.serial, `${ORIGENES_FECHA[origen].etiqueta}${ticket ? ` n.º ${ticket}` : ''}`, fecha(x.vence), ETIQUETA_ESTADO[x.estado]];
      }),
    ],
    [14, 14, 22, 30, 14, 20],
  );

  const cuenta = <K extends string>(clave: (x: FilaHoja) => K): Map<K, number> => vivas.reduce((m, x) => m.set(clave(x), (m.get(clave(x)) ?? 0) + 1), new Map<K, number>());
  const porOrigen = cuenta(origenDeFecha);
  const porEstado = cuenta((x) => x.estado);
  const marcas = new Map(vivas.map((x) => [x.marcaClave, x.marca || '(sin marca)']).reverse() as [string, string][]);
  const notas = hojaDe(
    [
      ['Documento', TITULO_LIBRO],
      ['Exportado el (hora de Colombia)', cuando],
      ['Exportado por', exporta.por],
      ['Valores a', diaMesAnio(tabla.hoy), 'El día (en Colombia) con el que se calcularon la última calibración que cuenta y la vigencia.'],
      ['Punto de partida', partida(c)],
      [],
      ['Filas exportadas', vivas.length, `Las de la hoja «${HOJAS_LIBRO[0]}», desde la fila ${primera}. No dependen de los filtros de la pantalla.`],
      ['· de la hoja congelada', vivas.filter((x) => x.fila !== null).length, 'Primero, y en el orden de la hoja.'],
      ['· del inventario o de Desk 2.0, fuera de la hoja', vivas.filter((x) => x.fila === null).length, 'Después: equipos que no casan con ninguna fila de la hoja congelada.'],
      ['Retirados a mano (en su hoja, no en la principal)', retirados.length, `Están en «${HOJAS_LIBRO[1]}», con quién, cuándo y por qué. Nada se borró.`],
      [],
      ['Columnas', 'Las seis de la F-ST-022, con sus títulos y en su orden. Cliente, marca, modelo y serial son los de hoy (los del maestro de Desk 2.0 si el equipo está enlazado); la última calibración es la que da la regla del portal.'],
      ['Vigencia', 'Cada celda lleva la fórmula de la hoja, última calibración + 365 − HOY(), así que se recalcula sola al abrir el libro otro día; el número guardado es el del día de la exportación. Sin fecha, va vacía. 365 días para todas las marcas.'],
      ['Detalle', `La hoja «${HOJAS_LIBRO[2]}» dice, fila a fila, de dónde sale cada fecha, cuándo vence y su estado ese día.`],
      [],
      ...[...cuenta((x) => x.marcaClave)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([clave, total]): Valor[] => [`Marca: ${marcas.get(clave)}`, total]),
      [],
      ...ESTADOS.map((s): Valor[] => [`Estado: ${ETIQUETA_ESTADO[s]}`, porEstado.get(s) ?? 0]),
      [],
      ...(Object.keys(ORIGENES_FECHA) as OrigenFecha[]).map((o): Valor[] => [`Origen: ${ORIGENES_FECHA[o].etiqueta}`, porOrigen.get(o) ?? 0, ORIGENES_FECHA[o].significa]),
    ],
    [48, 60, 100],
  );

  const wb = XLSX.utils.book_new();
  [principal, deRetirados, detalle, notas].forEach((ws, i) => XLSX.utils.book_append_sheet(wb, ws, HOJAS_LIBRO[i]));
  return { nombre: nombreFichero(tabla.hoy), cuerpo: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, filas: vivas.length, retirados: retirados.length };
}
