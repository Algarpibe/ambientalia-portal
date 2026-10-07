import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { proponerReparto, proyectarAgenda, vuelvenDeStandby, type AgendaTaller, type AsignacionAgenda, type EntradaAgenda, type TramoHistorial } from './agenda.js';
import { esHabilAgenda } from './agenda-calendario.js';
import { ETAPAS_AGENDA, type CategoriaEstado, type DuracionEtapa, type EtapaAgenda, type FlujoAgenda } from './dominio.js';
import { UMBRAL_SINCRONIZACION_PARADA_MS, type EstadoFuente, type TicketTaller } from './fuente.js';

// Lote 3 de la agenda del taller: la proyección completa como función pura
// (docs/trazabilidad-agenda-taller.md, secciones B.5, F y H). Sin base de
// datos y con «hoy» como argumento. Números de ticket ficticios.

const HOY = '2026-10-06'; // martes; el lunes 12/10/2026 es festivo en Colombia

/** La configuración de partida: 3 puestos / 3 días, 4 / 4 y 2 / 1, sólo con la fila «*». */
const config = (puestos: Partial<Record<EtapaAgenda, number>> = {}, duraciones?: DuracionEtapa[]): EntradaAgenda['config'] => ({
  etapas: [
    { etapa: 'diagnostico', etiqueta: 'Diagnóstico', orden: 1, puestos: puestos.diagnostico ?? 3 },
    { etapa: 'proceso', etiqueta: 'Proceso', orden: 2, puestos: puestos.proceso ?? 4 },
    { etapa: 'verificacion', etiqueta: 'Verificación', orden: 3, puestos: puestos.verificacion ?? 2 },
  ],
  duraciones: duraciones ?? [
    { etapa: 'diagnostico', tipo: '*', dias: 3 },
    { etapa: 'proceso', tipo: '*', dias: 4 },
    { etapa: 'verificacion', tipo: '*', dias: 1 },
  ],
});

const fuente = (extra: Partial<EstadoFuente> = {}): EstadoFuente => ({
  fuente: 'principal',
  motivo: null,
  mensaje: null,
  ultimaSincronizacion: '2026-10-06T14:00:00.000Z',
  sincronizacionParada: false,
  umbralSincronizacionMs: UMBRAL_SINCRONIZACION_PARADA_MS,
  ultimoFalloPrincipal: null,
  ...extra,
});

const tk = (numero: number, estado: string, extra: Partial<TicketTaller> = {}): TicketTaller => ({
  numero,
  estado,
  tipoEstado: 'Open',
  clasificacion: 'Equipo Para Servicio',
  tipoServicio: 'Diagnostico',
  remisionEntrada: null,
  fechaCreacion: null,
  prioridad: null,
  llegadaEstado: null,
  asunto: null,
  codigoServicio: null,
  fuente: 'principal',
  ...extra,
});

const nuevo = (numero: number, estado: string, extra: Partial<TicketTaller> = {}) => tk(numero, estado, { clasificacion: 'Equipo Nuevo', ...extra });

const entrada = (tickets: TicketTaller[], extra: Partial<EntradaAgenda> = {}): EntradaAgenda => ({
  hoy: HOY,
  tickets,
  categorias: new Map<string, CategoriaEstado>(),
  config: config(),
  tiposManuales: new Map<number, string>(),
  cierres: [],
  estadoFuente: fuente(),
  asignaciones: [],
  ...extra,
});

const etapaDe = (a: AgendaTaller, etapa: EtapaAgenda) => a.etapas.find((e) => e.etapa === etapa)!;
const fila = (a: AgendaTaller, etapa: EtapaAgenda) => etapaDe(a, etapa).fila;
const orden = (a: AgendaTaller, etapa: EtapaAgenda) => fila(a, etapa).map((t) => t.numero);
/** [número, puesto previsto, entra, termina] de cada ticket de la fila. */
const previstos = (a: AgendaTaller, etapa: EtapaAgenda) => fila(a, etapa).map((t) => [t.numero, t.puestoPrevisto, t.entradaPrevista, t.finPrevisto]);
const asig = (numero: number, etapa: EtapaAgenda, puesto: number, desde = HOY): AsignacionAgenda => ({ numero, etapa, puesto, desde });
/** Milisegundos de un instante dado en hora de Colombia (UTC−5). */
const ms = (dia: string, hora = '10:00') => Date.parse(`${dia}T${hora}:00-05:00`);

// ── La prueba dorada: el ejemplo H ──────────────────────────────────────────

/** Los 35 abiertos del ejemplo H, con números ficticios que conservan el orden relativo de los reales. */
const ticketsH = (): TicketTaller[] => [
  // Etapa Diagnóstico (7)
  tk(7093, 'Rev./Diagnostico', { remisionEntrada: '2026-09-18' }),
  tk(7099, 'Rev./Diagnostico', { remisionEntrada: '2026-08-31' }),
  tk(7105, 'Rev./Diagnostico', { remisionEntrada: '2026-09-25' }),
  tk(7106, 'Rev./Diagnostico', { remisionEntrada: '2026-09-25' }),
  tk(7107, 'Rev./Diagnostico', { remisionEntrada: '2026-09-25' }),
  tk(7110, 'Rev./Diagnostico', { remisionEntrada: '2026-10-02' }),
  tk(17005, 'Rev./Diagnostico', { remisionEntrada: '2026-09-29', llegadaEstado: ms('2026-09-30'), clasificacion: 'Equipo para servicio de mantenimiento' }),
  // Etapa Proceso (3)
  ...[7084, 7090, 7109].map((n) => tk(n, 'En Proceso', { remisionEntrada: '2026-08-10' })),
  // Fila de entrada (3), sin fecha de remisión
  ...[6880, 6881, 6882].map((n) => tk(n, 'Ingresado')),
  // Standby (15): cuatro de ellos son equipo nuevo
  ...[7091, 7103, 7104].map((n) => tk(n, 'Servicio externo', { remisionEntrada: '2026-09-01', tipoEstado: 'On Hold' })),
  ...[7100, 7101, 7102, 7108].map((n) => nuevo(n, 'Servicio externo', { remisionEntrada: '2026-09-01', tipoEstado: 'On Hold' })),
  ...[6689, 7048, 7058, 7062, 7075].map((n) => tk(n, 'Notificación cliente', { remisionEntrada: '2026-07-01', tipoEstado: 'On Hold' })),
  tk(7068, 'Notificación cliente', { tipoServicio: null, tipoEstado: 'On Hold' }),
  tk(7076, 'En Espera de Repuestos', { remisionEntrada: '2026-07-01', tipoEstado: 'On Hold' }),
  tk(7078, 'En espera de SKU inventario', { remisionEntrada: '2026-07-01', tipoEstado: 'On Hold' }),
  // Fin de taller (6)
  ...[7077, 7081, 7082, 7083, 7092].map((n) => tk(n, 'Por Facturar', { remisionEntrada: '2026-07-01', tipoEstado: 'On Hold' })),
  tk(7085, 'Por Entregar', { remisionEntrada: '2026-07-01' }),
  // Por llegar (1)
  tk(7096, 'OV asignada', { clasificacion: null, tipoEstado: 'On Hold' }),
];

