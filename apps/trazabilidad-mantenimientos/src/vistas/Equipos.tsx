import { useMemo, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { ESTADOS, ETIQUETA_ESTADO, type EquipoVista, type EstadoCalibracion } from '../dominio';
import { conteoPorEstado, fmtFecha } from '../lib/vistas';
import { EstadoBadge, TONO, Tag } from '../ui';

export interface Filtro {
  estados: EstadoCalibracion[];
  cliente: string;
  serial: string;
  enAmbientalia: boolean;
}
export const FILTRO_VACIO: Filtro = { estados: [], cliente: '', serial: '', enAmbientalia: false };

type Orden = 'vigencia' | 'cliente' | 'serial' | 'ultimaCalibracion' | 'ultimaEntrada';

interface Props {
  equipos: EquipoVista[];
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  onFicha: (clave: string) => void;
}

export default function Equipos({ equipos, filtro, onFiltro, onFicha }: Props) {
  const [orden, setOrden] = useState<{ k: Orden; dir: 1 | -1 }>({ k: 'vigencia', dir: 1 });
  const clientes = useMemo(() => [...new Set(equipos.map((e) => e.cliente))].sort((a, b) => a.localeCompare(b, 'es')), [equipos]);
  const cnt = conteoPorEstado(equipos);
  const q = filtro.serial.trim().toLowerCase();

  const lista = useMemo(() => {
    const val = (e: EquipoVista): string | number => {
      switch (orden.k) {
        case 'vigencia':
          // Lo urgente arriba: los FUERA_CICLO (más de un año vencidos) y los
          // SIN_FECHA van al final, no delante de las vencidas recientes.
          return e.estado === 'SIN_FECHA' ? 3e9 : e.estado === 'FUERA_CICLO' ? 2e9 - (e.vigenciaDias ?? 0) : (e.vigenciaDias ?? 0);
        case 'cliente':
          return e.cliente.toLowerCase();
        case 'serial':
          return e.serial;
        case 'ultimaCalibracion':
          return e.ultimaCalibracion ?? '';
        case 'ultimaEntrada':
          return e.ultimaEntrada ?? '';
      }
    };
    return equipos
      .filter(
        (e) =>
          (filtro.estados.length === 0 || filtro.estados.includes(e.estado)) &&
          (!filtro.cliente || e.cliente === filtro.cliente) &&
          (!filtro.enAmbientalia || e.seguimiento?.enAmbientalia) &&
          (!q || e.serial.toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * orden.dir;
      });
  }, [equipos, filtro, q, orden]);

  const set = (p: Partial<Filtro>) => onFiltro({ ...filtro, ...p });
  const toggleEstado = (s: EstadoCalibracion) =>
    set({ estados: filtro.estados.includes(s) ? filtro.estados.filter((x) => x !== s) : [...filtro.estados, s] });
  const hayFiltro = filtro.serial || filtro.estados.length || filtro.cliente || filtro.enAmbientalia;

  const Th = ({ k, children, right = false }: { k: Orden; children: string; right?: boolean }) => (
    <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : ''}`}>
      <button type="button" onClick={() => setOrden((o) => ({ k, dir: o.k === k ? (-o.dir as 1 | -1) : 1 }))} className="uppercase tracking-wide hover:text-gray-800">
        {children}
        {orden.k === k ? (orden.dir > 0 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filtro.cliente}
          onChange={(e) => set({ cliente: e.target.value })}
          aria-label="Cliente"
          className="min-h-[44px] min-w-[200px] flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Buscar por serial</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
          <input
            type="search"
            value={filtro.serial}
            onChange={(e) => set({ serial: e.target.value })}
            placeholder="Buscar por serial"
            className="block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <Chip activo={filtro.enAmbientalia} onClick={() => set({ enAmbientalia: !filtro.enAmbientalia })}>
          En Ambientalia
        </Chip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ESTADOS.map((s) => (
          <Chip key={s} activo={filtro.estados.includes(s)} onClick={() => toggleEstado(s)}>
            <span className={`h-2 w-2 rounded-full ${TONO[s].dot}`} aria-hidden />
            {ETIQUETA_ESTADO[s]}
            <span className="tabular-nums opacity-60">{cnt[s]}</span>
          </Chip>
        ))}
        {hayFiltro ? (
          <button type="button" onClick={() => onFiltro(FILTRO_VACIO)} className="px-2 text-sm font-medium text-blue-600 hover:underline">
            Quitar filtros
          </button>
        ) : null}
      </div>

      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-800">{lista.length}</span> equipo{lista.length === 1 ? '' : 's'} · pulsa una fila para registrar aviso, ingreso o nota
      </p>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
              <Th k="vigencia">Estado</Th>
              <Th k="cliente">Cliente</Th>
              <th className="px-3 py-2 font-semibold uppercase tracking-wide">Modelo</th>
              <Th k="serial">Serial</Th>
              <Th k="ultimaCalibracion">Última calibración</Th>
              <th className="px-3 py-2 font-semibold uppercase tracking-wide">Vence</th>
              <Th k="vigencia" right>
                Vigencia (días)
              </Th>
              <Th k="ultimaEntrada">Última entrada</Th>
              <th className="px-3 py-2 font-semibold uppercase tracking-wide">Seguimiento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lista.map((e) => (
              <tr key={e.clave} onClick={() => onFicha(e.clave)} className="cursor-pointer hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2">
                  <EstadoBadge estado={e.estado} />
                </td>
                <td className="px-3 py-2 text-gray-900">{e.cliente}</td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">{e.modelo}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]">
                  {e.serial} {e.serialRepetido && <Tag tone="amber">serial repetido</Tag>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtFecha(e.ultimaCalibracion)}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtFecha(e.vence)}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${TONO[e.estado].text}`}>{e.vigenciaDias ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-500">{fmtFecha(e.ultimaEntrada)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {e.seguimiento?.enAmbientalia && <Tag tone="blue">En Ambientalia</Tag>}
                    {e.seguimiento?.avisoEnviado && <Tag>Avisado {fmtFecha(e.seguimiento.avisoEnviado)}</Tag>}
                    {e.seguimiento?.servicioProgramado && <Tag>Prog. {fmtFecha(e.seguimiento.servicioProgramado)}</Tag>}
                    {!e.seguimiento?.enAmbientalia && !e.seguimiento?.avisoEnviado && !e.seguimiento?.servicioProgramado && <span className="text-gray-300">—</span>}
                  </div>
                </td>
              </tr>
            ))}
            {lista.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                  Ningún equipo cumple los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
        activo ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}
