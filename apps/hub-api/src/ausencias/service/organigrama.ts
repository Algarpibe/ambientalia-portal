import type { Pool } from '@algarpibe/zoho-sync';
import { APROBADOR_POR_DEFECTO, COPIA_POR_DEFECTO } from '../config.js';
import { AusenciaError } from '../errores.js';
import { aprobadoresDe, construirIndice, creariaCiclo, detectarCiclos, jefeEfectivo } from '../jerarquia.js';
import * as repo from '../repo.js';
import type { Empleado } from '../types.js';
import type { Sesion } from './sesion.js';

// ARQ-612 — el organigrama visto desde la administración, sacado de service.ts
// tal cual: la lista de empleados con su posición en el árbol y las puertas que
// la cambian (jefe, copia, segunda firma) o que reparten las llaves de la ficha
// (visor, exportador, vista de toda la empresa, KPIs). El árbol en sí —ciclos,
// jefe efectivo, cadena de firmas— lo calcula ../jerarquia.ts, que es pura.
// service.ts lo reexporta (lo vigila barril.test.ts).

/** Un empleado del maestro con su posición en el árbol ya derivada. */
export interface EmpleadoConJefatura extends Empleado {
  /** Quien firmaría en segundo lugar una solicitud suya creada ahora mismo. */
  segundoAprobadorCorreo: string | null;
  /**
   * Quien solo se enteraría del resultado, si su ficha no exige segunda firma.
   * Excluyente con el de arriba, y por eso van los dos: el panel necesita saber
   * QUIÉN está en el escalón de arriba aunque hoy no firme.
   *
   * No confundir con el `informadoCorreo` de `Solicitud`: aquel se congela en el
   * alta y vive con esa solicitud para siempre; este se recalcula en cada
   * consulta al maestro y cambia en cuanto se mueve el organigrama o se apaga la
   * casilla.
   */
  informadoCorreo: string | null;
  /** Su rama del organigrama forma un círculo. Se avisa, no se bloquea. */
  enCiclo: boolean;
  /**
   * Tiene rol de administrador en el portal.
   *
   * Existe para UNA cosa: que el panel no pinte las tres casillas de permisos
   * —soportes, exporta, empresa— en su fila. El rol ya se las da todas, plegadas
   * dentro de los booleanos del contexto, así que una casilla sin marcar ahí
   * afirmaba lo contrario de lo que pasa de verdad.
   *
   * NO es un permiso ni se guarda en `portal.empleados`: se deriva en cada
   * consulta del rol que tenga esa persona en `portal.users`. Si deja de ser
   * admin, sus casillas vuelven a aparecer con el valor que la columna tuviera
   * guardado — que es justo el que pasaría a aplicarle.
   */
  esAdminDelPortal: boolean;
}

/**
 * El maestro con el árbol resuelto. La derivación se hace AQUÍ y no en el
 * navegador para que la regla viva en un solo sitio: el admin ve exactamente lo
 * que se congelaría en una solicitud nueva, no una aproximación.
 */
export async function empleadosConJefatura(db: Pool): Promise<EmpleadoConJefatura[]> {
  const [empleados, enlaces, admins] = await Promise.all([
    repo.listarEmpleados(db),
    repo.enlacesActivos(db),
    repo.correosDeAdmin(db),
  ]);
  const porCorreo = new Map(enlaces.map((e) => [e.correo, e]));
  const enCiclo = new Set(detectarCiclos(construirIndice(enlaces)).flat());

  return empleados.map((e) => {
    // Por `jefeEfectivo` también, y no solo el alta: si no, el panel enseñaría a
    // la raíz del organigrama que se aprueba a sí misma mientras el alta la manda
    // a otro sitio. La derivación tiene que decir lo que de verdad va a pasar.
    const jefe = jefeEfectivo(e);
    const arriba = aprobadoresDe({ ...e, aprobadorCorreo: jefe }, porCorreo.get(jefe) ?? null);
    return {
      ...e,
      segundoAprobadorCorreo: arriba.segundo,
      informadoCorreo: arriba.informado,
      enCiclo: enCiclo.has(e.correo.toLowerCase()),
      // En minúsculas por los dos lados: el Set ya viene con `lower()` del SQL,
      // y el correo de la ficha lo escribe la hoja de Google sin garantía de
      // caja. Comparar en crudo dejaría a un admin con el correo en mayúsculas
      // fuera del conjunto y con sus tres casillas puestas otra vez — un fallo
      // que no rompe nada y que solo se nota mirando la fila de esa persona.
      esAdminDelPortal: admins.has(e.correo.toLowerCase()),
    };
  });
}

