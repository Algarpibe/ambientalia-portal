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

/**
 * El techo del eje Y y sus marcas, a partir del valor más alto de la serie.
 *
 * ⚠️ Las barras se escalan contra el TECHO, no contra el máximo crudo. Si se
 * escalaran contra el máximo, la barra más alta llegaría siempre arriba del
 * todo y quedaría por encima de la última marca —diciendo 26 donde la etiqueta
 * pone 30—, que es peor que no tener eje.
 *
 * El techo se redondea a un número que se lee bien: el paso sube a 1, 2, 5 o 10
 * por su magnitud, así que salen escalas como 0-5-10 o 0-10-20-30 y nunca
 * 0-6,5-13. Con series de días de ausencia, que van de 3 a 40, es lo que
 * separa un eje que se entiende de uno que hay que descifrar.
 */
function escalaDeGrafica(maximo: number, divisiones = 4): { techo: number; marcas: number[] } {
  // Una serie entera a cero sigue necesitando eje: con techo 0 la división de
  // las barras sería entre cero y saldría `Infinity` o `NaN` como altura.
  if (maximo <= 0) return { techo: 1, marcas: [0, 1] };

  const bruto = maximo / divisiones;
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const normalizado = bruto / magnitud;
  const paso = (normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10) * magnitud;

  const techo = Math.ceil(maximo / paso) * paso;
  const marcas: number[] = [];
  // El `+ paso / 2` cierra la puerta a que el último valor se quede fuera por
  // la cola binaria de una suma repetida de decimales.
  for (let v = 0; v <= techo + paso / 2; v += paso) marcas.push(Math.round(v * 100) / 100);
  return { techo, marcas };
}

/** La columna de etiquetas del eje Y, alineada con las líneas guía. */
function EjeY({ marcas, techo }: { marcas: number[]; techo: number }) {
  return (
    <div className="relative w-6 shrink-0" style={{ height: `${ALTO_BARRA}px` }}>
      {marcas.map((v) => (
        <span
          key={v}
          className="absolute right-1 text-[9px] text-gray-400"
          // `translateY(50%)` centra la etiqueta EN la línea; sin él quedaría
          // colgando por encima y el cero se saldría del área de la gráfica.
          style={{ bottom: `${(v / techo) * ALTO_BARRA}px`, transform: 'translateY(50%)' }}
        >
          {v}
        </span>
      ))}
    </div>
  );
}

