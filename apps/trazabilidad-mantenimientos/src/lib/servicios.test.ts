import { describe, it, expect } from 'vitest';
import { estadoPlazo, type ServicioVista } from '../dominio';
import {
  TONO_PLAZO,
  barraServicio,
  diasDelEje,
  ejeServicios,
  mesesDelEje,
  porUrgenciaPlazo,
  resumenServicios,
  textoPlazo,
} from './servicios';

const HOY = '2026-10-06';
let n = 1000;

/** Un servicio de mentira: el plazo llega calculado del servidor, aquí se pone a mano. */
function sv(ingreso: string | null, fechaLimite: string | null, extra: Partial<ServicioVista> = {}): ServicioVista {
  return {
    numero: ++n,
    asunto: 'Servicio Técnico Cliente Uno',
    cliente: 'Cliente Uno',
    clienteDeAsunto: false,
    serial: '18A00001',
    modelo: 'EDM180C',
    tipoServicio: fechaLimite ? 'Diagnóstico' : '',
    estado: 'En diagnóstico',
    ingreso,
    plazoDias: fechaLimite ? 3 : null,
    fechaLimite,
    diasHabiles: fechaLimite ? 0 : null,
    estadoPlazo: estadoPlazo(fechaLimite, HOY),
    sinConfirmar: false,
    ...extra,
  };
}

describe('eje del calendario de barras', () => {
  it('va de un día antes del primer ingreso a cinco después del último límite', () => {
    const eje = ejeServicios([sv('2026-10-01', '2026-10-06'), sv('2026-10-05', '2026-10-08')], HOY);
    expect(eje).toEqual({ inicio: '2026-09-30', fin: '2026-10-13', dias: 14 });
  });

  it('si todo está vencido, llega hasta hoy (más el margen)', () => {
    const eje = ejeServicios([sv('2026-09-21', '2026-09-24')], HOY);
    expect(eje).toMatchObject({ inicio: '2026-09-20', fin: '2026-10-11' });
  });

  it('no retrocede más de 60 días por un ticket antiguo', () => {
    const eje = ejeServicios([sv('2025-01-10', '2025-01-15'), sv('2026-10-05', '2026-10-08')], HOY);
    expect(eje.inicio).toBe('2026-08-07');
    expect(eje.fin).toBe('2026-10-13');
  });

  it('los servicios sin plazo no estiran el eje; sin ninguna barra queda una semana alrededor de hoy', () => {
    expect(ejeServicios([sv('2026-09-01', null)], HOY)).toEqual({ inicio: '2026-09-29', fin: '2026-10-11', dias: 13 });
    expect(ejeServicios([], HOY)).toEqual({ inicio: '2026-09-29', fin: '2026-10-11', dias: 13 });
  });
});

describe('barra de un servicio', () => {
  const eje = { inicio: '2026-09-30', fin: '2026-10-11', dias: 12 };

  it('sin plazo no hay barra', () => {
    expect(barraServicio(sv('2026-10-05', null), eje, HOY)).toBeNull();
    expect(barraServicio(sv(null, '2026-10-08'), eje, HOY)).toBeNull();
  });

  it('en plazo: del ingreso a la fecha límite, ambos días incluidos', () => {
    expect(barraServicio(sv('2026-10-05', '2026-10-08'), eje, HOY)).toEqual({ plazo: { desde: 5, hasta: 8 }, atraso: null, recortada: false });
  });

  it('vence hoy: la barra acaba en la columna de hoy y no hay atraso', () => {
    expect(barraServicio(sv('2026-10-01', '2026-10-06'), eje, HOY)).toEqual({ plazo: { desde: 1, hasta: 6 }, atraso: null, recortada: false });
  });

  it('vencido: el atraso sigue desde el día siguiente al límite hasta hoy', () => {
    expect(barraServicio(sv('2026-09-30', '2026-10-02'), eje, HOY)).toEqual({ plazo: { desde: 0, hasta: 2 }, atraso: { desde: 3, hasta: 6 }, recortada: false });
  });

  it('un ingreso anterior al eje se recorta por la izquierda y se avisa', () => {
    expect(barraServicio(sv('2026-09-20', '2026-10-02'), eje, HOY)).toEqual({ plazo: { desde: 0, hasta: 2 }, atraso: { desde: 3, hasta: 6 }, recortada: true });
  });

  it('si hasta el límite cae antes del eje, sólo queda el atraso', () => {
    expect(barraServicio(sv('2025-01-10', '2025-01-15'), eje, HOY)).toEqual({ plazo: null, atraso: { desde: 0, hasta: 6 }, recortada: true });
  });
});

