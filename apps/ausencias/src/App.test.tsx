// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Contexto, Solicitud } from './api';
import App from './App';

// FE-417 — «Sí, retirar» no tenía estado «en curso»: un doble clic lanzaba dos
// retiradas, la segunda contestaba 409 y la caja roja decía que había fallado una
// acción que ya se había aplicado.

const api = vi.hoisted(() => ({
  fetchContexto: vi.fn(),
  fetchMisSolicitudes: vi.fn(),
  retirarSolicitud: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));
// Pestañas montadas pero ocultas que no intervienen aquí: fuera, para no arrastrar
// sus propias llamadas a hub-api.
vi.mock('./FormularioSolicitud', () => ({ default: () => null }));
vi.mock('./Calendario', () => ({ default: () => null }));

const solicitud: Solicitud = {
  id: 's1',
  tipo: 'vacaciones',
  empleadoId: 'e1',
  empleadoNombre: 'Ana Pérez',
  empleadoCargo: null,
  solicitanteEmail: 'ana@ejemplo.test',
  fechaInicio: '2099-11-02',
  fechaFin: '2099-11-06',
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
};

// Solo lo que App lee para pintar «Mis solicitudes» de un empleado que no aprueba.
const contexto = {
  empleado: { id: 'e1', aprobadorCorreo: 'jefe@ejemplo.test' },
  aprobadorNombre: null,
  esVisorAdjuntos: false,
  esExportadorRegistro: false,
  esVisorDeTodaLaEmpresa: false,
  esVisorDeKpis: false,
  email: 'ana@ejemplo.test',
  esAdmin: false,
  esAprobador: false,
  festivos: [],
  saldo: null,
  compensatorios: null,
} as unknown as Contexto;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('App · retirar una solicitud propia (FE-417)', () => {
  it('«Sí, retirar» dos veces seguidas envía UNA petición y el botón queda deshabilitado', async () => {
    window.location.hash = '#mias';
    api.fetchContexto.mockResolvedValue(contexto);
    api.fetchMisSolicitudes.mockResolvedValue([solicitud]);
    let soltar!: (s: Solicitud) => void;
    api.retirarSolicitud.mockReturnValue(new Promise<Solicitud>((r) => { soltar = r; }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retirar' }));
    const confirmar = screen.getByRole('button', { name: /Sí, retirar|Retirando/ });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);

    expect(api.retirarSolicitud).toHaveBeenCalledTimes(1);
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);

    soltar({ ...solicitud, estado: 'rechazada', anuladaAt: '2026-10-21T10:00:00Z' });
    // Con la retirada aplicada la fila ya no admite retirarse: desaparece el botón.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sí, retirar|Retirando/ })).toBeNull());
  });
});
