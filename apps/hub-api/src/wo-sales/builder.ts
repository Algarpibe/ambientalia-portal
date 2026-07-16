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
 * El formato no usa comillas, así que un ; dentro de un valor rompería la fila
 * entera y World Office leería los campos corridos. Se sustituye por coma.
 */
export function sanear(valor: string): { valor: string; saneado: boolean } {
  if (!valor.includes(SEP)) return { valor, saneado: false };
  return { valor: valor.replaceAll(SEP, ','), saneado: true };
}

/** "330801 CALIBRACION ENVIRO" → { codigo: '330801', descripcion: 'CALIBRACION ENVIRO' } */
export function partirCentroCostos(valor: string | null): { codigo: string; descripcion: string } {
  if (!valor) return { codigo: '', descripcion: '' };
  const limpio = valor.trim();
  const i = limpio.indexOf(' ');
  if (i === -1) return { codigo: limpio, descripcion: '' };
  return { codigo: limpio.slice(0, i), descripcion: limpio.slice(i + 1).trim() };
}

function num(n: number): string {
  return String(n);
}

export function buildWorldOfficeCsv(ordenes: SalesOrder[], config: WoSalesConfig): BuildResult {
  const warnings: Warning[] = [];
  const filas: string[] = [COLUMNS.join(SEP)];

  const avisar = (w: Warning) => warnings.push(w);

  const campo = (orden: string, valor: string): string => {
    const { valor: v, saneado } = sanear(valor);
    if (saneado) {
      avisar({ tipo: 'valor_saneado', orden, mensaje: `Se sustituyó ";" por "," en: ${valor}` });
    }
    return v;
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
    // 26 campos: 10 nombrados + 15 personalizados + Código Centro Costos.
    return [
      campo(ov.numero, l.sku ?? ''),
      config.bodega,
      config.unidadDeMedida,
      num(l.cantidad),
      config.iva,
      num(l.valorUnitario),
      num(l.descuento),
      config.vencimiento,
      campo(ov.numero, l.descripcion ?? ''),
      campo(ov.numero, cc.descripcion),
      ...Array(15).fill(''),
      campo(ov.numero, cc.codigo),
    ];
  }

  for (const ov of ordenes) {
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

    const formaPago = ov.formaPagoZoho ? config.formasPago[ov.formaPagoZoho] : undefined;
    if (ov.formaPagoZoho && !formaPago) {
      avisar({
        tipo: 'forma_pago_desconocida',
        orden: ov.numero,
        mensaje: `Término de pago sin homologar: "${ov.formaPagoZoho}". Se usó "${config.formaPagoPorDefecto}".`,
      });
    }

    const empresa = config.empresa === 'cliente' ? (ov.clienteNombre ?? '') : config.empresa;

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
