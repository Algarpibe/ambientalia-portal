# salestracker → Portal — Plan 4A: Categorías (config admin)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Gestión de **categorías** de salestracker (nombre, descripción, color, orden, activo), editable **solo por admins**, con importación de las categorías reales desde el hub. Es la tabla puente que luego usan el remap de Tablas y las **agrupaciones** (Plan 4C → 3D).

**Architecture:** Migración `010_salestracker_categories.sql` crea `portal.st_categories` (GLOBAL, sin company_id — una sola empresa). Endpoints en el router de salestracker: lectura `requireAuth`+`requireApp('salestracker')`; escrituras `requireAdmin` (mapea "editor"→admin, decidido). Import: inserta `DISTINCT books.items.category_name` que falten (misma BD, `getHubPool()`). Frontend: página **Categorías** (tabla + crear/editar/borrar + importar), con botones de escritura visibles solo a admins (rol del JWT). Tailwind plano. Sigue el patrón de escritura de [[Plan 4B]].

**Auth:** reads = cualquier usuario con la app; writes = admin. El front oculta acciones a no-admins (UX); el back las gatea de verdad (`requireAdmin`).

**Tech Stack:** hub-api (Express TS, Vitest); sub-app Vite (React 19, @tanstack/react-query v5). Nav ABSOLUTA.

**Decisión:** borrado **soft** (`is_active=false`), como la referencia (no romper mappings/historial). `sort_order` para ordenar. `name` único.

---

## File Structure
**Backend (`apps/hub-api/src/`):**
- `users/migrations/010_salestracker_categories.sql` (nuevo).
- `db.ts` (modificar) — registrar `'010_salestracker_categories.sql'`.
- `salestracker/categories.ts` + `.test.ts` (nuevo) — CRUD + import + validadores puros.
- `salestracker/router.ts` (modificar) — 5 rutas (1 read, 4 write admin).

**Frontend (`apps/salestracker/src/`):**
- `api.ts` (modificar) — `Category` + fetchers + `esAdmin()`.
- `pages/Categorias.tsx` (nuevo) — tabla + formularios.
- `components/Nav.tsx` (modificar) — enlace "Categorías" (visible a todos; la edición se gatea dentro).
- `App.tsx` (modificar) — ruta `categorias`.

---

## Task 1: Backend — migración + módulo categorías + endpoints

- [ ] **Step 1: Migración `010_salestracker_categories.sql`** (idempotente, estilo 009)
```sql
-- Migration 010: categorías de salestracker (config, global — una sola empresa).
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.st_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  description TEXT,
  color       TEXT        NOT NULL DEFAULT '#3b82f6',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Registrar en `db.ts`** — añadir `'010_salestracker_categories.sql'` al FINAL de `MIGRATIONS`.

- [ ] **Step 3: Módulo `categories.ts` (TDD para validadores puros)** — test primero:
```typescript
// apps/hub-api/src/salestracker/categories.test.ts
import { describe, it, expect } from 'vitest';
import { validateCategoryName, validateColor } from './categories.js';
describe('validateCategoryName', () => {
  it('recorta y exige 1..100', () => { expect(validateCategoryName('  Equipos ')).toBe('Equipos'); });
  it('vacío → throw', () => { expect(() => validateCategoryName('   ')).toThrow(); });
  it('>100 → throw', () => { expect(() => validateCategoryName('x'.repeat(101))).toThrow(); });
});
describe('validateColor', () => {
  it('hex válido pasa', () => { expect(validateColor('#3B82f6')).toBe('#3B82f6'); });
  it('no hex → throw', () => { expect(() => validateColor('rojo')).toThrow(); });
  it('undefined → default', () => { expect(validateColor(undefined)).toBe('#3b82f6'); });
});
```
Implementar `categories.ts`:
```typescript
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
```
Correr el test → PASA.

- [ ] **Step 4: Endpoints en `router.ts`** — importar `requireAdmin` de `../auth.js` y los helpers. Rutas:
```typescript
import { requireAuth, requireApp, requireAdmin, getPayload } from '../auth.js';
import { getCategories, createCategory, updateCategory, deleteCategory, importFromHub } from './categories.js';

  router.get('/salestracker/categories', requireAuth, requireApp(APP_ID), async (_req: Request, res: Response) => {
    try { res.json({ categories: await getCategories(db) }); }
    catch (e) { sendError(res, e, 'salestracker_categories_get'); }
  });
  router.post('/salestracker/categories', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { res.json({ category: await createCategory(db, req.body as { name: unknown }) }); }
    catch (e) { sendCategoryError(res, e, 'salestracker_categories_post'); }
  });
  router.patch('/salestracker/categories/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { await updateCategory(db, req.params.id, req.body as Record<string, unknown>); res.json({ ok: true }); }
    catch (e) { sendCategoryError(res, e, 'salestracker_categories_patch'); }
  });
  router.delete('/salestracker/categories/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try { await deleteCategory(db, req.params.id); res.json({ ok: true }); }
    catch (e) { sendError(res, e, 'salestracker_categories_delete'); }
  });
  router.post('/salestracker/categories/import', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    try { res.json({ added: await importFromHub(db) }); }
    catch (e) { sendError(res, e, 'salestracker_categories_import'); }
  });
