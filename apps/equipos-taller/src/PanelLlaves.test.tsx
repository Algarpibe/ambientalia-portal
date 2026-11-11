// @vitest-environment jsdom
// Panel de llaves (vive en Ajustes del portal): carga la lista al montarse y guarda cada casilla. Todo ficticio.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiEquipos } from './api';
import type { UsuarioConLlaves } from './nucleo';
import PanelLlaves from './PanelLlaves';

afterEach(cleanup);

const usuario: UsuarioConLlaves = { userId: 'u1', nombre: 'Persona Uno', email: 'p1@ambientalia.com.co', esAdmin: false, editaAjustes: false, recibeAlertas: false, actualizadoPor: null, actualizadoEn: null };

function apiFalsa(lista: UsuarioConLlaves[] = [usuario]) {
  const llamadas: string[] = [];
  const api = {
    llaves: async () => { llamadas.push('llaves'); return structuredClone(lista); },
    guardarLlaves: async (userId: string, l: { editaAjustes: boolean; recibeAlertas: boolean }) => { llamadas.push('llaves ' + userId + ' ' + l.editaAjustes + ' ' + l.recibeAlertas); return { ...lista[0], ...l }; },
  } as unknown as ApiEquipos;
  return { api, llamadas };
}

describe('PanelLlaves', () => {
  it('carga la lista al montarse (sin desplegar nada) y guarda cada casilla', async () => {
    const { api, llamadas } = apiFalsa();
    render(<PanelLlaves api={api} />);
    expect(await screen.findByText('Persona Uno')).toBeTruthy();
    expect(document.querySelector('details')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Recibe alertas: Persona Uno' }));
    await waitFor(() => expect(llamadas).toContain('llaves u1 false true'));
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
