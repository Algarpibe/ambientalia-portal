import { COLUMNS } from './columns.js';
import { toWindows1252 } from './encoding.js';
import type { WoSalesConfig } from './config.js';
import type { BuildResult, SalesOrder, SalesOrderLine, Warning } from './types.js';

const SEP = ';';
const EOL = '\r\n';

/** ISO YYYY-MM-DD → DD/MM/AAAA. Cadena vacía si no hay fecha. */
export function toWoDate(iso: string | null): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '';
}

/**
 * El formato no usa comillas: ni el separador (;) ni el terminador de registro
 * (CR/LF) pueden aparecer dentro de un valor sin romper la fila. Zoho permite
 * descripciones multilínea, así que esto se dispara con datos reales.
 */
export function sanear(valor: string): { valor: string; saneado: boolean } {
  const limpio = valor.replace(/[\r\n]+/g, ' ').replaceAll(SEP, ',');
  return { valor: limpio, saneado: limpio !== valor };
}

/**
 * "330801 CALIBRACION ENVIRO" → { codigo: '330801', descripcion: 'CALIBRACION ENVIRO' }
 * Si el primer tramo no es numérico, el valor no cumple el formato esperado y se
 * descarta entero: es preferible dejar las dos columnas vacías (y avisar) a escribir
 * texto en la columna del código contable.
 */
export function partirCentroCostos(valor: string | null): {
  codigo: string;
  descripcion: string;
  valido: boolean;
} {
  if (!valor?.trim()) return { codigo: '', descripcion: '', valido: false };
  // \s+ y no ' ': cubre de paso los espacios múltiples y el NBSP que teclea un humano.
  const [codigo, ...resto] = valor.trim().split(/\s+/);
  if (!/^\d+$/.test(codigo)) return { codigo: '', descripcion: '', valido: false };
  return { codigo, descripcion: resto.join(' '), valido: true };
}

