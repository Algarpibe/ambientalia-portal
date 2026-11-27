import { describe, it, expect, vi, afterEach } from 'vitest';
import { fechaDeHasta, hoyLocal, sumarMeses } from './fechas';

afterEach(() => {
  vi.useRealTimers();
});

describe('hoyLocal', () => {
  it('sin argumento lee el reloj y da la fecha local, no la UTC', () => {
    vi.useFakeTimers();
    // A las 23:30 en Colombia (UTC−5) ya es el día 27 en UTC.
    vi.setSystemTime(new Date(2026, 10, 26, 23, 30));
    expect(hoyLocal()).toBe('2026-11-26');
  });

  it('rellena mes y día con cero', () => {
    expect(hoyLocal(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05');
  });
});

describe('sumarMeses', () => {
  it('suma meses de calendario y conserva el día', () => {
    expect(sumarMeses('2026-11-26', 6)).toBe('2027-05-26');
  });

  it('cruza el año', () => {
    expect(sumarMeses('2026-07-15', 6)).toBe('2027-01-15');
  });

  it('si el día no existe en el mes de llegada, se queda en el último', () => {
    expect(sumarMeses('2026-03-31', 6)).toBe('2026-09-30');
  });

  it('31 de agosto + 6 meses es el 28 de febrero en un año normal', () => {
    expect(sumarMeses('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('y el 29 de febrero en un año bisiesto', () => {
    expect(sumarMeses('2027-08-31', 6)).toBe('2028-02-29');
  });
});

// Los casos que Prospectos prueba a través de groupProspects, ahora directos.
describe('fechaDeHasta', () => {
  it('saca la fecha AAAA-MM-DD del formato del dataset', () => {
    expect(fechaDeHasta('2027-04-21T00:00:00.000')).toBe('2027-04-21');
  });

  it('«---» no es una fecha', () => {
    expect(fechaDeHasta('---')).toBeNull();
  });

  it('recorta los espacios', () => {
    expect(fechaDeHasta('  2027-04-21T00:00:00.000 ')).toBe('2027-04-21');
  });

  it('un formato raro o vacío no es una fecha', () => {
    expect(fechaDeHasta('21/04/2027')).toBeNull();
    expect(fechaDeHasta('')).toBeNull();
  });
});
