// Panel de llaves de «Equipos en taller» (solo admin): quién edita los ajustes y quién
// recibe la alerta de foto vieja. Vive en Ajustes del portal (sección solo para admin) y
// carga la lista al montarse.
// Las casillas son un borrador: cada fila se guarda con su botón «Guardar», que solo se
// activa si esa fila cambió (igual que «Frecuencia de correos · Carga de Pedidos WO»).
// Los admin ya editan sin la llave; la alerta, en cambio, se da explícitamente (§6).
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { ApiEquipos } from './api';
import type { LlavesUsuario, UsuarioConLlaves } from './nucleo';

export type TipoAviso = 'info' | 'error';

const mismas = (a: LlavesUsuario, b: LlavesUsuario) => a.editaAjustes === b.editaAjustes && a.recibeAlertas === b.recibeAlertas;

export default function PanelLlaves({ api, avisar }: {
  api: ApiEquipos;
  /** Cómo se avisa del resultado de guardar (en el portal, sus notificaciones). Sin él, se muestra en el panel. */
  avisar?: (texto: string, tipo: TipoAviso) => void;
}) {
  const [guardados, setGuardados] = useState<UsuarioConLlaves[] | null>(null);
  const [borradores, setBorradores] = useState<UsuarioConLlaves[]>([]);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<{ texto: string; tipo: TipoAviso } | null>(null);

  useEffect(() => {
    let vivo = true;
    api.llaves().then(
      (l) => { if (vivo) { setGuardados(l); setBorradores(l); } },
      (e) => { if (vivo) setError('No se pudieron cargar las llaves: ' + (e as Error).message); },
    );
    return () => { vivo = false; };
  }, [api]);

  const aviso = (texto: string, tipo: TipoAviso) => (avisar ? avisar(texto, tipo) : setResultado({ texto, tipo }));

  const cambiar = (userId: string, cambio: Partial<LlavesUsuario>) =>
    setBorradores((bs) => bs.map((b) => (b.userId === userId ? { ...b, ...cambio } : b)));

  async function guardar(u: UsuarioConLlaves) {
    setGuardando(u.userId);
    try {
      const nuevo = await api.guardarLlaves(u.userId, { editaAjustes: u.editaAjustes, recibeAlertas: u.recibeAlertas });
      setGuardados((gs) => (gs ? gs.map((g) => (g.userId === u.userId ? nuevo : g)) : gs));
      aviso('Llaves de ' + u.nombre + ' guardadas.', 'info');
    } catch (e) {
      aviso('No se pudieron guardar las llaves de ' + u.nombre + ': ' + (e as Error).message, 'error');
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm">
      <h2 className="text-lg font-semibold text-gray-900">Equipos en taller · Llaves</h2>
      <p className="mt-2 text-slate-600">«Edita ajustes»: puede usar los botones de ajuste manual. «Recibe alertas»: recibe el correo cuando la información lleva dos actualizaciones diarias sin poder actualizarse. Los administradores editan sin la llave, pero la alerta hay que dársela.</p>
      {error ? <p role="alert" className="mt-2 text-red-800">{error}</p> : null}
      {resultado ? (
        <p role={resultado.tipo === 'error' ? 'alert' : 'status'} className={'mt-2 ' + (resultado.tipo === 'error' ? 'text-red-800' : 'text-slate-600')}>{resultado.texto}</p>
      ) : null}
      {guardados === null ? (
        error ? null : <p className="mt-2 text-slate-500">Cargando…</p>
      ) : borradores.length ? (
        <table className="mt-2 w-full text-left">
          <thead className="text-slate-600"><tr><th className="py-1">Usuario</th><th className="py-1">Edita ajustes</th><th className="py-1">Recibe alertas</th><th className="py-1"><span className="sr-only">Guardar</span></th></tr></thead>
          <tbody>{borradores.map((u) => {
            const original = guardados.find((g) => g.userId === u.userId) ?? u;
            const cambiado = !mismas(u, original);
            return (
              <tr key={u.userId} className="border-t border-slate-200">
                <td className="py-1.5">{u.nombre}<div className="text-slate-500">{u.email}{u.esAdmin ? ' · admin' : ''}</div></td>
                <td className="py-1.5"><input type="checkbox" aria-label={'Edita ajustes: ' + u.nombre} checked={u.editaAjustes} onChange={(e) => cambiar(u.userId, { editaAjustes: e.target.checked })} /></td>
                <td className="py-1.5"><input type="checkbox" aria-label={'Recibe alertas: ' + u.nombre} checked={u.recibeAlertas} onChange={(e) => cambiar(u.userId, { recibeAlertas: e.target.checked })} /></td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    aria-label={'Guardar llaves de ' + u.nombre}
                    disabled={!cambiado || guardando === u.userId}
                    onClick={() => void guardar(u)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    <Save className="w-4 h-4" /> Guardar
                  </button>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      ) : (
        <p className="mt-2 text-slate-500">Nadie tiene la app todavía. Asígnala desde la gestión de usuarios del portal.</p>
      )}
    </div>
  );
}
