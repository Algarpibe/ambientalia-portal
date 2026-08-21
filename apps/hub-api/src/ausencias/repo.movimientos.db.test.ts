import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { movimientos, empleadosConSaldo } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

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

/** El segundo firmante de la cascada. Lo eligen los tests, no el harness. */
const SEGUNDO_FIRMANTE = 'segundo@ambientalia.com.co';
/** El primero lo congela `sembrarSolicitud`, y no es negociable desde aqui. */
const PRIMER_FIRMANTE = 'jefe1@ambientalia.com.co';
const LEGACY = 'legacy@ambientalia.com.co';

const FIRMA = '2026-04-01T09:00:00Z';
const CIERRE = '2026-04-02T15:30:00Z';

/**
 * Una solicitud con cascada de dos firmas, ya cerrada y SIN sesion del portal.
 *
 * `aprobador_user_id` se queda a NULL sin tocarlo: un alta nunca lo escribe
 * -lo sella `decidirSolicitud`, y este test no pasa por ahi-, que es
 * exactamente el caso legacy. Si algun dia el alta lo rellenara, estos dos
 * tests se pondrian rojos en vez de dejar de probar lo suyo en silencio: el
 * `LEFT JOIN` con `portal.users` no encontraria usuario y `decididaPor`
 * seguiria siendo el respaldo, pero un id que no resuelve es una siembra que
 * produccion no puede producir y habria que revisarla.
 *
 * `enDosActos` es lo que distingue los dos finales posibles:
 *  - `true`:  el jefe firmo y DESPUES el segundo cerro. Dos instantes.
 *  - `false`: una sola sentencia sello las dos marcas con el mismo `now()`,
 *    que es lo que hace el rechazo del jefe inmediato (`transicionAlDecidir`
 *    marca `esPrimeraFirma` y `esDecisionFinal` a la vez).
 */
async function sembrarCerradaConCascada(estado: 'aprobada' | 'rechazada', enDosActos: boolean): Promise<void> {
  const empleadoId = await sembrarEmpleado(db, LEGACY, JEFE);
  const s = await sembrarSolicitud(db, {
    empleadoId,
    correo: LEGACY,
    estado,
    fechaInicio: '2026-04-06',
    fechaFin: '2026-04-08',
    segundoAprobadorCorreo: SEGUNDO_FIRMANTE,
  });
  // A mano y no por `decidirSolicitud`: esa funcion exige el `userId` de la
  // sesion, y lo que hay que reproducir aqui es justo la fila que dejaban las
  // sesiones que no lo tenian.
  await db.query(
    `UPDATE portal.solicitudes_ausencia
        SET primera_firma_at = $2::timestamptz, decidida_at = $3::timestamptz
      WHERE id = $1`,
    [s.id, FIRMA, enDosActos ? CIERRE : FIRMA],
  );
}

/** El unico movimiento del solicitante legacy. */
async function movimientoLegacy() {
  const m = (await movimientos(db, null)).find((x) => x.solicitanteEmail === LEGACY);
  if (!m) throw new Error('la siembra no dejo ningun movimiento de LEGACY');
  return m;
}

describe('CANDADO: a quien atribuye el registro una decision sin sesion', () => {
  it('cerrada en el SEGUNDO nivel: nombra al segundo firmante, no al jefe inmediato', async () => {
    await sembrarCerradaConCascada('aprobada', true);
    expect((await movimientoLegacy()).decididaPor).toEqual({
      nombre: null,
      correo: SEGUNDO_FIRMANTE,
      aproximado: true,
    });
  });

  // El caso que se escapa a simple vista, y por eso tiene test propio: hay
  // segundo firmante y hay primera firma, y aun asi decidio el PRIMERO. El
  // rechazo del jefe inmediato corta la cadena y sella las dos marcas de golpe.
  it('rechazada en el PRIMER nivel: la cascada existe pero decidio el jefe inmediato', async () => {
    await sembrarCerradaConCascada('rechazada', false);
    expect((await movimientoLegacy()).decididaPor).toEqual({
      nombre: null,
      correo: PRIMER_FIRMANTE,
      aproximado: true,
    });
  });
});
