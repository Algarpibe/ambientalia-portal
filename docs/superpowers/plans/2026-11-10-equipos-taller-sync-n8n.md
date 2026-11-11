# Equipos en taller · Drive vía n8n — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que «Equipos en taller» deje de leer Google Drive con una cuenta de servicio (el Workspace de la empresa no deja compartir con ella) y lea la copia que manda n8n. Un flujo nuevo, «Equipos · Sincronizar remisiones», lista cada hora las tres carpetas con la credencial de Drive de n8n y manda a hub-api los listados y los textos. hub-api los guarda (migración 072) y se los entrega al núcleo con la misma interfaz de fuentes. La corrida diaria exige una sincronización completa reciente (`EQUIPOS_SYNC_MAX_HORAS`).

**Architecture:** El núcleo (`apps/hub-api/src/equipos/nucleo/`) **no se toca**. Alrededor, en `apps/hub-api/src/equipos/`, entran cuatro piezas:
- `sync.ts`: puro; carpetas, límites, validación de los cuerpos y la regla del listado sospechoso.
- `repo-sync.ts`: el SQL de `portal.equipos_drive_archivos` y `portal.equipos_sincronizacion`.
- `router-sync.ts`: las tres rutas de n8n, con `requireCronToken`.
- `fuente-n8n.ts`: las fuentes de Drive del núcleo, leídas de la copia; un archivo sin texto es un `FalloArchivo`.

`servicio.ts` cambia el barrido de la carpeta temporal por la comprobación de frescura, toma «configurado» de la base y deja de pasarle `exits` al núcleo (D10 del diseño). Se borra `fuente-drive.ts`. El flujo de n8n se construye por su MCP, inactivo y sin credenciales.

**Tech Stack:** Express 4 + TypeScript ESM (imports relativos con `.js`), `pg` vía `@algarpibe/zoho-sync`, Vitest 2 (unitarios en `vitest.config.ts`; Postgres real con Testcontainers en `vitest.db.config.ts`), supertest, Testing Library + jsdom en la sub-app, y n8n por `mcp__n8n-mcp__*`.

**Spec (contrato, no se reabre):** `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`. Vale la sección «Revisión del 10/11/2026: Drive vía n8n» y, con ella, D3, D5, D10, §3.3, §3.4, §4, §5.1, §5.3, §7 y §9.
**Rama:** `feat/equipos-taller-sync-n8n` (ya existe y está activa; no se cambia).

---

## Convenciones que importan aquí

- **Commits:** conventional commits, en español, **sin** líneas `Co-Authored-By` ni ninguna atribución.
- **Tests de hub-api:** se corren **desde `apps/hub-api`**, nunca desde la raíz. Desde la raíz, Vitest recoge los `*.db.test.ts` y salen unos 281 fallos falsos.
  - Unitarios: `cd apps/hub-api && npx vitest run <ruta>`.
  - Contra Postgres: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts <ruta>`. Necesita Docker Desktop encendido: Testcontainers levanta `postgres:17` y aplica TODAS las migraciones de `MIGRATIONS`.
- **Migraciones:** `initDb()` re-ejecuta todas en cada arranque. La 072 es DDL idempotente y **no siembra nada**.
- **No se toca `nucleo/`.** La copia entra por la interfaz `Fuentes` de `nucleo/tipos.ts`, tal como entraba Drive.
- ⚠️ **PRIVACIDAD — el repo es PÚBLICO.**
  - Nunca se escribe en el repo un nombre de cliente, un serial, un número de ticket, un ID de carpeta de Drive, la URL de hub-api o de n8n, ni un correo personal. Solo puede aparecer `comercial@ambientalia.com.co`.
  - Los datos de este plan (`18A90001`, `CLIENTE A`, `ENTRADA00001`, `4711`…) son inventados.
  - Antes de cada commit que toque `apps/hub-api/src/equipos/` o `apps/equipos-taller/`, tiene que salir limpio: `cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs`.
- **`.env*` está bloqueado para el agente.** Las variables las pega **el usuario** en `apps/hub-api/.env.example` (Tarea 8, paso ⚠️ USUARIO). Hasta entonces, `src/env-example.test.ts` falla en «cada variable del código está en el ejemplo»:
  - desde la Tarea 4, con `EQUIPOS_SYNC_TOKEN`;
  - desde la Tarea 6, con `EQUIPOS_SYNC_MAX_HORAS` y `EQUIPOS_SYNC_TOKEN`.

  Es lo esperado. El test va en un solo sentido (código → ejemplo): retirar variables no lo rompe.
- **Ficheros existentes:** el repo tiene `core.autocrlf=true` y ficheros con CRLF. Para cambiarlos se usa la herramienta Edit (o Write tras leerlos), nunca `sed` ni `Set-Content`, que destrozan las tildes en PowerShell 5.1.
- **Ni causas ni errores llevan secretos:** nunca la URL de la base, un token ni el error crudo de `pg` o de Google. Las respuestas a n8n tampoco repiten lo recibido.

## Supuestos de este plan (lo que el encargo no fija o lo que el código contradice)

| # | Supuesto | Por qué |
|---|---|---|
| B1 | `listado` y `fin` llevan además **`pasada`**: el id de la ejecución de n8n (`{{ $execution.id }}`). Así, `fin` cierra la pasada que listó, y no otra que se solape. | Sin un id, dos ejecuciones solapadas (la carga completa puede durar más de una hora) se cerrarían la una a la otra. Con `pasada`, cada fila de `equipos_sincronizacion` es una ejecución. |
| B2 | **Una pasada a la vez:** mientras otra pasada siga abierta y tenga menos de 2 h, el listado de una pasada nueva responde `409 pasada_en_curso`. Pasadas las 2 h, la vieja se cierra con `ok = false`. `fin` exige que la pasada haya listado las tres carpetas. | Evita repetir el OCR en paralelo durante la carga completa. Con la frescura de 6 h, una ejecución que muere solo cuesta unas horas. |
| B3 | **Listado sospechoso:** un listado vacío con la carpeta llena, o uno que borraría más de 10 archivos y más de la mitad, se rechaza (`409 listado_sospechoso`) sin tocar nada. | Un ID de carpeta equivocado, un permiso perdido o páginas perdidas marcarían `borrado` media copia, y los equipos desaparecerían de la foto (D5). Hay una salida en psql para un vaciado real (Tarea 9). |
| B4 | `error.status` solo admite **fallos del archivo**: un 4xx que no sea 401 ni 429. n8n tampoco manda los 403 de cuota (`rateLimitExceeded`). Lo pasajero no se manda, y el archivo queda pendiente para la pasada siguiente. Un fallo guardado se vuelve a pedir cada 6 h y conserva el texto anterior, si lo había, que sigue valiendo. | Es la misma frontera que `esFalloDeArchivo` en `servicio.ts`. Si n8n guardara un 429, la corrida trataría un problema de cuota como un PDF roto durante 6 h. |
| B5 | **Remisión de entrada:** igual que `fuente-drive.ts` `remisionEntrada`. Se toma el **primer** Google Doc que devuelve Drive en la carpeta (`mimeType = 'application/vnd.google-apps.document'`, `pageSize=5`, sin `orderBy`) y se exporta como **`text/markdown`**, no como texto plano, para conservar la tabla. Sin documento, el texto es `''`, que es válido y no se vuelve a pedir salvo que la carpeta cambie de nombre. | El encargo dice «exportada como texto»; el código usa Markdown. Con `''`, `parseRemisionEntrada` da la entrada vacía y el núcleo la cachea, como hoy. |
| B6 | **Lo que trae una pasada en curso no se ve.** La corrida lee la copia «tal como la dejó la última pasada completa». Esconde las filas pendientes de texto (entradas y salidas escaneadas) que cambiaron después del `fin` de esa pasada. Lo pendiente desde antes sí se ve, y falla como archivo sin texto. | Si una corrida coincide con una pasada a medias, los archivos nuevos todavía sin texto serían `FalloArchivo`. Con 2 o más, la corrida fallaría por la regla «todos fallan». |
| B7 | **D10:** la corrida pasa `exits: null` al núcleo, que relee de la copia el OCR de todos los PDF (una consulta por PDF). `ent` sí entra. | Sin esto, «volver a pedir el texto si cambia el nombre» no serviría de nada: el núcleo nunca relee un PDF cacheado y conserva el nombre viejo. Por eso «corregir el nombre del archivo en Drive», que es lo que piden las ilegibles por fecha errada, no se reflejaba. `ent` no se toca porque aporta `eq` a filas que ya no vuelven a pedir su remisión. La consecuencia: la regla «si fallan todos los PDF (2 o más)» mira ahora todos los PDF, no solo los nuevos. |
| B8 | **La caché `ent` no se invalida.** Si n8n reenvía la remisión de una entrada ya leída, el núcleo sigue con la primera lectura. | Así era antes. Queda como pendiente en §10 del diseño. |
| B9 | **Un fallo de la base al leer la copia** da la causa `interno: no se pudo leer la copia de Drive`, no `drive: …`. | No es un fallo de Drive. La pantalla dice entonces «No se pudo actualizar la información». |
| B10 | **Texto en pantalla de la copia atrasada:** «La copia de Google Drive (n8n) está atrasada; datos del …». La causa (`drive: sincronización de n8n atrasada`) vive en `contrato.ts` como `CAUSA_SYNC_ATRASADA`. | Si no, diría «No se pudo leer Google Drive», que lleva a buscar el fallo en otro sitio. |
| B11 | **El programador se enciende siempre.** Antes de la primera sincronización completa, cada corrida programada devuelve `sin_configurar`, que se apunta en el log y no registra corrida ni incidente. | La primera sincronización llega sin reiniciar hub-api. |
| B12 | **Límites:** hasta 10 000 archivos por listado, nombres de 1 a 300 caracteres y textos recortados a 200 000 (también en la base). El carácter nulo se quita. Se mantiene el `express.json` de 2 MB de hub-api. | Con nombres normales, 10 000 archivos ocupan menos de 1 MB (lo prueba la Tarea 4). Si un texto demasiado largo se rechazara, n8n repetiría el OCR cada hora. |
| B13 | `/api/` tiene un límite de 60 peticiones por minuto y por IP, compartido con los demás flujos de n8n. El flujo hace una pausa de 1 s antes de cada envío de texto y reintenta (3 × 5 s). | No se toca la configuración global de seguridad de hub-api. |

---

## Mapa de ficheros

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `apps/hub-api/src/users/migrations/072_equipos_drive_n8n.sql` | Crear | La copia de Drive y las pasadas; permisos de `portal_app`. |
| `apps/hub-api/src/db.ts` | Modificar (línea 102, `MIGRATIONS`) | Registrar la 072. |
| `apps/hub-api/src/equipos/migracion.test.ts` | Sustituir | La 071 ya no es la última; la 072 sí. |
| `apps/hub-api/src/equipos/migracion.db.test.ts` | Sustituir | Las tablas de la 072 en la lista; la 072 contra Postgres. |
| `apps/hub-api/src/equipos/sync.ts` (+ `sync.test.ts`) | Crear | Carpetas, límites, validación, listado sospechoso. Puro. |
| `apps/hub-api/src/equipos/repo-sync.ts` (+ `repo-sync.db.test.ts`) | Crear | SQL de la copia y de las pasadas. |
| `apps/hub-api/src/equipos/router-sync.ts` (+ `router-sync.test.ts`) | Crear | `POST /equipos-taller/sync/{listado,texto,fin}` con token. |
| `apps/hub-api/src/equipos/fuente-n8n.ts` (+ `fuente-n8n.test.ts`) | Crear | Fuentes de Drive sobre la copia; `FalloArchivo`. |
| `apps/hub-api/src/equipos/contrato.ts` (+ test) | Modificar | `CAUSA_SYNC_ATRASADA`; textos de «sin configurar» y de copia atrasada. |
| `apps/hub-api/src/equipos/config.ts` (+ test) | Modificar (Tarea 6), sustituir (Tarea 8) | `EQUIPOS_SYNC_TOKEN`, `EQUIPOS_SYNC_MAX_HORAS`; fuera Drive. |
| `apps/hub-api/src/equipos/servicio.ts` (+ test) | Sustituir | La corrida sobre la copia, la frescura, «configurado» desde la base. |
| `apps/hub-api/src/equipos/index.ts` (+ test) | Sustituir | Monta la copia; el programador, siempre. |
| `apps/hub-api/src/equipos/router.ts` (+ test) | Modificar | Monta `router-sync`; `configurado` asíncrono; texto del 503. |
| `apps/hub-api/src/index.ts` | Modificar (comentario, líneas 154-156) | Que no diga «Sin la configuración de Drive». |
| `apps/hub-api/src/equipos/fuente-drive.ts`, `fuente-drive.test.ts` | Borrar | La lectura directa de Drive. |
| `apps/equipos-taller/src/EquiposServicio.test.tsx`, `src/api.test.ts` | Modificar | El texto nuevo de «sin configurar». |
| `apps/hub-api/.env.example` | Modificar (⚠️ USUARIO, Tarea 8) | El bloque `EQUIPOS_*` nuevo. |
| `docs/equipos-taller.md`, `apps/equipos-taller/CLAUDE.md` | Sustituir | Operación, variables, causas y contrato del flujo de n8n. |
| n8n: «Equipos · Sincronizar remisiones» | Crear (MCP, inactivo, sin credenciales) | Listar Drive y mandar la copia. |

No cambian: `nucleo/**`, `fuente-desk2.ts`, `repo.ts`, `incidente.ts`, `alerta.ts`, `programador.ts`, `apps/equipos-taller/src/EquiposServicio.tsx`, el portal y el Dockerfile.

---

## Fase A — Base de datos y piezas nuevas

### Task 1: Migración 072

**Files:**
- Create: `apps/hub-api/src/users/migrations/072_equipos_drive_n8n.sql`
- Modify: `apps/hub-api/src/db.ts` (línea 102)
- Test (sustituir): `apps/hub-api/src/equipos/migracion.test.ts`, `apps/hub-api/src/equipos/migracion.db.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Sustituir `apps/hub-api/src/equipos/migracion.test.ts` entero:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Las migraciones de «Equipos en taller» sin base: que están apuntadas, en orden, que la 072
// es la última y que no siembran nada. Lo que hacen contra Postgres: migracion.db.test.ts,
// repo.db.test.ts y repo-sync.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL = leer('../users/migrations/071_equipos_taller.sql');
const SQL_072 = leer('../users/migrations/072_equipos_drive_n8n.sql');
const soloIdempotente = (sql: string) => {
  const creates = sql.match(/CREATE (UNIQUE )?(TABLE|INDEX|VIEW|SCHEMA|OR REPLACE VIEW)[^;]*/g) || [];
  expect(creates.length).toBeGreaterThan(0);
  expect(creates.filter((c) => !/IF NOT EXISTS|OR REPLACE/.test(c))).toEqual([]);
};

describe('migración 071', () => {
  it('está apuntada en MIGRATIONS, detrás de la 070', () => {
    expect(leer('../db.ts')).toMatch(/'070_wo_sales_documento_numero\.sql',\s*'071_equipos_taller\.sql'[,\]]/);
  });

  it('no siembra ni apps ni llaves ni ninguna otra fila (se re-ejecuta en cada arranque)', () => {
    expect(SQL).not.toMatch(/INSERT\s+INTO/i);
    expect(SQL).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => soloIdempotente(SQL));
});

describe('migración 072 (Drive vía n8n)', () => {
  it('está apuntada en MIGRATIONS, detrás de la 071, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'071_equipos_taller\.sql',\s*'072_equipos_drive_n8n\.sql'\];/);
  });

  it('no siembra nada', () => {
    expect(SQL_072).not.toMatch(/INSERT\s+INTO/i);
    expect(SQL_072).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => soloIdempotente(SQL_072));

  it('da permisos a portal_app solo si el rol existe (DATA-332), también sobre la secuencia', () => {
    expect(SQL_072).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
    expect(SQL_072).toMatch(/GRANT USAGE, SELECT ON SEQUENCE portal\.equipos_sincronizacion_id_seq TO portal_app/);
  });
});
```

Sustituir `apps/hub-api/src/equipos/migracion.db.test.ts` entero:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';

// La 071 y la 072 contra Postgres de verdad: re-ejecutarlas (como hace initDb() en cada
// arranque) no falla, no siembra nada y deja las tablas y vistas esperadas.
const leer = (n: string) => readFileSync(fileURLToPath(new URL('../users/migrations/' + n, import.meta.url)), 'utf8');
const SQL = leer('071_equipos_taller.sql');
const SQL_072 = leer('072_equipos_drive_n8n.sql');

let db: Pool;
beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});

describe('migración 071 contra Postgres', () => {
  it('se puede aplicar dos veces más sobre la ya aplicada (idempotente)', async () => {
    await db.query(SQL);
    await db.query(SQL);
  });

  it('deja sus cinco tablas y sus dos vistas (equipos_drive_archivos y equipos_sincronizacion son de la 072)', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name LIKE 'equipos\\_%' ORDER BY 1`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual([
      'equipos_ajuste', 'equipos_drive_archivos', 'equipos_ejecucion', 'equipos_estado', 'equipos_incidente', 'equipos_llaves',
      'equipos_sincronizacion', 'equipos_v_equipos', 'equipos_v_remisiones_ilegibles',
    ]);
  });

  it('equipos_ejecucion lleva avisos y equipos_ajuste no lleva hasta (A1, A2)', async () => {
    const { rows } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name IN ('equipos_ejecucion', 'equipos_ajuste')`,
    );
    const cols = rows.map((r: { table_name: string; column_name: string }) => `${r.table_name}.${r.column_name}`);
    expect(cols).toContain('equipos_ejecucion.avisos');
    expect(cols).not.toContain('equipos_ajuste.hasta');
  });

  it('no siembra ninguna fila', async () => {
    // Otras pruebas dejan filas: se vacía ANTES de re-aplicar y se comprueba que la 071 no siembra.
    await db.query('TRUNCATE portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion, portal.equipos_incidente, portal.equipos_llaves RESTART IDENTITY CASCADE');
    await db.query(SQL);
    for (const t of ['equipos_estado', 'equipos_ajuste', 'equipos_ejecucion', 'equipos_incidente', 'equipos_llaves']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM portal.${t}`);
      expect(rows[0].n, t).toBe(0);
    }
  });
});

describe('migración 072 contra Postgres', () => {
  const vaciar = () => db.query('TRUNCATE portal.equipos_drive_archivos, portal.equipos_sincronizacion RESTART IDENTITY');
  const columnas = async () =>
    (await db.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name IN ('equipos_drive_archivos', 'equipos_sincronizacion') ORDER BY 1, 2`,
    )).rows;

  it('se puede aplicar dos veces más sin cambiar columnas ni borrar filas', async () => {
    await vaciar();
    await db.query(`INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('ARCHIVO000001', 'entradas', 'X')`);
    const antes = await columnas();
    await db.query(SQL_072);
    await db.query(SQL_072);
    expect(await columnas()).toEqual(antes);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_drive_archivos')).rows[0].n).toBe(1);
    await vaciar();
  });

  it('no siembra ninguna fila', async () => {
    await vaciar();
    await db.query(SQL_072);
    for (const t of ['equipos_drive_archivos', 'equipos_sincronizacion']) {
      expect((await db.query(`SELECT count(*)::int AS n FROM portal.${t}`)).rows[0].n, t).toBe(0);
    }
  });

  it('la base también comprueba el id, la carpeta, el fallo, que las salidas de n8n no lleven texto y el estado de la pasada', async () => {
    await vaciar();
    const malas = [
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('x'' OR 1=1', 'entradas', 'X')`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('ARCHIVO000002', 'temporal', 'X')`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo, texto) VALUES ('ARCHIVO000003', 'salidas_n8n', 'X', 'texto')`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo, error_status) VALUES ('ARCHIVO000004', 'entradas', 'X', 429)`,
      `INSERT INTO portal.equipos_drive_archivos (id, carpeta, titulo) VALUES ('ARCHIVO000005', 'entradas', '')`,
      `INSERT INTO portal.equipos_sincronizacion (pasada, fin) VALUES ('4711', now())`,
      `INSERT INTO portal.equipos_sincronizacion (pasada) VALUES ('4711; DROP')`,
    ];
    for (const sql of malas) await expect(db.query(sql), sql).rejects.toMatchObject({ code: '23514' });
  });
});
```

- [ ] **Step 2: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run src/equipos/migracion.test.ts
```

Esperado: FAIL — `ENOENT: no such file or directory … 072_equipos_drive_n8n.sql` (el fichero entero no carga).

- [ ] **Step 3: Crear la migración**

Crear `apps/hub-api/src/users/migrations/072_equipos_drive_n8n.sql`:

```sql
-- Migration 072: «Equipos en taller», Drive vía n8n (docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md,
-- revisión del 10/11/2026).
--
-- El Workspace de la empresa no deja compartir Drive con cuentas de servicio, así que hub-api ya
-- no lee Drive: el flujo de n8n «Equipos · Sincronizar remisiones» lista cada hora las tres
-- carpetas con su credencial de Google y manda aquí los nombres y los textos.
--   · equipos_drive_archivos: la copia, un archivo o carpeta de Drive por fila (su id de Drive),
--     con el nombre, el texto (remisión de entrada en Markdown u OCR de la salida escaneada) o el
--     código del fallo de ese archivo, y si ya no está en Drive (borrado).
--   · equipos_sincronizacion: una fila por pasada de n8n (el id de su ejecución). La corrida
--     diaria solo corre con una pasada COMPLETA reciente (EQUIPOS_SYNC_MAX_HORAS).
--
-- ⚠️ NO siembra nada: initDb() re-ejecuta las migraciones en cada arranque.
-- Solo DDL idempotente (IF NOT EXISTS).

CREATE SCHEMA IF NOT EXISTS portal;

-- texto          NULL = todavía no llegó, '' es válido (carpeta de entrada sin documento)
-- titulo_texto   el nombre cuando llegó el texto: si el archivo cambia de nombre, se vuelve a pedir
-- error_status   el último fallo de ESE archivo (4xx que no es 401 ni 429), que se vuelve a pedir cada 6 h
-- actualizado_en el último cambio del listado (alta, nombre, carpeta, borrado o reaparición)
CREATE TABLE IF NOT EXISTS portal.equipos_drive_archivos (
  id             text        PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{10,100}$'),
  carpeta        text        NOT NULL CHECK (carpeta IN ('entradas', 'salidas_n8n', 'salidas_escaneadas')),
  titulo         text        NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 300),
  texto          text        NULL CHECK (char_length(texto) <= 200000),
  titulo_texto   text        NULL,
  error_status   integer     NULL CHECK (error_status BETWEEN 400 AND 499 AND error_status NOT IN (401, 429)),
  texto_en       timestamptz NULL,
  borrado        boolean     NOT NULL DEFAULT false,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipos_drive_archivos_sin_texto CHECK (carpeta <> 'salidas_n8n' OR (texto IS NULL AND error_status IS NULL))
);
CREATE INDEX IF NOT EXISTS equipos_drive_archivos_vivos ON portal.equipos_drive_archivos (carpeta) WHERE NOT borrado;

-- Una pasada está abierta mientras fin y ok son NULL. Con «fin», ok = true; abandonada, ok = false.
-- listados: carpeta → archivos recibidos; «fin» exige las tres carpetas.
CREATE TABLE IF NOT EXISTS portal.equipos_sincronizacion (
  id       bigserial   PRIMARY KEY,
  pasada   text        NOT NULL UNIQUE CHECK (pasada ~ '^[A-Za-z0-9_-]{1,64}$'),
  inicio   timestamptz NOT NULL DEFAULT now(),
  fin      timestamptz NULL,
  ok       boolean     NULL,
  listados jsonb       NOT NULL DEFAULT '{}'::jsonb,
  conteos  jsonb       NULL,
  CONSTRAINT equipos_sincronizacion_estado CHECK ((fin IS NULL) = (ok IS NULL))
);
CREATE INDEX IF NOT EXISTS equipos_sincronizacion_completas ON portal.equipos_sincronizacion (fin DESC) WHERE ok;

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_drive_archivos, portal.equipos_sincronizacion TO portal_app;
    GRANT USAGE, SELECT ON SEQUENCE portal.equipos_sincronizacion_id_seq TO portal_app;
  END IF;
END $$;
```

- [ ] **Step 4: Ver que falla solo el registro**

```bash
cd apps/hub-api && npx vitest run src/equipos/migracion.test.ts
```

Esperado: FAIL solo en «está apuntada en MIGRATIONS, detrás de la 071, y es la última».

- [ ] **Step 5: Registrar la 072 en `db.ts` (herramienta Edit)**

En `apps/hub-api/src/db.ts`, línea 102, cambiar el final del array:

```ts
'070_wo_sales_documento_numero.sql', '071_equipos_taller.sql'];
```

por:

```ts
'070_wo_sales_documento_numero.sql', '071_equipos_taller.sql', '072_equipos_drive_n8n.sql'];
```

- [ ] **Step 6: Ver que pasan, sin base y contra Postgres**

```bash
cd apps/hub-api && npx vitest run src/equipos/migracion.test.ts src/wo-sales/documento-numero.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/migracion.db.test.ts src/equipos/repo.db.test.ts
```

Esperado: PASS los cuatro ficheros (el de WO-sales ya admite `[,\]]` tras la 070).

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/users/migrations/072_equipos_drive_n8n.sql apps/hub-api/src/db.ts apps/hub-api/src/equipos/migracion.test.ts apps/hub-api/src/equipos/migracion.db.test.ts
git commit -m "feat(equipos-taller): migración 072 con la copia de Drive que manda n8n"
```

---

### Task 2: Lo que manda n8n — validación (TDD, puro)

