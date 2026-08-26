import { describe, it, expect } from 'vitest';
import { COLUMNS, TIPO_COLUMNA } from './columns.js';

// El modelo (hoja QueryDef_Exportar) es la fuente de verdad: 57 columnas, 30 de
// encabezado + 27 de detalle, en este orden EXACTO. World Office lee por posición.
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
  'Importacion',
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
  it('son 57 columnas, con los nombres del modelo, en ese orden', () => {
    expect(COLUMNS).toHaveLength(57);
    expect(COLUMNS).toEqual(ESPERADAS);
  });

  it('el encabezado son 30 columnas (0–29) y el detalle 27 (30–56)', () => {
    expect(COLUMNS.indexOf('Importacion')).toBe(29); // última del encabezado
    expect(COLUMNS.indexOf('Producto')).toBe(30); // primera del detalle
  });

  it('no arrastra la columna extra "Código Centro Costos" ni los prefijos Encab:/Detalle:', () => {
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
    // El modelo manda: Tercero Interno/Externo (NIT) y Producto (SKU) son TEXTO.
    for (const c of ['Tercero Interno', 'Tercero Externo', 'Producto']) expect(tipoDe(c)).toBe('texto');
  });
});
