# Notas personales del administrador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña «Notas» en Vacaciones y Permisos, solo para el administrador, para apuntar solicitudes personales (Informar retraso / Solicitudes / Otros) con persona, fecha, comentario, una imagen y estado abierta/resuelta.

**Architecture:** Dos tablas nuevas (migración 076) fuera del flujo de solicitudes. Un trozo de repositorio (`repo/notas.ts`) que filtra por `autor_email` en cada consulta, un trozo de servicio (`service/notas.ts`) con la validación pura y cinco rutas `requireAuth, requireAdmin` en `router.ts`. En el front, un módulo de API, un módulo puro con filtros y textos, y dos componentes (`PanelNotas`, `FormularioNota`).

**Tech Stack:** Express 4 + TypeScript ESM (imports con `.js`), SQL crudo con `$N`, Vitest + supertest (doble en memoria) + testcontainers (`*.db.test.ts`); React 19 + Tailwind + lucide-react.

**Especificación:** `docs/superpowers/specs/2026-11-12-notas-personales-design.md`.

---

## Convenciones que valen para TODAS las tareas

- Rama: `feat/ausencias-notas` (ya existe, con la especificación commiteada). Nunca `git add -A`: rutas explícitas.
- Commits en español, **sin tildes** y **sin ninguna línea de atribución** (ni `Co-Authored-By`).
- Comentarios del código en español **con tildes**, explicando el porqué. **Excepción:** los `.db.test.ts` van sin tildes. Los `.sql` sí llevan tildes.
- ⚠️ **Nunca** mutar ficheros con `Set-Content`, `sed -i` ni `perl -pi`: corrompen las tildes (PowerShell 5.1, `core.autocrlf=true`). Solo Edit/Write.
- ⚠️ Backticks dentro de una plantilla SQL (aunque sea un comentario `--`) cierran el template literal. No los uses en SQL.
- Shell: PowerShell 5.1 (sin `&&`, encadenar con `;`) o Git Bash.
- Docker se apaga solo. Si un `*.db.test.ts` falla con «Could not find a working container runtime strategy»: `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"`, esperar a que `docker info` responda y repetir.
- Comandos de hub-api: desde `apps/hub-api`. Unitarios: `npx vitest run <ruta>`. BD: `npx vitest run --config vitest.db.config.ts <ruta>`. **No** lances vitest desde la raíz del repo: arrastra los `.db.test.ts` (~281 fallos falsos).

## Mapa de ficheros

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `apps/hub-api/src/users/migrations/076_ausencias_notas.sql` | Crear | Las dos tablas, sus CHECK y los permisos de `portal_app` |
| `apps/hub-api/src/db.ts` | Modificar | Apuntar la 076 en `MIGRATIONS` |
| `apps/hub-api/src/equipos/migracion.test.ts` | Modificar | La 075 deja de ser la última |
| `apps/hub-api/src/ausencias/notas.estatico.test.ts` | Crear | Candados sin base: la 076 y el parser de `index.ts` |
| `apps/hub-api/src/test-db/harness.ts` | Modificar | `limpiar()` vacía las dos tablas nuevas |
| `apps/hub-api/src/ausencias/types.ts` | Modificar | Tipos y constantes de las notas |
| `apps/hub-api/src/ausencias/repo/notas.ts` | Crear | SQL de las notas, siempre filtrado por autor |
| `apps/hub-api/src/ausencias/repo.ts` | Modificar | Reexportar `repo/notas.ts` |
| `apps/hub-api/src/ausencias/repo/barril.test.ts` | Modificar | Añadir `notas` a `TROZOS` |
| `apps/hub-api/src/ausencias/repo.notas.db.test.ts` | Crear | El SQL contra Postgres de verdad |
| `apps/hub-api/src/ausencias/service/notas.ts` | Crear | Validación pura + orquestación |
| `apps/hub-api/src/ausencias/service.ts` | Modificar | Reexportar `service/notas.ts` |
| `apps/hub-api/src/ausencias/service/barril.test.ts` | Modificar | Añadir `notas` a `TROZOS` |
| `apps/hub-api/src/ausencias/notas.test.ts` | Crear | Unitarios de la validación |
| `apps/hub-api/src/ausencias/router.ts` | Modificar | Las cinco rutas |
| `apps/hub-api/src/ausencias/router.test.ts` | Modificar | Doble del repo + tests de las rutas + parser en `app()` |
| `apps/hub-api/src/index.ts` | Modificar | Parser de 12 MB para `/api/ausencias/notas` |
| `apps/ausencias/src/api/tipos.ts` | Modificar | Tipos espejo |
| `apps/ausencias/src/api/notas.ts` | Crear | Llamadas a hub-api |
| `apps/ausencias/src/api.ts` | Modificar | Reexportar `api/notas` |
| `apps/ausencias/src/api/barril.test.ts` | Modificar | Añadir `notas` a `TROZOS` |
| `apps/ausencias/src/notas.ts` | Crear | Filtros, orden, etiquetas, validación de imagen y textos de error |
| `apps/ausencias/src/notas.test.ts` | Crear | Unitarios del módulo puro |
| `apps/ausencias/src/FormularioNota.tsx` | Crear | Alta y edición |
| `apps/ausencias/src/PanelNotas.tsx` | Crear | Lista, filtros y acciones |
| `apps/ausencias/src/App.tsx` | Modificar | Registrar la pestaña |

---

### Task 1: Migración 076

**Files:**
- Create: `apps/hub-api/src/users/migrations/076_ausencias_notas.sql`
- Create: `apps/hub-api/src/ausencias/notas.estatico.test.ts`
- Modify: `apps/hub-api/src/db.ts` (línea del array `MIGRATIONS`, ~101)
- Modify: `apps/hub-api/src/equipos/migracion.test.ts:5-6` y `:95-97`
- Modify: `apps/hub-api/src/test-db/harness.ts:201-208`

- [ ] **Step 1: Escribir el test estático que falla**

Crear `apps/hub-api/src/ausencias/notas.estatico.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Las notas personales sin base de datos: que la migración 076 está apuntada,
// es idempotente y da permisos a portal_app. Lo que hace contra Postgres lo
// vigila repo.notas.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL_076 = leer('../users/migrations/076_ausencias_notas.sql');

describe('migración 076 (notas personales)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 075, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'075_equipos_tablero_tema_tv\.sql',\s*'076_ausencias_notas\.sql'\];/);
  });

  it('no siembra ni borra nada (se re-ejecuta en cada arranque)', () => {
    expect(SQL_076).not.toMatch(/INSERT\s+INTO|\b(DROP|TRUNCATE)\b|DELETE\s+FROM/i);
  });

  it('solo DDL idempotente', () => {
    const creates = SQL_076.match(/CREATE (UNIQUE )?(TABLE|INDEX|VIEW|SCHEMA|OR REPLACE VIEW)[^;]*/g) || [];
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.filter((c) => !/IF NOT EXISTS|OR REPLACE/.test(c))).toEqual([]);
  });

  it('da permisos a portal_app solo si el rol existe (DATA-332)', () => {
    // La 068 concede ALL TABLES, pero corre ANTES que esta en el mismo arranque:
    // sin este GRANT la tabla nueva no tendría permisos hasta el boot siguiente.
    expect(SQL_076).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SQL_076).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON portal\.ausencias_notas, portal\.ausencias_nota_imagenes TO portal_app/,
    );
  });
});
```

- [ ] **Step 2: Comprobar que falla**

Run: `npx vitest run src/ausencias/notas.estatico.test.ts`
Expected: FAIL con `ENOENT ... 076_ausencias_notas.sql`.

- [ ] **Step 3: Crear la migración**

Crear `apps/hub-api/src/users/migrations/076_ausencias_notas.sql`:

```sql
-- Migration 076: notas personales del administrador en Vacaciones y Permisos.
--
-- Lo que le piden a mano y no pasa por el flujo de solicitudes —un aviso de
-- retraso, una petición suelta, otros asuntos—, con su estado para saber qué
-- queda por atender.
--
-- Tablas propias y NO un tipo más de `solicitudes_ausencia`: meterlas ahí
-- obligaría a excluirlas en cada consulta de saldo, KPIs, calendario y Registro
-- general, y un solo olvido las mezclaría con los números de la empresa.
--
-- ⚠️ Cada nota es de quien la escribe (`autor_email`), y TODA consulta de
-- repo/notas.ts filtra por esa columna. Hoy solo hay un administrador, pero si
-- un día hay otro, no debe ver estas notas.
--
-- `empleado_id` con ON DELETE SET NULL más `empleado_nombre` copiado: RESTRICT
-- haría fallar el borrado de una ficha mal dada de alta por una nota que nadie
-- más ve, y CASCADE borraría notas sin avisar. Con la copia del nombre la nota
-- sigue legible aunque la ficha desaparezca.
--
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

CREATE TABLE IF NOT EXISTS portal.ausencias_notas (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id     UUID         REFERENCES portal.empleados(id) ON DELETE SET NULL,
  empleado_nombre VARCHAR(255) NOT NULL,
  categoria       VARCHAR(20)  NOT NULL CHECK (categoria IN ('retraso', 'solicitud', 'otro')),
  fecha           DATE         NOT NULL,
  comentario      TEXT         NOT NULL CHECK (char_length(btrim(comentario)) BETWEEN 1 AND 2000),
  estado          VARCHAR(10)  NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'resuelta')),
  resuelta_at     TIMESTAMPTZ,
  autor_email     VARCHAR(254) NOT NULL CHECK (autor_email = lower(autor_email)),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Resuelta si y solo si tiene fecha de resolución: así ningún UPDATE puede
  -- dejar una nota «resuelta» sin cuándo, ni una «abierta» con fecha colgando.
  CONSTRAINT ausencias_notas_resuelta_coherente CHECK ((estado = 'resuelta') = (resuelta_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ausencias_notas_autor ON portal.ausencias_notas (autor_email, fecha DESC);

-- La imagen va aparte, como `solicitud_adjuntos`, para que listar notas no
-- arrastre los bytes. UNIQUE (nota_id): una imagen como máximo por nota.
CREATE TABLE IF NOT EXISTS portal.ausencias_nota_imagenes (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_id        UUID         NOT NULL UNIQUE REFERENCES portal.ausencias_notas(id) ON DELETE CASCADE,
  nombre_archivo VARCHAR(255) NOT NULL,
  mime           VARCHAR(20)  NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  contenido      BYTEA        NOT NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da. La
-- 068 concede ALL TABLES, pero corre antes que esta en el mismo arranque.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.ausencias_notas, portal.ausencias_nota_imagenes TO portal_app;
  END IF;
END $$;
```

- [ ] **Step 4: Apuntarla en `MIGRATIONS`**

En `apps/hub-api/src/db.ts`, dentro de la única línea del array `MIGRATIONS`, sustituir:

```ts
'075_equipos_tablero_tema_tv.sql'];
```

por:

```ts
'075_equipos_tablero_tema_tv.sql', '076_ausencias_notas.sql'];
```

- [ ] **Step 5: Relajar el test que exigía que la 075 fuera la última**

En `apps/hub-api/src/equipos/migracion.test.ts`, el comentario de cabecera (líneas 5-6) dice «que la 075 es la última». Sustituirlo por:

```ts
// Las migraciones de «Equipos en taller» sin base: que están apuntadas, en orden y que no
// siembran nada. Lo que hacen contra Postgres: migracion.db.test.ts,
```

(la línea 7, `// repo.db.test.ts, repo-sync.db.test.ts y repo-tablero.db.test.ts.`, se queda igual).

Y sustituir el test de las líneas 96-98:

```ts
  it('está apuntada en MIGRATIONS, detrás de la 074, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'074_equipos_tablero\.sql',\s*'075_equipos_tablero_tema_tv\.sql'\];/);
  });
```

por:

```ts
  // Ya no es la última (la 076 de las notas de Ausencias va detrás): basta con
  // que esté justo detrás de la 074. Mismo relevo que en wo-sales/email.test.ts.
  it('está apuntada en MIGRATIONS, detrás de la 074', () => {
    expect(leer('../db.ts')).toMatch(/'074_equipos_tablero\.sql',\s*'075_equipos_tablero_tema_tv\.sql'[,\]]/);
  });
```

- [ ] **Step 6: Que `limpiar()` vacíe las tablas nuevas**

En `apps/hub-api/src/test-db/harness.ts`, dentro de `limpiar`, sustituir:

```ts
              portal.visores_empresa_log, portal.visores_kpis_log
```

por:

```ts
              portal.visores_empresa_log, portal.visores_kpis_log,
              portal.ausencias_notas, portal.ausencias_nota_imagenes
```

