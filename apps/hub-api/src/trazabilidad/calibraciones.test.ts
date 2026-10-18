import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { estadoCalibracion } from './dominio.js';
import { CAMPO_INTERNO, ETIQUETA_CAMPO, crearLectorCalibraciones } from './calibraciones-desk2.js';
import {
  FECHA_MINIMA_CALIBRACION,
  calibracionQueCuenta,
  fechaEfectiva,
  leerFechaCampo,
  planCalibraciones,
  saludLectura,
  type EntradaPlanCalibraciones,
  type EquipoInventario,
  type FilaCalibracion,
  type PlanCalibraciones,
  type TicketCalibracion,
} from './calibraciones.js';

// Calibraciones desde Desk 2.0 (lote 9c), sin base: la regla de la «última
// calibración» (con la precedencia de la corrección manual), el plan de la
// pasada caso a caso, el punto de partida (una fila fst022 por equipo), el
// lector que no lanza y las guardas de la migración 057. `hoy` siempre fijo.
// Todo ficticio (el repo es público).

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const HOY = '2026-10-11';

let n = 0;
const fila = (extra: Partial<FilaCalibracion> = {}): FilaCalibracion => ({ id: ++n, clave: '18A00001', serial: '18A00001', deskEquipoId: null, fecha: '2025-10-17', origen: 'desk', ticket: null, estado: 'vigente', corrigeTicket: null, corrigeFecha: null, anuladaAMano: false, ...extra });
const ticket = (numero: number, fecha: string | null, extra: Partial<TicketCalibracion> = {}): TicketCalibracion => ({ numero, fecha, campo: 'nombre_interno', equipoId: null, serial: '18A00001', tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: false, ...extra });
/** Un GRIMM EDM 180 del inventario (vigencia de su marca: 365 días), salvo que se diga otra cosa. */
const equipo = (serial: string, extra: Partial<EquipoInventario> = {}): EquipoInventario => ({ clave: serial, serial, activo: true, deskId: null, ultimaCalibracion: null, vigenciaMarca: 365, ...extra });
const plan = (e: Partial<EntradaPlanCalibraciones>): PlanCalibraciones => planCalibraciones({ hoy: HOY, tickets: [], total: e.tickets?.length ?? 0, conCf: e.tickets?.length ?? 0, filas: [], equipos: [equipo('18A00001')], partida: [], ...e });
/** Lo que haría la base con un plan: anula (no «a mano») e inserta, con ids nuevos. */
const aplicar = (p: PlanCalibraciones, filas: readonly FilaCalibracion[]): FilaCalibracion[] => [
  ...filas.map((f) => (p.anular.some((a) => a.id === f.id) ? { ...f, estado: 'anulada' as const } : f)),
  ...p.altas.map((a) => fila({ clave: a.clave, serial: a.serial, deskEquipoId: a.deskEquipoId, fecha: a.fecha, origen: a.origen, ticket: a.ticket, estado: a.estado })),
];

