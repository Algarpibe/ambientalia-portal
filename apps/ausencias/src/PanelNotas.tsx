import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { borrarNota, editarNota, fetchEmpleados, fetchNotas, urlDeImagenDeNota, type EmpleadoConJefatura, type Nota } from './api';
import FormularioNota from './FormularioNota';
import {
  CATEGORIAS_NOTA,
  ETIQUETA_CATEGORIA,
  fechaCorta,
  filtrarNotas,
  ordenarNotas,
  textoDeErrorDeNota,
  type FiltrosNotas,
} from './notas';

// Las notas personales del administrador: lo que le piden a mano y no pasa por
// el flujo de solicitudes —un aviso de retraso, una petición suelta—, con su
// estado para saber qué queda por atender.
//
// Solo la ve un administrador, y el 403 de hub-api es el candado de verdad:
// esconder la pestaña no bastaría. Además cada nota es de quien la escribe
// (migración 076): un segundo administrador no vería estas.

interface Props {
  /** Carga diferida: las pestañas quedan montadas y ocultas con `hidden`. */
  activo: boolean;
}

/** El formulario abierto: `null` = cerrado; `{ nota: null }` = alta; si no, edición. */
type Edicion = { nota: Nota | null } | null;

export default function PanelNotas({ activo }: Props) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [empleados, setEmpleados] = useState<EmpleadoConJefatura[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Aparte de `error`, como en PanelAdjuntos: una acción fallida no invalida la
  // lista, así que no debe ocultarla.
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion>(null);
  const [filtros, setFiltros] = useState<FiltrosNotas>({ categoria: '', estado: 'abierta', empleadoNombre: '' });
  const [aBorrar, setABorrar] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [imagen, setImagen] = useState<{ notaId: string; url: string } | null>(null);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    setCargando(true);
    Promise.all([fetchNotas(), fetchEmpleados()])
      .then(([n, e]) => {
        if (!vivo) return;
        setNotas(n);
        setEmpleados(e.filter((x) => x.activo));
        setError(null);
      })
      .catch((e: Error) => {
        if (!vivo) return;
        // Se vacía a propósito: dejar la lista anterior bajo un banner de error
        // sería afirmar unos datos que ya no se sostienen.
        setNotas([]);
        setError(e.message);
      })
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [activo]);

  // La URL de objeto retiene la imagen en memoria hasta que se revoca: al
  // cambiar de imagen o al desmontar, se suelta la anterior.
  useEffect(
    () => () => {
      if (imagen) URL.revokeObjectURL(imagen.url);
    },
    [imagen],
  );

  const personas = useMemo(
    () => [...new Set(notas.map((n) => n.empleadoNombre))].sort((a, b) => a.localeCompare(b, 'es')),
    [notas],
  );
  // Si la última nota de la persona filtrada desaparece (borrada o recargada),
  // el <select> ya no tiene esa opción y enseñaría «Todas»; el filtro, en
  // cambio, seguiría aplicado sin forma de quitarlo. Por eso se deriva aquí.
  const persona = personas.includes(filtros.empleadoNombre) ? filtros.empleadoNombre : '';
  const visibles = useMemo(
    () => filtrarNotas(notas, { ...filtros, empleadoNombre: persona }),
    [notas, filtros, persona],
  );

  function guardada(n: Nota) {
    setNotas((ns) => ordenarNotas([n, ...ns.filter((x) => x.id !== n.id)]));
    setEdicion(null);
    // Cierra la imagen abierta de ESTA nota: pudo cambiar o quitarse al guardar.
    setImagen((i) => (i?.notaId === n.id ? null : i));
  }

  function alternarEstado(n: Nota) {
    setOcupada(n.id);
    setErrorAccion(null);
    editarNota(n.id, { estado: n.estado === 'abierta' ? 'resuelta' : 'abierta' })
      .then((actual) => setNotas((ns) => ns.map((x) => (x.id === actual.id ? actual : x))))
      .catch((e: Error) => setErrorAccion(textoDeErrorDeNota(e.message)))
      .finally(() => setOcupada((o) => (o === n.id ? null : o)));
  }

  function borrar(id: string) {
    setOcupada(id);
    setErrorAccion(null);
    const quitarDeLaLista = () => {
      setNotas((ns) => ns.filter((x) => x.id !== id));
      setABorrar(null);
      setImagen((i) => (i?.notaId === id ? null : i));
    };
    borrarNota(id)
      .then(quitarDeLaLista)
      .catch((e: Error) => {
        // Ya la borró otra pestaña: el fin que se buscaba está cumplido, así que
        // también sale de la lista, aunque el aviso cuente por qué.
        if (e.message === 'nota_no_encontrada') quitarDeLaLista();
        setErrorAccion(textoDeErrorDeNota(e.message));
      })
      .finally(() => setOcupada((o) => (o === id ? null : o)));
  }

  // La imagen solo se baja al pedirla: abrir la pestaña no descarga las fotos
  // de todas las notas.
  function alternarImagen(n: Nota) {
    if (imagen?.notaId === n.id) {
      setImagen(null);
      return;
    }
    setOcupada(n.id);
    setErrorAccion(null);
    urlDeImagenDeNota(n.id)
      .then((url) => setImagen({ notaId: n.id, url }))
      .catch((e: Error) => setErrorAccion(textoDeErrorDeNota(e.message)))
      .finally(() => setOcupada((o) => (o === n.id ? null : o)));
  }

  const selCls = 'rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';
  const btnCls =
    'inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-900">Notas</h3>
          <p className="max-w-3xl text-sm text-gray-600">
            Lo que te piden a mano y no pasa por una solicitud: avisos de retraso, peticiones sueltas y otros asuntos.
            Solo las ves tú.
          </p>
        </div>
        {!edicion && (
          <button
            type="button"
            disabled={!!error}
            onClick={() => setEdicion({ nota: null })}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nueva nota
          </button>
        )}
      </div>

      {edicion && (
        <FormularioNota
          key={edicion.nota?.id ?? 'nueva'}
          empleados={empleados}
          nota={edicion.nota}
          onGuardada={guardada}
          onCancelar={() => setEdicion(null)}
        />
      )}

      {(error ?? errorAccion) && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? errorAccion}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          aria-label="Filtrar por categoría"
          value={filtros.categoria}
          onChange={(e) => setFiltros((f) => ({ ...f, categoria: e.target.value as FiltrosNotas['categoria'] }))}
          className={selCls}
        >
          <option value="">Todas las categorías</option>
          {CATEGORIAS_NOTA.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por estado"
          value={filtros.estado}
          onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value as FiltrosNotas['estado'] }))}
          className={selCls}
        >
          <option value="abierta">Abiertas</option>
          <option value="resuelta">Resueltas</option>
          <option value="todas">Todas</option>
        </select>
        <select
          aria-label="Filtrar por persona"
          value={persona}
          onChange={(e) => setFiltros((f) => ({ ...f, empleadoNombre: e.target.value }))}
          className={selCls}
        >
          <option value="">Todas las personas</option>
          {personas.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {cargando ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : error ? null : visibles.length === 0 ? (
        <p className="text-sm text-gray-500">
          {notas.length === 0 ? 'Todavía no hay notas.' : 'Ninguna nota coincide con los filtros.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {visibles.map((n) => (
            <li key={n.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-gray-900">{fechaCorta(n.fecha)}</span>
                <span className="text-gray-700">{n.empleadoNombre}</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {ETIQUETA_CATEGORIA[n.categoria]}
                </span>
                {n.estado === 'resuelta' && (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Resuelta</span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{n.comentario}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {n.imagen && (
                  <button
                    type="button"
                    aria-expanded={imagen?.notaId === n.id}
                    disabled={ocupada === n.id}
                    onClick={() => alternarImagen(n)}
                    className={btnCls}
                  >
                    <Paperclip className="h-3.5 w-3.5" /> {imagen?.notaId === n.id ? 'Ocultar imagen' : 'Ver imagen'}
                  </button>
                )}
                <button type="button" disabled={ocupada === n.id} onClick={() => alternarEstado(n)} className={btnCls}>
                  {n.estado === 'abierta' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Marcar resuelta
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" /> Reabrir
                    </>
                  )}
                </button>
                <button type="button" disabled={ocupada === n.id} onClick={() => setEdicion({ nota: n })} className={btnCls}>
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
                {aBorrar === n.id ? (
                  <span className="inline-flex items-center gap-2 text-xs text-red-700">
                    ¿Borrar esta nota?
                    <button
                      type="button"
                      disabled={ocupada === n.id}
                      onClick={() => borrar(n.id)}
                      className="rounded-lg bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Sí, borrar
                    </button>
                    <button type="button" onClick={() => setABorrar(null)} className={btnCls}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" disabled={ocupada === n.id} onClick={() => setABorrar(n.id)} className={btnCls}>
                    <Trash2 className="h-3.5 w-3.5" /> Borrar
                  </button>
                )}
              </div>
              {imagen?.notaId === n.id && (
                <img
                  src={imagen.url}
                  alt={`Imagen de la nota del ${fechaCorta(n.fecha)}`}
                  className="mt-2 max-h-96 rounded-lg border border-gray-200"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
