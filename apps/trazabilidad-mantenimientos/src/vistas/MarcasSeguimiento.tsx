import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { SEGUN_CONTRATO, VIGENCIA_MAX_DIAS, VIGENCIA_MIN_DIAS, valorVigencia, type MarcaSeguimiento, type RespuestaMarcas } from '../dominio';
import { efectoMarca, efectoVigencia, lineasVistaPrevia, lineasVistaVigencia, textoCambioMarca, textoCambioVigencia, textoDias, textoValorVigencia, vigenciaElegida } from '../lib/marcas';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, Card, DESACTIVADO, Loading } from '../ui';
import { Lineas } from './MaestroEquipos';

interface Props {
  notificar: (msg: string) => void;
  /** Tras encender o apagar una marca, o cambiar su vigencia: el inventario de la app y la cabecera hay que leerlos otra vez. */
  onCambio: (r: RespuestaMarcas) => void;
}

/** Lo que se está confirmando: el interruptor de una marca o su vigencia (lote 11). Uno a la vez. */
type Accion = { tipo: 'interruptor' | 'vigencia'; m: MarcaSeguimiento };

const CAMPO = `block min-h-[44px] w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`;

/**
 * «Marcas en seguimiento» (lote 9f, Configuración): qué marcas entran en Resumen, Equipos, Calendario y Avisos. GRIMM EDM 180 va
 * fija; cada otra marca, con su interruptor. Desde el lote 11, también la VIGENCIA de calibración de cada marca (GRIMM, 365 días;
 * las demás, sin vencimiento hasta que se les ponga un plazo). Cualquiera con la app ve las marcas, su vigencia y sus recuentos; quien
 * tiene `inventario.write` (Director Técnico; administradores) pulsa el interruptor o «Cambiar», ve la vista previa y confirma con
 * motivo dentro de la página.
 */