/**
 * Cambia el jefe inmediato de alguien.
 *
 * Autoasignarse es legítimo: así se declara la raíz del organigrama. Un ciclo se
 * rechaza al escribir (409), pero uno que YA esté en la base de datos no bloquea
 * la edición: si lo hiciera, sería imposible deshacerlo desde el panel.
 */
export async function fijarJefe(db: Pool, empleadoId: string, body: unknown): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.aprobadorCorreo !== 'string') throw new AusenciaError('jefe_requerido', 400, 'aprobadorCorreo');
  const jefe = b.aprobadorCorreo.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(jefe)) throw new AusenciaError('correo_invalido', 400, 'aprobadorCorreo');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  const enlaces = await repo.enlacesActivos(db);
  const conocido = enlaces.some((e) => e.correo === jefe);
  // El buzón por defecto se acepta aunque no tenga ficha de empleado: es de quien
  // cuelga toda la plantilla hoy, y rechazarlo dejaría el organigrama sin raíz.
  if (!conocido && jefe !== APROBADOR_POR_DEFECTO.toLowerCase()) {
    throw new AusenciaError('jefe_no_encontrado', 400, 'aprobadorCorreo');
  }
  if (creariaCiclo(construirIndice(enlaces), empleado.correo, jefe)) {
    throw new AusenciaError('ciclo_jerarquia', 409, 'aprobadorCorreo');
  }

  if (!(await repo.fijarJefe(db, empleadoId, jefe))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Fija a quién se pone en copia de los correos de alguien. `null` = a nadie.
 *
 * Se valida contra los empleados ACTIVOS, no solo el formato del correo: el
 * desplegable del panel solo ofrece personas de la plantilla, y aceptar aquí
 * cualquier cosa dejaría entrar erratas que mandarían los avisos al vacío sin
 * que nadie se enterara. No hay comprobación de ciclos, a diferencia del jefe:
 * esto no es un árbol y estar en copia no da ningún permiso.
 */
export async function fijarCopia(db: Pool, empleadoId: string, body: unknown): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const bruto = b.copiaCorreo;
  if (bruto !== null && typeof bruto !== 'string') {
    throw new AusenciaError('copia_invalida', 400, 'copiaCorreo');
  }

  const copia = typeof bruto === 'string' && bruto.trim() ? bruto.trim().toLowerCase() : null;
  if (copia !== null) {
    const enlaces = await repo.enlacesActivos(db);
    // El buzón por defecto se acepta aunque no tenga ficha activa, igual que
    // `APROBADOR_POR_DEFECTO` en `fijarJefe`: es el valor con el que la migración
    // 021 sembró toda la plantilla, y rechazarlo lo dejaría irreponible desde el
    // panel en cuanto su ficha se desactivara.
    if (!enlaces.some((e) => e.correo === copia) && copia !== COPIA_POR_DEFECTO.toLowerCase()) {
      throw new AusenciaError('copia_no_encontrada', 400, 'copiaCorreo');
    }
  }

  if (!(await repo.fijarCopia(db, empleadoId, copia))) throw new AusenciaError('empleado_no_encontrado', 404);

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/** El tope de la columna: `portal.empleados.cargo VARCHAR(255)`. */
const CARGO_MAX = 255;

// U+0000–U+001F y U+007F. El NUL es el que de verdad rompe: PostgreSQL no lo
// admite en una columna de texto y la ruta contestaría un 500. El resto
// (tabulador, salto de línea…) no tiene sitio en un cargo de una sola línea, y
// descolocaría la firma de los correos, que lo pone en su propia línea.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;

/**
 * Lo que de verdad se guarda como cargo a partir del cuerpo de la petición.
 *
 * `null`, el texto vacío y el texto de solo espacios significan lo mismo: «sin
 * cargo», que la pantalla pinta como «—». Cualquier otro tipo, incluida la clave
 * ausente, es un 400: se exige, no se interpreta.
 *
 * La longitud se cuenta por puntos de código (`[...cargo].length`) y no con
 * `.length`, porque así cuenta `VARCHAR(255)`: un emoji es un carácter para
 * PostgreSQL y dos unidades UTF-16 para JavaScript.
 */
export function normalizarCargo(bruto: unknown): string | null {
  if (bruto === null) return null;
  if (typeof bruto !== 'string') throw new AusenciaError('cargo_invalido', 400, 'cargo');
  const cargo = bruto.trim();
  if (!cargo) return null;
  if (CONTROL.test(cargo) || [...cargo].length > CARGO_MAX) {
    throw new AusenciaError('cargo_invalido', 400, 'cargo');
  }
  return cargo;
}

/**
 * Enciende o apaga la segunda firma de alguien.
 *
 * Sin registro de auditoría, al contrario que `fijarVisor`: esto no da acceso a
 * ningún dato personal, así que se queda al nivel del jefe y de la copia. Y sin
 * comprobación de ciclos, al contrario que `fijarJefe`: no se toca ninguna arista
 * del árbol, solo si el escalón de arriba firma o se limita a enterarse.
 *
 * Las solicitudes ya en vuelo no se mueven: llevan su reparto congelado del alta.
 */
export async function fijarSegundaFirma(
  db: Pool,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  // El tipo se exige, no se interpreta: `'no'` es una cadena con valor de verdad,
  // y aceptarla dejaría encendida una casilla que alguien quiso apagar.
  if (typeof b.requiereSegundaFirma !== 'boolean') {
    throw new AusenciaError('segunda_firma_invalida', 400, 'requiereSegundaFirma');
  }

  if (!(await repo.fijarSegundaFirma(db, empleadoId, b.requiereSegundaFirma))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Da o quita la llave maestra de los adjuntos, dejando constancia.
 *
 * Recibe la `Sesion` —al contrario que `fijarJefe` y `fijarCopia`— porque el
 * registro tiene que decir QUIÉN lo hizo. Es lo que sustituye al historial de
 * git desde que la lista dejó de vivir en `config.ts`.
 *
 * Si el valor no cambia no se escribe nada, ni en la tabla ni en el registro:
 * el botón del panel guarda la fila entera, así que llegaría aquí también
 * cuando lo tocado fuera el jefe o la copia.
 */
export async function fijarVisor(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: unknown,
): Promise<EmpleadoConJefatura> {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.veAdjuntos !== 'boolean') throw new AusenciaError('visor_invalido', 400, 'veAdjuntos');

  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404);

  if (empleado.veAdjuntos !== b.veAdjuntos) {
    // Una sola llamada que da la llave Y la registra en la misma transacción:
    // ver el porqué en `repo.fijarVisorConRegistro`.
    if (
      !(await repo.fijarVisorConRegistro(db, {
        empleadoId,
        veAdjuntos: b.veAdjuntos,
        adminEmail: sesion.email,
        empleadoCorreo: empleado.correo,
      }))
    ) {
      throw new AusenciaError('empleado_no_encontrado', 404);
    }
  }

  const actualizados = await empleadosConJefatura(db);
  const actualizado = actualizados.find((e) => e.id === empleadoId);
  if (!actualizado) throw new AusenciaError('empleado_no_encontrado', 404);
  return actualizado;
}

/**
 * Da o quita el permiso de exportar el registro, dejando constancia.
 *
 * Recibe la `Sesion` por lo mismo que `fijarVisor`: el registro tiene que decir
 * QUIÉN lo concedió. Exportar es sacar de la aplicación las incapacidades y los
 * permisos de la plantilla —con sus motivos— a un fichero que ya nadie
 * controla, así que quién dio esa llave es tan auditable como quién dio la de
 * los adjuntos.
 *
 * Sin el «si no cambia, no se escribe» de `fijarVisor`, y no por descuido: aquel
 * lo necesita porque su botón guarda la fila entera del panel y llegaría aquí
 * también al tocar el jefe o la copia. Este interruptor es propio y no
 * comparte botón con nada más, así que cada llamada ya es una decisión de
 * cambiar el permiso, no un efecto colateral de guardar otra cosa —no hace
 * falta el guard para evitar ruido. `exportaRegistro` ya viaja en `Empleado`
 * (ver `repo.ts`), así que si el panel acabara fusionando este botón con el
 * del resto de la fila, añadir el guard sería tan barato como en `fijarVisor`:
 * una comparación contra la ficha que ya trae `repo.empleadoPorId`, sin
 * consulta extra.
 *
 * Devuelve `{ ok: true }` y nada más —no la ficha, al contrario que `fijarVisor`—
 * porque el permiso no se pinta en la fila del maestro: quien lo cambia solo
 * necesita saber que cuajó. Los caminos que no cuajan salen por `AusenciaError`,
 * así que el `ok` nunca llega a ser `false`; el tipo lo admite para que añadir un
 * «no se pudo» no cambie el contrato del cliente.
 */
export async function fijarExportador(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  // El tipo se exige, no se interpreta, igual que en `fijarSegundaFirma`: `'no'`
  // es una cadena con valor de verdad, y aceptarla concedería el permiso que
  // alguien quiso quitar.
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('exportador_invalido', 400, 'concedido');
  }

  // Una sola llamada que cambia el permiso Y lo registra en la misma
  // transacción: el porqué está en `repo.fijarExportador`.
  if (!(await repo.fijarExportador(db, sesion.email, empleadoId, concedido))) {
    // Ficha inexistente o inactiva. Las dos son un 404 para quien llama, y en
    // las dos el repo se ha guardado de escribir nada en la auditoría.
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

/**
 * Da o quita la vista de toda la empresa —el calendario y el registro—, dejando
 * constancia.
 *
 * Copia la forma de `fijarExportador` punto por punto, y no la de `fijarVisor`:
 * recibe la `Sesion` porque el registro tiene que decir QUIÉN lo concedió, exige
 * el booleano en vez de interpretarlo —`'no'` es una cadena con valor de verdad,
 * y aceptarla concedería el permiso que alguien quiso quitar— y devuelve
 * `{ ok: true }` en vez de la ficha, porque quien lo cambia solo necesita saber
 * que cuajó.
 *
 * Sin el «si no cambia, no se escribe» de `fijarVisor`, por lo mismo que su
 * gemelo de exportación: este interruptor no comparte endpoint con el resto de
 * la fila, así que cada llamada ya es una decisión de cambiar el permiso y no un
 * efecto colateral de guardar otra cosa. El panel llama solo si el valor cambió.
 */
export async function fijarVisorDeEmpresa(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('visor_empresa_invalido', 400, 'concedido');
  }

  // Una sola llamada que cambia el permiso Y lo registra en la misma
  // transacción: el porqué está en `repo.fijarVisorDeEmpresa`.
  if (!(await repo.fijarVisorDeEmpresa(db, sesion.email, empleadoId, concedido))) {
    // Ficha inexistente o inactiva. Las dos son un 404 para quien llama, y en
    // las dos el repo se ha guardado de escribir nada en la auditoría.
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}

/**
 * Da o quita la llave del panel de KPIs (migración 038).
 *
 * Copia exacta de `fijarVisorDeEmpresa` de aquí arriba, y por los mismos
 * motivos: exige el booleano en vez de interpretarlo —`'no'` es una cadena con
 * valor de verdad, y aceptarla concedería el permiso que alguien quiso quitar—,
 * devuelve `{ ok: true }` porque quien lo cambia solo necesita saber que cuajó,
 * y delega en el repo el UPDATE y el registro en una sola transacción.
 *
 * Sirve para dar el panel a quien NO es administrador: a los que lo son se lo
 * da ya el rol, plegado en el contexto igual que las otras tres llaves.
 */
export async function fijarVisorDeKpis(
  db: Pool,
  sesion: Sesion,
  empleadoId: string,
  body: { concedido?: unknown },
): Promise<{ ok: boolean }> {
  const concedido = (body ?? {}).concedido;
  if (typeof concedido !== 'boolean') {
    throw new AusenciaError('visor_kpis_invalido', 400, 'concedido');
  }

  if (!(await repo.fijarVisorDeKpis(db, sesion.email, empleadoId, concedido))) {
    throw new AusenciaError('empleado_no_encontrado', 404);
  }
  return { ok: true };
}
