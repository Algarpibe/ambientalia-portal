import type { Evento } from './tipos';

/** 2026-12-18T12:30:00-05:00 → 20261218T173000Z (UTC, formato básico de iCalendar). */
export function fechaIcs(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function urlGoogleCalendar(e: Evento): string {
  const parametros = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.titulo,
    dates: `${fechaIcs(e.inicio)}/${fechaIcs(e.fin)}`,
    details: `${e.titulo} del equipo Ambientalia.`,
    location: `${e.lugar}, ${e.direccion}`,
  });
  return `https://calendar.google.com/calendar/render?${parametros.toString()}`;
}
