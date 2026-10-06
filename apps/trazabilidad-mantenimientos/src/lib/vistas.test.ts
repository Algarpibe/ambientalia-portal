import { describe, it, expect } from 'vitest';
import { estadoCalibracion, type EquipoVista, type SeguimientoGuardado, type TicketDesk } from '../dominio';
import {
  avisosPorCliente,
  candidatosAviso,
  conteoPorEstado,
  enServicio,
  fmtFecha,
  mensajeAviso,
  porCliente,
  rejillaMes,
  textoVigencia,
  vencimientosPorMes,
} from './vistas';

const HOY = '2026-10-06';
let n = 0;
function eq(cliente: string, ultimaCalibracion: string | null, seg: Partial<SeguimientoGuardado> | null = null, ticket: TicketDesk | null = null): EquipoVista {
  const serial = `S${++n}`;
  return {
    clave: serial,
    serial,
    cliente,
    marca: 'Grimm',
    modelo: 'EDM 180C',
    fechaFactura: null,
    hojaVida: null,
    ultimaEntrada: null,
    ultimaCalibracion,
    entradasSt: null,
    calibracionesPeriodo: null,
    correctivosPeriodo: null,
    ...estadoCalibracion(ultimaCalibracion, HOY),
    serialRepetido: false,
    seguimiento: seg
      ? { enAmbientalia: false, avisoEnviado: null, servicioProgramado: null, nota: '', actualizadoPor: 'x', actualizadoEn: '', ...seg }
      : null,
    ticket,
  };
}

const vencida = (c: string, s: Partial<SeguimientoGuardado> | null = null) => eq(c, '2025-09-03', s); // vence 2026-09-03
const vence11 = (c: string) => eq(c, '2025-10-17'); // vence 2026-10-17
const TICKET: TicketDesk = { numero: 962, estado: 'En diagnóstico', sinConfirmar: false };
const conTicket = (c: string, t: Partial<TicketDesk> = {}) => eq(c, '2025-09-03', null, { ...TICKET, ...t }); // vencida y con ticket abierto
const vence57 = (c: string) => eq(c, '2025-12-02'); // vence 2026-12-02
const alDia = (c: string) => eq(c, '2026-08-01');
const fuera = (c: string) => eq(c, '2024-03-26');

describe('conteos y meses', () => {
  const L = [vencida('A'), vence11('A'), vence57('B'), alDia('B'), fuera('C'), eq('C', null)];

  it('cuenta por estado', () => {
    expect(conteoPorEstado(L)).toEqual({ FUERA_CICLO: 1, VENCIDA: 1, VENCE_30: 1, VENCE_60: 1, VENCE_90: 0, AL_DIA: 1, SIN_FECHA: 1 });
  });

  it('reparte los vencimientos en los 12 meses siguientes y lleva el atraso aparte', () => {
    const { atraso, meses } = vencimientosPorMes(L, HOY);
    expect(atraso).toBe(1);
    expect(meses).toHaveLength(12);
    expect(meses[0]).toEqual({ anio: 2026, mes: 9, total: 1 });
    expect(meses[2]).toEqual({ anio: 2026, mes: 11, total: 1 });
    expect(meses[3]).toMatchObject({ anio: 2027, mes: 0 });
    expect(meses[10]).toEqual({ anio: 2027, mes: 7, total: 1 }); // al día: calibrado 2026-08-01 → vence 2027-08-01
    expect(meses.reduce((s, m) => s + m.total, 0)).toBe(3); // ni el atraso ni el FUERA_CICLO ni el SIN_FECHA
  });
});

describe('por cliente y avisos', () => {
  it('ordena los clientes por lo que piden atención', () => {
    const L = [alDia('Z'), vencida('B'), vence11('B'), vence57('A')];
    expect(porCliente(L).map((f) => [f.cliente, f.vencidas, f.proximas90])).toEqual([
      ['B', 1, 1],
      ['A', 0, 1],
      ['Z', 0, 0],
    ]);
  });

  it('candidatos: dentro de la ventana y sin los que ya están en Ambientalia', () => {
    const L = [vencida('A'), vence11('A'), vence57('A'), vencida('B', { enAmbientalia: true }), alDia('C'), fuera('D')];
    expect(candidatosAviso(L, 30).map((e) => e.vigenciaDias)).toEqual([-33, 11]);
    expect(candidatosAviso(L, 60)).toHaveLength(3);
  });

  it('candidatos: un ticket abierto en Desk excluye igual que «en Ambientalia», confirmado o no', () => {
    const L = [vencida('A'), conTicket('A'), conTicket('B', { sinConfirmar: true })];
    expect(candidatosAviso(L, 90)).toEqual([L[0]]);
    expect(avisosPorCliente(L, 90).map((g) => [g.cliente, g.equipos.length])).toEqual([['A', 1]]);
  });

  it('en servicio: marcado a mano o con ticket abierto', () => {
    expect(enServicio(vencida('A'))).toBe(false);
    expect(enServicio(vencida('A', { enAmbientalia: false }))).toBe(false);
    expect(enServicio(vencida('A', { enAmbientalia: true }))).toBe(true);
    expect(enServicio(conTicket('A'))).toBe(true);
    expect(porCliente([vencida('A', { enAmbientalia: true }), conTicket('A'), vencida('A')])[0].enAmbientalia).toBe(2);
  });

  it('agrupa por cliente y cuenta los que no tienen aviso', () => {
    const L = [vencida('A', { avisoEnviado: '2026-10-01' }), vence11('A'), vence11('B', )];
    const g = avisosPorCliente(L, 90);
    expect(g.map((x) => [x.cliente, x.equipos.length, x.sinAviso])).toEqual([
      ['A', 2, 1],
      ['B', 1, 1],
    ]);
  });

  it('redacta el aviso con fechas en formato colombiano', () => {
    const t = mensajeAviso('Cliente Cuatro', [vencida('Cliente Cuatro'), vence11('Cliente Cuatro')]);
    expect(t).toMatch(/^Estimado cliente Cliente Cuatro:/);
    expect(t).toContain('los siguientes monitores');
    expect(t).toContain('última calibración 03/09/2025, vencida desde el 03/09/2026.');
    expect(t).toContain('vence el 17/10/2026.');
    expect(mensajeAviso('X', [vence11('X')])).toContain('el siguiente monitor de partículas GRIMM tiene');
  });
});

describe('calendario', () => {
  it('octubre de 2026 empieza el lunes 28/09 y acaba el domingo 01/11', () => {
    const r = rejillaMes([vence11('A'), fuera('B')], 2026, 9);
    expect(r[0]).toMatchObject({ fecha: '2026-09-28', delMes: false });
    expect(r.at(-1)).toMatchObject({ fecha: '2026-11-01', delMes: false });
    expect(r.length % 7).toBe(0);
    expect(r.find((d) => d.fecha === '2026-10-17')!.equipos).toHaveLength(1);
    expect(r.flatMap((d) => d.equipos)).toHaveLength(1);
  });
});

describe('formato', () => {
  it('fechas y vigencia', () => {
    expect(fmtFecha('2026-10-06')).toBe('06/10/2026');
    expect(fmtFecha(null)).toBe('—');
    expect(textoVigencia(-3)).toBe('vencida hace 3 d');
    expect(textoVigencia(0)).toBe('vence hoy');
    expect(textoVigencia(11)).toBe('quedan 11 d');
  });
});
