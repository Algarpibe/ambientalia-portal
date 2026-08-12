import type { EstadoSolicitud, TipoSolicitud } from './api';

/** Los cuatro tipos, en el orden en que se ofrecen en el formulario. */
export const TIPOS: { id: TipoSolicitud; label: string; ayuda: string }[] = [
  { id: 'vacaciones', label: 'Vacaciones', ayuda: 'Requiere aprobación.' },
  { id: 'compensatorio', label: 'Compensatorio', ayuda: 'Requiere aprobación.' },
  { id: 'permiso', label: 'Permiso', ayuda: 'Requiere aprobación. Puedes adjuntar un soporte en PDF.' },
  { id: 'incapacidad', label: 'Incapacidad', ayuda: 'No se aprueba: se informa. El soporte médico en PDF es obligatorio.' },
];

export const ETIQUETA_TIPO: Record<TipoSolicitud, string> = {
  vacaciones: 'Vacaciones',
  permiso: 'Permiso',
  compensatorio: 'Compensatorio',
  incapacidad: 'Incapacidad',
};

/** Solo la incapacidad se informa; el resto pasa por el visto bueno de alguien. */
export const requiereAprobacion = (t: TipoSolicitud) => t !== 'incapacidad';

/** Las clases van completas y literales: Tailwind purga lo que construya en runtime. */
export const CHIP_ESTADO: Record<EstadoSolicitud, { label: string; clase: string }> = {
  pendiente: { label: 'Pendiente', clase: 'bg-amber-100 text-amber-800 border-amber-200' },
  aprobada: { label: 'Aprobada', clase: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rechazada: { label: 'Rechazada', clase: 'bg-red-100 text-red-700 border-red-200' },
  registrada: { label: 'Registrada', clase: 'bg-sky-100 text-sky-800 border-sky-200' },
};

/** Etiqueta del campo de fecha según el tipo, como en los formularios de n8n. */
export function etiquetasFecha(tipo: TipoSolicitud): { inicio: string; fin: string } {
  const n: Record<TipoSolicitud, string> = {
    vacaciones: 'de vacaciones',
    permiso: 'de permiso',
    compensatorio: 'de compensatorio',
    incapacidad: 'de incapacidad',
  };
  return { inicio: `Fecha primer día ${n[tipo]}`, fin: `Fecha último día ${n[tipo]}` };
}

/**
 * Días hábiles entre dos fechas, con la MISMA regla que el servidor
 * (apps/hub-api/src/ausencias/dias-habiles.ts): ambas incluidas, sin sábados,
 * domingos ni festivos. Aquí es solo para el contador en vivo del formulario —
 * el valor que se guarda lo recalcula siempre el servidor.
 *
 * Toda la aritmética es en UTC sobre cadenas: el navegador del usuario está en
 * UTC−5 y `new Date('2026-07-06')` se interpreta como medianoche UTC, así que
 * mezclar métodos locales y UTC desplaza un día.
 */
export function contarDiasHabiles(desde: string, hasta: string, festivos: Set<string>): number {
  if (!desde || !hasta || desde > hasta) return 0;
  let dias = 0;
  let ms = Date.parse(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  // Cortafuegos: si alguien teclea un año de más, no bloqueamos la pestaña.
  if ((fin - ms) / 86_400_000 > 366) return 0;
  while (ms <= fin) {
    const d = new Date(ms);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !festivos.has(d.toISOString().slice(0, 10))) dias++;
    ms += 86_400_000;
  }
  return dias;
}

/** «6 jul 2026» — más corto que la fecha ISO y menos ambiguo que 06/07/2026. */
export function formatFecha(iso: string): string {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
