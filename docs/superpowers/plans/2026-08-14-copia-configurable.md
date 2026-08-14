# Copia configurable por persona — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que quien recibe copia de los correos de una persona se configure desde el organigrama, ficha por ficha, en vez de estar escrito en `config.ts` para toda la empresa.

**Architecture:** Una columna `copia_correo` en `portal.empleados`, sembrada con `administrativo@ambientalia.com.co` vía `DEFAULT` (sin `UPDATE`, que se repetiría en cada arranque). `COPIA_ADMINISTRACION` desaparece y los dos correos que la usaban leen `copiaCorreo` de la solicitud, que llega gratis porque `SELECT_SOLICITUD` ya hace `JOIN portal.empleados`. Un endpoint nuevo y una tercera columna en la pestaña Organigrama.

**Tech Stack:** Express 4 + TypeScript ESM (NodeNext, imports con `.js`), Vitest + supertest, PostgreSQL con SQL crudo, React 19 + Tailwind 3.

**Spec:** `docs/superpowers/specs/2026-08-14-copia-configurable-design.md`

**Rama:** `feat/copia-configurable` (ya creada, con la spec commiteada en `f308e5a`).

---

## Contexto que el ejecutor necesita antes de empezar

- **Shell: PowerShell 5.1. NO existe `&&`**; se encadena con `;`. Pierde el directorio de trabajo entre llamadas: **cada comando empieza con** `Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"`.
- **Los tres portones**, en orden: `npm run build --workspace=apps/hub-api`, `npm run test --workspace=apps/hub-api`, `npm run build --workspace=apps/portal`. Vitest transpila con esbuild y **no comprueba tipos**: build y test son portones distintos.
- `apps/ausencias` solo corre `vite build`, **sin `tsc`**. Lo type-checkea el build del portal, que arrastra la app por el import lazy de su ruta.
- **Migraciones:** solo DDL, idempotentes, **se re-ejecutan en cada arranque**, y hay que añadirlas **a mano** al array `MIGRATIONS` de `apps/hub-api/src/db.ts`. Olvidarlo no da ningún error: la migración simplemente no corre.
- **Nunca un `UPDATE` en una migración de este repo.** Se re-ejecutaría en cada despliegue. Está documentado en `018_ausencias_cascada.sql`, que explica por qué no hace backfill.
- **Commits:** `git commit -m "..." -- ruta1 ruta2`. **Nunca `git add -A`** (hay un `apps/WO-sales/prompts/` sin trackear que es ajeno). Para ficheros nuevos, `git add -- ruta` antes.
- **Idioma:** código, comentarios y commits en español. Los comentarios explican **por qué**.
- **Flake ajeno:** `users.service.test.ts > property tests > 4.5` falla ~1 de cada 5 (fast-check). Si falla **ese**, reejecutar. Cualquier otro fallo es real.
- **Cuidado con los backticks dentro de un SQL en template literal**: ha roto el build más de una vez.

## Estructura de ficheros

| Fichero | Responsabilidad | Acción |
|---|---|---|
| `apps/hub-api/src/users/migrations/021_ausencias_copia.sql` | La columna, sembrada por `DEFAULT` | Crear |
| `apps/hub-api/src/db.ts` | Registrar la 021 en `MIGRATIONS` | Modificar |
| `apps/hub-api/src/ausencias/types.ts` | `copiaCorreo` en `Empleado` y en `Solicitud` | Modificar |
| `apps/hub-api/src/ausencias/repo.ts` | Columna en los dos SELECT, mapeos y `fijarCopia` | Modificar |
| `apps/hub-api/src/ausencias/service.ts` | `fijarCopia` con su validación | Modificar |
| `apps/hub-api/src/ausencias/router.ts` | `PUT /ausencias/empleados/:id/copia` | Modificar |
| `apps/hub-api/src/ausencias/config.ts` | Retirar `COPIA_ADMINISTRACION` | Modificar |
| `apps/hub-api/src/ausencias/notificaciones.ts` | Leer la copia de la solicitud | Modificar |
| `apps/ausencias/src/api.ts` | `copiaCorreo` en los tipos + `fijarCopia` | Modificar |
| `apps/ausencias/src/PanelOrganigrama.tsx` | Tercera columna y el aviso de privacidad | Modificar |
| `docs/dev/app-ausencias.md` | Documentación viva | Modificar |