export default function MarcasSeguimiento({ notificar, onCambio }: Props) {
  const editable = usePermisos().puede('inventario.write');
  const [datos, setDatos] = useState<RespuestaMarcas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [motivo, setMotivo] = useState('');
  /** La vigencia que se está eligiendo: sin vencimiento, un número de días (como texto, tal como se teclea) o, lote 12, según contrato. */
  const [modo, setModo] = useState<'sin' | 'dias' | 'contrato'>('sin');
  const [dias, setDias] = useState('');
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

  function abrir(tipo: Accion['tipo'], m: MarcaSeguimiento) {
    setAccion({ tipo, m });
    setMotivo('');
    setError(null);
    setModo(m.vigencia.contrato ? 'contrato' : m.vigencia.dias === null ? 'sin' : 'dias');
    setDias(m.vigencia.dias === null ? '365' : String(m.vigencia.dias));
  }

  const elegida = accion?.m ?? null;
  const nueva = accion?.tipo === 'vigencia' ? vigenciaElegida(modo, dias) : undefined;
  const vigenciaValida = nueva !== undefined && elegida !== null && nueva !== valorVigencia(elegida.vigencia);

  async function confirmar(ev: FormEvent) {
    ev.preventDefault();
    if (!accion) return;
    setEnviando(true);
    setError(null);
    try {
      const { m, tipo } = accion;
      const r = tipo === 'vigencia' ? await api.cambiarVigencia(m.clave, nueva ?? null, motivo) : await api.cambiarMarca(m.clave, !m.incluida, motivo);
      setDatos(r);
      onCambio(r);
      notificar(tipo === 'vigencia' ? `${m.marca}: vigencia ${textoValorVigencia(nueva ?? null)}` : `${m.marca}: ${m.incluida ? 'apagada' : 'encendida'}`);
      setAccion(null);
      setMotivo('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const titulo = !accion ? '' : accion.tipo === 'vigencia' ? `Vigencia de calibración de ${accion.m.marca}` : `${accion.m.incluida ? 'Apagar' : 'Encender'} ${accion.m.marca}`;
  const cambios = (datos?.cambios.length ?? 0) + (datos?.cambiosVigencia.length ?? 0);

  return (
    <Card
      title="Marcas en seguimiento"
      hint="Qué marcas entran en Resumen, Equipos, Calendario y Avisos, y cuándo vence su calibración. GRIMM EDM 180, siempre y a los 365 días (12 meses). Las demás no vencen mientras no se les ponga un plazo, o «según contrato del cliente»: Horiba se calibra con el preventivo de cada contrato, y la frecuencia de cada cliente se pone en la ficha de uno de sus equipos. Nada de esto envía nada: los avisos siguen siendo manuales o simulados."
    >
      {!editable && <p className="mb-3 text-xs text-gray-500">Sólo lectura: las enciende, las apaga y les pone la vigencia el Director Técnico.</p>}
      {error && (
        <div className="mb-3">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
      {!datos ? (
        !error && <Loading texto="Cargando las marcas…" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Marca</th>
                <th className="px-3 py-2 text-right font-semibold" title="Equipos activos y no retirados">Equipos</th>
                <th className="px-3 py-2 text-right font-semibold" title="Vencidos o por vencer: salen (o saldrían) en «Avisos a clientes»">En avisos</th>
                <th className="px-3 py-2 text-right font-semibold" title="Vencidos hace más de un año: no piden aviso">+1 año</th>
                <th className="px-3 py-2 text-right font-semibold">Sin fecha</th>
                <th className="px-3 py-2 font-semibold" title="Cuándo vence la calibración de sus equipos, desde la última">Vigencia</th>
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
                    <span className="block text-gray-900">{textoValorVigencia(valorVigencia(m.vigencia))}</span>
                    {m.vigencia.fija ? (
                      <span className="block text-xs text-gray-500">Fija</span>
                    ) : m.vigencia.firma ? (
                      <span className="block text-xs text-gray-500" title={m.vigencia.firma.motivo}>
                        por {m.vigencia.firma.por} · {fmtFechaHora(m.vigencia.firma.en)}
                      </span>
                    ) : (
                      <span className="block text-xs text-gray-500">Por defecto</span>
                    )}
                    {!m.vigencia.fija && (
                      <button
                        type="button"
                        aria-label={`Cambiar la vigencia de ${m.marca}`}
                        disabled={!editable || enviando}
                        onClick={() => abrir('vigencia', m)}
                        className={`min-h-[44px] rounded-xl px-2 text-sm font-medium text-blue-600 hover:bg-blue-50 ${DESACTIVADO} disabled:bg-transparent disabled:text-gray-400 disabled:opacity-50`}
                      >
                        Cambiar
                      </button>
                    )}
                  </td>
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
                        onClick={() => abrir('interruptor', m)}
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
      {accion && elegida && datos && (
        <form onSubmit={(ev) => void confirmar(ev)} aria-label={titulo} className="mt-3 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3">
          <p className="font-semibold text-gray-900">{titulo}</p>
          {accion.tipo === 'vigencia' ? (
            <>
              <fieldset className="flex flex-col gap-2 text-sm">
                <legend className="mb-1 font-medium text-gray-700">Cuándo vence su calibración</legend>
                <label className="flex min-h-[44px] items-center gap-2">
                  <input type="radio" name="vigencia" checked={modo === 'sin'} onChange={() => setModo('sin')} className={DESACTIVADO} />
                  Sin vencimiento (se calibra con el preventivo de su contrato: no vence ni avisa)
                </label>
                <label className="flex min-h-[44px] flex-wrap items-center gap-2">
                  <input type="radio" name="vigencia" checked={modo === 'dias'} onChange={() => setModo('dias')} className={DESACTIVADO} />
                  Vence a los
                  <input
                    type="number"
                    inputMode="numeric"
                    min={VIGENCIA_MIN_DIAS}
                    max={VIGENCIA_MAX_DIAS}
                    step={1}
                    aria-label="Días de vigencia"
                    value={dias}
                    onFocus={() => setModo('dias')}
                    onChange={(ev) => (setModo('dias'), setDias(ev.target.value))}
                    className={`${CAMPO} w-28`}
                  />
                  días de la última calibración
                  {modo === 'dias' && <span className="text-xs text-gray-600">{nueva === undefined || nueva === SEGUN_CONTRATO ? `Un número entero de ${VIGENCIA_MIN_DIAS} a ${VIGENCIA_MAX_DIAS}.` : textoDias(nueva)}</span>}
                </label>
                {/* Lote 12: cada equipo vence con la frecuencia de preventivo de SU cliente (la pone un administrador en la ficha de un equipo). */}
                <label className="flex min-h-[44px] items-center gap-2">
                  <input type="radio" name="vigencia" checked={modo === 'contrato'} onChange={() => setModo('contrato')} className={DESACTIVADO} />
                  Según contrato del cliente (cada equipo, con la frecuencia de preventivo de su cliente; sin ella, no vence)
                </label>
              </fieldset>
              {nueva !== undefined && (
                <>
                  <Lineas lineas={lineasVistaVigencia(elegida, nueva, datos.hoy).map((l) => ({ texto: l.texto, valor: l.valor, cambia: l.cambia === true, aviso: l.aviso === true }))} />
                  <p className="text-xs text-gray-600">{efectoVigencia(elegida, nueva)}</p>
                </>
              )}
            </>
          ) : (
            <>
              <Lineas lineas={lineasVistaPrevia(elegida).map((l) => ({ texto: l.texto, valor: String(l.valor), cambia: l.cambia === true, aviso: l.aviso === true }))} />
              <p className="text-xs text-gray-600">{efectoMarca(elegida)}</p>
            </>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Motivo (obligatorio)</span>
            <textarea rows={2} maxLength={500} required className={CAMPO} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={enviando} disabled={motivo.trim() === '' || (accion.tipo === 'vigencia' && !vigenciaValida)}>
              {accion.tipo === 'vigencia' ? 'Guardar vigencia' : `${elegida.incluida ? 'Apagar' : 'Encender'} ${elegida.marca}`}
            </Button>
            <Button onClick={() => setAccion(null)}>Cancelar</Button>
          </div>
        </form>
      )}
      {datos && cambios > 0 && (
        <details className="mt-3 text-xs text-gray-600">
          <summary className="cursor-pointer py-1 font-medium text-blue-600">Últimos cambios ({cambios})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {datos.cambios.map((c) => (
              <li key={`m${c.id}`}>{textoCambioMarca(c)}</li>
            ))}
            {datos.cambiosVigencia.map((c) => (
              <li key={`v${c.id}`}>{textoCambioVigencia(c)}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
