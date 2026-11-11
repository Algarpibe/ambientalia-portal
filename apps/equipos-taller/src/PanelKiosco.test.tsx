// @vitest-environment jsdom
// Panel de llaves de la TV (Ajustes del portal): lista sin secretos, «Generar» con el secreto mostrado una
// sola vez (URL completa + «Copiar») y «Revocar» con confirmación en línea. Todo ficticio.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiTablero } from './api';
import type { Kiosco } from './nucleo';
import PanelKiosco from './PanelKiosco';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const SECRETO = 'tvk_' + 'A'.repeat(43);
const base: Kiosco = { id: 'k1', nombre: 'TV Prueba', creadoPor: 'admin@ambientalia.com.co', creadoEn: '2026-11-10T15:00:00Z', revocadoEn: null, ultimoUsoEn: null };
const revocada: Kiosco = { ...base, id: 'k2', nombre: 'TV Vieja', revocadoEn: '2026-11-11T15:00:00Z', ultimoUsoEn: '2026-11-11T10:00:00Z' };

function montar(lista: Kiosco[] = [base, revocada]) {
  const api = {
    kioscos: vi.fn(async () => structuredClone(lista)),
    crearKiosco: vi.fn(async (nombre: string) => ({ kiosco: { ...base, id: 'k3', nombre }, secreto: SECRETO })),
    revocarKiosco: vi.fn(async (_id: string) => undefined),
  };
  const avisos: string[] = [];
  render(<PanelKiosco api={api as unknown as ApiTablero} avisar={(t, k) => avisos.push(k + ': ' + t)} />);
  return { api, avisos };
}
const boton = (n: string) => screen.getByRole('button', { name: n });

describe('PanelKiosco', () => {
  it('lista nombre, uso y estado; solo las llaves activas se pueden revocar; nunca se ve un secreto', async () => {
    montar();
    expect(await screen.findByText('TV Prueba')).toBeTruthy();
    expect(screen.getByText('Nunca')).toBeTruthy();
    expect(screen.getByText(/Revocada/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Revocar/ })).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/tvk_/);
  });

  it('«Generar» muestra el secreto UNA vez con la URL completa; «Copiar» la copia y, al cerrar, no vuelve a verse', async () => {
    const copiar = vi.fn(async (_t: string) => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: copiar } });
    const { api, avisos } = montar();
    await screen.findByText('TV Prueba');
    fireEvent.change(screen.getByLabelText('Nombre de la pantalla'), { target: { value: ' TV Nueva ' } });
    fireEvent.click(boton('Generar'));
    const url = `${location.origin}/equipos-taller/tv#k=${SECRETO}`;
    await waitFor(() => expect((screen.getByLabelText('Dirección de la pantalla') as HTMLInputElement).value).toBe(url));
    expect(api.crearKiosco).toHaveBeenCalledWith('TV Nueva');
    fireEvent.click(boton('Copiar'));
    await waitFor(() => expect(copiar).toHaveBeenCalledWith(url));
    expect(avisos).toContain('info: Dirección copiada.');
    fireEvent.click(boton('Cerrar'));
    expect(document.body.innerHTML).not.toContain(SECRETO);
    expect(api.kioscos).toHaveBeenCalledTimes(2); // la lista se vuelve a pedir
  });

  it('si no se puede copiar, lo avisa y deja la dirección a la vista para copiarla a mano', async () => {
    vi.stubGlobal('navigator', {});
    const { avisos } = montar();
    await screen.findByText('TV Prueba');
    fireEvent.change(screen.getByLabelText('Nombre de la pantalla'), { target: { value: 'TV Nueva' } });
    fireEvent.click(boton('Generar'));
    await screen.findByLabelText('Dirección de la pantalla');
    fireEvent.click(boton('Copiar'));
    await waitFor(() => expect(avisos[0]).toMatch(/^error: No se pudo copiar/));
  });

  it('revocar pide confirmación en línea (sin diálogos del navegador) y se puede cancelar', async () => {
    const { api, avisos } = montar();
    await screen.findByText('TV Prueba');
    fireEvent.click(boton('Revocar TV Prueba'));
    fireEvent.click(boton('Cancelar'));
    expect(api.revocarKiosco).not.toHaveBeenCalled();
    fireEvent.click(boton('Revocar TV Prueba'));
    fireEvent.click(boton('¿Seguro? Revocar TV Prueba'));
    await waitFor(() => expect(api.revocarKiosco).toHaveBeenCalledWith('k1'));
    await waitFor(() => expect(avisos).toContain('info: Llave de TV Prueba revocada.'));
    expect(api.kioscos).toHaveBeenCalledTimes(2);
  });

  it('un nombre repetido o inválido se avisa con el texto del servidor', async () => {
    const { api, avisos } = montar();
    api.crearKiosco.mockRejectedValueOnce(new Error('Ya hay una llave activa con ese nombre'));
    await screen.findByText('TV Prueba');
    fireEvent.change(screen.getByLabelText('Nombre de la pantalla'), { target: { value: 'TV Prueba' } });
    fireEvent.click(boton('Generar'));
    await waitFor(() => expect(avisos).toEqual(['error: No se pudo generar la llave: Ya hay una llave activa con ese nombre']));
  });
});
