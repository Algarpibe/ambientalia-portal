// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopBar from './TopBar';
import { clearToken } from '../auth';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigateMock }));
vi.mock('../auth', () => ({ clearToken: vi.fn() }));
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

  it('Cerrar sesión limpia el token y navega a /auth', () => {
    render(<MemoryRouter><TopBar /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText('Menú de usuario'));
    fireEvent.click(screen.getByText('Cerrar sesión'));
    expect(clearToken).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/auth');
  });
});
