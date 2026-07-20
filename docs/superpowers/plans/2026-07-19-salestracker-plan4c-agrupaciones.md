# salestracker → Portal — Plan 4C: Agrupaciones (config admin) + grouping-analysis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Gestión de **agrupaciones** de categorías (grupos con color + orden, cada uno con N categorías), editable **solo por admins**, más el endpoint **`grouping-analysis`** que agrega las ventas del hub por grupo/año/mes. Desbloquea el **Plan 3D** (analítica por grupos). Se apoya en `portal.st_categories` (Plan 4A).

**Architecture:** Migración `012_salestracker_groupings.sql` (`portal.st_category_groups` + `portal.st_category_group_mappings`, FK CASCADE a groups y a `st_categories`, GLOBAL sin company_id). CRUD transaccional (grupo + mappings) en hub-api, escrituras `requireAdmin`. `grouping-analysis` = join `st_categories` (name.lower→id) + `getSalesRows(db)` (agg del hub) + mappings → agrega por grupo. Frontend: sección **Agrupaciones** en la página Categorías (crear/editar/borrar grupos, asignar categorías, reordenar), admin-gated. Sigue el patrón de [[Plan 4A]]/[[Plan 4B]].

**Auth:** reads = usuario con la app; writes = admin.

**Nota tx:** el CRUD de grupo+mappings usa una transacción (`db.connect()` → BEGIN/COMMIT/ROLLBACK). Verificar que el `Pool` de `@algarpibe/zoho-sync` expone `connect()` (pg estándar sí); si no, hacer las operaciones en secuencia (aceptable para config admin sobre tablas pequeñas) y anotarlo.

**Tech Stack:** hub-api (Express TS, Vitest); sub-app Vite (React 19, @tanstack/react-query v5). Nav ABSOLUTA.

---

## File Structure
**Backend (`apps/hub-api/src/`):**
- `users/migrations/012_salestracker_groupings.sql` (nuevo).
- `db.ts` (modificar) — registrar `'012_salestracker_groupings.sql'`.
- `salestracker/groupings.ts` + `.test.ts` (nuevo) — CRUD tx + reorder + getGroupings + validadores.
- `salestracker/grouping-analysis.ts` + `.test.ts` (nuevo) — `computeGroupingAnalysis` puro + `getGroupingAnalysis(db, tipo)`.
- `salestracker/router.ts` (modificar) — rutas (reads requireApp; writes requireAdmin).

**Frontend (`apps/salestracker/src/`):**
- `api.ts` (modificar) — tipos `CategoryGroup`/`GroupingAnalysis*` + fetchers de grupos.
- `pages/Categorias.tsx` (modificar) — sección "Agrupaciones" (GroupingManager) + fetchers.
- (opcional) `components/GroupingManager.tsx` — extraer el gestor si Categorias crece.

No cambia `st_categories` (4A). Reusa `getSalesRows` (agg del hub, Plan 1) + `requireAdmin`.

---

## Task 1: Backend — migración + módulo groupings (CRUD tx) + endpoints

- [ ] **Step 1: Migración `012_salestracker_groupings.sql`** (idempotente)
```sql
-- Migration 012: agrupaciones de categorías de salestracker (config admin, global).
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.st_category_groups (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  color      TEXT,
  sort_order INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal.st_category_group_mappings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES portal.st_category_groups(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES portal.st_categories(id)      ON DELETE CASCADE,
  UNIQUE (group_id, category_id)
);
CREATE INDEX IF NOT EXISTS st_cgm_group_idx ON portal.st_category_group_mappings (group_id);
CREATE INDEX IF NOT EXISTS st_cgm_category_idx ON portal.st_category_group_mappings (category_id);
```
> Añadí `UNIQUE(group_id, category_id)` (la referencia deduplicaba por delete-all-reinsert; el unique lo hace robusto sin coste).

- [ ] **Step 2: Registrar en `db.ts`** — añadir `'012_salestracker_groupings.sql'` al FINAL de `MIGRATIONS`.

