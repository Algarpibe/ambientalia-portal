import { useEffect, useState } from 'react';
import { Mail, Save, Check } from 'lucide-react';
import { authHeaders } from '@suite/auth-client';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;

type Frecuencia = 'inmediato' | 'diario' | 'semanal' | 'fin_de_mes' | 'nunca';

interface Destinatario {
  email: string;
  nombre: string;
  frecuencia: Frecuencia;
  hora: number | null;
  diaSemana: number | null;
}

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
  'rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none';

/**
 * Panel de administración: frecuencia con la que le llega el correo automático a cada
 * destinatario (usuarios activos con la app asignada). Solo se monta para admins; el
 * backend lo exige igualmente (requireAdmin).
 */
export default function FrecuenciaCorreos() {
  const [guardados, setGuardados] = useState<Destinatario[]>([]);
  const [borradores, setBorradores] = useState<Destinatario[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [recienGuardado, setRecienGuardado] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/wo-sales/email/frecuencias`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`No se pudo cargar la configuración (${res.status})`);
        const data = (await res.json()) as Destinatario[];
        setGuardados(data);
        setBorradores(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al cargar la configuración');
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
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wo-sales/email/frecuencias`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ email: d.email, frecuencia: d.frecuencia, hora: d.hora, diaSemana: d.diaSemana }),
      });
      if (!res.ok) throw new Error(`No se pudo guardar (${res.status})`);
      setGuardados((gs) => gs.map((g) => (g.email === d.email ? d : g)));
      setRecienGuardado(d.email);
      setTimeout(() => setRecienGuardado((e) => (e === d.email ? null : e)), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setGuardando(null);
    }
  };

  return (
    <section className="bg-white rounded-3xl border border-gray-200 shadow-soft p-6 mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Mail size={18} className="text-gray-500" />
        <h2 className="text-base font-semibold text-gray-900">Frecuencia de correos</h2>
        <span className="text-xs text-gray-400">(solo administradores)</span>
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Cada cuánto le llega a cada usuario el archivo por correo. Diario, semanal y fin de mes se envían a la hora
        elegida (hora de Colombia) y solo si hubo cambios desde su último correo.
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-600 mb-3">
          {error}
        </p>
      )}

      {borradores.length === 0 && !error ? (
        <p className="text-sm text-gray-500">No hay usuarios activos con la app asignada.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {borradores.map((d) => {
            const original = guardados.find((g) => g.email === d.email)!;
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
                  onChange={(e) => cambiar(d.email, { frecuencia: e.target.value as Frecuencia })}
                >
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
                    onChange={(e) => cambiar(d.email, { diaSemana: e.target.value ? Number(e.target.value) : null })}
                  >
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
                    onChange={(e) => cambiar(d.email, { hora: e.target.value ? Number(e.target.value) : null })}
                  >
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {recienGuardado === d.email ? <Check size={14} /> : <Save size={14} />}
                  {recienGuardado === d.email ? 'Guardado' : 'Guardar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
