import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, payloadStub, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';
import {
  solicitudesDeEmpleado,
  actualizarSolicitud,
  crearModificacion,
  decidirModificacion,
  type EdicionSolicitud,
} from './repo.js';
import { construirPayloadCorreccion } from './notificaciones.js';
import { crearSolicitud } from './service.js';
import { hoyEnColombia } from './saldo.js';
import { sumarDias } from './festivos.js';

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

describe('el alta de punta a punta, a traves del SERVICIO', () => {
  it('CANDADO: crearSolicitud del servicio valida la hora y la deja llegar al INSERT', async () => {
    // Las pruebas de arriba -incluida «crearSolicitud guarda las horas que le
    // pasan»- llaman a `sembrarSolicitud`, que importa `crearSolicitud` de
    // `./repo.js`: construye el `DatosInsercion` ella misma y salta el
    // validador. Por eso ninguna cazaria que se borrara el paso que copia
    // `datos.horaInicio`/`datos.horaFin` al alta en `service.ts` -se
    // comprobo revirtiendolo a mano: los 1039 unitarios y los otros tests de
    // este fichero seguian en verde-.
    //
    // Aqui se importa `crearSolicitud` de `./service.js` (mismo patron que
    // `repo.baja.db.test.ts`), asi que el camino es el real de punta a punta:
    // el servicio valida el body, arma el `DatosInsercion` con las horas ya
    // validadas, el repo inserta, y el CHECK `solicitudes_horas_coherentes` de
    // la 036 tiene la ultima palabra contra Postgres de verdad.
    //
    // La fecha se CALCULA y no se escribe fija: este test, al contrario que
    // los de arriba, pasa por la validacion del servicio, que compara contra
    // `hoyEnColombia()` de verdad -este fichero no monta reloj falso-. Una
    // fecha fija seria una cuenta atras: en cuanto el calendario la alcanzara,
    // el test se pondria rojo por `fecha_en_pasado`, un motivo que no tiene
    // nada que ver con lo que este test vigila.
    const fecha = sumarDias(hoyEnColombia(), 1);
    const id = await sembrarEmpleado(db, 'permiso@hora.test');
    await crearSolicitud(
      db,
      { email: 'permiso@hora.test', userId: null, esAdmin: false },
      { tipo: 'permiso', fechaInicio: fecha, fechaFin: fecha, horaInicio: '09:00', horaFin: '11:00' },
    );
    const [s] = await solicitudesDeEmpleado(db, id);
    expect(s.horaInicio).toBe('09:00');
    expect(s.horaFin).toBe('11:00');
  });
});

describe('las horas no sobreviven a un rango de varios dias', () => {
  const ADMIN = 'comercial@ambientalia.com.co';

  /** Un permiso de un dia con horas, listo para que se lo estiren. */
  async function permisoConHoras(): Promise<{ empleadoId: string; solicitudId: string }> {
    const empleadoId = await sembrarEmpleado(db, 'ana@hora.test');
    await insertar(empleadoId, '2026-09-01', '2026-09-01', '09:00', '11:00');
    const [s] = await solicitudesDeEmpleado(db, empleadoId);
    return { empleadoId, solicitudId: s.id };
  }

  /**
   * La correccion del registro general por la via real. El constructor de
   * payload es el de verdad y no un stub, aunque en estos tres casos ni se
   * llegue a llamar —la solicitud esta `pendiente`, o sea nunca estuvo en
   * Google—: pasarle el real es lo que hace `repo.correccion-admin.db.test.ts`
   * y lo que deja el camino exacto del router.
   */
  const corregir = (solicitudId: string, campos: EdicionSolicitud) =>
    actualizarSolicitud(db, solicitudId, campos, ADMIN, construirPayloadCorreccion);

  it('CANDADO: actualizarSolicitud estirando a dos dias NO revienta, y borra las horas', async () => {
    // Sin el CASE, el UPDATE viola el CHECK, la transaccion entera hace ROLLBACK
    // -con su evento de outbox dentro- y el admin recibe un 500 sin ninguna
    // pista. Es el motivo entero de esta tarea.
    const { empleadoId, solicitudId } = await permisoConHoras();

    const actual = await corregir(solicitudId, {
      empleadoId,
      tipo: 'permiso',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-03',
      dias: 3,
      estado: 'pendiente',
      comentarios: null,
      observaciones: null,
    });

    expect(actual).not.toBeNull();
    expect(actual?.fechaFin).toBe('2026-09-03');
    expect(actual?.horaInicio).toBeNull();
    expect(actual?.horaFin).toBeNull();
  });

  it('actualizarSolicitud sin mover las fechas CONSERVA las horas', async () => {
    // La otra mitad del CASE. Sin ella, corregir un comentario borraria una hora
    // que nadie pidio cambiar.
    const { empleadoId, solicitudId } = await permisoConHoras();

    const actual = await corregir(solicitudId, {
      empleadoId,
      tipo: 'permiso',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      dias: 1,
      estado: 'pendiente',
      comentarios: 'una nota nueva',
      observaciones: null,
    });

    expect(actual?.horaInicio).toBe('09:00');
    expect(actual?.horaFin).toBe('11:00');
  });

  it('CANDADO: cambiar el TIPO a uno que no admite hora tambien las borra', async () => {
    // El PATCH del registro es la unica via que puede cambiar el tipo, y el
    // CHECK de la BD no mira el tipo: sin esta mitad, unas vacaciones acabarian
    // con una franja horaria pegada que la app pintaria tal cual.
    const { empleadoId, solicitudId } = await permisoConHoras();

    const actual = await corregir(solicitudId, {
      empleadoId,
      tipo: 'vacaciones',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      dias: 1,
      estado: 'pendiente',
      comentarios: null,
      observaciones: null,
    });

    expect(actual?.tipo).toBe('vacaciones');
    expect(actual?.horaInicio).toBeNull();
    expect(actual?.horaFin).toBeNull();
  });
});

