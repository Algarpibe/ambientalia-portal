import type { Pool } from '@algarpibe/zoho-sync';
import { contarDiasHabiles, esFechaValida, MAX_DIAS_RANGO } from './dias-habiles.js';
import { sumarDias } from './festivos.js';
import * as repo from './repo.js';
import {
  ETIQUETA_TIPO,
  TIPOS,
  requiereAprobacion,
  type Empleado,
  type EventoOutbox,
  type FilaEmpleado,
  type NuevaSolicitud,
  type PayloadEvento,
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

/** Base pública del portal, para el enlace «Ver en el portal» de los correos. */
function urlPortal(): string {
  return (process.env.PORTAL_URL || 'https://portal.ambientalia.cloud').replace(/\/+$/, '');
}

// ── Construcción del payload que ejecuta n8n ───────────────────────────────

/**
 * Todo lo que los nodos de Gmail / Calendar / Drive / Sheets necesitan, ya
 * resuelto aquí. n8n no consulta nada ni decide nada: solo ejecuta. Es la misma
 * división de trabajo que en WO-sales.
 */
export function construirPayload(s: Solicitud): PayloadEvento {
  return {
    tipo: s.tipo,
    tipoEtiqueta: ETIQUETA_TIPO[s.tipo],
    estado: s.estado,
    empleado: { nombre: s.empleadoNombre, correo: s.solicitanteEmail, cargo: s.empleadoCargo },
    aprobadorCorreo: s.aprobadorCorreo,
    fechaInicio: s.fechaInicio,
    fechaFin: s.fechaFin,
    // Google trata el `end` de un evento all-day como EXCLUSIVO: sin este +1 el
    // último día de la ausencia no aparecería en el calendario. El flujo de n8n
    // hacía la misma suma a mano dentro de cada nodo de Calendar.
    fechaFinCalendario: sumarDias(s.fechaFin, 1),
    diasHabiles: s.diasHabiles,
    comentarios: s.comentarios ?? '',
    motivoRechazo: s.motivoRechazo ?? '',
    // La columna «Aprobado?» de la hoja de Google guarda literalmente Sí/No.
    aprobado: s.estado === 'aprobada' ? 'Sí' : s.estado === 'rechazada' ? 'No' : '',
    adjunto: s.adjunto ? { id: s.adjunto.id, nombreArchivo: s.adjunto.nombreArchivo } : null,
    urlPortal: `${urlPortal()}/ausencias`,
  };
}

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

/** El empleado del usuario logueado, o un 403 explicando que falta darlo de alta. */
export async function empleadoDeSesion(db: Pool, sesion: Sesion): Promise<Empleado> {
  const empleado = await repo.empleadoDeUsuario(db, sesion.userId, sesion.email);
  if (!empleado) throw new AusenciaError('empleado_no_registrado', 403);
  return empleado;
}

export async function crearSolicitud(db: Pool, sesion: Sesion, body: unknown): Promise<Solicitud> {
  const datos = validarNuevaSolicitud(body);
  const empleado = await empleadoDeSesion(db, sesion);
  const diasHabiles = contarDiasHabiles(datos.fechaInicio, datos.fechaFin);

  const aprueba = requiereAprobacion(datos.tipo);
  const estado = aprueba ? 'pendiente' : 'registrada';
  const evento: EventoOutbox = aprueba ? 'creada' : 'registrada';

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

  return repo.crearSolicitud(
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
      aprobadorCorreo: aprueba ? empleado.aprobadorCorreo : null,
    },
    adjunto,
    evento,
    construirPayload,
  );
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

  const actualizada = await repo.decidirSolicitud(
    db,
    id,
    b.aprueba,
    motivo || null,
    sesion.userId,
    construirPayload,
  );
  // El UPDATE lleva `AND estado = 'pendiente'`: si no devolvió fila es que otro
  // (o un doble clic) ya la decidió. Es un conflicto, no un fallo del servidor.
  if (!actualizada) throw new AusenciaError('ya_decidida', 409);
  return actualizada;
}

/** Quien la tiene asignada, o un admin (que destraba aprobaciones bloqueadas). */
export function puedeDecidir(sesion: Sesion, s: Solicitud): boolean {
  if (sesion.esAdmin) return true;
  return (s.aprobadorCorreo ?? '').toLowerCase() === sesion.email.toLowerCase();
}

/** El solicitante y su aprobador pueden ver el PDF; nadie más (salvo admin). */
export function puedeVerAdjunto(sesion: Sesion, a: repo.AdjuntoCompleto): boolean {
  if (sesion.esAdmin) return true;
  const yo = sesion.email.toLowerCase();
  return a.solicitanteEmail.toLowerCase() === yo || (a.aprobadorCorreo ?? '').toLowerCase() === yo;
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
