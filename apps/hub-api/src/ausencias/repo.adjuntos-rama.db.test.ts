import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { solicitudesConAdjunto, estaEnLaRamaDe } from './repo.js';
import { poolDePrueba, limpiar, sembrarSolicitud } from '../test-db/harness.js';

// El recorte por rama de la pestana «Soportes adjuntos», contra Postgres.
//
// Hasta ahora la llave `ve_adjuntos` abria la compania ENTERA: quien la tenia
// veia el PDF medico de cualquiera. Estas pruebas fijan el alcance nuevo -tu
// rama de dos niveles, la misma que el Calendario y el Registro general- y, lo
// que mas importa, que el recorte no se pueda esquivar.

const JEFE = 'gustavo@ambientalia.com.co';
const OTRO_JEFE = 'otrojefe@ambientalia.com.co';

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

/** Una ficha con su jefe, devolviendo el id. */
async function empleado(nombre: string, correo: string, aprobadorCorreo: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.empleados (nombre_completo, correo, cargo, aprobador_correo)
     VALUES ($1, $2, 'Analista', $3) RETURNING id`,
    [nombre, correo, aprobadorCorreo],
  );
  return (rows[0] as { id: string }).id;
}

/** Una solicitud CON adjunto, que es lo unico que esta pantalla lista. */
async function conAdjunto(empleadoId: string, correo: string, fechaInicio: string): Promise<void> {
  const s = await sembrarSolicitud(db, {
    empleadoId,
    correo,
    estado: 'registrada',
    fechaInicio,
    fechaFin: fechaInicio,
    segundoAprobadorCorreo: null,
    tipo: 'incapacidad',
  });
  await db.query(
    `INSERT INTO portal.solicitud_adjuntos (solicitud_id, nombre_archivo, mime, contenido)
     VALUES ($1, 'soporte.pdf', 'application/pdf', '\\x00'::bytea)`,
    [s.id],
  );
}

describe('solicitudesConAdjunto: el recorte por rama', () => {
  it('sin alcance (admin) trae los soportes de toda la compania', async () => {
    const mio = await empleado('Ana Ruiz', 'ana@x.com', JEFE);
    const ajeno = await empleado('Zoe Vera', 'zoe@x.com', OTRO_JEFE);
    await conAdjunto(mio, 'ana@x.com', '2026-09-07');
    await conAdjunto(ajeno, 'zoe@x.com', '2026-09-08');

    // `null` explicito = sin recorte. Es lo que recibe un administrador.
    expect(await solicitudesConAdjunto(db, null)).toHaveLength(2);
  });

  it('CANDADO: con alcance, NO trae los soportes de otra rama', async () => {
    // El bug que esto arregla. Quien tenia la llave veia el PDF medico de
    // cualquiera de la compania, incluida gente de la que no sabe nada.
    const mio = await empleado('Ana Ruiz', 'ana@x.com', JEFE);
    const ajeno = await empleado('Zoe Vera', 'zoe@x.com', OTRO_JEFE);
    await conAdjunto(mio, 'ana@x.com', '2026-09-07');
    await conAdjunto(ajeno, 'zoe@x.com', '2026-09-08');

    const filas = await solicitudesConAdjunto(db, JEFE);
    expect(filas).toHaveLength(1);
    expect(filas[0].empleadoNombre).toBe('Ana Ruiz');
  });

  it('el alcance llega DOS niveles: la gente de mis jefes intermedios tambien', async () => {
    // La misma rama que el Calendario y el Registro general, ni mas ancha ni mas
    // estrecha: un jefe de jefes tiene que ver a su organizacion, o la pestana
    // seria inutil justo para quien mas la necesita.
    const intermedio = await empleado('Beto Paz', 'beto@x.com', JEFE);
    const nieto = await empleado('Ana Ruiz', 'ana@x.com', 'beto@x.com');
    await conAdjunto(intermedio, 'beto@x.com', '2026-09-07');
    await conAdjunto(nieto, 'ana@x.com', '2026-09-08');

    expect(await solicitudesConAdjunto(db, JEFE)).toHaveLength(2);
  });

  it('CANDADO: el tercer nivel ya NO entra', async () => {
    // Dos niveles es dos niveles. Sin este limite el recorte se iria comiendo
    // el organigrama hacia abajo hasta ser «toda la empresa» por otra via.
    const intermedio = await empleado('Beto Paz', 'beto@x.com', JEFE);
    const nieto = await empleado('Ana Ruiz', 'ana@x.com', 'beto@x.com');
    const bisnieto = await empleado('Zoe Vera', 'zoe@x.com', 'ana@x.com');
    await conAdjunto(bisnieto, 'zoe@x.com', '2026-09-09');
    void intermedio;
    void nieto;

    expect(await solicitudesConAdjunto(db, JEFE)).toEqual([]);
  });

  it('el correo del jefe se compara sin distinguir mayusculas', async () => {
    const mio = await empleado('Ana Ruiz', 'ana@x.com', JEFE);
    await conAdjunto(mio, 'ana@x.com', '2026-09-07');
    expect(await solicitudesConAdjunto(db, JEFE.toUpperCase())).toHaveLength(1);
  });

  it('CANDADO: solo lista lo que TIENE adjunto, con recorte o sin el', async () => {
    // El recorte no puede cambiar lo que esta pantalla es: las solicitudes que
    // llevan un PDF. Una sin adjunto aqui seria una fila que no se puede abrir.
    const mio = await empleado('Ana Ruiz', 'ana@x.com', JEFE);
    await sembrarSolicitud(db, {
      empleadoId: mio,
      correo: 'ana@x.com',
      estado: 'aprobada',
      fechaInicio: '2026-09-07',
      fechaFin: '2026-09-11',
      segundoAprobadorCorreo: null,
    });
    expect(await solicitudesConAdjunto(db, JEFE)).toEqual([]);
    expect(await solicitudesConAdjunto(db, null)).toEqual([]);
  });
});

describe('estaEnLaRamaDe: el mismo recorte, para UN adjunto suelto', () => {
  // Sin esto, recortar la lista no serviria de nada: `GET /adjuntos/:id`
  // seguiria sirviendo cualquier PDF a quien tuviera la llave, y bastaria con
  // conocer la URL. La lista y la puerta tienen que decir lo mismo.

  it('true para alguien de mi rama directa', async () => {
    await empleado('Ana Ruiz', 'ana@x.com', JEFE);
    expect(await estaEnLaRamaDe(db, JEFE, 'ana@x.com')).toBe(true);
  });

  it('true para el segundo nivel', async () => {
    await empleado('Beto Paz', 'beto@x.com', JEFE);
    await empleado('Ana Ruiz', 'ana@x.com', 'beto@x.com');
    expect(await estaEnLaRamaDe(db, JEFE, 'ana@x.com')).toBe(true);
  });

  it('CANDADO: false para otra rama', async () => {
    await empleado('Zoe Vera', 'zoe@x.com', OTRO_JEFE);
    expect(await estaEnLaRamaDe(db, JEFE, 'zoe@x.com')).toBe(false);
  });

  it('CANDADO: false para el tercer nivel, igual que la lista', async () => {
    await empleado('Beto Paz', 'beto@x.com', JEFE);
    await empleado('Ana Ruiz', 'ana@x.com', 'beto@x.com');
    await empleado('Zoe Vera', 'zoe@x.com', 'ana@x.com');
    expect(await estaEnLaRamaDe(db, JEFE, 'zoe@x.com')).toBe(false);
  });

  it('false para un correo que no es de nadie', async () => {
    expect(await estaEnLaRamaDe(db, JEFE, 'nadie@x.com')).toBe(false);
  });

  it('sin distinguir mayusculas por los dos lados', async () => {
    await empleado('Ana Ruiz', 'ana@x.com', JEFE);
    expect(await estaEnLaRamaDe(db, JEFE.toUpperCase(), 'ANA@X.COM')).toBe(true);
  });
});
