import type { Pool } from '@algarpibe/zoho-sync';
import { avisarN8n } from './avisar.js';
import {
  diasDelMes,
  esMesValido,
  marcasDelMes,
  rangoDelMes,
  type DiaCalendario,
  type MarcaCalendario,
} from './calendario.js';
import { contarDiasHabiles, esFechaValida, MAX_DIAS_RANGO } from './dias-habiles.js';
import { resolverEmpleado, validarFilasHistorico } from './historico.js';
import { aprobadoresDe } from './jerarquia.js';
import { construirPayload, eventosDeAlta } from './notificaciones.js';
import * as repo from './repo.js';
import { calcularSaldo, hoyEnColombia, type SaldoVacaciones } from './saldo.js';
import {
  ETIQUETA_TIPO,
  TIPOS,
  requiereAprobacion,
  transicionAlDecidir,
  type Empleado,
  type FilaEmpleado,
  type NuevaSolicitud,
  type Solicitud,
  type TipoSolicitud,
} from './types.js';

/** Error de dominio con su código HTTP, como `UserError` en users.service.ts. */
export class AusenciaError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly field?: string,
  ) {
    super(code);
    this.name = 'AusenciaError';
  }
}

/** Tope del PDF adjunto. Una incapacidad escaneada rara vez pasa de 2-3 MB. */
export const MAX_ADJUNTO_BYTES = 8 * 1024 * 1024;
const MAX_COMENTARIOS = 2000;
const MAX_MOTIVO = 1000;
const MAX_NOMBRE_ARCHIVO = 200;

// El contenido de los correos y los destinos de Google viven en
// notificaciones.ts y config.ts. Aquí solo se decide QUÉ eventos se encolan.

// ── Validación ─────────────────────────────────────────────────────────────

function esTipo(v: unknown): v is TipoSolicitud {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v);
}

/**
 * Valida y normaliza lo que llega del cliente. Nada de `empleadoId` ni de
 * `diasHabiles`: el primero sale de la sesión y el segundo se calcula aquí, así
 * que ni suplantar a otro ni inflar los días es posible desde el navegador.
 */
export function validarNuevaSolicitud(body: unknown): NuevaSolicitud {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!esTipo(b.tipo)) throw new AusenciaError('tipo_invalido', 400, 'tipo');
  const tipo = b.tipo;

  const fechaInicio = String(b.fechaInicio ?? '');
  const fechaFin = String(b.fechaFin ?? '');
  if (!esFechaValida(fechaInicio)) throw new AusenciaError('fecha_invalida', 400, 'fechaInicio');
  if (!esFechaValida(fechaFin)) throw new AusenciaError('fecha_invalida', 400, 'fechaFin');
  if (fechaInicio > fechaFin) throw new AusenciaError('rango_invertido', 400, 'fechaFin');

  const diasNaturales = (Date.parse(`${fechaFin}T00:00:00Z`) - Date.parse(`${fechaInicio}T00:00:00Z`)) / 86_400_000 + 1;
  if (diasNaturales > MAX_DIAS_RANGO) throw new AusenciaError('rango_demasiado_largo', 400, 'fechaFin');

  const comentarios = typeof b.comentarios === 'string' ? b.comentarios.trim() : '';
  if (comentarios.length > MAX_COMENTARIOS) throw new AusenciaError('comentarios_demasiado_largos', 400, 'comentarios');

  const adjunto = validarAdjunto(b.adjunto);
  // La incapacidad es el único tipo que no se aprueba; el soporte médico es lo
  // único que la respalda, así que sin él no se registra.
  if (tipo === 'incapacidad' && !adjunto) throw new AusenciaError('adjunto_requerido', 400, 'adjunto');

  return { tipo, fechaInicio, fechaFin, comentarios: comentarios || undefined, adjunto };
}

