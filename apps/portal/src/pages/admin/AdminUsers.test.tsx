// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminUsers from './AdminUsers';
import { authFetch } from '../../lib/api';
import { clearToken } from '../../auth';
import type { AdminUser } from './types';

const renderAdmin = () => render(<MemoryRouter><AdminUsers /></MemoryRouter>);

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigateMock }));
vi.mock('../../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../../auth', () => ({ clearToken: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user_id: 'me', isAuthenticated: true, email: 'a@x.com', role: 'admin', apps: [] }) }));

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

function user(id: string, name: string, status: AdminUser['status']): AdminUser {
  return { id, full_name: name, email: `${id}@x.com`, role: 'reader', status, created_at: '2025-01-15T10:00:00.000Z' };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminUsers', () => {
  it('renderiza la lista de usuarios y la paginación', async () => {
    const users = [user('1', 'Ana', 'active'), user('2', 'Beto', 'pending'), user('3', 'Caro', 'inactive')];
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ users, total: 3, page: 1, limit: 50 }) });

    renderAdmin();

    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByText('Beto')).toBeTruthy();
    expect(screen.getByText('Caro')).toBeTruthy();
    expect(screen.getByText('3 usuarios registrados en total.')).toBeTruthy();
    expect(screen.getByText('Página 1 de 1')).toBeTruthy();
    // Estados como badges (active se muestra como "Aprobado").
    expect(screen.getByText('Aprobado')).toBeTruthy();
    expect(screen.getByText('Pendiente')).toBeTruthy();
    expect(screen.getByText('Inactivo')).toBeTruthy();
  });

  it('calcula el total de páginas a partir del total (>50 → 2 páginas)', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [user('1', 'Ana', 'active')], total: 80, page: 1, limit: 50 }) });
    renderAdmin();
    expect(await screen.findByText('Página 1 de 2')).toBeTruthy();
    expect((screen.getByText('Anterior') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Siguiente') as HTMLButtonElement).disabled).toBe(false);
  });

  // FE-414: con la carga fallida la lista queda vacía; la tabla no puede decir
  // «No hay usuarios.» ni la cabecera «0 usuarios registrados».
  it('si la carga falla no presenta la lista vacía como ausencia de usuarios', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderAdmin();
    expect(await screen.findByText('No se pudo cargar la lista de usuarios.')).toBeTruthy();
    expect(screen.queryByText('No hay usuarios.')).toBeNull();
    expect(screen.queryByText(/0 usuarios registrados/)).toBeNull();
  });

  it('si la carga falla por red tampoco presenta la lista vacía', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    renderAdmin();
    expect(await screen.findByText('No se pudo conectar con el servidor.')).toBeTruthy();
    expect(screen.queryByText('No hay usuarios.')).toBeNull();
    expect(screen.queryByText(/0 usuarios registrados/)).toBeNull();
  });

  it('con la carga correcta y sin usuarios sí muestra la lista vacía', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ users: [], total: 0, page: 1, limit: 50 }) });
    renderAdmin();
    expect(await screen.findByText('No hay usuarios.')).toBeTruthy();
    expect(screen.getByText('0 usuarios registrados en total.')).toBeTruthy();
  });

  it('muestra error si la carga falla', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    renderAdmin();
    expect(await screen.findByText(/No se pudo cargar/i)).toBeTruthy();
  });

  it('sesión expirada (401) → limpia token y redirige a /auth (Req 5.6)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    renderAdmin();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/auth', { replace: true }));
    expect(clearToken).toHaveBeenCalled();
  });
});

// FE-417: sin estado «en curso», un doble clic lanzaba dos peticiones y la segunda
// mostraba un toast de error aunque la acción ya se hubiera aplicado.
describe('AdminUsers · doble envío (FE-417)', () => {
  const lista = [user('1', 'Ana', 'active'), user('2', 'Beto', 'pending')];

  /** La carga de la lista responde al momento; la mutación queda pendiente hasta `soltar`. */
  function mutacionPendiente() {
    let soltar!: (r: unknown) => void;
    const pendiente = new Promise((resolve) => { soltar = resolve; });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (!init?.method) return Promise.resolve({ ok: true, json: async () => ({ users: lista, total: 2, page: 1, limit: 50 }) });
      return pendiente;
    });
    return { soltar };
  }
  const mutaciones = () => mockFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method);

  it('Aprobar dos veces seguidas envía UNA petición y el botón queda deshabilitado mientras tanto', async () => {
    const { soltar } = mutacionPendiente();
    renderAdmin();
    const aprobar = await screen.findByRole('button', { name: /Aprobar/ });
    fireEvent.click(aprobar);
    fireEvent.click(aprobar);
    expect(mutaciones()).toHaveLength(1);
    expect((aprobar as HTMLButtonElement).disabled).toBe(true);
    // Si falla, el botón vuelve a estar disponible para reintentar.
    soltar({ ok: false, status: 500, json: async () => ({}) });
    await waitFor(() => expect((screen.getByRole('button', { name: /Aprobar/ }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('Desactivar dos veces seguidas envía UNA petición', async () => {
    mutacionPendiente();
    renderAdmin();
    const desactivar = await screen.findByRole('button', { name: /Desactivar/ });
    fireEvent.click(desactivar);
    fireEvent.click(desactivar);
    expect(mutaciones()).toHaveLength(1);
    expect((desactivar as HTMLButtonElement).disabled).toBe(true);
  });

  it('Eliminar dos veces seguidas envía UNA petición', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      mutacionPendiente();
      renderAdmin();
      await screen.findByText('Ana');
      const [eliminar] = screen.getAllByRole('button', { name: 'Eliminar usuario' });
      fireEvent.click(eliminar);
      fireEvent.click(eliminar);
      expect(mutaciones()).toHaveLength(1);
      expect((eliminar as HTMLButtonElement).disabled).toBe(true);
    } finally {
      confirmar.mockRestore();
    }
  });
});