---

### Task 1: La columna y el dato

**Files:**
- Create: `apps/hub-api/src/users/migrations/021_ausencias_copia.sql`
- Modify: `apps/hub-api/src/db.ts:24` (array `MIGRATIONS`)
- Modify: `apps/hub-api/src/ausencias/types.ts` (interface `Empleado`, sobre la línea 100)
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`COLS_EMPLEADO`, `FilaEmpleadoDb`, `aEmpleado` sobre la línea 56)

- [ ] **Step 1: Escribir la migración**

`apps/hub-api/src/users/migrations/021_ausencias_copia.sql`:

```sql
-- Migration 021: a quién se pone en copia, ficha por ficha.
--
-- Hasta ahora la copia era una constante para toda la empresa
-- (`COPIA_ADMINISTRACION` en config.ts, con `comercial@` y `administrativo@`).
-- Cambiarla exigía tocar código y desplegar, y era la misma para todo el mundo.
--
-- NULL = sin copia.
--
-- El DEFAULT es lo que hace el sembrado, y por eso NO hay ningún UPDATE aquí:
-- `initDb()` re-ejecuta esta migración en cada arranque, así que un UPDATE
-- volvería a poner `administrativo@` en cada despliegue y machacaría las copias
-- que se hubieran ajustado a mano desde el panel. `ADD COLUMN ... DEFAULT`
-- rellena las filas existentes UNA vez; a partir de ahí el IF NOT EXISTS hace
-- que esto no toque nada.
--
-- El DEFAULT se queda después del relleno, a propósito: `asegurarEmpleado` crea
-- fichas solas en el primer acceso de cada persona, y así ninguna nace sin copia
-- por descuido. Quitarla es una edición explícita desde el organigrama.
--
-- Aditiva y sin destruir nada: revertir el build no obliga a tocar la base, al
-- contrario que la 020.

CREATE SCHEMA IF NOT EXISTS portal;

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS copia_correo VARCHAR(254) DEFAULT 'administrativo@ambientalia.com.co';
```

- [ ] **Step 2: Registrar la migración**

En `apps/hub-api/src/db.ts`, añadir `'021_ausencias_copia.sql'` como último elemento del array `MIGRATIONS`. **Sin esto la migración no corre y nada avisa.**

- [ ] **Step 3: Añadir el campo al tipo `Empleado`**

En `apps/hub-api/src/ausencias/types.ts`, dentro de `export interface Empleado`, después de `aprobadorCorreo`:

```ts
  /** A quién se pone en copia de sus correos. `null` = a nadie. */
  copiaCorreo: string | null;
```

- [ ] **Step 4: Traer la columna en el repo**

En `apps/hub-api/src/ausencias/repo.ts`:

1. Añadir `copia_correo` a la constante `COLS_EMPLEADO` (la usa `listarEmpleados` y las demás consultas de empleado).
2. Añadir `copia_correo: string | null;` a la interfaz `FilaEmpleadoDb`.
3. En `aEmpleado`, después de `aprobadorCorreo: r.aprobador_correo,`:

```ts
    copiaCorreo: r.copia_correo,
```

- [ ] **Step 5: Añadir el UPDATE del repo**

En `apps/hub-api/src/ausencias/repo.ts`, justo después de `fijarJefe` (sobre la línea 416):

```ts
/**
 * Fija (o quita, con `null`) la copia de un empleado. Devuelve false si no
 * existía o estaba inactivo, igual que `fijarJefe`.
 */
export async function fijarCopia(db: Pool, empleadoId: string, copiaCorreo: string | null): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados SET copia_correo = lower($2) WHERE id = $1 AND activo`,
    [empleadoId, copiaCorreo],
  );
  return (rowCount ?? 0) > 0;
}
```

`lower()` sobre `null` devuelve `null`, así que el caso «sin copia» no necesita rama aparte.

- [ ] **Step 6: Comprobar que compila**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api
```

Esperado: **falla**, con errores de tipo en los sitios que construyen un `Empleado` sin `copiaCorreo` (los dobles de los tests, entre otros). Anótalos: se arreglan en el paso siguiente.

