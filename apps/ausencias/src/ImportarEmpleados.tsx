import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, UserMinus, UserPlus } from 'lucide-react';
import {
  fetchEmpleados,
  fetchRetirados,
  fijarRetiro,
  reactivarEmpleado,
  sincronizarEmpleados,
  type Empleado,
  type Retirado,
} from './api';
import { formatDias, formatFecha } from './dominio';

// Mantenimiento del maestro de empleados, y no es obligatorio para arrancar:
// quien tiene la app asignada se da de alta solo la primera vez que entra.
// «Dar de alta desde el portal» crea de golpe las fichas que falten a partir de
// las cuentas del portal.
//
// Hubo un tercer camino —pegar la pestaña `consolidado` de la hoja de Google
// para rellenar cargos en bloque— y se retiró: la plantilla ya está cargada, y
// el organigrama, que es lo único que se sigue tocando, se mantiene en su propio
// panel. Mantener viva una vía de escritura masiva desde una hoja que el
// proyecto quiere desenchufar era todo riesgo y ninguna ventaja.
//
// Además es donde se da de baja a quien se va. La fecha de retiro es su ÚLTIMO
// DÍA de trabajo —ese día sigue activo— y puede ser futura: hasta que venza,
// la baja es solo un dato y la persona trabaja con normalidad. Lo que la aplica
// es el barrido del servidor, no esta pantalla.

type Vista = 'activos' | 'retirados';

