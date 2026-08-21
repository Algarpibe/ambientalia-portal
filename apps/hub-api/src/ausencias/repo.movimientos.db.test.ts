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
