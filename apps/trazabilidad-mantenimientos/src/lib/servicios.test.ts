import { describe, it, expect } from 'vitest';
import { ESTADOS_PLAZO, ROLES_ESTADO, claveTipoServicio, estadoPlazo, type EstadoDesk, type PlazoServicio, type ServicioVista, type TipoServicioOpcion } from '../dominio';
import {
  GRUPOS_PLAZO,
  OPCIONES_ROL,
  TITULO_STANDBY,
  TONO_PLAZO,
  alternarGrupo,
  avisoRol,
  avisoSinTipo,
  barraServicio,
  contarGrupo,
  contarPlazos,
  contarStandby,
  etiquetaTipoDesk,
  filtrarServicios,
  grupoElegido,
  leyendaServicios,
  notaDerivado,
  notaEstadoDesk,
  type FiltroServicios,
  notaTipo,
  pausasBarra,
  segmentosBarra,
  selectorTipo,
  diasDelEje,
  ejeServicios,
  mesesDelEje,
  porUrgenciaPlazo,
  resumenServicios,
  textoPlazo,
  textoTramos,
  tituloFechaLimite,
  tituloGrupo,
  tituloSegmento,
  tituloStandby,
  tituloTerminado,
} from './servicios';

const HOY = '2026-10-06';
let n = 1000;

/** Un servicio de mentira: el plazo llega calculado del servidor, aquí se pone a mano. */
function sv(ingreso: string | null, fechaLimite: string | null, extra: Partial<ServicioVista> = {}): ServicioVista {
  return {
    numero: ++n,
    asunto: 'Servicio Técnico Cliente Uno',
    cliente: 'Cliente Uno',
    clienteOrigen: 'cuenta',
    clienteDeAsunto: false,
    serial: '18A00001',
    modelo: 'EDM180C',
    tipoServicio: fechaLimite ? 'Diagnóstico' : '',
    estado: 'En diagnóstico',
    rolEstado: 'cuenta',
    enPausa: false,
    diasPausados: 0,
    pausas: [],
    terminadoEl: null,
    medidoDesde: null,
    ingreso,
    plazoDias: fechaLimite ? 3 : null,
    fechaLimite,
    fechaLimiteBase: fechaLimite,
    diasHabiles: fechaLimite ? 0 : null,
    estadoPlazo: estadoPlazo(fechaLimite, HOY),
    tramos: null,
    sinConfirmar: false,
    tipoOrigen: fechaLimite ? 'desk' : null,
    tipoDesk: fechaLimite ? 'Diagnóstico' : '',
    tipoManual: null,
    ...extra,
  };
}

/** Los campos de un servicio con el tipo puesto a mano (y Desk sin tipo). */
function manual(etiqueta: string): Partial<ServicioVista> {
  return {
    tipoServicio: etiqueta,
    tipoOrigen: 'manual',
    tipoDesk: '',
    tipoManual: { clave: claveTipoServicio(etiqueta), por: 'st@ambientalia.com.co', en: '2026-10-06 09:15:00.123456-05' },
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
    expect(barraServicio(sv('2026-10-05', '2026-10-08'), eje, HOY)).toEqual({ plazo: { desde: 5, hasta: 8 }, atraso: null, recortada: false, terminado: null });
  });

  it('vence hoy: la barra acaba en la columna de hoy y no hay atraso', () => {
    expect(barraServicio(sv('2026-10-01', '2026-10-06'), eje, HOY)).toEqual({ plazo: { desde: 1, hasta: 6 }, atraso: null, recortada: false, terminado: null });
  });

  it('vencido: el atraso sigue desde el día siguiente al límite hasta hoy', () => {
    expect(barraServicio(sv('2026-09-30', '2026-10-02'), eje, HOY)).toEqual({ plazo: { desde: 0, hasta: 2 }, atraso: { desde: 3, hasta: 6 }, recortada: false, terminado: null });
  });

  it('un ingreso anterior al eje se recorta por la izquierda y se avisa', () => {
    expect(barraServicio(sv('2026-09-20', '2026-10-02'), eje, HOY)).toEqual({ plazo: { desde: 0, hasta: 2 }, atraso: { desde: 3, hasta: 6 }, recortada: true, terminado: null });
  });

  it('si hasta el límite cae antes del eje, sólo queda el atraso', () => {
    expect(barraServicio(sv('2025-01-10', '2025-01-15'), eje, HOY)).toEqual({ plazo: null, atraso: { desde: 0, hasta: 6 }, recortada: true, terminado: null });
  });
});

