import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { ApunteRetiro, Retiro as FirmaRetiro } from '../dominio';
import { efectoRetiro, textoRetiro, type AccionRetiro } from '../lib/hoja';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, DESACTIVADO } from '../ui';

interface Props {
  /** Lo que se puede hacer con este equipo o esta fila (`accionRetiro`); null = nada. */
  accion: AccionRetiro | null;
  /** Si ya está retirado a mano: quién, cuándo y por qué. */
  retirado: FirmaRetiro | null;
  /** Tras retirar o reincorporar: quien lo pinta vuelve a pedir lo suyo. */
  onCambio: (hecho: string) => Promise<void>;
}

const ROTULO = { equipo: ['Reincorporar equipo', 'Retirar equipo'], fila: ['Recuperar fila de la hoja', 'Retirar fila de la hoja'] } as const;

/**
 * Retirar y reincorporar a mano (lote 9d-2b), en la ficha de un equipo y en el
 * panel de la pestaña F-ST-022. Quien tiene `inventario.write` ve el botón; la
 * confirmación va dentro de la página, dice el efecto y pide el motivo. El
 * historial (quién, cuándo, por qué) lo puede abrir cualquiera. Nada se borra.
 */
export default function Retiro({ accion, retirado, onCambio }: Props) {
  const editable = usePermisos().puede('inventario.write');
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<ApunteRetiro[] | null>(null);
  if (!accion) return null;
  const rotulo = ROTULO[accion.de][Number(accion.retirar)];

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (!accion) return;
    setEnviando(true);
    setError(null);
    try {
      setHistorial((await api.retirar(accion.destino, accion.retirar, motivo)).retiros);
      setAbierto(false);
      setMotivo('');
      await onCambio(accion.retirar ? (accion.de === 'equipo' ? 'Equipo retirado' : 'Fila retirada') : accion.de === 'equipo' ? 'Equipo reincorporado' : 'Fila recuperada');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-label="Retiro" className="flex flex-col gap-2 border-t border-gray-200 pt-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{accion.de === 'equipo' ? 'Retiro del equipo' : 'Retiro de la fila'}</p>
      {retirado && <Alert tone="amber">{textoRetiro(retirado)}</Alert>}
      {editable && !abierto && (
        <div>
          <Button onClick={() => (setAbierto(true), setError(null))}>{rotulo}</Button>
        </div>
      )}
      {abierto && (
        <form onSubmit={(ev) => void enviar(ev)} aria-label={rotulo} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="font-semibold text-gray-900">{rotulo}</p>
          <p className="text-xs text-gray-600">{efectoRetiro(accion)}</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Motivo (obligatorio)</span>
            <textarea rows={2} maxLength={500} required className={`block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
          </label>
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={enviando} disabled={motivo.trim() === ''}>
              {rotulo}
            </Button>
            <Button onClick={() => setAbierto(false)}>Cancelar</Button>
          </div>
        </form>
      )}
      <details onToggle={(ev) => ev.currentTarget.open && historial === null && void api.retiros(accion.destino).then((r) => setHistorial(r.retiros), (e: Error) => setError(e.message))}>
        <summary className="cursor-pointer py-1 text-xs font-medium text-blue-600">Historial de retiros</summary>
        {historial?.length === 0 && <p className="text-xs text-gray-500">Nadie lo ha retirado nunca.</p>}
        <ul className="flex flex-col gap-1 text-xs text-gray-600">
          {historial?.map((r) => (
            <li key={r.id}>
              <span className="font-medium text-gray-900">{r.accion === 'retirar' ? 'Retirado' : 'Reincorporado'}</span> por {r.por} el {fmtFechaHora(r.en)} ({r.antes} → {r.despues}): {r.motivo}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
