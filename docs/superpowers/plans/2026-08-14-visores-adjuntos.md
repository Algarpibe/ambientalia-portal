# Visores de adjuntos configurables — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la lista de quién puede abrir cualquier soporte adjunto se gestione desde el organigrama, con registro en base de datos de quién dio o quitó ese acceso.

**Architecture:** Una columna `ve_adjuntos` en `portal.empleados` y una tabla `portal.visores_adjuntos_log`, ambas en la migración 022. `VISORES_ADJUNTOS` desaparece de `config.ts`; `puedeVerAdjunto` sigue siendo pura y recibe el booleano por parámetro, que el router resuelve contra la base. Un endpoint nuevo y una cuarta columna en la pestaña Organigrama.

**Tech Stack:** Express 4 + TypeScript ESM (NodeNext, imports con `.js`), Vitest + supertest, PostgreSQL con SQL crudo, React 19 + Tailwind 3.

**Spec:** `docs/superpowers/specs/2026-08-14-visores-adjuntos-design.md`

**Rama:** `feat/visores-configurables` (ya creada, con la spec commiteada en `8059ca1`).

---

## Contexto que el ejecutor necesita

- **Shell: PowerShell 5.1. NO existe `&&`**; se encadena con `;`. Pierde el directorio entre llamadas: **cada comando empieza con** `Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"`.
- **Los tres portones:** `npm run build --workspace=apps/hub-api`, `npm run test --workspace=apps/hub-api`, `npm run build --workspace=apps/portal`. Vitest transpila con esbuild y **no comprueba tipos**.
- `apps/ausencias` solo corre `vite build`, **sin `tsc`**. Lo type-checkea el build del portal.
- **Migraciones: solo DDL idempotente, se re-ejecutan en CADA arranque**, y hay que añadirlas **a mano** al array `MIGRATIONS` de `apps/hub-api/src/db.ts`. Olvidarlo no da error: no corre y nadie se entera.
- **`initDb()` no captura errores.** Si la migración lanza, hub-api no arranca y se cae el portal entero.
- **Commits:** `git commit -m "..." -- rutas`. **Nunca `git add -A`** (hay un `apps/WO-sales/prompts/` ajeno). Para ficheros nuevos, `git add -- ruta` antes.
- **Idioma:** código, comentarios y commits en español; los comentarios explican **por qué**.
- **Flake ajeno:** `users.service.test.ts > property tests > 4.5` falla ~1 de cada 5. Si falla **ese**, reejecutar.
- **Base de tests al empezar: 571.**

## Estructura de ficheros

| Fichero | Responsabilidad | Acción |
|---|---|---|
| `apps/hub-api/src/users/migrations/022_ausencias_visores.sql` | Columna + tabla de registro + sembrado | Crear |
| `apps/hub-api/src/db.ts` | Registrar la 022 | Modificar |
| `apps/hub-api/src/ausencias/types.ts` | `veAdjuntos` en `Empleado` | Modificar |
| `apps/hub-api/src/ausencias/repo.ts` | Columna en el SELECT, `esVisorDeAdjuntos`, `fijarVisor`, `registrarCambioVisor` | Modificar |
| `apps/hub-api/src/ausencias/config.ts` | Retirar `VISORES_ADJUNTOS` | Modificar |
| `apps/hub-api/src/ausencias/service.ts` | `puedeVerAdjunto` con parámetro, `fijarVisor` | Modificar |
| `apps/hub-api/src/ausencias/router.ts` | Los tres sitios + endpoint nuevo | Modificar |
| `apps/ausencias/src/api.ts` | Espejo de tipos + `fijarVisor` | Modificar |
| `apps/ausencias/src/PanelOrganigrama.tsx` | Cuarta columna y aviso | Modificar |
| `docs/dev/app-ausencias.md` | Documentación viva | Modificar |

---

### Task 1: La migración y el acceso al dato

**Files:**
- Create: `apps/hub-api/src/users/migrations/022_ausencias_visores.sql`
- Modify: `apps/hub-api/src/db.ts:24`
- Modify: `apps/hub-api/src/ausencias/types.ts` (interface `Empleado`)
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`COLS_EMPLEADO` línea 41, `FilaEmpleadoDb`, `aEmpleado` línea 56, y tres funciones nuevas)

