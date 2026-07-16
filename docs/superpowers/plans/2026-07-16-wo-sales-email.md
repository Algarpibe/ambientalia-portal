# WO-sales — Envío automático por correo (Fase 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hub-api decide cuándo enviar el `.xls` de pedidos y a quién; n8n consulta por horario y envía. Destinatarios configurables desde la app WO-sales.

**Architecture:** Endpoints nuevos en hub-api: dos para n8n (autenticados por un token de cron, no JWT) que devuelven el archivo si cambió y confirman el envío; cuatro para el CRUD de destinatarios (auth normal por app). La detección de cambios es un hash del contenido del archivo, que solo avanza al confirmar. El flujo de n8n se crea al final por el MCP ya conectado.

**Tech Stack:** Node 20 + TypeScript ESM (imports `.js`), Express 4, `pg` vía `@algarpibe/zoho-sync`, `xlsx`, vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-07-16-wo-sales-email-design.md`

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `apps/hub-api/src/users/migrations/004_wo_sales_email.sql` | Las dos tablas nuevas. |
| `apps/hub-api/src/db.ts` | *(modificar)* añadir la migración al array `MIGRATIONS`. |
| `apps/hub-api/src/auth.ts` | *(modificar)* `requireCronToken`. |
| `apps/hub-api/src/wo-sales/config.ts` | *(modificar)* `emailAsunto`. |
| `apps/hub-api/src/wo-sales/types.ts` | *(modificar)* `Recipient`, `EmailEstado`, `EmailPendiente`, `ResumenEmail`. |
| `apps/hub-api/src/wo-sales/email.repo.ts` | Acceso a datos: destinatarios (CRUD), estado (leer/guardar), OV cambiadas. |
| `apps/hub-api/src/wo-sales/email.ts` | Dominio: hash, decisión de envío, cuerpo del correo. |
| `apps/hub-api/src/wo-sales/router.ts` | *(modificar)* los 6 endpoints. |
| `apps/hub-api/.env.example` | *(modificar)* `WO_SALES_CRON_TOKEN`. |
| `apps/WO-sales/src/Destinatarios.tsx` | Panel de gestión de destinatarios. |
| `apps/WO-sales/src/App.tsx` | *(modificar)* montar el panel. |
| *(n8n)* | El workflow, creado por el MCP al final. |

Orden: migración → auth cron → tipos/config → datos → dominio → endpoints → UI → n8n.

---

## Task 1: Migración — tablas de destinatarios y estado

**Files:**
- Create: `apps/hub-api/src/users/migrations/004_wo_sales_email.sql`
- Modify: `apps/hub-api/src/db.ts`

- [ ] **Step 1: Crear la migración**

`apps/hub-api/src/users/migrations/004_wo_sales_email.sql`:

```sql
-- Destinatarios del correo automático de WO-sales, configurables desde la app.
CREATE TABLE IF NOT EXISTS portal.wo_sales_recipients (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL,
  nombre      TEXT        NOT NULL,
  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estado del envío: una única fila (id=1). ultimo_hash = huella del último archivo
-- CONFIRMADO como enviado. Sirve para no reenviar lo mismo y para no perder un envío
-- si el correo falla (el hash solo avanza al confirmar).
CREATE TABLE IF NOT EXISTS portal.wo_sales_email_estado (
  id              INTEGER     PRIMARY KEY CHECK (id = 1),
  ultimo_hash     TEXT,
  ultimo_envio_at TIMESTAMPTZ
);
```

Nota: `pgcrypto` (para `gen_random_uuid`) ya lo habilita `001_create_users.sql`, que corre antes. El esquema `portal` también lo crea esa migración.

- [ ] **Step 2: Registrar la migración en el array**

En `apps/hub-api/src/db.ts`, línea ~24, añadir el fichero al array (las migraciones NO se leen por readdir, es una lista explícita):

```ts
const MIGRATIONS = ['001_create_users.sql', '002_add_avatar.sql', '003_add_preferences.sql', '004_wo_sales_email.sql'];
```

- [ ] **Step 3: Compilar y copiar migraciones (el build las mete en dist)**

Run: `npm run build --workspace=apps/hub-api`
Expected: `tsc -b` sin errores. (El Dockerfile ya hace `cp -R src/users/migrations dist/users/`.)

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/users/migrations/004_wo_sales_email.sql apps/hub-api/src/db.ts
git commit -m "feat(WO-sales): migracion de destinatarios y estado del correo"
```

---

## Task 2: `requireCronToken` — auth de los endpoints de n8n

**Files:**
- Modify: `apps/hub-api/src/auth.ts`
- Test: `apps/hub-api/src/auth.requireCronToken.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`apps/hub-api/src/auth.requireCronToken.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { requireCronToken } from './auth.js';

function res(): Response {
  const r: Partial<Response> = {};
  r.status = vi.fn().mockReturnValue(r as Response);
  r.json = vi.fn().mockReturnValue(r as Response);
  return r as Response;
}
function reqCon(token?: string): Request {
  return { header: (h: string) => (h === 'X-WO-Sales-Cron-Token' ? token : undefined) } as unknown as Request;
}

describe('requireCronToken', () => {
  beforeEach(() => { process.env.WO_SALES_CRON_TOKEN = 'secreto-123'; });
  afterEach(() => { delete process.env.WO_SALES_CRON_TOKEN; });

  it('deja pasar si la cabecera coincide con el secreto', () => {
    const next = vi.fn();
    requireCronToken(reqCon('secreto-123'), res(), next);
    expect(next).toHaveBeenCalled();
  });

  it('401 si la cabecera no coincide', () => {
    const r = res();
    const next = vi.fn();
    requireCronToken(reqCon('otro'), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('401 si falta la cabecera', () => {
    const r = res();
    const next = vi.fn();
    requireCronToken(reqCon(undefined), r, next);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('401 (fail-closed) si el secreto no está configurado en el entorno', () => {
    delete process.env.WO_SALES_CRON_TOKEN;
    const r = res();
    const next = vi.fn();
    requireCronToken(reqCon('lo-que-sea'), r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test --workspace=apps/hub-api -- auth.requireCronToken`
Expected: FAIL — `requireCronToken` no exportado.

- [ ] **Step 3: Añadir `requireCronToken` al final de `apps/hub-api/src/auth.ts`**

```ts
/**
 * Auth máquina-a-máquina para los endpoints que consume n8n. No es JWT de usuario:
 * compara una cabecera secreta contra WO_SALES_CRON_TOKEN. Fail-closed: si el secreto
 * no está configurado, no pasa nadie.
 */
export function requireCronToken(req: Request, res: Response, next: NextFunction): void {
  const esperado = process.env.WO_SALES_CRON_TOKEN;
  const recibido = req.header('X-WO-Sales-Cron-Token');
  if (esperado && recibido && recibido === esperado) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}
```

Si `Request`/`Response`/`NextFunction` no están ya importados, añadir `import type { Request, Response, NextFunction } from 'express';`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm run test --workspace=apps/hub-api -- auth.requireCronToken`
Expected: PASS (4 tests)

- [ ] **Step 5: Documentar el env y commit**

Añadir a `apps/hub-api/.env.example`:
```
# Secreto que n8n manda en la cabecera X-WO-Sales-Cron-Token para los endpoints de envío.
WO_SALES_CRON_TOKEN=
```

```bash
git add apps/hub-api/src/auth.ts apps/hub-api/src/auth.requireCronToken.test.ts apps/hub-api/.env.example
git commit -m "feat(hub-api): requireCronToken para los endpoints de n8n"
```

---

## Task 3: Tipos y configuración

**Files:**
- Modify: `apps/hub-api/src/wo-sales/types.ts`
- Modify: `apps/hub-api/src/wo-sales/config.ts`

- [ ] **Step 1: Añadir tipos a `types.ts`**

```ts
export interface Recipient {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
}

export interface EmailEstado {
  ultimoHash: string | null;
  ultimoEnvioAt: string | null;
}

export interface ResumenEmail {
  ordenes: number;
  filas: number;
  cambiadas: string[];
  advertencias: number;
}

export type EmailPendiente =
  | { enviar: false }
  | {
      enviar: true;
      xlsBase64: string;
      nombreArchivo: string;
      destinatarios: { email: string; nombre: string }[];
      asunto: string;
      cuerpo: string;
      resumen: ResumenEmail;
      token: string;
    };
```

- [ ] **Step 2: Añadir el asunto a `config.ts`**

En la interfaz `WoSalesConfig`:
```ts
  /** Asunto (y encabezado del cuerpo) del correo automático. */
  emailAsunto: string;
```
En `DEFAULT_CONFIG`:
```ts
  emailAsunto: 'Nueva actualización de MovimientoInventarioWO',
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run build --workspace=apps/hub-api`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/wo-sales/types.ts apps/hub-api/src/wo-sales/config.ts
git commit -m "feat(WO-sales): tipos y asunto del correo automatico"
```

---

## Task 4: Capa de datos (`email.repo.ts`)

**Files:**
- Create: `apps/hub-api/src/wo-sales/email.repo.ts`

No lleva test propio: son queries parametrizadas thin (mismo criterio que `hub.source.ts`, que tampoco tiene test de DB). El dominio (Task 5) sí se testea.

- [ ] **Step 1: Crear `email.repo.ts`**

```ts
import type { Pool } from '@algarpibe/zoho-sync';
import type { EmailEstado, Recipient } from './types.js';
import type { WoSalesConfig } from './config.js';
import type { SalesOrderFiltro } from './source.js';

interface FilaRecipient {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
}
const mapRecipient = (r: FilaRecipient): Recipient => ({
  id: r.id,
  email: r.email,
  nombre: r.nombre,
  activo: r.activo,
});

export async function listarDestinatarios(db: Pool): Promise<Recipient[]> {
  const { rows } = await db.query(
    'SELECT id, email, nombre, activo FROM portal.wo_sales_recipients ORDER BY created_at'
  );
  return (rows as FilaRecipient[]).map(mapRecipient);
}

export async function listarActivos(db: Pool): Promise<Recipient[]> {
  const { rows } = await db.query(
    'SELECT id, email, nombre, activo FROM portal.wo_sales_recipients WHERE activo = TRUE ORDER BY created_at'
  );
  return (rows as FilaRecipient[]).map(mapRecipient);
}

export async function crearDestinatario(db: Pool, email: string, nombre: string): Promise<Recipient> {
  const { rows } = await db.query(
    'INSERT INTO portal.wo_sales_recipients (email, nombre) VALUES ($1, $2) RETURNING id, email, nombre, activo',
    [email, nombre]
  );
  return mapRecipient(rows[0] as FilaRecipient);
}

export async function setActivo(db: Pool, id: string, activo: boolean): Promise<Recipient | null> {
  const { rows } = await db.query(
    'UPDATE portal.wo_sales_recipients SET activo = $2 WHERE id = $1 RETURNING id, email, nombre, activo',
    [id, activo]
  );
  return rows.length ? mapRecipient(rows[0] as FilaRecipient) : null;
}

export async function borrarDestinatario(db: Pool, id: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM portal.wo_sales_recipients WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function leerEstado(db: Pool): Promise<EmailEstado> {
  const { rows } = await db.query(
    'SELECT ultimo_hash, ultimo_envio_at::text AS ultimo_envio_at FROM portal.wo_sales_email_estado WHERE id = 1'
  );
  if (!rows.length) return { ultimoHash: null, ultimoEnvioAt: null };
  return { ultimoHash: rows[0].ultimo_hash, ultimoEnvioAt: rows[0].ultimo_envio_at };
}

export async function guardarEstado(db: Pool, hash: string): Promise<void> {
  // Upsert de la fila singleton (id=1): avanza el hash y sella la fecha.
  await db.query(
    `INSERT INTO portal.wo_sales_email_estado (id, ultimo_hash, ultimo_envio_at)
     VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET ultimo_hash = EXCLUDED.ultimo_hash, ultimo_envio_at = EXCLUDED.ultimo_envio_at`,
    [hash]
  );
}

/**
 * Números de OV vivas del rango modificadas después de `desde` (mejor esfuerzo, para el
 * cuerpo del correo). Si `desde` es null (primer envío), devuelve todas las del rango.
 */
export async function cambiadasDesde(
  db: Pool,
  config: WoSalesConfig,
  filtro: SalesOrderFiltro,
  desde: string | null
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT salesorder_number FROM books.sales_orders
      WHERE status = ANY($1::text[]) AND date >= $2::date AND date <= $3::date
        AND ($4::timestamptz IS NULL OR zoho_last_modified > $4::timestamptz)
      ORDER BY salesorder_number`,
    [config.estadosVivos, filtro.desde, filtro.hasta, desde]
  );
  return (rows as { salesorder_number: string }[]).map((r) => r.salesorder_number);
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run build --workspace=apps/hub-api`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/hub-api/src/wo-sales/email.repo.ts
git commit -m "feat(WO-sales): capa de datos del correo (destinatarios, estado, cambiadas)"
```

---

## Task 5: Dominio (`email.ts`) — hash, decisión de envío, cuerpo

**Files:**
- Create: `apps/hub-api/src/wo-sales/email.ts`
- Test: `apps/hub-api/src/wo-sales/email.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

`apps/hub-api/src/wo-sales/email.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashMatriz, construirCuerpo, decidirEnvio } from './email.js';
import { DEFAULT_CONFIG } from './config.js';

describe('hashMatriz', () => {
  it('la misma matriz da el mismo hash (estable)', () => {
    const m = [['a', 'b'], ['1', '2']];
    expect(hashMatriz(m)).toBe(hashMatriz([['a', 'b'], ['1', '2']]));
  });
  it('una celda distinta cambia el hash', () => {
    expect(hashMatriz([['a', 'b'], ['1', '2']])).not.toBe(hashMatriz([['a', 'b'], ['1', '3']]));
  });
  it('una fila de menos (OV que sale) cambia el hash', () => {
    expect(hashMatriz([['a'], ['1'], ['2']])).not.toBe(hashMatriz([['a'], ['1']]));
  });
});

describe('decidirEnvio', () => {
  it('sin_cambios cuando el hash coincide con el último enviado', () => {
    expect(decidirEnvio('abc', 'abc', true)).toBe('sin_cambios');
  });
  it('enviar cuando el hash cambió y hay destinatarios', () => {
    expect(decidirEnvio('abc', 'viejo', true)).toBe('enviar');
  });
  it('sin_destinatarios cuando cambió pero no hay a quién enviar', () => {
    expect(decidirEnvio('abc', 'viejo', false)).toBe('sin_destinatarios');
  });
  it('sin_cambios manda sobre la falta de destinatarios (no hay nada que enviar)', () => {
    expect(decidirEnvio('abc', 'abc', false)).toBe('sin_cambios');
  });
});

describe('construirCuerpo', () => {
  it('incluye el asunto, los totales y las OV cambiadas', () => {
    const cuerpo = construirCuerpo(
      { ordenes: 3, filas: 7, cambiadas: ['OV-2026-138', 'OV-2026-077'], advertencias: 0 },
      DEFAULT_CONFIG
    );
    expect(cuerpo).toContain('Nueva actualización de MovimientoInventarioWO');
    expect(cuerpo).toContain('3');
    expect(cuerpo).toContain('7');
    expect(cuerpo).toContain('OV-2026-138');
  });
  it('menciona las advertencias solo si las hay', () => {
    const con = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 5 }, DEFAULT_CONFIG);
    expect(con).toContain('5');
    const sin = construirCuerpo({ ordenes: 1, filas: 1, cambiadas: [], advertencias: 0 }, DEFAULT_CONFIG);
    expect(sin.toLowerCase()).not.toContain('advertencia');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm run test --workspace=apps/hub-api -- wo-sales/email`
Expected: FAIL — no se resuelve `./email.js`.

- [ ] **Step 3: Crear `email.ts`**

```ts
import { createHash } from 'node:crypto';
import type { Pool } from '@algarpibe/zoho-sync';
import type { WoSalesConfig } from './config.js';
import type { EmailPendiente, ResumenEmail } from './types.js';
import type { SalesOrderSource, SalesOrderFiltro } from './source.js';
import { buildWorldOfficeCsv } from './builder.js';
import { buildWorldOfficeXlsx } from './xlsx.js';
import { cambiadasDesde, guardarEstado, leerEstado, listarActivos } from './email.repo.js';

/** Huella estable del contenido del archivo. Cubre OV nueva, modificada y la que sale. */
export function hashMatriz(matriz: string[][]): string {
  return createHash('sha256').update(JSON.stringify(matriz)).digest('hex');
}

export type Decision = 'sin_cambios' | 'sin_destinatarios' | 'enviar';

/**
 * Decisión pura de envío. sin_cambios manda sobre todo (si el archivo es el mismo, no
 * hay nada que hacer aunque no haya destinatarios). Solo se envía si cambió Y hay a
 * quién. Con 'sin_destinatarios' el hash NO se avanza (ver computarPendiente), para que
 * el envío pendiente salga cuando se añada un destinatario.
 */
export function decidirEnvio(token: string, ultimoHash: string | null, hayDestinatarios: boolean): Decision {
  if (token === ultimoHash) return 'sin_cambios';
  if (!hayDestinatarios) return 'sin_destinatarios';
  return 'enviar';
}

export function construirCuerpo(resumen: ResumenEmail, config: WoSalesConfig): string {
  const lineas = [
    config.emailAsunto,
    '',
    'Se adjunta el archivo actualizado de pedidos para World Office.',
    `Órdenes de venta: ${resumen.ordenes} · Líneas de producto: ${resumen.filas}`,
  ];
  if (resumen.cambiadas.length) lineas.push(`OV con cambios: ${resumen.cambiadas.join(', ')}`);
  if (resumen.advertencias > 0) {
    lineas.push(`Advertencias: ${resumen.advertencias}. Revísalas en la app antes de subir el archivo.`);
  }
  return lineas.join('\n');
}

/**
 * Decide si hay que enviar y arma el payload para n8n. Envía solo si el archivo cambió
 * respecto del último CONFIRMADO y hay destinatarios activos. NO avanza el hash aquí
 * (eso lo hace confirmarEnvio): si n8n no confirma, el próximo ciclo reintenta.
 */
export async function computarPendiente(
  db: Pool,
  source: SalesOrderSource,
  config: WoSalesConfig,
  filtro: SalesOrderFiltro,
  nombreArchivo: string
): Promise<EmailPendiente> {
  const ordenes = await source.ordenesVivas(filtro);
  const { matriz, warnings } = buildWorldOfficeCsv(ordenes, config);
  const token = hashMatriz(matriz);

  const estado = await leerEstado(db);
  const destinatarios = await listarActivos(db);
  if (decidirEnvio(token, estado.ultimoHash, destinatarios.length > 0) !== 'enviar') {
    return { enviar: false };
  }

  const cambiadas = await cambiadasDesde(db, config, filtro, estado.ultimoEnvioAt);
  const resumen: ResumenEmail = {
    ordenes: ordenes.length,
    filas: matriz.length - 1,
    cambiadas,
    advertencias: warnings.length,
  };
  return {
    enviar: true,
    xlsBase64: buildWorldOfficeXlsx(matriz).toString('base64'),
    nombreArchivo,
    destinatarios: destinatarios.map((d) => ({ email: d.email, nombre: d.nombre })),
    asunto: config.emailAsunto,
    cuerpo: construirCuerpo(resumen, config),
    resumen,
    token,
  };
}

/** Marca ese hash como enviado. Idempotente. */
export async function confirmarEnvio(db: Pool, token: string): Promise<void> {
  await guardarEstado(db, token);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm run test --workspace=apps/hub-api -- wo-sales/email`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/wo-sales/email.ts apps/hub-api/src/wo-sales/email.test.ts
git commit -m "feat(WO-sales): dominio del correo (hash, decision de envio, cuerpo)"
```

---

## Task 6: Endpoints en el router

**Files:**
- Modify: `apps/hub-api/src/wo-sales/router.ts`

- [ ] **Step 1: Añadir imports al principio de `router.ts`**

```ts
import { requireAuth, requireApp, requireCronToken } from '../auth.js';
import { computarPendiente, confirmarEnvio } from './email.js';
import {
  listarDestinatarios,
  crearDestinatario,
  setActivo,
  borrarDestinatario,
} from './email.repo.js';
```
(fusiona el `requireCronToken` con el import de auth existente; no dupliques la línea.)

- [ ] **Step 2: Añadir los endpoints dentro de `createWoSalesRouter`, antes de `return router;`**

```ts
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // ── Para n8n (auth por token de cron, no JWT) ──
  router.get('/wo-sales/email/pendiente', requireCronToken, async (_req: Request, res: Response) => {
    try {
      const hoyIso = hoyEnBogota(new Date());
      const filtro: SalesOrderFiltro = { ...rangoPorDefecto(hoyIso) };
      const pendiente = await computarPendiente(db, source, DEFAULT_CONFIG, filtro, nombreArchivo(hoyIso, 'xls'));
      res.json(pendiente);
    } catch (e) {
      sendError(res, e, 'wo_sales_email_pendiente');
    }
  });

  router.post('/wo-sales/email/confirmado', requireCronToken, async (req: Request, res: Response) => {
    try {
      const token = (req.body as { token?: string } | undefined)?.token;
      if (!token) return void res.status(400).json({ error: 'missing token' });
      await confirmarEnvio(db, token);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, 'wo_sales_email_confirmado');
    }
  });

  // ── CRUD de destinatarios (auth por app) ──
  router.get('/wo-sales/destinatarios', requireAuth, requireApp(APP_ID), async (_req, res) => {
    try {
      res.json(await listarDestinatarios(db));
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_list');
    }
  });

  router.post('/wo-sales/destinatarios', requireAuth, requireApp(APP_ID), async (req, res) => {
    try {
      const { email, nombre } = (req.body ?? {}) as { email?: string; nombre?: string };
      if (!email || !EMAIL.test(email)) return void res.status(400).json({ error: 'email inválido' });
      if (!nombre?.trim()) return void res.status(400).json({ error: 'falta el nombre' });
      res.status(201).json(await crearDestinatario(db, email.trim(), nombre.trim()));
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_create');
    }
  });

  router.patch('/wo-sales/destinatarios/:id', requireAuth, requireApp(APP_ID), async (req, res) => {
    try {
      const activo = (req.body as { activo?: unknown } | undefined)?.activo;
      if (typeof activo !== 'boolean') return void res.status(400).json({ error: 'activo debe ser boolean' });
      const r = await setActivo(db, req.params.id, activo);
      if (!r) return void res.status(404).json({ error: 'no existe' });
      res.json(r);
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_patch');
    }
  });

  router.delete('/wo-sales/destinatarios/:id', requireAuth, requireApp(APP_ID), async (req, res) => {
    try {
      const ok = await borrarDestinatario(db, req.params.id);
      if (!ok) return void res.status(404).json({ error: 'no existe' });
      res.status(204).end();
    } catch (e) {
      sendError(res, e, 'wo_sales_destinatarios_delete');
    }
  });
```

Notas:
- El router recibe `db: Pool` como parámetro (`createWoSalesRouter(db)`) y ese es el que se usa aquí (NO `getHubPool()`).
- `sendError`, `hoyEnBogota`, `rangoPorDefecto`, `nombreArchivo`, `source`, `APP_ID`, `DEFAULT_CONFIG` ya existen en el fichero.
- No se usa `cached()`: el estado tiene que ser fresco.

- [ ] **Step 3: Verificar build y suite**

Run: `npm run build --workspace=apps/hub-api && npm run test --workspace=apps/hub-api`
Expected: build sin errores, todos los tests verdes.

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/wo-sales/router.ts
git commit -m "feat(WO-sales): endpoints de correo (n8n) y CRUD de destinatarios"
```

---

## Task 7: Panel de destinatarios en la SPA

**Files:**
- Create: `apps/WO-sales/src/Destinatarios.tsx`
- Modify: `apps/WO-sales/src/App.tsx`

- [ ] **Step 1: Crear `Destinatarios.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Trash2, Plus, Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface Recipient {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
}

export default function Destinatarios() {
  const [lista, setLista] = useState<Recipient[]>([]);
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const json = (extra: Record<string, string> = {}) => ({
    ...authHeaders(),
    'Content-Type': 'application/json',
    ...extra,
  });

  async function cargar() {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wo-sales/destinatarios`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setLista(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.');
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  async function añadir() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wo-sales/destinatarios`, {
        method: 'POST',
        headers: json(),
        body: JSON.stringify({ email, nombre }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
      setEmail('');
      setNombre('');
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo añadir.');
    } finally {
      setCargando(false);
    }
  }

  async function alternar(r: Recipient) {
    await fetch(`${API_BASE}/api/wo-sales/destinatarios/${r.id}`, {
      method: 'PATCH',
      headers: json(),
      body: JSON.stringify({ activo: !r.activo }),
    });
    await cargar();
  }

  async function borrar(id: string) {
    await fetch(`${API_BASE}/api/wo-sales/destinatarios/${id}`, { method: 'DELETE', headers: authHeaders() });
    await cargar();
  }

  return (
    <section className="bg-white rounded-2xl shadow-soft p-6 mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Destinatarios del correo automático</h2>
      <p className="text-sm text-gray-500 mb-4">
        Cuando cambian las órdenes de venta, el archivo se envía por correo a estas personas.
      </p>

      {error && (
        <p role="alert" className="text-sm text-rose-600 mb-3">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          className="border rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@dominio.com"
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <button
          onClick={añadir}
          disabled={cargando || !email.trim() || !nombre.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {cargando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Añadir
        </button>
      </div>

      <ul className="divide-y">
        {lista.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2 text-sm">
            <span className={r.activo ? '' : 'text-gray-400 line-through'}>
              {r.nombre} · <span className="font-mono">{r.email}</span>
            </span>
            <span className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={r.activo} onChange={() => alternar(r)} />
                <span className="text-gray-600">Activo</span>
              </label>
              <button onClick={() => borrar(r.id)} className="text-rose-600" title="Quitar">
                <Trash2 size={16} />
              </button>
            </span>
          </li>
        ))}
        {lista.length === 0 && <li className="py-2 text-sm text-gray-400">Aún no hay destinatarios.</li>}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Montar el panel en `App.tsx`**

Añadir el import junto a los demás:
```tsx
import Destinatarios from './Destinatarios';
```
Y renderizarlo al final del contenido de la página (después del bloque de vista previa / tabla, dentro del contenedor principal):
```tsx
      <Destinatarios />
```
(Colócalo donde tenga sentido en el layout — al final de la vista, no dentro de un condicional que dependa de `data`.)

- [ ] **Step 3: Verificar build de la SPA y del portal**

Run: `npm run build --workspace=apps/WO-sales && npm run build --workspace=apps/portal`
Expected: ambos sin errores TS.

- [ ] **Step 4: Commit**

```bash
git add apps/WO-sales/src/Destinatarios.tsx apps/WO-sales/src/App.tsx
git commit -m "feat(WO-sales): panel de destinatarios del correo en la app"
```

---

## Task 8: Desplegar y crear el flujo de n8n

Requiere el código anterior desplegado (endpoints vivos) y `WO_SALES_CRON_TOKEN` puesto en el env de hub-api.

- [ ] **Step 1: Configurar el secreto y desplegar**

En EasyPanel, servicio hub-api → variables de entorno → añadir `WO_SALES_CRON_TOKEN` con un valor aleatorio largo (p. ej. `openssl rand -hex 32`). Push a `origin/main` y redesplegar hub-api + portal.

- [ ] **Step 2: Smoke test en vivo (sin y con token)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.ambientalia.cloud/api/wo-sales/email/pendiente          # 401
curl -s -H "X-WO-Sales-Cron-Token: <TOKEN>" https://api.ambientalia.cloud/api/wo-sales/email/pendiente | head -c 200   # {"enviar":...}
```
Expected: 401 sin token; JSON con `enviar` con token.

- [ ] **Step 3: Crear el workflow en n8n (por el MCP conectado)**

Con el MCP `n8n-mcp` activo, crear un workflow "WO-sales — envío de pedidos" con estos nodos encadenados:
1. **Schedule Trigger** — cada 5 minutos.
2. **HTTP Request** — GET `https://api.ambientalia.cloud/api/wo-sales/email/pendiente`, cabecera `X-WO-Sales-Cron-Token: <TOKEN>`.
3. **IF** — condición `{{ $json.enviar }}` es `true`.
4. (rama true) **Convert base64 a binario** — a partir de `{{ $json.xlsBase64 }}`, nombre `{{ $json.nombreArchivo }}`, mime `application/vnd.ms-excel`.
5. **Send Email** — `to` = los `email` de `{{ $json.destinatarios }}`, `subject` = `{{ $json.asunto }}`, `text` = `{{ $json.cuerpo }}`, adjunto = el binario del paso 4. Configurar la credencial de correo de n8n.
6. **HTTP Request** — POST `.../api/wo-sales/email/confirmado`, misma cabecera, body `{ "token": "{{ $json.token }}" }`.

Activar el reintento del nodo Send Email. Validar el workflow con el MCP y activarlo.

- [ ] **Step 4: Verificar de punta a punta**

Añadir un destinatario de prueba desde la app, forzar un cambio (o esperar uno) y comprobar que llega el correo con el `.xls`, y que un segundo ciclo sin cambios NO reenvía.

---

## Cómo probar en local

1. `WO_SALES_CRON_TOKEN=test` en `apps/hub-api/.env`, arrancar hub-api y portal (ver el plan V1).
2. Login, asignar la app, entrar en WO-sales → añadir un destinatario en el panel.
3. `curl -H "X-WO-Sales-Cron-Token: test" http://localhost:3001/api/wo-sales/email/pendiente` → `enviar: true` con el `.xls` en base64.
4. `curl -X POST -H "X-WO-Sales-Cron-Token: test" -H "Content-Type: application/json" -d '{"token":"<el token devuelto>"}' http://localhost:3001/api/wo-sales/email/confirmado`
5. Repetir el GET → ahora `enviar: false` (mismo estado, ya confirmado).

---

## Verificación final

- [ ] `npm run test --workspace=apps/hub-api`
- [ ] `npm run build` (raíz)
- [ ] Endpoints probados en vivo (401 sin token; ciclo pendiente→confirmado→sin-cambios)
- [ ] Flujo de n8n activo y un correo de prueba recibido
