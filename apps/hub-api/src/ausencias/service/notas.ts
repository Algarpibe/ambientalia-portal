import type { Pool } from '@algarpibe/zoho-sync';
import { esFechaValida } from '../dias-habiles.js';
import { AusenciaError } from '../errores.js';
import * as repo from '../repo.js';
import type { ImagenCompletaDeNota } from '../repo.js';
import {
  CATEGORIAS_NOTA,
  ESTADOS_NOTA,
  MAX_COMENTARIO_NOTA,
  MIMES_IMAGEN_NOTA,
  type CambioNota,
  type CategoriaNota,
  type EstadoNota,
  type ImagenNuevaDeNota,
  type MimeImagenNota,
  type Nota,
  type NuevaNota,
} from '../types.js';
import { MAX_ADJUNTO_BYTES } from './validacion.js';

// Las notas personales del administrador (migración 076): la validación pura y
// la orquestación. service.ts lo reexporta (lo vigila barril.test.ts).
//
// Quién puede llamar a esto lo decide el router (`requireAdmin`); de quién es
// cada nota lo decide el SQL (`autor_email`). Aquí no se repite ninguna de las
// dos: un candado duplicado esconde el día que el otro se rompe.

// MAX_COMENTARIO_NOTA viene de types.ts: es el mismo número que el CHECK de la
// 076, y notas.estatico.test.ts vigila que no se separen.
const MAX_NOMBRE_IMAGEN = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * El formato real de una imagen, leído de sus primeros bytes. `null` si no es
 * ninguno de los tres admitidos.
 *
 * Existe porque la imagen se pinta DENTRO de la página: fiarse del MIME que
 * declara el cliente dejaría colar otra cosa con la etiqueta de una foto.
 */
export function detectarMimeImagen(b: Buffer): MimeImagenNota | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(FIRMA_PNG)) return 'image/png';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function comoObjeto(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

// Un id que no es un UUID haría que Postgres contestara con un error de tipo
// (un 500). Para quien llama es lo mismo que una ficha que no existe.
function validarEmpleadoId(v: unknown): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw new AusenciaError('empleado_no_encontrado', 404, 'empleadoId');
  return v;
}

function validarCategoria(v: unknown): CategoriaNota {
  if (!(CATEGORIAS_NOTA as readonly unknown[]).includes(v)) throw new AusenciaError('categoria_invalida', 400, 'categoria');
  return v as CategoriaNota;
}

function validarEstado(v: unknown): EstadoNota {
  if (!(ESTADOS_NOTA as readonly unknown[]).includes(v)) throw new AusenciaError('estado_invalido', 400, 'estado');
  return v as EstadoNota;
}

function validarFecha(v: unknown): string {
  if (typeof v !== 'string' || !esFechaValida(v)) throw new AusenciaError('fecha_invalida', 400, 'fecha');
  return v;
}

function validarComentario(v: unknown): string {
  const c = typeof v === 'string' ? v.trim() : '';
  if (!c) throw new AusenciaError('comentario_vacio', 400, 'comentario');
  if (c.length > MAX_COMENTARIO_NOTA) throw new AusenciaError('comentario_demasiado_largo', 400, 'comentario');
  return c;
}

function validarImagen(v: unknown): ImagenNuevaDeNota {
  if (typeof v !== 'object' || v === null) throw new AusenciaError('imagen_no_admitida', 400, 'imagen');
  const a = v as Record<string, unknown>;
  const nombreArchivo = String(a.nombreArchivo ?? '').trim();
  const mime = String(a.mime ?? '');
  const contenidoBase64 = String(a.contenidoBase64 ?? '');

  if (!nombreArchivo || nombreArchivo.length > MAX_NOMBRE_IMAGEN) {
    throw new AusenciaError('nombre_archivo_invalido', 400, 'imagen');
  }
  if (!(MIMES_IMAGEN_NOTA as readonly string[]).includes(mime)) throw new AusenciaError('imagen_no_admitida', 400, 'imagen');
  // Se estima el tamaño ANTES de decodificar, como con los PDF: no tiene sentido
  // materializar un buffer enorme solo para descubrir que sobra. La estimación
  // nunca se queda corta —los bytes decodificados nunca son más que 3/4 del
  // texto—, así que no hace falta volver a medir después.
  if (Math.floor((contenidoBase64.length * 3) / 4) > MAX_ADJUNTO_BYTES) {
    throw new AusenciaError('imagen_demasiado_grande', 400, 'imagen');
  }
  const contenido = Buffer.from(contenidoBase64, 'base64');
  if (detectarMimeImagen(contenido) !== mime) throw new AusenciaError('imagen_no_admitida', 400, 'imagen');
  return { nombreArchivo, mime: mime as MimeImagenNota, contenido };
}