describe('prueba dorada: el ejemplo H (06/10/2026, 3/3 · 4/4 · 2/1)', () => {
  it('el reparto por categoría suma los 35 abiertos', () => {
    const a = proyectarAgenda(entrada(ticketsH()));
    expect(a.totalAbiertos).toBe(35);
    expect(a.etapas.map((e) => e.etapa)).toEqual(['diagnostico', 'proceso', 'verificacion']);
    expect(a.etapas.map((e) => e.fila.length)).toEqual([10, 3, 0]);
    expect(a.standby).toHaveLength(15);
    expect(a.porLlegar).toEqual([{ numero: 7096, estado: 'OV asignada' }]);
    expect(a.finTaller).toBe(6);
    expect(a.fueraAgenda).toBe(0);
    expect(a.sinCategoria).toEqual([]);
    expect(a.avisos).toEqual([]);
  });

  it('sin asignaciones todo Diagnóstico está en su fila, por fecha de remisión, y se reparte FIFO desde hoy', () => {
    const a = proyectarAgenda(entrada(ticketsH()));
    expect(previstos(a, 'diagnostico')).toEqual([
      [7099, 1, '2026-10-06', '2026-10-09'],
      [7093, 2, '2026-10-06', '2026-10-09'],
      [7105, 3, '2026-10-06', '2026-10-09'],
      [7106, 1, '2026-10-09', '2026-10-15'],
      [7107, 2, '2026-10-09', '2026-10-15'],
      [17005, 3, '2026-10-09', '2026-10-15'],
      [7110, 1, '2026-10-15', '2026-10-20'],
      [6880, 2, '2026-10-15', '2026-10-20'],
      [6881, 3, '2026-10-15', '2026-10-20'],
      [6882, 1, '2026-10-20', '2026-10-23'],
    ]);
    const d = etapaDe(a, 'diagnostico');
    expect(d.fila.map((t) => t.posicion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(d.fila.map((t) => t.situacion)).toEqual([...Array(7).fill('en_etapa'), 'entrada', 'entrada', 'entrada']);
    expect(d.fila.map((t) => t.motivo)).toEqual([...Array(7).fill('remision'), 'sin_remision', 'sin_remision', 'sin_remision']);
    expect(d.fila.filter((t) => t.marcas.faltaRemision).map((t) => t.numero)).toEqual([6880, 6881, 6882]);
    // Los tres del 25/09 comparten día y ninguno tiene llegada exacta: decide el número.
    expect(d.fila.filter((t) => t.marcas.ordenAproximado).map((t) => t.numero)).toEqual([7105, 7106, 7107]);
    expect(d.fila.some((t) => t.marcas.sinTipo || t.marcas.sinDuracion || t.marcas.prioridad)).toBe(false);
    expect(d.puestos.map((p) => p.ocupante)).toEqual([null, null, null]);
    expect(d.saturacion).toEqual({ ocupados: 0, puestos: 3 });
    expect(d.primerHueco).toBe('2026-10-20');
  });

  it('Proceso: tres en fila hasta el martes 13 (el lunes 12 es festivo) y un hueco hoy; Verificación, vacía', () => {
    const a = proyectarAgenda(entrada(ticketsH()));
    expect(previstos(a, 'proceso')).toEqual([
      [7084, 1, '2026-10-06', '2026-10-13'],
      [7090, 2, '2026-10-06', '2026-10-13'],
      [7109, 3, '2026-10-06', '2026-10-13'],
    ]);
    expect(fila(a, 'proceso').every((t) => t.marcas.ordenAproximado && t.motivo === 'numero')).toBe(true);
    expect(etapaDe(a, 'proceso').primerHueco).toBe(HOY);
    expect(etapaDe(a, 'proceso').saturacion).toEqual({ ocupados: 0, puestos: 4 });
    const v = etapaDe(a, 'verificacion');
    expect([v.fila, v.encadenados, v.primerHueco, v.saturacion]).toEqual([[], [], HOY, { ocupados: 0, puestos: 2 }]);
  });

  it('con el reparto inicial de H ya confirmado salen sus dos tablas: puestos y fila', () => {
    const asignaciones = [asig(7099, 'diagnostico', 1), asig(7093, 'diagnostico', 2), asig(7105, 'diagnostico', 3), asig(7084, 'proceso', 1), asig(7090, 'proceso', 2), asig(7109, 'proceso', 3)];
    const a = proyectarAgenda(entrada(ticketsH(), { asignaciones }));
    const d = etapaDe(a, 'diagnostico');
    expect(d.puestos.map((p) => [p.puesto, p.ocupante?.numero, p.inicio, p.finEstimado, p.pasadoDeFecha])).toEqual([
      [1, 7099, '2026-10-06', '2026-10-09', false],
      [2, 7093, '2026-10-06', '2026-10-09', false],
      [3, 7105, '2026-10-06', '2026-10-09', false],
    ]);
    expect(previstos(a, 'diagnostico')).toEqual([
      [7106, 1, '2026-10-09', '2026-10-15'],
      [7107, 2, '2026-10-09', '2026-10-15'],
      [17005, 3, '2026-10-09', '2026-10-15'],
      [7110, 1, '2026-10-15', '2026-10-20'],
      [6880, 2, '2026-10-15', '2026-10-20'],
      [6881, 3, '2026-10-15', '2026-10-20'],
      [6882, 1, '2026-10-20', '2026-10-23'],
    ]);
    expect([d.saturacion, d.primerHueco]).toEqual([{ ocupados: 3, puestos: 3 }, '2026-10-20']);
    const p = etapaDe(a, 'proceso');
    expect(p.puestos.map((x) => [x.puesto, x.ocupante?.numero ?? null, x.finEstimado])).toEqual([
      [1, 7084, '2026-10-13'],
      [2, 7090, '2026-10-13'],
      [3, 7109, '2026-10-13'],
      [4, null, null],
    ]);
    expect([p.fila, p.saturacion, p.primerHueco]).toEqual([[], { ocupados: 3, puestos: 4 }, HOY]);
    expect(a.totalAbiertos).toBe(35);
  });
});

// ── La fila de la primera etapa (D12) ───────────────────────────────────────

describe('fila de la primera etapa (D12)', () => {
  it('una sola fila: un «Ingresado» que llegó antes va por delante de quien ya está en la etapa sin puesto', () => {
    const a = proyectarAgenda(entrada([tk(510, 'Rev./Diagnostico', { remisionEntrada: '2026-09-25' }), tk(520, 'Ingresado', { remisionEntrada: '2026-09-20' })]));
    expect(orden(a, 'diagnostico')).toEqual([520, 510]);
    expect(fila(a, 'diagnostico').map((t) => t.situacion)).toEqual(['entrada', 'en_etapa']);
    expect(fila(a, 'diagnostico').some((t) => t.marcas.ordenAproximado)).toBe(false);
  });

  it('empate de día: primero el que tiene llegada exacta y luego el de número más bajo', () => {
    const dia = { remisionEntrada: '2026-09-25' };
    const a = proyectarAgenda(entrada([tk(530, 'Ingresado', dia), tk(531, 'Ingresado', dia), tk(532, 'Ingresado', { ...dia, llegadaEstado: ms('2026-09-25') }), tk(529, 'Ingresado', { remisionEntrada: '2026-09-26' })]));
    expect(orden(a, 'diagnostico')).toEqual([532, 530, 531, 529]);
    // El 532 no empata con nadie de su clase; 530 y 531 los separa el número.
    expect(fila(a, 'diagnostico').map((t) => t.marcas.ordenAproximado)).toEqual([false, true, true, false]);
  });

  it('sin fecha de remisión: al final y con la marca; en cuanto la tiene ocupa su sitio', () => {
    const base = [tk(540, 'Ingresado'), tk(541, 'Rev./Diagnostico', { remisionEntrada: '2026-10-01' }), tk(542, 'Remisión creada', { remisionEntrada: '2026-09-30' })];
    const a = proyectarAgenda(entrada(base));
    expect(orden(a, 'diagnostico')).toEqual([542, 541, 540]);
    expect(fila(a, 'diagnostico').map((t) => [t.motivo, t.marcas.faltaRemision])).toEqual([['remision', false], ['remision', false], ['sin_remision', true]]);
    const b = proyectarAgenda(entrada([{ ...base[0], remisionEntrada: '2026-09-01' }, base[1], base[2]]));
    expect(orden(b, 'diagnostico')).toEqual([540, 542, 541]);
  });

  it('en respaldo, sin fecha de remisión en ningún ticket: por llegada y número, sin la marca (D8)', () => {
    const r = (n: number, estado: string) => tk(n, estado, { fuente: 'respaldo', clasificacion: null });
    const a = proyectarAgenda(entrada([r(552, 'Ingresado'), r(550, 'Rev./Diagnostico'), r(551, 'Ingresado')], { estadoFuente: fuente({ fuente: 'respaldo', motivo: 'sin_variable', mensaje: 'Respaldo.' }) }));
    expect(orden(a, 'diagnostico')).toEqual([550, 551, 552]);
    expect(fila(a, 'diagnostico').map((t) => [t.motivo, t.marcas.faltaRemision, t.marcas.ordenAproximado])).toEqual(Array(3).fill(['numero', false, true]));
  });

  it('en respaldo, si la réplica sí trae la fecha, vale la regla de siempre', () => {
    const r = (n: number, remisionEntrada: string | null) => tk(n, 'Ingresado', { fuente: 'respaldo', clasificacion: null, remisionEntrada });
    const a = proyectarAgenda(entrada([r(560, null), r(561, '2026-09-10')]));
    expect(orden(a, 'diagnostico')).toEqual([561, 560]);
    expect(fila(a, 'diagnostico')[1].marcas.faltaRemision).toBe(true);
  });

  it('la etapa inicial depende del flujo: el equipo nuevo espera Proceso, no Diagnóstico', () => {
    const a = proyectarAgenda(entrada([nuevo(570, 'Ingresado', { remisionEntrada: '2026-10-01' }), tk(571, 'Ingresado', { remisionEntrada: '2026-10-01' })]));
    expect(orden(a, 'diagnostico')).toEqual([571]);
    expect(orden(a, 'proceso')).toEqual([570]);
    expect(fila(a, 'proceso')[0]).toMatchObject({ flujo: 'equipo_nuevo', situacion: 'entrada', entradaPrevista: HOY, finPrevisto: '2026-10-13' });
  });

  it('en respaldo el flujo se deduce del asunto o del código (D11)', () => {
    const r = (n: number, extra: Partial<TicketTaller>) => tk(n, 'Ingresado', { fuente: 'respaldo', clasificacion: null, ...extra });
    const a = proyectarAgenda(entrada([r(575, { asunto: 'Equipo Nuevo instalación' }), r(576, { codigoServicio: 'HV_00A00001_X_261002' }), r(577, { asunto: 'Mantenimiento' })]));
    expect([orden(a, 'proceso'), orden(a, 'diagnostico')]).toEqual([[575, 576], [577]]);
  });

  it('la marca manual de flujo gana a la fuente y cambia a qué etapa alimenta', () => {
    const tickets = [tk(580, 'Ingresado', { remisionEntrada: '2026-10-01' }), nuevo(581, 'Ingresado', { remisionEntrada: '2026-10-01' })];
    const a = proyectarAgenda(entrada(tickets, { flujosManuales: new Map<number, FlujoAgenda>([[580, 'equipo_nuevo'], [581, 'servicio']]) }));
    expect([orden(a, 'proceso'), orden(a, 'diagnostico')]).toEqual([[580], [581]]);
  });
});

// ── Etapas siguientes, vuelta de standby y prioridad ────────────────────────

describe('etapas siguientes y vuelta de standby', () => {
  it('etapa siguiente: por llegada al estado; quien no la tiene, detrás y por número, con «orden aproximado»', () => {
    const a = proyectarAgenda(
      entrada([
        tk(603, 'En Proceso', { remisionEntrada: '2026-08-01' }),
        tk(601, 'En Proceso'),
        tk(602, 'Continuación del proceso', { llegadaEstado: ms('2026-10-02') }),
        tk(600, 'En Proceso', { llegadaEstado: ms('2026-10-05') }),
      ]),
    );
    expect(orden(a, 'proceso')).toEqual([602, 600, 601, 603]);
    expect(fila(a, 'proceso').map((t) => [t.motivo, t.marcas.ordenAproximado])).toEqual([['llegada', false], ['llegada', false], ['numero', true], ['numero', true]]);
    // La fecha de remisión no cuenta fuera de la primera etapa, ni falta.
    expect(fila(a, 'proceso').some((t) => t.marcas.faltaRemision)).toBe(false);
  });

  it('empate de llegada: decide el número y se marca «orden aproximado»', () => {
    const llegadaEstado = ms('2026-10-02');
    const a = proyectarAgenda(entrada([tk(611, 'En Proceso', { llegadaEstado }), tk(610, 'En Proceso', { llegadaEstado }), tk(612, 'En Proceso', { llegadaEstado: ms('2026-10-03') })]));
    expect(orden(a, 'proceso')).toEqual([610, 611, 612]);
    expect(fila(a, 'proceso').map((t) => t.marcas.ordenAproximado)).toEqual([true, true, false]);
  });

  it('más tickets que puestos en una etapa siguiente: los que no caben esperan en su fila, «en etapa sin puesto»', () => {
    const tickets = [620, 621, 622].map((n, i) => tk(n, 'En Proceso', { llegadaEstado: ms(`2026-10-0${i + 1}`) }));
    const a = proyectarAgenda(entrada(tickets, { config: config({ proceso: 2 }), asignaciones: [asig(620, 'proceso', 1), asig(621, 'proceso', 2)] }));
    expect(previstos(a, 'proceso')).toEqual([[622, 1, '2026-10-13', '2026-10-19']]);
    expect(fila(a, 'proceso')[0].situacion).toBe('en_etapa');
  });

  it('quien vuelve de standby a la primera etapa no entra en la fila única: va al final, por el momento en que volvió', () => {
    const tickets = [
      tk(630, 'Rev./Diagnostico', { remisionEntrada: '2026-08-01', llegadaEstado: ms('2026-10-05') }),
      tk(631, 'Rev./Diagnostico', { remisionEntrada: '2026-08-02', llegadaEstado: ms('2026-10-03') }),
      tk(632, 'Ingresado'),
      tk(633, 'Rev./Diagnostico', { remisionEntrada: '2026-09-30' }),
      tk(634, 'Notificado', { remisionEntrada: '2026-07-01' }),
    ];
    const a = proyectarAgenda(entrada(tickets, { vuelvenDeStandby: [630, 631, 634] }));
    expect(orden(a, 'diagnostico')).toEqual([633, 632, 631, 630, 634]);
    expect(fila(a, 'diagnostico').map((t) => [t.motivo, t.marcas.ordenAproximado])).toEqual([
      ['remision', false],
      ['sin_remision', false],
      ['vuelta_standby', false],
      ['vuelta_standby', false],
      ['vuelta_standby', true],
    ]);
    // Sin esa noticia del historial, la fecha de remisión los pondría los primeros.
    expect(orden(proyectarAgenda(entrada(tickets)), 'diagnostico')).toEqual([634, 630, 631, 633, 632]);
  });

  it('standby libera: no ocupa puesto ni se proyecta, y dice los días que lleva', () => {
    const a = proyectarAgenda(
      entrada([tk(641, 'Notificación  Comercial', { llegadaEstado: ms('2026-10-01', '23:30') }), tk(640, 'Servicio externo'), tk(642, 'Solicitado', { llegadaEstado: ms('2026-10-06', '08:00') })], {
        // Una asignación que aún no se ha cerrado no retiene a quien ya está en standby: manda su estado.
        asignaciones: [asig(640, 'diagnostico', 1)],
      }),
    );
    expect(a.standby).toEqual([
      { numero: 640, estado: 'Servicio externo', desde: null, dias: null },
      { numero: 641, estado: 'Notificación Comercial', desde: '2026-10-01', dias: 5 },
      { numero: 642, estado: 'Solicitado', desde: '2026-10-06', dias: 0 },
    ]);
    expect(a.etapas.every((e) => e.fila.length === 0 && e.puestos.every((p) => p.ocupante === null))).toBe(true);
  });

  it('D1: la prioridad fijada va por delante de todo lo demás, de mayor a menor', () => {
    const tickets = [
      tk(650, 'Rev./Diagnostico', { remisionEntrada: '2026-08-01' }),
      tk(651, 'Ingresado', { prioridad: 'High' }),
      tk(652, 'Rev./Diagnostico', { remisionEntrada: '2026-09-01', prioridad: 'Urgent', llegadaEstado: ms('2026-10-05') }),
      tk(653, 'Ingresado', { remisionEntrada: '2026-08-02', prioridad: 'Inventada' }),
    ];
    const a = proyectarAgenda(entrada(tickets, { vuelvenDeStandby: [652] }));
    expect(orden(a, 'diagnostico')).toEqual([652, 651, 650, 653]);
    expect(fila(a, 'diagnostico').map((t) => [t.motivo, t.marcas.prioridad])).toEqual([['prioridad', true], ['prioridad', true], ['remision', false], ['remision', false]]);
  });

  it('D1: una prioridad que no viene de la fuente principal no cuenta', () => {
    const r = (n: number, extra: Partial<TicketTaller>) => tk(n, 'Ingresado', { fuente: 'respaldo', clasificacion: null, ...extra });
    const a = proyectarAgenda(entrada([r(660, { remisionEntrada: '2026-09-01' }), r(661, { remisionEntrada: '2026-09-02', prioridad: 'Urgent' })]));
    expect(orden(a, 'diagnostico')).toEqual([660, 661]);
    expect(fila(a, 'diagnostico')[1].marcas.prioridad).toBe(false);
  });
});

// ── Duración y calendario ───────────────────────────────────────────────────

describe('duración (D9) y días hábiles (D3)', () => {
  const duraciones: DuracionEtapa[] = [
    { etapa: 'diagnostico', tipo: '*', dias: 3 },
    { etapa: 'diagnostico', tipo: 'calibracion', dias: 1 },
    { etapa: 'diagnostico', tipo: 'mantenimiento', dias: 5 },
  ];
  const cfg = config({ diagnostico: 10 }, duraciones);
  const de = (t: TicketTaller, extra: Partial<EntradaAgenda> = {}) => fila(proyectarAgenda(entrada([{ ...t, remisionEntrada: '2026-10-01' }], { config: cfg, ...extra })), 'diagnostico')[0];

  it('tipo puesto a mano → tipo de la fuente → fila «*»', () => {
    expect(de(tk(700, 'Ingresado', { tipoServicio: 'Calibración' }))).toMatchObject({ duracionDias: 1, finPrevisto: '2026-10-07' });
    expect(de(tk(700, 'Ingresado', { tipoServicio: 'Calibración' }), { tiposManuales: new Map([[700, 'mantenimiento']]) })).toMatchObject({ duracionDias: 5, finPrevisto: '2026-10-14' });
    expect(de(tk(700, 'Ingresado', { tipoServicio: 'Garantía' }))).toMatchObject({ duracionDias: 3, finPrevisto: '2026-10-09', marcas: { sinTipo: false, sinDuracion: false } });
  });

  it('sin tipo: la «*» de la etapa y la marca «sin tipo»', () => {
    expect(de(tk(701, 'Ingresado', { tipoServicio: null }))).toMatchObject({ duracionDias: 3, finPrevisto: '2026-10-09', marcas: { sinTipo: true, sinDuracion: false } });
  });

  it('sin duración (ni la «*»): marca, sin fechas previstas y sin reservar puesto a los de detrás', () => {
    const tickets = [nuevo(710, 'Ingresado', { remisionEntrada: '2026-09-01' }), tk(711, 'Rev./Diagnostico', { remisionEntrada: '2026-09-02' }), tk(712, 'Verificación')];
    const a = proyectarAgenda(entrada(tickets, { config: config({ diagnostico: 1 }, [{ etapa: 'diagnostico', tipo: '*', dias: 3 }]) }));
    expect(fila(a, 'proceso')[0]).toMatchObject({ numero: 710, posicion: 1, duracionDias: null, puestoPrevisto: null, entradaPrevista: null, finPrevisto: null, marcas: { sinDuracion: true } });
    expect(fila(a, 'verificacion')[0]).toMatchObject({ numero: 712, entradaPrevista: null, finPrevisto: null, marcas: { sinDuracion: true } });
    expect(etapaDe(a, 'proceso').primerHueco).toBe(HOY);
    expect(previstos(a, 'diagnostico')).toEqual([[711, 1, HOY, '2026-10-09']]);
  });

  it('un ocupante sin duración no tiene fin estimado y su puesto no se promete a nadie', () => {
    const tickets = [tk(720, 'En Proceso'), tk(721, 'En Proceso'), tk(722, 'En Proceso')];
    const a = proyectarAgenda(entrada(tickets, { config: config({ proceso: 1 }, []), asignaciones: [asig(720, 'proceso', 1)] }));
    const p = etapaDe(a, 'proceso');
    expect(p.puestos[0]).toMatchObject({ ocupante: { numero: 720, marcas: { sinDuracion: true } }, inicio: HOY, finEstimado: null, pasadoDeFecha: false });
    expect(previstos(a, 'proceso')).toEqual([[721, null, null, null], [722, null, null, null]]);
    expect(p.primerHueco).toBeNull();
  });

  it('un festivo y un cierre de empresa en mitad de una duración la alargan', () => {
    const t = [tk(730, 'Ingresado', { remisionEntrada: '2026-10-01' })];
    // Desde el jueves 08/10: vie 9, (lun 12 festivo) mar 13, mié 14.
    expect(previstos(proyectarAgenda(entrada(t, { hoy: '2026-10-08' })), 'diagnostico')).toEqual([[730, 1, '2026-10-08', '2026-10-14']]);
    // Con la empresa cerrada el martes 13: vie 9, mié 14, jue 15.
    expect(previstos(proyectarAgenda(entrada(t, { hoy: '2026-10-08', cierres: ['2026-10-13'] })), 'diagnostico')).toEqual([[730, 1, '2026-10-08', '2026-10-15']]);
  });

  it('una etapa sin puestos no promete fechas ni hueco', () => {
    const a = proyectarAgenda(entrada([tk(740, 'Ingresado', { remisionEntrada: '2026-10-01' })], { config: config({ diagnostico: 0 }) }));
    expect(previstos(a, 'diagnostico')).toEqual([[740, null, null, null]]);
    expect(etapaDe(a, 'diagnostico')).toMatchObject({ puestos: [], primerHueco: null, saturacion: { ocupados: 0, puestos: 0 } });
  });
});

// ── Puestos ocupados (asignaciones vigentes: las crea el lote 4) ────────────

describe('puestos con asignación vigente', () => {
  const uno = config({ diagnostico: 1 });

  it('pasado de fecha: sigue ocupando, sale el siguiente día hábil y empuja la fila cada día que siga ahí', () => {
    const tickets = [tk(800, 'Rev./Diagnostico'), tk(801, 'Ingresado', { remisionEntrada: '2026-10-01' })];
    // Desde el lunes 28/09, tres días: debía acabar el jueves 01/10.
    const con = (hoy: string) => proyectarAgenda(entrada(tickets, { hoy, config: uno, asignaciones: [asig(800, 'diagnostico', 1, '2026-09-28')] }));
    const a = con(HOY);
    expect(etapaDe(a, 'diagnostico').puestos).toEqual([
      { puesto: 1, ocupante: { numero: 800, estado: 'Rev./Diagnostico', marcas: { sinTipo: false, sinDuracion: false, sinDatosFuente: false } }, inicio: '2026-09-28', finEstimado: '2026-10-07', pasadoDeFecha: true, aExtinguir: false },
    ]);
    expect(previstos(a, 'diagnostico')).toEqual([[801, 1, '2026-10-07', '2026-10-13']]);
    expect(etapaDe(a, 'diagnostico').primerHueco).toBe('2026-10-13');
    const b = con('2026-10-07');
    expect(etapaDe(b, 'diagnostico').puestos[0]).toMatchObject({ finEstimado: '2026-10-08', pasadoDeFecha: true });
    expect(previstos(b, 'diagnostico')).toEqual([[801, 1, '2026-10-08', '2026-10-14']]);
  });

  it('quien acaba hoy no va pasado de fecha: su puesto queda libre hoy mismo', () => {
    const tickets = [tk(810, 'Rev./Diagnostico'), tk(811, 'Ingresado', { remisionEntrada: '2026-10-01' })];
    // Desde el jueves 01/10: vie 2, lun 5, mar 6.
    const a = proyectarAgenda(entrada(tickets, { config: uno, asignaciones: [asig(810, 'diagnostico', 1, '2026-10-01')] }));
    expect(etapaDe(a, 'diagnostico').puestos[0]).toMatchObject({ finEstimado: HOY, pasadoDeFecha: false });
    expect(previstos(a, 'diagnostico')).toEqual([[811, 1, HOY, '2026-10-09']]);
  });

  it('D2: «Notificado» ocupa su puesto de Diagnóstico', () => {
    const a = proyectarAgenda(entrada([tk(820, 'Notificado'), tk(821, 'Notificado')], { asignaciones: [asig(820, 'diagnostico', 2)] }));
    const d = etapaDe(a, 'diagnostico');
    expect(d.puestos.map((p) => p.ocupante?.numero ?? null)).toEqual([null, 820, null]);
    expect(d.saturacion).toEqual({ ocupados: 1, puestos: 3 });
    expect(orden(a, 'diagnostico')).toEqual([821]);
    expect(a.standby).toEqual([]);
  });

  it('puestos reducidos estando ocupados: nadie se desaloja; el de sobra queda «a extinguir» y no recibe a nadie', () => {
    const tickets = [tk(830, 'Rev./Diagnostico'), tk(831, 'Rev./Diagnostico'), tk(832, 'Ingresado', { remisionEntrada: '2026-10-01' }), tk(833, 'Ingresado', { remisionEntrada: '2026-10-02' })];
    const a = proyectarAgenda(entrada(tickets, { config: uno, asignaciones: [asig(830, 'diagnostico', 1, '2026-10-05'), asig(831, 'diagnostico', 3)] }));
    const d = etapaDe(a, 'diagnostico');
    expect(d.puestos.map((p) => [p.puesto, p.ocupante?.numero, p.finEstimado, p.aExtinguir])).toEqual([
      [1, 830, '2026-10-08', false],
      [3, 831, '2026-10-09', true],
    ]);
    // La saturación supera el 100 %.
    expect(d.saturacion).toEqual({ ocupados: 2, puestos: 1 });
    expect(previstos(a, 'diagnostico')).toEqual([
      [832, 1, '2026-10-08', '2026-10-14'],
      [833, 1, '2026-10-14', '2026-10-19'],
    ]);
  });

  it('en respaldo, un ticket que sólo existe en Desk 2.0 conserva su puesto, marcado «sin datos de la fuente»', () => {
    const r = tk(841, 'Ingresado', { fuente: 'respaldo', clasificacion: null });
    const a = proyectarAgenda(entrada([r], { config: uno, asignaciones: [asig(840, 'diagnostico', 1, '2026-10-05')], estadoFuente: fuente({ fuente: 'respaldo', motivo: 'timeout', mensaje: 'Respaldo.' }) }));
    expect(etapaDe(a, 'diagnostico').puestos[0]).toEqual({
      puesto: 1,
      ocupante: { numero: 840, estado: null, marcas: { sinTipo: true, sinDuracion: false, sinDatosFuente: true } },
      inicio: '2026-10-05',
      finEstimado: '2026-10-08',
      pasadoDeFecha: false,
      aExtinguir: false,
    });
    expect(previstos(a, 'diagnostico')).toEqual([[841, 1, '2026-10-08', '2026-10-14']]);
    expect(a.totalAbiertos).toBe(1);
  });

  it('una asignación que no cuadra con el estado del ticket, o repetida, no cuenta', () => {
    const tickets = [tk(850, 'En Proceso'), tk(851, 'Rev./Diagnostico'), tk(852, 'Rev./Diagnostico')];
    const asignaciones = [asig(850, 'diagnostico', 1), asig(851, 'diagnostico', 2), asig(852, 'diagnostico', 2), asig(851, 'diagnostico', 3)];
    const a = proyectarAgenda(entrada(tickets, { asignaciones }));
    expect(etapaDe(a, 'diagnostico').puestos.map((p) => p.ocupante?.numero ?? null)).toEqual([null, 851, null]);
    expect(orden(a, 'diagnostico')).toEqual([852]);
    expect(orden(a, 'proceso')).toEqual([850]);
  });
});

// ── Cadena de equipo nuevo ──────────────────────────────────────────────────

describe('equipo nuevo: Proceso → Verificación', () => {
  it('se proyecta en cadena: la llegada prevista a Verificación es el fin previsto en Proceso', () => {
    const tickets = [
      nuevo(900, 'Ingresado', { remisionEntrada: '2026-10-01' }),
      nuevo(901, 'En Proceso', { remisionEntrada: '2026-10-02' }),
      nuevo(902, 'Verificación'),
      nuevo(903, 'En Proceso', { remisionEntrada: '2026-09-01' }),
      tk(904, 'En Proceso'),
    ];
    const a = proyectarAgenda(entrada(tickets, { asignaciones: [asig(903, 'proceso', 1, '2026-10-02')] }));
    // 903 ocupa desde el vie 02/10: lun 5, mar 6, mié 7, jue 8.
    expect(etapaDe(a, 'proceso').puestos[0]).toMatchObject({ ocupante: { numero: 903 }, finEstimado: '2026-10-08' });
    expect(previstos(a, 'proceso')).toEqual([
      [900, 2, HOY, '2026-10-13'],
      [901, 3, HOY, '2026-10-13'],
      [904, 4, HOY, '2026-10-13'],
    ]);
    const v = etapaDe(a, 'verificacion');
    expect(previstos(a, 'verificacion')).toEqual([[902, 1, HOY, '2026-10-07']]);
    // El hueco es el de la fila propia; los encadenados son previsión.
    expect(v.primerHueco).toBe(HOY);
    expect(v.encadenados).toEqual([
      { numero: 903, llegadaPrevista: '2026-10-08', puestoPrevisto: 2, entradaPrevista: '2026-10-08', finPrevisto: '2026-10-09' },
      { numero: 900, llegadaPrevista: '2026-10-13', puestoPrevisto: 1, entradaPrevista: '2026-10-13', finPrevisto: '2026-10-14' },
      { numero: 901, llegadaPrevista: '2026-10-13', puestoPrevisto: 2, entradaPrevista: '2026-10-13', finPrevisto: '2026-10-14' },
    ]);
    // El 904 viene a servicio: no sigue a Verificación.
    expect(v.encadenados.some((t) => t.numero === 904)).toBe(false);
  });

  it('con Verificación llena, el encadenado espera su turno', () => {
    const tickets = [nuevo(910, 'En Proceso'), nuevo(911, 'En Proceso'), nuevo(912, 'En Proceso')];
    const a = proyectarAgenda(entrada(tickets, { config: config({ verificacion: 1 }, [{ etapa: 'proceso', tipo: '*', dias: 1 }, { etapa: 'verificacion', tipo: '*', dias: 2 }]) }));
    expect(etapaDe(a, 'verificacion').encadenados.map((t) => [t.numero, t.entradaPrevista, t.finPrevisto])).toEqual([
      [910, '2026-10-07', '2026-10-09'],
      [911, '2026-10-09', '2026-10-14'],
      [912, '2026-10-14', '2026-10-16'],
    ]);
  });

  it('Diagnóstico no encadena con Proceso: entre ambas hay standby, que no se proyecta', () => {
    const a = proyectarAgenda(entrada([tk(920, 'Rev./Diagnostico', { remisionEntrada: '2026-10-01' }), tk(921, 'Ingresado', { remisionEntrada: '2026-10-02' })]));
    expect([fila(a, 'proceso'), etapaDe(a, 'proceso').encadenados, etapaDe(a, 'verificacion').encadenados, etapaDe(a, 'diagnostico').encadenados]).toEqual([[], [], [], []]);
  });
});

// ── Listas aparte y avisos globales ─────────────────────────────────────────

describe('listas aparte', () => {
  it('por llegar, fin de taller y fuera de la agenda (D10) no entran en ninguna fila', () => {
    const a = proyectarAgenda(entrada([tk(1001, 'Ticket creado'), tk(1000, 'OV asignada'), tk(1002, 'Por Facturar'), tk(1003, 'Liberación Comercial'), tk(1004, 'Pendiente'), tk(1005, 'Solicitud Soporte'), tk(1006, 'solicitud  SOPORTE')]));
    expect(a.porLlegar).toEqual([{ numero: 1000, estado: 'OV asignada' }, { numero: 1001, estado: 'Ticket creado' }]);
    expect([a.finTaller, a.fueraAgenda, a.standby, a.sinCategoria]).toEqual([2, 3, [], []]);
    expect(a.etapas.every((e) => e.fila.length === 0)).toBe(true);
  });

  it('un estado sin categoría es caso propio: ni se cuela en otra lista ni se pierde, y se avisa', () => {
    const a = proyectarAgenda(entrada([tk(1012, 'Estado  Inventado'), tk(1010, 'estado inventado'), tk(1011, ''), tk(1013, 'Ingresado', { remisionEntrada: '2026-10-01' })]));
    expect(a.sinCategoria).toEqual([
      { clave: '', estado: '', tickets: [1011] },
      { clave: 'estado inventado', estado: 'estado inventado', tickets: [1010, 1012] },
    ]);
    expect(orden(a, 'diagnostico')).toEqual([1013]);
    expect([a.standby.length, a.porLlegar.length, a.finTaller, a.fueraAgenda]).toEqual([0, 0, 0, 0]);
    expect(a.avisos.map((x) => x.codigo)).toEqual(['estados_sin_categoria']);
    expect(a.avisos[0].mensaje).toContain('2 estados');
  });

  it('la categoría guardada gana al catálogo, también para un estado que el catálogo no conoce', () => {
    const categorias = new Map<string, CategoriaEstado>([
      ['estado inventado', { categoria: 'activa', etapa: 'verificacion' }],
      ['ingresado', { categoria: 'fuera', etapa: null }],
      ['por facturar', { categoria: 'standby', etapa: null }],
    ]);
    const a = proyectarAgenda(entrada([tk(1020, 'Estado Inventado'), tk(1021, 'Ingresado'), tk(1022, 'Por Facturar')], { categorias }));
    expect(orden(a, 'verificacion')).toEqual([1020]);
    expect([a.fueraAgenda, a.finTaller, a.standby.map((t) => t.numero), a.sinCategoria, a.avisos]).toEqual([1, 0, [1022], [], []]);
  });

  it('las etapas salen en el orden configurado, y una que falte en la configuración sale sin puestos en vez de perder sus tickets', () => {
    const cfg: EntradaAgenda['config'] = { etapas: [{ etapa: 'proceso', etiqueta: 'Taller', orden: 1, puestos: 2 }, { etapa: 'diagnostico', etiqueta: 'Diagnóstico', orden: 2, puestos: 1 }], duraciones: config().duraciones };
    const a = proyectarAgenda(entrada([tk(1030, 'Verificación')], { config: cfg }));
    expect(a.etapas.map((e) => [e.etapa, e.etiqueta, e.saturacion.puestos])).toEqual([['proceso', 'Taller', 2], ['diagnostico', 'Diagnóstico', 1], ['verificacion', 'Verificación', 0]]);
    expect(previstos(a, 'verificacion')).toEqual([[1030, null, null, null]]);
  });
});

describe('avisos globales', () => {
  const tickets = () => [tk(1100, 'Rev./Diagnostico', { remisionEntrada: '2026-10-01' }), tk(1101, 'Ingresado'), tk(1102, 'En Proceso')];

  it('D13: sincronización parada avisa arriba, sin marcar ningún ticket ni cambiar la proyección', () => {
    const bien = proyectarAgenda(entrada(tickets()));
    const parada = proyectarAgenda(entrada(tickets(), { estadoFuente: fuente({ sincronizacionParada: true, ultimaSincronizacion: '2026-10-06T08:00:00.000Z' }) }));
    expect(bien.avisos).toEqual([]);
    expect(parada.avisos.map((x) => x.codigo)).toEqual(['sincronizacion_parada']);
    expect(parada.avisos[0].mensaje).toContain('60 minutos');
    expect(parada.fuente).toEqual({ fuente: 'principal', motivo: null, ultimaSincronizacion: '2026-10-06T08:00:00.000Z' });
    expect({ ...parada, avisos: [], fuente: null }).toEqual({ ...bien, avisos: [], fuente: null });
  });

  it('respaldo: avisa con su motivo', () => {
    const r = tickets().map((t) => ({ ...t, fuente: 'respaldo' as const, clasificacion: null }));
    const a = proyectarAgenda(entrada(r, { estadoFuente: fuente({ fuente: 'respaldo', motivo: 'timeout', mensaje: 'La base de Desk 2.0 tardó demasiado en responder: se lee la réplica de Zoho.' }) }));
    expect(a.avisos).toEqual([{ codigo: 'fuente_respaldo', mensaje: 'La base de Desk 2.0 tardó demasiado en responder: se lee la réplica de Zoho.' }]);
    expect(a.fuente).toMatchObject({ fuente: 'respaldo', motivo: 'timeout' });
  });

  it('respaldo: también si los tickets vinieron de la réplica aunque el estado de la fuente ya diga principal (la caída es por llamada)', () => {
    const r = tickets().map((t) => ({ ...t, fuente: 'respaldo' as const, clasificacion: null }));
    expect(proyectarAgenda(entrada(r)).avisos.map((x) => x.codigo)).toEqual(['fuente_respaldo']);
  });

  it('los tres a la vez, en orden fijo', () => {
    const a = proyectarAgenda(entrada([tk(1110, 'Raro', { fuente: 'respaldo' })], { estadoFuente: fuente({ fuente: 'respaldo', motivo: 'sin_variable', mensaje: 'Respaldo.', sincronizacionParada: true, ultimaSincronizacion: null }) }));
    expect(a.avisos.map((x) => x.codigo)).toEqual(['sincronizacion_parada', 'fuente_respaldo', 'estados_sin_categoria']);
  });
});

// ── Lo que no sale y propiedades ────────────────────────────────────────────

describe('la salida', () => {
  it('es serializable y no lleva clientes, seriales, asuntos ni correos', () => {
    const tickets = ticketsH().map((t) => ({ ...t, fuente: 'respaldo' as const, asunto: 'MT_18A00001 Cliente Uno contacto@cliente-uno.example', codigoServicio: 'MT_18A00001_EDM180C_261002' }));
    const a = proyectarAgenda(entrada(tickets));
    const json = JSON.stringify(a);
    expect(JSON.parse(json)).toEqual(a);
    expect(json).not.toMatch(/Cliente Uno|18A00001|@|asunto|codigoServicio|serial|email/i);
  });

  it('agenda.ts no mira el reloj ni la base: ni reloj sin argumento, ni consultas, ni el repo', () => {
    const src = readFileSync(fileURLToPath(new URL('./agenda.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/Date\.now|new Date\(\s*\)|performance\.now|Math\.random/);
    expect(src).not.toMatch(/\.query\(|from '\.\/repo|from '\.\.\/db|from 'pg'|process\.env/);
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['../ausencias/saldo.js', './agenda-calendario.js', './dominio.js', './fuente.js']);
    // De la fuente, sólo tipos: nada de su código ni de sus consultas.
    expect(src).toMatch(/import type \{[^}]+\} from '\.\/fuente\.js'/);
  });
});

// ── Lote 4: D16, la vuelta de standby y el reparto inicial ──────────────────

describe('ninguna fecha prevista cae en un día no hábil (D16)', () => {
  const uno = config({ diagnostico: 1 });
  const dos = [tk(900, 'Rev./Diagnostico', { remisionEntrada: '2026-09-01' }), tk(901, 'Ingresado', { remisionEntrada: '2026-09-02' })];

  it('si hoy es sábado, lo primero que se proyecta es el siguiente día hábil (el lunes 12 es festivo: el martes 13)', () => {
    const a = proyectarAgenda(entrada(dos, { hoy: '2026-10-10', config: uno }));
    // Desde el mar 13: mié 14, jue 15, vie 16; desde el vie 16: lun 19, mar 20, mié 21.
    expect(previstos(a, 'diagnostico')).toEqual([[900, 1, '2026-10-13', '2026-10-16'], [901, 1, '2026-10-16', '2026-10-21']]);
    expect(etapaDe(a, 'diagnostico').primerHueco).toBe('2026-10-21');
    // Una etapa sin fila tampoco ofrece su hueco en sábado.
    expect(etapaDe(a, 'proceso').primerHueco).toBe('2026-10-13');
  });

  it('lo mismo en domingo, en festivo y en un cierre de empresa', () => {
    const entra = (hoy: string, cierres: string[] = []) => previstos(proyectarAgenda(entrada(dos, { hoy, config: uno, cierres })), 'diagnostico')[0][2];
    expect(entra('2026-10-11')).toBe('2026-10-13');
    expect(entra('2026-10-12')).toBe('2026-10-13');
    expect(entra('2026-10-07', ['2026-10-07'])).toBe('2026-10-08');
    expect(entra('2026-10-09', ['2026-10-09', '2026-10-13'])).toBe('2026-10-14');
  });

  it('en un día hábil no cambia nada: se entra hoy', () => {
    expect(previstos(proyectarAgenda(entrada(dos, { config: uno })), 'diagnostico')[0]).toEqual([900, 1, HOY, '2026-10-09']);
  });

  it('el equipo nuevo encadenado y quien espera a un puesto pasado de fecha tampoco entran en un día no hábil', () => {
    const tickets = [nuevo(910, 'En Proceso'), tk(911, 'Rev./Diagnostico'), tk(912, 'Ingresado', { remisionEntrada: '2026-10-01' })];
    const a = proyectarAgenda(entrada(tickets, { hoy: '2026-10-10', config: uno, asignaciones: [asig(911, 'diagnostico', 1, '2026-09-28')] }));
    const fechas = a.etapas.flatMap((x) => [...x.fila, ...x.encadenados].flatMap((t) => [t.entradaPrevista, t.finPrevisto]).concat(x.primerHueco, ...x.puestos.map((p) => p.finEstimado)));
    for (const f of fechas.filter((x): x is string => x !== null)) expect(esHabilAgenda(f, new Set()), f).toBe(true);
    expect(previstos(a, 'diagnostico')).toEqual([[912, 1, '2026-10-13', '2026-10-16']]);
  });
});

describe('vuelvenDeStandby: quién vuelve de un standby, según el historial', () => {
  const T0 = ms('2026-10-01');
  const T1 = ms('2026-10-02');
  const T2 = ms('2026-10-05');
  const tramo = (clave: string, desde: number, hasta: number | null): TramoHistorial => ({ clave, desde, hasta });
  const sin = new Map<string, CategoriaEstado>();
  const de = (t: TicketTaller, tramos: TramoHistorial[], categorias = sin) => vuelvenDeStandby([t], new Map([[t.numero, tramos]]), categorias);

  it('estuvo en un standby y entró después en el estado de su etapa de ahora', () => {
    expect(de(tk(950, 'Rev./Diagnostico'), [tramo('notificacion cliente', T0, T1), tramo('rev./diagnostico', T1, null)])).toEqual([950]);
  });

  it('vale aunque después haya cambiado de estado dentro de la misma etapa, y en cualquier orden de los tramos', () => {
    expect(de(tk(951, 'Notificado'), [tramo('notificado', T2, null), tramo('servicio externo', T0, T1), tramo('rev./diagnostico', T1, T2)])).toEqual([951]);
  });

  it('no vuelve quien sólo tiene su primera observación, ni quien llegó de otra etapa o de la fila de entrada', () => {
    expect(de(tk(952, 'Rev./Diagnostico'), [tramo('rev./diagnostico', T0, null)])).toEqual([]);
    expect(de(tk(953, 'En Proceso'), [tramo('rev./diagnostico', T0, T1), tramo('en proceso', T1, null)])).toEqual([]);
    expect(de(tk(954, 'Rev./Diagnostico'), [tramo('ingresado', T0, T1), tramo('rev./diagnostico', T1, null)])).toEqual([]);
    expect(vuelvenDeStandby([tk(955, 'Rev./Diagnostico')], new Map(), sin)).toEqual([]);
  });

  it('no vuelve quien sigue en standby, ni quien no está en una etapa activa', () => {
    expect(de(tk(956, 'Servicio externo'), [tramo('rev./diagnostico', T0, T1), tramo('servicio externo', T1, null)])).toEqual([]);
    expect(de(tk(957, 'Por Facturar'), [tramo('servicio externo', T0, T1), tramo('por facturar', T1, null)])).toEqual([]);
  });

  it('si el historial no va con el estado que da la fuente, o hay un hueco antes de la etapa, no se afirma nada', () => {
    expect(de(tk(958, 'Rev./Diagnostico'), [tramo('notificacion cliente', T0, T1), tramo('en proceso', T1, null)])).toEqual([]);
    expect(de(tk(959, 'Rev./Diagnostico'), [tramo('notificacion cliente', T0, T1), tramo('rev./diagnostico', T2, null)])).toEqual([]);
    expect(de(tk(960, 'Rev./Diagnostico'), [tramo('notificacion cliente', T0, T1), tramo('rev./diagnostico', T1, T2)])).toEqual([]);
  });

  it('la categoría guardada gana a la propuesta, y la salida va por número', () => {
    const guardadas = new Map<string, CategoriaEstado>([['espera rara', { categoria: 'standby', etapa: null }]]);
    const tramos = new Map([
      [962, [tramo('espera rara', T0, T1), tramo('en proceso', T1, null)]],
      [961, [tramo('solicitado', T0, T1), tramo('en proceso', T1, null)]],
    ]);
    expect(vuelvenDeStandby([tk(962, 'En Proceso'), tk(961, 'En  Proceso')], tramos, guardadas)).toEqual([961, 962]);
    expect(vuelvenDeStandby([tk(962, 'En Proceso')], tramos, sin)).toEqual([]);
  });
});

describe('proponerReparto: el reparto inicial (D6)', () => {
  it('con el ejemplo H: los puestos libres de cada etapa, en el orden de su fila; lo que no cabe queda en la fila', () => {
    expect(proponerReparto(entrada(ticketsH()))).toEqual([
      { numero: 7099, etapa: 'diagnostico', puesto: 1, desde: HOY },
      { numero: 7093, etapa: 'diagnostico', puesto: 2, desde: HOY },
      { numero: 7105, etapa: 'diagnostico', puesto: 3, desde: HOY },
      { numero: 7084, etapa: 'proceso', puesto: 1, desde: HOY },
      { numero: 7090, etapa: 'proceso', puesto: 2, desde: HOY },
      { numero: 7109, etapa: 'proceso', puesto: 3, desde: HOY },
    ]);
  });

  it('sólo propone a quien ya está en un estado de la etapa: la fila de entrada espera aunque vaya delante', () => {
    const tickets = [tk(970, 'Ingresado', { remisionEntrada: '2026-08-01' }), tk(971, 'Rev./Diagnostico', { remisionEntrada: '2026-09-01' })];
    expect(proponerReparto(entrada(tickets))).toEqual([{ numero: 971, etapa: 'diagnostico', puesto: 1, desde: HOY }]);
  });

  it('no toca los puestos ocupados ni los que están a extinguir, y no repite a quien ya tiene puesto', () => {
    const tickets = [980, 981, 982, 983].map((n) => tk(n, 'Rev./Diagnostico', { remisionEntrada: `2026-09-0${n - 979}` }));
    const e = entrada(tickets, { config: config({ diagnostico: 2 }), asignaciones: [asig(982, 'diagnostico', 1), asig(983, 'diagnostico', 3)] });
    expect(proponerReparto(e)).toEqual([{ numero: 980, etapa: 'diagnostico', puesto: 2, desde: HOY }]);
  });

  it('la duración cuenta desde la llegada exacta a la etapa, si consta; y nunca desde un día no hábil (D16)', () => {
    const tickets = [tk(990, 'En Proceso', { llegadaEstado: ms('2026-09-30') }), tk(991, 'En Proceso', { llegadaEstado: ms('2026-10-03') }), tk(992, 'En Proceso')];
    expect(proponerReparto(entrada(tickets)).map((x) => [x.numero, x.puesto, x.desde])).toEqual([[990, 1, '2026-09-30'], [991, 2, '2026-10-05'], [992, 3, HOY]]);
    // En sábado, quien no tiene llegada exacta empieza el siguiente día hábil.
    expect(proponerReparto(entrada([tk(992, 'En Proceso')], { hoy: '2026-10-10' }))).toEqual([{ numero: 992, etapa: 'proceso', puesto: 1, desde: '2026-10-13' }]);
  });
});

/** Congela en profundidad (los Map no se congelan: se comparan aparte). */
function congelar<T>(v: T): T {
  if (v && typeof v === 'object' && !(v instanceof Map)) {
    Object.freeze(v);
    for (const x of Object.values(v)) congelar(x);
  }
  return v;
}

/** Generador con semilla: las propiedades se prueban sobre casos variados pero siempre los mismos. */
function generador(semilla: number) {
  let s = semilla >>> 0;
  const n = (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
  return { n, de: <T>(xs: readonly T[]): T => xs[n(xs.length)] };
}

const ESTADOS = ['OV asignada', 'Ingresado', 'Remisión creada', 'Rev./Diagnostico', 'Notificado', 'En Proceso', 'Continuación del proceso', 'Verificación', 'Servicio externo', 'Notificación cliente', 'Por Facturar', 'Pendiente', 'Estado raro', 'Otro raro', ''];

function casoAleatorio(semilla: number): EntradaAgenda {
  const g = generador(semilla);
  const respaldo = g.n(4) === 0;
  const tickets = Array.from({ length: g.n(40) }, (_, i) =>
    tk(2000 + i * 3 + g.n(3), g.de(ESTADOS), {
      clasificacion: g.de(['Equipo Nuevo', 'Equipo Para Servicio', null]),
      tipoServicio: g.de(['Diagnostico', 'Calibración', null]),
      remisionEntrada: g.n(3) === 0 ? null : `2026-09-${String(10 + g.n(15))}`,
      prioridad: respaldo ? null : g.de([null, null, null, 'High', 'Urgent']),
      llegadaEstado: respaldo || g.n(2) === 0 ? null : ms(`2026-10-0${1 + g.n(5)}`),
      fuente: respaldo ? 'respaldo' : 'principal',
    }),
  );
  const cfg = config({ diagnostico: g.n(4), proceso: g.n(5), verificacion: g.n(3) }, [
    { etapa: 'diagnostico', tipo: '*', dias: 1 + g.n(5) },
    ...(g.n(3) === 0 ? [] : [{ etapa: 'proceso' as const, tipo: '*', dias: 1 + g.n(5) }]),
    { etapa: 'verificacion', tipo: 'calibracion', dias: 1 + g.n(3) },
  ]);
  // Asignaciones como las dejará el lote 4, y alguna que ya no cuadra con el estado de su ticket.
  const asignaciones: AsignacionAgenda[] = [];
  for (const cfgEtapa of cfg.etapas) {
    for (let puesto = 1; puesto <= cfgEtapa.puestos; puesto++) {
      if (tickets.length && g.n(2) === 0) asignaciones.push(asig(g.de(tickets).numero, cfgEtapa.etapa, puesto, `2026-10-0${1 + g.n(6)}`));
    }
  }
  return entrada(tickets, {
    config: cfg,
    asignaciones,
    cierres: g.n(2) === 0 ? ['2026-10-08'] : [],
    tiposManuales: new Map(tickets.filter(() => g.n(5) === 0).map((t) => [t.numero, 'Calibración'])),
    vuelvenDeStandby: tickets.filter(() => g.n(6) === 0).map((t) => t.numero),
    estadoFuente: fuente({ fuente: respaldo ? 'respaldo' : 'principal', sincronizacionParada: g.n(5) === 0 }),
  });
}

describe('propiedades', () => {
  const SEMILLAS = Array.from({ length: 150 }, (_, i) => i + 1);
  const casos = (): [string, EntradaAgenda][] => [['el ejemplo H', entrada(ticketsH())], ...SEMILLAS.map((s): [string, EntradaAgenda] => [`semilla ${s}`, casoAleatorio(s)])];

  it('misma entrada, misma salida', () => {
    for (const [nombre, e] of casos()) expect(proyectarAgenda(e), nombre).toEqual(proyectarAgenda(e));
    expect(JSON.stringify(proyectarAgenda(casoAleatorio(7)))).toBe(JSON.stringify(proyectarAgenda(casoAleatorio(7))));
    // El orden en que llegan los tickets tampoco cambia nada.
    for (const s of SEMILLAS.slice(0, 30)) {
      const e = casoAleatorio(s);
      expect(proyectarAgenda({ ...e, tickets: [...e.tickets].reverse() }), `semilla ${s}`).toEqual(proyectarAgenda(e));
    }
  });

  it('ningún ticket aparece dos veces y la suma de todas las listas da el total de abiertos', () => {
    for (const [nombre, e] of casos()) {
      const a = proyectarAgenda(e);
      const abiertos = new Set(e.tickets.map((t) => t.numero));
      const ocupantes = a.etapas.flatMap((x) => x.puestos.flatMap((p) => (p.ocupante ? [p.ocupante.numero] : [])));
      const nombrados = [...ocupantes, ...a.etapas.flatMap((x) => x.fila.map((t) => t.numero)), ...a.standby.map((t) => t.numero), ...a.porLlegar.map((t) => t.numero), ...a.sinCategoria.flatMap((s) => s.tickets)];
      expect(new Set(nombrados).size, nombre).toBe(nombrados.length);
      expect(nombrados.filter((n) => abiertos.has(n)).length + a.finTaller + a.fueraAgenda, nombre).toBe(e.tickets.length);
      expect(a.totalAbiertos, nombre).toBe(e.tickets.length);
      // Lo único que no es un abierto de la fuente es un ocupante «sin datos de la fuente».
      const ajenos = a.etapas.flatMap((x) => x.puestos.flatMap((p) => (p.ocupante?.marcas.sinDatosFuente ? [p.ocupante.numero] : [])));
      expect(nombrados.filter((n) => !abiertos.has(n)).sort(), nombre).toEqual(ajenos.sort());
    }
  });

  it('en ninguna etapa hay más ocupantes que puestos, ni se promete un puesto que no existe o dos veces el mismo día', () => {
    for (const [nombre, e] of casos()) {
      for (const x of proyectarAgenda(e).etapas) {
        const n = e.config.etapas.find((c) => c.etapa === x.etapa)!.puestos;
        expect(x.puestos.map((p) => p.puesto), nombre).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        expect(x.saturacion, nombre).toEqual({ ocupados: x.puestos.filter((p) => p.ocupante).length, puestos: n });
        expect(x.saturacion.ocupados, nombre).toBeLessThanOrEqual(n);
        expect(x.fila.map((t) => t.posicion), nombre).toEqual(x.fila.map((_, i) => i + 1));
        // En cada puesto, los turnos no se pisan: cada uno entra cuando ha salido el anterior.
        for (let p = 1; p <= n; p++) {
          const ocupado = x.puestos[p - 1];
          let libre = ocupado.ocupante ? ocupado.finEstimado : e.hoy;
          for (const t of [...x.fila, ...x.encadenados].filter((t) => t.puestoPrevisto === p)) {
            expect(libre, nombre).not.toBeNull();
            expect(t.entradaPrevista! >= libre! && t.finPrevisto! > t.entradaPrevista!, `${nombre} · ${x.etapa} · ${t.numero}`).toBe(true);
            libre = t.finPrevisto;
          }
        }
        for (const t of [...x.fila, ...x.encadenados]) expect(t.puestoPrevisto === null || (t.puestoPrevisto >= 1 && t.puestoPrevisto <= n), nombre).toBe(true);
      }
    }
  });

  it('no muta sus argumentos', () => {
    for (const [nombre, e] of casos().slice(0, 40)) {
      const antes = JSON.stringify([e, [...e.tiposManuales as Map<number, string>], [...e.categorias as Map<string, CategoriaEstado>]]);
      const a = proyectarAgenda(congelar(e));
      expect(JSON.stringify([e, [...e.tiposManuales as Map<number, string>], [...e.categorias as Map<string, CategoriaEstado>]]), nombre).toBe(antes);
      expect(a.etapas.length, nombre).toBe(ETAPAS_AGENDA.length);
    }
  });
});
