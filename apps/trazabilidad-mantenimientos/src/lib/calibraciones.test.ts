import { describe, it, expect } from 'vitest';
import type { CalibracionHistorial, CalibracionHoja, DetalleCalibracion, PasadaCalibraciones, RecuentosCalibraciones } from '../dominio';
import { bloquesDetalle, detalleCalibracion, efectoAnular, firmaManual, hayQueTraer, lineasPlan, origenCalibracion, textoUltima, ticketsCorregibles } from './calibraciones';

// Lo que enseñan la tarjeta «Calibraciones · Desk 2.0» de Configuración (el plan
// en recuentos, la última pasada y el detalle en bloques) y el bloque
// «Calibraciones» de la ficha de un equipo. Datos ficticios.
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

describe('el detalle, en bloques', () => {
  const d = (tipo: DetalleCalibracion['tipo'], extra: Partial<DetalleCalibracion> = {}): DetalleCalibracion => ({ tipo, ticket: 1001, clave: '18A00001', serial: '18A00001', fecha: '2026-09-20', antes: null, nota: null, ...extra });

  it('lo que hay que mirar primero, arriba y abierto; el punto de partida, al final y plegado; un bloque vacío no sale', () => {
    const bloques = bloquesDetalle([d('partida', { ticket: null, nota: 'F-ST-022 congelada.' }), d('nueva'), d('revision', { fecha: '2027-01-10', nota: 'La fecha es posterior a hoy.' }), d('vaciada', { fecha: null, antes: '2026-06-30' }), d('cambiada', { antes: '2026-09-10' }), d('sin_equipo', { serial: '', clave: null })]);
    expect(bloques.map((b) => [b.titulo, b.abierto])).toEqual([
      ['En revisión: no cuentan hasta que alguien las mire (1)', true],
      ['Cambiadas en Zoho: se anula la fila y entra la fecha nueva (1)', true],
      ['Anuladas: el campo se vació en Zoho (1)', true],
      ['Sin equipo: no entran (1)', true],
      ['Calibraciones nuevas (1)', false],
      ['Punto de partida, de la F-ST-022 (1)', false],
    ]);
    expect(bloques.map((b) => b.items[0])).toEqual([
      ['ticket 1001 · 18A00001', '10/01/2027 · La fecha es posterior a hoy.'],
      ['ticket 1001 · 18A00001', '20/09/2026 (antes, 10/09/2026)'],
      ['ticket 1001 · 18A00001', 'se anula la del 30/06/2026'],
      ['ticket 1001 · (sin serial)', '20/09/2026'],
      ['ticket 1001 · 18A00001', '20/09/2026'],
      ['18A00001', '20/09/2026 · F-ST-022 congelada.'],
    ]);
  });

  it('los demás bloques: fechas distintas en la hoja y el inventario, valores ilegibles, anuladas a mano y otras marcas', () => {
    const bloques = bloquesDetalle([d('otra_marca', { serial: 'HB-0001', clave: null }), d('no_resucita'), d('ilegible', { fecha: null }), d('distinta', { ticket: null, fecha: '2025-11-20', antes: '2025-12-01' })]);
    expect(bloques.map((b) => [b.titulo, b.items[0][1]])).toEqual([
      ['Punto de partida con dos fechas: manda la hoja congelada (1)', '20/11/2025 (antes, 01/12/2025)'],
      ['Con un valor que no es una fecha: no entran (1)', '—'],
      ['Anuladas a mano: no se vuelven a traer (1)', '20/09/2026'],
      ['De otras marcas: se guardan sin equipo del inventario (1)', '20/09/2026'],
    ]);
  });
});