export function buildWorldOfficeCsv(ordenes: SalesOrder[], config: WoSalesConfig): BuildResult {
  const warnings: Warning[] = [];
  const filas: string[] = [COLUMNS.join(SEP)];

  const avisar = (w: Warning) => warnings.push(w);

  const campo = (orden: string, valor: string): string => {
    const { valor: v, saneado } = sanear(valor);
    if (saneado) {
      // El mensaje nombra los dos vectores: sanear() ya no toca solo el ";".
      avisar({
        tipo: 'valor_saneado',
        orden,
        mensaje: `Se sustituyeron caracteres que romperían la fila (";" o salto de línea): ${JSON.stringify(valor)} → ${JSON.stringify(v)}`,
      });
    }
    return v;
  };

  /**
   * Las filas de pg son `any`, así que el `number` de la firma es una promesa que el
   * borde no cumple: sin esto, un NaN acaba escrito como "NaN" en una columna de
   * importes. Vacío y no 0: un 0 silencioso en cantidad o valor unitario es un error
   * contable peor que una línea que World Office rechaza ruidosamente.
   */
  const num = (ov: string, campoNombre: string, n: number): string => {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      // String() y no JSON.stringify() para los números: JSON.stringify(NaN) e
      // (Infinity) dan los dos "null", y el aviso mandaría a buscar en Zoho un campo
      // vacío en vez del valor corrupto que hay de verdad.
      const visible = typeof n === 'number' ? String(n) : JSON.stringify(n);
      avisar({
        tipo: 'valor_no_numerico',
        orden: ov,
        mensaje: `${campoNombre} no es un número válido: ${visible}. Se dejó vacío.`,
      });
      return '';
    }
    return String(n);
  };

  function detalle(ov: SalesOrder, l: SalesOrderLine): string[] {
    if (!l.sku) {
      avisar({ tipo: 'sin_sku', orden: ov.numero, mensaje: 'Línea sin SKU: World Office la rechazará.' });
    }
    if (!l.centroCostos) {
      avisar({
        tipo: 'sin_centro_costos',
        orden: ov.numero,
        sku: l.sku ?? undefined,
        mensaje: 'El artículo no tiene centro de costos (el sync aún no baja cf_centro_de_costos).',
      });
    }
    if (l.centrosCostosCount > 1) {
      avisar({
        tipo: 'varios_centros_costos',
        orden: ov.numero,
        sku: l.sku ?? undefined,
        mensaje: `El artículo tiene ${l.centrosCostosCount} centros de costo; se usó el primero.`,
      });
    }

    const cc = partirCentroCostos(l.centroCostos);
    if (l.centroCostos && !cc.valido) {
      avisar({
        tipo: 'centro_costos_invalido',
        orden: ov.numero,
        sku: l.sku ?? undefined,
        mensaje: `El centro de costos no tiene el formato "código descripción": ${JSON.stringify(l.centroCostos)}. Se dejaron ambas columnas vacías.`,
      });
    }

    // 26 campos: 10 nombrados + 15 personalizados + Código Centro Costos.
    return [
      campo(ov.numero, l.sku ?? ''),
      config.bodega,
      config.unidadDeMedida,
      num(ov.numero, 'Cantidad', l.cantidad),
      config.iva,
      num(ov.numero, 'Valor Unitario', l.valorUnitario),
      num(ov.numero, 'Descuento', l.descuento),
      config.vencimiento,
      campo(ov.numero, l.descripcion ?? ''),
      campo(ov.numero, cc.descripcion),
      ...Array(15).fill(''),
      campo(ov.numero, cc.codigo),
    ];
  }

  for (const ov of ordenes) {
    if (ov.lineas.length === 0) {
      avisar({
        tipo: 'ov_sin_lineas',
        orden: ov.numero,
        mensaje: 'La OV no tiene líneas de producto: no genera ninguna fila y no aparece en el archivo.',
      });
    }
    if (!ov.nit) {
      avisar({ tipo: 'sin_nit', orden: ov.numero, mensaje: 'El cliente no tiene NIT en Zoho.' });
    }
    if (!ov.fechaEntrega) {
      avisar({ tipo: 'sin_fecha_entrega', orden: ov.numero, mensaje: 'La OV no tiene fecha de envío esperada.' });
    }
    if (ov.moneda && ov.moneda !== 'COP') {
      avisar({
        tipo: 'moneda_no_cop',
        orden: ov.numero,
        mensaje: `Moneda ${ov.moneda}: el valor unitario NO está en pesos y World Office lo cargaría mal.`,
      });
    }
    if (ov.descuentoCabecera > 0) {
      // El descuento de esta OV está a nivel de documento (discount_type "entity_level"
      // en Zoho), y el CSV solo tiene columna de descuento por línea. No se reparte
      // automáticamente porque cómo prorratearlo es una decisión contable, no técnica
      // (VALIDAR con Xiomara). Lo que NO se puede es callarlo: el pedido entraría a
      // World Office a precio completo.
      avisar({
        tipo: 'descuento_cabecera_ignorado',
        orden: ov.numero,
        mensaje: `La OV tiene un descuento de ${ov.descuentoCabecera} a nivel de documento que NO aparece en el archivo: el pedido entraría a World Office a precio completo. Aplícalo a mano o revísalo antes de subir.`,
      });
    }

    const formaPago = ov.formaPagoZoho ? config.formasPago[ov.formaPagoZoho] : undefined;
    if (ov.formaPagoZoho && !formaPago) {
      avisar({
        tipo: 'forma_pago_desconocida',
        orden: ov.numero,
        mensaje: `Término de pago sin homologar: "${ov.formaPagoZoho}". Se usó "${config.formaPagoPorDefecto}".`,
      });
    }

    const empresa = config.empresa === 'cliente' ? (ov.clienteNombre ?? '') : config.empresa;
    if (config.empresa === 'cliente' && !ov.clienteNombre) {
      avisar({
        tipo: 'sin_empresa',
        orden: ov.numero,
        mensaje: 'El cliente no tiene nombre en Zoho y la empresa sale del cliente: la columna va vacía.',
      });
    }

    // 31 campos: 14 nombrados + 15 personalizados + Sucursal + Clasificación.
    // Se calcula una vez por OV y se repite idéntico en cada línea.
    const encabezado: string[] = [
      campo(ov.numero, empresa),
      config.tipoDocumento,
      '',
      campo(ov.numero, ov.numero),
      toWoDate(ov.fecha),
      config.terceroInterno,
      campo(ov.numero, ov.nit ?? ''),
      config.nota,
      formaPago ?? config.formaPagoPorDefecto,
      toWoDate(ov.fechaEntrega),
      '',
      '',
      config.verificado,
      config.anulado,
      ...Array(15).fill(''),
      '',
      '',
    ];

    for (const linea of ov.lineas) {
      filas.push([...encabezado, ...detalle(ov, linea)].join(SEP));
    }
  }

  return {
    csv: toWindows1252(filas.join(EOL) + EOL),
    warnings,
    filas: filas.length - 1,
    ordenes: ordenes.length,
  };
}
