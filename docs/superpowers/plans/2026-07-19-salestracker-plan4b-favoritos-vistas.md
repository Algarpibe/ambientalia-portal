# salestracker → Portal — Plan 4B: Favoritos + Vistas guardadas (estado per-user)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Primer estado **escribible** de salestracker: **favoritos** de cliente (estrella) y **vistas guardadas** de la página Clientes (guardar/aplicar/borrar filtros con nombre), ambos **por usuario**. Migración en la Postgres de hub-api + endpoints CRUD owner-gated + UI en Clientes.

**Architecture:** Nueva migración `009_salestracker_user_state.sql` crea `portal.st_favorites` y `portal.st_saved_views` (esquema `portal`, BD escribible de `HUB_DB_URL` — la MISMA que usa contabilidad para `portal.contabilidad_*`; se escribe con `getHubPool()`, no hace falta pool nuevo). 5 endpoints en el router de salestracker existente, **owner-scoped por `req.user.user_id`** (nunca confiar en un user_id del body). Frontend: fetchers + `FavoriteStar` + `SavedViewsMenu` + `clientes-view-state` (parseo) cableados en `Clientes.tsx`. Tailwind plano.

**Auth:** todos `requireAuth` + `requireApp('salestracker')`; el dueño se toma del JWT. Tokens legacy sin `user_id` → reads `[]`, writes 400.

**Tech Stack:** hub-api (Express TS, Vitest); sub-app Vite (React 19, @tanstack/react-query v5). Nav ABSOLUTA.

---

## File Structure
**Backend (`apps/hub-api/src/`):**
- `users/migrations/009_salestracker_user_state.sql` (nuevo).
- `db.ts` (modificar) — añadir `'009_salestracker_user_state.sql'` a `MIGRATIONS`.
- `salestracker/user-state.ts` + `.test.ts` (nuevo) — helpers CRUD + validación pura.
- `salestracker/router.ts` (modificar) — 5 rutas.

**Frontend (`apps/salestracker/src/`):**
- `lib/clientes-view-state.ts` + `.test.ts` (portar/adaptar).
- `api.ts` (modificar) — 5 fetchers + tipos.
- `components/FavoriteStar.tsx` + `components/SavedViewsMenu.tsx` (nuevo).
- `pages/Clientes.tsx` (modificar) — estrellas por fila + filtro "solo favoritos" + menú de vistas.

---

## Task 1: Backend — migración + módulo user-state + endpoints

- [ ] **Step 1: Migración `009_salestracker_user_state.sql`** (estilo idempotente como `007_contabilidad_overrides.sql`)
```sql
-- Migration 009: estado per-usuario de salestracker (favoritos + vistas guardadas).
-- Esquema `portal` (BD escribible de HUB_DB_URL). Idempotente.
CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.st_favorites (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL,
  customer_name TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, customer_name)
);
CREATE INDEX IF NOT EXISTS st_favorites_user_idx ON portal.st_favorites (user_id);

CREATE TABLE IF NOT EXISTS portal.st_saved_views (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL,
  view_key   TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  state      JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, view_key, name)
);
CREATE INDEX IF NOT EXISTS st_saved_views_user_key_idx ON portal.st_saved_views (user_id, view_key);
```

- [ ] **Step 2: Registrar en `db.ts`** — añadir `'009_salestracker_user_state.sql'` al FINAL del array `MIGRATIONS`.

- [ ] **Step 3: Módulo `user-state.ts` (TDD para validación pura)** — test primero de los validadores:
```typescript
// apps/hub-api/src/salestracker/user-state.test.ts
import { describe, it, expect } from 'vitest';
import { validateViewName, stateTooLarge, MAX_VIEW_NAME_LEN } from './user-state.js';

describe('validateViewName', () => {
  it('recorta y exige no vacío', () => { expect(validateViewName('  hola ')).toBe('hola'); });
  it('vacío → null', () => { expect(validateViewName('   ')).toBeNull(); });
  it(`> ${MAX_VIEW_NAME_LEN} → throw`, () => { expect(() => validateViewName('x'.repeat(MAX_VIEW_NAME_LEN + 1))).toThrow(); });
});
describe('stateTooLarge', () => {
  it('objeto pequeño → false', () => { expect(stateTooLarge({ a: 1 })).toBe(false); });
  it('> 32KB → true', () => { expect(stateTooLarge({ big: 'y'.repeat(40_000) })).toBe(true); });
});
```
Implementar `user-state.ts`:
```typescript
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
```
Correr el test → PASA.

