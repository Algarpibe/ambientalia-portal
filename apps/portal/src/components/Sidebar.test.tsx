// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

afterEach(cleanup);

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
