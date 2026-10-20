// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { SolicitudPendiente } from './api';
import BandejaAprobacion from './BandejaAprobacion';

// FE-413 — decidir una solicitud que otro ya había firmado pintaba el código
// crudo de hub-api (`ya_decidida`) en la caja roja, porque `decidir` pasaba
// `e.message` tal cual mientras `decidirCambio` ya lo traducía.

const api = vi.hoisted(() => ({ decidirSolicitud: vi.fn() }));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

const solicitud: SolicitudPendiente = {
  id: 's1',
  tipo: 'vacaciones',
  empleadoId: 'e1',
  empleadoNombre: 'Ana Pérez',
  empleadoCargo: null,
  solicitanteEmail: 'ana@ejemplo.test',
  fechaInicio: '2026-11-02',
  fechaFin: '2026-11-06',
  diasHabiles: 5,
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
  adjunto: null,
  modificacionPendiente: null,
  anuladaAt: null,
  esMiTurno: true,
};

function pintar() {
  const onError = vi.fn();
  render(
    <BandejaAprobacion
      solicitudes={[solicitud]}
      cambios={[]}
      saldos={[]}
      email="jefe@ejemplo.test"
      onDecidida={vi.fn()}
      onCambioDecidido={vi.fn()}
      onError={onError}
    />,
  );
  return onError;
}

afterEach(() => {
  cleanup();
  api.decidirSolicitud.mockReset();
});

describe('BandejaAprobacion · decidir una solicitud', () => {
  it.each([
    ['ya_decidida', /ya estaba decidida/],
    ['motivo_demasiado_largo', /motivo es demasiado largo/],
    ['aprueba_requerido', /No se pudo registrar la decisión/],
  ])('un %s de hub-api llega traducido, no como código', async (codigo, texto) => {
    api.decidirSolicitud.mockRejectedValue(new Error(codigo));
    const onError = pintar();
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const mensaje = onError.mock.calls[0][0] as string;
    expect(mensaje).not.toBe(codigo);
    expect(mensaje).toMatch(texto);
  });

  it('lo que ya llega redactado (un 403 de mensajeDeError, un fallo de red) pasa tal cual', async () => {
    const redactado = 'No tienes esta aplicación asignada. Pide acceso a un administrador del portal.';
    api.decidirSolicitud.mockRejectedValue(new Error(redactado));
    const onError = pintar();
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(redactado));
  });
});
