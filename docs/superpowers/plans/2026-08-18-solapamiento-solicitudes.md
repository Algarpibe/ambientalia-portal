# Solapamiento de solicitudes — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una misma persona no pueda tener dos ausencias vivas que compartan un día.

**Architecture:** Una consulta nueva en `repo.ts` que reutiliza el predicado de solapamiento que ya usa `ausenciasEntre`, y cuatro puertas que la invocan: las dos que solo leen antes de escribir van en `service.ts`; las dos que necesitan atomicidad van dentro de la transacción que ya existe en `repo.ts`. No hay restricción en Postgres — el porqué está en el spec.

**Tech Stack:** Node 20, TypeScript ESM, Express 4, SQL crudo con `$1`, Vitest 2.1.9, testcontainers para el portón de BD.

**Spec:** `docs/superpowers/specs/2026-08-18-solapamiento-solicitudes-design.md`

---

## Convenciones de este repo que hay que respetar

- **Código y comentarios en español y sin tildes**, salvo los JSDoc de `repo.ts` y las migraciones, que sí las llevan. Mimetiza el estilo del sitio que tocas.
- Los comentarios explican **por qué**, no qué.
- **Nunca `git add -A`**: hay un `apps/WO-sales/prompts/` ajeno sin trackear. Usa `git commit -m "..." -- ruta1 ruta2`.
- Trabaja en la rama `feat/solapamiento-solicitudes`, que ya existe y ya tiene el spec commiteado.
- Los cuatro portones: `npm run build --workspace=apps/hub-api`, `npm run test --workspace=apps/hub-api`, `npm run test:db --workspace=apps/hub-api` (necesita Docker), `npm run build --workspace=apps/portal`. Más `npm run typecheck --workspace=apps/ausencias`.

---

## Estructura de ficheros

| Fichero | Responsabilidad | Qué le pasa |
|---|---|---|
| `apps/hub-api/src/ausencias/repo.ts` | SQL crudo | +`Solape`, +`solapeDe`; `decidirModificacion` y `actualizarSolicitud` la llaman dentro de su transacción |
| `apps/hub-api/src/ausencias/service.ts` | reglas y validación | +`exigirSinSolape`; `AusenciaError` gana `detalle`; dos puertas |
| `apps/hub-api/src/ausencias/router.ts` | HTTP | `sendError` serializa `detalle` |
| `apps/hub-api/src/ausencias/repo.solapes.db.test.ts` | **nuevo** | el SQL contra Postgres real |
| `apps/hub-api/src/ausencias/router.test.ts` | integración HTTP | doble + tests de las cuatro puertas |
| `apps/ausencias/src/api.ts` | espejo del contrato | lee el `detalle` y redacta el mensaje |
| `apps/ausencias/src/FormularioSolicitud.tsx`, `PedirModificacion.tsx` | pantallas | lo pintan en su banner |

> **Dos correcciones sobre el spec, encontradas al escribir este plan:**
>
> 1. `ResultadoDecisionModificacion` vive en **`repo.ts:1297`**, no en `types.ts`. La variante nueva va allí.
> 2. **`mensajeDeError` de `@suite/http` descarta el `detalle`**: devuelve solo `d.error`. Por eso la Task 7 no llama a ese helper para estos dos endpoints, sino que lee el cuerpo con `res.clone()` antes. No se toca el paquete compartido, que lo usan todas las apps.

---

## Task 1: La consulta de solapamiento

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts`
- Test: `apps/hub-api/src/ausencias/repo.solapes.db.test.ts` (crear)

- [ ] **Step 1: Escribe el test que falla**

Crea `apps/hub-api/src/ausencias/repo.solapes.db.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { solapeDe } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// El SQL del solapamiento contra Postgres de verdad.
//
// Va aqui y no en el doble in-memory porque lo que se prueba es el PREDICADO
// —`fecha_inicio <= hasta AND fecha_fin >= desde`— y sus bordes, que es
// exactamente lo que una reimplementacion en JS no puede acreditar: si el doble
// se equivoca igual que el SQL, los dos coinciden y nadie se entera.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const OTRO = 'otro@ambientalia.com.co';

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
  empleadoId = await sembrarEmpleado(db, CORREO);
});

/** Una solicitud viva del empleado de siempre, del 10 al 14. */
const sembrarBase = (estado: 'pendiente' | 'pendiente_2' | 'aprobada' = 'aprobada') =>
  sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio: '2026-07-10',
    fechaFin: '2026-07-14',
    segundoAprobadorCorreo: null,
  });

