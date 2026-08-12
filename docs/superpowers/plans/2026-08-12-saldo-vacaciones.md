# Saldo de vacaciones — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar tarea a tarea. Los
> pasos llevan casilla (`- [ ]`) para ir marcándolos.

**Objetivo:** que cada empleado y quien aprueba vean cuántos días de vacaciones
quedan, partiendo del saldo actual del consolidado como punto de corte.

**Arquitectura:** el cálculo vive en un módulo puro (`saldo.ts`) sin acceso a BD,
donde se concentran los tests. El repo solo lee filas, el servicio decide quién
ve qué, y el router expone tres endpoints. En el frontend, una tarjeta reutilizable
(`TarjetaSaldo`) que se usa en el formulario, en «Mis solicitudes» y en la bandeja,
más una pestaña de admin para teclear los saldos iniciales.

**Stack:** hub-api (Express 4, TypeScript ESM con NodeNext — los imports llevan
`.js` aunque el fichero sea `.ts`, Vitest + supertest, SQL crudo con `$1`, sin ORM
y sin zod) y apps/ausencias (React 19 + Vite + Tailwind 3).

**Spec:** `docs/superpowers/specs/2026-08-12-saldo-vacaciones-design.md`

---

## Ficheros

**Crear**
- `apps/hub-api/src/users/migrations/017_saldo_vacaciones.sql` — las dos columnas
- `apps/hub-api/src/ausencias/saldo.ts` — el cálculo, puro
- `apps/hub-api/src/ausencias/saldo.test.ts` — el grueso de los tests
- `apps/ausencias/src/TarjetaSaldo.tsx` — la tarjeta reutilizable
- `apps/ausencias/src/PanelSaldos.tsx` — la pestaña de admin

**Modificar**
- `apps/hub-api/src/db.ts:24` — añadir la migración al array
- `apps/hub-api/src/ausencias/types.ts` — tipos del saldo
- `apps/hub-api/src/ausencias/repo.ts` — lecturas y el UPDATE
- `apps/hub-api/src/ausencias/service.ts` — validación y permisos
- `apps/hub-api/src/ausencias/router.ts` — tres endpoints
- `apps/hub-api/src/ausencias/router.test.ts` — tests de endpoint
- `apps/ausencias/src/api.ts` — tipos y llamadas
- `apps/ausencias/src/App.tsx` — la pestaña nueva y el reparto del saldo
- `apps/ausencias/src/FormularioSolicitud.tsx` — tarjeta y aviso
- `apps/ausencias/src/BandejaAprobacion.tsx` — saldo del solicitante
- `docs/dev/app-ausencias.md` — documentación viva

---

## Gotchas que ya han mordido en esta app

Léelos antes de empezar; cada uno costó un despliegue o una tarde:

- **Los tres portones antes de subir.** `npm run build --workspace=apps/hub-api`
  (es lo que corre el Dockerfile), `npm run test --workspace=apps/hub-api` y
  `npm run build --workspace=apps/portal`. Vitest transpila con esbuild y **no
  comprueba tipos**; el build del portal no cubre hub-api.
- **Migraciones:** solo DDL, idempotentes, se re-ejecutan en cada arranque (no hay
  tabla de control) y hay que añadirlas **a mano** al array `MIGRATIONS` de
  `apps/hub-api/src/db.ts`. Nunca un INSERT de datos ahí.
- **pg devuelve NUMERIC como string.** Todo `NUMERIC` en un SELECT lleva `::float8`.
- **Nunca `new Date(str)` con métodos locales.** El servidor corre en UTC y
  Colombia es UTC−5. Aritmética sobre cadenas `YYYY-MM-DD`.
- **Cuidado con los backticks dentro de un SQL en template literal:** un comentario
  con acentos graves cierra la plantilla y el error apunta a otro sitio.
- Código, comentarios y mensajes de commit **en español**. Los comentarios explican
  el porqué, no el qué.

---

### Task 1: Migración 017 — las dos columnas

**Ficheros:**
- Crear: `apps/hub-api/src/users/migrations/017_saldo_vacaciones.sql`
- Modificar: `apps/hub-api/src/db.ts:24`

- [ ] **Paso 1: Escribir la migración**

Crear `apps/hub-api/src/users/migrations/017_saldo_vacaciones.sql`:

```sql
-- Migration 017: saldo de vacaciones.
--
-- El saldo NO se recalcula desde la fecha de ingreso: se parte del saldo que hoy
-- vive en la hoja `Total` del Excel y se sigue desde ahí. Como el devengo es
-- proporcional al tiempo y a la misma tasa para todos (1,25 días por mes, sin
-- tramos por antigüedad), es algebraicamente idéntico a recalcularlo desde el
-- ingreso — y ahorra parsear las nueve hojas-calendario 2018-2026 donde viven
-- las vacaciones disfrutadas históricas.
-- Solo DDL e idempotente: `initDb()` la re-ejecuta en cada arranque.

CREATE SCHEMA IF NOT EXISTS portal;

-- `saldo_corte` = días disponibles en `fecha_corte`. A partir de esa fecha se
-- devenga con el tiempo y se descuentan las vacaciones aprobadas.
-- NUMERIC(5,1) y no INTEGER: el histórico trae medios días y el devengo tiene
-- decimales por naturaleza.
ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS saldo_corte NUMERIC(5,1);

ALTER TABLE portal.empleados
  ADD COLUMN IF NOT EXISTS fecha_corte DATE;

-- Las dos o ninguna. Sin esto, un empleado a medio configurar enseñaría un saldo
-- inventado — y como la ficha se crea sola al entrar en la app, «sin configurar»
-- es el estado por defecto de todo el que se da de alta. Es el fallo más probable
-- de esta feature, así que lo impide la BD y no solo la validación.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empleados_saldo_completo') THEN
    ALTER TABLE portal.empleados
      ADD CONSTRAINT empleados_saldo_completo
      CHECK ((saldo_corte IS NULL) = (fecha_corte IS NULL));
  END IF;
END $$;
```

- [ ] **Paso 2: Registrarla en el array de migraciones**

En `apps/hub-api/src/db.ts:24`, añadir `'017_saldo_vacaciones.sql'` al final del
array `MIGRATIONS` (después de `'016_ausencias_historico.sql'`).

- [ ] **Paso 3: Verificar que compila**

Ejecutar: `npm run build --workspace=apps/hub-api`
Esperado: termina sin errores.

- [ ] **Paso 4: Commit**

