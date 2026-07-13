import { describe, it, expect } from 'vitest';
import { crostonSBA } from './calculations';

// Núcleo de pronóstico de demanda para reposición (Croston/SBA + clasificación
// Syntetos-Boylan). Es la lógica que fija el punto de pedido de los repuestos.

describe('crostonSBA — clasificación de patrón (ADI/CV²)', () => {
  it('demanda estable y regular → Suave', () => {
    const r = crostonSBA([10, 10, 10, 10, 10, 10]);
    expect(r.pattern).toBe('Suave');
    expect(r.adi).toBeCloseTo(1, 5);
    expect(r.demands).toBe(6);
  });

  it('demanda a saltos con tamaños parecidos → Intermitente', () => {
    const r = crostonSBA([0, 0, 5, 0, 0, 4, 0, 0, 6]);
    expect(r.pattern).toBe('Intermitente');
    expect(r.adi).toBeCloseTo(3, 5); // 9 períodos / 3 demandas
    expect(r.demands).toBe(3);
  });

  it('demanda a saltos con tamaños muy dispares → Lumpy', () => {
    const r = crostonSBA([0, 0, 100, 0, 0, 1, 0, 0, 50]);
    expect(r.pattern).toBe('Lumpy');
    expect(r.cv2).toBeGreaterThanOrEqual(0.49);
  });

  it('demanda volátil pero frecuente → Errática', () => {
    const r = crostonSBA([100, 1, 90, 2, 80, 3]); // ADI≈1, CV² alto
    expect(r.pattern).toBe('Errática');
    expect(r.adi).toBeLessThan(1.32);
    expect(r.cv2).toBeGreaterThanOrEqual(0.49);
  });
});

describe('crostonSBA — pronóstico (SBA)', () => {
  it('sin demanda → pronóstico 0', () => {
    const r = crostonSBA([0, 0, 0, 0]);
    expect(r.forecast).toBe(0);
    expect(r.demands).toBe(0);
  });

  it('demanda estable de 10 → pronóstico SBA ≈ (1-α/2)·10 = 8.5', () => {
    const r = crostonSBA([10, 10, 10, 10, 10, 10]);
    expect(r.forecast).toBeCloseTo(8.5, 1);
  });

  it('el pronóstico es positivo cuando hay demanda intermitente', () => {
    const r = crostonSBA([0, 0, 6, 0, 0, 6, 0, 0, 6]);
    expect(r.forecast).toBeGreaterThan(0);
    expect(r.forecast).toBeLessThan(6); // z/p con p>1 (intervalos de 3)
  });
});