- [ ] **Step 1: La migración**

```sql
-- Migration 022: quién puede abrir CUALQUIER soporte, ficha por ficha.
--
-- Hasta ahora era la constante `VISORES_ADJUNTOS` de config.ts, con dos correos.
-- Añadir a alguien exigía tocar código y desplegar.
--
-- ⚠️ Esto es una llave maestra, y lo que abre incluye el soporte médico de las
-- incapacidades ajenas: dato de salud, con lo que implica la Ley 1581. La lista
-- tiene que quedarse corta y cada persona estar justificada.
--
-- El sembrado NO se puede hacer con un DEFAULT como en la 021, porque aquí el
-- valor no es el mismo para todos: solo dos correos arrancan en TRUE. Y un
-- UPDATE suelto está prohibido, porque `initDb()` re-ejecuta esto en cada
-- arranque y devolvería la llave a quien se la hubieran quitado. La salida es
-- condicionarlo a que la columna ACABE de crearse: en los arranques siguientes
-- ya existe, no se entra en el IF y nada se toca.
--
-- El UPDATE va dentro de un EXECUTE a propósito: una sentencia estática en
-- plpgsql se analiza contra el catálogo, y esta referencia una columna creada
-- dos líneas más arriba en el mismo bloque. EXECUTE difiere el análisis hasta
-- ejecutarla. Si fallara, la migración lanza, hub-api no arranca y se cae el
-- portal entero.

CREATE SCHEMA IF NOT EXISTS portal;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'portal' AND table_name = 'empleados'
                    AND column_name = 've_adjuntos') THEN
    ALTER TABLE portal.empleados ADD COLUMN ve_adjuntos BOOLEAN NOT NULL DEFAULT FALSE;
    EXECUTE $upd$
      UPDATE portal.empleados SET ve_adjuntos = TRUE
       WHERE lower(correo) IN ('comercial@ambientalia.com.co', 'administrativo@ambientalia.com.co')
    $upd$;
  END IF;
END $$;

-- El registro de quién dio o quitó la llave. En BD y no por stdout como el
-- AuditLogger de usuarios: al salir la lista del código, git deja de ser el
-- historial de estos accesos, y los logs de EasyPanel se rotan.
--
-- Guarda el correo ADEMÁS del id, y sin clave foránea: si la ficha se borra, el
-- registro tiene que seguir diciendo a quién se le dio la llave. Un registro de
-- auditoría que desaparece con su sujeto no es un registro de auditoría.
CREATE TABLE IF NOT EXISTS portal.visores_adjuntos_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_email     VARCHAR(254) NOT NULL,
  empleado_id     UUID         NOT NULL,
  empleado_correo VARCHAR(254) NOT NULL,
  concedido       BOOLEAN      NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Registrarla**

En `apps/hub-api/src/db.ts`, añadir `'022_ausencias_visores.sql'` como último elemento del array `MIGRATIONS`. **Sin esto no corre y nada avisa.**

- [ ] **Step 3: El campo en `Empleado`**

En `types.ts`, dentro de `export interface Empleado`, tras `copiaCorreo`:

```ts
  /** Puede abrir CUALQUIER adjunto de CUALQUIER persona. Llave maestra. */
  veAdjuntos: boolean;
```

- [ ] **Step 4: El repo**

En `repo.ts`:

1. Añadir `ve_adjuntos` a `COLS_EMPLEADO` (línea 41).
2. Añadir `ve_adjuntos: boolean;` a `FilaEmpleadoDb`.
3. En `aEmpleado`, tras `copiaCorreo: r.copia_correo,`: `veAdjuntos: r.ve_adjuntos,`
4. Tres funciones nuevas, junto a `fijarCopia`:

```ts
/**
 * Si ese correo tiene la llave maestra de los adjuntos.
 *
 * Consulta por correo y no por id porque quien pregunta es una sesión, y una
 * sesión puede no tener ficha de empleado — en ese caso no es visor, que es la
 * respuesta correcta.
 */
