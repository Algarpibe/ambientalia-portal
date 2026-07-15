// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthState } from '../hooks/useAuth';
import Sidebar from './Sidebar';

const state = vi.hoisted(() => ({ value: null as AuthState | null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => state.value }));

function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}
const setAuth = (partial: Partial<AuthState>) => {
  state.value = { isAuthenticated: false, user_id: null, email: null, role: null, apps: [], ...partial };
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Sidebar — plegado', () => {
  const renderAdmin = () => {
    setAuth({ isAuthenticated: true, role: 'admin', user_id: 'a' });
    return render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
  };

  it('arranca desplegada, con las etiquetas visibles', () => {
    renderAdmin();
    expect(screen.getByText('Antigravity')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Cerrar sesión')).toBeTruthy();
  });

  it('al contraer oculta las etiquetas (deja el ancho para las tablas)', () => {
    renderAdmin();
    fireEvent.click(screen.getByLabelText('Contraer menú'));
    expect(screen.queryByText('Antigravity')).toBeNull();
    expect(screen.queryByText('Dashboard')).toBeNull();
    // Los enlaces siguen identificables al pasar el ratón, y salir sigue accesible.
    expect(screen.getByTitle('Dashboard')).toBeTruthy();
    expect(screen.getByLabelText('Cerrar sesión')).toBeTruthy();
  });

  it('recuerda el estado plegado entre recargas', () => {
    const { unmount } = renderAdmin();
    fireEvent.click(screen.getByLabelText('Contraer menú'));
    expect(localStorage.getItem('sidebar_collapsed')).toBe('true');

    unmount();
    renderAdmin(); // simula recargar la página
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.getByLabelText('Expandir menú')).toBeTruthy();
  });

  it('se puede volver a desplegar', () => {
    renderAdmin();
    fireEvent.click(screen.getByLabelText('Contraer menú'));
    fireEvent.click(screen.getByLabelText('Expandir menú'));
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Antigravity')).toBeTruthy();
  });
});

describe('Sidebar — enlace Usuarios', () => {
  it('rol admin → enlace "Usuarios" visible y apunta a /admin/users', () => {
    setAuth({ isAuthenticated: true, role: 'admin', user_id: 'a' });
    renderSidebar();
    const link = screen.getByText('Usuarios').closest('a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/admin/users');
  });

  it('rol reader → enlace "Usuarios" oculto', () => {
    setAuth({ isAuthenticated: true, role: 'reader', user_id: 'r' });
    renderSidebar();
    expect(screen.queryByText('Usuarios')).toBeNull();
  });

  it('sin sesión → enlace "Usuarios" oculto', () => {
    setAuth({ isAuthenticated: false, role: null });
    renderSidebar();
    expect(screen.queryByText('Usuarios')).toBeNull();
  });
});
