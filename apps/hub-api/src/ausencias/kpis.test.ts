import { describe, it, expect } from 'vitest';
import {
  percentil,
  horasEntre,
  tiemposPorAprobador,
  pendientesPorAntiguedad,
  acumulacionExcesiva,
  absentismoPorMes,
  estacionalidadPorMes,
} from './kpis.js';

// El motor del panel de KPIs: aritmética pura, sin BD y sin Express. Lo que se
// prueba aquí es lo que un número mal calculado costaría en la pantalla que ve
// gerencia, así que los casos son los feos —listas vacías, una sola muestra,
// pares e impares— y no el camino feliz.

describe('percentil', () => {
  it('la mediana de una lista impar es el valor de en medio', () => {
    expect(percentil([1, 2, 3], 50)).toBe(2);
  });

  it('la mediana de una lista par interpola entre los dos centrales', () => {
    // 2 y 4 → 3. Coger «el de abajo» daría 2 y subestimaría el atasco.
    expect(percentil([1, 2, 4, 5], 50)).toBe(3);
  });

  it('ordena antes de calcular: el orden de llegada no es el de tamaño', () => {
    // Las decisiones salen de la BD ordenadas por fecha, no por duración. Sin
    // el sort, la «mediana» sería la de la solicitud que quedó en medio de la
    // tabla, que no significa nada.
    expect(percentil([5, 1, 4, 2], 50)).toBe(3);
  });

  it('el p90 interpola igual, y no se limita a coger el último', () => {
    // Diez valores 1..10: el p90 cae entre el 9 y el 10 → 9.1 con el método de
    // interpolación lineal (posición = p/100 * (n-1)).
    expect(percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1, 5);
  });

  it('con una sola muestra, cualquier percentil es esa muestra', () => {
    expect(percentil([7], 50)).toBe(7);
    expect(percentil([7], 90)).toBe(7);
  });

  it('una lista vacía devuelve null, no cero', () => {
    // CANDADO. Cero es un número legítimo en esta pantalla: significa «se firma
    // al instante». Devolverlo cuando no hay NINGUNA muestra pintaría el
    // aprobador más rápido de la compañía justo donde no hay datos.
    expect(percentil([], 50)).toBeNull();
  });
});

describe('horasEntre', () => {
  it('cuenta las horas entre dos instantes ISO', () => {
    expect(horasEntre('2026-09-01T08:00:00Z', '2026-09-01T14:30:00Z')).toBe(6.5);
  });

  it('cruza los días sin despeinarse', () => {
    expect(horasEntre('2026-09-01T22:00:00Z', '2026-09-03T10:00:00Z')).toBe(36);
  });

  it('es horas de reloj, NO horas hábiles, y eso es deliberado', () => {
    // Un viernes a las 17:00 firmado el lunes a las 09:00 son 64 horas de
    // reloj. Descontar noches y fines de semana daría un número más halagüeño
    // pero mentiría sobre lo que espera el solicitante, que es lo que este KPI
    // mide. Queda dicho aquí para que nadie lo «arregle» sin querer.
    expect(horasEntre('2026-09-04T17:00:00Z', '2026-09-07T09:00:00Z')).toBe(64);
  });
});

