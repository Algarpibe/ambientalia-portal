import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { eventosPendientes, confirmarEventos, MAX_INTENTOS } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';

// El outbox contra Postgres de verdad.
//
// Este fichero nace de un incidente: el 2026-08-24 se borraron unas solicitudes
// desde el Registro general y sus seis eventos `borrado_admin` se quedaron sin
// confirmar. Cada ciclo de diez minutos n8n los volvia a pedir y volvia a mandar
// los seis correos. Cuando se descubrio llevaban 119 intentos.
//
// Habia tres fallos encadenados y este fichero cubre el que era responsabilidad
// de hub-api: `eventosPendientes` no tenia NINGUN tope de intentos. El campo se
// incrementaba «para poder detectar en la BD un evento atascado», pero nada lo
// detectaba ni actuaba sobre el, asi que un evento atascado se reintentaba para
// siempre.
//
// Y hasta hoy ningun test:db tocaba esta funcion, que es como la ausencia del
// tope pudo pasar desapercibida: el doble in-memory de router.test.ts no ejecuta
// SQL, asi que no puede ver un WHERE que falta.

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
 * Siembra un evento del outbox listo para servirse.
 *
 * `solicitud_id` a null a proposito: es el caso del incidente. Desde la 028 la
 * clave ajena es ON DELETE SET NULL, para que el aviso de un borrado sobreviva a
 * la solicitud que lo pidio.
 */
async function sembrarEvento(intentos = 0): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO portal.ausencias_outbox (solicitud_id, evento, payload, intentos)
     VALUES (NULL, 'borrado_admin', '{"correo":{"asunto":"prueba"}}'::jsonb, $1)
     RETURNING id`,
    [intentos],
  );
  return Number((rows[0] as { id: string }).id);
}

/**
 * Empuja `servido_at` al pasado para que la reserva deje de esconder la fila.
 *
 * ⚠️ Hace falta de verdad, y lo se porque el primer intento de este fichero no la
 * tenia: el test del tope pasaba igualmente, pero POR EL MOTIVO EQUIVOCADO —era
 * la reserva de cinco minutos la que devolvia la lista vacia, no el tope—. Se
 * descubrio mutando el WHERE del tope: el test seguia verde. Sin esto, los
 * candados de este fichero prueban la reserva dos veces y el tope ninguna.
 */
async function vencerLaReserva(id: number): Promise<void> {
  await db.query(
    "UPDATE portal.ausencias_outbox SET servido_at = now() - interval '1 hour' WHERE id = $1",
    [id],
  );
}

/** Lo que la BD dice de un evento, sin pasar por el mapeo del repo. */
async function filaDe(id: number): Promise<{ intentos: number; enviado: boolean }> {
  const { rows } = await db.query(
    'SELECT intentos, enviado_at IS NOT NULL AS enviado FROM portal.ausencias_outbox WHERE id = $1',
    [id],
  );
  return rows[0] as { intentos: number; enviado: boolean };
}

describe('eventosPendientes: el tope de intentos', () => {
  it('sirve un evento nuevo y le cuenta el intento', async () => {
    const id = await sembrarEvento();
    const servidos = await eventosPendientes(db);
    expect(servidos.map((e) => e.id)).toEqual([id]);
    expect((await filaDe(id)).intentos).toBe(1);
  });

  it('CANDADO: deja de servirlo al llegar al tope, y no un intento despues', async () => {
    // Es el candado del incidente. Sin el, el evento se sirve para siempre: el
    // que lo provoco llego a 119 intentos y 119 tandas de correo.
    //
    // Se siembra en MAX_INTENTOS - 1 para que el proximo servicio sea el ULTIMO:
    // asi el test fija el borde exacto y no solo «en algun momento para».
    const id = await sembrarEvento(MAX_INTENTOS - 1);

    const ultima = await eventosPendientes(db);
    expect(ultima.map((e) => e.id)).toEqual([id]);
    expect((await filaDe(id)).intentos).toBe(MAX_INTENTOS);

    // Y a partir de aqui, nunca mas — venciendo la reserva cada vez, o seria
    // ella la que devuelve la lista vacia y este candado no probaria el tope.
    await vencerLaReserva(id);
    expect(await eventosPendientes(db)).toEqual([]);
    await vencerLaReserva(id);
    expect(await eventosPendientes(db)).toEqual([]);
  });

  it('CANDADO: el que se aparca NO se marca como enviado', async () => {
    // Aparcar no es lo mismo que dar por hecho. La fila se queda con
    // `enviado_at` a null para que siga siendo visible en una consulta de
    // diagnostico: es un evento que NO se entrego y hay que mirarlo a mano.
    const id = await sembrarEvento(MAX_INTENTOS);
    expect(await eventosPendientes(db)).toEqual([]);
    expect((await filaDe(id)).enviado).toBe(false);
  });

  it('CANDADO: un evento atascado no tapa a los demas', async () => {
    // El tope tambien protege el rendimiento del ciclo: sin el, N eventos
    // atascados se llevan N de los 20 huecos de cada tanda para siempre, y los
    // eventos nuevos van quedando detras.
    const atascado = await sembrarEvento(MAX_INTENTOS);
    const nuevo = await sembrarEvento();
    const servidos = await eventosPendientes(db);
    expect(servidos.map((e) => e.id)).toEqual([nuevo]);
    expect(servidos.map((e) => e.id)).not.toContain(atascado);
  });

  it('la reserva sigue valiendo: no se sirve dos veces seguidas', async () => {
    // El tope es nuevo, la reserva no. Que sigan conviviendo importa: son dos
    // motivos distintos para no servir, y romper uno al arreglar el otro seria
    // cambiar un bucle de correos por otro.
    const id = await sembrarEvento();
    expect((await eventosPendientes(db)).map((e) => e.id)).toEqual([id]);
    expect(await eventosPendientes(db)).toEqual([]);
    expect((await filaDe(id)).intentos).toBe(1);
  });

  it('confirmarEventos lo saca de la cola aunque le queden intentos', async () => {
    const id = await sembrarEvento();
    await eventosPendientes(db);
    expect(await confirmarEventos(db, [id])).toBe(1);
    expect(await eventosPendientes(db)).toEqual([]);
    expect((await filaDe(id)).enviado).toBe(true);
  });
});
