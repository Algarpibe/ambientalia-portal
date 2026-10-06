import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { EquipoVista } from '../dominio';
import { MESES, MESES_CORTOS, porUrgencia, rejillaMes, textoVigencia } from '../lib/vistas';
import { Button, Card, TONO } from '../ui';
import { FilaUrgente } from './Resumen';

interface Props {
  equipos: EquipoVista[];
  hoy: string;
  mes: { anio: number; mes: number } | null;
  onMes: (m: { anio: number; mes: number }) => void;
  onFicha: (clave: string) => void;
}

const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MAX_POR_DIA = 4;

export default function Calendario({ equipos, hoy, mes, onMes, onFicha }: Props) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [y, m] = hoy.split('-').map(Number);
  const actual = mes ?? { anio: y, mes: m - 1 };
  const dias = rejillaMes(equipos, actual.anio, actual.mes);
  const delMes = dias.filter((d) => d.delMes && d.equipos.length);
  const totalMes = delMes.reduce((s, d) => s + d.equipos.length, 0);
  const atraso = equipos.filter((e) => e.estado === 'VENCIDA').sort(porUrgencia);

  const mover = (n: number) => {
    const t = actual.mes + n;
    onMes({ anio: actual.anio + Math.floor(t / 12), mes: ((t % 12) + 12) % 12 });
  };

  const Evento = ({ e }: { e: EquipoVista }) => (
    <button
      type="button"
      onClick={() => onFicha(e.clave)}
      title={`${e.cliente} · ${e.serial} · ${textoVigencia(e.vigenciaDias)}`}
      className={`block w-full truncate rounded border-l-4 bg-gray-50 px-1.5 py-0.5 text-left text-[11px] font-medium text-gray-800 hover:bg-gray-100 ${TONO[e.estado].chip}`}
    >
      {e.cliente} <span className="font-mono text-[10px] text-gray-500">{e.serial}</span>
    </button>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 w-full text-lg sm:w-auto sm:min-w-[180px] font-semibold capitalize text-gray-900">
            {MESES[actual.mes]} {actual.anio}
          </h2>
          <Button onClick={() => mover(-1)} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button onClick={() => onMes({ anio: y, mes: m - 1 })}>Hoy</Button>
          <Button onClick={() => mover(1)} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
          <p className="text-xs text-gray-500">
            {totalMes} vencimiento{totalMes === 1 ? '' : 's'} este mes · cada equipo aparece el día en que se cumple el año desde su última calibración
          </p>
        </div>

        {/* Rejilla mensual (pantallas medianas y grandes) */}
        <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 md:grid">
          {DIAS.map((d) => (
            <div key={d} className="bg-gray-50 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {d}
            </div>
          ))}
          {dias.map((d) => (
            <div
              key={d.fecha}
              className={`flex min-h-[108px] min-w-0 flex-col gap-1 p-1.5 ${d.delMes ? 'bg-white' : 'bg-gray-50'} ${d.fecha === hoy ? 'ring-2 ring-inset ring-blue-500' : ''}`}
            >
              <span className={`text-xs font-semibold tabular-nums ${d.delMes ? 'text-gray-700' : 'text-gray-300'}`}>{Number(d.fecha.slice(8))}</span>
              {(abierto === d.fecha ? d.equipos : d.equipos.slice(0, MAX_POR_DIA)).map((e) => (
                <Evento key={e.clave} e={e} />
              ))}
              {d.equipos.length > MAX_POR_DIA && (
                <button type="button" onClick={() => setAbierto(abierto === d.fecha ? null : d.fecha)} className="text-left text-[11px] font-medium text-blue-600 hover:underline">
                  {abierto === d.fecha ? 'Ver menos' : `+${d.equipos.length - MAX_POR_DIA} más`}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Agenda (teléfono) */}
        <div className="flex flex-col gap-2 md:hidden">
          {delMes.length === 0 && <p className="text-sm text-gray-500">Sin vencimientos este mes.</p>}
          {delMes.map((d) => (
            <div key={d.fecha} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="mb-2 text-sm font-semibold text-gray-800">
                {Number(d.fecha.slice(8))} {MESES_CORTOS[actual.mes]}
              </p>
              <div className="flex flex-col gap-1">
                {d.equipos.map((e) => (
                  <Evento key={e.clave} e={e} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Card title={`Atraso: vencidas (${atraso.length})`} hint="Calibración vencida en el último año. Pueden llegar sin previo aviso.">
        {atraso.length === 0 ? (
          <p className="text-sm text-gray-500">Ninguna.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {atraso.map((e) => (
              <FilaUrgente key={e.clave} e={e} onClick={() => onFicha(e.clave)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
