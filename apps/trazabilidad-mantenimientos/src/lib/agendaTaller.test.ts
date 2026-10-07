import { describe, it, expect } from 'vitest';
import type { EtapaAgenda, EtapaProyectada, PuestoAgenda, RespuestaAgenda, TicketEnFila } from '../dominio';
import {
  REFRESCO_MS,
  barraOcupante,
  barraPrevista,
  detalleDe,
  diasAgenda,
  diasEnEstado,
  ejeDeAgenda,
  encadenadoDe,
  listaPorDias,
  marcasDeFila,
  previstosDePuesto,
  resumenEtapa,
  rotuloFuente,
  situacionDe,
  textoFlujo,
  textoTransicion,
  tituloOcupante,
  tocaRefrescar,
} from './agendaTaller';

// Lote 7 de la agenda del taller: lo que la pantalla calcula antes de pintar.
// Todo con «hoy» y el eje como argumentos: no depende del reloj ni de la zona
// de la máquina. Números de ticket y asuntos ficticios.

const HOY = '2026-10-06'; // martes; el lunes 12/10/2026 es festivo en Colombia
const EJE = { desde: '2026-10-01', hasta: '2026-11-03', festivos: ['2026-10-12', '2026-11-02'], cierres: ['2026-10-20'] };
const eje = ejeDeAgenda(EJE);

const puesto = (n: number, extra: Partial<PuestoAgenda> = {}): PuestoAgenda => ({ puesto: n, ocupante: null, inicio: null, finPlanificado: null, finEstimado: null, pasadoDeFecha: false, aExtinguir: false, ...extra });
const ocupado = (n: number, numero: number, inicio: string, fin: string | null, extra: Partial<PuestoAgenda> = {}): PuestoAgenda =>
  puesto(n, { ocupante: { numero, estado: 'Rev./Diagnostico', marcas: { sinTipo: false, sinDuracion: fin === null, sinDatosFuente: false } }, inicio, finPlanificado: fin, finEstimado: fin, ...extra });
const enFila = (numero: number, posicion: number, extra: Partial<TicketEnFila> = {}): TicketEnFila => ({
  numero,
  estado: 'Rev./Diagnostico',
  posicion,
  motivo: 'remision',
  situacion: 'en_etapa',
  flujo: 'servicio',
  duracionDias: 3,
  puestoPrevisto: null,
  entradaPrevista: null,
  finPrevisto: null,
  marcas: { faltaRemision: false, sinTipo: false, ordenAproximado: false, prioridad: false, sinDuracion: false },
  ...extra,
});
const etapa = (e: EtapaAgenda, etiqueta: string, extra: Partial<EtapaProyectada> = {}): EtapaProyectada => ({ etapa: e, etiqueta, puestos: [], fila: [], encadenados: [], saturacion: { ocupados: 0, puestos: 0 }, primerHueco: null, ...extra });

const agenda = (etapas: EtapaProyectada[], extra: Partial<RespuestaAgenda> = {}): RespuestaAgenda => ({
  hoy: HOY,
  fuente: { fuente: 'principal', motivo: null, ultimaSincronizacion: '2026-10-06T14:00:00.000Z' },
  etapas,
  standby: [],
  porLlegar: [],
  finTaller: 0,
  fueraAgenda: 0,
  sinCategoria: [],
  avisos: [],
  totalAbiertos: 0,
  estadoFuente: { fuente: 'principal', motivo: null, mensaje: null, ultimaSincronizacion: '2026-10-06T14:00:00.000Z', sincronizacionParada: false, umbralSincronizacionMs: 3_600_000, ultimoFalloPrincipal: null, cortacircuitosHasta: null },
  tickets: [],
  eje: EJE,
  ...extra,
});

describe('eje del calendario', () => {
  it('una columna por día del tramo que manda el servidor, ambos incluidos', () => {
    expect(eje).toEqual({ inicio: '2026-10-01', fin: '2026-11-03', dias: 34 });
  });

  it('cada día dice por qué no es hábil: fin de semana, festivo o cierre de empresa', () => {
    const dias = diasAgenda(EJE);
    expect(dias).toHaveLength(34);
    const de = (f: string) => dias.find((d) => d.fecha === f)!;
    expect(de('2026-10-06')).toEqual({ fecha: '2026-10-06', dia: 6, letra: 'ma', habil: true, motivo: null });
    expect(de('2026-10-10')).toMatchObject({ letra: 'sá', habil: false, motivo: 'Fin de semana' });
    expect(de('2026-10-11')).toMatchObject({ letra: 'do', habil: false, motivo: 'Fin de semana' });
    expect(de('2026-10-12')).toMatchObject({ letra: 'lu', habil: false, motivo: 'Festivo' });
    expect(de('2026-10-20')).toMatchObject({ habil: false, motivo: 'Cierre de empresa' });
    // Un cierre que cae en sábado sigue siendo fin de semana.
    expect(diasAgenda({ ...EJE, cierres: ['2026-10-10'] }).find((d) => d.fecha === '2026-10-10')!.motivo).toBe('Fin de semana');
  });
});

