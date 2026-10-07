import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTACTO_MAX_EMAILS, ROLES_ESTADO, TIPOS_COMPUESTOS, claveTipoServicio, type RolEstado } from './dominio.js';
import { ROLES_APP } from './roles.js';
import { calcularPlazo, calcularReloj, calcularTramos, diasHabilesEntre, festivosDelEje, sumarDiasHabiles, type DatosReloj, type IntervaloEstado } from './plazos.js';

// Calendario de referencia (octubre de 2026): el lunes 5 es hábil, el lunes 12
// es festivo (Día de la Raza) y el 1 de enero de 2027 cae en viernes.

describe('sumarDiasHabiles', () => {
  it('el día de ingreso no cuenta: lunes + 3 → jueves', () => {
    expect(sumarDiasHabiles('2026-10-05', 3)).toBe('2026-10-08');
  });

  it('salta el fin de semana', () => {
    expect(sumarDiasHabiles('2026-10-01', 3)).toBe('2026-10-06'); // jue → vie 2, lun 5, mar 6
    expect(sumarDiasHabiles('2026-10-03', 1)).toBe('2026-10-05'); // ingreso en sábado
  });

  it('salta los festivos de Colombia', () => {
    // jue 8 → vie 9, (sáb, dom, lun 12 festivo), mar 13, mié 14
    expect(sumarDiasHabiles('2026-10-08', 3)).toBe('2026-10-14');
    // jue 31-dic → vie 1-ene festivo → lun 4-ene
    expect(sumarDiasHabiles('2026-12-31', 1)).toBe('2027-01-04');
  });
});

describe('diasHabilesEntre', () => {
  it('cuenta hacia delante sin el día de partida y con el de llegada', () => {
    expect(diasHabilesEntre('2026-10-06', '2026-10-06')).toBe(0);
    expect(diasHabilesEntre('2026-10-06', '2026-10-08')).toBe(2);
    expect(diasHabilesEntre('2026-10-09', '2026-10-14')).toBe(2); // fin de semana + festivo
  });

  it('hacia atrás es negativo, y un fin de semana no suma atraso', () => {
    expect(diasHabilesEntre('2026-10-06', '2026-10-02')).toBe(-2);
    expect(diasHabilesEntre('2026-10-03', '2026-10-02')).toBe(0);
  });

  it('aguanta un atraso de años (el contador de Ausencias corta en 366 días)', () => {
    const d = diasHabilesEntre('2026-10-06', '2024-01-02');
    expect(d).toBeLessThan(-650);
    expect(d).toBeGreaterThan(-720);
  });
});

describe('calcularPlazo', () => {
  const hoy = '2026-10-06';

  it('dentro del plazo', () => {
    expect(calcularPlazo('2026-10-05', 3, hoy)).toEqual({ fechaLimite: '2026-10-08', diasHabiles: 2, estadoPlazo: 'EN_PLAZO' });
  });

  it('vence hoy', () => {
    expect(calcularPlazo('2026-10-01', 3, hoy)).toEqual({ fechaLimite: '2026-10-06', diasHabiles: 0, estadoPlazo: 'VENCE_HOY' });
  });

  it('vencido: días hábiles de atraso en negativo', () => {
    expect(calcularPlazo('2026-09-28', 4, hoy)).toEqual({ fechaLimite: '2026-10-02', diasHabiles: -2, estadoPlazo: 'VENCIDO' });
  });

  it('sin plazo configurado, sin ingreso o con una fecha imposible → SIN_PLAZO', () => {
    const sin = { fechaLimite: null, diasHabiles: null, estadoPlazo: 'SIN_PLAZO' };
    expect(calcularPlazo('2026-10-05', null, hoy)).toEqual(sin);
    expect(calcularPlazo(null, 3, hoy)).toEqual(sin);
    expect(calcularPlazo('2026-02-30', 3, hoy)).toEqual(sin);
  });
});