describe('solapeDe', () => {
  it('sin nada sembrado no hay solape', async () => {
    expect(await solapeDe(db, empleadoId, '2026-07-10', '2026-07-14', null)).toBeNull();
  });

  it('CANDADO: los cuatro bordes del predicado', async () => {
    await sembrarBase();

    // Contenida, identica y desbordante: los tres solapan.
    expect(await solapeDe(db, empleadoId, '2026-07-11', '2026-07-12', null)).not.toBeNull();
    expect(await solapeDe(db, empleadoId, '2026-07-10', '2026-07-14', null)).not.toBeNull();
    expect(await solapeDe(db, empleadoId, '2026-07-01', '2026-07-31', null)).not.toBeNull();

    // Extremo con extremo: un solo dia en comun basta.
    expect(await solapeDe(db, empleadoId, '2026-07-14', '2026-07-20', null)).not.toBeNull();
    expect(await solapeDe(db, empleadoId, '2026-07-01', '2026-07-10', null)).not.toBeNull();

    // Adyacentes: ni un dia en comun, no solapan. Es el borde que se rompe.
    expect(await solapeDe(db, empleadoId, '2026-07-15', '2026-07-20', null)).toBeNull();
    expect(await solapeDe(db, empleadoId, '2026-07-01', '2026-07-09', null)).toBeNull();
  });

  it('las pendientes tambien ocupan', async () => {
    await sembrarBase('pendiente');
    expect(await solapeDe(db, empleadoId, '2026-07-12', '2026-07-12', null)).not.toBeNull();
  });

  it('CANDADO: una rechazada NO ocupa', async () => {
    const s = await sembrarBase();
    await db.query(`UPDATE portal.solicitudes_ausencia SET estado = 'rechazada' WHERE id = $1`, [s.id]);
    expect(await solapeDe(db, empleadoId, '2026-07-12', '2026-07-12', null)).toBeNull();
  });

  it('CANDADO: una anulada tampoco, que es una rechazada con marca', async () => {
    const s = await sembrarBase();
    await db.query(
      `UPDATE portal.solicitudes_ausencia SET estado = 'rechazada', anulada_at = now() WHERE id = $1`,
      [s.id],
    );
    expect(await solapeDe(db, empleadoId, '2026-07-12', '2026-07-12', null)).toBeNull();
  });

  it('CANDADO: una incapacidad no ocupa, porque no se pide sino que se informa', async () => {
    await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'registrada',
      tipo: 'incapacidad',
      fechaInicio: '2026-07-10',
      fechaFin: '2026-07-14',
      segundoAprobadorCorreo: null,
    });
    expect(await solapeDe(db, empleadoId, '2026-07-12', '2026-07-12', null)).toBeNull();
  });

  it('CANDADO: excluir por id evita que una solicitud choque consigo misma', async () => {
    const s = await sembrarBase();
    expect(await solapeDe(db, empleadoId, '2026-07-11', '2026-07-13', null)).not.toBeNull();
    expect(await solapeDe(db, empleadoId, '2026-07-11', '2026-07-13', s.id)).toBeNull();
  });

  it('CANDADO: otro empleado con las mismas fechas no interfiere', async () => {
    await sembrarBase();
    const otroId = await sembrarEmpleado(db, OTRO);
    expect(await solapeDe(db, otroId, '2026-07-10', '2026-07-14', null)).toBeNull();
  });

  it('devuelve lo justo para redactar el aviso', async () => {
    await sembrarBase();
    expect(await solapeDe(db, empleadoId, '2026-07-12', '2026-07-12', null)).toMatchObject({
      tipo: 'vacaciones',
      estado: 'aprobada',
      fechaInicio: '2026-07-10',
      fechaFin: '2026-07-14',
    });
  });
});
```

- [ ] **Step 2: Ejecútalo y comprueba que falla**

```bash
cd apps/hub-api && npm run test:db
```

Esperado: FAIL en `repo.solapes.db.test.ts`, con `solapeDe is not a function` o un error de importación.

- [ ] **Step 3: Implementa `solapeDe` en `repo.ts`**

Colócala **inmediatamente después de `ausenciasEntre`**, que es de donde sale su predicado. Añade también el tipo:

```ts
/** Una ausencia viva que se cruza con un rango. Lo justo para redactar el aviso. */
export interface Solape {
  id: string;
  tipo: TipoSolicitud;
  estado: Solicitud['estado'];
  fechaInicio: string;
  fechaFin: string;
}

/**
 * La primera ausencia VIVA de esta persona que se cruza con el rango, o `null`.
 *
 * Mismo predicado que `ausenciasEntre` —solapa, no contiene—, y a propósito: son
 * la misma pregunta hecha desde dos sitios, y dos formulaciones distintas
 * acabarían discrepando en los bordes.
 *
 * `LIMIT 1` porque el mensaje solo puede nombrar una colisión; buscarlas todas
 * sería trabajo que nadie lee.
 *
 * ⚠️ Aquí el filtro de estado falla en CERRADO, al revés que en `ausenciasEntre`.
 * Un estado nuevo que nadie añada a la lista se contaría como ocupado y
 * bloquearía de más: eso lo reporta un usuario el mismo día. Allí pasaría lo
 * contrario —se pintaría de más—, y eso no lo nota nadie.
 *
 * `excluirSolicitudId` es imprescindible al mover fechas: sin él, una solicitud
 * chocaría siempre contra ella misma. El alta pasa `null` porque todavía no hay
 * fila.
 *
 * Acepta `PoolClient` además de `Pool` para poder llamarse DENTRO de la
 * transacción que aplica un cambio de fechas, que es donde la comprobación deja
 * de tener ventana de carrera.
 */
