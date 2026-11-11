// @vitest-environment jsdom
// Panel de llaves (vive en Ajustes del portal): carga la lista al montarse; las casillas son un
// borrador y cada fila se guarda con su botón «Guardar» (como «Frecuencia de correos»). Todo ficticio.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiEquipos } from './api';
import type { UsuarioConLlaves } from './nucleo';
import PanelLlaves from './PanelLlaves';

afterEach(cleanup);

const usuario: UsuarioConLlaves = { userId: 'u1', nombre: 'Persona Uno', email: 'p1@ambientalia.com.co', esAdmin: false, editaAjustes: false, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null };
const otro: UsuarioConLlaves = { ...usuario, userId: 'u2', nombre: 'Persona Dos', email: 'p2@ambientalia.com.co' };

function apiFalsa(lista: UsuarioConLlaves[] = [usuario], falla = false) {
  const llamadas: string[] = [];
  const api = {
    llaves: async () => { llamadas.push('llaves'); return structuredClone(lista); },
    guardarLlaves: async (userId: string, l: { editaAjustes: boolean; recibeAlertas: boolean }) => {
      llamadas.push('llaves ' + userId + ' ' + l.editaAjustes + ' ' + l.recibeAlertas);
      if (falla) throw new Error('Ese usuario no existe');
      return { ...lista.find((u) => u.userId === userId)!, ...l };
    },
  } as unknown as ApiEquipos;
  return { api, llamadas };
}

const guardarDe = (nombre: string) => screen.getByRole('button', { name: 'Guardar llaves de ' + nombre }) as HTMLButtonElement;

describe('PanelLlaves', () => {
  it('carga la lista al montarse; marcar una casilla NO guarda: lo hace el botón «Guardar» de esa fila', async () => {
    const { api, llamadas } = apiFalsa([usuario, otro]);
    const avisos: string[] = [];
    render(<PanelLlaves api={api} avisar={(t, k) => avisos.push(k + ': ' + t)} />);
    expect(await screen.findByText('Persona Uno')).toBeTruthy();
    expect(document.querySelector('details')).toBeNull();
    expect(guardarDe('Persona Uno').disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Recibe alertas: Persona Uno' }));
    expect(llamadas).not.toContain('llaves u1 false true');
    expect(guardarDe('Persona Uno').disabled).toBe(false);
    expect(guardarDe('Persona Dos').disabled).toBe(true);

    fireEvent.click(guardarDe('Persona Uno'));
    await waitFor(() => expect(llamadas).toContain('llaves u1 false true'));
    await waitFor(() => expect(guardarDe('Persona Uno').disabled).toBe(true));
    expect(avisos).toEqual(['info: Llaves de Persona Uno guardadas.']);
    expect((screen.getByRole('checkbox', { name: 'Recibe alertas: Persona Uno' }) as HTMLInputElement).checked).toBe(true);
  });

  it('volver a dejar la casilla como estaba desactiva «Guardar»', async () => {
    render(<PanelLlaves api={apiFalsa().api} />);
    await screen.findByText('Persona Uno');
    const casilla = screen.getByRole('checkbox', { name: 'Edita ajustes: Persona Uno' });
    fireEvent.click(casilla);
    expect(guardarDe('Persona Uno').disabled).toBe(false);
    fireEvent.click(casilla);
    expect(guardarDe('Persona Uno').disabled).toBe(true);
  });

  it('si no se puede guardar, lo avisa y conserva el cambio para reintentar', async () => {
    const avisos: string[] = [];
    render(<PanelLlaves api={apiFalsa([usuario], true).api} avisar={(t, k) => avisos.push(k + ': ' + t)} />);
    await screen.findByText('Persona Uno');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Edita ajustes: Persona Uno' }));
    fireEvent.click(guardarDe('Persona Uno'));
    await waitFor(() => expect(avisos).toEqual(['error: No se pudieron guardar las llaves de Persona Uno: Ese usuario no existe']));
    expect((screen.getByRole('checkbox', { name: 'Edita ajustes: Persona Uno' }) as HTMLInputElement).checked).toBe(true);
    expect(guardarDe('Persona Uno').disabled).toBe(false);
  });

  it('sin `avisar`, el resultado se muestra en el propio panel', async () => {
    render(<PanelLlaves api={apiFalsa().api} />);
    await screen.findByText('Persona Uno');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Recibe alertas: Persona Uno' }));
    fireEvent.click(guardarDe('Persona Uno'));
    expect((await screen.findByRole('status')).textContent).toBe('Llaves de Persona Uno guardadas.');
  });

  it('explica las dos llaves', async () => {
    render(<PanelLlaves api={apiFalsa().api} />);
    expect((await screen.findByText(/«Edita ajustes»/)).textContent).toMatch(/«Recibe alertas»/);
  });

  it('avisa si no se pudo cargar', async () => {
    const api = { llaves: async () => { throw new Error('boom'); } } as unknown as ApiEquipos;
    render(<PanelLlaves api={api} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/No se pudieron cargar las llaves: boom/);
  });
});