describe('calcularTramos (tipo compuesto: un tramo por parte, uno detrás de otro)', () => {
  const partes = (diag: number | null, cal: number | null) => [
    { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: diag },
    { clave: 'calibracion', etiqueta: 'Calibración', dias: cal },
  ];

  it('cada tramo acaba donde le toca y el último coincide con la fecha límite', () => {
    // lun 5 + 3 → jue 8; + 4 → vie 9, (sáb, dom, lun 12 festivo), mar 13, mié 14, jue 15
    expect(calcularTramos('2026-10-05', partes(3, 4))).toEqual([
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-10-08' },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4, hasta: '2026-10-15' },
    ]);
    expect(sumarDiasHabiles('2026-10-05', 7)).toBe('2026-10-15');
  });

  it('la fecha intermedia cruza el fin de semana', () => {
    // jue 1 + 3 → vie 2, (sáb, dom), lun 5, mar 6; + 4 → mié 7, jue 8, vie 9, (lun 12 festivo), mar 13
    const t = calcularTramos('2026-10-01', partes(3, 4))!;
    expect(t.map((x) => x.hasta)).toEqual(['2026-10-06', '2026-10-13']);
    expect(t[1].hasta).toBe(calcularPlazo('2026-10-01', 7, '2026-10-06').fechaLimite);
  });

  it('un ingreso en fin de semana empieza a contar el lunes', () => {
    expect(calcularTramos('2026-10-03', partes(1, 1))!.map((x) => x.hasta)).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('sin ingreso, con una fecha imposible o con una parte sin plazo no hay tramos', () => {
    expect(calcularTramos(null, partes(3, 4))).toBeNull();
    expect(calcularTramos('2026-02-30', partes(3, 4))).toBeNull();
    expect(calcularTramos('2026-10-05', partes(3, null))).toBeNull();
    expect(calcularTramos('2026-10-05', partes(null, 4))).toBeNull();
    expect(calcularTramos('2026-10-05', [])).toBeNull();
  });
});

// El reloj con pausas. Calendario: lun 5, mar 6, mié 7, jue 8, vie 9 de octubre
// de 2026; el lunes 12 es festivo; mar 13, mié 14, jue 15, vie 16.
describe('calcularReloj (standby para el reloj; «trabajo terminado» lo detiene)', () => {
  /** Un instante en hora de Bogotá: t('2026-10-06 10:00'). */
  const t = (s: string): number => Date.parse(`${s.replace(' ', 'T')}:00-05:00`);
  const ROLES: Record<string, RolEstado> = { 'notificacion cliente': 'standby', 'servicio externo': 'standby', 'por facturar': 'terminado', 'por entregar': 'terminado' };
  const rolDe = (clave: string): RolEstado => ROLES[clave] ?? 'cuenta';
  /** Tramos encadenados: cada uno acaba donde empieza el siguiente y el último queda abierto. El primero es la primera observación. */
  const historia = (...pasos: [clave: string, desde: string][]): IntervaloEstado[] =>
    pasos.map(([clave, desde], i) => ({ clave, desde: t(desde), hasta: i + 1 < pasos.length ? t(pasos[i + 1][1]) : null, desdeReal: i > 0 }));
  const reloj = (d: Partial<DatosReloj> & { hoy: string }) => {
    const intervalos = d.intervalos ?? [];
    const abierto = intervalos.find((i) => i.hasta === null);
    const rol = d.rolDe ?? rolDe;
    return calcularReloj({ ingreso: '2026-10-05', dias: 3, partes: null, intervalos, rolActual: abierto ? rol(abierto.clave) : 'cuenta', rolDe, ...d });
  };
  // En proceso desde el lunes; standby del martes a las 10:00 al jueves a las 09:00; después, otra vez en proceso.
  const PAUSA_EN_MEDIO = historia(['en proceso', '2026-10-05 12:00'], ['notificacion cliente', '2026-10-06 10:00'], ['en proceso', '2026-10-08 09:00']);

  it('sin historial y sin rol es el plazo de siempre', () => {
    for (const hoy of ['2026-10-06', '2026-10-08', '2026-10-10', '2026-10-14']) {
      const r = reloj({ hoy });
      expect(r).toMatchObject(calcularPlazo('2026-10-05', 3, hoy));
      expect(r).toMatchObject({ fechaLimiteBase: '2026-10-08', tramos: null, rolEstado: 'cuenta', enPausa: false, diasPausados: 0, pausas: [], terminadoEl: null, medidoDesde: null });
    }
  });

  it('una pausa en medio corre la fecha límite exactamente los días hábiles en pausa', () => {
    // Martes y miércoles acaban en standby: no cuentan. Activos: jue 8, vie 9 y (lun 12 festivo) mar 13.
    expect(reloj({ hoy: '2026-10-09', intervalos: PAUSA_EN_MEDIO })).toEqual({
      fechaLimite: '2026-10-13',
      fechaLimiteBase: '2026-10-08',
      diasHabiles: 1,
      estadoPlazo: 'EN_PLAZO',
      tramos: null,
      rolEstado: 'cuenta',
      enPausa: false,
      diasPausados: 2,
      pausas: [{ desde: '2026-10-06', hasta: '2026-10-07' }],
      terminadoEl: null,
      medidoDesde: '2026-10-05',
    });
    expect(sumarDiasHabiles('2026-10-08', 2)).toBe('2026-10-13');
  });

  it('una pausa que cruza fin de semana y festivo sólo cuenta los días hábiles', () => {
    // Standby del viernes 9 al miércoles 14 por la mañana: de sus cinco noches, sólo vie 9 y mar 13 son hábiles.
    const r = reloj({
      ingreso: '2026-10-08',
      hoy: '2026-10-14',
      intervalos: historia(['en proceso', '2026-10-08 12:00'], ['servicio externo', '2026-10-09 08:00'], ['en proceso', '2026-10-14 08:00']),
    });
    expect(r).toMatchObject({ fechaLimiteBase: '2026-10-14', fechaLimite: '2026-10-16', diasPausados: 2, diasHabiles: 2, estadoPlazo: 'EN_PLAZO' });
    // Un solo rango: entre los dos días en pausa no hay ningún día hábil activo.
    expect(r.pausas).toEqual([{ desde: '2026-10-09', hasta: '2026-10-13' }]);
  });

  it('una pausa que empieza y acaba el mismo día no pausa ese día', () => {
    const r = reloj({ hoy: '2026-10-07', intervalos: historia(['en proceso', '2026-10-05 12:00'], ['notificacion cliente', '2026-10-06 09:00'], ['en proceso', '2026-10-06 16:00']) });
    expect(r).toMatchObject({ ...calcularPlazo('2026-10-05', 3, '2026-10-07'), fechaLimiteBase: '2026-10-08', diasPausados: 0, pausas: [], enPausa: false });
  });

  it('un ticket que está ahora en standby: hoy no cuenta y la fecha proyectada se corre un día hábil cada día hábil', () => {
    const enStandby = historia(['en proceso', '2026-10-05 12:00'], ['notificacion cliente', '2026-10-06 10:00']);
    expect(reloj({ hoy: '2026-10-06', intervalos: enStandby })).toMatchObject({
      rolEstado: 'standby',
      enPausa: true,
      diasPausados: 1,
      pausas: [{ desde: '2026-10-06', hasta: '2026-10-06' }],
      fechaLimite: '2026-10-09',
      diasHabiles: 3,
      estadoPlazo: 'EN_PLAZO',
    });
    expect(reloj({ hoy: '2026-10-07', intervalos: enStandby })).toMatchObject({ enPausa: true, diasPausados: 2, fechaLimite: '2026-10-13', diasHabiles: 3 });
    expect(reloj({ hoy: '2026-10-08', intervalos: enStandby })).toMatchObject({ enPausa: true, diasPausados: 3, fechaLimite: '2026-10-14', diasHabiles: 3 });
    // El fin de semana no añade pausa: la fecha no se mueve del viernes al sábado.
    expect(reloj({ hoy: '2026-10-09', intervalos: enStandby })).toMatchObject({ diasPausados: 4, fechaLimite: '2026-10-15' });
    expect(reloj({ hoy: '2026-10-10', intervalos: enStandby })).toMatchObject({ diasPausados: 4, fechaLimite: '2026-10-15', pausas: [{ desde: '2026-10-06', hasta: '2026-10-09' }] });
  });

  it('el día de hoy lo decide el estado de ahora, no cómo acabará el día', () => {
    // Salió de standby esta mañana: hoy ya cuenta, aunque el tramo de standby tocara el día.
    const r = reloj({ hoy: '2026-10-08', intervalos: PAUSA_EN_MEDIO });
    expect(r).toMatchObject({ enPausa: false, diasPausados: 2, pausas: [{ desde: '2026-10-06', hasta: '2026-10-07' }], fechaLimite: '2026-10-13' });
  });

  it('dos pausas separadas suman, cada una con su rango', () => {
    const r = reloj({
      hoy: '2026-10-13',
      intervalos: historia(
        ['en proceso', '2026-10-05 12:00'],
        ['notificacion cliente', '2026-10-06 10:00'],
        ['en proceso', '2026-10-07 08:00'],
        ['servicio externo', '2026-10-08 10:00'],
        ['en proceso', '2026-10-09 09:00'],
      ),
    });
    // Activos: mié 7, vie 9 y mar 13.
    expect(r).toMatchObject({ fechaLimite: '2026-10-13', estadoPlazo: 'VENCE_HOY', diasHabiles: 0, diasPausados: 2 });
    expect(r.pausas).toEqual([
      { desde: '2026-10-06', hasta: '2026-10-06' },
      { desde: '2026-10-08', hasta: '2026-10-08' },
    ]);
  });

  it('lo anterior a la primera observación cuenta como activo, aunque el ticket ya estuviera en standby', () => {
    // Ingresó el lunes 28 de septiembre; el portal lo vio por primera vez, ya en standby, el martes 6.
    const r = reloj({
      ingreso: '2026-09-28',
      dias: 4,
      hoy: '2026-10-07',
      intervalos: [{ clave: 'notificacion cliente', desde: t('2026-10-06 10:00'), hasta: null, desdeReal: false }],
    });
    expect(r).toMatchObject({ fechaLimiteBase: '2026-10-02', fechaLimite: '2026-10-02', estadoPlazo: 'VENCIDO', enPausa: true, medidoDesde: '2026-10-06' });
    // El atraso tampoco cuenta los días en pausa: sólo el lunes 5.
    expect(r).toMatchObject({ diasHabiles: -1, diasPausados: 2, pausas: [{ desde: '2026-10-06', hasta: '2026-10-07' }] });
  });

  it('tipo compuesto: los tramos siguen el mismo paso y la fecha intermedia también se corre', () => {
    const partes = [
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3 },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4 },
    ];
    const r = reloj({
      dias: 7,
      partes,
      hoy: '2026-10-08',
      intervalos: historia(['en proceso', '2026-10-05 12:00'], ['notificacion cliente', '2026-10-06 10:00'], ['en proceso', '2026-10-07 08:00']),
    });
    // Martes en pausa. Diagnóstico: mié 7, jue 8, vie 9. Calibración: mar 13, mié 14, jue 15, vie 16.
    expect(r.tramos).toEqual([
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-10-09' },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4, hasta: '2026-10-16' },
    ]);
    expect(r).toMatchObject({ fechaLimite: '2026-10-16', fechaLimiteBase: '2026-10-15', diasPausados: 1 });
    // Sin pausas son los tramos de siempre.
    expect(reloj({ dias: 7, partes, hoy: '2026-10-08' }).tramos).toEqual(calcularTramos('2026-10-05', partes));
    // Si a una parte le falta el plazo no hay tramos (ni plazo: `dias` llega null).
    expect(reloj({ dias: null, partes: [partes[0], { ...partes[1], dias: null }], hoy: '2026-10-08' })).toMatchObject({ tramos: null, estadoPlazo: 'SIN_PLAZO' });
  });

  describe('trabajo terminado', () => {
    it('a tiempo → CUMPLIDO, con el reloj parado el día en que llegó a ese estado', () => {
      const h = historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-07 15:00']);
      const esperado = { rolEstado: 'terminado', enPausa: false, terminadoEl: '2026-10-07', fechaLimite: '2026-10-08', fechaLimiteBase: '2026-10-08', estadoPlazo: 'CUMPLIDO', diasHabiles: 1, diasPausados: 0, pausas: [] };
      expect(reloj({ hoy: '2026-10-07', intervalos: h })).toMatchObject(esperado);
      // Pasan los días y nada se mueve: ni se vence ni acumula pausa.
      expect(reloj({ hoy: '2026-10-09', intervalos: h })).toMatchObject(esperado);
      expect(reloj({ hoy: '2026-11-20', intervalos: h })).toMatchObject(esperado);
    });

    it('el mismo día de la fecha límite todavía cumple', () => {
      expect(reloj({ hoy: '2026-10-09', intervalos: historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-08 17:30']) })).toMatchObject({
        estadoPlazo: 'CUMPLIDO',
        terminadoEl: '2026-10-08',
        diasHabiles: 0,
      });
    });

    it('tarde → INCUMPLIDO, con los días hábiles de atraso congelados', () => {
      const h = historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-13 10:00']);
      // Límite el jueves 8; llegó el martes 13: vie 9 y mar 13 (el lunes 12 es festivo).
      const esperado = { estadoPlazo: 'INCUMPLIDO', terminadoEl: '2026-10-13', fechaLimite: '2026-10-08', diasHabiles: -2 };
      expect(reloj({ hoy: '2026-10-13', intervalos: h })).toMatchObject(esperado);
      expect(reloj({ hoy: '2026-10-30', intervalos: h })).toMatchObject(esperado);
    });

    it('las pausas anteriores cuentan para el veredicto', () => {
      // Sin la pausa del martes habría vencido el jueves 8; con ella, el viernes 9.
      const h = historia(['en proceso', '2026-10-05 12:00'], ['notificacion cliente', '2026-10-06 10:00'], ['en proceso', '2026-10-07 08:00'], ['por entregar', '2026-10-09 11:00']);
      expect(reloj({ hoy: '2026-10-14', intervalos: h })).toMatchObject({
        estadoPlazo: 'CUMPLIDO',
        terminadoEl: '2026-10-09',
        fechaLimiteBase: '2026-10-08',
        fechaLimite: '2026-10-09',
        diasPausados: 1,
        pausas: [{ desde: '2026-10-06', hasta: '2026-10-06' }],
      });
    });

    it('si el portal lo vio por primera vez ya terminado, no se puede medir → TERMINADO', () => {
      const r = reloj({ hoy: '2026-10-09', intervalos: [{ clave: 'por facturar', desde: t('2026-10-06 10:00'), hasta: null, desdeReal: false }] });
      expect(r).toMatchObject({ estadoPlazo: 'TERMINADO', rolEstado: 'terminado', terminadoEl: '2026-10-06', fechaLimite: '2026-10-08', medidoDesde: '2026-10-06' });
    });

    it('sin tramo abierto en el historial (aún no se ha registrado) tampoco se puede medir: terminado hoy', () => {
      expect(reloj({ hoy: '2026-10-09', rolActual: 'terminado' })).toMatchObject({ estadoPlazo: 'TERMINADO', terminadoEl: '2026-10-09', medidoDesde: null });
      // Ni con un historial que todavía dice otra cosa.
      const atrasado = historia(['en proceso', '2026-10-05 12:00']);
      expect(reloj({ hoy: '2026-10-09', rolActual: 'terminado', intervalos: atrasado })).toMatchObject({ estadoPlazo: 'TERMINADO', terminadoEl: '2026-10-09' });
    });

    it('varios estados terminados seguidos son una sola racha: manda el primero', () => {
      const h = historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-07 15:00'], ['por entregar', '2026-10-13 09:00']);
      expect(reloj({ hoy: '2026-10-14', intervalos: h })).toMatchObject({ estadoPlazo: 'CUMPLIDO', terminadoEl: '2026-10-07' });
      // Si la racha empieza en la primera observación, no hay veredicto aunque el último cambio sí se viera.
      const sinInicio: IntervaloEstado[] = [
        { clave: 'por facturar', desde: t('2026-10-06 10:00'), hasta: t('2026-10-07 09:00'), desdeReal: false },
        { clave: 'por entregar', desde: t('2026-10-07 09:00'), hasta: null, desdeReal: true },
      ];
      expect(reloj({ hoy: '2026-10-09', intervalos: sinInicio })).toMatchObject({ estadoPlazo: 'TERMINADO', terminadoEl: '2026-10-06' });
    });

    it('una racha anterior, interrumpida por un estado que cuenta, no es la de ahora', () => {
      const h = historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-06 10:00'], ['en proceso', '2026-10-07 09:00'], ['por facturar', '2026-10-13 10:00']);
      // El martes 6 acabó en «terminado»: en pausa. Activos: mié 7, jue 8, vie 9 → límite el viernes 9; llegó el martes 13.
      expect(reloj({ hoy: '2026-10-14', intervalos: h })).toMatchObject({ estadoPlazo: 'INCUMPLIDO', terminadoEl: '2026-10-13', fechaLimite: '2026-10-09', diasPausados: 1, diasHabiles: -1 });
    });

    it('si sale de «terminado» a un estado que cuenta, el reloj sigue y esos días quedan en pausa', () => {
      const h = historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-06 10:00'], ['en proceso', '2026-10-08 09:00']);
      expect(reloj({ hoy: '2026-10-09', intervalos: h })).toMatchObject({
        rolEstado: 'cuenta',
        terminadoEl: null,
        estadoPlazo: 'EN_PLAZO',
        fechaLimite: '2026-10-13',
        diasPausados: 2,
        pausas: [{ desde: '2026-10-06', hasta: '2026-10-07' }],
      });
    });

    it('tipo compuesto terminado: los tramos se calculan a la fecha en que se paró', () => {
      const partes = [
        { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3 },
        { clave: 'calibracion', etiqueta: 'Calibración', dias: 4 },
      ];
      const r = reloj({ dias: 7, partes, hoy: '2026-10-20', intervalos: historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-14 10:00']) });
      expect(r.tramos!.map((x) => x.hasta)).toEqual(['2026-10-08', '2026-10-15']);
      expect(r).toMatchObject({ estadoPlazo: 'CUMPLIDO', fechaLimite: '2026-10-15', terminadoEl: '2026-10-14' });
    });
  });

  it('cambiar el rol de un estado reevalúa el mismo historial', () => {
    const todoCuenta = (): RolEstado => 'cuenta';
    expect(reloj({ hoy: '2026-10-09', intervalos: PAUSA_EN_MEDIO, rolDe: todoCuenta })).toMatchObject({ fechaLimite: '2026-10-08', estadoPlazo: 'VENCIDO', diasHabiles: -1, diasPausados: 0, pausas: [] });
    // Y al revés: marcar como standby un estado en el que el ticket ya estuvo pausa esos días hacia atrás.
    const enProcesoEsStandby = (clave: string): RolEstado => (clave === 'en proceso' ? 'standby' : 'cuenta');
    const r = reloj({ hoy: '2026-10-09', intervalos: PAUSA_EN_MEDIO, rolDe: enProcesoEsStandby });
    // En pausa: lun 5 no cuenta (es el ingreso), jue 8 y vie 9 (hoy). Activos: mar 6, mié 7 y mar 13.
    expect(r).toMatchObject({ enPausa: true, diasPausados: 2, pausas: [{ desde: '2026-10-08', hasta: '2026-10-09' }], fechaLimite: '2026-10-13' });
  });

  it('sin tipo o sin plazo configurado → SIN_PLAZO, pero con el rol y las pausas', () => {
    expect(reloj({ dias: null, hoy: '2026-10-09', intervalos: PAUSA_EN_MEDIO })).toEqual({
      fechaLimite: null,
      fechaLimiteBase: null,
      diasHabiles: null,
      estadoPlazo: 'SIN_PLAZO',
      tramos: null,
      rolEstado: 'cuenta',
      enPausa: false,
      diasPausados: 2,
      pausas: [{ desde: '2026-10-06', hasta: '2026-10-07' }],
      terminadoEl: null,
      medidoDesde: '2026-10-05',
    });
    const enStandby = historia(['en proceso', '2026-10-05 12:00'], ['notificacion cliente', '2026-10-06 10:00']);
    expect(reloj({ dias: null, hoy: '2026-10-07', intervalos: enStandby })).toMatchObject({ estadoPlazo: 'SIN_PLAZO', rolEstado: 'standby', enPausa: true, diasPausados: 2 });
    const terminado = historia(['en proceso', '2026-10-05 12:00'], ['por facturar', '2026-10-07 15:00']);
    expect(reloj({ dias: null, hoy: '2026-10-09', intervalos: terminado })).toMatchObject({ estadoPlazo: 'SIN_PLAZO', rolEstado: 'terminado', terminadoEl: '2026-10-07', fechaLimite: null });
  });

  it('sin ingreso no hay nada que medir', () => {
    expect(reloj({ ingreso: null, hoy: '2026-10-09', intervalos: PAUSA_EN_MEDIO })).toMatchObject({ estadoPlazo: 'SIN_PLAZO', fechaLimite: null, diasPausados: 0, pausas: [], medidoDesde: '2026-10-05' });
  });

  it('los intervalos pueden llegar desordenados', () => {
    expect(reloj({ hoy: '2026-10-09', intervalos: [...PAUSA_EN_MEDIO].reverse() })).toEqual(reloj({ hoy: '2026-10-09', intervalos: PAUSA_EN_MEDIO }));
  });

  it('el fin del día es el de Bogotá: un cambio a las 23:30 cuenta para ese día', () => {
    // 23:30 del martes en Bogotá son las 04:30 UTC del miércoles.
    const r = reloj({ hoy: '2026-10-08', intervalos: historia(['en proceso', '2026-10-05 12:00'], ['notificacion cliente', '2026-10-06 23:30'], ['en proceso', '2026-10-07 23:30']) });
    expect(r).toMatchObject({ diasPausados: 1, pausas: [{ desde: '2026-10-06', hasta: '2026-10-06' }], fechaLimite: '2026-10-09' });
  });
});

describe('festivosDelEje', () => {
  it('trae los festivos desde 60 días antes de hoy hasta pasado el último límite', () => {
    const f = festivosDelEje('2026-10-06', ['2026-10-08', null, '2027-01-05']);
    expect(f).toContain('2026-08-07'); // dentro de los 60 días hacia atrás
    expect(f).toContain('2026-10-12');
    expect(f).toContain('2027-01-01');
    expect(f).not.toContain('2026-07-20'); // antes de la ventana
    expect(f).not.toContain('2027-03-22'); // después
    expect([...f].sort()).toEqual(f);
  });
});

describe('043_trazabilidad_plazos.sql', () => {
  // La semilla va escrita a mano en el SQL (las migraciones sólo ejecutan
  // .sql). Este candado vigila que cada clave sembrada sea la que calcula
  // claveTipoServicio: si no coincidieran, el tipo de Desk no casaría con su fila.
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/043_trazabilidad_plazos.sql', import.meta.url)), 'utf8');
  const semilla = [...SQL.matchAll(/\('([^']+)',\s*'([^']+)',\s*(NULL|\d+)\)/g)].map((m) => ({
    clave: m[1],
    etiqueta: m[2],
    dias: m[3] === 'NULL' ? null : Number(m[3]),
  }));

  it('cada clave sembrada es la normalización de su etiqueta', () => {
    expect(semilla.length).toBeGreaterThanOrEqual(6);
    for (const s of semilla) expect(s.clave).toBe(claveTipoServicio(s.etiqueta));
  });

  it('siembra Diagnóstico = 3 y Calibración = 4; el resto, sin plazo', () => {
    const conPlazo = semilla.filter((s) => s.dias !== null);
    expect(conPlazo).toEqual([
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3 },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4 },
    ]);
    expect(semilla.filter((s) => s.dias === null).map((s) => s.etiqueta).sort()).toEqual(['Garantía', 'Mantenimiento', 'No aplica', 'Otro']);
  });

  it('nunca pisa lo que edite el usuario ni toca el esquema desk', () => {
    expect(SQL).toMatch(/ON CONFLICT \(clave\) DO NOTHING/);
    expect(SQL).not.toMatch(/\bdesk\./);
  });
});

describe('044_trazabilidad_servicios_tipo.sql', () => {
  // La 044 se vuelve a ejecutar en cada arranque: sólo puede crear lo que falte.
  // Cualquier sentencia que escriba o borre datos se llevaría por delante los
  // tipos puestos a mano.
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/044_trazabilidad_servicios_tipo.sql', import.meta.url)), 'utf8');
  const sentencias = SQL.replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('sólo crea, y siempre con IF NOT EXISTS', () => {
    expect(sentencias.length).toBeGreaterThanOrEqual(1);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|INDEX) IF NOT EXISTS /);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_servicios_tipo/);
  });

  it('no toca el esquema desk ni le pone una clave foránea', () => {
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 043', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'043_trazabilidad_plazos\.sql',\s*'044_trazabilidad_servicios_tipo\.sql'/);
  });
});