describe('última calibración de un equipo', () => {
  it('es la fecha máxima entre sus filas vigentes; sin filas, ninguna', () => {
    const filas = [fila({ fecha: '2024-03-26', origen: 'fst022' }), fila({ fecha: '2026-05-04', ticket: 1001 }), fila({ fecha: '2025-10-17', ticket: 990 })];
    expect(calibracionQueCuenta(filas, HOY)).toBe(filas[1]);
    expect(calibracionQueCuenta([], HOY)).toBeNull();
  });

  it('`hoy` en el límite: una fecha de hoy cuenta; la de mañana, todavía no (y contará mañana)', () => {
    const filas = [fila({ fecha: '2025-01-01' }), fila({ fecha: HOY, ticket: 1 }), fila({ fecha: '2026-10-12', ticket: 2 })];
    expect(calibracionQueCuenta(filas, HOY)?.fecha).toBe(HOY);
    expect(calibracionQueCuenta(filas, '2026-10-12')?.fecha).toBe('2026-10-12');
    expect(calibracionQueCuenta(filas, '2026-10-10')?.fecha).toBe('2025-01-01');
  });

  it('las anuladas y las que están en revisión no cuentan', () => {
    const filas = [fila({ fecha: '2025-01-01' }), fila({ fecha: '2026-06-01', estado: 'anulada' }), fila({ fecha: '2026-07-01', estado: 'en_revision' })];
    expect(calibracionQueCuenta(filas, HOY)?.fecha).toBe('2025-01-01');
  });

  it('con la misma fecha cuenta la manual, luego la de Desk y luego la de la F-ST-022', () => {
    const filas = [fila({ origen: 'fst022' }), fila({ origen: 'desk', ticket: 7 }), fila({ origen: 'manual' })];
    expect(calibracionQueCuenta(filas, HOY)?.origen).toBe('manual');
    expect(calibracionQueCuenta(filas.slice(0, 2), HOY)?.origen).toBe('desk');
  });

  it('`fechaEfectiva`: sin NINGUNA fila vale la del inventario (como hasta ahora); con alguna, aunque esté anulada, manda la regla', () => {
    expect(fechaEfectiva([], '2025-02-02', HOY)).toBe('2025-02-02');
    expect(fechaEfectiva([], null, HOY)).toBeNull();
    expect(fechaEfectiva([fila({ fecha: '2026-01-15' })], '2025-02-02', HOY)).toBe('2026-01-15');
    expect(fechaEfectiva([fila({ estado: 'anulada' })], '2025-02-02', HOY)).toBeNull();
  });

  describe('corrección manual', () => {
    // La manual se enlaza con el ticket que corrige por `corrigeTicket` y guarda en `corrigeFecha` la fecha que ese ticket tenía en Zoho.
    const desk = fila({ fecha: '2026-03-01', ticket: 1001 });
    const manual = fila({ fecha: '2026-02-10', origen: 'manual', corrigeTicket: 1001, corrigeFecha: '2026-03-01' });

    it('manda sobre la fecha de Desk de ESE ticket, aunque la de Desk sea posterior', () => {
      expect(calibracionQueCuenta([desk, manual], HOY)).toBe(manual);
    });

    it('sólo tapa a su ticket: la fila de otro ticket compite como siempre', () => {
      const otro = fila({ fecha: '2026-08-20', ticket: 1002 });
      expect(calibracionQueCuenta([desk, manual, otro], HOY)).toBe(otro);
    });

    it('deja de mandar cuando cambia la fecha de ese ticket en Zoho: la pasada anula la fila de Desk e inserta otra, y cuenta la nueva', () => {
      const nueva = fila({ fecha: '2026-03-05', ticket: 1001 });
      expect(calibracionQueCuenta([{ ...desk, estado: 'anulada' }, manual, nueva], HOY)).toBe(nueva);
    });

    it('si el campo se vacía en Zoho (la fila de Desk queda anulada y no hay otra) la corrección tampoco cuenta: ya no hay fecha que corregir', () => {
      const partida = fila({ fecha: '2025-01-01', origen: 'fst022' });
      expect(calibracionQueCuenta([partida, { ...desk, estado: 'anulada' }, manual], HOY)).toBe(partida);
    });

    it('también corrige una fila de Desk en revisión (una fecha futura mal escrita)', () => {
      expect(calibracionQueCuenta([{ ...desk, fecha: '2027-03-01', estado: 'en_revision' }, { ...manual, corrigeFecha: '2027-03-01' }], HOY)).toMatchObject({ origen: 'manual', fecha: '2026-02-10' });
    });

    it('una manual que no corrige ningún ticket es una calibración más', () => {
      expect(calibracionQueCuenta([desk, fila({ fecha: '2026-09-09', origen: 'manual' })], HOY)?.fecha).toBe('2026-09-09');
    });
  });
});

describe('el valor del campo de Zoho', () => {
  it('una fecha AAAA-MM-DD (o un instante ISO que empieza por ella) se lee; lo demás no es una fecha', () => {
    expect(leerFechaCampo('2026-05-04')).toBe('2026-05-04');
    expect(leerFechaCampo(' 2026-05-04T05:00:00.000Z ')).toBe('2026-05-04');
    for (const v of ['04/05/2026', '2026-02-30', 'pendiente', '', null, undefined, 20260504]) expect(leerFechaCampo(v)).toBeNull();
  });
});

