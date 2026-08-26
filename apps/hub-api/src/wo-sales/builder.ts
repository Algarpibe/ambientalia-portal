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

/** ISO YYYY-MM-DD + n días calendario → ISO YYYY-MM-DD. En UTC para que ningún
 *  desfase de zona reste un día. Cadena vacía si la fecha base no es válida. */
export function sumarDias(iso: string | null, dias: number): string {
  if (!iso) return '';
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return '';
  const dt = new Date(Date.UTC(a, m - 1, d) + dias * 86_400_000);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** Prefijo del documento: el literal de config si se fijó, o `OV_{año}` derivado del
 *  año de la fecha del documento (para que en enero no haya que tocar nada). */
export function derivarPrefijo(fechaIso: string, config: WoSalesConfig): string {
  if (config.prefijo) return config.prefijo;
  const anio = fechaIso.slice(0, 4);
  return /^\d{4}$/.test(anio) ? `OV_${anio}` : '';
}

/** Normaliza un SKU para compararlo con el listado de World Office. `\s` incluye el
 *  NBSP, así que colapsa cualquier espacio raro; trim al final. El SKU es un token. */
export function normSku(sku: string): string {
  return sku.replace(/\s+/g, ' ').trim();
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
 * descarta entero: es preferible dejar la columna vacía (y avisar) a escribir basura.
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
  // Matriz de celdas (cabecera + una fila por línea), como strings. Es la fuente única
  // para los dos formatos: el CSV se serializa uniendo con ';' y codificando a cp1252;
  // el .xls re-tipa cada celda según TIPO_COLUMNA. Así .csv y .xls no pueden divergir.
  const matriz: string[][] = [[...COLUMNS]];

  const avisar = (w: Warning) => warnings.push(w);

  const campo = (orden: string, valor: string): string => {
    const { valor: v, saneado } = sanear(valor);
    if (saneado) {
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

  /** Vencimiento (§10) = fecha de pago. Se calcula una vez por OV; avisa (una vez) si
   *  falta el plazo de pago y se cae al plazo por defecto. */
  const vencimientoDeLaOv = (ov: SalesOrder): string => {
    const v = config.vencimiento;
    if (v.regla === 'igual_a_fecha') return toWoDate(ov.fecha);
    if (v.regla === 'fecha_fija') return toWoDate(v.fechaFija ?? null);
    // fecha_documento_mas_plazo
    let plazo = ov.plazoPago;
    if (plazo === null || plazo === undefined || !Number.isFinite(plazo)) {
      plazo = v.plazoPorDefectoDias;
      avisar({
        tipo: 'plazo_pago_ausente',
        orden: ov.numero,
        mensaje: `La OV no trae plazo de pago (payment_terms) en Zoho; se usó el plazo por defecto de ${v.plazoPorDefectoDias} días para el vencimiento.`,
      });
    }
    if (plazo === 0) return toWoDate(ov.fecha);
    return toWoDate(sumarDias(ov.fecha, plazo));
  };

  /** Nombre del centro de costos EXACTO de World Office (§5.2). Traduce el código con la
   *  homologación de config; si el código no está en WO, avisa y deja la columna vacía
   *  (nunca se escribe un nombre que WO no reconozca). */
  const centroCostosWO = (ov: SalesOrder, l: SalesOrderLine): string => {
    const cc = partirCentroCostos(l.centroCostos);
    if (l.centroCostos && !cc.valido) {
      avisar({
        tipo: 'centro_costos_invalido',
        orden: ov.numero,
        sku: l.sku ?? undefined,
        mensaje: `El centro de costos no tiene el formato "código descripción": ${JSON.stringify(l.centroCostos)}. Se dejó la columna vacía.`,
      });
      return '';
    }
    if (!cc.valido) return '';
    const nombre = config.centrosCostosWO[cc.codigo];
    if (nombre === undefined) {
      avisar({
        tipo: 'centro_costos_no_en_wo',
        orden: ov.numero,
        sku: l.sku ?? undefined,
        mensaje: `El centro de costos ${cc.codigo} (${JSON.stringify(cc.descripcion)}) no está en la lista de World Office. Se dejó la columna vacía.`,
      });
      return '';
    }
    return nombre;
  };

  function detalle(ov: SalesOrder, l: SalesOrderLine, vencimiento: string): string[] {
    // SKU: null → sin_sku; presente pero fuera del listado de WO → sku_no_en_wo (§5.1).
    if (!l.sku) {
      avisar({ tipo: 'sin_sku', orden: ov.numero, mensaje: 'Línea sin SKU: World Office la rechazará.' });
    } else if (config.skusWO.size > 0 && !config.skusWO.has(normSku(l.sku))) {
      avisar({
        tipo: 'sku_no_en_wo',
        orden: ov.numero,
        sku: l.sku,
        mensaje: `El SKU "${l.sku}" no existe en World Office: rechazaría esta línea. Créalo en WO o corrige el artículo antes de subir.`,
      });
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

    // 27 campos (posiciones 30–56): 12 nombrados + Moneda Det + TRM Det + 15 personalizados.
    return [
      campo(ov.numero, l.sku ?? ''), //            30 Producto (texto, aunque sea numérico)
      config.bodega, //                            31 Bodega
      config.unidadDeMedida, //                    32 UnidadDeMedida
      num(ov.numero, 'Cantidad', l.cantidad), //   33 Cantidad
      config.iva, //                               34 Iva
      num(ov.numero, 'Valor', l.valorUnitario), // 35 Valor
      config.descuento, //                         36 Descuento (fijo 0)
      vencimiento, //                              37 Vencimiento (fecha de pago)
      '', //                                       38 Nota Detalle (vacía)
      campo(ov.numero, centroCostosWO(ov, l)), //  39 Centro Costos (nombre WO)
      '', //                                       40 Moneda Det
      '', //                                       41 TRM Det
      ...Array(15).fill(''), //                    42–56 Personalizado1..15Det
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
    if (ov.moneda && ov.moneda !== 'COP') {
      avisar({
        tipo: 'moneda_no_cop',
        orden: ov.numero,
        mensaje: `Moneda ${ov.moneda}: el valor unitario NO está en pesos y World Office lo cargaría mal.`,
      });
    }
    if (ov.cantidadFacturada > 0) {
      avisar({
        tipo: 'ov_parcialmente_facturada',
        orden: ov.numero,
        mensaje: `Esta OV ya tiene ${ov.cantidadFacturada} unidad(es) facturada(s): el archivo trae solo las cantidades pendientes de facturar.`,
      });
    }
    if (ov.descuentoCabecera > 0) {
      avisar({
        tipo: 'descuento_cabecera_ignorado',
        orden: ov.numero,
        mensaje: `La OV tiene un descuento de ${ov.descuentoCabecera} a nivel de documento que NO aparece en el archivo: el pedido entraría a World Office a precio completo. Aplícalo a mano o revísalo antes de subir.`,
      });
    }

    const vencimiento = vencimientoDeLaOv(ov);

    // 30 campos (posiciones 0–29): 14 nombrados + 15 personalizados + Importacion.
    // Se calcula una vez por OV y se repite idéntico en cada línea.
    const encabezado: string[] = [
      config.empresa, //                  0  Empresa (fijo AMBIENTALIA SAS)
      config.tipoDocumento, //            1  Tipo Documento (PED)
      derivarPrefijo(ov.fecha, config), //2  prefijo (OV_{año})
      config.documentoNumero, //          3  DocumentoNúmero (número, fijo 1)
      toWoDate(ov.fecha), //              4  Fecha
      config.terceroInterno, //           5  Tercero Interno (texto, fijo)
      campo(ov.numero, ov.nit ?? ''), //  6  Tercero Externo (NIT, texto)
      config.nota, //                     7  Nota (PEDIDO)
      config.formaPago, //                8  FormaDePago (Credito)
      '', //                              9  FechaEntrega (vacía)
      '', //                              10 Moneda (vacía)
      '', //                              11 TRM (vacía)
      config.verificado, //               12 Verificado (número, 0)
      config.anulado, //                  13 Anulado (número, 0)
      ...Array(15).fill(''), //           14–28 Personalizado1..15
      '', //                              29 Importacion (vacía)
    ];

    for (const linea of ov.lineas) {
      matriz.push([...encabezado, ...detalle(ov, linea, vencimiento)]);
    }
  }

  return {
    csv: toWindows1252(matriz.map((f) => f.join(SEP)).join(EOL) + EOL),
    matriz,
    warnings,
    filas: matriz.length - 1,
    ordenes: ordenes.length,
  };
}