describe('045_trazabilidad_tipo_combinado.sql', () => {
  // La 045 sólo siembra la fila del tipo compuesto «Diagnóstico + Calibración»,
  // para que se pueda elegir a mano y salga en Configuración. Su plazo NO se
  // guarda: es la suma, en vivo, de los de sus partes (TIPOS_COMPUESTOS).
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/045_trazabilidad_tipo_combinado.sql', import.meta.url)), 'utf8');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const semilla = [...SQL.matchAll(/\('([^']+)',\s*'([^']+)',\s*(NULL|\d+)\)/g)].map((m) => ({ clave: m[1], etiqueta: m[2], dias: m[3] }));
  const sentencias = sinComentarios
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('siembra una sola fila: «Diagnóstico + Calibración», sin días guardados', () => {
    expect(semilla).toEqual([{ clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración', dias: 'NULL' }]);
  });

  it('la clave sembrada es la normalización de su etiqueta y es un tipo compuesto del dominio', () => {
    expect(semilla.length).toBeGreaterThanOrEqual(1);
    for (const s of semilla) {
      expect(s.clave).toBe(claveTipoServicio(s.etiqueta));
      expect(Object.keys(TIPOS_COMPUESTOS)).toContain(s.clave);
    }
  });

  it('es una única sentencia INSERT … ON CONFLICT DO NOTHING: ni crea, ni altera, ni pisa, ni borra', () => {
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0]).toMatch(/^INSERT INTO portal\.tmc_plazos \(clave, etiqueta, dias_habiles\) VALUES/);
    expect(sentencias[0]).toMatch(/ON CONFLICT \(clave\) DO NOTHING$/);
    expect(sinComentarios).not.toMatch(/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    expect(SQL).not.toMatch(/\bdesk\./);
  });

  it('está apuntada en MIGRATIONS, detrás de la 044', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'044_trazabilidad_servicios_tipo\.sql',\s*'045_trazabilidad_tipo_combinado\.sql'/);
  });
});