**Files:**
- Create: `apps/hub-api/src/equipos/sync.ts`
- Test: `apps/hub-api/src/equipos/sync.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { esStatusDeArchivo, listadoSospechoso, MAX_ARCHIVOS, MAX_TEXTO, validarFin, validarListado, validarTexto } from './sync.js';

// Lo que n8n manda a hub-api (rutas /equipos-taller/sync/*), validado sin base. Ids y nombres ficticios.
const ID = (n: number) => 'ARCHIVO' + String(n).padStart(6, '0');
const LISTADO = { pasada: '4711', carpeta: 'entradas', archivos: [{ id: ID(1), titulo: '261101 - CLIENTE A - 18A90001' }] };

describe('validarListado', () => {
  it('acepta un listado y conserva el nombre tal cual, espacios incluidos', () => {
    const archivos = [{ id: ID(1), titulo: ' 261101 - CLIENTE A - 18A90001 ' }];
    expect(validarListado({ ...LISTADO, archivos })).toEqual({ ok: true, valor: { pasada: '4711', carpeta: 'entradas', archivos } });
  });

  it('las tres carpetas, y ninguna otra', () => {
    for (const carpeta of ['entradas', 'salidas_n8n', 'salidas_escaneadas']) expect(validarListado({ ...LISTADO, carpeta }).ok).toBe(true);
    expect(validarListado({ ...LISTADO, carpeta: 'temporal' })).toEqual({ ok: false, error: 'carpeta no válida' });
  });

  it('rechaza pasadas, ids o campos que no valen, sin repetir lo recibido', () => {
    const malos: unknown[] = [
      { ...LISTADO, pasada: '' }, { ...LISTADO, pasada: "1' OR 1=1" }, { ...LISTADO, pasada: 4711 },
      { ...LISTADO, archivos: [{ id: 'corto', titulo: 'x' }] },
      { ...LISTADO, archivos: [{ id: "abc' or name contains '", titulo: 'x' }] },
      { ...LISTADO, archivos: [{ id: ID(1), titulo: 'x', mimeType: 'application/pdf' }] },
      { ...LISTADO, archivos: [{ id: ID(1), titulo: 7 }] },
      { ...LISTADO, archivos: 'todos' }, { ...LISTADO, extra: true }, null, [], 'texto',
    ];
    for (const b of malos) {
      const r = validarListado(b);
      expect(r.ok, JSON.stringify(b)).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/OR 1=1|name contains|mimeType/);
    }
  });

  it('rechaza ids repetidos y nombres vacíos o de más de 300', () => {
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'a' }, { id: ID(1), titulo: 'b' }] })).toEqual({ ok: false, error: 'id repetido' });
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: '   ' }] }).ok).toBe(false);
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'x'.repeat(301) }] }).ok).toBe(false);
    expect(validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'x'.repeat(300) }] }).ok).toBe(true);
  });

  it('quita los caracteres nulos del nombre (Postgres no los admite)', () => {
    const r = validarListado({ ...LISTADO, archivos: [{ id: ID(1), titulo: 'a\u0000b' }] });
    expect(r.ok && r.valor.archivos[0].titulo).toBe('ab');
  });

  it('un listado vacío vale aquí (lo frena el repositorio si vaciaría la carpeta)', () => {
    expect(validarListado({ ...LISTADO, archivos: [] }).ok).toBe(true);
  });

  it(`hasta ${MAX_ARCHIVOS} archivos; uno más, no`, () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => ({ id: ID(i), titulo: 'T' + i }));
    expect(validarListado({ ...LISTADO, archivos: n(MAX_ARCHIVOS) }).ok).toBe(true);
    expect(validarListado({ ...LISTADO, archivos: n(MAX_ARCHIVOS + 1) })).toEqual({ ok: false, error: 'archivos no válidos' });
  });
});

describe('validarTexto', () => {
  it('texto o error: uno de los dos', () => {
    expect(validarTexto({ id: ID(1), texto: 'REMISIÓN' })).toEqual({ ok: true, valor: { id: ID(1), resultado: { texto: 'REMISIÓN' } } });
    expect(validarTexto({ id: ID(1), error: { status: 403 } })).toEqual({ ok: true, valor: { id: ID(1), resultado: { status: 403 } } });
    expect(validarTexto({ id: ID(1) }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), texto: 'x', error: { status: 403 } }).ok).toBe(false);
    expect(validarTexto({ id: 'corto', texto: 'x' }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), texto: 5 }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), texto: 'x', pasada: '4711' }).ok).toBe(false);
  });

  it('un texto vacío vale: la carpeta de entrada no tiene documento', () => {
    expect(validarTexto({ id: ID(1), texto: '' })).toEqual({ ok: true, valor: { id: ID(1), resultado: { texto: '' } } });
  });

  it(`el texto se recorta a ${MAX_TEXTO} caracteres y pierde los nulos`, () => {
    const r = validarTexto({ id: ID(1), texto: 'a\u0000' + 'b'.repeat(MAX_TEXTO + 10) });
    expect(r.ok && 'texto' in r.valor.resultado && r.valor.resultado.texto).toBe('a' + 'b'.repeat(MAX_TEXTO - 1));
  });

  it('el error, solo con un 4xx que sea del archivo (ni 401 ni 429)', () => {
    for (const status of [400, 403, 404, 413]) expect(validarTexto({ id: ID(1), error: { status } }).ok).toBe(true);
    for (const status of [401, 429, 500, 503, 399, 403.5, '403', null]) expect(validarTexto({ id: ID(1), error: { status } }).ok).toBe(false);
    expect(validarTexto({ id: ID(1), error: { status: 403, mensaje: 'x' } }).ok).toBe(false);
  });
});

describe('validarFin', () => {
  const CONTEOS = { entradas: 312, salidas_n8n: 40, salidas_escaneadas: 190 };
  it('pasada y un conteo por carpeta', () => {
    expect(validarFin({ pasada: '4711', conteos: CONTEOS })).toEqual({ ok: true, valor: { pasada: '4711', conteos: CONTEOS } });
  });
  it('rechaza conteos incompletos, con claves de más o que no son enteros entre 0 y 1 000 000', () => {
    const malos: unknown[] = [
      { entradas: 1, salidas_n8n: 1 }, { ...CONTEOS, textos: 1 }, { ...CONTEOS, entradas: -1 },
      { ...CONTEOS, entradas: 1.5 }, { ...CONTEOS, entradas: '3' }, { ...CONTEOS, entradas: 1_000_001 }, null, [],
    ];
    for (const conteos of malos) expect(validarFin({ pasada: '4711', conteos }).ok, JSON.stringify(conteos)).toBe(false);
    expect(validarFin({ conteos: CONTEOS }).ok).toBe(false);
    expect(validarFin({ pasada: '4711', conteos: CONTEOS, ok: true }).ok).toBe(false);
  });
});

describe('reglas', () => {
  it('esStatusDeArchivo: un 4xx entero salvo 401 y 429', () => {
    expect([400, 403, 404, 499].every(esStatusDeArchivo)).toBe(true);
    expect([401, 429, 500, 399, 403.5, '403', null].some(esStatusDeArchivo)).toBe(false);
  });
  it('listadoSospechoso: vacío con la carpeta llena, o que borraría más de 10 y más de la mitad', () => {
    expect(listadoSospechoso(5, 5, 0)).toBe(true);
    expect(listadoSospechoso(0, 0, 0)).toBe(false);
    expect(listadoSospechoso(11, 12, 1)).toBe(true);
    expect(listadoSospechoso(10, 12, 2)).toBe(false);
    expect(listadoSospechoso(11, 30, 19)).toBe(false);
    expect(listadoSospechoso(16, 30, 14)).toBe(true);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/sync.test.ts
```

Esperado: FAIL — `Failed to load url ./sync.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/sync.ts`:

```ts
/**
 * Lo que n8n («Equipos · Sincronizar remisiones») manda a hub-api con la copia de
 * Drive (§3.3 del diseño, revisión del 10/11/2026): las tres carpetas, los límites y la
 * validación estricta de los tres cuerpos. Puro, sin E/S: lo usan router-sync.ts
 * (validar) y repo-sync.ts (la regla del listado sospechoso).
 *
 * Los mensajes de error son fijos: nunca repiten lo recibido.
 */

export const CARPETAS = ['entradas', 'salidas_n8n', 'salidas_escaneadas'] as const;
export type Carpeta = (typeof CARPETAS)[number];

/** Forma de un id de archivo o carpeta de Drive (lo comprueba también la base). */
export const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
/** Id de una pasada: el de la ejecución de n8n (`{{ $execution.id }}`). */
export const ID_PASADA = /^[A-Za-z0-9_-]{1,64}$/;
/** Con nombres normales (unos 60 caracteres), 10 000 archivos son menos de 1 MB: caben en el límite de 2 MB de hub-api. */
export const MAX_ARCHIVOS = 10_000;
export const MAX_TITULO = 300;
/** Un texto más largo se recorta: una remisión ocupa unos pocos miles de caracteres. */
export const MAX_TEXTO = 200_000;
/** Un listado que borraría más archivos que esto, y más de la mitad de la carpeta, es sospechoso. */
export const UMBRAL_BAJAS = 10;

export interface ArchivoListado {
  id: string;
  titulo: string;
}
/** Lo que llega de un archivo: su texto o el código del fallo de ESE archivo. */
export type ResultadoTexto = { texto: string } | { status: number };
/** Archivos listados en cada carpeta, según n8n al terminar. */
export type ConteosFin = Record<Carpeta, number>;

export type Validado<T> = { ok: true; valor: T } | { ok: false; error: string };

/** ¿Es un fallo de ESE archivo? Un 4xx que no sea del token (401) ni de la cuota (429). */
export function esStatusDeArchivo(s: unknown): s is number {
  return typeof s === 'number' && Number.isInteger(s) && s >= 400 && s <= 499 && s !== 401 && s !== 429;
}

/**
 * ¿Un listado que no hay que aplicar? Vacío cuando la carpeta tiene archivos, o que
 * borraría más de UMBRAL_BAJAS y más de la mitad: casi siempre es un fallo del flujo
 * (otra carpeta, un permiso perdido, páginas perdidas), y aplicarlo haría desaparecer equipos.
 */
export function listadoSospechoso(bajas: number, vivos: number, recibidos: number): boolean {
  return (recibidos === 0 && vivos > 0) || (bajas > UMBRAL_BAJAS && bajas * 2 > vivos);
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const soloClaves = (o: Record<string, unknown>, permitidas: readonly string[]) => Object.keys(o).every((k) => permitidas.includes(k));
/** Postgres no admite el carácter nulo en un texto. */
const sinNulos = (s: string) => s.replace(/\u0000/g, '');
const pasadaValida = (v: unknown): v is string => typeof v === 'string' && ID_PASADA.test(v);
const no = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validarListado(b: unknown): Validado<{ pasada: string; carpeta: Carpeta; archivos: ArchivoListado[] }> {
  if (!objeto(b) || !soloClaves(b, ['pasada', 'carpeta', 'archivos'])) return no('cuerpo no válido');
  if (!pasadaValida(b.pasada)) return no('pasada no válida');
  if (!CARPETAS.includes(b.carpeta as Carpeta)) return no('carpeta no válida');
  if (!Array.isArray(b.archivos) || b.archivos.length > MAX_ARCHIVOS) return no('archivos no válidos');
  const vistos = new Set<string>();
  const archivos: ArchivoListado[] = [];
  for (const a of b.archivos as unknown[]) {
    if (!objeto(a) || !soloClaves(a, ['id', 'titulo']) || typeof a.id !== 'string' || !ID_DRIVE.test(a.id)) return no('archivo no válido');
    if (typeof a.titulo !== 'string') return no('título no válido');
    // El nombre se guarda tal cual (el núcleo lo interpreta); solo se quitan los nulos.
    const titulo = sinNulos(a.titulo);
    if (!titulo.trim() || titulo.length > MAX_TITULO) return no('título no válido');
    if (vistos.has(a.id)) return no('id repetido');
    vistos.add(a.id);
    archivos.push({ id: a.id, titulo });
  }
  return { ok: true, valor: { pasada: b.pasada, carpeta: b.carpeta as Carpeta, archivos } };
}

export function validarTexto(b: unknown): Validado<{ id: string; resultado: ResultadoTexto }> {
  if (!objeto(b) || !soloClaves(b, ['id', 'texto', 'error'])) return no('cuerpo no válido');
  if (typeof b.id !== 'string' || !ID_DRIVE.test(b.id)) return no('id no válido');
  if (('texto' in b) === ('error' in b)) return no('hace falta texto o error, uno de los dos');
  if ('texto' in b) {
    if (typeof b.texto !== 'string') return no('texto no válido');
    return { ok: true, valor: { id: b.id, resultado: { texto: sinNulos(b.texto).slice(0, MAX_TEXTO) } } };
  }
  const e = b.error;
  if (!objeto(e) || !soloClaves(e, ['status']) || !esStatusDeArchivo(e.status)) return no('error no válido: status ha de ser un 4xx del archivo (ni 401 ni 429)');
  return { ok: true, valor: { id: b.id, resultado: { status: e.status as number } } };
}

export function validarFin(b: unknown): Validado<{ pasada: string; conteos: ConteosFin }> {
  if (!objeto(b) || !soloClaves(b, ['pasada', 'conteos'])) return no('cuerpo no válido');
  if (!pasadaValida(b.pasada)) return no('pasada no válida');
  const c = b.conteos;
  const entero = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1_000_000;
  if (!objeto(c) || !soloClaves(c, CARPETAS) || !CARPETAS.every((k) => entero(c[k]))) return no('conteos no válidos: un entero por carpeta');
  const conteos = { entradas: c.entradas as number, salidas_n8n: c.salidas_n8n as number, salidas_escaneadas: c.salidas_escaneadas as number };
  return { ok: true, valor: { pasada: b.pasada, conteos } };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/sync.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/sync.ts apps/hub-api/src/equipos/sync.test.ts
git commit -m "feat(equipos-taller): validación de lo que manda n8n (listados, textos y fin)"
```

---

### Task 3: Repositorio de la copia (TDD contra Postgres)

**Files:**
- Create: `apps/hub-api/src/equipos/repo-sync.ts`
- Test: `apps/hub-api/src/equipos/repo-sync.db.test.ts`

La lógica de «qué falta» vive en el SQL de `registrarListado`. Se aplica en una transacción con un candado consultivo, así que dos pasadas no se cruzan a mitad de un listado. Por eso se prueba contra Postgres.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/repo-sync.db.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { crearRepoSync, HORAS_PASADA_ABANDONADA, HORAS_REINTENTO_ERROR, type RepoSync } from './repo-sync.js';
import { CARPETAS, MAX_ARCHIVOS, type ArchivoListado, type Carpeta } from './sync.js';

// La copia de Drive que manda n8n (migración 072) contra Postgres real: qué texto se pide,
// qué se borra, las pasadas y lo que ve la corrida. Ids y nombres ficticios.
let db: Pool;
let sync: RepoSync;
const A = (id: string, titulo = id + ' nombre'): ArchivoListado => ({ id, titulo });
const fila = async (id: string) =>
  (await db.query('SELECT carpeta, titulo, texto, titulo_texto, error_status, borrado FROM portal.equipos_drive_archivos WHERE id = $1', [id])).rows[0];
const borrados = async () => (await db.query('SELECT count(*)::int AS n FROM portal.equipos_drive_archivos WHERE borrado')).rows[0].n;
const vaciar = () => db.query('TRUNCATE portal.equipos_drive_archivos, portal.equipos_sincronizacion RESTART IDENTITY');
const listar = async (pasada: string, carpeta: Carpeta, archivos: ArchivoListado[]) => {
  const r = await sync.registrarListado(pasada, carpeta, archivos);
  if (r.estado !== 'ok') throw new Error('listado no aplicado: ' + r.estado);
  return r.faltaTexto;
};
/** Una pasada con las tres carpetas listadas y su «fin». */
const pasadaCompleta = async (pasada: string, l: Partial<Record<Carpeta, ArchivoListado[]>> = {}) => {
  for (const c of CARPETAS) await listar(pasada, c, l[c] ?? []);
  const conteos = { entradas: l.entradas?.length ?? 0, salidas_n8n: l.salidas_n8n?.length ?? 0, salidas_escaneadas: l.salidas_escaneadas?.length ?? 0 };
  expect(await sync.cerrarPasada(pasada, conteos)).toBe('cerrada');
};
const SIN_CONTEOS = { entradas: 0, salidas_n8n: 0, salidas_escaneadas: 0 };

beforeAll(() => {
  db = poolDePrueba();
  sync = crearRepoSync(db);
});
afterAll(async () => {
  await vaciar();
  await db.end();
});
beforeEach(vaciar);

describe('registrarListado', () => {
  it('las altas de entradas y de salidas escaneadas piden texto; las de salidas de n8n, no', async () => {
    expect(await listar('p1', 'entradas', [A('ENTRADA00002'), A('ENTRADA00001')])).toEqual(['ENTRADA00001', 'ENTRADA00002']);
    expect(await listar('p1', 'salidas_n8n', [A('SALIDAN8N001')])).toEqual([]);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')])).toEqual(['ESCANEO00001']);
  });

  it('con su texto deja de pedirlo; si cambia de nombre lo vuelve a pedir y, mientras, vale el viejo', async () => {
    await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261020 - CLIENTE C.pdf')]);
    expect(await sync.guardarTexto('ESCANEO00001', { texto: 'OCR uno' })).toBe(true);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261020 - CLIENTE C.pdf')])).toEqual([]);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261021 - CLIENTE C.pdf')])).toEqual(['ESCANEO00001']);
    expect(await sync.leerTexto('salidas_escaneadas', 'ESCANEO00001')).toEqual({ texto: 'OCR uno', errorStatus: null });
    await sync.guardarTexto('ESCANEO00001', { texto: 'OCR dos' });
    expect(await fila('ESCANEO00001')).toMatchObject({ titulo: '261021 - CLIENTE C.pdf', titulo_texto: '261021 - CLIENTE C.pdf', texto: 'OCR dos' });
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001', '261021 - CLIENTE C.pdf')])).toEqual([]);
  });

  it('un texto vacío cuenta como texto (carpeta de entrada sin documento): no se vuelve a pedir', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001')]);
    await sync.guardarTexto('ENTRADA00001', { texto: '' });
    expect(await listar('p1', 'entradas', [A('ENTRADA00001')])).toEqual([]);
    expect(await sync.leerTexto('entradas', 'ENTRADA00001')).toEqual({ texto: '', errorStatus: null });
  });

  it('lo que falta del listado queda borrado; si vuelve, recupera su texto', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001'), A('ENTRADA00002')]);
    await sync.guardarTexto('ENTRADA00001', { texto: 'remisión' });
    await listar('p1', 'entradas', [A('ENTRADA00002')]);
    expect((await fila('ENTRADA00001')).borrado).toBe(true);
    expect(await sync.leerTexto('entradas', 'ENTRADA00001')).toBeNull();
    expect(await sync.guardarTexto('ENTRADA00001', { texto: 'otra' })).toBe(false);
    expect(await listar('p1', 'entradas', [A('ENTRADA00001'), A('ENTRADA00002')])).toEqual(['ENTRADA00002']);
    expect(await fila('ENTRADA00001')).toMatchObject({ borrado: false, texto: 'remisión' });
  });

  it(`un fallo del archivo no se vuelve a pedir hasta pasadas ${HORAS_REINTENTO_ERROR} h; con texto, el fallo se borra`, async () => {
    await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')]);
    await sync.guardarTexto('ESCANEO00001', { status: 403 });
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')])).toEqual([]);
    expect(await sync.leerTexto('salidas_escaneadas', 'ESCANEO00001')).toEqual({ texto: null, errorStatus: 403 });
    await db.query('UPDATE portal.equipos_drive_archivos SET texto_en = now() - make_interval(hours => $1, mins => 1)', [HORAS_REINTENTO_ERROR]);
    expect(await listar('p1', 'salidas_escaneadas', [A('ESCANEO00001')])).toEqual(['ESCANEO00001']);
    await sync.guardarTexto('ESCANEO00001', { texto: 'por fin' });
    expect(await sync.leerTexto('salidas_escaneadas', 'ESCANEO00001')).toEqual({ texto: 'por fin', errorStatus: null });
  });

  it('un archivo que pasa a otra carpeta pierde el texto de la anterior y lo pide de nuevo', async () => {
    await listar('p1', 'salidas_escaneadas', [A('ARCHIVO00001'), A('ESCANEO00002')]);
    await sync.guardarTexto('ARCHIVO00001', { texto: 'OCR' });
    expect(await listar('p1', 'entradas', [A('ARCHIVO00001')])).toEqual(['ARCHIVO00001']);
    expect(await fila('ARCHIVO00001')).toMatchObject({ carpeta: 'entradas', texto: null, borrado: false });
  });

  it('no aplica un listado sospechoso: vacío con la carpeta llena, o que borraría más de 10 y más de la mitad', async () => {
    const doce = Array.from({ length: 12 }, (_, i) => A('ENTRADA' + String(i).padStart(5, '0')));
    await listar('p1', 'entradas', doce);
    expect(await sync.registrarListado('p1', 'entradas', [])).toEqual({ estado: 'sospechoso', bajas: 12, vivos: 12 });
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 1))).toEqual({ estado: 'sospechoso', bajas: 11, vivos: 12 });
    expect(await borrados()).toBe(0);
    expect(await sync.registrarListado('p1', 'entradas', doce.slice(0, 6))).toMatchObject({ estado: 'ok' });
    expect(await borrados()).toBe(6);
  });

  it('un listado sospechoso tampoco cuenta para la pasada: su «fin» queda incompleto', async () => {
    await pasadaCompleta('p1', { entradas: [A('ENTRADA00001')] });
    expect(await sync.registrarListado('p2', 'entradas', [])).toMatchObject({ estado: 'sospechoso' });
    await listar('p2', 'salidas_n8n', []);
    await listar('p2', 'salidas_escaneadas', []);
    expect(await sync.cerrarPasada('p2', SIN_CONTEOS)).toBe('incompleta');
  });

  it(`${MAX_ARCHIVOS} archivos en un solo listado`, async () => {
    const muchos = Array.from({ length: MAX_ARCHIVOS }, (_, i) => A('ESCANEO' + String(i).padStart(6, '0')));
    expect(await listar('p1', 'salidas_escaneadas', muchos)).toHaveLength(MAX_ARCHIVOS);
  });
});

describe('guardarTexto', () => {
  it('false si el archivo no existe o es de salidas de n8n (que no llevan texto)', async () => {
    expect(await sync.guardarTexto('NOEXISTE0001', { texto: 'x' })).toBe(false);
    await listar('p1', 'salidas_n8n', [A('SALIDAN8N001')]);
    expect(await sync.guardarTexto('SALIDAN8N001', { texto: 'x' })).toBe(false);
    expect(await sync.guardarTexto('SALIDAN8N001', { status: 403 })).toBe(false);
  });
});

