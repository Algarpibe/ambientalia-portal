import { describe, it, expect } from 'vitest';
import { buildWorldOfficeCsv, sumarDias, derivarPrefijo } from './builder.js';
import { DEFAULT_CONFIG } from './config.js';
import { COLUMNS } from './columns.js';
import type { SalesOrder } from './types.js';

function decodificar(buf: Buffer): string[] {
  return new TextDecoder('windows-1252').decode(buf).split('\r\n');
}

// SKU real de World Office (3011026485) y centro de costos real (330801 → CALIBRACION
// ENVIRO) para que OV_BASE valide limpio contra las listas maestras de DEFAULT_CONFIG.
const OV_BASE: SalesOrder = {
  numero: 'OV-2026-138',
  fecha: '2026-07-14',
  clienteNombre: 'ACME S.A.S.',
  nit: '899999107',
  formaPagoZoho: '30 días fecha de factura',
  fechaEntrega: '2026-07-20',
  plazoPago: 30,
  moneda: 'COP',
  descuentoCabecera: 0,
  cantidadFacturada: 0,
  lineas: [
    {
      sku: '3011026485',
      descripcion: 'O-Ring, P4',
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

  it('cada fila tiene 58 campos', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    expect(decodificar(csv)[1].split(';')).toHaveLength(58);
  });

  it('termina en CRLF, como la muestra', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    expect(csv.subarray(-2).toString('latin1')).toBe('\r\n');
  });

  it('mapea los valores fijos y variables del modelo', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    const campos = decodificar(csv)[1].split(';');
    const valor = (col: string) => campos[COLUMNS.indexOf(col)];

    expect(valor('Empresa')).toBe('AMBIENTALIA SAS'); // fijo, no el cliente
    expect(valor('Tipo Documento')).toBe('PED');
    expect(valor('prefijo')).toBe('OV_26'); // año de 2 dígitos (WO no acepta 4)
    expect(valor('DocumentoNúmero')).toBe('1'); // 1er grupo, consecutivoInicial 1
    expect(valor('Sucursal')).toBe(''); // vacía pero presente (58 columnas)
    expect(valor('Clasificación')).toBe('');
    expect(valor('Fecha')).toBe('14/07/2026');
    expect(valor('Tercero Interno')).toBe('416544');
    expect(valor('Tercero Externo')).toBe('899999107'); // NIT
    expect(valor('Nota')).toBe('PEDIDO');
    expect(valor('FormaDePago')).toBe('Credito');
    expect(valor('Verificado')).toBe('0');
    expect(valor('Anulado')).toBe('0');
    expect(valor('Producto')).toBe('3011026485'); // SKU
    expect(valor('Bodega')).toBe('Principal');
    expect(valor('UnidadDeMedida')).toBe('Und.');
    expect(valor('Cantidad')).toBe('2');
    expect(valor('Iva')).toBe('0.19');
    expect(valor('Valor')).toBe('4315000');
    expect(valor('Descuento')).toBe('0');
    expect(valor('Vencimiento')).toBe('13/08/2026'); // 14/07 + 30 días de plazo
    expect(valor('Centro Costos')).toBe('CALIBRACION ENVIRO'); // nombre, no "código nombre"
  });

  it('todas las columnas que el archivo cargado deja vacías salen vacías (son 38)', () => {
    const campos = decodificar(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG).csv)[1].split(';');
    const debenIrVacias = [
      'FechaEntrega', 'Moneda', 'TRM', 'Sucursal', 'Clasificación', 'Nota Detalle', 'Moneda Det', 'TRM Det',
      ...Array.from({ length: 15 }, (_, i) => `Personalizado${i + 1}`),
      ...Array.from({ length: 15 }, (_, i) => `Personalizado${i + 1}Det`),
    ];
    for (const c of debenIrVacias) {
      // Un objeto por columna para que el fallo diga CUÁL, no solo que algo falló.
      expect({ [c]: campos[COLUMNS.indexOf(c)] }).toEqual({ [c]: '' });
    }
    expect(debenIrVacias.length).toBe(38);
  });

  it('repite las 30 columnas de encabezado idénticas en cada línea de la misma OV', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      lineas: [
        OV_BASE.lineas[0],
        { ...OV_BASE.lineas[0], sku: 'SKU-2', descripcion: 'Otro', cantidad: 5 },
      ],
    };
    const filas = decodificar(buildWorldOfficeCsv([ov], DEFAULT_CONFIG).csv).slice(1, 3);
    const INICIO_DETALLE = COLUMNS.indexOf('Producto'); // 30
    const encabezado = (f: string) => f.split(';').slice(0, INICIO_DETALLE).join(';');
    expect(encabezado(filas[0])).toBe(encabezado(filas[1]));
    expect(filas[0].split(';')[COLUMNS.indexOf('Producto')]).toBe('3011026485');
    expect(filas[1].split(';')[COLUMNS.indexOf('Producto')]).toBe('SKU-2');
  });

  it('codifica el archivo en Windows-1252', () => {
    const { csv } = buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG);
    // "DocumentoNúmero" en la cabecera: la ú debe ser 0xFA, no C3 BA.
    expect(csv.includes(Buffer.from([0xfa]))).toBe(true);
    expect(csv.includes(Buffer.from([0xc3, 0xba]))).toBe(false);
  });

  it('sanea el salto de línea: sigue siendo una sola fila de 57 campos, y avisa', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'SKU\ncorrido' }] };
    const { csv, warnings, filas } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    const lineas = new TextDecoder('windows-1252').decode(csv).split(/\r\n|\r|\n/);
    expect(filas).toBe(1);
    expect(lineas[1].split(';')).toHaveLength(58);
    expect(warnings.map((w) => w.tipo)).toContain('valor_saneado');
  });

  it('no emite advertencias con una OV completa y correcta', () => {
    expect(buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG).warnings).toEqual([]);
  });
});

