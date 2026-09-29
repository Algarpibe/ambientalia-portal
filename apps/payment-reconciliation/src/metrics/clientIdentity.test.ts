import { describe, it, expect } from 'vitest';
import { clientIdentity } from './clientIdentity';

describe('clientIdentity', () => {
  it('collapses whitespace for the name and upper-cases the key', () => {
    expect(clientIdentity('  acme   s.a.s ')).toEqual({ key: 'ACME S.A.S', name: 'acme s.a.s' });
  });

  it('gives the same key to spelling variants', () => {
    expect(clientIdentity('ACME S.A.S').key).toBe(clientIdentity(' acme  s.a.s ').key);
  });

  it('names a blank or missing client "Sin cliente"', () => {
    expect(clientIdentity('   ')).toEqual({ key: 'SIN CLIENTE', name: 'Sin cliente' });
    expect(clientIdentity(undefined).name).toBe('Sin cliente');
    expect(clientIdentity(null).name).toBe('Sin cliente');
  });
});
