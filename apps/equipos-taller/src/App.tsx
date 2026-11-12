import { lazy, Suspense, useState } from 'react';
import EquiposServicio from './EquiposServicio';
import type { ApiEquipos } from './api';

// El tablero (y sus fuentes) viaja en su propio chunk: quien se queda en la tabla no lo descarga.
const Tablero = lazy(() => import('./tablero/Tablero'));

type Vista = 'tabla' | 'tablero';
const leerVista = (): Vista => (new URLSearchParams(location.search).get('vista') === 'tablero' ? 'tablero' : 'tabla');

type TemaTablero = 'dia' | 'noche';
export const CLAVE_TEMA_TABLERO = 'equipos-taller:tablero:tema';
// El almacenamiento local puede no existir (modo privado, política del navegador): nunca rompe la vista.
const leerTema = (): TemaTablero => { try { return localStorage.getItem(CLAVE_TEMA_TABLERO) === 'noche' ? 'noche' : 'dia'; } catch { return 'dia'; } };
const guardarTema = (t: TemaTablero) => { try { localStorage.setItem(CLAVE_TEMA_TABLERO, t); } catch { /* sin almacenamiento: vale solo en esta visita */ } };

/**
 * «Equipos en taller»: la tabla de siempre (por defecto) y, a elección, el tablero kanban de solo lectura.
 * El tema del tablero (Día por defecto) lo elige quien lo mira y este dispositivo lo recuerda.
 */
export default function App({ api }: { api?: ApiEquipos }) {
  const [vista, setVista] = useState<Vista>(leerVista);
  const [tema, setTema] = useState<TemaTablero>(leerTema);

  function cambiar(v: Vista) {
    setVista(v);
    // replaceState con el state actual: no añade historial y conserva el del router del portal.
    const url = new URL(location.href);
    if (v === 'tablero') url.searchParams.set('vista', 'tablero');
    else url.searchParams.delete('vista');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }
  function elegirTema(t: TemaTablero) {
    setTema(t);
    guardarTema(t);
  }
  const segmento = (activo: boolean, texto: string, alPulsar: () => void) => (
    <button type="button" aria-pressed={activo} onClick={alPulsar}
      className={'px-3 py-1 text-sm ' + (activo ? 'bg-sky-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}>
      {texto}
    </button>
  );
  const GRUPO = 'inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300';

  return (
    <>
      <nav aria-label="Tipo de vista" className="flex flex-wrap gap-3 px-4 pt-4">
        <div className={GRUPO}>
          {segmento(vista === 'tabla', 'Tabla', () => cambiar('tabla'))}
          {segmento(vista === 'tablero', 'Tablero', () => cambiar('tablero'))}
        </div>
        {vista === 'tablero' ? (
          <div role="group" aria-label="Tema del tablero" className={GRUPO}>
            {segmento(tema === 'dia', 'Día', () => elegirTema('dia'))}
            {segmento(tema === 'noche', 'Noche', () => elegirTema('noche'))}
          </div>
        ) : null}
      </nav>
      {/* La tabla sigue montada al ver el tablero: conserva sus filtros y no vuelve a pedir los datos. */}
      <div hidden={vista !== 'tabla'}><EquiposServicio api={api} /></div>
      {vista === 'tablero' ? (
        <div className="p-4">
          <Suspense fallback={<p className="py-8 text-slate-500">Cargando tablero…</p>}>
            <Tablero api={api} tema={tema} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}
