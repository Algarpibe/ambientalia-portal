# Aviso de solicitudes pendientes — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un administrador vea en el enlace «Usuarios» del menú lateral cuántas solicitudes de
acceso esperan su aprobación.

**Architecture:** hub-api expone `GET /api/users/pending-count` (`requireAdmin`) → `{ pending: n }`,
con `UserRepository.countPending()` y `UserService.countPending()`. En el portal, el hook
`usePendingUsersCount(enabled)` consulta esa ruta al montarse, cada 5 minutos con la pestaña visible,
al volver a la pestaña (si pasaron 30 s desde la última) y al recibir el evento de ventana
`PENDING_USERS_CHANGED`; ante cualquier fallo conserva el último valor. `Sidebar` pinta un globo (o un
punto con el menú plegado) y `AdminUsers` lanza el evento tras aprobar o eliminar con éxito.

**Tech Stack:** hub-api (Express 4, TypeScript ESM con imports `.js`, Vitest 2 + supertest); portal
(React 19, react-router-dom 7, Tailwind 3.4, lucide-react, Vitest 4 + jsdom + Testing Library con
`fireEvent`).

**Spec:** `docs/superpowers/specs/2026-11-20-aviso-solicitudes-pendientes-design.md`.
**Rama:** `feat/aviso-pendientes`, rama corta en la copia principal (Task 0). Sin worktree: el
cambio es pequeño y la copia principal ya tiene `node_modules`.

---

## Reglas para quien implemente

- **TDD estricto:** cada test se ve en ROJO, y por la razón esperada, antes de escribir el código.
- **Editar solo con Edit/Write.** Nunca `Set-Content`, `sed -i` ni `perl -pi`: corrompen las tildes.
- **Commits:** convencionales, en español, sin tildes ni eñes, **sin ninguna línea de atribución**
  (nada de `Co-Authored-By`), con rutas explícitas (`git add <ruta> <ruta>`, nunca `git add -A` ni
  `git add .`).
- **No tocar** `.gitignore` ni los ficheros sin seguimiento del usuario (`.atl/`, `img/`, `openspec/`,
  `apps/WO-sales/prompts/`). **Nunca `git stash`** (ni con rutas ni sin ellas).
- **El repo es PÚBLICO:** ni correos reales ni secretos en código, tests, documentación o commits.
- **No lanzar vitest desde la raíz del repo:** siempre desde `apps/hub-api` o `apps/portal`. Este plan
  no añade tests de BD (`*.db.test.ts`).
- **Comentarios** en español explicando el porqué. Identificadores en inglés en hub-api y en el hook
  (convención del módulo de usuarios y de `useProfile.ts`); los textos de la interfaz, exactamente
  como en este plan.
- **Fuera del alcance, a propósito:** la tabla de usuarios (`UserTable.tsx`), la página de inicio, la
  barra superior (`TopBar`), los correos y n8n.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `apps/hub-api/src/users/users.repository.ts` | `countPending()` |
| `apps/hub-api/src/users/users.service.ts` | `countPending()` |
| `apps/hub-api/src/users/users.router.ts` | `GET /users/pending-count` |
| `apps/hub-api/src/users.integration.test.ts` | rama del pool falso + 4 tests |
| `apps/portal/src/hooks/usePendingUsersCount.ts` | **nuevo**: hook, evento y constantes |
| `apps/portal/src/hooks/usePendingUsersCount.test.ts` | **nuevo** |
| `apps/portal/src/components/Sidebar.tsx` | globo / punto en «Usuarios» |
| `apps/portal/src/components/Sidebar.test.tsx` | mock del hook + 6 tests |
| `apps/portal/src/pages/admin/AdminUsers.tsx` | `act` con `onOk`; aprobar y eliminar avisan |
| `apps/portal/src/pages/admin/AdminUsers.test.tsx` | 4 tests |

---

### Task 0: Rama

- [ ] **Step 1: Crear la rama desde `main` al día**

Desde la raíz del repo:

```bash
git checkout main
git pull --ff-only
git checkout -b feat/aviso-pendientes
git status --short
```

Expected: en `feat/aviso-pendientes`; `git status` muestra solo lo del usuario (` M .gitignore` y las
carpetas `??`), que no se toca.

---

### Task 1: hub-api — `GET /api/users/pending-count`

**Files:**
- Modify: `apps/hub-api/src/users.integration.test.ts` (pool falso, líneas 132-134; tests tras el
  `describe('GET /api/users')`, línea 257)
- Modify: `apps/hub-api/src/users/users.repository.ts` (tras `listPaginated`, línea 245)
- Modify: `apps/hub-api/src/users/users.service.ts` (tras `listUsers`, línea 164)
- Modify: `apps/hub-api/src/users/users.router.ts` (tras `GET /users`, línea 182)

- [ ] **Step 1: Enseñar al pool falso la consulta nueva**

En `apps/hub-api/src/users.integration.test.ts`, sustituir:

```ts
    if (/count\(\*\)/i.test(sql)) {
      return { rows: [{ total: this.users.length }], rowCount: 1 };
    }
```

por:

```ts
    // Contador del aviso de solicitudes pendientes. Va ANTES del count(*)
    // genérico de la lista paginada, que cuenta todas las filas.
    if (/count\(\*\)/i.test(sql) && /WHERE status = 'pending'/i.test(sql)) {
      return { rows: [{ total: this.users.filter((u) => u.status === 'pending').length }], rowCount: 1 };
    }
    if (/count\(\*\)/i.test(sql)) {
      return { rows: [{ total: this.users.length }], rowCount: 1 };
    }
```

- [ ] **Step 2: Escribir los tests de la ruta**

En el mismo fichero, justo después del cierre del `describe('GET /api/users', ...)` (la línea `});`
que sigue al test «token admin → 200 con forma paginada») y antes de
`describe('POST /api/auth/register', ...)`, añadir:

```ts
// Aviso de solicitudes pendientes en el enlace «Usuarios» del portal.
describe('GET /api/users/pending-count', () => {
  it('sin token → 401', async () => {
    const res = await request(app).get('/api/users/pending-count');
    expect(res.status).toBe(401);
  });
  it('token reader → 403', async () => {
    const res = await request(app).get('/api/users/pending-count').set(bearer(readerToken));
    expect(res.status).toBe(403);
  });
  it('token admin → 200 y cuenta solo las cuentas pending', async () => {
    db.seedUser({ status: 'pending' });
    db.seedUser({ status: 'pending' });
    db.seedUser({ status: 'inactive' });
    const res = await request(app).get('/api/users/pending-count').set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 2 });
  });
  it('sin cuentas pending → 0', async () => {
    const res = await request(app).get('/api/users/pending-count').set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 0 });
  });
});
```

- [ ] **Step 3: Verlos en rojo**

Desde `apps/hub-api`:

```bash
npx vitest run src/users.integration.test.ts -t "pending-count"
```

Expected: FAIL los 4: la ruta no existe y Express responde 404 (`expected 404 to be 401`, `… to be
403`, `… to be 200`).

- [ ] **Step 4: Repositorio**

En `apps/hub-api/src/users/users.repository.ts`, justo después del cierre de `listPaginated`:

```ts
    return { users: rows.map(toPublic), total, page: safePage, limit: safePerPage };
  }
```

añadir:

```ts

  /** Cuántas cuentas esperan aprobación (aviso del enlace «Usuarios» del portal). */
  async countPending(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS total FROM portal.users WHERE status = 'pending'`,
    );
    return rows[0]?.total ?? 0;
  }
```

- [ ] **Step 5: Servicio**

En `apps/hub-api/src/users/users.service.ts`, justo después de:

```ts
  /** Lista paginada de usuarios (50 por página, Req 2.1). */
  async listUsers(page: number): Promise<PaginatedUsers> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    return this.repo.listPaginated(safePage, USERS_PER_PAGE);
  }
