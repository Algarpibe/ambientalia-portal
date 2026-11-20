// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { UseAuthResult } from '../hooks/useAuth';
import AppGuard from './AppGuard';
import { notify } from '../lib/notify';

const state = vi.hoisted(() => ({ value: null as UseAuthResult | null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => state.value }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

function arbol(appId: string) {
  return (
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
    </MemoryRouter>
  );
}

function renderGuard(appId: string) {
  return render(arbol(appId));
}

function sesion(apps: string[], appsConfirmadas: boolean): UseAuthResult {
  return { isAuthenticated: true, user_id: 'u', email: 'r@x.com', role: 'reader', apps, appsConfirmadas };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppGuard', () => {
  it('app asignada → renderiza children, sin notificación', () => {
    state.value = sesion(['customer-valuation', 'inventory'], true);
    renderGuard('customer-valuation');
    expect(screen.getByText('APP CONTENT')).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
  });

  it('app no asignada → redirige a / y notifica', () => {
    state.value = sesion(['inventory'], true);
    renderGuard('customer-valuation');
    expect(screen.getByText('HOME PAGE')).toBeTruthy();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('acceso'), 'error');
  });

  it('el token trae la app y el servidor aún no contestó → children al instante, sin esperar', () => {
    state.value = sesion(['customer-valuation'], false);
    renderGuard('customer-valuation');
    expect(screen.getByText('APP CONTENT')).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
  });

  it('el token NO trae la app y la lista del servidor no ha llegado → ni redirige ni avisa', () => {
    // Caso del enlace del correo de «apps nuevas»: carga completa de página con
    // un token de hasta 7 días que no conoce la app recién concedida.
    state.value = sesion(['inventory'], false);
    renderGuard('customer-valuation');
    expect(screen.queryByText('HOME PAGE')).toBeNull();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(notify).not.toHaveBeenCalled();
  });

  it('llega la lista del servidor CON la app → se pintan los children', () => {
    state.value = sesion(['inventory'], false);
    const { rerender } = renderGuard('customer-valuation');
    state.value = sesion(['inventory', 'customer-valuation'], true);
    rerender(arbol('customer-valuation'));
    expect(screen.getByText('APP CONTENT')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('llega la lista del servidor SIN la app → redirige y notifica', () => {
    state.value = sesion(['inventory'], false);
    const { rerender } = renderGuard('customer-valuation');
    state.value = sesion(['inventory'], true);
    rerender(arbol('customer-valuation'));
    expect(screen.getByText('HOME PAGE')).toBeTruthy();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
