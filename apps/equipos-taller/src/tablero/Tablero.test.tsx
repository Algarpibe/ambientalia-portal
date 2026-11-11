// @vitest-environment jsdom
// El tablero en pantalla: columnas, tarjetas, KPIs, leyenda, densidad, sondeo y avisos. Datos ficticios.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import {
  AJUSTES_TABLERO_POR_DEFECTO, EST, aplicarAjustes, construirTablero,
  type AjustesTablero, type Fila, type RespuestaEquipos,
} from '../nucleo';
import type { ApiEquipos } from '../api';
import Tablero, { TableroVista, hhmm } from './Tablero';

const AHORA = Date.parse('2026-11-11T20:00:00Z'); // 15:00 en Bogotá
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const z = (n: string, st: string, enc: string) => ({ n, id: n, st, stt: 'Open', u: 'https://x/' + n, m: '', enc, eq: 'EDM180C', srv: '', fs: '', cl: '' });
const fila = (sn: string, d: string, extra: Partial<Fila> = {}): Fila =>
  ({ id: 'F' + sn, d, c: 'Cliente A', sn, est: EST.TALLER, src: '', why: [], x: null, z: null, zc: false, pa: [], xd: '', eq: '', ...extra });
const FILAS: Fila[] = [
  fila('18A90001', '2026-06-01', { z: z('1401', 'Rev./Diagnostico', 'Técnico Uno') }),
  fila('18A90002', '2026-11-01', { z: z('1402', 'Notificación cliente', '') }),
  fila('G7XN900T', '2026-10-20', { c: 'Cliente B', eq: 'APNA-370' }),
  fila('18A90004', '2026-09-01', { est: EST.ENTREGADO, xd: '2026-10-09' }),
];
const modelo = (filas = FILAS, cfg: AjustesTablero = AJUSTES_TABLERO_POR_DEFECTO) => construirTablero(aplicarAjustes(filas, {}), cfg, AHORA);
const columna = (nombre: string) => screen.getByRole('region', { name: nombre });

describe('TableroVista: columnas', () => {
  it('muestra las 6 columnas con nombre, descripción y el total verdadero', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    expect(screen.getAllByRole('region')).toHaveLength(6);
    const diag = columna('Rev. / Diagnóstico');
    expect(within(diag).getByText('Recibido, en revisión inicial')).toBeTruthy();
    expect(within(diag).getByLabelText('Total 1')).toBeTruthy();
    expect(within(columna('Entrada – Remisión')).getByLabelText('Total 1')).toBeTruthy();
    expect(within(columna('Por entregar')).getByText('Listo · esperando recogida')).toBeTruthy();
  });
  it('una columna vacía muestra «Sin equipos» y total 0', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    const ext = columna('Servicio externo');
    expect(within(ext).getByText('Sin equipos')).toBeTruthy();
    expect(within(ext).getByLabelText('Total 0')).toBeTruthy();
    expect(within(columna('Rev. / Diagnóstico')).queryByText('Sin equipos')).toBeNull();
  });
});

