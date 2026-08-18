import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  decidirSolicitud,
  solicitudPorId,
  crearModificacion,
  decidirModificacion,
  modificacionPorId,
  modificacionesPendientes,
} from './repo.js';
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

    // El rojo tiene que decir QUE se colo, no solo que se colo: sin esto el diff
    // elide los 17 campos de la propuesta y el decisor obsoleto —lo unico que
    // protege el testigo— no aparece por ningun lado.
    if (r.ok) {
      throw new Error(
        `el testigo dejo pasar la propuesta, congelada a nombre de ${r.modificacion.aprobadorCorreo} cuando el turno es de jefe2@ambientalia.com.co`,
      );
    }

    expect(r).toEqual({ ok: false, razon: 'estado' });

    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.solicitud_modificaciones');
    expect((rows[0] as { n: number }).n).toBe(0);
    // Esto no prueba nada por su cuenta: en verde es redundante con el
    // count(*) = 0 de dos lineas arriba, y en rojo no llega a ejecutarse porque
    // Vitest aborta en el primer expect que falla. Esta aqui para que el lector
    // vea cual era la consecuencia —la bandeja del firmante que ya salio del
    // turno—, no para demostrarla.
    expect(await modificacionesPendientes(db, 'jefe1@ambientalia.com.co', false)).toEqual([]);
    // Solo el aviso al segundo firmante: el alta no encolo nada.
    expect(await eventosDelOutbox(db)).toEqual(['aprobacion_2']);
  });
});

describe('el testigo TRIPLE de aplicarALaSolicitud', () => {
  it('CANDADO: aprobar un cambio NO pisa la correccion que un admin hizo por PATCH', async () => {
    // Los tres campos hacen falta. Solo con el estado no se detecta que un admin
    // haya corregido las fechas entre medias, y la aprobacion se las pisaria EN
    // SILENCIO: el PATCH no encola nada, asi que nadie se enteraria nunca.
    const s = await sembrarCaso('aprobada');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: '2026-07-13',
        fechaFinNueva: '2026-07-17',
        diasHabilesNuevos: 5,
        motivo: 'Cita medica',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta deberia haber funcionado, y dio ${alta.razon}`);

    // El admin corrige las fechas por PATCH. No encola nada.
    await db.query(
      `UPDATE portal.solicitudes_ausencia
          SET fecha_inicio = '2026-07-07', fecha_fin = '2026-07-11'
        WHERE id = $1`,
      [s.id],
    );

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r).toEqual({ ok: false, razon: 'solicitud_cambio_de_estado' });

    // El ROLLBACK de verdad: el paso 1 YA habia escrito «aprobada» sobre la
    // propuesta cuando el paso 2 choco, y solo deshacer la transaccion entera lo
    // devuelve a `pendiente`.
    const m = await modificacionPorId(db, alta.modificacion.id);
    expect(m?.estado).toBe('pendiente');

    // La correccion del admin sigue en pie.
    const final = await solicitudPorId(db, s.id);
    expect(final?.fechaInicio).toBe('2026-07-07');
    expect(final?.fechaFin).toBe('2026-07-11');

    // Y no ha salido ningun correo anunciando un cambio que no ha ocurrido: en
    // el outbox solo esta el aviso del alta de la propuesta.
    expect(await eventosDelOutbox(db)).toEqual(['modificacion_solicitada']);
  });
});

describe('el indice unico parcial de la 024', () => {
  it('CANDADO: la segunda propuesta viva la corta la BASE, y el codigo la reconoce por su nombre', async () => {
    // Esta carrera no la puede cortar una comprobacion en JS: dos peticiones
    // simultaneas pasarian las dos antes de que ninguna escribiera. Y el `catch`
    // exige el NOMBRE del constraint, asi que el que emite Postgres y el que
    // compara el codigo tienen que ser el mismo. Con un pool falso eso es
    // circular: el test se inventa el nombre que el codigo espera.
    const s = await sembrarCaso('aprobada');

    const datos = {
      solicitudId: s.id,
      clase: 'fechas' as const,
      estadoEsperado: 'aprobada' as const,
      fechaInicioNueva: '2026-07-13',
      fechaFinNueva: '2026-07-17',
      diasHabilesNuevos: 5,
      motivo: 'Cita medica',
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
    };

    const primera = await crearModificacion(db, datos, payloadStub);
    expect(primera.ok).toBe(true);

    const segunda = await crearModificacion(db, datos, payloadStub);
    expect(segunda).toEqual({ ok: false, razon: 'duplicada' });

    const { rows } = await db.query('SELECT count(*)::int AS n FROM portal.solicitud_modificaciones');
    expect((rows[0] as { n: number }).n).toBe(1);
  });
});

describe('lo que escribe aprobar una modificacion', () => {
  it('CANDADO: aprobar un cambio de fechas NO re-decide la solicitud', async () => {
    // Aprobar un cambio no es decidir la solicitud. Si el SET tocara `estado`,
    // una `pendiente` quedaria concedida sin que ningun firmante la firmara.
    const s = await sembrarCaso('pendiente');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'pendiente',
        fechaInicioNueva: '2026-07-13',
        fechaFinNueva: '2026-07-17',
        diasHabilesNuevos: 5,
        motivo: 'Cita medica',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta deberia haber funcionado, y dio ${alta.razon}`);

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r.ok).toBe(true);

    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('pendiente');
    expect(final?.fechaInicio).toBe('2026-07-13');
    expect(final?.anuladaAt).toBeNull();
  });

  it('CANDADO: anular deja rechazada + anulada_at, y NO toca las fechas', async () => {
    // Anular no estrena estado: `rechazada` ya hereda la semantica correcta en
    // los seis filtros que miran el estado, y `anulada_at` es lo unico que la
    // distingue de un rechazo del jefe. Las fechas se conservan: la ausencia
    // anulada sigue diciendo cual era.
    const s = await sembrarCaso('aprobada');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'anulacion',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: null,
        fechaFinNueva: null,
        diasHabilesNuevos: null,
        motivo: 'Se cancelo el viaje',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta deberia haber funcionado, y dio ${alta.razon}`);

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r.ok).toBe(true);

    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('rechazada');
    expect(final?.anuladaAt).not.toBeNull();
    expect(final?.fechaInicio).toBe('2026-07-06');
    expect(final?.fechaFin).toBe('2026-07-10');
  });
});
