import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { decidirSolicitud, solicitudPorId, crearModificacion, modificacionesPendientes } from './repo.js';
import { transicionAlDecidir, decisorDeModificacion, type Solicitud } from './types.js';
import {
  poolDePrueba,
  limpiar,
  payloadStub,
  sembrarEmpleado,
  sembrarSolicitud,
  eventosDelOutbox,
} from '../test-db/harness.js';

const CORREO = 'ana.ruiz@ambientalia.com.co';

let db: Pool;

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  // Con `?`: si `beforeAll` revienta, `db` se queda sin asignar y el TypeError
  // de este cierre taparia en el informe el error que de verdad importa.
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

/**
 * La solicitud de partida de cada caso. Solo varian el estado y si hay cascada:
 * las fechas y el correo son los mismos en todos, y repetirlos en cada test
 * enterraria lo unico que cada uno cambia.
 *
 * `segundoAprobadorCorreo` va a null por defecto —una sola firma— porque a casi
 * ningun caso le importa. Pero en cuanto un test toque `decisorDeModificacion` o
 * `aprobador_correo`, la cascada deja de ser decorado: es la que hace que el
 * turno cambie al avanzar de estado, y sin ella la carrera no tiene victima.
 * Pasarlo entonces explicitamente.
 */
async function sembrarCaso(
  estado: Solicitud['estado'],
  segundoAprobadorCorreo: string | null = null,
): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  return sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo,
  });
}

describe('decidirSolicitud contra Postgres real', () => {
  it('CANDADO: el doble clic del jefe decide UNA vez, no dos', async () => {
    // Las dos peticiones leen `pendiente` antes de que ninguna escriba, asi que
    // las dos calculan la MISMA transicion y llegan con el mismo testigo. Sin el
    // `AND estado = $7` las dos escribirian, y saldrian dos correos.
    const s = await sembrarCaso('pendiente', 'jefe2@ambientalia.com.co');

    const transicion = transicionAlDecidir(s, true);
    if (!transicion) throw new Error('una solicitud pendiente siempre tiene transicion');

    const primera = await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub);
    const segunda = await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub);

    expect(primera?.estado).toBe('pendiente_2');
    // El servicio traduce este null a 409. Es un conflicto, no un fallo.
    expect(segunda).toBeNull();

    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('pendiente_2');
    // UN aviso al segundo firmante, no dos.
    expect(await eventosDelOutbox(db)).toEqual(['aprobacion_2']);
  });
});

describe('crearModificacion contra Postgres real', () => {
  it('CANDADO: si la solicitud avanza de nivel mientras escribes, la propuesta NO se congela con el decisor equivocado', async () => {
    // Lo que este testigo protege NO es `estado_previo`: eso sale de `s.estado`
    // en la misma sentencia y es cierto con testigo y sin el. Es
    // `aprobador_correo`, que el servicio calculo ANTES con el estado viejo. Si
    // el jefe inmediato firma entre medias, la propuesta queda a nombre de quien
    // ya salio del turno — y la bandeja, el guard y el correo del alta filtran
    // los tres por ese campo, asi que el segundo firmante no la ve nunca y la
    // decide quien no toca.
    const s = await sembrarCaso('pendiente', 'jefe2@ambientalia.com.co');
    const decisorLeido = decisorDeModificacion(s);
    if (!decisorLeido) throw new Error('una pendiente siempre tiene decisor');
    expect(decisorLeido).toBe('jefe1@ambientalia.com.co');

    // El jefe inmediato firma entre que el servicio leyo el estado y llega el
    // INSERT: la solicitud pasa a `pendiente_2` y el turno es del segundo. Con
    // `decidirSolicitud` y no con un UPDATE a pelo: es la transicion que produce
    // produccion, con sus marcas de firma y su evento.
    const transicion = transicionAlDecidir(s, true);
    if (!transicion) throw new Error('una solicitud pendiente siempre tiene transicion');
    await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub);

    const r = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'pendiente',
        fechaInicioNueva: '2026-07-13',
        fechaFinNueva: '2026-07-17',
        diasHabilesNuevos: 5,
        motivo: 'Cita medica',
        aprobadorCorreo: decisorLeido,
      },
      payloadStub,
    );

    expect(r).toEqual({ ok: false, razon: 'estado' });

    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.solicitud_modificaciones');
    expect((rows[0] as { n: number }).n).toBe(0);
    // La asercion que nombra el dano: ninguna bandeja de cambios, y menos la del
    // firmante que ya salio del turno.
    expect(await modificacionesPendientes(db, 'jefe1@ambientalia.com.co', false)).toEqual([]);
    // Solo el aviso al segundo firmante: el alta no encolo nada.
    expect(await eventosDelOutbox(db)).toEqual(['aprobacion_2']);
  });
});
