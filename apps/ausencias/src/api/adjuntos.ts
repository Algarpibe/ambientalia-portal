import { authHeaders } from '@suite/auth-client';
import { mensajeDeError } from '@suite/http';
import { API_BASE, get } from './http';
import type { Adjunto, Solicitud } from './tipos';

// ARQ-612 — los PDF de soporte, sacados de api.ts tal cual: descargar uno,
// leer el que se va a subir como base64 y la lista de solicitudes que llevan
// uno. api.ts lo reexporta (lo vigila barril.test.ts).

/**
 * Descarga el PDF de una solicitud. Va por fetch y no por `<a href>` porque el
 * endpoint exige la cabecera Authorization, que un enlace no puede mandar.
 */
export async function descargarAdjunto(adjunto: Adjunto): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ausencias/adjuntos/${encodeURIComponent(adjunto.id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await mensajeDeError(res));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = adjunto.nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lee un File como base64 sin la cabecera `data:...;base64,`. */
export function leerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.onload = () => {
      const r = String(lector.result);
      const coma = r.indexOf(',');
      resolve(coma >= 0 ? r.slice(coma + 1) : r);
    };
    lector.readAsDataURL(file);
  });
}

/** Las solicitudes con PDF. Solo para admin y la lista de administración. */
export const fetchConAdjunto = () =>
  get<{ solicitudes: Solicitud[] }>('/api/ausencias/adjuntos').then((d) => d.solicitudes);
