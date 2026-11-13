# KPIs: cuánto lleva cada uno sin descansar — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir la tarjeta «Quién acumula de más» por «Cuánto lleva cada uno sin descansar»: toda la plantilla activa con el tiempo desde su último día de vacaciones, en tramos de 6 y 12 meses.

**Architecture:** hub-api añade `deVacacionesAhora` a `repo.planificacionDeVacaciones`, una función pura `descansoPorPersona` en `kpis.ts` y un campo `descanso` en la respuesta de `GET /api/ausencias/kpis`. El front añade el tipo (opcional), un módulo puro `descanso.ts` con tests y la sección nueva en `PanelKpis.tsx`, que deja de pintar `AcumulacionExcesiva`.

**Tech Stack:** Express 4 + TS ESM, SQL crudo, Vitest + testcontainers; React 19 + Tailwind + lucide-react.

**Especificación:** `docs/superpowers/specs/2026-11-12-kpis-descanso-design.md`.

---

## Convenciones (TODAS las tareas)

- Rama `feat/kpis-descanso` (ya creada, con la spec). Nunca `git add -A`: rutas explícitas.
- Commits en español, **sin tildes**, **sin línea de atribución**.
- Comentarios con tildes y con el porqué; los `.db.test.ts`, sin tildes.
- ⚠️ Solo Edit/Write. Nunca `Set-Content`, `sed -i` ni `perl -pi`, tampoco para mutaciones temporales.
- hub-api desde `apps/hub-api`: unitarios `npx vitest run <ruta>`; BD `npx vitest run --config vitest.db.config.ts <ruta>` (si `docker info` falla: `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"`). Cobertura: `npx vitest run --coverage --exclude "scripts/**"` (el `.mjs` de equipos falla ya en main en Windows).
- Front desde `apps/ausencias`: `npm run typecheck`, `npm test`, `npm run build`.

## Cálculo de los meses (leer antes de la Task 2)

`mesesSinVacaciones = floor(dias × 12 / 365)`. Los tramos se deciden con los **meses** y el texto también, así que nunca discrepan: 365 días → 12 (alarma), 364 → 11 (aviso), 183 → 6 (aviso), 182 → 5 (ok). Con `hoy = 2026-11-12`: 365 días antes es `2025-11-12`, 364 es `2025-11-13`, 183 es `2026-05-13` y 182 es `2026-05-14`.

---

### Task 1: La planificación sabe quién está de vacaciones hoy

**Files:** `apps/hub-api/src/ausencias/repo/kpis.ts` (`PlanificacionDeEmpleado` y `planificacionDeVacaciones`, ~L247-315), `apps/hub-api/src/ausencias/repo.planificacion.db.test.ts`, `apps/hub-api/src/ausencias/router.test.ts` (tipo de `estado.planificacionKpi` ~L227 y doble ~L961).

- [ ] **Step 1: Tests de BD que fallan.** Al final de `repo.planificacion.db.test.ts` (sin tildes; `HOY = '2026-09-07'`, lunes; `sembrar` y `fila()` ya existen en el fichero):

```ts
describe('deVacacionesAhora', () => {
  it('marca a quien tiene unas vacaciones que empiezan hoy', async () => {
    await sembrar('vacaciones', 'aprobada', '2026-09-07', '2026-09-11');
    expect((await fila())?.deVacacionesAhora).toBe(true);
  });

  it('tambien si hoy es su ultimo dia', async () => {
    await sembrar('vacaciones', 'aprobada', '2026-09-01', '2026-09-07');
    expect((await fila())?.deVacacionesAhora).toBe(true);
  });

  it('CANDADO: no con unas ya terminadas ni con unas futuras', async () => {
    await sembrar('vacaciones', 'aprobada', '2026-08-03', '2026-08-07');
    await sembrar('vacaciones', 'aprobada', '2026-09-14', '2026-09-18');
    expect((await fila())?.deVacacionesAhora).toBe(false);
  });

  it('no con unas pendientes ni con un permiso de hoy', async () => {
    await sembrar('vacaciones', 'pendiente', '2026-09-07', '2026-09-11');
    await sembrar('permiso', 'aprobada', '2026-09-07', '2026-09-07');
    expect((await fila())?.deVacacionesAhora).toBe(false);
  });
});
```