- [ ] **Step 7: Arreglar los constructores de `Empleado`**

Añade `copiaCorreo: null` a cada objeto que el compilador señale. Son dobles de test y fixtures; `null` es el valor correcto para todos salvo que el test hable específicamente de copias.

Vuelve a construir hasta que salga limpio:

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build limpio y **556 tests** en verde (los que ya había).

- [ ] **Step 8: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git add -- apps/hub-api/src/users/migrations/021_ausencias_copia.sql; git commit -m "feat(ausencias): columna copia_correo, sembrada con administracion" -- apps/hub-api/src/users/migrations/021_ausencias_copia.sql apps/hub-api/src/db.ts apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts
```

---

### Task 2: El endpoint que la configura

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (junto a `fijarJefe`, sobre la línea 554)
- Modify: `apps/hub-api/src/ausencias/router.ts` (junto a `PUT /ausencias/empleados/:id/jefe`, sobre la línea 219)
- Test: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `router.test.ts`, como bloque nuevo. El doble del repo ya expone `estado.plantilla`; añade `fijarCopia` al `vi.mock('./repo.js', …)` **junto a `fijarJefe`**, con esta implementación:

```ts
  fijarCopia: async (_db: unknown, empleadoId: string, copia: string | null) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId);
    if (!e) return false;
    e.copiaCorreo = copia;
    return true;
  },
```

Y el bloque de tests:

```ts
describe('PUT /ausencias/empleados/:id/copia', () => {
  it('un admin fija la copia de alguien', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: 'ana.ruiz@ambientalia.com.co' })
      .expect(200);
    expect(r.body).toMatchObject({ id: E1, copiaCorreo: 'ana.ruiz@ambientalia.com.co' });
  });

  it('acepta `null` para dejar a alguien sin copia', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: null })
      .expect(200);
    expect(r.body).toHaveProperty('copiaCorreo', null);
  });

  it('400 si el correo no es de nadie de la plantilla', async () => {
    // Se valida contra los empleados ACTIVOS y no solo el formato: una errata
    // mandaría los avisos al vacío sin que nadie se enterara nunca.
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ copiaCorreo: 'nadie@ambientalia.com.co' })
      .expect(400);
  });

  it('403 a quien no es admin', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/copia`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ copiaCorreo: 'ana.ruiz@ambientalia.com.co' })
      .expect(403);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que fallan**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router.test.ts -t "copia"
```

Esperado: **FAIL** — 404 en vez de 200/400/403, porque la ruta no existe.

- [ ] **Step 3: El servicio**

En `apps/hub-api/src/ausencias/service.ts`, justo después de `fijarJefe`:

```ts
/**
 * Fija a quién se pone en copia de los correos de alguien. `null` = a nadie.
 *
 * Se valida contra los empleados ACTIVOS, no solo el formato del correo: el
 * desplegable del panel solo ofrece personas de la plantilla, y aceptar aquí
 * cualquier cosa dejaría entrar erratas que mandarían los avisos al vacío sin
 * que nadie se enterara. No hay comprobación de ciclos, a diferencia del jefe:
 * esto no es un árbol y estar en copia no da ningún permiso.
 */
export async function fijarCopia(db: Pool, empleadoId: string, body: unknown): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const bruto = b.copiaCorreo;
  if (bruto !== null && typeof bruto !== 'string') {
    throw new AusenciaError('copia_invalida', 400, 'copiaCorreo');
  }

  const copia = typeof bruto === 'string' && bruto.trim() ? bruto.trim().toLowerCase() : null;
  if (copia !== null) {
    const enlaces = await repo.enlacesActivos(db);
    if (!enlaces.some((e) => e.correo === copia)) {
      throw new AusenciaError('copia_no_encontrada', 400, 'copiaCorreo');
    }
  }

  if (!(await repo.fijarCopia(db, empleadoId, copia))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}
```

Una cadena vacía se trata como `null` a propósito: es lo que manda un `<select>` cuya opción «— sin copia» tiene `value=""`.

- [ ] **Step 4: La ruta**

En `apps/hub-api/src/ausencias/router.ts`, justo después del bloque de `PUT /ausencias/empleados/:id/jefe`:

```ts
  /**
   * Cambia a quién se pone en copia de los correos de alguien. No manda ningún
   * correo, igual que cambiar el jefe o fijar el saldo: configurar no es decidir
   * nada sobre una solicitud.
   *
   * Al contrario que los firmantes, la copia NO se congela en el alta: se lee al
   * notificar, así que este cambio afecta también a las solicitudes que ya estén
   * en trámite. Es lo que se quiere — corregir una copia mal puesta tiene que
   * arreglar lo que aún no ha salido.
   */
  router.put('/ausencias/empleados/:id/copia', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarCopia(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_copia');
    }
  });
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router.test.ts -t "copia"
```

Esperado: **4 passed**.

- [ ] **Step 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): endpoint para fijar la copia de una persona" -- apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

