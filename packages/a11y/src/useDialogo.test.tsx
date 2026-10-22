// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useDialogo } from './useDialogo';

// FE-419 — banco de pruebas mínimo: un botón que abre un diálogo con dos
// controles. Se prueba el hook a través del DOM (rol, nombre, foco, teclado),
// que es lo que perciben el lector de pantalla y quien navega con teclado.
function Banco({ bloqueado = false, onCerrar }: { bloqueado?: boolean; onCerrar?: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = () => {
    onCerrar?.();
    setAbierto(false);
  };
  const { ref, idTitulo } = useDialogo<HTMLDivElement>({ abierto, onCerrar: cerrar, bloqueado });
  return (
    <>
      <button onClick={() => setAbierto(true)}>Abrir</button>
      {abierto && (
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
          <h2 id={idTitulo}>Título de prueba</h2>
          <button>Primero</button>
          <button>Último</button>
        </div>
      )}
    </>
  );
}

function abrir() {
  const abridor = screen.getByRole('button', { name: 'Abrir' });
  // jsdom no mueve el foco con un clic sintético: se enfoca a mano, como haría
  // el navegador al pulsar el botón.
  abridor.focus();
  fireEvent.click(abridor);
  return abridor;
}

afterEach(cleanup);

describe('useDialogo (FE-419)', () => {
  it('el diálogo queda nombrado por su título', () => {
    render(<Banco />);
    abrir();
    expect(screen.getByRole('dialog', { name: 'Título de prueba' })).toBeTruthy();
  });

  it('al abrir, el foco entra en el primer control del diálogo', () => {
    render(<Banco />);
    abrir();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Primero' }));
  });

  it('Escape cierra y el foco vuelve al botón que lo abrió', () => {
    const onCerrar = vi.fn();
    render(<Banco onCerrar={onCerrar} />);
    const abridor = abrir();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCerrar).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(abridor);
  });

  it('bloqueado (p. ej. guardando), Escape no cierra', () => {
    const onCerrar = vi.fn();
    render(<Banco bloqueado onCerrar={onCerrar} />);
    abrir();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onCerrar).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Tab desde el último control vuelve al primero, y Shift+Tab al revés', () => {
    render(<Banco />);
    abrir();
    const primero = screen.getByRole('button', { name: 'Primero' });
    const ultimo = screen.getByRole('button', { name: 'Último' });
    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: 'Tab' });
    expect(document.activeElement).toBe(primero);
    fireEvent.keyDown(primero, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(ultimo);
  });
});
