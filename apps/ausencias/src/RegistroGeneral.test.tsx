// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import type { Empleado, Movimiento } from './api';
import RegistroGeneral from './RegistroGeneral';

// El Registro general del administrador que registra una incapacidad a nombre
// de otro, y la etiqueta que deja esa constancia en la fila. Se simula `./api`
// entero salvo lo que la pantalla no toca, igual que PanelOrganigrama.test.tsx.

const api = vi.hoisted(() => ({
  fetchMovimientos: vi.fn(),
  fetchEmpleados: vi.fn(),
  registrarIncapacidadAjena: vi.fn(),
  leerComoBase64: vi.fn(),
  fetchSolicitud: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

type MovimientoDeSolicitud = Extract<Movimiento, { clase: 'solicitud' }>;

const ADMIN = 'admin@ejemplo.test';

const fila = (over: Partial<MovimientoDeSolicitud> = {}): MovimientoDeSolicitud => ({
  clase: 'solicitud',
  estado: 'registrada',
  id: 's1',
  solicitudId: 's1',
  empleadoNombre: 'Ana Pérez',
  empleadoCargo: null,
  solicitanteEmail: 'ana@ejemplo.test',
  tipo: 'incapacidad',
  fechaInicio: '2025-03-03',
  fechaFin: '2025-03-05',
  horaInicio: null,
  horaFin: null,
  diasHabiles: 3,
  decididaAt: null,
  decididaPor: null,
  createdAt: '2025-03-06T10:00:00Z',
  motivo: null,
  anuladaAt: null,
  observaciones: null,
  registradaPor: null,
  ...over,
});

const ana: Empleado = {
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
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function montar(esAdmin: boolean, movimientos: Movimiento[] = [fila()]) {
  api.fetchMovimientos.mockResolvedValue(movimientos);
  api.fetchEmpleados.mockResolvedValue([ana]);
  render(<RegistroGeneral recargarToken={0} festivos={new Set()} esAdmin={esAdmin} puedeExportar={false} />);
  await waitFor(() => expect(screen.queryByText('Cargando…')).toBeNull());
}

const boton = () => screen.queryByRole('button', { name: 'Registrar incapacidad' });

/** Abre el formulario y lo rellena entero. Dentro del diálogo: la barra de filtros tiene otro «Persona». */
function abrirYRellenar(): HTMLElement {
  fireEvent.click(boton()!);
  const dialogo = screen.getByRole('dialog', { name: 'Registrar incapacidad' });
  const w = within(dialogo);
  fireEvent.change(w.getByLabelText('Persona'), { target: { value: 'e1' } });
  fireEvent.change(w.getByLabelText('Primer día de la incapacidad'), { target: { value: '2025-03-03' } });
  fireEvent.change(w.getByLabelText('Último día de la incapacidad'), { target: { value: '2025-03-05' } });
  fireEvent.change(w.getByLabelText(/Soporte médico en PDF/), {
    target: { files: [new File(['%PDF-1.4'], 'baja.pdf', { type: 'application/pdf' })] },
  });
  return dialogo;
}

describe('Registrar incapacidad desde el Registro general', () => {
  it('quien no es admin no ve el botón (ni se le piden las fichas)', async () => {
    await montar(false);
    expect(boton()).toBeNull();
    expect(api.fetchEmpleados).not.toHaveBeenCalled();
  });

  it('si las fichas no cargan, tampoco hay botón: el desplegable abriría vacío', async () => {
    // La barra de filtros se pinta igual tras una carga fallida (basta
    // `!cargando`), y `empleados` se queda en []. Es lo que muerde la guarda
    // `empleados.length > 0`: quitar `esAdmin` no lo vería ningún test, porque a
    // quien no es admin nunca se le piden las fichas.
    api.fetchMovimientos.mockResolvedValue([fila()]);
    api.fetchEmpleados.mockRejectedValue(new Error('No se pudieron cargar los datos (error 500).'));
    render(<RegistroGeneral recargarToken={0} festivos={new Set()} esAdmin puedeExportar={false} />);
    await waitFor(() => expect(screen.getByText(/error 500/)).toBeTruthy());
    expect(boton()).toBeNull();
  });

  it('el admin lo ve, y abre el formulario', async () => {
    await montar(true);
    fireEvent.click(boton()!);
    expect(screen.getByRole('dialog', { name: 'Registrar incapacidad' })).toBeTruthy();
  });

  it('Cancelar cierra sin guardar', async () => {
    await montar(true);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.registrarIncapacidadAjena).not.toHaveBeenCalled();
  });

  it('al guardar bien: cierra, avisa en verde con el nombre y recarga el registro', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockResolvedValue({ id: 's9', empleadoNombre: 'Ana Pérez' });
    await montar(true);
    // La recarga trae la fila nueva, con su etiqueta: es lo que el admin tiene
    // que ver aparecer, no solo que se llamó dos veces al servidor.
    api.fetchMovimientos.mockResolvedValueOnce([
      fila(),
      fila({ id: 's9', solicitudId: 's9', empleadoNombre: 'Marta Ruiz', registradaPor: ADMIN }),
    ]);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(screen.getByText('Incapacidad de Ana Pérez registrada. Le hemos enviado el acuse por correo.')).toBeTruthy(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    // La recarga sale de un efecto (`recargaLocal` en sus dependencias): se
    // espera, no se da por hecha en el mismo tick que el aviso.
    await waitFor(() => expect(api.fetchMovimientos).toHaveBeenCalledTimes(2));
    // El nombre sale más de una vez (fila y chips por persona): basta con que esté.
    await waitFor(() => expect(screen.getAllByText('Marta Ruiz').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Registrada por administración')).toHaveLength(1);
  });

  it('el aviso va en una región viva (status) para que un lector de pantalla lo anuncie', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockResolvedValue({ id: 's9', empleadoNombre: 'Ana Pérez' });
    await montar(true);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Incapacidad de Ana Pérez registrada/));
  });

  async function registrarBien(movimientos: Movimiento[] = [fila()]) {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockResolvedValue({ id: 's9', empleadoNombre: 'Ana Pérez' });
    await montar(true, movimientos);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(screen.getByText(/Le hemos enviado el acuse/)).toBeTruthy());
  }

  it('al reabrir el formulario el aviso anterior desaparece', async () => {
    await registrarBien();
    fireEvent.click(boton()!);
    expect(screen.queryByText(/Le hemos enviado el acuse/)).toBeNull();
  });

  it('al empezar a editar otra fila el aviso verde desaparece (no se queda colgado)', async () => {
    api.fetchSolicitud.mockReturnValue(new Promise(() => {}));
    await registrarBien();
    fireEvent.click(screen.getAllByRole('button', { name: /^Editar/ })[0]);
    expect(screen.queryByText(/Le hemos enviado el acuse/)).toBeNull();
  });

  it('al empezar a editar una MODIFICACIÓN el aviso verde también desaparece', async () => {
    const cambio: Movimiento = {
      ...fila(),
      clase: 'fechas',
      estado: 'aprobada',
      id: 'm1',
      solicitudId: 's1',
      motivo: 'Cambio de fechas',
    };
    await registrarBien([cambio]);
    fireEvent.click(screen.getAllByRole('button', { name: /^Editar el cambio de fechas/ })[0]);
    expect(screen.queryByText(/Le hemos enviado el acuse/)).toBeNull();
  });

  it('al borrar una fila el aviso verde desaparece', async () => {
    api.fetchSolicitud.mockReturnValue(new Promise(() => {}));
    await registrarBien();
    fireEvent.click(screen.getAllByRole('button', { name: /^Borrar/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }));
    expect(screen.queryByText(/Le hemos enviado el acuse/)).toBeNull();
  });

  it('si falla: el mensaje, el formulario sigue abierto con lo rellenado, y no recarga', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockRejectedValue(new Error('Esa ficha ya no está activa. Recarga la lista.'));
    await montar(true);
    const dialogo = abrirYRellenar();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(within(dialogo).getByRole('alert').textContent).toContain('Esa ficha ya no está activa.'));
    expect(screen.getByRole('dialog')).toBe(dialogo);
    expect((within(dialogo).getByLabelText('Persona') as HTMLSelectElement).value).toBe('e1');
    expect(screen.queryByText(/Le hemos enviado el acuse/)).toBeNull();
    expect(api.fetchMovimientos).toHaveBeenCalledTimes(1);
  });
});

describe('la etiqueta «Registrada por administración»', () => {
  const movimientos = [
    fila({ id: 's1', solicitudId: 's1', registradaPor: ADMIN }),
    fila({ id: 's2', solicitudId: 's2', empleadoNombre: 'Luis Gómez', registradaPor: null }),
  ];

  it.each([true, false])('sale solo en la fila que la lleva, con el correo en el title (esAdmin=%s)', async (esAdmin) => {
    // Igual para el admin y para los jefes que ven esa fila.
    await montar(esAdmin, movimientos);
    const etiquetas = screen.getAllByText('Registrada por administración');
    expect(etiquetas).toHaveLength(1);
    expect(etiquetas[0].getAttribute('title')).toBe(ADMIN);
  });
});