### Task 3: Los correos leen la copia de la ficha

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts` (interface `Solicitud`, sobre la línea 118)
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`SELECT_SOLICITUD` línea 604, `FilaSolicitudDb`, `aSolicitud`)
- Modify: `apps/hub-api/src/ausencias/config.ts` (retirar `COPIA_ADMINISTRACION`, línea 15)
- Modify: `apps/hub-api/src/ausencias/notificaciones.ts` (líneas 67 y 173)
- Test: `apps/hub-api/src/ausencias/notificaciones.test.ts`

- [ ] **Step 1: Poner el helper al día y escribir los tests que fallan**

Primero, en `notificaciones.test.ts`, el helper `solicitud(over)` (línea 6) necesita el campo nuevo. Dale como valor por defecto **la copia sembrada**, no `null`:

```ts
    copiaCorreo: 'administrativo@ambientalia.com.co',
```

Es deliberado: la migración 021 deja a toda la plantilla con ese valor, así que un helper con `null` describiría un estado que en producción no existe. Y así **el test de la línea 75** —«el correo de aprobado va también a administración, sin repetir al aprobador», que espera literalmente `'ana.ruiz@…, comercial@…, administrativo@…'`— sigue pasando sin tocarlo, porque el destinatario llega ahora por la ficha en vez de por la constante. Que ese test siga verde con el modelo nuevo es exactamente la prueba de que el reemplazo es equivalente.

Ahora los tests nuevos. `construirPayload(solicitud(over), evento)` es la función que usa este fichero.

```ts
describe('la copia sale de la ficha del empleado', () => {
  it('entra en el correo de aprobada', () => {
    const p = construirPayload(solicitud({ estado: 'aprobada', copiaCorreo: 'copia@ambientalia.com.co' }), 'aprobada');
    expect(p.correo.para).toContain('copia@ambientalia.com.co');
  });

  it('entra en el correo de rechazada', () => {
    const p = construirPayload(solicitud({ estado: 'rechazada', copiaCorreo: 'copia@ambientalia.com.co' }), 'rechazada');
    expect(p.correo.para).toContain('copia@ambientalia.com.co');
  });

  it('entra en el acuse de una incapacidad', () => {
    const p = construirPayload(solicitud({ tipo: 'incapacidad', copiaCorreo: 'copia@ambientalia.com.co' }), 'registrada');
    expect(p.correo.para).toContain('copia@ambientalia.com.co');
  });

  it('NO entra en el acuse de una solicitud normal', () => {
    // Este test existe para que la copia no se convierta en una ampliación
    // silenciosa: el acuse de vacaciones nunca ha llevado copia y no debe
    // empezar a llevarla ahora.
    const p = construirPayload(solicitud({ tipo: 'vacaciones', copiaCorreo: 'copia@ambientalia.com.co' }), 'creada');
    expect(p.correo.para).not.toContain('copia@ambientalia.com.co');
  });

  it('NO entra en el aviso al aprobador', () => {
    const p = construirPayload(solicitud({ copiaCorreo: 'copia@ambientalia.com.co' }), 'aprobacion');
    expect(p.correo.para).not.toContain('copia@ambientalia.com.co');
  });

  it('con `copiaCorreo: null` no deja un destinatario vacío', () => {
    // `destinatarios()` filtra nulos; sin eso saldría una coma suelta en el
    // `sendTo` de Gmail, que es un correo a nadie con pinta de correo válido.
    const p = construirPayload(solicitud({ estado: 'aprobada', copiaCorreo: null }), 'aprobada');
    expect(p.correo.para).not.toMatch(/,\s*,|,\s*$/);
  });

  it('una copia que ya firma no se duplica', () => {
    const s = solicitud({ estado: 'aprobada', aprobadorCorreo: 'jefe@ambientalia.com.co', copiaCorreo: 'jefe@ambientalia.com.co' });
    const p = payloadDe(s, 'aprobada');
    expect(p.correo.para.match(/jefe@ambientalia\.com\.co/g)).toHaveLength(1);
  });
});
```

Los helpers `solicitud()` y `construirPayload()` ya existen en ese fichero, no hay que crearlos.

- [ ] **Step 2: Ejecutar y verificar que fallan**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- notificaciones.test.ts -t "la copia sale de la ficha"
```

