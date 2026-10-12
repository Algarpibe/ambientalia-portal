import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { CalibracionHoja } from '../dominio';
import { ETIQUETA_ESTADO_FILA, detalleCalibracion, efectoAnular, firmaManual, ticketsCorregibles } from '../lib/calibraciones';
import { origenDe } from '../lib/hoja';
import { fmtFecha } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, DESACTIVADO, Tag } from '../ui';

const INPUT = `block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`;
const CAJA = 'flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3';

interface Props {
  items: CalibracionHoja[];
  /** De quién son: un equipo del portal (su clave) o una fila de la hoja congelada. `null` = no se les puede atribuir nada (serial repetido): sólo consulta. */
  destino: { clave: string } | { fila: number } | null;
  /** Tras registrar o anular: quien la pinta vuelve a pedir lo suyo. */
  onCambio: () => Promise<void>;
}

/**
 * Las calibraciones conocidas de un equipo o de una fila de la hoja (ficha de
 * equipo y panel de la pestaña F-ST-022) y, con `calibraciones.write`, lo que
 * se puede hacer con ellas (lote 9d-2b): «Corregir fecha» —registra una
 * manual, que puede corregir un ticket del historial— y «Anular» una fila,
 * las dos con motivo y dentro de la página. Sin el permiso, sólo se consulta.
 * Una fecha nunca se edita. La guarda de verdad es la del servidor.
 */
export default function CalibracionesLista({ items, destino, onCambio }: Props) {
  const editable = usePermisos().puede('calibraciones.write') && destino !== null;
  /** Qué se está haciendo: registrar una manual o anular esa calibración. */
  const [accion, setAccion] = useState<'corregir' | CalibracionHoja | null>(null);
  const [fecha, setFecha] = useState('');
  const [ticket, setTicket] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickets = ticketsCorregibles(items);
  const abrir = (a: typeof accion) => (setAccion(a), setFecha(''), setTicket(''), setMotivo(''), setError(null));

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (accion === null || destino === null) return;
    setEnviando(true);
    setError(null);
    try {
      if (accion === 'corregir') await api.registrarCalibracion({ ...destino, fecha, motivo, corrigeTicket: ticket ? Number(ticket) : null });
      else await api.anularCalibracion(accion.id, motivo);
      await onCambio();
      setAccion(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const Motivo = (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">Motivo (obligatorio)</span>
      <textarea rows={2} maxLength={500} required className={INPUT} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
    </label>
  );
  const botones = (texto: string) => (
    <>
      {error && <Alert tone="red">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={enviando} disabled={motivo.trim() === ''}>
          {texto}
        </Button>
        <Button onClick={() => setAccion(null)}>Cancelar</Button>
      </div>
    </>
  );

  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-1.5" title={detalleCalibracion(c)}>
            <span className={`font-medium tabular-nums ${c.estado === 'anulada' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{fmtFecha(c.fecha)}</span>
            <span className="text-gray-600">{origenDe(c)}</span>
            <Tag tone={c.estado === 'en_revision' ? 'amber' : 'gray'}>{ETIQUETA_ESTADO_FILA[c.estado]}</Tag>
            {c.cuenta && <Tag tone="blue">La que cuenta</Tag>}
            {editable && c.estado !== 'anulada' && (
              <button type="button" onClick={() => abrir(c)} className="rounded-lg px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                Anular
              </button>
            )}
            {firmaManual(c) && <span className="w-full text-xs text-gray-500">{firmaManual(c)}{c.motivo ? ` · ${c.motivo}` : ''}</span>}
          </li>
        ))}
      </ul>
      {editable && accion === null && (
        <div>
          <Button onClick={() => abrir('corregir')}>Corregir fecha</Button>
        </div>
      )}
      {accion === 'corregir' && (
        <form onSubmit={(ev) => void enviar(ev)} className={CAJA} aria-label="Corregir fecha">
          <p className="font-semibold text-gray-900">Corregir fecha: registrar una calibración manual</p>
          <p className="text-xs text-gray-600">Las fechas que ya hay no se borran ni se editan: se añade ésta, firmada. Cuenta como la última si es la más reciente; si corrige un ticket, manda sobre él hasta que su fecha cambie en Zoho.</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Fecha de calibración</span>
            <input type="date" required className={INPUT} value={fecha} onChange={(ev) => setFecha(ev.target.value)} />
          </label>
          {tickets.length > 0 && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">¿Corrige la fecha de un ticket?</span>
              <select className={INPUT} value={ticket} onChange={(ev) => setTicket(ev.target.value)}>
                <option value="">No: es una calibración más</option>
                {tickets.map((t) => (
                  <option key={t.ticket} value={t.ticket}>
                    Sí: la del ticket n.º {t.ticket} ({fmtFecha(t.fecha)})
                  </option>
                ))}
              </select>
            </label>
          )}
          {Motivo}
          {botones('Registrar calibración')}
        </form>
      )}
      {accion !== null && accion !== 'corregir' && (
        <form onSubmit={(ev) => void enviar(ev)} className={CAJA} aria-label="Anular calibración">
          <p className="font-semibold text-gray-900">
            Anular la calibración del {fmtFecha(accion.fecha)} ({origenDe(accion)})
          </p>
          <p className="text-xs text-gray-600">{efectoAnular(accion)}</p>
          {Motivo}
          {botones('Anular calibración')}
        </form>
      )}
    </>
  );
}
