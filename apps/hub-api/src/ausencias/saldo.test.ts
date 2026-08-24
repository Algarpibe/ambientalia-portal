import { describe, expect, it } from 'vitest';
import { calcularSaldo, calcularSaldoCompensatorios, hoyEnColombia, pedible, type AusenciaParaElSaldo } from './saldo.js';
import { hoyCongelado } from './service.js';

const CONFIG = { saldoCorte: 10, fechaCorte: '2026-01-01' };

/**
 * En las ausencias `createdAt` da igual —solo lo miran los otorgamientos— pero
 * tiene que ser una fecha válida: se valida para TODAS las filas, a propósito.
 * Se pone igual que el inicio, que es lo más parecido a la realidad.
 */
/** Una vacación aprobada de `dias` días que empieza el `inicio`. */
function vac(inicio: string, dias: number, estado: AusenciaParaElSaldo['estado'] = 'aprobada'): AusenciaParaElSaldo {
  return { tipo: 'vacaciones', fechaInicio: inicio, diasHabiles: dias, estado, createdAt: inicio };
}

/** Un compensatorio aprobado de `dias` días que empieza el `inicio`. */
function comp(inicio: string, dias: number, estado: AusenciaParaElSaldo['estado'] = 'aprobada'): AusenciaParaElSaldo {
  return { tipo: 'compensatorio', fechaInicio: inicio, diasHabiles: dias, estado, createdAt: inicio };
}

/**
 * Un otorgamiento aprobado de `dias` días concedidos.
 *
 * Las dos fechas van SEPARADAS a propósito y son lo que este tipo tiene de
 * particular: `trabajo` es el día que se trabajó de más —en el pasado— y `pedido`
 * es cuándo se solicitó, que es lo único que el saldo mira.
 */