describe('tiemposPorAprobador', () => {
  const d = (aprobadorCorreo: string, createdAt: string, decididaAt: string | null) => ({
    aprobadorCorreo,
    createdAt,
    decididaAt,
  });

  it('agrupa por aprobador y da n, mediana y p90 de cada uno', () => {
    const filas = [
      d('jefe1@x.com', '2026-09-01T00:00:00Z', '2026-09-01T02:00:00Z'), // 2 h
      d('jefe1@x.com', '2026-09-01T00:00:00Z', '2026-09-01T04:00:00Z'), // 4 h
      d('jefe1@x.com', '2026-09-01T00:00:00Z', '2026-09-01T06:00:00Z'), // 6 h
      d('jefe2@x.com', '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'), // 24 h
    ];
    const r = tiemposPorAprobador(filas);

    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ aprobadorCorreo: 'jefe2@x.com', n: 1, medianaHoras: 24, p90Horas: 24 });
    expect(r[1]).toMatchObject({ aprobadorCorreo: 'jefe1@x.com', n: 3, medianaHoras: 4 });
  });

  it('ordena de más lento a más rápido: el atasco va primero', () => {
    // El panel se lee de arriba abajo y la pregunta que responde es «¿qué
    // bandeja está atascada?». Ordenar por nombre o por volumen enterraría la
    // respuesta en medio de la tabla.
    const filas = [
      d('rapido@x.com', '2026-09-01T00:00:00Z', '2026-09-01T01:00:00Z'),
      d('lento@x.com', '2026-09-01T00:00:00Z', '2026-09-05T00:00:00Z'),
      d('medio@x.com', '2026-09-01T00:00:00Z', '2026-09-01T12:00:00Z'),
    ];
    expect(tiemposPorAprobador(filas).map((x) => x.aprobadorCorreo)).toEqual([
      'lento@x.com',
      'medio@x.com',
      'rapido@x.com',
    ]);
  });

  it('CANDADO: las que aún no se han decidido no entran en el cálculo', () => {
    // Una pendiente no tiene `decidida_at`. Contarla como cero horas premiaría
    // justo al aprobador que no ha firmado nada, que es el reverso exacto de lo
    // que el KPI quiere señalar. Las pendientes las cuenta el otro KPI.
    const filas = [
      d('jefe1@x.com', '2026-09-01T00:00:00Z', '2026-09-01T10:00:00Z'),
      d('jefe1@x.com', '2026-09-01T00:00:00Z', null),
      d('jefe1@x.com', '2026-09-01T00:00:00Z', null),
    ];
    const r = tiemposPorAprobador(filas);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ n: 1, medianaHoras: 10, p90Horas: 10 });
  });

  it('un aprobador con TODAS sin decidir no aparece en la tabla', () => {
    const filas = [d('jefe1@x.com', '2026-09-01T00:00:00Z', null)];
    expect(tiemposPorAprobador(filas)).toEqual([]);
  });

  it('sin decisiones, tabla vacía', () => {
    expect(tiemposPorAprobador([])).toEqual([]);
  });

  it('el correo se agrupa sin distinguir mayúsculas', () => {
    // Los correos entran por el JWT y por la hoja de Google, y ninguno garantiza
    // la caja. Sin normalizar, un mismo jefe saldría en dos filas y las dos
    // medianas serían falsas.
    const filas = [
      d('Jefe1@x.com', '2026-09-01T00:00:00Z', '2026-09-01T02:00:00Z'),
      d('jefe1@x.com', '2026-09-01T00:00:00Z', '2026-09-01T04:00:00Z'),
    ];
    const r = tiemposPorAprobador(filas);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ aprobadorCorreo: 'jefe1@x.com', n: 2, medianaHoras: 3 });
  });
});

describe('pendientesPorAntiguedad', () => {
  const AHORA = '2026-09-07T12:00:00Z';
  const p = (createdAt: string) => ({ createdAt });

  it('reparte en los tres tramos: hasta 2 días, de 2 a 5, y más de 5', () => {
    const filas = [
      p('2026-09-07T00:00:00Z'), // 0,5 días
      p('2026-09-06T12:00:00Z'), // 1 día
      p('2026-09-04T12:00:00Z'), // 3 días
      p('2026-08-30T12:00:00Z'), // 8 días
      p('2026-08-01T12:00:00Z'), // 37 días
    ];
    expect(pendientesPorAntiguedad(filas, AHORA)).toEqual({
      total: 5,
      hasta2Dias: 2,
      de2a5Dias: 1,
      masDe5Dias: 2,
    });
  });

  it('CANDADO: los bordes caen en el tramo de arriba, y suman siempre el total', () => {
    // Exactamente 2 días y exactamente 5 días. Un `<` donde va un `<=` (o al
    // revés) mueve una solicitud de tramo sin que nada más cambie, y la única
    // señal sería que los tres tramos no cuadran con el total.
    const filas = [
      p('2026-09-05T12:00:00Z'), // 2 días clavados
      p('2026-09-02T12:00:00Z'), // 5 días clavados
    ];
    const r = pendientesPorAntiguedad(filas, AHORA);
    expect(r).toEqual({ total: 2, hasta2Dias: 1, de2a5Dias: 1, masDe5Dias: 0 });
    expect(r.hasta2Dias + r.de2a5Dias + r.masDe5Dias).toBe(r.total);
  });

  it('sin pendientes, todo a cero', () => {
    expect(pendientesPorAntiguedad([], AHORA)).toEqual({
      total: 0,
      hasta2Dias: 0,
      de2a5Dias: 0,
      masDe5Dias: 0,
    });
  });
});

