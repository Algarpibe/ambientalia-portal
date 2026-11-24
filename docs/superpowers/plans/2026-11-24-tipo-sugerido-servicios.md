# Tipo de servicio sugerido en «Servicios» — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para ejecutar este plan tarea a tarea. Los pasos llevan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que un ticket de «Servicios» sin tipo de servicio, cuyo equipo del inventario entró con la calibración vencida o a 60 días o menos de vencer, enseñe junto al desplegable la sugerencia «Diagnóstico + Calibración» con un botón «Usar» que la pone a mano por la ruta de siempre.

**Arquitectura:** dos funciones puras nuevas en hub-api —`calibracionAlIngreso` (`calibraciones.ts`: la calibración que contaba el día de entrada) y `tipoSugerido` (`dominio.ts`: la regla, con `UMBRAL_SUGERENCIA_DIAS` y `CLAVE_TIPO_SUGERIDO`)— que `listarServicios` (`repo.ts`) aplica a cada ticket con el equipo activo del inventario de su serial (la lectura de siempre, `consultarEquipos`), sus calibraciones (`leerCalibraciones`) y las vigencias (`leerVigencias`), en paralelo con sus consultas de ahora. El resultado viaja en `ServicioVista.tipoSugerido`. La sub-app redacta la etiqueta con una función pura (`textoSugerencia`, `src/lib/servicios.ts`) y `TipoSelect` pinta etiqueta y botón; «Usar» llama al `onCambio` de siempre (`PUT /trazabilidad/servicios/:numero/tipo`). Sin ruta, migración ni tabla nuevas; nada se guarda.

**Tecnología:** TypeScript, Express + PostgreSQL (`@algarpibe/zoho-sync`) en hub-api, React 19 + Vite + Tailwind en la sub-app, Vitest (unitarias y `*.db.test.ts` con testcontainers).

**Diseño aprobado:** `docs/superpowers/specs/2026-11-24-tipo-sugerido-servicios-design.md` (léelo entero antes de empezar).

---

## Convenciones de ejecución (obligatorias)

- **Raíz del repo:** `C:\Users\algar\OneDrive\Documentos\Antigravity\Portal\antigravity-suite-R1.07` (en Git Bash: `/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07`). Todos los comandos parten de ahí.
- **Rama:** `feat/tipo-sugerido-servicios` (ya existe, sale de `main` y lleva el commit del diseño, `e16d2b2`). Se trabaja en ella; al final, `git merge --no-ff` en `main` y `git push origin main` (autorización permanente del usuario). Empujar NO despliega.
- **Ficheros:** se crean y se cambian SOLO con las herramientas Write / Edit. Nunca con `Set-Content`, `Out-File`, `sed`, `perl` ni redirecciones: PowerShell 5.1 destroza las tildes del fichero entero. En disco están en CRLF (`core.autocrlf=true`; en el índice, LF) y Edit lo respeta. Todos los «Sustituir» de este plan se comprobaron el 2026-11-24: cada texto aparece exactamente una vez en su fichero; si alguno no casa, lee ese tramo con Read y copia el texto de ahí.
- **Git:** con la herramienta **Bash (Git Bash)**, no con PowerShell. Mensajes con `git commit -F - <<'EOF' … EOF`. Conventional commits en español, **sin línea «Co-Authored-By» ni ninguna atribución**. Se añaden rutas explícitas: nunca `git add -A` ni `git add .`, nunca `git stash`. No se tocan `.gitignore`, `.atl/`, `apps/WO-sales/prompts/`, `img/` ni `openspec/` (ya están modificados o sin seguimiento, y son del usuario).
- **Tamaño:** el cambio entero, menos de 800 líneas cambiadas sin contar los documentos de diseño y plan: `git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'` (inserciones + borrados). La estimación de este plan es de unas 350.
- **Repo público:** datos ficticios siempre (`Cliente Uno`, `Cliente Horiba S.A.S.`, seriales `18A0007x` / `V3BW1WJE`, correos `@example.com`). Nunca abrir `apps/trazabilidad-mantenimientos/data/*.xlsx`, ni leer `.env*` ni secretos.
- **TDD estricto** en la lógica pura: prueba que falla, verla fallar, código mínimo, verla pasar, commit. El cambio de `listarServicios` también entra por su prueba de BD, que se ve fallar antes.
- **Pruebas de hub-api:** `Push-Location apps/hub-api; npx vitest run <fichero>; Pop-Location` (PowerShell). La suite entera es `npm test` desde `apps/hub-api` (unas 3136 pruebas). Las de BD (`*.db.test.ts`) necesitan Docker Desktop encendido (`docker desktop start`) y van con `npx vitest run --config vitest.db.config.ts <fichero>`. **Nunca lances vitest desde la raíz** (mete los `.db.test.ts` y salen unos 281 fallos falsos). Docker se para con `docker desktop stop`, nunca con `wsl --shutdown`.
- **Pruebas de la sub-app:** desde `apps/trazabilidad-mantenimientos`: `npm test`, `npm run typecheck` y `npm run build` (las pruebas son sólo de lógica pura en `src/lib`, entorno node: la pantalla no tiene pruebas automáticas).
- **Errores conocidos que no son de este trabajo:** `npx tsc -p tsconfig.json --noEmit` en hub-api da un error en `src/ausencias/service/barril.test.ts` (tipos de `micromatch`); no lo persigas. Bajo carga, la prueba 4.4 de usuarios de hub-api puede caer por tiempo: repítela sola antes de investigar.
- **Candados** (pruebas que leen el código fuente): sólo se pueden ampliar, nunca relajar. **Este plan no toca ninguno.** Si una tarea pareciera necesitarlo, se para y se pregunta a Alfonso (ver «Decisiones», D1).

## Decisiones tomadas en el plan

El código choca con el diseño en estos puntos. El plan sigue la opción marcada. **D1 la aceptó Alfonso el 2026-11-24**: los equipos retirados se quedan sin sugerencia y no se toca ningún candado.

| # | Choque | Opción del plan |
|---|---|---|
| D1 | El diseño elige el equipo de un serial «con el mismo orden que ya usa `CLIENTE_POR_SERIAL`» (inventario primero, luego el activo, luego la clave). Pero el **candado** `seguimiento.test.ts:94-100` fija que `CLIENTE_POR_SERIAL` sólo lee `clave, serial, cliente, activo, en_inventario` (no marca, ni `en_seguimiento`, ni `ultima_calibracion`), que sólo lo usa `listarServicios`, una vez, y con `SELECT e.cliente FROM ${CLIENTE_POR_SERIAL} e`; y `seguimiento.test.ts:84-92` fija en **cinco** las lecturas `${INVENTARIO} e` de `repo.ts` (y `:71-73`, que `repo.ts` nombre `portal.tmc_equipos` una sola vez). Sacar del mismo LATERAL la marca y la fecha, o añadir una lectura nueva del inventario, exigiría **cambiar un candado**. | **Sin tocar ningún candado:** `listarServicios` llama a **`consultarEquipos`**, la lectura de `INVENTARIO` que ya alimenta `GET /equipos` (activos del inventario, con la regla entera `EN_INVENTARIO`). Con el serial repetido, el de clave más baja. Da lo mismo que el diseño **salvo un caso**: un serial cuyo único equipo del inventario está **retirado** (`activo = false`) no recibe sugerencia (el diseño se la daría). Igualarlo obligaría a ampliar un candado de `seguimiento.test.ts` (p. ej. una sexta lectura de `INVENTARIO` sin filtro de `activo`, o más columnas en `CLIENTE_POR_SERIAL`): **decisión de Alfonso; el plan no lo hace.** |
| D2 | El diseño dice «quien no tiene el permiso (`bloqueado`) ve la etiqueta pero no el botón». En el código, `bloqueado` es `guardando !== null \|\| cargando \|\| !puedeTipo` (`Servicios.tsx:307`): también vale `true` mientras se guarda otro ticket o se recarga, y con él no se puede distinguir «sin permiso». | `TipoSelect` recibe una prop nueva, **`puede`** (`= puedeTipo`): sin ella no sale el botón; `bloqueado` sólo lo desactiva, igual que al desplegable. |
| D3 | El diseño no dice qué pasa con un ticket sin día de entrada (`ingreso` null: sin `fecha_creacion_ticket` ni `created_time`). | Sin día de entrada **no hay sugerencia** (no hay día de referencia). |
| D4 | «Con el serial repetido, el de clave más baja» se compara en JS (`<`), no con la intercalación de Postgres del `ORDER BY e.clave` de `CLIENTE_POR_SERIAL`. Sólo podría diferir con claves que mezclen mayúsculas o símbolos; las de hoy son seriales con sufijo «-2». | Se acepta: `String(a.clave) < String(b.clave)`. |
| D5 | «vence el» / «vencía el» se decide contra el **ingreso**, como dice el diseño, aunque esa fecha ya haya pasado hoy. | Tal cual el diseño. |
| D6 | `GET /trazabilidad/servicios` (y el `PUT` del tipo, que devuelve lo mismo) hace tres consultas más, en paralelo: `consultarEquipos` (con su LATERAL del ticket abierto de cada equipo), todas las calibraciones guardadas y las vigencias. | Lo admite el diseño («en una más, en paralelo con las actuales»). Son las mismas que ya hace `GET /equipos`. |