(Las dos ya caerían por el CASCADE desde `portal.empleados`, pero `ausencias_notas.empleado_id` admite NULL: listarlas a mano no depende de que el FK siga existiendo.)

- [ ] **Step 7: Comprobar que pasan**

Run: `npx vitest run src/ausencias/notas.estatico.test.ts src/equipos/migracion.test.ts`
Expected: PASS, los dos ficheros.

- [ ] **Step 8: Commit**

```bash
git add apps/hub-api/src/users/migrations/076_ausencias_notas.sql apps/hub-api/src/db.ts apps/hub-api/src/equipos/migracion.test.ts apps/hub-api/src/ausencias/notas.estatico.test.ts apps/hub-api/src/test-db/harness.ts
git commit -m "feat(ausencias): migracion 076 de las notas personales del administrador"
```

---

### Task 2: Tipos de las notas en hub-api

**Files:**
- Modify: `apps/hub-api/src/ausencias/types.ts` (añadir al final del fichero)

- [ ] **Step 1: Añadir los tipos al final de `types.ts`**

```ts
// ── Notas personales del administrador (migración 076) ─────────────────────

/** `retraso` = «Informar retraso», `solicitud` = «Solicitudes», `otro` = «Otros». */
export const CATEGORIAS_NOTA = ['retraso', 'solicitud', 'otro'] as const;
export type CategoriaNota = (typeof CATEGORIAS_NOTA)[number];

export const ESTADOS_NOTA = ['abierta', 'resuelta'] as const;
export type EstadoNota = (typeof ESTADOS_NOTA)[number];

/** Los tres formatos que un navegador pinta sin sorpresas. Nada de SVG: lleva script. */
export const MIMES_IMAGEN_NOTA = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MimeImagenNota = (typeof MIMES_IMAGEN_NOTA)[number];

/** Lo que la lista enseña de la imagen: sin los bytes, que van por su propia ruta. */
export interface ImagenDeNota {
  id: string;
  nombreArchivo: string;
  mime: MimeImagenNota;
  bytes: number;
}

export interface Nota {
  id: string;
  /** `null` si la ficha se borró después: la nota sobrevive con el nombre copiado. */
  empleadoId: string | null;
  empleadoNombre: string;
  categoria: CategoriaNota;
  /** `YYYY-MM-DD`: el día al que se refiere la nota, no cuándo se escribió. */
  fecha: string;
  comentario: string;
  estado: EstadoNota;
  resueltaAt: string | null;
  createdAt: string;
  updatedAt: string;
  imagen: ImagenDeNota | null;
}

/** Una imagen ya validada y decodificada, lista para el INSERT. */
export interface ImagenNuevaDeNota {
  nombreArchivo: string;
  mime: MimeImagenNota;
  contenido: Buffer;
}

export interface NuevaNota {
  empleadoId: string;
  categoria: CategoriaNota;
  fecha: string;
  comentario: string;
  imagen: ImagenNuevaDeNota | null;
}

/**
 * Lo que cambia una edición. Ausente = no se toca. En `imagen`, `null` = quitarla
 * y un valor = sustituirla: por eso es `?:` y además admite `null`.
 */
export interface CambioNota {
  empleadoId?: string;
  categoria?: CategoriaNota;
  fecha?: string;
  comentario?: string;
  estado?: EstadoNota;
  imagen?: ImagenNuevaDeNota | null;
}
```

- [ ] **Step 2: Comprobar que compila**

Run: `npx tsc --noEmit -p .`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/ausencias/types.ts
git commit -m "feat(ausencias): tipos de las notas personales"
```

---

### Task 3: Repositorio de las notas (SQL + tests contra Postgres)

**Files:**
- Create: `apps/hub-api/src/ausencias/repo/notas.ts`
- Create: `apps/hub-api/src/ausencias/repo.notas.db.test.ts`
- Modify: `apps/hub-api/src/ausencias/repo.ts` (añadir al final)
- Modify: `apps/hub-api/src/ausencias/repo/barril.test.ts` (imports y `TROZOS`)
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (estado, `beforeEach` y doble del repo)

- [ ] **Step 1: Escribir los tests de BD que fallan**

Crear `apps/hub-api/src/ausencias/repo.notas.db.test.ts` (sin tildes, como todos los `.db.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';
import { notasDeAutor, notaDeAutor, insertarNota, actualizarNota, eliminarNota, imagenDeNota } from './repo.js';
import type { NuevaNota } from './types.js';

// Las notas personales del administrador contra Postgres de verdad.
//
// El filtro por autor vive en el SQL de cada consulta, y el doble de
// router.test.ts no ejecuta SQL: si un WHERE pierde el `autor_email`, solo
// este fichero lo caza.

const YO = 'admin@ambientalia.com.co';
const OTRO = 'otro.admin@ambientalia.com.co';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

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
  empleadoId = await sembrarEmpleado(db, 'ana@notas.test');
});

const nueva = (over: Partial<NuevaNota> = {}): NuevaNota => ({
  empleadoId,
  categoria: 'retraso',
  fecha: '2026-11-12',
  comentario: 'Llega tarde por cita medica',
  imagen: null,
  ...over,
});

const conImagen = (contenido = JPEG) =>
  nueva({ imagen: { nombreArchivo: 'foto.jpg', mime: 'image/jpeg', contenido } });

describe('insertarNota y notasDeAutor', () => {
  it('guarda la nota con la copia del nombre y nace abierta', async () => {
    const n = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    expect(n).toMatchObject({
      empleadoId,
      empleadoNombre: 'Ana Ruiz',
      categoria: 'retraso',
      fecha: '2026-11-12',
      comentario: 'Llega tarde por cita medica',
      estado: 'abierta',
      resueltaAt: null,
      imagen: null,
    });
    expect(await notasDeAutor(db, YO)).toEqual([n]);
  });

  it('con imagen: la lista trae los metadatos y no los bytes', async () => {
    const n = await insertarNota(db, YO, 'Ana Ruiz', conImagen());
    expect(n.imagen).toMatchObject({ nombreArchivo: 'foto.jpg', mime: 'image/jpeg', bytes: JPEG.length });
    expect(n.imagen).not.toHaveProperty('contenido');
    const img = await imagenDeNota(db, n.id, YO);
    expect(img?.contenido.equals(JPEG)).toBe(true);
    expect(img?.mime).toBe('image/jpeg');
  });

  it('ordena por fecha descendente', async () => {
    await insertarNota(db, YO, 'Ana Ruiz', nueva({ fecha: '2026-11-01' }));
    await insertarNota(db, YO, 'Ana Ruiz', nueva({ fecha: '2026-11-10' }));
    await insertarNota(db, YO, 'Ana Ruiz', nueva({ fecha: '2026-11-05' }));
    expect((await notasDeAutor(db, YO)).map((n) => n.fecha)).toEqual(['2026-11-10', '2026-11-05', '2026-11-01']);
  });
});

describe('CANDADO: cada nota es de quien la escribe', () => {
  let id: string;
  beforeEach(async () => {
    id = (await insertarNota(db, YO, 'Ana Ruiz', conImagen())).id;
  });

  it('otro autor no la lista', async () => {
    expect(await notasDeAutor(db, OTRO)).toEqual([]);
  });

  it('otro autor no la lee', async () => {
    expect(await notaDeAutor(db, id, OTRO)).toBeNull();
  });

  it('otro autor no la edita, ni le quita la imagen', async () => {
    expect(await actualizarNota(db, id, OTRO, { comentario: 'pisado', imagen: null })).toBeNull();
    const mia = await notaDeAutor(db, id, YO);
    expect(mia?.comentario).toBe('Llega tarde por cita medica');
    expect(mia?.imagen).not.toBeNull();
  });

  it('otro autor no la borra', async () => {
    expect(await eliminarNota(db, id, OTRO)).toBe(false);
    expect(await notaDeAutor(db, id, YO)).not.toBeNull();
  });

  it('otro autor no descarga su imagen', async () => {
    expect(await imagenDeNota(db, id, OTRO)).toBeNull();
    expect(await imagenDeNota(db, id, YO)).not.toBeNull();
  });
});

