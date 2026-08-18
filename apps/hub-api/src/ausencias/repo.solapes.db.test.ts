import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { solapeDe } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

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
