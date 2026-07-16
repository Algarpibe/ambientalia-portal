import { useEffect, useState } from 'react';
import { Trash2, Plus, Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_HUB_API_URL as string;
const authHeaders = (): Record<string, string> => {
  const t = localStorage.getItem('ambientalia_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

interface Recipient {
  id: string;
  email: string;
  nombre: string;
  activo: boolean;
}

export default function Destinatarios() {
  const [lista, setLista] = useState<Recipient[]>([]);
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const json = (extra: Record<string, string> = {}) => ({
    ...authHeaders(),
    'Content-Type': 'application/json',
    ...extra,
  });

  async function cargar() {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wo-sales/destinatarios`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setLista(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.');
    }
  }
  useEffect(() => {
    void cargar();
  }, []);

  async function añadir() {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/wo-sales/destinatarios`, {
        method: 'POST',
        headers: json(),
        body: JSON.stringify({ email, nombre }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
      setEmail('');
      setNombre('');
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo añadir.');
    } finally {
      setCargando(false);
    }
  }

  async function alternar(r: Recipient) {
    await fetch(`${API_BASE}/api/wo-sales/destinatarios/${r.id}`, {
      method: 'PATCH',
      headers: json(),
      body: JSON.stringify({ activo: !r.activo }),
    });
    await cargar();
  }

  async function borrar(id: string) {
    await fetch(`${API_BASE}/api/wo-sales/destinatarios/${id}`, { method: 'DELETE', headers: authHeaders() });
    await cargar();
  }

  return (
    <section className="bg-white rounded-2xl shadow-soft p-6 mt-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Destinatarios del correo automático</h2>
      <p className="text-sm text-gray-500 mb-4">
        Cuando cambian las órdenes de venta, el archivo se envía por correo a estas personas.
      </p>

      {error && (
        <p role="alert" className="text-sm text-rose-600 mb-3">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre"
          className="border rounded-lg px-3 py-2 text-sm"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@dominio.com"
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <button
          onClick={añadir}
          disabled={cargando || !email.trim() || !nombre.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {cargando ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Añadir
        </button>
      </div>

      <ul className="divide-y">
        {lista.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2 text-sm">
            <span className={r.activo ? '' : 'text-gray-400 line-through'}>
              {r.nombre} · <span className="font-mono">{r.email}</span>
            </span>
            <span className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={r.activo} onChange={() => alternar(r)} />
                <span className="text-gray-600">Activo</span>
              </label>
              <button onClick={() => borrar(r.id)} className="text-rose-600" title="Quitar">
                <Trash2 size={16} />
              </button>
            </span>
          </li>
        ))}
        {lista.length === 0 && <li className="py-2 text-sm text-gray-400">Aún no hay destinatarios.</li>}
      </ul>
    </section>
  );
}
