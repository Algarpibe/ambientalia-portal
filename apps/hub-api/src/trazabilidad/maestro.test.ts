import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serialNorm } from './dominio.js';
import { crearLectorMaestro } from './maestro-desk2.js';
import { CLAVE_MAX, cruceFst022, esGrimmEdm180, mismoNombre, modeloEdm180, planMaestro, type EquipoMaestro, type EquipoPortal } from './maestro.js';
import { TzError, parseHuellaPlan } from './types.js';

// El maestro de equipos (lote 9b), sin base: la regla pura del cruce entre
// `desk.equipos` de Desk 2.0 y el inventario del portal, el cruce informativo
// con la congelación y las guardas de la migración 056. Todo ficticio.

const fuente = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

let n = 0;
const desk = (serial: string, extra: Partial<EquipoMaestro> = {}): EquipoMaestro => ({ id: `eq-${++n}`, serial, marca: 'GRIMM', modelo: 'EDM180C', cliente: 'Cliente Ficticio A', activo: true, ...extra });
const portal = (serial: string, extra: Partial<EquipoPortal> = {}): EquipoPortal => ({ clave: serial, serial, cliente: 'Cliente Ficticio A', modelo: 'EDM 180C', activo: true, deskId: null, ...extra });
const SIN_CAMBIOS = { cliente: 0, modelo: 0, serial: 0, activo: 0 };

describe('reconocer un GRIMM EDM 180', () => {
  it.each([
    ['EDM180C', 'EDM 180C'],
    ['EDM 180C', 'EDM 180C'],
    ['edm 180 d', 'EDM 180D'],
    [' Edm-180 c ', 'EDM 180C'],
    ['GRIMM EDM180D', 'EDM 180D'],
    ['EDM 180', 'EDM 180'],
  ])('el modelo %j se guarda en la forma del portal: %j', (escrito, esperado) => {
    expect(modeloEdm180(escrito)).toBe(esperado);
  });

  it.each(['EDM 280', 'EDM1800', 'EDM 18', '1109', 'WS600', 'APNA-370', 'EDM180 con accesorios', '', null, undefined, 180])('%j no es un EDM 180', (modelo) => {
    expect(modeloEdm180(modelo)).toBeNull();
  });

  it('la marca casa sin mayúsculas ni espacios; vacía también vale (el EDM 180 sólo lo fabrica GRIMM) y otra marca no', () => {
    for (const marca of ['GRIMM', 'grimm', ' Grimm ', 'GRIMM Aerosol', '', null]) expect(esGrimmEdm180(marca, 'EDM180C')).toBe(true);
    expect(esGrimmEdm180('Horiba', 'EDM180C')).toBe(false);
    expect(esGrimmEdm180('GRIMM', 'EDM 280')).toBe(false);
  });
});

