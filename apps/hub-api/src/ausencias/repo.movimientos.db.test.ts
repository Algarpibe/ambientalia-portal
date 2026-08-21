import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { movimientos, empleadosConSaldo, decidirSolicitud, actualizarSolicitud } from './repo.js';
import { transicionAlDecidir, type Solicitud } from './types.js';
import { poolDePrueba, limpiar, payloadStub, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// El recorte por rama del registro de movimientos, contra Postgres de verdad.
//
// Este fichero existe porque el doble in-memory de router.test.ts NO ejecuta
// SQL: su candado compara NOMBRES de funcion, asi que caza un renombre pero no
// un filtro mal escrito. Y aqui un filtro mal escrito no da un rojo: ensena
// las ausencias de gente que no es de quien mira.
//
// La jerarquia sembrada, con JEFE como quien pregunta:
//
//   JEFE
//    +- HIJO      (subordinado directo)
//    |   +- NIETO (subordinado de su subordinado: SI entra, por la cascada)
//    |       +- BISNIETO (NO entra: tres niveles)
//    +- (PRIMO cuelga de OTRO_JEFE: NO entra)

const JEFE = 'jefe@ambientalia.com.co';
const HIJO = 'hijo@ambientalia.com.co';
const NIETO = 'nieto@ambientalia.com.co';
const BISNIETO = 'bisnieto@ambientalia.com.co';
const PRIMO = 'primo@ambientalia.com.co';
const OTRO_JEFE = 'otrojefe@ambientalia.com.co';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});

beforeEach(async () => {
  await limpiar(db);
  // Una solicitud aprobada por cada uno, para que haya algo que contar.
  for (const [correo, jefe] of [
    [HIJO, JEFE],
    [NIETO, HIJO],
    [BISNIETO, NIETO],
    [PRIMO, OTRO_JEFE],
  ] as const) {
    const id = await sembrarEmpleado(db, correo, jefe);
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo,
      estado: 'aprobada',
      fechaInicio: '2026-03-02',
      fechaFin: '2026-03-04',
      segundoAprobadorCorreo: null,
    });
  }
});

/** Los correos de los solicitantes que ve quien pregunta. */
async function vistosPor(correo: string | null): Promise<string[]> {
  const ms = await movimientos(db, correo);
  return [...new Set(ms.map((m) => m.solicitanteEmail))].sort();
}

describe('CANDADO: el recorte por rama del registro', () => {
  it('un jefe ve a su hijo y a su nieto', async () => {
    expect(await vistosPor(JEFE)).toEqual([HIJO, NIETO].sort());
  });

  // El OTRO sitio que usa `ramaDeDosNiveles`. Va aqui y no en
  // repo.saldos.db.test.ts porque la jerarquia de tres niveles ya esta sembrada
  // en este fichero, y porque lo que se prueba es la funcion compartida.
  //
  // Existe por una falsacion que NO mordio: hasta ahora ningun test contra
  // Postgres real llamaba a `empleadosConSaldo` con `soloDe` no nulo, asi que
  // el recorte se podia romper entero sin que nada se pusiera rojo. Produccion
  // si lo usa, en la ruta de no-admin.
  it('CANDADO: el mismo recorte acota tambien los saldos', async () => {
    const conSaldo = await empleadosConSaldo(db, JEFE, null);
    const correos = conSaldo.map((e) => e.correo).sort();
    expect(correos).toEqual([HIJO, NIETO].sort());
    expect(correos).not.toContain(BISNIETO);
    expect(correos).not.toContain(PRIMO);
  });

  it('un jefe NO ve al bisnieto: la rama son dos niveles', async () => {
    expect(await vistosPor(JEFE)).not.toContain(BISNIETO);
  });

  it('un jefe NO ve a un primo de otra rama', async () => {
    expect(await vistosPor(JEFE)).not.toContain(PRIMO);
  });

  it('sin acotar, un admin, se ve la compania entera', async () => {
    expect(await vistosPor(null)).toEqual([BISNIETO, HIJO, NIETO, PRIMO].sort());
  });
});

// La OTRA regla que solo se puede probar contra Postgres: a quien nombra el
// registro cuando la decision se sello sin sesion del portal.
//
// Con `aprobador_user_id` a NULL -las sesiones de token legacy- no queda mas
// remedio que deducir el decisor de los firmantes congelados en el alta, y ahi
// hay dos, no uno. Deducirlo mal no da un rojo ni un hueco: pone en pantalla el
// nombre de una persona real que no tomo esa decision.
//
// Los tres caminos se recorren con `decidirSolicitud` y `actualizarSolicitud`,
// que es lo que corre en produccion, y NO con un UPDATE a pelo. La diferencia
// no es de estilo: la regla entera descansa en QUE marcas de firma deja cada
// camino -si `primera_firma_at` queda nula, igual a `decidida_at`, o distinta-
// y un fixture que las escribe a mano AFIRMA esa premisa en vez de
// ejercitarla. Comprobado: con las marcas puestas a mano, cambiar
// `primera_firma_at = now()` por `date_trunc('second', now())` en el UPDATE de
// `decidirSolicitud` rompia la atribucion en produccion y estos tests seguian
// verdes. Es la misma convencion, y por el mismo motivo, que anota
// `repo.testigos.db.test.ts`.

