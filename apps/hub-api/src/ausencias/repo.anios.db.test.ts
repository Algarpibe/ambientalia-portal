import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { aniosConAusencias } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// Los anos que el selector del panel puede ofrecer. Salen de los DATOS y no de
// un rango fijo: un desplegable con anos vacios invita a mirar pantallas en
// blanco, y uno que se queda corto esconde el historico importado.

const CORREO = 'ana.ruiz@ambientalia.com.co';

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

async function sembrar(
  estado: 'registrada' | 'aprobada' | 'rechazada' | 'pendiente',
  fechaInicio: string,
  fechaFin: string,
): Promise<void> {
  await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio,
    fechaFin,
    segundoAprobadorCorreo: null,
    tipo: estado === 'registrada' ? 'incapacidad' : 'vacaciones',
  });
}

describe('aniosConAusencias', () => {
  it('devuelve los anos que tienen alguna solicitud, del mas reciente al mas antiguo', async () => {
    await sembrar('aprobada', '2024-05-06', '2024-05-10');
    await sembrar('aprobada', '2026-07-06', '2026-07-10');
    expect(await aniosConAusencias(db)).toEqual([2026, 2024]);
  });

  it('CANDADO: un ano sale UNA vez por muchas solicitudes que tenga', async () => {
    // Sin el DISTINCT el desplegable repetiria «2026» tantas veces como
    // solicitudes hubiera ese ano, que en produccion son cientos.
    await sembrar('aprobada', '2026-07-06', '2026-07-10');
    await sembrar('aprobada', '2026-08-03', '2026-08-07');
    await sembrar('aprobada', '2026-09-07', '2026-09-11');
    expect(await aniosConAusencias(db)).toEqual([2026]);
  });

  it('CANDADO: una ausencia a caballo entre dos anos aporta LOS DOS', async () => {
    // Del 28 de diciembre al 4 de enero. Mirando solo `fecha_inicio`, el ano
    // siguiente no existiria en el desplegable aunque tuviera dias de ausencia
    // dentro, y esa es justo la pantalla que alguien querria abrir.
    await sembrar('aprobada', '2025-12-28', '2026-01-04');
    expect(await aniosConAusencias(db)).toEqual([2026, 2025]);
  });

  it('los anos de las rechazadas y las pendientes tambien cuentan', async () => {
    // El selector solo decide que ventana se puede pedir. Recortar aqui por
    // estado dejaria fuera un ano que la grafica de friccion si sabe pintar.
    await sembrar('rechazada', '2023-05-06', '2023-05-10');
    await sembrar('pendiente', '2027-05-06', '2027-05-10');
    expect(await aniosConAusencias(db)).toEqual([2027, 2023]);
  });

  it('sin solicitudes, lista vacia', async () => {
    expect(await aniosConAusencias(db)).toEqual([]);
  });
});
