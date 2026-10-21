// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { EmpleadoConJefatura } from './api';
import PanelOrganigrama from './PanelOrganigrama';

// FE-416 — Guardar una fila lanza hasta siete PUT seguidos, uno por campo cambiado,
// sin transacción común. Si falla uno a mitad, los anteriores YA están guardados;
// la pantalla, en cambio, seguía con la foto de antes y presentaba todo como
// pendiente, sin decir qué había entrado y qué no.

const api = vi.hoisted(() => ({
  fetchEmpleados: vi.fn(),
  fijarJefe: vi.fn(),
  fijarCopia: vi.fn(),
  fijarVisor: vi.fn(),
  fijarExportador: vi.fn(),
  fijarVisorDeEmpresa: vi.fn(),
  fijarVisorDeKpis: vi.fn(),
  fijarSegundaFirma: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

const ana: EmpleadoConJefatura = {
  id: 'e1',
  nombreCompleto: 'Ana Pérez',
  correo: 'ana@ejemplo.test',
  cargo: null,
  credencial: null,
  aprobadorCorreo: 'jefe@ejemplo.test',
  copiaCorreo: null,
  veAdjuntos: false,
  exportaRegistro: false,
  veTodaLaEmpresa: false,
  veKpis: false,
  requiereSegundaFirma: true,
  userId: null,
  activo: true,
  fechaRetiro: null,
  retiradoPor: null,
  retiradoAt: null,
  segundoAprobadorCorreo: null,
  informadoCorreo: null,
  enCiclo: false,
  esAdminDelPortal: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const soportes = () => screen.getByLabelText(/^Todos: Ana Pérez/) as HTMLInputElement;
const kpis = () => screen.getByLabelText(/^KPIs: Ana Pérez/) as HTMLInputElement;
const guardar = () => screen.getByLabelText('Guardar la fila de Ana Pérez') as HTMLButtonElement;

describe('PanelOrganigrama: un guardado que falla a mitad (FE-416)', () => {
  it('relee el maestro, deja pendiente solo lo que no entró y dice qué falló', async () => {
    // El primer PUT (Soportes) entra; el segundo (KPIs) falla.
    api.fetchEmpleados
      .mockResolvedValueOnce([ana])
      .mockResolvedValue([{ ...ana, veAdjuntos: true }]);
    api.fijarVisor.mockResolvedValue({});
    api.fijarVisorDeKpis.mockRejectedValue(new Error('Error del servidor'));

    render(<PanelOrganigrama activo />);
    await waitFor(() => expect(soportes()).toBeTruthy());

    fireEvent.click(soportes());
    fireEvent.click(kpis());
    fireEvent.click(guardar());

    // Se dice cuál falló y que lo anterior sí quedó guardado.
    await waitFor(() => expect(screen.getByText(/KPIs/, { selector: '[role="alert"]' })).toBeTruthy());
    const aviso = screen.getByRole('alert').textContent ?? '';
    expect(aviso).toContain('Error del servidor');
    expect(aviso).toMatch(/anteriores sí se guardaron/);

    // Se releyó el maestro: la pantalla ya sabe que Soportes está guardado.
    expect(api.fetchEmpleados).toHaveBeenCalledTimes(2);
    // Lo que el usuario marcó se conserva, y la fila sigue con algo pendiente.
    expect(soportes().checked).toBe(true);
    expect(kpis().checked).toBe(true);
    expect(guardar().disabled).toBe(false);

    // Reintentar manda SOLO lo que falta: Soportes ya coincide con el servidor.
    api.fijarVisorDeKpis.mockResolvedValue({});
    api.fetchEmpleados.mockResolvedValue([{ ...ana, veAdjuntos: true, veKpis: true }]);
    fireEvent.click(guardar());
    await waitFor(() => expect(api.fijarVisorDeKpis).toHaveBeenCalledTimes(2));
    expect(api.fijarVisor).toHaveBeenCalledTimes(1);
  });

  it('si falla el primero, no afirma que se guardara nada', async () => {
    api.fetchEmpleados.mockResolvedValue([ana]);
    api.fijarVisor.mockRejectedValue(new Error('Error del servidor'));

    render(<PanelOrganigrama activo />);
    await waitFor(() => expect(soportes()).toBeTruthy());

    fireEvent.click(soportes());
    fireEvent.click(guardar());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Error del servidor'));
    expect(screen.getByRole('alert').textContent).not.toMatch(/anteriores sí se guardaron/);
    expect(soportes().checked).toBe(true);
    expect(guardar().disabled).toBe(false);
  });
});
