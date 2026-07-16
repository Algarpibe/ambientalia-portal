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
  descuentoCabecera: 0,
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
    const INICIO_DETALLE = COLUMNS.findIndex((c) => c.startsWith('Detalle:'));
    const encabezado = (f: string) => f.split(';').slice(0, INICIO_DETALLE).join(';');
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

  it('las columnas que deben ir vacías están vacías, todas', () => {
    const campos = decodificar(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG).csv)[1].split(';');
    // OJO: "Documento[ _]Externo" y no "Documento Externo": la columna 11 se llama
    // 'Encab: Número_Documento_Externo', con guiones bajos, y con espacio se escapaba.
    const debenIrVacias = COLUMNS.filter((c) =>
      /Personalizado|Documento[ _]Externo|Clasificación|Sucursal|Prefijo/.test(c)
    );
    // Un objeto por columna para que el fallo diga CUÁL, no solo que algo falló.
    for (const c of debenIrVacias) {
      expect({ [c]: campos[COLUMNS.indexOf(c)] }).toEqual({ [c]: '' });
    }
    expect(debenIrVacias.length).toBe(35);
  });

  it('sanea el salto de línea: sigue siendo una sola fila de 57 campos, y avisa', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      lineas: [{ ...OV_BASE.lineas[0], descripcion: 'Sonda pH\nmodelo X' }],
    };
    const { csv, warnings, filas } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    // Se parte por cualquier terminador, no solo \r\n: un \n suelto que se hubiera
    // colado partiría la fila y con split('\r\n') no lo veríamos.
    const lineas = new TextDecoder('windows-1252').decode(csv).split(/\r\n|\r|\n/);
    expect(filas).toBe(1);
    expect(lineas[1].split(';')).toHaveLength(57);
    expect(lineas[1]).toContain('Sonda pH modelo X');
    expect(warnings.map((w) => w.tipo)).toContain('valor_saneado');
  });

  it('descarta el centro de costos cuyo código no es numérico, y avisa', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      lineas: [{ ...OV_BASE.lineas[0], centroCostos: 'CALIBRACION ENVIRO' }],
    };
    const { csv, warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    const campos = decodificar(csv)[1].split(';');
    // Mejor las dos columnas vacías que "CALIBRACION" en la columna del código contable.
    expect(campos[COLUMNS.indexOf('Detalle: Código Centro Costos')]).toBe('');
    expect(campos[COLUMNS.indexOf('Detalle: Centro costos')]).toBe('');
    expect(warnings.find((w) => w.tipo === 'centro_costos_invalido')?.mensaje).toContain(
      'CALIBRACION ENVIRO'
    );
  });

  it('tolera espacios múltiples y NBSP en el centro de costos', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      lineas: [{ ...OV_BASE.lineas[0], centroCostos: '330801  CALIBRACION ENVIRO' }],
    };
    const campos = decodificar(buildWorldOfficeCsv([ov], DEFAULT_CONFIG).csv)[1].split(';');
    expect(campos[COLUMNS.indexOf('Detalle: Código Centro Costos')]).toBe('330801');
    expect(campos[COLUMNS.indexOf('Detalle: Centro costos')]).toBe('CALIBRACION ENVIRO');
  });

  it('deja vacío, y avisa, en vez de escribir "NaN" en una columna de importes', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      lineas: [{ ...OV_BASE.lineas[0], cantidad: NaN }],
    };
    const { csv, warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    const campos = decodificar(csv)[1].split(';');
    // Vacío y no 0: World Office debe rechazar la línea ruidosamente, no cargar un 0.
    expect(campos[COLUMNS.indexOf('Detalle: Cantidad')]).toBe('');
    const aviso = warnings.find((w) => w.tipo === 'valor_no_numerico');
    expect(aviso?.mensaje).toContain('Cantidad');
    // El aviso lo lee un humano que va a corregir el dato en Zoho: debe decir NaN.
    // JSON.stringify(NaN) da "null" y lo mandaría a buscar un campo vacío.
    expect(aviso?.mensaje).toContain('NaN');
  });

  it('avisa de la OV sin líneas en vez de dejarla desaparecer del archivo', () => {
    const { csv, warnings, filas } = buildWorldOfficeCsv([{ ...OV_BASE, lineas: [] }], DEFAULT_CONFIG);
    expect(filas).toBe(0);
    expect(decodificar(csv)).toEqual([COLUMNS.join(';'), '']);
    expect(warnings.map((w) => w.tipo)).toContain('ov_sin_lineas');
  });

  it('avisa cuando la empresa sale del cliente y el cliente no tiene nombre', () => {
    const { warnings } = buildWorldOfficeCsv([{ ...OV_BASE, clienteNombre: null }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('sin_empresa');
  });
});

