import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { crearModificacion, decidirModificacion, modificacionPorId, solapeDe, solicitudPorId } from './repo.js';
import {
  poolDePrueba,
  limpiar,
  payloadStub,
  sembrarEmpleado,
  sembrarSolicitud,
  eventosDelOutbox,
} from '../test-db/harness.js';

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

  it('CANDADO: solapa con un solo dia en comun; adyacente no', async () => {
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

  it('CANDADO: pendiente_2 (media firma) tambien ocupa', async () => {
    // types.ts avisa de esto mismo sobre el nombre del estado: un filtro
    // descuidado que solo reconozca 'pendiente' contaria media firma como si
    // no existiera, y dejaria pasar una segunda ausencia sobre alguien que
    // todavia no tiene aprobacion completa.
    await sembrarBase('pendiente_2');
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
    const s = await sembrarBase();
    expect(await solapeDe(db, empleadoId, '2026-07-12', '2026-07-12', null)).toMatchObject({
      id: s.id,
      tipo: 'vacaciones',
      estado: 'aprobada',
      fechaInicio: '2026-07-10',
      fechaFin: '2026-07-14',
    });
  });
});

// ── La tercera puerta: firmar el cambio ────────────────────────────────────
//
// Entre PROPONER un cambio de fechas y FIRMARLO puede haberle aprobado otra
// cosa encima: la puerta de `pedirModificacion` miro cuando el destino aun
// estaba libre y no vuelve a mirar. Si nadie comprueba al aprobar, el jefe firma
// un cambio que deja dos ausencias vivas sobre el mismo dia y ya no queda quien
// lo impida. Por eso esta comprobacion vive DENTRO de la transaccion que aplica
// el cambio, al lado del testigo triple: si choca, ROLLBACK y 409.

