import { describe, it, expect } from 'vitest';
import { pendientePorFacturar, createHubSalesOrderSource } from './hub.source.js';
import { DEFAULT_CONFIG } from './config.js';

// OV de prueba de otro software: no deben llegar ni a la tabla, ni al archivo, ni al
// correo. El filtro vive en el SQL; aquí se comprueba que las dos consultas lo aplican
// y reciben la lista de config.
describe('ordenesExcluidas', () => {
  const capturar = () => {
    const llamadas: { sql: string; params: unknown[] }[] = [];
    const db = { query: async (sql: string, params: unknown[]) => (llamadas.push({ sql, params }), { rows: [] }) };
    return { db: db as never, llamadas };
  };
  const filtro = { desde: '2000-01-01', hasta: '2026-12-31' };

  it('la OV-2026-1000-01 (prueba de otro software) está excluida por defecto', () => {
    expect(DEFAULT_CONFIG.ordenesExcluidas).toContain('OV-2026-1000-01');
  });

  it('ordenesVivas y ordenesAntiguas filtran por la lista de excluidas', async () => {
    const { db, llamadas } = capturar();
    const source = createHubSalesOrderSource(db, DEFAULT_CONFIG);
    await source.ordenesVivas(filtro);
    await source.ordenesAntiguas(filtro);
    for (const { sql, params } of llamadas) {
      expect(sql).toMatch(/salesorder_number\s*=\s*ANY\(\$\d+::text\[\]\)/);
      expect(params).toContainEqual(DEFAULT_CONFIG.ordenesExcluidas);
    }
  });
});

// La cantidad que World Office debe cargar es la PENDIENTE de facturar, no la pedida:
// cargar lo ya facturado duplicaría inventario y facturación. Esta es la aritmética
// que lo decide; los números salen de OV-2026-077 real (cada línea: pedida 7, ya
// facturada 3 → pendiente 4).
describe('pendientePorFacturar', () => {
  it('descuenta lo ya facturado (OV-2026-077 real: 7 − 3 = 4)', () => {
    expect(pendientePorFacturar(7, 3, 0)).toEqual({ cantidad: 4, incluir: true });
  });

  it('una OV no facturada exporta la cantidad completa', () => {
    expect(pendientePorFacturar(50, 0, 0)).toEqual({ cantidad: 50, incluir: true });
  });

  it('una línea facturada del todo NO entra al archivo', () => {
    expect(pendientePorFacturar(7, 7, 0)).toEqual({ cantidad: 0, incluir: false });
  });

  it('también descuenta lo cancelado', () => {
    expect(pendientePorFacturar(10, 2, 3)).toEqual({ cantidad: 5, incluir: true });
  });

  it('un descuadre (facturada > pedida) no entra: no queda nada pendiente', () => {
    expect(pendientePorFacturar(5, 8, 0)).toEqual({ cantidad: -3, incluir: false });
  });

  it('NaN (dato corrupto) SÍ entra: no se descarta en silencio, lo cazará el builder', () => {
    const r = pendientePorFacturar(NaN, 0, 0);
    expect(Number.isNaN(r.cantidad)).toBe(true);
    expect(r.incluir).toBe(true);
  });
});