describe('actualizarNota', () => {
  it('resolver fija resuelta_at y reabrir lo vacia', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    const resuelta = await actualizarNota(db, id, YO, { estado: 'resuelta' });
    expect(resuelta?.estado).toBe('resuelta');
    expect(resuelta?.resueltaAt).not.toBeNull();
    const abierta = await actualizarNota(db, id, YO, { estado: 'abierta' });
    expect(abierta).toMatchObject({ estado: 'abierta', resueltaAt: null });
  });

  it('volver a marcarla resuelta conserva la primera fecha de resolucion', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    await actualizarNota(db, id, YO, { estado: 'resuelta' });
    // Se fecha en el pasado a mano: dos NOW() seguidos pueden caer en el mismo
    // milisegundo y el test pasaria aunque se pisara la fecha.
    await db.query(`UPDATE portal.ausencias_notas SET resuelta_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [id]);
    const otraVez = await actualizarNota(db, id, YO, { estado: 'resuelta' });
    expect(otraVez?.resueltaAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('imagen null la quita y una nueva la sustituye', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', conImagen());
    const sinImagen = await actualizarNota(db, id, YO, { imagen: null });
    expect(sinImagen?.imagen).toBeNull();
    expect(await imagenDeNota(db, id, YO)).toBeNull();

    await actualizarNota(db, id, YO, { imagen: { nombreArchivo: 'a.jpg', mime: 'image/jpeg', contenido: JPEG } });
    const otra = await actualizarNota(db, id, YO, { imagen: { nombreArchivo: 'b.png', mime: 'image/png', contenido: PNG } });
    expect(otra?.imagen).toMatchObject({ nombreArchivo: 'b.png', mime: 'image/png', bytes: PNG.length });
    expect((await imagenDeNota(db, id, YO))?.contenido.equals(PNG)).toBe(true);
  });

  it('cambiar de persona guarda el nombre que le pasan', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    const otraFicha = await sembrarEmpleado(db, 'beto@notas.test');
    const n = await actualizarNota(db, id, YO, { empleadoId: otraFicha }, 'Beto Diaz');
    expect(n).toMatchObject({ empleadoId: otraFicha, empleadoNombre: 'Beto Diaz' });
  });

  it('cambia categoria, fecha y comentario', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    const n = await actualizarNota(db, id, YO, { categoria: 'otro', fecha: '2026-10-01', comentario: 'Otro asunto' });
    expect(n).toMatchObject({ categoria: 'otro', fecha: '2026-10-01', comentario: 'Otro asunto' });
  });
});

describe('eliminarNota', () => {
  it('borra la nota y su imagen por cascada', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', conImagen());
    expect(await eliminarNota(db, id, YO)).toBe(true);
    expect(await notasDeAutor(db, YO)).toEqual([]);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.ausencias_nota_imagenes');
    expect(rows[0].n).toBe(0);
  });
});

describe('la ficha de la persona', () => {
  it('si se borra la ficha, la nota sobrevive con el nombre copiado', async () => {
    const { id } = await insertarNota(db, YO, 'Ana Ruiz', nueva());
    await db.query('DELETE FROM portal.empleados WHERE id = $1', [empleadoId]);
    expect(await notaDeAutor(db, id, YO)).toMatchObject({ empleadoId: null, empleadoNombre: 'Ana Ruiz' });
  });
});

describe('CHECK de la migracion 076', () => {
  const insertarCruda = (campos: { categoria?: string; comentario?: string; estado?: string; autor?: string }) =>
    db.query(
      `INSERT INTO portal.ausencias_notas (empleado_nombre, categoria, fecha, comentario, estado, autor_email)
       VALUES ('X', $1, '2026-11-12', $2, $3, $4) RETURNING id`,
      [campos.categoria ?? 'otro', campos.comentario ?? 'ok', campos.estado ?? 'abierta', campos.autor ?? YO],
    );

  it('rechaza un comentario en blanco', async () => {
    await expect(insertarCruda({ comentario: '   ' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza una categoria desconocida', async () => {
    await expect(insertarCruda({ categoria: 'vacaciones' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza una nota resuelta sin resuelta_at', async () => {
    await expect(insertarCruda({ estado: 'resuelta' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza un autor con mayusculas', async () => {
    await expect(insertarCruda({ autor: 'Admin@Ambientalia.com.co' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rechaza una imagen que no es JPEG, PNG ni WebP', async () => {
    const { rows } = await insertarCruda({});
    await expect(
      db.query(
        `INSERT INTO portal.ausencias_nota_imagenes (nota_id, nombre_archivo, mime, contenido) VALUES ($1, 'x.gif', 'image/gif', $2)`,
        [rows[0].id, JPEG],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('admite una sola imagen por nota', async () => {
    const { rows } = await insertarCruda({});
    const meter = () =>
      db.query(
        `INSERT INTO portal.ausencias_nota_imagenes (nota_id, nombre_archivo, mime, contenido) VALUES ($1, 'x.jpg', 'image/jpeg', $2)`,
        [rows[0].id, JPEG],
      );
    await meter();
    await expect(meter()).rejects.toMatchObject({ code: '23505' });
  });
});
```

- [ ] **Step 2: Comprobar que falla**

Run: `npx vitest run --config vitest.db.config.ts src/ausencias/repo.notas.db.test.ts`
Expected: FAIL. El import de `./repo.js` no trae `notasDeAutor` y compañía (`is not a function`).

- [ ] **Step 3: Crear `repo/notas.ts`**

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import { withTransaction, type Consultable, type PoolClient } from './comun.js';
import type { CambioNota, CategoriaNota, EstadoNota, ImagenNuevaDeNota, MimeImagenNota, Nota, NuevaNota } from '../types.js';

// Las notas personales del administrador (migración 076). repo.ts lo reexporta:
// el resto del código lo llama como `repo.*` (lo vigila barril.test.ts).
//
// ⚠️ TODA consulta de este fichero filtra por `autor_email`. Cada nota es de
// quien la escribe; quitar ese filtro de una sola consulta le abriría las notas
// de un administrador a otro. Lo vigila repo.notas.db.test.ts, consulta a
// consulta.

/** La imagen entera, bytes incluidos: solo para la ruta que la sirve. */
export interface ImagenCompletaDeNota {
  nombreArchivo: string;
  mime: MimeImagenNota;
  contenido: Buffer;
}

interface FilaNotaDb {
  id: string;
  empleado_id: string | null;
  empleado_nombre: string;
  categoria: CategoriaNota;
  fecha: string;
  comentario: string;
  estado: EstadoNota;
  resuelta_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  imagen_id: string | null;
  imagen_nombre: string | null;
  imagen_mime: MimeImagenNota | null;
  imagen_bytes: number | null;
}

// `to_char` en la fecha para no depender del parser de DATE del pool, y
// `octet_length` para enseñar el tamaño sin traer los bytes.
const SELECT_NOTA = `
  SELECT n.id, n.empleado_id, n.empleado_nombre, n.categoria,
         to_char(n.fecha, 'YYYY-MM-DD') AS fecha, n.comentario, n.estado,
         n.resuelta_at, n.created_at, n.updated_at,
         i.id AS imagen_id, i.nombre_archivo AS imagen_nombre, i.mime AS imagen_mime,
         octet_length(i.contenido) AS imagen_bytes
    FROM portal.ausencias_notas n
    LEFT JOIN portal.ausencias_nota_imagenes i ON i.nota_id = n.id`;

const iso = (v: Date | string): string => new Date(v).toISOString();

function aNota(f: FilaNotaDb): Nota {
  return {
    id: f.id,
    empleadoId: f.empleado_id,
    empleadoNombre: f.empleado_nombre,
    categoria: f.categoria,
    fecha: f.fecha,
    comentario: f.comentario,
    estado: f.estado,
    resueltaAt: f.resuelta_at === null ? null : iso(f.resuelta_at),
    createdAt: iso(f.created_at),
    updatedAt: iso(f.updated_at),
    imagen:
      f.imagen_id === null
        ? null
        : {
            id: f.imagen_id,
            nombreArchivo: f.imagen_nombre as string,
            mime: f.imagen_mime as MimeImagenNota,
            bytes: Number(f.imagen_bytes),
          },
  };
}

/** Todas las notas del autor, de la más reciente a la más antigua. */
export async function notasDeAutor(db: Pool, autorEmail: string): Promise<Nota[]> {
  const { rows } = await db.query(
    `${SELECT_NOTA} WHERE n.autor_email = $1 ORDER BY n.fecha DESC, n.created_at DESC`,
    [autorEmail],
  );
  return (rows as FilaNotaDb[]).map(aNota);
}

/** Una nota, solo si es de ese autor. `null` tanto si no existe como si es ajena. */
export async function notaDeAutor(db: Consultable, id: string, autorEmail: string): Promise<Nota | null> {
  const { rows } = await db.query(`${SELECT_NOTA} WHERE n.id = $1 AND n.autor_email = $2`, [id, autorEmail]);
  return rows.length ? aNota(rows[0] as FilaNotaDb) : null;
}

/** Inserta o sustituye la imagen de una nota. UNIQUE (nota_id) hace de una a lo sumo. */
async function guardarImagen(client: PoolClient, notaId: string, img: ImagenNuevaDeNota): Promise<void> {
  await client.query(
    `INSERT INTO portal.ausencias_nota_imagenes (nota_id, nombre_archivo, mime, contenido)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (nota_id) DO UPDATE
       SET nombre_archivo = EXCLUDED.nombre_archivo, mime = EXCLUDED.mime,
           contenido = EXCLUDED.contenido, created_at = NOW()`,
    [notaId, img.nombreArchivo, img.mime, img.contenido],
  );
}

/**
 * Crea la nota y, si la trae, su imagen, en una transacción: una nota que se
 * guardara sin la foto que se adjuntó sería una nota distinta de la pedida.
 */
export async function insertarNota(
  db: Pool,
  autorEmail: string,
  empleadoNombre: string,
  datos: NuevaNota,
): Promise<Nota> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO portal.ausencias_notas (empleado_id, empleado_nombre, categoria, fecha, comentario, autor_email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [datos.empleadoId, empleadoNombre, datos.categoria, datos.fecha, datos.comentario, autorEmail],
    );
    const id = (rows[0] as { id: string }).id;
    if (datos.imagen) await guardarImagen(client, id, datos.imagen);
    return (await notaDeAutor(client, id, autorEmail)) as Nota;
  });
}

/**
 * Aplica el cambio a la nota del autor. `null` si no existe o es ajena, y en ese
 * caso no se toca nada: el UPDATE va primero y la imagen solo se toca si alcanzó
 * una fila.
 *
 * `empleadoNombre` acompaña a `cambio.empleadoId`: la copia del nombre la decide
 * el servicio, que es quien lee la ficha.
 */
export async function actualizarNota(
  db: Pool,
  id: string,
  autorEmail: string,
  cambio: CambioNota,
  empleadoNombre?: string,
): Promise<Nota | null> {
  return withTransaction(db, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    const poner = (columna: string, valor: unknown) => {
      valores.push(valor);
      sets.push(`${columna} = $${valores.length}`);
    };
    if (cambio.empleadoId !== undefined) {
      poner('empleado_id', cambio.empleadoId);
      poner('empleado_nombre', empleadoNombre);
    }
    if (cambio.categoria !== undefined) poner('categoria', cambio.categoria);
    if (cambio.fecha !== undefined) poner('fecha', cambio.fecha);
    if (cambio.comentario !== undefined) poner('comentario', cambio.comentario);
    if (cambio.estado !== undefined) {
      poner('estado', cambio.estado);
      // COALESCE: volver a marcar como resuelta una nota que ya lo estaba no
      // reescribe cuándo se resolvió.
      sets.push(cambio.estado === 'resuelta' ? 'resuelta_at = COALESCE(resuelta_at, NOW())' : 'resuelta_at = NULL');
    }
    sets.push('updated_at = NOW()');
    valores.push(id, autorEmail);
    const { rowCount } = await client.query(
      `UPDATE portal.ausencias_notas SET ${sets.join(', ')}
        WHERE id = $${valores.length - 1} AND autor_email = $${valores.length}`,
      valores,
    );
    if (!rowCount) return null;
    if (cambio.imagen === null) {
      await client.query('DELETE FROM portal.ausencias_nota_imagenes WHERE nota_id = $1', [id]);
    } else if (cambio.imagen !== undefined) {
      await guardarImagen(client, id, cambio.imagen);
    }
    return notaDeAutor(client, id, autorEmail);
  });
}

/** Borra la nota del autor; su imagen cae por el ON DELETE CASCADE. */
export async function eliminarNota(db: Pool, id: string, autorEmail: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM portal.ausencias_notas WHERE id = $1 AND autor_email = $2', [
    id,
    autorEmail,
  ]);
  return (rowCount ?? 0) > 0;
}

/** La imagen de una nota del autor, con sus bytes. `null` si no hay o es ajena. */
export async function imagenDeNota(db: Pool, notaId: string, autorEmail: string): Promise<ImagenCompletaDeNota | null> {
  const { rows } = await db.query(
    `SELECT i.nombre_archivo, i.mime, i.contenido
       FROM portal.ausencias_nota_imagenes i
       JOIN portal.ausencias_notas n ON n.id = i.nota_id
      WHERE n.id = $1 AND n.autor_email = $2`,
    [notaId, autorEmail],
  );
  if (!rows.length) return null;
  const f = rows[0] as { nombre_archivo: string; mime: MimeImagenNota; contenido: Buffer };
  return { nombreArchivo: f.nombre_archivo, mime: f.mime, contenido: f.contenido };
}
```

- [ ] **Step 4: Reexportarlo en `repo.ts`**

Al final de `apps/hub-api/src/ausencias/repo.ts`, detrás de `export * from './repo/retiro.js';`:

```ts

// ── Notas personales del administrador ─────────────────────────────────────

// En repo/notas.ts. Cada consulta filtra por `autor_email`: ver la migración 076.
export * from './repo/notas.js';
```

- [ ] **Step 5: Añadir el trozo a `repo/barril.test.ts`**

Detrás de `import * as modificaciones from './modificaciones.js';` añadir:

```ts
import * as notas from './notas.js';
```

y en `TROZOS`, detrás de `modificaciones,`, añadir:

```ts
  notas,
```

- [ ] **Step 6: Modelar las funciones nuevas en el doble de `router.test.ts`**

El CANDADO «modela exactamente las funciones que exporta repo.ts» (router.test.ts ~1590) se pone rojo en cuanto repo.ts exporta las seis funciones nuevas.

6a. En el objeto `estado` (empieza en ~128), detrás de `plantilla: [] as any[],` (~148), añadir:

```ts
  /** Las notas personales: `{ autor, nota, contenido }`, con `contenido` = bytes de la imagen o null. */
  notas: [] as any[],
```

6b. En el `beforeEach` de nivel superior, detrás de `estado.adminsDelPortal = [];` (~1762), añadir:

```ts
  estado.notas = [];
```

6c. Dentro del `vi.mock('./repo.js', async () => ({ ... }))`, justo antes del `}));` que lo cierra (detrás de `existeOtorgamientoDelDia`, ~1559), añadir:

```ts
  // Notas personales (repo/notas.ts). Doble minimo: el SQL de verdad, y sobre
  // todo su filtro por autor consulta a consulta, lo vigila
  // repo.notas.db.test.ts. Aqui solo hace falta que las rutas tengan donde
  // escribir.
  notasDeAutor: async (_db: unknown, autor: string) =>
    estado.notas.filter((f: any) => f.autor === autor).map((f: any) => f.nota),
  notaDeAutor: async (_db: unknown, id: string, autor: string) =>
    estado.notas.find((f: any) => f.nota.id === id && f.autor === autor)?.nota ?? null,
  insertarNota: async (_db: unknown, autor: string, empleadoNombre: string, datos: any) => {
    const id = `00000000-0000-4000-8000-${String(estado.notas.length + 1).padStart(12, '0')}`;
    const nota = {
      id,
      empleadoId: datos.empleadoId,
      empleadoNombre,
      categoria: datos.categoria,
      fecha: datos.fecha,
      comentario: datos.comentario,
      estado: 'abierta',
      resueltaAt: null,
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: '2026-01-15T12:00:00.000Z',
      imagen: datos.imagen
        ? { id: `${id}-img`, nombreArchivo: datos.imagen.nombreArchivo, mime: datos.imagen.mime, bytes: datos.imagen.contenido.length }
        : null,
    };
    estado.notas.push({ autor, nota, contenido: datos.imagen?.contenido ?? null });
    return nota;
  },
  actualizarNota: async (_db: unknown, id: string, autor: string, cambio: any, empleadoNombre?: string) => {
    const fila = estado.notas.find((f: any) => f.nota.id === id && f.autor === autor);
    if (!fila) return null;
    const { imagen, ...resto } = cambio;
    Object.assign(fila.nota, resto, empleadoNombre === undefined ? {} : { empleadoNombre });
    if (cambio.estado !== undefined) {
      fila.nota.resueltaAt = cambio.estado === 'resuelta' ? (fila.nota.resueltaAt ?? '2026-01-15T12:00:00.000Z') : null;
    }
    if (imagen === null) {
      fila.nota.imagen = null;
      fila.contenido = null;
    } else if (imagen !== undefined) {
      fila.nota.imagen = { id: `${id}-img`, nombreArchivo: imagen.nombreArchivo, mime: imagen.mime, bytes: imagen.contenido.length };
      fila.contenido = imagen.contenido;
    }
    return fila.nota;
  },
  eliminarNota: async (_db: unknown, id: string, autor: string) => {
    const i = estado.notas.findIndex((f: any) => f.nota.id === id && f.autor === autor);
    if (i < 0) return false;
    estado.notas.splice(i, 1);
    return true;
  },
  imagenDeNota: async (_db: unknown, id: string, autor: string) => {
    const fila = estado.notas.find((f: any) => f.nota.id === id && f.autor === autor);
    return fila?.contenido
      ? { nombreArchivo: fila.nota.imagen.nombreArchivo, mime: fila.nota.imagen.mime, contenido: fila.contenido }
      : null;
  },
