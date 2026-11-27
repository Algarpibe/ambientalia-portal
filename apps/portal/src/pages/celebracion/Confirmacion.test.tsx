// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Confirmacion from './Confirmacion';
import { eventoDePrueba } from './fixtures';
import type { Respuesta } from './tipos';

afterEach(() => {
  cleanup();
});

const VA: Respuesta = { asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!', actualizadoEn: '2026-12-01T15:00:00Z' };

function pintar(respuesta: Respuesta | null, abiertas = true) {
  const onGuardar = vi.fn(async () => {});
  render(<Confirmacion evento={eventoDePrueba({ confirmacionesAbiertas: abiertas })} respuesta={respuesta} onGuardar={onGuardar} />);
  return onGuardar;
}

describe('Confirmacion', () => {
  it('sin responder: «Sí voy» pide el menú y guarda lo elegido', async () => {
    const onGuardar = pintar(null);
    const enviar = screen.getByRole('button', { name: /Confirmar respuesta/ }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Sí voy/ }));
    fireEvent.change(screen.getByLabelText('Preferencia de menú'), { target: { value: 'vegetariano' } });
    fireEvent.click(enviar);
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ asiste: true, preferencia: 'vegetariano', mensaje: null }));
  });

  it('sin responder: «No podré ir» no pide menú y manda el mensaje recortado', async () => {
    const onGuardar = pintar(null);
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    expect(screen.queryByLabelText('Preferencia de menú')).toBeNull();
    fireEvent.change(screen.getByLabelText('Mensaje o brindis (opcional)'), { target: { value: '  ¡Feliz año!  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(onGuardar).toHaveBeenCalledWith({ asiste: false, preferencia: null, mensaje: '¡Feliz año!' }));
  });

  it('respondida y abierta: enseña la respuesta y deja cambiarla con lo anterior ya puesto', () => {
    pintar(VA);
    expect(screen.getByText(/Vas al almuerzo · Opción vegetariana/)).toBeTruthy();
    expect(screen.getByText('“¡Allá estaré!”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Cambiar respuesta/ }));
    expect(screen.getByRole('button', { name: /Sí voy/ }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Preferencia de menú') as HTMLSelectElement).value).toBe('vegetariano');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: /Cambiar respuesta/ })).toBeTruthy();
  });

  it('cerrada sin respuesta: solo el aviso del cierre', () => {
    pintar(null, false);
    expect(screen.getByText('Las confirmaciones se cerraron el 4 de diciembre.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cerrada con respuesta: la respuesta y el aviso, sin poder cambiarla', () => {
    pintar(VA, false);
    expect(screen.getByText(/Vas al almuerzo/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cambiar respuesta/ })).toBeNull();
  });

  it('si guardar falla, el formulario sigue abierto', async () => {
    const onGuardar = vi.fn(async () => {
      throw new Error('red');
    });
    render(<Confirmacion evento={eventoDePrueba()} respuesta={null} onGuardar={onGuardar} />);
    fireEvent.click(screen.getByRole('button', { name: /No podré ir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirmar respuesta/ }));
    await waitFor(() => expect(onGuardar).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Confirmar respuesta/ })).toBeTruthy();
  });
});
