import type { Pool } from '@algarpibe/zoho-sync';
import { esFechaValida } from '../dias-habiles.js';
import { AusenciaError } from '../errores.js';
import * as repo from '../repo.js';
import { hoyEnColombia } from '../saldo.js';
import type { Empleado } from '../types.js';
import { combinar, type SaldoDeEmpleado } from './saldos.js';

// ARQ-612 — la baja de un empleado, sacada de service.ts tal cual: registrarla
// tras comprobar que nada la contradice, deshacerla y la lista de retirados con
// el saldo congelado a su fecha de retiro. service.ts lo reexporta (lo vigila
// barril.test.ts).

/**
 * Registra la baja de un empleado: fija `fecha_retiro` tras comprobar que
 * nada la contradice. Solo admin.
 *
 * **Bloquea en vez de arreglar por su cuenta.** El saldo que `hoyCongelado`
 * calcula a partir de `fechaRetiro` es literalmente lo que se le paga a esa
 * persona en la liquidación, así que este servicio no puede tomar decisiones
 * sobre ausencias de otro: no cierra solicitudes ajenas ni recorta días para
 * que la fecha "encaje". Si algo choca, se lo dice al admin con el detalle
 * necesario para que lo resuelva a mano (rechazando o retirando la
 * solicitud, cambiando de jefe a quien la tiene a cargo) y vuelva a intentar
 * el retiro. El único que sí escribe es el barrido (`aplicarRetirosVencidos`),
 * que solo APAGA el acceso cuando la fecha ya fijada vence.
 *
 * Los días POSTERIORES a la fecha bloquean; los ANTERIORES no, y no es un
 * descuido: son legítimos. Quien se va el 30 de septiembre puede tener unas
 * vacaciones pendientes de firma para la semana anterior a esa fecha, y su
 * jefe tiene que poder firmarlas con normalidad — la bandeja de aprobación no
 * filtra por `activo`, así que nada se lo impide, y bloquear el retiro por
 * ellas sería inventar un problema donde no lo hay. La frontera exacta entre
 * "antes" y "después" la traza `repo.diasPosterioresA`.
 *
 * **Los dos bloqueos —días posteriores y personas a cargo— se informan
 * JUNTOS, en un solo 409, y nunca el primero que salte.** Cortocircuitar
 * dejaría a quien se topa con los dos enterarse de uno, arreglarlo, reintentar
 * y toparse con el otro. Y esa población no es rara: es el jefe que se va, que
 * tiene equipo por definición y suele tener vacaciones pendientes. Los dos
 * remedios además los ejecutan personas y pantallas distintas —rechazar o
 * retirar la solicitud vs. reasignar el equipo en Organigrama—, así que
 * descubrirlos de uno en uno puede costar días.
 *
 * ⚠️ No es transaccional: entre las dos comprobaciones y `fijarRetiro` puede
 * colarse una solicitud nueva o un cambio de jefe (dos `SELECT` sin `FOR
 * UPDATE`, ni las dos ni la escritura comparten conexión). Se acepta a
 * propósito, mismo criterio que `solapeDe`: el daño es leve porque aquí no se
 * congela nada en columnas —`hoyCongelado` deriva el saldo en cada cálculo, no
 * en el instante del retiro—, así que colarse solo caduca la comprobación de
 * este momento, no corrompe ningún dato, y la baja se puede deshacer con
 * `reactivarEmpleado` si hiciera falta.
 */
