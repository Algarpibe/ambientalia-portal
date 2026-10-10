/**
 * Congelación de la F-ST-022: la forma de lo que quedó guardado (migración 055)
 * y que el servidor y la app sólo LEEN. La hoja se congeló desde la Excel con el
 * lote 9a y el 10/10/2026 se retiró toda subida: las reglas con que se preparó
 * (dónde está la cabecera, qué fila es de un equipo, los recuentos) y sus topes
 * ya no están aquí, sino en el historial de git (233c340). Sin imports.
 */

export type ValorCelda = string | number | boolean | null;
/** Una celda que no es un valor suelto: una fecha (AAAA-MM-DD), un error de Excel (su texto, p. ej. «#VALUE!») o una con hipervínculo. */
export interface CeldaRica {
  v: ValorCelda;
  t?: 'fecha' | 'error';
  enlace?: string;
}
/** El valor de una celda tal cual: texto, número, booleano, vacío (null) o una `CeldaRica`. */
export type Celda = ValorCelda | CeldaRica;

/** Lo que hay guardado de cada fila de la hoja que traía algo. */
export interface FilaCongelada {
  /** Número de fila en Excel (desde 1). */
  fila: number;
  celdas: Celda[];
  esEquipo: boolean;
  /** El serial como lo cruza el portal con Desk (`serialNorm`, dominio.ts); null sin serial. */
  serialNorm: string | null;
  /** La clave que la importación le daba en tmc_equipos; null si aquella importación no aceptaba la fila. */
  claveEquipo: string | null;
}

/** Las claves de `problemas` tal como quedaron guardadas: son datos, no se renombran (su texto, en la app: `src/lib/origen.ts`). */
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
  /** Filas de equipo con cada aviso, contadas al congelar. */
  problemas: Record<ProblemaFst022, number>;
}
