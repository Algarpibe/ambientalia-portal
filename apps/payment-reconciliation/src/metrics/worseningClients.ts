import type { ReconciledRow } from '../types';
import { collectDueInvoices } from './yearlyTrendMetrics';
import { overdueBalanceByClient } from './agingMetrics';
import { clientIdentity } from './clientIdentity';

// Clients whose average DPD rose from the previous full year to the current
// year to date: the "who to call" list. Built on the shared KPI universe.

export interface WorseningClient {
  name: string;
  previousDPD: number;
  currentDPD: number;
  change: number;
  /** Balance already past due today (all years). */
  overdueBalance: number;
}

export interface WorseningClientsResult {
  previousYear: number;
  currentYear: number;
  clients: WorseningClient[];
}

/** Fewest due invoices per year for a client to be compared (one bad invoice is noise). */
export const MIN_INVOICES_PER_YEAR = 2;

interface YearStats {
  count: number;
  dpdSum: number;
}

export function computeWorseningClients(rows: ReconciledRow[], today: Date, limit = 10): WorseningClientsResult {
  const currentYear = today.getFullYear();
  const previousYear = currentYear - 1;
  const clients = new Map<string, { name: string; previous: YearStats; current: YearStats }>();

  for (const { row, year, dpd } of collectDueInvoices(rows, today)) {
    if (year !== currentYear && year !== previousYear) continue;
    const { key, name } = clientIdentity(row.clientName);
    const entry = clients.get(key) ?? { name, previous: { count: 0, dpdSum: 0 }, current: { count: 0, dpdSum: 0 } };
    const stats = year === currentYear ? entry.current : entry.previous;
    stats.count += 1;
    stats.dpdSum += dpd;
    clients.set(key, entry);
  }

  const overdue = overdueBalanceByClient(rows, today);
  const worsening: WorseningClient[] = [];
  for (const [key, { name, previous, current }] of clients) {
    if (previous.count < MIN_INVOICES_PER_YEAR || current.count < MIN_INVOICES_PER_YEAR) continue;
    const previousDPD = previous.dpdSum / previous.count;
    const currentDPD = current.dpdSum / current.count;
    const change = currentDPD - previousDPD;
    if (change <= 0) continue;
    worsening.push({ name, previousDPD, currentDPD, change, overdueBalance: overdue.get(key) ?? 0 });
  }

  worsening.sort((a, b) => b.change - a.change || a.name.localeCompare(b.name, 'es'));
  return { previousYear, currentYear, clients: worsening.slice(0, limit) };
}
