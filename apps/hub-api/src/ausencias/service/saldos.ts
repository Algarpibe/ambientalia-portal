import type { Pool } from '@algarpibe/zoho-sync';
import { esFechaValida } from '../dias-habiles.js';
import { AusenciaError } from '../errores.js';
import * as repo from '../repo.js';
import {
  calcularSaldo,
  calcularSaldoCompensatorios,
  hoyCongelado,
  hoyEnColombia,
  type SaldoCompensatorios,
  type SaldoVacaciones,
} from '../saldo.js';
import type { Empleado } from '../types.js';
import type { Sesion } from './sesion.js';

// ARQ-612 — los saldos de vacaciones y compensatorios, sacados de service.ts
// tal cual en dos bloques: la validación del saldo de corte que fija un admin,
// y lo que junta cada ficha con sus ausencias para enseñar las dos bolsas
// (`combinar`), con las consultas que lo usan. El cálculo en sí vive en
// ../saldo.ts, que es pura. `combinar` se exporta porque la usan también el
// panel de KPIs y la lista de retirados. service.ts lo reexporta (lo vigila
// barril.test.ts).

/**
 * Tope del saldo de corte, en valor absoluto. NUMERIC(5,1) admite hasta 9999,9,
 * pero 999 días son 66 años de devengo: por encima es un error de tecleo.
 *
 * Se aplica también hacia abajo: el saldo PUEDE ser negativo —quien ha
 * adelantado vacaciones ha disfrutado más días de los que lleva devengados, y
 * el Excel del que salen los saldos iniciales los trae así— pero -1000 sigue
 * siendo un tecleo.
 */
const MAX_SALDO = 999;

/** Lo que un admin puede fijar. Las dos a null vacía la configuración. */
export interface SaldoAFijar {
  saldoCorte: number | null;
  fechaCorte: string | null;
}

/**
 * Un saldo en texto: signo menos opcional, dígitos y, como mucho, una coma o un
 * punto decimal.
 *
 * Se comprueba la FORMA antes de convertir porque `Number()` es demasiado
 * permisivo para tratarlo como la respuesta a un formulario: acepta espacios
 * en blanco como 0 (`Number('  ') === 0`), hexadecimal (`Number('0x10') ===
 * 16`) y notación científica (`Number('1e2') === 100`). El panel de admin usa
 * `type="text"` —hace falta para admitir la coma decimal, que un
 * `type="number"` rechaza en la mayoría de locales—, así que cualquiera de
 * esas rarezas puede llegar tal cual desde el campo.
 */
const RE_SALDO = /^-?\d{1,3}([.,]\d+)?$/;

/** Las dos bolsas que puede traer el body del panel de admin. */
export interface SaldosAFijar {
  vacaciones: SaldoAFijar;
  /**
   * Null cuando el body NO traía la pareja de compensatorios: entonces la bolsa
   * no se toca. Es distinto de traerla con los dos campos vacíos, que sí la vacía.
   */
  compensatorios: SaldoAFijar | null;
}

/**
 * Valida una pareja saldo+fecha. Exige las dos claves, o ninguna cosa a medias.
 *
 * El operador `in` mira la CLAVE, no el valor: así se distingue «vaciar a
 * propósito» (las dos claves presentes y en null) de «el body no trae las
 * claves que se esperan» (un `{}`, o un renombrado en el front como
 * `{saldo: 20, fecha: '...'}`). Mirando solo el valor, los dos casos
 * colapsarían en el mismo `undefined` y un renombrado borraría en silencio
 * un saldo ya configurado.
 */