```

- [ ] **Step 7: Comprobar que pasan**

Run: `npx vitest run --config vitest.db.config.ts src/ausencias/repo.notas.db.test.ts`
Expected: PASS, 21 tests.

Run: `npx vitest run src/ausencias/repo/barril.test.ts src/ausencias/router.test.ts`
Expected: PASS (incluido el CANDADO del doble).

- [ ] **Step 8: Commit**

```bash
git add apps/hub-api/src/ausencias/repo/notas.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/repo/barril.test.ts apps/hub-api/src/ausencias/repo.notas.db.test.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): repositorio de las notas personales, filtrado por autor"
```

---

### Task 4: Validación y servicio de las notas

**Files:**
- Create: `apps/hub-api/src/ausencias/notas.test.ts`
- Create: `apps/hub-api/src/ausencias/service/notas.ts`
- Modify: `apps/hub-api/src/ausencias/service.ts` (añadir al final)
- Modify: `apps/hub-api/src/ausencias/service/barril.test.ts` (imports y `TROZOS`)

- [ ] **Step 1: Escribir los unitarios que fallan**

Crear `apps/hub-api/src/ausencias/notas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectarMimeImagen, validarCambioNota, validarNuevaNota } from './service.js';

// La validación de las notas personales, pura: sin base y sin HTTP.

const EMPLEADO = '11111111-1111-4111-8111-111111111111';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);

const cuerpo = (over: Record<string, unknown> = {}) => ({
  empleadoId: EMPLEADO,
  categoria: 'retraso',
  fecha: '2026-11-12',
  comentario: '  Llega tarde por cita médica  ',
  ...over,
});
const imagen = (over: Record<string, unknown> = {}) => ({
  nombreArchivo: 'foto.jpg',
  mime: 'image/jpeg',
  contenidoBase64: JPEG.toString('base64'),
  ...over,
});
const falla = (f: () => unknown, code: string, status = 400) =>
  expect(f).toThrow(expect.objectContaining({ code, status }));

describe('detectarMimeImagen', () => {
  it('reconoce JPEG, PNG y WebP por sus primeros bytes', () => {
    expect(detectarMimeImagen(JPEG)).toBe('image/jpeg');
    expect(detectarMimeImagen(PNG)).toBe('image/png');
    expect(detectarMimeImagen(WEBP)).toBe('image/webp');
  });

  it('no reconoce un PDF, un SVG ni un fichero vacío', () => {
    expect(detectarMimeImagen(Buffer.from('%PDF-1.4'))).toBeNull();
    expect(detectarMimeImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(detectarMimeImagen(Buffer.alloc(0))).toBeNull();
  });
});

describe('validarNuevaNota', () => {
  it('devuelve la nota con el comentario recortado y sin imagen', () => {
    expect(validarNuevaNota(cuerpo())).toEqual({
      empleadoId: EMPLEADO,
      categoria: 'retraso',
      fecha: '2026-11-12',
      comentario: 'Llega tarde por cita médica',
      imagen: null,
    });
  });

  it('decodifica la imagen', () => {
    const n = validarNuevaNota(cuerpo({ imagen: imagen() }));
    expect(n.imagen?.mime).toBe('image/jpeg');
    expect(n.imagen?.contenido.equals(JPEG)).toBe(true);
  });

  it('un empleadoId que no es un UUID es un 404, como una ficha que no existe', () => {
    falla(() => validarNuevaNota(cuerpo({ empleadoId: 'e1' })), 'empleado_no_encontrado', 404);
  });

  it('un cuerpo que no es un objeto no revienta', () => {
    falla(() => validarNuevaNota(null), 'empleado_no_encontrado', 404);
  });

  it('rechaza una categoría desconocida', () => {
    falla(() => validarNuevaNota(cuerpo({ categoria: 'vacaciones' })), 'categoria_invalida');
  });

  it('rechaza una fecha imposible', () => {
    falla(() => validarNuevaNota(cuerpo({ fecha: '2026-02-30' })), 'fecha_invalida');
  });

  it('rechaza un comentario en blanco', () => {
    falla(() => validarNuevaNota(cuerpo({ comentario: '   ' })), 'comentario_vacio');
  });

  it('rechaza un comentario de más de 2000 caracteres', () => {
    falla(() => validarNuevaNota(cuerpo({ comentario: 'x'.repeat(2001) })), 'comentario_demasiado_largo');
  });

  it('rechaza una imagen sin nombre', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ nombreArchivo: ' ' }) })), 'nombre_archivo_invalido');
  });

  it('rechaza un formato que no es JPEG, PNG ni WebP', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ mime: 'image/svg+xml' }) })), 'imagen_no_admitida');
  });

  it('CANDADO: rechaza una imagen cuyos bytes no casan con el formato declarado', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ mime: 'image/png' }) })), 'imagen_no_admitida');
  });

  it('rechaza una imagen que dice ser JPEG y está vacía', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ contenidoBase64: '' }) })), 'imagen_no_admitida');
  });

  it('rechaza una imagen de más de 8 MB sin llegar a decodificarla', () => {
    const enorme = 'A'.repeat(12 * 1024 * 1024); // ~9 MB una vez decodificado
    falla(() => validarNuevaNota(cuerpo({ imagen: imagen({ contenidoBase64: enorme }) })), 'imagen_demasiado_grande');
  });

  it('una imagen que no es un objeto no se admite', () => {
    falla(() => validarNuevaNota(cuerpo({ imagen: 'foto.jpg' })), 'imagen_no_admitida');
  });
});

describe('validarCambioNota', () => {
  it('sin ningún campo reconocido es sin_cambios', () => {
    falla(() => validarCambioNota({ nada: 1 }), 'sin_cambios');
  });

  it('admite cambiar solo el estado', () => {
    expect(validarCambioNota({ estado: 'resuelta' })).toEqual({ estado: 'resuelta' });
  });

  it('rechaza un estado desconocido', () => {
    falla(() => validarCambioNota({ estado: 'cerrada' }), 'estado_invalido');
  });

  it('imagen null significa quitarla, y viaja', () => {
    const c = validarCambioNota({ imagen: null });
    expect('imagen' in c).toBe(true);
    expect(c.imagen).toBeNull();
  });

  it('valida cada campo que trae', () => {
    expect(
      validarCambioNota({ empleadoId: EMPLEADO, categoria: 'otro', fecha: '2026-10-01', comentario: ' Otro ', imagen: imagen() }),
    ).toMatchObject({ empleadoId: EMPLEADO, categoria: 'otro', fecha: '2026-10-01', comentario: 'Otro' });
    falla(() => validarCambioNota({ comentario: '' }), 'comentario_vacio');
  });
});
```

- [ ] **Step 2: Comprobar que falla**

Run: `npx vitest run src/ausencias/notas.test.ts`
Expected: FAIL, `detectarMimeImagen is not a function` (o error de import).

- [ ] **Step 3: Crear `service/notas.ts`**

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import { esFechaValida } from '../dias-habiles.js';
import { AusenciaError } from '../errores.js';
import * as repo from '../repo.js';
import type { ImagenCompletaDeNota } from '../repo.js';
import {
  CATEGORIAS_NOTA,
  ESTADOS_NOTA,
  MIMES_IMAGEN_NOTA,
  type CambioNota,
  type CategoriaNota,
  type EstadoNota,
  type ImagenNuevaDeNota,
  type MimeImagenNota,
  type Nota,
  type NuevaNota,
} from '../types.js';
import { MAX_ADJUNTO_BYTES } from './validacion.js';

// Las notas personales del administrador (migración 076): la validación pura y
// la orquestación. service.ts lo reexporta (lo vigila barril.test.ts).
//
// Quién puede llamar a esto lo decide el router (`requireAdmin`); de quién es
// cada nota lo decide el SQL (`autor_email`). Aquí no se repite ninguna de las
// dos: un candado duplicado esconde el día que el otro se rompe.

const MAX_COMENTARIO_NOTA = 2000;
const MAX_NOMBRE_IMAGEN = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * El formato real de una imagen, leído de sus primeros bytes. `null` si no es
 * ninguno de los tres admitidos.
 *
 * Existe porque la imagen se pinta DENTRO de la página: fiarse del MIME que
 * declara el cliente dejaría colar otra cosa con la etiqueta de una foto.
 */
export function detectarMimeImagen(b: Buffer): MimeImagenNota | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(FIRMA_PNG)) return 'image/png';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function comoObjeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

// Un id que no es un UUID haría que Postgres contestara con un error de tipo
// (un 500). Para quien llama es lo mismo que una ficha que no existe.
function validarEmpleadoId(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new AusenciaError('empleado_no_encontrado', 404, 'empleadoId');
  return v;
}

function validarCategoria(v: unknown): CategoriaNota {
  if (!(CATEGORIAS_NOTA as readonly unknown[]).includes(v)) throw new AusenciaError('categoria_invalida', 400, 'categoria');
  return v as CategoriaNota;
}

function validarEstado(v: unknown): EstadoNota {
  if (!(ESTADOS_NOTA as readonly unknown[]).includes(v)) throw new AusenciaError('estado_invalido', 400, 'estado');
  return v as EstadoNota;
}

function validarFecha(v: unknown): string {
  if (typeof v !== 'string' || !esFechaValida(v)) throw new AusenciaError('fecha_invalida', 400, 'fecha');
  return v;
}

function validarComentario(v: unknown): string {
  const c = typeof v === 'string' ? v.trim() : '';
  if (!c) throw new AusenciaError('comentario_vacio', 400, 'comentario');
  if (c.length > MAX_COMENTARIO_NOTA) throw new AusenciaError('comentario_demasiado_largo', 400, 'comentario');
  return c;
}

function validarImagen(v: unknown): ImagenNuevaDeNota {
  if (typeof v !== 'object' || v === null) throw new AusenciaError('imagen_no_admitida', 400, 'imagen');
  const a = v as Record<string, unknown>;
  const nombreArchivo = String(a.nombreArchivo ?? '').trim();
  const mime = String(a.mime ?? '');
  const contenidoBase64 = String(a.contenidoBase64 ?? '');

  if (!nombreArchivo || nombreArchivo.length > MAX_NOMBRE_IMAGEN) {
    throw new AusenciaError('nombre_archivo_invalido', 400, 'imagen');
  }
  if (!(MIMES_IMAGEN_NOTA as readonly string[]).includes(mime)) throw new AusenciaError('imagen_no_admitida', 400, 'imagen');
  // Se estima el tamaño ANTES de decodificar, como con los PDF: no tiene sentido
  // materializar un buffer enorme solo para descubrir que sobra. La estimación
  // nunca se queda corta —los bytes decodificados nunca son más que 3/4 del
  // texto—, así que no hace falta volver a medir después.
  if (Math.floor((contenidoBase64.length * 3) / 4) > MAX_ADJUNTO_BYTES) {
    throw new AusenciaError('imagen_demasiado_grande', 400, 'imagen');
  }
  const contenido = Buffer.from(contenidoBase64, 'base64');
  if (detectarMimeImagen(contenido) !== mime) throw new AusenciaError('imagen_no_admitida', 400, 'imagen');
  return { nombreArchivo, mime: mime as MimeImagenNota, contenido };
}

/** Valida el cuerpo de un alta. La existencia de la ficha la mira `crearNota`. */
export function validarNuevaNota(body: unknown): NuevaNota {
  const b = comoObjeto(body);
  return {
    empleadoId: validarEmpleadoId(b.empleadoId),
    categoria: validarCategoria(b.categoria),
    fecha: validarFecha(b.fecha),
    comentario: validarComentario(b.comentario),
    imagen: b.imagen === undefined || b.imagen === null ? null : validarImagen(b.imagen),
  };
}

/** Valida el cuerpo de una edición: solo los campos que trae, y al menos uno. */
export function validarCambioNota(body: unknown): CambioNota {
  const b = comoObjeto(body);
  const cambio: CambioNota = {};
  if (b.empleadoId !== undefined) cambio.empleadoId = validarEmpleadoId(b.empleadoId);
  if (b.categoria !== undefined) cambio.categoria = validarCategoria(b.categoria);
  if (b.fecha !== undefined) cambio.fecha = validarFecha(b.fecha);
  if (b.comentario !== undefined) cambio.comentario = validarComentario(b.comentario);
  if (b.estado !== undefined) cambio.estado = validarEstado(b.estado);
  if (b.imagen !== undefined) cambio.imagen = b.imagen === null ? null : validarImagen(b.imagen);
  if (Object.keys(cambio).length === 0) throw new AusenciaError('sin_cambios', 400);
  return cambio;
}

// Un id de nota que no es un UUID no puede ser de nadie: 404 sin preguntar a la base.
function exigirIdDeNota(id: string): void {
  if (!UUID.test(id)) throw new AusenciaError('nota_no_encontrada', 404);
}

/** El nombre de una ficha ACTIVA, o 404. Es lo que se copia en la nota. */
async function nombreDeFicha(db: Pool, empleadoId: string): Promise<string> {
  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404, 'empleadoId');
  return empleado.nombreCompleto;
}

export async function listarNotas(db: Pool, autorEmail: string): Promise<Nota[]> {
  return repo.notasDeAutor(db, autorEmail);
}

export async function crearNota(db: Pool, autorEmail: string, body: unknown): Promise<Nota> {
  const datos = validarNuevaNota(body);
  return repo.insertarNota(db, autorEmail, await nombreDeFicha(db, datos.empleadoId), datos);
}

export async function editarNota(db: Pool, autorEmail: string, id: string, body: unknown): Promise<Nota> {
  exigirIdDeNota(id);
  const cambio = validarCambioNota(body);
  const empleadoNombre = cambio.empleadoId === undefined ? undefined : await nombreDeFicha(db, cambio.empleadoId);
  const nota = await repo.actualizarNota(db, id, autorEmail, cambio, empleadoNombre);
  // 404 y no 403 cuando es ajena: no se confirma que exista.
  if (!nota) throw new AusenciaError('nota_no_encontrada', 404);
  return nota;
}

export async function borrarNota(db: Pool, autorEmail: string, id: string): Promise<void> {
  exigirIdDeNota(id);
  if (!(await repo.eliminarNota(db, id, autorEmail))) throw new AusenciaError('nota_no_encontrada', 404);
}

export async function descargarImagenDeNota(db: Pool, autorEmail: string, id: string): Promise<ImagenCompletaDeNota> {
  exigirIdDeNota(id);
  const imagen = await repo.imagenDeNota(db, id, autorEmail);
  if (!imagen) throw new AusenciaError('imagen_no_encontrada', 404);
  return imagen;
}
```

