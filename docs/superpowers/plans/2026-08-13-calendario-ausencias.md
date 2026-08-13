# Calendario de ausencias — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar tarea a tarea. Los
> pasos llevan casilla (`- [ ]`).

**Objetivo:** una pestaña «Calendario» donde toda la plantilla vea, en una
rejilla de persona × día, quién está fuera y cuándo.

**Arquitectura:** el endpoint devuelve las marcas YA EXPANDIDAS por día, no los
rangos. Toda la aritmética de fechas vive en un módulo puro de hub-api con
tests; el frontend solo pinta. El tipo de una incapacidad ajena no se envía
siquiera: se enmascara en el servidor.

**Stack:** hub-api (Express 4, TypeScript ESM NodeNext — los imports llevan
`.js` aunque el fichero sea `.ts`, Vitest + supertest, SQL crudo con `$1`, sin
ORM ni zod) y apps/ausencias (React 19 + Vite + Tailwind 3).

**Spec:** `docs/superpowers/specs/2026-08-13-calendario-ausencias-design.md`

---

## Ficheros

**Crear**
- `apps/hub-api/src/ausencias/calendario.ts` — la expansión y el enmascarado, puro
- `apps/hub-api/src/ausencias/calendario.test.ts` — el grueso de los tests
- `apps/ausencias/src/Calendario.tsx` — la rejilla

**Modificar**
- `apps/hub-api/src/ausencias/repo.ts` — dos lecturas nuevas
- `apps/hub-api/src/ausencias/service.ts` — el caso de uso
- `apps/hub-api/src/ausencias/router.ts` — un endpoint
- `apps/hub-api/src/ausencias/router.test.ts` — tests de endpoint
- `apps/ausencias/src/api.ts` — tipos y llamada
- `apps/ausencias/src/App.tsx` — la pestaña
- `docs/dev/app-ausencias.md` — documentación viva

**No se toca:** ninguna migración. No hay tabla nueva.

---

## Gotchas de esta app

- **Los tres portones antes de subir**: `npm run build --workspace=apps/hub-api`
  (es lo que corre el Dockerfile), `npm run test --workspace=apps/hub-api` y
  `npm run build --workspace=apps/portal`. Vitest transpila con esbuild y **no
  comprueba tipos**.
- **Nunca `new Date(str)` con métodos locales.** El servidor corre en UTC y
  Colombia es UTC−5. Aritmética sobre cadenas `YYYY-MM-DD` y `Date.UTC`.
- **pg devuelve NUMERIC como string** y las fechas como `Date`: todo NUMERIC en
  un SELECT lleva `::float8` y toda fecha `::text`.
- **Cuidado con los backticks dentro de un SQL en template literal**: un
  comentario con acentos graves cierra la plantilla.
- Código, comentarios y mensajes de commit **en español**; los comentarios
  explican el porqué.
- `npm run test --workspace=apps/portal` tiene **11 fallos preexistentes y
  ajenos** (`useDashboardLayout`, `Sidebar`, por un desajuste de `jsdom`). No
  son de este trabajo y no hay que arreglarlos.

---

### Task 1: El módulo puro `calendario.ts`

Aquí va casi todo el esfuerzo de test, porque es lo único con reglas.

**Ficheros:**
- Crear: `apps/hub-api/src/ausencias/calendario.test.ts`
- Crear: `apps/hub-api/src/ausencias/calendario.ts`

- [ ] **Paso 1: Escribir los tests que fallan**

