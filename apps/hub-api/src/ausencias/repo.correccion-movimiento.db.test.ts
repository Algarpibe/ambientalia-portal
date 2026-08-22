import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  borrarModificacion,
  borrarSolicitud,
  corregirModificacion,
  crearModificacion,
  decidirModificacion,
  modificacionPorId,
  solicitudPorId,
} from './repo.js';
import { decisorDeModificacion, type Modificacion } from './types.js';
import { poolDePrueba, limpiar, payloadStub, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// Corregir y borrar a mano un MOVIMIENTO del registro (una anulacion o un cambio
// de fechas ya cerrados), contra Postgres de verdad.
//
// ⚠️ Este fichero es el unico sitio donde se puede acreditar lo que de verdad
// importa de estas dos funciones, y por eso existe: que TOCAN SOLO la fila del
// movimiento. Los candados equivalentes de router.test.ts corren contra el doble
// en memoria, o sea contra un objeto que yo mismo escribi para que no tocara la
// solicitud; lo que aqui se ejecuta es el UPDATE y el DELETE reales.
//
// La confusion que vigilan es concreta: pasar una anulacion aprobada a
// `rechazada` NO desanula la solicitud, y borrar esa anulacion tampoco la
// devuelve a la vida. Es lo que se le explica al admin en el modal, y tiene que
// seguir siendo cierto.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const JEFE = 'jefe1@ambientalia.com.co';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

/**
 * Una solicitud aprobada con un movimiento YA DECIDIDO colgando.
 *
 * Se pasa por `crearModificacion` y `decidirModificacion` en vez de insertar la
 * fila a pelo: lo que estos tests afirman que NO se mueve es justo lo que esas
 * dos funciones escriben —`decidida_at`, `aprobador_user_id`, `estado_previo`,
 * las fechas previas—, y un INSERT a mano las pondria a lo que a mi me
 * conviniera en vez de a lo que produccion deja.
 */
async function conMovimiento(clase: 'anulacion' | 'fechas') {
  const empleadoId = await sembrarEmpleado(db, CORREO, JEFE);
  const s = await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'aprobada',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });

  const nuevas =
    clase === 'anulacion'
      ? { fechaInicioNueva: null, fechaFinNueva: null, diasHabilesNuevos: null }
      : { fechaInicioNueva: '2026-07-13', fechaFinNueva: '2026-07-17', diasHabilesNuevos: 5 };

  const alta = await crearModificacion(
    db,
    {
      solicitudId: s.id,
      clase,
      estadoEsperado: 'aprobada',
      ...nuevas,
      motivo: 'Motivo original',
      aprobadorCorreo: JEFE,
    },
    payloadStub,
  );
  if (!alta.ok) throw new Error(`no se pudo sembrar la propuesta: ${alta.razon}`);

  const decidida = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
  if (!decidida.ok) throw new Error(`no se pudo decidir la propuesta: ${decidida.razon}`);

  return { solicitudId: s.id, modificacionId: alta.modificacion.id };
}

/** La fila de la modificacion, ya sabiendo que existe. */
async function leer(id: string): Promise<Modificacion> {
  const m = await modificacionPorId(db, id);
  if (!m) throw new Error(`la modificacion ${id} no existe`);
  return m;
}

