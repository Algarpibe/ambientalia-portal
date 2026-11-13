import { describe, it, expect } from 'vitest';
import {
  percentil,
  horasEntre,
  tiemposPorAprobador,
  pendientesPorAntiguedad,
  acumulacionExcesiva,
  descansoPorPersona,
  mesesDesde,
  absentismoPorMes,
  estacionalidadPorMes,
  resumenPorPersona,
  friccion,
  diasDesde,
  ventanaDeKpis,
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
  // Este bloque prueba el REPARTO en grupos, así que las dos señales de
  // planificación van en su valor neutro: aquí no deciden nada. Quien las
  // ejercita es «acumulacionExcesiva: las señales de planificación», más abajo.
  const f = (nombreCompleto: string, dias: number) => ({
    empleadoId: `id-${nombreCompleto}`,
    nombreCompleto,
    dias,
    diasSinVacaciones: null,
    diasProgramados: 0,
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
  // Los nombres salen de una tabla y no de una plantilla tipo `nombre-e1`:
  // este bloque prueba los DÍAS y los recuentos, pero varios de sus casos
  // afirman la lista de nombres entera, y un nombre de persona real se lee
  // mucho mejor ahí que un identificador.
  const NOMBRES: Record<string, string> = { e1: 'Ana Ruiz', e2: 'Beto Paz' };
  const i = (empleadoId: string, fechaInicio: string, fechaFin: string) => ({
    empleadoId,
    nombreCompleto: NOMBRES[empleadoId] ?? empleadoId,
    fechaInicio,
    fechaFin,
  });

  it('cuenta los días hábiles perdidos, los episodios y las personas de cada mes', () => {
    // Del lunes 7 al viernes 11 de septiembre de 2026: 5 hábiles.
    const r = absentismoPorMes([i('e1', '2026-09-07', '2026-09-11')], '2026-09', '2026-09');
    // `toEqual` con el objeto ENTERO y no `toMatchObject`: así un campo nuevo
    // que se colara sin querer pone el test rojo en vez de pasar inadvertido.
    expect(r.meses).toEqual([
      { mes: '2026-09', diasHabiles: 5, episodios: 1, personas: 1, nombres: ['Ana Ruiz'] },
    ]);
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
      { mes: '2026-09', diasHabiles: 3, episodios: 1, personas: 1, nombres: ['Ana Ruiz'] },
      { mes: '2026-10', diasHabiles: 2, episodios: 1, personas: 1, nombres: ['Ana Ruiz'] },
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
  // Este bloque prueba el reparto de DÍAS por mes y tipo, así que todas sus
  // ausencias son de la misma persona: los nombres los ejercita «los nombres
  // que viajan a los tooltips», más abajo.
  const a = (tipo: 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad', fechaInicio: string, fechaFin: string) => ({
    tipo,
    empleadoId: 'e1',
    nombreCompleto: 'Ana Ruiz',
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

describe('friccion', () => {
  const s = (
    estado: 'pendiente' | 'pendiente_2' | 'aprobada' | 'rechazada' | 'registrada',
    extra: { anulada?: boolean; cambioDeFechas?: boolean } = {},
  ) => ({
    estado,
    anulada: extra.anulada ?? false,
    cambioDeFechas: extra.cambioDeFechas ?? false,
  });

  it('CANDADO: distingue un RECHAZO de una ANULACIÓN, que comparten estado', () => {
    // Las dos viven en la base como `rechazada`; solo las separa `anulada_at`.
    // Y son cosas opuestas: una es «el jefe dijo que no» y la otra «el
    // solicitante cambió de idea». Sumarlas daría un indicador que no significa
    // nada, porque subir podría ser cualquiera de las dos.
    const r = friccion([
      s('rechazada'),
      s('rechazada', { anulada: true }),
      s('aprobada'),
      s('aprobada'),
    ]);
    expect(r.rechazadas).toBe(1);
    expect(r.anuladas).toBe(1);
    expect(r.decididas).toBe(4);
    expect(r.pctRechazo).toBe(25);
    expect(r.pctAnulacion).toBe(25);
  });

  it('CANDADO: las que siguen pendientes no entran ni arriba ni abajo', () => {
    // Una pedida ayer y aún sin firmar no puede haber sido rechazada: meterla
    // en el denominador hundiría el porcentaje por el simple hecho de que
    // alguien acabe de mandar una solicitud.
    const r = friccion([s('pendiente'), s('pendiente_2'), s('rechazada'), s('aprobada')]);
    expect(r.decididas).toBe(2);
    expect(r.pctRechazo).toBe(50);
  });

  it('cuenta las solicitudes con cambio de fechas, no los cambios', () => {
    // Una solicitud que cambió de fechas dos veces sigue siendo UNA solicitud
    // con fricción. Contar modificaciones daría porcentajes por encima de 100.
    const r = friccion([s('aprobada', { cambioDeFechas: true }), s('aprobada'), s('aprobada'), s('aprobada')]);
    expect(r.cambiosDeFecha).toBe(1);
    expect(r.pctCambioDeFecha).toBe(25);
  });

  it('una anulada que además había cambiado de fechas cuenta en las dos', () => {
    // No son categorías excluyentes y no deben serlo: son tres formas
    // distintas de fricción sobre la misma solicitud, y esconder una detrás de
    // la otra perdería información.
    const r = friccion([s('rechazada', { anulada: true, cambioDeFechas: true }), s('aprobada')]);
    expect(r.anuladas).toBe(1);
    expect(r.cambiosDeFecha).toBe(1);
  });

  it('las registradas cuentan como decididas: nadie tenía que firmarlas', () => {
    // Una incapacidad se informa y queda `registrada`. Es una solicitud
    // resuelta, así que pertenece al denominador; dejarla fuera inflaría el
    // porcentaje de rechazo de la compañía.
    const r = friccion([s('registrada'), s('registrada'), s('rechazada'), s('registrada')]);
    expect(r.decididas).toBe(4);
    expect(r.pctRechazo).toBe(25);
  });

  it('CANDADO: sin solicitudes decididas los porcentajes son null, no cero', () => {
    // Un 0% se lee como «no se rechaza nada, todo va bien». Con cero
    // solicitudes eso es mentira: no se sabe. Mismo criterio que `percentil`.
    const r = friccion([s('pendiente')]);
    expect(r.decididas).toBe(0);
    expect(r.pctRechazo).toBeNull();
    expect(r.pctAnulacion).toBeNull();
    expect(r.pctCambioDeFecha).toBeNull();
  });

  it('sin nada, todo a cero y los porcentajes en null', () => {
    const r = friccion([]);
    expect(r.decididas).toBe(0);
    expect(r.rechazadas).toBe(0);
    expect(r.pctRechazo).toBeNull();
  });

  it('redondea los porcentajes a un decimal', () => {
    // Un tercio da 33,333…%: arrastrarlo entero llenaría la pantalla de
    // decimales que no significan nada con esta muestra.
    const r = friccion([s('rechazada'), s('aprobada'), s('aprobada')]);
    expect(r.pctRechazo).toBe(33.3);
  });
});

describe('diasDesde', () => {
  it('cuenta los días naturales entre una fecha y hoy', () => {
    expect(diasDesde('2026-08-08', '2026-09-07')).toBe(30);
  });

  it('el mismo día es cero, no uno', () => {
    expect(diasDesde('2026-09-07', '2026-09-07')).toBe(0);
  });

  it('CANDADO: `null` cuando no hay fecha, y eso NO es cero', () => {
    // `null` significa «no ha disfrutado vacaciones NUNCA» —alguien que acaba
    // de entrar, o alguien que lleva años sin tomarlas—. Devolver 0 diría
    // «acaba de volver de vacaciones», que es exactamente lo contrario, y en
    // la lista de acumulación excesiva pintaría de tranquilo el peor caso.
    expect(diasDesde(null, '2026-09-07')).toBeNull();
  });

  it('son días de CALENDARIO, no hábiles', () => {
    // Aquí sí: la pregunta es «cuánto tiempo lleva sin desconectar», y el
    // descanso no se mide en jornadas laborables. Del viernes al lunes han
    // pasado 3 días de vida, no 1 de trabajo.
    expect(diasDesde('2026-09-04', '2026-09-07')).toBe(3);
  });
});

describe('acumulacionExcesiva: las señales de planificación', () => {
  const f = (
    nombreCompleto: string,
    dias: number,
    extra: { diasSinVacaciones?: number | null; diasProgramados?: number } = {},
  ) => ({
    empleadoId: `id-${nombreCompleto}`,
    nombreCompleto,
    dias,
    diasSinVacaciones: extra.diasSinVacaciones ?? null,
    diasProgramados: extra.diasProgramados ?? 0,
  });

  it('las dos señales viajan con la ficha hasta la pantalla', () => {
    const r = acumulacionExcesiva([f('Caro', 42, { diasSinVacaciones: 500, diasProgramados: 10 })], 15, 30);
    expect(r.alarma[0]).toMatchObject({
      nombreCompleto: 'Caro',
      dias: 42,
      diasSinVacaciones: 500,
      diasProgramados: 10,
    });
  });

  it('CANDADO: acumular mucho con un viaje ya reservado NO es lo mismo que acumular sin plan', () => {
    // El falso positivo que esta pareja de señales viene a matar. Los dos
    // acumulan 42 días y hoy la pantalla los pintaba idénticos, pero uno ya
    // tiene tres semanas pedidas y el otro no tiene nada: solo el segundo es
    // un caso sobre el que haya que hacer algo.
    const r = acumulacionExcesiva(
      [f('ConPlan', 42, { diasProgramados: 15 }), f('SinPlan', 42, { diasProgramados: 0 })],
      15,
      30,
    );
    expect(r.alarma).toHaveLength(2);
    expect(r.alarma.find((x) => x.nombreCompleto === 'ConPlan')?.diasProgramados).toBe(15);
    expect(r.alarma.find((x) => x.nombreCompleto === 'SinPlan')?.diasProgramados).toBe(0);
  });

  it('el orden sigue siendo por días acumulados, no por planificación', () => {
    // Las señales se pintan, no reordenan. Quien tiene más días sigue arriba:
    // cambiar el criterio de orden movería a la gente de sitio entre dos
    // visitas a la pantalla sin que nada lo explicara.
    const r = acumulacionExcesiva(
      [f('Menos', 31, { diasProgramados: 0 }), f('Mas', 42, { diasProgramados: 20 })],
      15,
      30,
    );
    expect(r.alarma.map((x) => x.nombreCompleto)).toEqual(['Mas', 'Menos']);
  });
});

describe('ventanaDeKpis', () => {
  const HOY = '2026-09-07';

  it('sin año, mira los N meses hacia atrás desde hoy', () => {
    expect(ventanaDeKpis(null, HOY, 12)).toEqual({ desde: '2025-09-01', hasta: '2026-09-07' });
  });

  it('con un año pasado, es el año natural completo', () => {
    expect(ventanaDeKpis(2025, HOY, 12)).toEqual({ desde: '2025-01-01', hasta: '2025-12-31' });
  });

  it('CANDADO: el año EN CURSO se corta en hoy, no en diciembre', () => {
    // Con diciembre, la serie del año actual arrastraría cuatro meses vacíos
    // detrás del último con datos, y una gráfica que baja a cero al final se
    // lee como un desplome, no como «esto todavía no ha pasado».
    expect(ventanaDeKpis(2026, HOY, 12)).toEqual({ desde: '2026-01-01', hasta: '2026-09-07' });
  });

  it('la ventana por defecto respeta los meses que se le pidan', () => {
    // La estacionalidad usa 24 y el resto 12: si este parámetro se ignorara,
    // las dos series pasarían a medir lo mismo sin que nada avisara.
    expect(ventanaDeKpis(null, HOY, 24)).toEqual({ desde: '2024-09-01', hasta: '2026-09-07' });
  });

  it('CANDADO: con año, los meses por defecto NO se aplican', () => {
    // El año manda sobre la ventana. Si se sumaran, pedir 2025 en la
    // estacionalidad devolvería dos años y el rótulo diría «2025».
    expect(ventanaDeKpis(2025, HOY, 24)).toEqual({ desde: '2025-01-01', hasta: '2025-12-31' });
  });

  it('el primer día del mes de la ventana por defecto, no el día suelto', () => {
    // Las series se agrupan por mes: empezar el día 7 dejaría el primer mes a
    // medias y su barra saldría más baja que la realidad.
    expect(ventanaDeKpis(null, '2026-03-15', 6).desde).toBe('2025-09-01');
  });
});

describe('los nombres que viajan a los tooltips', () => {
  const inc = (empleadoId: string, nombreCompleto: string, fechaInicio: string, fechaFin: string) => ({
    empleadoId,
    nombreCompleto,
    fechaInicio,
    fechaFin,
  });
  const au = (
    tipo: 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad',
    empleadoId: string,
    nombreCompleto: string,
    fechaInicio: string,
    fechaFin: string,
  ) => ({ tipo, empleadoId, nombreCompleto, fechaInicio, fechaFin });

  it('el absentismo lleva los nombres de quienes estuvieron incapacitados ese mes', () => {
    const r = absentismoPorMes(
      [inc('e1', 'Ana Ruiz', '2026-09-07', '2026-09-08'), inc('e2', 'Beto Paz', '2026-09-14', '2026-09-15')],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0].nombres).toEqual(['Ana Ruiz', 'Beto Paz']);
  });

  it('CANDADO: quien tiene DOS incapacidades en el mes sale UNA vez en la lista', () => {
    // La lista responde «quiénes», no «cuántos episodios». Repetir el nombre
    // haría parecer que hay el doble de gente enferma justo en el tooltip que
    // se abre para saber de quién se trata.
    const r = absentismoPorMes(
      [inc('e1', 'Ana Ruiz', '2026-09-07', '2026-09-08'), inc('e1', 'Ana Ruiz', '2026-09-21', '2026-09-22')],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0].nombres).toEqual(['Ana Ruiz']);
    // Y los dos recuentos siguen contando cada cosa: dos episodios, una persona.
    expect(r.meses[0]).toMatchObject({ episodios: 2, personas: 1 });
  });

  it('los nombres van ordenados alfabéticamente, no por orden de llegada', () => {
    // Las filas salen de la BD por fecha. Sin ordenar, el mismo mes cambiaría
    // el orden de los nombres en cuanto alguien registrara una ausencia vieja.
    const r = absentismoPorMes(
      [inc('e2', 'Zoe Vera', '2026-09-07', '2026-09-08'), inc('e1', 'Ana Ruiz', '2026-09-14', '2026-09-15')],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0].nombres).toEqual(['Ana Ruiz', 'Zoe Vera']);
  });

  it('CANDADO: dos personas DISTINTAS que se llaman igual salen las dos', () => {
    // Pasa en cualquier plantilla con dos «Juan Pérez». Agrupar por nombre en
    // vez de por id las fundiría en una sola, y el recuento de personas del mes
    // diría 1 donde hay 2 — con un nombre real detrás para dar credibilidad.
    const r = absentismoPorMes(
      [inc('e1', 'Juan Pérez', '2026-09-07', '2026-09-08'), inc('e2', 'Juan Pérez', '2026-09-14', '2026-09-15')],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0].personas).toBe(2);
    expect(r.meses[0].nombres).toEqual(['Juan Pérez', 'Juan Pérez']);
  });

  it('un mes sin incapacidades tiene la lista vacía, no ausente', () => {
    const r = absentismoPorMes([], '2026-09', '2026-09');
    expect(r.meses[0].nombres).toEqual([]);
  });

  it('la estacionalidad lleva los nombres por TIPO, que es como se lee el tooltip', () => {
    // El tooltip ya dice «vacaciones 21, permisos 1»: los nombres tienen que
    // poder colgar de cada tipo o no se sabría quién es de cuál.
    const r = estacionalidadPorMes(
      [
        au('vacaciones', 'e1', 'Ana Ruiz', '2026-09-07', '2026-09-08'),
        au('permiso', 'e2', 'Beto Paz', '2026-09-14', '2026-09-14'),
      ],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0].nombres).toEqual({
      vacaciones: ['Ana Ruiz'],
      permiso: ['Beto Paz'],
      compensatorio: [],
      incapacidad: [],
    });
  });

  it('CANDADO: la misma persona en dos tipos sale en los dos, sin repetirse dentro', () => {
    // Alguien que en septiembre tuvo vacaciones y además un permiso pertenece
    // a las dos listas: son dos hechos distintos, no un duplicado.
    const r = estacionalidadPorMes(
      [
        au('vacaciones', 'e1', 'Ana Ruiz', '2026-09-07', '2026-09-08'),
        au('vacaciones', 'e1', 'Ana Ruiz', '2026-09-21', '2026-09-22'),
        au('permiso', 'e1', 'Ana Ruiz', '2026-09-14', '2026-09-14'),
      ],
      '2026-09',
      '2026-09',
    );
    expect(r.meses[0].nombres.vacaciones).toEqual(['Ana Ruiz']);
    expect(r.meses[0].nombres.permiso).toEqual(['Ana Ruiz']);
  });

  it('CANDADO: una ausencia partida entre meses pone el nombre en LOS DOS', () => {
    // Estuvo fuera en septiembre y en octubre, así que en los dos tooltips
    // tiene que aparecer: es la misma regla que ya reparte sus días.
    const r = estacionalidadPorMes(
      [au('vacaciones', 'e1', 'Ana Ruiz', '2026-09-28', '2026-10-02')],
      '2026-09',
      '2026-10',
    );
    expect(r.meses[0].nombres.vacaciones).toEqual(['Ana Ruiz']);
    expect(r.meses[1].nombres.vacaciones).toEqual(['Ana Ruiz']);
  });
});

describe('resumenPorPersona', () => {
  const ANA = { empleadoId: 'e1', nombreCompleto: 'Ana Ruiz' };
  const BETO = { empleadoId: 'e2', nombreCompleto: 'Beto Díaz' };
  type Tipo = 'vacaciones' | 'permiso' | 'compensatorio' | 'incapacidad';
  const au = (
    tipo: Tipo,
    quien: { empleadoId: string; nombreCompleto: string },
    fechaInicio: string,
    fechaFin: string,
    horas: [string, string] | null = null,
  ) => ({ tipo, ...quien, fechaInicio, fechaFin, horaInicio: horas?.[0] ?? null, horaFin: horas?.[1] ?? null });
  const ANIO_2026: [string, string] = ['2026-01', '2026-12'];

  it('toda la plantilla activa sale, aunque no tenga nada, en orden alfabético', () => {
    const r = resumenPorPersona([], [BETO, ANA], ...ANIO_2026);
    expect(r.filas.map((f) => f.nombreCompleto)).toEqual(['Ana Ruiz', 'Beto Díaz']);
    expect(r.filas[0]).toEqual({
      ...ANA,
      deBaja: false,
      vacaciones: 0,
      permisoHoras: 0,
      permisoDias: 0,
      compensatorio: 0,
      incapacidad: 0,
    });
  });

  it('suma días laborables por tipo', () => {
    const r = resumenPorPersona(
      [
        au('vacaciones', ANA, '2026-09-07', '2026-09-11'), // lunes a viernes: 5
        au('compensatorio', ANA, '2026-09-14', '2026-09-14'), // 1
        au('incapacidad', ANA, '2026-09-15', '2026-09-16'), // 2
      ],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas[0]).toMatchObject({ vacaciones: 5, compensatorio: 1, incapacidad: 2 });
  });

  it('CANDADO: una ausencia a caballo entre dos años solo suma lo que cae dentro', () => {
    // Lunes 29 de diciembre de 2025 a viernes 2 de enero de 2026: del 29 al 31
    // caen en 2025, el 1 de enero es festivo y solo el 2 cuenta para 2026.
    const r = resumenPorPersona([au('vacaciones', ANA, '2025-12-29', '2026-01-02')], [ANA], ...ANIO_2026);
    expect(r.filas[0].vacaciones).toBe(1);
  });

  it('CANDADO: los permisos con hora suman horas y los de día completo, días aparte', () => {
    const r = resumenPorPersona(
      [
        au('permiso', ANA, '2026-09-01', '2026-09-01', ['09:00', '11:30']), // 2,5 h
        au('permiso', ANA, '2026-09-02', '2026-09-02', ['08:00', '09:15']), // 1,25 h
        au('permiso', ANA, '2026-09-03', '2026-09-03'), // jueves, día completo
      ],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas[0]).toMatchObject({ permisoHoras: 3.8, permisoDias: 1 });
  });

  it('un permiso con hora fuera del periodo no cuenta', () => {
    const r = resumenPorPersona([au('permiso', ANA, '2025-12-10', '2025-12-10', ['09:00', '10:00'])], [ANA], ...ANIO_2026);
    expect(r.filas[0].permisoHoras).toBe(0);
  });

  it('CANDADO: una ficha de baja sale solo si tuvo algo en el periodo, y marcada', () => {
    const ZOE = { empleadoId: 'e9', nombreCompleto: 'Zoe Baja' };
    const XAVI = { empleadoId: 'e8', nombreCompleto: 'Xavi Fuera' };
    const r = resumenPorPersona(
      [au('vacaciones', ZOE, '2026-03-02', '2026-03-02'), au('vacaciones', XAVI, '2025-03-03', '2025-03-03')],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas.map((f) => [f.nombreCompleto, f.deBaja])).toEqual([
      ['Ana Ruiz', false],
      ['Zoe Baja', true],
    ]);
  });

  it('el nombre de una ficha activa es el de la ficha, no el que traiga la ausencia', () => {
    const r = resumenPorPersona(
      [au('vacaciones', { empleadoId: 'e1', nombreCompleto: 'Ana R.' }, '2026-03-02', '2026-03-02')],
      [ANA],
      ...ANIO_2026,
    );
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ nombreCompleto: 'Ana Ruiz', vacaciones: 1 });
  });

  it('CANDADO: dos personas con el mismo nombre no se funden', () => {
    const OTRA_ANA = { empleadoId: 'e3', nombreCompleto: 'Ana Ruiz' };
    const r = resumenPorPersona([au('vacaciones', OTRA_ANA, '2026-03-02', '2026-03-02')], [ANA, OTRA_ANA], ...ANIO_2026);
    expect(r.filas).toHaveLength(2);
    expect(r.filas.find((f) => f.empleadoId === 'e3')?.vacaciones).toBe(1);
    expect(r.filas.find((f) => f.empleadoId === 'e1')?.vacaciones).toBe(0);
  });

  it('los totales suman las filas', () => {
    const r = resumenPorPersona(
      [
        au('vacaciones', ANA, '2026-09-07', '2026-09-08'), // 2
        au('vacaciones', BETO, '2026-09-09', '2026-09-09'), // 1
        au('permiso', BETO, '2026-09-10', '2026-09-10', ['10:00', '11:30']), // 1,5 h
        au('permiso', ANA, '2026-09-11', '2026-09-11'), // 1 d
        au('incapacidad', BETO, '2026-09-14', '2026-09-14'), // 1
        au('compensatorio', ANA, '2026-09-15', '2026-09-15'), // 1
      ],
      [ANA, BETO],
      ...ANIO_2026,
    );
    expect(r.total).toEqual({ vacaciones: 3, permisoHoras: 1.5, permisoDias: 1, compensatorio: 1, incapacidad: 1 });
  });

  it('el total suma las filas ya redondeadas, para que cuadre con lo que se ve', () => {
    // 1 h 15 son 1,25: redondear da 1,3 en cada fila y el total ha de ser 2,6
    // (la suma de lo pintado), no 2,5 (la suma de los valores sin redondear).
    const r = resumenPorPersona(
      [
        au('permiso', ANA, '2026-09-01', '2026-09-01', ['09:00', '10:15']),
        au('permiso', BETO, '2026-09-01', '2026-09-01', ['09:00', '10:15']),
      ],
      [ANA, BETO],
      ...ANIO_2026,
    );
    expect(r.filas.map((f) => f.permisoHoras)).toEqual([1.3, 1.3]);
    expect(r.total.permisoHoras).toBe(2.6);
  });

  it('un permiso con hora de una ficha de baja sale con sus horas y marcado', () => {
    const ZOE = { empleadoId: 'e9', nombreCompleto: 'Zoe Baja' };
    const r = resumenPorPersona([au('permiso', ZOE, '2026-03-02', '2026-03-02', ['09:00', '11:00'])], [ANA], ...ANIO_2026);
    expect(r.filas.find((f) => f.empleadoId === 'e9')).toMatchObject({ deBaja: true, permisoHoras: 2 });
  });

  it('CANDADO: una ficha de baja que acaba con todo a cero no sale, pero una activa sí', () => {
    const ZOE = { empleadoId: 'e9', nombreCompleto: 'Zoe Baja' };
    // 2026-09-13 es domingo: la incapacidad no suma ningún día laborable.
    const r = resumenPorPersona([au('incapacidad', ZOE, '2026-09-13', '2026-09-13')], [ANA], ...ANIO_2026);
    expect(r.filas.map((f) => f.nombreCompleto)).toEqual(['Ana Ruiz']);
  });
});

