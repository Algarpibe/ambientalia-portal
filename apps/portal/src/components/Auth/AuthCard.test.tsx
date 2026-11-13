// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCard from './AuthCard';

// Con qué se abre /auth: lo decide `location.state.modo` de quien navega hasta
// aquí (la página de restablecer contraseña). Sin indicación, el registro.

afterEach(() => cleanup());

function abrirCon(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/auth', state }]}>
      <AuthCard />
    </MemoryRouter>,
  );
}

describe('AuthCard — con qué se abre', () => {
  it('sin indicación, en el registro (como hasta ahora)', () => {
    abrirCon();
    expect(screen.getByText('Crea tu cuenta')).toBeTruthy();
  });

  it('el `from` que deja RequireAuth no cambia nada', () => {
    abrirCon({ from: '/ausencias' });
    expect(screen.getByText('Crea tu cuenta')).toBeTruthy();
  });

  it('con modo login, en iniciar sesión', () => {
    abrirCon({ modo: 'login' });
    expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();
  });

  it('con modo olvido, directamente en «¿Olvidaste tu contraseña?»', () => {
    abrirCon({ modo: 'olvido' });
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('un modo desconocido o basura cae al registro sin romper', () => {
    abrirCon({ modo: 'cualquier-cosa' });
    expect(screen.getByText('Crea tu cuenta')).toBeTruthy();
  });
});
