# KPIs: resumen por persona — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tabla «Resumen por persona» en la pestaña KPIs: una fila por trabajador con vacaciones, compensatorios e incapacidades en días laborables y permisos en horas (más los de día completo aparte), filtrada por el selector «Periodo» del panel.

**Architecture:** hub-api añade `hora_inicio`/`hora_fin` a la consulta que ya alimenta la estacionalidad (`repo.ausenciasParaKpi`), una función pura `resumenPorPersona` en `kpis.ts` que agrupa por persona con el mismo reparto por meses que la gráfica (`tramosPorMes`), y un campo nuevo `resumenPorPersona` en la respuesta de `GET /api/ausencias/kpis`. El front añade el tipo, un módulo puro de formato con tests y una sección en `PanelKpis.tsx`.

**Tech Stack:** Express 4 + TypeScript ESM, SQL crudo, Vitest (+ testcontainers en `*.db.test.ts`); React 19 + Tailwind + lucide-react.

**Especificación:** `docs/superpowers/specs/2026-11-12-kpis-resumen-por-persona-design.md`.

---

## Convenciones (TODAS las tareas)

- Rama `feat/kpis-resumen-por-persona` (ya creada, con la spec). Nunca `git add -A`: rutas explícitas.
- Commits en español, **sin tildes**, **sin línea de atribución**.
- Comentarios con tildes y explicando el porqué; los `.db.test.ts`, sin tildes.
- ⚠️ Nunca `Set-Content`, `sed -i` ni `perl -pi` para editar (corrompen las tildes): solo Edit/Write. Tampoco para mutaciones temporales.
- hub-api: comandos desde `apps/hub-api`. Unitarios `npx vitest run <ruta>`; BD `npx vitest run --config vitest.db.config.ts <ruta>` (Docker; si falla `docker info`: `Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"`). No lanzar vitest desde la raíz.
- `npm test` de hub-api falla ya en `main` por `scripts/equipos-anonimizar.test.mjs` (shebang con CRLF en Windows): ajeno. Para la cobertura usar `npx vitest run --coverage --exclude "scripts/**"`.
- Front: desde `apps/ausencias`: `npm run typecheck`, `npm test`, `npm run build`.

## Recorte del periodo (leer antes de la Task 2)

El resumen recorta por **meses completos**, del mes de `general.desde` al mes de `general.hasta`, con `tramosPorMes`: es exactamente lo que hace la gráfica de estacionalidad, así que tabla y gráfica cuadran. La consulta solo trae ausencias que empiezan como muy tarde hoy, de modo que no entran meses futuros. Una ausencia que cruza el cambio de año solo suma los días del año elegido.

## Mapa de ficheros

| Fichero | Acción |
|---|---|
| `apps/hub-api/src/ausencias/kpis.ts` | `AusenciaParaKpi` con horas opcionales; `resumenPorPersona` y sus tipos |
| `apps/hub-api/src/ausencias/repo/kpis.ts` | `ausenciasParaKpi` trae las horas |
| `apps/hub-api/src/ausencias/repo.estacionalidad.db.test.ts` | Test de las horas |
| `apps/hub-api/src/ausencias/kpis.test.ts` | Unitarios de `resumenPorPersona` |
| `apps/hub-api/src/ausencias/service/kpis.ts` | Campo `resumenPorPersona` en `Kpis` y en la respuesta |
| `apps/hub-api/src/ausencias/router.test.ts` | Tipo de `estado.ausenciasKpi` + test de la ruta |
| `apps/ausencias/src/api/kpis.ts` | Tipos espejo |
| `apps/ausencias/src/resumenKpis.ts` + `.test.ts` | Formato de celdas y rótulo del periodo |
| `apps/ausencias/src/PanelKpis.tsx` | La sección |

---

### Task 1: La consulta trae las horas de los permisos

**Files:** `apps/hub-api/src/ausencias/kpis.ts` (interfaz `AusenciaParaKpi`, ~L368-375), `apps/hub-api/src/ausencias/repo/kpis.ts` (`ausenciasParaKpi`, ~L155-186), `apps/hub-api/src/ausencias/repo.estacionalidad.db.test.ts`.