export async function retirarEmpleado(
  db: Pool,
  empleadoId: string,
  body: unknown,
  adminEmail: string,
): Promise<Empleado> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const fecha = typeof b.fechaRetiro === 'string' ? b.fechaRetiro.trim() : '';
  // `esFechaValida` y no un parseo laxo: 'YYYY-MM-DD' es el formato con el que
  // esta fecha se compara lexicográficamente contra otras (el barrido, el
  // congelado). Una '30/09/2026' compilaría y rompería esas comparaciones en
  // silencio, que es el gotcha que documenta `sumarDesdeElCorte`.
  if (!esFechaValida(fecha)) throw new AusenciaError('fecha_retiro_invalida', 400, 'fechaRetiro');

  const empleado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  const posteriores = await repo.diasPosterioresA(db, empleadoId, fecha);
  const aCargo = await repo.personasACargoDe(db, empleado.correo);
  if (posteriores.length > 0 || aCargo.length > 0) {
    // Los DOS de una vez, y no el primero que salte: quien se topa con ambos es
    // el jefe que se va —tiene equipo por definicion y suele tener vacaciones
    // pendientes—, y los dos remedios se ejecutan en pantallas distintas. Decirle
    // solo uno le hace descubrir el otro despues de haberlo arreglado.
    throw new AusenciaError('retiro_bloqueado', 409, 'fechaRetiro', {
      solicitudes: posteriores,
      personas: aCargo,
    });
  }

  if (!(await repo.fijarRetiro(db, empleadoId, fecha, adminEmail))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  // Se relee en vez de construir la respuesta a mano: `retirado_at` lo pone la
  // BD con NOW(), así que el único sitio donde está el valor real es la fila.
  const actualizado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Deshace una baja y devuelve la ficha a la lista de activos. Solo admin.
 *
 * `limpiarRetiro` borra `retirado_por`/`retirado_at` en la propia fila —así
 * es como "deshacer" tiene que funcionar, la ficha vuelve a nacer sin
 * retiro—, y eso deja la reactivación sin ningún rastro: la migración 035
 * documenta esas dos columnas como «la constancia de quién fijó ese número»,
 * y borrarlas sin dejar nada en su lugar convertiría a `reactivarEmpleado` en
 * la única operación de esta funcionalidad que BORRA auditoría en vez de
 * crearla. Por eso la ficha se lee ANTES de limpiar —después ya no queda
 * dónde consultar qué fecha tenía ni quién la había puesto— y se deja un
 * evento estructurado con esos datos, mismo patrón que
 * `ausencias_vacaciones_sin_saldo_configurado` más arriba.
 */
export async function reactivarEmpleado(db: Pool, empleadoId: string, adminEmail: string): Promise<Empleado> {
  const antes = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!antes) throw new AusenciaError('empleado_no_encontrado', 404);

  console.log(
    JSON.stringify({
      event: 'ausencias_baja_deshecha',
      timestamp: new Date().toISOString(),
      empleadoId,
      correo: antes.correo,
      fechaRetiroQueTenia: antes.fechaRetiro,
      retiradoPor: antes.retiradoPor,
      deshechoPor: adminEmail,
    }),
  );

  if (!(await repo.limpiarRetiro(db, empleadoId))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  const actualizado = await repo.empleadoPorIdIncluyendoInactivos(db, empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/** Una ficha retirada, con lo que hace falta para liquidarla. */
export interface Retirado extends SaldoDeEmpleado {
  /** El último día que trabajó. `null` en las fichas apagadas a mano. */
  fechaRetiro: string | null;
  retiradoPor: string | null;
  /** Mientras sea > 0, el saldo de arriba todavía puede moverse. */
  solicitudesVivas: number;
  /**
   * True cuando la fecha de retiro es ANTERIOR al corte del saldo.
   * Aritméticamente da un devengo de cero y no revienta, pero casi siempre
   * significa que alguien se equivocó de año al teclear. Se avisa, no se
   * bloquea: puede ser legítimo, y no es esta pantalla quien debe decidirlo.
   */
  retiroAntesDelCorte: boolean;
}

/**
 * Las fichas retiradas con su saldo ya congelado. Solo admin (lo exige el router).
 *
 * Es la vista de liquidación: el `disponible` de cada fila es el número que se
 * le paga a esa persona. Por eso viaja acompañado de la constancia de quién
 * registró la baja y del recuento de solicitudes vivas — un número sin esas dos
 * cosas al lado se lee como definitivo cuando puede no serlo.
 */
export async function listaDeRetirados(db: Pool): Promise<Retirado[]> {
  const fichas = await repo.retiradosConSaldo(db);
  if (fichas.length === 0) return [];
  const ids = fichas.map((f) => f.empleadoId);
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, ids);
  const vivas = await repo.solicitudesVivasDe(db, ids);
  // `combinar` ya congela ficha a ficha vía `hoyCongelado`: se le pasa el mismo
  // `hoy` a todas y cada una decide el suyo. No hay que congelar nada aquí.
  const conSaldo = combinar(fichas, ausencias, hoyEnColombia());
  // Por `empleadoId` y no por posición: que `combinar` devuelva la lista en el
  // mismo orden que la recibe es cierto hoy, pero es una invariante que no
  // comprueba nadie, y equivocarse de fila aquí le pondría a alguien la fecha
  // de retiro de otro justo en la pantalla desde la que se paga.
  const porId = new Map(fichas.map((f) => [f.empleadoId, f]));
  return conSaldo.map((s) => {
    const ficha = porId.get(s.empleadoId)!;
    return {
      ...s,
      fechaRetiro: ficha.fechaRetiro,
      retiradoPor: ficha.retiradoPor,
      solicitudesVivas: vivas.get(s.empleadoId) ?? 0,
      retiroAntesDelCorte:
        ficha.fechaRetiro !== null && s.saldo.configurado && ficha.fechaRetiro < s.saldo.fechaCorte,
    };
  });
}