export async function esVisorDeAdjuntos(db: Pool, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM portal.empleados WHERE lower(correo) = lower($1) AND activo AND ve_adjuntos`,
    [email],
  );
  return rows.length > 0;
}

/** Da o quita la llave. False si no existía o estaba inactivo. */
export async function fijarVisor(db: Pool, empleadoId: string, veAdjuntos: boolean): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados SET ve_adjuntos = $2 WHERE id = $1 AND activo`,
    [empleadoId, veAdjuntos],
  );
  return (rowCount ?? 0) > 0;
}

/** Deja constancia del cambio. Ver el porqué en la migración 022. */
export async function registrarCambioVisor(
  db: Pool,
  e: { adminEmail: string; empleadoId: string; empleadoCorreo: string; concedido: boolean },
): Promise<void> {
  await db.query(
    `INSERT INTO portal.visores_adjuntos_log (admin_email, empleado_id, empleado_correo, concedido)
     VALUES (lower($1), $2, lower($3), $4)`,
    [e.adminEmail, e.empleadoId, e.empleadoCorreo, e.concedido],
  );
}
```

- [ ] **Step 5: Compilar y arreglar los constructores de `Empleado`**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api
```

Esperado: **falla** en los sitios que construyen un `Empleado` sin `veAdjuntos`. Añade `veAdjuntos: false` a cada uno que el compilador señale (son dobles de test; `false` es el valor neutro). Repite hasta que salga limpio, y pasa también los tests:

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build limpio y **571 tests** (esta tarea no añade tests).

- [ ] **Step 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git add -- apps/hub-api/src/users/migrations/022_ausencias_visores.sql; git commit -m "feat(ausencias): la llave de los adjuntos pasa a la ficha, con registro" -- apps/hub-api/src/users/migrations/022_ausencias_visores.sql apps/hub-api/src/db.ts apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts
```

Añade a las rutas del commit los ficheros de test que hayas tenido que tocar en el Step 5.

---

### Task 2: El permiso sale de la base, y la regla sigue siendo pura

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (`esVisorDeAdjuntos` línea 333, `puedeVerAdjunto` línea 346, `solicitudesConAdjunto` línea 267)
- Modify: `apps/hub-api/src/ausencias/config.ts` (retirar `VISORES_ADJUNTOS`)
- Modify: `apps/hub-api/src/ausencias/router.ts` (líneas 101 y 187)
- Test: `apps/hub-api/src/ausencias/service.test.ts`

- [ ] **Step 1: Los tests que fallan**

En `service.test.ts`, en el `describe('permisos', …)` que ya existe, sustituye los tests que hoy usan la constante y añade estos. Lee antes ese bloque: hay tests que dan por visor a `comercial@`/`administrativo@` y ahora tienen que pasar el booleano.

```ts
  it('el visor puede abrir cualquier adjunto', () => {
    // El booleano entra por parámetro y no se consulta aquí: así la regla se
    // puede probar sin Postgres, que es como se prueba todo en este repo.
    const ajeno = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto({ email: 'quien.sea@ambientalia.com.co', userId: null, esAdmin: false }, ajeno, true)).toBe(true);
  });

  it('sin la llave no se abre un adjunto ajeno', () => {
    const ajeno = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto({ email: 'quien.sea@ambientalia.com.co', userId: null, esAdmin: false }, ajeno, false)).toBe(false);
  });

  it('quitar la llave no cierra el adjunto a quien lo pidió ni a quien lo firma', () => {
    // La llave AÑADE acceso, no lo condiciona: si al retirarla se perdiera el
    // acceso propio, quitársela a alguien le dejaría sin ver sus propias
    // solicitudes.
    const sesion = { email: 'ana@ambientalia.com.co', userId: null, esAdmin: false };
    const propio = { solicitanteEmail: 'ana@ambientalia.com.co', aprobadorCorreo: null, segundoAprobadorCorreo: null } as never;
    const aFirmar = { solicitanteEmail: 'otra@ambientalia.com.co', aprobadorCorreo: 'ana@ambientalia.com.co', segundoAprobadorCorreo: null } as never;
    expect(puedeVerAdjunto(sesion, propio, false)).toBe(true);
    expect(puedeVerAdjunto(sesion, aFirmar, false)).toBe(true);
  });
```

- [ ] **Step 2: Verlos fallar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- service.test.ts -t "adjunto"
```

