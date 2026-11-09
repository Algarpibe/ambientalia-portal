import { describe, it, expect } from 'vitest';
import { buildWorldOfficeCsv, sumarDias, derivarPrefijo, consecutivoOV } from './builder.js';
import { DEFAULT_CONFIG } from './config.js';
import { COLUMNS } from './columns.js';
import type { SalesOrder, Warning } from './types.js';

function decodificar(buf: Buffer): string[] {
  return new TextDecoder('windows-1252').decode(buf).split('\r\n');
}

/** DocumentoNúmero por orden de aparición: lo que importa a casi todos los tests es el resto
 *  del archivo. Los tests de numeración pasan su propio mapa a buildWorldOfficeCsv. */
function numerar(ordenes: SalesOrder[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of ordenes) if (!m.has(o.numero)) m.set(o.numero, m.size + 1);
  return m;
}

function build(ordenes: SalesOrder[], config = DEFAULT_CONFIG) {
  return buildWorldOfficeCsv(ordenes, config, numerar(ordenes));
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
    const { csv, filas } = build([OV_BASE]);
    const lineas = decodificar(csv);
    expect(lineas[0]).toBe(COLUMNS.join(';'));
    expect(filas).toBe(1);
  });

  it('cada fila tiene 58 campos', () => {
    const { csv } = build([OV_BASE]);
    expect(decodificar(csv)[1].split(';')).toHaveLength(58);
  });

  it('termina en CRLF, como la muestra', () => {
    const { csv } = build([OV_BASE]);
    expect(csv.subarray(-2).toString('latin1')).toBe('\r\n');
  });

  it('mapea los valores fijos y variables del modelo', () => {
    const { csv } = build([OV_BASE]);
    const campos = decodificar(csv)[1].split(';');
    const valor = (col: string) => campos[COLUMNS.indexOf(col)];

    expect(valor('Empresa')).toBe('AMBIENTALIA SAS'); // fijo, no el cliente
    expect(valor('Tipo Documento')).toBe('PED');
    expect(valor('prefijo')).toBe('OV_26'); // año de 2 dígitos (WO no acepta 4)
    expect(valor('DocumentoNúmero')).toBe('1'); // el que le da numerar() a la primera OV
    expect(valor('Sucursal')).toBe(''); // vacía pero presente (58 columnas)
    expect(valor('Clasificación')).toBe('');
    expect(valor('Fecha')).toBe('14/07/2026');
    expect(valor('Tercero Interno')).toBe('416544');
    expect(valor('Tercero Externo')).toBe('899999107'); // NIT
    expect(valor('Nota')).toBe('138'); // consecutivo XXX de OV-2026-138
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
    const campos = decodificar(build([OV_BASE]).csv)[1].split(';');
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
    const filas = decodificar(build([ov]).csv).slice(1, 3);
    const INICIO_DETALLE = COLUMNS.indexOf('Producto'); // 30
    const encabezado = (f: string) => f.split(';').slice(0, INICIO_DETALLE).join(';');
    expect(encabezado(filas[0])).toBe(encabezado(filas[1]));
    expect(filas[0].split(';')[COLUMNS.indexOf('Producto')]).toBe('3011026485');
    expect(filas[1].split(';')[COLUMNS.indexOf('Producto')]).toBe('SKU-2');
  });

  it('codifica el archivo en Windows-1252', () => {
    const { csv } = build([OV_BASE]);
    // "DocumentoNúmero" en la cabecera: la ú debe ser 0xFA, no C3 BA.
    expect(csv.includes(Buffer.from([0xfa]))).toBe(true);
    expect(csv.includes(Buffer.from([0xc3, 0xba]))).toBe(false);
  });

  it('sanea el salto de línea: sigue siendo una sola fila de 57 campos, y avisa', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'SKU\ncorrido' }] };
    const { csv, warnings, filas } = build([ov]);
    const lineas = new TextDecoder('windows-1252').decode(csv).split(/\r\n|\r|\n/);
    expect(filas).toBe(1);
    expect(lineas[1].split(';')).toHaveLength(58);
    expect(warnings.map((w) => w.tipo)).toContain('valor_saneado');
  });

  it('no emite advertencias con una OV completa y correcta', () => {
    expect(build([OV_BASE]).warnings).toEqual([]);
  });
});

