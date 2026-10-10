/**
 * De dónde salen los datos de la app: la hoja F-ST-022 congelada (lote 9a), que
 * desde el 10/10/2026 sólo se LEE (ya no se sube ninguna Excel). Aquí, lo que
 * calculan la tarjeta «Origen de los datos» de Configuración y la cabecera de
 * la app; puro, sin reloj ni red.
 */
import { PROBLEMAS_FST022, type CongelacionFst022, type ProblemaFst022, type ResumenFst022 } from '../dominio';
import { fmtFecha } from './vistas';

/**
 * El rótulo de cada aviso que se contó al congelar. Las claves son las guardadas
 * (no se tocan); el texto es sólo presentación. `serial_cientifico` cuenta seriales
 * numéricos de 12 cifras o más: Excel los ENSEÑA abreviados, pero el número guardado
 * puede estar entero (en la congelación firmada lo está), así que no dice que se perdiera.
 */
export const ETIQUETA_PROBLEMA: Record<ProblemaFst022, string> = {
  sin_serial: 'Sin serial (vacío o con un error de Excel)',
  sin_cliente: 'Sin cliente',
  serial_repetido: 'Con un serial que se repite',
  serial_cientifico: 'Con el serial numérico largo, que Excel muestra en notación científica',
  error_excel: 'Con algún error de Excel (#¡VALOR!, #¡REF!, #¿NOMBRE?…)',
  texto_en_fecha: 'Con texto donde va una fecha',
  fecha_imposible: 'Con una fecha imposible',
};

/** La congelación vigente de la lista de `GET /fst022/congelaciones`; null si no hay ninguna o la lista no ha llegado. */
export function vigenteDe(lista: readonly CongelacionFst022[] | null): CongelacionFst022 | null {
  return lista?.find((c) => c.vigente) ?? null;
}

/** Lo que dice la cabecera de la app sobre el origen de sus datos; null (no se enseña nada) si no hay congelación. */
export function textoOrigen(vigente: CongelacionFst022 | null): string | null {
  return vigente ? `F-ST-022 congelada el ${fmtFecha(vigente.en)} desde «${vigente.archivo}» por ${vigente.por}` : null;
}

/** La huella del fichero abreviada (la entera va en el `title`). */
export const huellaCorta = (sha256: string): string => `sha256 ${sha256.slice(0, 12)}…`;

export interface LineaOrigen {
  texto: string;
  valor: string;
  /** Un aviso (dato sucio que se guardó tal cual), no un recuento. */
  aviso: boolean;
}

/** Los recuentos de una congelación, en el orden en que se enseñan; de los avisos, sólo los que tienen algo. Nada de aquí lleva un cliente ni un serial. */
export function lineasOrigen(r: ResumenFst022): LineaOrigen[] {
  const recuento = (texto: string, valor: number | string): LineaOrigen => ({ texto, valor: String(valor), aviso: false });
  return [
    recuento('Tamaño de la hoja', `${r.totalFilas} filas × ${r.totalColumnas} columnas`),
    recuento('Filas de equipo', r.filasEquipo),
    recuento('· con serial', r.filasConSerial),
    recuento('· GRIMM EDM 180', r.filasEdm180),
    recuento('Otras filas (títulos, pie de totales, valores sueltos)', r.filasOtras),
    ...PROBLEMAS_FST022.filter((p) => (r.problemas?.[p] ?? 0) > 0).map((p) => ({ texto: ETIQUETA_PROBLEMA[p], valor: String(r.problemas[p]), aviso: true })),
  ];
}
