import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { ausenciasParaKpi } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// La consulta que alimenta el KPI de estacionalidad, contra Postgres de verdad.
//
// Comparte forma con `repo.absentismo.db.test.ts` pero NO es la misma consulta:
// aquella trae solo incapacidades y esta los CUATRO tipos que son una ausencia.
// Lo que aqui se vigila es justo el borde entre esos cuatro y el quinto.

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
  tipo: 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad' | 'otorgamiento',
  estado: 'registrada' | 'aprobada' | 'rechazada' | 'pendiente',
  fechaInicio: string,
  fechaFin: string,
): Promise<void> {
  // Permiso y otorgamiento son de un solo dia: se siembran con el mismo dia en
  // los dos extremos para no chocar con las reglas del alta.
  const unSoloDia = tipo === 'permiso' || tipo === 'otorgamiento';
  await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio,
    fechaFin: unSoloDia ? fechaInicio : fechaFin,
    segundoAprobadorCorreo: null,
    tipo,
  });
}

describe('ausenciasParaKpi', () => {
  it('trae los cuatro tipos que son una ausencia, con su tipo y su rango', async () => {
    await sembrar('vacaciones', 'aprobada', '2026-09-07', '2026-09-11');
    await sembrar('permiso', 'aprobada', '2026-09-14', '2026-09-14');
    await sembrar('compensatorio', 'aprobada', '2026-09-16', '2026-09-17');
    await sembrar('incapacidad', 'registrada', '2026-09-21', '2026-09-22');

    const filas = await ausenciasParaKpi(db, '2026-09-01', '2026-09-30');
    expect(filas).toHaveLength(4);
    expect(new Set(filas.map((f) => f.tipo))).toEqual(
      new Set(['vacaciones', 'permiso', 'compensatorio', 'incapacidad']),
    );
    // El nombre sale del JOIN con `portal.empleados` y lo pinta el tooltip; el
    // id viaja con el porque dos personas distintas pueden llamarse igual.
    expect(filas.every((f) => f.nombreCompleto === 'Ana Ruiz' && f.empleadoId === empleadoId)).toBe(true);
  });

  it('CANDADO: el OTORGAMIENTO no es una ausencia y no entra', async () => {
    // Es el error trampa de este KPI. El otorgamiento dice «trabaje el sabado,
    // concedeme un dia»: sus `dias_habiles` son dias CONCEDIDOS y su
    // `fecha_inicio` es el dia del trabajo extra. Colarlo sumaria dias
    // TRABAJADOS a una serie de dias AUSENTE, y encima subiria en los meses de
    // mas faena, que es lo contrario de lo que la pantalla quiere ensenar.
    await sembrar('otorgamiento', 'aprobada', '2026-09-12', '2026-09-12');
    expect(await ausenciasParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('CANDADO: solo lo que OCUPA AGENDA; una pendiente todavia no ha pasado', async () => {
    // La estacionalidad describe lo que ocurrio, no lo que alguien pidio. Una
    // pendiente puede acabar rechazada, y contarla inflaria el mes con dias que
    // quiza nadie llegue a tomarse.
    await sembrar('vacaciones', 'pendiente', '2026-09-07', '2026-09-11');
    expect(await ausenciasParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('CANDADO: una ausencia ANULADA tampoco', async () => {
    // Anular deja la fila en `rechazada` con su rango intacto, igual que en el
    // KPI de absentismo.
    await sembrar('vacaciones', 'rechazada', '2026-09-07', '2026-09-11');
    expect(await ausenciasParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('una que cruza el borde de la ventana entra con sus fechas originales', async () => {
    // El reparto por mes lo hace el motor, asi que necesita el rango completo.
    await sembrar('vacaciones', 'aprobada', '2026-08-25', '2026-09-04');
    const filas = await ausenciasParaKpi(db, '2026-09-01', '2026-09-30');
    expect(filas).toHaveLength(1);
    expect(filas[0].fechaInicio).toBe('2026-08-25');
  });

  it('lo que no roza la ventana se queda fuera', async () => {
    await sembrar('vacaciones', 'aprobada', '2024-05-06', '2024-05-10');
    expect(await ausenciasParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('sin ausencias, lista vacia', async () => {
    expect(await ausenciasParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });
});