Esperado: **FAIL** de compilación o de aserción, porque `puedeVerAdjunto` aún acepta dos argumentos.

- [ ] **Step 3: La función pura**

En `service.ts`, **borrar** `esVisorDeAdjuntos` (la que lee la constante) y cambiar la firma:

```ts
/**
 * El solicitante, sus dos aprobadores y quien tenga la llave maestra pueden ver
 * el PDF; nadie más (salvo admin).
 *
 * `esVisor` entra por parámetro y no se consulta aquí: desde que la lista salió
 * de `config.ts` a `portal.empleados`, resolverla dentro obligaría a pasar el
 * `Pool` y esta función dejaría de poder probarse sin Postgres — que no hay en
 * ningún test del repo. Quien llama lo resuelve con `repo.esVisorDeAdjuntos`.
 *
 * La llave AÑADE acceso, nunca lo condiciona: por eso va como retorno propio y
 * no como una condición del `return` final. Quitársela a alguien no puede
 * dejarle sin ver sus propias solicitudes.
 */
export function puedeVerAdjunto(sesion: Sesion, a: repo.AdjuntoCompleto, esVisor: boolean): boolean {
  if (sesion.esAdmin) return true;
  if (esVisor) return true;
  const yo = sesion.email.toLowerCase();
  // El segundo aprobador entra aquí aunque todavía no sea su turno: la ruta del
  // adjunto devuelve 404 y no 403, así que sin esto tendría que firmar un permiso
  // sin poder abrir su soporte y sin entender por qué.
  return (
    a.solicitanteEmail.toLowerCase() === yo ||
    (a.aprobadorCorreo ?? '').toLowerCase() === yo ||
    (a.segundoAprobadorCorreo ?? '').toLowerCase() === yo
  );
}
```

Y en `solicitudesConAdjunto` (línea 267), que ya es `async` y tiene `db`:

```ts
  if (!sesion.esAdmin && !(await repo.esVisorDeAdjuntos(db, sesion.email))) {
```

- [ ] **Step 4: Retirar la constante**

En `config.ts`, **borrar** `VISORES_ADJUNTOS` y su JSDoc, dejando en su lugar:

```ts
// Aquí vivía `VISORES_ADJUNTOS`, la lista de quién puede abrir CUALQUIER adjunto
// de CUALQUIER persona. Es ahora la columna `portal.empleados.ve_adjuntos`
// (migración 022), editable desde la pestaña Organigrama y con registro de
// quién la dio o la quitó en `portal.visores_adjuntos_log`.
//
// ⚠️ Sigue siendo una llave maestra sobre datos de salud (Ley 1581): lo que
// abre incluye el soporte médico de las incapacidades ajenas. El aviso que lo
// dice ahora vive en el panel, que es donde se toma la decisión.
```

- [ ] **Step 5: El router**

Línea 101 (contexto) — el handler ya es `async`:

```ts
        esVisorAdjuntos: sesion.esAdmin || (await repo.esVisorDeAdjuntos(db, sesion.email)),
```

Línea 187 (descarga) — resolver el booleano antes de la comprobación:

```ts
      const sesion = sesionDe(req);
      if (!service.puedeVerAdjunto(sesion, adjunto, await repo.esVisorDeAdjuntos(db, sesion.email))) {
```

Comprueba que `repo` esté importado en `router.ts` (lo está: `import * as repo from './repo.js'`).

- [ ] **Step 6: Los dos portones**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build limpio y **574 tests** (571 + 3).

Antes de correrlos harán falta dos cosas en `router.test.ts`:

**a)** El doble de la función nueva, en el `vi.mock('./repo.js', …)` junto a `empleadoPorId`. Lee de `estado.plantilla`, como los demás:

```ts
  esVisorDeAdjuntos: async (_db: unknown, email: string) =>
    estado.plantilla.some(
      (e: any) => String(e.correo).toLowerCase() === email.toLowerCase() && e.veAdjuntos === true,
    ),
```

Ojo: `estado.plantilla` se construye esparciendo `estado.empleado`, que no define `veAdjuntos`, así que por defecto **nadie es visor** — que es el valor de partida correcto.

