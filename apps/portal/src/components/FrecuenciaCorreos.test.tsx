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

  // FE-414: una carga fallida deja la lista vacía; eso no es «no hay usuarios
  // con la app», y sin la lista real no hay nada que se pueda guardar.
  describe('cuando la carga falla', () => {
    const esperarFinCarga = () => waitFor(() => expect(screen.queryByText('Cargando…')).toBeNull());

    it('muestra el error en lugar del mensaje de lista vacía y no deja guardar', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));
      render(<FrecuenciaCorreos />);
      await esperarFinCarga();
      expect(screen.queryByText(/No hay usuarios activos/)).toBeNull();
      expect(screen.getByRole('alert').textContent).toMatch(/No se pudo cargar la frecuencia de correos/);
      expect(screen.queryByRole('button', { name: /guardar/i })).toBeNull();
      expect(notify).toHaveBeenCalledWith('No se pudo cargar la frecuencia de correos.', 'error');
    });

    it('trata como fallo una respuesta HTTP de error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
      render(<FrecuenciaCorreos />);
      await esperarFinCarga();
      expect(screen.queryByText(/No hay usuarios activos/)).toBeNull();
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('trata como fallo una respuesta sin la lista', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: 'x' }) });
      render(<FrecuenciaCorreos />);
      await esperarFinCarga();
      expect(screen.queryByText(/No hay usuarios activos/)).toBeNull();
      expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('mantiene el mensaje de lista vacía cuando la carga va bien y no hay nadie', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
      render(<FrecuenciaCorreos />);
      expect(await screen.findByText(/No hay usuarios activos/)).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
