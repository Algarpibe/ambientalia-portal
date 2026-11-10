import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { actualizar, CV, EST, aplicarAjustes, filasDeVista, ilegiblesPendientes, claveFila, VISTA_TICKET_ABIERTO, type Escaneo, type Fuentes } from './index.js';

// Una actualización completa sobre el caché de escaneos ANONIMIZADO: sin OCR (todo está en
// el caché) y sin tickets. Los roles (fixtures/roles.json) dicen qué serial y qué cliente
// hace de cada caso.
const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8'));
const { seriales: S, clientes: C } = fx('roles.json') as { seriales: Record<string, string>; clientes: Record<string, string> };
const F = fx('escaneos.json');
const sc: Escaneo[] = [...F.ilegibles, ...F.legibles, F.fechaErrada].map((x: Omit<Escaneo, 'id'>, i: number) => ({ id: 'p' + i, ...x }));
const ent = [
  ['260110 - ' + C.C_ILEGIBLE + ' - ' + S.S_DEFORMADO, 'e1'],
  ['260310 - ' + C.C_ILEGIBLE + ' - ' + S.S_FECHA_ERRADA, 'e2'],
  ['260601 - ' + C.C_SIN_TEXTO + ' - ' + S.S_SIN_TEXTO_1, 'e3'],
  ['260801 - ' + C.C_SIN_TEXTO + ' - ' + S.S_SIN_TEXTO_2, 'e4'],
].map(([title, id]) => ({ id, title }));
const fuentes: Fuentes = {
  entradas: async () => ent,
  salidasGeneradas: async () => [],
  salidasEscaneadas: async () => sc.map((x) => ({ id: x.id, title: x.n })),
  textoPdf: async () => { throw new Error('no debería leer PDFs: están en el caché'); },
  tickets: async () => [],
  comentarios: async () => [],
};

describe('actualización completa con el caché anonimizado', async () => {
  const o = await actualizar(fuentes, { exits: { v: CV, list: sc } }, { hoy: '2026-11-09' });
  const L = o.snap.ilegibles || [];
  const by = (n: string) => L.find((x) => x.n === n);
  const ilegibleDeFecha = '270316 - ' + C.C_ILEGIBLE + '.pdf';
  const ilegibleDeformado = '260115 - ' + C.C_ILEGIBLE + '.pdf';
  const ilegibleSinTexto = '260707 - ' + C.C_SIN_TEXTO + '.pdf';
  it('lista las ilegibles más la de fecha errada, sin avisos', () => {
    expect(L).toHaveLength(F.ilegibles.length + 1);
    expect(o.avisos).toEqual([]);
  });
  it('la remisión con fecha futura aparece como fecha errada y su equipo queda entregado en la fecha impresa', () => {
    expect(by(ilegibleDeFecha)?.q).toMatch(/2026-03-16/);
    const r = o.snap.rows.find((x) => x.sn === S.S_FECHA_ERRADA);
    expect([r?.est, r?.xd]).toEqual([EST.ENTREGADO, '2026-03-16']);
  });
  it('sugiere el serial del deformado y los equipos adentro del cliente para la remisión sin texto', () => {
    expect(by(ilegibleDeformado)?.p.map((p) => p.sn)).toContain(S.S_DEFORMADO);
    expect(by(ilegibleSinTexto)?.p.map((p) => p.sn)).toEqual([S.S_SIN_TEXTO_1]);
  });
  it('no lista remisiones comerciales, de gases, guías ni documentos ajenos', () =>
    expect(L.some((x) => F.legibles.some((l: { n: string }) => l.n === x.n))).toBe(false));
  it('los ajustes se aplican igual que en la página de Claude', () => {
    const r = o.snap.rows.find((x) => x.sn === S.S_SIN_TEXTO_1)!;
    const a = aplicarAjustes(o.snap.rows, { [claveFila(r)]: { t: 'out', m: 'recogido', at: '2026-11-09' }, ['pdf:' + by(ilegibleSinTexto)!.id]: { t: 'pdf', m: '', at: '2026-11-09' } });
    const r2 = a.find((x) => x.sn === S.S_SIN_TEXTO_1)!;
    expect([r2.est, r2.xd, r2.man]).toEqual([EST.ENTREGADO, '2026-11-09', 1]);
    expect(ilegiblesPendientes(o.snap, { ['pdf:' + by(ilegibleSinTexto)!.id]: { t: 'pdf', m: '', at: '' } })).toHaveLength(L.length - 1);
    expect(filasDeVista(a, VISTA_TICKET_ABIERTO)).toEqual([]);
  });
});