describe('corregirModificacion', () => {
  it('escribe los cinco campos corregibles de un cambio de fechas', async () => {
    const { modificacionId } = await conMovimiento('fechas');

    const r = await corregirModificacion(db, modificacionId, {
      fechaInicioNueva: '2026-07-20',
      fechaFinNueva: '2026-07-21',
      diasHabilesNuevos: 2,
      motivo: 'Motivo corregido',
      estado: 'rechazada',
    });

    expect(r).toMatchObject({
      fechaInicioNueva: '2026-07-20',
      fechaFinNueva: '2026-07-21',
      diasHabilesNuevos: 2,
      motivo: 'Motivo corregido',
      estado: 'rechazada',
    });
    // Y quedo escrito, no solo devuelto: el RETURNING de la funcion relee por su
    // cuenta, asi que sin este segundo viaje un UPDATE sin WHERE efectivo podria
    // devolver lo correcto sin haber guardado nada.
    expect(await leer(modificacionId)).toMatchObject({ estado: 'rechazada', diasHabilesNuevos: 2 });
  });

  it('CANDADO: corregir el asiento NO toca la solicitud', async () => {
    // El candado central. Aprobar el cambio movio las fechas de la solicitud al
    // 13-17; corregir el asiento al 20-21 tiene que dejarla donde esta.
    const { solicitudId, modificacionId } = await conMovimiento('fechas');
    const antes = await solicitudPorId(db, solicitudId);
    expect(antes).toMatchObject({ fechaInicio: '2026-07-13', fechaFin: '2026-07-17' });

    await corregirModificacion(db, modificacionId, {
      fechaInicioNueva: '2026-07-20',
      fechaFinNueva: '2026-07-21',
      diasHabilesNuevos: 2,
      motivo: null,
      estado: 'rechazada',
    });

    const despues = await solicitudPorId(db, solicitudId);
    expect(despues).toMatchObject({
      fechaInicio: '2026-07-13',
      fechaFin: '2026-07-17',
      diasHabiles: antes?.diasHabiles,
      estado: antes?.estado,
    });
  });

  it('CANDADO: corregir una anulacion NO desanula la solicitud', async () => {
    // La otra clase, y el caso que un admin va a hacer de verdad. Aprobar la
    // anulacion dejo la solicitud `rechazada` con `anulada_at`; pasar el asiento
    // a `rechazada` no revierte ninguna de las dos cosas.
    const { solicitudId, modificacionId } = await conMovimiento('anulacion');
    const antes = await solicitudPorId(db, solicitudId);
    expect(antes?.anuladaAt).not.toBeNull();

    await corregirModificacion(db, modificacionId, {
      fechaInicioNueva: null,
      fechaFinNueva: null,
      diasHabilesNuevos: null,
      motivo: 'Se anulo por error',
      estado: 'rechazada',
    });

    const despues = await solicitudPorId(db, solicitudId);
    expect(despues?.estado).toBe(antes?.estado);
    expect(despues?.anuladaAt).toBe(antes?.anuladaAt);
  });

  it('CANDADO: no toca el testigo de QUIEN decidio, ni CUANDO, ni la clase', async () => {
    // El UPDATE lleva cinco columnas y solo cinco. Corregir lo que se decidio es
    // arreglar un dato; corregir quien lo decidio es falsificarlo, y este
    // registro existe para conservarlo. La clase queda fuera ademas porque es
    // la que decide que columnas pueden ir a NULL (el CHECK de la 024).
    const { modificacionId } = await conMovimiento('anulacion');
    const antes = await leer(modificacionId);

    await corregirModificacion(db, modificacionId, {
      fechaInicioNueva: null,
      fechaFinNueva: null,
      diasHabilesNuevos: null,
      motivo: 'otro',
      estado: 'retirada',
    });

    const despues = await leer(modificacionId);
    expect(despues.decididaAt).toBe(antes.decididaAt);
    expect(despues.clase).toBe(antes.clase);
    expect(despues.solicitudId).toBe(antes.solicitudId);
    expect(despues.aprobadorCorreo).toBe(antes.aprobadorCorreo);
    expect(despues.solicitanteEmail).toBe(antes.solicitanteEmail);
    // La foto del momento en que se pidio: si esta se moviera, el registro
    // dejaria de poder decir DE que fechas se venia.
    expect(despues.estadoPrevio).toBe(antes.estadoPrevio);
    expect(despues.fechaInicioPrevia).toBe(antes.fechaInicioPrevia);
    expect(despues.fechaFinPrevia).toBe(antes.fechaFinPrevia);
    expect(despues.diasHabilesPrevios).toBe(antes.diasHabilesPrevios);
  });

  it('CANDADO: no se lleva por delante los movimientos HERMANOS', async () => {
    // Dos movimientos sobre la misma solicitud. Un UPDATE con el WHERE puesto
    // sobre `solicitud_id` en vez de sobre `id` los corregiria los dos, y el
    // sintoma seria un registro que cambia una fila que nadie toco.
    const { solicitudId, modificacionId } = await conMovimiento('fechas');
    const segunda = await crearModificacion(
      db,
      {
        solicitudId,
        clase: 'anulacion',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: null,
        fechaFinNueva: null,
        diasHabilesNuevos: null,
        motivo: 'La segunda',
        aprobadorCorreo: JEFE,
      },
      payloadStub,
    );
    if (!segunda.ok) throw new Error('no se pudo sembrar la segunda propuesta');

    await corregirModificacion(db, modificacionId, {
      fechaInicioNueva: '2026-07-20',
      fechaFinNueva: '2026-07-21',
      diasHabilesNuevos: 2,
      motivo: 'corregida',
      estado: 'rechazada',
    });

    const hermana = await leer(segunda.modificacion.id);
    expect(hermana.motivo).toBe('La segunda');
    expect(hermana.estado).toBe('pendiente');
  });

  it('un id inexistente devuelve null y no escribe nada', async () => {
    const fantasma = '00000000-0000-4000-8000-000000000000';
    expect(
      await corregirModificacion(db, fantasma, {
        fechaInicioNueva: null,
        fechaFinNueva: null,
        diasHabilesNuevos: null,
        motivo: 'x',
        estado: 'aprobada',
      }),
    ).toBeNull();
  });
});

