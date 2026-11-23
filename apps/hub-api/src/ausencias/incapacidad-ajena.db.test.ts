import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { poolDePrueba, limpiar, sembrarEmpleado, sembrarSolicitud } from '../test-db/harness.js';
import { crearSolicitud } from './service.js';
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