describe('046_trazabilidad_estados_desk.sql', () => {
  // La 046 se vuelve a ejecutar en cada arranque: sólo puede crear lo que falte.
  // Sin semilla: ningún estado nace marcado como standby, y una sentencia que
  // escribiera se llevaría por delante lo que la gente haya marcado.
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/046_trazabilidad_estados_desk.sql', import.meta.url)), 'utf8');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('sólo crea, y siempre con IF NOT EXISTS', () => {
    expect(sentencias.length).toBeGreaterThanOrEqual(1);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|INDEX) IF NOT EXISTS /);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_estados_desk/);
  });

  it('sin semilla ni nada que escriba, altere o borre', () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('el rol nace en «cuenta» y sólo admite los tres del dominio; ya no hay booleano de standby', () => {
    expect(sinComentarios).toMatch(/rol\s+VARCHAR\(\d+\)\s+NOT NULL\s+DEFAULT 'cuenta'/i);
    const check = /CHECK \(rol IN \(([^)]*)\)\)/i.exec(sinComentarios);
    expect(check).not.toBeNull();
    expect(check![1].split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...ROLES_ESTADO]);
    expect(sinComentarios).not.toMatch(/\bBOOLEAN\b/i);
  });

  it('no toca el esquema desk ni le pone una clave foránea', () => {
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 045', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'045_trazabilidad_tipo_combinado\.sql',\s*'046_trazabilidad_estados_desk\.sql'/);
  });
});

