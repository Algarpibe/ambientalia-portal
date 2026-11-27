// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ModalCualidades from './ModalCualidades';

const CUALIDADES = ['Liderazgo', 'Empatía', 'Compromiso', 'Creatividad', 'Trabajo en equipo'];

afterEach(() => {
  cleanup();
});

function pintar(seleccionInicial: string[] = []) {
  const props = {
    nombre: 'BRUNO DÍAZ',
    cualidades: CUALIDADES,
    max: 3,
    seleccionInicial,
    onGuardar: vi.fn(async () => {}),
    onCerrar: vi.fn(),
  };
  render(<ModalCualidades {...props} />);
  return props;
}

const boton = (nombre: RegExp) => screen.getByRole('button', { name: nombre }) as HTMLButtonElement;

describe('ModalCualidades', () => {
  it('es un diálogo titulado con el primer nombre', () => {
    pintar();
    expect(screen.getByRole('dialog', { name: /Brinda por Bruno/ })).toBeTruthy();
  });

  it('al abrirse lleva el foco al diálogo', () => {
    pintar();
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: /Brinda por Bruno/ }));
  });

  it('no deja marcar una cuarta cualidad', () => {
    pintar();
    for (const c of [/Liderazgo/, /Empatía/, /Compromiso/]) fireEvent.click(boton(c));
    expect(boton(/Creatividad/).disabled).toBe(true);
    fireEvent.click(boton(/Creatividad/));
    expect(boton(/Creatividad/).getAttribute('aria-pressed')).toBe('false');
    // Al desmarcar una, la cuarta vuelve a estar disponible.
    fireEvent.click(boton(/Liderazgo/));
    expect(boton(/Creatividad/).disabled).toBe(false);
  });

  it('trae marcado lo que ya voté y guarda la selección', async () => {
    const props = pintar(['Empatía']);
    expect(boton(/Empatía/).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(boton(/Liderazgo/));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar brindis' }));
    await waitFor(() => expect(props.onGuardar).toHaveBeenCalledWith(['Empatía', 'Liderazgo']));
  });

  it('Cancelar y Escape cierran', () => {
    const props = pintar();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onCerrar).toHaveBeenCalledTimes(2);
  });
});