```
`requireAdmin` ya corre `requireAuth` dentro (ver auth.ts); el `requireAuth` extra antes es inocuo pero se puede omitir — si molesta al type/orden, deja solo `requireAdmin`. **Manejo de errores de validación → 400** (nombre/color/único): añade un helper local que mapea errores conocidos a 400 y el resto a 500:
```typescript
function sendCategoryError(res: Response, e: unknown, ctx: string): void {
  const msg = e instanceof Error ? e.message : '';
  if (/requerido|demasiado largo|inválido/.test(msg)) return void res.status(400).json({ error: msg });
  if (/(duplicate key|unique)/i.test(msg)) return void res.status(409).json({ error: 'ya existe una categoría con ese nombre' });
  sendError(res, e, ctx);
}
```

- [ ] **Step 5: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/`.
- [ ] **Step 6: Commit** `feat(hub-api): categorías de salestracker (migración + CRUD admin + import del hub)`.

---

## Task 2: Frontend — Categorías (página admin) + nav/ruta

- [ ] **Step 1: `api.ts` — tipo + `esAdmin()` + fetchers**
```typescript
export interface Category { id: string; name: string; description: string | null; color: string; sort_order: number; is_active: boolean; }

/** True si el JWT tiene rol admin (solo para gating de UX; el backend re-verifica). */
export function esAdmin(): boolean {
  const t = localStorage.getItem('ambientalia_token');
  if (!t) return false;
  try { return (JSON.parse(atob(t.split('.')[1] || '')) as { role?: string }).role === 'admin'; }
  catch { return false; }
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/categories`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { categories?: Category[] }).categories ?? [];
}
async function writeJson(path: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}
export const createCategory = (input: { name: string; description?: string; color?: string }) => writeJson('/api/salestracker/categories', 'POST', input);
export const updateCategory = (id: string, patch: Record<string, unknown>) => writeJson(`/api/salestracker/categories/${encodeURIComponent(id)}`, 'PATCH', patch);
export const deleteCategory = (id: string) => writeJson(`/api/salestracker/categories/${encodeURIComponent(id)}`, 'DELETE');
export async function importCategories(): Promise<number> {
  const res = await fetch(`${API_BASE}/api/salestracker/categories/import`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { added: number }).added;
}
```
> `mensajeDeError` ya mapea 403 a "No tienes esta aplicación asignada…". Añade (opcional) un caso 409 → "Ya existe una categoría con ese nombre." si quieres un mensaje más claro.

- [ ] **Step 2: `Categorias.tsx`** (Tailwind plano)
- `const admin = esAdmin();` `const q = useQuery({ queryKey: ['st-categories'], queryFn: fetchCategories });` `const qc = useQueryClient();` invalidar `['st-categories']` tras cada mutación.
- Cabecera: `<h1>Categorías</h1>` + subtítulo. Si `admin`: botones **"Importar del hub"** (`importCategories` → toast "N añadidas" → invalidar) y **"Nueva categoría"** (abre form).
- Tabla: columnas **Color** (swatch `<span style={{background:color}}>`), **Nombre**, **Descripción**, y si `admin` una columna de **acciones** (Editar / Borrar).
- Form crear/editar (inline o modal simple): inputs `name` (text), `description` (text), `color` (`<input type="color">`). Guardar → `createCategory`/`updateCategory` → invalidar. Borrar → confirm → `deleteCategory` → invalidar.
- Estados: carga "Cargando…"; error `(q.error as Error).message`. Si no hay categorías: vacío con hint (si admin, sugerir "Importar del hub").
- Usa `useMutation` para create/update/delete/import con `onError` que muestre el mensaje (`(e as Error).message`). Estilo plano como el resto (`p-8 space-y-6`, tabla `w-full text-sm`, `bg-gray-50`). Sin shadcn.

- [ ] **Step 3: `Nav.tsx` + `App.tsx`**
- Nav: `<NavLink to={`${APP_BASE}/categorias`} className={link}>Categorías</NavLink>` (visible a todos; la edición se gatea dentro).
- App: `import Categorias from './pages/Categorias';` + `<Route path="categorias" element={<Categorias />} />` dentro del Layout.

- [ ] **Step 4: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 5: Commit** `feat(salestracker): página Categorías (gestión admin + importar del hub)`.

---

## Task 3: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (hub-api tsc+tests, salestracker tsc+tests, portal build). Reportar salida real.
- [ ] **Step 2: Prueba local (si hay BD)** con token **admin**:
```bash
curl.exe -s -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:3001/api/salestracker/categories/import
curl.exe -s -H "Authorization: Bearer <TOKEN>" http://localhost:3001/api/salestracker/categories | head -c 300
```
Con un token NO admin, el POST debe dar 403.
- [ ] **Step 3: Handoff:** merge/push + redeploy **hub-api** (migración 010 + endpoints) **y portal**. Verificar en `/salestracker/categorias`: como admin, importar del hub, crear/editar/borrar; como no-admin, solo ver la lista (sin botones de edición) y que un intento de escritura devuelve 403.

---

## Self-Review (cobertura)
- Migración `portal.st_categories` (global, idempotente, registrada): T1. ✅
- Módulo categorías (getCategories + create/update/delete soft + importFromHub + validadores testeados): T1. ✅
- Endpoints (read requireApp; write requireAdmin; validación→400/409): T1. ✅
- Frontend Categorías (tabla + CRUD + import, gating de UX por rol) + nav/ruta: T2. ✅
- Auth: escritura solo admin (back), UI oculta a no-admin. ✅
- Diferido: agrupaciones + grouping-analysis (Plan 4C); remap de Tablas usando estas categorías (polish posterior). Anotado.

Sin placeholders. Escrituras admin-gated en el back (requireAdmin), no solo UX. `name` único (409 en duplicado). **Gotcha:** migración 010 → redeploy hub-api obligatorio.

## Próximos: Plan 4C (agrupaciones + grouping-analysis; desbloquea 3D) · 3D (grouping analytics) · polish Tablas (remap por st_categories) · Plan 5 (cutover).