## Sitios que construyen un `ServicioVista`

Al añadir el campo obligatorio `tipoSugerido` hay que tocarlos todos (los demás sólo lo leen):

1. `apps/hub-api/src/trazabilidad/repo.ts` — el `return { … }` de `listarServicios` (líneas 485-502).
2. `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts` — el fixture `sv()` (líneas 45-75); `manual()`, `combinado` y `fin` se construyen sobre él.

`router.test.ts` no construye ninguno (su base de mentira devuelve listas vacías) y `seguimiento.db.test.ts` / `marcas.db.test.ts` comparan `GET /servicios` «antes / después» byte a byte: siguen valiendo porque la sugerencia sale del mismo estado en las dos lecturas (se comprueban en la Tarea 3).

## Mapa de ficheros

| Fichero | Tarea | Qué |
|---|---|---|
| `apps/hub-api/src/trazabilidad/calibraciones.ts` | 1 | `calibracionAlIngreso(filas, respaldo, ingreso)` |
| `apps/hub-api/src/trazabilidad/calibraciones.test.ts` | 1 | Sus casos |
| `apps/hub-api/src/trazabilidad/dominio.ts` | 2 | `CLAVE_TIPO_SUGERIDO`, `UMBRAL_SUGERENCIA_DIAS`, `TipoSugerido`, `tipoSugerido(...)` |
| `apps/hub-api/src/trazabilidad/dominio.test.ts` | 2 | Sus casos |
| `apps/hub-api/src/trazabilidad/types.ts` | 3 | `ServicioVista.tipoSugerido` |
| `apps/hub-api/src/trazabilidad/repo.ts` | 3 | `calibracionesPorEquipo` y `grupoDe` sacados de `listarEquipos`; `equipoPorSerial`; `listarServicios` calcula `tipoSugerido` |
| `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts` | 3 | Cuatro casos contra Postgres |
| `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts` | 3, 4 | `tipoSugerido: null` en `sv()` (3); casos de `textoSugerencia` (4) |
| `apps/trazabilidad-mantenimientos/src/lib/servicios.ts` | 4 | `textoSugerencia`, `TITULO_SUGERENCIA` |
| `apps/trazabilidad-mantenimientos/src/vistas/Servicios.tsx` | 5 | Etiqueta ámbar y botón «Usar» en `TipoSelect`; prop `puede` |
| `apps/trazabilidad-mantenimientos/CLAUDE.md` | 6 | Nota viva: API y sección nueva |

---

## Paso 0 — Guardar este plan en la rama

