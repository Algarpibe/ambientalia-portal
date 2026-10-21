// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Solicitud } from './api';
import TablaSolicitudes from './TablaSolicitudes';

// FE-418 — el enlace del adjunto hacía `void descargarAdjunto(...)` sin catch: si la
// descarga fallaba, la promesa rechazada quedaba sin manejar y la persona no veía nada.

const api = vi.hoisted(() => ({ descargarAdjunto: vi.fn() }));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

const solicitud: Solicitud = {
  id: 's1',
  tipo: 'incapacidad',
  empleadoId: 'e1',
  empleadoNombre: 'Ana Pérez',
  empleadoCargo: null,
  solicitanteEmail: 'ana@ejemplo.test',
  fechaInicio: '2026-11-02',
  fechaFin: '2026-11-03',
  diasHabiles: 2,
  horaInicio: null,
  horaFin: null,
  comentarios: null,
  observaciones: null,
  origen: 'portal',
  estado: 'pendiente',
  aprobadorCorreo: 'jefe@ejemplo.test',
  segundoAprobadorCorreo: null,
  informadoCorreo: null,
  copiaCorreo: null,
  primeraFirmaAt: null,
  decididaAt: null,
  motivoRechazo: null,
  createdAt: '2026-10-20T10:00:00Z',
  adjunto: { id: 'a1', nombreArchivo: 'incapacidad.pdf', mime: 'application/pdf', bytes: 1024 },
  modificacionPendiente: null,
  anuladaAt: null,
};

function pintar() {
  const onError = vi.fn();
  render(<TablaSolicitudes solicitudes={[solicitud]} vacio="" onError={onError} />);
  return onError;
}

afterEach(() => {
  cleanup();
  api.descargarAdjunto.mockReset();
});

describe('TablaSolicitudes · descarga del adjunto (FE-418)', () => {
  it('si la descarga falla, el error llega por onError con el nombre del fichero', async () => {
    const sinManejar = vi.fn();
    process.on('unhandledRejection', sinManejar);
    try {
      api.descargarAdjunto.mockRejectedValue(new Error('No se pudieron cargar los datos (error 404).'));
      const onError = pintar();
      fireEvent.click(screen.getByRole('button', { name: /incapacidad\.pdf/ }));
      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      const mensaje = onError.mock.calls[0][0] as string;
      expect(mensaje).toMatch(/incapacidad\.pdf/);
      expect(mensaje).toMatch(/error 404/);
      // Node emite `unhandledRejection` tras vaciar la cola de microtareas: un tick de
      // macrotarea basta para que, si la promesa quedara suelta, el espía lo viera.
      await new Promise((r) => setTimeout(r, 0));
      expect(sinManejar).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', sinManejar);
    }
  });

  it('mientras descarga, el enlace queda deshabilitado y no lanza una segunda descarga', async () => {
    let soltar!: () => void;
    api.descargarAdjunto.mockReturnValue(new Promise<void>((r) => { soltar = r; }));
    const onError = pintar();
    const enlace = screen.getByRole('button', { name: /incapacidad\.pdf/ });
    fireEvent.click(enlace);
    fireEvent.click(enlace);
    expect(api.descargarAdjunto).toHaveBeenCalledTimes(1);
    expect((enlace as HTMLButtonElement).disabled).toBe(true);
    soltar();
    await waitFor(() => expect((enlace as HTMLButtonElement).disabled).toBe(false));
    expect(onError).not.toHaveBeenCalled();
  });
});