Crear `apps/hub-api/src/ausencias/calendario.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  diasDelMes,
  esMesValido,
  marcasDelMes,
  rangoDelMes,
  type AusenciaRango,
} from './calendario.js';

const YO = { email: 'ana.ruiz@ambientalia.com.co', esAdmin: false };
const OTRO = { email: 'otro@ambientalia.com.co', esAdmin: false };
const JEFE = { email: 'jefe@ambientalia.com.co', esAdmin: false };
const ADMIN = { email: 'admin@ambientalia.com.co', esAdmin: true };

/** Una ausencia de Ana, cuyo aprobador es `jefe@`. */
function aus(over: Partial<AusenciaRango> = {}): AusenciaRango {
  return {
    empleadoId: 'e1',
    empleadoCorreo: 'ana.ruiz@ambientalia.com.co',
    aprobadorCorreo: 'jefe@ambientalia.com.co',
    tipo: 'vacaciones',
    estado: 'aprobada',
    fechaInicio: '2026-08-10',
    fechaFin: '2026-08-12',
    ...over,
  };
}

const fechas = (ms: { fecha: string }[]) => ms.map((m) => m.fecha);

describe('esMesValido', () => {
  it('acepta YYYY-MM', () => {
    expect(esMesValido('2026-08')).toBe(true);
    expect(esMesValido('2026-01')).toBe(true);
    expect(esMesValido('2026-12')).toBe(true);
  });

  it('rechaza lo que no lo es', () => {
    for (const v of ['2026-13', '2026-00', '2026-8', '08-2026', '2026', '', 'agosto']) {
      expect(esMesValido(v)).toBe(false);
    }
  });
});

describe('rangoDelMes', () => {
  it('da el primer y el último día', () => {
    expect(rangoDelMes('2026-08')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
  });

  it('acierta con los meses de 30 días', () => {
    expect(rangoDelMes('2026-04').hasta).toBe('2026-04-30');
  });

  it('acierta con febrero, bisiesto y no bisiesto', () => {
    expect(rangoDelMes('2026-02').hasta).toBe('2026-02-28');
    expect(rangoDelMes('2028-02').hasta).toBe('2028-02-29');
  });

  it('acierta con diciembre, que cruza de año', () => {
    expect(rangoDelMes('2026-12')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
  });
});

describe('diasDelMes', () => {
  it('devuelve todos los días del mes', () => {
    expect(diasDelMes('2026-08')).toHaveLength(31);
    expect(diasDelMes('2026-04')).toHaveLength(30);
  });

  it('marca el fin de semana como no laborable', () => {
    // 2026-08-01 es sábado y 2026-08-02 domingo.
    const d = diasDelMes('2026-08');
    expect(d[0]).toEqual({ fecha: '2026-08-01', laborable: false });
    expect(d[1]).toEqual({ fecha: '2026-08-02', laborable: false });
    expect(d[2]).toEqual({ fecha: '2026-08-03', laborable: true });
  });

  it('marca los festivos de Colombia como no laborables', () => {
    // 1 de enero, y el 6 de enero de 2026 (Reyes) cae en martes y se traslada
    // al lunes 5 por la Ley Emiliani.
    const enero = diasDelMes('2026-01');
    expect(enero.find((d) => d.fecha === '2026-01-01')?.laborable).toBe(false);
    expect(enero.find((d) => d.fecha === '2026-01-05')?.laborable).toBe(false);
  });
});

describe('marcasDelMes — expansión', () => {
  it('expande una ausencia enteramente dentro del mes', () => {
    const m = marcasDelMes('2026-08', [aus()], YO);
    expect(fechas(m)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('acota una que empieza el mes anterior', () => {
    // Del 28 de julio al 3 de agosto: en agosto solo se pintan 3 días.
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-07-28', fechaFin: '2026-08-03' })], YO);
    expect(fechas(m)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('acota una que acaba el mes siguiente', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-29', fechaFin: '2026-09-04' })], YO);
    expect(fechas(m)).toEqual(['2026-08-29', '2026-08-30', '2026-08-31']);
  });

  it('acota una que cubre el mes entero por los dos lados', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-06-01', fechaFin: '2026-10-31' })], YO);
    expect(m).toHaveLength(31);
    expect(m[0].fecha).toBe('2026-08-01');
    expect(m[30].fecha).toBe('2026-08-31');
  });

  it('pinta la que ocupa exactamente el primer día, y la del último', () => {
    const primero = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-01', fechaFin: '2026-08-01' })], YO);
    expect(fechas(primero)).toEqual(['2026-08-01']);
    const ultimo = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-31', fechaFin: '2026-08-31' })], YO);
    expect(fechas(ultimo)).toEqual(['2026-08-31']);
  });

  it('ignora una que no toca el mes', () => {
    expect(marcasDelMes('2026-08', [aus({ fechaInicio: '2026-05-01', fechaFin: '2026-05-09' })], YO)).toEqual([]);
  });

  it('no produce ninguna marca para las rechazadas', () => {
    expect(marcasDelMes('2026-08', [aus({ estado: 'rechazada' })], YO)).toEqual([]);
  });

  it('conserva el estado, para que la interfaz distinga lo pendiente', () => {
    const m = marcasDelMes('2026-08', [aus({ estado: 'pendiente' })], YO);
    expect(m.every((x) => x.estado === 'pendiente')).toBe(true);
  });

  it('lanza si una fecha viene corrupta, en vez de pintar cualquier cosa', () => {
    expect(() => marcasDelMes('2026-08', [aus({ fechaInicio: '10/08/2026' })], YO)).toThrow();
    expect(() => marcasDelMes('2026-08', [aus({ fechaFin: '' })], YO)).toThrow();
  });
});

describe('marcasDelMes — enmascarado de las incapacidades', () => {
  const incapacidad = aus({ tipo: 'incapacidad', estado: 'registrada' });

  it('el interesado ve su propio tipo', () => {
    expect(marcasDelMes('2026-08', [incapacidad], YO)[0].tipo).toBe('incapacidad');
  });

  it('su aprobador lo ve', () => {
    // Sale de `empleados.aprobador_correo`. NO del de la solicitud, que está a
    // null en todas las incapacidades porque no las aprueba nadie.
    expect(marcasDelMes('2026-08', [incapacidad], JEFE)[0].tipo).toBe('incapacidad');
  });

  it('un admin lo ve', () => {
    expect(marcasDelMes('2026-08', [incapacidad], ADMIN)[0].tipo).toBe('incapacidad');
  });

  it('un tercero NO lo ve: recibe null, no el tipo', () => {
    const m = marcasDelMes('2026-08', [incapacidad], OTRO);
    expect(m[0].tipo).toBeNull();
    // Sigue sabiendo que está ausente y qué días: se oculta el motivo, no la ausencia.
    expect(m).toHaveLength(3);
  });

  it('compara los correos sin distinguir mayúsculas', () => {
    const mayus = { email: 'JEFE@AMBIENTALIA.COM.CO', esAdmin: false };
    expect(marcasDelMes('2026-08', [incapacidad], mayus)[0].tipo).toBe('incapacidad');
  });

  it('no enmascara los otros tres tipos para nadie', () => {
    for (const tipo of ['vacaciones', 'permiso', 'compensatorio'] as const) {
      expect(marcasDelMes('2026-08', [aus({ tipo })], OTRO)[0].tipo).toBe(tipo);
    }
  });
});
```

