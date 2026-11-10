// Panel de llaves de «Equipos en taller» (solo admin): quién edita los ajustes y quién
// recibe la alerta de foto vieja. Se abre plegado; carga la lista al desplegarlo.
// Los admin ya editan sin la llave; la alerta, en cambio, se da explícitamente (§6).
import { useState } from 'react';
import type { ApiEquipos } from './api';
import type { LlavesUsuario, UsuarioConLlaves } from './nucleo';

export default function PanelLlaves({ api }: { api: ApiEquipos }) {
  const [usuarios, setUsuarios] = useState<UsuarioConLlaves[] | null>(null);
  const [error, setError] = useState('');

  async function abrir(abierto: boolean) {
    if (!abierto || usuarios) return;
    try { setUsuarios(await api.llaves()); }
    catch (e) { setError('No se pudieron cargar las llaves: ' + (e as Error).message); }
  }
  async function cambiar(u: UsuarioConLlaves, cambio: Partial<LlavesUsuario>) {
    try {
      const nuevo = await api.guardarLlaves(u.userId, { editaAjustes: u.editaAjustes, recibeAlertas: u.recibeAlertas, ...cambio });
      setUsuarios((l) => (l ? l.map((x) => (x.userId === u.userId ? nuevo : x)) : l));
      setError('');
    } catch (e) { setError('No se pudo guardar: ' + (e as Error).message); }
  }

  return (
    <details className="mt-8 rounded border border-slate-200 bg-white p-3 text-sm" onToggle={(e) => void abrir((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-semibold">Llaves de la app</summary>
      <p className="mt-2 text-slate-600">«Edita ajustes»: puede usar los botones de ajuste manual. «Recibe alertas»: recibe el correo cuando la información lleva dos actualizaciones diarias sin poder actualizarse. Los administradores editan sin la llave, pero la alerta hay que dársela.</p>
      {error ? <p role="alert" className="mt-2 text-red-800">{error}</p> : null}
      {usuarios === null ? (
        <p className="mt-2 text-slate-500">Cargando…</p>
      ) : usuarios.length ? (
        <table className="mt-2 w-full text-left">
          <thead className="text-slate-600"><tr><th className="py-1">Usuario</th><th className="py-1">Edita ajustes</th><th className="py-1">Recibe alertas</th></tr></thead>
          <tbody>{usuarios.map((u) => (
            <tr key={u.userId} className="border-t border-slate-200">
              <td className="py-1.5">{u.nombre}<div className="text-slate-500">{u.email}{u.esAdmin ? ' · admin' : ''}</div></td>
              <td className="py-1.5"><input type="checkbox" aria-label={'Edita ajustes: ' + u.nombre} checked={u.editaAjustes} onChange={(e) => void cambiar(u, { editaAjustes: e.target.checked })} /></td>
              <td className="py-1.5"><input type="checkbox" aria-label={'Recibe alertas: ' + u.nombre} checked={u.recibeAlertas} onChange={(e) => void cambiar(u, { recibeAlertas: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : (
        <p className="mt-2 text-slate-500">Nadie tiene la app todavía. Asígnala desde la gestión de usuarios del portal.</p>
      )}
    </details>
  );
}