describe('centro de costos (nombre de World Office)', () => {
  const centroDe = (ov: SalesOrder) =>
    decodificar(buildWorldOfficeCsv([ov], DEFAULT_CONFIG).csv)[1].split(';')[COLUMNS.indexOf('Centro Costos')];

  it('traduce el código al nombre EXACTO de WO cuando difiere del de Zoho', () => {
    // 550303 en Zoho es "ALQUILERES"; en WO es "ALQUILERES AMB" (una de las 5 excepciones).
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: '550303 ALQUILERES' }] };
    expect(centroDe(ov)).toBe('ALQUILERES AMB');
  });

  it('traduce el código que sí está en la lista al nombre de WO', () => {
    expect(centroDe(OV_BASE)).toBe('CALIBRACION ENVIRO'); // 330801 → CALIBRACION ENVIRO
  });

  it('deja la columna vacía y avisa cuando el código no está en la lista de WO', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: '999999 INEXISTENTE' }] };
    const { csv, warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Centro Costos')]).toBe('');
    expect(warnings.find((w) => w.tipo === 'centro_costos_no_en_wo')?.mensaje).toContain('999999');
  });

  it('tolera espacios múltiples y NBSP en el centro de costos', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: '330801  CALIBRACION ENVIRO' }] };
    expect(centroDe(ov)).toBe('CALIBRACION ENVIRO');
  });

  it('deja la columna vacía y avisa si el código no es numérico', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: 'CALIBRACION ENVIRO' }] };
    const { csv, warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Centro Costos')]).toBe('');
    expect(warnings.find((w) => w.tipo === 'centro_costos_invalido')?.mensaje).toContain('CALIBRACION ENVIRO');
  });
});

describe('vencimiento (§10 — fecha de pago)', () => {
  const vencimientoDe = (ov: SalesOrder) =>
    decodificar(buildWorldOfficeCsv([ov], DEFAULT_CONFIG).csv)[1].split(';')[COLUMNS.indexOf('Vencimiento')];

  it('sumarDias suma días calendario en UTC', () => {
    expect(sumarDias('2026-08-13', 30)).toBe('2026-09-12'); // el caso verificado del prompt
    expect(sumarDias('2026-07-14', 30)).toBe('2026-08-13');
  });

  it('Vencimiento = Fecha + payment_terms', () => {
    expect(vencimientoDe({ ...OV_BASE, fecha: '2026-08-13', plazoPago: 30 })).toBe('12/09/2026');
  });

  it('plazo 0 (contado) → Vencimiento = Fecha, sin aviso', () => {
    const { csv, warnings } = buildWorldOfficeCsv([{ ...OV_BASE, plazoPago: 0 }], DEFAULT_CONFIG);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Vencimiento')]).toBe('14/07/2026');
    expect(warnings.map((w) => w.tipo)).not.toContain('plazo_pago_ausente');
  });

  it('plazo ausente → usa el plazo por defecto (30) y avisa una sola vez por OV', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      plazoPago: null,
      lineas: [OV_BASE.lineas[0], { ...OV_BASE.lineas[0], sku: 'SKU-2' }],
    };
    const { csv, warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Vencimiento')]).toBe('13/08/2026'); // 14/07 + 30
    expect(warnings.filter((w) => w.tipo === 'plazo_pago_ausente')).toHaveLength(1);
  });
});