- [ ] **Paso 2: Ejecutar y VERIFICAR QUE FALLAN**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/calendario.test.ts`
Esperado: FALLA con un error de resolución del import `./calendario.js`.
Enseñar la salida. No seguir sin verlos fallar.

- [ ] **Paso 3: Escribir la implementación**

Crear `apps/hub-api/src/ausencias/calendario.ts`:

```ts
import { esFechaValida } from './dias-habiles.js';
import { festivosColombia } from './festivos.js';
import type { EstadoSolicitud, TipoSolicitud } from './types.js';

// El calendario de ausencias. Puro a propósito: sin Pool y sin leer la hora del
// sistema, para que todas las reglas se puedan probar sin BD.
//
// La pieza que importa es que la expansión de un rango a días concretos vive
// AQUÍ y no en el navegador. Es el cálculo que más errores de un día produce, y
// esta app ya lleva dos: el `+1` del fin exclusivo de Google Calendar y el
// UTC−5 del saldo. Aquí hay tests; en el frontend del portal no.

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Un día del mes, con lo que el frontend necesita para sombrearlo. */
export interface DiaCalendario {
  fecha: string;
  laborable: boolean;
}

/** Una celda pintada: esta persona, este día. */
export interface MarcaCalendario {
  empleadoId: string;
  fecha: string;
  /** Null = incapacidad ajena: se dice que está ausente, no por qué. */
  tipo: TipoSolicitud | null;
  estado: EstadoSolicitud;
}

/** Una ausencia sin expandir, tal como sale del repo. */
export interface AusenciaRango {
  empleadoId: string;
  empleadoCorreo: string;
  /** El aprobador del EMPLEADO, no el de la solicitud. Ver `puedeVerElTipo`. */
  aprobadorCorreo: string;
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
}

/** Quién está mirando, que es lo que decide si se revela una incapacidad. */
export interface QuienMira {
  email: string;
  esAdmin: boolean;
}

export function esMesValido(v: string): boolean {
  return MES.test(v);
}

/** Primer y último día de un mes `YYYY-MM`. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  if (!esMesValido(mes)) throw new Error(`mes inválido: ${JSON.stringify(mes)}`);
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  // Día 0 del mes SIGUIENTE es el último del actual, y `Date.UTC` cuenta los
  // meses desde 0: por eso `m` sin restarle uno ya apunta al siguiente. Resuelve
  // solo los meses de 30, febrero bisiesto y el salto de diciembre a enero.
  const ultimo = new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
  return { desde: `${mes}-01`, hasta: ultimo };
}

/** Los días del mes, marcando cuáles son laborables en Colombia. */
export function diasDelMes(mes: string): DiaCalendario[] {
  const { desde, hasta } = rangoDelMes(mes);
  const festivos = festivosColombia(Number(mes.slice(0, 4)));
  const dias: DiaCalendario[] = [];
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  for (let ms = Date.parse(`${desde}T00:00:00Z`); ms <= fin; ms += 86_400_000) {
    const d = new Date(ms);
    const fecha = d.toISOString().slice(0, 10);
    const diaSemana = d.getUTCDay();
    dias.push({ fecha, laborable: diaSemana !== 0 && diaSemana !== 6 && !festivos.has(fecha) });
  }
  return dias;
}

/**
 * Si a quien mira se le puede decir que la ausencia es una incapacidad.
 *
 * `aprobadorCorreo` tiene que venir de `portal.empleados`, NO de la solicitud:
 * el de la solicitud está a null en todas las incapacidades a propósito —una
 * incapacidad se informa, no se aprueba, y dejar ahí un aprobador la metería en
 * su bandeja de pendientes—. Leerlo de ahí dejaría a todos los aprobadores
 * fuera y reduciría la regla, en silencio, a «solo el interesado y el admin».
 */
