import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  Clock,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { kpis as fetchKpis, type Kpis } from './api';
import { formatDias } from './dominio';

// El panel de análisis. Cifras que hoy no se pueden mirar en ninguna otra
// pantalla de la app, y que responden preguntas distintas:
//
//  1. ¿Cuánto debemos?      → el pasivo de vacaciones de la plantilla activa.
//  2. ¿Quién lo concentra?  → las dos listas de acumulación excesiva.
//  3. ¿Quién está atascado? → mediana y p90 por aprobador.
//  4. ¿Qué está esperando?  → las pendientes repartidas por antigüedad.
//  5. ¿Cómo va la salud?    → los días perdidos por incapacidad, mes a mes.
//  6. ¿Cuándo se van todos? → los días de ausencia por mes y tipo, a dos años.
//  7. ¿Cuánto roza?         → rechazos, anulaciones y cambios de fecha.
//
// Lo que NO hay aquí son gráficas de tendencia (absentismo por mes,
// estacionalidad, tasa de rechazo). Se estudiaron y se dejaron fuera a
// propósito: con el histórico que hay ahora dirían muy poco, y una línea de
// tendencia sobre cuatro puntos invita a leer una señal donde solo hay ruido.
//
// La pestaña solo la ve quien tenga la llave `ve_kpis`, y el endpoint contesta
// 403 por su cuenta a todos los demás: esconder la pestaña no es lo que protege
// estos datos, es solo lo que evita enseñar una que daría error.

/**
 * Alto máximo de una barra, en PÍXELES.
 *
 * Las dos gráficas del panel calculan su altura contra este número en vez de
 * usar porcentajes. El motivo está explicado donde se usa: sus contenedores
 * llevan `items-end`, así que las columnas no se estiran y un porcentaje
 * dentro no tendría contra qué resolver.
 */
const ALTO_BARRA = 96;

interface Props {
  /** Si la pestaña es la que se ve ahora mismo. Igual que en PanelSaldos: el
   *  panel se monta siempre, pero los datos se piden la primera vez que se
   *  abre — si no, todo el que tenga la llave pagaría esta consulta (que
   *  recorre la plantilla entera y calcula su saldo) en cada carga de la app
   *  aunque nunca mirara la pestaña. */
  activo: boolean;
}

export default function PanelKpis({ activo }: Props) {
  const [datos, setDatos] = useState<Kpis | null>(null);
  /** `null` = la ventana móvil por defecto. Un año concreto la sustituye. */
  const [anio, setAnio] = useState<number | null>(null);
  // Arranca en true por lo mismo que PanelSaldos: con false, «aún no he pedido
  // nada» y «no hay datos» renderizan lo mismo y al abrir la pestaña se vería
  // un fotograma en blanco antes de que corra el efecto.
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    setCargando(true);
    setError(null);
    fetchKpis(anio)
      .then((d) => {
        if (vigente) setDatos(d);
      })
      .catch((e: unknown) => {
        if (vigente) setError(e instanceof Error ? e.message : 'No se pudieron cargar los indicadores');
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    // El flag evita el `setState` sobre un panel ya desmontado si alguien
    // cambia de pestaña mientras la consulta viaja. Y hace algo más ahora que
    // el año se puede cambiar: si alguien pasa rápido de 2024 a 2025, la
    // respuesta de 2024 llega tarde y este flag impide que pise a la de 2025.
    return () => {
      vigente = false;
    };
    // `datos` NO está en las dependencias, al revés que antes: con él, cambiar
    // de año dispararía la carga otra vez al llegar los datos nuevos, en bucle.
  }, [activo, anio]);

  if (cargando && datos === null) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Calculando indicadores…
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (datos === null) return null;

  return (
    <div className="space-y-6">
      <SelectorDeAnio
        anio={datos.anio}
        disponibles={datos.aniosDisponibles}
        cargando={cargando}
        onCambio={setAnio}
      />
      <PasivoDeVacaciones pasivo={datos.pasivo} />
      <AcumulacionExcesiva acumulacion={datos.acumulacion} />
      <PendientesAhora pendientes={datos.pendientes} />
      <TiemposDeAprobacion tiempos={datos.tiempos} desde={datos.desde} />
      <AbsentismoPorIncapacidad absentismo={datos.absentismo} />
      <Estacionalidad estacionalidad={datos.estacionalidad} />
      <FriccionDelProceso friccion={datos.friccion} desde={datos.desde} />
    </div>
  );
}