describe('el plan del cruce', () => {
  it('casa por serial sin mayúsculas ni espacios alrededor: la misma regla con que el portal cruza con Desk (`serialNorm`)', () => {
    const d = desk(' 18a00001 ');
    const plan = planMaestro([d], [portal('18A00001')], []);
    expect(serialNorm(' 18a00001 ')).toBe('18A00001');
    expect(plan.recuentos).toMatchObject({ maestro: 1, portal: 1, casan: 1, enlaces: 1, altas: 0, soloPortal: 0, ambiguosMaestro: 0, ambiguosPortal: 0, cambios: { ...SIN_CAMBIOS, serial: 1 } });
    // El serial se guarda como lo escribe el maestro, sin los espacios de alrededor.
    expect(plan.enlaces).toEqual([{ clave: '18A00001', deskId: d.id, serial: '18a00001', cliente: 'Cliente Ficticio A', modelo: 'EDM 180C', activo: true }]);
    expect(plan.cambios).toEqual([{ clave: '18A00001', campo: 'serial', antes: '18A00001', despues: '18a00001' }]);
  });

  it('sólo entran los GRIMM EDM 180 del maestro: las demás marcas ni casan ni se dan de alta (opción A)', () => {
    const plan = planMaestro([desk('18A00001'), desk('HB-0001', { marca: 'Horiba', modelo: 'APNA-370' }), desk('TH-0007', { marca: 'Thermo', modelo: '49i' }), desk('28A00001', { modelo: 'EDM 280' })], [], []);
    expect(plan.recuentos).toMatchObject({ maestro: 1, altas: 1 });
    expect(plan.altas.map((a) => a.serial)).toEqual(['18A00001']);
  });

  it('cambios campo a campo en los que casan; el modelo se compara y se guarda en la forma del portal', () => {
    const maestro = [
      desk('18A00001', { cliente: 'Cliente Ficticio A S.A.S.' }),
      desk('18A00002', { modelo: 'EDM180D' }),
      desk('18A00003', { modelo: 'edm 180 c' }),
      desk('18A00004', { activo: false }),
    ];
    const plan = planMaestro(maestro, [portal('18A00001'), portal('18A00002'), portal('18A00003'), portal('18A00004')], []);
    expect(plan.recuentos).toMatchObject({ casan: 4, enlaces: 4, cambios: { cliente: 1, modelo: 1, serial: 0, activo: 1 }, inactivos: 1, clienteOtroNombre: 0 });
    expect(plan.cambios).toEqual([
      { clave: '18A00001', campo: 'cliente', antes: 'Cliente Ficticio A', despues: 'Cliente Ficticio A S.A.S.' },
      { clave: '18A00002', campo: 'modelo', antes: 'EDM 180C', despues: 'EDM 180D' },
      { clave: '18A00004', campo: 'activo', antes: 'sí', despues: 'no' },
    ]);
  });

  it('un cliente que sólo cambia de escritura (mayúsculas, tildes, espacios) es un cambio de texto, no un cambio de cliente', () => {
    const plan = planMaestro([desk('18A00001', { cliente: 'CLIENTE  FICTICIO  Á' })], [portal('18A00001', { cliente: 'Cliente Ficticio A' })], ['cliente ficticio a']);
    expect(plan.recuentos).toMatchObject({ cambios: { ...SIN_CAMBIOS, cliente: 1 }, clienteOtroNombre: 0, contactosSinEquipos: 0 });
    expect(plan.enlaces[0].cliente).toBe('CLIENTE FICTICIO Á');
  });

  it('sin cliente en el maestro no se borra el del portal; un alta sin cliente lo dice', () => {
    const plan = planMaestro([desk('18A00001', { cliente: null }), desk('18A00009', { cliente: '  ' })], [portal('18A00001')], []);
    expect(plan.enlaces[0].cliente).toBe('Cliente Ficticio A');
    expect(plan.altas[0].cliente).toBe('(sin cliente en Desk 2.0)');
    expect(plan.recuentos.cambios.cliente).toBe(0);
  });

  it('sólo en Desk 2.0 → alta sin fecha, con el modelo del portal y una clave libre; un inactivo no se da de alta', () => {
    const maestro = [desk('18a/00007', { modelo: 'EDM180D', cliente: 'Cliente Ficticio B' }), desk('18A00008', { activo: false })];
    const plan = planMaestro(maestro, [portal('OTRO', { clave: '18a_00007' })], []);
    expect(plan.altas).toEqual([{ clave: '18a_00007-2', deskId: maestro[0].id, serial: '18a/00007', cliente: 'Cliente Ficticio B', marca: 'GRIMM', modelo: 'EDM 180D' }]);
    expect(plan.recuentos).toMatchObject({ altas: 1, inactivos: 1, soloPortal: 1 });
    expect(plan.cambios).toEqual([{ clave: '18a_00007-2', campo: 'alta', antes: null, despues: '18a/00007 · Cliente Ficticio B' }]);
  });

  it('sólo en el portal: se cuentan (también cuántos están activos) y no se tocan', () => {
    const plan = planMaestro([desk('18A00001')], [portal('18A00001'), portal('18A00050'), portal('18A00051', { activo: false })], []);
    expect(plan.recuentos).toMatchObject({ casan: 1, soloPortal: 2, soloPortalActivos: 1 });
    expect(plan.enlaces.map((e) => e.clave)).toEqual(['18A00001']);
  });

  it('ambiguos: un serial repetido en el maestro o en el portal no se enlaza ni se toca, en ninguno de los dos lados', () => {
    const maestro = [desk('18A00004'), desk('18a00004 ', { cliente: 'Cliente Ficticio B' }), desk('18A00005'), desk('18A00006')];
    const inventario = [portal('18A00004'), portal('18A00005'), portal('18A00005', { clave: '18A00005-2', cliente: 'Cliente Ficticio C' }), portal('18A00006')];
    const plan = planMaestro(maestro, inventario, []);
    expect(plan.recuentos).toMatchObject({ casan: 1, altas: 0, ambiguosMaestro: 3, ambiguosPortal: 3, soloPortal: 0 });
    expect(plan.enlaces.map((e) => e.clave)).toEqual(['18A00006']);
    expect(plan.altas).toEqual([]);
  });

  // Lo que se vio en producción: una reimportación antigua dejó una fila retirada (inactiva) con el
  // serial de un equipo que sigue activo, y por esa copia el activo se quedaba sin enlazar.
  describe('un serial repetido en el portal', () => {
    const copia = (serial: string, n: number, activo: boolean, extra: Partial<EquipoPortal> = {}) => portal(serial, { clave: n === 1 ? serial : `${serial}-${n}`, activo, ...extra });
    const plan = (maestro: EquipoMaestro[], inventario: EquipoPortal[]) => planMaestro(maestro, inventario, []);

    it('una activa y una inactiva, y el maestro lo tiene una vez: casa con la activa; la inactiva no se toca y se cuenta aparte, no como ambigua', () => {
      const d = desk('18a00004', { cliente: 'Cliente Ficticio B' });
      for (const inventario of [[copia('18A00004', 1, true), copia('18A00004', 2, false)], [copia('18A00004', 1, false), copia('18A00004', 2, true)]]) {
        const p = plan([d], inventario);
        const activa = inventario.find((x) => x.activo)!.clave;
        expect(p.recuentos).toMatchObject({ casan: 1, enlaces: 1, altas: 0, ambiguosMaestro: 0, ambiguosPortal: 0, copiasInactivas: 1, soloPortal: 0 });
        expect(p.enlaces).toEqual([{ clave: activa, deskId: d.id, serial: '18a00004', cliente: 'Cliente Ficticio B', modelo: 'EDM 180C', activo: true }]);
        expect(p.ambiguos).toEqual([]);
      }
    });

    it('una activa y varias inactivas: igual', () => {
      const p = plan([desk('18A00004')], [copia('18A00004', 1, false), copia('18A00004', 2, true), copia('18A00004', 3, false)]);
      expect(p.recuentos).toMatchObject({ casan: 1, copiasInactivas: 2, ambiguosPortal: 0, ambiguosMaestro: 0 });
      expect(p.enlaces.map((e) => e.clave)).toEqual(['18A00004-2']);
    });

    it.each([
      ['dos activas', [true, true], 2],
      ['ninguna activa', [false, false], 2],
      ['dos activas y una inactiva', [true, true, false], 3],
    ])('%s: sigue siendo ambiguo, en los dos lados, y no se toca nada', (_caso, activos, n) => {
      const p = plan([desk('18A00004')], activos.map((a, i) => copia('18A00004', i + 1, a)));
      expect(p.recuentos).toMatchObject({ casan: 0, altas: 0, ambiguosMaestro: 1, ambiguosPortal: n, copiasInactivas: 0 });
      expect(p.enlaces).toEqual([]);
    });

    it('repetido también en el maestro: ambiguo aunque en el portal sólo una esté activa', () => {
      const p = plan([desk('18A00004'), desk('18A00004', { cliente: 'Cliente Ficticio B' })], [copia('18A00004', 1, true), copia('18A00004', 2, false)]);
      expect(p.recuentos).toMatchObject({ casan: 0, altas: 0, ambiguosMaestro: 2, ambiguosPortal: 2, copiasInactivas: 0 });
    });

    it('el enlace por id sigue mandando: la fila ya enlazada casa aunque esté inactiva, y la otra activa con su serial es ambigua', () => {
      const d = desk('18A00004');
      const p = plan([d], [copia('18A00004', 1, false, { deskId: d.id }), copia('18A00004', 2, true)]);
      expect(p.enlaces.map((e) => e.clave)).toEqual(['18A00004']);
      expect(p.recuentos).toMatchObject({ casan: 1, enlaces: 0, ambiguosPortal: 1, copiasInactivas: 0 });
    });

    it('si el maestro no tiene ese serial: la activa es «sólo en el portal» y la inactiva, su copia', () => {
      const p = plan([], [copia('18A00004', 1, true), copia('18A00004', 2, false)]);
      expect(p.recuentos).toMatchObject({ soloPortal: 1, soloPortalActivos: 1, copiasInactivas: 1, ambiguosPortal: 0 });
    });

    it('idempotente: aplicado, el siguiente no trae cambios; y si el maestro lo desactiva después, la copia sigue siendo copia', () => {
      const d = desk('18A00004');
      const inventario = [copia('18A00004', 1, true), copia('18A00004', 2, false)];
      const p = plan([d], inventario);
      const aplicado = inventario.map((x) => ({ ...x, ...p.enlaces.find((e) => e.clave === x.clave) }));
      const otra = plan([d], aplicado);
      expect(otra.recuentos).toMatchObject({ casan: 1, enlaces: 0, cambios: SIN_CAMBIOS, copiasInactivas: 1, ambiguosPortal: 0 });
      expect(otra.cambios).toEqual([]);
      const inactivo = plan([{ ...d, activo: false }], aplicado);
      expect(inactivo.recuentos).toMatchObject({ casan: 1, cambios: { ...SIN_CAMBIOS, activo: 1 }, copiasInactivas: 1, ambiguosPortal: 0 });
      const despues = aplicado.map((x) => ({ ...x, ...inactivo.enlaces.find((e) => e.clave === x.clave) }));
      expect(plan([{ ...d, activo: false }], despues).recuentos).toMatchObject({ casan: 1, cambios: SIN_CAMBIOS, copiasInactivas: 1, ambiguosPortal: 0 });
    });
  });

  it('para revisar: lo que sólo está en el portal y los ambiguos de los dos lados salen con su clave (o su id de Desk 2.0), serial y cliente', () => {
    const a = desk('18A00005', { cliente: 'Cliente Ficticio M' });
    const p = planMaestro([a, desk('18A00001')], [portal('18A00001'), portal('18A00050', { cliente: 'Cliente Ficticio P' }), portal('18A00005'), portal('18A00005', { clave: '18A00005-2', cliente: 'Cliente Ficticio Q' }), portal('18A00060', { activo: false })], []);
    expect(p.soloPortal).toEqual([
      { origen: 'portal', clave: '18A00050', serial: '18A00050', cliente: 'Cliente Ficticio P', activo: true },
      { origen: 'portal', clave: '18A00060', serial: '18A00060', cliente: 'Cliente Ficticio A', activo: false },
    ]);
    expect(p.ambiguos).toEqual([
      { origen: 'desk', clave: a.id, serial: '18A00005', cliente: 'Cliente Ficticio M', activo: true },
      { origen: 'portal', clave: '18A00005', serial: '18A00005', cliente: 'Cliente Ficticio A', activo: true },
      { origen: 'portal', clave: '18A00005-2', serial: '18A00005', cliente: 'Cliente Ficticio Q', activo: true },
    ]);
  });

  describe('¿cambia el nombre del cliente, o sólo cómo se escribe?', () => {
    it.each([
      ['Cliente Ficticio', 'Cliente Ficticio S.A.S.'],
      ['Cliente Ficticio Ltda', 'CLIENTE FICTICIO S.A.S. BIC'],
      ['Cliente Ficticio S.A', 'Cliente  Ficticio, S. A. S.'],
      ['Aguas Ficticias E.S.P.', 'Aguas Ficticias S.A. E.S.P'],
      ['Cliente-Ficticio (Bogotá)', 'cliente ficticio bogota'],
      ['Cliente Ficticio & Cía. Ltda.', 'Cliente Ficticio y Cia'],
    ])('%j y %j son el mismo nombre: sólo cambian mayúsculas, tildes, puntuación o la forma societaria', (a, b) => {
      expect(mismoNombre(a, b)).toBe(true);
      expect(planMaestro([desk('18A00001', { cliente: b })], [portal('18A00001', { cliente: a })], []).recuentos).toMatchObject({ cambios: { ...SIN_CAMBIOS, cliente: 1 }, clienteOtroNombre: 0 });
    });

    it.each([
      ['CFA', 'Cliente Ficticio Ambiental S.A.S. - CFA'],
      ['Cliente Ficticio', 'Cliente Ficticio Norte S.A.S.'],
      ['Cliente Ficticio', 'Cliente Fictisio'],
      ['Casa Ficticia', 'Ca Ficticia'],
      ['S.A.S.', 'Ltda'],
    ])('%j y %j no: no se adivina que unas siglas, un nombre más largo o una errata sean el mismo', (a, b) => {
      expect(mismoNombre(a, b)).toBe(false);
      expect(planMaestro([desk('18A00001', { cliente: b })], [portal('18A00001', { cliente: a })], []).recuentos.clienteOtroNombre).toBe(1);
    });
  });

  it('un serial vacío o más largo que la clave no entra: se cuenta aparte', () => {
    const plan = planMaestro([desk('  '), desk('X'.repeat(CLAVE_MAX + 1))], [], []);
    expect(plan.recuentos).toMatchObject({ maestro: 2, sinSerial: 2, altas: 0 });
  });

  it('la clave de un alta cabe siempre en su columna, también con el serial más largo y la clave ya cogida', () => {
    const largo = 'X'.repeat(CLAVE_MAX);
    const plan = planMaestro([desk(largo)], [portal('OTRO', { clave: largo.slice(0, CLAVE_MAX - 4) })], []);
    expect(plan.altas).toHaveLength(1);
    expect(plan.altas[0].clave).toBe(`${'X'.repeat(CLAVE_MAX - 4)}-2`);
    expect(plan.altas[0].serial).toBe(largo);
  });

  it('un equipo ya enlazado casa por su id de Desk 2.0 aunque allí le corrijan el serial: su clave no cambia', () => {
    const d = desk('18A00077');
    const plan = planMaestro([d], [portal('18A00007', { deskId: d.id })], []);
    expect(plan.recuentos).toMatchObject({ casan: 1, enlaces: 0, altas: 0, soloPortal: 0, cambios: { ...SIN_CAMBIOS, serial: 1 } });
    expect(plan.enlaces).toEqual([{ clave: '18A00007', deskId: d.id, serial: '18A00077', cliente: 'Cliente Ficticio A', modelo: 'EDM 180C', activo: true }]);
  });

  it('un equipo nuevo en Desk 2.0 con el serial de otro ya enlazado es ambiguo: no se da de alta un segundo', () => {
    const a = desk('18A00001');
    const b = desk('18A00001', { cliente: 'Cliente Ficticio B' });
    const plan = planMaestro([a, b], [portal('18A00001', { deskId: a.id })], []);
    expect(plan.recuentos).toMatchObject({ casan: 1, altas: 0, ambiguosMaestro: 1 });
  });

  it('cambio de cliente: la clave no cambia y se cuentan los contactos puestos a mano que se quedarían sin equipos', () => {
    const maestro = [desk('18A00001', { cliente: 'Cliente Ficticio B' }), desk('18A00002'), desk('18A00003', { cliente: 'Cliente Ficticio C', activo: false })];
    const inventario = [portal('18A00001', { cliente: 'Cliente Ficticio Z' }), portal('18A00002'), portal('18A00003', { cliente: 'Cliente Ficticio C' })];
    // Z se queda sin equipos (su único equipo pasa a B); C también (su equipo deja de estar activo); A conserva uno; «nadie» nunca tuvo.
    const plan = planMaestro(maestro, inventario, ['cliente ficticio z', 'cliente ficticio c', 'cliente ficticio a', 'nadie']);
    expect(plan.recuentos).toMatchObject({ clienteOtroNombre: 1, contactosSinEquipos: 2 });
    expect(plan.enlaces.map((e) => e.clave)).toEqual(['18A00001', '18A00002', '18A00003']);
  });

  it('un equipo retirado en el portal que el maestro tiene activo vuelve a estar activo', () => {
    const plan = planMaestro([desk('18A00001')], [portal('18A00001', { activo: false })], []);
    expect(plan.recuentos.cambios.activo).toBe(1);
    expect(plan.enlaces[0].activo).toBe(true);
  });

  it('el plan no depende del orden en que lleguen las filas', () => {
    const maestro = [desk('18A00003', { cliente: 'Cliente Ficticio B' }), desk('18A00001'), desk('18A00009'), desk('18A00008')];
    const inventario = [portal('18A00003'), portal('18A00001'), portal('18A00040')];
    expect(planMaestro([...maestro].reverse(), [...inventario].reverse(), [])).toEqual(planMaestro(maestro, inventario, []));
  });

  it('idempotente: con el plan aplicado, el plan siguiente no trae cambios, altas ni enlaces nuevos', () => {
    const maestro = [desk('18a00001', { cliente: 'Cliente Ficticio B' }), desk('18A00002', { modelo: 'EDM180D', activo: false }), desk('18A00009')];
    const inventario = [portal('18A00001'), portal('18A00002'), portal('18A00040')];
    const plan = planMaestro(maestro, inventario, []);
    expect(plan.cambios.length).toBeGreaterThan(0);
    const aplicado: EquipoPortal[] = [
      ...inventario.map((p) => ({ ...p, ...plan.enlaces.find((e) => e.clave === p.clave) })),
      ...plan.altas.map((a) => ({ clave: a.clave, serial: a.serial, cliente: a.cliente, modelo: a.modelo, activo: true, deskId: a.deskId })),
    ];
    const otra = planMaestro(maestro, aplicado, []);
    expect(otra.recuentos).toMatchObject({ casan: 3, enlaces: 0, altas: 0, cambios: SIN_CAMBIOS, clienteOtroNombre: 0, soloPortal: 1 });
    expect(otra.cambios).toEqual([]);
    expect(planMaestro(maestro, aplicado, [])).toEqual(otra);
  });
});

