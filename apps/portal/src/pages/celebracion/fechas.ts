// Fechas de la invitación, siempre en hora de Bogotá (el evento es allí y el
// navegador puede estar en otra zona).

const ZONA = 'America/Bogota';

export interface Cuenta {
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
}

export function cuentaAtras(objetivo: Date, ahora: Date): Cuenta {
  const total = Math.max(0, Math.floor((objetivo.getTime() - ahora.getTime()) / 1000));
  return {
    dias: Math.floor(total / 86_400),
    horas: Math.floor(total / 3_600) % 24,
    minutos: Math.floor(total / 60) % 60,
    segundos: total % 60,
  };
}

const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** «Viernes, 18 de diciembre de 2026». */
export function fechaLarga(iso: string): string {
  return conMayuscula(
    new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA }).format(
      new Date(iso),
    ),
  );
}

/** «12:30 p. m.». */
export function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: ZONA }).format(new Date(iso));
}

/** «4 de diciembre». */
export function diaYMes(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: ZONA }).format(new Date(iso));
}

/** «2026-12-01 10:00» (el formato sueco da justo AAAA-MM-DD HH:MM). */
export function fechaHoraCorta(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONA,
  }).format(new Date(iso));
}