/** Las líneas horizontales de fondo. Van detrás de las barras (`-z-10`). */
function LineasGuia({ marcas, techo }: { marcas: number[]; techo: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: `${ALTO_BARRA}px` }}>
      {marcas.map((v) => (
        <div
          key={v}
          className={`absolute inset-x-0 border-t ${v === 0 ? 'border-gray-300' : 'border-gray-100'}`}
          style={{ bottom: `${(v / techo) * ALTO_BARRA}px` }}
        />
      ))}
    </div>
  );
}

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
  const { techo, marcas } = escalaDeGrafica(Math.max(...meses.map((m) => m.diasHabiles), 0));

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
      <div className="mt-5 flex">
        <EjeY marcas={marcas} techo={techo} />
        <div className="relative flex-1">
          <LineasGuia marcas={marcas} techo={techo} />
          <div className="relative flex items-end gap-1" style={{ height: `${ALTO_BARRA}px` }}>
            {meses.map((m) => (
              <div key={m.mes} className="relative h-full flex-1" title={tituloDelMes(m)}>
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t bg-blue-500/70"
                  // El `minHeight` es para que un mes con datos pero poco valor
                  // no se vea igual que uno vacío: una barra invisible y un cero
                  // se leen igual, y no son lo mismo.
                  //
                  // Contra `techo` y no contra el máximo: si no, la barra más
                  // alta llegaría arriba del todo y no coincidiría con su marca.
                  style={{
                    height: `${(m.diasHabiles / techo) * ALTO_BARRA}px`,
                    minHeight: m.diasHabiles > 0 ? '2px' : '0',
                  }}
                />
                {/* El número va DENTRO de la columna y en absoluto sobre su
                    barra: con el eje de altura fija, ponerlo en el flujo lo
                    empujaría fuera del área o encogería la barra. */}
                {m.diasHabiles > 0 && (
                  <span
                    className="absolute inset-x-0 text-center text-[10px] tabular-nums text-gray-400"
                    style={{ bottom: `${(m.diasHabiles / techo) * ALTO_BARRA + 2}px` }}
                  >
                    {m.diasHabiles}
                  </span>
                )}
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
        </div>
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

/** Las claves de los cuatro tipos, para el estado del filtro. */
type ClaveDeTipo = (typeof TIPOS_ESTACIONALIDAD)[number]['clave'];

/**
 * Recalcula la serie con solo los tipos activos.
 *
 * ⚠️ Recalcula SIEMPRE, también con los cuatro encendidos, en vez de usar el
 * `total`, el `mesPico` y el `totalPorTipo` que manda el servidor cuando no hay
 * filtro. Es a propósito: con dos caminos —el del servidor sin filtro y el del
 * front con él— cualquier discrepancia entre ambos aparecería solo al filtrar,
 * que es justo cuando nadie la buscaría. Con uno solo, si el número está mal
 * está mal siempre y se ve enseguida.
 *
 * El pico se busca solo entre los meses con algo: apagar todos los tipos deja
 * la serie a cero, y devolver el primer mes lo señalaría como el más cargado.
 */
function conTiposActivos(meses: Kpis['estacionalidad']['meses'], activos: Set<ClaveDeTipo>) {
  const recalculados = meses.map((m) => ({
    ...m,
    total: TIPOS_ESTACIONALIDAD.filter((t) => activos.has(t.clave)).reduce((s, t) => s + m[t.clave], 0),
  }));

  const pico = recalculados
    .filter((m) => m.total > 0)
    .reduce<(typeof recalculados)[number] | null>(
      (mejor, m) => (mejor === null || m.total > mejor.total ? m : mejor),
      null,
    );

  return {
    meses: recalculados,
    total: recalculados.reduce((s, m) => s + m.total, 0),
    mesPico: pico?.mes ?? null,
  };
}

function Estacionalidad({ estacionalidad }: { estacionalidad: Kpis['estacionalidad'] }) {
  const { totalPorTipo } = estacionalidad;
  // Los cuatro encendidos al abrir: el filtro sirve para AISLAR un tipo, así
  // que el estado de partida tiene que ser la vista completa.
  const [activos, setActivos] = useState<Set<ClaveDeTipo>>(
    () => new Set(TIPOS_ESTACIONALIDAD.map((t) => t.clave)),
  );

  const alternar = (clave: ClaveDeTipo) => {
    setActivos((previos) => {
      const siguiente = new Set(previos);
      // Un Set NUEVO y no `previos` mutado: React compara por identidad, y
      // mutando el mismo Set el componente no se volvería a pintar.
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  };

  const { meses, total, mesPico } = conTiposActivos(estacionalidad.meses, activos);
  // La escala se recalcula con el filtro puesto: aislar permisos baja el máximo
  // de 26 a 8, y mantener el eje en 30 dejaría todas las barras aplastadas
  // contra el suelo, que es la forma de que un filtro parezca no hacer nada.
  const { techo, marcas } = escalaDeGrafica(Math.max(...meses.map((m) => m.total), 0));
  const tiposVisibles = TIPOS_ESTACIONALIDAD.filter((t) => activos.has(t.clave));

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

      {/* El filtro va ARRIBA de las cifras y no debajo de la gráfica: es lo que
          decide qué dicen esas cifras, y ponerlo al final obligaría a leerlas
          dos veces. Es la leyenda de siempre, ahora clicable. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2">
        {TIPOS_ESTACIONALIDAD.map((t) => {
          const encendido = activos.has(t.clave);
          return (
            <button
              key={t.clave}
              type="button"
              onClick={() => alternar(t.clave)}
              aria-pressed={encendido}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                encendido
                  ? 'border-gray-300 bg-white text-gray-700'
                  : 'border-gray-200 bg-gray-50 text-gray-400'
              }`}
            >
              {/* El cuadro de color se apaga a gris con el tipo: si mantuviera
                  su color, un tipo desactivado se seguiría leyendo como
                  presente en la gráfica. */}
              <span className={`h-2.5 w-2.5 rounded-sm ${encendido ? t.color : 'bg-gray-300'}`} />
              {t.etiqueta}
              <span className="tabular-nums text-gray-400">{totalPorTipo[t.clave]}</span>
            </button>
          );
        })}
        {activos.size < TIPOS_ESTACIONALIDAD.length && (
          <button
            type="button"
            onClick={() => setActivos(new Set(TIPOS_ESTACIONALIDAD.map((t) => t.clave)))}
            className="text-xs text-blue-600 underline underline-offset-2"
          >
            ver todos
          </button>
        )}
      </div>

      {activos.size === 0 ? (
        // Con los cuatro apagados la gráfica no tiene nada que decir, pero eso
        // NO es «no hay datos»: se distingue a propósito del mensaje de abajo.
        <p className="mt-4 text-sm text-gray-500">
          No hay ningún tipo seleccionado. Enciende alguno para ver la gráfica.
        </p>
      ) : total === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          {activos.size === TIPOS_ESTACIONALIDAD.length
            ? 'Todavía no hay ausencias registradas en esta ventana.'
            : 'No hay ausencias de ese tipo en esta ventana.'}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Cifra
              etiqueta="Mes más cargado"
              valor={mesPico === null ? '—' : nombreDelMes(mesPico)}
              detalle={mesPico === null ? undefined : `${mesDe(meses, mesPico)} días de ausencia`}
            />
            <Cifra
              etiqueta="Días en total"
              valor={String(total)}
              // El detalle dice QUÉ se está sumando: con un filtro puesto,
              // «sumando los cuatro tipos» sería mentira.
              detalle={
                activos.size === TIPOS_ESTACIONALIDAD.length
                  ? 'sumando los cuatro tipos'
                  : `solo ${tiposVisibles.map((t) => t.etiqueta.toLowerCase()).join(' y ')}`
              }
            />
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
          <div className="mt-5 flex">
            <EjeY marcas={marcas} techo={techo} />
            <div className="relative flex-1">
              <LineasGuia marcas={marcas} techo={techo} />
              <div className="relative flex items-end gap-px" style={{ height: `${ALTO_BARRA}px` }}>
                {meses.map((m) => (
                  <div key={m.mes} className="flex flex-1 flex-col" title={tituloEstacional(m, tiposVisibles)}>
                    <div
                      className="flex w-full flex-col-reverse overflow-hidden rounded-t"
                      // Contra `techo` y no contra el máximo, por lo mismo que
                      // en absentismo: la barra más alta tiene que coincidir con
                      // una marca del eje y no pasarse de la última.
                      style={{
                        height: `${(m.total / techo) * ALTO_BARRA}px`,
                        minHeight: m.total > 0 ? '2px' : '0',
                      }}
                    >
                      {/* Solo los tipos ACTIVOS: si se pintaran los cuatro, sus
                          porcentajes se repartirían sobre un total que ya no los
                          incluye a todos y la columna sumaría más del 100%. */}
                      {tiposVisibles.map((t) => (
                        <div
                          key={t.clave}
                          className={t.color}
                          // El tramo se mide contra el TOTAL DEL MES, no contra
                          // el techo: la columna ya tiene la altura correcta y
                          // aquí solo se reparte por dentro.
                          style={{ height: m.total > 0 ? `${(m[t.clave] / m.total) * 100}%` : '0' }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-px">
                {meses.map((m, i) => (
                  <div key={m.mes} className="flex-1 text-center text-[9px] leading-tight text-gray-400">
                {/* ⚠️ El MES, siempre, en todas las columnas. Antes enero
                    imprimía aquí los dos dígitos del año para marcar el cambio,
                    y el resultado era una columna rotulada «26» en una fila de
                    meses: se leía como un mes veintiséis. Si una etiqueta ocupa
                    el sitio del mes, tiene que ser el mes. */}
                <div>{m.mes.slice(5)}</div>
                {/* El año va DEBAJO y solo donde hace falta situarse: en enero
                    y en la primera columna de la serie. En su propia línea no
                    compite con el mes y no se puede confundir con él. */}
                {(i === 0 || m.mes.endsWith('-01')) && (
                  <div className="text-gray-300">{m.mes.slice(0, 4)}</div>
                )}
                  </div>
                ))}
              </div>
            </div>
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

function tituloEstacional(
  m: Kpis['estacionalidad']['meses'][number],
  // Los tipos que la gráfica está pintando. El tooltip tiene que decir lo
  // mismo que la barra: enseñar un tipo apagado explicaría días que la columna
  // no incluye, y el total no cuadraría con el desglose.
  visibles: readonly (typeof TIPOS_ESTACIONALIDAD)[number][],
): string {
  if (m.total === 0) return `${m.mes}: sin ausencias`;
  // Una línea por tipo, con sus días y sus nombres. En una sola línea no se
  // sabría de qué tipo es cada persona, que es justo lo que el tooltip añade.
  const lineas = visibles
    .filter((t) => m[t.clave] > 0)
    .map((t) => `${t.etiqueta} (${m[t.clave]}): ${listaDeNombres(m.nombres[t.clave])}`);
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
