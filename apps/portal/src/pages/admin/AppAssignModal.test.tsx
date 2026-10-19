// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import AppAssignModal from './AppAssignModal';
import type { AdminUser } from './types';
import { authFetch } from '../../lib/api';

vi.mock('../../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

const user: AdminUser = {
  id: 'u1',
  full_name: 'Test User',
  email: 't@x.com',
  role: 'reader',
  status: 'active',
  created_at: '2025-01-01T00:00:00.000Z',
};

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // GET inicial: el usuario ya tiene 'inventory-optimization' asignada.
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ apps: ['inventory-optimization'] }) });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppAssignModal', () => {
  it('precarga las apps actuales (checkbox marcado)', async () => {
    render(<AppAssignModal user={user} onClose={() => {}} onSaved={() => {}} />);
    const cb = (await screen.findByRole('checkbox', { name: 'Análisis de Inventario' })) as HTMLInputElement;
    expect(cb.checked).toBe(true);
    // Otra app no asignada → desmarcada.
    expect((screen.getByRole('checkbox', { name: 'Conciliador de Pagos' }) as HTMLInputElement).checked).toBe(false);
  });

  it('al confirmar hace PUT con el conjunto seleccionado y llama onSaved/onClose', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<AppAssignModal user={user} onClose={onClose} onSaved={onSaved} />);

    // Espera la precarga y selecciona una app adicional.
    const conciliador = (await screen.findByRole('checkbox', { name: 'Conciliador de Pagos' })) as HTMLInputElement;
    fireEvent.click(conciliador);

    fireEvent.click(screen.getByText('Guardar'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();

    // La última llamada fue el PUT con el body correcto.
    const putCall = mockFetch.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(putCall![0]).toBe('/api/users/u1/apps');
    const body = JSON.parse(putCall![1].body);
    expect(new Set(body.apps)).toEqual(new Set(['inventory-optimization', 'payment-reconciliation']));
  });

  // FE-411 — si la precarga falla, la selección se queda vacía. Con Guardar
  // activo, un clic mandaba `PUT apps: []` y dejaba al usuario sin ninguna app.
  describe('si no se pudieron cargar las apps actuales', () => {
    it.each([
      ['el servidor responde con error', () => mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) })],
      ['no hay conexión', () => mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'))],
      ['la respuesta no trae la lista de apps', () => mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) })],
    ])('%s: no deja guardar ni muestra una selección vacía', async (_caso, fallar) => {
      fallar();
      render(<AppAssignModal user={user} onClose={() => {}} onSaved={() => {}} />);

      expect(await screen.findByText(/No se pudieron cargar las apps/)).toBeTruthy();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      const guardar = screen.getByText('Guardar') as HTMLButtonElement;
      expect(guardar.disabled).toBe(true);

      fireEvent.click(guardar);
      expect(mockFetch.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(false);
    });
  });
});
