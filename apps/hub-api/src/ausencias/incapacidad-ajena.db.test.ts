import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud, eventosDelOutbox } from '../test-db/harness.js';
import { crearSolicitud, registrarIncapacidadAjena } from './service.js';
import { hoyEnColombia } from './saldo.js';
import { sumarDias } from './festivos.js';

// La incapacidad que registra el administrador a nombre de otro, contra
// Postgres de verdad: la columna de la 080, su escritura y su lectura en el
// repo, y las dos puertas del alta (la del empleado y la del admin).

let db: Pool;

// Correos ficticios. ADMIN es el mismo que usa router.test.ts para un admin.
const CORREO = 'ana.ruiz@ambientalia.com.co';
const ADMIN = 'admin@ambientalia.com.co';
const PDF = Buffer.from('%PDF-1.4 prueba').toString('base64');
const soporte = { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: PDF };
const sesionEmpleado = { email: CORREO, userId: null, esAdmin: false };
// El admin no tiene ficha: la puerta nueva no la necesita (no pasa por
// empleadoDeSesion), y es el caso real del admin sin apps.
const sesionAdmin = { email: ADMIN, userId: null, esAdmin: true };

const incapacidadesEnBd = async () =>
  Number(
    (await db.query(`SELECT count(*)::int AS n FROM portal.solicitudes_ausencia WHERE tipo = 'incapacidad'`)).rows[0].n,
  );