export async function solapeDe(
  db: Pool | PoolClient,
  empleadoId: string,
  fechaInicio: string,
  fechaFin: string,
  excluirSolicitudId: string | null,
): Promise<Solape | null> {
  const { rows } = await db.query(
    `SELECT id, tipo, estado,
            fecha_inicio::text AS fecha_inicio,
            fecha_fin::text    AS fecha_fin
       FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1
        AND estado <> 'rechazada'
        -- La incapacidad no se pide, se informa: no ocupa ni se le puede negar.
        AND tipo   <> 'incapacidad'
        AND ($4::uuid IS NULL OR id <> $4)
        AND fecha_inicio <= $3::date
        AND fecha_fin    >= $2::date
      ORDER BY fecha_inicio, id
      LIMIT 1`,
    [empleadoId, fechaInicio, fechaFin, excluirSolicitudId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    tipo: TipoSolicitud;
    estado: Solicitud['estado'];
    fecha_inicio: string;
    fecha_fin: string;
  };
  return { id: r.id, tipo: r.tipo, estado: r.estado, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin };
}
```

- [ ] **Step 4: Ejecuta el test y comprueba que pasa**

```bash
cd apps/hub-api && npm run test:db
```

Esperado: PASS, y el total sube de 22 a 31.

- [ ] **Step 5: Arregla el candado de superficie del doble**

`repo.ts` exporta una función más, así que `router.test.ts` > «CANDADO: modela exactamente las funciones que exporta repo.ts» se pone rojo. Es el candado haciendo su trabajo. Añade al doble de `router.test.ts`, dentro de `vi.mock('./repo.js', () => ({ ... }))`:

```ts
  // REGLA DE SQL REIMPLEMENTADA AQUI. La fuente de verdad es el predicado de
  // `repo.solapeDe`, y quien lo ejecuta contra Postgres real es
  // `repo.solapes.db.test.ts`. Esto solo IMITA su resultado.
  solapeDe: async (
    _db: unknown,
    empleadoId: string,
    fechaInicio: string,
    fechaFin: string,
    excluirSolicitudId: string | null,
  ) => {
    const choque = estado.solicitudes.find(
      (s: any) =>
        s.empleadoId === empleadoId &&
        s.estado !== 'rechazada' &&
        s.tipo !== 'incapacidad' &&
        (excluirSolicitudId === null || s.id !== excluirSolicitudId) &&
        s.fechaInicio <= fechaFin &&
        s.fechaFin >= fechaInicio,
    );
    return choque
      ? {
          id: choque.id,
          tipo: choque.tipo,
          estado: choque.estado,
          fechaInicio: choque.fechaInicio,
          fechaFin: choque.fechaFin,
        }
      : null;
  },
```

Y actualiza las **dos** menciones en prosa a «38 funciones» / «38 elementos» del JSDoc del candado (líneas ~686 y ~729) a **39**.

- [ ] **Step 6: Los tres portones locales**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
npm run test:db --workspace=apps/hub-api
```

Esperado: build limpio, 752 tests en verde, 31 contra Postgres.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(ausencias): consulta de solapamiento con su porton contra Postgres" -- apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/router.test.ts
git add apps/hub-api/src/ausencias/repo.solapes.db.test.ts
git commit -m "test(ausencias): los cuatro bordes del predicado de solapamiento" -- apps/hub-api/src/ausencias/repo.solapes.db.test.ts
```

---

## Task 2: El error puede llevar el conflicto

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (clase `AusenciaError`)
- Modify: `apps/hub-api/src/ausencias/router.ts` (`sendError`, líneas 28-31)
- Test: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Step 1: Escribe el test que falla**

Añade a `router.test.ts`, dentro del `describe` de errores del router (o al final del fichero, en uno propio):

```ts
describe('la forma de los errores del router', () => {
  it('CANDADO: un error sin detalle NO estrena la clave en la respuesta', async () => {
    // `JSON.stringify` omite las claves `undefined`, y de eso depende que
    // ninguna respuesta actual cambie de forma al añadir `detalle`. Si algun dia
    // se serializara como `null`, todos los clientes verian una clave nueva.
    const r = await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ fechaInicio: 'no-es-fecha' }))
      .expect(400);
    expect(r.body).toEqual({ error: 'fecha_invalida', field: 'fechaInicio' });
  });
});
```

- [ ] **Step 2: Ejecútalo y comprueba que PASA**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "NO estrena la clave"
```

Esperado: PASS. Este test es una **red de regresión**, no un test de algo que falte: se escribe antes del cambio precisamente para que detecte si el cambio rompe la forma actual.

- [ ] **Step 3: Extiende `AusenciaError` en `service.ts`**

```ts
export class AusenciaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly field?: string,
    /**
     * Datos del conflicto, para los errores que sin ellos no se pueden accionar.
     * «Te solapas» sin decir CON QUE deja a la persona sin saber que corregir.
     * Opcional: la inmensa mayoria de los errores se explican solos con `code`.
     */
    public readonly detalle?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AusenciaError';
  }
}
```

- [ ] **Step 4: Serialízalo en `router.ts`**

```ts
  if (e instanceof AusenciaError) {
    // `detalle` va sin condicional: `JSON.stringify` omite las claves
    // `undefined`, asi que las respuestas que no lo llevan no cambian de forma.
    res.status(e.status).json({ error: e.code, field: e.field, detalle: e.detalle });
    return;
  }
```