- [ ] **Step 4: Reexportarlo en `service.ts`**

Al final de `apps/hub-api/src/ausencias/service.ts`, detrás de `export * from './service/retiro.js';`:

```ts

// ── Notas personales del administrador ─────────────────────────────────────

// En service/notas.ts: la validación pura y la orquestación. Se reexporta todo.
export * from './service/notas.js';
```

- [ ] **Step 5: Añadir el trozo a `service/barril.test.ts`**

Detrás de `import * as modificaciones from './modificaciones.js';` añadir:

```ts
import * as notas from './notas.js';
```

y en `TROZOS`, detrás de `modificaciones,`:

```ts
  notas,
```

- [ ] **Step 6: Comprobar que pasan**

Run: `npx vitest run src/ausencias/notas.test.ts src/ausencias/service/barril.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit -p .`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/ausencias/service/notas.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/service/barril.test.ts apps/hub-api/src/ausencias/notas.test.ts
git commit -m "feat(ausencias): validacion y servicio de las notas personales"
```

---

### Task 5: Rutas y parser de 12 MB

**Files:**
- Modify: `apps/hub-api/src/ausencias/router.ts:972` (antes de `return router;`)
- Modify: `apps/hub-api/src/index.ts:67`
- Modify: `apps/hub-api/src/ausencias/router.test.ts` (`app()` ~1667 y un `describe` nuevo al final)
- Modify: `apps/hub-api/src/ausencias/notas.estatico.test.ts` (test del parser)

- [ ] **Step 1: Escribir los tests de las rutas que fallan**

1a. En `router.test.ts`, dentro de `function app()`, detrás de `a.use('/api/ausencias/solicitudes', express.json({ limit: '12mb' }));` (~1667), añadir:

```ts
  a.use('/api/ausencias/notas', express.json({ limit: '12mb' }));
```

1b. Al final de `router.test.ts`, añadir:

```ts
describe('notas personales del administrador', () => {
  const ADMIN = 'admin@ambientalia.com.co';
  const OTRO_ADMIN = 'otro.admin@ambientalia.com.co';
  const EMPLEADO = '11111111-1111-4111-8111-111111111111';
  const CUALQUIERA = '33333333-3333-4333-8333-333333333333';
  const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64');
  const admin = (sub = ADMIN) => token({ sub, role: 'admin' });
  const pedir = (metodo: 'get' | 'post' | 'patch' | 'delete', ruta: string, tok = admin()) =>
    request(app())[metodo](`/api/ausencias${ruta}`).set('Authorization', `Bearer ${tok}`);
  const alta = (over: Record<string, unknown> = {}, tok = admin()) =>
    pedir('post', '/notas', tok).send({
      empleadoId: EMPLEADO,
      categoria: 'retraso',
      fecha: '2026-11-12',
      comentario: 'Llega tarde',
      ...over,
    });

  beforeEach(() => {
    estado.plantilla.push({ id: EMPLEADO, nombreCompleto: 'Beto Díaz', correo: 'beto.diaz@ambientalia.com.co', activo: true });
  });

  it.each([
    ['get', '/notas'],
    ['post', '/notas'],
    ['patch', `/notas/${CUALQUIERA}`],
    ['delete', `/notas/${CUALQUIERA}`],
    ['get', `/notas/${CUALQUIERA}/imagen`],
  ] as const)('CANDADO: %s %s sin ser admin → 403', async (metodo, ruta) => {
    await pedir(metodo, ruta, token()).expect(403);
  });

  it('crea la nota con el nombre de la ficha y la devuelve en la lista', async () => {
    const r = await alta().expect(201);
    expect(r.body).toMatchObject({ empleadoNombre: 'Beto Díaz', categoria: 'retraso', estado: 'abierta', imagen: null });
    const l = await pedir('get', '/notas').expect(200);
    expect(l.body.notas.map((n: any) => n.id)).toEqual([r.body.id]);
  });

  it('404 si la persona no es una ficha activa', async () => {
    const r = await alta({ empleadoId: '22222222-2222-4222-8222-222222222222' }).expect(404);
    expect(r.body.error).toBe('empleado_no_encontrado');
  });

  it('400 con el codigo y el campo de la validacion', async () => {
    const r = await alta({ categoria: 'vacaciones' }).expect(400);
    expect(r.body).toMatchObject({ error: 'categoria_invalida', field: 'categoria' });
  });

  it('CANDADO: acepta una foto de ~7,5 MB (parser propio de 12 MB)', async () => {
    const foto = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(7.5 * 1024 * 1024)]);
    const r = await alta({ imagen: { nombreArchivo: 'foto.jpg', mime: 'image/jpeg', contenidoBase64: foto.toString('base64') } }).expect(201);
    expect(r.body.imagen).toMatchObject({ mime: 'image/jpeg', bytes: foto.length });
  });

  it('sirve la imagen con su tipo, en linea y sin dejar que el navegador lo adivine', async () => {
    const { body } = await alta({ imagen: { nombreArchivo: 'f.jpg', mime: 'image/jpeg', contenidoBase64: JPEG_B64 } }).expect(201);
    const r = await pedir('get', `/notas/${body.id}/imagen`).expect(200);
    expect(r.headers['content-type']).toContain('image/jpeg');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-disposition']).toBe('inline');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('404 al pedir la imagen de una nota que no tiene', async () => {
    const { body } = await alta().expect(201);
    const r = await pedir('get', `/notas/${body.id}/imagen`).expect(404);
    expect(r.body.error).toBe('imagen_no_encontrada');
  });

  it('PATCH marca resuelta y reabre', async () => {
    const { body } = await alta().expect(201);
    const resuelta = await pedir('patch', `/notas/${body.id}`).send({ estado: 'resuelta' }).expect(200);
    expect(resuelta.body.estado).toBe('resuelta');
    expect(resuelta.body.resueltaAt).not.toBeNull();
    const abierta = await pedir('patch', `/notas/${body.id}`).send({ estado: 'abierta' }).expect(200);
    expect(abierta.body).toMatchObject({ estado: 'abierta', resueltaAt: null });
  });

  it('PATCH sin ningun campo → 400 sin_cambios', async () => {
    const { body } = await alta().expect(201);
    const r = await pedir('patch', `/notas/${body.id}`).send({}).expect(400);
    expect(r.body.error).toBe('sin_cambios');
  });

  it('PATCH con otra persona copia su nombre', async () => {
    const OTRA = '44444444-4444-4444-8444-444444444444';
    estado.plantilla.push({ id: OTRA, nombreCompleto: 'Carla Gómez', correo: 'carla@ambientalia.com.co', activo: true });
    const { body } = await alta().expect(201);
    const r = await pedir('patch', `/notas/${body.id}`).send({ empleadoId: OTRA }).expect(200);
    expect(r.body).toMatchObject({ empleadoId: OTRA, empleadoNombre: 'Carla Gómez' });
  });

  it('DELETE → 204 y la nota desaparece de la lista', async () => {
    const { body } = await alta().expect(201);
    await pedir('delete', `/notas/${body.id}`).expect(204);
    expect((await pedir('get', '/notas').expect(200)).body.notas).toEqual([]);
  });

  it('CANDADO: la nota de otro administrador es un 404, no un 403', async () => {
    const { body } = await alta({ imagen: { nombreArchivo: 'f.jpg', mime: 'image/jpeg', contenidoBase64: JPEG_B64 } }).expect(201);
    const otro = admin(OTRO_ADMIN);
    expect((await pedir('get', '/notas', otro).expect(200)).body.notas).toEqual([]);
    await pedir('patch', `/notas/${body.id}`, otro).send({ estado: 'resuelta' }).expect(404);
    await pedir('delete', `/notas/${body.id}`, otro).expect(404);
    await pedir('get', `/notas/${body.id}/imagen`, otro).expect(404);
  });

  it('404 con un id de nota que no es un UUID', async () => {
    const r = await pedir('delete', '/notas/no-es-uuid').expect(404);
    expect(r.body.error).toBe('nota_no_encontrada');
  });
});
```

1c. En `notas.estatico.test.ts`, añadir al final:

```ts
describe('index.ts', () => {
  it('CANDADO: /api/ausencias/notas tiene su parser de 12 MB, registrado ANTES del global de 2 MB', () => {
    // Si el de 2 MB corre primero, cualquier foto de móvil da 413 y este nunca
    // llega a verla. router.test.ts monta su propia app y no puede cazarlo.
    expect(leer('../index.ts')).toMatch(
      /app\.use\('\/api\/ausencias\/notas', express\.json\(\{ limit: '12mb' \}\)\);[\s\S]*app\.use\(express\.json\(\{ limit: '2mb' \}\)\);/,
    );
  });
});
```

- [ ] **Step 2: Comprobar que fallan**

Run: `npx vitest run src/ausencias/router.test.ts -t "notas personales" src/ausencias/notas.estatico.test.ts`
Expected: FAIL. Las rutas dan 404 de Express y el test de `index.ts` no encuentra la línea.

- [ ] **Step 3: Añadir las rutas en `router.ts`**

Justo antes de `  return router;` (línea ~972):

```ts
  // ── Notas personales del administrador ───────────────────────────────────
  //
  // `requireAdmin` es el candado de verdad: la pestaña escondida no bastaría.
  // De quién es cada nota lo decide el SQL (`autor_email`, migración 076), así
  // que la nota de otro administrador es un 404 y no un 403.

  router.get('/ausencias/notas', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json({ notas: await service.listarNotas(db, sesionDe(req).email) });
    } catch (e) {
      sendError(res, e, 'ausencias_notas_listar');
    }
  });

  router.post('/ausencias/notas', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.status(201).json(await service.crearNota(db, sesionDe(req).email, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_notas_crear');
    }
  });

  router.patch('/ausencias/notas/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.editarNota(db, sesionDe(req).email, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_notas_editar');
    }
  });

  router.delete('/ausencias/notas/:id', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      await service.borrarNota(db, sesionDe(req).email, req.params.id);
      res.status(204).end();
    } catch (e) {
      sendError(res, e, 'ausencias_notas_borrar');
    }
  });

  router.get('/ausencias/notas/:id/imagen', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const imagen = await service.descargarImagenDeNota(db, sesionDe(req).email, req.params.id);
      res.setHeader('Content-Type', imagen.mime);
      // `inline` a secas, sin el nombre: lo escribe el cliente, y un carácter
      // fuera de ASCII en una cabecera hace que Node lance (un 500). Para
      // pintarla en la página no hace falta.
      res.setHeader('Content-Disposition', 'inline');
      // El tipo ya está comprobado por sus primeros bytes al subirla; esto
      // impide además que el navegador se ponga a adivinar otro.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.send(imagen.contenido);
    } catch (e) {
      sendError(res, e, 'ausencias_notas_imagen');
    }
  });

