import { describe, it, expect } from 'vitest';
import type { ClientProfile } from '../types';
import { filterClients, uniqueClientNames } from './clientListHelpers';

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
