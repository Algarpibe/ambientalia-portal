import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import {
  crearNota,
  editarNota,
  leerComoBase64,
  type CambioNota,
  type CategoriaNota,
  type EmpleadoConJefatura,
  type ImagenSubida,
  type Nota,
} from './api';
import { hoyEnColombia } from './dominio';
import { CATEGORIAS_NOTA, MAX_COMENTARIO, MIMES_IMAGEN, errorDeImagen, textoDeErrorDeNota } from './notas';

interface Props {
  /** Las fichas activas: de aquí se elige quién lo solicita. */
  empleados: EmpleadoConJefatura[];
  /** `null` = alta; si no, la nota que se edita. */
  nota: Nota | null;
  onGuardada: (n: Nota) => void;
  onCancelar: () => void;
}

export default function FormularioNota({ empleados, nota, onGuardada, onCancelar }: Props) {
  const [empleadoId, setEmpleadoId] = useState(nota?.empleadoId ?? '');
  const [busqueda, setBusqueda] = useState('');
  const [categoria, setCategoria] = useState<CategoriaNota>(nota?.categoria ?? 'solicitud');
  const [fecha, setFecha] = useState(nota?.fecha ?? hoyEnColombia());
  const [comentario, setComentario] = useState(nota?.comentario ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [quitarImagen, setQuitarImagen] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // La URL de la vista previa retiene el fichero en memoria hasta revocarla.
  useEffect(() => {
    if (!archivo) {
      setVistaPrevia(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setVistaPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  // La persona elegida se queda en la lista aunque no case con la búsqueda: si
  // desapareciera del <select>, el navegador enseñaría otra que nadie eligió.
  const opciones = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    return empleados
      .filter((e) => e.id === empleadoId || !q || e.nombreCompleto.toLocaleLowerCase('es').includes(q))
      .sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
  }, [empleados, busqueda, empleadoId]);

  // Una nota cuya persona ya no es una ficha activa (retirada o borrada): se
  // enseña su nombre copiado para que el <select> no aparente otra cosa.
  const fueraDeLaLista = nota !== null && !empleados.some((e) => e.id === nota.empleadoId);

  function elegirArchivo(f: File | undefined) {
    if (!f) return;
    const problema = errorDeImagen(f);
    if (problema) {
      setError(problema);
      setArchivo(null);
      return;
    }
    setError(null);
    setArchivo(f);
    setQuitarImagen(false);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!nota && !empleadoId) {
      setError('Elige la persona que lo solicita.');
      return;
    }
    const texto = comentario.trim();
    if (!texto) {
      setError('Escribe un comentario.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const imagen: ImagenSubida | undefined = archivo
        ? { nombreArchivo: archivo.name, mime: archivo.type, contenidoBase64: await leerComoBase64(archivo) }
        : undefined;
      if (!nota) {
        onGuardada(await crearNota({ empleadoId, categoria, fecha, comentario: texto, imagen }));
        return;
      }
      // En la edición solo viaja lo que cambió: hub-api contesta `sin_cambios`
      // a un cuerpo vacío, y reenviar la persona de una ficha ya retirada daría
      // un 404 aunque nadie la hubiera tocado.
      const cambio: CambioNota = {};
      if (empleadoId && empleadoId !== nota.empleadoId) cambio.empleadoId = empleadoId;
      if (categoria !== nota.categoria) cambio.categoria = categoria;
      if (fecha !== nota.fecha) cambio.fecha = fecha;
      if (texto !== nota.comentario) cambio.comentario = texto;
      if (imagen) cambio.imagen = imagen;
      else if (quitarImagen) cambio.imagen = null;
      if (Object.keys(cambio).length === 0) {
        onCancelar();
        return;
      }
      onGuardada(await editarNota(nota.id, cambio));
    } catch (err) {
      setError(textoDeErrorDeNota((err as Error).message));
    } finally {
      setEnviando(false);
    }
  }

  const campoCls = 'w-full rounded-xl border border-gray-300 py-1.5 px-3 text-sm focus:border-blue-400 focus:outline-none';
  const rotuloCls = 'mb-1 block font-medium text-gray-700';

  return (
    <form onSubmit={guardar} className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">{nota ? 'Editar nota' : 'Nueva nota'}</h4>
        <button type="button" onClick={onCancelar} aria-label="Cerrar" className="rounded-lg p-1 text-gray-500 hover:bg-gray-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-sm">
          <span className={rotuloCls}>Persona que lo solicita</span>
          <input
            type="search"
            aria-label="Buscar persona"
            placeholder="Buscar por nombre…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${campoCls} mb-1`}
          />
          <select aria-label="Persona" value={empleadoId} onChange={(e) => setEmpleadoId(e.target.value)} className={campoCls}>
            {fueraDeLaLista ? (
              <option value={nota.empleadoId ?? ''}>{nota.empleadoNombre} (ya no está en la plantilla)</option>
            ) : (
              <option value="">— Elige una persona —</option>
            )}
            {opciones.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombreCompleto}
              </option>
            ))}
          </select>
        </div>

        <div className="text-sm">
          <span className={rotuloCls}>Fecha</span>
          <input type="date" aria-label="Fecha" required value={fecha} onChange={(e) => setFecha(e.target.value)} className={campoCls} />
        </div>
      </div>

      <div className="text-sm">
        <span className={rotuloCls}>Categoría</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Categoría">
          {CATEGORIAS_NOTA.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={categoria === c.id}
              onClick={() => setCategoria(c.id)}
              className={`rounded-xl border px-3 py-1.5 text-sm ${
                categoria === c.id
                  ? 'border-blue-500 bg-blue-50 font-semibold text-blue-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-sm">
        <span className={rotuloCls}>Comentario</span>
        <textarea
          aria-label="Comentario"
          rows={3}
          maxLength={MAX_COMENTARIO}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          className={campoCls}
        />
        <span className="mt-0.5 block text-right text-xs text-gray-500">
          {comentario.length}/{MAX_COMENTARIO}
        </span>
      </div>

      <div className="text-sm">
        <span className={rotuloCls}>Imagen (opcional)</span>
        <input
          type="file"
          aria-label="Imagen"
          accept={MIMES_IMAGEN.join(',')}
          onChange={(e) => elegirArchivo(e.target.files?.[0])}
          className="text-sm"
        />
        {vistaPrevia && <img src={vistaPrevia} alt="Vista previa" className="mt-2 max-h-48 rounded-lg border border-gray-200" />}
        {nota?.imagen && !archivo && (
          <label className="mt-2 flex items-center gap-2 text-gray-700">
            <input type="checkbox" checked={quitarImagen} onChange={(e) => setQuitarImagen(e.target.checked)} />
            Quitar la imagen actual ({nota.imagen.nombreArchivo})
          </label>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          {nota ? 'Guardar cambios' : 'Guardar nota'}
        </button>
      </div>
    </form>
  );
}