```bash
git add apps/hub-api/src/users/migrations/017_saldo_vacaciones.sql apps/hub-api/src/db.ts
git commit -m "feat(ausencias): columnas de saldo de vacaciones en el maestro de empleados"
```

---

### Task 2: El cálculo — módulo puro `saldo.ts`

Aquí va el grueso del esfuerzo de test, porque es lo único con reglas de negocio.

**Ficheros:**
- Crear: `apps/hub-api/src/ausencias/saldo.ts`
- Crear: `apps/hub-api/src/ausencias/saldo.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan**

Crear `apps/hub-api/src/ausencias/saldo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calcularSaldo, hoyEnColombia, type VacacionTomada } from './saldo.js';

const CONFIG = { saldoCorte: 10, fechaCorte: '2026-01-01' };

/** Una vacación aprobada de `dias` días que empieza el `inicio`. */
function vac(inicio: string, dias: number, estado: VacacionTomada['estado'] = 'aprobada'): VacacionTomada {
  return { tipo: 'vacaciones', fechaInicio: inicio, diasHabiles: dias, estado };
}

describe('calcularSaldo', () => {
  it('devenga 1,25 días por cada 30 días transcurridos', () => {
    // 60 días desde el corte = 2 meses = 2,5 días devengados.
    const s = calcularSaldo(CONFIG, [], '2026-03-02');
    expect(s.devengadas).toBe(2.5);
    expect(s.disponible).toBe(12.5);
  });

  it('descuenta las vacaciones aprobadas desde el corte', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 5)], '2026-03-02');
    expect(s.disfrutadas).toBe(5);
    expect(s.disponible).toBe(7.5);
  });

  it('cuenta la vacación que empieza EL MISMO día del corte', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-01-01', 3)], '2026-01-01');
    expect(s.disfrutadas).toBe(3);
  });

  it('ignora la que empieza el día ANTES del corte', () => {
    // Ya está descontada del saldo de corte; contarla otra vez sería doble conteo.
    const s = calcularSaldo(CONFIG, [vac('2025-12-31', 3)], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('ignora la que empieza antes del corte aunque acabe después', () => {
    // Se decide por fecha de inicio: cualquier regla más fina sería difícil de
    // explicar a quien mira el número.
    const s = calcularSaldo(CONFIG, [vac('2025-12-28', 6)], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
  });

  it('no descuenta las rechazadas', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 5, 'rechazada')], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('lleva las pendientes a enTramite, no a disfrutadas', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 5, 'pendiente')], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.enTramite).toBe(5);
    // El saldo firme no baja hasta que se apruebe.
    expect(s.disponible).toBe(10);
  });

  it('ignora permisos, compensatorios e incapacidades', () => {
    const otros: VacacionTomada[] = [
      { tipo: 'permiso', fechaInicio: '2026-02-01', diasHabiles: 3, estado: 'aprobada' },
      { tipo: 'compensatorio', fechaInicio: '2026-02-01', diasHabiles: 2, estado: 'aprobada' },
      { tipo: 'incapacidad', fechaInicio: '2026-02-01', diasHabiles: 4, estado: 'registrada' },
    ];
    const s = calcularSaldo(CONFIG, otros, '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('admite medios días', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 0.5)], '2026-01-01');
    expect(s.disfrutadas).toBe(0.5);
    expect(s.disponible).toBe(9.5);
  });

  it('devuelve configurado:false y ceros si al empleado le falta la configuración', () => {
    const s = calcularSaldo(null, [vac('2026-02-01', 5)], '2026-03-02');
    expect(s.configurado).toBe(false);
    expect(s.disponible).toBe(0);
  });

  it('no devenga en negativo si la fecha de corte es futura', () => {
    const s = calcularSaldo({ saldoCorte: 10, fechaCorte: '2026-06-01' }, [], '2026-01-01');
    expect(s.devengadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('redondea a un decimal', () => {
    // 10 días = 10/30 × 1,25 = 0,41666… → 0,4
    const s = calcularSaldo(CONFIG, [], '2026-01-11');
    expect(s.devengadas).toBe(0.4);
  });

  it('el año devenga 15,2 días, no 15 (dividir por 30 y no por 30,44)', () => {
    // Es la fórmula del Excel y se mantiene a propósito: corregirla descuadraría
    // contra el consolidado. Este test existe para que el desvío sea deliberado
    // y no una sorpresa.
    const s = calcularSaldo({ saldoCorte: 0, fechaCorte: '2026-01-01' }, [], '2027-01-01');
    expect(s.devengadas).toBe(15.2);
  });
});

describe('hoyEnColombia', () => {
  it('a las 20:00 hora de Colombia sigue siendo el mismo día', () => {
    // 2026-08-12 20:00 en Colombia = 2026-08-13 01:00 UTC. Sin el ajuste, el
    // saldo se adelantaría un día cada tarde.
    expect(hoyEnColombia(new Date('2026-08-13T01:00:00Z'))).toBe('2026-08-12');
  });

  it('a las 00:30 hora de Colombia ya es el día nuevo', () => {
    expect(hoyEnColombia(new Date('2026-08-13T05:30:00Z'))).toBe('2026-08-13');
  });
});
```

- [ ] **Paso 2: Ejecutar los tests para verificar que fallan**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/saldo.test.ts`
Esperado: FALLA con «Failed to resolve import "./saldo.js"».

- [ ] **Paso 3: Escribir la implementación**

Crear `apps/hub-api/src/ausencias/saldo.ts`:

```ts
import type { EstadoSolicitud, TipoSolicitud } from './types.js';

// El saldo de vacaciones. Puro a propósito: sin Pool, sin fechas del sistema
// (el «hoy» se inyecta), para que todas las reglas se puedan probar sin BD.
//
// No se recalcula desde la fecha de ingreso. Se parte del saldo que hoy vive en
// la hoja `Total` del Excel y se sigue desde ahí:
//
//   saldo(hoy) = saldo_corte
//              + (días desde el corte / 30) × 1,25
//              − vacaciones aprobadas con inicio >= corte
//
// Es idéntico a recalcular desde el ingreso porque el devengo es proporcional al
// tiempo y a la misma tasa para todos, sin tramos por antigüedad.

/** Días de vacaciones al año que reconoce la empresa. */
const DIAS_AL_ANIO = 15;

/**
 * Días naturales que la fórmula considera un mes.
 *
 * Son 30 y no 30,44 porque es lo que hace el Excel, y de ahí salen los saldos de
 * partida. El efecto es que el año devenga 15,2 días en vez de 15 (365/30 × 1,25).
 * Corregirlo descuadraría contra el consolidado, así que se mantiene.
 */
const DIAS_POR_MES = 30;

/** 1,25 días por mes trabajado. */
const DEVENGO_MENSUAL = DIAS_AL_ANIO / 12;

/** El punto de partida de un empleado. Null mientras nadie lo haya configurado. */
export interface ConfigSaldo {
  saldoCorte: number;
  /** YYYY-MM-DD. Frontera: desde aquí se devenga y se descuenta. */
  fechaCorte: string;
}

/** Una solicitud, reducida a lo que el saldo necesita mirar. */
export interface VacacionTomada {
  tipo: TipoSolicitud;
  fechaInicio: string;
  diasHabiles: number;
  estado: EstadoSolicitud;
}

export interface SaldoVacaciones {
  /** False si al empleado le falta el saldo o la fecha de corte. */
  configurado: boolean;
  saldoCorte: number;
  fechaCorte: string;
  /** Devengado entre el corte y hoy. */
  devengadas: number;
  /** Aprobadas con inicio >= corte. */
  disfrutadas: number;
  /** Pendientes de aprobar con inicio >= corte. No bajan el saldo firme. */
  enTramite: number;
  /** saldoCorte + devengadas − disfrutadas. */
  disponible: number;
}

const SIN_CONFIGURAR: SaldoVacaciones = {
  configurado: false,
  saldoCorte: 0,
  fechaCorte: '',
  devengadas: 0,
  disfrutadas: 0,
  enTramite: 0,
  disponible: 0,
};

/** Un decimal, que es la precisión con la que se enseña y la de NUMERIC(5,1). */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Días naturales entre dos fechas YYYY-MM-DD, en UTC. */
function diasEntre(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000;
}

/**
 * La fecha de hoy en Colombia (UTC−5, sin horario de verano).
 *
 * Se resta el desfase ANTES de tomar la fecha. Sin esto, entre las 19:00 y la
 * medianoche hora local el servidor —que corre en UTC— ya estaría en el día
 * siguiente y el saldo de todo el mundo se adelantaría un día cada tarde.
 */
export function hoyEnColombia(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * El saldo de un empleado a fecha `hoy`.
 *
 * `vacaciones` puede traer solicitudes de cualquier tipo y estado: el filtrado es
 * cosa de esta función, para que ninguna llamada pueda olvidarse una regla.
 */
export function calcularSaldo(
  config: ConfigSaldo | null,
  vacaciones: VacacionTomada[],
  hoy: string,
): SaldoVacaciones {
  if (!config) return SIN_CONFIGURAR;

  // Nunca negativo: una fecha de corte futura significa «aún no empieza a
  // devengar», no un descuento.
  const dias = Math.max(0, diasEntre(config.fechaCorte, hoy));
  const devengadas = (dias / DIAS_POR_MES) * DEVENGO_MENSUAL;

  const sumar = (estado: EstadoSolicitud) =>
    vacaciones
      .filter((v) => v.tipo === 'vacaciones' && v.estado === estado && v.fechaInicio >= config.fechaCorte)
      .reduce((total, v) => total + v.diasHabiles, 0);

  const disfrutadas = sumar('aprobada');

  return {
    configurado: true,
    saldoCorte: config.saldoCorte,
    fechaCorte: config.fechaCorte,
    devengadas: redondear(devengadas),
    disfrutadas: redondear(disfrutadas),
    enTramite: redondear(sumar('pendiente')),
    // Con el devengo SIN redondear: redondear dos veces desviaría el resultado.
    disponible: redondear(config.saldoCorte + devengadas - disfrutadas),
  };
}
```

- [ ] **Paso 4: Ejecutar los tests para verificar que pasan**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/saldo.test.ts`
Esperado: PASA, 15 tests.

- [ ] **Paso 5: Commit**

```bash
git add apps/hub-api/src/ausencias/saldo.ts apps/hub-api/src/ausencias/saldo.test.ts
git commit -m "feat(ausencias): cálculo del saldo de vacaciones desde el punto de corte"
```

---

### Task 3: Lecturas y escritura en el repo

**Ficheros:**
- Modificar: `apps/hub-api/src/ausencias/repo.ts`

- [ ] **Paso 1: Añadir las tres funciones**

Al final de la sección `// ── Empleados ───` de `apps/hub-api/src/ausencias/repo.ts`
(justo después de `importarEmpleados`, antes de `// ── Histórico importado`),
añadir:

```ts
// ── Saldo de vacaciones ────────────────────────────────────────────────────

/** Un empleado con su configuración de saldo, tal como sale de la BD. */
export interface EmpleadoConSaldo {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  /** Null mientras nadie lo haya configurado. Va siempre en pareja con la fecha. */
  saldoCorte: number | null;
  fechaCorte: string | null;
}

/**
 * Empleados activos con su configuración de saldo.
 *
 * `soloDe` acota a los que tienen ese correo como aprobador; null = todos, que es
 * lo que recibe un admin. El saldo de vacaciones es un dato personal y no hay
 * motivo para que un aprobador vea el de gente que no aprueba.
 */
interface FilaEmpleadoSaldoDb {
  id: string;
  nombre_completo: string;
  correo: string;
  saldo_corte: number | null;
  fecha_corte: string | null;
}

export async function empleadosConSaldo(db: Pool, soloDe: string | null): Promise<EmpleadoConSaldo[]> {
  const { rows } = await db.query(
    `SELECT id, nombre_completo, correo,
            saldo_corte::float8 AS saldo_corte,
            fecha_corte::text   AS fecha_corte
       FROM portal.empleados
      WHERE activo
        AND ($1::text IS NULL OR lower(aprobador_correo) = lower($1))
      ORDER BY nombre_completo`,
    [soloDe],
  );
  return (rows as FilaEmpleadoSaldoDb[]).map((r) => ({
    empleadoId: r.id,
    nombreCompleto: r.nombre_completo,
    correo: r.correo,
    saldoCorte: r.saldo_corte,
    fechaCorte: r.fecha_corte,
  }));
}

/** Una solicitud reducida a lo que el cálculo del saldo necesita. */
export interface VacacionDeEmpleado {
  empleadoId: string;
  tipo: TipoSolicitud;
  fechaInicio: string;
  diasHabiles: number;
  estado: Solicitud['estado'];
}

/**
 * Las solicitudes de esos empleados que pueden tocar el saldo.
 *
 * Se filtra por tipo aquí además de en `calcularSaldo` porque traer permisos e
 * incapacidades para descartarlos después es tráfico gratis; el filtro del módulo
 * puro se queda igualmente como red de seguridad.
 */
interface FilaVacacionDb {
  empleado_id: string;
  tipo: TipoSolicitud;
  fecha_inicio: string;
  dias_habiles: number;
  estado: Solicitud['estado'];
}

export async function vacacionesDeEmpleados(db: Pool, ids: string[]): Promise<VacacionDeEmpleado[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query(
    `SELECT empleado_id, tipo, fecha_inicio::text AS fecha_inicio,
            dias_habiles::float8 AS dias_habiles, estado
       FROM portal.solicitudes_ausencia
      WHERE tipo = 'vacaciones' AND empleado_id = ANY($1::uuid[])`,
    [ids],
  );
  return (rows as FilaVacacionDb[]).map((r) => ({
    empleadoId: r.empleado_id,
    tipo: r.tipo,
    fechaInicio: r.fecha_inicio,
    diasHabiles: r.dias_habiles,
    estado: r.estado,
  }));
}

/**
 * Fija (o vacía) el punto de corte de un empleado. Devuelve false si no existía.
 *
 * No encola nada en el outbox, igual que la edición del registro general: ajustar
 * un saldo es corregir el registro, no tomar una decisión que haya que comunicar.
 */
export async function fijarSaldo(
  db: Pool,
  empleadoId: string,
  saldoCorte: number | null,
  fechaCorte: string | null,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE portal.empleados
        SET saldo_corte = $2, fecha_corte = $3::date
      WHERE id = $1`,
    [empleadoId, saldoCorte, fechaCorte],
  );
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Paso 2: Verificar que compila**

Ejecutar: `npm run build --workspace=apps/hub-api`
Esperado: termina sin errores. Si se queja de `TipoSolicitud`, comprobar que ya
está en el `import type` de la cabecera del fichero (lo está: línea 10).

- [ ] **Paso 3: Commit**

```bash
git add apps/hub-api/src/ausencias/repo.ts
git commit -m "feat(ausencias): lecturas y escritura del punto de corte del saldo"
```

---

### Task 4: Servicio — permisos y validación

**Ficheros:**
- Modificar: `apps/hub-api/src/ausencias/service.ts`
- Modificar: `apps/hub-api/src/ausencias/service.test.ts`

- [ ] **Paso 1: Escribir los tests de validación que fallan**

Añadir al final de `apps/hub-api/src/ausencias/service.test.ts`:

```ts
describe('validarSaldo', () => {
  it('acepta un saldo con decimal y su fecha', () => {
    expect(validarSaldo({ saldoCorte: 12.5, fechaCorte: '2026-08-12' })).toEqual({
      saldoCorte: 12.5,
      fechaCorte: '2026-08-12',
    });
  });

  it('acepta la coma decimal que teclea la gente', () => {
    expect(validarSaldo({ saldoCorte: '12,5', fechaCorte: '2026-08-12' }).saldoCorte).toBe(12.5);
  });

  it('acepta vaciar la configuración con las dos a null', () => {
    expect(validarSaldo({ saldoCorte: null, fechaCorte: null })).toEqual({
      saldoCorte: null,
      fechaCorte: null,
    });
  });

  it('rechaza un saldo negativo', () => {
    expect(() => validarSaldo({ saldoCorte: -1, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza un saldo que no es número', () => {
    expect(() => validarSaldo({ saldoCorte: 'x', fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });

  it('rechaza una fecha inválida', () => {
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: '12/08/2026' })).toThrow(AusenciaError);
  });

  it('rechaza la configuración a medias', () => {
    // Espejo del CHECK de la BD, para dar un error legible en vez de un fallo de
    // constraint de Postgres.
    expect(() => validarSaldo({ saldoCorte: 10, fechaCorte: null })).toThrow(AusenciaError);
    expect(() => validarSaldo({ saldoCorte: null, fechaCorte: '2026-08-12' })).toThrow(AusenciaError);
  });
});
```

En la cabecera del fichero, añadir `validarSaldo` a lo que ya se importa de
`./service.js` y asegurarse de que `AusenciaError` está importado.

- [ ] **Paso 2: Ejecutar los tests para verificar que fallan**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/service.test.ts`
Esperado: FALLA con «validarSaldo is not a function» o error de import.

- [ ] **Paso 3: Escribir la implementación**

En `apps/hub-api/src/ausencias/service.ts`, añadir el import del módulo nuevo
junto a los demás (respetando el `.js` que exige NodeNext):

```ts
import { calcularSaldo, hoyEnColombia, type SaldoVacaciones } from './saldo.js';
```

Y añadir al final del fichero:

```ts
// ── Saldo de vacaciones ────────────────────────────────────────────────────

/**
 * Tope del saldo de corte. NUMERIC(5,1) admite hasta 9999,9, pero 999 días son
 * 66 años de devengo: por encima es un error de tecleo, no un saldo.
 */
const MAX_SALDO = 999;

/** Lo que un admin puede fijar. Las dos a null vacía la configuración. */
export interface SaldoAFijar {
  saldoCorte: number | null;
  fechaCorte: string | null;
}

/** Valida a mano lo que llega del cliente; en este repo no hay zod. */
export function validarSaldo(body: unknown): SaldoAFijar {
  const b = (body ?? {}) as Record<string, unknown>;
  const saldoVacio = b.saldoCorte === null || b.saldoCorte === undefined || b.saldoCorte === '';
  const fechaVacia = b.fechaCorte === null || b.fechaCorte === undefined || b.fechaCorte === '';

  // Vaciar la configuración es legítimo: devuelve al empleado a «sin configurar».
  if (saldoVacio && fechaVacia) return { saldoCorte: null, fechaCorte: null };
  // A medias, no: es justo lo que impide el CHECK de la BD, y aquí el mensaje
  // se puede explicar.
  if (saldoVacio || fechaVacia) throw new AusenciaError('saldo_incompleto', 400, 'saldoCorte');

  const saldo =
    typeof b.saldoCorte === 'number' ? b.saldoCorte : Number(String(b.saldoCorte).replace(',', '.'));
  if (!Number.isFinite(saldo) || saldo < 0 || saldo > MAX_SALDO) {
    throw new AusenciaError('saldo_invalido', 400, 'saldoCorte');
  }

  const fecha = String(b.fechaCorte);
  if (!esFechaValida(fecha)) throw new AusenciaError('fecha_invalida', 400, 'fechaCorte');

  return { saldoCorte: Math.round(saldo * 10) / 10, fechaCorte: fecha };
}

/** El saldo de un empleado, listo para enseñar. */
export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
}