function puedeVerElTipo(a: AusenciaRango, quien: QuienMira): boolean {
  if (a.tipo !== 'incapacidad') return true;
  if (quien.esAdmin) return true;
  const yo = quien.email.toLowerCase();
  return a.empleadoCorreo.toLowerCase() === yo || a.aprobadorCorreo.toLowerCase() === yo;
}

/**
 * Expande las ausencias a una marca por día, acotadas al mes pedido.
 *
 * El acotado es lo que permite que una ausencia a caballo entre dos meses se
 * pinte entera en los dos, cada uno con su trozo.
 */
export function marcasDelMes(
  mes: string,
  ausencias: AusenciaRango[],
  quien: QuienMira,
): MarcaCalendario[] {
  const { desde, hasta } = rangoDelMes(mes);
  const marcas: MarcaCalendario[] = [];

  for (const a of ausencias) {
    // Una rechazada no es una ausencia: nunca llegó a ocurrir.
    if (a.estado === 'rechazada') continue;
    if (!esFechaValida(a.fechaInicio)) throw new Error(`fechaInicio inválida: ${JSON.stringify(a.fechaInicio)}`);
    if (!esFechaValida(a.fechaFin)) throw new Error(`fechaFin inválida: ${JSON.stringify(a.fechaFin)}`);

    // Comparación de cadenas: con YYYY-MM-DD el orden lexicográfico ES el
    // cronológico, y no hay zona horaria que pueda desplazar nada.
    const ini = a.fechaInicio > desde ? a.fechaInicio : desde;
    const fin = a.fechaFin < hasta ? a.fechaFin : hasta;
    if (ini > fin) continue;

    const tipo = puedeVerElTipo(a, quien) ? a.tipo : null;
    const ultimo = Date.parse(`${fin}T00:00:00Z`);
    for (let ms = Date.parse(`${ini}T00:00:00Z`); ms <= ultimo; ms += 86_400_000) {
      marcas.push({
        empleadoId: a.empleadoId,
        fecha: new Date(ms).toISOString().slice(0, 10),
        tipo,
        estado: a.estado,
      });
    }
  }

  return marcas;
}
```

- [ ] **Paso 4: Ejecutar y verificar que PASAN**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/calendario.test.ts`
Esperado: PASAN los 24.

Si alguno falla, NO cambies el test para que pase: o la implementación tiene un
fallo, o hay un error real en el enunciado, y en ese caso PARA y repórtalo.

- [ ] **Paso 5: Verificar tipos**

Ejecutar: `npm run build --workspace=apps/hub-api`
Esperado: sin errores. Imprescindible: Vitest transpila con esbuild y NO
comprueba tipos.

- [ ] **Paso 6: Commit**

```bash
git commit -m "feat(ausencias): expansion del calendario por dia y enmascarado de incapacidades" -- apps/hub-api/src/ausencias/calendario.ts apps/hub-api/src/ausencias/calendario.test.ts
```

---

### Task 2: Las dos lecturas en el repo

**Ficheros:**
- Modificar: `apps/hub-api/src/ausencias/repo.ts`

- [ ] **Paso 1: Leer el fichero entero**

Fíjate en el patrón `FilaXDb` + `aX` (`FilaEmpleadoDb`/`aEmpleado`,
`FilaSolicitudDb`/`aSolicitud`) y síguelo.

- [ ] **Paso 2: Añadir la sección**

Al final del fichero, añadir:

```ts
// ── Calendario ─────────────────────────────────────────────────────────────

/** Un empleado activo, reducido a lo que la rejilla necesita para su fila. */
export interface EmpleadoActivo {
  id: string;
  nombreCompleto: string;
}

interface FilaEmpleadoActivoDb {
  id: string;
  nombre_completo: string;
}

/**
 * Los empleados activos, para que el calendario tenga una fila por persona.
 *
 * No se reutiliza `listarEmpleados`: esa NO filtra por `activo`, así que
 * arrastraría las fichas dadas de baja —justo lo que se hace con quien deja de
 * ser empleado directo— y saldrían como filas vacías para siempre.
 */
export async function empleadosActivos(db: Pool): Promise<EmpleadoActivo[]> {
  const { rows } = await db.query(
    `SELECT id, nombre_completo FROM portal.empleados
      WHERE activo ORDER BY nombre_completo`,
  );
  return (rows as FilaEmpleadoActivoDb[]).map((r) => ({ id: r.id, nombreCompleto: r.nombre_completo }));
}

interface FilaAusenciaRangoDb {
  empleado_id: string;
  empleado_correo: string;
  aprobador_correo: string;
  tipo: TipoSolicitud;
  estado: Solicitud['estado'];
  fecha_inicio: string;
  fecha_fin: string;
}

/**
 * Las ausencias que SOLAPAN con el rango, no las contenidas en él.
 *
 * La condición natural (`fecha_inicio >= desde AND fecha_fin <= hasta`) perdería
 * exactamente las que cruzan el cambio de mes, que son las que más importa ver:
 * un mes que no las enseña miente sobre quién está fuera el día 1.
 *
 * `aprobador_correo` sale del EMPLEADO y no de la solicitud a propósito: el de
 * la solicitud está a null en todas las incapacidades, y el enmascarado del
 * calendario depende de este dato.
 */
export async function ausenciasEntre(db: Pool, desde: string, hasta: string): Promise<AusenciaRango[]> {
  const { rows } = await db.query(
    `SELECT s.empleado_id, e.correo AS empleado_correo, e.aprobador_correo,
            s.tipo, s.estado,
            s.fecha_inicio::text AS fecha_inicio,
            s.fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia s
       JOIN portal.empleados e ON e.id = s.empleado_id
      WHERE e.activo
        AND s.estado <> 'rechazada'
        AND s.fecha_inicio <= $2::date
        AND s.fecha_fin    >= $1::date`,
    [desde, hasta],
  );
  return (rows as FilaAusenciaRangoDb[]).map((r) => ({
    empleadoId: r.empleado_id,
    empleadoCorreo: r.empleado_correo,
    aprobadorCorreo: r.aprobador_correo,
    tipo: r.tipo,
    estado: r.estado,
    fechaInicio: r.fecha_inicio,
    fechaFin: r.fecha_fin,
  }));
}
```

- [ ] **Paso 3: Añadir el import del tipo**

En la cabecera de `repo.ts`, añadir junto a los imports que ya hay:

```ts
import type { AusenciaRango } from './calendario.js';
```

Comprueba que `TipoSolicitud` y `Solicitud` ya están en el `import type` de
`./types.js` (lo están).

- [ ] **Paso 4: Verificar**

```
npm run build --workspace=apps/hub-api
npm run test  --workspace=apps/hub-api
```
Esperado: build limpio y la suite entera en verde (no debería cambiar el
recuento; estas funciones aún no tienen llamantes).

- [ ] **Paso 5: Commit**

```bash
git commit -m "feat(ausencias): lecturas del calendario, con solapamiento y no contencion" -- apps/hub-api/src/ausencias/repo.ts
```

---

### Task 3: El caso de uso en el servicio

**Ficheros:**
- Modificar: `apps/hub-api/src/ausencias/service.ts`

- [ ] **Paso 1: Añadir el import**

En `service.ts`, junto a los imports que ya hay (respetando el `.js`):

```ts
import {
  diasDelMes,
  esMesValido,
  marcasDelMes,
  type DiaCalendario,
  type MarcaCalendario,
} from './calendario.js';
```

- [ ] **Paso 2: Añadir el caso de uso al final del fichero**

```ts
// ── Calendario ─────────────────────────────────────────────────────────────

export interface CalendarioDelMes {
  empleados: repo.EmpleadoActivo[];
  dias: DiaCalendario[];
  marcas: MarcaCalendario[];
}

/**
 * El calendario de un mes, con las marcas ya expandidas por día.
 *
 * El parámetro es un mes y no un rango libre: acotarlo así impide que una
 * petición pida cinco años de golpe, y la interfaz solo navega mes a mes.
 */
export async function calendarioDelMes(db: Pool, sesion: Sesion, mes: string): Promise<CalendarioDelMes> {
  if (!esMesValido(mes)) throw new AusenciaError('mes_invalido', 400, 'mes');

  const { desde, hasta } = rangoDelMes(mes);
  const [empleados, ausencias] = await Promise.all([
    repo.empleadosActivos(db),
    repo.ausenciasEntre(db, desde, hasta),
  ]);

  return {
    empleados,
    dias: diasDelMes(mes),
    // El enmascarado de las incapacidades se aplica AQUÍ, antes de responder:
    // hacerlo al pintar significaría haber enviado ya el dato al navegador, y
    // un dato de salud enviado es un dato expuesto.
    marcas: marcasDelMes(mes, ausencias, { email: sesion.email, esAdmin: sesion.esAdmin }),
  };
}
```

Añade `rangoDelMes` al import del paso 1.

- [ ] **Paso 3: Verificar**

```
npm run build --workspace=apps/hub-api
npm run test  --workspace=apps/hub-api
```
Esperado: los dos en verde.

- [ ] **Paso 4: Commit**

```bash
git commit -m "feat(ausencias): caso de uso del calendario mensual" -- apps/hub-api/src/ausencias/service.ts
```

---

### Task 4: El endpoint

