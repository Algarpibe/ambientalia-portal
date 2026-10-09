/**
 * Congelación de la F-ST-022 (lote 9a): las reglas puras, que comparten el
 * servidor y la app. La hoja entera se guarda tal cual, celda a celda; aquí se
 * decide sólo lo que se DERIVA de ella para poder consultarla: dónde está la
 * cabecera, qué fila es de un equipo y los recuentos que se enseñan antes de
 * confirmar. No se arregla ni se rechaza ningún dato sucio. Sin reloj ni base.
 */
import { asignarClaves, claveTipoServicio, modeloEdm180, serialNorm } from './dominio.js';

export type ValorCelda = string | number | boolean | null;
/** Una celda que no es un valor suelto: una fecha (AAAA-MM-DD), un error de Excel (su texto, p. ej. «#VALUE!») o una con hipervínculo. */
export interface CeldaRica {
  v: ValorCelda;
  t?: 'fecha' | 'error';
  enlace?: string;
}
/** El valor de una celda tal cual: texto, número, booleano, vacío (null) o una `CeldaRica`. */
export type Celda = ValorCelda | CeldaRica;

// Topes de lo que se acepta congelar. La hoja real ronda las 400 filas × 16 columnas.
export const FST022_MAX_FILAS = 2000;
export const FST022_MAX_COLUMNAS = 60;
export const FST022_MAX_TEXTO = 2000;
/**
 * Límite del cuerpo de POST /trazabilidad/fst022/congelaciones (index.ts lo
 * registra antes del parser global de 2 MB). Medido con una hoja ficticia de
 * la forma de la real (50 filas × 17 columnas, un hipervínculo por fila): 9,3 kB
 * de JSON, unos 0,19 kB por fila. Unas 400 filas × 16 columnas son ~0,08 MB, y
 * ~0,3 MB con nombres largos y enlaces de 300 caracteres: hoy cabría en el
 * global. El límite propio (más de diez veces eso) es el margen para una hoja
 * que crezca hacia los topes de arriba, sin subir el del resto de la API.
 */
export const FST022_CUERPO_MAX = '4mb';

export const valorCelda = (c: Celda | undefined): ValorCelda => (c !== null && typeof c === 'object' ? c.v : c ?? null);
const tipoCelda = (c: Celda | undefined) => (c !== null && typeof c === 'object' ? c.t : undefined);
const vacia = (c: Celda | undefined): boolean => String(valorCelda(c) ?? '').trim() === '';
/** El texto de una celda como lo ve la importación de hoy: sin espacios alrededor; vacía o con un error de Excel, null. */
const texto = (c: Celda | undefined): string | null => (vacia(c) || tipoCelda(c) === 'error' ? null : String(valorCelda(c)).trim());
/** Un título sin tildes, mayúsculas ni espacios de más (la normalización de `norm` en la app). */
const titulo = (c: Celda | undefined): string => claveTipoServicio(valorCelda(c));

export interface ColumnasFst022 {
  /** Índice (desde 0) de la primera fila de títulos y cuántas filas ocupa la cabecera (1 a 3). */
  fila: number;
  filas: number;
  cliente: number;
  marca: number;
  modelo: number;
  serial: number;
  /** «(Última entrada)» y «Última Calibración»; −1 si la hoja no las trae. */
  entrada: number;
  calibracion: number;
}

/**
 * Localiza la cabecera por sus títulos, como el lector de la importación: la
 * fila que trae «Cliente» y «Serial». Le siguen (hasta tres en total) las filas
 * de subtítulos: las que traen algo y nada en cliente, marca, modelo ni serial.
 */
export function columnasFst022(matriz: readonly Celda[][]): ColumnasFst022 | null {
  const fila = matriz.findIndex((r) => r.some((c) => titulo(c) === 'cliente') && r.some((c) => titulo(c) === 'serial'));
  if (fila < 0) return null;
  const col = (t: string) => matriz[fila].findIndex((c) => titulo(c) === t);
  const id = { cliente: col('cliente'), marca: col('marca'), modelo: col('modelo'), serial: col('serial') };
  let filas = 1;
  while (filas < 3 && fila + filas < matriz.length) {
    const r = matriz[fila + filas];
    if (r.every(vacia) || Object.values(id).some((j) => !vacia(r[j]))) break;
    filas++;
  }
  const enCabecera = (t: string) => matriz.slice(fila, fila + filas).reduce((j, r) => (j >= 0 ? j : r.findIndex((c) => titulo(c) === t)), -1);
  return { fila, filas, ...id, entrada: enCabecera('(ultima entrada)'), calibracion: enCabecera('ultima calibracion') };
}

