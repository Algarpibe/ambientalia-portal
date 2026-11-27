// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import PasosEquipo from './PasosEquipo';
import { notify } from '../../lib/notify';

vi.mock('../../lib/notify', () => ({ notify: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function pintar(cambios: Partial<React.ComponentProps<typeof PasosEquipo>> = {}) {
  const props = {
    tieneFoto: false,
    brindis: { dados: 0, minimo: 10 },
    abiertas: true,
    onSubirFoto: vi.fn(async () => {}),
    onIrAConfirmar: vi.fn(),
    ...cambios,
  };
  const { container } = render(<PasosEquipo {...props} />);
  return { props, container };
}

describe('PasosEquipo', () => {
  it('con las confirmaciones cerradas no pinta nada', () => {
    const { container } = pintar({ abiertas: false });
    expect(container.innerHTML).toBe('');
  });

  it('sin foto ni brindis: pide los 2 pasos, ofrece «Subir foto» y enseña «0 de 10»', () => {
    pintar();
    expect(screen.getByText('Antes de confirmar tu asistencia, completa estos 2 pasos:')).toBeTruthy();
    expect(screen.getByText('Subir foto')).toBeTruthy();
    expect(screen.getByLabelText('Subir mi foto graciosa')).toBeTruthy();
    expect(screen.getByText('0 de 10')).toBeTruthy();
    const barra = screen.getByRole('progressbar', { name: 'Brindis enviados' });
    expect(barra.getAttribute('aria-valuenow')).toBe('0');
    expect(barra.getAttribute('aria-valuemin')).toBe('0');
    expect(barra.getAttribute('aria-valuemax')).toBe('10');
    expect(screen.getByText('Toca «Enviar brindis» en cada tarjeta.')).toBeTruthy();
    expect(screen.queryByText(/¡Listo!/)).toBeNull();
  });

  it('con foto, el paso 1 queda «✅ Hecha» y ya no ofrece subirla', () => {
    pintar({ tieneFoto: true });
    expect(screen.getByText('✅ Hecha')).toBeTruthy();
    expect(screen.queryByText('Subir foto')).toBeNull();
  });

  it('con los brindis completos, el paso 2 lleva ✅', () => {
    pintar({ brindis: { dados: 10, minimo: 10 } });
    expect(screen.getByText('10 de 10')).toBeTruthy();
    expect(screen.getByTestId('paso-brindis').textContent).toContain('✅');
    expect(screen.getByRole('progressbar', { name: 'Brindis enviados' }).getAttribute('aria-valuenow')).toBe('10');
  });

  it('con todo completo celebra y «Ir a confirmar» avisa', () => {
    const { props } = pintar({ tieneFoto: true, brindis: { dados: 10, minimo: 10 } });
    expect(screen.getByText('🎉 ¡Listo! Ya puedes confirmar tu asistencia')).toBeTruthy();
    expect(screen.queryByText('Antes de confirmar tu asistencia, completa estos 2 pasos:')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ir a confirmar/ }));
    expect(props.onIrAConfirmar).toHaveBeenCalledTimes(1);
  });

  it('elegir una imagen la sube', async () => {
    const { props } = pintar();
    const archivo = new File(['x'], 'yo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Subir mi foto graciosa'), { target: { files: [archivo] } });
    await waitFor(() => expect(props.onSubirFoto).toHaveBeenCalledWith(archivo));
  });

  it('un archivo que no es imagen avisa y no se sube', () => {
    const { props } = pintar();
    fireEvent.change(screen.getByLabelText('Subir mi foto graciosa'), {
      target: { files: [new File(['x'], 'nota.txt', { type: 'text/plain' })] },
    });
    expect(notify).toHaveBeenCalledWith('El archivo debe ser una imagen.', 'error');
    expect(props.onSubirFoto).not.toHaveBeenCalled();
  });
});
