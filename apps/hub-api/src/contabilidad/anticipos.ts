import type { Pool } from '@algarpibe/zoho-sync';

// Anticipos (facturas de anticipo de Zoho, módulo /retainerinvoices) enlazados a su OV.
//
// Zoho NO enlaza el anticipo con la OV: el vínculo es el texto que alguien escribe a mano en
// la descripción de la línea («Anticipo OV-2026-167»). Por eso todo lo que no se pueda leer
// con certeza va a la lista de atención en vez de perderse en silencio: un número mal
// tecleado no da error, simplemente no enlaza.

/** Un anticipo de books.retainer_invoices, con las descripciones de línea ya sacadas de raw. */
export interface AnticipoRow {
  numero: string;
  fecha: string | null;
  estado: string | null;
  cliente: string | null;
  moneda: string | null;
  cobrado: number | string | null;   // payment_made (numeric de pg llega como texto)
  aplicado: number | string | null;  // payment_drawn
  referencia: string | null;
  descripciones: string[];
}

/** La OV a la que apunta un anticipo, con lo necesario para clasificarlo. */
export interface OVRef {
  numero: string;
  estado: string;
  moneda: string | null;
}

export interface AnticipoDeOV {
  numero: string;
  fecha: string | null;
  estado: string | null;
  cobrado: number;
  sinAplicar: number;
}

export interface ImportesAnticipo {
  cobrado: number;
  sinAplicar: number;
  anticipos: AnticipoDeOV[];
}

export type MotivoAtencion =
  | 'sin_referencia'
  | 'varias_ov'
  | 'ov_inexistente'
  | 'moneda_distinta'
  | 'sin_aplicar_ov_cerrada';

export interface AnticipoAtencion {
  numero: string;
  cliente: string | null;
  fecha: string | null;
  cobrado: number;
  sinAplicar: number;
  motivo: MotivoAtencion;
  ov: string | null;        // la OV nombrada, o varias separadas por comas
  estadoOV: string | null;
  texto: string;            // descripción y referencia tal cual se escribieron
}

export interface AnticiposEnlazados {
  porOV: Map<string, ImportesAnticipo>;
  atencion: AnticipoAtencion[];
}

// «OV» que empieza palabra (MOV-2026-167 no cuenta), separadores tolerantes (guion, raya o
// guion largo, que salen al copiar de Word, o solo espacios) y año de cuatro cifras: un
// «OV-26-167» no se adivina, va al aviso. El número admite ceros a la izquierda.
const PATRON_OV = /(?<![A-Za-z])OV\s*[-–—]?\s*(\d{4})(?!\d)\s*[-–—]?\s*(\d{1,4})(?!\d)/gi;

/** Las OV distintas que nombra un texto, normalizadas a OV-AAAA-NNN. Pura. */
export function extraerOV(texto: string): string[] {
  const vistas = new Set<string>();
  for (const m of texto.matchAll(PATRON_OV)) {
    vistas.add(`OV-${m[1]}-${String(Number(m[2])).padStart(3, '0')}`);
  }
  return [...vistas];
}