- [ ] **Step 2: Verlos fallar.** `npx vitest run --config vitest.db.config.ts src/ausencias/repo.planificacion.db.test.ts` → los dos primeros fallan (`undefined`).

- [ ] **Step 3: Implementar.**

3a. En `PlanificacionDeEmpleado`, detrás de `diasProgramados`:

```ts
  /**
   * Tiene unas vacaciones que ocupan agenda y abarcan hoy (bordes incluidos).
   * Sin esto, la tarjeta de descanso diría «descansó hace 8 meses» de alguien
   * que está de vacaciones ahora mismo: `ultimasVacaciones` solo mira las ya
   * terminadas.
   */
  deVacacionesAhora: boolean;
```

3b. En el SELECT de `planificacionDeVacaciones`, detrás de `AS dias_programados`:

```sql
            , EXISTS (SELECT 1
                FROM portal.solicitudes_ausencia a
               WHERE a.empleado_id = e.id
                 AND a.tipo    = 'vacaciones'
                 AND a.estado  = ANY($2::varchar[])
                 AND a.fecha_inicio <= $1::date
                 AND a.fecha_fin    >= $1::date
            ) AS de_vacaciones_ahora
```

(coloca la coma donde corresponda para que el SELECT sea válido), añade `de_vacaciones_ahora: boolean` al tipo de la fila y `deVacacionesAhora: r.de_vacaciones_ahora,` al `.map`. Actualiza el JSDoc de la función con una línea sobre la tercera señal.

3c. En `router.test.ts`: en el tipo de `estado.planificacionKpi` añade `deVacacionesAhora?: boolean;` y cambia el doble a:

```ts
  // `deVacacionesAhora` por defecto a false: los tests que siembran la
  // planificación antes de existir este campo no lo llevan.
  planificacionDeVacaciones: async (_db: unknown, _hoy: string) =>
    estado.planificacionKpi.map((p) => ({ deVacacionesAhora: false, ...p })),
```

- [ ] **Step 4: Verde.** El test de BD → PASS. `npx vitest run src/ausencias/router.test.ts` → PASS. `npx tsc --noEmit -p .` → limpio.
- [ ] **Step 5: Commit.**

```bash
git add apps/hub-api/src/ausencias/repo/kpis.ts apps/hub-api/src/ausencias/repo.planificacion.db.test.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): la planificacion de vacaciones sabe quien esta de vacaciones hoy"
```

---

### Task 2: El motor — `descansoPorPersona`

**Files:** `apps/hub-api/src/ausencias/kpis.ts` (sección nueva detrás de la de «Acumulación excesiva», ~L234), `apps/hub-api/src/ausencias/kpis.test.ts`.

- [ ] **Step 1: Tests que fallan.** Añade `descansoPorPersona` y `mesesDesde` al import de `kpis.test.ts` y, al final:

```ts
describe('descansoPorPersona', () => {
  const HOY = '2026-11-12';
  const ficha = (empleadoId: string, nombreCompleto: string, saldo = 10) => ({ empleadoId, nombreCompleto, saldo });
  const plan = (
    ultimasVacaciones: string | null,
    extra: { diasProgramados?: number; deVacacionesAhora?: boolean } = {},
  ) => ({ ultimasVacaciones, diasProgramados: 0, deVacacionesAhora: false, ...extra });
  type Plan = ReturnType<typeof plan>;
  const calcular = (fichas: ReturnType<typeof ficha>[], planes: [string, Plan][]) =>
    descansoPorPersona(fichas, new Map(planes), HOY, 6, 12);
  const tramoDe = (r: ReturnType<typeof calcular>, id: string) => r.filas.find((f) => f.empleadoId === id)?.tramo;

  it('mesesDesde: 365 días son 12 meses y 183 son 6', () => {
    expect(mesesDesde(365)).toBe(12);
    expect(mesesDesde(364)).toBe(11);
    expect(mesesDesde(183)).toBe(6);
    expect(mesesDesde(182)).toBe(5);
  });

  it('los cinco tramos', () => {
    const r = calcular(
      [ficha('n', 'Nunca'), ficha('a', 'Alarma'), ficha('v', 'Aviso'), ficha('o', 'Ok'), ficha('h', 'Ahora')],
      [
        ['n', plan(null)],
        ['a', plan('2025-11-12')], // 365 días
        ['v', plan('2026-05-13')], // 183 días
        ['o', plan('2026-05-14')], // 182 días
        ['h', plan('2026-01-10', { deVacacionesAhora: true })],
      ],
    );
    expect(['n', 'a', 'v', 'o', 'h'].map((id) => tramoDe(r, id))).toEqual(['nunca', 'alarma', 'aviso', 'ok', 'ahora']);
  });

  it('CANDADO: los bordes de 6 y 12 meses caen donde dice la etiqueta', () => {
    const r = calcular(
      [ficha('a', 'A'), ficha('b', 'B')],
      [
        ['a', plan('2025-11-13')], // 364 días → 11 meses → aviso
        ['b', plan('2025-11-12')], // 365 días → 12 meses → alarma
      ],
    );
    expect(r.filas.find((f) => f.empleadoId === 'a')).toMatchObject({ diasSinVacaciones: 364, mesesSinVacaciones: 11, tramo: 'aviso' });
    expect(r.filas.find((f) => f.empleadoId === 'b')).toMatchObject({ diasSinVacaciones: 365, mesesSinVacaciones: 12, tramo: 'alarma' });
  });

  it('CANDADO: quien está de vacaciones hoy es «ahora», aunque sus últimas terminadas sean viejas', () => {
    const r = calcular([ficha('h', 'Ahora')], [['h', plan('2024-01-10', { deVacacionesAhora: true })]]);
    expect(tramoDe(r, 'h')).toBe('ahora');
  });

  it('una ficha sin planificación es «nunca», sin nada pedido', () => {
    const r = calcular([ficha('x', 'Sin plan')], []);
    expect(r.filas[0]).toMatchObject({ tramo: 'nunca', diasSinVacaciones: null, mesesSinVacaciones: null, ultimoDia: null, diasProgramados: 0 });
  });

  it('orden: nunca primero, luego de más a menos días, «ahora» al final; empate por nombre', () => {
    const r = calcular(
      [ficha('h', 'Hugo'), ficha('o', 'Olga'), ficha('n', 'Nora'), ficha('b2', 'Beto'), ficha('b1', 'Ana')],
      [
        ['h', plan('2026-01-10', { deVacacionesAhora: true })],
        ['o', plan('2026-10-01')],
        ['n', plan(null)],
        ['b2', plan('2025-06-01')],
        ['b1', plan('2025-06-01')],
      ],
    );
    expect(r.filas.map((f) => f.nombreCompleto)).toEqual(['Nora', 'Ana', 'Beto', 'Olga', 'Hugo']);
  });

  it('CANDADO: los contadores meten «nunca» en alarma y «ahora» en ok', () => {
    const r = calcular(
      [ficha('n', 'N'), ficha('a', 'A'), ficha('v', 'V'), ficha('o', 'O'), ficha('h', 'H')],
      [
        ['n', plan(null)],
        ['a', plan('2025-01-01')],
        ['v', plan('2026-03-01')],
        ['o', plan('2026-10-01')],
        ['h', plan('2026-01-10', { deVacacionesAhora: true })],
      ],
    );
    expect(r.conteo).toEqual({ alarma: 2, aviso: 1, ok: 2 });
    expect(r).toMatchObject({ umbralAvisoMeses: 6, umbralAlarmaMeses: 12 });
  });

  it('lleva el saldo con un decimal, el último día y lo ya pedido', () => {
    const r = calcular([ficha('a', 'A', 28.76)], [['a', plan('2026-10-01', { diasProgramados: 15 })]]);
    expect(r.filas[0]).toMatchObject({ saldo: 28.8, ultimoDia: '2026-10-01', diasProgramados: 15, deVacacionesAhora: false });
  });
});
```

- [ ] **Step 2: Verlos fallar.** `npx vitest run src/ausencias/kpis.test.ts` → `descansoPorPersona is not a function`.

