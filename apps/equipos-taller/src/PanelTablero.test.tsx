// @vitest-environment jsdom
// Panel de ajustes del tablero (Ajustes del portal): cada fila (umbrales, horas, indicadores) se guarda
// con su propio «Guardar», solo si cambió y el resultado es válido. Todo ficticio.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ApiTablero } from './api';
import { AJUSTES_TABLERO_POR_DEFECTO, type AjustesTablero } from './nucleo';
import PanelTablero from './PanelTablero';

afterEach(cleanup);

function montar(falla = false) {
  const guardar = vi.fn(async (p: Partial<AjustesTablero>): Promise<AjustesTablero> => {
    if (falla) throw new Error('Ajustes no válidos');
    return { ...AJUSTES_TABLERO_POR_DEFECTO, ...p };
  });
  const api = { ajustesTablero: async () => structuredClone(AJUSTES_TABLERO_POR_DEFECTO), guardarAjustesTablero: guardar } as unknown as ApiTablero;
  const avisos: string[] = [];
  render(<PanelTablero api={api} avisar={(t, k) => avisos.push(k + ': ' + t)} />);
  return { guardar, avisos };
}
const guardarDe = (fila: string) => screen.getByRole('button', { name: 'Guardar ' + fila }) as HTMLButtonElement;
const campo = (n: string) => screen.getByLabelText(n) as HTMLInputElement;

describe('PanelTablero', () => {
  it('carga los valores vigentes; «Guardar» solo se activa en la fila que cambió y envía solo esa fila', async () => {
    const { guardar, avisos } = montar();
    await screen.findByLabelText('Umbral ámbar (días)');
    expect(campo('Umbral rojo (días)').value).toBe('90');
    for (const f of ['umbrales', 'horas nocturnas', 'indicadores']) expect(guardarDe(f).disabled).toBe(true);

    fireEvent.change(campo('Umbral ámbar (días)'), { target: { value: '20' } });
    expect(guardarDe('umbrales').disabled).toBe(false);
    expect(guardarDe('horas nocturnas').disabled).toBe(true);
    fireEvent.click(guardarDe('umbrales'));
    await waitFor(() => expect(guardar).toHaveBeenCalledWith({ umbralAmbar: 20, umbralRojo: 90 }));
    await waitFor(() => expect(guardarDe('umbrales').disabled).toBe(true));
    expect(avisos).toEqual(['info: Umbrales guardados.']);
  });

  it('valida en línea como el servidor y no deja guardar: rojo ≤ ámbar, hora fuera de 0–23, indicadores ≠ 5', async () => {
    montar();
    await screen.findByLabelText('Umbral ámbar (días)');
    fireEvent.change(campo('Umbral rojo (días)'), { target: { value: '30' } });
    expect(screen.getByRole('alert').textContent).toMatch(/mayor que el ámbar/);
    expect(guardarDe('umbrales').disabled).toBe(true);

    fireEvent.change(campo('Noche desde (hora)'), { target: { value: '24' } });
    expect(guardarDe('horas nocturnas').disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /Entregados/ }));
    expect(screen.getAllByRole('alert').some((a) => /exactamente 5/.test(a.textContent ?? ''))).toBe(true);
    expect(guardarDe('indicadores').disabled).toBe(true);
  });

  it('indicadores: quitar uno y elegir otro (siguen siendo 5) se guarda en orden de elección', async () => {
    const { guardar } = montar();
    await screen.findByLabelText('Umbral ámbar (días)');
    fireEvent.click(screen.getByRole('checkbox', { name: /Entregados/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Retirado/ }));
    fireEvent.click(guardarDe('indicadores'));
    await waitFor(() => expect(guardar).toHaveBeenCalledWith({ kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo', 'retirado'] }));
  });

  it('si el servidor rechaza, avisa y conserva el borrador para reintentar', async () => {
    const { avisos } = montar(true);
    await screen.findByLabelText('Umbral ámbar (días)');
    fireEvent.change(campo('Noche desde (hora)'), { target: { value: '19' } });
    fireEvent.click(guardarDe('horas nocturnas'));
    await waitFor(() => expect(avisos).toEqual(['error: No se pudieron guardar las horas nocturnas: Ajustes no válidos']));
    expect(campo('Noche desde (hora)').value).toBe('19');
    expect(guardarDe('horas nocturnas').disabled).toBe(false);
  });
});