// Lote 9d-2b: corregir una fecha a mano. Lo que la lista de calibraciones (ficha y panel de la pestaña) dice de cada una y ofrece.
describe('corregir a mano: lo que se dice y se ofrece de cada calibración', () => {
  const c = (extra: Partial<CalibracionHoja>): CalibracionHoja => ({ id: 1, fecha: '2026-03-01', origen: 'desk', ticket: 1001, corrigeTicket: null, estado: 'vigente', cuenta: false, ...extra });
  const MANUAL = c({ id: 9, origen: 'manual', ticket: null, por: 'tecnico@example.com', en: '2026-10-12 15:00:00+00', motivo: 'El certificado dice otra fecha.' });

  it('una manual se distingue a la vista: quién la registró y cuándo (día en Colombia); las demás no llevan firma a la vista', () => {
    expect(firmaManual(MANUAL)).toBe('por tecnico@example.com el 12/10/2026');
    expect(firmaManual(c({}))).toBe('');
    expect(firmaManual(c({ id: -6, origen: 'fst022', ticket: null }))).toBe('');
  });

  it('el detalle: quién la registró, cuándo y por qué; y, si está anulada, quién, cuándo y por qué. La partida de la hoja no la firma nadie', () => {
    expect(detalleCalibracion(MANUAL)).toBe('Registrada por tecnico@example.com el 12/10/2026 10:00 · El certificado dice otra fecha.');
    expect(detalleCalibracion({ ...MANUAL, estado: 'anulada', anuladaPor: 'director@example.com', anuladaEn: '2026-10-12 16:30:00+00', anuladaMotivo: 'Era de otro equipo.' })).toBe(
      'Registrada por tecnico@example.com el 12/10/2026 10:00 · El certificado dice otra fecha. · Anulada por director@example.com el 12/10/2026 11:30: Era de otro equipo.',
    );
    expect(detalleCalibracion(c({ id: -6, origen: 'fst022', ticket: null }))).toBe('La fecha que traía la hoja F-ST-022 congelada.');
  });

  it('los tickets que se pueden corregir: los de Desk sin anular (también en revisión), una vez cada uno y del más reciente al más antiguo', () => {
    const items = [c({ ticket: 1001 }), c({ id: 2, ticket: 1003, fecha: '2027-01-01', estado: 'en_revision' }), c({ id: 3, ticket: 1002, estado: 'anulada' }), MANUAL, c({ id: -6, origen: 'fst022', ticket: null })];
    expect(ticketsCorregibles(items)).toEqual([{ ticket: 1003, fecha: '2027-01-01' }, { ticket: 1001, fecha: '2026-03-01' }]);
    expect(ticketsCorregibles([MANUAL])).toEqual([]);
  });

  it('lo que pasa al anular, dicho antes de confirmar: deja de contar y no se borra; de un ticket, que no vuelve con la pasada; de la hoja, que la congelación no se toca', () => {
    expect(efectoAnular(MANUAL)).toBe('Deja de contar para la última calibración. No se borra, y no se puede desanular: si hace falta, se registra otra.');
    expect(efectoAnular(c({}))).toMatch(/Al traer las calibraciones de Desk 2\.0 no volverá mientras el ticket n\.º 1001 siga con esa fecha en Zoho\.$/);
    expect(efectoAnular(c({ id: -6, origen: 'fst022', ticket: null }))).toMatch(/La hoja congelada no se toca: queda apuntado que esa fecha no vale\.$/);
  });
});

describe('el origen de una calibración, en la ficha', () => {
  const c = (extra: Partial<CalibracionHistorial>) => ({ origen: 'desk', ticket: null, corrigeTicket: null, ...extra }) as CalibracionHistorial;

  it('F-ST-022, ticket n.º o manual (y a qué ticket corrige)', () => {
    expect(origenCalibracion(c({ origen: 'fst022' }))).toBe('F-ST-022');
    expect(origenCalibracion(c({ origen: 'desk', ticket: 1001 }))).toBe('Ticket n.º 1001');
    expect(origenCalibracion(c({ origen: 'manual' }))).toBe('Manual');
    expect(origenCalibracion(c({ origen: 'manual', corrigeTicket: 1001 }))).toBe('Manual (corrige el ticket n.º 1001)');
  });
});