describe('el plan de la pasada', () => {
  it('un ticket nuevo con fecha → una fila de Desk vigente, enlazada con su equipo por serial sin mayúsculas ni espacios', () => {
    const p = plan({ tickets: [ticket(1001, '2026-05-04', { serial: ' 18a00001 ' })] });
    expect(p.altas).toEqual([{ clave: '18A00001', serial: '18a00001', serialNorm: '18A00001', deskEquipoId: null, fecha: '2026-05-04', origen: 'desk', ticket: 1001, estado: 'vigente', motivo: null }]);
    expect(p.anular).toEqual([]);
    expect(p.recuentos).toMatchObject({ conCampo: 1, porNombre: 1, porEtiqueta: 0, nuevas: 1, sinCambios: 0, cambiadas: 0, vaciadas: 0, enRevision: 0, sinEquipo: 0, otrasMarcas: 0 });
  });

  it('el enlace va primero por el equipo de Desk 2.0 (`equipo_id` → `desk_id`), aunque el serial del ticket sea otro', () => {
    const equipos = [equipo('18A00001', { deskId: 'eq-1' }), equipo('18A00002', { deskId: 'eq-2' })];
    const p = plan({ equipos, tickets: [ticket(1001, '2026-05-04', { equipoId: 'eq-2', serial: '18A00001' }), ticket(1002, '2026-05-05', { equipoId: 'eq-no-esta', serial: '18A00001' })] });
    expect(p.altas.map((a) => [a.ticket, a.clave, a.deskEquipoId])).toEqual([[1001, '18A00002', 'eq-2'], [1002, '18A00001', 'eq-no-esta']]);
  });

  it('cuenta de dónde salió cada fecha (nombre interno o etiqueta) y cuántos tickets gestiona la app', () => {
    const p = plan({ tickets: [ticket(1, '2026-01-01'), ticket(2, '2026-01-02', { campo: 'etiqueta', gestionadoPorApp: true })], total: 40, conCf: 9 });
    expect(p.recuentos).toMatchObject({ tickets: 40, conCf: 9, conCampo: 2, porNombre: 1, porEtiqueta: 1, gestionadosPorApp: 1 });
  });

  it('sin cambios: la misma fecha ya guardada no escribe nada; y aplicado un plan, el siguiente no trae nada (idempotente)', () => {
    const tickets = [ticket(1001, '2026-05-04'), ticket(1002, '2027-01-01'), ticket(1003, '2026-06-01', { serial: 'HB-0001' }), ticket(1004, '2026-06-02', { serial: '' })];
    const equipos = [equipo('18A00001', { ultimaCalibracion: '2025-10-17' })];
    const partida = [{ clave: '18A00001', serialNorm: '18A00001', fecha: '2025-10-17' }];
    const primero = plan({ tickets, equipos, partida });
    expect(primero.altas).toHaveLength(4);
    const segundo = plan({ tickets, equipos, partida, filas: aplicar(primero, []) });
    expect([segundo.altas, segundo.anular]).toEqual([[], []]);
    expect(segundo.recuentos).toMatchObject({ nuevas: 0, sinCambios: 3, cambiadas: 0, vaciadas: 0, sinEquipo: 1, partida: 0, equiposCambian: 0 });
  });

  it('la fecha cambió en Zoho → anula la fila de ese ticket e inserta otra: las fechas no se editan', () => {
    const guardada = fila({ fecha: '2026-05-04', ticket: 1001 });
    const p = plan({ tickets: [ticket(1001, '2026-05-14')], filas: [guardada] });
    expect(p.anular).toEqual([{ id: guardada.id, motivo: 'La fecha cambió en Zoho: 2026-05-04 → 2026-05-14.' }]);
    expect(p.altas.map((a) => [a.ticket, a.fecha, a.estado])).toEqual([[1001, '2026-05-14', 'vigente']]);
    expect(p.recuentos).toMatchObject({ nuevas: 0, cambiadas: 1, sinCambios: 0 });
  });

  it('el campo se vació en Zoho (el ticket ya no trae fecha) → anula su fila y no inserta', () => {
    const guardada = fila({ fecha: '2026-05-04', ticket: 1001 });
    const p = plan({ tickets: [ticket(1002, '2026-06-01')], filas: [guardada, fila({ fecha: '2026-06-01', ticket: 1002 })] });
    expect(p.anular).toEqual([{ id: guardada.id, motivo: 'El campo se vació en Zoho (o el ticket ya no está en Desk 2.0).' }]);
    expect(p.altas).toEqual([]);
    expect(p.recuentos).toMatchObject({ vaciadas: 1, sinCambios: 1 });
  });

  it('fecha futura → en revisión, no cuenta; la de hoy sí es vigente; y una anterior al mínimo, también en revisión', () => {
    const p = plan({ tickets: [ticket(1, '2026-10-12'), ticket(2, HOY), ticket(3, '1999-12-31'), ticket(4, FECHA_MINIMA_CALIBRACION)] });
    expect(p.altas.map((a) => [a.ticket, a.estado, a.motivo])).toEqual([
      [1, 'en_revision', 'La fecha es posterior a hoy.'],
      [2, 'vigente', null],
      [3, 'en_revision', `La fecha es anterior al ${FECHA_MINIMA_CALIBRACION}.`],
      [4, 'vigente', null],
    ]);
    expect(p.recuentos).toMatchObject({ nuevas: 4, enRevision: 2 });
    expect(calibracionQueCuenta(aplicar(p, []), HOY)?.fecha).toBe(HOY);
  });

  it('una fila en revisión por futura pasa a vigente cuando llega su día: la pasada la anula e inserta la vigente', () => {
    const tickets = [ticket(1, '2026-10-12')];
    const filas = aplicar(plan({ tickets }), []);
    const p = planCalibraciones({ hoy: '2026-10-12', tickets, total: 1, conCf: 1, filas, equipos: [equipo('18A00001')], partida: [] });
    expect(p.anular.map((a) => a.id)).toEqual([filas[0].id]);
    expect(p.altas.map((a) => a.estado)).toEqual(['vigente']);
    expect(p.recuentos).toMatchObject({ cambiadas: 0, reenlazadas: 1 });
  });

  it('un ticket sin serial ni equipo no crea fila: se cuenta', () => {
    const p = plan({ tickets: [ticket(1, '2026-05-04', { serial: '  ' }), ticket(2, '2026-05-04', { serial: null })] });
    expect(p.altas).toEqual([]);
    expect(p.recuentos).toMatchObject({ conCampo: 2, sinEquipo: 2, nuevas: 0 });
  });

  it('el serial de un equipo que no está en el inventario (otras marcas) se guarda SIN clave, para el lote 9d', () => {
    const p = plan({ tickets: [ticket(1, '2026-05-04', { serial: 'HB-0001', equipoId: 'eq-h' })] });
    expect(p.altas).toEqual([{ clave: null, serial: 'HB-0001', serialNorm: 'HB-0001', deskEquipoId: 'eq-h', fecha: '2026-05-04', origen: 'desk', ticket: 1, estado: 'vigente', motivo: null }]);
    expect(p.recuentos).toMatchObject({ nuevas: 1, otrasMarcas: 1, enRevision: 0, equiposCambian: 0 });
  });

  it('serial repetido en el inventario: casa con su única fila activa; con dos activas (o ninguna) es ambiguo → en revisión y sin clave', () => {
    const copia = [equipo('18A00004'), equipo('18A00004', { clave: '18A00004-2', activo: false })];
    expect(plan({ equipos: copia, tickets: [ticket(1, '2026-05-04', { serial: '18A00004' })] }).altas[0]).toMatchObject({ clave: '18A00004', estado: 'vigente' });
    for (const activo of [true, false]) {
      const dos = [equipo('18A00004', { activo }), equipo('18A00004', { clave: '18A00004-2', activo })];
      const p = plan({ equipos: dos, tickets: [ticket(1, '2026-05-04', { serial: '18A00004' })] });
      expect(p.altas[0]).toMatchObject({ clave: null, estado: 'en_revision', motivo: 'El serial está en más de un equipo del inventario.' });
      expect(p.recuentos).toMatchObject({ enRevision: 1, otrasMarcas: 0 });
    }
  });

  it('una fecha de Desk anterior a la que ya tiene el equipo se guarda como historial y no cambia su última calibración', () => {
    const filas = [fila({ fecha: '2026-05-04', origen: 'fst022' })];
    const p = plan({ tickets: [ticket(900, '2024-03-26')], filas, equipos: [equipo('18A00001', { ultimaCalibracion: '2026-05-04' })] });
    expect(p.altas.map((a) => [a.fecha, a.estado])).toEqual([['2024-03-26', 'vigente']]);
    expect(p.recuentos).toMatchObject({ nuevas: 1, historial: 1, equiposCambian: 0 });
    expect(calibracionQueCuenta(aplicar(p, filas), HOY)?.fecha).toBe('2026-05-04');
  });

  it('dos tickets con la misma fecha → dos filas', () => {
    const p = plan({ tickets: [ticket(1001, '2026-05-04'), ticket(1002, '2026-05-04')] });
    expect(p.altas.map((a) => [a.ticket, a.fecha])).toEqual([[1001, '2026-05-04'], [1002, '2026-05-04']]);
  });

  it('una fila anulada A MANO no la resucita la pasada mientras la fecha de Zoho siga igual; si cambia, entra la nueva', () => {
    const anulada = fila({ fecha: '2026-05-04', ticket: 1001, estado: 'anulada', anuladaAMano: true });
    const igual = plan({ tickets: [ticket(1001, '2026-05-04')], filas: [anulada] });
    expect([igual.altas, igual.anular]).toEqual([[], []]);
    expect(igual.recuentos).toMatchObject({ noResucitan: 1, nuevas: 0 });
    expect(plan({ tickets: [ticket(1001, '2026-05-06')], filas: [anulada] }).altas.map((a) => a.fecha)).toEqual(['2026-05-06']);
  });

  it('una fila que anuló la PASADA sí vuelve si Zoho vuelve a esa fecha (A → B → A)', () => {
    const a = fila({ fecha: '2026-05-04', ticket: 1001, estado: 'anulada' });
    const b = fila({ fecha: '2026-05-14', ticket: 1001 });
    const p = plan({ tickets: [ticket(1001, '2026-05-04')], filas: [a, b] });
    expect(p.anular.map((x) => x.id)).toEqual([b.id]);
    expect(p.altas.map((x) => x.fecha)).toEqual(['2026-05-04']);
  });

  it('un valor que no es una fecha no crea fila ni anula la que hubiera: se cuenta aparte', () => {
    const guardada = fila({ fecha: '2026-05-04', ticket: 1001 });
    const p = plan({ tickets: [ticket(1001, null)], filas: [guardada] });
    expect([p.altas, p.anular]).toEqual([[], []]);
    expect(p.recuentos).toMatchObject({ conCampo: 1, ilegibles: 1, vaciadas: 0 });
  });

  it('la pasada no toca las filas manuales ni las de la F-ST-022', () => {
    const filas = [fila({ origen: 'fst022' }), fila({ origen: 'manual', fecha: '2026-01-01' }), fila({ origen: 'manual', fecha: '2026-02-01', corrigeTicket: 55, corrigeFecha: '2026-02-02' })];
    expect(plan({ filas, tickets: [] }).anular).toEqual([]);
  });

  it('el plan no depende del orden en que lleguen las filas', () => {
    const tickets = [ticket(3, '2026-01-03'), ticket(1, '2026-01-01', { serial: 'HB-0001' }), ticket(2, '2027-01-01')];
    const equipos = [equipo('18A00002', { ultimaCalibracion: '2025-01-01' }), equipo('18A00001', { ultimaCalibracion: '2025-10-17' })];
    expect(plan({ tickets: [...tickets].reverse(), equipos: [...equipos].reverse() })).toEqual(plan({ tickets, equipos }));
  });

  describe('a cuántos equipos les cambia la última calibración', () => {
    it('un equipo vencido que recibe una calibración reciente: cambia y sale de los avisos', () => {
      const equipos = [equipo('18A00001', { ultimaCalibracion: '2025-06-01' }), equipo('18A00002', { ultimaCalibracion: '2025-12-01' })];
      expect(estadoCalibracion('2025-06-01', HOY, 365).estado).toBe('VENCIDA');
      const p = plan({ equipos, tickets: [ticket(1001, '2026-09-20')] });
      expect(p.recuentos).toMatchObject({ equiposCambian: 1, salenDeAvisos: 1, entranEnAvisos: 0 });
    });

    it('un equipo inactivo no se cuenta, y una fecha en revisión no cambia nada', () => {
      const p = plan({ equipos: [equipo('18A00001', { ultimaCalibracion: '2025-06-01', activo: false })], tickets: [ticket(1001, '2026-09-20')] });
      expect(p.recuentos).toMatchObject({ nuevas: 1, equiposCambian: 0, salenDeAvisos: 0 });
      expect(plan({ equipos: [equipo('18A00001', { ultimaCalibracion: '2025-06-01' })], tickets: [ticket(1001, '2027-09-20')] }).recuentos).toMatchObject({ enRevision: 1, equiposCambian: 0 });
    });

    // Lote 11: «sale de / entra en avisos» se cuenta con la vigencia de la marca de cada equipo, la misma regla que el inventario. Lo
    // leen la tarjeta y la pasada nocturna (que no decide por ellos): un equipo sin vencimiento cambia de fecha pero nunca entra ni sale.
    it('con la vigencia de su marca: un equipo sin vencimiento cambia, pero ni sale ni entra en avisos; con 365 días, sí', () => {
      const sin = plan({ equipos: [equipo('HB-0001', { ultimaCalibracion: '2025-06-01', vigenciaMarca: null }), equipo('HB-0002', { ultimaCalibracion: '2026-09-01', vigenciaMarca: null })], tickets: [ticket(1001, '2026-09-20', { serial: 'HB-0001' }), ticket(1002, '2026-09-21', { serial: 'HB-0002' })] });
      expect(sin.recuentos).toMatchObject({ equiposCambian: 2, salenDeAvisos: 0, entranEnAvisos: 0 });
      const con = plan({ equipos: [equipo('HB-0001', { ultimaCalibracion: '2025-06-01', vigenciaMarca: 365 })], tickets: [ticket(1001, '2026-09-20', { serial: 'HB-0001' })] });
      expect(con.recuentos).toMatchObject({ equiposCambian: 1, salenDeAvisos: 1, entranEnAvisos: 0 });
    });
  });

  describe('punto de partida: una fila fst022 por equipo con fecha conocida', () => {
    const e1 = equipo('18A00001', { ultimaCalibracion: '2025-10-17' });

    it('sale de la hoja congelada (el punto de partida firmado), por la clave del equipo', () => {
      const p = plan({ equipos: [e1], partida: [{ clave: '18A00001', serialNorm: '18A00001', fecha: '2025-10-17' }] });
      expect(p.altas).toEqual([{ clave: '18A00001', serial: '18A00001', serialNorm: '18A00001', deskEquipoId: null, fecha: '2025-10-17', origen: 'fst022', ticket: null, estado: 'vigente', motivo: 'F-ST-022 congelada.' }]);
      expect(p.recuentos).toMatchObject({ partida: 1, partidaDeInventario: 0, partidaDistintas: 0, equiposCambian: 0 });
    });

    it('si la hoja y el inventario dan fechas DISTINTAS manda la hoja, y se cuenta: no se mezclan en silencio', () => {
      const p = plan({ equipos: [e1], partida: [{ clave: '18A00001', serialNorm: '18A00001', fecha: '2025-11-20' }] });
      expect(p.altas.map((a) => a.fecha)).toEqual(['2025-11-20']);
      expect(p.recuentos).toMatchObject({ partida: 1, partidaDistintas: 1, equiposCambian: 1 });
      expect(p.detalle).toContainEqual({ tipo: 'distinta', ticket: null, clave: '18A00001', serial: '18A00001', fecha: '2025-11-20', antes: '2025-10-17', nota: 'F-ST-022 congelada.' });
    });

    it('sin clave en la hoja casa por serial, si no se repite en ningún lado; un alta del maestro (clave nueva) también', () => {
      const p = plan({ equipos: [equipo('18a00009', { clave: 'ALTA-9' })], partida: [{ clave: null, serialNorm: '18A00009', fecha: '2025-03-03' }] });
      expect(p.altas.map((a) => [a.clave, a.fecha])).toEqual([['ALTA-9', '2025-03-03']]);
      const repetido = plan({ equipos: [equipo('18A00009', { clave: 'ALTA-9' })], partida: [{ clave: null, serialNorm: '18A00009', fecha: '2025-03-03' }, { clave: null, serialNorm: '18A00009', fecha: '2025-04-04' }] });
      expect(repetido.altas).toEqual([]);
    });

    it('si la hoja no trae al equipo (o su celda no es una fecha) vale la del inventario, y se cuenta aparte', () => {
      const p = plan({ equipos: [e1, equipo('18A00002', { ultimaCalibracion: '2025-06-01' })], partida: [{ clave: '18A00001', serialNorm: '18A00001', fecha: null }] });
      expect(p.altas.map((a) => [a.clave, a.fecha, a.motivo])).toEqual([
        ['18A00001', '2025-10-17', 'Inventario del portal (la hoja congelada no trae fecha para este equipo).'],
        ['18A00002', '2025-06-01', 'Inventario del portal (la hoja congelada no trae fecha para este equipo).'],
      ]);
      expect(p.recuentos).toMatchObject({ partida: 2, partidaDeInventario: 2, partidaDistintas: 0, equiposCambian: 0 });
    });

    it('sin fecha en ninguno de los dos sitios no hay fila; y quien ya tiene su fila fst022 (aunque esté anulada) no recibe otra', () => {
      expect(plan({ equipos: [equipo('18A00001')] }).altas).toEqual([]);
      const ya = [fila({ origen: 'fst022', estado: 'anulada', anuladaAMano: true })];
      expect(plan({ equipos: [e1], filas: ya, partida: [{ clave: '18A00001', serialNorm: '18A00001', fecha: '2025-10-17' }] }).altas).toEqual([]);
    });

    it('con el punto de partida y una calibración de Desk más reciente, cuenta la de Desk', () => {
      const p = plan({ equipos: [e1], partida: [{ clave: '18A00001', serialNorm: '18A00001', fecha: '2025-10-17' }], tickets: [ticket(1001, '2026-09-20')] });
      expect(p.altas.map((a) => a.origen).sort()).toEqual(['desk', 'fst022']);
      expect(calibracionQueCuenta(aplicar(p, []), HOY)).toMatchObject({ origen: 'desk', fecha: '2026-09-20' });
    });
  });

  it('el detalle va ordenado por lo que hay que mirar primero y ningún recuento lleva un serial', () => {
    const p = plan({
      equipos: [equipo('18A00001', { ultimaCalibracion: '2025-10-17' })],
      partida: [{ clave: '18A00001', serialNorm: '18A00001', fecha: '2025-10-17' }],
      filas: [fila({ fecha: '2026-01-01', ticket: 5 }), fila({ fecha: '2026-02-02', ticket: 6 })],
      tickets: [ticket(1, '2026-05-04'), ticket(2, '2027-05-04'), ticket(3, '2026-05-04', { serial: 'HB-0001' }), ticket(4, '2026-05-04', { serial: '' }), ticket(5, '2026-01-02')],
    });
    expect(p.detalle.map((d) => d.tipo)).toEqual(['revision', 'cambiada', 'vaciada', 'sin_equipo', 'nueva', 'otra_marca', 'partida']);
    expect(JSON.stringify(p.recuentos)).not.toMatch(/18A0|HB-/);
  });
});

