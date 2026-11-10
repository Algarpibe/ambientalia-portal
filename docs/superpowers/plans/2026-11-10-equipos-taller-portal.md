# Equipos en taller — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar en el portal el módulo «Equipos en taller» (qué equipos están físicamente en el taller de servicio técnico, por fecha de llegada) como app propia `equipos-taller`: el motor en hub-api leyendo Google Drive (cuenta de servicio) y Desk 2.0 (`desk.tickets` + `desk.conversations`), la foto en `portal.equipos_*`, una corrida diaria a las 06:30 de Colombia con alerta por n8n una vez por incidente, y la pantalla trasladada sin rediseño a la sub-app `apps/equipos-taller`.

**Architecture:** El núcleo puro (`tipos`, `reglas`, `actualizar`, `pantalla`) se traslada tal cual a `apps/hub-api/src/equipos/nucleo/` y es la única fuente de verdad de las reglas; lo importan el servidor y la pantalla (por ruta relativa, patrón Calibraciones). Alrededor, en `apps/hub-api/src/equipos/`: dos fuentes (`fuente-drive.ts`, `fuente-desk2.ts`) sin respaldo, un `servicio.ts` que hace la corrida (candado → Desk 2.0 → Drive → núcleo → foto en una transacción) y la da por fallida ante cualquier fallo de una fuente, `incidente.ts` (decisión pura) + `alerta.ts` (webhook n8n), `repo.ts` (SQL), `programador.ts` y `router.ts`. Un `contrato.ts` puro tipa la API para el servidor y la pantalla.

**Tech Stack:** Express 4 + TypeScript ESM (imports relativos con `.js`), `pg` vía `@algarpibe/zoho-sync`, Vitest 2 (unitarios en `vitest.config.ts`; Postgres real con Testcontainers en `vitest.db.config.ts`), React 19 + Vite 7 + Tailwind 3.4 (del portal), Testing Library + jsdom en la sub-app.

**Spec (contrato, no se reabre):** `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`
**Rama:** `feat/equipos-taller` (ya existe; el diseño está en `71a8acd`).

---

## Convenciones que importan aquí

- Commits en conventional commits, en español, **sin** líneas `Co-Authored-By` ni ninguna atribución.
- Los tests de hub-api se corren **desde `apps/hub-api`**, nunca desde la raíz (desde la raíz Vitest recoge los `*.db.test.ts` y salen ~281 fallos falsos):
  - unitarios: `cd apps/hub-api && npx vitest run <ruta>`;
  - contra Postgres: `cd apps/hub-api && npx vitest run --config vitest.db.config.ts <ruta>` (necesita Docker Desktop encendido: Testcontainers levanta `postgres:17` y aplica TODAS las migraciones de `MIGRATIONS`).
- `initDb()` re-ejecuta todas las migraciones en cada arranque: la 071 es DDL idempotente y **no siembra nada**.
- ⚠️ **PRIVACIDAD — el repo es PÚBLICO.** Nunca se escribe en un fichero que vaya al repo un nombre de cliente, un serial, un número de ticket, un ID de carpeta de Drive, una URL de artefacto ni un correo personal sacados de `Prompt.txt`, de las fixtures reales o de las pruebas originales. Solo puede aparecer `comercial@ambientalia.com.co` (la reserva configurable). Los datos inventados de este plan (`18A90417`, `CLIENTE A`, `Técnico Uno`, `1401`…) son ficticios. Antes de cada commit que toque `apps/hub-api/src/equipos/` o `apps/equipos-taller/`, el paso de verificación de la Tarea 3 (`verificar`) tiene que salir limpio.
- `.env*` está bloqueado para el agente: las variables nuevas las pega **el usuario** en `apps/hub-api/.env.example` (Tarea 6, paso marcado ⚠️ USUARIO).
- El repo tiene `core.autocrlf=true` y ficheros con CRLF: para cambios en ficheros existentes usar la herramienta Edit (no `sed` ni `Set-Content`, que destrozan las tildes en PowerShell 5.1).
- Las causas de una corrida fallida y los errores guardados nunca llevan la URL de la base, el token, la clave privada ni el error crudo de `pg` o de Google.

## Supuestos de este plan (lo que el diseño no fija o lo que el código existente contradice)

| # | Supuesto | Por qué |
|---|---|---|
| A1 | `portal.equipos_ajuste` NO lleva la columna `hasta` del SQL original. `Ajuste.at` sale de `creado_en` (fecha de Colombia). | El diseño (§4) no la lista. Solo la usaban los ajustes `*SERIAL` heredados de la página de Claude, que no se migran (§10); la pantalla nunca la escribe. |
| A2 | `portal.equipos_ejecucion` lleva además `avisos jsonb`. | La pantalla «no cambia» y muestra «N avisos en la última ejecución»; sin la columna se perdería. |
| A3 | `RETIRADOS_FIJOS` (pantalla.ts) queda vacío en el repo y su comentario de `cls` / el de serial sin dígitos (reglas.ts) cambian de ejemplo. | Llevan un serial real. El caso fijo «equivale a Marcar retirado» (lo dice su comentario): se rehace con ese botón tras el despliegue (Pasos manuales). |
| A4 | Los `cf_*` salen de `desk.tickets.raw->'cf'` y, si falta, se completan con las columnas `serial`, `tipo_servicio` y `fecha_remision_entrada`. La sonda cuenta los tickets sin `raw.cf` y la corrida lo deja como aviso. | `calibraciones-desk2.ts` documenta que `raw->'cf'` solo lo traen los tickets que Desk 2.0 releyó al detalle; el diseño supone que siempre está. La columna `codigo_servicio` no se lee (no consta en Desk 2.0; `trazabilidad/fuente-desk2.ts` la manda siempre a NULL). |
| A5 | Comentarios: `desk.conversations` con `kind = 'comment'`, los 15 más recientes; adjuntos en `raw->'attachments'[].name`. | Lo mismo que pedía la página de Claude a la API de Zoho (`limit 15`). Los valores de `kind` y la forma de `raw` no constan en el repo: lo cubre la prueba contra Postgres y se valida el día de la primera corrida (Pasos manuales). |
| A6 | Búsqueda por serial: `ILIKE` sobre `serial`, `subject`, `raw->'cf'` y `raw->>'subject'`, los 10 más recientes. | Equivale a la búsqueda `_all` de Zoho que usaba el módulo. |
| A7 | El programador NO lanza corrida de recuperación al arrancar. | Una corrida «programada» tras cada despliegue contaría para el incidente. Para eso está el botón. |
| A8 | No hay «tarjeta en el Dashboard»: el Dashboard del portal es de widgets y su propio código dice que no repite el directorio de apps. La app aparece en el Sidebar (por `APPS`) y en Aplicaciones. | `apps/portal/src/pages/Dashboard.tsx:10-12`. |
| A9 | Un PDF que Drive no puede convertir a texto (4xx de ese archivo, que no sea 401 ni 429) **no** hace fallar la corrida: va a remisiones ilegibles («sin texto legible») y no entra en la caché, así que se reintenta en cada corrida. Si fallan **todos** los PDF intentados (2 o más) y ninguno sale, es un problema de Drive y la corrida falla. El listado, el token, la cuota, los 5xx y la red siguen haciendo fallar la corrida. | Decisión de Alfonso (10/11/2026), que corrige D5 para que un PDF corrupto no bloquee la foto. Ver diseño §5.1. |
| A10 | El registro de ids de app es `apps/portal/src/lib/apps.ts` (`APPS`): de ahí salen el modal de asignación, el AppGuard y el Sidebar. hub-api no tiene lista blanca de apps. | `users.repository.ts:setApps` guarda cualquier id. |
| A11 | El admin se comprueba con `getPayload(req)?.role === 'admin'` (lo rellena `requireAuth` desde la base). | `auth.ts:232`. |

---

## Mapa de ficheros

| Fichero | Acción | Responsabilidad |
|---|---|---|
| `.gitignore` | Modificar (añadir al final) | Ignorar `apps/equipos-desk2/` y `apps/hub-api/src/equipos/nucleo/fixtures-reales/`. |
| `apps/hub-api/scripts/equipos-anonimizar.mjs` | Crear | Genera las fixtures anonimizadas desde las reales y busca fugas de valores reales. Sin datos. |
| `apps/hub-api/scripts/equipos-anonimizar.test.mjs` | Crear | Pruebas del anonimizador con datos inventados. |
| `apps/hub-api/src/equipos/nucleo/{tipos,reglas,actualizar,pantalla}.ts` | Crear (traslado) | Dominio puro. Se copian de `apps/equipos-desk2/packages/equipos/src/`. |
| `apps/hub-api/src/equipos/nucleo/index.ts` | Crear | Entrada del núcleo (sin las fuentes de Claude). |
| `apps/hub-api/src/equipos/nucleo/fixtures/{remisiones,escaneos,roles}.json` | Crear (generados) | Fixtures anonimizadas. |
| `apps/hub-api/src/equipos/nucleo/{reglas,actualizar}.test.ts` | Crear (portados) | Pruebas del núcleo sobre las fixtures anonimizadas. |
| `apps/hub-api/src/equipos/nucleo/pureza.test.ts` | Crear | El núcleo no importa nada de fuera de su carpeta. |
| `apps/hub-api/src/equipos/nucleo/reales.local.test.ts` | Crear | Suite solo local con las reales; se salta sola sin ellas. |
| `apps/hub-api/src/equipos/contrato.ts` (+ test) | Crear | Tipos de la API, validación de claves de ajuste y el aviso de foto vieja. Puro. |
| `apps/hub-api/src/equipos/config.ts` (+ test) | Crear | Variables de entorno; «sin configurar» si falta Drive. |
| `apps/hub-api/src/equipos/fuente-drive.ts` (+ test) | Crear | Token de la cuenta de servicio, listado, OCR. Errores sin cuerpo. |
| `apps/hub-api/src/equipos/fuente-desk2.ts` (+ test, + `.db.test.ts`) | Crear | `desk.tickets` y `desk.conversations` → forma de Zoho. Sin respaldo. |
| `apps/hub-api/src/equipos/incidente.ts` (+ test) | Crear | Decisión pura de abrir/contar/avisar/cerrar. |
| `apps/hub-api/src/equipos/alerta.ts` (+ test) | Crear | Correo de alerta por el webhook de n8n. |
| `apps/hub-api/src/users/migrations/071_equipos_taller.sql` | Crear | Tablas, índices, vistas y permisos de `portal_app`. |
| `apps/hub-api/src/equipos/migracion.test.ts` | Crear | La 071 está apuntada, es la última y no siembra. |
| `apps/hub-api/src/db.ts` | Modificar (línea 102, `MIGRATIONS`) | Registrar la 071. |
| `apps/hub-api/src/wo-sales/documento-numero.test.ts` | Modificar (líneas 48-50) | Deja de exigir que la 070 sea la última. |
| `apps/hub-api/src/equipos/repo.ts` (+ `repo.db.test.ts`) | Crear | SQL de `portal.equipos_*`. |
| `apps/hub-api/src/test-db/harness.ts` | Modificar (`asegurarDesk2`, líneas 140-142) | Añadir `desk.conversations` y su `GRANT` a la imitación de Desk 2.0. |
| `apps/hub-api/src/equipos/servicio.ts` (+ test) | Crear | Una corrida, el candado, el incidente y la alerta. |
| `apps/hub-api/src/equipos/programador.ts` (+ test) | Crear | Corrida diaria a la hora de Colombia. |
| `apps/hub-api/src/equipos/router.ts` (+ test) | Crear | Rutas de `/api/equipos-taller`. |
| `apps/hub-api/src/equipos/index.ts` (+ test) | Crear | Montaje del módulo. |
| `apps/hub-api/src/index.ts` | Modificar (imports l.18-19; tras l.152) | Montar el router y encender el programador. |
| `apps/equipos-taller/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}` | Crear | Sub-app Vite. |
| `apps/equipos-taller/src/{main.tsx,App.tsx,nucleo.ts}` | Crear | Entrada y re-export del núcleo y el contrato. |
| `apps/equipos-taller/src/api.ts` (+ test) | Crear | Cliente HTTP con `VITE_HUB_API_URL` + `ambientalia_token`. |
| `apps/equipos-taller/src/EquiposServicio.tsx` (+ test) | Crear (traslado adaptado) | La pantalla, con aviso de foto vieja y botones según la llave. |
| `apps/equipos-taller/src/PanelLlaves.tsx` | Crear | Panel de llaves (solo admin). |
| `apps/equipos-taller/CLAUDE.md` | Crear | Notas de la app. |
| `package-lock.json` | Modificar (`npm install`) | Registrar el workspace nuevo. |
| `apps/portal/src/App.tsx`, `src/lib/apps.ts`, `src/pages/Aplicaciones.tsx`, `tailwind.config.js` | Modificar | Ruta perezosa, catálogo, tarjeta y clases de Tailwind. |
| `Dockerfile` | Modificar (tras l.23) | `COPY` del `package.json` de la sub-app. |
| `docs/equipos-taller.md` | Crear | Variables, contrato del webhook de n8n, operación. |
| `apps/equipos-desk2/claude/{entrada.ts,fuentes-claude.ts}` | Modificar / mover (local, ignorado) | La página de Claude se construye desde el núcleo de hub-api. |
| `apps/equipos-desk2/{apps,packages}` | Borrar (local, ignorado) | Limpieza al final. |

---

## Fase A — Privacidad y núcleo

### Task 1: Ignorar lo privado y dejar las fixtures reales en local

**Files:**
- Modify: `.gitignore` (añadir al final; el usuario tiene una línea sin commitear, `.gstack/`, que NO se incluye)
- Create (local, ignorado): `apps/hub-api/src/equipos/nucleo/fixtures-reales/{remisiones,escaneos-reales,tickets}.json`, `roles.local.json`, `extraer-roles.mjs`

- [ ] **Step 1: Ver el estado de `.gitignore` antes de tocarlo**

```bash
git diff .gitignore
```

Esperado: un solo cambio del usuario, `+.gstack/` al final. Si hay más cambios suyos, no se tocan: el paso 3 solo indexa el bloque nuevo sobre `HEAD`.

- [ ] **Step 2: Añadir el bloque al final de `.gitignore` (herramienta Edit)**

Detrás de la última línea (`.gstack/`), añadir:

```gitignore

# Equipos en taller (D9 del diseño): el prompt original, la página de Claude (lleva los
# IDs de las carpetas de Drive) y las fixtures reales llevan datos de clientes. Solo en local.
apps/equipos-desk2/
apps/hub-api/src/equipos/nucleo/fixtures-reales/
```

- [ ] **Step 3: Indexar SOLO el bloque nuevo (sin la línea del usuario)**

`git add -p` es interactivo y aquí no se puede usar. Se construye el contenido indexado a mano: el `.gitignore` de `HEAD` más el bloque.

```bash
BLOQUE='
# Equipos en taller (D9 del diseño): el prompt original, la página de Claude (lleva los
# IDs de las carpetas de Drive) y las fixtures reales llevan datos de clientes. Solo en local.
apps/equipos-desk2/
apps/hub-api/src/equipos/nucleo/fixtures-reales/'
SHA=$( { git show HEAD:.gitignore; printf '%s\n' "$BLOQUE"; } | git hash-object -w --stdin )
git update-index --cacheinfo 100644,"$SHA",.gitignore
git diff --cached .gitignore
git diff .gitignore
```

Esperado: `git diff --cached` enseña solo las 5 líneas nuevas (y la en blanco); `git diff` (lo no indexado) enseña solo `+.gstack/` del usuario. `git status --short` ya no lista `apps/equipos-desk2/`.

- [ ] **Step 4: Copiar las fixtures reales a su sitio local**

```bash
mkdir -p apps/hub-api/src/equipos/nucleo/fixtures-reales
cp apps/equipos-desk2/packages/equipos/test/fixtures/{remisiones,escaneos-reales,tickets}.json apps/hub-api/src/equipos/nucleo/fixtures-reales/
git status --short apps/hub-api/src/equipos
```

Esperado: `git status` no enseña nada (la carpeta está ignorada).

- [ ] **Step 5: Escribir `roles.local.json` con un extractor sin datos**

Los roles dicen qué serial, ticket y cliente hace de cada caso en las pruebas. Sus valores reales están en las pruebas originales (ignoradas): este extractor los saca de allí por la forma de cada `it`, sin escribir ningún valor en el repo. Crear `apps/hub-api/src/equipos/nucleo/fixtures-reales/extraer-roles.mjs` (queda ignorado):

```js
// Uso local, una sola vez: saca de las pruebas ORIGINALES (apps/equipos-desk2, ignorado por
// git) qué serial, ticket y cliente hace de cada caso, y lo escribe en roles.local.json
// (también ignorado). Este fichero no lleva ningún dato: solo sabe dónde mirar.
//   node extraer-roles.mjs <dir-pruebas-originales> <dir-fixtures-reales>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [pruebas, reales] = process.argv.slice(2);
const r = readFileSync(join(pruebas, 'reglas.test.ts'), 'utf8');
const a = readFileSync(join(pruebas, 'actualizar.test.ts'), 'utf8');
const uno = (re, txt = r) => {
  const m = txt.match(re);
  if (!m) throw new Error('No se encuentra ' + re);
  return m;
};
const [, sinDigitos] = uno(/it\("(\w+) se reconoce aunque el OCR diga \w+, y no es parcial"/);
const [, tEnRemision, sEnRemision] = uno(/it\("la remisión trae el ticket (\d+) de (\w+)"/);
const [, t7] = uno(/it\("(\w+) se reconoce aunque el OCR diga \w+", \(\) => expect\(P\.\w+\.t\)/);
const [, b8] = uno(/no vuelve parcial a (\w+)"/);
const [, parcial, tParcial] = uno(/it\("(\w+) es una salida parcial \(cable\) con ticket (\d+)"/);
const [, accesorios] = uno(/it\("(\w+) no es parcial \(accesorios/);
const ent = [...a.matchAll(/\["\d{6} - (\w+) - (\w+)", "e(\d)"\]/g)].map((m) => ({ c: m[1], sn: m[2], e: m[3] }));
const e = (n) => ent.find((x) => x.e === String(n)) ?? (() => { throw new Error('Falta la entrada e' + n); })();
const remisiones = Object.keys(JSON.parse(readFileSync(join(reales, 'remisiones.json'), 'utf8')));
if (remisiones.length !== 4) throw new Error('remisiones.json debía tener 4 claves');
const roles = {
  remisiones: Object.fromEntries(remisiones.map((k, i) => [k, 'rem' + 'ABCD'[i]])),
  seriales: {
    S_SIN_DIGITOS: sinDigitos, S_TICKET_EN_REMISION: sEnRemision, S_T7: t7, S_B8: b8, S_PARCIAL: parcial, S_ACCESORIOS: accesorios,
    S_DEFORMADO: e(1).sn, S_FECHA_ERRADA: e(2).sn, S_SIN_TEXTO_1: e(3).sn, S_SIN_TEXTO_2: e(4).sn,
  },
  tickets: { T_EN_REMISION: tEnRemision, T_PARCIAL: tParcial },
  clientes: { C_ILEGIBLE: e(1).c, C_SIN_TEXTO: e(3).c },
};
writeFileSync(join(reales, 'roles.local.json'), JSON.stringify(roles, null, 2) + '\n');
console.log('roles.local.json escrito con ' + Object.keys(roles.seriales).length + ' seriales');
```

```bash
node apps/hub-api/src/equipos/nucleo/fixtures-reales/extraer-roles.mjs apps/equipos-desk2/packages/equipos/test apps/hub-api/src/equipos/nucleo/fixtures-reales
```

Esperado: `roles.local.json escrito con 10 seriales`. Es un JSON con `remisiones` (las 4 claves de `remisiones.json` → `remA`…`remD`, en su orden), `seriales` (`S_SIN_DIGITOS`, `S_TICKET_EN_REMISION`, `S_T7`, `S_B8`, `S_PARCIAL`, `S_ACCESORIOS`, `S_DEFORMADO`, `S_FECHA_ERRADA`, `S_SIN_TEXTO_1`, `S_SIN_TEXTO_2`), `tickets` (`T_EN_REMISION`, `T_PARCIAL`) y `clientes` (`C_ILEGIBLE`, `C_SIN_TEXTO`). **No** se copia su contenido a ningún otro sitio.

- [ ] **Step 6: Commit (solo `.gitignore`, ya indexado en el paso 3)**

```bash
git commit -m "chore(equipos-taller): ignorar el módulo original y las fixtures reales (repo público)"
```

---

### Task 2: Anonimizador de fixtures (TDD)

**Files:**
- Create: `apps/hub-api/scripts/equipos-anonimizar.mjs`
- Test: `apps/hub-api/scripts/equipos-anonimizar.test.mjs`

El script va fuera de `src/` a propósito: no lo compila el `tsc` del Dockerfile ni lo mira el detector de `.env.example`. Vitest sí lo recoge (`*.test.mjs` entra en su patrón por defecto).

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/scripts/equipos-anonimizar.test.mjs` (todos los datos son inventados):

```js
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anonimizar, buscarFugas, cls, crearAnonimizador, nrm } from './equipos-anonimizar.mjs';

// El anonimizador con datos INVENTADOS (aquí no hay ningún dato real): conserva las
// peculiaridades del OCR que prueban las reglas y no deja pasar los valores de entrada.
const aDigitos = (c) => c.replace(/S/g, '5').replace(/T/g, '7').replace(/B/g, '8');

describe('seriales', () => {
  it('O/0, I/1, S/5, T/7 y B/8 siguen siendo la misma clase, en la misma posición', () => {
    const a = crearAnonimizador();
    const canon = a.serial('KEWR0XF5');
    const ocr = a.serial('KEWROXFS');
    expect(cls(ocr)).toBe(cls(canon));
    expect(canon).not.toBe('KEWR0XF5');
    expect(/\d/.test(ocr)).toBe(false); // el serial sin dígitos sigue sin dígitos
    expect(/\d/.test(nrm(ocr))).toBe(true); // …y el OCR lo sigue leyendo con dígitos (O→0)
  });

  it('los ceros a la izquierda se conservan y no cuentan', () => {
    const a = crearAnonimizador();
    const largo = a.serial('0355590041');
    expect(largo.startsWith('0')).toBe(true);
    expect(cls(largo)).toBe(cls(a.serial('355590041')));
  });

  it('el prefijo GRIMM se conserva y el resto cambia', () => {
    const s = crearAnonimizador().serial('18A90417');
    expect(s).toMatch(/^18A\d{5}$/);
    expect(s).not.toBe('18A90417');
  });

  it('el serial deformado «NN#NNNNN» usa los dígitos del serial sintético que le toca', () => {
    const a = crearAnonimizador();
    const s = a.serial('18A90417');
    expect(a.texto('EDM180C · Grimm · 18#90417 · Equipo calibrado')).toBe('EDM180C · Grimm · 18#' + aDigitos(cls(s)).slice(-5) + ' · Equipo calibrado');
  });
});

describe('texto', () => {
  it('conserva el formato, las fechas y los números pequeños; cambia lo demás', () => {
    const a = crearAnonimizador();
    const t = a.texto('REMISIÓN DE SERVICIO TÉCNICO\nFecha: 2026-04-01\n1\nSeñores: Laboratorio Inventado Quimera\nTeléfono: 6015551234');
    expect(t).toMatch(/^REMISIÓN DE SERVICIO TÉCNICO\nFecha: 2026-04-01\n1\n/);
    expect(t).not.toMatch(/Quimera|Inventado|6015551234/);
    expect(t).toMatch(/Laboratorio/);
  });

  it('los tickets del rango 700–1499 siguen dentro del rango', () => {
    const a = crearAnonimizador();
    const k = Number(a.ticket('1033'));
    expect(k).toBeGreaterThanOrEqual(700);
    expect(k).toBeLessThan(1500);
    expect(k).not.toBe(1033);
  });
});

