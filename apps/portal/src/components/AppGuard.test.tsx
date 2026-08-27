// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AuthState } from '../hooks/useAuth';
import AppGuard from './AppGuard';
import { notify } from '../lib/notify';

const state = vi.hoisted(() => ({ value: null as AuthState | null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => state.value }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

function renderGuard(appId: string) {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route
          path="/app"
          element={
            <AppGuard appId={appId}>
              <div>APP CONTENT</div>
            </AppGuard>
          }
        />
        <Route path="/" element={<div>HOME PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppGuard', () => {
  it('app asignada → renderiza children, sin notificación', () => {
    state.value = {
      isAuthenticated: true,
      user_id: 'u',
      email: 'r@x.com',
      role: 'reader',
      apps: ['customer-valuation', 'inventory'],
    };
    renderGuard('customer-valuation');
    expect(screen.getByText('APP CONTENT')).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
  });

  it('app no asignada → redirige a / y notifica', () => {
    state.value = { isAuthenticated: true, user_id: 'u', email: 'r@x.com', role: 'reader', apps: ['inventory'] };
    renderGuard('customer-valuation');
    expect(screen.getByText('HOME PAGE')).toBeTruthy();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('acceso'), 'error');
  });
});