**b)** Los tests viejos de `/ausencias/adjuntos` que hoy dan por visor a `comercial@` o `administrativo@` por estar en la constante. Con la constante retirada dejan de serlo, y fallarán. Arréglalos marcando la ficha en el propio test, no tocando el `beforeEach` global:

```ts
    estado.plantilla[0].veAdjuntos = true;
```

y usando el correo de esa ficha en el token. **No borres ningún test**: adáptalo al modelo nuevo y di en el reporte cuáles tocaste y por qué.

- [ ] **Step 7: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): el permiso de los adjuntos sale de la ficha, no de una constante" -- apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/service.test.ts apps/hub-api/src/ausencias/config.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

### Task 3: El endpoint que da y quita la llave

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (junto a `fijarCopia`)
- Modify: `apps/hub-api/src/ausencias/router.ts` (junto a `PUT /ausencias/empleados/:id/copia`)
- Test: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Step 1: Los tests que fallan**

Añade al `vi.mock('./repo.js', …)`, junto a `fijarCopia`:

```ts
  fijarVisor: async (_db: unknown, empleadoId: string, ve: boolean) => {
    const e = estado.plantilla.find((x: any) => x.id === empleadoId);
    if (!e) return false;
    e.veAdjuntos = ve;
    return true;
  },
  registrarCambioVisor: async (_db: unknown, entrada: Record<string, unknown>) => {
    estado.registroVisores.push(entrada);
  },
```

Añade `registroVisores: [] as Record<string, unknown>[],` al objeto `estado` y `estado.registroVisores = [];` al `beforeEach`.

Y el bloque de tests:

```ts
describe('PUT /ausencias/empleados/:id/visor', () => {
  it('un admin da la llave y queda registrado', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: true })
      .expect(200);
    expect(r.body).toMatchObject({ id: E1, veAdjuntos: true });
    expect(estado.registroVisores).toHaveLength(1);
    expect(estado.registroVisores[0]).toMatchObject({ concedido: true, empleadoId: E1 });
  });

  it('quitarla también se registra', async () => {
    estado.plantilla[0].veAdjuntos = true;
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: false })
      .expect(200);
    expect(estado.registroVisores[0]).toMatchObject({ concedido: false });
  });

  it('sin cambio no se escribe nada en el registro', async () => {
    // Si «Guardar» dejara una línea cada vez aunque la casilla no cambie, el
    // registro se llenaría de ruido y dejaría de leerse — y un registro que
    // nadie lee no es un control, es un fichero que crece.
    estado.plantilla[0].veAdjuntos = false;
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: false })
      .expect(200);
    expect(estado.registroVisores).toHaveLength(0);
  });

  it('400 si `veAdjuntos` no es booleano', async () => {
    const r = await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ veAdjuntos: 'si' })
      .expect(400);
    expect(r.body.error).toBe('visor_invalido');
  });

  it('403 a quien no es admin', async () => {
    await request(app())
      .put(`/api/ausencias/empleados/${E1}/visor`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ veAdjuntos: true })
      .expect(403);
  });
});
```

- [ ] **Step 2: Verlos fallar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run test --workspace=apps/hub-api -- router.test.ts -t "visor"
```

Esperado: **FAIL**, 404 en vez de 200/400/403.

- [ ] **Step 3: El servicio**

En `service.ts`, junto a `fijarCopia`:

```ts
/**
 * Da o quita la llave maestra de los adjuntos, dejando constancia.
 *
 * Recibe la `Sesion` —al contrario que `fijarJefe` y `fijarCopia`— porque el
 * registro tiene que decir QUIÉN lo hizo. Es lo que sustituye al historial de
 * git desde que la lista dejó de vivir en `config.ts`.
 *
 * Si el valor no cambia no se escribe nada, ni en la tabla ni en el registro:
 * el botón del panel guarda la fila entera, así que llegaría aquí también
 * cuando lo tocado fuera el jefe o la copia.
 */