- [ ] **Step 3: Implementar** en `kpis.ts`, sección nueva justo detrás de `acumulacionExcesiva`:

```ts
// ── Descanso ───────────────────────────────────────────────────────────────

export type TramoDeDescanso = 'nunca' | 'alarma' | 'aviso' | 'ok' | 'ahora';

/** Cuánto lleva una persona sin descansar, ya clasificado. */
export interface FichaDeDescanso {
  empleadoId: string;
  nombreCompleto: string;
  tramo: TramoDeDescanso;
  /** Días de calendario desde el fin de sus últimas vacaciones; `null` = nunca. */
  diasSinVacaciones: number | null;
  /** `floor(dias × 12 / 365)`; `null` = nunca. Decide el tramo y el texto. */
  mesesSinVacaciones: number | null;
  /** Fin de sus últimas vacaciones ya disfrutadas, `YYYY-MM-DD`. */
  ultimoDia: string | null;
  deVacacionesAhora: boolean;
  /** Días hábiles de vacaciones ya pedidos hacia adelante. */
  diasProgramados: number;
  /** Días de vacaciones disponibles, un decimal. */
  saldo: number;
}

export interface Descanso {
  filas: FichaDeDescanso[];
  /** `nunca` cuenta en alarma (es lo más grave) y `ahora` en ok (está descansando). */
  conteo: { alarma: number; aviso: number; ok: number };
  /** Los umbrales aplicados, para que la pantalla los diga sin reinventarlos. */
  umbralAvisoMeses: number;
  umbralAlarmaMeses: number;
}

/** Lo que la tarjeta necesita de `repo.planificacionDeVacaciones`. */
export interface PlanDeDescanso {
  ultimasVacaciones: string | null;
  diasProgramados: number;
  deVacacionesAhora: boolean;
}

/**
 * Meses completos en unos días: `floor(dias × 12 / 365)`. Con esta fórmula 365
 * días son exactamente 12 meses y 183 son 6, así que el tramo y la etiqueta
 * («hace 12 meses») no pueden discrepar en el borde, que es donde se miran.
 */
export function mesesDesde(dias: number): number {
  return Math.floor((dias * 12) / 365);
}

/** `nunca` arriba (lo más grave), `ahora` abajo (está descansando), el resto en medio. */
const ORDEN_DE_TRAMO: Record<TramoDeDescanso, number> = { nunca: 0, alarma: 1, aviso: 1, ok: 1, ahora: 2 };

/**
 * Cuánto lleva cada persona de la plantilla activa sin descansar, del que más
 * tiempo lleva al que está de vacaciones ahora.
 *
 * Solo cuentan las vacaciones: un compensatorio o un permiso no son un descanso
 * largo. `null` en los días es «nunca», no «hoy» (ver `diasDesde`).
 */
export function descansoPorPersona(
  fichas: { empleadoId: string; nombreCompleto: string; saldo: number }[],
  planes: Map<string, PlanDeDescanso>,
  hoy: string,
  umbralAvisoMeses: number,
  umbralAlarmaMeses: number,
): Descanso {
  const filas: FichaDeDescanso[] = fichas.map((f) => {
    const plan = planes.get(f.empleadoId);
    const ultimoDia = plan?.ultimasVacaciones ?? null;
    const dias = diasDesde(ultimoDia, hoy);
    const meses = dias === null ? null : mesesDesde(dias);
    const ahora = plan?.deVacacionesAhora ?? false;
    const tramo: TramoDeDescanso = ahora
      ? 'ahora'
      : meses === null
        ? 'nunca'
        : meses >= umbralAlarmaMeses
          ? 'alarma'
          : meses >= umbralAvisoMeses
            ? 'aviso'
            : 'ok';
    return {
      empleadoId: f.empleadoId,
      nombreCompleto: f.nombreCompleto,
      tramo,
      diasSinVacaciones: dias,
      mesesSinVacaciones: meses,
      ultimoDia,
      deVacacionesAhora: ahora,
      diasProgramados: plan?.diasProgramados ?? 0,
      saldo: redondear(f.saldo),
    };
  });

  filas.sort(
    (a, b) =>
      ORDEN_DE_TRAMO[a.tramo] - ORDEN_DE_TRAMO[b.tramo] ||
      (b.diasSinVacaciones ?? 0) - (a.diasSinVacaciones ?? 0) ||
      a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'),
  );

  const cuantos = (...tramos: TramoDeDescanso[]) => filas.filter((f) => tramos.includes(f.tramo)).length;
  return {
    filas,
    conteo: { alarma: cuantos('alarma', 'nunca'), aviso: cuantos('aviso'), ok: cuantos('ok', 'ahora') },
    umbralAvisoMeses,
    umbralAlarmaMeses,
  };
}
```