describe('barra de quien ocupa un puesto', () => {
  // Las barras van de la MITAD de la columna de entrada a la mitad de la de salida: el día de inicio no
  // cuenta en la duración y el día en que sale uno entra el siguiente, así que no se pisan.
  it('lo transcurrido hasta hoy, y lo que falta hasta el fin estimado', () => {
    // Desde el lunes 05/10 (columna 4) hasta el jueves 08/10 (columna 7); hoy es la columna 5.
    expect(barraOcupante(ocupado(1, 901, '2026-10-05', '2026-10-08'), eje, HOY)).toEqual({ hecho: { desde: 4.5, hasta: 5.5 }, resto: { desde: 5.5, hasta: 7.5 }, retraso: null, cortadaIzq: false, cortadaDer: false });
  });

  it('asignado hoy: aún no ha transcurrido nada', () => {
    expect(barraOcupante(ocupado(1, 901, HOY, '2026-10-09'), eje, HOY)).toMatchObject({ hecho: null, resto: { desde: 5.5, hasta: 8.5 }, retraso: null });
  });

  it('acaba hoy: todo transcurrido, sin resto y sin retraso', () => {
    expect(barraOcupante(ocupado(1, 901, '2026-10-01', HOY), eje, HOY)).toMatchObject({ hecho: { desde: 0.5, hasta: 5.5 }, resto: null, retraso: null });
  });

  it('pasado de fecha: sólido hasta el día en que debía acabar, retraso hasta hoy y, en claro, hasta el día en que se supone que sale', () => {
    const p = ocupado(1, 901, '2026-10-01', '2026-10-02', { finEstimado: '2026-10-07', pasadoDeFecha: true });
    expect(barraOcupante(p, eje, HOY)).toEqual({ hecho: { desde: 0.5, hasta: 1.5 }, retraso: { desde: 1.5, hasta: 5.5 }, resto: { desde: 5.5, hasta: 6.5 }, cortadaIzq: false, cortadaDer: false });
  });

  it('empezó antes del eje: se recorta por la izquierda y lo dice', () => {
    const p = ocupado(1, 901, '2026-09-20', '2026-09-24', { finEstimado: '2026-10-07', pasadoDeFecha: true });
    expect(barraOcupante(p, eje, HOY)).toEqual({ hecho: null, retraso: { desde: 0, hasta: 5.5 }, resto: { desde: 5.5, hasta: 6.5 }, cortadaIzq: true, cortadaDer: false });
  });

  it('acaba después del eje: se recorta por la derecha y lo dice', () => {
    expect(barraOcupante(ocupado(1, 901, '2026-10-05', '2026-12-01'), eje, HOY)).toMatchObject({ resto: { desde: 5.5, hasta: 34 }, cortadaDer: true });
  });

  it('sin duración: sólo lo transcurrido; un puesto libre no tiene barra', () => {
    expect(barraOcupante(ocupado(1, 901, '2026-10-02', null), eje, HOY)).toEqual({ hecho: { desde: 1.5, hasta: 5.5 }, resto: null, retraso: null, cortadaIzq: false, cortadaDer: false });
    expect(barraOcupante(puesto(2), eje, HOY)).toBeNull();
  });
});

