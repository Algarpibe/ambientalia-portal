import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { planificacionDeVacaciones } from './repo.js';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';

// Las dos senales por empleado que enriquecen la lista de acumulacion:
// cuando disfruto vacaciones por ultima vez, y cuantos dias tiene ya pedidos
// hacia adelante.
//
// Las dos miran la MISMA tabla con recortes opuestos -pasado contra futuro- y
// por eso viven en una sola consulta: separarlas daria dos recorridos de lo
// mismo y dos sitios donde equivocarse con el `hoy`.

const CORREO = 'ana.ruiz@ambientalia.com.co';
const HOY = '2026-09-07';

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
  tipo: 'vacaciones' | 'permiso' | 'incapacidad',
  estado: 'registrada' | 'aprobada' | 'rechazada' | 'pendiente',
  fechaInicio: string,
  fechaFin: string,
): Promise<void> {
  await sembrarSolicitud(db, {
    empleadoId,
    correo: CORREO,
    estado,
    fechaInicio,
    fechaFin: tipo === 'permiso' ? fechaInicio : fechaFin,
    segundoAprobadorCorreo: null,
    tipo,
  });
}

/** La fila de nuestro empleado, o undefined si la consulta no la trajo. */
async function fila() {
  const filas = await planificacionDeVacaciones(db, HOY);
  return filas.find((f) => f.empleadoId === empleadoId);
}

describe('planificacionDeVacaciones: ultimas vacaciones', () => {
  it('devuelve la fecha de FIN de las ultimas vacaciones ya disfrutadas', async () => {
    await sembrar('vacaciones', 'aprobada', '2026-07-06', '2026-07-10');
    expect((await fila())?.ultimasVacaciones).toBe('2026-07-10');
  });

  it('coge las MAS RECIENTES cuando hay varias', async () => {
    await sembrar('vacaciones', 'aprobada', '2025-01-06', '2025-01-10');
    await sembrar('vacaciones', 'aprobada', '2026-07-06', '2026-07-10');
    expect((await fila())?.ultimasVacaciones).toBe('2026-07-10');
  });

  it('CANDADO: unas vacaciones FUTURAS no son las ultimas disfrutadas', async () => {
    // El error que haria inutil la senal: contar como «acaba de descansar» a
    // quien tiene el viaje reservado pero todavia no se ha ido. Justo la
    // persona que este KPI quiere distinguir del que ya volvio.
    await sembrar('vacaciones', 'aprobada', '2026-12-14', '2026-12-18');
    expect((await fila())?.ultimasVacaciones).toBeNull();
  });

  it('CANDADO: solo VACACIONES; un permiso o una incapacidad no son descanso', async () => {
    // Estar de incapacidad no es haber descansado, y es la confusion mas cara
    // de esta pantalla: dejaria de senalar a quien lleva dos anos sin vacaciones
    // justo porque estuvo enfermo.
    await sembrar('permiso', 'aprobada', '2026-07-06', '2026-07-06');
    await sembrar('incapacidad', 'registrada', '2026-07-13', '2026-07-17');
    expect((await fila())?.ultimasVacaciones).toBeNull();
  });

  it('CANDADO: unas vacaciones ANULADAS no cuentan como disfrutadas', async () => {
    await sembrar('vacaciones', 'rechazada', '2026-07-06', '2026-07-10');
    expect((await fila())?.ultimasVacaciones).toBeNull();
  });

  it('null cuando nunca ha disfrutado vacaciones', async () => {
    expect((await fila())?.ultimasVacaciones).toBeNull();
  });
});

describe('planificacionDeVacaciones: dias ya programados', () => {
  it('suma los dias habiles de las vacaciones futuras', async () => {
    // Del lunes 14 al viernes 18 de diciembre de 2026: 5 habiles.
    await sembrar('vacaciones', 'aprobada', '2026-12-14', '2026-12-18');
    expect((await fila())?.diasProgramados).toBe(5);
  });

  it('las PENDIENTES de firmar tambien cuentan como plan', async () => {
    // Quien ya las pidio ha planificado, aunque su jefe no haya firmado. Para
    // la pregunta que responde esta senal -«tiene algo previsto?»- una pendiente
    // vale igual que una aprobada.
    await sembrar('vacaciones', 'pendiente', '2026-12-14', '2026-12-18');
    expect((await fila())?.diasProgramados).toBe(5);
  });

  it('CANDADO: las vacaciones PASADAS no son plan', async () => {
    // Son justo lo contrario: ya se disfrutaron y por eso el saldo bajo. Que
    // sumaran aqui haria parecer previsor a quien no tiene nada por delante.
    await sembrar('vacaciones', 'aprobada', '2026-07-06', '2026-07-10');
    expect((await fila())?.diasProgramados).toBe(0);
  });

  it('CANDADO: unas vacaciones futuras ANULADAS dejan de ser plan', async () => {
    await sembrar('vacaciones', 'rechazada', '2026-12-14', '2026-12-18');
    expect((await fila())?.diasProgramados).toBe(0);
  });

  it('CANDADO: un permiso futuro no es un plan de VACACIONES', async () => {
    // Esta senal acompana al saldo de vacaciones, asi que solo puede contar lo
    // que baja ese saldo. Un permiso no lo toca.
    await sembrar('permiso', 'aprobada', '2026-12-14', '2026-12-14');
    expect((await fila())?.diasProgramados).toBe(0);
  });

  it('cero cuando no tiene nada pedido', async () => {
    expect((await fila())?.diasProgramados).toBe(0);
  });
});

describe('planificacionDeVacaciones: la fila', () => {
  it('trae a los empleados activos aunque no tengan ni historial ni plan', async () => {
    // La lista de acumulacion recorre la plantilla entera: si esta consulta
    // solo devolviera a quien tiene solicitudes, el resto se quedaria sin las
    // dos senales y la pantalla no sabria distinguir «no tiene plan» de «no
    // tengo el dato».
    const f = await fila();
    expect(f).toBeDefined();
    expect(f).toMatchObject({ ultimasVacaciones: null, diasProgramados: 0 });
  });

  it('las dos senales conviven en la misma fila', async () => {
    await sembrar('vacaciones', 'aprobada', '2026-07-06', '2026-07-10');
    await sembrar('vacaciones', 'aprobada', '2026-12-14', '2026-12-18');
    expect(await fila()).toMatchObject({ ultimasVacaciones: '2026-07-10', diasProgramados: 5 });
  });
});
