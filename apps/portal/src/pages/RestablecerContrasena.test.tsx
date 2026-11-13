// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RestablecerContrasena from './RestablecerContrasena';
import AuthCard from '../components/Auth/AuthCard';

// La página pública del enlace del correo. El token llega en el hash de la URL
// real (window.location), no en la del router: por eso cada test fija la URL de
// jsdom antes de pintar. /auth se pinta con el AuthCard de verdad para ver
// adónde llevan los botones.

// API_BASE fijo (en los tests no hay VITE_HUB_API_URL); clearToken, el de verdad.
vi.mock('../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth')>()),
  API_BASE: 'http://test',
}));

const TOKEN = 'TokenDePrueba_-123';

function abrir(url: string) {
  window.history.replaceState(null, '', url);
  return render(
    <MemoryRouter initialEntries={['/auth/restablecer']}>
      <Routes>
        <Route path="/auth/restablecer" element={<RestablecerContrasena />} />
        <Route path="/auth" element={<AuthCard />} />
      </Routes>
    </MemoryRouter>,
  );
}

const respuesta = (status: number, cuerpo: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo }) as unknown as Response;

function escribir(clave: string, confirmacion: string) {
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: clave } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: confirmacion } });
  fireEvent.submit(screen.getByRole('button', { name: 'Guardar contraseña' }).closest('form')!);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('/auth/restablecer', () => {
  it('lee el token de #t=, lo quita de la barra de direcciones y lo manda con la clave nueva', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/auth/restablecer');

    vi.mocked(fetch).mockResolvedValue(respuesta(200, { message: 'password_reset' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    await screen.findByText('Contraseña actualizada');
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://test/api/auth/reset-password');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ token: TOKEN, newPassword: 'clave-nueva-1' });
  });

  it('rechaza una clave de menos de 8 caracteres sin llamar al servidor', () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    escribir('corta', 'corta');
    expect(screen.getByRole('alert').textContent).toContain('La contraseña debe tener al menos 8 caracteres.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rechaza dos claves que no coinciden sin llamar al servidor', () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    escribir('clave-nueva-1', 'clave-nueva-2');
    expect(screen.getByRole('alert').textContent).toContain('Las contraseñas no coinciden.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('el ojo muestra y oculta las dos claves', () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseñas' }));
    expect((screen.getByLabelText('Nueva contraseña') as HTMLInputElement).type).toBe('text');
    expect((screen.getByLabelText('Confirmar contraseña') as HTMLInputElement).type).toBe('text');
    const ocultar = screen.getByRole('button', { name: 'Ocultar contraseñas' });
    expect(ocultar.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(ocultar);
    expect((screen.getByLabelText('Nueva contraseña') as HTMLInputElement).type).toBe('password');
  });

  it('en el éxito borra el token de sesión y el botón lleva al login', async () => {
    localStorage.setItem('ambientalia_token', 'sesion-vieja');
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(200, { message: 'password_reset' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    await screen.findByText('Contraseña actualizada');
    expect(localStorage.getItem('ambientalia_token')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ir a iniciar sesión' }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('sin token: enlace no válido, y el botón abre «¿Olvidaste tu contraseña?»', () => {
    abrir('/auth/restablecer');
    expect(screen.getByText('Este enlace no es válido o ha caducado')).toBeTruthy();
    expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pedir un enlace nuevo' }));
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('400 invalid_or_expired_token: enlace no válido', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(400, { error: 'invalid_or_expired_token' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect(await screen.findByText('Este enlace no es válido o ha caducado')).toBeTruthy();
  });

  it('429 → «Demasiados intentos, espera unos minutos.»', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(429, { error: 'too many requests' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect((await screen.findByRole('alert')).textContent).toContain('Demasiados intentos, espera unos minutos.');
  });

  it('sin red → «No se pudo conectar con el servidor. Reintenta.»', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo conectar con el servidor. Reintenta.');
  });

  it('400 password_too_short del servidor → su mensaje', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(400, { error: 'password_too_short' }));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'La contraseña debe tener al menos 8 caracteres.',
    );
  });

  it('un error cualquiera (500) → mensaje genérico', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    vi.mocked(fetch).mockResolvedValue(respuesta(500, {}));
    escribir('clave-nueva-1', 'clave-nueva-1');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'No se pudo restablecer la contraseña. Reintenta.',
    );
  });

  it('el botón queda deshabilitado mientras la petición está en vuelo', async () => {
    abrir(`/auth/restablecer#t=${TOKEN}`);
    let resolver!: (r: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => (resolver = r)));
    escribir('clave-nueva-1', 'clave-nueva-1');
    const boton = await screen.findByRole('button', { name: /Guardando/ });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    resolver(respuesta(200, { message: 'password_reset' }));
    await screen.findByText('Contraseña actualizada');
  });

  describe('foco', () => {
    it('al montar con token, el foco está en la contraseña nueva', () => {
      abrir(`/auth/restablecer#t=${TOKEN}`);
      expect(document.activeElement).toBe(screen.getByLabelText('Nueva contraseña'));
    });

    it('tras el éxito, el foco pasa al título «Contraseña actualizada»', async () => {
      abrir(`/auth/restablecer#t=${TOKEN}`);
      vi.mocked(fetch).mockResolvedValue(respuesta(200, { message: 'password_reset' }));
      escribir('clave-nueva-1', 'clave-nueva-1');
      const titulo = await screen.findByText('Contraseña actualizada');
      expect(document.activeElement).toBe(titulo);
    });

    it('tras un 400 de token inválido, el foco pasa al título del enlace no válido', async () => {
      abrir(`/auth/restablecer#t=${TOKEN}`);
      vi.mocked(fetch).mockResolvedValue(respuesta(400, { error: 'invalid_or_expired_token' }));
      escribir('clave-nueva-1', 'clave-nueva-1');
      const titulo = await screen.findByText('Este enlace no es válido o ha caducado');
      expect(document.activeElement).toBe(titulo);
    });

    it('sin token, el título del enlace no válido recibe el foco al cargar', () => {
      abrir('/auth/restablecer');
      expect(document.activeElement).toBe(screen.getByText('Este enlace no es válido o ha caducado'));
    });
  });
});
