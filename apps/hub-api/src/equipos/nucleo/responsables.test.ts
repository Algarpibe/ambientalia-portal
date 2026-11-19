import { describe, expect, it } from 'vitest';
import {
  AJUSTES_TABLERO_POR_DEFECTO, EST, aplicarAjustes, aplicarResponsables, avatarDe, claveFila, construirTablero, encargadoDesk, responsableDe,
  type Fila, type ResponsableFila, type Tarjeta, type TicketFila,
} from './index.js';

// Responsable de cada visita (D7): la asignación del portal manda sobre el Encargado de Desk; «Pendiente
// Asignar» no es nadie. Todo ficticio: serial, cliente y personas inventados.
const AHORA = Date.parse('2026-11-19T20:00:00Z');
const tk = (enc: string): TicketFila => ({ n: '1001', id: '1', st: 'En Proceso', stt: 'Open', u: '', m: '', enc, eq: 'Equipo Z', srv: '', fs: '', cl: '' });
const fila = (o: Partial<Fila> = {}): Fila =>
  ({ id: 'E1', d: '2026-11-01', c: 'CLIENTE A', sn: '18A90417', est: EST.TALLER, src: '', why: [], x: null, z: tk('Técnico Uno'), zc: false, pa: [], xd: '', eq: '', ...o });
const ASIGNADO: ResponsableFila = { userId: '00000000-0000-4000-8000-0000000000c2', nombre: 'Técnico Dos', por: 'Admin Uno', en: '2026-11-19T15:00:00.000Z' };
const tarjeta = (r: Fila): Tarjeta => construirTablero([r], AJUSTES_TABLERO_POR_DEFECTO, AHORA).columnas.flatMap((c) => c.tarjetas)[0];

describe('aplicarResponsables', () => {
  it('pone la asignación en la visita por su clave (serial en clase OCR + fecha de entrada)', () => {
    expect(claveFila(fila())).toBe('1BA9041T|2026-11-01');
    const [r] = aplicarResponsables([fila()], { '1BA9041T|2026-11-01': ASIGNADO });
    expect(r.resp).toEqual(ASIGNADO);
  });

  it('una visita nueva del mismo serial no hereda la asignación', () => {
    const vieja = fila();
    const nueva = fila({ id: 'E2', d: '2026-11-15' });
    const [a, b] = aplicarResponsables([vieja, nueva], { [claveFila(vieja)]: ASIGNADO });
    expect(a.resp).toEqual(ASIGNADO);
    expect(b.resp).toBeUndefined();
  });

  it('deja igual las filas sin asignación y no toca la lista recibida', () => {
    const rows = [fila()];
    const out = aplicarResponsables(rows, {});
    expect(out[0]).toBe(rows[0]);
    expect(rows[0].resp).toBeUndefined();
  });

  it('va detrás de aplicarAjustes: un ajuste y un responsable conviven en la misma visita', () => {
    const r = fila({ est: EST.REVISAR });
    const [x] = aplicarResponsables(aplicarAjustes([r], { [claveFila(r)]: { t: 'in', m: '', at: '2026-11-02' } }), { [claveFila(r)]: ASIGNADO });
    expect([x.est, x.resp?.nombre]).toEqual([EST.TALLER, 'Técnico Dos']);
  });
});

describe('responsableDe (D7)', () => {
  it('la asignación del portal manda sobre el Encargado de Desk', () => {
    expect(responsableDe({ ...fila(), resp: ASIGNADO })).toEqual({ nombre: 'Técnico Dos', userId: ASIGNADO.userId, origen: 'portal' });
  });

  it('sin asignación, el Encargado de Desk', () => {
    expect(responsableDe(fila())).toEqual({ nombre: 'Técnico Uno', origen: 'desk' });
    expect(encargadoDesk(fila())).toBe('Técnico Uno');
  });

  it('«Pendiente Asignar» no es una persona: sin responsable (se ve «Sin asignar»)', () => {
    for (const enc of ['Pendiente Asignar', ' PENDIENTE  asignar ']) {
      expect(responsableDe(fila({ z: tk(enc) })), enc).toBeNull();
      expect(encargadoDesk(fila({ z: tk(enc) })), enc).toBe('');
    }
  });

  it('sin ticket ni asignación, nadie; sin ticket pero asignado en el portal, el asignado', () => {
    expect(responsableDe(fila({ z: null }))).toBeNull();
    expect(responsableDe({ ...fila({ z: null }), resp: ASIGNADO })?.nombre).toBe('Técnico Dos');
  });

  it('una asignación solo con el nombre (la de la TV con llave) no inventa la cuenta', () => {
    expect(responsableDe({ ...fila(), resp: { nombre: 'Técnico Dos' } })).toEqual({ nombre: 'Técnico Dos', origen: 'portal' });
  });
});

describe('tarjetaDe usa el responsable efectivo', () => {
  it('con asignación: el asignado y su cuenta, aunque Desk diga otro', () => {
    const t = tarjeta({ ...fila(), resp: ASIGNADO });
    expect(t.tecnico).toEqual({ nombre: 'Técnico Dos', iniciales: 'TD', avatar: avatarDe('Técnico Dos'), userId: ASIGNADO.userId });
    expect(t.pie).toBe('tecnico');
  });

  it('sin asignación: el de Desk, sin cuenta', () => {
    const t = tarjeta(fila());
    expect(t.tecnico).toEqual({ nombre: 'Técnico Uno', iniciales: 'TU', avatar: 2 });
    expect(t.tecnico !== null && 'userId' in t.tecnico).toBe(false);
  });

  it('un equipo sin ticket asignado en el portal deja de ser «Sin técnico»', () => {
    const t = tarjeta({ ...fila({ z: null }), resp: ASIGNADO });
    expect([t.pie, t.tecnico?.nombre]).toEqual(['tecnico', 'Técnico Dos']);
  });
});