- [ ] **Step 1: Test de BD que falla.** Al final del `describe` principal de `repo.estacionalidad.db.test.ts` (sin tildes):

```ts
  it('trae las horas de un permiso con hora y null en el resto', async () => {
    // El resumen por persona cuenta los permisos en horas: sin estas dos
    // columnas solo podria contarlos en dias.
    await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'aprobada',
      tipo: 'permiso',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      segundoAprobadorCorreo: null,
      horaInicio: '09:00',
      horaFin: '11:30',
    });
    await sembrar('vacaciones', 'aprobada', '2026-09-07', '2026-09-11');
    const filas = await ausenciasParaKpi(db, '2026-09-01', '2026-09-30');
    expect(filas.map((f) => [f.tipo, f.horaInicio, f.horaFin])).toEqual([
      ['permiso', '09:00', '11:30'],
      ['vacaciones', null, null],
    ]);
  });
```

- [ ] **Step 2: Verlo fallar.** `npx vitest run --config vitest.db.config.ts src/ausencias/repo.estacionalidad.db.test.ts` → falla (`horaInicio` es `undefined`).

- [ ] **Step 3: Implementar.**

3a. En `kpis.ts`, `AusenciaParaKpi` pasa a:

```ts
/** Una ausencia reducida a lo que los KPIs de estacionalidad y del resumen necesitan. */
export interface AusenciaParaKpi {
  tipo: TipoDeAusencia;
  empleadoId: string;
  nombreCompleto: string;
  fechaInicio: string;
  fechaFin: string;
  /**
   * `HH:MM`, solo en un permiso de unas horas (las dos o ninguna: CHECK de la
   * 036). Opcionales para que quien no las necesita —la estacionalidad y sus
   * tests— no tenga que inventarlas.
   */
  horaInicio?: string | null;
  horaFin?: string | null;
}
```

3b. En `repo/kpis.ts`, `ausenciasParaKpi`: añadir al SELECT, detrás de `fecha_fin`,

```sql
            s.fecha_fin::text    AS fecha_fin,
            -- to_char y no ::text: el driver devuelve un TIME como '09:00:00' (mismo
            -- criterio que repo/filas.ts).
            to_char(s.hora_inicio, 'HH24:MI') AS hora_inicio,
            to_char(s.hora_fin,    'HH24:MI') AS hora_fin
```

(quitando la coma que sobre / poniendo la que falte), añadir `hora_inicio: string | null; hora_fin: string | null;` al tipo de la fila, y en el `.map`:

```ts
    horaInicio: r.hora_inicio,
    horaFin: r.hora_fin,
```

Actualizar el JSDoc de `ausenciasParaKpi` con una línea: también la usa el resumen por persona, que necesita las horas de los permisos.

- [ ] **Step 4: Verde.** El mismo comando → PASS. `npx tsc --noEmit -p .` → limpio.
- [ ] **Step 5: Commit.**

```bash
git add apps/hub-api/src/ausencias/kpis.ts apps/hub-api/src/ausencias/repo/kpis.ts apps/hub-api/src/ausencias/repo.estacionalidad.db.test.ts
git commit -m "feat(ausencias): la consulta de ausencias de los kpis trae las horas de los permisos"
```

---

### Task 2: El motor — `resumenPorPersona`

**Files:** `apps/hub-api/src/ausencias/kpis.ts` (sección nueva entre el final de Estacionalidad ~L484 y `// ── Fricción ──` ~L486), `apps/hub-api/src/ausencias/kpis.test.ts`.

- [ ] **Step 1: Tests que fallan.** Añadir `resumenPorPersona` al import de `kpis.test.ts` y, al final del fichero:

```ts
describe('resumenPorPersona', () => {
  const ANA = { empleadoId: 'e1', nombreCompleto: 'Ana Ruiz' };
  const BETO = { empleadoId: 'e2', nombreCompleto: 'Beto Díaz' };
  type Tipo = 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad';
  const au = (
    tipo: Tipo,
    quien: { empleadoId: string; nombreCompleto: string },
    fechaInicio: string,
    fechaFin: string,
    horas: [string, string] | null = null,
  ) => ({ tipo, ...quien, fechaInicio, fechaFin, horaInicio: horas?.[0] ?? null, horaFin: horas?.[1] ?? null });
  const ANIO_2026: [string, string] = ['2026-01', '2026-12'];

  it('toda la plantilla activa sale, aunque no tenga nada, en orden alfabético', () => {
    const r = resumenPorPersona([], [BETO, ANA], ...ANIO_2026);
    expect(r.filas.map((f) => f.nombreCompleto)).toEqual(['Ana Ruiz', 'Beto Díaz']);
    expect(r.filas[0]).toEqual({
      ...ANA,
      deBaja: false,
      vacaciones: 0,
      permisoHoras: 0,
      permisoDias: 0,
      compensatorio: 0,
      incapacidad: 0,
    });
  });

  it('suma días laborables por tipo', () => {
    const r = resumenPorPersona(
      [
        au('vacaciones', ANA, '2026-09-07', '2026-09-11'), // lunes a viernes: 5
        au('compensatorio', ANA, '2026-09-14', '2026-09-14'), // 1
        au('incapacidad', ANA, '2026-09-15', '2026-09-16'), // 2
      ],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas[0]).toMatchObject({ vacaciones: 5, compensatorio: 1, incapacidad: 2 });
  });

  it('CANDADO: una ausencia a caballo entre dos años solo suma lo que cae dentro', () => {
    // Lunes 29 de diciembre de 2025 a viernes 2 de enero de 2026: del 29 al 31
    // caen en 2025, el 1 de enero es festivo y solo el 2 cuenta para 2026.
    const r = resumenPorPersona([au('vacaciones', ANA, '2025-12-29', '2026-01-02')], [ANA], ...ANIO_2026);
    expect(r.filas[0].vacaciones).toBe(1);
  });

  it('CANDADO: los permisos con hora suman horas y los de día completo, días aparte', () => {
    const r = resumenPorPersona(
      [
        au('permiso', ANA, '2026-09-01', '2026-09-01', ['09:00', '11:30']), // 2,5 h
        au('permiso', ANA, '2026-09-02', '2026-09-02', ['08:00', '09:15']), // 1,25 h
        au('permiso', ANA, '2026-09-03', '2026-09-03'), // jueves, día completo
      ],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas[0]).toMatchObject({ permisoHoras: 3.8, permisoDias: 1 });
  });

  it('un permiso con hora fuera del periodo no cuenta', () => {
    const r = resumenPorPersona([au('permiso', ANA, '2025-12-10', '2025-12-10', ['09:00', '10:00'])], [ANA], ...ANIO_2026);
    expect(r.filas[0].permisoHoras).toBe(0);
  });

  it('CANDADO: una ficha de baja sale solo si tuvo algo en el periodo, y marcada', () => {
    const ZOE = { empleadoId: 'e9', nombreCompleto: 'Zoe Baja' };
    const XAVI = { empleadoId: 'e8', nombreCompleto: 'Xavi Fuera' };
    const r = resumenPorPersona(
      [au('vacaciones', ZOE, '2026-03-02', '2026-03-02'), au('vacaciones', XAVI, '2025-03-03', '2025-03-03')],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas.map((f) => [f.nombreCompleto, f.deBaja])).toEqual([
      ['Ana Ruiz', false],
      ['Zoe Baja', true],
    ]);
  });

  it('el nombre de una ficha activa es el de la ficha, no el que traiga la ausencia', () => {
    const r = resumenPorPersona(
      [au('vacaciones', { empleadoId: 'e1', nombreCompleto: 'Ana R.' }, '2026-03-02', '2026-03-02')],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ nombreCompleto: 'Ana Ruiz', vacaciones: 1 });
  });

  it('CANDADO: dos personas con el mismo nombre no se funden', () => {
    const OTRA_ANA = { empleadoId: 'e3', nombreCompleto: 'Ana Ruiz' };
    const r = resumenPorPersona([au('vacaciones', OTRA_ANA, '2026-03-02', '2026-03-02')], [ANA, OTRA_ANA], ...ANIO_2026);
    expect(r.filas).toHaveLength(2);
    expect(r.filas.find((f) => f.empleadoId === 'e3')?.vacaciones).toBe(1);
    expect(r.filas.find((f) => f.empleadoId === 'e1')?.vacaciones).toBe(0);
  });

  it('los totales suman las filas', () => {
    const r = resumenPorPersona(
      [
        au('vacaciones', ANA, '2026-09-07', '2026-09-08'), // 2
        au('vacaciones', BETO, '2026-09-09', '2026-09-09'), // 1
        au('permiso', BETO, '2026-09-10', '2026-09-10', ['10:00', '11:30']), // 1,5 h
        au('permiso', ANA, '2026-09-11', '2026-09-11'), // 1 d
        au('incapacidad', BETO, '2026-09-14', '2026-09-14'), // 1
      ],
      [ANA, BETO],
      ...ANIO_2026,
    );
    expect(r.total).toEqual({ vacaciones: 3, permisoHoras: 1.5, permisoDias: 1, compensatorio: 0, incapacidad: 1 });
  });
});
```