**Ficheros:**
- Modificar: `apps/hub-api/src/ausencias/router.ts`
- Modificar: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Paso 1: Escribir los tests que fallan**

Añadir a `router.test.ts`. Los helpers ya existen: `token(over)` mezcla lo que le
pases sobre el payload por defecto (`sub: 'ana.ruiz@ambientalia.com.co'`,
`role: 'reader'`, `apps: ['ausencias']`).

El fichero MOCKEA `./repo.js` con un objeto de funciones async (línea 40). Añade
a ese objeto las dos que faltan, con exactamente estos datos:

```ts
  empleadosActivos: async () => [
    { id: 'e1', nombreCompleto: 'Ana Ruiz' },
    { id: 'e2', nombreCompleto: 'Beto Díaz' },
  ],
  ausenciasEntre: async () => [
    {
      empleadoId: 'e1',
      empleadoCorreo: 'ana.ruiz@ambientalia.com.co',
      aprobadorCorreo: 'comercial@ambientalia.com.co',
      tipo: 'vacaciones',
      estado: 'aprobada',
      fechaInicio: '2026-08-10',
      fechaFin: '2026-08-12',
    },
  ],
```

```ts
describe('GET /ausencias/calendario', () => {
  it('devuelve empleados, días y marcas del mes', async () => {
    const r = await request(app())
      .get('/api/ausencias/calendario?mes=2026-08')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(Array.isArray(r.body.empleados)).toBe(true);
    expect(r.body.dias).toHaveLength(31);
    expect(Array.isArray(r.body.marcas)).toBe(true);
  });

  it('400 si el mes viene mal formado', async () => {
    for (const mes of ['2026-13', 'agosto', '2026', '']) {
      await request(app())
        .get(`/api/ausencias/calendario?mes=${encodeURIComponent(mes)}`)
        .set('Authorization', `Bearer ${token()}`)
        .expect(400);
    }
  });

  it('403 a quien tiene token válido pero no la app asignada', async () => {
    await request(app())
      .get('/api/ausencias/calendario?mes=2026-08')
      .set('Authorization', `Bearer ${token({ apps: [] })}`)
      .expect(403);
  });
});
```

- [ ] **Paso 2: Ejecutar y VERIFICAR QUE FALLAN**

Ejecutar: `npm run test --workspace=apps/hub-api -- src/ausencias/router.test.ts`
Esperado: FALLA con 404 en la ruta nueva.

- [ ] **Paso 3: Añadir la ruta**

En `router.ts`, junto a las demás rutas bajo `...gated`:

```ts
  /**
   * El calendario de un mes. Bajo `...gated` y no `requireAdmin`: un calendario
   * de plantilla que solo ve administración no sirve para coordinarse, y la
   * decisión de producto es que todo el mundo vea quién está fuera.
   */
  router.get('/ausencias/calendario', ...gated, async (req: Request, res: Response) => {
    try {
      res.json(await service.calendarioDelMes(db, sesionDe(req), String(req.query.mes ?? '')));
    } catch (e) {
      sendError(res, e, 'ausencias_calendario');
    }
  });
```

- [ ] **Paso 4: Verificar que pasan, y por mutación**

```
npm run test --workspace=apps/hub-api
npm run build --workspace=apps/hub-api
```
Esperado: los dos en verde.

Después, comprueba por MUTACIÓN que el test del 403 sirve: cambia `...gated` por
`requireAuth` a secas en esa ruta, ejecuta, confirma que el test falla, y
restaura. Deja `git diff` sin esa mutación. Informa del resultado.

- [ ] **Paso 5: Commit**

```bash
git commit -m "feat(ausencias): endpoint del calendario mensual" -- apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

### Task 5: Cliente y rejilla

**Ficheros:**
- Modificar: `apps/ausencias/src/api.ts`
- Crear: `apps/ausencias/src/Calendario.tsx`

- [ ] **Paso 1: Tipos y llamada en `api.ts`**

Añadir junto a los demás tipos:

```ts
/** Un día del mes, con lo que hace falta para sombrearlo. */
export interface DiaCalendario {
  fecha: string;
  laborable: boolean;
}

/** Una celda pintada del calendario. */
export interface MarcaCalendario {
  empleadoId: string;
  fecha: string;
  /** Null = incapacidad de otra persona: se sabe que está ausente, no por qué. */
  tipo: TipoSolicitud | null;
  estado: EstadoSolicitud;
}

export interface CalendarioDelMes {
  empleados: { id: string; nombreCompleto: string }[];
  dias: DiaCalendario[];
  marcas: MarcaCalendario[];
}
```

Y al final del fichero:

```ts
/** El calendario de un mes `YYYY-MM`. Lo ve cualquiera que tenga la app. */
export const fetchCalendario = (mes: string) =>
  get<CalendarioDelMes>(`/api/ausencias/calendario?mes=${encodeURIComponent(mes)}`);
