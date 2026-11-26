import { authFetch } from '../../lib/api';
import type { DatosConfirmacion, MiEstado, Resumen, Vista } from './tipos';

/** Error de la API con el código que manda hub-api (`{ error: '<codigo>' }`). */
export class ErrorApi extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, status: number) {
    super(codigo);
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.status = status;
  }
}

async function leer<T>(res: Response): Promise<T> {
  const cuerpo = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const codigo = (cuerpo as { error?: unknown } | null)?.error;
    throw new ErrorApi(typeof codigo === 'string' ? codigo : 'error', res.status);
  }
  return cuerpo as T;
}

const BASE = '/api/celebracion';

export async function cargarVista(): Promise<Vista> {
  return leer<Vista>(await authFetch(BASE));
}

export async function cargarMiEstado(): Promise<MiEstado> {
  return leer<MiEstado>(await authFetch(`${BASE}/mi-estado`));
}

export async function cargarResumen(): Promise<Resumen> {
  return leer<Resumen>(await authFetch(`${BASE}/resumen`));
}

export async function guardarConfirmacion(datos: DatosConfirmacion): Promise<void> {
  await leer(await authFetch(`${BASE}/confirmacion`, { method: 'PUT', body: JSON.stringify(datos) }));
}

export async function guardarVotos(userId: string, cualidades: string[]): Promise<void> {
  await leer(
    await authFetch(`${BASE}/votos/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ cualidades }),
    }),
  );
}

/** La foto propia: el mismo endpoint que Configuración (solo cambia la de quien llama). */
export async function subirMiFoto(dataUrl: string): Promise<void> {
  await leer(await authFetch('/api/users/me/avatar', { method: 'PATCH', body: JSON.stringify({ avatar: dataUrl }) }));
}

const MENSAJES: Record<string, string> = {
  confirmaciones_cerradas: 'Las confirmaciones ya están cerradas.',
  votos_cerrados: 'La votación ya se cerró.',
  asiste_invalido: 'Indica si vas o no.',
  preferencia_invalida: 'Elige una preferencia de menú.',
  mensaje_invalido: 'El mensaje no puede pasar de 200 caracteres ni llevar saltos de línea.',
  cualidad_invalida: 'Alguna cualidad no es válida. Recarga la página.',
  demasiadas_cualidades: 'Puedes elegir como mucho 3 cualidades.',
  voto_propio: 'No puedes brindar por ti mismo.',
  usuario_no_valido: 'Esa persona ya no está en el equipo. Recarga la página.',
};

const GENERICO = 'No se pudo guardar. Vuelve a intentarlo.';

/** Texto para el aviso de un error al guardar. */
export function mensajeDeError(e: unknown): string {
  return e instanceof ErrorApi ? (MENSAJES[e.codigo] ?? GENERICO) : GENERICO;
}
