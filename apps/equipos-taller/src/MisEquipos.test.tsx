// @vitest-environment jsdom
// «Mis equipos»: vista de solo lectura del técnico. Fuente de datos inyectada. Datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EST, type Fila, type RespuestaEquipos } from './nucleo';
import MisEquipos, { CLAVE_TECNICO } from './MisEquipos';

const AHORA = Date.parse('2026-11-11T20:00:00Z');
// Almacenamiento en memoria: el localStorage de jsdom choca con el global de Node 22+.
const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), clear: () => m.clear() }; };
const almacen = { actual: memoria() };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); almacen.actual = memoria(); vi.stubGlobal('localStorage', almacen.actual); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const z = (n: string, st: string, enc: string) => ({ n, id: n, st, stt: 'Open', u: 'https://x/' + n, m: '', enc, eq: 'EDM180C', srv: '', fs: '', cl: '' });
const fila = (sn: string, d: string, st: string, enc: string, n = sn.slice(-4)): Fila =>
  ({ id: 'F' + sn, d, c: 'Cliente Demo', sn, est: EST.TALLER, src: '', why: [], x: null, z: z(n, st, enc), zc: false, pa: [], xd: '', eq: '' });
const UNO = 'María Pérez Gómez';
const FILAS = [
  fila('18A90001', '2026-08-01', 'Notificación cliente', UNO, '1234'), // 102 d: rojo
  fila('18A90002', '2026-11-01', 'Notificación cliente', 'maria perez gomez'),
  fila('18A90003', '2026-10-01', 'Ingresado', UNO), // 41 d
  fila('18A90004', '2026-11-05', 'Por entregar', 'maria PEREZ gomez'),
  fila('18A90005', '2026-11-05', 'Ingresado', 'Técnico Dos'),
];
const resp = (filas = FILAS): RespuestaEquipos => ({
  actualizando: false, configurado: true, ultima: null, ultimaBuena: null, incidente: null, ajustes: {},
  permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false },
  snap: { at: '2026-11-11T19:10:00Z', hoy: '2026-11-11', rows: filas },
});
const montar = (nombre: string | null, filas = FILAS, extra: Partial<Parameters<typeof MisEquipos>[0]> = {}) =>
  render(<MisEquipos nombre={nombre} pedir={vi.fn(async () => structuredClone(resp(filas)))} {...extra} />);
const listo = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const grupo = (n: string) => screen.getByRole('region', { name: n });