- [ ] **Step 5: Ejecuta el test y comprueba que sigue pasando**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "NO estrena la clave"
```

Esperado: PASS. Si falla con una clave `detalle: null` de más, el `undefined` se ha convertido en `null` por el camino.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ausencias): un error del dominio puede llevar el dato del conflicto" -- apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

## Task 3: Puerta 1 — el alta

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (`crearSolicitud`)
- Test: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Step 1: Escribe los tests que fallan**

```ts
describe('no se puede estar ausente dos veces a la vez', () => {
  /** Deja una solicitud viva del 10 al 14 y devuelve su id. */
  async function conAusencia(estado = 'aprobada') {
    const s = (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva({ fechaInicio: '2026-07-10', fechaFin: '2026-07-14' }))
        .expect(201)
    ).body as Record<string, unknown>;
    fila(s.id as string).estado = estado;
    return s.id as string;
  }

  const pedir = (over: Record<string, unknown>) =>
    request(app()).post('/api/ausencias/solicitudes').set('Authorization', `Bearer ${token()}`).send(nueva(over));

  it('CANDADO: pedir encima de una aprobada da 409 y dice con que choca', async () => {
    await conAusencia();
    const r = await pedir({ fechaInicio: '2026-07-12', fechaFin: '2026-07-16' }).expect(409);
    expect(r.body).toMatchObject({
      error: 'rango_solapado',
      field: 'fechaInicio',
      detalle: { tipo: 'vacaciones', estado: 'aprobada', fechaInicio: '2026-07-10', fechaFin: '2026-07-14' },
    });
  });

  it('CANDADO: adyacente pasa — el borde es donde se rompen estas reglas', async () => {
    await conAusencia();
    await pedir({ fechaInicio: '2026-07-15', fechaFin: '2026-07-17' }).expect(201);
  });

  it('una pendiente tambien ocupa', async () => {
    await conAusencia('pendiente');
    await pedir({ fechaInicio: '2026-07-12', fechaFin: '2026-07-12' }).expect(409);
  });

  it('una rechazada no ocupa', async () => {
    const id = await conAusencia('rechazada');
    expect(fila(id).estado).toBe('rechazada');
    await pedir({ fechaInicio: '2026-07-12', fechaFin: '2026-07-12' }).expect(201);
  });

  it('CANDADO: una incapacidad se puede informar SIEMPRE, encima de lo que sea', async () => {
    // Quien cae malo de vacaciones no puede anularlas —las fechas ya pasaron— ni
    // acortarlas. Bloquear la incapacidad le dejaria sin registrarla.
    await conAusencia();
    await request(app())
      .post('/api/ausencias/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send(nueva({ tipo: 'incapacidad', fechaInicio: '2026-07-12', fechaFin: '2026-07-13', adjunto: { nombreArchivo: 'x.pdf', mime: 'application/pdf', contenidoBase64: PDF } }))
      .expect(201);
  });
});
```

> Ajusta `nueva({...})` y el fixture del adjunto a los helpers que ya existen en el fichero (`nueva` está en `router.test.ts:752`, `PDF` en `:751`).

- [ ] **Step 2: Ejecútalos y comprueba que fallan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "no se puede estar ausente dos veces"
```

Esperado: FAIL — los que esperan 409 reciben 201.

- [ ] **Step 3: Añade el helper y la puerta en `service.ts`**

El helper, junto a las demás funciones privadas del fichero:

```ts
/**
 * Corta si esta persona ya tiene una ausencia viva en esas fechas.
 *
 * Unico sitio donde se decide que es un solapamiento, para que las cuatro
 * puertas no puedan discrepar entre ellas.
 */
async function exigirSinSolape(
  db: Pool,
  empleadoId: string,
  tipo: TipoSolicitud,
  fechaInicio: string,
  fechaFin: string,
  excluirSolicitudId: string | null,
): Promise<void> {
  // Una incapacidad no se pide: se informa despues de haber estado enfermo. Con
  // las fechas ya pasadas no se puede anular ni acortar nada para hacerle sitio,
  // asi que bloquearla dejaria a esa persona sin poder registrarla.
  if (tipo === 'incapacidad') return;

  const choque = await repo.solapeDe(db, empleadoId, fechaInicio, fechaFin, excluirSolicitudId);
  if (!choque) return;
  throw new AusenciaError('rango_solapado', 409, 'fechaInicio', {
    tipo: choque.tipo,
    estado: choque.estado,
    fechaInicio: choque.fechaInicio,
    fechaFin: choque.fechaFin,
  });
}
```

Y en `crearSolicitud`, justo después de resolver el empleado y antes de construir el adjunto:

```ts
  const empleado = await empleadoDeSesion(db, sesion);
  // Va aqui porque necesita el id del empleado, y antes de escribir nada.
  await exigirSinSolape(db, empleado.id, datos.tipo, datos.fechaInicio, datos.fechaFin, null);
  const diasHabiles = contarDiasHabiles(datos.fechaInicio, datos.fechaFin);
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "no se puede estar ausente dos veces"
```

