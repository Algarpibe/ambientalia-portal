# Envío manual de los avisos a clientes — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos llevan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que cada tarjeta de «Avisos a clientes» tenga un botón «Enviar correo» que manda de verdad el aviso desde info@ (vía n8n + Gmail), con un interruptor de servidor (apagado / prueba / real) que falla cerrado, un registro de cada envío y una sola pantalla en lugar de las vistas «Manual» y «Simulación automática».

**Arquitectura:** el plan de avisos (`planAvisos`) gana un cuarto tramo, «vencida». La redacción del correo se mueve a un módulo puro de hub-api (`avisos-correo.ts`) que comparten el servidor y la app, así que lo que se ve es lo que sale. El servidor vuelve a calcular la tarjeta al pulsar «Enviar», la apunta «en curso» en `portal.tmc_avisos_envios` (índice único parcial contra el doble envío), la entrega a un único módulo de red (`envio-avisos.ts`, Webhook de n8n con token y 30 s de espera) y la cierra según la respuesta; en modo real marca los equipos con `registrarAvisos` en la misma transacción.

**Tecnología:** TypeScript, Express + PostgreSQL (`@algarpibe/zoho-sync`) en hub-api, React 19 + Vite en la sub-app, Vitest (unitarias y `*.db.test.ts` con testcontainers), n8n (Webhook → Code → If → Gmail → Respond to Webhook) por su MCP.

**Diseño aprobado:** `docs/superpowers/specs/2026-11-08-envio-avisos-clientes-design.md` (léelo entero antes de empezar).

---

## Convenciones de ejecución (obligatorias)

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07` (en Git Bash: `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`). Todos los comandos parten de ahí.
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write / Edit. Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero.
- **Git:** con la herramienta **Bash (Git Bash)**, no con PowerShell (PowerShell 5.1 estropea las tildes de los mensajes). Mensajes con `git commit -F - <<'EOF' … EOF`. Conventional commits, **sin línea «Co-Authored-By» ni atribución**. Se añaden rutas explícitas: nunca `git add -A` ni `git add .`, nunca `git stash`. No se tocan `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/` (ya están modificados o sin seguimiento, y son del usuario).
- **Ramas:** cada lote es una rama `feat/…` que acaba con `git merge --no-ff` en `main` y `git push origin main` (autorización permanente del usuario). Empujar NO despliega: el despliegue lo hace Alfonso a mano en EasyPanel, **hub-api primero y después el portal**.
- **Tamaño:** cada lote, menos de 800 líneas cambiadas (`git diff --shortstat -M main...HEAD`: inserciones + borrados).
- **Repo público:** datos ficticios siempre (`Cliente Uno`, `Cliente Ficticio A`, seriales `18A0000x`, correos `@example.com` / `@cliente-uno.example`, buzón de prueba `buzon-prueba@ambientalia.com.co`). Nunca abrir `apps/trazabilidad-mantenimientos/data/*.xlsx`, ni leer `.env` ni secretos. El token de n8n no pasa nunca por el chat.
- **TDD estricto** en la lógica pura: prueba que falla, verla fallar, código mínimo, verla pasar, commit.
- **Pruebas de hub-api:** `Push-Location apps/hub-api; npx vitest run <fichero>; Pop-Location` (PowerShell). Las de BD (`*.db.test.ts`) necesitan Docker Desktop encendido (`docker desktop start`) y van con `--config vitest.db.config.ts`. **Nunca lances vitest desde la raíz** (mete los `.db.test.ts` y salen unos 281 fallos falsos). Docker se para con `docker desktop stop`, nunca con `wsl --shutdown`.
- **Pruebas de la sub-app:** `Push-Location apps/trazabilidad-mantenimientos; npm test; Pop-Location` y `npm run typecheck` (sólo lógica pura en `src/lib`, entorno node).
- **Errores conocidos que no son de este trabajo:** `npx tsc -p tsconfig.json --noEmit` en hub-api da un error en `src/ausencias/service/barril.test.ts` (tipos de `micromatch`); no lo persigas. Bajo carga, la prueba 4.4 de usuarios de hub-api puede caer por tiempo: repítela sola antes de investigar.
- **SQL de verificación con datos:** lo ejecuta Alfonso en su `psql` del servidor, tras `\c zoho-hub`. No se intenta conectar a la base desde esta máquina.

## Decisiones tomadas en el plan (revisar con Alfonso antes de ejecutar)

El código choca con el diseño en estos puntos. El plan sigue la opción marcada. D1 y D2 los decidió Alfonso el 2026-11-08: los candados que decían «ninguna tabla de envíos» pasan a decir «una sola, `tmc_avisos_envios`, y ninguna más» (igual de estrictos: otra tabla de envíos los hace fallar). Ningún otro candado cambia.

| # | Choque | Opción del plan |
|---|---|---|
| D1 | La tabla `portal.tmc_avisos_envios` del diseño no pasa dos candados de BD que prohíben tablas `tmc*` con «envio»: `calibraciones.db.test.ts:480` (`'outbox\|envio\|mensaje\|cola\|pendiente'`) y `edicion.db.test.ts:161` (`'outbox\|envio\|mensaje\|correo'`). | **Decidido por Alfonso (2026-11-08):** se mantiene el nombre del diseño, **`portal.tmc_avisos_envios`**, y los dos candados pasan de esperar `[]` a esperar exactamente esa tabla (Tarea 2.1, paso 5). Renombrarla para esquivar el patrón se descartó: el candado seguiría en verde sin proteger lo que protege. |
| D2 | `trazabilidad.db.test.ts:337` fija la lista exacta de tablas `tmc_*` y su título dice «ninguna tabla del módulo guarda mensajes ni envíos: el aviso automático es sólo una simulación». | **Decidido por Alfonso (2026-11-08):** se **amplía** la lista con `tmc_avisos_envios` (el mecanismo de siempre) y se **corrige el título** a la regla nueva. |
| D3 | La guarda de permisos de `router.test.ts:296-300` exige que un rol con permiso reciba 200 o 404 tras alguna consulta. Con la base de mentira no hay tarjetas. | Tarjeta que ya no existe → **404 `tarjeta_no_encontrada`**; tarjeta que existe con otros equipos → **409 `tarjeta_cambiada`** (el 409 del diseño). Los dos piden recargar. |
| D4 | «Se retira la ruta de marcar en bloque». | Queda registrada con `retirada()` → **410 `marcar_retirado`**, como las dos subidas de la Excel: un portal sin actualizar recibe un mensaje claro. Entre el despliegue de hub-api (lote 2) y el del portal (lote 3), «Marcar N como avisados» de la vista vieja da ese 410. |
| D5 | El texto de «vencida» sólo trae el singular «las mediciones del equipo». | En plural: «las mediciones **de los equipos**» (junto a «enviarnos los equipos», que sí está en el diseño). |
| D6 | La 068 da permisos a `portal_app` en cada arranque, pero corre ANTES que la 069: sin más, la tabla nueva no le llegaría hasta el arranque siguiente (`db.roles.db.test.ts:120` lo dice: «en el siguiente arranque»). | La 069 da **sus propios permisos** a `portal_app` (bloque `DO` con `IF EXISTS`, como la 068). |

Además, por el límite de 800 líneas, quedan **sin borrar** tras el lote 3 (código muerto, con sus pruebas): `candidatosAviso`, `avisosPorCliente`, `GrupoAviso` (`src/lib/vistas.ts`) y la rama «sin tramo» de `mensajeAviso` (`avisos-correo.ts`). Es una limpieza aparte.

## Mapa de ficheros

| Fichero | Lote | Qué |
|---|---|---|
| `apps/hub-api/src/trazabilidad/dominio.ts` | 1 | `TRAMOS_AVISO` con `'vencida'`; `evaluarAviso` y `planAvisos` sin `vencidasSinAviso`; orden de tarjetas |
| `apps/hub-api/src/trazabilidad/avisos-correo.ts` (nuevo) | 1 | Puro y compartido: texto por tramo (movido de la app), «vencida», `correoReal`, `correoDePrueba`, tipos del envío (`EstadoCanal`, `CanalAvisos`, `EnvioAviso`…), `mismaHuella`, `estadoPresentado` |
| `apps/hub-api/src/trazabilidad/avisos-correo.test.ts` (nuevo) | 1 | Texto letra a letra, prueba, huella, estado, candado de pureza |
| `apps/hub-api/src/trazabilidad/avisos.test.ts` | 1 | El tramo «vencida» en el plan |
| `apps/hub-api/src/trazabilidad/calibraciones.db.test.ts`, `marcas.db.test.ts` | 1 | Dejan de leer `vencidasSinAviso` |
| `apps/trazabilidad-mantenimientos/src/dominio.ts` | 1 | Reexporta `avisos-correo` |
| `apps/trazabilidad-mantenimientos/src/lib/simulacion.ts`, `vistas.ts` | 1 | Reexportan la redacción; `fechaRelevante` con «vencida» |
| `apps/trazabilidad-mantenimientos/src/lib/simulacion.test.ts` | 1 | `fechaRelevante` y sin `vencidasSinAviso` |
| `apps/trazabilidad-mantenimientos/src/vistas/SimulacionAvisos.tsx` | 1, 3 | Etiqueta y tono de «vencida» (1); se renombra a `TarjetasAvisos.tsx` (3) |
| `apps/hub-api/src/users/migrations/069_trazabilidad_avisos_envios.sql` (nuevo) + `apps/hub-api/src/db.ts` | 2 | La tabla del registro |
| `apps/hub-api/src/trazabilidad/envio-avisos.ts` (nuevo) | 2 | El ÚNICO módulo de red: interruptor y entrega a n8n |
| `apps/hub-api/src/trazabilidad/envio-avisos.test.ts` (nuevo) | 2 | Guardas de la 069, interruptor, entrega con red falsa, candados nuevos |
| `apps/hub-api/src/trazabilidad/avisos-envios-repo.ts` (nuevo) | 2 | El flujo de «Enviar correo» y el SQL del registro |
| `apps/hub-api/src/trazabilidad/avisos-envios.db.test.ts` (nuevo) | 2 | El flujo entero contra Postgres, con canal falso |
| `apps/hub-api/src/trazabilidad/types.ts`, `router.ts`, `roles.ts`, `router.test.ts`, `trazabilidad.db.test.ts` | 2 | Validadores, rutas, retirada, permiso, guardas |
| `apps/trazabilidad-mantenimientos/src/lib/envios.ts` + `envios.test.ts` (nuevos) | 3 | Rótulo, estados, botón |
| `apps/trazabilidad-mantenimientos/src/api.ts` | 3 | `envios`, `enviarAviso`, `resolverEnvio`; fuera `registrarAvisos` |
| `apps/trazabilidad-mantenimientos/src/vistas/Avisos.tsx`, `TarjetasAvisos.tsx` | 3 | La pantalla única |
| `apps/trazabilidad-mantenimientos/src/vistas/Roles.tsx`, `FichaEquipo.tsx` | 3 | Textos |
| `apps/trazabilidad-mantenimientos/CLAUDE.md`, `docs/PRIVACY-RETENTION.md` | 3 | Documentación |
| `docs/n8n-automatizaciones.md` | 4 | El flujo nuevo |

---

## Paso 0 — Guardar este plan en `main`

- [ ] **Paso 0.1: rama, commit y merge del plan (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main && git pull --ff-only
git switch -c docs/plan-envio-avisos
git add docs/superpowers/plans/2026-11-08-envio-avisos-clientes.md
git commit -F - <<'EOF'
docs(trazabilidad): plan de implementación del envío de avisos a clientes
EOF
git switch main
git merge --no-ff docs/plan-envio-avisos -m "merge: plan del envío manual de avisos"
git push origin main
```

Esperado: `git status --short` sólo enseña lo de antes (`M .gitignore`, `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`).

---

# LOTE 1 — Dominio puro: grupo «vencida», redacción en hub-api y versión de prueba

Rama: `feat/avisos-vencida-redaccion`. Sólo lógica pura y lo justo de la app para que compile. No cambia nada del servidor en ejecución (nadie en hub-api llama aún a la redacción); en la app, las vencidas pasan de informativo a tarjetas «Vencida».

- [ ] **Paso 1.0: rama (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main && git pull --ff-only && git switch -c feat/avisos-vencida-redaccion
```

## Tarea 1.1: Mover la redacción del aviso a hub-api (refactor, sin cambiar una letra)

**Ficheros:**
- Crear: `apps/hub-api/src/trazabilidad/avisos-correo.ts`
- Crear: `apps/hub-api/src/trazabilidad/avisos-correo.test.ts`
- Modificar: `apps/trazabilidad-mantenimientos/src/dominio.ts:5`
- Modificar: `apps/trazabilidad-mantenimientos/src/lib/simulacion.ts:1-67`
- Modificar: `apps/trazabilidad-mantenimientos/src/lib/vistas.ts:6` y `:169-221`
- Prueba (sin tocar): `apps/trazabilidad-mantenimientos/src/lib/simulacion.test.ts`, `vistas.test.ts` (importan de `./simulacion` y `./vistas`, que reexportarán)

- [ ] **Paso 1: escribir la prueba que falla** — crear `apps/hub-api/src/trazabilidad/avisos-correo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { correoAviso, fechaDia, marcaAviso, mensajeAviso, saludoAviso, todosGrimm } from './avisos-correo.js';
import { estadoCalibracion, planAvisos, type ContactoEquipo } from './dominio.js';

// El texto del aviso a clientes: el que sale de verdad al pulsar «Enviar correo»
// (lo redacta el servidor) y el que enseña la app. Aquí se fija letra a letra.
// Más casos, con la `EquipoVista` de la app, en
// apps/trazabilidad-mantenimientos/src/lib/simulacion.test.ts y vistas.test.ts.

const HOY = '2026-10-06';
const EN_30 = '2025-10-17'; // vence 2026-10-17 (quedan 11 d) → tramo 30

let n = 0;
/** Un equipo como lo da GET /equipos (lo que necesitan el plan y el texto): GRIMM de 365 días salvo que se diga otra marca. */
function eq(cliente: string, ultimaCalibracion: string, contacto: ContactoEquipo | null = null, marca = 'Grimm', modelo = 'EDM 180C') {
  const serial = `18A${String(++n).padStart(5, '0')}`;
  const { vence, vigenciaDias } = estadoCalibracion(ultimaCalibracion, HOY, 365);
  return { clave: serial, serial, cliente, marca, modelo, ultimaCalibracion, vigenciaMarca: 365, vence, vigenciaDias, seguimiento: null, ticket: null, contacto };
}
const desk = (email: string, nombre = ''): ContactoEquipo => ({ nombre, email, origen: 'desk', ticket: 950 });
/** La tarjeta (con o sin destinatario) de esos equipos. */
const tarjeta = (equipos: ReturnType<typeof eq>[]) => {
  const p = planAvisos(equipos, HOY);
  return [...p.correos, ...p.sinDestinatario][0];
};

describe('el texto del aviso (movido de la app sin cambiar una letra)', () => {
  it('fechas como en la app: DD/MM/AAAA, y «—» sin fecha', () => {
    expect(fechaDia('2026-09-03')).toBe('03/09/2026');
    expect([fechaDia(null), fechaDia(undefined), fechaDia('')]).toEqual(['—', '—', '—']);
  });

  it('marca: «GRIMM» para los GRIMM y la suya para los demás', () => {
    expect([marcaAviso({ marca: 'Grimm' }), marcaAviso({ marca: ' Horiba ' })]).toEqual(['GRIMM', 'Horiba']);
    expect([todosGrimm([{ marca: 'GRIMM' }, { marca: 'grimm' }]), todosGrimm([{ marca: 'Grimm' }, { marca: 'Horiba' }])]).toEqual([true, false]);
  });

  it('el de 30 días, entero: asunto, saludo por su nombre, entrada, línea del equipo, propuesta y firma', () => {
    const e = eq('Cliente Uno', EN_30, desk('compras@cliente-uno.example', 'Ana Pérez'));
    const c = correoAviso(tarjeta([e]));
    expect(c.para).toBe('compras@cliente-uno.example');
    expect(c.asunto).toBe('Último aviso: la calibración de su monitor GRIMM vence en los próximos 30 días · Cliente Uno');
    expect(c.cuerpo).toBe(
      [
        'Estimado/a Ana Pérez:',
        '',
        'Desde el Servicio Técnico de Ambientalia le recordamos, como último aviso, que la calibración del siguiente monitor de partículas GRIMM vence en los próximos 30 días:',
        '',
        `• GRIMM EDM 180C, serial ${e.serial}: última calibración 17/10/2025, vence el 17/10/2026.`,
        '',
        'Para mantener la validez de sus mediciones y evitar paradas no previstas, le proponemos programar desde ahora el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.',
        '',
        'Quedamos atentos.',
        '',
        'Ambientalia S.A.S. · Servicio Técnico',
      ].join('\n'),
    );
  });

  it('sin tramo, el texto genérico; sin nombre, el saludo genérico', () => {
    expect(mensajeAviso('Cliente Uno', [eq('Cliente Uno', EN_30)])).toMatch(
      /^Estimado cliente Cliente Uno:\n\nDesde el Servicio Técnico de Ambientalia le recordamos que el siguiente monitor de partículas GRIMM tiene la calibración vencida o próxima a vencer:/,
    );
    expect(saludoAviso('Cliente Uno', [])).toBe('Estimado cliente Cliente Uno:');
  });
});