describe('barras previstas', () => {
  it('de la entrada prevista al fin previsto, pegada a la del que sale', () => {
    expect(barraPrevista({ entradaPrevista: '2026-10-08', finPrevisto: '2026-10-14' }, eje)).toEqual({ franja: { desde: 7.5, hasta: 13.5 }, cortadaDer: false });
  });

  it('fuera del eje no se pinta; a caballo, se recorta; sin fechas, nada', () => {
    expect(barraPrevista({ entradaPrevista: '2026-11-10', finPrevisto: '2026-11-13' }, eje)).toEqual({ franja: null, cortadaDer: true });
    expect(barraPrevista({ entradaPrevista: '2026-10-30', finPrevisto: '2026-11-06' }, eje)).toEqual({ franja: { desde: 29.5, hasta: 34 }, cortadaDer: true });
    expect(barraPrevista({ entradaPrevista: null, finPrevisto: null }, eje)).toBeNull();
  });

  it('los previstos de un puesto: su fila y los encadenados, por entrada', () => {
    const e = etapa('verificacion', 'Verificación', {
      fila: [enFila(911, 1, { puestoPrevisto: 1, entradaPrevista: '2026-10-08', finPrevisto: '2026-10-09' }), enFila(912, 2, { puestoPrevisto: 2, entradaPrevista: '2026-10-06', finPrevisto: '2026-10-07' }), enFila(913, 3)],
      encadenados: [{ numero: 920, llegadaPrevista: '2026-10-07', puestoPrevisto: 1, entradaPrevista: '2026-10-07', finPrevisto: '2026-10-08' }],
    });
    expect(previstosDePuesto(e, 1).map((p) => [p.numero, p.encadenado])).toEqual([
      [920, true],
      [911, false],
    ]);
    expect(previstosDePuesto(e, 3)).toEqual([]);
  });
});

describe('resumen por etapa', () => {
  it('ocupados / total con su tono, tickets en la fila y primer hueco', () => {
    const e = (ocupados: number, puestos: number) => resumenEtapa(etapa('diagnostico', 'Diagnóstico', { saturacion: { ocupados, puestos }, fila: [enFila(1, 1), enFila(2, 2)], primerHueco: '2026-10-09' }));
    expect(e(1, 3)).toEqual({ ocupados: 1, puestos: 3, tono: 'verde', saturacion: 'Con sitio', enFila: 2, primerHueco: '2026-10-09' });
    expect(e(2, 3)).toMatchObject({ tono: 'ambar', saturacion: 'Casi llena' });
    expect(e(3, 3)).toMatchObject({ tono: 'rojo', saturacion: 'Llena' });
    expect(e(4, 3)).toMatchObject({ tono: 'rojo', saturacion: 'Por encima de sus puestos' });
    expect(e(0, 0)).toMatchObject({ tono: 'gris', saturacion: 'Sin puestos' });
  });
});