describe('pasadas', () => {
  it('fin: desconocida, incompleta sin las tres carpetas, cerrada, y no se cierra ni se lista dos veces', async () => {
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('desconocida');
    await listar('p1', 'entradas', []);
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('incompleta');
    await listar('p1', 'salidas_n8n', []);
    await listar('p1', 'salidas_escaneadas', []);
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('cerrada');
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('ya_cerrada');
    expect(await sync.registrarListado('p1', 'entradas', [])).toEqual({ estado: 'pasada_cerrada' });
    const p = (await db.query('SELECT ok, listados, conteos FROM portal.equipos_sincronizacion WHERE pasada = $1', ['p1'])).rows[0];
    expect(p).toEqual({ ok: true, listados: { entradas: 0, salidas_n8n: 0, salidas_escaneadas: 0 }, conteos: SIN_CONTEOS });
  });

  it('ultimaSincronizacion: null sin ninguna completa; si no, la de «fin» más reciente', async () => {
    expect(await sync.ultimaSincronizacion()).toBeNull();
    await listar('p1', 'entradas', []);
    expect(await sync.ultimaSincronizacion()).toBeNull();
    await listar('p1', 'salidas_n8n', []);
    await listar('p1', 'salidas_escaneadas', []);
    await sync.cerrarPasada('p1', SIN_CONTEOS);
    await pasadaCompleta('p2');
    expect(await sync.ultimaSincronizacion()).toMatchObject({
      pasada: 'p2', inicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), fin: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it(`una a la vez: con otra abierta, «en curso»; pasadas ${HORAS_PASADA_ABANDONADA} h, la vieja se cierra como fallida`, async () => {
    await listar('p1', 'entradas', []);
    expect(await sync.registrarListado('p2', 'entradas', [])).toEqual({ estado: 'pasada_en_curso' });
    await db.query(`UPDATE portal.equipos_sincronizacion SET inicio = now() - make_interval(hours => $1, mins => 1) WHERE pasada = 'p1'`, [HORAS_PASADA_ABANDONADA]);
    expect(await sync.registrarListado('p2', 'entradas', [])).toMatchObject({ estado: 'ok' });
    expect((await db.query(`SELECT ok, fin IS NOT NULL AS cerrada FROM portal.equipos_sincronizacion WHERE pasada = 'p1'`)).rows[0]).toEqual({ ok: false, cerrada: true });
    expect(await sync.cerrarPasada('p1', SIN_CONTEOS)).toBe('ya_cerrada');
  });
});

describe('lo que ve la corrida (listarCarpeta y leerTexto)', () => {
  it('sin borrados, y sin los pendientes que trajo una pasada posterior a la última completa', async () => {
    await pasadaCompleta('p1', { entradas: [A('ENTRADA00001'), A('ENTRADA00002'), A('ENTRADA00004')], salidas_n8n: [A('SALIDAN8N001')] });
    await sync.guardarTexto('ENTRADA00001', { texto: 'remisión' });
    // La pasada 2, a medias: borra ENTRADA00002, trae ENTRADA00003 (sin texto aún) y una salida de n8n nueva.
    await listar('p2', 'entradas', [A('ENTRADA00001'), A('ENTRADA00003'), A('ENTRADA00004')]);
    await listar('p2', 'salidas_n8n', [A('SALIDAN8N001'), A('SALIDAN8N002')]);
    const ids = async (c: Carpeta) => (await sync.listarCarpeta(c, 'p1')).map((x) => x.id);
    // ENTRADA00004 sigue pendiente DESDE la pasada 1: se ve (y fallará como archivo sin texto).
    expect(await ids('entradas')).toEqual(['ENTRADA00001', 'ENTRADA00004']);
    // Las salidas de n8n no llevan texto: se ven en cuanto llegan.
    expect(await sync.listarCarpeta('salidas_n8n', 'p1')).toEqual([
      { id: 'SALIDAN8N001', title: 'SALIDAN8N001 nombre' }, { id: 'SALIDAN8N002', title: 'SALIDAN8N002 nombre' },
    ]);
    // En cuanto llega su texto, la nueva ya se ve.
    await sync.guardarTexto('ENTRADA00003', { texto: '' });
    expect(await ids('entradas')).toEqual(['ENTRADA00001', 'ENTRADA00003', 'ENTRADA00004']);
  });

  it('con una pasada que no existe no esconde nada', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001')]);
    expect((await sync.listarCarpeta('entradas', 'nada')).map((x) => x.id)).toEqual(['ENTRADA00001']);
  });

  it('leerTexto: texto, fallo, o null si es de otra carpeta', async () => {
    await listar('p1', 'entradas', [A('ENTRADA00001'), A('ENTRADA00002')]);
    await sync.guardarTexto('ENTRADA00001', { texto: 'remisión' });
    await sync.guardarTexto('ENTRADA00002', { status: 404 });
    expect(await sync.leerTexto('entradas', 'ENTRADA00001')).toEqual({ texto: 'remisión', errorStatus: null });
    expect(await sync.leerTexto('entradas', 'ENTRADA00002')).toEqual({ texto: null, errorStatus: 404 });
    expect(await sync.leerTexto('salidas_escaneadas', 'ENTRADA00001')).toBeNull();
  });
});
```

- [ ] **Step 2: Ver que falla** (Docker Desktop encendido)

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/repo-sync.db.test.ts
```

Esperado: FAIL — `Failed to load url ./repo-sync.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/repo-sync.ts`:

```ts
/**
 * La copia de Drive que manda n8n (migración 072, revisión del 10/11/2026 del diseño):
 * `portal.equipos_drive_archivos` (un archivo o carpeta de Drive por fila) y
 * `portal.equipos_sincronizacion` (una fila por pasada de n8n). Solo SQL. Qué se acepta
 * lo decide sync.ts; escribe router-sync.ts (n8n) y leen fuente-n8n.ts y servicio.ts
 * (la corrida).
 *
 * Qué texto se pide (`faltaTexto`), solo en entradas y salidas escaneadas:
 *   · el que nunca llegó (alta, o archivo que vuelve de otra carpeta);
 *   · el de un archivo que cambió de nombre desde que llegó su texto (el viejo se
 *     conserva y se sigue usando hasta que llegue el nuevo);
 *   · el de un archivo con un fallo guardado, pasadas HORAS_REINTENTO_ERROR horas.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { ArchivoDrive } from './nucleo/tipos.js';
import { listadoSospechoso, type ArchivoListado, type Carpeta, type ConteosFin, type ResultadoTexto } from './sync.js';

type PoolClient = Awaited<ReturnType<Pool['connect']>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;

/** Un archivo con un fallo guardado se vuelve a pedir pasado este tiempo. */
export const HORAS_REINTENTO_ERROR = 6;
/** Una pasada sin «fin» más vieja que esto se da por abandonada (n8n murió a mitad); hasta entonces, no empieza otra. */
export const HORAS_PASADA_ABANDONADA = 2;

/** Una pasada completa (con «fin»). */
export interface SincronizacionHecha {
  pasada: string;
  inicio: string;
  fin: string;
}
export interface TextoGuardado {
  /** null = no llegó (`''` vale: carpeta de entrada sin documento). */
  texto: string | null;
  /** El último fallo de ese archivo, si lo hay. */
  errorStatus: number | null;
}
export type ResultadoListado =
  | { estado: 'ok'; faltaTexto: string[] }
  | { estado: 'pasada_cerrada' }
  | { estado: 'pasada_en_curso' }
  | { estado: 'sospechoso'; bajas: number; vivos: number };
export type CierrePasada = 'cerrada' | 'desconocida' | 'ya_cerrada' | 'incompleta';

export interface RepoSync {
  /** El listado COMPLETO de una carpeta en una pasada: altas, nombres y borrados. Devuelve los ids a los que les falta texto. */
  registrarListado(pasada: string, carpeta: Carpeta, archivos: ArchivoListado[]): Promise<ResultadoListado>;
  /** El texto (o el fallo) de un archivo. false si no está, está borrado o su carpeta no lleva texto. */
  guardarTexto(id: string, r: ResultadoTexto): Promise<boolean>;
  /** Cierra la pasada como completa. Exige el listado de las tres carpetas. */
  cerrarPasada(pasada: string, conteos: ConteosFin): Promise<CierrePasada>;
  /** La última pasada COMPLETA, o null si nunca hubo una. */
  ultimaSincronizacion(): Promise<SincronizacionHecha | null>;
  /**
   * Lo que la corrida ve de una carpeta: sin los borrados ni los pendientes de texto que
   * cambiaron después del «fin» de `pasada` (los trajo una pasada que no ha terminado).
   */
  listarCarpeta(carpeta: Carpeta, pasada: string): Promise<ArchivoDrive[]>;
  /** null si el archivo no está en esa carpeta (o está borrado). */
  leerTexto(carpeta: Carpeta, id: string): Promise<TextoGuardado | null>;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

async function enTransaccion<T>(db: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export function crearRepoSync(db: Pool): RepoSync {
  return {
    async registrarListado(pasada, carpeta, archivos) {
      const ids = archivos.map((a) => a.id);
      return enTransaccion(db, async (c): Promise<ResultadoListado> => {
        // Un escritor de listados a la vez: dos pasadas no se cruzan a mitad de uno.
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('equipos-taller:sync'))`);
        // Una pasada sin «fin» de hace más de HORAS_PASADA_ABANDONADA: n8n murió a mitad.
        await c.query(
          `UPDATE portal.equipos_sincronizacion SET fin = now(), ok = false
            WHERE fin IS NULL AND pasada <> $1 AND inicio < now() - make_interval(hours => $2)`,
          [pasada, HORAS_PASADA_ABANDONADA],
        );
        const p = (await c.query(
          `SELECT bool_or(pasada = $1 AND fin IS NOT NULL) AS cerrada, bool_or(pasada <> $1 AND fin IS NULL) AS otra
             FROM portal.equipos_sincronizacion WHERE pasada = $1 OR fin IS NULL`,
          [pasada],
        )).rows[0];
        if (p?.cerrada) return { estado: 'pasada_cerrada' };
        if (p?.otra) return { estado: 'pasada_en_curso' };
        const n = (await c.query(
          `SELECT count(*)::int AS vivos, count(*) FILTER (WHERE NOT (id = ANY($2::text[])))::int AS bajas
             FROM portal.equipos_drive_archivos WHERE carpeta = $1 AND NOT borrado`,
          [carpeta, ids],
        )).rows[0];
        if (listadoSospechoso(n.bajas, n.vivos, archivos.length)) return { estado: 'sospechoso', bajas: n.bajas, vivos: n.vivos };
        await c.query(
          `INSERT INTO portal.equipos_sincronizacion (pasada, listados) VALUES ($1, jsonb_build_object($2::text, $3::int))
           ON CONFLICT (pasada) DO UPDATE SET listados = portal.equipos_sincronizacion.listados || EXCLUDED.listados`,
          [pasada, carpeta, archivos.length],
        );
        // Altas, cambios de nombre, reapariciones y archivos que vienen de otra carpeta. Si
        // vienen de otra, su texto era de otra clase y se descarta. En el SET, `a.` es la fila
        // de antes. Las filas sin cambios no se reescriben.
        await c.query(
          `INSERT INTO portal.equipos_drive_archivos AS a (id, carpeta, titulo)
           SELECT l.id, $1::text, l.titulo FROM unnest($2::text[], $3::text[]) AS l(id, titulo)
           ON CONFLICT (id) DO UPDATE SET
             texto        = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.texto END,
             titulo_texto = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.titulo_texto END,
             error_status = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.error_status END,
             texto_en     = CASE WHEN a.carpeta = EXCLUDED.carpeta THEN a.texto_en END,
             carpeta = EXCLUDED.carpeta, titulo = EXCLUDED.titulo, borrado = false, actualizado_en = now()
           WHERE a.titulo IS DISTINCT FROM EXCLUDED.titulo OR a.borrado OR a.carpeta <> EXCLUDED.carpeta`,
          [carpeta, ids, archivos.map((a) => a.titulo)],
        );
        await c.query(
          `UPDATE portal.equipos_drive_archivos SET borrado = true, actualizado_en = now()
            WHERE carpeta = $1 AND NOT borrado AND NOT (id = ANY($2::text[]))`,
          [carpeta, ids],
        );
        const { rows } = await c.query(
          `SELECT id FROM portal.equipos_drive_archivos
            WHERE carpeta = $1 AND carpeta <> 'salidas_n8n' AND NOT borrado
              AND CASE WHEN error_status IS NOT NULL
                       THEN texto_en IS NULL OR texto_en < now() - make_interval(hours => $2)
                       ELSE texto IS NULL OR titulo_texto IS DISTINCT FROM titulo END
            ORDER BY id`,
          [carpeta, HORAS_REINTENTO_ERROR],
        );
        return { estado: 'ok', faltaTexto: rows.map((x: Fila) => String(x.id)) };
      });
    },

    async guardarTexto(id, r) {
      const res = 'texto' in r
        ? await db.query(
          `UPDATE portal.equipos_drive_archivos SET texto = $2, titulo_texto = titulo, error_status = NULL, texto_en = now()
            WHERE id = $1 AND NOT borrado AND carpeta <> 'salidas_n8n'`,
          [id, r.texto],
        )
        // Un fallo no borra el texto que hubiera: sigue valiendo hasta que llegue uno nuevo.
        : await db.query(
          `UPDATE portal.equipos_drive_archivos SET error_status = $2, texto_en = now()
            WHERE id = $1 AND NOT borrado AND carpeta <> 'salidas_n8n'`,
          [id, r.status],
        );
      return res.rowCount === 1;
    },

    async cerrarPasada(pasada, conteos) {
      const { rows } = await db.query(
        `UPDATE portal.equipos_sincronizacion SET fin = now(), ok = true, conteos = $2::jsonb
          WHERE pasada = $1 AND fin IS NULL AND listados ?& ARRAY['entradas', 'salidas_n8n', 'salidas_escaneadas']
          RETURNING id`,
        [pasada, JSON.stringify(conteos)],
      );
      if (rows.length) return 'cerrada';
      const p = await db.query('SELECT fin FROM portal.equipos_sincronizacion WHERE pasada = $1', [pasada]);
      if (!p.rows.length) return 'desconocida';
      return p.rows[0].fin ? 'ya_cerrada' : 'incompleta';
    },

    async ultimaSincronizacion() {
      const { rows } = await db.query('SELECT pasada, inicio, fin FROM portal.equipos_sincronizacion WHERE ok ORDER BY fin DESC LIMIT 1');
      return rows[0] ? { pasada: String(rows[0].pasada), inicio: iso(rows[0].inicio), fin: iso(rows[0].fin) } : null;
    },

    async listarCarpeta(carpeta, pasada) {
      // Sin la pasada (no debería pasar), 'infinity': no se esconde nada.
      const { rows } = await db.query(
        `SELECT id, titulo FROM portal.equipos_drive_archivos
          WHERE carpeta = $1 AND NOT borrado
            AND NOT (carpeta <> 'salidas_n8n' AND texto IS NULL AND error_status IS NULL
                     AND actualizado_en > COALESCE((SELECT fin FROM portal.equipos_sincronizacion WHERE pasada = $2), 'infinity'::timestamptz))
          ORDER BY titulo, id`,
        [carpeta, pasada],
      );
      return rows.map((x: Fila) => ({ id: String(x.id), title: String(x.titulo) }));
    },

    async leerTexto(carpeta, id) {
      const { rows } = await db.query(
        'SELECT texto, error_status FROM portal.equipos_drive_archivos WHERE id = $1 AND carpeta = $2 AND NOT borrado',
        [id, carpeta],
      );
      return rows[0] ? { texto: rows[0].texto ?? null, errorStatus: rows[0].error_status ?? null } : null;
    },
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/repo-sync.db.test.ts src/equipos/migracion.db.test.ts
```

Esperado: PASS los dos. Si falla «en cuanto llega su texto…» por orden, revisar el `ORDER BY titulo, id` (los nombres de prueba son `ENTRADA0000N nombre`).

- [ ] **Step 5: Tipos**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: ningún error nuevo (en local puede seguir el ya conocido de `barril.test.ts` con `micromatch`).

- [ ] **Step 6: Commit**

```bash
git add apps/hub-api/src/equipos/repo-sync.ts apps/hub-api/src/equipos/repo-sync.db.test.ts
git commit -m "feat(equipos-taller): repositorio de la copia de Drive (listados, textos y pasadas)"
```

---

### Task 4: Rutas de n8n con token de máquina (TDD con Express real)

**Files:**
- Create: `apps/hub-api/src/equipos/router-sync.ts`
- Test: `apps/hub-api/src/equipos/router-sync.test.ts`

Se montan dentro de `createEquiposTallerRouter` en la Tarea 7. Aquí van solas.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/router-sync.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEquiposSyncRouter } from './router-sync.js';
import type { CierrePasada, RepoSync, ResultadoListado } from './repo-sync.js';
import type { ArchivoListado, Carpeta, ConteosFin, ResultadoTexto } from './sync.js';

// Las rutas de n8n con Express de verdad: el token de máquina, la validación y los códigos.
// El SQL (qué se pide, qué se borra): repo-sync.db.test.ts. Todo ficticio.
const TOKEN = 'token-sync-ficticio';
process.env.EQUIPOS_SYNC_TOKEN = TOKEN;

let listado: ResultadoListado;
let guardado: boolean;
let cierre: CierrePasada;
let falla: boolean;
const llamadas: unknown[][] = [];
const sync = {
  registrarListado: async (pasada: string, carpeta: Carpeta, archivos: ArchivoListado[]) => {
    if (falla) throw new Error('connection to server at "db.interno" failed: password=secreto');
    llamadas.push(['listado', pasada, carpeta, archivos]);
    return listado;
  },
  guardarTexto: async (id: string, r: ResultadoTexto) => {
    llamadas.push(['texto', id, r]);
    return guardado;
  },
  cerrarPasada: async (pasada: string, conteos: ConteosFin) => {
    llamadas.push(['fin', pasada, conteos]);
    return cierre;
  },
} as unknown as RepoSync;

const app = () => {
  const a = express();
  a.use(express.json({ limit: '2mb' })); // el mismo límite que hub-api (src/index.ts)
  a.use('/api', createEquiposSyncRouter(sync));
  return a;
};
const B = '/api/equipos-taller/sync';
const post = (ruta: string, cuerpo: object, token: string | null = TOKEN) => {
  const r = request(app()).post(B + ruta);
  return (token === null ? r : r.set('X-Equipos-Sync-Token', token)).send(cuerpo);
};
const ID = 'ARCHIVO000001';
const LISTADO = { pasada: '4711', carpeta: 'entradas', archivos: [{ id: ID, titulo: '261101 - CLIENTE A - 18A90001' }] };
const FIN = { pasada: '4711', conteos: { entradas: 1, salidas_n8n: 0, salidas_escaneadas: 0 } };

beforeEach(() => {
  listado = { estado: 'ok', faltaTexto: [] };
  guardado = true;
  cierre = 'cerrada';
  falla = false;
  llamadas.length = 0;
});

describe('token de máquina', () => {
  it('401 sin el token o con otro, en las tres rutas, sin tocar nada', async () => {
    for (const t of [null, 'otro']) {
      for (const [ruta, cuerpo] of [['/listado', LISTADO], ['/texto', { id: ID, texto: 'x' }], ['/fin', FIN]] as const) {
        const r = await post(ruta, cuerpo, t);
        expect([r.status, r.body]).toEqual([401, { error: 'unauthorized' }]);
      }
    }
    expect(llamadas).toEqual([]);
  });

  it('sin EQUIPOS_SYNC_TOKEN en hub-api no pasa nadie', async () => {
    delete process.env.EQUIPOS_SYNC_TOKEN;
    try {
      expect((await post('/fin', FIN)).status).toBe(401);
    } finally {
      process.env.EQUIPOS_SYNC_TOKEN = TOKEN;
    }
  });
});

describe('POST /listado', () => {
  it('pasa el listado validado y devuelve faltaTexto', async () => {
    listado = { estado: 'ok', faltaTexto: [ID] };
    const r = await post('/listado', LISTADO);
    expect([r.status, r.body]).toEqual([200, { faltaTexto: [ID] }]);
    expect(llamadas).toEqual([['listado', '4711', 'entradas', LISTADO.archivos]]);
  });

  it('400 con un mensaje fijo si no vale, sin llamar al repositorio', async () => {
    const r = await post('/listado', { ...LISTADO, carpeta: "x' OR 1=1" });
    expect([r.status, r.body]).toEqual([400, { error: 'invalid_input', message: 'carpeta no válida' }]);
    expect(llamadas).toEqual([]);
  });

  it('409 si la pasada ya terminó, si hay otra en curso o si el listado es sospechoso', async () => {
    listado = { estado: 'pasada_cerrada' };
    expect([(await post('/listado', LISTADO)).status, (await post('/listado', LISTADO)).body.error]).toEqual([409, 'pasada_cerrada']);
    listado = { estado: 'pasada_en_curso' };
    expect((await post('/listado', LISTADO)).body.error).toBe('pasada_en_curso');
    listado = { estado: 'sospechoso', bajas: 40, vivos: 41 };
    const r = await post('/listado', LISTADO);
    expect([r.status, r.body.error, r.body.bajas, r.body.vivos]).toEqual([409, 'listado_sospechoso', 40, 41]);
  });

  it('un listado de 10 000 archivos cabe en el límite de 2 MB', async () => {
    const archivos = Array.from({ length: 10_000 }, (_, i) => ({
      id: 'ARCHIVO' + String(i).padStart(6, '0'),
      titulo: '261101 - CLIENTE DE PRUEBA CON NOMBRE LARGO - 18A9' + String(i).padStart(4, '0'),
    }));
    const r = await post('/listado', { pasada: '4711', carpeta: 'entradas', archivos });
    expect(r.status).toBe(200);
  });

  it('un fallo nuestro es un 500 genérico, sin detalles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    falla = true;
    const r = await post('/listado', LISTADO);
    expect([r.status, r.body]).toEqual([500, { error: 'internal error' }]);
    expect(r.text).not.toMatch(/secreto|db\.interno/);
  });
});

describe('POST /texto', () => {
  it('204 con el texto o con el fallo del archivo', async () => {
    expect((await post('/texto', { id: ID, texto: 'REMISIÓN' })).status).toBe(204);
    expect((await post('/texto', { id: ID, error: { status: 403 } })).status).toBe(204);
    expect(llamadas).toEqual([['texto', ID, { texto: 'REMISIÓN' }], ['texto', ID, { status: 403 }]]);
  });

  it('404 si el archivo no está en la copia', async () => {
    guardado = false;
    const r = await post('/texto', { id: ID, texto: 'x' });
    expect([r.status, r.body.error]).toEqual([404, 'desconocido']);
  });

  it('400 con texto y error a la vez, o con un status que no es del archivo', async () => {
    expect((await post('/texto', { id: ID, texto: 'x', error: { status: 403 } })).status).toBe(400);
    expect((await post('/texto', { id: ID, error: { status: 429 } })).status).toBe(400);
    expect(llamadas).toEqual([]);
  });
});

describe('POST /fin', () => {
  it('200 al cerrar; 404 si no existe; 409 si ya terminó o le falta alguna carpeta', async () => {
    expect([(await post('/fin', FIN)).status, llamadas]).toEqual([200, [['fin', '4711', FIN.conteos]]]);
    cierre = 'desconocida';
    expect([(await post('/fin', FIN)).status, (await post('/fin', FIN)).body.error]).toEqual([404, 'pasada_desconocida']);
    cierre = 'ya_cerrada';
    expect((await post('/fin', FIN)).body.error).toBe('pasada_cerrada');
    cierre = 'incompleta';
    const r = await post('/fin', FIN);
    expect([r.status, r.body.error]).toEqual([409, 'pasada_incompleta']);
  });

  it('400 sin un conteo por carpeta', async () => {
    expect((await post('/fin', { pasada: '4711', conteos: { entradas: 1 } })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/router-sync.test.ts
```

Esperado: FAIL — `Failed to load url ./router-sync.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/router-sync.ts`:

```ts
/**
 * Rutas por las que n8n («Equipos · Sincronizar remisiones») manda la copia de Drive
 * (§3.3 del diseño, revisión del 10/11/2026). Se montan bajo /api, dentro del router de
 * «Equipos en taller». NO llevan sesión: las protege el token de máquina
 * (`EQUIPOS_SYNC_TOKEN`, cabecera `X-Equipos-Sync-Token`; sin la variable, 401 a todo),
 * con el mismo patrón que WO-sales y Ausencias.
 *
 *   POST /equipos-taller/sync/listado  ← { pasada, carpeta, archivos: [{ id, titulo }] }  → 200 { faltaTexto } · 409
 *   POST /equipos-taller/sync/texto    ← { id, texto } | { id, error: { status } }        → 204 · 404
 *   POST /equipos-taller/sync/fin      ← { pasada, conteos }                              → 200 { ok } · 404 · 409
 *
 * 400 si el cuerpo no vale, con un mensaje fijo que nunca repite lo recibido. Un error
 * nuestro es un 500 genérico y va a Sentry.
 */
import { Router, type Request, type Response } from 'express';
import { requireCronToken } from '../auth.js';
import { captureError } from '../sentry.js';
import type { RepoSync } from './repo-sync.js';
import { validarFin, validarListado, validarTexto } from './sync.js';

const tokenSync = requireCronToken({ env: 'EQUIPOS_SYNC_TOKEN', header: 'X-Equipos-Sync-Token' });

export function createEquiposSyncRouter(sync: RepoSync): Router {
  const router = Router();
  const ruta = (ctx: string, fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`${ctx} error`, e);
      captureError(e, { endpoint: ctx });
      res.status(500).json({ error: 'internal error' });
    }
  };
  const invalido = (res: Response, message: string) => {
    res.status(400).json({ error: 'invalid_input', message });
  };
  const pasadaCerrada = { error: 'pasada_cerrada', message: 'Esa pasada ya terminó' };

  router.post('/equipos-taller/sync/listado', tokenSync, ruta('equipos_sync_listado', async (req, res) => {
    const v = validarListado(req.body);
    if (!v.ok) return invalido(res, v.error);
    const r = await sync.registrarListado(v.valor.pasada, v.valor.carpeta, v.valor.archivos);
    if (r.estado === 'ok') res.json({ faltaTexto: r.faltaTexto });
    else if (r.estado === 'pasada_cerrada') res.status(409).json(pasadaCerrada);
    else if (r.estado === 'pasada_en_curso') res.status(409).json({ error: 'pasada_en_curso', message: 'Hay otra pasada sin terminar' });
    else {
      res.status(409).json({
        error: 'listado_sospechoso',
        message: 'El listado borraría ' + r.bajas + ' de ' + r.vivos + ' archivos de la carpeta: no se aplica',
        bajas: r.bajas,
        vivos: r.vivos,
      });
    }
  }));

  router.post('/equipos-taller/sync/texto', tokenSync, ruta('equipos_sync_texto', async (req, res) => {
    const v = validarTexto(req.body);
    if (!v.ok) return invalido(res, v.error);
    if (await sync.guardarTexto(v.valor.id, v.valor.resultado)) res.status(204).end();
    else res.status(404).json({ error: 'desconocido', message: 'Ese archivo no está en la copia (o su carpeta no lleva texto)' });
  }));

  router.post('/equipos-taller/sync/fin', tokenSync, ruta('equipos_sync_fin', async (req, res) => {
    const v = validarFin(req.body);
    if (!v.ok) return invalido(res, v.error);
    const r = await sync.cerrarPasada(v.valor.pasada, v.valor.conteos);
    if (r === 'cerrada') res.json({ ok: true });
    else if (r === 'desconocida') res.status(404).json({ error: 'pasada_desconocida', message: 'No hay ninguna pasada con ese id' });
    else if (r === 'ya_cerrada') res.status(409).json(pasadaCerrada);
    else res.status(409).json({ error: 'pasada_incompleta', message: 'Falta el listado de alguna carpeta' });
  }));

  return router;
}
```

- [ ] **Step 4: Ver que pasa (y que el detector de `.env.example` ya la ve)**

```bash
cd apps/hub-api && npx vitest run src/equipos/router-sync.test.ts src/env-example.test.ts
```

Esperado:
- `router-sync.test.ts`: PASS.
- `env-example.test.ts`: FAIL en «cada variable del código está en el ejemplo», con exactamente `["EQUIPOS_SYNC_TOKEN"]`. Es lo esperado y se resuelve en la Tarea 8 (paso ⚠️ USUARIO). Las otras dos pruebas del detector pasan.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/router-sync.ts apps/hub-api/src/equipos/router-sync.test.ts
git commit -m "feat(equipos-taller): rutas de sincronización para n8n con token de máquina"
```

---

### Task 5: Fuente de Drive sobre la copia (TDD)

**Files:**
- Create: `apps/hub-api/src/equipos/fuente-n8n.ts`
- Test: `apps/hub-api/src/equipos/fuente-n8n.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/fuente-n8n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FalloArchivo, fuenteN8n } from './fuente-n8n.js';
import type { RepoSync, TextoGuardado } from './repo-sync.js';
import type { Carpeta } from './sync.js';