describe('047_trazabilidad_estados_historial.sql', () => {
  // La 047 se vuelve a ejecutar en cada arranque: sólo puede crear lo que falte.
  // Una sentencia que escribiera o borrara se llevaría por delante el historial
  // de estados, que no se puede reconstruir (la réplica sólo trae el de ahora).
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/047_trazabilidad_estados_historial.sql', import.meta.url)), 'utf8');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('sólo crea, y siempre con IF NOT EXISTS', () => {
    expect(sentencias.length).toBeGreaterThanOrEqual(2);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|(UNIQUE )?INDEX) IF NOT EXISTS /);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_estados_historial/);
  });

  it('sin semilla ni nada que escriba, altere o borre', () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('como mucho un tramo abierto por ticket: índice único parcial sobre los que no tienen `hasta`', () => {
    expect(sinComentarios).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON portal\.tmc_estados_historial \(numero\)\s+WHERE hasta IS NULL/i);
  });

  it('`desde` es obligatorio, `hasta` puede faltar y hay una marca de si `desde` es un cambio visto de verdad', () => {
    expect(sinComentarios).toMatch(/desde\s+TIMESTAMPTZ\s+NOT NULL/i);
    expect(sinComentarios).toMatch(/hasta\s+TIMESTAMPTZ\s+NULL/i);
    expect(sinComentarios).toMatch(/desde_real\s+BOOLEAN\s+NOT NULL/i);
  });

  it('no toca el esquema desk ni le pone una clave foránea', () => {
    expect(SQL).not.toMatch(/\bdesk\./);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 046', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'046_trazabilidad_estados_desk\.sql',\s*'047_trazabilidad_estados_historial\.sql'/);
  });
});

