// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Empleado, Solicitud } from './api';
import { hoyEnColombia } from './dominio';
import RegistrarIncapacidad from './RegistrarIncapacidad';

// El formulario con el que el administrador registra una incapacidad a nombre de
// otro. Se simula `./api` entero salvo lo que el formulario no toca, igual que
// PanelOrganigrama.test.tsx. `leerComoBase64` también: el FileReader de jsdom no
// es lo que se prueba aquí.

const api = vi.hoisted(() => ({
  registrarIncapacidadAjena: vi.fn(),
  leerComoBase64: vi.fn(),
}));
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), ...api }));

const ficha = (id: string, nombreCompleto: string, activo = true): Empleado => ({
  id,
  nombreCompleto,
  correo: `${id}@ejemplo.test`,
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
  activo,
  fechaRetiro: null,
  retiradoPor: null,
  retiradoAt: null,
});

// En desorden a propósito, con una tilde inicial y una ficha inactiva: un
// `sort()` a secas dejaría «Álvaro» detrás de «Zoe».
const EMPLEADOS = [
  ficha('e3', 'Zoe Díaz'),
  ficha('e2', 'Beatriz Mora'),
  ficha('e1', 'Álvaro Gómez'),
  ficha('e4', 'Carlos Retirado', false),
];

const onRegistrada = vi.fn();
const onCerrar = vi.fn();

afterEach(() => {
  cleanup();
  // `reset` y no `clear`: así ninguna implementación simulada pasa de un test al siguiente.
  vi.resetAllMocks();
});

const montar = () =>
  render(<RegistrarIncapacidad empleados={EMPLEADOS} onRegistrada={onRegistrada} onCerrar={onCerrar} />);

const persona = () => screen.getByLabelText('Persona') as HTMLSelectElement;
const inicio = () => screen.getByLabelText('Primer día de la incapacidad') as HTMLInputElement;
const fin = () => screen.getByLabelText('Último día de la incapacidad') as HTMLInputElement;
const soporte = () => screen.getByLabelText(/Soporte médico en PDF/) as HTMLInputElement;
const comentarios = () => screen.getByLabelText('Comentarios (opcional)') as HTMLTextAreaElement;
const guardar = () => screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement;

const pdf = () => new File(['%PDF-1.4'], 'baja.pdf', { type: 'application/pdf' });

/** Todo lo obligatorio, con fechas pasadas (marzo de 2025, sin festivos). */
function rellenar() {
  fireEvent.change(persona(), { target: { value: 'e1' } });
  fireEvent.change(inicio(), { target: { value: '2025-03-03' } });
  fireEvent.change(fin(), { target: { value: '2025-03-05' } });
  fireEvent.change(soporte(), { target: { files: [pdf()] } });
}

