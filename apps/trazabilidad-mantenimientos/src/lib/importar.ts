/**
 * Lectura de la hoja F-ST-022 «Trazabilidad Mttos Clientes» en el navegador.
 *
 * Busca la hoja «Trazabilidad», localiza la cabecera por el texto de sus
 * columnas (no por posición fija: la plantilla ha cambiado de versión) y se
 * queda sólo con los GRIMM EDM 180. El servidor vuelve a validar todo.
 */
import * as XLSX from 'xlsx';
import { esFechaIso, modeloEdm180, prepararFst022, type Celda, type FilaImportada } from '../dominio';

export class ErrorLectura extends Error {}

/** Texto en minúsculas, sin tildes y con los espacios colapsados. */
export function norm(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Una celda de fecha (Date, número de serie de Excel o texto AAAA-MM-DD) → AAAA-MM-DD. */
export function fechaCelda(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // cellDates devuelve la medianoche local; se redondea al día más cercano
    // para no perder un día por el desfase de zona horaria de SheetJS.
    const d = new Date(v.getTime() + 12 * 3_600_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof v === 'number' && v > 20_000 && v < 80_000) {
    const p = XLSX.SSF.parse_date_code(v);
    if (p) return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  if (typeof v === 'string' && esFechaIso(v.trim())) return v.trim();
  return null;
}

const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const texto = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export interface Lectura {
  hoja: string;
  filas: FilaImportada[];
  /** Filas GRIMM EDM 180 descartadas (sin serial o sin cliente), con su número de fila en Excel. */
  descartadas: number[];
  /** La hoja entera, celda a celda y sin filtrar (todas las marcas, el pie, los datos sucios): lo que se congela. */
  matriz: Celda[][];
  /** Sus filas de títulos (hasta tres), tal cual; vacío si no se reconoce la cabecera. */
  cabeceras: Celda[][];
}

/** Lee una matriz (filas × columnas) ya extraída de la hoja. */
export function leerMatriz(A: unknown[][], hoja = 'Trazabilidad'): Omit<Lectura, 'matriz' | 'cabeceras'> {
  const h = A.findIndex((r) => Array.isArray(r) && r.some((c) => norm(c) === 'cliente') && r.some((c) => norm(c) === 'serial'));
  if (h < 0) throw new ErrorLectura('No encuentro la cabecera «Cliente / Serial» en la hoja Trazabilidad.');
  const H = A[h];
  const col = (t: string) => H.findIndex((c) => norm(c) === t);
  const C = {
    cliente: col('cliente'),
    marca: col('marca'),
    modelo: col('modelo'),
    serial: col('serial'),
    factura: col('fecha factura'),
    hv: col('hoja vida'),
    entrada: col('(ultima entrada)'),
  };
  if (C.marca < 0 || C.modelo < 0) throw new ErrorLectura('Faltan las columnas «Marca» o «Modelo».');
  // «Última calibración» y «Número de entradas…» están en la SEGUNDA fila de la cabecera.
  let uc = -1;
  let ent = -1;
  for (let i = h; i < Math.min(h + 3, A.length); i++) {
    (A[i] ?? []).forEach((c, j) => {
      const t = norm(c);
      if (t === 'ultima calibracion') uc = j;
      if (t.startsWith('numero de entradas')) ent = j;
    });
  }
  if (uc < 0) throw new ErrorLectura('No encuentro la columna «Última calibración».');
  // En la F-ST-022 V2, justo antes de «Última calibración» van Correctivo y
  // Calibración del periodo 2024-2026.
  const calPeriodo = uc - 1;
  const corrPeriodo = uc - 2;

  const filas: FilaImportada[] = [];
  const descartadas: number[] = [];
  for (let i = h + 1; i < A.length; i++) {
    const r = A[i];
    if (!Array.isArray(r)) continue;
    if (norm(r[C.marca]) !== 'grimm') continue;
    const modelo = modeloEdm180(r[C.modelo]);
    if (!modelo) continue;
    const serial = texto(r[C.serial]);
    const cliente = texto(r[C.cliente]);
    if (!serial || !cliente) {
      descartadas.push(i + 1);
      continue;
    }
    filas.push({
      serial,
      cliente,
      marca: 'Grimm',
      modelo,
      fechaFactura: C.factura >= 0 ? fechaCelda(r[C.factura]) : null,
      hojaVida: C.hv >= 0 ? texto(r[C.hv]) : null,
      ultimaEntrada: C.entrada >= 0 ? fechaCelda(r[C.entrada]) : null,
      ultimaCalibracion: fechaCelda(r[uc]),
      entradasSt: ent >= 0 ? entero(r[ent]) : null,
      calibracionesPeriodo: calPeriodo >= 0 ? entero(r[calPeriodo]) : null,
      correctivosPeriodo: corrPeriodo >= 0 ? entero(r[corrPeriodo]) : null,
    });
  }
  return { hoja, filas, descartadas };
}

/**
 * Una celda de la hoja tal cual, para la congelación: texto, número o booleano; una fecha como `{v: 'AAAA-MM-DD',
 * t: 'fecha'}` (por `fechaCelda`, el único sitio que normaliza fechas); un error de Excel como `{v: '#VALUE!', t: 'error'}`
 * (el texto con que lo guarda el fichero, en inglés); de una fórmula, su último valor calculado; y, si lleva
 * hipervínculo, su destino en `enlace`. Vacía → null.
 */
function celda(c: XLSX.CellObject | undefined): Celda {
  if (!c || c.t === 'z' || c.v === undefined || c.v === null) return null;
  let v: Celda;
  if (c.t === 'e') v = { v: c.w ?? `#ERROR(${String(c.v)})`, t: 'error' };
  else if (c.v instanceof Date) {
    const f = fechaCelda(c.v);
    v = f ? { v: f, t: 'fecha' } : (c.w ?? null);
  } else v = c.v;
  const enlace = c.l?.Target;
  return enlace ? { ...(v !== null && typeof v === 'object' ? v : { v }), enlace } : v;
}

/**
 * La hoja entera como matriz: la fila N de Excel es `matriz[N - 1]` y la columna A es la posición 0, empiece donde
 * empiece el rango usado. Recorre las celdas que existen (no el rango): una hoja con formato hasta la fila un millón no
 * cuesta más. De una combinada sólo trae valor su esquina; las filas vacías quedan como `[]`, sin nulls de relleno a la derecha.
 */
export function matrizDeHoja(ws: XLSX.WorkSheet): Celda[][] {
  const A: Celda[][] = [];
  for (const k of Object.keys(ws)) {
    if (k.startsWith('!')) continue;
    const v = celda(ws[k] as XLSX.CellObject);
    if (v === null) continue;
    const { r, c } = XLSX.utils.decode_cell(k);
    (A[r] ??= [])[c] = v;
  }
  return Array.from(A, (fila) => Array.from(fila ?? [], (x) => x ?? null));
}

/** La huella SHA-256 del fichero, en hexadecimal y minúsculas: identifica qué Excel se congeló. */
export async function sha256Hex(datos: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', datos))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lee el libro completo (contenido del .xlsx). */
export function leerLibro(datos: ArrayBuffer): Lectura {
  const wb = XLSX.read(datos, { type: 'array', cellDates: true });
  const hoja = wb.SheetNames.find((n) => norm(n).startsWith('trazabilidad')) ?? wb.SheetNames[0];
  if (!hoja) throw new ErrorLectura('El archivo no tiene hojas.');
  const A = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, raw: true, defval: null });
  const matriz = matrizDeHoja(wb.Sheets[hoja]);
  return { ...leerMatriz(A, hoja), matriz, cabeceras: prepararFst022(matriz)?.cabeceras ?? [] };
}

/** Lo mismo que `leerLibro`, más la huella del fichero. */
export async function leerArchivo(datos: ArrayBuffer): Promise<Lectura & { sha256: string }> {
  return { ...leerLibro(datos), sha256: await sha256Hex(datos) };
}