describe('textos', () => {
  it('rótulo de la fuente: Desk 2.0, o el respaldo con lo que no puede dar', () => {
    expect(rotuloFuente('principal')).toBe('Desk 2.0 (principal)');
    expect(rotuloFuente('respaldo')).toBe('Réplica de Zoho (respaldo) · sin prioridad · sin cierres de empresa · flujo deducido');
  });

  it('marcas de un ticket de la fila, con texto (no sólo color)', () => {
    expect(marcasDeFila(enFila(1, 1))).toEqual([]);
    const todas = marcasDeFila(enFila(1, 1, { situacion: 'entrada', marcas: { faltaRemision: true, sinTipo: true, ordenAproximado: true, prioridad: true, sinDuracion: true } }));
    expect(todas.map((m) => m.texto)).toEqual(['prioridad', 'falta fecha de remisión', 'sin tipo', 'orden aproximado', 'sin duración', 'en fila de entrada']);
    expect(todas.every((m) => m.ayuda.length > 10)).toBe(true);
  });

  it('el flujo de un ticket y de dónde sale', () => {
    const d = { numero: 1, asunto: null, estado: 'Ingresado', tipo: null, tipoManual: false, remisionEntrada: null, ultimaTransicion: null };
    expect(textoFlujo({ ...d, flujo: 'equipo_nuevo', flujoOrigen: 'clasificacion' })).toBe('Equipo nuevo · según la clasificación del ticket');
    expect(textoFlujo({ ...d, flujo: 'equipo_nuevo', flujoOrigen: 'manual' })).toBe('Equipo nuevo · marcado a mano');
    expect(textoFlujo({ ...d, flujo: 'servicio', flujoOrigen: 'deducido' })).toBe('Servicio · deducido del asunto y del código (respaldo)');
    expect(textoFlujo({ ...d, flujo: 'servicio', flujoOrigen: 'defecto' })).toBe('Servicio · por defecto: el ticket no trae clasificación');
  });

  it('última transición conocida, en hora de Colombia', () => {
    const d = { numero: 1, asunto: null, estado: 'En Proceso', tipo: null, tipoManual: false, flujo: 'servicio' as const, flujoOrigen: 'defecto' as const, remisionEntrada: null };
    expect(textoTransicion({ ...d, ultimaTransicion: { en: '2026-10-06T01:10:00.000Z', origen: 'fuente' } })).toBe('Entró en «En Proceso» el 05/10/2026 20:10 (transición registrada en Desk 2.0).');
    expect(textoTransicion({ ...d, ultimaTransicion: { en: '2026-10-06T15:00:00.000Z', origen: 'historial' } })).toBe('Entró en «En Proceso» el 06/10/2026 10:00 (cambio visto por el portal).');
    expect(textoTransicion({ ...d, ultimaTransicion: { en: '2026-10-06T15:00:00.000Z', origen: 'primera_observacion' } })).toBe('En «En Proceso» al menos desde el 06/10/2026 10:00, cuando el portal lo vio por primera vez: no consta cuándo entró.');
    expect(textoTransicion({ ...d, ultimaTransicion: null })).toBe('No consta cuándo entró en «En Proceso».');
  });

  it('el detalle de una barra junta ticket, asunto, estado, fechas y marcas; la ficha de un ticket se busca por número', () => {
    const a = agenda([], { tickets: [{ numero: 901, asunto: 'Asunto <ficticio> & "largo"', estado: 'Rev./Diagnostico', tipo: 'Diagnostico', tipoManual: true, flujo: 'servicio', flujoOrigen: 'clasificacion', remisionEntrada: '2026-09-25', ultimaTransicion: null }] });
    expect(detalleDe(a, 901)?.asunto).toBe('Asunto <ficticio> & "largo"');
    expect(detalleDe(a, 999)).toBeNull();
    const p = ocupado(2, 901, '2026-10-01', '2026-10-02', { finEstimado: '2026-10-07', pasadoDeFecha: true });
    expect(tituloOcupante(p, 'Diagnóstico', detalleDe(a, 901))).toBe(
      'Ticket 901 · Asunto <ficticio> & "largo" · Rev./Diagnostico · Diagnóstico, puesto 2 · desde 01/10/2026 · debía acabar el 02/10/2026: pasado de fecha, se supone que sale el 07/10/2026',
    );
    expect(tituloOcupante(ocupado(1, 902, '2026-10-05', '2026-10-08'), 'Proceso', null)).toBe('Ticket 902 · Rev./Diagnostico · Proceso, puesto 1 · desde 05/10/2026 · fin estimado 08/10/2026');
  });
});

describe('la ficha: dónde está un ticket y cuánto lleva en su estado', () => {
  const a = agenda(
    [
      etapa('diagnostico', 'Diagnóstico', { puestos: [ocupado(1, 901, '2026-10-05', '2026-10-08'), puesto(2)], fila: [enFila(911, 1, { puestoPrevisto: 2, entradaPrevista: HOY, finPrevisto: '2026-10-09' })] }),
      etapa('verificacion', 'Verificación', { encadenados: [{ numero: 920, llegadaPrevista: '2026-10-08', puestoPrevisto: 1, entradaPrevista: '2026-10-08', finPrevisto: '2026-10-09' }] }),
    ],
    { standby: [{ numero: 930, estado: 'Servicio externo', desde: null, dias: null }], porLlegar: [{ numero: 940, estado: 'OV asignada' }], sinCategoria: [{ clave: 'raro', estado: 'Raro', tickets: [950] }] },
  );

  it('en un puesto, en una fila, en standby, por llegar, sin categoría o en otra lista', () => {
    expect(situacionDe(a, 901)).toMatchObject({ donde: 'puesto', etiqueta: 'Diagnóstico', puesto: { puesto: 1, finEstimado: '2026-10-08' } });
    expect(situacionDe(a, 911)).toMatchObject({ donde: 'fila', etiqueta: 'Diagnóstico', fila: { posicion: 1, puestoPrevisto: 2 } });
    expect(situacionDe(a, 930)).toEqual({ donde: 'standby' });
    expect(situacionDe(a, 940)).toEqual({ donde: 'por_llegar' });
    expect(situacionDe(a, 950)).toEqual({ donde: 'sin_categoria' });
    expect(situacionDe(a, 999)).toEqual({ donde: 'otro' });
  });

  it('un encadenado se busca en su etapa de ahora; la previsión de la siguiente va aparte', () => {
    expect(situacionDe(a, 920)).toEqual({ donde: 'otro' });
    expect(encadenadoDe(a, 920)).toMatchObject({ etiqueta: 'Verificación', llegadaPrevista: '2026-10-08' });
    expect(encadenadoDe(a, 901)).toBeNull();
  });

  it('días en su estado: desde la última transición conocida, en días de Colombia; «al menos» si es una primera observación', () => {
    const d = { numero: 1, asunto: null, estado: 'Servicio externo', tipo: null, tipoManual: false, flujo: 'servicio' as const, flujoOrigen: 'defecto' as const, remisionEntrada: null };
    // 03:00 UTC del 2 de octubre es todavía el 1 en Colombia.
    expect(diasEnEstado({ ...d, ultimaTransicion: { en: '2026-10-02T03:00:00.000Z', origen: 'fuente' } }, HOY)).toBe('5 días');
    expect(diasEnEstado({ ...d, ultimaTransicion: { en: '2026-10-05T15:00:00.000Z', origen: 'historial' } }, HOY)).toBe('1 día');
    expect(diasEnEstado({ ...d, ultimaTransicion: { en: '2026-10-06T15:00:00.000Z', origen: 'primera_observacion' } }, HOY)).toBe('al menos 0 días');
    expect(diasEnEstado({ ...d, ultimaTransicion: null }, HOY)).toBe('no consta desde cuándo');
    expect(diasEnEstado(null, HOY)).toBe('no consta desde cuándo');
  });
});