```

- [ ] **Step 4: Montar el parser en `index.ts`**

Detrás de `app.use('/api/ausencias/solicitudes', express.json({ limit: '12mb' }));` (línea 67) añadir:

```ts

// Las notas personales del administrador pueden llevar una foto (hasta 8 MB,
// ~11 MB en base64): misma excepción y mismo orden que la línea de arriba.
app.use('/api/ausencias/notas', express.json({ limit: '12mb' }));
```

- [ ] **Step 5: Comprobar que pasan**

Run: `npx vitest run src/ausencias/router.test.ts src/ausencias/notas.estatico.test.ts`
Expected: PASS, todo el fichero de router incluido.

- [ ] **Step 6: Suite unitaria completa con cobertura**

Run: `npm test`
Expected: PASS, y sin incumplir el umbral `src/ausencias/{!(repo).ts,service/*.ts}` (95 % de líneas, funciones y sentencias; 85 % de ramas). Si `service/notas.ts` o `router.ts` quedan por debajo, añadir el test que falte (sin bajar el umbral).

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/ausencias/router.ts apps/hub-api/src/index.ts apps/hub-api/src/ausencias/router.test.ts apps/hub-api/src/ausencias/notas.estatico.test.ts
git commit -m "feat(ausencias): rutas de las notas personales, solo para el administrador"
```

---

### Task 6: API y módulo puro del front

**Files:**
- Modify: `apps/ausencias/src/api/tipos.ts` (añadir al final)
- Create: `apps/ausencias/src/api/notas.ts`
- Modify: `apps/ausencias/src/api.ts` (añadir al final)
- Modify: `apps/ausencias/src/api/barril.test.ts`
- Create: `apps/ausencias/src/notas.ts`
- Create: `apps/ausencias/src/notas.test.ts`

- [ ] **Step 1: Tipos espejo al final de `api/tipos.ts`**

```ts
// ── Notas personales del administrador ─────────────────────────────────────
// Espejo manual de los tipos de hub-api (ausencias/types.ts): mismos nombres.

export type CategoriaNota = 'retraso' | 'solicitud' | 'otro';
export type EstadoNota = 'abierta' | 'resuelta';

export interface ImagenDeNota {
  id: string;
  nombreArchivo: string;
  mime: string;
  bytes: number;
}

export interface Nota {
  id: string;
  /** `null` si la ficha se borró: la nota conserva el nombre copiado. */
  empleadoId: string | null;
  empleadoNombre: string;
  categoria: CategoriaNota;
  /** `YYYY-MM-DD`. */
  fecha: string;
  comentario: string;
  estado: EstadoNota;
  resueltaAt: string | null;
  createdAt: string;
  updatedAt: string;
  imagen: ImagenDeNota | null;
}

/** Una imagen tal como viaja a hub-api. */
export interface ImagenSubida {
  nombreArchivo: string;
  mime: string;
  contenidoBase64: string;
}

export interface NotaNueva {
  empleadoId: string;
  categoria: CategoriaNota;
  fecha: string;
  comentario: string;
  imagen?: ImagenSubida;
}

/** Solo lo que cambia. `imagen: null` = quitarla. */
export interface CambioNota {
  empleadoId?: string;
  categoria?: CategoriaNota;
  fecha?: string;
  comentario?: string;
  estado?: EstadoNota;
  imagen?: ImagenSubida | null;
}
```

- [ ] **Step 2: Escribir el test del módulo puro que falla**

Crear `apps/ausencias/src/notas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Nota } from './api';
import { errorDeImagen, fechaCorta, filtrarNotas, ordenarNotas, textoDeErrorDeNota } from './notas';

const nota = (over: Partial<Nota> = {}): Nota => ({
  id: 'n1',
  empleadoId: 'e1',
  empleadoNombre: 'Ana Ruiz',
  categoria: 'retraso',
  fecha: '2026-11-12',
  comentario: 'Llega tarde',
  estado: 'abierta',
  resueltaAt: null,
  createdAt: '2026-11-12T10:00:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
  imagen: null,
  ...over,
});

describe('filtrarNotas', () => {
  const notas = [
    nota({ id: 'a' }),
    nota({ id: 'b', estado: 'resuelta', categoria: 'otro' }),
    nota({ id: 'c', categoria: 'solicitud', empleadoNombre: 'Beto Díaz' }),
  ];
  const ids = (f: Parameters<typeof filtrarNotas>[1]) => filtrarNotas(notas, f).map((n) => n.id);

  it('por estado', () => {
    expect(ids({ categoria: '', estado: 'abierta', empleadoNombre: '' })).toEqual(['a', 'c']);
    expect(ids({ categoria: '', estado: 'resuelta', empleadoNombre: '' })).toEqual(['b']);
    expect(ids({ categoria: '', estado: 'todas', empleadoNombre: '' })).toEqual(['a', 'b', 'c']);
  });

  it('por categoría y por persona', () => {
    expect(ids({ categoria: 'solicitud', estado: 'todas', empleadoNombre: '' })).toEqual(['c']);
    expect(ids({ categoria: '', estado: 'todas', empleadoNombre: 'Ana Ruiz' })).toEqual(['a', 'b']);
  });
});

describe('ordenarNotas', () => {
  it('por fecha descendente y, a igual fecha, la última escrita primero', () => {
    const r = ordenarNotas([
      nota({ id: 'vieja', fecha: '2026-11-01' }),
      nota({ id: 'temprano', fecha: '2026-11-12', createdAt: '2026-11-12T08:00:00.000Z' }),
      nota({ id: 'tarde', fecha: '2026-11-12', createdAt: '2026-11-12T18:00:00.000Z' }),
    ]);
    expect(r.map((n) => n.id)).toEqual(['tarde', 'temprano', 'vieja']);
  });
});

describe('fechaCorta', () => {
  it('pasa YYYY-MM-DD a DD/MM/YYYY', () => {
    expect(fechaCorta('2026-11-02')).toBe('02/11/2026');
  });
});

describe('errorDeImagen', () => {
  it('admite JPEG, PNG y WebP de hasta 8 MB', () => {
    expect(errorDeImagen({ type: 'image/png', size: 1000 })).toBeNull();
  });

  it('rechaza otros formatos', () => {
    expect(errorDeImagen({ type: 'image/gif', size: 1000 })).toMatch(/JPG, PNG o WebP/);
  });

  it('rechaza más de 8 MB y dice cuánto pesa', () => {
    expect(errorDeImagen({ type: 'image/jpeg', size: 9 * 1024 * 1024 })).toMatch(/9\.0 MB/);
  });
});

describe('textoDeErrorDeNota', () => {
  it('traduce los códigos de hub-api y deja pasar el resto', () => {
    expect(textoDeErrorDeNota('imagen_no_admitida')).toMatch(/JPG, PNG o WebP/);
    expect(textoDeErrorDeNota('Tu sesión ha caducado.')).toBe('Tu sesión ha caducado.');
  });
});
```

- [ ] **Step 3: Comprobar que falla**

Run (desde `apps/ausencias`): `npx vitest run src/notas.test.ts`
Expected: FAIL, no encuentra `./notas`.

- [ ] **Step 4: Crear `apps/ausencias/src/notas.ts`**

```ts
import type { CategoriaNota, EstadoNota, Nota } from './api';

// Las notas personales del administrador: lo que se puede decidir sin pantalla.
// Vive aquí, con tests, y no dentro de los componentes, que no tienen ninguno.

export const CATEGORIAS_NOTA: { id: CategoriaNota; label: string }[] = [
  { id: 'retraso', label: 'Informar retraso' },
  { id: 'solicitud', label: 'Solicitudes' },
  { id: 'otro', label: 'Otros' },
];

export const ETIQUETA_CATEGORIA: Record<CategoriaNota, string> = {
  retraso: 'Informar retraso',
  solicitud: 'Solicitudes',
  otro: 'Otros',
};

/** Espejo de los topes de hub-api: avisar aquí ahorra subir 8 MB para nada. */
export const MAX_COMENTARIO = 2000;
export const MAX_IMAGEN_BYTES = 8 * 1024 * 1024;
export const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

export interface FiltrosNotas {
  /** `''` = todas, el mismo convenio que el resto de filtros de la app. */
  categoria: CategoriaNota | '';
  estado: EstadoNota | 'todas';
  /** Por nombre y no por id: una nota de una ficha borrada no tiene id. */
  empleadoNombre: string;
}

export function filtrarNotas(notas: Nota[], f: FiltrosNotas): Nota[] {
  return notas.filter(
    (n) =>
      (!f.categoria || n.categoria === f.categoria) &&
      (f.estado === 'todas' || n.estado === f.estado) &&
      (!f.empleadoNombre || n.empleadoNombre === f.empleadoNombre),
  );
}

/** El mismo orden que devuelve hub-api, para recolocar una nota recién guardada. */
export function ordenarNotas(notas: Nota[]): Nota[] {
  return [...notas].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.createdAt.localeCompare(a.createdAt));
}

export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** El motivo para no aceptar el fichero, o `null` si vale. */
export function errorDeImagen(f: { type: string; size: number }): string | null {
  if (!MIMES_IMAGEN.includes(f.type)) return 'La imagen tiene que ser JPG, PNG o WebP.';
  if (f.size > MAX_IMAGEN_BYTES) {
    return `La imagen pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.`;
  }
  return null;
}

// `mensajeDeError` (@suite/http) devuelve tal cual el código de un 400; aquí se
// pone en palabras. Lo que no está en la lista ya viene redactado y pasa igual.
const MENSAJES: Record<string, string> = {
  categoria_invalida: 'Elige una categoría.',
  estado_invalido: 'Ese estado no existe.',
  fecha_invalida: 'La fecha no es válida.',
  comentario_vacio: 'Escribe un comentario.',
  comentario_demasiado_largo: `El comentario no puede pasar de ${MAX_COMENTARIO} caracteres.`,
  sin_cambios: 'No hay nada que guardar.',
  nombre_archivo_invalido: 'El nombre del archivo no es válido.',
  imagen_no_admitida: 'La imagen tiene que ser JPG, PNG o WebP de verdad, no solo por la extensión.',
  imagen_demasiado_grande: 'La imagen pasa de 8 MB.',
};

export function textoDeErrorDeNota(mensaje: string): string {
  return MENSAJES[mensaje] ?? mensaje;
}
```

- [ ] **Step 5: Crear `apps/ausencias/src/api/notas.ts`**

```ts
import { authHeaders } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
import { API_BASE, get, patch, post } from './http';
import type { CambioNota, Nota, NotaNueva } from './tipos';

// Las notas personales del administrador. Las cinco rutas contestan 403 a quien
// no lo sea, y ese 403 es el candado de verdad (requireAdmin en hub-api).

const ruta = (id: string) => `/api/ausencias/notas/${encodeURIComponent(id)}`;

export const fetchNotas = () => get<{ notas: Nota[] }>('/api/ausencias/notas').then((d) => d.notas);

export const crearNota = (n: NotaNueva) => post<Nota>('/api/ausencias/notas', n);

export const editarNota = (id: string, c: CambioNota) => patch<Nota>(ruta(id), c);