describe('comprobación de salud de la lectura', () => {
  it('con tickets que traen el campo no hay alerta', () => {
    expect(saludLectura(5, 5)).toEqual({ alerta: false, bloquea: false, mensaje: null });
  });

  it('si ningún ticket trae el campo lo dice claramente; si antes lo traían, además no deja traer (anularía todas las fechas de Desk)', () => {
    const nunca = saludLectura(0, 0);
    expect(nunca).toMatchObject({ alerta: true, bloquea: false });
    expect(nunca.mensaje).toMatch(/Ningún ticket de Desk 2\.0 trae la «Fecha de Calibración».*puede que el campo se haya renombrado en Zoho o que Desk 2\.0 no esté releyendo los tickets/);
    const baja = saludLectura(0, 5);
    expect(baja).toMatchObject({ alerta: true, bloquea: true });
    expect(baja.mensaje).toMatch(/antes la traían 5/);
  });
});

describe('el lector de calibraciones no lanza ni cuenta de más', () => {
  const URL_FICTICIA = 'postgres://lector_ficticio:clave-ficticia@desk-ficticio.invalid:5432/desk';
  afterEach(() => vi.restoreAllMocks());
  const FILA = { number: 1001, serial: '18A00001', equipo_id: 'eq-1', tipo_servicio: 'Calibración', status: 'Finalizado', managed_by_app: false, por_nombre: '2026-05-04', por_etiqueta: '2026-05-01' };
  const base = (filas: Record<string, unknown>[]) =>({ query: async (sql: string) => ({ rows: /count\(\*\)/.test(sql) ? [{ total: 40, con_cf: 9 }] : filas }) });

  it('sin conexión configurada: sin_variable, y no es un error', async () => {
    expect(await crearLectorCalibraciones(() => null)()).toEqual({ disponible: false, motivo: 'sin_variable' });
  });

  it('manda el nombre interno sobre la etiqueta; sin él vale la etiqueta; y un valor que no es fecha llega sin fecha', async () => {
    const lectura = await crearLectorCalibraciones(() => base([FILA, { ...FILA, number: 1002, por_nombre: null, equipo_id: null, managed_by_app: true }, { ...FILA, number: 1003, por_nombre: '  ', por_etiqueta: 'pendiente', serial: null }]))();
    expect(lectura).toEqual({
      disponible: true,
      total: 40,
      conCf: 9,
      tickets: [
        { numero: 1001, fecha: '2026-05-04', campo: 'nombre_interno', equipoId: 'eq-1', serial: '18A00001', tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: false },
        { numero: 1002, fecha: '2026-05-01', campo: 'etiqueta', equipoId: null, serial: '18A00001', tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: true },
        { numero: 1003, fecha: null, campo: 'etiqueta', equipoId: 'eq-1', serial: null, tipoServicio: 'Calibración', estado: 'Finalizado', gestionadoPorApp: false },
      ],
    });
  });

  it.each([
    [{ code: 'ECONNREFUSED' }, 'error_conexion'],
    [{ code: '57014' }, 'timeout'],
    [{ code: '42501' }, 'error_consulta'],
  ])('un fallo %j es el motivo %s: ni el mensaje ni la URL salen, tampoco al registro', async (extra, motivo) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = { query: async () => Promise.reject(Object.assign(new Error(`falló ${URL_FICTICIA}`), extra)) };
    const lectura = await crearLectorCalibraciones(() => db)();
    expect(lectura).toEqual({ disponible: false, motivo });
    const visto = JSON.stringify([lectura, warn.mock.calls, error.mock.calls]);
    for (const secreto of ['postgres://', 'lector_ficticio', 'clave-ficticia', 'desk-ficticio']) expect(visto).not.toContain(secreto);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('TODA la lectura del campo está en un solo sitio: el nombre interno y la etiqueta sólo se nombran en calibraciones-desk2.ts, y van como parámetros', async () => {
    expect([CAMPO_INTERNO, ETIQUETA_CAMPO]).toEqual(['cf_fecha_de_calibracion', 'Fecha de Calibración']);
    const consultas: { sql: string; params: unknown[] }[] = [];
    await crearLectorCalibraciones(() => ({ query: async (sql: string, params: unknown[] = []) => (consultas.push({ sql, params }), { rows: [{ total: 0, con_cf: 0 }] }) }))();
    const lectura = consultas.find((c) => !/count\(\*\)/.test(c.sql))!;
    expect(lectura.params).toEqual([CAMPO_INTERNO, ETIQUETA_CAMPO]);
    expect(lectura.sql).toMatch(/t\.raw->'cf'->>\$1/);
    expect(lectura.sql).toMatch(/t\.custom_fields->>\$2/);
    for (const c of consultas) {
      expect(c.sql).toMatch(/FROM desk\.tickets t/);
      expect(c.sql).not.toMatch(/\*(?!\))|to_jsonb|desk\.equipos|cf_fecha_cal_sensores_ext|Sensores/i);
      expect(c.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i);
    }
    for (const f of ['./calibraciones.ts', './calibraciones-repo.ts', './router.ts', './repo.ts']) expect(fuente(f), f).not.toMatch(/cf_fecha_de_calibracion|custom_fields|raw->'cf'/);
  });
});