describe('advertencias', () => {
  it('avisa cuando el artículo no tiene centro de costos', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: null, centrosCostosCount: 0 }] };
    const { warnings, csv } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('sin_centro_costos');
    // No aborta: las dos columnas salen vacías y el resto de la fila es válido.
    const campos = decodificar(csv)[1].split(';');
    expect(campos[COLUMNS.indexOf('Detalle: Centro costos')]).toBe('');
    expect(campos[COLUMNS.indexOf('Detalle: Código Centro Costos')]).toBe('');
    expect(campos).toHaveLength(57);
  });

  it('avisa desde el primer centro de costos de más (exactamente 2)', () => {
    // 2 y no 3: fija la frontera. Con 3, un off-by-one (> 1 → > 2) pasaría
    // desapercibido y el builder elegiría el primer centro de costos en silencio,
    // que es justo la corrupción muda que este módulo no se puede permitir.
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centrosCostosCount: 2 }] };
    const { warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.find((w) => w.tipo === 'varios_centros_costos')?.mensaje).toContain('2');
  });

  it('avisa si la OV no está en COP, porque el valor unitario no sería pesos', () => {
    const { warnings } = buildWorldOfficeCsv([{ ...OV_BASE, moneda: 'USD' }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('moneda_no_cop');
  });

  it('avisa y usa el valor por defecto si el término de pago no está homologado', () => {
    const { warnings, csv } = buildWorldOfficeCsv([{ ...OV_BASE, formaPagoZoho: 'Pago con cheque' }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('forma_pago_desconocida');
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Encab: FormaPago')]).toBe('Credito');
  });

  it('avisa si falta el NIT o la fecha de entrega, sin abortar', () => {
    const { warnings, filas } = buildWorldOfficeCsv([{ ...OV_BASE, nit: null, fechaEntrega: null }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toEqual(expect.arrayContaining(['sin_nit', 'sin_fecha_entrega']));
    expect(filas).toBe(1);
  });

  it('avisa de la línea sin SKU, que World Office rechazaría', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: null }] };
    const { warnings, filas } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('sin_sku');
    expect(filas).toBe(1);
  });

  it('sanea el ; de un nombre de producto para no romper la fila', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], descripcion: 'Sonda pH; 3 metros' }] };
    const { csv, warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(decodificar(csv)[1].split(';')).toHaveLength(57);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Detalle: Nota')]).toBe('Sonda pH, 3 metros');
    expect(warnings.map((w) => w.tipo)).toContain('valor_saneado');
  });

  it('avisa del descuento de cabecera, que el archivo no lleva a ninguna columna', () => {
    // Esta organización descuenta a nivel de documento (discount_type "entity_level"):
    // las líneas traen discount 0 y el descuento vive en la cabecera de la OV. El CSV
    // solo tiene "Detalle: Descuento" (de línea), así que el pedido entraría a World
    // Office a precio completo. Repartirlo es una decisión de negocio sin cerrar; lo
    // que NO se puede es callarlo.
    const { warnings } = buildWorldOfficeCsv([{ ...OV_BASE, descuentoCabecera: 190000 }], DEFAULT_CONFIG);
    const aviso = warnings.find((w) => w.tipo === 'descuento_cabecera_ignorado');
    expect(aviso).toBeDefined();
    // El importe va en el mensaje: la operadora tiene que poder cotejarlo con Zoho.
    expect(aviso?.mensaje).toContain('190000');
    expect(aviso?.orden).toBe('OV-2026-138');
  });

  it('no avisa del descuento de cabecera cuando la OV no tiene descuento', () => {
    // Si saltara en todas las OV (la mayoría no llevan descuento), la operadora
    // dejaría de leer las advertencias y el cortafuegos entero se pierde.
    const { warnings } = buildWorldOfficeCsv([{ ...OV_BASE, descuentoCabecera: 0 }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).not.toContain('descuento_cabecera_ignorado');
  });

  it('el descuento de cabecera avisa pero no aborta: la fila sale con sus 57 campos', () => {
    const { csv, filas } = buildWorldOfficeCsv([{ ...OV_BASE, descuentoCabecera: 190000 }], DEFAULT_CONFIG);
    expect(filas).toBe(1);
    expect(decodificar(csv)[1].split(';')).toHaveLength(57);
  });

  it('no emite advertencias con una OV completa y correcta', () => {
    expect(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG).warnings).toEqual([]);
  });
});
