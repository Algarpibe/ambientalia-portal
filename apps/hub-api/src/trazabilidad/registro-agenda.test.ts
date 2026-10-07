import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from '@algarpibe/zoho-sync';
import { FRESCURA_MS, INTERVALO_MS, PRIMERA_PASADA_MS, iniciarRegistroEstados, registrarAgendaSinFallar, reiniciarRegistroEstados } from './registro-estados.js';

// La pasada de la AGENDA (su historial y el cierre de asignaciones) dentro del
// mismo programador que la de «Servicios», pero sin pisarse: ni una espera a
// la otra ni el fallo de una toca a la otra. Sin base de datos: las tareas son
// dobles y el reloj es de mentira. El SQL está en agenda-historial.db.test.ts.

const db = {} as Pool;

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

describe('el programador lleva las dos pasadas', () => {
  it('la de la agenda sale en cada turno, con la base, junto a la de «Servicios»', async () => {
    const tarea = vi.fn(async () => {});
    const agenda = vi.fn(async () => {});
    iniciarRegistroEstados(db, { tarea, agenda });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS - 1);
    expect(agenda).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect([tarea.mock.calls.length, agenda.mock.calls.length]).toEqual([1, 1]);
    expect(agenda).toHaveBeenCalledWith(db);
    await vi.advanceTimersByTimeAsync(2 * INTERVALO_MS);
    expect([tarea.mock.calls.length, agenda.mock.calls.length]).toEqual([3, 3]);
  });

  it('sin tarea de agenda no hay segunda pasada: el programador es el de siempre', async () => {
    const tarea = vi.fn(async () => {});
    iniciarRegistroEstados(db, { tarea });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
  });

  it('una pasada de la agenda colgada (la principal no contesta) no retrasa ni salta la de «Servicios»', async () => {
    const tarea = vi.fn(async () => {});
    const lenta = tareaLenta();
    iniciarRegistroEstados(db, { tarea, agenda: lenta.tarea });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + 2 * INTERVALO_MS);
    expect(tarea).toHaveBeenCalledTimes(3);
    // La de la agenda no se solapa consigo misma: sigue siendo la primera.
    expect(lenta.tarea).toHaveBeenCalledTimes(1);
    lenta.soltar();
    await vi.advanceTimersByTimeAsync(INTERVALO_MS);
    expect(lenta.tarea).toHaveBeenCalledTimes(2);
    lenta.soltar();
  });

  it('y al revés: la de «Servicios» colgada no para la de la agenda', async () => {
    const lenta = tareaLenta();
    const agenda = vi.fn(async () => {});
    iniciarRegistroEstados(db, { tarea: lenta.tarea, agenda });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + 2 * INTERVALO_MS);
    expect(agenda).toHaveBeenCalledTimes(3);
    lenta.soltar();
  });

  it('un fallo de la agenda se apunta con su nombre y no toca a la de «Servicios», ni al revés', async () => {
    const falloAgenda = new Error('la principal revienta');
    const tarea = vi.fn(async () => {});
    const agenda = vi.fn(async () => {
      throw falloAgenda;
    });
    iniciarRegistroEstados(db, { tarea, agenda });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + INTERVALO_MS);
    expect([tarea.mock.calls.length, agenda.mock.calls.length]).toEqual([2, 2]);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/tmc_registrar_agenda/), falloAgenda);
    expect(error).not.toHaveBeenCalledWith(expect.stringMatching(/tmc_registrar_estados/), expect.anything());

    reiniciarRegistroEstados();
    error.mockClear();
    const buena = vi.fn(async () => {});
    iniciarRegistroEstados(db, {
      tarea: vi.fn(async () => {
        throw new Error('la réplica revienta');
      }),
      agenda: buena,
    });
    await vi.advanceTimersByTimeAsync(PRIMERA_PASADA_MS + INTERVALO_MS);
    expect(buena).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalledWith(expect.stringMatching(/tmc_registrar_agenda/), expect.anything());
  });
});

describe('registrarAgendaSinFallar: la puerta de la pasada de la agenda', () => {
  it('nunca rechaza, tampoco si la tarea revienta sin devolver una promesa', async () => {
    const tarea = vi.fn((): Promise<void> => {
      throw new Error('síncrono');
    });
    await expect(registrarAgendaSinFallar(db, tarea, { forzar: true })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('una sola a la vez, y una petición no repite una buena reciente; `forzar` sí', async () => {
    const lenta = tareaLenta();
    const a = registrarAgendaSinFallar(db, lenta.tarea);
    const b = registrarAgendaSinFallar(db, lenta.tarea, { forzar: true });
    expect(lenta.tarea).toHaveBeenCalledTimes(1);
    lenta.soltar();
    await Promise.all([a, b]);

    const tarea = vi.fn(async () => {});
    await registrarAgendaSinFallar(db, tarea);
    expect(tarea).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FRESCURA_MS);
    await registrarAgendaSinFallar(db, tarea);
    await registrarAgendaSinFallar(db, tarea);
    expect(tarea).toHaveBeenCalledTimes(1);
    await registrarAgendaSinFallar(db, tarea, { forzar: true });
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('una pasada fallida no cuenta como reciente', async () => {
    const tarea = vi.fn(async () => {});
    tarea.mockRejectedValueOnce(new Error('sin conexión'));
    await registrarAgendaSinFallar(db, tarea);
    await registrarAgendaSinFallar(db, tarea);
    expect(tarea).toHaveBeenCalledTimes(2);
  });
});
