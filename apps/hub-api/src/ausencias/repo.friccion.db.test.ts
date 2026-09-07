import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { solicitudesParaFriccion } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// La consulta del KPI de friccion, contra Postgres de verdad.
//
// Es la unica de las cuatro del panel que CRUZA DOS TABLAS: las solicitudes y
// sus modificaciones. Y la unica cuyo dato clave -si una `rechazada` fue un
// rechazo o una anulacion- no esta en ninguna columna de estado, sino en si
// `anulada_at` tiene valor.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const DESDE = '2020-01-01T00:00:00Z';

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

/** Una solicitud, devolviendo su id para poder colgarle modificaciones. */
async function sembrar(
  estado: 'registrada' | 'aprobada' | 'rechazada' | 'pendiente',
  fechaInicio = '2026-09-07',
  fechaFin = '2026-09-11',
): Promise<string> {
  const s = await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio,
    fechaFin,
    segundoAprobadorCorreo: null,
    tipo: estado === 'registrada' ? 'incapacidad' : 'vacaciones',
  });
  return s.id;
}

/** Marca una solicitud como ANULADA, que es como la deja `aplicarALaSolicitud`. */
async function anular(id: string): Promise<void> {
  await db.query(
    `UPDATE portal.solicitudes_ausencia SET estado = 'rechazada', anulada_at = now() WHERE id = $1`,
    [id],
  );
}

/** Le cuelga una modificacion a una solicitud, con la clase y el estado dados. */
async function modificar(
  solicitudId: string,
  clase: 'fechas' | 'anulacion',
  estado: 'pendiente' | 'aprobada' | 'rechazada',
): Promise<void> {
  await db.query(
    `INSERT INTO portal.solicitud_modificaciones
       (solicitud_id, clase, estado_previo, fecha_inicio_previa, fecha_fin_previa,
        dias_habiles_previos, fecha_inicio_nueva, fecha_fin_nueva, dias_habiles_nuevos,
        estado, aprobador_correo, solicitante_email)
     VALUES ($1, $2::varchar, 'aprobada', '2026-09-07', '2026-09-11', 5,
             -- Los tres ::varchar NO son decoracion: sin ellos Postgres deduce
             -- text para $2 al compararlo contra el literal y choca con el
             -- varchar de la columna («inconsistent types deduced»). Es el
             -- mismo gotcha que ya mordio en el UPDATE de tipo del repo.
             -- (Y sin acentos graves: dentro de esta plantilla cerrarian el
             -- template literal y esbuild no compilaria el fichero.)
             CASE WHEN $2::varchar = 'fechas' THEN DATE '2026-09-14' END,
             CASE WHEN $2::varchar = 'fechas' THEN DATE '2026-09-18' END,
             CASE WHEN $2::varchar = 'fechas' THEN 5 END,
             $3, 'jefe1@ambientalia.com.co', $4)`,
    [solicitudId, clase, estado, CORREO],
  );
}

describe('solicitudesParaFriccion', () => {
  it('CANDADO: separa el RECHAZO de la ANULACION por `anulada_at`', async () => {
    // El dato que hace util a este KPI. Las dos filas quedan en `rechazada` y
    // solo `anulada_at` dice cual fue cual. Sin este campo en la respuesta, el
    // motor no podria distinguirlas por mucho que quisiera.
    await sembrar('rechazada', '2026-09-07', '2026-09-11');
    const idAnulada = await sembrar('aprobada', '2026-10-05', '2026-10-09');
    await anular(idAnulada);

    const filas = await solicitudesParaFriccion(db, DESDE);
    expect(filas).toHaveLength(2);
    expect(filas.filter((f) => f.estado === 'rechazada' && !f.anulada)).toHaveLength(1);
    expect(filas.filter((f) => f.estado === 'rechazada' && f.anulada)).toHaveLength(1);
  });

  it('marca `cambioDeFechas` solo con una modificacion de fechas APROBADA', async () => {
    const id = await sembrar('aprobada');
    await modificar(id, 'fechas', 'aprobada');

    const filas = await solicitudesParaFriccion(db, DESDE);
    expect(filas).toHaveLength(1);
    expect(filas[0].cambioDeFechas).toBe(true);
  });

  it('CANDADO: un cambio de fechas PEDIDO pero no aprobado no es un cambio', async () => {
    // Pedirlo no es cambiarlo. Contar las pendientes convertiria en friccion
    // consumada algo que el aprobador todavia puede rechazar.
    const id = await sembrar('aprobada');
    await modificar(id, 'fechas', 'pendiente');
    expect((await solicitudesParaFriccion(db, DESDE))[0].cambioDeFechas).toBe(false);
  });

  it('CANDADO: un cambio de fechas RECHAZADO tampoco cuenta', async () => {
    const id = await sembrar('aprobada');
    await modificar(id, 'fechas', 'rechazada');
    expect((await solicitudesParaFriccion(db, DESDE))[0].cambioDeFechas).toBe(false);
  });

  it('CANDADO: una modificacion de clase ANULACION no es un cambio de fechas', async () => {
    // Las dos clases viven en la misma tabla. Una anulacion aprobada ya se
    // cuenta por `anulada_at`; contarla ademas aqui la sumaria dos veces bajo
    // dos etiquetas distintas.
    const id = await sembrar('aprobada');
    await modificar(id, 'anulacion', 'aprobada');
    expect((await solicitudesParaFriccion(db, DESDE))[0].cambioDeFechas).toBe(false);
  });

  it('CANDADO: dos cambios aprobados sobre la MISMA solicitud dan UNA fila', async () => {
    // El JOIN es la trampa clasica: sin agrupar, una solicitud con dos cambios
    // saldria dos veces y el denominador del porcentaje se inflaria solo.
    const id = await sembrar('aprobada');
    await modificar(id, 'fechas', 'aprobada');
    await modificar(id, 'fechas', 'aprobada');

    const filas = await solicitudesParaFriccion(db, DESDE);
    expect(filas).toHaveLength(1);
    expect(filas[0].cambioDeFechas).toBe(true);
  });

  it('las pendientes llegan igualmente: el recorte lo hace el motor', async () => {
    // El repo trae lo que hay y el motor decide que entra en el denominador.
    // Repartir esa regla entre los dos sitios es como se desincronizan.
    await sembrar('pendiente');
    expect(await solicitudesParaFriccion(db, DESDE)).toHaveLength(1);
  });

  it('CANDADO: la ventana recorta por `created_at`', async () => {
    await sembrar('aprobada');
    const filas = await solicitudesParaFriccion(db, '2099-01-01T00:00:00Z');
    expect(filas).toEqual([]);
  });

  it('sin solicitudes, lista vacia', async () => {
    expect(await solicitudesParaFriccion(db, DESDE)).toEqual([]);
  });
});
