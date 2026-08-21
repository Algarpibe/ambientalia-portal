import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  movimientos,
  empleadosConSaldo,
  decidirSolicitud,
  actualizarSolicitud,
  crearModificacion,
  decidirModificacion,
  retirarModificacion,
  solicitudPorId,
} from './repo.js';
import { transicionAlDecidir, type ClaseModificacion, type Modificacion, type Solicitud } from './types.js';
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

// La otra mitad del registro: las MODIFICACIONES -anulaciones y cambios de
// fecha- como movimientos propios, y la linea que separa las que entran de las
// que no.
//
// Va contra Postgres de verdad y no contra el doble porque lo que se prueba es
// el `WHERE m.estado <> 'pendiente'` y el `COALESCE` de las fechas: dos trozos
// de SQL que ningun doble ejecuta. Y ninguno de los dos falla en rojo si se
// escribe mal -uno cuenta las propuestas vivas DOS veces en pantalla, el otro
// deja una anulacion sin fechas-, que es exactamente el tipo de fallo por el
// que existe este fichero.
//
// Las tres filas se escriben con `crearModificacion`, `decidirModificacion` y
// `retirarModificacion`, que es lo que corre en produccion, y NO con un UPDATE
// a pelo: es la misma leccion que anota el bloque de aqui arriba. Un fixture
// que escribe la invariante a mano AFIRMA la premisa en vez de ejercitarla -y
// aqui las premisas son justo lo que sostiene cada candado: que una anulacion
// deja las tres columnas nuevas a NULL, que retirar sella `decidida_at` sin que
// nadie decida, y que la propuesta viva cuelga del LEFT JOIN de
// `SELECT_SOLICITUD`.

const CAMBIANTE = 'cambiante@ambientalia.com.co';

/**
 * Una solicitud `aprobada` del CAMBIANTE con una propuesta VIVA colgando, las
 * dos por los escritores reales.
 *
 * En la anulacion los tres campos nuevos van a `null` porque lo exige el CHECK
 * `modificaciones_campos_por_clase` de la 024 - y esa obligacion es justo la
 * premisa del COALESCE que se prueba: sus fechas efectivas solo pueden ser las
 * previas.
 */
async function sembrarConPropuesta(clase: ClaseModificacion): Promise<{
  solicitud: Solicitud;
  modificacion: Modificacion;
}> {
  const empleadoId = await sembrarEmpleado(db, CAMBIANTE, JEFE);
  const solicitud = await sembrarSolicitud(db, {
    empleadoId,
    correo: CAMBIANTE,
    estado: 'aprobada',
    fechaInicio: '2026-05-04',
    fechaFin: '2026-05-08',
    segundoAprobadorCorreo: null,
  });
  const esAnulacion = clase === 'anulacion';
  const alta = await crearModificacion(
    db,
    {
      solicitudId: solicitud.id,
      clase,
      estadoEsperado: 'aprobada',
      fechaInicioNueva: esAnulacion ? null : '2026-05-11',
      fechaFinNueva: esAnulacion ? null : '2026-05-15',
      diasHabilesNuevos: esAnulacion ? null : 5,
      motivo: esAnulacion ? 'Se cancelo el viaje' : 'Me cambiaron el turno',
      // El congelado en el alta de la solicitud, que es lo que copia el
      // servicio. `sembrarSolicitud` lo fija y no es negociable desde aqui.
      aprobadorCorreo: PRIMER_FIRMANTE,
    },
    payloadStub,
  );
  if (!alta.ok) throw new Error(`el alta de la propuesta fallo con razon ${alta.razon}`);
  return { solicitud, modificacion: alta.modificacion };
}

/** El movimiento de una propuesta, si el registro llega a traerlo. */
async function movimientoDe(id: string) {
  return (await movimientos(db, null)).find((m) => m.id === id);
}

