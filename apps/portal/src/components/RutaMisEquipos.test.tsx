// @vitest-environment jsdom
// Ruta «Mis equipos»: fuera del shell, con sesión y app asignada; el nombre sale del perfil propio.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuthState } from '../hooks/useAuth';
import RutaMisEquipos from './RutaMisEquipos';

const estado = vi.hoisted(() => ({ auth: null as AuthState | null, sesion: true, perfil: { profile: { full_name: 'María Pérez Gómez' } as { full_name: string } | null, loading: false }, montada: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => estado.auth }));
vi.mock('../hooks/useProfile', () => ({ useProfile: () => estado.perfil }));
vi.mock('../auth', () => ({ isAuthenticated: () => estado.sesion }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../../equipos-taller/src/MisEquipos', () => ({
  default: ({ nombre }: { nombre: string | null }) => { estado.montada(); return <div>{`MIS EQUIPOS DE ${nombre}`}</div>; },
}));

const auth = (apps: string[]): AuthState => ({ isAuthenticated: true, user_id: 'u', email: 'a@x.com', role: 'reader', apps });
const montar = () => render(
  <MemoryRouter initialEntries={['/equipos-taller/mis-equipos']}>
    <Routes>
      <Route path="/equipos-taller/mis-equipos" element={<RutaMisEquipos />} />
      <Route path="/auth" element={<div>LOGIN</div>} />
      <Route path="/" element={<div>INICIO</div>} />
    </Routes>
  </MemoryRouter>,
);
afterEach(() => { cleanup(); vi.clearAllMocks(); estado.sesion = true; estado.perfil = { profile: { full_name: 'María Pérez Gómez' }, loading: false }; });

describe('RutaMisEquipos', () => {
  it('con sesión y la app asignada monta la vista con el nombre del perfil', async () => {
    estado.auth = auth(['equipos-taller']);
    montar();
    expect(await screen.findByText('MIS EQUIPOS DE María Pérez Gómez')).toBeTruthy();
  });
  it('mientras el perfil carga no monta la vista (evita mostrar el selector por error)', () => {
    estado.auth = auth(['equipos-taller']);
    estado.perfil = { profile: null, loading: true };
    montar();
    expect(estado.montada).not.toHaveBeenCalled();
  });
  it('sin sesión va al login y sin la app vuelve al inicio, sin montar la vista', async () => {
    estado.auth = auth([]);
    estado.sesion = false;
    montar();
    expect(await screen.findByText('LOGIN')).toBeTruthy();
    cleanup();
    estado.sesion = true;
    estado.auth = auth(['contabilidad']);
    montar();
    expect(await screen.findByText('INICIO')).toBeTruthy();
    expect(estado.montada).not.toHaveBeenCalled();
  });
  it('App.tsx la registra FUERA del shell y antes de /*', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const ruta = src.indexOf('path="/equipos-taller/mis-equipos"');
    expect(ruta).toBeGreaterThan(-1);
    expect(ruta).toBeLessThan(src.indexOf('path="/*"'));
    expect(src).toContain('<RutaMisEquipos />');
  });
});
