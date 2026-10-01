import type { ReconciledRow } from '../types';
import { parseExcelDate } from '../customerAnalysisUtils';
import { clientIdentity } from './clientIdentity';
import { isCop } from '../currency';

// Receivables aging: a snapshot of what is owed TODAY, by days past due.
// Unlike the yearly KPIs it includes every year (an unpaid 2020 invoice is the
// most urgent one to collect). Void and draft invoices are not receivables.

export const AGING_KEYS = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
export type AgingKey = (typeof AGING_KEYS)[number];

/** One open invoice behind an aging bucket. daysPastDue is <= 0 while not yet due. */
export interface AgingInvoice {
  invoiceNumber: string;
  clientName: string;
  balance: number;
  daysPastDue: number;
  dueDate: Date;
}

export interface AgingBucket {
  key: AgingKey;
  balance: number;
  invoiceCount: number;
  clientCount: number;
  /** Largest balance first, then invoice number. */
  invoices: AgingInvoice[];
}

export interface ReceivablesAging {
  buckets: AgingBucket[];
  /** Balance past due (every bucket except notDue). */
  overdueBalance: number;
  overdueInvoiceCount: number;
  /** Open invoices in a currency other than COP: not converted, so left out of every amount. */
  otherCurrencyInvoiceCount: number;
}

interface OpenInvoice {
  row: ReconciledRow;
  daysPastDue: number;
  balance: number;
  due: Date;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function openInvoices(rows: ReconciledRow[], today: Date): OpenInvoice[] {
  const cutoff = startOfDay(today);
  const result: OpenInvoice[] = [];
  for (const row of rows) {
    const status = (row.status ?? '').trim().toLowerCase();
    if (status === 'void' || status === 'draft') continue;
    if (!Number.isFinite(row.balance) || row.balance <= 0) continue;
    const due = row.dueDate instanceof Date ? row.dueDate : parseExcelDate(row.dueDate);
    if (!due) continue;
    const daysPastDue = Math.round((cutoff.getTime() - startOfDay(due).getTime()) / DAY_MS);
    result.push({ row, daysPastDue, balance: row.balance, due: startOfDay(due) });
  }
  return result;
}

const bucketOf = (daysPastDue: number): AgingKey => {
  if (daysPastDue <= 0) return 'notDue';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  return 'over90';
};

export function computeReceivablesAging(rows: ReconciledRow[], today: Date): ReceivablesAging {
  let otherCurrencyInvoiceCount = 0;
  const acc = new Map(AGING_KEYS.map((key) => [key, { balance: 0, invoiceCount: 0, clients: new Set<string>(), invoices: [] as AgingInvoice[] }]));
  for (const { row, daysPastDue, balance, due } of openInvoices(rows, today)) {
    if (!isCop(row)) {
      otherCurrencyInvoiceCount += 1;
      continue;
    }
    const bucket = acc.get(bucketOf(daysPastDue))!;
    bucket.balance += balance;
    bucket.invoiceCount += 1;
    const identity = clientIdentity(row.clientName);
    bucket.clients.add(identity.key);
    bucket.invoices.push({ invoiceNumber: row.invoiceNumber, clientName: identity.name, balance, daysPastDue, dueDate: due });
  }
  const buckets = AGING_KEYS.map((key) => {
    const b = acc.get(key)!;
    const invoices = [...b.invoices].sort(
      (x, y) => y.balance - x.balance || x.invoiceNumber.localeCompare(y.invoiceNumber),
    );
    return { key, balance: b.balance, invoiceCount: b.invoiceCount, clientCount: b.clients.size, invoices };
  });
  const overdue = buckets.filter((b) => b.key !== 'notDue');
  return {
    buckets,
    overdueBalance: overdue.reduce((s, b) => s + b.balance, 0),
    overdueInvoiceCount: overdue.reduce((s, b) => s + b.invoiceCount, 0),
    otherCurrencyInvoiceCount,
  };
}

/** Balance already past due today, per client key (see clientIdentity). */
export function overdueBalanceByClient(rows: ReconciledRow[], today: Date): Map<string, number> {
  const result = new Map<string, number>();
  for (const { row, daysPastDue, balance } of openInvoices(rows, today)) {
    if (!isCop(row)) continue;
    if (daysPastDue <= 0) continue;
    const { key } = clientIdentity(row.clientName);
    result.set(key, (result.get(key) ?? 0) + balance);
  }
  return result;
}

/** The clients that owe the most already-overdue COP balance today, largest first. */
export function topOverdueClients(
  rows: ReconciledRow[],
  today: Date,
  limit = 10,
): { name: string; overdueBalance: number }[] {
  // Map keeps insertion order, so the display name is the first spelling seen.
  const byKey = new Map<string, { name: string; overdueBalance: number }>();
  for (const { row, daysPastDue, balance } of openInvoices(rows, today)) {
    if (!isCop(row) || daysPastDue <= 0) continue;
    const { key, name } = clientIdentity(row.clientName);
    const entry = byKey.get(key);
    if (entry) entry.overdueBalance += balance;
    else byKey.set(key, { name, overdueBalance: balance });
  }
  return [...byKey.values()]
    .sort((a, b) => b.overdueBalance - a.overdueBalance || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit);
}
