import { describe, it, expect } from 'vitest';
import { ppmToPpb, ppbToPpm } from './units.js';

describe('units', () => {
  it('converts ppm to ppb and back without loss', () => {
    expect(ppmToPpb(0.2)).toBeCloseTo(200, 12);
    expect(ppbToPpm(200)).toBeCloseTo(0.2, 12);
    expect(ppbToPpm(ppmToPpb(1.13639))).toBeCloseTo(1.13639, 12);
  });
});
