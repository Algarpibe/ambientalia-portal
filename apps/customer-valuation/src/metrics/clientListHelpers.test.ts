import { describe, it, expect } from 'vitest';
import type { ClientProfile } from '../types';
import { filterClients, uniqueClientNames, rankClients } from './clientListHelpers';

// Solo se usan clientKey/displayName/scores.{quadrant,segment}; el resto se
// completa con un cast para no fijar todo el ClientProfile en el test.
function client(clientKey: string, displayName: string, quadrant?: string, segment?: string): ClientProfile {
  return { clientKey, displayName, scores: { quadrant, segment } } as unknown as ClientProfile;
}

describe('filterClients', () => {
  const clients = [
    client('c001', 'Alfa SAS', 'Q1', 'Oro'),
    client('c002', 'Beta LTDA', 'Q2', 'Plata'),
    client('c003', 'Gamma SA', 'Q1', 'Plata'),
  ];
  const none = { selectedQuadrant: null, selectedSegment: null, search: '' };

  it('sin filtros devuelve todos', () => {
    expect(filterClients(clients, none)).toHaveLength(3);
  });
  it('filtra por cuadrante', () => {
    expect(filterClients(clients, { ...none, selectedQuadrant: 'Q1' }).map((c) => c.displayName)).toEqual(['Alfa SAS', 'Gamma SA']);
  });
  it('filtra por segmento', () => {
    expect(filterClients(clients, { ...none, selectedSegment: 'Oro' }).map((c) => c.displayName)).toEqual(['Alfa SAS']);
  });
  it('busca por nombre (case-insensitive)', () => {
    expect(filterClients(clients, { ...none, search: 'beta' }).map((c) => c.displayName)).toEqual(['Beta LTDA']);
  });
  it('busca por clientKey', () => {
    expect(filterClients(clients, { ...none, search: 'c003' }).map((c) => c.displayName)).toEqual(['Gamma SA']);
  });
  it('combina cuadrante + segmento', () => {
    expect(filterClients(clients, { ...none, selectedQuadrant: 'Q1', selectedSegment: 'Plata' }).map((c) => c.displayName)).toEqual(['Gamma SA']);
  });
});

describe('uniqueClientNames', () => {
  it('dedup + orden alfabético', () => {
    const clients = [client('a', 'Zeta'), client('b', 'Alfa'), client('c', 'Zeta')];
    expect(uniqueClientNames(clients)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('rankClients', () => {
  // Cliente con los campos que usa el orden; el resto se completa con un cast.
  function rc(displayName: string, scores: Record<string, unknown> | null, extra: Record<string, unknown> = {}): ClientProfile {
    return { clientKey: displayName, displayName, scores, ...extra } as unknown as ClientProfile;
  }

  it('excluye clientes sin scores', () => {
    const data = [rc('A', { totalScore: 10 }), rc('B', null)];
    expect(rankClients(data, { key: 'T', direction: 'desc' }).map((c) => c.displayName)).toEqual(['A']);
  });

  it('ordena por T (total) desc', () => {
    const data = [rc('A', { totalScore: 30 }), rc('B', { totalScore: 90 }), rc('C', { totalScore: 60 })];
    expect(rankClients(data, { key: 'T', direction: 'desc' }).map((c) => c.displayName)).toEqual(['B', 'C', 'A']);
  });

  it('ordena por CLIENTE asc (alfabético)', () => {
    const data = [rc('Zeta', { totalScore: 1 }), rc('Alfa', { totalScore: 1 })];
    expect(rankClients(data, { key: 'CLIENTE', direction: 'asc' }).map((c) => c.displayName)).toEqual(['Alfa', 'Zeta']);
  });

  it('ordena por VENTAS desc (quickMetrics.salesTotal)', () => {
    const data = [
      rc('A', { totalScore: 1 }, { quickMetrics: { salesTotal: 100 } }),
      rc('B', { totalScore: 1 }, { quickMetrics: { salesTotal: 500 } }),
    ];
    expect(rankClients(data, { key: 'VENTAS', direction: 'desc' }).map((c) => c.displayName)).toEqual(['B', 'A']);
  });

  it('ordena por S (salesScore); null cuenta como -1', () => {
    const data = [
      rc('A', { totalScore: 1, salesScore: 80 }),
      rc('B', { totalScore: 1, salesScore: null }),
      rc('C', { totalScore: 1, salesScore: 50 }),
    ];
    expect(rankClients(data, { key: 'S', direction: 'asc' }).map((c) => c.displayName)).toEqual(['B', 'C', 'A']);
  });

  it('key desconocida → mantiene el orden (comparador devuelve 0)', () => {
    const data = [rc('A', { totalScore: 1 }), rc('B', { totalScore: 1 })];
    expect(rankClients(data, { key: 'XXX', direction: 'asc' }).map((c) => c.displayName)).toEqual(['A', 'B']);
  });
});