describe('borrarModificacion', () => {
  it('borra la fila y devuelve lo que era, leido ANTES del DELETE', async () => {
    // El valor de retorno no es un adorno: lo usa el log de hub-api, que es el
    // unico rastro que queda de un borrado irreversible. Si se leyera despues
    // seria siempre null.
    const { modificacionId } = await conMovimiento('anulacion');

    const borrada = await borrarModificacion(db, modificacionId);
    expect(borrada).toMatchObject({ id: modificacionId, clase: 'anulacion', estado: 'aprobada' });
    expect(await modificacionPorId(db, modificacionId)).toBeNull();
  });

  it('CANDADO: la SOLICITUD se queda, y sigue anulada', async () => {
    // Borrar la anulacion no deshace la anulacion. Es lo que hace que esto sea
    // de admin: la solicitud queda anulada y sin nada en el registro que
    // explique por que.
    const { solicitudId, modificacionId } = await conMovimiento('anulacion');
    const antes = await solicitudPorId(db, solicitudId);

    await borrarModificacion(db, modificacionId);

    const despues = await solicitudPorId(db, solicitudId);
    expect(despues).not.toBeNull();
    expect(despues?.estado).toBe(antes?.estado);
    expect(despues?.anuladaAt).toBe(antes?.anuladaAt);
  });

  it('CANDADO: se lleva UNA fila, no las de sus hermanos', async () => {
    // El DELETE por `id`. Con el WHERE sobre `solicitud_id`, borrar un asiento
    // vaciaria el historial entero de esa solicitud de una vez.
    const { solicitudId, modificacionId } = await conMovimiento('fechas');
    const segunda = await crearModificacion(
      db,
      {
        solicitudId,
        clase: 'anulacion',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: null,
        fechaFinNueva: null,
        diasHabilesNuevos: null,
        motivo: 'La segunda',
        aprobadorCorreo: JEFE,
      },
      payloadStub,
    );
    if (!segunda.ok) throw new Error('no se pudo sembrar la segunda propuesta');

    await borrarModificacion(db, modificacionId);

    expect(await modificacionPorId(db, modificacionId)).toBeNull();
    expect(await modificacionPorId(db, segunda.modificacion.id)).not.toBeNull();
  });

  it('un id inexistente devuelve null', async () => {
    expect(await borrarModificacion(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('el camino CONTRARIO sigue en pie: borrar la solicitud arrastra sus movimientos', async () => {
    // El ON DELETE CASCADE de la 024, que es lo que hacia que hasta ahora un
    // asiento solo se pudiera quitar llevandose la solicitud entera. Se fija
    // aqui porque la ruta nueva invita a creer que lo sustituye, y no: son dos
    // borrados distintos con dos alcances distintos, y el modal de confirmacion
    // le dice al admin cual es cual.
    const { solicitudId, modificacionId } = await conMovimiento('anulacion');

    expect(await borrarSolicitud(db, solicitudId, 'admin@ambientalia.com.co', () => payloadStub())).not.toBeNull();

    expect(await solicitudPorId(db, solicitudId)).toBeNull();
    expect(await modificacionPorId(db, modificacionId)).toBeNull();
  });
});

// `decisorDeModificacion` se importa solo para que el dia que cambie la regla
// del turno este fichero deje de compilar si su siembra se desincroniza: la
// propuesta se congela a nombre de quien decide, y `conMovimiento` lo da por
// hecho pasando JEFE a pelo.
void decisorDeModificacion;
