import type { Pool } from '@algarpibe/zoho-sync';

// Pagos de clientes agrupados por semana del mes, para la pestaña «Pagos recibidos» de
// Contabilidad. Toda la lógica de semanas vive aquí, en funciones puras: SQL solo trae
// las filas.

export interface SemanaDelMes {
  anio: number;
  mes: number;    // 1-12
  semana: number; // 1-6
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Día de la semana del día 1 del mes, 0=lunes … 6=domingo. En UTC a propósito: el
// servidor corre en UTC y las fechas llegan como 'AAAA-MM-DD' sin hora, así que no hay
// zona horaria que pueda mover el día.
function diaIsoDelDia1(anio: number, mes: number): number {
  return (new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay() + 6) % 7;
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

const dos = (n: number) => String(n).padStart(2, '0');

/**
 * Semana del mes de una fecha 'AAAA-MM-DD'. Regla aprobada el 2026-10-01: la semana empieza
 * en lunes; la semana 1 va del día 1 al primer domingo aunque quede corta, y un mes de 30
 * días que empieza en domingo (o de 31 que empieza en sábado o domingo) llega a semana 6.
 */
export function semanaDelMes(fecha: string): SemanaDelMes {
  const [anio, mes, dia] = fecha.slice(0, 10).split('-').map(Number);
  return { anio, mes, semana: Math.floor((dia - 1 + diaIsoDelDia1(anio, mes)) / 7) + 1 };
}

/** Primer y último día de una semana del mes, y su etiqueta legible («1-6 sep 2026»). */
export function rangoDeSemana(anio: number, mes: number, semana: number): { desde: string; hasta: string; etiqueta: string } {
  const iso = diaIsoDelDia1(anio, mes);
  const diaDesde = Math.max(1, 7 * (semana - 1) - iso + 1);
  const diaHasta = Math.min(7 * semana - iso, diasDelMes(anio, mes));
  const dias = diaDesde === diaHasta ? `${diaDesde}` : `${diaDesde}-${diaHasta}`;
  return {
    desde: `${anio}-${dos(mes)}-${dos(diaDesde)}`,
    hasta: `${anio}-${dos(mes)}-${dos(diaHasta)}`,
    etiqueta: `${dias} ${MESES[mes - 1]} ${anio}`,
  };
}

/** Una fila de la consulta: un pago × una factura aplicada (o ninguna). */
export interface FilaPago {
  payment_id: string;
  payment_number: string | null;
  customer_name: string | null;
  fecha: string | null;
  payment_mode: string | null;
  reference_number: string | null;
  currency_code: string | null;
  amount: number | string | null;          // numeric de pg llega como texto
  unused_amount: number | string | null;
  invoice_number: string | null;           // null: el pago no se aplicó a ninguna factura
  amount_applied: number | string | null;
  salesorder_number: string | null;        // null: la factura no tiene OV enlazada
}

export interface AplicacionPago {
  factura: string;
  ov: string | null;
  importe: number;
}

export interface Pago {
  numero: string;
  cliente: string;
  fecha: string;
  modo: string | null;
  referencia: string | null;
  moneda: string;          // Zoho solo aplica un pago a facturas de su misma moneda
  importe: number;
  sinAplicar: number;
  aplicaciones: AplicacionPago[];
}

export interface TotalMoneda {
  moneda: string;
  total: number;
}

export interface SemanaDePagos extends SemanaDelMes {
  etiqueta: string;
  desde: string;
  hasta: string;
  cantidadPagos: number;
  totales: TotalMoneda[];  // COP primero; nunca se suman monedas distintas
  pagos: Pago[];
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Filas SQL (pago × factura) → semanas con sus pagos. Un pago aparece UNA vez aunque se
 * aplicara a varias facturas, y aparece aunque no se aplicara a ninguna: es justo lo que la
 * pestaña tiene que dejar ver. La semana sale de la fecha del PAGO (pagos recibidos), no de
 * la de cada aplicación. Más reciente primero, en las semanas y dentro de cada semana. Pura.
 */
export function agruparPagos(filas: FilaPago[]): SemanaDePagos[] {
  const pagos = new Map<string, Pago>();
  for (const f of filas) {
    if (!f.fecha) continue; // sin fecha no hay semana a la que asignarlo
    let p = pagos.get(f.payment_id);
    if (!p) {
      p = {
        numero: f.payment_number ?? '',
        cliente: f.customer_name ?? '',
        fecha: f.fecha.slice(0, 10),
        modo: f.payment_mode,
        referencia: f.reference_number,
        moneda: f.currency_code || 'COP',
        importe: num(f.amount),
        sinAplicar: num(f.unused_amount),
        aplicaciones: [],
      };
      pagos.set(f.payment_id, p);
    }
    if (f.invoice_number) {
      p.aplicaciones.push({ factura: f.invoice_number, ov: f.salesorder_number, importe: num(f.amount_applied) });
    }
  }

  const semanas = new Map<string, SemanaDePagos>();
  // Totales por moneda de cada semana: hay pagos en USD y EUR, y sumarlos con los pesos
  // daría una cifra sin sentido. Convertir tampoco es fiable: la moneda base de la
  // organización es USD, así que bcy_amount está en dólares, no en pesos.
  const totales = new Map<string, Map<string, number>>();
  for (const p of pagos.values()) {
    const { anio, mes, semana } = semanaDelMes(p.fecha);
    const clave = `${anio}-${mes}-${semana}`;
    let s = semanas.get(clave);
    if (!s) {
      s = { anio, mes, semana, ...rangoDeSemana(anio, mes, semana), cantidadPagos: 0, totales: [], pagos: [] };
      semanas.set(clave, s);
      totales.set(clave, new Map());
    }
    s.pagos.push(p);
    s.cantidadPagos += 1;
    const porMoneda = totales.get(clave)!;
    porMoneda.set(p.moneda, (porMoneda.get(p.moneda) ?? 0) + p.importe);
  }

  for (const [clave, s] of semanas) {
    s.pagos.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.numero.localeCompare(a.numero));
    s.totales = [...totales.get(clave)!]
      .map(([moneda, total]) => ({ moneda, total }))
      .sort((a, b) => (a.moneda === 'COP' ? -1 : b.moneda === 'COP' ? 1 : a.moneda.localeCompare(b.moneda)));
  }
  return [...semanas.values()].sort((a, b) => b.desde.localeCompare(a.desde));
}

// LEFT JOIN desde customer_payments, no JOIN: un pago con todo el saldo sin aplicar no
// tiene filas en customer_payment_invoices y desaparecería. El salto a la OV va por
// invoices.salesorder_id (poblado al 100%, ver source.ts), no por reference_number.
const PAGOS_SQL = `
  SELECT p.payment_id,
         p.payment_number,
         p.customer_name,
         p.date::text          AS fecha,
         p.payment_mode,
         p.reference_number,
         p.currency_code,
         p.amount,
         p.unused_amount,
         cpi.invoice_number,
         cpi.amount_applied,
         so.salesorder_number
    FROM books.customer_payments p
    LEFT JOIN books.customer_payment_invoices cpi ON cpi.payment_id = p.payment_id
    LEFT JOIN books.invoices i ON i.invoice_id = cpi.invoice_id
    LEFT JOIN books.sales_orders so ON so.salesorder_id = i.salesorder_id
   ORDER BY p.date, p.payment_number, cpi.invoice_number`;

/** Lee todos los pagos con sus aplicaciones y los agrupa por semana del mes. */
export async function getPagosPorSemana(db: Pool): Promise<SemanaDePagos[]> {
  const { rows } = await db.query(PAGOS_SQL);
  return agruparPagos(rows as FilaPago[]);
}
