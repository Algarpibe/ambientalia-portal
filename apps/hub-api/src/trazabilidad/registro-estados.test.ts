import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import {
  FRESCURA_MS,
  INTERVALO_MS,
  PRIMERA_PASADA_MS,
  detenerRegistroEstados,
  iniciarRegistroEstados,
  registrarEstadosAlDia,
  registrarEstadosSinFallar,
  reiniciarRegistroEstados,
} from './registro-estados.js';

// El programador que apunta los cambios de estado de los tickets y la puerta
// por la que también lo pide GET /trazabilidad/servicios. Aquí no hay base de
// datos: la tarea es un doble y el reloj es de mentira. El SQL de verdad
// (`registrarEstados`) lo cubre trazabilidad.db.test.ts.

const db = {} as Pool;

/** Una tarea que se queda esperando hasta que el test la suelta. */
function tareaLenta() {
  const sueltas: (() => void)[] = [];
  const tarea = vi.fn(() => new Promise<void>((ok) => sueltas.push(ok)));
  return { tarea, soltar: () => sueltas.splice(0).forEach((ok) => ok()) };
}

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  reiniciarRegistroEstados();
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  reiniciarRegistroEstados();
  error.mockRestore();
  vi.useRealTimers();
});

describe('programador', () => {
  it('cada cinco minutos, con la primera pasada poco después de arrancar', async () => {
    expect(INTERVALO_MS).toBe(5 * 60_000);
    expect(PRIMERA_PASADA_MS).toBeGreaterThan(0);
    expect(PRIMERA_PASADA_MS).toBeLessThanOrEqual(60_000);
    const tarea = vi.fn(async () => {});
    expect(iniciarRegistroEstados(db, { tarea })).toBe(true);
    expect(tarea).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS - 1);
    expect(tarea).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(tarea).toHaveBeenCalledWith(db);

    await vi.advanceTimersByTimeAsync(INTERVALO_MS - 1);
    expect(tarea).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tarea).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3 * INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(5);
  });

  it('no arranca dos veces: la segunda llamada no añade temporizadores', async () => {
    const tarea = vi.fn(async () => {});
    const otra = vi.fn(async () => {});
    expect(iniciarRegistroEstados(db, { tarea })).toBe(true);
    expect(iniciarRegistroEstados(db, { tarea: otra })).toBe(false);
    expect(iniciarRegistroEstados(db, { tarea })).toBe(false);
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + 2 * INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(3);
    expect(otra).not.toHaveBeenCalled();
  });

  it('un fallo se traga y se apunta; la pasada siguiente sale igual', async () => {
    const fallo = new Error('la base no contesta');
    const tarea = vi.fn(async () => {});
    tarea.mockRejectedValueOnce(fallo);
    iniciarRegistroEstados(db, { tarea });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS);
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/tmc_registrar_estados/), fallo);
    await vi.advanceTimersByTimeAsync(INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('una tarea que revienta sin llegar a devolver una promesa tampoco tumba nada', async () => {
    const tarea = vi.fn((): Promise<void> => {
      throw new Error('síncrono');
    });
    iniciarRegistroEstados(db, { tarea });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('una pasada que tarda más que el intervalo no se solapa con la siguiente', async () => {
    const { tarea, soltar } = tareaLenta();
    iniciarRegistroEstados(db, { tarea });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + 2 * INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(1);
    soltar();
    await vi.advanceTimersByTimeAsync(INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(2);
    soltar();
  });

  it('detenerlo para las pasadas, y después se puede volver a arrancar', async () => {
    const tarea = vi.fn(async () => {});
    iniciarRegistroEstados(db, { tarea });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS);
    detenerRegistroEstados();
    await vi.advanceTimersByTimeAsync(10 * INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(1);
    expect(iniciarRegistroEstados(db, { tarea })).toBe(true);
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS);
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('detenerlo antes de la primera pasada también la cancela', async () => {
    const tarea = vi.fn(async () => {});
    iniciarRegistroEstados(db, { tarea });
    detenerRegistroEstados();
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + INTERVALO_MS);
    expect(tarea).not.toHaveBeenCalled();
  });
});

describe('una sola pasada a la vez, y no más de una cada poco', () => {
  it('dos peticiones a la vez comparten la misma pasada', async () => {
    const { tarea, soltar } = tareaLenta();
    const a = registrarEstadosAlDia(db, { tarea });
    const b = registrarEstadosAlDia(db, { tarea });
    expect(tarea).toHaveBeenCalledTimes(1);
    soltar();
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
  });

  it('si la pasada compartida falla, fallan las dos', async () => {
    const tarea = vi.fn(async () => {
      throw new Error('sin conexión');
    });
    const a = registrarEstadosAlDia(db, { tarea });
    const b = registrarEstadosAlDia(db, { tarea });
    await expect(a).rejects.toThrow('sin conexión');
    await expect(b).rejects.toThrow('sin conexión');
    expect(tarea).toHaveBeenCalledTimes(1);
  });

  it('recién apuntado no se repite; pasado el margen, sí', async () => {
    expect(FRESCURA_MS).toBeGreaterThan(0);
    expect(FRESCURA_MS).toBeLessThan(INTERVALO_MS);
    const tarea = vi.fn(async () => {});
    await registrarEstadosAlDia(db, { tarea });
    await registrarEstadosAlDia(db, { tarea });
    await vi.advanceTimersByTimeAsync(FRESCURA_MS - 1);
    await registrarEstadosAlDia(db, { tarea });
    expect(tarea).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await registrarEstadosAlDia(db, { tarea });
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('`forzar` se salta el margen (es lo que usa el programador), pero no la pasada en curso', async () => {
    const tarea = vi.fn(async () => {});
    await registrarEstadosAlDia(db, { tarea });
    await registrarEstadosAlDia(db, { tarea, forzar: true });
    expect(tarea).toHaveBeenCalledTimes(2);

    const lenta = tareaLenta();
    const a = registrarEstadosAlDia(db, { tarea: lenta.tarea, forzar: true });
    const b = registrarEstadosAlDia(db, { tarea: lenta.tarea, forzar: true });
    expect(lenta.tarea).toHaveBeenCalledTimes(1);
    lenta.soltar();
    await Promise.all([a, b]);
  });

  it('una pasada fallida no cuenta como reciente: la siguiente petición lo reintenta', async () => {
    const tarea = vi.fn(async () => {});
    tarea.mockRejectedValueOnce(new Error('sin conexión'));
    await expect(registrarEstadosAlDia(db, { tarea })).rejects.toThrow('sin conexión');
    await registrarEstadosAlDia(db, { tarea });
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('la pasada del programador deja al día a las peticiones que llegan justo después', async () => {
    const tarea = vi.fn(async () => {});
    iniciarRegistroEstados(db, { tarea });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS);
    await registrarEstadosAlDia(db, { tarea });
    expect(tarea).toHaveBeenCalledTimes(1);
  });

  it('registrarEstadosSinFallar nunca rechaza: apunta el error y sigue', async () => {
    const fallo = new Error('sin conexión');
    const tarea = vi.fn(async () => {
      throw fallo;
    });
    await expect(registrarEstadosSinFallar(db, { tarea })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/tmc_registrar_estados/), fallo);
  });
});