- [ ] **Step 2: Verlos fallar.** `npx vitest run src/ausencias/kpis.test.ts` → falla (`resumenPorPersona is not a function`).

- [ ] **Step 3: Implementar** en `kpis.ts`, sección nueva entre el final de `estacionalidadPorMes` y `// ── Fricción ──`:

```ts
// ── Resumen por persona ────────────────────────────────────────────────────

/** Una persona en el resumen: lo que ha tenido de cada tipo en el periodo. */
export interface FilaDeResumen {
  empleadoId: string;
  nombreCompleto: string;
  /** No está en la plantilla activa: sale porque tuvo algo en el periodo. */
  deBaja: boolean;
  /** Días laborables. */
  vacaciones: number;
  /** Horas de los permisos que las tienen. */
  permisoHoras: number;
  /**
   * Días laborables de los permisos SIN horas: los de día completo y todos los
   * anteriores a la migración 036. Van aparte y no convertidos a horas porque la
   * app no conoce la jornada, y suponerla inventaría una cifra.
   */
  permisoDias: number;
  compensatorio: number;
  incapacidad: number;
}

export interface ResumenPorPersona {
  filas: FilaDeResumen[];
  /** Calculado aquí para que la fila de total no pueda discrepar de las de arriba. */
  total: Omit<FilaDeResumen, 'empleadoId' | 'nombreCompleto' | 'deBaja'>;
}

/**
 * Lo que ha tenido cada persona de cada tipo de ausencia en el periodo.
 *
 * Recorta por meses completos con `tramosPorMes`, el mismo reparto que la
 * estacionalidad: tabla y gráfica salen de las mismas ausencias y cuadran.
 *
 * Toda la plantilla activa sale aunque no tenga nada —ver quién no ha pedido
 * nada también es información—, y las fichas de baja solo si tuvieron algo en
 * el periodo. Se agrupa por id y no por nombre: dos personas pueden llamarse
 * igual. El nombre de una ficha activa es el de la ficha, no el que traiga la
 * ausencia.
 */
export function resumenPorPersona(
  ausencias: AusenciaParaKpi[],
  activos: { empleadoId: string; nombreCompleto: string }[],
  desdeMes: string,
  hastaMes: string,
): ResumenPorPersona {
  const meses = mesesEntre(desdeMes, hastaMes);
  const vacia = (empleadoId: string, nombreCompleto: string, deBaja: boolean): FilaDeResumen => ({
    empleadoId,
    nombreCompleto,
    deBaja,
    vacaciones: 0,
    permisoHoras: 0,
    permisoDias: 0,
    compensatorio: 0,
    incapacidad: 0,
  });
  const porId = new Map(activos.map((e) => [e.empleadoId, vacia(e.empleadoId, e.nombreCompleto, false)]));

  for (const au of ausencias) {
    const tramos = tramosPorMes(au.fechaInicio, au.fechaFin, meses);
    // Fuera del periodo entera: no suma, y una ficha de baja no gana fila por ella.
    if (tramos.length === 0) continue;
    let fila = porId.get(au.empleadoId);
    if (!fila) {
      fila = vacia(au.empleadoId, au.nombreCompleto, true);
      porId.set(au.empleadoId, fila);
    }
    if (au.tipo === 'permiso' && au.horaInicio && au.horaFin) {
      fila.permisoHoras += horasDelPermiso(au.horaInicio, au.horaFin);
      continue;
    }
    const dias = tramos.reduce((s, [, d]) => s + d, 0);
    if (au.tipo === 'permiso') fila.permisoDias += dias;
    else fila[au.tipo] += dias;
  }

  const filas = [...porId.values()]
    .map((f) => ({
      ...f,
      vacaciones: redondear(f.vacaciones),
      permisoHoras: redondear(f.permisoHoras),
      permisoDias: redondear(f.permisoDias),
      compensatorio: redondear(f.compensatorio),
      incapacidad: redondear(f.incapacidad),
    }))
    .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es') || a.empleadoId.localeCompare(b.empleadoId));

  const suma = (clave: keyof ResumenPorPersona['total']) => redondear(filas.reduce((s, f) => s + f[clave], 0));
  return {
    filas,
    total: {
      vacaciones: suma('vacaciones'),
      permisoHoras: suma('permisoHoras'),
      permisoDias: suma('permisoDias'),
      compensatorio: suma('compensatorio'),
      incapacidad: suma('incapacidad'),
    },
  };
}

/** Las horas entre dos `HH:MM` del mismo día. El CHECK de la 036 garantiza fin > inicio. */
function horasDelPermiso(inicio: string, fin: string): number {
  const minutos = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  return (minutos(fin) - minutos(inicio)) / 60;
}
```

