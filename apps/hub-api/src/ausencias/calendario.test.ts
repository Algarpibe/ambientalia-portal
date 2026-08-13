import { describe, expect, it } from 'vitest';
import {
  diasDelMes,
  esMesValido,
  marcasDelMes,
  rangoDelMes,
  type AusenciaRango,
} from './calendario.js';

/** Una ausencia de Ana. */
function aus(over: Partial<AusenciaRango> = {}): AusenciaRango {
  return {
    empleadoId: 'e1',
    tipo: 'vacaciones',
    estado: 'aprobada',
    fechaInicio: '2026-08-10',
    fechaFin: '2026-08-12',
    ...over,
  };
}

const fechas = (ms: { fecha: string }[]) => ms.map((m) => m.fecha);

describe('esMesValido', () => {
  it('acepta YYYY-MM', () => {
    expect(esMesValido('2026-08')).toBe(true);
    expect(esMesValido('2026-01')).toBe(true);
    expect(esMesValido('2026-12')).toBe(true);
  });

  it('rechaza lo que no lo es', () => {
    for (const v of ['2026-13', '2026-00', '2026-8', '08-2026', '2026', '', 'agosto']) {
      expect(esMesValido(v)).toBe(false);
    }
  });

  it('rechaza el año con ceros a la izquierda, que `Date.UTC` no interpretaría como el 99', () => {
    // `Date.UTC(99, ...)` mapea el año 99 a 1999: sin este rechazo,
    // `rangoDelMes('0099-01')` devolvería una ventana de casi 1900 años.
    expect(esMesValido('0099-01')).toBe(false);
  });
});