describe('decidirModificacion frente al solape', () => {
  /** La propuesta de mover la solicitud a `desde`-`hasta`, ya guardada. */
  async function proponerFechas(solicitudId: string, desde: string, hasta: string, dias: number) {
    const alta = await crearModificacion(
      db,
      {
        solicitudId,
        clase: 'fechas',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: desde,
        fechaFinNueva: hasta,
        diasHabilesNuevos: dias,
        motivo: 'Cita medica',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta de la propuesta deberia haber funcionado, y dio ${alta.razon}`);
    return alta.modificacion;
  }

  /** Otra ausencia aprobada el 21, justo encima del destino de la propuesta. */
  const ocuparElDestino = () =>
    sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'aprobada',
      fechaInicio: '2026-07-21',
      fechaFin: '2026-07-21',
      segundoAprobadorCorreo: null,
    });

  it('CANDADO: aprobar una propuesta que se volvio solapada hace ROLLBACK y no toca el outbox', async () => {
    // Se propone mover al 20-22 y, ANTES de que el jefe firme, le aprueban otra
    // ausencia el 21. Firmar ahora dejaria dos ausencias a la vez, y ya no
    // habria quien lo impidiera: esta es la unica puerta que puede verlo.
    const a = await sembrarBase();
    const propuesta = await proponerFechas(a.id, '2026-07-20', '2026-07-22', 3);
    // El destino se ocupa DESPUES de la propuesta.
    await ocuparElDestino();

    // El aviso del alta de la propuesta y nada mas. Se fija aqui para que la
    // comparacion de despues no pueda pasar por estar las dos listas vacias.
    const outboxAntes = await eventosDelOutbox(db);
    expect(outboxAntes).toEqual(['modificacion_solicitada']);

    const decidida = await decidirModificacion(db, propuesta.id, true, null, null, payloadStub);
    // Y nombra CON QUE choca: sin eso el jefe recibe un «no se puede» y no sabe
    // que mirar.
    expect(decidida).toMatchObject({
      ok: false,
      razon: 'solape',
      solape: { fechaInicio: '2026-07-21', fechaFin: '2026-07-21' },
    });

    // El ROLLBACK deshace las TRES escrituras: la propuesta sigue viva...
    expect((await modificacionPorId(db, propuesta.id))?.estado).toBe('pendiente');
    // ...la solicitud conserva sus fechas —si el cambio se hubiera aplicado,
    // quien ocupara el 10-14 no seria ella...
    expect(await solapeDe(db, empleadoId, '2026-07-10', '2026-07-14', null)).toMatchObject({
      id: a.id,
      fechaInicio: '2026-07-10',
      fechaFin: '2026-07-14',
    });
    // ...y no se ha encolado ningun correo anunciando un cambio que no ocurrio.
    expect(await eventosDelOutbox(db)).toEqual(outboxAntes);
  });

  it('aprobar una propuesta que NO solapa aplica las fechas nuevas y encola su aviso', async () => {
    // El camino bueno, y aqui hace falta: sin el, un `throw` mal puesto que
    // rompiera TODAS las aprobaciones dejaria este fichero entero en verde.
    //
    // Las fechas nuevas solapan A PROPOSITO con las viejas. La solicitud tiene
    // que quedar excluida de su propia comprobacion, y si la puerta se pasara el
    // id de la PROPUESTA en vez del de la SOLICITUD, la ausencia chocaria
    // consigo misma y esta aprobacion legitima saldria 409.
    const a = await sembrarBase();
    const propuesta = await proponerFechas(a.id, '2026-07-13', '2026-07-17', 5);

    const decidida = await decidirModificacion(db, propuesta.id, true, null, null, payloadStub);
    expect(decidida.ok).toBe(true);

    expect((await modificacionPorId(db, propuesta.id))?.estado).toBe('aprobada');
    // Las fechas nuevas llegaron a la fila: el 15 no estaba ocupado y ahora lo
    // esta, el 10 lo estaba y ha dejado de estarlo.
    expect(await solapeDe(db, empleadoId, '2026-07-15', '2026-07-15', null)).toMatchObject({ id: a.id });
    expect(await solapeDe(db, empleadoId, '2026-07-10', '2026-07-10', null)).toBeNull();
    expect(await eventosDelOutbox(db)).toEqual(['modificacion_solicitada', 'modificacion_aprobada']);
  });

  it('CANDADO: RECHAZAR una propuesta que se volvio solapada sigue siendo posible', async () => {
    // La puerta mira solo cuando se APRUEBA, y ese `aprueba &&` no es adorno:
    // decir que no no escribe nada en la solicitud, asi que no puede crear
    // ningun solapamiento. Si tambien mirara al rechazar, una propuesta que se
    // quedo solapada seria IRRECHAZABLE —409 al jefe cada vez que lo intentara—
    // y solo el solicitante podria quitarla de en medio retirandola.
    const a = await sembrarBase();
    const propuesta = await proponerFechas(a.id, '2026-07-20', '2026-07-22', 3);
    await ocuparElDestino();

    const decidida = await decidirModificacion(db, propuesta.id, false, 'No procede', null, payloadStub);
    expect(decidida.ok).toBe(true);
    expect((await modificacionPorId(db, propuesta.id))?.estado).toBe('rechazada');
    expect(await eventosDelOutbox(db)).toEqual(['modificacion_solicitada', 'modificacion_rechazada']);
  });

  it('CANDADO: a una incapacidad no la frena el solape, igual que en las otras puertas', async () => {
    // Una incapacidad no se pide, se informa despues de haber estado enfermo: no
    // se le puede negar, y por eso `exigirSinSolape` la exime. Esta puerta corre
    // dentro de la transaccion del repo y no puede llamar a aquel helper, asi que
    // repite la exencion a mano. Si divergen, la puerta de PROPONER deja pasar el
    // cambio por la exencion y la de FIRMAR lo niega con un 409: una autoriza lo
    // que la siguiente prohibe, y la propuesta se queda atascada para siempre.
    //
    // `incapacidad` + `aprobada` no es un fixture imposible: el PATCH de admin
    // acepta cualquier tipo con cualquier estado.
    const baja = await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'aprobada',
      tipo: 'incapacidad',
      fechaInicio: '2026-07-10',
      fechaFin: '2026-07-14',
      segundoAprobadorCorreo: null,
    });
    // Y unas vacaciones aprobadas justo donde se quiere mover la baja.
    await ocuparElDestino();

    const propuesta = await proponerFechas(baja.id, '2026-07-20', '2026-07-22', 3);
    const decidida = await decidirModificacion(db, propuesta.id, true, null, null, payloadStub);

    expect(decidida.ok).toBe(true);
    // Y el cambio se aplico de verdad: `solapeDe` no sirve para verlo —una
    // incapacidad nunca sale de esa consulta—, asi que se mira la fila.
    expect(await solicitudPorId(db, baja.id)).toMatchObject({
      fechaInicio: '2026-07-20',
      fechaFin: '2026-07-22',
    });
  });
});