- [ ] **Step 3: Módulo `groupings.ts` (TDD para validadores)** — test primero de `validateGroupName` (1..100, trim, throw) y `validateColor` (hex o default `#6366f1`). Implementar:
```typescript
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
```

- [ ] **Step 4: Endpoints en `router.ts`** (reads requireApp; writes requireAdmin; validación→400/409 vía un `sendGroupError` como el de categorías)
```typescript
import { getGroupings, createGrouping, updateGrouping, deleteGrouping, reorderGroupings } from './groupings.js';

  router.get('/salestracker/category-groups', requireAuth, requireApp(APP_ID), async (_req, res) => {
    try { res.json({ groups: await getGroupings(db) }); } catch (e) { sendError(res, e, 'salestracker_groups_get'); }
  });
  router.post('/salestracker/category-groups', requireAuth, requireAdmin, async (req, res) => {
    try { res.json({ group: await createGrouping(db, req.body as { name: unknown }) }); } catch (e) { sendGroupError(res, e, 'salestracker_groups_post'); }
  });
  router.patch('/salestracker/category-groups/:id', requireAuth, requireAdmin, async (req, res) => {
    try { await updateGrouping(db, req.params.id, req.body as { name: unknown }); res.json({ ok: true }); } catch (e) { sendGroupError(res, e, 'salestracker_groups_patch'); }
  });
  router.delete('/salestracker/category-groups/:id', requireAuth, requireAdmin, async (req, res) => {
    try { await deleteGrouping(db, req.params.id); res.json({ ok: true }); } catch (e) { sendError(res, e, 'salestracker_groups_delete'); }
  });
  router.post('/salestracker/category-groups/reorder', requireAuth, requireAdmin, async (req, res) => {
    try { const ids = (req.body as { orderedIds?: unknown }).orderedIds; await reorderGroupings(db, Array.isArray(ids) ? ids as string[] : []); res.json({ ok: true }); } catch (e) { sendError(res, e, 'salestracker_groups_reorder'); }
  });
```
`sendGroupError` = igual que `sendCategoryError` (validación→400, unique→409, else 500).

