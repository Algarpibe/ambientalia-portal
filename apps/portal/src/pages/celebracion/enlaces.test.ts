import { describe, it, expect } from 'vitest';
import { fechaIcs, urlGoogleCalendar } from './enlaces';
import { eventoDePrueba } from './fixtures';

describe('enlaces del evento', () => {
  const evento = eventoDePrueba();

  it('fechaIcs pasa a UTC en formato básico', () => {
    expect(fechaIcs('2026-12-18T12:30:00-05:00')).toBe('20261218T173000Z');
  });

  it('Google Calendar lleva el título, las horas y el lugar', () => {
    const url = new URL(urlGoogleCalendar(evento));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Almuerzo de fin de año 2026');
    expect(url.searchParams.get('dates')).toBe('20261218T173000Z/20261218T210000Z');
    expect(url.searchParams.get('location')).toBe('Restaurante Anfitriona, Cl. 83 Bis #24-09, Bogotá D.C.');
  });
});
