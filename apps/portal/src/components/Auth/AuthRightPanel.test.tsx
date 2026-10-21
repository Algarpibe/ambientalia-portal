// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthRightPanel from './AuthRightPanel';

// Mocks: API_BASE definido (si no, el componente aborta antes de fetch) y notify.
vi.mock('../../auth', () => ({ API_BASE: 'http://test', setToken: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
import { notify } from '../../lib/notify';

function renderSignup() {
  return render(
    <MemoryRouter>
      <AuthRightPanel isSignUp={true} onToggle={() => {}} />
    </MemoryRouter>,
  );
}
function fill(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}
function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form')!);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AuthRightPanel — registro (task 14.1)', () => {
  it('validación cliente bloquea el envío y no llama al endpoint', () => {
    const { container } = renderSignup();
    fill('Juan Pérez', '');
    fill('tu@ejemplo.com', 'no-es-email');
    fill('••••••••', 'corta');
    submit(container);
    expect(screen.getByText(/máx. 100 caracteres/i)).toBeTruthy();
    expect(screen.getByText(/Correo electrónico inválido/i)).toBeTruthy();
    expect(screen.getByText(/al menos 8 caracteres/i)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registro exitoso (201) → mensaje de solicitud pendiente, sin token', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 201, json: async () => ({ message: 'registration_pending', userId: 'x' }) } as unknown as Response);
    const { container } = renderSignup();
    fill('Juan Pérez', 'Juan Pérez');
    fill('tu@ejemplo.com', 'juan@empresa.com');
    fill('••••••••', 's3cur3pass');
    submit(container);
    expect(await screen.findByText(/pendiente de aprobación/i)).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('/api/auth/register');
  });

  it('email duplicado (409) → error inline en el campo email', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 409, json: async () => ({ error: 'email_already_registered' }) } as unknown as Response);
    const { container } = renderSignup();
    fill('Juan Pérez', 'Juan Pérez');
    fill('tu@ejemplo.com', 'dup@empresa.com');
    fill('••••••••', 's3cur3pass');
    submit(container);
    expect(await screen.findByText(/ya está registrado/i)).toBeTruthy();
  });

  it('error de red → dispara notificación (toast)', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network'));
    const { container } = renderSignup();
    fill('Juan Pérez', 'Juan Pérez');
    fill('tu@ejemplo.com', 'juan@empresa.com');
    fill('••••••••', 's3cur3pass');
    submit(container);
    await waitFor(() => expect(notify).toHaveBeenCalled());
  });
});

// FE-419 — el login era inusable con lector de pantalla: las <label> no estaban
// asociadas a sus campos, el ojo de la contraseña no tenía nombre y los errores
// no se anunciaban. Las consultas por etiqueta y rol prueban justo eso.
describe('AuthRightPanel — accesibilidad (FE-419)', () => {
  function renderLogin() {
    return render(
      <MemoryRouter>
        <AuthRightPanel isSignUp={false} onToggle={() => {}} />
      </MemoryRouter>,
    );
  }

  it('login: cada campo se alcanza por su etiqueta', () => {
    renderLogin();
    expect((screen.getByLabelText('Correo electrónico') as HTMLInputElement).type).toBe('email');
    expect((screen.getByLabelText('Contraseña') as HTMLInputElement).type).toBe('password');
  });

  it('registro: nombre, correo y contraseña se alcanzan por su etiqueta', () => {
    renderSignup();
    expect((screen.getByLabelText('Nombre completo') as HTMLInputElement).name).toBe('fullName');
    expect((screen.getByLabelText('Correo electrónico') as HTMLInputElement).name).toBe('email');
    expect((screen.getByLabelText('Contraseña') as HTMLInputElement).name).toBe('password');
  });

  it('el botón del ojo dice qué hace y refleja su estado', () => {
    renderLogin();
    const mostrar = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(mostrar.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mostrar);
    const ocultar = screen.getByRole('button', { name: 'Ocultar contraseña' });
    expect(ocultar.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Contraseña') as HTMLInputElement).type).toBe('text');
  });

  it('login fallido: el error se anuncia como alerta', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    const { container } = renderLogin();
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'x' } });
    submit(container);
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/inválidos/);
  });

  it('registro inválido: cada campo queda marcado y enlazado con su mensaje', () => {
    const { container } = renderSignup();
    fill('tu@ejemplo.com', 'no-es-email');
    submit(container);
    const correo = screen.getByLabelText('Correo electrónico');
    expect(correo.getAttribute('aria-invalid')).toBe('true');
    const idMensaje = correo.getAttribute('aria-describedby');
    expect(idMensaje).toBeTruthy();
    expect(document.getElementById(idMensaje!)?.textContent).toMatch(/Correo electrónico inválido/);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});
