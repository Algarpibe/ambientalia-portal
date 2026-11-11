// Panel de ajustes del tablero de «Equipos en taller» (solo admin): umbrales de color, horas del tema
// nocturno e indicadores de la cabecera. Vive en Ajustes del portal. Cada fila es un borrador que se
// guarda con su propio «Guardar», activo solo si esa fila cambió y el resultado completo es válido
// (misma regla que `validarAjustesTablero`, que el servidor vuelve a aplicar).
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { ApiTablero } from './api';
import { KPI_DEFS, KPI_IDS, validarAjustesTablero, type AjustesTablero, type KpiId } from './nucleo';
import type { TipoAviso } from './PanelLlaves';

type Fila = 'umbrales' | 'horas' | 'kpis';
type CampoNumero = 'umbralAmbar' | 'umbralRojo' | 'nocheDesde' | 'nocheHasta';
type Borrador = Record<CampoNumero, string> & { kpis: KpiId[] };

const aBorrador = (a: AjustesTablero): Borrador => ({
  umbralAmbar: String(a.umbralAmbar), umbralRojo: String(a.umbralRojo), nocheDesde: String(a.nocheDesde), nocheHasta: String(a.nocheHasta), kpis: [...a.kpis],
});
const num = (t: string) => (t.trim() === '' ? NaN : Number(t));
/** Lo que aporta cada fila al PUT parcial. */
function parcial(fila: Fila, b: Borrador): Partial<AjustesTablero> {
  if (fila === 'umbrales') return { umbralAmbar: num(b.umbralAmbar), umbralRojo: num(b.umbralRojo) };
  if (fila === 'horas') return { nocheDesde: num(b.nocheDesde), nocheHasta: num(b.nocheHasta) };
  return { kpis: b.kpis };
}
const IGUALES = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const FILAS: { fila: Fila; titulo: string; guardada: string; fallo: string; error: string }[] = [
  { fila: 'umbrales', titulo: 'umbrales', guardada: 'Umbrales guardados.', fallo: 'los umbrales', error: 'Los umbrales son días enteros desde 1, y el rojo debe ser mayor que el ámbar.' },
  { fila: 'horas', titulo: 'horas nocturnas', guardada: 'Horas nocturnas guardadas.', fallo: 'las horas nocturnas', error: 'Las horas son números enteros de 0 a 23.' },
  { fila: 'kpis', titulo: 'indicadores', guardada: 'Indicadores guardados.', fallo: 'los indicadores', error: 'Elige exactamente 5 indicadores distintos.' },
];

export default function PanelTablero({ api, avisar }: {
  api: ApiTablero;
  /** Cómo se avisa del resultado de guardar (en el portal, sus notificaciones). Sin él, se muestra en el panel. */
  avisar?: (texto: string, tipo: TipoAviso) => void;
}) {
  const [guardados, setGuardados] = useState<AjustesTablero | null>(null);
  const [b, setB] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState<Fila | null>(null);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<{ texto: string; tipo: TipoAviso } | null>(null);

  useEffect(() => {
    let vivo = true;
    api.ajustesTablero().then(
      (a) => { if (vivo) { setGuardados(a); setB(aBorrador(a)); } },
      (e) => { if (vivo) setError('No se pudieron cargar los ajustes: ' + (e as Error).message); },
    );
    return () => { vivo = false; };
  }, [api]);

  const aviso = (texto: string, tipo: TipoAviso) => (avisar ? avisar(texto, tipo) : setResultado({ texto, tipo }));
  const cambiar = (c: Partial<Borrador>) => setB((p) => (p ? { ...p, ...c } : p));

  async function guardar(f: (typeof FILAS)[number]) {
    if (!b) return;
    setGuardando(f.fila);
    try {
      setGuardados(await api.guardarAjustesTablero(parcial(f.fila, b)));
      aviso(f.guardada, 'info');
    } catch (e) {
      aviso('No se pudieron guardar ' + f.fallo + ': ' + (e as Error).message, 'error');
    } finally {
      setGuardando(null);
    }
  }

  const alternar = (id: KpiId) => b && cambiar({ kpis: b.kpis.includes(id) ? b.kpis.filter((k) => k !== id) : [...b.kpis, id] });
  const numero = (nombre: string, campo: CampoNumero) => (
    <label className="block">{nombre}
      <input type="number" aria-label={nombre} className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1.5" value={b![campo]} onChange={(e) => cambiar({ [campo]: e.target.value })} />
    </label>
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-sm">
      <h2 className="text-lg font-semibold text-gray-900">Equipos en taller · Tablero</h2>
      <p className="mt-2 text-slate-600">Cuándo una tarjeta pasa a ámbar o rojo, en qué horas la TV usa el tema nocturno y qué cinco indicadores se muestran. Cada fila se guarda por separado.</p>
      {error ? <p role="alert" className="mt-2 text-red-800">{error}</p> : null}
      {resultado ? <p role={resultado.tipo === 'error' ? 'alert' : 'status'} className={'mt-2 ' + (resultado.tipo === 'error' ? 'text-red-800' : 'text-slate-600')}>{resultado.texto}</p> : null}
      {!guardados || !b ? (
        error ? null : <p className="mt-2 text-slate-500">Cargando…</p>
      ) : (
        <div className="mt-3 divide-y divide-slate-200">
          {FILAS.map((f) => {
            const cambiado = !IGUALES(parcial(f.fila, b), parcial(f.fila, aBorrador(guardados)));
            const valido = validarAjustesTablero({ ...guardados, ...parcial(f.fila, b) }) !== null;
            return (
              <div key={f.fila} className="flex flex-wrap items-end gap-4 py-3">
                {f.fila === 'umbrales' ? <>{numero('Umbral ámbar (días)', 'umbralAmbar')}{numero('Umbral rojo (días)', 'umbralRojo')}</> : null}
                {f.fila === 'horas' ? <>{numero('Noche desde (hora)', 'nocheDesde')}{numero('Noche hasta (hora)', 'nocheHasta')}</> : null}
                {f.fila === 'kpis' ? (
                  <fieldset className="flex-1 min-w-[16rem]">
                    <legend className="text-slate-600">Indicadores (en el orden en que los eliges)</legend>
                    <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">{KPI_IDS.map((id) => (
                      <label key={id} className="flex items-center gap-2">
                        <input type="checkbox" checked={b.kpis.includes(id)} onChange={() => alternar(id)} />
                        {KPI_DEFS[id].etiqueta}{b.kpis.includes(id) ? <span className="text-slate-500"> · n.º {b.kpis.indexOf(id) + 1}</span> : null}
                      </label>
                    ))}</div>
                  </fieldset>
                ) : null}
                <button
                  type="button"
                  aria-label={'Guardar ' + f.titulo}
                  disabled={!cambiado || !valido || guardando === f.fila}
                  onClick={() => void guardar(f)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                  <Save className="w-4 h-4" /> Guardar
                </button>
                {cambiado && !valido ? <p role="alert" className="w-full text-red-800">{f.error}</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
