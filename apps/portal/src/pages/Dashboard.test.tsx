// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthState } from '../hooks/useAuth';
import type { RegistryState } from '../hooks/useWidgetRegistry';
import type { WidgetDescriptor } from '../widgets/types';
import Dashboard from './Dashboard';

const authState = vi.hoisted(() => ({ value: null as AuthState | null }));
const registryState = vi.hoisted(() => ({ value: { status: 'ready', widgets: [] } as RegistryState }));
// Anclados vacíos salvo en las pruebas del diálogo de eliminar, que necesitan un
// widget en el panel para poder pedir su borrado.
const anclados = vi.hoisted(() => ({ value: [] as string[] }));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState.value }));
vi.mock('../hooks/useWidgetRegistry', () => ({ useWidgetRegistry: () => registryState.value }));
// El grid real (react-grid-layout) no aporta nada aquí: basta un botón por widget
// que pida su eliminación, que es lo que abre el diálogo de confirmación.
vi.mock('../components/WidgetGrid', () => ({
  default: ({ widgets, onRemoveWidget }: { widgets: WidgetDescriptor[]; onRemoveWidget: (id: string) => void }) => (
    <>
      {widgets.map((w) => (
        <button key={w.id} onClick={() => onRemoveWidget(w.id)}>
          Quitar {w.name}
        </button>
      ))}
    </>
  ),
}));
// Layout sin persistencia: el foco de estos tests es el estado del panel.
vi.mock('../hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    layoutItems: [],
    anchoredWidgetIds: new Set<string>(anclados.value),
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

afterEach(() => {
  cleanup();
  anclados.value = [];
});

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

// FE-419 — el buscador y la campana no tenían nombre accesible; el catálogo y la
// confirmación de eliminar no movían el foco ni se cerraban con Escape, y el
// catálogo cerrado seguía expuesto (y tabulable) fuera de la pantalla.
describe('Dashboard — accesibilidad (FE-419)', () => {
  /** Enfoca y pulsa, como haría el navegador (jsdom no enfoca con un clic sintético). */
  function pulsar(boton: HTMLElement) {
    boton.focus();
    fireEvent.click(boton);
    return boton;
  }

  it('el buscador y la campana tienen nombre', () => {
    renderDashboard(['customer-valuation']);
    expect(screen.getByLabelText('Buscar app')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeTruthy();
  });

  it('catálogo: oculto cuando está cerrado; al abrir recibe el foco y Escape lo devuelve', () => {
    renderDashboard(['customer-valuation'], { status: 'ready', widgets: [fakeWidget('w1')] });
    expect(screen.queryByRole('dialog', { name: 'Catálogo de widgets' })).toBeNull();

    pulsar(screen.getByRole('button', { name: /Editar panel/ }));
    const abridor = pulsar(screen.getAllByRole('button', { name: /Añadir widget/ })[0]);
    const catalogo = screen.getByRole('dialog', { name: 'Catálogo de widgets' });
    expect(catalogo.getAttribute('aria-modal')).toBe('true');
    expect(catalogo.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Catálogo de widgets' })).toBeNull();
    expect(document.activeElement).toBe(abridor);
  });

  it('confirmar eliminación: diálogo nombrado, foco dentro y Escape cancela', () => {
    anclados.value = ['w1'];
    renderDashboard(['customer-valuation'], { status: 'ready', widgets: [fakeWidget('w1')] });
    const abridor = pulsar(screen.getByRole('button', { name: 'Quitar Widget w1' }));
    const dialogo = screen.getByRole('dialog', { name: 'Eliminar widget' });
    expect(dialogo.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Eliminar widget' })).toBeNull();
    expect(document.activeElement).toBe(abridor);
  });
});
