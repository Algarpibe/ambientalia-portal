import { Fragment, useState } from 'react';
import type { Inventario } from '../api';
import { filasContratos, filtrarContratos, hayClientesSinFrecuencia, textoContadorContratos, textoMeses } from '../lib/contratos';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Card, DESACTIVADO, Loading } from '../ui';
import { BotonCambiar, FormularioFrecuencia } from './FrecuenciaContrato';

interface Props {
  /** El inventario de la app (GET /equipos): trae cada equipo con `segunContrato` y las `frecuencias` guardadas. null mientras llega. */
  inventario: Inventario | null;
  /** Si el inventario no se pudo leer. */
  errorInventario: string | null;
  /** Tras cambiar una frecuencia: el servidor devuelve el inventario ya recalculado. */
  onInventario: (inv: Inventario) => void;
  notificar: (msg: string) => void;
}

/**
 * «Frecuencia de preventivo por cliente» (lote 13, Configuración): una fila por cliente con equipos activos de marcas «según contrato del
 * cliente», para rellenar las frecuencias desde una sola pantalla en vez de abrir la ficha de un equipo de cada cliente. Los datos son los
 * del inventario que ya tiene la app (sin rutas nuevas). Cualquiera con la app la ve; sólo un administrador del portal (`contrato.write`)
 * pulsa «Cambiar», que abre bajo su fila el MISMO formulario de la ficha (`FormularioFrecuencia`). No envía nada.
 */
export default function FrecuenciasClientes({ inventario, errorInventario, onInventario, notificar }: Props) {
  const editable = usePermisos().puede('contrato.write');
  /** null = nadie lo ha tocado: encendido si queda algún cliente sin frecuencia. */
  const [soloSin, setSoloSin] = useState<boolean | null>(null);
  const [busqueda, setBusqueda] = useState('');
  /** La clave del cliente cuyo formulario está abierto. Uno a la vez. */
  const [abierta, setAbierta] = useState<string | null>(null);

  const todas = inventario ? filasContratos(inventario.equipos, inventario.frecuencias ?? []) : [];
  const soloSinFrecuencia = soloSin ?? hayClientesSinFrecuencia(todas);
  const filas = filtrarContratos(todas, { soloSinFrecuencia, busqueda });

  return (
    <Card
      title="Frecuencia de preventivo por cliente"
      hint="Los clientes con equipos de marcas que vencen «según contrato del cliente» (se elige en «Marcas en seguimiento»): cada uno vence con la frecuencia de preventivo de su contrato y, sin ella, no vence ni avisa. También se cambia en la ficha de cualquiera de sus equipos. Nada de esto envía nada: los avisos siguen siendo manuales o simulados."
    >
      {!editable && <p className="mb-3 text-xs text-gray-500">Sólo lectura: la pone un administrador del portal.</p>}
      {errorInventario && !inventario ? (
        <Alert tone="red">{errorInventario}</Alert>
      ) : !inventario ? (
        <Loading texto="Cargando el inventario…" />
      ) : todas.length === 0 ? (
        <Alert tone="blue">
          Ninguna marca en seguimiento vence «según contrato del cliente» (o ninguna de ellas tiene equipos activos en el inventario): no hay clientes a los que poner frecuencia. Se elige en «Marcas en seguimiento» → «Cambiar» → «Según contrato del cliente».
        </Alert>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <input
              type="search"
              aria-label="Buscar cliente"
              placeholder="Buscar cliente"
              value={busqueda}
              onChange={(ev) => setBusqueda(ev.target.value)}
              className={`min-h-[44px] w-full max-w-xs rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 ${DESACTIVADO}`}
            />
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="checkbox" checked={soloSinFrecuencia} onChange={(ev) => setSoloSin(ev.target.checked)} className={`h-5 w-5 accent-blue-600 ${DESACTIVADO}`} />
              Sólo sin frecuencia
            </label>
            <span className="text-gray-500" role="status">{textoContadorContratos(filas, todas)}</span>
          </div>
          {filas.length === 0 ? (
            <p className="text-sm text-gray-500">{soloSinFrecuencia && busqueda.trim() === '' ? 'Todos los clientes tienen ya su frecuencia.' : 'Ningún cliente casa con la búsqueda.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2 font-semibold">Cliente</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Equipos activos del cliente cuya marca vence según contrato">Equipos</th>
                    <th className="px-3 py-2 text-right font-semibold" title="De ellos, vencidos o por vencer: están ahora en «Avisos a clientes»">En avisos</th>
                    <th className="px-3 py-2 font-semibold">Frecuencia de preventivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filas.map((f) => (
                    <Fragment key={f.clave}>
                      <tr className={abierta === f.clave ? 'bg-blue-50' : ''}>
                        <td className="px-3 py-2 font-medium text-gray-900">{f.cliente}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.equipos}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{f.enAvisos}</td>
                        <td className="px-3 py-1">
                          <div className="flex flex-wrap items-center gap-x-2">
                            <span className={f.meses === null ? 'text-amber-800' : 'text-gray-900'}>{textoMeses(f.meses)}</span>
                            <BotonCambiar cliente={f.cliente} editable={editable} onClick={() => setAbierta(f.clave)} />
                          </div>
                          {f.frecuencia && (
                            <span className="block text-xs text-gray-500" title={f.frecuencia.motivo}>
                              por {f.frecuencia.por} · {fmtFechaHora(f.frecuencia.en)}
                            </span>
                          )}
                        </td>
                      </tr>
                      {/* Bajo su fila, no al final de la tabla: así se ve que «Cambiar» hizo algo (la lección de «Marcas en seguimiento»). */}
                      {abierta === f.clave && (
                        <tr>
                          <td colSpan={4} className="px-3 pb-3">
                            <FormularioFrecuencia
                              key={f.clave}
                              clave={f.clave}
                              cliente={f.cliente}
                              meses={f.meses}
                              inventario={inventario}
                              onInventario={onInventario}
                              notificar={notificar}
                              onCerrar={() => setAbierta(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