describe('barra en dos tramos (tipo compuesto «Diagnóstico + Calibración»)', () => {
  const eje = { inicio: '2026-09-30', fin: '2026-10-18', dias: 19 };
  /** Un servicio del tipo compuesto: los tramos llegan calculados del servidor (días hábiles incluidos). */
  const combinado = (ingreso: string, finDiagnostico: string, limite: string, extra: Partial<ServicioVista> = {}) =>
    sv(ingreso, limite, {
      ...manual('Diagnóstico + Calibración'),
      plazoDias: 7,
      tramos: [
        { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, hasta: finDiagnostico },
        { clave: 'calibracion', etiqueta: 'Calibración', dias: 4, hasta: limite },
      ],
      ...extra,
    });

  it('un tipo simple, o un servicio sin barra, no tiene segmentos', () => {
    expect(segmentosBarra(sv('2026-10-05', '2026-10-08'), eje)).toBeNull();
    expect(segmentosBarra(sv('2026-10-05', null), eje)).toBeNull();
    expect(segmentosBarra(combinado('2026-10-01', '2026-10-06', '2026-10-13', { ingreso: null }), eje)).toBeNull();
    expect(segmentosBarra(combinado('2026-10-01', '2026-10-06', '2026-10-13', { tramos: null }), eje)).toBeNull();
  });

  it('dos tramos seguidos: del ingreso al fin del diagnóstico, y del día siguiente a la fecha límite', () => {
    const s = combinado('2026-10-01', '2026-10-06', '2026-10-13');
    expect(segmentosBarra(s, eje)).toEqual([
      { etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-10-06', tramo: { desde: 1, hasta: 6 } },
      { etiqueta: 'Calibración', dias: 4, hasta: '2026-10-13', tramo: { desde: 7, hasta: 13 } },
    ]);
  });

  it('juntos ocupan exactamente la barra del plazo, sin huecos ni solapes', () => {
    const s = combinado('2026-10-01', '2026-10-06', '2026-10-13');
    const [a, b] = segmentosBarra(s, eje)!;
    const barra = barraServicio(s, eje, HOY)!;
    expect(a.tramo!.desde).toBe(barra.plazo!.desde);
    expect(b.tramo!.desde).toBe(a.tramo!.hasta + 1);
    expect(b.tramo!.hasta).toBe(barra.plazo!.hasta);
  });

  it('un ingreso anterior al eje recorta el primer tramo por la izquierda', () => {
    const s = combinado('2026-09-28', '2026-10-01', '2026-10-07');
    expect(segmentosBarra(s, eje)!.map((x) => x.tramo)).toEqual([
      { desde: 0, hasta: 1 },
      { desde: 2, hasta: 7 },
    ]);
    expect(barraServicio(s, eje, HOY)).toMatchObject({ plazo: { desde: 0, hasta: 7 }, recortada: true, terminado: null });
  });

  it('si el diagnóstico entero cae antes del eje, sólo se pinta el tramo de calibración', () => {
    const s = combinado('2026-09-21', '2026-09-24', '2026-10-01');
    expect(segmentosBarra(s, eje)).toEqual([
      { etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-09-24', tramo: null },
      { etiqueta: 'Calibración', dias: 4, hasta: '2026-10-01', tramo: { desde: 0, hasta: 1 } },
    ]);
  });

  it('el fin del diagnóstico justo en el borde izquierdo deja una sola columna', () => {
    const s = combinado('2026-09-25', '2026-09-30', '2026-10-06');
    expect(segmentosBarra(s, eje)!.map((x) => x.tramo)).toEqual([
      { desde: 0, hasta: 0 },
      { desde: 1, hasta: 6 },
    ]);
  });

  it('vencido: los dos tramos se quedan en el plazo y el atraso rayado sigue detrás hasta hoy', () => {
    const s = combinado('2026-09-30', '2026-10-01', '2026-10-02');
    const seg = segmentosBarra(s, eje)!;
    expect(seg.map((x) => x.tramo)).toEqual([
      { desde: 0, hasta: 1 },
      { desde: 2, hasta: 2 },
    ]);
    const barra = barraServicio(s, eje, HOY)!;
    expect(barra.atraso).toEqual({ desde: 3, hasta: 6 });
    expect(barra.atraso!.desde).toBe(seg[1].tramo!.hasta + 1);
  });

  it('si todo el plazo cae antes del eje no queda ningún tramo: sólo el atraso', () => {
    const s = combinado('2025-01-10', '2025-01-15', '2025-01-21');
    expect(segmentosBarra(s, eje)!.map((x) => x.tramo)).toEqual([null, null]);
    expect(barraServicio(s, eje, HOY)).toEqual({ plazo: null, atraso: { desde: 0, hasta: 6 }, recortada: true, terminado: null });
  });

  it('el color lo sigue mandando la fecha límite final, no la intermedia', () => {
    // Diagnóstico ya pasado (2 de octubre) pero límite el 13: en plazo.
    expect(combinado('2026-09-29', '2026-10-02', '2026-10-13').estadoPlazo).toBe('EN_PLAZO');
    expect(barraServicio(combinado('2026-09-29', '2026-10-02', '2026-10-13'), eje, HOY)!.atraso).toBeNull();
  });

  it('cada tramo se nombra con su fecha de fin, para el `title` de la barra y el de la fecha límite', () => {
    const s = combinado('2026-10-01', '2026-10-06', '2026-10-13');
    const [a, b] = segmentosBarra(s, eje)!;
    expect(tituloSegmento(a)).toBe('Diagnóstico: hasta el 06/10/2026 (3 días háb.)');
    expect(tituloSegmento(b)).toBe('Calibración: hasta el 13/10/2026 (4 días háb.)');
    expect(tituloSegmento({ ...a, dias: 1 })).toBe('Diagnóstico: hasta el 06/10/2026 (1 día háb.)');
    expect(textoTramos(s)).toBe('Diagnóstico hasta el 06/10/2026 · Calibración hasta el 13/10/2026');
    expect(textoTramos(sv('2026-10-05', '2026-10-08'))).toBeNull();
    expect(textoTramos(sv('2026-10-05', null))).toBeNull();
  });
});

describe('Configuración: plazo de un tipo compuesto (sólo lectura)', () => {
  const fila = (diag: number | null, cal: number | null): PlazoServicio => ({
    clave: 'diagnostico + calibracion',
    etiqueta: 'Diagnóstico + Calibración',
    dias: diag === null || cal === null ? null : diag + cal,
    derivadoDe: [
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: diag },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: cal },
    ],
    ticketsAbiertos: 0,
    actualizadoPor: null,
    actualizadoEn: null,
  });

  it('un tipo simple no es derivado', () => {
    expect(notaDerivado({ ...fila(3, 4), clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, derivadoDe: null })).toBeNull();
  });

  it('enseña los días calculados y de qué suma salen', () => {
    expect(notaDerivado(fila(3, 4))).toEqual({ valor: '7 días hábiles', nota: 'suma de Diagnóstico (3) y Calibración (4)', falta: false });
    expect(notaDerivado(fila(5, 4))).toMatchObject({ valor: '9 días hábiles', nota: 'suma de Diagnóstico (5) y Calibración (4)' });
  });

  it('sin plazo en una parte: «sin plazo», y dice cuál falta', () => {
    expect(notaDerivado(fila(3, null))).toEqual({ valor: 'sin plazo', nota: 'suma de Diagnóstico y Calibración: falta el plazo de Calibración', falta: true });
    expect(notaDerivado(fila(null, 4))!.nota).toBe('suma de Diagnóstico y Calibración: falta el plazo de Diagnóstico');
    expect(notaDerivado(fila(null, null))!.nota).toBe('suma de Diagnóstico y Calibración: falta el plazo de Diagnóstico y Calibración');
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

  it('un tipo puesto a mano deja de contar como «sin tipo»', () => {
    const L = [sv('2026-10-05', null), sv('2026-10-05', '2026-10-08', manual('Diagnóstico')), sv('2026-10-05', null, manual('Garantía'))];
    expect(resumenServicios(L)).toMatchObject({ total: 3, conPlazo: 1, sinTipo: 1, tiposSinPlazo: ['Garantía'] });
  });
});

describe('desplegable del tipo de servicio', () => {
  const TIPOS: TipoServicioOpcion[] = [
    { clave: 'calibracion', etiqueta: 'Calibración', dias: 4 },
    { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 1 },
    { clave: 'garantia', etiqueta: 'Garantía', dias: null },
  ];

  it('sin tipo en Desk: la primera opción es «Sin tipo» y después van los configurados, en su orden', () => {
    expect(selectorTipo(sv('2026-10-05', null), TIPOS)).toEqual({
      valor: '',
      opciones: [
        { valor: '', texto: 'Sin tipo' },
        { valor: 'calibracion', texto: 'Calibración · 4 días háb.' },
        { valor: 'diagnostico', texto: 'Diagnóstico · 1 día háb.' },
        { valor: 'garantia', texto: 'Garantía · sin plazo' },
      ],
    });
  });

  it('el tipo compuesto sale como los demás, con la suma de días que manda el servidor', () => {
    const conCombinado: TipoServicioOpcion[] = [...TIPOS, { clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración', dias: 7 }];
    const s = selectorTipo(sv('2026-10-01', '2026-10-13', manual('Diagnóstico + Calibración')), conCombinado);
    expect(s.valor).toBe('diagnostico + calibracion');
    expect(s.opciones[s.opciones.length - 1]).toEqual({ valor: 'diagnostico + calibracion', texto: 'Diagnóstico + Calibración · 7 días háb.' });
    expect(s.opciones).toHaveLength(5);
    // Con una parte sin plazo, el servidor manda null y se dice «sin plazo».
    const sin = selectorTipo(sv('2026-10-01', null), [{ clave: 'diagnostico + calibracion', etiqueta: 'Diagnóstico + Calibración', dias: null }]);
    expect(sin.opciones[1].texto).toBe('Diagnóstico + Calibración · sin plazo');
  });

  it('con tipo en Desk: la primera opción es «Según Desk: …» y es la elegida mientras no haya uno a mano', () => {
    const s = selectorTipo(sv('2026-10-05', '2026-10-08', { tipoServicio: 'Diagnostico', tipoDesk: 'Diagnostico', tipoOrigen: 'desk' }), TIPOS);
    expect(s.valor).toBe('');
    expect(s.opciones[0]).toEqual({ valor: '', texto: 'Según Desk: Diagnostico' });
    expect(s.opciones).toHaveLength(4);
  });

  it('con un tipo puesto a mano, el elegido es su clave; el de Desk sigue en la primera opción', () => {
    const s = selectorTipo(sv('2026-10-05', '2026-10-09', { ...manual('Calibración'), tipoDesk: 'Diagnóstico' }), TIPOS);
    expect(s.valor).toBe('calibracion');
    expect(s.opciones[0]).toEqual({ valor: '', texto: 'Según Desk: Diagnóstico' });
  });

  it('si el tipo puesto a mano ya no está en Configuración, se añade para que el desplegable no mienta', () => {
    const s = selectorTipo(sv('2026-10-05', null, manual('Instalación')), TIPOS);
    expect(s.valor).toBe('instalacion');
    expect(s.opciones[s.opciones.length - 1]).toEqual({ valor: 'instalacion', texto: 'Instalación · sin plazo' });
    expect(s.opciones).toHaveLength(5);
  });

  it('nota del origen: quién y cuándo lo puso a mano, y lo que dice Desk si es distinto', () => {
    expect(notaTipo(sv('2026-10-05', null))).toBe('Zoho Desk no envía el tipo de servicio de este ticket: elígelo aquí.');
    expect(notaTipo(sv('2026-10-05', '2026-10-08', { tipoServicio: 'Diagnóstico', tipoDesk: 'Diagnóstico', tipoOrigen: 'desk' }))).toBe('Tipo de servicio según Zoho Desk.');
    expect(notaTipo(sv('2026-10-05', '2026-10-08', manual('Diagnóstico')))).toBe('Puesto a mano por st@ambientalia.com.co el 06/10/2026.');
    expect(notaTipo(sv('2026-10-05', '2026-10-09', { ...manual('Calibración'), tipoDesk: 'Diagnóstico' }))).toBe(
      'Puesto a mano por st@ambientalia.com.co el 06/10/2026. Zoho Desk dice: Diagnóstico.',
    );
    // La misma grafía con otra tilde no es «distinto».
    expect(notaTipo(sv('2026-10-05', '2026-10-08', { ...manual('Diagnóstico'), tipoDesk: 'diagnostico' }))).toBe('Puesto a mano por st@ambientalia.com.co el 06/10/2026.');
  });

  it('aviso de Desk: lo que falta por elegir, y desaparece cuando todos tienen tipo', () => {
    expect(avisoSinTipo({ total: 3, sinTipo: 3 })).toEqual({
      titulo: 'Zoho Desk todavía no envía el tipo de servicio',
      texto: expect.stringContaining('columna «Tipo de servicio»'),
    });
    expect(avisoSinTipo({ total: 3, sinTipo: 1 })?.titulo).toBe('1 de 3 servicios sigue sin tipo de servicio');
    expect(avisoSinTipo({ total: 5, sinTipo: 2 })?.titulo).toBe('2 de 5 servicios siguen sin tipo de servicio');
    expect(avisoSinTipo({ total: 3, sinTipo: 0 })).toBeNull();
    expect(avisoSinTipo({ total: 0, sinTipo: 0 })).toBeNull();
  });
});

describe('standby: el reloj en pausa', () => {
  const pausa: Partial<ServicioVista> = { rolEstado: 'standby', enPausa: true };
  const vencido = sv('2026-09-28', '2026-10-01', { estado: 'Servicio externo', ...pausa, cliente: 'Cliente Uno', serial: '18A00001' });
  const enPlazo = sv('2026-10-05', '2026-10-08', { estado: 'Notificación cliente', ...pausa, cliente: 'Cliente Dos', serial: '18A00002' });
  const otro = sv('2026-10-05', '2026-10-08', { estado: 'En Proceso', cliente: 'Cliente Tres', serial: '18A00003' });
  const sinPlazo = sv('2026-10-05', null, { estado: 'Por Facturar', cliente: 'Cliente Uno', serial: '18A00004' });
  const todos = [vencido, enPlazo, otro, sinPlazo];
  const sinFiltro: FiltroServicios = { estados: [], standby: false, texto: '' };
  const numeros = (f: Partial<FiltroServicios>) => filtrarServicios(todos, { ...sinFiltro, ...f }).map((s) => s.numero);

  it('cuenta los servicios cuyo estado de ahora es standby', () => {
    expect(contarStandby(todos)).toBe(2);
    expect(contarStandby([otro, sinPlazo])).toBe(0);
    expect(contarStandby([])).toBe(0);
    // «Trabajo terminado» no es standby: el reloj está parado, no en pausa.
    expect(contarStandby([sv('2026-10-05', '2026-10-08', { rolEstado: 'terminado', terminadoEl: '2026-10-06', estadoPlazo: 'CUMPLIDO' })])).toBe(0);
  });

  it('sin filtros salen todos, en el mismo orden', () => {
    expect(numeros({})).toEqual(todos.map((s) => s.numero));
  });

  it('el filtro «Standby» deja sólo los que están en pausa', () => {
    expect(numeros({ standby: true })).toEqual([vencido.numero, enPlazo.numero]);
  });

  it('se combina con los del plazo: tiene que cumplir los dos', () => {
    expect(numeros({ standby: true, estados: ['VENCIDO'] })).toEqual([vencido.numero]);
    expect(numeros({ standby: true, estados: ['VENCIDO', 'EN_PLAZO'] })).toEqual([vencido.numero, enPlazo.numero]);
    expect(numeros({ standby: true, estados: ['SIN_PLAZO'] })).toEqual([]);
    // Sin «Standby», los del plazo siguen como estaban.
    expect(numeros({ estados: ['EN_PLAZO'] })).toEqual([enPlazo.numero, otro.numero]);
  });

  it('y con el buscador (ticket, cliente o serial, sin distinguir mayúsculas)', () => {
    expect(numeros({ standby: true, texto: '  cliente UNO ' })).toEqual([vencido.numero]);
    expect(numeros({ texto: '18a00004' })).toEqual([sinPlazo.numero]);
    expect(numeros({ texto: String(otro.numero) })).toEqual([otro.numero]);
    expect(numeros({ standby: true, texto: 'cliente tres' })).toEqual([]);
  });

  it('el aviso del filtro dice qué significa: el reloj se para a la espera de otro', () => {
    expect(TITULO_STANDBY).toMatch(/a la espera del cliente o de un servicio externo/);
    expect(TITULO_STANDBY).toMatch(/pausa/);
    expect(TITULO_STANDBY).not.toMatch(/sigue contando/);
  });

  it('la etiqueta de un servicio dice cuántos días hábiles lleva en pausa y desde cuándo se mide', () => {
    const s = sv('2026-10-01', '2026-10-09', { ...pausa, diasPausados: 3, medidoDesde: '2026-10-02' });
    expect(tituloStandby(s)).toBe('Standby: reloj en pausa. 3 días hábiles en pausa hasta ahora, medido desde el 02/10/2026.');
    expect(tituloStandby({ ...s, diasPausados: 1 })).toBe('Standby: reloj en pausa. 1 día hábil en pausa hasta ahora, medido desde el 02/10/2026.');
    // Recién visto en fin de semana: todavía ningún día hábil. Y sin nada apuntado aún, no se inventa la fecha.
    expect(tituloStandby({ ...s, diasPausados: 0 })).toBe('Standby: reloj en pausa. Ningún día hábil en pausa hasta ahora, medido desde el 02/10/2026.');
    expect(tituloStandby({ ...s, diasPausados: 0, medidoDesde: null })).toBe('Standby: reloj en pausa. Ningún día hábil en pausa hasta ahora.');
  });

  it('en pausa, el texto del plazo deja claro que la cuenta está congelada', () => {
    expect(textoPlazo(sv('2026-10-05', '2026-10-09', { ...pausa, diasHabiles: 3 }))).toBe('en pausa · quedan 3 d háb.');
    expect(textoPlazo(sv('2026-09-28', '2026-10-02', { ...pausa, diasHabiles: -1 }))).toBe('en pausa · vencido hace 1 d háb.');
    expect(textoPlazo(sv('2026-09-28', '2026-10-02', { ...pausa, diasHabiles: 0, estadoPlazo: 'VENCIDO' }))).toBe('en pausa · vencido');
    expect(textoPlazo(sv('2026-10-05', null, pausa))).toBe('sin plazo');
    // Fuera de pausa, lo de siempre.
    expect(textoPlazo(sv('2026-10-05', '2026-10-09', { diasHabiles: 3 }))).toBe('quedan 3 d háb.');
  });

  it('la fecha límite corrida lleva en su `title` la fecha sin pausas y los días en pausa', () => {
    expect(tituloFechaLimite(sv('2026-10-05', '2026-10-08'))).toBeNull();
    expect(tituloFechaLimite(sv('2026-10-05', '2026-10-13', { fechaLimiteBase: '2026-10-08', diasPausados: 2 }))).toBe('Sin pausas sería el 08/10/2026: 2 días hábiles en pausa');
    expect(tituloFechaLimite(sv('2026-10-05', '2026-10-09', { fechaLimiteBase: '2026-10-08', diasPausados: 1 }))).toBe('Sin pausas sería el 08/10/2026: 1 día hábil en pausa');
    // Pausas posteriores al límite: no lo mueven, pero se dice que las hay.
    expect(tituloFechaLimite(sv('2026-09-28', '2026-10-02', { fechaLimiteBase: '2026-10-02', diasPausados: 2 }))).toBe('2 días hábiles en pausa después de la fecha límite: no la mueven');
    expect(tituloFechaLimite(sv('2026-10-05', null, { diasPausados: 2 }))).toBeNull();
  });

  it('en un tipo compuesto el `title` junta los tramos y el corrimiento', () => {
    const s = sv('2026-10-05', '2026-10-16', {
      fechaLimiteBase: '2026-10-15',
      diasPausados: 1,
      tramos: [
        { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-10-09' },
        { clave: 'calibracion', etiqueta: 'Calibración', dias: 4, hasta: '2026-10-16' },
      ],
    });
    expect(tituloFechaLimite(s)).toBe('Diagnóstico hasta el 09/10/2026 · Calibración hasta el 16/10/2026 · Sin pausas sería el 15/10/2026: 1 día hábil en pausa');
    expect(tituloFechaLimite({ ...s, diasPausados: 0, fechaLimiteBase: '2026-10-16' })).toBe(textoTramos(s));
  });
});

describe('trabajo terminado: el reloj parado y su veredicto', () => {
  const fin = (estadoPlazo: ServicioVista['estadoPlazo'], extra: Partial<ServicioVista> = {}) =>
    sv('2026-10-01', '2026-10-06', { rolEstado: 'terminado', terminadoEl: '2026-10-05', estadoPlazo, estado: 'Por Facturar', diasHabiles: 1, ...extra });

  it('colores: cumplido en verde, incumplido en rojo y sin medir en neutro; las barras, en un tono más claro que las que siguen en marcha', () => {
    expect(TONO_PLAZO.CUMPLIDO.badge).toContain('emerald');
    expect(TONO_PLAZO.INCUMPLIDO.badge).toContain('red');
    expect(TONO_PLAZO.TERMINADO.badge).toContain('slate');
    expect(TONO_PLAZO.CUMPLIDO.barra).toContain('emerald');
    expect(TONO_PLAZO.INCUMPLIDO.barra).toContain('red');
    expect(TONO_PLAZO.TERMINADO.barra).toContain('slate');
    expect(TONO_PLAZO.CUMPLIDO.barra).not.toBe(TONO_PLAZO.EN_PLAZO.barra);
    expect(TONO_PLAZO.INCUMPLIDO.barra).not.toBe(TONO_PLAZO.VENCIDO.barra);
    // Ningún estado del plazo se queda sin tono.
    for (const e of ESTADOS_PLAZO) expect(Object.keys(TONO_PLAZO[e]).sort()).toEqual(['badge', 'barra', 'dot', 'text']);
  });

  it('textos: «cumplido», «incumplido · N d» y «terminado»', () => {
    expect(textoPlazo(fin('CUMPLIDO'))).toBe('cumplido');
    expect(textoPlazo(fin('CUMPLIDO', { diasHabiles: 0 }))).toBe('cumplido');
    expect(textoPlazo(fin('INCUMPLIDO', { diasHabiles: -3 }))).toBe('incumplido · 3 d háb.');
    // Llegó en fin de semana tras un límite en viernes: tarde, pero sin días hábiles de atraso.
    expect(textoPlazo(fin('INCUMPLIDO', { diasHabiles: 0 }))).toBe('incumplido');
    expect(textoPlazo(fin('TERMINADO'))).toBe('terminado');
    expect(textoPlazo(fin('SIN_PLAZO', { fechaLimite: null, diasHabiles: null }))).toBe('sin plazo');
  });

  it('la etiqueta «terminado» dice cuándo se paró el reloj y qué se sabe del plazo', () => {
    expect(tituloTerminado(fin('CUMPLIDO'))).toBe('Trabajo terminado el 05/10/2026: el reloj está parado. Llegó dentro del plazo.');
    expect(tituloTerminado(fin('INCUMPLIDO', { terminadoEl: '2026-10-08' }))).toBe('Trabajo terminado el 08/10/2026: el reloj está parado. Llegó después de la fecha límite.');
    expect(tituloTerminado(fin('TERMINADO'))).toBe('Trabajo terminado: el reloj está parado. El portal lo vio por primera vez ya terminado (el 05/10/2026), así que no se puede medir si cumplió.');
    expect(tituloTerminado(fin('SIN_PLAZO', { fechaLimite: null }))).toBe('Trabajo terminado el 05/10/2026: el reloj está parado.');
  });

  it('orden por urgencia: los terminados van detrás de todos los que siguen en marcha', () => {
    const vencido = sv('2026-09-28', '2026-10-02', { diasHabiles: -2 });
    const hoy = sv('2026-10-01', '2026-10-06', { diasHabiles: 0 });
    const enPlazo = sv('2026-10-05', '2026-10-08', { diasHabiles: 2 });
    const sinPlazo = sv('2026-10-05', null);
    const incumplido = fin('INCUMPLIDO', { diasHabiles: -4 });
    const incumplidoPoco = fin('INCUMPLIDO', { diasHabiles: -1 });
    const cumplido = fin('CUMPLIDO');
    const sinMedir = fin('TERMINADO');
    const terminadoSinPlazo = fin('SIN_PLAZO', { fechaLimite: null, diasHabiles: null });
    const lista = [terminadoSinPlazo, cumplido, sinPlazo, sinMedir, enPlazo, incumplidoPoco, vencido, incumplido, hoy];
    expect([...lista].sort(porUrgenciaPlazo)).toEqual([vencido, hoy, enPlazo, sinPlazo, incumplido, incumplidoPoco, cumplido, sinMedir, terminadoSinPlazo]);
  });

  it('recuento por estado del plazo: todos los estados, también los que no tienen ninguno', () => {
    const cnt = contarPlazos([fin('CUMPLIDO'), fin('CUMPLIDO'), fin('INCUMPLIDO'), fin('TERMINADO'), sv('2026-10-05', '2026-10-08'), sv('2026-10-05', null)]);
    expect(cnt).toEqual({ VENCIDO: 0, VENCE_HOY: 0, EN_PLAZO: 1, SIN_PLAZO: 1, INCUMPLIDO: 1, CUMPLIDO: 2, TERMINADO: 1 });
    expect(Object.keys(contarPlazos([])).sort()).toEqual([...ESTADOS_PLAZO].sort());
  });

  it('filtros: los cuatro de siempre y uno solo, «Terminado», que cubre los tres del trabajo terminado', () => {
    expect(GRUPOS_PLAZO.map((g) => [g.etiqueta, [...g.estados]])).toEqual([
      ['Vencido', ['VENCIDO']],
      ['Vence hoy', ['VENCE_HOY']],
      ['En plazo', ['EN_PLAZO']],
      ['Sin plazo', ['SIN_PLAZO']],
      ['Terminado', ['INCUMPLIDO', 'CUMPLIDO', 'TERMINADO']],
    ]);
    // Cada estado del plazo cae en un grupo, y sólo en uno: ninguno se queda sin filtro ni se cuenta dos veces.
    expect(GRUPOS_PLAZO.flatMap((g) => g.estados).sort()).toEqual([...ESTADOS_PLAZO].sort());
    for (const g of GRUPOS_PLAZO) expect(g.dot).toMatch(/^bg-/);
  });

  it('el filtro «Terminado» cuenta los tres, se enciende y se apaga entero, y desglosa en su `title`', () => {
    const terminado = GRUPOS_PLAZO[4];
    const enPlazo = GRUPOS_PLAZO[2];
    const cnt = contarPlazos([fin('CUMPLIDO'), fin('CUMPLIDO'), fin('INCUMPLIDO'), fin('TERMINADO'), sv('2026-10-05', '2026-10-08')]);
    expect(contarGrupo(terminado, cnt)).toBe(4);
    expect(contarGrupo(enPlazo, cnt)).toBe(1);
    expect(tituloGrupo(terminado, cnt)).toBe('Trabajo terminado (reloj parado): 2 cumplidos · 1 incumplido · 1 sin medir');
    expect(tituloGrupo(terminado, contarPlazos([fin('CUMPLIDO')]))).toBe('Trabajo terminado (reloj parado): 1 cumplido · 0 incumplidos · 0 sin medir');
    expect(tituloGrupo(enPlazo, cnt)).toBeUndefined();

    expect(grupoElegido(terminado, [])).toBe(false);
    const con = alternarGrupo(terminado, ['VENCIDO']);
    expect(con).toEqual(['VENCIDO', 'INCUMPLIDO', 'CUMPLIDO', 'TERMINADO']);
    expect(grupoElegido(terminado, con)).toBe(true);
    expect(grupoElegido(terminado, ['VENCIDO', 'CUMPLIDO'])).toBe(false);
    expect(alternarGrupo(terminado, con)).toEqual(['VENCIDO']);
    // A medias (no debería pasar) se completa, no se duplica.
    expect(alternarGrupo(terminado, ['CUMPLIDO'])).toEqual(['CUMPLIDO', 'INCUMPLIDO', 'TERMINADO']);
    expect(alternarGrupo(enPlazo, [])).toEqual(['EN_PLAZO']);
    expect(alternarGrupo(enPlazo, ['EN_PLAZO', 'VENCIDO'])).toEqual(['VENCIDO']);
  });

  it('filtrar por «Terminado» deja los tres veredictos y nada más', () => {
    const lista = [fin('CUMPLIDO'), sv('2026-10-05', '2026-10-08'), fin('INCUMPLIDO'), fin('TERMINADO'), sv('2026-10-05', null)];
    const f: FiltroServicios = { estados: alternarGrupo(GRUPOS_PLAZO[4], []), standby: false, texto: '' };
    expect(filtrarServicios(lista, f).map((s) => s.estadoPlazo)).toEqual(['CUMPLIDO', 'INCUMPLIDO', 'TERMINADO']);
  });
});

describe('calendario: pausas y fin del trabajo', () => {
  const eje = { inicio: '2026-09-30', fin: '2026-10-18', dias: 19 };

  it('las pausas van a columnas, dentro de la barra', () => {
    const s = sv('2026-10-01', '2026-10-13', {
      diasPausados: 3,
      pausas: [
        { desde: '2026-10-02', hasta: '2026-10-02' },
        { desde: '2026-10-05', hasta: '2026-10-06' },
      ],
    });
    expect(pausasBarra(s, eje, HOY)).toEqual([
      { desde: 2, hasta: 2 },
      { desde: 5, hasta: 6 },
    ]);
  });

  it('una pausa que empieza antes del eje se recorta por la izquierda, y una que cae entera fuera no se pinta', () => {
    const ejeCorto = { inicio: '2026-10-03', fin: '2026-10-18', dias: 16 };
    const s = sv('2026-09-20', '2026-10-13', {
      pausas: [
        { desde: '2026-09-22', hasta: '2026-09-25' },
        { desde: '2026-10-01', hasta: '2026-10-05' },
      ],
    });
    expect(pausasBarra(s, ejeCorto, HOY)).toEqual([{ desde: 0, hasta: 2 }]);
  });

  it('y por la derecha: nada se pinta más allá del eje ni de la barra', () => {
    const ejeCorto = { inicio: '2026-09-30', fin: '2026-10-05', dias: 6 };
    const s = sv('2026-10-01', '2026-10-13', { pausas: [{ desde: '2026-10-05', hasta: '2026-10-06' }] });
    expect(pausasBarra(s, ejeCorto, HOY)).toEqual([{ desde: 5, hasta: 5 }]);
    // Una pausa que (por un dato raro) se saliera de la barra se recorta a ella: barra del 1 al 8, hoy el 6.
    const raro = sv('2026-10-01', '2026-10-08', { pausas: [{ desde: '2026-09-29', hasta: '2026-10-01' }, { desde: '2026-10-07', hasta: '2026-10-12' }] });
    expect(pausasBarra(raro, eje, HOY)).toEqual([
      { desde: 1, hasta: 1 },
      { desde: 7, hasta: 8 },
    ]);
  });

  it('vencido y con pausas después del límite: también se pintan sobre el tramo de atraso', () => {
    const s = sv('2026-09-30', '2026-10-02', { pausas: [{ desde: '2026-10-05', hasta: '2026-10-06' }] });
    expect(barraServicio(s, eje, HOY)).toMatchObject({ plazo: { desde: 0, hasta: 2 }, atraso: { desde: 3, hasta: 6 } });
    expect(pausasBarra(s, eje, HOY)).toEqual([{ desde: 5, hasta: 6 }]);
  });

  it('sin barra (sin plazo) no hay pausas que pintar, aunque el servicio las tenga', () => {
    expect(pausasBarra(sv('2026-10-01', null, { pausas: [{ desde: '2026-10-02', hasta: '2026-10-02' }] }), eje, HOY)).toEqual([]);
    expect(pausasBarra(sv('2026-10-01', '2026-10-08'), eje, HOY)).toEqual([]);
  });

  it('trabajo terminado: la barra acaba el día en que se terminó, con su marca, y no hay atraso después', () => {
    // Cumplido antes de tiempo: límite el 8, terminado el 5.
    const aTiempo = sv('2026-10-01', '2026-10-08', { rolEstado: 'terminado', terminadoEl: '2026-10-05', estadoPlazo: 'CUMPLIDO' });
    expect(barraServicio(aTiempo, eje, HOY)).toEqual({ plazo: { desde: 1, hasta: 5 }, atraso: null, recortada: false, terminado: 5 });
    // Incumplido: límite el 2, terminado el 5; hoy es 6 y la barra no sigue hasta hoy.
    const tarde = sv('2026-09-30', '2026-10-02', { rolEstado: 'terminado', terminadoEl: '2026-10-05', estadoPlazo: 'INCUMPLIDO' });
    expect(barraServicio(tarde, eje, HOY)).toEqual({ plazo: { desde: 0, hasta: 5 }, atraso: null, recortada: false, terminado: 5 });
    // Semanas después sigue igual.
    expect(barraServicio(tarde, eje, '2026-10-17')).toEqual({ plazo: { desde: 0, hasta: 5 }, atraso: null, recortada: false, terminado: 5 });
  });

  it('la marca de fin sólo se pinta si cae en el eje', () => {
    const ejeTardio = { inicio: '2026-10-07', fin: '2026-10-18', dias: 12 };
    const s = sv('2026-10-01', '2026-10-08', { rolEstado: 'terminado', terminadoEl: '2026-10-05', estadoPlazo: 'CUMPLIDO' });
    expect(barraServicio(s, ejeTardio, HOY)).toEqual({ plazo: null, atraso: null, recortada: true, terminado: null });
    // Los que siguen en marcha no llevan marca.
    expect(barraServicio(sv('2026-10-01', '2026-10-08'), eje, HOY)!.terminado).toBeNull();
  });

  it('terminado con pausas antes: se pintan dentro de la barra, que acaba donde se terminó', () => {
    const s = sv('2026-10-01', '2026-10-09', { rolEstado: 'terminado', terminadoEl: '2026-10-08', estadoPlazo: 'CUMPLIDO', pausas: [{ desde: '2026-10-02', hasta: '2026-10-05' }] });
    expect(barraServicio(s, eje, '2026-10-15')).toMatchObject({ plazo: { desde: 1, hasta: 8 }, terminado: 8 });
    expect(pausasBarra(s, eje, '2026-10-15')).toEqual([{ desde: 2, hasta: 5 }]);
  });

  it('tipo compuesto terminado: los tramos no pasan del día en que se terminó', () => {
    const tramos = [
      { clave: 'diagnostico', etiqueta: 'Diagnóstico', dias: 3, hasta: '2026-10-06' },
      { clave: 'calibracion', etiqueta: 'Calibración', dias: 4, hasta: '2026-10-13' },
    ];
    const enCalibracion = sv('2026-10-01', '2026-10-13', { tramos, rolEstado: 'terminado', terminadoEl: '2026-10-08', estadoPlazo: 'CUMPLIDO' });
    expect(segmentosBarra(enCalibracion, eje)!.map((x) => x.tramo)).toEqual([
      { desde: 1, hasta: 6 },
      { desde: 7, hasta: 8 },
    ]);
    // Terminado ya durante el diagnóstico: el segundo tramo no llega a pintarse.
    const enDiagnostico = sv('2026-10-01', '2026-10-13', { tramos, rolEstado: 'terminado', terminadoEl: '2026-10-05', estadoPlazo: 'CUMPLIDO' });
    expect(segmentosBarra(enDiagnostico, eje)!.map((x) => x.tramo)).toEqual([{ desde: 1, hasta: 5 }, null]);
    // En marcha, como siempre.
    expect(segmentosBarra(sv('2026-10-01', '2026-10-13', { tramos }), eje)!.map((x) => x.tramo)).toEqual([
      { desde: 1, hasta: 6 },
      { desde: 7, hasta: 13 },
    ]);
  });

  it('leyenda: sólo lo que hay pintado', () => {
    const normal = sv('2026-10-01', '2026-10-08');
    expect(leyendaServicios([normal, sv('2026-10-01', null)])).toEqual({ pausas: false, dosTramos: false, terminados: [] });
    const conPausa = sv('2026-10-01', '2026-10-13', { pausas: [{ desde: '2026-10-02', hasta: '2026-10-02' }] });
    const sinBarraConPausa = sv('2026-10-01', null, { pausas: [{ desde: '2026-10-02', hasta: '2026-10-02' }] });
    expect(leyendaServicios([normal, sinBarraConPausa]).pausas).toBe(false);
    expect(leyendaServicios([normal, conPausa]).pausas).toBe(true);
    const fin = (estadoPlazo: ServicioVista['estadoPlazo']) => sv('2026-10-01', '2026-10-08', { rolEstado: 'terminado', terminadoEl: '2026-10-05', estadoPlazo });
    // En el orden de siempre, sin repetir, y sin los terminados que no tienen barra.
    expect(leyendaServicios([fin('TERMINADO'), fin('CUMPLIDO'), fin('CUMPLIDO'), sv('2026-10-01', null, { rolEstado: 'terminado', terminadoEl: '2026-10-05' })]).terminados).toEqual(['CUMPLIDO', 'TERMINADO']);
    expect(leyendaServicios([fin('INCUMPLIDO')]).terminados).toEqual(['INCUMPLIDO']);
    const dos = sv('2026-10-01', '2026-10-13', { tramos: [{ clave: 'a', etiqueta: 'A', dias: 1, hasta: '2026-10-02' }, { clave: 'b', etiqueta: 'B', dias: 1, hasta: '2026-10-13' }] });
    expect(leyendaServicios([dos]).dosTramos).toBe(true);
  });

  it('el eje no se estira por un terminado más de lo que ya pedía su fecha límite', () => {
    const s = sv('2026-10-01', '2026-10-08', { rolEstado: 'terminado', terminadoEl: '2026-10-05', estadoPlazo: 'CUMPLIDO' });
    expect(ejeServicios([s], HOY)).toEqual(ejeServicios([sv('2026-10-01', '2026-10-08')], HOY));
  });
});

describe('bloque «Estados de Desk» de Configuración', () => {
  it('traduce el tipo de estado de Desk; uno desconocido se enseña tal cual y sin tipo no hay nada que enseñar', () => {
    expect(etiquetaTipoDesk('Open')).toBe('Abierto');
    expect(etiquetaTipoDesk('On Hold')).toBe('En espera');
    expect(etiquetaTipoDesk('Closed')).toBe('Cerrado');
    expect(etiquetaTipoDesk('Custom')).toBe('Custom');
    expect(etiquetaTipoDesk(null)).toBe('');
    expect(etiquetaTipoDesk('')).toBe('');
  });

  it('las tres opciones del rol, en orden, cada una con lo que le hace al reloj', () => {
    expect(OPCIONES_ROL.map((o) => [o.valor, o.texto])).toEqual([
      ['cuenta', 'Cuenta'],
      ['standby', 'Standby'],
      ['terminado', 'Trabajo terminado'],
    ]);
    expect(OPCIONES_ROL.map((o) => o.valor)).toEqual([...ROLES_ESTADO]);
    expect(OPCIONES_ROL[0].ayuda).toMatch(/cuenta para el plazo/);
    expect(OPCIONES_ROL[1].ayuda).toMatch(/pausa/);
    expect(OPCIONES_ROL[1].ayuda).toMatch(/cliente o de un servicio externo/);
    expect(OPCIONES_ROL[2].ayuda).toMatch(/parado/);
  });

  it('nota del último cambio: qué rol se eligió, quién y cuándo, o que nadie lo ha tocado', () => {
    const e: EstadoDesk = { clave: 'servicio externo', etiqueta: 'Servicio externo', tipoDesk: 'On Hold', ticketsAbiertos: 1, rol: 'standby', actualizadoPor: 'st@ambientalia.com.co', actualizadoEn: '2026-10-06 09:15:00.123456-05', categoria: 'standby', etapa: null, categoriaPor: null, categoriaEn: null };
    expect(notaEstadoDesk(e)).toBe('«Standby», elegido por st@ambientalia.com.co el 06/10/2026. Reloj en pausa: a la espera del cliente o de un servicio externo.');
    expect(notaEstadoDesk({ ...e, rol: 'terminado' })).toBe('«Trabajo terminado», elegido por st@ambientalia.com.co el 06/10/2026. Reloj parado: el trabajo técnico está hecho.');
    expect(notaEstadoDesk({ ...e, rol: 'cuenta' })).toBe('«Cuenta», elegido por st@ambientalia.com.co el 06/10/2026. El tiempo en este estado cuenta para el plazo.');
    expect(notaEstadoDesk({ ...e, rol: 'cuenta', actualizadoPor: null, actualizadoEn: null })).toBe('Nadie lo ha cambiado: cuenta. El tiempo en este estado cuenta para el plazo.');
  });

  it('el aviso al guardar dice qué pasa con el reloj', () => {
    expect(avisoRol('Notificación cliente', 'standby')).toBe('Notificación cliente: standby (reloj en pausa)');
    expect(avisoRol('Por Facturar', 'terminado')).toBe('Por Facturar: trabajo terminado (reloj parado)');
    expect(avisoRol('En Proceso', 'cuenta')).toBe('En Proceso: cuenta');
  });
});
