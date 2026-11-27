import { fechaHoraCorta } from './fechas';
import type { EstadoRespuesta, Preferencia, Resumen } from './tipos';

export const HOJA_EXCEL = 'Confirmaciones';
export const COLUMNAS_EXCEL = ['Nombre', 'Respuesta', 'Preferencia', 'Mensaje', 'Actualizado'];

const RESPUESTA: Record<EstadoRespuesta, string> = { va: 'Va', no_va: 'No va', sin_responder: 'Sin responder' };

/** Filas (con cabecera) para `XLSX.utils.aoa_to_sheet`. */
export function filasExcel(resumen: Resumen, preferencias: Preferencia[]): string[][] {
  const texto = new Map(preferencias.map((p) => [p.codigo, p.texto] as const));
  return [
    COLUMNAS_EXCEL,
    ...resumen.filas.map((f) => [
      f.nombre,
      RESPUESTA[f.estado],
      f.preferencia ? (texto.get(f.preferencia) ?? f.preferencia) : '',
      f.mensaje ?? '',
      f.actualizadoEn ? fechaHoraCorta(f.actualizadoEn) : '',
    ]),
  ];
}

export function nombreFicheroExcel(eventoId: string, hoy: string): string {
  return `Confirmaciones_${eventoId}_${hoy}.xlsx`;
}