function validarAdjunto(v: unknown): NuevaSolicitud['adjunto'] {
  if (v === undefined || v === null) return undefined;
  const a = v as Record<string, unknown>;
  const nombreArchivo = String(a.nombreArchivo ?? '').trim();
  const mime = String(a.mime ?? '');
  const contenidoBase64 = String(a.contenidoBase64 ?? '');

  if (!nombreArchivo || nombreArchivo.length > MAX_NOMBRE_ARCHIVO) {
    throw new AusenciaError('nombre_archivo_invalido', 400, 'adjunto');
  }
  if (mime !== 'application/pdf') throw new AusenciaError('adjunto_no_es_pdf', 400, 'adjunto');
  if (!contenidoBase64) throw new AusenciaError('adjunto_vacio', 400, 'adjunto');
  // Se estima el tamaño ANTES de decodificar: no tiene sentido materializar en
  // memoria un buffer de 50 MB solo para descubrir que sobra.
  if (Math.floor((contenidoBase64.length * 3) / 4) > MAX_ADJUNTO_BYTES) {
    throw new AusenciaError('adjunto_demasiado_grande', 400, 'adjunto');
  }
  return { nombreArchivo, mime, contenidoBase64 };
}

// `normalize('NFD')` separa la tilde de su letra, y el bloque U+0300–U+036F son
// esas marcas sueltas. La clase se construye desde los códigos en vez de
// escribirla como literal: en el fuente serían caracteres invisibles, y
// cualquier reencoding del fichero las rompería sin dejar rastro.
const DIACRITICOS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/**
 * Nombre normalizado del PDF, tal como el flujo de n8n lo dejaba en Drive:
 * `Tipo_Nombre_Apellidos_Fecha_N.pdf`, sin tildes ni espacios. Se mantiene la
 * convención para que las carpetas sigan siendo homogéneas.
 */
export function nombreArchivoNormalizado(
  tipo: TipoSolicitud,
  nombreCompleto: string,
  fechaInicio: string,
  indice = 1,
): string {
  const limpiar = (t: string) =>
    t
      .normalize('NFD')
      .replace(DIACRITICOS, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '');
  const [nombre, ...resto] = nombreCompleto.trim().split(/\s+/);
  const apellidos = resto.join(' ') || 'Apellidos';
  return `${limpiar(ETIQUETA_TIPO[tipo])}_${limpiar(nombre || 'Nombre')}_${limpiar(apellidos)}_${fechaInicio}_${indice}.pdf`;
}

// ── Casos de uso ───────────────────────────────────────────────────────────

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

export async function crearSolicitud(db: Pool, sesion: Sesion, body: unknown): Promise<Solicitud> {
  const datos = validarNuevaSolicitud(body);
  const empleado = await empleadoDeSesion(db, sesion);
  const diasHabiles = contarDiasHabiles(datos.fechaInicio, datos.fechaFin);

  const aprueba = requiereAprobacion(datos.tipo);
  const estado = aprueba ? 'pendiente' : 'registrada';

  // Los dos firmantes se congelan AQUÍ. La fuente de verdad sigue siendo el árbol
  // de `empleados`; esto es una foto, para que un cambio de organigrama a mitad de
  // trámite no mueva una solicitud que ya está en vuelo.
  const firmantes = aprueba
    ? aprobadoresDe(empleado, await repo.enlaceDe(db, empleado.aprobadorCorreo))
    : null;

  const adjunto = datos.adjunto
    ? {
        nombreArchivo: nombreArchivoNormalizado(datos.tipo, empleado.nombreCompleto, datos.fechaInicio),
        mime: datos.adjunto.mime,
        contenido: Buffer.from(datos.adjunto.contenidoBase64, 'base64'),
      }
    : null;

  // El tope real, ya decodificado: la estimación de base64 puede quedarse corta
  // si el cliente mete relleno o saltos de línea.
  if (adjunto && adjunto.contenido.length > MAX_ADJUNTO_BYTES) {
    throw new AusenciaError('adjunto_demasiado_grande', 400, 'adjunto');
  }

  const solicitud = await repo.crearSolicitud(
    db,
    {
      tipo: datos.tipo,
      empleadoId: empleado.id,
      solicitanteEmail: empleado.correo,
      fechaInicio: datos.fechaInicio,
      fechaFin: datos.fechaFin,
      diasHabiles,
      comentarios: datos.comentarios ?? null,
      estado,
      // Una incapacidad no la aprueba nadie: dejar aquí un aprobador la haría
      // aparecer en su bandeja de pendientes.
      aprobadorCorreo: firmantes ? firmantes.primero : null,
      segundoAprobadorCorreo: firmantes ? firmantes.segundo : null,
    },
    adjunto,
    eventosDeAlta(datos.tipo),
    construirPayload,
  );

  // Sin await: el aviso es un atajo para que el correo salga en un segundo en vez
  // de en unos minutos. La solicitud ya está guardada y encolada, así que esto no
  // puede fallar de forma que importe. Ver avisar.ts.
  void avisarN8n();
  return solicitud;
}