describe('RegistrarIncapacidad', () => {
  it('el desplegable: «— Elige una persona —» primero, solo las activas y por orden alfabético en español', () => {
    montar();
    expect(Array.from(persona().options).map((o) => [o.value, o.textContent])).toEqual([
      ['', '— Elige una persona —'],
      ['e1', 'Álvaro Gómez'],
      ['e2', 'Beatriz Mora'],
      ['e3', 'Zoe Díaz'],
    ]);
    expect(persona().value).toBe('');
  });

  it('Guardar sigue apagado mientras falte algo obligatorio, y se enciende con todo', () => {
    montar();
    expect(guardar().disabled).toBe(true);
    fireEvent.change(persona(), { target: { value: 'e1' } });
    fireEvent.change(inicio(), { target: { value: '2025-03-03' } });
    fireEvent.change(fin(), { target: { value: '2025-03-05' } });
    // Sin el PDF todavía: es obligatorio.
    expect(guardar().disabled).toBe(true);
    fireEvent.change(soporte(), { target: { files: [pdf()] } });
    expect(guardar().disabled).toBe(false);
  });

  it('el PDF: un archivo que no lo es se rechaza, con su aviso, y Guardar sigue apagado', () => {
    montar();
    rellenar();
    fireEvent.change(soporte(), { target: { files: [new File(['x'], 'foto.png', { type: 'image/png' })] } });
    expect(screen.getByRole('alert').textContent).toContain('El soporte debe ser un archivo PDF.');
    expect(guardar().disabled).toBe(true);
  });

  it('el PDF: más de 8 MB se rechaza', () => {
    montar();
    rellenar();
    const grande = pdf();
    Object.defineProperty(grande, 'size', { value: 9 * 1024 * 1024 });
    fireEvent.change(soporte(), { target: { files: [grande] } });
    expect(screen.getByRole('alert').textContent).toContain('El archivo pesa 9.0 MB y el máximo son 8 MB.');
    expect(guardar().disabled).toBe(true);
  });

  it('el inicio: max = hoy y sin min; una fecha futura deja Guardar apagado', () => {
    montar();
    expect(inicio().max).toBe(hoyEnColombia());
    expect(inicio().hasAttribute('min')).toBe(false);
    rellenar();
    fireEvent.change(inicio(), { target: { value: '2999-01-04' } });
    fireEvent.change(fin(), { target: { value: '2999-01-05' } });
    expect(screen.getByText('La fecha de inicio no puede ser futura.')).toBeTruthy();
    expect(guardar().disabled).toBe(true);
  });

  it('el fin: no puede ser anterior al inicio', () => {
    montar();
    rellenar();
    expect(fin().min).toBe('2025-03-03');
    fireEvent.change(fin(), { target: { value: '2025-03-02' } });
    expect(screen.getByText('El último día no puede ser anterior al primero.')).toBeTruthy();
    expect(guardar().disabled).toBe(true);
  });

  it('guardar bien: manda los datos, con los comentarios recortados, y entrega la solicitud creada', async () => {
    const creada = { id: 's9', empleadoNombre: 'Álvaro Gómez' } as Solicitud;
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockResolvedValue(creada);
    montar();
    rellenar();
    fireEvent.change(comentarios(), { target: { value: '  Avisó su hermana  ' } });
    fireEvent.click(guardar());

    await waitFor(() => expect(onRegistrada).toHaveBeenCalledWith(creada));
    expect(api.registrarIncapacidadAjena).toHaveBeenCalledWith({
      empleadoId: 'e1',
      fechaInicio: '2025-03-03',
      fechaFin: '2025-03-05',
      comentarios: 'Avisó su hermana',
      adjunto: { nombreArchivo: 'baja.pdf', mime: 'application/pdf', contenidoBase64: 'JVBERi0=' },
    });
  });

  it('si falla: el mensaje del lector, y el formulario sigue abierto con lo rellenado', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockRejectedValue(new Error('Esa ficha ya no está activa. Recarga la lista.'));
    montar();
    rellenar();
    fireEvent.click(guardar());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Esa ficha ya no está activa. Recarga la lista.'));
    expect(persona().value).toBe('e1');
    expect(inicio().value).toBe('2025-03-03');
    expect(fin().value).toBe('2025-03-05');
    expect(guardar().disabled).toBe(false);
    expect(onRegistrada).not.toHaveBeenCalled();
    expect(onCerrar).not.toHaveBeenCalled();
  });

  // El overlay es el padre del diálogo: no tiene rol ni etiqueta a la que agarrarse.
  const overlay = () => screen.getByRole('dialog').parentElement as HTMLElement;

  it('control positivo: sin guardar, Escape y un clic en el fondo cierran', () => {
    montar();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(overlay());
    fireEvent.click(overlay());
    expect(onCerrar).toHaveBeenCalledTimes(2);
  });

  it('arrastrar desde un campo hasta el fondo no cierra el modal', () => {
    montar();
    fireEvent.mouseDown(inicio());
    fireEvent.click(overlay());
    expect(onCerrar).not.toHaveBeenCalled();
  });

  it('mientras guarda: no se envía dos veces, no se puede cerrar por ninguna salida y los campos se bloquean', async () => {
    api.leerComoBase64.mockResolvedValue('JVBERi0=');
    api.registrarIncapacidadAjena.mockReturnValue(new Promise(() => {}));
    montar();
    rellenar();
    fireEvent.click(guardar());
    await waitFor(() => expect(api.registrarIncapacidadAjena).toHaveBeenCalledTimes(1));

    const enviar = screen.getByRole('button', { name: /Guardando/ }) as HTMLButtonElement;
    expect(enviar.type).toBe('submit');
    // Bloqueado por el fieldset: la propiedad `.disabled` del select sigue en
    // false, lo que cambia es que casa con `:disabled`.
    expect(persona().matches(':disabled')).toBe(true);

    fireEvent.click(enviar);
    fireEvent.submit(screen.getByRole('dialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(overlay());
    fireEvent.click(overlay());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    // Un segundo envío llegaría a `registrarIncapacidadAjena` tras el `await`
    // de leer el PDF: sin esperar un turno, el test miraría antes de que ocurra.
    await new Promise((r) => setTimeout(r, 0));

    expect(api.registrarIncapacidadAjena).toHaveBeenCalledTimes(1);
    expect(onCerrar).not.toHaveBeenCalled();
  });

  it('avisa de que los comentarios van tal cual en el correo, y el campo apunta a ese aviso', () => {
    montar();
    const ayuda = document.getElementById(comentarios().getAttribute('aria-describedby') ?? '');
    expect(ayuda).toBeTruthy();
    expect(ayuda?.textContent).toContain('correo');
    // El asterisco visual va oculto a los lectores: el PDF se anuncia obligatorio por atributo.
    expect(soporte().getAttribute('aria-required')).toBe('true');
  });

  it('Cancelar cierra sin llamar al servidor', () => {
    montar();
    rellenar();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(api.registrarIncapacidadAjena).not.toHaveBeenCalled();
  });
});
