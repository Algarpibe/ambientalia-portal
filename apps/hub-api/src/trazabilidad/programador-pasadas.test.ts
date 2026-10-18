import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { RECUPERACION_MS, detenerPasadasNocturnas, iniciarPasadasNocturnas, msHastaProximaPasada, pasadaNocturnaSinFallar, reiniciarPasadasNocturnas, yaPasoLaHoraHoy } from './programador-pasadas.js';

// El CUÁNDO de las pasadas nocturnas (lote 10): cada noche a las 02:00 de Colombia (UTC−5 todo el año, sin horario
// de verano: las 07:00 UTC) y, al arrancar después de esa hora, una de recuperación a los dos minutos. Sin base: el
// ejecutor es un doble y el reloj es de mentira. Qué hace cada pasada: pasadas-nocturnas-repo.test.ts.

const db = {} as Pool;
const t = (iso: string) => Date.parse(iso);
const HORA = 3_600_000;
const DIA = 24 * HORA;

describe('a qué hora sale (puro)', () => {
  it.each([
    ['00:00 UTC (las 19:00 en Colombia del día antes)', '2026-10-19T00:00:00.000Z', 7 * HORA],
    ['cruzando la medianoche UTC: 23:30 UTC', '2026-10-18T23:30:00.000Z', 7.5 * HORA],
    ['un milisegundo antes de las 02:00 de Colombia', '2026-10-19T06:59:59.999Z', 1],
    ['justo a las 02:00 de Colombia: la de mañana', '2026-10-19T07:00:00.000Z', DIA],
    ['un milisegundo después', '2026-10-19T07:00:00.001Z', DIA - 1],
    ['a mediodía', '2026-10-19T17:00:00.000Z', 14 * HORA],
    ['en Nochevieja, a las 15:00 de Colombia: la del 1 de enero', '2026-12-31T20:00:00.000Z', 11 * HORA],
    ['el 28 de febrero de un año no bisiesto', '2027-02-28T08:00:00.000Z', 23 * HORA],
  ])('%s', (_caso, ahora, ms) => {
    expect(msHastaProximaPasada(t(ahora))).toBe(ms);
    expect(new Date(t(ahora) + ms).toISOString().slice(11)).toBe('07:00:00.000Z');
  });

  it.each([
    ['2026-10-19T06:59:59.999Z', false], // 01:59 en Colombia
    ['2026-10-19T07:00:00.000Z', true], // 02:00
    ['2026-10-19T04:59:59.999Z', true], // 23:59 del 18 en Colombia: ese día ya pasó su 02:00
    ['2026-10-19T05:00:00.000Z', false], // 00:00 del 19 en Colombia
    ['2026-10-19T22:00:00.000Z', true],
  ])('a las %s, ¿ya pasó la hora de hoy en Colombia? %s', (ahora, si) => {
    expect(yaPasoLaHoraHoy(t(ahora))).toBe(si);
  });
});

let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  reiniciarPasadasNocturnas();
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  reiniciarPasadasNocturnas();
  error.mockRestore();
  vi.useRealTimers();
});