describe('cruce informativo de la congelación con el maestro (todas las marcas)', () => {
  const v3 = (marca: string, serial: string | null) => ({ marca, serial });
  const eq = (marca: string | null, serial: string) => ({ marca, serial });

  it('por marca: casan, sólo en la V3, sólo en Desk 2.0 y ambiguos; sólo recuentos', () => {
    const cruce = cruceFst022(
      [v3('Grimm', '18A00001'), v3('GRIMM', '18A00002'), v3('Horiba', 'HB-1'), v3('HORIBA', 'HB-1'), v3('Thermo', 'TH-0007')],
      [eq('GRIMM', '18a00001'), eq('Horiba', 'HB-1'), eq('Thermo', 'TH-0008'), eq(null, 'X-1')],
    );
    expect(cruce).toEqual([
      { marca: 'Grimm', v3: 2, desk: 1, casan: 1, soloV3: 1, soloDesk: 0, ambiguos: 0, sinCeros: 0 },
      { marca: 'Horiba', v3: 2, desk: 1, casan: 0, soloV3: 0, soloDesk: 0, ambiguos: 3, sinCeros: 0 },
      { marca: 'Thermo', v3: 1, desk: 1, casan: 0, soloV3: 1, soloDesk: 1, ambiguos: 0, sinCeros: 0 },
      { marca: '(sin marca)', v3: 0, desk: 1, casan: 0, soloV3: 0, soloDesk: 1, ambiguos: 0, sinCeros: 0 },
    ]);
  });

  it('un serial numérico que perdió sus ceros a la izquierda no casa, pero se cuenta cuántos casarían ignorándolos', () => {
    const cruce = cruceFst022([v3('Thermo', '123'), v3('Thermo', '77'), v3('Thermo', 'A-0001')], [eq('Thermo', '00123'), eq('Thermo', '078'), eq('Thermo', 'A-1')]);
    expect(cruce).toEqual([{ marca: 'Thermo', v3: 3, desk: 3, casan: 0, soloV3: 3, soloDesk: 3, ambiguos: 0, sinCeros: 1 }]);
  });

  it('una fila sin serial cuenta como sólo en su lado', () => {
    expect(cruceFst022([v3('Thermo', null)], [eq('Thermo', ' ')])).toEqual([{ marca: 'Thermo', v3: 1, desk: 1, casan: 0, soloV3: 1, soloDesk: 1, ambiguos: 0, sinCeros: 0 }]);
  });
});

