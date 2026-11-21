// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UseAuthResult } from '../hooks/useAuth';
import RequireAuth from './RequireAuth';
import { guardarTerminos, leerTerminos, olvidarTerminos } from '../lib/terminosSesion';
import { TERMS_VERSION, TEXTO_CASILLA } from '../legal/terminos';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';
import { logout } from '../auth';

// La pantalla de aceptación de las condiciones de uso, montada como en la app:
// detrás de RequireAuth, delante de una ruta protegida cualquiera. useAuth se
// simula (solo importa el user_id); el estado de las condiciones va por el
// almacén REAL (lib/terminosSesion), que es de donde lee la pantalla.

const estado = vi.hoisted(() => ({ auth: null as UseAuthResult | null, sesion: true }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => estado.auth }));
vi.mock('../auth', () => ({
  isAuthenticated: () => estado.sesion,
  logout: vi.fn(async () => {}),
  RUTA_INICIAR_SESION: '/auth?modo=login',
}));
vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;
const USUARIO = 'u1';
const TITULO = 'Condiciones de uso y tratamiento de datos';

function montar() {
  return render(
    <MemoryRouter initialEntries={['/contabilidad']}>
      <Routes>
        <Route path="/auth" element={<div>LOGIN</div>} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <div>CONTENIDO PROTEGIDO</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Lo que diría /users/me de alguien sin la versión vigente aceptada. */
const pendiente = () => guardarTerminos(USUARIO, { current: TERMS_VERSION, accepted: false });
const botonAceptar = () => screen.getByRole('button', { name: 'Aceptar y continuar' }) as HTMLButtonElement;
const marcarCasilla = () => fireEvent.click(screen.getByRole('checkbox', { name: TEXTO_CASILLA }));

beforeEach(() => {
  // Reset de la implementación (no solo de las llamadas): la promesa que no
  // se resuelve de un test no debe filtrarse al siguiente.
  mockFetch.mockReset();
  olvidarTerminos();
  estado.sesion = true;
  estado.auth = {
    isAuthenticated: true,
    user_id: USUARIO,
    email: 'persona@ejemplo.test',
    role: 'reader',
    apps: [],
    appsConfirmadas: true,
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AceptacionTerminos (detrás de RequireAuth)', () => {
  it('sin la versión vigente aceptada: la pantalla, en vez del contenido, con sus textos y el enlace', () => {
    pendiente();
    montar();
    expect(screen.getByRole('heading', { name: TITULO })).toBeTruthy();
    expect(
      screen.getByText(
        `Para seguir usando el portal, lee y acepta las condiciones de uso y la política de tratamiento de datos personales de AMBIENTALIA S.A.S. (versión ${TERMS_VERSION}).`,
      ),
    ).toBeTruthy();
    const enlace = screen.getByRole('link', { name: 'Leer el documento completo (se abre en una pestaña nueva)' });
    expect(enlace.getAttribute('href')).toBe('/terminos');
    expect(enlace.getAttribute('target')).toBe('_blank');
    expect(enlace.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('checkbox', { name: TEXTO_CASILLA })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salir' })).toBeTruthy();
    expect(screen.queryByText('CONTENIDO PROTEGIDO')).toBeNull();
  });

  it('con la vigente aceptada no aparece', () => {
    guardarTerminos(USUARIO, { current: TERMS_VERSION, accepted: true });
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('sin dato (cargando, /users/me falló o hub-api sin terms) no aparece: no deja a nadie fuera', () => {
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('lo que se sabe de otra cuenta no cuenta', () => {
    guardarTerminos('otra-cuenta', { current: TERMS_VERSION, accepted: false });
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
  });

  // Si hub-api publica una versión antes de que llegue el portal con su texto, pedirla
  // sería un callejón sin salida: el portal enviaría la suya y hub-api contestaría 400.
  it('si hub-api pide una versión que este portal no tiene, no aparece', () => {
    guardarTerminos(USUARIO, { current: `${TERMS_VERSION}-otra`, accepted: false });
    montar();
    expect(screen.getByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('sin sesión, RequireAuth manda al login antes de mirar las condiciones', () => {
    estado.sesion = false;
    pendiente();
    montar();
    expect(screen.getByText('LOGIN')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: TITULO })).toBeNull();
  });

  it('«Aceptar y continuar» está deshabilitado hasta marcar la casilla', () => {
    pendiente();
    montar();
    expect(botonAceptar().disabled).toBe(true);
    marcarCasilla();
    expect(botonAceptar().disabled).toBe(false);
  });

  it('aceptar manda la versión a POST /api/users/me/terms, quita la pantalla y sigue a la ruta', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: true }) });
    pendiente();
    montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    expect(await screen.findByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith('/api/users/me/terms', {
      method: 'POST',
      body: JSON.stringify({ version: TERMS_VERSION }),
    });
    expect(leerTerminos(USUARIO)).toEqual({ current: TERMS_VERSION, accepted: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it('mientras se guarda, el botón queda deshabilitado: no se envía dos veces', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    pendiente();
    montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    expect(botonAceptar().disabled).toBe(true);
    fireEvent.click(botonAceptar());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['un error del servidor', () => mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })],
    ['un fallo de red', () => mockFetch.mockRejectedValue(new Error('sin red'))],
  ])('con %s al guardar avisa y la pantalla sigue', async (_caso, preparar) => {
    preparar();
    pendiente();
    montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('No se pudo guardar tu aceptación. Inténtalo de nuevo.', 'error'),
    );
    expect(screen.getByRole('heading', { name: TITULO })).toBeTruthy();
    expect(botonAceptar().disabled).toBe(false);
    expect(leerTerminos(USUARIO)?.accepted).toBe(false);
  });

  it('«Salir» cierra la sesión y lleva a iniciar sesión, sin guardar nada', async () => {
    // El cierre de sesión queda pendiente a propósito: si navegara antes de que
    // termine, LOGIN aparecería con el cierre aún sin resolver.
    let terminarLogout: () => void = () => {};
    (logout as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>((resolver) => (terminarLogout = resolver)),
    );
    pendiente();
    montar();
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByText('LOGIN')).toBeNull();
    terminarLogout();
    expect(await screen.findByText('LOGIN')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('una segunda aceptación en el mismo montaje (otra cuenta) también quita la pantalla', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ accepted: true }) });
    pendiente();
    const vista = montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    expect(await screen.findByText('CONTENIDO PROTEGIDO')).toBeTruthy();

    // La sesión pasa a otra cuenta (p. ej. por el evento `storage` de otra pestaña).
    estado.auth = { ...estado.auth!, user_id: 'u2' };
    guardarTerminos('u2', { current: TERMS_VERSION, accepted: false });
    vista.rerender(
      <MemoryRouter initialEntries={['/contabilidad']}>
        <Routes>
          <Route
            path="*"
            element={
              <RequireAuth>
                <div>CONTENIDO PROTEGIDO</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: TITULO })).toBeTruthy();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    expect(await screen.findByText('CONTENIDO PROTEGIDO')).toBeTruthy();
    expect(leerTerminos('u2')).toEqual({ current: TERMS_VERSION, accepted: true });
  });

  it('con un 401 al guardar no avisa: el interceptor global ya lleva al login', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    pendiente();
    montar();
    marcarCasilla();
    fireEvent.click(botonAceptar());
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it('al aparecer, el foco está en el título', () => {
    pendiente();
    montar();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: TITULO }));
  });

  it('el orden del DOM es el orden visual: «Aceptar y continuar» antes que «Salir»', () => {
    pendiente();
    montar();
    const orden = botonAceptar().compareDocumentPosition(screen.getByRole('button', { name: 'Salir' }));
    expect(orden & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