```

añadir:

```ts

  /** Número de solicitudes de acceso pendientes de aprobar. */
  async countPending(): Promise<number> {
    return this.repo.countPending();
  }
```

- [ ] **Step 6: Router**

En `apps/hub-api/src/users/users.router.ts`, justo después del bloque:

```ts
  // GET /api/users?page=N — lista paginada (50/página).
  router.get('/users', requireAdmin, async (req: Request, res: Response) => {
    try {
      const page = Number.parseInt(String(req.query.page ?? '1'), 10) || 1;
      res.json(await service.listUsers(page));
    } catch (e) {
      sendError(res, e, 'list_users');
    }
  });
```

añadir:

```ts

  // GET /api/users/pending-count — solicitudes de acceso esperando aprobación.
  // Lo consulta el menú del portal para pintar el aviso en «Usuarios». Pasa por
  // el limitador de /users/* como el resto; no se audita porque es una lectura.
  router.get('/users/pending-count', requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({ pending: await service.countPending() });
    } catch (e) {
      sendError(res, e, 'count_pending_users');
    }
  });
```

- [ ] **Step 7: Verlos en verde**

```bash
npx vitest run src/users.integration.test.ts
```

Expected: PASS todo el fichero (los 4 nuevos y los que ya había).

- [ ] **Step 8: Tipos**

```bash
npx tsc --noEmit -p .
```

Expected: sin salida, exit 0.

- [ ] **Step 9: Commit**

Desde la raíz del repo:

```bash
git add apps/hub-api/src/users.integration.test.ts apps/hub-api/src/users/users.repository.ts apps/hub-api/src/users/users.service.ts apps/hub-api/src/users/users.router.ts
git commit -m "feat(hub-api): ruta que cuenta las solicitudes de acceso pendientes"
```

---

### Task 2: Portal — hook `usePendingUsersCount`

**Files:**
- Create: `apps/portal/src/hooks/usePendingUsersCount.ts`
- Test: `apps/portal/src/hooks/usePendingUsersCount.test.ts`

- [ ] **Step 1: Escribir el test**

Crear `apps/portal/src/hooks/usePendingUsersCount.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { authFetch } from '../lib/api';
import {
  usePendingUsersCount,
  notifyPendingUsersChanged,
  PENDING_USERS_CHANGED,
  PENDING_POLL_MS,
  PENDING_MIN_GAP_MS,
} from './usePendingUsersCount';

vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

const responde = (pending: unknown) => ({ ok: true, status: 200, json: async () => ({ pending }) });

// jsdom no deja cambiar la visibilidad de la pestaña: se tapa el getter del
// prototipo con una propiedad propia, que se borra al terminar cada test.
let visibilidad: DocumentVisibilityState = 'visible';
function ponerVisibilidad(v: DocumentVisibilityState): void {
  visibilidad = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

// Las respuestas simuladas se resuelven en microtareas; un setTimeout REAL (no
// está entre los temporizadores falsos) garantiza que ya terminaron.
const asentar = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  // Solo el intervalo y el reloj: setTimeout sigue siendo real para `asentar`.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  visibilidad = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilidad });
  mockFetch.mockResolvedValue(responde(2));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: DocumentVisibilityState }).visibilityState;
  vi.clearAllMocks();
});

