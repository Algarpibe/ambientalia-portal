import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { fetchSaldos, fijarSaldo, type SaldoDeEmpleado } from './api';
import { formatDias } from './dominio';

// El panel donde un admin teclea el punto de partida de cada persona. Es la
// vía por la que entran los saldos que hoy viven en un Excel, y la que
// permite dar de alta a quien entre nuevo o corregir un número mal puesto sin
// pasar por psql.

interface Fila {
  saldoCorte: string;
  fechaCorte: string;
  guardando: boolean;
  error: string | null;
  /** Se apaga solo a los dos segundos: un tick permanente en una tabla de
   *  quince filas acaba siendo ruido, no información. */
  exito: boolean;
}

function filaInicial(s: SaldoDeEmpleado): Fila {
  return {
    // Sin configurar, el backend manda saldoCorte:0 y fechaCorte:'' (ver
    // sinConfigurar() en saldo.ts): se muestran vacíos, no «0», para no
    // sugerir que ese cero es un valor real que alguien puso a propósito.
    saldoCorte: s.saldo.configurado ? String(s.saldo.saldoCorte) : '',
    fechaCorte: s.saldo.fechaCorte || '',
    guardando: false,
    error: null,
    exito: false,
  };
}

interface Props {
  /** Si la pestaña «Saldos» es la que se ve ahora mismo. El panel se monta
   *  siempre (las pestañas quedan montadas para no perder lo escrito al ir y
   *  volver), pero el listado solo se pide la primera vez que `activo` se
   *  pone en true: si no, cualquier admin pagaría esta llamada en cada carga
   *  de la app aunque nunca abriera la pestaña, y quien además aprueba
   *  duplicaría la petición que App.tsx ya hace para la bandeja. */
  activo: boolean;
}