/** El título de cada columna: lo que traen sus filas de cabecera, de arriba abajo. */
export function titulosFst022(cabeceras: readonly Celda[][]): string[] {
  const ancho = Math.max(0, ...cabeceras.map((r) => r.length));
  return Array.from({ length: ancho }, (_, j) => cabeceras.map((r) => String(valorCelda(r[j]) ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / '));
}

/** Lo que se guarda de cada fila de la hoja que trae algo. */
export interface FilaCongelada {
  /** Número de fila en Excel (desde 1). */
  fila: number;
  celdas: Celda[];
  esEquipo: boolean;
  /** El serial como lo cruza el portal con Desk (`serialNorm`, dominio.ts); null sin serial. */
  serialNorm: string | null;
  /** La clave que la importación de hoy le da en tmc_equipos; null si esa importación no la acepta. */
  claveEquipo: string | null;
}

export const PROBLEMAS_FST022 = ['sin_serial', 'sin_cliente', 'serial_repetido', 'serial_cientifico', 'error_excel', 'texto_en_fecha', 'fecha_imposible'] as const;
export type ProblemaFst022 = (typeof PROBLEMAS_FST022)[number];

/** Sólo recuentos: nada de aquí lleva un cliente ni un serial. */
export interface ResumenFst022 {
  totalFilas: number;
  totalColumnas: number;
  filasGuardadas: number;
  /** Número de fila de Excel de la primera fila de títulos. */
  filaCabecera: number;
  filasEquipo: number;
  filasConSerial: number;
  filasEdm180: number;
  /** Filas guardadas que no son de un equipo: títulos, pie de totales y valores sueltos. */
  filasOtras: number;
  /** Filas de equipo con cada problema. Se guardan igual: es sólo para saber qué hay. */
  problemas: Record<ProblemaFst022, number>;
}

export interface Fst022Preparada {
  cabeceras: Celda[][];
  filas: FilaCongelada[];
  resumen: ResumenFst022;
}

/** El bloque de totales del pie («totalRevisados», «total equipos», «% de avance»): no son equipos. */
const DE_PIE = /^(total ?revisados|total equipos|% de avance)/;
/** Un serial que Excel convirtió en número y enseña en notación científica: el de verdad se perdió. */
const cientifico = (c: Celda | undefined): boolean => {
  const v = valorCelda(c);
  return typeof v === 'number' ? Math.abs(v) >= 1e11 : typeof v === 'string' && /^\d(\.\d+)?e\+?\d+$/i.test(v.trim());
};
const anio = (c: Celda | undefined): number => Number(String(valorCelda(c)).slice(0, 4));

/** De la matriz de la hoja, lo que se guarda y su resumen; null si no se encuentra la cabecera. No cambia lo que recibe. */
export function prepararFst022(matriz: readonly Celda[][]): Fst022Preparada | null {
  const C = columnasFst022(matriz);
  if (!C) return null;
  const finCabecera = C.fila + C.filas;
  const problemas = Object.fromEntries(PROBLEMAS_FST022.map((p) => [p, 0])) as Record<ProblemaFst022, number>;
  const filas: FilaCongelada[] = [];
  /** Posición en `filas` de cada fila que la importación de hoy acepta, y su serial, en el orden de la hoja. */
  const aceptadas: [number, string][] = [];
  let filasEdm180 = 0;
  matriz.forEach((r, i) => {
    if (r.every(vacia)) return;
    const bajoCabecera = i >= finCabecera;
    const esEquipo = bajoCabecera && [C.cliente, C.marca, C.modelo, C.serial].some((j) => !vacia(r[j])) && !r.some((c) => DE_PIE.test(titulo(c)));
    const serial = bajoCabecera ? texto(r[C.serial]) : null;
    const edm180 = bajoCabecera && titulo(r[C.marca]) === 'grimm' && modeloEdm180(valorCelda(r[C.modelo])) !== null;
    if (edm180 && serial && texto(r[C.cliente])) aceptadas.push([filas.length, serial]);
    if (esEquipo) {
      if (edm180) filasEdm180++;
      const fechas = [C.entrada, C.calibracion].filter((j) => j >= 0).map((j) => r[j]);
      if (!serial) problemas.sin_serial++;
      else if (cientifico(r[C.serial])) problemas.serial_cientifico++;
      if (!texto(r[C.cliente])) problemas.sin_cliente++;
      if (r.some((c) => tipoCelda(c) === 'error')) problemas.error_excel++;
      if (fechas.some((c) => !vacia(c) && tipoCelda(c) === undefined)) problemas.texto_en_fecha++;
      if (r.some((c) => tipoCelda(c) === 'fecha' && (anio(c) < 1990 || anio(c) > 2100))) problemas.fecha_imposible++;
    }
    filas.push({ fila: i + 1, celdas: [...r], esEquipo, serialNorm: serial && esEquipo ? serialNorm(serial) : null, claveEquipo: null });
  });
  asignarClaves(aceptadas.map(([, s]) => s)).forEach((clave, k) => (filas[aceptadas[k][0]].claveEquipo = clave));
  const equipos = filas.filter((f) => f.esEquipo);
  const veces = new Map<string, number>();
  for (const f of equipos) if (f.serialNorm) veces.set(f.serialNorm, (veces.get(f.serialNorm) ?? 0) + 1);
  problemas.serial_repetido = equipos.filter((f) => f.serialNorm && veces.get(f.serialNorm)! > 1).length;
  return {
    cabeceras: matriz.slice(C.fila, finCabecera).map((r) => [...r]),
    filas,
    resumen: {
      totalFilas: matriz.length,
      totalColumnas: Math.max(0, ...matriz.map((r) => r.length)),
      filasGuardadas: filas.length,
      filaCabecera: C.fila + 1,
      filasEquipo: equipos.length,
      filasConSerial: equipos.filter((f) => f.serialNorm).length,
      filasEdm180,
      filasOtras: filas.length - equipos.length,
      problemas,
    },
  };
}
