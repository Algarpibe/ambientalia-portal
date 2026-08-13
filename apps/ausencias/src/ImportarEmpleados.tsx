import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, UserPlus } from 'lucide-react';
import { fetchEmpleados, sincronizarEmpleados, type Empleado } from './api';

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

export default function ImportarEmpleados() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  function recargar() {
    setCargando(true);
    fetchEmpleados()
      .then(setEmpleados)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  const sinCuenta = empleados.filter((e) => !e.userId).length;

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
      recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <section className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
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

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {exito && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {exito}
        </div>
      )}

      <h3 className="mb-2 mt-8 text-sm font-semibold text-gray-900">
        Empleados registrados ({empleados.length})
      </h3>
      {/* Un empleado sin cuenta del portal no puede entrar a pedir nada: la
          identidad viene de la sesión. Conviene verlo de un vistazo. */}
      {sinCuenta > 0 && (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {sinCuenta} {sinCuenta === 1 ? 'empleado no tiene' : 'empleados no tienen'} cuenta en el portal todavía. Hasta
          que se registren y se les asigne la app, no podrán enviar solicitudes. El vínculo se crea solo cuando el correo
          coincide.
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {empleados.map((e) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
