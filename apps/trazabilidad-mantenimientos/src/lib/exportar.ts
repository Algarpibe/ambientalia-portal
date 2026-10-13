/**
 * Exportar la F-ST-022 (lote 9e): lo poco que calcula la pantalla. El libro lo
 * genera hub-api (`exportacion.ts`) con la misma tabla que pinta la pestaña;
 * aquí sólo se decide con qué nombre se guarda y qué se dice de la última
 * exportación. Puro, sin reloj ni red.
 */
import type { RespuestaExportaciones } from '../dominio';
import { fmtFechaHora } from './vistas';

/** Lo que acompaña al botón: qué se exporta y que deja rastro. */
export const NOTA_EXPORTAR = 'Exporta la hoja entera, con los valores de hoy —no aplica los filtros ni el orden de la pantalla—. Cada exportación queda apuntada (quién y cuándo).';

/** El nombre de reserva, por si la cabecera no llega: el mismo que pone el servidor (`nombreFichero`, hub-api). */
export const nombrePorDefecto = (hoy: string): string => `F-ST-022 Trazabilidad Mttos Clientes ${hoy}.xlsx`;

/** El nombre que manda el servidor en Content-Disposition (expuesta por el CORS de hub-api); sin ella, el de reserva. Sólo el último tramo: nunca una ruta. */
export function nombreDeDescarga(contentDisposition: string | null, hoy: string): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition ?? '');
  let nombre = m?.[1] ?? '';
  try {
    nombre = decodeURIComponent(nombre);
  } catch {
    // Un «%» suelto en el nombre: se queda como vino.
  }
  return nombre.split(/[\\/]/).pop()?.trim() || nombrePorDefecto(hoy);
}

/** «Última exportación: quién el DD/MM/AAAA HH:MM · N filas…» (la hora, en Colombia); vacío mientras no se sabe. */
export function textoUltimaExportacion(r: RespuestaExportaciones | null): string {
  if (!r) return '';
  const u = r.ultima;
  if (!u) return 'Última exportación: todavía no se ha exportado ninguna.';
  const retirados = u.retirados > 0 ? ` y ${u.retirados} retirado${u.retirados === 1 ? '' : 's'}` : '';
  return `Última exportación: ${u.por} el ${fmtFechaHora(u.en)} · ${u.filas} fila${u.filas === 1 ? '' : 's'}${retirados} · ${r.total === 1 ? 'va' : 'van'} ${r.total}`;
}
