import { useCallback, useEffect, useRef, useState } from 'react';
import { Snowflake } from 'lucide-react';
import { api, type HojaFst022 } from '../api';
import { PROBLEMAS_FST022, type CongelacionFst022, type ProblemaFst022, type ResultadoCongelacion, type ResumenFst022 } from '../dominio';
import { ApiError } from '../lib/apiError';
import { leerArchivo } from '../lib/importar';
import { fmtFechaHora } from '../lib/vistas';
import { usePermisos } from '../permisos';
import { Alert, Button, Tag } from '../ui';
import { Motivo } from './AgendaAcciones';

const PROBLEMA: Record<ProblemaFst022, string> = {
  sin_serial: 'Sin serial (vacío o con un error de Excel)',
  sin_cliente: 'Sin cliente',
  serial_repetido: 'Con un serial que se repite',
  serial_cientifico: 'Con el serial en notación científica (el real se perdió)',
  error_excel: 'Con algún error de Excel (#¡VALOR!, #¡REF!, #¿NOMBRE?…)',
  texto_en_fecha: 'Con texto donde va una fecha',
  fecha_imposible: 'Con una fecha imposible',
};

/** Sólo recuentos: aquí no se enseña ningún cliente ni serial. */
function Recuentos({ r }: { r: ResumenFst022 }) {
  const lineas: [string, number | string][] = [
    ['Tamaño de la hoja', `${r.totalFilas} filas × ${r.totalColumnas} columnas`],
    ['Filas de equipo', r.filasEquipo],
    ['· con serial', r.filasConSerial],
    ['· GRIMM EDM 180', r.filasEdm180],
    ['Otras filas (títulos, pie de totales, valores sueltos)', r.filasOtras],
    ...PROBLEMAS_FST022.filter((p) => r.problemas[p] > 0).map((p): [string, number] => [`⚠ ${PROBLEMA[p]}`, r.problemas[p]]),
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
      {lineas.map(([texto, n]) => (
        <div key={texto} className="contents">
          <dt className="text-gray-600">{texto}</dt>
          <dd className="text-right font-semibold tabular-nums">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

const firma = (c: CongelacionFst022) => `${c.por} · ${fmtFechaHora(c.en)}`;
const huella = (sha256: string) => `sha256 ${sha256.slice(0, 12)}…`;

/**
 * Congelación de la F-ST-022, dentro del diálogo de Importar y aparte de la
 * importación: guarda la hoja entera tal cual, en dos pasos (simulación con el
 * resumen y confirmar). Con una ya vigente se enseña, y sólo un administrador
 * del portal puede volver a congelar, con motivo. La guarda de verdad es la del servidor.
 */
export default function Congelacion({ notificar }: { notificar: (msg: string) => void }) {
  const { yo } = usePermisos();
  const input = useRef<HTMLInputElement>(null);
  const [lista, setLista] = useState<CongelacionFst022[] | null>(null);
  const [hoja, setHoja] = useState<HojaFst022 | null>(null);
  const [simulacro, setSimulacro] = useState<ResultadoCongelacion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fallo = useCallback((e: unknown) => setError(e instanceof ApiError && e.status === 413 ? 'La hoja es demasiado grande para congelarla desde aquí.' : (e as Error).message), []);
  const cargar = useCallback(() => api.congelaciones().then((r) => setLista(r.congelaciones)).catch(fallo), [fallo]);
  useEffect(() => void cargar(), [cargar]);

  const vigente = lista?.find((c) => c.vigente) ?? null;
  const anteriores = lista?.filter((c) => !c.vigente) ?? [];
  const puede = lista !== null && (!vigente || yo.admin);

  async function elegir(f: File) {
    setError(null);
    setSimulacro(null);
    setOcupado(true);
    try {
      const { hoja: nombre, matriz, sha256 } = await leerArchivo(await f.arrayBuffer());
      const leida = { archivo: f.name, sha256, hoja: nombre, matriz };
      setHoja(leida);
      setSimulacro(await api.congelar(leida, true));
    } catch (e) {
      fallo(e);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!hoja) return;
    setOcupado(true);
    setError(null);
    try {
      await api.congelar(hoja, false, motivo);
      setSimulacro(null);
      setHoja(null);
      setMotivo('');
      notificar('F-ST-022 congelada');
    } catch (e) {
      fallo(e);
    }
    await cargar();
    setOcupado(false);
  }

  return (
    <section aria-label="Congelación de la F-ST-022" className="flex flex-col gap-3 border-t border-gray-200 pt-4">
      <div>
        <h4 className="text-base font-semibold text-gray-900">Congelación de la F-ST-022</h4>
        <p className="text-gray-600">
          La Excel deja de ser la fuente. Congelar guarda la hoja «Trazabilidad» entera, tal cual —todas las marcas y también los datos sucios—, como punto de partida. No cambia el inventario
          ni el seguimiento.
        </p>
      </div>

      {lista === null && !error && <p className="text-gray-500">Comprobando si ya está congelada…</p>}
      {lista !== null && !vigente && <p className="text-gray-700">Todavía no se ha congelado.</p>}
      {vigente && (
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="mb-2 flex flex-wrap items-center gap-2 font-semibold text-gray-900">
            <Tag tone="blue">Vigente</Tag> «{vigente.archivo}»
          </p>
          <p className="mb-2 text-xs text-gray-500">
            Hoja «{vigente.hoja}» · {firma(vigente)} · <span title={vigente.sha256}>{huella(vigente.sha256)}</span>
            {vigente.motivo && <> · motivo: {vigente.motivo}</>}
          </p>
          <Recuentos r={vigente} />
        </div>
      )}
      {vigente && !yo.admin && <Alert tone="blue">Ya hay una congelación vigente. Sólo un administrador del portal puede volver a congelar la hoja, indicando el motivo.</Alert>}

      <input
        ref={input}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        aria-label="Archivo para congelar"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void elegir(f);
        }}
      />
      {puede && (
        <Button onClick={() => input.current?.click()} busy={ocupado && !simulacro} className="self-start">
          <Snowflake className="h-4 w-4" aria-hidden /> {vigente ? 'Volver a congelar F-ST-022' : 'Congelar F-ST-022'}
        </Button>
      )}

      {error && <Alert tone="red">{error}</Alert>}

      {simulacro && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <p className="mb-1 font-semibold text-gray-900">Simulación: «{simulacro.archivo}»</p>
          <p className="mb-2 text-xs text-gray-500">
            Hoja «{simulacro.hoja}» · cabecera en la fila {simulacro.resumen.filaCabecera} · <span title={simulacro.sha256}>{huella(simulacro.sha256)}</span>
          </p>
          <Recuentos r={simulacro.resumen} />
          <p className="mt-2 text-xs text-gray-500">
            <span className="font-medium text-gray-700">Columnas detectadas:</span> {simulacro.titulos.map((t) => t || '(sin título)').join(' · ')}
          </p>
          {simulacro.anterior && (
            <Motivo valor={motivo} onCambio={setMotivo} ayuda="Ya hay una congelación vigente: dejará de serlo, pero no se borra. Queda apuntado quién la reemplazó y por qué." />
          )}
          <Button variant="primary" className="mt-3" busy={ocupado} disabled={!!simulacro.anterior && motivo.trim() === ''} onClick={() => void confirmar()}>
            {simulacro.anterior ? 'Reemplazar la congelación vigente' : 'Confirmar congelación'}
          </Button>
        </div>
      )}

      {anteriores.length > 0 && (
        <details className="text-xs text-gray-600">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Congelaciones anteriores ({anteriores.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {anteriores.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-200 p-2">
                «{c.archivo}» · {firma(c)} · {c.filasEquipo} filas de equipo · <span title={c.sha256}>{huella(c.sha256)}</span>
                <br />
                Reemplazada por {c.reemplazadaPor} el {fmtFechaHora(c.reemplazadaEn)}: {c.reemplazadaMotivo}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
