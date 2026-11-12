import type { CategoriaNota, EstadoNota, Nota } from './api';

// Las notas personales del administrador: lo que se puede decidir sin pantalla.
// Vive aquí, con tests, y no dentro de los componentes, que no tienen ninguno.

export const CATEGORIAS_NOTA: { id: CategoriaNota; label: string }[] = [
  { id: 'retraso', label: 'Informar retraso' },
  { id: 'solicitud', label: 'Solicitudes' },
  { id: 'otro', label: 'Otros' },
];

export const ETIQUETA_CATEGORIA: Record<CategoriaNota, string> = {
  retraso: 'Informar retraso',
  solicitud: 'Solicitudes',
  otro: 'Otros',
};

/** Espejo de los topes de hub-api: avisar aquí ahorra subir 8 MB para nada. */
export const MAX_COMENTARIO = 2000;
export const MAX_IMAGEN_BYTES = 8 * 1024 * 1024;
export const MIMES_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

export interface FiltrosNotas {
  /** `''` = todas, el mismo convenio que el resto de filtros de la app. */
  categoria: CategoriaNota | '';
  estado: EstadoNota | 'todas';
  /** Por nombre y no por id: una nota de una ficha borrada no tiene id. */
  empleadoNombre: string;
}

export function filtrarNotas(notas: Nota[], f: FiltrosNotas): Nota[] {
  return notas.filter(
    (n) =>
      (!f.categoria || n.categoria === f.categoria) &&
      (f.estado === 'todas' || n.estado === f.estado) &&
      (!f.empleadoNombre || n.empleadoNombre === f.empleadoNombre),
  );
}

/** El mismo orden que devuelve hub-api, para recolocar una nota recién guardada. */
export function ordenarNotas(notas: Nota[]): Nota[] {
  return [...notas].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.createdAt.localeCompare(a.createdAt));
}

export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** El motivo para no aceptar el fichero, o `null` si vale. */
export function errorDeImagen(f: { type: string; size: number }): string | null {
  if (!MIMES_IMAGEN.includes(f.type)) return 'La imagen tiene que ser JPG, PNG o WebP.';
  if (f.size > MAX_IMAGEN_BYTES) {
    return `La imagen pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.`;
  }
  return null;
}

// `mensajeDeError` (@suite/http) devuelve tal cual el código de un 400; aquí se
// pone en palabras. Lo que no está en la lista ya viene redactado y pasa igual.
const MENSAJES: Record<string, string> = {
  categoria_invalida: 'Elige una categoría.',
  estado_invalido: 'Ese estado no existe.',
  fecha_invalida: 'La fecha no es válida.',
  comentario_vacio: 'Escribe un comentario.',
  comentario_invalido: 'El comentario lleva un carácter que no se puede guardar.',
  comentario_demasiado_largo: `El comentario no puede pasar de ${MAX_COMENTARIO} caracteres.`,
  sin_cambios: 'No hay nada que guardar.',
  nombre_archivo_invalido: 'El nombre del archivo no es válido.',
  imagen_no_admitida: 'La imagen tiene que ser JPG, PNG o WebP de verdad, no solo por la extensión.',
  imagen_demasiado_grande: 'La imagen pasa de 8 MB.',
};

export function textoDeErrorDeNota(mensaje: string): string {
  return MENSAJES[mensaje] ?? mensaje;
}