export async function borrarNota(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}${ruta(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
}

/**
 * La imagen como URL de objeto, lista para un `<img>`. La ruta pide el token, así
 * que no vale un `src` directo. Quien la pide tiene que revocarla al soltarla.
 */
export async function urlDeImagenDeNota(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}${ruta(id)}/imagen`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  return URL.createObjectURL(await res.blob());
}
```

- [ ] **Step 6: Reexportarlo y añadirlo al barril**

En `apps/ausencias/src/api.ts`, detrás de `export * from './api/kpis';`:

```ts
export * from './api/notas';
```

En `apps/ausencias/src/api/barril.test.ts`, detrás de `import * as modificaciones from './modificaciones';`:

```ts
import * as notas from './notas';
```

y en `TROZOS`, detrás de `modificaciones,`:

```ts
  notas,
```

- [ ] **Step 7: Comprobar que pasan**

Run (desde `apps/ausencias`): `npx vitest run src/notas.test.ts src/api/barril.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add apps/ausencias/src/api/tipos.ts apps/ausencias/src/api/notas.ts apps/ausencias/src/api.ts apps/ausencias/src/api/barril.test.ts apps/ausencias/src/notas.ts apps/ausencias/src/notas.test.ts
git commit -m "feat(ausencias): api y modulo puro de las notas personales en el front"
```

---

### Task 7: Formulario de alta y edición

**Files:**
- Create: `apps/ausencias/src/FormularioNota.tsx`

- [ ] **Step 1: Crear el componente**

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  crearNota,
  editarNota,
  leerComoBase64,
  type CambioNota,
  type CategoriaNota,
  type EmpleadoConJefatura,
  type ImagenSubida,
  type Nota,
} from './api';
import { hoyEnColombia } from './dominio';
import { CATEGORIAS_NOTA, MAX_COMENTARIO, MIMES_IMAGEN, errorDeImagen, textoDeErrorDeNota } from './notas';

interface Props {
  /** Las fichas activas: de aquí se elige quién lo solicita. */
  empleados: EmpleadoConJefatura[];
  /** `null` = alta; si no, la nota que se edita. */
  nota: Nota | null;
  onGuardada: (n: Nota) => void;
  onCancelar: () => void;
}

