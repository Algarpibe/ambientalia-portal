import { ESTADOS, ETIQUETA_ESTADO, ESTADOS_AVISO, type EquipoVista, type EstadoCalibracion } from '../dominio';
import { MESES, MESES_CORTOS, conteoPorEstado, porCliente, porUrgencia, vencimientosPorMes } from '../lib/vistas';
import { Card, TONO, Tag } from '../ui';

const DESCRIPCION: Record<EstadoCalibracion, string> = {
  FUERA_CICLO: 'Más de 2 años sin calibrar',
  VENCIDA: 'Llegada urgente posible',
  VENCE_30: 'Avisar ya',
  VENCE_60: 'Programar servicio',
  VENCE_90: 'Aviso previo',
  AL_DIA: 'Más de 90 días de vigencia',
  SIN_FECHA: 'Falta la última calibración',
};

interface Props {
  equipos: EquipoVista[];
  hoy: string;
  onEstados: (e: EstadoCalibracion[]) => void;
  onCliente: (cliente: string) => void;
  onEnCasa: () => void;
  onMes: (anio: number, mes: number) => void;
  onAvisos: () => void;
  onFicha: (clave: string) => void;
}

export default function Resumen({ equipos, hoy, onEstados, onCliente, onEnCasa, onMes, onAvisos, onFicha }: Props) {
  const cnt = conteoPorEstado(equipos);
  const total = equipos.length;
  const enCasa = equipos.filter((e) => e.seguimiento?.enAmbientalia).length;
  const pidenAviso = equipos.filter((e) => ESTADOS_AVISO.includes(e.estado) && !e.seguimiento?.enAmbientalia);
  const sinAviso = pidenAviso.filter((e) => !e.seguimiento?.avisoEnviado).length;
  const { atraso, meses } = vencimientosPorMes(equipos, hoy);
  const max = Math.max(atraso, ...meses.map((m) => m.total), 1);
  const urgentes = equipos.filter((e) => e.estado === 'VENCIDA' || e.estado === 'VENCE_30').sort(porUrgencia);
  const clientes = porCliente(equipos);

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Equipos por estado">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">Equipos por estado de calibración</h2>
          <p className="text-xs text-gray-500">{total} GRIMM EDM 180 · pulsa un estado para ver sus equipos</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {ESTADOS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onEstados([s])}
              className="relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-xl border border-gray-200 bg-white p-3 pl-4 text-left shadow-sm transition-colors hover:bg-gray-50"
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${TONO[s].bar}`} aria-hidden />
              <span className="text-2xl font-bold tabular-nums text-gray-900">{cnt[s]}</span>
              <span className="text-xs font-semibold text-gray-700">{ETIQUETA_ESTADO[s]}</span>
              <span className="text-[11px] text-gray-500">{DESCRIPCION[s]}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
          {ESTADOS.map((s) => (cnt[s] ? <span key={s} className={TONO[s].bar} style={{ width: `${(cnt[s] / total) * 100}%` }} /> : null))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Seguimiento">
        <Indicador valor={enCasa} titulo="En Ambientalia ahora" nota="Marcados como ingresados en el taller" color="bg-blue-500" onClick={onEnCasa} />
        <Indicador valor={sinAviso} titulo="Pendientes de aviso" nota="Vencidos o ≤ 90 días, sin aviso registrado" color="bg-orange-500" onClick={onAvisos} />
        <Indicador valor={pidenAviso.length - sinAviso} titulo="Ya avisados" nota="Con fecha de aviso al cliente" color="bg-emerald-500" onClick={onAvisos} />
      </section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Vencimientos por mes" hint="Equipos cuya calibración cumple el año en cada mes. «Atraso» = ya vencidos (último año).">
          <div className="grid h-44 grid-cols-[repeat(13,minmax(0,1fr))] items-end gap-1.5">
            <Barra n={atraso} max={max} etiqueta="Atraso" color="bg-red-500" titulo="Vencidas en el último año" onClick={onAvisos} />
            {meses.map((m, i) => (
              <Barra
                key={`${m.anio}-${m.mes}`}
                n={m.total}
                max={max}
                etiqueta={`${MESES_CORTOS[m.mes]}${i === 0 || m.mes === 0 ? ` ${String(m.anio).slice(2)}` : ''}`}
                color="bg-blue-500"
                titulo={`${MESES[m.mes]} ${m.anio}: ${m.total} equipos`}
                onClick={() => onMes(m.anio, m.mes)}
              />
            ))}
          </div>
          <div className="border-t border-gray-200" />
        </Card>

        <Card title="Llegada urgente" hint={`${cnt.VENCIDA} vencidas · ${cnt.VENCE_30} vencen en ≤ 30 días`}>
          {urgentes.length === 0 ? (
            <p className="text-sm text-gray-500">Ningún equipo vencido ni a punto de vencer.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {urgentes.slice(0, 10).map((e) => (
                <FilaUrgente key={e.clave} e={e} onClick={() => onFicha(e.clave)} />
              ))}
            </ul>
          )}
          {urgentes.length > 10 && (
            <button type="button" onClick={() => onEstados(['VENCIDA', 'VENCE_30'])} className="mt-2 text-sm font-medium text-blue-600 hover:underline">
              Ver los {urgentes.length}
            </button>
          )}
        </Card>
      </div>

      <Card title="Resumen por cliente" hint={`${clientes.length} clientes · pulsa uno para ver sus equipos`}>
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-semibold sm:px-5">Cliente</th>
                <th className="px-3 py-2 text-right font-semibold">Equipos</th>
                <th className="px-3 py-2 text-right font-semibold">Vencidas</th>
                <th className="px-3 py-2 text-right font-semibold">Vencen ≤ 90 d</th>
                <th className="px-3 py-2 text-right font-semibold">Al día</th>
                <th className="px-3 py-2 text-right font-semibold">+1 año</th>
                <th className="px-4 py-2 text-right font-semibold sm:px-5">En Ambientalia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clientes.map((c) => (
                <tr key={c.cliente} onClick={() => onCliente(c.cliente)} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900 sm:px-5">{c.cliente}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.vencidas ? <span className="font-semibold text-red-600">{c.vencidas}</span> : <span className="text-gray-300">0</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.proximas90 ? <span className="font-semibold text-orange-600">{c.proximas90}</span> : <span className="text-gray-300">0</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.alDia}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{c.fueraCiclo}</td>
                  <td className="px-4 py-2 text-right tabular-nums sm:px-5">{c.enAmbientalia || <span className="text-gray-300">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Indicador({ valor, titulo, nota, color, onClick }: { valor: number; titulo: string; nota: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="relative flex flex-col gap-1 overflow-hidden rounded-xl border border-gray-200 bg-white p-3 pl-4 text-left shadow-sm hover:bg-gray-50">
      <span className={`absolute inset-y-0 left-0 w-1 ${color}`} aria-hidden />
      <span className="text-2xl font-bold tabular-nums text-gray-900">{valor}</span>
      <span className="text-xs font-semibold text-gray-700">{titulo}</span>
      <span className="text-[11px] text-gray-500">{nota}</span>
    </button>
  );
}

function Barra({ n, max, etiqueta, color, titulo, onClick }: { n: number; max: number; etiqueta: string; color: string; titulo: string; onClick: () => void }) {
  return (
    <button type="button" title={titulo} onClick={onClick} className="group flex h-full min-w-0 flex-col items-center justify-end gap-1">
      <span className="text-xs font-semibold tabular-nums text-gray-700">{n}</span>
      <span className={`w-full max-w-[36px] rounded-t ${color} group-hover:opacity-80`} style={{ height: `${Math.max((n / max) * 120, 2)}px` }} />
      <span className="truncate text-[10px] uppercase tracking-wide text-gray-500">{etiqueta}</span>
    </button>
  );
}

export function FilaUrgente({ e, onClick }: { e: EquipoVista; onClick: () => void }) {
  const v = e.vigenciaDias ?? 0;
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full min-w-0 items-center justify-between gap-3 py-2 text-left hover:bg-gray-50">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-gray-900">{e.cliente}</span>
          <span className="block truncate text-xs text-gray-500">
            <span className="font-mono">{e.serial}</span> · {e.modelo}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {e.seguimiento?.enAmbientalia ? <Tag tone="blue">En Ambientalia</Tag> : e.seguimiento?.avisoEnviado ? <Tag>Avisado</Tag> : null}
          <span className={`text-sm font-semibold tabular-nums ${TONO[e.estado].text}`}>{v < 0 ? `${v} d` : `+${v} d`}</span>
        </span>
      </button>
    </li>
  );
}