describe('acumulacionExcesiva', () => {
  const f = (nombreCompleto: string, dias: number) => ({
    empleadoId: `id-${nombreCompleto}`,
    nombreCompleto,
    dias,
  });

  it('reparte en dos grupos EXCLUYENTES: aviso entre los umbrales, alarma por encima', () => {
    const r = acumulacionExcesiva(
      [f('Ana', 5), f('Beto', 18), f('Caro', 42), f('Dani', 31)],
      15,
      30,
    );
    // Ana no aparece en ninguno: no supera ni el aviso.
    expect(r.aviso.map((x) => x.nombreCompleto)).toEqual(['Beto']);
    expect(r.alarma.map((x) => x.nombreCompleto)).toEqual(['Caro', 'Dani']);
  });

  it('CANDADO: quien está en alarma NO se repite en aviso', () => {
    // Si los grupos no fueran excluyentes, el mismo nombre saldría en las dos
    // listas y la pantalla contaría dos veces a la misma persona. Es el mismo
    // error de tramos que vigila `pendientesPorAntiguedad`.
    const r = acumulacionExcesiva([f('Caro', 42)], 15, 30);
    expect(r.alarma).toHaveLength(1);
    expect(r.aviso).toEqual([]);
  });

  it('ordena de más a menos días: el peor caso va arriba', () => {
    const r = acumulacionExcesiva([f('Dani', 31), f('Caro', 42), f('Eva', 35)], 15, 30);
    expect(r.alarma.map((x) => x.nombreCompleto)).toEqual(['Caro', 'Eva', 'Dani']);
  });

  it('CANDADO: los bordes cuentan como alcanzados, no como fuera', () => {
    // Exactamente 15 y exactamente 30. Un `>` donde va un `>=` deja al de 30,0
    // clavados en el grupo suave, que es justo el que no hay que mirar con
    // prisa; y al de 15,0 fuera de todo. El devengo produce decimales (1,25 al
    // mes), así que caer clavado en el umbral es raro pero no imposible.
    const r = acumulacionExcesiva([f('Justo15', 15), f('Justo30', 30)], 15, 30);
    expect(r.aviso.map((x) => x.nombreCompleto)).toEqual(['Justo15']);
    expect(r.alarma.map((x) => x.nombreCompleto)).toEqual(['Justo30']);
  });

  it('devuelve los umbrales usados, para que la pantalla no los reinvente', () => {
    // La pantalla dice «más de 30 días» en el título. Si el número viviera
    // también en el front, cambiarlo aquí dejaría el rótulo mintiendo.
    const r = acumulacionExcesiva([], 15, 30);
    expect(r).toMatchObject({ umbralAviso: 15, umbralAlarma: 30 });
  });

  it('CANDADO: un saldo negativo no entra en ningún grupo', () => {
    // Pasa de verdad: quien pide más días de los que tiene queda en negativo
    // hasta que devenga. Es lo contrario de acumular, y colarlo aquí sería
    // señalar por acumulación excesiva justo a quien no acumula nada.
    const r = acumulacionExcesiva([f('Ana', -3)], 15, 30);
    expect(r.aviso).toEqual([]);
    expect(r.alarma).toEqual([]);
  });

  it('sin fichas, los dos grupos vacíos', () => {
    const r = acumulacionExcesiva([], 15, 30);
    expect(r.aviso).toEqual([]);
    expect(r.alarma).toEqual([]);
  });
});

