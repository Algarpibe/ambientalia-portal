import { describe, expect, it } from 'vitest';
import { EST, SIN_TICKET, aplicarFiltros, claveCliente, opcionesFiltro, type Fila, type TicketFila } from './index.js';

// Todo ficticio: ningún nombre de cliente real.
const z = (st: string): TicketFila => ({ n: '1', id: '1', st, stt: 'Open', u: '', m: '', enc: '', eq: '', srv: '', fs: '', cl: '' });
const f = (sn: string, c: string, st: string | null, est: Fila['est'] = EST.TALLER): Fila =>
  ({ id: sn, d: '2026-10-01', c, sn, est, src: '', why: [], x: null, z: st ? z(st) : null, zc: false, pa: [], xd: '', eq: '' });
const filas = [f('A1', 'Cliente Ejemplo S.A. E.S.P.', 'Notificación cliente'), f('A2', 'Cliente Ejemplo', 'Rev./Diagnostico'), f('A3', 'Alfa Ltda.', null),
  f('A4', 'Alfa', 'Notificación cliente'), f('A5', 'REACTIVO', 'Notificación cliente'), f('A6', 'Reactivo', 'Por Entregar')];

describe('filtros por cliente y estado en Zoho', () => {
  it('agrupa el mismo cliente escrito distinto', () => {
    expect(claveCliente('Cliente Ejemplo S.A. E.S.P.')).toBe(claveCliente('Cliente Ejemplo'));
    expect(claveCliente('Alfa Ltda.')).toBe('ALFA');
    expect(claveCliente('Análisis Demo S.A.S.')).toBe(claveCliente('ANALISIS DEMO'));
    expect(claveCliente('Z&OMEGA')).toBe('Z&OMEGA');
    expect(claveCliente('Luz Es')).toBe('LUZ ES');
  });
  it('opciones de cliente con su cantidad y el nombre más repetido', () => {
    expect(opcionesFiltro(filas, 'cliente', { cliente: '', zoho: '' }).map((o) => o.etiqueta + ' ' + o.n)).toEqual(['Alfa 2', 'Cliente Ejemplo 2', 'REACTIVO 2']);
  });
  it('estados de Zoho de mayor a menor, «Sin ticket» al final, y respetando el filtro de cliente', () => {
    expect(opcionesFiltro(filas, 'zoho', { cliente: '', zoho: '' }).map((o) => o.valor + ' ' + o.n)).toEqual(['Notificación cliente 3', 'Por Entregar 1', 'Rev./Diagnostico 1', SIN_TICKET + ' 1']);
    expect(opcionesFiltro(filas, 'zoho', { cliente: 'ALFA', zoho: '' }).map((o) => o.valor)).toEqual(['Notificación cliente', SIN_TICKET]);
  });
  it('aplica los dos filtros juntos', () => {
    expect(aplicarFiltros(filas, { cliente: 'CLIENTE EJEMPLO', zoho: '' }).map((r) => r.sn)).toEqual(['A1', 'A2']);
    expect(aplicarFiltros(filas, { cliente: '', zoho: SIN_TICKET }).map((r) => r.sn)).toEqual(['A3']);
    expect(aplicarFiltros(filas, { cliente: 'REACTIVO', zoho: 'Notificación cliente' }).map((r) => r.sn)).toEqual(['A5']);
  });
  it('el valor elegido sigue en la lista aunque en otra vista quede en 0', () => {
    expect(opcionesFiltro(filas.slice(0, 2), 'cliente', { cliente: 'REACTIVO', zoho: '' }).find((o) => o.valor === 'REACTIVO')?.n).toBe(0);
  });
});