Esperado: **FAIL** — los tres primeros porque la copia no llega al correo.

- [ ] **Step 3: El campo en `Solicitud`**

En `types.ts`, dentro de `export interface Solicitud`:

```ts
  /**
   * A quién se pone en copia, leído de la ficha del empleado AL CONSULTAR, no
   * congelado en el alta como los dos firmantes. La diferencia es deliberada: un
   * firmante decide quién PUEDE decidir —un permiso—, y la copia solo decide a
   * quién se avisa. Congelarla haría que corregir una copia mal puesta no
   * arreglara ninguna solicitud en curso.
   */
  copiaCorreo: string | null;
```

- [ ] **Step 4: Traerlo en el SELECT**

En `repo.ts`, en `SELECT_SOLICITUD`, añadir a la lista de columnas (el `JOIN portal.empleados e` ya existe):

```sql
         e.copia_correo,
```

Añadir `copia_correo: string | null;` a `FilaSolicitudDb`, y en `aSolicitud`:

```ts
    copiaCorreo: r.copia_correo,
```

- [ ] **Step 5: Retirar la constante y usar la copia**

En `config.ts`, **borrar** `COPIA_ADMINISTRACION` y dejar en su lugar:

```ts
// Aquí vivía `COPIA_ADMINISTRACION`, con `comercial@` y `administrativo@` fijos
// para toda la empresa. La copia es ahora un campo de la ficha del empleado
// (`portal.empleados.copia_correo`, migración 021), editable desde la pestaña
// Organigrama. `comercial@` no se pierde de esos correos: es primer o segundo
// firmante de toda la plantilla y sigue llegando por `cadenaDeDecision`.
```

En `notificaciones.ts`, quitar `COPIA_ADMINISTRACION` del import y cambiar los dos usos:

Línea 67 (acuse de incapacidad) — de `[s.solicitanteEmail, ...COPIA_ADMINISTRACION].join(', ')` a:

```ts
    para: esInc ? destinatarios(s.solicitanteEmail, s.copiaCorreo) : s.solicitanteEmail,
```

Ojo: pasa a usar `destinatarios()` en vez de `join(', ')`, para heredar el deduplicado y el filtrado de nulos. `destinatarios` está declarada más abajo en el fichero, pero es una `function`, así que hoista.

Línea 173 (`cadenaDeDecision`) — de `...COPIA_ADMINISTRACION` a `s.copiaCorreo`:

```ts
const cadenaDeDecision = (s: Solicitud) =>
  destinatarios(s.solicitanteEmail, s.aprobadorCorreo, s.segundoAprobadorCorreo, s.copiaCorreo);
```

- [ ] **Step 6: Ejecutar los dos portones de hub-api**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build limpio y **563 tests** (556 + 7 nuevos). Si algún test viejo falla porque esperaba `administrativo@` en un destinatario, **no lo borres**: actualízalo para que refleje la copia de la ficha, y si el test dejó de tener sentido, sustitúyelo por uno que cubra lo mismo con el modelo nuevo.

- [ ] **Step 7: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): la copia de los correos sale de la ficha, no de una constante" -- apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/config.ts apps/hub-api/src/ausencias/notificaciones.ts apps/hub-api/src/ausencias/notificaciones.test.ts
```

---

### Task 4: La columna en el organigrama

**Files:**
- Modify: `apps/ausencias/src/api.ts` (interfaces `Empleado` y `Solicitud`; nueva `fijarCopia`)
- Modify: `apps/ausencias/src/PanelOrganigrama.tsx`

- [ ] **Step 1: El espejo de tipos**

`apps/ausencias/src/api.ts` es un espejo **manual** de `types.ts`. En `export interface Empleado`, tras `aprobadorCorreo`:

```ts
  /** A quién se pone en copia de sus correos. `null` = a nadie. */
  copiaCorreo: string | null;