/** Calcula el saldo de cada empleado a partir de sus vacaciones. */
function combinar(
  empleados: repo.EmpleadoConSaldo[],
  vacaciones: repo.VacacionDeEmpleado[],
  hoy: string,
): SaldoDeEmpleado[] {
  return empleados.map((e) => ({
    empleadoId: e.empleadoId,
    nombreCompleto: e.nombreCompleto,
    correo: e.correo,
    saldo: calcularSaldo(
      e.saldoCorte !== null && e.fechaCorte !== null
        ? { saldoCorte: e.saldoCorte, fechaCorte: e.fechaCorte }
        : null,
      vacaciones.filter((v) => v.empleadoId === e.empleadoId),
      hoy,
    ),
  }));
}

/**
 * Los saldos que esta sesión puede ver: todos si es admin, y solo los de la
 * gente que aprueba si no lo es.
 */
export async function saldosVisibles(db: Pool, sesion: Sesion): Promise<SaldoDeEmpleado[]> {
  const empleados = await repo.empleadosConSaldo(db, sesion.esAdmin ? null : sesion.email);
  // Para quien no es admin, no aprobar a nadie es un 403. Para un admin, una
  // lista vacía es solo una lista vacía: la BD sin empleados todavía.
  if (!sesion.esAdmin && empleados.length === 0) throw new AusenciaError('no_es_aprobador', 403);
  const vacaciones = await repo.vacacionesDeEmpleados(
    db,
    empleados.map((e) => e.empleadoId),
  );
  return combinar(empleados, vacaciones, hoyEnColombia());
}