describe('CANDADO: avisos-correo.ts es puro (lo carga también la app del portal)', () => {
  const src = readFileSync(fileURLToPath(new URL('./avisos-correo.ts', import.meta.url)), 'utf8');

  it('sólo importa el dominio', () => {
    expect([...src.matchAll(/^import\b[^;]*?from '([^']+)';/gms)].map((m) => m[1])).toEqual(['./dominio.js']);
  });

  it('ni reloj, ni entorno, ni red, ni temporizadores', () => {
    expect(src).not.toMatch(/Date\.now|new Date\(|process\.env|\bfetch\b|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});
```

- [ ] **Paso 2: verla fallar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/avisos-correo.test.ts; Pop-Location`
Esperado: FAIL — `Failed to load url ./avisos-correo.js` (o `ENOENT … avisos-correo.ts`).

- [ ] **Paso 3: crear el módulo con el código movido** — `apps/hub-api/src/trazabilidad/avisos-correo.ts`:

```typescript
/**
 * El correo del aviso a clientes de Trazabilidad: su texto (asunto y cuerpo
 * por tramo) y, desde el envío (2026-11-08), lo que sale de verdad, su versión
 * de prueba y la forma de los envíos que sirve la API.
 *
 * Puro: sólo importa el dominio; sin Node, sin base, sin red y sin reloj. Lo
 * usan el servidor, que redacta con él lo que sale al pulsar «Enviar correo»,
 * y la app del portal, que enseña ese mismo texto antes de enviarlo: los dos
 * dicen siempre lo mismo, letra a letra. `avisos-correo.test.ts` vigila que no
 * gane imports ni llamadas.
 */
import { claveCliente, type CorreoSimulado, type Destinatario, type EquipoAviso, type TramoAviso } from './dominio.js';

/** Lo que el texto del aviso necesita de un equipo (la `EquipoVista` del servidor lo cumple). */
export interface EquipoTexto {
  serial: string;
  marca: string;
  modelo: string;
  ultimaCalibracion: string | null;
  /** AAAA-MM-DD, o null. */
  vence: string | null;
  /** Negativo = vencida hace N días. */
  vigenciaDias: number | null;
}

/** Un día AAAA-MM-DD escrito DD/MM/AAAA, como en la app; sin fecha, «—». Las fechas del aviso son días sueltos: no hay zona que convertir. */
export function fechaDia(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—';
}

/** La marca de un equipo en el texto de un aviso: «GRIMM», como siempre, o la suya si es de otra marca incluida (lote 9f). */
export const marcaAviso = (e: Pick<EquipoTexto, 'marca'>): string => (claveCliente(e.marca) === 'grimm' ? 'GRIMM' : e.marca.trim());
/** Si todos son GRIMM: entonces el aviso habla de «monitores de partículas GRIMM», como siempre. */
export const todosGrimm = (eqs: readonly Pick<EquipoTexto, 'marca'>[]): boolean => eqs.every((e) => claveCliente(e.marca) === 'grimm');

/** Lo que cambia en el texto del aviso cuando es el de un tramo. */
export interface OpcionesAviso {
  /** El tramo: cambia la frase de entrada. Sin él, el texto genérico de siempre. */
  tramo?: TramoAviso;
  /** La primera línea. Sin ella, «Estimado cliente …:». */
  saludo?: string;
}

/** Cómo empieza la frase de entrada en cada tramo: primer aviso, recordatorio y último aviso. */
const ENTRADA_TRAMO: Record<TramoAviso, string> = {
  90: 'le informamos con antelación de que',
  60: 'le recordamos que',
  30: 'le recordamos, como último aviso, que',
};

/**
 * Texto del aviso al cliente. Con `opciones.tramo` es el de ese tramo: mismo
 * cuerpo, con la frase de entrada propia del tramo.
 */
export function mensajeAviso(cliente: string, equipos: readonly EquipoTexto[], opciones: OpcionesAviso = {}): string {
  const lineas = equipos
    .map((e) => {
      const cuando = (e.vigenciaDias ?? 0) < 0 ? `vencida desde el ${fechaDia(e.vence)}` : `vence el ${fechaDia(e.vence)}`;
      return `• ${marcaAviso(e)} ${e.modelo}, serial ${e.serial}: última calibración ${fechaDia(e.ultimaCalibracion)}, ${cuando}.`;
    })
    .join('\n');
  const plural = equipos.length !== 1;
  // Sólo GRIMM: el texto de siempre. Con equipos de otra marca incluida (lote 9f), «equipos», sin decir de qué son.
  const que = todosGrimm(equipos) ? (plural ? 'los siguientes monitores de partículas GRIMM' : 'el siguiente monitor de partículas GRIMM') : plural ? 'los siguientes equipos' : 'el siguiente equipo';
  const entrada =
    opciones.tramo === undefined
      ? `le recordamos que ${que} ${plural ? 'tienen' : 'tiene'} la calibración vencida o próxima a vencer:`
      : `${ENTRADA_TRAMO[opciones.tramo]} la calibración ${plural ? `de ${que}` : `d${que}`} vence en los próximos ${opciones.tramo} días:`;
  return [
    opciones.saludo ?? `Estimado cliente ${cliente}:`,
    '',
    `Desde el Servicio Técnico de Ambientalia ${entrada}`,
    '',
    lineas,
    '',
    'Para mantener la validez de sus mediciones y evitar paradas no previstas, le proponemos programar desde ahora el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.',
    '',
    'Quedamos atentos.',
    '',
    'Ambientalia S.A.S. · Servicio Técnico',
  ].join('\n');
}

/**
 * La primera línea del correo: por su nombre si entre los destinatarios hay
 * exactamente uno con nombre; si no hay ninguno o hay varios, el saludo
 * genérico al cliente.
 */
export function saludoAviso(cliente: string, destinatarios: readonly Destinatario[]): string {
  const nombres = [...new Set(destinatarios.map((d) => d.nombre.trim()).filter(Boolean))];
  return nombres.length === 1 ? `Estimado/a ${nombres[0]}:` : `Estimado cliente ${cliente}:`;
}

/** Cómo empieza el asunto en cada tramo: primer aviso, recordatorio y último aviso. */
const ASUNTO_TRAMO: Record<TramoAviso, (monitores: string) => string> = {
  90: (m) => `Calibración de ${m}: vence en los próximos 90 días`,
  60: (m) => `Recordatorio: la calibración de ${m} vence en los próximos 60 días`,
  30: (m) => `Último aviso: la calibración de ${m} vence en los próximos 30 días`,
};

export interface CorreoRedactado {
  /** Los destinatarios, separados por comas; vacío si el grupo no tiene a quién. */
  para: string;
  asunto: string;
  cuerpo: string;
}

/** El correo de una tarjeta (cliente + tramo): destinatarios, asunto y cuerpo. */
export function correoAviso<E extends EquipoAviso & EquipoTexto>(c: CorreoSimulado<E>): CorreoRedactado {
  // Sólo GRIMM, como siempre; con equipos de otra marca incluida (lote 9f), «su equipo» / «sus equipos».
  const grimm = todosGrimm(c.equipos.map((x) => x.equipo));
  const monitores = c.equipos.length === 1 ? (grimm ? 'su monitor GRIMM' : 'su equipo') : grimm ? 'sus monitores GRIMM' : 'sus equipos';
  return {
    para: c.destinatarios.map((d) => d.email).join(', '),
    asunto: `${ASUNTO_TRAMO[c.tramo](monitores)} · ${c.cliente}`,
    cuerpo: mensajeAviso(
      c.cliente,
      c.equipos.map((x) => x.equipo),
      { tramo: c.tramo, saludo: saludoAviso(c.cliente, c.destinatarios) },
    ),
  };
}
```

- [ ] **Paso 4: verla pasar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/avisos-correo.test.ts; Pop-Location`
Esperado: PASS — `Test Files  1 passed (1)`, `Tests  6 passed (6)`.

- [ ] **Paso 5: la app reexporta el módulo** — en `apps/trazabilidad-mantenimientos/src/dominio.ts`, justo debajo de la línea 5 (`export * from '../../hub-api/src/trazabilidad/dominio';`), añadir:

```typescript
// El correo del aviso a clientes (texto por tramo, versión de prueba y la forma de los envíos): el mismo que redacta el servidor al enviar.
export * from '../../hub-api/src/trazabilidad/avisos-correo';
```

- [ ] **Paso 6: `src/lib/simulacion.ts` deja de redactar** — sustituir con Edit desde la línea 1 hasta el final de `textoParaCopiar` (líneas 1-67, del comentario de cabecera a la llave de cierre de `textoParaCopiar`) por:

```typescript
/**
 * Lo que pinta la sub-vista «Simulación automática» de «Avisos a clientes».
 * Puro: sin React ni red. El plan (a quién le toca el aviso y a quién iría)
 * lo calcula el dominio (`planAvisos`) y el texto del correo, hub-api
 * (`avisos-correo.ts`: el mismo que redacta el servidor); aquí sólo se cuenta,
 * se junta para copiar y se revisa lo que se teclea en el editor de contacto.
 * Nada de este fichero envía nada.
 */
import {
  CONTACTO_MAX_EMAILS,
  esEmail,
  esEmailInterno,
  normalizarEmail,
  type AvisoEquipo,
  type CorreoRedactado,
  type CorreoSimulado,
  type EquipoVista,
  type OrigenContacto,
  type PlanAvisos,
} from '../dominio';
import { fmtFecha } from './vistas';

/** El saludo y el correo de cada tarjeta viven en hub-api (`avisos-correo.ts`): se reexportan para que la app tenga una sola regla. */
export { correoAviso, saludoAviso } from '../dominio';
export type { CorreoRedactado } from '../dominio';

/** Destinatarios, asunto y cuerpo en un solo texto, para copiarlo al portapapeles. */
export function textoParaCopiar(c: CorreoRedactado): string {
  return `Para: ${c.para || '(sin destinatario)'}\nAsunto: ${c.asunto}\n\n${c.cuerpo}`;
}
```

El resto del fichero (`ResumenSimulacion` … `fechaRelevante`) no se toca.

- [ ] **Paso 7: `src/lib/vistas.ts` reexporta el texto** — dos Edit:

(a) Línea 6, el import:

```typescript
import { ESTADOS, ESTADOS_AVISO, claveMarca, diasEntre, enServicio, sumarDias, type EquipoVista, type EstadoCalibracion, type TramoAviso } from '../dominio';
```

pasa a:

```typescript
import { ESTADOS, ESTADOS_AVISO, diasEntre, enServicio, sumarDias, type EquipoVista, type EstadoCalibracion } from '../dominio';
```

(b) Sustituir el bloque de las líneas 169-221 (desde `/** La marca de un equipo en el texto de un aviso:` hasta la llave de cierre de `mensajeAviso`, justo antes de `export interface DiaCalendario`) por:

```typescript
/**
 * El texto del aviso —la marca de cada equipo (`marcaAviso`), si son todos
 * GRIMM (`todosGrimm`) y el cuerpo (`mensajeAviso`)— vive en hub-api
 * (`avisos-correo.ts`): el servidor redacta con él lo que de verdad sale. Aquí
 * sólo se reexporta, como `enServicio`, para que la app tenga una sola regla.
 */
export { marcaAviso, mensajeAviso, todosGrimm } from '../dominio';
```

- [ ] **Paso 8: la app sigue en verde**

Run: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; Pop-Location`
Esperado: todas las pruebas PASS (las de `simulacion.test.ts` y `vistas.test.ts`, sin cambiar, prueban ya el código movido) y `typecheck` sin errores.

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/avisos-correo.test.ts src/trazabilidad/avisos.test.ts; Pop-Location`
Esperado: PASS.

- [ ] **Paso 9: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/avisos-correo.ts apps/hub-api/src/trazabilidad/avisos-correo.test.ts apps/trazabilidad-mantenimientos/src/dominio.ts apps/trazabilidad-mantenimientos/src/lib/simulacion.ts apps/trazabilidad-mantenimientos/src/lib/vistas.ts
git commit -F - <<'EOF'
refactor(trazabilidad): mover la redacción del aviso a hub-api

El servidor y la app redactarán con el mismo código (avisos-correo.ts, puro):
lo que se enseña es lo que saldrá. La app lo reexporta y sus pruebas siguen
fijando el texto letra a letra.
EOF
```

## Tarea 1.2: El grupo «vencida» (plan, texto y pantalla)

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/dominio.ts:726-745`, `:770-777`, `:784-785`, `:792-808`, `:847-852`, `:871-908`
- Modificar: `apps/hub-api/src/trazabilidad/avisos-correo.ts` (ENTRADA_TRAMO, `mensajeAviso`, ASUNTO_TRAMO, nuevo `ETIQUETA_TRAMO`)
- Modificar: `apps/hub-api/src/trazabilidad/avisos.test.ts:146-158`, `:197-200`, `:274-296`, `:298-307`
- Modificar: `apps/hub-api/src/trazabilidad/avisos-correo.test.ts` (añadir)
- Modificar: `apps/hub-api/src/trazabilidad/calibraciones.db.test.ts:472`, `marcas.db.test.ts:219`
- Modificar: `apps/trazabilidad-mantenimientos/src/lib/simulacion.ts` (`fechaRelevante`), `simulacion.test.ts:161`, `:204-218`
- Modificar: `apps/trazabilidad-mantenimientos/src/vistas/SimulacionAvisos.tsx:4`, `:31-33`, `:65`, `:132-137`, `:151-153`, `:159`

Consumidores de `TramoAviso` que el compilador obligará a tocar: `ENTRADA_TRAMO` y `ASUNTO_TRAMO` (avisos-correo.ts), `TONO_TRAMO` / `TITULO_TRAMO` y la etiqueta «· {tramo} días» (SimulacionAvisos.tsx), el orden `a.tramo - b.tramo` (planAvisos), `entradaTramo` (`sumarDias(vence, -tramo)`), y quien leía `vencidasSinAviso` o el motivo `'VENCIDA'` (`fechaRelevante`, avisos.test.ts, simulacion.test.ts, calibraciones.db.test.ts, marcas.db.test.ts).

- [ ] **Paso 1: las pruebas del plan, a lo nuevo** — en `apps/hub-api/src/trazabilidad/avisos.test.ts`, seis Edit:

(a) Sustituir:

```typescript
  it('son 90, 60 y 30, y cada estado próximo a vencer tiene el suyo', () => {
    expect([...TRAMOS_AVISO]).toEqual([90, 60, 30]);
    expect(tramoDeEstado('VENCE_90')).toBe(90);
    expect(tramoDeEstado('VENCE_60')).toBe(60);
    expect(tramoDeEstado('VENCE_30')).toBe(30);
    for (const e of ['AL_DIA', 'SIN_FECHA', 'VENCIDA', 'FUERA_CICLO'] as const) expect(tramoDeEstado(e)).toBeNull();
  });
```

por:

```typescript
  it('son 90, 60, 30 y, el último, «vencida»; cada estado próximo a vencer, y el de vencida en el último año, tiene el suyo', () => {
    expect([...TRAMOS_AVISO]).toEqual([90, 60, 30, 'vencida']);
    expect(tramoDeEstado('VENCE_90')).toBe(90);
    expect(tramoDeEstado('VENCE_60')).toBe(60);
    expect(tramoDeEstado('VENCE_30')).toBe(30);
    expect(tramoDeEstado('VENCIDA')).toBe('vencida');
    for (const e of ['AL_DIA', 'SIN_FECHA', 'SIN_VENCIMIENTO', 'FUERA_CICLO'] as const) expect(tramoDeEstado(e)).toBeNull();
  });
```

(b) Sustituir:

```typescript
  it('se entra en un tramo el día «vence − tramo»', () => {
    expect(entradaTramo('2026-12-02', 60)).toBe('2026-10-03');
```

por:

```typescript
  it('se entra en un tramo el día «vence − tramo»; en «vencida», el mismo día del vencimiento', () => {
    expect(entradaTramo('2026-09-03', 'vencida')).toBe('2026-09-03');
    expect(entradaTramo('2026-12-02', 60)).toBe('2026-10-03');
```

(c) Sustituir:

```typescript
  it('vencida y fuera de ciclo quedan fuera de la regla automática, cada una con su motivo', () => {
    expect(evaluarAviso(eq('Cliente Uno', VENCIDA), HOY)).toMatchObject({ motivo: 'VENCIDA', tramo: null, diasParaVencer: -33 });
    expect(evaluarAviso(eq('Cliente Uno', FUERA), HOY)).toMatchObject({ motivo: 'FUERA_CICLO', tramo: null });
  });
```

por:

```typescript
  it('vencida en el último año es el tramo «vencida», que se entra el día del vencimiento: una sola vez por vencimiento; fuera de ciclo sigue fuera', () => {
    expect(evaluarAviso(eq('Cliente Uno', VENCIDA), HOY)).toMatchObject({ motivo: 'DEBIDO', tramo: 'vencida', entradaTramo: '2026-09-03', diasParaVencer: -33 });
    expect(evaluarAviso(eq('Cliente Uno', VENCIDA, { aviso: '2026-08-20' }), HOY).motivo).toBe('DEBIDO'); // el aviso fue antes de vencer
    expect(evaluarAviso(eq('Cliente Uno', VENCIDA, { aviso: '2026-09-03' }), HOY).motivo).toBe('YA_AVISADO');
    expect(evaluarAviso(eq('Cliente Uno', VENCIDA, { enAmbientalia: true }), HOY).motivo).toBe('EN_SERVICIO');
    expect(evaluarAviso(eq('Cliente Uno', FUERA), HOY)).toMatchObject({ motivo: 'FUERA_CICLO', tramo: null });
  });
```

(d) Sustituir el test entero `it('lo que no entra queda en su grupo informativo, con su motivo', () => { … });` (líneas 274-290) por:

```typescript
  it('lo que no entra queda en su grupo informativo, con su motivo; las vencidas sin aviso desde que vencieron forman el grupo «vencida»', () => {
    const avisado = eq('Cliente Uno', EN_60, { aviso: '2026-10-04' });
    const enCasa = eq('Cliente Uno', EN_30, { ticket: true });
    const vencida = eq('Cliente Uno', VENCIDA);
    const vencidaAvisadaAntes = eq('Cliente Uno', VENCIDA, { aviso: '2026-08-20' }); // el aviso fue antes de vencer: toca otra vez
    const vencidaAvisada = eq('Cliente Uno', VENCIDA, { aviso: '2026-09-03' }); // avisada el día en que venció: ya está
    const vencidaEnCasa = eq('Cliente Uno', VENCIDA, { enAmbientalia: true });
    const fuera = eq('Cliente Uno', FUERA);
    const p = planAvisos([avisado, enCasa, vencida, vencidaAvisadaAntes, vencidaAvisada, vencidaEnCasa, fuera, eq('Cliente Uno', AL_DIA), eq('Cliente Uno', null)], HOY);
    expect(p.correos).toEqual([]);
    expect(p.sinDestinatario.map((c) => [c.cliente, c.tramo, c.equipos.map((x) => x.equipo.serial)])).toEqual([['Cliente Uno', 'vencida', [vencida.serial, vencidaAvisadaAntes.serial]]]);
    expect(p.yaAvisados.map((x) => x.equipo.serial)).toEqual([vencidaAvisada.serial, avisado.serial]);
    expect(p.enServicio.map((x) => x.equipo.serial)).toEqual([vencidaEnCasa.serial, enCasa.serial]);
    expect(p.fueraCiclo.map((x) => x.equipo.serial)).toEqual([fuera.serial]);
    expect(Object.keys(p).sort()).toEqual(['correos', 'enServicio', 'fueraCiclo', 'hoy', 'sinDestinatario', 'yaAvisados']);
  });
```

(e) Sustituir el test `it('las vencidas y las de fuera de ciclo no generan ningún correo simulado aunque tengan contacto', () => { … });` (líneas 292-296) por:

```typescript
  it('las vencidas con contacto van en UN correo del grupo «vencida» por cliente; las de fuera de ciclo, en ninguno', () => {
    const d = { contacto: desk('compras@cliente-uno.example') };
    const v1 = eq('Cliente Uno', VENCIDA, d); // venció hace 33 d
    const v2 = eq('Cliente Uno', '2025-08-01', d); // venció el 2026-08-01, hace 66 d
    const p = planAvisos([v1, v2, eq('Cliente Uno', FUERA, d)], HOY);
    expect(p.correos.map((c) => [c.tramo, c.equipos.map((x) => x.equipo.serial)])).toEqual([['vencida', [v2.serial, v1.serial]]]);
    expect([p.sinDestinatario, p.fueraCiclo.length]).toEqual([[], 1]);
  });

  it('lo más urgente primero: el grupo «vencida» va delante del de 30, y éste del de 90', () => {
    const d = { contacto: desk('compras@cliente-uno.example') };
    const p = planAvisos([eq('Cliente Uno', EN_90, d), eq('Cliente Dos', EN_30, d), eq('Cliente Tres', VENCIDA, d)], HOY);
    expect(p.correos.map((c) => [c.tramo, c.cliente])).toEqual([['vencida', 'Cliente Tres'], [30, 'Cliente Dos'], [90, 'Cliente Uno']]);
  });
```

(f) Sustituir:

```typescript
  // ni «sin destinatario», ni vencidas sin aviso, ni fuera de ciclo, ni ya avisados o en servicio. Con la misma fecha y 365 días, sí.
```

por:

```typescript
  // ni «sin destinatario», ni fuera de ciclo, ni ya avisados o en servicio. Con la misma fecha y 365 días, sí.
```

y, dentro de ese mismo test, sustituir:

```typescript
    expect([p.correos, p.sinDestinatario, p.yaAvisados, p.enServicio, p.vencidasSinAviso, p.fueraCiclo]).toEqual([[], [], [], [], [], []]);
    const con = planAvisos([EN_30, VENCIDA, FUERA].map((f) => eq('Cliente Uno', f, c)), HOY);
    expect([con.correos.length, con.vencidasSinAviso.length, con.fueraCiclo.length]).toEqual([1, 1, 1]);
```

por:

```typescript
    expect([p.correos, p.sinDestinatario, p.yaAvisados, p.enServicio, p.fueraCiclo]).toEqual([[], [], [], [], []]);
    const con = planAvisos([EN_30, VENCIDA, FUERA].map((f) => eq('Cliente Uno', f, c)), HOY);
    expect([con.correos.map((x) => x.tramo), con.fueraCiclo.length]).toEqual([['vencida', 30], 1]);
```

- [ ] **Paso 2: el texto de «vencida», a la prueba** — en `apps/hub-api/src/trazabilidad/avisos-correo.test.ts`, cambiar el import de la línea 4 por:

```typescript
import { ETIQUETA_TRAMO, correoAviso, fechaDia, marcaAviso, mensajeAviso, saludoAviso, todosGrimm } from './avisos-correo.js';
```

y añadir, antes de `describe('CANDADO: avisos-correo.ts es puro …`:

```typescript
describe('el texto del grupo «vencida» (aprobado el 2026-11-08)', () => {
  it('el del diseño, letra a letra: un GRIMM, sin nombre de contacto', () => {
    const e = { ...eq('Cliente Ejemplo S.A.S.', '2025-09-15', desk('compras@cliente-ejemplo.example'), 'Grimm', 'EDM 180'), clave: '18A00001', serial: '18A00001' };
    const c = correoAviso(tarjeta([e]));
    expect(c.asunto).toBe('La calibración de su monitor GRIMM está vencida · Cliente Ejemplo S.A.S.');
    expect(c.cuerpo).toBe(
      [
        'Estimado cliente Cliente Ejemplo S.A.S.:',
        '',
        'Desde el Servicio Técnico de Ambientalia le informamos de que la calibración del siguiente monitor de partículas GRIMM está vencida:',
        '',
        '• GRIMM EDM 180, serial 18A00001: última calibración 15/09/2025, vencida desde el 15/09/2026.',
        '',
        'Mientras la calibración esté vencida, las mediciones del equipo pueden perder su validez. Le proponemos programar cuanto antes el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos el equipo o, si lo prefiere, coordinamos la recogida.',
        '',
        'Quedamos atentos.',
        '',
        'Ambientalia S.A.S. · Servicio Técnico',
      ].join('\n'),
    );
  });

  it('con varios, «sus monitores GRIMM», «los siguientes…», «de los equipos» y «enviarnos los equipos»; con otra marca, «su equipo»', () => {
    const d = desk('compras@cliente-uno.example');
    const c = correoAviso(tarjeta([eq('Cliente Uno', '2025-09-03', d), eq('Cliente Uno', '2025-08-20', d)]));
    expect(c.asunto).toBe('La calibración de sus monitores GRIMM está vencida · Cliente Uno');
    expect(c.cuerpo).toContain('le informamos de que la calibración de los siguientes monitores de partículas GRIMM está vencida:');
    expect(c.cuerpo).toContain('Mientras la calibración esté vencida, las mediciones de los equipos pueden perder su validez.');
    expect(c.cuerpo).toContain('Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.');
    const h = correoAviso(tarjeta([eq('Cliente Dos', '2025-09-03', d, 'Horiba', 'APNA-370')]));
    expect(h.asunto).toBe('La calibración de su equipo está vencida · Cliente Dos');
    expect(h.cuerpo).toContain('la calibración del siguiente equipo está vencida:');
    expect(h.cuerpo).toContain('• Horiba APNA-370, serial ');
  });

  it('la etiqueta de cada tramo en la pantalla', () => {
    expect(ETIQUETA_TRAMO).toEqual({ 90: 'Primer aviso · 90 días', 60: 'Recordatorio · 60 días', 30: 'Último aviso · 30 días', vencida: 'Vencida' });
  });
});
```

- [ ] **Paso 3: la fecha de los informativos, a la prueba** — en `apps/trazabilidad-mantenimientos/src/lib/simulacion.test.ts`, dos Edit:

(a) Sustituir `    expect([p.vencidasSinAviso, p.fueraCiclo]).toEqual([[], []]);` por `    expect(p.fueraCiclo).toEqual([]);`

(b) Sustituir el test entero `it('la fecha que explica por qué un equipo no está en la simulación', () => { … });` (líneas 204-218) por:

```typescript
  it('la fecha que explica por qué un equipo no tiene tarjeta, según su motivo (también en «vencida»)', () => {
    const p = planAvisos(
      [
        eq('Cliente Uno', EN_60, null, { avisoEnviado: '2026-10-04' }),
        eq('Cliente Uno', EN_30, null, { enAmbientalia: true }),
        eq('Cliente Uno', '2025-09-03', null, { enAmbientalia: true }),
        eq('Cliente Uno', '2025-09-03', null, { avisoEnviado: '2026-09-10' }),
        eq('Cliente Uno', '2024-03-26'),
      ],
      HOY,
    );
    expect(fechaRelevante(p.yaAvisados[1])).toBe('avisado el 04/10/2026 · en el tramo desde el 03/10/2026');
    expect(fechaRelevante(p.yaAvisados[0])).toBe('avisado el 10/09/2026 · vencida desde el 03/09/2026');
    expect(fechaRelevante(p.enServicio[1])).toBe('vence el 17/10/2026');
    expect(fechaRelevante(p.enServicio[0])).toBe('venció el 03/09/2026');
    expect(fechaRelevante(p.fueraCiclo[0])).toBe('venció el 26/03/2025');
  });
```

- [ ] **Paso 4: verlas fallar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/avisos.test.ts src/trazabilidad/avisos-correo.test.ts; Pop-Location`
Esperado: FAIL — p. ej. `expected [ 90, 60, 30 ] to deeply equal [ 90, 60, 30, 'vencida' ]`, `expected 'VENCIDA' to be 'DEBIDO'` y `expected undefined to deeply equal { …vencida: 'Vencida' }`.

Run: `Push-Location apps/trazabilidad-mantenimientos; npx vitest run src/lib/simulacion.test.ts; Pop-Location`
Esperado: FAIL en `fechaRelevante` (`expected undefined …`: hoy la vencida en casa no está en ninguna lista).

- [ ] **Paso 5: el dominio** — en `apps/hub-api/src/trazabilidad/dominio.ts`, siete Edit:

(a) Sustituir el bloque de las líneas 726-745 (de `// ── Aviso automático a clientes: SIMULACIÓN` hasta el cierre de `entradaTramo`) por:

```typescript
// ── Avisos a clientes: el plan ───────────────────────────────────────────────
//
// Qué aviso le toca hoy a cada equipo y a quién iría: a 90, 60 y 30 días del
// vencimiento y, una sola vez, al vencer. Aquí sólo se CALCULA: lo pinta la
// pestaña «Avisos a clientes» y, al pulsar «Enviar correo», el servidor lo
// vuelve a calcular para saber qué sale. Nada de este fichero envía nada.

/** Los tramos del aviso, del primero al último: 90, 60 y 30 días antes del vencimiento y «vencida» (en el último año: una sola vez por vencimiento). */
export const TRAMOS_AVISO = [90, 60, 30, 'vencida'] as const;
export type TramoAviso = (typeof TRAMOS_AVISO)[number];

/** El tramo en el que está un equipo según su estado; null si no está en ninguno (al día, sin fecha, sin vencimiento o fuera de ciclo). */
export function tramoDeEstado(estado: EstadoCalibracion): TramoAviso | null {
  return estado === 'VENCE_90' ? 90 : estado === 'VENCE_60' ? 60 : estado === 'VENCE_30' ? 30 : estado === 'VENCIDA' ? 'vencida' : null;
}

/** El día en que un equipo entra en un tramo: su vencimiento menos los días del tramo; en «vencida», el mismo día del vencimiento. */
export function entradaTramo(vence: string, tramo: TramoAviso): string {
  return tramo === 'vencida' ? vence : sumarDias(vence, -tramo);
}
```

(b) Sustituir:

```typescript
/** Por qué a un equipo le tocaría (o no) el aviso automático hoy. */
export type MotivoAviso =
  | 'DEBIDO' // está en un tramo y aún no se le ha avisado en él: entraría en un correo
  | 'YA_AVISADO' // ya tiene un aviso desde que entró en su tramo
  | 'EN_SERVICIO' // está en un tramo, pero en Ambientalia o con ticket abierto
  | 'SIN_TRAMO' // al día, sin fecha o sin vencimiento: no toca nada
  | 'VENCIDA' // vencida en el último año: fuera de la regla automática
  | 'FUERA_CICLO'; // vencida hace más de un año: fuera de la regla automática
```

por:

```typescript
/** Por qué a un equipo le toca (o no) el aviso hoy. */
export type MotivoAviso =
  | 'DEBIDO' // está en un tramo y aún no se le ha avisado en él: entra en un correo
  | 'YA_AVISADO' // ya tiene un aviso desde que entró en su tramo (en «vencida», desde que venció)
  | 'EN_SERVICIO' // está en un tramo, pero en Ambientalia o con ticket abierto
  | 'SIN_TRAMO' // al día, sin fecha o sin vencimiento: no toca nada
  | 'FUERA_CICLO'; // vencida hace más de un año: fuera de los avisos
```

(c) Sustituir `  /** Su tramo de hoy; null fuera de los tres tramos. */` por `  /** Su tramo de hoy; null fuera de los cuatro tramos. */`

(d) Sustituir el comentario de `evaluarAviso`:

```typescript
/**
 * Decide, a fecha `hoy`, si a un equipo le tocaría el aviso automático.
 *  - Sólo en los tramos 90 / 60 / 30 (estados VENCE_90 / VENCE_60 / VENCE_30).
 *  - Nunca si está en servicio (`enServicio`).
 *  - Una vez por tramo: si su «aviso enviado» es del día en que entró en el
 *    tramo o posterior, ya está avisado; si es anterior (fue el del tramo de
 *    antes) o no hay, toca.
 *  - Vencida y fuera de ciclo no entran en la regla.
 *  - Con la vigencia de su marca: sin vencimiento (lote 11) no está en ningún tramo ni en ninguna lista.
 */
```

por:

```typescript
/**
 * Decide, a fecha `hoy`, si a un equipo le toca el aviso.
 *  - En los tramos 90 / 60 / 30 (estados VENCE_90 / VENCE_60 / VENCE_30) y en
 *    «vencida» (VENCIDA: vencida en el último año).
 *  - Nunca si está en servicio (`enServicio`).
 *  - Una vez por tramo: si su «aviso enviado» es del día en que entró en el
 *    tramo o posterior, ya está avisado; si es anterior (fue el del tramo de
 *    antes) o no hay, toca. En «vencida» se entra el día del vencimiento: una
 *    sola vez por vencimiento.
 *  - Fuera de ciclo (vencida hace más de un año) no entra.
 *  - Con la vigencia de su marca: sin vencimiento (lote 11) no está en ningún tramo ni en ninguna lista.
 */
```

(e) Sustituir `    const motivo: MotivoAviso = estado === 'FUERA_CICLO' ? 'FUERA_CICLO' : estado === 'VENCIDA' ? 'VENCIDA' : 'SIN_TRAMO';` por `    const motivo: MotivoAviso = estado === 'FUERA_CICLO' ? 'FUERA_CICLO' : 'SIN_TRAMO';`

(f) En `PlanAvisos`, sustituir:

```typescript
  /** Informativos: por qué algo no está en la simulación. */
  yaAvisados: AvisoEquipo<E>[];
  enServicio: AvisoEquipo<E>[];
  /** Vencidas (hasta un año) que no están en servicio y sin aviso desde que vencieron. */
  vencidasSinAviso: AvisoEquipo<E>[];
  fueraCiclo: AvisoEquipo<E>[];
```

por:

```typescript
  /** Informativos: por qué un equipo no tiene tarjeta hoy. */
  yaAvisados: AvisoEquipo<E>[];
  enServicio: AvisoEquipo<E>[];
  fueraCiclo: AvisoEquipo<E>[];
```

(g) En `planAvisos` y su comentario (líneas 871-908): sustituir

```typescript
/**
 * El plan del aviso automático a fecha `hoy`: qué correos se enviarían y qué
 * queda fuera y por qué. Un correo por cliente (por `claveCliente`) y tramo,
```

por

```typescript
/** El orden de las tarjetas: lo más urgente primero (vencida, 30, 60 y 90). */
const ORDEN_TRAMO: Record<TramoAviso, number> = { vencida: 0, 30: 1, 60: 2, 90: 3 };

/**
 * El plan de los avisos a fecha `hoy`: qué correos (tarjetas) tocan y a quién,
 * y qué queda fuera y por qué. Un correo por cliente (por `claveCliente`) y tramo,
```

sustituir `  const plan: PlanAvisos<E> = { hoy, correos: [], sinDestinatario: [], yaAvisados: [], enServicio: [], vencidasSinAviso: [], fueraCiclo: [] };` por `  const plan: PlanAvisos<E> = { hoy, correos: [], sinDestinatario: [], yaAvisados: [], enServicio: [], fueraCiclo: [] };`

sustituir

```typescript
    else if (a.motivo === 'FUERA_CICLO') plan.fueraCiclo.push(a);
    else if (a.motivo === 'VENCIDA') {
      const aviso = e.seguimiento?.avisoEnviado ?? null;
      if (!enServicio(e) && !(aviso !== null && a.vence !== null && aviso >= a.vence)) plan.vencidasSinAviso.push(a);
    } else if (a.motivo === 'DEBIDO' && a.tramo !== null) {
```

por

```typescript
    else if (a.motivo === 'FUERA_CICLO') plan.fueraCiclo.push(a);
    else if (a.motivo === 'DEBIDO' && a.tramo !== null) {
```

sustituir `  const porTramoYCliente = (a: CorreoSimulado, b: CorreoSimulado) => a.tramo - b.tramo || a.cliente.localeCompare(b.cliente, 'es');` por `  const porTramoYCliente = (a: CorreoSimulado, b: CorreoSimulado) => ORDEN_TRAMO[a.tramo] - ORDEN_TRAMO[b.tramo] || a.cliente.localeCompare(b.cliente, 'es');`

y sustituir `  for (const lista of [plan.yaAvisados, plan.enServicio, plan.vencidasSinAviso, plan.fueraCiclo]) lista.sort(porDias);` por `  for (const lista of [plan.yaAvisados, plan.enServicio, plan.fueraCiclo]) lista.sort(porDias);`

- [ ] **Paso 6: el texto de «vencida»** — en `apps/hub-api/src/trazabilidad/avisos-correo.ts`:

(a) Sustituir desde `/** Cómo empieza la frase de entrada en cada tramo:` hasta la llave de cierre de `mensajeAviso` por:

```typescript
/** Cómo empieza la frase de entrada en los tramos de antes del vencimiento: primer aviso, recordatorio y último aviso. */
const ENTRADA_TRAMO: Record<Exclude<TramoAviso, 'vencida'>, string> = {
  90: 'le informamos con antelación de que',
  60: 'le recordamos que',
  30: 'le recordamos, como último aviso, que',
};

/** El párrafo de la propuesta de siempre: el de los tramos 90, 60 y 30 y el del texto sin tramo. */
const PROPUESTA =
  'Para mantener la validez de sus mediciones y evitar paradas no previstas, le proponemos programar desde ahora el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos los equipos o, si lo prefiere, coordinamos la recogida.';

/**
 * Texto del aviso al cliente. Con `opciones.tramo` es el de ese tramo: mismo
 * cuerpo, con la frase de entrada propia del tramo; en «vencida» (aprobado el
 * 2026-11-08), además, con su propio párrafo de propuesta.
 */
export function mensajeAviso(cliente: string, equipos: readonly EquipoTexto[], opciones: OpcionesAviso = {}): string {
  const lineas = equipos
    .map((e) => {
      const cuando = (e.vigenciaDias ?? 0) < 0 ? `vencida desde el ${fechaDia(e.vence)}` : `vence el ${fechaDia(e.vence)}`;
      return `• ${marcaAviso(e)} ${e.modelo}, serial ${e.serial}: última calibración ${fechaDia(e.ultimaCalibracion)}, ${cuando}.`;
    })
    .join('\n');
  const plural = equipos.length !== 1;
  // Sólo GRIMM: el texto de siempre. Con equipos de otra marca incluida (lote 9f), «equipos», sin decir de qué son.
  const que = todosGrimm(equipos) ? (plural ? 'los siguientes monitores de partículas GRIMM' : 'el siguiente monitor de partículas GRIMM') : plural ? 'los siguientes equipos' : 'el siguiente equipo';
  const de = plural ? `de ${que}` : `d${que}`;
  const { tramo } = opciones;
  const entrada =
    tramo === undefined
      ? `le recordamos que ${que} ${plural ? 'tienen' : 'tiene'} la calibración vencida o próxima a vencer:`
      : tramo === 'vencida'
        ? `le informamos de que la calibración ${de} está vencida:`
        : `${ENTRADA_TRAMO[tramo]} la calibración ${de} vence en los próximos ${tramo} días:`;
  const propuesta =
    tramo === 'vencida'
      ? `Mientras la calibración esté vencida, las mediciones ${plural ? 'de los equipos' : 'del equipo'} pueden perder su validez. Le proponemos programar cuanto antes el servicio de calibración y mantenimiento. Indíquenos la fecha en que podría enviarnos ${plural ? 'los equipos' : 'el equipo'} o, si lo prefiere, coordinamos la recogida.`
      : PROPUESTA;
  return [opciones.saludo ?? `Estimado cliente ${cliente}:`, '', `Desde el Servicio Técnico de Ambientalia ${entrada}`, '', lineas, '', propuesta, '', 'Quedamos atentos.', '', 'Ambientalia S.A.S. · Servicio Técnico'].join('\n');
}
```

(b) Sustituir el bloque de `ASUNTO_TRAMO` por:

```typescript
/** Cómo empieza el asunto en cada tramo: primer aviso, recordatorio, último aviso y vencida. */
const ASUNTO_TRAMO: Record<TramoAviso, (monitores: string) => string> = {
  90: (m) => `Calibración de ${m}: vence en los próximos 90 días`,
  60: (m) => `Recordatorio: la calibración de ${m} vence en los próximos 60 días`,
  30: (m) => `Último aviso: la calibración de ${m} vence en los próximos 30 días`,
  vencida: (m) => `La calibración de ${m} está vencida`,
};

/** El nombre de cada tramo en la pantalla: la etiqueta de cada tarjeta y de cada envío. */
export const ETIQUETA_TRAMO: Record<TramoAviso, string> = { 90: 'Primer aviso · 90 días', 60: 'Recordatorio · 60 días', 30: 'Último aviso · 30 días', vencida: 'Vencida' };
```

- [ ] **Paso 7: la app** — `apps/trazabilidad-mantenimientos/src/lib/simulacion.ts`, sustituir `fechaRelevante` entera:

```typescript
/** La fecha que explica por qué un equipo no está en la simulación, según su motivo. */
export function fechaRelevante(a: AvisoEquipo<EquipoVista>): string {
  if (a.motivo === 'YA_AVISADO') return `avisado el ${fmtFecha(a.equipo.seguimiento?.avisoEnviado)} · en el tramo desde el ${fmtFecha(a.entradaTramo)}`;
  if (a.motivo === 'VENCIDA' || a.motivo === 'FUERA_CICLO') return `venció el ${fmtFecha(a.vence)}`;
  return a.vence ? `vence el ${fmtFecha(a.vence)}` : 'sin fecha de calibración';
}
```

por:

```typescript
/** La fecha que explica por qué un equipo no tiene tarjeta, según su motivo (en «vencida», desde cuándo está vencida). */
export function fechaRelevante(a: AvisoEquipo<EquipoVista>): string {
  if (a.motivo === 'YA_AVISADO') return `avisado el ${fmtFecha(a.equipo.seguimiento?.avisoEnviado)} · ${a.tramo === 'vencida' ? 'vencida' : 'en el tramo'} desde el ${fmtFecha(a.entradaTramo)}`;
  if (a.tramo === 'vencida' || a.motivo === 'FUERA_CICLO') return `venció el ${fmtFecha(a.vence)}`;
  return a.vence ? `vence el ${fmtFecha(a.vence)}` : 'sin fecha de calibración';
}
```

Y `apps/trazabilidad-mantenimientos/src/vistas/SimulacionAvisos.tsx`, seis Edit:

(a) Línea 4: `import { CONTACTO_MAX_EMAILS, planAvisos, type AvisoEquipo,` → `import { CONTACTO_MAX_EMAILS, ETIQUETA_TRAMO, planAvisos, type AvisoEquipo,` (el resto de la línea igual).

(b) Sustituir:

```typescript
/** Clases de la etiqueta de cada tramo: las mismas que el estado «vence en …» de ese tramo. */
const TONO_TRAMO: Record<TramoAviso, string> = { 90: TONO.VENCE_90.badge, 60: TONO.VENCE_60.badge, 30: TONO.VENCE_30.badge };
const TITULO_TRAMO: Record<TramoAviso, string> = { 90: 'Primer aviso', 60: 'Recordatorio', 30: 'Último aviso' };
```

por:

```typescript
/** Clases de la etiqueta de cada tramo: las mismas que el estado de ese tramo («vence en …» o «vencida»). */
const TONO_TRAMO: Record<TramoAviso, string> = { 90: TONO.VENCE_90.badge, 60: TONO.VENCE_60.badge, 30: TONO.VENCE_30.badge, vencida: TONO.VENCIDA.badge };
```

(c) En el aviso de arriba, sustituir `a 90, 60 y 30 días del vencimiento. Estamos en fase de pruebas:` por `a 90, 60 y 30 días del vencimiento y al vencer. Estamos en fase de pruebas:`

(d) Borrar el informativo de las vencidas:

```tsx
        <Informativo
          titulo="Vencidas sin aviso"
          nota="Vencidas hace menos de un año, fuera de servicio y sin aviso desde que vencieron. El aviso automático no las cubre: avísales desde la vista «Manual»."
          lista={plan.vencidasSinAviso}
          onFicha={onFicha}
        />
```

(e) Sustituir:

```tsx
          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONO_TRAMO[c.tramo]}`}>
            {TITULO_TRAMO[c.tramo]} · {c.tramo} días
          </span>
```

por:

```tsx
          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONO_TRAMO[c.tramo]}`}>{ETIQUETA_TRAMO[c.tramo]}</span>
```

(f) Sustituir `          <caption className="sr-only">Equipos de {c.cliente} en el tramo de {c.tramo} días</caption>` por `          <caption className="sr-only">Equipos de {c.cliente}: {ETIQUETA_TRAMO[c.tramo]}</caption>`

- [ ] **Paso 8: las dos pruebas de BD que leían `vencidasSinAviso`** (si no, `tsc` de hub-api no compila):

`apps/hub-api/src/trazabilidad/calibraciones.db.test.ts:472`, sustituir

```typescript
      return [...p.vencidasSinAviso, ...p.correos.flatMap((c) => c.equipos), ...p.sinDestinatario.flatMap((c) => c.equipos)].map((a) => a.equipo.clave).sort();
```

por (las vencidas están ya en las tarjetas: el resultado es el mismo):

```typescript
      return [...p.correos.flatMap((c) => c.equipos), ...p.sinDestinatario.flatMap((c) => c.equipos)].map((a) => a.equipo.clave).sort();
```

`apps/hub-api/src/trazabilidad/marcas.db.test.ts:219`, sustituir `    expect(claves(plan.vencidasSinAviso)).toContain('HB-0003');` por:

```typescript
    expect([...plan.correos, ...plan.sinDestinatario].filter((g) => g.tramo === 'vencida').flatMap((g) => claves(g.equipos))).toContain('HB-0003');
```

- [ ] **Paso 9: verlas pasar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/avisos.test.ts src/trazabilidad/avisos-correo.test.ts; Pop-Location`
Esperado: PASS (`Tests  … passed`, 0 failed).

Run: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; Pop-Location`
Esperado: PASS y sin errores de tipos.

Run (Docker encendido): `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/calibraciones.db.test.ts src/trazabilidad/marcas.db.test.ts; Pop-Location`
Esperado: `Test Files  2 passed (2)`.

- [ ] **Paso 10: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/dominio.ts apps/hub-api/src/trazabilidad/avisos-correo.ts apps/hub-api/src/trazabilidad/avisos-correo.test.ts apps/hub-api/src/trazabilidad/avisos.test.ts apps/hub-api/src/trazabilidad/calibraciones.db.test.ts apps/hub-api/src/trazabilidad/marcas.db.test.ts apps/trazabilidad-mantenimientos/src/lib/simulacion.ts apps/trazabilidad-mantenimientos/src/lib/simulacion.test.ts apps/trazabilidad-mantenimientos/src/vistas/SimulacionAvisos.tsx
git commit -F - <<'EOF'
feat(trazabilidad): grupo «vencida» en el plan de avisos

Las vencidas del último año, fuera de servicio y sin aviso desde que
vencieron dejan de ser informativas: forman un cuarto tramo, con su texto
aprobado, una sola vez por vencimiento y por delante del de 30 días.
EOF
```

## Tarea 1.3: Lo que sale: correo real, versión de prueba y tipos del envío

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/avisos-correo.ts` (import y sección nueva al final)
- Modificar: `apps/hub-api/src/trazabilidad/avisos-correo.test.ts` (añadir)

- [ ] **Paso 1: escribir la prueba que falla** — en `avisos-correo.test.ts`, cambiar el import de la línea 4 por:

```typescript
import { ETIQUETA_TRAMO, SIN_CONFIRMAR_MS, correoAviso, correoDePrueba, correoReal, esBuzonDePrueba, estadoPresentado, fechaDia, marcaAviso, mensajeAviso, mismaHuella, saludoAviso, todosGrimm } from './avisos-correo.js';
```

y añadir, antes del `describe('CANDADO: …`:

```typescript
describe('lo que sale: el correo real y su versión de prueba', () => {
  const BUZON = 'buzon-prueba@ambientalia.com.co';
  const real = { para: ['compras@cliente-uno.example', 'copia@example.com'], asunto: 'Último aviso: la calibración de su monitor GRIMM vence en los próximos 30 días · Cliente Uno', cuerpo: 'Estimado/a Ana Pérez:\n\nTexto ficticio.' };

  it('el real va a los destinatarios de la tarjeta, con el asunto y el cuerpo de siempre', () => {
    const t = tarjeta([eq('Cliente Uno', EN_30, desk('compras@cliente-uno.example', 'Ana Pérez'))]);
    const { asunto, cuerpo } = correoAviso(t);
    expect(correoReal(t)).toEqual({ para: ['compras@cliente-uno.example'], asunto, cuerpo });
  });

  it('en prueba el ÚNICO destinatario es el buzón; el asunto empieza por «[PRUEBA] » y el cuerpo, por a quién habría ido', () => {
    const p = correoDePrueba(real, ' Buzon-Prueba@Ambientalia.com.co ');
    expect(p.para).toEqual([BUZON]);
    expect(p.asunto).toBe(`[PRUEBA] ${real.asunto}`);
    expect(p.cuerpo.split('\n')[0]).toBe('[PRUEBA] Este correo no ha salido hacia el cliente. En modo real habría ido a: compras@cliente-uno.example, copia@example.com.');
    expect(p.cuerpo.endsWith(real.cuerpo)).toBe(true);
    expect(real.para).toHaveLength(2); // el real no se toca
    expect(correoDePrueba({ ...real, para: [] }, BUZON).cuerpo.split('\n')[0]).toContain('(sin destinatario)');
  });

  it.each(['buzon@example.com', 'buzon@correo.ambientalia.com.co', 'buzon@ambientalia.com.co.example', 'no-es-correo', ''])('un buzón %j no vale: ni es de prueba ni se redacta nada', (b) => {
    expect(esBuzonDePrueba(b)).toBe(false);
    expect(() => correoDePrueba(real, b)).toThrow(/@ambientalia\.com\.co/);
  });
});

describe('la huella de una tarjeta y el estado de un envío', () => {
  it('misma huella = los mismos equipos, sin importar el orden ni los repetidos', () => {
    expect(mismaHuella(['18A00002', '18A00001'], ['18A00001', '18A00002', '18A00001'])).toBe(true);
    expect(mismaHuella(['18A00001', '18A00002'], ['18A00001'])).toBe(false);
    expect(mismaHuella(['18A00001'], ['18A00001', '18A00003'])).toBe(false);
  });

  it('un «en curso» de 2 minutos o más se enseña como «sin confirmar»; lo demás, tal cual', () => {
    expect(SIN_CONFIRMAR_MS).toBe(120_000);
    expect(estadoPresentado('en_curso', 119_999)).toBe('en_curso');
    expect(estadoPresentado('en_curso', 120_000)).toBe('sin_confirmar');
    expect([estadoPresentado('enviado', 999_999), estadoPresentado('fallido', 999_999)]).toEqual(['enviado', 'fallido']);
  });
});
```

- [ ] **Paso 2: verla fallar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/avisos-correo.test.ts; Pop-Location`
Esperado: FAIL — `correoReal is not a function` (y los demás nombres nuevos).

- [ ] **Paso 3: implementar** — en `avisos-correo.ts`, el import pasa a:

```typescript
import { claveCliente, esEmail, normalizarEmail, type CorreoSimulado, type Destinatario, type EquipoAviso, type TramoAviso } from './dominio.js';
```

y al final del fichero se añade:

```typescript
// ── El envío (2026-11-08): lo que sale, su versión de prueba y lo que sirve la API ──

/** Lo que se manda de verdad: a quién (direcciones sueltas), con qué asunto y con qué cuerpo. */
export interface CorreoAEnviar {
  para: string[];
  asunto: string;
  cuerpo: string;
}

/** El correo de una tarjeta tal como sale en modo real: a sus destinatarios, con su asunto y su cuerpo. */
export function correoReal<E extends EquipoAviso & EquipoTexto>(c: CorreoSimulado<E>): CorreoAEnviar {
  const { asunto, cuerpo } = correoAviso(c);
  return { para: c.destinatarios.map((d) => d.email), asunto, cuerpo };
}

/** True si `v` es un correo de `@ambientalia.com.co` —el dominio exacto, sin subdominios—: el único que vale como buzón de prueba. */
export function esBuzonDePrueba(v: unknown): boolean {
  const e = normalizarEmail(v);
  return esEmail(e) && e.endsWith('@ambientalia.com.co');
}

/**
 * El mismo correo en modo prueba: va SÓLO al buzón de prueba, el asunto empieza
 * por «[PRUEBA] » y el cuerpo empieza diciendo a quién habría ido de verdad. Un
 * buzón que no sea de @ambientalia.com.co no se acepta: no se redacta nada.
 */
export function correoDePrueba(real: CorreoAEnviar, buzon: string): CorreoAEnviar {
  if (!esBuzonDePrueba(buzon)) throw new Error('El buzón de prueba tiene que ser de @ambientalia.com.co.');
  const habria = real.para.length > 0 ? real.para.join(', ') : '(sin destinatario)';
  return {
    para: [normalizarEmail(buzon)],
    asunto: `[PRUEBA] ${real.asunto}`,
    cuerpo: [`[PRUEBA] Este correo no ha salido hacia el cliente. En modo real habría ido a: ${habria}.`, '', '— — —', '', real.cuerpo].join('\n'),
  };
}

/** True si los equipos que vio quien pulsó «Enviar» son exactamente los de la tarjeta de ahora (sin importar el orden ni los repetidos). */
export function mismaHuella(ahora: readonly string[], vistos: readonly string[]): boolean {
  const a = [...new Set(ahora)].sort();
  const b = [...new Set(vistos)].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Por qué el envío está apagado sin que nadie lo pidiera. */
export type MotivoApagado = 'sin_valor' | 'valor_desconocido' | 'sin_canal' | 'sin_buzon_prueba';

/** El modo efectivo del envío (el interruptor de hub-api) y, si quedó apagado sin pedirlo, por qué. Lo sirve GET /trazabilidad/avisos/envios. */
export type EstadoCanal =
  | { modo: 'apagado'; motivo: MotivoApagado | null; buzonPrueba: null }
  | { modo: 'prueba'; motivo: null; buzonPrueba: string }
  | { modo: 'real'; motivo: null; buzonPrueba: null };

/** Lo que contesta el canal de salida al darle un correo. */
export type ResultadoRemision =
  | { tipo: 'enviado'; messageId: string } // lo confirmó
  | { tipo: 'rechazado'; motivo: string } // seguro que no salió
  | { tipo: 'sin_respuesta' }; // no se sabe: pudo salir

/** El canal de salida de los avisos. Su única implementación es envio-avisos.ts; las pruebas pasan uno falso. */
export interface CanalAvisos {
  estado(): EstadoCanal;
  remitir(correo: CorreoAEnviar, referencia: number): Promise<ResultadoRemision>;
}

/** El estado guardado de un envío (portal.tmc_avisos_envios). */
export type EstadoGuardado = 'en_curso' | 'enviado' | 'fallido';
/** Como lo enseña la pantalla: un «en curso» que ya no espera respuesta es «sin confirmar» (no es un estado guardado aparte). */
export type EstadoEnvio = EstadoGuardado | 'sin_confirmar';

/** A partir de cuánto un envío «en curso» deja de esperar respuesta (el canal espera 30 s como mucho). */
export const SIN_CONFIRMAR_MS = 2 * 60_000;

/** El estado de un envío como lo enseña la pantalla, con su edad en milisegundos. */
export function estadoPresentado(estado: EstadoGuardado, edadMs: number): EstadoEnvio {
  return estado === 'en_curso' && edadMs >= SIN_CONFIRMAR_MS ? 'sin_confirmar' : estado;
}

/** Un envío de un aviso, como lo sirve la API. */
export interface EnvioAviso {
  id: number;
  /** El instante en que se pulsó «Enviar», con su zona. */
  creadoEn: string;
  por: string;
  modo: 'prueba' | 'real';
  claveCliente: string;
  cliente: string;
  tramo: TramoAviso;
  equipos: string[];
  /** Los destinatarios de verdad de la tarjeta. */
  destinatarios: string[];
  /** A quién se mandó: en prueba, sólo el buzón de prueba. */
  enviadoA: string[];
  asunto: string;
  estado: EstadoEnvio;
  messageId: string | null;
  error: string | null;
  /** Quién lo resolvió a mano («Sí salió» / «No salió») y cuándo; null si no hizo falta. */
  resueltoPor: string | null;
  resueltoEn: string | null;
}

/** GET /trazabilidad/avisos/envios: el modo efectivo y los últimos envíos, del más reciente al más antiguo. */
export interface RespuestaEnvios {
  canal: EstadoCanal;
  envios: EnvioAviso[];
}
```

- [ ] **Paso 4: verla pasar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/avisos-correo.test.ts; Pop-Location`
Esperado: PASS (incluido el candado de pureza: el import sigue siendo sólo `./dominio.js`).

Run: `Push-Location apps/trazabilidad-mantenimientos; npm run typecheck; Pop-Location`
Esperado: sin errores (el módulo cumple `verbatimModuleSyntax`, `noUnusedLocals` y `erasableSyntaxOnly` de la app).

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/avisos-correo.ts apps/hub-api/src/trazabilidad/avisos-correo.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): correo real, versión de prueba y tipos del envío de avisos

En prueba el único destinatario es el buzón de @ambientalia.com.co, el
asunto empieza por [PRUEBA] y el cuerpo dice a quién habría ido. Añade la
huella de la tarjeta, el «sin confirmar» a los 2 minutos y la forma de lo
que servirá la API.
EOF
```

## Tarea 1.4: Verificación del lote 1, merge y push

- [ ] **Paso 1: todo en verde**

Run: `Push-Location apps/hub-api; npm test; Pop-Location`
Esperado: PASS (si cae la 4.4 de usuarios por tiempo, repítela sola).

Run: `Push-Location apps/hub-api; npx tsc -p tsconfig.json --noEmit; Pop-Location`
Esperado: sólo el error conocido de `src/ausencias/service/barril.test.ts` (tipos de `micromatch`).

Run: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; npm run build; Pop-Location`
Esperado: PASS, sin errores y build correcto.

- [ ] **Paso 2: tamaño (Bash)** — `git diff --shortstat -M main...HEAD`. Esperado: inserciones + borrados < 800 (previsión: ~620).

- [ ] **Paso 3: merge y push (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main
git merge --no-ff feat/avisos-vencida-redaccion -m "merge: grupo vencida y redacción del aviso en hub-api"
git push origin main
```

- [ ] **Paso 4: avisar a Alfonso** — «Lote 1 empujado. Puede desplegarse el portal cuando quieras (hub-api no cambia en ejecución). Se verá: las vencidas del último año pasan de “Vencidas sin aviso” a tarjetas “Vencida” en la simulación».

---

# LOTE 2 — hub-api: registro, canal de salida, rutas y candados

Rama: `feat/avisos-envio-servidor`. Antes de empezar, confirmar con Alfonso D1, D2, D3, D4 y D6.

- [ ] **Paso 2.0: rama (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main && git pull --ff-only && git switch -c feat/avisos-envio-servidor
```

## Tarea 2.1: Migración 069 — `portal.tmc_avisos_envios`

**Ficheros:**
- Crear: `apps/hub-api/src/users/migrations/069_trazabilidad_avisos_envios.sql`
- Modificar: `apps/hub-api/src/db.ts:102` (array `MIGRATIONS`)
- Crear: `apps/hub-api/src/trazabilidad/envio-avisos.test.ts` (sus guardas)
- Modificar: `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts:337-374` (lista `tmc_*`, D2)

(El Dockerfile ya copia la carpeta `migrations` entera a `dist`: `cp -R src/users/migrations dist/users/`. Basta con apuntarla en `MIGRATIONS`.)

- [ ] **Paso 1: escribir la prueba que falla** — crear `apps/hub-api/src/trazabilidad/envio-avisos.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// El envío de los avisos a clientes (2026-11-08): su registro (069), su canal
// de salida y sus candados. Nada de aquí llama a la red: la red es de mentira.

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('069_trazabilidad_avisos_envios.sql', () => {
  const sinComentarios = fuente('../users/migrations/069_trazabilidad_avisos_envios.sql').replace(/--.*$/gm, '');

  it('sólo crea, con IF NOT EXISTS, y da sus permisos a portal_app: sin semilla, sin claves foráneas y sin nada que cambie datos en un segundo arranque', () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+portal|DELETE\s+FROM|DROP|TRUNCATE|ALTER)\b/i);
    expect(sinComentarios.match(/CREATE (UNIQUE )?(TABLE|INDEX) (?!IF NOT EXISTS)/gi)).toBeNull();
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b|\bdesk\./i);
    expect(sinComentarios).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'portal_app'\)/);
  });

  it('un solo «en curso» por cliente y tramo: el índice único parcial', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_avisos_envios_en_curso_uq\s+ON portal\.tmc_avisos_envios \(clave_cliente, tramo\) WHERE estado = 'en_curso'/);
  });

  it('cuatro tramos, tres estados y dos modos, cerrados con CHECK (apagado no deja fila); y no guarda el cuerpo del correo', () => {
    expect(sinComentarios).toMatch(/tramo\s+VARCHAR\(10\)\s+NOT NULL CHECK \(tramo IN \('90', '60', '30', 'vencida'\)\)/);
    expect(sinComentarios).toMatch(/estado\s+VARCHAR\(10\)\s+NOT NULL DEFAULT 'en_curso' CHECK \(estado IN \('en_curso', 'enviado', 'fallido'\)\)/);
    expect(sinComentarios).toMatch(/modo\s+VARCHAR\(10\)\s+NOT NULL CHECK \(modo IN \('prueba', 'real'\)\)/);
    expect(sinComentarios).not.toMatch(/cuerpo/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 068, y es la última', () => {
    expect(fuente('../db.ts')).toMatch(/'068_permisos_portal_app\.sql',\s*'069_trazabilidad_avisos_envios\.sql'\];/);
  });
});
```

- [ ] **Paso 2: verla fallar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/envio-avisos.test.ts; Pop-Location`
Esperado: FAIL — `ENOENT: no such file or directory … 069_trazabilidad_avisos_envios.sql`.

- [ ] **Paso 3: la migración** — crear `apps/hub-api/src/users/migrations/069_trazabilidad_avisos_envios.sql`:

```sql
-- Migration 069: registro de los avisos a clientes que se envían desde «Avisos a clientes» (Trazabilidad).
--
-- Una fila por cada vez que alguien pulsa «Enviar correo» en una tarjeta (un cliente y un tramo: 90, 60,
-- 30 días o «vencida»). Se apunta ANTES de entregar el correo, como «en_curso», y se cierra con lo que
-- conteste el canal: «enviado» (con el identificador del mensaje) o «fallido» (con el motivo). Un
-- «en_curso» que se queda sin respuesta es lo que la pantalla enseña como «sin confirmar», y lo resuelve
-- una persona (quién y cuándo, en resuelto_*).
--
-- El índice único parcial es el candado contra el doble envío: como mucho UN «en_curso» por cliente y
-- tramo, así que un doble clic o dos personas a la vez dan un 409 al segundo.
--
-- Guarda a quién iba (destinatarios), a quién se mandó (enviado_a: en modo prueba, sólo el buzón de
-- prueba), el asunto y las claves de los equipos; NO guarda el texto. Es un registro, no una cola: nada
-- lo lee para enviar (lo único que envía es la ruta del botón). Sin semilla ni clave foránea.
--
-- Sólo DDL e idempotente: initDb() la re-ejecuta en cada arranque. Da además sus permisos a portal_app
-- (DATA-332) aquí mismo: la 068 corre ANTES que ella en cada arranque, y sin esto la tabla no le
-- llegaría a portal_app hasta el arranque siguiente.

CREATE TABLE IF NOT EXISTS portal.tmc_avisos_envios (
  id              BIGSERIAL    PRIMARY KEY,
  creado_en       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  dia             DATE         NOT NULL,
  por_id          UUID         NULL,
  por             VARCHAR(254) NOT NULL,
  modo            VARCHAR(10)  NOT NULL CHECK (modo IN ('prueba', 'real')),
  clave_cliente   VARCHAR(200) NOT NULL CHECK (clave_cliente <> ''),
  cliente         VARCHAR(200) NOT NULL,
  tramo           VARCHAR(10)  NOT NULL CHECK (tramo IN ('90', '60', '30', 'vencida')),
  equipos         TEXT[]       NOT NULL CHECK (cardinality(equipos) > 0),
  destinatarios   TEXT[]       NOT NULL CHECK (cardinality(destinatarios) > 0),
  enviado_a       TEXT[]       NOT NULL CHECK (cardinality(enviado_a) > 0),
  asunto          TEXT         NOT NULL,
  estado          VARCHAR(10)  NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'enviado', 'fallido')),
  message_id      TEXT         NULL,
  error           TEXT         NULL,
  terminado_en    TIMESTAMPTZ  NULL,
  resuelto_por_id UUID         NULL,
  resuelto_por    VARCHAR(254) NULL,
  resuelto_en     TIMESTAMPTZ  NULL,
  CONSTRAINT tmc_avisos_envios_terminado CHECK ((estado = 'en_curso') = (terminado_en IS NULL)),
  CONSTRAINT tmc_avisos_envios_enviado CHECK (estado <> 'enviado' OR message_id IS NOT NULL OR resuelto_en IS NOT NULL),
  CONSTRAINT tmc_avisos_envios_resuelto CHECK ((resuelto_en IS NULL) = (resuelto_por IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS tmc_avisos_envios_en_curso_uq
  ON portal.tmc_avisos_envios (clave_cliente, tramo) WHERE estado = 'en_curso';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON portal.tmc_avisos_envios TO portal_app;
    GRANT USAGE, SELECT ON SEQUENCE portal.tmc_avisos_envios_id_seq TO portal_app;
  END IF;
END $$;
```

Y en `apps/hub-api/src/db.ts`, al final del array `MIGRATIONS` (línea 102), sustituir `'068_permisos_portal_app.sql'];` por `'068_permisos_portal_app.sql', '069_trazabilidad_avisos_envios.sql'];`

- [ ] **Paso 4: verla pasar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/envio-avisos.test.ts; Pop-Location`
Esperado: PASS (4 tests).

- [ ] **Paso 5: la lista de tablas `tmc_*` (D2)** — en `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`:

(a) Sustituir el título `    it('ninguna tabla del módulo guarda mensajes ni envíos: el aviso automático es sólo una simulación', async () => {` por:

```typescript
    it('las tablas del módulo son las revisadas, una a una: la ÚNICA de envíos es tmc_avisos_envios (lo que una persona envió con su botón) y ninguna es una cola de mensajes pendientes', async () => {
```

(b) Sustituir:

```typescript
        'tmc_agenda_historial',
        'tmc_calibraciones',
```

por:

```typescript
        'tmc_agenda_historial',
        // 2026-11-08 (069): el registro de cada «Enviar correo» de «Avisos a clientes» —quién, cuándo, a quién iba, a quién se mandó y
        // cómo acabó—. Se apunta al pulsar el botón y se cierra con la respuesta: nada lo lee para enviar, así que no es una cola.
        'tmc_avisos_envios',
        'tmc_calibraciones',
```

(c) En `apps/hub-api/src/trazabilidad/calibraciones.db.test.ts` (~línea 480-481, candado de nombres, D1), sustituir:

```typescript
    const { rows } = await hub.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name ~ 'outbox|envio|mensaje|cola|pendiente' AND table_name LIKE 'tmc%'`);
    expect(rows).toEqual([]);
```

por:

```typescript
    const { rows } = await hub.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'portal' AND table_name ~ 'outbox|envio|mensaje|cola|pendiente' AND table_name LIKE 'tmc%' ORDER BY 1`);
    // 2026-11-08 (069, decisión de Alfonso): la ÚNICA tabla de envíos es el registro de «Enviar correo»; cualquier otra hace fallar esto.
    expect(rows).toEqual([{ table_name: 'tmc_avisos_envios' }]);
```

(d) En `apps/hub-api/src/trazabilidad/edicion.db.test.ts` (~línea 161-162, candado de nombres, D1), sustituir:

```typescript
    expect(tablas).toEqual([]);
```

por:

```typescript
    // 2026-11-08 (069, decisión de Alfonso): la ÚNICA tabla de envíos es el registro de «Enviar correo»; cualquier otra hace fallar esto.
    expect(tablas).toEqual(['tmc_avisos_envios']);
```

(Si `expect(tablas).toEqual([]);` aparece más de una vez en el fichero, cambiar SOLO la que sigue a la consulta `table_name ~ 'outbox|envio|mensaje|correo'`.)

Run (Docker encendido): `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/trazabilidad.db.test.ts src/trazabilidad/calibraciones.db.test.ts src/trazabilidad/edicion.db.test.ts; Pop-Location`
Esperado: `Test Files  3 passed (3)` — la tabla existe, está en la lista y los dos candados de nombres ven exactamente esa tabla y ninguna más.

- [ ] **Paso 6: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/users/migrations/069_trazabilidad_avisos_envios.sql apps/hub-api/src/db.ts apps/hub-api/src/trazabilidad/envio-avisos.test.ts apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts apps/hub-api/src/trazabilidad/calibraciones.db.test.ts apps/hub-api/src/trazabilidad/edicion.db.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): migración 069, registro de los avisos enviados

Una fila por cada «Enviar correo», apuntada en curso antes de entregarlo,
con un índice único parcial por cliente y tramo contra el doble envío. No
guarda el texto. Da sus permisos a portal_app porque la 068 corre antes.
EOF
```

## Tarea 2.2: El canal de salida — `envio-avisos.ts`

**Ficheros:**
- Crear: `apps/hub-api/src/trazabilidad/envio-avisos.ts`
- Modificar: `apps/hub-api/src/trazabilidad/envio-avisos.test.ts` (añadir)

- [ ] **Paso 1: escribir la prueba que falla** — en `envio-avisos.test.ts`, añadir debajo de los imports:

```typescript
import { CABECERA_TOKEN, ESPERA_MAX_MS, crearCanalAvisos, modoEfectivo } from './envio-avisos.js';

const URL_N8N = 'https://n8n.example.com/webhook/tmc-avisos-ficticio';
const BUZON = 'buzon-prueba@ambientalia.com.co';
const BASE = { TMC_AVISOS_N8N_URL: URL_N8N, TMC_AVISOS_N8N_TOKEN: 'token-ficticio', TMC_AVISOS_BUZON_PRUEBA: BUZON };
const PRUEBA = { ...BASE, TMC_AVISOS_ENVIO: 'prueba' };
const REAL = { ...BASE, TMC_AVISOS_ENVIO: 'real' };
const CORREO_PRUEBA = { para: [BUZON], asunto: '[PRUEBA] Asunto ficticio', cuerpo: 'Cuerpo ficticio.' };
const CORREO_REAL = { para: ['compras@cliente-uno.example'], asunto: 'Asunto ficticio', cuerpo: 'Cuerpo ficticio.' };

/** Una red de mentira que apunta lo que se le pide y contesta lo que se le diga. */
function red(contestar: () => Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  return {
    llamadas,
    fn: async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return contestar();
    },
  };
}
const json = (status: number, cuerpo: unknown) => async () => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
```

y, al final del fichero:

```typescript
describe('el interruptor: falla cerrado', () => {
  it.each([
    ['sin la variable', {}, 'sin_valor'],
    ['vacía', { TMC_AVISOS_ENVIO: '' }, 'sin_valor'],
    ['«apagado»', { ...BASE, TMC_AVISOS_ENVIO: 'apagado' }, null],
    ['un valor que no se conoce', { ...BASE, TMC_AVISOS_ENVIO: 'si' }, 'valor_desconocido'],
    ['en mayúsculas', { ...BASE, TMC_AVISOS_ENVIO: 'REAL' }, 'valor_desconocido'],
    ['con un espacio detrás', { ...BASE, TMC_AVISOS_ENVIO: 'real ' }, 'valor_desconocido'],
    ['real sin URL', { ...REAL, TMC_AVISOS_N8N_URL: undefined }, 'sin_canal'],
    ['real con algo que no es una URL', { ...REAL, TMC_AVISOS_N8N_URL: 'n8n.example.com' }, 'sin_canal'],
    ['real sin token', { ...REAL, TMC_AVISOS_N8N_TOKEN: ' ' }, 'sin_canal'],
    ['prueba sin token', { ...PRUEBA, TMC_AVISOS_N8N_TOKEN: undefined }, 'sin_canal'],
    ['prueba sin buzón', { ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: undefined }, 'sin_buzon_prueba'],
    ['prueba con un buzón de fuera', { ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: 'buzon@example.com' }, 'sin_buzon_prueba'],
    ['prueba con un subdominio', { ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: 'buzon@correo.ambientalia.com.co' }, 'sin_buzon_prueba'],
  ])('%s → apagado', (_caso, env, motivo) => {
    expect(modoEfectivo(env)).toEqual({ modo: 'apagado', motivo, buzonPrueba: null });
  });

  it('prueba, con todo y un buzón de @ambientalia.com.co (en minúsculas); real, con URL y token', () => {
    expect(modoEfectivo({ ...PRUEBA, TMC_AVISOS_BUZON_PRUEBA: ' Buzon-Prueba@Ambientalia.com.co ' })).toEqual({ modo: 'prueba', motivo: null, buzonPrueba: BUZON });
    expect(modoEfectivo({ ...REAL, TMC_AVISOS_BUZON_PRUEBA: undefined })).toEqual({ modo: 'real', motivo: null, buzonPrueba: null });
  });
});

describe('el canal: la entrega a n8n', () => {
  it('en prueba: POST a la URL, con el token en su cabecera, el correo en JSON y la espera máxima; confirmado → enviado', async () => {
    const r = red(json(200, { ok: true, messageId: 'msg-ficticio-1' }));
    expect(await crearCanalAvisos(PRUEBA, r.fn).remitir(CORREO_PRUEBA, 7)).toEqual({ tipo: 'enviado', messageId: 'msg-ficticio-1' });
    expect(r.llamadas).toHaveLength(1);
    const { url, init } = r.llamadas[0];
    expect([url, init.method, (init.headers as Record<string, string>)[CABECERA_TOKEN]]).toEqual([URL_N8N, 'POST', 'token-ficticio']);
    expect(JSON.parse(String(init.body))).toEqual({ referencia: 7, ...CORREO_PRUEBA });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(ESPERA_MAX_MS).toBe(30_000);
  });

  it('apagado, o en prueba con un destinatario que no es sólo el buzón, ni llama a la red', async () => {
    const r = red(json(200, { ok: true, messageId: 'x' }));
    expect((await crearCanalAvisos({}, r.fn).remitir(CORREO_REAL, 1)).tipo).toBe('rechazado');
    expect((await crearCanalAvisos(PRUEBA, r.fn).remitir(CORREO_REAL, 1)).tipo).toBe('rechazado');
    expect((await crearCanalAvisos(PRUEBA, r.fn).remitir({ ...CORREO_PRUEBA, para: [BUZON, 'compras@cliente-uno.example'] }, 1)).tipo).toBe('rechazado');
    expect(r.llamadas).toEqual([]);
  });

  it.each([
    ['n8n lo rechaza, con su motivo', json(422, { ok: false, error: 'Barrera ficticia.' }), { tipo: 'rechazado', motivo: 'Barrera ficticia.' }],
    ['un 200 con ok: false', json(200, { ok: false, error: 'Gmail no lo envió (ficticio).' }), { tipo: 'rechazado', motivo: 'Gmail no lo envió (ficticio).' }],
    ['el token no vale (sin JSON)', async () => new Response('Forbidden', { status: 403 }), { tipo: 'rechazado', motivo: 'El servicio de correo respondió 403: no ha salido nada.' }],
    ['un 200 que no dice nada claro', json(200, { recibido: true }), { tipo: 'sin_respuesta' }],
    ['no contesta a tiempo', async () => { throw new DOMException('La espera se acabó', 'TimeoutError'); }, { tipo: 'sin_respuesta' }],
    ['no se pudo conectar', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, { tipo: 'rechazado', motivo: 'No se pudo conectar con el servicio de correo: no ha salido nada.' }],
    ['se cortó a mitad', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }); }, { tipo: 'sin_respuesta' }],
  ])('%s', async (_caso, contestar, esperado) => {
    expect(await crearCanalAvisos(REAL, red(contestar).fn).remitir(CORREO_REAL, 7)).toEqual(esperado);
  });
});
```

- [ ] **Paso 2: verla fallar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/envio-avisos.test.ts; Pop-Location`
Esperado: FAIL — `Failed to load url ./envio-avisos.js`.

- [ ] **Paso 3: implementar** — crear `apps/hub-api/src/trazabilidad/envio-avisos.ts`:

```typescript
/**
 * El canal de salida de los avisos a clientes: la ÚNICA pieza de
 * src/trazabilidad que habla con la red (envio-avisos.test.ts lo vigila). Lee
 * su configuración del entorno de hub-api —se cambia sólo en EasyPanel; el
 * portal no puede—, decide el modo efectivo y entrega cada correo a un flujo
 * de n8n (Webhook con token → barrera de dominio → Gmail de info@), esperando
 * su respuesta 30 s como mucho.
 *
 * Falla cerrado: sin TMC_AVISOS_ENVIO, con un valor que no sea exactamente
 * «apagado», «prueba» o «real», sin la URL o el token de n8n, o en prueba sin un
 * buzón de @ambientalia.com.co, el modo es «apagado» y no sale nada. En prueba,
 * además, aquí se vuelve a comprobar que el único destinatario es el buzón.
 *
 * Sin relojes ni programador: manda sólo cuando se le llama, y sólo lo llama la
 * ruta de «Enviar correo» (sólo lo importa router.ts). Es la pieza que cambiará
 * al pasar a Desk 2.0.
 */
import { esBuzonDePrueba, type CanalAvisos, type CorreoAEnviar, type EstadoCanal, type MotivoApagado, type ResultadoRemision } from './avisos-correo.js';
import { normalizarEmail } from './dominio.js';

/** Cuánto se espera, como mucho, la respuesta de n8n. */
export const ESPERA_MAX_MS = 30_000;
/** La cabecera del token: la credencial «Header Auth» del Webhook de n8n la comprueba. */
export const CABECERA_TOKEN = 'X-Tmc-Avisos-Token';
/** Errores de red que dicen que la petición no llegó a salir: entonces seguro que no se envió nada. */
const SIN_CONEXION = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

type Entorno = Readonly<Record<string, string | undefined>>;
type Red = (url: string, init: RequestInit) => Promise<Response>;

const apagado = (motivo: MotivoApagado | null): EstadoCanal => ({ modo: 'apagado', motivo, buzonPrueba: null });

function esUrl(v: string | undefined): boolean {
  try {
    return v !== undefined && ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
}

/** El modo efectivo según el entorno y, si queda apagado sin pedirlo, por qué. Sólo mira `env`. */
export function modoEfectivo(env: Entorno): EstadoCanal {
  const pedido = env.TMC_AVISOS_ENVIO;
  if (pedido === undefined || pedido === '') return apagado('sin_valor');
  if (pedido === 'apagado') return apagado(null);
  if (pedido !== 'prueba' && pedido !== 'real') return apagado('valor_desconocido');
  if (!esUrl(env.TMC_AVISOS_N8N_URL) || !env.TMC_AVISOS_N8N_TOKEN?.trim()) return apagado('sin_canal');
  if (pedido === 'real') return { modo: 'real', motivo: null, buzonPrueba: null };
  if (!esBuzonDePrueba(env.TMC_AVISOS_BUZON_PRUEBA)) return apagado('sin_buzon_prueba');
  return { modo: 'prueba', motivo: null, buzonPrueba: normalizarEmail(env.TMC_AVISOS_BUZON_PRUEBA) };
}

const esEspera = (e: unknown): boolean => ['TimeoutError', 'AbortError'].includes(String((e as { name?: unknown } | null)?.name));
const sinConexion = (e: unknown): boolean => SIN_CONEXION.has(String((e as { cause?: { code?: unknown } } | null)?.cause?.code));

/**
 * El canal de verdad. En producción, con el entorno del proceso y el `fetch` de
 * Node; las pruebas le pasan los suyos. Lee el entorno una vez, al crearse (al
 * arrancar hub-api): cambiar el modo es cambiar la variable y desplegar.
 */
export function crearCanalAvisos(env: Entorno = process.env, red: Red = fetch): CanalAvisos {
  const estado = modoEfectivo(env);
  const url = env.TMC_AVISOS_N8N_URL ?? '';
  const token = env.TMC_AVISOS_N8N_TOKEN ?? '';
  return {
    estado: () => estado,
    async remitir(correo: CorreoAEnviar, referencia: number): Promise<ResultadoRemision> {
      if (estado.modo === 'apagado') return { tipo: 'rechazado', motivo: 'El envío de avisos está apagado: no ha salido nada.' };
      if (estado.modo === 'prueba' && (correo.para.length !== 1 || correo.para[0] !== estado.buzonPrueba)) {
        return { tipo: 'rechazado', motivo: 'En modo prueba sólo se envía al buzón de prueba: no ha salido nada.' };
      }
      let res: Response;
      try {
        res = await red(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', [CABECERA_TOKEN]: token },
          body: JSON.stringify({ referencia, para: correo.para, asunto: correo.asunto, cuerpo: correo.cuerpo }),
          signal: AbortSignal.timeout(ESPERA_MAX_MS),
        });
      } catch (e) {
        return !esEspera(e) && sinConexion(e) ? { tipo: 'rechazado', motivo: 'No se pudo conectar con el servicio de correo: no ha salido nada.' } : { tipo: 'sin_respuesta' };
      }
      let cuerpo: { ok?: unknown; messageId?: unknown; error?: unknown } = {};
      try {
        const j: unknown = await res.json();
        if (j && typeof j === 'object') cuerpo = j as typeof cuerpo;
      } catch (e) {
        if (esEspera(e)) return { tipo: 'sin_respuesta' };
      }
      if (res.ok && cuerpo.ok === true && typeof cuerpo.messageId === 'string' && cuerpo.messageId !== '') return { tipo: 'enviado', messageId: cuerpo.messageId };
      if (!res.ok || cuerpo.ok === false) {
        const motivo = typeof cuerpo.error === 'string' && cuerpo.error.trim() !== '' ? cuerpo.error.trim().slice(0, 500) : `El servicio de correo respondió ${res.status}: no ha salido nada.`;
        return { tipo: 'rechazado', motivo };
      }
      return { tipo: 'sin_respuesta' };
    },
  };
}
```

- [ ] **Paso 4: verla pasar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/envio-avisos.test.ts; Pop-Location`
Esperado: PASS.

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/envio-avisos.ts apps/hub-api/src/trazabilidad/envio-avisos.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): canal de salida de los avisos con interruptor

Único módulo que habla con la red: lee TMC_AVISOS_* (falla cerrado), en
prueba sólo deja salir hacia el buzón y entrega a n8n con token y 30 s de
espera. Distingue confirmado, rechazado y sin respuesta.
EOF
```

## Tarea 2.3: Rutas y flujo de «Enviar correo»; retirar marcar en bloque

**Ficheros:**
- Crear: `apps/hub-api/src/trazabilidad/avisos-envios-repo.ts`
- Crear: `apps/hub-api/src/trazabilidad/avisos-envios.db.test.ts`
- Modificar: `apps/hub-api/src/trazabilidad/types.ts:7-41` (import), `:215-227` (fuera `parseAvisos`, dentro `parsePedidoEnvio` y `parseResolucion`)
- Modificar: `apps/hub-api/src/trazabilidad/router.ts:8-13` (imports), `:31` (`parseAvisos`), `:141-154` (parámetro `canal`), `:211-218` (`retirada`), `:276-279` (comentario), `:487-494` (rutas)
- Modificar: `apps/hub-api/src/trazabilidad/roles.ts:41`
- Modificar: `apps/hub-api/src/trazabilidad/router.test.ts`

- [ ] **Paso 1: las pruebas del router** — en `apps/hub-api/src/trazabilidad/router.test.ts`:

(a) Debajo de `process.env.JWT_SECRET = SECRET;` (línea 15), añadir:

```typescript
// El canal de los avisos por defecto lee su interruptor del entorno: aquí, sin nada, está apagado.
for (const v of ['TMC_AVISOS_ENVIO', 'TMC_AVISOS_BUZON_PRUEBA', 'TMC_AVISOS_N8N_URL', 'TMC_AVISOS_N8N_TOKEN']) delete process.env[v];
```

(b) Debajo de `type DbLectura = import('./fuente.js').DbLectura;` (línea 31), añadir `type CanalAvisos = import('./avisos-correo.js').CanalAvisos;`

(c) Debajo de la función `appCalibraciones()` (tras la línea 131), añadir:

```typescript
// El canal de salida de los avisos de estas pruebas: uno de mentira en modo prueba, que apunta lo que se le da y contesta «enviado».
const remitidos: unknown[] = [];
const CANAL_PRUEBA: CanalAvisos = {
  estado: () => ({ modo: 'prueba', motivo: null, buzonPrueba: 'buzon-prueba@ambientalia.com.co' }),
  remitir: async (correo) => {
    remitidos.push(correo);
    return { tipo: 'enviado', messageId: 'msg-ficticio' };
  },
};
/** La app con ese canal. Da conexiones al doble (resolver un envío va en una transacción). */
function appAvisos() {
  conexiones.cliente = true;
  const a = express();
  a.use(express.json());
  a.use('/api', createTrazabilidadRouter(fakePool, undefined, undefined, undefined, CANAL_PRUEBA));
  return a;
}
```

(d) En el `beforeEach` (línea 168), debajo de `reiniciarRegistroEstados();`, añadir `  remitidos.length = 0;`

(e) Sustituir la entrada de `ESCRITURAS`:

```typescript
    { ruta: 'POST /trazabilidad/avisos', permiso: 'avisos.write', pedir: (c) => request(app()).post('/api/trazabilidad/avisos').set(c).send({ claves: ['18A00001'], fecha: '2026-10-06' }) },
```

por:

```typescript
    // Avisos a clientes (2026-11-08): enviar el aviso de una tarjeta y resolver un envío sin confirmar. El permiso que marcaba en bloque.
    { ruta: 'POST /trazabilidad/avisos/envios', permiso: 'avisos.write', pedir: (c) => request(appAvisos()).post('/api/trazabilidad/avisos/envios').set(c).send({ claveCliente: 'cliente uno', tramo: 30, equipos: ['18A00001'] }) },
    { ruta: 'POST /trazabilidad/avisos/envios/:id/resolver', permiso: 'avisos.write', pedir: (c) => request(appAvisos()).post('/api/trazabilidad/avisos/envios/7/resolver').set(c).send({ salio: false }) },
```

(f) Sustituir:

```typescript
  /** Las dos subidas de la Excel, retiradas el 10/10/2026: siguen registradas sólo para contestar 410 (ver «F-ST-022: … subida retirada»). */
  const RETIRADAS = ['POST /trazabilidad/importaciones', 'POST /trazabilidad/fst022/congelaciones'];
```

por:

```typescript
  /**
   * Las dos subidas de la Excel, retiradas el 10/10/2026, y marcar avisos en bloque, retirado con el envío (2026-11-08): siguen
   * registradas sólo para contestar 410 (ver «F-ST-022: … subida retirada» y «avisos a clientes: enviar y resolver»).
   */
  const RETIRADAS = ['POST /trazabilidad/importaciones', 'POST /trazabilidad/fst022/congelaciones', 'POST /trazabilidad/avisos'];
```

(g) Sustituir el título del test de la línea 254 (`it('son las veinticinco escrituras del router (…`) por:

```typescript
  it('son las veintiséis escrituras del router (la 24.ª, del lote 11: la vigencia de una marca; la 25.ª, del lote 12: la frecuencia de preventivo de un cliente, sólo administradores; y, en lugar de marcar en bloque, enviar y resolver un aviso), cada una con SU permiso, y ninguna queda sin guarda: toda ruta que escribe pasa por escritura() o soloAdmin(); las tres retiradas, por retirada(), que no deja pasar a nadie', () => {
```

(h) En `it('el permiso va antes que la validación …')`, debajo de la línea de `/api/trazabilidad/clientes/A%20B/frecuencia`, añadir:

```typescript
    expect((await request(appAvisos()).post('/api/trazabilidad/avisos/envios').set(c).send({ tramo: 45 })).status).toBe(403);
    expect((await request(appAvisos()).post('/api/trazabilidad/avisos/envios/abc/resolver').set(c).send({})).status).toBe(403);
```

(i) Sustituir `  it.each(['/equipos', '/servicios', '/plazos', '/estados'])('leer sigue abierto a un LECTOR,` por `  it.each(['/equipos', '/servicios', '/plazos', '/estados', '/avisos/envios'])('leer sigue abierto a un LECTOR,`

(j) Sustituir:

```typescript
  it('avisos sin claves → 400', async () => {
    const res = await request(app()).post('/api/trazabilidad/avisos').set(auth()).send({ claves: [], fecha: '2026-10-06' });
    expect(res.status).toBe(400);
    expect(queries).toEqual([]);
  });
});
```

por:

```typescript
  it('marcar avisos en bloque se retiró: 410 para cualquiera, sin validar, sin mirar el rol ni tocar la base', async () => {
    for (const cabecera of [conRol(null), conRol('COMERCIAL'), comoAdmin()]) {
      const res = await request(app()).post('/api/trazabilidad/avisos').set(cabecera).send({ claves: ['18A00001'], fecha: '2026-10-06' });
      expect([res.status, res.body.error]).toEqual([410, 'marcar_retirado']);
      expect(res.body.message).toMatch(/Enviar correo/);
    }
    expect([queries, consultasRol.n]).toEqual([[], 0]);
  });
});

// El envío de los avisos (2026-11-08) por HTTP, con el doble de la base: el interruptor, la validación y la lectura.
// El flujo entero, contra Postgres y con un canal de mentira, está en avisos-envios.db.test.ts.
describe('avisos a clientes: enviar y resolver', () => {
  const TARJETA = { claveCliente: 'cliente uno', tramo: 30, equipos: ['18A00001'] };

  it('con el envío apagado (el entorno sin configurar): 409, sin una sola consulta de negocio', async () => {
    const res = await request(app()).post('/api/trazabilidad/avisos/envios').set(auth()).send(TARJETA);
    expect([res.status, res.body.error]).toEqual([409, 'envio_apagado']);
    expect(queries).toEqual([]);
  });

  it.each([
    ['sin cuerpo', {}],
    ['una clave de cliente sin normalizar', { ...TARJETA, claveCliente: 'Cliente Uno' }],
    ['un tramo que no existe', { ...TARJETA, tramo: 45 }],
    ['el tramo como texto', { ...TARJETA, tramo: '30' }],
    ['sin equipos', { ...TARJETA, equipos: [] }],
    ['una clave de equipo que no vale', { ...TARJETA, equipos: ['a b'] }],
  ])('400 antes de nada: %s', async (_caso, cuerpo) => {
    expect((await request(appAvisos()).post('/api/trazabilidad/avisos/envios').set(auth()).send(cuerpo)).status).toBe(400);
    expect([queries, remitidos]).toEqual([[], []]);
  });

  it('resolver: 400 si «salio» no es verdadero o falso, o si el id no vale', async () => {
    expect((await request(appAvisos()).post('/api/trazabilidad/avisos/envios/7/resolver').set(auth()).send({ salio: 'sí' })).status).toBe(400);
    expect((await request(appAvisos()).post('/api/trazabilidad/avisos/envios/abc/resolver').set(auth()).send({ salio: true })).status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('GET: el modo efectivo y los últimos envíos, abierto a un Lector', async () => {
    const apagado = await request(app()).get('/api/trazabilidad/avisos/envios').set(conRol(null));
    expect([apagado.status, apagado.body]).toEqual([200, { canal: { modo: 'apagado', motivo: 'sin_valor', buzonPrueba: null }, envios: [] }]);
    const prueba = await request(appAvisos()).get('/api/trazabilidad/avisos/envios').set(conRol(null));
    expect(prueba.body.canal).toEqual({ modo: 'prueba', motivo: null, buzonPrueba: 'buzon-prueba@ambientalia.com.co' });
  });
});
```

- [ ] **Paso 2: la prueba de BD del flujo** — crear `apps/hub-api/src/trazabilidad/avisos-envios.db.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from '@algarpibe/zoho-sync';
import { hoyEnColombia } from '../ausencias/saldo.js';
import { asegurarDeskTickets, poolDePrueba } from '../test-db/harness.js';
import type { CanalAvisos, CorreoAEnviar, EstadoCanal, ResultadoRemision } from './avisos-correo.js';
import { planAvisos } from './dominio.js';

// «Enviar correo» contra Postgres, con las rutas de verdad: sólo la sesión y el canal de salida son de mentira (aquí
// no sale nada a la red). Todo ficticio: clientes, seriales y correos.

const SECRET = 'test-secret-avisos-envios';
process.env.JWT_SECRET = SECRET;
vi.mock('../db.js', () => ({
  getHubPool: () => ({
    query: async () => ({ rows: [{ role: 'admin', status: 'active', apps: ['trazabilidad-mantenimientos'], token_version: 0 }], rowCount: 1 }),
    on: () => {},
  }),
}));
const { createTrazabilidadRouter } = await import('./router.js');

const HOY = hoyEnColombia();
const dia = (delta: number): string => new Date(Date.parse(`${HOY}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
const VENCE_EN_10 = dia(-355); // GRIMM: vence dentro de 10 días → tramo 30
const VENCIO_HACE_35 = dia(-400); // vencida en el último año → tramo «vencida»
const BUZON = 'buzon-prueba@ambientalia.com.co';
const PRUEBA: EstadoCanal = { modo: 'prueba', motivo: null, buzonPrueba: BUZON };
const REAL: EstadoCanal = { modo: 'real', motivo: null, buzonPrueba: null };

let estado: EstadoCanal = PRUEBA;
let contestar: (c: CorreoAEnviar) => Promise<ResultadoRemision> = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-1' });
const remitidos: CorreoAEnviar[] = [];
const canal: CanalAvisos = {
  estado: () => estado,
  remitir: async (c) => {
    remitidos.push(c);
    return contestar(c);
  },
};

let hub: Pool;
let api: express.Express;
const como = { Authorization: `Bearer ${jwt.sign({ sub: 'comercial@example.com', user_id: '00000000-0000-4000-8000-0000000000c1', token_version: 0 }, SECRET, { algorithm: 'HS256' })}` };
const TARJETA = { claveCliente: 'cliente ficticio a', tramo: 30, equipos: ['18A00001', '18A00002'] };

const enPortal = (clave: string, ultima: string) => hub.query(`INSERT INTO portal.tmc_equipos (clave, serial, cliente, marca, modelo, ultima_calibracion) VALUES ($1, $1, 'Cliente Ficticio A', 'GRIMM', 'EDM 180C', $2)`, [clave, ultima]);
const enviar = (cuerpo: object = TARJETA) => request(api).post('/api/trazabilidad/avisos/envios').set(como).send(cuerpo);
const resolver = (id: unknown, salio: boolean) => request(api).post(`/api/trazabilidad/avisos/envios/${id}/resolver`).set(como).send({ salio });
const envios = async () => (await request(api).get('/api/trazabilidad/avisos/envios').set(como)).body.envios as { estado: string }[];
const registro = async () => (await hub.query(`SELECT modo, tramo, equipos, destinatarios, enviado_a, asunto, estado, message_id, error, dia::text AS dia FROM portal.tmc_avisos_envios ORDER BY id`)).rows;
const avisados = async () => (await hub.query(`SELECT clave, aviso_enviado::text AS aviso FROM portal.tmc_seguimiento ORDER BY clave`)).rows;
const plan = async () => {
  const inv = (await request(api).get('/api/trazabilidad/equipos').set(como)).body;
  return planAvisos(inv.equipos, inv.hoy, inv.contactos);
};
/** Lleva los envíos al pasado: como si hubieran pasado `minutos`. */
const atrasar = (minutos: number) => hub.query(`UPDATE portal.tmc_avisos_envios SET creado_en = creado_en - make_interval(mins => $1)`, [minutos]);

beforeAll(async () => {
  hub = poolDePrueba();
  await asegurarDeskTickets(hub);
  api = express();
  api.use(express.json());
  api.use('/api', createTrazabilidadRouter(hub, undefined, undefined, undefined, canal));
});
afterAll(async () => {
  await hub?.end();
});
beforeEach(async () => {
  await hub.query('TRUNCATE portal.tmc_equipos, portal.tmc_seguimiento, portal.tmc_contactos, portal.tmc_calibraciones, portal.tmc_avisos_envios, desk.tickets RESTART IDENTITY');
  estado = PRUEBA;
  contestar = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-1' });
  remitidos.length = 0;
  await enPortal('18A00001', VENCE_EN_10);
  await enPortal('18A00002', VENCE_EN_10);
  await hub.query(`INSERT INTO portal.tmc_contactos (clave, cliente, emails, nombre, actualizado_por) VALUES ('cliente ficticio a', 'Cliente Ficticio A', ARRAY['compras@cliente-a.example'], 'Ana Ficticia', 'alguien@example.com')`);
});

describe('enviar el aviso de una tarjeta', () => {
  it('en prueba sale UNA vez y sólo al buzón, con «[PRUEBA]»; el registro guarda a quién iba de verdad y no se marca ningún equipo', async () => {
    const res = await enviar();
    expect([res.status, res.body.estado, res.body.modo]).toEqual([200, 'enviado', 'prueba']);
    expect(remitidos.map((c) => c.para)).toEqual([[BUZON]]);
    expect(remitidos[0].asunto).toBe('[PRUEBA] Último aviso: la calibración de sus monitores GRIMM vence en los próximos 30 días · Cliente Ficticio A');
    expect(remitidos[0].cuerpo.split('\n')[0]).toContain('compras@cliente-a.example');
    expect(await registro()).toEqual([expect.objectContaining({ modo: 'prueba', tramo: '30', equipos: ['18A00001', '18A00002'], destinatarios: ['compras@cliente-a.example'], enviado_a: [BUZON], estado: 'enviado', message_id: 'msg-ficticio-1', dia: HOY })]);
    expect(await avisados()).toEqual([]);
    expect((await plan()).correos.map((c) => c.claveCliente)).toEqual(['cliente ficticio a']); // la tarjeta sigue ahí
  });

  it('en real sale a sus destinatarios y, en la misma transacción, sus equipos quedan avisados hoy: la tarjeta pasa a «Ya avisados»', async () => {
    estado = REAL;
    const res = await enviar();
    expect([res.status, res.body.estado, res.body.modo]).toEqual([200, 'enviado', 'real']);
    expect(remitidos.map((c) => c.para)).toEqual([['compras@cliente-a.example']]);
    expect(await avisados()).toEqual([{ clave: '18A00001', aviso: HOY }, { clave: '18A00002', aviso: HOY }]);
    const p = await plan();
    expect([p.correos, p.yaAvisados.map((a) => a.equipo.clave).sort()]).toEqual([[], ['18A00001', '18A00002']]);
  });

  it('«vencida» también se envía, con su texto, y una vez avisada sale de las tarjetas', async () => {
    estado = REAL;
    await enPortal('18A00009', VENCIO_HACE_35);
    const res = await enviar({ claveCliente: 'cliente ficticio a', tramo: 'vencida', equipos: ['18A00009'] });
    expect(res.body.estado).toBe('enviado');
    expect(remitidos[0].asunto).toBe('La calibración de su monitor GRIMM está vencida · Cliente Ficticio A');
    expect((await plan()).correos.map((c) => c.tramo)).toEqual([30]);
  });

  it('el servidor vuelve a calcular la tarjeta: si ya no está, 404; si sus equipos no son los vistos, 409; y no sale nada', async () => {
    const otra = await enviar({ ...TARJETA, tramo: 'vencida' });
    expect([otra.status, otra.body.error]).toEqual([404, 'tarjeta_no_encontrada']);
    const menos = await enviar({ ...TARJETA, equipos: ['18A00001'] });
    expect([menos.status, menos.body.error]).toEqual([409, 'tarjeta_cambiada']);
    await enPortal('18A00003', VENCE_EN_10); // entra un equipo nuevo en la tarjeta
    expect((await enviar()).body.error).toBe('tarjeta_cambiada');
    expect([remitidos, await registro()]).toEqual([[], []]);
  });

  it('apagado: 409 y no se apunta nada', async () => {
    estado = { modo: 'apagado', motivo: 'sin_valor', buzonPrueba: null };
    const res = await enviar();
    expect([res.status, res.body.error]).toEqual([409, 'envio_apagado']);
    expect([remitidos, await registro()]).toEqual([[], []]);
  });

  it('doble clic o dos personas a la vez: el segundo recibe 409 mientras el primero está en curso, y sale un solo correo', async () => {
    let soltar: () => void = () => {};
    const puerta = new Promise<void>((r) => (soltar = r));
    contestar = async () => {
      await puerta;
      return { tipo: 'enviado', messageId: 'msg-ficticio-1' };
    };
    const primero = enviar().then((r) => r);
    for (let i = 0; remitidos.length === 0 && i < 500; i++) await new Promise((r) => setTimeout(r, 10));
    const segundo = await enviar();
    expect([segundo.status, segundo.body.error]).toEqual([409, 'ya_enviando']);
    soltar();
    expect((await primero).body.estado).toBe('enviado');
    expect(remitidos).toHaveLength(1);
  });

  it('el canal lo rechaza: «fallido» con su motivo, nada marcado, y se puede volver a intentar', async () => {
    estado = REAL;
    contestar = async () => ({ tipo: 'rechazado', motivo: 'Destinatario no permitido (ficticio).' });
    const res = await enviar();
    expect([res.status, res.body.estado, res.body.error]).toEqual([200, 'fallido', 'Destinatario no permitido (ficticio).']);
    expect(await avisados()).toEqual([]);
    contestar = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-2' });
    expect((await enviar()).body.estado).toBe('enviado');
    expect((await registro()).map((r) => r.estado)).toEqual(['fallido', 'enviado']);
  });

  it('sin respuesta: «sin confirmar», no deja reenviar, y a los 2 minutos «Sí salió» lo da por enviado y, en real, marca con el día del envío', async () => {
    estado = REAL;
    contestar = async () => ({ tipo: 'sin_respuesta' });
    const res = await enviar();
    expect([res.status, res.body.estado]).toEqual([200, 'sin_confirmar']);
    expect((await enviar()).body.error).toBe('ya_enviando');
    expect((await resolver(res.body.id, true)).body.error).toBe('no_sin_confirmar'); // aún puede estar saliendo
    expect((await envios())[0].estado).toBe('en_curso');
    await atrasar(3);
    expect((await envios())[0].estado).toBe('sin_confirmar');
    const si = await resolver(res.body.id, true);
    expect([si.status, si.body.estado, si.body.resueltoPor]).toEqual([200, 'enviado', 'comercial@example.com']);
    expect(await avisados()).toEqual([{ clave: '18A00001', aviso: HOY }, { clave: '18A00002', aviso: HOY }]);
    expect((await resolver(res.body.id, false)).status).toBe(409); // ya resuelto
    expect((await resolver(999, false)).status).toBe(404);
  });

  it('«No salió» lo deja «fallido» y la tarjeta se puede volver a enviar', async () => {
    contestar = async () => ({ tipo: 'sin_respuesta' });
    const { body } = await enviar();
    await atrasar(3);
    const no = await resolver(body.id, false);
    expect([no.status, no.body.estado]).toEqual([200, 'fallido']);
    contestar = async () => ({ tipo: 'enviado', messageId: 'msg-ficticio-3' });
    expect((await enviar()).body.estado).toBe('enviado');
    expect(await avisados()).toEqual([]); // en prueba nunca se marca
  });

  it('si la transacción final falla, el correo salió pero queda «sin confirmar» y no se marca nada', async () => {
    estado = REAL;
    await hub.query(`CREATE OR REPLACE FUNCTION portal.tmc_prueba_falla() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo ficticio'; END $$`);
    await hub.query('CREATE TRIGGER tmc_prueba_falla BEFORE INSERT ON portal.tmc_seguimiento FOR EACH ROW EXECUTE FUNCTION portal.tmc_prueba_falla()');
    try {
      const res = await enviar();
      expect([res.status, res.body.estado]).toEqual([200, 'sin_confirmar']);
      expect([remitidos.length, (await registro())[0].estado, await avisados()]).toEqual([1, 'en_curso', []]);
    } finally {
      await hub.query('DROP TRIGGER IF EXISTS tmc_prueba_falla ON portal.tmc_seguimiento');
      await hub.query('DROP FUNCTION IF EXISTS portal.tmc_prueba_falla()');
    }
  });
});

describe('la migración 069', () => {
  const SQL_069 = readFileSync(fileURLToPath(new URL('../users/migrations/069_trazabilidad_avisos_envios.sql', import.meta.url)), 'utf8');

  it('volver a ejecutarla (cada arranque) no toca lo apuntado', async () => {
    await enviar();
    const antes = await registro();
    await hub.query(SQL_069);
    await hub.query(SQL_069);
    expect(await registro()).toEqual(antes);
  });

  it('la base no admite dos «en curso» del mismo cliente y tramo', async () => {
    const fila = `INSERT INTO portal.tmc_avisos_envios (dia, por, modo, clave_cliente, cliente, tramo, equipos, destinatarios, enviado_a, asunto)
                  VALUES (CURRENT_DATE, 'x@example.com', 'prueba', 'cliente ficticio a', 'Cliente Ficticio A', '30', ARRAY['18A00001'], ARRAY['compras@cliente-a.example'], ARRAY['${BUZON}'], 'Asunto ficticio')`;
    await hub.query(fila);
    await expect(hub.query(fila)).rejects.toMatchObject({ code: '23505' });
  });
});
```

- [ ] **Paso 3: verlas fallar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/router.test.ts; Pop-Location`
Esperado: FAIL — la guarda de escrituras (`expected [...] to deeply equal [...]`: falta `POST /trazabilidad/avisos/envios`), los 410 (`expected 400 to be 410`) y las rutas nuevas (404 de Express).

Run (Docker): `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/avisos-envios.db.test.ts; Pop-Location`
Esperado: FAIL (las rutas no existen: 404 en todo).

- [ ] **Paso 4: los validadores** — en `apps/hub-api/src/trazabilidad/types.ts`:

(a) En el import de `./dominio.js`, añadir `TRAMOS_AVISO,` detrás de `TIPO_POR_DEFECTO,` y `type TramoAviso,` detrás de `type TipoAbierto,`.

(b) Sustituir la función entera `parseAvisos` (con su comentario `/** Valida el cuerpo de POST /trazabilidad/avisos. */`) por:

```typescript
/** Lo que manda la pantalla al pulsar «Enviar correo»: qué tarjeta (cliente y tramo) y qué equipos se vieron en ella. */
export interface PedidoEnvio {
  claveCliente: string;
  tramo: TramoAviso;
  equipos: string[];
}

/** Valida el cuerpo de POST /trazabilidad/avisos/envios. */
export function parsePedidoEnvio(body: unknown): PedidoEnvio {
  const b = obj(body, 'body');
  const clave = b.claveCliente;
  if (typeof clave !== 'string' || clave === '' || clave.length > CONTACTO_MAX_TEXTO || clave !== claveCliente(clave)) throw invalido('«claveCliente» no es la clave de un cliente.', 'claveCliente');
  if (!(TRAMOS_AVISO as readonly unknown[]).includes(b.tramo)) throw invalido('«tramo» debe ser 90, 60, 30 o «vencida».', 'tramo');
  if (!Array.isArray(b.equipos) || b.equipos.length === 0) throw invalido('Faltan los equipos de la tarjeta.', 'equipos');
  if (b.equipos.length > 500) throw invalido('Demasiados equipos en una tarjeta.', 'equipos');
  const equipos = b.equipos.map((c, i) => {
    if (typeof c !== 'string' || !esClave(c)) throw invalido('Clave de equipo no válida.', `equipos[${i}]`);
    return c;
  });
  return { claveCliente: clave, tramo: b.tramo as TramoAviso, equipos: [...new Set(equipos)] };
}

/** Valida el cuerpo de POST /trazabilidad/avisos/envios/:id/resolver: `{salio}`, si el correo salió («Sí salió») o no. */
export function parseResolucion(body: unknown): boolean {
  const b = obj(body, 'body');
  if (typeof b.salio !== 'boolean') throw invalido('«salio» debe ser verdadero o falso.', 'salio');
  return b.salio;
}
```

- [ ] **Paso 5: el flujo y su SQL** — crear `apps/hub-api/src/trazabilidad/avisos-envios-repo.ts`:

```typescript
/**
 * «Enviar correo» en «Avisos a clientes» (2026-11-08, migración 069): el flujo
 * del envío de una tarjeta y el SQL de su registro, `portal.tmc_avisos_envios`
 * (único fichero que lo escribe).
 *
 * El navegador sólo dice QUÉ tarjeta (cliente y tramo) y qué equipos vio. A
 * quién va y con qué texto lo decide aquí el servidor, con el plan de ese
 * momento (`planAvisos` sobre el mismo inventario y los mismos contactos que
 * GET /equipos): si la tarjeta ya no está, 404; si sus equipos no son los
 * vistos, 409. Nada sale sin una fila «en curso» antes: el índice único
 * parcial por (cliente, tramo) da un 409 al segundo de un doble clic. Lo que
 * conteste el canal decide el final: confirmado → «enviado» (y, en modo real,
 * en la misma transacción, los equipos quedan con «Aviso enviado al cliente» =
 * el día del envío, con `registrarAvisos`); rechazado → «fallido»; sin
 * respuesta, o si esa transacción falla → sigue «en curso», que la pantalla
 * enseña como «sin confirmar» y una persona resuelve («Sí salió» / «No salió»).
 *
 * Cómo se envía no lo sabe este fichero: el canal llega por parámetro
 * (`CanalAvisos`, avisos-correo.ts; el de verdad es envio-avisos.ts).
 */
import type { Pool } from '@algarpibe/zoho-sync';
import { captureError } from '../sentry.js';
import { SIN_CONFIRMAR_MS, correoDePrueba, correoReal, estadoPresentado, mismaHuella, type CanalAvisos, type EnvioAviso, type EstadoCanal, type EstadoGuardado, type RespuestaEnvios } from './avisos-correo.js';
import { planAvisos, type TramoAviso } from './dominio.js';
import { listarContactos, listarEquipos, registrarAvisos, withTransaction } from './repo.js';
import { TzError, type Actor, type PedidoEnvio } from './types.js';

type PoolClient = Awaited<ReturnType<Pool['connect']>>;
type Db = Pick<PoolClient, 'query'>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Cuántos envíos enseña «Últimos envíos» (más todos los que sigan en curso). */
export const ULTIMOS_ENVIOS = 30;
const UNICO_EN_CURSO = 'tmc_avisos_envios_en_curso_uq';

const COLS = `id, creado_en::text AS creado_en, EXTRACT(EPOCH FROM (NOW() - creado_en)) * 1000 AS edad_ms, por, modo, clave_cliente, cliente,
  tramo, equipos, destinatarios, enviado_a, asunto, estado, message_id, error, resuelto_por, resuelto_en::text AS resuelto_en`;

function aEnvio(r: Row): EnvioAviso {
  return {
    id: Number(r.id),
    creadoEn: r.creado_en,
    por: r.por,
    modo: r.modo,
    claveCliente: r.clave_cliente,
    cliente: r.cliente,
    tramo: r.tramo === 'vencida' ? 'vencida' : (Number(r.tramo) as TramoAviso),
    equipos: r.equipos,
    destinatarios: r.destinatarios,
    enviadoA: r.enviado_a,
    asunto: r.asunto,
    estado: estadoPresentado(r.estado as EstadoGuardado, Number(r.edad_ms)),
    messageId: r.message_id,
    error: r.error,
    resueltoPor: r.resuelto_por,
    resueltoEn: r.resuelto_en,
  };
}

async function leerEnvio(db: Db, id: number): Promise<EnvioAviso> {
  const { rows } = await db.query(`SELECT ${COLS} FROM portal.tmc_avisos_envios WHERE id = $1`, [id]);
  return aEnvio(rows[0]);
}

/** GET /trazabilidad/avisos/envios: el modo efectivo y los últimos envíos —los que siguen en curso, todos—, el más reciente primero. */
export async function leerEnvios(db: Db, canal: EstadoCanal): Promise<RespuestaEnvios> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM portal.tmc_avisos_envios
      WHERE estado = 'en_curso' OR id IN (SELECT id FROM portal.tmc_avisos_envios ORDER BY id DESC LIMIT $1)
      ORDER BY id DESC`,
    [ULTIMOS_ENVIOS],
  );
  return { canal, envios: (rows as Row[]).map(aEnvio) };
}

