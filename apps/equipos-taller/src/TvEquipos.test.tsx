// @vitest-environment jsdom
// Pantalla de TV: lienzo escalado, cabecera con reloj, KPIs configurados, tema día/noche en vivo y
// limpieza de temporizadores. Fuente de datos inyectada (`pedir`). Datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { AJUSTES_TABLERO_POR_DEFECTO, EST, construirTablero, type Fila, type RespuestaEquipos } from './nucleo';
import TvEquipos from './TvEquipos';

const AHORA = Date.parse('2026-11-11T20:00:00Z'); // 15:00 en Bogotá
const tamano = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); tamano(1920, 1080); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); location.hash = ''; });

const z = (n: string, st: string, enc: string) => ({ n, id: n, st, stt: 'Open', u: 'https://x/' + n, m: '', enc, eq: 'EDM180C', srv: '', fs: '', cl: '' });
const fila = (sn: string, d: string, extra: Partial<Fila> = {}): Fila =>
  ({ id: 'F' + sn, d, c: 'Cliente A', sn, est: EST.TALLER, src: '', why: [], x: null, z: null, zc: false, pa: [], xd: '', eq: '', ...extra });
const FILAS = [fila('18A90001', '2026-06-01', { z: z('1401', 'Rev./Diagnostico', 'Técnico Uno') }), fila('18A90004', '2026-09-01', { est: EST.ENTREGADO, xd: '2026-10-09' })];
const resp = (o: Partial<RespuestaEquipos> = {}, filas = FILAS): RespuestaEquipos => ({
  actualizando: false, configurado: true, ultima: null, ultimaBuena: null, incidente: null, ajustes: {},
  permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false },
  snap: { at: '2026-11-11T19:10:00Z', hoy: '2026-11-11', rows: filas }, ...o,
});
const fuente = (...pasos: (RespuestaEquipos | Error)[]) => {
  const pedir = vi.fn(async (_s: AbortSignal) => {
    const p = pasos[Math.min(pedir.mock.calls.length - 1, pasos.length - 1)];
    if (p instanceof Error) throw p;
    return structuredClone(p);
  });
  return pedir;
};
const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const lienzo = () => screen.getByTestId('tv-lienzo');
const tema = () => document.querySelector('.tt-tablero')?.getAttribute('data-tema');

