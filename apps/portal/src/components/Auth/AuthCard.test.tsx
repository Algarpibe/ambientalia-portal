// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCard from './AuthCard';

// Con qué se abre /auth: manda `location.state.modo` de quien navega hasta aquí;
// si no, «Iniciar sesión» con `?modo=login` (el botón de los correos de acceso)
// o con el `from` que dejan RequireAuth y RequireAdmin. Sin nada de eso, el
// registro.

afterEach(() => cleanup());

function abrirCon(state?: unknown, search = '') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/auth', search, state }]}>
      <AuthCard />
    </MemoryRouter>,
  );
}

const enRegistro = () => expect(screen.getByText('Crea tu cuenta')).toBeTruthy();
const enLogin = () => expect(screen.getByText('Bienvenido de vuelta')).toBeTruthy();

describe('AuthCard — con qué se abre', () => {
  it('sin indicación, en el registro (como hasta ahora)', () => {
    abrirCon();
    enRegistro();
  });

  it('con ?modo=login en la URL (el botón «Entrar al portal» de los correos), en iniciar sesión', () => {
    abrirCon(undefined, '?modo=login');
    enLogin();
  });

  it('un ?modo con otro valor no cambia nada', () => {
    abrirCon(undefined, '?modo=registro');
    enRegistro();
  });

  it('con el `from` que dejan RequireAuth y RequireAdmin, en iniciar sesión: quien viene de una ruta protegida ya tiene cuenta', () => {
    abrirCon({ from: '/contabilidad' });
    enLogin();
  });

  it('un `from` que no es texto no cuenta', () => {
    abrirCon({ from: 42 });
    enRegistro();
  });

  it('con modo login, en iniciar sesión', () => {
    abrirCon({ modo: 'login' });
    enLogin();
  });

  it('con modo olvido, directamente en «¿Olvidaste tu contraseña?»', () => {
    abrirCon({ modo: 'olvido' });
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('state.modo manda: olvido gana a ?modo=login y al from', () => {
    abrirCon({ modo: 'olvido', from: '/contabilidad' }, '?modo=login');
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeTruthy();
  });

  it('un modo desconocido o basura cae al registro sin romper', () => {
    abrirCon({ modo: 'cualquier-cosa' });
    enRegistro();
  });
});