describe('días y meses del eje', () => {
  const eje = { inicio: '2026-10-09', fin: '2026-11-02', dias: 25 };

  it('marca los fines de semana y los festivos como no hábiles', () => {
    const d = diasDelEje(eje, ['2026-10-12']);
    expect(d).toHaveLength(25);
    expect(d.slice(0, 5)).toEqual([
      { fecha: '2026-10-09', dia: 9, habil: true }, // viernes
      { fecha: '2026-10-10', dia: 10, habil: false },
      { fecha: '2026-10-11', dia: 11, habil: false },
      { fecha: '2026-10-12', dia: 12, habil: false }, // lunes festivo
      { fecha: '2026-10-13', dia: 13, habil: true },
    ]);
  });

  it('agrupa las columnas por mes', () => {
    expect(mesesDelEje(eje)).toEqual([
      { etiqueta: 'oct 2026', desde: 0, hasta: 22 },
      { etiqueta: 'nov 2026', desde: 23, hasta: 24 },
    ]);
  });
});

describe('colores, textos y orden', () => {
  it('verde en plazo, ámbar si vence hoy, rojo vencido y gris sin plazo', () => {
    expect(TONO_PLAZO.EN_PLAZO.barra).toContain('emerald');
    expect(TONO_PLAZO.VENCE_HOY.barra).toContain('amber');
    expect(TONO_PLAZO.VENCIDO.barra).toContain('red');
    expect(TONO_PLAZO.SIN_PLAZO.barra).toContain('slate');
  });

  it('redacta los días hábiles que quedan o el atraso', () => {
    expect(textoPlazo(sv('2026-10-05', '2026-10-08', { diasHabiles: 2 }))).toBe('quedan 2 d háb.');
    expect(textoPlazo(sv('2026-10-01', '2026-10-06', { diasHabiles: 0 }))).toBe('vence hoy');
    expect(textoPlazo(sv('2026-09-28', '2026-10-02', { diasHabiles: -2 }))).toBe('vencido hace 2 d háb.');
    // Sábado tras un límite en viernes: vencido, pero aún sin días hábiles de atraso.
    expect(textoPlazo(sv('2026-09-28', '2026-10-02', { diasHabiles: 0, estadoPlazo: 'VENCIDO' }))).toBe('vencido');
    expect(textoPlazo(sv('2026-10-05', null))).toBe('sin plazo');
  });

  it('ordena por urgencia: más atraso primero y los «sin plazo» al final', () => {
    const a = sv('2026-10-05', '2026-10-08', { diasHabiles: 2 });
    const b = sv('2026-09-28', '2026-10-02', { diasHabiles: -2 });
    const c = sv('2026-10-05', null);
    const d = sv('2026-10-01', '2026-10-06', { diasHabiles: 0 });
    expect([a, b, c, d].sort(porUrgenciaPlazo)).toEqual([b, d, a, c]);
  });

  it('resume cuántos no tienen tipo y qué tipos siguen sin plazo', () => {
    const L = [
      sv('2026-10-05', '2026-10-08'),
      sv('2026-10-05', null),
      sv('2026-10-05', null, { sinConfirmar: true }),
      sv('2026-10-05', null, { tipoServicio: 'Mantenimiento' }),
      sv('2026-10-05', null, { tipoServicio: ' mantenimiento' }),
      sv('2026-10-05', null, { tipoServicio: 'Garantía' }),
    ];
    expect(resumenServicios(L)).toEqual({ total: 6, conPlazo: 1, sinTipo: 2, sinConfirmar: 1, tiposSinPlazo: ['Garantía', 'Mantenimiento'] });
  });
});
