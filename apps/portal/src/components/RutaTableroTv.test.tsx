// @vitest-environment jsdom
// Ruta de la TV del taller: fuera del shell, con sesión y app asignada; sin sesión no se pide ningún dato.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuthState } from '../hooks/useAuth';
import RutaTableroTv from './RutaTableroTv';

const estado = vi.hoisted(() => ({ auth: null as AuthState | null, sesion: true, montada: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => estado.auth }));
vi.mock('../auth', () => ({ isAuthenticated: () => estado.sesion }));
vi.mock('../lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../../equipos-taller/src/TvEquipos', () => ({
  default: () => { estado.montada(); return <div>TV DEL TALLER</div>; },
}));

const auth = (apps: string[]): AuthState => ({ isAuthenticated: true, user_id: 'u', email: 'a@x.com', role: 'reader', apps });
const montar = () => render(
  <MemoryRouter initialEntries={['/equipos-taller/tv']}>
    <Routes>
      <Route path="/equipos-taller/tv" element={<RutaTableroTv />} />
      <Route path="/auth" element={<div>LOGIN</div>} />
      <Route path="/" element={<div>INICIO</div>} />
    </Routes>
  </MemoryRouter>,
);
afterEach(() => { cleanup(); vi.clearAllMocks(); estado.sesion = true; location.hash = ''; });

describe('RutaTableroTv', () => {
  it('con sesión y la app asignada muestra la TV y pide que no se envíe el Referer', async () => {
    estado.auth = auth(['equipos-taller']);
    montar();
    expect(await screen.findByText('TV DEL TALLER')).toBeTruthy();
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
  });
  it('sin sesión va al login y no monta la TV (ningún dato)', async () => {
    estado.auth = auth([]);
    estado.sesion = false;
    montar();
    expect(await screen.findByText('LOGIN')).toBeTruthy();
    expect(estado.montada).not.toHaveBeenCalled();
  });
  it('con la llave de kiosco en el fragmento monta la TV SIN sesión (la llave es la credencial)', async () => {
    estado.auth = auth([]);
    estado.sesion = false;
    location.hash = '#k=tvk_' + 'A'.repeat(43);
    montar();
    expect(await screen.findByText('TV DEL TALLER')).toBeTruthy();
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
  });
  it('con sesión pero sin la app, vuelve al inicio sin montar la TV', async () => {
    estado.auth = auth(['contabilidad']);
    montar();
    expect(await screen.findByText('INICIO')).toBeTruthy();
    expect(estado.montada).not.toHaveBeenCalled();
  });
});

describe('App.tsx: rutas de pantalla', () => {
  it('/equipos-taller/tv va FUERA del shell y antes de /*', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const tv = src.indexOf('path="/equipos-taller/tv"');
    expect(tv).toBeGreaterThan(-1);
    expect(tv).toBeLessThan(src.indexOf('path="/*"'));
    expect(src).toContain('<RutaTableroTv />');
  });
});