describe('el programador', () => {
  it('arrancado antes de las 02:00 de Colombia: sin recuperación, sale a las 02:00 y luego cada 24 horas', async () => {
    vi.setSystemTime(t('2026-10-19T05:00:00.000Z')); // 00:00 en Colombia
    const ejecutar = vi.fn(async () => {});
    expect(iniciarPasadasNocturnas(db, { ejecutar })).toBe(true);
    await vi.advanceTimersByTimeAsync(2 * HORA - 1);
    expect(ejecutar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(ejecutar).toHaveBeenCalledWith(db);
    await vi.advanceTimersByTimeAsync(DIA - 1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3 * DIA);
    expect(ejecutar).toHaveBeenCalledTimes(5);
  });

  it('arrancado después de las 02:00 de Colombia: una de recuperación a los dos minutos (el ejecutor no repite lo que ya tiene fila de hoy) y la de la noche, a su hora', async () => {
    expect(RECUPERACION_MS).toBe(2 * 60_000);
    vi.setSystemTime(t('2026-10-19T15:00:00.000Z')); // 10:00 en Colombia: tras un despliegue
    const ejecutar = vi.fn(async () => {});
    iniciarPasadasNocturnas(db, { ejecutar });
    await vi.advanceTimersByTimeAsync(RECUPERACION_MS - 1);
    expect(ejecutar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(16 * HORA - RECUPERACION_MS - 1); // hasta las 07:00 UTC del 20
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it('no se arranca dos veces, se apaga y se puede volver a encender', async () => {
    vi.setSystemTime(t('2026-10-19T05:00:00.000Z'));
    const ejecutar = vi.fn(async () => {});
    expect(iniciarPasadasNocturnas(db, { ejecutar })).toBe(true);
    expect(iniciarPasadasNocturnas(db, { ejecutar })).toBe(false);
    detenerPasadasNocturnas();
    await vi.advanceTimersByTimeAsync(3 * DIA);
    expect(ejecutar).not.toHaveBeenCalled();
    expect(iniciarPasadasNocturnas(db, { ejecutar })).toBe(true);
    await vi.advanceTimersByTimeAsync(DIA);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('un fallo se apunta (consola) y no para el programador: la noche siguiente sale igual', async () => {
    vi.setSystemTime(t('2026-10-19T05:00:00.000Z'));
    const ejecutar = vi.fn(async () => Promise.reject(new Error('fallo')));
    iniciarPasadasNocturnas(db, { ejecutar });
    await vi.advanceTimersByTimeAsync(2 * HORA);
    expect(error).toHaveBeenCalledWith('tmc_pasadas_nocturnas error', expect.any(Error));
    await vi.advanceTimersByTimeAsync(DIA);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it('no deja los temporizadores reteniendo el proceso (unref)', () => {
    vi.setSystemTime(t('2026-10-19T15:00:00.000Z'));
    const unref = vi.fn();
    const original = globalThis.setTimeout;
    const espia = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => Object.assign(original(fn, ms), { unref })) as unknown as typeof setTimeout);
    iniciarPasadasNocturnas(db, { ejecutar: async () => {} });
    expect(unref).toHaveBeenCalledTimes(2); // la de recuperación y la de la noche
    espia.mockRestore();
  });

  it('una sola pasada a la vez: quien llega mientras hay una en curso se cuelga de ella', async () => {
    let soltar: () => void = () => {};
    const ejecutar = vi.fn(() => new Promise<void>((ok) => (soltar = ok)));
    const a = pasadaNocturnaSinFallar(db, ejecutar);
    const b = pasadaNocturnaSinFallar(db, ejecutar);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    soltar();
    await Promise.all([a, b]);
    const c = pasadaNocturnaSinFallar(db, ejecutar);
    expect(ejecutar).toHaveBeenCalledTimes(2);
    soltar();
    await c;
  });
});

// CANDADO (la parte del programador; la del ejecutor y la decisión, en pasadas-nocturnas-repo.test.ts): el programador
// sólo decide CUÁNDO. No lee Desk 2.0 ni la base por su cuenta, no escribe nada y no envía nada: llama al ejecutor, que
// sólo cambia datos a través de los aplicadores de siempre. Y sólo lo enciende index.ts, tras inicializar la base.
describe('CANDADO: el programador', () => {
  const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  const src = fuente('./programador-pasadas.ts');

  it('sólo importa el ejecutor y Sentry; no escribe ni envía nada', () => {
    const imports = [...src.matchAll(/^import .* from '(\.[^']+)';\r?$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../sentry.js', './pasadas-nocturnas-repo.js']);
    expect(src).not.toMatch(/\.query\(|INSERT|UPDATE|DELETE|portal\.tmc_|sincronizarMaestro|sincronizarCalibraciones/);
    expect(src).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|correo|destinatari|\benviar\b|setInterval/i);
  });

  it('sólo index.ts lo enciende (las pruebas no importan index.ts: no hay temporizadores sueltos)', () => {
    const RAIZ = fileURLToPath(new URL('..', import.meta.url));
    const fuentes = (readdirSync(RAIZ, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('test-db/'));
    const encienden = fuentes.filter((f) => /\biniciarPasadasNocturnas\(/.test(readFileSync(`${RAIZ}/${f}`, 'utf8')));
    expect(encienden.sort()).toEqual(['index.ts', 'trazabilidad/programador-pasadas.ts']);
  });
});
