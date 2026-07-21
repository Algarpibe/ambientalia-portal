// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