/**
 * POST /trazabilidad/avisos/envios: envía el aviso de UNA tarjeta y devuelve su
 * envío tal como queda («enviado», «fallido» o «sin confirmar»). `hoy` es el día
 * de Colombia: el del plan y el que se apunta como «Aviso enviado al cliente».
 */
export async function enviarAviso(db: Pool, canal: CanalAvisos, pedido: PedidoEnvio, actor: Actor, hoy: string): Promise<EnvioAviso> {
  const estado = canal.estado();
  if (estado.modo === 'apagado') throw new TzError('envio_apagado', 409, 'El envío de avisos está apagado: no se ha enviado nada.');
  const [equipos, contactos] = await Promise.all([listarEquipos(db, hoy), listarContactos(db)]);
  const tarjeta = planAvisos(equipos, hoy, contactos).correos.find((c) => c.claveCliente === pedido.claveCliente && c.tramo === pedido.tramo);
  if (!tarjeta) throw new TzError('tarjeta_no_encontrada', 404, 'Ese aviso ya no está pendiente (puede que ya se haya enviado o que sus equipos hayan cambiado): recarga la página.');
  const claves = tarjeta.equipos.map((a) => a.equipo.clave);
  if (!mismaHuella(claves, pedido.equipos)) throw new TzError('tarjeta_cambiada', 409, 'La tarjeta cambió desde que la abriste: recarga la página y revísala antes de enviar.');
  const real = correoReal(tarjeta);
  const sale = estado.modo === 'prueba' ? correoDePrueba(real, estado.buzonPrueba) : real;
  let id: number;
  try {
    const { rows } = await db.query(
      `INSERT INTO portal.tmc_avisos_envios (dia, por_id, por, modo, clave_cliente, cliente, tramo, equipos, destinatarios, enviado_a, asunto)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10::text[], $11) RETURNING id`,
      [hoy, actor.userId, actor.email, estado.modo, tarjeta.claveCliente, tarjeta.cliente, String(tarjeta.tramo), claves, real.para, sale.para, sale.asunto],
    );
    id = Number(rows[0].id);
  } catch (e) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === UNICO_EN_CURSO) throw new TzError('ya_enviando', 409, 'Este aviso ya se está enviando, o quedó sin confirmar: míralo en «Últimos envíos».');
    throw e;
  }
  const r = await canal.remitir(sale, id);
  if (r.tipo === 'rechazado') {
    await db.query(`UPDATE portal.tmc_avisos_envios SET estado = 'fallido', error = $2, terminado_en = NOW() WHERE id = $1 AND estado = 'en_curso'`, [id, r.motivo]);
  } else if (r.tipo === 'enviado') {
    try {
      await withTransaction(db, async (c) => {
        const { rows } = await c.query(
          `UPDATE portal.tmc_avisos_envios SET estado = 'enviado', message_id = $2, terminado_en = NOW()
            WHERE id = $1 AND estado = 'en_curso' RETURNING modo, equipos, dia::text AS dia`,
          [id, r.messageId],
        );
        if (rows[0]?.modo === 'real') await registrarAvisos(c, rows[0].equipos, rows[0].dia, actor);
      });
    } catch (e) {
      // El correo salió, pero no quedó apuntado: sigue «en curso» y una persona lo resuelve («Sí salió»).
      captureError(e, { endpoint: 'tmc_aviso_enviar_cierre' });
    }
  }
  const envio = await leerEnvio(db, id);
  return envio.estado === 'en_curso' ? { ...envio, estado: 'sin_confirmar' } : envio;
}