export default function PanelSaldos({ activo }: Props) {
  const [saldos, setSaldos] = useState<SaldoDeEmpleado[]>([]);
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  // Arranca en true aunque la carga sea diferida: con false, «aún no he pedido
  // nada» y «la empresa no tiene empleados» renderizan lo mismo, y al abrir la
  // pestaña se vería un fotograma diciendo «No hay empleados activos» antes de
  // que corra el efecto. Mientras la pestaña está cerrada el panel va oculto,
  // así que da igual lo que renderice.
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Solo se marca en el `.then`, no al arrancar el fetch: así, si React
  // cancela y reintenta el efecto (StrictMode en desarrollo), el segundo
  // intento no se encuentra la bandera ya puesta por un intento que nunca
  // llegó a resolver.
  const yaCargado = useRef(false);
  // Un temporizador de «guardado» por fila, para poder cancelarlo si el panel
  // se desmonta con alguno pendiente o si se guarda la misma fila otra vez
  // antes de que se apague el anterior.
  const timeoutsExito = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!activo || yaCargado.current) return;
    let vivo = true;
    setCargando(true);
    fetchSaldos()
      .then((s) => {
        if (!vivo) return;
        yaCargado.current = true;
        setSaldos(s);
        setFilas(Object.fromEntries(s.map((e) => [e.empleadoId, filaInicial(e)])));
        setError(null);
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [activo]);

  useEffect(() => {
    return () => {
      Object.values(timeoutsExito.current).forEach(clearTimeout);
    };
  }, []);

  const sinConfigurar = saldos.filter((s) => !s.saldo.configurado).length;

  function actualizar(empleadoId: string, campos: Partial<Fila>) {
    setFilas((fs) => ({ ...fs, [empleadoId]: { ...fs[empleadoId], ...campos } }));
  }

  async function guardar(empleadoId: string) {
    const fila = filas[empleadoId];
    if (!fila) return;
    // El corte va aquí y no solo en el `disabled` del botón porque Enter llama a
    // esto directamente: sin él, teclear Enter sobre una fila intacta mandaría un
    // PUT que no cambia nada y pintaría un tick de «guardado» que no significa
    // nada.
    const guardado = saldos.find((s) => s.empleadoId === empleadoId);
    if (guardado) {
      const original = filaInicial(guardado);
      if (fila.saldoCorte === original.saldoCorte && fila.fechaCorte === original.fechaCorte) return;
    }
    actualizar(empleadoId, { guardando: true, error: null, exito: false });
    try {
      // Se manda la cadena tal cual (recortada), NO Number(): la validación de
      // forma vive entera en el backend (ver el comentario de fijarSaldo en
      // api.ts). Vacío en los dos campos es «vaciar la configuración», una
      // operación legítima que devuelve a esa persona a «sin configurar».
      const saldoTexto = fila.saldoCorte.trim();
      const fechaTexto = fila.fechaCorte.trim();
      const actualizado = await fijarSaldo(
        empleadoId,
        saldoTexto === '' ? null : saldoTexto,
        fechaTexto === '' ? null : fechaTexto,
      );
      setSaldos((ss) => ss.map((s) => (s.empleadoId === empleadoId ? actualizado : s)));
      // Se resincroniza el borrador con lo que quedó guardado (la BD redondea
      // a un decimal), no con lo que se tecleó.
      actualizar(empleadoId, { ...filaInicial(actualizado), exito: true });
      clearTimeout(timeoutsExito.current[empleadoId]);
      timeoutsExito.current[empleadoId] = setTimeout(() => {
        actualizar(empleadoId, { exito: false });
        delete timeoutsExito.current[empleadoId];
      }, 2000);
    } catch (e) {
      actualizar(empleadoId, { guardando: false, error: (e as Error).message });
    }
  }

  function alPulsarEnter(e: React.KeyboardEvent<HTMLInputElement>, empleadoId: string) {
    // No hay <form> alrededor de la fila (es una tabla, y un <form> no puede
    // envolver una <tr> suelta), así que Enter no dispara un submit por su
    // cuenta: hay que interceptarlo a mano para que se comporte como se
    // espera de cualquier campo de un formulario.
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void guardar(empleadoId);
  }

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Saldos de vacaciones</h3>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        El <b>saldo en el corte</b> es el número de días que esa persona tenía disponibles EN la
        fecha de corte, tal como quedó cuadrado en el Excel. A partir de ahí la app hace el resto:
        suma 1,25 días por cada mes que pasa y resta las vacaciones que se van aprobando. Todo lo
        anterior al corte ya está incluido en ese número, así que <b>la fecha de corte no tiene que
        ser hoy</b>: tiene que ser el día en el que el Excel estaba cuadrado. Ponerle la fecha de
        hoy al saldo de un Excel de hace tres meses sumaría de más los días de esos tres meses.
      </p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : saldos.length === 0 ? (
        // El vacío solo se afirma si la carga fue bien. Si falló, la lista está
        // vacía porque no sabemos nada, no porque no haya nadie: decir «no hay
        // empleados activos» debajo de un error de carga es afirmar justo lo
        // que no se ha podido averiguar.
        error ? null : <p className="text-sm text-gray-500">No hay empleados activos.</p>
      ) : (
        <>
          {sinConfigurar > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {sinConfigurar} persona{sinConfigurar === 1 ? '' : 's'} sin configurar todavía.
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Saldo en el corte</th>
                  <th className="px-4 py-3 font-medium">Fecha de corte</th>
                  <th className="px-4 py-3 text-right font-medium">Disponible hoy</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {saldos.map((s) => {
                  const fila = filas[s.empleadoId] ?? filaInicial(s);
                  // Se compara contra `filaInicial(s)` y no contra los campos del
                  // saldo: así la normalización (el vacío de «sin configurar», el
                  // String del número) es exactamente la misma en los dos lados y
                  // no hay una segunda regla que pueda desviarse de la primera.
                  //
                  // Teclear «18,9» donde había «18.9» cuenta como cambio: es otro
                  // texto, y guardarlo es idempotente. Es el lado seguro del error
                  // — apagar el botón sobre algo que el usuario cree haber
                  // cambiado sería mucho peor.
                  const guardado = filaInicial(s);
                  const haCambiado =
                    fila.saldoCorte !== guardado.saldoCorte || fila.fechaCorte !== guardado.fechaCorte;
                  return (
                    <tr key={s.empleadoId} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-900">{s.nombreCompleto}</td>
                      <td className="px-4 py-2.5">
                        <input
                          // type="text", no "number": hace falta para admitir la coma
                          // decimal, que un type="number" rechaza en casi todos los
                          // locales del navegador.
                          type="text"
                          inputMode="decimal"
                          value={fila.saldoCorte}
                          onChange={(e) => actualizar(s.empleadoId, { saldoCorte: e.target.value, error: null })}
                          onKeyDown={(e) => alPulsarEnter(e, s.empleadoId)}
                          placeholder="Sin configurar"
                          aria-label={`Saldo en el corte de ${s.nombreCompleto}`}
                          className="w-28 rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="date"
                          value={fila.fechaCorte}
                          onChange={(e) => actualizar(s.empleadoId, { fechaCorte: e.target.value, error: null })}
                          onKeyDown={(e) => alPulsarEnter(e, s.empleadoId)}
                          aria-label={`Fecha de corte de ${s.nombreCompleto}`}
                          className="rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">
                        {s.saldo.configurado ? formatDias(s.saldo.disponible) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <button
                            type="button"
                            // Apagado mientras no haya nada que guardar: en una
                            // tabla de una fila por persona, un botón activo en
                            // todas invita a pulsar el de al lado por error — y
                            // aquí el de al lado es el saldo de otro.
                            disabled={fila.guardando || !haCambiado}
                            onClick={() => void guardar(s.empleadoId)}
                            aria-label={`Guardar el saldo de ${s.nombreCompleto}`}
                            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                          >
                            {fila.guardando ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : fila.exito ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Save className="h-3.5 w-3.5" />
                            )}
                            Guardar
                          </button>
                          {/* El icono ya avisa con la vista, pero cambiar un icono no
                              dice nada a quien usa lector de pantalla: sin este texto,
                              el guardado con éxito pasaría inadvertido para esa persona. */}
                          {fila.exito && (
                            <span role="status" className="sr-only">
                              Saldo de {s.nombreCompleto} guardado.
                            </span>
                          )}
                          {fila.error && (
                            <span role="alert" className="max-w-[16rem] text-right text-xs text-red-600">
                              {fila.error}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