describe('lista por días (teléfono)', () => {
  it('hoy, quién ocupa cada puesto; después, cada día con sus entradas previstas y sus salidas, por etapa', () => {
    const a = agenda([
      etapa('diagnostico', 'Diagnóstico', {
        puestos: [ocupado(1, 901, '2026-10-05', '2026-10-08'), ocupado(2, 902, '2026-10-01', '2026-10-02', { finEstimado: '2026-10-07', pasadoDeFecha: true }), puesto(3)],
        fila: [enFila(911, 1, { puestoPrevisto: 3, entradaPrevista: HOY, finPrevisto: '2026-10-09' }), enFila(912, 2, { puestoPrevisto: 2, entradaPrevista: '2026-10-07', finPrevisto: '2026-10-13' }), enFila(913, 3)],
      }),
      etapa('proceso', 'Proceso', { puestos: [puesto(1)] }),
      etapa('verificacion', 'Verificación', { encadenados: [{ numero: 920, llegadaPrevista: '2026-10-08', puestoPrevisto: 1, entradaPrevista: '2026-10-08', finPrevisto: '2026-10-09' }] }),
    ]);
    const lista = listaPorDias(a);
    expect(lista.map((d) => d.fecha)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-13']);
    const dia = (f: string) => lista.find((d) => d.fecha === f)!.etapas.map((e) => [e.etiqueta, e.lineas.map((l) => `${l.que} ${l.numero} p${l.puesto}${l.previsto ? ' previsto' : ''}${l.retraso ? ' retraso' : ''}`)]);
    expect(dia('2026-10-06')).toEqual([['Diagnóstico', ['ocupa 901 p1', 'ocupa 902 p2 retraso', 'entra 911 p3 previsto']]]);
    expect(dia('2026-10-07')).toEqual([['Diagnóstico', ['termina 902 p2 retraso', 'entra 912 p2 previsto']]]);
    expect(dia('2026-10-08')).toEqual([
      ['Diagnóstico', ['termina 901 p1']],
      ['Verificación', ['entra 920 p1 previsto']],
    ]);
    expect(dia('2026-10-09')).toEqual([
      ['Diagnóstico', ['termina 911 p3 previsto']],
      ['Verificación', ['termina 920 p1 previsto']],
    ]);
  });

  it('sin nada que contar, vacía', () => {
    expect(listaPorDias(agenda([etapa('diagnostico', 'Diagnóstico', { puestos: [puesto(1)] })]))).toEqual([]);
  });
});

describe('refresco automático', () => {
  it('cada dos minutos y sólo con la pestaña visible', () => {
    expect(REFRESCO_MS).toBe(120_000);
    expect(tocaRefrescar(1_000_000, 1_000_000 - REFRESCO_MS, true)).toBe(true);
    expect(tocaRefrescar(1_000_000, 1_000_000 - REFRESCO_MS + 1, true)).toBe(false);
    expect(tocaRefrescar(1_000_000, 0, false)).toBe(false);
  });
});