- [ ] **Step 4: Verde.** `npx vitest run src/ausencias/kpis.test.ts` → PASS. `npx tsc --noEmit -p .` → limpio.
- [ ] **Step 5: Commit.**

```bash
git add apps/hub-api/src/ausencias/kpis.ts apps/hub-api/src/ausencias/kpis.test.ts
git commit -m "feat(ausencias): el motor de kpis calcula el resumen por persona"
```

---

### Task 3: La respuesta de los KPIs lo lleva

**Files:** `apps/hub-api/src/ausencias/service/kpis.ts`, `apps/hub-api/src/ausencias/router.test.ts`.

- [ ] **Step 1: Test de ruta que falla.**

1a. En `router.test.ts`, en el tipo de `estado.ausenciasKpi` (~L214-221), añadir tras `fechaFin: string;`:

```ts
    horaInicio?: string | null;
    horaFin?: string | null;
```

1b. En `describe('GET /ausencias/kpis')`, detrás del test «los días de ausencia llegan desglosados por tipo y el total cuadra» (~L5310-5339):

```ts
  it('el resumen por persona trae a toda la plantilla, las horas de los permisos y las fichas de baja', async () => {
    const correo = conLlave();
    const mesActual = new Date().toISOString().slice(0, 7);
    const lunes = primerLunesDe(mesActual);
    estado.ausenciasKpi = [
      { tipo: 'vacaciones', empleadoId: E1, nombreCompleto: 'Ana Ruiz', fechaInicio: lunes, fechaFin: sumaDias(lunes, 1) },
      {
        tipo: 'permiso',
        empleadoId: E1,
        nombreCompleto: 'Ana Ruiz',
        fechaInicio: sumaDias(lunes, 3),
        fechaFin: sumaDias(lunes, 3),
        horaInicio: '09:00',
        horaFin: '11:30',
      },
      // E_FANTASMA no está en la plantilla: hace de ficha dada de baja.
      { tipo: 'incapacidad', empleadoId: E_FANTASMA, nombreCompleto: 'Carla Baja', fechaInicio: sumaDias(lunes, 2), fechaFin: sumaDias(lunes, 2) },
    ];

    const r = await pedir(token({ sub: correo })).expect(200);
    const filas = r.body.resumenPorPersona.filas as Record<string, unknown>[];
    // El nombre de una ficha activa es el de la plantilla, no el de la ausencia.
    expect(filas.map((f) => [f.nombreCompleto, f.deBaja])).toEqual([
      ['Ana Ruiz Molina', false],
      ['Carla Baja', true],
      ['Luis Prieto Cano', false],
    ]);
    expect(filas[0]).toMatchObject({ vacaciones: 2, permisoHoras: 2.5, permisoDias: 0 });
    expect(filas[1]).toMatchObject({ incapacidad: 1 });
    expect(r.body.resumenPorPersona.total).toEqual({
      vacaciones: 2,
      permisoHoras: 2.5,
      permisoDias: 0,
      compensatorio: 0,
      incapacidad: 1,
    });
  });
```

