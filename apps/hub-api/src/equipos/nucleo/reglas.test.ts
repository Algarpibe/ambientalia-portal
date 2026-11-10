import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Reglas as R, EST, type Escaneo } from './index.js';

// Reglas del núcleo con fixtures ANONIMIZADAS (scripts/equipos-anonimizar.mjs). Los
// valores salen de fixtures/roles.json: cada rol es «el serial (o ticket, o cliente)
// que hace de X en este caso», nunca un dato real.
const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8'));
const ROL = fx('roles.json') as { seriales: Record<string, string>; tickets: Record<string, string>; clientes: Record<string, string> };
const S = ROL.seriales;
const T = ROL.tickets;
const C = ROL.clientes;
const pdf = fx('remisiones.json') as Record<string, string>;
const P = Object.fromEntries(Object.entries(pdf).map(([k, v]) => [k, R.scanParse(v)]));
const item = (k: string, sn: string) => P[k].it[R.cls(sn)] || { e: '', k: '' };

describe('lectura de remisiones de salida escaneadas', () => {
  it('el serial sin dígitos se reconoce aunque el OCR lo lea solo con letras, y no es parcial', () => {
    expect(/\d/.test(pdf.remA.split('\n').find((l) => R.cls(l.trim()) === R.cls(S.S_SIN_DIGITOS)) || '1')).toBe(false);
    expect(P.remA.t).toContain(R.cls(S.S_SIN_DIGITOS));
    expect(R.esParcial(item('remA', S.S_SIN_DIGITOS).e)).toBe(false);
  });
  it('la remisión trae el ticket de su serial', () => expect(item('remA', S.S_TICKET_EN_REMISION).k).toBe(T.T_EN_REMISION));
  it('el serial con T/7 se reconoce aunque el OCR cambie la T por un 7', () => expect(P.remB.t).toContain(R.cls(S.S_T7)));
  it('«Se incluye: Cable de poder» no vuelve parcial al serial con B/8', () => expect(R.esParcial(item('remB', S.S_B8).e)).toBe(false));
  it('una salida parcial (cable) con su ticket', () => {
    expect(R.esParcial(item('remC', S.S_PARCIAL).e)).toBe(true);
    expect(item('remC', S.S_PARCIAL).k).toBe(T.T_PARCIAL);
  });
  it('no es parcial si los accesorios van entre el modelo y el serial', () => expect(R.esParcial(item('remD', S.S_ACCESORIOS).e)).toBe(false));
  it('las palabras del formato no se toman como seriales', () => expect(P.remA.t.some((x) => /SERV/.test(x))).toBe(false));
});

describe('Zoho', () => {
  it('«Empty response» = sin tickets, no es error', () => {
    expect(R.tix({ data: { message: 'Empty response received from API. Service - DESK, Tool - searchTickets' } })).toEqual([]);
    expect(R.tix({ headers: {}, status: 'success', data: { message: 'Empty response received from API.' } })).toEqual([]);
    expect(R.tix('{"headers":{},"status":"success","data":{"message":"Empty response received"}}')).toEqual([]);
  });
  const ev = (t: string, a: string[] = [], d = '2026-10-01') =>
    R.cmtEvidence([{ commentedTime: d + 'T10:00:00Z', content: t, attachments: a.map((name) => ({ name })) }], new Set(['260928 - METROLOGICAL1.PDF', '261016 - CLIENTE C .PDF']), '2026-09-01', null);
  it('envío a Metrological con PDF adjunto no es entrega', () => expect(ev('EQUIPOS ENVIADOS A CALIBRACION DE SENSORES TEMP RH PRESS', ['260928 - Metrological1.pdf'])).toBeNull());
  it('comentario con la remisión escaneada adjunta sí es entrega', () => expect(ev('REMISION SALIDA', ['261016 - Cliente C .pdf'])).not.toBeNull());
  it('«recogido por la transportadora» sí es entrega', () => expect(ev('El equipo es recogido por la transportadora Envíos Ficticios')).not.toBeNull());
  it('«Repuestos entregados a…» no es entrega', () => expect(ev('Repuestos entregados a Técnico Uno')).toBeNull());
});