describe('048_trazabilidad_contactos.sql', () => {
  // La 048 se vuelve a ejecutar en cada arranque: sólo puede crear lo que falte.
  // Sin semilla: ningún cliente nace con contacto puesto a mano, y una sentencia
  // que escribiera se llevaría por delante los que la gente haya puesto.
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/048_trazabilidad_contactos.sql', import.meta.url)), 'utf8');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('sólo crea, y siempre con IF NOT EXISTS', () => {
    expect(sentencias.length).toBeGreaterThanOrEqual(1);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|INDEX) IF NOT EXISTS /);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_contactos/);
  });

  it('sin semilla ni nada que escriba, altere o borre', () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('una fila por cliente (clave normalizada), con entre uno y cinco correos y firmada', () => {
    expect(sinComentarios).toMatch(/clave\s+VARCHAR\(200\)\s+PRIMARY KEY/i);
    expect(sinComentarios).toMatch(/emails\s+TEXT\[\]\s+NOT NULL/i);
    const tope = /cardinality\(emails\) BETWEEN 1 AND (\d+)/i.exec(sinComentarios);
    expect(tope).not.toBeNull();
    expect(Number(tope![1])).toBe(CONTACTO_MAX_EMAILS);
    expect(sinComentarios).toMatch(/actualizado_por_id\s+UUID\s+NULL/i);
    expect(sinComentarios).toMatch(/actualizado_por\s+VARCHAR\(254\)\s+NOT NULL/i);
    expect(sinComentarios).toMatch(/actualizado_en\s+TIMESTAMPTZ\s+NOT NULL/i);
  });

  it('no toca el esquema desk ni le pone una clave foránea', () => {
    expect(SQL).not.toMatch(/\bdesk\./i);
    expect(SQL).not.toMatch(/\bREFERENCES\b/i);
  });

  it('no guarda nada de envíos: ni bandeja de salida ni cola ni programación', () => {
    expect(sinComentarios).not.toMatch(/outbox|enviad|envio|cola|programad/i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 047', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'047_trazabilidad_estados_historial\.sql',\s*'048_trazabilidad_contactos\.sql'/);
  });
});