- [ ] **Step 4: Verde.** `npx vitest run src/ausencias/kpis.test.ts` → PASS; `npx tsc --noEmit -p .` → limpio.
- [ ] **Step 5: Commit.**

```bash
git add apps/hub-api/src/ausencias/kpis.ts apps/hub-api/src/ausencias/kpis.test.ts
git commit -m "feat(ausencias): el motor de kpis calcula cuanto lleva cada uno sin descansar"
```

---

### Task 3: La respuesta de los KPIs lo lleva

**Files:** `apps/hub-api/src/ausencias/service/kpis.ts`, `apps/hub-api/src/ausencias/router.test.ts`.

- [ ] **Step 1: Test de ruta que falla.** En `describe('GET /ausencias/kpis')`, detrás de los tests del resumen por persona:

```ts
  it('el descanso trae a toda la plantilla, de quien nunca descansó a quien está de vacaciones', async () => {
    const correo = conLlave();
    estado.planificacionKpi = [
      { empleadoId: E1, ultimasVacaciones: null, diasProgramados: 0 },
      { empleadoId: E2, ultimasVacaciones: '2025-12-19', diasProgramados: 0, deVacacionesAhora: true },
    ];
    const r = await pedir(token({ sub: correo })).expect(200);
    expect(r.body.descanso.filas.map((f: { nombreCompleto: string; tramo: string }) => [f.nombreCompleto, f.tramo])).toEqual([
      ['Ana Ruiz Molina', 'nunca'],
      ['Luis Prieto Cano', 'ahora'],
    ]);
    expect(r.body.descanso).toMatchObject({ conteo: { alarma: 1, aviso: 0, ok: 1 }, umbralAvisoMeses: 6, umbralAlarmaMeses: 12 });
  });
```

- [ ] **Step 2: Verlo fallar.** `npx vitest run src/ausencias/router.test.ts -t "el descanso"` → falla (`descanso` undefined).

- [ ] **Step 3: Implementar** en `service/kpis.ts`:

3a. Añade `descansoPorPersona` y `type Descanso` al import de `'../kpis.js'`.

3b. Junto a `UMBRAL_ACUMULACION_*`:

```ts
/**
 * Los tramos de la tarjeta de descanso, EN MESES desde las últimas vacaciones:
 * medio año ya es para preguntar; un año, para actuar. Van en meses y no en días
 * para que coincidan con lo que la tarjeta escribe («hace 12 meses»).
 */
const UMBRAL_DESCANSO_AVISO_MESES = 6;
const UMBRAL_DESCANSO_ALARMA_MESES = 12;
```

3c. En la interfaz `Kpis`, detrás de `acumulacion`:

```ts
  /**
   * Cuánto lleva cada persona de la plantilla activa sin descansar. Es una foto
   * de HOY, como `acumulacion`: no la mueve el selector de año.
   */
  descanso: Descanso;
```

3d. En el `return`, detrás de `acumulacion: …`:

```ts
    // Misma lista `saldos` y misma planificación que la acumulación, sin
    // consulta añadida.
    descanso: descansoPorPersona(
      saldos.map((s) => ({ empleadoId: s.empleadoId, nombreCompleto: s.nombreCompleto, saldo: s.saldo.disponible })),
      porEmpleado,
      hoy,
      UMBRAL_DESCANSO_AVISO_MESES,
      UMBRAL_DESCANSO_ALARMA_MESES,
    ),
```

- [ ] **Step 4: Verde.** `npx vitest run src/ausencias/router.test.ts src/ausencias/kpis.test.ts` → PASS; `npx tsc --noEmit -p .`; `npx vitest run --coverage --exclude "scripts/**"` → en verde y sin incumplir umbrales.
- [ ] **Step 5: Commit.**