- [ ] **Step 5: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/`. **Confirmar que `db.connect()` existe en el `Pool`** (mirar `@algarpibe/zoho-sync` o probar `typeof getHubPool().connect`); si no, cambiar `tx()` por secuencial y anotarlo en el commit.
- [ ] **Step 6: Commit** `feat(hub-api): agrupaciones de categorías (migración + CRUD admin transaccional)`.

---

## Task 2: Backend — grouping-analysis (agregación pura + endpoint)

- [ ] **Step 1: `grouping-analysis.ts` (TDD)** — el cálculo puro es lo testeable.
```typescript
import type { Pool } from '@algarpibe/zoho-sync';
import type { RecordType } from './types.js';
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
  const [{ rows: gs }, { rows: cats }, { rows: ms }, sales] = await Promise.all([
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
```
Test `computeGroupingAnalysis`: 2 grupos, cat→group, registros de 2 años → verifica sums por grupo/año, percentage (amount/yearTotal×100), yearTotals, average.

- [ ] **Step 2: Endpoint** en `router.ts`:
```typescript
import { getGroupingAnalysis } from './grouping-analysis.js';
  router.get('/salestracker/grouping-analysis', requireAuth, requireApp(APP_ID), async (req, res) => {
    try {
      const tipo = req.query.tipo === 'SALES_ORDER' ? 'SALES_ORDER' : 'INVOICE';
      const key = `salestracker:grouping-analysis:${tipo}`;
      res.json(await cached(key, () => getGroupingAnalysis(db, tipo as RecordType)));
    } catch (e) { sendError(res, e, 'salestracker_grouping_analysis'); }
  });
```
(usa `RecordType` de `./types.js`.)

- [ ] **Step 3: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/`.
- [ ] **Step 4: Commit** `feat(hub-api): endpoint grouping-analysis (agrega ventas del hub por grupo)`.

---

## Task 3: Frontend — sección Agrupaciones en Categorías (admin)

- [ ] **Step 1: `api.ts` — tipos + fetchers de grupos**
```typescript
export interface GroupMapping { id: string; group_id: string; category_id: string; }
export interface CategoryGroup { id: string; name: string; color: string | null; sort_order: number; mappings: GroupMapping[]; }

export async function fetchCategoryGroups(): Promise<CategoryGroup[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/category-groups`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { groups?: CategoryGroup[] }).groups ?? [];
}
export const createCategoryGroup = (input: { name: string; categoryIds: string[]; color?: string }) => writeJson('/api/salestracker/category-groups', 'POST', input);
export const updateCategoryGroup = (id: string, input: { name: string; categoryIds: string[]; color?: string }) => writeJson(`/api/salestracker/category-groups/${encodeURIComponent(id)}`, 'PATCH', input);
export const deleteCategoryGroup = (id: string) => writeJson(`/api/salestracker/category-groups/${encodeURIComponent(id)}`, 'DELETE');
export const reorderCategoryGroups = (orderedIds: string[]) => writeJson('/api/salestracker/category-groups/reorder', 'POST', { orderedIds });
```
(reusa el helper `writeJson` de 4A.)

- [ ] **Step 2: Sección "Agrupaciones" en `Categorias.tsx`** (o extraer a `components/GroupingManager.tsx`)

Debajo de la tabla de categorías, una sección **Agrupaciones** (solo con botones de edición si `admin`; la lista visible a todos):
- `const groupsQ = useQuery({ queryKey: ['st-groups'], queryFn: fetchCategoryGroups });` invalidar `['st-groups']` tras mutaciones.
- **Lista de grupos**: por cada grupo, un swatch de color, el nombre, el nº de categorías (`g.mappings.length`), y si `admin`: flechas ↑/↓ (reordenar → `reorderCategoryGroups` con el nuevo orden de ids), Editar, Borrar (confirm).
- **Form crear/editar** (si `admin`): nombre (text), color (`<input type="color">`), y **multi-select de categorías** (checkboxes sobre `q.data` de categorías — ya cargadas en la página; `categoryIds` = ids marcados). Guardar → `createCategoryGroup`/`updateCategoryGroup({name, categoryIds, color})` → invalidar `['st-groups']`. Al editar, precargar los `categoryIds` desde `g.mappings.map(m => m.category_id)`.
- Errores de mutación visibles (banner). Estilo plano, sin shadcn.

- [ ] **Step 3: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 4: Commit** `feat(salestracker): gestor de agrupaciones en Categorías (admin)`.

---

## Task 4: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (hub-api tsc+tests, salestracker tsc+tests, portal build). Reportar salida real.
- [ ] **Step 2: Prueba local (si hay BD)** con token admin: importar categorías (4A) → crear un grupo con varias categorías → `GET /grouping-analysis?tipo=INVOICE` devuelve filas por grupo con años/%.
- [ ] **Step 3: Handoff:** merge/push + redeploy **hub-api** (migración 012 + endpoints) **y portal**. Verificar en `/salestracker/categorias` → sección Agrupaciones: como admin, crear/editar/borrar/reordenar grupos asignando categorías.

---

## Self-Review (cobertura)
- Migración `st_category_groups` + `st_category_group_mappings` (FK CASCADE, unique, registrada): T1. ✅
- CRUD transaccional (grupo+mappings) + reorder + getGroupings, writes admin: T1. ✅
- `grouping-analysis` (computeGroupingAnalysis puro testeado + getGroupingAnalysis join al hub) + endpoint cached: T2. ✅
- Gestor de agrupaciones (crear/editar/borrar/reordenar, multi-select categorías) admin-gated: T3. ✅
- Auth: writes requireAdmin (back), UI gateada por rol. ✅
- **Desbloquea Plan 3D** (consumirá `/grouping-analysis`). Anotado.

Sin placeholders. Escrituras admin en el back. Join por nombre lowercased (categoría↔hub). tx con fallback anotado. **Gotcha:** migración 012 → redeploy hub-api.

## Próximos: Plan 3D (grouping analytics: consume /grouping-analysis) · polish Tablas (remap st_categories) · Plan 5 (cutover).
