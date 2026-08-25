import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearSolicitud, decidirSolicitud, solicitudPorId, crearModificacion, decidirModificacion } from './repo.js';
import { construirPayload, idDeEventoCalendario, construirPayloadModificacion } from './notificaciones.js';
import { transicionAlDecidir, type Solicitud } from './types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from '../test-db/harness.js';

// De que evento de Google es duena cada solicitud, contra Postgres de verdad.
//
// La columna `evento_calendario_id` es la que decide si una anulacion o una
// reprogramacion se corrigen solas en el calendario o si el correo tiene que
// seguir pidiendo el ajuste a mano. Se escribe DENTRO de la transaccion que
// encola el evento del outbox, y esa atomicidad es justo lo que un doble
// in-memory no puede probar: ahi no hay ni transaccion ni ROLLBACK.
//
// Estos tests usan el `construirPayload` REAL y no el `payloadStub` del harness:
// lo que se prueba es que la marca sale del payload, asi que un stub sin
// `calendario` no probaria nada.

const CORREO = 'ana.ruiz@ambientalia.com.co';

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

/** El id anotado en la fila, leido de la base y no del objeto que devolvio el repo. */
async function idEnLaBase(id: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT evento_calendario_id FROM portal.solicitudes_ausencia WHERE id = $1`, [id]);
  return (rows[0] as { evento_calendario_id: string | null }).evento_calendario_id;
}

async function sembrarCaso(estado: Solicitud['estado']): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  return sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });
}

/** La transicion, sin el `| null` que aqui nunca ocurre. */
function transicionDe(s: Solicitud, aprueba: boolean) {
  const t = transicionAlDecidir(s, aprueba);
  if (!t) throw new Error('una solicitud pendiente siempre tiene transicion');
  return t;
}

const aprobar = (s: Solicitud) =>
  decidirSolicitud(db, s.id, s.estado, transicionDe(s, true), null, null, construirPayload, construirPayloadModificacion);

/** Pide una anulacion y la aprueba, que es como se borra un evento de verdad. */
async function anularPorModificacion(s: Solicitud): Promise<void> {
  const alta = await crearModificacion(
    db,
    {
      solicitudId: s.id,
      clase: 'anulacion',
      // El testigo compara con el estado REAL de la fila; una `aprobada` recien
      // decidida lo cumple.
      estadoEsperado: s.estado,
      // Los tres a null los EXIGE el CHECK `modificaciones_campos_por_clase` de
      // la 024 para una anulacion.
      fechaInicioNueva: null,
      fechaFinNueva: null,
      diasHabilesNuevos: null,
      motivo: 'ya no las necesito',
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
    },
    construirPayloadModificacion,
  );
  if (!alta.ok) throw new Error(`el alta de la propuesta deberia haber funcionado, y dio ${alta.razon}`);

  const decidida = await decidirModificacion(db, alta.modificacion.id, true, null, null, construirPayloadModificacion);
  if (!decidida.ok) throw new Error(`la decision deberia haber funcionado, y dio ${decidida.razon}`);
}

describe('la marca del evento de calendario', () => {
  it('nace vacia: una solicitud pendiente no ha creado ningun evento', async () => {
    const s = await sembrarCaso('pendiente');
    expect(s.eventoCalendarioId).toBeNull();
    expect(await idEnLaBase(s.id)).toBeNull();
  });

  it('CANDADO: aprobar anota el id, y es el MISMO que viaja en el payload', async () => {
    const s = await sembrarCaso('pendiente');
    const decidida = await aprobar(s);

    const esperado = idDeEventoCalendario(s.id);
    expect(await idEnLaBase(s.id)).toBe(esperado);
    // Si estos dos se separaran, la fila apuntaria a un evento que Google no
    // creo nunca, y la correccion posterior daria un 404 en silencio.
    const { rows } = await db.query(`SELECT payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 1`);
    expect((rows[0] as { payload: { calendario: { eventId: string; accion: string } } }).payload.calendario).toMatchObject(
      { eventId: esperado, accion: 'crear' },
    );

    // Y la solicitud que se devuelve lo lleva ya: se leyo con SELECT_SOLICITUD
    // ANTES del UPDATE, asi que sin cuidado devolveria un null caducado.
    expect(decidida?.eventoCalendarioId).toBe(esperado);
  });

  it('CANDADO: rechazar NO anota nada, porque no crea evento', async () => {
    const s = await sembrarCaso('pendiente');
    await decidirSolicitud(db, s.id, s.estado, transicionDe(s, false), 'No procede', null, construirPayload, construirPayloadModificacion);

    expect(await eventosDelOutbox(db)).toEqual(['rechazada']);
    // Un rechazo lleva `hoja` pero no `calendario`: no hay ausencia que pintar,
    // asi que tampoco hay nada de lo que ser dueno.
    expect(await idEnLaBase(s.id)).toBeNull();
  });

  it('CANDADO: una incapacidad tambien nace con su id anotado', async () => {
    // `registrada` es el otro evento que crea calendario, y no pasa por
    // `decidirSolicitud`: se anota en el alta. Es el caso que se olvida.
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const s = await crearSolicitud(
      db,
      {
        tipo: 'incapacidad',
        empleadoId,
        solicitanteEmail: CORREO,
        fechaInicio: '2026-07-06',
        fechaFin: '2026-07-10',
        diasHabiles: 5,
        horaInicio: null,
        horaFin: null,
        comentarios: null,
        estado: 'registrada',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
        segundoAprobadorCorreo: null,
        informadoCorreo: null,
      },
      null,
      ['registrada'],
      construirPayload,
    );

    expect(await idEnLaBase(s.id)).toBe(idDeEventoCalendario(s.id));
    expect(s.eventoCalendarioId).toBe(idDeEventoCalendario(s.id));
  });

  it('CANDADO: el doble clic del jefe deja UN evento y UNA marca', async () => {
    const s = await sembrarCaso('pendiente');
    const transicion = transicionDe(s, true);

    // Las dos con el MISMO estado esperado, que es lo que manda el servicio
    // cuando dos peticiones leen la solicitud antes de que ninguna escriba.
    const [a, b] = await Promise.all([
      decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, construirPayload, construirPayloadModificacion),
      decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, construirPayload, construirPayloadModificacion),
    ]);

    // Una gana y la otra se va de vacio por el testigo `AND estado = $7`.
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);
    expect(await idEnLaBase(s.id)).toBe(idDeEventoCalendario(s.id));
  });

  it('CANDADO: la marca viaja en la solicitud que leen las pantallas', async () => {
    // Si `SELECT_SOLICITUD` se dejara la columna, `construirPayloadModificacion`
    // veria `undefined`, no entraria por la guarda de `null` y emitiria una
    // correccion con `eventId: undefined`. El fallo no se veria hasta Google.
    const s = await sembrarCaso('pendiente');
    await aprobar(s);
    const leida = await solicitudPorId(db, s.id);
    expect(leida?.eventoCalendarioId).toBe(idDeEventoCalendario(s.id));
  });

  // CANDADO. La columna significa "hay un evento vivo en Google", no "impusimos
  // un id alguna vez". Sin el vaciado, una fila anulada conserva el id de un
  // evento borrado, y la siguiente correccion mandaria un `actualizar` contra
  // algo que no existe: n8n lo tragaria como 404 esperable, en silencio.
  it('CANDADO: anular vacia el id, porque el evento ya no existe en Google', async () => {
    const s = await sembrarCaso('pendiente');
    const aprobada = await aprobar(s);
    expect(await idEnLaBase(s.id)).toBe(idDeEventoCalendario(s.id));

    await anularPorModificacion(aprobada!);

    expect(await idEnLaBase(s.id)).toBeNull();
  });
});