describe('derivarPrefijo', () => {
  it('deriva OV_{AA} (2 dígitos) de la fecha del documento', () => {
    expect(derivarPrefijo('2026-07-14', DEFAULT_CONFIG)).toBe('OV_26');
    expect(derivarPrefijo('2027-01-02', DEFAULT_CONFIG)).toBe('OV_27');
  });
  it('usa el literal de config si se fijó', () => {
    expect(derivarPrefijo('2026-07-14', { ...DEFAULT_CONFIG, prefijo: 'OV_FIJO' })).toBe('OV_FIJO');
  });
});

describe('validación de SKU contra World Office (§5.1)', () => {
  it('avisa sku_no_en_wo cuando el SKU no existe en la lista de World Office', () => {
    // AMB-STCALENVIRO-01 es uno de los que el prompt midió como ausentes en WO.
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'AMB-STCALENVIRO-01' }] };
    const aviso = buildWorldOfficeCsv([ov], DEFAULT_CONFIG).warnings.find((w) => w.tipo === 'sku_no_en_wo');
    expect(aviso?.sku).toBe('AMB-STCALENVIRO-01');
    expect(aviso?.orden).toBe('OV-2026-138');
  });

  it('el SKU inválido se REPORTA pero la línea sigue en el archivo (no se borra en silencio)', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'AMB-STCALENVIRO-01' }] };
    const { filas, csv } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(filas).toBe(1);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Producto')]).toBe('AMB-STCALENVIRO-01');
  });

  it('no valida el SKU si la lista maestra está vacía (skusWO vacío = validación off)', () => {
    const conf = { ...DEFAULT_CONFIG, skusWO: new Set<string>() };
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'INVENTADO-99' }] };
    expect(buildWorldOfficeCsv([ov], conf).warnings.map((w) => w.tipo)).not.toContain('sku_no_en_wo');
  });
});

describe('advertencias', () => {
  it('avisa cuando el artículo no tiene centro de costos, sin abortar', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: null, centrosCostosCount: 0 }] };
    const { warnings, csv } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('sin_centro_costos');
    const campos = decodificar(csv)[1].split(';');
    expect(campos[COLUMNS.indexOf('Centro Costos')]).toBe('');
    expect(campos).toHaveLength(58);
  });

  it('avisa desde el primer centro de costos de más (exactamente 2)', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centrosCostosCount: 2 }] };
    const { warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.find((w) => w.tipo === 'varios_centros_costos')?.mensaje).toContain('2');
  });

  it('avisa si la OV no está en COP', () => {
    const { warnings } = buildWorldOfficeCsv([{ ...OV_BASE, moneda: 'USD' }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('moneda_no_cop');
  });

  it('avisa si falta el NIT, sin abortar', () => {
    const { warnings, filas } = buildWorldOfficeCsv([{ ...OV_BASE, nit: null }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('sin_nit');
    expect(filas).toBe(1);
  });

  it('avisa de la línea sin SKU', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: null }] };
    const { warnings, filas } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('sin_sku');
    expect(filas).toBe(1);
  });

  it('deja vacío, y avisa, en vez de escribir "NaN" en una columna de importes', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], cantidad: NaN }] };
    const { csv, warnings } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Cantidad')]).toBe('');
    const aviso = warnings.find((w) => w.tipo === 'valor_no_numerico');
    expect(aviso?.mensaje).toContain('Cantidad');
    expect(aviso?.mensaje).toContain('NaN');
  });

  it('avisa de la OV sin líneas en vez de dejarla desaparecer', () => {
    const { csv, warnings, filas } = buildWorldOfficeCsv([{ ...OV_BASE, lineas: [] }], DEFAULT_CONFIG);
    expect(filas).toBe(0);
    expect(decodificar(csv)).toEqual([COLUMNS.join(';'), '']);
    expect(warnings.map((w) => w.tipo)).toContain('ov_sin_lineas');
  });

  it('avisa del descuento de cabecera, con el importe, sin abortar', () => {
    const { warnings, filas } = buildWorldOfficeCsv([{ ...OV_BASE, descuentoCabecera: 190000 }], DEFAULT_CONFIG);
    const aviso = warnings.find((w) => w.tipo === 'descuento_cabecera_ignorado');
    expect(aviso?.mensaje).toContain('190000');
    expect(aviso?.orden).toBe('OV-2026-138');
    expect(filas).toBe(1);
  });

  it('no avisa del descuento de cabecera cuando la OV no tiene descuento', () => {
    const { warnings } = buildWorldOfficeCsv([{ ...OV_BASE, descuentoCabecera: 0 }], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).not.toContain('descuento_cabecera_ignorado');
  });

  it('avisa cuando la OV está parcialmente facturada, con la cantidad', () => {
    const { warnings } = buildWorldOfficeCsv([{ ...OV_BASE, cantidadFacturada: 12 }], DEFAULT_CONFIG);
    const aviso = warnings.find((w) => w.tipo === 'ov_parcialmente_facturada');
    expect(aviso?.mensaje).toContain('12');
    expect(aviso?.orden).toBe('OV-2026-138');
  });
});

