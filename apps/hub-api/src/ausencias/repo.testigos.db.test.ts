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

    const primera = await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub, payloadStub);
    const segunda = await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub, payloadStub);

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
    await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub, payloadStub);

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
    // SILENCIO: el aviso que el PATCH encola habla de la correccion, no de que
    // se la pisen despues, asi que del pisoton no se enteraria nadie nunca.
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

    // El admin corrige las fechas. Se simula con un UPDATE pelado y no llamando
    // al PATCH: asi el outbox de este test cuenta SOLO lo que provoca la
    // decision de la propuesta, que es lo que aqui se mira.
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

  it('CANDADO: aprobar un cambio NO se aplica sobre una solicitud que ya avanzo de nivel', async () => {
    // El tercer campo del testigo, el que las fechas no cubren. La propuesta se
    // pidio sobre una solicitud en tramite y se aprobaria sobre otra que ya lleva
    // una firma mas. Y aprobar el cambio NO re-decide la solicitud —el SET de la
    // rama de fechas no toca `estado`—, asi que sin `AND estado = $2` el cambio
    // se aplicaria a una fila que ya no es la que se fotografio, sin 409 y sin
    // que nadie se entere.
    const s = await sembrarCaso('pendiente', 'jefe2@ambientalia.com.co');

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

    // La solicitud avanza de nivel entre medias. Con un UPDATE a pelo y NO con
    // `decidirSolicitud`, y el cambio es del 2026-08-22: desde que firmar caduca
    // la propuesta viva en la misma transaccion, pasar por `decidirSolicitud`
    // dejaria la propuesta en `caducada` y `decidirModificacion` contestaria
    // `ya_decidida` — o sea que este test probaria el cierre automatico y no el
    // testigo, que es lo que dice su nombre.
    //
    // El UPDATE directo no es un atajo: modela EXACTAMENTE lo que el testigo
    // existe para cazar, que es la CARRERA. `decidirModificacion` lee la
    // propuesta y escribe sobre la solicitud dentro de una transaccion, y entre
    // esas dos cosas la fila puede haberse movido por una via que no caduca nada
    // —el PATCH de admin, o una firma concurrente que todavia no ha hecho
    // commit—. Las fechas NO se tocan, asi que los otros dos campos del testigo
    // siguen casando y este choque solo lo puede ver el campo `estado`.
    await db.query(
      `UPDATE portal.solicitudes_ausencia SET estado = 'pendiente_2', primera_firma_at = now() WHERE id = $1`,
      [s.id],
    );

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r).toEqual({ ok: false, razon: 'solicitud_cambio_de_estado' });

    // El ROLLBACK deshace el paso 1: la propuesta vuelve a esperar decision.
    const m = await modificacionPorId(db, alta.modificacion.id);
    expect(m?.estado).toBe('pendiente');

    // La firma del jefe sigue en pie y las fechas siguen siendo las originales:
    // el cambio no se colo por debajo.
    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('pendiente_2');
    expect(final?.fechaInicio).toBe('2026-07-06');
    expect(final?.fechaFin).toBe('2026-07-10');
  });

  it('CANDADO: firmar la solicitud CADUCA la propuesta viva, antes de que el testigo tenga que actuar', async () => {
    // La pareja del de arriba, y la razon por la que aquel tuvo que dejar de
    // usar `decidirSolicitud`. Son dos defensas distintas sobre el mismo choque:
    //
    //  · El testigo es la de dentro de la transaccion, contra la carrera.
    //  · Esta es la de fuera: cuando la solicitud se decide POR LA VIA NORMAL, la
    //    propuesta se cierra en el acto en vez de quedarse `pendiente` para
    //    siempre esperando un 409 que nadie iba a resolver.
    //
    // Y lo que de verdad arregla es que sale del indice unico parcial: mientras
    // estuvo `pendiente`, esa fila muerta impedia pedir otro cambio.
    const s = await sembrarCaso('pendiente', 'jefe2@ambientalia.com.co');

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

    const transicion = transicionAlDecidir(s, true);
    if (!transicion) throw new Error('una solicitud pendiente siempre tiene transicion');
    await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub, payloadStub);

    const m = await modificacionPorId(db, alta.modificacion.id);
    expect(m?.estado).toBe('caducada');

    // Y el hueco queda libre: se puede pedir otro cambio sobre la misma
    // solicitud. Es la mitad funcional, y la que se pierde si alguien cambia el
    // estado nuevo por uno que el indice unico siga contando.
    const otra = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'anulacion',
        estadoEsperado: 'pendiente_2',
        fechaInicioNueva: null,
        fechaFinNueva: null,
        diasHabilesNuevos: null,
        motivo: 'Ya no las necesito',
        aprobadorCorreo: 'jefe2@ambientalia.com.co',
      },
      payloadStub,
    );
    expect(otra.ok).toBe(true);

    // Y se le avisa al trabajador, que es el unico que no se entera por otra via.
    expect(await eventosDelOutbox(db)).toContain('modificacion_caducada');
  });

  it('CANDADO: caducar toca SOLO la viva, no las que ya estaban cerradas', async () => {
    // El mutante que muere aqui es quitarle el `AND estado = 'pendiente'` al
    // UPDATE que caduca. Sin ese filtro, firmar una solicitud reescribiria el
    // historial entero de sus peticiones: una que el jefe habia RECHAZADO en su
    // dia pasaria a «caducada», y el registro dejaria de decir que hubo un
    // rechazo. Y ademas mandaria un aviso por cada firma.
    //
    // No lo cazaba nada: el test de aqui arriba solo tiene una propuesta y esta
    // viva, y el candado equivalente del router corre contra el doble, que trae
    // su propio filtro en JavaScript.
    const s = await sembrarCaso('pendiente', 'jefe2@ambientalia.com.co');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'pendiente',
        fechaInicioNueva: '2026-07-13',
        fechaFinNueva: '2026-07-17',
        diasHabilesNuevos: 5,
        motivo: 'La primera, que le rechazaron',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error('el alta deberia haber funcionado');
    // Cerrada como RECHAZADA: sale del indice unico y deja sitio para otra.
    await decidirModificacion(db, alta.modificacion.id, false, 'No procede', null, payloadStub);

    const transicion = transicionAlDecidir(s, true);
    if (!transicion) throw new Error('una solicitud pendiente siempre tiene transicion');
    await decidirSolicitud(db, s.id, 'pendiente', transicion, null, null, payloadStub, payloadStub);

    // Sigue rechazada, no caducada: la firma no reescribe lo que ya se decidio.
    expect((await modificacionPorId(db, alta.modificacion.id))?.estado).toBe('rechazada');
    // Y no se mando ningun aviso de caducidad, porque no caduco nada.
    expect(await eventosDelOutbox(db)).not.toContain('modificacion_caducada');
  });

  it('CANDADO: la rama de ANULACION lleva el mismo testigo que la de fechas', async () => {
    // Las dos clases comparten `TESTIGO_SOLICITUD` pero tienen `SET` distintos, y
    // hasta este test TODOS los del testigo corrian por la rama de `fechas`:
    // desenganchar la de anulacion del testigo dejaba la bateria entera en verde
    // mientras una anulacion pisaba en silencio la correccion de un admin.
    const s = await sembrarCaso('aprobada');

    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'anulacion',
        estadoEsperado: 'aprobada',
        // Los tres a null: lo exige el CHECK `modificaciones_campos_por_clase`.
        fechaInicioNueva: null,
        fechaFinNueva: null,
        diasHabilesNuevos: null,
        motivo: 'Se cancelo el viaje',
        aprobadorCorreo: 'jefe1@ambientalia.com.co',
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta deberia haber funcionado, y dio ${alta.razon}`);

    // El admin corrige las fechas. Se simula con un UPDATE pelado y no llamando
    // al PATCH: asi el outbox de este test cuenta SOLO lo que provoca la
    // decision de la propuesta, que es lo que aqui se mira.
    await db.query(
      `UPDATE portal.solicitudes_ausencia
          SET fecha_inicio = '2026-07-07', fecha_fin = '2026-07-11'
        WHERE id = $1`,
      [s.id],
    );

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r).toEqual({ ok: false, razon: 'solicitud_cambio_de_estado' });

    const m = await modificacionPorId(db, alta.modificacion.id);
    expect(m?.estado).toBe('pendiente');

    // La correccion del admin sigue en pie, y la solicitud sin anular.
    const final = await solicitudPorId(db, s.id);
    expect(final?.estado).toBe('aprobada');
    expect(final?.anuladaAt).toBeNull();
    expect(final?.fechaInicio).toBe('2026-07-07');
    expect(final?.fechaFin).toBe('2026-07-11');
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
    // una `pendiente` quedaria concedida sin que ningun firmante la firmara. Y
    // las tres columnas que SI escribe tienen que llegar de verdad a la fila.
    const s = await sembrarCaso('pendiente');

    // Las fechas nuevas SOLAPAN a proposito con las viejas (6-10 de julio), y
    // los dias nuevos son SEIS y no cinco. Las dos cosas son deliberadas y sin
    // ellas el test no vigila nada:
    //  - Si los dias coincidieran con los sembrados, anular la escritura de
    //    `dias_habiles` no cambiaria el resultado y la asercion pasaria igual.
    //  - Si el rango nuevo cayera entero DESPUES del viejo, anular una sola de
    //    las dos fechas dejaria la fila invertida y saltaria el CHECK
    //    `solicitudes_rango_valido`: el test se pondria rojo por un error del
    //    constraint y no por la asercion, tapando cual de las dos columnas se
    //    dejo de escribir. Solapando, las dos mutaciones dejan un rango valido y
    //    es la asercion la que las caza.
    const alta = await crearModificacion(
      db,
      {
        solicitudId: s.id,
        clase: 'fechas',
        estadoEsperado: 'pendiente',
        fechaInicioNueva: '2026-07-08',
        fechaFinNueva: '2026-07-15',
        diasHabilesNuevos: 6,
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
    expect(final?.fechaInicio).toBe('2026-07-08');
    expect(final?.fechaFin).toBe('2026-07-15');
    // Llega como numero, no como cadena: `SELECT_SOLICITUD` castea a ::float8
    // justo para eso (la columna es NUMERIC desde que admite el medio dia).
    expect(final?.diasHabiles).toBe(6);
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
    // El motivo lo escribio QUIEN PIDIO la anulacion: sin el, la fila quedaria
    // `rechazada` a secas y el historial del jefe no diria por que unos dias
    // concedidos no se disfrutaron.
    expect(final?.motivoRechazo).toBe('Se cancelo el viaje');
    expect(final?.fechaInicio).toBe('2026-07-06');
    expect(final?.fechaFin).toBe('2026-07-10');
  });
});

describe('decidirModificacion contra Postgres real', () => {
  it('CANDADO: el doble clic sobre la propuesta decide UNA vez, no dos', async () => {
    // Se RECHAZA a proposito y no se aprueba. Aprobar habria disparado tambien
    // `aplicarALaSolicitud`, y la segunda llamada habria chocado con el testigo
    // TRIPLE (las fechas ya habrian cambiado en la primera) en vez de con este
    // candado: el test se pondria verde por el motivo equivocado
    // (`solicitud_cambio_de_estado`, no `ya_decidida`). Rechazar no toca la
    // solicitud —`decidirModificacion` solo llama a `aplicarALaSolicitud` si
    // `aprueba`—, asi que aisla el paso 1 solo.
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

    const primera = await decidirModificacion(db, alta.modificacion.id, false, 'no procede', null, payloadStub);
    const segunda = await decidirModificacion(db, alta.modificacion.id, false, 'no procede', null, payloadStub);

    expect(primera.ok).toBe(true);
    // El servicio traduce esto a 409. Si ademas el rojo dijera
    // 'solicitud_cambio_de_estado', seria la senal de que el escenario eligio la
    // clase equivocada (ver el comentario de arriba).
    expect(segunda).toEqual({ ok: false, razon: 'ya_decidida' });

    // El dano real: dos correos diciendo cosas distintas a toda la cadena. Solo
    // tiene que haber UN aviso de rechazo, no dos.
    expect(await eventosDelOutbox(db)).toEqual(['modificacion_solicitada', 'modificacion_rechazada']);
  });
});

describe('lo que cuelga de la solicitud (modificacionPendiente)', () => {
  it('CANDADO: una propuesta viva cuelga de su solicitud, y deja de colgar en cuanto se decide', async () => {
    // El LEFT JOIN de SELECT_SOLICITUD filtra por m.estado = 'pendiente'. Sin ese
    // filtro, una propuesta ya decidida seguiria colgando de su solicitud: la
    // bandeja y la interfaz mostrarian un cambio pendiente que no existe.
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

    // Con la propuesta viva, tiene que traerla completa (ejercita el aliasing
    // mod_* y aModificacion), no solo un id suelto.
    const conPropuesta = await solicitudPorId(db, s.id);
    expect(conPropuesta?.modificacionPendiente).not.toBeNull();
    expect(conPropuesta?.modificacionPendiente?.id).toBe(alta.modificacion.id);
    expect(conPropuesta?.modificacionPendiente?.clase).toBe('fechas');
    expect(conPropuesta?.modificacionPendiente?.fechaInicioNueva).toBe('2026-07-13');
    expect(conPropuesta?.modificacionPendiente?.fechaFinNueva).toBe('2026-07-17');

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    expect(r.ok).toBe(true);

    // Decidida, ya no esta viva: el JOIN no la trae.
    const final = await solicitudPorId(db, s.id);
    expect(final?.modificacionPendiente).toBeNull();

    // Pero la propuesta sigue existiendo en su tabla, solo que ya no viva: la
    // ausencia en el JOIN es por el filtro, no porque la fila desapareciera.
    const m = await modificacionPorId(db, alta.modificacion.id);
    expect(m?.estado).toBe('aprobada');
  });
});