// Las fuentes de Drive de la corrida, sobre la copia de n8n, con un repositorio falso. Qué
// filas ve cada carpeta (borrados, pendientes en vuelo): repo-sync.db.test.ts. Todo ficticio.
const PASADA = '4711';
function repoFalso(textos: Record<string, TextoGuardado> = {}) {
  const llamadas: string[] = [];
  const repo: Pick<RepoSync, 'listarCarpeta' | 'leerTexto'> = {
    listarCarpeta: async (carpeta: Carpeta, pasada: string) => {
      llamadas.push('listar ' + carpeta + ' ' + pasada);
      return [{ id: 'ARCHIVO000001', title: '261101 - CLIENTE A - 18A90001' }];
    },
    leerTexto: async (carpeta: Carpeta, id: string) => {
      llamadas.push('texto ' + carpeta + ' ' + id);
      return textos[id] ?? null;
    },
  };
  return { repo, llamadas };
}

describe('fuenteN8n', () => {
  it('cada listado es el de su carpeta, tal como lo dejó la pasada con la que corre', async () => {
    const { repo, llamadas } = repoFalso();
    const f = fuenteN8n(repo, PASADA);
    expect(await f.entradas()).toEqual([{ id: 'ARCHIVO000001', title: '261101 - CLIENTE A - 18A90001' }]);
    await f.salidasGeneradas();
    await f.salidasEscaneadas();
    expect(llamadas).toEqual(['listar entradas 4711', 'listar salidas_n8n 4711', 'listar salidas_escaneadas 4711']);
  });

  it('el texto de un PDF y el de una remisión de entrada salen de su carpeta; un texto vacío vale', async () => {
    const { repo, llamadas } = repoFalso({ PDFabcdefghij1: { texto: 'REMISIÓN …', errorStatus: null }, ENTabcdefghij1: { texto: '', errorStatus: null } });
    const f = fuenteN8n(repo, PASADA);
    expect(await f.textoPdf('PDFabcdefghij1')).toBe('REMISIÓN …');
    expect(await f.remisionEntrada('ENTabcdefghij1')).toBe('');
    expect(llamadas).toEqual(['texto salidas_escaneadas PDFabcdefghij1', 'texto entradas ENTabcdefghij1']);
  });

  it('un fallo guardado por n8n es un FalloArchivo con su código y el mensaje de siempre', async () => {
    const f = fuenteN8n(repoFalso({ PDFabcdefghij1: { texto: null, errorStatus: 403 } }).repo, PASADA);
    const e = await f.textoPdf('PDFabcdefghij1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FalloArchivo);
    expect([(e as FalloArchivo).status, (e as FalloArchivo).message]).toEqual([403, 'Drive HTTP 403']);
  });

  it('con texto y un fallo posterior (el reintento tras un cambio de nombre), vale el texto', async () => {
    const f = fuenteN8n(repoFalso({ PDFabcdefghij1: { texto: 'viejo', errorStatus: 403 } }).repo, PASADA);
    expect(await f.textoPdf('PDFabcdefghij1')).toBe('viejo');
  });

  it('sin texto todavía, o sin fila: FalloArchivo pendiente (status null)', async () => {
    const f = fuenteN8n(repoFalso({ ENTabcdefghij1: { texto: null, errorStatus: null } }).repo, PASADA);
    for (const p of [f.remisionEntrada('ENTabcdefghij1'), f.textoPdf('NOEXISTE0001')]) {
      const e = await p.catch((x: unknown) => x);
      expect(e).toBeInstanceOf(FalloArchivo);
      expect([(e as FalloArchivo).status, (e as FalloArchivo).message]).toEqual([null, 'n8n todavía no envió su texto']);
    }
  });

  it('un id con forma rara no llega a la base', async () => {
    const { repo, llamadas } = repoFalso();
    await expect(fuenteN8n(repo, PASADA).remisionEntrada("x' OR 1=1")).rejects.toThrow('id de Drive no válido');
    expect(llamadas).toEqual([]);
  });

  it('un error de la base sube tal cual: no es un FalloArchivo', async () => {
    const roto: Pick<RepoSync, 'listarCarpeta' | 'leerTexto'> = {
      listarCarpeta: async () => { throw new Error('pg caído'); },
      leerTexto: async () => { throw new Error('pg caído'); },
    };
    const f = fuenteN8n(roto, PASADA);
    await expect(f.entradas()).rejects.toThrow('pg caído');
    const e = await f.textoPdf('PDFabcdefghij1').catch((x: unknown) => x);
    expect(e).not.toBeInstanceOf(FalloArchivo);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/fuente-n8n.test.ts
```

Esperado: FAIL — `Failed to load url ./fuente-n8n.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/fuente-n8n.ts`:

```ts
/**
 * Las fuentes de Drive de la corrida, leídas de la copia que manda n8n
 * (`portal.equipos_drive_archivos`, migración 072) y NO de Google: la empresa no deja
 * compartir Drive con cuentas de servicio (revisión del 10/11/2026 del diseño). Tiene la
 * forma que el núcleo leía de Drive (`Fuentes`), así que el núcleo no cambia:
 *   · los listados son las filas vivas de cada carpeta, tal como las dejó la pasada
 *     COMPLETA con la que corre (repo-sync.ts `listarCarpeta`);
 *   · el texto de una salida escaneada (OCR) o de una remisión de entrada (Markdown) es
 *     el guardado. Si no hay texto, porque n8n guardó un fallo de ese archivo o porque
 *     todavía no llegó, lanza `FalloArchivo`: servicio.ts lo trata como el fallo de un
 *     archivo concreto (A9), no de la fuente.
 * Cualquier otro error (la base) sube tal cual y hace fallar la corrida.
 */
import type { Fuentes } from './nucleo/tipos.js';
import type { RepoSync } from './repo-sync.js';
import { ID_DRIVE, type Carpeta } from './sync.js';

/** Lo que el núcleo lee de Drive. */
export type FuenteDrive = Pick<Fuentes, 'entradas' | 'salidasGeneradas' | 'salidasEscaneadas' | 'textoPdf'> & {
  remisionEntrada(carpetaId: string): Promise<string>;
};

/**
 * El fallo de UN archivo: el código que guardó n8n, o null si su texto todavía no llegó.
 * El mensaje con código es el de antes («Drive HTTP 403»): es el que el núcleo pone en sus avisos.
 */
export class FalloArchivo extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? 'n8n todavía no envió su texto' : 'Drive HTTP ' + status);
    this.name = 'FalloArchivo';
    this.status = status;
  }
}

export function fuenteN8n(repo: Pick<RepoSync, 'listarCarpeta' | 'leerTexto'>, pasada: string): FuenteDrive {
  const texto = async (carpeta: Carpeta, id: string): Promise<string> => {
    // Defensa en profundidad: el id viene del listado, pero va a una consulta.
    if (!ID_DRIVE.test(id)) throw new Error('id de Drive no válido');
    const t = await repo.leerTexto(carpeta, id);
    // Si hay texto, vale aunque luego se guardara un fallo (un reintento tras un cambio de nombre).
    if (t && t.texto !== null) return t.texto;
    throw new FalloArchivo(t?.errorStatus ?? null);
  };
  return {
    entradas: () => repo.listarCarpeta('entradas', pasada),
    salidasGeneradas: () => repo.listarCarpeta('salidas_n8n', pasada),
    salidasEscaneadas: () => repo.listarCarpeta('salidas_escaneadas', pasada),
    textoPdf: (id) => texto('salidas_escaneadas', id),
    remisionEntrada: (id) => texto('entradas', id),
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/fuente-n8n.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/fuente-n8n.ts apps/hub-api/src/equipos/fuente-n8n.test.ts
git commit -m "feat(equipos-taller): fuente de Drive sobre la copia de n8n"
```

---

## Fase B — La corrida cambia de fuente

### Task 6: Configuración de la sincronización y textos de pantalla (TDD)

**Files:**
- Modify: `apps/hub-api/src/equipos/config.ts`, `config.test.ts`
- Modify: `apps/hub-api/src/equipos/contrato.ts`, `contrato.test.ts`
- Modify: `apps/hub-api/src/equipos/router.ts` (mensaje del 503), `router.test.ts`
- Modify: `apps/equipos-taller/src/EquiposServicio.test.tsx`, `apps/equipos-taller/src/api.test.ts`

`config.ts` conserva aquí lo de Drive: lo usa `index.ts` hasta la Tarea 7, y se quita en la 8.

- [ ] **Step 1: Escribir las pruebas que fallan**

En `apps/hub-api/src/equipos/config.test.ts`:

a) Cambiar el import (línea 3):

```ts
import { HORA_POR_DEFECTO, leerConfig, MAX_HORAS_SYNC_POR_DEFECTO, RESERVA_POR_DEFECTO } from './config.js';
```

b) Añadir al final del fichero:

```ts
describe('leerConfig: la copia de Drive que manda n8n', () => {
  it('la frescura máxima es de 6 h salvo un entero de 1 a 168', () => {
    expect(MAX_HORAS_SYNC_POR_DEFECTO).toBe(6);
    expect(leerConfig({}).maxHorasSync).toBe(MAX_HORAS_SYNC_POR_DEFECTO);
    expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: '12' }).maxHorasSync).toBe(12);
    expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: ' 168 ' }).maxHorasSync).toBe(168);
    for (const v of ['0', '169', '1.5', '-3', 'seis', '']) expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: v }).maxHorasSync, v).toBe(MAX_HORAS_SYNC_POR_DEFECTO);
  });

  it('del token solo se sabe si está y vale como cabecera; su valor no sale', () => {
    expect(leerConfig({}).tokenSync).toBe(false);
    expect(leerConfig({ EQUIPOS_SYNC_TOKEN: 'con espacio' }).tokenSync).toBe(false);
    const c = leerConfig({ EQUIPOS_SYNC_TOKEN: 'token-ficticio-123' });
    expect(c.tokenSync).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/token-ficticio-123/);
  });
});
```

En `apps/hub-api/src/equipos/contrato.test.ts`:

a) El import (línea 2):

```ts
import { ajusteValido, avisoFoto, CAUSA_SYNC_ATRASADA, claveValida, type Corrida } from './contrato.js';
```

b) Sustituir la prueba `'módulo sin configurar'` por:

```ts
  it('módulo sin configurar: falta la primera sincronización con n8n', () =>
    expect(avisoFoto({ ...base, configurado: false }, fecha)).toEqual({ texto: 'Falta la primera sincronización con n8n', destacado: false }));
```

c) Detrás de la prueba `'falló Drive'`, añadir:

```ts
  it('la copia de n8n atrasada lo dice así, no como un fallo de Drive', () =>
    expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: CAUSA_SYNC_ATRASADA }), ultimaBuena: corrida({ fin: '2026-11-08T11:35:00.000Z' }) }, fecha)?.texto)
      .toBe('La copia de Google Drive (n8n) está atrasada; datos del F(2026-11-08)'));
  it('la causa de la copia atrasada es la que escribe el servicio', () => expect(CAUSA_SYNC_ATRASADA).toBe('drive: sincronización de n8n atrasada'));
```

En `apps/hub-api/src/equipos/router.test.ts`, en `it('503 sin configurar', …)`, cambiar la expectativa:

```ts
    expect([r.status, r.body.message]).toEqual([503, 'Falta la primera sincronización con n8n']);
```

En `apps/equipos-taller/src/EquiposServicio.test.tsx`, en `it('sin configurar: lo dice y el botón queda desactivado', …)`:

```ts
    expect((await screen.findByRole('alert')).textContent).toBe('Falta la primera sincronización con n8n');
```

En `apps/equipos-taller/src/api.test.ts`, en `it('un 503 o un 403 lanzan el mensaje del servidor', …)`, cambiar las dos apariciones de `'Falta configurar Google Drive'` por `'Falta la primera sincronización con n8n'` (Edit con `replace_all`).

- [ ] **Step 2: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run src/equipos/config.test.ts src/equipos/contrato.test.ts src/equipos/router.test.ts
npm test --workspace=apps/equipos-taller
```

Esperado:
- `config.test.ts`: FAIL en las dos pruebas nuevas.
- `contrato.test.ts`: FAIL en «sin configurar» y en las dos de la copia atrasada.
- `router.test.ts`: FAIL en «503 sin configurar».
- Sub-app: FAIL en «sin configurar: lo dice…». `api.test.ts` pasa: el mensaje lo pone su doble.

- [ ] **Step 3: Implementar**

`apps/hub-api/src/equipos/contrato.ts` (Edit):

a) El comentario de `configurado` en `RespuestaEquipos`:

```ts
  /** false mientras no haya ninguna sincronización completa de n8n (la copia de Drive). */
  configurado: boolean;
```

b) Detrás de `export type OrigenCorrida = 'programada' | 'boton';`:

```ts

/** Causa de una corrida cuando la última sincronización completa de n8n es demasiado vieja (la escribe servicio.ts). */
export const CAUSA_SYNC_ATRASADA = 'drive: sincronización de n8n atrasada';
```

c) En `queFallo`, sustituir la línea `if (causa?.startsWith('drive:')) return 'No se pudo leer Google Drive';` por:

```ts
  if (causa === CAUSA_SYNC_ATRASADA) return 'La copia de Google Drive (n8n) está atrasada';
  if (causa?.startsWith('drive:')) return 'No se pudo leer Google Drive';
```

d) En `avisoFoto`:

```ts
  if (!e.configurado) return { texto: 'Falta la primera sincronización con n8n', destacado: false };
```

`apps/hub-api/src/equipos/router.ts` (Edit), en `POST /equipos-taller/actualizar`:

```ts
    if (e === 'sin_configurar') res.status(503).json({ error: 'sin_configurar', message: 'Falta la primera sincronización con n8n' });
```

`apps/hub-api/src/equipos/config.ts` (Edit):

a) En `entornoDelProceso`, detrás de `EQUIPOS_DRIVE_TEMPORAL: process.env.EQUIPOS_DRIVE_TEMPORAL,`:

```ts
  EQUIPOS_SYNC_TOKEN: process.env.EQUIPOS_SYNC_TOKEN,
  EQUIPOS_SYNC_MAX_HORAS: process.env.EQUIPOS_SYNC_MAX_HORAS,
```

b) Detrás de `export const DIRECCION_ALERTA = /^[^\s@]+@ambientalia\.com\.co$/;`:

```ts

/** Horas que puede tener, como mucho, la última sincronización completa de n8n. */
export const MAX_HORAS_SYNC_POR_DEFECTO = 6;
```

c) En `interface ConfigEquipos`, detrás de `reserva: string;`:

```ts
  /** EQUIPOS_SYNC_MAX_HORAS: con una copia de Drive más vieja, la corrida falla. */
  maxHorasSync: number;
  /** Si EQUIPOS_SYNC_TOKEN está y vale como cabecera. Nunca su valor: lo lee requireCronToken (auth.ts). */
  tokenSync: boolean;
```

d) Detrás de `const esToken = …;`:

```ts
/** Un entero de hasta tres cifras (luego se acota de 1 a 168). */
const HORAS = /^\d{1,3}$/;
```

e) En `leerConfig`, sustituir:

```ts
    reserva: DIRECCION_ALERTA.test(reserva) ? reserva : RESERVA_POR_DEFECTO,
  };
```

por:

```ts
    reserva: DIRECCION_ALERTA.test(reserva) ? reserva : RESERVA_POR_DEFECTO,
    maxHorasSync: maxHoras >= 1 && maxHoras <= 168 ? maxHoras : MAX_HORAS_SYNC_POR_DEFECTO,
    tokenSync: esToken(env.EQUIPOS_SYNC_TOKEN),
  };
```

y, justo antes del `return {` de `leerConfig`:

```ts
  const horas = (env.EQUIPOS_SYNC_MAX_HORAS ?? '').trim();
  const maxHoras = HORAS.test(horas) ? Number(horas) : NaN;
```

- [ ] **Step 4: Ver que pasan**

```bash
cd apps/hub-api && npx vitest run src/equipos/config.test.ts src/equipos/contrato.test.ts src/equipos/router.test.ts
npm test --workspace=apps/equipos-taller
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS todo. (`env-example.test.ts` sigue en rojo, ahora con `EQUIPOS_SYNC_MAX_HORAS` y `EQUIPOS_SYNC_TOKEN`: Tarea 8.)

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/config.ts apps/hub-api/src/equipos/config.test.ts apps/hub-api/src/equipos/contrato.ts apps/hub-api/src/equipos/contrato.test.ts apps/hub-api/src/equipos/router.ts apps/hub-api/src/equipos/router.test.ts apps/equipos-taller/src/EquiposServicio.test.tsx apps/equipos-taller/src/api.test.ts
git commit -m "feat(equipos-taller): configuración de la sincronización con n8n y sus avisos en pantalla"
```

---

### Task 7: La corrida lee la copia de n8n (servicio, montaje y rutas)

**Files:**
- Modify (sustituir): `apps/hub-api/src/equipos/servicio.ts`, `servicio.test.ts`, `index.ts`, `index.test.ts`
- Modify: `apps/hub-api/src/equipos/router.ts`, `router.test.ts`, `apps/hub-api/src/index.ts` (comentario)

- [ ] **Step 1: Escribir la prueba del servicio que falla**

Sustituir `apps/hub-api/src/equipos/servicio.test.ts` entero:

```ts
import { describe, expect, it } from 'vitest';
import { CAUSA_COPIA_DRIVE, crearServicioEquipos, vigilarFuentes, type DepsServicio, type FuentesCorrida } from './servicio.js';
import { FalloArchivo, type FuenteDrive } from './fuente-n8n.js';
import { SinDesk2, type FuenteDesk2 } from './fuente-desk2.js';
import { CV, EST, type CacheEscaneos, type Foto, type RemisionEntrada } from './nucleo/index.js';
import { CorridaCerrada, type RepoEquipos, type CorridaBuena } from './repo.js';
import type { SincronizacionHecha } from './repo-sync.js';
import { CAUSA_SYNC_ATRASADA, type Corrida, type Incidente } from './contrato.js';
import type { DecisionIncidente } from './incidente.js';
import type { CanalAlerta, CorreoAlerta } from './alerta.js';

// Una corrida de punta a punta con un repositorio EN MEMORIA y fuentes simuladas: candado,
// Desk 2.0 → frescura de la copia de Drive → núcleo → foto, y el incidente con su alerta.
// El SQL: repo.db.test.ts y repo-sync.db.test.ts. Todo ficticio.
const FOTO_VIEJA: Foto = { at: '2026-11-08T11:35:00.000Z', hoy: '2026-11-08', rows: [], ilegibles: [] };
const AHORA = Date.parse('2026-11-10T11:30:00.000Z');
const HORA = 3_600_000;
/** La última pasada completa de n8n: terminó hace 70 minutos. */
const SYNC: SincronizacionHecha = { pasada: '101', inicio: '2026-11-10T10:00:00.000Z', fin: '2026-11-10T10:20:00.000Z' };
const haceHoras = (h: number, masMs = 0): SincronizacionHecha => ({ ...SYNC, fin: new Date(AHORA - h * HORA - masMs).toISOString() });

function repoEnMemoria() {
  const s = {
    foto: FOTO_VIEJA as Foto | null,
    exits: null as CacheEscaneos | null,
    cacheEnt: {} as Record<string, RemisionEntrada>,
    enCurso: false,
    corridas: [] as Corrida[],
    incidente: null as Incidente | null,
    correos: ['jefe@ambientalia.com.co'],
    alertas: [] as { id: number; ok: boolean }[],
  };
  let n = 0;
  const cerrar = (id: number, ok: boolean, causa: string | null, extra: Partial<Corrida> = {}) => {
    s.enCurso = false;
    const c = s.corridas.find((x) => x.id === id)!;
    Object.assign(c, { enCurso: false, ok, causa, fin: '2026-11-10T11:40:00.000Z', ...extra });
  };
  const repo: RepoEquipos = {
    iniciarCorrida: async (origen) => {
      if (s.enCurso) return null;
      s.enCurso = true;
      s.corridas.push({ id: ++n, origen, inicio: '', fin: null, enCurso: true, ok: null, causa: null, avisos: [], conteos: null });
      return n;
    },
    leerCaches: async () => ({ exits: s.exits, ent: s.cacheEnt }),
    terminarBien: async (id, r: CorridaBuena) => { s.foto = r.foto; s.exits = r.exits; s.cacheEnt = r.ent; cerrar(id, true, null, { avisos: r.avisos, conteos: r.conteos }); },
    terminarMal: async (id, causa, exits) => { if (exits) s.exits = exits; cerrar(id, false, causa); },
    leerFoto: async () => s.foto,
    leerAjustes: async () => ({}),
    guardarAjuste: async () => { throw new Error('no se usa'); },
    borrarAjuste: async () => {},
    ultimaCorrida: async () => s.corridas.at(-1) ?? null,
    ultimaCorridaBuena: async () => [...s.corridas].reverse().find((c) => c.ok) ?? null,
    ultimaCorridaTerminada: async () => [...s.corridas].reverse().find((c) => !c.enCurso) ?? null,
    incidenteAbierto: async () => s.incidente,
    aplicarIncidente: async (d: DecisionIncidente) => {
      if (d.accion === 'abrir') s.incidente = { id: 1, abiertoEn: '', fallosProgramados: d.fallosProgramados, alertaEnviadaEn: null, alertaUltimoError: null };
      else if (d.accion === 'cerrar') s.incidente = null;
      else if (d.accion === 'contar' && s.incidente) s.incidente.fallosProgramados = d.fallosProgramados;
      return s.incidente?.id ?? null;
    },
    marcarAlerta: async (id, r) => {
      s.alertas.push({ id, ok: r.ok });
      if (s.incidente) Object.assign(s.incidente, r.ok ? { alertaEnviadaEn: 'ya' } : { alertaUltimoError: r.error });
    },
    correosAlerta: async () => s.correos,
    llavesDe: async () => ({ editaAjustes: false, recibeAlertas: false }),
    listarLlaves: async () => [],
    guardarLlaves: async () => null,
  };
  return { repo, s };
}

const block = (sn: string) => 'REMISIÓN DE SERVICIO TÉCNICO\n\n\\#S/N\n\nEDM180C\n\nGrimm\n\n' + sn + '\n';
function fuentes(
  o: {
    textoPdf?: (id: string) => Promise<string>;
    sonda?: () => Promise<{ total: number; conCf: number }>;
    tickets?: FuenteDesk2['tickets'];
  } = {},
): FuentesCorrida {
  const drive: FuenteDrive = {
    entradas: async () => [{ id: 'E1', title: '261101 - CLIENTE A - 18A90001' }, { id: 'E2', title: '260901 - CLIENTE B - 18A90002' }],
    salidasGeneradas: async () => [],
    salidasEscaneadas: async () => [{ id: 'S1', title: '260915 - CLIENTE B.pdf' }, { id: 'S2', title: '261020 - CLIENTE C.pdf' }],
    textoPdf: o.textoPdf ?? (async (id) => (id === 'S1' ? block('18A90002') : '')),
    remisionEntrada: async () => '',
  };
  const desk2: FuenteDesk2 = {
    sonda: o.sonda ?? (async () => ({ total: 3, conCf: 3 })),
    tickets: o.tickets ?? (async () => []),
    ticketNumero: async () => [],
    comentarios: async () => [],
  };
  return { drive, desk2 };
}
function canalFalso(ok = true) {
  const enviados: { correo: CorreoAlerta; ref: number }[] = [];
  const canal: CanalAlerta = { encendido: true, enviar: async (correo, ref) => { enviados.push({ correo, ref }); return ok ? { ok: true } : { ok: false, error: 'n8n respondió 500' }; } };
  return { canal, enviados };
}
/** El servicio con la copia de Drive al día, salvo que `o` diga otra cosa. */
const crear = (f: () => FuentesCorrida, repo: RepoEquipos, canal = canalFalso().canal, o: Partial<DepsServicio> = {}) =>
  crearServicioEquipos({
    repo, sync: { ultimaSincronizacion: async () => SYNC }, fuentes: () => f(), maxHorasSync: 6, canal,
    reserva: 'comercial@ambientalia.com.co', log: () => {}, hoy: () => '2026-11-10', ahora: () => AHORA, ...o,
  });
const conSync = (s: SincronizacionHecha | null): Partial<DepsServicio> => ({ sync: { ultimaSincronizacion: async () => s } });

describe('una corrida buena', () => {
  it('escribe la foto con sus conteos y la caché de OCR', async () => {
    const { repo, s } = repoEnMemoria();
    const r = await crear(() => fuentes(), repo).ejecutar('boton', null);
    expect(r).toMatchObject({ estado: 'ok', conteos: { en_taller: 1, remisiones_ilegibles: 1 } });
    expect(s.foto?.rows.map((x) => x.sn + ':' + x.est).sort()).toEqual(['18A90001:' + EST.TALLER, '18A90002:' + EST.ENTREGADO]);
    expect(s.exits?.v).toBe(CV);
    expect(s.corridas[0]).toMatchObject({ ok: true, causa: null });
  });

  it('avisa (sin fallar) de los tickets de Desk 2.0 que no traen raw.cf', async () => {
    const { repo } = repoEnMemoria();
    const r = await crear(() => fuentes({ sonda: async () => ({ total: 10, conCf: 7 }) }), repo).ejecutar('boton', null);
    expect(r.estado === 'ok' && r.avisos).toContain('3 tickets de Desk 2.0 sin campos personalizados (raw.cf): se usan solo sus columnas');
  });

  it('D10: el OCR se relee de la copia en cada corrida, así que un PDF renombrado sale con su nombre nuevo', async () => {
    const { repo, s } = repoEnMemoria();
    s.exits = { v: CV, list: [{ id: 'S1', n: '260915 - NOMBRE VIEJO.pdf', d: '2026-09-15', t: [], it: {} }] };
    const leidos: string[] = [];
    await crear(() => fuentes({ textoPdf: async (id) => { leidos.push(id); return id === 'S1' ? block('18A90002') : ''; } }), repo).ejecutar('boton', null);
    expect(leidos.sort()).toEqual(['S1', 'S2']);
    expect(s.exits?.list.find((x) => x.id === 'S1')?.n).toBe('260915 - CLIENTE B.pdf');
  });

  it('la caché de remisiones de entrada SÍ se usa: una entrada ya leída no se vuelve a pedir', async () => {
    const { repo, s } = repoEnMemoria();
    s.cacheEnt = { E1: { eq: 'EDM180C', srv: '', k: '' } };
    const pedidas: string[] = [];
    const f = fuentes();
    f.drive.remisionEntrada = async (id) => { pedidas.push(id); return ''; };
    await crear(() => f, repo).ejecutar('boton', null);
    expect(pedidas).toEqual([]);
    expect(s.foto?.rows.find((x) => x.sn === '18A90001')?.eq).toBe('EDM180C');
  });

  it('las fuentes se construyen con la pasada con la que corre', async () => {
    const { repo } = repoEnMemoria();
    let vista: SincronizacionHecha | null = null;
    await crear(() => fuentes(), repo, canalFalso().canal, { fuentes: (x) => { vista = x; return fuentes(); } }).ejecutar('boton', null);
    expect(vista).toEqual(SYNC);
  });
});

describe('la copia de Drive que manda n8n', () => {
  it('sin ninguna sincronización completa: «sin_configurar», y no se registra corrida ni incidente', async () => {
    const { repo, s } = repoEnMemoria();
    const srv = crear(() => fuentes(), repo, canalFalso().canal, conSync(null));
    expect(await srv.configurado()).toBe(false);
    expect(await srv.lanzar('boton', null)).toBe('sin_configurar');
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'sin_configurar' });
    expect(s.corridas).toEqual([]);
    expect(s.incidente).toBeNull();
  });

  it('con una sincronización completa, configurado', async () => {
    expect(await crear(() => fuentes(), repoEnMemoria().repo).configurado()).toBe(true);
  });

  it('más vieja que el máximo: la corrida falla sin leer la copia ni tocar la foto', async () => {
    const { repo, s } = repoEnMemoria();
    let leyo = false;
    const f = fuentes();
    f.drive.entradas = async () => { leyo = true; return []; };
    expect(await crear(() => f, repo, canalFalso().canal, conSync(haceHoras(6, 1))).ejecutar('boton', null)).toEqual({ estado: 'error', causa: CAUSA_SYNC_ATRASADA });
    expect(leyo).toBe(false);
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('justo en el máximo todavía vale; el máximo es configurable', async () => {
    expect((await crear(() => fuentes(), repoEnMemoria().repo, canalFalso().canal, conSync(haceHoras(6))).ejecutar('boton', null)).estado).toBe('ok');
    const r = await crear(() => fuentes(), repoEnMemoria().repo, canalFalso().canal, { ...conSync(haceHoras(2)), maxHorasSync: 1 }).ejecutar('boton', null);
    expect(r).toEqual({ estado: 'error', causa: CAUSA_SYNC_ATRASADA });
  });

  it('atrasada cuenta para el incidente: a la 2.ª programada sale la alerta con esa causa', async () => {
    const { repo } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const srv = crear(() => fuentes(), repo, canal, conSync(haceHoras(30)));
    await srv.ejecutar('programada', null);
    await srv.ejecutar('programada', null);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].correo.cuerpo).toMatch(/sincronización de n8n atrasada/);
  });

  it('si fallan a la vez Desk 2.0 y la frescura, la causa es la de Desk 2.0', async () => {
    const f = fuentes({ sonda: async () => { throw new SinDesk2(); } });
    expect(await crear(() => f, repoEnMemoria().repo, canalFalso().canal, conSync(haceHoras(30))).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'desk2: sin configurar' });
  });

  it('si no se puede leer la copia (la base), la corrida falla sin tocar la foto', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes();
    f.drive.entradas = async () => { throw Object.assign(new Error('pg: host secreto'), { code: 'ECONNRESET' }); };
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: CAUSA_COPIA_DRIVE });
    expect(s.foto).toBe(FOTO_VIEJA);
  });
});

describe('una corrida fallida', () => {
  it('si falla Desk 2.0 no toca la foto ni lee la copia', async () => {
    const { repo, s } = repoEnMemoria();
    let leyo = false;
    const f = fuentes({ sonda: async () => { throw new SinDesk2(); } });
    f.drive.entradas = async () => { leyo = true; return []; };
    expect(await crear(() => f, repo).ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'desk2: sin configurar' });
    expect(s.foto).toBe(FOTO_VIEJA);
    expect(leyo).toBe(false);
  });

  it('si Desk 2.0 falla a mitad (un serial), la corrida falla aunque el núcleo siga', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ tickets: async () => { throw Object.assign(new Error('pg: host secreto'), { code: '57014' }); } });
    expect(await crear(() => f, repo).ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'desk2: tiempo agotado' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('si la copia falla al leer un PDF (la base, no el archivo), no toca la foto pero SÍ guarda el OCR que ya salió', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new Error('pg: host secreto'); return block('18A90002'); } });
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: CAUSA_COPIA_DRIVE });
    expect(s.foto).toBe(FOTO_VIEJA);
    expect(s.exits?.list.map((x) => x.id)).toEqual(['S1']);
  });

  it('si TODOS los PDF están sin texto (2 o más) y ninguno sale, la corrida falla', async () => {
    for (const [status, cola] of [[403, 'HTTP 403'], [null, 'texto pendiente de n8n']] as const) {
      const { repo, s } = repoEnMemoria();
      const f = fuentes({ textoPdf: async () => { throw new FalloArchivo(status); } });
      expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: no se pudo convertir ningún PDF (' + cola + ')' });
      expect(s.foto).toBe(FOTO_VIEJA);
    }
  });
});

describe('un PDF sin texto en la copia (A9)', () => {
  it('con un fallo guardado: la corrida sigue, el PDF va a ilegibles con su código y NO entra en la caché', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new FalloArchivo(400); return block('18A90002'); } });
    const r = await crear(() => f, repo).ejecutar('boton', null);
    expect(r).toMatchObject({ estado: 'ok', conteos: { remisiones_ilegibles: 1 } });
    expect(s.foto?.ilegibles).toContainEqual({
      id: 'S2',
      n: '261020 - CLIENTE C.pdf',
      d: '2026-10-20',
      m: 'sin texto legible',
      q: 'Google Drive no pudo convertir este PDF a texto (HTTP 400): revisar el archivo en Drive',
      p: [],
    });
    expect(s.exits?.list.map((x) => x.id)).toEqual(['S1']);
  });

  it('con el texto todavía pendiente: también va a ilegibles, diciendo que falta n8n', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new FalloArchivo(null); return block('18A90002'); } });
    expect((await crear(() => f, repo).ejecutar('boton', null)).estado).toBe('ok');
    expect(s.foto?.ilegibles?.find((x) => x.id === 'S2')?.q).toBe('n8n todavía no ha enviado el texto de este PDF: se pedirá en la próxima sincronización');
  });

  it('en la siguiente corrida, si ya tiene texto, deja de ser ilegible por ese motivo', async () => {
    const { repo, s } = repoEnMemoria();
    let roto = true;
    const f = () => fuentes({ textoPdf: async (id) => { if (id === 'S2' && roto) throw new FalloArchivo(400); return block(id === 'S2' ? '18A90001' : '18A90002'); } });
    await crear(f, repo).ejecutar('boton', null);
    roto = false;
    await crear(f, repo).ejecutar('boton', null);
    expect(s.foto?.ilegibles?.some((x) => x.id === 'S2')).toBe(false);
    expect(s.exits?.list.map((x) => x.id).sort()).toEqual(['S1', 'S2']);
  });
});

describe('candado', () => {
  it('con una corrida en curso, la segunda responde «ocupado»; al terminar, se suelta', async () => {
    const { repo } = repoEnMemoria();
    let soltar: () => void = () => {};
    const espera = new Promise<void>((r) => (soltar = r));
    const f = fuentes();
    const listar = f.drive.salidasEscaneadas;
    f.drive.salidasEscaneadas = async () => { await espera; return listar(); };
    const srv = crear(() => f, repo);
    expect(await srv.lanzar('boton', null)).toBe('iniciada');
    expect(srv.actualizando()).toBe(true);
    expect(await srv.lanzar('boton', null)).toBe('ocupado');
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'ocupado' });
    soltar();
    await srv.enCurso();
    expect(srv.actualizando()).toBe(false);
    expect(await srv.lanzar('boton', null)).toBe('iniciada');
    await srv.enCurso();
  });
});

describe('incidente y alerta', () => {
  const caida = () => fuentes({ sonda: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); } });
  it('1 fallo programado no avisa; el 2.º sí, a los correos con la llave; el 3.º ya no', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const srv = crear(caida, repo, canal);
    await srv.ejecutar('programada', null);
    expect(enviados).toHaveLength(0);
    await srv.ejecutar('programada', null);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].correo.para).toEqual(['jefe@ambientalia.com.co']);
    expect(enviados[0].correo.cuerpo).toMatch(/desk2: sin conexión/);
    await srv.ejecutar('programada', null);
    expect(enviados).toHaveLength(1);
    expect(s.incidente?.fallosProgramados).toBe(3);
  });

  it('si el webhook falla, se apunta el error y la siguiente programada lo reintenta; una buena cierra', async () => {
    const { repo, s } = repoEnMemoria();
    s.correos = [];
    const malo = canalFalso(false);
    const srv = crear(caida, repo, malo.canal);
    await srv.ejecutar('programada', null);
    await srv.ejecutar('programada', null);
    expect(s.incidente?.alertaUltimoError).toBe('n8n respondió 500');
    expect(malo.enviados[0].correo.para).toEqual(['comercial@ambientalia.com.co']);
    await srv.ejecutar('programada', null);
    expect(malo.enviados).toHaveLength(2);
    await crear(() => fuentes(), repo, malo.canal).ejecutar('boton', null);
    expect(s.incidente).toBeNull();
  });
});

describe('vigilarFuentes', () => {
  it('apunta la primera causa de cada origen y Desk 2.0 manda sobre la copia', async () => {
    const f = fuentes({ tickets: async () => { throw Object.assign(new Error('x'), { code: '42501' }); } });
    f.drive.salidasEscaneadas = async () => { throw new Error('pg: host secreto'); };
    const v = vigilarFuentes(f);
    await v.fuentes.salidasEscaneadas().catch(() => {});
    expect(v.fallo()).toBe(CAUSA_COPIA_DRIVE);
    await v.fuentes.tickets('18A90001').catch(() => {});
    expect(v.fallo()).toBe('desk2: consulta rechazada (permisos o esquema)');
  });

  it('un FalloArchivo de UN PDF no es fallo de la corrida y sale en pdfsSinTexto con su título', async () => {
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new FalloArchivo(403); return 'texto'; } });
    const v = vigilarFuentes(f);
    await v.fuentes.salidasEscaneadas();
    await v.fuentes.textoPdf('S1');
    await expect(v.fuentes.textoPdf('S2')).rejects.toBeInstanceOf(FalloArchivo);
    expect(v.fallo()).toBeNull();
    expect(v.pdfsSinTexto()).toEqual([{ id: 'S2', n: '261020 - CLIENTE C.pdf', status: 403 }]);
  });

  it('cualquier otro error al leer un PDF o una remisión (la base) sí hace fallar la corrida', async () => {
    const f = fuentes({ textoPdf: async () => { throw new Error('pg caído'); } });
    f.drive.remisionEntrada = async () => { throw new Error('pg caído'); };
    const v = vigilarFuentes(f);
    await v.fuentes.textoPdf('S1').catch(() => {});
    await v.fuentes.remisionEntrada!('E1').catch(() => {});
    expect(v.fallo()).toBe(CAUSA_COPIA_DRIVE);
    expect(v.pdfsSinTexto()).toEqual([]);
    expect(v.entradasSinLeer()).toEqual([]);
  });
});

const ticketAbierto = async () => [
  { id: 'T1', ticketNumber: '1401', status: 'Open', statusType: 'Open', createdTime: '2026-11-02T10:00:00.000Z', modifiedTime: '2026-11-03T10:00:00.000Z', cf: { cf_serial: '18A90001' } },
];

describe('fallos de fuente a mitad de la corrida', () => {
  it('si fallan los comentarios de un ticket (Desk 2.0), la corrida falla con «desk2: …» y no toca la foto', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ tickets: ticketAbierto });
    f.desk2.comentarios = async () => { throw Object.assign(new Error('pg: host secreto'), { code: '42501' }); };
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'desk2: consulta rechazada (permisos o esquema)' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('si falla leer una remisión de entrada en la base (no el archivo), la corrida falla', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes();
    f.drive.remisionEntrada = async () => { throw new Error('pg caído'); };
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: CAUSA_COPIA_DRIVE });
    expect(s.foto).toBe(FOTO_VIEJA);
  });
});

describe('alerta según el origen', () => {
  it('un fallo lanzado con el botón nunca envía la alerta, ni repetido', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const srv = crear(() => fuentes({ sonda: async () => { throw new SinDesk2(); } }), repo, canal);
    for (let i = 0; i < 3; i++) await srv.ejecutar('boton', null);
    expect(enviados).toHaveLength(0);
    expect(s.incidente?.fallosProgramados ?? 0).toBe(0);
  });
});

describe('corrida abandonada (el repositorio rechaza el cierre)', () => {
  const abandonar = (repo: RepoEquipos, que: 'bien' | 'mal' | 'ambas'): RepoEquipos => ({
    ...repo,
    terminarBien: que === 'mal' ? repo.terminarBien : async () => { throw new CorridaCerrada(); },
    terminarMal: que === 'bien' ? repo.terminarMal : async () => { throw new CorridaCerrada(); },
  });
  const caida = () => fuentes({ sonda: async () => { throw new SinDesk2(); } });

  it('una corrida buena que termina tarde se descarta: ni incidente ni alerta', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const srv = crear(() => fuentes(), abandonar(repo, 'bien'), canal);
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'abandonada' });
    expect(s.incidente).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it('una corrida fallida que termina tarde no cuenta para el incidente aunque sea programada', async () => {
    const { repo, s } = repoEnMemoria();
    const { canal, enviados } = canalFalso();
    const r = abandonar(repo, 'mal');
    const srv = crear(caida, r, canal);
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'abandonada' });
    s.enCurso = false;
    expect(await srv.ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'abandonada' });
    expect(s.incidente).toBeNull();
    expect(enviados).toHaveLength(0);
  });
});

describe('robustez del candado y del registro', () => {
  it('si el repositorio falla al cerrar la corrida, el candado del proceso se suelta', async () => {
    const { repo } = repoEnMemoria();
    const roto: RepoEquipos = { ...repo, terminarBien: async () => { throw new Error('pg caído'); }, terminarMal: async () => { throw new Error('pg caído'); } };
    const srv = crear(() => fuentes(), roto);
    expect(await srv.ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'interno: no se pudo guardar' });
    expect(srv.actualizando()).toBe(false);
  });

  it('un error inesperado se registra con su nombre y código, nunca con el mensaje', async () => {
    const { repo } = repoEnMemoria();
    const roto: RepoEquipos = { ...repo, leerCaches: async () => { throw Object.assign(new Error('pg: host secreto'), { code: 'ECONNRESET' }); } };
    const logs: string[] = [];
    const srv = crear(() => fuentes(), roto, canalFalso().canal, { log: (t) => { logs.push(t); } });
    expect(await srv.ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'interno: error inesperado' });
    const texto = logs.join('\n');
    expect(texto).toMatch(/Error/);
    expect(texto).toMatch(/ECONNRESET/);
    expect(texto).not.toMatch(/secreto/);
  });

  it('lanzar no deja una promesa rechazada sin atender si el registro del incidente revienta', async () => {
    const { repo } = repoEnMemoria();
    const srv = crear(() => fuentes(), repo, canalFalso().canal, { log: () => { throw new Error('log roto'); } });
    const sin: unknown[] = [];
    const h = (e: unknown) => sin.push(e);
    process.on('unhandledRejection', h);
    expect(await srv.lanzar('boton', null)).toBe('iniciada');
    await new Promise((r) => setTimeout(r, 20));
    process.off('unhandledRejection', h);
    expect(sin).toEqual([]);
  });
});

describe('ilegibles', () => {
  it('tras añadir los PDF sin texto, siguen de más reciente a más antiguo', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new FalloArchivo(400); return ''; } });
    await crear(() => f, repo).ejecutar('boton', null);
    const d = (s.foto?.ilegibles ?? []).map((x) => x.d);
    expect(d).toEqual([...d].sort((a, b) => b.localeCompare(a)));
    expect(d.length).toBeGreaterThan(1);
  });
});

describe('una remisión de entrada sin texto en la copia (A9 extendido)', () => {
  const entradaRota = (rota: Set<string>, status: number | null = 400) => (id: string) => {
    if (rota.has(id)) throw new FalloArchivo(status);
    return Promise.resolve('');
  };

  it('con un fallo guardado en UNA: la corrida sigue, la entrada figura, hay aviso sin secretos y no entra en la caché', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes();
    f.drive.remisionEntrada = async (id) => entradaRota(new Set(['E1']))(id);
    const r = await crear(() => f, repo).ejecutar('boton', null);
    expect(r.estado).toBe('ok');
    expect(s.foto?.rows.map((x) => x.sn)).toContain('18A90001');
    expect(r.estado === 'ok' && r.avisos).toContain('Remisión de entrada 18A90001: Drive HTTP 400');
    expect(s.cacheEnt?.E1).toBeUndefined();
  });

  it('con el texto todavía pendiente, el aviso lo dice', async () => {
    const { repo } = repoEnMemoria();
    const f = fuentes();
    f.drive.remisionEntrada = async (id) => entradaRota(new Set(['E1']), null)(id);
    const r = await crear(() => f, repo).ejecutar('boton', null);
    expect(r.estado === 'ok' && r.avisos).toContain('Remisión de entrada 18A90001: n8n todavía no envió su texto');
  });

  it('en la siguiente corrida, con su texto, se lee y se guarda en la caché', async () => {
    const { repo, s } = repoEnMemoria();
    const rotas = new Set(['E1']);
    const f = () => { const x = fuentes(); x.drive.remisionEntrada = async (id) => entradaRota(rotas)(id); return x; };
    await crear(f, repo).ejecutar('boton', null);
    rotas.clear();
    await crear(f, repo).ejecutar('boton', null);
    expect(s.cacheEnt?.E1).toBeDefined();
  });

  it('2 o más sin texto y ninguna sale: la corrida falla', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes();
    f.drive.entradas = async () => [{ id: 'E1', title: '261101 - CLIENTE A - 18A90001' }, { id: 'E3', title: '261102 - CLIENTE D - 18A90003' }];
    f.drive.remisionEntrada = async (id) => entradaRota(new Set(['E1', 'E3']), 403)(id);
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: no se pudo leer ninguna remisión de entrada (HTTP 403)' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/servicio.test.ts
```

Esperado: FAIL en casi todas. `servicio.ts` aún importa `fuente-drive.js` y no usa `deps.sync`: «sin_configurar» no sale, `CAUSA_COPIA_DRIVE` es `undefined` y `limpiarTemporal` no existe en las fuentes nuevas.

- [ ] **Step 3: Implementar el servicio**

Sustituir `apps/hub-api/src/equipos/servicio.ts` entero:

```ts
/**
 * Una corrida de «Equipos en taller» (§5.1 del diseño, con la revisión del 10/11/2026):
 *   1. Candado. Sin ninguna sincronización completa de n8n, «sin configurar» (503) y no
 *      se registra nada. Si la hay, la corrida se inserta «en curso»; si choca, «ocupado» (409).
 *   2. Desk 2.0: una sonda antes de nada. Si falla → «desk2: <motivo>».
 *   3. Frescura: si la última pasada completa de n8n tiene más de `maxHorasSync` horas
 *      → CAUSA_SYNC_ATRASADA (D5: nunca una foto con datos incompletos).
 *   4. Copia de Drive + núcleo: `actualizar` con las fuentes VIGILADAS. El núcleo
 *      convierte muchos fallos en avisos y sigue; aquí, cualquier fallo de una fuente hace
 *      fallida la corrida. Si falla la copia, el OCR ya leído se guarda igual (`exits` es caché).
 *      EXCEPCIÓN (A9): un archivo concreto sin texto (`FalloArchivo`: n8n guardó su fallo,
 *      o el texto aún no llegó) no es un fallo de la fuente. Un PDF va a ilegibles; una
 *      remisión de entrada, a avisos (el núcleo no la cachea y el equipo cuenta por el
 *      nombre de su carpeta). Si fallan todos los intentados (2 o más) y ninguno sale, sí
 *      falla la corrida.
 *      D10: la caché `exits` NO entra al núcleo, que relee de la copia el OCR de todos los
 *      PDF (una consulta, no un OCR). Así, un PDF renombrado o un texto reenviado se nota
 *      en la corrida siguiente. La de remisiones de entrada (`ent`) sí entra.
 *   5. Foto y cierre en una transacción (repo.terminarBien).
 * Después, el incidente (incidente.ts) y, si toca, la alerta (alerta.ts).
 *
 * Una corrida fallida NUNCA toca `foto`. La siguiente es el reintento.
 */
import { actualizar, hoyBogota } from './nucleo/actualizar.js';
import { iso } from './nucleo/reglas.js';
import { EST, type Foto, type Fuentes, type Ilegible, type Resultado } from './nucleo/tipos.js';
import { CAUSA_SYNC_ATRASADA, type OrigenCorrida } from './contrato.js';
import { decidirIncidente } from './incidente.js';
import { correoAlerta, destinatarios, type CanalAlerta } from './alerta.js';
import { FalloArchivo, type FuenteDrive } from './fuente-n8n.js';
import { motivoDesk2, type FuenteDesk2 } from './fuente-desk2.js';
import { CorridaCerrada, type RepoEquipos } from './repo.js';
import type { RepoSync, SincronizacionHecha } from './repo-sync.js';

const HORA_MS = 3_600_000;

/** Causa de la corrida cuando falla la lectura de la copia de Drive (la base de hub-api), no un archivo. */
export const CAUSA_COPIA_DRIVE = 'interno: no se pudo leer la copia de Drive';

/** Para el registro: nombre y código del error, NUNCA su mensaje ni su pila (pueden llevar datos de la base). */
function huella(e: unknown): string {
  const nombre = String((e as { name?: unknown } | null)?.name ?? 'desconocido').slice(0, 40);
  const code = (e as { code?: unknown } | null)?.code;
  return nombre + (typeof code === 'string' || typeof code === 'number' ? ' ' + String(code).slice(0, 20) : '');
}

export interface FuentesCorrida {
  drive: FuenteDrive;
  desk2: FuenteDesk2;
}

export type ResultadoCorrida =
  | { estado: 'ok'; conteos: Record<string, number>; avisos: string[] }
  | { estado: 'error'; causa: string }
  | { estado: 'ocupado' }
  | { estado: 'sin_configurar' };

export interface ServicioEquipos {
  /** Hay al menos una sincronización completa de n8n (si no, «sin configurar»). */
  configurado(): Promise<boolean>;
  /** Hay una corrida de este proceso en marcha. */
  actualizando(): boolean;
  /** Para la ruta POST: empieza la corrida y no espera. */
  lanzar(origen: OrigenCorrida, userId: string | null): Promise<'iniciada' | 'ocupado' | 'sin_configurar'>;
  /** Para el programador: corre y espera a que termine. */
  ejecutar(origen: OrigenCorrida, userId: string | null): Promise<ResultadoCorrida>;
  /** Para las pruebas: la corrida en marcha (o null). */
  enCurso(): Promise<ResultadoCorrida> | null;
}

export interface DepsServicio {
  repo: RepoEquipos;
  /** De la copia de Drive, el servicio solo mira la última pasada completa. */
  sync: Pick<RepoSync, 'ultimaSincronizacion'>;
  /** Fuentes NUEVAS para cada corrida, sobre la pasada con la que corre (la de Desk 2.0 guarda un mapa por corrida). */
  fuentes: (s: SincronizacionHecha) => FuentesCorrida;
  /** EQUIPOS_SYNC_MAX_HORAS: con una copia más vieja, la corrida falla. */
  maxHorasSync: number;
  canal: CanalAlerta;
  reserva: string;
  log?: (t: string) => void;
  hoy?: () => string;
  /** El reloj de la frescura (las pruebas lo fijan). */
  ahora?: () => number;
}

/** Conteos de la foto, para `equipos_ejecucion.conteos` (tendencia y psql). */
export function contar(foto: Foto): Record<string, number> {
  const n = (e: string) => foto.rows.filter((x) => x.est === e).length;
  return {
    en_taller: n(EST.TALLER),
    servicio_externo: n(EST.EXTERNO),
    revisar: n(EST.REVISAR),
    ticket_cerrado_sin_salida: n(EST.CERRADO),
    salio_ticket_abierto: foto.rows.filter((x) => x.est === EST.ENTREGADO && x.z && !x.zc).length,
    remisiones_ilegibles: (foto.ilegibles || []).length,
  };
}

/** Un PDF de salida escaneada sin texto en la copia (A9). */
export interface PdfSinTexto {
  id: string;
  /** Nombre del archivo en Drive (el id si no apareció en el listado). */
  n: string;
  /** El fallo que guardó n8n, o null si su texto todavía no llegó. */
  status: number | null;
}

/** Cómo se nombra en una causa el fallo de un archivo. */
const etiqueta = (status: number | null): string => (status === null ? 'texto pendiente de n8n' : 'HTTP ' + status);

/** La fila de ilegibles de un PDF sin texto. `d` sale del AAMMDD del nombre, como en el núcleo. */
export function ilegibleSinTexto(p: PdfSinTexto): Ilegible {
  return {
    id: p.id,
    n: p.n,
    d: iso((p.n.match(/^\d{6}/) || [''])[0]),
    m: 'sin texto legible',
    q: p.status === null
      ? 'n8n todavía no ha enviado el texto de este PDF: se pedirá en la próxima sincronización'
      : 'Google Drive no pudo convertir este PDF a texto (HTTP ' + p.status + '): revisar el archivo en Drive',
    p: [],
  };
}

/**
 * Las fuentes del núcleo, vigiladas: cada fallo se apunta (el primero de cada origen, ya
 * traducido a una causa sin secretos) y el error sigue su camino. Un `FalloArchivo` al
 * leer el texto de un PDF se aparta en `pdfsSinTexto()`, y el de una remisión de entrada
 * en `entradasSinLeer()`: no hacen fallar la corrida (A9), salvo que fallen 2 o más y
 * ninguno salga. Cualquier otro error de la copia es de la base: CAUSA_COPIA_DRIVE.
 */
export function vigilarFuentes(f: FuentesCorrida): {
  fuentes: Fuentes;
  fallo(): string | null;
  pdfsSinTexto(): PdfSinTexto[];
  entradasSinLeer(): { id: string; status: number | null }[];
} {
  let desk2: string | null = null;
  let drive: string | null = null;
  const titulos = new Map<string, string>();
  const sinTexto: PdfSinTexto[] = [];
  let convertidos = 0;
  const entSinLeer: { id: string; status: number | null }[] = [];
  let entLeidas = 0;
  const de = <A extends unknown[], R>(origen: 'desk2' | 'drive', fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        return await fn(...a);
      } catch (e) {
        if (origen === 'desk2') desk2 ??= 'desk2: ' + motivoDesk2(e);
        else drive ??= CAUSA_COPIA_DRIVE;
        throw e;
      }
    };
  return {
    fuentes: {
      entradas: de('drive', () => f.drive.entradas()),
      salidasGeneradas: de('drive', () => f.drive.salidasGeneradas()),
      salidasEscaneadas: de('drive', async () => {
        const lista = await f.drive.salidasEscaneadas();
        for (const a of lista) titulos.set(a.id, a.title);
        return lista;
      }),
      textoPdf: async (id: string) => {
        try {
          const t = await f.drive.textoPdf(id);
          convertidos++;
          return t;
        } catch (e) {
          if (e instanceof FalloArchivo) sinTexto.push({ id, n: titulos.get(id) ?? id, status: e.status });
          else drive ??= CAUSA_COPIA_DRIVE;
          throw e; // el núcleo lo apunta en avisos y NO lo mete en la caché
        }
      },
      remisionEntrada: async (id: string) => {
        try {
          const t = await f.drive.remisionEntrada(id);
          entLeidas++;
          return t;
        } catch (e) {
          if (e instanceof FalloArchivo) entSinLeer.push({ id, status: e.status });
          else drive ??= CAUSA_COPIA_DRIVE;
          throw e; // el núcleo lo apunta en avisos y NO lo mete en la caché
        }
      },
      tickets: de('desk2', (sn: string) => f.desk2.tickets(sn)),
      ticketNumero: de('desk2', (n: string) => f.desk2.ticketNumero(n)),
      comentarios: de('desk2', (id: string) => f.desk2.comentarios(id)),
    },
    fallo: () =>
      desk2 ??
      drive ??
      (sinTexto.length >= 2 && convertidos === 0 ? 'drive: no se pudo convertir ningún PDF (' + etiqueta(sinTexto[0].status) + ')' : null) ??
      (entSinLeer.length >= 2 && entLeidas === 0 ? 'drive: no se pudo leer ninguna remisión de entrada (' + etiqueta(entSinLeer[0].status) + ')' : null),
    pdfsSinTexto: () => [...sinTexto],
    entradasSinLeer: () => [...entSinLeer],
  };
}

export function crearServicioEquipos(deps: DepsServicio): ServicioEquipos {
  const log = deps.log ?? ((t: string) => console.log(t));
  const hoy = deps.hoy ?? hoyBogota;
  const ahora = deps.ahora ?? Date.now;
  let actual: Promise<ResultadoCorrida> | null = null;

  async function registrarIncidente(origen: OrigenCorrida, ok: boolean, causa: string | null): Promise<void> {
    try {
      const abierto = await deps.repo.incidenteAbierto();
      const d = decidirIncidente({ origen, ok }, abierto);
      const id = await deps.repo.aplicarIncidente(d, abierto?.id ?? null);
      if (!d.enviarAlerta || id === null) return;
      const buena = await deps.repo.ultimaCorridaBuena();
      const para = destinatarios(await deps.repo.correosAlerta(), deps.reserva);
      const r = await deps.canal.enviar({ para, ...correoAlerta({ causa: causa ?? '', fallosProgramados: d.fallosProgramados, fotoBuena: buena?.fin ?? null }) }, id);
      await deps.repo.marcarAlerta(id, r);
      log(r.ok ? 'equipos-taller: alerta enviada (incidente ' + id + ')' : 'equipos-taller: la alerta no salió: ' + r.error);
    } catch {
      log('equipos-taller: no se pudo registrar el incidente');
    }
  }

  async function correr(id: number, origen: OrigenCorrida, s: SincronizacionHecha): Promise<ResultadoCorrida> {
    let causa: string | null = null;
    let fin: ResultadoCorrida;
    let guardando = false;
    const abandonada = (): ResultadoCorrida => {
      log('equipos-taller: corrida ' + id + ' abandonada; resultado descartado');
      return { estado: 'error', causa: 'abandonada' };
    };
    try {
      const f = deps.fuentes(s);
      let sonda: { total: number; conCf: number } | null = null;
      try {
        sonda = await f.desk2.sonda();
      } catch (e) {
        causa = 'desk2: ' + motivoDesk2(e);
      }
      // D5: con una copia de Drive vieja no se clasifica (n8n dejó de sincronizar).
      if (!causa && ahora() - Date.parse(s.fin) > deps.maxHorasSync * HORA_MS) causa = CAUSA_SYNC_ATRASADA;
      let r: Resultado | null = null;
      let sinTexto: PdfSinTexto[] = [];
      if (!causa) {
        const v = vigilarFuentes(f);
        const cache = await deps.repo.leerCaches();
        try {
          // D10: `exits: null`, el OCR se relee de la copia; `ent` sí se reutiliza.
          r = await actualizar(v.fuentes, { snap: null, exits: null, ent: cache.ent, cmt: {} }, { hoy: hoy(), prog: () => {} });
        } catch (e) {
          if (!v.fallo()) log('equipos-taller: error inesperado en el núcleo (' + huella(e) + ')');
          causa = v.fallo() ?? 'interno: error inesperado';
        }
        causa ??= v.fallo();
        sinTexto = v.pdfsSinTexto();
      }
      if (causa || !r) {
        const c = causa ?? 'interno: error inesperado';
        guardando = true;
        await deps.repo.terminarMal(id, c, r ? r.exits : null);
        fin = { estado: 'error', causa: c };
      } else {
        const sinCf = sonda && sonda.total > sonda.conCf ? sonda.total - sonda.conCf : 0;
        const avisos = [...r.avisos];
        if (sinCf) avisos.push(sinCf + ' tickets de Desk 2.0 sin campos personalizados (raw.cf): se usan solo sus columnas');
        // A9: los PDF sin texto van a ilegibles (no están en la caché). Mismo orden que el núcleo: más reciente primero.
        const foto: Foto = sinTexto.length
          ? { ...r.snap, ilegibles: [...(r.snap.ilegibles ?? []), ...sinTexto.map(ilegibleSinTexto)].sort((a, b) => b.d.localeCompare(a.d)) }
          : r.snap;
        const conteos = contar(foto);
        guardando = true;
        await deps.repo.terminarBien(id, { foto, exits: r.exits, ent: r.ent, avisos, conteos });
        fin = { estado: 'ok', conteos, avisos };
      }
    } catch (e) {
      // Cerrar una corrida que ya no estaba en curso (abandonada): se descarta y NO cuenta para el incidente.
      if (e instanceof CorridaCerrada) return abandonada();
      // Si no, falló el repo (guardando) o algo antes de guardar: se intenta cerrar la corrida para soltar el candado.
      log('equipos-taller: error inesperado ' + (guardando ? 'al guardar' : 'al preparar la corrida') + ' (' + huella(e) + ')');
      causa = guardando ? 'interno: no se pudo guardar' : 'interno: error inesperado';
      try {
        await deps.repo.terminarMal(id, causa, null);
      } catch (e2) {
        if (e2 instanceof CorridaCerrada) return abandonada();
        log('equipos-taller: no se pudo cerrar la corrida (' + huella(e2) + ')');
      }
      fin = { estado: 'error', causa };
    }
    log('equipos-taller: corrida ' + id + ' (' + origen + ') ' + (fin.estado === 'error' ? 'fallida: ' + fin.causa : 'terminada'));
    await registrarIncidente(origen, fin.estado === 'ok', fin.estado === 'error' ? fin.causa : null);
    return fin;
  }

  /** El candado y el arranque. La corrida va envuelta (`{ corrida }`) para que el `async` no la espere. */
  async function arrancar(origen: OrigenCorrida, userId: string | null): Promise<'ocupado' | 'sin_configurar' | { corrida: Promise<ResultadoCorrida> }> {
    const s = await deps.sync.ultimaSincronizacion();
    if (!s) return 'sin_configurar';
    const id = await deps.repo.iniciarCorrida(origen, userId);
    if (id === null) return 'ocupado';
    const corrida: Promise<ResultadoCorrida> = correr(id, origen, s).finally(() => {
      if (actual === corrida) actual = null;
    });
    actual = corrida;
    return { corrida };
  }

  return {
    configurado: async () => (await deps.sync.ultimaSincronizacion()) !== null,
    actualizando: () => actual !== null,
    async lanzar(origen, userId) {
      const a = await arrancar(origen, userId);
      if (typeof a === 'string') return a;
      a.corrida.catch(() => {}); // nadie la espera: que un fallo tardío no sea un rechazo sin atender
      return 'iniciada';
    },
    async ejecutar(origen, userId) {
      const a = await arrancar(origen, userId);
      return typeof a === 'string' ? { estado: a } : a.corrida;
    },
    enCurso: () => actual,
  };
}
```

- [ ] **Step 4: Ver que pasa el servicio**

```bash
cd apps/hub-api && npx vitest run src/equipos/servicio.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Escribir la prueba del montaje que falla**

Sustituir `apps/hub-api/src/equipos/index.test.ts` entero:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearEquiposTaller } from './index.js';
import { detenerProgramadorEquipos } from './programador.js';
import { leerConfig } from './config.js';

// El montaje: el programador se enciende siempre (sin sincronización de n8n, cada corrida
// programada se omite) y montar no toca la base (el pool es un doble que falla si alguien lo usa).
const pool = { query: async () => { throw new Error('no se debe consultar al montar'); }, connect: async () => { throw new Error('no'); } } as unknown as Pool;

afterEach(() => {
  detenerProgramadorEquipos();
  vi.restoreAllMocks();
});

describe('crearEquiposTaller', () => {
  it('sin EQUIPOS_SYNC_TOKEN lo dice nombrando solo la variable, y el programador se enciende igual, una vez', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const m = crearEquiposTaller(pool, () => null, leerConfig({}));
    expect(warn.mock.calls.flat().join(' ')).toMatch(/falta o no vale EQUIPOS_SYNC_TOKEN/);
    expect(m.iniciarProgramador()).toBe(true);
    expect(m.iniciarProgramador()).toBe(false);
  });

  it('con el token no avisa de él y nunca enseña su valor', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = crearEquiposTaller(pool, () => null, leerConfig({ EQUIPOS_SYNC_TOKEN: 'token-ficticio-123' }));
    const t = warn.mock.calls.flat().join(' ');
    expect(t).not.toMatch(/EQUIPOS_SYNC_TOKEN/);
    expect(t).not.toMatch(/token-ficticio-123/);
    expect(typeof m.sync.registrarListado).toBe('function');
  });

  it('«configurado» lo decide la base: sin ninguna pasada completa de n8n, false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vacia = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error('no'); } } as unknown as Pool;
    expect(await crearEquiposTaller(vacia, () => null, leerConfig({})).servicio.configurado()).toBe(false);
  });
});
```

- [ ] **Step 6: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/index.test.ts
```

Esperado: FAIL. Sin Drive no enciende el programador, no hay `m.sync` y `configurado()` no es una promesa.

- [ ] **Step 7: Implementar el montaje**

Sustituir `apps/hub-api/src/equipos/index.ts` entero:

```ts
/**
 * «Equipos en taller» montado: configuración, fuentes, repositorios, servicio y
 * programador. Lo usa index.ts (y nadie más) tras initDb().
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { DbLectura } from '../trazabilidad/fuente.js';
import { crearCanalAlerta } from './alerta.js';
import { leerConfig, type ConfigEquipos } from './config.js';
import { fuenteDesk2 } from './fuente-desk2.js';
import { fuenteN8n } from './fuente-n8n.js';
import { iniciarProgramadorEquipos } from './programador.js';
import { crearRepoEquipos, type RepoEquipos } from './repo.js';
import { crearRepoSync, type RepoSync, type SincronizacionHecha } from './repo-sync.js';
import { crearServicioEquipos, type ServicioEquipos } from './servicio.js';

export { createEquiposTallerRouter } from './router.js';
export { detenerProgramadorEquipos } from './programador.js';

export interface EquiposTaller {
  repo: RepoEquipos;
  /** La copia de Drive que manda n8n (rutas /equipos-taller/sync/*). */
  sync: RepoSync;
  servicio: ServicioEquipos;
  /** Enciende la corrida diaria. Hasta la primera sincronización completa de n8n, cada corrida programada se omite. */
  iniciarProgramador(): boolean;
}

export function crearEquiposTaller(hub: Pool, desk2: () => DbLectura | null, cfg: ConfigEquipos = leerConfig()): EquiposTaller {
  const repo = crearRepoEquipos(hub);
  const sync = crearRepoSync(hub);
  // Fuentes NUEVAS en cada corrida (nunca memoizadas): la de Desk 2.0 guarda un mapa de ids
  // de ticket por corrida, y la de Drive lee la copia tal como la dejó la pasada `s`.
  const fuentes = (s: SincronizacionHecha) => ({ drive: fuenteN8n(sync, s.pasada), desk2: fuenteDesk2(desk2) });
  const servicio = crearServicioEquipos({ repo, sync, fuentes, maxHorasSync: cfg.maxHorasSync, canal: crearCanalAlerta(cfg.alerta), reserva: cfg.reserva });
  if (!cfg.tokenSync) console.warn('equipos-taller: falta o no vale EQUIPOS_SYNC_TOKEN: n8n no podrá mandar la copia de Drive');
  return {
    repo,
    sync,
    servicio,
    // Nunca corre al arrancar (A7): solo agenda la próxima hora diaria.
    iniciarProgramador: () => iniciarProgramadorEquipos(() => servicio.ejecutar('programada', null), { hora: cfg.horaDiaria }),
  };
}
```

- [ ] **Step 8: Ver que pasa el montaje**

```bash
cd apps/hub-api && npx vitest run src/equipos/index.test.ts
```

Esperado: PASS.

- [ ] **Step 9: Cambiar la prueba del router (falla)**

En `apps/hub-api/src/equipos/router.test.ts` (Edit):

a) Detrás del import de `./contrato.js`:

```ts
import type { RepoSync } from './repo-sync.js';
```

b) En el doble `servicio`:

```ts
  configurado: async () => configurado,
```

c) En `app()`:

```ts
  a.use('/api', createEquiposTallerRouter({ repo, servicio, sync: {} as unknown as RepoSync }));
```

d) Al final del fichero:

```ts
describe('rutas de n8n', () => {
  it('están montadas y las guarda su token, no la sesión', async () => {
    delete process.env.EQUIPOS_SYNC_TOKEN;
    const r = await request(app()).post(B + '/sync/fin').set('Authorization', token({ role: 'admin' }).auth).send({ pasada: '1', conteos: {} });
    expect([r.status, r.body]).toEqual([401, { error: 'unauthorized' }]);
  });
});
```

```bash
cd apps/hub-api && npx vitest run src/equipos/router.test.ts
```

Esperado: FAIL. `configurado` llega como un objeto `{}` (la promesa sin esperar) y `/sync/fin` da 404.

- [ ] **Step 10: Cambiar el router (Edit en `apps/hub-api/src/equipos/router.ts`)**

a) En el comentario de cabecera, detrás de la línea de `PUT /equipos-taller/llaves/:userId`:

```ts
 *   POST   /equipos-taller/sync/{listado,texto,fin}   n8n, con token de máquina y sin sesión (router-sync.ts)
```

b) Los imports, detrás de `import type { ServicioEquipos } from './servicio.js';`:

```ts
import type { RepoSync } from './repo-sync.js';
import { createEquiposSyncRouter } from './router-sync.js';
```

c) `DepsRouter`:

```ts
export interface DepsRouter {
  repo: RepoEquipos;
  servicio: ServicioEquipos;
  /** La copia de Drive que manda n8n. */
  sync: RepoSync;
}
```

d) Justo detrás de `const router = Router();`:

```ts
  // Las rutas de n8n: sin sesión ni app; las guarda su token (EQUIPOS_SYNC_TOKEN).
  router.use(createEquiposSyncRouter(deps.sync));
```

e) En `GET /equipos-taller`, sustituir el `Promise.all` y el campo:

```ts
    const [snap, ajustes, enCurso, ultima, ultimaBuena, incidente, llaves, configurado] = await Promise.all([
      deps.repo.leerFoto(), deps.repo.leerAjustes(), deps.repo.ultimaCorrida(), deps.repo.ultimaCorridaTerminada(), deps.repo.ultimaCorridaBuena(), deps.repo.incidenteAbierto(), deps.repo.llavesDe(q.userId), deps.servicio.configurado(),
    ]);
```

y `configurado: deps.servicio.configurado(),` por `configurado,`.

- [ ] **Step 11: El comentario del montaje en `apps/hub-api/src/index.ts` (Edit)**

Sustituir:

```ts
    // Equipos en taller: qué equipos están físicamente en el taller (remisiones de
    // Drive x tickets y comentarios de Desk 2.0). Sin la configuración de Drive queda
    // «sin configurar» (la pantalla lo dice) y su programador no se enciende.
```

por:

```ts
    // Equipos en taller: qué equipos están físicamente en el taller (la copia de Drive
    // que manda n8n x tickets y comentarios de Desk 2.0). Hasta la primera
    // sincronización completa de n8n queda «sin configurar» (la pantalla lo dice).
```

- [ ] **Step 12: Ver que pasa todo lo del módulo y que compila**

```bash
cd apps/hub-api && npx vitest run src/equipos
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado:
- Vitest: PASS en todos los ficheros de `src/equipos`. `fuente-drive.test.ts` todavía existe y pasa: se borra en la Tarea 8. `reales.local.test.ts` sale `skipped` donde no están las fixtures reales.
- tsc: ningún error nuevo.
- `env-example.test.ts` sigue en rojo hasta la Tarea 8.

- [ ] **Step 13: Commit**

```bash
git add apps/hub-api/src/equipos/servicio.ts apps/hub-api/src/equipos/servicio.test.ts apps/hub-api/src/equipos/index.ts apps/hub-api/src/equipos/index.test.ts apps/hub-api/src/equipos/router.ts apps/hub-api/src/equipos/router.test.ts apps/hub-api/src/index.ts
git commit -m "feat(equipos-taller): la corrida diaria lee la copia de n8n y exige que esté al día"
```

---

### Task 8: Retirar la lectura directa de Drive

**Files:**
- Delete: `apps/hub-api/src/equipos/fuente-drive.ts`, `apps/hub-api/src/equipos/fuente-drive.test.ts`
- Modify (sustituir): `apps/hub-api/src/equipos/config.ts`, `config.test.ts`
- Modify (⚠️ USUARIO): `apps/hub-api/.env.example`

- [ ] **Step 1: Escribir la prueba de configuración final (falla)**

Sustituir `apps/hub-api/src/equipos/config.test.ts` entero:

```ts
import { describe, expect, it } from 'vitest';
import { HORA_POR_DEFECTO, leerConfig, MAX_HORAS_SYNC_POR_DEFECTO, RESERVA_POR_DEFECTO } from './config.js';

// Configuración desde el entorno. Drive ya no se configura aquí: lo lee n8n y manda la copia.
// Todo ficticio.
describe('leerConfig', () => {
  it('ya no lee Drive: ni cuenta de servicio ni carpetas', () => {
    const c = leerConfig({ EQUIPOS_GOOGLE_CUENTA_SERVICIO: '{"client_email":"x"}', EQUIPOS_DRIVE_ENTRADAS: 'carpetaEntradas01' });
    expect(Object.keys(c).sort()).toEqual(['alerta', 'horaDiaria', 'maxHorasSync', 'reserva', 'tokenSync']);
  });

  it('la hora diaria es 06:30 salvo una HH:MM válida', () => {
    expect(leerConfig({}).horaDiaria).toBe(HORA_POR_DEFECTO);
    expect(leerConfig({ EQUIPOS_HORA_DIARIA: '07:15' }).horaDiaria).toBe('07:15');
    expect(leerConfig({ EQUIPOS_HORA_DIARIA: '25:00' }).horaDiaria).toBe(HORA_POR_DEFECTO);
  });

  it('la alerta necesita URL https (o un servicio interno) y token; si no, queda apagada', () => {
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'https://n8n.example/webhook/x', EQUIPOS_ALERTA_TOKEN: 't0k' }).alerta).toEqual({ url: 'https://n8n.example/webhook/x', token: 't0k' });
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'http://n8n:5678/webhook/x', EQUIPOS_ALERTA_TOKEN: 't0k' }).alerta).not.toBeNull();
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'http://n8n.example/webhook/x', EQUIPOS_ALERTA_TOKEN: 't0k' }).alerta).toBeNull();
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'https://n8n.example/webhook/x' }).alerta).toBeNull();
  });

  it('la reserva es comercial@ salvo otra dirección del dominio', () => {
    expect(leerConfig({}).reserva).toBe(RESERVA_POR_DEFECTO);
    expect(leerConfig({ EQUIPOS_ALERTA_RESERVA: 'Taller@Ambientalia.com.co' }).reserva).toBe('taller@ambientalia.com.co');
    expect(leerConfig({ EQUIPOS_ALERTA_RESERVA: 'alguien@gmail.com' }).reserva).toBe(RESERVA_POR_DEFECTO);
  });

  it('el token de la alerta se recorta', () => {
    expect(leerConfig({ EQUIPOS_ALERTA_WEBHOOK_URL: 'https://n8n.example/webhook/x', EQUIPOS_ALERTA_TOKEN: '  t0k\n' }).alerta?.token).toBe('t0k');
  });
});

describe('leerConfig: la copia de Drive que manda n8n', () => {
  it('la frescura máxima es de 6 h salvo un entero de 1 a 168', () => {
    expect(MAX_HORAS_SYNC_POR_DEFECTO).toBe(6);
    expect(leerConfig({}).maxHorasSync).toBe(MAX_HORAS_SYNC_POR_DEFECTO);
    expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: '12' }).maxHorasSync).toBe(12);
    expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: ' 168 ' }).maxHorasSync).toBe(168);
    for (const v of ['0', '169', '1.5', '-3', 'seis', '']) expect(leerConfig({ EQUIPOS_SYNC_MAX_HORAS: v }).maxHorasSync, v).toBe(MAX_HORAS_SYNC_POR_DEFECTO);
  });

  it('del token solo se sabe si está y vale como cabecera; su valor no sale', () => {
    expect(leerConfig({}).tokenSync).toBe(false);
    expect(leerConfig({ EQUIPOS_SYNC_TOKEN: 'con espacio' }).tokenSync).toBe(false);
    const c = leerConfig({ EQUIPOS_SYNC_TOKEN: 'token-ficticio-123' });
    expect(c.tokenSync).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/token-ficticio-123/);
  });
});
```

```bash
cd apps/hub-api && npx vitest run src/equipos/config.test.ts
```

Esperado: FAIL solo en «ya no lee Drive»: todavía salen `drive` y `faltaDrive`.

- [ ] **Step 2: Configuración sin Drive**

Sustituir `apps/hub-api/src/equipos/config.ts` entero:

```ts
/**
 * Configuración de «Equipos en taller» a partir del entorno de hub-api (§7 del diseño).
 * Drive ya no se configura aquí: lo lee n8n y manda la copia (revisión del
 * 10/11/2026). El módulo queda «sin configurar» mientras no haya ninguna sincronización
 * completa de n8n, y eso lo dice la base, no el entorno.
 *
 * ⚠️ Lo que se informa son NOMBRES de variables, nunca un valor: los tokens son secretos.
 *
 * Las variables se leen una a una por su nombre: así las ve el detector de
 * `.env.example` (env-example.test.ts, INFRA-537).
 */

type Entorno = Readonly<Record<string, string | undefined>>;

const entornoDelProceso = (): Entorno => ({
  EQUIPOS_SYNC_TOKEN: process.env.EQUIPOS_SYNC_TOKEN,
  EQUIPOS_SYNC_MAX_HORAS: process.env.EQUIPOS_SYNC_MAX_HORAS,
  EQUIPOS_HORA_DIARIA: process.env.EQUIPOS_HORA_DIARIA,
  EQUIPOS_ALERTA_WEBHOOK_URL: process.env.EQUIPOS_ALERTA_WEBHOOK_URL,
  EQUIPOS_ALERTA_TOKEN: process.env.EQUIPOS_ALERTA_TOKEN,
  EQUIPOS_ALERTA_RESERVA: process.env.EQUIPOS_ALERTA_RESERVA,
});

export const HORA_POR_DEFECTO = '06:30';
export const RESERVA_POR_DEFECTO = 'comercial@ambientalia.com.co';
/** Solo salen correos a este dominio (la barrera de n8n dice lo mismo). */
export const DOMINIO_ALERTA = '@ambientalia.com.co';

/** Una dirección de correo del dominio de alertas: una sola arroba, sin espacios. */
export const DIRECCION_ALERTA = /^[^\s@]+@ambientalia\.com\.co$/;

/** Horas que puede tener, como mucho, la última sincronización completa de n8n. */
export const MAX_HORAS_SYNC_POR_DEFECTO = 6;

export interface ConfigAlerta {
  url: string;
  token: string;
}

export interface ConfigEquipos {
  /** HH:MM, hora de Colombia. */
  horaDiaria: string;
  /** null = alerta apagada. */
  alerta: ConfigAlerta | null;
  reserva: string;
  /** EQUIPOS_SYNC_MAX_HORAS: con una copia de Drive más vieja, la corrida falla. */
  maxHorasSync: number;
  /** Si EQUIPOS_SYNC_TOKEN está y vale como cabecera. Nunca su valor: lo lee requireCronToken (auth.ts). */
  tokenSync: boolean;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Un entero de hasta tres cifras (luego se acota de 1 a 168). */
const HORAS = /^\d{1,3}$/;

/** https, o http sólo hacia un servidor de una sola etiqueta (un servicio de Docker); sin usuario ni clave. Igual que trazabilidad/envio-avisos.ts. */
function esUrl(v: string | undefined): boolean {
  if (!v) return false;
  try {
    const u = new URL(v);
    if (u.username !== '' || u.password !== '') return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && u.hostname !== '' && !u.hostname.includes('.') && !u.hostname.includes(':');
  } catch {
    return false;
  }
}
/** Un token válido como valor de cabecera: sólo ASCII visible, sin espacios. */
const esToken = (v: string | undefined): v is string => v !== undefined && /^[\x21-\x7E]+$/.test(v);

export function leerConfig(env: Entorno = entornoDelProceso()): ConfigEquipos {
  const hora = (env.EQUIPOS_HORA_DIARIA ?? '').trim();
  const url = (env.EQUIPOS_ALERTA_WEBHOOK_URL ?? '').trim();
  const token = env.EQUIPOS_ALERTA_TOKEN?.trim();
  const reserva = (env.EQUIPOS_ALERTA_RESERVA ?? '').trim().toLowerCase();
  const horas = (env.EQUIPOS_SYNC_MAX_HORAS ?? '').trim();
  const maxHoras = HORAS.test(horas) ? Number(horas) : NaN;
  return {
    horaDiaria: HORA.test(hora) ? hora : HORA_POR_DEFECTO,
    alerta: esUrl(url) && esToken(token) ? { url, token } : null,
    reserva: DIRECCION_ALERTA.test(reserva) ? reserva : RESERVA_POR_DEFECTO,
    maxHorasSync: maxHoras >= 1 && maxHoras <= 168 ? maxHoras : MAX_HORAS_SYNC_POR_DEFECTO,
    tokenSync: esToken(env.EQUIPOS_SYNC_TOKEN),
  };
}
```

- [ ] **Step 3: Borrar la fuente de Drive**

```bash
git rm apps/hub-api/src/equipos/fuente-drive.ts apps/hub-api/src/equipos/fuente-drive.test.ts
```

- [ ] **Step 4: Comprobar que no queda nada de la cuenta de servicio**

```bash
grep -rn "fuente-drive\|ErrorDrive\|motivoDrive\|limpiarTemporal\|copiasSinBorrar\|PREFIJO_COPIA_OCR\|EQUIPOS_GOOGLE_CUENTA_SERVICIO\|EQUIPOS_DRIVE_\|faltaDrive\|cuentaServicio" apps/hub-api/src apps/equipos-taller/src
```

Esperado: ninguna línea.

- [ ] **Step 5: ⚠️ USUARIO — el bloque de `apps/hub-api/.env.example`**

El agente no puede abrir `.env*`. Pedir al usuario que, en `apps/hub-api/.env.example`, **sustituya el bloque entero de «Equipos en taller»** por este. Va desde la línea `# ─── Equipos en taller (docs/equipos-taller.md) ───…` hasta la de `EQUIPOS_ALERTA_RESERVA`, e incluye las líneas de `EQUIPOS_GOOGLE_CUENTA_SERVICIO` y `EQUIPOS_DRIVE_*` con sus comentarios. Todo va comentado: son nombres, sin valores.

```dotenv
# ─── Equipos en taller (docs/equipos-taller.md) ─────────────────────────────
# Drive lo lee n8n («Equipos · Sincronizar remisiones») y manda aquí la copia.
# Token de máquina de sus rutas (cabecera X-Equipos-Sync-Token): el mismo valor que la
# credencial Header Auth del flujo. Sin él, el módulo sigue «sin configurar».
# ⚠️ Es un secreto: mismo cuidado que el resto mientras EasyPanel imprima las variables
# en el log de build (rotación de secretos pendiente).
# EQUIPOS_SYNC_TOKEN=
# Antigüedad máxima (horas enteras, de 1 a 168) de la última sincronización completa de
# n8n; con más, la corrida falla. Por defecto, 6.
# EQUIPOS_SYNC_MAX_HORAS=6
# Hora de la corrida diaria (HH:MM, hora de Colombia). Por defecto, 06:30.
# EQUIPOS_HORA_DIARIA=06:30
# Webhook de n8n «Equipos · Alerta de foto vieja» y su token (cabecera X-Equipos-Alerta-Token).
# Sin los dos, la alerta queda apagada (se registra en el log).
# EQUIPOS_ALERTA_WEBHOOK_URL=
# EQUIPOS_ALERTA_TOKEN=
# Dirección de reserva si nadie tiene la llave «recibe alertas» (solo @ambientalia.com.co).
# EQUIPOS_ALERTA_RESERVA=comercial@ambientalia.com.co
```

Si el bloque actual no coincide con esas líneas, se quitan todas las líneas `EQUIPOS_GOOGLE_CUENTA_SERVICIO` y `EQUIPOS_DRIVE_*` con sus comentarios, y se añaden las de `EQUIPOS_SYNC_TOKEN` y `EQUIPOS_SYNC_MAX_HORAS`.

- [ ] **Step 6: Ver que todo pasa, el detector incluido**

```bash
cd apps/hub-api && npx vitest run src/equipos src/env-example.test.ts
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: PASS en todos (también `env-example.test.ts`, gracias al bloque del usuario). tsc no da ningún error nuevo.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/equipos/config.ts apps/hub-api/src/equipos/config.test.ts apps/hub-api/.env.example
git commit -m "refactor(equipos-taller): retirar la lectura directa de Drive con cuenta de servicio"
```

(El `git rm` del paso 3 ya dejó indexados los dos borrados. Si el permiso bloquea el `git add` de `.env.example`, el usuario lo añade a este commit con `git add apps/hub-api/.env.example && git commit --amend --no-edit`.)

---

## Fase C — Documentación, flujo de n8n y verificación

### Task 9: Documentación

**Files:**
- Modify (sustituir): `docs/equipos-taller.md`, `apps/equipos-taller/CLAUDE.md`

- [ ] **Step 1: Sustituir `docs/equipos-taller.md` entero**

````markdown
# Equipos en taller

Qué equipos están **físicamente** dentro del taller de servicio técnico, ordenados por fecha de llegada. Cruza las remisiones de entrada y de salida de Google Drive (la copia que manda n8n cada hora) con los tickets de Desk 2.0 y sus comentarios. Diseño: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`, con la revisión «Drive vía n8n» del 10/11/2026.

- **App del portal:** `equipos-taller` (ruta `/equipos-taller`, sub-app `apps/equipos-taller`). Aparece en la barra lateral (`apps/portal/src/lib/apps.ts`) y en Aplicaciones; **no** tiene tarjeta en el Dashboard.
- **Motor:** `apps/hub-api/src/equipos/`. Las reglas viven SOLO en `nucleo/` (puro, sin E/S); la pantalla lo importa por ruta relativa.
- **Datos:** `portal.equipos_*` (migraciones 071 y 072). Para psql: `portal.equipos_v_equipos` y `portal.equipos_v_remisiones_ilegibles`.

## De dónde sale cada dato

**Desk 2.0** (`apps/hub-api/src/equipos/fuente-desk2.ts`, solo lectura, mismo pool que Trazabilidad):

- **Campos `cf_*`:** cada uno se rellena en este orden: `raw.cf`, luego `custom_fields` por etiqueta y luego la columna tipada promovida. En los tickets `managed_by_app` el orden se invierte: primero `custom_fields` y columnas, y `raw.cf` al final. El estado, la fecha de modificación y la de cierre de un ticket gestionado salen de las columnas.
- **Comentarios:** `desk.conversations` con `kind = 'comment'`, los 15 más recientes (`commented_time DESC NULLS LAST`).
- **Etiquetas comprobadas** en la base de Desk 2.0 el 10/11/2026:
  - `custom_fields` guarda «Serial1», «Serial2» y «Serial3» (sin espacio). La búsqueda por etiqueta ignora los separadores, así que coinciden con `cf_serial1` a `cf_serial3`.
  - «Equipo» (`cf_equipo_1`) no aparece en `custom_fields` porque Desk 2.0 lo pasa a la columna `equipo`, que es de donde se lee.
  - «Equipo1» a «Equipo3» son otros campos (los de las remisiones con varios equipos) y el núcleo no los usa.

**Drive, vía n8n.** hub-api no habla con Google: el Workspace de la empresa no deja compartir Drive con cuentas de servicio. El flujo de n8n «Equipos · Sincronizar remisiones» (abajo) lista cada hora las tres carpetas: entradas, salidas generadas por n8n y salidas escaneadas. Manda a hub-api los nombres y los textos, que se guardan en `portal.equipos_drive_archivos` (la copia). Cada pasada queda en `portal.equipos_sincronizacion`.

- **Qué ve la corrida:** la copia tal como la dejó la **última pasada completa**, sin lo borrado en Drive y sin lo que trajo una pasada posterior que aún no tiene texto.
- **Texto de una remisión de entrada:** el primer Google Doc de la carpeta, exportado como Markdown. Si no hay documento, es un texto vacío.
- **Texto de una salida escaneada:** el OCR. n8n copia el PDF como Google Doc con OCR en español, lo exporta a texto y borra la copia.
- **Qué texto pide hub-api:** el de lo nuevo; el de lo que cambió de nombre (mientras llega, vale el viejo); y, cada 6 h, el de lo que tiene un fallo guardado.

## Una corrida

1. **Candado.**
   - Sin ninguna sincronización completa de n8n, la respuesta es «sin configurar» (503) y no se registra nada.
   - Si no, se inserta la corrida «en curso» (`portal.equipos_ejecucion`). Si ya hay otra: 409 «Ya se está actualizando».
   - Una corrida colgada más de 180 min se da por abandonada. Hasta entonces, si el proceso murió a mitad (caída o despliegue), el botón responde 409. El indicador «actualizando» caduca con esos mismos 180 min.
2. **Desk 2.0:** una sonda de `desk.tickets` y `desk.conversations`. Si falla → `desk2: <motivo>`.
3. **Frescura de la copia:** si la última pasada completa de n8n tiene más de `EQUIPOS_SYNC_MAX_HORAS` (6 h por defecto) → `drive: sincronización de n8n atrasada`.
4. **Copia de Drive y núcleo:** se leen los listados de la copia, el OCR de **todos** los PDF y las remisiones de entrada que no están en la caché `ent`. Luego, los tickets por serial y los comentarios de los equipos que siguen adentro.
   - El OCR se relee de la copia: la caché `exits` no se usa como entrada, porque releer es una consulta. Así, un PDF renombrado se ve con su nombre nuevo.
   - Cualquier fallo de una fuente hace fallida la corrida. El OCR ya leído se guarda igual.
   - **Excepciones:**
     - Un PDF sin texto en la copia (n8n guardó su fallo, o el texto aún no llegó) va a remisiones ilegibles y se reintenta en cada corrida.
     - Una remisión de ENTRADA sin texto genera un aviso. La entrada se cuenta igual y se reintenta.
     - Solo si fallan **todos** los intentados (2 o más), la corrida falla.
5. **Foto:** la foto y el cierre de la corrida, en una transacción.

Una corrida fallida **nunca** toca la foto: la pantalla sigue con la última buena. Una corrida abandonada (180 min) tampoco sobrescribe nunca una foto más nueva, y no cuenta para los incidentes. La siguiente corrida es el reintento.

**Aviso de foto vieja en pantalla:**
- Se calcula con la última corrida **terminada**, no con la que está en curso, para que no desaparezca mientras corre.
- Sin ninguna sincronización completa, dice «Falta la primera sincronización con n8n» y el botón queda desactivado.
- El detalle del último error de la alerta (`alertaUltimoError`) solo lo reciben los admin.

| Causa | Qué mirar |
|---|---|
| `desk2: sin configurar` | Falta `DESK2_DB_URL` en hub-api. |
| `desk2: sin conexión` / `tiempo agotado` | La base de Desk 2.0 no responde (mismo pool que Trazabilidad: 3 s para conectar, 5 s por consulta). |
| `desk2: consulta rechazada (permisos o esquema)` | Falta el `GRANT SELECT ON desk.conversations TO portal_agenda_reader`, o cambió una columna. |
| `drive: sincronización de n8n atrasada` | n8n lleva más de `EQUIPOS_SYNC_MAX_HORAS` sin terminar una pasada. Mirar las ejecuciones del flujo en n8n y `portal.equipos_sincronizacion` (abajo). Puede ser una credencial de Drive caducada, el flujo desactivado, un `EQUIPOS_SYNC_TOKEN` distinto del de la credencial Header Auth (401) o un listado rechazado (409). |
| `drive: no se pudo convertir ningún PDF (HTTP 4xx)` | Todos los PDF tienen un fallo guardado. Casi siempre, la cuenta de n8n no puede editar la carpeta temporal del OCR. Un solo PDF que falla no aparece aquí: sale en remisiones ilegibles. |
| `drive: no se pudo convertir ningún PDF (texto pendiente de n8n)` | n8n listó los PDF pero no mandó sus textos (mirar sus ejecuciones). |
| `drive: no se pudo leer ninguna remisión de entrada (…)` | Lo mismo, con las remisiones de entrada. |
| `interno: no se pudo leer la copia de Drive` | Falló la consulta a `portal.equipos_drive_archivos` (la base de hub-api). |

### Si el servidor cayó o se redesplegó a mitad de una corrida

La corrida queda «en curso» en la base y nadie la cierra. Hasta que pasan los 180 min, el botón responde 409 y la pantalla sigue en «Actualizando…».

Para liberarla antes, el dueño puede ejecutar esto en psql. Solo marca como abandonadas las corridas que siguen «en curso» y llevan más de 10 minutos (es el mismo `UPDATE` que usa `repo.ts`, con 10 en vez de 180). Ejecútalo **solo si no hay una corrida realmente en marcha**:

```sql
UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = false, causa = 'abandonada' WHERE en_curso AND inicio < now() - make_interval(mins => 10);
```

La foto no se toca y la corrida abandonada no cuenta para los incidentes.

### Notas de operación

- **Límites de Drive.** Drive informa de los límites de uso como 429, o como 403 con motivo `rateLimitExceeded` o `userRateLimitExceeded`. El flujo no los manda como fallo del archivo: el archivo se pide en la pasada siguiente. Otro 403 de un archivo (por ejemplo, demasiado grande para exportarlo) sí se guarda, y se vuelve a pedir cada 6 h. Mientras, el PDF sale como «sin texto legible».
- **Límite de peticiones de hub-api.** `/api/` admite 60 peticiones por minuto y por IP, y todas las de n8n salen de la misma. Por eso el flujo hace una pausa de 1 s antes de cada envío de texto y reintenta los 429.
- **Pool de Desk 2.0.** El pool tiene 2 conexiones y las comparte con Trazabilidad. Si aparece `desk2: tiempo agotado`, esa es la causa más probable.

## Corrida diaria e incidentes

- **Hora:** las `EQUIPOS_HORA_DIARIA` de Colombia (06:30 por defecto). No hay corrida de recuperación al arrancar: si un despliegue cae después de la hora, se usa el botón.
- **Programador:** se enciende siempre. Mientras no haya ninguna sincronización completa, cada corrida programada se omite (lo dice el log) y no cuenta para los incidentes.
- **Incidente:**
  - Lo abre la primera corrida fallida tras una buena.
  - Solo las corridas **programadas** suman fallos. Con 2 seguidos se envía **una** alerta.
  - Si el envío falla, se guarda el error (`alerta_ultimo_error`) y se reintenta en la siguiente programada.
  - Una corrida buena lo cierra.
  - Si n8n deja de sincronizar, las corridas programadas fallan por copia atrasada y, a la segunda, sale la alerta.
- **Destinatarios:** solo los usuarios **activos** que sean admin o tengan la app, **y** tengan la llave «recibe alertas». Si no hay ninguno, `EQUIPOS_ALERTA_RESERVA` (por defecto comercial@ambientalia.com.co). Solo direcciones `@ambientalia.com.co`.

```sql
-- Últimas corridas y el incidente abierto
SELECT id, origen, inicio, fin, ok, causa FROM portal.equipos_ejecucion ORDER BY id DESC LIMIT 10;
SELECT * FROM portal.equipos_incidente WHERE cerrado_en IS NULL;
```

## Pantalla

Vistas, columnas, motivos y ajustes manuales vienen de la herramienta original. Los filtros **Cliente**, **Estado en Desk**, **Sin ticket** y **Quitar filtros** se portaron de la versión nueva del original (`nucleo/pantalla.ts`).

`RETIRADOS_FIJOS` está **vacío a propósito**. Tras el despliegue hay un caso conocido que debe volver a marcarse a mano con «Marcar retirado».

## Permisos

| Acción | Quién |
|---|---|
| Abrir, filtrar, «Actualizar información» | Quien tenga la app `equipos-taller`, y los admin. |
| Ajustes manuales («Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste», «Ya revisada») | La llave `edita_ajustes`, o ser admin. |
| Gestionar las llaves («Llaves de la app», al final de la pantalla) | Los admin. Las llaves solo se pueden dar a usuarios **activos** que tengan la app (o sean admin). |
| Recibir la alerta | La llave `recibe_alertas` (los admin no la tienen por defecto), con el usuario activo y con la app o admin. |
| Mandar la copia de Drive | Solo n8n, con el token `EQUIPOS_SYNC_TOKEN`. |

La migración no siembra ni la app ni las llaves: se asignan a mano.

## Variables de hub-api

| Variable | Uso |
|---|---|
| `EQUIPOS_SYNC_TOKEN` | El token de máquina de las rutas de n8n (cabecera `X-Equipos-Sync-Token`). Es el mismo valor que la credencial Header Auth del flujo. Sin él, n8n no puede mandar la copia (lo dice el log al arrancar). ⚠️ Es un secreto: mismo cuidado que el resto mientras EasyPanel imprima las variables en el log de build. |
| `EQUIPOS_SYNC_MAX_HORAS` | Antigüedad máxima de la última sincronización completa, en horas enteras de 1 a 168. Por defecto, 6. |
| `EQUIPOS_HORA_DIARIA` | HH:MM de Colombia. Por defecto, `06:30`. |
| `EQUIPOS_ALERTA_WEBHOOK_URL`, `EQUIPOS_ALERTA_TOKEN` | El webhook de n8n y su token. Sin los dos, la alerta queda apagada (lo dice el log al arrancar). |
| `EQUIPOS_ALERTA_RESERVA` | Dirección de reserva. Por defecto, comercial@ambientalia.com.co. |
| `DESK2_DB_URL` | Ya existe (Trazabilidad). Si falta, todas las corridas fallan con `desk2: sin configurar`. |

Ya no hay variables de la cuenta de servicio ni de las carpetas de Drive. Los IDs de las carpetas viven solo en el nodo «Configuración» del flujo de n8n.

## Pasos pendientes del usuario

1. **`.env.example`:** pegar el bloque `EQUIPOS_*` en `apps/hub-api/.env.example`, porque los agentes no pueden escribir ficheros `.env*`.
2. **Desk 2.0:** `GRANT SELECT ON desk.conversations TO portal_agenda_reader;`
3. **Token en EasyPanel:** cargar `EQUIPOS_SYNC_TOKEN` en hub-api. Si se cargaron, quitar las variables de Drive de la versión anterior.
4. **Flujo de sincronización en n8n:** terminar «Equipos · Sincronizar remisiones» (abajo):
   - ponerle la credencial de Drive y la Header Auth con el token, y rellenar «Configuración»;
   - ejecutarlo a mano una vez (es la carga completa) y comprobar la pasada;
   - después, activarlo.
5. **Flujo de la alerta:** dejarlo **inactivo** hasta configurar la alerta.
6. **App y llaves:** asignarlas a los usuarios, y volver a marcar a mano el retirado conocido.
7. **Cuenta de servicio:** borrar la cuenta de servicio de Google y su clave, que ya no se usan.

## Flujo de n8n «Equipos · Sincronizar remisiones»

Lo crea un agente por el MCP de n8n, **inactivo y sin credenciales**. El detalle de los nodos está en la Tarea 10 de `docs/superpowers/plans/2026-11-10-equipos-taller-sync-n8n.md`.

El usuario completa tres cosas:
- le pone la credencial de Google Drive de n8n;
- crea la credencial Header Auth (nombre `X-Equipos-Sync-Token`; valor, el de `EQUIPOS_SYNC_TOKEN`);
- rellena el nodo «Configuración»: la URL de hub-api (la misma que usan los flujos de WO-sales y Ausencias), los IDs de las tres carpetas y el de la carpeta temporal del OCR (en el Drive de la cuenta de esa credencial). Los IDs no se escriben en el repo.

**Cómo corre:**
- **Cuándo:** cada hora, en el minuto 10. Cada ejecución es una **pasada**, y su id es `{{ $execution.id }}`.
- **Autenticación:** las tres llamadas a hub-api llevan la cabecera `X-Equipos-Sync-Token`. Sin la variable en hub-api, o con otro valor: `401 { "error": "unauthorized" }`.
- **Orden de una pasada:** barrido de la carpeta temporal → entradas → salidas generadas por n8n → salidas escaneadas → «fin». En cada carpeta: el listado completo y, después, los textos de `faltaTexto`.
- **Parámetros de Drive:** todas las llamadas llevan `supportsAllDrives=true`; las de listado, además, `includeItemsFromAllDrives=true` y `corpora=allDrives`, como hacía hub-api.

**1. Listado** — `POST <hub>/api/equipos-taller/sync/listado`

```json
{ "pasada": "4711", "carpeta": "entradas", "archivos": [{ "id": "<id de Drive>", "titulo": "261101 - CLIENTE A - 18A90001" }] }
```

- **`carpeta`:** `entradas`, `salidas_n8n` o `salidas_escaneadas`.
- **`archivos`:** TODOS los de la carpeta (todas las páginas), con `id` y `titulo` (el nombre en Drive, tal cual). Hasta 10 000, con nombres de 1 a 300 caracteres e ids sin repetir.
- **Qué se lista:** siempre con `trashed = false`.
  - En entradas y salidas_n8n, las carpetas (`mimeType = 'application/vnd.google-apps.folder'`).
  - En salidas_escaneadas, los PDF y las imágenes (`mimeType = 'application/pdf' or mimeType contains 'image/'`).
- **Respuestas:**
  - `200 { "faltaTexto": ["<id>", …] }`: los ids a los que n8n debe mandar texto. Siempre está vacío en salidas_n8n.
  - `409 { "error": "pasada_en_curso" }`: otra pasada empezó hace menos de 2 h y no ha terminado. La ejecución se para. Es normal si la anterior (la carga completa) sigue en marcha.
  - `409 { "error": "pasada_cerrada" }`: esta pasada ya mandó «fin».
  - `409 { "error": "listado_sospechoso", "bajas": n, "vivos": m, "carpeta": "<carpeta>" }`: el listado viene vacío con la carpeta llena, o borraría más de 10 archivos y más de la mitad. `carpeta` es la que perdería los archivos: la del listado o, si los ids son de otra carpeta (se moverían a esta), esa otra; el mensaje la nombra. No se aplica nada. Casi siempre es un ID de carpeta equivocado o un permiso perdido; si de verdad se vació la carpeta, ver más abajo.
  - `400 { "error": "invalid_input", "message": "…" }`: el cuerpo no vale. El mensaje es fijo y no repite lo recibido.

**2. Texto** — `POST <hub>/api/equipos-taller/sync/texto`, uno por archivo:

```json
{ "id": "<id de Drive>", "texto": "…" }
{ "id": "<id de Drive>", "error": { "status": 403 } }
```

- **Entradas:** `texto` es el **primer** Google Doc de la carpeta, exportado con `files/<doc>/export?mimeType=text/markdown`. Se busca con `'<id>' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'` y `pageSize=5`, y vale el primero que devuelva Drive. Sin documento: `"texto": ""`.
- **Salidas escaneadas:** `texto` es el OCR, en tres llamadas:
  1. `POST files/<pdf>/copy?supportsAllDrives=true&ocrLanguage=es&fields=id` con `{ "mimeType": "application/vnd.google-apps.document", "name": "ocr-tmp-<id del pdf>", "parents": ["<carpeta temporal>"] }`. Sin reintentos: no es idempotente.
  2. `GET files/<copia>/export?mimeType=text/plain`.
  3. `DELETE files/<copia>?supportsAllDrives=true`, **siempre**, también si la exportación falló.
- **`error.status`:** solo si el fallo es de ESE archivo, es decir, un 4xx que no sea 401 ni 429, ni un 403 de cuota (motivo `rateLimitExceeded` o `userRateLimitExceeded`). Cualquier otro fallo (401, 429, 5xx, red, copia sin id) no se manda: el archivo queda pendiente y se pide en la pasada siguiente.
- **Límites:** el texto se recorta a 200 000 caracteres (hub-api también lo hace), y hub-api quita el carácter nulo.
- **Respuestas:**
  - `204`: guardado.
  - `404 { "error": "desconocido" }`: el archivo ya no está en la copia (se borró entre medias). Se ignora.
  - `400`: el cuerpo no vale.

**3. Fin** — `POST <hub>/api/equipos-taller/sync/fin`

```json
{ "pasada": "4711", "conteos": { "entradas": 312, "salidas_n8n": 40, "salidas_escaneadas": 190 } }
```

