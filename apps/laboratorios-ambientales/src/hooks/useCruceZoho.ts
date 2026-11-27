import { useEffect, useState } from 'react';
import type { CruceZoho, EstadoCruce, ResultadoCruce } from '../lib/clientes';
import { estadoDelCruce } from '../lib/clientes';
import { fetchClientesZoho } from '../services/clientesZoho';

export type CruceDeLaVista = {
  // El cruce, solo cuando está listo; null mientras se consulta o si falló.
  cruce: CruceZoho | null;
  estadoCruce: EstadoCruce;
  // Repite la consulta: es lo que hace el botón «Reintentar».
  reintentar: () => void;
};

/**
 * El cruce con Zoho de una lista de NIT base, para una vista. Salió de
 * Prospectos el 2026-11-27 para que lo use también la Base instalada de aire.
 * - La dependencia es el texto de los NIT y no la lista: si los datos se
 *   refrescan con los mismos NIT, no se repite la consulta.
 * - La petición se cancela al cerrar la vista o al cambiar los NIT.
 * - Cada resultado lleva la clave de su consulta: si cambian los NIT o se
 *   reintenta, el viejo deja de valer y la vista vuelve a «Consultando…»
 *   (estadoDelCruce). Nunca se enseña un cruce viejo como actual.
 */
export function useCruceZoho(nits: readonly string[]): CruceDeLaVista {
  const [resultado, setResultado] = useState<ResultadoCruce | null>(null);
  // Subirlo repite la consulta: es lo que hace «Reintentar».
  const [intento, setIntento] = useState(0);

  const claveNits = nits.join(',');
  const claveConsulta = `${claveNits}#${intento}`;
  // El efecto guarda el resultado con esa misma `claveConsulta` (no la rehace):
  // si las dos se escribieran por separado y se separaran, la vista se quedaría
  // en «Consultando…» para siempre. `intento` entra a través de `claveConsulta`.
  useEffect(() => {
    const controller = new AbortController();
    fetchClientesZoho(claveNits === '' ? [] : claveNits.split(','), controller.signal).then(
      (cruce) => {
        if (!controller.signal.aborted) setResultado({ clave: claveConsulta, cruce });
      },
      (error: unknown) => {
        // Al cerrar la vista se aborta: eso no es un error que haya que enseñar.
        if (controller.signal.aborted) return;
        console.warn('No se pudo consultar Zoho', error);
        setResultado({ clave: claveConsulta, cruce: null });
      },
    );
    return () => controller.abort();
  }, [claveNits, claveConsulta]);

  const estadoCruce = estadoDelCruce(resultado, claveConsulta);
  return {
    cruce: estadoCruce === 'listo' ? (resultado?.cruce ?? null) : null,
    estadoCruce,
    reintentar: () => setIntento((n) => n + 1),
  };
}