// ── Selector de año ────────────────────────────────────────────────────────

function SelectorDeAnio({
  anio,
  disponibles,
  cargando,
  onCambio,
}: {
  anio: number | null;
  disponibles: number[];
  cargando: boolean;
  onCambio: (a: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-5 py-3">
      <label htmlFor="kpis-anio" className="text-xs uppercase tracking-wide text-gray-500">
        Periodo
      </label>
      <select
        id="kpis-anio"
        // El valor viene del SERVIDOR (`datos.anio`) y no del estado local: así
        // el desplegable no puede quedarse enseñando un año cuyos datos aún no
        // han llegado, ni discrepar de lo que hay pintado debajo.
        value={anio === null ? '' : String(anio)}
        onChange={(e) => onCambio(e.target.value === '' ? null : Number(e.target.value))}
        disabled={cargando}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
      >
        <option value="">Últimos 12 meses</option>
        {disponibles.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      {cargando && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}

      {/* ⚠️ Lo que el filtro NO toca, dicho en la propia pantalla. El pasivo,
          quién acumula y las pendientes son el estado de HOY: no existe una
          versión «de 2024» de cuánto se debe ahora mismo. Sin este aviso,
          elegir un año pasado y ver el mismo pasivo se lee como un fallo. */}
      <span className="text-xs text-gray-500">
        Afecta a las gráficas y a los tiempos de aprobación. El pasivo, quién acumula y lo que espera firma
        son siempre de hoy.
      </span>
    </div>
  );
}

// ── Pasivo ─────────────────────────────────────────────────────────────────

function PasivoDeVacaciones({ pasivo }: { pasivo: Kpis['pasivo'] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Wallet className="h-4 w-4 text-gray-400" />
        Pasivo acumulado
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Lo que la plantilla activa tiene acumulado y no ha disfrutado. Es deuda de la compañía, no una
        previsión.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Cifra
          etiqueta="Vacaciones"
          valor={formatDias(pasivo.diasVacaciones)}
          detalle={`sobre ${pasivo.empleados} ${pasivo.empleados === 1 ? 'persona activa' : 'personas activas'}`}
        />
        <Cifra etiqueta="Compensatorios" valor={formatDias(pasivo.diasCompensatorios)} />
        <Cifra
          etiqueta="Media por persona"
          // El denominador puede ser cero el primer día, y dividir por él daría
          // «Infinity días» en la pantalla que gerencia usa para decidir.
          valor={pasivo.empleados > 0 ? formatDias(pasivo.diasVacaciones / pasivo.empleados) : '—'}
        />
      </div>
    </section>
  );
}

// ── Acumulación ────────────────────────────────────────────────────────────

function AcumulacionExcesiva({ acumulacion }: { acumulacion: Kpis['acumulacion'] }) {
  const { aviso, alarma, umbralAviso, umbralAlarma } = acumulacion;
  const nadie = aviso.length === 0 && alarma.length === 0;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Users className="h-4 w-4 text-gray-400" />
        Quién acumula de más
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        La cifra de arriba dice cuánto se debe; ésta, a quién. Con un devengo de 1,25 días al mes, cada{' '}
        {umbralAviso} días son aproximadamente un año sin disfrutar vacaciones.
      </p>

      {nadie ? (
        <p className="mt-4 text-sm text-gray-500">
          Nadie pasa de {umbralAviso} días acumulados.
        </p>
      ) : (
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {/* La alarma va primero y a la izquierda: es la lista corta y la que
              hay que mirar con prisa. */}
          <ListaDeFichas
            titulo={`Más de ${umbralAlarma} días`}
            explicacion="Unos dos años acumulados. Ya no se corrige solo."
            fichas={alarma}
            alarma
          />
          <ListaDeFichas
            titulo={`Entre ${umbralAviso} y ${umbralAlarma} días`}
            explicacion="Un año largo. Todavía se corrige planificando."
            fichas={aviso}
          />
        </div>
      )}
    </section>
  );
}

function ListaDeFichas({
  titulo,
  explicacion,
  fichas,
  alarma = false,
}: {
  titulo: string;
  explicacion: string;
  fichas: Kpis['acumulacion']['aviso'];
  alarma?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-500">{titulo}</span>
        <span className={`text-lg font-semibold ${alarma && fichas.length > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
          {fichas.length}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">{explicacion}</p>

      {fichas.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">Nadie.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {/* Con nombre y no solo el recuento: «hay 4 personas» no se puede
              accionar, y «Fulana, 42 días» sí. */}
          {fichas.map((f) => (
            <li key={f.empleadoId} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate text-gray-900">{f.nombreCompleto}</span>
                <span className="shrink-0 tabular-nums text-gray-500">{formatDias(f.dias)}</span>
              </div>
              {/* Las dos señales van JUNTAS y debajo del nombre porque juntas
                  son la frase entera: «lleva dos años sin descansar y no tiene
                  nada previsto» es un caso sobre el que actuar; «lleva dos años
                  pero ya tiene 15 días pedidos» no lo es. Enseñar una sin la
                  otra devuelve la lista al falso positivo que vienen a matar. */}
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                <span>{textoSinVacaciones(f.diasSinVacaciones)}</span>
                {f.diasProgramados > 0 ? (
                  <span className="text-emerald-600">{formatDias(f.diasProgramados)} ya pedidos</span>
                ) : (
                  <span className="text-amber-600">sin nada previsto</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Cuánto lleva sin vacaciones, en la unidad que se entiende de un vistazo.
 *
 * `null` es «nunca», no «hoy»: quien no ha disfrutado vacaciones desde que
 * entró es el caso más grave de la lista, y decir «hace 0 días» lo pintaría
 * como el más tranquilo.
 */
function textoSinVacaciones(dias: number | null): string {
  if (dias === null) return 'sin vacaciones registradas';
  if (dias < 60) return `descansó hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  const meses = Math.round(dias / 30);
  if (meses < 24) return `descansó hace ${meses} meses`;
  return `descansó hace ${Math.floor(meses / 12)} años`;
}

// ── Pendientes ─────────────────────────────────────────────────────────────

function PendientesAhora({ pendientes }: { pendientes: Kpis['pendientes'] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Clock className="h-4 w-4 text-gray-400" />
        Esperando firma ahora
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Por lo que llevan esperando. Sin ventana temporal: una parada desde hace meses es justo la que hay
        que ver.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Cifra etiqueta="Total" valor={String(pendientes.total)} />
        <Cifra etiqueta="Hasta 2 días" valor={String(pendientes.hasta2Dias)} />
        <Cifra etiqueta="De 2 a 5 días" valor={String(pendientes.de2a5Dias)} />
        <Cifra
          etiqueta="Más de 5 días"
          valor={String(pendientes.masDe5Dias)}
          // El único tramo que se tiñe, y solo cuando hay algo dentro: pintar
          // de rojo un cero convierte el color en decoración y deja de avisar.
          alarma={pendientes.masDe5Dias > 0}
        />
      </div>
    </section>
  );
}

// ── Tiempos ────────────────────────────────────────────────────────────────

function TiemposDeAprobacion({ tiempos, desde }: { tiempos: Kpis['tiempos']; desde: string }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <TrendingUp className="h-4 w-4 text-gray-400" />
        Tiempo hasta la firma, por aprobador
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Horas de reloj desde que se envía hasta que se decide, no horas hábiles: es lo que de verdad espera
        quien lo pidió. Desde {new Date(desde).toLocaleDateString('es-CO')}. Ordenado de más lento a más
        rápido.
      </p>

      {tiempos.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Todavía no hay decisiones en esta ventana.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 font-medium">Aprobador</th>
                <th className="py-2 pr-4 font-medium">Decisiones</th>
                <th className="py-2 pr-4 font-medium">Mediana</th>
                <th className="py-2 font-medium">p90</th>
              </tr>
            </thead>
            <tbody>
              {tiempos.map((t) => (
                <tr key={t.aprobadorCorreo} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 pr-4 text-gray-900">{t.aprobadorCorreo}</td>
                  {/* El número de muestras va al lado y no escondido: una
                      mediana de una sola decisión no dice lo mismo que una de
                      cincuenta, y sin el `n` las dos se leen igual. */}
                  <td className="py-2 pr-4 text-gray-500">{t.n}</td>
                  <td className="py-2 pr-4 text-gray-900">{formatHoras(t.medianaHoras)}</td>
                  <td className="py-2 text-gray-500">{formatHoras(t.p90Horas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs italic text-gray-400">
        Una mediana alta puede ser una bandeja desatendida, pero también alguien de vacaciones o un mes de
        picos. Es una señal para preguntar, no un veredicto.
      </p>
    </section>
  );
}

// ── Absentismo ─────────────────────────────────────────────────────────────

function AbsentismoPorIncapacidad({ absentismo }: { absentismo: Kpis['absentismo'] }) {
  const { meses, totalDiasHabiles, totalEpisodios } = absentismo;
  // El máximo manda la altura de las barras. Con todo a cero sería una división
  // por cero, y `|| 1` deja la serie plana en el suelo, que es lo correcto.
  const maximo = Math.max(...meses.map((m) => m.diasHabiles), 0) || 1;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Activity className="h-4 w-4 text-gray-400" />
        Absentismo por incapacidad
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Días de <strong>trabajo</strong> perdidos, no de calendario: un viernes a lunes son 2 días, no 4. Una
        incapacidad que cruza dos meses se reparte entre los dos.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Cifra etiqueta="Días perdidos" valor={String(totalDiasHabiles)} detalle="en toda la ventana" />
        <Cifra etiqueta="Incapacidades" valor={String(totalEpisodios)} />
        <Cifra
          etiqueta="Media por mes"
          valor={meses.length > 0 ? (totalDiasHabiles / meses.length).toLocaleString('es-CO', { maximumFractionDigits: 1 }) : '—'}
        />
      </div>

      {/* Barras en CSS, sin librería de gráficas: son doce valores y una
          dependencia nueva costaría más que esto.

          ⚠️ LA ALTURA VA EN PÍXELES, NO EN PORCENTAJE, y no es una cuestión de
          gusto: el contenedor lleva `items-end` (align-items: flex-end), así que
          las columnas NO se estiran y toman la altura de su contenido. Un
          `height: X%` dentro resolvería contra un padre de altura `auto` —es
          decir, contra nada— y saldría cero. Con la altura calculada aquí en px
          la barra no depende de cómo el navegador resuelva ese porcentaje. */}
      <div className="mt-5 flex items-end gap-1">
        {meses.map((m) => (
          <div key={m.mes} className="flex flex-1 flex-col items-center gap-1" title={tituloDelMes(m)}>
            <span className="text-[10px] tabular-nums text-gray-400">{m.diasHabiles || ''}</span>
            <div
              className="w-full rounded-t bg-blue-500/70"
              // El `minHeight` es para que un mes con datos pero poco valor no
              // se vea igual que uno vacío: una barra invisible y un cero se
              // leen igual, y no son lo mismo.
              style={{
                height: `${(m.diasHabiles / maximo) * ALTO_BARRA}px`,
                minHeight: m.diasHabiles > 0 ? '2px' : '0',
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {meses.map((m) => (
          <div key={m.mes} className="flex-1 text-center text-[10px] text-gray-400">
            {/* Solo el mes; el año iría repetido doce veces y no cabe. */}
            {m.mes.slice(5)}
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs italic text-gray-400">
        El último mes va a medias: aún no ha terminado. Y con pocos meses de histórico, una subida puede ser
        una gripe que pasó por la oficina y no una tendencia.
      </p>
    </section>
  );
}

function tituloDelMes(m: Kpis['absentismo']['meses'][number]): string {
  if (m.episodios === 0) return `${m.mes}: sin incapacidades`;
  const personas = m.personas === 1 ? '1 persona' : `${m.personas} personas`;
  const episodios = m.episodios === 1 ? '1 incapacidad' : `${m.episodios} incapacidades`;
  // Los nombres en su propia línea: en una sola, con seis o siete personas, la
  // cifra que encabeza el tooltip queda empujada fuera de la vista.
  return `${m.mes}: ${m.diasHabiles} días perdidos · ${episodios} · ${personas}\n${listaDeNombres(m.nombres)}`;
}

/**
 * Los nombres de un tooltip, recortados.
 *
 * ⚠️ El corte NO es cosmético: un mes con veinte personas produce un tooltip
 * más alto que la pantalla, y el navegador lo recorta por donde le parece —que
 * suele ser justo donde estaba el dato—. Con el tope, lo que se pierde se dice
 * en voz alta («y 8 más») en vez de desaparecer sin avisar.
 */
function listaDeNombres(nombres: string[]): string {
  const TOPE = 12;
  if (nombres.length <= TOPE) return nombres.join(', ');
  return `${nombres.slice(0, TOPE).join(', ')} y ${nombres.length - TOPE} más`;
}

// ── Estacionalidad ─────────────────────────────────────────────────────────

/** Los cuatro tipos, con el color de su tramo en la barra apilada. */
const TIPOS_ESTACIONALIDAD = [
  { clave: 'vacaciones', etiqueta: 'Vacaciones', color: 'bg-blue-500' },
  { clave: 'compensatorio', etiqueta: 'Compensatorios', color: 'bg-emerald-500' },
  { clave: 'permiso', etiqueta: 'Permisos', color: 'bg-violet-500' },
  { clave: 'incapacidad', etiqueta: 'Incapacidades', color: 'bg-amber-500' },
] as const;

function Estacionalidad({ estacionalidad }: { estacionalidad: Kpis['estacionalidad'] }) {
  const { meses, totalPorTipo, total, mesPico } = estacionalidad;
  const maximo = Math.max(...meses.map((m) => m.total), 0) || 1;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <CalendarRange className="h-4 w-4 text-gray-400" />
        Cuándo se concentran las ausencias
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Días de ausencia por mes y tipo, en los últimos dos años. La ventana es más larga que la del resto
        del panel a propósito: con un solo año cada mes sale una vez y no hay con qué compararlo.
      </p>

      {total === 0 ? (
        <p className="mt-4 text-sm text-gray-500">Todavía no hay ausencias registradas en esta ventana.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Cifra
              etiqueta="Mes más cargado"
              valor={mesPico === null ? '—' : nombreDelMes(mesPico)}
              detalle={mesPico === null ? undefined : `${mesDe(meses, mesPico)} días de ausencia`}
            />
            <Cifra etiqueta="Días en total" valor={String(total)} detalle="sumando los cuatro tipos" />
          </div>

          {/* Barras apiladas: cada mes es una columna con los cuatro tipos
              uno encima de otro. Sin librería, por lo mismo que en absentismo. */}
          {/* ⚠️ Misma regla que en la gráfica de absentismo: la altura de la
              columna se calcula en PÍXELES. Con `items-end`, la columna no se
              estira y mide lo que su contenido, así que un `height: %` dentro
              resolvería contra `auto` y daría cero — que es exactamente lo que
              pasaba: la sección salía con el hueco vacío y ni una barra.

              Los TRAMOS de dentro sí van en %, y ahí sí es correcto: su padre
              es la barra, que ya tiene una altura en px, de modo que el
              porcentaje resuelve contra un número real. */}
          <div className="mt-5 flex items-end gap-px">
            {meses.map((m) => (
              <div key={m.mes} className="flex flex-1 flex-col" title={tituloEstacional(m)}>
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-t"
                  style={{
                    height: `${(m.total / maximo) * ALTO_BARRA}px`,
                    minHeight: m.total > 0 ? '2px' : '0',
                  }}
                >
                  {TIPOS_ESTACIONALIDAD.map((t) => (
                    <div
                      key={t.clave}
                      className={t.color}
                      // El tramo se mide contra el TOTAL DEL MES, no contra el
                      // máximo: la columna ya tiene la altura correcta y aquí
                      // solo se reparte por dentro.
                      style={{ height: m.total > 0 ? `${(m[t.clave] / m.total) * 100}%` : '0' }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-px">
            {meses.map((m) => (
              <div key={m.mes} className="flex-1 text-center text-[9px] text-gray-400">
                {/* Solo enero lleva año: con veinticinco columnas no cabe más,
                    y el cambio de año es lo único que hay que poder situar. */}
                {m.mes.endsWith('-01') ? m.mes.slice(2, 4) : m.mes.slice(5)}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
            {TIPOS_ESTACIONALIDAD.map((t) => (
              <span key={t.clave} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className={`h-2.5 w-2.5 rounded-sm ${t.color}`} />
                {t.etiqueta}
                <span className="tabular-nums text-gray-400">{totalPorTipo[t.clave]}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function mesDe(meses: Kpis['estacionalidad']['meses'], mes: string): number {
  return meses.find((m) => m.mes === mes)?.total ?? 0;
}

/** «2026-08» → «ago 2026». Con el año, porque la ventana cruza dos. */
function nombreDelMes(mes: string): string {
  const [anio, m] = mes.split('-');
  const nombre = new Date(Date.UTC(Number(anio), Number(m) - 1, 1)).toLocaleDateString('es-CO', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${nombre} ${anio}`;
}

function tituloEstacional(m: Kpis['estacionalidad']['meses'][number]): string {
  if (m.total === 0) return `${m.mes}: sin ausencias`;
  // Una línea por tipo, con sus días y sus nombres. En una sola línea no se
  // sabría de qué tipo es cada persona, que es justo lo que el tooltip añade.
  const lineas = TIPOS_ESTACIONALIDAD.filter((t) => m[t.clave] > 0).map(
    (t) => `${t.etiqueta} (${m[t.clave]}): ${listaDeNombres(m.nombres[t.clave])}`,
  );
  return `${m.mes}: ${m.total} días\n${lineas.join('\n')}`;
}

// ── Fricción ───────────────────────────────────────────────────────────────

function FriccionDelProceso({ friccion, desde }: { friccion: Kpis['friccion']; desde: string }) {
  const { decididas, rechazadas, anuladas, cambiosDeFecha } = friccion;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <RefreshCw className="h-4 w-4 text-gray-400" />
        Roce del proceso
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Sobre {decididas} {decididas === 1 ? 'solicitud ya resuelta' : 'solicitudes ya resueltas'} desde{' '}
        {new Date(desde).toLocaleDateString('es-CO')}. Las que siguen esperando firma no cuentan: todavía no
        han podido salir mal.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {/* Rechazo y anulación van separados y NUNCA sumados: en la base los dos
            son `rechazada` y solo los distingue `anulada_at`, pero uno es «el
            jefe dijo que no» y el otro «el solicitante cambió de idea». Piden
            acciones distintas, así que juntarlos daría un número que sube y baja
            sin decir qué hacer. */}
        <Porcentaje
          etiqueta="Rechazadas"
          pct={friccion.pctRechazo}
          n={rechazadas}
          explicacion="El aprobador dijo que no."
        />
        <Porcentaje
          etiqueta="Anuladas"
          pct={friccion.pctAnulacion}
          n={anuladas}
          explicacion="El solicitante la retiró."
        />
        <Porcentaje
          etiqueta="Cambiaron de fechas"
          pct={friccion.pctCambioDeFecha}
          n={cambiosDeFecha}
          explicacion="Con el cambio ya aprobado."
        />
      </div>

      <p className="mt-3 text-xs italic text-gray-400">
        Ninguno de los tres es malo por sí solo — que la gente pueda rectificar es una virtud del sistema. Lo
        que hay que mirar es si suben con el tiempo: ahí suele haber un problema de planificación o de
        comunicación, no de personas.
      </p>
    </section>
  );
}

function Porcentaje({
  etiqueta,
  pct,
  n,
  explicacion,
}: {
  etiqueta: string;
  pct: number | null;
  n: number;
  explicacion: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{etiqueta}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">
        {/* «—» y no «0 %» cuando no hay denominador: un cero se lee como «no
            pasa nunca», y sin datos eso no se sabe. */}
        {pct === null ? '—' : `${pct.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`}
      </div>
      <div className="mt-0.5 text-xs text-gray-500">
        {pct === null ? 'sin datos todavía' : `${n} ${n === 1 ? 'solicitud' : 'solicitudes'}`}
      </div>
      <div className="mt-1 text-xs text-gray-400">{explicacion}</div>
    </div>
  );
}

// ── Piezas ─────────────────────────────────────────────────────────────────

function Cifra({
  etiqueta,
  valor,
  detalle,
  alarma = false,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  alarma?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{etiqueta}</div>
      <div className={`mt-1 text-2xl font-semibold ${alarma ? 'text-amber-600' : 'text-gray-900'}`}>
        {valor}
      </div>
      {detalle !== undefined && <div className="mt-0.5 text-xs text-gray-500">{detalle}</div>}
    </div>
  );
}

/**
 * Horas por debajo de un día, y días a partir de ahí. «53,5 h» obliga a dividir
 * mentalmente por 24 para saber si eso es mucho, que es la única pregunta que
 * esta tabla tiene que contestar de un vistazo.
 */
function formatHoras(horas: number): string {
  if (horas < 24) return `${horas.toLocaleString('es-CO', { maximumFractionDigits: 1 })} h`;
  const dias = horas / 24;
  return `${dias.toLocaleString('es-CO', { maximumFractionDigits: 1 })} d`;
}
