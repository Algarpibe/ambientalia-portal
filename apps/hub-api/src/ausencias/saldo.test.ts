import { describe, expect, it } from 'vitest';
import { calcularSaldo, hoyEnColombia, type VacacionTomada } from './saldo.js';

const CONFIG = { saldoCorte: 10, fechaCorte: '2026-01-01' };

/** Una vacación aprobada de `dias` días que empieza el `inicio`. */
function vac(inicio: string, dias: number, estado: VacacionTomada['estado'] = 'aprobada'): VacacionTomada {
  return { tipo: 'vacaciones', fechaInicio: inicio, diasHabiles: dias, estado };
}

describe('calcularSaldo', () => {
  it('devenga 1,25 días por cada 30 días transcurridos', () => {
    // 60 días desde el corte = 2 meses = 2,5 días devengados.
    const s = calcularSaldo(CONFIG, [], '2026-03-02');
    expect(s.devengadas).toBe(2.5);
    expect(s.disponible).toBe(12.5);
  });

  it('descuenta las vacaciones aprobadas desde el corte', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 5)], '2026-03-02');
    expect(s.disfrutadas).toBe(5);
    expect(s.disponible).toBe(7.5);
  });

  it('cuenta la vacación que empieza EL MISMO día del corte', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-01-01', 3)], '2026-01-01');
    expect(s.disfrutadas).toBe(3);
    expect(s.disponible).toBe(7);
  });

  it('ignora la que empieza el día ANTES del corte', () => {
    // Ya está descontada del saldo de corte; contarla otra vez sería doble conteo.
    const s = calcularSaldo(CONFIG, [vac('2025-12-31', 3)], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('ignora la que empieza antes del corte aunque acabe después', () => {
    // Se decide por fecha de inicio: cualquier regla más fina sería difícil de
    // explicar a quien mira el número.
    const s = calcularSaldo(CONFIG, [vac('2025-12-28', 6)], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
  });

  it('no descuenta las rechazadas', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 5, 'rechazada')], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('lleva las pendientes a enTramite, no a disfrutadas', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 5, 'pendiente')], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.enTramite).toBe(5);
    // El saldo firme no baja hasta que se apruebe.
    expect(s.disponible).toBe(10);
  });

  it('una que espera la SEGUNDA firma también va a enTramite', () => {
    // El fallo que evita este test no da error: `sumar` comparaba un estado
    // exacto, así que media firma no sumaba en ningún sitio y desaparecía del
    // saldo — ni en trámite ni disfrutada. Y es justo cuando más se consulta.
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 5, 'pendiente_2')], '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.enTramite).toBe(5);
    expect(s.disponible).toBe(10);
  });

  it('suma los dos niveles en enTramite', () => {
    const s = calcularSaldo(
      CONFIG,
      [vac('2026-02-01', 5, 'pendiente'), vac('2026-03-01', 2, 'pendiente_2')],
      '2026-01-01',
    );
    expect(s.enTramite).toBe(7);
  });

  it('una pendiente ANTES del corte no entra en enTramite', () => {
    // Ya sería parte del saldo de corte, igual que con las aprobadas.
    const s = calcularSaldo(CONFIG, [vac('2025-12-15', 4, 'pendiente')], '2026-01-01');
    expect(s.enTramite).toBe(0);
  });

  it('ignora permisos, compensatorios e incapacidades', () => {
    const otros: VacacionTomada[] = [
      { tipo: 'permiso', fechaInicio: '2026-02-01', diasHabiles: 3, estado: 'aprobada' },
      { tipo: 'compensatorio', fechaInicio: '2026-02-01', diasHabiles: 2, estado: 'aprobada' },
      { tipo: 'incapacidad', fechaInicio: '2026-02-01', diasHabiles: 4, estado: 'registrada' },
    ];
    const s = calcularSaldo(CONFIG, otros, '2026-01-01');
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('admite medios días', () => {
    const s = calcularSaldo(CONFIG, [vac('2026-02-01', 0.5)], '2026-01-01');
    expect(s.disfrutadas).toBe(0.5);
    expect(s.disponible).toBe(9.5);
  });

  it('descuenta una aprobada aunque su inicio sea futuro respecto a "hoy"', () => {
    // Deliberado: el saldo de partida sale de un Excel que todavía NO trae
    // descontadas las vacaciones ya aprobadas para las próximas semanas, así
    // que esta función tiene que descontarlas aunque aún no hayan ocurrido.
    const s = calcularSaldo(CONFIG, [vac('2026-06-01', 5)], '2026-01-01');
    expect(s.disfrutadas).toBe(5);
    expect(s.disponible).toBe(5);
  });

  it('devuelve configurado:false y ceros si al empleado le falta la configuración', () => {
    const s = calcularSaldo(null, [vac('2026-02-01', 5)], '2026-03-02');
    expect(s.configurado).toBe(false);
    expect(s.disponible).toBe(0);
  });

  it('SIN_CONFIGURAR no es un objeto compartido: mutar una respuesta no afecta a la siguiente', () => {
    const s1 = calcularSaldo(null, [], '2026-03-02');
    (s1 as { disponible: number }).disponible = 999;
    const s2 = calcularSaldo(null, [], '2026-03-02');
    expect(s2.disponible).toBe(0);
  });

  it('no devenga en negativo si la fecha de corte es futura', () => {
    const s = calcularSaldo({ saldoCorte: 10, fechaCorte: '2026-06-01' }, [], '2026-01-01');
    expect(s.devengadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('redondea a un decimal', () => {
    // 10 días = 10/30 × 1,25 = 0,41666… → 0,4
    const s = calcularSaldo(CONFIG, [], '2026-01-11');
    expect(s.devengadas).toBe(0.4);
  });

  it('el año devenga 15,2 días, no 15 (dividir por 30 y no por 30,44)', () => {
    // Es la fórmula del Excel y se mantiene a propósito: corregirla descuadraría
    // contra el consolidado. Este test existe para que el desvío sea deliberado
    // y no una sorpresa.
    const s = calcularSaldo({ saldoCorte: 0, fechaCorte: '2026-01-01' }, [], '2027-01-01');
    expect(s.devengadas).toBe(15.2);
  });

  it('en un empate de redondeo, disponible no penaliza al empleado', () => {
    // 10,4 + 5,8 − 6,5 = 9,7 a mano. Si disponible se calculara desde el
    // devengo SIN redondear (5,75), el error binario de la resta empujaría el
    // empate x,x5 hacia abajo y daría 9,6: 0,1 días de menos, siempre en
    // perjuicio del empleado.
    const s = calcularSaldo({ saldoCorte: 10.4, fechaCorte: '2026-01-01' }, [vac('2026-02-01', 6.5)], '2026-05-19');
    expect(s.devengadas).toBe(5.8);
    expect(s.disponible).toBe(9.7);
  });

  it('las tres cifras que se enseñan cuadran a la décima que se muestra', () => {
    // NO es igualdad estricta de coma flotante: sumar saldoCorte + devengadas
    // − disfrutadas puede arrastrar ruido binario de última cifra (aquí
    // 3.9000000000000004 en vez de 3.9 — 10.4 − 6.5 no es exacto en binario).
    // La garantía real, y la que ve el usuario, es que cuadran A LA DÉCIMA,
    // que es la precisión con la que se enseñan; exigir igualdad exacta de
    // float sobre un fixture concreto es una mina para quien lo toque después.
    const s = calcularSaldo({ saldoCorte: 10.4, fechaCorte: '2026-01-01' }, [vac('2026-01-01', 6.5)], '2026-01-01');
    expect(s.saldoCorte + s.devengadas - s.disfrutadas).toBeCloseTo(s.disponible, 1);
  });

  it('lanza si fechaCorte llega vacía o mal formada, en vez de devolver un saldo en blanco', () => {
    expect(() => calcularSaldo({ saldoCorte: 10, fechaCorte: '' }, [], '2026-01-01')).toThrow();
    expect(() => calcularSaldo({ saldoCorte: 10, fechaCorte: '2026/01/01' }, [], '2026-01-01')).toThrow();
    expect(() => calcularSaldo({ saldoCorte: 10, fechaCorte: '2026-13-45' }, [], '2026-01-01')).toThrow();
  });

  it('lanza si "hoy" llega mal formado', () => {
    expect(() => calcularSaldo(CONFIG, [], '01-01-2026')).toThrow();
    expect(() => calcularSaldo(CONFIG, [], '')).toThrow();
  });

  it('lanza si fechaInicio de una solicitud viene en dd/mm/aaaa en vez de YYYY-MM-DD', () => {
    // Sin la validación, '2026-2-1' >= '2026-10-01' da true por orden
    // lexicográfico: febrero contaría como posterior a un corte de octubre.
    // La corrupta va DETRÁS de una válida a propósito: así el test distingue
    // «se validan todas» de «se valida la primera». Sin eso, un refactor que
    // metiera el `esFechaValida` dentro del `filter` seguiría pasando.
    expect(() => calcularSaldo(CONFIG, [vac('2026-02-01', 3), vac('01/02/2026', 5)], '2026-03-02')).toThrow();
  });

  it('lanza si fechaInicio de una solicitud llega vacía', () => {
    expect(() => calcularSaldo(CONFIG, [vac('2026-02-01', 3), vac('', 5)], '2026-03-02')).toThrow();
  });

  it('lanza si fechaInicio de una solicitud llega como objeto Date (gotcha del ::text olvidado)', () => {
    // Con `>=`, un Date se compara vía ToPrimitive numérico: el timestamp
    // contra Number('2026-01-01'), que es NaN. La comparación es entonces
    // SIEMPRE false y la vacación no se descontaría jamás, en silencio.
    const conFechaDate = [
      vac('2026-02-01', 3),
      { ...vac('2026-02-01', 5), fechaInicio: new Date('2026-02-01T00:00:00Z') as unknown as string },
    ];
    expect(() => calcularSaldo(CONFIG, conFechaDate, '2026-03-02')).toThrow();
  });
});

describe('hoyEnColombia', () => {
  it('a las 20:00 hora de Colombia sigue siendo el mismo día', () => {
    // 2026-08-12 20:00 en Colombia = 2026-08-13 01:00 UTC. Sin el ajuste, el
    // saldo se adelantaría un día cada tarde.
    expect(hoyEnColombia(new Date('2026-08-13T01:00:00Z'))).toBe('2026-08-12');
  });

  it('a las 00:30 hora de Colombia ya es el día nuevo', () => {
    expect(hoyEnColombia(new Date('2026-08-13T05:30:00Z'))).toBe('2026-08-13');
  });

  it('en la frontera exacta, un segundo antes todavía es el día anterior', () => {
    // Distingue UTC−5 de cualquier desfase vecino (UTC−4, UTC−4,5, UTC−5,5):
    // todos esos coinciden con los dos tests de arriba pero fallarían aquí.
    expect(hoyEnColombia(new Date('2026-08-13T04:59:59Z'))).toBe('2026-08-12');
  });

  it('en la frontera exacta, en el segundo exacto ya es el día nuevo', () => {
    expect(hoyEnColombia(new Date('2026-08-13T05:00:00Z'))).toBe('2026-08-13');
  });
});
