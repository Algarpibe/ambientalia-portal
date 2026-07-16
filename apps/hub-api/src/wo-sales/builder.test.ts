import { describe, it, expect } from 'vitest';
import { buildWorldOfficeCsv } from './builder.js';
import { DEFAULT_CONFIG } from './config.js';
import { COLUMNS } from './columns.js';
import type { SalesOrder } from './types.js';

function decodificar(buf: Buffer): string[] {
  return new TextDecoder('windows-1252').decode(buf).split('\r\n');
}

const OV_BASE: SalesOrder = {
  numero: 'OV-2026-138',
  fecha: '2026-07-14',
  clienteNombre: 'ACME S.A.S.',
  nit: '899999107',
  formaPagoZoho: '30 días fecha de factura',
  fechaEntrega: '2026-07-20',
  moneda: 'COP',
  lineas: [
    {
      sku: 'AMB-STCALENVIRO-01',
      descripcion: 'Calibración Enviro',
      cantidad: 2,
      valorUnitario: 4315000,
      descuento: 0,
      centroCostos: '330801 CALIBRACION ENVIRO',
      centrosCostosCount: 1,
    },
  ],
};

describe('buildWorldOfficeCsv', () => {
  it('emite la cabecera exacta y una fila por línea', () => {
    const { csv, filas } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    const lineas = decodificar(csv);
    expect(lineas[0]).toBe(COLUMNS.join(';'));
    expect(filas).toBe(1);
  });

  it('cada fila tiene 57 campos', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    const lineas = decodificar(csv);
    expect(lineas[1].split(';')).toHaveLength(57);
  });

  it('termina en CRLF, como la muestra', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    expect(csv.subarray(-2).toString('latin1')).toBe('\r\n');
  });

  it('mapea los campos variables y los fijos', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    const campos = decodificar(csv)[1].split(';');
    const valor = (col: string) => campos[COLUMNS.indexOf(col)];

    expect(valor('Encab: Empresa')).toBe('ACME S.A.S.');
    expect(valor('Encab: Tipo Documento')).toBe('FV');
    expect(valor('Encab: Documento Número')).toBe('OV-2026-138');
    expect(valor('Encab: Fecha')).toBe('14/07/2026');
    expect(valor('Encab: Tercero Interno')).toBe('51023563');
    expect(valor('Encab: Tercero Externo')).toBe('899999107');
    expect(valor('Encab: Nota')).toBe('Orden de Venta');
    expect(valor('Encab: FormaPago')).toBe('Credito');
    expect(valor('Encab: Fecha Entrega')).toBe('20/07/2026');
    expect(valor('Encab: Verificado')).toBe('-1');
    expect(valor('Encab: Anulado')).toBe('');
    expect(valor('Encab: Prefijo')).toBe('');
    expect(valor('Encab: Sucursal')).toBe('');
    expect(valor('Detalle: Producto')).toBe('AMB-STCALENVIRO-01');
    expect(valor('Detalle: Bodega')).toBe('Principal');
    expect(valor('Detalle: UnidadDeMedida')).toBe('Und.');
    expect(valor('Detalle: Cantidad')).toBe('2');
    expect(valor('Detalle: IVA')).toBe('0.19');
    expect(valor('Detalle: Valor Unitario')).toBe('4315000');
    expect(valor('Detalle: Descuento')).toBe('0');
    expect(valor('Detalle: Vencimiento')).toBe('');
    expect(valor('Detalle: Nota')).toBe('Calibración Enviro');
  });

  it('parte el centro de costos de Zoho en descripción y código', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    const campos = decodificar(csv)[1].split(';');
    // Zoho da "330801 CALIBRACION ENVIRO" en un solo campo.
    expect(campos[COLUMNS.indexOf('Detalle: Centro costos')]).toBe('CALIBRACION ENVIRO');
    expect(campos[COLUMNS.indexOf('Detalle: Código Centro Costos')]).toBe('330801');
  });

  it('repite el encabezado idéntico en cada línea de la misma OV', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      lineas: [
        OV_BASE.lineas[0],
        { ...OV_BASE.lineas[0], sku: 'SKU-2', descripcion: 'Otro', cantidad: 5 },
      ],
    };
    const filas = decodificar(buildWorldOfficeCsv([ov], DEFAULT_CONFIG).csv).slice(1, 3);
    const encabezado = (f: string) => f.split(';').slice(0, 31).join(';');
    expect(encabezado(filas[0])).toBe(encabezado(filas[1]));
    expect(filas[0].split(';')[COLUMNS.indexOf('Detalle: Producto')]).toBe('AMB-STCALENVIRO-01');
    expect(filas[1].split(';')[COLUMNS.indexOf('Detalle: Producto')]).toBe('SKU-2');
  });

  it('codifica el archivo en Windows-1252', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    // "Número" en la cabecera: la ú debe ser 0xFA, no C3 BA.
    expect(csv.includes(Buffer.from([0xfa]))).toBe(true);
    expect(csv.includes(Buffer.from([0xc3, 0xba]))).toBe(false);
  });
});
