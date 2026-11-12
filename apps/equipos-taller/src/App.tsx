import { lazy, Suspense, useState } from 'react';
import EquiposServicio from './EquiposServicio';
import type { ApiEquipos } from './api';

// El tablero (y sus fuentes) viaja en su propio chunk: quien se queda en la tabla no lo descarga.
const Tablero = lazy(() => import('./tablero/Tablero'));

type Vista = 'tabla' | 'tablero';
const leerVista = (): Vista => (new URLSearchParams(location.search).get('vista') === 'tablero' ? 'tablero' : 'tabla');

/**
 * «Equipos en taller»: la tabla de siempre (por defecto) y, a elección, el tablero kanban de solo lectura.
 * El tema del tablero no se elige aquí: es el «Tema del tablero» de Ajustes (el mismo que la TV).
 */
export default function App({ api }: { api?: ApiEquipos }) {
  const [vista, setVista] = useState<Vista>(leerVista);

  function cambiar(v: Vista) {
    setVista(v);
    // replaceState con el state actual: no añade historial y conserva el del router del portal.
    const url = new URL(location.href);
    if (v === 'tablero') url.searchParams.set('vista', 'tablero');
    else url.searchParams.delete('vista');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  const boton = (v: Vista, texto: string) => (
    <button type="button" aria-pressed={vista === v} onClick={() => cambiar(v)}
      className={'px-3 py-1 text-sm ' + (vista === v ? 'bg-sky-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
      {texto}
    </button>
  );

  return (
    <>
      <nav aria-label="Tipo de vista" className="flex px-4 pt-4">
        <div className="inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300">
          {boton('tabla', 'Tabla')}
          {boton('tablero', 'Tablero')}
        </div>
      </nav>
      {/* La tabla sigue montada al ver el tablero: conserva sus filtros y no vuelve a pedir los datos. */}
      <div hidden={vista !== 'tabla'}><EquiposServicio api={api} /></div>
      {vista === 'tablero' ? (
        <div className="p-4">
          <Suspense fallback={<p className="py-8 text-slate-500">Cargando tablero…</p>}>
            <Tablero api={api} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}