async function registradaPorEnBd(id: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT registrada_por FROM portal.solicitudes_ausencia WHERE id = $1`, [id]);
  return (rows[0] as { registrada_por: string | null }).registrada_por;
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

describe('migracion 080', () => {
  it('CANDADO: la columna registrada_por existe y admite NULL (o sea, la 080 esta en MIGRATIONS)', async () => {
    // Los casts no son estilo: las columnas de information_schema son dominios,
    // y el driver devuelve como texto lo que no reconoce.
    const { rows } = await db.query(
      `SELECT data_type::text AS tipo, character_maximum_length::int AS largo, is_nullable::text AS nulable,
              column_default::text AS por_defecto
         FROM information_schema.columns
        WHERE table_schema = 'portal' AND table_name = 'solicitudes_ausencia' AND column_name = 'registrada_por'`,
    );
    // Sin valor por defecto: con uno, toda solicitud que registra la propia persona
    // pareceria registrada por un administrador.
    expect(rows).toEqual([{ tipo: 'character varying', largo: 254, nulable: 'YES', por_defecto: null }]);
  });
});

describe('repo: registrada_por se escribe y se lee', () => {
  // Por `sembrarSolicitud`, que pasa por repo.crearSolicitud -> insertarSolicitud:
  // el mismo INSERT y el mismo SELECT_SOLICITUD que el alta del servidor.
  const incapacidad = (empleadoId: string, registradaPor?: string | null) =>
    sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'registrada',
      tipo: 'incapacidad',
      fechaInicio: '2025-03-03',
      fechaFin: '2025-03-05',
      segundoAprobadorCorreo: null,
      registradaPor,
    });

  it('con valor: queda en la columna y vuelve en la Solicitud', async () => {
    const s = await incapacidad(await sembrarEmpleado(db, CORREO), ADMIN);
    expect(await registradaPorEnBd(s.id)).toBe(ADMIN);
    expect(s.registradaPor).toBe(ADMIN);
  });

  it('lo guarda en minusculas aunque llegue con mayusculas', async () => {
    // La spec promete el correo en minusculas. sesionDe ya lo baja, y el INSERT
    // lo repite para que ninguna otra puerta futura pueda colarlo de otra forma.
    const s = await incapacidad(await sembrarEmpleado(db, CORREO), 'Admin@Ambientalia.com.co');
    expect(await registradaPorEnBd(s.id)).toBe(ADMIN);
    // Y la Solicitud devuelta: el JSON del empleado y el acuse leen esto, no la columna.
    expect(s.registradaPor).toBe(ADMIN);
  });

  it('sin valor: NULL en la columna y null (no undefined) en la Solicitud', async () => {
    const s = await incapacidad(await sembrarEmpleado(db, CORREO));
    expect(await registradaPorEnBd(s.id)).toBeNull();
    expect(s.registradaPor).toBeNull();
  });
});

describe('el alta del empleado', () => {
  it('CANDADO: deja registrada_por en NULL', async () => {
    // Empieza hoy y acaba manana: dentro de su ventana con el reloj real.
    await sembrarEmpleado(db, CORREO);
    const hoy = hoyEnColombia();
    const s = await crearSolicitud(db, sesionEmpleado, {
      tipo: 'incapacidad',
      fechaInicio: hoy,
      fechaFin: sumarDias(hoy, 1),
      adjunto: soporte,
    });
    expect(await registradaPorEnBd(s.id)).toBeNull();
    expect(s.registradaPor).toBeNull();
  });
});

describe('service.registrarIncapacidadAjena contra la BD', () => {
  // Un ano atras con el reloj real: muy fuera de la ventana de dos dias del
  // alta del empleado. Aqui no se afirma ningun recuento de dias habiles, asi
  // que un festivo de por medio no cambia nada.
  const haceUnAno = () => sumarDias(hoyEnColombia(), -365);

  it('guarda registrada_por, el correo del EMPLEADO, registrada, el PDF, el evento y el calendario', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const inicio = haceUnAno();
    const s = await registrarIncapacidadAjena(db, sesionAdmin, {
      empleadoId,
      fechaInicio: inicio,
      fechaFin: sumarDias(inicio, 2),
      adjunto: soporte,
    });

    const { rows } = await db.query(
      `SELECT registrada_por, solicitante_email, estado, tipo, aprobador_correo,
              evento_calendario_id IS NOT NULL AS con_evento
         FROM portal.solicitudes_ausencia WHERE id = $1`,
      [s.id],
    );
    expect(rows[0]).toEqual({
      registrada_por: ADMIN,
      solicitante_email: CORREO,
      estado: 'registrada',
      tipo: 'incapacidad',
      aprobador_correo: null,
      con_evento: true,
    });
    const { rows: adjuntos } = await db.query(
      `SELECT nombre_archivo, mime FROM portal.solicitud_adjuntos WHERE solicitud_id = $1`,
      [s.id],
    );
    // Renombrado con el nombre del EMPLEADO (sembrarEmpleado siembra "Ana Ruiz").
    expect(adjuntos).toEqual([{ nombre_archivo: `Incapacidades_Ana_Ruiz_${inicio}_1.pdf`, mime: 'application/pdf' }]);
    expect(await eventosDelOutbox(db)).toEqual(['registrada']);
  });

  it('el acuse que queda en la cola dice que la registro administracion, y va al empleado', async () => {
    // Prueba de punta a punta de que repo/filas.ts lee la columna ANTES de que
    // insertarSolicitud construya el payload: si no la leyera, el correo saldria
    // con el texto de siempre.
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const inicio = haceUnAno();
    await registrarIncapacidadAjena(db, sesionAdmin, { empleadoId, fechaInicio: inicio, fechaFin: inicio, adjunto: soporte });
    const { rows } = await db.query(`SELECT payload FROM portal.ausencias_outbox ORDER BY id`);
    const [{ payload }] = rows as { payload: { correo: { para: string; asunto: string } } }[];
    expect(payload.correo.asunto).toBe('Administración ha registrado tu incapacidad');
    expect(payload.correo.para).toContain(CORREO);
  });

  it('CANDADO: la regla de no solaparse sigue mordiendo', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    const inicio = haceUnAno();
    await sembrarSolicitud(db, {
      empleadoId,
      correo: CORREO,
      estado: 'aprobada',
      fechaInicio: sumarDias(inicio, 1),
      fechaFin: sumarDias(inicio, 4),
      segundoAprobadorCorreo: null,
    });
    await expect(
      registrarIncapacidadAjena(db, sesionAdmin, { empleadoId, fechaInicio: inicio, fechaFin: sumarDias(inicio, 2), adjunto: soporte }),
    ).rejects.toMatchObject({ code: 'rango_solapado', status: 409 });
    expect(await incapacidadesEnBd()).toBe(0);
  });

  it('una ficha inactiva da 404 y no deja nada', async () => {
    const empleadoId = await sembrarEmpleado(db, CORREO);
    await db.query(`UPDATE portal.empleados SET activo = FALSE WHERE id = $1`, [empleadoId]);
    const inicio = haceUnAno();
    await expect(
      registrarIncapacidadAjena(db, sesionAdmin, { empleadoId, fechaInicio: inicio, fechaFin: inicio, adjunto: soporte }),
    ).rejects.toMatchObject({ code: 'empleado_no_encontrado', status: 404 });
    expect(await incapacidadesEnBd()).toBe(0);
    expect(await eventosDelOutbox(db)).toEqual([]);
  });
});