describe('049_trazabilidad_roles.sql', () => {
  // La 049 se vuelve a ejecutar en cada arranque: sólo puede crear lo que falte.
  // Sin semilla: nadie nace con rol (sin fila se es LECTOR), y una sentencia que
  // escribiera se llevaría por delante los roles que un administrador haya repartido.
  const SQL = readFileSync(fileURLToPath(new URL('../users/migrations/049_trazabilidad_roles.sql', import.meta.url)), 'utf8');
  const sinComentarios = SQL.replace(/--.*$/gm, '');
  const sentencias = sinComentarios
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  it('sólo crea, y siempre con IF NOT EXISTS', () => {
    expect(sentencias.length).toBeGreaterThanOrEqual(1);
    for (const s of sentencias) expect(s).toMatch(/^CREATE (SCHEMA|TABLE|INDEX) IF NOT EXISTS /);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS portal\.tmc_user_roles/);
  });

  it('sin semilla ni nada que escriba, altere o borre', () => {
    expect(sinComentarios).not.toMatch(/\b(INSERT|UPDATE|DROP|ALTER|TRUNCATE)\b/i);
    // El único DELETE es el del ON DELETE CASCADE de la clave foránea.
    expect(sinComentarios.replace(/ON DELETE CASCADE/gi, '')).not.toMatch(/\bDELETE\b/i);
  });

  it('el rol sólo admite los cuatro de la matriz (roles.ts) y no tiene valor por defecto: sin fila se es LECTOR', () => {
    const check = /CHECK \(role IN \(([^)]*)\)\)/i.exec(sinComentarios);
    expect(check).not.toBeNull();
    expect(check![1].split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...ROLES_APP]);
    expect(sinComentarios).toMatch(/role\s+VARCHAR\(\d+\)\s+NOT NULL\s+CHECK/i);
    expect(sinComentarios).not.toMatch(/\bDEFAULT '/i);
  });

  it('una fila por usuario, que se va con él, y firmada', () => {
    expect(sinComentarios).toMatch(/user_id\s+UUID\s+PRIMARY KEY\s+REFERENCES portal\.users\(id\) ON DELETE CASCADE/i);
    expect(sinComentarios).toMatch(/actualizado_por_id\s+UUID\s+NULL/i);
    expect(sinComentarios).toMatch(/actualizado_por\s+VARCHAR\(254\)\s+NOT NULL/i);
    expect(sinComentarios).toMatch(/actualizado_en\s+TIMESTAMPTZ\s+NOT NULL/i);
  });

  it('no toca el esquema desk', () => {
    expect(SQL).not.toMatch(/\bdesk\./i);
  });

  it('está apuntada en MIGRATIONS, detrás de la 048 y la última', () => {
    const db = readFileSync(fileURLToPath(new URL('../db.ts', import.meta.url)), 'utf8');
    expect(db).toMatch(/'048_trazabilidad_contactos\.sql',\s*'049_trazabilidad_roles\.sql'\]/);
  });
});