describe('057_trazabilidad_calibraciones.sql', () => {
  const SQL = fuente('../users/migrations/057_trazabilidad_calibraciones.sql');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo crea con IF NOT EXISTS: sin semilla y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toHaveLength(6);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS /);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/\bdesk\./);
    expect(sinComentarios).not.toMatch(/\bREFERENCES\b/i);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad/i);
  });

  it('origen y estado con sus valores; el ticket sólo en las de Desk; como mucho una fila sin anular por ticket y una fst022 por equipo', () => {
    expect(sinComentarios).toMatch(/origen\s+VARCHAR\(10\)\s+NOT NULL CHECK \(origen IN \('fst022', 'desk', 'manual'\)\)/);
    expect(sinComentarios).toMatch(/estado\s+VARCHAR\(12\)\s+NOT NULL DEFAULT 'vigente' CHECK \(estado IN \('vigente', 'anulada', 'en_revision'\)\)/);
    expect(sinComentarios).toMatch(/fecha\s+DATE\s+NOT NULL/);
    expect(sinComentarios).toMatch(/CONSTRAINT tmc_calibraciones_ticket_de_desk CHECK \(\(origen = 'desk'\) = \(ticket IS NOT NULL\)\)/);
    expect(sinComentarios).toMatch(/CONSTRAINT tmc_calibraciones_corrige CHECK \(\(corrige_ticket IS NULL\) = \(corrige_fecha IS NULL\) AND \(corrige_ticket IS NULL OR origen = 'manual'\)\)/);
    expect(sinComentarios).toMatch(/CONSTRAINT tmc_calibraciones_anulada_firmada CHECK \(\(estado = 'anulada'\) = \(anulada_en IS NOT NULL AND anulada_por IS NOT NULL\)\)/);
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_calibraciones_ticket_uq ON portal\.tmc_calibraciones \(ticket\) WHERE origen = 'desk' AND estado <> 'anulada'/);
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_calibraciones_fst022_uq ON portal\.tmc_calibraciones \(clave\) WHERE origen = 'fst022'/);
    expect(sinComentarios).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_calibraciones_pasadas/);
  });

  it('está apuntada en MIGRATIONS, detrás de la 056 (la última es la 058: seguimiento.test.ts)', () => {
    expect(fuente('../db.ts')).toMatch(/'056_trazabilidad_maestro_equipos\.sql',\s*'057_trazabilidad_calibraciones\.sql',/);
  });
});

