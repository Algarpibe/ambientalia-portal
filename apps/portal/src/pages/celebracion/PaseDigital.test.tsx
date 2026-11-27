// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PaseDigital from './PaseDigital';
import { eventoDePrueba } from './fixtures';

vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
});

describe('PaseDigital', () => {
  it('enseña mi nombre, la fecha, mi menú y mi mensaje, sin QR', () => {
    render(
      <PaseDigital
        nombre="Ana Ruiz"
        evento={eventoDePrueba()}
        respuesta={{ asiste: true, preferencia: 'vegetariano', mensaje: '¡Allá estaré!', actualizadoEn: '2026-12-01T15:00:00Z' }}
      />,
    );
    const pase = screen.getByTestId('pase');
    expect(pase.textContent).toContain('Ana Ruiz');
    expect(pase.textContent).toContain('Viernes, 18 de diciembre de 2026');
    expect(pase.textContent).toContain('Opción vegetariana');
    expect(pase.textContent).toContain('“¡Allá estaré!”');
    expect(pase.querySelector('canvas')).toBeNull();
    expect(screen.getByRole('button', { name: /Descargar pase/ })).toBeTruthy();
  });
});