describe('centro de costos (nombre de World Office)', () => {
  const centroDe = (ov: SalesOrder) =>
    decodificar(build([ov]).csv)[1].split(';')[COLUMNS.indexOf('Centro Costos')];

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
    const { csv, warnings } = build([ov]);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Centro Costos')]).toBe('');
    expect(warnings.find((w) => w.tipo === 'centro_costos_no_en_wo')?.mensaje).toContain('999999');
  });

  it('tolera espacios múltiples y NBSP en el centro de costos', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: '330801  CALIBRACION ENVIRO' }] };
    expect(centroDe(ov)).toBe('CALIBRACION ENVIRO');
  });

  it('deja la columna vacía y avisa si el código no es numérico', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: 'CALIBRACION ENVIRO' }] };
    const { csv, warnings } = build([ov]);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Centro Costos')]).toBe('');
    expect(warnings.find((w) => w.tipo === 'centro_costos_invalido')?.mensaje).toContain('CALIBRACION ENVIRO');
  });
});

describe('vencimiento (§10 — fecha de pago)', () => {
  const vencimientoDe = (ov: SalesOrder) =>
    decodificar(build([ov]).csv)[1].split(';')[COLUMNS.indexOf('Vencimiento')];

  it('sumarDias suma días calendario en UTC', () => {
    expect(sumarDias('2026-08-13', 30)).toBe('2026-09-12'); // el caso verificado del prompt
    expect(sumarDias('2026-07-14', 30)).toBe('2026-08-13');
  });

  it('Vencimiento = Fecha + payment_terms', () => {
    expect(vencimientoDe({ ...OV_BASE, fecha: '2026-08-13', plazoPago: 30 })).toBe('12/09/2026');
  });

  it('plazo 0 (contado) → Vencimiento = Fecha, sin aviso', () => {
    const { csv, warnings } = build([{ ...OV_BASE, plazoPago: 0 }]);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Vencimiento')]).toBe('14/07/2026');
    expect(warnings.map((w) => w.tipo)).not.toContain('plazo_pago_ausente');
  });

  it('plazo ausente → usa el plazo por defecto (30) y avisa una sola vez por OV', () => {
    const ov: SalesOrder = {
      ...OV_BASE,
      plazoPago: null,
      lineas: [OV_BASE.lineas[0], { ...OV_BASE.lineas[0], sku: 'SKU-2' }],
    };
    const { csv, warnings } = build([ov]);
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

describe('Nota = consecutivo (XXX) de la OV', () => {
  it('consecutivoOV toma lo que va después de "OV-AAAA-"', () => {
    expect(consecutivoOV('OV-2026-021')).toBe('021');
    expect(consecutivoOV('OV-2025-1000-01')).toBe('1000-01');
    expect(consecutivoOV('RARO-9')).toBe('RARO-9'); // fuera de patrón: tal cual
  });

  it('una OV de otro año lleva su propio prefijo y su XXX en Nota', () => {
    const ov: SalesOrder = { ...OV_BASE, numero: 'OV-2025-311', fecha: '2025-11-03' };
    const campos = decodificar(build([ov]).csv)[1].split(';');
    expect(campos[COLUMNS.indexOf('prefijo')]).toBe('OV_25');
    expect(campos[COLUMNS.indexOf('Nota')]).toBe('311');
  });

  it('dos OV del mismo (fecha, NIT) llevan cada una su propia Nota', () => {
    const a: SalesOrder = { ...OV_BASE, numero: 'OV-2026-150' };
    const b: SalesOrder = { ...OV_BASE, numero: 'OV-2026-151' }; // mismo (fecha, NIT)
    const filas = decodificar(build([a, b]).csv).filter(Boolean).slice(1);
    const notas = filas.map((f) => f.split(';')[COLUMNS.indexOf('Nota')]);
    expect(notas).toEqual(['150', '151']);
  });
});

describe('validación de SKU contra World Office (§5.1)', () => {
  it('avisa sku_no_en_wo cuando el SKU no existe en la lista de World Office', () => {
    // AMB-STCALENVIRO-01 es uno de los que el prompt midió como ausentes en WO.
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'AMB-STCALENVIRO-01' }] };
    const aviso = build([ov]).warnings.find((w) => w.tipo === 'sku_no_en_wo');
    expect(aviso?.sku).toBe('AMB-STCALENVIRO-01');
    expect(aviso?.orden).toBe('OV-2026-138');
  });

  it('el SKU inválido se REPORTA pero la línea sigue en el archivo (no se borra en silencio)', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'AMB-STCALENVIRO-01' }] };
    const { filas, csv } = build([ov]);
    expect(filas).toBe(1);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Producto')]).toBe('AMB-STCALENVIRO-01');
  });

  it('no valida el SKU si la lista maestra está vacía (skusWO vacío = validación off)', () => {
    const conf = { ...DEFAULT_CONFIG, skusWO: new Set<string>() };
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: 'INVENTADO-99' }] };
    expect(build([ov], conf).warnings.map((w) => w.tipo)).not.toContain('sku_no_en_wo');
  });
});

