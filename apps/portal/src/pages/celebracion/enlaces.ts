import type { Evento } from './tipos';

type Lugar = Pick<Evento, 'lugar' | 'direccion'>;

export function urlGoogleMaps(e: Lugar): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.lugar}, ${e.direccion}`)}`;
}

export function urlWaze(e: Lugar): string {
  return `https://waze.com/ul?q=${encodeURIComponent(e.direccion)}&navigate=yes`;
}

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

/** RFC 5545: barra invertida, punto y coma, coma y salto de línea se escapan. */
function escaparIcs(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function contenidoIcs(e: Evento, ahora: Date): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Ambientalia//Portal//ES',
      'BEGIN:VEVENT',
      `UID:${e.id}@portal.ambientalia.cloud`,
      `DTSTAMP:${fechaIcs(ahora.toISOString())}`,
      `DTSTART:${fechaIcs(e.inicio)}`,
      `DTEND:${fechaIcs(e.fin)}`,
      `SUMMARY:${escaparIcs(e.titulo)}`,
      `LOCATION:${escaparIcs(`${e.lugar}, ${e.direccion}`)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n') + '\r\n'
  );
}

export function nombreFicheroIcs(e: Pick<Evento, 'id'>): string {
  return `${e.id}.ics`;
}
