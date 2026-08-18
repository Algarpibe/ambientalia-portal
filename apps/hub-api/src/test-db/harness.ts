import { inject } from 'vitest';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearSolicitud } from '../ausencias/repo.js';
import type { PayloadEvento, Solicitud } from '../ausencias/types.js';

/** El pool REAL de produccion, apuntando al contenedor. Ningun doble. */
export function poolDePrueba(): Pool {
  return createPoolFromUrl(inject('urlBd'));
}

/**
 * Vacia las tablas entre tests.
 *
 * No sirve envolver cada test en una transaccion: el codigo bajo prueba abre las
 * suyas con `withTransaction`, y anidarlas exigiria savepoints — justo lo que no
 * se quiere simular, porque el ROLLBACK real es una de las cosas que se prueban.
 */
export async function limpiar(db: Pool): Promise<void> {
  await db.query(
    `TRUNCATE portal.solicitud_modificaciones, portal.solicitudes_ausencia,
              portal.ausencias_outbox, portal.empleados
     RESTART IDENTITY CASCADE`,
  );
}

/** El payload no se ejercita aqui: lo cubre entero notificaciones.test.ts. */
export const payloadStub = () => ({ correo: { para: '', asunto: '', cuerpo: '' } }) as unknown as PayloadEvento;

/**
 * Un empleado por INSERT directo y no por `asegurarEmpleado`: esa funcion exige
 * una fila en `portal.users` con su hash de contrasena, y estos tests no van de
 * altas de usuario. La SOLICITUD si se crea con la funcion real del repo, que es
 * la que importa.
 */
export async function sembrarEmpleado(db: Pool, correo: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO portal.empleados (nombre_completo, correo, cargo, aprobador_correo)
     VALUES ('Ana Ruiz', $1, 'Analista', 'jefe1@ambientalia.com.co')
     RETURNING id`,
    [correo],
  );
  return (rows[0] as { id: string }).id;
}

export interface DatosSiembra {
  empleadoId: string;
  correo: string;
  estado: Solicitud['estado'];
  fechaInicio: string;
  fechaFin: string;
  /** Con correo, la solicitud lleva cascada de dos firmas; con null, una sola. */
  segundoAprobadorCorreo: string | null;
}

/** Una solicitud creada por `crearSolicitud`, sin adjunto y sin eventos. */
export async function sembrarSolicitud(db: Pool, d: DatosSiembra): Promise<Solicitud> {
  return crearSolicitud(
    db,
    {
      tipo: 'vacaciones',
      empleadoId: d.empleadoId,
      solicitanteEmail: d.correo,
      fechaInicio: d.fechaInicio,
      fechaFin: d.fechaFin,
      diasHabiles: 5,
      comentarios: null,
      estado: d.estado,
      aprobadorCorreo: 'jefe1@ambientalia.com.co',
      segundoAprobadorCorreo: d.segundoAprobadorCorreo,
      informadoCorreo: null,
    },
    null,
    // Sin eventos de alta: asi el outbox de cada test cuenta SOLO lo que el
    // propio test provoca.
    [],
    payloadStub,
  );
}

/** Los eventos del outbox, en el orden en que se sirven (por `id`). */
export async function eventosDelOutbox(db: Pool): Promise<string[]> {
  const { rows } = await db.query('SELECT evento FROM portal.ausencias_outbox ORDER BY id');
  return (rows as { evento: string }[]).map((r) => r.evento);
}
