import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Inventario } from '../api';
import { FRECUENCIA_MAX_MESES, FRECUENCIA_MIN_MESES, claveCliente, type CambioFrecuencia, type EquipoVista } from '../dominio';
import { efectoFrecuencia, equiposPorContrato, frecuenciaDe, frecuenciaElegida, lineasVistaFrecuencia, textoCambioFrecuencia, textoContrato, textoMeses } from '../lib/contratos';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, DESACTIVADO } from '../ui';
import { Lineas } from './MaestroEquipos';

interface Props {
  equipo: EquipoVista;
  inventario: Inventario;
  /** Tras cambiarla: el servidor devuelve el inventario ya recalculado. */
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
}

const CAMPO = `block min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`;

/**
 * «Frecuencia de preventivo del cliente» (lote 12), en la ficha de un equipo: la del cliente de este equipo según su contrato (meses o
 * «sin contrato»), con quién y cuándo, y lo que significa para ESTE equipo. Cualquiera con la app la ve; sólo un administrador del portal
 * (`contrato.write`, de ningún rol) pulsa «Cambiar» y le sale `FormularioFrecuencia`, el mismo de la lista de clientes de «Configuración»
 * (lote 13). Una sola frecuencia por cliente. No envía nada.
 */
export default function FrecuenciaContrato({ equipo: e, inventario, onInventario, notificar }: Props) {
  const editable = usePermisos().puede('contrato.write');
  const clave = claveCliente(e.cliente);
  const actual = frecuenciaDe(inventario.frecuencias ?? [], clave);
  const meses = actual?.meses ?? null;
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historial, setHistorial] = useState<CambioFrecuencia[] | null>(null);

  async function verHistorial() {
    try {
      setHistorial((await api.contrato(clave)).cambios);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section aria-labelledby="ficha-contrato" className="flex flex-col gap-1.5 border-t border-gray-200 pt-4 text-sm">
      <p id="ficha-contrato" className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Frecuencia de preventivo del cliente
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{textoMeses(meses)}</span>
        <BotonCambiar cliente={e.cliente} editable={editable} onClick={() => (setAbierto(true), setError(null))} />
      </div>
      {actual && <p className="text-xs text-gray-500" title={actual.motivo}>Puesta por {actual.por} · {fmtFechaHora(actual.en)}</p>}
      <p className="text-gray-700">{textoContrato(e, meses)}</p>
      <p className="text-xs text-gray-500">{editable ? 'Vale para todos los equipos de este cliente.' : 'Sólo lectura: la pone un administrador del portal.'} Una sola frecuencia por cliente.</p>
      {error && <Alert tone="red">{error}</Alert>}
      {abierto && (
        <FormularioFrecuencia
          clave={clave}
          cliente={e.cliente}
          meses={meses}
          inventario={inventario}
          onInventario={(inv) => (onInventario(inv), setHistorial(null))}
          notificar={notificar}
          onCerrar={() => setAbierto(false)}
        />
      )}
      <details className="text-xs text-gray-600" onToggle={(ev) => (ev.currentTarget as HTMLDetailsElement).open && historial === null && void verHistorial()}>
        <summary className="cursor-pointer py-1 font-medium text-blue-600">Historial de la frecuencia</summary>
        {historial === null ? (
          <p className="mt-1 text-gray-500">Cargando…</p>
        ) : historial.length === 0 ? (
          <p className="mt-1 text-gray-500">Nadie la ha cambiado todavía.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {historial.map((c) => (
              <li key={c.id}>{textoCambioFrecuencia(c)}</li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

/** «Cambiar» la frecuencia de un cliente: atenuado sin `contrato.write` (sólo administradores del portal). */
export function BotonCambiar({ cliente, editable, onClick }: { cliente: string; editable: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Cambiar la frecuencia de preventivo de ${cliente}`}
      disabled={!editable}
      onClick={onClick}
      className={`min-h-[44px] rounded-xl px-2 text-sm font-medium text-blue-600 hover:bg-blue-50 ${DESACTIVADO} disabled:bg-transparent disabled:text-gray-400 disabled:opacity-50`}
    >
      Cambiar
    </button>
  );
}

interface PropsFormulario {
  /** El cliente: su `claveCliente` (la de la ruta) y su nombre, para los textos. */
  clave: string;
  cliente: string;
  /** Su frecuencia de ahora (null = sin contrato). */
  meses: number | null;
  inventario: Inventario;
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
  /** Al cancelar o tras guardar. */
  onCerrar: () => void;
}

/**
 * El formulario de cambiar la frecuencia de preventivo de UN CLIENTE (lote 12; desde el lote 13, recibe el cliente y no el equipo para
 * que lo use también la lista de «Configuración»): meses o «sin contrato», la vista previa (cuántos de sus equipos «según contrato»
 * entran o salen de Avisos, +1 año y sin fecha), lo que pasa al confirmar y el motivo obligatorio, todo dentro de la página. Al abrirse
 * se lleva a la vista: un formulario que se abre lejos del botón parece que no hace nada.
 */
export function FormularioFrecuencia({ clave, cliente, meses, inventario, onInventario, notificar, onCerrar }: PropsFormulario) {
  const [modo, setModo] = useState<'sin' | 'meses'>('meses');
  const [texto, setTexto] = useState(meses === null ? '6' : String(meses));
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formulario.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const nueva = frecuenciaElegida(modo, texto);
  const valida = nueva !== undefined && nueva !== meses;

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    if (!valida) return;
    setEnviando(true);
    setError(null);
    try {
      onInventario(await api.cambiarFrecuencia(clave, nueva ?? null, motivo));
      notificar(`${cliente}: frecuencia de preventivo ${textoMeses(nueva ?? null)}`);
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <form ref={formulario} onSubmit={(ev) => void confirmar(ev)} aria-label={`Frecuencia de preventivo de ${cliente}`} className="mt-2 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-sm">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-gray-700">Según el contrato de {cliente}</legend>
        <label className="flex min-h-[44px] flex-wrap items-center gap-2">
          <input type="radio" name={`frecuencia-${clave}`} checked={modo === 'meses'} onChange={() => setModo('meses')} className={DESACTIVADO} />
          Preventivo cada
          <input
            type="number"
            inputMode="numeric"
            min={FRECUENCIA_MIN_MESES}
            max={FRECUENCIA_MAX_MESES}
            step={1}
            aria-label="Meses entre preventivos"
            value={texto}
            onFocus={() => setModo('meses')}
            onChange={(ev) => (setModo('meses'), setTexto(ev.target.value))}
            className={`${CAMPO} w-24`}
          />
          meses
          {modo === 'meses' && <span className="text-xs text-gray-600">{nueva === undefined ? `Un número entero de ${FRECUENCIA_MIN_MESES} a ${FRECUENCIA_MAX_MESES}.` : textoMeses(nueva)}</span>}
        </label>
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="radio" name={`frecuencia-${clave}`} checked={modo === 'sin'} onChange={() => setModo('sin')} className={DESACTIVADO} />
          Sin contrato (sus equipos «según contrato» no vencen ni avisan)
        </label>
      </fieldset>
      {nueva !== undefined && (
        <>
          <Lineas lineas={lineasVistaFrecuencia(inventario.equipos, clave, meses, nueva, inventario.hoy).map((l) => ({ texto: l.texto, valor: l.valor, cambia: l.cambia === true, aviso: l.aviso === true }))} />
          <p className="text-xs text-gray-600">{efectoFrecuencia(equiposPorContrato(inventario.equipos, clave).length, nueva)}</p>
        </>
      )}
      {error && <Alert tone="red">{error}</Alert>}
      <label className="block">
        <span className="mb-1 block font-medium text-gray-700">Motivo (obligatorio)</span>
        <textarea rows={2} maxLength={500} required className={`${CAMPO} w-full`} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={enviando} disabled={motivo.trim() === '' || !valida}>
          Guardar frecuencia
        </Button>
        <Button onClick={onCerrar} disabled={enviando}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
