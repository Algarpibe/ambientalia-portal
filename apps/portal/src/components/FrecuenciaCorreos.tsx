import { useEffect, useState } from 'react';
import { Mail, Save } from 'lucide-react';
import { authFetch } from '../lib/api';
import { notify } from '../lib/notify';

type Frecuencia = 'inmediato' | 'diario' | 'semanal' | 'fin_de_mes' | 'nunca';

interface Destinatario {
  email: string;
  nombre: string;
  frecuencia: Frecuencia;
  hora: number | null;
  diaSemana: number | null;
}

const RUTA = '/api/wo-sales/email/frecuencias';

const ETIQUETA: Record<Frecuencia, string> = {
  inmediato: 'Inmediato (con cada cambio)',
  diario: 'Diario',
  semanal: 'Semanal',
  fin_de_mes: 'Último día del mes',
  nunca: 'No enviar',
};

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const HORAS = Array.from({ length: 24 }, (_, h) => h);

const usaHora = (f: Frecuencia) => f === 'diario' || f === 'semanal' || f === 'fin_de_mes';
const esValido = (d: Destinatario) =>
  !usaHora(d.frecuencia) || (d.hora !== null && (d.frecuencia !== 'semanal' || d.diaSemana !== null));
const mismo = (a: Destinatario, b: Destinatario) =>
  a.frecuencia === b.frecuencia && a.hora === b.hora && a.diaSemana === b.diaSemana;

const selectCls =
  'rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-200';

/**
 * Ajustes (solo administradores): frecuencia con la que le llega a cada destinatario el
 * correo automático de pedidos de World Office (app WO-sales). Los destinatarios son los
 * usuarios activos con esa app asignada. El backend exige admin igualmente.
 */
export default function FrecuenciaCorreos() {
  const [guardados, setGuardados] = useState<Destinatario[]>([]);
  const [borradores, setBorradores] = useState<Destinatario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(RUTA);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const lista = Array.isArray(data) ? (data as Destinatario[]) : [];
        setGuardados(lista);
        setBorradores(lista);
      } catch {
        notify('No se pudo cargar la frecuencia de correos.', 'error');
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const cambiar = (email: string, parcial: Partial<Destinatario>) =>
    setBorradores((bs) =>
      bs.map((b) => {
        if (b.email !== email) return b;
        const n = { ...b, ...parcial };
        // Al cambiar de frecuencia se limpian los campos que ya no aplican.
        if (!usaHora(n.frecuencia)) n.hora = null;
        if (n.frecuencia !== 'semanal') n.diaSemana = null;
        return n;
      })
    );

  const guardar = async (d: Destinatario) => {
    setGuardando(d.email);
    try {
      const res = await authFetch(RUTA, {
        method: 'PUT',
        body: JSON.stringify({ email: d.email, frecuencia: d.frecuencia, hora: d.hora, diaSemana: d.diaSemana }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setGuardados((gs) => gs.map((g) => (g.email === d.email ? d : g)));
      notify(`Frecuencia de ${d.nombre} guardada.`, 'info');
    } catch {
      notify(`No se pudo guardar la frecuencia de ${d.nombre}.`, 'error');
    } finally {
      setGuardando(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Mail className="w-5 h-5 text-blue-500" />
        <h2 className="text-lg font-semibold text-gray-900">Frecuencia de correos · Carga de Pedidos WO</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Cada cuánto le llega a cada usuario el archivo de pedidos por correo. Diario, semanal y último día del mes
        se envían a la hora elegida (hora de Colombia) y solo si hubo cambios desde su último correo.
      </p>

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : borradores.length === 0 ? (
        <p className="text-sm text-gray-500">No hay usuarios activos con la app Carga de Pedidos WO asignada.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {borradores.map((d) => {
            const original = guardados.find((g) => g.email === d.email) ?? d;
            const cambiado = !mismo(d, original);
            return (
              <div key={d.email} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[14rem] flex-1">
                  <p className="text-sm font-medium text-gray-900">{d.nombre}</p>
                  <p className="text-xs text-gray-500">{d.email}</p>
                </div>
                <select
                  aria-label={`Frecuencia de ${d.nombre}`}
                  className={selectCls}
                  value={d.frecuencia}
                  onChange={(e) => cambiar(d.email, { frecuencia: e.target.value as Frecuencia })}>
                  {(Object.keys(ETIQUETA) as Frecuencia[]).map((f) => (
                    <option key={f} value={f}>
                      {ETIQUETA[f]}
                    </option>
                  ))}
                </select>
                {d.frecuencia === 'semanal' && (
                  <select
                    aria-label={`Día de ${d.nombre}`}
                    className={selectCls}
                    value={d.diaSemana ?? ''}
                    onChange={(e) => cambiar(d.email, { diaSemana: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Día…</option>
                    {DIAS.map((dia, i) => (
                      <option key={dia} value={i + 1}>
                        {dia}
                      </option>
                    ))}
                  </select>
                )}
                {usaHora(d.frecuencia) && (
                  <select
                    aria-label={`Hora de ${d.nombre}`}
                    className={selectCls}
                    value={d.hora ?? ''}
                    onChange={(e) => cambiar(d.email, { hora: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Hora…</option>
                    {HORAS.map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  disabled={!cambiado || !esValido(d) || guardando === d.email}
                  onClick={() => guardar(d)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  <Save className="w-4 h-4" /> Guardar
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