describe('CANDADO: las modificaciones en el registro', () => {
  it('una anulacion ya decidida es un movimiento propio, con las fechas PREVIAS', async () => {
    const { solicitud, modificacion } = await sembrarConPropuesta('anulacion');
    const r = await decidirModificacion(db, modificacion.id, true, null, null, payloadStub);
    expect(r.ok).toBe(true);

    const m = await movimientoDe(modificacion.id);
    if (!m) throw new Error('la anulacion aprobada no llego al registro');

    expect(m.clase).toBe('anulacion');
    expect(m.estado).toBe('aprobada');
    // El id es el de la PROPUESTA y `solicitudId` el de la solicitud afectada:
    // es lo que permite que la pantalla enlace el movimiento con su ausencia.
    expect(m.solicitudId).toBe(solicitud.id);
    expect(m.solicitanteEmail).toBe(CAMBIANTE);
    expect(m.empleadoNombre).toBe('Ana Ruiz');
    // El tipo sale de la SOLICITUD afectada: sin el, el filtro por tipo de la
    // pantalla esconderia las anulaciones de vacaciones al filtrar vacaciones.
    expect(m.tipo).toBe('vacaciones');
    // `motivo` es el de la propuesta -por que se anula-, no los comentarios de
    // la solicitud.
    expect(m.motivo).toBe('Se cancelo el viaje');

    // El nucleo del candado: las tres columnas nuevas son NULL por el CHECK de
    // la 024, asi que las fechas EFECTIVAS de una anulacion solo pueden ser las
    // previas. Sin el COALESCE, este movimiento saldria sin fechas y la
    // pantalla pintaria una anulacion de dias que no dice cuales.
    expect(m.fechaInicio).toBe('2026-05-04');
    expect(m.fechaFin).toBe('2026-05-08');
    expect(m.diasHabiles).toBe(5);

    expect(m.decididaAt).not.toBeNull();
    // Sin sesion del portal -`userId` a null, como las de token legacy-: el
    // decisor se deduce del correo congelado, y con la marca de aproximado.
    expect(m.decididaPor).toEqual({ nombre: null, correo: PRIMER_FIRMANTE, aproximado: true });
  });

  // `anuladaAt` NO vive en el movimiento de la anulacion -ese es el de arriba,
  // clase 'anulacion'-: vive en el movimiento de LA SOLICITUD afectada, clase
  // 'solicitud', que es el que pinta la tabla del registro con su chip. El
  // candado usa el flujo real -crearModificacion + decidirModificacion- y no
  // un UPDATE a pelo, por la misma razon que el resto del fichero: lo que se
  // prueba es que decidirModificacion sella `anulada_at` en la SOLICITUD al
  // aprobar una anulacion, no que una fila con la columna puesta a mano
  // se mapee bien.
  it('CANDADO: una solicitud anulada trae anuladaAt en su propio movimiento; una normal, null', async () => {
    const { solicitud, modificacion } = await sembrarConPropuesta('anulacion');
    expect((await decidirModificacion(db, modificacion.id, true, null, null, payloadStub)).ok).toBe(true);

    const propia = (await movimientos(db, null)).find(
      (m) => m.solicitudId === solicitud.id && m.clase === 'solicitud',
    );
    if (!propia) throw new Error('la solicitud anulada no aparece con su propio movimiento');
    if (propia.clase !== 'solicitud') throw new Error('el find de arriba ya filtro por clase');
    // El nucleo del candado: sin el `s.anulada_at::text` del SELECT esta
    // columna llega undefined, y `chipDeSolicitud` (dominio.ts del portal)
    // rotularia "Rechazada" una fila que el propio dueno anulo.
    expect(propia.anuladaAt).not.toBeNull();

    // Una solicitud normal -ninguna anulacion de por medio- no lleva la marca:
    // las cuatro que siembra el beforeEach nacen `aprobada` sin anular.
    const normal = (await movimientos(db, null)).find(
      (m) => m.solicitanteEmail === HIJO && m.clase === 'solicitud',
    );
    if (!normal) throw new Error('la siembra del beforeEach no dejo movimiento de HIJO');
    if (normal.clase !== 'solicitud') throw new Error('el find de arriba ya filtro por clase');
    expect(normal.anuladaAt).toBeNull();
  });

  it('una propuesta VIVA no entra como fila propia: ya viaja con su solicitud', async () => {
    const { solicitud, modificacion } = await sembrarConPropuesta('fechas');

    // La premisa del caso, comprobada y no supuesta: el LEFT JOIN de
    // `SELECT_SOLICITUD` ya cuelga la propuesta viva de su solicitud. Es lo que
    // hace que meterla ademas como movimiento la cuente DOS veces en pantalla.
    const conPropuesta = await solicitudPorId(db, solicitud.id);
    expect(conPropuesta?.modificacionPendiente?.id).toBe(modificacion.id);

    expect(await movimientoDe(modificacion.id)).toBeUndefined();
    // Y una sola fila para esa solicitud, la suya: el recuento es lo que caza
    // el doble conteo, porque la fila de mas no rompe nada, solo suma.
    const suyos = (await movimientos(db, null)).filter((m) => m.solicitudId === solicitud.id);
    expect(suyos.map((m) => m.clase)).toEqual(['solicitud']);
  });

  it('una retirada no la decide nadie, aunque tenga aprobador congelado y decidida_at', async () => {
    const { modificacion } = await sembrarConPropuesta('fechas');
    const retirada = await retirarModificacion(db, modificacion.id);
    if (!retirada) throw new Error('una propuesta viva se tiene que poder retirar');

    // Las DOS premisas que hacen que este candado muerda, y por eso se
    // comprueban: la fila retirada conserva el `aprobador_correo` congelado en
    // el alta Y lleva `decidida_at` sellada -retirar marca el instante en que
    // la propuesta dejo de estar viva-. Es la combinacion exacta que haria
    // entrar al respaldo de `quienDecidio` y atribuirle el acto al jefe, que no
    // lo hizo: la quito el propio solicitante.
    expect(retirada.estado).toBe('retirada');
    expect(retirada.aprobadorCorreo).toBe(PRIMER_FIRMANTE);
    expect(retirada.decididaAt).not.toBeNull();

    const m = await movimientoDe(modificacion.id);
    // Entra: la echo atras el solicitante, pero forma parte del rastro.
    if (!m) throw new Error('la retirada no llego al registro, y forma parte del rastro');
    expect(m.estado).toBe('retirada');
    expect(m.decididaAt).not.toBeNull();
    expect(m.decididaPor).toBeNull();
  });

  // Este NO estaba en el plan, y esta aqui por una falsacion que NO mordio:
  // borrar entero el `.sort(porFechaDeCierre)` de `movimientos` dejaba los 81
  // tests en verde. La mezcla es lo unico del registro que no puede comprobar
  // ninguna de las dos consultas por separado -cada una sale ordenada consigo
  // misma haga lo que haga la otra-, y sin orden la pantalla ensena primero
  // todas las solicitudes y luego todas las modificaciones, que no es una
  // linea de tiempo de nada. Es la misma razon por la que existe el candado de
  // `empleadosConSaldo` de mas arriba.
  //
  // ⚠️ Cubre DOS de las tres reglas del orden: que la fila de la otra lista se
  // cuele arriba, y el NULLS LAST. El desempate por `created_at DESC` NO se
  // puede probar aqui, y conviene no creer que si: las cinco filas sin cerrar
  // salen todas de `movimientosDeSolicitudes`, que no lleva `ORDER BY`, asi que
  // el orden en que llegan lo elige el plan de ejecucion de Postgres y para un
  // dataset de test cabe que coincida con el esperado por casualidad. Se
  // comprobo: sustituyendo el desempate por `return 0`, este fichero seguia
  // entero en verde. Esa regla la fija `repo.test.ts`, sin Postgres y con el
  // orden de entrada al reves del de salida.
  it('CANDADO: el orden mezcla las dos listas, y lo que nunca se decidio va al final', async () => {
    // Una decision de verdad, con `decidirSolicitud`: es el UNICO escritor de
    // `decidida_at` sobre la solicitud, asi que las cuatro del beforeEach -que
    // nacen ya `aprobada`- la tienen NULA.
    const empleadoId = await sembrarEmpleado(db, LEGACY, JEFE);
    const decidida = await sembrarSolicitud(db, {
      empleadoId,
      correo: LEGACY,
      estado: 'pendiente',
      fechaInicio: '2026-06-01',
      fechaFin: '2026-06-05',
      segundoAprobadorCorreo: null,
    });
    await firmarSinSesion(decidida, 'pendiente', true);

    // Y DESPUES la anulacion: es el movimiento mas reciente de los dos, y viene
    // de la OTRA consulta. Si la mezcla no ordena, se queda detras de las seis
    // solicitudes por el simple hecho de estar en la segunda lista.
    const { modificacion } = await sembrarConPropuesta('anulacion');
    expect((await decidirModificacion(db, modificacion.id, true, null, null, payloadStub)).ok).toBe(true);

    const ms = await movimientos(db, null);
    expect(ms[0]?.id).toBe(modificacion.id);
    expect(ms[1]?.id).toBe(decidida.id);

    // El NULLS LAST, y no es decorativo: la solicitud de CAMBIANTE acaba de
    // quedarse `rechazada` por la anulacion -un estado terminal- y sigue SIN
    // `decidida_at`, porque nadie decidio la solicitud, solo el cambio. Sin
    // NULLS LAST encabezaria la lista por delante de las dos decisiones de
    // verdad de aqui arriba.
    const sinCierre = ms.slice(2);
    expect(sinCierre.map((m) => m.decididaAt)).toEqual(sinCierre.map(() => null));
    // Ordenado antes de comparar, a proposito: lo que se afirma es QUIENES
    // forman ese grupo -las cinco, sin perder ni duplicar ninguna-, no en que
    // orden llegan. Compararlas en orden seria afirmar el capricho del plan de
    // ejecucion, y este test se pondria rojo el dia que Postgres cambiara de
    // opinion sin que nada estuviera mal.
    expect([...sinCierre.map((m) => m.solicitanteEmail)].sort()).toEqual(
      [CAMBIANTE, PRIMO, BISNIETO, NIETO, HIJO].sort(),
    );
  });
});
