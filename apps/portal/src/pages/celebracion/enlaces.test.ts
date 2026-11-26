import { describe, it, expect } from 'vitest';
import { contenidoIcs, fechaIcs, nombreFicheroIcs, urlGoogleCalendar, urlGoogleMaps, urlWaze } from './enlaces';
import { eventoDePrueba } from './fixtures';

describe('enlaces del evento', () => {
  const evento = eventoDePrueba();

  it('fechaIcs pasa a UTC en formato básico', () => {
    expect(fechaIcs('2026-12-18T12:30:00-05:00')).toBe('20261218T173000Z');
  });

  it('Maps y Waze llevan la dirección codificada', () => {
    expect(urlGoogleMaps(evento)).toBe(
      'https://www.google.com/maps/search/?api=1&query=Restaurante%20Anfitriona%2C%20Cl.%2083%20Bis%20%2324-09%2C%20Bogot%C3%A1%20D.C.',
    );
    expect(urlWaze(evento)).toBe('https://waze.com/ul?q=Cl.%2083%20Bis%20%2324-09%2C%20Bogot%C3%A1%20D.C.&navigate=yes');
  });

  it('Google Calendar lleva el título, las horas y el lugar', () => {
    const url = new URL(urlGoogleCalendar(evento));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Almuerzo de fin de año 2026');
    expect(url.searchParams.get('dates')).toBe('20261218T173000Z/20261218T210000Z');
    expect(url.searchParams.get('location')).toBe('Restaurante Anfitriona, Cl. 83 Bis #24-09, Bogotá D.C.');
  });

  it('el .ics es válido: CRLF, UTC y comas escapadas', () => {
    const ics = contenidoIcs(evento, new Date('2026-11-27T10:00:00Z'));
    const lineas = ics.split('\r\n');
    expect(lineas[0]).toBe('BEGIN:VCALENDAR');
    expect(lineas).toContain('DTSTART:20261218T173000Z');
    expect(lineas).toContain('DTEND:20261218T210000Z');
    expect(lineas).toContain('DTSTAMP:20261127T100000Z');
    expect(lineas).toContain('UID:fin-de-ano-2026@portal.ambientalia.cloud');
    expect(lineas).toContain('LOCATION:Restaurante Anfitriona\\, Cl. 83 Bis #24-09\\, Bogotá D.C.');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(nombreFicheroIcs(evento)).toBe('fin-de-ano-2026.ics');
  });
});
