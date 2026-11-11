// Panel de llaves de la TV del taller (solo admin), en Ajustes del portal. La lista trae solo metadatos:
// el secreto se ve UNA vez, al generar la llave (dirección completa de la pantalla), y no se guarda en
// ningún sitio; al cerrarlo desaparece. Revocar pide confirmación en línea (sin diálogos del navegador).
import { useCallback, useEffect, useState } from 'react';
import type { ApiTablero } from './api';
import type { Kiosco } from './nucleo';
import type { TipoAviso } from './PanelLlaves';

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : 'Nunca');
const BOTON = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ';
const AZUL = BOTON + 'bg-blue-600 text-white hover:bg-blue-700';
const GRIS = BOTON + 'border border-slate-300 text-slate-700 hover:bg-slate-50';

export default function PanelKiosco({ api, avisar }: {
  api: ApiTablero;
  /** Cómo se avisa del resultado (en el portal, sus notificaciones). Sin él, se muestra en el panel. */
  avisar?: (texto: string, tipo: TipoAviso) => void;
}) {
  const [lista, setLista] = useState<Kiosco[] | null>(null);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<{ texto: string; tipo: TipoAviso } | null>(null);
  const [nombre, setNombre] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [direccion, setDireccion] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);

  const aviso = (texto: string, tipo: TipoAviso) => (avisar ? avisar(texto, tipo) : setResultado({ texto, tipo }));
  const cargar = useCallback(() => api.kioscos().then(setLista, (e) => setError('No se pudieron cargar las llaves de la TV: ' + (e as Error).message)), [api]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function generar() {
    setOcupado(true);
    try {
      const { secreto } = await api.crearKiosco(nombre.trim());
      setDireccion(`${location.origin}/equipos-taller/tv#k=${secreto}`);
      setNombre('');
      await cargar();
    } catch (e) {
      aviso('No se pudo generar la llave: ' + (e as Error).message, 'error');
    } finally {
      setOcupado(false);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(direccion!);
      aviso('Dirección copiada.', 'info');
    } catch {
      aviso('No se pudo copiar. Selecciona la dirección y cópiala a mano.', 'error');
    }
  }

  async function revocar(k: Kiosco) {
    setOcupado(true);
    try {
      await api.revocarKiosco(k.id);
      setConfirmar(null);
      aviso('Llave de ' + k.nombre + ' revocada.', 'info');
      await cargar();
    } catch (e) {
      aviso('No se pudo revocar la llave de ' + k.nombre + ': ' + (e as Error).message, 'error');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm">
      <h2 className="text-lg font-semibold text-gray-900">Equipos en taller · Kiosco</h2>
      <p className="mt-2 text-slate-600">Cada televisor del taller entra con su propia llave, sin iniciar sesión. La dirección completa se muestra una sola vez al generarla; si se pierde, revoca la llave y genera otra.</p>
      {error ? <p role="alert" className="mt-2 text-red-800">{error}</p> : null}
      {resultado ? <p role={resultado.tipo === 'error' ? 'alert' : 'status'} className={'mt-2 ' + (resultado.tipo === 'error' ? 'text-red-800' : 'text-slate-600')}>{resultado.texto}</p> : null}

      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void generar(); }}>
        <label className="block">Nombre de la pantalla
          <input aria-label="Nombre de la pantalla" maxLength={60} value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1 block w-64 rounded-lg border border-slate-300 px-2 py-1.5" />
        </label>
        <button type="submit" disabled={ocupado || !nombre.trim()} className={AZUL}>Generar</button>
      </form>

      {direccion ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-slate-800">Esta dirección no se vuelve a mostrar. Ábrela en el televisor o guárdala ahora.</p>
          <input aria-label="Dirección de la pantalla" readOnly value={direccion} onFocus={(e) => e.target.select()} className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs" />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => void copiar()} className={AZUL}>Copiar</button>
            <button type="button" onClick={() => setDireccion(null)} className={GRIS}>Cerrar</button>
          </div>
        </div>
      ) : null}

      {lista === null ? (
        error ? null : <p className="mt-2 text-slate-500">Cargando…</p>
      ) : lista.length ? (
        <table className="mt-3 w-full text-left">
          <thead className="text-slate-600"><tr><th className="py-1">Pantalla</th><th className="py-1">Creada</th><th className="py-1">Último uso</th><th className="py-1">Estado</th><th className="py-1"><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{lista.map((k) => (
            <tr key={k.id} className="border-t border-slate-200">
              <td className="py-1.5">{k.nombre}<div className="text-slate-500">{k.creadoPor}</div></td>
              <td className="py-1.5">{fecha(k.creadoEn)}</td>
              <td className="py-1.5">{fecha(k.ultimoUsoEn)}</td>
              <td className="py-1.5">{k.revocadoEn ? 'Revocada ' + fecha(k.revocadoEn) : 'Activa'}</td>
              <td className="py-1.5 text-right">{k.revocadoEn ? null : confirmar === k.id ? (
                <span className="inline-flex gap-2">
                  <button type="button" aria-label={'¿Seguro? Revocar ' + k.nombre} disabled={ocupado} onClick={() => void revocar(k)} className={BOTON + 'bg-red-600 text-white hover:bg-red-700'}>¿Seguro? Revocar</button>
                  <button type="button" onClick={() => setConfirmar(null)} className={GRIS}>Cancelar</button>
                </span>
              ) : (
                <button type="button" aria-label={'Revocar ' + k.nombre} onClick={() => setConfirmar(k.id)} className={GRIS}>Revocar</button>
              )}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <p className="mt-3 text-slate-500">Todavía no hay llaves de pantalla.</p>
      )}
    </div>
  );
}
