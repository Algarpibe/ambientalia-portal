import { describe, it, expect } from 'vitest';
import { compararValores, traeAnticipos, columnasDisponibles, celdaAnticipo, motivoLegible, estadoAnticipo } from './ovTabla';
import { formatCOP } from './format';

describe('compararValores', () => {
  it('ordena números por valor', () => {
    expect(compararValores(2, 10)).toBeLessThan(0);
  });
  it('una OV sin anticipo (null) va por debajo de un anticipo de 0', () => {
    expect(compararValores(null, 0)).toBeLessThan(0);
    expect(compararValores(0, null)).toBeGreaterThan(0);
  });
  it('dos vacíos empatan', () => {
    expect(compararValores(null, null)).toBe(0);
  });
  it('los textos van en orden alfabético español', () => {
    expect(compararValores('Ñandú', 'Oso')).toBeLessThan(0);
  });
});

describe('traeAnticipos', () => {
  it('solo si las filas traen el campo, aunque valga null', () => {
    expect(traeAnticipos([{ anticipoCobrado: null }])).toBe(true);
    expect(traeAnticipos([{ salesorder_number: 'OV-1' }])).toBe(false);
    expect(traeAnticipos([])).toBe(false);
    expect(traeAnticipos(null)).toBe(false);
  });
});

describe('columnasDisponibles', () => {
  it('sin acceso quita las dos columnas de anticipo y conserva el orden del resto', () => {
    const orden = ['status', 'anticipoCobrado', 'pending', 'anticipoSinAplicar'];
    expect(columnasDisponibles(orden, false)).toEqual(['status', 'pending']);
    expect(columnasDisponibles(orden, true)).toEqual(orden);
  });
});

describe('celdaAnticipo', () => {
  it('«—» si la OV no tiene anticipos; el importe si los tiene, aunque sea 0', () => {
    expect(celdaAnticipo(null)).toBe('—');
    expect(celdaAnticipo(undefined)).toBe('—');
    expect(celdaAnticipo(0)).toBe(formatCOP(0));
    expect(celdaAnticipo(9505784)).toBe(formatCOP(9505784));
  });
});

describe('motivoLegible', () => {
  it('explica cada motivo y distingue la OV facturada de la anulada', () => {
    expect(motivoLegible({ motivo: 'sin_referencia', estadoOV: null })).toMatch(/no nombra ninguna OV/);
    expect(motivoLegible({ motivo: 'varias_ov', estadoOV: null })).toMatch(/varias OV/);
    expect(motivoLegible({ motivo: 'ov_inexistente', estadoOV: null })).toMatch(/no existe/);
    expect(motivoLegible({ motivo: 'moneda_distinta', estadoOV: 'open' })).toMatch(/monedas distintas/);
    expect(motivoLegible({ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'invoiced' })).toMatch(/facturada/);
    expect(motivoLegible({ motivo: 'sin_aplicar_ov_cerrada', estadoOV: 'void' })).toMatch(/anulada/);
  });
});

describe('estadoAnticipo', () => {
  it('traduce los estados de Zoho y deja pasar los desconocidos', () => {
    expect(estadoAnticipo('paid')).toBe('Pagado');
    expect(estadoAnticipo('partially_paid')).toBe('Pago parcial');
    expect(estadoAnticipo('raro')).toBe('raro');
    expect(estadoAnticipo(null)).toBe('—');
  });
});
