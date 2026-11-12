// @vitest-environment jsdom
// App: el conmutador «Tabla | Tablero». La tabla es la vista por defecto y no cambia; el tablero se
// calcula en el navegador con el núcleo compartido y su tema sale de Ajustes. Todo ficticio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EST, type Fila, type RespuestaEquipos } from './nucleo';
import type { ApiEquipos } from './api';
import App from './App';

const fila = (sn: string, d: string, extra: Partial<Fila> = {}): Fila =>
  ({ id: 'F' + sn, d, c: 'Cliente A', sn, est: EST.TALLER, src: '', why: [], x: null, z: null, zc: false, pa: [], xd: '', eq: 'EDM180C', ...extra });
const respuesta: RespuestaEquipos = {
  actualizando: false, configurado: true, ultima: null, ultimaBuena: null, incidente: null, ajustes: {},
  permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false },
  snap: { at: '2026-11-09T11:35:00Z', hoy: '2026-11-09', rows: [fila('18A90001', '2026-06-01'), fila('18A90002', '2026-10-01')] },
};
const api = (): ApiEquipos => ({
  estado: async () => structuredClone(respuesta),
  guardarAjuste: async () => { throw new Error('no se usa'); },
  borrarAjuste: async () => {},
  llaves: async () => [],
  guardarLlaves: async () => { throw new Error('no se usa'); },
});

beforeEach(() => { history.replaceState({ usr: 'estado-del-router' }, '', '/equipos-taller'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const conmutador = () => screen.getByRole('navigation', { name: 'Tipo de vista' });
const boton = (n: string) => Array.from(conmutador().querySelectorAll('button')).find((b) => b.textContent === n)!;

describe('App: conmutador Tabla | Tablero', () => {
  it('por defecto muestra la tabla y el conmutador la marca', async () => {
    render(<App api={api()} />);
    expect(await screen.findByRole('navigation', { name: 'Vistas' })).toBeTruthy();
    expect(boton('Tabla').getAttribute('aria-pressed')).toBe('true');
    expect(boton('Tablero').getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('«Tablero» muestra las 6 columnas calculadas de GET /api/equipos-taller y oculta la tabla', async () => {
    render(<App api={api()} />);
    fireEvent.click(boton('Tablero'));
    expect(await screen.findByRole('region', { name: 'Rev. / Diagnóstico' })).toBeTruthy();
    expect(await screen.findAllByRole('region')).toHaveLength(6);
    expect(await screen.findAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('navigation', { name: 'Vistas' })).toBeNull();
    expect(boton('Tablero').getAttribute('aria-pressed')).toBe('true');
  });

  it('volver a «Tabla» devuelve la tabla', async () => {
    render(<App api={api()} />);
    fireEvent.click(boton('Tablero'));
    await screen.findAllByRole('region');
    fireEvent.click(boton('Tabla'));
    expect(await screen.findByRole('navigation', { name: 'Vistas' })).toBeTruthy();
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('lee ?vista=tablero al montar', async () => {
    history.replaceState(null, '', '/equipos-taller?vista=tablero');
    render(<App api={api()} />);
    expect(await screen.findAllByRole('region')).toHaveLength(6);
    expect(boton('Tablero').getAttribute('aria-pressed')).toBe('true');
  });

  it('un valor desconocido de ?vista= deja la tabla', async () => {
    history.replaceState(null, '', '/equipos-taller?vista=otra');
    render(<App api={api()} />);
    expect(await screen.findByRole('navigation', { name: 'Vistas' })).toBeTruthy();
  });

  it('al cambiar usa replaceState conservando history.state, no pushState', async () => {
    const reemplazar = vi.spyOn(history, 'replaceState');
    const empujar = vi.spyOn(history, 'pushState');
    render(<App api={api()} />);
    await screen.findByRole('navigation', { name: 'Vistas' });
    fireEvent.click(boton('Tablero'));
    expect(reemplazar).toHaveBeenLastCalledWith({ usr: 'estado-del-router' }, '', expect.stringContaining('vista=tablero'));
    expect(location.search).toBe('?vista=tablero');
    fireEvent.click(boton('Tabla'));
    expect(location.search).toBe('');
    expect(history.state).toEqual({ usr: 'estado-del-router' });
    expect(empujar).not.toHaveBeenCalled();
  });
});

describe('App: el tema del tablero se configura en Ajustes, no en la pestaña', () => {
  const pintado = async () => {
    await screen.findAllByRole('region');
    return document.querySelector('.tt-tablero')?.getAttribute('data-tema');
  };
  const conTema = (temaTv: 'dia' | 'noche'): ApiEquipos => ({
    ...api(),
    estado: async () => ({ ...structuredClone(respuesta), tablero: { umbralAmbar: 30, umbralRojo: 90, nocheDesde: 18, nocheHasta: 6, kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo', 'entregado'], temaTv } }),
  });

  it('no hay selector de tema junto a «Tabla | Tablero»', async () => {
    history.replaceState(null, '', '/equipos-taller?vista=tablero');
    render(<App api={api()} />);
    await pintado();
    expect(screen.queryByRole('group', { name: 'Tema del tablero' })).toBeNull();
    expect(within(conmutador()).queryByRole('button', { name: 'Noche' })).toBeNull();
  });

  it('sin ajustes del servidor, Día', async () => {
    history.replaceState(null, '', '/equipos-taller?vista=tablero');
    render(<App api={api()} />);
    expect(await pintado()).toBe('dia');
  });

  it('con el tema en «Noche» en Ajustes, la pestaña se pinta de noche', async () => {
    history.replaceState(null, '', '/equipos-taller?vista=tablero');
    render(<App api={conTema('noche')} />);
    expect(await pintado()).toBe('noche');
  });
});