describe('anonimizar', () => {
  const reales = {
    roles: { remisiones: { inventada: 'remA' }, seriales: { S_UNO: '18A90417' }, tickets: { T_UNO: '1033' }, clientes: { C_UNO: 'QUIMERA' } },
    remisiones: { inventada: 'REMISIÓN DE SERVICIO TÉCNICO\n\\#S/N\n1033\nEDM180C\nGrimm\n18A90417\nQUIMERA S.A.S.' },
    escaneos: {
      _nota: 'nota inventada',
      ilegibles: [{ n: '260115 - QUIMERA.pdf', d: '2026-01-15', t: ['CANT1DAD'], it: { CANT1DAD: { e: 'EDM 180 · 18#90417', k: '' } } }],
      legibles: [{ n: '260116 - Quimera.pdf', d: '2026-01-16', t: [cls('18A90417')], it: { [cls('18A90417')]: { e: 'EDM180C', k: '1033' } } }],
      fechaErrada: { n: '270316 - QUIMERA.pdf', d: '2027-03-16', t: ['202603T6'], it: {} },
    },
  };

  it('es determinista y los roles salen en roles.json', () => {
    const a = anonimizar(reales);
    expect(anonimizar(reales)).toEqual(a);
    const roles = JSON.parse(a['roles.json']);
    expect(roles.clientes.C_UNO).toBe('ALFA');
    expect(JSON.parse(a['remisiones.json']).remA).toContain(roles.seriales.S_UNO);
    expect(JSON.parse(a['escaneos.json']).legibles[0].n).toBe('260116 - Alfa.pdf');
    expect(JSON.parse(a['escaneos.json']).legibles[0].it[cls(roles.seriales.S_UNO)].k).toBe(roles.tickets.T_UNO);
  });

  it('ningún valor sintético coincide con un serial o un ticket de tickets.json', () => {
    const antes = JSON.parse(anonimizar(reales)['roles.json']);
    const conTickets = { ...reales, tickets: [{ ticketNumber: antes.tickets.T_UNO, cf: { cf_serial: antes.seriales.S_UNO } }] };
    const despues = JSON.parse(anonimizar(conTickets)['roles.json']);
    expect(despues.tickets.T_UNO).not.toBe(antes.tickets.T_UNO);
    expect(cls(despues.seriales.S_UNO)).not.toBe(cls(antes.seriales.S_UNO));
  });

  it('la salida no contiene ningún valor de entrada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anon-'));
    try {
      for (const [n, t] of Object.entries(anonimizar(reales))) writeFileSync(join(dir, n), t);
      expect(buscarFugas(reales, [dir])).toEqual([]);
      writeFileSync(join(dir, 'fuga.txt'), 'el serial 18A90417 de QUIMERA');
      expect(buscarFugas(reales, [dir]).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('una clave de remisiones sin rol es un error, no una fuga', () =>
    expect(() => anonimizar({ ...reales, remisiones: { ...reales.remisiones, otra: 'x' } })).toThrow(/sin rol/));
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run scripts/equipos-anonimizar.test.mjs
```

Esperado: FAIL — `Failed to load url ./equipos-anonimizar.mjs` (el script no existe).

- [ ] **Step 3: Escribir el script**

Crear `apps/hub-api/scripts/equipos-anonimizar.mjs`:

```js
#!/usr/bin/env node
// Anonimiza las fixtures reales del módulo «Equipos en taller» (D9 del diseño).
//
//   node scripts/equipos-anonimizar.mjs generar  <dir-reales> <dir-salida>
//   node scripts/equipos-anonimizar.mjs verificar <dir-reales> <ruta> [<ruta>…]
//
// <dir-reales> es una carpeta LOCAL, ignorada por git, con remisiones.json,
// escaneos-reales.json, roles.local.json y, si está, tickets.json (solo para que
// ningún valor sintético coincida con un serial o un ticket real). Este fichero no
// lleva ningún dato real: todo lo que sabe de los clientes, seriales y tickets lo
// lee de allí.
//
// Qué conserva (lo que prueban las reglas del núcleo):
//   · la CLASE OCR de cada serial: O/0, I/1, S/5, T/7 y B/8 siguen siendo
//     intercambiables y en la misma posición; una letra sigue siendo letra y un
//     dígito, dígito (el serial sin dígitos sigue sin dígitos);
//   · los ceros a la izquierda (no cuentan para la clase y se dejan tal cual);
//   · el prefijo de modelo de GRIMM (18A, 18B, 280…), que es público;
//   · el serial deformado «NN#NNNNN»: sus dígitos pasan a ser los del serial
//     sintético que les corresponde;
//   · las fechas AAMMDD / AAAAMMDD, los números de una o dos cifras, los números
//     de ticket dentro del rango 700–1499 (siguen dentro) y las palabras del
//     formato de la remisión que las reglas reconocen.
// Todo lo demás (clientes, personas, direcciones, otros números y códigos) se
// sustituye por valores sintéticos. La salida solo depende del ORDEN en que
// aparecen los valores, nunca de los valores: no hay forma de deshacerla.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── Clases OCR: las mismas funciones que nucleo/reglas.ts ────────────────────
export const key = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
export const nrm = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1');
export const cls = (s) => nrm(s).replace(/^0+(?=.)/, '').replace(/5/g, 'S').replace(/7/g, 'T').replace(/8/g, 'B');

/** Clases que se confunden en el OCR, con su forma de dígito y de letra. */
const CONF = { 0: ['0', 'O'], 1: ['1', 'I'], S: ['5', 'S'], T: ['7', 'T'], B: ['8', 'B'] };
const CONF_CLASES = Object.keys(CONF);
const DIGITOS_PLANOS = '23469';
const LETRAS_PLANAS = 'ACDEFGHJKLMNPQRUVWXYZ';

/** Lo que las reglas reconocen por su valor y no se puede tocar (en clase OCR). */
// Los seriales GRIMM (1BA…, 1BB…, 2B0…) NO están aquí: son seriales de clientes. Se
// anonimizan conservando el prefijo y la forma, así que siguen casando con las reglas.
const PROTEGIDAS = [
  /^EDM[12]B0|^AP[A-Z]{2}3T0|^WQ\d|^0CMA|^PG3S0|^US000/, // modelos reconocibles (EQT)
  /^REM20\d\d|^0V1?20\d\d/, // remisiones comerciales
  /^(T1CKET|CANT1DAD|REC1B1D0|B0TELLAS|MAN0METR0)$/, // encabezados y gases
];
const aDigitos = (c) => c.replace(/S/g, '5').replace(/T/g, '7').replace(/B/g, '8');
const esFechaLarga = (c) => /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(aDigitos(c));
const esFechaCorta = (d) => /^2\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(aDigitos(d));
const protegida = (c) => PROTEGIDAS.some((r) => r.test(c)) || esFechaLarga(c) || esFechaCorta(c);
/** Palabra del vocabulario escrita en clase OCR (METR0LAB0R → METROLABOR). */
const deVocabulario = (c) => VOCABULARIO.has(c) || VOCABULARIO.has(c.replace(/0/g, 'O').replace(/1/g, 'I'));
/** Prefijo de modelo GRIMM que se conserva. */
const prefijo = (c) => (/^1B[AB]|^2B0/.test(c) ? 3 : 0);
/**
 * Lo que las reglas miran en la FORMA de un código: serial GRIMM (EQT), modelo «AP..»,
 * «WQ», «EDM», «OCMA». Un valor sintético tiene que tener los mismos rasgos que el real:
 * si no, un número cualquiera podría volverse «serial GRIMM» y cambiar una regla.
 */
const RASGOS = [/^1B[AB][\dSTB]{5}$|^2B0[\dSTB]{5}$/, /^AP[A-Z]{2}/, /^WQ/, /^EDM/, /^0?CMA/];
const mismosRasgos = (a, b) => RASGOS.every((r) => r.test(a) === r.test(b));

/** Vocabulario del formato y de las reglas: se deja tal cual (en mayúsculas sin tildes). */
export const VOCABULARIO = new Set(
  (
    // palabras de STOPW (reglas.ts)
    'SERVICIO EQUIPO EQUIPOS OBSERVACIONES NOVEDADES REMISION FIRMA NOMBRE CEDULA CARGO APLICA ORIGEN DESTINO DIRECCION UNIDADES ' +
    'REMITENTE DESTINATARIO FACTURACION ORIGINAL COLOMBIA HORIBA BOGOTA CREDITO CONTENER DELICADO OPERATIVO CALIBRADO INFORMACION ' +
    'DESCRIPCION AMBIENTALIA ENVIRONICS CERTIFICATION BUREAU VERITAS DIAGNOSTICO MANTENIMIENTO REPARACION CALIBRACION OPTIMAS ' +
    'CONDICIONES ACCESORIO ACCESORIOS FUNCIONAL GENERALES CLIENTE TELEFONO EMPRESA CONTACTO SALIDA ENTRADA INCLUYE TRANSPORTE TARJETA ' +
    'POLIZA SINIESTRO SEGUROS RIESGOS VIGENCIA ADMISION DEVOLUCION INTENTO OFICINA REGISTRO POSTAL MERCANCIA ATLANTICO BARRANQUILLA ' +
    'LABORATORIO TECNICO TECNICA ESPECIALISTA OPERACIONES ' +
    // encabezados, partes, equipos principales, marcas y servicio externo
    'MARCA TICKET DEL SE OBSERVACION NOTA FECHA CANTIDAD RECIBIDO BOTELLAS MANOMETRO ' +
    'CABLE SENSOR CARGADOR ADAPTADOR BATERIA MANGUERA REPUESTO REPUESTOS BOMBA CABEZAL FILTRO KIT MODULO CELDA LAMPARA PANTALLA FUENTE ' +
    'PARTE PARTES TUBO ANTENA MONITOR ANALIZADOR EDM SONDA MEDIDOR ESTACION MUESTREADOR CONTADOR OCMA GRIMM KUNAK TELEDYNE THERMO ' +
    'DAVIS LENOVO MESA LABS TECNICAS OPERATIVA SHELTER DATALOGGER METROLOGICAL METROLABOR EXTERNO ' +
    // texto de entrega en comentarios
    'RECOGE RECOGEN RECOGIDO RECOGIDA RECOGIO RECOGIERON ADJUNTA ADJUNTAN ST ENTREGADO ENTREGADA ENTREGADOS ENTREGADAS ENTREGA ' +
    'ENTREGAN ENTREGARON DESPACHADO DESPACHADA ENVIADO ENVIADA ENVIADOS ENVIADAS CALIBRA FABRICA SENSORES ' +
    // palabras funcionales y del formato
    'DE LA EL LOS LAS Y O U A AL EN POR PARA CON SIN UN UNA UNO NO SI ES N S SN PDF CAJA PODER AIR PRO MODELO SERIAL CANT UNIDAD ' +
    'TOTAL ITEM VALOR'
  ).split(' '),
);
/** Códigos de modelo (no son seriales de nadie): se dejan tal cual. */
const MODELO = /^(EDM\d{0,3}[A-Z]?|AP[A-Z]{2}(-?\d{2,3})?|OCMA(-?\d{2,3})?|PG\d{2,3}|WQ\d{1,4}|US0{3}\d*)$/;

// ── Generador determinista (mulberry32): solo depende del contador ──────────
function hash32(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(semilla) {
  let a = hash32('equipos-anon|' + semilla);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const elegir = (r, s) => s[Math.floor(r() * s.length)];

/**
 * Estado de una anonimización. `evitar` son valores reales (clases y tickets) que
 * ningún valor sintético puede repetir, aunque aún no hayan salido.
 */
export function crearAnonimizador(evitar = new Set()) {
  let n = 0;
  const clases = new Map(); // clase real → clase sintética
  const usadas = new Set();
  const tickets = new Map();
  const numeros = new Map();
  const palabras = new Map(); // palabra real (key) → palabra sintética (key)
  const clientes = new Map(); // palabra real (key) → nombre sintético (mayúsculas)
  const NATO = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECO', 'FOXTROT', 'GOLF', 'HOTEL', 'JULIETT', 'KILO', 'LIMA', 'MIKE'];

  function clase(c) {
    // Menos de 4 caracteres no identifica a nadie, y no hay sitio para variar.
    if (c.length < 4 || protegida(c)) return c;
    const ya = clases.get(c);
    if (ya) return ya;
    for (let intento = 0; ; intento++) {
      if (intento > 500) throw new Error('No se encuentra una clase sintética libre (longitud ' + c.length + ')');
      const r = rng('clase|' + n++);
      const p = prefijo(c);
      const s = [...c].map((x, i) => {
        if (i < p) return x;
        if (CONF_CLASES.includes(x)) return elegir(r, i === 0 ? CONF_CLASES.filter((k) => k !== '0') : CONF_CLASES);
        return /\d/.test(x) ? elegir(r, DIGITOS_PLANOS) : elegir(r, LETRAS_PLANAS);
      }).join('');
      if (s !== c && mismosRasgos(c, s) && !usadas.has(s) && !clases.has(s) && !evitar.has(s) && !protegida(s) && !deVocabulario(s)) {
        clases.set(c, s);
        usadas.add(s);
        return s;
      }
    }
  }

  /** Reescribe un serial tal como está escrito, con la clase sintética de su clase. */
  function serial(raw) {
    const c = cls(raw);
    if (!c || protegida(c)) return raw;
    const s = clase(c);
    const ceros = (nrm(raw).match(/^0+(?=.)/) || [''])[0].length;
    let j = 0;
    return [...raw].map((ch) => {
      if (!/[A-Za-z0-9]/.test(ch)) return ch;
      const i = j++ - ceros;
      if (i < 0) return ch;
      const x = s[i];
      const minuscula = ch !== ch.toUpperCase();
      const out = CONF[x] ? CONF[x][/\d/.test(ch) ? 0 : 1] : x;
      return minuscula ? out.toLowerCase() : out;
    }).join('');
  }

  function ticket(t) {
    const v = String(t);
    const ya = tickets.get(v);
    if (ya) return ya;
    for (;;) {
      const r = rng('ticket|' + n++);
      const s = String(700 + Math.floor(r() * 800));
      if (s !== v && !tickets.has(s) && !evitar.has(s) && ![...tickets.values()].includes(s)) {
        tickets.set(v, s);
        return s;
      }
    }
  }

  function numero(d) {
    const ya = numeros.get(d);
    if (ya) return ya;
    for (;;) {
      const r = rng('numero|' + n++);
      const s = [...d].map((x, i) => (i === 0 && x !== '0' ? elegir(r, '123456789') : elegir(r, '0123456789'))).join('');
      const v = Number(s);
      const enRango = (s.length === 3 || s.length === 4) && v >= 700 && v < 1500;
      if (s !== d && !enRango && !esFechaCorta(s) && ![...numeros.values()].includes(s)) {
        numeros.set(d, s);
        return s;
      }
    }
  }

  const conCaso = (modelo, s) =>
    modelo === modelo.toUpperCase() ? s : modelo === modelo.toLowerCase() ? s.toLowerCase() : s[0] + s.slice(1).toLowerCase();

  function cliente(real) {
    const k = key(real);
    const ya = clientes.get(k);
    if (ya) return ya;
    const s = NATO[clientes.size];
    if (!s) throw new Error('Demasiados clientes con rol: amplía la lista NATO');
    clientes.set(k, s);
    return s;
  }

  function palabra(w) {
    const k = key(w);
    let s = palabras.get(k);
    if (!s) {
      // O/I se quedan O/I (el OCR las lee como 0/1) y S/T/B, S/T/B: la palabra cuenta igual para las reglas.
      // Una palabra de hasta 3 letras hechas solo de esas se deja: no identifica a nadie.
      if (k.length <= 3 && !/[ACDEFGHJKLMNPQRUVWXYZ]/.test(k)) return w;
      for (let intento = 0; ; intento++) {
        if (intento > 500) throw new Error('No se encuentra una palabra sintética libre (longitud ' + k.length + ')');
        const r = rng('palabra|' + n++);
        s = [...k].map((x) => ('OI'.includes(x) ? elegir(r, 'OI') : 'STB'.includes(x) ? elegir(r, 'STB') : /\p{L}/u.test(x) ? elegir(r, LETRAS_PLANAS) : x)).join('');
        if (s !== k && mismosRasgos(nrm(k), nrm(s)) && !VOCABULARIO.has(s) && ![...palabras.values()].includes(s)) break;
      }
      palabras.set(k, s);
    }
    return [...s].map((x, i) => (w[i] && w[i] !== w[i].toUpperCase() ? x.toLowerCase() : x)).join('');
  }

  /** Una palabra o código suelto del texto. */
  function token(t) {
    const k = key(t);
    if (VOCABULARIO.has(k) || MODELO.test(k)) return t;
    if (clientes.has(k)) return conCaso(t, clientes.get(k));
    const c = cls(t);
    if (/\d/.test(t) || clases.has(c)) {
      if (/^\d+$/.test(t)) {
        if (t.length <= 2 || (t.length === 6 && esFechaCorta(t)) || (t.length === 8 && esFechaLarga(t))) return t;
        const v = Number(t);
        if ((t.length === 3 || t.length === 4) && v >= 700 && v < 1500) return ticket(t);
        if (clases.has(c)) return serial(t);
        return numero(t);
      }
      if (protegida(c)) return t;
      return serial(t);
    }
    return palabra(t);
  }

  const DEFORMADO = /\b(\d{2})(\s*[#\\/]+\s*)(\d{4,6})\b/g;
  /** Texto libre (OCR, descripción de un ítem, nombre de archivo). */
  function texto(s) {
    // Una sola pasada: el serial deformado «NN#NNNNN» (grupos 1–3) o una palabra o código suelto.
    return String(s).replace(new RegExp(DEFORMADO.source + '|[\\p{L}\\p{N}]+(?:[-/][\\p{L}\\p{N}]+)*', 'gu'), (t, a, sep, dg) => {
      if (dg) {
        const real = [...clases.keys()].find((c) => aDigitos(c).endsWith(dg));
        return a + sep + (real ? aDigitos(clases.get(real)).slice(-dg.length) : numero(dg));
      }
      // Con guion o barra: si lleva dígitos es un código (serial, fecha, teléfono) y va entero; si no, palabra a palabra.
      if (!/[-/]/.test(t) || /\d/.test(t)) return token(t);
      return t.split(/([-/])/).map((p) => (/^[-/]$/.test(p) ? p : token(p))).join('');
    });
  }

  return { clase, serial, ticket, cliente, texto, mapas: { clases, tickets, clientes } };
}

/** Clases OCR de los seriales de los tickets reales (tickets.json, opcional). */
const seriales = (tickets) =>
  (tickets || []).flatMap((t) => ['cf_serial', 'cf_serial1', 'cf_serial2', 'cf_serial3'].map((k) => cls(t?.cf?.[k] ?? ''))).filter((c) => c.length >= 5);

/** Anonimiza las fixtures. Devuelve los ficheros de salida, ya en texto. */
export function anonimizar(reales) {
  const { roles, remisiones, escaneos } = reales;
  // Ningún valor sintético puede coincidir con un serial o un ticket real conocido (los de los
  // roles y, si está, los de tickets.json), aunque no salgan en estas fixtures.
  const evitar = new Set([...Object.values(roles.seriales || {}).map(cls), ...Object.values(roles.tickets || {}).map(String), ...seriales(reales.tickets), ...(reales.tickets || []).map((t) => String(t.ticketNumber))]);
  const a = crearAnonimizador(evitar);
  const ordenadas = (o) => Object.keys(o || {}).sort();
  // 1) Los roles primero: así su valor sintético no depende del resto.
  const sintetico = { seriales: {}, tickets: {}, clientes: {} };
  for (const r of ordenadas(roles.seriales)) sintetico.seriales[r] = a.serial(roles.seriales[r]);
  for (const r of ordenadas(roles.tickets)) sintetico.tickets[r] = a.ticket(roles.tickets[r]);
  for (const r of ordenadas(roles.clientes)) sintetico.clientes[r] = a.cliente(roles.clientes[r]);
  // 2) Las remisiones (texto OCR), con su clave renombrada.
  const rem = {};
  const renombre = roles.remisiones || {};
  for (const k of Object.keys(renombre).sort((x, y) => renombre[x].localeCompare(renombre[y]))) {
    if (!(k in remisiones)) throw new Error('roles.remisiones nombra una clave que no está en remisiones.json');
    rem[renombre[k]] = a.texto(remisiones[k]);
  }
  for (const k of Object.keys(remisiones)) if (!(k in renombre)) throw new Error('remisiones.json tiene una clave sin rol: añádela a roles.remisiones');
  // 3) Los escaneos ya leídos (clases, ítems y nombres de archivo).
  const escaneo = (x) => {
    const it = {};
    for (const c of Object.keys(x.it || {})) it[a.clase(c)] = { e: a.texto(x.it[c].e || ''), k: x.it[c].k ? a.ticket(x.it[c].k) : '' };
    return { n: a.texto(x.n), d: x.d, t: (x.t || []).map((c) => a.clase(c)), it };
  };
  const esc = {
    _nota: 'Fixtures anonimizadas con apps/hub-api/scripts/equipos-anonimizar.mjs: clientes, seriales, tickets y textos sustituidos de forma determinista; se conservan las peculiaridades del OCR.',
    ilegibles: escaneos.ilegibles.map(escaneo),
    legibles: escaneos.legibles.map(escaneo),
    fechaErrada: escaneo(escaneos.fechaErrada),
  };
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  return { 'remisiones.json': json(rem), 'escaneos.json': json(esc), 'roles.json': json(sintetico) };
}

/**
 * Valores reales que no pueden aparecer en ningún fichero que vaya al repo, en CLASE
 * OCR (así se encuentran escritos de cualquier forma: «0» u «O», «5» o «S»…).
 */
export function valoresReales(reales) {
  const { roles, escaneos } = reales;
  const v = new Set();
  for (const s of Object.values(roles.seriales || {})) v.add(cls(s));
  for (const c of seriales(reales.tickets)) v.add(c);
  for (const c of Object.values(roles.clientes || {})) v.add(cls(key(c)));
  for (const k of Object.keys(roles.remisiones || {})) v.add(cls(key(k)));
  for (const x of [...escaneos.ilegibles, ...escaneos.legibles, escaneos.fechaErrada])
    for (const c of x.t || []) if (c.length >= 5 && !protegida(c) && !deVocabulario(c)) v.add(c);
  return [...v].filter((x) => x.length >= 4);
}
/** Un texto entero pasado a clase OCR, sin quitar separadores (los valores no los llevan). */
const claseTexto = (t) => key(t).replace(/O/g, '0').replace(/I/g, '1').replace(/5/g, 'S').replace(/7/g, 'T').replace(/8/g, 'B');

/** Busca valores reales en los ficheros dados. Devuelve «ruta: valor» por cada hallazgo. */
export function buscarFugas(reales, rutas) {
  const valores = valoresReales(reales);
  const tickets = Object.values(reales.roles.tickets || {}).map(String);
  const ficheros = [];
  const recorrer = (p) => {
    if (statSync(p).isDirectory()) { for (const h of readdirSync(p)) if (h !== 'node_modules' && h !== 'fixtures-reales') recorrer(join(p, h)); }
    else ficheros.push(p);
  };
  rutas.forEach(recorrer);
  const fugas = [];
  for (const f of ficheros) {
    const t = readFileSync(f, 'utf8');
    const c = claseTexto(t);
    for (const x of valores) if (c.includes(x)) fugas.push(f + ': ' + x);
    for (const x of tickets) if (new RegExp('(^|[^0-9])' + x + '([^0-9]|$)').test(t)) fugas.push(f + ': ticket ' + x);
  }
  return fugas;
}

function leerReales(dir) {
  const leer = (n) => JSON.parse(readFileSync(join(dir, n), 'utf8'));
  return {
    roles: leer('roles.local.json'),
    remisiones: leer('remisiones.json'),
    escaneos: leer('escaneos-reales.json'),
    tickets: existsSync(join(dir, 'tickets.json')) ? leer('tickets.json') : [],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [orden, dir, ...resto] = process.argv.slice(2);
  if (orden === 'generar' && dir && resto.length === 1) {
    const salida = anonimizar(leerReales(dir));
    mkdirSync(resto[0], { recursive: true });
    for (const [n, t] of Object.entries(salida)) writeFileSync(join(resto[0], n), t);
    const fugas = buscarFugas(leerReales(dir), [resto[0]]);
    if (fugas.length) { console.error('FUGA: la salida contiene valores reales:\n' + fugas.join('\n')); process.exit(1); }
    console.log('Fixtures anonimizadas en ' + resto[0]);
  } else if (orden === 'verificar' && dir && resto.length) {
    const fugas = buscarFugas(leerReales(dir), resto);
    if (fugas.length) { console.error('FUGA:\n' + fugas.join('\n')); process.exit(1); }
    console.log('Sin valores reales en: ' + resto.join(', '));
  } else {
    console.error('Uso: equipos-anonimizar.mjs generar <dir-reales> <dir-salida> | verificar <dir-reales> <ruta>…');
    process.exit(2);
  }
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run scripts/equipos-anonimizar.test.mjs
```

Esperado: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/scripts/equipos-anonimizar.mjs apps/hub-api/scripts/equipos-anonimizar.test.mjs
git commit -m "feat(equipos-taller): anonimizador determinista de las fixtures del núcleo"
```

---

### Task 3: Generar las fixtures anonimizadas y comprobar que no hay fugas

**Files:**
- Create (generados): `apps/hub-api/src/equipos/nucleo/fixtures/{remisiones,escaneos,roles}.json`

- [ ] **Step 1: Generar**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs generar src/equipos/nucleo/fixtures-reales src/equipos/nucleo/fixtures
```

Esperado: `Fixtures anonimizadas en src/equipos/nucleo/fixtures` (si saliera `FUGA: …`, la salida contiene un valor real: no se commitea y se corrige el script).

- [ ] **Step 2: Comprobar que es la misma anonimización que se validó al escribir este plan**

La salida solo depende del orden de los valores, así que `roles.json` tiene que salir exactamente así (son valores sintéticos):

```json
{
  "seriales": {
    "S_ACCESORIOS": "18A12510",
    "S_B8": "75780",
    "S_DEFORMADO": "18A94006",
    "S_FECHA_ERRADA": "18A93855",
    "S_PARCIAL": "18A60810",
    "S_SIN_DIGITOS": "TLUX1NK0",
    "S_SIN_TEXTO_1": "18A23793",
    "S_SIN_TEXTO_2": "18A49141",
    "S_T7": "8B75PVN8",
    "S_TICKET_EN_REMISION": "18A27500"
  },
  "tickets": {
    "T_EN_REMISION": "724",
    "T_PARCIAL": "1069"
  },
  "clientes": {
    "C_ILEGIBLE": "ALFA",
    "C_SIN_TEXTO": "BRAVO"
  }
}
```

Si difiere, el script no es el del plan: revisar antes de seguir.

- [ ] **Step 3: Verificar que ningún valor real ha salido de la carpeta local**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts
```

Esperado: `Sin valores reales en: src/equipos, scripts`. **Este comando se repite antes de cada commit que toque `apps/hub-api/src/equipos/` o `apps/equipos-taller/`** (añadiendo `../equipos-taller/src` cuando exista).

- [ ] **Step 4: Commit**

```bash
git add apps/hub-api/src/equipos/nucleo/fixtures/remisiones.json apps/hub-api/src/equipos/nucleo/fixtures/escaneos.json apps/hub-api/src/equipos/nucleo/fixtures/roles.json
git commit -m "test(equipos-taller): fixtures anonimizadas del núcleo"
```

---

### Task 4: Trasladar el núcleo con sus pruebas

**Files:**
- Create: `apps/hub-api/src/equipos/nucleo/{tipos,reglas,actualizar,pantalla}.ts` (traslado), `apps/hub-api/src/equipos/nucleo/index.ts`
- Test: `apps/hub-api/src/equipos/nucleo/{reglas,actualizar,pureza,reales.local}.test.ts`

El núcleo se traslada **sin cambiar reglas**. Los cuatro ficheros se importan entre sí con rutas relativas `./x.js`, que siguen valiendo: no cambia ningún import. Solo cambian tres líneas que llevan datos reales (supuesto A3) y el `index.ts`, que deja fuera las fuentes de la página de Claude (se quedan con esa página, Tarea 22).

- [ ] **Step 1: Escribir las pruebas portadas (fallan: el núcleo aún no está)**

Crear `apps/hub-api/src/equipos/nucleo/reglas.test.ts` (portada de `packages/equipos/test/reglas.test.ts`: los valores salen de `fixtures/roles.json`; los casos con datos escritos a mano usan datos inventados):

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Reglas as R, EST, type Escaneo } from './index.js';

// Reglas del núcleo con fixtures ANONIMIZADAS (scripts/equipos-anonimizar.mjs). Los
// valores salen de fixtures/roles.json: cada rol es «el serial (o ticket, o cliente)
// que hace de X en este caso», nunca un dato real.
const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8'));
const ROL = fx('roles.json') as { seriales: Record<string, string>; tickets: Record<string, string>; clientes: Record<string, string> };
const S = ROL.seriales;
const T = ROL.tickets;
const C = ROL.clientes;
const pdf = fx('remisiones.json') as Record<string, string>;
const P = Object.fromEntries(Object.entries(pdf).map(([k, v]) => [k, R.scanParse(v)]));
const item = (k: string, sn: string) => P[k].it[R.cls(sn)] || { e: '', k: '' };

describe('lectura de remisiones de salida escaneadas', () => {
  it('el serial sin dígitos se reconoce aunque el OCR lo lea solo con letras, y no es parcial', () => {
    expect(/\d/.test(pdf.remA.split('\n').find((l) => R.cls(l.trim()) === R.cls(S.S_SIN_DIGITOS)) || '1')).toBe(false);
    expect(P.remA.t).toContain(R.cls(S.S_SIN_DIGITOS));
    expect(R.esParcial(item('remA', S.S_SIN_DIGITOS).e)).toBe(false);
  });
  it('la remisión trae el ticket de su serial', () => expect(item('remA', S.S_TICKET_EN_REMISION).k).toBe(T.T_EN_REMISION));
  it('el serial con T/7 se reconoce aunque el OCR cambie la T por un 7', () => expect(P.remB.t).toContain(R.cls(S.S_T7)));
  it('«Se incluye: Cable de poder» no vuelve parcial al serial con B/8', () => expect(R.esParcial(item('remB', S.S_B8).e)).toBe(false));
  it('una salida parcial (cable) con su ticket', () => {
    expect(R.esParcial(item('remC', S.S_PARCIAL).e)).toBe(true);
    expect(item('remC', S.S_PARCIAL).k).toBe(T.T_PARCIAL);
  });
  it('no es parcial si los accesorios van entre el modelo y el serial', () => expect(R.esParcial(item('remD', S.S_ACCESORIOS).e)).toBe(false));
  it('las palabras del formato no se toman como seriales', () => expect(P.remA.t.some((x) => /SERV/.test(x))).toBe(false));
});

describe('Zoho', () => {
  it('«Empty response» = sin tickets, no es error', () => {
    expect(R.tix({ data: { message: 'Empty response received from API. Service - DESK, Tool - searchTickets' } })).toEqual([]);
    expect(R.tix({ headers: {}, status: 'success', data: { message: 'Empty response received from API.' } })).toEqual([]);
    expect(R.tix('{"headers":{},"status":"success","data":{"message":"Empty response received"}}')).toEqual([]);
  });
  const ev = (t: string, a: string[] = [], d = '2026-10-01') =>
    R.cmtEvidence([{ commentedTime: d + 'T10:00:00Z', content: t, attachments: a.map((name) => ({ name })) }], new Set(['260928 - METROLOGICAL1.PDF', '261016 - CLIENTE C .PDF']), '2026-09-01', null);
  it('envío a Metrological con PDF adjunto no es entrega', () => expect(ev('EQUIPOS ENVIADOS A CALIBRACION DE SENSORES TEMP RH PRESS', ['260928 - Metrological1.pdf'])).toBeNull());
  it('comentario con la remisión escaneada adjunta sí es entrega', () => expect(ev('REMISION SALIDA', ['261016 - Cliente C .pdf'])).not.toBeNull());
  it('«recogido por la transportadora» sí es entrega', () => expect(ev('El equipo es recogido por la transportadora Envíos Ficticios')).not.toBeNull());
  it('«Repuestos entregados a…» no es entrega', () => expect(ev('Repuestos entregados a Técnico Uno')).toBeNull());
});

describe('enlace con ticket y clasificación', () => {
  const z = R.tnorm({ ticketNumber: '1401', status: 'Finalizado', statusType: 'Closed', createdTime: '2026-06-18T00:00:00Z', closedTime: '2026-08-20T00:00:00Z', webUrl: 'x/dv/1',
    cf: { cf_serial: '18A90100', cf_fecha_remision_entreda: '2026-06-17', cf_fecha_remision_de_salida: '2026-06-11' } });
  const v = R.visits([{ id: 'a', sn: '18A90100', d: '2026-06-16', c: 'CLIENTE D' }])[0];
  it('se enlaza con el ticket aunque su Fecha Remisión de Salida esté mal, y avisa el dato a corregir', () => {
    const lz = R.linkTicket(v, [z]);
    expect(lz?.n).toBe('1401');
    const c = R.classify(v, { z: lz, scans: [], age: 140, zq: true });
    expect(c.est).toBe(EST.CERRADO);
    expect(c.why.some((w) => /Dato a corregir/.test(w))).toBe(true);
  });
  it('Kunak: el cero a la izquierda no cuenta, nombre sin «Otro», enlace por fecha y por número de la remisión', () => {
    expect(R.cls('0344460096')).toBe(R.cls('344460096'));
    const doc = '| \\*\\*TICKET\\*\\* | \\*\\*EQUIPO\\*\\* | \\*\\*MARCA\\*\\* | \\*\\*\\\\\\# S/N\\*\\* | \\*\\*SERVICIO\\*\\* |\n| 1077  | AIR Pro | Kunak | 344460096 | Diagnóstico |\n| \\*\\*OBSERVACIONES O NOVEDADES\\*\\* |  |  |  |  |';
    expect(R.parseRemisionEntrada(doc, '344460096')).toEqual({ eq: 'AIR Pro · Kunak', srv: 'Diagnóstico', k: '1077' });
    const k = R.tnorm({ ticketNumber: '1077', status: 'Rev./Diagnostico', statusType: 'Open', createdTime: '2026-11-09T14:50:41Z', webUrl: 'x/dv/900000000000000001',
      subject: 'Servicio Técnico Cliente Prueba S.A.S. Sensor de calidad de aire MT_0344460096_Kunak AIR Pro_261030',
      cf: { cf_serial: '0344460096', cf_equipo_1: 'Otro', cf_modelo: 'Kunak AIR Pro', cf_fecha_remision_entreda: '2026-10-30', cf_codigo_servicio: 'MT_0344460096_Kunak AIR Pro_261030' } });
    expect(k.eq).toBe('Kunak AIR Pro');
    const kv = R.visits([{ id: 'k', sn: '344460096', d: '2026-10-30', c: 'Cliente Prueba' }])[0];
    expect(R.linkTicket(kv, [k])?.n).toBe('1077');
    const l2 = R.linkTicket(kv, [{ ...k, fe: '', tk: [] }], '1077');
    expect(l2?.n).toBe('1077');
    expect(l2?.lw).toMatch(/remisión de entrada/);
  });
});

describe('remisiones escaneadas ilegibles (casos anonimizados)', () => {
  type Caso = Pick<Escaneo, 'n' | 'd' | 't' | 'it'>;
  const F = fx('escaneos.json') as { ilegibles: Caso[]; legibles: Caso[]; fechaErrada: Caso };
  const E = new Set<string>();
  it.each(F.ilegibles.map((x): [string, Caso] => [x.n, x]))('%s se marca', (_n, x) => expect(R.scanIlegible(x, E)).not.toBeNull());
  it.each(F.legibles.map((x): [string, Caso] => [x.n, x]))('%s no se marca', (_n, x) => expect(R.scanIlegible(x, E)).toBeNull());
  it('el serial deformado «NN#NNNNN» deja sus dígitos para sugerir el equipo', () => {
    const x = F.ilegibles.find((y) => y.n.includes(C.C_ILEGIBLE))!;
    expect(R.scanIlegible(x, E)?.dg).toBe(S.S_DEFORMADO.slice(-5));
  });
  it('si trae el serial de un equipo con entrada no es ilegible', () =>
    expect(R.scanIlegible({ t: ['CANT1DAD', R.cls('70771')], it: { CANT1DAD: { e: 'Email', k: '' } } }, new Set([R.cls('70771')]))).toBeNull());
  it('fecha real: el nombre con fecha futura usa la fecha impresa; sin AAMMDD no se cruza; fecha normal sin cambios', () => {
    expect(R.fechaReal(F.fechaErrada, '2026-11-09')).toBe('2026-03-16');
    expect(R.fechaReal({ n: '2603 - X.pdf', d: '', t: [] }, '2026-11-09')).toBe('');
    expect(R.fechaReal({ n: '261106 - X.pdf', d: '2026-11-06', t: [] }, '2026-11-09')).toBe('2026-11-06');
  });
});
```

Crear `apps/hub-api/src/equipos/nucleo/actualizar.test.ts` (portada de `packages/equipos/test/actualizar.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { actualizar, CV, EST, aplicarAjustes, filasDeVista, ilegiblesPendientes, claveFila, VISTA_TICKET_ABIERTO, type Escaneo, type Fuentes } from './index.js';

// Una actualización completa sobre el caché de escaneos ANONIMIZADO: sin OCR (todo está en
// el caché) y sin tickets. Los roles (fixtures/roles.json) dicen qué serial y qué cliente
// hace de cada caso.
const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8'));
const { seriales: S, clientes: C } = fx('roles.json') as { seriales: Record<string, string>; clientes: Record<string, string> };
const F = fx('escaneos.json');
const sc: Escaneo[] = [...F.ilegibles, ...F.legibles, F.fechaErrada].map((x: Omit<Escaneo, 'id'>, i: number) => ({ id: 'p' + i, ...x }));
const ent = [
  ['260110 - ' + C.C_ILEGIBLE + ' - ' + S.S_DEFORMADO, 'e1'],
  ['260310 - ' + C.C_ILEGIBLE + ' - ' + S.S_FECHA_ERRADA, 'e2'],
  ['260601 - ' + C.C_SIN_TEXTO + ' - ' + S.S_SIN_TEXTO_1, 'e3'],
  ['260801 - ' + C.C_SIN_TEXTO + ' - ' + S.S_SIN_TEXTO_2, 'e4'],
].map(([title, id]) => ({ id, title }));
const fuentes: Fuentes = {
  entradas: async () => ent,
  salidasGeneradas: async () => [],
  salidasEscaneadas: async () => sc.map((x) => ({ id: x.id, title: x.n })),
  textoPdf: async () => { throw new Error('no debería leer PDFs: están en el caché'); },
  tickets: async () => [],
  comentarios: async () => [],
};

describe('actualización completa con el caché anonimizado', async () => {
  const o = await actualizar(fuentes, { exits: { v: CV, list: sc } }, { hoy: '2026-11-09' });
  const L = o.snap.ilegibles || [];
  const by = (n: string) => L.find((x) => x.n === n);
  const ilegibleDeFecha = '270316 - ' + C.C_ILEGIBLE + '.pdf';
  const ilegibleDeformado = '260115 - ' + C.C_ILEGIBLE + '.pdf';
  const ilegibleSinTexto = '260707 - ' + C.C_SIN_TEXTO + '.pdf';
  it('lista las ilegibles más la de fecha errada, sin avisos', () => {
    expect(L).toHaveLength(F.ilegibles.length + 1);
    expect(o.avisos).toEqual([]);
  });
  it('la remisión con fecha futura aparece como fecha errada y su equipo queda entregado en la fecha impresa', () => {
    expect(by(ilegibleDeFecha)?.q).toMatch(/2026-03-16/);
    const r = o.snap.rows.find((x) => x.sn === S.S_FECHA_ERRADA);
    expect([r?.est, r?.xd]).toEqual([EST.ENTREGADO, '2026-03-16']);
  });
  it('sugiere el serial del deformado y los equipos adentro del cliente para la remisión sin texto', () => {
    expect(by(ilegibleDeformado)?.p.map((p) => p.sn)).toContain(S.S_DEFORMADO);
    expect(by(ilegibleSinTexto)?.p.map((p) => p.sn)).toEqual([S.S_SIN_TEXTO_1]);
  });
  it('no lista remisiones comerciales, de gases, guías ni documentos ajenos', () =>
    expect(L.some((x) => F.legibles.some((l: { n: string }) => l.n === x.n))).toBe(false));
  it('los ajustes se aplican igual que en la página de Claude', () => {
    const r = o.snap.rows.find((x) => x.sn === S.S_SIN_TEXTO_1)!;
    const a = aplicarAjustes(o.snap.rows, { [claveFila(r)]: { t: 'out', m: 'recogido', at: '2026-11-09' }, ['pdf:' + by(ilegibleSinTexto)!.id]: { t: 'pdf', m: '', at: '2026-11-09' } });
    const r2 = a.find((x) => x.sn === S.S_SIN_TEXTO_1)!;
    expect([r2.est, r2.xd, r2.man]).toEqual([EST.ENTREGADO, '2026-11-09', 1]);
    expect(ilegiblesPendientes(o.snap, { ['pdf:' + by(ilegibleSinTexto)!.id]: { t: 'pdf', m: '', at: '' } })).toHaveLength(L.length - 1);
    expect(filasDeVista(a, VISTA_TICKET_ABIERTO)).toEqual([]);
  });
});
```

Crear `apps/hub-api/src/equipos/nucleo/pureza.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El núcleo es la ÚNICA fuente de verdad de las reglas y lo importan el servidor y la
// pantalla (el `tsc -b` del portal lo comprueba sin tipos de Node). Por eso, fuera de las
// pruebas, no importa nada de fuera de su carpeta: ni Node, ni la base, ni la red.
const DIR = fileURLToPath(new URL('./', import.meta.url));
const fuentes = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('núcleo puro', () => {
  it('son los cinco ficheros del módulo', () => expect(fuentes.sort()).toEqual(['actualizar.ts', 'index.ts', 'pantalla.ts', 'reglas.ts', 'tipos.ts']));

  it.each(fuentes)('%s solo importa de su propia carpeta', (f) => {
    const imports = [...readFileSync(DIR + f, 'utf8').matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.filter((i) => !/^\.\/[a-z]+\.js$/.test(i))).toEqual([]);
  });

  it('no usa nada de Node', () => {
    for (const f of fuentes) expect(readFileSync(DIR + f, 'utf8')).not.toMatch(/\bprocess\.|\bBuffer\b|node:/);
  });
});
```

Crear `apps/hub-api/src/equipos/nucleo/reales.local.test.ts` (suite solo local):

```ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actualizar, CV, type Escaneo, type Fuentes } from './index.js';

// Suite SOLO LOCAL: las fixtures reales viven en ./fixtures-reales/, ignorada por git
// (el repo es público). Sin esos ficheros (en el CI y en cualquier otra copia) se salta
// sola. Comprueba dos cosas:
//   1. que las fixtures anonimizadas del repo son exactamente las que salen hoy del
//      script a partir de las reales (si no, hay que regenerarlas);
//   2. que anonimizar no cambia lo que hace el núcleo: misma clasificación y mismas
//      ilegibles, con los datos reales y con los anonimizados.
const REALES = fileURLToPath(new URL('./fixtures-reales/', import.meta.url));
const ANONIMAS = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../scripts/equipos-anonimizar.mjs', import.meta.url));
const hay = ['remisiones.json', 'escaneos-reales.json', 'roles.local.json'].every((n) => existsSync(join(REALES, n)));
const leer = (dir: string, n: string) => JSON.parse(readFileSync(join(dir, n), 'utf8'));

async function foto(esc: { ilegibles: Escaneo[]; legibles: Escaneo[]; fechaErrada: Escaneo }) {
  const sc: Escaneo[] = [...esc.ilegibles, ...esc.legibles, esc.fechaErrada].map((x, i) => ({ ...x, id: 'p' + i }));
  const fuentes: Fuentes = {
    entradas: async () => [],
    salidasGeneradas: async () => [],
    salidasEscaneadas: async () => sc.map((x) => ({ id: x.id, title: x.n })),
    textoPdf: async () => { throw new Error('todo está en el caché'); },
    tickets: async () => [],
    comentarios: async () => [],
  };
  return (await actualizar(fuentes, { exits: { v: CV, list: sc } }, { hoy: '2026-11-09' })).snap;
}

describe.skipIf(!hay)('fixtures reales (solo local)', () => {
  it('las anonimizadas del repo están al día con el script', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'equipos-anon-'));
    try {
      execFileSync(process.execPath, [SCRIPT, 'generar', REALES, tmp]);
      // Sin los finales de línea: con core.autocrlf, la copia de trabajo puede tener CRLF.
      const texto = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
      for (const n of ['remisiones.json', 'escaneos.json', 'roles.json']) expect(texto(join(tmp, n))).toBe(texto(join(ANONIMAS, n)));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('el núcleo da lo mismo con las reales y con las anonimizadas', async () => {
    const real = await foto(leer(REALES, 'escaneos-reales.json'));
    const anonima = await foto(leer(ANONIMAS, 'escaneos.json'));
    const resumen = (f: Awaited<ReturnType<typeof foto>>) => (f.ilegibles || []).map((x) => x.d + '|' + x.m + '|' + x.p.length).sort();
    expect(resumen(anonima)).toEqual(resumen(real));
  });

  it('ningún valor real aparece en lo que va al repo', () => {
    const rutas = [ANONIMAS, fileURLToPath(new URL('../', import.meta.url)), fileURLToPath(new URL('../../../../equipos-taller/src/', import.meta.url))].filter(existsSync);
    expect(() => execFileSync(process.execPath, [SCRIPT, 'verificar', REALES, ...rutas], { stdio: 'pipe' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Ver que fallan**

```bash
cd apps/hub-api && npx vitest run src/equipos/nucleo
```

Esperado: FAIL en los cuatro ficheros — `Failed to load url ./index.js` (y `pureza` porque la carpeta no tiene los cinco ficheros).

- [ ] **Step 3: Copiar los cuatro ficheros del núcleo**

```bash
cp apps/equipos-desk2/packages/equipos/src/{tipos,reglas,actualizar,pantalla}.ts apps/hub-api/src/equipos/nucleo/
```

- [ ] **Step 4: Cambiar las tres líneas con datos reales (herramienta Edit)**

En `apps/hub-api/src/equipos/nucleo/reglas.ts`, la línea 31 (el comentario de `cls`) queda así:

```ts
/** Clase de confusión OCR: O/0, I/1, S/5, T/7 y B/8 cuentan igual; los ceros a la izquierda no cuentan (0344460096 = 344460096). */
```

y la línea 104 (dentro de `scanParse`) queda así:

```ts
      // Sin dígitos reales (un serial que el OCR leyó solo con letras): solo cuenta si va sola, en mayúsculas y no es una palabra del formato.
```

En `apps/hub-api/src/equipos/nucleo/pantalla.ts`, las líneas 10-11 (el comentario y la constante `RETIRADOS_FIJOS`) quedan así:

```ts
/** Casos fijos conocidos (equivalen a «Marcar retirado»). Vacío: el repo es público y el caso que había se rehace con «Marcar retirado» tras el despliegue. */
export const RETIRADOS_FIJOS: Record<string, string> = {};
```

Y, en las cabeceras, el comentario de la línea 2 de `reglas.ts` pasa a decir dónde corre ahora:

```ts
// Corre igual en el navegador (pantalla del portal, página de Claude) y en Node (hub-api).
```

- [ ] **Step 5: Crear la entrada del núcleo**

Crear `apps/hub-api/src/equipos/nucleo/index.ts`:

```ts
// Núcleo puro de «Equipos en taller»: dominio, proceso de actualización y lógica de pantalla.
// Sin E/S: lo usan el servidor (hub-api) y la pantalla (apps/equipos-taller).
export * from "./tipos.js";
export * as Reglas from "./reglas.js";
export { ADENTRO } from "./reglas.js";
export { actualizar, buscarIlegibles, CV, hoyBogota } from "./actualizar.js";
export * from "./pantalla.js";
```

- [ ] **Step 6: Ver que pasan**

```bash
cd apps/hub-api && npx vitest run src/equipos/nucleo
```

Esperado: PASS — `reglas.test.ts` 37, `actualizar.test.ts` 5, `pureza.test.ts` 7 y, con las fixtures reales en local, `reales.local.test.ts` 3 (sin ellas sale `skipped`). Si una prueba portada falla, **no se toca el núcleo**: el fallo está en la anonimización o en la prueba.

- [ ] **Step 7: Verificar fugas y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts
cd ../.. && git add apps/hub-api/src/equipos/nucleo/tipos.ts apps/hub-api/src/equipos/nucleo/reglas.ts apps/hub-api/src/equipos/nucleo/actualizar.ts apps/hub-api/src/equipos/nucleo/pantalla.ts apps/hub-api/src/equipos/nucleo/index.ts apps/hub-api/src/equipos/nucleo/reglas.test.ts apps/hub-api/src/equipos/nucleo/actualizar.test.ts apps/hub-api/src/equipos/nucleo/pureza.test.ts apps/hub-api/src/equipos/nucleo/reales.local.test.ts
git commit -m "feat(equipos-taller): núcleo puro en hub-api con sus pruebas sobre fixtures anonimizadas"
```

Esperado del `verificar`: `Sin valores reales en: …`. Si señala `reglas.ts` o `pantalla.ts`, falta el paso 4.

---

## Fase B — Piezas puras y fuentes (hub-api)

### Task 5: Contrato de la API (TDD)

**Files:**
- Create: `apps/hub-api/src/equipos/contrato.ts`
- Test: `apps/hub-api/src/equipos/contrato.test.ts`

Tipos que comparten servidor y pantalla, la validación de claves de ajuste (antes `claveValida` de `servidor/servicio.ts`) y el aviso de foto vieja de §5.3 (puro, para probarlo sin React).

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/contrato.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ajusteValido, avisoFoto, claveValida, type Corrida } from './contrato.js';

const corrida = (c: Partial<Corrida>): Corrida => ({ id: 1, origen: 'programada', inicio: '2026-11-10T11:30:00.000Z', fin: '2026-11-10T11:35:00.000Z', enCurso: false, ok: true, causa: null, avisos: [], conteos: null, ...c });
const fecha = (iso: string) => 'F(' + iso.slice(0, 10) + ')';

describe('claves y tipos de ajuste', () => {
  it('acepta las tres formas de clave y rechaza el resto', () => {
    expect(['1BA90417|2026-11-01', '*1BA90417', 'pdf:Abcdefghij_-12'].every(claveValida)).toBe(true);
    expect(["x' OR 1=1", '1ba90417|2026-11-01', 'pdf:corto', '*AB'].some(claveValida)).toBe(false);
  });
  it('«pdf» solo con una clave «pdf:», y al revés', () => {
    expect(ajusteValido('pdf:Abcdefghij_-12', 'pdf')).toBe(true);
    expect(ajusteValido('pdf:Abcdefghij_-12', 'out')).toBe(false);
    expect(ajusteValido('1BA90417|2026-11-01', 'pdf')).toBe(false);
    expect(ajusteValido('1BA90417|2026-11-01', 'in')).toBe(true);
    expect(ajusteValido('1BA90417|2026-11-01', 'borrar')).toBe(false);
  });
});

describe('avisoFoto (§5.3)', () => {
  const base = { configurado: true, ultima: corrida({}), ultimaBuena: corrida({}), incidente: null };
  it('sin nada que avisar, null', () => expect(avisoFoto(base, fecha)).toBeNull());
  it('módulo sin configurar', () => expect(avisoFoto({ ...base, configurado: false }, fecha)).toEqual({ texto: 'Falta configurar Google Drive', destacado: false }));
  it('falló Desk 2.0: lo dice con la fecha de la foto buena', () =>
    expect(avisoFoto({ ...base, ultima: corrida({ id: 2, ok: false, causa: 'desk2: sin conexión' }), ultimaBuena: corrida({ fin: '2026-11-08T11:35:00.000Z' }) }, fecha))
      .toEqual({ texto: 'No se pudo leer Desk 2.0; datos del F(2026-11-08)', destacado: false }));
  it('falló Drive', () => expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: 'drive: HTTP 403' }) }, fecha)?.texto).toMatch(/^No se pudo leer Google Drive; datos del /));
  it('sin foto buena todavía', () => expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: 'drive: HTTP 403' }), ultimaBuena: null }, fecha)?.texto).toBe('No se pudo leer Google Drive; todavía no hay datos'));
  it('con 2 o más corridas programadas fallidas, destacado', () =>
    expect(avisoFoto({ ...base, ultima: corrida({ ok: false, causa: 'desk2: tiempo agotado' }), incidente: { id: 1, abiertoEn: '', fallosProgramados: 2, alertaEnviadaEn: null, alertaUltimoError: null } }, fecha)?.destacado).toBe(true));
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/contrato.test.ts
```

Esperado: FAIL — `Failed to load url ./contrato.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/contrato.ts`:

```ts
/**
 * Contrato de la API de «Equipos en taller» (`/api/equipos-taller`), compartido por
 * el servidor (hub-api) y la pantalla (apps/equipos-taller). Solo tipos y funciones
 * puras: la pantalla lo importa por ruta relativa y el `tsc -b` del portal lo
 * comprueba con su propia configuración, así que aquí no entra nada de Node.
 */
import type { Ajuste, Foto } from './nucleo/tipos.js';

/** Id de la app en `portal.user_apps` y en el JWT. */
export const APP_ID = 'equipos-taller';

export type OrigenCorrida = 'programada' | 'boton';

/** Una fila de `portal.equipos_ejecucion`. */
export interface Corrida {
  id: number;
  origen: OrigenCorrida;
  inicio: string;
  fin: string | null;
  enCurso: boolean;
  /** null mientras corre. */
  ok: boolean | null;
  /** Por qué falló («desk2: …», «drive: …»). Nunca lleva secretos. */
  causa: string | null;
  avisos: string[];
  conteos: Record<string, number> | null;
}

/** El incidente abierto (`portal.equipos_incidente`). */
export interface Incidente {
  id: number;
  abiertoEn: string;
  fallosProgramados: number;
  alertaEnviadaEn: string | null;
  alertaUltimoError: string | null;
}

/** Las llaves de un usuario (`portal.equipos_llaves`). */
export interface LlavesUsuario {
  editaAjustes: boolean;
  recibeAlertas: boolean;
}

/** Lo que puede hacer en la pantalla quien la abre. La pantalla solo oculta botones: el servidor vuelve a comprobarlo. */
export interface PermisosPantalla extends LlavesUsuario {
  esAdmin: boolean;
  /** `edita_ajustes` o admin. */
  puedeEditar: boolean;
}

/** Un ajuste manual con su firma: quién y cuándo. */
export type AjusteFirmado = Ajuste & { usuario: string; creadoEn: string };

/** Respuesta de GET /api/equipos-taller. */
export interface RespuestaEquipos {
  snap: Foto | null;
  ajustes: Record<string, AjusteFirmado>;
  actualizando: boolean;
  /** false si falta la configuración de Google Drive. */
  configurado: boolean;
  ultima: Corrida | null;
  ultimaBuena: Corrida | null;
  incidente: Incidente | null;
  permisos: PermisosPantalla;
}

/** Una fila de GET /api/equipos-taller/llaves. */
export interface UsuarioConLlaves extends LlavesUsuario {
  userId: string;
  nombre: string;
  email: string;
  esAdmin: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

const CLAVE = /^(\*[A-Z0-9]{3,20}|[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}|pdf:[A-Za-z0-9_-]{10,80})$/;
/** Claves de ajuste: «SERIAL|AAAA-MM-DD», «*SERIAL» o «pdf:<idDrive>» (el serial, en clase OCR). */
export const claveValida = (k: string): boolean => CLAVE.test(k);

export const TIPOS_AJUSTE: readonly Ajuste['t'][] = ['in', 'out', 'ret', 'pdf'];

/** ¿Clave válida y tipo que casa con ella? «pdf» solo para «pdf:<id>», y al revés. */
export function ajusteValido(clave: string, t: unknown): t is Ajuste['t'] {
  return claveValida(clave) && TIPOS_AJUSTE.includes(t as Ajuste['t']) && (t === 'pdf') === clave.startsWith('pdf:');
}

export interface AvisoFoto {
  texto: string;
  /** Incidente con 2 o más corridas programadas fallidas. */
  destacado: boolean;
}

/** Qué fuente falló, dicho para la pantalla. */
function queFallo(causa: string | null): string {
  if (causa?.startsWith('desk2:')) return 'No se pudo leer Desk 2.0';
  if (causa?.startsWith('drive:')) return 'No se pudo leer Google Drive';
  return 'No se pudo actualizar la información';
}

/**
 * El aviso de foto vieja de la pantalla (§5.3 del diseño), o null si no hay nada
 * que avisar. `fecha` da formato a un instante ISO (la pantalla usa es-CO).
 */
export function avisoFoto(
  e: Pick<RespuestaEquipos, 'configurado' | 'ultima' | 'ultimaBuena' | 'incidente'>,
  fecha: (iso: string) => string,
): AvisoFoto | null {
  if (!e.configurado) return { texto: 'Falta configurar Google Drive', destacado: false };
  if (!e.ultima || e.ultima.ok !== false) return null;
  const datos = e.ultimaBuena?.fin ? '; datos del ' + fecha(e.ultimaBuena.fin) : '; todavía no hay datos';
  return { texto: queFallo(e.ultima.causa) + datos, destacado: (e.incidente?.fallosProgramados ?? 0) >= 2 };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/contrato.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/contrato.ts apps/hub-api/src/equipos/contrato.test.ts
git commit -m "feat(equipos-taller): contrato de la API y aviso de foto vieja"
```

---

### Task 6: Configuración desde el entorno (TDD) + `.env.example`

**Files:**
- Create: `apps/hub-api/src/equipos/config.ts`, `apps/hub-api/src/equipos/fuente-drive.ts` (solo los tipos de configuración en este paso; el resto en la Tarea 7)
- Test: `apps/hub-api/src/equipos/config.test.ts`
- Modify (⚠️ USUARIO): `apps/hub-api/.env.example`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HORA_POR_DEFECTO, leerConfig, RESERVA_POR_DEFECTO } from './config.js';

// Configuración desde el entorno: qué deja el módulo «sin configurar» y qué se apaga.
// Todo ficticio: ni la clave ni las carpetas son reales.
const SA = JSON.stringify({ client_email: 'sa@ficticio.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----\n' });
const DRIVE = {
  EQUIPOS_GOOGLE_CUENTA_SERVICIO: SA,
  EQUIPOS_DRIVE_ENTRADAS: 'carpetaEntradas01',
  EQUIPOS_DRIVE_SALIDAS_N8N: 'carpetaSalidasN8n1',
  EQUIPOS_DRIVE_SALIDAS_ESCANEADAS: 'carpetaEscaneos01',
  EQUIPOS_DRIVE_TEMPORAL: 'carpetaTemporal01',
};

describe('leerConfig', () => {
  it('con todo lo de Drive queda configurado, con las carpetas en su sitio', () => {
    const c = leerConfig(DRIVE);
    expect(c.faltaDrive).toEqual([]);
    expect(c.drive?.carpetas).toEqual({ entradas: 'carpetaEntradas01', salidasGeneradas: 'carpetaSalidasN8n1', salidasEscaneadas: 'carpetaEscaneos01' });
    expect(c.drive?.carpetaTemporalOcr).toBe('carpetaTemporal01');
    expect(c.drive?.cuentaServicio.client_email).toBe('sa@ficticio.iam.gserviceaccount.com');
  });

  it('sin la cuenta de servicio, o con un JSON que no vale, queda sin configurar y nombra la variable (sin su valor)', () => {
    expect(leerConfig({ ...DRIVE, EQUIPOS_GOOGLE_CUENTA_SERVICIO: undefined })).toMatchObject({ drive: null, faltaDrive: ['EQUIPOS_GOOGLE_CUENTA_SERVICIO'] });
    const mal = leerConfig({ ...DRIVE, EQUIPOS_GOOGLE_CUENTA_SERVICIO: '{"client_email":"x"' });
    expect(mal.drive).toBeNull();
    expect(JSON.stringify(mal)).not.toMatch(/client_email/);
  });

  it('una carpeta que falta o con caracteres raros deja el módulo sin configurar', () => {
    expect(leerConfig({ ...DRIVE, EQUIPOS_DRIVE_TEMPORAL: '' }).faltaDrive).toEqual(['EQUIPOS_DRIVE_TEMPORAL']);
    expect(leerConfig({ ...DRIVE, EQUIPOS_DRIVE_ENTRADAS: "abc' or name contains '" }).faltaDrive).toEqual(['EQUIPOS_DRIVE_ENTRADAS']);
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
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/config.test.ts
```

Esperado: FAIL — `Failed to load url ./config.js`.

- [ ] **Step 3: Implementar**

`config.ts` importa los tipos de `fuente-drive.ts`. Crear `apps/hub-api/src/equipos/fuente-drive.ts` con SOLO sus tipos por ahora (la Tarea 7 lo completa):

```ts
/** Google Drive para «Equipos en taller» (se completa en la Tarea 7). */
export interface CuentaServicioGoogle {
  client_email: string;
  private_key: string;
}
export interface CarpetasDrive {
  entradas: string;
  salidasGeneradas: string;
  salidasEscaneadas: string;
}
export interface ConfigDrive {
  cuentaServicio: CuentaServicioGoogle;
  carpetas: CarpetasDrive;
  /** Carpeta donde se crea (y se borra enseguida) la copia temporal del OCR. */
  carpetaTemporalOcr: string;
}
```

Crear `apps/hub-api/src/equipos/config.ts`:

```ts
/**
 * Configuración de «Equipos en taller» a partir del entorno de hub-api (§7 del
 * diseño). Sin la cuenta de servicio o sin alguna carpeta de Drive, el módulo
 * queda «sin configurar»: la pantalla lo dice y el botón queda desactivado.
 *
 * ⚠️ Lo que se informa de lo que falta son NOMBRES de variables. Nunca un valor:
 * la cuenta de servicio lleva la clave privada y el token de la alerta es un
 * secreto.
 *
 * Las variables se leen una a una por su nombre: así las ve el detector de
 * `.env.example` (env-example.test.ts, INFRA-537).
 */
import type { ConfigDrive, CuentaServicioGoogle } from './fuente-drive.js';

type Entorno = Readonly<Record<string, string | undefined>>;

const entornoDelProceso = (): Entorno => ({
  EQUIPOS_GOOGLE_CUENTA_SERVICIO: process.env.EQUIPOS_GOOGLE_CUENTA_SERVICIO,
  EQUIPOS_DRIVE_ENTRADAS: process.env.EQUIPOS_DRIVE_ENTRADAS,
  EQUIPOS_DRIVE_SALIDAS_N8N: process.env.EQUIPOS_DRIVE_SALIDAS_N8N,
  EQUIPOS_DRIVE_SALIDAS_ESCANEADAS: process.env.EQUIPOS_DRIVE_SALIDAS_ESCANEADAS,
  EQUIPOS_DRIVE_TEMPORAL: process.env.EQUIPOS_DRIVE_TEMPORAL,
  EQUIPOS_HORA_DIARIA: process.env.EQUIPOS_HORA_DIARIA,
  EQUIPOS_ALERTA_WEBHOOK_URL: process.env.EQUIPOS_ALERTA_WEBHOOK_URL,
  EQUIPOS_ALERTA_TOKEN: process.env.EQUIPOS_ALERTA_TOKEN,
  EQUIPOS_ALERTA_RESERVA: process.env.EQUIPOS_ALERTA_RESERVA,
});

export const HORA_POR_DEFECTO = '06:30';
export const RESERVA_POR_DEFECTO = 'comercial@ambientalia.com.co';
/** Solo salen correos a este dominio (la barrera de n8n dice lo mismo). */
export const DOMINIO_ALERTA = '@ambientalia.com.co';

export interface ConfigAlerta {
  url: string;
  token: string;
}

export interface ConfigEquipos {
  /** null = «sin configurar». */
  drive: ConfigDrive | null;
  /** Qué variables faltan o no valen para Drive (solo nombres). */
  faltaDrive: string[];
  /** HH:MM, hora de Colombia. */
  horaDiaria: string;
  /** null = alerta apagada. */
  alerta: ConfigAlerta | null;
  reserva: string;
}

const ID_DRIVE = /^[A-Za-z0-9_-]{10,100}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

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

function cuenta(v: string | undefined): CuentaServicioGoogle | null {
  try {
    const j = JSON.parse(String(v ?? '')) as Partial<CuentaServicioGoogle>;
    return typeof j.client_email === 'string' && typeof j.private_key === 'string' && j.private_key.includes('PRIVATE KEY')
      ? { client_email: j.client_email, private_key: j.private_key }
      : null;
  } catch {
    return null;
  }
}

export function leerConfig(env: Entorno = entornoDelProceso()): ConfigEquipos {
  const faltaDrive: string[] = [];
  const sa = cuenta(env.EQUIPOS_GOOGLE_CUENTA_SERVICIO);
  if (!sa) faltaDrive.push('EQUIPOS_GOOGLE_CUENTA_SERVICIO');
  const carpeta = (nombre: string): string => {
    const v = (env[nombre] ?? '').trim();
    if (!ID_DRIVE.test(v)) faltaDrive.push(nombre);
    return v;
  };
  const entradas = carpeta('EQUIPOS_DRIVE_ENTRADAS');
  const salidasGeneradas = carpeta('EQUIPOS_DRIVE_SALIDAS_N8N');
  const salidasEscaneadas = carpeta('EQUIPOS_DRIVE_SALIDAS_ESCANEADAS');
  const carpetaTemporalOcr = carpeta('EQUIPOS_DRIVE_TEMPORAL');
  const hora = (env.EQUIPOS_HORA_DIARIA ?? '').trim();
  const url = (env.EQUIPOS_ALERTA_WEBHOOK_URL ?? '').trim();
  const token = env.EQUIPOS_ALERTA_TOKEN;
  const reserva = (env.EQUIPOS_ALERTA_RESERVA ?? '').trim().toLowerCase();
  return {
    drive: sa && !faltaDrive.length ? { cuentaServicio: sa, carpetas: { entradas, salidasGeneradas, salidasEscaneadas }, carpetaTemporalOcr } : null,
    faltaDrive,
    horaDiaria: HORA.test(hora) ? hora : HORA_POR_DEFECTO,
    alerta: esUrl(url) && esToken(token) ? { url, token } : null,
    reserva: /^[^\s@]+@ambientalia\.com\.co$/.test(reserva) ? reserva : RESERVA_POR_DEFECTO,
  };
}
```

- [ ] **Step 4: Ver que pasa la prueba propia y que falla el detector de `.env.example`**

```bash
cd apps/hub-api && npx vitest run src/equipos/config.test.ts src/env-example.test.ts
```

Esperado: `config.test.ts` PASS (6 tests). `env-example.test.ts` FAIL en «cada variable del código está en el ejemplo», con exactamente estas 9: `EQUIPOS_ALERTA_RESERVA`, `EQUIPOS_ALERTA_TOKEN`, `EQUIPOS_ALERTA_WEBHOOK_URL`, `EQUIPOS_DRIVE_ENTRADAS`, `EQUIPOS_DRIVE_SALIDAS_ESCANEADAS`, `EQUIPOS_DRIVE_SALIDAS_N8N`, `EQUIPOS_DRIVE_TEMPORAL`, `EQUIPOS_GOOGLE_CUENTA_SERVICIO`, `EQUIPOS_HORA_DIARIA`. (Las otras dos pruebas del detector pasan: las lecturas tienen la forma que entiende.)

- [ ] **Step 5: ⚠️ USUARIO — pegar las variables en `apps/hub-api/.env.example`**

El agente no puede abrir `.env*`. Pedir al usuario que pegue al final de `apps/hub-api/.env.example` este bloque (todo comentado: son nombres, sin valores):

```dotenv
# ─── Equipos en taller (docs/equipos-taller.md) ─────────────────────────────
# JSON de la cuenta de servicio de Google, en una sola línea. Sin ella el módulo queda
# «sin configurar». ⚠️ No cargarla en EasyPanel mientras EasyPanel imprima las variables
# en el log de build (rotación de secretos pendiente).
# EQUIPOS_GOOGLE_CUENTA_SERVICIO=
# IDs de las carpetas de Drive (entradas, salidas generadas por n8n, salidas escaneadas y
# carpeta temporal del OCR). No se escriben en el repo.
# EQUIPOS_DRIVE_ENTRADAS=
# EQUIPOS_DRIVE_SALIDAS_N8N=
# EQUIPOS_DRIVE_SALIDAS_ESCANEADAS=
# EQUIPOS_DRIVE_TEMPORAL=
# Hora de la corrida diaria (HH:MM, hora de Colombia). Por defecto, 06:30.
# EQUIPOS_HORA_DIARIA=06:30
# Webhook de n8n «Equipos · Alerta de foto vieja» y su token (cabecera X-Equipos-Alerta-Token).
# Sin los dos, la alerta queda apagada (se registra en el log).
# EQUIPOS_ALERTA_WEBHOOK_URL=
# EQUIPOS_ALERTA_TOKEN=
# Dirección de reserva si nadie tiene la llave «recibe alertas» (solo @ambientalia.com.co).
# EQUIPOS_ALERTA_RESERVA=comercial@ambientalia.com.co
```

- [ ] **Step 6: Ver que pasa el detector**

```bash
cd apps/hub-api && npx vitest run src/equipos/config.test.ts src/env-example.test.ts
```

Esperado: PASS, los dos ficheros.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/equipos/config.ts apps/hub-api/src/equipos/config.test.ts apps/hub-api/src/equipos/fuente-drive.ts apps/hub-api/.env.example
git commit -m "feat(equipos-taller): configuración desde el entorno; sin Drive, «sin configurar»"
```

(Si el permiso bloquea también el `git add` de `.env.example`, el usuario lo añade a este commit con `git add apps/hub-api/.env.example && git commit --amend --no-edit`.)

---

### Task 7: Fuente de Google Drive (TDD)

**Files:**
- Modify: `apps/hub-api/src/equipos/fuente-drive.ts` (sustituir el contenido entero)
- Test: `apps/hub-api/src/equipos/fuente-drive.test.ts`

Se adapta de `packages/equipos/src/servidor/fuentes-google-zoho.ts`: se quita todo lo de Zoho; los errores pasan a ser `ErrorDrive` con el código HTTP y nada del cuerpo (antes llevaban 160 caracteres de la respuesta); cada petición tiene un tope de 60 s; la pausa entre reintentos es inyectable para las pruebas.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/fuente-drive.test.ts` (la clave RSA se genera en la prueba; carpetas y archivos son inventados):

```ts
import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify, createPublicKey } from 'node:crypto';
import { ErrorDrive, fuenteDrive, motivoDrive, type ConfigDrive } from './fuente-drive.js';

// Google Drive con una API SIMULADA: token JWT de la cuenta de servicio, listado
// paginado, OCR (copia → exportar → borrar la copia) y que los errores no lleven nada
// de la respuesta. Carpetas, archivos y clave: ficticios (la clave se genera aquí).
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const CFG: ConfigDrive = {
  cuentaServicio: { client_email: 'sa@ficticio.iam.gserviceaccount.com', private_key: privateKey },
  carpetas: { entradas: 'CARPETA_ENTRADAS', salidasGeneradas: 'CARPETA_N8N', salidasEscaneadas: 'CARPETA_ESCANEOS' },
  carpetaTemporalOcr: 'CARPETA_TMP',
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

function googleFalso(o: { exportar?: (id: string) => Response; listar?: (q: string, pagina: string | null) => Response } = {}) {
  const copias = new Set<string>();
  const llamadas: string[] = [];
  let nc = 0;
  const f: typeof fetch = async (url, opt = {}) => {
    const u = new URL(String(url));
    const h = (opt.headers || {}) as Record<string, string>;
    llamadas.push((opt.method || 'GET') + ' ' + u.pathname);
    if (u.host === 'oauth2.googleapis.com') {
      const a = new URLSearchParams(String(opt.body)).get('assertion')!.split('.');
      const ok = createVerify('RSA-SHA256').update(a[0] + '.' + a[1]).verify(createPublicKey(privateKey), Buffer.from(a[2], 'base64url'));
      return ok ? J({ access_token: 'g', expires_in: 3600 }) : J({ error: 'firma' }, 400);
    }
    if (h.Authorization !== 'Bearer g') return J({}, 401);
    const m = u.pathname.match(/\/files\/([^/]+)(\/copy|\/export)?$/);
    if (u.pathname.endsWith('/files')) {
      const q = u.searchParams.get('q') || '';
      if (o.listar) return o.listar(q, u.searchParams.get('pageToken'));
      if (/google-apps\.document/.test(q)) return J({ files: [{ id: 'DOC1', name: 'Remisión' }] });
      return J({ files: [{ id: 'S1', name: '261009 - CLIENTE.pdf' }] });
    }
    if (m && m[2] === '/copy') {
      const b = JSON.parse(String(opt.body));
      if (b.mimeType !== 'application/vnd.google-apps.document' || b.parents[0] !== 'CARPETA_TMP') return J({}, 400);
      const id = 'C' + nc++;
      copias.add(id);
      return J({ id });
    }
    if (m && m[2] === '/export') return o.exportar ? o.exportar(m[1]) : new Response(m[1] === 'DOC1' ? '| **TICKET** |' : 'REMISIÓN DE SERVICIO TÉCNICO\n18A90417\n');
    if (m && opt.method === 'DELETE') { copias.delete(m[1]); return new Response(null, { status: 204 }); }
    throw new Error('URL no simulada ' + url);
  };
  return { f, copias, llamadas };
}
const sinPausa = async () => {};

describe('fuenteDrive', () => {
  it('lista con el token de la cuenta de servicio y sigue las páginas', async () => {
    const g = googleFalso({
      listar: (q, pagina) => {
        expect(q).toMatch(/^'CARPETA_ENTRADAS' in parents and trashed = false and mimeType = 'application\/vnd\.google-apps\.folder'$/);
        return pagina ? J({ files: [{ id: 'E2', name: '261002 - CLIENTE B - 18A90002' }] }) : J({ files: [{ id: 'E1', name: '261001 - CLIENTE A - 18A90001' }], nextPageToken: 'p2' });
      },
    });
    expect(await fuenteDrive(CFG, { fetch: g.f }).entradas()).toEqual([{ id: 'E1', title: '261001 - CLIENTE A - 18A90001' }, { id: 'E2', title: '261002 - CLIENTE B - 18A90002' }]);
  });

  it('OCR: copia en la carpeta temporal, exporta el texto y borra la copia', async () => {
    const g = googleFalso();
    expect(await fuenteDrive(CFG, { fetch: g.f }).textoPdf('S1')).toMatch(/18A90417/);
    expect(g.copias.size).toBe(0);
    expect(g.llamadas.filter((l) => l.startsWith('DELETE'))).toHaveLength(1);
  });

  it('si la exportación falla, la copia se borra igual y el error lleva solo el código HTTP', async () => {
    const g = googleFalso({ exportar: () => new Response('detalle interno de Google con datos', { status: 403 }) });
    const e = await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).textoPdf('S1').catch((x) => x);
    expect(e).toBeInstanceOf(ErrorDrive);
    expect(e.message).toBe('Drive HTTP 403');
    expect(g.copias.size).toBe(0);
    expect(motivoDrive(e)).toBe('HTTP 403');
  });

  it('reintenta los 429 y 5xx hasta 3 veces', async () => {
    let n = 0;
    const g = googleFalso({ listar: () => (++n < 3 ? new Response('x', { status: 503 }) : J({ files: [] })) });
    expect(await fuenteDrive(CFG, { fetch: g.f, esperar: sinPausa }).salidasGeneradas()).toEqual([]);
    expect(n).toBe(3);
  });

  it('la remisión de entrada es el Google Doc de la carpeta, en Markdown', async () => {
    const g = googleFalso();
    expect(await fuenteDrive(CFG, { fetch: g.f }).remisionEntrada('E1')).toBe('| **TICKET** |');
  });

  it('un token rechazado es «token rechazado», sin el cuerpo de Google', async () => {
    const malo: typeof fetch = async () => J({ error: 'invalid_grant', error_description: 'cuenta borrada' }, 400);
    const e = await fuenteDrive(CFG, { fetch: malo }).entradas().catch((x) => x);
    expect(motivoDrive(e)).toBe('token rechazado (HTTP 400)');
    expect(String(e.message)).not.toMatch(/cuenta borrada/);
  });

  it('motivoDrive: sin conexión, tiempo agotado o inesperado', () => {
    expect(motivoDrive(new TypeError('fetch failed'))).toBe('sin conexión');
    expect(motivoDrive(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('tiempo agotado');
    expect(motivoDrive(new Error('otra cosa'))).toBe('error inesperado');
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/fuente-drive.test.ts
```

Esperado: FAIL — el módulo solo tiene los tipos de la Tarea 6, así que `fuenteDrive`, `ErrorDrive` y `motivoDrive` no existen (`fuenteDrive is not a function` o `does not provide an export named …`, según cómo lo cargue Vitest).

- [ ] **Step 3: Implementar**

Sustituir el contenido de `apps/hub-api/src/equipos/fuente-drive.ts` por:

```ts
/**
 * Google Drive para «Equipos en taller»: API v3 con una cuenta de servicio, por
 * `fetch` y sin dependencias (D3). Lectura de las tres carpetas y OCR de las
 * remisiones escaneadas: copia temporal como Google Doc (OCR en español),
 * exportación a texto y borrado de la copia. La cuenta solo puede editar en la
 * carpeta temporal.
 *
 * ⚠️ Ni la clave privada, ni el token, ni el cuerpo de una respuesta de Google
 * salen de aquí: los errores son `ErrorDrive` con el código HTTP y nada más, y
 * `motivoDrive` los traduce para la causa de la corrida.
 */
import { createSign } from 'node:crypto';
import type { ArchivoDrive, Fuentes } from './nucleo/tipos.js';

export interface CuentaServicioGoogle {
  client_email: string;
  private_key: string;
}
export interface CarpetasDrive {
  entradas: string;
  salidasGeneradas: string;
  salidasEscaneadas: string;
}
export interface ConfigDrive {
  cuentaServicio: CuentaServicioGoogle;
  carpetas: CarpetasDrive;
  /** Carpeta donde se crea (y se borra enseguida) la copia temporal del OCR. */
  carpetaTemporalOcr: string;
}

/** Lo que el núcleo lee de Drive. */
export type FuenteDrive = Pick<Fuentes, 'entradas' | 'salidasGeneradas' | 'salidasEscaneadas' | 'textoPdf'> & {
  remisionEntrada(carpetaId: string): Promise<string>;
};

/** Un fallo de Drive o del token de Google: solo el código, nunca el cuerpo. */
export class ErrorDrive extends Error {
  readonly status: number;
  readonly enToken: boolean;
  constructor(status: number, enToken = false) {
    super((enToken ? 'Google token HTTP ' : 'Drive HTTP ') + status);
    this.name = 'ErrorDrive';
    this.status = status;
    this.enToken = enToken;
  }
  get reintentar(): boolean {
    return !this.enToken && (this.status === 429 || this.status >= 500);
  }
}

/** Para la causa de una corrida fallida: «drive: <esto>». Sin datos de la respuesta. */
export function motivoDrive(e: unknown): string {
  if (e instanceof ErrorDrive) return e.enToken ? 'token rechazado (HTTP ' + e.status + ')' : 'HTTP ' + e.status;
  const nombre = String((e as { name?: unknown } | null)?.name ?? '');
  if (nombre === 'TimeoutError' || nombre === 'AbortError') return 'tiempo agotado';
  if (e instanceof TypeError) return 'sin conexión';
  return 'error inesperado';
}

/** Cuánto se espera, como mucho, cada petición a Google. */
export const ESPERA_MAX_MS = 60_000;

export interface OpcionesDrive {
  fetch?: typeof fetch;
  /** Pausa entre reintentos (las pruebas pasan una instantánea). */
  esperar?: (ms: number) => Promise<void>;
}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Token de acceso de la cuenta de servicio (JWT RS256), renovado antes de vencer. */
export function tokenGoogle(sa: CuentaServicioGoogle, scopes: string[], f: typeof fetch = fetch): () => Promise<string> {
  let tok = '';
  let exp = 0;
  return async () => {
    if (tok && Date.now() < exp - 60e3) return tok;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: scopes.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sig = createSign('RSA-SHA256').update(body).sign(sa.private_key).toString('base64url');
    const r = await f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: body + '.' + sig }),
      signal: AbortSignal.timeout(ESPERA_MAX_MS),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) throw new ErrorDrive(r.status, true);
    tok = j.access_token;
    exp = Date.now() + (j.expires_in || 3600) * 1000;
    return tok;
  };
}

export function fuenteDrive(cfg: ConfigDrive, o: OpcionesDrive = {}): FuenteDrive {
  const f = o.fetch || fetch;
  const esperar = o.esperar || pausa;
  const gtok = tokenGoogle(cfg.cuentaServicio, ['https://www.googleapis.com/auth/drive'], f);
  const D = 'https://www.googleapis.com/drive/v3';
  const comunes = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives' };

  async function conReintento<T>(fn: () => Promise<T>, n = 3): Promise<T> {
    let e: unknown;
    for (let i = 0; i < n; i++) {
      try {
        return await fn();
      } catch (x) {
        e = x;
        if (!(x instanceof ErrorDrive && x.reintentar)) break;
        if (i < n - 1) await esperar(1500 * (i + 1));
      }
    }
    throw e;
  }
  const gget = (url: string, opt: RequestInit = {}) =>
    conReintento(async () => {
      const r = await f(url, {
        ...opt,
        headers: { Authorization: 'Bearer ' + (await gtok()), ...(opt.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(ESPERA_MAX_MS),
      });
      if (!r.ok) {
        await r.body?.cancel().catch(() => undefined);
        throw new ErrorDrive(r.status);
      }
      return r;
    });

  async function listar(parent: string, soloCarpetas: boolean): Promise<ArchivoDrive[]> {
    const out: ArchivoDrive[] = [];
    let tok = '';
    const q = "'" + parent + "' in parents and trashed = false and " +
      (soloCarpetas ? "mimeType = 'application/vnd.google-apps.folder'" : "(mimeType = 'application/pdf' or mimeType contains 'image/')");
    do {
      const u = D + '/files?' + new URLSearchParams({ q, pageSize: '1000', fields: 'nextPageToken,files(id,name)', ...comunes, ...(tok ? { pageToken: tok } : {}) });
      const j = (await (await gget(u)).json()) as { files?: { id: string; name: string }[]; nextPageToken?: string };
      (j.files || []).forEach((x) => out.push({ id: x.id, title: x.name }));
      tok = j.nextPageToken || '';
    } while (tok);
    return out;
  }

  /** Texto OCR: copia temporal como Google Doc (OCR en español), exportación a texto y borrado de la copia. */
  async function textoPdf(id: string): Promise<string> {
    const c = (await (await gget(D + '/files/' + encodeURIComponent(id) + '/copy?' + new URLSearchParams({ supportsAllDrives: 'true', ocrLanguage: 'es', fields: 'id' }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: 'ocr-tmp-' + id, parents: [cfg.carpetaTemporalOcr] }),
    })).json()) as { id: string };
    try {
      return await (await gget(D + '/files/' + encodeURIComponent(c.id) + '/export?mimeType=text/plain')).text();
    } finally {
      await gget(D + '/files/' + encodeURIComponent(c.id) + '?supportsAllDrives=true', { method: 'DELETE' }).catch(() => undefined);
    }
  }

  return {
    entradas: () => listar(cfg.carpetas.entradas, true),
    salidasGeneradas: () => listar(cfg.carpetas.salidasGeneradas, true),
    salidasEscaneadas: () => listar(cfg.carpetas.salidasEscaneadas, false),
    textoPdf,
    /** Remisión de entrada: el Google Doc de la carpeta, exportado como Markdown (conserva la tabla). */
    remisionEntrada: async (folder) => {
      const q = "'" + folder + "' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'";
      const j = (await (await gget(D + '/files?' + new URLSearchParams({ q, pageSize: '5', fields: 'files(id,name)', ...comunes }))).json()) as { files?: { id: string }[] };
      const d = j.files?.[0];
      if (!d) return '';
      return (await gget(D + '/files/' + encodeURIComponent(d.id) + '/export?mimeType=' + encodeURIComponent('text/markdown'))).text();
    },
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/fuente-drive.test.ts src/equipos/config.test.ts
```

Esperado: PASS (7 + 6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/fuente-drive.ts apps/hub-api/src/equipos/fuente-drive.test.ts
git commit -m "feat(equipos-taller): fuente de Google Drive con cuenta de servicio, sin datos en los errores"
```

---

### Task 8: Fuente de Desk 2.0 con una base falsa (TDD)

**Files:**
- Create: `apps/hub-api/src/equipos/fuente-desk2.ts`
- Test: `apps/hub-api/src/equipos/fuente-desk2.test.ts`

Sustituye al espejo de hub-sync y a la API de Zoho (D4). Supuestos A4, A5 y A6.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/fuente-desk2.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fuenteDesk2, motivoDesk2, SinDesk2 } from './fuente-desk2.js';
import { Reglas } from './nucleo/index.js';
import type { DbLectura } from '../trazabilidad/fuente.js';

// La fuente de Desk 2.0 con una base FALSA: qué SQL lanza, cómo traduce las filas a la
// forma de la API de Zoho que espera el núcleo y que un fallo sube sin respaldo. El SQL
// contra Postgres de verdad: fuente-desk2.db.test.ts. Todo ficticio.
function baseFalsa(responder: (sql: string, p: unknown[]) => Record<string, unknown>[]) {
  const consultas: { sql: string; p: unknown[] }[] = [];
  const db: DbLectura = { query: async (sql, p = []) => { consultas.push({ sql, p }); return { rows: responder(sql, p) }; } };
  return { db, consultas };
}
const FILA = {
  id: '900000000000000001',
  number: 1401,
  serial: '18A90417',
  tipo_servicio: 'Calibración',
  fecha_remision_entrada: '2026-10-30',
  subject: 'Servicio técnico Cliente Ficticio EDM180C 18A90417',
  status: 'Rev./Diagnostico',
  status_type: 'Open',
  created_time: new Date('2026-10-30T14:00:00.000Z'),
  raw: {
    webUrl: 'https://desk.example/agent/x/dv/900000000000000001',
    modifiedTime: '2026-11-02T10:00:00.000Z',
    closedTime: null,
    cf: { cf_serial: '18A90417', cf_fecha_remision_de_salida: '2026-11-05', cf_encargado: 'Técnico Uno', cf_equipo_1: 'EDM180C' },
  },
};

describe('tickets(serial)', () => {
  it('trae los cf_* de raw y el número, estado y asunto de las columnas, con la forma de Zoho', async () => {
    const { db, consultas } = baseFalsa(() => [FILA]);
    const [t] = await fuenteDesk2(() => db).tickets('18A90417');
    expect(consultas[0].sql).toMatch(/FROM desk\.tickets t/);
    expect(consultas[0].sql).toMatch(/LIMIT 10/);
    expect(consultas[0].p).toEqual(['18A90417']);
    expect(t).toMatchObject({ ticketNumber: '1401', status: 'Rev./Diagnostico', statusType: 'Open', createdTime: '2026-10-30T14:00:00.000Z', modifiedTime: '2026-11-02T10:00:00.000Z' });
    const z = Reglas.tnorm(t);
    expect([z.n, z.id, z.fs, z.enc, z.eq, z.fe]).toEqual(['1401', '900000000000000001', '2026-11-05', 'Técnico Uno', 'EDM180C', '2026-10-30']);
    expect(z.tk).toContain(Reglas.cls('18A90417'));
  });

  it('un ticket sin raw.cf (no releído al detalle) se completa con las columnas promovidas', async () => {
    const { db } = baseFalsa(() => [{ ...FILA, raw: { webUrl: '' } }]);
    const z = Reglas.tnorm((await fuenteDesk2(() => db).tickets('18A90417'))[0]);
    expect([z.fe, z.srv, z.tk.includes(Reglas.cls('18A90417'))]).toEqual(['2026-10-30', 'Calibración', true]);
  });

  it('escapa los comodines de ILIKE y no consulta con un serial vacío', async () => {
    const { db, consultas } = baseFalsa(() => []);
    const f = fuenteDesk2(() => db);
    await f.tickets('18A_9%');
    expect(consultas[0].p).toEqual(['18A\\_9\\%']);
    expect(await f.tickets('  ')).toEqual([]);
    expect(consultas).toHaveLength(1);
  });
});

describe('ticketNumero', () => {
  it('busca por número exacto y rechaza lo que no es un número', async () => {
    const { db, consultas } = baseFalsa(() => [FILA]);
    const f = fuenteDesk2(() => db);
    expect((await f.ticketNumero('1401'))[0].ticketNumber).toBe('1401');
    expect(consultas[0].p).toEqual(['1401']);
    expect(await f.ticketNumero('14; DROP')).toEqual([]);
    expect(consultas).toHaveLength(1);
  });
});

describe('comentarios', () => {
  it('lee los comentarios de la fila del ticket (aunque el núcleo lo nombre por el id de su URL) con la forma de Zoho', async () => {
    const { db, consultas } = baseFalsa((sql) =>
      sql.includes('desk.conversations')
        ? [{ ticket_id: 'fila-7', kind: 'comment', content: '<p>Equipo recogido por el cliente</p>', commented_time: new Date('2026-11-06T15:00:00.000Z'), raw: { attachments: [{ name: '261106 - CLIENTE.pdf' }, { otro: 1 }] } }]
        : [{ ...FILA, id: 'fila-7', raw: { ...FILA.raw, webUrl: 'https://desk.example/agent/x/dv/555' } }],
    );
    const f = fuenteDesk2(() => db);
    const z = Reglas.tnorm((await f.tickets('18A90417'))[0]);
    expect(z.id).toBe('555');
    const c = await f.comentarios(z.id);
    expect(consultas[1].sql).toMatch(/c\.kind = 'comment'/);
    expect(consultas[1].sql).toMatch(/LIMIT 15/);
    expect(consultas[1].p).toEqual(['fila-7']);
    expect(c).toEqual([{ commentedTime: '2026-11-06T15:00:00.000Z', content: '<p>Equipo recogido por el cliente</p>', attachments: [{ name: '261106 - CLIENTE.pdf' }] }]);
    expect(Reglas.cmtList(c)).toHaveLength(1);
  });
});

describe('sonda y fallos', () => {
  it('la sonda nombra tickets y comentarios y cuenta los tickets con raw.cf', async () => {
    const { db, consultas } = baseFalsa(() => [{ total: 12, con_cf: 9 }]);
    expect(await fuenteDesk2(() => db).sonda()).toEqual({ total: 12, conCf: 9 });
    expect(consultas[0].sql).toMatch(/desk\.conversations c WHERE false/);
    expect(consultas[0].sql).toMatch(/desk\.tickets t WHERE false/);
  });

  it('sin DESK2_DB_URL lanza SinDesk2 («sin configurar»)', async () => {
    await expect(fuenteDesk2(() => null).sonda()).rejects.toBeInstanceOf(SinDesk2);
    expect(motivoDesk2(new SinDesk2())).toBe('sin configurar');
  });

  it('un error de la base sube tal cual, sin respaldo, y su motivo no lleva el mensaje de pg', async () => {
    const e = Object.assign(new Error('permission denied for table conversations (host secreto.internal)'), { code: '42501' });
    const db: DbLectura = { query: async () => { throw e; } };
    await expect(fuenteDesk2(() => db).tickets('18A90417')).rejects.toBe(e);
    expect(motivoDesk2(e)).toBe('consulta rechazada (permisos o esquema)');
    expect(motivoDesk2(Object.assign(new Error('x'), { code: '57014' }))).toBe('tiempo agotado');
    expect(motivoDesk2(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }))).toBe('sin conexión');
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/fuente-desk2.test.ts
```

Esperado: FAIL — `Failed to load url ./fuente-desk2.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/fuente-desk2.ts`:

```ts
/**
 * Tickets y comentarios de «Equipos en taller», leídos de la base de Desk 2.0
 * (D4): `desk.tickets` y `desk.conversations`, por la conexión de sólo lectura de
 * db-desk2.ts (`DESK2_DB_URL`, rol `portal_agenda_reader`). No se usa la API de
 * Zoho. Sin respaldo (D5): si algo falla, el error sube tal cual y la corrida
 * termina fallida; para la causa, `motivoDesk2`, que nunca lleva el mensaje de
 * `pg` (puede arrastrar el host).
 *
 * El núcleo espera la forma de la API de Zoho (`TicketZoho`, `ComentarioZoho`):
 *   · el ticket sale de `raw` (la respuesta de Zoho que guarda Desk 2.0), con
 *     número, estado, tipo de estado y asunto de las COLUMNAS (Desk 2.0 los
 *     mantiene al día también en los tickets gestionados desde la app);
 *   · los `cf_*` salen de `raw->'cf'`. Ese objeto solo lo traen los tickets que
 *     Desk 2.0 ha releído al detalle (ver calibraciones-desk2.ts): lo que falte se
 *     completa con las columnas promovidas (`serial`, `tipo_servicio`,
 *     `fecha_remision_entrada`), y la sonda cuenta cuántos tickets no lo traen;
 *   · el id que usa el núcleo es el de la URL del ticket (`dv/<id>`) o el de la
 *     fila: aquí se recuerda a qué fila corresponde para leer sus comentarios.
 */
import { clasificarFallo, type DbLectura } from '../trazabilidad/fuente.js';
import type { ComentarioZoho, TicketZoho } from './nucleo/tipos.js';

/** Sin `DESK2_DB_URL`: todas las corridas fallan con «desk2: sin configurar». */
export class SinDesk2 extends Error {
  constructor() {
    super('Desk 2.0 sin configurar');
    this.name = 'SinDesk2';
  }
}

/** Para la causa de una corrida fallida: «desk2: <esto>». */
export function motivoDesk2(e: unknown): string {
  if (e instanceof SinDesk2) return 'sin configurar';
  const m = clasificarFallo(e);
  return m === 'timeout' ? 'tiempo agotado' : m === 'error_consulta' ? 'consulta rechazada (permisos o esquema)' : 'sin conexión';
}

export interface SondaDesk2 {
  /** Tickets en la tabla. */
  total: number;
  /** Cuántos traen `raw->'cf'`. */
  conCf: number;
}

export interface FuenteDesk2 {
  /** Comprueba tablas, columnas y permisos de todo lo que se va a leer, sin traer filas de comentarios. */
  sonda(): Promise<SondaDesk2>;
  tickets(serial: string): Promise<TicketZoho[]>;
  ticketNumero(n: string): Promise<TicketZoho[]>;
  comentarios(ticketId: string): Promise<ComentarioZoho[]>;
}

const COLUMNAS = `t.id, t.number, t.serial, t.tipo_servicio, t.fecha_remision_entrada::text AS fecha_remision_entrada,
       t.subject, t.status, t.status_type, t.created_time, t.raw`;
const COLUMNAS_COMENTARIO = 'c.ticket_id, c.kind, c.content, c.commented_time, c.raw';
/** Como la búsqueda de Zoho por serial: los 10 más recientes. */
export const LIMITE_TICKETS = 10;
/** Como la página de Claude (la API de Zoho con `limit=15`): los 15 comentarios más recientes. */
export const LIMITE_COMENTARIOS = 15;

const esObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));
const instante = (v: unknown): string | undefined => (v instanceof Date ? v.toISOString() : texto(v));
/** Escapa los comodines de ILIKE. */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

export function fuenteDesk2(desk2: () => DbLectura | null): FuenteDesk2 {
  /** Id que usa el núcleo → id de la fila en desk.tickets. */
  const filas = new Map<string, string>();
  const db = (): DbLectura => {
    const d = desk2();
    if (!d) throw new SinDesk2();
    return d;
  };

  function aZoho(r: Record<string, unknown>): TicketZoho {
    const raw = esObj(r.raw) ? r.raw : {};
    const cf: Record<string, string | null | undefined> = esObj(raw.cf) ? { ...(raw.cf as Record<string, string | null>) } : {};
    cf.cf_serial ??= texto(r.serial);
    cf.cf_tipo_de_servicio ??= texto(r.tipo_servicio);
    cf.cf_fecha_remision_entreda ??= texto(r.fecha_remision_entrada);
    const id = String(r.id);
    const webUrl = texto(raw.webUrl) ?? '';
    filas.set((webUrl.match(/dv\/(\d+)/) || [])[1] || id, id);
    return {
      id,
      ticketNumber: String(r.number),
      status: texto(r.status) ?? texto(raw.status),
      statusType: texto(r.status_type) ?? texto(raw.statusType),
      createdTime: texto(raw.createdTime) ?? instante(r.created_time),
      closedTime: texto(raw.closedTime) ?? null,
      modifiedTime: texto(raw.modifiedTime) ?? '',
      subject: texto(r.subject) ?? texto(raw.subject),
      webUrl,
      cf,
    };
  }

  return {
    async sonda() {
      const { rows } = await db().query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE jsonb_typeof(t.raw->'cf') = 'object')::int AS con_cf,
                (SELECT count(*) FROM (SELECT ${COLUMNAS} FROM desk.tickets t WHERE false) s)::int AS sonda_tickets,
                (SELECT count(*) FROM (SELECT ${COLUMNAS_COMENTARIO} FROM desk.conversations c WHERE false) s)::int AS sonda_comentarios
           FROM desk.tickets t`,
      );
      return { total: Number(rows[0]?.total ?? 0), conCf: Number(rows[0]?.con_cf ?? 0) };
    },
    async tickets(serial) {
      const s = String(serial).trim();
      if (!s) return [];
      const { rows } = await db().query(
        `SELECT ${COLUMNAS}
           FROM desk.tickets t
          WHERE concat_ws(' ', t.serial, t.subject, (t.raw->'cf')::text, t.raw->>'subject') ILIKE '%' || $1 || '%'
          ORDER BY t.created_time DESC NULLS LAST, t.number DESC
          LIMIT ${LIMITE_TICKETS}`,
        [literal(s)],
      );
      return rows.map(aZoho);
    },
    async ticketNumero(n) {
      if (!/^\d{1,9}$/.test(String(n))) return [];
      const { rows } = await db().query(`SELECT ${COLUMNAS} FROM desk.tickets t WHERE t.number = $1::int LIMIT 1`, [String(n)]);
      return rows.map(aZoho);
    },
    async comentarios(ticketId) {
      const { rows } = await db().query(
        `SELECT ${COLUMNAS_COMENTARIO}
           FROM desk.conversations c
          WHERE c.ticket_id = $1 AND c.kind = 'comment'
          ORDER BY c.commented_time DESC
          LIMIT ${LIMITE_COMENTARIOS}`,
        [filas.get(ticketId) ?? ticketId],
      );
      return rows
        .map((c): ComentarioZoho => {
          const raw = esObj(c.raw) ? c.raw : {};
          const adj = Array.isArray(raw.attachments) ? raw.attachments : [];
          return {
            commentedTime: instante(c.commented_time) ?? '',
            content: String(c.content ?? ''),
            attachments: adj.filter((a) => esObj(a) && typeof a.name === 'string').map((a) => ({ name: String((a as { name: string }).name) })),
          };
        })
        .filter((c) => c.commentedTime);
    },
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/fuente-desk2.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/fuente-desk2.ts apps/hub-api/src/equipos/fuente-desk2.test.ts
git commit -m "feat(equipos-taller): tickets y comentarios desde la base de Desk 2.0, sin respaldo"
```

---

### Task 9: Fuente de Desk 2.0 contra Postgres

**Files:**
- Modify: `apps/hub-api/src/test-db/harness.ts` (`asegurarDesk2`, líneas 140-142)
- Test: `apps/hub-api/src/equipos/fuente-desk2.db.test.ts`

La imitación de Desk 2.0 del harness no tiene `desk.conversations`. Se añade con el `GRANT` que Gerencia tiene que dar en producción (§9.1): así esta prueba falla igual que fallaría allí sin él.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/fuente-desk2.db.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { asegurarDesk2, poolDePrueba } from '../test-db/harness.js';
import { crearPoolDesk2 } from '../db-desk2.js';
import { fuenteDesk2, motivoDesk2 } from './fuente-desk2.js';
import { Reglas } from './nucleo/index.js';

// El SQL de la fuente de Desk 2.0 contra una imitación de su base (harness.asegurarDesk2),
// leída con un rol de solo lectura como portal_agenda_reader. Todo ficticio.
let hub: Pool;
let admin: Pool;
let lector: Pool;
/** El rol de solo lectura de la imitación (el `portal_agenda_reader` de producción). */
let rolLector: string;

beforeAll(async () => {
  hub = poolDePrueba();
  const urls = await asegurarDesk2(hub);
  admin = createPoolFromUrl(urls.urlAdmin);
  lector = crearPoolDesk2(urls.urlLector);
  rolLector = new URL(urls.urlLector).username;
});
afterAll(async () => {
  await lector.end();
  await admin.end();
  await hub.end();
});
beforeEach(async () => {
  await admin.query('TRUNCATE desk.tickets, desk.conversations');
  await admin.query(
    `INSERT INTO desk.tickets (id, number, status, status_type, created_time, tipo_servicio, fecha_remision_entrada, subject, serial, raw) VALUES
       ('900000000000000001', 1401, 'Rev./Diagnostico', 'Open', '2026-10-30T14:00:00Z', 'Calibración', '2026-10-30',
        'Servicio técnico Cliente Ficticio EDM180C', '18A90417',
        '{"webUrl":"https://desk.example/agent/x/dv/900000000000000001","modifiedTime":"2026-11-02T10:00:00Z","cf":{"cf_serial":"18A90417","cf_fecha_remision_de_salida":"2026-11-05"}}'),
       ('app-5c1d', 1402, 'En taller', 'Open', '2026-11-03T09:00:00Z', 'Mantenimiento', NULL,
        'Equipo 18A90999 de otro cliente ficticio', '18A90999', NULL)`,
  );
  await admin.query(
    `INSERT INTO desk.conversations (ticket_id, kind, author_name, author_type, is_public, content, content_type, commented_time, raw) VALUES
       ('900000000000000001', 'comment', 'Técnico Uno', 'AGENT', false, 'Equipo recogido por el cliente', 'plainText', '2026-11-06T15:00:00Z', '{"attachments":[{"name":"261106 - CLIENTE.pdf"}]}'),
       ('900000000000000001', 'thread', 'Cliente', 'END_USER', true, 'Hola, ¿ya está?', 'plainText', '2026-11-05T15:00:00Z', NULL)`,
  );
});

describe('fuenteDesk2 contra Postgres', () => {
  it('la sonda pasa con el rol lector y cuenta los tickets con raw.cf', async () => {
    expect(await fuenteDesk2(() => lector).sonda()).toEqual({ total: 2, conCf: 1 });
  });

  it('busca por el serial en las columnas y en raw.cf, del más reciente al más antiguo', async () => {
    const f = fuenteDesk2(() => lector);
    const [t] = await f.tickets('18A90417');
    const z = Reglas.tnorm(t);
    expect([z.n, z.st, z.fs, z.fe]).toEqual(['1401', 'Rev./Diagnostico', '2026-11-05', '2026-10-30']);
    const [app] = await f.tickets('18A90999');
    expect(Reglas.tnorm(app)).toMatchObject({ n: '1402', id: 'app-5c1d', srv: 'Mantenimiento' });
    expect(await f.tickets('18A00000')).toEqual([]);
  });

  it('el número exacto y los comentarios (solo los «comment»)', async () => {
    const f = fuenteDesk2(() => lector);
    const z = Reglas.tnorm((await f.ticketNumero('1401'))[0]);
    const c = await f.comentarios(z.id);
    expect(c).toEqual([{ commentedTime: '2026-11-06T15:00:00.000Z', content: 'Equipo recogido por el cliente', attachments: [{ name: '261106 - CLIENTE.pdf' }] }]);
  });

  it('sin el permiso sobre desk.conversations la sonda falla, con un motivo sin el mensaje de pg', async () => {
    await admin.query(`REVOKE SELECT ON desk.conversations FROM ${rolLector}`);
    try {
      const e = await fuenteDesk2(() => lector).sonda().catch((x) => x);
      expect(e.code).toBe('42501');
      expect(motivoDesk2(e)).toBe('consulta rechazada (permisos o esquema)');
    } finally {
      await admin.query(`GRANT SELECT ON desk.conversations TO ${rolLector}`);
    }
  });
});
```

- [ ] **Step 2: Ver que falla** (Docker Desktop encendido)

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/fuente-desk2.db.test.ts
```

Esperado: FAIL en el `beforeEach` — `relation "desk.conversations" does not exist`.

- [ ] **Step 3: Añadir la tabla y su permiso a la imitación (herramienta Edit)**

En `apps/hub-api/src/test-db/harness.ts`, dentro de `asegurarDesk2`, sustituir:

```ts
      GRANT USAGE ON SCHEMA desk, public TO ${ROL};
      GRANT SELECT ON desk.tickets, desk.ticket_transitions, public.calendario_cierres TO ${ROL};
```

por:

```ts
      CREATE TABLE IF NOT EXISTS desk.conversations (
        id             bigserial PRIMARY KEY,
        ticket_id      text NOT NULL,
        kind           text NOT NULL,
        author_name    text,
        author_type    text,
        is_public      boolean,
        content        text,
        content_type   text,
        commented_time timestamptz,
        raw            jsonb
      );
      GRANT USAGE ON SCHEMA desk, public TO ${ROL};
      GRANT SELECT ON desk.tickets, desk.ticket_transitions, public.calendario_cierres, desk.conversations TO ${ROL};
```

Y en el JSDoc de `asegurarDesk2` (encima de la función), tras el párrafo de `desk.tickets`, añadir:

```ts
 * `desk.conversations` (Equipos en taller) va con SELECT, como el que Gerencia concede a
 * `portal_agenda_reader` en producción (§9.1 del diseño de equipos-taller).
 *
```

- [ ] **Step 4: Ver que pasa, y que no se rompen las otras pruebas que usan la imitación**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/fuente-desk2.db.test.ts src/trazabilidad/fuente.db.test.ts
```

Esperado: PASS (4 + 15 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/test-db/harness.ts apps/hub-api/src/equipos/fuente-desk2.db.test.ts
git commit -m "test(equipos-taller): la fuente de Desk 2.0 contra Postgres, con desk.conversations en la imitación"
```

---

### Task 10: Decisión de incidente (TDD, puro)

**Files:**
- Create: `apps/hub-api/src/equipos/incidente.ts`
- Test: `apps/hub-api/src/equipos/incidente.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/incidente.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decidirIncidente, FALLOS_PARA_AVISAR } from './incidente.js';

// Cuándo se abre, cuenta, avisa y cierra un incidente (§5.2). Puro: sin base ni red.
const abierto = (fallosProgramados: number, alertaEnviadaEn: string | null = null) => ({ fallosProgramados, alertaEnviadaEn });

describe('decidirIncidente', () => {
  it('avisa al llegar a 2 corridas programadas fallidas', () => expect(FALLOS_PARA_AVISAR).toBe(2));

  it('una corrida buena sin incidente no hace nada', () =>
    expect(decidirIncidente({ origen: 'programada', ok: true }, null)).toEqual({ accion: 'nada', fallosProgramados: 0, enviarAlerta: false }));

  it('1 fallo programado abre el incidente y no avisa', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, null)).toEqual({ accion: 'abrir', fallosProgramados: 1, enviarAlerta: false }));

  it('el 2.º fallo programado seguido avisa', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(1))).toEqual({ accion: 'contar', fallosProgramados: 2, enviarAlerta: true }));

  it('las corridas del botón no cuentan ni avisan, pero sí abren', () => {
    expect(decidirIncidente({ origen: 'boton', ok: false }, null)).toEqual({ accion: 'abrir', fallosProgramados: 0, enviarAlerta: false });
    expect(decidirIncidente({ origen: 'boton', ok: false }, abierto(1))).toEqual({ accion: 'contar', fallosProgramados: 1, enviarAlerta: false });
  });

  it('se avisa una sola vez por incidente', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(2, '2026-11-10T11:30:00.000Z'))).toEqual({ accion: 'contar', fallosProgramados: 3, enviarAlerta: false }));

  it('si el webhook falló (sin alerta_enviada_en), la siguiente programada fallida lo reintenta', () =>
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(2))).toEqual({ accion: 'contar', fallosProgramados: 3, enviarAlerta: true }));

  it('una corrida buena cierra el incidente, sea programada o del botón', () => {
    expect(decidirIncidente({ origen: 'boton', ok: true }, abierto(3, '2026-11-10T11:30:00.000Z')).accion).toBe('cerrar');
    expect(decidirIncidente({ origen: 'programada', ok: true }, abierto(1)).accion).toBe('cerrar');
  });

  it('tras cerrarse, un fallo nuevo abre otro incidente desde cero y puede volver a avisar', () => {
    expect(decidirIncidente({ origen: 'programada', ok: false }, null)).toEqual({ accion: 'abrir', fallosProgramados: 1, enviarAlerta: false });
    expect(decidirIncidente({ origen: 'programada', ok: false }, abierto(1)).enviarAlerta).toBe(true);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/incidente.test.ts
```

Esperado: FAIL — `Failed to load url ./incidente.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/incidente.ts`:

```ts
/**
 * Incidentes de «Equipos en taller» (§5.2 del diseño): decisión PURA, sin base ni
 * red. Recibe cómo terminó la corrida y el incidente abierto (si lo hay) y dice qué
 * hacer; repo.ts lo escribe y servicio.ts envía la alerta.
 *
 *   · Abrir: la primera corrida fallida después de una buena.
 *   · Contar: solo las corridas PROGRAMADAS suman a `fallosProgramados`.
 *   · Avisar: al llegar a 2 sin alerta enviada. Si el envío falla, la siguiente
 *     programada fallida del mismo incidente lo vuelve a intentar.
 *   · Cerrar: una corrida buena. Si después vuelve a fallar, es un incidente nuevo.
 */
import type { Incidente, OrigenCorrida } from './contrato.js';

/** Corridas programadas fallidas seguidas que disparan la alerta (D6). */
export const FALLOS_PARA_AVISAR = 2;

export interface DecisionIncidente {
  accion: 'nada' | 'abrir' | 'contar' | 'cerrar';
  /** Lo que queda en `fallos_programados` (al abrir o contar). */
  fallosProgramados: number;
  enviarAlerta: boolean;
}

export function decidirIncidente(
  corrida: { origen: OrigenCorrida; ok: boolean },
  abierto: Pick<Incidente, 'fallosProgramados' | 'alertaEnviadaEn'> | null,
): DecisionIncidente {
  if (corrida.ok) {
    return abierto
      ? { accion: 'cerrar', fallosProgramados: abierto.fallosProgramados, enviarAlerta: false }
      : { accion: 'nada', fallosProgramados: 0, enviarAlerta: false };
  }
  const programada = corrida.origen === 'programada';
  const fallos = (abierto?.fallosProgramados ?? 0) + (programada ? 1 : 0);
  return {
    accion: abierto ? 'contar' : 'abrir',
    fallosProgramados: fallos,
    enviarAlerta: programada && fallos >= FALLOS_PARA_AVISAR && !abierto?.alertaEnviadaEn,
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/incidente.test.ts
```

Esperado: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/incidente.ts apps/hub-api/src/equipos/incidente.test.ts
git commit -m "feat(equipos-taller): decisión pura de incidentes (una alerta por incidente)"
```

---

### Task 11: Alerta por el webhook de n8n (TDD)

**Files:**
- Create: `apps/hub-api/src/equipos/alerta.ts`
- Test: `apps/hub-api/src/equipos/alerta.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/alerta.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { CABECERA_TOKEN, correoAlerta, crearCanalAlerta, destinatarios } from './alerta.js';

// El correo de alerta por el webhook de n8n: contrato de la petición, clasificación de
// la respuesta y que el token no salga nunca. Sin red: `red` es un doble.
const CFG = { url: 'https://n8n.example/webhook/equipos-alerta', token: 'tok-secreto-1' };
const CORREO = { para: ['jefe@ambientalia.com.co'], asunto: 'a', cuerpo: 'c' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

describe('destinatarios', () => {
  it('solo el dominio, sin repetir y en minúsculas', () =>
    expect(destinatarios(['B@ambientalia.com.co', 'b@ambientalia.com.co', 'x@otro.com', 'a@ambientalia.com.co'], 'r@ambientalia.com.co')).toEqual(['a@ambientalia.com.co', 'b@ambientalia.com.co']));
  it('sin ninguno, la dirección de reserva', () => expect(destinatarios(['x@otro.com'], 'comercial@ambientalia.com.co')).toEqual(['comercial@ambientalia.com.co']));
});

describe('correoAlerta', () => {
  it('dice la causa, los fallos y desde cuándo está vieja la foto', () => {
    const c = correoAlerta({ causa: 'drive: HTTP 403', fallosProgramados: 2, fotoBuena: '2026-11-08T11:35:00.000Z' });
    expect(c.asunto).toMatch(/^Equipos en taller: la información no se actualiza desde el /);
    expect(c.cuerpo).toMatch(/ha fallado 2 veces seguidas/);
    expect(c.cuerpo).toMatch(/drive: HTTP 403/);
  });
  it('sin foto buena todavía, lo dice', () => expect(correoAlerta({ causa: 'desk2: sin conexión', fallosProgramados: 2, fotoBuena: null }).cuerpo).toMatch(/Todavía no hay ninguna foto buena/));
});

describe('crearCanalAlerta', () => {
  it('sin configuración queda apagado, lo registra y no llama a la red', async () => {
    const red = vi.fn();
    const log = vi.fn();
    const c = crearCanalAlerta(null, red, log);
    expect(c.encendido).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/alerta apagada/));
    expect(await c.enviar(CORREO, 1)).toEqual({ ok: false, error: expect.stringMatching(/apagada/) });
    expect(red).not.toHaveBeenCalled();
  });

  it('envía POST JSON con el token en su cabecera, sin seguir redirecciones', async () => {
    const red = vi.fn(async () => json({ ok: true }));
    expect(await crearCanalAlerta(CFG, red).enviar(CORREO, 7)).toEqual({ ok: true });
    const [url, init] = red.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CFG.url);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>)[CABECERA_TOKEN]).toBe(CFG.token);
    expect(JSON.parse(String(init.body))).toEqual({ referencia: 7, para: CORREO.para, asunto: 'a', cuerpo: 'c' });
  });

  it('un 2xx sin { ok: true } no cuenta como enviado', async () =>
    expect(await crearCanalAlerta(CFG, async () => json({})).enviar(CORREO, 1)).toEqual({ ok: false, error: 'n8n respondió 200' }));

  it('el error de n8n se guarda sin el token y cortado', async () => {
    const r = await crearCanalAlerta(CFG, async () => json({ ok: false, error: 'destino fuera del dominio; token tok-secreto-1' }, 422)).enviar(CORREO, 1);
    expect(r).toEqual({ ok: false, error: 'n8n respondió 422: destino fuera del dominio; token [token]' });
  });

  it('sin conexión o sin respuesta a tiempo, un error claro', async () => {
    expect(await crearCanalAlerta(CFG, async () => { throw new TypeError('fetch failed'); }).enviar(CORREO, 1)).toEqual({ ok: false, error: 'sin conexión con n8n' });
    const espera = Object.assign(new Error('x'), { name: 'TimeoutError' });
    expect(await crearCanalAlerta(CFG, async () => { throw espera; }).enviar(CORREO, 1)).toEqual({ ok: false, error: 'n8n no respondió a tiempo' });
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/alerta.test.ts
```

Esperado: FAIL — `Failed to load url ./alerta.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/alerta.ts`:

```ts
/**
 * Alerta de foto vieja de «Equipos en taller» (D6, §5.2): un correo por el
 * webhook de n8n «Equipos · Alerta de foto vieja», con su token en una cabecera.
 * Mismo patrón que trazabilidad/envio-avisos.ts. El contrato del webhook está en
 * docs/equipos-taller.md.
 *
 * ⚠️ El token no sale nunca: ni en el registro ni en el error que se guarda
 * (`alerta_ultimo_error`), que además se corta.
 */
import { DOMINIO_ALERTA, type ConfigAlerta } from './config.js';

/** La cabecera del token: la credencial «Header Auth» del Webhook de n8n la comprueba. */
export const CABECERA_TOKEN = 'X-Equipos-Alerta-Token';
/** Cuánto se espera, como mucho, la respuesta de n8n. */
export const ESPERA_MAX_MS = 30_000;

export interface CorreoAlerta {
  para: string[];
  asunto: string;
  cuerpo: string;
}
export type ResultadoAlerta = { ok: true } | { ok: false; error: string };

export interface CanalAlerta {
  encendido: boolean;
  enviar(correo: CorreoAlerta, referencia: number): Promise<ResultadoAlerta>;
}

type Red = (url: string, init: RequestInit) => Promise<Response>;

/** Los correos del dominio, sin repetir; si no queda ninguno, la dirección de reserva. */
export function destinatarios(correos: readonly string[], reserva: string): string[] {
  const del = [...new Set(correos.map((c) => c.trim().toLowerCase()).filter((c) => c.endsWith(DOMINIO_ALERTA) && !/\s/.test(c)))];
  return del.length ? del.sort() : [reserva];
}

/** Asunto y cuerpo del aviso. `fotoBuena` es el instante ISO de la última corrida buena. */
export function correoAlerta(d: { causa: string; fallosProgramados: number; fotoBuena: string | null }): { asunto: string; cuerpo: string } {
  const desde = d.fotoBuena
    ? new Date(d.fotoBuena).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' })
    : null;
  return {
    asunto: 'Equipos en taller: la información no se actualiza' + (desde ? ' desde el ' + desde : ''),
    cuerpo: [
      'La actualización diaria de «Equipos en taller» ha fallado ' + d.fallosProgramados + ' veces seguidas.',
      'Motivo de la última: ' + d.causa + '.',
      desde ? 'La pantalla sigue mostrando los datos del ' + desde + '.' : 'Todavía no hay ninguna foto buena.',
      'Cuando se resuelva, basta pulsar «Actualizar información» en el portal. Este aviso no se repite mientras dure el incidente.',
    ].join('\n\n'),
  };
}

export function crearCanalAlerta(cfg: ConfigAlerta | null, red: Red = fetch, log: (t: string) => void = (t) => console.warn(t)): CanalAlerta {
  if (!cfg) {
    log('equipos-taller: alerta apagada (faltan EQUIPOS_ALERTA_WEBHOOK_URL y EQUIPOS_ALERTA_TOKEN)');
    return { encendido: false, enviar: async () => ({ ok: false, error: 'alerta apagada: falta configurar el webhook de n8n' }) };
  }
  const limpio = (s: string) => s.split(cfg.token).join('[token]').trim().slice(0, 300);
  return {
    encendido: true,
    async enviar(correo, referencia) {
      let res: Response;
      try {
        res = await red(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CABECERA_TOKEN]: cfg.token },
          body: JSON.stringify({ referencia, para: correo.para, asunto: correo.asunto, cuerpo: correo.cuerpo }),
          // Sin seguir redirecciones: el token no debe viajar a otro sitio.
          redirect: 'manual',
          signal: AbortSignal.timeout(ESPERA_MAX_MS),
        });
      } catch (e) {
        const nombre = String((e as { name?: unknown } | null)?.name ?? '');
        return { ok: false, error: nombre === 'TimeoutError' || nombre === 'AbortError' ? 'n8n no respondió a tiempo' : 'sin conexión con n8n' };
      }
      let cuerpo: { ok?: unknown; error?: unknown } = {};
      try {
        const j: unknown = await res.json();
        if (j && typeof j === 'object') cuerpo = j as typeof cuerpo;
      } catch {
        /* sin cuerpo JSON */
      }
      if (res.ok && cuerpo.ok === true) return { ok: true };
      const motivo = typeof cuerpo.error === 'string' && cuerpo.error.trim() ? limpio(cuerpo.error) : '';
      return { ok: false, error: 'n8n respondió ' + res.status + (motivo ? ': ' + motivo : '') };
    },
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/alerta.test.ts
```

Esperado: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/alerta.ts apps/hub-api/src/equipos/alerta.test.ts
git commit -m "feat(equipos-taller): alerta de foto vieja por el webhook de n8n"
```

---

## Fase C — Base de datos, corrida, programador y rutas (hub-api)

### Task 12: Migración 071

**Files:**
- Create: `apps/hub-api/src/users/migrations/071_equipos_taller.sql`
- Modify: `apps/hub-api/src/db.ts:102` (array `MIGRATIONS`), `apps/hub-api/src/wo-sales/documento-numero.test.ts:48-50`
- Test: `apps/hub-api/src/equipos/migracion.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/migracion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// La 071 sin base: que está apuntada (y es la última) y que no siembra nada. Lo que
// hace contra Postgres: repo.db.test.ts.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const SQL = leer('../users/migrations/071_equipos_taller.sql');

describe('migración 071', () => {
  it('está apuntada en MIGRATIONS, detrás de la 070, y es la última', () => {
    expect(leer('../db.ts')).toMatch(/'070_wo_sales_documento_numero\.sql',\s*'071_equipos_taller\.sql'\];/);
  });

  it('no siembra ni apps ni llaves ni ninguna otra fila (se re-ejecuta en cada arranque)', () => {
    expect(SQL).not.toMatch(/INSERT\s+INTO/i);
    expect(SQL).not.toMatch(/user_apps/);
  });

  it('solo DDL idempotente', () => {
    const creates = SQL.match(/CREATE (UNIQUE )?(TABLE|INDEX|VIEW|SCHEMA|OR REPLACE VIEW)[^;]*/g) || [];
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.filter((c) => !/IF NOT EXISTS|OR REPLACE/.test(c))).toEqual([]);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/migracion.test.ts
```

Esperado: FAIL — `ENOENT: no such file or directory … 071_equipos_taller.sql`.

- [ ] **Step 3: Escribir la migración**

Crear `apps/hub-api/src/users/migrations/071_equipos_taller.sql`:

```sql
-- Migration 071: «Equipos en taller» (docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md, §4).
--
-- Qué equipos están físicamente en el taller, cruzando las remisiones de Drive con los
-- tickets y comentarios de Desk 2.0. Las tablas van en `portal` con prefijo `equipos_`
-- (D8). Vienen de sql/equipos.sql del módulo original, adaptadas:
--   · `estado` guarda `foto`, `exits` y `ent` (ya no hay caché de comentarios);
--   · el ajuste se firma con el usuario del portal (`user_id`, `usuario`, `creado_en`);
--   · la corrida dice su origen (`programada` / `boton`), si salió bien y por qué no;
--   · nuevos: el incidente (alerta una vez por incidente, D6) y las llaves por usuario (D7).
--
-- ⚠️ NO siembra ni permisos ni apps: initDb() re-ejecuta las migraciones en cada
-- arranque, y una semilla devolvería un permiso que un admin hubiera quitado. La app y
-- las llaves se asignan a mano tras el despliegue.
--
-- Solo DDL idempotente (IF NOT EXISTS / OR REPLACE).

CREATE SCHEMA IF NOT EXISTS portal;

-- foto  → la última foto buena: filas y remisiones ilegibles (claves cortas d, c, sn, est…)
-- exits → caché del texto útil de las remisiones escaneadas (versión CV del núcleo)
-- ent   → remisiones de entrada ya leídas (nombre del equipo y número de ticket)
CREATE TABLE IF NOT EXISTS portal.equipos_estado (
  clave          text        PRIMARY KEY CHECK (clave IN ('foto', 'exits', 'ent')),
  valor          jsonb       NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- Ajustes manuales. Clave «SERIAL|AAAA-MM-DD» (una entrada), «*SERIAL» (todas las del
-- serial) o «pdf:<idDrive>» (remisión ilegible revisada); el serial, en clase OCR.
-- tipo: in = sigue en taller · out = salida confirmada · ret = retirado · pdf = revisada
CREATE TABLE IF NOT EXISTS portal.equipos_ajuste (
  clave     text        PRIMARY KEY
                        CHECK (clave ~ '^(\*[A-Z0-9]{3,20}|[A-Z0-9]{3,20}\|\d{4}-\d{2}-\d{2}|pdf:[A-Za-z0-9_-]{10,80})$'),
  tipo      text        NOT NULL CHECK (tipo IN ('in', 'out', 'ret', 'pdf')),
  nota      text        NOT NULL DEFAULT '' CHECK (char_length(nota) <= 300),
  user_id   uuid        NULL REFERENCES portal.users(id) ON DELETE SET NULL,
  usuario   text        NOT NULL DEFAULT '',
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipos_ajuste_tipo_clave CHECK ((tipo = 'pdf') = (clave LIKE 'pdf:%'))
);

-- Una fila por corrida. `en_curso` es TRUE mientras corre y NULL al terminar: el índice
-- único parcial impide dos corridas a la vez (servidor y programador, o dos réplicas).
-- `avisos`: lo que el núcleo avisó en una corrida buena (no hay avisos de error: un
-- fallo hace fallida la corrida). `causa` nunca lleva secretos.
CREATE TABLE IF NOT EXISTS portal.equipos_ejecucion (
  id       bigserial   PRIMARY KEY,
  origen   text        NOT NULL CHECK (origen IN ('programada', 'boton')),
  user_id  uuid        NULL REFERENCES portal.users(id) ON DELETE SET NULL,
  inicio   timestamptz NOT NULL DEFAULT now(),
  fin      timestamptz NULL,
  en_curso boolean     NULL DEFAULT true,
  ok       boolean     NULL,
  causa    text        NULL CHECK (char_length(causa) <= 300),
  conteos  jsonb       NULL,
  avisos   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT equipos_ejecucion_estado CHECK (
    (en_curso IS TRUE AND fin IS NULL AND ok IS NULL) OR (en_curso IS NULL AND fin IS NOT NULL AND ok IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS equipos_ejecucion_una_a_la_vez ON portal.equipos_ejecucion (en_curso) WHERE en_curso;
CREATE INDEX IF NOT EXISTS equipos_ejecucion_buenas ON portal.equipos_ejecucion (id DESC) WHERE ok;

-- Incidentes: se abre con la primera corrida fallida tras una buena y se cierra con la
-- siguiente buena. Como mucho uno abierto (índice único parcial).
CREATE TABLE IF NOT EXISTS portal.equipos_incidente (
  id                  bigserial   PRIMARY KEY,
  abierto_en          timestamptz NOT NULL DEFAULT now(),
  cerrado_en          timestamptz NULL,
  fallos_programados  integer     NOT NULL DEFAULT 0 CHECK (fallos_programados >= 0),
  alerta_enviada_en   timestamptz NULL,
  alerta_ultimo_error text        NULL CHECK (char_length(alerta_ultimo_error) <= 300)
);
CREATE UNIQUE INDEX IF NOT EXISTS equipos_incidente_uno_abierto ON portal.equipos_incidente ((true)) WHERE cerrado_en IS NULL;

-- Llaves por usuario (mismo modelo que las de las fichas de Ausencias). Nacen en FALSE;
-- un admin las da desde el panel de la app.
CREATE TABLE IF NOT EXISTS portal.equipos_llaves (
  user_id         uuid        PRIMARY KEY REFERENCES portal.users(id) ON DELETE CASCADE,
  edita_ajustes   boolean     NOT NULL DEFAULT false,
  recibe_alertas  boolean     NOT NULL DEFAULT false,
  actualizado_por text        NOT NULL,
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- Para consultar en psql: la última foto, plana (sin ajustes manuales aplicados)…
CREATE OR REPLACE VIEW portal.equipos_v_equipos AS
SELECT r->>'sn'                                           AS serial,
       r->>'c'                                            AS cliente,
       (r->>'d')::date                                    AS fecha_entrada,
       r->>'est'                                          AS estado,
       r->>'src'                                          AS fuente,
       r->'z'->>'n'                                       AS ticket,
       r->'z'->>'st'                                      AS estado_ticket,
       NULLIF(r->>'xd', '')::date                         AS fecha_salida,
       jsonb_array_length(COALESCE(r->'pa', '[]'::jsonb)) AS salidas_parciales,
       r->'why'                                           AS motivos,
       r->>'id'                                           AS carpeta_entrada
  FROM portal.equipos_estado e, jsonb_array_elements(e.valor->'rows') r
 WHERE e.clave = 'foto';

-- …y las remisiones escaneadas ilegibles que nadie ha marcado como revisadas.
CREATE OR REPLACE VIEW portal.equipos_v_remisiones_ilegibles AS
SELECT i->>'id'                  AS archivo,
       i->>'n'                   AS nombre,
       NULLIF(i->>'d', '')::date AS fecha,
       i->>'m'                   AS motivo,
       i->>'q'                   AS detalle,
       i->'p'                    AS posibles_equipos
  FROM portal.equipos_estado e, jsonb_array_elements(COALESCE(e.valor->'ilegibles', '[]'::jsonb)) i
 WHERE e.clave = 'foto'
   AND NOT EXISTS (SELECT 1 FROM portal.equipos_ajuste a WHERE a.clave = 'pdf:' || (i->>'id'));

-- DATA-332: con los roles activados, portal_app solo tiene lo que se le da.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion,
                                            portal.equipos_incidente, portal.equipos_llaves TO portal_app;
    GRANT USAGE, SELECT ON SEQUENCE portal.equipos_ejecucion_id_seq, portal.equipos_incidente_id_seq TO portal_app;
    GRANT SELECT ON portal.equipos_v_equipos, portal.equipos_v_remisiones_ilegibles TO portal_app;
  END IF;
END $$;
```

- [ ] **Step 4: Registrarla en `MIGRATIONS` (herramienta Edit)**

En `apps/hub-api/src/db.ts` (línea 102), el final del array pasa de:

```ts
'069_trazabilidad_avisos_envios.sql', '070_wo_sales_documento_numero.sql'];
```

a:

```ts
'069_trazabilidad_avisos_envios.sql', '070_wo_sales_documento_numero.sql', '071_equipos_taller.sql'];
```

- [ ] **Step 5: La guarda de la 070 deja de exigir que sea la última (herramienta Edit)**

En `apps/hub-api/src/wo-sales/documento-numero.test.ts`, las líneas 48 y 50 pasan a ser:

```ts
  it('está apuntada en MIGRATIONS, detrás de la 069 (la última la vigila equipos/migracion.test.ts)', () => {
```

```ts
    expect(db).toMatch(/'069_trazabilidad_avisos_envios\.sql',\s*'070_wo_sales_documento_numero\.sql'[,\]]/);
```

- [ ] **Step 6: Ver que pasan, y que la migración aplica sobre Postgres**

```bash
cd apps/hub-api && npx vitest run src/equipos/migracion.test.ts src/wo-sales/documento-numero.test.ts
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/wo-sales/documento-numero.db.test.ts
```

Esperado: PASS (3 + 8 tests). El segundo comando aplica TODAS las migraciones en el contenedor (la 071 incluida) en su `globalSetup`: si la 071 tuviera un error de SQL, falla ahí con `migration` en el mensaje.

- [ ] **Step 7: Commit**

```bash
git add apps/hub-api/src/users/migrations/071_equipos_taller.sql apps/hub-api/src/db.ts apps/hub-api/src/wo-sales/documento-numero.test.ts apps/hub-api/src/equipos/migracion.test.ts
git commit -m "feat(equipos-taller): migración 071 (portal.equipos_*), idempotente y sin siembra"
```

---

### Task 13: Repositorio (TDD contra Postgres)

**Files:**
- Create: `apps/hub-api/src/equipos/repo.ts`
- Test: `apps/hub-api/src/equipos/repo.db.test.ts`

Se adapta de `servidor/almacen-postgres.ts`: esquema `portal` y prefijo `equipos_`; la corrida se cierra con `ok`/`causa` en vez de `estado`; el ajuste se firma con `user_id`/`usuario`/`creado_en` (supuesto A1); nuevos los incidentes y las llaves.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/repo.db.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba } from '../test-db/harness.js';
import { crearRepoEquipos, type RepoEquipos } from './repo.js';
import { CV, EST, type Foto } from './nucleo/index.js';

// La migración 071 y el repositorio contra Postgres real (Testcontainers). Todo ficticio:
// usuarios @equipos.test, seriales 18A9xxxx.
const MIGRACION = fileURLToPath(new URL('../users/migrations/071_equipos_taller.sql', import.meta.url));
const FOTO: Foto = {
  at: '2026-11-10T11:35:00.000Z',
  hoy: '2026-11-10',
  rows: [{ id: 'E1', d: '2026-11-01', c: 'CLIENTE A', sn: '18A90001', est: EST.TALLER, src: '', why: ['Entrada 2026-11-01'], x: null, z: null, zc: false, pa: [], xd: '', eq: '' }],
  ilegibles: [{ id: 'PDFabcdefghij1', n: '261020 - CLIENTE C.pdf', d: '2026-10-20', m: 'sin texto legible', q: 'x', p: [] }],
};
const EXITS = { v: CV, list: [{ id: 'S1', n: '260915 - CLIENTE B.pdf', d: '2026-09-15', t: ['1BA9000S'], it: {} }] };

let db: Pool;
let repo: RepoEquipos;
const usuario = async (email: string, o: { role?: string; status?: string; app?: boolean } = {}): Promise<string> => {
  const { rows } = await db.query(
    `INSERT INTO portal.users (full_name, email, password_hash, role, status) VALUES ($1, $2, 'x', $3, $4) RETURNING id::text AS id`,
    [email.split('@')[0], email, o.role ?? 'reader', o.status ?? 'active'],
  );
  if (o.app) await db.query(`INSERT INTO portal.user_apps (user_id, app_id) VALUES ($1, 'equipos-taller')`, [rows[0].id]);
  return rows[0].id;
};

beforeAll(() => {
  db = poolDePrueba();
  repo = crearRepoEquipos(db);
});
afterAll(async () => {
  await db.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE portal.equipos_estado, portal.equipos_ajuste, portal.equipos_ejecucion, portal.equipos_incidente, portal.equipos_llaves RESTART IDENTITY');
  await db.query(`DELETE FROM portal.users WHERE email LIKE '%@equipos.test'`);
});

describe('migración 071', () => {
  it('re-ejecutarla (initDb lo hace en cada arranque) no cambia nada ni borra filas', async () => {
    const columnas = async () =>
      (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'portal' AND table_name LIKE 'equipos_%' ORDER BY 1, 2`)).rows;
    const antes = await columnas();
    const id = await repo.iniciarCorrida('boton', null);
    await db.query(readFileSync(MIGRACION, 'utf8'));
    await db.query(readFileSync(MIGRACION, 'utf8'));
    expect(await columnas()).toEqual(antes);
    expect((await repo.ultimaCorrida())?.id).toBe(id);
  });

  it('no siembra ni apps ni llaves', async () => {
    await db.query(readFileSync(MIGRACION, 'utf8'));
    expect((await db.query(`SELECT count(*)::int AS n FROM portal.user_apps WHERE app_id = 'equipos-taller'`)).rows[0].n).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM portal.equipos_llaves')).rows[0].n).toBe(0);
  });

  it('la clave de un ajuste y su tipo los comprueba también la base', async () => {
    await expect(db.query(`INSERT INTO portal.equipos_ajuste (clave, tipo) VALUES ('x'' OR 1=1', 'in')`)).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(`INSERT INTO portal.equipos_ajuste (clave, tipo) VALUES ('pdf:Abcdefghij1', 'out')`)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('corridas', () => {
  it('el candado: una a la vez; al cerrar se suelta', async () => {
    const id = await repo.iniciarCorrida('programada', null);
    expect(id).not.toBeNull();
    expect(await repo.iniciarCorrida('boton', null)).toBeNull();
    await repo.terminarMal(id!, 'desk2: sin conexión', null);
    expect(await repo.iniciarCorrida('boton', null)).not.toBeNull();
  });

  it('una corrida colgada más de 180 min se da por abandonada', async () => {
    const id = (await repo.iniciarCorrida('programada', null))!;
    await db.query(`UPDATE portal.equipos_ejecucion SET inicio = now() - interval '181 minutes' WHERE id = $1`, [id]);
    expect(await repo.iniciarCorrida('boton', null)).not.toBeNull();
    const vieja = (await db.query('SELECT ok, causa, en_curso FROM portal.equipos_ejecucion WHERE id = $1', [id])).rows[0];
    expect(vieja).toEqual({ ok: false, causa: 'abandonada', en_curso: null });
  });

  it('terminarBien escribe foto, cachés y cierre; terminarMal no toca la foto pero sí guarda exits', async () => {
    const u = await usuario('boton@equipos.test');
    const id1 = (await repo.iniciarCorrida('boton', u))!;
    await repo.terminarBien(id1, { foto: FOTO, exits: EXITS, ent: { E1: { eq: 'EDM180C', srv: '', k: '' } }, avisos: ['un aviso'], conteos: { en_taller: 1 } });
    expect(await repo.leerFoto()).toEqual(FOTO);
    expect(await repo.leerCaches()).toEqual({ exits: EXITS, ent: { E1: { eq: 'EDM180C', srv: '', k: '' } } });
    const id2 = (await repo.iniciarCorrida('programada', null))!;
    const exits2 = { v: CV, list: [...EXITS.list, { id: 'S2', n: '261001 - X.pdf', d: '2026-10-01', t: [], it: {} }] };
    await repo.terminarMal(id2, 'drive: HTTP 403', exits2);
    expect(await repo.leerFoto()).toEqual(FOTO);
    expect((await repo.leerCaches()).exits).toEqual(exits2);
    expect(await repo.ultimaCorrida()).toMatchObject({ id: id2, origen: 'programada', ok: false, causa: 'drive: HTTP 403', enCurso: false });
    expect(await repo.ultimaCorridaBuena()).toMatchObject({ id: id1, origen: 'boton', ok: true, avisos: ['un aviso'], conteos: { en_taller: 1 } });
  });

  it('las vistas de psql leen la foto y dejan fuera las ilegibles revisadas', async () => {
    const id = (await repo.iniciarCorrida('boton', null))!;
    await repo.terminarBien(id, { foto: FOTO, exits: EXITS, ent: {}, avisos: [], conteos: {} });
    expect((await db.query('SELECT serial, estado FROM portal.equipos_v_equipos')).rows).toEqual([{ serial: '18A90001', estado: EST.TALLER }]);
    expect((await db.query('SELECT archivo FROM portal.equipos_v_remisiones_ilegibles')).rows).toEqual([{ archivo: 'PDFabcdefghij1' }]);
    await repo.guardarAjuste('pdf:PDFabcdefghij1', { t: 'pdf', m: '' }, { userId: null, usuario: 'x' });
    expect((await db.query('SELECT archivo FROM portal.equipos_v_remisiones_ilegibles')).rows).toEqual([]);
  });
});

describe('ajustes', () => {
  it('se guardan firmados (usuario y fecha de Colombia), se reescriben y se borran', async () => {
    const u = await usuario('tecnico@equipos.test');
    const a = await repo.guardarAjuste('1BA90001|2026-11-01', { t: 'in', m: 'sigue' }, { userId: u, usuario: 'tecnico@equipos.test' });
    expect(a).toMatchObject({ t: 'in', m: 'sigue', usuario: 'tecnico@equipos.test', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    await repo.guardarAjuste('1BA90001|2026-11-01', { t: 'out', m: 'recogido' }, { userId: u, usuario: 'tecnico@equipos.test' });
    expect(Object.keys(await repo.leerAjustes())).toEqual(['1BA90001|2026-11-01']);
    expect((await repo.leerAjustes())['1BA90001|2026-11-01'].t).toBe('out');
    await repo.borrarAjuste('1BA90001|2026-11-01');
    expect(await repo.leerAjustes()).toEqual({});
  });
});

describe('incidentes', () => {
  it('abrir, contar, avisar y cerrar; como mucho uno abierto', async () => {
    const id = (await repo.aplicarIncidente({ accion: 'abrir', fallosProgramados: 1, enviarAlerta: false }, null))!;
    await expect(db.query('INSERT INTO portal.equipos_incidente (fallos_programados) VALUES (0)')).rejects.toMatchObject({ code: '23505' });
    expect(await repo.aplicarIncidente({ accion: 'contar', fallosProgramados: 2, enviarAlerta: true }, id)).toBe(id);
    await repo.marcarAlerta(id, { ok: false, error: 'n8n respondió 500' });
    expect(await repo.incidenteAbierto()).toMatchObject({ id, fallosProgramados: 2, alertaEnviadaEn: null, alertaUltimoError: 'n8n respondió 500' });
    await repo.marcarAlerta(id, { ok: true });
    expect(await repo.incidenteAbierto()).toMatchObject({ alertaEnviadaEn: expect.any(String), alertaUltimoError: null });
    expect(await repo.aplicarIncidente({ accion: 'cerrar', fallosProgramados: 2, enviarAlerta: false }, id)).toBeNull();
    expect(await repo.incidenteAbierto()).toBeNull();
    expect(await repo.aplicarIncidente({ accion: 'abrir', fallosProgramados: 0, enviarAlerta: false }, null)).not.toBe(id);
  });
});

describe('llaves', () => {
  it('nacen apagadas; un admin las guarda firmadas; un usuario que no existe da null', async () => {
    const u = await usuario('tecnico@equipos.test', { app: true });
    expect(await repo.llavesDe(u)).toEqual({ editaAjustes: false, recibeAlertas: false });
    expect(await repo.llavesDe(null)).toEqual({ editaAjustes: false, recibeAlertas: false });
    const g = await repo.guardarLlaves(u, { editaAjustes: true, recibeAlertas: true }, 'admin@equipos.test');
    expect(g).toMatchObject({ userId: u, editaAjustes: true, recibeAlertas: true, actualizadoPor: 'admin@equipos.test' });
    expect(await repo.llavesDe(u)).toEqual({ editaAjustes: true, recibeAlertas: true });
    expect(await repo.guardarLlaves('00000000-0000-4000-8000-00000000dead', { editaAjustes: true, recibeAlertas: true }, 'a')).toBeNull();
  });

  it('la lista: activos con la app, y los admin; no los inactivos ni los que no tienen la app', async () => {
    await usuario('con-app@equipos.test', { app: true });
    await usuario('admin@equipos.test', { role: 'admin' });
    await usuario('sin-app@equipos.test');
    await usuario('baja@equipos.test', { app: true, status: 'inactive' });
    const l = (await repo.listarLlaves()).filter((x) => x.email.endsWith('@equipos.test'));
    expect(l.map((x) => [x.email, x.esAdmin])).toEqual([['admin@equipos.test', true], ['con-app@equipos.test', false]]);
  });

  it('los correos de la alerta: activos con recibe_alertas', async () => {
    const a = await usuario('recibe@equipos.test', { app: true });
    const b = await usuario('baja@equipos.test', { app: true, status: 'inactive' });
    const c = await usuario('edita@equipos.test', { app: true });
    await repo.guardarLlaves(a, { editaAjustes: false, recibeAlertas: true }, 'x');
    await repo.guardarLlaves(b, { editaAjustes: false, recibeAlertas: true }, 'x');
    await repo.guardarLlaves(c, { editaAjustes: true, recibeAlertas: false }, 'x');
    expect((await repo.correosAlerta()).filter((x) => x.endsWith('@equipos.test'))).toEqual(['recibe@equipos.test']);
  });
});
```

- [ ] **Step 2: Ver que falla** (Docker Desktop encendido)

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/repo.db.test.ts
```

Esperado: FAIL — `Failed to load url ./repo.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/repo.ts`:

```ts
/**
 * Lectura y escritura de las tablas `portal.equipos_*` (migración 071). Solo SQL:
 * qué se escribe lo deciden servicio.ts (corridas), incidente.ts (incidentes) y
 * router.ts (ajustes y llaves).
 *
 * `equipos_estado` guarda tres claves: `foto` (lo que muestra la pantalla),
 * `exits` (caché del texto de OCR, versión CV del núcleo) y `ent` (remisiones de
 * entrada ya leídas). Ya no hay caché de comentarios: se leen en cada corrida.
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { CacheEscaneos, Foto, RemisionEntrada } from './nucleo/tipos.js';
import type { AjusteFirmado, Corrida, Incidente, LlavesUsuario, OrigenCorrida, UsuarioConLlaves } from './contrato.js';
import type { DecisionIncidente } from './incidente.js';
import type { ResultadoAlerta } from './alerta.js';

type PoolClient = Awaited<ReturnType<Pool['connect']>>;
type Db = Pick<PoolClient, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;

/** Una corrida que lleva más de esto «en curso» se da por abandonada (el proceso cayó a mitad). */
export const MINUTOS_ABANDONO = 180;

export interface CorridaBuena {
  foto: Foto;
  exits: CacheEscaneos;
  ent: Record<string, RemisionEntrada>;
  avisos: string[];
  conteos: Record<string, number>;
}

export interface RepoEquipos {
  /** El candado: inserta la corrida «en curso». null si ya hay otra. */
  iniciarCorrida(origen: OrigenCorrida, userId: string | null): Promise<number | null>;
  leerCaches(): Promise<{ exits: CacheEscaneos | null; ent: Record<string, RemisionEntrada> }>;
  /** La foto, los cachés y el cierre de la corrida, en UNA transacción. */
  terminarBien(id: number, r: CorridaBuena): Promise<void>;
  /** Cierra la corrida como fallida. No toca `foto`; `exits`, si llega, sí (es caché). */
  terminarMal(id: number, causa: string, exits: CacheEscaneos | null): Promise<void>;
  leerFoto(): Promise<Foto | null>;
  leerAjustes(): Promise<Record<string, AjusteFirmado>>;
  guardarAjuste(clave: string, a: { t: AjusteFirmado['t']; m: string }, firma: { userId: string | null; usuario: string }): Promise<AjusteFirmado>;
  borrarAjuste(clave: string): Promise<void>;
  ultimaCorrida(): Promise<Corrida | null>;
  ultimaCorridaBuena(): Promise<Corrida | null>;
  incidenteAbierto(): Promise<Incidente | null>;
  /** Aplica la decisión. Devuelve el id del incidente que queda abierto, o null. */
  aplicarIncidente(d: DecisionIncidente, abiertoId: number | null): Promise<number | null>;
  marcarAlerta(incidenteId: number, r: ResultadoAlerta): Promise<void>;
  /** Correos de los usuarios activos con `recibe_alertas`. */
  correosAlerta(): Promise<string[]>;
  llavesDe(userId: string | null): Promise<LlavesUsuario>;
  /** Los usuarios activos que tienen la app (o son admin), con sus llaves. */
  listarLlaves(): Promise<UsuarioConLlaves[]>;
  /** null si el usuario no existe. */
  guardarLlaves(userId: string, l: LlavesUsuario, actualizadoPor: string): Promise<UsuarioConLlaves | null>;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const json = <T>(v: unknown): T | null => (v == null ? null : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

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

const guardarEstado = (c: Db, clave: 'foto' | 'exits' | 'ent', valor: unknown) =>
  c.query(
    `INSERT INTO portal.equipos_estado (clave, valor, actualizado_en) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [clave, JSON.stringify(valor)],
  );

const COLS_CORRIDA = 'id, origen, inicio, fin, en_curso, ok, causa, avisos, conteos';
const aCorrida = (x: Fila): Corrida => ({
  id: Number(x.id),
  origen: x.origen,
  inicio: iso(x.inicio) ?? '',
  fin: iso(x.fin),
  enCurso: x.en_curso === true,
  ok: x.ok ?? null,
  causa: x.causa ?? null,
  avisos: json<string[]>(x.avisos) ?? [],
  conteos: json<Record<string, number>>(x.conteos),
});

const COLS_INCIDENTE = 'id, abierto_en, fallos_programados, alerta_enviada_en, alerta_ultimo_error';
const aIncidente = (x: Fila): Incidente => ({
  id: Number(x.id),
  abiertoEn: iso(x.abierto_en) ?? '',
  fallosProgramados: Number(x.fallos_programados),
  alertaEnviadaEn: iso(x.alerta_enviada_en),
  alertaUltimoError: x.alerta_ultimo_error ?? null,
});

const SQL_AJUSTE = `clave, tipo, nota, usuario, creado_en, (creado_en AT TIME ZONE 'America/Bogota')::date::text AS dia`;
const aAjuste = (x: Fila): AjusteFirmado => ({ t: x.tipo, m: x.nota ?? '', at: String(x.dia), usuario: x.usuario ?? '', creadoEn: iso(x.creado_en) ?? '' });

const SQL_USUARIO_LLAVES = `u.id::text AS user_id, u.full_name, u.email, u.role,
       COALESCE(l.edita_ajustes, false) AS edita_ajustes, COALESCE(l.recibe_alertas, false) AS recibe_alertas,
       l.actualizado_por, l.actualizado_en
  FROM portal.users u
  LEFT JOIN portal.equipos_llaves l ON l.user_id = u.id`;
const aUsuario = (x: Fila): UsuarioConLlaves => ({
  userId: String(x.user_id),
  nombre: x.full_name ?? '',
  email: x.email ?? '',
  esAdmin: x.role === 'admin',
  editaAjustes: x.edita_ajustes === true,
  recibeAlertas: x.recibe_alertas === true,
  actualizadoPor: x.actualizado_por ?? null,
  actualizadoEn: iso(x.actualizado_en),
});

export function crearRepoEquipos(db: Pool): RepoEquipos {
  return {
    async iniciarCorrida(origen, userId) {
      await db.query(
        `UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = false, causa = 'abandonada'
          WHERE en_curso AND inicio < now() - make_interval(mins => $1)`,
        [MINUTOS_ABANDONO],
      );
      try {
        const r = await db.query('INSERT INTO portal.equipos_ejecucion (origen, user_id) VALUES ($1, $2) RETURNING id', [origen, userId]);
        return Number(r.rows[0].id);
      } catch (e) {
        if ((e as { code?: unknown }).code === '23505') return null; // equipos_ejecucion_una_a_la_vez
        throw e;
      }
    },

    async leerCaches() {
      const { rows } = await db.query(`SELECT clave, valor FROM portal.equipos_estado WHERE clave IN ('exits', 'ent')`);
      const v = (k: string) => rows.find((x: Fila) => x.clave === k)?.valor;
      return { exits: json<CacheEscaneos>(v('exits')), ent: json<Record<string, RemisionEntrada>>(v('ent')) ?? {} };
    },

    async terminarBien(id, r) {
      await enTransaccion(db, async (c) => {
        await guardarEstado(c, 'exits', r.exits);
        await guardarEstado(c, 'ent', r.ent);
        await guardarEstado(c, 'foto', r.foto);
        await c.query(
          `UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = true, causa = NULL, avisos = $2::jsonb, conteos = $3::jsonb
            WHERE id = $1`,
          [id, JSON.stringify(r.avisos), JSON.stringify(r.conteos)],
        );
      });
    },

    async terminarMal(id, causa, exits) {
      await enTransaccion(db, async (c) => {
        if (exits) await guardarEstado(c, 'exits', exits);
        await c.query(`UPDATE portal.equipos_ejecucion SET en_curso = NULL, fin = now(), ok = false, causa = $2 WHERE id = $1`, [id, causa.slice(0, 300)]);
      });
    },

    async leerFoto() {
      const { rows } = await db.query(`SELECT valor FROM portal.equipos_estado WHERE clave = 'foto'`);
      return rows[0] ? json<Foto>(rows[0].valor) : null;
    },

    async leerAjustes() {
      const { rows } = await db.query(`SELECT ${SQL_AJUSTE} FROM portal.equipos_ajuste ORDER BY clave`);
      return Object.fromEntries(rows.map((x: Fila) => [x.clave, aAjuste(x)]));
    },

    async guardarAjuste(clave, a, firma) {
      const { rows } = await db.query(
        `INSERT INTO portal.equipos_ajuste (clave, tipo, nota, user_id, usuario, creado_en) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (clave) DO UPDATE SET tipo = EXCLUDED.tipo, nota = EXCLUDED.nota, user_id = EXCLUDED.user_id,
                                           usuario = EXCLUDED.usuario, creado_en = now()
         RETURNING ${SQL_AJUSTE}`,
        [clave, a.t, a.m.slice(0, 300), firma.userId, firma.usuario],
      );
      return aAjuste(rows[0]);
    },

    async borrarAjuste(clave) {
      await db.query('DELETE FROM portal.equipos_ajuste WHERE clave = $1', [clave]);
    },

    async ultimaCorrida() {
      const { rows } = await db.query(`SELECT ${COLS_CORRIDA} FROM portal.equipos_ejecucion ORDER BY id DESC LIMIT 1`);
      return rows[0] ? aCorrida(rows[0]) : null;
    },

    async ultimaCorridaBuena() {
      const { rows } = await db.query(`SELECT ${COLS_CORRIDA} FROM portal.equipos_ejecucion WHERE ok ORDER BY id DESC LIMIT 1`);
      return rows[0] ? aCorrida(rows[0]) : null;
    },

    async incidenteAbierto() {
      const { rows } = await db.query(`SELECT ${COLS_INCIDENTE} FROM portal.equipos_incidente WHERE cerrado_en IS NULL`);
      return rows[0] ? aIncidente(rows[0]) : null;
    },

    async aplicarIncidente(d, abiertoId) {
      if (d.accion === 'abrir') {
        const { rows } = await db.query('INSERT INTO portal.equipos_incidente (fallos_programados) VALUES ($1) RETURNING id', [d.fallosProgramados]);
        return Number(rows[0].id);
      }
      if (abiertoId === null) return null;
      if (d.accion === 'cerrar') {
        await db.query('UPDATE portal.equipos_incidente SET cerrado_en = now() WHERE id = $1 AND cerrado_en IS NULL', [abiertoId]);
        return null;
      }
      if (d.accion === 'contar') await db.query('UPDATE portal.equipos_incidente SET fallos_programados = $2 WHERE id = $1', [abiertoId, d.fallosProgramados]);
      return abiertoId;
    },

    async marcarAlerta(incidenteId, r) {
      if (r.ok) await db.query('UPDATE portal.equipos_incidente SET alerta_enviada_en = now(), alerta_ultimo_error = NULL WHERE id = $1', [incidenteId]);
      else await db.query('UPDATE portal.equipos_incidente SET alerta_ultimo_error = $2 WHERE id = $1', [incidenteId, r.error.slice(0, 300)]);
    },

    async correosAlerta() {
      const { rows } = await db.query(
        `SELECT u.email FROM portal.equipos_llaves l JOIN portal.users u ON u.id = l.user_id
          WHERE l.recibe_alertas AND u.status = 'active' ORDER BY lower(u.email)`,
      );
      return rows.map((x: Fila) => String(x.email));
    },

    async llavesDe(userId) {
      if (!userId) return { editaAjustes: false, recibeAlertas: false };
      const { rows } = await db.query('SELECT edita_ajustes, recibe_alertas FROM portal.equipos_llaves WHERE user_id = $1::uuid', [userId]);
      return { editaAjustes: rows[0]?.edita_ajustes === true, recibeAlertas: rows[0]?.recibe_alertas === true };
    },

    async listarLlaves() {
      const { rows } = await db.query(
        `SELECT ${SQL_USUARIO_LLAVES}
          WHERE u.status = 'active'
            AND (u.role = 'admin' OR EXISTS (SELECT 1 FROM portal.user_apps a WHERE a.user_id = u.id AND a.app_id = 'equipos-taller'))
          ORDER BY lower(u.full_name), lower(u.email)`,
      );
      return rows.map(aUsuario);
    },

    async guardarLlaves(userId, l, actualizadoPor) {
      const existe = await db.query('SELECT 1 FROM portal.users WHERE id = $1::uuid', [userId]);
      if (!existe.rows.length) return null;
      await db.query(
        `INSERT INTO portal.equipos_llaves (user_id, edita_ajustes, recibe_alertas, actualizado_por, actualizado_en)
         VALUES ($1::uuid, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE SET edita_ajustes = EXCLUDED.edita_ajustes, recibe_alertas = EXCLUDED.recibe_alertas,
                                             actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
        [userId, l.editaAjustes, l.recibeAlertas, actualizadoPor],
      );
      const { rows } = await db.query(`SELECT ${SQL_USUARIO_LLAVES} WHERE u.id = $1::uuid`, [userId]);
      return aUsuario(rows[0]);
    },
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos/repo.db.test.ts
```

Esperado: PASS, 12 tests (incluida «re-ejecutarla no cambia nada ni borra filas»).

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/repo.ts apps/hub-api/src/equipos/repo.db.test.ts
git commit -m "feat(equipos-taller): repositorio de portal.equipos_* (corridas, foto, ajustes, incidentes, llaves)"
```

---

### Task 14: Servicio — una corrida (TDD)

**Files:**
- Create: `apps/hub-api/src/equipos/servicio.ts`
- Test: `apps/hub-api/src/equipos/servicio.test.ts`

Se adapta de `servidor/servicio.ts`. Lo nuevo: la sonda de Desk 2.0 antes de Drive, las fuentes vigiladas (cualquier fallo hace fallida la corrida, D5, salvo el de un PDF concreto al pasarlo a texto, que va a ilegibles: supuesto A9; el núcleo, que convierte fallos en avisos, no se toca), `exits` guardado aunque falle Drive, el incidente y la alerta.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/servicio.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { crearServicioEquipos, vigilarFuentes, type FuentesCorrida } from './servicio.js';
import { ErrorDrive, type FuenteDrive } from './fuente-drive.js';
import { SinDesk2, type FuenteDesk2 } from './fuente-desk2.js';
import { CV, EST, type CacheEscaneos, type Foto } from './nucleo/index.js';
import type { RepoEquipos, CorridaBuena } from './repo.js';
import type { Corrida, Incidente } from './contrato.js';
import type { DecisionIncidente } from './incidente.js';
import type { CanalAlerta, CorreoAlerta } from './alerta.js';

// Una corrida de punta a punta con un repositorio EN MEMORIA y fuentes simuladas:
// candado, Desk 2.0 → Drive → núcleo → foto, y el incidente con su alerta. El SQL del
// repositorio: repo.db.test.ts. Todo ficticio.
const FOTO_VIEJA: Foto = { at: '2026-11-08T11:35:00.000Z', hoy: '2026-11-08', rows: [], ilegibles: [] };

function repoEnMemoria() {
  const s = {
    foto: FOTO_VIEJA as Foto | null,
    exits: null as CacheEscaneos | null,
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
    leerCaches: async () => ({ exits: s.exits, ent: {} }),
    terminarBien: async (id, r: CorridaBuena) => { s.foto = r.foto; s.exits = r.exits; cerrar(id, true, null, { avisos: r.avisos, conteos: r.conteos }); },
    terminarMal: async (id, causa, exits) => { if (exits) s.exits = exits; cerrar(id, false, causa); },
    leerFoto: async () => s.foto,
    leerAjustes: async () => ({}),
    guardarAjuste: async () => { throw new Error('no se usa'); },
    borrarAjuste: async () => {},
    ultimaCorrida: async () => s.corridas.at(-1) ?? null,
    ultimaCorridaBuena: async () => [...s.corridas].reverse().find((c) => c.ok) ?? null,
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
function fuentes(o: { textoPdf?: (id: string) => Promise<string>; sonda?: () => Promise<{ total: number; conCf: number }>; tickets?: FuenteDesk2['tickets'] } = {}): FuentesCorrida {
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
const crear = (f: () => FuentesCorrida, repo: RepoEquipos, canal = canalFalso().canal) =>
  crearServicioEquipos({ repo, fuentes: f, canal, reserva: 'comercial@ambientalia.com.co', log: () => {}, hoy: () => '2026-11-10' });

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
});

describe('una corrida fallida', () => {
  it('si falla Desk 2.0 no toca la foto ni lee Drive', async () => {
    const { repo, s } = repoEnMemoria();
    let leyoDrive = false;
    const f = fuentes({ sonda: async () => { throw new SinDesk2(); } });
    f.drive.entradas = async () => { leyoDrive = true; return []; };
    expect(await crear(() => f, repo).ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'desk2: sin configurar' });
    expect(s.foto).toBe(FOTO_VIEJA);
    expect(leyoDrive).toBe(false);
  });

  it('si Desk 2.0 falla a mitad (un serial), la corrida falla aunque el núcleo siga', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ tickets: async () => { throw Object.assign(new Error('pg: host secreto'), { code: '57014' }); } });
    expect(await crear(() => f, repo).ejecutar('programada', null)).toEqual({ estado: 'error', causa: 'desk2: tiempo agotado' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });

  it('si Drive falla de verdad (5xx) en un PDF, no toca la foto pero SÍ guarda el OCR que ya salió', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new ErrorDrive(500); return block('18A90002'); } });
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: HTTP 500' });
    expect(s.foto).toBe(FOTO_VIEJA);
    expect(s.exits?.list.map((x) => x.id)).toEqual(['S1']);
  });

  it('si TODOS los PDF intentados fallan al pasarlos a texto (2 o más), es un problema de Drive: la corrida falla', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async () => { throw new ErrorDrive(403); } });
    expect(await crear(() => f, repo).ejecutar('boton', null)).toEqual({ estado: 'error', causa: 'drive: no se pudo convertir ningún PDF (HTTP 403)' });
    expect(s.foto).toBe(FOTO_VIEJA);
  });
});

describe('un PDF que Drive no puede convertir (A9)', () => {
  it('la corrida sigue; ese PDF va a ilegibles y NO entra en la caché (se reintenta en la siguiente)', async () => {
    const { repo, s } = repoEnMemoria();
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new ErrorDrive(400); return block('18A90002'); } });
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

  it('en la siguiente corrida se vuelve a intentar y, si ya sale, deja de ser ilegible por ese motivo', async () => {
    const { repo, s } = repoEnMemoria();
    let roto = true;
    const f = () => fuentes({ textoPdf: async (id) => { if (id === 'S2' && roto) throw new ErrorDrive(400); return block(id === 'S2' ? '18A90001' : '18A90002'); } });
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

  it('sin Drive configurado, «sin_configurar» y no se registra ninguna corrida', async () => {
    const { repo, s } = repoEnMemoria();
    const srv = crearServicioEquipos({ repo, fuentes: null, canal: canalFalso().canal, reserva: 'x@ambientalia.com.co', log: () => {} });
    expect(srv.configurado()).toBe(false);
    expect(await srv.lanzar('boton', null)).toBe('sin_configurar');
    expect(s.corridas).toEqual([]);
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
  it('apunta la primera causa de cada origen y Desk 2.0 manda sobre Drive', async () => {
    const f = fuentes({ tickets: async () => { throw Object.assign(new Error('x'), { code: '42501' }); } });
    f.drive.salidasEscaneadas = async () => { throw new ErrorDrive(403); };
    const v = vigilarFuentes(f);
    await v.fuentes.salidasEscaneadas().catch(() => {});
    expect(v.fallo()).toBe('drive: HTTP 403');
    await v.fuentes.tickets('18A90001').catch(() => {});
    expect(v.fallo()).toBe('desk2: consulta rechazada (permisos o esquema)');
  });

  it('un 4xx al convertir UN PDF es del archivo: no es fallo de la corrida y sale en pdfsSinTexto con su título', async () => {
    const f = fuentes({ textoPdf: async (id) => { if (id === 'S2') throw new ErrorDrive(403); return 'texto'; } });
    const v = vigilarFuentes(f);
    await v.fuentes.salidasEscaneadas();
    await v.fuentes.textoPdf('S1');
    await expect(v.fuentes.textoPdf('S2')).rejects.toBeInstanceOf(ErrorDrive);
    expect(v.fallo()).toBeNull();
    expect(v.pdfsSinTexto()).toEqual([{ id: 'S2', n: '261020 - CLIENTE C.pdf', status: 403 }]);
  });

  it('401 (token) y 429 (cuota) al convertir un PDF NO son del archivo: hacen fallar la corrida', async () => {
    for (const status of [401, 429]) {
      const f = fuentes({ textoPdf: async () => { throw new ErrorDrive(status); } });
      const v = vigilarFuentes(f);
      await v.fuentes.textoPdf('S1').catch(() => {});
      expect(v.fallo()).toBe('drive: HTTP ' + status);
      expect(v.pdfsSinTexto()).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/servicio.test.ts
```

Esperado: FAIL — `Failed to load url ./servicio.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/servicio.ts`:

```ts
/**
 * Una corrida de «Equipos en taller» (§5.1 del diseño):
 *   1. Candado: la corrida se inserta «en curso»; si choca, «ocupado» (409).
 *   2. Desk 2.0: una sonda antes de nada. Si falla → «desk2: <motivo>».
 *   3. Drive + núcleo: `actualizar` con las fuentes VIGILADAS. El núcleo convierte
 *      muchos fallos en avisos y sigue; aquí cualquier fallo de una fuente hace
 *      fallida la corrida (D5: nunca una foto con datos incompletos). Si falla
 *      Drive, el texto de OCR ya extraído se guarda igual (`exits` es caché).
 *      EXCEPCIÓN (A9): un PDF concreto que Drive no puede pasar a texto (4xx de
 *      ese archivo) no es un fallo de la fuente: va a ilegibles y, como el núcleo
 *      no lo mete en la caché, se reintenta en la siguiente corrida. Si fallan
 *      todos los intentados (2 o más) y ninguno sale, sí es de Drive.
 *   4. Foto y cierre en una transacción (repo.terminarBien).
 * Después, el incidente (incidente.ts) y, si toca, la alerta (alerta.ts).
 *
 * Una corrida fallida NUNCA toca `foto`. La siguiente es el reintento.
 */
import { actualizar, hoyBogota } from './nucleo/actualizar.js';
import { iso } from './nucleo/reglas.js';
import { EST, type Foto, type Fuentes, type Ilegible, type Resultado } from './nucleo/tipos.js';
import type { OrigenCorrida } from './contrato.js';
import { decidirIncidente } from './incidente.js';
import { correoAlerta, destinatarios, type CanalAlerta } from './alerta.js';
import { ErrorDrive, motivoDrive, type FuenteDrive } from './fuente-drive.js';
import { motivoDesk2, type FuenteDesk2 } from './fuente-desk2.js';
import type { RepoEquipos } from './repo.js';

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
  configurado(): boolean;
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
  /** null = «sin configurar» (falta Drive). */
  fuentes: (() => FuentesCorrida) | null;
  canal: CanalAlerta;
  reserva: string;
  log?: (t: string) => void;
  hoy?: () => string;
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

/** Un PDF de salida escaneada que Drive no pudo pasar a texto (A9). */
export interface PdfSinTexto {
  id: string;
  /** Nombre del archivo en Drive (el id si no apareció en el listado). */
  n: string;
  status: number;
}

/**
 * ¿El fallo es de UN archivo concreto y no de Drive? Un 4xx de la conversión que
 * no sea del token (401) ni de la cuota (429). Un 403 entra aquí: Drive lo da,
 * por ejemplo, cuando un archivo supera el tamaño exportable. Si el problema es
 * de permisos de la carpeta temporal, fallan TODOS y lo detecta `fallo()`.
 */
export function esFalloDeArchivo(e: unknown): e is ErrorDrive {
  return e instanceof ErrorDrive && !e.enToken && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
}

/** La fila de ilegibles de un PDF sin texto. `d` sale del AAMMDD del nombre, como en el núcleo. */
export function ilegibleSinTexto(p: PdfSinTexto): Ilegible {
  return {
    id: p.id,
    n: p.n,
    d: iso((p.n.match(/^\d{6}/) || [''])[0]),
    m: 'sin texto legible',
    q: 'Google Drive no pudo convertir este PDF a texto (HTTP ' + p.status + '): revisar el archivo en Drive',
    p: [],
  };
}

/**
 * Las fuentes del núcleo, vigiladas: cada fallo se apunta (el primero de cada
 * origen, ya traducido a una causa sin secretos) y el error sigue su camino.
 * Los fallos de archivo al pasar un PDF a texto se apartan en `pdfsSinTexto()`.
 */
export function vigilarFuentes(f: FuentesCorrida): { fuentes: Fuentes; fallo(): string | null; pdfsSinTexto(): PdfSinTexto[] } {
  let desk2: string | null = null;
  let drive: string | null = null;
  const titulos = new Map<string, string>();
  const sinTexto: PdfSinTexto[] = [];
  let convertidos = 0;
  const de = <A extends unknown[], R>(origen: 'desk2' | 'drive', fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        return await fn(...a);
      } catch (e) {
        if (origen === 'desk2') desk2 ??= 'desk2: ' + motivoDesk2(e);
        else drive ??= 'drive: ' + motivoDrive(e);
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
          if (esFalloDeArchivo(e)) sinTexto.push({ id, n: titulos.get(id) ?? id, status: e.status });
          else drive ??= 'drive: ' + motivoDrive(e);
          throw e; // el núcleo lo apunta en avisos y NO lo mete en la caché
        }
      },
      remisionEntrada: de('drive', (id: string) => f.drive.remisionEntrada(id)),
      tickets: de('desk2', (sn: string) => f.desk2.tickets(sn)),
      ticketNumero: de('desk2', (n: string) => f.desk2.ticketNumero(n)),
      comentarios: de('desk2', (id: string) => f.desk2.comentarios(id)),
    },
    fallo: () =>
      desk2 ??
      drive ??
      (sinTexto.length >= 2 && convertidos === 0 ? 'drive: no se pudo convertir ningún PDF (HTTP ' + sinTexto[0].status + ')' : null),
    pdfsSinTexto: () => [...sinTexto],
  };
}

export function crearServicioEquipos(deps: DepsServicio): ServicioEquipos {
  const log = deps.log ?? ((t: string) => console.log(t));
  const hoy = deps.hoy ?? hoyBogota;
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

  async function correr(id: number, origen: OrigenCorrida): Promise<ResultadoCorrida> {
    let causa: string | null = null;
    let fin: ResultadoCorrida;
    try {
      const f = (deps.fuentes as () => FuentesCorrida)();
      let sonda: { total: number; conCf: number } | null = null;
      try {
        sonda = await f.desk2.sonda();
      } catch (e) {
        causa = 'desk2: ' + motivoDesk2(e);
      }
      let r: Resultado | null = null;
      let sinTexto: PdfSinTexto[] = [];
      if (!causa) {
        const v = vigilarFuentes(f);
        const cache = await deps.repo.leerCaches();
        try {
          r = await actualizar(v.fuentes, { snap: null, exits: cache.exits, ent: cache.ent, cmt: {} }, { hoy: hoy(), prog: () => {} });
        } catch {
          causa = v.fallo() ?? 'interno: error inesperado';
        }
        causa ??= v.fallo();
        sinTexto = v.pdfsSinTexto();
      }
      if (causa || !r) {
        const c = causa ?? 'interno: error inesperado';
        await deps.repo.terminarMal(id, c, r ? r.exits : null);
        fin = { estado: 'error', causa: c };
      } else {
        const sinCf = sonda && sonda.total > sonda.conCf ? sonda.total - sonda.conCf : 0;
        const avisos = sinCf ? [...r.avisos, sinCf + ' tickets de Desk 2.0 sin campos personalizados (raw.cf): se usan solo sus columnas'] : r.avisos;
        // A9: los PDF que Drive no pudo pasar a texto van a ilegibles (no están en la caché).
        const foto: Foto = sinTexto.length ? { ...r.snap, ilegibles: [...(r.snap.ilegibles ?? []), ...sinTexto.map(ilegibleSinTexto)] } : r.snap;
        const conteos = contar(foto);
        await deps.repo.terminarBien(id, { foto, exits: r.exits, ent: r.ent, avisos, conteos });
        fin = { estado: 'ok', conteos, avisos };
      }
    } catch {
      // El propio repo falló (base del hub): se intenta cerrar la corrida para soltar el candado.
      causa = 'interno: no se pudo guardar';
      await deps.repo.terminarMal(id, causa, null).catch(() => undefined);
      fin = { estado: 'error', causa };
    }
    log('equipos-taller: corrida ' + id + ' (' + origen + ') ' + (fin.estado === 'error' ? 'fallida: ' + fin.causa : 'terminada'));
    await registrarIncidente(origen, fin.estado === 'ok', fin.estado === 'error' ? fin.causa : null);
    return fin;
  }

  /** El candado y el arranque. La corrida va envuelta (`{ corrida }`) para que el `async` no la espere. */
  async function arrancar(origen: OrigenCorrida, userId: string | null): Promise<'ocupado' | 'sin_configurar' | { corrida: Promise<ResultadoCorrida> }> {
    if (!deps.fuentes) return 'sin_configurar';
    const id = await deps.repo.iniciarCorrida(origen, userId);
    if (id === null) return 'ocupado';
    const corrida: Promise<ResultadoCorrida> = correr(id, origen).finally(() => {
      if (actual === corrida) actual = null;
    });
    actual = corrida;
    return { corrida };
  }

  return {
    configurado: () => deps.fuentes !== null,
    actualizando: () => actual !== null,
    async lanzar(origen, userId) {
      const a = await arrancar(origen, userId);
      return typeof a === 'string' ? a : 'iniciada';
    },
    async ejecutar(origen, userId) {
      const a = await arrancar(origen, userId);
      return typeof a === 'string' ? { estado: a } : a.corrida;
    },
    enCurso: () => actual,
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/servicio.test.ts
```

Esperado: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/servicio.ts apps/hub-api/src/equipos/servicio.test.ts
git commit -m "feat(equipos-taller): la corrida (candado, Desk 2.0, Drive, foto) con incidente y alerta"
```

---

### Task 15: Programador diario (TDD)

**Files:**
- Create: `apps/hub-api/src/equipos/programador.ts`
- Test: `apps/hub-api/src/equipos/programador.test.ts`

Mismo patrón que `trazabilidad/programador-pasadas.ts`; la cuenta de `msHastaProxima` viene de `hub-sync/src/equipos/tarea.ts`, generalizada a cualquier HH:MM. Sin corrida de recuperación (supuesto A7).

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/programador.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detenerProgramadorEquipos, iniciarProgramadorEquipos, msHastaProxima } from './programador.js';

// El CUÁNDO de la corrida diaria: la HH:MM de Colombia (UTC−5 todo el año). Sin base: el
// ejecutor es un doble y el reloj, de mentira.
const t = (iso: string) => Date.parse(iso);
const MIN = 60_000;

describe('msHastaProxima (puro)', () => {
  it.each([
    ['a las 05:00 de Colombia faltan 90 min para las 06:30', '06:30', '2026-11-09T10:00:00.000Z', 90 * MIN],
    ['a las 07:00 de Colombia, la de mañana', '06:30', '2026-11-09T12:00:00.000Z', 23.5 * 60 * MIN],
    ['justo a las 06:30 de Colombia, la de mañana', '06:30', '2026-11-09T11:30:00.000Z', 24 * 60 * MIN],
    ['un milisegundo antes', '06:30', '2026-11-09T11:29:59.999Z', 1],
    ['cruzando la medianoche UTC (20:00 de Colombia)', '06:30', '2026-11-10T01:00:00.000Z', 10.5 * 60 * MIN],
    ['una hora de la noche de Colombia que en UTC es del día siguiente: 22:00', '22:00', '2026-11-09T12:00:00.000Z', 15 * 60 * MIN],
  ])('%s', (_caso, hora, ahora, ms) => {
    expect(msHastaProxima(hora, t(ahora))).toBe(ms);
  });
});

describe('iniciarProgramadorEquipos', () => {
  afterEach(() => {
    detenerProgramadorEquipos();
    vi.useRealTimers();
  });

  it('dispara a la hora, se vuelve a programar y no se enciende dos veces', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T10:00:00.000Z'));
    const ejecutar = vi.fn(async () => {});
    expect(iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} })).toBe(true);
    expect(iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} })).toBe(false);
    await vi.advanceTimersByTimeAsync(90 * MIN - 1);
    expect(ejecutar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it('no hay corrida de recuperación al arrancar después de la hora', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T15:00:00.000Z'));
    const ejecutar = vi.fn(async () => {});
    iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it('un fallo al empezar se apunta y el programador sigue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T11:29:00.000Z'));
    const log = vi.fn();
    const ejecutar = vi.fn(async () => { throw new Error('base caída'); });
    iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log });
    await vi.advanceTimersByTimeAsync(MIN);
    expect(log).toHaveBeenCalledWith('equipos-taller: la corrida programada no pudo empezar');
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN);
    expect(ejecutar).toHaveBeenCalledTimes(2);
  });

  it('detenerlo cancela la siguiente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(t('2026-11-09T10:00:00.000Z'));
    const ejecutar = vi.fn(async () => {});
    iniciarProgramadorEquipos(ejecutar, { hora: '06:30', log: () => {} });
    detenerProgramadorEquipos();
    await vi.advanceTimersByTimeAsync(2 * 60 * MIN);
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/programador.test.ts
```

Esperado: FAIL — `Failed to load url ./programador.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/programador.ts`:

```ts
/**
 * La corrida diaria de «Equipos en taller»: a la `EQUIPOS_HORA_DIARIA` de Colombia
 * (06:30 por defecto). Colombia es UTC−5 todo el año, sin horario de verano.
 *
 * Mismo estilo que trazabilidad/programador-pasadas.ts:
 *   · lo enciende index.ts tras inicializar la base, y nadie más: importar este
 *     módulo no arranca nada;
 *   · un `setTimeout` hasta la próxima hora, que se vuelve a programar en cada
 *     disparo (no un intervalo de 24 h: así no deriva); no retiene el proceso;
 *   · SIN corrida de recuperación al arrancar: un despliegue después de la hora no
 *     lanza nada (contaría como corrida programada para el incidente). Para eso
 *     está el botón.
 *   · un fallo se apunta y no para nada. Dos corridas a la vez las impide el
 *     candado de la base.
 */
const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const COLOMBIA_MS = -5 * HORA_MS;

/** Milisegundos desde `ahora` hasta la próxima HH:MM de Colombia (si es justo esa hora, la de mañana). Puro. */
export function msHastaProxima(hora: string, ahora: number): number {
  const [h, m] = hora.split(':').map(Number);
  const objetivoUtc = ((h * HORA_MS + m * 60_000 - COLOMBIA_MS) % DIA_MS + DIA_MS) % DIA_MS;
  const t = ((ahora % DIA_MS) + DIA_MS) % DIA_MS;
  return t < objetivoUtc ? objetivoUtc - t : DIA_MS - t + objetivoUtc;
}

let temporizador: ReturnType<typeof setTimeout> | null = null;

/**
 * Enciende el programador. Devuelve false, sin tocar nada, si ya estaba
 * encendido. `ahora` es para las pruebas.
 */
export function iniciarProgramadorEquipos(
  ejecutar: () => Promise<unknown>,
  o: { hora: string; ahora?: () => number; log?: (t: string) => void },
): boolean {
  if (temporizador) return false;
  const ahora = o.ahora ?? Date.now;
  const log = o.log ?? ((t: string) => console.log(t));
  const programar = (): void => {
    const ms = msHastaProxima(o.hora, ahora());
    const mio = setTimeout(() => {
      if (temporizador !== mio) return;
      programar();
      void ejecutar().catch(() => log('equipos-taller: la corrida programada no pudo empezar'));
    }, ms);
    mio.unref?.();
    temporizador = mio;
  };
  programar();
  log('equipos-taller: corrida diaria a las ' + o.hora + ' (Colombia)');
  return true;
}

/** Apaga el programador. Una corrida que ya esté en marcha termina. */
export function detenerProgramadorEquipos(): void {
  if (temporizador) clearTimeout(temporizador);
  temporizador = null;
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/programador.test.ts
```

Esperado: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/programador.ts apps/hub-api/src/equipos/programador.test.ts
git commit -m "feat(equipos-taller): corrida diaria a la hora de Colombia"
```

---

### Task 16: Rutas `/api/equipos-taller` (TDD con Express real)

**Files:**
- Create: `apps/hub-api/src/equipos/router.ts`
- Test: `apps/hub-api/src/equipos/router.test.ts`

Se adapta de `apps/desk/server/equipos/router.ts` (Express 5) a Express 4: cada ruta va envuelta para que un rechazo no se pierda. Las guardas son las del portal (`requireAuth` + `requireApp('equipos-taller')`); las llaves se comprueban en el servidor.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/router.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { RepoEquipos } from './repo.js';
import type { ServicioEquipos } from './servicio.js';
import type { AjusteFirmado, LlavesUsuario, UsuarioConLlaves } from './contrato.js';

// Las rutas con Express de verdad: guardas de sesión y de app, llaves, 403/400/404/409/503.
// El SQL lo cubre repo.db.test.ts; aquí el repositorio y el servicio son dobles. La
// sesión: requireAuth real con la consulta de usuario simulada (mismo patrón que
// calibraciones/router.test.ts). Todo ficticio.
const SECRET = 'test-secret-equipos-taller';
process.env.JWT_SECRET = SECRET;

const usuarios = vi.hoisted(() => new Map<string, { role: string; apps: string[] }>());
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async (_sql: string, params: unknown[] = []) => {
      const u = usuarios.get(String(params[0] ?? '')) ?? { role: 'reader', apps: [] };
      return { rows: [{ role: u.role, status: 'active', apps: u.apps, token_version: 0 }], rowCount: 1 };
    },
    on: () => {},
  }),
}));
const { createEquiposTallerRouter } = await import('./router.js');

let seq = 0;
function token(o: { role?: string; apps?: string[] } = {}): { auth: string; userId: string } {
  const userId = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  usuarios.set(userId, { role: o.role ?? 'reader', apps: o.apps ?? ['equipos-taller'] });
  return { auth: 'Bearer ' + jwt.sign({ sub: `u${seq}@ambientalia.com.co`, user_id: userId, token_version: 0 }, SECRET, { algorithm: 'HS256' }), userId };
}

const llaves = new Map<string, LlavesUsuario>();
const guardados: { clave: string; t: string; m: string; userId: string | null; usuario: string }[] = [];
let lanzar: ServicioEquipos['lanzar'] = async () => 'iniciada';
let configurado = true;
const repo = {
  leerFoto: async () => null,
  leerAjustes: async () => ({}),
  ultimaCorrida: async () => null,
  ultimaCorridaBuena: async () => null,
  incidenteAbierto: async () => null,
  llavesDe: async (userId: string | null) => llaves.get(String(userId)) ?? { editaAjustes: false, recibeAlertas: false },
  guardarAjuste: async (clave: string, a: { t: AjusteFirmado['t']; m: string }, f: { userId: string | null; usuario: string }): Promise<AjusteFirmado> => {
    guardados.push({ clave, ...a, ...f });
    return { ...a, at: '2026-11-10', usuario: f.usuario, creadoEn: '2026-11-10T15:00:00.000Z' };
  },
  borrarAjuste: async () => {},
  listarLlaves: async (): Promise<UsuarioConLlaves[]> => [{ userId: 'u', nombre: 'Persona Ficticia', email: 'p@ambientalia.com.co', esAdmin: false, editaAjustes: true, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null }],
  guardarLlaves: async (userId: string, l: LlavesUsuario, por: string): Promise<UsuarioConLlaves | null> =>
    userId.endsWith('999999999999') ? null : { userId, nombre: 'X', email: 'x@ambientalia.com.co', esAdmin: false, ...l, actualizadoPor: por, actualizadoEn: '2026-11-10T15:00:00.000Z' },
} as unknown as RepoEquipos;
const servicio = {
  configurado: () => configurado,
  actualizando: () => false,
  lanzar: (o: 'programada' | 'boton', u: string | null) => lanzar(o, u),
} as unknown as ServicioEquipos;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api', createEquiposTallerRouter({ repo, servicio }));
  return a;
};
const B = '/api/equipos-taller';

beforeEach(() => {
  llaves.clear();
  guardados.length = 0;
  lanzar = async () => 'iniciada';
  configurado = true;
});

describe('guardas', () => {
  it('401 sin sesión', async () => expect((await request(app()).get(B)).status).toBe(401));
  it('403 sin la app', async () => expect((await request(app()).get(B).set('Authorization', token({ apps: ['ausencias'] }).auth)).status).toBe(403));
  it('un admin entra sin tener la app asignada', async () => expect((await request(app()).get(B).set('Authorization', token({ role: 'admin', apps: [] }).auth)).status).toBe(200));
});

describe('GET /equipos-taller', () => {
  it('devuelve la configuración y los permisos del usuario, sin caché', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    const r = await request(app()).get(B).set('Authorization', t.auth);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toMatchObject({ snap: null, configurado: true, actualizando: false, permisos: { editaAjustes: true, recibeAlertas: false, esAdmin: false, puedeEditar: true } });
  });
  it('sin la llave, puedeEditar es false (salvo admin)', async () => {
    expect((await request(app()).get(B).set('Authorization', token().auth)).body.permisos.puedeEditar).toBe(false);
    expect((await request(app()).get(B).set('Authorization', token({ role: 'admin' }).auth)).body.permisos.puedeEditar).toBe(true);
  });
});

describe('POST /equipos-taller/actualizar', () => {
  it('202 al empezar, como corrida del botón y con el usuario', async () => {
    const t = token();
    let visto: unknown[] = [];
    lanzar = async (...a) => { visto = a; return 'iniciada'; };
    const r = await request(app()).post(B + '/actualizar').set('Authorization', t.auth);
    expect([r.status, r.body]).toEqual([202, { estado: 'iniciada' }]);
    expect(visto).toEqual(['boton', t.userId]);
  });
  it('409 si ya hay una en curso', async () => {
    lanzar = async () => 'ocupado';
    expect((await request(app()).post(B + '/actualizar').set('Authorization', token().auth)).status).toBe(409);
  });
  it('503 sin configurar', async () => {
    lanzar = async () => 'sin_configurar';
    const r = await request(app()).post(B + '/actualizar').set('Authorization', token().auth);
    expect([r.status, r.body.message]).toEqual([503, 'Falta configurar Google Drive']);
  });
});

describe('ajustes', () => {
  const put = (auth: string, clave: string, b: unknown) => request(app()).put(B + '/ajustes/' + encodeURIComponent(clave)).set('Authorization', auth).send(b as object);
  it('403 sin la llave edita_ajustes', async () => {
    expect((await put(token().auth, '1BA90417|2026-11-01', { t: 'in' })).status).toBe(403);
    expect((await request(app()).delete(B + '/ajustes/' + encodeURIComponent('1BA90417|2026-11-01')).set('Authorization', token().auth)).status).toBe(403);
    expect(guardados).toEqual([]);
  });
  it('con la llave, guarda firmado con el usuario', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    const r = await put(t.auth, '1BA90417|2026-11-01', { t: 'out', m: 'recogido el 10 nov' });
    expect(r.status).toBe(200);
    expect(r.body.ajuste).toMatchObject({ t: 'out', m: 'recogido el 10 nov', usuario: expect.stringMatching(/@ambientalia\.com\.co$/) });
    expect(guardados[0]).toMatchObject({ clave: '1BA90417|2026-11-01', userId: t.userId });
  });
  it('un admin puede sin la llave', async () => expect((await put(token({ role: 'admin' }).auth, 'pdf:Abcdefghij_-12', { t: 'pdf' })).status).toBe(200));
  it('400 si la clave o el tipo no valen', async () => {
    const a = token({ role: 'admin' }).auth;
    expect((await put(a, "x' OR 1=1", { t: 'in' })).status).toBe(400);
    expect((await put(a, 'pdf:Abcdefghij_-12', { t: 'out' })).status).toBe(400);
    expect((await put(a, '1BA90417|2026-11-01', { t: 'borrar' })).status).toBe(400);
  });
  it('DELETE con la llave: 204', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: false });
    expect((await request(app()).delete(B + '/ajustes/' + encodeURIComponent('*1BA90417')).set('Authorization', t.auth)).status).toBe(204);
  });
});

describe('llaves', () => {
  it('solo los admin las ven y las cambian', async () => {
    const t = token();
    llaves.set(t.userId, { editaAjustes: true, recibeAlertas: true });
    expect((await request(app()).get(B + '/llaves').set('Authorization', t.auth)).status).toBe(403);
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', t.auth).send({ editaAjustes: true, recibeAlertas: true })).status).toBe(403);
    const r = await request(app()).get(B + '/llaves').set('Authorization', token({ role: 'admin' }).auth);
    expect([r.status, r.body[0].nombre]).toEqual([200, 'Persona Ficticia']);
  });
  it('PUT firma con el admin; 400 si no son booleanos; 404 si el usuario no existe', async () => {
    const a = token({ role: 'admin' }).auth;
    const r = await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ editaAjustes: true, recibeAlertas: false, actualizadoPor: expect.stringMatching(/@ambientalia\.com\.co$/) });
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-000000000001').set('Authorization', a).send({ editaAjustes: 'sí', recibeAlertas: false })).status).toBe(400);
    expect((await request(app()).put(B + '/llaves/no-es-uuid').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: true })).status).toBe(400);
    expect((await request(app()).put(B + '/llaves/00000000-0000-4000-8000-999999999999').set('Authorization', a).send({ editaAjustes: true, recibeAlertas: true })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/router.test.ts
```

Esperado: FAIL — `Failed to load url ./router.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/router.ts`:

```ts
/**
 * Rutas de «Equipos en taller» (§3.3 del diseño). Se montan bajo /api; todas van
 * detrás de `requireAuth` + `requireApp('equipos-taller')` (los admin pasan).
 *
 *   GET    /equipos-taller                  foto, ajustes, corridas, incidente, configuración y permisos
 *   POST   /equipos-taller/actualizar       202 · 409 si ya corre · 503 sin configurar
 *   PUT    /equipos-taller/ajustes/:clave   ← { t, m? }   (edita_ajustes o admin)
 *   DELETE /equipos-taller/ajustes/:clave   204           (edita_ajustes o admin)
 *   GET    /equipos-taller/llaves           (admin)
 *   PUT    /equipos-taller/llaves/:userId   ← { editaAjustes, recibeAlertas } (admin)
 *
 * Express 4: un rechazo de promesa no llega solo al manejador de errores, así que
 * cada ruta va envuelta (`ruta`). Un error nuestro es 500 genérico y Sentry; nunca
 * detalles internos.
 */
import { Router, type Request, type Response } from 'express';
import { getPayload, requireApp, requireAuth } from '../auth.js';
import { captureError } from '../sentry.js';
import { ajusteValido, APP_ID, claveValida, type RespuestaEquipos } from './contrato.js';
import type { RepoEquipos } from './repo.js';
import type { ServicioEquipos } from './servicio.js';

export interface DepsRouter {
  repo: RepoEquipos;
  servicio: ServicioEquipos;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ErrorRuta extends Error {
  readonly status: number;
  readonly cuerpo: Record<string, unknown>;
  constructor(status: number, cuerpo: Record<string, unknown>) {
    super(String(cuerpo.error));
    this.status = status;
    this.cuerpo = cuerpo;
  }
}

export function createEquiposTallerRouter(deps: DepsRouter): Router {
  const router = Router();
  const gated = [requireAuth, requireApp(APP_ID)] as const;
  const quien = (req: Request) => {
    const p = getPayload(req);
    return { userId: p?.user_id ? String(p.user_id) : null, email: String(p?.sub ?? '').toLowerCase(), esAdmin: p?.role === 'admin' };
  };
  const ruta = (ctx: string, fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorRuta) {
        res.status(e.status).json(e.cuerpo);
        return;
      }
      console.error(`${ctx} error`, e);
      captureError(e, { endpoint: ctx });
      res.status(500).json({ error: 'internal error' });
    }
  };
  /** Ajustes: la llave `edita_ajustes` o ser admin. */
  const exigirEditar = async (req: Request) => {
    const q = quien(req);
    if (q.esAdmin) return q;
    if (!(await deps.repo.llavesDe(q.userId)).editaAjustes) throw new ErrorRuta(403, { error: 'sin_llave', message: 'Hace falta la llave «edita ajustes».' });
    return q;
  };
  const exigirAdmin = (req: Request) => {
    const q = quien(req);
    if (!q.esAdmin) throw new ErrorRuta(403, { error: 'forbidden' });
    return q;
  };

  router.get('/equipos-taller', ...gated, ruta('equipos_estado', async (req, res) => {
    const q = quien(req);
    const [snap, ajustes, ultima, ultimaBuena, incidente, llaves] = await Promise.all([
      deps.repo.leerFoto(), deps.repo.leerAjustes(), deps.repo.ultimaCorrida(), deps.repo.ultimaCorridaBuena(), deps.repo.incidenteAbierto(), deps.repo.llavesDe(q.userId),
    ]);
    const cuerpo: RespuestaEquipos = {
      snap,
      ajustes,
      actualizando: deps.servicio.actualizando() || ultima?.enCurso === true,
      configurado: deps.servicio.configurado(),
      ultima,
      ultimaBuena,
      incidente,
      permisos: { ...llaves, esAdmin: q.esAdmin, puedeEditar: q.esAdmin || llaves.editaAjustes },
    };
    res.set('Cache-Control', 'no-store').json(cuerpo);
  }));

  router.post('/equipos-taller/actualizar', ...gated, ruta('equipos_actualizar', async (req, res) => {
    const e = await deps.servicio.lanzar('boton', quien(req).userId);
    if (e === 'sin_configurar') res.status(503).json({ error: 'sin_configurar', message: 'Falta configurar Google Drive' });
    else if (e === 'ocupado') res.status(409).json({ estado: 'ocupado', message: 'Ya se está actualizando' });
    else res.status(202).json({ estado: 'iniciada' });
  }));

  router.put('/equipos-taller/ajustes/:clave', ...gated, ruta('equipos_ajuste_guardar', async (req, res) => {
    const q = await exigirEditar(req);
    const clave = String(req.params.clave);
    const b = (req.body ?? {}) as { t?: unknown; m?: unknown };
    if (!ajusteValido(clave, b.t)) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Ajuste no válido' });
    const ajuste = await deps.repo.guardarAjuste(clave, { t: b.t, m: String(b.m ?? '').slice(0, 300) }, { userId: q.userId, usuario: q.email });
    res.json({ ajuste });
  }));

  router.delete('/equipos-taller/ajustes/:clave', ...gated, ruta('equipos_ajuste_borrar', async (req, res) => {
    await exigirEditar(req);
    const clave = String(req.params.clave);
    if (!claveValida(clave)) throw new ErrorRuta(400, { error: 'invalid_input', message: 'Clave no válida' });
    await deps.repo.borrarAjuste(clave);
    res.status(204).end();
  }));

  router.get('/equipos-taller/llaves', ...gated, ruta('equipos_llaves_listar', async (req, res) => {
    exigirAdmin(req);
    res.set('Cache-Control', 'no-store').json(await deps.repo.listarLlaves());
  }));

  router.put('/equipos-taller/llaves/:userId', ...gated, ruta('equipos_llaves_guardar', async (req, res) => {
    const q = exigirAdmin(req);
    const userId = String(req.params.userId);
    const b = (req.body ?? {}) as { editaAjustes?: unknown; recibeAlertas?: unknown };
    if (!UUID.test(userId) || typeof b.editaAjustes !== 'boolean' || typeof b.recibeAlertas !== 'boolean') {
      throw new ErrorRuta(400, { error: 'invalid_input', message: 'Llaves no válidas' });
    }
    const u = await deps.repo.guardarLlaves(userId, { editaAjustes: b.editaAjustes, recibeAlertas: b.recibeAlertas }, q.email);
    if (!u) throw new ErrorRuta(404, { error: 'not_found', message: 'Usuario no encontrado' });
    res.json(u);
  }));

  return router;
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/router.test.ts
```

Esperado: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/hub-api/src/equipos/router.ts apps/hub-api/src/equipos/router.test.ts
git commit -m "feat(equipos-taller): rutas de la API con llaves comprobadas en el servidor"
```

---

### Task 17: Montaje en hub-api

**Files:**
- Create: `apps/hub-api/src/equipos/index.ts`
- Modify: `apps/hub-api/src/index.ts` (imports, línea 18; tras `iniciarPasadasNocturnas(getHubPool());`, línea 152)
- Test: `apps/hub-api/src/equipos/index.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/hub-api/src/equipos/index.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearEquiposTaller } from './index.js';
import { detenerProgramadorEquipos } from './programador.js';
import { leerConfig } from './config.js';

// El montaje: sin Drive queda «sin configurar» y no enciende el programador. La base no
// se toca al montar (el pool es un doble que falla si alguien lo usa).
const pool = { query: async () => { throw new Error('no se debe consultar al montar'); }, connect: async () => { throw new Error('no'); } } as unknown as Pool;

afterEach(() => {
  detenerProgramadorEquipos();
  vi.restoreAllMocks();
});

describe('crearEquiposTaller', () => {
  it('sin la configuración de Drive: sin configurar, sin programador, y lo dice nombrando solo variables', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = crearEquiposTaller(pool, () => null, leerConfig({}));
    expect(m.servicio.configurado()).toBe(false);
    expect(m.iniciarProgramador()).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/sin configurar \(faltan o no valen: EQUIPOS_GOOGLE_CUENTA_SERVICIO, EQUIPOS_DRIVE_ENTRADAS/);
  });

  it('con Drive configurado, el programador se enciende una vez', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cfg = leerConfig({
      EQUIPOS_GOOGLE_CUENTA_SERVICIO: JSON.stringify({ client_email: 'sa@ficticio.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nA\n-----END PRIVATE KEY-----' }),
      EQUIPOS_DRIVE_ENTRADAS: 'carpetaEntradas01', EQUIPOS_DRIVE_SALIDAS_N8N: 'carpetaSalidasN8n1', EQUIPOS_DRIVE_SALIDAS_ESCANEADAS: 'carpetaEscaneos01', EQUIPOS_DRIVE_TEMPORAL: 'carpetaTemporal01',
    });
    const m = crearEquiposTaller(pool, () => null, cfg);
    expect(m.servicio.configurado()).toBe(true);
    expect(m.iniciarProgramador()).toBe(true);
    expect(m.iniciarProgramador()).toBe(false);
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
cd apps/hub-api && npx vitest run src/equipos/index.test.ts
```

Esperado: FAIL — `Failed to load url ./index.js`.

- [ ] **Step 3: Implementar**

Crear `apps/hub-api/src/equipos/index.ts`:

```ts
/**
 * «Equipos en taller» montado: configuración, fuentes, repositorio, servicio y
 * programador. Lo usa index.ts (y nadie más) tras initDb().
 */
import type { Pool } from '@algarpibe/zoho-sync';
import type { DbLectura } from '../trazabilidad/fuente.js';
import { crearCanalAlerta } from './alerta.js';
import { leerConfig, type ConfigEquipos } from './config.js';
import { fuenteDesk2 } from './fuente-desk2.js';
import { fuenteDrive } from './fuente-drive.js';
import { iniciarProgramadorEquipos } from './programador.js';
import { crearRepoEquipos, type RepoEquipos } from './repo.js';
import { crearServicioEquipos, type ServicioEquipos } from './servicio.js';

export { createEquiposTallerRouter } from './router.js';

export interface EquiposTaller {
  repo: RepoEquipos;
  servicio: ServicioEquipos;
  /** Enciende la corrida diaria. No hace nada si el módulo está sin configurar. */
  iniciarProgramador(): boolean;
}

export function crearEquiposTaller(hub: Pool, desk2: () => DbLectura | null, cfg: ConfigEquipos = leerConfig()): EquiposTaller {
  const repo = crearRepoEquipos(hub);
  const drive = cfg.drive ? fuenteDrive(cfg.drive) : null;
  // Una fuente de Desk 2.0 por corrida: su mapa de ids de ticket no se arrastra de una a otra.
  const fuentes = drive ? () => ({ drive, desk2: fuenteDesk2(desk2) }) : null;
  const servicio = crearServicioEquipos({ repo, fuentes, canal: crearCanalAlerta(cfg.alerta), reserva: cfg.reserva });
  if (!drive) console.warn('equipos-taller: sin configurar (faltan o no valen: ' + cfg.faltaDrive.join(', ') + ')');
  return {
    repo,
    servicio,
    iniciarProgramador: () => (drive ? iniciarProgramadorEquipos(() => servicio.ejecutar('programada', null), { hora: cfg.horaDiaria }) : false),
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
cd apps/hub-api && npx vitest run src/equipos/index.test.ts
```

Esperado: PASS, 2 tests.

- [ ] **Step 5: Montarlo en `apps/hub-api/src/index.ts` (herramienta Edit)**

Tras `import { getDesk2Pool } from './db-desk2.js';` (línea 18), añadir:

```ts
import { crearEquiposTaller, createEquiposTallerRouter } from './equipos/index.js';
```

Y tras `iniciarPasadasNocturnas(getHubPool());` (línea 152), antes del comentario de `createDataRouter`, añadir:

```ts
    // Equipos en taller: qué equipos están físicamente en el taller (remisiones de
    // Drive × tickets y comentarios de Desk 2.0). Sin la configuración de Drive queda
    // «sin configurar» y su programador (06:30 de Colombia) no se enciende.
    const equiposTaller = crearEquiposTaller(getHubPool(), getDesk2Pool);
    app.use('/api', createEquiposTallerRouter(equiposTaller));
    equiposTaller.iniciarProgramador();
```

- [ ] **Step 6: Comprobar tipos de todo hub-api y la suite del módulo**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
cd apps/hub-api && npx vitest run src/equipos scripts
```

Esperado: `tsc` sin errores nuevos (el Dockerfile de hub-api compila con `noEmitOnError`: un error de tipos, aunque sea en una prueba, rompe el despliegue). En local ya sale, antes de esta rama, `src/ausencias/service/barril.test.ts(4,24): error TS7016 … 'micromatch'` (faltan sus tipos en el `node_modules` local; en la imagen se instalan con las devDependencies): ese es ajeno y no se toca; cualquier otro, sí. Vitest: PASS en todos los ficheros de `src/equipos` y `scripts`.

- [ ] **Step 7: Verificar fugas y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts
cd ../.. && git add apps/hub-api/src/equipos/index.ts apps/hub-api/src/equipos/index.test.ts apps/hub-api/src/index.ts
git commit -m "feat(equipos-taller): montar el módulo y su programador en hub-api"
```

---

## Fase D — Pantalla y portal

### Task 18: Andamiaje de la sub-app `apps/equipos-taller`

**Files:**
- Create: `apps/equipos-taller/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}`, `apps/equipos-taller/src/nucleo.ts`
- Modify: `package-lock.json` (con `npm install`)

Mismo patrón que `apps/calibraciones` (React, alias de React a la raíz, `fs.allow` para importar de `apps/hub-api`). Las dependencias de prueba (`@testing-library/*`, `jsdom`) ya están en la raíz con estas mismas versiones: `npm install` solo registra el workspace.

- [ ] **Step 1: Crear los ficheros de la sub-app**

`apps/equipos-taller/package.json`:

```json
{
  "name": "equipos-taller",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "@suite/auth-client": "*",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.0",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.1.1",
    "jsdom": "^25.0.1",
    "typescript": "~5.9.3",
    "vite": "^7.2.4",
    "vitest": "^2.1.9"
  }
}
```

`apps/equipos-taller/tsconfig.json` (el de Calibraciones):

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "types": ["vite/client"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

`apps/equipos-taller/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Sin estos alias, `npm run dev` en la sub-app carga una SEGUNDA copia de
    // React desde su node_modules y los hooks se rompen (igual que ausencias).
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  server: {
    port: 5188,
    // La UI importa el núcleo puro de apps/hub-api por ruta relativa.
    fs: { allow: [path.resolve(__dirname, '../..')] },
  },
})
```

`apps/equipos-taller/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// La lógica pura corre en node; la prueba de la pantalla declara su entorno con el
// docblock `// @vitest-environment jsdom`. Sin setup de localStorage: la pantalla recibe
// la API inyectada y nunca lee la sesión en las pruebas.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`apps/equipos-taller/index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Equipos en taller</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/equipos-taller/src/nucleo.ts`:

```ts
/**
 * El núcleo puro de «Equipos en taller» y el contrato de su API, desde apps/hub-api
 * por ruta relativa (mismo patrón que Calibraciones): la pantalla aplica los ajustes,
 * las vistas y el orden con el MISMO código que usa el servidor.
 */
export * from '../../hub-api/src/equipos/nucleo';
export * from '../../hub-api/src/equipos/contrato';
```

- [ ] **Step 2: Registrar el workspace**

```bash
npm install
git diff --stat package-lock.json
```

Esperado: `package-lock.json` cambia (entrada `apps/equipos-taller` y su enlace en `node_modules`), sin paquetes nuevos de la red.

- [ ] **Step 3: Comprobar tipos (el núcleo y el contrato, con la configuración estricta de la sub-app)**

```bash
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: sin errores (`verbatimModuleSyntax`, `noUnusedLocals` y `erasableSyntaxOnly` pasan sobre el núcleo de hub-api).

- [ ] **Step 4: Commit**

```bash
git add apps/equipos-taller/package.json apps/equipos-taller/tsconfig.json apps/equipos-taller/vite.config.ts apps/equipos-taller/vitest.config.ts apps/equipos-taller/index.html apps/equipos-taller/src/nucleo.ts package-lock.json
git commit -m "chore(equipos-taller): andamiaje de la sub-app del portal"
```

---

### Task 19: Cliente de la API (TDD)

**Files:**
- Create: `apps/equipos-taller/src/api.ts`
- Test: `apps/equipos-taller/src/api.test.ts`

Se adapta de `apps/desk/src/equipos/api.ts`: base `VITE_HUB_API_URL` + `/api/equipos-taller`, sesión `ambientalia_token` por `@suite/auth-client` (inyectable para las pruebas), y las rutas de llaves.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/equipos-taller/src/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { apiEquipos } from './api';

// El cliente HTTP con un fetch de mentira: rutas, cabeceras y qué cuenta como error.
function falso(respuestas: Record<string, Response>) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return respuestas[(init.method || 'GET') + ' ' + url] ?? new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, pedidos };
}
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const B = 'https://hub.example/api/equipos-taller';
const cab = () => ({ Authorization: 'Bearer t' });

describe('apiEquipos', () => {
  it('lleva la sesión y codifica la clave del ajuste', async () => {
    const { f, pedidos } = falso({ ['PUT ' + B + '/ajustes/1BA90417%7C2026-11-01']: J({ ajuste: { t: 'in', m: '', at: '2026-11-10', usuario: 'u', creadoEn: '' } }) });
    expect((await apiEquipos(B, f, cab).guardarAjuste('1BA90417|2026-11-01', 'in')).t).toBe('in');
    expect(pedidos[0].init.headers).toMatchObject({ Authorization: 'Bearer t', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(pedidos[0].init.body))).toEqual({ t: 'in', m: '' });
  });
  it('409 al actualizar es «ocupado», no un error', async () => {
    const { f } = falso({ ['POST ' + B + '/actualizar']: J({ estado: 'ocupado', message: 'Ya se está actualizando' }, 409) });
    expect(await apiEquipos(B, f, cab).actualizar()).toBe('ocupado');
  });
  it('un 503 o un 403 lanzan el mensaje del servidor', async () => {
    const { f } = falso({ ['POST ' + B + '/actualizar']: J({ error: 'sin_configurar', message: 'Falta configurar Google Drive' }, 503), ['GET ' + B + '/llaves']: J({ error: 'forbidden' }, 403) });
    await expect(apiEquipos(B, f, cab).actualizar()).rejects.toThrow('Falta configurar Google Drive');
    await expect(apiEquipos(B, f, cab).llaves()).rejects.toThrow('forbidden');
  });
  it('DELETE responde 204 sin cuerpo', async () => {
    const { f } = falso({ ['DELETE ' + B + '/ajustes/*1BA90417']: new Response(null, { status: 204 }) });
    await expect(apiEquipos(B, f, cab).borrarAjuste('*1BA90417')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
npm test --workspace=apps/equipos-taller -- src/api.test.ts
```

Esperado: FAIL — `Failed to load url ./api`.

- [ ] **Step 3: Implementar**

Crear `apps/equipos-taller/src/api.ts`:

```ts
/** Cliente HTTP de la API de «Equipos en taller» (hub-api, `/api/equipos-taller/*`). */
import { authHeaders } from '@suite/auth-client';
import type { Ajuste, AjusteFirmado, LlavesUsuario, RespuestaEquipos, UsuarioConLlaves } from './nucleo';

export interface ApiEquipos {
  estado(): Promise<RespuestaEquipos>;
  actualizar(): Promise<'iniciada' | 'ocupado'>;
  guardarAjuste(clave: string, t: Ajuste['t'], m?: string): Promise<AjusteFirmado>;
  borrarAjuste(clave: string): Promise<void>;
  llaves(): Promise<UsuarioConLlaves[]>;
  guardarLlaves(userId: string, l: LlavesUsuario): Promise<UsuarioConLlaves>;
}

const BASE = `${(import.meta.env.VITE_HUB_API_URL as string | undefined) ?? ''}/api/equipos-taller`;

export function apiEquipos(base = BASE, f: typeof fetch = (...a) => fetch(...a), cabeceras: () => Record<string, string> = authHeaders): ApiEquipos {
  async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const r = await f(base + ruta, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cabeceras() },
      ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
    });
    if (r.status === 204) return undefined as T;
    const j = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string };
    // 409 = ya hay una corrida en curso: no es un error para la pantalla.
    if (!r.ok && r.status !== 409) throw new Error(j.message || j.error || 'Error ' + r.status);
    return j;
  }
  const k = (clave: string) => '/ajustes/' + encodeURIComponent(clave);
  return {
    estado: () => pedir<RespuestaEquipos>('GET', ''),
    actualizar: async () => ((await pedir<{ estado: 'iniciada' | 'ocupado' }>('POST', '/actualizar')).estado),
    guardarAjuste: async (clave, t, m = '') => (await pedir<{ ajuste: AjusteFirmado }>('PUT', k(clave), { t, m })).ajuste,
    borrarAjuste: async (clave) => { await pedir<void>('DELETE', k(clave)); },
    llaves: () => pedir<UsuarioConLlaves[]>('GET', '/llaves'),
    guardarLlaves: (userId, l) => pedir<UsuarioConLlaves>('PUT', '/llaves/' + encodeURIComponent(userId), l),
  };
}
```

- [ ] **Step 4: Ver que pasa**

```bash
npm test --workspace=apps/equipos-taller -- src/api.test.ts
```

Esperado: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/equipos-taller/src/api.ts apps/equipos-taller/src/api.test.ts
git commit -m "feat(equipos-taller): cliente de la API con la sesión del portal"
```

---

### Task 20: La pantalla y el panel de llaves (TDD con jsdom)

**Files:**
- Create: `apps/equipos-taller/src/EquiposServicio.tsx` (traslado adaptado), `apps/equipos-taller/src/PanelLlaves.tsx`, `apps/equipos-taller/src/App.tsx`, `apps/equipos-taller/src/main.tsx`
- Test: `apps/equipos-taller/src/EquiposServicio.test.tsx`

`EquiposServicio.tsx` se traslada de `apps/desk/src/equipos/EquiposServicio.tsx` **sin rediseño**: mismas vistas, columnas, motivos, botones y textos. Cambios: imports desde `./nucleo`; tipo `RespuestaEquipos`; el aviso de foto vieja (§5.3) en un `role="alert"` y fuera la línea «La última actualización falló: …» (la sustituye el aviso); los botones de ajuste (también «Deshacer ajuste», «Ya revisada» y «Deshacer») solo con `permisos.puedeEditar`; «Actualizar información» desactivado sin configurar; el panel de llaves para los admin; título «Equipos en taller»; «Zoho Desk» → «Desk» en la cabecera de la tabla y en el texto vacío; fecha en hora de Colombia; el ejemplo del campo «Ya revisada» con un serial ficticio. La prueba se porta con datos inventados y añade los casos nuevos.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `apps/equipos-taller/src/EquiposServicio.test.tsx`:

```tsx
// @vitest-environment jsdom
// La pantalla con una API simulada: vistas, conteos, ilegibles en «Revisar», ajustes, el
// aviso de foto vieja, los botones ocultos sin la llave y el panel de llaves. Todo ficticio.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EST, type Ajuste, type AjusteFirmado, type Corrida, type Fila, type RespuestaEquipos, type UsuarioConLlaves } from './nucleo';
import EquiposServicio from './EquiposServicio';
import type { ApiEquipos } from './api';

const fila = (sn: string, d: string, est: Fila['est'], extra: Partial<Fila> = {}): Fila =>
  ({ id: 'F' + sn, d, c: 'Cliente A', sn, est, src: '', why: ['Entrada ' + d], x: null, z: null, zc: false, pa: [], xd: '', eq: '', ...extra });
const corrida = (c: Partial<Corrida> = {}): Corrida =>
  ({ id: 1, origen: 'programada', inicio: '2026-11-09T11:30:00Z', fin: '2026-11-09T11:35:00Z', enCurso: false, ok: true, causa: null, avisos: ['Carpeta de entrada con nombre no reconocido: X'], conteos: null, ...c });
const estado = (o: Partial<RespuestaEquipos> = {}): RespuestaEquipos => ({
  actualizando: false,
  configurado: true,
  ultima: corrida(),
  ultimaBuena: corrida(),
  incidente: null,
  permisos: { editaAjustes: true, recibeAlertas: false, esAdmin: false, puedeEditar: true },
  ajustes: {},
  snap: {
    at: '2026-11-09T11:35:00Z', hoy: '2026-11-09',
    rows: [
      fila('18A90001', '2026-06-01', EST.TALLER, { z: { n: '1401', id: '1', st: 'Rev./Diagnostico', stt: 'Open', u: 'https://x/1401', m: '', enc: 'Técnico Uno', eq: 'EDM180C', srv: 'Calibración', fs: '', cl: '' } }),
      fila('G7XN900T', '2026-09-14', EST.REVISAR, { c: 'Cliente B', eq: 'APNA-370 · Horiba', x: { n: 'Sin ticket y sin salida', q: '56 días' } }),
      fila('18A90003', '2026-09-16', EST.ENTREGADO, { xd: '2026-10-09', z: { n: '1402', id: '2', st: 'Por facturar', stt: 'Open', u: 'https://x/1402', m: '', enc: '', eq: 'EDM180C', srv: '', fs: '', cl: '' } }),
    ],
    ilegibles: [
      { id: 'PDF1abcdefghij', n: '260707 - CLIENTE A.pdf', d: '2026-07-07', m: 'sin texto legible', q: 'El escaneo no tiene texto legible', p: [{ sn: '18A90001', d: '2026-06-01', est: EST.TALLER, c: 'Cliente A' }] },
      { id: 'PDF2abcdefghij', n: '260115 - CLIENTE C.pdf', d: '2026-01-15', m: 'serial ilegible', q: 'El OCR leyó «18#90417»', p: [] },
    ],
  },
  ...o,
});
function apiFalsa(o: Partial<RespuestaEquipos> = {}) {
  const e = estado(o);
  const llamadas: string[] = [];
  const usuarios: UsuarioConLlaves[] = [{ userId: 'u1', nombre: 'Persona Uno', email: 'p1@ambientalia.com.co', esAdmin: false, editaAjustes: false, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null }];
  const api: ApiEquipos = {
    estado: async () => structuredClone(e),
    actualizar: async () => { llamadas.push('actualizar'); e.actualizando = true; return 'iniciada'; },
    guardarAjuste: async (k, t: Ajuste['t'], m = '') => { llamadas.push('put ' + k + ' ' + t + ' ' + m); const a: AjusteFirmado = { t, m, at: '2026-11-09', usuario: 'yo', creadoEn: '' }; e.ajustes[k] = a; return a; },
    borrarAjuste: async (k) => { llamadas.push('delete ' + k); delete e.ajustes[k]; },
    llaves: async () => { llamadas.push('llaves'); return structuredClone(usuarios); },
    guardarLlaves: async (userId, l) => { llamadas.push('llaves ' + userId + ' ' + l.editaAjustes + ' ' + l.recibeAlertas); return { ...usuarios[0], ...l }; },
  };
  return { api, llamadas };
}
afterEach(cleanup);
const chip = async (n: RegExp) => within(await screen.findByRole('navigation', { name: 'Vistas' })).getByRole('button', { name: n });
const chipYa = (n: RegExp) => within(screen.getByRole('navigation', { name: 'Vistas' })).getByRole('button', { name: n });

describe('pantalla Equipos en taller (trasladada sin rediseño)', () => {
  it('muestra los conteos por vista y las remisiones ilegibles pendientes junto a Revisar', async () => {
    render(<EquiposServicio api={apiFalsa().api} />);
    const nav = await screen.findByRole('navigation', { name: 'Vistas' });
    await waitFor(() => expect(within(nav).getByRole('button', { name: /En taller/ }).textContent).toBe('1En taller'));
    expect(within(nav).getByRole('button', { name: /Revisar/ }).textContent).toBe('1Revisar+ 2 remisiones ilegibles');
    expect(within(nav).getByRole('button', { name: /Salió con ticket abierto/ }).textContent).toBe('1Salió con ticket abierto');
    expect(screen.getByText('Técnico Uno')).toBeTruthy();
    expect(screen.getByText('1 aviso en la última ejecución')).toBeTruthy();
  });

  it('en Revisar lista las remisiones ilegibles, sugiere el equipo y permite marcarlas como revisadas', async () => {
    const { api, llamadas } = apiFalsa();
    render(<EquiposServicio api={api} />);
    fireEvent.click(await chip(/Revisar/));
    expect(screen.getByRole('heading', { name: 'Remisiones de salida escaneadas ilegibles (2)' })).toBeTruthy();
    expect(screen.getByText(/Puede ser la salida de:/).parentElement!.textContent).toMatch(/18A90001 \(Cliente A, entrada 2026-06-01 · En taller\)/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ya revisada' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'es la salida de 18A90001' } });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Motivo' })); // el campo no pierde el foco al escribir
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: 'Remisiones de salida escaneadas ilegibles (1)' });
    expect(llamadas).toContain('put pdf:PDF1abcdefghij pdf es la salida de 18A90001');
    expect(screen.getByText('Ya revisadas (1)')).toBeTruthy();
  });

  it('«Sigue en taller» pasa el equipo de Revisar a En taller y «Deshacer ajuste» lo devuelve', async () => {
    const { api, llamadas } = apiFalsa();
    render(<EquiposServicio api={api} />);
    fireEvent.click(await chip(/Revisar/));
    fireEvent.click(screen.getByRole('button', { name: 'Sigue en taller' }));
    await waitFor(() => expect(chipYa(/En taller/).textContent).toBe('2En taller'));
    expect(llamadas[0]).toBe('put GTXN900T|2026-09-14 in ');
    fireEvent.click(chipYa(/En taller/));
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer ajuste' }));
    await waitFor(() => expect(chipYa(/En taller/).textContent).toBe('1En taller'));
  });

  it('«Actualizar información» lanza la actualización y se deshabilita mientras corre', async () => {
    const { api, llamadas } = apiFalsa();
    render(<EquiposServicio api={api} />);
    const b = await screen.findByRole('button', { name: 'Actualizar información' });
    await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(b);
    await screen.findByRole('button', { name: 'Actualizando…' });
    expect(llamadas).toEqual(['actualizar']);
  });
});

describe('lo nuevo en el portal', () => {
  it('sin la llave «edita ajustes» no hay botones de ajuste (ni en Revisar ni en las ilegibles)', async () => {
    render(<EquiposServicio api={apiFalsa({ permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false } }).api} />);
    fireEvent.click(await chip(/Revisar/));
    expect(screen.queryByRole('button', { name: 'Sigue en taller' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marcar retirado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ya revisada' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Actualizar información' })).toBeTruthy(); // actualizar sí puede
  });

  it('si la última corrida falló, avisa de qué y de cuándo son los datos', async () => {
    render(<EquiposServicio api={apiFalsa({ ultima: corrida({ id: 2, ok: false, causa: 'desk2: sin conexión', avisos: [] }) }).api} />);
    const a = await screen.findByRole('alert');
    expect(a.textContent).toMatch(/^No se pudo leer Desk 2\.0; datos del /);
    expect(a.className).not.toMatch(/font-semibold/);
  });

  it('con 2 o más corridas programadas fallidas el aviso va destacado', async () => {
    render(<EquiposServicio api={apiFalsa({ ultima: corrida({ id: 3, ok: false, causa: 'drive: HTTP 403' }), incidente: { id: 1, abiertoEn: '', fallosProgramados: 2, alertaEnviadaEn: null, alertaUltimoError: null } }).api} />);
    const a = await screen.findByRole('alert');
    expect(a.textContent).toMatch(/^No se pudo leer Google Drive/);
    expect(a.className).toMatch(/font-semibold/);
  });

  it('sin configurar: lo dice y el botón queda desactivado', async () => {
    render(<EquiposServicio api={apiFalsa({ configurado: false }).api} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Falta configurar Google Drive');
    expect((screen.getByRole('button', { name: 'Actualizar información' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('el panel de llaves solo lo ve un admin, y guarda cada casilla', async () => {
    const { api, llamadas } = apiFalsa({ permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: true, puedeEditar: true } });
    render(<EquiposServicio api={api} />);
    const panel = (await screen.findByText('Llaves de la app')).closest('details')!;
    panel.open = true;
    fireEvent(panel, new Event('toggle'));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Recibe alertas: Persona Uno' }));
    await waitFor(() => expect(llamadas).toContain('llaves u1 false true'));
    cleanup();
    render(<EquiposServicio api={apiFalsa().api} />);
    await screen.findByRole('navigation', { name: 'Vistas' });
    expect(screen.queryByText('Llaves de la app')).toBeNull();
  });
});
```

- [ ] **Step 2: Ver que falla**

```bash
npm test --workspace=apps/equipos-taller -- src/EquiposServicio.test.tsx
```

Esperado: FAIL — `Failed to load url ./EquiposServicio`.

- [ ] **Step 3: Implementar la pantalla**

Crear `apps/equipos-taller/src/EquiposServicio.tsx`:

```tsx
// Pantalla «Equipos en taller» (React 19 + Tailwind 3.4 del portal).
// Trasladada SIN rediseño de la pantalla de Desk 2.0 (mismas vistas, columnas, motivos y
// botones que la página de Claude); los datos vienen de /api/equipos-taller. Añade tres
// cosas (§3.2 del diseño): el aviso de foto vieja, el panel de llaves (solo admin) y los
// botones de ajuste ocultos para quien no tenga la llave «edita ajustes». El servidor
// vuelve a comprobar cada llave: aquí solo se ocultan botones.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ADENTRO, EST, VISTAS, TONO, aplicarAjustes, avisoFoto, claveFila, claveIlegible, dias, enlaceArchivo, enlaceCarpeta, filasDeVista,
  ilegiblesPendientes, Reglas, type Ajuste, type Fila, type Ilegible, type RespuestaEquipos,
} from './nucleo';
import { apiEquipos, type ApiEquipos } from './api';
import PanelLlaves from './PanelLlaves';

const TONOS = [
  'bg-emerald-100 text-emerald-900', // en taller
  'bg-amber-100 text-amber-900', // externo, revisar, parciales
  'bg-slate-200 text-slate-800', // cerrado sin salida, retirado
  'bg-sky-100 text-sky-900', // entregado
  'bg-violet-100 text-violet-900', // salió con ticket abierto
];
const enlace = 'text-sky-700 underline underline-offset-2 hover:text-sky-900';
const boton = 'mr-1.5 mt-1.5 rounded border border-slate-300 bg-white px-2 py-0.5 text-[13px] hover:bg-slate-50 disabled:opacity-50';
const fmt = (d: string) => (d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }) : '');
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className={enlace} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

interface Pedido {
  clave: string;
  tipo: Ajuste['t'];
  ayuda: string;
}

export default function EquiposServicio({ api: apiProp }: { api?: ApiEquipos }) {
  const api = useMemo(() => apiProp || apiEquipos(), [apiProp]);
  const [datos, setDatos] = useState<RespuestaEquipos | null>(null);
  const [vista, setVista] = useState<string>(EST.TALLER);
  const [aviso, setAviso] = useState('');
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [nota, setNota] = useState('');

  const cargar = useCallback(async () => {
    try { setDatos(await api.estado()); }
    catch (e) { setAviso('No se pudo cargar: ' + (e as Error).message); }
  }, [api]);
  useEffect(() => { void cargar(); }, [cargar]);
  // Mientras hay una corrida en curso (desde aquí o la programada), se consulta cada 3 s.
  useEffect(() => {
    if (!datos?.actualizando) return;
    const t = setInterval(() => void cargar(), 3000);
    return () => clearInterval(t);
  }, [datos?.actualizando, cargar]);

  const ajustes = datos?.ajustes || {};
  const snap = datos?.snap || null;
  const puedeEditar = datos?.permisos.puedeEditar ?? false;
  const filas = useMemo(() => aplicarAjustes(snap?.rows || [], ajustes), [snap, ajustes]);
  const pendientes = ilegiblesPendientes(snap, ajustes);
  const hoy = snap?.hoy || new Date().toISOString().slice(0, 10);
  const v = VISTAS.find((x) => x.nombre === vista) || VISTAS[0];
  const lista = filasDeVista(filas, v.nombre);
  const fotoVieja = datos ? avisoFoto(datos, fmt) : null;

  async function actualizar() {
    try {
      const e = await api.actualizar();
      setAviso(e === 'ocupado' ? 'Ya hay una actualización en curso.' : 'Actualizando… (la primera vez puede tardar varios minutos)');
      await cargar();
    } catch (e) { setAviso('No se pudo actualizar: ' + (e as Error).message); }
  }
  async function guardar(clave: string, tipo: Ajuste['t'], m = '') {
    try {
      const a = await api.guardarAjuste(clave, tipo, m);
      setDatos((d) => (d ? { ...d, ajustes: { ...d.ajustes, [clave]: a } } : d));
      setPedido(null);
      setNota('');
    } catch (e) { setAviso('No se pudo guardar el cambio: ' + (e as Error).message); }
  }
  async function deshacer(claves: string[]) {
    try {
      const existentes = claves.filter((k) => ajustes[k]);
      await Promise.all(existentes.map((k) => api.borrarAjuste(k)));
      setDatos((d) => { if (!d) return d; const aj = { ...d.ajustes }; existentes.forEach((k) => delete aj[k]); return { ...d, ajustes: aj }; });
    } catch (e) { setAviso('No se pudo deshacer: ' + (e as Error).message); }
  }

  // Funciones de dibujo (no componentes) para que el campo de texto no se vuelva a montar al escribir.
  const pregunta = (clave: string) =>
    pedido?.clave === clave ? (
      <div className="mt-1.5 flex gap-1.5">
        <input autoFocus aria-label="Motivo" placeholder={pedido.ayuda} value={nota} onChange={(e) => setNota(e.target.value)}
          className="w-full rounded border border-slate-300 px-1.5 py-0.5" />
        <button className={boton} onClick={() => void guardar(clave, pedido.tipo, nota.trim())}>Guardar</button>
      </div>
    ) : null;
  const pedir = (clave: string, tipo: Ajuste['t'], ayuda: string) => { setPedido({ clave, tipo, ayuda }); setNota(''); };

  function filaEquipo(r: Fila) {
    const z = r.z;
    const k = claveFila(r);
    const adentro = ADENTRO.includes(r.est);
    const revisar = r.est === EST.REVISAR || r.est === EST.CERRADO;
    const motivos = r.why.filter((w) => !adentro || !/^Salida parcial /.test(w));
    return (
      <tr key={r.id} className="border-t border-slate-200 align-top">
        <td className="whitespace-nowrap px-2 py-2 font-mono">{r.sn}</td>
        <td className="px-2 py-2">
          {z?.eq || r.eq || 'Equipo sin identificar'}
          {!z?.eq && r.eq ? <span className="text-slate-500"> (remisión de entrada)</span> : null}
          <div className="text-sm text-slate-500">{r.c}</div>
        </td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">
          <A href={enlaceCarpeta(r.id)}>{r.d}</A>
          <div className="text-sm text-slate-500">{adentro && r.d ? dias(r.d, hoy) + ' días' : ''}</div>
        </td>
        <td className="px-2 py-2">
          {z ? <A href={z.u}>#{z.n}</A> : adentro ? <span className={'rounded px-1.5 py-0.5 text-sm ' + TONOS[1]}>Sin ticket</span> : <span className="text-slate-400">—</span>}
        </td>
        <td className="px-2 py-2">
          {z ? (<>{z.st}<div className="text-sm text-slate-500">{(z.srv || '') + (z.m ? ' · modificado ' + z.m.slice(0, 10) : '')}</div></>) : null}
        </td>
        <td className="px-2 py-2">{z?.enc || ''}</td>
        <td className="max-w-xl px-2 py-2 text-sm">
          <span className={'rounded px-1.5 py-0.5 ' + TONOS[TONO[r.est] ?? 2]}>{r.est}{r.src ? ' · ' + r.src : ''}</span>
          {r.est === EST.ENTREGADO && z && !r.zc && r.xd ? (
            <div className="mt-1 font-semibold">Salió el {r.xd} · ticket abierto hace {dias(r.xd, hoy)} días</div>
          ) : null}
          {r.x ? (
            <div className="mt-1">
              {r.x.id ? <A href={enlaceArchivo(r.x.id)}>{r.x.n}</A> : r.x.fo ? <A href={enlaceCarpeta(r.x.fo)}>{r.x.n}</A> : r.x.n}
              {r.x.q ? <div className="text-slate-500">{r.x.q}</div> : null}
            </div>
          ) : null}
          {adentro ? r.pa.map((p) => (
            <div key={p.id + p.d} className={'mt-1 rounded px-2 py-1 ' + TONOS[1]}>
              <b>Salida parcial {p.d}:</b> {p.q || 'accesorio'}{p.k ? ' · ticket ' + p.k : ''} · <A href={enlaceArchivo(p.id)}>{p.n}</A>
            </div>
          )) : null}
          {motivos.length ? <ul className="mt-1 list-disc pl-4 text-slate-600">{motivos.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
          {!puedeEditar ? null : r.man ? (
            <div><button className={boton} onClick={() => void deshacer([k, '*' + Reglas.cls(r.sn)])}>Deshacer ajuste</button></div>
          ) : adentro ? (
            <div>
              {revisar ? (<>
                <button className={boton} onClick={() => void guardar(k, 'in')}>Sigue en taller</button>
                <button className={boton} onClick={() => pedir(k, 'out', 'Cómo se confirmó (ej. recogido 12 nov, falta escanear)')}>Confirmar salida</button>
              </>) : null}
              <button className={boton} onClick={() => pedir(k, 'ret', 'Motivo (ej. devuelto a fábrica)')}>Marcar retirado</button>
              {pregunta(k)}
            </div>
          ) : null}
        </td>
      </tr>
    );
  }

  function ilegibles() {
    if (snap && !snap.ilegibles) return <p className="mt-6 text-sm text-slate-500">Pulsa «Actualizar información» para revisar las remisiones escaneadas ilegibles.</p>;
    const todas = snap?.ilegibles || [];
    const hechas = todas.filter((x) => ajustes[claveIlegible(x)]);
    const tabla = (a: Ilegible[]) => (
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-sm text-slate-600"><tr><th className="px-2 py-1.5">Fecha</th><th className="px-2 py-1.5">Remisión escaneada</th><th className="px-2 py-1.5">Qué pasa</th></tr></thead>
          <tbody>{a.map((x) => {
            const k = claveIlegible(x);
            const hecho = ajustes[k];
            return (
              <tr key={x.id} className="border-t border-slate-200 align-top">
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">{x.d || '—'}</td>
                <td className="px-2 py-2"><A href={enlaceArchivo(x.id)}>{x.n}</A></td>
                <td className="px-2 py-2 text-sm">
                  <span className={'rounded px-1.5 py-0.5 ' + TONOS[1]}>{x.m}</span>
                  <div className="mt-1">{x.q}</div>
                  {x.p.length ? <div className="mt-1"><b>Puede ser la salida de:</b> {x.p.map((p) => p.sn + ' (' + p.c + ', entrada ' + p.d + ' · ' + p.est + ')').join('; ')}</div> : null}
                  {hecho ? (<>
                    <div className="mt-1 text-slate-500">Revisada {hecho.at}{hecho.m ? ': ' + hecho.m : ''}</div>
                    {puedeEditar ? <button className={boton} onClick={() => void deshacer([k])}>Deshacer</button> : null}
                  </>) : puedeEditar ? (<>
                    <button className={boton} onClick={() => pedir(k, 'pdf', 'Qué se encontró (ej. es la salida de 18A00000, vuelto a escanear)')}>Ya revisada</button>
                    {pregunta(k)}
                  </>) : null}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    );
    return (
      <section className="mt-8">
        <h2 className="text-base font-semibold">Remisiones de salida escaneadas ilegibles ({pendientes.length})</h2>
        <p className="mb-2 text-sm text-slate-600">PDFs de REMISIONES 2026\SALIDA que no se pudieron leer o cruzar con ningún equipo. Si alguna es la salida de un equipo que figura adentro, usa «Confirmar salida» en ese equipo; luego marca la remisión como revisada.</p>
        {pendientes.length ? tabla(pendientes) : <p className="text-sm text-slate-500">No hay remisiones ilegibles pendientes.</p>}
        {hechas.length ? <details className="mt-3"><summary className="cursor-pointer text-sm">Ya revisadas ({hechas.length})</summary>{tabla(hechas)}</details> : null}
      </section>
    );
  }

  const ultima = datos?.ultima;
  return (
    <main className="mx-auto max-w-7xl p-4 text-slate-900">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Equipos en taller</h1>
          <p className="text-sm text-slate-600">{snap ? <>Última actualización: <b>{fmt(snap.at)}</b></> : 'Sin actualizar todavía'}</p>
        </div>
        <button onClick={() => void actualizar()} disabled={!datos || datos.actualizando || !datos.configurado}
          className="rounded bg-sky-700 px-4 py-2 font-medium text-white hover:bg-sky-800 disabled:opacity-50">
          {datos?.actualizando ? 'Actualizando…' : 'Actualizar información'}
        </button>
      </header>
      {fotoVieja ? (
        <p role="alert" className={'mb-2 rounded px-3 py-2 text-sm ' + (fotoVieja.destacado ? 'border border-red-300 bg-red-50 font-semibold text-red-800' : 'bg-amber-50 text-amber-900')}>
          {fotoVieja.texto}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-slate-600">{aviso}</p>

      <nav className="my-3 flex flex-wrap gap-2" aria-label="Vistas">
        {VISTAS.map((x) => (
          <span key={x.nombre} className="contents">
            {x.grupo ? <span className="mx-1 w-px self-stretch bg-slate-300" aria-hidden /> : null}
            <button aria-pressed={x.nombre === vista} onClick={() => setVista(x.nombre)}
              className={'flex items-baseline gap-2 rounded-md border bg-white px-3 py-1.5 ' + (x.nombre === vista ? 'border-sky-700 shadow-[inset_0_-3px_0_theme(colors.sky.700)]' : 'border-slate-200')}>
              <b className="text-lg font-semibold tabular-nums">{filas.filter(x.filtro).length}</b>
              <span className={'rounded px-1.5 text-sm ' + TONOS[x.tono]}>{x.nombre}</span>
              {x.nombre === EST.REVISAR && pendientes.length ? (
                <span className="text-sm text-slate-500">+ {pendientes.length} {pendientes.length > 1 ? 'remisiones ilegibles' : 'remisión ilegible'}</span>
              ) : null}
            </button>
          </span>
        ))}
      </nav>
      <p className="mb-3 text-sm text-slate-600">{v.ayuda}</p>

      {!snap ? (
        <p className="py-8 text-slate-500">Aún no hay datos. Pulsa «Actualizar información» para consultar Drive y Desk 2.0.</p>
      ) : lista.length ? (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-sm text-slate-600">
              <tr>{['S/N', 'Equipo y cliente', 'Entrada', 'Ticket', 'Estado en Desk', 'Responsable', 'Clasificación y motivo'].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>{lista.map(filaEquipo)}</tbody>
          </table>
        </div>
      ) : (
        <p className="py-8 text-slate-500">No hay equipos en esta vista.</p>
      )}
      {v.nombre === EST.REVISAR && snap ? ilegibles() : null}

      {ultima?.avisos?.length ? (
        <details className="mt-6 text-sm text-red-800">
          <summary>{ultima.avisos.length} aviso{ultima.avisos.length > 1 ? 's' : ''} en la última ejecución</summary>
          <ul className="mt-1 list-disc pl-5">{ultima.avisos.slice(0, 40).map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      ) : null}

      {datos?.permisos.esAdmin ? <PanelLlaves api={api} /> : null}
    </main>
  );
}
```

Crear `apps/equipos-taller/src/PanelLlaves.tsx`:

```tsx
// Panel de llaves de «Equipos en taller» (solo admin): quién edita los ajustes y quién
// recibe la alerta de foto vieja. Se abre plegado; carga la lista al desplegarlo.
// Los admin ya editan sin la llave; la alerta, en cambio, se da explícitamente (§6).
import { useState } from 'react';
import type { ApiEquipos } from './api';
import type { LlavesUsuario, UsuarioConLlaves } from './nucleo';

export default function PanelLlaves({ api }: { api: ApiEquipos }) {
  const [usuarios, setUsuarios] = useState<UsuarioConLlaves[] | null>(null);
  const [error, setError] = useState('');

  async function abrir(abierto: boolean) {
    if (!abierto || usuarios) return;
    try { setUsuarios(await api.llaves()); }
    catch (e) { setError('No se pudieron cargar las llaves: ' + (e as Error).message); }
  }
  async function cambiar(u: UsuarioConLlaves, cambio: Partial<LlavesUsuario>) {
    try {
      const nuevo = await api.guardarLlaves(u.userId, { editaAjustes: u.editaAjustes, recibeAlertas: u.recibeAlertas, ...cambio });
      setUsuarios((l) => (l ? l.map((x) => (x.userId === u.userId ? nuevo : x)) : l));
      setError('');
    } catch (e) { setError('No se pudo guardar: ' + (e as Error).message); }
  }

  return (
    <details className="mt-8 rounded border border-slate-200 bg-white p-3 text-sm" onToggle={(e) => void abrir((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-semibold">Llaves de la app</summary>
      <p className="mt-2 text-slate-600">«Edita ajustes»: puede usar los botones de ajuste manual. «Recibe alertas»: recibe el correo cuando la información lleva dos actualizaciones diarias sin poder actualizarse. Los administradores editan sin la llave, pero la alerta hay que dársela.</p>
      {error ? <p role="alert" className="mt-2 text-red-800">{error}</p> : null}
      {usuarios === null ? (
        <p className="mt-2 text-slate-500">Cargando…</p>
      ) : usuarios.length ? (
        <table className="mt-2 w-full text-left">
          <thead className="text-slate-600"><tr><th className="py-1">Usuario</th><th className="py-1">Edita ajustes</th><th className="py-1">Recibe alertas</th></tr></thead>
          <tbody>{usuarios.map((u) => (
            <tr key={u.userId} className="border-t border-slate-200">
              <td className="py-1.5">{u.nombre}<div className="text-slate-500">{u.email}{u.esAdmin ? ' · admin' : ''}</div></td>
              <td className="py-1.5"><input type="checkbox" aria-label={'Edita ajustes: ' + u.nombre} checked={u.editaAjustes} onChange={(e) => void cambiar(u, { editaAjustes: e.target.checked })} /></td>
              <td className="py-1.5"><input type="checkbox" aria-label={'Recibe alertas: ' + u.nombre} checked={u.recibeAlertas} onChange={(e) => void cambiar(u, { recibeAlertas: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <p className="mt-2 text-slate-500">Nadie tiene la app todavía. Asígnala desde la gestión de usuarios del portal.</p>
      )}
    </details>
  );
}
```

Crear `apps/equipos-taller/src/App.tsx`:

```tsx
import EquiposServicio from './EquiposServicio';

/** «Equipos en taller»: qué equipos están físicamente en el taller. Una sola pantalla. */
export default function App() {
  return <EquiposServicio />;
}
```

Crear `apps/equipos-taller/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Solo para `npm run dev` en local. En producción el portal importa App.tsx
// directamente y pone el CSS (Tailwind) desde su propio build.
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
```

- [ ] **Step 4: Ver que pasa, y los tipos**

```bash
npm test --workspace=apps/equipos-taller
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
```

Esperado: PASS (api 4 + pantalla 9 tests); `tsc` sin errores.

- [ ] **Step 5: Verificar fugas y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller/src
cd ../.. && git add apps/equipos-taller/src/EquiposServicio.tsx apps/equipos-taller/src/EquiposServicio.test.tsx apps/equipos-taller/src/PanelLlaves.tsx apps/equipos-taller/src/App.tsx apps/equipos-taller/src/main.tsx
git commit -m "feat(equipos-taller): pantalla trasladada con aviso de foto vieja, llaves y botones según permiso"
```

---

### Task 21: Encaje en el portal y en el Dockerfile

**Files:**
- Modify: `apps/portal/src/lib/apps.ts:29`, `apps/portal/src/App.tsx:29` y `:84`, `apps/portal/src/pages/Aplicaciones.tsx:14` y `:92-98`, `apps/portal/tailwind.config.js:18`, `Dockerfile:23`

Los cuatro puntos de registro de una sub-app (lo dice `tailwind.config.js`): el catálogo `APPS` (gestión de usuarios, AppGuard y Sidebar), la ruta perezosa, la tarjeta de Aplicaciones y las clases de Tailwind. Más el `COPY` del `package.json` en el Dockerfile raíz (el `npm ci` lo necesita para el workspace). No hay tarjeta en el Dashboard (supuesto A8).

- [ ] **Step 1: Catálogo de apps (herramienta Edit)**

En `apps/portal/src/lib/apps.ts`, tras la línea de `trazabilidad-mantenimientos` (línea 29), añadir:

```ts
  { id: 'equipos-taller', label: 'Equipos en taller', route: '/equipos-taller', category: 'aplicacion' },
```

- [ ] **Step 2: Ruta perezosa (herramienta Edit)**

En `apps/portal/src/App.tsx`, tras la línea 29 (`const TrazabilidadMantenimientos = …`), añadir:

```tsx
const EquiposTaller = lazyConReintento(() => import('../../equipos-taller/src/App'));
```

y tras la ruta de `/trazabilidad-mantenimientos/*` (línea 84), añadir:

```tsx
                    <Route path="/equipos-taller/*" element={<AppGuard appId="equipos-taller"><EquiposTaller /></AppGuard>} />
```

- [ ] **Step 3: Tarjeta en Aplicaciones (herramienta Edit)**

En `apps/portal/src/pages/Aplicaciones.tsx`, el import de iconos (línea 14) pasa de `  CalendarClock` a:

```tsx
  CalendarClock,
  Hammer
```

y tras la tarjeta de «Trazabilidad Mantenimientos Clientes» (cierra en la línea 98), añadir al array:

```tsx
  {
    name: "Equipos en taller",
    description: "Qué equipos están físicamente en el taller de servicio técnico, por fecha de llegada, cruzando las remisiones de Drive con los tickets de Desk.",
    path: "/equipos-taller",
    icon: Hammer,
    color: "from-orange-400 to-amber-600"
  }
```

(con la coma que haga falta tras la tarjeta anterior).

- [ ] **Step 4: Clases de Tailwind (herramienta Edit)**

En `apps/portal/tailwind.config.js`, tras `"../trazabilidad-mantenimientos/src/**/*.{js,ts,jsx,tsx}",` (línea 18), añadir:

```js
    "../equipos-taller/src/**/*.{js,ts,jsx,tsx}",
```

- [ ] **Step 5: Dockerfile raíz (herramienta Edit)**

En `Dockerfile`, tras `COPY apps/trazabilidad-mantenimientos/package*.json ./apps/trazabilidad-mantenimientos/` (línea 23), añadir:

```dockerfile
COPY apps/equipos-taller/package*.json ./apps/equipos-taller/
```

- [ ] **Step 6: Construir el portal (tsc -b comprueba la sub-app y el núcleo de hub-api) y sus pruebas**

```bash
npm run build --workspace=apps/portal
npm test --workspace=apps/portal
```

Esperado: `tsc -b && vite build` termina con `✓ built in …` y hay un chunk de la sub-app (`grep -l "Llaves de la app" apps/portal/dist/assets/*.js` lo encuentra). Las pruebas del portal pasan.

- [ ] **Step 7: Commit**

```bash
git add apps/portal/src/lib/apps.ts apps/portal/src/App.tsx apps/portal/src/pages/Aplicaciones.tsx apps/portal/tailwind.config.js Dockerfile
git commit -m "feat(equipos-taller): ruta, tarjeta y catálogo en el portal; COPY en el Dockerfile"
```

---

## Fase E — Página de Claude, documentación, limpieza y verificación

### Task 22: La página de Claude se construye desde el núcleo de hub-api (local)

**Files (locales, ignorados por git — no hay commit):**
- Move: `apps/equipos-desk2/packages/equipos/src/fuentes/claude.ts` → `apps/equipos-desk2/claude/fuentes-claude.ts`
- Modify: `apps/equipos-desk2/claude/entrada.ts`

Hasta que se retire la página de Claude (§9.6), se construye desde `apps/hub-api/src/equipos/nucleo/`. `claude/build.mjs` no cambia: empaqueta `entrada.ts`, que es lo que se reapunta. La plantilla lleva los IDs de las carpetas de Drive: por eso toda la carpeta sigue ignorada.

- [ ] **Step 1: Mover las fuentes de Claude junto a su página**

```bash
cp apps/equipos-desk2/packages/equipos/src/fuentes/claude.ts apps/equipos-desk2/claude/fuentes-claude.ts
```

En `apps/equipos-desk2/claude/fuentes-claude.ts`, las dos líneas de import (2 y 3) pasan a ser:

```ts
import { tix } from "../../hub-api/src/equipos/nucleo/reglas.js";
import type { ArchivoDrive, Fuentes, TicketZoho } from "../../hub-api/src/equipos/nucleo/tipos.js";
```

- [ ] **Step 2: Reapuntar la entrada**

Sustituir el contenido de `apps/equipos-desk2/claude/entrada.ts` por:

```ts
// Núcleo para la página de Claude: el MISMO código que corre en hub-api
// (apps/hub-api/src/equipos/nucleo), más las fuentes de los conectores de Claude, como window.Equipos.
import * as Nucleo from "../../hub-api/src/equipos/nucleo/index.js";
import { fuentesClaude } from "./fuentes-claude.js";

(globalThis as unknown as { Equipos: unknown }).Equipos = { ...Nucleo, fuentesClaude };
```

- [ ] **Step 3: Construir la página**

```bash
node apps/equipos-desk2/claude/build.mjs
```

Esperado: `claude/dist/index.html <n> bytes (núcleo <m> bytes)`. Nota: con `RETIRADOS_FIJOS` vacío (supuesto A3), en la página de Claude ese caso también se marca a mano con «Marcar retirado».

- [ ] **Step 4: Comprobar que no se ha colado nada en git**

```bash
git status --short
```

Esperado: nada de `apps/equipos-desk2/`.

---

### Task 23: Documentación

**Files:**
- Create: `docs/equipos-taller.md`, `apps/equipos-taller/CLAUDE.md`

- [ ] **Step 1: Crear `docs/equipos-taller.md`**

````markdown
# Equipos en taller

Qué equipos están **físicamente** dentro del taller de servicio técnico, ordenados por fecha de llegada. Cruza las remisiones de entrada y de salida de Google Drive con los tickets de Desk 2.0 y sus comentarios. Diseño: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`.

- App del portal: `equipos-taller` (ruta `/equipos-taller`, sub-app `apps/equipos-taller`).
- Motor: `apps/hub-api/src/equipos/`. Las reglas viven SOLO en `nucleo/` (puro, sin E/S); la pantalla lo importa por ruta relativa.
- Datos: `portal.equipos_*` (migración 071). Para psql: `portal.equipos_v_equipos` y `portal.equipos_v_remisiones_ilegibles`.

## Una corrida

1. **Candado:** se inserta la corrida «en curso» (`portal.equipos_ejecucion`). Si ya hay otra: 409 «Ya se está actualizando». Una corrida colgada más de 180 min se da por abandonada.
2. **Desk 2.0:** una sonda de `desk.tickets` y `desk.conversations`. Si falla → `desk2: <motivo>`.
3. **Drive y núcleo:** listado de las 3 carpetas, OCR solo de los PDF que no están en la caché (`exits`, versión CV del núcleo), tickets por serial y comentarios de los equipos que siguen adentro. Cualquier fallo de una fuente hace fallida la corrida (`drive: …` o `desk2: …`); el texto de OCR ya extraído se guarda igual. Excepción: un PDF concreto que Drive no puede pasar a texto va a remisiones ilegibles («Google Drive no pudo convertir este PDF a texto») y se reintenta en cada corrida; solo si fallan todos los intentados (2 o más) la corrida falla.
4. **Foto:** la foto y el cierre de la corrida, en una transacción.

Una corrida fallida **nunca** toca la foto: la pantalla sigue con la última buena y avisa («No se pudo leer Desk 2.0; datos del …»). La siguiente corrida es el reintento.

| Causa | Qué mirar |
|---|---|
| `desk2: sin configurar` | Falta `DESK2_DB_URL` en hub-api. |
| `desk2: sin conexión` / `tiempo agotado` | La base de Desk 2.0 no responde (mismo pool que Trazabilidad: 3 s para conectar, 5 s por consulta). |
| `desk2: consulta rechazada (permisos o esquema)` | Falta el `GRANT SELECT ON desk.conversations TO portal_agenda_reader`, o cambió una columna. |
| `drive: token rechazado (HTTP 4xx)` | La cuenta de servicio (`EQUIPOS_GOOGLE_CUENTA_SERVICIO`) no vale o está deshabilitada. |
| `drive: HTTP 403` / `404` | A la cuenta de servicio le falta una carpeta compartida (lectura en las 3; edición en la temporal). |
| `drive: no se pudo convertir ningún PDF (HTTP 4xx)` | Fallan todos los PDF al pasarlos a texto: casi siempre, a la cuenta de servicio le falta edición en la carpeta temporal del OCR. (Un solo PDF que falla no aparece aquí: sale en remisiones ilegibles.) |

## Corrida diaria e incidentes

- A las `EQUIPOS_HORA_DIARIA` de Colombia (06:30 por defecto). No hay corrida de recuperación al arrancar: si un despliegue cae después de la hora, usar el botón.
- **Incidente:** lo abre la primera corrida fallida tras una buena; solo las corridas **programadas** suman fallos; con 2 seguidos se envía **una** alerta; si el envío falla se guarda el error (`alerta_ultimo_error`) y se reintenta en la siguiente programada; una corrida buena lo cierra.
- **Destinatarios:** los usuarios activos con la llave «recibe alertas»; si no hay ninguno, `EQUIPOS_ALERTA_RESERVA` (por defecto comercial@ambientalia.com.co). Solo direcciones `@ambientalia.com.co`.

```sql
-- Últimas corridas y el incidente abierto
SELECT id, origen, inicio, fin, ok, causa FROM portal.equipos_ejecucion ORDER BY id DESC LIMIT 10;
SELECT * FROM portal.equipos_incidente WHERE cerrado_en IS NULL;
```

## Permisos

| Acción | Quién |
|---|---|
| Abrir, filtrar, «Actualizar información» | Quien tenga la app `equipos-taller`, y los admin. |
| Ajustes manuales («Sigue en taller», «Confirmar salida», «Marcar retirado», «Deshacer ajuste», «Ya revisada») | La llave `edita_ajustes`, o ser admin. |
| Gestionar las llaves («Llaves de la app», al final de la pantalla) | Los admin. |
| Recibir la alerta | La llave `recibe_alertas` (los admin no la tienen por defecto). |

La migración no siembra ni la app ni las llaves: se asignan a mano.

## Variables de hub-api

| Variable | Uso |
|---|---|
| `EQUIPOS_GOOGLE_CUENTA_SERVICIO` | JSON de la cuenta de servicio, en una línea. Sin ella (o sin alguna carpeta) el módulo queda «sin configurar». ⚠️ No cargarla en EasyPanel mientras EasyPanel imprima las variables en el log de build. |
| `EQUIPOS_DRIVE_ENTRADAS`, `EQUIPOS_DRIVE_SALIDAS_N8N`, `EQUIPOS_DRIVE_SALIDAS_ESCANEADAS`, `EQUIPOS_DRIVE_TEMPORAL` | IDs de las carpetas. No se escriben en el repo. |
| `EQUIPOS_HORA_DIARIA` | HH:MM de Colombia. Por defecto `06:30`. |
| `EQUIPOS_ALERTA_WEBHOOK_URL`, `EQUIPOS_ALERTA_TOKEN` | El webhook de n8n y su token. Sin los dos, la alerta queda apagada (lo dice el log al arrancar). |
| `EQUIPOS_ALERTA_RESERVA` | Dirección de reserva. Por defecto comercial@ambientalia.com.co. |
| `DESK2_DB_URL` | Ya existe (Trazabilidad). Si falta, todas las corridas fallan con `desk2: sin configurar`. |

## Flujo de n8n «Equipos · Alerta de foto vieja»

Lo crea el usuario en n8n, **inactivo** hasta que se configure la alerta. hub-api lo llama así:

- **Petición:** `POST <EQUIPOS_ALERTA_WEBHOOK_URL>`, `Content-Type: application/json`, cabecera `X-Equipos-Alerta-Token: <EQUIPOS_ALERTA_TOKEN>`. hub-api no sigue redirecciones y espera 30 s como mucho.
- **Cuerpo:**

  ```json
  { "referencia": 12, "para": ["persona@ambientalia.com.co"], "asunto": "Equipos en taller: la información no se actualiza desde el …", "cuerpo": "La actualización diaria de «Equipos en taller» ha fallado 2 veces seguidas.\n\n…" }
  ```

  `referencia` es el id del incidente. `para` trae de 1 a N direcciones, todas `@ambientalia.com.co`. `cuerpo` es texto plano con párrafos separados por una línea en blanco.

- **Nodos:**
  1. **Webhook** (POST) con la credencial **Header Auth** (nombre `X-Equipos-Alerta-Token`, valor = el token). Respuesta: «Using 'Respond to Webhook' node».
  2. **Barrera de dominio** (IF / Code): si alguna dirección de `para` no termina en `@ambientalia.com.co`, o `asunto` está vacío → **Respond to Webhook** `422` con `{ "ok": false, "error": "destino fuera del dominio" }` y nada más.
  3. **Enviar correo** (Gmail o SMTP de la cuenta de servicio técnico) a `para`, con `asunto` y `cuerpo`.
  4. **Respond to Webhook** `200` con `{ "ok": true }`. Si el envío falla, `500` con `{ "ok": false, "error": "<motivo corto>" }` (sin datos de la cuenta).
- **Cómo lo entiende hub-api:** solo `2xx` con `{ "ok": true }` es «enviado» (se guarda `alerta_enviada_en`). Cualquier otra cosa se guarda en `alerta_ultimo_error` como `n8n respondió <código>[: <error>]` (sin el token, cortado a 300 caracteres) y se reintenta en la siguiente corrida programada del mismo incidente.

## Datos de prueba y privacidad

El repo es público. Las fixtures del núcleo (`apps/hub-api/src/equipos/nucleo/fixtures/`) están **anonimizadas** con `apps/hub-api/scripts/equipos-anonimizar.mjs`: clientes, seriales, tickets y textos sustituidos de forma determinista, conservando las peculiaridades del OCR. Las reales, `roles.local.json` y el prompt original solo existen en local (`apps/hub-api/src/equipos/nucleo/fixtures-reales/` y `apps/equipos-desk2/`, ignorados por git).

```bash
cd apps/hub-api
node scripts/equipos-anonimizar.mjs generar src/equipos/nucleo/fixtures-reales src/equipos/nucleo/fixtures   # regenerar
node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos ../equipos-taller  # buscar fugas
```

`nucleo/reales.local.test.ts` comprueba en local que las anonimizadas están al día y que el núcleo da lo mismo con unas y otras; sin las reales se salta sola.

## Pendiente (§10 del diseño)

- **Enero de 2027:** en los tickets nacidos en Desk 2.0 la recogida es la transición «Entrega al cliente», no un comentario. Revisar la regla 6 (con `desk.ticket_transitions`) antes de que esos tickets empiecen a cerrarse.
- `public.remisiones` de Desk 2.0 podría sustituir a la lectura de las carpetas de entrada.
````

- [ ] **Step 2: Crear `apps/equipos-taller/CLAUDE.md`**

````markdown
# Equipos en taller (sub-app)

Pantalla de la app `equipos-taller` del portal: qué equipos están físicamente en el taller. Documentación de operación (variables, causas de fallo, contrato de n8n): `docs/equipos-taller.md`. Diseño: `docs/superpowers/specs/2026-11-10-equipos-taller-portal-design.md`.

## Dónde está cada cosa

- **Reglas:** `apps/hub-api/src/equipos/nucleo/` (puro). Es la ÚNICA fuente de verdad: la pantalla lo importa por ruta relativa (`src/nucleo.ts`) y no copia ninguna regla. `nucleo/pureza.test.ts` impide que importe nada de fuera de su carpeta.
- **Contrato de la API:** `apps/hub-api/src/equipos/contrato.ts` (tipos, claves de ajuste, aviso de foto vieja).
- **Servidor:** `apps/hub-api/src/equipos/` (fuentes, servicio, repo, router, programador). Rutas bajo `/api/equipos-taller`.
- **Pantalla:** `src/EquiposServicio.tsx` (trasladada sin rediseño de Desk 2.0), `src/PanelLlaves.tsx` (solo admin), `src/api.ts`.

## Reglas de trabajo

- **No es un rediseño.** Vistas, filtros, columnas, motivos y ajustes manuales no cambian; si algo de la clasificación está mal, se corrige en el núcleo, con su prueba.
- **Repo público.** Ni clientes, ni seriales, ni tickets, ni IDs de Drive reales en el código, las pruebas o los comentarios. Datos de prueba inventados (`18A90417`, `CLIENTE A`…). Antes de commitear: `cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos ../equipos-taller`.
- La pantalla solo **oculta** botones según `permisos`: el servidor comprueba cada llave.

## Pruebas

```bash
npm test --workspace=apps/equipos-taller                 # api (node) y pantalla (jsdom)
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
cd apps/hub-api && npx vitest run src/equipos scripts     # núcleo y servidor (nunca desde la raíz)
cd apps/hub-api && npx vitest run --config vitest.db.config.ts src/equipos   # contra Postgres (Docker)
npm run build --workspace=apps/portal                    # tsc -b del portal comprueba esta sub-app
```
````

- [ ] **Step 3: Verificar fugas y commit**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales ../../docs/equipos-taller.md ../equipos-taller/CLAUDE.md
cd ../.. && git add docs/equipos-taller.md apps/equipos-taller/CLAUDE.md
git commit -m "docs(equipos-taller): variables, contrato del webhook de n8n y operación"
```

---

### Task 24: Limpiar `apps/equipos-desk2` (local)

**Files (locales, ignorados — no hay commit):**
- Delete: `apps/equipos-desk2/apps/`, `apps/equipos-desk2/packages/`

Solo cuando las Tareas 1-23 están hechas: las fixtures reales ya viven en `apps/hub-api/src/equipos/nucleo/fixtures-reales/` (Tarea 1) y las fuentes de Claude en `claude/` (Tarea 22).

- [ ] **Step 1: Comprobar que lo que se va a borrar ya tiene sitio**

```bash
ls apps/hub-api/src/equipos/nucleo/fixtures-reales/
ls apps/equipos-desk2/claude/fuentes-claude.ts
```

Esperado: `escaneos-reales.json  extraer-roles.mjs  remisiones.json  roles.local.json  tickets.json` y el fichero de Claude.

- [ ] **Step 2: Borrar**

```bash
rm -rf apps/equipos-desk2/apps apps/equipos-desk2/packages
ls apps/equipos-desk2
git status --short
```

Esperado: quedan `Prompt.txt`, `claude/`, `INTEGRACION.md` y `.env.ejemplo`; `git status` no cambia (todo está ignorado).

- [ ] **Step 3: La página de Claude sigue construyendo**

```bash
node apps/equipos-desk2/claude/build.mjs
```

Esperado: igual que en la Tarea 22.

---

### Task 25: Verificación final

- [ ] **Step 1: hub-api, unitarios (desde `apps/hub-api`, nunca desde la raíz)**

```bash
cd apps/hub-api && npx vitest run
```

Esperado: todos los ficheros en verde, incluidos `src/equipos/**`, `scripts/equipos-anonimizar.test.mjs` y `src/env-example.test.ts` (con el bloque del usuario de la Tarea 6). `reales.local.test.ts` corre en local y sale `skipped` donde no están las fixtures reales.

- [ ] **Step 2: hub-api contra Postgres** (Docker Desktop encendido)

```bash
cd apps/hub-api && npm run test:db
```

Esperado: todos en verde, incluidos `src/equipos/repo.db.test.ts` (12) y `src/equipos/fuente-desk2.db.test.ts` (4).

- [ ] **Step 3: Tipos de hub-api (lo que compila el Dockerfile)**

```bash
cd apps/hub-api && npx tsc -p tsconfig.json --noEmit
```

Esperado: ningún error salvo, en local, el ya existente de `barril.test.ts` con `micromatch` (Tarea 17, paso 6).

- [ ] **Step 4: Sub-app y portal**

```bash
npm test --workspace=apps/equipos-taller
npx tsc --noEmit -p apps/equipos-taller/tsconfig.json
npm run build --workspace=apps/portal
npm test --workspace=apps/portal
```

Esperado: todo en verde; el build del portal (`tsc -b && vite build`) termina con `✓ built in …`.

- [ ] **Step 5: Privacidad**

```bash
cd apps/hub-api && node scripts/equipos-anonimizar.mjs verificar src/equipos/nucleo/fixtures-reales src/equipos scripts ../equipos-taller ../../docs/equipos-taller.md ../../docs/superpowers/plans/2026-11-10-equipos-taller-portal.md
cd ../.. && git log --format=%B main..HEAD | grep -ci "co-authored" || true
git status --short
```

Esperado: `Sin valores reales en: …`; el `grep` cuenta `0` (ningún commit lleva atribución); `git status` sin nada de `apps/equipos-desk2/` ni de `fixtures-reales/`.

---

## Pasos manuales (usuario)

No son tareas del agente. Copiados de §9 del diseño, con lo que este plan añade marcado como *(plan)*.

1. **Requisitos, que hace Gerencia:**
   - `GRANT SELECT ON desk.conversations TO portal_agenda_reader;` (`desk.ticket_transitions` ya está concedido).
   - Crear la cuenta de servicio y compartirle las carpetas. A `REMISIONES 2026\SALIDA` le falta hoy.
   - Crear la carpeta temporal del OCR.
   - Crear el flujo de n8n «Equipos · Alerta de foto vieja», **inactivo**, con su token y la barrera de dominio (contrato en `docs/equipos-taller.md`).
2. **Desplegar** primero hub-api y justo después el portal.
3. **Asignar** a mano la app y las llaves (§6): el Director Comercial y el Director Técnico reciben la app `equipos-taller`, `edita_ajustes` y `recibe_alertas` (la app desde la gestión de usuarios; las llaves desde «Llaves de la app», al final de la pantalla, como admin).
4. **Cuando la rotación de secretos esté resuelta,** cargar las variables de Drive (`EQUIPOS_GOOGLE_CUENTA_SERVICIO`, `EQUIPOS_DRIVE_*`) y lanzar la primera corrida con el botón. Hace el OCR de unos 190 PDF y tarda varios minutos; la pantalla consulta el estado cada 3 s.
   - *(plan, A5)* Esa primera corrida confirma la forma de `desk.conversations`: si la regla de comentarios no encuentra ninguna recogida que la página de Claude sí ve, revisar los valores de `kind` y dónde vienen los adjuntos en `raw`.
   - *(plan, A4)* Mirar los avisos de esa corrida: «N tickets de Desk 2.0 sin campos personalizados (raw.cf)» dice cuántos tickets se enlazan solo con sus columnas.
5. **Validar en paralelo, el mismo día:** comparar la pestaña «En taller» y la lista de ilegibles con la página de Claude. La referencia del 7–9/11/2026 es de 21 equipos en taller (19 GRIMM y 2 Horiba). Si hay diferencias por el orden del texto del OCR, se corrigen en el núcleo.
   - *(plan, A3)* El caso que estaba fijo en `RETIRADOS_FIJOS` (devuelto a fábrica, sin remisión de salida) se marca con «Marcar retirado» en su fila.
6. **Retirar la página de Claude** solo cuando coincidan las dos. Hasta entonces, `claude/build.mjs` se construye desde `apps/hub-api/src/equipos/nucleo/` (Tarea 22).
7. **Limpiar** `apps/equipos-desk2/`: hecho en local en la Tarea 24 (se eliminan `apps/desk`, `apps/hub-sync` y `packages/equipos`). `Prompt.txt` y las fixtures reales se quedan en local.
8. *(plan)* Cuando se configure la alerta: cargar `EQUIPOS_ALERTA_WEBHOOK_URL` y `EQUIPOS_ALERTA_TOKEN` (el mismo token que la credencial «Header Auth» del flujo) y activar el flujo de n8n.
