import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crostonSBA, processInventoryData } from './calculations';
import type { RawSalesData } from '../types';

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

  it('expone media y σ del tamaño de pedido (base del SS intermitente)', () => {
    const r = crostonSBA([0, 10, 0, 20, 0, 30]); // tamaños {10,20,30}
    expect(r.meanSize).toBeCloseTo(20, 5);
    expect(r.sigmaSize).toBeCloseTo(Math.sqrt(200 / 3), 5); // σ poblacional
  });

  it('sin demanda → media y σ del tamaño en 0', () => {
    const r = crostonSBA([0, 0, 0]);
    expect(r.meanSize).toBe(0);
    expect(r.sigmaSize).toBe(0);
  });

  it('el silencio posterior a la última venta amortigua el pronóstico', () => {
    // Una sola venta y luego 12 períodos en cero. Croston a secas fijaría p=3 (el hueco
    // inicial) y pronosticaría 0.85/3 = 0.283 para siempre, ignorando el silencio.
    const unaVentaYSilencio = [0, 0, 1, ...Array(12).fill(0)];
    const r = crostonSBA(unaVentaYSilencio);
    // El intervalo no puede ser menor que los 12 períodos que llevamos esperando.
    expect(r.forecast).toBeCloseTo(0.85 / 12, 4);
    expect(r.forecast).toBeLessThan(0.85 / 3); // muy por debajo del Croston ingenuo
  });

  it('si la última venta es del último período, no se amortiga nada', () => {
    // Serie que termina en venta → q = 0 → el pronóstico es el de siempre.
    const r = crostonSBA([10, 10, 10, 10, 10, 10]);
    expect(r.forecast).toBeCloseTo(8.5, 1);
  });
});

// --- Motor de reposición (PdP / Q) ---
// Fábricas mínimas: las claves son los alias que sirve hub-api (INVENTORY_SQL).
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const flat = (n: number) => Array(12).fill(n);

function salesRow(sku: string, values: number[]): RawSalesData {
  const row: RawSalesData = { sku, item_name: `Item ${sku}`, category_name: 'Cat' };
  MONTHS.forEach((m, i) => { row[m] = values[i] ?? 0; });
  return row;
}

function invRow(sku: string, over: Record<string, unknown> = {}) {
  return {
    'SKU (Código de artículo)': sku,
    'Nombre del artículo': `Item ${sku}`,
    'Nivel de reposición': 10,
    'Existencias a mano': 100,
    'Existencias físicas': 100,
    'Existencias comprometidas': 0,
    'Disponible para la venta': 100,
    'Cantidad pedida': 0,
    'Costo': 10,
    'Precio de venta': 100,
    'Seguimiento inventario': 'true',
    'Estado del artículo': 'active',
    ...over,
  };
}

const ltRow = (sku: string, days: number) => ({
  'SKU (Código de artículo)': sku,
  'Lead Time': days, 'Lead Time Desv': 0, 'Lead Time Fuente': 'Manual', 'Lead Time N': 0,
});

