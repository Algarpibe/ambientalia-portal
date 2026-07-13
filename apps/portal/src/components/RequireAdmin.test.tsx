// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AuthState } from '../hooks/useAuth';
import RequireAdmin from './RequireAdmin';

// Mock del hook de sesión para controlar el estado en cada test.
const state = vi.hoisted(() => ({ value: null as AuthState | null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => state.value }));

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <Routes>
        <Route
          path="/admin/users"
          element={
            <RequireAdmin>
              <div>ADMIN CONTENT</div>
            </RequireAdmin>
          }
        />
        <Route path="/auth" element={<div>AUTH PAGE</div>} />
        <Route path="/" element={<div>HOME PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('RequireAdmin', () => {
  it('sin sesión → redirige a /auth', () => {
    state.value = { isAuthenticated: false, user_id: null, email: null, role: null, apps: [] };
    renderGuard();
    expect(screen.getByText('AUTH PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('reader → redirige a /', () => {
    state.value = { isAuthenticated: true, user_id: 'u', email: 'r@x.com', role: 'reader', apps: [] };
    renderGuard();
    expect(screen.getByText('HOME PAGE')).toBeTruthy();
    expect(screen.queryByText('ADMIN CONTENT')).toBeNull();
  });

  it('admin → renderiza children', () => {
    state.value = { isAuthenticated: true, user_id: 'u', email: 'a@x.com', role: 'admin', apps: [] };
    renderGuard();
    expect(screen.getByText('ADMIN CONTENT')).toBeTruthy();
  });
});