const SEGUNDO_FIRMANTE = 'segundo@ambientalia.com.co';
/** El primero lo congela `sembrarSolicitud`, y no es negociable desde aqui. */
const PRIMER_FIRMANTE = 'jefe1@ambientalia.com.co';
const LEGACY = 'legacy@ambientalia.com.co';

/**
 * Una solicitud `pendiente` con cascada de dos firmas, sin decidir todavia.
 *
 * `aprobador_user_id` se queda a NULL sin tocarlo: lo sella `decidirSolicitud`
 * con el `userId` de la sesion, y las decisiones de aqui abajo pasan `null`
 * -que su firma admite a proposito- porque eso es justo lo que dejaban las
 * sesiones con token legacy.
 */
async function sembrarConCascada(): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, LEGACY, JEFE);
  return sembrarSolicitud(db, {
    empleadoId,
    correo: LEGACY,
    estado: 'pendiente',
    fechaInicio: '2026-04-06',
    fechaFin: '2026-04-08',
    segundoAprobadorCorreo: SEGUNDO_FIRMANTE,
  });
}

/** Firma o rechaza como lo hace la bandeja, pero sin sesion: el caso legacy. */
async function firmarSinSesion(s: Solicitud, desde: Solicitud['estado'], aprueba: boolean): Promise<void> {
  const transicion = transicionAlDecidir({ ...s, estado: desde }, aprueba);
  if (!transicion) throw new Error(`el estado ${desde} no admite firma`);
  const r = await decidirSolicitud(db, s.id, desde, transicion, null, null, payloadStub);
  if (!r) throw new Error(`la decision desde ${desde} no escribio ninguna fila`);
}

/** El unico movimiento del solicitante legacy. */
async function movimientoLegacy() {
  const m = (await movimientos(db, null)).find((x) => x.solicitanteEmail === LEGACY);
  if (!m) throw new Error('la siembra no dejo ningun movimiento de LEGACY');
  return m;
}

describe('CANDADO: a quien atribuye el registro una decision sin sesion', () => {
  it('cerrada en el SEGUNDO nivel: nombra al segundo firmante, no al jefe inmediato', async () => {
    const s = await sembrarConCascada();
    // Las dos firmas de verdad, cada una en su transaccion: la primera sella
    // `primera_firma_at` y la segunda `decidida_at`, en instantes distintos.
    await firmarSinSesion(s, 'pendiente', true);
    await firmarSinSesion(s, 'pendiente_2', true);

    expect((await movimientoLegacy()).decididaPor).toEqual({
      nombre: null,
      correo: SEGUNDO_FIRMANTE,
      aproximado: true,
    });
  });

  // El caso que se escapa a simple vista, y por eso tiene test propio: hay
  // segundo firmante y hay primera firma, y aun asi decidio el PRIMERO. El
  // rechazo del jefe inmediato corta la cadena y sella las dos marcas de golpe,
  // en la misma sentencia y con el mismo now().
  it('rechazada en el PRIMER nivel: la cascada existe pero decidio el jefe inmediato', async () => {
    const s = await sembrarConCascada();
    await firmarSinSesion(s, 'pendiente', false);

    expect((await movimientoLegacy()).decididaPor).toEqual({
      nombre: null,
      correo: PRIMER_FIRMANTE,
      aproximado: true,
    });
  });

  // El tercer camino, y el unico que deja `primera_firma_at` NULA con la
  // solicitud ya cerrada: en el primer nivel no firmo nadie porque la destrabo
  // un admin desde el registro general. `validarEdicionSolicitud` admite la
  // lista ESTADOS entera a proposito -es el caso de destrabar- y
  // `actualizarSolicitud` no toca las marcas de firma. Quien decidio fue el
  // segundo; una condicion que exigiera `primera_firma_at` no nula se lo
  // colgaria al jefe inmediato, y esa condicion estuvo puesta.
  it('destrabada por un admin a pendiente_2: decide el segundo aunque no haya primera firma', async () => {
    const s = await sembrarConCascada();
    const corregida = await actualizarSolicitud(
      db,
      s.id,
      {
        empleadoId: s.empleadoId,
        tipo: s.tipo,
        fechaInicio: s.fechaInicio,
        fechaFin: s.fechaFin,
        dias: s.diasHabiles,
        estado: 'pendiente_2',
        comentarios: s.comentarios,
        observaciones: s.observaciones,
      },
      'admin@ambientalia.com.co',
      payloadStub,
    );
    // La premisa del caso, comprobada y no supuesta: corregir el estado NO
    // sella la primera firma.
    expect(corregida?.estado).toBe('pendiente_2');
    expect(corregida?.primeraFirmaAt).toBeNull();

    await firmarSinSesion(s, 'pendiente_2', true);

    expect((await movimientoLegacy()).decididaPor).toEqual({
      nombre: null,
      correo: SEGUNDO_FIRMANTE,
      aproximado: true,
    });
  });
});