- [ ] **Paso 0.1: commit del plan (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch feat/tipo-sugerido-servicios
git status --short
git add docs/superpowers/plans/2026-11-24-tipo-sugerido-servicios.md
git commit -F - <<'EOF'
docs(trazabilidad): plan de implementación del tipo de servicio sugerido
EOF
```

Esperado: antes del commit, `git status --short` enseña lo de siempre (`M .gitignore`, `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`) más este plan; después, sólo lo de siempre.

---

## Tarea 1: La calibración que contaba el día de entrada — `calibracionAlIngreso`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/calibraciones.ts:62-65` (añadir detrás de `fechaEfectiva`)
- Prueba: `apps/hub-api/src/trazabilidad/calibraciones.test.ts:6-17` (import) y `:66-71` (añadir detrás)

La regla del diseño: con filas en `tmc_calibraciones` vale `calibracionQueCuenta(filas, ingreso)` (sólo vigentes con fecha ≤ ingreso); sin ninguna fila, ni anulada, el respaldo del inventario, pero sólo si no es posterior al ingreso. Es `fechaEfectiva` a ese día más el tope del respaldo. `calibraciones.ts` no gana imports (su candado, `calibraciones.test.ts:452`).

- [ ] **Paso 1: escribir la prueba que falla** — en `apps/hub-api/src/trazabilidad/calibraciones.test.ts`, dos Edit:

(a) Sustituir:

```typescript
  FECHA_MINIMA_CALIBRACION,
  calibracionQueCuenta,
  fechaEfectiva,
```

por:

```typescript
  FECHA_MINIMA_CALIBRACION,
  calibracionAlIngreso,
  calibracionQueCuenta,
  fechaEfectiva,
```

(b) Sustituir:

```typescript
    expect(fechaEfectiva([fila({ estado: 'anulada' })], '2025-02-02', HOY)).toBeNull();
  });
```

por:

```typescript
    expect(fechaEfectiva([fila({ estado: 'anulada' })], '2025-02-02', HOY)).toBeNull();
  });

  it('`calibracionAlIngreso` (tipo sugerido de «Servicios»): la que contaba el día de entrada; una posterior no cuenta, y el respaldo sólo si no es posterior', () => {
    const ingreso = '2026-10-01';
    // Calibrado durante el servicio (el 3 de octubre): el día de entrada contaba la de marzo del año anterior.
    expect(calibracionAlIngreso([fila({ fecha: '2025-03-12', origen: 'fst022' }), fila({ fecha: '2026-10-03', origen: 'manual' })], null, ingreso)).toBe('2025-03-12');
    // Con alguna fila manda la regla aunque ninguna cuente ese día: el respaldo no se mira.
    expect(calibracionAlIngreso([fila({ fecha: '2026-10-03', ticket: 7 })], '2025-03-12', ingreso)).toBeNull();
    // Sin ninguna fila, el respaldo del inventario, si no es posterior al ingreso.
    expect(calibracionAlIngreso([], '2025-03-12', ingreso)).toBe('2025-03-12');
    expect(calibracionAlIngreso([], ingreso, ingreso)).toBe(ingreso);
    expect(calibracionAlIngreso([], '2026-10-02', ingreso)).toBeNull();
    expect(calibracionAlIngreso([], null, ingreso)).toBeNull();
  });
```

- [ ] **Paso 2: ver que falla**

Ejecuta (PowerShell): `Push-Location apps/hub-api; npx vitest run src/trazabilidad/calibraciones.test.ts; Pop-Location`

Esperado: FAIL en la prueba nueva con `TypeError: calibracionAlIngreso is not a function` (y el resto en verde).

- [ ] **Paso 3: el código mínimo** — en `apps/hub-api/src/trazabilidad/calibraciones.ts`, sustituir:

```typescript
export function fechaEfectiva(filas: readonly FilaCalibracion[], respaldo: string | null, hoy: string): string | null {
  return filas.length === 0 ? respaldo : (calibracionQueCuenta(filas, hoy)?.fecha ?? null);
}
```

por:

```typescript
export function fechaEfectiva(filas: readonly FilaCalibracion[], respaldo: string | null, hoy: string): string | null {
  return filas.length === 0 ? respaldo : (calibracionQueCuenta(filas, hoy)?.fecha ?? null);
}

/**
 * La calibración que contaba el día en que entró un ticket (`ingreso`), para el tipo sugerido de «Servicios» (2026-11-24): la de
 * `fechaEfectiva` a ese día, y el respaldo del inventario sólo si no es posterior. Calibrar el equipo durante el servicio no la cambia.
 */
export function calibracionAlIngreso(filas: readonly FilaCalibracion[], respaldo: string | null, ingreso: string): string | null {
  const fecha = fechaEfectiva(filas, respaldo, ingreso);
  return fecha !== null && fecha <= ingreso ? fecha : null;
}
```

- [ ] **Paso 4: ver que pasa**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/calibraciones.test.ts; Pop-Location`

Esperado: PASS, todo el fichero en verde (también «la regla es pura: calibraciones.ts no importa más que el dominio»).

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/calibraciones.ts apps/hub-api/src/trazabilidad/calibraciones.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): la calibración que contaba el día de entrada de un ticket
EOF
```

---

## Tarea 2: La regla pura del tipo sugerido — `tipoSugerido`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/dominio.ts:276-281` (añadir detrás de `tipoEfectivo`)
- Prueba: `apps/hub-api/src/trazabilidad/dominio.test.ts:4-35` (import) y `:311` (añadir delante de `describe('pureza'…)`)

`dominio.ts` no puede importar nada (candado `dominio.test.ts:311-316`): usa `esFechaIso` y `estadoCalibracion`, que viven en el mismo fichero. La sub-app lo recibe sola por `export * from '../../hub-api/src/trazabilidad/dominio'`.

Cuentas de las fechas de las pruebas (GRIMM, 365 días; ingreso 2026-10-01): `2025-03-12` vence `2026-03-12` (vencida); `2024-06-01` vence `2025-06-01` (487 días vencida: `FUERA_CICLO`); `2025-11-30` vence `2026-11-30` (60 días justos); `2025-12-01` vence `2026-12-01` (61). Del ingreso `2025-12-01` al `2026-03-12` hay 101 días.

- [ ] **Paso 1: escribir la prueba que falla** — en `apps/hub-api/src/trazabilidad/dominio.test.ts`, cuatro Edit:

(a) Sustituir:

```typescript
  asuntoSinCodigo,
  claveEstadoDesk,
```

por:

```typescript
  asuntoSinCodigo,
  CLAVE_TIPO_SUGERIDO,
  claveEstadoDesk,
```

(b) Sustituir:

```typescript
  tipoEfectivo,
  TIPOS_COMPUESTOS,
```

por:

```typescript
  tipoEfectivo,
  tipoSugerido,
  TIPOS_COMPUESTOS,
```

(c) Sustituir:

```typescript
  veredictoTerminado,
} from './dominio.js';
```

por:

```typescript
  veredictoTerminado,
  UMBRAL_SUGERENCIA_DIAS,
} from './dominio.js';
```

(d) Sustituir:

```typescript
describe('pureza', () => {
```

por:

```typescript
// Tipo sugerido (diseño del 2026-11-24): a un ticket SIN tipo cuyo equipo entró con la calibración vencida o a 60 días o menos de
// vencer se le sugiere «Diagnóstico + Calibración». Nunca se aplica solo. La referencia es el día de entrada, no hoy.
describe('tipo sugerido por el vencimiento de la calibración', () => {
  const INGRESO = '2026-10-01';
  /** La fila del tipo en Configuración, como la da `cargarTipos` (con sus días, que la sugerencia no copia). */
  const SUGERIBLE = { clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración', dias: 7 };
  /** Un ticket sin tipo, entrado el 2026-10-01, cuyo GRIMM (365 días) se calibró el `ultima`. */
  const sugerir = (ultima: string | null, extra: Partial<Parameters<typeof tipoSugerido>[0]> = {}) =>
    tipoSugerido({ tipo: '', ultimaCalibracion: ultima, vigencia: 365, ingreso: INGRESO, sugerible: SUGERIBLE, ...extra });

  it('el tipo y el umbral, con nombre: el compuesto «Diagnóstico + Calibración» y 60 días', () => {
    expect(CLAVE_TIPO_SUGERIDO).toBe(claveTipoServicio('Diagnóstico + Calibración'));
    expect(partesDeTipo(CLAVE_TIPO_SUGERIDO)).toEqual(['diagnostico', 'calibracion']);
    expect(UMBRAL_SUGERENCIA_DIAS).toBe(60);
  });

  it('vencida el día de entrada: se sugiere, con la clave, la etiqueta de Configuración y el día en que venció (y nada más)', () => {
    expect(sugerir('2025-03-12')).toEqual({ clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración', vence: '2026-03-12' });
  });

  it('vencida hace más de un año (fuera de ciclo): también, sin límite hacia atrás', () => {
    expect(estadoCalibracion('2024-06-01', INGRESO, 365).estado).toBe('FUERA_CICLO');
    expect(sugerir('2024-06-01')).toMatchObject({ vence: '2025-06-01' });
  });

  it('a 60 días justos de vencer, sí; a 61, no', () => {
    expect(estadoCalibracion('2025-11-30', INGRESO, 365).vigenciaDias).toBe(60);
    expect(sugerir('2025-11-30')).toMatchObject({ vence: '2026-11-30' });
    expect(estadoCalibracion('2025-12-01', INGRESO, 365).vigenciaDias).toBe(61);
    expect(sugerir('2025-12-01')).toBeNull();
  });

  it('sin calibración conocida, o con una marca sin vencimiento (vigencia null), no', () => {
    expect(sugerir(null)).toBeNull();
    expect(sugerir('2025-03-12', { vigencia: null })).toBeNull();
  });

  it('un ticket con tipo —de Desk o puesto a mano— no recibe sugerencia', () => {
    expect(sugerir('2025-03-12', { tipo: tipoEfectivo(null, 'Diagnóstico').tipo })).toBeNull();
    expect(sugerir('2025-03-12', { tipo: tipoEfectivo('Calibración', '').tipo })).toBeNull();
  });

  it('sin la fila del tipo sugerido en Configuración, o sin día de entrada, no', () => {
    expect(sugerir('2025-03-12', { sugerible: null })).toBeNull();
    expect(sugerir('2025-03-12', { ingreso: null })).toBeNull();
  });

  it('cuenta el día de entrada, no hoy: la misma calibración, con un ingreso anterior, todavía no tocaba', () => {
    // Vence el 2026-03-12: entrado el 2025-12-01 le quedaban 101 días.
    expect(sugerir('2025-03-12', { ingreso: '2025-12-01' })).toBeNull();
  });
});

describe('pureza', () => {
```

- [ ] **Paso 2: ver que falla**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/dominio.test.ts; Pop-Location`

Esperado: FAIL en las ocho pruebas nuevas (`TypeError: tipoSugerido is not a function`; en la primera, `CLAVE_TIPO_SUGERIDO` y `UMBRAL_SUGERENCIA_DIAS` llegan `undefined`). El resto, en verde.

- [ ] **Paso 3: el código mínimo** — en `apps/hub-api/src/trazabilidad/dominio.ts`, sustituir:

```typescript
  const d = String(desk ?? '').trim();
  return d ? { tipo: d, origen: 'desk' } : { tipo: '', origen: null };
}
```

por:

```typescript
  const d = String(desk ?? '').trim();
  return d ? { tipo: d, origen: 'desk' } : { tipo: '', origen: null };
}

