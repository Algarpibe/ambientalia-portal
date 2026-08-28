import { describe, it, expect } from 'vitest';
import { COLUMNS, TIPO_COLUMNA } from './columns.js';

// El archivo que Xiomara CARGÓ con éxito en WO (26/08/2026) es la fuente de verdad: 58
// columnas, 31 de encabezado + 27 de detalle, en este orden EXACTO. Lee por posición.
const ESPERADAS = [
  'Empresa',
  'Tipo Documento',
  'prefijo',
  'DocumentoNúmero',
  'Fecha',
  'Tercero Interno',
  'Tercero Externo',
  'Nota',
  'FormaDePago',
  'FechaEntrega',
  'Moneda',
  'TRM',
  'Verificado',
  'Anulado',
  'Personalizado1', 'Personalizado2', 'Personalizado3', 'Personalizado4', 'Personalizado5',
  'Personalizado6', 'Personalizado7', 'Personalizado8', 'Personalizado9', 'Personalizado10',
  'Personalizado11', 'Personalizado12', 'Personalizado13', 'Personalizado14', 'Personalizado15',
  'Sucursal',
  'Clasificación',
  'Producto',
  'Bodega',
  'UnidadDeMedida',
  'Cantidad',
  'Iva',
  'Valor',
  'Descuento',
  'Vencimiento',
  'Nota Detalle',
  'Centro Costos',
  'Moneda Det',
  'TRM Det',
  'Personalizado1Det', 'Personalizado2Det', 'Personalizado3Det', 'Personalizado4Det', 'Personalizado5Det',
  'Personalizado6Det', 'Personalizado7Det', 'Personalizado8Det', 'Personalizado9Det', 'Personalizado10Det',
  'Personalizado11Det', 'Personalizado12Det', 'Personalizado13Det', 'Personalizado14Det', 'Personalizado15Det',
];

describe('COLUMNS', () => {
  it('son 58 columnas, con los nombres del archivo cargado, en ese orden', () => {
    expect(COLUMNS).toHaveLength(58);
    expect(COLUMNS).toEqual(ESPERADAS);
  });

  it('el encabezado son 31 columnas (0–30) y el detalle 27 (31–57)', () => {
    expect(COLUMNS.indexOf('Sucursal')).toBe(29);
    expect(COLUMNS.indexOf('Clasificación')).toBe(30); // última del encabezado
    expect(COLUMNS.indexOf('Producto')).toBe(31); // primera del detalle
    expect(COLUMNS.indexOf('Vencimiento')).toBe(38);
    expect(COLUMNS.indexOf('Centro Costos')).toBe(40);
  });

  it('lleva Sucursal y Clasificación, no Importacion ni Código Centro Costos', () => {
    expect(COLUMNS).toContain('Sucursal');
    expect(COLUMNS).toContain('Clasificación');
    expect(COLUMNS).not.toContain('Importacion');
    expect(COLUMNS).not.toContain('Código Centro Costos');
    expect(COLUMNS.some((c) => /^(Encab|Detalle):/.test(c))).toBe(false);
  });

  it('no tiene columnas duplicadas', () => {
    expect(new Set(COLUMNS).size).toBe(COLUMNS.length);
  });

  it('tipa Fecha y Vencimiento como fecha; los importes como número; NIT y SKU como texto', () => {
    const tipoDe = (col: string) => TIPO_COLUMNA[COLUMNS.indexOf(col)];
    for (const c of ['Fecha', 'Vencimiento']) expect(tipoDe(c)).toBe('fecha');
    for (const c of ['DocumentoNúmero', 'Verificado', 'Anulado', 'Cantidad', 'Iva', 'Valor', 'Descuento'])
      expect(tipoDe(c)).toBe('numero');
    for (const c of ['Tercero Interno', 'Tercero Externo', 'Producto']) expect(tipoDe(c)).toBe('texto');
  });
});