```

En `export interface Solicitud`, tras `segundoAprobadorCorreo`:

```ts
  /** Leído de la ficha al consultar, no congelado en el alta. */
  copiaCorreo: string | null;
```

Y junto a la función que llama a `/jefe`, la nueva:

```ts
/** Fija a quién se pone en copia. `null` = sin copia. */
export const fijarCopia = (id: string, copiaCorreo: string | null) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/copia`, { copiaCorreo });
```

- [ ] **Step 2: El aviso de privacidad**

En `PanelOrganigrama.tsx`, tras el segundo párrafo explicativo (el que empieza «Cambiar el organigrama **no mueve**…»):

```tsx
      <p className="mb-4 flex max-w-3xl items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          Quien esté en <b>copia</b> recibirá también los acuses de <b>incapacidad</b> de esa persona, que son
          información de salud. Ponlo solo si esa persona debe conocerla. Estar en copia no da acceso a abrir los
          soportes en PDF: eso se controla aparte.
        </span>
      </p>
```

`AlertTriangle` ya está importado en ese fichero.

- [ ] **Step 3: La columna**

En la cabecera de la tabla, entre «2ª firma» y la columna vacía del botón:

```tsx
                <th className="px-4 py-3 font-medium">Copia</th>
```

En el cuerpo, tras la celda de «2ª firma»:

```tsx
                    <td className="px-4 py-2.5">
                      <select
                        value={fila.copiaCorreo ?? ''}
                        onChange={(ev) => actualizar(e.id, { copiaCorreo: ev.target.value || null, error: null })}
                        aria-label={`Copia de ${e.nombreCompleto}`}
                        className="rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">— sin copia</option>
                        {/* El propio empleado sale en su lista: ponerse a uno mismo
                            es inofensivo porque el servidor deduplica los
                            destinatarios, y excluirlo sería una regla más que
                            explicar por un caso que no rompe nada. */}
                        {activos.map((j) => (
                          <option key={j.id} value={j.correo}>
                            {j.nombreCompleto}
                          </option>
                        ))}
                        {/* Misma red que en el jefe: el valor guardado puede no
                            estar entre los activos (por ejemplo si esa persona se
                            dio de baja después). Sin esto el select saldría en
                            blanco y guardar borraría la copia sin pedirlo. */}
                        {fila.copiaCorreo && !activos.some((j) => j.correo === fila.copiaCorreo) && (
                          <option value={fila.copiaCorreo}>{fila.copiaCorreo}</option>
                        )}
                      </select>
                    </td>
```

- [ ] **Step 4: Guardar los dos campos**

Tres cambios en `PanelOrganigrama.tsx`.

**a)** La interfaz `Fila` gana el campo, y `filaInicial` (línea ~19) lo inicializa:

```tsx
  copiaCorreo: e.copiaCorreo,
```

**b)** `haCambiado` (línea ~165) compara **los dos** campos:

```tsx
                const haCambiado =
                  fila.aprobadorCorreo !== e.aprobadorCorreo || fila.copiaCorreo !== e.copiaCorreo;
```

**c)** `guardar` (línea ~75) manda **solo lo que cambió**. Sustituye la llamada suelta a `fijarJefe` por:

```tsx
      // Un solo botón por fila, como hasta ahora, pero dos endpoints detrás: se
      // llama a cada uno solo si su campo cambió. Secuencial y no en paralelo
      // porque los dos responden el maestro entero y el segundo tiene que ver ya
      // escrito lo del primero — con `Promise.all`, la respuesta que llegara
      // segunda podría ser la construida ANTES del otro cambio.
      const empleado = empleados.find((x) => x.id === id);
      if (fila.aprobadorCorreo !== empleado?.aprobadorCorreo) await fijarJefe(id, fila.aprobadorCorreo);
      if (fila.copiaCorreo !== empleado?.copiaCorreo) await fijarCopia(id, fila.copiaCorreo);
```

