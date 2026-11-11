// @vitest-environment jsdom
// La pantalla con una API simulada: vistas, conteos, ilegibles en «Revisar», ajustes, el
// aviso de foto vieja, «Actualizando…» sin botón, los botones ocultos sin la llave y el panel
// de llaves. Todo ficticio.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CAUSA_TEXTOS_FALLIDOS, EST, type Ajuste, type AjusteFirmado, type Corrida, type Fila, type RespuestaEquipos, type UsuarioConLlaves } from './nucleo';
import EquiposServicio from './EquiposServicio';
import type { ApiEquipos } from './api';

const fila = (sn: string, d: string, est: Fila['est'], extra: Partial<Fila> = {}): Fila =>
  ({ id: 'F' + sn, d, c: 'Cliente A', sn, est, src: '', why: ['Entrada ' + d], x: null, z: null, zc: false, pa: [], xd: '', eq: '', ...extra });
const corrida = (c: Partial<Corrida> = {}): Corrida =>
  ({ id: 1, origen: 'programada', inicio: '2026-11-09T11:30:00Z', fin: '2026-11-09T11:35:00Z', enCurso: false, ok: true, causa: null, avisos: ['Carpeta de entrada con nombre no reconocido: X'], conteos: null, ...c });
const estado = (o: Partial<RespuestaEquipos> = {}): RespuestaEquipos => ({
  actualizando: false,
  configurado: true,
  ultima: corrida(),
  ultimaBuena: corrida(),
  incidente: null,
  permisos: { editaAjustes: true, recibeAlertas: false, esAdmin: false, puedeEditar: true },
  ajustes: {},
  snap: {
    at: '2026-11-09T11:35:00Z', hoy: '2026-11-09',
    rows: [
      fila('18A90001', '2026-06-01', EST.TALLER, { z: { n: '1401', id: '1', st: 'Rev./Diagnostico', stt: 'Open', u: 'https://x/1401', m: '', enc: 'Técnico Uno', eq: 'EDM180C', srv: 'Calibración', fs: '', cl: '' } }),
      fila('G7XN900T', '2026-09-14', EST.REVISAR, { c: 'Cliente B', eq: 'APNA-370 · Horiba', x: { n: 'Sin ticket y sin salida', q: '56 días' } }),
      fila('18A90003', '2026-09-16', EST.ENTREGADO, { xd: '2026-10-09', z: { n: '1402', id: '2', st: 'Por facturar', stt: 'Open', u: 'https://x/1402', m: '', enc: '', eq: 'EDM180C', srv: '', fs: '', cl: '' } }),
    ],
    ilegibles: [
      { id: 'PDF1abcdefghij', n: '260707 - CLIENTE A.pdf', d: '2026-07-07', m: 'sin texto legible', q: 'El escaneo no tiene texto legible', p: [{ sn: '18A90001', d: '2026-06-01', est: EST.TALLER, c: 'Cliente A' }] },
      { id: 'PDF2abcdefghij', n: '260115 - CLIENTE C.pdf', d: '2026-01-15', m: 'serial ilegible', q: 'El OCR leyó «18#90417»', p: [] },
    ],
  },
  ...o,
});
function apiFalsa(o: Partial<RespuestaEquipos> = {}) {
  const e = estado(o);
  const llamadas: string[] = [];
  const usuarios: UsuarioConLlaves[] = [{ userId: 'u1', nombre: 'Persona Uno', email: 'p1@ambientalia.com.co', esAdmin: false, editaAjustes: false, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null }];
  const api: ApiEquipos = {
    estado: async () => structuredClone(e),
    guardarAjuste: async (k, t: Ajuste['t'], m = '') => { llamadas.push('put ' + k + ' ' + t + ' ' + m); const a: AjusteFirmado = { t, m, at: '2026-11-09', usuario: 'yo', creadoEn: '' }; e.ajustes[k] = a; return a; },
    borrarAjuste: async (k) => { llamadas.push('delete ' + k); delete e.ajustes[k]; },
    llaves: async () => { llamadas.push('llaves'); return structuredClone(usuarios); },
    guardarLlaves: async (userId, l) => { llamadas.push('llaves ' + userId + ' ' + l.editaAjustes + ' ' + l.recibeAlertas); return { ...usuarios[0], ...l }; },
  };
  return { api, llamadas };
}
afterEach(cleanup);
const chip = async (n: RegExp) => within(await screen.findByRole('navigation', { name: 'Vistas' })).getByRole('button', { name: n });
const chipYa = (n: RegExp) => within(screen.getByRole('navigation', { name: 'Vistas' })).getByRole('button', { name: n });