export async function fijarVisor(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.veAdjuntos !== 'boolean') throw new AusenciaError('visor_invalido', 400, 'veAdjuntos');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  if (empleado.veAdjuntos !== b.veAdjuntos) {
    if (!(await repo.fijarVisor(db, empleadoId, b.veAdjuntos))) {
      throw new AusenciaError('empleado_no_encontrado', 404);
    }
    await repo.registrarCambioVisor(db, {
      adminEmail: sesion.email,
      empleadoId,
      empleadoCorreo: empleado.correo,
      concedido: b.veAdjuntos,
    });
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}
```

- [ ] **Step 4: La ruta**

En `router.ts`, tras el bloque de `PUT /ausencias/empleados/:id/copia`:

```ts
  /**
   * Da o quita la llave maestra de los adjuntos. Solo admin, y **queda
   * registrado**: es lo único que dice quién dio acceso a datos de salud desde
   * que la lista salió del código.
   */
  router.put('/ausencias/empleados/:id/visor', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarVisor(db, sesionDe(req), req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_visor');
    }
  });
```

- [ ] **Step 5: Los dos portones**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api
```

Esperado: build limpio y **579 tests** (574 + 5).

- [ ] **Step 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): endpoint para dar y quitar la llave de los adjuntos" -- apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

### Task 4: La casilla en el organigrama

**Files:**
- Modify: `apps/ausencias/src/api.ts`
- Modify: `apps/ausencias/src/PanelOrganigrama.tsx`

- [ ] **Step 1: El espejo de tipos**

En `api.ts`, en `export interface Empleado`, tras `copiaCorreo`:

```ts
  /** Puede abrir CUALQUIER adjunto de CUALQUIER persona. Llave maestra. */
  veAdjuntos: boolean;
```

Y junto a `fijarCopia`:

```ts
/** Da o quita la llave maestra de los adjuntos. Queda registrado en el servidor. */
export const fijarVisor = (id: string, veAdjuntos: boolean) =>
  put<EmpleadoConJefatura>(`/api/ausencias/empleados/${encodeURIComponent(id)}/visor`, { veAdjuntos });
```

- [ ] **Step 2: La columna**

En la cabecera, tras el `<th>` de «Copia»:

```tsx
                <th className="px-4 py-3 font-medium">Soportes</th>
```

En el cuerpo, tras la celda de «Copia»:

```tsx
                    <td className="px-4 py-2.5">
                      <label className="flex items-center gap-2 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={fila.veAdjuntos}
                          onChange={(ev) => actualizar(e.id, { veAdjuntos: ev.target.checked, error: null })}
                          aria-label={`${e.nombreCompleto} puede abrir cualquier soporte`}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-100"
                        />
                        Todos
                      </label>
                    </td>
```

- [ ] **Step 3: Estado y guardado**

**a)** `Fila` gana `veAdjuntos: boolean` y `filaInicial` lo inicializa con `veAdjuntos: e.veAdjuntos,`.

**b)** `haCambiado` compara los **tres** campos:

```tsx
                const haCambiado =
                  fila.aprobadorCorreo !== e.aprobadorCorreo ||
                  fila.copiaCorreo !== e.copiaCorreo ||
                  fila.veAdjuntos !== e.veAdjuntos;
```

**c)** En `guardar`, tras la llamada a `fijarCopia`:

```tsx
      if (fila.veAdjuntos !== empleado?.veAdjuntos) await fijarVisor(id, fila.veAdjuntos);
```

Añade `fijarVisor` al import de `./api`.

- [ ] **Step 4: El aviso**

Sustituye el texto del aviso ámbar que ya existe por este, que ahora tiene que explicar las dos cosas:

```tsx
        <span>
          Quien esté en <b>copia</b> recibirá también los acuses de <b>incapacidad</b> de esa persona, que son
          información de salud. Y la casilla <b>Soportes</b> es una llave maestra: quien la tenga puede abrir el PDF de
          cualquier incapacidad de cualquier persona, no solo de su equipo. Esa lista debe quedarse corta y cada
          persona tener un motivo. Quién la da o la quita queda registrado.
        </span>
```

- [ ] **Step 5: Verificar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/portal
```

Esperado: build limpio.

- [ ] **Step 6: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "feat(ausencias): casilla de soportes en el organigrama" -- apps/ausencias/src/api.ts apps/ausencias/src/PanelOrganigrama.tsx
```

---

### Task 5: Documentación viva

**Files:**
- Modify: `docs/dev/app-ausencias.md`

- [ ] **Step 1: El endpoint**

Bajo la fila de `PUT /api/ausencias/empleados/:id/copia`:

```markdown
| `PUT` | `/api/ausencias/empleados/:id/visor` | `requireAdmin` — da o quita la llave de los adjuntos; **queda registrado** |
```

- [ ] **Step 2: La sección**

Reescribir la subsección `### Quién puede abrir uno` (dentro de `## Los adjuntos`) para que recoja:

- Que pueden abrirlo el solicitante, su **jefe inmediato**, la **segunda firma**, los **administradores** y quien tenga la casilla **Soportes** en el organigrama. Que el jefe lo tiene también en la práctica, no solo en teoría: la bandeja monta la misma tabla que pinta el clip de descarga.
- Que esa lista salió de `config.ts` a `portal.empleados.ve_adjuntos` (migración **022**) y que **cada cambio queda registrado** en `portal.visores_adjuntos_log`, con quién, sobre quién, si dio o quitó, y cuándo. El porqué: al salir del código, git dejó de ser el historial de esos accesos.
- Que el registro guarda el **correo además del id** y **sin clave foránea**, para que borrar la ficha no borre el rastro.
- Que solo se escribe **cuando el valor cambia**.
- Que `puedeVerAdjunto` **sigue siendo pura**: el booleano entra por parámetro y lo resuelve quien llama con `repo.esVisorDeAdjuntos`. La razón: no hay Postgres en ningún test del repo.
- Que la llave **añade** acceso y nunca lo condiciona: quitársela a alguien no puede dejarle sin ver sus propias solicitudes.
- El sembrado de la 022: por qué no vale un `DEFAULT` como en la 021, por qué el `UPDATE` va dentro del `IF NOT EXISTS`, y por qué dentro de un `EXECUTE`.
- **Lo que sigue sin haber:** un registro de descargas. Se sabe quién tenía la llave y desde cuándo, **no quién la usó**.

- [ ] **Step 3: Migraciones en `## Piezas`**

Añadir «y `022` los visores configurables» al final de esa línea.

- [ ] **Step 4: Commit**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git commit -m "docs(ausencias): la llave de los adjuntos y su registro" -- docs/dev/app-ausencias.md
```

---

### Task 6: Cerrar la rama

- [ ] **Step 1: Los tres portones**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; npm run build --workspace=apps/hub-api; npm run test --workspace=apps/hub-api; npm run build --workspace=apps/portal
```

Esperado: los tres en verde, **579 tests**.

- [ ] **Step 2: Comprobar el árbol**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git status --short; git log --oneline main..HEAD
```

Esperado: solo `?? apps/WO-sales/prompts/`. Seis commits: la spec y uno por Task 1-5.

- [ ] **Step 3: Mezclar y empujar**

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"; git checkout main; git merge --no-ff feat/visores-configurables -m "merge: la llave de los adjuntos se configura desde el organigrama"; git push origin main
```

---

## Después del plan: despliegue

**hub-api primero, portal después.** hub-api trae la migración y el endpoint; el portal, la casilla.

En el log tiene que salir `migration applied: 022_ausencias_visores.sql`. Es aditiva y no destruye nada.

### Verificación imprescindible tras desplegar hub-api

```powershell
Set-Location "c:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07"
```

Y contra la base `zoho-hub` (ojo a las comillas por el guion: `\c "zoho-hub"`):

```sql
SELECT correo, ve_adjuntos FROM portal.empleados WHERE ve_adjuntos;
```

Tienen que salir **exactamente** `comercial@ambientalia.com.co` y `administrativo@ambientalia.com.co`. Si falta alguno, su ficha no existía cuando corrió el sembrado, esa persona lleva sin acceso desde el despliegue, y hay que dársela a mano desde el panel.

### Comprobación manual, con el portal ya desplegado

1. En **Organigrama**, la columna «Soportes» sale marcada solo en esas dos personas.
2. Marcar a un tercero, guardar, y comprobar que le aparece la pestaña «Soportes adjuntos» (tendrá que recargar).
3. Desmarcarlo y comprobar que la pierde.
4. Que el registro tiene las dos líneas:
   ```sql
   SELECT admin_email, empleado_correo, concedido, created_at
     FROM portal.visores_adjuntos_log ORDER BY created_at DESC LIMIT 5;
   ```
