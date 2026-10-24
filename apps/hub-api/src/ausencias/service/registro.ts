import type { Pool } from '@algarpibe/zoho-sync';
import { AusenciaError } from '../errores.js';
import * as repo from '../repo.js';
import type { Movimiento, Solicitud } from '../types.js';
import type { Sesion } from './sesion.js';

// ARQ-612 — quién ve qué en el registro, sacado de service.ts tal cual: el
// registro de movimientos, la pestaña de adjuntos y la puerta de un PDF
// concreto. Las tres deciden el alcance a partir de la sesión y nunca de un
// parámetro del cliente. service.ts lo reexporta (lo vigila barril.test.ts).

/**
 * El registro de movimientos que le corresponde a quien pregunta.
 *
 * ⚠️ El recorte lo decide AQUÍ el servidor a partir de la sesión, y NUNCA un
 * parámetro que mande el cliente: es la única barrera entre un jefe y el
 * historial de toda la empresa.
 *
 * Sustituye a `decididasPorMi` —que iba acotada al correo y sin guard porque
 * una lista vacía ya era la respuesta correcta—. Aquí no vale ese criterio: el
 * `soloDe` de `repo.movimientos` recorta por RAMA del organigrama, así que a
 * quien no aprueba a nadie no le saldría una lista vacía sino su propia rama
 * vacía... y a quien sí aprueba le saldrían las incapacidades y los permisos
 * —con sus motivos— de su rama. Por eso el 403 explícito: quien no es aprobador
 * no tiene registro que ver, y decírselo es mejor que enseñarle un vacío que
 * parece un fallo.
 *
 * Hay una TERCERA vía además de admin y aprobador: la ficha marcada con
 * `ve_toda_la_empresa` (migración 032), que entra sin aprobar a nadie y sin
 * recorte por rama. Existe para el puesto de administración que lleva la
 * nómina, que necesita la compañía entera y no una rama, y a quien darle el rol
 * de admin le regalaría además editar, borrar e importar.
 */
export async function movimientosVisibles(db: Pool, sesion: Sesion): Promise<Movimiento[]> {
  // Se resuelve UNA vez y antes del guard porque decide las DOS cosas: si pasa
  // y qué ve. Preguntarlo por separado en cada sitio dejaría abierta la puerta a
  // que un día solo se cambiara uno de los dos, y esa discrepancia no falla: o
  // deja fuera a quien tiene el permiso, o —lo grave— deja pasar el recorte por
  // rama sobre alguien a quien ya se le abrió el 403.
  const veTodo = sesion.esAdmin || (await repo.esVisorDeTodaLaEmpresa(db, sesion.email));
  if (!veTodo && !(await repo.esAprobadorDeAlguien(db, sesion.email))) {
    throw new AusenciaError('no_es_aprobador', 403);
  }
  return repo.movimientos(db, veTodo ? null : sesion.email);
}

/**
 * Todas las solicitudes que llevan un PDF, para que administración pueda abrirlos
 * sin salir del portal.
 *
 * Hace falta una pantalla propia porque **las incapacidades no aparecen en
 * ninguna otra**: nacen `registrada` y sin aprobador, así que ni la bandeja
 * (`pendiente`/`pendiente_2`) ni el historial (`aprobada`/`rechazada`) las
 * alcanzan, y «Registro general» es solo de admin. Justo las incapacidades son
 * las que siempre traen soporte médico.
 *
 * 403 y no 404, al revés que en `/adjuntos/:id`: allí el 404 evita confirmar que
 * un adjunto concreto existe; una colección no dice nada de nadie en particular.
 */
export async function solicitudesConAdjunto(db: Pool, sesion: Sesion): Promise<Solicitud[]> {
  if (!sesion.esAdmin && !(await repo.esVisorDeAdjuntos(db, sesion.email))) {
    throw new AusenciaError('no_es_visor_de_adjuntos', 403);
  }
  // ⚠️ LA LLAVE `ve_adjuntos` YA NO ABRE LA COMPAÑÍA ENTERA. Abre la rama de dos
  // niveles de quien la tiene, que es el mismo alcance que el Calendario y el
  // Registro general. Solo un administrador sigue viendo todo.
  //
  // Antes daba acceso a los soportes de cualquiera —incluidos los PDF médicos
  // de gente con la que quien miraba no tiene ninguna relación—, y eso no era
  // lo que la casilla prometía a quien la marcaba.
  //
  // El `null` explícito de admin es obligatorio: sin él, `ramaDeDosNiveles` no
  // recorta solo cuando recibe NULL, y pasar `undefined` lo dejaría en un
  // parámetro sin valor en vez de en «sin recorte».
  return repo.solicitudesConAdjunto(db, sesion.esAdmin ? null : sesion.email);
}

/**
 * El solicitante, sus dos aprobadores y quien tenga la llave maestra pueden ver
 * el PDF; nadie más (salvo admin).
 *
 * `esVisor` entra por parámetro y no se consulta aquí: desde que la lista salió
 * de `config.ts` a `portal.empleados`, resolverla dentro obligaría a pasar el
 * `Pool` y esta función dejaría de poder probarse sin Postgres — que no hay en
 * ningún test del repo. Quien llama lo resuelve con `repo.esVisorDeAdjuntos`.
 *
 * La llave AÑADE acceso, nunca lo condiciona: por eso va como retorno propio y
 * no como una condición del `return` final. Quitársela a alguien no puede
 * dejarle sin ver sus propias solicitudes.
 */
export function puedeVerAdjunto(
  sesion: Sesion,
  a: repo.AdjuntoCompleto,
  /**
   * Tiene la llave `ve_adjuntos` **y** el solicitante está en su rama de dos
   * niveles. Las dos cosas, y por eso el nombre cambió: la llave sola dejó de
   * ser un pase libre cuando la pestaña pasó a recortar por rama.
   *
   * Si aquí bastara con tener la llave, esconder filas en la lista no serviría
   * de nada: quien conociera la URL de un adjunto lo abriría igual. La lista y
   * esta puerta tienen que decir lo mismo.
   */
  visorEnSuRama: boolean,
): boolean {
  if (sesion.esAdmin) return true;
  if (visorEnSuRama) return true;
  const yo = sesion.email.toLowerCase();
  // El segundo aprobador entra aquí aunque todavía no sea su turno: la ruta del
  // adjunto devuelve 404 y no 403, así que sin esto tendría que firmar un permiso
  // sin poder abrir su soporte y sin entender por qué.
  return (
    a.solicitanteEmail.toLowerCase() === yo ||
    (a.aprobadorCorreo ?? '').toLowerCase() === yo ||
    (a.segundoAprobadorCorreo ?? '').toLowerCase() === yo
  );
}