export async function misSolicitudes(db: Pool, sesion: Sesion): Promise<Solicitud[]> {
  const empleado = await empleadoDeSesion(db, sesion);
  return repo.solicitudesDeEmpleado(db, empleado.id);
}

export async function pendientesDeAprobar(db: Pool, sesion: Sesion): Promise<Solicitud[]> {
  return repo.solicitudesPendientes(db, sesion.email, sesion.esAdmin);
}

export async function decidir(db: Pool, sesion: Sesion, id: string, body: unknown): Promise<Solicitud> {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.aprueba !== 'boolean') throw new AusenciaError('aprueba_requerido', 400, 'aprueba');
  const motivo = typeof b.motivo === 'string' ? b.motivo.trim() : '';
  if (motivo.length > MAX_MOTIVO) throw new AusenciaError('motivo_demasiado_largo', 400, 'motivo');

  const solicitud = await repo.solicitudPorId(db, id);
  if (!solicitud) throw new AusenciaError('no_encontrada', 404);
  if (!puedeDecidir(sesion, solicitud)) throw new AusenciaError('no_es_su_aprobacion', 403);

  const transicion = transicionAlDecidir(solicitud, b.aprueba);
  // Estado terminal: `puedeDecidir` deja pasar a los dos firmantes precisamente
  // para llegar aquí, porque «ya decidida» describe mejor lo ocurrido que un 403.
  if (!transicion) throw new AusenciaError('ya_decidida', 409);

  const actualizada = await repo.decidirSolicitud(
    db,
    id,
    solicitud.estado,
    transicion,
    b.aprueba ? null : motivo || null,
    sesion.userId,
    construirPayload,
  );
  // El UPDATE lleva `AND estado = <el que se leyó>`: si no devolvió fila es que
  // otro (o un doble clic) se adelantó. Es un conflicto, no un fallo del servidor.
  if (!actualizada) throw new AusenciaError('ya_decidida', 409);

  void avisarN8n();
  return actualizada;
}

/**
 * Quien tiene el TURNO, o un admin (que destraba aprobaciones bloqueadas).
 *
 * ⚠️ Las ramas están separadas por estado a propósito. Escribirlo como un OR de
 * los dos correos —que es la forma más natural— dejaría al segundo aprobador
 * firmar una solicitud que su jefe inmediato todavía no ha visto: la cascada
 * dejaría de existir sin que nada fallara.
 *
 * En estado terminal pasan los dos firmantes, para que el 409 de «ya decidida»
 * gane al 403: es más informativo, y es lo que ya hacía la versión de una firma.
 */
export function puedeDecidir(sesion: Sesion, s: Solicitud): boolean {
  if (sesion.esAdmin) return true;
  const yo = sesion.email.toLowerCase();
  if (s.estado === 'pendiente') return (s.aprobadorCorreo ?? '').toLowerCase() === yo;
  if (s.estado === 'pendiente_2') return (s.segundoAprobadorCorreo ?? '').toLowerCase() === yo;
  return (
    (s.aprobadorCorreo ?? '').toLowerCase() === yo || (s.segundoAprobadorCorreo ?? '').toLowerCase() === yo
  );
}

