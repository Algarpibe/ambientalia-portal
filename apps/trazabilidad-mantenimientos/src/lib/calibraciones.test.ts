import { describe, it, expect } from 'vitest';
import type { PasadaCalibraciones, RecuentosCalibraciones } from '../dominio';
import { hayQueTraer, lineasPlan, textoUltima } from './calibraciones';

// Lo que enseña la tarjeta «Calibraciones · Desk 2.0» de Configuración: el plan
// en recuentos y la última pasada. Datos ficticios.
const recuentos = (extra: Partial<RecuentosCalibraciones> = {}): RecuentosCalibraciones => ({
  tickets: 776, conCf: 68, conCampo: 6, porNombre: 5, porEtiqueta: 1, gestionadosPorApp: 0, nuevas: 4, sinCambios: 0, cambiadas: 1, reenlazadas: 0, vaciadas: 1, enRevision: 1, otrasMarcas: 1,
  historial: 0, sinEquipo: 1, ilegibles: 0, noResucitan: 0, partida: 114, partidaDeInventario: 3, partidaDistintas: 2, equiposCambian: 5, salenDeAvisos: 2, entranEnAvisos: 0,
  ...extra,
});
const SIN_NADA = { nuevas: 0, cambiadas: 0, reenlazadas: 0, vaciadas: 0, partida: 0, enRevision: 0, sinEquipo: 0, otrasMarcas: 0, equiposCambian: 0, salenDeAvisos: 0, partidaDeInventario: 0, partidaDistintas: 0 };

describe('el plan en líneas', () => {
  it('todos los recuentos, en el orden en que se leen; lo que cambiaría algo va señalado (*) y lo que pide mirarlo antes, resaltado (!)', () => {
    expect(lineasPlan(recuentos()).map((l) => `${l.aviso ? '!' : l.cambia ? '*' : ' '} ${l.texto}: ${l.valor}`)).toEqual([
      '  Tickets en Desk 2.0: 776',
      '  · con el detalle de Zoho (los que Desk 2.0 ha releído): 68',
      '  Tickets con «Fecha de Calibración»: 6 (5 por nombre interno · 1 sólo por etiqueta)',
      '* Calibraciones nuevas: 4',
      '  Sin cambios: 0',
      '* Cambiadas en Zoho (se anula la fila y entra la fecha nueva): 1',
      '! Anuladas: el campo se vació en Zoho: 1',
      '! En revisión: fecha futura o imposible, o serial ambiguo (no cuentan): 1',
      '! Sin equipo: el ticket no trae serial ni equipo (no entran): 1',
      '  De otras marcas (se guardan sin equipo del inventario): 1',
      '* Punto de partida: equipos que reciben su fecha de la F-ST-022: 114',
      '  · sin fecha en la hoja congelada (vale la del inventario): 3',
      '! · con una fecha en la hoja y otra en el inventario (manda la hoja): 2',
      '* Equipos a los que les cambiaría la última calibración: 5',
      '* · saldrían de los avisos: 2',
      '  · entrarían en los avisos: 0',
    ]);
  });

  it('las líneas raras sólo salen si hay algo: valores que no son fecha, anuladas a mano, historial y tickets que gestiona Desk 2.0', () => {
    const textos = lineasPlan(recuentos({ ilegibles: 1, noResucitan: 2, historial: 3, gestionadosPorApp: 4, reenlazadas: 2 })).map((l) => `${l.aviso ? '!' : ' '} ${l.texto}: ${l.valor}`);
    expect(textos).toContain('! Con un valor que no es una fecha (no entran): 1');
    expect(textos).toContain('  Anuladas a mano que no se vuelven a traer: 2');
    expect(textos).toContain('  Anteriores a la fecha que ya tiene su equipo (quedan como historial): 3');
    expect(textos).toContain('  · de tickets que gestiona Desk 2.0 (ya no reciben cambios de Zoho): 4');
    expect(lineasPlan(recuentos({ reenlazadas: 2 })).find((l) => l.texto.startsWith('Cambiadas'))?.valor).toBe('3');
  });

  it('nada resalta a cero, y sin punto de partida pendiente no se desglosa', () => {
    const lineas = lineasPlan(recuentos(SIN_NADA));
    expect(lineas.filter((l) => l.aviso || l.cambia)).toEqual([]);
    expect(lineas.some((l) => l.texto.includes('hoja congelada'))).toBe(false);
  });

  it('¿traer escribiría algo?', () => {
    expect(hayQueTraer(recuentos())).toBe(true);
    expect(hayQueTraer(recuentos(SIN_NADA))).toBe(false);
    for (const uno of ['nuevas', 'cambiadas', 'reenlazadas', 'vaciadas', 'partida'] as const) expect(hayQueTraer(recuentos({ ...SIN_NADA, [uno]: 1 }))).toBe(true);
  });
});

describe('la última pasada', () => {
  const pasada = (r: RecuentosCalibraciones): PasadaCalibraciones => ({ id: 3, huella: 'ab'.repeat(32), recuentos: r, por: 'tecnico@example.com', en: '2026-10-12 01:10:00+00' });

  it('quién, cuándo (en hora de Colombia) y qué trajo', () => {
    expect(textoUltima(pasada(recuentos()))).toBe('tecnico@example.com · 11/10/2026 20:10 · 118 nuevas, 1 cambiada y 1 anulada');
    expect(textoUltima(pasada(recuentos(SIN_NADA)))).toBe('tecnico@example.com · 11/10/2026 20:10 · sin cambios');
  });
});