// ── Tipo de servicio sugerido por el vencimiento de la calibración ───────────
//
// Diseño del 2026-11-24. Un ticket que llega SIN tipo y cuyo equipo entró con
// la calibración vencida o a punto de vencer lleva una SUGERENCIA,
// «Diagnóstico + Calibración». La app nunca la aplica sola (el tipo decide el
// plazo y la agenda): una persona la confirma con «Usar», que pone el tipo a
// mano por la ruta de siempre.

/** El tipo que se sugiere: el compuesto de `TIPOS_COMPUESTOS` (su fila de `tmc_plazos` la siembra la 045). */
export const CLAVE_TIPO_SUGERIDO = 'diagnostico + calibracion';

/** Se sugiere si, el día de entrada, a la calibración le quedaban estos días o menos; las vencidas (negativos), siempre. */
export const UMBRAL_SUGERENCIA_DIAS = 60;

/** La sugerencia de un ticket: el tipo (clave y etiqueta de Configuración) y el día en que vence, o vencía, su calibración. */
export interface TipoSugerido {
  clave: string;
  etiqueta: string;
  /** AAAA-MM-DD: la calibración que contaba el día de entrada más la vigencia de su equipo. */
  vence: string;
}

/**
 * El tipo que se sugiere a un ticket, o null. Sólo si no tiene tipo (`tipo` es
 * el efectivo, `tipoEfectivo`), tiene día de entrada, existe `sugerible` (la
 * fila de `CLAVE_TIPO_SUGERIDO` en Configuración) y, ese día, la calibración
 * que contaba (`ultimaCalibracion`) con la vigencia de su equipo (`vigencia`;
 * null = sin vencimiento) estaba vencida o a `UMBRAL_SUGERENCIA_DIAS` o menos
 * de vencer. La referencia es el ingreso, no hoy: calibrar el equipo durante
 * el servicio no borra la sugerencia.
 */
export function tipoSugerido(e: {
  tipo: string;
  ultimaCalibracion: string | null;
  vigencia: number | null;
  ingreso: string | null;
  sugerible: { clave: string; etiqueta: string } | null;
}): TipoSugerido | null {
  if (e.tipo.trim() !== '' || !e.sugerible || !esFechaIso(e.ingreso)) return null;
  const { vence, vigenciaDias } = estadoCalibracion(e.ultimaCalibracion, e.ingreso, e.vigencia);
  if (vence === null || vigenciaDias === null || vigenciaDias > UMBRAL_SUGERENCIA_DIAS) return null;
  return { clave: e.sugerible.clave, etiqueta: e.sugerible.etiqueta, vence };
}
```

- [ ] **Paso 4: ver que pasa**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/dominio.test.ts; Pop-Location`

Esperado: PASS, todo el fichero en verde (también «dominio.ts no importa nada»).

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/dominio.ts apps/hub-api/src/trazabilidad/dominio.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): regla pura del tipo de servicio sugerido por el vencimiento de la calibración
EOF
```

---

## Tarea 3: `listarServicios` devuelve `tipoSugerido`

**Ficheros:**
- Modificar: `apps/hub-api/src/trazabilidad/types.ts:40-42` (import) y `:325-326` (campo nuevo de `ServicioVista`)
- Modificar: `apps/hub-api/src/trazabilidad/repo.ts:10` y `:14-50` (imports), `:126-129` (helpers), `:149-155` (`listarEquipos`), `:374-383` (`equipoPorSerial`), `:411-504` (`listarServicios`)
- Modificar: `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts:72` (fixture `sv()`, para que la sub-app siga compilando)
- Prueba: `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts:576-578` (añadir al final de `describe('servicios abiertos en Desk'…)`)

Candados que **no** cambian y que hay que dejar en verde (ver D1): `seguimiento.test.ts` (`portal.tmc_equipos` nombrada una vez en `repo.ts`; cinco `${INVENTARIO} e`; `CLIENTE_POR_SERIAL` una vez y sólo para `SELECT e.cliente`; nadie escribe `en_seguimiento =`), `vigencia-repo.test.ts` (nadie más escribe `tmc_marcas_vigencia`), `calibraciones.test.ts` (nada de `cf_fecha_de_calibracion` en `repo.ts`) y la lista de tablas `tmc_*` de `trazabilidad.db.test.ts:337`. Por eso los comentarios nuevos **no** escriben «FROM portal.tmc_equipos», ni `${INVENTARIO} e`, ni `${CLIENTE_POR_SERIAL}`.

- [ ] **Paso 1: escribir la prueba que falla** — Docker encendido (`docker desktop start`, PowerShell). En `apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts`, sustituir:

```typescript
    expect(await servicio(1071)).toMatchObject({ tipoServicio: '', tipoOrigen: null, tipoDesk: '', tipoManual: null });
  });
});
```

por:

```typescript
    expect(await servicio(1071)).toMatchObject({ tipoServicio: '', tipoOrigen: null, tipoDesk: '', tipoManual: null });
  });

  // Tipo sugerido (diseño del 2026-11-24): un ticket SIN tipo cuyo equipo del inventario entró con la calibración vencida o a 60 días
  // o menos de vencer lleva «Diagnóstico + Calibración» como sugerencia. Nunca se pone solo. La referencia es el día de entrada.
  describe('tipo sugerido por el vencimiento de la calibración', () => {
    const SUGERIDO = { clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración' };

    beforeEach(async () => {
      // Otros ficheros de BD dejan calibraciones, marcas o vigencias guardadas: aquí se parte de cero.
      await db.query('TRUNCATE portal.tmc_calibraciones, portal.tmc_marcas, portal.tmc_marcas_vigencia, portal.tmc_contratos RESTART IDENTITY');
    });

    it('un GRIMM que entró vencido y sin tipo lleva la sugerencia; con tipo de Desk o puesto a mano, no', async () => {
      await sembrar([fila('18A00071', 'Cliente Uno', '2025-03-12')]); // sin filas guardadas: vale su fecha del inventario; vence el 2026-03-12
      await ticket({ numero: 1100, serial: '18A00071', fechaTicket: '2026-10-01' });
      await ticket({ numero: 1101, serial: '18A00071', fechaTicket: '2026-10-01', tipo: 'Diagnóstico' });
      expect((await servicio(1100)).tipoSugerido).toEqual({ ...SUGERIDO, vence: '2026-03-12' });
      expect((await servicio(1101)).tipoSugerido).toBeNull();
      await repo.fijarTipoServicio(db, 1100, 'Calibración', actor);
      expect((await servicio(1100)).tipoSugerido).toBeNull();
    });

    it('calibrarlo durante el servicio no borra la sugerencia: cuenta la calibración del día de entrada', async () => {
      await sembrar([fila('18A00072', 'Cliente Dos', null)]);
      await db.query(
        `INSERT INTO portal.tmc_calibraciones (clave, serial, serial_norm, fecha, origen, estado, por) VALUES
           ('18A00072', '18A00072', '18A00072', '2025-03-12', 'fst022', 'vigente', 'prueba@example.com'),
           ('18A00072', '18A00072', '18A00072', '2026-10-03', 'manual', 'vigente', 'prueba@example.com')`,
      );
      await ticket({ numero: 1102, serial: '18A00072', fechaTicket: '2026-10-01' });
      expect((await servicio(1102)).tipoSugerido).toEqual({ ...SUGERIDO, vence: '2026-03-12' });
      // El inventario ya enseña la de octubre: las dos fechas conviven, cada una con su día de referencia.
      expect((await repo.listarEquipos(db, hoy)).find((e) => e.clave === '18A00072')).toMatchObject({ ultimaCalibracion: '2026-10-03' });
    });

    it('fuera del inventario, o en él con una marca sin vigencia (Horiba incluida, sin plazo), no hay sugerencia; con plazo, sí', async () => {
      await sembrar([fila('V3BW1WJE', 'Cliente Horiba S.A.S.', '2025-03-12')]);
      await db.query(`UPDATE portal.tmc_equipos SET marca = 'Horiba', en_seguimiento = FALSE`);
      await ticket({ numero: 1103, serial: 'V3BW1WJE', fechaTicket: '2026-10-01' });
      // Marca apagada: fuera del inventario (aunque `CLIENTE_POR_SERIAL` le siga dando el nombre del cliente).
      expect(await servicio(1103)).toMatchObject({ cliente: 'Cliente Horiba S.A.S.', tipoSugerido: null });
      // Incluida, pero sin vigencia guardada: sin vencimiento.
      await db.query(`INSERT INTO portal.tmc_marcas (clave, marca, incluida, motivo, por) VALUES ('horiba', 'Horiba', TRUE, 'Prueba ficticia.', 'director@example.com')`);
      expect((await servicio(1103)).tipoSugerido).toBeNull();
      // Con 365 días, como un GRIMM: ya entró vencido.
      await db.query(`INSERT INTO portal.tmc_marcas_vigencia (clave, marca, dias, motivo, por) VALUES ('horiba', 'Horiba', 365, 'Prueba ficticia.', 'director@example.com')`);
      expect((await servicio(1103)).tipoSugerido).toEqual({ ...SUGERIDO, vence: '2026-03-12' });
    });
  });
});
```

- [ ] **Paso 2: ver que falla**

Ejecuta: `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/trazabilidad.db.test.ts; Pop-Location`

Esperado: FAIL en las tres pruebas nuevas (`expected undefined to deeply equal { clave: 'diagnostico + calibracion', … }` / `expected undefined to be null`). El resto del fichero, en verde.

- [ ] **Paso 3: el campo de la vista** — en `apps/hub-api/src/trazabilidad/types.ts`, dos Edit:

(a) Sustituir:

```typescript
  type TipoAbierto,
  type TramoAviso,
