import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { MarcaSeguimiento, RespuestaMarcas } from '../dominio';
import { efectoMarca, lineasVistaPrevia, textoCambioMarca } from '../lib/marcas';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, Card, DESACTIVADO, Loading } from '../ui';
import { Lineas } from './MaestroEquipos';

interface Props {
  notificar: (msg: string) => void;
  /** Tras encender o apagar una marca: el inventario de la app y la cabecera hay que leerlos otra vez. */
  onCambio: (r: RespuestaMarcas) => void;
}

/**
 * «Marcas en seguimiento» (lote 9f, Configuración): qué marcas entran en Resumen, Equipos, Calendario y Avisos. GRIMM EDM 180 va
 * fija; cada otra marca, con su interruptor. Cualquiera con la app ve las marcas y sus recuentos; quien tiene `inventario.write`
 * (Director Técnico; administradores) pulsa el interruptor, ve la vista previa y confirma con motivo dentro de la página.
 */
export default function MarcasSeguimiento({ notificar, onCambio }: Props) {
  const editable = usePermisos().puede('inventario.write');
  const [datos, setDatos] = useState<RespuestaMarcas | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** La marca cuyo interruptor se ha pulsado: su vista previa y su confirmación. */
  const [elegida, setElegida] = useState<MarcaSeguimiento | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.marcas());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    if (!elegida) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await api.cambiarMarca(elegida.clave, !elegida.incluida, motivo);
      setDatos(r);
      onCambio(r);
      notificar(`${elegida.marca}: ${elegida.incluida ? 'apagada' : 'encendida'}`);
      setElegida(null);
      setMotivo('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card
      title="Marcas en seguimiento"
      hint="Qué marcas entran en Resumen, Equipos, Calendario y Avisos. GRIMM EDM 180, siempre. Vigencia de calibración de 365 días para todas (la de la hoja F-ST-022). Encender una marca no envía nada: los avisos siguen siendo manuales o simulados."
    >
      {!editable && <p className="mb-3 text-xs text-gray-500">Sólo lectura: las enciende y las apaga el Director Técnico.</p>}
      {error && (
        <div className="mb-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      {!datos ? (
        !error && <Loading texto="Cargando las marcas…" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Marca</th>
                <th className="px-3 py-2 text-right font-semibold" title="Equipos activos y no retirados">Equipos</th>
                <th className="px-3 py-2 text-right font-semibold" title="Vencidos o por vencer: salen (o saldrían) en «Avisos a clientes»">En avisos</th>
                <th className="px-3 py-2 text-right font-semibold" title="Vencidos hace más de un año: no piden aviso">+1 año</th>
                <th className="px-3 py-2 text-right font-semibold">Sin fecha</th>
                <th className="px-3 py-2 font-semibold">En seguimiento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {datos.marcas.map((m) => (
                <tr key={m.clave} className={elegida?.clave === m.clave ? 'bg-blue-50' : ''}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-gray-900">{m.marca}</span>
                    {m.firma && <span className="block text-xs text-gray-500" title={m.firma.motivo}>{m.incluida ? 'Encendida' : 'Apagada'} por {m.firma.por} · {fmtFechaHora(m.firma.en)}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.resumen.equipos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.resumen.avisos}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{m.resumen.porEstado.FUERA_CICLO}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{m.resumen.porEstado.SIN_FECHA}</td>
                  <td className="px-3 py-1">
                    {m.fija ? (
                      <span className="text-xs text-gray-500">Siempre</span>
                    ) : (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={m.incluida}
                        aria-label={`${m.marca}: ${m.incluida ? 'en seguimiento' : 'fuera de seguimiento'}`}
                        disabled={!editable || enviando}
                        onClick={() => (setElegida(m), setMotivo(''), setError(null))}
                        className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-2 text-sm ${DESACTIVADO} disabled:bg-transparent disabled:opacity-50`}
                      >
                        <span aria-hidden className={`relative h-6 w-11 rounded-full transition-colors ${m.incluida ? 'bg-blue-600' : 'bg-gray-300'}`}>
                          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${m.incluida ? 'left-[22px]' : 'left-0.5'}`} />
                        </span>
                        {m.incluida ? 'Sí' : 'No'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {elegida && (
        <form onSubmit={(ev) => void confirmar(ev)} aria-label={`${elegida.incluida ? 'Apagar' : 'Encender'} ${elegida.marca}`} className="mt-3 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
          <p className="font-semibold text-gray-900">
            {elegida.incluida ? 'Apagar' : 'Encender'} {elegida.marca}
          </p>
          <Lineas lineas={lineasVistaPrevia(elegida).map((l) => ({ texto: l.texto, valor: String(l.valor), cambia: l.cambia === true, aviso: l.aviso === true }))} />
          <p className="text-xs text-gray-600">{efectoMarca(elegida)}</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Motivo (obligatorio)</span>
            <textarea rows={2} maxLength={500} required className={`block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={enviando} disabled={motivo.trim() === ''}>
              {elegida.incluida ? 'Apagar' : 'Encender'} {elegida.marca}
            </Button>
            <Button onClick={() => setElegida(null)}>Cancelar</Button>
          </div>
        </form>
      )}
      {datos && datos.cambios.length > 0 && (
        <details className="mt-3 text-xs text-gray-600">
          <summary className="cursor-pointer py-1 font-medium text-blue-600">Últimos cambios ({datos.cambios.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {datos.cambios.map((c) => (
              <li key={c.id}>{textoCambioMarca(c)}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