describe('absentismoPorMes', () => {
  const i = (empleadoId: string, fechaInicio: string, fechaFin: string) => ({
    empleadoId,
    fechaInicio,
    fechaFin,
  });

  it('cuenta los días hábiles perdidos, los episodios y las personas de cada mes', () => {
    // Del lunes 7 al viernes 11 de septiembre de 2026: 5 hábiles.
    const r = absentismoPorMes([i('e1', '2026-09-07', '2026-09-11')], '2026-09', '2026-09');
    expect(r.meses).toEqual([{ mes: '2026-09', diasHabiles: 5, episodios: 1, personas: 1 }]);
    expect(r.totalDiasHabiles).toBe(5);
    expect(r.totalEpisodios).toBe(1);
  });

  it('CANDADO: descuenta el fin de semana, no cuenta días de calendario', () => {
    // Del viernes 4 al lunes 7 de septiembre de 2026 son 4 días de calendario
    // pero solo 2 hábiles. Contar calendario inflaría el absentismo de toda la
    // compañía en torno a un 40%, que es la diferencia entre 7 y 5 días.
    const r = absentismoPorMes([i('e1', '2026-09-04', '2026-09-07')], '2026-09', '2026-09');
    expect(r.totalDiasHabiles).toBe(2);
  });

  it('CANDADO: una incapacidad a caballo entre dos meses se REPARTE', () => {
    // Del lunes 28 de septiembre al viernes 2 de octubre de 2026. Imputarla
    // entera al mes de inicio dejaría a octubre en cero y cargaría a septiembre
    // días que nadie perdió en septiembre, justo en la serie que se mira para
    // ver tendencia.
    //   septiembre: 28, 29, 30 → 3 hábiles
    //   octubre:     1, 2      → 2 hábiles
    const r = absentismoPorMes([i('e1', '2026-09-28', '2026-10-02')], '2026-09', '2026-10');
    expect(r.meses).toEqual([
      { mes: '2026-09', diasHabiles: 3, episodios: 1, personas: 1 },
      { mes: '2026-10', diasHabiles: 2, episodios: 1, personas: 1 },
    ]);
    // El total NO duplica el episodio aunque aparezca en los dos meses: una
    // incapacidad partida sigue siendo UNA.
    expect(r.totalEpisodios).toBe(1);
    expect(r.totalDiasHabiles).toBe(5);
  });

  it('CANDADO: los meses sin ninguna incapacidad salen con cero, no se saltan', () => {
    // Si el mes vacío desapareciera de la serie, la gráfica uniría agosto con
    // octubre y pintaría una línea continua donde hubo un mes limpio. Es la
    // forma más fácil de leer una tendencia que no existe.
    const r = absentismoPorMes([i('e1', '2026-10-05', '2026-10-06')], '2026-08', '2026-10');
    expect(r.meses.map((m) => m.mes)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(r.meses[0]).toMatchObject({ diasHabiles: 0, episodios: 0, personas: 0 });
    expect(r.meses[1]).toMatchObject({ diasHabiles: 0, episodios: 0, personas: 0 });
  });

  it('cuenta PERSONAS DISTINTAS, no episodios, dentro de un mismo mes', () => {
    // Alguien con dos incapacidades en el mismo mes es una persona afectada y
    // dos episodios. Confundirlos haría parecer que hay el doble de gente
    // enferma de la que hay.
    const r = absentismoPorMes(
      [i('e1', '2026-09-07', '2026-09-08'), i('e1', '2026-09-21', '2026-09-22')],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0]).toMatchObject({ episodios: 2, personas: 1 });
  });

  it('dos personas distintas en el mismo mes suman dos', () => {
    const r = absentismoPorMes(
      [i('e1', '2026-09-07', '2026-09-08'), i('e2', '2026-09-07', '2026-09-08')],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0]).toMatchObject({ episodios: 2, personas: 2 });
  });

  it('CANDADO: lo que cae fuera de la ventana no se cuela', () => {
    // La ventana es la que la pantalla dice estar enseñando. Una incapacidad de
    // hace tres años sumada al total haría que el número no cuadrara con la
    // serie que se ve justo debajo.
    const r = absentismoPorMes(
      [i('e1', '2024-05-06', '2024-05-10'), i('e2', '2026-09-07', '2026-09-11')],
      '2026-09',
      '2026-09',
    );
    expect(r.totalDiasHabiles).toBe(5);
    expect(r.totalEpisodios).toBe(1);
  });

  it('una incapacidad que solo cae en fin de semana no suma días pero sí es un episodio', () => {
    // Sábado 5 y domingo 6 de septiembre de 2026. Pasó de verdad —alguien se
    // puso enfermo un sábado— y no costó ni un día de trabajo, pero borrarla
    // del recuento de episodios escondería que hubo una incapacidad.
    const r = absentismoPorMes([i('e1', '2026-09-05', '2026-09-06')], '2026-09', '2026-09');
    expect(r.meses[0]).toMatchObject({ diasHabiles: 0, episodios: 1, personas: 1 });
  });

  it('sin incapacidades, la serie sigue teniendo sus meses a cero', () => {
    const r = absentismoPorMes([], '2026-08', '2026-09');
    expect(r.meses).toHaveLength(2);
    expect(r.totalDiasHabiles).toBe(0);
    expect(r.totalEpisodios).toBe(0);
  });
});