```

por:

```typescript
  type TipoAbierto,
  type TipoSugerido,
  type TramoAviso,
```

(b) Sustituir:

```typescript
  /** El tipo puesto a mano, quién lo puso y cuándo; null si no hay ninguno. */
  tipoManual: TipoManual | null;
```

por:

```typescript
  /** El tipo puesto a mano, quién lo puso y cuándo; null si no hay ninguno. */
  tipoManual: TipoManual | null;
  /**
   * Sólo en un ticket sin tipo: el que se le SUGIERE porque su equipo del inventario entró con la calibración vencida o a 60 días o
   * menos de vencer (`tipoSugerido`, dominio.ts). Nunca se aplica solo: «Usar» lo pone a mano por la ruta de siempre. Null si no toca.
   */
  tipoSugerido: TipoSugerido | null;
```

- [ ] **Paso 4: los imports de `repo.ts`** — en `apps/hub-api/src/trazabilidad/repo.ts`, cuatro Edit:

(a) Sustituir:

```typescript
import { fechaEfectiva, type CalibracionGuardada } from './calibraciones.js';
```

por:

```typescript
import { calibracionAlIngreso, fechaEfectiva, type CalibracionGuardada } from './calibraciones.js';
```

(b) Sustituir:

```typescript
  categoriaDeEstado,
  claveCliente,
```

por:

```typescript
  categoriaDeEstado,
  CLAVE_TIPO_SUGERIDO,
  claveCliente,
```

(c) Sustituir:

```typescript
  tiposDeTickets,
  type CategoriaEstado,
```

por:

```typescript
  tiposDeTickets,
  tipoSugerido,
  type CategoriaEstado,
```

(d) Sustituir:

```typescript
  type TicketContacto,
} from './dominio.js';
```

por:

```typescript
  type TicketContacto,
  type TipoSugerido,
} from './dominio.js';
```

- [ ] **Paso 5: sacar de `listarEquipos` lo que también usará `listarServicios` (sin cambiar lo que hace)** — en `repo.ts`, dos Edit:

(a) Sustituir:

```typescript
  e.entradas_st, e.calibraciones_periodo, e.correctivos_periodo, e.activo, e.en_seguimiento`;
```

por:

```typescript
  e.entradas_st, e.calibraciones_periodo, e.correctivos_periodo, e.activo, e.en_seguimiento`;

/** Las calibraciones guardadas de cada equipo, por su clave (las que no tienen clave no son de ningún equipo del inventario). */
function calibracionesPorEquipo(calibraciones: readonly CalibracionGuardada[]): Map<string, CalibracionGuardada[]> {
  const m = new Map<string, CalibracionGuardada[]>();
  for (const c of calibraciones) if (c.clave) m.set(c.clave, [...(m.get(c.clave) ?? []), c]);
  return m;
}

/** Lo que piden `vigenciaDeEquipo` y `vaPorContrato` (marcas.ts) de una fila de equipo: su marca, su cliente y si está en seguimiento. */
const grupoDe = (r: Row) => ({ marca: r.marca ?? '', cliente: r.cliente ?? '', enSeguimiento: r.en_seguimiento !== false });
```

(b) Sustituir:

```typescript
  const calibracionesDe = new Map<string, CalibracionGuardada[]>();
  for (const c of calibraciones) if (c.clave) calibracionesDe.set(c.clave, [...(calibracionesDe.get(c.clave) ?? []), c]);
  const ultimaDe = (r: Row): string | null => fechaEfectiva(calibracionesDe.get(r.clave) ?? [], r.ultima_calibracion, hoy);
  const grupoDe = (r: Row) => ({ marca: r.marca ?? '', cliente: r.cliente ?? '', enSeguimiento: r.en_seguimiento !== false });
  const vigenciaDe = (r: Row): number | null => vigenciaDeEquipo(grupoDe(r), vigencias, contratos);
```

por:

```typescript
  const calibracionesDe = calibracionesPorEquipo(calibraciones);
  const ultimaDe = (r: Row): string | null => fechaEfectiva(calibracionesDe.get(r.clave) ?? [], r.ultima_calibracion, hoy);
  const vigenciaDe = (r: Row): number | null => vigenciaDeEquipo(grupoDe(r), vigencias, contratos);
```

- [ ] **Paso 6: el equipo de cada serial** — en `repo.ts`, sustituir:

```typescript
  return { cliente: asuntoSinCodigo(r.subject, r.codigo_servicio), origen: 'asunto' };
}
```

por:

```typescript
  return { cliente: asuntoSinCodigo(r.subject, r.codigo_servicio), origen: 'asunto' };
}

/**
 * El equipo del inventario de cada serial (`serialNorm`), para sugerir el tipo de un servicio (2026-11-24). `filas` son las de
 * `consultarEquipos`: sólo equipos activos del inventario. Con el serial repetido, el de clave más baja: el mismo que elige
 * `CLIENTE_POR_SERIAL` cuando hay alguno activo en el inventario. Un equipo retirado no da sugerencia.
 */
function equipoPorSerial(filas: readonly Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of filas) {
    const s = serialNorm(r.serial);
    const otro = m.get(s);
    if (s && (!otro || String(r.clave) < String(otro.clave))) m.set(s, r);
  }
  return m;
}
```

- [ ] **Paso 7: `listarServicios` calcula la sugerencia** — en `repo.ts`, tres Edit:

(a) Sustituir:

```typescript
 * Colombia de created_time. El cliente lo resuelve `clienteDeServicio`: el del
 * equipo del maestro con ese serial y, si no, lo que viaje en `raw`.
 */