describe('usePendingUsersCount', () => {
  it('con enabled falso no consulta nunca y devuelve 0', () => {
    const { result } = renderHook(() => usePendingUsersCount(false));
    vi.advanceTimersByTime(PENDING_POLL_MS);
    window.dispatchEvent(new Event(PENDING_USERS_CHANGED));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current).toBe(0);
  });

  it('al montar consulta la ruta y devuelve el número', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/users/pending-count');
    await asentar();
    expect(result.current).toBe(2);
  });

  it('cada 5 minutos vuelve a contar si la pestaña está visible', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    mockFetch.mockResolvedValue(responde(3));
    vi.advanceTimersByTime(PENDING_POLL_MS);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await asentar();
    expect(result.current).toBe(3);
  });

  it('con la pestaña oculta el intervalo no consulta', async () => {
    renderHook(() => usePendingUsersCount(true));
    await asentar();
    ponerVisibilidad('hidden');
    vi.advanceTimersByTime(PENDING_POLL_MS);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('al volver a la pestaña consulta, salvo que la última consulta tenga menos de 30 s', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();

    ponerVisibilidad('hidden');
    vi.advanceTimersByTime(PENDING_MIN_GAP_MS - 1_000);
    ponerVisibilidad('visible');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    ponerVisibilidad('hidden');
    vi.advanceTimersByTime(1_000);
    mockFetch.mockResolvedValue(responde(4));
    ponerVisibilidad('visible');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await asentar();
    expect(result.current).toBe(4);
  });

  it('el aviso del panel consulta siempre, aunque la última consulta sea reciente', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    mockFetch.mockResolvedValue(responde(0));
    act(() => notifyPendingUsersChanged());
    expect(mockFetch).toHaveBeenCalledTimes(2);
    await asentar();
    expect(result.current).toBe(0);
  });

  it('un 429, un fallo de red o un cuerpo sin número conservan el último valor bueno', async () => {
    const { result } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    expect(result.current).toBe(2);

    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    mockFetch.mockRejectedValueOnce(new Error('red caida'));
    mockFetch.mockResolvedValueOnce(responde('muchos'));
    act(() => notifyPendingUsersChanged());
    act(() => notifyPendingUsersChanged());
    act(() => notifyPendingUsersChanged());
    expect(mockFetch).toHaveBeenCalledTimes(4);
    await asentar();
    expect(result.current).toBe(2);
  });

  it('al desmontar deja de consultar', async () => {
    const { unmount } = renderHook(() => usePendingUsersCount(true));
    await asentar();
    unmount();
    notifyPendingUsersChanged();
    vi.advanceTimersByTime(PENDING_POLL_MS);
    ponerVisibilidad('hidden');
    ponerVisibilidad('visible');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verlo en rojo**

Desde `apps/portal`:

```bash
npx vitest run src/hooks/usePendingUsersCount.test.ts
```

Expected: FAIL al cargar el fichero: no se resuelve `./usePendingUsersCount`.

- [ ] **Step 3: Implementar el hook**

Crear `apps/portal/src/hooks/usePendingUsersCount.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { authFetch } from '../lib/api';

// Solicitudes de acceso pendientes, para el aviso del enlace «Usuarios» del menú
// (spec docs/superpowers/specs/2026-11-20-aviso-solicitudes-pendientes-design.md).

/**
 * Evento global para que el menú vuelva a contar en cuanto el panel de usuarios
 * aprueba o elimina una cuenta, sin esperar al siguiente sondeo. Mismo patrón
 * que PROFILE_UPDATED en useProfile.ts.
 */
export const PENDING_USERS_CHANGED = 'pending-users-changed';
export function notifyPendingUsersChanged(): void {
  window.dispatchEvent(new Event(PENDING_USERS_CHANGED));
}

/** Cada cuánto se vuelve a contar mientras la pestaña está visible. */
export const PENDING_POLL_MS = 5 * 60_000;

/**
 * Distancia mínima entre consultas lanzadas al volver a la pestaña. hub-api
 * limita /api/users/* a 20 peticiones por minuto, compartidas con las acciones
 * del panel: cambiar de pestaña a menudo no debe gastarlas.
 */
export const PENDING_MIN_GAP_MS = 30_000;

/**
 * Número de cuentas en `pending`. Con `enabled` falso (quien no es admin) no hace
 * ninguna petición y devuelve 0. Cualquier fallo se ignora y se conserva el
 * último valor bueno: un 429 pasajero no debe hacer parpadear el aviso.
 */
export function usePendingUsersCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  const lastFetchRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let vivo = true;

    const consultar = async () => {
      lastFetchRef.current = Date.now();
      try {
        const res = await authFetch('/api/users/pending-count');
        if (!res.ok) return;
        const body = (await res.json()) as { pending?: unknown };
        if (vivo && typeof body.pending === 'number') setCount(body.pending);
      } catch {
        /* silencioso: se conserva el último valor bueno */
      }
    };

    const visible = () => document.visibilityState === 'visible';
    const alIntervalo = () => {
      if (visible()) void consultar();
    };
    const alVolver = () => {
      if (visible() && Date.now() - lastFetchRef.current >= PENDING_MIN_GAP_MS) void consultar();
    };
    const alCambiar = () => {
      void consultar();
    };

    void consultar();
    // setInterval global, no window.setInterval: es el que los tests sustituyen
    // por temporizadores falsos.
    const id = setInterval(alIntervalo, PENDING_POLL_MS);
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener(PENDING_USERS_CHANGED, alCambiar);
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener(PENDING_USERS_CHANGED, alCambiar);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
```

- [ ] **Step 4: Verlo en verde**

```bash
npx vitest run src/hooks/usePendingUsersCount.test.ts
```

Expected: PASS los 8.

- [ ] **Step 5: Commit**

Desde la raíz del repo:

```bash
git add apps/portal/src/hooks/usePendingUsersCount.ts apps/portal/src/hooks/usePendingUsersCount.test.ts
git commit -m "feat(portal): hook que cuenta las solicitudes pendientes para el admin"
```

---

### Task 3: Portal — globo en «Usuarios»

**Files:**
- Modify: `apps/portal/src/components/Sidebar.test.tsx` (mocks arriba, líneas 8-11; tests nuevos al
  final)
- Modify: `apps/portal/src/components/Sidebar.tsx` (import, línea 18; cálculo tras la línea 61;
  enlace, líneas 166-176)

- [ ] **Step 1: Simular el hook en los tests del menú**

En `apps/portal/src/components/Sidebar.test.tsx`, justo después de:

```ts
const state = vi.hoisted(() => ({ value: null as AuthState | null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => state.value }));
```

añadir:

```ts
// El hook real consulta hub-api; aquí solo importa qué recibe y qué devuelve.
const pendientes = vi.hoisted(() => ({ value: 0, llamadas: [] as boolean[] }));
vi.mock('../hooks/usePendingUsersCount', () => ({
  usePendingUsersCount: (enabled: boolean) => {
    pendientes.llamadas.push(enabled);
    return enabled ? pendientes.value : 0;
  },
}));
beforeEach(() => {
  pendientes.value = 0;
  pendientes.llamadas = [];
});
```

Y en la primera línea de imports de Testing Library, añadir `within`:

```ts
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
```

- [ ] **Step 2: Escribir los tests del aviso**

Al final del fichero, añadir:

```ts
describe('Sidebar — solicitudes pendientes en «Usuarios»', () => {
  const enlaceUsuarios = () => document.querySelector('a[href="/admin/users"]') as HTMLAnchorElement;
  const renderAdmin = () => {
    setAuth({ isAuthenticated: true, role: 'admin', user_id: 'a' });
    renderSidebar();
  };

  it('admin con pendientes: globo con el número y el enlace lo dice', () => {
    pendientes.value = 2;
    renderAdmin();
    expect(pendientes.llamadas).toContain(true);
    expect(within(enlaceUsuarios()).getByText('2')).toBeTruthy();
    expect(enlaceUsuarios().getAttribute('aria-label')).toBe('Usuarios, 2 solicitudes pendientes');
  });

  it('una sola solicitud va en singular', () => {
    pendientes.value = 1;
    renderAdmin();
    expect(enlaceUsuarios().getAttribute('aria-label')).toBe('Usuarios, 1 solicitud pendiente');
  });

  it('más de 9 muestra 9+, pero el enlace dice el número real', () => {
    pendientes.value = 12;
    renderAdmin();
    expect(within(enlaceUsuarios()).getByText('9+')).toBeTruthy();
    expect(enlaceUsuarios().getAttribute('aria-label')).toBe('Usuarios, 12 solicitudes pendientes');
  });

  it('sin pendientes el enlace queda como siempre', () => {
    renderAdmin();
    expect(enlaceUsuarios().hasAttribute('aria-label')).toBe(false);
    expect(enlaceUsuarios().textContent).toBe('Usuarios');
    expect(screen.queryByTestId('punto-pendientes')).toBeNull();
  });

  it('plegado: punto sobre el icono, sin número, y el title lo dice', () => {
    pendientes.value = 3;
    renderAdmin();
    fireEvent.click(screen.getByLabelText('Contraer menú'));
    expect(screen.getByTestId('punto-pendientes')).toBeTruthy();
    expect(within(enlaceUsuarios()).queryByText('3')).toBeNull();
    expect(enlaceUsuarios().getAttribute('title')).toBe('Usuarios, 3 solicitudes pendientes');
  });

  it('un lector no consulta: el hook recibe false', () => {
    setAuth({ isAuthenticated: true, role: 'reader', user_id: 'r' });
    renderSidebar();
    expect(pendientes.llamadas.length).toBeGreaterThan(0);
    expect(pendientes.llamadas.every((e) => e === false)).toBe(true);
  });
});
```

- [ ] **Step 3: Verlos en rojo**

Desde `apps/portal`:

```bash
npx vitest run src/components/Sidebar.test.tsx
```

Expected: FAIL 5 de los 6 nuevos (el hook no se llama, `llamadas` queda vacía; no hay globo ni
`aria-label`). «sin pendientes el enlace queda como siempre» ya pasa: es el candado de que con 0 el
enlace no cambia. Los tests que ya había siguen en verde.

- [ ] **Step 4: Implementar el aviso**

En `apps/portal/src/components/Sidebar.tsx`:

1. Tras `import { useAuth } from '../hooks/useAuth';` añadir:

```ts
import { usePendingUsersCount } from '../hooks/usePendingUsersCount';
```

2. Tras `const showTableroTv = apps.includes('equipos-taller');` añadir:

```ts
  // Solicitudes de acceso esperando aprobación. Solo los admin consultan: para
  // el resto el hook no hace ninguna petición y devuelve 0.
  const pendientes = usePendingUsersCount(role === 'admin');
  const avisoPendientes =
    pendientes > 0
      ? `Usuarios, ${pendientes} ${pendientes === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}`
      : undefined;
```

3. Sustituir el enlace de «Usuarios»:

```tsx
        {role === 'admin' && (
          <Link
            to="/admin/users"
            onClick={alNavegar}
            className={itemClass('/admin/users', plegada)}
            title={plegada ? 'Usuarios' : undefined}
          >
            <Users size={20} className="shrink-0" />
            {!plegada && 'Usuarios'}
          </Link>
        )}
```

por:

```tsx
        {role === 'admin' && (
          <Link
            to="/admin/users"
            onClick={alNavegar}
            className={itemClass('/admin/users', plegada)}
            title={plegada ? (avisoPendientes ?? 'Usuarios') : undefined}
            aria-label={avisoPendientes}
          >
            <span className="relative shrink-0">
              <Users size={20} />
              {/* Plegada no cabe el número: un punto, y el title dice cuántas. */}
              {plegada && pendientes > 0 && (
                <span
                  data-testid="punto-pendientes"
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-600 ring-2 ring-white"
                />
              )}
            </span>
            {!plegada && 'Usuarios'}
            {!plegada && pendientes > 0 && (
              <span
                aria-hidden="true"
                className="ml-auto min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-red-600 text-white text-xs font-bold leading-none text-center"
              >
                {pendientes > 9 ? '9+' : pendientes}
              </span>
            )}
          </Link>
        )}
```

- [ ] **Step 5: Verlos en verde**

```bash
npx vitest run src/components/Sidebar.test.tsx
```

Expected: PASS todo el fichero (los 6 nuevos y los que ya había).

- [ ] **Step 6: Commit**

Desde la raíz del repo:

```bash
git add apps/portal/src/components/Sidebar.tsx apps/portal/src/components/Sidebar.test.tsx
git commit -m "feat(portal): globo de solicitudes pendientes en el enlace Usuarios"
```

---

### Task 4: Portal — el panel avisa al contador

**Files:**
- Modify: `apps/portal/src/pages/admin/AdminUsers.test.tsx` (imports, líneas 2-8; tests al final)
- Modify: `apps/portal/src/pages/admin/AdminUsers.tsx` (import; `act`, líneas 90-115;
  `changeStatus`, `handleApprove` y `handleDelete`, líneas 117-134)

- [ ] **Step 1: Escribir los tests**

En `apps/portal/src/pages/admin/AdminUsers.test.tsx`:

1. Sustituir la primera línea de imports de vitest por:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
```

2. Tras `import type { AdminUser } from './types';` añadir:

```ts
import { notify } from '../../lib/notify';
import { PENDING_USERS_CHANGED } from '../../hooks/usePendingUsersCount';
```

3. Al final del fichero, añadir:

```ts
// Aprobar o eliminar cambian el número de pendientes: el panel avisa al menú para
// que el globo de «Usuarios» se ponga al día sin esperar al siguiente sondeo.
describe('AdminUsers · aviso al contador de pendientes', () => {
  const lista = [user('1', 'Ana', 'active'), user('2', 'Beto', 'pending')];

  /** La lista carga bien; las mutaciones responden con `mutacion`. */
  function responder(mutacion: { ok: boolean; status: number }) {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method
          ? { ...mutacion, json: async () => ({}) }
          : { ok: true, json: async () => ({ users: lista, total: 2, page: 1, limit: 50 }) },
      ),
    );
  }

  let avisos = 0;
  const contar = () => {
    avisos += 1;
  };
  beforeEach(() => {
    avisos = 0;
    window.addEventListener(PENDING_USERS_CHANGED, contar);
  });
  afterEach(() => window.removeEventListener(PENDING_USERS_CHANGED, contar));

  it('aprobar con éxito avisa', async () => {
    responder({ ok: true, status: 200 });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: /Aprobar/ }));
    await waitFor(() => expect(avisos).toBe(1));
  });

  it('eliminar con éxito avisa', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      responder({ ok: true, status: 200 });
      renderAdmin();
      await screen.findByText('Beto');
      const eliminar = screen.getAllByRole('button', { name: 'Eliminar usuario' });
      fireEvent.click(eliminar[eliminar.length - 1]);
      await waitFor(() => expect(avisos).toBe(1));
    } finally {
      confirmar.mockRestore();
    }
  });

  it('aprobar con error no avisa', async () => {
    responder({ ok: false, status: 500 });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: /Aprobar/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No se pudo completar la acción.', 'error'));
    expect(avisos).toBe(0);
  });

  it('desactivar no avisa: no cambia los pendientes', async () => {
    responder({ ok: true, status: 200 });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: /Desactivar/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Usuario desactivado.', 'info'));
    expect(avisos).toBe(0);
  });
});
```

- [ ] **Step 2: Verlos en rojo**

Desde `apps/portal`:

```bash
npx vitest run src/pages/admin/AdminUsers.test.tsx
```

Expected: FAIL «aprobar con éxito avisa» y «eliminar con éxito avisa» (`expected 0 to be 1`); los
otros dos nuevos y los que ya había, en verde.

- [ ] **Step 3: Implementar el aviso**

En `apps/portal/src/pages/admin/AdminUsers.tsx`:

1. Tras `import { useAuth } from '../../hooks/useAuth';` añadir:

```ts
import { notifyPendingUsersChanged } from '../../hooks/usePendingUsersCount';
```

2. En `act`, sustituir:

```ts
  /** Ejecuta una mutación sobre `userId`, notifica el resultado y refresca la lista. */
  const act = useCallback(
    async (userId: string, req: () => Promise<Response>, okMsg: string) => {
```

por:

```ts
  /**
   * Ejecuta una mutación sobre `userId`, notifica el resultado y refresca la lista.
   * `onOk` corre solo si la mutación salió bien (p. ej. avisar al contador de
   * pendientes del menú).
   */
  const act = useCallback(
    async (userId: string, req: () => Promise<Response>, okMsg: string, onOk?: () => void) => {
```

y, dentro de `act`, sustituir:

```ts
        notify(okMsg, 'info');
        await load(page);
```

por:

```ts
        notify(okMsg, 'info');
        onOk?.();
        await load(page);
```

3. Sustituir:

```ts
  const changeStatus = (u: AdminUser, status: 'active' | 'inactive', okMsg: string) =>
    act(u.id, () => authFetch(`/api/users/${u.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }), okMsg);

  const handleApprove = (u: AdminUser) => changeStatus(u, 'active', 'Usuario aprobado.');
```

por:

```ts
  const changeStatus = (u: AdminUser, status: 'active' | 'inactive', okMsg: string, onOk?: () => void) =>
    act(u.id, () => authFetch(`/api/users/${u.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }), okMsg, onOk);

  // Aprobar y eliminar son las únicas acciones que cambian cuántas cuentas
  // esperan aprobación: desactivar y reactivar mueven entre active e inactive.
  const handleApprove = (u: AdminUser) => changeStatus(u, 'active', 'Usuario aprobado.', notifyPendingUsersChanged);
```

4. En `handleDelete`, sustituir:

```ts
    act(u.id, () => authFetch(`/api/users/${u.id}`, { method: 'DELETE' }), 'Usuario eliminado.');
```

por:

```ts
    act(u.id, () => authFetch(`/api/users/${u.id}`, { method: 'DELETE' }), 'Usuario eliminado.', notifyPendingUsersChanged);
```

- [ ] **Step 4: Verlos en verde**

```bash
npx vitest run src/pages/admin/AdminUsers.test.tsx
```

Expected: PASS todo el fichero.

- [ ] **Step 5: Commit**

Desde la raíz del repo:

```bash
git add apps/portal/src/pages/admin/AdminUsers.tsx apps/portal/src/pages/admin/AdminUsers.test.tsx
git commit -m "feat(portal): el panel de usuarios avisa al contador tras aprobar o eliminar"
```

---

### Task 5: Verificación final

- [ ] **Step 1: Suites completas**

Desde `apps/hub-api`:

```bash
npm test
```

Expected: PASS. (Si el test 4.4 de users cae por timeout solo bajo carga, relanzar ese fichero solo:
es un fallo conocido y ajeno a este cambio.)

Desde `apps/portal`:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Tipos y lint del portal**

Desde `apps/portal`:

```bash
npx tsc -b
npx eslint src/hooks/usePendingUsersCount.ts src/hooks/usePendingUsersCount.test.ts src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/pages/admin/AdminUsers.tsx src/pages/admin/AdminUsers.test.tsx
```

Expected: sin salida en los dos.

- [ ] **Step 3: Estado del spec**

En `docs/superpowers/specs/2026-11-20-aviso-solicitudes-pendientes-design.md`, sustituir:

```markdown
**Estado:** diseño aprobado; pendiente del plan de implementación.
```

por:

```markdown
**Estado:** implementado en la rama `feat/aviso-pendientes` (plan
`docs/superpowers/plans/2026-11-20-aviso-solicitudes-pendientes.md`); pendiente de fusionar y
desplegar (hub-api primero).
```

- [ ] **Step 4: Commit**

Desde la raíz del repo:

```bash
git add docs/superpowers/specs/2026-11-20-aviso-solicitudes-pendientes-design.md
git commit -m "docs(portal): estado del aviso de solicitudes pendientes"
git status --short
```

Expected: `git status` muestra solo lo del usuario (` M .gitignore` y las carpetas `??`).
