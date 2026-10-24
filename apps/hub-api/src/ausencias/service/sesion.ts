import type { Pool } from '@algarpibe/zoho-sync';
import { AusenciaError } from '../errores.js';
import type { Firmante } from '../notificaciones.js';
import * as repo from '../repo.js';
import type { Empleado } from '../types.js';

// ARQ-612 — quién es la sesión, sacado de service.ts tal cual: el tipo `Sesion`
// y las dos formas de pasar de ella a una ficha, la de quien pide
// (`empleadoDeSesion`) y la de quien firma (`firmanteDeSesion`). Casi todos los
// trozos de service/ lo necesitan, y por eso es el primero en salir: así
// ninguno tiene que importar de service.ts. service.ts lo reexporta (lo vigila
// barril.test.ts).

export interface Sesion {
  email: string;
  userId: string | null;
  esAdmin: boolean;
}

/**
 * El empleado del usuario logueado, dándolo de alta si aún no tenía ficha.
 *
 * Quien tiene la app asignada es exactamente quien debe poder solicitar, así
 * que la asignación ya es el permiso; la ficha se deriva sola de la cuenta del
 * portal. Solo queda 403 cuando de verdad no hay de dónde sacarla: un token
 * legacy sin usuario en BD, o una ficha que un admin desactivó a propósito.
 */
export async function empleadoDeSesion(db: Pool, sesion: Sesion): Promise<Empleado> {
  const empleado = await repo.asegurarEmpleado(db, sesion.userId, sesion.email);
  if (!empleado) throw new AusenciaError('empleado_no_registrado', 403);
  return empleado;
}

/**
 * Quién firma los correos que salen de esta decisión: la persona de la sesión.
 *
 * La sesión y NO el `aprobadorCorreo` congelado en la solicitud, y la diferencia
 * importa en el caso que se da de verdad: un admin destrabando una aprobación
 * firma con su nombre, porque es quien decidió. Es el mismo criterio que la
 * columna «Decidida por» del registro, donde ya costó cuatro formas distintas de
 * atribuirle a alguien un acto que no hizo.
 *
 * `null` si no tiene ficha —se es aprobador por figurar en la columna de otro, y
 * un admin puede no tenerla—, y entonces `firmaDe` cae a la firma de la empresa.
 *
 * ⚠️ Si la consulta falla NO se tumba la decisión: la firma es un adorno del
 * correo y la aprobación es lo que el usuario vino a hacer. Perder la firma es
 * un correo menos personal; perder la decisión por no poder firmarla sería
 * cambiar un fallo cosmético por uno de negocio. Mismo criterio que los saldos
 * en `/ausencias/contexto`.
 */
export async function firmanteDeSesion(db: Pool, sesion: Sesion): Promise<Firmante | null> {
  try {
    const ficha = await repo.empleadoDeUsuario(db, sesion.userId, sesion.email);
    return ficha ? { nombreCompleto: ficha.nombreCompleto, cargo: ficha.cargo } : null;
  } catch (e) {
    console.error('ausencias_firmante error', e);
    return null;
  }
}