export async function listarServicios(db: Db, hoy: string): Promise<ServicioVista[]> {
  const [{ rows }, { tipos, plazos }, conRol, historial] = await Promise.all([
```

por:

```typescript
 * Colombia de created_time. El cliente lo resuelve `clienteDeServicio`: el del
 * equipo del maestro con ese serial y, si no, lo que viaje en `raw`.
 *
 * Un ticket sin tipo lleva además `tipoSugerido` (2026-11-24; la regla es
 * `tipoSugerido`, dominio.ts): con el equipo ACTIVO DEL INVENTARIO de su serial
 * (`consultarEquipos`, la misma lectura de `INVENTARIO` que `listarEquipos`; no
 * `CLIENTE_POR_SERIAL`, que sólo da el nombre del cliente), la vigencia de ese
 * equipo y la calibración que contaba el día de entrada
 * (`calibracionAlIngreso`). Sólo se sugiere: aquí no se escribe nada.
 */
export async function listarServicios(db: Db, hoy: string): Promise<ServicioVista[]> {
  const [{ rows }, { tipos, plazos }, conRol, historial, equipos, calibraciones, { vigencias, contratos }] = await Promise.all([
```

(b) Sustituir:

```typescript
        WHERE h.numero IN (SELECT t.number FROM desk.tickets t WHERE ${TICKET_ABIERTO})`,
    ),
  ]);
  const porClave = new Map(tipos.map((t) => [t.clave, t]));
```

por:

```typescript
        WHERE h.numero IN (SELECT t.number FROM desk.tickets t WHERE ${TICKET_ABIERTO})`,
    ),
    // El tipo sugerido: los equipos del inventario, sus calibraciones guardadas y la vigencia de cada marca (lo mismo que GET /equipos).
    consultarEquipos(db),
    leerCalibraciones(db),
    leerVigencias(db),
  ]);
  const porClave = new Map(tipos.map((t) => [t.clave, t]));
  const equipoDe = equipoPorSerial(equipos.rows as Row[]);
  const calibracionesDe = calibracionesPorEquipo(calibraciones);
  const sugerible = porClave.get(CLAVE_TIPO_SUGERIDO) ?? null;
  /** El tipo que se sugiere a un ticket: sin equipo del inventario con su serial, o sin día de entrada, ninguno. */
  const sugeridoDe = (serial: unknown, tipo: string, ingreso: string | null): TipoSugerido | null => {
    const q = equipoDe.get(serialNorm(serial));
    if (!q || !ingreso) return null;
    return tipoSugerido({
      tipo,
      ultimaCalibracion: calibracionAlIngreso(calibracionesDe.get(q.clave) ?? [], q.ultima_calibracion, ingreso),
      vigencia: vigenciaDeEquipo(grupoDe(q), vigencias, contratos),
      ingreso,
      sugerible,
    });
  };
```

(c) Sustituir:

```typescript
      tipoManual: tipoOrigen === 'manual' && manualClave !== null ? { clave: manualClave, por: r.manual_por, en: r.manual_en } : null,
```

por:

```typescript
      tipoManual: tipoOrigen === 'manual' && manualClave !== null ? { clave: manualClave, por: r.manual_por, en: r.manual_en } : null,
      tipoSugerido: sugeridoDe(r.serial, tipoServicio, r.ingreso),
```

- [ ] **Paso 8: el fixture de la sub-app** — en `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts`, sustituir:

```typescript
    tipoManual: null,
    ...extra,
```

por:

```typescript
    tipoManual: null,
    tipoSugerido: null,
    ...extra,
```

- [ ] **Paso 9: ver que pasa la de BD**

Ejecuta: `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/trazabilidad.db.test.ts; Pop-Location`

Esperado: PASS, todo el fichero en verde (las tres nuevas y las de `listarEquipos`, que ya usan los helpers sacados).

- [ ] **Paso 10: las comparaciones «byte a byte» de `GET /servicios` siguen valiendo**

Ejecuta: `Push-Location apps/hub-api; npx vitest run --config vitest.db.config.ts src/trazabilidad/seguimiento.db.test.ts src/trazabilidad/marcas.db.test.ts; Pop-Location`

Esperado: PASS los dos ficheros.

- [ ] **Paso 11: candados y rutas, sin base**

Ejecuta: `Push-Location apps/hub-api; npx vitest run src/trazabilidad/seguimiento.test.ts src/trazabilidad/vigencia-repo.test.ts src/trazabilidad/calibraciones.test.ts src/trazabilidad/router.test.ts src/trazabilidad/dominio.test.ts; Pop-Location`

Esperado: PASS los cinco. Si cae un candado de `seguimiento.test.ts`, **no se toca la prueba**: se revisa que el código no nombre la tabla ni `${INVENTARIO} e` ni `${CLIENTE_POR_SERIAL}` de más (comentarios incluidos) y, si aun así hiciera falta cambiarlo, se para y se pregunta a Alfonso (D1).

- [ ] **Paso 12: compilan los dos**

Ejecuta: `Push-Location apps/hub-api; npx tsc -p tsconfig.json --noEmit; Pop-Location` — Esperado: sólo el error conocido de `src/ausencias/service/barril.test.ts`.

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npm run typecheck; npm test; Pop-Location` — Esperado: sin errores de tipos y todas las pruebas en verde.

- [ ] **Paso 13: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/hub-api/src/trazabilidad/types.ts apps/hub-api/src/trazabilidad/repo.ts apps/hub-api/src/trazabilidad/trazabilidad.db.test.ts apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): Servicios sugiere el tipo a los tickets sin tipo con la calibración vencida al entrar
EOF
```

---

## Tarea 4: El texto de la sugerencia — `textoSugerencia`

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/src/lib/servicios.ts:9-24` (import) y `:322-328` (añadir detrás de `notaTipo`)
- Prueba: `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts:3-39` (import) y `:757-759` (añadir al final)

`fmtFecha` (`src/lib/vistas.ts`, el formateador de siempre) da «DD/MM/AAAA» y no mueve un día suelto. La palabra se decide contra el ingreso (D5): «vence el» si vence después; si no, «vencía el».

- [ ] **Paso 1: escribir la prueba que falla** — en `apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts`, tres Edit:

(a) Sustituir:

```typescript
  TITULO_STANDBY,
  TONO_PLAZO,
```

por:

```typescript
  TITULO_STANDBY,
  TITULO_SUGERENCIA,
  TONO_PLAZO,
```

(b) Sustituir:

```typescript
  textoPlazo,
  textoTramos,
```

por:

```typescript
  textoPlazo,
  textoSugerencia,
  textoTramos,
```

(c) Sustituir:

```typescript
    expect(textoCliente(sv(null, null, { cliente: '', clienteOrigen: 'asunto', clienteDeAsunto: true }))).toEqual({ texto: '', apagado: true });
  });
});
```

por:

```typescript
    expect(textoCliente(sv(null, null, { cliente: '', clienteOrigen: 'asunto', clienteDeAsunto: true }))).toEqual({ texto: '', apagado: true });
  });
});

describe('tipo sugerido junto al desplegable', () => {
  const sugerido = (vence: string): Partial<ServicioVista> => ({ tipoSugerido: { clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración', vence } });

  it('vencida el día de entrada: «vencía el …»', () => {
    expect(textoSugerencia(sv('2026-10-05', null, sugerido('2026-03-12')))).toBe('Sugerido: Diagnóstico + Calibración — vencía el 12/03/2026');
  });

  it('por vencer el día de entrada: «vence el …»; si vencía ese mismo día, «vencía»', () => {
    expect(textoSugerencia(sv('2026-10-05', null, sugerido('2026-11-20')))).toBe('Sugerido: Diagnóstico + Calibración — vence el 20/11/2026');
    expect(textoSugerencia(sv('2026-10-05', null, sugerido('2026-10-05')))).toBe('Sugerido: Diagnóstico + Calibración — vencía el 05/10/2026');
  });

  it('sin sugerencia, nada', () => {
    expect(textoSugerencia(sv('2026-10-05', null))).toBeNull();
  });

  it('el `title` de la etiqueta dice por qué sale y que no cambia nada sola', () => {
    expect(TITULO_SUGERENCIA).toContain('a 60 días o menos de vencer');
    expect(TITULO_SUGERENCIA).toContain('«Usar»');
  });
});
```

- [ ] **Paso 2: ver que falla**

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npx vitest run src/lib/servicios.test.ts; Pop-Location`

Esperado: FAIL en las cuatro nuevas (`TypeError: textoSugerencia is not a function`; `TITULO_SUGERENCIA` llega `undefined`). El resto, en verde.

- [ ] **Paso 3: el código mínimo** — en `apps/trazabilidad-mantenimientos/src/lib/servicios.ts`, dos Edit:

(a) Sustituir:

```typescript
  ROLES_ESTADO,
  claveTipoServicio,
```

por:

```typescript
  ROLES_ESTADO,
  UMBRAL_SUGERENCIA_DIAS,
  claveTipoServicio,
```

(b) Sustituir:

```typescript
  return s.tipoDesk ? 'Tipo de servicio según Zoho Desk.' : 'Zoho Desk no envía el tipo de servicio de este ticket: elígelo aquí.';
}
```

por:

```typescript
  return s.tipoDesk ? 'Tipo de servicio según Zoho Desk.' : 'Zoho Desk no envía el tipo de servicio de este ticket: elígelo aquí.';
}

