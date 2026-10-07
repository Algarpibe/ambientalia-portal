import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { EtapaProyectada, PuestoAgenda, RespuestaAgenda } from '../dominio';
import { barraOcupante, barraPrevista, detalleDe, diasAgenda, ejeDeAgenda, letraDia, listaPorDias, previstosDePuesto, resumenEtapa, tituloOcupante, type Franja } from '../lib/agendaTaller';
import { columna, mesesDelEje } from '../lib/servicios';
import { fmtFecha } from '../lib/vistas';

/** Ancho de la columna de los puestos y mínimo de cada día: por debajo, el calendario se desplaza en horizontal. */
const ETIQ = 132;
const COL_MIN = 26;
const FILA = 40;
/** El retraso: rojo claro y rayado, como el atraso de «Servicios». */
const RAYADO = 'repeating-linear-gradient(135deg, #fecaca 0 5px, #fee2e2 5px 10px)';
const BARRA = 'absolute top-1.5 flex h-7 items-center overflow-hidden rounded-md text-left text-[11px] text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

interface Props {
  agenda: RespuestaAgenda;
  onTicket: (numero: number) => void;
  /** Lo que se puede hacer con un puesto (lote 7b: liberarlo); va junto a su nombre. */
  accionPuesto?: (etapa: EtapaProyectada, puesto: PuestoAgenda) => ReactNode;
}

/**
 * El calendario de la agenda: una fila por PUESTO, agrupadas por etapa, y una
 * columna por día. La barra de quien ocupa el puesto lleva lo transcurrido en
 * sólido, lo que falta en claro y el retraso rayado en rojo; los previstos de
 * la fila van en contorno discontinuo y dicen «previsto». Las barras van de la
 * mitad del día de entrada a la mitad del de salida (`lib/agendaTaller.ts`).
 * Sin librerías: posiciones en porcentaje sobre el ancho del eje.
 */
