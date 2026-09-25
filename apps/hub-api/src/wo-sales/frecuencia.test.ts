import { describe, it, expect } from 'vitest';
import { ultimaFranja, decidirEnvioDestinatario, validarPreferencia, type PreferenciaEnvio } from './frecuencia.js';

// Hora de Colombia (UTC-5, sin horario de verano) → instante UTC.
const bog = (iso: string) => new Date(`${iso}-05:00`);

const diario8: PreferenciaEnvio = { frecuencia: 'diario', hora: 8, diaSemana: null };
const lunes9: PreferenciaEnvio = { frecuencia: 'semanal', hora: 9, diaSemana: 1 };
const finMes18: PreferenciaEnvio = { frecuencia: 'fin_de_mes', hora: 18, diaSemana: null };

describe('ultimaFranja (hora de Colombia)', () => {
  it('diario: hoy a la hora si ya pasó; si no, ayer', () => {
    expect(ultimaFranja(diario8, bog('2026-09-25T10:00'))).toEqual(bog('2026-09-25T08:00'));
    expect(ultimaFranja(diario8, bog('2026-09-25T07:59'))).toEqual(bog('2026-09-24T08:00'));
  });

  it('semanal: el último lunes a la hora', () => {
    // 2026-09-25 es viernes → último lunes 2026-09-21.
    expect(ultimaFranja(lunes9, bog('2026-09-25T10:00'))).toEqual(bog('2026-09-21T09:00'));
    // Lunes antes de la hora → el lunes anterior.
    expect(ultimaFranja(lunes9, bog('2026-09-21T08:00'))).toEqual(bog('2026-09-14T09:00'));
  });

  it('fin de mes: el último día del mes a la hora (o el del mes anterior)', () => {
    expect(ultimaFranja(finMes18, bog('2026-09-30T19:00'))).toEqual(bog('2026-09-30T18:00'));
    expect(ultimaFranja(finMes18, bog('2026-09-25T10:00'))).toEqual(bog('2026-08-31T18:00'));
    expect(ultimaFranja(finMes18, bog('2026-03-05T10:00'))).toEqual(bog('2026-02-28T18:00'));
  });

  it('inmediato y nunca no tienen franja', () => {
    expect(ultimaFranja({ frecuencia: 'inmediato', hora: null, diaSemana: null }, new Date())).toBeNull();
    expect(ultimaFranja({ frecuencia: 'nunca', hora: null, diaSemana: null }, new Date())).toBeNull();
  });
});

describe('decidirEnvioDestinatario', () => {
  const token = 'H2';
  const ahora = bog('2026-09-25T10:00');

  it('inmediato: envía si hay cambios, sin franja', () => {
    const pref = { frecuencia: 'inmediato', hora: null, diaSemana: null } as const;
    expect(decidirEnvioDestinatario({ hashRecibido: 'H1', preferencia: pref, ultimoCorte: null }, token, ahora))
      .toEqual({ enviar: true, franja: null });
    expect(decidirEnvioDestinatario({ hashRecibido: 'H2', preferencia: pref, ultimoCorte: null }, token, ahora))
      .toEqual({ enviar: false, franja: null });
  });

  it('nunca: no envía aunque haya cambios', () => {
    const pref = { frecuencia: 'nunca', hora: null, diaSemana: null } as const;
    expect(decidirEnvioDestinatario({ hashRecibido: 'H1', preferencia: pref, ultimoCorte: null }, token, ahora).enviar)
      .toBe(false);
  });

  it('franja nueva con cambios: envía y la franja se sella al confirmar', () => {
    const r = decidirEnvioDestinatario(
      { hashRecibido: 'H1', preferencia: diario8, ultimoCorte: bog('2026-09-24T08:00') }, token, ahora);
    expect(r).toEqual({ enviar: true, franja: bog('2026-09-25T08:00') });
  });

  it('franja nueva SIN cambios: no envía pero la franja se cierra (un cambio posterior espera a mañana)', () => {
    const r = decidirEnvioDestinatario(
      { hashRecibido: 'H2', preferencia: diario8, ultimoCorte: bog('2026-09-24T08:00') }, token, ahora);
    expect(r).toEqual({ enviar: false, franja: bog('2026-09-25T08:00') });
  });

  it('franja ya procesada: no envía aunque llegue un cambio después de la hora', () => {
    const r = decidirEnvioDestinatario(
      { hashRecibido: 'H1', preferencia: diario8, ultimoCorte: bog('2026-09-25T08:00') }, token, ahora);
    expect(r).toEqual({ enviar: false, franja: null });
  });
});

describe('validarPreferencia', () => {
  it('acepta cada frecuencia con sus campos', () => {
    expect(validarPreferencia({ frecuencia: 'inmediato' })).toEqual({ ok: true, preferencia: { frecuencia: 'inmediato', hora: null, diaSemana: null } });
    expect(validarPreferencia({ frecuencia: 'diario', hora: 8 })).toEqual({ ok: true, preferencia: diario8 });
    expect(validarPreferencia({ frecuencia: 'semanal', hora: 9, diaSemana: 1 })).toEqual({ ok: true, preferencia: lunes9 });
    expect(validarPreferencia({ frecuencia: 'fin_de_mes', hora: 18 })).toEqual({ ok: true, preferencia: finMes18 });
  });

  it('rechaza frecuencia desconocida, hora fuera de rango y semanal sin día', () => {
    expect(validarPreferencia({ frecuencia: 'quincenal' }).ok).toBe(false);
    expect(validarPreferencia({ frecuencia: 'diario', hora: 24 }).ok).toBe(false);
    expect(validarPreferencia({ frecuencia: 'diario' }).ok).toBe(false);
    expect(validarPreferencia({ frecuencia: 'semanal', hora: 9 }).ok).toBe(false);
    expect(validarPreferencia({ frecuencia: 'semanal', hora: 9, diaSemana: 8 }).ok).toBe(false);
  });
});
