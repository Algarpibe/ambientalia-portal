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

// Solo la clave que este componente escribe, no `clear()`: arrasar el almacén
// entero pisa el de otras suites cuando comparten backend (p. ej. bajo
// --localstorage-file), y este fichero no es dueño de esas claves.
beforeEach(() => localStorage.removeItem('sidebar_collapsed'));
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

  // El nombre de la marca vive dentro del logotipo, no en un <span>: lo que se
  // comprueba es CUÁL de los dos recortes se muestra, no si hay texto.
  const logo = () => screen.getByAltText('Portal Ambientalia').getAttribute('src') ?? '';

  it('arranca desplegada, con las etiquetas visibles', () => {
    renderAdmin();
    expect(logo()).toContain('ambientalia-logo');
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Cerrar sesión')).toBeTruthy();
  });

  it('al contraer oculta las etiquetas (deja el ancho para las tablas)', () => {
    renderAdmin();
    fireEvent.click(screen.getByLabelText('Contraer menú'));
    // El logotipo no desaparece: se cambia por el isotipo, que sí cabe en 80px.
    expect(logo()).toContain('ambientalia-isotipo');
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
    expect(logo()).toContain('ambientalia-logo');
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

// Por debajo de lg la barra fija se oculta y el panel deslizante es la ÚNICA
// navegación: sin él, Aplicaciones y Herramientas eran inalcanzables desde el
// móvil. Estos tests cubren esa vía, no la fija.
describe('Sidebar — navegación móvil (panel deslizante)', () => {
  const renderMovil = (abierto: boolean, onClose = vi.fn()) => {
    setAuth({ isAuthenticated: true, role: 'admin', user_id: 'a', apps: ['contabilidad'] });
    render(
      <MemoryRouter>
        <Sidebar mobileOpen={abierto} onMobileClose={onClose} />
      </MemoryRouter>,
    );
    return onClose;
  };

  it('cerrado no monta el panel: los enlaces no salen dos veces en el DOM', () => {
    renderMovil(false);
    // Uno solo: el de la barra fija. Si el panel se montara siempre, habría dos
    // nodos «Dashboard» y dos paradas de tabulación para el mismo destino.
    expect(screen.getAllByText('Dashboard')).toHaveLength(1);
    expect(screen.queryByLabelText('Cerrar menú')).toBeNull();
  });

  it('abierto monta el panel con los mismos destinos y su botón de cerrar', () => {
    renderMovil(true);
    expect(screen.getByLabelText('Cerrar menú')).toBeTruthy();
    const panel = screen.getByRole('dialog', { name: 'Menú de navegación' });
    expect(panel).toBeTruthy();
    // Los destinos se pintan dentro del panel, no solo en la barra fija.
    expect(panel.querySelector('a[href="/aplicaciones"]')).toBeTruthy();
    expect(panel.querySelector('a[href="/admin/users"]')).toBeTruthy();
  });

  it('tocar un enlace cierra el panel (si no, taparía la página recién abierta)', () => {
    const onClose = renderMovil(true);
    const panel = screen.getByRole('dialog', { name: 'Menú de navegación' });
    fireEvent.click(panel.querySelector('a[href="/aplicaciones"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape cierra el panel', () => {
    const onClose = renderMovil(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('el panel respeta el rol: sin admin no aparece Usuarios', () => {
    setAuth({ isAuthenticated: true, role: 'reader', user_id: 'b', apps: ['contabilidad'] });
    render(
      <MemoryRouter>
        <Sidebar mobileOpen onMobileClose={vi.fn()} />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('dialog', { name: 'Menú de navegación' });
    expect(panel.querySelector('a[href="/admin/users"]')).toBeNull();
  });
});
