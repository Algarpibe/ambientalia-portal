import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  poolDePrueba,
  limpiar,
  payloadStub,
  sembrarEmpleado,
  sembrarSolicitud,
} from '../test-db/harness.js';
import {
  actualizarSolicitud,
  crearModificacion,
  decidirModificacion,
  solicitudPorId,
  SolapeAlAplicar,
  type EdicionSolicitud,
  type PoolClient,
} from './repo.js';
import { crearSolicitud, pedirModificacion } from './service.js';
import type { Solicitud } from './types.js';
import { hoyEnColombia } from './saldo.js';
import { sumarDias } from './festivos.js';
import { contarDiasHabiles } from './dias-habiles.js';

// DATA-336, segunda parte — las puertas que MUEVEN fechas también se serializan
// por empleado, y con la MISMA llave que el alta.
//
// El alta ya corría bajo `conCandadoDelEmpleado`. Las otras tres puertas del
// solapamiento —proponer un cambio de fechas, firmarlo y el PATCH de admin—
// comprobaban con un SELECT sin FOR UPDATE en READ COMMITTED: dos peticiones
// simultáneas miraban las dos antes de que ninguna confirmara, las dos veían el
// destino libre y las dos escribían. Resultado: dos ausencias vivas de la misma
// persona sobre el mismo día.
//
// Cómo se fuerza la carrera, y por qué hace falta forzarla: abrir conexiones es
// más lento que la transacción entera, así que sin ayuda la segunda petición
// suele llegar cuando la primera ya confirmó y el test pasa por suerte (lo que
// enseñó DATA-339). Dos ayudas:
//  - las conexiones del pool se abren ANTES de la carrera (`calentarPool`);
//  - un trigger temporal duerme cada INSERT en `ausencias_outbox`. Ese INSERT va
//    en TODAS las puertas DESPUÉS de la comprobación del solape y antes del
//    COMMIT, así que estira justo la ventana entre «miré y estaba libre» y
//    «confirmé»: sin candado, las dos comprobaciones caen dentro y las dos pasan.
// El trigger solo existe mientras dura cada carrera; la siembra no lo sufre.

let db: Pool;

const CORREO = 'carrera@concurrente.test';
const sesion = { email: CORREO, userId: null, esAdmin: false };
const ADMIN = 'comercial@ambientalia.com.co';
const PAUSA_SEGUNDOS = 0.6;

let empleadoId: string;

/** Abre de antemano las conexiones que la carrera va a pedir. */
async function calentarPool(n = 6): Promise<void> {
  const clientes = await Promise.all(Array.from({ length: n }, () => db.connect()));
  clientes.forEach((c: PoolClient) => c.release());
}

async function activarPausa(): Promise<void> {
  await db.query(`
    CREATE OR REPLACE FUNCTION portal.carrera_pausa() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM pg_sleep(${PAUSA_SEGUNDOS});
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS carrera_pausa ON portal.ausencias_outbox;
    CREATE TRIGGER carrera_pausa BEFORE INSERT ON portal.ausencias_outbox
      FOR EACH ROW EXECUTE FUNCTION portal.carrera_pausa();`);
}

async function quitarPausa(): Promise<void> {
  await db.query(`
    DROP TRIGGER IF EXISTS carrera_pausa ON portal.ausencias_outbox;
    DROP FUNCTION IF EXISTS portal.carrera_pausa();`);
}

/** Espera a que alguna transacción esté dormida dentro del trigger. */
async function esperarAQueDuerma(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { rows } = await db.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event = 'PgSleep'`);
    if (rows.length > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('la primera petición nunca llegó a la pausa');
}

/**
 * Cada resultado reducido a una etiqueta: 'ok' si escribió, o el motivo del
 * rechazo. Las cuatro puertas cuentan el solape de tres formas —un resultado
 * `razon: 'solape'`, la excepción `SolapeAlAplicar` y el `AusenciaError`
 * `rango_solapado`— y aquí las tres valen lo mismo: «chocó».
 */
function desenlace(r: PromiseSettledResult<unknown>): string {
  if (r.status === 'rejected') {
    if (r.reason instanceof SolapeAlAplicar) return 'solape';
    const code = (r.reason as { code?: string }).code;
    if (code === 'rango_solapado') return 'solape';
    return `error:${code ?? String(r.reason)}`;
  }
  const v = r.value as { ok?: boolean; razon?: string } | null;
  if (v && typeof v === 'object' && 'ok' in v && v.ok === false) return v.razon === 'solape' ? 'solape' : `no:${v.razon}`;
  return 'ok';
}

/** Ausencias VIVAS de la persona que tocan el rango. Más de una es el fallo. */
async function vivasEn(desde: string, hasta: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM portal.solicitudes_ausencia
      WHERE empleado_id = $1 AND estado <> 'rechazada' AND tipo <> 'otorgamiento'
        AND fecha_inicio <= $3::date AND fecha_fin >= $2::date`,
    [empleadoId, desde, hasta],
  );
  return Number((rows[0] as { n: number }).n);
}

function diaHabilDesde(desde: string): string {
  let d = desde;
  while (contarDiasHabiles(d, d) !== 1) d = sumarDias(d, 1);
  return d;
}

const sembrar = (fechaInicio: string, fechaFin: string, estado: Solicitud['estado'] = 'aprobada') =>
  sembrarSolicitud(db, { empleadoId, correo: CORREO, estado, fechaInicio, fechaFin, segundoAprobadorCorreo: null });

