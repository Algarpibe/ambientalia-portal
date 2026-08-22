import { describe, expect, it } from 'vitest';
import {
  diasDelAnio,
  diasDelMes,
  esAnioValido,
  esMesValido,
  franjasDelAnio,
  marcasDelMes,
  mesesDelAnio,
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

// ── La vista anual ─────────────────────────────────────────────────────────

describe('esAnioValido', () => {
  it('acepta cuatro dígitos', () => {
    expect(esAnioValido('2026')).toBe(true);
    expect(esAnioValido('1999')).toBe(true);
  });

  it('rechaza lo que no lo es, incluido el año con cero delante', () => {
    // El cero delante por lo mismo que en `esMesValido`: `Date.UTC(99, ...)`
    // mapea el 99 a 1999, y `mesesDelAnio('0099')` devolvería los meses de otro
    // año sin que nada fallara.
    for (const v of ['0099', '20260', '202', '2026-01', '', 'dos mil', ' 2026']) {
      expect(esAnioValido(v)).toBe(false);
    }
  });
});

describe('diasDelAnio', () => {
  it('365 en un año normal y 366 en uno bisiesto', () => {
    expect(diasDelAnio('2026')).toBe(365);
    expect(diasDelAnio('2028')).toBe(366);
  });

  it('CANDADO: la regla del siglo, no el `% 4` a secas', () => {
    // 1900 NO fue bisiesto y 2000 SÍ. Con `n % 4 === 0` pelado, 1900 daría 366 y
    // todas las barras a partir de marzo saldrían desplazadas un día — un
    // calendario ligeramente torcido que nadie sabe explicar. No son años que
    // esta app vaya a ver, y por eso mismo el candado: es la clase de rama que
    // nadie prueba a mano.
    expect(diasDelAnio('1900')).toBe(365);
    expect(diasDelAnio('2000')).toBe(366);
  });
});

describe('mesesDelAnio', () => {
  it('los doce, con sus días y su posición acumulada', () => {
    const m = mesesDelAnio('2026');
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ mes: '2026-01', desdeDia: 1, dias: 31 });
    expect(m[1]).toEqual({ mes: '2026-02', desdeDia: 32, dias: 28 });
    expect(m[11]).toEqual({ mes: '2026-12', desdeDia: 335, dias: 31 });
  });

  it('febrero de un bisiesto corre todo lo que viene detrás', () => {
    // Marzo arranca el 61 (31 de enero + 29 de febrero + 1) y no el 60 de un año
    // normal: es el desplazamiento que se lleva por delante las diez barras
    // siguientes si el bisiesto se cuenta mal.
    const m = mesesDelAnio('2028');
    expect(m[1]).toMatchObject({ desdeDia: 32, dias: 29 });
    expect(m[2].desdeDia).toBe(61);
    expect(mesesDelAnio('2026')[2].desdeDia).toBe(60);
  });

  it('CANDADO: los días suman exactamente el año, y no hay huecos entre meses', () => {
    // Las dos formas de que la franja quede torcida sin que nada falle: que los
    // anchos no sumen el 100% (la barra de diciembre se sale o se queda corta) y
    // que un mes no empiece donde acaba el anterior (todo lo posterior se
    // desplaza). Se comprueban en los dos años, normal y bisiesto.
    for (const anio of ['2026', '2028']) {
      const m = mesesDelAnio(anio);
      expect(m.reduce((n, x) => n + x.dias, 0)).toBe(diasDelAnio(anio));
      for (let i = 1; i < m.length; i++) {
        expect(m[i].desdeDia).toBe(m[i - 1].desdeDia + m[i - 1].dias);
      }
      expect(m[11].desdeDia + m[11].dias - 1).toBe(diasDelAnio(anio));
    }
  });
});

describe('franjasDelAnio', () => {
  it('convierte una ausencia en una barra con sus ordinales', () => {
    const [f] = franjasDelAnio('2026', [aus({ fechaInicio: '2026-01-01', fechaFin: '2026-01-03' })]);
    expect(f).toMatchObject({ desdeDia: 1, hastaDia: 3, fechaInicio: '2026-01-01', fechaFin: '2026-01-03' });
  });

  it('CANDADO: el ordinal cuenta desde el 1 de enero, no desde el 1 del mes', () => {
    // El 10 de agosto de 2026 es el día 222 del año. Con el offset calculado
    // desde el mes darían 10, y la barra se pintaría en enero.
    const [f] = franjasDelAnio('2026', [aus({ fechaInicio: '2026-08-10', fechaFin: '2026-08-12' })]);
    expect(f).toMatchObject({ desdeDia: 222, hastaDia: 224 });
  });

  it('CANDADO: el último día del año es el 365, no el 366', () => {
    // El error de un día en el borde: si `diaDelAnio` empezara en 0, la barra
    // del 31 de diciembre se saldría de la pista.
    const [f] = franjasDelAnio('2026', [aus({ fechaInicio: '2026-12-31', fechaFin: '2026-12-31' })]);
    expect(f).toMatchObject({ desdeDia: 365, hastaDia: 365 });
    expect(f.hastaDia).toBe(diasDelAnio('2026'));
  });

  it('CANDADO: una ausencia a caballo entre dos años se RECORTA, no se descarta', () => {
    // Mismo criterio que `marcasDelMes` con los meses: se pinta entera en los
    // dos años, cada uno con su trozo. Descartarla dejaría a alguien sin marcar
    // unas vacaciones de Navidad en ninguna de las dos vistas.
    const aCaballo = aus({ fechaInicio: '2025-12-28', fechaFin: '2026-01-05' });

    const [en2026] = franjasDelAnio('2026', [aCaballo]);
    expect(en2026).toMatchObject({ fechaInicio: '2026-01-01', fechaFin: '2026-01-05', desdeDia: 1, hastaDia: 5 });

    const [en2025] = franjasDelAnio('2025', [aCaballo]);
    expect(en2025).toMatchObject({ fechaInicio: '2025-12-28', fechaFin: '2025-12-31' });
    expect(en2025.hastaDia).toBe(diasDelAnio('2025'));
  });

  it('la que no toca el año pedido no sale', () => {
    expect(franjasDelAnio('2026', [aus({ fechaInicio: '2025-03-01', fechaFin: '2025-03-05' })])).toEqual([]);
  });

  it('CANDADO: la rechazada no se pinta; la registrada sí', () => {
    // Mismo par que en `marcasDelMes`. Una rechazada nunca llegó a ocurrir; una
    // incapacidad `registrada` es su estado terminal y esa persona está fuera.
    expect(franjasDelAnio('2026', [aus({ estado: 'rechazada' })])).toEqual([]);
    expect(franjasDelAnio('2026', [aus({ tipo: 'incapacidad', estado: 'registrada' })])).toHaveLength(1);
  });

  it('CANDADO: valida las fechas de TODAS, incluida la rechazada que no se iba a pintar', () => {
    // Mismo criterio que `marcasDelMes`: si el `continue` de la rechazada fuera
    // antes de validar, una fila con la fecha corrupta pasaría sin ruido. No
    // pintaría nada mal, pero se perdería el diagnóstico.
    expect(() => franjasDelAnio('2026', [aus({ estado: 'rechazada', fechaFin: 'no-es-fecha' })])).toThrow(
      /fechaFin inválida/,
    );
  });

  it('conserva el tipo y el estado, que es lo que decide el color y la opacidad', () => {
    const [f] = franjasDelAnio('2026', [aus({ tipo: 'permiso', estado: 'pendiente_2' })]);
    expect(f).toMatchObject({ tipo: 'permiso', estado: 'pendiente_2' });
  });
});