describe('TvEquipos: lienzo', () => {
  it('3840×2160: escala 2, sin desplazamiento', async () => {
    tamano(3840, 2160);
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(lienzo().style.transform).toBe('translate(0px, 0px) scale(2)');
    expect(lienzo().style.width).toBe('1920px');
    expect(lienzo().style.height).toBe('1080px');
  });
  it('1280×1024: cabe entero y queda centrado; se reajusta al cambiar la ventana', async () => {
    tamano(1280, 1024);
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(lienzo().style.transform).toMatch(/^translate\(0px, 152px\) scale\(0\.666/);
    tamano(1920, 1080);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(lienzo().style.transform).toBe('translate(0px, 0px) scale(1)');
  });
  it('es de solo lectura: ningún botón, enlace ni campo', async () => {
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    for (const rol of ['button', 'link', 'textbox']) expect(screen.queryAllByRole(rol)).toHaveLength(0);
  });
});

describe('TvEquipos: cabecera y KPIs', () => {
  it('textos fijos, línea de actualización, fecha larga y reloj de Bogotá', async () => {
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(screen.getByText('AMBIENTALIA · SERVICIO TÉCNICO')).toBeTruthy();
    expect(screen.getByText('Estado de equipos en taller')).toBeTruthy();
    expect(screen.getByText('Actualizado 15:00 · datos de las 14:10 · se refresca cada 60 s')).toBeTruthy();
    expect(screen.getByText('miércoles 11 de noviembre de 2026')).toBeTruthy();
    expect(screen.getByRole('timer').textContent).toBe('15:00');
  });
  it('el reloj se recalcula cada segundo con su propio temporizador', async () => {
    vi.setSystemTime(Date.parse('2026-11-11T20:00:59Z'));
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(screen.getByRole('timer').textContent).toBe('15:00');
    await avanzar(1000);
    expect(screen.getByRole('timer').textContent).toBe('15:01');
  });
  it('los 5 KPIs configurados, en su orden, con «Por revisar» y «Entregados»', async () => {
    const cfg = { ...AJUSTES_TABLERO_POR_DEFECTO, kpis: ['entregado', 'revisar', 'en_taller', 'externo', 'ticket_abierto'] as typeof AJUSTES_TABLERO_POR_DEFECTO.kpis };
    render(<TvEquipos pedir={fuente(resp({ tablero: cfg }))} buscar="" />);
    await avanzar(0);
    const kpis = within(screen.getByRole('list', { name: 'Indicadores' })).getAllByRole('listitem').map((x) => x.textContent);
    expect(kpis).toEqual(['1Entregados', '0Por revisar', '1En taller', '0Servicio externo', '0Salió con ticket abierto']);
  });
  it('usa el presupuesto de alto: con muchas tarjetas aparece «+N más»', async () => {
    const muchas = Array.from({ length: 9 }, (_, i) => fila('S0' + i, '2026-01-0' + (i + 1), { z: z('20' + i, 'Ingresado', 'Técnico Uno') }));
    render(<TvEquipos pedir={fuente(resp({}, muchas))} buscar="" />);
    await avanzar(0);
    expect(screen.getByText('+4 más')).toBeTruthy();
  });
});

describe('TvEquipos: tema', () => {
  it('auto: día a las 15:00 y noche a las 03:00', async () => {
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(tema()).toBe('dia');
    cleanup();
    vi.setSystemTime(Date.parse('2026-11-11T08:00:00Z'));
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(tema()).toBe('noche');
  });
  it('?tema= manda; uno inválido es auto', async () => {
    render(<TvEquipos pedir={fuente(resp())} buscar="?tema=noche" />);
    await avanzar(0);
    expect(tema()).toBe('noche');
    cleanup();
    render(<TvEquipos pedir={fuente(resp())} buscar="?tema=otro" />);
    await avanzar(0);
    expect(tema()).toBe('dia');
  });
  it('cambia a noche a las 18:00 sin recargar, y respeta las horas configuradas', async () => {
    vi.setSystemTime(Date.parse('2026-11-11T22:59:55Z')); // 17:59:55
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(tema()).toBe('dia');
    await avanzar(10_000);
    expect(tema()).toBe('noche');
    cleanup();
    vi.setSystemTime(Date.parse('2026-11-11T22:00:00Z')); // 17:00 con noche desde las 17
    render(<TvEquipos pedir={fuente(resp({ tablero: { ...AJUSTES_TABLERO_POR_DEFECTO, nocheDesde: 17 } }))} buscar="" />);
    await avanzar(0);
    expect(tema()).toBe('noche');
  });
});

describe('TvEquipos: estados y limpieza', () => {
  it('antes de los datos y con fallo no queda en blanco; 401 dice que no hay acceso', async () => {
    render(<TvEquipos pedir={fuente(Object.assign(new Error('x'), { status: 401 }))} buscar="" />);
    expect(screen.getByText('Cargando tablero…')).toBeTruthy();
    await avanzar(0);
    expect(screen.getByRole('alert').textContent).toContain('No tienes acceso al tablero');
  });
  it('al desmontar no queda ningún temporizador', async () => {
    const { unmount } = render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('120 ciclos de 60 s mantienen constantes los temporizadores y los nodos del DOM', async () => {
    render(<TvEquipos pedir={fuente(resp())} buscar="" />);
    await avanzar(0);
    const nodos = () => document.body.querySelectorAll('*').length;
    const n0 = nodos();
    const t0 = vi.getTimerCount();
    for (let i = 0; i < 120; i++) await avanzar(60_000);
    expect(nodos()).toBe(n0);
    expect(vi.getTimerCount()).toBe(t0);
  });
});

describe('TvEquipos: modo kiosco (llave en el fragmento #k=)', () => {
  const TOKEN = 'tvk_' + 'A'.repeat(43);
  const kiosco = (status: number, cuerpo: unknown) => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(cuerpo), { status }));
    vi.stubGlobal('fetch', f);
    return f;
  };
  it('pide /kiosco/tablero solo con X-Kiosk-Token, dibuja el tablero ya armado y conserva el fragmento', async () => {
    location.hash = '#k=' + TOKEN;
    const f = kiosco(200, { tablero: construirTablero(FILAS, AJUSTES_TABLERO_POR_DEFECTO, AHORA), ajustes: AJUSTES_TABLERO_POR_DEFECTO, fotoEn: '2026-11-11T19:10:00Z', aviso: null });
    render(<TvEquipos buscar="" />);
    await avanzar(0);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(String(url).endsWith('/api/equipos-taller/kiosco/tablero')).toBe(true);
    expect(init?.headers).toEqual({ 'X-Kiosk-Token': TOKEN });
    expect(screen.getByText('En taller')).toBeTruthy();
    expect(location.hash).toBe('#k=' + TOKEN);
  });
  it('una llave inválida o revocada (401) muestra un aviso de acceso, nunca pantalla en blanco', async () => {
    location.hash = '#k=' + TOKEN;
    kiosco(401, { error: 'unauthorized' });
    render(<TvEquipos buscar="" />);
    await avanzar(0);
    expect(screen.getByRole('alert').textContent).toBe('La llave de esta pantalla no es válida o fue revocada. Pide una nueva en Ajustes.');
  });
});
