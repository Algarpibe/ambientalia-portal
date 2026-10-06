import { useState } from 'react';
import { Copy, Mail } from 'lucide-react';
import { api, type Inventario } from '../api';
import type { ContactoCliente, EquipoVista } from '../dominio';
import { avisosPorCliente, fmtFecha, mensajeAviso, type GrupoAviso } from '../lib/vistas';
import { Alert, Button, Modal, TONO, Tag } from '../ui';
import SimulacionAvisos from './SimulacionAvisos';

interface Props {
  equipos: EquipoVista[];
  hoy: string;
  /** Los contactos puestos a mano a clientes (para la simulación). */
  contactos: ContactoCliente[];
  onFicha: (clave: string) => void;
  onCambio: () => Promise<void>;
  /** Sustituye el inventario por el que devuelve el servidor al guardar un contacto. */
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
}

const VENTANAS = [30, 60, 90] as const;

/**
 * Dos vistas: «Manual» es la de siempre (redactar, copiar y marcar como
 * avisado); «Simulación automática» enseña lo que enviaría hoy el aviso
 * automático a 90, 60 y 30 días, sin enviar nada.
 */
const VISTAS = [
  { id: 'manual', label: 'Manual' },
  { id: 'simulacion', label: 'Simulación automática' },
] as const;
type Vista = (typeof VISTAS)[number]['id'];

export default function Avisos({ equipos, hoy, contactos, onFicha, onCambio, onInventario, notificar }: Props) {
  const [vista, setVista] = useState<Vista>('manual');
  const [ventana, setVentana] = useState<number>(90);
  const [redactar, setRedactar] = useState<GrupoAviso | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grupos = avisosPorCliente(equipos, ventana);
  const nEquipos = grupos.reduce((s, g) => s + g.equipos.length, 0);
  const nSinAviso = grupos.reduce((s, g) => s + g.sinAviso, 0);

  async function marcar(g: GrupoAviso) {
    const claves = g.equipos.filter((e) => !e.seguimiento?.avisoEnviado).map((e) => e.clave);
    setOcupado(g.cliente);
    setError(null);
    try {
      const r = await api.registrarAvisos(claves, hoy);
      await onCambio();
      notificar(`${r.actualizados} equipo${r.actualizados === 1 ? '' : 's'} de ${g.cliente} marcado${r.actualizados === 1 ? '' : 's'} como avisado${r.actualizados === 1 ? '' : 's'}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const selector = (
    <div role="group" aria-label="Vista de los avisos" className="inline-flex self-start overflow-hidden rounded-xl border border-gray-300 bg-white">
      {VISTAS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={vista === v.id}
          onClick={() => setVista(v.id)}
          className={`min-h-[44px] px-4 text-sm font-medium transition-colors ${vista === v.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );

  if (vista === 'simulacion') {
    return (
      <div className="flex flex-col gap-4">
        {selector}
        <SimulacionAvisos equipos={equipos} hoy={hoy} contactos={contactos} onFicha={onFicha} onInventario={onInventario} notificar={notificar} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {selector}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-sm text-gray-600">Equipos vencidos o que vencen en los próximos</p>
        {VENTANAS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={ventana === v}
            onClick={() => setVentana(v)}
            className={`min-h-[36px] rounded-full border px-3 text-xs font-medium ${ventana === v ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            {v} días
          </button>
        ))}
        <p className="text-xs text-gray-500">
          · {grupos.length} clientes · {nEquipos} equipos · {nSinAviso} sin aviso · no incluye los que ya están en Ambientalia ni los que tienen ticket abierto en Desk
        </p>
      </div>

      {error && <Alert tone="red">{error}</Alert>}

      {grupos.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Nada que avisar en esta ventana. Prueba con una más amplia.</div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {grupos.map((g) => (
            <article key={g.cliente} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div>
                <h3 className="text-base font-semibold text-gray-900">{g.cliente}</h3>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.sinAviso ? (
                    <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700 ring-1 ring-inset ring-orange-200">{g.sinAviso} sin aviso</span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Todos avisados</span>
                  )}
                  <Tag>
                    {g.equipos.length} equipo{g.equipos.length === 1 ? '' : 's'}
                  </Tag>
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {g.equipos.map((e) => (
                    <tr key={e.clave} onClick={() => onFicha(e.clave)} className="cursor-pointer hover:bg-gray-50">
                      <td className="py-1.5 pr-2 font-mono text-[13px]">{e.serial}</td>
                      <td className="py-1.5 pr-2 tabular-nums text-gray-600">{fmtFecha(e.vence)}</td>
                      <td className={`py-1.5 pr-2 text-right font-semibold tabular-nums ${TONO[e.estado].text}`}>
                        {(e.vigenciaDias ?? 0) < 0 ? e.vigenciaDias : `+${e.vigenciaDias}`} d
                      </td>
                      <td className="py-1.5 text-right">{e.seguimiento?.avisoEnviado ? <Tag>Avisado {fmtFecha(e.seguimiento.avisoEnviado)}</Tag> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button onClick={() => setRedactar(g)}>
                  <Mail className="h-4 w-4" aria-hidden /> Redactar aviso
                </Button>
                {g.sinAviso > 0 && (
                  <Button variant="primary" busy={ocupado === g.cliente} onClick={() => void marcar(g)}>
                    Marcar {g.sinAviso} como avisado{g.sinAviso === 1 ? '' : 's'} hoy
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {redactar && <Redactar grupo={redactar} onClose={() => setRedactar(null)} notificar={notificar} />}
    </div>
  );
}

function Redactar({ grupo, onClose, notificar }: { grupo: GrupoAviso; onClose: () => void; notificar: (m: string) => void }) {
  const [texto, setTexto] = useState(() => mensajeAviso(grupo.cliente, grupo.equipos));
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      notificar('Texto copiado');
    } catch {
      notificar('No se pudo copiar: selecciona el texto y usa Ctrl+C');
    }
  }
  return (
    <Modal
      title={`Aviso para ${grupo.cliente}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cerrar</Button>
          <Button variant="primary" onClick={() => void copiar()}>
            <Copy className="h-4 w-4" aria-hidden /> Copiar texto
          </Button>
        </>
      }
    >
      <label className="block text-sm">
        <span className="mb-1 block text-gray-600">Puedes editarlo antes de copiarlo al correo.</span>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={14}
          className="block w-full rounded-xl border border-gray-300 bg-white p-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </label>
    </Modal>
  );
}