/** El saldo del usuario logueado. Va dentro del contexto que carga la app. */
export async function saldoDeSesion(db: Pool, empleado: Empleado): Promise<SaldoVacaciones> {
  const [fila] = await repo.empleadosConSaldo(db, null).then((todos) =>
    todos.filter((e) => e.empleadoId === empleado.id),
  );
  if (!fila) return calcularSaldo(null, [], hoyEnColombia());
  const vacaciones = await repo.vacacionesDeEmpleados(db, [empleado.id]);
  return combinar([fila], vacaciones, hoyEnColombia())[0].saldo;
}

/** Fija el punto de corte de un empleado. Solo admin (lo exige el router). */
export async function fijarSaldo(db: Pool, empleadoId: string, body: unknown): Promise<SaldoDeEmpleado> {
  const { saldoCorte, fechaCorte } = validarSaldo(body);
  const existe = await repo.fijarSaldo(db, empleadoId, saldoCorte, fechaCorte);
  if (!existe) throw new AusenciaError('empleado_no_encontrado', 404);

  const empleados = (await repo.empleadosConSaldo(db, null)).filter((e) => e.empleadoId === empleadoId);
  const vacaciones = await repo.vacacionesDeEmpleados(db, [empleadoId]);
  return combinar(empleados, vacaciones, hoyEnColombia())[0];
}
```

- [ ] **Paso 4: Ejecutar los tests para verificar que pasan**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/service.test.ts`
Esperado: PASA.

