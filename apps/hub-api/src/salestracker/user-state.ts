import type { Pool } from '@algarpibe/zoho-sync';

export const MAX_VIEW_NAME_LEN = 120;
export const MAX_VIEW_STATE_BYTES = 32_000;

/** Recorta y valida el nombre de vista. '' → null. Demasiado largo → throw. */
export function validateViewName(name: string): string | null {
  const t = String(name ?? '').trim();
  if (!t) return null;
  if (t.length > MAX_VIEW_NAME_LEN) throw new Error(`nombre demasiado largo (máx ${MAX_VIEW_NAME_LEN})`);
  return t;
}
/** True si el state serializado supera el límite. */
export function stateTooLarge(state: unknown): boolean {
  return JSON.stringify(state ?? null).length > MAX_VIEW_STATE_BYTES;
}

// --- Favoritos ---
export async function getFavorites(db: Pool, userId: string): Promise<string[]> {
  const { rows } = await db.query('SELECT customer_name FROM portal.st_favorites WHERE user_id = $1 ORDER BY customer_name', [userId]);
  return (rows as { customer_name: string }[]).map((r) => r.customer_name);
}
/** Toggle: si existía lo borra (→ false), si no lo inserta (→ true). Devuelve el nuevo estado. */
export async function toggleFavorite(db: Pool, userId: string, customer: string): Promise<boolean> {
  const del = await db.query('DELETE FROM portal.st_favorites WHERE user_id = $1 AND customer_name = $2', [userId, customer]);
  if ((del.rowCount ?? 0) > 0) return false;
  await db.query('INSERT INTO portal.st_favorites (user_id, customer_name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, customer]);
  return true;
}

// --- Vistas guardadas ---
export interface SavedView { id: string; name: string; state: unknown }
export async function getSavedViews(db: Pool, userId: string, viewKey: string): Promise<SavedView[]> {
  const { rows } = await db.query('SELECT id, name, state FROM portal.st_saved_views WHERE user_id = $1 AND view_key = $2 ORDER BY name', [userId, viewKey]);
  return rows as SavedView[];
}
/** Upsert (user_id, view_key, name). Valida nombre y tamaño. Devuelve false si el nombre queda vacío. */
export async function saveView(db: Pool, userId: string, viewKey: string, name: string, state: unknown): Promise<boolean> {
  const t = validateViewName(name);
  if (!t) return false;
  if (stateTooLarge(state)) throw new Error('vista demasiado grande (máx 32 KB)');
  await db.query(
    `INSERT INTO portal.st_saved_views (user_id, view_key, name, state)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, view_key, name) DO UPDATE SET state = EXCLUDED.state`,
    [userId, viewKey, t, JSON.stringify(state ?? null)],
  );
  return true;
}
export async function deleteSavedView(db: Pool, userId: string, id: string): Promise<void> {
  await db.query('DELETE FROM portal.st_saved_views WHERE id = $1 AND user_id = $2', [id, userId]);
}
