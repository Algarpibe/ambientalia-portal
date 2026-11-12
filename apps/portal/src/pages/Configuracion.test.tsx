// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Configuracion from './Configuracion';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';

const rol = vi.hoisted(() => ({ actual: 'admin' }));
const llavesApi = vi.hoisted(() => ({ llaves: vi.fn(), guardarLlaves: vi.fn(), ajustesTablero: vi.fn(), kioscos: vi.fn() }));

vi.mock('../lib/api', () => ({ authFetch: vi.fn() }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
// El cliente de la sub-app (hub-api) se sustituye: aquí solo importa quién ve la sección.
vi.mock('../../../equipos-taller/src/api', () => ({ apiEquipos: () => llavesApi }));
vi.mock('../hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u', full_name: 'Alfonso García', email: 'comercial@x.com', role: rol.actual, status: 'active', created_at: '2026-03-12T00:00:00.000Z', avatar: null },
    loading: false,
    reload: vi.fn(),
  }),
  notifyProfileUpdated: vi.fn(),
}));

const mockFetch = authFetch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rol.actual = 'admin';
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  llavesApi.ajustesTablero.mockResolvedValue({ umbralAmbar: 30, umbralRojo: 90, nocheDesde: 18, nocheHasta: 6, kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo', 'entregado'], temaTv: 'dia' });
  llavesApi.kioscos.mockResolvedValue([{ id: 'k1', nombre: 'TV Prueba', creadoPor: 'a@x.co', creadoEn: '2026-11-10T15:00:00Z', revocadoEn: null, ultimoUsoEn: null }]);
  llavesApi.llaves.mockResolvedValue([
    { userId: 'u1', nombre: 'Persona Uno', email: 'p1@x.co', esAdmin: false, editaAjustes: false, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Configuración', () => {
  it('muestra el perfil (nombre, email, rol, miembro desde)', () => {
    render(<Configuracion />);
    expect((screen.getByDisplayValue('Alfonso García') as HTMLInputElement)).toBeTruthy();
    expect(screen.getByDisplayValue('comercial@x.com')).toBeTruthy();
    expect(screen.getByText('Administrador')).toBeTruthy();
    expect(screen.getByText(/marzo de 2026/i)).toBeTruthy();
  });

  it('un administrador ve la sección de frecuencia de correos de Carga de Pedidos WO', async () => {
    render(<Configuracion />);
    expect(screen.getByText(/Frecuencia de correos/i)).toBeTruthy();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/wo-sales/email/frecuencias'));
  });

  it('un administrador ve la sección «Equipos en taller · Llaves» con la lista cargada', async () => {
    render(<Configuracion />);
    expect(screen.getByRole('heading', { name: 'Equipos en taller · Llaves' })).toBeTruthy();
    expect(await screen.findByRole('checkbox', { name: 'Edita ajustes: Persona Uno' })).toBeTruthy();
    expect(llavesApi.llaves).toHaveBeenCalled();
  });

  it('las llaves se guardan con el botón «Guardar» de cada fila y se avisa con las notificaciones del portal', async () => {
    llavesApi.guardarLlaves.mockImplementation(async (userId: string, l: object) => ({
      userId, nombre: 'Persona Uno', email: 'p1@x.co', esAdmin: false, actualizadoPor: null, actualizadoEn: null, ...l,
    }));
    render(<Configuracion />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Recibe alertas: Persona Uno' }));
    expect(llavesApi.guardarLlaves).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar llaves de Persona Uno' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Llaves de Persona Uno guardadas.', 'info'));
    expect(llavesApi.guardarLlaves).toHaveBeenCalledWith('u1', { editaAjustes: false, recibeAlertas: true });
  });

  it('un administrador ve las secciones «Equipos en taller · Tablero» y «Equipos en taller · Kiosco» con sus datos', async () => {
    render(<Configuracion />);
    expect(screen.getByRole('heading', { name: 'Equipos en taller · Tablero' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Equipos en taller · Kiosco' })).toBeTruthy();
    expect(await screen.findByLabelText('Umbral ámbar (días)')).toBeTruthy();
    expect(await screen.findByText('TV Prueba')).toBeTruthy();
  });

  it('quien no es administrador no ve la sección ni pide las llaves', () => {
    rol.actual = 'viewer';
    render(<Configuracion />);
    expect(screen.queryByText('Equipos en taller · Llaves')).toBeNull();
    expect(llavesApi.llaves).not.toHaveBeenCalled();
    expect(screen.queryByText('Equipos en taller · Tablero')).toBeNull();
    expect(llavesApi.ajustesTablero).not.toHaveBeenCalled();
    expect(llavesApi.kioscos).not.toHaveBeenCalled();
  });

  // El nombre se fija en el registro: es con el que se firman las aprobaciones.
  it('el nombre completo se muestra pero no se edita', () => {
    render(<Configuracion />);
    expect((screen.getByDisplayValue('Alfonso García') as HTMLInputElement).readOnly).toBe(true);
    // Se fue el botón que lo guardaba; el de contraseña sigue en su sitio.
    // (Por su nombre accesible: los «Guardar» de las llaves se llaman «Guardar llaves de …».)
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull();
    expect(screen.getByText('Actualizar Contraseña')).toBeTruthy();
  });

  it('no llama a PATCH /me/profile en ningún caso', () => {
    render(<Configuracion />);
    expect(mockFetch).not.toHaveBeenCalledWith('/api/users/me/profile', expect.anything());
  });

  it('contraseñas que no coinciden → notifica error y no llama al endpoint', () => {
    render(<Configuracion />);
    fireEvent.change(screen.getByPlaceholderText('Tu contraseña actual'), { target: { value: 'actual123' } });
    fireEvent.change(screen.getByPlaceholderText(/Mínimo/i), { target: { value: 'nuevapass1' } });
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'distinta99' } });
    fireEvent.click(screen.getByText('Actualizar Contraseña'));
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/no coinciden/i), 'error');
    expect(mockFetch).not.toHaveBeenCalledWith('/api/users/me/password', expect.anything());
  });

  it('contraseña válida → PATCH /me/password', async () => {
    render(<Configuracion />);
    fireEvent.change(screen.getByPlaceholderText('Tu contraseña actual'), { target: { value: 'actual123' } });
    fireEvent.change(screen.getByPlaceholderText(/Mínimo/i), { target: { value: 'nuevapass1' } });
    fireEvent.change(screen.getByPlaceholderText('Repite la nueva contraseña'), { target: { value: 'nuevapass1' } });
    fireEvent.click(screen.getByText('Actualizar Contraseña'));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('/api/users/me/password', expect.objectContaining({ method: 'PATCH' })),
    );
  });

  // FE-419 — las <label> de la página no estaban asociadas a sus campos: el
  // lector de pantalla anunciaba «campo de edición» sin decir cuál.
  it('cada campo del perfil y de seguridad se alcanza por su etiqueta', () => {
    render(<Configuracion />);
    expect((screen.getByLabelText('Nombre Completo') as HTMLInputElement).value).toBe('Alfonso García');
    expect((screen.getByLabelText('Correo Electrónico') as HTMLInputElement).value).toBe('comercial@x.com');
    expect(screen.getByLabelText('Contraseña Actual')).toBe(screen.getByPlaceholderText('Tu contraseña actual'));
    expect(screen.getByLabelText('Nueva Contraseña')).toBe(screen.getByPlaceholderText(/Mínimo/i));
    expect(screen.getByLabelText('Confirmar Contraseña')).toBe(screen.getByPlaceholderText('Repite la nueva contraseña'));
  });

  it('el ojo de las contraseñas dice qué hará y refleja su estado', () => {
    render(<Configuracion />);
    const mostrar = screen.getAllByRole('button', { name: 'Mostrar contraseñas' });
    expect(mostrar).toHaveLength(3);
    expect(mostrar[0].getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mostrar[0]);
    const ocultar = screen.getAllByRole('button', { name: 'Ocultar contraseñas' });
    expect(ocultar[0].getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Nueva Contraseña') as HTMLInputElement).type).toBe('text');
  });
});