async function proponer(s: Solicitud, desde: string, hasta: string) {
  const alta = await crearModificacion(
    db,
    {
      solicitudId: s.id,
      clase: 'fechas',
      estadoEsperado: s.estado,
      fechaInicioNueva: desde,
      fechaFinNueva: hasta,
      diasHabilesNuevos: contarDiasHabiles(desde, hasta),
      motivo: 'carrera',
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
    },
    payloadStub,
  );
  if (!alta.ok) throw new Error(`la propuesta debería haberse guardado, y dio ${alta.razon}`);
  return alta.modificacion;
}

const edicionDe = (s: Solicitud, over: Partial<EdicionSolicitud>): EdicionSolicitud => ({
  empleadoId: s.empleadoId,
  tipo: s.tipo,
  fechaInicio: s.fechaInicio,
  fechaFin: s.fechaFin,
  dias: s.diasHabiles,
  estado: s.estado,
  estadoLeido: s.estado,
  comentarios: s.comentarios,
  observaciones: null,
  ...over,
});

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await quitarPausa();
  await db?.end();
});
beforeEach(async () => {
  await quitarPausa();
  await limpiar(db);
  empleadoId = await sembrarEmpleado(db, CORREO);
});
afterEach(async () => {
  await quitarPausa();
});

describe('cambios de fechas simultáneos de la misma persona', () => {
  it('dos FIRMAS que mueven dos solicitudes al mismo día: se aplica UNA, la otra choca', async () => {
    const a = await sembrar('2026-07-01', '2026-07-03');
    const b = await sembrar('2026-07-06', '2026-07-08');
    const pa = await proponer(a, '2026-07-20', '2026-07-22');
    const pb = await proponer(b, '2026-07-21', '2026-07-21');

    await calentarPool();
    await activarPausa();
    const r = await Promise.allSettled([
      decidirModificacion(db, pa.id, true, null, null, payloadStub),
      decidirModificacion(db, pb.id, true, null, null, payloadStub),
    ]);

    expect(r.map(desenlace).sort()).toEqual(['ok', 'solape']);
    expect(await vivasEn('2026-07-21', '2026-07-21')).toBe(1);
  });

  it('dos PATCH de admin que mueven dos solicitudes al mismo día: se guarda UNO, el otro choca', async () => {
    const a = await sembrar('2026-07-01', '2026-07-03');
    const b = await sembrar('2026-07-06', '2026-07-08');

    await calentarPool();
    await activarPausa();
    const r = await Promise.allSettled([
      actualizarSolicitud(db, a.id, edicionDe(a, { fechaInicio: '2026-07-20', fechaFin: '2026-07-22', dias: 3 }), ADMIN, payloadStub),
      actualizarSolicitud(db, b.id, edicionDe(b, { fechaInicio: '2026-07-21', fechaFin: '2026-07-21', dias: 1 }), ADMIN, payloadStub),
    ]);

    expect(r.map(desenlace).sort()).toEqual(['ok', 'solape']);
    expect(await vivasEn('2026-07-21', '2026-07-21')).toBe(1);
  });

  it('ALTA contra PATCH de admin sobre el mismo día: la llave es la misma, pasa UNA', async () => {
    // Cruza dos puertas distintas: si el PATCH usara otra llave que el alta, no
    // se esperarían entre sí y las dos escribirían.
    const dia = diaHabilDesde(sumarDias(hoyEnColombia(), 21));
    const lejos = diaHabilDesde(sumarDias(dia, 14));
    const a = await sembrar(lejos, lejos);

    await calentarPool();
    await activarPausa();
    const r = await Promise.allSettled([
      crearSolicitud(db, sesion, { tipo: 'vacaciones', fechaInicio: dia, fechaFin: dia, comentarios: '' }),
      actualizarSolicitud(db, a.id, edicionDe(a, { fechaInicio: dia, fechaFin: dia, dias: 1 }), ADMIN, payloadStub),
    ]);

    expect(r.map(desenlace).sort()).toEqual(['ok', 'solape']);
    expect(await vivasEn(dia, dia)).toBe(1);
  });

  it('PROPONER mientras un ALTA ocupa ese día: la propuesta espera al alta y choca', async () => {
    // Una propuesta no ocupa agenda hasta que se firma, así que el orden importa:
    // si la propuesta entrara primero, el alta de detrás pasaría y estaría bien
    // (la firma lo cazaría después). Lo que se prueba es el otro orden —el alta
    // ya comprobó y está a punto de confirmar— y que la propuesta, con la misma
    // llave, espere y vea la fila nueva en vez de mirar un destino «libre».
    const dia = diaHabilDesde(sumarDias(hoyEnColombia(), 21));
    const lejos = diaHabilDesde(sumarDias(dia, 14));
    const a = await sembrar(lejos, lejos);

    await calentarPool();
    await activarPausa();
    const alta = crearSolicitud(db, sesion, { tipo: 'vacaciones', fechaInicio: dia, fechaFin: dia, comentarios: '' });
    const altaAsentada = alta.then(
      (v) => ({ status: 'fulfilled', value: v }) as const,
      (e: unknown) => ({ status: 'rejected', reason: e }) as const,
    );
    await esperarAQueDuerma();
    const propuesta = await Promise.allSettled([
      pedirModificacion(db, sesion, a.id, { clase: 'fechas', fechaInicio: dia, fechaFin: dia, motivo: 'carrera' }),
    ]);

    expect(desenlace(await altaAsentada)).toBe('ok');
    expect(desenlace(propuesta[0]!)).toBe('solape');
    expect((await solicitudPorId(db, a.id))?.modificacionPendiente ?? null).toBeNull();
  });
});