```bash
git add apps/hub-api/src/ausencias/service/kpis.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): la respuesta de los kpis trae cuanto lleva cada uno sin descansar"
```

---

### Task 4: Front — tipos y textos

**Files:** `apps/ausencias/src/api/kpis.ts`, `apps/ausencias/src/descanso.ts` (nuevo), `apps/ausencias/src/descanso.test.ts` (nuevo).

- [ ] **Step 1: Test que falla.** `apps/ausencias/src/descanso.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fechaConMes, textoDeDescanso } from './descanso';

const f = (tramo: 'nunca' | 'alarma' | 'aviso' | 'ok' | 'ahora', dias: number | null, meses: number | null) => ({
  tramo,
  diasSinVacaciones: dias,
  mesesSinVacaciones: meses,
});

describe('textoDeDescanso', () => {
  it('de vacaciones ahora y sin vacaciones registradas', () => {
    expect(textoDeDescanso(f('ahora', 200, 6))).toBe('de vacaciones ahora');
    expect(textoDeDescanso(f('nunca', null, null))).toBe('sin vacaciones registradas');
  });

  it('en días por debajo de 60', () => {
    expect(textoDeDescanso(f('ok', 1, 0))).toBe('hace 1 día');
    expect(textoDeDescanso(f('ok', 34, 1))).toBe('hace 34 días');
  });

  it('CANDADO: en meses desde 60 días, con los meses que manda el servidor', () => {
    expect(textoDeDescanso(f('ok', 60, 1))).toBe('hace 1 mes');
    expect(textoDeDescanso(f('alarma', 365, 12))).toBe('hace 12 meses');
    expect(textoDeDescanso(f('alarma', 700, 23))).toBe('hace 23 meses');
  });

  it('en años desde 24 meses', () => {
    expect(textoDeDescanso(f('alarma', 760, 24))).toBe('hace 2 años');
  });
});

describe('fechaConMes', () => {
  it('YYYY-MM-DD a «3 oct 2026»', () => {
    expect(fechaConMes('2026-10-03')).toBe('3 oct 2026');
    expect(fechaConMes('2025-01-15')).toBe('15 ene 2025');
  });
});
```

- [ ] **Step 2: Verlo fallar.** `npx vitest run src/descanso.test.ts` → no encuentra `./descanso`.

- [ ] **Step 3: Implementar.**

3a. `apps/ausencias/src/api/kpis.ts`, detrás de la interfaz `AcumulacionExcesiva`:

```ts
/** Espejo de `TramoDeDescanso` de hub-api. */
export type TramoDeDescanso = 'nunca' | 'alarma' | 'aviso' | 'ok' | 'ahora';

/** Cuánto lleva una persona sin descansar. Espejo de `FichaDeDescanso` de hub-api. */
export interface FichaDeDescanso {
  empleadoId: string;
  nombreCompleto: string;
  tramo: TramoDeDescanso;
  /** Días de calendario desde sus últimas vacaciones; `null` = nunca. */
  diasSinVacaciones: number | null;
  /** Meses completos (`floor(dias × 12 / 365)`); `null` = nunca. */
  mesesSinVacaciones: number | null;
  /** `YYYY-MM-DD`. */
  ultimoDia: string | null;
  deVacacionesAhora: boolean;
  diasProgramados: number;
  saldo: number;
}

export interface Descanso {
  filas: FichaDeDescanso[];
  conteo: { alarma: number; aviso: number; ok: number };
  umbralAvisoMeses: number;
  umbralAlarmaMeses: number;
}
```

y en `Kpis`, detrás de `acumulacion`, el campo **opcional**:

```ts
  /** Opcional: si el portal llega antes que hub-api, la sección no se pinta. */
  descanso?: Descanso;
```

3b. `apps/ausencias/src/descanso.ts`:

```ts
import type { FichaDeDescanso, TramoDeDescanso } from './api';

// La tarjeta «Cuánto lleva cada uno sin descansar»: lo que se decide sin
// pantalla. El tramo y los meses vienen hechos de hub-api; aquí solo se
// redactan, para que la etiqueta y el color salgan del mismo número.

/** Cuánto lleva sin descansar, en la unidad que se entiende de un vistazo. */
export function textoDeDescanso(
  f: Pick<FichaDeDescanso, 'tramo' | 'diasSinVacaciones' | 'mesesSinVacaciones'>,
): string {
  if (f.tramo === 'ahora') return 'de vacaciones ahora';
  if (f.diasSinVacaciones === null || f.mesesSinVacaciones === null) return 'sin vacaciones registradas';
  const dias = f.diasSinVacaciones;
  if (dias < 60) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  const meses = f.mesesSinVacaciones;
  if (meses < 24) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  return `hace ${Math.floor(meses / 12)} años`;
}

/** El color del tiempo según el tramo. «nunca» es lo más grave: rojo, como la alarma. */
export const COLOR_DE_TRAMO: Record<TramoDeDescanso, string> = {
  nunca: 'text-red-600',
  alarma: 'text-red-600',
  aviso: 'text-amber-600',
  ok: 'text-gray-700',
  ahora: 'text-emerald-600',
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * `YYYY-MM-DD` → «3 oct 2026». A mano y no con `toLocaleDateString`: el formato
 * de `es-CO` cambia entre versiones de ICU («3 de oct. de 2026») y aquí cabe
 * poco.
 */
export function fechaConMes(iso: string): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return `${dia} ${MESES[mes - 1]} ${anio}`;
}
```

- [ ] **Step 4: Verde.** `npx vitest run src/descanso.test.ts src/api/barril.test.ts` → PASS; `npm run typecheck` → limpio.
- [ ] **Step 5: Commit.**

```bash
git add apps/ausencias/src/api/kpis.ts apps/ausencias/src/descanso.ts apps/ausencias/src/descanso.test.ts
git commit -m "feat(ausencias): tipos y textos de la tarjeta de descanso en el front"
```

---

### Task 5: Front — la tarjeta

**Files:** `apps/ausencias/src/PanelKpis.tsx`.

- [ ] **Step 1: Implementar.**

1a. Import: `import { COLOR_DE_TRAMO, fechaConMes, textoDeDescanso } from './descanso';`.

1b. En el render principal sustituye `<AcumulacionExcesiva acumulacion={datos.acumulacion} />` por:

```tsx
      {datos.descanso && <SinDescansar descanso={datos.descanso} />}
```

1c. Borra la sección `// ── Acumulación ──` entera: `AcumulacionExcesiva`, `ListaDeFichas` y `textoSinVacaciones` (compruébalo con `grep`: no deben quedar usos). En su lugar:

```tsx
// ── Descanso ───────────────────────────────────────────────────────────────

/**
 * Cuánto lleva cada uno sin descansar: toda la plantilla activa, de quien nunca
 * ha descansado a quien está de vacaciones ahora. Los tramos y los meses los
 * decide hub-api (`descansoPorPersona`); aquí solo se pintan.
 *
 * Sustituye a «Quién acumula de más» (2026-11-12, a petición del usuario).
 * hub-api sigue calculando `acumulacion`.
 */
function SinDescansar({ descanso }: { descanso: NonNullable<Kpis['descanso']> }) {
  const { filas, conteo, umbralAvisoMeses, umbralAlarmaMeses } = descanso;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Users className="h-4 w-4 text-gray-400" />
        Cuánto lleva cada uno sin descansar
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Tiempo desde el último día de vacaciones ya disfrutadas. Solo cuentan las vacaciones: un compensatorio o un
        permiso no son un descanso largo.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Cifra
          etiqueta={`Más de ${umbralAlarmaMeses} meses`}
          valor={String(conteo.alarma)}
          detalle="o sin vacaciones registradas"
          alarma={conteo.alarma > 0}
        />
        <Cifra etiqueta={`De ${umbralAvisoMeses} a ${umbralAlarmaMeses} meses`} valor={String(conteo.aviso)} />
        <Cifra etiqueta={`Menos de ${umbralAvisoMeses} meses`} valor={String(conteo.ok)} detalle="o de vacaciones ahora" />
      </div>

      <ul className="mt-4 divide-y divide-gray-100">
        {filas.map((f) => (
          <li key={f.empleadoId} className="py-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="truncate text-gray-900">{f.nombreCompleto}</span>
              <span className={`shrink-0 font-medium tabular-nums ${COLOR_DE_TRAMO[f.tramo]}`}>{textoDeDescanso(f)}</span>
            </div>
            {/* El último día, el saldo y lo ya pedido van juntos: «lleva un año
                sin descansar y no tiene nada previsto» es un caso sobre el que
                actuar; «lleva un año pero ya tiene 15 días pedidos», no. */}
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
              {f.ultimoDia && <span>último día: {fechaConMes(f.ultimoDia)}</span>}
              <span>saldo {formatDias(f.saldo)} días</span>
              {/* Para quien está de vacaciones ahora, «sin nada previsto»
                  sonaría a alarma y es lo contrario: se omite. */}
              {f.tramo !== 'ahora' &&
                (f.diasProgramados > 0 ? (
                  <span className="text-emerald-600">{formatDias(f.diasProgramados)} días ya pedidos</span>
                ) : (
                  <span className="text-amber-600">sin nada previsto</span>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

1d. En el mapa de preguntas de la cabecera del fichero, la línea de «¿Quién lo concentra?» pasa a `//  2. ¿Quién lleva más sin descansar? → el tiempo desde las últimas vacaciones de cada uno.`, respetando la alineación de las demás.

