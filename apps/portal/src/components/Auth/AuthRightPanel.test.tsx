// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AuthRightPanel from './AuthRightPanel';

// Mocks: API_BASE definido (si no, el componente aborta antes de fetch) y notify.
vi.mock('../../auth', () => ({ API_BASE: 'http://test', setToken: vi.fn() }));
vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));
import { notify } from '../../lib/notify';
import { setToken } from '../../auth';
import { TERMS_VERSION, TEXTO_CASILLA } from '../../legal/terminos';

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

// Recuperación de contraseña por correo (spec 2026-11-13, §6.1): un tercer modo
// del panel, solo desde la pestaña de iniciar sesión.
describe('AuthRightPanel — ¿Olvidaste tu contraseña?', () => {
  function renderLogin() {
    return render(
      <MemoryRouter>
        <AuthRightPanel isSignUp={false} onToggle={() => {}} />
      </MemoryRouter>,
    );
  }
  const abrirOlvido = () => fireEvent.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
  function enviarCorreo(correo: string) {
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: correo } });
    fireEvent.submit(screen.getByRole('button', { name: 'Enviar enlace' }).closest('form')!);
  }

  it('el enlace está en la pestaña de iniciar sesión y no en la de registro', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeTruthy();
    cleanup();
    renderSignup();
    expect(screen.queryByRole('button', { name: '¿Olvidaste tu contraseña?' })).toBeNull();
  });

  it('abre el modo «olvidé»: correo, «Enviar enlace» y «Volver a iniciar sesión»', () => {
    renderLogin();
    abrirOlvido();
    expect(screen.getByRole('heading', { name: '¿Olvidaste tu contraseña?' })).toBeTruthy();
    expect((screen.getByLabelText('Correo electrónico') as HTMLInputElement).type).toBe('email');
    expect(screen.queryByLabelText('Contraseña')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a iniciar sesión' }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('pulsar la pestaña «Iniciar sesión» también cierra el modo «olvidé»', () => {
    renderLogin();
    abrirOlvido();
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('«Enviar enlace» no se puede pulsar sin correo', () => {
    renderLogin();
    abrirOlvido();
    expect((screen.getByRole('button', { name: 'Enviar enlace' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('envía el correo a forgot-password y muestra el mensaje genérico', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: 'reset_requested' }) } as unknown as Response);
    renderLogin();
    abrirOlvido();
    enviarCorreo('  persona@ejemplo.test ');
    expect(
      await screen.findByText('Si el correo está registrado, recibirás un enlace en unos minutos. Revisa también la carpeta de spam.'),
    ).toBeTruthy();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://test/api/auth/forgot-password');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ email: 'persona@ejemplo.test' });
  });

  it('429 → «Demasiados intentos, espera unos minutos.»', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'too many requests' }) } as unknown as Response);
    renderLogin();
    abrirOlvido();
    enviarCorreo('persona@ejemplo.test');
    expect((await screen.findByRole('alert')).textContent).toContain('Demasiados intentos, espera unos minutos.');
  });

  it('sin red → «No se pudo conectar con el servidor. Reintenta.»', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    renderLogin();
    abrirOlvido();
    enviarCorreo('persona@ejemplo.test');
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo conectar con el servidor. Reintenta.');
  });

  it('al abrir el modo «olvidé» el foco queda en el correo', () => {
    renderLogin();
    abrirOlvido();
    expect(document.activeElement).toBe(screen.getByLabelText('Correo electrónico'));
  });

  it('tras enviar, el foco pasa al título de la confirmación y el mensaje es un status', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    renderLogin();
    abrirOlvido();
    enviarCorreo('persona@ejemplo.test');
    expect((await screen.findByRole('status')).textContent).toContain('Si el correo está registrado');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Revisa tu correo' }));
  });

  it('una respuesta que no es 200 ni 429 → «No se pudo enviar el enlace. Reintenta.»', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    renderLogin();
    abrirOlvido();
    enviarCorreo('persona@ejemplo.test');
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo enviar el enlace. Reintenta.');
  });

  it('«Enviar enlace» queda deshabilitado mientras la petición está en vuelo', async () => {
    let resolver: (r: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((res) => { resolver = res; }));
    renderLogin();
    abrirOlvido();
    enviarCorreo('persona@ejemplo.test');
    const boton = (await screen.findByRole('button', { name: 'Enviando...' })) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    resolver({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('un error de login previo no reaparece al volver desde el modo «olvidé»', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    const { container } = renderLogin();
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@ejemplo.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'x' } });
    fireEvent.submit(container.querySelector('form')!);
    await screen.findByRole('alert');
    abrirOlvido();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a iniciar sesión' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('con olvidoInicial se abre directamente en el modo «olvidé»', () => {
    render(
      <MemoryRouter>
        <AuthRightPanel isSignUp={false} onToggle={() => {}} olvidoInicial />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });
});