describe('el lector del maestro no lanza ni cuenta de más', () => {
  const URL_FICTICIA = 'postgres://lector_ficticio:clave-ficticia@desk-ficticio.invalid:5432/desk';
  afterEach(() => vi.restoreAllMocks());

  it('sin conexión configurada: sin_variable, y no es un error', async () => {
    expect(await crearLectorMaestro(() => null)()).toEqual({ disponible: false, motivo: 'sin_variable' });
  });

  it('con la conexión, da los equipos tal cual vienen (el filtro de GRIMM EDM 180 es de la regla)', async () => {
    const db = { query: async () => ({ rows: [{ id: 'eq-1', serial: '18A00001', marca: 'GRIMM', modelo: 'EDM180C', cliente_nombre: null, active: true }, { id: 'eq-2', serial: 'HB-1', marca: null, modelo: null, cliente_nombre: 'Cliente Ficticio B', active: null }] }) };
    expect(await crearLectorMaestro(() => db)()).toEqual({
      disponible: true,
      equipos: [
        { id: 'eq-1', serial: '18A00001', marca: 'GRIMM', modelo: 'EDM180C', cliente: null, activo: true },
        { id: 'eq-2', serial: 'HB-1', marca: null, modelo: null, cliente: 'Cliente Ficticio B', activo: false },
      ],
    });
  });

  it.each([
    [{ code: 'ECONNREFUSED' }, 'error_conexion'],
    [{ code: '57014' }, 'timeout'],
    [{ code: '42501' }, 'error_consulta'],
    [{ code: '42P01' }, 'error_consulta'],
  ])('un fallo %j es el motivo %s: ni el mensaje ni la URL salen, tampoco al registro', async (extra, motivo) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = { query: async () => Promise.reject(Object.assign(new Error(`falló ${URL_FICTICIA}`), extra)) };
    const lectura = await crearLectorMaestro(() => db)();
    expect(lectura).toEqual({ disponible: false, motivo });
    const visto = JSON.stringify([lectura, warn.mock.calls, error.mock.calls]);
    for (const secreto of ['postgres://', 'lector_ficticio', 'clave-ficticia', 'desk-ficticio']) expect(visto).not.toContain(secreto);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('cada lectura prueba una vez, sin memoria: tras un fallo, la siguiente vuelve a intentarlo (no tiene cortacircuitos)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const db = { query: async () => (++n === 1 ? Promise.reject(Object.assign(new Error('x'), { code: 'ECONNRESET' })) : { rows: [] }) };
    const leer = crearLectorMaestro(() => db);
    expect((await leer()).disponible).toBe(false);
    expect(await leer()).toEqual({ disponible: true, equipos: [] });
  });
});