- [ ] **Paso 5: Commit**

```bash
git add apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/service.test.ts
git commit -m "feat(ausencias): servicio del saldo con validación y acotado por aprobador"
```

---

### Task 5: Endpoints

**Ficheros:**
- Modificar: `apps/hub-api/src/ausencias/router.ts`
- Modificar: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Paso 1: Escribir los tests de endpoint que fallan**

Añadir a `apps/hub-api/src/ausencias/router.test.ts`, siguiendo el estilo de los
`describe` que ya hay (mismos helpers `app()` y `token()`):

```ts
describe('GET /ausencias/saldos', () => {
  it('un admin recibe a todos los empleados', async () => {
    const r = await request(app())
      .get('/api/ausencias/saldos')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .expect(200);
    expect(Array.isArray(r.body.saldos)).toBe(true);
  });

  it('403 a quien no aprueba a nadie', async () => {
    await request(app())
      .get('/api/ausencias/saldos')
      .set('Authorization', `Bearer ${token({ sub: 'nadie@ambientalia.com.co' })}`)
      .expect(403);
  });
});

describe('PUT /ausencias/empleados/:id/saldo', () => {
  it('403 a quien no es admin', async () => {
    await request(app())
      .put('/api/ausencias/empleados/00000000-0000-0000-0000-000000000001/saldo')
      .set('Authorization', `Bearer ${token()}`)
      .send({ saldoCorte: 10, fechaCorte: '2026-08-12' })
      .expect(403);
  });

  it('400 si el saldo es negativo', async () => {
    await request(app())
      .put('/api/ausencias/empleados/00000000-0000-0000-0000-000000000001/saldo')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ saldoCorte: -5, fechaCorte: '2026-08-12' })
      .expect(400);
  });

  it('400 si la configuración va a medias', async () => {
    await request(app())
      .put('/api/ausencias/empleados/00000000-0000-0000-0000-000000000001/saldo')
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ saldoCorte: 10 })
      .expect(400);
  });
});
```

Los helpers ya existen en `router.test.ts:180` y `:186`: `token(over)` acepta un
objeto que se mezcla sobre el payload por defecto (`sub: 'ana.ruiz@ambientalia.com.co'`,
`role: 'reader'`, `apps: ['ausencias']`), así que `token({ role: 'admin' })` y
`token({ sub: 'nadie@ambientalia.com.co' })` funcionan tal cual.

- [ ] **Paso 2: Ejecutar los tests para verificar que fallan**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/router.test.ts`
Esperado: FALLA con 404 en las rutas nuevas.

- [ ] **Paso 3: Añadir el saldo al contexto**

En `apps/hub-api/src/ausencias/router.ts`, dentro del handler de
`/ausencias/contexto`, cambiar el `res.json({...})` para incluir el saldo:

```ts
      res.json({
        empleado,
        // El correo de la sesión: si no hay ficha de empleado, la UI lo enseña
        // para que se sepa exactamente qué correo hay que dar de alta.
        email: sesion.email,
        esAdmin: sesion.esAdmin,
        // Se deduce del maestro, no se declara en ningún sitio: alguien puede
        // ser aprobador de otros sin estar dado de alta como empleado.
        esAprobador: sesion.esAdmin || (await repo.esAprobadorDeAlguien(db, sesion.email)),
        festivos,
        // Viaja aquí y no en un endpoint aparte para que el formulario pueda
        // enseñar el saldo sin una segunda llamada al abrir la app.
        saldo: empleado ? await service.saldoDeSesion(db, empleado) : null,
      });