```

- [ ] **Paso 2: Crear `apps/ausencias/src/Calendario.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { fetchCalendario, type CalendarioDelMes, type MarcaCalendario } from './api';
import { ETIQUETA_TIPO, TIPOS } from './dominio';

// La rejilla de persona × día. Los datos llegan ya expandidos por día desde
// hub-api: aquí no se calcula ninguna fecha, solo se pinta lo que viene. Es
// deliberado — la aritmética de fechas vive donde hay tests.

interface Props {
  /** Correo de la sesión, para el filtro «solo yo». */
  miEmpleadoId: string | null;
}

/** Color de fondo por tipo. `null` es una incapacidad ajena, sin motivo visible. */
const COLOR: Record<string, string> = {
  vacaciones: 'bg-blue-500',
  compensatorio: 'bg-emerald-500',
  permiso: 'bg-amber-500',
  incapacidad: 'bg-rose-500',
  reservado: 'bg-gray-400',
};

/** El mes en curso como `YYYY-MM`, en hora de Colombia (UTC−5). */
function mesActual(): string {
  return new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 7);
}

/** Suma meses a un `YYYY-MM` sin pasar por la zona horaria local. */
function sumarMeses(mes: string, n: number): string {
  const anio = Number(mes.slice(0, 4));
  const m = Number(mes.slice(5, 7));
  return new Date(Date.UTC(anio, m - 1 + n, 1)).toISOString().slice(0, 7);
}