describe('advertencias', () => {
  it('avisa cuando el artículo no tiene centro de costos, sin abortar', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centroCostos: null, centrosCostosCount: 0 }] };
    const { warnings, csv } = build([ov]);
    expect(warnings.map((w) => w.tipo)).toContain('sin_centro_costos');
    const campos = decodificar(csv)[1].split(';');
    expect(campos[COLUMNS.indexOf('Centro Costos')]).toBe('');
    expect(campos).toHaveLength(58);
  });

  it('avisa desde el primer centro de costos de más (exactamente 2)', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], centrosCostosCount: 2 }] };
    const { warnings } = build([ov]);
    expect(warnings.find((w) => w.tipo === 'varios_centros_costos')?.mensaje).toContain('2');
  });

  it('avisa si la OV no está en COP', () => {
    const { warnings } = build([{ ...OV_BASE, moneda: 'USD' }]);
    expect(warnings.map((w) => w.tipo)).toContain('moneda_no_cop');
  });

  it('avisa si falta el NIT, sin abortar', () => {
    const { warnings, filas } = build([{ ...OV_BASE, nit: null }]);
    expect(warnings.map((w) => w.tipo)).toContain('sin_nit');
    expect(filas).toBe(1);
  });

  it('avisa de la línea sin SKU', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], sku: null }] };
    const { warnings, filas } = build([ov]);
    expect(warnings.map((w) => w.tipo)).toContain('sin_sku');
    expect(filas).toBe(1);
  });

  it('deja vacío, y avisa, en vez de escribir "NaN" en una columna de importes', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], cantidad: NaN }] };
    const { csv, warnings } = build([ov]);
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Cantidad')]).toBe('');
    const aviso = warnings.find((w) => w.tipo === 'valor_no_numerico');
    expect(aviso?.mensaje).toContain('Cantidad');
    expect(aviso?.mensaje).toContain('NaN');
  });

  it('avisa de la OV sin líneas en vez de dejarla desaparecer', () => {
    const { csv, warnings, filas } = build([{ ...OV_BASE, lineas: [] }]);
    expect(filas).toBe(0);
    expect(decodificar(csv)).toEqual([COLUMNS.join(';'), '']);
    expect(warnings.map((w) => w.tipo)).toContain('ov_sin_lineas');
  });

  it('avisa del descuento de cabecera, con el importe, sin abortar', () => {
    const { warnings, filas } = build([{ ...OV_BASE, descuentoCabecera: 190000 }]);
    const aviso = warnings.find((w) => w.tipo === 'descuento_cabecera_ignorado');
    expect(aviso?.mensaje).toContain('190000');
    expect(aviso?.orden).toBe('OV-2026-138');
    expect(filas).toBe(1);
  });

  it('no avisa del descuento de cabecera cuando la OV no tiene descuento', () => {
    const { warnings } = build([{ ...OV_BASE, descuentoCabecera: 0 }]);
    expect(warnings.map((w) => w.tipo)).not.toContain('descuento_cabecera_ignorado');
  });

  it('avisa cuando la OV está parcialmente facturada, con la cantidad', () => {
    const { warnings } = build([{ ...OV_BASE, cantidadFacturada: 12 }]);
    const aviso = warnings.find((w) => w.tipo === 'ov_parcialmente_facturada');
    expect(aviso?.mensaje).toContain('12');
    expect(aviso?.orden).toBe('OV-2026-138');
  });
});

