import type { SalesOrder } from './types.js';

export interface SalesOrderFiltro {
  /** ISO YYYY-MM-DD. */
  desde: string;
  hasta: string;
  /** Filtro opcional por nombre de cliente (ILIKE). */
  cliente?: string;
}

/** Una OV viva que quedó FUERA del rango pedido por ser anterior. */
export interface OrdenAntigua {
  numero: string;
  fecha: string;
  clienteNombre: string | null;
}

/**
 * Origen de las OV vivas. El dominio (builder) no conoce esta interfaz: la usa el
 * router. Existe para poder cambiar zoho-hub por la API de Zoho sin tocar el mapeo.
 */
export interface SalesOrderSource {
  ordenesVivas(filtro: SalesOrderFiltro): Promise<SalesOrder[]>;
  /**
   * OV vivas anteriores a `desde`. No entran al archivo, pero DEBEN listarse: son
   * las 9 OV de 2021/2025 que siguen open/overdue y casi seguro están abandonadas.
   * Ocultarlas sin más sería silenciar un dato que el usuario necesita ver.
   */
  ordenesAntiguas(filtro: SalesOrderFiltro): Promise<OrdenAntigua[]>;
}
