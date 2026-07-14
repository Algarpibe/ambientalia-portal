// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthState } from '../hooks/useAuth';
import Dashboard from './Dashboard';

const state = vi.hoisted(() => ({ value: null as AuthState | null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => state.value }));

function renderDashboard(apps: string[]) {
  state.value = { isAuthenticated: true, user_id: 'u', email: 'e@x.com', role: 'reader', apps };
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('Dashboard — filtrado por apps asignadas (Req 4.4)', () => {
  it('muestra solo las apps asignadas', () => {
    renderDashboard(['payment-reconciliation', 'customer-profitability']);
    expect(screen.getByText('Conciliador de Pagos')).toBeTruthy();
    expect(screen.getByText('Rentabilidad Clientes')).toBeTruthy();
    // No asignadas → ocultas.
    expect(screen.queryByText('Análisis de Inventario')).toBeNull();
    expect(screen.queryByText('Consolidador de Inventario')).toBeNull();
    expect(screen.queryByText('Valoración de Clientes')).toBeNull();
  });

  it('sin apps asignadas → estado vacío, ninguna tarjeta', () => {
    renderDashboard([]);
    expect(screen.getByText(/No tienes aplicaciones asignadas/i)).toBeTruthy();
    expect(screen.queryByText('Conciliador de Pagos')).toBeNull();
  });

  it('app en sección Herramientas también se filtra', () => {
    renderDashboard(['product-sales']); // "Ventas Artículos" (herramientas)
    expect(screen.getByText('Ventas Artículos')).toBeTruthy();
    expect(screen.queryByText('Conciliador de Pagos')).toBeNull();
  });
});
