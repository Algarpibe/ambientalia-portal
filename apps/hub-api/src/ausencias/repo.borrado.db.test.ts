import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { borrarSolicitud, decidirSolicitud, solicitudPorId } from './repo.js';
import { construirPayload, construirPayloadBorrado } from './notificaciones.js';
import { transicionAlDecidir, type Solicitud } from './types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from '../test-db/harness.js';

// Que borrar una solicitud deje de abandonar su evento en el Google Calendar.
//
// Todo esto va contra Postgres de verdad porque de lo que trata es de una CLAVE
// AJENA y de una transaccion: el doble in-memory de `router.test.ts` no tiene ni
// una cosa ni la otra, asi que ninguno de estos candados es cazable ahi.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const ADMIN = 'comercial@ambientalia.com.co';

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

async function sembrarPendiente(): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  return sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'pendiente',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });
}

/** Aprobada por la via real, para que tenga su id de evento. */
async function aprobadaConEvento(): Promise<Solicitud> {
  const s = await sembrarPendiente();
  const t = transicionAlDecidir(s, true);
  if (!t) throw new Error('una pendiente siempre tiene transicion');
  const aprobada = await decidirSolicitud(db, s.id, s.estado, t, null, null, construirPayload);
  if (!aprobada) throw new Error('no se pudo aprobar');
  return aprobada;
}

const borrar = (s: Solicitud) => borrarSolicitud(db, s.id, ADMIN, construirPayloadBorrado);

/** Las filas del outbox con su solicitud_id, para ver quien sobrevive. */
async function filasDelOutbox(): Promise<{ evento: string; solicitud_id: string | null }[]> {
  const { rows } = await db.query('SELECT evento, solicitud_id FROM portal.ausencias_outbox ORDER BY id');
  return rows as { evento: string; solicitud_id: string | null }[];
}

describe('borrar una solicitud desde el registro general', () => {
  // ESTE es el que distingue esta forma de las dos que se descartaron: la fila
  // sobrevive a su solicitud, y su `solicitud_id` queda a NULL diciendolo.
  it('CANDADO: el borrado del evento SOBREVIVE a la solicitud, con solicitud_id NULL', async () => {
    const s = await aprobadaConEvento();
    await borrar(s);

    expect(await solicitudPorId(db, s.id)).toBeNull();
    expect(await filasDelOutbox()).toEqual([{ evento: 'borrado_admin', solicitud_id: null }]);
  });

  it('el evento encolado es un borrar contra el id que impusimos', async () => {
    const s = await aprobadaConEvento();
    await borrar(s);

    const { rows } = await db.query('SELECT payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 1');
    const payload = (rows[0] as { payload: { calendario: { accion: string; eventId: string } } }).payload;
    expect(payload.calendario).toMatchObject({ accion: 'borrar', eventId: s.eventoCalendarioId });
  });

  // CANDADO. Lo que hoy hace la cascada, ahora a proposito. Al relajar la clave
  // ajena esa supresion desaparece sola, y empezarian a entregarse correos
  // anunciando una solicitud que ya no existe.
  it('CANDADO: borrar se lleva los correos que seguian sin servirse', async () => {
    const s = await aprobadaConEvento();
    // El `aprobada` de la decision sigue pendiente: n8n no ha pasado.
    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);

    await borrar(s);

    // Solo queda el borrado. El `aprobada` murio con su solicitud.
    expect(await eventosDelOutbox(db)).toEqual(['borrado_admin']);
  });

  // CANDADO. Una `pendiente` nunca llego a Google, asi que no hay nada que
  // avisar — y el cuerpo del correo afirma que si estaba.
  it('CANDADO: borrar una pendiente no encola NADA', async () => {
    const s = await sembrarPendiente();
    await borrar(s);

    expect(await eventosDelOutbox(db)).toEqual([]);
    expect(await solicitudPorId(db, s.id)).toBeNull();
  });

  it('sobre una solicitud que no existe devuelve null y no encola nada', async () => {
    const fantasma = '00000000-0000-4000-8000-000000000000';
    expect(await borrarSolicitud(db, fantasma, ADMIN, construirPayloadBorrado)).toBeNull();
    expect(await eventosDelOutbox(db)).toEqual([]);
  });

  // CANDADO. Los tres pasos y el DELETE de la solicitud van juntos o no van: un
  // fallo del payload no puede dejar el correo dicho ni la fila borrada.
  it('CANDADO: si el aviso revienta, la solicitud NO se queda borrada', async () => {
    const s = await aprobadaConEvento();
    const revienta = () => {
      throw new Error('el constructor del payload ha fallado');
    };

    await expect(borrarSolicitud(db, s.id, ADMIN, revienta)).rejects.toThrow();

    expect(await solicitudPorId(db, s.id)).not.toBeNull();
    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);
  });

  // CANDADO. Separa `estaEnElCalendario` de «hay id». Una aprobada anterior a la
  // migracion 026 no tiene id, y su evento y su fila de la hoja siguen ahi: hay
  // que avisar aunque no se pueda borrar solo. Guardar el paso 2 detras del id
  // dejaria sin aviso justo el caso donde nadie mas va a darse cuenta.
  it('CANDADO: una aprobada SIN id encola el aviso igual, sin accion de calendario', async () => {
    const s = await aprobadaConEvento();
    // Se simula una fila anterior a la 026: aprobada y en Google, pero con un id
    // que nunca apuntamos.
    await db.query('UPDATE portal.solicitudes_ausencia SET evento_calendario_id = NULL WHERE id = $1', [s.id]);

    const releida = await solicitudPorId(db, s.id);
    if (releida === null) throw new Error('la solicitud deberia seguir existiendo');
    await borrar(releida);

    expect(await eventosDelOutbox(db)).toEqual(['borrado_admin']);
    const { rows } = await db.query('SELECT payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 1');
    expect((rows[0] as { payload: { calendario: unknown } }).payload.calendario).toBeNull();
  });
});
