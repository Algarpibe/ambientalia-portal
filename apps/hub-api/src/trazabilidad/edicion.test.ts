import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calibracionQueCuenta, fechaEfectiva, type FilaCalibracion } from './calibraciones.js';
import { TzError, parseCalibracionManual, parseEnteroRuta, parseMotivo } from './types.js';

// Editar a mano (lote 9d-2b), sin base: los validadores de la corrección manual
// de una fecha y de un motivo, la regla de siempre vista desde lo que una
// persona puede hacer (registrar una manual, corregir un ticket, anular,
// resolver una fila en revisión) y los candados de qué escribe su SQL.
// Seriales inventados (el repo es público).

const HOY = '2026-10-12';
const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const error = (fn: () => unknown): [number, string | undefined, string] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof TzError) return [e.status, e.field, e.messageEs];
    throw e;
  }
  throw new Error('no lanzó');
};

describe('parseCalibracionManual', () => {
  const BASE = { clave: '18A00001', fecha: '2026-09-30', motivo: ' El certificado dice 30 de septiembre. ' };

  it('por la clave de un equipo: fecha, motivo sin espacios sobrantes y, si no se dice, sin ticket que corregir', () => {
    expect(parseCalibracionManual(BASE, HOY)).toEqual({ clave: '18A00001', fila: null, fecha: '2026-09-30', motivo: 'El certificado dice 30 de septiembre.', corrigeTicket: null });
  });

  it('por la fila de la hoja, para lo que no tiene equipo en el portal; y con el ticket que corrige', () => {
    expect(parseCalibracionManual({ fila: 37, fecha: HOY, motivo: 'm', corrigeTicket: 1001 }, HOY)).toEqual({ clave: null, fila: 37, fecha: HOY, motivo: 'm', corrigeTicket: 1001 });
  });

  it('400 si no dice de quién es, o si dice las dos cosas', () => {
    expect(error(() => parseCalibracionManual({ fecha: HOY, motivo: 'm' }, HOY))).toEqual([400, 'clave', 'Hay que decir de qué equipo es la calibración: su clave o su fila en la hoja F-ST-022.']);
    expect(error(() => parseCalibracionManual({ ...BASE, fila: 6 }, HOY))[1]).toBe('clave');
    expect(error(() => parseCalibracionManual({ ...BASE, clave: 'a b' }, HOY))[1]).toBe('clave');
    for (const fila of [0, -3, 1.5, '6']) expect(error(() => parseCalibracionManual({ fila, fecha: HOY, motivo: 'm' }, HOY))[1]).toBe('fila');
  });

  it('400 en la fecha: que falte, que no exista, posterior a hoy o anterior al mínimo de la regla', () => {
    for (const fecha of [undefined, '', '30/09/2026', '2026-02-30']) expect(error(() => parseCalibracionManual({ ...BASE, fecha }, HOY))[1]).toBe('fecha');
    expect(error(() => parseCalibracionManual({ ...BASE, fecha: '2026-10-13' }, HOY))).toEqual([400, 'fecha', 'La fecha de calibración no puede ser posterior a hoy.']);
    expect(error(() => parseCalibracionManual({ ...BASE, fecha: '1999-12-31' }, HOY))).toEqual([400, 'fecha', 'La fecha de calibración no puede ser anterior al 2000-01-01.']);
    expect(parseCalibracionManual({ ...BASE, fecha: '2000-01-01' }, HOY).fecha).toBe('2000-01-01');
  });

  it('400 sin motivo (obligatorio), con uno que no es texto o demasiado largo; y con un ticket que no es un entero positivo', () => {
    for (const motivo of [undefined, null, '', '   ']) expect(error(() => parseCalibracionManual({ ...BASE, motivo }, HOY))).toEqual([400, 'motivo', 'Hay que decir el motivo.']);
    expect(error(() => parseCalibracionManual({ ...BASE, motivo: 7 }, HOY))[1]).toBe('motivo');
    expect(error(() => parseCalibracionManual({ ...BASE, motivo: 'x'.repeat(501) }, HOY))[1]).toBe('motivo');
    for (const corrigeTicket of [0, -1, 1.5, '1001']) expect(error(() => parseCalibracionManual({ ...BASE, corrigeTicket }, HOY))[1]).toBe('corrigeTicket');
    expect(error(() => parseCalibracionManual([], HOY))[0]).toBe(400);
  });
});

describe('parseMotivo y parseEnteroRuta', () => {
  it('el motivo de anular (o de retirar) es obligatorio', () => {
    expect(parseMotivo({ motivo: '  Fecha de otro equipo.  ' })).toBe('Fecha de otro equipo.');
    for (const cuerpo of [{}, { motivo: ' ' }, null, 'texto']) expect(error(() => parseMotivo(cuerpo))[0]).toBe(400);
    expect(error(() => parseMotivo({}))).toEqual([400, 'motivo', 'Hay que decir el motivo.']);
  });

  it('un id o una fila de la ruta: sólo dígitos, un entero positivo', () => {
    expect(parseEnteroRuta('42', 'id')).toBe(42);
    for (const v of ['0', '-1', '4.2', 'abc', '', '1e3', undefined]) expect(error(() => parseEnteroRuta(v, 'fila'))).toEqual([400, 'fila', '«fila» no es válido.']);
  });
});

