# Cargo editable — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** que el administrador ponga, cambie o quite el cargo de cualquier ficha activa desde la
pestaña Empleados de Vacaciones y Permisos.

**Arquitectura:** una puerta más de la ficha, igual que `fijarCopia`: `repo.fijarCargo` (UPDATE con
`AND activo`), una función pura `normalizarCargo` que decide qué se guarda, `service.fijarCargo`
que las une y relee la ficha, y `PUT /api/ausencias/empleados/:id/cargo` detrás de `requireAdmin`.
En el front, `fijarCargo` con su propio lector de errores y un lápiz en la celda Cargo de
`ImportarEmpleados.tsx`.

**Stack:** hub-api (Express 4, TypeScript ESM con imports `.js`, SQL crudo, Vitest + supertest con
un doble en memoria, `*.db.test.ts` con testcontainers); apps/ausencias (React 19, Tailwind 3.4,
lucide-react, Vitest + jsdom + Testing Library con `fireEvent`).

**Spec:** `docs/superpowers/specs/2026-11-13-cargo-editable-design.md`.
**Rama:** `feat/cargo-editable` (ya creada, con la spec commiteada).

---

## Reglas para quien implemente

- **TDD estricto:** cada test se ve en ROJO, y por la razón esperada, antes de escribir el código.
- **Editar solo con Edit/Write.** Nunca `Set-Content`, `sed -i` ni `perl -pi`: corrompen las tildes.
- **Commits:** en español, sin tildes, sin ninguna línea de atribución, con rutas explícitas
  (`git add <ruta> <ruta>`, nunca `git add -A` ni `git add .`).
- **No tocar** `.gitignore` ni los ficheros sin seguimiento del usuario (`.atl/`, `img/`,
  `openspec/`, `apps/WO-sales/prompts/`). Nunca `git stash` sin rutas.
- **Comentarios** en español explicando el porqué. En los `*.db.test.ts` y en `router.test.ts`,
  sin tildes (es la convención de esos ficheros).
- **No lanzar vitest desde la raíz del repo:** siempre desde `apps/hub-api` o `apps/ausencias`.
- **Los tests de BD necesitan Docker.** Si no responde:
  `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"` y esperar a que arranque.

## Mapa de ficheros

| Fichero | Qué cambia |
|---|---|
| `apps/hub-api/src/ausencias/repo/empleados.ts` | + `fijarCargo` (después de `fijarCopia`, ~L315) |
| `apps/hub-api/src/ausencias/router.test.ts` | + `fijarCargo` en el doble (después de `fijarCopia`, ~L858); + `describe` de la ruta (después del de `/copia`, ~L4739) |
| `apps/hub-api/src/ausencias/repo.cargo.db.test.ts` | NUEVO: repo y servicio contra Postgres |
| `apps/hub-api/src/ausencias/service/organigrama.ts` | + `normalizarCargo` y `fijarCargo` (después de `fijarCopia`, ~L153) |
| `apps/hub-api/src/ausencias/cargo.test.ts` | NUEVO: unitarios de `normalizarCargo` |
| `apps/hub-api/src/ausencias/router.ts` | + `PUT /ausencias/empleados/:id/cargo` (después de `/copia`, ~L391) |
| `apps/ausencias/src/api/organigrama.ts` | + `errorDeCargo` (privada) y `fijarCargo` |
| `apps/ausencias/src/api/organigrama.test.ts` | NUEVO: `fijarCargo` con `fetch` simulado |
| `apps/ausencias/src/ImportarEmpleados.tsx` | lápiz y edición en la celda Cargo |
| `apps/ausencias/src/ImportarEmpleados.test.tsx` | NUEVO: el panel en jsdom |

**Barriles:** `repo.ts`, `service.ts` y `api.ts` usan `export *` sobre esos módulos, y los
`barril.test.ts` comparan función a función sin lista de nombres. Añadir funciones a módulos que ya
existen **no exige tocar ningún barril**. Lo único obligatorio es el doble de `router.test.ts`
(Task 1), porque su CANDADO exige que modele exactamente las funciones de `repo.ts`.

---

### Task 1: `repo.fijarCargo` y su doble

**Files:**
- Create: `apps/hub-api/src/ausencias/repo.cargo.db.test.ts`
- Modify: `apps/hub-api/src/ausencias/repo/empleados.ts` (después de `fijarCopia`, ~L315)
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (doble, después de `fijarCopia`, ~L858)

- [ ] **Step 1: Escribir el test de BD que falla**

Crear `apps/hub-api/src/ausencias/repo.cargo.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { fijarCargo } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// La puerta del cargo de la ficha. sembrarEmpleado siembra siempre con
// cargo 'Analista', y eso es lo que tiene que seguir ahi cuando la escritura
// NO debe cuajar.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const FANTASMA = '00000000-0000-4000-8000-000000000000';

let db: Pool;
let empleadoId: string;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
  empleadoId = await sembrarEmpleado(db, CORREO);
});

async function cargoEnBd(id: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT cargo FROM portal.empleados WHERE id = $1`, [id]);
  return (rows[0] as { cargo: string | null }).cargo;
}