```

- [ ] **Paso 4: Añadir los dos endpoints nuevos**

En el mismo fichero, junto a las demás rutas de admin (después de
`router.post('/ausencias/empleados/sincronizar', ...)`), añadir:

```ts
  /**
   * Los saldos que quien pregunta puede ver: todos si es admin, y solo los de la
   * gente que aprueba si no lo es. Sirve a la bandeja y al panel de saldos.
   */
  router.get('/ausencias/saldos', ...gated, async (req: Request, res: Response) => {
    try {
      res.json({ saldos: await service.saldosVisibles(db, sesionDe(req)) });
    } catch (e) {
      sendError(res, e, 'ausencias_saldos');
    }
  });

  /** Fija el punto de corte de un empleado. No manda ningún correo. */
  router.put('/ausencias/empleados/:id/saldo', requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      res.json(await service.fijarSaldo(db, req.params.id, req.body));
    } catch (e) {
      sendError(res, e, 'ausencias_fijar_saldo');
    }
  });
```

- [ ] **Paso 5: Ejecutar toda la suite**

Ejecutar: `npm run test --workspace=apps/hub-api`
Esperado: PASAN los 378 anteriores más los nuevos.

- [ ] **Paso 6: Verificar tipos**

Ejecutar: `npm run build --workspace=apps/hub-api`
Esperado: termina sin errores. **Este paso no es opcional:** Vitest transpila con
esbuild y no comprueba tipos, así que un error de tipos pasa los tests y rompe el
despliegue.

- [ ] **Paso 7: Commit**

```bash
git add apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
git commit -m "feat(ausencias): endpoints de saldo y saldo en el contexto"
```

---

### Task 6: Cliente y tarjeta de saldo

**Ficheros:**
- Modificar: `apps/ausencias/src/api.ts`
- Crear: `apps/ausencias/src/TarjetaSaldo.tsx`

- [ ] **Paso 1: Añadir tipos y llamadas al cliente**

En `apps/ausencias/src/api.ts`, añadir el tipo del saldo junto a los demás:

```ts
/** El saldo de vacaciones de una persona, ya calculado por hub-api. */
export interface SaldoVacaciones {
  /** False si nadie ha configurado todavía su punto de corte. */
  configurado: boolean;
  saldoCorte: number;
  fechaCorte: string;
  devengadas: number;
  disfrutadas: number;
  /** Pendientes de aprobar. No bajan el saldo firme, pero sí el que se puede pedir. */
  enTramite: number;
  disponible: number;
}

export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
}
```

Añadir `saldo: SaldoVacaciones | null;` a la interfaz `Contexto` (junto a
`festivos`), y al final del fichero:

```ts
/** Los saldos que puede ver quien pregunta: todos si es admin, si no los suyos. */
export const fetchSaldos = () =>
  get<{ saldos: SaldoDeEmpleado[] }>('/api/ausencias/saldos').then((d) => d.saldos);

/** Fija el punto de corte de un empleado (solo admin). Las dos a null lo vacía. */
export const fijarSaldo = (empleadoId: string, saldoCorte: number | null, fechaCorte: string | null) =>
  put<SaldoDeEmpleado>(`/api/ausencias/empleados/${encodeURIComponent(empleadoId)}/saldo`, {
    saldoCorte,
    fechaCorte,
  });
