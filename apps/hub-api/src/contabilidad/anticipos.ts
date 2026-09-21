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

// Una OV ya no pendiente de facturar. Si le queda anticipo sin aplicar, hay algo que hacer:
// facturada → se le cobró el total sin descontar lo pagado; anulada → hay que devolverlo.
const ESTADOS_CERRADOS = new Set(['invoiced', 'void']);

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Texto donde se busca la OV: todas las descripciones de línea más la referencia. Pura. */
export function textoDe(a: AnticipoRow): string {
  return [...a.descripciones, a.referencia ?? ''].filter(Boolean).join(' | ');
}

/**
 * Clasifica cada anticipo: o suma en su OV, o va a la lista de atención con UN motivo.
 * Los motivos se evalúan en este orden y gana el primero que cumple: sin referencia, varias
 * OV, OV inexistente, moneda distinta, sin aplicar en OV cerrada. Uno en otra moneda sobre
 * una OV facturada sale como `moneda_distinta`: hasta aclarar la moneda no se puede afirmar
 * nada de su saldo. Pura.
 */
export function enlazarAnticipos(anticipos: AnticipoRow[], ovs: OVRef[]): AnticiposEnlazados {
  const ovPorNumero = new Map(ovs.map((o) => [o.numero, o]));
  const porOV = new Map<string, ImportesAnticipo>();
  const atencion: AnticipoAtencion[] = [];

  for (const a of anticipos) {
    const cobrado = num(a.cobrado);
    const sinAplicar = Math.max(0, cobrado - num(a.aplicado));
    const texto = textoDe(a);
    const refs = extraerOV(texto);
    const avisar = (motivo: MotivoAtencion, ov: string | null, estadoOV: string | null) =>
      atencion.push({ numero: a.numero, cliente: a.cliente, fecha: a.fecha, cobrado, sinAplicar, motivo, ov, estadoOV, texto });

    if (refs.length === 0) { avisar('sin_referencia', null, null); continue; }
    if (refs.length > 1) { avisar('varias_ov', refs.join(', '), null); continue; }
    const ov = ovPorNumero.get(refs[0]);
    if (!ov) { avisar('ov_inexistente', refs[0], null); continue; }
    if ((a.moneda ?? '') !== (ov.moneda ?? '')) { avisar('moneda_distinta', ov.numero, ov.estado); continue; }
    if (ESTADOS_CERRADOS.has(ov.estado) && sinAplicar > 0) { avisar('sin_aplicar_ov_cerrada', ov.numero, ov.estado); continue; }

    const acum = porOV.get(ov.numero) ?? { cobrado: 0, sinAplicar: 0, anticipos: [] };
    acum.cobrado += cobrado;
    acum.sinAplicar += sinAplicar;
    acum.anticipos.push({ numero: a.numero, fecha: a.fecha, estado: a.estado, cobrado, sinAplicar });
    porOV.set(ov.numero, acum);
  }

  atencion.sort((x, y) => (y.fecha ?? '').localeCompare(x.fecha ?? ''));
  return { porOV, atencion };
}

/**
 * Devuelve una COPIA de la OV con los importes de anticipo; `null` = la OV no tiene ninguno.
 * Nunca muta: la lista de OV está cacheada y la comparten las dos apps.
 */
export function conAnticipo<T extends { salesorder_number: string }>(
  o: T,
  enl: AnticiposEnlazados,
): T & { anticipoCobrado: number | null; anticipoSinAplicar: number | null } {
  const a = enl.porOV.get(o.salesorder_number);
  return { ...o, anticipoCobrado: a ? a.cobrado : null, anticipoSinAplicar: a ? a.sinAplicar : null };
}

// Borradores y anulados no cuentan: ni se han emitido ni se van a cobrar.
const ANTICIPOS_SQL = `
  SELECT ri.retainerinvoice_number AS numero,
         ri.date::text              AS fecha,
         ri.status                  AS estado,
         ri.customer_name           AS cliente,
         ri.currency_code           AS moneda,
         ri.payment_made            AS cobrado,
         ri.payment_drawn           AS aplicado,
         ri.reference_number        AS referencia,
         ri.raw -> 'line_items'     AS lineas
    FROM books.retainer_invoices ri
   WHERE COALESCE(ri.status, '') NOT IN ('draft', 'void')`;

// Solo las OV que algún anticipo nombra, en CUALQUIER estado: hace falta saber también de las
// ya facturadas o anuladas para avisar de su anticipo sin aplicar.
const OVS_SQL = `
  SELECT salesorder_number AS numero, status AS estado, currency_code AS moneda
    FROM books.sales_orders
   WHERE salesorder_number = ANY($1::text[])`;

interface FilaAnticipo extends Omit<AnticipoRow, 'descripciones'> {
  lineas: unknown;
}

function descripcionesDe(lineas: unknown): string[] {
  if (!Array.isArray(lineas)) return [];
  return lineas
    .map((l) => (l && typeof l === 'object' ? (l as { description?: unknown }).description : null))
    .filter((d): d is string => typeof d === 'string' && d.trim() !== '');
}

/** Lee los anticipos y las OV que nombran, y los enlaza. */
export async function getAnticiposEnlazados(db: Pool): Promise<AnticiposEnlazados> {
  const { rows } = await db.query(ANTICIPOS_SQL);
  const anticipos: AnticipoRow[] = (rows as FilaAnticipo[]).map(({ lineas, ...r }) => ({
    ...r,
    descripciones: descripcionesDe(lineas),
  }));
  const numeros = [...new Set(anticipos.flatMap((a) => extraerOV(textoDe(a))))];
  const ovs = numeros.length ? ((await db.query(OVS_SQL, [numeros])).rows as OVRef[]) : [];
  return enlazarAnticipos(anticipos, ovs);
}
