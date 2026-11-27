// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CelebracionNavidad from './CelebracionNavidad';
import { cargarResumen, cargarVista } from './api';
import { resumenDePrueba, vistaDePrueba } from './fixtures';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarVista: vi.fn(),
  guardarConfirmacion: vi.fn(),
  guardarVotos: vi.fn(),
  subirMiFoto: vi.fn(),
  cargarResumen: vi.fn(),
}));
vi.mock('./confeti', () => ({ lanzarConfeti: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function abrirCon(esAdmin: boolean, asiste: boolean | null = null) {
  vi.mocked(cargarVista).mockResolvedValue(
    vistaDePrueba({
      esAdmin,
      miRespuesta: asiste === null ? null : { asiste, preferencia: asiste ? 'general' : null, mensaje: null, actualizadoEn: '2026-12-01T15:00:00Z' },
    }),
  );
  vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
  render(<CelebracionNavidad />);
  fireEvent.click(await screen.findByRole('button', { name: /Abrir invitación/ }));
}

describe('CelebracionNavidad · admin y pase', () => {
  it('el panel solo aparece para el admin', async () => {
    await abrirCon(false);
    expect(screen.queryByRole('heading', { name: 'Panel de confirmaciones' })).toBeNull();
    expect(cargarResumen).not.toHaveBeenCalled();
    cleanup();
    await abrirCon(true);
    expect(await screen.findByRole('heading', { name: 'Panel de confirmaciones' })).toBeTruthy();
  });

  it('el pase solo aparece si voy', async () => {
    await abrirCon(false, true);
    expect(screen.getByTestId('pase').textContent).toContain('Ana Ruiz');
    cleanup();
    await abrirCon(false, false);
    expect(screen.queryByTestId('pase')).toBeNull();
  });
});