(Si los nombres de E1/E2 en la plantilla por defecto no son «Ana Ruiz Molina» y «Luis Prieto Cano», ajústalos a los reales leyendo el `beforeEach` de nivel superior; el test comprueba que se usa el de la plantilla.)

- [ ] **Step 2: Verlo fallar.** `npx vitest run src/ausencias/router.test.ts -t "resumen por persona"` → falla (`resumenPorPersona` undefined).

- [ ] **Step 3: Implementar** en `service/kpis.ts`:

3a. Añadir `resumenPorPersona` y `type ResumenPorPersona` al import de `'../kpis.js'`.

3b. En la interfaz `Kpis`, detrás de `estacionalidad: Estacionalidad;`:

```ts
  /**
   * Lo que ha tenido cada persona de cada tipo en el periodo. Sale de las MISMAS
   * ausencias que la estacionalidad, recortadas a la ventana general (meses
   * completos), así que la tabla y la gráfica cuadran en un año concreto.
   */
  resumenPorPersona: ResumenPorPersona;
```

3c. En el `return`, detrás de `estacionalidad: estacionalidadPorMes(...)`:

```ts
    // Las ausencias de la estacionalidad sirven tal cual: su ventana siempre
    // contiene la general (24 meses frente a 12, o el mismo año). La plantilla
    // activa es `empleados`, la misma lista del pasivo.
    resumenPorPersona: resumenPorPersona(
      ausencias,
      empleados,
      general.desde.slice(0, 7),
      general.hasta.slice(0, 7),
    ),
```

- [ ] **Step 4: Verde.** `npx vitest run src/ausencias/router.test.ts src/ausencias/kpis.test.ts` → PASS. `npx tsc --noEmit -p .` → limpio. `npx vitest run --coverage --exclude "scripts/**"` → en verde y sin incumplir umbrales.
- [ ] **Step 5: Commit.**

```bash
git add apps/hub-api/src/ausencias/service/kpis.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): la respuesta de los kpis trae el resumen por persona"
```

---

### Task 4: Front — tipos y formato

**Files:** `apps/ausencias/src/api/kpis.ts`, `apps/ausencias/src/resumenKpis.ts` (nuevo), `apps/ausencias/src/resumenKpis.test.ts` (nuevo).

- [ ] **Step 1: Test que falla.** `apps/ausencias/src/resumenKpis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { celdaDeDias, celdaDePermisos, rotuloDelPeriodo } from './resumenKpis';

describe('celdaDePermisos', () => {
  it('solo horas, solo días, las dos cosas o nada', () => {
    expect(celdaDePermisos(2.5, 0)).toBe('2,5 h');
    expect(celdaDePermisos(0, 2)).toBe('2 d');
    expect(celdaDePermisos(6.5, 1)).toBe('6,5 h + 1 d');
    expect(celdaDePermisos(0, 0)).toBe('—');
  });
});

describe('celdaDeDias', () => {
  it('el número con coma decimal, o «—» si es cero', () => {
    expect(celdaDeDias(12)).toBe('12');
    expect(celdaDeDias(0.5)).toBe('0,5');
    expect(celdaDeDias(0)).toBe('—');
  });
});

describe('rotuloDelPeriodo', () => {
  it('el año elegido o la ventana móvil', () => {
    expect(rotuloDelPeriodo(2025)).toBe('en 2025');
    expect(rotuloDelPeriodo(null)).toBe('en los últimos 12 meses');
  });
});
```

- [ ] **Step 2: Verlo fallar.** `npx vitest run src/resumenKpis.test.ts` → no encuentra `./resumenKpis`.

- [ ] **Step 3: Implementar.**

3a. `apps/ausencias/src/resumenKpis.ts`:

```ts
import { formatDias } from './dominio';

// El resumen por persona de los KPIs: lo que se decide sin pantalla. Vive aquí,
// con tests, y no dentro de PanelKpis.

/** Un número de días, o «—» si es cero: un 0 en una tabla larga se lee peor. */
export function celdaDeDias(n: number): string {
  return n > 0 ? formatDias(n) : '—';
}

/**
 * La celda de permisos: las horas de los que las tienen y, aparte, los de día
 * completo («6,5 h + 1 d»). Los días no se pasan a horas: la app no conoce la
 * jornada.
 */
export function celdaDePermisos(horas: number, dias: number): string {
  const partes: string[] = [];
  if (horas > 0) partes.push(`${formatDias(horas)} h`);
  if (dias > 0) partes.push(`${formatDias(dias)} d`);
  return partes.length > 0 ? partes.join(' + ') : '—';
}

/** Lo que el título dice del periodo, a partir del `anio` que devuelve el servidor. */
export function rotuloDelPeriodo(anio: number | null): string {
  return anio === null ? 'en los últimos 12 meses' : `en ${anio}`;
}
```

3b. `apps/ausencias/src/api/kpis.ts`: detrás de la interfaz `Estacionalidad`, añadir

```ts
/** Una persona en el resumen por persona. Espejo de `FilaDeResumen` de hub-api. */
export interface FilaDeResumen {
  empleadoId: string;
  nombreCompleto: string;
  deBaja: boolean;
  /** Días laborables. */
  vacaciones: number;
  /** Horas de los permisos que las tienen. */
  permisoHoras: number;
  /** Días laborables de los permisos de día completo (sin horas). */
  permisoDias: number;
  compensatorio: number;
  incapacidad: number;
}

export interface ResumenPorPersona {
  filas: FilaDeResumen[];
  total: Omit<FilaDeResumen, 'empleadoId' | 'nombreCompleto' | 'deBaja'>;
}
```

y en `Kpis`, detrás de `estacionalidad`, el campo **opcional**:

```ts
  /**
   * Opcional a propósito: si el portal se despliega antes que hub-api, la
   * respuesta no lo trae y la sección simplemente no se pinta.
   */
  resumenPorPersona?: ResumenPorPersona;
```

- [ ] **Step 4: Verde.** `npx vitest run src/resumenKpis.test.ts src/api/barril.test.ts` → PASS; `npm run typecheck` → limpio.
- [ ] **Step 5: Commit.**

```bash
git add apps/ausencias/src/api/kpis.ts apps/ausencias/src/resumenKpis.ts apps/ausencias/src/resumenKpis.test.ts
git commit -m "feat(ausencias): tipos y formato del resumen por persona en el front"
```

---

### Task 5: Front — la sección

**Files:** `apps/ausencias/src/PanelKpis.tsx`.

- [ ] **Step 1: Implementar.**

1a. Import: `import { celdaDeDias, celdaDePermisos, rotuloDelPeriodo } from './resumenKpis';` (el icono `Users` ya está importado).

1b. En el render principal, detrás de `<Estacionalidad estacionalidad={datos.estacionalidad} />`:

```tsx
        {datos.resumenPorPersona && <ResumenDeAusencias resumen={datos.resumenPorPersona} anio={datos.anio} />}
```

1c. Componente nuevo, justo detrás de `function Estacionalidad` (antes de la sección de fricción):