/**
 * POST /trazabilidad/avisos/envios/:id/resolver: una persona dice si un «sin
 * confirmar» salió (`salio`) o no. Sólo vale para un «en curso» de 2 minutos o
 * más; «Sí salió» en modo real marca los equipos con el día del envío.
 */
export async function resolverEnvio(db: Pool, id: number, salio: boolean, actor: Actor): Promise<EnvioAviso> {
  return withTransaction(db, async (c) => {
    const { rows } = await c.query(
      `UPDATE portal.tmc_avisos_envios
          SET estado = $2::varchar, error = CASE WHEN $2::varchar = 'fallido' THEN 'No salió: resuelto a mano.' ELSE error END,
              terminado_en = NOW(), resuelto_por_id = $3, resuelto_por = $4, resuelto_en = NOW()
        WHERE id = $1 AND estado = 'en_curso' AND creado_en <= NOW() - make_interval(secs => $5)
        RETURNING modo, equipos, dia::text AS dia`,
      [id, salio ? 'enviado' : 'fallido', actor.userId, actor.email, SIN_CONFIRMAR_MS / 1000],
    );
    if (rows.length === 0) {
      const { rows: hay } = await c.query('SELECT 1 FROM portal.tmc_avisos_envios WHERE id = $1', [id]);
      if (hay.length === 0) throw new TzError('not_found', 404, 'Ese envío no existe.');
      throw new TzError('no_sin_confirmar', 409, 'Ese envío no está sin confirmar: ya se resolvió o todavía se está enviando (espera un par de minutos).');
    }
    if (salio && rows[0].modo === 'real') await registrarAvisos(c, rows[0].equipos, rows[0].dia, actor);
    return leerEnvio(c, id);
  });
}
```

- [ ] **Paso 6: el router** — en `apps/hub-api/src/trazabilidad/router.ts`:

(a) Imports: debajo de `import { ejeAgenda } from './agenda-calendario.js';` añadir

```typescript
import type { CanalAvisos } from './avisos-correo.js';
import { enviarAviso, leerEnvios, resolverEnvio } from './avisos-envios-repo.js';
```

debajo de `import { anularCalibracion, anularPartida, registrarManual } from './edicion-repo.js';` añadir `import { crearCanalAvisos } from './envio-avisos.js';`; en el import de `./types.js` borrar la línea `  parseAvisos,` y añadir `  parsePedidoEnvio,` debajo de `  parsePaginaFst022,` y `  parseResolucion,` debajo de `  parseReparto,`.

(b) Sustituir:

```typescript
 * `calibraciones` lee de esa misma base las fechas de calibración de los
 * tickets (calibraciones-desk2.ts), igual de aparte y con la misma regla.
 */
