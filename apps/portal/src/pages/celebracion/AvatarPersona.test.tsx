// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import AvatarPersona from './AvatarPersona';
import { BRUNO } from './fixtures';

afterEach(() => {
  cleanup();
});

const SIN_FOTOS = { userId: BRUNO, nombre: 'Bruno Díaz', avatar: null, foto: null };

describe('AvatarPersona', () => {
  it('pinta la foto graciosa antes que la de perfil y, sin ella, la de perfil', () => {
    const { container, rerender } = render(
      <AvatarPersona persona={{ ...SIN_FOTOS, avatar: 'data:image/jpeg;base64,PERFIL', foto: 'data:image/jpeg;base64,GRACIOSA' }} />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,GRACIOSA');
    rerender(<AvatarPersona persona={{ ...SIN_FOTOS, avatar: 'data:image/jpeg;base64,PERFIL' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,PERFIL');
  });

  it('sin ninguna foto pinta las iniciales, con el tamaño del muro por defecto', () => {
    const { container } = render(<AvatarPersona persona={SIN_FOTOS} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('BD');
    expect((container.firstElementChild as HTMLElement).className).toContain('h-[74px]');
  });

  it('acepta otro tamaño y otras iniciales para la presentación', () => {
    const { container } = render(<AvatarPersona persona={SIN_FOTOS} className="h-44 w-44" claseIniciales="text-6xl" />);
    const aro = container.firstElementChild as HTMLElement;
    expect(aro.className).toContain('h-44');
    expect(aro.className).not.toContain('h-[74px]');
    expect(aro.querySelector('.text-6xl')?.textContent).toBe('BD');
  });
});