Esperado: PASS los cinco.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ausencias): el alta no admite fechas ya ocupadas" -- apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.test.ts
```

---

## Task 4: Puerta 2 — proponer un cambio de fechas

**Files:**
- Modify: `apps/hub-api/src/ausencias/service.ts` (`pedirModificacion`)
- Test: `apps/hub-api/src/ausencias/router.test.ts`

- [ ] **Step 1: Escribe los tests que fallan**

Dentro del `describe('POST /ausencias/solicitudes/:id/modificaciones')` que ya existe:

```ts
  /** Crea una solicitud aprobada con esas fechas y devuelve su id. */
  async function aprobadaEntre(fechaInicio: string, fechaFin: string) {
    const s = (
      await request(app())
        .post('/api/ausencias/solicitudes')
        .set('Authorization', `Bearer ${token()}`)
        .send(nueva({ fechaInicio, fechaFin }))
        .expect(201)
    ).body as Record<string, unknown>;
    fila(s.id as string).estado = 'aprobada';
    return s.id as string;
  }

  const proponer = (id: string, cuerpo: Record<string, unknown>) =>
    request(app())
      .post(`/api/ausencias/solicitudes/${id}/modificaciones`)
      .set('Authorization', `Bearer ${token()}`)
      .send(cuerpo);

  it('CANDADO: mover las fechas encima de otra viva da 409', async () => {
    const mueve = await aprobadaEntre('2026-07-06', '2026-07-08');
    await aprobadaEntre('2026-07-20', '2026-07-22');

    const r = await proponer(mueve, {
      clase: 'fechas',
      fechaInicio: '2026-07-21',
      fechaFin: '2026-07-23',
    }).expect(409);
    expect(r.body).toMatchObject({
      error: 'rango_solapado',
      detalle: { fechaInicio: '2026-07-20', fechaFin: '2026-07-22' },
    });
  });

  it('CANDADO: acortar una solicitud NO la hace chocar consigo misma', async () => {
    // Es lo que rompe quitar `id <> $4`: sin el, acortar del 6-10 al 6-8 daria
    // 409 contra la propia solicitud que se esta acortando, y cambiar fechas
    // dejaria de funcionar para todo el mundo.
    const id = await aprobadaEntre('2026-07-06', '2026-07-10');
    await proponer(id, { clase: 'fechas', fechaInicio: '2026-07-06', fechaFin: '2026-07-08' }).expect(201);
  });

  it('anular no comprueba solapes: quitar una ausencia nunca choca', async () => {
    const id = await aprobadaEntre('2026-07-06', '2026-07-08');
    await proponer(id, { clase: 'anulacion', motivo: 'Se cancela el viaje' }).expect(201);
  });
```

> `nueva`, `fila` y `token` ya existen en el fichero. Las fechas van en julio de 2026 porque `router.test.ts` **congela `Date`** desde la regla de fechas pasadas: usa el mismo rango que los demás tests del `describe`, no fechas reales.

- [ ] **Step 2: Ejecútalos y comprueba que fallan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "encima de otra viva"
```

Esperado: FAIL — devuelve 201 donde se espera 409.

- [ ] **Step 3: Añade la puerta en `pedirModificacion`**

Justo después del guard de `anulacion_ya_empezada`:

```ts
  // Solo un cambio de fechas puede crear un solapamiento: anular quita una
  // ausencia, y quitar nunca choca con nada. Se excluye la propia solicitud, o
  // acortarla chocaria contra ella misma.
  if (datos.clase === 'fechas' && datos.fechaInicio && datos.fechaFin) {
    await exigirSinSolape(db, empleado.id, solicitud.tipo, datos.fechaInicio, datos.fechaFin, solicitud.id);
  }
```

- [ ] **Step 4: Ejecuta y comprueba que pasan**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts
```

Esperado: PASS todo el fichero.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ausencias): proponer un cambio de fechas no puede pisar otra ausencia" -- apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/router.test.ts
```

---

## Task 5: Puerta 3 — aprobar la propuesta, dentro de la transacción

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`ResultadoDecisionModificacion:1297`, `ChoqueConLaSolicitud:1309`, `decidirModificacion`)
- Modify: `apps/hub-api/src/ausencias/service.ts` (traducción a 409)
- Test: `apps/hub-api/src/ausencias/repo.solapes.db.test.ts`

**Por qué esta puerta existe:** entre proponer y firmar pueden haberle aprobado otra cosa encima. Sin esto, el jefe firma un cambio que deja dos ausencias solapadas, y ya no hay quien lo impida.

- [ ] **Step 1: Escribe el test que falla**

Añade a `repo.solapes.db.test.ts` (importa además `crearModificacion`, `decidirModificacion`, `modificacionPorId` de `./repo.js`, `payloadStub` y `eventosDelOutbox` del harness):

