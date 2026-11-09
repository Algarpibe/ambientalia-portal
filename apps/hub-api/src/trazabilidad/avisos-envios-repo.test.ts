import { describe, it, expect } from 'vitest';
import { enSerie } from './avisos-envios-repo.js';

// La conexión en serie de la segunda lectura de «Enviar correo» (dentro de la transacción del apunte), con una conexión de mentira.

describe('enSerie: las consultas sobre una conexión, de una en una', () => {
  it('nunca hay dos a la vez y, tras la primera que falla, las demás fallan sin llegar a la conexión (ni después del ROLLBACK)', async () => {
    const llegan: string[] = [];
    let activas = 0;
    let maximo = 0;
    const conexion = {
      query: async (sql: string) => {
        llegan.push(sql);
        maximo = Math.max(maximo, ++activas);
        await new Promise((r) => setTimeout(r, 1));
        activas--;
        if (sql === 'falla') throw new Error('fallo ficticio');
        return { rows: [] };
      },
    };
    const s = enSerie(conexion as never);
    const r = await Promise.allSettled([s.query('uno'), s.query('falla'), s.query('tres'), s.query('cuatro')]);
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'rejected', 'rejected']);
    await expect(s.query('después')).rejects.toThrow('fallo ficticio');
    expect([llegan, maximo]).toEqual([['uno', 'falla'], 1]);
  });
});
