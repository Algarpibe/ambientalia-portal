// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import FrecuenciaCorreos from './FrecuenciaCorreos';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';

vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;
const DESTINATARIOS = [
  { email: 'marcela@x.co', nombre: 'Marcela', frecuencia: 'inmediato', hora: null, diaSemana: null },
  { email: 'andres@x.co', nombre: 'Andres', frecuencia: 'diario', hora: 17, diaSemana: null },
];

beforeEach(() => {
  mockFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? { ok: true, status: 200, json: async () => ({ ok: true }) }
      : { ok: true, status: 200, json: async () => DESTINATARIOS }
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FrecuenciaCorreos (Ajustes, solo admin)', () => {
  it('lista a los destinatarios con su frecuencia guardada', async () => {
    render(<FrecuenciaCorreos />);
    expect(await screen.findByText('Marcela')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith('/api/wo-sales/email/frecuencias');
    expect((screen.getByLabelText('Frecuencia de Andres') as HTMLSelectElement).value).toBe('diario');
    expect((screen.getByLabelText('Hora de Andres') as HTMLSelectElement).value).toBe('17');
  });

  it('guarda el cambio con PUT y avisa', async () => {
    render(<FrecuenciaCorreos />);
    await screen.findByText('Marcela');
    fireEvent.change(screen.getByLabelText('Frecuencia de Marcela'), { target: { value: 'nunca' } });
    fireEvent.click(screen.getAllByRole('button', { name: /guardar/i })[0]);
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/wo-sales/email/frecuencias',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ email: 'marcela@x.co', frecuencia: 'nunca', hora: null, diaSemana: null }),
        })
      )
    );
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/guardad/i), 'info');
  });

  it('no deja guardar "semanal" sin día y hora', async () => {
    render(<FrecuenciaCorreos />);
    await screen.findByText('Marcela');
    fireEvent.change(screen.getByLabelText('Frecuencia de Marcela'), { target: { value: 'semanal' } });
    expect((screen.getAllByRole('button', { name: /guardar/i })[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
