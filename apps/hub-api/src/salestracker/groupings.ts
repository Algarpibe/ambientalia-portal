import type { Pool } from '@algarpibe/zoho-sync';

export interface Mapping { id: string; group_id: string; category_id: string; }
export interface CategoryGroup { id: string; name: string; color: string | null; sort_order: number; mappings: Mapping[]; }

const HEX = /^#[0-9a-fA-F]{6}$/;
export function validateGroupName(name: unknown): string {
  const t = String(name ?? '').trim();
  if (!t) throw new Error('nombre requerido');
  if (t.length > 100) throw new Error('nombre demasiado largo (máx 100)');
  return t;
}
export function validateGroupColor(color: unknown): string {
  if (color === undefined || color === null || color === '') return '#6366f1';
  const c = String(color);
  if (!HEX.test(c)) throw new Error('color inválido (hex #RRGGBB)');
  return c;
}
function normalizeCatIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out = ids.filter((x): x is string => typeof x === 'string');
  if (out.length > 500) throw new Error('demasiadas categorías (máx 500)');
  return [...new Set(out)];
}

/** Ejecuta fn dentro de una transacción. */
async function tx<T>(db: Pool, fn: (q: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await fn((text, params) => client.query(text, params));
    await client.query('COMMIT');
    return r;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
// Si el Pool no expone connect(), reemplazar `tx(db, ...)` por llamadas secuenciales con `db.query`.

/** Grupos ordenados con sus mappings embebidos. */
export async function getGroupings(db: Pool): Promise<CategoryGroup[]> {
  const { rows: gs } = await db.query('SELECT id, name, color, sort_order FROM portal.st_category_groups ORDER BY sort_order, name');
  const groups = gs as Omit<CategoryGroup, 'mappings'>[];
  if (groups.length === 0) return [];
  const { rows: ms } = await db.query('SELECT id, group_id, category_id FROM portal.st_category_group_mappings WHERE group_id = ANY($1::uuid[])', [groups.map((g) => g.id)]);
  const byGroup = new Map<string, Mapping[]>();
  for (const m of ms as Mapping[]) { const l = byGroup.get(m.group_id) ?? []; l.push(m); byGroup.set(m.group_id, l); }
  return groups.map((g) => ({ ...g, mappings: byGroup.get(g.id) ?? [] }));
}

export async function createGrouping(db: Pool, input: { name: unknown; categoryIds?: unknown; color?: unknown }): Promise<{ id: string }> {
  const name = validateGroupName(input.name);
  const color = validateGroupColor(input.color);
  const catIds = normalizeCatIds(input.categoryIds);
  return tx(db, async (q) => {
    const max = await q('SELECT COALESCE(MAX(sort_order), 0) AS m FROM portal.st_category_groups');
    const next = Number((max.rows[0] as { m: number }).m) + 1;
    const ins = await q('INSERT INTO portal.st_category_groups (name, color, sort_order) VALUES ($1, $2, $3) RETURNING id', [name, color, next]);
    const id = (ins.rows[0] as { id: string }).id;
    for (const catId of catIds) {
      await q('INSERT INTO portal.st_category_group_mappings (group_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, catId]);
    }
    return { id };
  });
}

export async function updateGrouping(db: Pool, id: string, input: { name: unknown; categoryIds?: unknown; color?: unknown }): Promise<void> {
  const name = validateGroupName(input.name);
  const color = validateGroupColor(input.color);
  const catIds = normalizeCatIds(input.categoryIds);
  await tx(db, async (q) => {
    await q('UPDATE portal.st_category_groups SET name = $1, color = $2, updated_at = NOW() WHERE id = $3', [name, color, id]);
    await q('DELETE FROM portal.st_category_group_mappings WHERE group_id = $1', [id]);
    for (const catId of catIds) {
      await q('INSERT INTO portal.st_category_group_mappings (group_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, catId]);
    }
  });
}

export async function deleteGrouping(db: Pool, id: string): Promise<void> {
  await db.query('DELETE FROM portal.st_category_groups WHERE id = $1', [id]); // mappings cascade
}

export async function reorderGroupings(db: Pool, orderedIds: string[]): Promise<void> {
  const ids = orderedIds.filter((x) => typeof x === 'string');
  if (ids.length === 0) return;
  const ord = ids.map((_, i) => i + 1);
  await db.query('UPDATE portal.st_category_groups AS g SET sort_order = v.ord FROM unnest($1::uuid[], $2::int[]) AS v(id, ord) WHERE g.id = v.id', [ids, ord]);
}