describe('descansoPorPersona', () => {
  const HOY = '2026-11-12';
  const ficha = (empleadoId: string, nombreCompleto: string, saldo = 10) => ({ empleadoId, nombreCompleto, saldo });
  const plan = (
    ultimasVacaciones: string | null,
    extra: { diasProgramados?: number; deVacacionesAhora?: boolean } = {},
  ) => ({ ultimasVacaciones, diasProgramados: 0, deVacacionesAhora: false, ...extra });
  type Plan = ReturnType<typeof plan>;
  const calcular = (fichas: ReturnType<typeof ficha>[], planes: [string, Plan][]) =>
    descansoPorPersona(fichas, new Map(planes), HOY, 6, 12);
  const tramoDe = (r: ReturnType<typeof calcular>, id: string) => r.filas.find((f) => f.empleadoId === id)?.tramo;

  it('mesesDesde: 365 días son 12 meses y 183 son 6', () => {
    expect(mesesDesde(365)).toBe(12);
    expect(mesesDesde(364)).toBe(11);
    expect(mesesDesde(183)).toBe(6);
    expect(mesesDesde(182)).toBe(5);
  });

  it('los cinco tramos', () => {
    const r = calcular(
      [ficha('n', 'Nunca'), ficha('a', 'Alarma'), ficha('v', 'Aviso'), ficha('o', 'Ok'), ficha('h', 'Ahora')],
      [
        ['n', plan(null)],
        ['a', plan('2025-11-12')], // 365 días
        ['v', plan('2026-05-13')], // 183 días
        ['o', plan('2026-05-14')], // 182 días
        ['h', plan('2026-01-10', { deVacacionesAhora: true })],
      ],
    );
    expect(['n', 'a', 'v', 'o', 'h'].map((id) => tramoDe(r, id))).toEqual(['nunca', 'alarma', 'aviso', 'ok', 'ahora']);
  });

  it('CANDADO: los bordes de 6 y 12 meses caen donde dice la etiqueta', () => {
    const r = calcular(
      [ficha('a', 'A'), ficha('b', 'B')],
      [
        ['a', plan('2025-11-13')], // 364 días → 11 meses → aviso
        ['b', plan('2025-11-12')], // 365 días → 12 meses → alarma
      ],
    );
    expect(r.filas.find((f) => f.empleadoId === 'a')).toMatchObject({ diasSinVacaciones: 364, mesesSinVacaciones: 11, tramo: 'aviso' });
    expect(r.filas.find((f) => f.empleadoId === 'b')).toMatchObject({ diasSinVacaciones: 365, mesesSinVacaciones: 12, tramo: 'alarma' });
  });

  it('CANDADO: quien está de vacaciones hoy es «ahora», aunque sus últimas terminadas sean viejas', () => {
    const r = calcular([ficha('h', 'Ahora')], [['h', plan('2024-01-10', { deVacacionesAhora: true })]]);
    expect(tramoDe(r, 'h')).toBe('ahora');
  });

  it('una ficha sin planificación es «nunca», sin nada pedido', () => {
    const r = calcular([ficha('x', 'Sin plan')], []);
    expect(r.filas[0]).toMatchObject({ tramo: 'nunca', diasSinVacaciones: null, mesesSinVacaciones: null, ultimoDia: null, diasProgramados: 0 });
  });

  it('orden: nunca primero, luego de más a menos días, «ahora» al final; empate por nombre', () => {
    const r = calcular(
      [ficha('h', 'Hugo'), ficha('o', 'Olga'), ficha('n', 'Nora'), ficha('b2', 'Beto'), ficha('b1', 'Ana')],
      [
        ['h', plan('2026-01-10', { deVacacionesAhora: true })],
        ['o', plan('2026-10-01')],
        ['n', plan(null)],
        ['b2', plan('2025-06-01')],
        ['b1', plan('2025-06-01')],
      ],
    );
    expect(r.filas.map((f) => f.nombreCompleto)).toEqual(['Nora', 'Ana', 'Beto', 'Olga', 'Hugo']);
  });

  it('CANDADO: los contadores meten «nunca» en alarma y «ahora» en ok', () => {
    const r = calcular(
      [ficha('n', 'N'), ficha('a', 'A'), ficha('v', 'V'), ficha('o', 'O'), ficha('h', 'H')],
      [
        ['n', plan(null)],
        ['a', plan('2025-01-01')],
        ['v', plan('2026-03-01')],
        ['o', plan('2026-10-01')],
        ['h', plan('2026-01-10', { deVacacionesAhora: true })],
      ],
    );
    expect(r.conteo).toEqual({ alarma: 2, aviso: 1, ok: 2 });
    expect(r).toMatchObject({ umbralAvisoMeses: 6, umbralAlarmaMeses: 12 });
  });

  it('lleva el saldo con un decimal, el último día y lo ya pedido', () => {
    const r = calcular([ficha('a', 'A', 28.76)], [['a', plan('2026-10-01', { diasProgramados: 15 })]]);
    expect(r.filas[0]).toMatchObject({ saldo: 28.8, ultimoDia: '2026-10-01', diasProgramados: 15, deVacacionesAhora: false });
  });
});
