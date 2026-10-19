import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado } from '../test-db/harness.js';
import { fijarSaldo } from './repo.js';
import { crearSolicitud } from './service.js';
import { hoyEnColombia } from './saldo.js';
import { sumarDias } from './festivos.js';
import { contarDiasHabiles } from './dias-habiles.js';

// DATA-336 — dos altas de la misma persona a la vez (un doble clic, dos
// pestañas). Las comprobaciones del alta —solape, otorgamiento duplicado y
// saldo— leían por el pool, FUERA de la transacción del INSERT: las dos
// peticiones miraban antes de que ninguna escribiera, las dos veían el camino
// libre y las dos se creaban. Un índice único no sirve aquí (hay datos previos
// que lo incumplen, ver repo.ts); lo que se prueba es que el alta se serializa
// por empleado.
//
// `Promise.all` lanza las dos sin esperar: es el doble clic.

let db: Pool;

const CORREO = 'doble.clic@concurrente.test';
const sesion = { email: CORREO, userId: null, esAdmin: false };

/** Cuántas acabaron bien y los códigos de las que fallaron. */
function reparto(resultados: PromiseSettledResult<unknown>[]) {
  return {
    creadas: resultados.filter((r) => r.status === 'fulfilled').length,
    errores: resultados
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason as { code?: string }).code),
  };
}

const filas = async (tipo: string) =>
  Number(
    (await db.query(`SELECT count(*)::int AS n FROM portal.solicitudes_ausencia WHERE tipo = $1`, [tipo])).rows[0].n,
  );

/** El siguiente día hábil (no fin de semana ni festivo) a partir de `desde`. */
function diaHabilDesde(desde: string): string {
  let d = desde;
  while (contarDiasHabiles(d, d) !== 1) d = sumarDias(d, 1);
  return d;
}

beforeAll(() => {
  db = poolDePrueba();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await limpiar(db);
});

describe('dos altas simultáneas de la misma persona', () => {
  it('el mismo otorgamiento dos veces: se concede UNA', async () => {
    await sembrarEmpleado(db, CORREO);
    const otorgamiento = {
      tipo: 'otorgamiento',
      fechaInicio: sumarDias(hoyEnColombia(), -3),
      fechaFin: sumarDias(hoyEnColombia(), -3),
      dias: 1,
      comentarios: 'trabajé ese día',
    };

    const r = reparto(
      await Promise.allSettled([crearSolicitud(db, sesion, otorgamiento), crearSolicitud(db, sesion, otorgamiento)]),
    );

    expect(r).toEqual({ creadas: 1, errores: ['otorgamiento_duplicado'] });
    expect(await filas('otorgamiento')).toBe(1);
  });

  it('dos compensatorios con un solo día en la bolsa: pasa UNO, la bolsa no queda en negativo', async () => {
    const id = await sembrarEmpleado(db, CORREO);
    const corte = sumarDias(hoyEnColombia(), -30);
    await fijarSaldo(db, id, { saldoCorte: 15, fechaCorte: corte }, { saldoCorte: 1, fechaCorte: corte });
    // Dos días distintos: no se solapan entre sí, así que lo único que puede
    // parar a la segunda es el saldo.
    const lunes = diaHabilDesde(sumarDias(hoyEnColombia(), 14));
    const otro = diaHabilDesde(sumarDias(lunes, 1));

    const r = reparto(
      await Promise.allSettled([
        crearSolicitud(db, sesion, { tipo: 'compensatorio', fechaInicio: lunes, fechaFin: lunes, comentarios: '' }),
        crearSolicitud(db, sesion, { tipo: 'compensatorio', fechaInicio: otro, fechaFin: otro, comentarios: '' }),
      ]),
    );

    expect(r).toEqual({ creadas: 1, errores: ['compensatorios_insuficientes'] });
    expect(await filas('compensatorio')).toBe(1);
  });

  it('las mismas vacaciones dos veces: se crea UNA, la otra choca por solape', async () => {
    await sembrarEmpleado(db, CORREO);
    const inicio = diaHabilDesde(sumarDias(hoyEnColombia(), 21));
    const vacaciones = { tipo: 'vacaciones', fechaInicio: inicio, fechaFin: inicio, comentarios: '' };

    const r = reparto(
      await Promise.allSettled([crearSolicitud(db, sesion, vacaciones), crearSolicitud(db, sesion, vacaciones)]),
    );

    expect(r).toEqual({ creadas: 1, errores: ['rango_solapado'] });
    expect(await filas('vacaciones')).toBe(1);
  });
});
