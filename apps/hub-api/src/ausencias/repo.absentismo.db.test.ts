import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { incapacidadesParaKpi } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// La consulta que alimenta el KPI de absentismo, contra Postgres de verdad.
//
// Lo que se prueba aqui son los recortes del WHERE, que es donde estan los
// errores caros: una fila de mas convierte en absentismo algo que no lo fue, y
// una de menos borra dias que si se perdieron.

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

/** Una solicitud con tipo, estado y rango a medida. */
async function sembrar(
  tipo: 'incapacidad' | 'vacaciones' | 'permiso',
  estado: 'registrada' | 'aprobada' | 'rechazada' | 'pendiente',
  fechaInicio: string,
  fechaFin: string,
): Promise<void> {
  await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio,
    // Un permiso es de un solo dia desde la 036: se siembra con el mismo dia
    // en los dos extremos para no chocar con el CHECK.
    fechaFin: tipo === 'permiso' ? fechaInicio : fechaFin,
    segundoAprobadorCorreo: null,
    tipo,
  });
}

describe('incapacidadesParaKpi', () => {
  it('trae las incapacidades que caen en la ventana, con su rango', async () => {
    await sembrar('incapacidad', 'registrada', '2026-09-07', '2026-09-11');
    const filas = await incapacidadesParaKpi(db, '2026-09-01', '2026-09-30');

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      empleadoId,
      // El nombre sale del JOIN con `portal.empleados` y lo pinta el tooltip:
      // sin el, la lista de quienes estuvieron incapacitados llegaria con ids.
      nombreCompleto: 'Ana Ruiz',
      fechaInicio: '2026-09-07',
      fechaFin: '2026-09-11',
    });
  });

  it('CANDADO: una incapacidad ANULADA no cuenta como absentismo', async () => {
    // Anular deja la solicitud en `rechazada` con `anulada_at` -no la borra, ver
    // `repo.aplicarALaSolicitud`-, asi que sigue en la tabla con su rango
    // intacto. Sin este recorte, unos dias que nadie llego a perder entrarian en
    // la serie de absentismo y en el total que se lee encima.
    await sembrar('incapacidad', 'rechazada', '2026-09-07', '2026-09-11');
    expect(await incapacidadesParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('CANDADO: solo incapacidades; ni vacaciones ni permisos', async () => {
    // Este KPI mide salud laboral, no ausencia a secas. Colar las vacaciones
    // convertiria el indicador en «dias que la gente no vino», que es otra cosa
    // y ademas sube en agosto por motivos alegres.
    await sembrar('vacaciones', 'aprobada', '2026-09-07', '2026-09-11');
    await sembrar('permiso', 'aprobada', '2026-09-14', '2026-09-14');
    expect(await incapacidadesParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('CANDADO: una que EMPIEZA antes de la ventana pero entra en ella si viaja', async () => {
    // El reparto por mes necesita el rango COMPLETO para recortarlo el mismo:
    // si la consulta descartara esta fila por empezar fuera, los dias que si
    // caen dentro de la ventana desaparecerian del primer mes de la serie.
    await sembrar('incapacidad', 'registrada', '2026-08-25', '2026-09-04');
    const filas = await incapacidadesParaKpi(db, '2026-09-01', '2026-09-30');

    expect(filas).toHaveLength(1);
    // Llega con sus fechas ORIGINALES, sin recortar: recortar es trabajo del
    // motor, que es quien sabe repartir por mes.
    expect(filas[0].fechaInicio).toBe('2026-08-25');
  });

  it('CANDADO: una que TERMINA despues de la ventana tambien entra', async () => {
    await sembrar('incapacidad', 'registrada', '2026-09-28', '2026-10-05');
    expect(await incapacidadesParaKpi(db, '2026-09-01', '2026-09-30')).toHaveLength(1);
  });

  it('las que no rozan la ventana se quedan fuera', async () => {
    await sembrar('incapacidad', 'registrada', '2024-05-06', '2024-05-10');
    expect(await incapacidadesParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('sin incapacidades, lista vacia', async () => {
    expect(await incapacidadesParaKpi(db, '2026-09-01', '2026-09-30')).toEqual([]);
  });
});