```

Hace falta un helper `put`, que todavía no existe. En `apps/ausencias/src/api.ts:80`
ampliar la unión de métodos de `conCuerpo` y añadir la constante junto a las otras
dos (línea 91):

```ts
async function conCuerpo<T>(metodo: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
```

```ts
const put = <T,>(path: string, body: unknown) => conCuerpo<T>('PUT', path, body);
```

La coma de `<T,>` no es un descuido: en un `.ts` con JSX, `<T>` a secas se parsea
como etiqueta.

- [ ] **Paso 2: Crear la tarjeta**

Crear `apps/ausencias/src/TarjetaSaldo.tsx`:

```tsx
import { CalendarClock } from 'lucide-react';
import type { SaldoVacaciones } from './api';
import { formatFecha } from './dominio';

// La tarjeta del saldo. Se usa en tres sitios (formulario, «Mis solicitudes» y
// bandeja), por eso vive aparte y no dentro del formulario.

interface Props {
  saldo: SaldoVacaciones;
  /** Días que se están pidiendo ahora mismo, para avisar si no caben. */
  diasPedidos?: number;
  /** Encabezado alternativo, para cuando el saldo es de otra persona. */
  titulo?: string;
}

/** Un decimal, y sin el «.0» cuando es entero. */
function dias(n: number): string {
  return n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
}

export default function TarjetaSaldo({ saldo, diasPedidos = 0, titulo = 'Tu saldo de vacaciones' }: Props) {
  if (!saldo.configurado) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        Saldo de vacaciones sin configurar. Un administrador tiene que fijar el punto de partida
        en la pestaña <b>Saldos</b>.
      </div>
    );
  }

  // Lo que está pendiente de aprobar todavía no ha bajado el saldo firme, pero
  // se va a ir: si no se descuenta aquí, se podrían pedir tres veces los mismos
  // días antes de que nadie apruebe la primera solicitud.
  const pedible = saldo.disponible - saldo.enTramite;
  const seExcede = diasPedidos > 0 && diasPedidos > pedible;

  return (
    <div
      className={`mb-4 rounded-xl border px-3 py-2 text-sm ${
        seExcede ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-900'
      }`}
    >
      <p className="flex items-center gap-1.5 font-medium">
        <CalendarClock className="h-4 w-4 shrink-0" />
        {titulo}: <b className="tabular-nums">{dias(saldo.disponible)}</b> días
      </p>
      <p className="mt-0.5 text-xs opacity-80">
        Partiendo de {dias(saldo.saldoCorte)} el {formatFecha(saldo.fechaCorte)}, más{' '}
        {dias(saldo.devengadas)} devengados y menos {dias(saldo.disfrutadas)} disfrutados.
        {saldo.enTramite > 0 && <> Hay {dias(saldo.enTramite)} más pendientes de aprobar.</>}
      </p>
      {seExcede && (
        <p className="mt-1 font-medium">
          Estás pidiendo {dias(diasPedidos)} días y te quedan {dias(Math.max(0, pedible))}. Puedes
          enviar la solicitud igualmente: lo decide quien aprueba.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Paso 3: Verificar que compila**

Ejecutar: `npm run build --workspace=apps/portal`
Esperado: termina sin errores.

- [ ] **Paso 4: Commit**

```bash
git add apps/ausencias/src/api.ts apps/ausencias/src/TarjetaSaldo.tsx
git commit -m "feat(ausencias): cliente del saldo y tarjeta reutilizable"
```

---

### Task 7: El saldo en el formulario y en «Mis solicitudes»

**Ficheros:**
- Modificar: `apps/ausencias/src/FormularioSolicitud.tsx`
- Modificar: `apps/ausencias/src/App.tsx`

- [ ] **Paso 1: Pasar el saldo al formulario**

En `apps/ausencias/src/FormularioSolicitud.tsx`, añadir a la interfaz `Props`:

```ts
  /** Null si el usuario no tiene ficha o nadie configuró su punto de corte. */
  saldo: SaldoVacaciones | null;
```

Añadir a los imports:

```ts
import type { SaldoVacaciones } from './api';
import TarjetaSaldo from './TarjetaSaldo';
```

Y aceptar el prop en la firma: `{ festivos, aprobadorCorreo, saldo, onCreada }`.

- [ ] **Paso 2: Pintar la tarjeta**

En el mismo fichero, justo antes del bloque `{dias > 0 && !rangoInvertido && (`
(línea 161), insertar:

```tsx
      {/* Solo en vacaciones: los permisos y compensatorios no tocan el saldo. */}
      {tipo === 'vacaciones' && saldo && <TarjetaSaldo saldo={saldo} diasPedidos={rangoInvertido ? 0 : dias} />}
```

- [ ] **Paso 3: Pasarlo desde App**

En `apps/ausencias/src/App.tsx`, en el `<FormularioSolicitud>` (línea 142),
añadir el prop:

```tsx
                <FormularioSolicitud
                  festivos={festivos}
                  aprobadorCorreo={contexto.empleado.aprobadorCorreo}
                  saldo={contexto.saldo}
                  onCreada={(s) => setMias((ms) => [s, ...ms])}
                />
```

Y en la pestaña «Mis solicitudes» (línea 149), poner la tarjeta encima de la tabla:

```tsx
              <div className={tab === 'mias' ? '' : 'hidden'}>
                {contexto.saldo && <TarjetaSaldo saldo={contexto.saldo} />}
                <TablaSolicitudes solicitudes={mias} vacio="Todavía no has enviado ninguna solicitud." />
              </div>
```

Añadir `import TarjetaSaldo from './TarjetaSaldo';` a la cabecera de `App.tsx`.

- [ ] **Paso 4: Verificar que compila**

Ejecutar: `npm run build --workspace=apps/portal`
Esperado: termina sin errores.

- [ ] **Paso 5: Commit**

```bash
git add apps/ausencias/src/FormularioSolicitud.tsx apps/ausencias/src/App.tsx
git commit -m "feat(ausencias): saldo en el formulario y en mis solicitudes"
```

---

### Task 8: El saldo del solicitante en la bandeja

Es donde se toma la decisión, así que es donde más falta hace.

**Ficheros:**
- Modificar: `apps/ausencias/src/BandejaAprobacion.tsx`
- Modificar: `apps/ausencias/src/App.tsx`

- [ ] **Paso 1: Cargar los saldos en App**

En `apps/ausencias/src/App.tsx`, añadir el estado y la carga. Junto a los demás
`useState`:

```tsx
  const [saldos, setSaldos] = useState<SaldoDeEmpleado[]>([]);
```

Dentro del `Promise.all` del `useEffect` (línea 40), añadir la tercera llamada:

```tsx
        const [propias, aAprobar, saldosVisibles] = await Promise.all([
          ctx.empleado ? fetchMisSolicitudes() : Promise.resolve([]),
          ctx.esAprobador ? fetchPendientes() : Promise.resolve([]),
          // Solo tiene sentido para quien aprueba o administra; para el resto
          // el endpoint responde 403 y no hay por qué provocarlo.
          ctx.esAprobador ? fetchSaldos().catch(() => []) : Promise.resolve([]),
        ]);
        if (!vivo) return;
        setMias(propias);
        setPendientes(aAprobar);
        setSaldos(saldosVisibles);
```

Añadir `fetchSaldos` y `type SaldoDeEmpleado` al import de `./api`.

- [ ] **Paso 2: Pasarlos a la bandeja**

En el `<BandejaAprobacion>` (línea 157):

```tsx
              <BandejaAprobacion
                solicitudes={pendientes}
                saldos={saldos}
                onDecidida={onDecidida}
                onError={setError}
              />
```

- [ ] **Paso 3: Enseñarlos en la bandeja**

En `apps/ausencias/src/BandejaAprobacion.tsx`, añadir a `Props`:

```ts
  /** Saldos de la gente que este usuario aprueba, para decidir con contexto. */
  saldos: SaldoDeEmpleado[];
```

Aceptarlo en la firma y añadir los imports:

```ts
import type { SaldoDeEmpleado } from './api';
import TarjetaSaldo from './TarjetaSaldo';
```

Dentro del `map` de solicitudes, para las de vacaciones, pintar la tarjeta del
solicitante debajo de los datos de la solicitud:

```tsx
              {s.tipo === 'vacaciones' &&
                (() => {
                  const suyo = saldos.find((x) => x.empleadoId === s.empleadoId);
                  return suyo ? (
                    <TarjetaSaldo
                      saldo={suyo.saldo}
                      diasPedidos={s.diasHabiles}
                      titulo={`Saldo de ${s.empleadoNombre}`}
                    />
                  ) : null;
                })()}
```

- [ ] **Paso 4: Verificar que compila**

Ejecutar: `npm run build --workspace=apps/portal`
Esperado: termina sin errores.

- [ ] **Paso 5: Commit**

```bash
git add apps/ausencias/src/BandejaAprobacion.tsx apps/ausencias/src/App.tsx
git commit -m "feat(ausencias): saldo del solicitante en la bandeja de aprobación"
```

---

### Task 9: Pestaña «Saldos» (solo admin)

Es la vía por la que entran los quince números del consolidado.

**Ficheros:**
- Crear: `apps/ausencias/src/PanelSaldos.tsx`
- Modificar: `apps/ausencias/src/App.tsx`

- [ ] **Paso 1: Crear el panel**

Crear `apps/ausencias/src/PanelSaldos.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { fetchSaldos, fijarSaldo, type SaldoDeEmpleado } from './api';

// El punto de partida de cada persona. Por aquí entran los saldos que hoy viven
// en la hoja `Total` del Excel, y por aquí se corrigen sin pasar por psql — el
// mismo argumento que justificó el borrado y la edición del registro general.

const CAMPO = 'w-32 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 outline-none';

export default function PanelSaldos() {
  const [filas, setFilas] = useState<SaldoDeEmpleado[]>([]);
  const [borrador, setBorrador] = useState<Record<string, { saldo: string; fecha: string }>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetchSaldos()
      .then((s) => {
        if (!vivo) return;
        setFilas(s);
        setBorrador(
          Object.fromEntries(
            s.map((f) => [
              f.empleadoId,
              {
                saldo: f.saldo.configurado ? String(f.saldo.saldoCorte) : '',
                fecha: f.saldo.configurado ? f.saldo.fechaCorte : '',
              },
            ]),
          ),
        );
        setError(null);
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  async function guardar(id: string) {
    const b = borrador[id];
    setGuardando(id);
    setError(null);
    try {
      const saldo = b.saldo.trim() === '' ? null : Number(b.saldo.replace(',', '.'));
      const actualizada = await fijarSaldo(id, saldo, b.fecha || null);
      setFilas((fs) => fs.map((f) => (f.empleadoId === id ? actualizada : f)));
      setGuardado(id);
      // El tick se apaga solo: un estado de éxito permanente acaba siendo ruido.
      setTimeout(() => setGuardado((g) => (g === id ? null : g)), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  const sinConfigurar = filas.filter((f) => !f.saldo.configurado).length;

  if (cargando) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </p>
    );
  }

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Saldos de vacaciones</h3>
      <p className="mb-3 max-w-3xl text-sm text-gray-600">
        El punto de partida de cada persona: los días que tenía disponibles en la fecha de corte.
        A partir de esa fecha la app devenga 1,25 días por mes y descuenta las vacaciones aprobadas.
        Todo lo anterior al corte se da por incluido en el saldo, así que la fecha debe ser aquella
        en la que el consolidado estaba cuadrado — no necesariamente hoy.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {sinConfigurar > 0 && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {sinConfigurar} {sinConfigurar === 1 ? 'persona sigue' : 'personas siguen'} sin saldo configurado.
          Mientras tanto no ven ningún número.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Saldo en el corte</th>
              <th className="px-4 py-3 font-medium">Fecha de corte</th>
              <th className="px-4 py-3 text-right font-medium">Disponible hoy</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map((f) => (
              <tr key={f.empleadoId} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-900">{f.nombreCompleto}</td>
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    className={CAMPO}
                    aria-label={`Saldo de ${f.nombreCompleto}`}
                    value={borrador[f.empleadoId]?.saldo ?? ''}
                    onChange={(e) =>
                      setBorrador((b) => ({
                        ...b,
                        [f.empleadoId]: { ...b[f.empleadoId], saldo: e.target.value },
                      }))
                    }
                  />
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="date"
                    className={CAMPO}
                    aria-label={`Fecha de corte de ${f.nombreCompleto}`}
                    value={borrador[f.empleadoId]?.fecha ?? ''}
                    onChange={(e) =>
                      setBorrador((b) => ({
                        ...b,
                        [f.empleadoId]: { ...b[f.empleadoId], fecha: e.target.value },
                      }))
                    }
                  />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                  {f.saldo.configurado ? (
                    f.saldo.disponible.toLocaleString('es-CO', { maximumFractionDigits: 1 })
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    disabled={guardando === f.empleadoId}
                    onClick={() => void guardar(f.empleadoId)}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {guardando === f.empleadoId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : guardado === f.empleadoId ? (
                      <Check className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      'Guardar'
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Paso 2: Registrar la pestaña**

En `apps/ausencias/src/App.tsx`:

1. Añadir `'saldos'` al tipo `Pestana` (línea 17).
2. En `pestanas` (línea 61), cambiar la línea de admin a:
   ```tsx
   if (contexto?.esAdmin) p.push(['empleados', 'Empleados'], ['saldos', 'Saldos'], ['historico', 'Registro general']);
   ```
3. En el bloque `{contexto.esAdmin && (` (línea 161), añadir el panel:
   ```tsx
              <div className={tab === 'saldos' ? '' : 'hidden'}>
                <PanelSaldos />
              </div>
   ```
4. Añadir `import PanelSaldos from './PanelSaldos';` a la cabecera.

- [ ] **Paso 3: Verificar que compila**

Ejecutar: `npm run build --workspace=apps/portal`
Esperado: termina sin errores.

- [ ] **Paso 4: Commit**

```bash
git add apps/ausencias/src/PanelSaldos.tsx apps/ausencias/src/App.tsx
git commit -m "feat(ausencias): pestaña de saldos para fijar el punto de corte"
```

---

### Task 10: Los tres portones y documentación

**Ficheros:**
- Modificar: `docs/dev/app-ausencias.md`

- [ ] **Paso 1: Documentar**

Añadir a `docs/dev/app-ausencias.md` una sección «Saldo de vacaciones» que
recoja, sin repetir el spec:

- La fórmula y de dónde sale el punto de corte.
- Que la fecha de corte es la frontera y por qué se descuenta por fecha de inicio
  y no por `origen`.
- Que `fecha_corte` debe ser la fecha en la que el consolidado estaba cuadrado,
  no necesariamente hoy.
- Que el año devenga 15,2 días y no 15, y que es deliberado.
- Que un empleado sin configurar no ve ningún número, y que ese es el estado por
  defecto de todo el que se da de alta.

- [ ] **Paso 2: Los tres portones, en orden**

```bash
npm run build --workspace=apps/hub-api
npm run test  --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

Esperado: los tres en verde. El primero es el que corre el Dockerfile; saltárselo
ya rompió un despliegue una vez.

**Nota:** los 11 tests del portal (`useDashboardLayout`, `Sidebar`) fallan por un
desajuste de `jsdom` anterior a este trabajo. No son de esta feature y no bloquean.

- [ ] **Paso 3: Commit**

```bash
git add docs/dev/app-ausencias.md
git commit -m "docs(ausencias): documentar el saldo de vacaciones"
```

---

## Después de desplegar

1. Desplegar **hub-api y portal**: son servicios separados en EasyPanel y esto
   toca los dos. La migración 017 se aplica sola al arrancar hub-api.
2. Teclear los saldos del consolidado en la pestaña **Saldos**. Hasta entonces
   todo el mundo aparece como «sin configurar», que es el comportamiento correcto.
3. Verificar contra el Excel: coger dos o tres personas y comprobar que el
   «Disponible hoy» cuadra con la hoja `Total`. Si no cuadra, lo más probable es
   que la fecha de corte sea posterior a vacaciones que el consolidado aún no
   tenía descontadas.
