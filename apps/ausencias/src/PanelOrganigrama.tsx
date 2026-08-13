import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { fetchEmpleados, fijarJefe, type EmpleadoConJefatura } from './api';

// El organigrama de la empresa. Cada persona tiene un jefe inmediato y ese único
// dato basta: el segundo aprobador se deriva subiendo un escalón, así que el
// árbol existe una sola vez y no puede desincronizarse consigo mismo.
//
// La hoja de Google NO manda aquí. Su importación conserva el jefe que ya
// hubiera; antes lo pisaba en cada pasada y borraba el árbol entero.

interface Fila {
  aprobadorCorreo: string;
  guardando: boolean;
  error: string | null;
  exito: boolean;
}

const filaInicial = (e: EmpleadoConJefatura): Fila => ({
  aprobadorCorreo: e.aprobadorCorreo,
  guardando: false,
  error: null,
  exito: false,
});

interface Props {
  /** Carga diferida: la pestaña queda montada aunque esté oculta. */
  activo: boolean;
}

export default function PanelOrganigrama({ activo }: Props) {
  const [empleados, setEmpleados] = useState<EmpleadoConJefatura[]>([]);
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  // Arranca en true por lo mismo que PanelSaldos: con false, «aún no he pedido
  // nada» y «no hay empleados» renderizan igual.
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const yaCargado = useRef(false);
  const timeoutsExito = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function cargar() {
    setCargando(true);
    return fetchEmpleados()
      .then((es) => {
        yaCargado.current = true;
        setEmpleados(es);
        setFilas(Object.fromEntries(es.map((e) => [e.id, filaInicial(e)])));
        setError(null);
      })
      .catch((e: Error) => {
        // El listado se vacía a propósito: dejar el organigrama anterior bajo un
        // error es enseñar un árbol que ya no se sostiene.
        setEmpleados([]);
        setError(e.message);
      })
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    if (!activo || yaCargado.current) return;
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);

  useEffect(() => {
    return () => {
      Object.values(timeoutsExito.current).forEach(clearTimeout);
    };
  }, []);

  function actualizar(id: string, campos: Partial<Fila>) {
    setFilas((fs) => ({ ...fs, [id]: { ...fs[id], ...campos } }));
  }

  async function guardar(id: string) {
    const fila = filas[id];
    if (!fila) return;
    actualizar(id, { guardando: true, error: null, exito: false });
    try {
      await fijarJefe(id, fila.aprobadorCorreo);
      // Se recarga el maestro entero y no solo esta fila: cambiar el jefe de
      // alguien cambia la SEGUNDA firma de todos los que cuelgan de él, y dejar
      // esas filas con el valor viejo sería mentir sobre a quién sube su
      // solicitud.
      await cargar();
      actualizar(id, { exito: true });
      clearTimeout(timeoutsExito.current[id]);
      timeoutsExito.current[id] = setTimeout(() => {
        actualizar(id, { exito: false });
        delete timeoutsExito.current[id];
      }, 2000);
    } catch (e) {
      actualizar(id, { guardando: false, error: (e as Error).message });
    }
  }

  const activos = empleados.filter((e) => e.activo);
  const enCiclo = activos.filter((e) => e.enCiclo);

  return (
    <div className="mt-10 border-t border-gray-200 pt-8">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Organigrama</h3>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        El <b>jefe inmediato</b> es quien da el primer visto bueno a las solicitudes de esa persona.
        La <b>segunda firma</b> se deduce sola: es el jefe de su jefe. Quien no tenga a nadie por
        encima —porque es su propio jefe— cierra las solicitudes con una sola firma.
      </p>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        Cambiar el organigrama <b>no mueve las solicitudes que ya están en trámite</b>: cada una
        lleva sus dos firmantes anotados desde que se envió.
      </p>

      {error && (
        <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {enCiclo.length > 0 && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Hay {enCiclo.length} {enCiclo.length === 1 ? 'persona' : 'personas'} en un círculo del
            organigrama ({enCiclo.map((e) => e.nombreCompleto).join(', ')}). Sus solicitudes se
            cierran con una sola firma hasta que se deshaga.
          </span>
        </p>
      )}

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando el organigrama…
        </p>
      ) : activos.length === 0 ? (
        !error && <p className="text-sm text-gray-500">No hay empleados activos.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Persona</th>
                <th className="px-4 py-3 font-medium">Jefe inmediato (1ª firma)</th>
                <th className="px-4 py-3 font-medium">2ª firma</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {activos.map((e) => {
                const fila = filas[e.id];
                if (!fila) return null;
                return (
                  <tr key={e.id} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{e.nombreCompleto}</div>
                      <div className="text-xs text-gray-500">{e.correo}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={fila.aprobadorCorreo}
                        onChange={(ev) => actualizar(e.id, { aprobadorCorreo: ev.target.value, error: null })}
                        aria-label={`Jefe inmediato de ${e.nombreCompleto}`}
                        className="rounded-xl border border-gray-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                      >
                        {/* El propio empleado sale en su lista: elegirse a uno mismo
                            es como se declara la raíz del organigrama. */}
                        {activos.map((j) => (
                          <option key={j.id} value={j.correo}>
                            {j.correo === e.correo ? `${j.nombreCompleto} (sin jefe: raíz)` : j.nombreCompleto}
                          </option>
                        ))}
                        {/* El valor actual puede no estar en la lista: el buzón por
                            defecto no tiene ficha de empleado y hoy cuelga de él
                            toda la plantilla. Sin esta opción el <select> se
                            mostraría en blanco y guardar cambiaría el jefe sin que
                            nadie lo hubiera pedido. */}
                        {!activos.some((j) => j.correo === fila.aprobadorCorreo) && (
                          <option value={fila.aprobadorCorreo}>{fila.aprobadorCorreo}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {e.segundoAprobadorCorreo ?? <span className="text-gray-300">— una sola firma</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          disabled={fila.guardando}
                          onClick={() => void guardar(e.id)}
                          aria-label={`Guardar el jefe de ${e.nombreCompleto}`}
                          className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
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
                        {/* Cambiar un icono no le dice nada a quien usa lector de
                            pantalla: sin este texto el guardado pasa inadvertido. */}
                        {fila.exito && (
                          <span role="status" className="sr-only">
                            Jefe de {e.nombreCompleto} guardado.
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
      )}
    </div>
  );
}