function otorg(
  trabajo: string,
  pedido: string,
  dias: number,
  estado: AusenciaParaElSaldo['estado'] = 'aprobada',
): AusenciaParaElSaldo {
  return { tipo: 'otorgamiento', fechaInicio: trabajo, diasHabiles: dias, estado, createdAt: pedido };
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

  it('ignora permisos, compensatorios, incapacidades y otorgamientos', () => {
    const otros: AusenciaParaElSaldo[] = [
      { tipo: 'permiso', fechaInicio: '2026-02-01', diasHabiles: 3, estado: 'aprobada', createdAt: '2026-02-01' },
      { tipo: 'compensatorio', fechaInicio: '2026-02-01', diasHabiles: 2, estado: 'aprobada', createdAt: '2026-02-01' },
      { tipo: 'incapacidad', fechaInicio: '2026-02-01', diasHabiles: 4, estado: 'registrada', createdAt: '2026-02-01' },
      // El otorgamiento SUMA, así que si esta bolsa lo viera no daría 10 de más:
      // daría 12, y nadie miraría dos veces un saldo que ha subido.
      { tipo: 'otorgamiento', fechaInicio: '2026-02-01', diasHabiles: 2, estado: 'aprobada', createdAt: '2026-02-01' },
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

describe('calcularSaldoCompensatorios', () => {
  it('descuenta los aprobados desde el corte', () => {
    const s = calcularSaldoCompensatorios(CONFIG, [comp('2026-02-01', 3)], '2026-03-02');
    expect(s.disfrutadas).toBe(3);
    expect(s.disponible).toBe(7);
  });

  it('ignora vacaciones, permisos e incapacidades', () => {
    // El ESPEJO del candado de `calcularSaldo`, y hace falta que estén los dos.
    // Aquel fija que la bolsa de vacaciones no ve los compensatorios; éste, que
    // la de compensatorios no ve las vacaciones. Ahora que el repo se trae los
    // dos tipos en la MISMA consulta, un filtro de tipo olvidado aquí se comería
    // las vacaciones de todo el mundo — y el candado viejo seguiría verde,
    // porque solo mira su bolsa.
    const otros: AusenciaParaElSaldo[] = [
      { tipo: 'vacaciones', fechaInicio: '2026-02-01', diasHabiles: 5, estado: 'aprobada', createdAt: '2026-02-01' },
      { tipo: 'permiso', fechaInicio: '2026-02-01', diasHabiles: 3, estado: 'aprobada', createdAt: '2026-02-01' },
      { tipo: 'incapacidad', fechaInicio: '2026-02-01', diasHabiles: 4, estado: 'registrada', createdAt: '2026-02-01' },
    ];
    const s = calcularSaldoCompensatorios(CONFIG, otros, '2026-03-02');
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('un otorgamiento aprobado SUMA a la bolsa', () => {
    const s = calcularSaldoCompensatorios(CONFIG, [otorg('2026-02-14', '2026-02-16', 2)], '2026-03-02');
    expect(s.otorgados).toBe(2);
    expect(s.disponible).toBe(12);
  });

  it('CANDADO: el otorgamiento se cuenta por cuándo se PIDIÓ, no por el día trabajado', () => {
    // El caso que mata: se trabajó un sábado ANTERIOR al corte y se pidió
    // DESPUÉS. Filtrando por `fechaInicio` —que es lo natural, porque es lo que
    // hacen los otros dos términos— `'2025-12-20' >= '2026-01-01'` es false y el
    // día concedido no contaría nunca: sin error, sin aviso, y con el empleado
    // viendo que su bolsa no sube.
    //
    // Un test escrito con el trabajo POSTERIOR al corte pasaría con las dos
    // implementaciones y no probaría nada.
    const s = calcularSaldoCompensatorios(CONFIG, [otorg('2025-12-20', '2026-02-16', 2)], '2026-03-02');
    expect(s.otorgados).toBe(2);
    expect(s.disponible).toBe(12);
  });

  it('un otorgamiento PEDIDO antes del corte no se cuenta: ya estaba en el número', () => {
    // La otra mitad de la regla. Sin ella, «no filtrar nunca» pasaría el candado
    // de arriba, y re-sembrar el corte contaría dos veces todo lo ya concedido.
    const s = calcularSaldoCompensatorios(CONFIG, [otorg('2025-12-20', '2025-12-22', 2)], '2026-03-02');
    expect(s.otorgados).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('un otorgamiento a medio firmar no concede nada', () => {
    // Ni siquiera a `enTramite`: sumar días que aún no existen animaría a
    // gastarlos, y el bloqueo por bolsa insuficiente los dejaría pasar.
    const s = calcularSaldoCompensatorios(CONFIG, [otorg('2026-02-14', '2026-02-16', 2, 'pendiente')], '2026-03-02');
    expect(s.otorgados).toBe(0);
    expect(s.enTramite).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('un otorgamiento anulado devuelve los días, y la bolsa puede quedar en negativo', () => {
    // Anular deja la fila en `rechazada` (ver `aplicarALaSolicitud`), así que sale
    // de `['aprobada']` sin código nuevo. Si los días ya se gastaron, el
    // resultado es negativo — que es lo decidido, y lo que ya hace la otra bolsa.
    const s = calcularSaldoCompensatorios(
      { saldoCorte: 0, fechaCorte: '2026-01-01' },
      [otorg('2026-02-14', '2026-02-16', 3, 'rechazada'), comp('2026-02-20', 3)],
      '2026-03-02',
    );
    expect(s.otorgados).toBe(0);
    expect(s.disponible).toBe(-3);
  });

  it('lanza si createdAt viene mal formado', () => {
    // Entra en la misma comparación `>=` que `fechaInicio`, así que falla igual
    // de silenciosamente: un Date se compara contra NaN y no cuenta jamás.
    expect(() => calcularSaldoCompensatorios(CONFIG, [otorg('2026-02-14', '16/02/2026', 2)], '2026-03-02')).toThrow();
  });

  it('NO devenga con el tiempo: un año después el saldo es el mismo', () => {
    // La decisión de negocio que separa esta bolsa de la otra. Un compensatorio
    // se gana por horas o días extra y hay que otorgarlo; no aparece solo. Sin
    // este candado, un refactor que unificara las dos fórmulas parametrizando la
    // tasa podría encender el devengo aquí sin que nada se pusiera rojo.
    const alDia = calcularSaldoCompensatorios(CONFIG, [], '2026-01-01');
    const unAnioDespues = calcularSaldoCompensatorios(CONFIG, [], '2027-01-01');
    expect(alDia.disponible).toBe(10);
    expect(unAnioDespues.disponible).toBe(10);
  });

  it('el que empieza el día del corte cuenta; el de la víspera, no', () => {
    const enElCorte = calcularSaldoCompensatorios(CONFIG, [comp('2026-01-01', 2)], '2026-03-02');
    expect(enElCorte.disfrutadas).toBe(2);
    const antes = calcularSaldoCompensatorios(CONFIG, [comp('2025-12-31', 2)], '2026-03-02');
    expect(antes.disfrutadas).toBe(0);
  });

  it('pendiente y pendiente_2 van a enTramite y NO bajan el disponible', () => {
    // Media firma no descuenta, igual que en vacaciones: son días que todavía no
    // han ocurrido y que quien firma aún puede rechazar.
    const s = calcularSaldoCompensatorios(
      CONFIG,
      [comp('2026-02-01', 2, 'pendiente'), comp('2026-02-10', 3, 'pendiente_2')],
      '2026-03-02',
    );
    expect(s.enTramite).toBe(5);
    expect(s.disfrutadas).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('una rechazada no descuenta ni suma a enTramite', () => {
    const s = calcularSaldoCompensatorios(CONFIG, [comp('2026-02-01', 3, 'rechazada')], '2026-03-02');
    expect(s.disfrutadas).toBe(0);
    expect(s.enTramite).toBe(0);
    expect(s.disponible).toBe(10);
  });

  it('admite medios días', () => {
    const s = calcularSaldoCompensatorios(CONFIG, [comp('2026-02-01', 0.5)], '2026-03-02');
    expect(s.disponible).toBe(9.5);
  });

  it('el disponible puede quedar en negativo y NO se recorta a cero', () => {
    // Alcanzable de verdad: basta que un admin baje el saldo de corte después de
    // haber aprobado días. Enseñar un 0 donde hay un −2 escondería justo el caso
    // que administración necesita ver.
    const s = calcularSaldoCompensatorios(CONFIG, [comp('2026-02-01', 12)], '2026-03-02');
    expect(s.disponible).toBe(-2);
  });

  it('devuelve configurado:false y ceros si al empleado le falta la configuración', () => {
    const s = calcularSaldoCompensatorios(null, [comp('2026-02-01', 5)], '2026-03-02');
    expect(s.configurado).toBe(false);
    expect(s.disponible).toBe(0);
  });

  it('SIN_CONFIGURAR no es un objeto compartido: mutar una respuesta no afecta a la siguiente', () => {
    const s1 = calcularSaldoCompensatorios(null, [], '2026-03-02');
    (s1 as { disponible: number }).disponible = 999;
    const s2 = calcularSaldoCompensatorios(null, [], '2026-03-02');
    expect(s2.disponible).toBe(0);
  });

  it('lanza con "hoy" o fechaCorte mal formados, en vez de devolver un saldo en blanco', () => {
    expect(() => calcularSaldoCompensatorios(CONFIG, [], '01-01-2026')).toThrow();
    expect(() => calcularSaldoCompensatorios({ saldoCorte: 10, fechaCorte: '2026/01/01' }, [], '2026-01-01')).toThrow();
  });

  it('lanza si fechaInicio viene en dd/mm/aaaa o como objeto Date', () => {
    // Repetido a propósito respecto a la bolsa de vacaciones: estos cuatro casos
    // son el candado de que `sumarDesdeElCorte` sigue COMPARTIDO. Si alguien
    // deshace la extracción y copia el recuento en las dos funciones, esta mitad
    // es la que caza que a la copia le falte la validación.
    expect(() => calcularSaldoCompensatorios(CONFIG, [comp('2026-02-01', 3), comp('01/02/2026', 5)], '2026-03-02')).toThrow();
    const conFechaDate = [
      comp('2026-02-01', 3),
      { ...comp('2026-02-01', 5), fechaInicio: new Date('2026-02-01T00:00:00Z') as unknown as string },
    ];
    expect(() => calcularSaldoCompensatorios(CONFIG, conFechaDate, '2026-03-02')).toThrow();
  });
});

describe('pedible', () => {
  it('redondea la resta a la décima que se enseña', () => {
    // 10,4 − 6,5 en binario da 3.9000000000000004. Comparado contra los días de
    // una solicitud, ese ruido decide bloqueos justo en el borde en el que la
    // pantalla dice «te falta 0». Servidor y cliente tienen que redondear igual.
    expect(pedible({ disponible: 10.4, enTramite: 6.5 })).toBe(3.9);
  });

  it('sirve igual para las dos bolsas', () => {
    // Toma la forma y no el tipo a propósito: una sola regla para vacaciones y
    // compensatorios, que es lo que impide que las dos discrepen.
    const vacaciones = calcularSaldo(CONFIG, [vac('2026-02-01', 2, 'pendiente')], '2026-01-01');
    const compensatorios = calcularSaldoCompensatorios(CONFIG, [comp('2026-02-01', 2, 'pendiente')], '2026-01-01');
    expect(pedible(vacaciones)).toBe(8);
    expect(pedible(compensatorios)).toBe(8);
  });

  it('puede quedar en negativo: no hay suelo', () => {
    expect(pedible({ disponible: 1, enTramite: 4 })).toBe(-3);
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

describe('hoyCongelado — el devengo se para en el último día trabajado', () => {
  it('sin fecha de retiro, devuelve hoy tal cual', () => {
    expect(hoyCongelado(null, '2026-08-24')).toBe('2026-08-24');
  });

  it('con la fecha ya pasada, devuelve la fecha de retiro', () => {
    expect(hoyCongelado('2026-03-15', '2026-08-24')).toBe('2026-03-15');
  });

  it('CANDADO: el DÍA del retiro todavía cuenta entero', () => {
    // La fecha es el ÚLTIMO DÍA QUE TRABAJA. Devolver la fecha aquí en vez de
    // hoy da el mismo número, pero el candado importa por su gemelo del
    // barrido: si alguien cambia esto a `<=` para "simplificar", le recorta un
    // día de devengo a alguien sobre un número que se paga.
    expect(hoyCongelado('2026-08-24', '2026-08-24')).toBe('2026-08-24');
  });

  it('con la fecha en el futuro, sigue devengando: devuelve hoy', () => {
    expect(hoyCongelado('2026-12-31', '2026-08-24')).toBe('2026-08-24');
  });
});
