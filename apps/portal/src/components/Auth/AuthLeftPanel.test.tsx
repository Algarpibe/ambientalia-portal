// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AuthLeftPanel from './AuthLeftPanel';

afterEach(cleanup);

// FE-419 — los puntos del carrusel eran botones vacíos: el lector de pantalla
// anunciaba «botón» tres veces sin decir a dónde llevaba ninguno.
describe('AuthLeftPanel — puntos del carrusel (FE-419)', () => {
  it('cada punto dice a qué diapositiva lleva y el actual se marca', () => {
    render(<AuthLeftPanel />);
    const primero = screen.getByRole('button', { name: 'Ir a la diapositiva 1' });
    const tercero = screen.getByRole('button', { name: 'Ir a la diapositiva 3' });
    expect(primero.getAttribute('aria-current')).toBe('true');
    expect(tercero.getAttribute('aria-current')).toBeNull();

    fireEvent.click(tercero);
    expect(tercero.getAttribute('aria-current')).toBe('true');
    expect(primero.getAttribute('aria-current')).toBeNull();
  });
});