- [ ] **Step 4: Endpoints en `router.ts`** — importar los helpers + `getPayload`. Helper local para el dueño:
```typescript
import { getPayload } from '../auth.js';
import { getFavorites, toggleFavorite, getSavedViews, saveView, deleteSavedView } from './user-state.js';

// dueño del JWT; null si token legacy sin user_id
const ownerId = (req: Request): string | null => {
  const uid = getPayload(req)?.user_id;
  return uid ? String(uid) : null;
};

// dentro de createSalestrackerRouter, antes de `return router;`:
  router.get('/salestracker/favorites', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      res.json({ favorites: uid ? await getFavorites(db, uid) : [] });
    } catch (e) { sendError(res, e, 'salestracker_favorites_get'); }
  });
  router.post('/salestracker/favorites/toggle', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      if (!uid) return void res.status(400).json({ error: 'usuario sin identidad persistente' });
      const customer = (req.body as { customer?: unknown }).customer;
      if (typeof customer !== 'string' || !customer.trim()) return void res.status(400).json({ error: 'customer requerido' });
      const favorited = await toggleFavorite(db, uid, customer);
      res.json({ favorited });
    } catch (e) { sendError(res, e, 'salestracker_favorites_toggle'); }
  });
  router.get('/salestracker/saved-views', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      const viewKey = String(req.query.viewKey ?? '');
      if (!viewKey) return void res.status(400).json({ error: 'viewKey requerido' });
      res.json({ views: uid ? await getSavedViews(db, uid, viewKey) : [] });
    } catch (e) { sendError(res, e, 'salestracker_saved_views_get'); }
  });
  router.put('/salestracker/saved-views', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      if (!uid) return void res.status(400).json({ error: 'usuario sin identidad persistente' });
      const b = req.body as { viewKey?: unknown; name?: unknown; state?: unknown };
      if (typeof b.viewKey !== 'string' || !b.viewKey || typeof b.name !== 'string') return void res.status(400).json({ error: 'viewKey/name requeridos' });
      const ok = await saveView(db, uid, b.viewKey, b.name, b.state);
      if (!ok) return void res.status(400).json({ error: 'nombre vacío' });
      res.json({ ok: true });
    } catch (e) { sendError(res, e, 'salestracker_saved_views_put'); }
  });
  router.delete('/salestracker/saved-views/:id', requireAuth, requireApp(APP_ID), async (req: Request, res: Response) => {
    try {
      const uid = ownerId(req);
      if (!uid) return void res.status(400).json({ error: 'usuario sin identidad persistente' });
      await deleteSavedView(db, uid, req.params.id);
      res.json({ ok: true });
    } catch (e) { sendError(res, e, 'salestracker_saved_views_delete'); }
  });
```
> Nota: la validación de `saveView` (`> 32KB` → throw) devuelve 500 vía `sendError`; aceptable (payload abusivo). Si se prefiere 400, capturar y mapear — opcional.

- [ ] **Step 5: Verificar** `cd apps/hub-api && npx tsc --noEmit && npx vitest run src/salestracker/` (los validadores puros pasan; el resto compila).
- [ ] **Step 6: Commit** `feat(hub-api): favoritos + vistas guardadas de salestracker (migración + endpoints owner-gated)`.

---

## Task 2: Frontend — fetchers + componentes + cableado en Clientes

