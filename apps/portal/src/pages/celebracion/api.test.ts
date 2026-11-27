import { describe, it, expect, vi, afterEach } from 'vitest';
import { authFetch } from '../../lib/api';
import {
  cargarMiEstado,
  cargarResumen,
  cargarVista,
  ErrorApi,
  excluirInvitado,
  readmitirInvitado,
  guardarConfirmacion,
  guardarVotos,
  mensajeDeError,
  subirMiFoto,
} from './api';

vi.mock('../../lib/api', () => ({ authFetch: vi.fn() }));
const mockFetch = vi.mocked(authFetch);

function respuesta(status: number, cuerpo: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo } as unknown as Response;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('api de la invitación', () => {
  it('las lecturas piden su ruta y devuelven el cuerpo', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { yo: 'u1' }));
    await expect(cargarVista()).resolves.toEqual({ yo: 'u1' });
    await cargarMiEstado();
    await cargarResumen();
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      '/api/celebracion',
      '/api/celebracion/mi-estado',
      '/api/celebracion/resumen',
    ]);
  });

  it('guardarConfirmacion manda un PUT con los datos', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { message: 'confirmacion_guardada' }));
    await guardarConfirmacion({ asiste: true, preferencia: 'general', mensaje: null });
    expect(mockFetch).toHaveBeenCalledWith('/api/celebracion/confirmacion', {
      method: 'PUT',
      body: JSON.stringify({ asiste: true, preferencia: 'general', mensaje: null }),
    });
  });

  it('guardarVotos manda las cualidades al compañero', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { message: 'votos_guardados' }));
    await guardarVotos('u-2', ['Empatía']);
    expect(mockFetch).toHaveBeenCalledWith('/api/celebracion/votos/u-2', {
      method: 'PUT',
      body: JSON.stringify({ cualidades: ['Empatía'] }),
    });
  });

  it('excluirInvitado y readmitirInvitado usan PUT y DELETE sobre el usuario', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { message: 'excluido' }));
    await excluirInvitado('u 3');
    expect(mockFetch).toHaveBeenLastCalledWith('/api/celebracion/excluidos/u%203', { method: 'PUT' });
    await readmitirInvitado('u 3');
    expect(mockFetch).toHaveBeenLastCalledWith('/api/celebracion/excluidos/u%203', { method: 'DELETE' });
  });

  it('mensajeDeError traduce no_invitado y exclusion_propia', () => {
    expect(mensajeDeError(new ErrorApi('no_invitado', 403))).toBe('Esta invitación no está disponible para tu cuenta.');
    expect(mensajeDeError(new ErrorApi('exclusion_propia', 400))).toBe('No puedes quitarte a ti mismo de la invitación.');
  });

  it('subirMiFoto usa el endpoint de avatar de siempre', async () => {
    mockFetch.mockResolvedValue(respuesta(200, { message: 'avatar_updated' }));
    await subirMiFoto('data:image/jpeg;base64,AAAA');
    expect(mockFetch).toHaveBeenCalledWith('/api/users/me/avatar', {
      method: 'PATCH',
      body: JSON.stringify({ avatar: 'data:image/jpeg;base64,AAAA' }),
    });
  });

  it('un error del servidor sale como ErrorApi con su código y su estado', async () => {
    mockFetch.mockResolvedValue(respuesta(409, { error: 'confirmaciones_cerradas' }));
    await expect(guardarConfirmacion({ asiste: false, preferencia: null, mensaje: null })).rejects.toMatchObject({
      codigo: 'confirmaciones_cerradas',
      status: 409,
    });
  });

  it('una respuesta sin JSON también es ErrorApi', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('html');
      },
    } as unknown as Response);
    await expect(cargarVista()).rejects.toBeInstanceOf(ErrorApi);
  });

  it('mensajeDeError traduce los códigos y usa el genérico para lo demás', () => {
    expect(mensajeDeError(new ErrorApi('voto_propio', 400))).toBe('No puedes brindar por ti mismo.');
    expect(mensajeDeError(new ErrorApi('confirmaciones_cerradas', 409))).toBe('Las confirmaciones ya están cerradas.');
    expect(mensajeDeError(new ErrorApi('faltan_brindis', 409))).toBe('Primero brinda por tus compañeros en el muro.');
    expect(mensajeDeError(new ErrorApi('raro', 500))).toBe('No se pudo guardar. Vuelve a intentarlo.');
    expect(mensajeDeError(new Error('red'))).toBe('No se pudo guardar. Vuelve a intentarlo.');
  });

  it('mensajeDeError avisa del límite de peticiones (429)', () => {
    expect(mensajeDeError(new ErrorApi('error', 429))).toBe(
      'Demasiadas peticiones a la vez. Espera un momento y vuelve a intentarlo.',
    );
  });
});