export function GanttAgenda({ agenda, onTicket, accionPuesto }: Props) {
  const eje = useMemo(() => ejeDeAgenda(agenda.eje), [agenda.eje]);
  const dias = useMemo(() => diasAgenda(agenda.eje), [agenda.eje]);
  const pct = (n: number) => `${(n / eje.dias) * 100}%`;
  const pos = (f: Franja): CSSProperties => ({ left: pct(f.desde), width: pct(f.hasta - f.desde) });
  const asunto = (numero: number) => detalleDe(agenda, numero)?.asunto ?? '';

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600" aria-label="Leyenda">
        <Leyenda className="bg-blue-400">Transcurrido</Leyenda>
        <Leyenda className="border border-blue-300 bg-blue-100">Falta hasta el fin estimado</Leyenda>
        <Leyenda className="border border-red-300" style={{ backgroundImage: RAYADO }}>
          Retraso (pasado de fecha)
        </Leyenda>
        <Leyenda className="border-2 border-dashed border-slate-400 bg-white">Previsto</Leyenda>
        <Leyenda className="border border-gray-200 bg-gray-100">Fin de semana, festivo o cierre</Leyenda>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-blue-500" aria-hidden /> Hoy
        </li>
      </ul>
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="relative" style={{ minWidth: ETIQ + eje.dias * COL_MIN }}>
          {/* Fondo: los días no hábiles, de arriba abajo */}
          <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: ETIQ }} aria-hidden>
            {dias.map((d, i) => (d.habil ? null : <div key={d.fecha} className="absolute inset-y-0 bg-gray-100" style={{ left: pct(i), width: pct(1) }} />))}
          </div>

          <div className="flex border-b border-gray-200 text-[11px] text-gray-500">
            <div className="sticky left-0 z-10 flex shrink-0 items-end border-r border-gray-200 bg-gray-50 px-2 pb-1.5 font-semibold uppercase tracking-wide" style={{ width: ETIQ }}>
              Puesto
            </div>
            <div className="relative min-w-0 flex-1" style={{ height: 52 }}>
              {mesesDelEje(eje).map((m) => (
                <div key={m.etiqueta} className="absolute top-0 truncate border-l border-gray-200 px-1.5 pt-1 font-semibold capitalize text-gray-700" style={pos({ desde: m.desde, hasta: m.hasta + 1 })}>
                  {m.etiqueta}
                </div>
              ))}
              {dias.map((d, i) => (
                <div key={d.fecha} title={d.motivo ?? undefined} className={`absolute bottom-1 text-center leading-tight tabular-nums ${d.habil ? '' : 'text-gray-400'}`} style={pos({ desde: i, hasta: i + 1 })}>
                  <span className="block">{d.letra}</span>
                  <span className={`mx-auto block w-5 rounded ${d.fecha === agenda.hoy ? 'bg-blue-600 font-semibold text-white' : ''}`}>{d.dia}</span>
                </div>
              ))}
            </div>
          </div>

          {agenda.etapas.map((e) => {
            const r = resumenEtapa(e);
            return (
              <section key={e.etapa} aria-label={e.etiqueta}>
                <h3 className="relative z-[6] border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
                  <span className="sticky left-0 inline-block px-2 py-1.5">
                    <strong className="font-semibold uppercase tracking-wide text-gray-900">{e.etiqueta}</strong> · {r.ocupados}/{r.puestos} puestos · fila {r.enFila} · primer hueco {fmtFecha(r.primerHueco)}
                  </span>
                </h3>
                {e.puestos.length === 0 && <p className="relative z-[6] border-b border-gray-100 bg-white px-2 py-2 text-xs text-gray-400">Sin puestos configurados.</p>}
                {e.puestos.map((p) => {
                  const b = barraOcupante(p, eje, agenda.hoy);
                  const trozos = b ? [b.hecho, b.retraso, b.resto].filter((f): f is Franja => f !== null) : [];
                  const todo = trozos.length ? { desde: Math.min(...trozos.map((f) => f.desde)), hasta: Math.max(...trozos.map((f) => f.hasta)) } : null;
                  /** Un trozo, en porcentaje del ancho de la barra entera. */
                  const dentro = (f: Franja): CSSProperties => ({ left: `${((f.desde - todo!.desde) / (todo!.hasta - todo!.desde)) * 100}%`, width: `${((f.hasta - f.desde) / (todo!.hasta - todo!.desde)) * 100}%` });
                  const titulo = p.ocupante ? tituloOcupante(p, e.etiqueta, detalleDe(agenda, p.ocupante.numero)) : '';
                  return (
                    <div key={p.puesto} className="flex border-b border-gray-100 last:border-b-0" style={{ height: FILA }}>
                      <div className="sticky left-0 z-10 flex shrink-0 items-center justify-between gap-1 border-r border-gray-200 bg-white pl-2 pr-1 text-xs text-gray-700" style={{ width: ETIQ }}>
                        <span className="truncate" title={p.aExtinguir ? 'Por encima de los puestos configurados: sigue ocupado hasta que su ticket salga y no recibe a nadie más' : undefined}>
                          Puesto {p.puesto}
                          {p.aExtinguir ? ' · a extinguir' : !p.ocupante && <span className="text-emerald-700"> · libre</span>}
                        </span>
                        {accionPuesto?.(e, p)}
                      </div>
                      <div className="relative min-w-0 flex-1">
                        {p.ocupante && b && todo && (
                          <button type="button" title={titulo} aria-label={titulo} onClick={() => onTicket(p.ocupante!.numero)} className={`${BARRA} border border-blue-500 bg-white`} style={pos(todo)}>
                            {b.hecho && <span className="absolute inset-y-0 bg-blue-400" style={dentro(b.hecho)} />}
                            {b.retraso && <span className="absolute inset-y-0" style={{ ...dentro(b.retraso), backgroundImage: RAYADO }} />}
                            {b.resto && <span className="absolute inset-y-0 bg-blue-100" style={dentro(b.resto)} />}
                            {b.cortadaIzq && <ChevronsLeft className="relative h-3.5 w-3.5 shrink-0" aria-hidden />}
                            <span className="relative overflow-hidden whitespace-nowrap px-1">
                              <strong className="font-mono font-semibold">{p.ocupante.numero}</strong>
                              {p.pasadoDeFecha && <span className="font-semibold text-red-800"> · pasado de fecha</span>} {asunto(p.ocupante.numero)}
                            </span>
                            {b.cortadaDer && <ChevronsRight className="relative ml-auto h-3.5 w-3.5 shrink-0" aria-hidden />}
                          </button>
                        )}
                        {p.ocupante && !todo && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-500">Ticket {p.ocupante.numero}: su barra queda fuera del tramo visible</span>}
                        {previstosDePuesto(e, p.puesto).map((t) => {
                          const f = barraPrevista(t, eje)?.franja;
                          const detalle = `Previsto · ticket ${t.numero}${asunto(t.numero) ? ` · ${asunto(t.numero)}` : ''} · ${e.etiqueta}, puesto ${p.puesto} · entraría el ${fmtFecha(t.entradaPrevista)} y acabaría el ${fmtFecha(t.finPrevisto)}${t.encadenado ? ' · equipo nuevo que llega de la etapa anterior' : ''}`;
                          return f ? (
                            <button key={t.numero} type="button" title={detalle} aria-label={detalle} onClick={() => onTicket(t.numero)} className={`${BARRA} border-2 border-dashed border-slate-400 bg-white/80 text-slate-700`} style={pos(f)}>
                              <span className="overflow-hidden whitespace-nowrap px-0.5">
                                <strong className="font-mono font-semibold">{t.numero}</strong> · previsto {asunto(t.numero)}
                              </span>
                            </button>
                          ) : null;
                        })}
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}

          {/* La línea de hoy, a mitad de su columna: ahí empieza lo que se asigna hoy */}
          <div className="pointer-events-none absolute bottom-0 z-[5] w-0.5 bg-blue-500" style={{ top: 53, left: `calc(${ETIQ}px + (100% - ${ETIQ}px) * ${(columna(eje, agenda.hoy) + 0.5) / eje.dias})` }} aria-hidden />
        </div>
      </div>
    </div>
  );
}

function Leyenda({ className, style, children }: { className: string; style?: CSSProperties; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`h-3 w-5 rounded-sm ${className}`} style={style} aria-hidden />
      {children}
    </li>
  );
}

/** La agenda en el teléfono: en vez del calendario, una lista por días y por etapa (`listaPorDias`). */
export function ListaDias({ agenda, onTicket }: Pick<Props, 'agenda' | 'onTicket'>) {
  const dias = useMemo(() => listaPorDias(agenda), [agenda]);
  if (dias.length === 0) return <p className="rounded-2xl border border-gray-200 bg-white px-3 py-6 text-center text-sm text-gray-500 shadow-sm">Ningún puesto ocupado ni entrada prevista.</p>;
  return (
    <ol className="flex flex-col gap-3" aria-label="Agenda por días">
      {dias.map((d) => (
        <li key={d.fecha} className="min-w-0 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">
            {d.fecha === agenda.hoy && <span className="mr-1.5 rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white">Hoy</span>}
            {letraDia(d.fecha)} {fmtFecha(d.fecha)}
          </h3>
          {d.etapas.map((e) => (
            <div key={e.etapa} className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{e.etiqueta}</p>
              <ul className="divide-y divide-gray-100">
                {e.lineas.map((l) => (
                  <li key={`${l.que}-${l.numero}`}>
                    <button type="button" onClick={() => onTicket(l.numero)} className="flex min-h-[44px] w-full min-w-0 flex-wrap items-center gap-x-2 py-1 text-left text-sm">
                      <span className="font-mono font-semibold text-gray-900">{l.numero}</span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${l.retraso ? 'bg-red-50 text-red-800' : l.previsto ? 'border border-dashed border-slate-400 text-slate-700' : 'bg-blue-50 text-blue-800'}`}>
                        puesto {l.puesto} · {l.que}
                        {l.previsto && ' (previsto)'}
                        {l.retraso && ' · pasado de fecha'}
                      </span>
                      {detalleDe(agenda, l.numero)?.asunto && <span className="min-w-0 basis-full truncate text-xs text-gray-500">{detalleDe(agenda, l.numero)!.asunto}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}
