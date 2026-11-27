// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PanelAdmin from './PanelAdmin';
import { cargarResumen, ErrorApi, excluirInvitado, readmitirInvitado } from './api';
import { BRUNO, CARLA, eventoDePrueba, resumenDePrueba, YO } from './fixtures';
import { notify } from '../../lib/notify';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  cargarResumen: vi.fn(),
  excluirInvitado: vi.fn(),
  readmitirInvitado: vi.fn(),
}));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar(onCambio = vi.fn(), version = 0) {
  return render(<PanelAdmin evento={eventoDePrueba()} version={version} yo={YO} onCambio={onCambio} />);
}

describe('PanelAdmin', () => {
  it('enseña los totales, los menús y la lista con quien no ha respondido', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    pintar();
    expect((await screen.findByTestId('cifra-van')).textContent).toContain('1');
    expect(screen.getByTestId('cifra-no-van').textContent).toContain('1');
    expect(screen.getByTestId('cifra-sin-responder').textContent).toContain('1');
    expect(screen.getByText(/Opción vegetariana:/)).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Carla Gómez' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Descargar Excel/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /No invitados/ })).toBeNull();
  });

  it('vuelve a pedir el resumen cuando cambia la versión', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    const onCambio = vi.fn();
    const { rerender } = pintar(onCambio, 0);
    await waitFor(() => expect(cargarResumen).toHaveBeenCalledTimes(1));
    rerender(<PanelAdmin evento={eventoDePrueba()} version={1} yo={YO} onCambio={onCambio} />);
    await waitFor(() => expect(cargarResumen).toHaveBeenCalledTimes(2));
  });

  it('si falla, ofrece reintentar', async () => {
    vi.mocked(cargarResumen).mockRejectedValueOnce(new Error('red')).mockResolvedValue(resumenDePrueba());
    pintar();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('cifra-van')).toBeTruthy();
  });

  it('Quitar saca a esa persona de la invitación, avisa y recarga', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    vi.mocked(excluirInvitado).mockResolvedValue();
    const onCambio = vi.fn();
    pintar(onCambio);
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar a Bruno Díaz de la invitación' }));
    await waitFor(() => expect(excluirInvitado).toHaveBeenCalledWith(BRUNO));
    await waitFor(() => expect(onCambio).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith('Bruno Díaz ya no está en la invitación.');
  });

  it('la fila de quien mira no tiene Quitar', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    pintar();
    await screen.findByTestId('cifra-van');
    expect(screen.queryByRole('button', { name: 'Quitar a Ana Ruiz de la invitación' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Quitar a / })).toHaveLength(2);
  });

  it('los no invitados salen aparte y se les puede volver a invitar', async () => {
    vi.mocked(cargarResumen).mockResolvedValue({ ...resumenDePrueba(), excluidos: [{ userId: CARLA, nombre: 'Carla Gómez' }] });
    vi.mocked(readmitirInvitado).mockResolvedValue();
    const onCambio = vi.fn();
    pintar(onCambio);
    expect(await screen.findByRole('heading', { name: /No invitados/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a invitar a Carla Gómez' }));
    await waitFor(() => expect(readmitirInvitado).toHaveBeenCalledWith(CARLA));
    await waitFor(() => expect(onCambio).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith('Carla Gómez vuelve a estar en la invitación.');
  });

  it('si Quitar falla, avisa del error y no recarga', async () => {
    vi.mocked(cargarResumen).mockResolvedValue(resumenDePrueba());
    vi.mocked(excluirInvitado).mockRejectedValue(new ErrorApi('exclusion_propia', 400));
    const onCambio = vi.fn();
    pintar(onCambio);
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar a Bruno Díaz de la invitación' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('No puedes quitarte a ti mismo de la invitación.', 'error'));
    expect(onCambio).not.toHaveBeenCalled();
  });
});