- [ ] **Step 2: Verde.** `npm run typecheck`, `npm test`, `npm run build` → en verde. Repasa: sin alturas en %, tildes intactas.
- [ ] **Step 3: Commit.**

```bash
git add apps/ausencias/src/PanelKpis.tsx
git commit -m "feat(ausencias): la tarjeta de los kpis pasa a cuanto lleva cada uno sin descansar"
```

---

### Task 6: Falsar, verificar y entregar

- [ ] **Step 1: Mutaciones** (con Edit; una cada vez; revertir con `git checkout -- <fichero>`; hashes iguales al final):

| # | Fichero | Mutación | Comando | Debe caer |
|---|---|---|---|---|
| 1 | `repo/kpis.ts` | Quitar `AND a.fecha_fin >= $1::date` | BD `src/ausencias/repo.planificacion.db.test.ts` | «no con unas ya terminadas ni con unas futuras» |
| 2 | `kpis.ts` | `mesesDesde` → `Math.floor(dias / 30)` | `npx vitest run src/ausencias/kpis.test.ts` | «los bordes de 6 y 12 meses…» y `mesesDesde` |
| 3 | `kpis.ts` | Quitar la rama `ahora ? 'ahora' :` del cálculo del tramo | igual | «quien está de vacaciones hoy es «ahora»…» |
| 4 | `kpis.ts` | Contador de alarma sin `'nunca'` | igual | «los contadores meten «nunca» en alarma…» |
| 5 | `service/kpis.ts` | Pasar `new Map()` en vez de `porEmpleado` | `npx vitest run src/ausencias/router.test.ts -t "el descanso"` | el test de la ruta |
| 6 | `apps/ausencias/src/descanso.ts` | Quitar el `if (dias < 60)` | `npx vitest run src/descanso.test.ts` (desde apps/ausencias) | «en días por debajo de 60» |

- [ ] **Step 2: Suites completas.** hub-api: tsc, cobertura (`--exclude "scripts/**"`), `npm run test:db`. Front: typecheck, test, build.
- [ ] **Step 3: Spec.** **Estado** → «implementado; pendiente de desplegar hub-api y el portal». Commit con el plan: `docs(ausencias): la especificacion de la tarjeta de descanso refleja lo construido`.
- [ ] **Step 4: Entregar.** Comprobar que la rama no publica qué cuenta es admin (`git log -p main..feat/kpis-descanso | grep '^[+-]' | grep -c 'comercial@ambientalia'` = 0); `git switch main`, `git pull --ff-only`, `git merge --no-ff feat/kpis-descanso -m "merge: kpis, cuanto lleva cada uno sin descansar"`, `git push origin main`, `git branch -d feat/kpis-descanso`. Avisar: hub-api primero, portal después.