// Tras iniciar sesión (spec 2026-11-20, §5.2): se vuelve a la ruta protegida de
// la que se llegó (`state.from`), solo si es interna; si no, al inicio.
describe('AuthRightPanel — a dónde se vuelve tras iniciar sesión', () => {
  /** Lo que se pinta fuera de /auth: la ruta a la que se navegó. */
  function Destino() {
    const { pathname } = useLocation();
    return <p data-testid="destino">{pathname}</p>;
  }

  function entrarDesde(state: unknown) {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({ token: 'token-ficticio' }) } as unknown as Response);
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/auth', state }]}>
        <Routes>
          <Route path="/auth" element={<AuthRightPanel isSignUp={false} onToggle={() => {}} />} />
          <Route path="*" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@ejemplo.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-ficticia-1' } });
    fireEvent.submit(container.querySelector('form')!);
  }

  it('vuelve a la ruta protegida de la que se llegó', async () => {
    entrarDesde({ from: '/contabilidad' });
    expect((await screen.findByTestId('destino')).textContent).toBe('/contabilidad');
    expect(setToken).toHaveBeenCalledWith('token-ficticio');
  });

  it.each([
    ['sin `from`', undefined],
    ['con un `from` a otra web (//)', { from: '//evil.test' }],
    ['con un `from` absoluto', { from: 'https://evil.test/' }],
  ])('%s, al inicio', async (_caso, state) => {
    entrarDesde(state);
    expect((await screen.findByTestId('destino')).textContent).toBe('/');
  });
});

// Condiciones de uso (spec 2026-11-20-terminos, §5): la casilla dice qué se acepta,
// enlaza el texto y, marcada, manda la versión para que quede constancia.
describe('AuthRightPanel — condiciones de uso', () => {
  function rellenar() {
    fill('Juan Pérez', 'Persona Prueba');
    fill('tu@ejemplo.com', 'persona@ejemplo.test');
    fill('••••••••', 'clave-ficticia-1');
  }
  const cuerpoEnviado = () =>
    JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;

  it('la casilla dice el texto de la política y «condiciones de uso» abre /terminos en pestaña nueva', () => {
    renderSignup();
    // El enlace va dentro de la etiqueta de la casilla: sin sufijo oculto, para que el
    // nombre accesible de la casilla sea exactamente la frase.
    expect(screen.getByRole('checkbox').closest('label')?.textContent).toBe(TEXTO_CASILLA);
    const enlace = screen.getByRole('link', { name: 'condiciones de uso' });
    expect(enlace.getAttribute('href')).toBe('/terminos');
    expect(enlace.getAttribute('target')).toBe('_blank');
    expect(enlace.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('con la casilla marcada, el registro manda termsVersion', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 201, json: async () => ({}) } as unknown as Response);
    const { container } = renderSignup();
    rellenar();
    fireEvent.click(screen.getByRole('checkbox'));
    submit(container);
    await screen.findByText(/pendiente de aprobación/i);
    expect(cuerpoEnviado()).toEqual({
      fullName: 'Persona Prueba',
      email: 'persona@ejemplo.test',
      password: 'clave-ficticia-1',
      termsVersion: TERMS_VERSION,
    });
  });

  it('sin la casilla marcada no manda termsVersion: no hay aceptación de la que dejar constancia', async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 201, json: async () => ({}) } as unknown as Response);
    const { container } = renderSignup();
    rellenar();
    submit(container);
    await screen.findByText(/pendiente de aprobación/i);
    expect(cuerpoEnviado()).not.toHaveProperty('termsVersion');
  });
});
