import { describe, it, expect } from 'vitest';
import { claveTipoServicio, estadoPlazo, type PlazoServicio, type ServicioVista, type TipoServicioOpcion } from '../dominio';
import {
  TONO_PLAZO,
  avisoSinTipo,
  barraServicio,
  notaDerivado,
  notaTipo,
  segmentosBarra,
  selectorTipo,
  diasDelEje,
  ejeServicios,
  mesesDelEje,
  porUrgenciaPlazo,
  resumenServicios,
  textoPlazo,
  textoTramos,
  tituloSegmento,
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
    expect(barraServicio(s, eje, HOY)).toMatchObject({ plazo: { desde: 0, hasta: 7 }, recortada: true });
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
    expect(barraServicio(s, eje, HOY)).toEqual({ plazo: null, atraso: { desde: 0, hasta: 6 }, recortada: true });
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
