import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';
import { solicitudesDeEmpleado } from './repo.js';

// La hora opcional de los permisos contra Postgres de verdad.
//
// Todo lo de este fichero es SQL, y en este repo una regla escrita en SQL solo
// la vigila un test de test:db: el doble in-memory de router.test.ts no ejecuta
// consultas, asi que un CHECK que falte o un CASE mal puesto pasarian los mil y
// pico unitarios en verde.

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
 * Inserta una solicitud A PELO, saltandose el repo a proposito: lo que se
 * prueba aqui es el CHECK de la base, y pasar por la validacion del servicio
 * probaria la validacion en vez de la constraint.
 */
async function insertar(
  empleadoId: string,
  fechaInicio: string,
  fechaFin: string,
  horaInicio: string | null,
  horaFin: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO portal.solicitudes_ausencia
       (tipo, empleado_id, solicitante_email, fecha_inicio, fecha_fin, dias_habiles,
        hora_inicio, hora_fin)
     VALUES ('permiso', $1, 'ana@hora.test', $2::date, $3::date, 1, $4::time, $5::time)`,
    [empleadoId, fechaInicio, fechaFin, horaInicio, horaFin],
  );
}

describe('migracion 036', () => {
  it('CANDADO: las dos columnas existen (o sea, la 036 esta en el array MIGRATIONS)', async () => {
    // Olvidar el array no da ningun error: la migracion no corre y la columna
    // no existe solo en produccion. Este test es el unico que lo caza.
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'solicitudes_ausencia'
          AND column_name IN ('hora_inicio', 'hora_fin')
        ORDER BY column_name`,
    );
    // Se fija el tipo entero y no solo el nombre, mismo patron que el candado
    // de la 035: un data_type que cambiara sin que este test se enterara
    // pasaria desapercibido hasta que una comparacion de otra tarea mirara
    // contra el tipo equivocado.
    expect(rows).toEqual([
      { column_name: 'hora_fin', data_type: 'time without time zone', is_nullable: 'YES' },
      { column_name: 'hora_inicio', data_type: 'time without time zone', is_nullable: 'YES' },
    ]);
  });

  it('una solicitud sin horas se guarda igual que siempre', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-03', null, null);
    const { rows } = await db.query('SELECT hora_inicio, hora_fin FROM portal.solicitudes_ausencia');
    expect(rows[0]).toEqual({ hora_inicio: null, hora_fin: null });
  });

  it('acepta la pareja completa en un permiso de UN dia', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-01', '09:00', '11:00');
    const { rows } = await db.query(
      `SELECT to_char(hora_inicio, 'HH24:MI') AS ini, to_char(hora_fin, 'HH24:MI') AS fin
         FROM portal.solicitudes_ausencia`,
    );
    expect(rows[0]).toEqual({ ini: '09:00', fin: '11:00' });
  });

  it('CANDADO: media pareja NO entra, con la hora de inicio suelta', async () => {
    // Las dos direcciones por separado y no una de muestra: son las que caen en
    // la trampa del CHECK que PASA cuando la expresion da NULL. Sin los dos
    // `IS NOT NULL` de la constraint, esta fila entraria y a Google se le
    // mandaria un ISO con null dentro.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', '09:00', null)).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: media pareja NO entra, con la hora de fin suelta', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', null, '11:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: la hora de fin no puede ser igual a la de inicio', async () => {
    // Un permiso de duracion cero no es un permiso, y en Google seria un evento
    // sin altura que no se ve.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', '09:00', '09:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: la hora de fin no puede ser anterior a la de inicio', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-01', '11:00', '09:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });

  it('CANDADO: con horas, el rango tiene que ser de UN solo dia', async () => {
    // «Del lunes al viernes de 9:00 a 11:00» no tiene lectura unica. Si esto
    // entrara, `calendario()` construiria el ISO con la fecha de inicio y el
    // evento mentiria sobre los otros cuatro dias.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await expect(insertar(id, '2026-09-01', '2026-09-02', '09:00', '11:00')).rejects.toThrow(
      /solicitudes_horas_coherentes/,
    );
  });
});

describe('el repo lee y escribe las horas', () => {
  it('CANDADO: devuelve HH:MM, no HH:MM:SS ni un objeto', async () => {
    // Sin el to_char, el driver devuelve un TIME como la cadena '09:00:00', y
    // esa cadena se concatena tal cual dentro del ISO que se le manda a Google
    // -«...T09:00:00:00-05:00»- y en el value de un <input type="time">, que
    // solo entiende HH:MM. Las dos roturas son silenciosas.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-01', '09:00', '11:00');
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBe('09:00');
    expect(s.horaFin).toBe('11:00');
  });

  it('una solicitud sin horas las devuelve en null', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-03', null, null);
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBeNull();
    expect(s.horaFin).toBeNull();
  });

  it('crearSolicitud guarda las horas que le pasan', async () => {
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await sembrarSolicitud(db, {
      empleadoId: id,
      correo: 'ana@hora.test',
      estado: 'pendiente',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      segundoAprobadorCorreo: null,
      tipo: 'permiso',
      horaInicio: '14:00',
      horaFin: '16:30',
    });
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBe('14:00');
    expect(s.horaFin).toBe('16:30');
  });

  it('los extremos del dia van y vuelven sin recortarse', async () => {
    // 00:00 y 23:59 son los bordes del rango: un formateo de 12 horas
    // convertiria 00:00 en 12:00 (o en nada), y un recorte mal puesto en el
    // to_char podria comerse el 23:59 o devolverlo como '24:00'. Los tests de
    // arriba usan horas de mitad de jornada y no cazarian ninguno de los dos.
    const id = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(id, '2026-09-01', '2026-09-01', '00:00', '23:59');
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBe('00:00');
    expect(s.horaFin).toBe('23:59');
  });
});