/** El `title` de la etiqueta del tipo sugerido: por qué sale y que no cambia nada sola. */
export const TITULO_SUGERENCIA = `Su equipo entró con la calibración vencida o a ${UMBRAL_SUGERENCIA_DIAS} días o menos de vencer. Es sólo una sugerencia: el tipo no cambia hasta que alguien pulsa «Usar» o lo elige en el desplegable.`;

/**
 * La etiqueta ámbar del tipo sugerido, junto al desplegable: «Sugerido:
 * Diagnóstico + Calibración — vencía el 12/03/2026»; «vence el» si la
 * calibración vencía después del día de entrada del ticket. Null si no hay
 * sugerencia (también con un hub-api que todavía no la manda).
 */
export function textoSugerencia(s: Pick<ServicioVista, 'tipoSugerido' | 'ingreso'>): string | null {
  const t = s.tipoSugerido;
  if (!t) return null;
  const verbo = s.ingreso !== null && t.vence > s.ingreso ? 'vence' : 'vencía';
  return `Sugerido: ${t.etiqueta} — ${verbo} el ${fmtFecha(t.vence)}`;
}
```

- [ ] **Paso 4: ver que pasa**

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npx vitest run src/lib/servicios.test.ts; npm run typecheck; Pop-Location`

Esperado: PASS el fichero entero y sin errores de tipos.

- [ ] **Paso 5: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/src/lib/servicios.ts apps/trazabilidad-mantenimientos/src/lib/servicios.test.ts
git commit -F - <<'EOF'
feat(trazabilidad): texto de la sugerencia del tipo de servicio en Servicios
EOF
```

---

## Tarea 5: La etiqueta y el botón «Usar» en `TipoSelect`

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/src/vistas/Servicios.tsx:5-36` (import), `:307` (llamada), `:385-438` (`TipoSelect`)

Sin pruebas automáticas (la sub-app sólo prueba `src/lib`): la lógica ya está probada en `textoSugerencia`; aquí sólo se pinta. «Usar» hace exactamente lo mismo que elegir el tipo en el desplegable: `onCambio(s, clave, etiqueta)` → `cambiarTipo` → `api.fijarTipoServicio` (`PUT /trazabilidad/servicios/:numero/tipo`, permiso `servicios.tipo.write`, firma en `tmc_servicios_tipo`). La respuesta trae los servicios recalculados: el ticket ya tiene tipo y la sugerencia desaparece sola. Todo control desactivable lleva `DESACTIVADO` (regla del `CLAUDE.md` de la sub-app).

- [ ] **Paso 1: imports** — en `Servicios.tsx`, dos Edit:

(a) Sustituir:

```typescript
  TITULO_STANDBY,
  TONO_PLAZO,
```

por:

```typescript
  TITULO_STANDBY,
  TITULO_SUGERENCIA,
  TONO_PLAZO,
```

(b) Sustituir:

```typescript
  textoPlazo,
  textoTramos,
```

por:

```typescript
  textoPlazo,
  textoSugerencia,
  textoTramos,
```

- [ ] **Paso 2: la llamada pasa el permiso aparte (D2)** — sustituir:

```tsx
                    <TipoSelect s={s} tipos={tipos} guardando={guardando === s.numero} bloqueado={guardando !== null || cargando || !puedeTipo} onCambio={cambiarTipo} />
```

por:

```tsx
                    <TipoSelect s={s} tipos={tipos} guardando={guardando === s.numero} bloqueado={guardando !== null || cargando || !puedeTipo} puede={puedeTipo} onCambio={cambiarTipo} />
```

- [ ] **Paso 3: props y contenedor de `TipoSelect`** — sustituir:

```tsx
  guardando,
  bloqueado,
  onCambio,
}: {
  s: ServicioVista;
  tipos: readonly TipoServicioOpcion[];
  guardando: boolean;
  bloqueado: boolean;
  onCambio: (s: ServicioVista, clave: string, etiqueta: string) => void | Promise<void>;
}) {
  const { valor, opciones } = selectorTipo(s, tipos);
  const sinTipo = !s.tipoServicio;
  return (
    <span className="inline-flex items-center gap-1.5">
```

por:

```tsx
  guardando,
  bloqueado,
  puede,
  onCambio,
}: {
  s: ServicioVista;
  tipos: readonly TipoServicioOpcion[];
  guardando: boolean;
  bloqueado: boolean;
  /** Tiene `servicios.tipo.write`. Sin él se ve la sugerencia, pero no «Usar» (`bloqueado` también vale mientras se guarda otro ticket). */
  puede: boolean;
  onCambio: (s: ServicioVista, clave: string, etiqueta: string) => void | Promise<void>;
}) {
  const { valor, opciones } = selectorTipo(s, tipos);
  const sinTipo = !s.tipoServicio;
  const sugerido = s.tipoSugerido;
  const sugerencia = textoSugerencia(s);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
```

- [ ] **Paso 4: etiqueta y botón detrás del desplegable** — sustituir:

```tsx
      </select>
      {guardando ? (
```

por:

```tsx
      </select>
      {sugerido && sugerencia && (
        <span className="inline-flex items-center gap-1">
          <span title={TITULO_SUGERENCIA}>
            <Tag tone="amber">{sugerencia}</Tag>
          </span>
          {puede && (
            <button
              type="button"
              disabled={bloqueado}
              aria-label={`Usar ${sugerido.etiqueta} como tipo de servicio del ticket ${s.numero}`}
              title={TITULO_SUGERENCIA}
              // Como el desplegable: si la fila gana una acción propia, el botón no debe dispararla.
              onClick={(e) => {
                e.stopPropagation();
                void onCambio(s, sugerido.clave, sugerido.etiqueta);
              }}
              className={`min-h-[36px] rounded-xl border border-amber-300 bg-white px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${DESACTIVADO}`}
            >
              Usar
            </button>
          )}
        </span>
      )}
      {guardando ? (
```

- [ ] **Paso 5: tipos, pruebas y build**

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npm run typecheck; npm test; npm run build; Pop-Location`

Esperado: sin errores de tipos, todas las pruebas en verde y `vite build` termina con «✓ built in …».

- [ ] **Paso 6: commit (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/src/vistas/Servicios.tsx
git commit -F - <<'EOF'
feat(trazabilidad): etiqueta del tipo sugerido y botón Usar junto al desplegable de Servicios
EOF
```

---

## Tarea 6: Documento vivo, verificación completa, merge y push