describe('la huella del plan que manda el cliente', () => {
  it('opcional; si viene, son 64 hexadecimales', () => {
    expect(parseHuellaPlan(undefined)).toBeNull();
    expect(parseHuellaPlan({})).toBeNull();
    expect(parseHuellaPlan({ huella: 'ab'.repeat(32) })).toBe('ab'.repeat(32));
    for (const cuerpo of [{ huella: 'x' }, { huella: 7 }, { huella: 'AB'.repeat(32) }, []]) expect(() => parseHuellaPlan(cuerpo)).toThrow(TzError);
  });
});

describe('056_trazabilidad_maestro_equipos.sql', () => {
  const SQL = fuente('../users/migrations/056_trazabilidad_maestro_equipos.sql');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios.split(';').map((s) => s.trim()).filter(Boolean);

  it('sólo añade columnas y crea con IF NOT EXISTS: sin semilla y sin nada que cambie datos en un segundo arranque', () => {
    expect(sentencias).toHaveLength(6);
    for (const s of sentencias) expect(s).toMatch(/^(ALTER TABLE portal\.tmc_equipos ADD COLUMN IF NOT EXISTS |CREATE (SCHEMA|TABLE|UNIQUE INDEX) IF NOT EXISTS )/);
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|SELECT|TRIGGER)\b/i);
    expect(sinComentarios).not.toMatch(/\bdesk\./);
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad/i);
  });

  it('las tres columnas nuevas de tmc_equipos (el origen, con sus dos valores) y un equipo de Desk 2.0 como mucho en una fila', () => {
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS desk_id\s+TEXT\s+NULL/);
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS origen\s+VARCHAR\(10\)\s+NOT NULL DEFAULT 'fst022' CHECK \(origen IN \('fst022', 'desk'\)\)/);
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS maestro_en\s+TIMESTAMPTZ\s+NULL/);
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS tmc_equipos_desk_id_uq ON portal\.tmc_equipos \(desk_id\) WHERE desk_id IS NOT NULL/);
  });

  it('está apuntada en MIGRATIONS, detrás de la 055, y es la última', () => {
    expect(fuente('../db.ts')).toMatch(/'055_trazabilidad_fst022_congelacion\.sql',\s*'056_trazabilidad_maestro_equipos\.sql'\]/);
  });
});

