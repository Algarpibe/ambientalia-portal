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
    (fetch as any).mockResolvedValue({ status: 201, json: async () => ({ message: 'registration_pending', userId: 'x' }) });
    const { container } = renderSignup();
    fill('Juan Pérez', 'Juan Pérez');
    fill('tu@ejemplo.com', 'juan@empresa.com');
    fill('••••••••', 's3cur3pass');
    submit(container);
    expect(await screen.findByText(/pendiente de aprobación/i)).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    const [url] = (fetch as any).mock.calls[0];
    expect(url).toContain('/api/auth/register');
  });

  it('email duplicado (409) → error inline en el campo email', async () => {
    (fetch as any).mockResolvedValue({ status: 409, json: async () => ({ error: 'email_already_registered' }) });
    const { container } = renderSignup();
    fill('Juan Pérez', 'Juan Pérez');
    fill('tu@ejemplo.com', 'dup@empresa.com');
    fill('••••••••', 's3cur3pass');
    submit(container);
    expect(await screen.findByText(/ya está registrado/i)).toBeTruthy();
  });

  it('error de red → dispara notificación (toast)', async () => {
    (fetch as any).mockRejectedValue(new Error('network'));
    const { container } = renderSignup();
    fill('Juan Pérez', 'Juan Pérez');
    fill('tu@ejemplo.com', 'juan@empresa.com');
    fill('••••••••', 's3cur3pass');
    submit(container);
    await waitFor(() => expect(notify).toHaveBeenCalled());
  });
});