describe('estacionalidadPorMes', () => {
  const a = (tipo: 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad', fechaInicio: string, fechaFin: string) => ({
    tipo,
    fechaInicio,
    fechaFin,
  });

  it('desglosa los días de ausencia por mes y por tipo', () => {
    // Lunes 7 a viernes 11 de septiembre de 2026: 5 hábiles.
    const r = estacionalidadPorMes(
      [a('vacaciones', '2026-09-07', '2026-09-11'), a('incapacidad', '2026-09-14', '2026-09-15')],
      '2026-09',
      '2026-09',
    );
    expect(r.meses).toHaveLength(1);
    expect(r.meses[0]).toMatchObject({
      mes: '2026-09',
      vacaciones: 5,
      permiso: 0,
      compensatorio: 0,
      incapacidad: 2,
      total: 7,
    });
  });

  it('CANDADO: el total de cada mes es la suma de sus cuatro tipos', () => {
    // La pantalla enseña las dos cosas —el total y el desglose apilado— y si no
    // cuadraran, la barra diría una cosa y la etiqueta otra.
    const r = estacionalidadPorMes(
      [
        a('vacaciones', '2026-09-07', '2026-09-08'),
        a('permiso', '2026-09-09', '2026-09-09'),
        a('compensatorio', '2026-09-10', '2026-09-10'),
        a('incapacidad', '2026-09-11', '2026-09-11'),
      ],
      '2026-09',
      '2026-09',
    );
    const m = r.meses[0];
    expect(m.vacaciones + m.permiso + m.compensatorio + m.incapacidad).toBe(m.total);
    expect(m.total).toBe(5);
  });

  it('CANDADO: una ausencia a caballo entre dos meses se REPARTE, igual que en absentismo', () => {
    // Lunes 28 de septiembre a viernes 2 de octubre de 2026:
    //   septiembre: 28, 29, 30 → 3 hábiles
    //   octubre:     1, 2      → 2 hábiles
    const r = estacionalidadPorMes([a('vacaciones', '2026-09-28', '2026-10-02')], '2026-09', '2026-10');
    expect(r.meses[0]).toMatchObject({ mes: '2026-09', vacaciones: 3 });
    expect(r.meses[1]).toMatchObject({ mes: '2026-10', vacaciones: 2 });
  });

  it('CANDADO: los meses sin ausencias salen con cero, no se saltan', () => {
    const r = estacionalidadPorMes([a('vacaciones', '2026-10-05', '2026-10-06')], '2026-08', '2026-10');
    expect(r.meses.map((m) => m.mes)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(r.meses[0]).toMatchObject({ total: 0, vacaciones: 0 });
  });

  it('CANDADO: los festivos colombianos no cuentan como días de ausencia', () => {
    // Del lunes 3 al viernes 7 de agosto de 2026 hay CUATRO hábiles, no cinco:
    // el viernes 7 es la Batalla de Boyacá (festivo fijo, ver `festivos.ts`).
    // La semana del 7 al 11 de septiembre sí tiene los cinco.
    //
    // Este caso entró aquí por equivocarse al escribirlo —se esperaban 10 y el
    // motor devolvió 9— y se queda porque el error es justo el que este KPI
    // tiene que evitar: cargar a la compañía un día de ausencia por una fecha
    // en la que nadie trabajaba.
    const r = estacionalidadPorMes(
      [a('vacaciones', '2026-08-03', '2026-08-07'), a('vacaciones', '2026-09-07', '2026-09-11')],
      '2026-08',
      '2026-09',
    );
    expect(r.meses[0].vacaciones).toBe(4); // agosto, con el festivo descontado
    expect(r.meses[1].vacaciones).toBe(5); // septiembre, semana completa
    expect(r.totalPorTipo.vacaciones).toBe(9);
    expect(r.total).toBe(9);
  });

  it('señala el mes más cargado, que es la pregunta que responde el KPI', () => {
    // «¿Cuándo se va todo el mundo?» se contesta mirando el pico. Dejar que lo
    // busque el ojo en doce barras es justo lo que el panel debería ahorrar.
    const r = estacionalidadPorMes(
      [a('vacaciones', '2026-08-03', '2026-08-07'), a('permiso', '2026-09-07', '2026-09-07')],
      '2026-08',
      '2026-09',
    );
    expect(r.mesPico).toBe('2026-08');
  });

  it('sin ausencias no hay mes pico: es null, no el primer mes', () => {
    // Devolver el primer mes de la serie señalaría un pico de cero días como si
    // fuera el momento de más ausencias del año.
    const r = estacionalidadPorMes([], '2026-08', '2026-09');
    expect(r.mesPico).toBeNull();
    expect(r.total).toBe(0);
  });

  it('lo que cae fuera de la ventana no suma al total', () => {
    const r = estacionalidadPorMes(
      [a('vacaciones', '2024-05-06', '2024-05-10'), a('vacaciones', '2026-09-07', '2026-09-11')],
      '2026-09',
      '2026-09',
    );
    expect(r.total).toBe(5);
  });
});