describe('rangoDelMes', () => {
  it('da el primer y el último día', () => {
    expect(rangoDelMes('2026-08')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
  });

  it('acierta con los meses de 30 días', () => {
    expect(rangoDelMes('2026-04').hasta).toBe('2026-04-30');
  });

  it('acierta con febrero, bisiesto y no bisiesto', () => {
    expect(rangoDelMes('2026-02').hasta).toBe('2026-02-28');
    expect(rangoDelMes('2028-02').hasta).toBe('2028-02-29');
  });

  it('acierta con diciembre, que cruza de año', () => {
    expect(rangoDelMes('2026-12')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
  });
});

describe('diasDelMes', () => {
  it('devuelve todos los días del mes', () => {
    expect(diasDelMes('2026-08')).toHaveLength(31);
    expect(diasDelMes('2026-04')).toHaveLength(30);
  });

  it('marca el fin de semana como no laborable', () => {
    // 2026-08-01 es sábado y 2026-08-02 domingo.
    const d = diasDelMes('2026-08');
    expect(d[0]).toEqual({ fecha: '2026-08-01', laborable: false });
    expect(d[1]).toEqual({ fecha: '2026-08-02', laborable: false });
    expect(d[2]).toEqual({ fecha: '2026-08-03', laborable: true });
  });

  it('marca los festivos de Colombia como no laborables', () => {
    const enero = diasDelMes('2026-01');
    expect(enero.find((d) => d.fecha === '2026-01-01')?.laborable).toBe(false);
  });

  it('traslada un festivo de la Ley Emiliani al lunes siguiente', () => {
    // San José cae jueves 19-mar-2026. Verificado contra el calendario oficial
    // de festivos de Colombia 2026 (no supuesto): la Ley 51 de 1983 lo traslada
    // al lunes 23-mar-2026, que es el que de verdad es festivo. El 1 de enero
    // (el único caso que ya se probaba) es de fecha FIJA y no pasa por este
    // traslado, así que no ejercitaba esta rama del cálculo.
    const marzo = diasDelMes('2026-03');
    expect(marzo.find((d) => d.fecha === '2026-03-19')?.laborable).toBe(true);
    expect(marzo.find((d) => d.fecha === '2026-03-23')?.laborable).toBe(false);
  });
});

describe('marcasDelMes — expansión', () => {
  it('expande una ausencia enteramente dentro del mes', () => {
    const m = marcasDelMes('2026-08', [aus()]);
    expect(fechas(m)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('acota una que empieza el mes anterior', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-07-28', fechaFin: '2026-08-03' })]);
    expect(fechas(m)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('acota una que acaba el mes siguiente', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-29', fechaFin: '2026-09-04' })]);
    expect(fechas(m)).toEqual(['2026-08-29', '2026-08-30', '2026-08-31']);
  });

  it('acota una que cubre el mes entero por los dos lados', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-06-01', fechaFin: '2026-10-31' })]);
    expect(m).toHaveLength(31);
    expect(m[0].fecha).toBe('2026-08-01');
    expect(m[30].fecha).toBe('2026-08-31');
  });

  it('pinta la que ocupa exactamente el primer día, y la del último', () => {
    const primero = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-01', fechaFin: '2026-08-01' })]);
    expect(fechas(primero)).toEqual(['2026-08-01']);
    const ultimo = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-31', fechaFin: '2026-08-31' })]);
    expect(fechas(ultimo)).toEqual(['2026-08-31']);
  });

  it('ignora una que termina antes del mes', () => {
    expect(marcasDelMes('2026-08', [aus({ fechaInicio: '2026-05-01', fechaFin: '2026-05-09' })])).toEqual([]);
  });

  it('ignora una que empieza después del mes', () => {
    expect(marcasDelMes('2026-08', [aus({ fechaInicio: '2026-10-01', fechaFin: '2026-10-05' })])).toEqual([]);
  });

  it('no produce ninguna marca para las rechazadas', () => {
    expect(marcasDelMes('2026-08', [aus({ estado: 'rechazada' })])).toEqual([]);
  });

  it('conserva el estado, para que la interfaz distinga lo pendiente', () => {
    const m = marcasDelMes('2026-08', [aus({ estado: 'pendiente' })]);
    expect(m).toHaveLength(3);
    expect(m.every((x) => x.estado === 'pendiente')).toBe(true);
  });

  it('lanza si una fecha viene corrupta, en vez de pintar cualquier cosa', () => {
    expect(() => marcasDelMes('2026-08', [aus({ fechaInicio: '10/08/2026' })])).toThrow();
    expect(() => marcasDelMes('2026-08', [aus({ fechaFin: '' })])).toThrow();
  });

  it('lanza también si la corrupta es una rechazada: se valida antes de filtrar', () => {
    // saldo.ts hace lo mismo a propósito, con el mismo razonamiento (ver su
    // comentario junto al bucle de validación): saltarse el `continue` de las
    // rechazadas antes de validar dejaría pasar en silencio una fecha corrupta
    // que nunca iba a pintar ningún día, y se perdería el diagnóstico.
    expect(() => marcasDelMes('2026-08', [aus({ estado: 'rechazada', fechaInicio: '10/08/2026' })])).toThrow();
  });

  it('una rechazada en medio de la lista no debe silenciar a los empleados siguientes', () => {
    // Motivación: cambiar el `continue` de las rechazadas por `break` sobrevive
    // a todos los demás tests de este fichero, porque todos pasan arrays de
    // una sola ausencia — con un elemento, `continue` y `break` son
    // indistinguibles. Con `break`, una sola rechazada en medio del array
    // dejaría en blanco a todo el resto del calendario, sin error ni log.
    const m = marcasDelMes('2026-08', [
      aus({ empleadoId: 'e1', fechaInicio: '2026-08-05', fechaFin: '2026-08-05' }),
      aus({ empleadoId: 'e2', estado: 'rechazada', fechaInicio: '2026-08-06', fechaFin: '2026-08-06' }),
      aus({ empleadoId: 'e3', fechaInicio: '2026-08-07', fechaFin: '2026-08-07' }),
    ]);
    expect(m.map((x) => x.empleadoId)).toEqual(['e1', 'e3']);
  });
});

describe('marcasDelMes — incapacidades', () => {
  it('las incapacidades se ven como cualquier otro tipo', () => {
    // Se enmascaraban antes, alegando privacidad. No servía: la celda
    // enmascarada solo aparecía en incapacidades, así que delataba justo lo que
    // pretendía tapar. Y el Google Calendar que publica n8n ya las nombra.
    const m = marcasDelMes('2026-08', [aus({ tipo: 'incapacidad', estado: 'registrada' })]);
    expect(m).toHaveLength(3);
    expect(m.every((x) => x.tipo === 'incapacidad')).toBe(true);
  });
});
