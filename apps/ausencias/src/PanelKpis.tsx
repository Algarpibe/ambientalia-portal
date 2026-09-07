import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Clock, Loader2, TrendingUp, Users, Wallet } from 'lucide-react';
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
//
// Lo que NO hay aquí son gráficas de tendencia (absentismo por mes,
// estacionalidad, tasa de rechazo). Se estudiaron y se dejaron fuera a
// propósito: con el histórico que hay ahora dirían muy poco, y una línea de
// tendencia sobre cuatro puntos invita a leer una señal donde solo hay ruido.
//
// La pestaña solo la ve quien tenga la llave `ve_kpis`, y el endpoint contesta
// 403 por su cuenta a todos los demás: esconder la pestaña no es lo que protege
// estos datos, es solo lo que evita enseñar una que daría error.

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
  // Arranca en true por lo mismo que PanelSaldos: con false, «aún no he pedido
  // nada» y «no hay datos» renderizan lo mismo y al abrir la pestaña se vería
  // un fotograma en blanco antes de que corra el efecto.
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activo || datos !== null) return;
    let vigente = true;
    setCargando(true);
    fetchKpis()
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
    // cambia de pestaña mientras la consulta viaja.
    return () => {
      vigente = false;
    };
  }, [activo, datos]);

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
      <PasivoDeVacaciones pasivo={datos.pasivo} />
      <AcumulacionExcesiva acumulacion={datos.acumulacion} />
      <PendientesAhora pendientes={datos.pendientes} />
      <TiemposDeAprobacion tiempos={datos.tiempos} desde={datos.desde} />
      <AbsentismoPorIncapacidad absentismo={datos.absentismo} />
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
        <ul className="mt-2 space-y-1">
          {/* Con nombre y no solo el recuento: «hay 4 personas» no se puede
              accionar, y «Fulana, 42 días» sí. */}
          {fichas.map((f) => (
            <li key={f.empleadoId} className="flex justify-between gap-3 text-sm">
              <span className="truncate text-gray-900">{f.nombreCompleto}</span>
              <span className="shrink-0 tabular-nums text-gray-500">{formatDias(f.dias)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
          dependencia nueva costaría más que esto. */}
      <div className="mt-5 flex items-end gap-1" style={{ height: '96px' }}>
        {meses.map((m) => (
          <div key={m.mes} className="flex flex-1 flex-col items-center justify-end gap-1" title={tituloDelMes(m)}>
            <span className="text-[10px] tabular-nums text-gray-400">{m.diasHabiles || ''}</span>
            <div
              className="w-full rounded-t bg-blue-500/70"
              // `minHeight` de 2px para que un mes con datos pero poco valor no
              // se vea igual que uno vacío: una barra invisible y un cero se
              // leen igual, y no son lo mismo.
              style={{
                height: `${(m.diasHabiles / maximo) * 100}%`,
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
  return `${m.mes}: ${m.diasHabiles} días perdidos · ${episodios} · ${personas}`;
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
