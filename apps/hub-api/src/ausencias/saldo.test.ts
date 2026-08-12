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

  it('devuelve configurado:false y ceros si al empleado le falta la configuración', () => {
    const s = calcularSaldo(null, [vac('2026-02-01', 5)], '2026-03-02');
    expect(s.configurado).toBe(false);
    expect(s.disponible).toBe(0);
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
});