// La regla no cambia en este lote (calibraciones.test.ts la recorre entera): esto la mira desde lo que hace una persona.
describe('la regla de siempre, con lo que una persona puede hacer ahora', () => {
  let n = 0;
  const fila = (extra: Partial<FilaCalibracion> = {}): FilaCalibracion => ({ id: ++n, clave: '18A00001', serial: '18A00001', deskEquipoId: null, fecha: '2025-10-17', origen: 'desk', ticket: null, estado: 'vigente', corrigeTicket: null, corrigeFecha: null, anuladaAMano: false, ...extra });
  const partida = fila({ origen: 'fst022', fecha: '2025-03-01' });
  const ticket = fila({ ticket: 1001, fecha: '2026-03-01' });

  it('registrar una manual: cuenta como una calibración más (la más reciente), y a igual fecha gana a la de Desk', () => {
    expect(calibracionQueCuenta([partida, ticket, fila({ origen: 'manual', fecha: '2026-09-30' })], HOY)).toMatchObject({ origen: 'manual', fecha: '2026-09-30' });
    expect(calibracionQueCuenta([partida, ticket, fila({ origen: 'manual', fecha: '2025-12-01' })], HOY)).toBe(ticket);
    expect(calibracionQueCuenta([ticket, fila({ origen: 'manual', fecha: '2026-03-01' })], HOY)?.origen).toBe('manual');
  });

  it('corregir un ticket: la manual tapa la de Desk aunque sea ANTERIOR, mientras el ticket siga con la fecha que tenía; si cambia en Zoho, deja de contar', () => {
    const corrige = fila({ origen: 'manual', fecha: '2026-02-10', corrigeTicket: 1001, corrigeFecha: '2026-03-01' });
    expect(calibracionQueCuenta([partida, ticket, corrige], HOY)).toBe(corrige);
    const nueva = fila({ ticket: 1001, fecha: '2026-04-05' });
    expect(calibracionQueCuenta([partida, { ...ticket, estado: 'anulada' }, nueva, corrige], HOY)).toBe(nueva);
  });

  it('anular: la fila deja de contar y vale la anterior; con todas anuladas el equipo queda sin fecha (no vuelve la del inventario)', () => {
    expect(calibracionQueCuenta([partida, { ...ticket, estado: 'anulada', anuladaAMano: true }], HOY)).toBe(partida);
    expect(fechaEfectiva([{ ...partida, estado: 'anulada', anuladaAMano: true }], '2024-01-01', HOY)).toBeNull();
  });

  it('una fila en revisión no cuenta; se resuelve anulándola o registrando la manual correcta, nunca editándola', () => {
    const futura = fila({ ticket: 1002, fecha: '2027-03-01', estado: 'en_revision' });
    expect(calibracionQueCuenta([partida, futura], HOY)).toBe(partida);
    expect(calibracionQueCuenta([partida, futura, fila({ origen: 'manual', fecha: '2026-03-01', corrigeTicket: 1002, corrigeFecha: '2027-03-01' })], HOY)).toMatchObject({ origen: 'manual', fecha: '2026-03-01' });
    expect(calibracionQueCuenta([partida, { ...futura, estado: 'anulada', anuladaAMano: true }], HOY)).toBe(partida);
  });
});

describe('CANDADO: qué escribe la edición a mano', () => {
  const src = fuente('./edicion-repo.ts');
  const escrituras = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+([a-z_.0-9]+)/g)].map((m) => `${m[1].replace(/\s+/g, ' ')} ${m[2]}`);

  it('sólo inserta calibraciones y anula: nada se borra, y una fecha NUNCA se edita (corregir es registrar otra fila)', () => {
    expect(escrituras.sort()).toEqual(['INSERT INTO portal.tmc_calibraciones', 'UPDATE portal.tmc_calibraciones']);
    const update = /UPDATE portal\.tmc_calibraciones[^`]*/.exec(src)![0];
    expect(update).toMatch(/SET estado = 'anulada'/);
    expect(update).toMatch(/WHERE id = \$1 AND estado <> 'anulada'/);
    expect(update).not.toMatch(/\bfecha\s*=|\bclave\s*=|\bserial|anulada_pasada_id/);
    // Lo que inserta una persona es una fila `manual`, o la partida de una fila de la hoja ya anulada: nunca una de Desk.
    expect(src).toMatch(/origen: 'manual'/);
    expect(src).not.toMatch(/origen: 'desk'/);
  });

  it('no toca la congelación, el seguimiento, los contactos ni la base de Desk 2.0', () => {
    expect(src).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)[^;`]*tmc_fst022_\w+/i);
    expect(src).not.toMatch(/tmc_seguimiento|tmc_contactos|db-desk2|getDesk2Pool|\bdesk\./);
  });

  it('NINGÚN CORREO: cambiar la fecha de la que dependen los avisos no añade ningún camino de envío, ni programador', () => {
    expect(src).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
  });
});
