import { describe, it, expect } from 'vitest';
import { parseClientesState, type ClientesViewState } from './clientes-view-state';

const valido: ClientesViewState = {
  tipo: 'INVOICE',
  desdeAnio: 2022,
  hastaAnio: 2025,
  search: 'acme',
  sortKey: 'total',
  sortDir: 'desc',
  comparar: true,
  anioA: 2025,
  anioB: 2024,
  onlyFav: true,
};

describe('parseClientesState', () => {
  it('un objeto válido → parsea idéntico', () => {
    expect(parseClientesState(valido)).toEqual(valido);
  });

  it('acepta sortKey numérico (año)', () => {
    const s = parseClientesState({ ...valido, sortKey: 2023 });
    expect(s?.sortKey).toBe(2023);
  });

  it('no es objeto → null', () => {
    expect(parseClientesState(null)).toBeNull();
    expect(parseClientesState('x')).toBeNull();
    expect(parseClientesState(42)).toBeNull();
  });

  it('tipo inválido → null', () => {
    expect(parseClientesState({ ...valido, tipo: 'BACKLOG' })).toBeNull();
  });

  it('falta un campo numérico → null', () => {
    const { desdeAnio: _omit, ...sinDesde } = valido;
    expect(parseClientesState(sinDesde)).toBeNull();
  });

  it('search de tipo incorrecto → null', () => {
    expect(parseClientesState({ ...valido, search: 123 })).toBeNull();
  });

  it('sortDir inválido → null', () => {
    expect(parseClientesState({ ...valido, sortDir: 'up' })).toBeNull();
  });

  it('comparar/onlyFav ausentes → default false', () => {
    const { comparar: _c, onlyFav: _f, ...sinBooleanos } = valido;
    const s = parseClientesState(sinBooleanos);
    expect(s).not.toBeNull();
    expect(s?.comparar).toBe(false);
    expect(s?.onlyFav).toBe(false);
  });
});