- [ ] **Step 1: `api.ts` — tipos + 5 fetchers**
```typescript
export interface SavedView { id: string; name: string; state: unknown; }

export async function fetchFavorites(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/favorites`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { favorites?: string[] }).favorites ?? [];
}
export async function toggleFavorite(customer: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/salestracker/favorites/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ customer }) });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { favorited: boolean }).favorited;
}
export async function fetchSavedViews(viewKey: string): Promise<SavedView[]> {
  const res = await fetch(`${API_BASE}/api/salestracker/saved-views?viewKey=${encodeURIComponent(viewKey)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return ((await res.json()) as { views?: SavedView[] }).views ?? [];
}
export async function saveView(viewKey: string, name: string, state: unknown): Promise<void> {
  const res = await fetch(`${API_BASE}/api/salestracker/saved-views`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ viewKey, name, state }) });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}
export async function deleteSavedView(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/salestracker/saved-views/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}
```

- [ ] **Step 2: `lib/clientes-view-state.ts` + test** — tipo + parseo (adaptado a los campos de NUESTRA página Clientes)
```typescript
import type { CustomerSortKey, CustomerSortDir } from './customer-sales';

export interface ClientesViewState {
  tipo: 'SALES_ORDER' | 'INVOICE';
  desdeAnio: number; hastaAnio: number;
  search: string;
  sortKey: CustomerSortKey; sortDir: CustomerSortDir;
  comparar: boolean; anioA: number; anioB: number;
  onlyFav: boolean;
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valida un state crudo (de una vista guardada). Devuelve null si no encaja. */
export function parseClientesState(raw: unknown): ClientesViewState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const okTipo = s.tipo === 'SALES_ORDER' || s.tipo === 'INVOICE';
  const okSortKey = s.sortKey === 'customer' || s.sortKey === 'total' || s.sortKey === 'delta' || isNum(s.sortKey);
  const okDir = s.sortDir === 'asc' || s.sortDir === 'desc';
  if (!okTipo || !isNum(s.desdeAnio) || !isNum(s.hastaAnio) || typeof s.search !== 'string' || !okSortKey || !okDir || !isNum(s.anioA) || !isNum(s.anioB)) return null;
  return {
    tipo: s.tipo as 'SALES_ORDER' | 'INVOICE',
    desdeAnio: s.desdeAnio as number, hastaAnio: s.hastaAnio as number,
    search: s.search as string,
    sortKey: s.sortKey as CustomerSortKey, sortDir: s.sortDir as CustomerSortDir,
    comparar: typeof s.comparar === 'boolean' ? s.comparar : false,
    anioA: s.anioA as number, anioB: s.anioB as number,
    onlyFav: typeof s.onlyFav === 'boolean' ? s.onlyFav : false,
  };
}
```
Test: un objeto válido → parsea; falta un campo / tipo malo → null; `comparar`/`onlyFav` ausentes → default false.

- [ ] **Step 3: `FavoriteStar.tsx`**
```tsx
import { Star } from 'lucide-react';
export default function FavoriteStar({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-label={active ? 'Quitar de favoritos' : 'Añadir a favoritos'} className="p-1 text-gray-300 hover:text-amber-400">
      <Star size={16} className={active ? 'fill-amber-400 text-amber-400' : ''} />
    </button>
  );
}
```

- [ ] **Step 4: `SavedViewsMenu.tsx`** — guardar (prompt nombre) / aplicar / borrar. Props `{ viewKey, currentState, onApply }`.
```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchSavedViews, saveView, deleteSavedView } from '../api';
import { parseClientesState, type ClientesViewState } from '../lib/clientes-view-state';

export default function SavedViewsMenu({ viewKey, currentState, onApply }: { viewKey: string; currentState: ClientesViewState; onApply: (s: ClientesViewState) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['saved-views', viewKey], queryFn: () => fetchSavedViews(viewKey) });
  const inval = () => qc.invalidateQueries({ queryKey: ['saved-views', viewKey] });
  const save = useMutation({ mutationFn: (name: string) => saveView(viewKey, name, currentState), onSuccess: inval });
  const del = useMutation({ mutationFn: (id: string) => deleteSavedView(id), onSuccess: inval });

  const onSave = () => { const name = window.prompt('Nombre de la vista:'); if (name && name.trim()) save.mutate(name.trim()); };
  const apply = (raw: unknown) => { const s = parseClientesState(raw); if (s) onApply(s); };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <button onClick={onSave} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">Guardar vista</button>
        <button onClick={() => setOpen((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">Vistas ({q.data?.length ?? 0})</button>
      </div>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border bg-white shadow-lg">
          {(q.data ?? []).length === 0 ? <p className="p-3 text-sm text-gray-500">Sin vistas guardadas.</p> : (
            <ul className="max-h-64 overflow-auto py-1">
              {(q.data ?? []).map((v) => (
                <li key={v.id} className="flex items-center justify-between px-3 py-1.5 text-sm hover:bg-gray-50">
                  <button className="text-left flex-1 truncate" onClick={() => { apply(v.state); setOpen(false); }}>{v.name}</button>
                  <button className="text-gray-400 hover:text-red-600 ml-2" onClick={() => del.mutate(v.id)} aria-label="Borrar vista">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Cablear `Clientes.tsx`**
- Añadir estado `onlyFav` (default false).
- `const favQ = useQuery({ queryKey: ['favorites'], queryFn: fetchFavorites });` `const favSet = new Set(favQ.data ?? []);`
- `const toggleFav = useMutation({ mutationFn: toggleFavorite, onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }) });` (importa `useMutation`/`useQueryClient`).
- En la matriz: filtrar por `onlyFav` (`sorted.filter(r => !onlyFav || favSet.has(r.customer))`) tras `sortCustomerMatrix`; añadir una **columna/estrella** al inicio de cada fila con `<FavoriteStar active={favSet.has(r.customer)} onToggle={() => toggleFav.mutate(r.customer)} />` (la fila TOTAL sin estrella).
- Toolbar: checkbox "Solo favoritos" (set `onlyFav`) + `<SavedViewsMenu viewKey="clientes" currentState={{ tipo, desdeAnio, hastaAnio, search, sortKey, sortDir, comparar, anioA, anioB, onlyFav }} onApply={(s) => { setTipo(s.tipo); setDesdeAnio(s.desdeAnio); setHastaAnio(s.hastaAnio); setSearch(s.search); setSortKey(s.sortKey); setSortDir(s.sortDir); setComparar(s.comparar); setAnioA(s.anioA); setAnioB(s.anioB); setOnlyFav(s.onlyFav); }} />`.
- (El enlace del nombre de cliente a la ficha, ya existente, se mantiene junto a la estrella.)

- [ ] **Step 6: Verificar**
```bash
cd apps/salestracker && npx tsc --noEmit && npx vitest run
cd ../.. && npm run build --workspace=apps/portal
```
- [ ] **Step 7: Commit** `feat(salestracker): favoritos (estrella) + vistas guardadas en Clientes`.

---

## Task 3: Verificación end-to-end + handoff

- [ ] **Step 1: Verificación completa** (hub-api tsc+tests, salestracker tsc+tests, portal build). Reportar salida real.
- [ ] **Step 2: Prueba local (si hay BD):** arrancar hub-api (aplica la migración 009 en el boot) y con un token de usuario de BD:
```bash
curl.exe -s -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" -d '{"customer":"ACME"}' http://localhost:3001/api/salestracker/favorites/toggle
curl.exe -s -H "Authorization: Bearer <TOKEN>" http://localhost:3001/api/salestracker/favorites
```
Expected: `{"favorited":true}` y luego `{"favorites":["ACME"]}`.
- [ ] **Step 3: Handoff:** merge/push + redeploy **hub-api** (¡la migración 009 se aplica en el arranque!) **y portal**. Verificar en `/salestracker/clientes`: estrella por cliente (persiste al refrescar), filtro "solo favoritos", guardar/aplicar/borrar vistas.

---

## Self-Review (cobertura)
- Migración `portal.st_favorites`/`st_saved_views` (idempotente, en MIGRATIONS): T1. ✅
- Módulo user-state (favoritos toggle, vistas upsert/borrar, validadores puros testeados): T1. ✅
- 5 endpoints owner-gated (user_id del JWT, nunca del body; legacy sin user_id → [] / 400): T1. ✅
- Fetchers + FavoriteStar + SavedViewsMenu + parseClientesState (test): T2. ✅
- Cableado en Clientes (estrellas, solo-favoritos, guardar/aplicar/borrar vistas): T2. ✅
- Auth: reads/per-user con requireAuth+requireApp; sin admin (es per-user). ✅

Sin placeholders. Owner siempre del JWT (`getPayload(req).user_id`). Límites de nombre/tamaño. Tipos consistentes (`SavedView`, `ClientesViewState`). **Gotcha operativo:** cambia hub-api + migración → redeploy de hub-api obligatorio.

## Próximos: Plan 4A (categorías + agrupaciones, admin; desbloquea Tablas remap + 3D) · 3D (grouping) · Plan 5 (cutover).
