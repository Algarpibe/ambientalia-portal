import type { FilaHistorico } from './api';

// Lectura del Excel histórico EN EL NAVEGADOR. El fichero no se sube a ningún
// sitio: solo viaja al servidor el JSON ya extraído.
//
// Se lee el fichero en vez de pedir que se peguen las filas —que es lo que hace
// la importación de empleados— por un motivo concreto: al pegar, las fechas
// llegan como «10/11/2025» y dd/mm es indistinguible de mm/dd. El 10 de
// noviembre y el 11 de octubre se confundirían en silencio, y nadie lo notaría
// hasta que un histórico de vacaciones estuviera mal por meses. Leyendo el
// fichero con `cellDates`, las fechas llegan ya como Date.

/** Las cuatro pestañas del registro, con el nombre exacto que tienen en la hoja. */
export const PESTANAS = [
  'vacaciones_solicitadas',
  'permisos_solicitados',
  'compensatorios_solicitados',
  'incapacidades_informadas',
] as const;

export interface LecturaExcel {
  filas: FilaHistorico[];
  /** Pestañas que se esperaban y no estaban, para poder avisar. */
  pestanasQueFaltan: string[];
  /** Filas saltadas por venir sin nombre o sin fechas. */
  descartadas: number;
}

/** Fecha de celda a `YYYY-MM-DD`, en UTC para no desplazar un día. */
function aIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  // Por si alguien guardó la columna como texto ya normalizado.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  return null;
}

function texto(v: unknown): string | null {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s ? s : null;
}

/**
 * Convierte una fila cruda de una de las cuatro pestañas.
 *
 * Las columnas 0-4 son iguales en todas, pero de la 5 en adelante no: las
 * incapacidades llevan `Adjunto?` justo donde las demás llevan `Comentarios` y
 * `Aprobado?`. La columna 7 solo existe en vacaciones, sin cabecera, con notas
 * al margen. Se ramifica por el valor de «Tipo», que sí viene en todas.
 */
export function filaDesdeCeldas(c: unknown[]): FilaHistorico | null {
  const nombre = texto(c[0]);
  const tipo = texto(c[4]);
  const fechaInicio = aIso(c[1]);
  const fechaFin = aIso(c[2]);
  if (!nombre || !tipo || !fechaInicio || !fechaFin) return null;

  const esIncapacidad = tipo.toLowerCase().startsWith('incapacidad');
  return {
    nombre,
    tipo,
    fechaInicio,
    fechaFin,
    dias: (c[3] as number | string) ?? 0,
    comentarios: esIncapacidad ? null : texto(c[5]),
    adjunto: esIncapacidad ? texto(c[5]) : null,
    observaciones: texto(c[7]),
  };
}

/**
 * Lee las cuatro pestañas del libro. `xlsx` se carga con import dinámico para
 * que no engorde el bundle inicial del portal: solo lo paga quien abre esta
 * pestaña, y solo una vez.
 */
export async function leerLibro(fichero: File): Promise<LecturaExcel> {
  const XLSX = await import('xlsx');
  const libro = XLSX.read(await fichero.arrayBuffer(), { cellDates: true });

  const filas: FilaHistorico[] = [];
  const pestanasQueFaltan: string[] = [];
  let descartadas = 0;

  for (const nombre of PESTANAS) {
    const hoja = libro.Sheets[nombre];
    if (!hoja) {
      pestanasQueFaltan.push(nombre);
      continue;
    }
    const celdas = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
      header: 1,
      defval: null,
      blankrows: false,
    });
    // La primera fila es la cabecera de la hoja.
    for (const fila of celdas.slice(1)) {
      const leida = filaDesdeCeldas(fila);
      if (leida) filas.push(leida);
      else descartadas++;
    }
  }

  return { filas, pestanasQueFaltan, descartadas };
}
