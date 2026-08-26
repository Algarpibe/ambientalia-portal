import * as XLSX from 'xlsx';
import { TIPO_COLUMNA } from './columns.js';

/** Nombre de hoja por defecto en el modelo de World Office (§4). Configurable. */
const NOMBRE_HOJA_DEFECTO = 'QueryDef_Exportar';

/** Formato de fecha de las celdas Fecha/Vencimiento, igual que en el modelo. */
const FORMATO_FECHA = 'm/d/yy';

/** Época de Excel: 1899-12-30. El serial es el nº de días enteros desde esa fecha. */
const EPOCA_EXCEL = Date.UTC(1899, 11, 30);

/**
 * "DD/MM/AAAA" → serial de Excel (entero, sin hora). Es como el modelo guarda las
 * fechas (46184 = 11/06/2026). Se calcula en UTC para que ningún desfase de zona reste
 * un día. Devuelve null si no es una fecha válida.
 */
export function serialExcel(fecha: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim());
  if (!m) return null;
  const [, d, mes, a] = m;
  const ms = Date.UTC(Number(a), Number(mes) - 1, Number(d));
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - EPOCA_EXCEL) / 86_400_000);
}

/** ¿La cadena es un número "limpio" (entero o decimal, con signo)? */
function esNumero(v: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(v);
}

/**
 * Convierte una celda-texto en el valor tipado que espera el .xls, según el tipo de su
 * columna. El vacío queda como celda en blanco (null), no como 0 ni "".
 * - fecha: serial de Excel; si no parsea, cae a texto (no se pierde el dato).
 * - numero: número si es numérico limpio; si no (p. ej. un NIT con guion), cae a texto.
 * - texto: tal cual.
 */
export function tipar(valor: string, tipo: (typeof TIPO_COLUMNA)[number]): string | number | null {
  if (valor === '') return null;
  if (tipo === 'fecha') return serialExcel(valor) ?? valor;
  if (tipo === 'numero') return esNumero(valor) ? Number(valor) : valor;
  return valor;
}

/**
 * Genera el .xls binario (BIFF8, como el modelo de World Office) a partir de la matriz
 * de celdas del builder. La primera fila es la cabecera (texto); el resto se re-tipa
 * columna a columna con TIPO_COLUMNA. A las celdas de fecha se les pone el formato
 * m/d/yy para que World Office las lea como FECHA y no como número general (§7.2).
 * Windows-1252 y el saneo del ';' no aplican aquí: cada celda es su propia celda y el
 * .xls guarda el texto en Unicode.
 */
export function buildWorldOfficeXlsx(matriz: string[][], nombreHoja = NOMBRE_HOJA_DEFECTO): Buffer {
  const [cabecera, ...filas] = matriz;
  const aoa: (string | number | null)[][] = [
    cabecera,
    ...filas.map((fila) => fila.map((celda, col) => tipar(celda, TIPO_COLUMNA[col]))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Formato de fecha en las columnas de fecha: sin esto la celda es un número con
  // formato "General" y World Office no la reconoce como fecha. Se recorre solo esas
  // columnas y solo las filas de datos (la cabecera es texto).
  for (let col = 0; col < TIPO_COLUMNA.length; col++) {
    if (TIPO_COLUMNA[col] !== 'fecha') continue;
    for (let row = 1; row < aoa.length; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell && cell.t === 'n') cell.z = FORMATO_FECHA;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  return XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }) as Buffer;
}
