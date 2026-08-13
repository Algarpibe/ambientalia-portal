import { describe, expect, it } from 'vitest';
import {
  diasDelMes,
  esMesValido,
  marcasDelMes,
  rangoDelMes,
  type AusenciaRango,
} from './calendario.js';

const YO = { email: 'ana.ruiz@ambientalia.com.co', esAdmin: false };
const OTRO = { email: 'otro@ambientalia.com.co', esAdmin: false };
const JEFE = { email: 'jefe@ambientalia.com.co', esAdmin: false };
const ADMIN = { email: 'admin@ambientalia.com.co', esAdmin: true };

/** Una ausencia de Ana, cuyo aprobador es `jefe@`. */
function aus(over: Partial<AusenciaRango> = {}): AusenciaRango {
  return {
    empleadoId: 'e1',
    empleadoCorreo: 'ana.ruiz@ambientalia.com.co',
    aprobadorCorreo: 'jefe@ambientalia.com.co',
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
});

describe('marcasDelMes — expansión', () => {
  it('expande una ausencia enteramente dentro del mes', () => {
    const m = marcasDelMes('2026-08', [aus()], YO);
    expect(fechas(m)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('acota una que empieza el mes anterior', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-07-28', fechaFin: '2026-08-03' })], YO);
    expect(fechas(m)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('acota una que acaba el mes siguiente', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-29', fechaFin: '2026-09-04' })], YO);
    expect(fechas(m)).toEqual(['2026-08-29', '2026-08-30', '2026-08-31']);
  });

  it('acota una que cubre el mes entero por los dos lados', () => {
    const m = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-06-01', fechaFin: '2026-10-31' })], YO);
    expect(m).toHaveLength(31);
    expect(m[0].fecha).toBe('2026-08-01');
    expect(m[30].fecha).toBe('2026-08-31');
  });

  it('pinta la que ocupa exactamente el primer día, y la del último', () => {
    const primero = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-01', fechaFin: '2026-08-01' })], YO);
    expect(fechas(primero)).toEqual(['2026-08-01']);
    const ultimo = marcasDelMes('2026-08', [aus({ fechaInicio: '2026-08-31', fechaFin: '2026-08-31' })], YO);
    expect(fechas(ultimo)).toEqual(['2026-08-31']);
  });

  it('ignora una que no toca el mes', () => {
    expect(marcasDelMes('2026-08', [aus({ fechaInicio: '2026-05-01', fechaFin: '2026-05-09' })], YO)).toEqual([]);
  });

  it('no produce ninguna marca para las rechazadas', () => {
    expect(marcasDelMes('2026-08', [aus({ estado: 'rechazada' })], YO)).toEqual([]);
  });

  it('conserva el estado, para que la interfaz distinga lo pendiente', () => {
    const m = marcasDelMes('2026-08', [aus({ estado: 'pendiente' })], YO);
    expect(m.every((x) => x.estado === 'pendiente')).toBe(true);
  });

  it('lanza si una fecha viene corrupta, en vez de pintar cualquier cosa', () => {
    expect(() => marcasDelMes('2026-08', [aus({ fechaInicio: '10/08/2026' })], YO)).toThrow();
    expect(() => marcasDelMes('2026-08', [aus({ fechaFin: '' })], YO)).toThrow();
  });
});

describe('marcasDelMes — enmascarado de las incapacidades', () => {
  const incapacidad = aus({ tipo: 'incapacidad', estado: 'registrada' });

  it('el interesado ve su propio tipo', () => {
    expect(marcasDelMes('2026-08', [incapacidad], YO)[0].tipo).toBe('incapacidad');
  });

  it('su aprobador lo ve', () => {
    expect(marcasDelMes('2026-08', [incapacidad], JEFE)[0].tipo).toBe('incapacidad');
  });

  it('un admin lo ve', () => {
    expect(marcasDelMes('2026-08', [incapacidad], ADMIN)[0].tipo).toBe('incapacidad');
  });

  it('un tercero NO lo ve: recibe null, no el tipo', () => {
    const m = marcasDelMes('2026-08', [incapacidad], OTRO);
    expect(m[0].tipo).toBeNull();
    // Sigue sabiendo que está ausente y qué días: se oculta el motivo, no la ausencia.
    expect(m).toHaveLength(3);
  });

  it('compara los correos sin distinguir mayúsculas', () => {
    const mayus = { email: 'JEFE@AMBIENTALIA.COM.CO', esAdmin: false };
    expect(marcasDelMes('2026-08', [incapacidad], mayus)[0].tipo).toBe('incapacidad');
  });

  it('no enmascara los otros tres tipos para nadie', () => {
    for (const tipo of ['vacaciones', 'permiso', 'compensatorio'] as const) {
      expect(marcasDelMes('2026-08', [aus({ tipo })], OTRO)[0].tipo).toBe(tipo);
    }
  });
});