```ts
it('CANDADO: aprobar una propuesta que se volvio solapada hace ROLLBACK y no toca el outbox', async () => {
  // Se propone mover al 20-22 y, ANTES de que el jefe firme, le aprueban otra
  // ausencia el 21. Firmar ahora dejaria dos ausencias a la vez, y ya no habria
  // quien lo impidiera: esta es la unica puerta que puede verlo.
  const a = await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'aprobada',
    fechaInicio: '2026-07-10',
    fechaFin: '2026-07-14',
    segundoAprobadorCorreo: null,
  });

  const propuesta = await crearModificacion(
    db,
    {
      solicitudId: a.id,
      clase: 'fechas',
      estadoEsperado: 'aprobada',
      fechaInicioNueva: '2026-07-20',
      fechaFinNueva: '2026-07-22',
      diasHabilesNuevos: 3,
      motivo: null,
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
    },
    payloadStub,
  );
  expect(propuesta.ok).toBe(true);

  // El destino se ocupa DESPUES de la propuesta.
  await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'aprobada',
    fechaInicio: '2026-07-21',
    fechaFin: '2026-07-21',
    segundoAprobadorCorreo: null,
  });

  const outboxAntes = await eventosDelOutbox(db);
  const decidida = await decidirModificacion(db, propuesta.modificacion.id, true, null, null, payloadStub);

  expect(decidida).toMatchObject({ ok: false, razon: 'solape' });
  // El ROLLBACK deshace las TRES escrituras: la propuesta sigue viva...
  expect((await modificacionPorId(db, propuesta.modificacion.id))?.estado).toBe('pendiente');
  // ...la solicitud conserva sus fechas...
  expect(await solapeDe(db, empleadoId, '2026-07-10', '2026-07-14', null)).not.toBeNull();
  // ...y no se ha encolado ningun correo anunciando un cambio que no ocurrio.
  expect(await eventosDelOutbox(db)).toEqual(outboxAntes);
});
```

- [ ] **Step 2: Ejecútalo y comprueba que falla**

```bash
cd apps/hub-api && npm run test:db
```

Esperado: FAIL — devuelve `{ ok: true }` y aplica el cambio.

- [ ] **Step 3: Añade la razón al contrato, en `repo.ts:1297`**

```ts
export type ResultadoDecisionModificacion =
  | { ok: true; modificacion: Modificacion; solicitud: Solicitud }
  | { ok: false; razon: 'ya_decidida' | 'solicitud_cambio_de_estado' }
  // Tercera forma de fallar, y cuenta algo distinto de las otras dos: entre
  // proponer y firmar, las fechas de destino se ocuparon. Lleva el choque
  // porque el correo que NO se ha mandado tiene que poder explicarse.
  | { ok: false; razon: 'solape'; solape: Solape };
```

- [ ] **Step 4: El centinela, junto a `ChoqueConLaSolicitud` (`repo.ts:1309`)**

```ts
class ChoqueConLaSolicitud extends Error {}

/**
 * Señal interna para abortar la transacción cuando las fechas nuevas ya están
 * ocupadas. Mismo mecanismo que `ChoqueConLaSolicitud` y por el mismo motivo: el
 * paso 1 ya ha escrito, y solo el ROLLBACK lo deshace.
 */
class SolapeAlAplicar extends Error {
  constructor(public readonly solape: Solape) {
    super('solape');
  }
}
```

- [ ] **Step 5: Comprueba dentro de la transacción**

En `decidirModificacion`, **antes** de llamar a `aplicarALaSolicitud`:

```ts
      // La comprobacion va DENTRO de la transaccion, no en el servicio: entre
      // proponer y firmar pueden haberle aprobado otra ausencia encima, y este
      // es el unico punto donde leer y escribir son atomicos.
      if (aprueba && modificacion.clase === 'fechas' && modificacion.fechaInicioNueva && modificacion.fechaFinNueva) {
        const choque = await solapeDe(
          client,
          solicitud.empleadoId,
          modificacion.fechaInicioNueva,
          modificacion.fechaFinNueva,
          modificacion.solicitudId,
        );
        if (choque) throw new SolapeAlAplicar(choque);
      }
```

> Usa los nombres de variable que ya haya en ese punto de la función (`modificacion` / `m`, `solicitud`): no los renombres.

Y en el `catch` del final, junto al que ya existe:

```ts
  } catch (err) {
    if (err instanceof ChoqueConLaSolicitud) return { ok: false, razon: 'solicitud_cambio_de_estado' };
    if (err instanceof SolapeAlAplicar) return { ok: false, razon: 'solape', solape: err.solape };
    throw err;
  }
```

- [ ] **Step 6: Tradúcelo a 409 en `service.decidirModificacion`**

Sustituye el `if (!resultado.ok)` que ya existe:

```ts
  if (!resultado.ok) {
    // Los tres son 409 y cuentan cosas distintas: `ya_decidida` es el doble clic
    // o alguien que se adelanto; `solicitud_cambio_de_estado` es que la
    // solicitud se movio debajo; y `solape` es que el destino se ocupo entre la
    // propuesta y la firma — el unico que no es culpa de quien firma.
    if (resultado.razon === 'solape') {
      throw new AusenciaError('rango_solapado', 409, 'fechaInicio', {
        tipo: resultado.solape.tipo,
        estado: resultado.solape.estado,
        fechaInicio: resultado.solape.fechaInicio,
        fechaFin: resultado.solape.fechaFin,
      });
    }
    throw resultado.razon === 'ya_decidida'
      ? new AusenciaError('ya_decidida', 409)
      : new AusenciaError('solicitud_cambio_de_estado', 409);
  }
```

- [ ] **Step 7: Ejecuta los tres portones**

```bash
cd apps/hub-api && npm run test:db && npm run test && npm run build
```