export function createTrazabilidadRouter(
  db: Pool,
  fuente: FuenteAgenda = crearFuenteAgenda({ hub: db, desk2: getDesk2Pool }),
  maestro: LectorMaestro = crearLectorMaestro(getDesk2Pool),
  calibraciones: LectorCalibraciones = crearLectorCalibraciones(getDesk2Pool),
): Router {
```

por:

```typescript
 * `calibraciones` lee de esa misma base las fechas de calibración de los
 * tickets (calibraciones-desk2.ts), igual de aparte y con la misma regla.
 * `canal` es por dónde salen los avisos a clientes (envio-avisos.ts), con su
 * configuración del entorno: sin ella, apagado. Las pruebas pasan uno falso.
 */
export function createTrazabilidadRouter(
  db: Pool,
  fuente: FuenteAgenda = crearFuenteAgenda({ hub: db, desk2: getDesk2Pool }),
  maestro: LectorMaestro = crearLectorMaestro(getDesk2Pool),
  calibraciones: LectorCalibraciones = crearLectorCalibraciones(getDesk2Pool),
  canal: CanalAvisos = crearCanalAvisos(),
): Router {
```

(c) Sustituir `retirada`:

```typescript
  /**
   * Una ruta retirada: no deja pasar a nadie —tampoco a un administrador— y
   * no mira el cuerpo, el rol ni la base. Sólo contesta 410, en español.
   */
  const retirada = (ctx: string) =>
    route(ctx, async () => {
      throw new TzError('subida_retirada', 410, 'La subida de la Excel F-ST-022 se retiró el 10/10/2026: la hoja está congelada y ya no se importa ni se vuelve a congelar. Lo congelado se consulta en «Administración» → «Configuración».');
    });
```

por:

```typescript
  /**
   * Una ruta retirada: no deja pasar a nadie —tampoco a un administrador— y
   * no mira el cuerpo, el rol ni la base. Sólo contesta 410, en español; por
   * defecto, el de la subida de la Excel.
   */
  const retirada = (
    ctx: string,
    codigo = 'subida_retirada',
    mensaje = 'La subida de la Excel F-ST-022 se retiró el 10/10/2026: la hoja está congelada y ya no se importa ni se vuelve a congelar. Lo congelado se consulta en «Administración» → «Configuración».',
  ) =>
    route(ctx, async () => {
      throw new TzError(codigo, 410, mensaje);
    });
```

(d) Sustituir el comentario de `PUT /trazabilidad/contactos`:

```typescript
  // `emails` vacío se quita y vuelve a valer el de Desk. Devuelve lo mismo que
  // el GET de equipos, ya actualizado. Sólo guarda a quién se le escribiría:
  // esta API no manda ningún correo (el aviso automático es una simulación).
```

por:

```typescript
  // `emails` vacío se quita y vuelve a valer el de Desk. Devuelve lo mismo que
  // el GET de equipos, ya actualizado. Sólo guarda a quién se le escribe: el
  // correo lo manda, a mano, «Enviar correo» (abajo, `avisos/envios`).
```

(e) Sustituir el bloque de `router.post('/trazabilidad/avisos', …)` (líneas 487-494) por:

```typescript
  // ── Avisos a clientes: «Enviar correo» (2026-11-08, migración 069) ───────
  //
  // El envío es siempre a mano, tarjeta a tarjeta: sólo estas rutas lo disparan
  // o lo resuelven (envio-avisos.test.ts vigila que nada más llame a
  // `enviarAviso`). La pantalla manda qué tarjeta y qué equipos vio; a quién va
  // y con qué texto lo decide el servidor (avisos-envios-repo.ts). El modo
  // —apagado, prueba o real— sale del entorno de hub-api y no se cambia desde
  // aquí: GET lo enseña, con los últimos envíos.
  router.get('/trazabilidad/avisos/envios', ...gated, route('tmc_avisos_envios', async () => leerEnvios(db, canal.estado())));
  router.post('/trazabilidad/avisos/envios', ...gated, escritura('avisos.write', 'tmc_aviso_enviar', async (req) => enviarAviso(db, canal, parsePedidoEnvio(req.body), actorOf(req), hoyEnColombia())));
  router.post('/trazabilidad/avisos/envios/:id/resolver', ...gated, escritura('avisos.write', 'tmc_aviso_resolver', async (req) => resolverEnvio(db, parseEnteroRuta(req.params.id, 'id'), parseResolucion(req.body), actorOf(req))));

  // Marcar avisos en bloque se retiró con la vista «Manual»: 410 a un portal sin actualizar.
  router.post('/trazabilidad/avisos', ...gated, retirada('tmc_avisos', 'marcar_retirado', 'Marcar avisos en bloque se retiró: recarga la página. El aviso se envía desde su tarjeta, con «Enviar correo»; si se avisa por teléfono, se apunta en la ficha del equipo.'));
```

- [ ] **Paso 7: el texto del permiso** — `apps/hub-api/src/trazabilidad/roles.ts:41`, sustituir `  /** Avisos manuales: marcar como avisado en bloque. */` por `  /** Avisos a clientes: enviar el aviso de una tarjeta («Enviar correo») y resolver un envío sin confirmar. */`

- [ ] **Paso 8: verlas pasar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/router.test.ts src/trazabilidad/roles.test.ts src/trazabilidad/envio-avisos.test.ts; Pop-Location`
Esperado: PASS (la guarda de escrituras con 26, las tres retiradas y el candado «nada de esto envía» de `router.ts`, `repo.ts`, `dominio.ts` y `types.ts` intacto y en verde).

Run (Docker): `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/avisos-envios.db.test.ts; Pop-Location`
Esperado: `Test Files  1 passed (1)`, `Tests  12 passed (12)`.

- [ ] **Paso 9: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/avisos-envios-repo.ts apps/hub-api/src/trazabilidad/avisos-envios.db.test.ts apps/hub-api/src/trazabilidad/types.ts apps/hub-api/src/trazabilidad/router.ts apps/hub-api/src/trazabilidad/roles.ts apps/hub-api/src/trazabilidad/router.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): enviar y resolver avisos a clientes; retirar marcar en bloque

El servidor vuelve a calcular la tarjeta (404 si ya no está, 409 si cambió),
la apunta en curso, la entrega al canal y la cierra: enviado (en real, marca
los equipos en la misma transacción), fallido o sin confirmar. «Sí salió» y
«No salió» resuelven a mano. POST /trazabilidad/avisos contesta 410.
EOF
```

## Tarea 2.4: Candados nuevos del envío

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/envio-avisos.test.ts` (añadir)

- [ ] **Paso 1: escribir los candados** — en `envio-avisos.test.ts`, cambiar `import { readFileSync } from 'node:fs';` por `import { readFileSync, readdirSync } from 'node:fs';` y añadir al final:

```typescript
// CANDADO (2026-11-08). Hasta aquí, nada de src/trazabilidad podía enviar. Ahora hay UN camino, y se vigila con lupa:
//   · sólo envio-avisos.ts llama a la red, nombra n8n o lee TMC_AVISOS_* (los candados «nada de esto envía» de router.ts,
//     repo.ts, dominio.ts, types.ts y demás siguen en pie, sin tocar);
//   · no tiene relojes ni programador: la espera máxima es AbortSignal.timeout;
//   · sólo lo importa router.ts, y nadie más que la ruta del botón llama a enviarAviso;
//   · un modo desconocido es apagado y, en prueba, el único destinatario es el buzón (arriba: «el interruptor» y «el canal»).
describe('CANDADO: el canal de salida', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  const APP = fileURLToPath(new URL('../../../trazabilidad-mantenimientos/src', import.meta.url));
  const listar = (raiz: string) =>
    (readdirSync(raiz, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('test-db/'));
  const fuentes = listar(SRC);
  const leer = (f: string) => readFileSync(`${SRC}/${f}`, 'utf8');
  const canal = leer('trazabilidad/envio-avisos.ts');

  it('es el único fuente de src/trazabilidad que llama a la red, nombra n8n o mira el entorno, y el único de hub-api que lee TMC_AVISOS_*', () => {
    const red = /\bfetch\b|n8n|webhook|nodemailer|smtp|sendMail|https?\.request|undici|AbortSignal/i;
    const deTrazabilidad = fuentes.filter((f) => f.startsWith('trazabilidad/'));
    expect(deTrazabilidad.filter((f) => red.test(leer(f)))).toEqual(['trazabilidad/envio-avisos.ts']);
    expect(deTrazabilidad.filter((f) => /process\.env/.test(leer(f)))).toEqual(['trazabilidad/envio-avisos.ts']);
    expect(fuentes.filter((f) => /TMC_AVISOS_/.test(leer(f)))).toEqual(['trazabilidad/envio-avisos.ts']);
  });

  it('no tiene relojes ni programador: espera con AbortSignal.timeout y nada más', () => {
    expect(canal).not.toMatch(/setInterval|setTimeout|setImmediate|\bcron\b|schedule/i);
    expect(canal).toMatch(/signal: AbortSignal\.timeout\(ESPERA_MAX_MS\)/);
  });

  it('sólo lo importa router.ts —ni otro fuente de hub-api ni la app—, y él sólo importa el correo del aviso y el dominio', () => {
    expect(fuentes.filter((f) => /envio-avisos(\.js)?'/.test(leer(f)))).toEqual(['trazabilidad/router.ts']);
    expect(listar(APP).filter((f) => readFileSync(`${APP}/${f}`, 'utf8').includes('envio-avisos'))).toEqual([]);
    expect([...canal.matchAll(/^import\b[^;]*?from '([^']+)';/gms)].map((m) => m[1]).sort()).toEqual(['./avisos-correo.js', './dominio.js']);
  });

  it('nada envía por su cuenta: sólo la ruta del botón llama a enviarAviso, sólo el flujo del envío llama a remitir, y el arranque no sabe de ellos', () => {
    expect(fuentes.filter((f) => /\benviarAviso\(/.test(leer(f))).sort()).toEqual(['trazabilidad/avisos-envios-repo.ts', 'trazabilidad/router.ts']);
    expect(fuentes.filter((f) => /\.remitir\(/.test(leer(f)))).toEqual(['trazabilidad/avisos-envios-repo.ts']);
    expect(leer('index.ts')).not.toMatch(/enviarAviso|crearCanalAvisos|remitir|envio-avisos/);
  });
});
```

- [ ] **Paso 2: verlos pasar**

Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/envio-avisos.test.ts; Pop-Location`
Esperado: PASS.

- [ ] **Paso 3: comprobar que un candado muerde** (ciclo de falsación; PowerShell para la copia y el hash):

```powershell
$f = 'apps\hub-api\src\trazabilidad\envio-avisos.ts'; Copy-Item $f "$env:TEMP\envio-avisos.ts.bak"; (Get-FileHash $f).Hash
```

Con Edit, añadir al final de `envio-avisos.ts` la línea `setTimeout(() => {}, 0);`. Ejecutar `Push-Location apps/hub-api; npx vitest run src/trazabilidad/envio-avisos.test.ts; Pop-Location` → esperado: FAIL exactamente en «no tiene relojes ni programador». Quitar la línea con Edit y comprobar `(Get-FileHash 'apps\hub-api\src\trazabilidad\envio-avisos.ts').Hash` → el mismo hash de antes. Si no coincide, restaurar con `Copy-Item "$env:TEMP\envio-avisos.ts.bak" 'apps\hub-api\src\trazabilidad\envio-avisos.ts'`.

- [ ] **Paso 4: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/envio-avisos.test.ts
git commit -F - <<'EOF'
test(trazabilidad): candados del canal de salida de los avisos

Sólo envio-avisos.ts llama a la red y lee TMC_AVISOS_*; sin relojes; sólo lo
importa router.ts; sólo la ruta del botón llama a enviarAviso. Los candados
de código de siempre siguen intactos.
EOF
```

## Tarea 2.5: Verificación del lote 2, merge y push

- [ ] **Paso 1: todo en verde**

Run: `Push-Location apps/hub-api; npm test; Pop-Location` — PASS.
Run: `Push-Location apps/hub-api; npx tsc -p tsconfig.json --noEmit; Pop-Location` — sólo el error conocido de `barril.test.ts`.
Run (Docker): `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad src/db.roles.db.test.ts; Pop-Location` — todos PASS (incluye `calibraciones.db.test.ts` y `edicion.db.test.ts` con sus candados de nombres de tabla, y `db.roles.db.test.ts`, que migra con un rol corriente y crea `portal_app`: así se ejecuta el bloque `GRANT` de la 069).
Run: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; Pop-Location` — PASS (la app compila `types.ts`, que ganó imports).
Después: `docker desktop stop`.

- [ ] **Paso 2: tamaño (Bash)** — `git diff --shortstat -M main...HEAD` < 800 (previsión: ~760). Si pasa de 800, **no se mergea**: se para y se pregunta a Alfonso (mergear igual, o separar la Tarea 2.4 en una rama propia, lo que exige reescribir esta rama y necesita su permiso).

- [ ] **Paso 3: merge y push (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main
git merge --no-ff feat/avisos-envio-servidor -m "merge: envío de avisos en hub-api (registro, canal, rutas y candados)"
git push origin main
```

- [ ] **Paso 4: avisar a Alfonso** — «Lote 2 empujado. Mejor desplegar hub-api y portal seguidos al acabar el lote 3 (hub-api primero): si despliegas hub-api ahora, la vista Manual vieja contesta 410 al marcar en bloque. Sin variables `TMC_AVISOS_*` en EasyPanel el envío está apagado: no sale nada.»

---

# LOTE 3 — La pantalla única y la documentación

Rama: `feat/avisos-envio-pantalla`. Sin pruebas de componente (la app sólo prueba `src/lib`): la lógica nueva va a `src/lib/envios.ts` con TDD; lo visual se revisa en el navegador en la fase 1 del lote 4.

- [ ] **Paso 3.0: rama (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main && git pull --ff-only && git switch -c feat/avisos-envio-pantalla
```

## Tarea 3.1: Lo que la pantalla dice del envío — `src/lib/envios.ts`

**Ficheros:**
- Crear: `apps/trazabilidad-mantenimientos/src/lib/envios.ts`
- Crear: `apps/trazabilidad-mantenimientos/src/lib/envios.test.ts`

- [ ] **Paso 1: escribir la prueba que falla** — `apps/trazabilidad-mantenimientos/src/lib/envios.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { EnvioAviso } from '../dominio';
import { botonEnviar, envioDeEquipo, rotuloModo, textoEstadoEnvio, ultimoEnvioDe } from './envios';

// Lo que la pantalla de avisos dice del envío. Sin red: los envíos son de mentira, y ficticios.

const BUZON = 'buzon-prueba@ambientalia.com.co';
const REAL = { modo: 'real', motivo: null, buzonPrueba: null } as const;
const PRUEBA = { modo: 'prueba', motivo: null, buzonPrueba: BUZON } as const;
let n = 0;
const envio = (x: Partial<EnvioAviso> = {}): EnvioAviso => ({
  id: ++n,
  creadoEn: '2026-11-08 15:00:00+00',
  por: 'comercial@example.com',
  modo: 'prueba',
  claveCliente: 'cliente uno',
  cliente: 'Cliente Uno',
  tramo: 30,
  equipos: ['18A00001'],
  destinatarios: ['compras@cliente-uno.example'],
  enviadoA: [BUZON],
  asunto: '[PRUEBA] Asunto ficticio',
  estado: 'enviado',
  messageId: 'msg-ficticio',
  error: null,
  resueltoPor: null,
  resueltoEn: null,
  ...x,
});

describe('el rótulo del interruptor', () => {
  it('real, y prueba con su buzón', () => {
    expect(rotuloModo(REAL)).toMatchObject({ tono: 'green', titulo: 'Envío real' });
    expect(rotuloModo(PRUEBA)).toEqual({ tono: 'blue', titulo: 'Envío en prueba', texto: `Todo va sólo a ${BUZON}, con «[PRUEBA]» en el asunto: ningún cliente recibe nada y ningún equipo queda marcado como avisado.` });
  });

  it('apagado, y por qué si nadie lo pidió', () => {
    expect(rotuloModo({ modo: 'apagado', motivo: null, buzonPrueba: null }).texto).toBe('No sale ningún correo. El interruptor se cambia sólo en el servidor.');
    expect(rotuloModo({ modo: 'apagado', motivo: 'sin_valor', buzonPrueba: null })).toEqual({ tono: 'amber', titulo: 'Envío apagado', texto: 'No sale ningún correo: nadie ha encendido el interruptor. El interruptor se cambia sólo en el servidor.' });
    for (const motivo of ['valor_desconocido', 'sin_canal', 'sin_buzon_prueba'] as const) {
      expect(rotuloModo({ modo: 'apagado', motivo, buzonPrueba: null }).texto).toMatch(/^No sale ningún correo: .+\. El interruptor se cambia sólo en el servidor\.$/);
    }
  });
});

describe('cada envío y cada tarjeta', () => {
  it('el resultado de un envío, en palabras', () => {
    expect(textoEstadoEnvio({ estado: 'enviado', error: null })).toBe('Enviado');
    expect(textoEstadoEnvio({ estado: 'fallido', error: 'Barrera ficticia.' })).toBe('Fallido: Barrera ficticia.');
    expect(textoEstadoEnvio({ estado: 'fallido', error: null })).toBe('Fallido');
    expect(textoEstadoEnvio({ estado: 'sin_confirmar', error: null })).toBe('Sin confirmar: revisa Enviados de info@');
    expect(textoEstadoEnvio({ estado: 'en_curso', error: null })).toMatch(/^Enviando…/);
  });

  it('el último envío de una tarjeta es el primero de la lista con su cliente y su tramo', () => {
    const lista = [envio({ tramo: 'vencida' }), envio({ estado: 'fallido' }), envio()];
    expect(ultimoEnvioDe(lista, 'cliente uno', 30)).toBe(lista[1]);
    expect(ultimoEnvioDe(lista, 'cliente uno', 'vencida')).toBe(lista[0]);
    expect(ultimoEnvioDe(lista, 'cliente dos', 30)).toBeNull();
  });

  it('el botón: apagado, ocupado mientras hay un envío abierto, y listo tras uno cerrado', () => {
    expect(botonEnviar({ modo: 'apagado', motivo: null, buzonPrueba: null }, null)).toEqual({ activo: false, texto: 'Envío apagado' });
    expect(botonEnviar(PRUEBA, envio({ estado: 'en_curso' }))).toEqual({ activo: false, texto: 'Enviando…' });
    expect(botonEnviar(REAL, envio({ estado: 'sin_confirmar' }))).toEqual({ activo: false, texto: 'Sin confirmar' });
    for (const u of [null, envio(), envio({ estado: 'fallido' })]) expect(botonEnviar(REAL, u)).toEqual({ activo: true, texto: 'Enviar correo' });
  });

  it('quién avisó a un equipo desde aquí: sólo un envío real que salió', () => {
    const real = envio({ modo: 'real', equipos: ['18A00001', '18A00002'], enviadoA: ['compras@cliente-uno.example'] });
    expect(envioDeEquipo([envio(), real], '18A00002')).toBe(real);
    expect(envioDeEquipo([envio({ modo: 'real', estado: 'fallido' })], '18A00001')).toBeNull();
    expect(envioDeEquipo([envio()], '18A00001')).toBeNull(); // en prueba no se avisa a nadie
  });
});
```

- [ ] **Paso 2: verla fallar**

Run: `Push-Location apps/trazabilidad-mantenimientos; npx vitest run src/lib/envios.test.ts; Pop-Location`
Esperado: FAIL — `Failed to load url ./envios`.

- [ ] **Paso 3: implementar** — `apps/trazabilidad-mantenimientos/src/lib/envios.ts`:

```typescript
/**
 * Lo que «Avisos a clientes» dice del envío: el rótulo del interruptor, el
 * estado de cada envío, el botón de cada tarjeta y quién avisó a un equipo.
 * Puro: sin React ni red. A quién va y qué texto sale lo decide el servidor
 * (avisos-envios-repo.ts, en hub-api); el modo, su entorno.
 */
import type { EnvioAviso, EstadoCanal, EstadoEnvio, MotivoApagado, TramoAviso } from '../dominio';

export interface Rotulo {
  tono: 'amber' | 'blue' | 'green';
  titulo: string;
  texto: string;
}

const POR_QUE: Record<MotivoApagado, string> = {
  sin_valor: 'nadie ha encendido el interruptor',
  valor_desconocido: 'el interruptor tiene un valor que no se reconoce',
  sin_canal: 'falta la configuración del canal de correo',
  sin_buzon_prueba: 'falta el buzón de prueba o no es de @ambientalia.com.co',
};

/** El rótulo de arriba de la pantalla: cómo está el interruptor de envío y, si está apagado sin pedirlo, por qué. */
export function rotuloModo(c: EstadoCanal): Rotulo {
  if (c.modo === 'real') return { tono: 'green', titulo: 'Envío real', texto: 'Al pulsar «Enviar correo», el aviso sale desde info@ambientalia.com.co hacia el cliente y sus equipos quedan como avisados hoy.' };
  if (c.modo === 'prueba') return { tono: 'blue', titulo: 'Envío en prueba', texto: `Todo va sólo a ${c.buzonPrueba}, con «[PRUEBA]» en el asunto: ningún cliente recibe nada y ningún equipo queda marcado como avisado.` };
  return { tono: 'amber', titulo: 'Envío apagado', texto: `No sale ningún correo${c.motivo ? `: ${POR_QUE[c.motivo]}` : ''}. El interruptor se cambia sólo en el servidor.` };
}

const TEXTO_ESTADO: Record<EstadoEnvio, string> = {
  en_curso: 'Enviando… (si no se confirma en 2 minutos, quedará sin confirmar)',
  sin_confirmar: 'Sin confirmar: revisa Enviados de info@',
  enviado: 'Enviado',
  fallido: 'Fallido',
};

/** El resultado de un envío, en palabras («Fallido» lleva su motivo). */
export function textoEstadoEnvio(e: Pick<EnvioAviso, 'estado' | 'error'>): string {
  return e.estado === 'fallido' && e.error ? `Fallido: ${e.error}` : TEXTO_ESTADO[e.estado];
}

/** El último envío de una tarjeta (cliente + tramo), o null. `envios` va del más reciente al más antiguo, como lo sirve la API. */
export function ultimoEnvioDe(envios: readonly EnvioAviso[], claveCliente: string, tramo: TramoAviso): EnvioAviso | null {
  return envios.find((e) => e.claveCliente === claveCliente && e.tramo === tramo) ?? null;
}

/** Cómo va el botón «Enviar correo» de una tarjeta: apagado, ocupado por un envío abierto, o listo. */
export function botonEnviar(c: EstadoCanal, ultimo: EnvioAviso | null): { activo: boolean; texto: string } {
  if (c.modo === 'apagado') return { activo: false, texto: 'Envío apagado' };
  if (ultimo?.estado === 'en_curso') return { activo: false, texto: 'Enviando…' };
  if (ultimo?.estado === 'sin_confirmar') return { activo: false, texto: 'Sin confirmar' };
  return { activo: true, texto: 'Enviar correo' };
}

/** El envío REAL que avisó a un equipo desde aquí (el más reciente), o null si se le avisó de otra forma (por teléfono, a mano). */
export function envioDeEquipo(envios: readonly EnvioAviso[], clave: string): EnvioAviso | null {
  return envios.find((e) => e.modo === 'real' && e.estado === 'enviado' && e.equipos.includes(clave)) ?? null;
}
```

- [ ] **Paso 4: verla pasar**

Run: `Push-Location apps/trazabilidad-mantenimientos; npx vitest run src/lib/envios.test.ts; Pop-Location`
Esperado: PASS.

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/src/lib/envios.ts apps/trazabilidad-mantenimientos/src/lib/envios.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): rótulo del interruptor y estado de los envíos en la app
EOF
```

## Tarea 3.2: El cliente HTTP

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/src/api.ts:3`, `:49-53`, `:132`

- [ ] **Paso 1: tres Edit** en `api.ts`:

(a) Línea 3: añadir `EnvioAviso, ` delante de `EquipoVista, ` y, al final de la misma lista, `, RespuestaEnvios, TramoAviso` detrás de `UsuarioRol` (verbatim: `… TipoServicioOpcion, UsuarioRol, RespuestaEnvios, TramoAviso } from './dominio';`).

(b) Sustituir el comentario de `guardarContacto`:

```typescript
  /**
   * Pone a mano el contacto de un cliente (`emails` vacío = quitarlo y volver al de Desk). Devuelve el inventario ya
   * actualizado. Sólo guarda a quién se le escribiría: la app no envía correos (el aviso automático es una simulación).
   */
```

por:

```typescript
  /**
   * Pone a mano el contacto de un cliente (`emails` vacío = quitarlo y volver al de Desk). Devuelve el inventario ya
   * actualizado. Sólo guarda a quién se le escribe: el correo lo manda, a mano, `enviarAviso`.
   */
```

(c) Sustituir `  registrarAvisos: (claves: string[], fecha: string) => request<{ actualizados: number }>('POST', '/avisos', { claves, fecha }),` por:

```typescript
  /** El modo del envío de avisos (apagado / prueba / real, y por qué) y los últimos envíos. */
  envios: () => request<RespuestaEnvios>('GET', '/avisos/envios'),
  /** Envía el aviso de una tarjeta (pide `avisos.write`): el servidor la vuelve a calcular y redacta él el correo. Devuelve su envío. */
  enviarAviso: (claveCliente: string, tramo: TramoAviso, equipos: string[]) => request<EnvioAviso>('POST', '/avisos/envios', { claveCliente, tramo, equipos }),
  /** Resuelve a mano un envío sin confirmar: `salio` = «Sí salió» (true) o «No salió» (false). */
  resolverEnvio: (id: number, salio: boolean) => request<EnvioAviso>('POST', `/avisos/envios/${id}/resolver`, { salio }),
```

(No se commitea aún: `Avisos.tsx` todavía llama a `api.registrarAvisos`; el commit va con la Tarea 3.4.)

## Tarea 3.3: Las tarjetas — `SimulacionAvisos.tsx` → `TarjetasAvisos.tsx`

**Ficheros:**
- Renombrar y reescribir: `apps/trazabilidad-mantenimientos/src/vistas/SimulacionAvisos.tsx` → `TarjetasAvisos.tsx`

- [ ] **Paso 1: renombrar (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git mv apps/trazabilidad-mantenimientos/src/vistas/SimulacionAvisos.tsx apps/trazabilidad-mantenimientos/src/vistas/TarjetasAvisos.tsx
```

- [ ] **Paso 2: reescribir el fichero** — leerlo con Read y escribir con Write este contenido completo (las partes que no cambian —`Tarjeta`, `Destinatarios`, `EditorContacto`— van letra a letra como estaban):

```tsx
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, Pencil } from 'lucide-react';
import { api, type Inventario } from '../api';
import { CONTACTO_MAX_EMAILS, ETIQUETA_TRAMO, planAvisos, type AvisoEquipo, type ContactoCliente, type CorreoSimulado, type Destinatario, type EnvioAviso, type EquipoVista, type TramoAviso } from '../dominio';
import { envioDeEquipo, textoEstadoEnvio, ultimoEnvioDe } from '../lib/envios';
import { correoAviso, etiquetaOrigen, fechaRelevante, resumenSimulacion, revisarEmails, textoParaCopiar } from '../lib/simulacion';
import { fmtFecha, fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, TONO, Tag } from '../ui';

/**
 * Las tarjetas de «Avisos a clientes»: qué aviso toca HOY a cada cliente (a 90,
 * 60 y 30 días del vencimiento y al vencer), a quién iría y con qué texto, y qué
 * equipos quedan fuera y por qué. El botón de cada tarjeta (`accion`) lo pone
 * Avisos.tsx, que es quien envía; aquí sólo se escribe el contacto puesto a
 * mano a un cliente (a quién se le escribe).
 */
interface Props {
  equipos: EquipoVista[];
  hoy: string;
  contactos: ContactoCliente[];
  /** Los últimos envíos (GET /avisos/envios), del más reciente al más antiguo. */
  envios: EnvioAviso[];
  onFicha: (clave: string) => void;
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
  /** El botón «Enviar correo» de una tarjeta con destinatario, o null si quien mira no puede enviar. */
  accion: (c: CorreoSimulado<EquipoVista>) => ReactNode;
}

const INPUT =
  'block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

/** Clases de la etiqueta de cada tramo: las mismas que el estado de ese tramo («vence en …» o «vencida»). */
const TONO_TRAMO: Record<TramoAviso, string> = { 90: TONO.VENCE_90.badge, 60: TONO.VENCE_60.badge, 30: TONO.VENCE_30.badge, vencida: TONO.VENCIDA.badge };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const idGrupo = (c: CorreoSimulado<EquipoVista>) => `${c.tramo}|${c.claveCliente}`;

export default function TarjetasAvisos({ equipos, hoy, contactos, envios, onFicha, onInventario, notificar, accion }: Props) {
  const plan = useMemo(() => planAvisos(equipos, hoy, contactos), [equipos, hoy, contactos]);
  const r = resumenSimulacion(plan);
  const manualDe = useMemo(() => new Map(contactos.map((c) => [c.clave, c])), [contactos]);
  /** El grupo cuyo editor de contacto está abierto. */
  const [editando, setEditando] = useState<string | null>(null);
  /** Poner o cambiar el contacto de un cliente pide su permiso: sin él no se ofrece. */
  const { puede, motivo } = usePermisos();
  const puedeContactos = puede('contactos.write');

  const editor = (c: CorreoSimulado<EquipoVista>, onCancel?: () => void) => (
    <EditorContacto
      cliente={c.cliente}
      actual={manualDe.get(c.claveCliente)}
      onCancel={onCancel}
      onGuardado={(inv, msg) => {
        onInventario(inv);
        setEditando(null);
        notificar(msg);
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-gray-700" aria-live="polite">
        <strong className="font-semibold text-gray-900">{plural(r.correos, 'aviso por enviar', 'avisos por enviar')}</strong> hoy ({fmtFecha(hoy)}) a {plural(r.clientes, 'cliente', 'clientes')} ·{' '}
        {plural(r.equipos, 'equipo', 'equipos')} · {plural(r.sinDestinatario, 'grupo', 'grupos')} sin destinatario
      </p>

      <section aria-labelledby="sim-correos" className="flex flex-col gap-3">
        <h3 id="sim-correos" className="text-base font-semibold text-gray-900">
          Por enviar hoy ({plan.correos.length})
        </h3>
        {plan.correos.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Hoy no toca enviar ningún aviso{plan.sinDestinatario.length > 0 ? ': los grupos a los que toca avisar no tienen destinatario (abajo).' : '.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {plan.correos.map((c) => {
              const id = idGrupo(c);
              return (
                <Tarjeta key={id} correo={c} onFicha={onFicha}>
                  <Destinatarios lista={c.destinatarios} />
                  <Vista correo={c} notificar={notificar} />
                  <UltimoEnvio envio={ultimoEnvioDe(envios, c.claveCliente, c.tramo)} />
                  <div className="flex flex-wrap items-center gap-2">
                    {accion(c)}
                    {puedeContactos && editando !== id && (
                      <Button variant="ghost" onClick={() => setEditando(id)}>
                        <Pencil className="h-4 w-4" aria-hidden /> Cambiar destinatario
                      </Button>
                    )}
                  </div>
                  {puedeContactos && editando === id && editor(c, () => setEditando(null))}
                </Tarjeta>
              );
            })}
          </div>
        )}
      </section>

      {plan.sinDestinatario.length > 0 && (
        <section aria-labelledby="sim-sin-destinatario" className="flex flex-col gap-3">
          <div>
            <h3 id="sim-sin-destinatario" className="text-base font-semibold text-gray-900">
              Sin destinatario ({plan.sinDestinatario.length})
            </h3>
            <p className="text-sm text-gray-500">
              A estos clientes les tocaría el aviso, pero ningún ticket de Desk de sus equipos trae un correo que sirva (los correos de Ambientalia no cuentan).{' '}
              {puedeContactos ? 'Ponles un contacto.' : `Falta ponerles un contacto. ${motivo}`}
            </p>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {plan.sinDestinatario.map((c) => (
              <Tarjeta key={idGrupo(c)} correo={c} onFicha={onFicha}>
                {puedeContactos && editor(c)}
              </Tarjeta>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col gap-2">
        <Informativo
          titulo="Ya avisados en este tramo"
          nota="Tienen un aviso registrado desde que entraron en su tramo (las vencidas, desde que vencieron): no se les repite hasta el siguiente."
          lista={plan.yaAvisados}
          onFicha={onFicha}
          detalle={(a) => {
            const e = envioDeEquipo(envios, a.equipo.clave);
            return e ? `enviado desde aquí por ${e.por}` : null;
          }}
        />
        <Informativo titulo="En servicio" nota="En un tramo, pero ya en Ambientalia o con un ticket abierto en Desk: no se les avisa." lista={plan.enServicio} onFicha={onFicha} />
        <Informativo titulo="Fuera de ciclo" nota="Vencidas hace más de un año: no se les avisa desde aquí." lista={plan.fueraCiclo} onFicha={onFicha} />
      </div>
    </div>
  );
}

/** La tarjeta de un grupo (cliente + tramo): cabecera, equipos y lo que se le cuelgue. */
function Tarjeta({ correo: c, onFicha, children }: { correo: CorreoSimulado<EquipoVista>; onFicha: (clave: string) => void; children: ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div>
        <h4 className="break-words text-base font-semibold text-gray-900">{c.cliente}</h4>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONO_TRAMO[c.tramo]}`}>{ETIQUETA_TRAMO[c.tramo]}</span>
          <Tag>{plural(c.equipos.length, 'equipo', 'equipos')}</Tag>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Equipos de {c.cliente}: {ETIQUETA_TRAMO[c.tramo]}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Serial</th>
              <th scope="col">Modelo</th>
              <th scope="col">Vence</th>
              <th scope="col">Días que quedan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {c.equipos.map(({ equipo: e, vence, diasParaVencer }) => (
              <tr key={e.clave}>
                <td className="py-1.5 pr-2">
                  <button type="button" onClick={() => onFicha(e.clave)} className="rounded font-mono text-[13px] text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                    {e.serial}
                  </button>
                </td>
                <td className="py-1.5 pr-2 text-gray-600">{e.modelo}</td>
                <td className="py-1.5 pr-2 tabular-nums text-gray-600">{fmtFecha(vence)}</td>
                <td className={`py-1.5 text-right font-semibold tabular-nums ${TONO[e.estado].text}`}>{diasParaVencer} d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {children}
    </article>
  );
}

function Destinatarios({ lista }: { lista: Destinatario[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Para</p>
      <ul className="flex flex-wrap gap-1.5">
        {lista.map((d) => (
          <li
            key={d.email}
            className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm"
            title={d.ticket === null ? 'Puesto a mano para este cliente' : `Contacto del ticket ${d.ticket} de Zoho Desk`}
          >
            <span className="break-all text-gray-900">
              {d.nombre && <span className="font-medium">{d.nombre} · </span>}
              {d.email}
            </span>
            <Tag tone={d.origen === 'manual' ? 'blue' : 'gray'}>{etiquetaOrigen(d.origen)}</Tag>
            {d.interno && <Tag tone="amber">interno</Tag>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Asunto y cuerpo del correo, plegados, con su botón de copiar: el mismo texto que redacta el servidor al enviar. */
function Vista({ correo, notificar }: { correo: CorreoSimulado<EquipoVista>; notificar: (m: string) => void }) {
  const c = useMemo(() => correoAviso(correo), [correo]);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoParaCopiar(c));
      notificar('Texto copiado');
    } catch {
      notificar('No se pudo copiar: selecciona el texto y usa Ctrl+C');
    }
  }
  return (
    <details className="rounded-xl border border-gray-200">
      <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-sm font-medium text-gray-700 hover:bg-gray-50">Ver asunto y texto</summary>
      <div className="flex flex-col gap-2 border-t border-gray-200 p-3">
        <p className="text-sm">
          <span className="text-gray-500">Asunto: </span>
          <span className="font-medium text-gray-900">{c.asunto}</span>
        </p>
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-sans text-sm text-gray-800">{c.cuerpo}</pre>
        <div>
          <Button onClick={() => void copiar()}>
            <Copy className="h-4 w-4" aria-hidden /> Copiar texto
          </Button>
        </div>
      </div>
    </details>
  );
}

/** El último envío de la tarjeta, si lo hay: en qué modo, cuándo, quién y cómo acabó. */
function UltimoEnvio({ envio }: { envio: EnvioAviso | null }) {
  if (!envio) return null;
  return (
    <p className="text-xs text-gray-600">
      Último envío ({envio.modo}, {fmtFechaHora(envio.creadoEn)}, {envio.por}): {textoEstadoEnvio(envio)}
    </p>
  );
}
```

…y a continuación, **sin cambiar una letra**, la función `EditorContacto` completa tal como estaba (desde su comentario `/**\n * Editor del contacto puesto a mano a un cliente:` hasta su llave de cierre), seguida de este `Informativo`:

```tsx
/** Una sección informativa plegada: por qué esos equipos no tienen tarjeta. */
function Informativo({
  titulo,
  nota,
  lista,
  onFicha,
  detalle,
}: {
  titulo: string;
  nota: string;
  lista: AvisoEquipo<EquipoVista>[];
  onFicha: (clave: string) => void;
  /** Un dato más por equipo (quién lo avisó desde aquí), o null. */
  detalle?: (a: AvisoEquipo<EquipoVista>) => string | null;
}) {
  return (
    <details className="rounded-2xl border border-gray-200 bg-white">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
        {titulo} <Tag>{lista.length}</Tag>
      </summary>
      <div className="border-t border-gray-200 px-4 py-3">
        <p className="mb-2 text-xs text-gray-500">{nota}</p>
        {lista.length === 0 ? (
          <p className="text-sm text-gray-500">Ninguno.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {lista.map((a) => {
              const d = detalle?.(a) ?? null;
              return (
                <li key={a.equipo.clave} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                  <span className="min-w-0 break-words text-gray-900">{a.equipo.cliente}</span>
                  <button type="button" onClick={() => onFicha(a.equipo.clave)} className="rounded font-mono text-[13px] text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                    {a.equipo.serial}
                  </button>
                  <span className="text-gray-500">{fechaRelevante(a)}</span>
                  {d && <span className="text-gray-500">· {d}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
```

(Se va el aviso ámbar «Simulación: no se envía ningún correo» y la palabra «simulación» de la pantalla; `Alert` sigue haciendo falta en `EditorContacto`.)

## Tarea 3.4: La pantalla única — `Avisos.tsx`

**Ficheros:**
- Reescribir: `apps/trazabilidad-mantenimientos/src/vistas/Avisos.tsx`

- [ ] **Paso 1: escribir el fichero** (Read y después Write con este contenido completo; desaparecen las vistas «Manual», el selector 30/60/90, «Redactar aviso» y `marcar()`):

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { api, type Inventario } from '../api';
import { ETIQUETA_TRAMO, correoDePrueba, correoReal, type ContactoCliente, type CorreoSimulado, type EnvioAviso, type EquipoVista, type EstadoCanal, type RespuestaEnvios } from '../dominio';
import { botonEnviar, rotuloModo, textoEstadoEnvio, ultimoEnvioDe } from '../lib/envios';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, Modal, Tag } from '../ui';
import TarjetasAvisos from './TarjetasAvisos';

interface Props {
  equipos: EquipoVista[];
  hoy: string;
  /** Los contactos puestos a mano a clientes (destinatarios de las tarjetas). */
  contactos: ContactoCliente[];
  onFicha: (clave: string) => void;
  onCambio: () => Promise<void>;
  /** Sustituye el inventario por el que devuelve el servidor al guardar un contacto. */
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
}

/** El canal cuando deja enviar: prueba o real. */
type CanalAbierto = Exclude<EstadoCanal, { modo: 'apagado' }>;

/**
 * «Avisos a clientes», una sola pantalla (2026-11-08): arriba, la posición del
 * interruptor de envío, que decide el servidor; en medio, una tarjeta por
 * cliente y tramo (TarjetasAvisos.tsx) con su «Enviar correo»; abajo, los
 * últimos envíos, con «Sí salió» / «No salió» para los que quedaron sin
 * confirmar. Al enviar, la pantalla sólo dice qué tarjeta y qué equipos vio:
 * el servidor la vuelve a calcular y redacta él el correo, con el mismo texto
 * que aquí se enseña (avisos-correo.ts), que no se edita.
 */
export default function Avisos({ equipos, hoy, contactos, onFicha, onCambio, onInventario, notificar }: Props) {
  const [envios, setEnvios] = useState<RespuestaEnvios | null>(null);
  const [errorEnvios, setErrorEnvios] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<CorreoSimulado<EquipoVista> | null>(null);
  /** Ver y copiar el aviso lo puede cualquiera; enviarlo y resolver un «sin confirmar» piden `avisos.write`. */
  const puedeEnviar = usePermisos().puede('avisos.write');

  const cargarEnvios = useCallback(async () => {
    try {
      setEnvios(await api.envios());
      setErrorEnvios(null);
    } catch (e) {
      setErrorEnvios((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void cargarEnvios();
  }, [cargarEnvios]);

  /** Tras enviar o resolver: el inventario (los avisados cambian de grupo) y los envíos. */
  const recargar = async () => {
    await Promise.all([onCambio(), cargarEnvios()]);
  };

  const canal = envios?.canal ?? null;
  const lista = envios?.envios ?? [];
  const rotulo = canal ? rotuloModo(canal) : null;

  return (
    <div className="flex flex-col gap-4">
      {rotulo && (
        <Alert tone={rotulo.tono} title={rotulo.titulo}>
          <p>{rotulo.texto}</p>
        </Alert>
      )}
      {errorEnvios && <Alert tone="red">No se pudo leer el estado del envío: {errorEnvios}</Alert>}
      <TarjetasAvisos
        equipos={equipos}
        hoy={hoy}
        contactos={contactos}
        envios={lista}
        onFicha={onFicha}
        onInventario={onInventario}
        notificar={notificar}
        accion={(c) => {
          if (!puedeEnviar) return null;
          const b = canal ? botonEnviar(canal, ultimoEnvioDe(lista, c.claveCliente, c.tramo)) : { activo: false, texto: 'Cargando…' };
          return (
            <Button variant="primary" disabled={!b.activo} onClick={() => setConfirmar(c)}>
              <Send className="h-4 w-4" aria-hidden /> {b.texto}
            </Button>
          );
        }}
      />
      <UltimosEnvios envios={lista} puedeResolver={puedeEnviar} onResuelto={recargar} notificar={notificar} />
      {confirmar && canal && canal.modo !== 'apagado' && (
        <Confirmar
          correo={confirmar}
          canal={canal}
          onClose={() => setConfirmar(null)}
          onResultado={async (e) => {
            await recargar();
            if (e.estado === 'fallido') return;
            setConfirmar(null);
            notificar(e.estado === 'enviado' ? `Aviso enviado a ${e.cliente}` : 'Sin confirmar: revisa Enviados de info@ en un par de minutos y resuélvelo en «Últimos envíos»');
          }}
        />
      )}
    </div>
  );
}

/** La confirmación: a quién sale, con qué asunto y con qué texto, tal como lo enviará el servidor. */
function Confirmar({ correo, canal, onClose, onResultado }: { correo: CorreoSimulado<EquipoVista>; canal: CanalAbierto; onClose: () => void; onResultado: (e: EnvioAviso) => Promise<void> }) {
  const real = useMemo(() => correoReal(correo), [correo]);
  const sale = canal.modo === 'prueba' ? correoDePrueba(real, canal.buzonPrueba) : real;
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const e = await api.enviarAviso(correo.claveCliente, correo.tramo, correo.equipos.map((a) => a.equipo.clave));
      if (e.estado === 'fallido') setError(`No salió: ${e.error ?? 'sin motivo'}. No se ha marcado nada; puedes volver a intentarlo.`);
      await onResultado(e);
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      title={`Enviar el aviso a ${correo.cliente}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="primary" busy={enviando} onClick={() => void enviar()}>
            <Send className="h-4 w-4" aria-hidden /> Enviar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {canal.modo === 'prueba' && (
          <Alert tone="blue" title="Modo prueba">
            <p>
              Sale sólo hacia {canal.buzonPrueba}, con «[PRUEBA]» en el asunto. Al cliente no le llega nada y ningún equipo queda marcado como avisado. En modo real iría a: {real.para.join(', ')}.
            </p>
          </Alert>
        )}
        <p>
          <span className="text-gray-500">Para: </span>
          <span className="break-all font-medium text-gray-900">{sale.para.join(', ')}</span>
        </p>
        <p>
          <span className="text-gray-500">Asunto: </span>
          <span className="font-medium text-gray-900">{sale.asunto}</span>
        </p>
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 font-sans text-sm text-gray-800">{sale.cuerpo}</pre>
        <p className="text-xs text-gray-500">
          {ETIQUETA_TRAMO[correo.tramo]} · {correo.equipos.length === 1 ? '1 equipo' : `${correo.equipos.length} equipos`}. El texto no se edita: es el que redacta el servidor al enviar.
        </p>
        {error && <Alert tone="red">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** «Últimos envíos», plegado: fecha, quién, cliente, grupo, modo y resultado; con «Sí salió» / «No salió» en los sin confirmar. */
function UltimosEnvios({ envios, puedeResolver, onResuelto, notificar }: { envios: EnvioAviso[]; puedeResolver: boolean; onResuelto: () => Promise<void>; notificar: (m: string) => void }) {
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolver(e: EnvioAviso, salio: boolean) {
    setOcupado(e.id);
    setError(null);
    try {
      await api.resolverEnvio(e.id, salio);
      await onResuelto();
      notificar(salio ? 'Apuntado como enviado' : 'Apuntado como no enviado: la tarjeta se puede volver a enviar');
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <details className="rounded-2xl border border-gray-200 bg-white">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50">
        Últimos envíos <Tag>{envios.length}</Tag>
      </summary>
      <div className="flex flex-col gap-2 border-t border-gray-200 px-4 py-3">
        {error && <Alert tone="red">{error}</Alert>}
        {envios.length === 0 ? (
          <p className="text-sm text-gray-500">Todavía no se ha enviado ninguno.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {envios.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="tabular-nums text-gray-500">{fmtFechaHora(e.creadoEn)}</span>
                <span className="text-gray-700">{e.por}</span>
                <span className="min-w-0 break-words font-medium text-gray-900">{e.cliente}</span>
                <span className="text-gray-600">{ETIQUETA_TRAMO[e.tramo]}</span>
                <Tag tone={e.modo === 'real' ? 'blue' : 'gray'}>{e.modo}</Tag>
                <span className={e.estado === 'enviado' ? 'text-emerald-700' : e.estado === 'fallido' ? 'text-red-700' : 'text-amber-800'}>{textoEstadoEnvio(e)}</span>
                {e.resueltoPor && (
                  <span className="text-xs text-gray-500">
                    resuelto por {e.resueltoPor} el {fmtFechaHora(e.resueltoEn)}
                  </span>
                )}
                {puedeResolver && e.estado === 'sin_confirmar' && (
                  <span className="flex gap-2">
                    <Button busy={ocupado === e.id} onClick={() => void resolver(e, true)}>
                      Sí salió
                    </Button>
                    <Button disabled={ocupado === e.id} onClick={() => void resolver(e, false)}>
                      No salió
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
```

- [ ] **Paso 2: compila y pasa**

Run: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; npm run build; Pop-Location`
Esperado: PASS, sin errores de tipos (`noUnusedLocals` incluido) y build correcto. Si `typecheck` se queja de `GrupoAviso`, `avisosPorCliente` o `mensajeAviso` sin usar: son exportaciones de `vistas.ts`, no locales; no se borran en este lote (ver «Decisiones», código muerto).

- [ ] **Paso 3: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/src/api.ts apps/trazabilidad-mantenimientos/src/vistas/Avisos.tsx apps/trazabilidad-mantenimientos/src/vistas/TarjetasAvisos.tsx
git commit -F - <<'EOF'
feat(trazabilidad): una sola pantalla de avisos con «Enviar correo»

Fuera la vista Manual, Redactar y Marcar. Cada tarjeta con destinatario
lleva «Enviar correo» (desactivado con el envío apagado), con confirmación
del texto que redacta el servidor; arriba, el rótulo del interruptor; abajo,
los últimos envíos con «Sí salió» / «No salió».
EOF
```

## Tarea 3.5: Textos de Roles y de la ficha

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/src/vistas/Roles.tsx:13`
- Modificar: `apps/trazabilidad-mantenimientos/src/vistas/FichaEquipo.tsx:169`

- [ ] **Paso 1: dos Edit**

`Roles.tsx:13`, sustituir `  COMERCIAL: 'Seguimiento de los equipos, avisos manuales (marcar como avisado), contacto de cada cliente para los avisos y exportar la F-ST-022 a Excel.',` por:

```typescript
  COMERCIAL: 'Seguimiento de los equipos, enviar el aviso a un cliente desde su tarjeta («Enviar correo») y resolver un envío sin confirmar, contacto de cada cliente para los avisos y exportar la F-ST-022 a Excel.',
```

`FichaEquipo.tsx:169`, sustituir el texto `Se cambia, para todos los equipos del cliente, en «Avisos a clientes» → «Simulación automática». Hoy no se envía ningún correo automático.` por `Se cambia, para todos los equipos del cliente, con «Cambiar destinatario» en su tarjeta de «Avisos a clientes». El aviso se envía desde esa tarjeta, a mano.`

- [ ] **Paso 2:** `Push-Location apps/trazabilidad-mantenimientos; npm run typecheck; Pop-Location` — sin errores.

- [ ] **Paso 3: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/src/vistas/Roles.tsx apps/trazabilidad-mantenimientos/src/vistas/FichaEquipo.tsx
git commit -F - <<'EOF'
feat(trazabilidad): textos de Roles y de la ficha para el envío de avisos
EOF
```

## Tarea 3.6: `apps/trazabilidad-mantenimientos/CLAUDE.md`

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/CLAUDE.md` (líneas 6-7, 77, 97-100, 143, 186, 234, 264-265, 270-271, 285, 317, 319-366 y la sección «Pruebas»)

- [ ] **Paso 1: Edit uno a uno**

(a) Líneas 6-7, sustituir:

```markdown
⚠️ **Hoy el aviso automático es una SIMULACIÓN: nada en esta app ni en su API envía correos**
(ver «Aviso automático: simulación»). Los avisos se siguen copiando y enviando a mano.
```

por:

```markdown
⚠️ **Los avisos a clientes se envían A MANO, tarjeta a tarjeta, con «Enviar correo»**, y sólo si el
interruptor de hub-api lo deja (`TMC_AVISOS_ENVIO`: *apagado* por defecto, *prueba* —todo al buzón
interno— o *real*; ver «Avisos a clientes: plan y envío»). No hay envío automático: ningún reloj,
pasada ni arranque envía nada.
```

(b) Línea 77, sustituir `` `063_trazabilidad_vigencia_marcas.sql`, `064_trazabilidad_contratos.sql` | `` por `` `063_trazabilidad_vigencia_marcas.sql`, `064_trazabilidad_contratos.sql`, `069_trazabilidad_avisos_envios.sql` | ``

(c) Sustituir las cuatro filas 97-100:

```markdown
| Agregados, calendario y texto del aviso (`mensajeAviso`, también el de cada tramo) | `src/lib/vistas.ts` |
| Plan del aviso automático (`planAvisos`, `evaluarAviso`), contactos (`contactoDeTickets`, `contactoEfectivo`) y correos (`esEmail`, `esEmailInterno`, `DOMINIOS_INTERNOS`) | `apps/hub-api/src/trazabilidad/dominio.ts` (puro, compartido) |
| Asunto y cuerpo del correo simulado, resumen y revisión de los correos tecleados | `src/lib/simulacion.ts` |
| Sub-vista «Simulación automática» de «Avisos a clientes» | `src/vistas/SimulacionAvisos.tsx` (el selector Manual / Simulación está en `src/vistas/Avisos.tsx`) |
```

por:

```markdown
| Agregados y calendario; el texto del aviso (`mensajeAviso`, `marcaAviso`, `todosGrimm`) sólo se reexporta desde hub-api | `src/lib/vistas.ts` |
| Plan de los avisos (`planAvisos`, `evaluarAviso`; cuatro tramos, `TRAMOS_AVISO`: 90, 60, 30 y `'vencida'`), contactos (`contactoDeTickets`, `contactoEfectivo`) y correos (`esEmail`, `esEmailInterno`, `DOMINIOS_INTERNOS`) | `apps/hub-api/src/trazabilidad/dominio.ts` (puro, compartido) |
| El correo del aviso: texto por tramo (`correoAviso`, `mensajeAviso`, `saludoAviso`, `ETIQUETA_TRAMO`), lo que sale (`correoReal`) y su versión de prueba (`correoDePrueba`, `esBuzonDePrueba`), y la forma de los envíos (`EstadoCanal`, `CanalAvisos`, `EnvioAviso`, `estadoPresentado`, `mismaHuella`) | `apps/hub-api/src/trazabilidad/avisos-correo.ts` (puro, compartido: el servidor redacta con él lo que sale y la app enseña lo mismo) |
| El canal de salida: el interruptor (`modoEfectivo`) y la entrega a n8n (`crearCanalAvisos`, `ESPERA_MAX_MS`, `CABECERA_TOKEN`); **la única pieza de `src/trazabilidad` que llama a la red** | `apps/hub-api/src/trazabilidad/envio-avisos.ts` |
| «Enviar correo»: el flujo del envío y el SQL de su registro (`enviarAviso`, `resolverEnvio`, `leerEnvios`; **único que escribe `tmc_avisos_envios`**) | `apps/hub-api/src/trazabilidad/avisos-envios-repo.ts`; sus validadores (`parsePedidoEnvio`, `parseResolucion`) en `types.ts` |
| Resumen de las tarjetas, texto para copiar, revisión de los correos tecleados y la fecha de los informativos | `src/lib/simulacion.ts` |
| Lo que la pantalla dice del envío: rótulo del interruptor (`rotuloModo`), estado de cada envío (`textoEstadoEnvio`), botón de cada tarjeta (`botonEnviar`, `ultimoEnvioDe`) y quién avisó (`envioDeEquipo`) | `src/lib/envios.ts` |
| Pantalla «Avisos a clientes»: rótulo, confirmación y últimos envíos (`src/vistas/Avisos.tsx`); tarjetas, «sin destinatario» e informativos (`src/vistas/TarjetasAvisos.tsx`) | `src/vistas/Avisos.tsx`, `src/vistas/TarjetasAvisos.tsx` |
```

(d) Línea 143 (fila de `portal.tmc_contactos`), sustituir `**Sólo guarda direcciones**: no hay tabla de mensajes, de envíos ni de pendientes en este módulo (`trazabilidad.db.test.ts` vigila la lista de tablas `tmc_*`) |` por `**Sólo guarda direcciones**; lo que se envía se apunta en `tmc_avisos_envios` (`trazabilidad.db.test.ts` vigila la lista de tablas `tmc_*`) |` y añadir debajo de esa fila:

```markdown
| `portal.tmc_avisos_envios` | **Un apunte por cada «Enviar correo»** (069): `creado_en`, `dia` (el día de Colombia del envío: el que se pone como «Aviso enviado al cliente»), la firma (`por_id`, `por`), `modo` (`CHECK` a `prueba` / `real`: apagado no deja fila), `clave_cliente` + `cliente`, `tramo` (`CHECK` a `'90'` / `'60'` / `'30'` / `'vencida'`), `equipos` (las claves de la tarjeta), `destinatarios` (los de verdad), `enviado_a` (a quién se mandó: en prueba, sólo el buzón de prueba), `asunto` (**no guarda el texto**), `estado` (`CHECK` a `en_curso` / `enviado` / `fallido`), `message_id` (el de Gmail), `error`, `terminado_en` y la resolución a mano (`resuelto_por_id`, `resuelto_por`, `resuelto_en`). Índice único parcial `tmc_avisos_envios_en_curso_uq (clave_cliente, tramo) WHERE estado = 'en_curso'` = **un solo envío abierto por tarjeta** (doble clic o dos personas → 409). Tres `CHECK` con nombre (`…_terminado`, `…_enviado`, `…_resuelto`). Sin semilla ni clave foránea; da sus permisos a `portal_app` ella misma (la 068 corre antes). Sólo la escribe `avisos-envios-repo.ts`. **Es un registro, no una cola**: nada la lee para enviar. Se llama «registro» y no «envíos» porque los candados de `calibraciones.db.test.ts` y `edicion.db.test.ts` prohíben tablas `tmc*` con «envio» |
```

(e) Línea 186, sustituir la fila de marcar en bloque:

```markdown
| POST | `/trazabilidad/avisos` | `{claves[], fecha}`: marca el aviso en bloque sin tocar el resto del seguimiento |
```

por:

```markdown
| GET | `/trazabilidad/avisos/envios` | `{canal: {modo, motivo, buzonPrueba}, envios[]}`: el modo efectivo del envío (`apagado` / `prueba` / `real`; `motivo` = por qué está apagado sin pedirlo: `sin_valor`, `valor_desconocido`, `sin_canal`, `sin_buzon_prueba`) y los 30 últimos envíos más los que sigan en curso (`EnvioAviso`: `{id, creadoEn, por, modo, claveCliente, cliente, tramo, equipos, destinatarios, enviadoA, asunto, estado, messageId, error, resueltoPor, resueltoEn}`; `estado` = `en_curso`, `sin_confirmar` —un «en curso» de 2 minutos o más—, `enviado` o `fallido`). Abierta a quien tiene la app |
| POST | `/trazabilidad/avisos/envios` | Permiso `avisos.write`. `{claveCliente, tramo, equipos[]}`: la tarjeta (`tramo` = 90, 60, 30 o `'vencida'`) y las claves de los equipos que se vieron en ella. El servidor vuelve a calcular el plan con los datos de ese momento y redacta él el correo. 400 en `claveCliente`, `tramo` o `equipos`; **409 `envio_apagado`** sin consultar nada; **404 `tarjeta_no_encontrada`** si ya no hay esa tarjeta; **409 `tarjeta_cambiada`** si sus equipos no son los vistos; **409 `ya_enviando`** si ya hay uno abierto de esa tarjeta. Devuelve su `EnvioAviso`: `enviado` (en real, sus equipos quedan con «Aviso enviado al cliente» = hoy, en la misma transacción), `fallido` (con `error`) o `sin_confirmar` |
| POST | `/trazabilidad/avisos/envios/:id/resolver` | Permiso `avisos.write`. `{salio}`: resuelve a mano un envío sin confirmar —`true` = «Sí salió» (pasa a `enviado` y, si era real, marca sus equipos con el día del envío), `false` = «No salió» (`fallido`: la tarjeta se puede volver a enviar)—, con firma. 400 en `id` o `salio`; 404 si no existe; **409 `no_sin_confirmar`** si ya está resuelto o lleva menos de 2 minutos en curso |
| POST | `/trazabilidad/avisos` | **Retirada** con la vista «Manual»: **410 `marcar_retirado`** para cualquiera, sin validar ni mirar la base (`retirada`) |
```

(f) Línea 234, sustituir:

```markdown
| `avisos.write` | — | sí | — | sí | `POST /trazabilidad/avisos` |
```

por:

```markdown
| `avisos.write` | — | sí | — | sí | `POST /trazabilidad/avisos/envios` (enviar el aviso de una tarjeta) y `POST /trazabilidad/avisos/envios/:id/resolver` (resolver un envío sin confirmar). Antes, marcar en bloque (retirado) |
```

(g) Líneas 264-265, sustituir (son dos líneas del fichero):

```markdown
`escritura`. La tercera forma es `retirada(ctx)`: una
ruta que ya no deja pasar a nadie (410); la prueba fija cuáles son (las dos subidas de la Excel).
```

por:

```markdown
`escritura`. La tercera forma es `retirada(ctx)`: una
ruta que ya no deja pasar a nadie (410); la prueba fija cuáles son (las dos subidas de la Excel y marcar avisos en bloque).
```

(h) Líneas 270-271, sustituir (dos líneas del fichero):

```markdown
ficha va desactivado y sin «Guardar»; en «Avisos a clientes» no sale «Marcar como avisado» (sí
«Redactar aviso» y copiar) ni, en la simulación, «Cambiar destinatario» ni el editor de contacto;
```

por:

```markdown
ficha va desactivado y sin «Guardar»; en «Avisos a clientes» no sale «Enviar correo» ni, en los
últimos envíos, «Sí salió» / «No salió» (sí ver y copiar el texto), ni «Cambiar destinatario» ni el editor de contacto;
```

(i) Línea 285, dentro de la fila «Clientes y calibraciones», sustituir:

```markdown
Avisos a clientes (`#avisos`, con sus vistas Manual / Simulación automática dentro)
```

por:

```markdown
Avisos a clientes (`#avisos`: una tarjeta por cliente y tramo, con «Enviar correo»)
```

(j) Línea 317, sustituir `y ticket); se cambia en «Avisos a clientes» → «Simulación automática».` por `y ticket); se cambia en «Avisos a clientes», con «Cambiar destinatario» en su tarjeta.`

(k) Sustituir la sección entera desde `## Aviso automático: simulación` hasta justo antes de `## Cruce con Zoho Desk (ticket abierto)` por:

```markdown
## Avisos a clientes: plan y envío

**El envío es siempre a mano** (decisión de Alfonso, 2026-11-08; diseño en
`docs/superpowers/specs/2026-11-08-envio-avisos-clientes-design.md`): una persona pulsa «Enviar
correo» en una tarjeta. No hay envío automático: ningún reloj, pasada nocturna ni arranque llama
al envío; sólo la ruta POST del botón (`envio-avisos.test.ts` lo vigila).

La regla (`evaluarAviso` y `planAvisos`, `dominio.ts`; puras, con `hoy` como argumento):

- **Cuatro tramos** (`TRAMOS_AVISO`): 90, 60 y 30 días antes del vencimiento (`VENCE_90`,
  `VENCE_60`, `VENCE_30`) y **«vencida»** (`VENCIDA`: vencida hace menos de un año). `AL_DIA`,
  `SIN_FECHA` y `SIN_VENCIMIENTO` no están en ninguno (`SIN_TRAMO`); `FUERA_CICLO` (más de un año)
  sigue fuera.
- **Con la vigencia de su marca** (lote 11): el estado se recalcula con `equipo.vigenciaMarca` (la
  manda `GET /equipos`). Un equipo **sin vencimiento** (`SIN_VENCIMIENTO`) es `SIN_TRAMO` y **no entra
  en ninguna lista** del plan, tenga la fecha que tenga (`avisos.test.ts`, `simulacion.test.ts`,
  `marcas.db.test.ts`).
- **Una vez por tramo**: se entra en un tramo el día `vence − tramo` y en «vencida» el mismo día del
  vencimiento (`entradaTramo`). Si el «aviso enviado» del seguimiento (`tmc_seguimiento.aviso_enviado`)
  es de ese día o posterior, ya está avisado (`YA_AVISADO`); si es anterior —fue el del tramo de
  antes— o no hay, **toca** (`DEBIDO`). En «vencida», por tanto, **una sola vez por vencimiento**.
- **Nunca en servicio** (`enServicio`: «en Ambientalia» a mano o ticket abierto en Desk) →
  `EN_SERVICIO`, que manda sobre «ya avisado».
- **Una tarjeta por cliente y tramo** (agrupa por `claveCliente`), lo más urgente primero (vencida,
  30, 60, 90). **Destinatarios**: los correos puestos a mano al cliente si los tiene; si no, los
  distintos de los contactos de Desk de esos equipos. Sin ninguno → «sin destinatario» (sin botón).
- **Marca en el texto** (lote 9f): cada línea lleva la marca del equipo (`marcaAviso`: «GRIMM»
  para los GRIMM; la suya para los demás) y, si no son todos GRIMM, el aviso habla de «equipos» en
  vez de «monitores de partículas GRIMM» (también el asunto).
- **Texto** (`correoAviso`, `avisos-correo.ts`, sobre `mensajeAviso`): un asunto y una frase de
  entrada por tramo (90 = primer aviso «con antelación», 60 = recordatorio, 30 = «último aviso»,
  vencida = «está vencida», con su propio párrafo final). Saluda por su nombre si entre los
  destinatarios hay exactamente uno con nombre; si no, «Estimado cliente …». **El mismo código
  redacta en el servidor (lo que sale) y en la pantalla (lo que se ve).**

El envío:

- **El interruptor** (variables de entorno de hub-api; se cambian sólo en EasyPanel, el portal no
  puede): `TMC_AVISOS_ENVIO` = `apagado` (por defecto) · `prueba` · `real`, exactamente así
  (cualquier otro valor, o ninguno, es apagado); `TMC_AVISOS_BUZON_PRUEBA` (en prueba, todo va ahí;
  si falta o no es `@ambientalia.com.co`, prueba es apagado); `TMC_AVISOS_N8N_URL` y
  `TMC_AVISOS_N8N_TOKEN` (el Webhook de n8n y su token; si falta alguno, apagado). Se leen una vez,
  al arrancar: cambiar el modo es cambiar la variable y desplegar. `GET /trazabilidad/avisos/envios`
  sirve el modo efectivo y por qué, para el rótulo de la pantalla.
- **Al pulsar «Enviar»** la pantalla manda sólo la tarjeta (cliente, tramo y las claves de los
  equipos que vio). El servidor vuelve a calcular el plan con los datos del momento (el mismo
  `listarEquipos` + `listarContactos` que `GET /equipos`): sin esa tarjeta, 404; con otros equipos,
  409. Apunta el envío «en curso» (índice único: doble clic o dos personas → 409), lo entrega al
  canal con 30 s como mucho y lo cierra: confirmado → `enviado` (en real, en la misma transacción,
  `registrarAvisos` pone «Aviso enviado al cliente» = hoy a sus equipos y la tarjeta pasa a «Ya
  avisados»); rechazado → `fallido`, se ve el motivo y se puede reintentar; sin respuesta, o si esa
  transacción falla → sigue «en curso» y la pantalla dice **«sin confirmar»**.
- **«Sin confirmar»** = un «en curso» que ya no espera respuesta (de 2 minutos o más; también si el
  servidor se reinició a mitad). No deja reenviar la tarjeta. En «Últimos envíos» se resuelve a
  mano, mirando Enviados de info@: «Sí salió» (enviado y, en real, marca los equipos con el día del
  envío) o «No salió» (fallido: la tarjeta vuelve a poder enviarse).
- **En prueba**: el único destinatario es el buzón de prueba (lo reescribe el servidor y lo vuelve a
  comprobar el canal), el asunto empieza por «[PRUEBA] » y el cuerpo dice a quién habría ido; no se
  marca ningún equipo. El registro guarda los destinatarios de verdad y a quién se mandó.
- **Tres candados independientes**: el interruptor, que falla cerrado; el modo prueba, que reescribe
  los destinatarios en el servidor; y **la barrera de n8n**, que rechaza cualquier destinatario que
  no sea `@ambientalia.com.co`. Quitarla es un paso aparte de la fase 5 del plan de pruebas, con la
  decisión explícita de Alfonso y los secretos ya rotados.
- **n8n** («Trazabilidad — avisos a clientes (envío)»): Webhook con token (Header Auth, cabecera
  `X-Tmc-Avisos-Token`) → barrera de dominio → Gmail con la cuenta de info@ (credencial puesta a
  mano) → responde `{ok: true, messageId}` o `{ok: false, error}`. Ver `docs/n8n-automatizaciones.md`.
- **Por teléfono** sigue valiendo: la fecha «Aviso enviado al cliente» se pone a mano en la ficha del
  equipo (`seguimiento.write`).
- Los candados de siempre («nada de esto envía» en `router.ts`, `repo.ts`, `dominio.ts`, `types.ts` y
  demás módulos) siguen intactos: el envío vive en `envio-avisos.ts`, que es lo único que nombra n8n.

En la UI, «Avisos a clientes» es una sola pantalla: arriba el rótulo del interruptor (apagado, prueba
con su buzón, o real); el resumen; una tarjeta por correo (cliente, tramo, destinatarios con su origen
y la marca «interno», equipos, asunto y texto plegados con «Copiar texto», el último envío de la
tarjeta, «Cambiar destinatario» y **«Enviar correo»** —desactivado y con el rótulo «Envío apagado» con
el interruptor apagado; «Enviando…» o «Sin confirmar» mientras haya un envío abierto—, que abre una
confirmación con destinatarios, asunto y texto completo, sin editar); los grupos «Sin destinatario»
con el editor del contacto; los informativos plegados («Ya avisados en este tramo», con quién lo
envió si salió desde aquí; «En servicio»; «Fuera de ciclo»); y, al final, **«Últimos envíos»**
plegados (fecha, quién, cliente, grupo, modo y resultado) con «Sí salió» / «No salió» en los sin
confirmar.

```

(l) En «Pruebas», justo antes de la línea `- Datos de prueba siempre ficticios (el repo es público): «Cliente Uno», seriales \`18A00001\`,`, añadir:

```markdown
- Envío de los avisos (2026-11-08): `avisos.test.ts` (el tramo «vencida»: una vez por vencimiento, en servicio
  fuera, por delante del de 30), `avisos-correo.test.ts` (el texto de «vencida» letra a letra, la versión de prueba
  —sólo al buzón, «[PRUEBA]», a quién habría ido—, `mismaHuella`, `estadoPresentado` y el candado de que es puro),
  `envio-avisos.test.ts` (las guardas de la 069, el interruptor que falla cerrado, la entrega con una red de mentira
  —confirmado, rechazado, sin respuesta, sin conexión— y los **candados**: único fuente que llama a la red y lee
  `TMC_AVISOS_*`, sin relojes, sólo lo importa `router.ts`, sólo la ruta del botón llama a `enviarAviso`),
  `router.test.ts` (la guarda de escrituras **de 25 a 26**, la tercera ruta retirada, apagado sin consultar, cada
  400), `avisos-envios.db.test.ts` (contra Postgres con un canal de mentira: prueba sin marcar nada, real marcando en
  la misma transacción, «vencida», 404/409 de la tarjeta, el doble envío, fallido y reintento, sin confirmar y su
  resolución, la transacción final que falla, la 069 repetida), `trazabilidad.db.test.ts` (suma
  `tmc_avisos_envios` a la lista `tmc_*`) y, en la app, `src/lib/envios.test.ts` (rótulo, estados, botón y quién
  avisó). Sin pruebas de componente: la pantalla se revisa en el navegador.
```

(m) Línea 1942 (sección del lote 12), sustituir `y se cambia en «Avisos a clientes» → «Simulación automática».` por `y se cambia en «Avisos a clientes», con «Cambiar destinatario» en su tarjeta.`

- [ ] **Paso 2: comprobar** — `Grep` en `apps/trazabilidad-mantenimientos/CLAUDE.md` del patrón `Simulación automática|vencidasSinAviso|SimulacionAvisos|Vencidas sin aviso|vista «Manual»` → **ninguna coincidencia** (hoy salen en las líneas 100, 285, 317, 345, 361, 366 y 1942, todas tocadas arriba). Las frases «Sigue sin enviarse nada» de las secciones de lotes antiguos se dejan: son la historia de esos lotes.

- [ ] **Paso 3: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/CLAUDE.md
git commit -F - <<'EOF'
docs(trazabilidad): el envío manual de avisos y su interruptor en el CLAUDE.md
EOF
```

## Tarea 3.7: `docs/PRIVACY-RETENTION.md` — la tabla nueva en el inventario

**Ficheros:**
- Modificar: `docs/PRIVACY-RETENTION.md` (§2)

- [ ] **Paso 1: dos Edit**

(a) Sustituir `**No** se expone email, teléfono ni cédula por ninguna query del hub.` por `**No** se expone email, teléfono ni cédula por ninguna query del hub, salvo los correos de los contactos de clientes de Trazabilidad Mantenimientos (§2.2).`

(b) Justo antes de `## 3. Arquitectura del dato (clave para retención/borrado)`, añadir:

```markdown
### 2.2 Registro de los avisos a clientes (Trazabilidad Mantenimientos)

`portal.tmc_avisos_envios` (migración 069) guarda una fila por cada aviso de calibración que una
persona envía desde «Avisos a clientes»: cuándo y quién (correo del usuario interno), el modo
(prueba o real), el cliente (su nombre y su clave normalizada), el tramo, las claves de los equipos,
**los correos de los destinatarios del cliente** (los del contacto puesto a mano en la app o los de
los tickets de Zoho Desk), a quién se mandó de verdad (en prueba, sólo el buzón interno), el asunto,
el resultado (el identificador del mensaje de Gmail o el motivo del fallo) y, si hizo falta, quién lo
resolvió a mano. **No guarda el cuerpo del correo.**

- **Finalidad y base legal:** avisar al cliente del vencimiento de la calibración de su equipo
  (ejecución de la relación comercial y de servicio técnico) y dejar constancia de qué se le avisó,
  cuándo y quién.
- **Acceso:** sólo quien tiene la app `trazabilidad-mantenimientos` (`requireApp` en el servidor),
  igual que los contactos que ya enseña `GET /trazabilidad/equipos`.
- **No es la fuente de los contactos:** los correos se copian del contacto vigente al enviar.
  Rectificar o suprimir un contacto se hace donde nace (Zoho Desk o el contacto puesto a mano en la
  app); las filas ya apuntadas conservan el correo al que se envió.
- **También en n8n:** el flujo que envía guarda en sus ejecuciones los destinatarios, el asunto y el
  cuerpo, con la retención de ejecuciones que tenga configurada n8n.
- **Retención** `[Definir]`: fijar cuánto se conservan estas filas (p. ej. el mismo plazo que los
  soportes del servicio técnico) y si se anonimizan después.

```

- [ ] **Paso 2: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add docs/PRIVACY-RETENTION.md
git commit -F - <<'EOF'
docs(privacy): registro de avisos a clientes en el inventario de datos
EOF
```

## Tarea 3.8: Verificación del lote 3, merge y push

- [ ] **Paso 1: todo en verde**

Run: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; npm run build; Pop-Location` — PASS.
Run: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/envio-avisos.test.ts; Pop-Location` — PASS (el candado «la app no importa envio-avisos» mira la app).

- [ ] **Paso 2: tamaño (Bash)** — `git diff --shortstat -M main...HEAD` < 800 (previsión: ~770; el renombrado cuenta sólo lo cambiado gracias a `-M`). Si pasa de 800, **no se mergea**: se para y se pregunta a Alfonso (mergear igual, o sacar los dos commits de documentación —Tareas 3.6 y 3.7— a una rama `docs/avisos-envio`, lo que exige reescribir esta rama y necesita su permiso).

- [ ] **Paso 3: merge y push (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main
git merge --no-ff feat/avisos-envio-pantalla -m "merge: pantalla única de avisos con Enviar correo"
git push origin main
```

- [ ] **Paso 4: avisar a Alfonso** — «Lotes 2 y 3 en main. Despliega **hub-api primero y después el portal**. Sin variables `TMC_AVISOS_*` el rótulo dirá “Envío apagado” y el botón, “Envío apagado”. Siguiente: el lote 4 (n8n y EasyPanel).»

---

# LOTE 4 — n8n y EasyPanel (operativo) y el plan de pruebas

Rama sólo para la documentación: `feat/avisos-envio-n8n`. El resto son pasos en n8n (por su MCP) y de Alfonso en EasyPanel y en su correo. **Nada de este lote saca un correo de Ambientalia hasta la fase 5, que no se ejecuta sin su decisión explícita.**

## Tarea 4.1: Preparar el MCP de n8n

- [ ] **Paso 1:** cargar las skills `n8n-mcp-skills:using-n8n-mcp-skills`, `n8n-mcp-skills:n8n-workflow-patterns`, `n8n-mcp-skills:n8n-error-handling`, `n8n-mcp-skills:n8n-code-javascript` y `n8n-mcp-skills:n8n-validation-expert` antes de llamar a ninguna herramienta `mcp__n8n-mcp__*`.
- [ ] **Paso 2:** `n8n_health_check` → instancia accesible. `n8n_list_workflows` → comprobar que no existe ya un flujo «Trazabilidad — avisos a clientes (envío)» (si existe, se actualiza ese en vez de crear otro).
- [ ] **Paso 3:** confirmar versiones con `get_node` (`nodes-base.webhook` 2.1, `nodes-base.code` 2, `nodes-base.if` 2.3, `nodes-base.gmail` 2.2, `nodes-base.respondToWebhook` 1.5, comprobadas el 2026-11-08). Si alguna cambió, usar la que diga `get_node` y revisar sus parámetros con `mode: 'search_properties'`.

## Tarea 4.2: Crear el flujo (inactivo, sin credenciales)

- [ ] **Paso 1: el código de la barrera** (valor de `jsCode` del nodo «Barrera de dominio»):

```javascript
// Barrera de dominio (candado 3 del envío de avisos de Trazabilidad): sólo pasa si TODOS los destinatarios son de
// @ambientalia.com.co y hay asunto y texto. Quitarla es un paso aparte y explícito de la fase 5 del plan de pruebas
// (decisión de Alfonso, con los secretos rotados).
const cuerpo = $input.first().json.body ?? {};
const para = Array.isArray(cuerpo.para) ? cuerpo.para.map((e) => String(e).trim().toLowerCase()) : [];
const asunto = typeof cuerpo.asunto === 'string' ? cuerpo.asunto : '';
const texto = typeof cuerpo.cuerpo === 'string' ? cuerpo.cuerpo : '';
const deAmbientalia = (e) => /^[^@\s]+@ambientalia\.com\.co$/.test(e);
const permitido = para.length > 0 && para.every(deAmbientalia) && asunto !== '' && texto !== '';
return [{ json: { permitido, para, asunto, cuerpo: texto, referencia: cuerpo.referencia ?? null } }];
```

- [ ] **Paso 2: `n8n_create_workflow`** con este flujo (el `jsCode` es el del paso 1, como cadena JSON):

```json
{
  "name": "Trazabilidad — avisos a clientes (envío)",
  "settings": { "executionOrder": "v1" },
  "nodes": [
    {
      "name": "Webhook avisos",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2.1,
      "position": [0, 0],
      "parameters": { "httpMethod": "POST", "path": "tmc-avisos-clientes", "authentication": "headerAuth", "responseMode": "responseNode", "options": {} }
    },
    {
      "name": "Barrera de dominio",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [240, 0],
      "parameters": { "jsCode": "<el código del paso 1>" }
    },
    {
      "name": "Todos de Ambientalia",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.3,
      "position": [480, 0],
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict", "version": 2 },
          "conditions": [{ "id": "permitido", "leftValue": "={{ $json.permitido }}", "rightValue": true, "operator": { "type": "boolean", "operation": "true", "singleValue": true } }],
          "combinator": "and"
        },
        "options": {}
      }
    },
    {
      "name": "Enviar con Gmail (info@)",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.2,
      "position": [720, -120],
      "onError": "continueErrorOutput",
      "parameters": {
        "resource": "message",
        "operation": "send",
        "sendTo": "={{ $json.para.join(', ') }}",
        "subject": "={{ $json.asunto }}",
        "emailType": "text",
        "message": "={{ $json.cuerpo }}",
        "options": { "appendAttribution": false }
      }
    },
    {
      "name": "Responder enviado",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.5,
      "position": [960, -200],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ ok: true, messageId: $json.id }) }}", "options": { "responseCode": 200 } }
    },
    {
      "name": "Responder fallo Gmail",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.5,
      "position": [960, -40],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ ok: false, error: 'Gmail no lo envió: ' + ($json.error && $json.error.message ? $json.error.message : 'error desconocido') }) }}", "options": { "responseCode": 502 } }
    },
    {
      "name": "Responder barrera",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.5,
      "position": [720, 120],
      "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ ok: false, error: 'Barrera de n8n: algún destinatario no es de @ambientalia.com.co (o falta el asunto o el texto). No ha salido nada.' }) }}", "options": { "responseCode": 422 } }
    }
  ],
  "connections": {
    "Webhook avisos": { "main": [[{ "node": "Barrera de dominio", "type": "main", "index": 0 }]] },
    "Barrera de dominio": { "main": [[{ "node": "Todos de Ambientalia", "type": "main", "index": 0 }]] },
    "Todos de Ambientalia": { "main": [[{ "node": "Enviar con Gmail (info@)", "type": "main", "index": 0 }], [{ "node": "Responder barrera", "type": "main", "index": 0 }]] },
    "Enviar con Gmail (info@)": { "main": [[{ "node": "Responder enviado", "type": "main", "index": 0 }], [{ "node": "Responder fallo Gmail", "type": "main", "index": 0 }]] }
  }
}
```

Apuntar el **id** que devuelva. El Gmail **no** reintenta (sin `retryOnFail`): si no contesta a tiempo, hub-api lo deja «sin confirmar» y lo resuelve una persona.

- [ ] **Paso 3: `n8n_validate_workflow`** con ese id. Los avisos de «falta credencial» en el Webhook y en el Gmail son esperables (las pone Alfonso). Cualquier otro error se corrige según `n8n-validation-expert` (y, si hace falta, `n8n_autofix_workflow`) y se vuelve a validar. **El flujo queda inactivo.**

## Tarea 4.3: Credenciales y activación (Alfonso, a mano)

- [ ] **Paso 1 (Alfonso, en su terminal; el token NO pasa por el chat):** generar el token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- [ ] **Paso 2 (Alfonso, en n8n):** crear una credencial **Header Auth** («Token avisos TMC») con *Name* `X-Tmc-Avisos-Token` y *Value* = el token; ponerla en el nodo «Webhook avisos». Crear (o reutilizar) la credencial **Gmail OAuth2 de info@ambientalia.com.co** y ponerla en «Enviar con Gmail (info@)». Guardar y **activar** el flujo.
- [ ] **Paso 3:** `n8n_get_workflow` → activo, con las dos credenciales puestas y los nodos sin cambios.

## Tarea 4.4: Fase 2 — prueba desde n8n, sin hub-api

- [ ] **Paso 1 (Alfonso, en su terminal PowerShell):** un correo al buzón de prueba (texto sin tildes, para no pelearse con la codificación de PowerShell 5.1):

```powershell
$t = Read-Host 'Token'
$u = 'https://<host de n8n>/webhook/tmc-avisos-clientes'
$b = @{ referencia = 0; para = @('<buzón de prueba>@ambientalia.com.co'); asunto = '[PRUEBA] Flujo de avisos de Trazabilidad'; cuerpo = 'Correo de prueba del flujo de n8n. No es un aviso a ningun cliente.' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $u -Headers @{ 'X-Tmc-Avisos-Token' = $t } -ContentType 'application/json; charset=utf-8' -Body $b
```

Esperado: `ok = True` y un `messageId`; el correo llega al buzón y está en Enviados de info@ (sin la firma de n8n).

- [ ] **Paso 2 (Alfonso): la barrera muerde** — repetir con `para = @('alguien@example.com')` dentro de `try { … } catch { $_.ErrorDetails.Message }`. Esperado: 422 con «Barrera de n8n: …»; en `n8n_executions` de ese flujo, el Gmail no se ejecutó. Repetir sin la cabecera del token → 403 de n8n.

## Tarea 4.5: Fase 1 — variables en EasyPanel, todo apagado

- [ ] **Paso 1 (Alfonso, EasyPanel → hub-api → Environment):** añadir `TMC_AVISOS_ENVIO=apagado`, `TMC_AVISOS_BUZON_PRUEBA=<buzón de prueba>@ambientalia.com.co`, `TMC_AVISOS_N8N_URL=https://<host de n8n>/webhook/tmc-avisos-clientes` y `TMC_AVISOS_N8N_TOKEN=<el token>`. Deploy (hub-api; ~11 min).
  ⚠️ EasyPanel imprime todas las variables en el log cuando un build **falla**: si eso pasa, el token queda expuesto y hay que **rotarlo** (n8n y EasyPanel) antes de seguir. Es el problema ya conocido de «rotar todos los secretos de hub-api».
- [ ] **Paso 2 (Alfonso, en el portal):** «Avisos a clientes» enseña el rótulo «Envío apagado — No sale ningún correo. El interruptor se cambia sólo en el servidor.», cada tarjeta con destinatario tiene «Envío apagado» desactivado, la confirmación no se abre, «Copiar texto» sigue, las tarjetas «Vencida» salen con su texto, «Últimos envíos» está vacío. Un Técnico o un Lector no ven el botón. Revisar también en el móvil.

## Tarea 4.6: Fase 3 — modo prueba en tarjetas reales

- [ ] **Paso 1 (Alfonso):** `TMC_AVISOS_ENVIO=prueba` → Deploy hub-api. El rótulo dice «Envío en prueba — Todo va sólo a …».
- [ ] **Paso 2 (Alfonso):** pulsar «Enviar correo» en dos o tres tarjetas reales (una «Vencida» si la hay): la confirmación enseña el buzón, «[PRUEBA]» y a quién iría; «Enviar» → «Aviso enviado a …»; «Últimos envíos» lo apunta como `prueba · Enviado`. Revisar el correo en ordenador y móvil, y en Enviados de info@.
- [ ] **Paso 3 (Alfonso, psql):** ningún equipo quedó marcado:

```sql
\c zoho-hub
SELECT id, creado_en, por, modo, cliente, tramo, estado, enviado_a, message_id FROM portal.tmc_avisos_envios ORDER BY id DESC LIMIT 10;
SELECT count(*) FROM portal.tmc_seguimiento WHERE aviso_enviado = CURRENT_DATE AND actualizado_en > now() - interval '2 hours';
```

Esperado: filas `modo = prueba`, `enviado_a` = sólo el buzón; el recuento, 0 (salvo marcas a mano de esas dos horas). Las tarjetas siguen en «Por enviar hoy».

## Tarea 4.7: Fase 4 — fallos

- [ ] **Paso 1: n8n parado** — desactivar el flujo (`n8n_update_partial_workflow` con la operación de desactivar, o Alfonso en la UI). Enviar una tarjeta → la confirmación dice «No salió: El servicio de correo respondió 404…», «Últimos envíos» la apunta `Fallido`, nada marcado. Reactivar el flujo.
- [ ] **Paso 2: doble clic** — dos pestañas con la misma tarjeta; «Enviar» en las dos casi a la vez → una sale y la otra dice «Este aviso ya se está enviando…»; llega un solo correo.
- [ ] **Paso 3: «sin confirmar» que sí salió** — guardar la versión del flujo (`n8n_workflow_versions`), insertar con `n8n_update_partial_workflow` un nodo **Wait** de 40 s entre «Todos de Ambientalia» (rama verdadera) y el Gmail. Enviar una tarjeta → a los 30 s, «Sin confirmar: revisa Enviados de info@…»; el botón de la tarjeta pasa a «Sin confirmar». A los 2 minutos, en «Últimos envíos» aparecen «Sí salió» / «No salió»; el correo está en Enviados → «Sí salió» → `Enviado`, resuelto por quien pulsó.
- [ ] **Paso 4: «sin confirmar» que no salió** — con el Wait aún puesto, conectar temporalmente su salida a «Responder barrera» en vez de al Gmail. Enviar → «Sin confirmar»; a los 2 minutos, no hay nada en Enviados → «No salió» → `Fallido`, y la tarjeta se puede volver a enviar.
- [ ] **Paso 5:** restaurar el flujo a la versión guardada (`n8n_workflow_versions`) y comprobar con `n8n_get_workflow` que vuelve a ser exactamente el de la Tarea 4.2 (sin Wait, con la barrera) y está activo.

## Tarea 4.8: Fase 5 — CERRADA hasta la decisión de Alfonso

No se ejecuta nada de esto sin que Alfonso lo diga de forma explícita **y** con estas condiciones cumplidas:

- [ ] Secretos de hub-api rotados (pendiente conocido) y EasyPanel sin imprimir variables en los logs (imagen desde GHCR, privada).
- [ ] Quitar la barrera de dominio de n8n (paso aparte, con su propia confirmación): sustituir `deAmbientalia` por una comprobación de forma de correo, validar y guardar versión.
- [ ] `TMC_AVISOS_ENVIO=real` → Deploy hub-api. Alfonso envía **una** tarjeta de un cliente de confianza y lo comprueba con él (correo recibido; en la app, la tarjeta pasa a «Ya avisados» con «enviado desde aquí por …»).
- [ ] Sólo después, el resto de personas con `avisos.write` empiezan a enviar.

## Tarea 4.9: Documentar el flujo — `docs/n8n-automatizaciones.md`

**Ficheros:**
- Modificar: `docs/n8n-automatizaciones.md` (§2, tras la subsección 2.2)

- [ ] **Paso 1: rama (Bash)** — `cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07" && git switch main && git pull --ff-only && git switch -c feat/avisos-envio-n8n`

- [ ] **Paso 2: Edit** — justo antes de `## 3. Checklist para una app nueva`, añadir (con el id real del flujo):

````markdown
### 2.3 La variante síncrona: hub-api llama a un Webhook y espera (avisos de Trazabilidad)

El envío de los avisos a clientes de Trazabilidad (2026-11-08) **no** sigue el patrón de arriba: no
hay cola ni sondeo, porque quien pulsa «Enviar correo» necesita saber al momento si salió (y la cola
con sondeo fue el mecanismo del incidente de los 700 correos de agosto de 2026).

| Workflow | Id | Forma |
|---|---|---|
| **Trazabilidad — avisos a clientes (envío)** | `<id del flujo>` | Webhook síncrono: un correo por llamada, con respuesta |

```
hub-api (POST, cabecera X-Tmc-Avisos-Token, espera 30 s como mucho)
      ▼
Webhook (Header Auth) ── token malo ──▶ 403 de n8n
      ▼
Code «Barrera de dominio»: ¿todos los destinatarios son @ambientalia.com.co?
      │ (no) ──▶ Respond 422 {ok: false, error}
      ▼ (sí)
Gmail (credencial de info@, puesta a mano; appendAttribution = false; sin reintentos)
      │ (error) ──▶ Respond 502 {ok: false, error}
      ▼
Respond 200 {ok: true, messageId}
```

- Lado hub-api: `apps/hub-api/src/trazabilidad/envio-avisos.ts`, la única pieza que llama a la red;
  variables `TMC_AVISOS_ENVIO`, `TMC_AVISOS_BUZON_PRUEBA`, `TMC_AVISOS_N8N_URL` y
  `TMC_AVISOS_N8N_TOKEN` (ver `apps/trazabilidad-mantenimientos/CLAUDE.md`).
- El token es el valor de la credencial **Header Auth** del Webhook y el mismo que
  `TMC_AVISOS_N8N_TOKEN` en EasyPanel. Propio de este flujo: no se reutiliza el de otra app.
- **La barrera de dominio es un candado**: mientras exista, nada sale fuera de Ambientalia aunque
  hub-api estuviera en modo real. Quitarla es la fase 5 del plan de pruebas del diseño
  (`docs/superpowers/specs/2026-11-08-envio-avisos-clientes-design.md`), con la decisión explícita
  de Alfonso y los secretos ya rotados.
- Si no contesta en 30 s, hub-api deja el envío «sin confirmar» y una persona lo resuelve mirando
  Enviados de info@: por eso el Gmail **no** reintenta por su cuenta.
````

- [ ] **Paso 3: commit, merge y push (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add docs/n8n-automatizaciones.md
git commit -F - <<'EOF'
docs(n8n): flujo síncrono de envío de avisos de Trazabilidad
EOF
git switch main
git merge --no-ff feat/avisos-envio-n8n -m "merge: documentación del flujo n8n de avisos"
git push origin main
```

---

## Cobertura del diseño

| Diseño | Tareas |
|---|---|
| §1 Una sola pantalla, sin «Manual», «Redactar», selector ni «Marcar» | 3.3, 3.4 |
| §1 Rótulo del interruptor (apagado / prueba con buzón / real) | 1.3 (tipos), 2.2, 2.3 (GET), 3.1, 3.4 |
| §1 Cuatro grupos por cliente | 1.2, 3.3 |
| §1 «Enviar correo», «Envío apagado», confirmación sin editar, pasa a «Ya avisados» con fecha y quién | 3.1, 3.3, 3.4 (+ 2.3 el marcado) |
| §1 Sin botón en «Sin destinatario»; informativos; últimos envíos con acciones | 3.3, 3.4 |
| §1 Teléfono: la ficha (`seguimiento.write`) | sin cambios (documentado en 3.6) |
| §1 Comercial y Director Técnico; texto en `roles.ts` y Roles | 2.3 (paso 7), 3.5 |
| §2 Grupo «Vencida», una vez por vencimiento, fuera de ciclo fuera, texto aprobado y variantes | 1.2 (D5) |
| §3 La pantalla manda sólo la tarjeta; el servidor redacta; 409 si cambió | 1.3 (`mismaHuella`), 2.3 (D3) |
| §3 «En curso» con índice único parcial; 409 «ya se está enviando» | 2.1, 2.3 |
| §3 30 s; enviado (+ `registrarAvisos` en real, misma transacción); fallido; sin confirmar; 2 minutos | 1.3, 2.2, 2.3 |
| §3 Nada se envía solo | 2.4 (candados) |
| §4 «Sí salió» / «No salió» | 2.3, 3.4 |
| §5 Interruptor que falla cerrado; buzón `@ambientalia.com.co`; sin URL/token = apagado; GET del modo | 2.2, 2.3 |
| §5 Prueba: sólo el buzón, «[PRUEBA]», a quién habría ido; el registro guarda los reales | 1.3, 2.2, 2.3 |
| §5 Barrera de n8n | 4.2, 4.4 |
| §5 Candados de código de hoy intactos; los de nombres de tabla pasan a «solo `tmc_avisos_envios`» (decisión de Alfonso); nuevos (único módulo de red, sin relojes, sólo router, modo desconocido, prueba) | 2.2, 2.4 (D1, D2) |
| §6 Módulo de envío propio; registro (migración); PRIVACY; rutas; retirar marcar; CLAUDE.md | 2.1–2.3 (D4, D6), 3.6, 3.7 |
| §7 Fases 1–5 | 4.5, 4.4, 4.6, 4.7, 4.8 |
| §9 Cuatro lotes < 800 líneas; hub-api antes que el portal | Lotes 1–4, pasos de tamaño y de aviso |
