import { inject } from 'vitest';
import { createPoolFromUrl, type Pool } from '@algarpibe/zoho-sync';
import { crearSolicitud } from '../ausencias/repo.js';
import type { PayloadEvento, Solicitud, TipoSolicitud } from '../ausencias/types.js';

/** El pool REAL de produccion, apuntando al contenedor. Ningun doble. */
export function poolDePrueba(): Pool {
  const db = createPoolFromUrl(inject('urlBd'));
  // El mismo listener que instala `getHubPool()` en db.ts, y por lo mismo que
  // explica alli: sin el, un 'error' de cliente inactivo es un error de
  // EventEmitter sin manejar. Aqui se llevaria por delante el proceso de vitest
  // entero —error opaco, ningun test rojo— en vez de fallar el test que corre.
  db.on('error', (err: Error) => console.error('pool de prueba', err));
  return db;
}

/**
 * Vacia las tablas entre tests.
 *
 * `portal.solicitud_adjuntos` no esta en la lista y se vacia igual: cuelga de
 * `solicitudes_ausencia` por FK y el CASCADE se la lleva. Se dice aqui porque
 * no vale de regla general — este esquema tiene auditoria SIN FK a proposito
 * (`visores_adjuntos_log`, ver la 022), y esa habria que anadirla a mano el dia
 * que un test la toque.
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
  /**
   * Opcional porque a casi ningun test le importa. Hace falta en cuanto uno
   * siembre una `registrada`: ese estado es el terminal de las INCAPACIDADES, y
   * dejarlo con el `vacaciones` por defecto crearia una fila que produccion no
   * puede producir, y un fixture imposible prueba menos de lo que aparenta.
   */
  tipo?: TipoSolicitud;
}

/** Una solicitud creada por `crearSolicitud`, sin adjunto y sin eventos. */
export async function sembrarSolicitud(db: Pool, d: DatosSiembra): Promise<Solicitud> {
  return crearSolicitud(
    db,
    {
      tipo: d.tipo ?? 'vacaciones',
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
