import type { Pool } from '@algarpibe/zoho-sync';

export interface Category { id: string; name: string; description: string | null; color: string; sort_order: number; is_active: boolean; }

const HEX = /^#[0-9a-fA-F]{6}$/;
export function validateCategoryName(name: unknown): string {
  const t = String(name ?? '').trim();
  if (!t) throw new Error('nombre requerido');
  if (t.length > 100) throw new Error('nombre demasiado largo (máx 100)');
  return t;
}
export function validateColor(color: unknown): string {
  if (color === undefined || color === null || color === '') return '#3b82f6';
  const c = String(color);
  if (!HEX.test(c)) throw new Error('color inválido (hex #RRGGBB)');
  return c;
}

/** Categorías activas, ordenadas por sort_order, name. */
export async function getCategories(db: Pool): Promise<Category[]> {
  const { rows } = await db.query(
    'SELECT id, name, description, color, sort_order, is_active FROM portal.st_categories WHERE is_active = TRUE ORDER BY sort_order, name',
  );
  return rows as Category[];
}
export async function createCategory(db: Pool, input: { name: unknown; description?: unknown; color?: unknown }): Promise<Category> {
  const name = validateCategoryName(input.name);
  const color = validateColor(input.color);
  const description = input.description == null ? null : String(input.description);
  const { rows } = await db.query(
    `INSERT INTO portal.st_categories (name, description, color) VALUES ($1, $2, $3)
     RETURNING id, name, description, color, sort_order, is_active`,
    [name, description, color],
  );
  return rows[0] as Category;
}
export async function updateCategory(db: Pool, id: string, patch: { name?: unknown; description?: unknown; color?: unknown; is_active?: unknown }): Promise<void> {
  const sets: string[] = []; const vals: unknown[] = []; let i = 1;
  if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(validateCategoryName(patch.name)); }
  if (patch.description !== undefined) { sets.push(`description = $${i++}`); vals.push(patch.description == null ? null : String(patch.description)); }
  if (patch.color !== undefined) { sets.push(`color = $${i++}`); vals.push(validateColor(patch.color)); }
  if (patch.is_active !== undefined) { sets.push(`is_active = $${i++}`); vals.push(Boolean(patch.is_active)); }
  if (sets.length === 0) return;
  sets.push('updated_at = NOW()');
  vals.push(id);
  await db.query(`UPDATE portal.st_categories SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}
/** Borrado soft. */
export async function deleteCategory(db: Pool, id: string): Promise<void> {
  await db.query('UPDATE portal.st_categories SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
}
/** Inserta las categorías del hub (books.items.category_name) que falten. Devuelve cuántas se añadieron. */
export async function importFromHub(db: Pool): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO portal.st_categories (name)
     SELECT DISTINCT category_name FROM books.items
      WHERE category_name IS NOT NULL AND category_name <> ''
     ON CONFLICT (name) DO NOTHING`,
  );
  return rowCount ?? 0;
}