Esperado: todo verde.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(ausencias): firmar un cambio de fechas comprueba el solape en la transaccion" -- apps/hub-api/src/ausencias/types.ts apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/service.ts apps/hub-api/src/ausencias/repo.solapes.db.test.ts
```

---

## Task 6: Puerta 4 — el PATCH de admin

**Files:**
- Modify: `apps/hub-api/src/ausencias/repo.ts` (`actualizarSolicitud`)
- Test: `apps/hub-api/src/ausencias/router.test.ts`

`actualizarSolicitud` hoy hace un `db.query` suelto. Pasa a `withTransaction` para que la comprobación y la escritura sean atómicas, igual que la puerta 3.

- [ ] **Step 1: Escribe el test que falla**

En el `describe` del `PATCH` que ya existe en `router.test.ts`:

```ts
  it('CANDADO: el PATCH de admin tampoco puede pisar otra ausencia', async () => {
    // El admin es la ultima via por la que se pueden mover fechas. Sin esta
    // puerta, la regla se cumple para toda la plantilla menos para quien mas
    // facil lo tiene para saltarsela sin darse cuenta.
    const mueve = await aprobadaEntre('2026-07-06', '2026-07-08');
    await aprobadaEntre('2026-07-20', '2026-07-22');

    const r = await request(app())
      .patch(`/api/ausencias/solicitudes/${mueve}`)
      .set('Authorization', `Bearer ${token({ role: 'admin' })}`)
      .send({ fechaInicio: '2026-07-21', fechaFin: '2026-07-23' })
      .expect(409);
    expect(r.body).toMatchObject({ error: 'rango_solapado' });
  });
```

> Copia el cuerpo completo que exige `validarEdicionSolicitud` de los tests de `PATCH` que ya hay, y el helper `aprobadaEntre` de la Task 4. El token de admin se saca como en el resto del fichero.

- [ ] **Step 2: Ejecútalo y comprueba que falla**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts -t "PATCH de admin tampoco"
```

Esperado: FAIL — devuelve 200.

- [ ] **Step 3: Envuelve `actualizarSolicitud` en transacción**

**Decisión tomada: lanza el mismo centinela `SolapeAlAplicar` que la puerta 3.** Así hay un solo mecanismo para «el destino está ocupado» en todo el repo, y no dos formas distintas de contar lo mismo. Eso obliga a sacar la clase del ámbito privado donde la deja la Task 5: déjala declarada una sola vez, arriba del bloque de modificaciones.

```ts
export async function actualizarSolicitud(
  db: Pool,
  id: string,
  campos: EdicionSolicitud,
): Promise<Solicitud | null> {
  return withTransaction(db, async (client) => {
    // Dentro de la transaccion y no antes: comprobar fuera dejaria una ventana
    // entre la lectura y el UPDATE, que es justo lo que la puerta 3 cierra.
    // Se excluye la propia solicitud, o moverla dentro de sus fechas chocaria
    // contra ella misma.
    const choque = await solapeDe(client, campos.empleadoId, campos.fechaInicio, campos.fechaFin, id);
    if (choque) throw new SolapeAlAplicar(choque);

    const { rows } = await client.query(
      /* el mismo UPDATE de ahora, con `client` en vez de `db` */
    );
    if (rows.length === 0) return null;
    return solicitudPorId(client, id);
  });
}
```

> `solicitudPorId` recibe hoy un `Pool`. Amplía su tipo a `Pool | PoolClient` igual que `solapeDe`, o la relectura saldría de la transacción y podría no ver lo que se acaba de escribir.

- [ ] **Step 4: Tradúcelo en el router**

El `PATCH` llama al repo directamente, sin pasar por el servicio. En su `catch`:

```ts
    } catch (e) {
      if (e instanceof SolapeAlAplicar) {
        return void res.status(409).json({ error: 'rango_solapado', field: 'fechaInicio', detalle: e.solape });
      }
      sendError(res, e, 'ausencias_solicitud_editar');
    }
```

> Exporta `SolapeAlAplicar` desde `repo.ts` para que el router pueda nombrarla. Es la única de las dos señales que sale del módulo, y merece un comentario que diga por qué: el `PATCH` no tiene función de servicio donde traducirla.

- [ ] **Step 5: Ejecuta y comprueba que pasa**

```bash
cd apps/hub-api && npx vitest run src/ausencias/router.test.ts && npm run test:db
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ausencias): el PATCH de admin tampoco puede crear un solapamiento" -- apps/hub-api/src/ausencias/repo.ts apps/hub-api/src/ausencias/router.ts apps/hub-api/src/ausencias/router.test.ts
```

---

## Task 7: El mensaje en pantalla

**Files:**
- Modify: `apps/ausencias/src/api.ts`
- Modify: `apps/ausencias/src/FormularioSolicitud.tsx:110`
- Modify: `apps/ausencias/src/PedirModificacion.tsx:120`

**El problema que hay que rodear:** `mensajeDeError` de `@suite/http` devuelve **solo `d.error`** — descarta el `detalle`. Y lo usan todas las apps del portal, así que no se toca. La solución vive en `api.ts`: leer el cuerpo con `res.clone()` **antes** de delegar en el helper.

- [ ] **Step 1: El tipo y el mensaje, en `api.ts`**