function validarPareja(b: Record<string, unknown>, claveSaldo: string, claveFecha: string): SaldoAFijar {
  const saldoPresente = claveSaldo in b;
  const fechaPresente = claveFecha in b;
  if (!saldoPresente || !fechaPresente) {
    throw new AusenciaError('saldo_incompleto', 400, !saldoPresente ? claveSaldo : claveFecha);
  }

  const valorSaldo = b[claveSaldo];
  const valorFecha = b[claveFecha];
  const saldoVacio = valorSaldo === null || valorSaldo === '';
  const fechaVacia = valorFecha === null || valorFecha === '';

  // Vaciar la configuración es legítimo: devuelve al empleado a «sin configurar».
  if (saldoVacio && fechaVacia) return { saldoCorte: null, fechaCorte: null };
  // A medias, no: es justo lo que impide el CHECK de la BD, y aquí el mensaje
  // se puede explicar. El campo señalado es el que FALTA, no el que sí llegó
  // (si no, la interfaz resaltaría el campo que el admin rellenó bien).
  if (saldoVacio || fechaVacia) {
    throw new AusenciaError('saldo_incompleto', 400, saldoVacio ? claveSaldo : claveFecha);
  }

  // Se exige el tipo ANTES de convertir: un array no debe llegar siquiera a
  // `String()` (que lo aplanaría a su primer elemento, o a "", y las dos
  // formas parecen un número válido para lo que sigue).
  if (typeof valorSaldo !== 'number' && typeof valorSaldo !== 'string') {
    throw new AusenciaError('saldo_invalido', 400, claveSaldo);
  }
  let saldo: number;
  if (typeof valorSaldo === 'number') {
    saldo = valorSaldo;
  } else {
    if (!RE_SALDO.test(valorSaldo)) throw new AusenciaError('saldo_invalido', 400, claveSaldo);
    saldo = Number(valorSaldo.replace(',', '.'));
  }
  if (!Number.isFinite(saldo) || Math.abs(saldo) > MAX_SALDO) {
    throw new AusenciaError('saldo_invalido', 400, claveSaldo);
  }

  // Mismo defecto de rebote que en el saldo: un array como `['2026-08-12']`
  // pasaría igual por `String()`, así que se exige el tipo antes de mirar el
  // contenido. `esFechaValida` descarta de paso los valores mágicos de
  // Postgres (`'infinity'`, `'today'`), que la columna DATE aceptaría sin
  // rechistar.
  if (typeof valorFecha !== 'string') throw new AusenciaError('fecha_invalida', 400, claveFecha);
  if (!esFechaValida(valorFecha)) throw new AusenciaError('fecha_invalida', 400, claveFecha);

  return { saldoCorte: Math.round(saldo * 10) / 10, fechaCorte: valorFecha };
}

/**
 * Valida a mano lo que llega del cliente; en este repo no hay zod.
 *
 * ⚠️ Las dos parejas NO se tratan igual, y la asimetría es deliberada. La de
 * vacaciones se EXIGE: lleva ahí desde el principio, así que si falta solo puede
 * ser un front renombrado, y dar eso por bueno borraría un saldo configurado. La
 * de compensatorios, en cambio, puede faltar por una razón legítima —un bundle
 * del portal anterior a esta función, que no la conoce— y tratar su ausencia
 * como «vacíala» borraría la bolsa de todo aquel a quien un admin le corrigiera
 * las vacaciones durante la ventana de despliegue. Ausente = no se toca.
 *
 * Basta con que asome UNA de las dos claves para exigir la otra: así un front que
 * sí las conoce pero manda media pareja sigue recibiendo su 400.
 */
export function validarSaldo(body: unknown): SaldosAFijar {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const traeCompensatorios = 'compensatoriosSaldoCorte' in b || 'compensatoriosFechaCorte' in b;
  return {
    vacaciones: validarPareja(b, 'saldoCorte', 'fechaCorte'),
    compensatorios: traeCompensatorios
      ? validarPareja(b, 'compensatoriosSaldoCorte', 'compensatoriosFechaCorte')
      : null,
  };
}

/** Las dos bolsas de un empleado, listas para enseñar. */
export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
}

/**
 * Reetiqueta con el correo Y con la bolsa el error de una fila corrupta.
 *
 * El cálculo lanza si alguna fecha viniera mal. Esto recorre a toda la plantilla,
 * así que sin el correo una sola fila mala dejaría la lista del admin a oscuras
 * sin decir de quién es el problema. Y ahora hay dos bolsas con dos fechas de
 * corte distintas: sin decir CUÁL de las dos envenenó la fila, el admin sabría a
 * quién mirar pero no qué columna arreglar.
 */
function conEtiqueta<T>(correo: string, bolsa: string, calcular: () => T): T {
  try {
    return calcular();
  } catch (err) {
    throw new Error(`saldo de ${bolsa} de ${correo}: ${(err as Error).message}`);
  }
}

/** Calcula las dos bolsas de cada empleado a partir de sus ausencias. */
export function combinar(
  empleados: repo.EmpleadoConSaldo[],
  ausencias: repo.AusenciaDeEmpleado[],
  hoy: string,
): SaldoDeEmpleado[] {
  return empleados.map((e) => {
    // Una sola pasada por empleado: las dos bolsas miran la misma lista y cada
    // una descarta los tipos de la otra.
    const suyas = ausencias.filter((a) => a.empleadoId === e.empleadoId);
    // El «hoy» de ESTA ficha, no el de la pantalla: un retirado dejó de devengar
    // en su último día. Va aquí y no dentro de `calcularSaldo` porque el corte
    // es una propiedad del empleado, no del cálculo.
    const suHoy = hoyCongelado(e.fechaRetiro, hoy);
    const configVacaciones =
      e.saldoCorte !== null && e.fechaCorte !== null
        ? { saldoCorte: e.saldoCorte, fechaCorte: e.fechaCorte }
        : null;
    const configCompensatorios =
      e.compensatoriosSaldoCorte !== null && e.compensatoriosFechaCorte !== null
        ? { saldoCorte: e.compensatoriosSaldoCorte, fechaCorte: e.compensatoriosFechaCorte }
        : null;
    return {
      empleadoId: e.empleadoId,
      nombreCompleto: e.nombreCompleto,
      correo: e.correo,
      saldo: conEtiqueta(e.correo, 'vacaciones', () => calcularSaldo(configVacaciones, suyas, suHoy)),
      compensatorios: conEtiqueta(e.correo, 'compensatorios', () =>
        calcularSaldoCompensatorios(configCompensatorios, suyas, suHoy),
      ),
    };
  });
}