describe('TableroVista: tarjetas', () => {
  it('muestra serial, píldora de días, equipo, cliente y pie con técnico y #ticket', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    const t = within(screen.getByRole('article', { name: 'Equipo 18A90001' }));
    expect(t.getByText('18A90001')).toBeTruthy();
    expect(t.getByText('163 d')).toBeTruthy();
    expect(t.getByText('EDM180C')).toBeTruthy();
    expect(t.getByText('Cliente A')).toBeTruthy();
    expect(t.getByText('TU')).toBeTruthy();
    expect(t.getByText('Técnico Uno')).toBeTruthy();
    expect(t.getByText('#1401')).toBeTruthy();
  });
  it('con ticket y sin técnico: círculo punteado «?» y «Sin asignar»', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    const t = within(screen.getByRole('article', { name: 'Equipo 18A90002' }));
    expect(t.getByText('?')).toBeTruthy();
    expect(t.getByText('Sin asignar')).toBeTruthy();
    expect(t.getByText('#1402')).toBeTruthy();
  });
  it('sin ticket: etiqueta «Sin ticket» y pie neutro, sin «Sin asignar» ni #ticket', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    const t = within(screen.getByRole('article', { name: 'Equipo G7XN900T' }));
    expect(t.getByText('Sin ticket')).toBeTruthy();
    expect(t.getByText('Sin técnico')).toBeTruthy();
    expect(t.queryByText('Sin asignar')).toBeNull();
    expect(t.queryByText(/^#/)).toBeNull();
  });
  it('los entregados no son tarjetas', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    expect(screen.queryByRole('article', { name: 'Equipo 18A90004' })).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
  it('es de solo lectura: ningún botón ni campo', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});

describe('TableroVista: KPIs, leyenda y estado', () => {
  it('muestra los 5 KPIs configurados, en orden, con sus etiquetas', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    const kpis = within(screen.getByRole('list', { name: 'Indicadores' })).getAllByRole('listitem').map((x) => x.textContent);
    expect(kpis).toEqual(['3En taller', '0Por revisar', '0Salió con ticket abierto', '0Servicio externo', '1Entregados']);
  });
  it('la leyenda trae los umbrales de los ajustes y la fuente', () => {
    const cfg = { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 20, umbralRojo: 60 };
    render(<TableroVista tablero={modelo(FILAS, cfg)} ajustes={cfg} />);
    expect(screen.getByText('menos de 20 d')).toBeTruthy();
    expect(screen.getByText('20 – 60 d')).toBeTruthy();
    expect(screen.getByText('más de 60 d')).toBeTruthy();
    expect(screen.getByText('sin técnico asignado')).toBeTruthy();
    expect(screen.getByText('Ordenado por antigüedad · fuente: Zoho Desk + remisiones')).toBeTruthy();
  });
  it('línea de estado con la hora del último acierto y la de los datos, sin aviso si no es obsoleto', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} okEn={AHORA} datosEn="2026-11-11T11:35:00Z" />);
    expect(screen.getByText('Actualizado 15:00 · datos de las 06:35 · se refresca cada 60 s')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('aviso «Datos desactualizados desde HH:MM» cuando es obsoleto, con los datos a la vista', () => {
    render(<TableroVista tablero={modelo()} ajustes={AJUSTES_TABLERO_POR_DEFECTO} okEn={Date.parse('2026-11-11T19:00:00Z')} obsoleto />);
    expect(screen.getByRole('alert').textContent).toBe('Datos desactualizados desde 14:00');
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
  it('hhmm() usa la hora de Bogotá', () => {
    expect(hhmm(Date.parse('2026-11-11T03:05:00Z'))).toBe('22:05');
  });
});

describe('TableroVista: densidad con presupuesto', () => {
  const muchas = (n: number) => Array.from({ length: n }, (_, i) =>
    fila('S' + String(i).padStart(2, '0'), '2026-01-' + String(i + 1).padStart(2, '0'), { z: z('20' + i, 'Ingresado', 'Técnico Uno') }));
  const diag = () => columna('Rev. / Diagnóstico');

  it('hasta 3 tarjetas se dibujan completas', () => {
    render(<TableroVista tablero={modelo(muchas(3))} ajustes={AJUSTES_TABLERO_POR_DEFECTO} presupuesto />);
    expect(diag().getAttribute('data-densidad')).toBe('completa');
    expect(within(diag()).getAllByRole('article')).toHaveLength(3);
  });
  it('con más de las que caben, TODAS pasan a compactas y no se oculta ninguna', () => {
    render(<TableroVista tablero={modelo(muchas(5))} ajustes={AJUSTES_TABLERO_POR_DEFECTO} presupuesto />);
    expect(diag().getAttribute('data-densidad')).toBe('compacta');
    expect(within(diag()).getAllByRole('article')).toHaveLength(5);
    expect(within(diag()).queryByText(/más$/)).toBeNull();
  });
  it('más allá de lo compacto: las más antiguas y «+N más»; el total sigue verdadero', () => {
    render(<TableroVista tablero={modelo(muchas(9))} ajustes={AJUSTES_TABLERO_POR_DEFECTO} presupuesto />);
    expect(within(diag()).getByText('+4 más')).toBeTruthy();
    expect(within(diag()).getByLabelText('Total 9')).toBeTruthy();
    expect(within(diag()).getAllByRole('article')).toHaveLength(5);
    expect(within(diag()).getByRole('article', { name: 'Equipo S00' })).toBeTruthy();
    expect(within(diag()).queryByRole('article', { name: 'Equipo S08' })).toBeNull();
  });
  it('sin presupuesto (pestaña de la app) se muestran todas completas', () => {
    render(<TableroVista tablero={modelo(muchas(9))} ajustes={AJUSTES_TABLERO_POR_DEFECTO} />);
    expect(within(diag()).getAllByRole('article')).toHaveLength(9);
    expect(within(diag()).queryByText(/más$/)).toBeNull();
  });
});

describe('Tablero (con sondeo)', () => {
  const resp = (o: Partial<RespuestaEquipos> = {}): RespuestaEquipos => ({
    actualizando: false, configurado: true, ultima: null, ultimaBuena: null, incidente: null, ajustes: {},
    permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false },
    snap: { at: '2026-11-11T19:10:00Z', hoy: '2026-11-11', rows: FILAS },
    ...o,
  });
  const apiCon = (...pasos: (RespuestaEquipos | Error)[]) => {
    const estado = vi.fn(async (_s?: AbortSignal) => {
      const p = pasos[Math.min(estado.mock.calls.length - 1, pasos.length - 1)];
      if (p instanceof Error) throw p;
      return structuredClone(p);
    });
    return { estado } as unknown as ApiEquipos & { estado: typeof estado };
  };
  const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('mientras carga dice «Cargando tablero…»; luego dibuja las columnas con los ajustes por defecto', async () => {
    render(<Tablero api={apiCon(resp())} />);
    expect(screen.getByText('Cargando tablero…')).toBeTruthy();
    await avanzar(0);
    expect(screen.getAllByRole('region')).toHaveLength(6);
    expect(screen.getByText('menos de 30 d')).toBeTruthy();
  });
  it('usa los ajustes del servidor si vienen en la respuesta', async () => {
    render(<Tablero api={apiCon(resp({ tablero: { ...AJUSTES_TABLERO_POR_DEFECTO, umbralAmbar: 45, umbralRojo: 120 } }))} />);
    await avanzar(0);
    expect(screen.getByText('menos de 45 d')).toBeTruthy();
    expect(screen.getByText('más de 120 d')).toBeTruthy();
  });
  it('una foto de 50 minutos con consultas al día no muestra aviso', async () => {
    render(<Tablero api={apiCon(resp({ snap: { at: '2026-11-11T19:10:00Z', hoy: '2026-11-11', rows: FILAS } }))} />);
    await avanzar(0);
    await avanzar(600_000);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/datos de las 14:10/)).toBeTruthy();
  });
  it('si las consultas fallan más de 5 minutos: aviso con la hora del último acierto y los datos siguen', async () => {
    render(<Tablero api={apiCon(resp(), new Error('red'))} />);
    await avanzar(0);
    await avanzar(300_000);
    expect(screen.queryByRole('alert')).toBeNull();
    await avanzar(60_000);
    expect(screen.getByRole('alert').textContent).toBe('Datos desactualizados desde 15:00');
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
  it('si la primera consulta falla no queda en blanco: mensaje visible', async () => {
    render(<Tablero api={apiCon(new Error('red'))} />);
    await avanzar(0);
    expect(screen.getByRole('alert').textContent).toContain('No se pudo cargar el tablero');
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });
  it('un 401 dice que no hay acceso', async () => {
    render(<Tablero api={apiCon(Object.assign(new Error('Error 401'), { status: 401 }))} />);
    await avanzar(0);
    expect(screen.getByRole('alert').textContent).toContain('No tienes acceso');
  });
  it('sin foto todavía: «Aún no hay datos»', async () => {
    render(<Tablero api={apiCon(resp({ snap: null }))} />);
    await avanzar(0);
    expect(screen.getByText(/Aún no hay datos/)).toBeTruthy();
  });
  it('al desmontar no deja temporizadores', async () => {
    const { unmount } = render(<Tablero api={apiCon(resp())} />);
    await avanzar(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
