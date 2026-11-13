// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { EmpleadoConJefatura } from './api';
import ImportarEmpleados from './ImportarEmpleados';

// La edición del cargo en la pestaña Empleados. Se simula `./api` entero salvo
// lo que el panel no toca, igual que PanelOrganigrama.test.tsx.

const api = vi.hoisted(() => ({
  fetchEmpleados: vi.fn(),
  fetchRetirados: vi.fn(),
  fijarRetiro: vi.fn(),
  reactivarEmpleado: vi.fn(),
  sincronizarEmpleados: vi.fn(),
  fijarCargo: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

const ficha = (id: string, nombreCompleto: string, cargo: string | null): EmpleadoConJefatura => ({
  id,
  nombreCompleto,
  correo: `${id}@ejemplo.test`,
  cargo,
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
});

const ana = ficha('e1', 'Ana Pérez', 'Analista');
const luis = ficha('e2', 'Luis Gómez', null);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const lapiz = (nombre: string) => screen.getByLabelText(`Editar el cargo de ${nombre}`) as HTMLButtonElement;
const campo = (nombre: string) => screen.getByLabelText(`Cargo de ${nombre}`) as HTMLInputElement;
const sinCampo = (nombre: string) => screen.queryByLabelText(`Cargo de ${nombre}`);

async function montar(fichas: EmpleadoConJefatura[]) {
  api.fetchEmpleados.mockResolvedValue(fichas);
  render(<ImportarEmpleados />);
  await waitFor(() => expect(lapiz(fichas[0].nombreCompleto)).toBeTruthy());
}

describe('editar el cargo', () => {
  it('el lápiz abre el campo con el cargo actual', async () => {
    await montar([ana]);
    fireEvent.click(lapiz('Ana Pérez'));
    expect(campo('Ana Pérez').value).toBe('Analista');
    expect(document.activeElement).toBe(campo('Ana Pérez'));
  });

  it('sin cargo, la celda dice «—» y el campo abre vacío', async () => {
    await montar([luis]);
    expect(screen.getByText('—')).toBeTruthy();
    fireEvent.click(lapiz('Luis Gómez'));
    expect(campo('Luis Gómez').value).toBe('');
  });

  it('Enter guarda lo tecleado, cierra el campo, avisa y recarga la lista', async () => {
    await montar([ana]);
    api.fijarCargo.mockResolvedValue({ ...ana, cargo: 'Jefa de taller' });
    api.fetchEmpleados.mockResolvedValue([{ ...ana, cargo: 'Jefa de taller' }]);

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Cargo de Ana Pérez actualizado.')).toBeTruthy());
    expect(api.fijarCargo).toHaveBeenCalledWith('e1', 'Jefa de taller');
    expect(sinCampo('Ana Pérez')).toBeNull();
    // La recarga sale de un efecto (`recarga` en sus dependencias): se espera,
    // no se da por hecha en el mismo tick que el aviso.
    await waitFor(() => expect(api.fetchEmpleados).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Jefa de taller')).toBeTruthy());
  });

  it('el botón Guardar hace lo mismo que Enter', async () => {
    await montar([ana]);
    api.fijarCargo.mockResolvedValue({ ...ana, cargo: 'Jefa de taller' });

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.click(screen.getByLabelText('Guardar el cargo de Ana Pérez'));

    await waitFor(() => expect(api.fijarCargo).toHaveBeenCalledWith('e1', 'Jefa de taller'));
  });

  it('el texto vacío se manda tal cual: el servidor lo convierte en «sin cargo»', async () => {
    await montar([ana]);
    api.fijarCargo.mockResolvedValue({ ...ana, cargo: null });

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: '' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });

    await waitFor(() => expect(api.fijarCargo).toHaveBeenCalledWith('e1', ''));
  });

  it('Esc cancela sin llamar al servidor', async () => {
    await montar([ana]);
    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Otra cosa' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Escape' });

    expect(sinCampo('Ana Pérez')).toBeNull();
    expect(screen.getByText('Analista')).toBeTruthy();
    expect(api.fijarCargo).not.toHaveBeenCalled();
  });

  it('Cancelar cierra sin guardar', async () => {
    await montar([ana]);
    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.click(screen.getByLabelText('Cancelar la edición del cargo de Ana Pérez'));

    expect(sinCampo('Ana Pérez')).toBeNull();
    expect(api.fijarCargo).not.toHaveBeenCalled();
  });

  it('una fila a la vez: abrir otra cierra la primera sin guardarla', async () => {
    await montar([ana, luis]);
    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'A medias' } });
    fireEvent.click(lapiz('Luis Gómez'));

    expect(sinCampo('Ana Pérez')).toBeNull();
    expect(campo('Luis Gómez').value).toBe('');
    expect(api.fijarCargo).not.toHaveBeenCalled();
  });

  it('mientras se guarda: no se abre otra fila, ni se cancela la que se está guardando', async () => {
    await montar([ana, luis]);
    let terminar!: (f: EmpleadoConJefatura) => void;
    api.fijarCargo.mockReturnValue(
      new Promise<EmpleadoConJefatura>((r) => {
        terminar = r;
      }),
    );

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });

    // Si el lápiz de Luis se pudiera abrir ahora, un fallo del guardado de Ana
    // saldría junto a la edición de Luis, y el mensaje no dice de quién es.
    await waitFor(() => expect(lapiz('Luis Gómez').disabled).toBe(true));
    const cancelar = screen.getByLabelText('Cancelar la edición del cargo de Ana Pérez') as HTMLButtonElement;
    expect(cancelar.disabled).toBe(true);
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Escape' });
    expect(campo('Ana Pérez').value).toBe('Jefa de taller');
    // Lo que se teclease ahora no viajaría (ya se mandó el texto del Enter) y el
    // aviso diría «actualizado» igualmente: el campo no admite cambios.
    expect(campo('Ana Pérez').readOnly).toBe(true);

    terminar({ ...ana, cargo: 'Jefa de taller' });
    await waitFor(() => expect(lapiz('Luis Gómez').disabled).toBe(false));
  });

  it('si deshacer la baja de otra fila termina antes, el final del guardado no cierra la edición de otra persona', async () => {
    const marta = { ...ficha('e3', 'Marta Ruiz', 'Técnica'), fechaRetiro: '2099-12-31' };
    await montar([ana, luis, marta]);
    let terminar!: (f: EmpleadoConJefatura) => void;
    api.fijarCargo.mockReturnValue(
      new Promise<EmpleadoConJefatura>((r) => {
        terminar = r;
      }),
    );
    api.reactivarEmpleado.mockResolvedValue(undefined);

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });
    await waitFor(() => expect(lapiz('Luis Gómez').disabled).toBe(true));

    // Deshacer la baja de Marta («Quitar») comparte `guardando`: al terminar
    // libera los lápices aunque el guardado de Ana siga en vuelo.
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    await waitFor(() => expect(lapiz('Luis Gómez').disabled).toBe(false));
    fireEvent.click(lapiz('Luis Gómez'));
    fireEvent.change(campo('Luis Gómez'), { target: { value: 'A medias' } });

    terminar({ ...ana, cargo: 'Jefa de taller' });
    await waitFor(() => expect(api.fijarCargo).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Cargo de Ana Pérez actualizado.')).toBeTruthy());
    expect(campo('Luis Gómez').value).toBe('A medias');
  });

  it('si falla, enseña el error y deja la edición abierta con lo tecleado', async () => {
    await montar([ana]);
    api.fijarCargo.mockRejectedValue(new Error('Esa ficha ya no está activa. Recarga la lista.'));

    fireEvent.click(lapiz('Ana Pérez'));
    fireEvent.change(campo('Ana Pérez'), { target: { value: 'Jefa de taller' } });
    fireEvent.keyDown(campo('Ana Pérez'), { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Esa ficha ya no está activa. Recarga la lista.')).toBeTruthy());
    expect(campo('Ana Pérez').value).toBe('Jefa de taller');
    expect(api.fetchEmpleados).toHaveBeenCalledTimes(1);
    // `setGuardando(null)` va en el `finally`: tras un fallo se puede reintentar.
    expect((screen.getByLabelText('Guardar el cargo de Ana Pérez') as HTMLButtonElement).disabled).toBe(false);
  });
});