```ts
/** El conflicto que devuelve un `rango_solapado`. Espejo de `service.ts`. */
export interface SolapeDetalle {
  tipo: TipoSolicitud;
  estado: EstadoSolicitud;
  fechaInicio: string;
  fechaFin: string;
}

/**
 * El aviso de que esas fechas ya están ocupadas.
 *
 * Se redacta aquí y no en el servidor porque el resto de errores de esta app
 * también se traducen en el cliente. Lo que sí viene del servidor es CON QUÉ
 * choca: sin esas fechas el mensaje sería «no puedes», que no dice qué corregir.
 */
export function mensajeDeSolape(d: SolapeDetalle): string {
  return `Ya tienes ${ETIQUETA_TIPO[d.tipo].toLowerCase()} del ${fechaLarga(d.fechaInicio)} al ${fechaLarga(d.fechaFin)}. Cambia las fechas o anula esa solicitud primero.`;
}
```

> `ETIQUETA_TIPO` y el formateador de fechas ya existen en la app: **búscalos y reutilízalos**, no estrenes otro formato. Si el que hay se llama distinto de `fechaLarga`, usa el suyo.

- [ ] **Step 2: El lector que conserva el `detalle`**

También en `api.ts`, y **usado solo por los dos endpoints que pueden solaparse**:

```ts
/**
 * Igual que `mensajeDeError`, salvo para el solapamiento.
 *
 * `res.clone()` es obligatorio: el cuerpo de una `Response` se puede leer una
 * sola vez, y `mensajeDeError` lo vuelve a leer si esto no es un solape.
 */
async function errorDeAusencia(res: Response): Promise<Error> {
  const cuerpo = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: string; detalle?: SolapeDetalle } | null;
  if (cuerpo?.error === 'rango_solapado' && cuerpo.detalle) return new Error(mensajeDeSolape(cuerpo.detalle));
  return new Error(await mensajeDeError(res));
}
```

Y en las dos funciones que crean solicitud y piden modificación, sustituye:

```ts
if (!res.ok) throw new Error(await mensajeDeError(res));
```

por:

```ts
if (!res.ok) throw await errorDeAusencia(res);
```

- [ ] **Step 3: Los dos banners ya no necesitan nada**

`FormularioSolicitud.tsx:110` hace `setError((err as Error).message)` y `PedirModificacion.tsx:120` hace `setError(mensajeDeModificacion((err as Error).message))`. Con el mensaje ya redactado, el primero funciona tal cual.

Para el segundo, comprueba que `mensajeDeModificacion` **deja pasar** un texto que no reconoce en vez de sustituirlo por un genérico. Si lo sustituye, añádele la salida por defecto de devolver el mensaje recibido.

- [ ] **Step 4: Los dos portones del frontend**

```bash
npm run typecheck --workspace=apps/ausencias
npm run build --workspace=apps/portal
```

- [ ] **Step 5: Míralo renderizado**

`apps/ausencias` no tiene tests: pide una solicitud encima de otra y comprueba que el banner dice las fechas correctas y **en castellano**. Ojo al gotcha del repo: JSX se come el espacio cuando un salto de línea separa texto de una etiqueta.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ausencias): el aviso de solapamiento dice con que choca" -- apps/ausencias/src/api.ts apps/ausencias/src/NuevaSolicitud.tsx apps/ausencias/src/PedirModificacion.tsx
```

---

## Task 8: Falsación y documentación

- [ ] **Step 1: Rompe cada candado y comprueba que cae por su motivo**

Una mutación cada vez, ver el rojo, comprobar **por qué** cae, revertir con `git checkout --`:

| Mutación | Debe caer |
|---|---|
| Quitar `AND ($4::uuid IS NULL OR id <> $4)` del SQL | «excluir por id evita que una solicitud choque consigo misma», y el de acortar sin chocar |
| Cambiar `estado <> 'rechazada'` por `estado = 'aprobada'` | «las pendientes tambien ocupan» |
| Quitar `AND tipo <> 'incapacidad'` | «una incapacidad no ocupa» y «se puede informar SIEMPRE» |
| Cambiar `fecha_inicio <= $3` por `<` | los bordes extremo-con-extremo |
| Quitar el `return` de incapacidad en `exigirSinSolape` | «se puede informar SIEMPRE» |

⚠️ **No inertices tocando los `$n`**: quitar un parámetro descuadra el bind y el rojo es del driver, no del candado. Si hace falta, conserva el parámetro y neutralízalo (`AND $4::uuid IS NOT DISTINCT FROM $4`).

- [ ] **Step 2: Documenta la regla**

En `docs/dev/app-ausencias.md`, sección nueva **«Una persona no puede estar ausente dos veces a la vez»**: la regla, por qué las pendientes ocupan, por qué la incapacidad es la excepción, las cuatro puertas, y que **no hay restricción en Postgres** ni escape para el admin. Enlaza el spec.

- [ ] **Step 3: Los cinco portones y commit**

```bash
npm run build --workspace=apps/hub-api
npm run test --workspace=apps/hub-api
npm run test:db --workspace=apps/hub-api
npm run typecheck --workspace=apps/ausencias
npm run build --workspace=apps/portal
```

```bash
git commit -m "docs(ausencias): la regla de no solaparse y sus cuatro puertas" -- docs/dev/app-ausencias.md
```

- [ ] **Step 4: Mezcla**

```bash
git checkout main
git merge --no-ff feat/solapamiento-solicitudes -m "merge: una persona no puede estar ausente dos veces a la vez"
```

⚠️ **No empujes sin decirlo**: `git push` a `origin/main` **despliega solo** en EasyPanel. Este cambio no necesita orden con n8n, pero sí es un cambio de comportamiento visible para toda la plantilla.