describe('MisEquipos: identidad', () => {
  it('un único técnico que coincide se usa sin preguntar', async () => {
    montar(UNO);
    await listo();
    expect(screen.queryByText('¿Quién eres?')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(4);
  });
  it('sin coincidencia, «¿Quién eres?» lista los técnicos distintos y la elección se guarda y se reutiliza', async () => {
    montar('Alguien Más');
    await listo();
    const lista = within(screen.getByRole('group', { name: '¿Quién eres?' }));
    expect(lista.getAllByRole('button').map((b) => b.textContent)).toEqual([UNO, 'Técnico Dos']);
    fireEvent.click(lista.getByRole('button', { name: 'Técnico Dos' }));
    expect(localStorage.getItem(CLAVE_TECNICO)).toBe('Técnico Dos');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    cleanup();
    montar('Alguien Más');
    await listo();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
  it('dos técnicos que coinciden también preguntan; «Cambiar» reabre el selector', async () => {
    montar('Técnico Pérez', [...FILAS, fila('18A90006', '2026-11-05', 'Ingresado', 'Técnico Tres Pérez'), fila('18A90007', '2026-11-05', 'Ingresado', 'Técnico Cuatro Pérez')]);
    await listo();
    expect(screen.getByRole('group', { name: '¿Quién eres?' })).toBeTruthy();
    cleanup();
    montar(UNO);
    await listo();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByRole('group', { name: '¿Quién eres?' })).toBeTruthy();
  });
  it('un nombre guardado que no está en el tablero muestra aviso y deja el selector', async () => {
    localStorage.setItem(CLAVE_TECNICO, 'Carlos Ruiz');
    montar(UNO);
    await listo();
    expect(screen.getByText(/No hay equipos asignados a Carlos Ruiz/)).toBeTruthy();
    expect(screen.getByRole('group', { name: '¿Quién eres?' })).toBeTruthy();
  });
  it('si el almacenamiento local falla, sigue funcionando', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } });
    montar('Alguien Más');
    await listo();
    fireEvent.click(screen.getByRole('button', { name: 'Técnico Dos' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});

describe('MisEquipos: lista y cabecera', () => {
  it('agrupa por columna en el orden del tablero, con cuenta y tarjetas por antigüedad', async () => {
    montar(UNO);
    await listo();
    const grupos = screen.getAllByRole('region').map((g) => g.getAttribute('aria-label'));
    expect(grupos).toEqual(['Rev. / Diagnóstico', 'Notificación cliente', 'Por entregar']);
    const g = grupo('Notificación cliente');
    expect(within(g).getByLabelText('Total 2')).toBeTruthy();
    expect(within(g).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Equipo 18A90001', 'Equipo 18A90002']);
  });
  it('la tarjeta muestra serial, píldora suave de días, equipo y «Cliente · #ticket»', async () => {
    montar(UNO);
    await listo();
    const t = screen.getByLabelText('Equipo 18A90001');
    expect(within(t).getByText('18A90001').className).toContain('tt-mono');
    expect(within(t).getByText('102 d').className).toContain('tt-dias-suave-rojo');
    expect(within(t).getByText('EDM180C')).toBeTruthy();
    expect(within(t).getByText('Cliente Demo · #1234')).toBeTruthy();
  });
  it('es de solo lectura: sin botones de acción ni campos (solo «Cambiar», «Escanear S/N» y el enlace al taller)', async () => {
    montar(UNO);
    await listo();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cambiar', 'Escanear S/N']);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(document.querySelector('input,textarea,select,video')).toBeNull();
  });
  it('cabecera: «Mis equipos», nombre y mini KPIs (asignados, esperan cliente, más de 90 d)', async () => {
    montar(UNO);
    await listo();
    expect(screen.getByRole('heading', { name: UNO })).toBeTruthy();
    expect(screen.getByText('Mis equipos')).toBeTruthy();
    const kpis = within(screen.getByRole('list', { name: 'Indicadores' })).getAllByRole('listitem').map((x) => x.textContent);
    expect(kpis).toEqual(['4Asignados', '2Esperan cliente', '1Más de 90 d']);
  });
});

describe('MisEquipos: navegación y sondeo', () => {
  it('«Ver taller completo» va a la pestaña del tablero y mide al menos 44 px', async () => {
    montar(UNO);
    await listo();
    const a = screen.getByRole('link', { name: 'Ver taller completo' });
    expect(a.getAttribute('href')).toBe('/equipos-taller?vista=tablero');
    expect(a.className).toContain('tt-mis-boton');
  });
  it('sondea cada 60 s, avisa si pasan más de 5 minutos sin acierto y limpia al desmontar', async () => {
    const pedir = vi.fn(async () => structuredClone(resp()));
    const { unmount } = render(<MisEquipos nombre={UNO} pedir={pedir} />);
    await listo();
    pedir.mockRejectedValue(new Error('red'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000 * 7); });
    expect(pedir.mock.calls.length).toBeGreaterThan(3);
    expect(screen.getByRole('alert').textContent).toContain('Datos desactualizados');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('sin datos todavía o sin acceso no queda en blanco', async () => {
    montar(UNO, FILAS, { pedir: vi.fn(async () => { throw Object.assign(new Error('x'), { status: 401 }); }) });
    expect(screen.getByText('Cargando tablero…')).toBeTruthy();
    await listo();
    expect(screen.getByRole('alert').textContent).toContain('No tienes acceso');
  });
});

describe('MisEquipos: Escanear S/N', () => {
  const abrir = async () => { montar(UNO); await listo(); fireEvent.click(screen.getByRole('button', { name: 'Escanear S/N' })); };
  const buscar = (sn: string) => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Número de serie' }), { target: { value: sn } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
  };
  const camara = (lectura: string) => {
    const parar = vi.fn();
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => [{ rawValue: lectura }]); });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: parar }] })) } });
    return parar;
  };
  afterEach(() => { Reflect.deleteProperty(navigator, 'mediaDevices'); });

  it('a mano: encuentra el equipo en todo el taller (sin importar mayúsculas) o avisa que no existe', async () => {
    await abrir();
    buscar(' 18a90005 ');
    expect(within(screen.getByRole('region', { name: 'Resultado de la búsqueda' })).getByLabelText('Equipo 18A90005')).toBeTruthy();
    buscar('NOEXISTE1');
    expect(screen.getByText('No hay un equipo con el S/N NOEXISTE1.')).toBeTruthy();
  });
  it('sin lector de códigos del navegador solo ofrece la entrada manual', async () => {
    await abrir();
    expect(screen.queryByRole('button', { name: 'Usar la cámara' })).toBeNull();
  });
  it('con cámara: lee el código, muestra el equipo y apaga la cámara', async () => {
    const parar = camara('18A90005');
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Usar la cámara' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByLabelText('Equipo 18A90005')).toBeTruthy();
    expect(parar).toHaveBeenCalled();
  });
  it('cerrar el panel con la cámara encendida la apaga y no deja temporizadores propios', async () => {
    const parar = camara('SINLECTURA');
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Usar la cámara' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(parar).toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