export default function ImportarEmpleados() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [retirados, setRetirados] = useState<Retirado[]>([]);
  const [vista, setVista] = useState<Vista>('activos');
  const [cargando, setCargando] = useState(true);
  const [cargandoRetirados, setCargandoRetirados] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  // Qué fila está pidiendo fecha y cuál lleva tecleada. Una sola a la vez a
  // propósito: registrar una baja es un acto deliberado sobre una persona, no
  // una edición en bloque como la del panel de Saldos.
  const [edicion, setEdicion] = useState<{ id: string; fecha: string } | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  // Un contador, y no llamar a las dos cargas a mano en cada acción: las dos
  // listas se contradicen en cuanto una se queda vieja —la misma ficha estaría
  // en Activos y en Retirados—, así que se refrescan siempre juntas.
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    setCargando(true);
    fetchEmpleados()
      .then(setEmpleados)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [recarga]);

  // La vista de retirados NO se pinta desde `empleados`: el saldo congelado y el
  // recuento de solicitudes vivas solo salen de su propio endpoint. Y se carga
  // al ENTRAR en ella, no al montar: el panel vive siempre montado (App.tsx lo
  // esconde con CSS), así que cargarlo antes sería una consulta por cada visita
  // a cualquier otra pestaña.
  useEffect(() => {
    if (vista !== 'retirados') return;
    setCargandoRetirados(true);
    fetchRetirados()
      .then(setRetirados)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargandoRetirados(false));
  }, [vista, recarga]);

  // Se mira `activo` y no `fechaRetiro`: las fichas que se desactivaron a mano
  // antes de que esto existiera —las dos cuentas de prueba— no tienen fecha, y
  // repartir por la fecha las dejaría fuera de las DOS vistas, sin ningún sitio
  // donde aparecer. Es la misma razón por la que el servidor filtra por `activo`.
  const activos = empleados.filter((e) => e.activo);
  // Sobre los activos y no sobre la plantilla entera: a quien ya se fue no le
  // hace falta cuenta, y contarlo aquí dejaría un aviso que no se puede cerrar.
  const sinCuenta = activos.filter((e) => !e.userId).length;

  async function sincronizar() {
    setSincronizando(true);
    setError(null);
    setExito(null);
    try {
      const { creados, vinculados } = await sincronizarEmpleados();
      setExito(
        creados === 0 && vinculados === 0
          ? 'Todos los usuarios con la app asignada ya tenían ficha.'
          : `${creados} fichas nuevas y ${vinculados} vinculadas a su cuenta del portal.`,
      );
      setRecarga((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  async function registrarBaja(id: string, fecha: string) {
    setGuardando(id);
    setError(null);
    setExito(null);
    try {
      const ficha = await fijarRetiro(id, fecha);
      setEdicion(null);
      setExito(
        ficha.activo
          ? `Baja registrada: su último día es el ${formatFecha(fecha)}, y hasta entonces trabaja con normalidad.`
          : `Baja registrada: su último día fue el ${formatFecha(fecha)}.`,
      );
      setRecarga((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  async function deshacerBaja(id: string) {
    setGuardando(id);
    setError(null);
    setExito(null);
    try {
      await reactivarEmpleado(id);
      setExito('Baja deshecha: la ficha vuelve a Activos y su saldo sigue corriendo.');
      setRecarga((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  }

  // Sin tope de ancho, igual que PanelSaldos, PanelOrganigrama y RegistroGeneral:
  // la tabla ocupa lo que haya y la PROSA se capa a `max-w-3xl` para que siga
  // siendo legible. Con el tope puesto arriba, las seis columnas de Activos no
  // caben y aparece un scroll horizontal aunque sobre media pantalla al lado.
  return (
    <div>
      <section className="mb-6 max-w-3xl rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Dar de alta desde el portal</h3>
        <p className="mb-3 text-sm text-gray-600">
          Crea la ficha de cada usuario del portal que ya tenga esta app asignada. No hace falta hacerlo: quien entre
          por primera vez se da de alta solo. Sirve para tener la lista completa de una vez.
        </p>
        <button
          type="button"
          disabled={sincronizando}
          onClick={() => void sincronizar()}
          className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50"
        >
          {sincronizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Dar de alta desde el portal
        </button>
      </section>

      {/* `whitespace-pre-line`: el bloqueo de una baja llega con las dos mitades
          —solicitudes y personas a cargo— en líneas separadas, y sin esto se
          leerían pegadas en un párrafo. */}
      {error && (
        <div className="mt-4 flex max-w-3xl items-start gap-2 whitespace-pre-line rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {exito && (
        <div className="mt-4 flex max-w-3xl items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {exito}
        </div>
      )}

      <div className="mb-3 mt-8 flex gap-2" role="tablist" aria-label="Empleados activos o retirados">
        {(['activos', 'retirados'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={vista === v}
            onClick={() => setVista(v)}
            className={`rounded-xl border px-3 py-1.5 text-sm ${
              vista === v ? 'border-blue-300 bg-blue-50 font-medium text-blue-800' : 'border-gray-300 text-gray-700'
            }`}
          >
            {v === 'activos' ? `Activos (${activos.length})` : 'Retirados'}
          </button>
        ))}
      </div>

      {vista === 'activos' ? (
        <>
          {/* Un empleado sin cuenta del portal no puede entrar a pedir nada: la
              identidad viene de la sesión. Conviene verlo de un vistazo. */}
          {sinCuenta > 0 && (
            <p className="mb-3 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {sinCuenta} {sinCuenta === 1 ? 'empleado no tiene' : 'empleados no tienen'} cuenta en el portal todavía.
              Hasta que se registren y se les asigne la app, no podrán enviar solicitudes. El vínculo se crea solo
              cuando el correo coincide.
            </p>
          )}

          {cargando ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Nombre</th>
                    <th className="px-4 py-3 font-medium">Cargo</th>
                    <th className="px-4 py-3 font-medium">Correo</th>
                    <th className="px-4 py-3 font-medium">Aprueba</th>
                    <th className="px-4 py-3 font-medium">Cuenta</th>
                    <th className="px-4 py-3 font-medium">Salida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {activos.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-900">{e.nombreCompleto}</td>
                      <td className="px-4 py-2.5 text-gray-600">{e.cargo ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{e.correo}</td>
                      <td className="px-4 py-2.5 text-gray-600">{e.aprobadorCorreo}</td>
                      <td className="px-4 py-2.5">
                        {e.userId ? (
                          <span className="text-emerald-700">Vinculada</span>
                        ) : (
                          <span className="text-amber-700">Sin cuenta</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {edicion?.id === e.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={edicion.fecha}
                              onChange={(ev) => setEdicion({ id: e.id, fecha: ev.target.value })}
                              aria-label={`Último día de trabajo de ${e.nombreCompleto}`}
                              className="rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={!edicion.fecha || guardando === e.id}
                              onClick={() => void registrarBaja(e.id, edicion.fecha)}
                              className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
                            >
                              {guardando === e.id ? 'Guardando…' : 'Guardar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEdicion(null)}
                              className="rounded-xl px-2 py-1.5 text-sm text-gray-600 hover:underline"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : e.fechaRetiro ? (
                          <div className="flex items-center gap-2">
                            {/* Sigue activo: la fecha es su último día, no el
                                primero que ya no viene. */}
                            <span className="rounded-lg bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Sale el {formatFecha(e.fechaRetiro)}
                            </span>
                            <button
                              type="button"
                              disabled={guardando === e.id}
                              onClick={() => void deshacerBaja(e.id)}
                              className="text-xs text-gray-600 hover:underline disabled:opacity-50"
                            >
                              Quitar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEdicion({ id: e.id, fecha: '' })}
                            className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <UserMinus className="h-3.5 w-3.5" /> Registrar baja
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 max-w-3xl text-sm text-gray-600">
            El saldo de esta lista está <b>congelado en el último día trabajado</b>: es el número que se liquida. Deja
            de crecer aunque pasen los meses.
          </p>

          {cargandoRetirados ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </p>
          ) : retirados.length === 0 ? (
            <p className="rounded-2xl border border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
              No hay nadie retirado.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Nombre</th>
                    <th className="px-4 py-3 font-medium">Correo</th>
                    <th className="px-4 py-3 font-medium">Último día</th>
                    <th className="px-4 py-3 font-medium">La registró</th>
                    <th className="px-4 py-3 text-right font-medium">Saldo a liquidar</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {retirados.map((r) => (
                    <tr key={r.empleadoId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">{r.nombreCompleto}</td>
                      <td className="px-4 py-3 text-gray-600">{r.correo}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {r.fechaRetiro ? (
                          formatFecha(r.fechaRetiro)
                        ) : (
                          <span className="text-gray-400">sin fecha</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{r.retiradoPor ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {/* Sin configurar NO es cero: es que nadie le fijó el
                            punto de partida. Enseñar «0 días» donde no hay dato
                            es lo único que esta pantalla no puede hacer, porque
                            de aquí sale lo que se paga. */}
                        {r.saldo.configurado ? (
                          <span className="tabular-nums text-gray-900">
                            <b>{formatDias(r.saldo.disponible)}</b> días
                          </span>
                        ) : (
                          <span className="text-amber-700">Sin saldo configurado</span>
                        )}
                        {/* La bandeja del jefe no filtra por `activo`, así que
                            una solicitud sin firmar todavía se puede firmar
                            después del retiro y mover el número de al lado. */}
                        {r.solicitudesVivas > 0 && (
                          <p className="mt-0.5 text-xs font-medium text-amber-700">
                            {r.solicitudesVivas} {r.solicitudesVivas === 1 ? 'solicitud' : 'solicitudes'} sin firmar —
                            el saldo puede moverse
                          </p>
                        )}
                        {/* Se avisa y no se bloquea: casi siempre es un año mal
                            tecleado, pero puede ser legítimo y no es esta
                            pantalla quien debe decidirlo. */}
                        {r.retiroAntesDelCorte && (
                          <p className="mt-0.5 text-xs font-medium text-red-700">
                            La fecha de retiro es anterior al corte de su saldo: revisa que sea correcta.
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={guardando === r.empleadoId}
                          onClick={() => void deshacerBaja(r.empleadoId)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {guardando === r.empleadoId ? 'Reactivando…' : 'Reactivar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