El `await cargar()` que va justo después no cambia: recarga el maestro entero, que sigue haciendo falta porque tocar un jefe mueve la 2ª firma de todos los que cuelgan de él.

Añade `fijarCopia` al import de `./api` que ya trae `fijarJefe`.

- [ ] **Step 5: Verificar con el portón del portal**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: build limpio. Es el único portón que comprueba tipos de `apps/ausencias`.

- [ ] **Step 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): columna de copia en el organigrama" -- apps/ausencias/src/api.ts apps/ausencias/src/PanelOrganigrama.tsx
```

---

### Task 5: Documentación viva

**Files:**
- Modify: `docs/dev/app-ausencias.md`

- [ ] **Step 1: El endpoint en la tabla**

Añadir bajo la fila de `PUT /api/ausencias/empleados/:id/jefe`:

```markdown
| `PUT` | `/api/ausencias/empleados/:id/copia` | `requireAdmin` — a quién se pone en copia; `null` = a nadie |
```

- [ ] **Step 2: La sección**

Añadir una sección `## La copia de los correos` (antes de `## Los adjuntos`), que recoja:

- Que la copia sale de `portal.empleados.copia_correo` (migración 021) y se edita en la pestaña *Organigrama*; `NULL` = sin copia.
- Que entra en **dos** correos y solo dos: las decisiones (aprobada/rechazada) y el acuse de incapacidad. Que el acuse normal y los avisos a los aprobadores **no** llevan copia, y que hay tests que lo fijan para que no se convierta en una ampliación silenciosa.
- Que **no se congela** en el alta, al contrario que los firmantes, y por qué: un firmante es un permiso, la copia es un aviso. Corregirla arregla también lo que está en trámite.
- Que la migración siembra con `administrativo@` mediante `DEFAULT` y **no** con un `UPDATE`, porque las migraciones se re-ejecutan en cada arranque y un `UPDATE` machacaría las ediciones en cada despliegue.
- Que `comercial@` salió de la copia fija pero no pierde correos, porque es primer o segundo firmante de toda la plantilla.
- El aviso de privacidad: quien esté en copia recibe los acuses de incapacidad, que son datos de salud. Y que **`VISORES_ADJUNTOS` no cambia**: estar en copia da el aviso, no la llave para abrir el PDF.

- [ ] **Step 3: Actualizar la lista de migraciones**

En `## Piezas`, la línea que enumera las migraciones termina en «`020` la retirada de Drive». Añadir «y `021` la copia configurable».

- [ ] **Step 4: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "docs(ausencias): la copia de los correos, configurable por ficha" -- docs/dev/app-ausencias.md
```

---

### Task 6: Cerrar la rama

- [ ] **Step 1: Los tres portones sobre el árbol completo**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api; npm run build --workspace=apps/portal
```

Esperado: los tres en verde, **563 tests**.

- [ ] **Step 2: Comprobar que no queda nada suelto**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git status --short; git log --oneline main..HEAD
```

Esperado: en `git status`, solo `?? apps/WO-sales/prompts/`. Seis commits sobre `main`: la spec y uno por cada Task 1-5.

- [ ] **Step 3: Mezclar y empujar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git checkout main; git merge --no-ff feat/copia-configurable -m "merge: la copia de los correos se configura por persona"; git push origin main
```

---

## Después del plan: despliegue

**hub-api primero, portal después.** hub-api trae la migración 021 y el endpoint; el portal trae la columna que lo llama. Al revés, el desplegable aparecería y guardar daría 404.

En el log de hub-api tiene que salir `migration applied: 021_ausencias_copia.sql`.

**Es aditiva y no destruye nada**, al contrario que la 020: si hubiera que revertir el build, la columna sobrante no molesta a nadie.

### Comprobación manual, con el código ya desplegado

1. En **Organigrama**, todas las filas muestran `administrativo@` en la columna «Copia» — el sembrado.
2. Cambiar la copia de alguien a otra persona y guardar; recargar y comprobar que persiste.
3. Dejar a alguien en «— sin copia» y guardar.
4. Con esa persona sin copia, aprobar una solicitud suya: el correo llega al solicitante y a los firmantes, y a nadie más.
5. Con otra persona con copia puesta, aprobar una suya: el correo llega también a la copia.