- **`conteos`:** los archivos listados en cada carpeta. Lleva las tres claves, con enteros ≥ 0, y ninguna más.
- **Respuestas:**
  - `200 { "ok": true }`: la pasada cuenta como **completa**. La corrida diaria la usa y mide desde ella la frescura.
  - `404 { "error": "pasada_desconocida" }`.
  - `409 { "error": "pasada_cerrada" }`.
  - `409 { "error": "pasada_incompleta" }`: falta el listado de alguna carpeta.

**Si algo falla a mitad:**
- Un listado de Drive que falla, o un listado que hub-api no acepta, para la ejecución sin «fin». La pasada no cuenta.
- Si n8n no termina ninguna pasada en `EQUIPOS_SYNC_MAX_HORAS`, las corridas fallan con «sincronización de n8n atrasada» y, a la segunda programada, sale la alerta.
- Un texto que no se pudo mandar (tras 3 intentos) no para la pasada: ese archivo se vuelve a pedir en la siguiente.

**Barrido:** al empezar cada pasada, n8n borra de la carpeta temporal los archivos cuyo nombre empieza por `ocr-tmp-`. Los busca con `'<temporal>' in parents and trashed = false and name contains 'ocr-tmp-'`. Son las copias que quedaron de pasadas que murieron a mitad.

### Comprobar en psql

```sql
-- Últimas pasadas
SELECT id, pasada, inicio, fin, ok, listados, conteos FROM portal.equipos_sincronizacion ORDER BY id DESC LIMIT 10;
-- Archivos sin texto o con un fallo guardado
SELECT carpeta, id, titulo, error_status, texto_en FROM portal.equipos_drive_archivos
 WHERE NOT borrado AND carpeta <> 'salidas_n8n' AND (texto IS NULL OR error_status IS NOT NULL) ORDER BY carpeta, titulo;
```

### Si se vacía una carpeta a propósito

hub-api rechaza el listado como sospechoso (`409 listado_sospechoso`). Si de verdad se vació o se movió casi todo, hay que marcar a mano como borrado lo de esa carpeta. La siguiente pasada vuelve a dar de alta lo que siga allí, y conserva sus textos:

```sql
UPDATE portal.equipos_drive_archivos SET borrado = true, actualizado_en = now() WHERE carpeta = 'salidas_escaneadas' AND NOT borrado;
```

## Flujo de n8n «Equipos · Alerta de foto vieja»

Lo crea el usuario en n8n, **inactivo** hasta que se configure la alerta. hub-api lo llama así:

- **Petición:** `POST <EQUIPOS_ALERTA_WEBHOOK_URL>`, `Content-Type: application/json`, cabecera `X-Equipos-Alerta-Token: <EQUIPOS_ALERTA_TOKEN>`. hub-api no sigue redirecciones y espera 30 s como mucho.
- **Cuerpo:**

  ```json
  { "referencia": 12, "para": ["persona@ambientalia.com.co"], "asunto": "Equipos en taller: la información no se actualiza desde el …", "cuerpo": "La actualización diaria de «Equipos en taller» ha fallado 2 veces seguidas.\n\n…" }
  ```

  - `referencia` es el id del incidente.
  - `para` trae de 1 a N direcciones, todas `@ambientalia.com.co`.
  - `cuerpo` es texto plano, con párrafos separados por una línea en blanco.

- **Nodos:**
  1. **Webhook** (POST) con la credencial **Header Auth** (nombre `X-Equipos-Alerta-Token`, valor = el token). Respuesta: «Using 'Respond to Webhook' node».
  2. **Barrera de dominio** (IF / Code): si alguna dirección de `para` no termina en `@ambientalia.com.co`, o `asunto` está vacío → **Respond to Webhook** `422` con `{ "ok": false, "error": "destino fuera del dominio" }` y nada más.
  3. **Enviar correo** (Gmail o SMTP de la cuenta de servicio técnico) a `para`, con `asunto` y `cuerpo`.
  4. **Respond to Webhook** `200` con `{ "ok": true }`. Si el envío falla, `500` con `{ "ok": false, "error": "<motivo corto>" }` (sin datos de la cuenta).
- **Cómo lo entiende hub-api:**
  - Solo `2xx` con `{ "ok": true }` es «enviado» (se guarda `alerta_enviada_en`).
  - Cualquier otra cosa se guarda en `alerta_ultimo_error` como `n8n respondió <código>[: <error>]`, sin el token y cortado a 300 caracteres, y se reintenta en la siguiente corrida programada del mismo incidente.

## Datos de prueba y privacidad

El repo es público. Las fixtures del núcleo (`apps/hub-api/src/equipos/nucleo/fixtures/`) están **anonimizadas** con `apps/hub-api/scripts/equipos-anonimizar.mjs`: clientes, seriales, tickets y textos sustituidos de forma determinista, conservando las peculiaridades del OCR. Las reales, `roles.local.json` y el prompt original solo existen en local (`apps/hub-api/src/equipos/nucleo/fixtures-reales/` y `apps/equipos-desk2/`, ignorados por git).

```bash
cd apps/hub-api
node scripts/equipos-anonimizar.mjs generar src/equipos/nucleo/fixtures-reales src/equipos/nucleo/fixtures   # regenerar
node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs  # buscar fugas
```

`nucleo/reales.local.test.ts` comprueba en local que las anonimizadas están al día y que el núcleo da lo mismo con unas y otras; sin las reales se salta sola.

## Pendiente (§10 del diseño)

- **Enero de 2027:** en los tickets nacidos en Desk 2.0 la recogida es la transición «Entrega al cliente», no un comentario. Hay que revisar la regla 6 (con `desk.ticket_transitions`) antes de que esos tickets empiecen a cerrarse.
- **Remisiones de Desk 2.0:** `public.remisiones` podría sustituir a la lectura de las carpetas de entrada.
- **Caché `ent`:** no se invalida. Si n8n reenvía la remisión de una entrada ya leída (por ejemplo, porque cambió el nombre de la carpeta), la corrida sigue con la primera lectura.
````

- [ ] **Step 2: Sustituir `apps/equipos-taller/CLAUDE.md` entero**

````markdown
# Equipos en taller (sub-app)

Pantalla de la app `equipos-taller` del portal: qué equipos están físicamente en el taller. Documentación de operación (variables, causas de fallo, contratos de los flujos de n8n): `docs/equipos-taller.md`. Diseño: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`, con la revisión «Drive vía n8n» del 10/11/2026.

## Dónde está cada cosa

- **Reglas:** `apps/hub-api/src/equipos/nucleo/` (puro). Es la ÚNICA fuente de verdad: la pantalla lo importa por ruta relativa (`src/nucleo.ts`) y no copia ninguna regla. `nucleo/pureza.test.ts` impide que importe nada de fuera de su carpeta.
- **Contrato de la API:** `apps/hub-api/src/equipos/contrato.ts`: tipos, claves de ajuste, el aviso de foto vieja y la causa de copia atrasada.
- **Servidor:** `apps/hub-api/src/equipos/` (servicio, repo, router, programador, fuente de Desk 2.0). Rutas bajo `/api/equipos-taller`.
- **Drive:** hub-api NO lo lee. El flujo de n8n «Equipos · Sincronizar remisiones» manda la copia cada hora:
  - `sync.ts` valida;
  - `router-sync.ts` la recibe;
  - `repo-sync.ts` la guarda en `portal.equipos_drive_archivos`;
  - `fuente-n8n.ts` se la da al núcleo.

  Hasta la primera pasada completa, la pantalla dice «Falta la primera sincronización con n8n».
- **Pantalla:** `src/EquiposServicio.tsx` (trasladada sin rediseño de Desk 2.0), `src/PanelLlaves.tsx` (solo admin), `src/api.ts`.
- **Sin tarjeta en el Dashboard:** la app sale en la barra lateral (`apps/portal/src/lib/apps.ts`) y en Aplicaciones.

## Reglas de trabajo

- **No es un rediseño.** Vistas, filtros (Cliente, Estado en Desk, Sin ticket), columnas, motivos y ajustes manuales no cambian. Si algo de la clasificación está mal, se corrige en el núcleo, con su prueba.
- **Repo público.**
  - Ni clientes, ni seriales, ni tickets, ni IDs de Drive reales en el código, las pruebas o los comentarios. Los datos de prueba son inventados (`18A90417`, `CLIENTE A`…).
  - Los IDs de las carpetas y la URL de hub-api viven solo en el nodo «Configuración» del flujo de n8n.
  - Antes de commitear: `cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs`.
- La pantalla solo **oculta** botones según `permisos`: el servidor comprueba cada llave.
- `RETIRADOS_FIJOS` (núcleo) está vacío a propósito: los retirados se marcan con «Marcar retirado».

## Pruebas

```bash
npm test --workspace=apps/equipos-taller                 # api (node) y pantalla (jsdom)
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
cd apps/hub-api && npx vitest run src/equipos scripts     # núcleo y servidor (nunca desde la raíz)
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos   # contra Postgres (Docker): migraciones, repo y copia de Drive
npm run build --workspace=apps/portal                    # tsc -b del portal comprueba esta sub-app
```
````

- [ ] **Step 3: Privacidad**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src ../../docs
```

Esperado: `Sin valores reales en: …`.

- [ ] **Step 4: Commit**

```bash
git add docs/equipos-taller.md apps/equipos-taller/CLAUDE.md
git commit -m "docs(equipos-taller): Drive vía n8n, variables nuevas y contrato del flujo de sincronización"
```

---

### Task 10: Flujo de n8n «Equipos · Sincronizar remisiones» (por el MCP, inactivo)

No es código del repo, así que no hay commit. Se construye en n8n con `mcp__n8n-mcp__*`. Antes de la primera llamada se carga la skill `n8n-mcp-skills:using-n8n-mcp-skills`, y con ella `n8n-workflow-patterns`, `n8n-error-handling` y `n8n-code-javascript`. El contrato HTTP es el de `docs/equipos-taller.md` (Tarea 9); aquí, los nodos.

**Reglas:**
- Se crea **inactivo** (`active: false`) y **sin credenciales**. Los nodos de Drive quedan con «Predefined Credential Type → Google Drive OAuth2 API» y los de hub-api con «Generic Credential Type → Header Auth», ambos sin credencial elegida.
- **Nada privado en el flujo:** ni IDs de carpetas, ni la URL de hub-api, ni el token. Los campos de «Configuración» quedan vacíos para el usuario.
- **No se ejecuta** desde el agente: sin credenciales fallaría, y la primera ejecución es la carga completa.
- `settings.executionOrder = "v1"`.

**Convenciones de los nodos:**
- **G** = HTTP Request a `https://www.googleapis.com/drive/v3/...` con la credencial de Drive.
  - Para las llamadas por archivo: «Options → Response → Include Response Headers and Status» y «Never Error» activados, para decidir por `statusCode`. Además, «Settings → On Error: Continue» para los fallos de red.
- **H** = HTTP Request a `{{ $('Configuración').first().json.hub }}/api/equipos-taller/sync/...` con la credencial Header Auth: método POST, Body JSON = `{{ $json }}`, respuesta JSON y «Retry On Fail» 3 intentos cada 5000 ms.
- **Listado paginado** (los «Listar …»): query `q`, `pageSize=1000`, `fields=nextPageToken,files(id,name)`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true` y `corpora=allDrives`.
  - «Options → Pagination»: «Update a Parameter in Each Request», query `pageToken` = `{{ $response.body.nextPageToken }}`; «Pagination Complete When» = Other, `{{ !$response.body.nextPageToken }}`.
  - «Execute Once» activado. Sin «Never Error»: si falla, la ejecución se para y no hay «fin».
- **Bucle con centinela** (para que una lista vacía no corte el flujo): un Code «Pendientes …» emite un ítem `{ id }` por id o, si no hay ninguno, un solo `{ id: null }`. Después:
  - un «Loop Over Items» (batch 1), con un IF «¿… ?» (`{{ $json.id }}` no vacío) que devuelve el centinela al bucle;
  - la salida **done** del bucle sigue hacia la siguiente sección, cuyo primer nodo lleva «Execute Once».

**Nodos, en orden:**

| # | Nodo | Tipo | Configuración |
|---|---|---|---|
| 1 | Cada hora | Schedule Trigger | Cada hora, en el minuto 10. |
| 2 | Configuración | Set (Edit Fields) | `hub`, `carpetaEntradas`, `carpetaSalidasN8n`, `carpetaEscaneadas` y `carpetaTemporal` (cadenas vacías: las rellena el usuario); `pasada` = `{{ $execution.id }}`. |
| 3 | Listar copias OCR | G, listado paginado | `q` = `'{{ $('Configuración').first().json.carpetaTemporal }}' in parents and trashed = false and name contains 'ocr-tmp-'`. |
| 4 | Copias viejas | Code (todos los ítems) | Junta `files` de todas las páginas, se queda con los que empiezan por `ocr-tmp-` y emite `{ id }` (o el centinela). |
| 5 | Bucle copias | Loop Over Items | loop → 6; done → 8. |
| 6 | ¿Copia? | IF | Verdadero → 7; falso → 5. |
| 7 | Borrar copia vieja | G | `DELETE /files/{{ $json.id }}?supportsAllDrives=true`; On Error: Continue → 5. |
| 8 | Listar entradas | G, listado paginado | `q` = `'{{ …carpetaEntradas }}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`. |
| 9 | Listado entradas | Code (todos) | Ver código A, con `carpeta: 'entradas'`. |
| 10 | Enviar listado entradas | H | `/listado`. On Error: Stop Workflow (un 409 o un 400 paran la pasada sin «fin»). |
| 11 | Pendientes entradas | Code (todos) | Ver código B. |
| 12 | Bucle entradas | Loop Over Items | loop → 13; done → 21. |
| 13 | ¿Entrada? | IF | Verdadero → 14; falso → 12. |
| 14 | Documentos de la carpeta | G, por archivo | `GET /files` con `q` = `'{{ $json.id }}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'`, `pageSize=5`, `fields=files(id,name)`, `supportsAllDrives`, `includeItemsFromAllDrives` y `corpora=allDrives`. |
| 15 | ¿Hay documento? | IF | `{{ $json.statusCode === 200 && ($json.body.files ?? []).length > 0 }}`. Verdadero → 16; falso → 17. |
| 16 | Exportar remisión | G, por archivo | `GET /files/{{ $json.body.files[0].id }}/export?mimeType=text/markdown`; Response Format: Text. → 17. |
| 17 | Resultado entrada | Code (cada ítem) | Ver código C. |
| 18 | ¿Mandar entrada? | IF | `{{ !$json.saltar }}`. Verdadero → 19; falso → 12. |
| 19 | Pausa entrada | Wait | 1 s. |
| 20 | Enviar texto entrada | H | `/texto`. On Error: Continue → 12. |
| 21 | Listar salidas n8n | G, listado paginado | `q` = `'{{ …carpetaSalidasN8n }}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`. |
| 22 | Listado salidas n8n | Code (todos) | Código A, con `carpeta: 'salidas_n8n'`. |
| 23 | Enviar listado salidas n8n | H | `/listado`. On Error: Stop Workflow. (Su `faltaTexto` siempre viene vacío.) |
| 24 | Listar salidas escaneadas | G, listado paginado | `q` = `'{{ …carpetaEscaneadas }}' in parents and trashed = false and (mimeType = 'application/pdf' or mimeType contains 'image/')`. |
| 25 | Listado salidas escaneadas | Code (todos) | Código A, con `carpeta: 'salidas_escaneadas'`. |
| 26 | Enviar listado salidas escaneadas | H | `/listado`. On Error: Stop Workflow. |
| 27 | Pendientes escaneadas | Code (todos) | Código B. |
| 28 | Bucle escaneadas | Loop Over Items | loop → 29; done → 37. |
| 29 | ¿Escaneada? | IF | Verdadero → 30; falso → 28. |
| 30 | Copiar con OCR | G, por archivo | `POST /files/{{ $json.id }}/copy?supportsAllDrives=true&ocrLanguage=es&fields=id`, Body JSON `{ "mimeType": "application/vnd.google-apps.document", "name": "ocr-tmp-{{ $json.id }}", "parents": ["{{ …carpetaTemporal }}"] }`. **Sin** Retry On Fail: no es idempotente. |
| 31 | ¿Copia hecha? | IF | `{{ $json.statusCode === 200 && !!$json.body.id }}`. Verdadero → 32; falso → 34. |
| 32 | Exportar OCR | G, por archivo | `GET /files/{{ $json.body.id }}/export?mimeType=text/plain`; Response Format: Text. → 33. |
| 33 | Borrar copia OCR | G, por archivo | `DELETE /files/{{ $('Copiar con OCR').item.json.body.id }}?supportsAllDrives=true`. Corre **siempre** tras 32, haya salido bien o mal. → 34. |
| 34 | Resultado escaneada | Code (cada ítem) | Ver código D. |
| 35 | ¿Mandar escaneada? | IF | `{{ !$json.saltar }}`. Verdadero → 36 (con una «Pausa escaneada» Wait de 1 s antes); falso → 28. |
| 36 | Enviar texto escaneada | H | `/texto`. On Error: Continue → 28. |
| 37 | Conteos | Code (todos), Execute Once | Ver código E. |
| 38 | Enviar fin | H | `/fin`. On Error: Stop Workflow. |

**Código orientativo de los Code.** Si n8n no resuelve el ítem emparejado a través del bucle, se ajustan las referencias `$('…').item`.

A — «Listado …» (Run Once for All Items):

```js
const archivos = $input.all().flatMap((i) => i.json.files ?? []).map((f) => ({ id: f.id, titulo: f.name }));
return [{ json: { pasada: $('Configuración').first().json.pasada, carpeta: 'entradas', archivos } }];
```

B — «Pendientes …» (Run Once for All Items):

```js
const ids = $input.first().json.faltaTexto ?? [];
// Centinela: con la lista vacía, el bucle corre igual y su salida «done» sigue hacia la siguiente carpeta.
return ids.length ? ids.map((id) => ({ json: { id } })) : [{ json: { id: null } }];
```

C — «Resultado entrada» (Run Once for Each Item):

```js
const MAX = 200000;
// Fallo de ESE archivo: un 4xx salvo 401, 429 y los 403 de cuota. Lo demás es pasajero: no se manda.
const deArchivo = (s, cuerpo) => s >= 400 && s <= 499 && s !== 401 && s !== 429 &&
  !(s === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(JSON.stringify(cuerpo ?? '')));
const id = $('Bucle entradas').item.json.id;
const lista = $('Documentos de la carpeta').item.json;
if (!lista || lista.statusCode !== 200) {
  return deArchivo(lista?.statusCode, lista?.body) ? { json: { id, error: { status: lista.statusCode } } } : { json: { saltar: true } };
}
if (!(lista.body.files ?? []).length) return { json: { id, texto: '' } }; // carpeta sin documento
const exp = $('Exportar remisión').item.json;
if (exp.statusCode === 200) return { json: { id, texto: String(exp.body ?? '').replace(/\u0000/g, '').slice(0, MAX) } };
return deArchivo(exp.statusCode, exp.body) ? { json: { id, error: { status: exp.statusCode } } } : { json: { saltar: true } };
```

D — «Resultado escaneada» (Run Once for Each Item): la misma `deArchivo` y `MAX`, y:

```js
const id = $('Bucle escaneadas').item.json.id;
const copia = $('Copiar con OCR').item.json;
if (copia.statusCode !== 200 || !copia.body?.id) {
  return deArchivo(copia.statusCode, copia.body) ? { json: { id, error: { status: copia.statusCode } } } : { json: { saltar: true } };
}
const exp = $('Exportar OCR').item.json;
if (exp.statusCode === 200) return { json: { id, texto: String(exp.body ?? '').replace(/\u0000/g, '').slice(0, MAX) } };
return deArchivo(exp.statusCode, exp.body) ? { json: { id, error: { status: exp.statusCode } } } : { json: { saltar: true } };
```

E — «Conteos» (Run Once for All Items):

```js
const n = (nodo) => $(nodo).first().json.archivos.length;
return [{ json: {
  pasada: $('Configuración').first().json.pasada,
  conteos: { entradas: n('Listado entradas'), salidas_n8n: n('Listado salidas n8n'), salidas_escaneadas: n('Listado salidas escaneadas') },
} }];
```

- [ ] **Step 1:** cargar las skills de n8n y comprobar la instancia (`mcp__n8n-mcp__n8n_health_check`).
- [ ] **Step 2:** comprobar la configuración de los nodos con `mcp__n8n-mcp__get_node` y `validate_node`. Hay que mirar, como mínimo:
  - en `n8n-nodes-base.httpRequest`: la paginación, «Never Error» + «Full Response», la autenticación predefinida de Google Drive y Header Auth;
  - en `n8n-nodes-base.splitInBatches`: la salida `done`;
  - en `n8n-nodes-base.code`: los modos de ejecución.
- [ ] **Step 3:** construir el flujo, validarlo con `mcp__n8n-mcp__validate_workflow` y corregir lo que no sea un falso positivo (la skill `n8n-validation-expert` dice cuáles lo son). Los avisos por credenciales que faltan son esperados.
- [ ] **Step 4:** crearlo con `mcp__n8n-mcp__n8n_create_workflow`, con `active: false` y el nombre exacto «Equipos · Sincronizar remisiones». Comprobar con `n8n_get_workflow` que está inactivo y que ningún nodo lleva credencial, IDs ni URL.
- [ ] **Step 5:** comunicar al usuario el id del flujo (no se escribe en el repo) y los pasos ⚠️ USUARIO de abajo.

**⚠️ USUARIO, después:**
1. **Credencial de Drive:** ponerla en los nodos G (3, 7, 8, 14, 16, 21, 24, 30, 32 y 33).
2. **Header Auth:** crear la credencial «Equipos · token de sincronización» (nombre `X-Equipos-Sync-Token`; valor, el mismo que `EQUIPOS_SYNC_TOKEN` en hub-api) y ponerla en los nodos H (10, 20, 23, 26, 36 y 38).
3. **Configuración:** rellenar la URL de hub-api y los cuatro IDs. La carpeta temporal tiene que estar en un sitio donde la cuenta de la credencial pueda crear y borrar archivos.
4. **Primera ejecución:** ejecutar el flujo a mano una vez. Es la carga completa, con unos 190 PDF de OCR y tantas remisiones de entrada como carpetas, y puede durar más de una hora: si la instancia tiene `EXECUTIONS_TIMEOUT`, tiene que cubrirla. Después, comprobar en psql que la pasada terminó con `ok = true`:

   ```sql
   SELECT pasada, inicio, fin, ok, listados, conteos FROM portal.equipos_sincronizacion ORDER BY id DESC LIMIT 3;
   ```

5. **Activar** el flujo.

---

### Task 11: Verificación final

- [ ] **Step 1: hub-api, unitarios** (desde `apps/hub-api`, nunca desde la raíz)

```bash
cd apps/hub-api && npx vitest run
```

Esperado: todos los ficheros en verde, incluidos `src/equipos/**` y `src/env-example.test.ts` (con el bloque del usuario de la Tarea 8). `reales.local.test.ts` sale `skipped` donde no están las fixtures reales.

- [ ] **Step 2: hub-api contra Postgres** (Docker Desktop encendido)

```bash
cd apps/hub-api && npm run test:db
```

Esperado: todos en verde, incluidos `src/equipos/migracion.db.test.ts`, `src/equipos/repo.db.test.ts`, `src/equipos/repo-sync.db.test.ts` y `src/equipos/fuente-desk2.db.test.ts`.

- [ ] **Step 3: Tipos de hub-api** (lo que compila el Dockerfile)

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: ningún error, salvo en local el ya existente de `barril.test.ts` con `micromatch`.

- [ ] **Step 4: Sub-app y portal**

```bash
npm test --workspace=apps/equipos-taller
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
npm run build --workspace=apps/portal
```

Esperado: todo en verde. El build del portal (`tsc -b && vite build`) termina con `✓ built in …`.

- [ ] **Step 5: No queda nada de la cuenta de servicio, y privacidad**

```bash
grep -rn "fuente-drive\|ErrorDrive\|limpiarTemporal\|copiasSinBorrar\|EQUIPOS_GOOGLE_CUENTA_SERVICIO\|EQUIPOS_DRIVE_\|Falta configurar Google Drive" apps/hub-api/src apps/equipos-taller/src apps/equipos-taller/CLAUDE.md docs/equipos-taller.md
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller ../../docs/equipos-taller.md ../../docs/superpowers/plans/2026-11-10-equipos-taller-sync-n8n.md ../../docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md
cd ../.. && git log --format=%B main..HEAD | grep -ci "co-authored" || true
git status --short
```

Esperado:
- el `grep` de nombres viejos no imprime nada;
- `verificar` dice `Sin valores reales en: …`;
- el `grep` de atribución cuenta `0`;
- `git status` no muestra nada de `apps/equipos-desk2/` ni de `fixtures-reales/`, y `.gitignore` sigue sin indexar.

---

## Pasos manuales (usuario)

No son tareas del agente. Siguen el §9 del diseño.

1. **`.env.example`:** pegar el bloque `EQUIPOS_*` (Tarea 8, paso 5).
2. **Desplegar hub-api** (migración 072 y rutas de n8n) y cargar `EQUIPOS_SYNC_TOKEN` en EasyPanel. Es un secreto: mismo cuidado con el log de build que el resto, y entra en la rotación pendiente. Si se cargaron, quitar las variables de Drive de la versión anterior. Justo después, desplegar el portal (el texto nuevo de «sin configurar»).
3. **Terminar el flujo de n8n** (Tarea 10, ⚠️ USUARIO): credenciales, «Configuración», la primera ejecución a mano y, con la pasada en `ok = true`, activarlo.
4. **Lanzar la primera corrida con el botón** y comparar con la página de Claude, como dice el §9 del diseño.
   - Si sale «La copia de Google Drive (n8n) está atrasada», mirar `portal.equipos_sincronizacion`.
   - Si salen PDF «n8n todavía no ha enviado el texto…», mirar las ejecuciones del flujo.
5. **Borrar la cuenta de servicio de Google y su clave**, que ya no se usan.
