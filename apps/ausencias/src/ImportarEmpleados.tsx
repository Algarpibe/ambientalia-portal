import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { fetchEmpleados, importarEmpleados, type Empleado } from './api';

// Importación del maestro de empleados desde la pestaña `consolidado` de la hoja
// `consulta_vacaciones`. Se pega tal cual (el portapapeles de Google Sheets
// separa columnas con tabuladores) en vez de subir un CSV: así los datos de
// nómina no pasan por ningún archivo intermedio ni acaban en el repositorio.

interface Fila {
  nombreCompleto: string;
  correo: string;
  cargo: string;
  credencial: number | null;
}

const CABECERAS = ['Nombre y Apellidos', 'Cargo', 'Correo', 'Número clave'];

/**
 * Convierte lo pegado en filas. Acepta tabulador (Sheets) o punto y coma, y se
 * salta la fila de cabecera si viene incluida.
 */
export function parsearPegado(texto: string): { filas: Fila[]; descartadas: number } {
  let descartadas = 0;
  const filas: Fila[] = [];

  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const c = linea.split(linea.includes('\t') ? '\t' : ';').map((s) => s.trim());
    // Cabecera de la hoja: se reconoce por su primera columna.
    if (c[0]?.toLowerCase().startsWith('nombre y apellido')) continue;

    const nombreCompleto = c[0] ?? '';
    const cargo = c[1] ?? '';
    const correo = (c[2] ?? '').toLowerCase();
    const clave = c[3] ?? '';
    if (!nombreCompleto || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      descartadas++;
      continue;
    }
    const credencial = /^\d+$/.test(clave) ? Number(clave) : null;
    filas.push({ nombreCompleto, correo, cargo, credencial });
  }
  return { filas, descartadas };
}

export default function ImportarEmpleados() {
  const [texto, setTexto] = useState('');
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const { filas, descartadas } = useMemo(() => parsearPegado(texto), [texto]);

  function recargar() {
    setCargando(true);
    fetchEmpleados()
      .then(setEmpleados)
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(recargar, []);

  async function importar() {
    setImportando(true);
    setError(null);
    setExito(null);
    try {
      const { importados } = await importarEmpleados(filas);
      setExito(`${importados} empleados importados o actualizados.`);
      setTexto('');
      recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  const sinCuenta = empleados.filter((e) => !e.userId).length;

  return (
    <div className="max-w-4xl">
      <p className="mb-3 text-sm text-gray-600">
        Pega aquí las filas de la pestaña <b>consolidado</b> de la hoja <b>consulta_vacaciones</b>, en este orden:{' '}
        {CABECERAS.join(' · ')}. Se actualiza por correo, así que reimportar la hoja entera es seguro.
      </p>

      <textarea
        rows={8}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Filas de la hoja consolidado"
        placeholder={'Gustavo Novoa\tDirector Técnico\tdirector.tecnico@ambientalia.com.co\t1002'}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={filas.length === 0 || importando}
          onClick={() => void importar()}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar {filas.length > 0 && `${filas.length} empleados`}
        </button>
        {descartadas > 0 && (
          <span className="text-sm text-amber-700">
            {descartadas} {descartadas === 1 ? 'fila descartada' : 'filas descartadas'} por falta de nombre o correo válido.
          </span>
        )}
      </div>

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