export default function FormularioNota({ empleados, nota, onGuardada, onCancelar }: Props) {
  const [empleadoId, setEmpleadoId] = useState(nota?.empleadoId ?? '');
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState<CategoriaNota>(nota?.categoria ?? 'solicitud');
  const [fecha, setFecha] = useState(nota?.fecha ?? hoyEnColombia());
  const [comentario, setComentario] = useState(nota?.comentario ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [quitarImagen, setQuitarImagen] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // La URL de la vista previa retiene el fichero en memoria hasta revocarla.
  useEffect(() => {
    if (!archivo) {
      setVistaPrevia(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setVistaPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  // La persona elegida se queda en la lista aunque no case con la búsqueda: si
  // desapareciera del <select>, el navegador enseñaría otra que nadie eligió.
  const opciones = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    return empleados
      .filter((e) => e.id === empleadoId || !q || e.nombreCompleto.toLocaleLowerCase('es').includes(q))
      .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
  }, [empleados, busqueda, empleadoId]);

  // Una nota cuya persona ya no es una ficha activa (retirada o borrada): se
  // enseña su nombre copiado para que el <select> no aparente otra cosa.
  const fueraDeLaLista = nota !== null && !empleados.some((e) => e.id === nota.empleadoId);

  function elegirArchivo(f: File | undefined) {
    if (!f) return;
    const problema = errorDeImagen(f);
    if (problema) {
      setError(problema);
      setArchivo(null);
      return;
    }
    setError(null);
    setArchivo(f);
    setQuitarImagen(false);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!nota && !empleadoId) {
      setError('Elige la persona que lo solicita.');
      return;
    }
    const texto = comentario.trim();
    if (!texto) {
      setError('Escribe un comentario.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const imagen: ImagenSubida | undefined = archivo
        ? { nombreArchivo: archivo.name, mime: archivo.type, contenidoBase64: await leerComoBase64(archivo) }
        : undefined;
      if (!nota) {
        onGuardada(await crearNota({ empleadoId, categoria, fecha, comentario: texto, imagen }));
        return;
      }
      // En la edición solo viaja lo que cambió: hub-api contesta `sin_cambios`
      // a un cuerpo vacío, y reenviar la persona de una ficha ya retirada daría
      // un 404 aunque nadie la hubiera tocado.
      const cambio: CambioNota = {};
      if (empleadoId && empleadoId !== nota.empleadoId) cambio.empleadoId = empleadoId;
      if (categoria !== nota.categoria) cambio.categoria = categoria;
      if (fecha !== nota.fecha) cambio.fecha = fecha;
      if (texto !== nota.comentario) cambio.comentario = texto;
      if (imagen) cambio.imagen = imagen;
      else if (quitarImagen) cambio.imagen = null;
      if (Object.keys(cambio).length === 0) {
        onCancelar();
        return;
      }
      onGuardada(await editarNota(nota.id, cambio));
    } catch (err) {
      setError(textoDeErrorDeNota((err as Error).message));
    } finally {
      setEnviando(false);
    }
  }

  const campoCls = 'w-full rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';
  const rotuloCls = 'mb-1 block font-medium text-gray-700';

  return (
    <form onSubmit={guardar} className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">{nota ? 'Editar nota' : 'Nueva nota'}</h4>
        <button type="button" onClick={onCancelar} aria-label="Cerrar" className="rounded-lg p-1 text-gray-500 hover:bg-gray-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-sm">
          <span className={rotuloCls}>Persona que lo solicita</span>
          <input
            type="search"
            aria-label="Buscar persona"
            placeholder="Buscar por nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${campoCls} mb-1`}
          />
          <select aria-label="Persona" value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} className={campoCls}>
            {fueraDeLaLista ? (
              <option value={nota.empleadoId ?? ''}>{nota.empleadoNombre} (ya no está en la plantilla)</option>
            ) : (
              <option value="">— Elige una persona —</option>
            )}
            {opciones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombreCompleto}
              </option>
            ))}
          </select>
        </div>

        <div className="text-sm">
          <span className={rotuloCls}>Fecha</span>
          <input type="date" aria-label="Fecha" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={campoCls} />
        </div>
      </div>

      <div className="text-sm">
        <span className={rotuloCls}>Categoría</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Categoría">
          {CATEGORIAS_NOTA.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={categoria === c.id}
              onClick={() => setCategoria(c.id)}
              className={`rounded-xl border px-3 py-1.5 text-sm ${
                categoria === c.id
                  ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-sm">
        <span className={rotuloCls}>Comentario</span>
        <textarea
          aria-label="Comentario"
          rows={3}
          maxLength={MAX_COMENTARIO}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          className={campoCls}
        />
        <span className="mt-0.5 block text-right text-xs text-gray-500">
          {comentario.length}/{MAX_COMENTARIO}
        </span>
      </div>

      <div className="text-sm">
        <span className={rotuloCls}>Imagen (opcional)</span>
        <input
          type="file"
          aria-label="Imagen"
          accept={MIMES_IMAGEN.join(',')}
          onChange={(e) => elegirArchivo(e.target.files?.[0])}
          className="text-sm"
        />
        {vistaPrevia && <img src={vistaPrevia} alt="Vista previa" className="mt-2 max-h-48 rounded-lg border border-gray-200" />}
        {nota?.imagen && !archivo && (
          <label className="mt-2 flex items-center gap-2 text-gray-700">
            <input type="checkbox" checked={quitarImagen} onChange={(e) => setQuitarImagen(e.target.checked)} />
            Quitar la imagen actual ({nota.imagen.nombreArchivo})
          </label>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {nota ? 'Guardar cambios' : 'Guardar nota'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Comprobar que compila**

Run (desde `apps/ausencias`): `npm run typecheck`
Expected: sin errores. Si TS no estrecha `nota` dentro de `{fueraDeLaLista ? ... nota.empleadoId ...}`, sustituir `nota.empleadoId ?? ''` por `nota?.empleadoId ?? ''` y `nota.empleadoNombre` por `nota?.empleadoNombre`.

- [ ] **Step 3: Commit**

```bash
git add apps/ausencias/src/FormularioNota.tsx
git commit -m "feat(ausencias): formulario de alta y edicion de las notas personales"
```

---

### Task 8: Panel y pestaña

**Files:**
- Create: `apps/ausencias/src/PanelNotas.tsx`
- Modify: `apps/ausencias/src/App.tsx` (imports, `PESTANAS_VALIDAS` :50-61, bloque `esAdmin` de las pestañas ~267-273, render ~824-836)

- [ ] **Step 1: Crear `PanelNotas.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { borrarNota, editarNota, fetchEmpleados, fetchNotas, urlDeImagenDeNota, type EmpleadoConJefatura, type Nota } from './api';
import FormularioNota from './FormularioNota';
import {
  CATEGORIAS_NOTA,
  ETIQUETA_CATEGORIA,
  fechaCorta,
  filtrarNotas,
  ordenarNotas,
  textoDeErrorDeNota,
  type FiltrosNotas,
} from './notas';

// Las notas personales del administrador: lo que le piden a mano y no pasa por
// el flujo de solicitudes —un aviso de retraso, una petición suelta—, con su
// estado para saber qué queda por atender.
//
// Solo la ve un administrador, y el 403 de hub-api es el candado de verdad:
// esconder la pestaña no bastaría. Además cada nota es de quien la escribe
// (migración 076): un segundo administrador no vería estas.

interface Props {
  /** Carga diferida: las pestañas quedan montadas y ocultas con `hidden`. */
  activo: boolean;
}

/** El formulario abierto: `null` = cerrado; `{ nota: null }` = alta; si no, edición. */
type Edicion = { nota: Nota | null } | null;

export default function PanelNotas({ activo }: Props) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoConJefatura[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Aparte de `error`, como en PanelAdjuntos: una acción fallida no invalida la
  // lista, así que no debe ocultarla.
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [filtros, setFiltros] = useState<FiltrosNotas>({ categoria: '', estado: 'abierta', empleadoNombre: '' });
  const [aBorrar, setABorrar] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [imagen, setImagen] = useState<{ notaId: string; url: string } | null>(null);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    setCargando(true);
    Promise.all([fetchNotas(), fetchEmpleados()])
      .then(([n, e]) => {
        if (!vivo) return;
        setNotas(n);
        setEmpleados(e.filter((x) => x.activo));
        setError(null);
      })
      .catch((e: Error) => {
        if (!vivo) return;
        // Se vacía a propósito: dejar la lista anterior bajo un banner de error
        // sería afirmar unos datos que ya no se sostienen.
        setNotas([]);
        setError(e.message);
      })
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [activo]);

  // La URL de objeto retiene la imagen en memoria hasta que se revoca: al
  // cambiar de imagen o al desmontar, se suelta la anterior.
  useEffect(
    () => () => {
      if (imagen) URL.revokeObjectURL(imagen.url);
    },
    [imagen],
  );

  const personas = useMemo(
    () => [...new Set(notas.map((n) => n.empleadoNombre))].sort((a, b) => a.localeCompare(b, 'es')),
    [notas],
  );
  const visibles = useMemo(() => filtrarNotas(notas, filtros), [notas, filtros]);

  function guardada(n: Nota) {
    setNotas((ns) => ordenarNotas([n, ...ns.filter((x) => x.id !== n.id)]));
    setEdicion(null);
    // Si se le cambió o quitó la imagen, la que estuviera abierta ya no es la suya.
    if (imagen?.notaId === n.id) setImagen(null);
  }

  function alternarEstado(n: Nota) {
    setOcupada(n.id);
    setErrorAccion(null);
    editarNota(n.id, { estado: n.estado === 'abierta' ? 'resuelta' : 'abierta' })
      .then((actual) => setNotas((ns) => ns.map((x) => (x.id === actual.id ? actual : x))))
      .catch((e: Error) => setErrorAccion(textoDeErrorDeNota(e.message)))
      .finally(() => setOcupada(null));
  }

  function borrar(id: string) {
    setOcupada(id);
    setErrorAccion(null);
    borrarNota(id)
      .then(() => {
        setNotas((ns) => ns.filter((x) => x.id !== id));
        setABorrar(null);
        if (imagen?.notaId === id) setImagen(null);
      })
      .catch((e: Error) => setErrorAccion(textoDeErrorDeNota(e.message)))
      .finally(() => setOcupada(null));
  }

  // La imagen solo se baja al pedirla: abrir la pestaña no descarga las fotos
  // de todas las notas.
  function alternarImagen(n: Nota) {
    if (imagen?.notaId === n.id) {
      setImagen(null);
      return;
    }
    setOcupada(n.id);
    setErrorAccion(null);
    urlDeImagenDeNota(n.id)
      .then((url) => setImagen({ notaId: n.id, url }))
      .catch((e: Error) => setErrorAccion(textoDeErrorDeNota(e.message)))
      .finally(() => setOcupada(null));
  }

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';
  const btnCls =
    'inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-900">Notas</h3>
          <p className="max-w-3xl text-sm text-gray-600">
            Lo que te piden a mano y no pasa por una solicitud: avisos de retraso, peticiones sueltas y otros asuntos.
            Solo las ves tú.
          </p>
        </div>
        {!edicion && (
          <button
            type="button"
            onClick={() => setEdicion({ nota: null })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Nueva nota
          </button>
        )}
      </div>

      {edicion && (
        <FormularioNota
          key={edicion.nota?.id ?? 'nueva'}
          empleados={empleados}
          nota={edicion.nota}
          onGuardada={guardada}
          onCancelar={() => setEdicion(null)}
        />
      )}

      {(error ?? errorAccion) && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? errorAccion}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          aria-label="Filtrar por categoría"
          value={filtros.categoria}
          onChange={(e) => setFiltros((f) => ({ ...f, categoria: e.target.value as FiltrosNotas['categoria'] }))}
          className={selCls}
        >
          <option value="">Todas las categorías</option>
          {CATEGORIAS_NOTA.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por estado"
          value={filtros.estado}
          onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value as FiltrosNotas['estado'] }))}
          className={selCls}
        >
          <option value="abierta">Abiertas</option>
          <option value="resuelta">Resueltas</option>
          <option value="todas">Todas</option>
        </select>
        <select
          aria-label="Filtrar por persona"
          value={filtros.empleadoNombre}
          onChange={(e) => setFiltros((f) => ({ ...f, empleadoNombre: e.target.value }))}
          className={selCls}
        >
          <option value="">Todas las personas</option>
          {personas.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : error ? null : visibles.length === 0 ? (
        <p className="text-sm text-gray-500">
          {notas.length === 0 ? 'Todavía no hay notas.' : 'Ninguna nota coincide con los filtros.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {visibles.map((n) => (
            <li key={n.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-900">{fechaCorta(n.fecha)}</span>
                <span className="text-gray-700">{n.empleadoNombre}</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {ETIQUETA_CATEGORIA[n.categoria]}
                </span>
                {n.estado === 'resuelta' && (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Resuelta</span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{n.comentario}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {n.imagen && (
                  <button type="button" disabled={ocupada === n.id} onClick={() => alternarImagen(n)} className={btnCls}>
                    <Paperclip className="h-3.5 w-3.5" /> {imagen?.notaId === n.id ? 'Ocultar imagen' : 'Ver imagen'}
                  </button>
                )}
                <button type="button" disabled={ocupada === n.id} onClick={() => alternarEstado(n)} className={btnCls}>
                  {n.estado === 'abierta' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Marcar resuelta
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                    </>
                  )}
                </button>
                <button type="button" disabled={ocupada === n.id} onClick={() => setEdicion({ nota: n })} className={btnCls}>
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
                {aBorrar === n.id ? (
                  <span className="inline-flex items-center gap-2 text-xs text-red-700">
                    ¿Borrar esta nota?
                    <button
                      type="button"
                      disabled={ocupada === n.id}
                      onClick={() => borrar(n.id)}
                      className="rounded-lg bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Sí, borrar
                    </button>
                    <button type="button" onClick={() => setABorrar(null)} className={btnCls}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" disabled={ocupada === n.id} onClick={() => setABorrar(n.id)} className={btnCls}>
                    <Trash2 className="h-3.5 w-3.5" /> Borrar
                  </button>
                )}
              </div>
              {imagen?.notaId === n.id && (
                <img
                  src={imagen.url}
                  alt={`Imagen de la nota del ${fechaCorta(n.fecha)}`}
                  className="mt-2 max-h-96 rounded-lg border border-gray-200"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Registrar la pestaña en `App.tsx`**

2a. Detrás de `import PanelKpis from './PanelKpis';` añadir:

```tsx
import PanelNotas from './PanelNotas';
```

2b. En `PESTANAS_VALIDAS`, detrás de `'kpis',`:

```ts
  'notas',
```

2c. En el bloque `if (contexto?.esAdmin) { ... }` de `pestanas`, sustituir:

```tsx
      p.push(['empleados', 'Empleados'], ['organigrama', 'Organigrama'], ['saldos', 'Saldos']);
```

por:

```tsx
      // Las notas van dentro de `esAdmin` y sin llave propia: hoy solo hay un
      // administrador, y cada nota es además de quien la escribe (migración 076).
      p.push(['empleados', 'Empleados'], ['organigrama', 'Organigrama'], ['saldos', 'Saldos'], ['notas', 'Notas']);
```

2d. En el render, dentro del fragmento `{contexto.esAdmin && (<> ... </>)}`, detrás del `<div>` de `saldos` (el que contiene `<PanelSaldos ... />`), añadir:

```tsx
                <div className={tab === 'notas' ? '' : 'hidden'}>
                  <PanelNotas activo={tab === 'notas'} />
                </div>
```

- [ ] **Step 3: Comprobar tipos, tests y build**

Run (desde `apps/ausencias`): `npm run typecheck`
Expected: sin errores. Si TS se queja de algún `Record<Pestana, …>` al que le falta `notas`, añadirle la clave.

Run: `npm test`
Expected: PASS (incluido `App.test.tsx`: `PanelNotas` se monta oculto y con `activo={false}`, así que no llama a hub-api).

Run: `npm run build`
Expected: build en verde.

- [ ] **Step 4: Commit**

```bash
git add apps/ausencias/src/PanelNotas.tsx apps/ausencias/src/App.tsx
git commit -m "feat(ausencias): pestana Notas para el administrador"
```

---

### Task 9: Falsar los candados

Cada candado se rompe en el código de verdad y tiene que matar **exactamente** su test. Ya está todo commiteado, así que se revierte con `git checkout -- <fichero>` y se comprueba con hash.

- [ ] **Step 1: Apuntar los hashes de partida**

Run (desde la raíz): `git hash-object apps/hub-api/src/ausencias/repo/notas.ts apps/hub-api/src/ausencias/service/notas.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/index.ts`
Guardar la salida.

- [ ] **Step 2: Mutaciones de hub-api, una por una**

Para cada fila: aplicar la mutación con Edit, correr el comando y confirmar que cae el test indicado (y solo los de su familia), revertir con `git checkout -- <fichero>`.

| # | Fichero | Mutación | Comando | Debe caer |
|---|---|---|---|---|
| 1 | `repo/notas.ts` | En `notasDeAutor`, `WHERE n.autor_email = $1` → `WHERE $1::text IS NOT NULL` | BD: `src/ausencias/repo.notas.db.test.ts` | «otro autor no la lista» |
| 2 | `repo/notas.ts` | En `actualizarNota`, quitar `AND autor_email = $${valores.length}` (y `valores.push(id)` sin el autor) | BD, mismo fichero | «otro autor no la edita, ni le quita la imagen» |
| 3 | `repo/notas.ts` | En `eliminarNota`, quitar `AND autor_email = $2` y su parámetro | BD | «otro autor no la borra» |
| 4 | `repo/notas.ts` | En `imagenDeNota`, quitar `AND n.autor_email = $2` y su parámetro | BD | «otro autor no descarga su imagen» |
| 5 | `repo/notas.ts` | `COALESCE(resuelta_at, NOW())` → `NOW()` | BD | «volver a marcarla resuelta conserva la primera fecha» |
| 6 | `service/notas.ts` | Borrar la línea `if (detectarMimeImagen(contenido) !== mime) ...` | `npx vitest run src/ausencias/notas.test.ts` | «CANDADO: rechaza una imagen cuyos bytes no casan» |
| 7 | `router.ts` | En `router.post('/ausencias/notas', ...)`, quitar `requireAdmin, ` | `npx vitest run src/ausencias/router.test.ts -t "notas personales"` | «CANDADO: post /notas sin ser admin → 403» |
| 8 | `index.ts` | Borrar `app.use('/api/ausencias/notas', express.json({ limit: '12mb' }));` | `npx vitest run src/ausencias/notas.estatico.test.ts` | «CANDADO: /api/ausencias/notas tiene su parser» |

Si alguna mutación **no** mata su test, el test pasa por vacuidad: arreglar el test (no la mutación) antes de seguir.

- [ ] **Step 3: Confirmar que todo volvió a su sitio**

Run: `git hash-object apps/hub-api/src/ausencias/repo/notas.ts apps/hub-api/src/ausencias/service/notas.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/index.ts`
Expected: idéntico al Step 1. Run: `git status --short` → ningún fichero modificado de la rama.

---

### Task 10: Verificación completa, documentación y entrega

**Files:**
- Modify: `docs/superpowers/specs/2026-11-12-notas-personales-design.md` (§4 Errores y estado)

- [ ] **Step 1: Suites completas**

Desde `apps/hub-api`:
- `npx tsc --noEmit -p .` → sin errores.
- `npm test` → PASS con los umbrales de cobertura.
- `npm run test:db` → PASS. El total tiene que ser el de `main` + 21 tests y + 1 fichero (`repo.notas.db.test.ts`). Para saber el de `main`, mirar la salida de `test:db` en la Task 3 Step 7 o, si no se apuntó, restar 21 al total de ahora y comprobar que `repo.notas.db.test.ts` aporta exactamente 21. Nunca `git stash` sin rutas: el `.gitignore` modificado del usuario se iría con él.

Desde `apps/ausencias`:
- `npm run typecheck`, `npm test` y `npm run build` → en verde.

- [ ] **Step 2: Ajustar la especificación a lo construido**

En `docs/superpowers/specs/2026-11-12-notas-personales-design.md`, §4 «Errores», sustituir el punto del 403:

```markdown
- **403** `solo_administrador` si la sesión no es `admin`. Es el candado de verdad: la
  pestaña oculta no basta.
```

por:

```markdown
- **403** `forbidden` si la sesión no es `admin`: las rutas van detrás de
  `requireAuth, requireAdmin`, como el resto de rutas de administración. Es el candado de
  verdad: la pestaña oculta no basta.
```

y en la lista de 400 añadir `nombre_archivo_invalido`. Añadir también: «**404** `imagen_no_encontrada` al pedir la imagen de una nota que no tiene o que es ajena.» En «Imagen», precisar que la descarga va con `Content-Disposition: inline` sin nombre de fichero. Cambiar la línea **Estado** de la cabecera a «implementado en la rama `feat/ausencias-notas`; pendiente de desplegar hub-api y el portal».

- [ ] **Step 3: Commit de la documentación**

```bash
git add docs/superpowers/specs/2026-11-12-notas-personales-design.md docs/superpowers/plans/2026-11-12-notas-personales.md
git commit -m "docs(ausencias): la especificacion de las notas refleja lo construido"
```

- [ ] **Step 4: Mezclar y empujar**

```bash
git switch main
git pull --ff-only
git merge --no-ff feat/ausencias-notas -m "merge: notas personales del administrador en Vacaciones y Permisos"
git push origin main
git branch -d feat/ausencias-notas
```

Empujar no despliega: el despliegue lo hace el usuario a mano en EasyPanel. Avisarle del orden: **hub-api primero** (aplica la migración 076) y **el portal después**. Mientras solo esté hub-api, la pestaña no existe y nada cambia para nadie.

- [ ] **Step 5: Comprobación en navegador real, tras el despliegue**

Pedir permiso al usuario antes, porque escribe en producción (una nota de prueba que se borra al final). Con la extensión de Chrome (`mcp__claude-in-chrome__*`), en una pestaña nueva del portal en producción:

1. Abrir Vacaciones y Permisos → pestaña **Notas**: aparece, y sin notas dice «Todavía no hay notas.».
2. **Nueva nota**: elegir una persona con el buscador, categoría *Informar retraso*, fecha de hoy, un comentario y una imagen JPG pequeña. Comprobar que la vista previa se pinta antes de guardar.
3. Guardar → la nota aparece en la lista con su chip y «Ver imagen». Pulsarlo → la imagen se pinta (con altura real, no cero).
4. **Marcar resuelta** → desaparece con el filtro *Abiertas* y aparece con *Resueltas*.
5. **Editar** → cambiar la categoría a *Otros* y marcar «Quitar la imagen actual» → guardar → ya no sale «Ver imagen».
6. **Borrar** → confirmar dentro de la fila → la nota desaparece.
7. `read_console_messages` con `pattern: "error|Error"` → sin errores.

Si algún paso falla, parar y contárselo al usuario antes de tocar nada.
