import { describe, it, expect, vi } from 'vitest';
import { importarConReintento } from './lazyConReintento';

/** sessionStorage falso en memoria. */
function almacenFalso() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    _raw: m,
  };
}

const sinEspera = () => Promise.resolve();

describe('importarConReintento', () => {
  it('devuelve el módulo si el import va bien a la primera, sin recargar', async () => {
    const recargar = vi.fn();
    const factory = vi.fn().mockResolvedValue({ default: 'ok' });
    const mod = await importarConReintento(factory, { recargar, esperar: sinEspera, almacen: almacenFalso() });
    expect(mod).toEqual({ default: 'ok' });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(recargar).not.toHaveBeenCalled();
  });

  it('reintenta una vez y devuelve el módulo si el segundo intento va bien', async () => {
    const recargar = vi.fn();
    const factory = vi.fn().mockRejectedValueOnce(new Error('hipo')).mockResolvedValue({ default: 'ok' });
    const mod = await importarConReintento(factory, { recargar, esperar: sinEspera, almacen: almacenFalso() });
    expect(mod).toEqual({ default: 'ok' });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(recargar).not.toHaveBeenCalled();
  });

  it('recarga la página UNA vez si sigue fallando tras el reintento', async () => {
    const recargar = vi.fn();
    const almacen = almacenFalso();
    const factory = vi.fn().mockRejectedValue(new Error('chunk desaparecido'));
    // No se hace await: la promesa se cuelga a propósito mientras "recarga".
    void importarConReintento(factory, { recargar, esperar: sinEspera, almacen });
    await vi.waitFor(() => expect(recargar).toHaveBeenCalledTimes(1));
    expect(factory).toHaveBeenCalledTimes(2); // intento + reintento
    expect(almacen.getItem('portal:chunk-recargado')).toBe('1'); // flag puesto
  });

  it('si ya se recargó una vez y sigue fallando, lanza el error en vez de recargar en bucle', async () => {
    const recargar = vi.fn();
    const almacen = almacenFalso();
    almacen.setItem('portal:chunk-recargado', '1'); // ya venimos de una recarga
    const factory = vi.fn().mockRejectedValue(new Error('sigue roto'));
    await expect(
      importarConReintento(factory, { recargar, esperar: sinEspera, almacen })
    ).rejects.toThrow('sigue roto');
    expect(recargar).not.toHaveBeenCalled();
  });

  it('un import correcto limpia el flag, para que un despliegue futuro pueda recargar', async () => {
    const almacen = almacenFalso();
    almacen.setItem('portal:chunk-recargado', '1'); // resto de una recarga anterior
    const factory = vi.fn().mockResolvedValue({ default: 'ok' });
    await importarConReintento(factory, { recargar: vi.fn(), esperar: sinEspera, almacen });
    expect(almacen.getItem('portal:chunk-recargado')).toBeNull();
  });
});
