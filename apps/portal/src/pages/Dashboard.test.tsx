// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthState } from '../hooks/useAuth';
import type { RegistryState } from '../hooks/useWidgetRegistry';
import type { WidgetDescriptor } from '../widgets/types';
import Dashboard from './Dashboard';

const authState = vi.hoisted(() => ({ value: null as AuthState | null }));
const registryState = vi.hoisted(() => ({ value: { status: 'ready', widgets: [] } as RegistryState }));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState.value }));
vi.mock('../hooks/useWidgetRegistry', () => ({ useWidgetRegistry: () => registryState.value }));
// Layout siempre vacío: el foco de estos tests es el estado del panel, no la persistencia.
vi.mock('../hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    layoutItems: [],
    anchoredWidgetIds: new Set<string>(),
    addWidget: vi.fn(),
    removeWidget: vi.fn(),
    onLayoutChange: vi.fn(),
    persistError: null,
  }),
}));

function renderDashboard(apps: string[], registry: RegistryState = { status: 'ready', widgets: [] }) {
  authState.value = { isAuthenticated: true, user_id: 'u', email: 'e@x.com', role: 'reader', apps };
  registryState.value = registry;
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

const fakeWidget = (id: string): WidgetDescriptor => ({
  id,
  appId: 'customer-valuation',
  name: `Widget ${id}`,
  description: 'desc',
  defaultSize: { w: 4, h: 3 },
  component: () => null,
});

afterEach(cleanup);

describe('Dashboard — panel de widgets', () => {
  it('muestra los controles del panel (Mi Panel, Editar panel)', () => {
    renderDashboard(['customer-valuation']);
    expect(screen.getByText('Mi Panel')).toBeTruthy();
    expect(screen.getByText(/Editar panel/i)).toBeTruthy();
  });

  it('sin apps asignadas → aviso de contactar al administrador', () => {
    renderDashboard([]);
    expect(screen.getByText(/No tienes aplicaciones asignadas/i)).toBeTruthy();
  });

  it('con apps pero sin widgets anclados ni disponibles → panel vacío', () => {
    renderDashboard(['customer-valuation'], { status: 'ready', widgets: [] });
    expect(screen.getByText(/Tu panel está vacío/i)).toBeTruthy();
    expect(screen.getByText(/Aún no hay widgets disponibles/i)).toBeTruthy();
  });

  it('con widgets disponibles no anclados → invita a añadir', () => {
    renderDashboard(['customer-valuation'], { status: 'ready', widgets: [fakeWidget('w1')] });
    expect(screen.getByText(/Añade widgets de tus aplicaciones/i)).toBeTruthy();
  });

  it('registry cargando → muestra spinner de carga', () => {
    renderDashboard(['customer-valuation'], { status: 'loading' });
    expect(screen.getByText(/Cargando widgets/i)).toBeTruthy();
  });

  it('el directorio de apps ya no se renderiza en el dashboard', () => {
    renderDashboard(['payment-reconciliation', 'customer-valuation']);
    expect(screen.queryByText('Conciliador de Pagos')).toBeNull();
    expect(screen.queryByText('Todas mis aplicaciones')).toBeNull();
  });
});
