// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { activable, ariaSort } from './activable';

// FE-419 — una fila de tabla que abre un detalle al hacer clic tiene que poder abrirse
// también con el teclado, sin que las teclas pulsadas DENTRO de un control de la fila
// (p. ej. el input editable de cartera) la abran por accidente.
function Tabla({ onAbrir }: { onAbrir: () => void }) {
  return (
    <table>
      <tbody>
        <tr {...activable(onAbrir)} aria-label="Abrir el detalle de la factura FV-1">
          <td>FV-1</td>
          <td>
            <input aria-label="Cartera" />
          </td>
        </tr>
      </tbody>
    </table>
  );
}

afterEach(cleanup);

describe('activable (FE-419)', () => {
  it('la fila entra en el orden de tabulación y se anuncia por lo que abre', () => {
    render(<Tabla onAbrir={() => {}} />);
    const fila = screen.getByRole('row', { name: 'Abrir el detalle de la factura FV-1' });
    expect(fila.tabIndex).toBe(0);
  });

  it('el clic sigue abriendo, y Enter y Espacio también', () => {
    const onAbrir = vi.fn();
    render(<Tabla onAbrir={onAbrir} />);
    const fila = screen.getByRole('row', { name: /FV-1/ });
    fireEvent.click(fila);
    fireEvent.keyDown(fila, { key: 'Enter' });
    fireEvent.keyDown(fila, { key: ' ' });
    expect(onAbrir).toHaveBeenCalledTimes(3);
  });

  it('Espacio no desplaza la página al activar (preventDefault)', () => {
    render(<Tabla onAbrir={() => {}} />);
    const fila = screen.getByRole('row', { name: /FV-1/ });
    // fireEvent devuelve false cuando el manejador canceló el evento.
    expect(fireEvent.keyDown(fila, { key: ' ' })).toBe(false);
  });

  it('las teclas pulsadas dentro de un control de la fila no la activan', () => {
    const onAbrir = vi.fn();
    render(<Tabla onAbrir={onAbrir} />);
    const input = screen.getByRole('textbox', { name: 'Cartera' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: ' ' });
    expect(onAbrir).not.toHaveBeenCalled();
  });

  it('otras teclas no activan', () => {
    const onAbrir = vi.fn();
    render(<Tabla onAbrir={onAbrir} />);
    fireEvent.keyDown(screen.getByRole('row', { name: /FV-1/ }), { key: 'a' });
    expect(onAbrir).not.toHaveBeenCalled();
  });
});

describe('ariaSort (FE-419)', () => {
  it('solo la columna activa declara su sentido; las demás no declaran nada', () => {
    expect(ariaSort(true, true)).toBe('ascending');
    expect(ariaSort(true, false)).toBe('descending');
    expect(ariaSort(false, true)).toBeUndefined();
  });
});