// §3/§7.4: World Office exige que un mismo DocumentoNúmero tenga una sola Fecha y un solo
// NIT. El consecutivo se asigna por grupo (Fecha, Tercero Externo). El consolidado es
// válido siempre que la llave de documento sea coherente.
describe('DocumentoNúmero: consecutivo por grupo (Fecha, Tercero Externo)', () => {
  const con = (fecha: string, nit: string): SalesOrder => ({ ...OV_BASE, fecha, nit });

  function filasDoc(csv: Buffer) {
    const filas = decodificar(csv).filter((l) => l !== '').slice(1);
    const iDoc = COLUMNS.indexOf('DocumentoNúmero');
    const iFecha = COLUMNS.indexOf('Fecha');
    const iNit = COLUMNS.indexOf('Tercero Externo');
    return filas.map((f) => {
      const c = f.split(';');
      return { doc: c[iDoc], fecha: c[iFecha], nit: c[iNit] };
    });
  }

  it('cada número de documento tiene exactamente una fecha y un NIT (§7.4)', () => {
    const ordenes = [
      con('2026-05-26', '800070853'),
      con('2026-05-26', '800070853'), // mismo grupo
      con('2026-05-27', '901229003'),
      con('2026-05-26', '901229003'), // misma fecha, otro NIT → otro grupo
    ];
    const porDoc = new Map<string, Set<string>>();
    for (const r of filasDoc(buildWorldOfficeCsv(ordenes, DEFAULT_CONFIG).csv)) {
      if (!porDoc.has(r.doc)) porDoc.set(r.doc, new Set());
      porDoc.get(r.doc)!.add(`${r.fecha}|${r.nit}`);
    }
    for (const [doc, claves] of porDoc) expect({ doc, n: claves.size }).toEqual({ doc, n: 1 });
  });

  it('mismo (fecha, NIT) comparte número; otro grupo, número distinto', () => {
    const filas = filasDoc(
      buildWorldOfficeCsv(
        [con('2026-05-26', '800070853'), con('2026-05-26', '800070853'), con('2026-05-27', '901229003')],
        DEFAULT_CONFIG
      ).csv
    );
    expect(filas[0].doc).toBe(filas[1].doc);
    expect(filas[0].doc).not.toBe(filas[2].doc);
  });

  it('numera desde consecutivoInicial, por fecha ascendente', () => {
    const conf = { ...DEFAULT_CONFIG, consecutivoInicial: 24 };
    const filas = filasDoc(
      buildWorldOfficeCsv([con('2026-05-27', '901229003'), con('2026-05-26', '800070853')], conf).csv
    );
    expect(filas[0]).toMatchObject({ fecha: '26/05/2026', doc: '24' });
    expect(filas[1]).toMatchObject({ fecha: '27/05/2026', doc: '25' });
  });
});

describe('avisos del §6 (World Office los tolera, pero se revisan)', () => {
  it('avisa valor_cero cuando el valor unitario es 0, sin abortar', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], valorUnitario: 0 }] };
    const { warnings, csv } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('valor_cero');
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Valor')]).toBe('0');
  });

  it('clampa el vencimiento a la fecha del documento si sale anterior, y avisa', () => {
    const ov: SalesOrder = { ...OV_BASE, fecha: '2026-07-14', plazoPago: -7 };
    const { warnings, csv } = buildWorldOfficeCsv([ov], DEFAULT_CONFIG);
    expect(warnings.map((w) => w.tipo)).toContain('vencimiento_antes_de_fecha');
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Vencimiento')]).toBe('14/07/2026');
  });
});