describe('enlace con ticket y clasificación', () => {
  const z = R.tnorm({ ticketNumber: '1401', status: 'Finalizado', statusType: 'Closed', createdTime: '2026-06-18T00:00:00Z', closedTime: '2026-08-20T00:00:00Z', webUrl: 'x/dv/1',
    cf: { cf_serial: '18A90100', cf_fecha_remision_entreda: '2026-06-17', cf_fecha_remision_de_salida: '2026-06-11' } });
  const v = R.visits([{ id: 'a', sn: '18A90100', d: '2026-06-16', c: 'CLIENTE D' }])[0];
  it('se enlaza con el ticket aunque su Fecha Remisión de Salida esté mal, y avisa el dato a corregir', () => {
    const lz = R.linkTicket(v, [z]);
    expect(lz?.n).toBe('1401');
    const c = R.classify(v, { z: lz, scans: [], age: 140, zq: true });
    expect(c.est).toBe(EST.CERRADO);
    expect(c.why.some((w) => /Dato a corregir/.test(w))).toBe(true);
  });
  it('Kunak: el cero a la izquierda no cuenta, nombre sin «Otro», enlace por fecha y por número de la remisión', () => {
    expect(R.cls('0344460096')).toBe(R.cls('344460096'));
    const doc = '| \\*\\*TICKET\\*\\* | \\*\\*EQUIPO\\*\\* | \\*\\*MARCA\\*\\* | \\*\\*\\\\\\# S/N\\*\\* | \\*\\*SERVICIO\\*\\* |\n| 1077  | AIR Pro | Kunak | 344460096 | Diagnóstico |\n| \\*\\*OBSERVACIONES O NOVEDADES\\*\\* |  |  |  |  |';
    expect(R.parseRemisionEntrada(doc, '344460096')).toEqual({ eq: 'AIR Pro · Kunak', srv: 'Diagnóstico', k: '1077' });
    const k = R.tnorm({ ticketNumber: '1077', status: 'Rev./Diagnostico', statusType: 'Open', createdTime: '2026-11-09T14:50:41Z', webUrl: 'x/dv/900000000000000001',
      subject: 'Servicio Técnico Cliente Prueba S.A.S. Sensor de calidad de aire MT_0344460096_Kunak AIR Pro_261030',
      cf: { cf_serial: '0344460096', cf_equipo_1: 'Otro', cf_modelo: 'Kunak AIR Pro', cf_fecha_remision_entreda: '2026-10-30', cf_codigo_servicio: 'MT_0344460096_Kunak AIR Pro_261030' } });
    expect(k.eq).toBe('Kunak AIR Pro');
    const kv = R.visits([{ id: 'k', sn: '344460096', d: '2026-10-30', c: 'Cliente Prueba' }])[0];
    expect(R.linkTicket(kv, [k])?.n).toBe('1077');
    const l2 = R.linkTicket(kv, [{ ...k, fe: '', tk: [] }], '1077');
    expect(l2?.n).toBe('1077');
    expect(l2?.lw).toMatch(/remisión de entrada/);
  });
});

describe('remisiones escaneadas ilegibles (casos anonimizados)', () => {
  type Caso = Pick<Escaneo, 'n' | 'd' | 't' | 'it'>;
  const F = fx('escaneos.json') as { ilegibles: Caso[]; legibles: Caso[]; fechaErrada: Caso };
  const E = new Set<string>();
  it.each(F.ilegibles.map((x): [string, Caso] => [x.n, x]))('%s se marca', (_n, x) => expect(R.scanIlegible(x, E)).not.toBeNull());
  it.each(F.legibles.map((x): [string, Caso] => [x.n, x]))('%s no se marca', (_n, x) => expect(R.scanIlegible(x, E)).toBeNull());
  it('el serial deformado «NN#NNNNN» deja sus dígitos para sugerir el equipo', () => {
    const x = F.ilegibles.find((y) => y.n.includes(C.C_ILEGIBLE))!;
    expect(R.scanIlegible(x, E)?.dg).toBe(S.S_DEFORMADO.slice(-5));
  });
  it('si trae el serial de un equipo con entrada no es ilegible', () =>
    expect(R.scanIlegible({ t: ['CANT1DAD', R.cls('70771')], it: { CANT1DAD: { e: 'Email', k: '' } } }, new Set([R.cls('70771')]))).toBeNull());
  it('fecha real: el nombre con fecha futura usa la fecha impresa; sin AAMMDD no se cruza; fecha normal sin cambios', () => {
    expect(R.fechaReal(F.fechaErrada, '2026-11-09')).toBe('2026-03-16');
    expect(R.fechaReal({ n: '2603 - X.pdf', d: '', t: [] }, '2026-11-09')).toBe('');
    expect(R.fechaReal({ n: '261106 - X.pdf', d: '2026-11-06', t: [] }, '2026-11-09')).toBe('2026-11-06');
  });
});
