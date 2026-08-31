// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopBar from './TopBar';
import { logout } from '../auth';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigateMock }));
// SEC-220 — el botón ya no borra el token y se queda tan ancho: llama a
// `logout()`, que avisa al backend para invalidar TODOS los tokens vivos del
// usuario y solo entonces borra el local.
vi.mock('../auth', () => ({ logout: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u', full_name: 'Alfonso García', email: 'comercial@x.com', role: 'admin', status: 'active', created_at: '2026-03-12T00:00:00.000Z', avatar: null },
    loading: false,
    reload: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TopBar', () => {
  it('al hacer clic en el avatar muestra el menú con nombre, email, Perfil y Cerrar sesión', () => {
    render(<MemoryRouter><TopBar /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Menú de usuario'));
    expect(screen.getByText('Alfonso García')).toBeTruthy();
    expect(screen.getByText('comercial@x.com')).toBeTruthy();
    expect(screen.getByText('Perfil').closest('a')?.getAttribute('href')).toBe('/configuracion');
    expect(screen.getByText('Cerrar sesión')).toBeTruthy();
  });

  it('Cerrar sesión invalida la sesión en el backend y navega a /auth', async () => {
    render(<MemoryRouter><TopBar /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Menú de usuario'));
    fireEvent.click(screen.getByText('Cerrar sesión'));
    // `logout()` es asíncrono: la navegación ocurre DESPUÉS de avisar al
    // backend, así que hay que dejar correr el microtask antes de mirar.
    await waitFor(() => expect(logout).toHaveBeenCalled());
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/auth'));
  });
});

// En móvil la TopBar es el único sitio desde el que se alcanza la navegación:
// la barra lateral fija está oculta por debajo de lg.
describe('TopBar — botón de menú móvil', () => {
  it('el botón avisa al ancestro para que abra la navegación', () => {
    const abrir = vi.fn();
    render(
      <MemoryRouter>
        <TopBar onOpenMenu={abrir} menuOpen={false} />
      </MemoryRouter>,
    );
    const boton = screen.getByLabelText('Abrir menú de navegación');
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(boton);
    expect(abrir).toHaveBeenCalled();
  });

  it('refleja en aria-expanded que la navegación está abierta', () => {
    render(
      <MemoryRouter>
        <TopBar onOpenMenu={vi.fn()} menuOpen />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Abrir menú de navegación').getAttribute('aria-expanded')).toBe('true');
  });
});