// §3/§7.4: World Office exige que un mismo DocumentoNúmero tenga una sola Fecha y un solo
// NIT. Un pedido de WO por cada OV: así cada pedido se convierte en la factura de su OV
// (en Zoho cada OV se factura por separado). Agrupar por (fecha, NIT) escondía OV dentro
// del pedido de otra (OV-2026-178..182 metidas en el pedido "177").
describe('DocumentoNúmero: el número fijo de cada OV', () => {
  let n = 0;
  const con = (fecha: string, nit: string): SalesOrder => ({ ...OV_BASE, fecha, nit, numero: `OV-2026-${100 + n++}` });

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
    for (const r of filasDoc(build(ordenes).csv)) {
      if (!porDoc.has(r.doc)) porDoc.set(r.doc, new Set());
      porDoc.get(r.doc)!.add(`${r.fecha}|${r.nit}`);
    }
    for (const [doc, claves] of porDoc) expect({ doc, n: claves.size }).toEqual({ doc, n: 1 });
  });

  it('dos OV del mismo (fecha, NIT) llevan números distintos', () => {
    const filas = filasDoc(
      build([con('2026-05-26', '800070853'), con('2026-05-26', '800070853'), con('2026-05-27', '901229003')]).csv
    );
    expect(new Set(filas.map((f) => f.doc)).size).toBe(3);
  });

  it('las líneas de una OV comparten número; las filas van por fecha y número de OV', () => {
    const linea = OV_BASE.lineas[0];
    const ovB: SalesOrder = { ...OV_BASE, numero: 'OV-2026-179', lineas: [linea, linea] };
    const ovA: SalesOrder = { ...OV_BASE, numero: 'OV-2026-178', lineas: [linea] };
    const numeros = new Map([
      ['OV-2026-178', 40],
      ['OV-2026-179', 41],
    ]);
    const filas = decodificar(buildWorldOfficeCsv([ovB, ovA], DEFAULT_CONFIG, numeros).csv).filter(Boolean).slice(1);
    const pares = filas.map((f) => {
      const c = f.split(';');
      return [c[COLUMNS.indexOf('DocumentoNúmero')], c[COLUMNS.indexOf('Nota')]];
    });
    expect(pares).toEqual([['40', '178'], ['41', '179'], ['41', '179']]);
  });

  it('escribe el número que trae el mapa, no uno por posición', () => {
    const numeros = new Map([
      ['OV-2026-212', 38],
      ['OV-2026-150', 7],
    ]);
    const filas = filasDoc(
      buildWorldOfficeCsv(
        [
          { ...OV_BASE, numero: 'OV-2026-212', fecha: '2026-11-03' },
          { ...OV_BASE, numero: 'OV-2026-150', fecha: '2026-09-01' },
        ],
        DEFAULT_CONFIG,
        numeros
      ).csv
    );
    expect(filas.map((f) => f.doc)).toEqual(['7', '38']);
  });

  it('la misma OV lleva el mismo número aunque otra salga del archivo', () => {
    const numeros = new Map([
      ['OV-2026-150', 7],
      ['OV-2026-212', 38],
    ]);
    const a: SalesOrder = { ...OV_BASE, numero: 'OV-2026-150' };
    const b: SalesOrder = { ...OV_BASE, numero: 'OV-2026-212' };
    const antes = filasDoc(buildWorldOfficeCsv([a, b], DEFAULT_CONFIG, numeros).csv);
    const despues = filasDoc(buildWorldOfficeCsv([b], DEFAULT_CONFIG, numeros).csv); // la 150 se facturó
    expect(antes.map((f) => f.doc)).toEqual(['7', '38']);
    expect(despues.map((f) => f.doc)).toEqual(['38']);
  });

  it('lanza si a una OV le falta número: nunca sale la columna D vacía', () => {
    expect(() => buildWorldOfficeCsv([OV_BASE], DEFAULT_CONFIG, new Map())).toThrow(/OV-2026-138/);
  });

  describe('OV con número repetido en la réplica de Zoho (avisar y seguir)', () => {
    const NUM = 'OV-2026-212';
    const numeros = new Map([[NUM, 40]]);
    const repetida = (n: number): SalesOrder[] =>
      Array.from({ length: n }, (_, i) => ({
        ...OV_BASE,
        numero: NUM,
        lineas: [{ ...OV_BASE.lineas[0], sku: `SKU-${i}`, cantidad: i + 1 }],
      }));
    const repetidos = (ws: Warning[]) => ws.filter((w) => w.tipo === 'ov_numero_repetido');

    it('avisa UNA vez por número, con cuántas veces aparece y el DocumentoNúmero compartido', () => {
      const { warnings } = buildWorldOfficeCsv(repetida(2), DEFAULT_CONFIG, numeros);
      const avisos = repetidos(warnings);
      expect(avisos).toHaveLength(1);
      expect(avisos[0].orden).toBe(NUM);
      expect(avisos[0].mensaje).toContain('2 veces');
      expect(avisos[0].mensaje).toContain('DocumentoNúmero 40');
    });

    it('no quita nada del archivo: los dos pedidos siguen saliendo con el mismo número', () => {
      const { csv, filas } = buildWorldOfficeCsv(repetida(2), DEFAULT_CONFIG, numeros);
      expect(filas).toBe(2);
      const iDoc = COLUMNS.indexOf('DocumentoNúmero');
      const docs = decodificar(csv)
        .filter(Boolean)
        .slice(1)
        .map((f) => f.split(';')[iDoc]);
      expect(docs).toEqual(['40', '40']);
    });

    it('con tres apariciones sigue siendo UN aviso, que dice 3 veces', () => {
      const avisos = repetidos(buildWorldOfficeCsv(repetida(3), DEFAULT_CONFIG, numeros).warnings);
      expect(avisos).toHaveLength(1);
      expect(avisos[0].mensaje).toContain('3 veces');
    });

    it('sin números repetidos no hay aviso', () => {
      const a: SalesOrder = { ...OV_BASE, numero: 'OV-2026-150' };
      const b: SalesOrder = { ...OV_BASE, numero: 'OV-2026-212' };
      expect(repetidos(build([a, b]).warnings)).toEqual([]);
    });
  });
});

describe('avisos del §6 (World Office los tolera, pero se revisan)', () => {
  it('avisa valor_cero cuando el valor unitario es 0, sin abortar', () => {
    const ov: SalesOrder = { ...OV_BASE, lineas: [{ ...OV_BASE.lineas[0], valorUnitario: 0 }] };
    const { warnings, csv } = build([ov]);
    expect(warnings.map((w) => w.tipo)).toContain('valor_cero');
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Valor')]).toBe('0');
  });

  it('clampa el vencimiento a la fecha del documento si sale anterior, y avisa', () => {
    const ov: SalesOrder = { ...OV_BASE, fecha: '2026-07-14', plazoPago: -7 };
    const { warnings, csv } = build([ov]);
    expect(warnings.map((w) => w.tipo)).toContain('vencimiento_antes_de_fecha');
    expect(decodificar(csv)[1].split(';')[COLUMNS.indexOf('Vencimiento')]).toBe('14/07/2026');
  });
});
