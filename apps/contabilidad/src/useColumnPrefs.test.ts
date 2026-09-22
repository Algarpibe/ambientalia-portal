import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useColumnPrefs } from './useColumnPrefs';

const CLAVE = 'contabilidad:columnas:ov-pendientes:u1';

beforeEach(() => localStorage.clear());

describe('useColumnPrefs con columnas nuevas', () => {
  it('una configuración guardada antigua recibe las columnas nuevas al final, visibles', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ orden: ['b', 'a'], ocultas: ['a'], anchos: { b: 200 } }));
    const { result } = renderHook(() => useColumnPrefs(CLAVE, ['a', 'b', 'nueva']));
    expect(result.current.orden).toEqual(['b', 'a', 'nueva']);
    expect(result.current.esVisible('nueva')).toBe(true);
    expect(result.current.esVisible('a')).toBe(false);
    expect(result.current.anchoDe('b')).toBe(200);
  });

  it('sin nada guardado usa el orden por defecto', () => {
    const { result } = renderHook(() => useColumnPrefs(CLAVE, ['a', 'b']));
    expect(result.current.orden).toEqual(['a', 'b']);
    expect(result.current.personalizado).toBe(false);
  });
});