**Ficheros:**
- Modificar: `apps/trazabilidad-mantenimientos/CLAUDE.md` (fila de `GET /trazabilidad/servicios` en la tabla de la API y sección nueva al final de «Servicios: plazo de los tickets abiertos», delante de «## Reloj del plazo…»)

- [ ] **Paso 1: la fila de la API** — en `apps/trazabilidad-mantenimientos/CLAUDE.md`, sustituir:

```markdown
`tipoManual: {clave, por, en}`), el reloj con pausas
```

por:

```markdown
`tipoManual: {clave, por, en}`; y `tipoSugerido: {clave, etiqueta, vence} | null`, la sugerencia de un ticket sin tipo: ver «Tipo sugerido por el vencimiento de la calibración»), el reloj con pausas
```

- [ ] **Paso 2: la sección nueva** — en el mismo fichero, sustituir:

```markdown
- Ninguna migración de hub-api crea ni altera nada en el esquema `desk`.

## Reloj del plazo: standby lo pausa, «trabajo terminado» lo para
```

por:

```markdown
- Ninguna migración de hub-api crea ni altera nada en el esquema `desk`.

### Tipo sugerido por el vencimiento de la calibración (2026-11-24)

Diseño: `docs/superpowers/specs/2026-11-24-tipo-sugerido-servicios-design.md`. **Es una sugerencia y nada más**: la app nunca
pone el tipo sola (el tipo decide el plazo y la agenda).

- **Cuándo**: el ticket no tiene tipo (`tipoEfectivo` vacío: ni de Desk ni a mano); su serial casa con un equipo **activo del
  inventario** (`consultarEquipos`, la misma lectura de `GET /equipos`; con el serial repetido, el de clave más baja; un equipo
  retirado no da sugerencia) cuya vigencia tiene días (`vigenciaDeEquipo`); y **el día de entrada** (`ingreso`) su calibración ya
  estaba vencida o vencía en `UMBRAL_SUGERENCIA_DIAS` (60) días o menos, sin límite hacia atrás (también `FUERA_CICLO`). Sin día de
  entrada, nada.
- **La calibración del día de entrada** (`calibracionAlIngreso`, `calibraciones.ts`): la de `fechaEfectiva` a ese día, y el
  respaldo de `tmc_equipos.ultima_calibracion` sólo si no es posterior. Calibrar el equipo durante el servicio no borra la sugerencia.
- **Qué se sugiere**: siempre `CLAVE_TIPO_SUGERIDO` («Diagnóstico + Calibración», la fila de la 045), con la etiqueta de
  Configuración; sin esa fila, nada. La regla pura es `tipoSugerido` (`dominio.ts`); la aplica `listarServicios` (`repo.ts`) y viaja
  en `ServicioVista.tipoSugerido`. No se guarda en ningún sitio: se recalcula en cada lectura.
- **Pantalla**: junto al desplegable, una etiqueta ámbar (`textoSugerencia` y `TITULO_SUGERENCIA`, `src/lib/servicios.ts`: «vencía
  el» o «vence el» según el día de entrada) y el botón «Usar» (sólo con `servicios.tipo.write`, prop `puede` de `TipoSelect`;
  desactivado mientras se guarda otro ticket), que hace lo mismo que elegir el tipo en el desplegable: `PUT
  /trazabilidad/servicios/:numero/tipo`, con su firma en `tmc_servicios_tipo`.
- **Sin ruta, migración ni tabla nuevas, y ningún candado cambió**: `listarServicios` lee el inventario llamando a
  `consultarEquipos` (la lectura revisada de `INVENTARIO`); `CLIENTE_POR_SERIAL` sigue dando sólo el nombre del cliente.

## Reloj del plazo: standby lo pausa, «trabajo terminado» lo para
```

- [ ] **Paso 3: commit del documento (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git add apps/trazabilidad-mantenimientos/CLAUDE.md
git commit -F - <<'EOF'
docs(trazabilidad): el tipo sugerido de Servicios en el documento de la app
EOF
```

- [ ] **Paso 4: suite entera de hub-api**

Ejecuta: `Push-Location apps/hub-api; npm test; Pop-Location` (unos 3136 tests; usa `timeout` de 600000 ms).

Esperado: todo en verde. Si cae sólo la 4.4 de usuarios por tiempo, repítela sola (`npx vitest run <su fichero>`) antes de investigar.

- [ ] **Paso 5: suite entera de BD** — Docker encendido.

Ejecuta: `Push-Location apps/hub-api; npm run test:db; Pop-Location` (en segundo plano si tarda; `timeout` de 600000 ms).

Esperado: todo en verde.

- [ ] **Paso 6: tipos de hub-api y sub-app completa**

Ejecuta: `Push-Location apps/hub-api; npx tsc -p tsconfig.json --noEmit; Pop-Location` — Esperado: sólo el error conocido de `src/ausencias/service/barril.test.ts`.

Ejecuta: `Push-Location apps/trazabilidad-mantenimientos; npm test; npm run typecheck; npm run build; Pop-Location` — Esperado: todo en verde y «✓ built in …».

- [ ] **Paso 7: tamaño y estado (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git diff --shortstat main...HEAD -- . ':(exclude)docs/superpowers'
git status --short
```

Esperado: menos de 800 inserciones + borrados (estimación: unas 350); `git status --short` sólo enseña lo de siempre (`M .gitignore`, `?? .atl/`, `?? apps/WO-sales/prompts/`, `?? img/`, `?? openspec/`).

- [ ] **Paso 8: comprobación de privacidad, en un comando aparte, antes del push (Bash)** — el repo es público.

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git diff main...HEAD -U0 -- . ':(exclude)docs/superpowers' | grep -E '^\+' | grep -inE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|password|secret|token' | grep -viE '@example\.com'
git diff main...HEAD -U0 -- docs/superpowers | grep -E '^\+' | grep -inE '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' | grep -viE '@example\.com'
```

Esperado: ninguna línea en ninguno de los dos (el segundo mira el diseño y este plan sólo por correos, porque el plan contiene el propio patrón de búsqueda). Si sale alguna, se revisa a mano antes de seguir: sólo valen datos ficticios.

- [ ] **Paso 9: merge y push (Bash)**

```bash
cd "/c/Users/algar/OneDrive/Documentos/Antigravity/Portal/antigravity-suite-R1.07"
git switch main && git pull --ff-only
git merge --no-ff feat/tipo-sugerido-servicios -m "merge: Servicios sugiere Diagnóstico + Calibración a los tickets sin tipo con la calibración vencida"
git push origin main
git status --short
```

Esperado: merge sin conflictos, push aceptado y `git status --short` igual que antes.

- [ ] **Paso 10: avisar a Alfonso del despliegue (a mano, en EasyPanel)**

Empujar no despliega. El despliegue lo hace Alfonso: **primero hub-api y justo después el portal** (el orden de siempre). No hay migración. Con el portal viejo sobre el hub-api nuevo, el campo `tipoSugerido` se ignora; con el portal nuevo sobre un hub-api viejo, `textoSugerencia` devuelve null y no sale nada: ningún orden rompe, pero se sigue el de siempre.

Prueba en el navegador, tras desplegar (Alfonso):
1. «Taller» → «Servicios»: un ticket sin tipo cuyo GRIMM EDM 180 entró vencido (o a 60 días o menos) enseña la etiqueta ámbar «Sugerido: Diagnóstico + Calibración — vencía el …» y el botón «Usar».
2. Con una cuenta de rol Lector o Comercial (sin `servicios.tipo.write`): se ve la etiqueta, pero no el botón.
3. Pulsar «Usar»: el desplegable pasa a «Diagnóstico + Calibración · 7 días háb.» con la marca «manual», aparece la fecha límite y la etiqueta desaparece. Quitarlo («Sin tipo» en el desplegable) vuelve a enseñar la sugerencia.
4. Un ticket con tipo de Desk o puesto a mano, o de un equipo Horiba (sin vencimiento), no enseña ninguna sugerencia.