describe('las horas tampoco sobreviven a una MODIFICACION aprobada', () => {
  // El otro camino que estira las fechas de una solicitud ya creada, y el que se
  // habia quedado sin candado: los tres tests de aqui arriba van todos por
  // `actualizarSolicitud`, asi que el CASE gemelo de `aplicarALaSolicitud` se
  // podia borrar entero sin que se pusiera roja ni una de las 210 pruebas de
  // test:db. Se comprobo mutandolo -quitando el CASE y dejando el SET como
  // estaba-: 18 ficheros y 210 tests seguian en verde. Esto lo cierra.
  //
  // El flujo es el REAL -`crearModificacion` + `decidirModificacion`, que es
  // quien llama a `aplicarALaSolicitud`- y no un UPDATE a pelo, por lo mismo que
  // anota `repo.movimientos.db.test.ts`: un fixture que escribe el resultado a
  // mano afirma la premisa en vez de ejercitarla.

  const PRIMER_FIRMANTE = 'jefe1@ambientalia.com.co';

  it('CANDADO: aprobar un cambio que estira a dos dias NO revienta, y borra las horas', async () => {
    const empleadoId = await sembrarEmpleado(db, 'ana@hora.test');
    const solicitud = await sembrarSolicitud(db, {
      empleadoId,
      correo: 'ana@hora.test',
      estado: 'aprobada',
      tipo: 'permiso',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      segundoAprobadorCorreo: null,
      horaInicio: '09:00',
      horaFin: '11:00',
    });

    const alta = await crearModificacion(
      db,
      {
        solicitudId: solicitud.id,
        clase: 'fechas',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: '2026-09-01',
        fechaFinNueva: '2026-09-03',
        diasHabilesNuevos: 3,
        motivo: 'Se alarga el tramite',
        aprobadorCorreo: PRIMER_FIRMANTE,
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta de la propuesta fallo con razon ${alta.razon}`);

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);

    // Sin el CASE esto ni siquiera llega a fallar por el `ok`: el UPDATE viola
    // el CHECK de la 036 y la excepcion sale disparada desde `decidirModificacion`
    // -no es ni ChoqueConLaSolicitud ni SolapeAlAplicar, asi que su catch la
    // relanza-, tumbando con el ROLLBACK la decision del jefe y su evento.
    if (!r.ok) throw new Error(`la decision fallo con razon ${r.razon}`);
    expect(r.solicitud.fechaFin).toBe('2026-09-03');
    expect(r.solicitud.horaInicio).toBeNull();
    expect(r.solicitud.horaFin).toBeNull();

    // Y releida de la tabla, no solo en lo que devolvio la funcion.
    const [guardada] = await solicitudesDeEmpleado(db, empleadoId);
    expect(guardada.horaInicio).toBeNull();
    expect(guardada.horaFin).toBeNull();
  });

  it('aprobar un cambio que sigue siendo de UN dia CONSERVA las horas', async () => {
    // La otra mitad del CASE, igual que en su gemelo: mover un permiso con hora
    // del martes al jueves no es motivo para perder la franja.
    const empleadoId = await sembrarEmpleado(db, 'ana@hora.test');
    const solicitud = await sembrarSolicitud(db, {
      empleadoId,
      correo: 'ana@hora.test',
      estado: 'aprobada',
      tipo: 'permiso',
      fechaInicio: '2026-09-01',
      fechaFin: '2026-09-01',
      segundoAprobadorCorreo: null,
      horaInicio: '09:00',
      horaFin: '11:00',
    });

    const alta = await crearModificacion(
      db,
      {
        solicitudId: solicitud.id,
        clase: 'fechas',
        estadoEsperado: 'aprobada',
        fechaInicioNueva: '2026-09-03',
        fechaFinNueva: '2026-09-03',
        diasHabilesNuevos: 1,
        motivo: 'Me cambiaron la cita',
        aprobadorCorreo: PRIMER_FIRMANTE,
      },
      payloadStub,
    );
    if (!alta.ok) throw new Error(`el alta de la propuesta fallo con razon ${alta.razon}`);

    const r = await decidirModificacion(db, alta.modificacion.id, true, null, null, payloadStub);
    if (!r.ok) throw new Error(`la decision fallo con razon ${r.razon}`);
    expect(r.solicitud.fechaInicio).toBe('2026-09-03');
    expect(r.solicitud.horaInicio).toBe('09:00');
    expect(r.solicitud.horaFin).toBe('11:00');
  });
});
