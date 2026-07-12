
export interface FileData {
  file: File | null;
  name: string;
  error: string | null;
}

export interface RawRowData {
  [key: string]: any;
}

export interface ProcessedItem {
  'sku': string;
  'item_name': string;
  'Existencias Comprometidas en contabilidad (Por facturar)': number;
  'Existencias Comprometidas en físico (Por Enviar)': number;
  'Existencias a mano de contabilidad': number;
  'Existencias a mano físicas': number;
  'Disponible para la venta': number;
  'Cantidad Por Facturar': number | string;
  'Por Facturar': string;
  'Cantidad Por Entregar': number | string;
  'Por Entregar': string;
}

export interface FileInputConfig {
  id: string;
  label: string;
  description: string;
  colorClass: string;
}
    