/** Valida el cuerpo de un alta. La existencia de la ficha la mira `crearNota`. */
export function validarNuevaNota(body: unknown): NuevaNota {
  const b = comoObjeto(body);
  return {
    empleadoId: validarEmpleadoId(b.empleadoId),
    categoria: validarCategoria(b.categoria),
    fecha: validarFecha(b.fecha),
    comentario: validarComentario(b.comentario),
    imagen: b.imagen === undefined || b.imagen === null ? null : validarImagen(b.imagen),
  };
}

/** Valida el cuerpo de una edición: solo los campos que trae, y al menos uno. */
export function validarCambioNota(body: unknown): CambioNota {
  const b = comoObjeto(body);
  const cambio: CambioNota = {};
  if (b.empleadoId !== undefined) cambio.empleadoId = validarEmpleadoId(b.empleadoId);
  if (b.categoria !== undefined) cambio.categoria = validarCategoria(b.categoria);
  if (b.fecha !== undefined) cambio.fecha = validarFecha(b.fecha);
  if (b.comentario !== undefined) cambio.comentario = validarComentario(b.comentario);
  if (b.estado !== undefined) cambio.estado = validarEstado(b.estado);
  if (b.imagen !== undefined) cambio.imagen = b.imagen === null ? null : validarImagen(b.imagen);
  if (Object.keys(cambio).length === 0) throw new AusenciaError('sin_cambios', 400);
  return cambio;
}

// Un id de nota que no es un UUID no puede ser de nadie: 404 sin preguntar a la base.
function exigirIdDeNota(id: string): void {
  if (!UUID.test(id)) throw new AusenciaError('nota_no_encontrada', 404);
}

/** El nombre de una ficha ACTIVA, o 404. Es lo que se copia en la nota. */
async function nombreDeFicha(db: Pool, empleadoId: string): Promise<string> {
  const empleado = await repo.empleadoPorId(db, empleadoId);
  if (!empleado) throw new AusenciaError('empleado_no_encontrado', 404, 'empleadoId');
  return empleado.nombreCompleto;
}

export async function listarNotas(db: Pool, autorEmail: string): Promise<Nota[]> {
  return repo.notasDeAutor(db, autorEmail);
}

export async function crearNota(db: Pool, autorEmail: string, body: unknown): Promise<Nota> {
  const datos = validarNuevaNota(body);
  return repo.insertarNota(db, autorEmail, await nombreDeFicha(db, datos.empleadoId), datos);
}

export async function editarNota(db: Pool, autorEmail: string, id: string, body: unknown): Promise<Nota> {
  exigirIdDeNota(id);
  const cambio = validarCambioNota(body);
  const empleadoNombre = cambio.empleadoId === undefined ? undefined : await nombreDeFicha(db, cambio.empleadoId);
  const nota = await repo.actualizarNota(db, id, autorEmail, cambio, empleadoNombre);
  // 404 y no 403 cuando es ajena: no se confirma que exista.
  if (!nota) throw new AusenciaError('nota_no_encontrada', 404);
  return nota;
}

export async function borrarNota(db: Pool, autorEmail: string, id: string): Promise<void> {
  exigirIdDeNota(id);
  if (!(await repo.eliminarNota(db, id, autorEmail))) throw new AusenciaError('nota_no_encontrada', 404);
}

export async function descargarImagenDeNota(db: Pool, autorEmail: string, id: string): Promise<ImagenCompletaDeNota> {
  exigirIdDeNota(id);
  const imagen = await repo.imagenDeNota(db, id, autorEmail);
  if (!imagen) throw new AusenciaError('imagen_no_encontrada', 404);
  return imagen;
}
