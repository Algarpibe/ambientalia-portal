import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { CalibracionHoja } from '../dominio';
import { ETIQUETA_ESTADO_FILA, detalleCalibracion, efectoAnular, ticketsCorregibles } from '../lib/calibraciones';
import { origenDe } from '../lib/hoja';
import { fmtFecha } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, DESACTIVADO, Tag } from '../ui';

const INPUT = `block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`;
const CAJA = 'flex flex-col gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3';
/** Cabecera de la tabla: fija arriba si la lista baja por dentro de su recuadro. */
const TH = 'sticky top-0 border-b border-gray-200 bg-white py-1 pl-1 pr-2 font-medium';

interface Props {
  items: CalibracionHoja[];
  /** De quién son: un equipo del portal (su clave) o una fila de la hoja congelada. `null` = no se les puede atribuir nada (serial repetido): sólo consulta. */
  destino: { clave: string } | { fila: number } | null;
  /** Tras registrar o anular: quien la pinta vuelve a pedir lo suyo. */
  onCambio: () => Promise<void>;
  /** Clases de más para el recuadro de la tabla (la ficha de equipo lo acota en alto para no tener que bajar). */
  claseLista?: string;
}

/**
 * Las calibraciones conocidas de un equipo o de una fila de la hoja (ficha de
 * equipo y panel de la pestaña F-ST-022), en una tabla —fecha y estado; la que
 * cuenta, resaltada; de dónde sale, quién, cuándo y por qué, en el `title` de cada fila—
 * y, con `calibraciones.write`, lo que
 * se puede hacer con ellas (lote 9d-2b): «Corregir fecha» —registra una
 * manual, que puede corregir un ticket del historial— y «Anular» una fila,
 * las dos con motivo y dentro de la página. Sin el permiso, sólo se consulta.
 * Una fecha nunca se edita. La guarda de verdad es la del servidor.
 */
export default function CalibracionesLista({ items, destino, onCambio, claseLista = '' }: Props) {
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
      {items.length > 0 && (
        <div className={claseLista}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th scope="col" className={TH}>Fecha</th>
                <th scope="col" className={TH}>Estado</th>
                {editable && (
                  <th scope="col" className={TH}>
                    <span className="sr-only">Acciones</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const anulada = c.estado === 'anulada';
                return (
                  // De dónde sale (sin columna desde el 07/11/2026), quién, cuándo y por qué (y su anulación), al pasar el ratón.
                  <tr key={c.id} title={c.por ? `${origenDe(c)} · ${detalleCalibracion(c)}` : detalleCalibracion(c)} className={`border-b border-gray-100 ${c.cuenta ? 'bg-blue-50' : ''}`}>
                    <td className={`whitespace-nowrap py-1.5 pl-1 pr-2 font-medium tabular-nums ${anulada ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{fmtFecha(c.fecha)}</td>
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap gap-1">
                        <Tag tone={c.estado === 'en_revision' ? 'amber' : 'gray'}>{ETIQUETA_ESTADO_FILA[c.estado]}</Tag>
                        {c.cuenta && <Tag tone="blue">La que cuenta</Tag>}
                      </div>
                    </td>
                    {editable && (
                      <td className="py-1.5 text-right">
                        {!anulada && (
                          <button type="button" onClick={() => abrir(c)} aria-label={`Anular la calibración del ${fmtFecha(c.fecha)}`} className="rounded-lg px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50">
                            Anular
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