describe('repo.fijarCargo', () => {
  it('cambia el cargo de una ficha activa', async () => {
    expect(await fijarCargo(db, empleadoId, 'Jefa de taller')).toBe(true);
    expect(await cargoEnBd(empleadoId)).toBe('Jefa de taller');
  });

  it('con null lo borra', async () => {
    expect(await fijarCargo(db, empleadoId, null)).toBe(true);
    expect(await cargoEnBd(empleadoId)).toBeNull();
  });

  it('una ficha inactiva: false, y su cargo no se toca', async () => {
    // Mismo criterio AND activo que fijarJefe y fijarCopia: la escritura cubre
    // exactamente el conjunto que la lectura ensena.
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    expect(await fijarCargo(db, empleadoId, 'Jefa de taller')).toBe(false);
    expect(await cargoEnBd(empleadoId)).toBe('Analista');
  });

  it('un id que no existe: false', async () => {
    expect(await fijarCargo(db, FANTASMA, 'Jefa de taller')).toBe(false);
  });

  it('VARCHAR(255) cuenta caracteres: caben 255 emojis (510 unidades UTF-16)', async () => {
    // Es la razon de que normalizarCargo cuente con [...texto].length y no con
    // .length: si este test cayera, el tope del servicio estaria mal calibrado.
    const largo = '\u{1F600}'.repeat(255);
    expect(await fijarCargo(db, empleadoId, largo)).toBe(true);
    expect(await cargoEnBd(empleadoId)).toBe(largo);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.cargo.db.test.ts
```

Esperado: FALLA, porque `fijarCargo` no existe en `./repo.js` (`fijarCargo is not a function` o
un error de tipos/import al cargar).

- [ ] **Step 3: Implementar `repo.fijarCargo`**

En `apps/hub-api/src/ausencias/repo/empleados.ts`, justo después de `fijarCopia`:

```ts
/**
 * Fija (o quita, con `null`) el cargo de un empleado. Devuelve false si no
 * existía o estaba inactivo, igual que `fijarJefe` y `fijarCopia`.
 *
 * No valida nada: qué es un cargo aceptable (recorte, vacío, longitud,
 * caracteres de control) lo decide `normalizarCargo` en el servicio.
 */
export async function fijarCargo(db: Pool, empleadoId: string, cargo: string | null): Promise<boolean> {
  const { rowCount } = await db.query(`UPDATE portal.empleados SET cargo = $2 WHERE id = $1 AND activo`, [
    empleadoId,
    cargo,
  ]);
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.cargo.db.test.ts
```

Esperado: 5 tests en verde.

- [ ] **Step 5: Ver el CANDADO del doble en rojo**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "CANDADO: modela exactamente"
```

Esperado: FALLA con «repo.ts exporta funciones que el doble de este fichero no modela» y
`["fijarCargo"]`.

- [ ] **Step 6: Modelar `fijarCargo` en el doble**

En `apps/hub-api/src/ausencias/router.test.ts`, dentro del `vi.mock('./repo.js', …)`, justo
después de la entrada `fijarCopia`:

```ts
  // Con el `activo !== false`, al contrario que fijarCopia: es lo que hace el
  // repo de verdad, y la ruta del cargo tiene un test de ficha inactiva.
  fijarCargo: async (_db: unknown, empleadoId: string, cargo: string | null) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId && x.activo !== false);
    if (!e) return false;
    e.cargo = cargo;
    return true;
  },
```

- [ ] **Step 7: Ver el CANDADO en verde**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "CANDADO: modela exactamente"
```

Esperado: PASA.

- [ ] **Step 8: Commit**

```bash
git add apps/hub-api/src/ausencias/repo/empleados.ts apps/hub-api/src/ausencias/repo.cargo.db.test.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): el repositorio fija el cargo de una ficha activa"
```

---

### Task 2: `normalizarCargo`, la regla de qué se guarda

**Files:**
- Create: `apps/hub-api/src/ausencias/cargo.test.ts`
- Modify: `apps/hub-api/src/ausencias/service/organigrama.ts` (después de `fijarCopia`, ~L153)

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/hub-api/src/ausencias/cargo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizarCargo } from './service.js';

// La regla del cargo, aislada y pura: qué llega del cuerpo de la petición y qué
// acaba en la columna `cargo VARCHAR(255)`.

/** El error que lanza, o null si no lanza. */
function fallo(bruto: unknown): unknown {
  try {
    normalizarCargo(bruto);
  } catch (e) {
    return e;
  }
  return null;
}

const INVALIDO = { code: 'cargo_invalido', status: 400, field: 'cargo' };

describe('normalizarCargo', () => {
  it('null es «sin cargo»', () => {
    expect(normalizarCargo(null)).toBeNull();
  });

  it('recorta los espacios de los extremos', () => {
    expect(normalizarCargo('  Jefa de taller  ')).toBe('Jefa de taller');
  });

  it('vacío o solo espacios también es «sin cargo»', () => {
    expect(normalizarCargo('')).toBeNull();
    expect(normalizarCargo('    ')).toBeNull();
  });

  it('conserva las tildes y la caja tal cual', () => {
    expect(normalizarCargo('Técnica de Calibración')).toBe('Técnica de Calibración');
  });

  it('400 cargo_invalido si no es ni texto ni null, incluida la clave ausente', () => {
    for (const bruto of [42, true, {}, [], undefined]) {
      expect(fallo(bruto), String(bruto)).toMatchObject(INVALIDO);
    }
  });

  it('400 con un carácter de control en medio: NUL, salto de línea, tabulador, DEL', () => {
    for (const bruto of ['Jefa\u0000', 'Jefa\nde taller', 'Jefa\tde taller', 'Jefa\u007Fde taller']) {
      expect(fallo(bruto), JSON.stringify(bruto)).toMatchObject(INVALIDO);
    }
  });

  it('los de los extremos no cuentan: se van con el recorte', () => {
    expect(normalizarCargo('\tJefa de taller\n')).toBe('Jefa de taller');
  });

  it('255 caracteres pasan y 256 no', () => {
    expect(normalizarCargo('a'.repeat(255))).toBe('a'.repeat(255));
    expect(fallo('a'.repeat(256))).toMatchObject(INVALIDO);
  });

  it('la longitud se mide después del recorte', () => {
    expect(normalizarCargo(` ${'a'.repeat(255)} `)).toBe('a'.repeat(255));
  });

  it('un emoji cuenta como UN carácter, igual que en VARCHAR(255)', () => {
    // 255 emojis son 510 unidades UTF-16: con `.length` se rechazarían aunque
    // PostgreSQL los guarda sin problema (lo prueba repo.cargo.db.test.ts).
    const emoji = '\u{1F600}';
    expect(normalizarCargo(emoji.repeat(255))).toBe(emoji.repeat(255));
    expect(fallo(emoji.repeat(256))).toMatchObject(INVALIDO);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/ausencias/cargo.test.ts
```

Esperado: FALLA, porque `normalizarCargo` no existe (`normalizarCargo is not a function`).

- [ ] **Step 3: Implementar `normalizarCargo`**

En `apps/hub-api/src/ausencias/service/organigrama.ts`, justo después de `fijarCopia`:

```ts
/** El tope de la columna: `portal.empleados.cargo VARCHAR(255)`. */
const CARGO_MAX = 255;

// U+0000–U+001F y U+007F. El NUL es el que de verdad rompe: PostgreSQL no lo
// admite en una columna de texto y la ruta contestaría un 500. El resto
// (tabulador, salto de línea…) no tiene sitio en un cargo de una sola línea, y
// descolocaría la firma de los correos, que lo pone en su propia línea.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

/**
 * Lo que de verdad se guarda como cargo a partir del cuerpo de la petición.
 *
 * `null`, el texto vacío y el texto de solo espacios significan lo mismo: «sin
 * cargo», que la pantalla pinta como «—». Cualquier otro tipo, incluida la clave
 * ausente, es un 400: se exige, no se interpreta.
 *
 * La longitud se cuenta por puntos de código (`[...cargo].length`) y no con
 * `.length`, porque así cuenta `VARCHAR(255)`: un emoji es un carácter para
 * PostgreSQL y dos unidades UTF-16 para JavaScript.
 */
export function normalizarCargo(bruto: unknown): string | null {
  if (bruto === null) return null;
  if (typeof bruto !== 'string') throw new AusenciaError('cargo_invalido', 400, 'cargo');
  const cargo = bruto.trim();
  if (!cargo) return null;
  if (CONTROL.test(cargo) || [...cargo].length > CARGO_MAX) {
    throw new AusenciaError('cargo_invalido', 400, 'cargo');
  }
  return cargo;
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/ausencias/cargo.test.ts
```

Esperado: 10 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/ausencias/service/organigrama.ts apps/hub-api/src/ausencias/cargo.test.ts
git commit -m "feat(ausencias): regla de que cargo se guarda, recortado y con tope de 255"
```

---

### Task 3: `service.fijarCargo` y la ruta `PUT /cargo`

**Files:**
- Modify: `apps/hub-api/src/ausencias/service/organigrama.ts` (después de `normalizarCargo`)
- Modify: `apps/hub-api/src/ausencias/router.ts` (después de la ruta `/copia`, ~L391)
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (después del `describe` de `/copia`, ~L4739)
- Modify: `apps/hub-api/src/ausencias/repo.cargo.db.test.ts`

- [ ] **Step 1: Escribir los tests de la ruta que fallan**

En `apps/hub-api/src/ausencias/router.test.ts`, justo después del `describe('PUT /ausencias/empleados/:id/copia', …)`:

```ts
describe('PUT /ausencias/empleados/:id/cargo', () => {
  const fijar = (id: string, body: object, t = token({ role: 'admin' })) =>
    request(app()).put(`/api/ausencias/empleados/${id}/cargo`).set('Authorization', `Bearer ${t}`).send(body);

  it('un admin fija el cargo, recortado, y recibe la ficha', async () => {
    const r = await fijar(E1, { cargo: '  Jefa de taller  ' }).expect(200);
    expect(r.body).toMatchObject({ id: E1, cargo: 'Jefa de taller' });
  });

  it('null y el texto vacio dejan la ficha sin cargo', async () => {
    expect((await fijar(E1, { cargo: null }).expect(200)).body.cargo).toBeNull();
    expect((await fijar(E2, { cargo: '   ' }).expect(200)).body.cargo).toBeNull();
  });

  it('400 cargo_invalido, con el campo, si no es ni texto ni null', async () => {
    const r = await fijar(E1, { cargo: 42 }).expect(400);
    expect(r.body).toEqual({ error: 'cargo_invalido', field: 'cargo' });
  });

  it('400 cargo_invalido si falta la clave', async () => {
    const r = await fijar(E1, {}).expect(400);
    expect(r.body.error).toBe('cargo_invalido');
  });

  it('400 cargo_invalido con un caracter de control, y la ficha no cambia', async () => {
    const r = await fijar(E1, { cargo: 'Jefa\u0000' }).expect(400);
    expect(r.body.error).toBe('cargo_invalido');
    expect(estado.plantilla.find((x: any) => x.id === E1)!.cargo).toBe('Analista');
  });

  it('404 si la ficha no existe', async () => {
    const r = await fijar(E_FANTASMA, { cargo: 'Jefa de taller' }).expect(404);
    expect(r.body.error).toBe('empleado_no_encontrado');
  });

  it('404 si la ficha esta inactiva, y su cargo no se toca', async () => {
    const e1 = estado.plantilla.find((x: any) => x.id === E1)!;
    e1.activo = false;
    const r = await fijar(E1, { cargo: 'Jefa de taller' }).expect(404);
    expect(r.body.error).toBe('empleado_no_encontrado');
    expect(e1.cargo).toBe('Analista');
  });

  it('403 a quien no es admin', async () => {
    await fijar(E1, { cargo: 'Jefa de taller' }, token()).expect(403);
  });
});
```

- [ ] **Step 2: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "PUT /ausencias/empleados/:id/cargo"
```

Esperado: FALLAN, porque la ruta no existe (404 donde se espera 200/400, y 404 donde se espera
403). El de «404 si la ficha no existe» puede pasar ya por casualidad, porque Express contesta 404
a una ruta desconocida; pero su `r.body.error` no será `empleado_no_encontrado`, así que también
debe caer.

- [ ] **Step 3: Implementar `service.fijarCargo`**

En `apps/hub-api/src/ausencias/service/organigrama.ts`, justo después de `normalizarCargo`:

```ts
/**
 * Pone, cambia o quita el cargo de alguien. Solo fichas activas.
 *
 * Sin registro de auditoría y sin correo, como la copia y la segunda firma: el
 * cargo no da ningún permiso. Se ve en el acto en la firma de los correos y en
 * `empleadoCargo`, también en solicitudes ya en trámite, porque los dos lo leen
 * de la ficha al usarlo.
 *
 * Devuelve `Empleado` y no `EmpleadoConJefatura`, al contrario que `fijarJefe`
 * y `fijarCopia`: el cargo no toca el árbol, y recalcular `empleadosConJefatura`
 * serían tres consultas para nada. La pantalla recarga la lista igualmente.
 */
export async function fijarCargo(db: Pool, empleadoId: string, body: unknown): Promise<Empleado> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const cargo = normalizarCargo(b.cargo);

  if (!(await repo.fijarCargo(db, empleadoId, cargo))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizado = await repo.empleadoPorId(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}
```

(`Empleado`, `AusenciaError`, `repo` y `Pool` ya están importados en ese fichero.)

- [ ] **Step 4: Implementar la ruta**

En `apps/hub-api/src/ausencias/router.ts`, justo después de la ruta `/copia`:

```ts
  /**
   * Pone, cambia o quita el cargo de alguien. Solo admin. No manda ningún
   * correo, igual que el jefe o la copia: configurar la ficha no es decidir
   * nada sobre una solicitud.
   *
   * Como la copia, el cargo NO se congela en el alta: la firma de los correos y
   * `empleadoCargo` lo leen de la ficha al usarlo, así que el cambio se ve
   * también en las solicitudes que ya estén en trámite.
   */
  router.put('/ausencias/empleados/:id/cargo', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarCargo(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_cargo');
    }
  });
```

- [ ] **Step 5: Ver que pasan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "PUT /ausencias/empleados/:id/cargo"
```

Esperado: 8 tests en verde.

- [ ] **Step 6: Añadir los tests del servicio contra Postgres**

En `apps/hub-api/src/ausencias/repo.cargo.db.test.ts`, añadir al bloque de imports:

```ts
import { fijarCargo as fijarCargoServicio } from './service.js';
```

y al final del fichero:

```ts
describe('service.fijarCargo contra la BD', () => {
  it('recorta, guarda y devuelve la ficha releida', async () => {
    const ficha = await fijarCargoServicio(db, empleadoId, { cargo: '  Jefa de taller  ' });
    expect(ficha).toMatchObject({ id: empleadoId, cargo: 'Jefa de taller' });
    expect(await cargoEnBd(empleadoId)).toBe('Jefa de taller');
  });

  it('el texto vacio deja el cargo en null', async () => {
    const ficha = await fijarCargoServicio(db, empleadoId, { cargo: '   ' });
    expect(ficha.cargo).toBeNull();
    expect(await cargoEnBd(empleadoId)).toBeNull();
  });

  it('404 con una ficha inactiva, y su cargo no se toca', async () => {
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    await expect(fijarCargoServicio(db, empleadoId, { cargo: 'Jefa de taller' })).rejects.toMatchObject({
      code: 'empleado_no_encontrado',
      status: 404,
    });
    expect(await cargoEnBd(empleadoId)).toBe('Analista');
  });
});
```

- [ ] **Step 7: Ver que pasan**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/ausencias/repo.cargo.db.test.ts
```

Esperado: 8 tests en verde. (Estos tests ya nacen en verde porque el servicio existe del Step 3: son
la comprobación contra la BD real de lo que la ruta probó con el doble. Su mutación se hace en la
Task 6.)

- [ ] **Step 8: Typecheck de hub-api**

```bash
cd apps/hub-api && npx tsc --noEmit -p tsconfig.json
```

Esperado: sin errores.

- [ ] **Step 9: Commit**

```bash
git add apps/hub-api/src/ausencias/service/organigrama.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts apps/hub-api/src/ausencias/repo.cargo.db.test.ts
git commit -m "feat(ausencias): ruta para fijar el cargo de una ficha, solo admin"
```

---

### Task 4: `fijarCargo` en el cliente del front

**Files:**
- Create: `apps/ausencias/src/api/organigrama.test.ts`
- Modify: `apps/ausencias/src/api/organigrama.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/ausencias/src/api/organigrama.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fijarCargo } from './organigrama';

// `mensajeDeError` enseñaría el código crudo `cargo_invalido` en un 400 y «No
// se pudieron cargar los datos (error 404)» en un 404. `fijarCargo` lleva su
// propio lector para decir algo que el admin entienda.

const json = (status: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

const responde = (res: Response) => {
  const fetchFalso = vi.fn(async () => res);
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
};

// Node 22+ trae un `localStorage` global que choca con el de jsdom; `authHeaders`
// lo lee al montar la petición.
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe('fijarCargo', () => {
  it('manda un PUT con el cargo a la ruta de la ficha y devuelve la ficha', async () => {
    const fetchFalso = responde(json(200, { id: 'e 1', cargo: 'Jefa de taller' }));
    const ficha = await fijarCargo('e 1', 'Jefa de taller');
    expect(ficha).toEqual({ id: 'e 1', cargo: 'Jefa de taller' });
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/ausencias\/empleados\/e%201\/cargo$/);
    expect(opciones.method).toBe('PUT');
    expect(opciones.body).toBe(JSON.stringify({ cargo: 'Jefa de taller' }));
  });

  it('manda null tal cual', async () => {
    const fetchFalso = responde(json(200, { id: 'e1', cargo: null }));
    await fijarCargo('e1', null);
    const [, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(opciones.body).toBe(JSON.stringify({ cargo: null }));
  });

  it('400 cargo_invalido: dice qué está mal, no el código', async () => {
    responde(json(400, { error: 'cargo_invalido', field: 'cargo' }));
    await expect(fijarCargo('e1', 'x')).rejects.toThrow(
      new Error('El cargo admite hasta 255 caracteres y no puede llevar saltos de línea ni caracteres de control.'),
    );
  });

  it('404 empleado_no_encontrado: la ficha ya no está activa', async () => {
    responde(json(404, { error: 'empleado_no_encontrado' }));
    await expect(fijarCargo('e1', 'x')).rejects.toThrow(new Error('Esa ficha ya no está activa. Recarga la lista.'));
  });

  it('un 404 SIN ese código (hub-api sin la ruta todavía) sale por el mensaje genérico', async () => {
    // Es lo que contestaría un hub-api antiguo si el portal se desplegara antes:
    // decir «la ficha no está activa» sería mentir.
    responde(new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }));
    const error = await fijarCargo('e1', 'x').then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).not.toMatch(/ficha/);
    expect(error?.message).toMatch(/404/);
  });

  it('otro 400 sale por el mensaje genérico', async () => {
    responde(json(400, { error: 'otra_cosa' }));
    await expect(fijarCargo('e1', 'x')).rejects.toThrow(new Error('otra_cosa'));
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/ausencias && npx vitest run src/api/organigrama.test.ts
```

Esperado: FALLA, porque `fijarCargo` no existe en `./organigrama`.

- [ ] **Step 3: Implementar**

En `apps/ausencias/src/api/organigrama.ts`, cambiar las dos primeras líneas de import:

```ts
import { conCuerpo, errorGenerico, get, put } from './http';
import type { Empleado, EmpleadoConJefatura } from './tipos';
```

y añadir al final del fichero:

```ts
/**
 * El error de `fijarCargo`, dicho para el admin.
 *
 * `mensajeDeError` enseñaría el código crudo `cargo_invalido` en un 400 y «No se
 * pudieron cargar los datos (error 404)» en un 404. El 404 solo se traduce si
 * trae `empleado_no_encontrado`: uno sin código es lo que contesta un hub-api
 * que aún no tiene la ruta (portal desplegado antes), y decir ahí «la ficha no
 * está activa» sería mentir.
 */
async function errorDeCargo(res: Response): Promise<Error> {
  const cuerpo = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown } | null;
  if (res.status === 400 && cuerpo?.error === 'cargo_invalido') {
    return new Error(
      'El cargo admite hasta 255 caracteres y no puede llevar saltos de línea ni caracteres de control.',
    );
  }
  if (res.status === 404 && cuerpo?.error === 'empleado_no_encontrado') {
    return new Error('Esa ficha ya no está activa. Recarga la lista.');
  }
  return errorGenerico(res);
}

/**
 * Pone, cambia o quita (`null` o vacío) el cargo de alguien. Solo admin. El
 * recorte y el «vacío = sin cargo» los decide el servidor.
 */
export const fijarCargo = (id: string, cargo: string | null) =>
  conCuerpo<Empleado>('PUT', `/api/ausencias/empleados/${encodeURIComponent(id)}/cargo`, { cargo }, errorDeCargo);
```

Y en el comentario de cabecera del fichero (L4-8), añadir «cargo» a la lista de puertas que cambian
la ficha: `las puertas que lo cambian (jefe, copia, segunda firma, cargo)`.

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/ausencias && npx vitest run src/api/organigrama.test.ts src/api/barril.test.ts
```

Esperado: todo verde (6 tests nuevos, y el barril sigue en verde porque `api.ts` hace `export *`).

- [ ] **Step 5: Commit**

```bash
git add apps/ausencias/src/api/organigrama.ts apps/ausencias/src/api/organigrama.test.ts
git commit -m "feat(ausencias): cliente para fijar el cargo, con errores legibles"
```

---

### Task 5: el lápiz en la celda Cargo

**Files:**
- Create: `apps/ausencias/src/ImportarEmpleados.test.tsx`
- Modify: `apps/ausencias/src/ImportarEmpleados.tsx`

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/ausencias/src/ImportarEmpleados.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { EmpleadoConJefatura } from './api';
import ImportarEmpleados from './ImportarEmpleados';

// La edición del cargo en la pestaña Empleados. Se simula `./api` entero salvo
// lo que el panel no toca, igual que PanelOrganigrama.test.tsx.

const api = vi.hoisted(() => ({
  fetchEmpleados: vi.fn(),
  fetchRetirados: vi.fn(),
  fijarRetiro: vi.fn(),
  reactivarEmpleado: vi.fn(),
  sincronizarEmpleados: vi.fn(),
  fijarCargo: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

const ficha = (id: string, nombreCompleto: string, cargo: string | null): EmpleadoConJefatura => ({
  id,
  nombreCompleto,
  correo: `${id}@ejemplo.test`,
  cargo,
  credencial: null,
  aprobadorCorreo: 'jefe@ejemplo.test',
  copiaCorreo: null,
  veAdjuntos: false,
  exportaRegistro: false,
  veTodaLaEmpresa: false,
  veKpis: false,
  requiereSegundaFirma: true,
  userId: null,
  activo: true,
  fechaRetiro: null,
  retiradoPor: null,
  retiradoAt: null,
  segundoAprobadorCorreo: null,
  informadoCorreo: null,
  enCiclo: false,
  esAdminDelPortal: false,
});

const ana = ficha('e1', 'Ana Pérez', 'Analista');
const luis = ficha('e2', 'Luis Gómez', null);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const lapiz = (nombre: string) => screen.getByLabelText(`Editar el cargo de ${nombre}`) as HTMLButtonElement;
const campo = (nombre: string) => screen.getByLabelText(`Cargo de ${nombre}`) as HTMLInputElement;
const sinCampo = (nombre: string) => screen.queryByLabelText(`Cargo de ${nombre}`);

async function montar(fichas: EmpleadoConJefatura[]) {
  api.fetchEmpleados.mockResolvedValue(fichas);
  render(<ImportarEmpleados />);
  await waitFor(() => expect(lapiz(fichas[0].nombreCompleto)).toBeTruthy());
}

describe('editar el cargo', () => {
  it('el lápiz abre el campo con el cargo actual', async () => {
    await montar([ana]);
    fireEvent.click(lapiz('Ana Pérez'));
    expect(campo('Ana Pérez').value).toBe('Analista');
  });

  it('sin cargo, la celda dice «—» y el campo abre vacío', async () => {
    await montar([luis]);
    expect(screen.getByText('—')).toBeTruthy();
    fireEvent.click(lapiz('Luis Gómez'));
    expect(campo('Luis Gómez').value).toBe('');
  });

  it('Enter guarda lo tecleado, cierra el campo, avisa y recarga la lista', async () => {
    await montar([ana]);
    api.fijarCargo.mockResolvedValue({ ...ana, cargo: 'Jefa de taller' });
    api.fetchEmpleados.mockResolvedValue([{ ...ana, cargo: 'Jefa de taller' }]);

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Cargo de Ana Pérez actualizado.')).toBeTruthy());
    expect(api.fijarCargo).toHaveBeenCalledWith('e1', 'Jefa de taller');
    expect(sinCampo('Ana Pérez')).toBeNull();
    // La recarga sale de un efecto (`recarga` en sus dependencias): se espera,
    // no se da por hecha en el mismo tick que el aviso.
    await waitFor(() => expect(api.fetchEmpleados).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Jefa de taller')).toBeTruthy());
  });

  it('el botón Guardar hace lo mismo que Enter', async () => {
    await montar([ana]);
    api.fijarCargo.mockResolvedValue({ ...ana, cargo: 'Jefa de taller' });

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(api.fijarCargo).toHaveBeenCalledWith('e1', 'Jefa de taller'));
  });

  it('el texto vacío se manda tal cual: el servidor lo convierte en «sin cargo»', async () => {
    await montar([ana]);
    api.fijarCargo.mockResolvedValue({ ...ana, cargo: null });

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: '' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });

    await waitFor(() => expect(api.fijarCargo).toHaveBeenCalledWith('e1', ''));
  });

  it('Esc cancela sin llamar al servidor', async () => {
    await montar([ana]);
    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Otra cosa' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Escape' });

    expect(sinCampo('Ana Pérez')).toBeNull();
    expect(screen.getByText('Analista')).toBeTruthy();
    expect(api.fijarCargo).not.toHaveBeenCalled();
  });

  it('Cancelar cierra sin guardar', async () => {
    await montar([ana]);
    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(sinCampo('Ana Pérez')).toBeNull();
    expect(api.fijarCargo).not.toHaveBeenCalled();
  });

  it('una fila a la vez: abrir otra cierra la primera sin guardarla', async () => {
    await montar([ana, luis]);
    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'A medias' } });
    fireEvent.click(lapiz('Luis Gómez'));

    expect(sinCampo('Ana Pérez')).toBeNull();
    expect(campo('Luis Gómez').value).toBe('');
    expect(api.fijarCargo).not.toHaveBeenCalled();
  });

  it('si falla, enseña el error y deja la edición abierta con lo tecleado', async () => {
    await montar([ana]);
    api.fijarCargo.mockRejectedValue(new Error('Esa ficha ya no está activa. Recarga la lista.'));

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Esa ficha ya no está activa. Recarga la lista.')).toBeTruthy());
    expect(campo('Ana Pérez').value).toBe('Jefa de taller');
    expect(api.fetchEmpleados).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/ausencias && npx vitest run src/ImportarEmpleados.test.tsx
```

Esperado: FALLA, porque no existe ningún botón con la etiqueta «Editar el cargo de …»
(`Unable to find a label with the text of: Editar el cargo de Ana Pérez`).

- [ ] **Step 3: Implementar — imports y estado**

En `apps/ausencias/src/ImportarEmpleados.tsx`:

Import de iconos (L2):

```tsx
import { AlertTriangle, CheckCircle2, Loader2, Pencil, RotateCcw, UserMinus, UserPlus } from 'lucide-react';
```

Import de la api (L3-11), añadiendo `fijarCargo`:

```tsx
import {
  fetchEmpleados,
  fetchRetirados,
  fijarCargo,
  fijarRetiro,
  reactivarEmpleado,
  sincronizarEmpleados,
  type Empleado,
  type Retirado,
} from './api';
```

Estado nuevo, justo después de `const [edicion, setEdicion] = …` (L44):

```tsx
  // La fila cuyo cargo se está editando y lo que lleva tecleado. Aparte de
  // `edicion` (la baja): son dos celdas distintas de la misma fila, y mezclarlas
  // obligaría a distinguir en cada render qué se está editando. Una sola fila a
  // la vez, por lo mismo que la baja.
  const [edicionCargo, setEdicionCargo] = useState<{ id: string; texto: string } | null>(null);
```

- [ ] **Step 4: Implementar — la función que guarda**

Justo después de `deshacerBaja` (~L134):

```tsx
  // Manda el texto tal cual: el recorte y el «vacío = sin cargo» los decide el
  // servidor, que es quien tiene la regla entera (`normalizarCargo`). Si falla,
  // la edición se queda abierta con lo tecleado para poder corregirlo.
  async function guardarCargo(e: Empleado, texto: string) {
    setGuardando(e.id);
    setError(null);
    setExito(null);
    try {
      await fijarCargo(e.id, texto);
      setEdicionCargo(null);
      setExito(`Cargo de ${e.nombreCompleto} actualizado.`);
      setRecarga((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(null);
    }
  }
```

- [ ] **Step 5: Implementar — la celda**

Sustituir la celda del cargo (L223):

```tsx
                      <td className="px-4 py-2.5 text-gray-600">{e.cargo ?? '—'}</td>
```

por:

```tsx
                      <td className="px-4 py-2.5 text-gray-600">
                        {edicionCargo?.id === e.id ? (
                          <div className="flex items-center gap-2">
                            {/* maxLength es solo ayuda: el tope de verdad lo
                                pone el servidor, contando como VARCHAR(255). */}
                            <input
                              type="text"
                              autoFocus
                              maxLength={255}
                              value={edicionCargo.texto}
                              onChange={(ev) => setEdicionCargo({ id: e.id, texto: ev.target.value })}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter' && guardando !== e.id) void guardarCargo(e, edicionCargo.texto);
                                if (ev.key === 'Escape') setEdicionCargo(null);
                              }}
                              aria-label={`Cargo de ${e.nombreCompleto}`}
                              className="w-48 rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={guardando === e.id}
                              onClick={() => void guardarCargo(e, edicionCargo.texto)}
                              className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                            >
                              {guardando === e.id ? 'Guardando…' : 'Guardar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEdicionCargo(null)}
                              className="rounded-xl px-2 py-1.5 text-sm text-gray-600 hover:underline"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span>{e.cargo ?? '—'}</span>
                            <button
                              type="button"
                              onClick={() => setEdicionCargo({ id: e.id, texto: e.cargo ?? '' })}
                              aria-label={`Editar el cargo de ${e.nombreCompleto}`}
                              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
```

- [ ] **Step 6: Ver que pasa**

```bash
cd apps/ausencias && npx vitest run src/ImportarEmpleados.test.tsx
```

Esperado: 9 tests en verde.

- [ ] **Step 7: Portón del front**

```bash
cd apps/ausencias && npm run typecheck
cd apps/ausencias && npm test
cd apps/ausencias && npm run build
```

Esperado: typecheck sin errores; todos los tests en verde (65 anteriores + 15 nuevos = 80); build
correcto.

- [ ] **Step 8: Commit**

```bash
git add apps/ausencias/src/ImportarEmpleados.tsx apps/ausencias/src/ImportarEmpleados.test.tsx
git commit -m "feat(ausencias): editar el cargo desde la pestana Empleados"
```

---

### Task 6: verificación final (la hace el controlador, no un implementador)

- [ ] **Step 1: Mutaciones.** Cada una se aplica con Edit, se lanza el test indicado, se comprueba
  que cae, y se revierte con Edit. **Nunca con `sed`, `Set-Content` ni `perl`.**

| # | Mutación | Debe caer |
|---|---|---|
| 1 | Quitar `AND activo` de `repo.fijarCargo` | `repo.cargo.db.test.ts` «una ficha inactiva» |
| 2 | Quitar `.trim()` en `normalizarCargo` | `cargo.test.ts` «recorta…» |
| 3 | `[...cargo].length` → `cargo.length` | `cargo.test.ts` «un emoji cuenta como UN carácter» |
| 4 | Quitar `CONTROL.test(cargo) \|\|` | `cargo.test.ts` «carácter de control» |
| 5 | `if (!cargo) return null;` → borrar la línea | `cargo.test.ts` «vacío o solo espacios» |
| 6 | Quitar `requireAdmin` de la ruta | `router.test.ts` «403 a quien no es admin» |
| 7 | En el doble, quitar `&& x.activo !== false` | `router.test.ts` «404 si la ficha esta inactiva» |
| 8 | En `errorDeCargo`, quitar `&& cuerpo?.error === 'empleado_no_encontrado'` | `organigrama.test.ts` «un 404 SIN ese código» |
| 9 | Quitar el `onKeyDown` del `<input>` | `ImportarEmpleados.test.tsx` «Enter guarda…» y «Esc cancela…» |
| 10 | Mover `setEdicionCargo(null)` al `finally` | `ImportarEmpleados.test.tsx` «si falla…» |

Si alguna NO cae, el test correspondiente no protege nada: se arregla el test antes de seguir.

- [ ] **Step 2: Baterías completas de hub-api**

```bash
cd apps/hub-api && npx vitest run --coverage --exclude "scripts/**"
cd apps/hub-api && npm run test:db
```

Esperado: todo en verde y umbrales de cobertura cumplidos. Referencia antes de este cambio: 3678
unitarios y 865 de BD.

- [ ] **Step 3: Portón del front** (los mismos comandos que la Task 5, Step 7).

- [ ] **Step 4: Privacidad, en un comando APARTE y leyendo el resultado antes de mezclar**

```bash
git diff main --stat
git diff main | grep -niE "@[a-z0-9.-]+\.(com|co)\b" | grep -viE "ambientalia\.com\.co|ejemplo\.test"
```

Esperado: el segundo comando no imprime nada. Los correos de `@ambientalia.com.co` que aparezcan
deben ser los ficticios de los tests (`ana.ruiz@`, `jefe1@`); revisarlos a ojo.

- [ ] **Step 5: Merge y push**

```bash
git checkout main
git merge --no-ff feat/cargo-editable -m "merge: cargo editable desde la pestana Empleados"
git push origin main
```

- [ ] **Step 6: Despliegue (lo hace el usuario a mano en EasyPanel):** hub-api primero y el portal
  después. Sin migración.
