import { describe, expect, it } from 'vitest';
import { EST, VISTAS, aplicarAjustes, type Ajustes, type Fila, type TicketFila } from './index.js';
import { ESTADOS_DESK } from './taller-columns.js';
import {
  AJUSTES_TABLERO_POR_DEFECTO, avatarDe, construirTablero, diasEnTaller, fechaBogota, horaBogota, tonoDias, validarAjustesTablero,
  type AjustesTablero, type Tablero, type Tarjeta,
} from './taller-board.js';

// Todo ficticio: seriales, clientes y técnicos inventados.
const AHORA = Date.parse('2026-11-11T20:00:00Z'); // 15:00 en Bogotá
const CFG: AjustesTablero = AJUSTES_TABLERO_POR_DEFECTO;

const tk = (st: string, o: Partial<TicketFila> = {}): TicketFila =>
  ({ n: '1001', id: '1', st, stt: 'Open', u: '', m: '', enc: 'Técnico Uno', eq: 'Equipo Z', srv: '', fs: '', cl: '', ...o });
const fila = (sn: string, st: string | null, o: Partial<Fila> = {}): Fila => ({
  id: sn, d: '2026-11-01', c: 'CLIENTE A', sn, est: EST.TALLER, src: '', why: [], x: null, z: st === null ? null : tk(st), zc: false, pa: [], xd: '', eq: 'Equipo F', ...o,
});
const todas = (t: Tablero): Tarjeta[] => t.columnas.flatMap((c) => c.tarjetas);
const colDe = (t: Tablero, sn: string): string | undefined => t.columnas.find((c) => c.tarjetas.some((x) => x.sn === sn))?.id;
const tarjeta = (f: Fila): Tarjeta => todas(construirTablero([f], CFG, AHORA))[0];

