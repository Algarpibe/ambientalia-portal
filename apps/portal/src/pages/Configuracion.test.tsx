// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Configuracion from './Configuracion';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';

vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u', full_name: 'Alfonso García', email: 'comercial@x.com', role: 'admin', status: 'active', created_at: '2026-03-12T00:00:00.000Z', avatar: null },
    loading: false,
    reload: vi.fn(),
  }),
  notifyProfileUpdated: vi.fn(),
}));

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Configuración', () => {
  it('muestra el perfil (nombre, email, rol, miembro desde)', () => {
    render(<Configuracion />);
    expect((screen.getByDisplayValue('Alfonso García') as HTMLInputElement)).toBeTruthy();
    expect(screen.getByDisplayValue('comercial@x.com')).toBeTruthy();
    expect(screen.getByText('Administrador')).toBeTruthy();
    expect(screen.getByText(/marzo de 2026/i)).toBeTruthy();
  });

  it('contraseñas que no coinciden → notifica error y no llama al endpoint', () => {
    render(<Configuracion />);
    fireEvent.change(screen.getByPlaceholderText('Tu contraseña actual'), { target: { value: 'actual123' } });
    fireEvent.change(screen.getByPlaceholderText(/Mínimo/i), { target: { value: 'nuevapass1' } });
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'distinta99' } });
    fireEvent.click(screen.getByText('Actualizar Contraseña'));
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/no coinciden/i), 'error');
    expect(mockFetch).not.toHaveBeenCalledWith('/api/users/me/password', expect.anything());
  });

  it('contraseña válida → PATCH /me/password', async () => {
    render(<Configuracion />);
    fireEvent.change(screen.getByPlaceholderText('Tu contraseña actual'), { target: { value: 'actual123' } });
    fireEvent.change(screen.getByPlaceholderText(/Mínimo/i), { target: { value: 'nuevapass1' } });
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'nuevapass1' } });
    fireEvent.click(screen.getByText('Actualizar Contraseña'));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/api/users/me/password', expect.objectContaining({ method: 'PATCH' })),
    );
  });
});
