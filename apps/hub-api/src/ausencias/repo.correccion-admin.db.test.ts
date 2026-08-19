import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { actualizarSolicitud, decidirSolicitud, type EdicionSolicitud } from './repo.js';
import { construirPayload, construirPayloadCorreccion } from './notificaciones.js';
import { transicionAlDecidir, type Solicitud } from './types.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from '../test-db/harness.js';

// Que un admin corrija el registro deje de dejar Google contando otra historia,
// contra Postgres de verdad.
//
// Estos candados NO los caza el porton rapido: `router.test.ts` mockea el repo
// entero, asi que el INSERT del outbox y su transaccion no existen ahi. Es la
// misma leccion del solapamiento: estrechar el WHERE dejaba 531/531 en verde.

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

/** Una solicitud APROBADA por la via real, para que tenga su id de evento. */
async function aprobadaConEvento(): Promise<Solicitud> {
  const empleadoId = await sembrarEmpleado(db, CORREO);
  const s = await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado: 'pendiente',
    fechaInicio: '2026-07-06',
    fechaFin: '2026-07-10',
    segundoAprobadorCorreo: null,
  });
  const t = transicionAlDecidir(s, true);
  if (!t) throw new Error('una pendiente siempre tiene transicion');
  const aprobada = await decidirSolicitud(db, s.id, s.estado, t, null, null, construirPayload);
  if (!aprobada) throw new Error('no se pudo aprobar');
  return aprobada;
}

/** Los campos de la edicion, partiendo de la solicitud tal como esta. */
function edicionDe(s: Solicitud, over: Partial<EdicionSolicitud> = {}): EdicionSolicitud {
  return {
    empleadoId: s.empleadoId,
    tipo: s.tipo,
    fechaInicio: s.fechaInicio,
    fechaFin: s.fechaFin,
    dias: s.diasHabiles,
    estado: s.estado,
    comentarios: s.comentarios,
    observaciones: s.observaciones,
    ...over,
  };
}

const corregir = (s: Solicitud, over: Partial<EdicionSolicitud> = {}) =>
  actualizarSolicitud(db, s.id, edicionDe(s, over), ADMIN, construirPayloadCorreccion);

/** El payload del ultimo evento encolado. */
async function ultimoPayload(): Promise<{ calendario: { accion: string; eventId: string } | null }> {
  const { rows } = await db.query('SELECT payload FROM portal.ausencias_outbox ORDER BY id DESC LIMIT 1');
  return (rows[0] as { payload: { calendario: { accion: string; eventId: string } | null } }).payload;
}

describe('corregir una solicitud desde el registro general', () => {
  it('mover las fechas de una aprobada encola la correccion y mueve el evento', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { fechaInicio: '2026-07-13', fechaFin: '2026-07-17' });

    expect(await eventosDelOutbox(db)).toEqual(['aprobada', 'correccion_admin']);
    expect((await ultimoPayload()).calendario).toMatchObject({ accion: 'actualizar' });
  });

  it('sacarla del calendario lo borra y vacia la marca', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { estado: 'rechazada' });

    expect((await ultimoPayload()).calendario).toMatchObject({ accion: 'borrar' });
    const { rows } = await db.query('SELECT evento_calendario_id FROM portal.solicitudes_ausencia WHERE id = $1', [s.id]);
    expect((rows[0] as { evento_calendario_id: string | null }).evento_calendario_id).toBeNull();
  });

  // CANDADO. Sin `estaEnElCalendario(previa.estado)`, cada errata corregida sobre
  // una pendiente mandaria un correo a administracion sobre una fila que nunca
  // estuvo en Google — y el cuerpo del correo lo afirma como un hecho.
  it('CANDADO: una pendiente corregida no encola NADA', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const s = await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'pendiente',
      fechaInicio: '2026-07-06',
      fechaFin: '2026-07-10',
      segundoAprobadorCorreo: null,
    });
    await corregir(s, { fechaInicio: '2026-07-13', fechaFin: '2026-07-17' });

    expect(await eventosDelOutbox(db)).toEqual([]);
  });

  // CANDADO. Sin `cambiaLaHoja`, tocar una nota interna manda un ⚠️ que no pide
  // ajustar nada — que es como se entrena a la gente a no leerlos.
  it('CANDADO: corregir solo las observaciones no encola nada', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { observaciones: 'revisado con RRHH' });

    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);
  });

  it('corregir solo los dias avisa de la hoja pero no toca el calendario', async () => {
    const s = await aprobadaConEvento();
    await corregir(s, { dias: 4 });

    expect(await eventosDelOutbox(db)).toEqual(['aprobada', 'correccion_admin']);
    expect((await ultimoPayload()).calendario).toBeNull();
  });

  // CANDADO. El INSERT del outbox y el UPDATE tienen que deshacerse juntos: una
  // correccion que revienta no puede dejar el correo dicho. Se provoca con la
  // cuarta puerta del solapamiento, que lanza DENTRO de la transaccion.
  it('CANDADO: si la correccion choca con otra ausencia, no queda ni fila ni correo', async () => {
    const s = await aprobadaConEvento();
    await sembrarSolicitud(db, {
      empleadoId: s.empleadoId,
      correo: CORREO,
      estado: 'aprobada',
      fechaInicio: '2026-08-03',
      fechaFin: '2026-08-07',
      segundoAprobadorCorreo: null,
    });

    await expect(corregir(s, { fechaInicio: '2026-08-05', fechaFin: '2026-08-06' })).rejects.toThrow();

    expect(await eventosDelOutbox(db)).toEqual(['aprobada']);
    const { rows } = await db.query('SELECT fecha_inicio::text FROM portal.solicitudes_ausencia WHERE id = $1', [s.id]);
    expect((rows[0] as { fecha_inicio: string }).fecha_inicio).toBe('2026-07-06');
  });
});