/**
 * Los saldos que esta sesión puede ver: todos si es admin, y solo los de la
 * gente que aprueba si no lo es.
 */
export async function saldosVisibles(db: Pool, sesion: Sesion): Promise<SaldoDeEmpleado[]> {
  // El `null` explícito es obligatorio: sin él, TypeScript ya no compila (ver
  // el porqué en el JSDoc de `empleadosConSaldo`).
  const empleados = await repo.empleadosConSaldo(db, sesion.esAdmin ? null : sesion.email, null);
  // Para quien no es admin, no aprobar a nadie es un 403. Para un admin, una
  // lista vacía es solo una lista vacía: la BD sin empleados todavía.
  if (!sesion.esAdmin && empleados.length === 0) throw new AusenciaError('no_es_aprobador', 403);
  const ausencias = await repo.ausenciasQueTocanElSaldo(
    db,
    empleados.map((e) => e.empleadoId),
  );
  return combinar(empleados, ausencias, hoyEnColombia());
}

/** Las dos bolsas de quien pregunta. Viajan juntas: la app siempre quiere las dos. */
export interface SaldosDeSesion {
  saldo: SaldoVacaciones;
  compensatorios: SaldoCompensatorios;
}

/**
 * Las bolsas del usuario logueado. Van dentro del contexto que carga la app.
 *
 * No comprueba que `empleado` sea el de la sesión que llama —no tiene con qué:
 * solo recibe la ficha, no la sesión—, así que esa garantía de privacidad vive
 * ENTERA en el llamante (que debe sacarla de `empleadoDeSesion`, nunca de un
 * id que decida el cliente). Pasarle la ficha de otro devuelve el saldo de ese
 * otro sin rechistar.
 */
export async function saldosDeSesion(db: repo.Consultable, empleado: Empleado): Promise<SaldosDeSesion> {
  const hoy = hoyEnColombia();
  const [fila] = await repo.empleadosConSaldo(db, null, empleado.id);
  // Sin fila —la ficha se desactivó después de que la sesión ya estuviera
  // abierta, por ejemplo— se devuelve un saldo en blanco en vez de lanzar:
  // esto viaja dentro del contexto que carga la app entera, y un 500 aquí
  // tumbaría toda la sesión por un dato que ni siquiera es crítico para poder
  // navegar.
  if (!fila) {
    return { saldo: calcularSaldo(null, [], hoy), compensatorios: calcularSaldoCompensatorios(null, [], hoy) };
  }
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, [empleado.id]);
  const fusionada = combinar([fila], ausencias, hoy)[0];
  return { saldo: fusionada.saldo, compensatorios: fusionada.compensatorios };
}

/** Fija los puntos de corte de un empleado. Solo admin (lo exige el router). */
export async function fijarSaldo(db: Pool, empleadoId: string, body: unknown): Promise<SaldoDeEmpleado> {
  const { vacaciones, compensatorios } = validarSaldo(body);
  const existe = await repo.fijarSaldo(db, empleadoId, vacaciones, compensatorios);
  if (!existe) throw new AusenciaError('empleado_no_encontrado', 404);

  const empleados = await repo.empleadosConSaldo(db, null, empleadoId);
  // El 404 de arriba certifica que la fila existía y estaba activa en el
  // instante del UPDATE, pero este SELECT es una consulta aparte, sin
  // transacción que las una: entre una y otra, una desactivación concurrente
  // de ese mismo empleado dejaría `empleados` vacío. Sin esta guarda,
  // `combinar([], ...)[0]` sería `undefined` y el 404 correcto degradaría en
  // un 500 al intentar leer `.saldo` aguas arriba.
  if (empleados.length === 0) throw new AusenciaError('empleado_no_encontrado', 404);
  const ausencias = await repo.ausenciasQueTocanElSaldo(db, [empleadoId]);
  return combinar(empleados, ausencias, hoyEnColombia())[0];
}