```tsx
// ── Resumen por persona ────────────────────────────────────────────────────

/**
 * Una fila por persona con lo que ha tenido de cada tipo en el periodo del
 * selector. Las cifras vienen hechas de hub-api (`resumenPorPersona`), total
 * incluido: aquí solo se formatean.
 */
function ResumenDeAusencias({
  resumen,
  anio,
}: {
  resumen: NonNullable<Kpis['resumenPorPersona']>;
  anio: number | null;
}) {
  const { filas, total } = resumen;
  const th = 'py-2 pr-4 font-medium';
  const num = 'whitespace-nowrap py-2 pr-4 text-right tabular-nums';

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Users className="h-4 w-4 text-gray-400" />
        Resumen por persona
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Lo que ha tenido cada uno {rotuloDelPeriodo(anio)}. Vacaciones, compensatorios e incapacidades en días
        laborables; los permisos en horas y, aparte («d»), los de día completo, que no tienen horas.
      </p>

      {/* overflow-x-auto: en el móvil se desplaza la tabla, no la página. */}
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
            <tr className="border-b border-gray-200">
              <th className={th}>Nombre</th>
              <th className={`${th} text-right`}>Vacaciones (días)</th>
              <th className={`${th} text-right`}>Permisos</th>
              <th className={`${th} text-right`}>Compensatorios (días)</th>
              <th className={`${th} text-right`}>Incapacidades (días)</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.empleadoId} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-900">
                  {f.nombreCompleto}
                  {f.deBaja && <span className="ml-1 text-xs text-gray-400">(de baja)</span>}
                </td>
                <td className={num}>{celdaDeDias(f.vacaciones)}</td>
                <td className={num}>{celdaDePermisos(f.permisoHoras, f.permisoDias)}</td>
                <td className={num}>{celdaDeDias(f.compensatorio)}</td>
                <td className={num}>{celdaDeDias(f.incapacidad)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-300 font-semibold text-gray-900">
              <td className="py-2 pr-4">Total</td>
              <td className={num}>{celdaDeDias(total.vacaciones)}</td>
              <td className={num}>{celdaDePermisos(total.permisoHoras, total.permisoDias)}</td>
              <td className={num}>{celdaDeDias(total.compensatorio)}</td>
              <td className={num}>{celdaDeDias(total.incapacidad)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-xs italic text-gray-400">
        Solo cuentan las solicitudes aprobadas y las incapacidades registradas: no entran las pendientes, las
        anuladas ni los compensatorios concedidos.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Verde.** `npm run typecheck`, `npm test`, `npm run build` → en verde.
- [ ] **Step 3: Commit.**

```bash
git add apps/ausencias/src/PanelKpis.tsx
git commit -m "feat(ausencias): seccion resumen por persona en los kpis"
```

---

### Task 6: Falsar los candados, verificación completa y entrega

- [ ] **Step 1: Mutaciones** (con Edit; una cada vez; revertir con `git checkout -- <fichero>`; hashes antes/después idénticos):

| # | Fichero | Mutación | Comando | Debe caer |
|---|---|---|---|---|
| 1 | `kpis.ts` | Quitar `if (tramos.length === 0) continue;` | `npx vitest run src/ausencias/kpis.test.ts` | «una ficha de baja sale solo si tuvo algo en el periodo» |
| 2 | `kpis.ts` | Contar los permisos con hora como días (borrar el bloque `if (au.tipo === 'permiso' && au.horaInicio && au.horaFin) {…}`) | igual | «los permisos con hora suman horas…» |
| 3 | `kpis.ts` | Sumar días sin recortar: `const dias = contarDiasHabiles(au.fechaInicio, au.fechaFin);` | igual | «una ausencia a caballo entre dos años…» |
| 4 | `kpis.ts` | Agrupar por nombre: `porId` con clave `nombreCompleto` (en el `Map` inicial y en `get`/`set`) | igual | «dos personas con el mismo nombre no se funden» |
| 5 | `repo/kpis.ts` | Quitar `hora_inicio`/`hora_fin` del SELECT (y su `.map`) | BD `src/ausencias/repo.estacionalidad.db.test.ts` | «trae las horas de un permiso…» |
| 6 | `service/kpis.ts` | Pasar `[]` en vez de `empleados` | `npx vitest run src/ausencias/router.test.ts -t "resumen por persona"` | el test de la ruta |

- [ ] **Step 2: Suites completas.** hub-api: `npx tsc --noEmit -p .`, `npx vitest run --coverage --exclude "scripts/**"`, `npm run test:db`. Front: `npm run typecheck`, `npm test`, `npm run build`.
- [ ] **Step 3: Spec.** Cambiar el **Estado** a «implementado; pendiente de desplegar hub-api y el portal» y añadir en §3 que el recorte es por meses completos (como la gráfica). Commit: `docs(ausencias): la especificacion del resumen por persona refleja lo construido` (con el plan).
- [ ] **Step 4: Entregar.** `git switch main`, `git pull --ff-only`, `git merge --no-ff feat/kpis-resumen-por-persona -m "merge: resumen por persona en los kpis de ausencias"`, `git push origin main`, `git branch -d feat/kpis-resumen-por-persona`. Empujar no despliega: avisar al usuario de **hub-api primero y el portal después**.
