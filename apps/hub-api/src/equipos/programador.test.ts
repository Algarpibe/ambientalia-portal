import { afterEach, describe, expect, it, vi } from 'vitest';
import { detenerProgramadorEquipos, iniciarProgramadorEquipos, msHastaProxima } from './programador.js';

// El CUÁNDO de la corrida diaria: la HH:MM de Colombia (UTC−5 todo el año). Sin base: el
// ejecutor es un doble y el reloj, de mentira.
const t = (iso: string) => Date.parse(iso);
const MIN = 60_000;

describe('msHastaProxima (puro)', () => {
  it.each([
    ['a las 05:00 de Colombia faltan 90 min para las 06:30', '06:30', '2026-11-09T10:00:00.000Z', 90 * MIN],
    ['a las 07:00 de Colombia, la de mañana', '06:30', '2026-11-09T12:00:00.000Z', 23.5 * 60 * MIN],
    ['justo a las 06:30 de Colombia, la de mañana', '06:30', '2026-11-09T11:30:00.000Z', 24 * 60 * MIN],
    ['un milisegundo antes', '06:30', '2026-11-09T11:29:59.999Z', 1],
    ['cruzando la medianoche UTC (20:00 de Colombia)', '06:30', '2026-11-10T01:00:00.000Z', 10.5 * 60 * MIN],
    ['una hora de la noche de Colombia que en UTC es del día siguiente: 22:00', '22:00', '2026-11-09T12:00:00.000Z', 15 * 60 * MIN],
  ])('%s', (_caso, hora, ahora, ms) => {
    expect(msHastaProxima(hora, t(ahora))).toBe(ms);
  });
});

describe('iniciarProgramadorEquipos', () => {
  afterEach(() => {
    detenerProgramadorEquipos();
    vi.useRealTimers();
  });

  it('dispara a la hora, se vuelve a programar y no se enciende dos veces', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T10:00:00.000Z'));
    const ejecutar = vi.fn(async () => {});
    expect(iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} })).toBe(true);
    expect(iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} })).toBe(false);
    await vi.advanceTimersByTimeAsync(90 * MIN - 1);
    expect(ejecutar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it('no hay corrida de recuperación al arrancar después de la hora', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T15:00:00.000Z'));
    const ejecutar = vi.fn(async () => {});
    iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it('un fallo al empezar se apunta y el programador sigue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T11:29:00.000Z'));
    const log = vi.fn();
    const ejecutar = vi.fn(async () => { throw new Error('base caída'); });
    iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(log).toHaveBeenCalledWith('equipos-taller: la corrida programada no pudo empezar');
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ocupado', 'ya había una en curso'],
    ['sin_configurar', 'falta configurar'],
  ])('una corrida programada omitida (%s) deja una línea fija', async (estado, motivo) => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T11:29:00.000Z'));
    const log = vi.fn();
    const ejecutar = vi.fn(async () => ({ estado }));
    iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(log).toHaveBeenCalledWith('equipos-taller: corrida programada omitida (' + motivo + ')');
  });

  it('detenerlo cancela la siguiente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T10:00:00.000Z'));
    const ejecutar = vi.fn(async () => {});
    iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} });
    detenerProgramadorEquipos();
    await vi.advanceTimersByTimeAsync(2 * 60 * MIN);
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