describe('las calibraciones no tocan lo que no es suyo', () => {
  it('su SQL sólo escribe en tmc_calibraciones y en sus pasadas: ni el inventario, ni el seguimiento, ni la congelación, ni la base de Desk 2.0; y una fecha nunca se edita', () => {
    const src = fuente('./calibraciones-repo.ts');
    const escrituras = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+([a-z_.0-9]+)/g)].map((m) => `${m[1].replace(/\s+/g, ' ')} ${m[2]}`);
    expect(escrituras.sort()).toEqual(['INSERT INTO portal.tmc_calibraciones', 'INSERT INTO portal.tmc_calibraciones_pasadas', 'UPDATE portal.tmc_calibraciones']);
    const update = /UPDATE portal\.tmc_calibraciones[^`]*/.exec(src)![0];
    expect(update).toMatch(/SET estado = 'anulada'/);
    expect(update).not.toMatch(/\bfecha\s*=|\bclave\s*=|\bserial/);
    expect(fuente('./repo.ts')).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+portal\.tmc_calibraciones/);
  });

  it('nada de esto manda nada a nadie, y no hay programador: se trae a mano', () => {
    for (const f of ['./calibraciones.ts', './calibraciones-desk2.ts', './calibraciones-repo.ts']) {
      expect(fuente(f), f).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
    }
  });

  it('la regla es pura: calibraciones.ts no importa más que el dominio (y tipos), para que la app la cargue tal cual', () => {
    const imports = [...fuente('./calibraciones.ts').matchAll(/^import (type )?.* from '([^']+)';\r?$/gm)].map((m) => `${m[1] ?? ''}${m[2]}`);
    expect(imports.sort()).toEqual(['./dominio.js', 'type ./maestro.js']);
    expect(fuente('./calibraciones.ts')).not.toMatch(/Date\.now|new Date\(\)/);
  });
});
