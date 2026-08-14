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

interface Chip {
  label: string;
  clase: string;
}

/** Las clases van completas y literales: Tailwind purga lo que construya en runtime. */
export const CHIP_ESTADO: Record<EstadoSolicitud, Chip> = {
  pendiente: { label: 'Pendiente', clase: 'bg-amber-100 text-amber-800 border-amber-200' },
  // Naranja y no ámbar para distinguir de un vistazo la media firma de la que
  // todavía no tiene ninguna.
  pendiente_2: { label: 'Pendiente 2ª firma', clase: 'bg-orange-100 text-orange-800 border-orange-200' },
  aprobada: { label: 'Aprobada', clase: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  rechazada: { label: 'Rechazada', clase: 'bg-red-100 text-red-700 border-red-200' },
  registrada: { label: 'Registrada', clase: 'bg-sky-100 text-sky-800 border-sky-200' },
};

const CHIP_DESCONOCIDO = 'bg-gray-100 text-gray-700 border-gray-200';

/**
 * El chip de un estado, con red de seguridad.
 *
 * El acceso directo al Record revienta la tabla entera —y con ella la pestaña—
 * si el backend devuelve un estado que este bundle no conoce. Pasa de verdad:
 * hub-api y el portal son dos servicios de EasyPanel y se despliegan por
 * separado, así que hay una ventana de minutos en que uno va por delante.
 */
export const chipDe = (estado: EstadoSolicitud): Chip =>
  CHIP_ESTADO[estado] ?? { label: estado, clase: CHIP_DESCONOCIDO };

/** True si la solicitud todavía espera la firma de alguien. */
export const enTramite = (estado: EstadoSolicitud) => estado === 'pendiente' || estado === 'pendiente_2';

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

/**
 * La fecha de hoy en Colombia (UTC−5, sin horario de verano). Espejo de
 * `hoyEnColombia` en `apps/hub-api/src/ausencias/saldo.ts`.
 *
 * No vale `new Date().toISOString().slice(0, 10)` ni los métodos locales del
 * navegador: el servidor valida contra la hora de Colombia, así que si el
 * formulario se guiara por la zona del equipo, alguien fuera del país vería
 * habilitado un día que el servidor va a rechazar —o bloqueado uno que aceptaría.
 * Se resta el desfase ANTES de tomar la fecha, por lo mismo que en el servidor.
 */
export function hoyEnColombia(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Un decimal, y sin el «,0» cuando es entero. El formato de los días en toda la app. */
export function formatDias(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
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

/**
 * Un instante (un `timestamptz` de la BD, como `decididaAt`) en hora de Colombia.
 *
 * No vale `formatFecha`: espera `YYYY-MM-DD` y le concatena `T00:00:00Z`, así que
 * con un timestamp completo devuelve «Invalid Date». Y tampoco vale cortar los
 * diez primeros caracteres, que es lo que primero se piensa: el servidor guarda
 * en UTC y Colombia es UTC−5, de modo que una decisión tomada a las 20:00 en
 * Bogotá se vería fechada al día siguiente.
 */
export function formatInstante(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}