describe('membresía del tablero', () => {
  const ests = [EST.TALLER, EST.EXTERNO, EST.REVISAR, EST.CERRADO, EST.ENTREGADO, EST.RETIRADO];
  const rows = ests.map((e, i) => fila('S' + i, 'En Proceso', { est: e }));

  it('solo TALLER y EXTERNO son tarjetas', () => {
    const t = construirTablero(rows, CFG, AHORA);
    expect(todas(t).map((c) => c.sn).sort()).toEqual(['S0', 'S1']);
  });

  it('cada tarjeta está en una sola columna', () => {
    const t = construirTablero(rows, CFG, AHORA);
    const claves = todas(t).map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('un ajuste manual «in» sobre una fila CERRADO la vuelve tarjeta', () => {
    const cerrada = fila('S9', 'Finalizado', { est: EST.CERRADO });
    const aj: Ajustes = { ['S9|' + cerrada.d]: { t: 'in', m: 'sigue', at: '2026-11-02' } };
    const t = construirTablero(aplicarAjustes([cerrada], aj), CFG, AHORA);
    expect(colDe(t, 'S9')).toBe('entregar');
  });

  it('la suma de columnas = KPI «En taller» + KPI «Servicio externo»', () => {
    const cfg = { ...CFG, kpis: ['en_taller', 'externo', 'revisar', 'ticket_abierto', 'entregado'] as AjustesTablero['kpis'] };
    const t = construirTablero(rows.concat(fila('S7', null), fila('S8', 'Servicio externo', { est: EST.EXTERNO })), cfg, AHORA);
    const k = (id: string) => t.kpis.find((x) => x.id === id)!.valor;
    expect(t.columnas.reduce((s, c) => s + c.tarjetas.length, 0)).toBe(k('en_taller') + k('externo'));
  });

  it('una columna sin filas existe con 0 tarjetas', () => {
    const t = construirTablero([fila('S1', 'En Proceso')], CFG, AHORA);
    expect(t.columnas.map((c) => c.id)).toEqual(['entrada', 'diagnostico', 'notificacion', 'proceso', 'externo', 'entregar']);
    expect(t.columnas.find((c) => c.id === 'externo')!.tarjetas).toEqual([]);
    expect(t.columnas.find((c) => c.id === 'externo')!.nombre).toBe('Servicio externo');
  });
});

describe('estado → columna en el tablero', () => {
  it('cubre los 26 estados del registro sobre filas de taller', () => {
    for (const st of ESTADOS_DESK) {
      const t = construirTablero([fila('X1', st)], CFG, AHORA);
      expect(todas(t), st).toHaveLength(1);
      expect(t.columnas.find((c) => c.tarjetas.length)!.id, st).not.toBeUndefined();
    }
  });

  it('EXTERNO gana sobre el estado de Desk', () => {
    expect(colDe(construirTablero([fila('E1', 'En Proceso', { est: EST.EXTERNO })], CFG, AHORA), 'E1')).toBe('externo');
  });

  it('sin ticket va a la columna 1', () => {
    expect(colDe(construirTablero([fila('N1', null)], CFG, AHORA), 'N1')).toBe('entrada');
  });

  it('un estado desconocido va a la columna 2, con su nombre como etiqueta y sin lanzar', () => {
    const t = construirTablero([fila('U1', 'Estado Inventado')], CFG, AHORA);
    expect(colDe(t, 'U1')).toBe('diagnostico');
    expect(todas(t)[0].etiquetas).toEqual([{ tipo: 'estado_desconocido', texto: 'Estado Inventado' }]);
  });

  it('los estados cerrados de una fila de taller van a «Por entregar»', () => {
    for (const st of ['Finalizado', 'Anulado', 'Pendiente de facturar', 'Pendiente', 'Solicitud Soporte']) {
      expect(colDe(construirTablero([fila('C1', st)], CFG, AHORA), 'C1'), st).toBe('entregar');
    }
  });
});

describe('etiquetas', () => {
  const tipos = (f: Fila) => tarjeta(f).etiquetas.map((e) => e.texto);

  it('«Sin ticket» solo cuando no hay ticket', () => {
    expect(tipos(fila('A1', null))).toEqual(['Sin ticket']);
    expect(tipos(fila('A1', 'En Proceso'))).toEqual([]);
  });

  it('«Espera repuestos» en los tres estados de espera', () => {
    for (const st of ['En Espera de Repuestos', 'Solicitado', 'En espera de SKU inventario']) expect(tipos(fila('A1', st)), st).toEqual(['Espera repuestos']);
  });

  it('«Ticket cerrado» solo en los cerrados de taller, no en «Por Entregar» abierto', () => {
    for (const st of ['Finalizado', 'Anulado', 'Pendiente de facturar', 'Pendiente', 'Solicitud Soporte']) expect(tipos(fila('A1', st)), st).toEqual(['Ticket cerrado']);
    expect(tipos(fila('A1', 'Por Entregar'))).toEqual([]);
    expect(tipos(fila('A1', 'Finalizado', { est: EST.EXTERNO }))).toEqual([]);
  });

  it('«Falta remisión firmada» si src es «esperando recogida», en cualquier columna', () => {
    expect(tipos(fila('A1', 'En Proceso', { src: 'esperando recogida' }))).toEqual(['Falta remisión firmada']);
    expect(tipos(fila('A1', null, { src: 'esperando recogida' }))).toEqual(['Sin ticket', 'Falta remisión firmada']);
    expect(tipos(fila('A1', 'Finalizado', { src: 'esperando recogida' }))).toEqual(['Ticket cerrado', 'Falta remisión firmada']);
  });

  it('ninguna otra etiqueta aparece para los estados normales', () => {
    for (const st of ESTADOS_DESK.filter((s) => !['En Espera de Repuestos', 'Solicitado', 'En espera de SKU inventario', 'Finalizado', 'Anulado', 'Pendiente de facturar', 'Pendiente', 'Solicitud Soporte'].includes(s))) {
      expect(tipos(fila('A1', st)), st).toEqual([]);
    }
  });
});

describe('contenido de la tarjeta', () => {
  it('el equipo sale de z.eq y, si está vacío, de eq', () => {
    expect(tarjeta(fila('A1', 'En Proceso', { z: tk('En Proceso', { eq: 'Analizador X' }) })).equipo).toBe('Analizador X');
    expect(tarjeta(fila('A1', 'En Proceso', { z: tk('En Proceso', { eq: '' }), eq: 'Analizador X' })).equipo).toBe('Analizador X');
    expect(tarjeta(fila('A1', null, { eq: 'Analizador Y' })).equipo).toBe('Analizador Y');
  });

  it('serial, cliente completo, ticket y fecha de entrada', () => {
    const t = tarjeta(fila('18A90417', 'En Proceso', { c: 'CLIENTE A S.A.S.', z: tk('En Proceso', { n: '2002' }) }));
    expect([t.sn, t.cliente, t.ticket, t.entrada]).toEqual(['18A90417', 'CLIENTE A S.A.S.', '2002', '2026-11-01']);
    expect(tarjeta(fila('A1', null)).ticket).toBeNull();
  });

  it('pie: técnico, sin asignar o neutro', () => {
    const conTec = tarjeta(fila('A1', 'En Proceso'));
    expect(conTec.pie).toBe('tecnico');
    expect(conTec.tecnico).toEqual({ nombre: 'Técnico Uno', iniciales: 'TU', avatar: 2 });
    const sin = tarjeta(fila('A1', 'En Proceso', { z: tk('En Proceso', { enc: '' }) }));
    expect([sin.pie, sin.tecnico]).toEqual(['sin_asignar', null]);
    const neutro = tarjeta(fila('A1', null));
    expect([neutro.pie, neutro.tecnico]).toEqual(['neutro', null]);
  });

  it('avatar: FNV-1a de nkey(nombre) mod 6, determinista y sin importar tildes ni mayúsculas', () => {
    expect(avatarDe('Técnico Uno')).toBe(2);
    expect(avatarDe('TECNICO   uno')).toBe(2);
    expect(avatarDe('Técnico Tres')).toBe(0);
    for (const n of ['Ana', 'Beto', 'Carla', 'Dario']) expect(avatarDe(n)).toBeGreaterThanOrEqual(0), expect(avatarDe(n)).toBeLessThan(6);
  });

  it('iniciales de una sola palabra y con espacios', () => {
    const i = (enc: string) => tarjeta(fila('A1', 'En Proceso', { z: tk('En Proceso', { enc }) })).tecnico?.iniciales;
    expect(i('  ana  maria  lopez ')).toBe('AM');
    expect(i('ana')).toBe('A');
  });
});

describe('días y semáforo', () => {
  it('fechaBogota / horaBogota usan UTC-5', () => {
    const ms = Date.parse('2026-11-12T03:30:00Z');
    expect(fechaBogota(ms)).toBe('2026-11-11');
    expect(horaBogota(ms)).toBe(22);
    expect(horaBogota(Date.parse('2026-11-12T05:00:00Z'))).toBe(0);
    expect(fechaBogota(Date.parse('2026-11-12T05:00:00Z'))).toBe('2026-11-12');
  });

  it('la medianoche de Bogotá, no la de UTC, cambia el día', () => {
    expect(diasEnTaller('2026-11-10', Date.parse('2026-11-12T03:30:00Z'))).toBe(1);
    expect(diasEnTaller('2026-11-10', Date.parse('2026-11-12T05:00:00Z'))).toBe(2);
  });

  it('usa el reloj, no la fecha de la foto', () => {
    const f = fila('A1', 'En Proceso', { d: '2026-11-01' });
    expect(tarjeta(f).dias).toBe(10);
  });

  it('una entrada futura o ilegible da 0', () => {
    expect(diasEnTaller('2026-12-01', AHORA)).toBe(0);
    expect(diasEnTaller('', AHORA)).toBe(0);
    expect(diasEnTaller('no es fecha', AHORA)).toBe(0);
  });

  it('bordes 29/30/90/91 → verde/ámbar/ámbar/rojo', () => {
    expect([29, 30, 90, 91].map((d) => tonoDias(d, CFG))).toEqual(['verde', 'ambar', 'ambar', 'rojo']);
  });

  it('umbrales a medida 10/20', () => {
    const cfg = { ...CFG, umbralAmbar: 10, umbralRojo: 20 };
    expect([9, 10, 20, 21].map((d) => tonoDias(d, cfg))).toEqual(['verde', 'ambar', 'ambar', 'rojo']);
  });

  it('la tarjeta lleva el tono calculado con los umbrales', () => {
    const f = fila('A1', 'En Proceso', { d: '2026-08-01' }); // 102 días
    expect(tarjeta(f)).toMatchObject({ dias: 102, tono: 'rojo' });
  });
});

describe('orden', () => {
  it('días de mayor a menor', () => {
    const t = construirTablero(['2026-11-06', '2026-08-10', '2026-10-02'].map((d, i) => fila('S' + i, 'En Proceso', { d })), CFG, AHORA);
    expect(todas(t).map((c) => c.dias)).toEqual([93, 40, 5]);
  });

  it('el empate se resuelve por serial ascendente, igual en cada construcción y sin importar el orden de entrada', () => {
    const a = fila('A1', 'En Proceso');
    const b = fila('B1', 'En Proceso');
    expect(todas(construirTablero([b, a], CFG, AHORA)).map((c) => c.sn)).toEqual(['A1', 'B1']);
    expect(todas(construirTablero([a, b], CFG, AHORA)).map((c) => c.sn)).toEqual(['A1', 'B1']);
  });
});

describe('KPIs', () => {
  const rows: Fila[] = [
    fila('K1', 'En Proceso'), fila('K2', 'Servicio externo', { est: EST.EXTERNO }), fila('K3', null, { est: EST.REVISAR }),
    fila('K4', 'Finalizado', { est: EST.CERRADO }), fila('K5', 'Por Facturar', { est: EST.ENTREGADO, xd: '2026-11-05' }),
    fila('K6', 'En Proceso', { est: EST.ENTREGADO, zc: true }), fila('K7', 'En Proceso', { est: EST.RETIRADO }),
    fila('K8', 'En Proceso', { pa: [{ d: '2026-11-03', n: 'x', id: 'i', q: '', k: '' }] }),
  ];
  const todosLosKpis = ['en_taller', 'externo', 'revisar', 'ticket_cerrado', 'ticket_abierto', 'parciales', 'entregado', 'retirado'] as const;
  const nombre: Record<string, string> = {
    en_taller: EST.TALLER, externo: EST.EXTERNO, revisar: EST.REVISAR, ticket_cerrado: EST.CERRADO,
    ticket_abierto: 'Salió con ticket abierto', parciales: 'Salidas parciales', entregado: EST.ENTREGADO, retirado: EST.RETIRADO,
  };

  it('cada KPI es el conteo de su VISTAS sobre las filas ajustadas sin filtrar', () => {
    for (const id of todosLosKpis) {
      const cfg = { ...CFG, kpis: [id, ...todosLosKpis.filter((x) => x !== id).slice(0, 4)] as AjustesTablero['kpis'] };
      const kpi = construirTablero(rows, cfg, AHORA).kpis.find((k) => k.id === id)!;
      const esperado = rows.filter(VISTAS.find((v) => v.nombre === nombre[id])!.filtro).length;
      expect(kpi.valor, id).toBe(esperado);
    }
  });

  it('respeta el orden y la elección de la configuración, con las etiquetas de TV', () => {
    const t = construirTablero(rows, CFG, AHORA);
    expect(t.kpis.map((k) => k.id)).toEqual(['en_taller', 'revisar', 'ticket_abierto', 'externo', 'entregado']);
    expect(t.kpis.map((k) => k.etiqueta)).toEqual(['En taller', 'Por revisar', 'Salió con ticket abierto', 'Servicio externo', 'Entregados']);
  });

  it('tonos como en el PDF: Por revisar ámbar, Salió con ticket abierto rojo, Entregados verde; a 0, neutro', () => {
    const conDatos = [
      fila('K1', 'En Proceso', { est: EST.REVISAR }),
      fila('K2', 'Por Facturar', { est: EST.ENTREGADO }),
      fila('K3', 'En Proceso'),
    ];
    const tono = (filas: Fila[]) => Object.fromEntries(construirTablero(filas, CFG, AHORA).kpis.map((k) => [k.id, k.tono]));
    expect(tono(conDatos)).toEqual({ en_taller: 'neutro', revisar: 'ambar', ticket_abierto: 'rojo', externo: 'neutro', entregado: 'verde' });
    expect(tono([])).toMatchObject({ revisar: 'neutro', ticket_abierto: 'neutro' });
  });

  it('un ajuste «ret» cuenta como Retirado y no como En taller', () => {
    const f = fila('R1', 'En Proceso');
    const ajustada = aplicarAjustes([f], { ['R1|' + f.d]: { t: 'ret', m: 'devuelto', at: '2026-11-02' } });
    const cfg = { ...CFG, kpis: ['en_taller', 'retirado', 'externo', 'revisar', 'entregado'] as AjustesTablero['kpis'] };
    const t = construirTablero(ajustada, cfg, AHORA);
    expect([t.kpis[0].valor, t.kpis[1].valor]).toEqual([0, 1]);
    expect(todas(t)).toEqual([]);
  });
});

describe('exportación por el índice del núcleo', () => {
  it('el índice expone el modelo con sus nombres únicos y deja intacto lo existente', async () => {
    const n = await import('./index.js');
    for (const nombre of ['construirTablero', 'diasEnTaller', 'COLUMNAS_TALLER', 'ESTADOS_DESK', 'claveEstado', 'fechaBogota', 'horaBogota', 'tonoDias', 'validarAjustesTablero', 'AJUSTES_TABLERO_POR_DEFECTO']) {
      expect(n, nombre).toHaveProperty(nombre);
    }
    expect(n.dias('2026-11-01', '2026-11-11')).toBe(10); // `pantalla.dias` sigue igual
    expect(n.VISTAS).toHaveLength(8);
  });
});

describe('ajustes del tablero', () => {
  it('valores por defecto', () => {
    expect(AJUSTES_TABLERO_POR_DEFECTO).toEqual({
      umbralAmbar: 30, umbralRojo: 90, nocheDesde: 18, nocheHasta: 6,
      kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo', 'entregado'],
    });
  });

  it('acepta los valores por defecto y los devuelve iguales', () => {
    expect(validarAjustesTablero(AJUSTES_TABLERO_POR_DEFECTO)).toEqual(AJUSTES_TABLERO_POR_DEFECTO);
  });

  const malo = (o: Record<string, unknown>) => validarAjustesTablero({ ...AJUSTES_TABLERO_POR_DEFECTO, ...o });
  it.each([
    ['ámbar cero', { umbralAmbar: 0 }],
    ['ámbar negativo', { umbralAmbar: -1 }],
    ['ámbar decimal', { umbralAmbar: 1.5 }],
    ['ámbar texto', { umbralAmbar: '30' }],
    ['rojo igual al ámbar', { umbralRojo: 30 }],
    ['rojo menor al ámbar', { umbralRojo: 10 }],
    ['rojo decimal', { umbralRojo: 90.5 }],
    ['hora desde 24', { nocheDesde: 24 }],
    ['hora hasta -1', { nocheHasta: -1 }],
    ['hora decimal', { nocheDesde: 18.5 }],
    ['4 KPIs', { kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo'] }],
    ['6 KPIs', { kpis: [...AJUSTES_TABLERO_POR_DEFECTO.kpis, 'retirado'] }],
    ['KPI repetido', { kpis: ['en_taller', 'en_taller', 'ticket_abierto', 'externo', 'entregado'] }],
    ['KPI desconocido', { kpis: ['en_taller', 'revisar', 'ticket_abierto', 'externo', 'inventado'] }],
    ['KPI no es lista', { kpis: 'en_taller' }],
  ])('rechaza: %s', (_n, o) => expect(malo(o)).toBeNull());

  it('rechaza lo que no es objeto', () => {
    for (const x of [null, undefined, 3, 'x', []]) expect(validarAjustesTablero(x)).toBeNull();
  });

  it('acepta horas límite 0 y 23 y otra selección válida de 5 KPIs', () => {
    const ok = { umbralAmbar: 1, umbralRojo: 2, nocheDesde: 0, nocheHasta: 23, kpis: ['retirado', 'parciales', 'ticket_cerrado', 'externo', 'en_taller'] };
    expect(validarAjustesTablero(ok)).toEqual(ok);
  });

  it('descarta campos extra', () => {
    expect(validarAjustesTablero({ ...AJUSTES_TABLERO_POR_DEFECTO, extra: 1 })).toEqual(AJUSTES_TABLERO_POR_DEFECTO);
  });
});