describe('pantalla Equipos en taller (trasladada sin rediseño)', () => {
  it('muestra los conteos por vista y las remisiones ilegibles pendientes junto a Revisar', async () => {
    render(<EquiposServicio api={apiFalsa().api} />);
    const nav = await screen.findByRole('navigation', { name: 'Vistas' });
    await waitFor(() => expect(within(nav).getByRole('button', { name: /En taller/ }).textContent).toBe('1En taller'));
    expect(within(nav).getByRole('button', { name: /Revisar/ }).textContent).toBe('1Revisar+ 2 remisiones ilegibles');
    expect(within(nav).getByRole('button', { name: /Salió con ticket abierto/ }).textContent).toBe('1Salió con ticket abierto');
    expect(screen.getByText('Técnico Uno')).toBeTruthy();
    expect(screen.getByText('1 aviso en la última ejecución')).toBeTruthy();
  });

  it('ocupa todo el ancho de la pantalla (sin ancho máximo)', async () => {
    render(<EquiposServicio api={apiFalsa().api} />);
    const main = await screen.findByRole('main');
    expect(main.className).not.toMatch(/\bmax-w-/);
    expect(main.className).toMatch(/\bw-full\b/);
  });

  it('equipo y cliente van en columnas separadas', async () => {
    render(<EquiposServicio api={apiFalsa().api} />);
    const celda = (await screen.findByText('18A90001')).closest('tr')!.querySelectorAll('td');
    const cabecera = [...screen.getAllByRole('columnheader')].map((h) => h.textContent);
    expect(cabecera.slice(0, 3)).toEqual(['S/N', 'Equipo', 'Cliente']);
    expect(celda[1].textContent).toBe('EDM180C');
    expect(celda[2].textContent).toBe('Cliente A');
  });

  it('en Revisar lista las remisiones ilegibles, sugiere el equipo y permite marcarlas como revisadas', async () => {
    const { api, llamadas } = apiFalsa();
    render(<EquiposServicio api={api} />);
    fireEvent.click(await chip(/Revisar/));
    expect(screen.getByRole('heading', { name: 'Remisiones de salida escaneadas ilegibles (2)' })).toBeTruthy();
    expect(screen.getByText(/Puede ser la salida de:/).parentElement!.textContent).toMatch(/18A90001 \(Cliente A, entrada 2026-06-01 · En taller\)/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ya revisada' })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'es la salida de 18A90001' } });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Motivo' })); // el campo no pierde el foco al escribir
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: 'Remisiones de salida escaneadas ilegibles (1)' });
    expect(llamadas).toContain('put pdf:PDF1abcdefghij pdf es la salida de 18A90001');
    expect(screen.getByText('Ya revisadas (1)')).toBeTruthy();
  });

  it('«Sigue en taller» pasa el equipo de Revisar a En taller y «Deshacer ajuste» lo devuelve', async () => {
    const { api, llamadas } = apiFalsa();
    render(<EquiposServicio api={api} />);
    fireEvent.click(await chip(/Revisar/));
    fireEvent.click(screen.getByRole('button', { name: 'Sigue en taller' }));
    await waitFor(() => expect(chipYa(/En taller/).textContent).toBe('2En taller'));
    expect(llamadas[0]).toBe('put GTXN900T|2026-09-14 in ');
    fireEvent.click(chipYa(/En taller/));
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer ajuste' }));
    await waitFor(() => expect(chipYa(/En taller/).textContent).toBe('1En taller'));
  });

  it('filtra por cliente y por estado en Desk, con los conteos de las vistas', async () => {
    render(<EquiposServicio api={apiFalsa().api} />);
    const cliente = await screen.findByRole('combobox', { name: /Cliente/ });
    await waitFor(() => expect([...(cliente as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Todos (1)', 'Cliente A (1)']));
    fireEvent.click(await chip(/Revisar/));
    expect([...(screen.getByRole('combobox', { name: /Cliente/ }) as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Todos (1)', 'Cliente B (1)']);
    fireEvent.change(screen.getByRole('combobox', { name: /Cliente/ }), { target: { value: 'CLIENTE B' } });
    expect(chipYa(/En taller/).textContent).toBe('0En taller');
    expect(chipYa(/Revisar/).textContent).toMatch(/^1Revisar/);
    expect(screen.getByText('G7XN900T')).toBeTruthy();
    expect([...(screen.getByRole('combobox', { name: /Estado en Desk/ }) as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Todos (1)', 'Sin ticket (1)']);
    fireEvent.change(screen.getByRole('combobox', { name: /Estado en Desk/ }), { target: { value: 'Sin ticket' } });
    expect(screen.getByText('G7XN900T')).toBeTruthy();
    fireEvent.click(chipYa(/En taller/));
    expect(screen.getByText('No hay equipos en esta vista con los filtros elegidos.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(chipYa(/En taller/).textContent).toBe('1En taller');
  });

  it('no hay botón para actualizar: la pantalla se actualiza sola', async () => {
    render(<EquiposServicio api={apiFalsa().api} />);
    await screen.findByRole('navigation', { name: 'Vistas' });
    expect(screen.queryByRole('button', { name: /Actualiz/ })).toBeNull();
  });

  it('sin foto todavía, dice que se actualiza sola cada hora', async () => {
    render(<EquiposServicio api={apiFalsa({ snap: null }).api} />);
    expect(await screen.findByText('Aún no hay datos. Se actualiza sola cada hora, cuando termina la sincronización con n8n.')).toBeTruthy();
  });

  it('una foto sin la lista de ilegibles dice que saldrá con la próxima actualización, sin mandar a pulsar nada', async () => {
    const { snap } = estado();
    render(<EquiposServicio api={apiFalsa({ snap: { ...snap!, ilegibles: undefined } }).api} />);
    fireEvent.click(await chip(/Revisar/));
    expect(screen.getByText('Las remisiones escaneadas ilegibles saldrán aquí en la próxima actualización. Se actualiza sola cada hora, cuando termina la sincronización con n8n.')).toBeTruthy();
    expect(screen.queryByText(/Pulsa/)).toBeNull();
  });
});

describe('actualización en curso (la de cada hora o la diaria)', () => {
  it('la cabecera dice «Actualizando…» como texto, no como botón, y desaparece cuando la corrida termina', async () => {
    const { api } = apiFalsa();
    let activa = true;
    const base = api.estado;
    api.estado = async () => ({ ...(await base()), actualizando: activa });
    render(<EquiposServicio api={api} />);
    expect(await screen.findByText('Actualizando…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Actualiz/ })).toBeNull();
    activa = false;
    await waitFor(() => expect(screen.queryByText('Actualizando…')).toBeNull(), { timeout: 6000 });
  }, 10000);

  it('al terminar vuelve a pedir los datos: muestra la foto nueva aunque la última consulta aún trajera la vieja', async () => {
    const { api } = apiFalsa();
    const base = api.estado;
    let termino = false;
    let tras = 0;
    api.estado = async () => {
      const e = await base();
      if (!termino) return { ...e, actualizando: true };
      // La primera respuesta tras terminar aún trae la foto vieja (se leyó justo antes del cierre).
      if (tras++ === 0) return { ...e, actualizando: false };
      return { ...e, actualizando: false, snap: { ...e.snap!, rows: [...e.snap!.rows, fila('18A90009', '2026-10-01', EST.TALLER)] } };
    };
    render(<EquiposServicio api={api} />);
    await screen.findByText('Actualizando…');
    expect((await chip(/En taller/)).textContent).toBe('1En taller');
    termino = true;
    await waitFor(() => expect(chipYa(/En taller/).textContent).toBe('2En taller'), { timeout: 6000 });
    expect(screen.queryByText('Actualizando…')).toBeNull();
  }, 10000);
});

describe('lo nuevo en el portal', () => {
  it('sin la llave «edita ajustes» no hay botones de ajuste (ni en Revisar ni en las ilegibles)', async () => {
    render(<EquiposServicio api={apiFalsa({ permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: false, puedeEditar: false } }).api} />);
    fireEvent.click(await chip(/Revisar/));
    expect(screen.queryByRole('button', { name: 'Sigue en taller' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Marcar retirado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ya revisada' })).toBeNull();
  });

  it('si la última corrida falló, avisa de qué y de cuándo son los datos', async () => {
    render(<EquiposServicio api={apiFalsa({ ultima: corrida({ id: 2, ok: false, causa: 'desk2: sin conexión', avisos: [] }) }).api} />);
    const a = await screen.findByRole('alert');
    expect(a.textContent).toMatch(/^No se pudo leer Desk 2\.0; datos del /);
    expect(a.className).not.toMatch(/font-semibold/);
  });

  it('si n8n no pudo leer los textos de Drive, el aviso lo dice así', async () => {
    render(<EquiposServicio api={apiFalsa({ ultima: corrida({ id: 2, ok: false, causa: CAUSA_TEXTOS_FALLIDOS, avisos: [] }) }).api} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/^n8n no pudo leer las remisiones de Drive; datos del /);
  });

  it('con 2 o más corridas programadas fallidas el aviso va destacado', async () => {
    render(<EquiposServicio api={apiFalsa({ ultima: corrida({ id: 3, ok: false, causa: 'drive: HTTP 403' }), incidente: { id: 1, abiertoEn: '', fallosProgramados: 2, alertaEnviadaEn: null, alertaUltimoError: null } }).api} />);
    const a = await screen.findByRole('alert');
    expect(a.textContent).toMatch(/^No se pudo leer Google Drive/);
    expect(a.className).toMatch(/font-semibold/);
  });

  it('sin configurar: lo dice', async () => {
    render(<EquiposServicio api={apiFalsa({ configurado: false }).api} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Falta la primera sincronización con n8n');
  });

  it('el panel de llaves ya no está en esta pantalla (vive en Ajustes), ni para un admin', async () => {
    const { api } = apiFalsa({ permisos: { editaAjustes: false, recibeAlertas: false, esAdmin: true, puedeEditar: true } });
    render(<EquiposServicio api={api} />);
    await screen.findByRole('navigation', { name: 'Vistas' });
    expect(screen.queryByText('Llaves de la app')).toBeNull();
  });
});