describe('processInventoryData — punto de pedido', () => {
  // La tasa de 2026 depende del mes en curso → se fija el reloj (julio 2026 = 7 meses).
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-15T12:00:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('anualiza 2026 por los meses transcurridos, no por los "activos"', () => {
    const sku = 'A1';
    // Vendió 20/mes en Ene-Mar y nada desde abril. Historial estable para que no
    // entre por intermitente (Croston) ni por demanda anormal.
    const [r] = processInventoryData(
      [salesRow(sku, [20, 20, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      [salesRow(sku, flat(10))], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))],
      [invRow(sku)], [ltRow(sku, 30)],
    );
    expect(r.demandSource).toBe('Ventas 2026');
    // 60 uds / 7 meses transcurridos (Ene→Jul) = 8.57 — NO 60/3 = 20 (meses activos),
    // que era lo que inflaba el PdP al ignorar los ceros recientes.
    expect(r.monthlyAverage).toBeCloseTo(60 / 7, 2);
  });

  it('Q = EOQ recortada al techo de 6 meses de demanda', () => {
    const sku = 'Q1';
    // Demanda 10/mes → 120/año. Costo 10, S=100, H=25% → H_u=2.5.
    // EOQ = √(2·120·100/2.5) ≈ 98 → por encima del techo (6 meses = 60) → 60.
    const [r] = processInventoryData(
      [], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))],
      [invRow(sku, { Costo: 10 })], [ltRow(sku, 30)], 100, 25,
    );
    expect(r.optimalQuantity).toBeCloseTo(60, 5);
  });

  it('Q = EOQ tal cual cuando cae dentro del rango sano', () => {
    const sku = 'Q2';
    // Costo 1000 → H_u=250 → EOQ = √(2·120·100/250) ≈ 10 → dentro de [1, 6] meses → 10.
    const [r] = processInventoryData(
      [], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))],
      [invRow(sku, { Costo: 1000 })], [ltRow(sku, 30)], 100, 25,
    );
    expect(r.optimalQuantity).toBeCloseTo(10, 0);
  });

  it('el PdP nunca supera el peor mes histórico × (lead time + 2 meses)', () => {
    const sku = 'C1';
    const spiky = [0, 200, 0, 0, 300, 0, 0, 250, 0, 0, 400, 0];
    const [r] = processInventoryData(
      [], [salesRow(sku, spiky)], [salesRow(sku, spiky)], [salesRow(sku, spiky)],
      [invRow(sku)], [ltRow(sku, 30)],
    );
    // LT manual 30 → efectivo 60 días (buffer +30) = 2 meses; peor mes = 400.
    expect(r.reorderPoint).toBeLessThanOrEqual(400 * (2 + 2));
  });

  it('el nivel de servicio sube con la criticidad: un ítem A lleva más SS que un C', () => {
    // Misma demanda (mismo σ, misma clase XYZ); solo cambia el costo → cambia el ABC.
    const demand = [12, 8, 15, 5, 11, 9, 14, 6, 13, 7, 10, 10];
    const [a, c] = processInventoryData(
      [], [salesRow('HI', demand), salesRow('LO', demand)],
      [salesRow('HI', demand), salesRow('LO', demand)],
      [salesRow('HI', demand), salesRow('LO', demand)],
      [invRow('HI', { Costo: 1000 }), invRow('LO', { Costo: 0.01 })],
      [ltRow('HI', 30), ltRow('LO', 30)],
    );
    expect(a.abcClass).toBe('A');
    expect(c.abcClass).toBe('C');
    expect(a.xyzClass).toBe(c.xyzClass);        // misma variabilidad
    expect(a.safetyStock).toBeGreaterThan(c.safetyStock);
  });

  // El estatus es SOLO la recomendación; el estado del ERP se reporta en currentLevel.
  // Antes se mezclaban y mentía en los dos casos de abajo.
  it('demanda ínfima con lead time → "No stockear", no "Sin datos"', () => {
    const sku = 'CAT';
    // Caso real (Catalyzer Tube 3014059457): 2 uds en 4 años, pero lead time 60 días.
    // Hay datos de sobra; la conclusión es que no amerita stock.
    const [r] = processInventoryData(
      [salesRow(sku, [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      [salesRow(sku, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])],
      [salesRow(sku, Array(12).fill(0))], [salesRow(sku, Array(12).fill(0))],
      [invRow(sku, { 'Nivel de reposición': 0 })], [ltRow(sku, 60)],
    );
    expect(r.reorderPoint).toBeLessThan(1);
    expect(r.levelStatus).toBe('NoStockear');
  });

  it('sin ventas en más de 12 meses → "No stockear", aunque el modelo proponga stock', () => {
    const sku = 'OBS';
    // Vendió bien todo 2024 y nada desde entonces (última venta: dic 2024, hace 19
    // meses). Sin la regla, el pronóstico aún propondría un PdP de dos dígitos.
    const [r] = processInventoryData(
      [], [], [salesRow(sku, flat(10))], [],
      [invRow(sku)], [ltRow(sku, 30)],
    );
    expect(r.monthsSinceLastSale).toBeGreaterThan(12);
    expect(r.reorderPoint).toBe(0);
    expect(r.optimalQuantity).toBe(0);
    expect(r.levelStatus).toBe('NoStockear');
    expect(r.status).toBe('Ignored');
  });

  it('el caso del Blower: 1 ud hace años → no se stockea', () => {
    const sku = 'BLW';
    // Caso real (4020012): 1 ud en marzo 2023, nada desde entonces, y proponía PdP 2
    // (~$3.400 de capital muerto) porque Croston ignoraba los 40 meses de silencio.
    const [r] = processInventoryData(
      [], [], [], [salesRow(sku, [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
      [invRow(sku, { 'Precio de venta': 3291.68, Costo: 1680.96 })], [ltRow(sku, 90)],
    );
    expect(r.reorderPoint).toBe(0);
    expect(r.levelStatus).toBe('NoStockear');
  });

  it('"disponible a futuro" = físicas + por recibir − comprometido', () => {
    const sku = 'FUT';
    // Caso real (Disposition filter J04993305BQ): disponible -5 asusta, pero con 40
    // en camino su posición real es +35.
    const [r] = processInventoryData(
      [], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))],
      [invRow(sku, {
        'Existencias físicas': 16,
        'Cantidad pedida': 40,
        'Existencias comprometidas': 21,
        'Disponible para la venta': -5,
      })],
      [ltRow(sku, 30)],
    );
    expect(r.availableQuantity).toBe(-5);
    expect(r.futureAvailable).toBe(35);
  });

  it('sin lead time sí es "Sin datos"', () => {
    const sku = 'NOLT';
    const [r] = processInventoryData(
      [], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))],
      [invRow(sku)], [ltRow(sku, 0)],
    );
    expect(r.levelStatus).toBe('SinDatos');
  });

  it('un -1 ("bajo demanda") con PdP alto se reporta como Subir, no como Sin configurar', () => {
    const sku = 'BD';
    // El -1 es la marca manual "no stockear". Si la demanda ya justifica stock, el
    // análisis reta la política en vez de tragársela.
    const [r] = processInventoryData(
      [], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))],
      [invRow(sku, { 'Nivel de reposición': -1 })], [ltRow(sku, 30)],
    );
    expect(r.currentLevel).toBe(-1);      // se preserva el dato del ERP tal cual
    expect(r.reorderPoint).toBeGreaterThanOrEqual(1);
    expect(r.levelStatus).toBe('Subir');
  });

  it('el nivel ausente en el ERP llega como null y no se confunde con 0', () => {
    const sku = 'NL';
    const [r] = processInventoryData(
      [], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))], [salesRow(sku, flat(10))],
      [invRow(sku, { 'Nivel de reposición': null })], [ltRow(sku, 30)],
    );
    expect(r.currentLevel).toBeNull();
    expect(r.levelStatus).toBe('SinConfigurar');
  });

  it('un ítem que él solo concentra casi todo el valor es A, no C', () => {
    // Regresión del Pareto: clasificar por el acumulado DESPUÉS mandaba el primero a C.
    const demand = flat(10);
    const [big] = processInventoryData(
      [], [salesRow('BIG', demand), salesRow('TINY', demand)],
      [salesRow('BIG', demand), salesRow('TINY', demand)],
      [salesRow('BIG', demand), salesRow('TINY', demand)],
      [invRow('BIG', { Costo: 100000 }), invRow('TINY', { Costo: 0.01 })],
      [ltRow('BIG', 30), ltRow('TINY', 30)],
    );
    expect(big.abcClass).toBe('A');
  });
});