/** El solicitante y sus dos aprobadores pueden ver el PDF; nadie más (salvo admin). */
export function puedeVerAdjunto(sesion: Sesion, a: repo.AdjuntoCompleto): boolean {
  if (sesion.esAdmin) return true;
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

// ── Importación del histórico de la hoja ───────────────────────────────────

export interface ResumenImportacion {
  /** Filas leídas del Excel. */
  total: number;
  /** De esas, las que se pudieron atribuir a un empleado. */
  resueltas: number;
  importadas: number;
  yaExistian: number;
  /** Nombres que no casan con nadie. Se enseñan, no se adivinan. */
  sinResolver: string[];
  /** Nombres que casan con más de una persona. */
  ambiguos: { nombre: string; candidatos: string[] }[];
}

/**
 * Importa el histórico que solo vivía en la hoja.
 *
 * Con `dryRun` no escribe nada: la UI lo llama primero así para poder enseñar
 * el recuento y los nombres problemáticos antes de tocar la tabla.
 *
 * Importa lo que resuelve y **reporta lo que no**, en vez de abortar entero por
 * un nombre suelto. Reimportar es inocuo (el INSERT se salta lo que ya está),
 * así que corregir el maestro y volver a pasar el fichero es el camino natural.
 */
export async function importarHistorico(db: Pool, body: unknown): Promise<ResumenImportacion> {
  const filas = validarFilasHistorico(body);
  const dryRun = (body as { dryRun?: unknown })?.dryRun === true;
  const empleados = await repo.listarEmpleados(db);

  const resueltas: repo.FilaHistoricoResuelta[] = [];
  const sinResolver = new Set<string>();
  const ambiguos = new Map<string, string[]>();

  for (const f of filas) {
    const r = resolverEmpleado(f.nombre, empleados);
    if (r.ambiguo) {
      ambiguos.set(f.nombre, r.ambiguo.map((e) => e.nombreCompleto));
      continue;
    }
    if (!r.empleado) {
      sinResolver.add(f.nombre);
      continue;
    }
    resueltas.push({
      empleadoId: r.empleado.id,
      tipo: f.tipo,
      fechaInicio: f.fechaInicio,
      fechaFin: f.fechaFin,
      dias: f.dias,
      comentarios: f.comentarios,
      observaciones: f.observaciones,
      // Todas las de la hoja están resueltas: las incapacidades se informan y el
      // resto llegó con «Aprobado? = Sí» (los rechazos nunca se registraron).
      estado: f.tipo === 'incapacidad' ? 'registrada' : 'aprobada',
    });
  }

  const { importadas, yaExistian } = await repo.importarHistorico(db, resueltas, dryRun);

  return {
    total: filas.length,
    resueltas: resueltas.length,
    importadas,
    yaExistian,
    sinResolver: [...sinResolver],
    ambiguos: [...ambiguos].map(([nombre, candidatos]) => ({ nombre, candidatos })),
  };
}

export function validarFilasEmpleados(body: unknown): FilaEmpleado[] {
  const filas = (body as { empleados?: unknown })?.empleados;
  if (!Array.isArray(filas) || filas.length === 0) throw new AusenciaError('empleados_requeridos', 400, 'empleados');
  if (filas.length > 500) throw new AusenciaError('demasiados_empleados', 400, 'empleados');

  return filas.map((f, i) => {
    const r = (f ?? {}) as Record<string, unknown>;
    const nombreCompleto = String(r.nombreCompleto ?? '').trim();
    const correo = String(r.correo ?? '').trim().toLowerCase();
    if (!nombreCompleto) throw new AusenciaError('nombre_requerido', 400, `empleados[${i}].nombreCompleto`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      throw new AusenciaError('correo_invalido', 400, `empleados[${i}].correo`);
    }
    const credencialCruda = r.credencial;
    const credencial =
      credencialCruda === undefined || credencialCruda === null || credencialCruda === ''
        ? null
        : Number(credencialCruda);
    if (credencial !== null && !Number.isInteger(credencial)) {
      throw new AusenciaError('credencial_invalida', 400, `empleados[${i}].credencial`);
    }
    return {
      nombreCompleto,
      correo,
      cargo: typeof r.cargo === 'string' ? r.cargo.trim() : undefined,
      credencial,
      aprobadorCorreo: typeof r.aprobadorCorreo === 'string' ? r.aprobadorCorreo.trim().toLowerCase() : undefined,
    };
  });
}

// ── Saldo de vacaciones ────────────────────────────────────────────────────

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

/** Valida a mano lo que llega del cliente; en este repo no hay zod. */
export function validarSaldo(body: unknown): SaldoAFijar {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  // El operador `in` mira la CLAVE, no el valor: así se distingue «vaciar a
  // propósito» (las dos claves presentes y en null) de «el body no trae las
  // claves que se esperan» (un `{}`, o un renombrado en el front como
  // `{saldo: 20, fecha: '...'}`). Mirando solo el valor, los dos casos
  // colapsarían en el mismo `undefined` y un renombrado borraría en silencio
  // un saldo ya configurado.
  const saldoPresente = 'saldoCorte' in b;
  const fechaPresente = 'fechaCorte' in b;
  if (!saldoPresente || !fechaPresente) {
    throw new AusenciaError('saldo_incompleto', 400, !saldoPresente ? 'saldoCorte' : 'fechaCorte');
  }

  const saldoVacio = b.saldoCorte === null || b.saldoCorte === '';
  const fechaVacia = b.fechaCorte === null || b.fechaCorte === '';

  // Vaciar la configuración es legítimo: devuelve al empleado a «sin configurar».
  if (saldoVacio && fechaVacia) return { saldoCorte: null, fechaCorte: null };
  // A medias, no: es justo lo que impide el CHECK de la BD, y aquí el mensaje
  // se puede explicar. El campo señalado es el que FALTA, no el que sí llegó
  // (si no, la interfaz resaltaría el campo que el admin rellenó bien).
  if (saldoVacio || fechaVacia) {
    throw new AusenciaError('saldo_incompleto', 400, saldoVacio ? 'saldoCorte' : 'fechaCorte');
  }

  // Se exige el tipo ANTES de convertir: un array no debe llegar siquiera a
  // `String()` (que lo aplanaría a su primer elemento, o a "", y las dos
  // formas parecen un número válido para lo que sigue).
  if (typeof b.saldoCorte !== 'number' && typeof b.saldoCorte !== 'string') {
    throw new AusenciaError('saldo_invalido', 400, 'saldoCorte');
  }
  let saldo: number;
  if (typeof b.saldoCorte === 'number') {
    saldo = b.saldoCorte;
  } else {
    if (!RE_SALDO.test(b.saldoCorte)) throw new AusenciaError('saldo_invalido', 400, 'saldoCorte');
    saldo = Number(b.saldoCorte.replace(',', '.'));
  }
  if (!Number.isFinite(saldo) || Math.abs(saldo) > MAX_SALDO) {
    throw new AusenciaError('saldo_invalido', 400, 'saldoCorte');
  }

  // Mismo defecto de rebote que en el saldo: un array como `['2026-08-12']`
  // pasaría igual por `String()`, así que se exige el tipo antes de mirar el
  // contenido. `esFechaValida` descarta de paso los valores mágicos de
  // Postgres (`'infinity'`, `'today'`), que la columna DATE aceptaría sin
  // rechistar.
  if (typeof b.fechaCorte !== 'string') throw new AusenciaError('fecha_invalida', 400, 'fechaCorte');
  if (!esFechaValida(b.fechaCorte)) throw new AusenciaError('fecha_invalida', 400, 'fechaCorte');

  return { saldoCorte: Math.round(saldo * 10) / 10, fechaCorte: b.fechaCorte };
}

/** El saldo de un empleado, listo para enseñar. */
export interface SaldoDeEmpleado {
  empleadoId: string;
  nombreCompleto: string;
  correo: string;
  saldo: SaldoVacaciones;
}

/**
 * Calcula el saldo de cada empleado a partir de sus vacaciones.
 *
 * `calcularSaldo` lanza si alguna fecha viniera corrupta. Se reetiqueta el error
 * con el correo porque esto recorre a toda la plantilla: sin eso, una sola fila
 * mala dejaría la lista del admin a oscuras sin decir de quién es el problema.
 */
function combinar(
  empleados: repo.EmpleadoConSaldo[],
  vacaciones: repo.VacacionDeEmpleado[],
  hoy: string,
): SaldoDeEmpleado[] {
  return empleados.map((e) => {
    const config =
      e.saldoCorte !== null && e.fechaCorte !== null
        ? { saldoCorte: e.saldoCorte, fechaCorte: e.fechaCorte }
        : null;
    try {
      return {
        empleadoId: e.empleadoId,
        nombreCompleto: e.nombreCompleto,
        correo: e.correo,
        saldo: calcularSaldo(config, vacaciones.filter((v) => v.empleadoId === e.empleadoId), hoy),
      };
    } catch (err) {
      throw new Error(`saldo de ${e.correo}: ${(err as Error).message}`);
    }
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
  const vacaciones = await repo.vacacionesDeEmpleados(
    db,
    empleados.map((e) => e.empleadoId),
  );
  return combinar(empleados, vacaciones, hoyEnColombia());
}

/**
 * El saldo del usuario logueado. Va dentro del contexto que carga la app.
 *
 * No comprueba que `empleado` sea el de la sesión que llama —no tiene con qué:
 * solo recibe la ficha, no la sesión—, así que esa garantía de privacidad vive
 * ENTERA en el llamante (que debe sacarla de `empleadoDeSesion`, nunca de un
 * id que decida el cliente). Pasarle la ficha de otro devuelve el saldo de ese
 * otro sin rechistar.
 */
export async function saldoDeSesion(db: Pool, empleado: Empleado): Promise<SaldoVacaciones> {
  const [fila] = await repo.empleadosConSaldo(db, null, empleado.id);
  // Sin fila —la ficha se desactivó después de que la sesión ya estuviera
  // abierta, por ejemplo— se devuelve un saldo en blanco en vez de lanzar:
  // esto viaja dentro del contexto que carga la app entera, y un 500 aquí
  // tumbaría toda la sesión por un dato que ni siquiera es crítico para poder
  // navegar.
  if (!fila) return calcularSaldo(null, [], hoyEnColombia());
  const vacaciones = await repo.vacacionesDeEmpleados(db, [empleado.id]);
  return combinar([fila], vacaciones, hoyEnColombia())[0].saldo;
}

/** Fija el punto de corte de un empleado. Solo admin (lo exige el router). */
export async function fijarSaldo(db: Pool, empleadoId: string, body: unknown): Promise<SaldoDeEmpleado> {
  const { saldoCorte, fechaCorte } = validarSaldo(body);
  const existe = await repo.fijarSaldo(db, empleadoId, saldoCorte, fechaCorte);
  if (!existe) throw new AusenciaError('empleado_no_encontrado', 404);

  const empleados = await repo.empleadosConSaldo(db, null, empleadoId);
  // El 404 de arriba certifica que la fila existía y estaba activa en el
  // instante del UPDATE, pero este SELECT es una consulta aparte, sin
  // transacción que las una: entre una y otra, una desactivación concurrente
  // de ese mismo empleado dejaría `empleados` vacío. Sin esta guarda,
  // `combinar([], ...)[0]` sería `undefined` y el 404 correcto degradaría en
  // un 500 al intentar leer `.saldo` aguas arriba.
  if (empleados.length === 0) throw new AusenciaError('empleado_no_encontrado', 404);
  const vacaciones = await repo.vacacionesDeEmpleados(db, [empleadoId]);
  return combinar(empleados, vacaciones, hoyEnColombia())[0];
}

// ── Calendario ─────────────────────────────────────────────────────────────

export interface CalendarioDelMes {
  empleados: repo.EmpleadoActivo[];
  dias: DiaCalendario[];
  marcas: MarcaCalendario[];
}

/**
 * El calendario de un mes, con las marcas ya expandidas por día.
 *
 * El parámetro es un mes y no un rango libre: acotarlo así impide que una
 * petición pida cinco años de golpe, y la interfaz solo navega mes a mes.
 *
 * No recibe sesión: el calendario lo ve toda la plantilla por igual (incluidas
 * las incapacidades, con su tipo tal cual — ver el router). No hay ningún dato
 * que acotar según quién pregunta, así que pedirla solo invitaría a que un
 * cambio futuro la reintrodujera para filtrar algo que el negocio ya decidió
 * que es público dentro de la empresa.
 */
export async function calendarioDelMes(db: Pool, mes: string): Promise<CalendarioDelMes> {
  if (!esMesValido(mes)) throw new AusenciaError('mes_invalido', 400, 'mes');

  const { desde, hasta } = rangoDelMes(mes);
  const [empleados, ausencias] = await Promise.all([
    repo.empleadosActivos(db),
    repo.ausenciasEntre(db, desde, hasta),
  ]);

  return {
    empleados,
    dias: diasDelMes(mes),
    marcas: marcasDelMes(mes, ausencias),
  };
}