describe('el maestro no toca lo que no es suyo', () => {
  it('el SQL del maestro sólo escribe en tmc_equipos y en su auditoría: ni seguimiento, ni contactos, ni la congelación, ni la base de Desk 2.0', () => {
    const src = fuente('./maestro-repo.ts');
    const escrituras = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+([a-z_.0-9]+)/g)].map((m) => `${m[1].replace(/\s+/g, ' ')} ${m[2]}`);
    expect(escrituras.sort()).toEqual(['INSERT INTO portal.tmc_equipos', 'INSERT INTO portal.tmc_maestro_sincronizaciones', 'UPDATE portal.tmc_equipos']);
    // Lo único que no se toca de un equipo que ya existe: su fecha de calibración (es del lote 9c).
    expect(src).not.toMatch(/ultima_calibracion\s*=/);
  });

  it('de desk.equipos sólo se nombran las columnas concedidas al rol lector: ni `raw`, ni `*`, ni la fila entera', () => {
    const src = fuente('./maestro-desk2.ts');
    const sql = /`([^`]*FROM desk\.equipos[^`]*)`/.exec(src)![1];
    expect(sql).not.toMatch(/\*|to_jsonb|\braw\b/);
    const columnas = [...sql.matchAll(/\be\.([a-z_]+)/g)].map((m) => m[1]);
    const CONCEDIDAS = ['id', 'serial', 'marca', 'modelo', 'tipo', 'cliente_nombre', 'client_id', 'modelo_id', 'codigo_interno', 'active', 'pendiente_validar', 'source', 'created_at', 'updated_at'];
    expect(columnas.length).toBeGreaterThan(0);
    for (const c of columnas) expect(CONCEDIDAS).toContain(c);
  });

  it('ni el maestro ni su SQL mandan nada a nadie, y no hay programador: se sincroniza a mano', () => {
    for (const f of ['./maestro.ts', './maestro-desk2.ts', './maestro-repo.ts']) {
      expect(fuente(f), f).not.toMatch(/\bfetch\s*\(|n8n|webhook|nodemailer|smtp|sendMail|outbox|setInterval|setTimeout/i);
    }
  });
});
