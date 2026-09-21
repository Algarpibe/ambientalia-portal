import { describe, it, expect, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { extraerOV, enlazarAnticipos, conAnticipo, getAnticiposEnlazados, type AnticipoRow, type OVRef } from './anticipos.js';

describe('extraerOV', () => {
  // Esta tabla ES la especificación de cómo se escribe un anticipo en Zoho. Una forma nueva
  // que aparezca en los datos reales se añade aquí primero.
  it.each([
    ['Anticipo OV-2026-167', ['OV-2026-167']],
    ['anticipo ov-2026-167', ['OV-2026-167']],
    ['Anticipo OV 2026-167', ['OV-2026-167']],
    ['Anticipo OV2026-167', ['OV-2026-167']],
    ['Anticipo OV-2026-0167', ['OV-2026-167']],
    ['Anticipo OV–2026–167', ['OV-2026-167']],
    ['Anticipo OV-2026-5', ['OV-2026-005']],
    ['Anticipo OV-2026-1000', ['OV-2026-1000']],
    ['Anticipo OV-2026-150 y OV-2026-151', ['OV-2026-150', 'OV-2026-151']],
    ['Anticipo OV-2026-167 | OV-2026-167', ['OV-2026-167']],
    ['Anticipo 50% del pedido', []],
    ['MOV-2026-167', []],
    ['Anticipo OV-26-167', []],
    ['', []],
  ])('%s → %j', (texto, esperado) => {
    expect(extraerOV(texto)).toEqual(esperado);
  });
});

// Caso real: ANT-2026-063 de SGS Colombia, cobrado entero el 15-sep y sin aplicar aún.
const ant = (over: Partial<AnticipoRow>): AnticipoRow => ({
  numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cliente: 'SGS Colombia S.A.S.',
  moneda: 'COP', cobrado: '9505784', aplicado: '0', referencia: null,
  descripciones: ['Anticipo OV-2026-167'], ...over,
});
const OV167: OVRef = { numero: 'OV-2026-167', estado: 'open', moneda: 'COP' };

describe('enlazarAnticipos', () => {
  it('caso real ANT-2026-063: suma en OV-2026-167 y no genera aviso', () => {
    const r = enlazarAnticipos([ant({})], [OV167]);
    expect(r.porOV.get('OV-2026-167')).toEqual({
      cobrado: 9505784,
      sinAplicar: 9505784,
      anticipos: [{ numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cobrado: 9505784, sinAplicar: 9505784 }],
    });
    expect(r.atencion).toEqual([]);
  });

  it('suma varios anticipos de la misma OV', () => {
    const r = enlazarAnticipos([
      ant({ numero: 'A1', cobrado: 100, aplicado: 0 }),
      ant({ numero: 'A2', cobrado: 50, aplicado: 50 }),
    ], [OV167]);
    expect(r.porOV.get('OV-2026-167')).toMatchObject({ cobrado: 150, sinAplicar: 100 });
  });

  it('lo sin aplicar nunca es negativo', () => {
    const r = enlazarAnticipos([ant({ cobrado: 100, aplicado: 120 })], [OV167]);
    expect(r.porOV.get('OV-2026-167')!.sinAplicar).toBe(0);
  });

  it('un anticipo aún sin cobrar enlaza con cobrado 0', () => {
    const r = enlazarAnticipos([ant({ estado: 'sent', cobrado: null, aplicado: null })], [OV167]);
    expect(r.porOV.get('OV-2026-167')).toMatchObject({ cobrado: 0, sinAplicar: 0 });
  });

  it('lee la OV también de la referencia', () => {
    const r = enlazarAnticipos([ant({ descripciones: ['Anticipo 50%'], referencia: 'OV-2026-167' })], [OV167]);
    expect(r.porOV.has('OV-2026-167')).toBe(true);
  });

  it('sin_referencia: la descripción no nombra ninguna OV', () => {
    const r = enlazarAnticipos([ant({ descripciones: ['Anticipo 50% del pedido'] })], [OV167]);
    expect(r.atencion).toMatchObject([{ numero: 'ANT-2026-063', motivo: 'sin_referencia', ov: null, texto: 'Anticipo 50% del pedido' }]);
    expect(r.porOV.size).toBe(0);
  });

  it('varias_ov: no reparte el importe', () => {
    const r = enlazarAnticipos([ant({ descripciones: ['Anticipo OV-2026-150 y OV-2026-151'] })], []);
    expect(r.atencion).toMatchObject([{ motivo: 'varias_ov', ov: 'OV-2026-150, OV-2026-151' }]);
    expect(r.porOV.size).toBe(0);
  });

  it('descripción y referencia con OV distintas cuentan como varias', () => {
    const r = enlazarAnticipos([ant({ referencia: 'OV-2026-168' })], [OV167]);
    expect(r.atencion[0].motivo).toBe('varias_ov');
  });

  it('ov_inexistente: el número no está en Zoho', () => {
    const r = enlazarAnticipos([ant({})], []);
    expect(r.atencion).toMatchObject([{ motivo: 'ov_inexistente', ov: 'OV-2026-167', estadoOV: null }]);
  });

  it('moneda_distinta: no suma pesos con dólares', () => {
    const r = enlazarAnticipos([ant({ moneda: 'USD' })], [OV167]);
    expect(r.atencion).toMatchObject([{ motivo: 'moneda_distinta', ov: 'OV-2026-167' }]);
    expect(r.porOV.size).toBe(0);
  });

  it('sin_aplicar_ov_cerrada: OV ya facturada con saldo sin aplicar', () => {
    const r = enlazarAnticipos([ant({})], [{ ...OV167, estado: 'invoiced' }]);
    expect(r.atencion).toMatchObject([{ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'invoiced', sinAplicar: 9505784 }]);
  });

  it('sin_aplicar_ov_cerrada también en una OV anulada', () => {
    const r = enlazarAnticipos([ant({})], [{ ...OV167, estado: 'void' }]);
    expect(r.atencion[0]).toMatchObject({ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'void' });
  });

  it('OV cerrada con el anticipo ya aplicado del todo: sin aviso', () => {
    const r = enlazarAnticipos([ant({ aplicado: '9505784' })], [{ ...OV167, estado: 'invoiced' }]);
    expect(r.atencion).toEqual([]);
  });

  it('la moneda gana a la OV cerrada (orden de los motivos)', () => {
    const r = enlazarAnticipos([ant({ moneda: 'USD' })], [{ ...OV167, estado: 'invoiced' }]);
    expect(r.atencion[0].motivo).toBe('moneda_distinta');
  });

  it('la lista de atención va de más reciente a más antigua', () => {
    const r = enlazarAnticipos([
      ant({ numero: 'viejo', fecha: '2026-07-01', descripciones: ['x'] }),
      ant({ numero: 'nuevo', fecha: '2026-09-01', descripciones: ['y'] }),
    ], []);
    expect(r.atencion.map((a) => a.numero)).toEqual(['nuevo', 'viejo']);
  });
});

describe('conAnticipo', () => {
  it('añade los importes sin tocar el original, y null si la OV no tiene anticipos', () => {
    const enl = enlazarAnticipos([ant({})], [OV167]);
    const original = { salesorder_number: 'OV-2026-167' };
    expect(conAnticipo(original, enl)).toEqual({ salesorder_number: 'OV-2026-167', anticipoCobrado: 9505784, anticipoSinAplicar: 9505784 });
    expect(original).toEqual({ salesorder_number: 'OV-2026-167' });
    expect(conAnticipo({ salesorder_number: 'OV-2026-999' }, enl)).toMatchObject({ anticipoCobrado: null, anticipoSinAplicar: null });
  });
});

describe('getAnticiposEnlazados', () => {
  it('saca las descripciones de raw, consulta solo las OV nombradas y enlaza', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        numero: 'ANT-2026-063', fecha: '2026-09-15', estado: 'paid', cliente: 'SGS Colombia S.A.S.', moneda: 'COP',
        cobrado: '9505784', aplicado: '0', referencia: null,
        lineas: [{ description: 'Anticipo OV-2026-167' }, { description: '' }, { otra: 1 }],
      }] })
      .mockResolvedValueOnce({ rows: [{ numero: 'OV-2026-167', estado: 'open', moneda: 'COP' }] });
    const r = await getAnticiposEnlazados({ query } as unknown as Pool);
    expect(query.mock.calls[1][1]).toEqual([['OV-2026-167']]);
    expect(r.porOV.get('OV-2026-167')).toMatchObject({ cobrado: 9505784, sinAplicar: 9505784 });
    expect(r.atencion).toEqual([]);
  });

  it('sin anticipos no consulta las OV', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const r = await getAnticiposEnlazados({ query } as unknown as Pool);
    expect(query).toHaveBeenCalledTimes(1);
    expect(r.porOV.size).toBe(0);
    expect(r.atencion).toEqual([]);
  });

  it('lineas que no son una lista no rompen: el anticipo va al aviso', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      numero: 'ANT-X', fecha: null, estado: 'paid', cliente: null, moneda: 'COP',
      cobrado: 1, aplicado: 0, referencia: null, lineas: null,
    }] });
    const r = await getAnticiposEnlazados({ query } as unknown as Pool);
    expect(r.atencion).toMatchObject([{ numero: 'ANT-X', motivo: 'sin_referencia' }]);
  });
});
