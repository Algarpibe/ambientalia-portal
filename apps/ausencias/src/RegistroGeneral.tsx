import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Loader2, Pencil, Trash2 } from 'lucide-react';
import { borrarSolicitud, fetchEmpleados, fetchHistorico, type Empleado, type Solicitud } from './api';
import { chipDe, ETIQUETA_TIPO, formatFecha, TIPOS } from './dominio';
import EditarSolicitud from './EditarSolicitud';

// El registro general de la compañía: lo que antes había que ir a mirar a la
// hoja. Mientras esta vista no exista, tener el histórico en Postgres no le
// sirve de nada a nadie.

interface Props {
  /** Cambia cuando se importa, para recargar sin montar el componente de nuevo. */
  recargarToken: number;
  /** Festivos del contexto, para sugerir el conteo de días al editar. */
  festivos: Set<string>;
}

/** Escapa una celda para CSV: comillas dobles y separador dentro del texto. */
function celdaCsv(v: string | number | null): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function RegistroGeneral({ recargarToken, festivos }: Props) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [editando, setEditando] = useState<Solicitud | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [persona, setPersona] = useState('');
  const [anio, setAnio] = useState('');
  // Borrado en dos pasos: el primer clic pide confirmación en la propia fila.
  // Es irreversible y toca el registro de la compañía; un clic suelto no basta.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    // Los empleados se piden a la vez: el desplegable de reasignar los necesita.
    Promise.all([fetchHistorico(), fetchEmpleados()])
      .then(([s, e]) => vivo && (setSolicitudes(s), setEmpleados(e), setError(null)))
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [recargarToken]);

  const personas = useMemo(
    () => [...new Set(solicitudes.map((s) => s.empleadoNombre))].sort((a, b) => a.localeCompare(b, 'es')),
    [solicitudes],
  );
  const anios = useMemo(
    () => [...new Set(solicitudes.map((s) => s.fechaInicio.slice(0, 4)))].sort().reverse(),
    [solicitudes],
  );

  const filtradas = useMemo(
    () =>
      solicitudes.filter(
        (s) =>
          (!tipo || s.tipo === tipo) &&
          (!persona || s.empleadoNombre === persona) &&
          (!anio || s.fechaInicio.startsWith(anio)),
      ),
    [solicitudes, tipo, persona, anio],
  );

  const totalDias = useMemo(() => filtradas.reduce((a, s) => a + Number(s.diasHabiles), 0), [filtradas]);

  const porPersona = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of filtradas) m.set(s.empleadoNombre, (m.get(s.empleadoNombre) ?? 0) + Number(s.diasHabiles));
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [filtradas]);

  async function borrar(s: Solicitud) {
    setBorrando(s.id);
    setError(null);
    try {
      await borrarSolicitud(s.id);
      setSolicitudes((ss) => ss.filter((x) => x.id !== s.id));
      setConfirmando(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBorrando(null);
    }
  }

  function exportarCsv() {
    const cab = ['Nombre y Apellidos', 'Tipo', 'Fecha Inicio', 'Fecha Fin', 'Días', 'Estado', 'Comentarios', 'Observaciones'];
    const lineas = [
      cab.join(';'),
      ...filtradas.map((s) =>
        [
          s.empleadoNombre,
          ETIQUETA_TIPO[s.tipo],
          s.fechaInicio,
          s.fechaFin,
          s.diasHabiles,
          chipDe(s.estado).label,
          s.comentarios ?? '',
          s.observaciones ?? '',
        ]
          .map(celdaCsv)
          .join(';'),
      ),
    ];
    // BOM para que Excel abra las tildes bien en Windows sin preguntar nada.
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solicitudes_ausencia_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Registro general de la compañía</h3>
      <p className="mb-3 text-sm text-gray-600">
        Todas las solicitudes, las del portal y las importadas de la hoja.
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
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select className={selCls} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <select className={selCls} value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona">
              <option value="">Todas las personas</option>
              {personas.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select className={selCls} value={anio} onChange={(e) => setAnio(e.target.value)} aria-label="Año">
              <option value="">Todos los años</option>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportarCsv}
              disabled={filtradas.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Exportar CSV
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span className="text-gray-500">{filtradas.length} solicitudes</span>
            <span className="text-gray-700">
              Total: <b className="tabular-nums">{totalDias}</b> días
            </span>
          </div>

          {porPersona.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {porPersona.map(([nombre, dias]) => (
                <span key={nombre} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700">
                  {nombre}: <b className="tabular-nums">{dias}</b>
                </span>
              ))}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Desde</th>
                  <th className="px-4 py-3 font-medium">Hasta</th>
                  <th className="px-4 py-3 text-right font-medium">Días</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Comentarios</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtradas.map((s) => (
                  <tr key={s.id} className="align-top hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{s.empleadoNombre}</td>
                    <td className="px-4 py-2.5 text-gray-700">{ETIQUETA_TIPO[s.tipo]}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">{formatFecha(s.fechaInicio)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">{formatFecha(s.fechaFin)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{s.diasHabiles}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${chipDe(s.estado).clase}`}>
                        {chipDe(s.estado).label}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-2.5 text-gray-600">
                      {s.comentarios || <span className="text-gray-300">—</span>}
                      {s.observaciones && <div className="mt-0.5 text-xs italic text-gray-500">{s.observaciones}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {confirmando === s.id ? (
                        <span className="flex items-center justify-end gap-2">
                          <span className="text-xs text-gray-600">¿Borrar?</span>
                          <button
                            type="button"
                            disabled={borrando === s.id}
                            onClick={() => void borrar(s)}
                            className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:bg-gray-300"
                          >
                            {borrando === s.id ? 'Borrando…' : 'Sí, borrar'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmando(null)}
                            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditando(s)}
                            aria-label={`Editar la solicitud de ${s.empleadoNombre} del ${s.fechaInicio}`}
                            title="Editar"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmando(s.id)}
                            aria-label={`Borrar la solicitud de ${s.empleadoNombre} del ${s.fechaInicio}`}
                            title="Borrar del registro"
                            className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editando && (
        <EditarSolicitud
          solicitud={editando}
          empleados={empleados}
          festivos={festivos}
          onCerrar={() => setEditando(null)}
          onGuardada={(s) => {
            setSolicitudes((ss) => ss.map((x) => (x.id === s.id ? s : x)));
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}