const NOMBRE_MES = (mes: string) =>
  new Date(`${mes}-01T00:00:00Z`).toLocaleDateString('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default function Calendario({ miEmpleadoId }: Props) {
  const [mes, setMes] = useState(mesActual);
  const [datos, setDatos] = useState<CalendarioDelMes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [persona, setPersona] = useState('');
  const [soloYo, setSoloYo] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetchCalendario(mes)
      .then((d) => vivo && (setDatos(d), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [mes]);

  // Clave `empleadoId|fecha`: cada celda hace una consulta directa en vez de
  // recorrer la lista de marcas 15 x 31 veces.
  const porCelda = useMemo(() => {
    const m = new Map<string, MarcaCalendario>();
    for (const marca of datos?.marcas ?? []) {
      if (tipo && marca.tipo !== tipo) continue;
      m.set(`${marca.empleadoId}|${marca.fecha}`, marca);
    }
    return m;
  }, [datos, tipo]);

  // «Solo yo» gana sobre el desplegable: es el atajo del uso personal y no
  // tiene sentido que convivan dos filtros de persona contradiciéndose.
  const filas = useMemo(
    () =>
      (datos?.empleados ?? []).filter((e) =>
        soloYo ? e.id === miEmpleadoId : !persona || e.id === persona,
      ),
    [datos, soloYo, persona, miEmpleadoId],
  );

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';
  const navCls = 'rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50';

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Calendario de ausencias</h3>
      <p className="mb-3 text-sm text-gray-600">
        Quién está fuera y cuándo. Las solicitudes pendientes de aprobar salen con borde rayado.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setMes((m) => sumarMeses(m, -1))} aria-label="Mes anterior" className={navCls}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-44 text-center text-sm font-medium capitalize text-gray-900">{NOMBRE_MES(mes)}</span>
        <button type="button" onClick={() => setMes((m) => sumarMeses(m, 1))} aria-label="Mes siguiente" className={navCls}>
          <ChevronRight className="h-4 w-4" />
        </button>

        <select className={selCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <select
          className={selCls}
          value={persona}
          disabled={soloYo}
          onChange={(e) => setPersona(e.target.value)}
          aria-label="Persona"
        >
          <option value="">Todas las personas</option>
          {(datos?.empleados ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombreCompleto}
            </option>
          ))}
        </select>

        {miEmpleadoId && (
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={soloYo} onChange={(e) => setSoloYo(e.target.checked)} />
            Solo yo
          </label>
        )}
      </div>

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr>
                  {/* La columna del nombre va pegada: con 31 columnas hay scroll
                      horizontal, y sin esto se pierde de vista de quién es la fila. */}
                  <th className="sticky left-0 z-10 border-b border-gray-200 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Nombre
                  </th>
                  {(datos?.dias ?? []).map((d) => (
                    <th
                      key={d.fecha}
                      className={`w-8 border-b border-gray-200 py-2 text-center text-xs font-medium ${
                        d.laborable ? 'bg-gray-50 text-gray-500' : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {Number(d.fecha.slice(8, 10))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filas.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-1.5 text-gray-900">
                      {e.nombreCompleto}
                    </td>
                    {(datos?.dias ?? []).map((d) => {
                      const marca = porCelda.get(`${e.id}|${d.fecha}`);
                      const clave = marca ? (marca.tipo ?? 'reservado') : null;
                      return (
                        <td key={d.fecha} className={`p-0.5 ${d.laborable ? '' : 'bg-gray-50'}`}>
                          {marca && (
                            <div
                              title={`${marca.tipo ? ETIQUETA_TIPO[marca.tipo] : 'Ausente'} · ${d.fecha}${
                                marca.estado === 'pendiente' ? ' · pendiente de aprobar' : ''
                              }`}
                              className={`h-5 w-full rounded-sm ${COLOR[clave as string]} ${
                                marca.estado === 'pendiente' ? 'opacity-40 ring-1 ring-inset ring-gray-500' : ''
                              }`}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
            {TIPOS.map((t) => (
              <span key={t.id} className="flex items-center gap-1.5">
                <span className={`inline-block h-3 w-3 rounded-sm ${COLOR[t.id]}`} /> {t.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-gray-400" /> Ausente (sin detalle)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-blue-500 opacity-40 ring-1 ring-inset ring-gray-500" />{' '}
              Pendiente de aprobar
            </span>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Paso 3: Verificar que compila**

Ejecutar: `npm run build --workspace=apps/portal`
Esperado: sin errores.

Para referencia, `apps/ausencias/src/dominio.ts` ya exporta exactamente lo que
usa este componente: `TIPOS` es `{ id: TipoSolicitud; label: string; ayuda: string }[]`
con los cuatro tipos, y `ETIQUETA_TIPO` es `Record<TipoSolicitud, string>`. No
hay que tocar `dominio.ts`.

- [ ] **Paso 4: Commit**

```bash
git commit -m "feat(ausencias): rejilla del calendario y su cliente" -- apps/ausencias/src/api.ts apps/ausencias/src/Calendario.tsx
```

---

### Task 6: La pestaña, la documentación y los portones

**Ficheros:**
- Modificar: `apps/ausencias/src/App.tsx`
- Modificar: `docs/dev/app-ausencias.md`

- [ ] **Paso 1: Registrar la pestaña**

En `apps/ausencias/src/App.tsx`:

1. Añadir `'calendario'` al tipo `Pestana`.
2. En el `useMemo` de `pestanas`, la línea de empleado pasa a:
   ```tsx
   if (contexto?.empleado) p.push(['nueva', 'Nueva solicitud'], ['mias', 'Mis solicitudes'], ['calendario', 'Calendario']);
   ```
3. Dentro del bloque `{contexto.empleado && (`, junto a las otras pestañas:
   ```tsx
              <div className={tab === 'calendario' ? '' : 'hidden'}>
                <Calendario miEmpleadoId={contexto.empleado.id} />
              </div>
   ```
4. Añadir `import Calendario from './Calendario';` a la cabecera.

- [ ] **Paso 2: Documentar**

Añadir a `docs/dev/app-ausencias.md` una sección «Calendario» que recoja:

- Que convive con el Google Calendar «Ambientalia Staff» que publica n8n, que
  ese comportamiento no se toca, y que por tanto la misma información vive en
  dos sitios que no se sincronizan.
- Que el endpoint devuelve las marcas ya expandidas por día y por qué: la
  aritmética de fechas vive donde hay tests.
- Que el filtro SQL es de solapamiento y no de contención, y qué se perdería con
  la condición «natural».
- Que el tipo de una incapacidad ajena no se envía, que el enmascarado es de
  servidor, y que `aprobador_correo` sale del EMPLEADO y no de la solicitud —con
  el porqué.
- Que la pestaña la ve todo el que tenga ficha, no solo administración.

- [ ] **Paso 3: Los tres portones, en orden**

```
npm run build --workspace=apps/hub-api
npm run test  --workspace=apps/hub-api
npm run build --workspace=apps/portal
```

Los tres tienen que terminar en verde. El primero es el que corre el Dockerfile;
saltárselo ya rompió un despliegue una vez.

Recuerda: los 11 fallos de `npm run test --workspace=apps/portal` son
preexistentes y ajenos, y el test `users.integration.test.ts > rate limiting` de
hub-api es sensible a temporizador real y puede fallar bajo carga de CPU — si
falla, vuelve a correrlo en limpio antes de reportarlo como regresión.

- [ ] **Paso 4: Commit**

```bash
git commit -m "feat(ausencias): pestana de calendario y documentacion" -- apps/ausencias/src/App.tsx docs/dev/app-ausencias.md
```

---

## Después de desplegar

Toca **hub-api y portal**, que son servicios separados en EasyPanel: hay que
desplegar los DOS. Es el fallo que ya se dio con el saldo — el portal se
actualizó, hub-api no, y la pestaña nueva daba 404.

Comprobación rápida tras el despliegue: abrir la pestaña y verificar que una
ausencia conocida a caballo entre dos meses se ve en los dos, cada uno con su
trozo.
