import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CongelacionFst022 } from '../dominio';
import { huellaCorta, lineasOrigen, vigenteDe } from '../lib/origen';
import { fmtFechaHora } from '../lib/vistas';
import { Alert, Card, Loading, Tag } from '../ui';

const firma = (c: CongelacionFst022) => `${c.por} · ${fmtFechaHora(c.en)}`;

/**
 * «Origen de los datos · F-ST-022 congelada», en Configuración: de qué archivo
 * salió la hoja congelada, quién la congeló y cuándo, y sus recuentos. Sólo
 * lectura y para cualquiera con la app: aquí no se sube, se importa ni se
 * vuelve a congelar nada (esa subida se retiró el 10/10/2026). Sólo recuentos:
 * ningún cliente ni serial.
 */
export default function OrigenDatos() {
  const [lista, setLista] = useState<CongelacionFst022[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .congelaciones()
      .then((r) => setLista(r.congelaciones))
      .catch((e: Error) => setError(e.message));
  }, []);

  const vigente = vigenteDe(lista);
  const anteriores = lista?.filter((c) => !c.vigente) ?? [];

  return (
    <Card
      title="Origen de los datos · F-ST-022 congelada"
      hint="La hoja «Trazabilidad» de la Excel F-ST-022 se guardó entera, tal cual, y es el punto de partida firmado. La Excel ya no se sube: ni se importa ni se vuelve a congelar."
    >
      {error && <Alert tone="red">{error}</Alert>}
      {!lista && !error && <Loading texto="Cargando el origen de los datos…" />}
      {lista && !vigente && (
        <Alert tone="amber" title="Este entorno no tiene ninguna congelación de la F-ST-022">
          No hay hoja congelada que enseñar. Desde la app no se puede crear: la subida de la Excel se retiró el 10/10/2026.
        </Alert>
      )}
      {vigente && (
        <div className="max-w-2xl text-sm">
          <p className="mb-1 flex flex-wrap items-center gap-2 font-semibold text-gray-900">
            <Tag tone="blue">Vigente</Tag> «{vigente.archivo}»
          </p>
          <p className="mb-3 text-xs text-gray-500">
            Hoja «{vigente.hoja}» · cabecera en la fila {vigente.filaCabecera} · congelada por {firma(vigente)} · <span title={vigente.sha256}>{huellaCorta(vigente.sha256)}</span>
            {vigente.motivo && <> · motivo: {vigente.motivo}</>}
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {lineasOrigen(vigente).map((l) => (
              <div key={l.texto} className="contents">
                <dt className={l.aviso ? 'text-amber-800' : 'text-gray-600'}>{l.aviso ? `Aviso: ${l.texto.charAt(0).toLowerCase()}${l.texto.slice(1)}` : l.texto}</dt>
                <dd className="text-right font-semibold tabular-nums">{l.valor}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-gray-500">Los avisos son filas de equipo con un dato que conviene revisar; se guardaron igual, sin arreglar nada.</p>
        </div>
      )}
      {anteriores.length > 0 && (
        <details className="mt-4 max-w-2xl text-xs text-gray-600">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Congelaciones anteriores ({anteriores.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {anteriores.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-200 p-2">
                «{c.archivo}» · {firma(c)} · {c.filasEquipo} filas de equipo · <span title={c.sha256}>{huellaCorta(c.sha256)}</span>
                <br />
                Reemplazada por {c.reemplazadaPor} el {fmtFechaHora(c.reemplazadaEn)}: {c.reemplazadaMotivo}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
