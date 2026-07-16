/**
 * Todo lo ajustable del formato en un solo sitio: valores fijos, campos en disputa
 * y homologaciones. La lógica del builder no debe contener ninguna constante.
 */
export interface WoSalesConfig {
  /** 'cliente' = usar el nombre del cliente de la OV. Cualquier otro string = literal fijo.
   *  El `& {}` preserva el autocompletado del literal sin cerrar el tipo (TS#29729). */
  empresa: 'cliente' | (string & {});
  tipoDocumento: string;
  terceroInterno: string;
  nota: string;
  verificado: string;
  anulado: string;
  bodega: string;
  unidadDeMedida: string;
  iva: string;
  vencimiento: string;
  /** Estados de OV que se consideran vivas. */
  estadosVivos: string[];
  /** Estados de factura que NO matan la OV. Cualquier otro sí. */
  estadosFacturaIgnorados: string[];
  formasPago: Record<string, string>;
  formaPagoPorDefecto: string;
}

export const DEFAULT_CONFIG: WoSalesConfig = {
  // VALIDAR con Xiomara: la descripción de campos dice cliente; la muestra trae
  // "WORLD OFFICE PRUEBAS", que es la empresa del entorno de pruebas de WO.
  empresa: 'cliente',
  tipoDocumento: 'FV',
  terceroInterno: '51023563',
  nota: 'Orden de Venta',
  verificado: '-1',
  // VALIDAR con Xiomara: la descripción dice "En blanco / OMITIR"; la muestra trae 0.
  anulado: '',
  bodega: 'Principal',
  unidadDeMedida: 'Und.',
  // VALIDAR con Xiomara: tratamiento de artículos exentos o con IVA distinto.
  iva: '0.19',
  // VALIDAR con Xiomara: la descripción dice vacío; la muestra trae fecha.
  vencimiento: '',

  // Verificado en la base: open 16, overdue 11, partially_invoiced 6 = 33 OV vivas.
  // (invoiced 1073, void 23, draft 1, pending_approval 1 quedan fuera.)
  estadosVivos: ['open', 'overdue', 'partially_invoiced'],
  // Más amplio que el "Enviado" del acta a propósito: una factura 'paid' deja la OV
  // igual de muerta que una 'sent'. Verificado: 4 OV vivas ya tienen factura 'sent'.
  estadosFacturaIgnorados: ['draft', 'void'],

  // VALIDAR con Xiomara, sobre todo los mixtos. Las 8 etiquetas son las reales de
  // las OV vivas; ninguna es Credito/Contado, que es lo que usa la muestra de WO.
  formasPago: {
    '100% Anticipado': 'Contado',
    '100% Contra Entrega': 'Contado',
    '15 días fecha de factura': 'Credito',
    '25 días fecha de factura': 'Credito',
    '30 días fecha de factura': 'Credito',
    '45 días fecha de factura': 'Credito',
    '50% Anticipado + 50% Contra Entrega': 'Credito',
    '50% Contra Entrega + 50% a 30 días ff': 'Credito',
  },
  formaPagoPorDefecto: 'Credito',
};
