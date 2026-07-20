import type { Pool } from '@algarpibe/zoho-sync';
import type { RecordType, SalesRow } from './types.js';
import { getSalesRows } from './sales.js';

export interface GroupYear { amount: number; percentage: number }
export interface GroupingRow {
  groupId: string; groupName: string; color: string;
  years: Record<number, GroupYear>;
  months: Record<number, Record<number, number>>;
  average: { amount: number; percentage: number };
}
export interface GroupingAnalysis { rows: GroupingRow[]; years: number[]; yearTotals: Record<number, number>; }

export interface GroupLite { id: string; name: string; color: string | null }
export interface AnalysisRecord { categoryId: string; year: number; month: number; amount: number }

/** Agregación pura (grupos + cat→group + registros ya mapeados a categoryId). */
export function computeGroupingAnalysis(groups: GroupLite[], catToGroup: Map<string, string>, records: AnalysisRecord[]): GroupingAnalysis {
  const yearsSet = new Set<number>();
  const groupYear: Record<string, Record<number, number>> = {};
  const groupMonth: Record<string, Record<number, Record<number, number>>> = {};
  const yearTotals: Record<number, number> = {};
  for (const g of groups) { groupYear[g.id] = {}; groupMonth[g.id] = {}; }

  for (const r of records) {
    const amount = Number.isFinite(r.amount) ? r.amount : 0;
    yearsSet.add(r.year);
    yearTotals[r.year] = (yearTotals[r.year] ?? 0) + amount;
    const gid = catToGroup.get(r.categoryId);
    if (gid && groupYear[gid]) {
      groupYear[gid][r.year] = (groupYear[gid][r.year] ?? 0) + amount;
      if (!groupMonth[gid][r.year]) groupMonth[gid][r.year] = {};
      groupMonth[gid][r.year][r.month] = (groupMonth[gid][r.year][r.month] ?? 0) + amount;
    }
  }
  const years = [...yearsSet].sort((a, b) => a - b);
  const totalAllYears = years.reduce((s, y) => s + (yearTotals[y] ?? 0), 0);
  const rows: GroupingRow[] = groups.map((g) => {
    const sums = groupYear[g.id] ?? {};
    const yd: Record<number, GroupYear> = {};
    let total = 0;
    for (const y of years) {
      const amount = sums[y] ?? 0;
      const grand = yearTotals[y] || 1;
      yd[y] = { amount, percentage: grand > 0 ? (amount / grand) * 100 : 0 };
      total += amount;
    }
    const avgAmount = years.length > 0 ? total / years.length : 0;
    const avgPct = totalAllYears > 0 ? (total / totalAllYears) * 100 : 0;
    return { groupId: g.id, groupName: g.name, color: g.color || '#6366f1', years: yd, months: groupMonth[g.id] ?? {}, average: { amount: avgAmount, percentage: avgPct } };
  });
  return { rows, years, yearTotals };
}

/** Carga grupos + categorías + mappings + ventas del hub y agrega. */
export async function getGroupingAnalysis(db: Pool, tipo: RecordType): Promise<GroupingAnalysis> {
  const [{ rows: gs }, { rows: cats }, { rows: ms }, sales]: [
    { rows: unknown[] }, { rows: unknown[] }, { rows: unknown[] }, SalesRow[],
  ] = await Promise.all([
    db.query('SELECT id, name, color FROM portal.st_category_groups ORDER BY sort_order, name'),
    db.query('SELECT id, name FROM portal.st_categories WHERE is_active = TRUE'),
    db.query('SELECT group_id, category_id FROM portal.st_category_group_mappings'),
    getSalesRows(db),
  ]);
  const groups = gs as GroupLite[];
  if (groups.length === 0) return { rows: [], years: [], yearTotals: {} };
  const byName = new Map((cats as { id: string; name: string }[]).map((c) => [c.name.toLowerCase(), c.id]));
  const catToGroup = new Map<string, string>();
  for (const m of ms as { group_id: string; category_id: string }[]) catToGroup.set(String(m.category_id), m.group_id);
  const records: AnalysisRecord[] = sales
    .filter((r) => r.recordType === tipo)
    .map((r) => ({ categoryId: byName.get(r.categoryName.toLowerCase()) ?? '', year: r.year, month: r.month, amount: r.amountUsd }))
    .filter((r) => r.categoryId !== '');
  return computeGroupingAnalysis(groups, catToGroup, records);
}
