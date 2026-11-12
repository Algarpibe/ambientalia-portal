// @vitest-environment jsdom
// App: el conmutador «Tabla | Tablero» y el tema «Día | Noche» del tablero. La tabla es la vista por
// defecto y no cambia; el tablero se calcula en el navegador con el núcleo compartido. Todo ficticio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EST, type Fila, type RespuestaEquipos } from './nucleo';
import type { ApiEquipos } from './api';
import App, { CLAVE_TEMA_TABLERO } from './App';

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

describe('App: tema «Día | Noche» de la pestaña Tablero', () => {
  // Almacenamiento en memoria: el localStorage de jsdom choca con el global de Node 22+.
  const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  beforeEach(() => { vi.stubGlobal('localStorage', memoria()); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const temas = () => screen.getByRole('group', { name: 'Tema del tablero' });
  const temaDe = (n: string) => within(temas()).getByRole('button', { name: n });
  const pintado = async () => {
    await screen.findAllByRole('region');
    return document.querySelector('.tt-tablero')?.getAttribute('data-tema');
  };

  it('solo aparece con el tablero a la vista, y por defecto es Día', async () => {
    render(<App api={api()} />);
    await screen.findByRole('navigation', { name: 'Vistas' });
    expect(screen.queryByRole('group', { name: 'Tema del tablero' })).toBeNull();
    fireEvent.click(boton('Tablero'));
    expect(await pintado()).toBe('dia');
    expect(temaDe('Día').getAttribute('aria-pressed')).toBe('true');
    expect(temaDe('Noche').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(boton('Tabla'));
    expect(screen.queryByRole('group', { name: 'Tema del tablero' })).toBeNull();
  });

  it('«Noche» pinta el tablero de noche y el dispositivo lo recuerda; «Día» lo devuelve', async () => {
    history.replaceState(null, '', '/equipos-taller?vista=tablero');
    render(<App api={api()} />);
    await pintado();
    fireEvent.click(temaDe('Noche'));
    expect(await pintado()).toBe('noche');
    expect(temaDe('Noche').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(CLAVE_TEMA_TABLERO)).toBe('noche');
    cleanup();
    render(<App api={api()} />);
    expect(await pintado()).toBe('noche');
    expect(temaDe('Noche').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(temaDe('Día'));
    expect(await pintado()).toBe('dia');
    expect(localStorage.getItem(CLAVE_TEMA_TABLERO)).toBe('dia');
  });

  it('un valor guardado desconocido es Día', async () => {
    localStorage.setItem(CLAVE_TEMA_TABLERO, 'sistema');
    history.replaceState(null, '', '/equipos-taller?vista=tablero');
    render(<App api={api()} />);
    expect(await pintado()).toBe('dia');
    expect(temaDe('Día').getAttribute('aria-pressed')).toBe('true');
  });

  it('si el almacenamiento local falla, empieza en Día y el cambio vale en esta visita', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
    history.replaceState(null, '', '/equipos-taller?vista=tablero');
    render(<App api={api()} />);
    expect(await pintado()).toBe('dia');
    fireEvent.click(temaDe('Noche'));
    expect(await pintado()).toBe('noche');
  });
});
